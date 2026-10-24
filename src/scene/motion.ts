import { Euler, Quaternion, Vector3 } from 'three';
import type { Vec3 } from '../engine/math/vec3';
import type { SceneObject } from './types';

/** Prescribed rigid motion. Keyframe positions/angles are offsets from the base pose. */
export function motionAt(object: SceneObject, time: number): { id: string; position: Vec3; rotation: Vec3 } {
  const position: Vec3 = [...object.position];
  let rotation: Vec3 = [...object.rotation];
  const spec = object.motion;
  if (!spec) return { id: object.id, position, rotation };
  if (spec.kind === 'keyframes') {
    const frames = spec.keyframes;
    if (frames.length === 0) return { id: object.id, position, rotation };
    const duration = frames[frames.length - 1].time;
    const t = spec.loop && duration > 0 ? ((time % duration) + duration) % duration : Math.max(0, time);
    let a = frames[0], b = a;
    for (const frame of frames) {
      b = frame;
      if (t <= frame.time) break;
      a = frame;
    }
    const f = a === b ? 0 : Math.max(0, Math.min(1, (t - a.time) / (b.time - a.time)));
    for (let i = 0; i < 3; i++) {
      position[i] += a.position[i] + (b.position[i] - a.position[i]) * f;
      rotation[i] += a.rotation[i] + (b.rotation[i] - a.rotation[i]) * f;
    }
  } else {
    const axis = new Vector3(...spec.axis);
    if (axis.lengthSq() < 1e-20) axis.set(0, 0, 1);
    axis.normalize();
    const angle = 2 * Math.PI * spec.frequency * time + (spec.phase ?? 0);
    if (spec.kind === 'oscillate') {
      const offset = spec.amplitude * Math.sin(angle);
      for (let i = 0; i < 3; i++) position[i] += axis.getComponent(i) * offset;
    } else {
      const q = new Quaternion().setFromAxisAngle(axis, angle)
        .multiply(new Quaternion().setFromEuler(new Euler(...object.rotation)));
      const euler = new Euler().setFromQuaternion(q, 'XYZ');
      rotation = [euler.x, euler.y, euler.z];
    }
  }
  return { id: object.id, position, rotation };
}
