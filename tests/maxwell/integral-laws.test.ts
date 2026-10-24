import { describe, expect, it } from 'vitest';
import { YeeSolver, EPSILON_0, MU_0, LIGHT_SPEED } from '../../src/engine/maxwell/yee';

function initializedGrid() {
  const s = new YeeSolver({ nx: 12, ny: 13, nz: 14, dx: 0.02, dy: 0.03, dz: 0.04,
    boundary: { x: 'periodic', y: 'periodic', z: 'periodic' }, cfl: 0.8 });
  for (let k = 0; k < s.nz; k++) for (let j = 0; j < s.ny; j++) for (let i = 0; i < s.nx; i++) {
    const n = s.index(i, j, k);
    s.Ex[n] = Math.sin(0.4 * j + 0.2 * k); s.Ey[n] = Math.cos(0.3 * i + 0.6 * k); s.Ez[n] = Math.sin(0.5 * i + 0.7 * j);
    s.Bx[n] = Math.cos(0.2 * j - 0.4 * k) / LIGHT_SPEED;
    s.By[n] = Math.sin(0.7 * i + 0.5 * k) / LIGHT_SPEED;
    s.Bz[n] = Math.cos(0.6 * i - 0.3 * j) / LIGHT_SPEED;
    s.epsX[n] = 1.5 + 0.2 * Math.sin(i + j); s.muY[n] = 1.3 + 0.1 * Math.cos(j); s.muZ[n] = 1.2 + 0.1 * Math.sin(k);
    s.Jx[n] = 0.003 * Math.cos(0.3 * j + 0.7 * k);
    s.sigmaX[n] = 0.002 * (1 + 0.2 * Math.sin(i + k));
  }
  s.validateMaterials();
  return s;
}

describe('Maxwell integral laws on finite surfaces', () => {
  it('changes magnetic flux by the oriented electric circulation around the boundary', () => {
    const s = initializedGrid(), x0 = 2, x1 = 7, y0 = 3, y1 = 8, z = 5;
    let before = 0, circulation = 0;
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) before += s.Bz[s.index(i, j, z)] * s.dx * s.dy;
    for (let i = x0; i <= x1; i++) circulation += (s.Ex[s.index(i, y0, z)] - s.Ex[s.index(i, y1 + 1, z)]) * s.dx;
    for (let j = y0; j <= y1; j++) circulation += (s.Ey[s.index(x1 + 1, j, z)] - s.Ey[s.index(x0, j, z)]) * s.dy;
    s.step();
    let after = 0;
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) after += s.Bz[s.index(i, j, z)] * s.dx * s.dy;
    const rate = (after - before) / s.dt;
    expect(Math.abs(rate + circulation) / Math.max(Math.abs(rate), Math.abs(circulation))).toBeLessThan(1e-12);
  });

  it('balances displacement flux, impressed and Ohmic current against magnetic circulation', () => {
    const s = initializedGrid(), x = 5, y0 = 2, y1 = 7, z0 = 3, z1 = 8, oldE = s.Ex.slice();
    s.step();
    let displacementRate = 0, currentFlux = 0, circulation = 0;
    for (let k = z0; k <= z1; k++) for (let j = y0; j <= y1; j++) {
      const n = s.index(x, j, k), area = s.dy * s.dz;
      displacementRate += EPSILON_0 * s.epsX[n] * (s.Ex[n] - oldE[n]) / s.dt * area;
      currentFlux += (s.Jx[n] + s.sigmaX[n] * (s.Ex[n] + oldE[n]) / 2) * area;
    }
    const hz = (j: number, k: number) => { const n = s.index(x, j, k); return s.Bz[n] / (MU_0 * s.muZ[n]); };
    const hy = (j: number, k: number) => { const n = s.index(x, j, k); return s.By[n] / (MU_0 * s.muY[n]); };
    for (let k = z0; k <= z1; k++) circulation += (hz(y1, k) - hz(y0 - 1, k)) * s.dz;
    for (let j = y0; j <= y1; j++) circulation += (hy(j, z0 - 1) - hy(j, z1)) * s.dy;
    const scale = Math.abs(displacementRate) + Math.abs(currentFlux) + Math.abs(circulation);
    expect(Math.abs(displacementRate + currentFlux - circulation) / scale).toBeLessThan(1e-12);
  });
});
