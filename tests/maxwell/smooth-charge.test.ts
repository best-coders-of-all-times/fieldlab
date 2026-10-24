import { describe, expect, it } from 'vitest';
import { depositSmoothCharge, depositSmoothTrajectory, gatherSmoothElectric, smoothChargeWeights, smoothTrajectoryWeights } from '../../src/engine/maxwell/smoothCharge';
import type { DepositionGrid, DepositVector } from '../../src/engine/maxwell/deposition';

const grid: DepositionGrid = { nx: 13, ny: 11, nz: 9, dx: 0.2, dy: 0.3, dz: 0.4 };
const count = grid.nx * grid.ny * grid.nz;
const volume = grid.dx * grid.dy * grid.dz;
const index = (i: number, j: number, k: number) => i + grid.nx * (j + grid.ny * k);
const sum = (a: Float64Array) => a.reduce((s, x) => s + x, 0);
const beta = (u: number) => Math.abs(u) < 1 ? 2 / 3 - u * u + Math.abs(u) ** 3 / 2 : Math.abs(u) < 2 ? (2 - Math.abs(u)) ** 3 / 6 : 0;

// Independent Gauss-Legendre integration of the defining density × CIC tent.
function referenceWeight(node: number, center: number, width: number, h: number) {
  const cuts = [-2, -1, 0, 1, 2, (node - h - center) / width, (node - center) / width, (node + h - center) / width]
    .filter(u => u >= -2 && u <= 2).sort((a, b) => a - b);
  const abscissa = [0, -0.5384693101056831, 0.5384693101056831, -0.906179845938664, 0.906179845938664];
  const weight = [0.5688888888888889, 0.4786286704993665, 0.4786286704993665, 0.2369268850561891, 0.2369268850561891];
  let result = 0;
  for (let n = 1; n < cuts.length; n++) {
    const midpoint = (cuts[n] + cuts[n - 1]) / 2, half = (cuts[n] - cuts[n - 1]) / 2;
    for (let p = 0; p < weight.length; p++) {
      const u = midpoint + half * abscissa[p];
      result += half * weight[p] * beta(u) * Math.max(0, 1 - Math.abs(center + width * u - node) / h);
    }
  }
  return result;
}

describe('analytic finite smooth charge cloud', () => {
  it('partitions charge with positive compact weights and zero-sum center derivatives', () => {
    for (const width of [1e-7, 0.017, 0.12, 0.31]) {
      const center: DepositVector = [1.073, 1.317, 1.681];
      const w = smoothChargeWeights(grid, center, width);
      for (const [axis, values, derivative, h] of [[0, w.x, w.dx, grid.dx], [1, w.y, w.dy, grid.dy], [2, w.z, w.dz, grid.dz]] as const) {
        expect(Math.abs(sum(values) - 1)).toBeLessThan(8e-16);
        expect(Math.abs(sum(derivative)) * h).toBeLessThan(2e-15);
        for (let i = 0; i < values.length; i++) {
          expect(values[i]).toBeGreaterThanOrEqual(0);
          if (Math.abs(i * h - center[axis]) >= 2 * width + h) expect(values[i]).toBe(0);
        }
      }
    }
  });

  it('matches independent high-accuracy density integration across phases, widths and unequal spacings', () => {
    for (const width of [0.003, 0.043, 0.19, 0.37]) for (const phase of [0, 0.001, 0.23, 0.5, 0.999]) {
      const center: DepositVector = [1 + phase * grid.dx, 1.2 + phase * grid.dy, 1.6 + phase * grid.dz];
      const w = smoothChargeWeights(grid, center, width);
      for (const [values, h, c] of [[w.x, grid.dx, center[0]], [w.y, grid.dy, center[1]], [w.z, grid.dz, center[2]]] as const) {
        for (let i = 0; i < values.length; i++) expect(Math.abs(values[i] - referenceWeight(i * h, c, width, h))).toBeLessThan(7e-15);
      }
    }
  });

  it('differentiates the translated assignment continuously through node and spline-knot phases', () => {
    const width = 0.13, delta = 2e-6;
    for (const x of [1 - width, 1 - 1e-9, 1, 1 + 1e-9, 1 + width, 1.071]) {
      const w = smoothChargeWeights(grid, [x, 1.3, 1.7], width);
      const a = smoothChargeWeights(grid, [x - delta, 1.3, 1.7], width);
      const b = smoothChargeWeights(grid, [x + delta, 1.3, 1.7], width);
      for (let i = 0; i < grid.nx; i++) expect(Math.abs(w.dx[i] - (b.x[i] - a.x[i]) / (2 * delta))).toBeLessThan(2e-9);
    }
  });

  it('retains positive physical tails when a spline endpoint almost touches a neighboring tent', () => {
    // The last integration interval's midpoint rounds to the spline endpoint.
    // Nevertheless its exact integral is positive and representable in Float64.
    const width = 0.0007290400972053463, h = 0.0009720534629404617, center = 0.001458080194410693;
    const w = smoothChargeWeights({ ...grid, dx: h, dy: h, dz: h }, [center, center, center], width);
    expect(w.x[4]).toBeGreaterThan(0);
    expect(w.x[5]).toBe(0);
  });

  it('accepts exact closed support endpoints and rejects clipped or unresolved clouds atomically', () => {
    expect(() => smoothChargeWeights(grid, [0.4, 0.4, 0.4], 0.2)).not.toThrow();
    for (const width of [0, -1, NaN, Infinity, Number.MIN_VALUE]) expect(() => smoothChargeWeights(grid, [1, 1, 1], width)).toThrow();
    expect(() => smoothChargeWeights(grid, [0.399, 1, 1], 0.2)).toThrow(/support|domain|boundary/i);
    expect(() => smoothChargeWeights(grid, [NaN, 1, 1], 0.1)).toThrow(/finite/i);
    const rho = new Float64Array(count), j = [new Float64Array(count), new Float64Array(count), new Float64Array(count)];
    expect(() => depositSmoothCharge(rho, grid, [0.1, 1, 1], 0.2, 1)).toThrow();
    expect(() => depositSmoothTrajectory(j[0], j[1], j[2], grid, [1, 1, 1], [0.1, 1, 1], 0.2, 1, 1)).toThrow();
    expect(rho.every(v => v === 0) && j.every(a => a.every(v => v === 0))).toBe(true);
    expect(() => smoothChargeWeights({ ...grid, nx: 1000000000 }, [1, 1, 1], 0.1)).toThrow(/budget|limit|size/i);
  });
});

describe('smooth endpoint current and native-edge work', () => {
  it('closes nodal charge continuity to Float64 roundoff for stationary, diagonal and multicell motion', () => {
    const a: DepositVector = [0.71, 0.83, 0.97];
    for (const b of [a, [0.73, 0.87, 1.01], [1.73, 2.17, 2.51], [0.4, 0.4, 0.4]] as DepositVector[]) {
      const old = new Float64Array(count), next = new Float64Array(count), j = [new Float64Array(count), new Float64Array(count), new Float64Array(count)];
      const width = 0.2, q = -1.7, dt = 0.13;
      depositSmoothCharge(old, grid, a, width, q); depositSmoothCharge(next, grid, b, width, q);
      depositSmoothTrajectory(j[0], j[1], j[2], grid, a, b, width, q, dt);
      let residual = 0;
      for (let k = 0; k < grid.nz; k++) for (let y = 0; y < grid.ny; y++) for (let x = 0; x < grid.nx; x++) {
        const c = index(x, y, k);
        const divergence = (j[0][c] - (x ? j[0][c - 1] : 0)) / grid.dx + (j[1][c] - (y ? j[1][c - grid.nx] : 0)) / grid.dy + (j[2][c] - (k ? j[2][c - grid.nx * grid.ny] : 0)) / grid.dz;
        residual = Math.max(residual, Math.abs(next[c] - old[c] + dt * divergence) * volume / Math.abs(q));
      }
      expect(residual).toBeLessThan(2e-15);
      expect(Math.abs(sum(old) * volume - q)).toBeLessThan(3e-15);
      expect(Math.abs(sum(next) * volume - q)).toBeLessThan(3e-15);
      if (a === b) expect(j.every(arr => arr.every(v => v === 0))).toBe(true);
    }
  });

  it('pairs line weights with deposited electric work and compatible potential drop', () => {
    const phi = Float64Array.from({ length: count }, (_, i) => Math.sin(i * 0.71) + 0.13 * Math.cos(i * 0.31));
    const fields = [new Float64Array(count), new Float64Array(count), new Float64Array(count)];
    for (let k = 0; k < grid.nz; k++) for (let y = 0; y < grid.ny; y++) for (let x = 0; x < grid.nx; x++) {
      const c = index(x, y, k);
      if (x + 1 < grid.nx) fields[0][c] = (phi[c] - phi[c + 1]) / grid.dx;
      if (y + 1 < grid.ny) fields[1][c] = (phi[c] - phi[c + grid.nx]) / grid.dy;
      if (k + 1 < grid.nz) fields[2][c] = (phi[c] - phi[c + grid.nx * grid.ny]) / grid.dz;
    }
    const a: DepositVector = [0.61, 0.83, 0.97], b: DepositVector = [1.73, 2.17, 2.51], width = 0.2, q = -1.7, dt = 0.13;
    const j = [new Float64Array(count), new Float64Array(count), new Float64Array(count)];
    depositSmoothTrajectory(j[0], j[1], j[2], grid, a, b, width, q, dt);
    const weights = smoothTrajectoryWeights(grid, a, b, width);
    const line = weights.reduce((s, w) => s + fields[w.axis][w.index] * w.length, 0);
    const power = fields.reduce((s, f, axis) => s + f.reduce((t, e, i) => t + e * j[axis][i], 0), 0);
    const potential = (p: DepositVector) => { const rho = new Float64Array(count); depositSmoothCharge(rho, grid, p, width, 1); return rho.reduce((s, v, i) => s + v * phi[i] * volume, 0); };
    expect(Math.abs(q * line - dt * volume * power)).toBeLessThan(4e-15);
    expect(Math.abs(line - potential(a) + potential(b))).toBeLessThan(4e-15);
    expect(smoothTrajectoryWeights(grid, a, a, width)).toEqual([]);
    const reverse = smoothTrajectoryWeights(grid, b, a, width).reduce((s, w) => s + fields[w.axis][w.index] * w.length, 0);
    expect(Math.abs(line + reverse)).toBeLessThan(4e-15);

    const point: DepositVector = [1.071, 1.317, 1.681], field = gatherSmoothElectric(fields[0], fields[1], fields[2], grid, point, width), epsilon = 1e-6;
    for (let axis = 0; axis < 3; axis++) {
      const low = [...point] as [number, number, number], high = [...point] as [number, number, number]; low[axis] -= epsilon; high[axis] += epsilon;
      expect(Math.abs(field[axis] + (potential(high) - potential(low)) / (2 * epsilon))).toBeLessThan(2e-9);
    }
  });

  it('reproduces constant electric fields and validates contributing inputs', () => {
    const field = [1.3, -2.7, 0.9].map(e => new Float32Array(count).fill(e));
    const result = gatherSmoothElectric(field[0], field[1], field[2], grid, [1.071, 1.317, 1.681], 0.21);
    for (let axis = 0; axis < 3; axis++) expect(Math.abs(result[axis] - field[axis][0])).toBeLessThan(2e-14);
    expect(() => gatherSmoothElectric(new Float64Array(1), field[1], field[2], grid, [1, 1, 1], 0.1)).toThrow(/size/i);
    expect(() => depositSmoothTrajectory(field[0], field[1], field[2], grid, [1, 1, 1], [1.1, 1.1, 1.1], 0.1, 1, 0)).toThrow(/dt/i);
    expect(() => depositSmoothCharge(field[0], grid, [1, 1, 1], 0.1, NaN)).toThrow(/finite/i);
    field.forEach(a => a.fill(NaN));
    expect(() => gatherSmoothElectric(field[0], field[1], field[2], grid, [1, 1, 1], 0.1)).toThrow(/finite/i);
  });

  it('retains the gather derivative limit for vanishing motion and exact displacements in uniform fields', () => {
    const center: DepositVector = [1.071, 1.317, 1.681], end: DepositVector = [1.873, 2.171, 2.681], width = 0.21;
    const fields = [0.37, 0.71, 1.13].map(phase => Float64Array.from({ length: count }, (_, i) => Math.sin(i * phase)));
    const gathered = gatherSmoothElectric(fields[0], fields[1], fields[2], grid, center, width);
    for (let axis = 0; axis < 3; axis++) {
      const delta = 1e-6, moved = [...center] as [number, number, number]; moved[axis] += delta;
      const line = smoothTrajectoryWeights(grid, center, moved, width).reduce((s, w) => s + fields[w.axis][w.index] * w.length, 0);
      expect(Math.abs(line / delta - gathered[axis])).toBeLessThan(2e-5);
    }
    const displacement = [0, 0, 0];
    for (const w of smoothTrajectoryWeights(grid, center, end, width)) displacement[w.axis] += w.length;
    for (let axis = 0; axis < 3; axis++) expect(Math.abs(displacement[axis] - end[axis] + center[axis])).toBeLessThan(3e-15);
  });

  it('integrates broad clouds and anisotropic high width-to-spacing ratios without second-difference cancellation', () => {
    const broad = { nx: 128, ny: 9, nz: 7, dx: 0.01, dy: 0.2, dz: 0.3 }, center: DepositVector = [0.635, 0.81, 0.91], width = 0.3;
    const w = smoothChargeWeights(broad, center, width);
    for (let i = 0; i < broad.nx; i++) expect(Math.abs(w.x[i] - referenceWeight(i * broad.dx, center[0], width, broad.dx))).toBeLessThan(5e-15);
    const size = broad.nx * broad.ny * broad.nz, fields = [1.3, -2.7, 0.9].map(e => new Float64Array(size).fill(e));
    const gathered = gatherSmoothElectric(fields[0], fields[1], fields[2], broad, center, width);
    for (let axis = 0; axis < 3; axis++) expect(Math.abs(gathered[axis] - fields[axis][0])).toBeLessThan(2e-14);
  });

  it('rejects an oversized explicit trajectory list before allocating per-edge objects', () => {
    const large = { nx: 128, ny: 128, nz: 128, dx: 1, dy: 1, dz: 1 };
    expect(() => smoothTrajectoryWeights(large, [63, 63, 63], [64, 64, 64], 30)).toThrow(/1,000,000.*stream|stream.*1,000,000/i);
  });
});
