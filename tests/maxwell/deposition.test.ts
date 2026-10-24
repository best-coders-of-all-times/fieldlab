import { describe, expect, it } from 'vitest';
import { depositCharge, depositTrajectory, trajectoryFieldIntegral, trajectoryWeights, type DepositionGrid, type DepositBoundary, type DepositVector } from '../../src/engine/maxwell/deposition';

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

describe('adjoint electric trajectory line integral', () => {
  it('gathers a literal aligned edge voltage and exposes its geometric weight', () => {
    const ex = new Float64Array(size), ey = new Float64Array(size), ez = new Float64Array(size);
    ex[index(1, 1, 1)] = 7;
    const a: DepositVector = [0.2, 0.3, 0.4], b: DepositVector = [0.4, 0.3, 0.4];
    expect(trajectoryFieldIntegral(ex, ey, ez, grid, a, b)).toBeCloseTo(1.4, 14);
    expect(trajectoryWeights(grid, a, b)).toEqual([{ axis: 0, index: index(1, 1, 1), length: 0.2 }]);
    expect(trajectoryWeights(grid, a, a)).toEqual([]);
  });

  it('pairs field work with independently deposited diagonal and periodic trajectory current', () => {
    const fields = [0.3, 0.7, 1.1].map(phase => Float64Array.from({ length: size }, (_, i) => Math.sin(i * phase) + Math.cos(i * 0.31)));
    const paths: [DepositVector, DepositVector, DepositBoundary][] = [
      [[0.07, 0.11, 0.13], [1.28, 1.49, 1.76], 'closed'],
      [[1.28, 1.49, 1.76], [0.07, 0.11, 0.13], 'closed'],
      [[1.55, 1.96, 2.31], [1.89, 2.32, 2.63], 'periodic'],
      [[0.11, 0.12, 0.13], [3.4, -2.24, 5.01], 'periodic'],
    ];
    for (const [a, b, boundary] of paths) {
      const j = [new Float64Array(size), new Float64Array(size), new Float64Array(size)], q = -1.7, dt = 0.13;
      depositTrajectory(j[0], j[1], j[2], grid, a, b, q, dt, boundary);
      let edgePower = 0;
      for (let axis = 0; axis < 3; axis++) for (let i = 0; i < size; i++) edgePower += fields[axis][i] * j[axis][i];
      const integral = trajectoryFieldIntegral(fields[0], fields[1], fields[2], grid, a, b, boundary);
      expect(Math.abs(integral - edgePower * dt * vol / q)).toBeLessThan(2e-14);
      const weights = trajectoryWeights(grid, a, b, boundary);
      const fromWeights = weights.reduce((sum, w) => sum + fields[w.axis][w.index] * w.length, 0);
      expect(Math.abs(integral - fromWeights)).toBeLessThan(2e-14);
    }
  });

  it('equals the CIC potential drop for an arbitrary compatible discrete gradient', () => {
    const phi = Float64Array.from({ length: size }, (_, i) => Math.sin(i * 0.73) + 0.3 * Math.cos(i * 1.13));
    for (const boundary of ['closed', 'periodic'] as const) {
      const fields = [new Float64Array(size), new Float64Array(size), new Float64Array(size)], shape = [grid.nx, grid.ny, grid.nz], h = [grid.dx, grid.dy, grid.dz];
      for (let k = 0; k < grid.nz; k++) for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) {
        const c = index(i, j, k);
        for (let axis = 0; axis < 3; axis++) {
          const p = [i, j, k]; p[axis]++;
          if (p[axis] === shape[axis]) { if (boundary === 'closed') continue; p[axis] = 0; }
          fields[axis][c] = (phi[c] - phi[index(p[0], p[1], p[2])]) / h[axis];
        }
      }
      const sample = (p: DepositVector) => {
        const normalized = p.map((v, axis) => v / h[axis]), base = normalized.map(Math.floor), fraction = normalized.map((v, axis) => v - base[axis]);
        let value = 0;
        for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
          const weight = (i ? fraction[0] : 1 - fraction[0]) * (j ? fraction[1] : 1 - fraction[1]) * (k ? fraction[2] : 1 - fraction[2]);
          if (weight === 0) continue;
          const node = [base[0] + i, base[1] + j, base[2] + k].map((v, axis) => (v % shape[axis] + shape[axis]) % shape[axis]);
          value += weight * phi[index(node[0], node[1], node[2])];
        }
        return value;
      };
      const a: DepositVector = [0.071, 0.113, 0.137], b: DepositVector = boundary === 'closed' ? [1.283, 1.497, 1.763] : [3.417, -2.243, 5.019];
      const work = trajectoryFieldIntegral(fields[0], fields[1], fields[2], grid, a, b, boundary);
      expect(Math.abs(work - (sample(a) - sample(b)))).toBeLessThan(2e-14);
      const reversed = trajectoryFieldIntegral(fields[0], fields[1], fields[2], grid, b, a, boundary);
      expect(Math.abs(work + reversed)).toBeLessThan(2e-14);
    }
  });

  it('validates closed endpoints, field sizes and finite contributing fields', () => {
    const field = new Float64Array(size);
    expect(() => trajectoryWeights(grid, [0.1, 0.2, 0.3], [-0.1, 0.2, 0.3])).toThrow(/domain|boundary/i);
    expect(() => trajectoryFieldIntegral(new Float64Array(1), field, field, grid, [0.2, 0.3, 0.4], [0.4, 0.3, 0.4])).toThrow(/size/i);
    field[index(1, 1, 1)] = NaN;
    expect(() => trajectoryFieldIntegral(field, field, field, grid, [0.2, 0.3, 0.4], [0.4, 0.3, 0.4])).toThrow(/finite/i);
  });
});
