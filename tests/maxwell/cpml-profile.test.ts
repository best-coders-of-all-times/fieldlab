import { expect, it } from 'vitest';
import { Cpml } from '../../src/engine/maxwell/cpml';
import { LIGHT_SPEED, YeeSolver } from '../../src/engine/maxwell/yee';

function memoryDecayRate(resolution: number, depth: number) {
  const h = 1 / resolution, cells = resolution / 4;
  const dt = 0.5 * h / LIGHT_SPEED;
  const layer = new Cpml([resolution, 1, 1], [h, 1, 1], ['pml', 'periodic', 'periodic'], cells, dt, LIGHT_SPEED);
  const coordinate = cells * (1 - depth);
  // An impulse followed by zero input measures the memory's exponential
  // decay directly, without inspecting or reproducing its coefficients.
  layer.derivative(0, 0, coordinate, coordinate, false, 1);
  const first = layer.derivative(0, 0, coordinate, coordinate, false, 0);
  const second = layer.derivative(0, 0, coordinate, coordinate, false, 0);
  expect(first).toBeLessThan(0);
  expect(second / first).toBeGreaterThan(0);
  expect(second / first).toBeLessThan(1);
  return -Math.log(second / first) / dt;
}

it.each([0.25, 0.5, 0.75])('preserves the physical CPML memory profile at relative depth %s under grid refinement', depth => {
  // Both grids have the same 1 m domain and 0.25 m layer. At the same
  // physical depth, refining dt must sample the same continuous memory law.
  const coarse = memoryDecayRate(64, depth), fine = memoryDecayRate(128, depth);
  expect(Math.abs(fine / coarse - 1)).toBeLessThan(1e-12);
});

it('absorbs the delayed broadband normal-pulse tail over the extended physical window', () => {
  const h = 0.0025, pmlCells = 32;
  const create = (length: number) => {
    const s = new YeeSolver({ nx: Math.round(length / h) + 2 * pmlCells, ny: 1, nz: 1, dx: h, dy: h, dz: h,
      boundary: { x: 'pml', y: 'periodic', z: 'periodic' }, pmlCells });
    const pulse = (x: number) => Math.exp(-((x / 0.035) ** 2)) * Math.cos(2 * Math.PI * x / 0.14);
    for (let i = 0; i < s.nx; i++) {
      const x = (i - pmlCells) * h - 0.3;
      s.Ey[i] = pulse(x);
      s.Bz[i] = pulse(x + h / 2 + LIGHT_SPEED * s.dt / 2) / LIGHT_SPEED;
    }
    return s;
  };
  const short = create(1), reference = create(8), probe = pmlCells + Math.round(0.45 / h);
  let incident = 0, reflected = 0;
  for (let step = 0; step < Math.ceil(14 / (LIGHT_SPEED * short.dt)); step++) {
    short.step(); reference.step();
    const ct = LIGHT_SPEED * short.time;
    if (ct < 0.5) incident = Math.max(incident, Math.abs(reference.Ey[probe]));
    if (ct > 0.7) reflected = Math.max(reflected, Math.abs(short.Ey[probe] - reference.Ey[probe]));
  }
  // The long reference's backing-wall return is outside this window. The
  // maintained three-domain audit independently checks its contamination.
  expect(incident).toBeGreaterThan(0.99);
  expect(reflected / incident).toBeLessThan(1e-3);
}, 30000);
