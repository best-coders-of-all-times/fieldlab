import { EPS0 } from '../constants';
import type { YeeSolver } from './yee';

/** Compatible nodal potential solve used once, never in time stepping.
 * Fixed voltages describe preparation of the initial state, not live feeds.
 */
export function initializeElectric(
  s: YeeSolver,
  fixed: Uint8Array,
  potential: Float64Array,
  tolerance = 1e-10,
): { iterations: number; residual: number } {
  const n = s.rho.length, { nx, ny, nz, dx, dy, dz } = s;
  const nxy = nx * ny;
  const inv = [1 / dx ** 2, 1 / dy ** 2, 1 / dz ** 2];
  const b = new Float64Array(n), x = new Float64Array(n);
  const r = new Float64Array(n), p = new Float64Array(n), z = new Float64Array(n);
  const ap = new Float64Array(n), diagonal = new Float64Array(n);
  const free: number[] = [];
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const c = i + nx * j + nxy * k;
    if (fixed[c]) continue;
    free.push(c);
    const near = [c - 1, c + 1, c - nx, c + nx, c - nxy, c + nxy];
    const w = [s.epsX[c - 1] * inv[0], s.epsX[c] * inv[0], s.epsY[c - nx] * inv[1],
      s.epsY[c] * inv[1], s.epsZ[c - nxy] * inv[2], s.epsZ[c] * inv[2]];
    b[c] = s.rho[c] / EPS0;
    for (let a = 0; a < 6; a++) { diagonal[c] += w[a]; if (fixed[near[a]]) b[c] += w[a] * potential[near[a]]; }
  }
  const apply = (v: Float64Array, out: Float64Array) => {
    for (const c of free) {
      out[c] = diagonal[c] * v[c]
        - (s.epsX[c - 1] * v[c - 1] + s.epsX[c] * v[c + 1]) * inv[0]
        - (s.epsY[c - nx] * v[c - nx] + s.epsY[c] * v[c + nx]) * inv[1]
        - (s.epsZ[c - nxy] * v[c - nxy] + s.epsZ[c] * v[c + nxy]) * inv[2];
    }
  };
  let rz = 0, b2 = 0;
  for (const c of free) { r[c] = b[c]; z[c] = r[c] / diagonal[c]; p[c] = z[c]; rz += r[c] * z[c]; b2 += b[c] ** 2; }
  let iteration = 0, residual = Math.sqrt(b2);
  for (; iteration < 1000 && residual > tolerance * Math.max(Math.sqrt(b2), 1e-30); iteration++) {
    apply(p, ap);
    let pap = 0;
    for (const c of free) pap += p[c] * ap[c];
    if (!(pap > 0)) break;
    const alpha = rz / pap;
    let next = 0, r2 = 0;
    for (const c of free) { x[c] += alpha * p[c]; r[c] -= alpha * ap[c]; z[c] = r[c] / diagonal[c]; next += r[c] * z[c]; r2 += r[c] ** 2; }
    const beta = next / rz;
    for (const c of free) p[c] = z[c] + beta * p[c];
    rz = next; residual = Math.sqrt(r2);
  }
  if (residual > tolerance * Math.max(Math.sqrt(b2), 1e-30) * 10) throw new Error('Initial Gauss solve did not converge; reduce resolution or review overlapping electrodes.');
  for (const c of free) potential[c] = x[c];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = i + nx * j + nxy * k;
    // The backing-wall ghost edges still belong to the compatible Yee storage
    // complex. Use the same wrapped forward gradient as its curl, including
    // outside the physical region, so off-center boundary data cannot create
    // a numerical curl. Captured static PML boundaries hold these DC values.
    const ip = i < nx - 1 ? c + 1 : c - (nx - 1);
    const jp = j < ny - 1 ? c + nx : c - nx * (ny - 1);
    const kp = k < nz - 1 ? c + nxy : c - nxy * (nz - 1);
    s.Ex[c] = -(potential[ip] - potential[c]) / dx;
    s.Ey[c] = -(potential[jp] - potential[c]) / dy;
    s.Ez[c] = -(potential[kp] - potential[c]) / dz;
  }
  // Include charge induced while preparing electrodes. Fixed electrode nodes
  // subsequently evolve freely, with the selected finite conductivity.
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const c = i + nx * j + nxy * k;
    s.rho[c] = EPS0 * ((s.epsX[c] * s.Ex[c] - s.epsX[c - 1] * s.Ex[c - 1]) / dx
      + (s.epsY[c] * s.Ey[c] - s.epsY[c - nx] * s.Ey[c - nx]) / dy
      + (s.epsZ[c] * s.Ez[c] - s.epsZ[c - nxy] * s.Ez[c - nxy]) / dz);
  }
  return { iterations: iteration, residual: residual / Math.max(Math.sqrt(b2), 1e-30) };
}
