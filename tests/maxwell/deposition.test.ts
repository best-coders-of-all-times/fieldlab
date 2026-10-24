import { describe, expect, it } from 'vitest';
import { depositCharge, depositTrajectory, type DepositionGrid, type DepositBoundary } from '../../src/engine/maxwell/deposition';

const grid: DepositionGrid = { nx: 8, ny: 7, nz: 6, dx: 0.2, dy: 0.3, dz: 0.4 };
const size = grid.nx * grid.ny * grid.nz;
const index = (i: number, j: number, k: number) => i + grid.nx * (j + grid.ny * k);
const vol = grid.dx * grid.dy * grid.dz;

function continuity(a: [number, number, number], b: [number, number, number], boundary: DepositBoundary = 'closed') {
  const old = new Float64Array(size), next = new Float64Array(size);
  const jx = new Float64Array(size), jy = new Float64Array(size), jz = new Float64Array(size);
  const q = -1.7, dt = 0.13;
  depositCharge(old, grid, a, q, boundary);
  depositCharge(next, grid, b, q, boundary);
  depositTrajectory(jx, jy, jz, grid, a, b, q, dt, boundary);
  let residual = 0;
  for (let k = 0; k < grid.nz; k++) for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) {
    const c = index(i, j, k);
    const jm = (arr: Float64Array, axis: number) => {
      const p = [i, j, k], n = [grid.nx, grid.ny, grid.nz];
      p[axis]--;
      if (p[axis] < 0) { if (boundary !== 'periodic') return 0; p[axis] += n[axis]; }
      return arr[index(p[0], p[1], p[2])];
    };
    const div = (jx[c] - jm(jx, 0)) / grid.dx + (jy[c] - jm(jy, 1)) / grid.dy + (jz[c] - jm(jz, 2)) / grid.dz;
    residual = Math.max(residual, Math.abs(next[c] - old[c] + dt * div) * vol / Math.abs(q));
  }
  expect(residual).toBeLessThan(2e-14);
  expect(old.reduce((s, v) => s + v, 0) * vol).toBeCloseTo(q, 13);
  expect(next.reduce((s, v) => s + v, 0) * vol).toBeCloseTo(q, 13);
}

describe('charge conserving CIC trajectory deposition', () => {
  it('deposits a literal edge move with SI current density and no transverse current', () => {
    const rho = new Float64Array(size), jx = new Float64Array(size), jy = new Float64Array(size), jz = new Float64Array(size);
    depositCharge(rho, grid, [0.2, 0.3, 0.4], 2);
    expect(rho[index(1, 1, 1)]).toBeCloseTo(2 / vol, 12);
    depositTrajectory(jx, jy, jz, grid, [0.2, 0.3, 0.4], [0.4, 0.3, 0.4], 2, 0.5);
    expect(jx[index(1, 1, 1)]).toBeCloseTo(2 / (0.5 * grid.dy * grid.dz), 12);
    expect(jx.reduce((a, b) => a + b, 0)).toBeCloseTo(jx[index(1, 1, 1)], 12);
    expect(jy.every(v => v === 0) && jz.every(v => v === 0)).toBe(true);
  });
  it('preserves continuity for diagonal multi-cell trajectories and their reversals', () => {
    continuity([0.07, 0.11, 0.13], [1.28, 1.49, 1.76]);
    continuity([1.28, 1.49, 1.76], [0.07, 0.11, 0.13]);
    continuity([0.2, 0.6, 0.4], [1.4, 1.8, 2]);
  });
  it('preserves charge through periodic seam and multiple box crossings using unwrapped endpoints', () => {
    continuity([1.55, 1.96, 2.31], [1.89, 2.32, 2.63], 'periodic');
    continuity([0.11, 0.12, 0.13], [3.4, -2.24, 5.01], 'periodic');
  });
  it('satisfies nodal continuity for reproducible off-grid multi-axis paths', () => {
    // This covers unlike cell widths and positions away from special rational weights.
    let seed = 1729;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    const point = (): [number, number, number] => [random() * 1.4, random() * 1.8, random() * 2];
    for (let n = 0; n < 40; n++) continuity(point(), point());
  });
  it('leaves zero current for stationary particles', () => {
    const jx = new Float64Array(size), jy = new Float64Array(size), jz = new Float64Array(size);
    depositTrajectory(jx, jy, jz, grid, [0.31, 0.44, 0.57], [0.31, 0.44, 0.57], 3, 0.1);
    expect([...jx, ...jy, ...jz].every(v => v === 0)).toBe(true);
  });
  it('rejects boundary exit and invalid input before changing deposited arrays', () => {
    const jx = new Float64Array(size), jy = new Float64Array(size), jz = new Float64Array(size);
    expect(() => depositTrajectory(jx, jy, jz, grid, [0.1, 0.2, 0.3], [-0.1, 0.2, 0.3], 1, 1)).toThrow(/domain|boundary/i);
    expect([...jx, ...jy, ...jz].every(v => v === 0)).toBe(true);
    expect(() => depositCharge(jx, grid, [0.1, 0.2, 0.3], NaN)).toThrow(/finite/i);
    expect(() => depositTrajectory(jx, jy, jz, grid, [0.1, 0.2, 0.3], [0.1, 0.2, 0.3], 1, 0)).toThrow(/dt|time/i);
  });
});
