import { expect, it } from 'vitest';
import { MaxwellSceneSolver } from '../../src/engine/maxwell/sceneSolver';
import { makeCharge, makeScene } from '../../src/scene/defaults';
import { depositSmoothCharge, gatherSmoothElectric } from '../../src/engine/maxwell/smoothCharge';
import { measureFieldBalance } from '../../src/engine/maxwell/fieldBalance';

function setup(forceDriven = false) {
  const charge = makeCharge([-0.1, 0.013, 0.021], 1e-10);
  Object.assign(charge, { sourceProfile: 'smooth', sourceWidth: 0.06 });
  if (forceDriven) charge.dynamics = { mode: 'forceDriven', mass: 1e-23, inertia: [1, 1, 1], velocity: [0, 1e5, 0], angularVelocity: [0, 0, 0] };
  else charge.motion = { kind: 'oscillate', axis: [0, 1, 0], amplitude: 0.03, frequency: 1e8 };
  const scene = makeScene({ name: 'finite cloud', objects: [charge] });
  Object.assign(scene.simulation, { resolution: 16, pmlCells: 4, cfl: 0.5, useApproximation: false });
  return { scene, charge };
}

it('initializes and transports the selected physical cloud without changing its authored definition', () => {
  const { scene, charge } = setup(), authored = JSON.stringify(scene), solver = new MaxwellSceneSolver(scene);
  let preparationOffset: Float64Array | undefined;
  const check = () => {
    const expected = new Float64Array(solver.core.rho.length), p = solver.pose(charge).position.map((v, a) => v - solver.min[a]) as [number, number, number];
    depositSmoothCharge(expected, solver.core, p, 0.06, charge.charge);
    const scale = Math.max(...expected.map(Math.abs));
    // Preparation reconstructs compatible rho from its iterative potential;
    // measure that tolerance separately from endpoint-exact runtime transport.
    if (!preparationOffset) {
      preparationOffset = expected.map((v, i) => solver.core.rho[i] - v);
      expect(Math.max(...preparationOffset.map(Math.abs)) / scale).toBeLessThan(5e-10);
    }
    expect(Math.max(...expected.map((v, i) => Math.abs(v + preparationOffset![i] - solver.core.rho[i]))) / scale).toBeLessThan(2e-12);
    expect(solver.diagnostics().gaussRelative).toBeLessThan(1e-10);
  };
  check(); solver.step(6); check();
  const final = solver.sample([0.2, 0.1, 0]);
  expect(final.Bmag).toBeGreaterThan(0);
  solver.reset(); solver.step(6); expect(solver.sample([0.2, 0.1, 0])).toEqual(final);
  expect(JSON.stringify(scene)).toBe(authored);
});

it('gathers the selected cloud electric force and measures its actual deposited-current work', () => {
  const { scene, charge } = setup(true), solver = new MaxwellSceneSolver(scene), s = solver.core;
  const point = charge.position.map((v, a) => v - solver.min[a]) as [number, number, number];
  const expected = gatherSmoothElectric(s.Ex, s.Ey, s.Ez, s, point, 0.06);
  const gathered = solver.sampleSourceForForce(charge, charge.position);
  expect(gathered.E).toEqual(expected);
  const p = solver.meta.physical;
  let work = 0;
  for (let n = 0; n < 5; n++) work += measureFieldBalance(s, { low: [p.x0 + 1, p.y0 + 1, p.z0 + 1], high: [p.x1 - 2, p.y1 - 2, p.z1 - 2] }, () => solver.step()).matterWork;
  const diagnostics = solver.diagnostics() as Record<string, number>;
  expect(Math.abs(diagnostics.sourceParticleWork - work) / Math.max(Math.abs(work), 1e-40)).toBeLessThan(2e-11);
  expect(diagnostics.sourceParticleKinetic).toBeGreaterThan(0);
});

it('rejects clipped or invalid smooth source profiles instead of depositing a partial cloud', () => {
  const { scene, charge } = setup();
  charge.position = [0.45, 0, 0];
  expect(() => new MaxwellSceneSolver(scene)).toThrow(/physical domain|support/i);
  charge.position = [0, 0, 0];
  for (const sourceWidth of [0, -0.01, NaN, Infinity]) {
    Object.assign(charge, { sourceWidth });
    expect(() => new MaxwellSceneSolver(scene)).toThrow(/width/i);
  }
  Object.assign(charge, { sourceProfile: 'unknown', sourceWidth: 0.06 });
  expect(() => new MaxwellSceneSolver(scene)).toThrow(/profile/i);
});

it('rejects smooth assignment overlapping a PEC wall and gathers uniform B away from its boundary stencil', () => {
  const charge = makeCharge([-0.375, 0, 0], 0);
  charge.sourceProfile = 'smooth'; charge.sourceWidth = 0.0625;
  const scene = makeScene({ name: 'cloud and PEC support', objects: [charge] });
  Object.assign(scene.simulation, { useApproximation: false, resolution: 8, externalB: [0, 0, 1], boundary: { x: 'pec', y: 'pec', z: 'pec' } });
  expect(() => new MaxwellSceneSolver(scene)).toThrow(/assignment.*PEC|PEC.*assignment/i);
  charge.position = [0.375, 0, 0];
  expect(() => new MaxwellSceneSolver(scene)).toThrow(/assignment.*PEC|PEC.*assignment/i);
  charge.position = [-0.25, 0, 0];
  const solver = new MaxwellSceneSolver(scene);
  const field = solver.sampleSourceForForce(charge, charge.position);
  expect(field.B[2]).toBeCloseTo(1, 14);
  expect(field.B.slice(0, 2)).toEqual([0, 0]);
});
