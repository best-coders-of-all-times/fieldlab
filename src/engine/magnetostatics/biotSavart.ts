import { wirePath } from '../../scene/wirePath';
import { MU0 } from '../constants';
import type { Vec3 } from '../math/vec3';
import { localToWorld, worldAxis } from '../../scene/defaults';
import type {
  CoilObject,
  LoopObject,
  MagnetObject,
  SceneObject,
  WireObject,
} from '../../scene/types';
import { isCoil, isLoop, isMagnet, isWire } from '../../scene/types';

export interface SegmentSet {
  /** Flat [ax, ay, az, bx, by, bz] per segment. */
  segs: Float32Array;
  currents: Float32Array;
  count: number;
  softening: number;
  softenings?: Float32Array; // each source retains its own filament radius
}

export interface MagnetSurfaceCurrent {
  object: MagnetObject;
  currentDensity: number; // A/m
  axis: Vec3;
}

export interface MagnetostaticSources {
  segments: SegmentSet;
  magnets: MagnetSurfaceCurrent[];
  inductance: number;
  hasSources: boolean;
}

function pushSegment(
  data: number[],
  currents: number[],
  a: Vec3,
  b: Vec3,
  current: number,
  maxLength: number,
): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  const n = Math.max(1, Math.ceil(len / maxLength));
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    data.push(
      a[0] + dx * t0, a[1] + dy * t0, a[2] + dz * t0,
      a[0] + dx * t1, a[1] + dy * t1, a[2] + dz * t1,
    );
    currents.push(current);
  }
}

function wireSegments(obj: WireObject, data: number[], currents: number[], maxLength: number): void {
  if (obj.points.length < 2) return;
  const pts = wirePath(obj).map((p) => localToWorld(obj, p));
  for (let i = 0; i < pts.length - 1; i++) {
    pushSegment(data, currents, pts[i], pts[i + 1], obj.current, maxLength);
  }
  if (obj.closed) pushSegment(data, currents, pts[pts.length - 1], pts[0], obj.current, maxLength);
}

function loopSegments(obj: LoopObject, data: number[], currents: number[], maxLength: number): void {
  const n = Math.max(32, Math.ceil((2 * Math.PI * obj.radius) / maxLength));
  let prev: Vec3 = localToWorld(obj, [obj.radius, 0, 0]);
  for (let i = 1; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const p = localToWorld(obj, [obj.radius * Math.cos(a), obj.radius * Math.sin(a), 0]);
    pushSegment(data, currents, prev, p, obj.current, maxLength);
    prev = p;
  }
}

function coilSegments(obj: CoilObject, data: number[], currents: number[], maxLength: number): void {
  const turns = Math.max(1, Math.round(obj.turns));
  const perTurn = Math.max(18, Math.ceil((2 * Math.PI * obj.radius) / maxLength));
  const total = turns * perTurn;
  let prev: Vec3 | null = null;
  for (let i = 0; i <= total; i++) {
    const a = (i / total) * Math.PI * 2 * turns;
    const z = -obj.length / 2 + (i / total) * obj.length;
    const p = localToWorld(obj, [obj.radius * Math.cos(a), obj.radius * Math.sin(a), z]);
    if (prev) pushSegment(data, currents, prev, p, obj.current, maxLength);
    prev = p;
  }
}

/** Equivalent surface-current model of a uniformly magnetised cylinder. */
function magnetSegments(obj: MagnetObject, data: number[], currents: number[], maxLength: number): void {
  const loops = 16;
  const perLoop = Math.max(28, Math.ceil((2 * Math.PI * obj.radius) / maxLength));
  const current = (obj.magnetization * obj.length) / loops;
  for (let layer = 0; layer < loops; layer++) {
    const z = -obj.length / 2 + ((layer + 0.5) / loops) * obj.length;
    let prev: Vec3 = localToWorld(obj, [obj.radius, 0, z]);
    for (let i = 1; i <= perLoop; i++) {
      const a = (i / perLoop) * Math.PI * 2;
      const p = localToWorld(obj, [obj.radius * Math.cos(a), obj.radius * Math.sin(a), z]);
      pushSegment(data, currents, prev, p, current, maxLength);
      prev = p;
    }
  }
}

export function estimateInductance(objects: SceneObject[]): number {
  let total = 0;
  for (const obj of objects) {
    if (!obj.visible) continue;
    if (isLoop(obj)) {
      const a = Math.max(obj.wireRadius, obj.radius * 0.002);
      total += MU0 * obj.radius * (Math.log((8 * obj.radius) / a) - 2);
    } else if (isCoil(obj)) {
      total += (MU0 * obj.turns * obj.turns * Math.PI * obj.radius * obj.radius) / Math.max(obj.length, 1e-6);
    }
  }
  return total;
}

export function buildMagnetostaticSources(objects: SceneObject[]): MagnetostaticSources {
  const data: number[] = [];
  const currents: number[] = [];
  const magnets: MagnetSurfaceCurrent[] = [];
  const softenings: number[] = [];
  const maxLength = 0.03;
  let softening = 0.006;

  for (const obj of objects) {
    if (!obj.visible) continue;
    softening = 0.006;
    if (isWire(obj)) {
      wireSegments(obj, data, currents, maxLength);
      softening = Math.max(0.001, obj.wireRadius * 1.2);
    } else if (isLoop(obj)) {
      loopSegments(obj, data, currents, maxLength);
      softening = Math.max(0.001, obj.wireRadius * 1.2);
    } else if (isCoil(obj)) {
      coilSegments(obj, data, currents, maxLength);
      softening = Math.max(0.001, obj.wireRadius * 1.2);
    } else if (isMagnet(obj)) {
      magnetSegments(obj, data, currents, maxLength);
      magnets.push({
        object: obj,
        currentDensity: obj.magnetization,
        axis: worldAxis(obj, [0, 0, 1]),
      });
    }
    while (softenings.length < currents.length) softenings.push(softening);
  }

  return {
    segments: {
      segs: new Float32Array(data),
      currents: new Float32Array(currents),
      count: currents.length,
      softening,
      softenings: new Float32Array(softenings),
    },
    magnets,
    inductance: estimateInductance(objects),
    hasSources: currents.length > 0,
  };
}

export function sampleBAt(
  set: SegmentSet,
  p: Vec3,
  soft?: number,
  out: Vec3 = [0, 0, 0],
): Vec3 {
  let bx = 0, by = 0, bz = 0;
  const k = MU0 / (4 * Math.PI);
  const segs = set.segs;
  for (let i = 0, o = 0; i < set.count; i++, o += 6) {
    const radius = soft ?? set.softenings?.[i] ?? set.softening;
    const s2 = radius * radius;
    const ax = segs[o], ay = segs[o + 1], az = segs[o + 2];
    const bxs = segs[o + 3], bys = segs[o + 4], bzs = segs[o + 5];
    const dlx = bxs - ax, dly = bys - ay, dlz = bzs - az;
    // r points from the source element to the observer: dl × r.
    const mx = p[0] - (ax + bxs) * 0.5;
    const my = p[1] - (ay + bys) * 0.5;
    const mz = p[2] - (az + bzs) * 0.5;
    const r2 = mx * mx + my * my + mz * mz + s2;
    const inv = (k * set.currents[i]) / (r2 * Math.sqrt(r2));
    // dl × r
    bx += (dly * mz - dlz * my) * inv;
    by += (dlz * mx - dlx * mz) * inv;
    bz += (dlx * my - dly * mx) * inv;
  }
  out[0] = bx; out[1] = by; out[2] = bz;
  return out;
}

/** Numerical magnetic flux through a circular loop. */
export function fluxThroughLoop(segments: SegmentSet, loop: LoopObject, samples = 24): number {
  const normal = worldAxis(loop, [0, 0, 1]);
  const e1: Vec3 = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  // orthonormal basis in the loop plane
  const ux = e1[1] * normal[2] - e1[2] * normal[1];
  const uy = e1[2] * normal[0] - e1[0] * normal[2];
  const uz = e1[0] * normal[1] - e1[1] * normal[0];
  const un = Math.hypot(ux, uy, uz) || 1;
  const u: Vec3 = [ux / un, uy / un, uz / un];
  const v: Vec3 = [
    normal[1] * u[2] - normal[2] * u[1],
    normal[2] * u[0] - normal[0] * u[2],
    normal[0] * u[1] - normal[1] * u[0],
  ];
  let flux = 0;
  const dr = loop.radius / samples;
  for (let i = 0; i < samples; i++) {
    const r = (i + 0.5) * dr;
    const dtheta = (Math.PI * 2) / samples;
    for (let j = 0; j < samples; j++) {
      const th = (j + 0.5) * dtheta;
      const p: Vec3 = [
        loop.position[0] + u[0] * r * Math.cos(th) + v[0] * r * Math.sin(th),
        loop.position[1] + u[1] * r * Math.cos(th) + v[1] * r * Math.sin(th),
        loop.position[2] + u[2] * r * Math.cos(th) + v[2] * r * Math.sin(th),
      ];
      const B = sampleBAt(segments, p);
      const bx = B[0] * normal[0] + B[1] * normal[1] + B[2] * normal[2];
      flux += bx * r * dr * dtheta;
    }
  }
  return flux;
}
