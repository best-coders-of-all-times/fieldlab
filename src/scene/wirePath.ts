import { CatmullRomCurve3, Vector3 } from 'three';
import type { WireObject } from './types';
import type { Vec3 } from '../engine/math/vec3';

/** The same sampled centreline is consumed by the renderer and Biot–Savart. */
export function wirePath(wire: WireObject): Vec3[] {
  if (wire.path !== 'smooth' || wire.points.length < 3) return wire.points;
  const curve = new CatmullRomCurve3(wire.points.map(p => new Vector3(...p)), wire.closed, 'centripetal');
  const count = Math.min(2048, Math.max(64, wire.points.length * 16));
  const points = curve.getPoints(count).map(p => [p.x, p.y, p.z] as Vec3);
  if (wire.closed) points.pop();
  return points;
}
