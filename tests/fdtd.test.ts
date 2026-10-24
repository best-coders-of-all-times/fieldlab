import { describe, expect, it } from 'vitest';
import { FdtdSolver } from '../src/engine/fdtd/fdtd3d';
import { EPS0, MU0 } from '../src/engine/constants';
import { defaultDisplay, defaultDomain, defaultSimulation, makePointSource, makeScene } from '../src/scene/defaults';

function waveScene(resolution: 48 | 64 | 96 = 48, boundary: 'periodic' | 'pml' = 'periodic') {
  const scene = makeScene({ name: 'wave', mode: 'waves' });
  scene.domain = defaultDomain();
  scene.simulation = {
    ...defaultSimulation(),
    resolution,
    boundary: { x: boundary, y: boundary, z: boundary },
    pmlCells: 8,
    stepsPerFrame: 2,
  };
  const src = makePointSource([0, 0, 0], 'Ez');
  src.frequency = 3e8;
  src.amplitude = 1;
  src.waveform = 'cw';
  scene.objects = [src];
  scene.display = defaultDisplay();
  return scene;
}

describe('3D FDTD', () => {
  it('reports material B, energy density and Poynting using the constitutive relations', () => {
    const solver = new FdtdSolver(waveScene());
    solver.muR.fill(4);
    solver.epsR.fill(3);
    solver.Ex.fill(2);
    solver.Hy.fill(3);
    const sample = solver.sample([0, 0, 0]);
    expect(sample.B[1]).toBeCloseTo(12 * MU0, 12);
    expect(solver.sampleLattice(3, 'B').vectors[1]).toBeCloseTo(12 * MU0, 12);
    expect(solver.sampleSlice('z', 0, 'energyE', 16).max).toBeCloseTo(6 * EPS0, 16);
    expect(solver.sampleSlice('z', 0, 'energyB', 16).max).toBeCloseTo(18 * MU0, 11);
    expect(solver.sampleSlice('z', 0, 'poynting', 16).max).toBeCloseTo(6, 5);
  });
  it('launches a stable wave from a point source', () => {
    const solver = new FdtdSolver(waveScene(48, 'periodic'));
    for (let i = 0; i < 120; i++) solver.step(1);
    const s = solver.sample([0.25, 0, 0]);
    expect(Number.isFinite(s.Emag)).toBe(true);
    expect(s.Emag).toBeGreaterThan(0);
    const energy = solver.energy();
    expect(Number.isFinite(energy.electric + energy.magnetic)).toBe(true);
    expect(energy.electric + energy.magnetic).toBeGreaterThan(0);
  });

  it('remains finite with an absorbing layer', () => {
    const solver = new FdtdSolver(waveScene(48, 'pml'));
    for (let i = 0; i < 160; i++) solver.step(1);
    const s = solver.sample([0, 0, 0]);
    expect(Number.isFinite(s.Emag)).toBe(true);
    const energy = solver.energy();
    expect(Number.isFinite(energy.electric + energy.magnetic)).toBe(true);
  });
});
