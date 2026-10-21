import type { Vec3 } from '../math/vec3';
import { cross, dot, len } from '../math/vec3';

export interface BorisStepInput {
  position: Vec3;
  velocity: Vec3;
  charge: number;
  mass: number;
  E: Vec3;
  B: Vec3;
  dt: number;
}

export interface BorisStepResult {
  position: Vec3;
  velocity: Vec3;
}

/**
 * Standard Boris pusher. Energy is conserved to round-off in a pure magnetic
 * field, which makes it the right choice for long gyro-orbit visualisations.
 */
export function borisStep(input: BorisStepInput): BorisStepResult {
  const { position, velocity, charge, mass, E, B, dt } = input;
  if (mass <= 0) return { position, velocity };
  const qm = charge / mass;
  const half = (qm * dt) / 2;

  const vm: Vec3 = [
    velocity[0] + half * E[0],
    velocity[1] + half * E[1],
    velocity[2] + half * E[2],
  ];

  const t: Vec3 = [half * B[0], half * B[1], half * B[2]];
  const t2 = dot(t, t);
  const s: Vec3 = [t[0] * (2 / (1 + t2)), t[1] * (2 / (1 + t2)), t[2] * (2 / (1 + t2))];
  const vPrime: Vec3 = [
    vm[0] + (vm[1] * t[2] - vm[2] * t[1]),
    vm[1] + (vm[2] * t[0] - vm[0] * t[2]),
    vm[2] + (vm[0] * t[1] - vm[1] * t[0]),
  ];
  const vPlus: Vec3 = [
    vm[0] + (vPrime[1] * s[2] - vPrime[2] * s[1]),
    vm[1] + (vPrime[2] * s[0] - vPrime[0] * s[2]),
    vm[2] + (vPrime[0] * s[1] - vPrime[1] * s[0]),
  ];
  const v: Vec3 = [
    vPlus[0] + half * E[0],
    vPlus[1] + half * E[1],
    vPlus[2] + half * E[2],
  ];
  return {
    position: [
      position[0] + v[0] * dt,
      position[1] + v[1] * dt,
      position[2] + v[2] * dt,
    ],
    velocity: v,
  };
}

export function gyroperiod(charge: number, mass: number, B: number): number {
  const q = Math.abs(charge);
  return q * B > 0 ? (2 * Math.PI * mass) / (q * B) : Infinity;
}

export function gyroradius(velocity: Vec3, charge: number, mass: number, B: Vec3): number {
  const b = len(B);
  const q = Math.abs(charge);
  if (b < 1e-30 || q < 1e-30) return Infinity;
  const vPerp = Math.sqrt(Math.max(0, dot(velocity, velocity) - dot(velocity, B) ** 2 / (b * b)));
  return (mass * vPerp) / (q * b);
}

export function lorentzForce(charge: number, velocity: Vec3, E: Vec3, B: Vec3): Vec3 {
  const vxb = cross(velocity, B);
  return [charge * (E[0] + vxb[0]), charge * (E[1] + vxb[1]), charge * (E[2] + vxb[2])];
}
