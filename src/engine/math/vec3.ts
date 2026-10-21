export type Vec3 = [number, number, number];

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];
export const clone = (a: Vec3): Vec3 => [a[0], a[1], a[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const len2 = (a: Vec3): number => dot(a, a);

export function normalize(a: Vec3): Vec3 {
  const l = len(a);
  return l < 1e-30 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
}

export function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function shift(a: Vec3, sx: number, sy: number, sz: number): Vec3 {
  return [a[0] + sx, a[1] + sy, a[2] + sz];
}

/** Spherical to Cartesian. theta = polar angle from +y, phi = azimuth in xz-plane. */
export function spherical(radius: number, theta: number, phi: number): Vec3 {
  const st = Math.sin(theta);
  return [radius * st * Math.cos(phi), radius * Math.cos(theta), radius * st * Math.sin(phi)];
}

export function isFiniteVec(a: Vec3): boolean {
  return Number.isFinite(a[0]) && Number.isFinite(a[1]) && Number.isFinite(a[2]);
}

export function vecToArray(a: Vec3): number[] {
  return [a[0], a[1], a[2]];
}

export function arrayToVec(a: readonly number[]): Vec3 {
  return [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];
}
