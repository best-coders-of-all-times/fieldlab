import { describe, expect, it } from 'vitest';
import { gradientToE, makeGrid, nodePosition, idx } from '../src/engine/grid';
import { makeScene, makeCharge, makeConductor } from '../src/scene/defaults';
import { rasterizeScene } from '../src/scene/rasterize';
import { solvePoisson } from '../src/engine/electrostatics/poisson';
import { StaticsEngine } from '../src/engine/staticsEngine';

describe('Electrostatic boundary and charge constraints', () => {
  it('uses one-sided derivatives at domain faces', () => {
    const grid = makeGrid(5, 5, 5, [0, 0, 0], [1, 2, 3]);
    const phi = new Float32Array(125);
    for (let k = 0; k < 5; k++) for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) {
      const [x, y, z] = nodePosition(grid, i, j, k);
      phi[idx(grid, i, j, k)] = -2 * x - 3 * y + 4 * z;
    }
    const field = gradientToE(phi, grid);
    for (let n = 0; n < 125; n++) {
      expect(field[n * 3]).toBeCloseTo(2);
      expect(field[n * 3 + 1]).toBeCloseTo(3);
      expect(field[n * 3 + 2]).toBeCloseTo(-4);
    }
  });

  it('enforces a floating conductor net charge in the presence of free charge', () => {
    const conductor = makeConductor([0, 0, 0], 'sphere', [0.25, 0.25, 0.25]);
    conductor.floating = true;
    conductor.netCharge = 0;
    const scene = makeScene({ name: 'floating', objects: [conductor, makeCharge([0.3, 0, 0], 1e-9)] });
    const grid = makeGrid(25, 25, 25, [0, 0, 0], [1, 1, 1]);
    const raster = rasterizeScene(scene, grid, { charges: true, centering: 'nodes', materials: true });
    const result = solvePoisson(scene, grid, raster, { boundary: 'grounded', externalField: [0, 0, 0], maxCycles: 35, tolerance: 1e-6 });
    expect(Math.abs(result.charges[0].charge)).toBeLessThan(1e-11);
    expect(result.charges[0].potential).toBeGreaterThan(1);
  });

  it('actually grounds the box even without material objects', () => {
    const scene = makeScene({ name: 'grounded', objects: [makeCharge()] });
    scene.simulation.staticBoundary = 'grounded';
    scene.simulation.resolution = 48;
    const engine = new StaticsEngine(scene);
    expect(engine.samplePhi([0.5, 0.2, 0.1])).toBeCloseTo(0, 6);
  });
});
