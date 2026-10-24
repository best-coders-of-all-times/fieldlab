import { describe, expect, it } from 'vitest';
import { YeeSolver, LIGHT_SPEED as C, EPSILON_0 as EPS0, MU_0 } from '../../src/engine/maxwell/yee';

const periodic = { x: 'periodic', y: 'periodic', z: 'periodic' } as const;
const simpleGrid = () => new YeeSolver({ nx: 8, ny: 1, nz: 1, dx: 0.01, dy: 0.01, dz: 0.01, boundary: periodic });

function plasma(dt: number) {
  const s = new YeeSolver({ nx: 4, ny: 4, nz: 4, dx: 0.02, dy: 0.02, dz: 0.02, dt, boundary: periodic });
  const eps = 2, omegaP = 2 * Math.PI * 0.5e9, gamma = 2 * Math.PI * 40e6;
  s.epsX.fill(eps); s.epsY.fill(eps); s.epsZ.fill(eps);
  s.configureDrude({ omegaP, gamma });
  const omega = Math.sqrt(omegaP ** 2 / eps - gamma ** 2 / 4), frequency = omega / (2 * Math.PI);
  s.Ex.fill(1);
  s.drude!.Jx.fill(-EPS0 * omegaP ** 2 / omega * Math.exp(gamma * dt / 4) * Math.sin(omega * dt / 2));
  const crossings: number[] = [], peaks: { t: number; value: number }[] = [];
  let previous = 1, beforePrevious = 1, error = 0, samples = 0;
  for (let step = 0; step < Math.ceil(6 / (frequency * dt)); step++) {
    s.step(); const value = s.Ex[0], t = s.time;
    const expected = Math.exp(-gamma * t / 2) * (Math.cos(omega * t) + gamma / (2 * omega) * Math.sin(omega * t));
    error += (value - expected) ** 2; samples++;
    if (previous < 0 && value >= 0) crossings.push(t - dt * value / (value - previous));
    if (previous > 0 && previous > beforePrevious && previous >= value) {
      const shift = (beforePrevious - value) / (2 * (beforePrevious - 2 * previous + value));
      const peak = previous - (value - beforePrevious) ** 2 / (8 * (beforePrevious + value - 2 * previous));
      peaks.push({ t: t - dt + shift * dt, value: peak });
    }
    beforePrevious = previous; previous = value;
  }
  const measuredFrequency = (crossings.length - 1) / (crossings.at(-1)! - crossings[0]);
  const measuredDamping = Math.log(peaks[0].value / peaks.at(-1)!.value) / (peaks.at(-1)!.t - peaks[0].t);
  return { dt, frequency: measuredFrequency, referenceFrequency: frequency, damping: measuredDamping, referenceDamping: gamma / 2,
    frequencyError: Math.abs(measuredFrequency / frequency - 1), dampingError: Math.abs(measuredDamping / (gamma / 2) - 1), rmsError: Math.sqrt(error / samples), diagnostics: s.diagnostics() };
}

function interfaceResponse(h: number, frequency: number) {
  const omegaP = 2 * Math.PI * 1.5e9, gamma = 2 * Math.PI * 0.3e9, omega = 2 * Math.PI * frequency;
  const pad = Math.round(0.12 / h), n = Math.round(1.6 / h) + 2 * pad;
  const s = new YeeSolver({ nx: n, ny: 1, nz: 1, dx: h, dy: h, dz: h, boundary: { ...periodic, x: 'pml' }, pmlCells: pad });
  const wp = new Float64Array(n), damping = new Float64Array(n);
  for (let x = 0; x < n; x++) if ((x - pad) * h >= 0.6) { wp[x] = omegaP; damping[x] = gamma; }
  s.configureDrude({ omegaP: { x: 0, y: wp, z: 0 }, gamma: { x: 0, y: damping, z: 0 } });
  const source = pad + Math.round(0.2 / h), probe = pad + Math.round(0.35 / h), medium = [0.67, 0.75].map(x => pad + Math.round(x / h));
  const matrix = Array.from({ length: 3 }, () => [0, 0, 0]), rhs = Array.from({ length: 4 }, () => [0, 0, 0]);
  for (let step = 0; step < Math.ceil(36 / (frequency * s.dt)); step++) {
    const t = s.time + s.dt / 2;
    s.Jy[source] = -2 * Math.sin(omega * t) * Math.min(1, frequency * t / 6) / (Math.sqrt(MU_0 / EPS0) * h);
    s.step();
    if (frequency * s.time < 26) continue;
    const basis = [Math.cos(omega * s.time), Math.sin(omega * s.time), 1];
    const bz = (s.synchronizedB(2, probe - 1) + s.synchronizedB(2, probe)) / 2;
    const values = [(s.Ey[probe] + C * bz) / 2, (s.Ey[probe] - C * bz) / 2, s.Ey[medium[0]], s.Ey[medium[1]]];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) matrix[row][col] += basis[row] * basis[col];
      for (let signal = 0; signal < 4; signal++) rhs[signal][row] += basis[row] * values[signal];
    }
  }
  const fits = rhs.map(values => {
    const a = matrix.map((row, i) => [...row, values[i]]);
    for (let row = 0; row < 3; row++) {
      const pivot = a[row][row]; for (let col = row; col < 4; col++) a[row][col] /= pivot;
      for (let other = 0; other < 3; other++) if (other !== row) { const factor = a[other][row]; for (let col = row; col < 4; col++) a[other][col] -= factor * a[row][col]; }
    }
    return { amplitude: Math.hypot(a[0][3], a[1][3]), phase: Math.atan2(a[1][3], a[0][3]) };
  });
  const epsilonReal = 1 - omegaP ** 2 / (omega ** 2 + gamma ** 2), epsilonImaginary = omegaP ** 2 * gamma / (omega * (omega ** 2 + gamma ** 2));
  const magnitude = Math.hypot(epsilonReal, epsilonImaginary), nr = Math.sqrt((magnitude + epsilonReal) / 2), ni = Math.sqrt((magnitude - epsilonReal) / 2);
  const referenceReflection = Math.hypot(1 - nr, ni) / Math.hypot(1 + nr, ni), referenceAlpha = omega / C * ni, referenceBeta = omega / C * nr;
  const reflection = fits[1].amplitude / fits[0].amplitude, alpha = Math.log(fits[2].amplitude / fits[3].amplitude) / 0.08;
  const delta = fits[3].phase - fits[2].phase, beta = Math.atan2(Math.sin(delta), Math.cos(delta)) / 0.08;
  return { h, frequency, epsilonReal, epsilonImaginary, reflection, referenceReflection, alpha, referenceAlpha, beta, referenceBeta,
    reflectionError: Math.abs(reflection / referenceReflection - 1), alphaError: Math.abs(alpha / referenceAlpha - 1), betaError: Math.abs(beta / referenceBeta - 1) };
}

describe('stationary SI Drude auxiliary current', () => {
  it('allocates optional pole memory lazily and rejects the coupled wave/plasma instability', () => {
    const s = simpleGrid();
    expect(s.drude).toBeNull(); expect(s.snapshot().drude).toBeNull();
    // Both separate bounds pass, but their sum fails: S² + (omegaP dt/2)² > 1.
    expect(() => s.configureDrude({ omegaP: 0.95 / s.dt })).toThrow(/coupled|CFL|stability/i);
    expect(s.drude).toBeNull();
    s.configureDrude({ omegaP: 0.6 / s.dt, gamma: 0 });
    expect(s.drude!.Jx.byteLength * 9).toBe(72 * s.rho.length);
    expect(() => s.configureDrude({ omegaP: -1 })).toThrow(/plasma|nonnegative/i);
    expect(() => s.configureDrude({ omegaP: 1, gamma: NaN })).toThrow(/damping|finite/i);
  });

  it('matches uniform plasma oscillation frequency and damping with temporal refinement', () => {
    const results = [2e-11, 1e-11].map(plasma);
    console.log('Drude uniform plasma', JSON.stringify(results));
    for (const result of results) {
      expect(result.frequencyError).toBeLessThan(0.01); expect(result.dampingError).toBeLessThan(0.01);
      expect(result.rmsError).toBeLessThan(0.003); expect(result.diagnostics.drudeLoss).toBeGreaterThan(0);
      expect(result.diagnostics.drudeKineticEnergy).toBeGreaterThanOrEqual(0);
    }
    expect(results[1].rmsError).toBeLessThan(results[0].rmsError / 3);
  });

  it('includes nonuniform Drude current in free-charge continuity and complete replay', () => {
    const s = simpleGrid(), omegaP = new Float64Array(s.rho.length).fill(1e9);
    for (let x = 0; x < s.nx; x++) { s.Ex[x] = Math.sin(2 * Math.PI * x / s.nx); omegaP[x] *= 1 + x / s.nx; }
    s.configureDrude({ omegaP: { x: omegaP, y: 0, z: 0 }, gamma: 2e8 });
    s.setChargeFromElectricField(); s.step(7); const initial = s.snapshot(); s.step(11); const expected = s.snapshot();
    expect(s.diagnostics().divergenceE).toBeLessThan(1e-23);
    s.configureDrude(null); s.restore(initial); s.step(11);
    expect(Array.from(s.Ex)).toEqual(Array.from(expected.Ex)); expect(Array.from(s.drude!.Jx)).toEqual(Array.from(expected.drude!.Jx));
    expect(s.diagnostics().drudeLoss).toBe(expected.drude!.loss);
    s.reset(); expect(s.drude!.omegaPX[0]).toBe(1e9); expect(s.drude!.Jx.every(value => value === 0)).toBe(true); expect(s.diagnostics().drudeLoss).toBe(0);
  });

  it('reports the impressed, implicit Ohmic and Drude currents used in Ampere, including replay', () => {
    const s = simpleGrid(); s.Ex.fill(1); s.Jx.fill(0.002); s.sigmaX.fill(0.01);
    s.configureDrude({ omegaP: 1e9, gamma: 2e8 });
    expect(s.currentAtUpdate(0, 0)).toBe(0.002);
    const initialE = s.Ex[0]; s.step();
    const expected = s.Jx[0] + s.sigmaX[0] * (initialE + s.Ex[0]) / 2 + s.drude!.Jx[0];
    expect(s.currentAtUpdate(0, 0)).toBeCloseTo(expected, 16);
    const snapshot = s.snapshot(); s.step(3); s.restore(snapshot);
    expect(s.currentAtUpdate(0, 0)).toBeCloseTo(expected, 16);
    s.reset(); expect(s.currentAtUpdate(0, 0)).toBe(0);
  });

  it('matches dispersive interface reflection and complex propagation below and above the plasma frequency', () => {
    for (const frequency of [1e9, 2e9]) {
      const results = [0.005, 0.0025].map(h => interfaceResponse(h, frequency));
      console.log('Drude interface', JSON.stringify(results));
      for (const result of results) { expect(result.reflectionError).toBeLessThan(0.01); expect(result.alphaError).toBeLessThan(0.01); expect(result.betaError).toBeLessThan(0.01); }
      expect(results[1].reflectionError).toBeLessThan(results[0].reflectionError);
      expect(results[1].alphaError).toBeLessThan(results[0].alphaError);
      expect(results[1].betaError).toBeLessThan(results[0].betaError);
    }
  }, 30000);
});
