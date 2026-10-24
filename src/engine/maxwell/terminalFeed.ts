import type { Vec3 } from '../math/vec3';
import { trajectoryWeights, type DepositionGrid, type TrajectoryWeight } from './deposition';

export interface FeedContactWeight { node: number; weight: number }

/** Exact SI charge over [time,time+dt] for I*(3u²-2u³), u=min(t/riseTime,1).
 * Integrating the local cubic avoids cancellation between large antiderivatives;
 * after startup the duration is dt even when time+dt would round back to time.
 */
export function integrateFeedCharge(current: number, riseTime: number, time: number, dt: number): number {
  if (![current, riseTime, time, dt].every(Number.isFinite)) throw new Error('Terminal current and time parameters must be finite');
  if (riseTime < 0 || time < 0) throw new Error('Terminal rise time and physical time must be nonnegative');
  if (dt <= 0) throw new Error('Terminal time step must be positive');
  let duration = dt;
  if (time < riseTime) {
    const rampDuration = Math.min(dt, riseTime - time);
    const u = time / riseTime, width = rampDuration / riseTime, midpoint = u + width / 2;
    // The average of a cubic is its midpoint value plus f''(midpoint)*width²/24.
    const average = midpoint * midpoint * (3 - 2 * midpoint) + (1 - 2 * midpoint) * width * width / 4;
    duration = rampDuration * average + (dt - rampDuration);
  }
  const charge = current * duration;
  if (!Number.isFinite(charge)) throw new Error('Integrated terminal charge exceeds finite numerical range');
  return charge;
}

function validateGrid(grid: DepositionGrid): void {
  if (![grid.nx, grid.ny, grid.nz].every(v => Number.isSafeInteger(v) && v > 0)
    || ![grid.dx, grid.dy, grid.dz].every(v => Number.isFinite(v) && v > 0)
    || !Number.isSafeInteger(grid.nx * grid.ny * grid.nz)) {
    throw new Error('Terminal deposition grid dimensions and spacings must be finite and positive');
  }
}

/** Match closed depositCharge coordinates, including its boundary roundoff clamp.
 * Interior coordinates deliberately receive no snapping or tolerance pruning.
 */
function gridCoordinates(grid: DepositionGrid, point: Vec3): number[] {
  if (point.length !== 3 || !point.every(Number.isFinite)) throw new Error('Terminal contact/path coordinates must be finite 3D points');
  const dimensions = [grid.nx, grid.ny, grid.nz], spacing = [grid.dx, grid.dy, grid.dz];
  return point.map((value, axis) => {
    const coordinate = value / spacing[axis], tolerance = 32 * Number.EPSILON * Math.max(1, dimensions[axis]);
    if (!Number.isFinite(coordinate)) throw new Error('Terminal contact/path grid coordinates must be finite');
    if (coordinate < -tolerance || coordinate > dimensions[axis] - 1 + tolerance) {
      throw new Error('Terminal contact/path leaves the closed deposition domain boundary; move the entire feed inside the grid');
    }
    return Math.max(0, Math.min(dimensions[axis] - 1, coordinate));
  });
}

/** Resolve every nonzero endpoint CIC corner to its unique terminal-owned node.
 * Material lattice roundoff is accepted; missing endpoint support is never
 * snapped, pruned, or renormalized. Returned node indices address materialNodes.
 */
export function resolveFeedContact(grid: DepositionGrid, endpoint: Vec3, materialNodes: readonly Vec3[]): FeedContactWeight[] {
  validateGrid(grid);
  const dimensions = [grid.nx, grid.ny, grid.nz], material = new Map<number, number>();
  const flatten = (p: number[]) => p[0] + grid.nx * (p[1] + grid.ny * p[2]);
  materialNodes.forEach((position, node) => {
    const coordinates = gridCoordinates(grid, position), integer = coordinates.map(Math.round);
    if (coordinates.some((value, axis) => Math.abs(value - integer[axis]) > 32 * Number.EPSILON * Math.max(1, dimensions[axis]))) {
      throw new Error('Terminal material nodes must be aligned to the initial deposition lattice');
    }
    const cell = flatten(integer);
    if (material.has(cell)) throw new Error('Terminal contact is ambiguous: duplicate material lattice nodes must be unique');
    material.set(cell, node);
  });
  const coordinates = gridCoordinates(grid, endpoint), base = coordinates.map(Math.floor);
  const fraction = coordinates.map((value, axis) => value - base[axis]), contact: FeedContactWeight[] = [];
  for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const weight = (i ? fraction[0] : 1 - fraction[0]) * (j ? fraction[1] : 1 - fraction[1]) * (k ? fraction[2] : 1 - fraction[2]);
    if (weight === 0) continue;
    const corner = [base[0] + i, base[1] + j, base[2] + k], node = material.get(flatten(corner));
    if (node === undefined) {
      throw new Error(`Terminal contact lacks CIC support at lattice node (${corner.join(', ')}); move the endpoint fully inside its named body's material lattice or refine the grid`);
    }
    contact.push({ node, weight });
  }
  return contact;
}

function validateContact(contact: readonly FeedContactWeight[], expected: readonly FeedContactWeight[]): void {
  const nodes = new Set<number>(), weights = new Map(expected.map(c => [c.node, c.weight]));
  for (const entry of contact) {
    if (!Number.isSafeInteger(entry.node) || !weights.has(entry.node)) throw new Error('Terminal contact refers to a node outside its endpoint CIC support');
    if (nodes.has(entry.node)) throw new Error('Terminal contact node entries must be unique; duplicate contact found');
    nodes.add(entry.node);
    const weight = weights.get(entry.node)!;
    if (!Number.isFinite(entry.weight) || entry.weight <= 0 || Math.abs(entry.weight - weight) > 64 * Number.EPSILON * weight) {
      throw new Error('Terminal contact weight must retain the complete unmodified endpoint CIC weight');
    }
  }
  if (nodes.size !== weights.size) throw new Error('Terminal contact is missing nonzero CIC support; resolve the complete contact before compiling');
}

/** Compile the impressed path and its terminal contact fans before mutating any
 * charge/field state. The first terminal loses q*weight and the last gains it.
 * Add Jedge += q/(dt*cellVolume)*length. Duplicates remain in path order, so
 * summing Eedge*length gives the exact adjoint voltage of this deposited current.
 */
export function compileFeedWeights(grid: DepositionGrid, path: readonly Vec3[], fromNodes: readonly Vec3[],
  fromContact: readonly FeedContactWeight[], toNodes: readonly Vec3[], toContact: readonly FeedContactWeight[]): TrajectoryWeight[] {
  validateGrid(grid);
  if (path.length < 2) throw new Error('Terminal feed path must contain at least two points');
  for (const point of path) gridCoordinates(grid, point);
  const first = path[0], last = path[path.length - 1];
  validateContact(fromContact, resolveFeedContact(grid, first, fromNodes));
  validateContact(toContact, resolveFeedContact(grid, last, toNodes));
  const weights: TrajectoryWeight[] = [];
  for (let i = 1; i < path.length; i++) weights.push(...trajectoryWeights(grid, path[i - 1], path[i]));
  const appendFan = (a: Vec3, b: Vec3, weight: number) => {
    for (const edge of trajectoryWeights(grid, a, b)) weights.push({ ...edge, length: edge.length * weight });
  };
  for (const contact of fromContact) appendFan(fromNodes[contact.node], first, contact.weight);
  for (const contact of toContact) appendFan(last, toNodes[contact.node], contact.weight);
  return weights;
}
