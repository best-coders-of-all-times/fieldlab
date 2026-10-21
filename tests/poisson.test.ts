import { describe, expect, it } from 'vitest';
import { makeGrid, idx, sampleVector } from '../src/engine/grid';
import { solvePoisson } from '../src/engine/electrostatics/poisson';
import type { RasterResult } from '../src/scene/rasterize';
import { defaultDomain, defaultSimulation, makeScene, makeConductor } from '../src/scene/defaults';
import type { Scene } from '../src/scene/types';

function plateScene(separation = 0.4, half = 0.2): Scene {
  const scene = makeScene({ name: 'plates', mode: 'fields' });
  const a = makeConductor([-separation / 2, 0, 0], 'box', [0.02, 2 * half, 2 * half]);
  a.potential = 0.5;
  const b = makeConductor([separation / 2, 0, 0], 'box', [0.02, 2 * half, 2 * half]);
  b.potential = -0.5;
  scene.objects = [a, b];
  return scene;
}

describe('3D Poisson / multigrid', () => {
  it('produces an approximately uniform field between parallel plates', () => {
    const scene = plateScene();
    const grid = makeGrid(33, 33, 33, [0, 0, 0], [1.2, 1.2, 1.2]);
    const n = grid.nx * grid.ny * grid.nz;
    const raster: RasterResult = {
      grid,
      epsilon: new Float32Array(n).fill(1),
      mu: new Float32Array(n).fill(1),
      sigma: new Float32Array(n),
      conductor: new Uint8Array(n),
      conductorObjects: scene.objects as never,
      rho: new Float32Array(n),
    };
    // Rasterize the two plates directly.
    for (let k = 0; k < grid.nz; k++) {
      for (let j = 0; j < grid.ny; j++) {
        for (let i = 0; i < grid.nx; i++) {
          const x = grid.min[0] + i * grid.dx;
          const y = grid.min[1] + j * grid.dy;
          const z = grid.min[2] + k * grid.dz;
          if (Math.abs(x + 0.2) <= 0.04 && Math.abs(y) <= 0.2 && Math.abs(z) <= 0.2) {
            raster.conductor[idx(grid, i, j, k)] = 1;
          }
          if (Math.abs(x - 0.2) <= 0.04 && Math.abs(y) <= 0.2 && Math.abs(z) <= 0.2) {
            raster.conductor[idx(grid, i, j, k)] = 2;
          }
        }
      }
    }
    const result = solvePoisson(scene, grid, raster, {
      externalField: [0, 0, 0],
      boundary: 'grounded',
      tolerance: 2e-5,
      maxCycles: 30,
    });
    const E = sampleVector(result.E, grid, [0, 0, 0]);
    expect(Math.abs(E[0])).toBeGreaterThan(1.5);
    expect(Math.abs(E[0])).toBeLessThan(3.5);
    expect(result.charges[0].charge).toBeGreaterThan(0);
    expect(result.charges[1].charge).toBeLessThan(0);
    expect(result.stats.residual).toBeLessThan(0.005);
    expect(result.differentialCapacitance).toBeGreaterThan(0);
  });
});
