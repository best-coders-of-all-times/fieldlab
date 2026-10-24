import type { Scene, SliceQuantity } from '../../scene/types';
import type { Vec3 } from '../math/vec3';
import { EPS0, MU0 } from '../constants';
import { percentile } from '../grid';
import type { FdtdSample } from '../fdtd/fdtd3d';
import type { FieldLineData } from '../staticsEngine';
import type { YeeSolver } from './yee';

const E_OFF: Vec3[] = [[0.5, 0, 0], [0, 0.5, 0], [0, 0, 0.5]];
const B_OFF: Vec3[] = [[0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]];

export class MaxwellSampler {
  constructor(readonly core: YeeSolver, public scene: Scene, readonly min: Vec3) {}

  interpolate(p: Vec3, offset: Vec3, at: (c: number) => number): number {
    const s = this.core, ns = [s.nx, s.ny, s.nz], ds = [s.dx, s.dy, s.dz];
    const f = p.map((v, a) => Math.max(0, Math.min(ns[a] - 1.000001, (v - this.min[a]) / ds[a] - offset[a])));
    const lo = f.map(Math.floor), t = f.map((v, a) => v - lo[a]);
    let value = 0;
    for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const w = (i ? t[0] : 1 - t[0]) * (j ? t[1] : 1 - t[1]) * (k ? t[2] : 1 - t[2]);
      value += w * at(lo[0] + i + s.nx * (lo[1] + j + s.ny * (lo[2] + k)));
    }
    return value;
  }

  /** B is stored half a step behind E. Faraday advances it by half a step
   * for physical-interior readouts without changing the integrator state. */
  synchronizedB(axis: number, c: number): number {
    return this.core.synchronizedB(axis as 0 | 1 | 2, c);
  }

  /** Native component projection. Constitutive line integrals often need
   * only one field component; avoid evaluating unused synchronized curls. */
  sampleProjection(p: Vec3, field: 'E' | 'B', direction: Vec3) {
    const electric = [this.core.Ex, this.core.Ey, this.core.Ez];
    let result = 0;
    for (let a = 0; a < 3; a++) if (direction[a] !== 0) result += direction[a] * (field === 'E'
      ? this.interpolate(p, E_OFF[a], c => electric[a][c])
      : this.interpolate(p, B_OFF[a], c => this.synchronizedB(a, c)));
    return result;
  }

  sampleEB(p: Vec3) {
    const s = this.core, es = [s.Ex, s.Ey, s.Ez];
    const E = es.map((e, a) => this.interpolate(p, E_OFF[a], c => e[c])) as Vec3;
    const B = B_OFF.map((off, a) => this.interpolate(p, off, c => this.synchronizedB(a, c))) as Vec3;
    return { E, B, Emag: Math.hypot(...E), Bmag: Math.hypot(...B) };
  }

  /** Force on the finite CIC cloud, rather than a point probe. Center each
   * component at charge nodes before applying the same CIC shape as deposition.
   * Pairing the symmetric source shape with a centered antisymmetric gradient
   * cancels electrostatic mesh self-force in homogeneous space. Boundary and
   * material reaction forces remain. Probe interpolation is unchanged.
   */
  sampleForForce(p: Vec3) {
    const s = this.core, shape = [s.nx, s.ny, s.nz], strides = [1, s.nx, s.nx * s.ny];
    const previous = (c: number, a: number) => Math.floor(c / strides[a]) % shape[a] ? c - strides[a] : c + (shape[a] - 1) * strides[a];
    const E = [s.Ex, s.Ey, s.Ez].map((e, a) => this.interpolate(p, [0, 0, 0], c => (e[c] + e[previous(c, a)]) / 2)) as Vec3;
    const B = [0, 1, 2].map(a => this.interpolate(p, [0, 0, 0], c => {
      const b = (a + 1) % 3, d = (a + 2) % 3, cb = previous(c, b), cd = previous(c, d);
      return (this.synchronizedB(a, c) + this.synchronizedB(a, cb) + this.synchronizedB(a, cd) + this.synchronizedB(a, previous(cb, d))) / 4;
    })) as Vec3;
    return { E, B };
  }

  sample(p: Vec3): FdtdSample & { D: Vec3; J: Vec3; rho: number; energyE: number; energyB: number } {
    const s = this.core, es = [s.Ex, s.Ey, s.Ez], eps = [s.epsX, s.epsY, s.epsZ];
    const mus = [s.muX, s.muY, s.muZ];
    const { E, B } = this.sampleEB(p);
    const D = es.map((e, a) => this.interpolate(p, E_OFF[a], c => EPS0 * eps[a][c] * e[c])) as Vec3;
    const H = B_OFF.map((off, a) => this.interpolate(p, off, c => this.synchronizedB(a, c) / (MU0 * mus[a][c]))) as Vec3;
    const J = E_OFF.map((off, a) => this.interpolate(p, off, c => s.currentAtUpdate(a as 0 | 1 | 2, c))) as Vec3;
    return { E, D, B, H, J, rho: this.interpolate(p, [0, 0, 0], c => s.rho[c]),
      energyE: 0.5 * E.reduce((sum, e, a) => sum + e * D[a], 0),
      energyB: 0.5 * B.reduce((sum, b, a) => sum + b * H[a], 0),
      epsilonR: this.interpolate(p, [0, 0, 0], c => s.epsX[c]), muR: this.interpolate(p, [0, 0, 0], c => s.muX[c]),
      Emag: Math.hypot(...E), Bmag: Math.hypot(...B) };
  }

  sampleSlice(axis: 'x' | 'y' | 'z', position: number, quantity: SliceQuantity, resolution = 96) {
    const res = Math.max(16, Math.min(256, Math.round(resolution)));
    const data = new Float32Array(res * res), { center, size } = this.scene.domain;
    const a = axis === 'x' ? 0 : axis === 'y' ? 1 : 2, u = axis === 'x' ? 1 : 0, v = axis === 'z' ? 1 : 2;
    let min = Infinity, max = -Infinity;
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const p: Vec3 = [...center];
      p[a] += position * size[a] / 2; p[u] += ((i + 0.5) / res - 0.5) * size[u]; p[v] += ((j + 0.5) / res - 0.5) * size[v];
      const s = this.sample(p);
      const value = quantity === 'Bmag' ? s.Bmag : quantity === 'Ex' ? s.E[0] : quantity === 'Ey' ? s.E[1] : quantity === 'Ez' ? s.E[2]
        : quantity === 'energyE' ? s.energyE
          : quantity === 'energyB' ? s.energyB
            : quantity === 'poynting' ? Math.hypot(...cross(s.E, s.H)) : s.Emag;
      data[i + res * j] = value; min = Math.min(min, value); max = Math.max(max, value);
    }
    if (!['Ex', 'Ey', 'Ez'].includes(quantity)) { min = 0; max = percentile(data, 0.98) || max; }
    else { max = Math.max(Math.abs(min), Math.abs(max)); min = -max; }
    return { data, min, max };
  }

  sampleLattice(count: number, field: 'E' | 'B' | 'P') {
    const n = Math.max(3, Math.min(20, Math.round(count))), positions = new Float32Array(n ** 3 * 3);
    const vectors = new Float32Array(positions.length), magnitudes = new Float32Array(n ** 3);
    const { center, size } = this.scene.domain;
    let c = 0;
    for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++, c++) {
      const p = [i, j, k].map((v, a) => center[a] + ((v + 0.5) / n - 0.5) * size[a]) as Vec3;
      const s = this.sample(p), v = field === 'P' ? cross(s.E, s.H) : s[field];
      positions.set(p, c * 3); vectors.set(v, c * 3); magnitudes[c] = Math.hypot(...v);
    }
    return { positions, vectors, magnitudes };
  }

  fieldLines(field: 'E' | 'B', count = 24): FieldLineData[] {
    const lines: FieldLineData[] = [], { center, size } = this.scene.domain;
    const h = Math.min(...size) / 100;
    for (let l = 0; l < Math.min(100, count); l++) {
      const y = 1 - 2 * (l + 0.5) / count, r = Math.sqrt(1 - y * y), angle = l * 2.399963229728653;
      let p: Vec3 = [center[0] + 0.3 * size[0] * r * Math.cos(angle), center[1] + 0.3 * size[1] * y, center[2] + 0.3 * size[2] * r * Math.sin(angle)];
      const points: number[] = [], magnitudes: number[] = [];
      for (let step = 0; step < 360; step++) {
        const f = this.sampleEB(p)[field], mag = Math.hypot(...f);
        if (!(mag > 1e-35)) break;
        points.push(...p); magnitudes.push(mag);
        const mid = p.map((v, a) => v + f[a] * h / (2 * mag)) as Vec3;
        const fm = this.sampleEB(mid)[field], mm = Math.hypot(...fm);
        if (!(mm > 1e-35)) break;
        p = p.map((v, a) => v + fm[a] * h / mm) as Vec3;
        if (p.some((v, a) => Math.abs(v - center[a]) > size[a] / 2)) break;
      }
      if (points.length >= 6) lines.push({ points: new Float32Array(points), magnitudes: new Float32Array(magnitudes) });
    }
    return lines;
  }
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
