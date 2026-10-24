import { describe, expect, it } from 'vitest';
import { initializeElectric } from '../../src/engine/maxwell/initialization';
import { YeeSolver } from '../../src/engine/maxwell/yee';
import { depositCharge } from '../../src/engine/maxwell/deposition';

describe('compatible electrostatic preparation', () => {
  it('keeps an off-center static charge stationary across a PML storage seam', () => {
    const n = 14, h = 0.02;
    const s = new YeeSolver({ nx: n, ny: n, nz: n, dx: h, dy: h, dz: h, boundary: { x: 'pml', y: 'pml', z: 'pml' }, pmlCells: 3 });
    const fixed = new Uint8Array(n ** 3), phi = new Float64Array(n ** 3);
    const chargePosition = [0.13, 0.11, 0.15] as const;
    depositCharge(s.rho, s, chargePosition, 1e-12);
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = s.index(x, y, z);
      if (x === 0 || y === 0 || z === 0 || x === n - 1 || y === n - 1 || z === n - 1) {
        fixed[i] = 1;
        phi[i] = 0.00898755179 / Math.hypot(x * h - chargePosition[0], y * h - chargePosition[1], z * h - chargePosition[2]);
      }
    }
    initializeElectric(s, fixed, phi); s.captureStaticBackground();
    const initial = s.snapshot(); s.step(100);
    expect(Math.max(...s.Bx.map(Math.abs), ...s.By.map(Math.abs), ...s.Bz.map(Math.abs))).toBeLessThan(1e-20);
    expect(Math.max(...s.Ex.map((v, i) => Math.abs(v - initial.Ex[i])))).toBeLessThan(1e-10);
    expect(s.diagnostics().divergenceE).toBeLessThan(1e-23);
  });
});
