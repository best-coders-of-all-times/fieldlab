import type { Vec3 } from '../math/vec3';
import { K_E } from '../constants';

export interface CoulombBoundaryOptions {
  /** Accept a node when source-enclosing radius / target distance < this. */
  openingAngle?: number;
  leafSize?: number;
}
interface TreeNode {
  x: number; y: number; z: number; radius2: number;
  indices: number[]; children: number[];
  /** Q, px, py, pz, Sxx, Syy, Szz, Sxy, Sxz, Syz; Sij=sum(q ri rj). */
  moment: Float64Array;
}

function flattenPositions(positions: readonly Vec3[], name: string): Float64Array {
  const values = new Float64Array(3 * positions.length);
  for (let i = 0; i < positions.length; i++) for (let a = 0; a < 3; a++) {
    const value = positions[i][a];
    if (!Number.isFinite(value)) throw new Error(`${name} positions must be finite`);
    values[3 * i + a] = value;
  }
  return values;
}
function validateCharges(charges: Float64Array, size: number) {
  if (charges.length !== size) throw new Error('Coulomb charge array length does not match source positions');
  for (const q of charges) if (!Number.isFinite(q)) throw new Error('Coulomb charges must be finite');
}
function outputFor(targets: readonly Vec3[], output?: Float64Array) {
  if (output && output.length !== targets.length) throw new Error('Coulomb output array length does not match target positions');
  for (const p of targets) if (![p[0], p[1], p[2]].every(Number.isFinite)) throw new Error('Coulomb target positions must be finite');
  return output ?? new Float64Array(targets.length);
}
function directAt(positions: Float64Array, charges: Float64Array, x: number, y: number, z: number, indices?: number[]): number {
  let sum = 0, compensation = 0;
  const size = indices?.length ?? charges.length;
  for (let n = 0; n < size; n++) {
    const i = indices ? indices[n] : n;
    const dx = x - positions[3 * i], dy = y - positions[3 * i + 1], dz = z - positions[3 * i + 2];
    const square = dx * dx + dy * dy + dz * dz;
    const r = Number.isFinite(square) ? Math.sqrt(square) : Math.hypot(dx, dy, dz);
    if (r === 0) throw new Error('Coulomb target is coincident with a source: singular potential, no softening applied');
    if (!Number.isFinite(r)) throw new Error('Coulomb source-target distance exceeds finite numerical range');
    const value = charges[i] / r - compensation, next = sum + value;
    compensation = (next - sum) - value; sum = next;
  }
  return sum;
}

/** Exact point-source SI reference sum, with compensated summation and no
 * softening, source pruning or implicit treatment of singular self terms. */
export function directCoulombPotentials(sourcePositions: readonly Vec3[], charges: Float64Array, targets: readonly Vec3[], output?: Float64Array): Float64Array {
  validateCharges(charges, sourcePositions.length);
  const positions = flattenPositions(sourcePositions, 'Source'), result = outputFor(targets, output);
  for (let i = 0; i < targets.length; i++) {
    const p = targets[i], potential = K_E * directAt(positions, charges, p[0], p[1], p[2]);
    if (!Number.isFinite(potential)) throw new Error('Coulomb potential exceeds finite numerical range');
    result[i] = potential;
  }
  return result;
}

/** Reusable fixed-geometry octree for initial free-space boundary potentials.
 * Coordinates are metres, source charges coulombs and output potentials volts.
 *
 * Geometry, geometric node centres and acceptance depend only on source/target
 * positions and openingAngle. Charge-dependent pruning/opening is deliberately
 * absent: changing charges preserves the same approximate linear operator for
 * a boundary Schur/Krylov solve, including zero or strongly cancelling charges.
 * Node expansions retain charge, dipole and full quadrupole terms. Accuracy is
 * controlled by theta refinement; .15 is a tested default, not a universal
 * relative-error guarantee at potential zeros. openingAngle=0 gives direct sums.
 */
export class CoulombBoundaryEvaluator {
  readonly openingAngle: number;
  readonly leafSize: number;
  private readonly positions: Float64Array;
  private readonly charges: Float64Array;
  private readonly nodes: TreeNode[] = [];

  constructor(sourcePositions: readonly Vec3[], options: CoulombBoundaryOptions = {}) {
    this.openingAngle = options.openingAngle ?? 0.15; this.leafSize = options.leafSize ?? 24;
    if (!Number.isFinite(this.openingAngle) || this.openingAngle < 0 || this.openingAngle >= 1) throw new Error('Coulomb opening angle must be finite and in [0,1)');
    if (!Number.isSafeInteger(this.leafSize) || this.leafSize < 1) throw new Error('Coulomb direct leaf size must be a positive integer');
    this.positions = flattenPositions(sourcePositions, 'Source'); this.charges = new Float64Array(sourcePositions.length);
    if (sourcePositions.length) this.build(Array.from({ length: sourcePositions.length }, (_, i) => i), 0);
  }

  private build(indices: number[], depth: number): number {
    let xmin = Infinity, ymin = Infinity, zmin = Infinity, xmax = -Infinity, ymax = -Infinity, zmax = -Infinity;
    for (const i of indices) {
      const x = this.positions[3 * i], y = this.positions[3 * i + 1], z = this.positions[3 * i + 2];
      xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); zmin = Math.min(zmin, z); zmax = Math.max(zmax, z);
    }
    const x = xmin / 2 + xmax / 2, y = ymin / 2 + ymax / 2, z = zmin / 2 + zmax / 2;
    let radius2 = 0;
    for (const i of indices) radius2 = Math.max(radius2, (this.positions[3 * i] - x) ** 2 + (this.positions[3 * i + 1] - y) ** 2 + (this.positions[3 * i + 2] - z) ** 2);
    if (!Number.isFinite(radius2)) throw new Error('Coulomb geometry exceeds finite moment numerical range');
    const id = this.nodes.length, node: TreeNode = { x, y, z, radius2, indices, children: [], moment: new Float64Array(10) };
    this.nodes.push(node);
    if (indices.length <= this.leafSize || radius2 === 0 || depth >= 48) return id;
    const buckets: number[][] = Array.from({ length: 8 }, () => []);
    for (const i of indices) buckets[(this.positions[3 * i] >= x ? 1 : 0) | (this.positions[3 * i + 1] >= y ? 2 : 0) | (this.positions[3 * i + 2] >= z ? 4 : 0)].push(i);
    if (buckets.some(b => b.length === indices.length)) return id;
    node.indices = [];
    for (const b of buckets) if (b.length) node.children.push(this.build(b, depth + 1));
    return id;
  }

  /** Copy new charge coefficients and update moments without rebuilding geometry. */
  setCharges(charges: Float64Array): void {
    validateCharges(charges, this.charges.length); this.charges.set(charges);
    // Children were appended after parents; reverse order is a bottom-up pass.
    for (let n = this.nodes.length - 1; n >= 0; n--) {
      const node = this.nodes[n], m = node.moment; m.fill(0);
      if (!node.children.length) for (const i of node.indices) {
        const q = charges[i], x = this.positions[3 * i] - node.x, y = this.positions[3 * i + 1] - node.y, z = this.positions[3 * i + 2] - node.z;
        m[0] += q; m[1] += q * x; m[2] += q * y; m[3] += q * z;
        m[4] += q * x * x; m[5] += q * y * y; m[6] += q * z * z; m[7] += q * x * y; m[8] += q * x * z; m[9] += q * y * z;
      }
      else for (const c of node.children) {
        const child = this.nodes[c], b = child.moment, x = child.x - node.x, y = child.y - node.y, z = child.z - node.z;
        m[0] += b[0]; m[1] += b[1] + b[0] * x; m[2] += b[2] + b[0] * y; m[3] += b[3] + b[0] * z;
        m[4] += b[4] + 2 * x * b[1] + b[0] * x * x;
        m[5] += b[5] + 2 * y * b[2] + b[0] * y * y;
        m[6] += b[6] + 2 * z * b[3] + b[0] * z * z;
        m[7] += b[7] + x * b[2] + y * b[1] + b[0] * x * y;
        m[8] += b[8] + x * b[3] + z * b[1] + b[0] * x * z;
        m[9] += b[9] + y * b[3] + z * b[2] + b[0] * y * z;
      }
      for (const value of m) if (!Number.isFinite(value)) throw new Error('Coulomb charge moments exceed finite numerical range');
    }
  }

  private at(n: number, x: number, y: number, z: number): number {
    const node = this.nodes[n];
    if (!node.children.length) return directAt(this.positions, this.charges, x, y, z, node.indices);
    const dx = x - node.x, dy = y - node.y, dz = z - node.z, d2 = dx * dx + dy * dy + dz * dz;
    if (node.radius2 < this.openingAngle ** 2 * d2 && Number.isFinite(d2)) {
      const inverse = 1 / Math.sqrt(d2), nx = dx * inverse, ny = dy * inverse, nz = dz * inverse, m = node.moment;
      const dipole = m[1] * nx + m[2] * ny + m[3] * nz;
      const second = m[4] * nx * nx + m[5] * ny * ny + m[6] * nz * nz + 2 * (m[7] * nx * ny + m[8] * nx * nz + m[9] * ny * nz);
      return inverse * (m[0] + inverse * (dipole + inverse * (1.5 * second - 0.5 * (m[4] + m[5] + m[6]))));
    }
    let sum = 0, compensation = 0;
    for (const child of node.children) {
      const value = this.at(child, x, y, z) - compensation, next = sum + value;
      compensation = (next - sum) - value; sum = next;
    }
    return sum;
  }

  evaluate(targets: readonly Vec3[], output?: Float64Array): Float64Array {
    const result = outputFor(targets, output);
    for (let i = 0; i < targets.length; i++) {
      const p = targets[i], potential = this.nodes.length ? K_E * this.at(0, p[0], p[1], p[2]) : 0;
      if (!Number.isFinite(potential)) throw new Error('Coulomb potential exceeds finite numerical range');
      result[i] = potential;
    }
    return result;
  }

  evaluateDirect(targets: readonly Vec3[], output?: Float64Array): Float64Array {
    const result = outputFor(targets, output);
    for (let i = 0; i < targets.length; i++) {
      const p = targets[i], potential = K_E * directAt(this.positions, this.charges, p[0], p[1], p[2]);
      if (!Number.isFinite(potential)) throw new Error('Coulomb potential exceeds finite numerical range');
      result[i] = potential;
    }
    return result;
  }
}
