import { expect, it } from 'vitest';
import { MaxwellSceneSolver } from '../../src/engine/maxwell/sceneSolver';
import { makeCharge, makeScene } from '../../src/scene/defaults';
import { measureFieldBalance } from '../../src/engine/maxwell/fieldBalance';

function interactingCharges() {
  const objects = [makeCharge([-0.125, 0, 0], 1e-9), makeCharge([0.125, 0, 0], -1e-9)];
  for (const object of objects) object.dynamics = { mode: 'forceDriven', mass: 1e-23, inertia: [1, 1, 1], velocity: [0, 0, 0], angularVelocity: [0, 0, 0] };
  const scene = makeScene({ name: 'particle work reference', objects });
  Object.assign(scene.simulation, { resolution: 16, pmlCells: 4, cfl: 0.6, useApproximation: false });
  return new MaxwellSceneSolver(scene);
}

it('measures particle work independently against the actual Maxwell current work and reports coupling error', () => {
  const solver = interactingCharges(), p = solver.meta.physical;
  const before = solver.diagnostics() as Record<string, number>;
  let fieldWork = 0;
  for (let n = 0; n < 5; n++) fieldWork += measureFieldBalance(solver.core,
    { low: [p.x0 + 1, p.y0 + 1, p.z0 + 1], high: [p.x1 - 2, p.y1 - 2, p.z1 - 2] }, () => solver.step()).matterWork;
  const after = solver.diagnostics() as Record<string, number>;
  expect(after.sourceParticleCount).toBe(2);
  expect(after.sourceParticleWork / fieldWork).toBeCloseTo(1, 12);
  expect(after.sourceParticleKinetic).toBeGreaterThan(0);
  const measured = after.sourceParticleKinetic - before.sourceParticleKinetic - fieldWork;
  expect((after.sourceParticleCouplingResidual - measured) / fieldWork).toBeCloseTo(0, 12);
  const final = { work: after.sourceParticleWork, kinetic: after.sourceParticleKinetic, residual: after.sourceParticleCouplingResidual, relative: after.sourceParticleCouplingRelative };
  solver.reset();
  const reset = solver.diagnostics() as Record<string, number>;
  expect(reset.sourceParticleWork).toBe(0); expect(reset.sourceParticleCouplingResidual).toBeCloseTo(0, 35);
  solver.step(5);
  const replay = solver.diagnostics() as Record<string, number>;
  expect({ work: replay.sourceParticleWork, kinetic: replay.sourceParticleKinetic, residual: replay.sourceParticleCouplingResidual, relative: replay.sourceParticleCouplingRelative }).toEqual(final);
});

it('does not mislabel prescribed source work as force-driven particle work', () => {
  const object = makeCharge([0, 0, 0], 1e-10);
  object.motion = { kind: 'oscillate', axis: [0, 1, 0], amplitude: 0.02, frequency: 1e7 };
  const scene = makeScene({ name: 'prescribed', objects: [object] });
  Object.assign(scene.simulation, { resolution: 16, pmlCells: 4, useApproximation: false });
  const solver = new MaxwellSceneSolver(scene); solver.step(4);
  const d = solver.diagnostics() as Record<string, number>;
  expect(d.sourceParticleCount).toBe(0); expect(d.sourceParticleWork).toBe(0);
  expect(d.sourceParticleKinetic).toBe(0); expect(d.sourceParticleCouplingResidual).toBe(0);
});
