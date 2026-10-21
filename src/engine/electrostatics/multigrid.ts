import type { GridSpec } from '../grid';
import { idx } from '../grid';
import type { Vec3 } from '../math/vec3';

interface Level {
  nx: number;
  ny: number;
  nz: number;
  dx: number;
  dy: number;
  dz: number;
  min: Vec3;
  eps: Float32Array;
  fixed: Uint8Array;
  fixedVal: Float32Array;
  b: Float32Array; // RHS (charge term at level 0, restricted residual below)
  phi: Float32Array;
  res: Float32Array;
}

export interface MultigridOptions {
  tolerance?: number;
  maxCycles?: number;
  preSmooth?: number;
  postSmooth?: number;
  coarsestSweeps?: number;
}

export interface MultigridResult {
  phi: Float32Array;
  cycles: number;
  residual: number;
}

function buildCoarse(
  fine: Level,
  boundaryAt: (world: Vec3) => number,
): Level | null {
  // Coarsen only while both dimensions and index mapping are sane.
  if (fine.nx <= 4 || fine.ny <= 4 || fine.nz <= 4) return null;
  const nx = (fine.nx - 1) / 2 + 1;
  const ny = (fine.ny - 1) / 2 + 1;
  const nz = (fine.nz - 1) / 2 + 1;
  if (!Number.isInteger(nx) || !Number.isInteger(ny) || !Number.isInteger(nz)) return null;
  if (nx < 3 || ny < 3 || nz < 3) return null;

  const n = nx * ny * nz;
  const eps = new Float32Array(n);
  const fixed = new Uint8Array(n);
  const fixedVal = new Float32Array(n);
  const b = new Float32Array(n);
  const phi = new Float32Array(n);
  const res = new Float32Array(n);
  const dx = fine.dx * 2;
  const dy = fine.dy * 2;
  const dz = fine.dz * 2;
  const min: Vec3 = [fine.min[0], fine.min[1], fine.min[2]];

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = i + nx * (j + ny * k);
        let epsSum = 0;
        let epsCount = 0;
        let fixedCount = 0;
        let fixedSum = 0;
        for (let dk = 0; dk < 2; dk++) {
          const fk = Math.min(2 * k + dk, fine.nz - 1);
          for (let dj = 0; dj < 2; dj++) {
            const fj = Math.min(2 * j + dj, fine.ny - 1);
            for (let di = 0; di < 2; di++) {
              const fi = Math.min(2 * i + di, fine.nx - 1);
              const fc = fi + fine.nx * (fj + fine.ny * fk);
              epsSum += fine.eps[fc];
              epsCount++;
              if (fine.fixed[fc]) {
                fixedCount++;
                fixedSum += fine.fixedVal[fc];
              }
            }
          }
        }
        eps[c] = epsSum / epsCount;
        const onBoundary = i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1;
        if (onBoundary) {
          fixed[c] = 1;
          fixedVal[c] = boundaryAt([
            min[0] + i * dx,
            min[1] + j * dy,
            min[2] + k * dz,
          ]);
        } else if (fixedCount >= 4) {
          fixed[c] = 1;
          fixedVal[c] = fixedSum / fixedCount;
        }
      }
    }
  }

  return {
    nx, ny, nz, dx, dy, dz, min, eps, fixed, fixedVal, b, phi, res,
  };
}

function harmonic(a: number, b: number): number {
  if (a <= 0 || b <= 0) return Math.max(a, b);
  return (2 * a * b) / (a + b);
}

function smooth(l: Level, sweeps: number): void {
  const { nx, ny, nz, eps, fixed, phi, b } = l;
  const invx = 1 / (l.dx * l.dx);
  const invy = 1 / (l.dy * l.dy);
  const invz = 1 / (l.dz * l.dz);
  for (let s = 0; s < sweeps; s++) {
    for (let color = 0; color < 2; color++) {
      for (let k = 1; k < nz - 1; k++) {
        for (let j = 1; j < ny - 1; j++) {
          const parity = (j + k) & 1;
          const start = (parity ^ color) === 0 ? 1 : 2;
          for (let i = start; i < nx - 1; i += 2) {
            const c = i + nx * (j + ny * k);
            if (fixed[c]) continue;
            const ec = eps[c];
            let diag = 0;
            let sum = 0;
            const xm = c - 1;
            const xp = c + 1;
            const ym = c - nx;
            const yp = c + nx;
            const zm = c - nx * ny;
            const zp = c + nx * ny;
            let w = harmonic(ec, eps[xm]) * invx;
            diag += w; sum += w * phi[xm];
            w = harmonic(ec, eps[xp]) * invx;
            diag += w; sum += w * phi[xp];
            w = harmonic(ec, eps[ym]) * invy;
            diag += w; sum += w * phi[ym];
            w = harmonic(ec, eps[yp]) * invy;
            diag += w; sum += w * phi[yp];
            w = harmonic(ec, eps[zm]) * invz;
            diag += w; sum += w * phi[zm];
            w = harmonic(ec, eps[zp]) * invz;
            diag += w; sum += w * phi[zp];
            if (diag > 0) phi[c] = (b[c] + sum) / diag;
          }
        }
      }
    }
  }
}

function residual(l: Level): number {
  const { nx, ny, nz, eps, fixed, phi, b, res } = l;
  const invx = 1 / (l.dx * l.dx);
  const invy = 1 / (l.dy * l.dy);
  const invz = 1 / (l.dz * l.dz);
  let norm = 0;
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = i + nx * (j + ny * k);
        if (fixed[c]) {
          res[c] = 0;
          continue;
        }
        const ec = eps[c];
        let sum = 0;
        if (i > 0) sum += harmonic(ec, eps[c - 1]) * (phi[c] - phi[c - 1]) * invx;
        if (i < nx - 1) sum += harmonic(ec, eps[c + 1]) * (phi[c] - phi[c + 1]) * invx;
        if (j > 0) sum += harmonic(ec, eps[c - nx]) * (phi[c] - phi[c - nx]) * invy;
        if (j < ny - 1) sum += harmonic(ec, eps[c + nx]) * (phi[c] - phi[c + nx]) * invy;
        if (k > 0) sum += harmonic(ec, eps[c - nx * ny]) * (phi[c] - phi[c - nx * ny]) * invz;
        if (k < nz - 1) sum += harmonic(ec, eps[c + nx * ny]) * (phi[c] - phi[c + nx * ny]) * invz;
        const r = b[c] - sum;
        res[c] = r;
        norm += r * r;
      }
    }
  }
  return Math.sqrt(norm);
}

function axisWeights(nFine: number, nCoarse: number, I: number): { indices: number[]; weights: number[] } {
  if (I === 0) {
    return { indices: [0, 1], weights: [0.5, 0.5] };
  }
  if (I === nCoarse - 1) {
    return { indices: [nFine - 2, nFine - 1], weights: [0.5, 0.5] };
  }
  return { indices: [2 * I - 1, 2 * I, 2 * I + 1], weights: [0.25, 0.5, 0.25] };
}

function restrict(fine: Level, coarse: Level): void {
  coarse.b.fill(0);
  const xs = new Array(coarse.nx);
  const ys = new Array(coarse.ny);
  const zs = new Array(coarse.nz);
  for (let i = 0; i < coarse.nx; i++) xs[i] = axisWeights(fine.nx, coarse.nx, i);
  for (let j = 0; j < coarse.ny; j++) ys[j] = axisWeights(fine.ny, coarse.ny, j);
  for (let k = 0; k < coarse.nz; k++) zs[k] = axisWeights(fine.nz, coarse.nz, k);

  for (let k = 0; k < coarse.nz; k++) {
    const z = zs[k];
    for (let j = 0; j < coarse.ny; j++) {
      const y = ys[j];
      for (let i = 0; i < coarse.nx; i++) {
        const x = xs[i];
        let acc = 0;
        for (let a = 0; a < x.indices.length; a++) {
          for (let b = 0; b < y.indices.length; b++) {
            for (let c = 0; c < z.indices.length; c++) {
              const fi = x.indices[a], fj = y.indices[b], fk = z.indices[c];
              acc += fine.res[fi + fine.nx * (fj + fine.ny * fk)] * x.weights[a] * y.weights[b] * z.weights[c];
            }
          }
        }
        coarse.b[i + coarse.nx * (j + coarse.ny * k)] = acc;
      }
    }
  }
}

function prolongAdd(coarse: Level, fine: Level): void {
  // Trilinear interpolation of the coarse correction onto fine free cells.
  const gx = (fine.nx - 1) / (coarse.nx - 1);
  const gy = (fine.ny - 1) / (coarse.ny - 1);
  const gz = (fine.nz - 1) / (coarse.nz - 1);
  for (let k = 1; k < fine.nz - 1; k++) {
    const z = k / gz;
    const k0 = Math.min(Math.floor(z), coarse.nz - 2);
    const tz = z - k0;
    for (let j = 1; j < fine.ny - 1; j++) {
      const y = j / gy;
      const j0 = Math.min(Math.floor(y), coarse.ny - 2);
      const ty = y - j0;
      for (let i = 1; i < fine.nx - 1; i++) {
        const c = i + fine.nx * (j + fine.ny * k);
        if (fine.fixed[c]) continue;
        const x = i / gx;
        const i0 = Math.min(Math.floor(x), coarse.nx - 2);
        const tx = x - i0;
        const c000 = coarse.phi[i0 + coarse.nx * (j0 + coarse.ny * k0)];
        const c100 = coarse.phi[i0 + 1 + coarse.nx * (j0 + coarse.ny * k0)];
        const c010 = coarse.phi[i0 + coarse.nx * (j0 + 1 + coarse.ny * k0)];
        const c110 = coarse.phi[i0 + 1 + coarse.nx * (j0 + 1 + coarse.ny * k0)];
        const c001 = coarse.phi[i0 + coarse.nx * (j0 + coarse.ny * (k0 + 1))];
        const c101 = coarse.phi[i0 + 1 + coarse.nx * (j0 + coarse.ny * (k0 + 1))];
        const c011 = coarse.phi[i0 + coarse.nx * (j0 + 1 + coarse.ny * (k0 + 1))];
        const c111 = coarse.phi[i0 + 1 + coarse.nx * (j0 + 1 + coarse.ny * (k0 + 1))];
        const c00 = c000 + (c100 - c000) * tx;
        const c10 = c010 + (c110 - c010) * tx;
        const c01 = c001 + (c101 - c001) * tx;
        const c11 = c011 + (c111 - c011) * tx;
        const c0 = c00 + (c10 - c00) * ty;
        const c1 = c01 + (c11 - c01) * ty;
        fine.phi[c] += c0 + (c1 - c0) * tz;
      }
    }
  }
}

export function solveMultigrid(
  spec: GridSpec,
  epsilon: Float32Array,
  fixed: Uint8Array,
  fixedVal: Float32Array,
  rhs: Float32Array,
  boundaryAt: (world: Vec3) => number,
  initial?: Float32Array,
  options: MultigridOptions = {},
): MultigridResult {
  const tolerance = options.tolerance ?? 1e-5;
  const maxCycles = options.maxCycles ?? 30;
  const pre = options.preSmooth ?? 2;
  const post = options.postSmooth ?? 2;
  const coarsestSweeps = options.coarsestSweeps ?? 30;

  const fine: Level = {
    nx: spec.nx,
    ny: spec.ny,
    nz: spec.nz,
    dx: spec.dx,
    dy: spec.dy,
    dz: spec.dz,
    min: spec.min,
    eps: epsilon,
    fixed,
    fixedVal,
    b: rhs,
    phi: initial ? Float32Array.from(initial) : new Float32Array(spec.nx * spec.ny * spec.nz),
    res: new Float32Array(spec.nx * spec.ny * spec.nz),
  };

  for (let k = 0; k < spec.nz; k++) {
    for (let j = 0; j < spec.ny; j++) {
      for (let i = 0; i < spec.nx; i++) {
        const c = idx(spec, i, j, k);
        if (fixed[c]) fine.phi[c] = fixedVal[c];
      }
    }
  }

  const levels: Level[] = [fine];
  while (levels.length < 8) {
    const next = buildCoarse(levels[levels.length - 1], boundaryAt);
    if (!next) break;
    levels.push(next);
  }

  let cycles = 0;
  let resNorm = Infinity;
  let rhsNorm = 0;
  for (let i = 0; i < rhs.length; i++) {
    if (!fixed[i]) rhsNorm += rhs[i] * rhs[i];
  }
  rhsNorm = Math.sqrt(rhsNorm) || 1;

  const vcycle = (l: number): void => {
    const level = levels[l];
    if (l === levels.length - 1) {
      for (let s = 0; s < coarsestSweeps; s++) smooth(level, 1);
      return;
    }
    smooth(level, pre);
    residual(level);
    const coarse = levels[l + 1];
    restrict(level, coarse);
    coarse.phi.fill(0);
    for (let c = 0; c < coarse.fixed.length; c++) {
      if (coarse.fixed[c]) coarse.phi[c] = 0;
    }
    vcycle(l + 1);
    prolongAdd(coarse, level);
    smooth(level, post);
  };

  for (cycles = 0; cycles < maxCycles; cycles++) {
    vcycle(0);
    resNorm = residual(fine);
    if (resNorm / rhsNorm < tolerance) break;
  }

  return { phi: fine.phi, cycles, residual: resNorm / rhsNorm };
}

/** Solve A phi = b with a dense Gaussian elimination; used for small capacitance matrices. */
export function solveDense(A: number[][], b: number[]): number[] {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-30) continue;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const div = m[col][col];
    for (let c = col; c <= n; c++) m[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (Math.abs(f) < 1e-30) continue;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row) => row[n]);
}
