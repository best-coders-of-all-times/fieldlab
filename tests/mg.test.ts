import { describe, expect, it } from 'vitest';
import { makeGrid, idx } from '../src/engine/grid';
import { solveMultigrid } from '../src/engine/electrostatics/multigrid';

describe('multigrid sanity', () => {
  it('solves a Laplace problem with linear boundary data', () => {
    const g = makeGrid(33, 33, 33, [0, 0, 0], [1, 1, 1]);
    const n = g.nx * g.ny * g.nz;
    const eps = new Float32Array(n).fill(1);
    const fixed = new Uint8Array(n);
    const fixedVal = new Float32Array(n);
    const rhs = new Float32Array(n);
    const boundaryAt = (p: [number, number, number]) => (p[0] < -0.49 ? 1 : 0);
    for (let k = 0; k < g.nz; k++) {
      for (let j = 0; j < g.ny; j++) {
        for (let i = 0; i < g.nx; i++) {
          if (i === 0 || j === 0 || k === 0 || i === g.nx - 1 || j === g.ny - 1 || k === g.nz - 1) {
            fixed[idx(g, i, j, k)] = 1;
            fixedVal[idx(g, i, j, k)] = boundaryAt([
              g.min[0] + i * g.dx,
              g.min[1] + j * g.dy,
              g.min[2] + k * g.dz,
            ]);
          }
        }
      }
    }
    const res = solveMultigrid(g, eps, fixed, fixedVal, rhs, boundaryAt, undefined, {
      tolerance: 1e-7,
      maxCycles: 60,
    });
    console.log('mg residual', res.residual, 'cycles', res.cycles);
    // midpoint should be about 0.5
    const mid = idx(g, 16, 16, 16);
    console.log('mid', res.phi[mid], 'x=8', res.phi[idx(g, 8, 16, 16)]);
    // Five grounded side walls pull the centre below the 1D value 0.5.
    expect(res.residual).toBeLessThan(0.01);
    expect(Math.abs(res.phi[mid] - 1 / 6)).toBeLessThan(0.02);
  });
});
