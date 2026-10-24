import { expect, it } from 'vitest';
import { MaxwellSceneSolver } from '../../src/engine/maxwell/sceneSolver';
import { makeConductor, makeScene } from '../../src/scene/defaults';
import { C_LIGHT } from '../../src/engine/constants';

function movingCapacitor(resolution: number, domainLength = 1) {
  const speed = 0.001 * C_LIGHT, ramp = 1e-9;
  const keyframes = Array.from({ length: 101 }, (_, n) => {
    const time = n * ramp / 100;
    return { time, position: [0, speed / 2 * (time - ramp / Math.PI * Math.sin(Math.PI * time / ramp)), 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] };
  });
  keyframes.push({ time: 1e-7, position: [0, speed * (1e-7 - ramp / 2), 0], rotation: [0, 0, 0] });
  const a = makeConductor([-0.1875, 0, 0], 'box', [0.125, 0.45, 0.5]), b = makeConductor([0.1875, 0, 0], 'box', [0.125, 0.45, 0.5]);
  a.potential = 3; b.potential = -3;
  a.motion = b.motion = { kind: 'keyframes', keyframes, loop: false };
  const scene = makeScene({ name: 'continuous moving capacitor', objects: [a, b] });
  scene.domain.size = [domainLength, domainLength, domainLength];
  // Keep h and physical PML thickness controlled independently of box size.
  Object.assign(scene.simulation, { resolution, pmlCells: Math.round(3 * resolution / (16 * domainLength)), useApproximation: false, maxwellConductorModel: 'isolated' });
  const solver = new MaxwellSceneSolver(scene);
  solver.step(Math.round(4e-9 / solver.core.dt));
  const field = solver.sample([0, 0, 0]), reference = -speed * field.E[0] / C_LIGHT ** 2;
  return { solver, error: Math.abs(field.B[2] / reference - 1), resolution, domainLength, E: field.E, B: field.B, time: solver.time };
}

it('converges the moving-capacitor magnetic relation with fixed physical absorbing-layer thickness', () => {
  const results = [16, 32, 64].map(resolution => movingCapacitor(resolution));
  console.log('Moving capacitor', JSON.stringify(results.map(({ solver, ...result }) => ({ ...result, gauss: solver.diagnostics().gaussRelative }))));
  results.forEach(result => expect(result.solver.diagnostics().gaussRelative).toBeLessThan(1e-8));
  expect(results[0].error).toBeLessThan(0.02);
  expect(results[1].error).toBeLessThan(0.01);
  expect(results[2].error).toBeLessThan(0.005);
  expect(results[2].error).toBeLessThan(results[0].error / 3);
  const larger = movingCapacitor(24, 1.5);
  console.log('Larger capacitor domain', JSON.stringify({ error: larger.error, E: larger.E, B: larger.B, time: larger.time }));
  expect(larger.solver.core.dx).toBe(results[0].solver.core.dx);
  expect(larger.error).toBeLessThan(results[0].error);
  // Regression at a later time: the old binary material lost 39% here.
  const solver = results[0].solver; solver.step(Math.round(6e-9 / solver.core.dt) - solver.steps);
  const field = solver.sample([0, 0, 0]);
  expect(Math.abs(field.B[2] / (-0.001 * field.E[0] / C_LIGHT) - 1)).toBeLessThan(0.02);
}, 240000);
