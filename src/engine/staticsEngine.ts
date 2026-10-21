import { EPS0, MU0, PI } from './constants';
import { makeGrid, percentile } from './grid';
import type { GridSpec } from './grid';
import { sampleScalar, sampleVector } from './grid';
import type { Vec3 } from './math/vec3';
import {
  collectAnalyticSources,
  sampleAnalyticE,
  sampleAnalyticPhi,
} from './electrostatics/analytic';
import type { AnalyticSources } from './electrostatics/analytic';
import { solvePoisson } from './electrostatics/poisson';
import type { PoissonResult } from './electrostatics/poisson';
import { buildMagnetostaticSources, sampleBAt } from './magnetostatics/biotSavart';
import type { MagnetostaticSources } from './magnetostatics/biotSavart';
import { rasterizeScene } from '../scene/rasterize';
import type { RasterResult } from '../scene/rasterize';
import type {
  ConductorObject,
  ProbeReading,
  Scene,
  SliceQuantity,
} from '../scene/types';
import { isConductor, isChargedSphere, isCharge, isDielectric, isProbe } from '../scene/types';

export interface StaticsSummary {
  grid?: {
    nx: number; ny: number; nz: number;
    min: Vec3; max: Vec3;
  };
  hasGrid: boolean;
  hasB: boolean;
  conductors: PoissonResult['charges'];
  capacitanceMatrix: number[][];
  differentialCapacitance?: number;
  inductance: number;
  electricEnergy: number;
  magneticEnergy: number;
  stats: {
    solveMs: number;
    cycles: number;
    iterations: number;
    residual: number;
    algorithm: string;
    cells: number;
  };
}

export interface SliceData {
  axis: 'x' | 'y' | 'z';
  position: number;
  quantity: SliceQuantity;
  resolution: number;
  data: Float32Array;
  min: number;
  max: number;
}

export interface FieldLineData {
  points: Float32Array; // x,y,z triplets
  magnitudes: Float32Array;
}

export class StaticsEngine {
  readonly scene: Scene;
  readonly grid: GridSpec | null;
  readonly raster: RasterResult | null;
  readonly poisson: PoissonResult | null;
  readonly analytic: AnalyticSources;
  readonly magneto: MagnetostaticSources;
  readonly summary: StaticsSummary;

  constructor(scene: Scene) {
    const t0 = performance.now();
    this.scene = scene;
    const needsGrid = scene.objects.some((o) => isConductor(o) || isDielectric(o));
    const res = scene.simulation.resolution;
    if (needsGrid) {
      const grid = makeGrid(res + 1, res + 1, res + 1, scene.domain.center, scene.domain.size);
      this.grid = grid;
      this.raster = rasterizeScene(scene, grid, { charges: true, centering: 'nodes', materials: true });
      this.poisson = solvePoisson(scene, grid, this.raster, {
        externalField: scene.simulation.externalField,
        boundary: scene.simulation.staticBoundary,
      });
    } else {
      this.grid = null;
      this.raster = null;
      this.poisson = null;
    }
    this.analytic = collectAnalyticSources(scene.objects, scene.simulation.externalField);
    this.magneto = buildMagnetostaticSources(scene.objects);
    this.summary = {
      grid: this.grid
        ? { nx: this.grid.nx, ny: this.grid.ny, nz: this.grid.nz, min: this.grid.min, max: this.grid.max }
        : undefined,
      hasGrid: !!this.poisson,
      hasB: this.magneto.hasSources,
      conductors: this.poisson?.charges ?? [],
      capacitanceMatrix: this.poisson?.capacitanceMatrix ?? [],
      differentialCapacitance: this.poisson?.differentialCapacitance,
      inductance: this.magneto.inductance,
      electricEnergy: this.poisson
        ? this.poisson.electricEnergy
        : estimateAnalyticEnergy(this.analytic, scene),
      magneticEnergy: this.magneticEnergy(),
      stats: {
        solveMs: performance.now() - t0,
        cycles: this.poisson?.stats.cycles ?? 0,
        iterations: this.poisson?.stats.cycles ?? 0,
        residual: this.poisson?.stats.residual ?? 0,
        algorithm: this.poisson ? 'geometric multigrid (Poisson)' : 'analytic superposition',
        cells: this.grid ? this.grid.nx * this.grid.ny * this.grid.nz : 0,
      },
    };
  }

  sampleE(p: Vec3): Vec3 {
    if (this.poisson && this.grid) return sampleVector(this.poisson.E, this.grid, p);
    return sampleAnalyticE(this.analytic, p);
  }

  samplePhi(p: Vec3): number {
    if (this.poisson && this.grid) return sampleScalar(this.poisson.phi, this.grid, p);
    return sampleAnalyticPhi(this.analytic, p);
  }

  sampleB(p: Vec3): Vec3 {
    const ext = this.scene.simulation.externalB;
    if (!this.magneto.hasSources) return [ext[0], ext[1], ext[2]];
    const B = sampleBAt(this.magneto.segments, p);
    return [B[0] + ext[0], B[1] + ext[1], B[2] + ext[2]];
  }

  probes(): ProbeReading[] {
    const out: ProbeReading[] = [];
    for (const obj of this.scene.objects) {
      if (!isProbe(obj)) continue;
      const E = this.sampleE(obj.position);
      const B = this.sampleB(obj.position);
      out.push({
        id: obj.id,
        position: obj.position,
        E,
        B,
        phi: this.samplePhi(obj.position),
        Emag: Math.hypot(E[0], E[1], E[2]),
        Bmag: Math.hypot(B[0], B[1], B[2]),
      });
    }
    return out;
  }

  sampleConductorCharges(): Array<{ id: string; name: string; charge: number; potential: number }> {
    return this.summary.conductors.map((c) => ({
      id: c.id,
      name: c.name,
      charge: c.charge,
      potential: c.potential,
    }));
  }

  slice(
    axis: 'x' | 'y' | 'z',
    position: number,
    quantity: SliceQuantity,
    resolution = 160,
  ): SliceData {
    const res = Math.max(16, Math.min(256, Math.round(resolution)));
    const data = new Float32Array(res * res);
    const center = this.scene.domain.center;
    const size = this.scene.domain.size;
    const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const uAxis = axis === 'x' ? 1 : 0;
    const vAxis = axis === 'z' ? 1 : 2;
    const fixed = center[axisIndex] + (position * size[axisIndex]) / 2;
    let min = Infinity;
    let max = -Infinity;
    for (let v = 0; v < res; v++) {
      for (let u = 0; u < res; u++) {
        const p: Vec3 = [0, 0, 0];
        p[axisIndex] = fixed;
        p[uAxis] = center[uAxis] + ((u + 0.5) / res - 0.5) * size[uAxis];
        p[vAxis] = center[vAxis] + ((v + 0.5) / res - 0.5) * size[vAxis];
        const value = this.quantityAt(p, quantity);
        data[v * res + u] = value;
        if (Number.isFinite(value)) {
          if (value < min) min = value;
          if (value > max) max = value;
        }
      }
    }
    if (!Number.isFinite(min)) { min = 0; max = 1; }
    const signed = quantity === 'Ex' || quantity === 'Ey' || quantity === 'Ez' || quantity === 'phi';
    if (signed) {
      const amp = Math.max(Math.abs(min), Math.abs(max));
      min = -amp;
      max = amp;
    } else {
      min = 0;
      const p98 = percentile(data, 0.98);
      max = p98 > 0 ? p98 : max;
    }
    return { axis, position, quantity, resolution: res, data, min, max };
  }

  quantityAt(p: Vec3, quantity: SliceQuantity): number {
    if (quantity === 'phi') return this.samplePhi(p);
    const B = quantity === 'Bmag' || quantity === 'energyB' || quantity === 'poynting'
      ? this.sampleB(p)
      : null;
    if (quantity === 'Bmag') return Math.hypot(B![0], B![1], B![2]);
    if (quantity === 'energyB') return (
      0.5 * (B![0] ** 2 + B![1] ** 2 + B![2] ** 2)
    ) / MU0;
    if (quantity === 'poynting') {
      const E = this.sampleE(p);
      const sx = E[1] * B![2] - E[2] * B![1];
      const sy = E[2] * B![0] - E[0] * B![2];
      const sz = E[0] * B![1] - E[1] * B![0];
      return Math.hypot(sx, sy, sz) / MU0;
    }
    const E = this.sampleE(p);
    switch (quantity) {
      case 'Emag': return Math.hypot(E[0], E[1], E[2]);
      case 'Ex': return E[0];
      case 'Ey': return E[1];
      case 'Ez': return E[2];
      case 'energyE': return 0.5 * EPS0 * (E[0] ** 2 + E[1] ** 2 + E[2] ** 2);
      default: return Math.hypot(E[0], E[1], E[2]);
    }
  }


  lattice(count: number, field: 'E' | 'B' | 'P'): {
    positions: Float32Array;
    vectors: Float32Array;
    magnitudes: Float32Array;
  } {
    const n = Math.max(3, Math.min(20, Math.round(count)));
    const positions = new Float32Array(n * n * n * 3);
    const vectors = new Float32Array(n * n * n * 3);
    const magnitudes = new Float32Array(n * n * n);
    const c = this.scene.domain.center;
    const size = this.scene.domain.size;
    let o = 0;
    for (let k = 0; k < n; k++) {
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const p: Vec3 = [
            c[0] + ((i + 0.5) / n - 0.5) * size[0],
            c[1] + ((j + 0.5) / n - 0.5) * size[1],
            c[2] + ((k + 0.5) / n - 0.5) * size[2],
          ];
          const E = this.sampleE(p);
          let vx = E[0], vy = E[1], vz = E[2];
          let mag = Math.hypot(vx, vy, vz);
          if (field === 'B') {
            const B = this.sampleB(p);
            vx = B[0]; vy = B[1]; vz = B[2];
            mag = Math.hypot(vx, vy, vz);
          } else if (field === 'P') {
            const B = this.sampleB(p);
            const sx = E[1] * B[2] - E[2] * B[1];
            const sy = E[2] * B[0] - E[0] * B[2];
            const sz = E[0] * B[1] - E[1] * B[0];
            vx = sx / MU0; vy = sy / MU0; vz = sz / MU0;
            mag = Math.hypot(vx, vy, vz);
          }
          positions[o] = p[0]; positions[o + 1] = p[1]; positions[o + 2] = p[2];
          vectors[o] = vx; vectors[o + 1] = vy; vectors[o + 2] = vz;
          magnitudes[o / 3] = mag;
          o += 3;
        }
      }
    }
    return { positions, vectors, magnitudes };
  }

  fieldLines(field: 'E' | 'B', count = 40): FieldLineData[] {
    const lines: FieldLineData[] = [];
    const seeds = this.seeds(field, count);
    for (const seed of seeds) {
      const line = this.trace(seed.point, field, seed.sign);
      if (line && line.points.length >= 6) lines.push(line);
    }
    return lines;
  }

  private seeds(field: 'E' | 'B', count: number): Array<{ point: Vec3; sign: number }> {
    const seeds: Array<{ point: Vec3; sign: number }> = [];
    const c = this.scene.domain.center;
    const size = this.scene.domain.size;
    const diag = Math.hypot(size[0], size[1], size[2]);
    const n = Math.max(8, Math.min(200, Math.round(count)));

    if (field === 'E') {
      const charges = this.scene.objects.filter((o) => isCharge(o) || isChargedSphere(o));
      if (charges.length > 0) {
        const per = Math.max(6, Math.floor(n / charges.length));
        for (const obj of charges) {
          const q = obj.kind === 'charge' ? obj.charge : obj.charge;
          const sign = q >= 0 ? 1 : -1;
          const radius = Math.max(0.008, diag * 0.012, 'radius' in obj ? obj.radius * 1.05 : 0);
          const base = obj.position;
          for (let i = 0; i < per; i++) {
            const y = 1 - (2 * (i + 0.5)) / per;
            const r = Math.sqrt(Math.max(0, 1 - y * y));
            const phi = i * 2.399963229728653;
            const point: Vec3 = [
              base[0] + radius * r * Math.cos(phi),
              base[1] + radius * y,
              base[2] + radius * r * Math.sin(phi),
            ];
            seeds.push({ point, sign });
          }
        }
      } else {
        for (let i = 0; i < n; i++) {
          const y = 1 - (2 * (i + 0.5)) / n;
          const r = Math.sqrt(Math.max(0, 1 - y * y));
          const phi = i * 2.399963229728653;
          const point: Vec3 = [
            c[0] + 0.42 * size[0] * r * Math.cos(phi),
            c[1] + 0.42 * size[1] * y,
            c[2] + 0.42 * size[2] * r * Math.sin(phi),
          ];
          seeds.push({ point, sign: 1 });
          seeds.push({ point, sign: -1 });
        }
      }
    } else {
      // Seed around current-carrying objects and a generic shell.
      const sources = this.scene.objects.filter(
        (o) => o.kind === 'wire' || o.kind === 'loop' || o.kind === 'coil' || o.kind === 'magnet',
      );
      if (sources.length > 0) {
        const per = Math.max(6, Math.floor(n / sources.length));
        for (const obj of sources) {
          if (obj.kind === 'wire' && obj.points.length >= 2) {
            const a = obj.points[0];
            for (let i = 0; i < per; i++) {
              const a0 = (i / per) * Math.PI * 2;
              seeds.push({
                point: [obj.position[0] + a[0] + 0.06 * Math.cos(a0), obj.position[1] + a[1], obj.position[2] + a[2] + 0.06 * Math.sin(a0)],
                sign: 1,
              });
            }
          } else {
            const radius = obj.kind === 'loop' || obj.kind === 'magnet'
              ? obj.radius * 1.35
              : obj.kind === 'coil' ? obj.radius * 1.6 : 0.1;
            for (let i = 0; i < per; i++) {
              const y = 1 - (2 * (i + 0.5)) / per;
              const r = Math.sqrt(Math.max(0, 1 - y * y));
              const phi = i * 2.399963229728653;
              seeds.push({
                point: [
                  obj.position[0] + radius * r * Math.cos(phi),
                  obj.position[1] + radius * y,
                  obj.position[2] + radius * r * Math.sin(phi),
                ],
                sign: 1,
              });
            }
          }
        }
      } else {
        for (let i = 0; i < n; i++) {
          const y = 1 - (2 * (i + 0.5)) / n;
          const r = Math.sqrt(Math.max(0, 1 - y * y));
          const phi = i * 2.399963229728653;
          seeds.push({
            point: [
              c[0] + 0.4 * size[0] * r * Math.cos(phi),
              c[1] + 0.4 * size[1] * y,
              c[2] + 0.4 * size[2] * r * Math.sin(phi),
            ],
            sign: 1,
          });
        }
      }
    }
    return seeds;
  }

  private trace(start: Vec3, field: 'E' | 'B', sign: number): FieldLineData | null {
    const pts: number[] = [];
    const mags: number[] = [];
    const size = this.scene.domain.size;
    const c = this.scene.domain.center;
    const h = Math.max(Math.min(size[0], size[1], size[2]) / 140, 1e-4);
    let p: Vec3 = [...start];
    const sample = (q: Vec3): Vec3 => (field === 'E' ? this.sampleE(q) : this.sampleB(q));
    for (let step = 0; step < 520; step++) {
      const dir = sample(p);
      const mag = Math.hypot(dir[0], dir[1], dir[2]);
      if (!Number.isFinite(mag) || mag < 1e-14) break;
      pts.push(p[0], p[1], p[2]);
      mags.push(mag);
      const k1: Vec3 = [sign * dir[0] / mag, sign * dir[1] / mag, sign * dir[2] / mag];
      const p2: Vec3 = [p[0] + k1[0] * h * 0.5, p[1] + k1[1] * h * 0.5, p[2] + k1[2] * h * 0.5];
      const d2 = sample(p2);
      const m2 = Math.hypot(d2[0], d2[1], d2[2]) || 1;
      const k2: Vec3 = [sign * d2[0] / m2, sign * d2[1] / m2, sign * d2[2] / m2];
      const p3: Vec3 = [p[0] + k2[0] * h * 0.5, p[1] + k2[1] * h * 0.5, p[2] + k2[2] * h * 0.5];
      const d3 = sample(p3);
      const m3 = Math.hypot(d3[0], d3[1], d3[2]) || 1;
      const k3: Vec3 = [sign * d3[0] / m3, sign * d3[1] / m3, sign * d3[2] / m3];
      const p4: Vec3 = [p[0] + k3[0] * h, p[1] + k3[1] * h, p[2] + k3[2] * h];
      const d4 = sample(p4);
      const m4 = Math.hypot(d4[0], d4[1], d4[2]) || 1;
      const k4: Vec3 = [sign * d4[0] / m4, sign * d4[1] / m4, sign * d4[2] / m4];
      const next: Vec3 = [
        p[0] + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
        p[1] + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
        p[2] + (h / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]),
      ];
      if (this.insideConductor(next)) break;
      const outside = Math.abs(next[0] - c[0]) > size[0] * 0.52 ||
        Math.abs(next[1] - c[1]) > size[1] * 0.52 ||
        Math.abs(next[2] - c[2]) > size[2] * 0.52;
      if (outside) break;
      p = next;
    }
    if (pts.length < 6) return null;
    return { points: new Float32Array(pts), magnitudes: new Float32Array(mags) };
  }

  private insideConductor(p: Vec3): boolean {
    if (!this.raster || !this.grid) return false;
    const g = this.grid;
    const i = Math.round((p[0] - g.min[0]) / g.dx);
    const j = Math.round((p[1] - g.min[1]) / g.dy);
    const k = Math.round((p[2] - g.min[2]) / g.dz);
    if (i < 0 || j < 0 || k < 0 || i >= g.nx || j >= g.ny || k >= g.nz) return false;
    return this.raster.conductor[i + g.nx * (j + g.ny * k)] > 0;
  }

  magneticEnergy(): number {
    if (!this.magneto.hasSources) return 0;
    const c = this.scene.domain.center;
    const size = this.scene.domain.size;
    const n = 12;
    const dv = (size[0] * size[1] * size[2]) / (n * n * n);
    let sum = 0;
    for (let k = 0; k < n; k++) {
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const p: Vec3 = [
            c[0] + ((i + 0.5) / n - 0.5) * size[0],
            c[1] + ((j + 0.5) / n - 0.5) * size[1],
            c[2] + ((k + 0.5) / n - 0.5) * size[2],
          ];
          const B = this.sampleB(p);
          sum += (B[0] ** 2 + B[1] ** 2 + B[2] ** 2) / (2 * MU0);
        }
      }
    }
    return sum * dv;
  }
}

function estimateAnalyticEnergy(sources: AnalyticSources, scene: Scene): number {
  // Integrate over a modest lattice, clipped near singular charges.
  const c = scene.domain.center;
  const size = scene.domain.size;
  const n = 16;
  const dv = (size[0] * size[1] * size[2]) / (n * n * n);
  let u = 0;
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const p: Vec3 = [
          c[0] + ((i + 0.5) / n - 0.5) * size[0],
          c[1] + ((j + 0.5) / n - 0.5) * size[1],
          c[2] + ((k + 0.5) / n - 0.5) * size[2],
        ];
        const E = sampleAnalyticE(sources, p);
        u += 0.5 * EPS0 * (E[0] ** 2 + E[1] ** 2 + E[2] ** 2);
      }
    }
  }
  return u * dv;
}

export function averageConductorPotential(conductors: ConductorObject[]): number {
  if (conductors.length === 0) return 0;
  return conductors.reduce((s, c) => s + c.potential, 0) / conductors.length;
}

export function circumference(radius: number): number {
  return 2 * PI * radius;
}

