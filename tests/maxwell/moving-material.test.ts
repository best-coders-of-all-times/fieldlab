import { describe, expect, it } from 'vitest';
import { movingOhmCurrent } from '../../src/engine/maxwell/materials';
import { YeeSolver, LIGHT_SPEED as C, EPSILON_0 as EPS0, MU_0 } from '../../src/engine/maxwell/yee';
import type { Vec3 } from '../../src/engine/math/vec3';

describe('relativistic moving-conductor current', () => {
  it('reduces to ordinary Ohm current in the material rest frame', () => {
    const current = movingOhmCurrent([2, -3, 4], [1, 2, 3], [0, 0, 0], 0.4);
    [0.8, -1.2, 1.6].forEach((expected, i) => expect(current[i]).toBeCloseTo(expected, 14));
  });

  it('transforms transverse motional and longitudinal electric response', () => {
    const beta = 0.6, gamma = 1.25, sigma = 0.3, v: Vec3 = [beta * C, 0, 0];
    const J = movingOhmCurrent([2, 3, 0], [0, 0, 2 / C], v, sigma);
    expect(J[0]).toBeCloseTo(sigma * 2 / gamma, 14);
    expect(J[1]).toBeCloseTo(sigma * gamma * (3 - 2 * beta), 14);
    expect(J[2]).toBe(0);
    expect(Math.hypot(...movingOhmCurrent([0, 2 * beta, 0], [0, 0, 2 / C], v, sigma))).toBeLessThan(1e-15);
  });

  it('rejects nonfinite fields, conductivity, and non-subluminal velocities', () => {
    expect(() => movingOhmCurrent([NaN, 0, 0], [0, 0, 0], [0, 0, 0], 1)).toThrow(/finite/i);
    expect(() => movingOhmCurrent([0, 0, 0], [Infinity, 0, 0], [0, 0, 0], 1)).toThrow(/finite/i);
    expect(() => movingOhmCurrent([0, 0, 0], [0, 0, 0], [C, 0, 0], 1)).toThrow(/light|speed/i);
    expect(() => movingOhmCurrent([0, 0, 0], [0, 0, 0], [0, 0, 0], -1)).toThrow(/conductivity/i);
  });
});

interface SignalFit { frequency: number; amplitude: number; normalizedRmsError: number; }

/** A data-scaled Schmitt crossing estimate seeds a spectral carrier search;
 * the estimator has no analytic/expected-frequency input. Maximize explained
 * energy of a sine/cosine/DC least-squares fit, then refine the spectral peak.
 * The unfitted residual records interface aliasing rather than filtering it away.
 */
function fitSignal(times: number[], signal: number[]): SignalFit {
  const crossings: number[] = [];
  const threshold = 0.2 * Math.max(...signal.map(Math.abs));
  let armed = signal[0] < -threshold;
  for (let i = 1; i < signal.length; i++) {
    if (signal[i] < -threshold) armed = true;
    if (armed && signal[i - 1] < 0 && signal[i] >= 0) {
      crossings.push(times[i - 1] + (times[i] - times[i - 1]) * -signal[i - 1] / (signal[i] - signal[i - 1])); armed = false;
    }
  }
  if (crossings.length < 5) throw new Error('Insufficient measured crossings for a frequency fit');
  const meanN = (crossings.length - 1) / 2, meanT = crossings.reduce((sum, v) => sum + v, 0) / crossings.length;
  let covariance = 0, variance = 0;
  crossings.forEach((t, n) => { covariance += (n - meanN) * (t - meanT); variance += (n - meanN) ** 2; });
  const crossingFrequency = variance / covariance, power = signal.reduce((sum, value) => sum + value * value, 0);
  const at = (frequency: number) => {
    const matrix = Array.from({ length: 3 }, () => [0, 0, 0, 0]);
    for (let i = 0; i < signal.length; i++) {
      const phase = 2 * Math.PI * frequency * (times[i] - times[0]), basis = [Math.cos(phase), Math.sin(phase), 1];
      for (let row = 0; row < 3; row++) { for (let column = 0; column < 3; column++) matrix[row][column] += basis[row] * basis[column]; matrix[row][3] += basis[row] * signal[i]; }
    }
    const rhs = matrix.map(row => row[3]);
    for (let row = 0; row < 3; row++) {
      const pivot = matrix[row][row];
      for (let column = row; column < 4; column++) matrix[row][column] /= pivot;
      for (let other = 0; other < 3; other++) if (other !== row) { const factor = matrix[other][row]; for (let column = row; column < 4; column++) matrix[other][column] -= factor * matrix[row][column]; }
    }
    const coefficients = matrix.map(row => row[3]), explained = coefficients.reduce((sum, value, i) => sum + value * rhs[i], 0);
    return { frequency, amplitude: Math.hypot(coefficients[0], coefficients[1]), explained };
  };
  const step = crossingFrequency / 100;
  let best = at(crossingFrequency / 2);
  for (let bin = 1; bin <= 100; bin++) { const candidate = at(crossingFrequency / 2 + bin * step); if (candidate.explained > best.explained) best = candidate; }
  let left = best.frequency - step, right = best.frequency + step;
  for (let iteration = 0; iteration < 40; iteration++) {
    const a = at(left + (right - left) / 3), b = at(right - (right - left) / 3);
    if (a.explained > b.explained) { right = b.frequency; if (a.explained > best.explained) best = a; }
    else { left = a.frequency; if (b.explained > best.explained) best = b; }
  }
  return { frequency: best.frequency, amplitude: best.amplitude, normalizedRmsError: Math.sqrt(Math.max(0, power - best.explained) / signal.length) / best.amplitude };
}

function movingHalfSpace(h: number, interfaceScheme: 'binary' | 'fractional' = 'binary') {
  const beta = 0.1, velocity = beta * C, gamma = 1 / Math.sqrt(1 - beta * beta), sigma = 0.3, frequency = 1e9;
  const pmlCells = Math.round(0.1 / h), n = Math.round(6 / h) + 2 * pmlCells;
  const s = new YeeSolver({ nx: n, ny: 1, nz: 1, dx: h, dy: h, dz: h, cfl: 0.9,
    boundary: { x: 'pml', y: 'periodic', z: 'periodic' }, pmlCells });
  const explicitOhmNumber = sigma * gamma * s.dt / EPS0;
  if (explicitOhmNumber * (1 + beta) >= 2 * (1 - 0.9 ** 2)) throw new Error('Explicit Ohm-Maxwell combined stability bound violated');
  const source = pmlCells + Math.round(0.3 / h), probe = pmlCells + Math.round(0.8 / h), eta = Math.sqrt(MU_0 / EPS0);
  const times: number[] = [], incident: number[] = [], reflected: number[] = [];
  const v: Vec3 = [velocity, 0, 0];
  // Exact linear specialization of the shared vector constitutive law. Avoid
  // revalidating identical material/velocity inputs at every 1D grid point.
  const electricCoefficient = movingOhmCurrent([0, 1, 0], [0, 0, 0], v, sigma)[1];
  const magneticCoefficient = movingOhmCurrent([0, 0, 0], [0, 0, 1], v, sigma)[1];
  for (let step = 0; step < Math.ceil(40e-9 / s.dt); step++) {
    s.Jy.fill(0);
    const interfaceX = 1.5 + velocity * (s.time + (interfaceScheme === 'fractional' ? s.dt / 2 : 0));
    const first = Math.max(1, pmlCells + Math.floor(interfaceX / h));
    for (let x = first; x < n - 1; x++) {
      const position = (x - pmlCells) * h;
      const fraction = interfaceScheme === 'fractional' ? Math.max(0, Math.min(1, (position + h / 2 - interfaceX) / h)) : Number(position >= interfaceX);
      const bz = (s.synchronizedB(2, x - 1) + s.synchronizedB(2, x)) / 2;
      s.Jy[x] = fraction * (electricCoefficient * s.Ey[x] + magneticCoefficient * bz);
    }
    const t = s.time + s.dt / 2, ramp = Math.min(1, frequency * t / 3);
    s.Jy[source] = -2 * ramp * Math.sin(2 * Math.PI * frequency * t) / (eta * h);
    s.step();
    if (s.time < 20e-9) continue;
    const bz = (s.synchronizedB(2, probe - 1) + s.synchronizedB(2, probe)) / 2;
    times.push(s.time); incident.push((s.Ey[probe] + C * bz) / 2); reflected.push((s.Ey[probe] - C * bz) / 2);
  }
  const incoming = fitSignal(times, incident), outgoing = fitSignal(times, reflected);
  const doppler = (1 - beta) / (1 + beta), restOmega = 2 * Math.PI * frequency * gamma * (1 - beta);
  const kappa = sigma / (EPS0 * restOmega), magnitude = Math.hypot(1, kappa);
  const nr = Math.sqrt((magnitude + 1) / 2), ni = Math.sqrt((magnitude - 1) / 2);
  const restReflection = Math.hypot(1 - nr, ni) / Math.hypot(1 + nr, ni);
  const amplitudeRatio = outgoing.amplitude / incoming.amplitude, referenceRatio = doppler * restReflection;
  return { h, sigma, beta, interfaceScheme, explicitOhmNumber, incoming, outgoing, amplitudeRatio, referenceRatio,
    frequencyError: Math.abs(outgoing.frequency / (incoming.frequency * doppler) - 1), amplitudeError: Math.abs(amplitudeRatio / referenceRatio - 1) };
}

describe('moving finite-conductivity half-space', () => {
  it('measures binary-interface Doppler and Fresnel carriers while reporting unresolved broadband ripple', () => {
    const results = [0.002, 0.001].map(h => movingHalfSpace(h));
    console.log('Moving conductor', JSON.stringify(results));
    for (const result of results) {
      expect(result.frequencyError).toBeLessThan(0.01);
      expect(result.amplitudeError).toBeLessThan(0.01);
      expect(result.incoming.normalizedRmsError).toBeLessThan(0.01);
    }
    expect(results[1].amplitudeError).toBeLessThan(results[0].amplitudeError);
    expect(results[1].outgoing.normalizedRmsError).toBeLessThan(results[0].outgoing.normalizedRmsError);
  }, 120000);

  it('resolves the fractional-interface prototype carrier and waveform under refinement', () => {
    const results = [0.002, 0.001].map(h => movingHalfSpace(h, 'fractional'));
    console.log('Fractional moving conductor prototype', JSON.stringify(results));
    for (const result of results) {
      expect(result.frequencyError).toBeLessThan(0.01); expect(result.amplitudeError).toBeLessThan(0.01);
      expect(result.incoming.normalizedRmsError).toBeLessThan(0.01); expect(result.outgoing.normalizedRmsError).toBeLessThan(0.01);
    }
    expect(results[1].amplitudeError).toBeLessThan(results[0].amplitudeError);
    expect(results[1].outgoing.normalizedRmsError).toBeLessThan(results[0].outgoing.normalizedRmsError);
  }, 120000);
});
