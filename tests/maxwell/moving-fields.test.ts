import { expect, it } from 'vitest';
import { MaxwellSceneSolver } from '../../src/engine/maxwell/sceneSolver';
import { makeCharge, makeScene } from '../../src/scene/defaults';
import { C_LIGHT, K_E } from '../../src/engine/constants';
import { cross } from '../../src/engine/maxwell/sampling';
import type { Vec3 } from '../../src/engine/math/vec3';

it('converges to the constant-velocity charge field after the causal startup pulse', () => {
  const results = [16, 32, 64].map(resolution => {
    const charge = makeCharge([0, 0, 0], 1e-10), v = 0.01 * C_LIGHT;
    const ramp = 1e-9;
    const keyframes = Array.from({ length: 101 }, (_, n) => {
      const time = ramp * n / 100;
      return { time, position: [v / 2 * (time - ramp / Math.PI * Math.sin(Math.PI * time / ramp)), 0, 0] as Vec3, rotation: [0, 0, 0] as Vec3 };
    });
    keyframes.push({ time: 1e-7, position: [v * (1e-7 - ramp / 2), 0, 0], rotation: [0, 0, 0] });
    charge.motion = { kind: 'keyframes', loop: false, keyframes };
    const scene = makeScene({ name: 'uniform velocity', objects: [charge] });
    scene.simulation.resolution = resolution as never; scene.simulation.useApproximation = false; scene.simulation.pmlCells = 8;
    const solver = new MaxwellSceneSolver(scene);
    solver.step(Math.round(4e-9 / solver.core.dt));
    const r: Vec3 = [-v * (solver.time - ramp / 2), 0.25, 0], beta: Vec3 = [v / C_LIGHT, 0, 0];
    const crossBeta = cross(beta, r), r2 = r.reduce((sum, x) => sum + x * x, 0);
    const factor = K_E * charge.charge * (1 - beta[0] ** 2) / (r2 - crossBeta.reduce((sum, x) => sum + x * x, 0)) ** 1.5;
    const E = r.map(x => factor * x) as Vec3, B = cross([v, 0, 0], E).map(x => x / C_LIGHT ** 2);
    const actual = solver.sample([0, 0.25, 0]);
    return { resolution, time: solver.time, relativeB: Math.hypot(...actual.B.map((x, a) => x - B[a])) / Math.hypot(...B),
      relativeE: Math.hypot(...actual.E.map((x, a) => x - E[a])) / Math.hypot(...E), gauss: solver.diagnostics().gaussRelative };
  });
  console.info('Uniform-velocity charge benchmark', JSON.stringify(results));
  expect(results[2].relativeB).toBeLessThan(0.03);
  expect(results[2].relativeB).toBeLessThan(results[1].relativeB / 2);
  expect(results[2].relativeE).toBeLessThan(0.03);
  expect(results[1].gauss).toBeLessThan(1e-5);
}, 60_000);
