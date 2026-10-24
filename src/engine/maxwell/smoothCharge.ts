import type { Vec3 } from '../math/vec3';
import type { DepositionGrid, DepositVector, TrajectoryWeight } from './deposition';

type DensityArray = Float64Array | Float32Array;
export interface SmoothChargeWeights {
  x: Float64Array; y: Float64Array; z: Float64Array;
  /** Derivatives with respect to the cloud center, in inverse metres. */
  dx: Float64Array; dy: Float64Array; dz: Float64Array;
}

// Bound both allocation and three-dimensional work before touching output arrays.
const MAX_NODES = 128 ** 3;

function validateGrid(g: DepositionGrid, arrays: DensityArray[] = []): void {
  const n = [g.nx, g.ny, g.nz], h = [g.dx, g.dy, g.dz], size = g.nx * g.ny * g.nz;
  if (n.some(v => !Number.isSafeInteger(v) || v < 2) || h.some(v => !Number.isFinite(v) || v <= 0)) {
    throw new Error('Smooth deposition grid dimensions and spacings must be finite and positive');
  }
  if (!Number.isSafeInteger(size) || size > MAX_NODES) throw new Error('Smooth deposition grid exceeds node budget limit');
  if (h.some((v, axis) => !Number.isFinite(v * (n[axis] - 1))) || !Number.isFinite(g.dx * g.dy * g.dz) || g.dx * g.dy * g.dz === 0) {
    throw new Error('Smooth deposition grid exceeds finite numerical range');
  }
  if (arrays.some(a => a.length !== size)) throw new Error('Smooth deposition array size does not match grid');
}

/** Taylor coefficients about the interval midpoint. Compute tail distance from
 * its nearer endpoint so an interval midpoint rounded to ±2 retains its mass.
 */
function cubic(lo: number, hi: number): [number, number, number, number] {
  const u = (lo + hi) / 2;
  const a = Math.abs(u), sign = u < 0 ? -1 : 1;
  if (a >= 1) {
    const t = u < 0 ? lo + 2 + (hi - lo) / 2 : 2 - hi + (hi - lo) / 2;
    return [t ** 3 / 6, -sign * t * t / 2, t / 2, -sign / 6];
  }
  return [2 / 3 - a * a + a ** 3 / 2, sign * (-2 * a + 1.5 * a * a), -1 + 1.5 * a, sign / 2];
}

function axisWeights(n: number, h: number, center: number, width: number): [Float64Array, Float64Array] {
  const extent = (n - 1) * h;
  if (!Number.isFinite(center)) throw new Error('Smooth charge center must be finite');
  if (center - 2 * width < 0 || center + 2 * width > extent) throw new Error('Smooth charge support leaves closed deposition domain boundary');
  if (!Number.isFinite(h / width) || center - width === center || center + width === center) {
    throw new Error('Smooth charge width is unresolved at floating-point coordinate precision');
  }
  const values = new Float64Array(n), derivatives = new Float64Array(n);
  // Exact polynomial integration avoids cancellation of the F2 second difference.
  // This is the same beta3/tent convolution, evaluated on polynomial intervals.
  for (let i = 0; i < n; i++) {
    const left = ((i - 1) * h - center) / width;
    const middle = (i * h - center) / width;
    const right = ((i + 1) * h - center) / width;
    if (left >= 2 || right <= -2) continue;
    const cuts = [-2, -1, 0, 1, 2];
    for (const u of [left, middle, right]) if (u > -2 && u < 2) cuts.push(u);
    cuts.sort((a, b) => a - b);
    let value = 0, derivative = 0;
    for (let p = 1; p < cuts.length; p++) {
      const lo = cuts[p - 1], hi = cuts[p], half = (hi - lo) / 2;
      if (half === 0 || hi <= left || lo >= right) continue;
      const [b0, b1, b2, b3] = cubic(lo, hi);
      const rising = hi <= middle, slope = (rising ? width : -width) / h;
      const tent = (rising ? lo - left + half : right - hi + half) * width / h;
      const mass = 2 * half * (b0 + b2 * half * half / 3);
      value += 2 * half * (b0 * tent + (b2 * tent + b1 * slope) * half * half / 3 + b3 * slope * half ** 4 / 5);
      derivative += (rising ? 1 : -1) * mass / h;
    }
    if (!Number.isFinite(value) || !Number.isFinite(derivative) || value <= 0) throw new Error('Smooth charge profile is unresolved at floating-point precision');
    values[i] = value; derivatives[i] = derivative;
  }
  let total = 0, dtotal = 0, pivot = 0;
  for (let i = 0; i < n; i++) {
    total += values[i]; dtotal += derivatives[i];
    if (values[i] > values[pivot]) pivot = i;
  }
  if (!(total > 0) || !Number.isFinite(total) || Math.abs(total - 1) > 1e-11) throw new Error('Smooth charge profile cannot be resolved to the required normalization');
  let normalized = 0, dnormalized = 0;
  for (let i = 0; i < n; i++) {
    derivatives[i] = (derivatives[i] - values[i] * dtotal / total) / total;
    values[i] /= total;
    normalized += values[i]; dnormalized += derivatives[i];
  }
  // Remove only accumulated roundoff, at the best-conditioned coefficient.
  values[pivot] += 1 - normalized;
  derivatives[pivot] -= dnormalized;
  return [values, derivatives];
}

/** Separable analytic beta3 density convolved with native nodal CIC tents.
 * Width and center are metres from node zero. Complete density support center ±
 * 2*width must fit the closed node domain; there is no clipping or periodic wrap.
 */
export function smoothChargeWeights(grid: DepositionGrid, center: DepositVector, width: number): SmoothChargeWeights {
  validateGrid(grid);
  if (!Number.isFinite(width) || width <= 0) throw new Error('Smooth charge width must be finite and positive');
  const [x, dx] = axisWeights(grid.nx, grid.dx, center[0], width);
  const [y, dy] = axisWeights(grid.ny, grid.dy, center[1], width);
  const [z, dz] = axisWeights(grid.nz, grid.dz, center[2], width);
  return { x, y, z, dx, dy, dz };
}

function finiteCharge(q: number): void {
  if (!Number.isFinite(q)) throw new Error('Smooth charge must be finite');
}

/** Accumulate nodal charge density in C/m³. Validation precedes all writes. */
export function depositSmoothCharge(rho: DensityArray, grid: DepositionGrid, center: DepositVector, width: number, q: number): void {
  validateGrid(grid, [rho]); finiteCharge(q);
  const w = smoothChargeWeights(grid, center, width), density = q / (grid.dx * grid.dy * grid.dz);
  if (!Number.isFinite(density)) throw new Error('Smooth charge density exceeds finite numerical range');
  for (let k = 0; k < grid.nz; k++) if (w.z[k] !== 0) for (let j = 0; j < grid.ny; j++) if (w.y[j] !== 0) for (let i = 0; i < grid.nx; i++) {
    if (w.x[i] !== 0) rho[i + grid.nx * (j + grid.ny * k)] += density * w.x[i] * w.y[j] * w.z[k];
  }
}

/** Cumulative nodal differences on native forward edges. The final nonzero
 * nodal support has no exterior edge flux; its total is zero by normalization.
 */
function cumulative(values: Float64Array, other?: Float64Array): Float64Array {
  const out = new Float64Array(values.length);
  let end = values.length - 1;
  while (end >= 0 && values[end] === 0 && (!other || other[end] === 0)) end--;
  let prefix = 0, compensation = 0;
  for (let i = 0; i < end; i++) {
    const increment = (other ? values[i] - other[i] : -values[i]) - compensation, next = prefix + increment;
    compensation = (next - prefix) - increment; prefix = next; out[i] = prefix;
  }
  return out;
}

function walkSmoothTrajectory(grid: DepositionGrid, from: DepositVector, to: DepositVector, width: number,
  visit: (axis: 0 | 1 | 2, index: number, length: number) => void, maxWeights = Infinity): void {
  const a = smoothChargeWeights(grid, from, width), b = smoothChargeWeights(grid, to, width);
  const old = [a.x, a.y, a.z], next = [b.x, b.y, b.z], h = [grid.dx, grid.dy, grid.dz], n = [grid.nx, grid.ny, grid.nz];
  const stride = [1, grid.nx, grid.nx * grid.ny];
  const fluxes = old.map((values, axis) => cumulative(values, next[axis]));
  if (Number.isFinite(maxWeights)) {
    const transverseCounts = old.map((values, axis) => values.reduce((count, v, i) => count + (v !== 0 || next[axis][i] !== 0 ? 1 : 0), 0));
    let count = 0;
    for (let axis = 0; axis < 3; axis++) {
      const edges = fluxes[axis].reduce((total, v) => total + (v !== 0 ? 1 : 0), 0);
      count += edges * transverseCounts[(axis + 1) % 3] * transverseCounts[(axis + 2) % 3];
    }
    if (count > maxWeights) throw new Error('Smooth trajectory exceeds 1,000,000 returned weights; use streaming depositSmoothTrajectory or a smaller source/grid');
  }
  for (const axis of [0, 1, 2] as const) {
    const flux = fluxes[axis], y = (axis + 1) % 3, z = (axis + 2) % 3;
    for (let i = 0; i < n[axis] - 1; i++) if (flux[i] !== 0) for (let j = 0; j < n[y]; j++) {
      if (old[y][j] === 0 && next[y][j] === 0) continue;
      for (let k = 0; k < n[z]; k++) {
        if (old[z][k] === 0 && next[z][k] === 0) continue;
        const sy = old[y][j], sz = old[z][k], dy = next[y][j] - sy, dz = next[z][k] - sz;
        const transverse = sy * sz + (dy * sz + sy * dz) / 2 + dy * dz / 3;
        const length = h[axis] * flux[i] * transverse;
        if (length !== 0) visit(axis, i * stride[axis] + j * stride[y] + k * stride[z], length);
      }
    }
  }
}

/** Endpoint-exact symmetric current line weights, in metres. This integrates
 * the product identity between endpoint assignments; it is not temporal particle
 * integration or a claim that endpoint shapes translate linearly along the path.
 */
export function smoothTrajectoryWeights(grid: DepositionGrid, from: DepositVector, to: DepositVector, width: number): TrajectoryWeight[] {
  const weights: TrajectoryWeight[] = [];
  walkSmoothTrajectory(grid, from, to, width, (axis, index, length) => weights.push({ axis, index, length }), 1_000_000);
  return weights;
}

/** Accumulate time-averaged native-edge current in A/m². Its backward nodal
 * divergence closes the endpoint deposited charge change to floating-point roundoff.
 */
export function depositSmoothTrajectory(Jx: DensityArray, Jy: DensityArray, Jz: DensityArray, grid: DepositionGrid,
  from: DepositVector, to: DepositVector, width: number, q: number, dt: number): void {
  validateGrid(grid, [Jx, Jy, Jz]); finiteCharge(q);
  if (!Number.isFinite(dt) || dt <= 0) throw new Error('Smooth deposition dt must be finite and positive');
  const scale = q / (dt * grid.dx * grid.dy * grid.dz), arrays = [Jx, Jy, Jz];
  if (!Number.isFinite(scale)) throw new Error('Smooth current density exceeds finite numerical range');
  walkSmoothTrajectory(grid, from, to, width, (axis, index, length) => { arrays[axis][index] += scale * length; });
}

/** Instantaneous electric gather adjoint to the center derivative of deposited
 * charge: for E=-grad(phi), q*gather = -d(sum rho*phi*dv)/dcenter.
 * Reads native forward edges with weight -h*prefix(dS/dcenter), not nodal E.
 */
export function gatherSmoothElectric(Ex: DensityArray, Ey: DensityArray, Ez: DensityArray, grid: DepositionGrid,
  center: DepositVector, width: number): Vec3 {
  validateGrid(grid, [Ex, Ey, Ez]);
  const w = smoothChargeWeights(grid, center, width), shapes = [w.x, w.y, w.z], derivatives = [w.dx, w.dy, w.dz];
  const arrays = [Ex, Ey, Ez], n = [grid.nx, grid.ny, grid.nz], h = [grid.dx, grid.dy, grid.dz], stride = [1, grid.nx, grid.nx * grid.ny];
  const out: Vec3 = [0, 0, 0];
  for (const axis of [0, 1, 2] as const) {
    const prefix = cumulative(derivatives[axis]), y = (axis + 1) % 3, z = (axis + 2) % 3;
    let total = 0, compensation = 0;
    for (let i = 0; i < n[axis] - 1; i++) if (prefix[i] !== 0) for (let j = 0; j < n[y]; j++) if (shapes[y][j] !== 0) for (let k = 0; k < n[z]; k++) {
      if (shapes[z][k] === 0) continue;
      const field = arrays[axis][i * stride[axis] + j * stride[y] + k * stride[z]];
      if (!Number.isFinite(field)) throw new Error('Contributing smooth electric field must be finite');
      const value = field * h[axis] * prefix[i] * shapes[y][j] * shapes[z][k] - compensation, next = total + value;
      compensation = (next - total) - value; total = next;
    }
    if (!Number.isFinite(total)) throw new Error('Smooth electric gather exceeds finite numerical range');
    out[axis] = total;
  }
  return out;
}
