import type { WireObject, LoopObject, CoilObject } from '../../scene/types';
import type { Vec3 } from '../math/vec3';
import { rotateEuler } from '../../scene/defaults';
import { wirePath } from '../../scene/wirePath';

export interface FilamentGeometry {
  contains(worldPoint: Vec3): boolean;
  /** Conservative world AABB, including the physical tube radius. */
  min: Vec3;
  max: Vec3;
}
type FilamentObject = WireObject | LoopObject | CoilObject;
interface Segment { x: number; y: number; z: number; dx: number; dy: number; dz: number; inverseLength2: number; }

/** Geometry only: a tube of the authored physical radius. It neither applies
 * current nor widens/softens unresolved wire. The supplied pose is captured.
 * Wires use the renderer's shared sampled wirePath; loops use an exact torus;
 * coils follow the existing positive-angle, increasing-local-Z helix with
 * max(1,round(turns)) turns, and round endpoint caps. Coil chord length is at
 * most min(spacing,wireRadius/2), so its centreline error decreases on refinement.
 */
export function makeFilamentGeometry(object: FilamentObject, spacing: number): FilamentGeometry {
  const radius = object.wireRadius;
  if (!Number.isFinite(spacing) || spacing <= 0) throw new Error('Filament grid spacing must be finite and positive');
  if (!Number.isFinite(radius) || radius <= 0) throw new Error(`${object.name}: wire radius must be finite and positive`);
  if (radius < 1.5 * spacing) {
    throw new Error(`${object.name}: passive wire radius ${radius} m is unresolved. Require radius >= ${1.5 * spacing} m (diameter >= ${3 * spacing} m, three grid cells), or spacing <= ${radius / 1.5} m. Increase grid resolution or the physical wire thickness.`);
  }
  if ([...object.position, ...object.rotation].some(v => !Number.isFinite(v))) throw new Error('Filament position and rotation must be finite');
  const position: Vec3 = [...object.position];
  const basis = ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]).map(v => rotateEuler(v, object.rotation));
  let low: Vec3, high: Vec3;
  let localContains: (x: number, y: number, z: number) => boolean;
  const radius2 = radius * radius;
  if (object.kind === 'loop') {
    if (!Number.isFinite(object.radius) || object.radius <= 0) throw new Error('Loop radius must be finite and positive');
    const majorRadius = object.radius, outer = majorRadius + radius;
    low = [-outer, -outer, -radius]; high = [outer, outer, radius];
    localContains = (x, y, z) => (Math.hypot(x, y) - majorRadius) ** 2 + z * z <= radius2;
  } else {
    let points: Vec3[];
    if (object.kind === 'wire') {
      if (object.points.length < 2 || object.points.some(p => p.some(v => !Number.isFinite(v)))) throw new Error('Wire needs at least two finite centreline points');
      points = wirePath(object).map(p => [...p] as Vec3);
      if (object.closed) points.push([...points[0]]);
    } else {
      if (![object.radius, object.length, object.turns].every(v => Number.isFinite(v) && v > 0)) throw new Error('Coil radius, length and turns must be finite and positive');
      const turns = Math.max(1, Math.round(object.turns)), chord = Math.min(spacing, radius / 2);
      const perTurn = Math.max(18, Math.ceil(2 * Math.PI * object.radius / chord)), count = turns * perTurn;
      if (!Number.isSafeInteger(count) || count > 250_000) throw new Error('Passive coil geometry exceeds the segment budget. Reduce turns or choose a coarser resolved grid.');
      points = Array.from({ length: count + 1 }, (_, i) => {
        const angle = i / count * 2 * Math.PI * turns;
        return [object.radius * Math.cos(angle), object.radius * Math.sin(angle), -object.length / 2 + i / count * object.length];
      });
    }
    low = [Infinity, Infinity, Infinity]; high = [-Infinity, -Infinity, -Infinity];
    for (const p of points) for (let a = 0; a < 3; a++) { low[a] = Math.min(low[a], p[a] - radius); high[a] = Math.max(high[a], p[a] + radius); }
    const bucketSize = 2 * radius, segments: Segment[] = [], buckets = new Map<string, number[]>();
    let references = 0;
    for (let p = 1; p < points.length; p++) {
      const a = points[p - 1], b = points[p], delta = b.map((v, axis) => v - a[axis]);
      const length = Math.hypot(...delta);
      if (!Number.isFinite(length)) throw new Error('Filament segment length must be finite');
      if (length === 0) continue;
      // Short collinear pieces preserve the exact polyline geometry while
      // keeping diagonal segments from filling an enormous 3D AABB of buckets.
      const count = Math.max(1, Math.ceil(length / bucketSize));
      if (!Number.isSafeInteger(count) || segments.length + count > 250_000) throw new Error('Passive wire geometry exceeds the segment budget. Reduce path complexity or use a coarser resolved grid.');
      for (let piece = 0; piece < count; piece++) {
        const start = a.map((v, axis) => v + delta[axis] * piece / count);
        const end = a.map((v, axis) => v + delta[axis] * (piece + 1) / count);
        const d = end.map((v, axis) => v - start[axis]), norm2 = d.reduce((s, v) => s + v * v, 0);
        if (norm2 === 0) continue;
        const id = segments.length;
        segments.push({ x: start[0], y: start[1], z: start[2], dx: d[0], dy: d[1], dz: d[2], inverseLength2: 1 / norm2 });
        const lo = start.map((v, axis) => Math.floor((Math.min(v, end[axis]) - radius) / bucketSize));
        const hi = start.map((v, axis) => Math.floor((Math.max(v, end[axis]) + radius) / bucketSize));
        if ([...lo, ...hi].some(v => !Number.isSafeInteger(v))) throw new Error('Filament coordinates exceed the safe bucket-index range');
        for (let k = lo[2]; k <= hi[2]; k++) for (let j = lo[1]; j <= hi[1]; j++) for (let i = lo[0]; i <= hi[0]; i++) {
          const key = `${i},${j},${k}`, bucket = buckets.get(key);
          if (bucket) bucket.push(id); else buckets.set(key, [id]);
          if (++references > 4_000_000) throw new Error('Passive filament spatial buckets exceed the memory budget. Reduce path complexity.');
        }
      }
    }
    if (!segments.length) throw new Error('Wire centreline is degenerate: provide distinct points with nonzero length');
    localContains = (x, y, z) => {
      const candidates = buckets.get(`${Math.floor(x / bucketSize)},${Math.floor(y / bucketSize)},${Math.floor(z / bucketSize)}`);
      if (!candidates) return false;
      for (const id of candidates) {
        const s = segments[id], rx = x - s.x, ry = y - s.y, rz = z - s.z;
        const t = Math.max(0, Math.min(1, (rx * s.dx + ry * s.dy + rz * s.dz) * s.inverseLength2));
        const dx = rx - t * s.dx, dy = ry - t * s.dy, dz = rz - t * s.dz;
        if (dx * dx + dy * dy + dz * dz <= radius2) return true;
      }
      return false;
    };
  }
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const p = [i ? high[0] : low[0], j ? high[1] : low[1], k ? high[2] : low[2]];
    for (let a = 0; a < 3; a++) {
      const v = position[a] + p[0] * basis[0][a] + p[1] * basis[1][a] + p[2] * basis[2][a];
      min[a] = Math.min(min[a], v); max[a] = Math.max(max[a], v);
    }
  }
  if ([...min, ...max].some(x => !Number.isFinite(x))) throw new Error('Filament bounds must be finite');
  return { min, max, contains: p => {
    const rx = p[0] - position[0], ry = p[1] - position[1], rz = p[2] - position[2];
    const x = rx * basis[0][0] + ry * basis[0][1] + rz * basis[0][2];
    const y = rx * basis[1][0] + ry * basis[1][1] + rz * basis[1][2];
    const z = rx * basis[2][0] + ry * basis[2][1] + rz * basis[2][2];
    if (x < low[0] || x > high[0] || y < low[1] || y > high[1] || z < low[2] || z > high[2]) return false;
    return localContains(x, y, z);
  } };
}
