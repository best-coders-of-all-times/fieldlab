import { describe, expect, it } from 'vitest';
import { FdtdSolver } from '../src/engine/fdtd/fdtd3d';
import { defaultDomain, defaultSimulation, makePlaneWave, makeScene } from '../src/scene/defaults';

describe('FDTD plane wave speed', () => {
  it('propagates at approximately c', { timeout: 30_000 }, () => {
    const scene = makeScene({ name: 'wave', mode: 'waves' });
    scene.domain = defaultDomain();
    scene.simulation = { ...defaultSimulation(), resolution: 48, boundary: { x: 'pml', y: 'periodic', z: 'periodic' }, pmlCells: 8 };
    const src = makePlaneWave();
    src.frequency = 3e8;
    src.amplitude = 1;
    src.waveform = 'cw';
    scene.objects = [src];
    const solver = new FdtdSolver(scene);
    const p1: [number, number, number] = [-0.2, 0, 0];
    const p2: [number, number, number] = [0.2, 0, 0];
    for (let i = 0; i < 1400; i++) solver.step(1);
    const w = 2 * Math.PI * src.frequency;
    let c1r = 0, c1i = 0, c2r = 0, c2i = 0;
    const N = 600;
    for (let i = 0; i < N; i++) {
      solver.step(1);
      const t = solver.time;
      const a = solver.sample(p1).E[2];
      const b = solver.sample(p2).E[2];
      c1r += a * Math.cos(w * t); c1i -= a * Math.sin(w * t);
      c2r += b * Math.cos(w * t); c2i -= b * Math.sin(w * t);
    }
    const ph1 = Math.atan2(c1i, c1r);
    const ph2 = Math.atan2(c2i, c2r);
    let dphi = ph2 - ph1;
    while (dphi > Math.PI) dphi -= 2 * Math.PI;
    while (dphi < -Math.PI) dphi += 2 * Math.PI;
    const k = Math.abs(dphi) / 0.4;
    const v = w / k;
    expect(v).toBeGreaterThan(2.4e8);
    expect(v).toBeLessThan(3.6e8);
  });
});
