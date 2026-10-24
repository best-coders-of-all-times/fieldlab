/** Node charge and electric-edge current densities, in SI units. */
export interface DepositionGrid {
  nx: number; ny: number; nz: number;
  dx: number; dy: number; dz: number;
}
export type DepositBoundary = 'closed' | 'periodic';
export type DepositVector = readonly [number, number, number];
type DensityArray = Float64Array | Float32Array;

function validateGrid(g: DepositionGrid, arrays: DensityArray[], boundary: DepositBoundary) {
  const n = [g.nx, g.ny, g.nz], h = [g.dx, g.dy, g.dz];
  if (n.some(v => !Number.isSafeInteger(v) || v < 1) || h.some(v => !Number.isFinite(v) || v <= 0)) {
    throw new Error('Deposition grid dimensions and spacings must be finite and positive');
  }
  if (arrays.some(a => a.length !== g.nx * g.ny * g.nz)) throw new Error('Deposition array size does not match grid');
  if (boundary !== 'closed' && boundary !== 'periodic') throw new Error('Unsupported deposition boundary');
}

function coordinates(p: DepositVector, g: DepositionGrid, boundary: DepositBoundary): [number, number, number] {
  const h = [g.dx, g.dy, g.dz], n = [g.nx, g.ny, g.nz];
  return p.map((v, axis) => {
    if (!Number.isFinite(v)) throw new Error('Charge position must be finite');
    const x = v / h[axis];
    if (!Number.isFinite(x)) throw new Error('Charge grid coordinate must be finite');
    if (boundary === 'periodic') return x;
    const tolerance = 32 * Number.EPSILON * Math.max(1, n[axis]);
    if (x < -tolerance || x > n[axis] - 1 + tolerance) throw new Error('Charge leaves closed deposition domain boundary');
    return Math.max(0, Math.min(n[axis] - 1, x));
  }) as [number, number, number];
}

function index(g: DepositionGrid, i: number, j: number, k: number, boundary: DepositBoundary): number {
  if (boundary === 'periodic') {
    i = ((i % g.nx) + g.nx) % g.nx;
    j = ((j % g.ny) + g.ny) % g.ny;
    k = ((k % g.nz) + g.nz) % g.nz;
  } else if (i < 0 || j < 0 || k < 0 || i >= g.nx || j >= g.ny || k >= g.nz) return -1;
  return i + g.nx * (j + g.ny * k);
}

/** Add CIC charge density. Positions are metres from node (0,0,0); q is coulombs.
 * Closed domains reject exits. Periodic domains wrap nodes over lengths nx*dx etc.
 */
export function depositCharge(rho: DensityArray, grid: DepositionGrid, position: DepositVector, q: number, boundary: DepositBoundary = 'closed'): void {
  validateGrid(grid, [rho], boundary);
  if (!Number.isFinite(q)) throw new Error('Charge must be finite');
  const p = coordinates(position, grid, boundary), base = p.map(Math.floor);
  const frac = p.map((v, a) => v - base[a]);
  const density = q / (grid.dx * grid.dy * grid.dz);
  for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const w = (i ? frac[0] : 1 - frac[0]) * (j ? frac[1] : 1 - frac[1]) * (k ? frac[2] : 1 - frac[2]);
    if (w === 0) continue;
    const c = index(grid, base[0] + i, base[1] + j, base[2] + k, boundary);
    if (c >= 0) rho[c] += density * w;
  }
}

/** Add the time-averaged current of a straight CIC trajectory.
 * Its backward nodal divergence satisfies (rhoNew-rhoOld)/dt + div J = 0.
 * We split at cell crossings and average the six coordinate-order paths in each
 * cell (the first-order charge-conserving shape). Units are A/m². Arrays accumulate.
 * Periodic endpoints must be UNWRAPPED to specify direction and multiple crossings:
 * pass [L+delta,...] for a forward seam crossing, rather than [delta,...].
 * This helper does not model escaping charge: closed boundary exits throw atomically.
 */
export function depositTrajectory(Jx: DensityArray, Jy: DensityArray, Jz: DensityArray, grid: DepositionGrid,
  oldPosition: DepositVector, newPosition: DepositVector, q: number, dt: number, boundary: DepositBoundary = 'closed'): void {
  validateGrid(grid, [Jx, Jy, Jz], boundary);
  if (!Number.isFinite(q)) throw new Error('Charge must be finite');
  if (!Number.isFinite(dt) || dt <= 0) throw new Error('Deposition dt must be finite and positive');
  const a = coordinates(oldPosition, grid, boundary), b = coordinates(newPosition, grid, boundary);
  const delta = b.map((v, axis) => v - a[axis]);
  const cuts = [0, 1];
  for (let axis = 0; axis < 3; axis++) {
    if (delta[axis] === 0) continue;
    const lo = Math.min(a[axis], b[axis]), hi = Math.max(a[axis], b[axis]);
    if (hi - lo > 1e6 || !Number.isSafeInteger(Math.floor(lo)) || !Number.isSafeInteger(Math.ceil(hi))) {
      throw new Error('Trajectory exceeds safe cell crossing limit');
    }
    for (let wall = Math.floor(lo) + 1; wall < hi; wall++) cuts.push((wall - a[axis]) / delta[axis]);
  }
  cuts.sort((x, y) => x - y);
  const h = [grid.dx, grid.dy, grid.dz], arrays = [Jx, Jy, Jz];
  const scale = q / (dt * grid.dx * grid.dy * grid.dz);
  for (let segment = 1; segment < cuts.length; segment++) {
    const t0 = cuts[segment - 1], t1 = cuts[segment];
    if (t0 === t1) continue;
    const start = a.map((v, axis) => v + t0 * delta[axis]);
    const end = a.map((v, axis) => v + t1 * delta[axis]);
    const base = start.map((v, axis) => Math.floor((v + end[axis]) / 2));
    const u = start.map((v, axis) => Math.max(0, Math.min(1, v - base[axis])));
    const v = end.map((x, axis) => Math.max(0, Math.min(1, x - base[axis])));
    for (let axis = 0; axis < 3; axis++) {
      const motion = end[axis] - start[axis];
      if (motion === 0) continue;
      const other = [0, 1, 2].filter(x => x !== axis), [y, z] = other;
      for (let iy = 0; iy < 2; iy++) for (let iz = 0; iz < 2; iz++) {
        const sy = iy ? u[y] : 1 - u[y], sz = iz ? u[z] : 1 - u[z];
        const dy = (iy ? v[y] : 1 - v[y]) - sy, dz = (iz ? v[z] : 1 - v[z]) - sz;
        const weight = sy * sz + (dy * sz + sy * dz) / 2 + dy * dz / 3;
        const node = [...base]; node[y] += iy; node[z] += iz;
        const c = index(grid, node[0], node[1], node[2], boundary);
        if (c >= 0) arrays[axis][c] += scale * h[axis] * motion * weight;
      }
    }
  }
}
