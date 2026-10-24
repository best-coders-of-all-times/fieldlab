import { describe, expect, it } from 'vitest';
import { MaxwellSceneSolver } from '../../src/engine/maxwell/sceneSolver';
import { makeScene, makeCharge, makeChargedSphere, makeConductor, makeProbe, makeMagnet, makeDielectric, makePlaneWave } from '../../src/scene/defaults';

function chargedScene() {
  const scene = makeScene({ name: 'charge', objects: [makeCharge([0, 0, 0], 1e-10), makeProbe([0.2, 0, 0])] });
  scene.simulation.resolution = 16 as never;
  scene.simulation.useApproximation = false;
  scene.simulation.pmlCells = 4;
  return scene;
}

describe('Scene Maxwell solver', () => {
  it('initializes electrostatic charge consistently, then evolves both fields', () => {
    const solver = new MaxwellSceneSolver(chargedScene());
    expect(solver.sample([0.2, 0, 0]).E[0]).toBeGreaterThan(10);
    expect(solver.diagnostics().gaussRelative).toBeLessThan(1e-5);
    solver.step(4);
    expect(solver.time).toBeCloseTo(4 * solver.meta.dt, 20);
    expect(solver.diagnostics().gaussRelative).toBeLessThan(1e-4);
  });

  it('requires an explicit electrical model for electrodes', () => {
    const scene = chargedScene();
    scene.objects = [makeConductor()];
    expect(() => new MaxwellSceneSolver(scene)).toThrow(/isolat|electrical model/i);
  });

  it('rewinds all evolved fields without changing the authored definition', () => {
    const scene = chargedScene();
    scene.objects[0].motion = { kind: 'oscillate', axis: [0, 1, 0], amplitude: 0.02, frequency: 1e7 };
    const authored = JSON.stringify(scene);
    const solver = new MaxwellSceneSolver(scene);
    solver.step(12);
    const before = solver.sample([0.2, 0.1, 0]);
    solver.reset();
    solver.step(12);
    expect(solver.sample([0.2, 0.1, 0])).toEqual(before);
    expect(JSON.stringify(scene)).toBe(authored);
    expect(before.Bmag).toBeGreaterThan(0);
  });

  it('evolves a magnetic response from transported charge on isolated moving plates', () => {
    const scene = chargedScene();
    const a = makeConductor([-0.125, 0, 0], 'box', [0.08, 0.5, 0.5]);
    const b = makeConductor([0.125, 0, 0], 'box', [0.08, 0.5, 0.5]);
    a.potential = 3; b.potential = -3;
    a.motion = b.motion = { kind: 'oscillate', axis: [0, 1, 0], amplitude: 0.02, frequency: 1e7 };
    scene.objects = [a, b];
    scene.simulation.maxwellConductorModel = 'isolated';
    const solver = new MaxwellSceneSolver(scene);
    const authored = JSON.stringify(scene);
    solver.step(20);
    const sample = solver.sample([0, 0, 0]);
    expect(sample.Bmag).toBeGreaterThan(1e-12);
    expect(sample.B[2]).toBeLessThan(0);
    expect(solver.diagnostics().gaussRelative).toBeLessThan(1e-4);
    expect(JSON.stringify(scene)).toBe(authored);
  });

  it('keeps a prepared stationary capacitor free of an unphysical magnetic transient', () => {
    const scene = chargedScene();
    const a = makeConductor([-0.125, 0, 0], 'box', [0.08, 0.5, 0.5]);
    const b = makeConductor([0.125, 0, 0], 'box', [0.08, 0.5, 0.5]);
    a.potential = 3; b.potential = -3;
    scene.objects = [a, b]; scene.simulation.maxwellConductorModel = 'isolated';
    const solver = new MaxwellSceneSolver(scene);
    solver.step(100);
    expect(solver.sample([0, 0, 0]).Bmag).toBeLessThan(1e-17);
  });

  it('does not entrain an independent charge in a moving conductor transport halo', () => {
    const scene = chargedScene();
    const conductor = makeConductor([0, 0, 0], 'box', [0.2, 0.2, 0.2]);
    conductor.conductivity = 0;
    conductor.motion = { kind: 'oscillate', axis: [0, 1, 0], amplitude: 0.02, frequency: 1e7 };
    scene.objects = [conductor]; scene.simulation.maxwellConductorModel = 'isolated';
    const solver = new MaxwellSceneSolver(scene);
    const c = 15 + solver.core.nx * (12 + solver.core.ny * 12);
    solver.core.rho.fill(0); solver.core.rho[c] = 1;
    (solver as any).conductorCurrents();
    expect(solver.core.Jy[c]).toBe(0);
  });

  it('preserves the initial velocity of a force-driven point charge', () => {
    const scene = chargedScene(), charge = scene.objects[0];
    charge.dynamics = { mode: 'forceDriven', mass: 1, inertia: [1, 1, 1], velocity: [1e6, 0, 0], angularVelocity: [0, 0, 0] };
    const solver = new MaxwellSceneSolver(scene);
    solver.step();
    expect(solver.pose(charge).position[0]).toBeCloseTo(1e6 * solver.core.dt, 10);
  });

  it('reverses the force on a distributed charged body when its charge reverses', () => {
    const velocities = [-1, 1].map(sign => {
      const scene = chargedScene(), body = makeChargedSphere();
      body.charge = sign * 1e-12; body.radius = 0.1;
      body.dynamics = { mode: 'forceDriven', mass: 1e-20, inertia: [1, 1, 1], velocity: [0, 0, 0], angularVelocity: [0, 0, 0] };
      scene.objects = [body]; scene.simulation.externalField = [1e5, 0, 0];
      const solver = new MaxwellSceneSolver(scene);
      solver.step();
      return solver.bodies.get(body.id)!.velocity[0];
    });
    expect(velocities[0]).toBeLessThan(-100);
    expect(velocities[1]).toBeGreaterThan(100);
    expect(Math.abs(velocities[0] + velocities[1])).toBeLessThan(1e-3 * velocities[1]);
  });

  it('evolves prescribed magnet polarization charge consistently and replays it', () => {
    const scene = chargedScene(), magnet = makeMagnet();
    magnet.radius = 0.12; magnet.length = 0.3; magnet.magnetization = 10;
    magnet.motion = { kind: 'oscillate', axis: [0, 1, 0], amplitude: 0.02, frequency: 1e7 };
    scene.objects = [magnet];
    const solver = new MaxwellSceneSolver(scene);
    solver.step(8);
    const sample = solver.sample([0.2, 0, 0]);
    expect(sample.Bmag).toBeGreaterThan(1e-10);
    expect(solver.diagnostics().gaussRelative).toBeLessThan(1e-5);
    solver.reset(); solver.step(8);
    expect(solver.sample([0.2, 0, 0])).toEqual(sample);
  });

  it('ignores stored trajectories on fixed material bodies', () => {
    const scene = chargedScene(), dielectric = makeDielectric();
    dielectric.motion = { kind: 'oscillate', axis: [0, 1, 0], amplitude: 0.02, frequency: 1e7 };
    dielectric.dynamics = { mode: 'fixed', mass: 1, inertia: [1, 1, 1], velocity: [0, 0, 0], angularVelocity: [0, 0, 0] };
    scene.objects = [dielectric];
    expect(() => new MaxwellSceneSolver(scene)).not.toThrow();
  });

  it('rejects material sources extending outside the physical domain before clipping', () => {
    const scene = chargedScene(), magnet = makeMagnet([0.55, 0, 0]);
    scene.objects = [magnet];
    expect(() => new MaxwellSceneSolver(scene)).toThrow(/domain|boundary/i);
  });

  it('places the electric source sheet at its authored coordinate', () => {
    const scene = chargedScene(), source = makePlaneWave();
    source.position = [0.125, 0, 0]; source.waveform = 'pulse'; scene.objects = [source];
    const solver = new MaxwellSceneSolver(scene); solver.step();
    const current = solver.core.Jz.findIndex(v => v !== 0);
    expect(current).toBeGreaterThanOrEqual(0);
    const x = (current % solver.core.nx) * solver.core.dx - 0.5 - scene.simulation.pmlCells * solver.core.dx;
    expect(x).toBeCloseTo(source.position[0], 10);
    solver.step(10);
    expect(solver.diagnostics().gaussRelative).toBeLessThan(1e-8);
  });
});
