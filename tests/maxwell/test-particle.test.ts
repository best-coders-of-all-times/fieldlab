import { expect, it } from 'vitest';
import { MaxwellSceneSolver } from '../../src/engine/maxwell/sceneSolver';
import { makeParticle, makeScene } from '../../src/scene/defaults';
import type { ParticleObject, SceneObject } from '../../src/scene/types';

function setup(objects: SceneObject[] = []) {
  const scene = makeScene({ name: 'explicit test particles', objects });
  Object.assign(scene.simulation, { useApproximation: false, resolution: 16, pmlCells: 4, cfl: 0.5, externalField: [100, 0, 0] });
  return scene;
}

function particle() {
  return Object.assign(makeParticle(), { fieldFeedback: 'testParticle' as const, charge: 1e-12, mass: 1e-23, velocity: [0, 0, 0] as [number, number, number] });
}

function expectSameFields(actual: MaxwellSceneSolver, expected: MaxwellSceneSolver) {
  for (const key of ['Ex', 'Ey', 'Ez', 'Bx', 'By', 'Bz', 'rho', 'Jx', 'Jy', 'Jz'] as const) {
    const a = new Uint8Array(actual.core[key].buffer), b = new Uint8Array(expected.core[key].buffer);
    expect(a.every((value, i) => value === b[i]), `${key} must match bit for bit`).toBe(true);
  }
}

it('accelerates a test particle on the field clock without changing any charge, current or evolved field', () => {
  const object = particle(), solver = new MaxwellSceneSolver(setup([object])), baseline = new MaxwellSceneSolver(setup());
  expect(solver.sample(object.position).E[0]).toBeCloseTo(100, 6);
  expectSameFields(solver, baseline);
  solver.step(4); baseline.step(4);
  expect(solver.time).toBe(4 * solver.core.dt);
  expect(solver.bodies.get(object.id)!.velocity[0]).toBeGreaterThan(0);
  expect(solver.pose(object).position[0]).toBeGreaterThan(object.position[0]);
  expectSameFields(solver, baseline);
});

it('keeps missing and explicit source feedback equivalent and deposits their charge and current', () => {
  const object = particle(); delete (object as Partial<typeof object>).fieldFeedback;
  object.velocity = [1e5, 0, 0];
  const legacy = new MaxwellSceneSolver(setup([object]));
  const explicit = new MaxwellSceneSolver(setup([{ ...object, fieldFeedback: 'source' } as ParticleObject]));
  expectSameFields(legacy, explicit);
  expect(legacy.core.rho.some(q => q !== 0)).toBe(true);
  legacy.step(); explicit.step();
  expectSameFields(legacy, explicit);
  expect(legacy.core.Jx.some(j => j !== 0)).toBe(true);
});

it('excludes test-particle kinetic energy, momentum and work from source coupling diagnostics', () => {
  const object = particle(), solver = new MaxwellSceneSolver(setup([object]));
  solver.step(4);
  expect(solver.bodies.get(object.id)!.velocity[0]).toBeGreaterThan(0);
  const diagnostics = solver.diagnostics();
  for (const key of ['sourceParticleCount', 'sourceParticleKinetic', 'sourceParticleWork', 'sourceParticleCouplingResidual', 'sourceParticleCouplingRelative', 'sourceParticleMomentumX', 'sourceParticleMomentumY', 'sourceParticleMomentumZ']) expect(diagnostics[key as keyof typeof diagnostics]).toBe(0);
});

it('preserves source-only motion and the coupling ledger when a test particle is added', () => {
  const source = { ...particle(), fieldFeedback: 'source' as const, position: [-0.1, 0, 0] as [number, number, number] };
  const test = particle(); test.position = [0.1, 0, 0];
  const baseline = new MaxwellSceneSolver(setup([source])), solver = new MaxwellSceneSolver(setup([source, test]));
  baseline.step(4); solver.step(4);
  expectSameFields(solver, baseline);
  expect(solver.bodies.get(source.id)).toEqual(baseline.bodies.get(source.id));
  const ledger = (s: MaxwellSceneSolver) => Object.fromEntries(Object.entries(s.diagnostics()).filter(([key]) => key.startsWith('sourceParticle')));
  expect(ledger(solver)).toEqual(ledger(baseline));
  expect(solver.diagnostics()).toMatchObject({ sourceParticleCount: 1 });
});

it.each([10, 0, -1, NaN, Infinity])('ignores dormant smooth width %s and its physical support for a test particle', sourceWidth => {
  const object = Object.assign(particle(), { sourceProfile: 'smooth' as const, sourceWidth, position: [0.45, 0, 0] as [number, number, number] });
  const solver = new MaxwellSceneSolver(setup([object])), baseline = new MaxwellSceneSolver(setup());
  solver.step(); baseline.step();
  expect(solver.pose(object).position[0]).toBeGreaterThan(0.45);
  expectSameFields(solver, baseline);
});

it('still rejects test-particle points outside the physical domain', () => {
  const object = particle(); object.position = [0.51, 0, 0];
  expect(() => new MaxwellSceneSolver(setup([object]))).toThrow(/physical domain/i);
});

it('rejects a test particle drifting out of the physical domain', () => {
  const object = particle(); object.position = [0.499, 0, 0]; object.velocity = [3e7, 0, 0];
  const solver = new MaxwellSceneSolver(setup([object]));
  expect(() => solver.step()).toThrow(/physical domain/i);
});

it('ignores dormant cloud support beside a PEC wall while keeping the test-particle point inside', () => {
  const object = Object.assign(particle(), { sourceProfile: 'smooth' as const, sourceWidth: 10, position: [0.49, 0, 0] as [number, number, number] });
  const scene = setup([object]);
  Object.assign(scene.simulation, { externalField: [0, 0, 0], boundary: { x: 'pec', y: 'pec', z: 'pec' } });
  const solver = new MaxwellSceneSolver(scene); solver.step();
  expect(solver.pose(object).position).toEqual(object.position);
  expect(solver.core.rho.every(q => q === 0)).toBe(true);
});

it('rejects an unknown feedback mode clearly', () => {
  const object = Object.assign(particle(), { fieldFeedback: 'unknown' });
  expect(() => new MaxwellSceneSolver(setup([object as ParticleObject]))).toThrow(/feedback/i);
});

it('gathers nonuniform native E and synchronized B locally rather than averaging a dormant cloud', () => {
  const object = Object.assign(particle(), { position: [0.03125, 0.03125, 0] as [number, number, number], sourceProfile: 'smooth' as const, sourceWidth: 0.08 });
  const scene = setup([object]); scene.simulation.externalField = [0, 0, 0];
  const solver = new MaxwellSceneSolver(scene), s = solver.core;
  // Manufactured Yee fields: the particle sits exactly on Ex's x edge and
  // Bz's x/y face centers. Their quadratic spatial profiles separate local
  // interpolation from finite-cloud averaging without mocking the sampler.
  for (let k = 0; k < s.nz; k++) for (let j = 0; j < s.ny; j++) for (let i = 0; i < s.nx; i++) {
    const c = i + s.nx * (j + s.ny * k);
    s.Ex[c] = 1e5 * (solver.min[0] + (i + 0.5) * s.dx) ** 2;
    s.Bz[c] = (solver.min[1] + (j + 0.5) * s.dy) ** 2;
  }
  const field = solver.sampleSourceForForce(object, object.position);
  expect(field.E[0]).toBeCloseTo(1e5 * object.position[0] ** 2, 11);
  expect(field.B[2]).toBeCloseTo(object.position[1] ** 2, 14);
  // Remove B for a direct impulse check of the force used by actual motion.
  s.Bz.fill(0);
  solver.step();
  expect(solver.bodies.get(object.id)!.momentum[0] / (object.charge * 1e5 * object.position[0] ** 2 * s.dt)).toBeCloseTo(1, 12);
});

it('rewinds and replays test-particle state and the unchanged fields exactly', () => {
  const object = particle(), solver = new MaxwellSceneSolver(setup([object]));
  solver.step(5);
  const body = structuredClone(solver.bodies.get(object.id)), fields = solver.core.snapshot();
  solver.reset();
  expect(solver.pose(object).position).toEqual(object.position);
  solver.step(5);
  expect(solver.bodies.get(object.id)).toEqual(body);
  expect(solver.core.snapshot()).toEqual(fields);
});
