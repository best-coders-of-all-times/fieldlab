import { expect, it } from 'vitest';
import { MaxwellSceneSolver } from '../../src/engine/maxwell/sceneSolver';
import { makeCharge, makeScene } from '../../src/scene/defaults';
import { C_LIGHT } from '../../src/engine/constants';
import { measureFieldBalance } from '../../src/engine/maxwell/fieldBalance';

function measure(resolution: 16 | 24 | 32, factor = 1, shift = 0) {
  const time = 3e-10, steps = Math.ceil(time * C_LIGHT * Math.sqrt(3) * resolution / 0.7) * factor;
  const objects = [makeCharge([-0.2 + shift, 0, 0], 1e-9), makeCharge([0.2 + shift, 0, 0], -0.8e-9)];
  objects.forEach((object, i) => {
    object.sourceProfile = 'smooth'; object.sourceWidth = 0.075;
    object.dynamics = { mode: 'forceDriven', mass: 1e-23 * (i ? 1.2 : 1), inertia: [1, 1, 1], velocity: [0, 0, 0], angularVelocity: [0, 0, 0] };
  });
  const scene = makeScene({ name: 'resolved charge energy reference', objects });
  Object.assign(scene.simulation, { useApproximation: false, resolution, pmlCells: 4, cfl: time / steps * C_LIGHT * Math.sqrt(3) * resolution });
  const solver = new MaxwellSceneSolver(scene), p = solver.meta.physical;
  const volume = { low: [p.x0 + 1, p.y0 + 1, p.z0 + 1] as [number, number, number], high: [p.x1 - 3, p.y1 - 3, p.z1 - 3] as [number, number, number] };
  let fieldChange = 0, work = 0, flux = 0;
  for (let n = 0; n < steps; n++) {
    const balance = measureFieldBalance(solver.core, volume, () => solver.step());
    fieldChange += balance.change; work += balance.matterWork; flux += balance.boundaryEnergy;
  }
  const d = solver.diagnostics() as Record<string, number>;
  const residual = fieldChange + d.sourceParticleKinetic + flux;
  expect(Math.abs(fieldChange + work + flux) / Math.abs(work)).toBeLessThan(1e-9);
  expect(Math.abs(d.sourceParticleWork - work) / Math.abs(work)).toBeLessThan(1e-10);
  expect(solver.time).toBeCloseTo(time, 23);
  return { relative: Math.abs(residual / work), residual };
}

it('refines a fixed physical cloud energy budget in an asymmetric interacting pair', () => {
  // Asymmetry avoids a trivially cancelling mechanical momentum pair. This
  // checks energy only: a full momentum/stress and passive-matter audit remains.
  const errors = [16, 24, 32].map(n => measure(n as 16 | 24 | 32).relative);
  expect(errors[0]).toBeLessThan(0.002);
  expect(errors[1]).toBeLessThan(errors[0] * 0.7);
  expect(errors[2]).toBeLessThan(errors[1] * 0.7);
});

it('reduces coupled energy error quadratically with dt at fixed mesh and shape', () => {
  const errors = [1, 2, 4].map(factor => measure(32, factor).relative);
  expect(errors[0] / errors[1]).toBeGreaterThan(3.5);
  expect(errors[1] / errors[2]).toBeGreaterThan(3.5);
  expect(errors[2]).toBeLessThan(3e-5);
});
