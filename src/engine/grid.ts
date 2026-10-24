import type { Vec3 } from './math/vec3';

export interface GridSpec {
  nx: number;
  ny: number;
  nz: number;
  min: Vec3;
  max: Vec3;
  dx: number;
  dy: number;
  dz: number;
}

export function makeGrid(
  nx: number,
  ny: number,
  nz: number,
  center: Vec3,
  size: Vec3,
): GridSpec {
  const min: Vec3 = [
    center[0] - size[0] / 2,
    center[1] - size[1] / 2,
    center[2] - size[2] / 2,
  ];
  const max: Vec3 = [
    center[0] + size[0] / 2,
    center[1] + size[1] / 2,
    center[2] + size[2] / 2,
  ];
  return {
    nx, ny, nz, min, max,
    dx: nx > 1 ? size[0] / (nx - 1) : size[0],
    dy: ny > 1 ? size[1] / (ny - 1) : size[1],
    dz: nz > 1 ? size[2] / (nz - 1) : size[2],
  };
}

export function makeCellGrid(
  nx: number,
  ny: number,
  nz: number,
  center: Vec3,
  size: Vec3,
): GridSpec {
  const min: Vec3 = [
    center[0] - size[0] / 2,
    center[1] - size[1] / 2,
    center[2] - size[2] / 2,
  ];
  return {
    nx, ny, nz, min,
    max: [center[0] + size[0] / 2, center[1] + size[1] / 2, center[2] + size[2] / 2],
    dx: size[0] / nx,
    dy: size[1] / ny,
    dz: size[2] / nz,
  };
}

export const idx = (g: GridSpec, i: number, j: number, k: number): number =>
  i + g.nx * (j + g.ny * k);

export function cellCenter(g: GridSpec, i: number, j: number, k: number): Vec3 {
  return [
    g.min[0] + (i + 0.5) * g.dx,
    g.min[1] + (j + 0.5) * g.dy,
    g.min[2] + (k + 0.5) * g.dz,
  ];
}

export function nodePosition(g: GridSpec, i: number, j: number, k: number): Vec3 {
  return [g.min[0] + i * g.dx, g.min[1] + j * g.dy, g.min[2] + k * g.dz];
}

/** Normalized grid coordinates, clamped to the grid. */
export function gridCoords(g: GridSpec, p: Vec3): [number, number, number] {
  const x = Math.min(Math.max((p[0] - g.min[0]) / g.dx, 0), g.nx - 1);
  const y = Math.min(Math.max((p[1] - g.min[1]) / g.dy, 0), g.ny - 1);
  const z = Math.min(Math.max((p[2] - g.min[2]) / g.dz, 0), g.nz - 1);
  return [x, y, z];
}

export function sampleScalar(data: Float32Array, g: GridSpec, p: Vec3): number {
  const [fx, fy, fz] = gridCoords(g, p);
  const i0 = Math.floor(fx), j0 = Math.floor(fy), k0 = Math.floor(fz);
  const i1 = Math.min(i0 + 1, g.nx - 1);
  const j1 = Math.min(j0 + 1, g.ny - 1);
  const k1 = Math.min(k0 + 1, g.nz - 1);
  const tx = fx - i0, ty = fy - j0, tz = fz - k0;
  const c000 = data[idx(g, i0, j0, k0)];
  const c100 = data[idx(g, i1, j0, k0)];
  const c010 = data[idx(g, i0, j1, k0)];
  const c110 = data[idx(g, i1, j1, k0)];
  const c001 = data[idx(g, i0, j0, k1)];
  const c101 = data[idx(g, i1, j0, k1)];
  const c011 = data[idx(g, i0, j1, k1)];
  const c111 = data[idx(g, i1, j1, k1)];
  const c00 = c000 + (c100 - c000) * tx;
  const c10 = c010 + (c110 - c010) * tx;
  const c01 = c001 + (c101 - c001) * tx;
  const c11 = c011 + (c111 - c011) * tx;
  const c0 = c00 + (c10 - c00) * ty;
  const c1 = c01 + (c11 - c01) * ty;
  return c0 + (c1 - c0) * tz;
}

export function sampleVector(
  data: Float32Array,
  g: GridSpec,
  p: Vec3,
  out: Vec3 = [0, 0, 0],
): Vec3 {
  const [fx, fy, fz] = gridCoords(g, p);
  const i0 = Math.floor(fx), j0 = Math.floor(fy), k0 = Math.floor(fz);
  const i1 = Math.min(i0 + 1, g.nx - 1);
  const j1 = Math.min(j0 + 1, g.ny - 1);
  const k1 = Math.min(k0 + 1, g.nz - 1);
  const tx = fx - i0, ty = fy - j0, tz = fz - k0;
  let x = 0, y = 0, z = 0;
  for (let kk = 0; kk < 2; kk++) {
    const k = kk ? k1 : k0;
    const wz = kk ? tz : 1 - tz;
    for (let jj = 0; jj < 2; jj++) {
      const j = jj ? j1 : j0;
      const wy = (jj ? ty : 1 - ty) * wz;
      for (let ii = 0; ii < 2; ii++) {
        const i = ii ? i1 : i0;
        const w = (ii ? tx : 1 - tx) * wy;
        const base = idx(g, i, j, k) * 3;
        x += data[base] * w;
        y += data[base + 1] * w;
        z += data[base + 2] * w;
      }
    }
  }
  out[0] = x; out[1] = y; out[2] = z;
  return out;
}

/** Compute E = -grad(phi) on a node grid; output interleaved xyz. */
export function gradientToE(phi: Float32Array, g: GridSpec): Float32Array {
  const out = new Float32Array(g.nx * g.ny * g.nz * 3);
  const inv2dx = 1 / (2 * g.dx);
  const inv2dy = 1 / (2 * g.dy);
  const inv2dz = 1 / (2 * g.dz);
  for (let k = 0; k < g.nz; k++) {
    for (let j = 0; j < g.ny; j++) {
      for (let i = 0; i < g.nx; i++) {
        const c = idx(g, i, j, k);
        const im = idx(g, Math.max(i - 1, 0), j, k);
        const ip = idx(g, Math.min(i + 1, g.nx - 1), j, k);
        const jm = idx(g, i, Math.max(j - 1, 0), k);
        const jp = idx(g, i, Math.min(j + 1, g.ny - 1), k);
        const km = idx(g, i, j, Math.max(k - 1, 0));
        const kp = idx(g, i, j, Math.min(k + 1, g.nz - 1));
        const o = c * 3;
        out[o] = -(phi[ip] - phi[im]) * inv2dx * (i === 0 || i === g.nx - 1 ? 2 : 1);
        out[o + 1] = -(phi[jp] - phi[jm]) * inv2dy * (j === 0 || j === g.ny - 1 ? 2 : 1);
        out[o + 2] = -(phi[kp] - phi[km]) * inv2dz * (k === 0 || k === g.nz - 1 ? 2 : 1);
      }
    }
  }
  return out;
}

export function worldBoundsIntersect(
  g: GridSpec,
  lo: Vec3,
  hi: Vec3,
): { i0: number; i1: number; j0: number; j1: number; k0: number; k1: number } {
  return {
    i0: Math.max(0, Math.floor((lo[0] - g.min[0]) / g.dx)),
    i1: Math.min(g.nx - 1, Math.ceil((hi[0] - g.min[0]) / g.dx)),
    j0: Math.max(0, Math.floor((lo[1] - g.min[1]) / g.dy)),
    j1: Math.min(g.ny - 1, Math.ceil((hi[1] - g.min[1]) / g.dy)),
    k0: Math.max(0, Math.floor((lo[2] - g.min[2]) / g.dz)),
    k1: Math.min(g.nz - 1, Math.ceil((hi[2] - g.min[2]) / g.dz)),
  };
}

export function percentile(values: Float32Array, p: number): number {
  if (values.length === 0) return 0;
  const count = Math.max(1, Math.min(values.length, 8192));
  const stride = Math.max(1, Math.floor(values.length / count));
  const sample: number[] = [];
  for (let i = 0; i < values.length; i += stride) {
    const v = values[i];
    if (Number.isFinite(v)) sample.push(v);
  }
  if (sample.length === 0) return 0;
  sample.sort((a, b) => a - b);
  const q = Math.min(1, Math.max(0, p));
  return sample[Math.min(sample.length - 1, Math.floor(q * (sample.length - 1)))];
}
