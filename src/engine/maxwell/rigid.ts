import { Euler, Quaternion, Vector3 } from 'three';
import type { Vec3 } from '../math/vec3';

interface RigidState {
  position: readonly number[]; rotation: readonly number[];
  velocity: readonly number[]; angularVelocity: readonly number[];
}

/** Nonrelativistic Newton-Euler mechanics with body-local principal inertia.
 * World angular velocity and quaternion orientation use explicit midpoint;
 * a constant world force uses the centered position/velocity update.
 */
export function advanceRigidBody(body: RigidState, force: Vec3, torque: Vec3, mass: number, inertia: Vec3, dt: number) {
  if (!(Number.isFinite(mass) && mass > 0 && Number.isFinite(dt) && dt > 0)
    || inertia.some(v => !(Number.isFinite(v) && v > 0))) throw new Error('Invalid rigid-body mass, inertia or timestep');
  const q = new Quaternion().setFromEuler(new Euler(...body.rotation as Vec3, 'XYZ'));
  const omega = new Vector3(...body.angularVelocity as Vec3);
  const acceleration = (orientation: Quaternion, w: Vector3) => {
    const inverse = orientation.clone().conjugate(), local = w.clone().applyQuaternion(inverse);
    const angularMomentum = new Vector3(...inertia).multiply(local);
    const localTorque = new Vector3(...torque).applyQuaternion(inverse).sub(local.clone().cross(angularMomentum));
    return localTorque.divide(new Vector3(...inertia)).applyQuaternion(orientation);
  };
  const rotate = (orientation: Quaternion, w: Vector3, duration: number) => {
    const speed = w.length();
    return speed === 0 ? orientation.clone() : new Quaternion().setFromAxisAngle(w.clone().divideScalar(speed), speed * duration).multiply(orientation).normalize();
  };
  const midOmega = omega.clone().addScaledVector(acceleration(q, omega), dt / 2);
  const midQ = rotate(q, omega, dt / 2);
  const nextOmega = omega.clone().addScaledVector(acceleration(midQ, midOmega), dt);
  const nextQ = rotate(q, midOmega, dt), euler = new Euler().setFromQuaternion(nextQ, 'XYZ');
  return {
    position: body.position.map((x, a) => x + body.velocity[a] * dt + force[a] * dt ** 2 / (2 * mass)) as Vec3,
    velocity: body.velocity.map((v, a) => v + force[a] * dt / mass) as Vec3,
    rotation: [euler.x, euler.y, euler.z] as Vec3,
    angularVelocity: nextOmega.toArray() as Vec3,
  };
}
