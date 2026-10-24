import { Euler, Quaternion, Vector3 } from 'three';
import type { Vec3 } from '../engine/math/vec3';
import type { MotionSpec, SceneObject } from './types';

function keyframeInterval(spec: Extract<MotionSpec, { kind: 'keyframes' }>, time: number) {
  const frames = spec.keyframes;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (!Number.isFinite(frame.time) || frame.time < 0 || !frame.position.every(Number.isFinite) || !frame.rotation.every(Number.isFinite)) throw new Error('Motion keyframes require finite positions, rotations, and nonnegative times');
    if (i > 0 && frame.time <= frames[i - 1].time) throw new Error('Motion keyframe times must be strictly increasing');
  }
  if (!frames.length) return null;
  const last = frames.at(-1)!, duration = last.time;
  const t = spec.loop && duration > 0 ? ((time % duration) + duration) % duration : Math.max(0, time);
  if (t < frames[0].time || frames.length === 1) return { a: frames[0], b: frames[0], f: 0, active: false };
  if (t >= last.time) return { a: last, b: last, f: 0, active: false };
  let i = 0;
  // The right-hand derivative defines velocity at an interior knot.
  while (i < frames.length - 2 && t >= frames[i + 1].time) i++;
  const a = frames[i], b = frames[i + 1];
  return { a, b, f: (t - a.time) / (b.time - a.time), active: spec.loop || time >= frames[0].time };
}

function motionAxis(spec: Exclude<MotionSpec, { kind: 'keyframes' }>): Vector3 {
  if (!spec.axis.every(Number.isFinite) || !Number.isFinite(spec.frequency) || !Number.isFinite(spec.amplitude) || !Number.isFinite(spec.phase ?? 0)) throw new Error('Periodic motion parameters must be finite');
  const axis = new Vector3(...spec.axis);
  if (axis.lengthSq() < 1e-20) axis.set(0, 0, 1);
  return axis.normalize();
}

/** Prescribed rigid motion. Keyframe positions/angles are offsets from the base pose. */
export function motionAt(object: SceneObject, time: number): { id: string; position: Vec3; rotation: Vec3 } {
  const position: Vec3 = [...object.position];
  let rotation: Vec3 = [...object.rotation];
  const spec = object.motion;
  if (!spec || object.dynamics?.mode === 'fixed' || object.dynamics?.mode === 'forceDriven') return { id: object.id, position, rotation };
  if (!Number.isFinite(time)) throw new Error('Motion time must be finite');
  if (spec.kind === 'keyframes') {
    const interval = keyframeInterval(spec, time);
    if (!interval) return { id: object.id, position, rotation };
    const { a, b, f } = interval;
    for (let i = 0; i < 3; i++) {
      position[i] += a.position[i] + (b.position[i] - a.position[i]) * f;
      rotation[i] += a.rotation[i] + (b.rotation[i] - a.rotation[i]) * f;
    }
  } else {
    const axis = motionAxis(spec);
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

/** Exact instantaneous prescribed velocity of a material point at worldPoint.
 * Runtime force-driven poses and velocities belong to the dynamics integrator.
 * Keyframes are piecewise linear, with zero velocity before/after their range.
 */
export function motionVelocityAt(object: SceneObject, time: number, worldPoint: Vec3): Vec3 {
  const spec = object.motion;
  if (!spec || object.dynamics?.mode === 'fixed' || object.dynamics?.mode === 'forceDriven') return [0, 0, 0];
  if (!Number.isFinite(time) || !worldPoint.every(Number.isFinite)) throw new Error('Motion time and world point must be finite');
  const velocity: Vec3 = [0, 0, 0], omega: Vec3 = [0, 0, 0];
  if (spec.kind === 'keyframes') {
    const interval = keyframeInterval(spec, time);
    if (!interval?.active) return velocity;
    const { a, b, f } = interval, dt = b.time - a.time;
    const rate = a.rotation.map((v, n) => (b.rotation[n] - v) / dt);
    for (let n = 0; n < 3; n++) velocity[n] = (b.position[n] - a.position[n]) / dt;
    const x = object.rotation[0] + a.rotation[0] + (b.rotation[0] - a.rotation[0]) * f;
    const y = object.rotation[1] + a.rotation[1] + (b.rotation[1] - a.rotation[1]) * f;
    // R = Rx(x) Ry(y) Rz(z): convert Euler rates into world angular velocity.
    omega[0] = rate[0] + rate[2] * Math.sin(y);
    omega[1] = rate[1] * Math.cos(x) - rate[2] * Math.sin(x) * Math.cos(y);
    omega[2] = rate[1] * Math.sin(x) + rate[2] * Math.cos(x) * Math.cos(y);
  } else {
    const axis = motionAxis(spec), rate = 2 * Math.PI * spec.frequency;
    const scale = spec.kind === 'spin' ? rate : spec.amplitude * rate * Math.cos(rate * time + (spec.phase ?? 0));
    const target = spec.kind === 'spin' ? omega : velocity;
    for (let a = 0; a < 3; a++) target[a] = axis.getComponent(a) * scale;
  }
  const center = motionAt(object, time).position, r = worldPoint.map((v, a) => v - center[a]);
  return [velocity[0] + omega[1] * r[2] - omega[2] * r[1],
    velocity[1] + omega[2] * r[0] - omega[0] * r[2],
    velocity[2] + omega[0] * r[1] - omega[1] * r[0]];
}
