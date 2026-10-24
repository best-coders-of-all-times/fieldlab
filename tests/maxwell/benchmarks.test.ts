import { describe, expect, it } from 'vitest';
import { YeeSolver, LIGHT_SPEED as C, EPSILON_0, MU_0 } from '../../src/engine/maxwell/yee';

const periodic = { x: 'periodic', y: 'periodic', z: 'periodic' } as const;
const gaussian = (x: number, width: number) => Math.exp(-((x / width) ** 2));
const peak = (a: Float64Array, lo: number, hi: number, sign = 1) => {
  let best = lo;
  for (let i = lo + 1; i < hi; i++) if (sign * a[i] > sign * a[best]) best = i;
  const left = a[best - 1], center = a[best], right = a[best + 1];
  return center - (right - left) ** 2 / (8 * (left + right - 2 * center));
};

function fresnel(n: number) {
  const h = 1.6 / n, s = new YeeSolver({ nx: n, ny: 1, nz: 1, dx: h, dy: h, dz: h, boundary: periodic });
  const medium = n / 2;
  for (let x = medium; x < n; x++) s.epsY[x] = 4;
  for (let x = 0; x < n; x++) {
    s.Ey[x] = gaussian(x * h - 0.35, 0.045);
    s.Bz[x] = gaussian((x + 0.5) * h - 0.35 + C * s.dt / 2, 0.045) / C;
  }
  s.step(Math.round(0.75 / (C * s.dt)));
  const reflection = peak(s.Ey, Math.floor(0.4 / h), Math.floor(0.65 / h), -1);
  const transmission = peak(s.Ey, Math.floor(0.86 / h), Math.floor(1.05 / h));
  return { n, reflection, transmission, reflectionError: Math.abs(reflection + 1 / 3) * 3, transmissionError: Math.abs(transmission - 2 / 3) * 1.5 };
}

function cavity(n: number) {
  const h = 1 / n, mode = 3, s = new YeeSolver({ nx: n, ny: 1, nz: 1, dx: h, dy: h, dz: h, boundary: { ...periodic, x: 'pec' } });
  const omega = C * mode * Math.PI, probe = Math.round(n / 6), crossings: number[] = [];
  for (let x = 0; x < n; x++) {
    s.Ey[x] = Math.sin(mode * Math.PI * x * h);
    s.Bz[x] = Math.cos(mode * Math.PI * (x + 0.5) * h) * Math.sin(omega * s.dt / 2) / C;
  }
  let previous = s.Ey[probe];
  for (let step = 0; step < Math.ceil(10 * 2 * Math.PI / (omega * s.dt)); step++) {
    s.step(); const value = s.Ey[probe];
    if (previous < 0 && value >= 0) crossings.push(s.time - s.dt * value / (value - previous));
    previous = value;
  }
  const frequency = (crossings.length - 1) / (crossings.at(-1)! - crossings[0]), reference = mode * C / 2;
  return { n, frequency, reference, error: Math.abs(frequency / reference - 1) };
}

function skin(h: number) {
  const frequency = 1e9, omega = 2 * Math.PI * frequency, sigma = 0.1;
  const pmlCells = Math.round(0.08 / h), n = Math.round(1.2 / h) + 2 * pmlCells;
  const s = new YeeSolver({ nx: n, ny: 1, nz: 1, dx: h, dy: h, dz: h, boundary: { ...periodic, x: 'pml' }, pmlCells });
  for (let x = 0; x < n; x++) if ((x - pmlCells) * h >= 0.4) s.sigmaY[x] = sigma;
  const source = pmlCells + Math.round(0.15 / h), probes = [0.52, 0.64].map(x => pmlCells + Math.round(x / h));
  const real = [0, 0], imaginary = [0, 0];
  for (let step = 0; step < Math.ceil(36 / (frequency * s.dt)); step++) {
    const t = s.time + s.dt / 2;
    s.Jy[source] = -Math.sin(omega * t) * Math.min(1, frequency * t / 6) / (Math.sqrt(MU_0 / EPSILON_0) * h);
    s.step();
    if (frequency * s.time < 26) continue;
    for (let i = 0; i < 2; i++) { real[i] += s.Ey[probes[i]] * Math.cos(omega * s.time); imaginary[i] += s.Ey[probes[i]] * Math.sin(omega * s.time); }
  }
  const alpha = Math.log(Math.hypot(real[0], imaginary[0]) / Math.hypot(real[1], imaginary[1])) / 0.12;
  const ratio = sigma / (omega * EPSILON_0);
  const reference = omega / C * Math.sqrt((Math.sqrt(1 + ratio * ratio) - 1) / 2);
  return { h, alpha, reference, error: Math.abs(alpha / reference - 1), ohmicLoss: s.diagnostics().ohmicLoss };
}

/** Paired-domain subtraction isolates reflection from a finite CPML. The long
 * domain places its significant reflected pulse beyond the sample window.
 */
function reflection(h: number, pmlCells: number, oblique = false) {
  const length = oblique ? 1.6 : 1, longLength = oblique ? 2.6 : 1.8;
  const ny = oblique ? Math.round(0.4 / h) : 1, center = oblique ? 0.5 : 0.3, probeX = oblique ? 0.7 : 0.45;
  const create = (physical: number) => new YeeSolver({ nx: Math.round(physical / h) + 2 * pmlCells, ny, nz: 1, dx: h, dy: h, dz: h,
    boundary: { ...periodic, x: 'pml' }, pmlCells });
  const short = create(length), reference = create(longLength), probe = pmlCells + Math.round(probeX / h);
  const ky = oblique ? 2 * Math.PI / 0.4 : 0, kx = oblique ? Math.sqrt(3) * ky : 2 * Math.PI / 0.14;
  const width = oblique ? 0.25 : 0.035;
  for (const s of [short, reference]) {
    if (!oblique) {
      for (let x = 0; x < s.nx; x++) {
        const coordinate = (x - pmlCells) * h - center, face = coordinate + h / 2 + C * s.dt / 2;
        s.Ey[x] = gaussian(coordinate, width) * Math.cos(kx * coordinate);
        s.Bz[x] = gaussian(face, width) * Math.cos(kx * face) / C;
      }
    } else {
      // A superposition of exact vacuum Yee eigenmodes: finite x packet,
      // periodic single transverse Fourier mode, native component staggering.
      const modes = Array.from({ length: 121 }, (_, j) => {
        const k = kx + (j - 60) * Math.PI / 5, weight = Math.exp(-(((k - kx) * width / 2) ** 2));
        const qx = 2 * Math.sin(k * h / 2) / h, qy = 2 * Math.sin(ky * h / 2) / h, q = Math.hypot(qx, qy);
        const omega = 2 / s.dt * Math.asin(C * s.dt * q / 2);
        return { k, weight, bx: qy / (C * q), by: -qx / (C * q), omega };
      });
      const norm = modes.reduce((sum, m) => sum + m.weight, 0);
      for (let y = 0; y < ny; y++) for (let x = 0; x < s.nx; x++) {
        const i = s.index(x, y, 0), coordinate = (x - pmlCells) * h - center;
        for (const m of modes) {
          const phase = m.k * coordinate + ky * y * h, w = m.weight / norm;
          s.Ez[i] += w * Math.cos(phase);
          s.Bx[i] += w * m.bx * Math.cos(phase + ky * h / 2 + m.omega * s.dt / 2);
          s.By[i] += w * m.by * Math.cos(phase + m.k * h / 2 + m.omega * s.dt / 2);
        }
      }
    }
  }
  const phaseY = Array.from({ length: ny }, (_, y) => ky * y * h);
  let incident = 0, reflected = 0;
  for (let step = 0; step < Math.ceil((oblique ? 3.3 : 2) / (C * short.dt)); step++) {
    short.step(); reference.step();
    let re = 0, im = 0, incRe = 0, incIm = 0;
    for (let y = 0; y < ny; y++) {
      const i = short.index(probe, y, 0), ri = reference.index(probe, y, 0), cosine = Math.cos(phaseY[y]), sine = Math.sin(phaseY[y]);
      const a = oblique ? short.Ez[i] : short.Ey[i], b = oblique ? reference.Ez[ri] : reference.Ey[ri];
      re += (a - b) * cosine; im += (a - b) * sine; incRe += b * cosine; incIm += b * sine;
    }
    const factor = (oblique ? 2 : 1) / ny, ct = C * short.time;
    if (ct < (oblique ? 0.8 : 0.5)) incident = Math.max(incident, factor * Math.hypot(incRe, incIm));
    if (ct > (oblique ? 1.3 : 0.7)) reflected = Math.max(reflected, factor * Math.hypot(re, im));
  }
  return { h, pmlCells, oblique, amplitude: reflected / incident };
}

describe('quantitative Maxwell CPU benchmarks', () => {
  it('matches fine-grid dielectric Fresnel amplitudes within one percent with refinement convergence', () => {
    const results = [320, 640].map(fresnel); console.log('Fresnel', JSON.stringify(results));
    // The deliberately coarser run misses the 1% reflected-amplitude target;
    // retain that measured result and require refinement to resolve it.
    expect(results[1].reflectionError).toBeLessThan(0.01); expect(results[1].transmissionError).toBeLessThan(0.01);
    expect(results[1].reflectionError).toBeLessThan(results[0].reflectionError / 3);
    expect(results[1].transmissionError).toBeLessThan(results[0].transmissionError);
  });

  it('resolves the PEC cavity eigenfrequency and converges under refinement', () => {
    const results = [24, 48].map(cavity); console.log('PEC cavity', JSON.stringify(results));
    expect(results[0].error).toBeLessThan(0.01); expect(results[1].error).toBeLessThan(results[0].error / 3);
  });

  it('matches finite-conductivity attenuation and records positive Ohmic loss', () => {
    const results = [0.005, 0.0025].map(skin); console.log('Conductor attenuation', JSON.stringify(results));
    for (const result of results) { expect(result.error).toBeLessThan(0.01); expect(result.ohmicLoss).toBeGreaterThan(0); }
    expect(results[1].error).toBeLessThan(results[0].error);
  }, 30000);

  it('balances uniform Ohmic dissipation against lost electric energy', () => {
    const s = new YeeSolver({ nx: 16, ny: 1, nz: 1, dx: 0.01, dy: 0.01, dz: 0.01, boundary: periodic });
    s.Ex.fill(2); s.sigmaX.fill(EPSILON_0 / (40 * s.dt));
    const initial = s.diagnostics().totalEnergy; s.step(80); const final = s.diagnostics();
    const balanceError = Math.abs((final.totalEnergy + final.ohmicLoss) / initial - 1);
    const decayError = Math.abs(s.Ex[0] / (2 * Math.exp(-2)) - 1);
    console.log('Uniform Ohmic balance', JSON.stringify({ balanceError, decayError }));
    expect(balanceError).toBeLessThan(1e-12); expect(decayError).toBeLessThan(0.001); expect(final.sourceWork).toBe(0);
  });

  it('reduces normal-pulse CPML reflection with thickness and grid refinement', () => {
    const results = [reflection(0.005, 8), reflection(0.005, 16), reflection(0.0025, 32)]; console.log('Normal CPML', JSON.stringify(results));
    expect(results[1].amplitude).toBeLessThan(results[0].amplitude); expect(results[2].amplitude).toBeLessThan(results[1].amplitude);
    expect(results[2].amplitude).toBeLessThan(1e-3);
  }, 30000);

  it('absorbs a periodic-transverse oblique Yee packet with thickness convergence', () => {
    const results = [reflection(0.01, 8, true), reflection(0.01, 16, true)]; console.log('Oblique CPML', JSON.stringify(results));
    expect(results[1].amplitude).toBeLessThan(results[0].amplitude); expect(results[1].amplitude).toBeLessThan(1e-3);
  }, 60000);
});
