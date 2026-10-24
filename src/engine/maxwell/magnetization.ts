import type { Scene, MagnetObject } from '../../scene/types';
import type { Vec3 } from '../math/vec3';
import { cross, dot } from '../math/vec3';
import { rotateEuler } from '../../scene/defaults';
import { motionAt } from '../../scene/motion';
import { C_LIGHT, validateSubluminalVelocity } from './dynamics';
import type { DepositionGrid, DepositBoundary } from './deposition';

export type MagnetVectorField = [Float64Array, Float64Array, Float64Array];
const faceOffsets: Vec3[] = [[0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]];
const edgeOffsets: Vec3[] = [[0.5, 0, 0], [0, 0.5, 0], [0, 0, 0.5]];
const newField = (size: number): MagnetVectorField => [new Float64Array(size), new Float64Array(size), new Float64Array(size)];

function validateGrid(g: DepositionGrid): number {
  if ([g.nx, g.ny, g.nz].some(n => !Number.isSafeInteger(n) || n < 1)
    || [g.dx, g.dy, g.dz].some(h => !Number.isFinite(h) || h <= 0)) throw new Error('Invalid magnetization grid');
  const size = g.nx * g.ny * g.nz;
  if (!Number.isSafeInteger(size) || size > 16_000_000) throw new Error('Magnetization grid exceeds safe allocation limit');
  return size;
}
function normalizeAxis(axis: Vec3): Vec3 {
  if (axis.some(x => !Number.isFinite(x))) throw new Error('Motion axis must be finite');
  const length = Math.hypot(...axis);
  return length < 1e-10 ? [0, 0, 1] : axis.map(x => x / length) as Vec3;
}

function kinematics(object: MagnetObject, time: number): { position: Vec3; rotation: Vec3; velocity: Vec3; omega: Vec3 } {
  if (object.dynamics?.mode === 'forceDriven') throw new Error('Force-driven permanent magnets are unsupported');
  const stationary = object.dynamics?.mode === 'fixed' || !object.motion;
  const pose = stationary ? object : motionAt(object, time);
  const velocity: Vec3 = [0, 0, 0], omega: Vec3 = [0, 0, 0];
  if (stationary) return { position: pose.position, rotation: pose.rotation, velocity, omega };
  const motion = object.motion!;
  if (motion.kind !== 'keyframes') {
    if (![motion.frequency, motion.amplitude, motion.phase ?? 0].every(Number.isFinite)) throw new Error('Magnet motion parameters must be finite');
    const axis = normalizeAxis(motion.axis), rate = 2 * Math.PI * motion.frequency;
    const value = motion.kind === 'oscillate' ? motion.amplitude * rate * Math.cos(rate * time + (motion.phase ?? 0)) : rate;
    const target = motion.kind === 'oscillate' ? velocity : omega;
    for (let a = 0; a < 3; a++) target[a] = axis[a] * value;
  } else {
    const frames = motion.keyframes;
    for (let i = 0; i < frames.length; i++) {
      if (!Number.isFinite(frames[i].time) || frames[i].time < 0 || (i > 0 && frames[i].time <= frames[i - 1].time)
        || [...frames[i].position, ...frames[i].rotation].some(x => !Number.isFinite(x))) throw new Error('Magnet keyframes must be finite and ordered');
    }
    const duration = frames.at(-1)?.time ?? 0;
    if (motion.loop && frames.length > 1) {
      const first = frames[0], last = frames.at(-1)!;
      if (first.position.some((x, a) => Math.abs(x - last.position[a]) > 1e-12)
        || first.rotation.some((x, a) => Math.abs(x - last.rotation[a]) > 1e-12)) throw new Error('Looping magnet keyframes must return continuously to the initial pose');
    }
    const t = motion.loop && duration > 0 ? ((time % duration) + duration) % duration : time;
    let interval = -1;
    for (let i = 0; i + 1 < frames.length; i++) if (t >= frames[i].time && t < frames[i + 1].time) { interval = i; break; }
    if (interval >= 0) {
      const a = frames[interval], b = frames[interval + 1], dt = b.time - a.time;
      const rate = a.rotation.map((x, i) => (b.rotation[i] - x) / dt);
      for (let i = 0; i < 3; i++) velocity[i] = (b.position[i] - a.position[i]) / dt;
      // World angular velocity for R = Rx(x) Ry(y) Rz(z), the scene Euler XYZ convention.
      const [x, y] = pose.rotation;
      omega[0] = rate[0] + rate[2] * Math.sin(y);
      omega[1] = rate[1] * Math.cos(x) - rate[2] * Math.sin(x) * Math.cos(y);
      omega[2] = rate[1] * Math.sin(x) + rate[2] * Math.cos(x) * Math.cos(y);
    }
  }
  return { position: pose.position, rotation: pose.rotation, velocity, omega };
}

const smoothStep = (x: number) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);

/** Prescribed hard-magnet source model, with M in A/m on B faces and P in C/m²
 * on E edges. Local +Z is the authored permanent magnetization direction.
 *
 * The authored cylinder is the instantaneous LAB shape, with a compact cubic
 * transition of total width min(dx,dy,dz) at its side and end surfaces. It is
 * sampled separately at each Yee component location. Thus finite-grid dipole
 * moments converge with resolution; they are not rescaled to a hidden point dipole.
 *
 * At every material point, use the exact local P'=0 Lorentz tensor boost:
 * M = gamma M' - gamma²/(gamma+1) (v·M')v/c², P = gamma(v×M')/c².
 * A lab-rigid rotating/accelerating shape is a specified source, not a globally
 * Lorentz-boosted rigid rest body. Rest-shape contraction, elasticity, hysteresis,
 * demagnetization dynamics and force feedback are outside this source model.
 * See https://kirkmcd.princeton.edu/examples/movingdipole.pdf for tensor laws.
 */
export function buildMagnetizationSources(scene: Scene, grid: DepositionGrid, origin: Vec3, time: number): { magnetization: MagnetVectorField; polarization: MagnetVectorField } {
  const size = validateGrid(grid), magnetization = newField(size), polarization = newField(size);
  if (!Number.isFinite(time) || time < 0 || origin.some(x => !Number.isFinite(x))) throw new Error('Magnet source time/origin must be finite; time must be nonnegative');
  const spacing = [grid.dx, grid.dy, grid.dz], dims = [grid.nx, grid.ny, grid.nz];
  const width = Math.min(...spacing), half = width / 2;
  for (const object of scene.objects) {
    if (!object.visible || object.kind !== 'magnet') continue;
    if (![object.radius, object.length].every(x => Number.isFinite(x) && x > 0) || !Number.isFinite(object.magnetization)
      || [...object.position, ...object.rotation].some(x => !Number.isFinite(x))) throw new Error('Magnet geometry and magnetization must be finite; dimensions must be positive');
    const pose = kinematics(object, time);
    const supportRadius = Math.hypot(object.radius + half, object.length / 2 + half);
    const basis: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(v => rotateEuler(v as Vec3, pose.rotation));
    const omega = Math.hypot(...pose.omega), radial = object.radius + half, axial = object.length / 2 + half;
    const cosine = omega === 0 ? 1 : Math.min(1, Math.abs(dot(pose.omega, basis[2])) / omega);
    const sine = Math.sqrt(Math.max(0, 1 - cosine * cosine));
    // Farthest distance of this cylinder from the angular-velocity axis. Axial
    // spin depends on the radius, not the cylinder's bounding-sphere radius.
    const rotationRadius = cosine * axial >= sine * radial ? cosine * radial + sine * axial : supportRadius;
    // Conservative all-points speed bound, including the smoothed source boundary.
    const speedBound = Math.hypot(...pose.velocity) + omega * rotationRadius;
    validateSubluminalVelocity([speedBound, 0, 0]);
    const rest = basis[2].map(x => x * object.magnetization) as Vec3;
    const low = pose.position.map((p, a) => Math.max(0, Math.floor((p - supportRadius - origin[a]) / spacing[a]) - 1));
    const high = pose.position.map((p, a) => Math.min(dims[a] - 1, Math.ceil((p + supportRadius - origin[a]) / spacing[a]) + 1));
    for (let k = low[2]; k <= high[2]; k++) for (let j = low[1]; j <= high[1]; j++) for (let i = low[0]; i <= high[0]; i++) {
      const c = i + grid.nx * (j + grid.ny * k), cell = [i, j, k];
      for (let kind = 0; kind < 2; kind++) for (let axis = 0; axis < 3; axis++) {
        const offset = (kind === 0 ? faceOffsets : edgeOffsets)[axis];
        const r = cell.map((v, a) => origin[a] + (v + offset[a]) * spacing[a] - pose.position[a]) as Vec3;
        const local = basis.map(b => dot(r, b));
        const weight = smoothStep((object.radius + half - Math.hypot(local[0], local[1])) / width)
          * smoothStep((object.length / 2 + half - Math.abs(local[2])) / width);
        if (weight === 0) continue;
        const spin = cross(pose.omega, r), v = pose.velocity.map((x, a) => x + spin[a]) as Vec3;
        const beta = Math.hypot(...v) / C_LIGHT, gamma = 1 / Math.sqrt((1 - beta) * (1 + beta));
        if (kind === 0) {
          const correction = gamma * gamma / (gamma + 1) * dot(v, rest) / C_LIGHT ** 2;
          magnetization[axis][c] += weight * (gamma * rest[axis] - correction * v[axis]);
        } else polarization[axis][c] += weight * gamma * cross(v, rest)[axis] / C_LIGHT ** 2;
      }
    }
  }
  return { magnetization, polarization };
}

function backwardDerivative(field: Float64Array, g: DepositionGrid, axis: number, i: number, j: number, k: number, boundary: DepositBoundary): number {
  const p = [i, j, k], dims = [g.nx, g.ny, g.nz], h = [g.dx, g.dy, g.dz];
  const c = i + g.nx * (j + g.ny * k);
  p[axis]--;
  if (p[axis] < 0) {
    if (boundary === 'closed') return field[c] / h[axis];
    p[axis] += dims[axis];
  }
  return (field[c] - field[p[0] + g.nx * (p[1] + g.ny * p[2])]) / h[axis];
}

function validateField(field: MagnetVectorField, grid: DepositionGrid, boundary: DepositBoundary): number {
  const size = validateGrid(grid);
  if (field.length !== 3 || field.some(a => a.length !== size)) throw new Error('Magnet source field size does not match grid');
  if (boundary !== 'closed' && boundary !== 'periodic') throw new Error('Unsupported magnet derivative boundary');
  return size;
}

/** J_bound = backward curl M, compatible with the backward nodal divergence.
 * Closed boundaries extend missing samples by zero; periodic boundaries wrap.
 * For mixed outer walls, use closed with compact support away from every wall.
 */
export function magnetizationCurrent(magnetization: MagnetVectorField, grid: DepositionGrid, boundary: DepositBoundary = 'closed'): MagnetVectorField {
  const current = newField(validateField(magnetization, grid, boundary));
  for (let k = 0; k < grid.nz; k++) for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) {
    const c = i + grid.nx * (j + grid.ny * k);
    for (let axis = 0; axis < 3; axis++) {
      const y = (axis + 1) % 3, z = (axis + 2) % 3;
      current[axis][c] = backwardDerivative(magnetization[z], grid, y, i, j, k, boundary) - backwardDerivative(magnetization[y], grid, z, i, j, k, boundary);
    }
  }
  return current;
}

/** rho_bound = -backward div P. J_pol=(P_new-P_old)/dt then conserves this
 * charge algebraically, including current curl M because div(curl M)=0.
 */
export function polarizationCharge(polarization: MagnetVectorField, grid: DepositionGrid, boundary: DepositBoundary = 'closed'): Float64Array {
  const charge = new Float64Array(validateField(polarization, grid, boundary));
  for (let k = 0; k < grid.nz; k++) for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) {
    const c = i + grid.nx * (j + grid.ny * k);
    for (let axis = 0; axis < 3; axis++) charge[c] -= backwardDerivative(polarization[axis], grid, axis, i, j, k, boundary);
  }
  return charge;
}
