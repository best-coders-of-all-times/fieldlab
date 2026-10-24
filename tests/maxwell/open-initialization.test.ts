import { expect, it } from 'vitest';
import { YeeSolver, EPSILON_0 } from '../../src/engine/maxwell/yee';
import { createOpenInitializer } from '../../src/engine/maxwell/openInitialization';
import { directCoulombPotentials } from '../../src/engine/maxwell/coulombBoundary';
import type { Vec3 } from '../../src/engine/math/vec3';

it('sets a free-charge open boundary from its actual deposited charge shape', () => {
  const n = 13, h = 0.1, s = new YeeSolver({ nx: n, ny: n, nz: n, dx: h, dy: h, dz: h, boundary: { x: 'pml', y: 'pml', z: 'pml' }, pmlCells: 2 });
  const fixed = new Uint8Array(n ** 3), potential = new Float64Array(n ** 3), rho = new Float64Array(n ** 3);
  const source = s.index(7, 6, 5); rho[source] = 1e-10 / h ** 3;
  const initialize = createOpenInitializer(s, fixed, [source], [0, 0, 0]);
  const result = initialize(rho, potential, [0, 0, 0]);
  const boundary = s.index(0, 6, 6), target: Vec3 = [0, 0.6, 0.6];
  const expected = directCoulombPotentials([[0.7, 0.6, 0.5]], new Float64Array([1e-10]), [target])[0];
  expect(potential[boundary]).toBeCloseTo(expected, 10);
  expect(result.boundaryResidual).toBe(0);
  expect(s.diagnostics().divergenceE).toBeLessThan(1e-15);
});

it('includes induced electrode charge in a self-consistent open boundary', () => {
  const n = 17, h = 0.0625, s = new YeeSolver({ nx: n, ny: n, nz: n, dx: h, dy: h, dz: h, boundary: { x: 'pml', y: 'pml', z: 'pml' }, pmlCells: 2 });
  const fixed = new Uint8Array(n ** 3), potential = new Float64Array(n ** 3), rho = new Float64Array(n ** 3), support: number[] = [];
  for (let k = 6; k <= 10; k++) for (let j = 6; j <= 10; j++) for (const i of [6, 10]) {
    const c = s.index(i, j, k); fixed[c] = 1; potential[c] = i === 6 ? 3 : -3; support.push(c);
  }
  const initialize = createOpenInitializer(s, fixed, support, [0, 0, 0]);
  const result = initialize(rho, potential, [0, 0, 0]);
  const points: Vec3[] = support.map(c => [(c % n) * h, (Math.floor(c / n) % n) * h, Math.floor(c / n ** 2) * h]);
  const charges = Float64Array.from(support, c => s.rho[c] * h ** 3);
  const target: Vec3 = [0, 0.5, 0.5], expected = directCoulombPotentials(points, charges, [target])[0];
  expect(expected).toBeGreaterThan(0.2);
  expect(Math.abs(potential[s.index(0, 8, 8)] - expected) / expected).toBeLessThan(2e-5);
  expect(result.boundaryResidual).toBeLessThan(1e-7);
  expect(s.diagnostics().divergenceE / EPSILON_0).toBeLessThan(1e-4);
});
