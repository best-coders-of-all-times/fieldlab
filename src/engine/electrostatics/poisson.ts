import { EPS0 } from '../constants';
import type { GridSpec } from '../grid';
import { gradientToE, idx, nodePosition } from '../grid';
import type { Vec3 } from '../math/vec3';
import type { RasterResult } from '../../scene/rasterize';
import type { ConductorObject, Scene } from '../../scene/types';
import { solveDense, solveMultigrid } from './multigrid';
import type { MultigridResult } from './multigrid';
import { sampleAnalyticPhi, collectAnalyticSources } from './analytic';

export interface PoissonOptions {
  externalField: Vec3;
  boundary: 'grounded' | 'open';
  tolerance?: number;
  maxCycles?: number;
  computeCapacitance?: boolean;
}

export interface ConductorResult {
  id: string;
  name: string;
  potential: number;
  charge: number;
  floating: boolean;
}

export interface PoissonResult {
  phi: Float32Array;
  E: Float32Array;
  charges: ConductorResult[];
  capacitanceMatrix: number[][];
  differentialCapacitance?: number;
  electricEnergy: number;
  stats: {
    cycles: number;
    residual: number;
    solveMs: number;
  };
}

function boundaryValue(grid: GridSpec, external: Vec3, boundary: 'grounded' | 'open') {
  return (world: Vec3): number => {
    if (boundary === 'grounded') return 0;
    return -(external[0] * world[0] + external[1] * world[1] + external[2] * world[2]);
  };
}

function buildFixed(
  grid: GridSpec,
  raster: RasterResult,
  potentials: number[],
  boundaryAt: (world: Vec3) => number,
): { fixed: Uint8Array; fixedVal: Float32Array } {
  const n = grid.nx * grid.ny * grid.nz;
  const fixed = new Uint8Array(n);
  const fixedVal = new Float32Array(n);
  for (let k = 0; k < grid.nz; k++) {
    for (let j = 0; j < grid.ny; j++) {
      for (let i = 0; i < grid.nx; i++) {
        const c = idx(grid, i, j, k);
        if (i === 0 || j === 0 || k === 0 || i === grid.nx - 1 || j === grid.ny - 1 || k === grid.nz - 1) {
          fixed[c] = 1;
          fixedVal[c] = boundaryAt(nodePosition(grid, i, j, k));
        }
      }
    }
  }
  for (let c = 0; c < n; c++) {
    const id = raster.conductor[c];
    if (id > 0) {
      fixed[c] = 1;
      fixedVal[c] = potentials[id - 1] ?? 0;
    }
  }
  return { fixed, fixedVal };
}

function conductorCharges(
  grid: GridSpec,
  raster: RasterResult,
  phi: Float32Array,
): number[] {
  const nCond = raster.conductorObjects.length;
  const charges = new Array(nCond).fill(0);
  const eps = raster.epsilon;
  for (let k = 0; k < grid.nz; k++) {
    for (let j = 0; j < grid.ny; j++) {
      for (let i = 0; i < grid.nx; i++) {
        const c = idx(grid, i, j, k);
        const id = raster.conductor[c];
        if (!id) continue;
        const ei = id - 1;
        // x faces
        if (i > 0 && raster.conductor[c - 1] !== id) {
          const q = EPS0 * ((eps[c] + eps[c - 1]) / 2) * ((phi[c] - phi[c - 1]) / grid.dx) * grid.dy * grid.dz;
          charges[ei] += q;
        }
        if (i < grid.nx - 1 && raster.conductor[c + 1] !== id) {
          const q = EPS0 * ((eps[c] + eps[c + 1]) / 2) * ((phi[c] - phi[c + 1]) / grid.dx) * grid.dy * grid.dz;
          charges[ei] += q;
        }
        // y faces
        if (j > 0 && raster.conductor[c - grid.nx] !== id) {
          const q = EPS0 * ((eps[c] + eps[c - grid.nx]) / 2) * ((phi[c] - phi[c - grid.nx]) / grid.dy) * grid.dx * grid.dz;
          charges[ei] += q;
        }
        if (j < grid.ny - 1 && raster.conductor[c + grid.nx] !== id) {
          const q = EPS0 * ((eps[c] + eps[c + grid.nx]) / 2) * ((phi[c] - phi[c + grid.nx]) / grid.dy) * grid.dx * grid.dz;
          charges[ei] += q;
        }
        // z faces
        if (k > 0 && raster.conductor[c - grid.nx * grid.ny] !== id) {
          const q = EPS0 * ((eps[c] + eps[c - grid.nx * grid.ny]) / 2) * ((phi[c] - phi[c - grid.nx * grid.ny]) / grid.dz) * grid.dx * grid.dy;
          charges[ei] += q;
        }
        if (k < grid.nz - 1 && raster.conductor[c + grid.nx * grid.ny] !== id) {
          const q = EPS0 * ((eps[c] + eps[c + grid.nx * grid.ny]) / 2) * ((phi[c] - phi[c + grid.nx * grid.ny]) / grid.dz) * grid.dx * grid.dy;
          charges[ei] += q;
        }
      }
    }
  }
  return charges;
}

function electricEnergy(grid: GridSpec, E: Float32Array, epsilon: Float32Array): number {
  let u = 0;
  const dv = grid.dx * grid.dy * grid.dz;
  for (let c = 0; c < epsilon.length; c++) {
    const o = c * 3;
    u += 0.5 * EPS0 * epsilon[c] * (E[o] * E[o] + E[o + 1] * E[o + 1] + E[o + 2] * E[o + 2]);
  }
  return u * dv;
}

function computeDifferentialCapacitance(C: number[][]): number | undefined {
  const n = C.length;
  if (n !== 2) return undefined;
  // R = C^{-1}; C12 = 1 / (R11 - R12 - R21 + R22)
  const R: number[][] = [];
  for (let j = 0; j < 2; j++) {
    const e = [0, 0];
    e[j] = 1;
    R.push(solveDense(C, e));
  }
  const denom = R[0][0] - R[0][1] - R[1][0] + R[1][1];
  return Math.abs(denom) > 1e-30 ? 1 / denom : undefined;
}

export function solvePoisson(
  scene: Scene,
  grid: GridSpec,
  raster: RasterResult,
  options: PoissonOptions,
): PoissonResult {
  const t0 = performance.now();
  const n = grid.nx * grid.ny * grid.nz;
  const conductors = raster.conductorObjects;
  const nCond = conductors.length;
  const analytic = collectAnalyticSources(scene.objects, options.externalField);
  // Approximate an isolated domain by fixing its finite boundary to the bare
  // charge potential plus -E_external·r. Induced multipoles are truncated.
  const boundaryAt = options.boundary === 'grounded' ? () => 0
    : (world: Vec3) => sampleAnalyticPhi(analytic, world);

  const rhs = new Float32Array(n);
  for (let c = 0; c < n; c++) {
    if (raster.conductor[c]) rhs[c] = 0;
    else rhs[c] = raster.rho[c] / EPS0;
  }

  const initial = new Float32Array(n);
  for (let k = 0; k < grid.nz; k++) {
    for (let j = 0; j < grid.ny; j++) {
      for (let i = 0; i < grid.nx; i++) {
        const p = nodePosition(grid, i, j, k);
        initial[idx(grid, i, j, k)] = sampleAnalyticPhi(analytic, p);
      }
    }
  }

  // Geometry-only capacitance matrix, with conductors at unit potential and
  // the boundary grounded. This is used for floating conductors and readouts.
  let capacitanceMatrix: number[][] = [];
  let cycles = 0;
  let residual = 0;
  const tolerance = options.tolerance ?? 2e-5;
  const maxCycles = options.maxCycles ?? 25;

  if (nCond > 0 && (options.computeCapacitance !== false || conductors.some(c => c.floating))) {
    capacitanceMatrix = Array.from({ length: nCond }, () => new Array(nCond).fill(0));
    const zeroRhs = new Float32Array(n);
    const groundedBoundary = () => 0;
    const cInitial = new Float32Array(n);
    for (let i = 0; i < nCond; i++) {
      const potentials = new Array(nCond).fill(0);
      potentials[i] = 1;
      const { fixed, fixedVal } = buildFixed(grid, raster, potentials, groundedBoundary);
      const solution = solveMultigrid(grid, raster.epsilon, fixed, fixedVal, zeroRhs, groundedBoundary, cInitial, {
        tolerance: 5e-5,
        maxCycles: 20,
        preSmooth: 2,
        postSmooth: 2,
      });
      const q = conductorCharges(grid, raster, solution.phi);
      for (let j = 0; j < nCond; j++) capacitanceMatrix[j][i] = q[j];
      cycles += solution.cycles;
      residual = Math.max(residual, solution.residual);
    }
    // Enforce reciprocity; the discrete solve is close but not exactly symmetric.
    for (let i = 0; i < nCond; i++) {
      for (let j = i + 1; j < nCond; j++) {
        const avg = 0.5 * (capacitanceMatrix[i][j] + capacitanceMatrix[j][i]);
        capacitanceMatrix[i][j] = avg;
        capacitanceMatrix[j][i] = avg;
      }
    }
  }

  // Determine conductor potentials, solving the charge constraints for floating ones.
  const potentials = conductors.map((c) => (c.floating ? 0 : c.potential));
  const fixedIdx: number[] = [];
  const floatIdx: number[] = [];
  conductors.forEach((c, i) => (c.floating ? floatIdx : fixedIdx).push(i));

  if (floatIdx.length > 0 && capacitanceMatrix.length > 0) {
    // Free charge and the applied boundary field induce charge even with all
    // conductors at zero potential. Include that offset in Q = C V + Q_source.
    const backgroundFixed = buildFixed(grid, raster, new Array(nCond).fill(0), boundaryAt);
    const background = solveMultigrid(grid, raster.epsilon, backgroundFixed.fixed,
      backgroundFixed.fixedVal, rhs, boundaryAt, initial,
      { tolerance, maxCycles, preSmooth: 2, postSmooth: 2 });
    const sourceCharges = conductorCharges(grid, raster, background.phi);
    cycles += background.cycles;
    residual = Math.max(residual, background.residual);
    const nf = floatIdx.length;
    const A: number[][] = Array.from({ length: nf }, () => new Array(nf).fill(0));
    const b: number[] = new Array(nf).fill(0);
    for (let a = 0; a < nf; a++) {
      const ia = floatIdx[a];
      b[a] = conductors[ia].netCharge - sourceCharges[ia];
      for (let c = 0; c < nf; c++) {
        const ic = floatIdx[c];
        A[a][c] = capacitanceMatrix[ia][ic];
        if (a === c && Math.abs(A[a][c]) < 1e-18) A[a][c] = 1e-18;
      }
      for (const jf of fixedIdx) {
        b[a] -= capacitanceMatrix[ia][jf] * potentials[jf];
      }
    }
    const solved = solveDense(A, b);
    for (let a = 0; a < nf; a++) potentials[floatIdx[a]] = solved[a];
  }

  const { fixed, fixedVal } = buildFixed(grid, raster, potentials, boundaryAt);
  const solution: MultigridResult = solveMultigrid(
    grid, raster.epsilon, fixed, fixedVal, rhs, boundaryAt, initial,
    { tolerance, maxCycles, preSmooth: 2, postSmooth: 2 },
  );
  cycles += solution.cycles;
  residual = Math.max(residual, solution.residual);

  const E = gradientToE(solution.phi, grid);
  const charges = conductorCharges(grid, raster, solution.phi);
  const chargeResults: ConductorResult[] = conductors.map((c: ConductorObject, i: number) => ({
    id: c.id,
    name: c.name,
    potential: potentials[i],
    charge: charges[i],
    floating: c.floating,
  }));

  const differentialCapacitance = computeDifferentialCapacitance(capacitanceMatrix);

  return {
    phi: solution.phi,
    E,
    charges: chargeResults,
    capacitanceMatrix,
    differentialCapacitance,
    electricEnergy: electricEnergy(grid, E, raster.epsilon),
    stats: {
      cycles,
      residual,
      solveMs: performance.now() - t0,
    },
  };
}
