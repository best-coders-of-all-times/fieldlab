import { expect, it } from 'vitest';
import { MaxwellSceneSolver } from '../../src/engine/maxwell/sceneSolver';
import { makeScene, makeDielectric, makeLoop } from '../../src/scene/defaults';

function drudeScene() {
  const material = Object.assign(makeDielectric([0, 0, 0], 'box', [0.5, 0.5, 0.5], 1), {
    materialModel: 'drude' as const, drude: { omegaP: 1e9, gamma: 1e8 },
  });
  const scene = makeScene({ name: 'Drude initial response', objects: [material] });
  Object.assign(scene.simulation, { resolution: 16, pmlCells: 4, useApproximation: false });
  scene.simulation.externalField = [1, 0, 0];
  return { scene, material };
}

it('couples the selected stationary Drude material and exposes total update current', () => {
  const { scene } = drudeScene(), solver = new MaxwellSceneSolver(scene);
  solver.step();
  const sample = solver.sample([0, 0, 0]);
  expect(solver.core.drude).not.toBeNull();
  expect(sample.J[0]).toBeGreaterThan(1e-4);
  expect(solver.diagnostics().gaussRelative).toBeLessThan(1e-8);
  solver.reset(); expect(solver.sample([0, 0, 0]).J).toEqual([0, 0, 0]);
  solver.step(); expect(solver.sample([0, 0, 0])).toEqual(sample);
});

it('retains inactive Drude parameters without enabling dispersion', () => {
  const { scene, material } = drudeScene();
  Object.assign(material, { materialModel: 'linear', drude: { omegaP: 1e18, gamma: 0 } });
  const solver = new MaxwellSceneSolver(scene); solver.step();
  expect(solver.core.drude).toBeNull();
  expect(solver.sample([0, 0, 0]).J).toEqual([0, 0, 0]);
});

it('includes plasma frequency in the coupled material-current admission bound', () => {
  const { scene, material } = drudeScene(), loop = makeLoop([0, 0, 0], 0.2, 0);
  material.size = [0.9, 0.9, 0.9]; material.drude.omegaP = 7.6e9;
  Object.assign(loop, { electricalModel: 'conducting', conductivity: 0.01, wireRadius: 0.15 });
  scene.objects.push(loop);
  expect(() => new MaxwellSceneSolver(scene)).toThrow(/stiff|stability|timestep/i);
});
