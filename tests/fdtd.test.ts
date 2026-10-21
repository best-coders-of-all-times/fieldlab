import { describe, expect, it } from 'vitest';
import { FdtdSolver } from '../src/engine/fdtd/fdtd3d';
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
