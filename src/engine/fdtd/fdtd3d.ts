import { C_LIGHT, EPS0, MU0, PI } from '../constants';
import { makeCellGrid, percentile } from '../grid';
import type { GridSpec } from '../grid';
import type { Vec3 } from '../math/vec3';
import type { Scene, SliceQuantity } from '../../scene/types';
import { isAntenna, isPlaneWave, isPointSource } from '../../scene/types';
import { rasterizeScene } from '../../scene/rasterize';
import { localToWorld, worldAxis } from '../../scene/defaults';

export interface FdtdMeta {
  nx: number;
  ny: number;
  nz: number;
  physical: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
  dx: number;
  dy: number;
  dz: number;
  dt: number;
  cfl: number;
  wavelengthCells: number;
  frequency: number;
  domainMin: Vec3;
  domainMax: Vec3;
  pad: [number, number, number];
}

export interface FdtdSample {
  H: Vec3;
  epsilonR: number;
  muR: number;
  E: Vec3;
  B: Vec3;
  Emag: number;
  Bmag: number;
}

export class FdtdSolver {
  readonly scene: Scene;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  readonly dt: number;
  readonly pad: [number, number, number];
  readonly phys: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
  readonly domainMin: Vec3;
  readonly domainMax: Vec3;
  readonly grid: GridSpec;

  Ex: Float32Array;
  Ey: Float32Array;
  Ez: Float32Array;
  Hx: Float32Array;
  Hy: Float32Array;
  Hz: Float32Array;
  epsR: Float32Array;
  muR: Float32Array;
  sigmaE: Float32Array;
  sigmaM: Float32Array;
  pec: Uint8Array;
  caE: Float32Array;
  cbE: Float32Array;
  caH: Float32Array;
  cbH: Float32Array;

  time = 0;
  steps = 0;
  readonly meta: FdtdMeta;

  private readonly periodicX: boolean;
  private readonly periodicY: boolean;
  private readonly periodicZ: boolean;
  private readonly n: number;

  constructor(scene: Scene) {
    this.scene = scene;
    const size = scene.domain.size;
    const res = scene.simulation.resolution;
    const longest = Math.max(size[0], size[1], size[2]) || 1;
    const nBaseX = Math.max(8, Math.round((res * size[0]) / longest));
    const nBaseY = Math.max(8, Math.round((res * size[1]) / longest));
    const nBaseZ = Math.max(8, Math.round((res * size[2]) / longest));
    const pml = scene.simulation.pmlCells;
    const padX = scene.simulation.boundary.x === 'pml' ? pml : 0;
    const padY = scene.simulation.boundary.y === 'pml' ? pml : 0;
    const padZ = scene.simulation.boundary.z === 'pml' ? pml : 0;

    this.pad = [padX, padY, padZ];
    this.periodicX = scene.simulation.boundary.x === 'periodic';
    this.periodicY = scene.simulation.boundary.y === 'periodic';
    this.periodicZ = scene.simulation.boundary.z === 'periodic';

    this.nx = nBaseX + 2 * padX;
    this.ny = nBaseY + 2 * padY;
    this.nz = nBaseZ + 2 * padZ;
    this.n = this.nx * this.ny * this.nz;
    this.phys = {
      x0: padX, x1: padX + nBaseX,
      y0: padY, y1: padY + nBaseY,
      z0: padZ, z1: padZ + nBaseZ,
    };
    this.domainMin = [
      scene.domain.center[0] - size[0] / 2,
      scene.domain.center[1] - size[1] / 2,
      scene.domain.center[2] - size[2] / 2,
    ];
    this.domainMax = [
      scene.domain.center[0] + size[0] / 2,
      scene.domain.center[1] + size[1] / 2,
      scene.domain.center[2] + size[2] / 2,
    ];
    this.dx = size[0] / nBaseX;
    this.dy = size[1] / nBaseY;
    this.dz = size[2] / nBaseZ;
    this.grid = makeCellGrid(this.nx, this.ny, this.nz, scene.domain.center, [
      size[0] + 2 * padX * this.dx,
      size[1] + 2 * padY * this.dy,
      size[2] + 2 * padZ * this.dz,
    ]);
    // makeCellGrid uses size/dims to derive spacing; for padded grids ensure spacing matches.
    this.grid.min = [
      this.domainMin[0] - padX * this.dx,
      this.domainMin[1] - padY * this.dy,
      this.domainMin[2] - padZ * this.dz,
    ];

    const cfl = scene.simulation.cfl;
    this.dt = cfl / (C_LIGHT * Math.sqrt(1 / (this.dx * this.dx) + 1 / (this.dy * this.dy) + 1 / (this.dz * this.dz)));

    this.Ex = new Float32Array(this.n);
    this.Ey = new Float32Array(this.n);
    this.Ez = new Float32Array(this.n);
    this.Hx = new Float32Array(this.n);
    this.Hy = new Float32Array(this.n);
    this.Hz = new Float32Array(this.n);
    this.epsR = new Float32Array(this.n).fill(1);
    this.muR = new Float32Array(this.n).fill(1);
    this.sigmaE = new Float32Array(this.n);
    this.sigmaM = new Float32Array(this.n);
    this.pec = new Uint8Array(this.n);
    this.caE = new Float32Array(this.n);
    this.cbE = new Float32Array(this.n);
    this.caH = new Float32Array(this.n);
    this.cbH = new Float32Array(this.n);

    const baseGrid = makeCellGrid(nBaseX, nBaseY, nBaseZ, scene.domain.center, size);
    const raster = rasterizeScene(scene, baseGrid, { charges: false, centering: 'cells', materials: true });
    for (let k = 0; k < nBaseZ; k++) {
      for (let j = 0; j < nBaseY; j++) {
        for (let i = 0; i < nBaseX; i++) {
          const src = i + nBaseX * (j + nBaseY * k);
          const dst = (i + padX) + this.nx * ((j + padY) + this.ny * (k + padZ));
          this.epsR[dst] = raster.epsilon[src];
          this.muR[dst] = raster.mu[src];
          this.sigmaE[dst] = raster.sigma[src];
          this.pec[dst] = raster.conductor[src] ? 1 : 0;
        }
      }
    }

    this.applySponge(scene);
    this.buildCoefficients();
    this.applyBoundaryConditions();

    const f = this.sourceFrequency(scene);
    const lambda = f > 0 ? C_LIGHT / f : 0;
    this.meta = {
      nx: this.nx, ny: this.ny, nz: this.nz,
      physical: { ...this.phys },
      dx: this.dx, dy: this.dy, dz: this.dz, dt: this.dt, cfl,
      wavelengthCells: lambda > 0 ? lambda / Math.max(this.dx, this.dy, this.dz) : 0,
      frequency: f,
      domainMin: this.domainMin,
      domainMax: this.domainMax,
      pad: [padX, padY, padZ],
    };
  }

  private sourceFrequency(scene: Scene): number {
    for (const obj of scene.objects) {
      if (isPlaneWave(obj) || isPointSource(obj) || isAntenna(obj)) return obj.frequency;
    }
    return 0;
  }

  private applySponge(scene: Scene): void {
    const pml = scene.simulation.pmlCells;
    if (pml <= 0) return;
    const m = 3;
    const eta0 = Math.sqrt(MU0 / EPS0);
    const depth = pml * Math.max(this.dx, this.dy, this.dz);
    const sigmaMax = (-(m + 1) * Math.log(1e-4)) / (2 * eta0 * Math.max(depth, 1e-9));
    const axisSigma = (
      index: number, lo: number, hi: number, padLo: number, padHi: number, d: number,
    ): number => {
      if (index < lo) {
        const dd = (lo - index) * d;
        return sigmaMax * Math.pow(Math.min(dd / (padLo * d), 1), m);
      }
      if (index >= hi) {
        const dd = (index - hi + 1) * d;
        return sigmaMax * Math.pow(Math.min(dd / (padHi * d), 1), m);
      }
      return 0;
    };
    for (let k = 0; k < this.nz; k++) {
      const sz = axisSigma(k, this.phys.z0, this.phys.z1, this.pad[2], this.pad[2], this.dz);
      for (let j = 0; j < this.ny; j++) {
        const sy = axisSigma(j, this.phys.y0, this.phys.y1, this.pad[1], this.pad[1], this.dy);
        for (let i = 0; i < this.nx; i++) {
          const sx = axisSigma(i, this.phys.x0, this.phys.x1, this.pad[0], this.pad[0], this.dx);
          const c = i + this.nx * (j + this.ny * k);
          const sigma = sx + sy + sz;
          this.sigmaE[c] += sigma;
          this.sigmaM[c] += sigma * (MU0 / EPS0);
        }
      }
    }
  }

  private buildCoefficients(): void {
    for (let c = 0; c < this.n; c++) {
      const eps = EPS0 * Math.max(this.epsR[c], 1e-4);
      const mu = MU0 * Math.max(this.muR[c], 1e-4);
      const se = this.sigmaE[c];
      const sm = this.sigmaM[c];
      const ae = (se * this.dt) / (2 * eps);
      const am = (sm * this.dt) / (2 * mu);
      this.caE[c] = (1 - ae) / (1 + ae);
      this.cbE[c] = this.dt / eps / (1 + ae);
      this.caH[c] = (1 - am) / (1 + am);
      this.cbH[c] = this.dt / mu / (1 + am);
    }
  }

  private applyBoundaryConditions(): void {
    if (this.scene.simulation.boundary.x === 'pec') {
      for (let k = 0; k < this.nz; k++) {
        for (let j = 0; j < this.ny; j++) {
          const a = 0 + this.nx * (j + this.ny * k);
          const b = this.nx - 1 + this.nx * (j + this.ny * k);
          this.Ey[a] = this.Ey[b] = 0;
          this.Ez[a] = this.Ez[b] = 0;
        }
      }
    }
    if (this.scene.simulation.boundary.y === 'pec') {
      for (let k = 0; k < this.nz; k++) {
        for (let i = 0; i < this.nx; i++) {
          const a = i + this.nx * (0 + this.ny * k);
          const b = i + this.nx * (this.ny - 1 + this.ny * k);
          this.Ex[a] = this.Ex[b] = 0;
          this.Ez[a] = this.Ez[b] = 0;
        }
      }
    }
    if (this.scene.simulation.boundary.z === 'pec') {
      for (let j = 0; j < this.ny; j++) {
        for (let i = 0; i < this.nx; i++) {
          const a = i + this.nx * (j + this.ny * 0);
          const b = i + this.nx * (j + this.ny * (this.nz - 1));
          this.Ex[a] = this.Ex[b] = 0;
          this.Ey[a] = this.Ey[b] = 0;
        }
      }
    }
  }

  reset(): void {
    this.Ex.fill(0); this.Ey.fill(0); this.Ez.fill(0);
    this.Hx.fill(0); this.Hy.fill(0); this.Hz.fill(0);
    this.time = 0;
    this.steps = 0;
    this.applyBoundaryConditions();
  }

  step(count = 1): void {
    for (let s = 0; s < count; s++) {
      this.updateH();
      this.updateE();
      this.applyBoundaryConditions();
      this.injectSources();
      this.time += this.dt;
      this.steps++;
    }
  }

  private updateH(): void {
    const { nx, ny, nz, dx, dy, dz } = this;
    const Ex = this.Ex, Ey = this.Ey, Ez = this.Ez;
    const Hx = this.Hx, Hy = this.Hy, Hz = this.Hz;
    const ca = this.caH, cb = this.cbH;
    const px = this.periodicX, py = this.periodicY, pz = this.periodicZ;
    const nxy = nx * ny;
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const c = i + nx * (j + ny * k);
          const im = i > 0 ? c - 1 : px ? c + nx - 1 : c;
          const ip = i < nx - 1 ? c + 1 : px ? c - nx + 1 : c;
          const jm = j > 0 ? c - nx : py ? c + nx * (ny - 1) : c;
          const jp = j < ny - 1 ? c + nx : py ? c - nx * (ny - 1) : c;
          const km = k > 0 ? c - nxy : pz ? c + nxy * (nz - 1) : c;
          const kp = k < nz - 1 ? c + nxy : pz ? c - nxy * (nz - 1) : c;

          const curlX = (Ez[jp] - Ez[c]) / dy - (Ey[kp] - Ey[c]) / dz;
          const curlY = (Ex[kp] - Ex[c]) / dz - (Ez[ip] - Ez[c]) / dx;
          const curlZ = (Ey[ip] - Ey[c]) / dx - (Ex[jp] - Ex[c]) / dy;
          Hx[c] = ca[c] * Hx[c] - cb[c] * curlX;
          Hy[c] = ca[c] * Hy[c] - cb[c] * curlY;
          Hz[c] = ca[c] * Hz[c] - cb[c] * curlZ;
        }
      }
    }
  }

  private updateE(): void {
    const { nx, ny, nz, dx, dy, dz } = this;
    const Ex = this.Ex, Ey = this.Ey, Ez = this.Ez;
    const Hx = this.Hx, Hy = this.Hy, Hz = this.Hz;
    const ca = this.caE, cb = this.cbE;
    const px = this.periodicX, py = this.periodicY, pz = this.periodicZ;
    const nxy = nx * ny;
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const c = i + nx * (j + ny * k);
          if (this.pec[c]) {
            Ex[c] = Ey[c] = Ez[c] = 0;
            continue;
          }
          const im = i > 0 ? c - 1 : px ? c + nx - 1 : c;
          const ip = i < nx - 1 ? c + 1 : px ? c - nx + 1 : c;
          const jm = j > 0 ? c - nx : py ? c + nx * (ny - 1) : c;
          const jp = j < ny - 1 ? c + nx : py ? c - nx * (ny - 1) : c;
          const km = k > 0 ? c - nxy : pz ? c + nxy * (nz - 1) : c;
          const kp = k < nz - 1 ? c + nxy : pz ? c - nxy * (nz - 1) : c;

          const curlX = (Hz[c] - Hz[jm]) / dy - (Hy[c] - Hy[km]) / dz;
          const curlY = (Hx[c] - Hx[km]) / dz - (Hz[c] - Hz[im]) / dx;
          const curlZ = (Hy[c] - Hy[im]) / dx - (Hx[c] - Hx[jm]) / dy;
          Ex[c] = ca[c] * Ex[c] + cb[c] * curlX;
          Ey[c] = ca[c] * Ey[c] + cb[c] * curlY;
          Ez[c] = ca[c] * Ez[c] + cb[c] * curlZ;
        }
      }
    }
  }

  private injectSources(): void {
    const t = this.time;
    for (const obj of this.scene.objects) {
      if (!obj.visible) continue;
      if (isPlaneWave(obj)) {
        const amp = obj.amplitude * waveform(t, obj.frequency, obj.waveform);
        if (amp === 0) continue;
        const i = Math.min(this.phys.x1 - 2, this.phys.x0 + Math.max(3, Math.round((this.phys.x1 - this.phys.x0) * 0.08)));
        for (let k = 0; k < this.nz; k++) {
          for (let j = 0; j < this.ny; j++) {
            const c = i + this.nx * (j + this.ny * k);
            if (obj.polarization === 'y') this.Ey[c] += amp;
            else this.Ez[c] += amp;
          }
        }
      } else if (isPointSource(obj)) {
        const amp = obj.amplitude * waveform(t, obj.frequency, obj.waveform);
        if (amp === 0) continue;
        const [i, j, k] = this.worldToIndex(obj.position);
        const c = i + this.nx * (j + this.ny * k);
        switch (obj.component) {
          case 'Ex': this.Ex[c] += amp; break;
          case 'Ey': this.Ey[c] += amp; break;
          case 'Ez': this.Ez[c] += amp; break;
          case 'Hx': this.Hx[c] += amp; break;
          case 'Hy': this.Hy[c] += amp; break;
          case 'Hz': this.Hz[c] += amp; break;
        }
      } else if (isAntenna(obj)) {
        const amp = obj.amplitude * waveform(t, obj.frequency, obj.waveform);
        if (amp === 0) continue;
        const axis = worldAxis(obj, [0, 1, 0]);
        const half = obj.length / 2;
        const steps = Math.max(4, Math.ceil(obj.length / Math.min(this.dx, this.dy, this.dz)));
        for (let s = 0; s <= steps; s++) {
          const f = -half + (s / steps) * obj.length;
          const p: Vec3 = [
            obj.position[0] + axis[0] * f,
            obj.position[1] + axis[1] * f,
            obj.position[2] + axis[2] * f,
          ];
          const [i, j, k] = this.worldToIndex(p);
          const c = i + this.nx * (j + this.ny * k);
          // A y-directed filament mainly launches Ey.
          if (Math.abs(axis[1]) >= Math.abs(axis[0]) && Math.abs(axis[1]) >= Math.abs(axis[2])) {
            this.Ey[c] += amp / (steps + 1);
          } else if (Math.abs(axis[0]) >= Math.abs(axis[2])) {
            this.Ex[c] += amp / (steps + 1);
          } else {
            this.Ez[c] += amp / (steps + 1);
          }
        }
      }
      void PI;
      void C_LIGHT;
      void localToWorld;
    }
  }

  worldToIndex(p: Vec3): [number, number, number] {
    const i = Math.round((p[0] - this.grid.min[0]) / this.dx - 0.5);
    const j = Math.round((p[1] - this.grid.min[1]) / this.dy - 0.5);
    const k = Math.round((p[2] - this.grid.min[2]) / this.dz - 0.5);
    return [
      Math.min(this.nx - 1, Math.max(0, i)),
      Math.min(this.ny - 1, Math.max(0, j)),
      Math.min(this.nz - 1, Math.max(0, k)),
    ];
  }

  private sampleArray(arr: Float32Array, p: Vec3, multiplier?: Float32Array): number {
    const fx = Math.min(this.nx - 1, Math.max(0, (p[0] - this.grid.min[0]) / this.dx - 0.5));
    const fy = Math.min(this.ny - 1, Math.max(0, (p[1] - this.grid.min[1]) / this.dy - 0.5));
    const fz = Math.min(this.nz - 1, Math.max(0, (p[2] - this.grid.min[2]) / this.dz - 0.5));
    const i0 = Math.floor(fx), j0 = Math.floor(fy), k0 = Math.floor(fz);
    const i1 = Math.min(i0 + 1, this.nx - 1);
    const j1 = Math.min(j0 + 1, this.ny - 1);
    const k1 = Math.min(k0 + 1, this.nz - 1);
    const tx = fx - i0, ty = fy - j0, tz = fz - k0;
    const at = (i: number) => arr[i] * (multiplier?.[i] ?? 1);
    const c000 = at(i0 + this.nx * (j0 + this.ny * k0));
    const c100 = at(i1 + this.nx * (j0 + this.ny * k0));
    const c010 = at(i0 + this.nx * (j1 + this.ny * k0));
    const c110 = at(i1 + this.nx * (j1 + this.ny * k0));
    const c001 = at(i0 + this.nx * (j0 + this.ny * k1));
    const c101 = at(i1 + this.nx * (j0 + this.ny * k1));
    const c011 = at(i0 + this.nx * (j1 + this.ny * k1));
    const c111 = at(i1 + this.nx * (j1 + this.ny * k1));
    const c00 = c000 + (c100 - c000) * tx;
    const c10 = c010 + (c110 - c010) * tx;
    const c01 = c001 + (c101 - c001) * tx;
    const c11 = c011 + (c111 - c011) * tx;
    const c0 = c00 + (c10 - c00) * ty;
    const c1 = c01 + (c11 - c01) * ty;
    return c0 + (c1 - c0) * tz;
  }

  sample(p: Vec3): FdtdSample {
    const E: Vec3 = [
      this.sampleArray(this.Ex, p),
      this.sampleArray(this.Ey, p),
      this.sampleArray(this.Ez, p),
    ];
    const H: Vec3 = [
      this.sampleArray(this.Hx, p),
      this.sampleArray(this.Hy, p),
      this.sampleArray(this.Hz, p),
    ];
    const B: Vec3 = [this.sampleArray(this.Hx, p, this.muR) * MU0,
      this.sampleArray(this.Hy, p, this.muR) * MU0, this.sampleArray(this.Hz, p, this.muR) * MU0];
    return {
      E, B, H, epsilonR: this.sampleArray(this.epsR, p), muR: this.sampleArray(this.muR, p),
      Emag: Math.hypot(E[0], E[1], E[2]),
      Bmag: Math.hypot(B[0], B[1], B[2]),
    };
  }

  sampleSlice(
    axis: 'x' | 'y' | 'z',
    position: number,
    quantity: SliceQuantity,
    resolution = 160,
  ): { data: Float32Array; min: number; max: number } {
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
        const s = this.sample(p);
        let value = 0;
        switch (quantity) {
          case 'Emag': value = s.Emag; break;
          case 'Ex': value = s.E[0]; break;
          case 'Ey': value = s.E[1]; break;
          case 'Ez': value = s.E[2]; break;
          case 'Bmag': value = s.Bmag; break;
          case 'energyE': value = 0.5 * EPS0 * s.epsilonR * s.Emag * s.Emag; break;
          case 'energyB': value = 0.5 * MU0 * s.muR * (s.H[0] ** 2 + s.H[1] ** 2 + s.H[2] ** 2); break;
          case 'poynting': {
            const Sx = s.E[1] * s.H[2] - s.E[2] * s.H[1];
            const Sy = s.E[2] * s.H[0] - s.E[0] * s.H[2];
            const Sz = s.E[0] * s.H[1] - s.E[1] * s.H[0];
            value = Math.hypot(Sx, Sy, Sz);
            break;
          }
          default: value = s.Emag;
        }
        data[v * res + u] = value;
        if (Number.isFinite(value)) {
          if (value < min) min = value;
          if (value > max) max = value;
        }
      }
    }
    if (!Number.isFinite(min)) { min = 0; max = 1; }
    const positive = quantity !== 'Ex' && quantity !== 'Ey' && quantity !== 'Ez';
    if (positive) {
      min = 0;
      const p95 = percentile(data, 0.98);
      max = p95 > 0 ? p95 : max;
    }
    return { data, min, max };
  }

  sampleLattice(
    count = 9,
    field: 'E' | 'B' | 'P' = 'E',
  ): { positions: Float32Array; vectors: Float32Array; magnitudes: Float32Array } {
    const n = Math.max(3, Math.min(20, Math.round(count)));
    const positions = new Float32Array(n * n * n * 3);
    const vectors = new Float32Array(n * n * n * 3);
    const magnitudes = new Float32Array(n * n * n);
    const size = this.scene.domain.size;
    const center = this.scene.domain.center;
    let o = 0;
    for (let k = 0; k < n; k++) {
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const p: Vec3 = [
            center[0] + ((i + 0.5) / n - 0.5) * size[0],
            center[1] + ((j + 0.5) / n - 0.5) * size[1],
            center[2] + ((k + 0.5) / n - 0.5) * size[2],
          ];
          const s = this.sample(p);
          positions[o] = p[0]; positions[o + 1] = p[1]; positions[o + 2] = p[2];
          if (field === 'B') {
            vectors[o] = s.B[0]; vectors[o + 1] = s.B[1]; vectors[o + 2] = s.B[2];
            magnitudes[o / 3] = s.Bmag;
          } else if (field === 'P') {
            const sx = s.E[1] * s.H[2] - s.E[2] * s.H[1];
            const sy = s.E[2] * s.H[0] - s.E[0] * s.H[2];
            const sz = s.E[0] * s.H[1] - s.E[1] * s.H[0];
            vectors[o] = sx; vectors[o + 1] = sy; vectors[o + 2] = sz;
            magnitudes[o / 3] = Math.hypot(sx, sy, sz);
          } else {
            vectors[o] = s.E[0]; vectors[o + 1] = s.E[1]; vectors[o + 2] = s.E[2];
            magnitudes[o / 3] = s.Emag;
          }
          o += 3;
        }
      }
    }
    return { positions, vectors, magnitudes };
  }

  energy(): { electric: number; magnetic: number } {
    let ue = 0, ub = 0;
    const dv = this.dx * this.dy * this.dz;
    for (let k = this.phys.z0; k < this.phys.z1; k++) {
      for (let j = this.phys.y0; j < this.phys.y1; j++) {
        for (let i = this.phys.x0; i < this.phys.x1; i++) {
          const c = i + this.nx * (j + this.ny * k);
          ue += 0.5 * EPS0 * this.epsR[c] * (this.Ex[c] ** 2 + this.Ey[c] ** 2 + this.Ez[c] ** 2);
          ub += 0.5 * MU0 * this.muR[c] * (this.Hx[c] ** 2 + this.Hy[c] ** 2 + this.Hz[c] ** 2);
        }
      }
    }
    return { electric: ue * dv, magnetic: ub * dv };
  }
}

function waveform(t: number, frequency: number, kind: 'cw' | 'pulse'): number {
  const f = Math.max(1, frequency);
  if (kind === 'cw') {
    const ramp = Math.min(1, t / (3 / f));
    return ramp * Math.sin(2 * PI * f * t);
  }
  const tau = 2 / f;
  const t0 = 4 / f;
  const dt = t - t0;
  if (Math.abs(dt) > 5 * tau) return 0;
  return Math.exp(-(dt * dt) / (tau * tau)) * Math.sin(2 * PI * f * dt);
}
