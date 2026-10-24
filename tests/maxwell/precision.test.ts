import { describe, expect, it } from 'vitest';
import { EPSILON_0, LIGHT_SPEED as C, YeeSolver } from '../../src/engine/maxwell/yee';

const periodic = { x: 'periodic', y: 'periodic', z: 'periodic' } as const;
type Precision = 'float32' | 'float64';
const options = { nx: 32, ny: 1, nz: 1, dx: 0.02, dy: 0.02, dz: 0.02, cfl: 0.5, boundary: periodic };
const rms = (a: ArrayLike<number>, b: ArrayLike<number>, scale = 1) => Math.sqrt(Array.from(a, (v, i) => ((v - b[i]) / scale) ** 2).reduce((s, v) => s + v, 0) / a.length);

function wave<P extends Precision>(precision: P, n: number) {
  const s = new YeeSolver({ ...options, nx: n, dx: 1 / n, dy: 1 / n, dz: 1 / n, cfl: 0.8, precision });
  for (let x = 0; x < n; x++) {
    s.Ey[x] = Math.sin(2 * Math.PI * x / n);
    s.Bz[x] = Math.sin(2 * Math.PI * ((x + 0.5) / n + C * s.dt / 2)) / C;
  }
  s.step(3 * n / 4); // Fixed integer steps; c*t = 0.6 m at both resolutions.
  const exact = Array.from({ length: n }, (_, x) => Math.sin(2 * Math.PI * (x / n - C * s.time)));
  const sin = Array.from(s.Ey).reduce((v, e, x) => v + e * Math.sin(2 * Math.PI * x / n) * 2 / n, 0);
  const cos = Array.from(s.Ey).reduce((v, e, x) => v + e * Math.cos(2 * Math.PI * x / n) * 2 / n, 0);
  return { s, error: rms(s.Ey, exact), amplitude: Math.hypot(sin, cos), phase: Math.atan2(cos, sin) };
}

describe('selectable CPU Yee storage precision', () => {
  it('uses actual Float32 storage for fields, materials, optional poles and all saved auxiliary state', () => {
    const s = new YeeSolver({ ...options, boundary: { ...periodic, x: 'pml' }, pmlCells: 4, precision: 'float32' });
    expect(s.Ex).toBeInstanceOf(Float32Array);
    expect(s.drude).toBeNull();
    s.configureDrude({ omegaP: { x: new Float64Array(32).fill(1e9), y: new Float32Array(32).fill(1e9), z: 1e9 }, gamma: 1e8 });
    const saved = s.snapshot();
    expect(saved.precision).toBe('float32');
    for (const value of Object.values(saved)) if (ArrayBuffer.isView(value)) expect(value).toBeInstanceOf(Float32Array);
    for (const arrays of [saved.cpml, saved.cpmlReference, saved.boundaryE, saved.conduction]) for (const a of arrays) expect(a).toBeInstanceOf(Float32Array);
    for (const value of Object.values(s.drude!)) if (ArrayBuffer.isView(value)) expect(value).toBeInstanceOf(Float32Array);
    for (const value of Object.values(saved.drude!)) if (ArrayBuffer.isView(value)) expect(value).toBeInstanceOf(Float32Array);
    s.Ex[2] = 1 / 3; expect(s.Ex[2]).toBe(Math.fround(1 / 3));
    s.configureDrude(null); expect(s.drude).toBeNull();
  });

  it('retains Float64 as the default with identical explicit and implicit default evolution', () => {
    const a = new YeeSolver(options), b = new YeeSolver({ ...options, precision: 'float64' });
    expect(a.Ex).toBeInstanceOf(Float64Array);
    for (const s of [a, b]) { s.Ey[7] = 1 / 3; s.configureDrude({ omegaP: 1e9, gamma: 1e8 }); s.step(19); }
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it('matches Float64 wave phase, amplitude and field samples with second order continuum refinement', () => {
    const report = [32, 64].map(n => {
      const f = wave('float32', n), d = wave('float64', n);
      expect(f.s.Ey).toBeInstanceOf(Float32Array);
      const fieldRms = rms(f.s.Ey, d.s.Ey), magneticRms = rms(f.s.Bz, d.s.Bz, 1 / C);
      const phaseError = Math.abs(f.phase - d.phase), amplitudeError = Math.abs(f.amplitude / d.amplitude - 1);
      expect(fieldRms).toBeLessThan(2e-6); expect(magneticRms).toBeLessThan(2e-6);
      expect(phaseError).toBeLessThan(2e-6); expect(amplitudeError).toBeLessThan(2e-6);
      expect(f.error).toBeLessThan(0.003);
      return { n, steps: f.s.steps, time: f.s.time, fieldRms, magneticRms, phaseError, amplitudeError, continuumRms: f.error };
    });
    expect(report[0].continuumRms / report[1].continuumRms).toBeGreaterThan(3.7);
    console.log('CPU Float32 wave', JSON.stringify(report));
  });

  it('preserves normalized electric and magnetic Gauss constraints with smooth conserved current and material response', () => {
    const n = 12, dx = 0.02;
    const s = new YeeSolver({ ...options, nx: n, ny: n, nz: n, precision: 'float32' });
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = s.index(x, y, z), k = 2 * Math.PI / n;
      s.Ex[i] = Math.sin(k * x) * Math.cos(k * y); s.Ey[i] = Math.cos(k * y) * Math.sin(k * z); s.Ez[i] = Math.sin(k * z) * Math.cos(k * x);
      s.Jx[i] = 0.001 * Math.sin(k * x); s.Jy[i] = 0.001 * Math.cos(k * y);
      s.epsX[i] = 2 + 0.2 * Math.sin(k * x); s.sigmaX[i] = 0.001 * (1 + 0.1 * Math.cos(k * y));
    }
    s.configureDrude({ omegaP: 1e9, gamma: 1e8 }); s.setChargeFromElectricField();
    const initialCharge = s.diagnostics().charge;
    s.step(80);
    const d = s.diagnostics(), electric = d.divergenceE / (EPSILON_0 / dx), magnetic = d.divergenceB / (1 / C / dx);
    expect(s.Ex).toBeInstanceOf(Float32Array);
    expect(electric).toBeLessThanOrEqual(1e-5); expect(magnetic).toBeLessThanOrEqual(1e-5);
    expect(Math.abs(d.charge - initialCharge) / (EPSILON_0 / dx * (n * dx) ** 3)).toBeLessThan(1e-6);
    console.log('CPU Float32 Gauss', JSON.stringify({ n, steps: s.steps, time: s.time, electric, magnetic, charge: d.charge }));
  });

  it('preserves local current continuity with captured static references and CPML', () => {
    const nx = 24, ny = 20, dx = 0.02;
    const s = new YeeSolver({ ...options, nx, ny, boundary: { ...periodic, x: 'pml', y: 'pml' }, pmlCells: 3, precision: 'float32' });
    const phi = (x: number, y: number) => 0.02 * Math.sin(2 * Math.PI * x / nx) * Math.cos(2 * Math.PI * y / ny);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = s.index(x, y, 0);
      s.Ex[i] = (phi(x, y) - phi((x + 1) % nx, y)) / dx;
      s.Ey[i] = (phi(x, y) - phi(x, (y + 1) % ny)) / dx;
      s.Jx[i] = 0.001 * Math.sin(2 * Math.PI * x / nx) * Math.sin(2 * Math.PI * y / ny);
    }
    s.setChargeFromElectricField(); s.captureStaticBackground();
    expect(s.snapshot().cpmlReference[0]).toBeInstanceOf(Float32Array);
    const initialCharge = s.diagnostics().charge;
    let continuity = 0;
    for (let step = 0; step < 40; step++) {
      const old = s.rho.slice(); s.step();
      for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        const i = s.index(x, y, 0), imx = s.index((x + nx - 1) % nx, y, 0), imy = s.index(x, (y + ny - 1) % ny, 0);
        const div = (s.currentAtUpdate(0, i) - s.currentAtUpdate(0, imx) + s.currentAtUpdate(1, i) - s.currentAtUpdate(1, imy)) / dx;
        continuity = Math.max(continuity, Math.abs(s.rho[i] - old[i] + s.dt * div) / (EPSILON_0 / dx));
      }
    }
    const normalizedGauss = s.diagnostics().divergenceE / (EPSILON_0 / dx);
    expect(continuity).toBeLessThan(2e-7); expect(normalizedGauss).toBeLessThanOrEqual(1e-5);
    expect(Math.abs(s.diagnostics().charge - initialCharge) / (EPSILON_0 / dx * nx * ny * dx ** 3)).toBeLessThan(1e-6);
    console.log('CPU Float32 CPML continuity', JSON.stringify({ steps: s.steps, time: s.time, continuity, normalizedGauss }));
  });

  it('matches the analytic Ohmic decay and the damped Drude response over a fixed duration', () => {
    const reports = [2e-11, 1e-11].map(dt => {
      const s = new YeeSolver({ ...options, nx: 4, dx: 0.02, dt, precision: 'float32' });
      const sigma = EPSILON_0 / (20 * dt); s.Ex.fill(2); s.sigmaX.fill(sigma); s.step(20);
      const ohmicError = Math.abs(s.Ex[0] / (2 / Math.E) - 1);
      expect(ohmicError).toBeLessThan(0.001); expect(s.diagnostics().ohmicLoss).toBeGreaterThan(0);
      const d = new YeeSolver({ ...options, nx: 4, dx: 0.02, dt, precision: 'float32' });
      const omegaP = 2 * Math.PI * 0.5e9, gamma = 2 * Math.PI * 40e6, omega = Math.sqrt(omegaP ** 2 - gamma ** 2 / 4);
      d.configureDrude({ omegaP, gamma }); d.Ex.fill(1);
      d.drude!.Jx.fill(-EPSILON_0 * omegaP ** 2 / omega * Math.exp(gamma * dt / 4) * Math.sin(omega * dt / 2));
      let sum = 0; const steps = Math.round(4e-9 / dt);
      for (let step = 0; step < steps; step++) {
        d.step(); const exact = Math.exp(-gamma * d.time / 2) * (Math.cos(omega * d.time) + gamma / (2 * omega) * Math.sin(omega * d.time));
        sum += (d.Ex[0] - exact) ** 2;
      }
      const drudeRms = Math.sqrt(sum / steps);
      expect(d.Ex).toBeInstanceOf(Float32Array); expect(drudeRms).toBeLessThan(0.003); expect(d.diagnostics().drudeLoss).toBeGreaterThan(0);
      return { dt, steps, time: d.time, ohmicError, drudeRms };
    });
    expect(reports[0].drudeRms / reports[1].drudeRms).toBeGreaterThan(3.5);
    console.log('CPU Float32 material response', JSON.stringify(reports));
  });

  it('replays Float32 snapshots bit exactly including Drude, Ohmic and nonzero CPML memory', () => {
    const s = new YeeSolver({ ...options, boundary: { ...periodic, x: 'pml' }, pmlCells: 4, precision: 'float32' });
    expect(s.Ex).toBeInstanceOf(Float32Array);
    s.configureDrude({ omegaP: 1e9, gamma: 1e8 }); s.sigmaY.fill(0.001);
    for (let x = 0; x < 32; x++) s.Ey[x] = Math.exp(-(((x - 12) / 4) ** 2));
    s.captureStaticBackground(); s.Jy[10] = 0.001; s.step(18);
    const initial = s.snapshot();
    expect(initial.cpml.some(a => a.some(v => v !== 0))).toBe(true);
    s.step(29); const final = s.snapshot();
    s.configureDrude(null); s.restore(initial); s.step(29);
    expect(s.snapshot()).toEqual(final);
    s.reset(); expect(s.Ex.every(v => v === 0)).toBe(true); expect(s.drude!.Jx.every(v => v === 0)).toBe(true);
  });

  it('rejects invalid precision and incompatible snapshots before modifying live fields', () => {
    expect(() => new YeeSolver({ ...options, precision: 'half' as Precision })).toThrow(/precision/i);
    const f = new YeeSolver({ ...options, precision: 'float32' }), d = new YeeSolver(options);
    f.Ex.fill(3); const before = f.snapshot();
    expect(() => f.restore(d.snapshot() as never)).toThrow(/precision/i);
    expect(f.snapshot()).toEqual(before);
    const malformed = f.snapshot(); malformed.Ex = new Float64Array(32) as never;
    expect(() => f.restore(malformed)).toThrow(/precision/i); expect(f.snapshot()).toEqual(before);
    const wrongGrid = f.snapshot(); wrongGrid.rho = new Float32Array(31);
    expect(() => f.restore(wrongGrid)).toThrow(/grid/i); expect(f.snapshot()).toEqual(before);
  });
});
