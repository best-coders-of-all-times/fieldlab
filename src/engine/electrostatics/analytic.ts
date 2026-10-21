import { EPS0, K_E } from '../constants';
import type { Vec3 } from '../math/vec3';
import type { ChargedSphereObject, ChargeObject, SceneObject } from '../../scene/types';
import { isCharge, isChargedSphere } from '../../scene/types';

export interface PointChargeSource {
  position: Vec3;
  charge: number;
}

export interface SphereSource {
  position: Vec3;
  charge: number;
  radius: number;
  shell: boolean;
}

export interface AnalyticSources {
  points: PointChargeSource[];
  spheres: SphereSource[];
  external: Vec3;
}

export function collectAnalyticSources(objects: SceneObject[], external: Vec3 = [0, 0, 0]): AnalyticSources {
  const points: PointChargeSource[] = [];
  const spheres: SphereSource[] = [];
  for (const obj of objects) {
    if (!obj.visible) continue;
    if (isCharge(obj)) {
      points.push({ position: obj.position, charge: obj.charge });
    } else if (isChargedSphere(obj)) {
      spheres.push({
        position: obj.position,
        charge: obj.charge,
        radius: obj.radius,
        shell: obj.shell,
      });
    }
  }
  return { points, spheres, external };
}

/** Potential of a point charge with a small softening radius for display. */
export function pointPotential(p: Vec3, q: number, source: Vec3, soft: number): number {
  const dx = p[0] - source[0];
  const dy = p[1] - source[1];
  const dz = p[2] - source[2];
  return (K_E * q) / Math.sqrt(dx * dx + dy * dy + dz * dz + soft * soft);
}

export function pointField(p: Vec3, q: number, source: Vec3, soft: number, out: Vec3): void {
  const dx = p[0] - source[0];
  const dy = p[1] - source[1];
  const dz = p[2] - source[2];
  const r2 = dx * dx + dy * dy + dz * dz + soft * soft;
  const inv = (K_E * q) / (r2 * Math.sqrt(r2));
  out[0] += dx * inv;
  out[1] += dy * inv;
  out[2] += dz * inv;
}

export interface SphereField {
  E: Vec3;
  phi: number;
}

/** Exact field and potential of a uniformly charged solid sphere or shell. */
export function chargedSphereField(p: Vec3, s: SphereSource, soft = 0): SphereField {
  const dx = p[0] - s.position[0];
  const dy = p[1] - s.position[1];
  const dz = p[2] - s.position[2];
  const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const R = Math.max(s.radius, 1e-9);
  const kq = K_E * s.charge;

  if (r >= R) {
    const rs = Math.sqrt(r * r + soft * soft);
    const e = kq / (rs * rs * rs);
    return { E: [dx * e, dy * e, dz * e], phi: kq / rs };
  }

  const phiInside = s.shell
    ? kq / R
    : (kq * (3 * R * R - r * r)) / (2 * R * R * R);
  const eMag = s.shell ? 0 : (kq * r) / (R * R * R);
  const invR = r > 1e-12 ? eMag / r : 0;
  return { E: [dx * invR, dy * invR, dz * invR], phi: phiInside };
}

export function addSphereField(out: Vec3, p: Vec3, s: SphereSource, soft: number): number {
  const f = chargedSphereField(p, s, soft);
  out[0] += f.E[0];
  out[1] += f.E[1];
  out[2] += f.E[2];
  return f.phi;
}

export function sampleAnalyticE(sources: AnalyticSources, p: Vec3, soft = 2e-4): Vec3 {
  const out: Vec3 = [sources.external[0], sources.external[1], sources.external[2]];
  for (const c of sources.points) pointField(p, c.charge, c.position, soft, out);
  for (const s of sources.spheres) {
    const f = chargedSphereField(p, s, soft);
    out[0] += f.E[0];
    out[1] += f.E[1];
    out[2] += f.E[2];
  }
  return out;
}

export function sampleAnalyticPhi(sources: AnalyticSources, p: Vec3, soft = 2e-4): number {
  let phi = -(
    sources.external[0] * p[0] +
    sources.external[1] * p[1] +
    sources.external[2] * p[2]
  );
  for (const c of sources.points) phi += pointPotential(p, c.charge, c.position, soft);
  for (const s of sources.spheres) phi += chargedSphereField(p, s, soft).phi;
  return phi;
}

/** Sampled electric field along a ray from a charge, used for the E(r) chart. */
export function radialFieldSamples(
  sources: AnalyticSources,
  origin: Vec3,
  dir: Vec3,
  rMin: number,
  rMax: number,
  count: number,
): Array<{ r: number; E: number; phi: number }> {
  const out: Array<{ r: number; E: number; phi: number }> = [];
  const n = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  for (let i = 0; i < count; i++) {
    const r = rMin + ((rMax - rMin) * i) / (count - 1);
    const p: Vec3 = [
      origin[0] + (dir[0] / n) * r,
      origin[1] + (dir[1] / n) * r,
      origin[2] + (dir[2] / n) * r,
    ];
    const E = sampleAnalyticE(sources, p);
    const phi = sampleAnalyticPhi(sources, p);
    out.push({ r, E: Math.hypot(E[0], E[1], E[2]), phi });
  }
  return out;
}

export function totalCharge(objects: SceneObject[]): number {
  let q = 0;
  for (const obj of objects) {
    if (!obj.visible) continue;
    if (isCharge(obj) || isChargedSphere(obj)) q += obj.charge;
  }
  return q;
}

export function analyticFieldEnergy(sources: AnalyticSources, points: Vec3[], volumePerPoint: number): number {
  let u = 0;
  for (const p of points) {
    const E = sampleAnalyticE(sources, p);
    u += 0.5 * EPS0 * (E[0] * E[0] + E[1] * E[1] + E[2] * E[2]);
  }
  return u * volumePerPoint;
}
