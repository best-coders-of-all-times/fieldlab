import { expect, it } from 'vitest';
import { EPSILON_0, LIGHT_SPEED, YeeSolver } from '../../src/engine/maxwell/yee';
import { smoothChargeWeights } from '../../src/engine/maxwell/smoothCharge';

it('cancels convection and displacement current for normally moving infinite charge sheets', () => {
  // A reduced-dimensional Maxwell reference, not a finite-conductor model.
  // Uniform periodic transverse directions represent infinite planes.
  const g = new YeeSolver({ nx: 65, ny: 5, nz: 5, dx: 1 / 64, dy: 0.25, dz: 0.25, cfl: 0.7,
    boundary: { x: 'pec', y: 'periodic', z: 'periodic' } });
  const sigma = 1e-9, width = 0.025, speed = 0.01 * LIGHT_SPEED;
  const sheets = (time: number) => {
    const left = smoothChargeWeights(g, [0.3 - speed * time, 0.5, 0.5], width).x;
    const right = smoothChargeWeights(g, [0.7 + speed * time, 0.5, 0.5], width).x;
    return left.map((v, i) => sigma * (v - right[i])); // charge per unit area per node
  };
  const electric = (charge: Float64Array) => {
    let prefix = 0;
    return charge.map(q => (prefix += q) / EPSILON_0);
  };
  let charge = sheets(0), initialE = electric(charge), maximumElectricChange = 0;
  for (let k = 0; k < g.nz; k++) for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    g.rho[g.index(i, j, k)] = charge[i] / g.dx;
    g.Ex[g.index(i, j, k)] = initialE[i];
  }
  for (let step = 0; step < 20; step++) {
    const next = sheets((step + 1) * g.dt), expectedE = electric(next), oldE = charge.map((_, i) => g.Ex[g.index(i, 0, 0)]);
    let cumulativeDifference = 0;
    const current = charge.map((q, i) => (cumulativeDifference += q - next[i]) / g.dt);
    for (let k = 0; k < g.nz; k++) for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) g.Jx[g.index(i, j, k)] = current[i];
    g.step();
    let energyChange = 0, currentWork = 0;
    for (let i = 0; i < g.nx; i++) {
      const n = g.index(i, 0, 0), actual = g.Ex[n];
      expect(Math.abs(actual - expectedE[i]) / (sigma / EPSILON_0)).toBeLessThan(2e-14);
      expect(Math.abs(g.rho[n] - next[i] / g.dx) / (sigma / width)).toBeLessThan(2e-14);
      const displacement = EPSILON_0 * (actual - oldE[i]) / g.dt;
      expect(Math.abs(current[i] + displacement) / (sigma * speed / width)).toBeLessThan(2e-13);
      energyChange += EPSILON_0 * g.dx / 2 * (actual - oldE[i]) * (actual + oldE[i]);
      currentWork += g.dt * g.dx * current[i] * (actual + oldE[i]) / 2;
      maximumElectricChange = Math.max(maximumElectricChange, Math.abs(actual - initialE[i]));
    }
    expect(energyChange).toBeGreaterThan(0);
    expect(Math.abs(energyChange + currentWork) / Math.abs(currentWork)).toBeLessThan(2e-12);
    // Changing E alone does not imply nonzero B: J + dD/dt cancels here.
    for (const B of [g.Bx, g.By, g.Bz]) expect(B.every(value => value === 0)).toBe(true);
    charge = next;
  }
  expect(maximumElectricChange).toBeGreaterThan(1);
});
