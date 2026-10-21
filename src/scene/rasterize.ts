import type { GridSpec } from '../engine/grid';
import { idx, nodePosition, cellCenter } from '../engine/grid';
import type { Vec3 } from '../engine/math/vec3';
import { rotateEuler, worldToLocal } from './defaults';
import type {
  ConductorObject,
  DielectricObject,
  SceneObject,
  Scene,
} from './types';
import { isChargedSphere, isCharge, isConductor, isDielectric } from './types';

export interface RasterResult {
  grid: GridSpec;
  epsilon: Float32Array;
  mu: Float32Array;
  sigma: Float32Array;
  /** 0 = free space, index+1 = conductor index. */
  conductor: Uint8Array;
  conductorObjects: ConductorObject[];
  /** Charge density, C/m³ (statics only). */
  rho: Float32Array;
}

export interface RasterOptions {
  charges: boolean;
  /** Node-centred (statics) or cell-centred (FDTD). */
  centering: 'nodes' | 'cells';
  /** Include dielectric/conductor objects (waves/statics). */
  materials: boolean;
}

export function shapeContains(obj: SceneObject, p: Vec3): boolean {
  const local = worldToLocal(obj, p);
  const [sx, sy, sz] = [
    'size' in obj && obj.size ? obj.size[0] : 0,
    'size' in obj && obj.size ? obj.size[1] : 0,
    'size' in obj && obj.size ? obj.size[2] : 0,
  ];
  if (obj.kind === 'conductor' || obj.kind === 'dielectric') {
    if (obj.shape === 'box') {
      return Math.abs(local[0]) <= sx / 2 && Math.abs(local[1]) <= sy / 2 && Math.abs(local[2]) <= sz / 2;
    }
    if (obj.shape === 'sphere') {
      const r = sx / 2;
      return local[0] * local[0] + local[1] * local[1] + local[2] * local[2] <= r * r;
    }
    if (obj.shape === 'cylinder') {
      const r = sx / 2;
      return local[0] * local[0] + local[1] * local[1] <= r * r && Math.abs(local[2]) <= sz / 2;
    }
  }
  return false;
}

export function rasterizeScene(scene: Scene, grid: GridSpec, opts: RasterOptions): RasterResult {
  const n = grid.nx * grid.ny * grid.nz;
  const epsilon = new Float32Array(n);
  const mu = new Float32Array(n);
  const sigma = new Float32Array(n);
  const conductor = new Uint8Array(n);
  const rho = new Float32Array(n);
  epsilon.fill(1);
  mu.fill(1);

  const conductorObjects = scene.objects.filter(isConductor);
  const conductorIndex = new Map<string, number>();
  conductorObjects.forEach((c, i) => conductorIndex.set(c.id, i + 1));

  const cellVolume = grid.dx * grid.dy * grid.dz;

  for (let k = 0; k < grid.nz; k++) {
    for (let j = 0; j < grid.ny; j++) {
      for (let i = 0; i < grid.nx; i++) {
        const p = opts.centering === 'nodes'
          ? nodePosition(grid, i, j, k)
          : cellCenter(grid, i, j, k);
        const c = idx(grid, i, j, k);

        if (opts.materials) {
          for (const obj of scene.objects) {
            if (!obj.visible) continue;
            if (isDielectric(obj)) {
              if (shapeContains(obj, p)) {
                epsilon[c] = Math.max(1e-4, obj.epsilonR);
                mu[c] = Math.max(1e-4, obj.muR);
                sigma[c] = Math.max(0, obj.sigma);
              }
            } else if (isConductor(obj)) {
              if (shapeContains(obj, p)) {
                conductor[c] = conductorIndex.get(obj.id) ?? 1;
                epsilon[c] = 1;
                mu[c] = 1;
              }
            }
          }
        }

        if (opts.charges) {
          // Point charges (cloud-in-cell) are deposited after the loop.
          void p;
          void c;
        }
      }
    }
  }

  if (opts.charges) {
    for (const obj of scene.objects) {
      if (!obj.visible) continue;
      if (isCharge(obj)) {
        depositPointCharge(rho, grid, obj.position, obj.charge, opts.centering);
      } else if (isChargedSphere(obj)) {
        const r = obj.radius;
        const shellWidth = Math.max(grid.dx, grid.dy, grid.dz) * 1.4;
        const cells: number[] = [];
        for (let k = 0; k < grid.nz; k++) {
          for (let j = 0; j < grid.ny; j++) {
            for (let i = 0; i < grid.nx; i++) {
              const p = opts.centering === 'nodes'
                ? nodePosition(grid, i, j, k)
                : cellCenter(grid, i, j, k);
              const dx = p[0] - obj.position[0];
              const dy = p[1] - obj.position[1];
              const dz = p[2] - obj.position[2];
              const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
              const inside = obj.shell
                ? Math.abs(dist - r) <= shellWidth / 2
                : dist <= r;
              if (inside) cells.push(idx(grid, i, j, k));
            }
          }
        }
        if (cells.length > 0) {
          const per = obj.charge / (cells.length * cellVolume);
          for (const c of cells) rho[c] += per;
        }
      }
    }
  }

  // Conductors always win over overlapping dielectric fills.
  for (let c = 0; c < n; c++) {
    if (conductor[c]) {
      epsilon[c] = 1;
      mu[c] = 1;
    }
  }

  return { grid, epsilon, mu, sigma, conductor, conductorObjects, rho };
}

function depositPointCharge(
  rho: Float32Array,
  g: GridSpec,
  p: Vec3,
  q: number,
  centering: 'nodes' | 'cells',
): void {
  const off = centering === 'nodes' ? 0 : 0.5;
  const fx = (p[0] - g.min[0]) / g.dx - off;
  const fy = (p[1] - g.min[1]) / g.dy - off;
  const fz = (p[2] - g.min[2]) / g.dz - off;
  const i0 = Math.floor(fx), j0 = Math.floor(fy), k0 = Math.floor(fz);
  const tx = fx - i0, ty = fy - j0, tz = fz - k0;
  const volume = g.dx * g.dy * g.dz;
  for (let dk = 0; dk < 2; dk++) {
    const k = k0 + dk;
    if (k < 0 || k >= g.nz) continue;
    const wz = dk ? tz : 1 - tz;
    for (let dj = 0; dj < 2; dj++) {
      const j = j0 + dj;
      if (j < 0 || j >= g.ny) continue;
      const wy = dj ? ty : 1 - ty;
      for (let di = 0; di < 2; di++) {
        const i = i0 + di;
        if (i < 0 || i >= g.nx) continue;
        const wx = di ? tx : 1 - tx;
        rho[idx(g, i, j, k)] += (q * wx * wy * wz) / volume;
      }
    }
  }
}

/** Build local wire segments for a scene object (world space). */
export function objectBoundingBox(obj: ConductorObject | DielectricObject): { min: Vec3; max: Vec3 } {
  const half: Vec3 = [obj.size[0] / 2, obj.size[1] / 2, obj.size[2] / 2];
  const corners: Vec3[] = [
    [-half[0], -half[1], -half[2]],
    [half[0], -half[1], -half[2]],
    [-half[0], half[1], -half[2]],
    [half[0], half[1], -half[2]],
    [-half[0], -half[1], half[2]],
    [half[0], -half[1], half[2]],
    [-half[0], half[1], half[2]],
    [half[0], half[1], half[2]],
  ];
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const c of corners) {
    const r = rotateEuler(c, obj.rotation);
    const w: Vec3 = [r[0] + obj.position[0], r[1] + obj.position[1], r[2] + obj.position[2]];
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], w[a]);
      max[a] = Math.max(max[a], w[a]);
    }
  }
  return { min, max };
}
