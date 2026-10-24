import { expect, it } from 'vitest';
import { MaxwellSampler } from '../../src/engine/maxwell/sampling';
import { YeeSolver } from '../../src/engine/maxwell/yee';
import { makeScene } from '../../src/scene/defaults';

it('samples native electric/magnetic projections with the same offsets and synchronized time as probes', () => {
  const s = new YeeSolver({ nx: 9, ny: 9, nz: 9, dx: 0.1, dy: 0.1, dz: 0.1, boundary: { x: 'periodic', y: 'periodic', z: 'periodic' } });
  for (let n = 0; n < s.rho.length; n++) {
    s.Ex[n] = Math.sin(n); s.Ey[n] = Math.cos(n); s.Ez[n] = Math.sin(0.2 * n);
    s.Bx[n] = 1e-8 * Math.cos(0.3 * n); s.By[n] = 1e-8 * Math.sin(0.6 * n); s.Bz[n] = 1e-8 * Math.cos(n);
  }
  const sampler = new MaxwellSampler(s, makeScene({ name: 'projection' }), [0, 0, 0]);
  for (const p of [[0.23, 0.37, 0.44], [0.41, 0.52, 0.61]] as [number, number, number][]) {
    const sample = sampler.sampleEB(p);
    for (const field of ['E', 'B'] as const) for (const v of [[0, 0, 2], [0.7, -0.4, 0.2]] as [number, number, number][]) {
      const direct = sample[field].reduce((sum, value, a) => sum + value * v[a], 0);
      expect(sampler.sampleProjection(p, field, v)).toBe(direct);
    }
  }
});
