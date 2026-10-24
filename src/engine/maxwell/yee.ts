import { Cpml } from './cpml';

export const LIGHT_SPEED = 299792458;
export const EPSILON_0 = 8.8541878128e-12;
export const MU_0 = 1 / (EPSILON_0 * LIGHT_SPEED ** 2);
export type YeeBoundary = 'periodic' | 'pec' | 'pml';
export interface YeeOptions {
  nx: number; ny: number; nz: number; dx: number; dy: number; dz: number;
  cfl?: number; dt?: number; boundary: { x: YeeBoundary; y: YeeBoundary; z: YeeBoundary }; pmlCells?: number;
}
const fieldNames = ['Ex', 'Ey', 'Ez', 'Bx', 'By', 'Bz', 'Jx', 'Jy', 'Jz', 'rho'] as const;
const materialNames = ['epsX', 'epsY', 'epsZ', 'muX', 'muY', 'muZ', 'sigmaX', 'sigmaY', 'sigmaZ'] as const;
type FieldName = typeof fieldNames[number];
type MaterialName = typeof materialNames[number];
export type DrudeCoefficient = number | { x: number | Float64Array; y: number | Float64Array; z: number | Float64Array };
export interface DrudeOptions { omegaP: DrudeCoefficient; gamma?: DrudeCoefficient; }
const drudeNames = ['omegaPX', 'omegaPY', 'omegaPZ', 'gammaX', 'gammaY', 'gammaZ', 'Jx', 'Jy', 'Jz'] as const;
export type DrudeState = Record<typeof drudeNames[number], Float64Array> & { loss: number };
export type YeeSnapshot = Record<FieldName | MaterialName, Float64Array> & {
  time: number; steps: number; ohmicLoss: number; sourceWork: number; cpml: Float64Array[]; cpmlReference: Float64Array[]; boundaryE: Float64Array[];
  drude: DrudeState | null;
  conduction: Float64Array[];
};
export interface YeeDiagnostics {
  divergenceE: number; divergenceB: number; charge: number; electricEnergy: number;
  magneticEnergy: number; totalEnergy: number; ohmicLoss: number; sourceWork: number;
  drudeKineticEnergy: number; drudeLoss: number;
}

/** SI, edge E/J, face B, nodal rho. B is at time-dt/2, E and rho at time.
 * A nonperiodic axis has its PEC closure at nodal coordinate 0 (and n).
 * CPML uses that PEC backing wall; its cells are excluded from Gauss diagnostics.
 */
export class YeeSolver {
  readonly nx: number; readonly ny: number; readonly nz: number;
  readonly dx: number; readonly dy: number; readonly dz: number; readonly dt: number;
  readonly Ex: Float64Array; readonly Ey: Float64Array; readonly Ez: Float64Array;
  readonly Bx: Float64Array; readonly By: Float64Array; readonly Bz: Float64Array;
  readonly Jx: Float64Array; readonly Jy: Float64Array; readonly Jz: Float64Array; readonly rho: Float64Array;
  readonly epsX: Float64Array; readonly epsY: Float64Array; readonly epsZ: Float64Array;
  readonly muX: Float64Array; readonly muY: Float64Array; readonly muZ: Float64Array;
  readonly sigmaX: Float64Array; readonly sigmaY: Float64Array; readonly sigmaZ: Float64Array;
  time = 0; steps = 0;
  private ohmicLoss = 0; private sourceWork = 0;
  private readonly shape: number[]; private readonly spacing: number[]; private readonly boundaries: YeeBoundary[];
  private readonly pmlCells: number; private readonly pml: Cpml | null;
  private readonly previous: Int32Array[]; private readonly next: Int32Array[];
  private readonly conduction: Float64Array[];
  private readonly boundaryIndices: Int32Array[];
  private readonly boundaryE: Float64Array[];
  private _drude: DrudeState | null = null;

  constructor(o: YeeOptions) {
    this.shape = [o.nx, o.ny, o.nz]; this.spacing = [o.dx, o.dy, o.dz];
    this.boundaries = [o.boundary.x, o.boundary.y, o.boundary.z];
    if (this.shape.some(n => !Number.isSafeInteger(n) || n < 1) || this.spacing.some(h => !(h > 0 && Number.isFinite(h)))) throw new Error('Invalid Yee grid');
    const size = o.nx * o.ny * o.nz;
    if (!Number.isSafeInteger(size) || size > 16_000_000) throw new Error('Yee grid allocation exceeds CPU reference limit');
    this.nx = o.nx; this.ny = o.ny; this.nz = o.nz; this.dx = o.dx; this.dy = o.dy; this.dz = o.dz;
    const cfl = o.cfl ?? 0.9;
    if (!(cfl > 0 && cfl <= 1)) throw new Error('CFL factor must be in (0,1]');
    this.dt = o.dt ?? cfl / (LIGHT_SPEED * Math.sqrt(this.spacing.reduce((s, h, a) => s + (this.shape[a] > 1 ? 1 / h ** 2 : 0), 0) || 1 / o.dx ** 2));
    if (!(this.dt > 0 && Number.isFinite(this.dt))) throw new Error('Invalid timestep');
    const allocate = (value = 0) => new Float64Array(size).fill(value);
    this.Ex = allocate(); this.Ey = allocate(); this.Ez = allocate();
    this.Bx = allocate(); this.By = allocate(); this.Bz = allocate();
    this.Jx = allocate(); this.Jy = allocate(); this.Jz = allocate(); this.rho = allocate();
    this.epsX = allocate(1); this.epsY = allocate(1); this.epsZ = allocate(1);
    this.muX = allocate(1); this.muY = allocate(1); this.muZ = allocate(1);
    this.sigmaX = allocate(); this.sigmaY = allocate(); this.sigmaZ = allocate();
    this.previous = [0, 1, 2].map(() => new Int32Array(size)); this.next = [0, 1, 2].map(() => new Int32Array(size));
    for (let z = 0; z < o.nz; z++) for (let y = 0; y < o.ny; y++) for (let x = 0; x < o.nx; x++) {
      const i = this.index(x, y, z), p = [x, y, z];
      for (let axis = 0; axis < 3; axis++) {
        const q = p.slice(); q[axis] = (p[axis] + 1) % this.shape[axis]; this.next[axis][i] = this.index(q[0], q[1], q[2]);
        q[axis] = (p[axis] + this.shape[axis] - 1) % this.shape[axis]; this.previous[axis][i] = this.index(q[0], q[1], q[2]);
      }
    }
    this.conduction = [new Float64Array(size), new Float64Array(size), new Float64Array(size)];
    this.pmlCells = o.pmlCells ?? 8;
    for (let a = 0; a < 3; a++) if (this.boundaries[a] === 'pml' && (this.pmlCells < 2 || 2 * this.pmlCells >= this.shape[a])) throw new Error('PML requires at least two cells and a nonempty physical interior');
    this.pml = this.boundaries.includes('pml') ? new Cpml(this.shape, this.spacing, this.boundaries, this.pmlCells, this.dt, LIGHT_SPEED) : null;
    const pinned: number[][] = [[], [], []];
    for (let z = 0; z < this.nz; z++) for (let y = 0; y < this.ny; y++) for (let x = 0; x < this.nx; x++) {
      const pos = [x, y, z], index = this.index(x, y, z);
      for (let component = 0; component < 3; component++) if (pos.some((v, axis) => axis !== component && this.boundaries[axis] !== 'periodic' && v === 0)) pinned[component].push(index);
    }
    this.boundaryIndices = pinned.map(indices => Int32Array.from(indices));
    this.boundaryE = pinned.map(indices => new Float64Array(indices.length));
    this.validateMaterials();
  }

  index(x: number, y: number, z: number) { return x + this.nx * (y + this.ny * z); }

  /** Optional stationary pole. omegaP is angular rad/s; gamma is damping s^-1.
   * The existing eps arrays are epsilon-infinity; these J arrays are at t-dt/2.
   * Nine Float64 arrays (72 bytes/cell) exist only while the pole is enabled.
   */
  get drude(): DrudeState | null { return this._drude; }

  /** Current density in the latest Ampere update (t-dt/2), at its native edge.
   * The impressed J arrays must still contain that update's deposited current.
   * Includes the implicit Ohmic current and optional free Drude current.
   */
  currentAtUpdate(axis: 0 | 1 | 2, index: number): number {
    const impressed = axis === 0 ? this.Jx : axis === 1 ? this.Jy : this.Jz;
    const drude = this._drude && (axis === 0 ? this._drude.Jx : axis === 1 ? this._drude.Jy : this._drude.Jz);
    return impressed[index] + this.conduction[axis][index] + (drude?.[index] ?? 0);
  }

  configureDrude(options: DrudeOptions | null) {
    if (!options) { this._drude = null; return; }
    const size = this.rho.length;
    const coefficient = (value: DrudeCoefficient, axis: 'x' | 'y' | 'z') => {
      const input = typeof value === 'number' ? value : value[axis];
      if (typeof input === 'number') return new Float64Array(size).fill(input);
      if (!(input instanceof Float64Array) || input.length !== size) throw new Error('Drude coefficient array must match the Yee grid');
      return input.slice();
    };
    const state: DrudeState = { omegaPX: coefficient(options.omegaP, 'x'), omegaPY: coefficient(options.omegaP, 'y'), omegaPZ: coefficient(options.omegaP, 'z'),
      gammaX: coefficient(options.gamma ?? 0, 'x'), gammaY: coefficient(options.gamma ?? 0, 'y'), gammaZ: coefficient(options.gamma ?? 0, 'z'),
      Jx: new Float64Array(size), Jy: new Float64Array(size), Jz: new Float64Array(size), loss: 0 };
    const previous = this._drude; this._drude = state;
    try { this.validateMaterials(); } catch (error) { this._drude = previous; throw error; }
  }

  validateMaterials() {
    let eps = Infinity, mu = Infinity;
    for (const a of [this.epsX, this.epsY, this.epsZ]) for (const v of a) { if (!(v > 0 && Number.isFinite(v))) throw new Error('Relative permittivity must be positive'); eps = Math.min(eps, v); }
    for (const a of [this.muX, this.muY, this.muZ]) for (const v of a) { if (!(v > 0 && Number.isFinite(v))) throw new Error('Relative permeability must be positive'); mu = Math.min(mu, v); }
    for (const a of [this.sigmaX, this.sigmaY, this.sigmaZ]) for (const v of a) if (!(v >= 0 && Number.isFinite(v))) throw new Error('Conductivity must be nonnegative');
    const sum = this.spacing.reduce((s, h, a) => s + (this.shape[a] > 1 ? 1 / h ** 2 : 0), 0) || 1 / this.dx ** 2;
    let plasma = 0;
    if (this._drude) {
      const frequencies = [this._drude.omegaPX, this._drude.omegaPY, this._drude.omegaPZ], damping = [this._drude.gammaX, this._drude.gammaY, this._drude.gammaZ], epsilon = [this.epsX, this.epsY, this.epsZ];
      for (let c = 0; c < 3; c++) for (let i = 0; i < this.rho.length; i++) {
        const wp = frequencies[c][i], gamma = damping[c][i];
        if (!(wp >= 0 && Number.isFinite(wp))) throw new Error('Drude plasma angular frequency must be finite and nonnegative');
        if (!(gamma >= 0 && Number.isFinite(gamma) && Number.isFinite(gamma * this.dt))) throw new Error('Drude damping rate must be finite and nonnegative at this timestep');
        plasma = Math.max(plasma, wp ** 2 / epsilon[c][i]);
      }
    }
    const coupled = this.dt ** 2 * (LIGHT_SPEED ** 2 * sum / (eps * mu) + plasma / 4);
    if (!Number.isFinite(coupled) || coupled > 1 + 1e-12) throw new Error('Timestep exceeds coupled wave/plasma material CFL stability bound');
  }

  private enforceBoundary() {
    const E = [this.Ex, this.Ey, this.Ez];
    for (let c = 0; c < 3; c++) for (let j = 0; j < this.boundaryIndices[c].length; j++) E[c][this.boundaryIndices[c][j]] = this.boundaryE[c][j];
  }

  step(count = 1) {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Step count must be a nonnegative integer');
    const E = [this.Ex, this.Ey, this.Ez], B = [this.Bx, this.By, this.Bz], J = [this.Jx, this.Jy, this.Jz];
    const eps = [this.epsX, this.epsY, this.epsZ], mu = [this.muX, this.muY, this.muZ], sigma = [this.sigmaX, this.sigmaY, this.sigmaZ];
    const pole = this._drude, omegaP = pole && [pole.omegaPX, pole.omegaPY, pole.omegaPZ], gamma = pole && [pole.gammaX, pole.gammaY, pole.gammaZ], drudeJ = pole && [pole.Jx, pole.Jy, pole.Jz];
    const vol = this.dx * this.dy * this.dz;
    for (let step = 0; step < count; step++) {
      this.enforceBoundary();
      for (let z = 0; z < this.nz; z++) for (let y = 0; y < this.ny; y++) for (let x = 0; x < this.nx; x++) {
        const i = this.index(x, y, z), p = [x, y, z];
        for (let c = 0; c < 3; c++) {
          const a = (c + 1) % 3, b = (c + 2) % 3;
          let da = (E[b][this.next[a][i]] - E[b][i]) / this.spacing[a];
          let db = (E[a][this.next[b][i]] - E[a][i]) / this.spacing[b];
          if (this.pml) { da = this.pml.derivative(c * 2, a, p[a], i, true, da); db = this.pml.derivative(c * 2 + 1, b, p[b], i, true, db); }
          B[c][i] -= this.dt * (da - db);
        }
      }
      for (let z = 0; z < this.nz; z++) for (let y = 0; y < this.ny; y++) for (let x = 0; x < this.nx; x++) {
        const i = this.index(x, y, z), p = [x, y, z];
        for (let c = 0; c < 3; c++) {
          const a = (c + 1) % 3, b = (c + 2) % 3, ia = this.previous[a][i], ib = this.previous[b][i];
          let da = (B[b][i] / mu[b][i] - B[b][ia] / mu[b][ia]) / (MU_0 * this.spacing[a]);
          let db = (B[a][i] / mu[a][i] - B[a][ib] / mu[a][ib]) / (MU_0 * this.spacing[b]);
          if (this.pml) { da = this.pml.derivative(6 + c * 2, a, p[a], i, false, da); db = this.pml.derivative(7 + c * 2, b, p[b], i, false, db); }
          const old = E[c][i], e = EPSILON_0 * eps[c][i], factor = sigma[c][i] * this.dt / (2 * e);
          let jd = 0;
          if (pole && omegaP && gamma && drudeJ) {
            const wp2 = omegaP[c][i] ** 2, damping = gamma[c][i], half = damping * this.dt / 2;
            jd = ((1 - half) * drudeJ[c][i] + EPSILON_0 * wp2 * this.dt * old) / (1 + half);
            drudeJ[c][i] = jd;
            if (wp2 > 0) pole.loss += this.dt * damping * jd ** 2 / (EPSILON_0 * wp2) * vol;
          }
          const value = ((1 - factor) * old + this.dt / e * (da - db - J[c][i] - jd)) / (1 + factor);
          const average = (old + value) / 2;
          E[c][i] = value; this.conduction[c][i] = sigma[c][i] * average;
          this.ohmicLoss += this.dt * sigma[c][i] * average ** 2 * vol;
          this.sourceWork -= this.dt * J[c][i] * average * vol;
        }
      }
      for (let i = 0; i < this.rho.length; i++) {
        let div = 0;
        for (let c = 0; c < 3; c++) {
          const im = this.previous[c][i], freeDrude = drudeJ ? drudeJ[c][i] - drudeJ[c][im] : 0;
          div += (J[c][i] + this.conduction[c][i] - J[c][im] - this.conduction[c][im] + freeDrude) / this.spacing[c];
        }
        this.rho[i] -= this.dt * div;
      }
      this.enforceBoundary(); this.steps++; this.time = this.steps * this.dt;
    }
  }

  private divD(i: number) {
    return EPSILON_0 * ((this.epsX[i] * this.Ex[i] - this.epsX[this.previous[0][i]] * this.Ex[this.previous[0][i]]) / this.dx
      + (this.epsY[i] * this.Ey[i] - this.epsY[this.previous[1][i]] * this.Ey[this.previous[1][i]]) / this.dy
      + (this.epsZ[i] * this.Ez[i] - this.epsZ[this.previous[2][i]] * this.Ez[this.previous[2][i]]) / this.dz);
  }

  /** Explicit initialization utility; never called by step(). */
  setChargeFromElectricField() { for (let i = 0; i < this.rho.length; i++) this.rho[i] = this.divD(i); }

  /** Capture an independently initialized static solution. CPML absorbs its
   * perturbations; it must not stretch a DC gradient into a nonzero curl.
   * This only changes the boundary derivative decomposition, never the fields,
   * charge, source currents, or physical-interior Maxwell evolution.
   * Call once after static initialization and before saving the initial snapshot.
   */
  captureStaticBackground() {
    if (!this.pml) return;
    if (this.steps !== 0) throw new Error('Capture static background before time stepping');
    const E = [this.Ex, this.Ey, this.Ez], B = [this.Bx, this.By, this.Bz], mu = [this.muX, this.muY, this.muZ];
    // The outer wall holds the prepared static boundary values while its
    // perturbations obey PEC. A varying static Dirichlet potential is allowed.
    // Bare PEC axes retain their physical zero tangential E condition.
    for (let c = 0; c < 3; c++) for (let j = 0; j < this.boundaryIndices[c].length; j++) {
      const i = this.boundaryIndices[c][j];
      const pos = [i % this.nx, Math.floor(i / this.nx) % this.ny, Math.floor(i / (this.nx * this.ny))];
      const barePec = pos.some((v, a) => a !== c && v === 0 && this.boundaries[a] === 'pec');
      this.boundaryE[c][j] = barePec ? 0 : E[c][i];
    }
    this.enforceBoundary();
    for (let i = 0; i < this.rho.length; i++) for (let c = 0; c < 3; c++) {
      const a = (c + 1) % 3, b = (c + 2) % 3, ia = this.previous[a][i], ib = this.previous[b][i];
      this.pml.reference[c * 2][i] = (E[b][this.next[a][i]] - E[b][i]) / this.spacing[a];
      this.pml.reference[c * 2 + 1][i] = (E[a][this.next[b][i]] - E[a][i]) / this.spacing[b];
      this.pml.reference[6 + c * 2][i] = (B[b][i] / mu[b][i] - B[b][ia] / mu[b][ia]) / (MU_0 * this.spacing[a]);
      this.pml.reference[7 + c * 2][i] = (B[a][i] / mu[a][i] - B[a][ib] / mu[a][ib]) / (MU_0 * this.spacing[b]);
    }
    for (const memory of this.pml.memories) memory.fill(0);
  }

  /** Time-centered B at its native face. Spatial interpolation is a caller responsibility. */
  synchronizedB(component: 0 | 1 | 2, i: number): number {
    const a = (component + 1) % 3, b = (component + 2) % 3;
    const ea = a === 0 ? this.Ex : a === 1 ? this.Ey : this.Ez;
    const eb = b === 0 ? this.Ex : b === 1 ? this.Ey : this.Ez;
    let da = (eb[this.next[a][i]] - eb[i]) / this.spacing[a];
    let db = (ea[this.next[b][i]] - ea[i]) / this.spacing[b];
    if (this.pml) {
      const p = [i % this.nx, Math.floor(i / this.nx) % this.ny, Math.floor(i / (this.nx * this.ny))];
      da = this.pml.previewDerivative(component * 2, a, p[a], i, true, da);
      db = this.pml.previewDerivative(component * 2 + 1, b, p[b], i, true, db);
    }
    const field = component === 0 ? this.Bx : component === 1 ? this.By : this.Bz;
    return field[i] - 0.5 * this.dt * (da - db);
  }

  diagnostics(): YeeDiagnostics {
    let de = 0, db = 0, n = 0, charge = 0, electricEnergy = 0, magneticEnergy = 0, drudeKineticEnergy = 0;
    const E = [this.Ex, this.Ey, this.Ez], B = [this.Bx, this.By, this.Bz], eps = [this.epsX, this.epsY, this.epsZ], mu = [this.muX, this.muY, this.muZ];
    const pole = this._drude, frequencies = pole && [pole.omegaPX, pole.omegaPY, pole.omegaPZ], damping = pole && [pole.gammaX, pole.gammaY, pole.gammaZ], currents = pole && [pole.Jx, pole.Jy, pole.Jz];
    for (let z = 0; z < this.nz; z++) for (let y = 0; y < this.ny; y++) for (let x = 0; x < this.nx; x++) {
      const i = this.index(x, y, z), p = [x, y, z]; charge += this.rho[i];
      for (let c = 0; c < 3; c++) {
        electricEnergy += 0.5 * EPSILON_0 * eps[c][i] * E[c][i] ** 2;
        // Physical energy estimate at the E time, not an exact discrete invariant.
        magneticEnergy += 0.5 * this.synchronizedB(c as 0 | 1 | 2, i) ** 2 / (MU_0 * mu[c][i]);
        if (pole && frequencies && damping && currents && frequencies[c][i] > 0) {
          const wp2 = frequencies[c][i] ** 2, half = damping[c][i] * this.dt / 2, previous = currents[c][i];
          const next = ((1 - half) * previous + EPSILON_0 * wp2 * this.dt * E[c][i]) / (1 + half);
          drudeKineticEnergy += ((previous + next) / 2) ** 2 / (2 * EPSILON_0 * wp2);
        }
      }
      if (p.some((v, a) => this.boundaries[a] !== 'periodic' && (v < (this.boundaries[a] === 'pml' ? this.pmlCells + 1 : 1) || v >= this.shape[a] - (this.boundaries[a] === 'pml' ? this.pmlCells + 1 : 1)))) continue;
      de += (this.divD(i) - this.rho[i]) ** 2;
      let div = 0; for (let c = 0; c < 3; c++) div += (B[c][this.next[c][i]] - B[c][i]) / this.spacing[c];
      db += div ** 2; n++;
    }
    const vol = this.dx * this.dy * this.dz; electricEnergy *= vol; magneticEnergy *= vol; drudeKineticEnergy *= vol;
    return { divergenceE: Math.sqrt(de / Math.max(n, 1)), divergenceB: Math.sqrt(db / Math.max(n, 1)), charge: charge * vol, electricEnergy, magneticEnergy, totalEnergy: electricEnergy + magneticEnergy + drudeKineticEnergy,
      ohmicLoss: this.ohmicLoss, sourceWork: this.sourceWork, drudeKineticEnergy, drudeLoss: pole?.loss ?? 0 };
  }

  /** Variable-epsilon CG initial Gauss projection. Periodic net charge is unsolvable. */
  projectElectricField(tolerance = 1e-10, maxIterations = 1000): number {
    const size = this.rho.length, phi = new Float64Array(size), r = new Float64Array(size), p = new Float64Array(size), ap = new Float64Array(size);
    const eps = [this.epsX, this.epsY, this.epsZ], E = [this.Ex, this.Ey, this.Ez];
    const fixed = new Uint8Array(size);
    for (let z = 0; z < this.nz; z++) for (let y = 0; y < this.ny; y++) for (let x = 0; x < this.nx; x++) {
      const i = this.index(x, y, z), pos = [x, y, z];
      fixed[i] = Number(pos.some((v, a) => this.boundaries[a] !== 'periodic' && v === 0));
      r[i] = fixed[i] ? 0 : (this.rho[i] - this.divD(i)) / EPSILON_0;
    }
    if (this.boundaries.every(v => v === 'periodic')) {
      let sum = 0, abs = 0; for (const v of r) { sum += v; abs += Math.abs(v); }
      if (Math.abs(sum) > 1e-10 * Math.max(abs, 1e-100)) throw new Error('Periodic Gauss projection requires zero net charge');
    }
    p.set(r); let rr = r.reduce((s, v) => s + v * v, 0), initial = rr;
    for (let iteration = 0; iteration < maxIterations && rr > initial * tolerance ** 2 && rr > 1e-100; iteration++) {
      let pap = 0;
      for (let i = 0; i < size; i++) {
        let v = 0;
        if (!fixed[i]) for (let a = 0; a < 3; a++) { const ip = this.next[a][i], im = this.previous[a][i]; v += (eps[a][i] * (p[i] - p[ip]) + eps[a][im] * (p[i] - p[im])) / this.spacing[a] ** 2; }
        ap[i] = v; pap += p[i] * v;
      }
      if (!(pap > 0)) break;
      const alpha = rr / pap; let nextRR = 0;
      for (let i = 0; i < size; i++) { phi[i] += alpha * p[i]; r[i] -= alpha * ap[i]; nextRR += r[i] ** 2; }
      const beta = nextRR / rr; for (let i = 0; i < size; i++) p[i] = r[i] + beta * p[i]; rr = nextRR;
    }
    for (let i = 0; i < size; i++) for (let a = 0; a < 3; a++) E[a][i] -= (phi[this.next[a][i]] - phi[i]) / this.spacing[a];
    this.enforceBoundary(); return this.diagnostics().divergenceE;
  }

  snapshot(): YeeSnapshot {
    const result = { time: this.time, steps: this.steps, ohmicLoss: this.ohmicLoss, sourceWork: this.sourceWork,
      cpml: this.pml?.memories.map(a => a.slice()) ?? [], cpmlReference: this.pml?.reference.map(a => a.slice()) ?? [] } as YeeSnapshot;
    result.boundaryE = this.boundaryE.map(a => a.slice());
    result.conduction = this.conduction.map(a => a.slice());
    result.drude = this._drude ? { loss: this._drude.loss } as DrudeState : null;
    if (result.drude && this._drude) for (const name of drudeNames) result.drude[name] = this._drude[name].slice();
    for (const name of [...fieldNames, ...materialNames]) result[name] = this[name].slice();
    return result;
  }

  restore(state: YeeSnapshot) {
    for (const name of [...fieldNames, ...materialNames]) { if (state[name].length !== this.rho.length) throw new Error('Snapshot grid mismatch'); this[name].set(state[name]); }
    if (state.cpml.length !== (this.pml?.memories.length ?? 0)) throw new Error('Snapshot boundary mismatch');
    this.pml?.memories.forEach((a, i) => a.set(state.cpml[i]));
    if (state.cpmlReference.length !== (this.pml?.reference.length ?? 0)) throw new Error('Snapshot boundary reference mismatch');
    this.pml?.reference.forEach((a, i) => a.set(state.cpmlReference[i]));
    this.boundaryE.forEach((a, i) => { if (a.length !== state.boundaryE[i]?.length) throw new Error('Snapshot boundary edge mismatch'); a.set(state.boundaryE[i]); });
    this.conduction.forEach((a, i) => { if (a.length !== state.conduction[i]?.length) throw new Error('Snapshot conduction current mismatch'); a.set(state.conduction[i]); });
    this.configureDrude(state.drude ? { omegaP: { x: state.drude.omegaPX, y: state.drude.omegaPY, z: state.drude.omegaPZ }, gamma: { x: state.drude.gammaX, y: state.drude.gammaY, z: state.drude.gammaZ } } : null);
    if (this._drude && state.drude) { this._drude.Jx.set(state.drude.Jx); this._drude.Jy.set(state.drude.Jy); this._drude.Jz.set(state.drude.Jz); this._drude.loss = state.drude.loss; }
    this.time = state.time; this.steps = state.steps; this.ohmicLoss = state.ohmicLoss; this.sourceWork = state.sourceWork;
  }

  reset() {
    for (const name of fieldNames) this[name].fill(0);
    this.pml?.reset(); this.conduction.forEach(a => a.fill(0));
    this.boundaryE.forEach(a => a.fill(0));
    if (this._drude) { this._drude.Jx.fill(0); this._drude.Jy.fill(0); this._drude.Jz.fill(0); this._drude.loss = 0; }
    this.time = 0; this.steps = 0; this.ohmicLoss = 0; this.sourceWork = 0;
  }
}
