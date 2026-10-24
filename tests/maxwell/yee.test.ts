import { describe, expect, it } from 'vitest';
import { YeeSolver, EPSILON_0, MU_0, LIGHT_SPEED } from '../../src/engine/maxwell/yee';

const periodic = { x: 'periodic', y: 'periodic', z: 'periodic' } as const;
const grid = (n = 12) => new YeeSolver({ nx: n, ny: n, nz: n, dx: 0.02, dy: 0.02, dz: 0.02, boundary: periodic });

describe('SI Yee Maxwell reference kernel', () => {
  it('preserves both compatible Gauss constraints through arbitrary curls and conserved current', () => {
    const s = grid();
    for (let i = 0; i < s.Ex.length; i++) {
      s.Ex[i] = Math.sin(i * 1.71); s.Ey[i] = Math.cos(i * 0.77); s.Ez[i] = Math.sin(i * 0.31);
      s.Jx[i] = Math.sin(i * 0.43); s.Jy[i] = Math.cos(i * 0.63); s.Jz[i] = Math.sin(i * 0.29);
    }
    s.setChargeFromElectricField();
    s.step(9);
    expect(s.diagnostics().divergenceE).toBeLessThan(2e-23);
    expect(s.diagnostics().divergenceB).toBeLessThan(1e-20);
    expect(Math.abs(s.diagnostics().charge)).toBeLessThan(1e-25);
  });

  it('transports a transverse wave at c with vacuum impedance and second order convergence', () => {
    const errors = [24, 48].map(n => {
      const dx = 1 / n;
      const s = new YeeSolver({ nx: n, ny: 1, nz: 1, dx, dy: dx, dz: dx, cfl: 0.8, boundary: periodic });
      const k = 2 * Math.PI;
      for (let x = 0; x < n; x++) {
        s.Ey[x] = Math.sin(k * x * dx);
        s.Bz[x] = Math.sin(k * ((x + 0.5) * dx + LIGHT_SPEED * s.dt / 2)) / LIGHT_SPEED;
      }
      const steps = Math.round(0.6 / LIGHT_SPEED / s.dt);
      s.step(steps);
      let err = 0;
      for (let x = 0; x < n; x++) err += (s.Ey[x] - Math.sin(k * (x * dx - LIGHT_SPEED * s.time))) ** 2;
      const d = s.diagnostics();
      expect(d.magneticEnergy / d.electricEnergy).toBeCloseTo(1, 1);
      return Math.sqrt(err / n);
    });
    expect(errors[0]).toBeLessThan(0.02);
    expect(errors[1]).toBeLessThan(errors[0] / 3);
  });

  it('includes Ohmic current in charge continuity and dissipates the analytic uniform field', () => {
    const s = grid(4);
    const sigma = EPSILON_0 / (20 * s.dt);
    s.Ex.fill(2); s.sigmaX.fill(sigma);
    s.step(20);
    expect(s.Ex[0]).toBeCloseTo(2 / Math.E, 3);
    expect(s.diagnostics().ohmicLoss).toBeGreaterThan(0);
    expect(s.diagnostics().divergenceE).toBeLessThan(1e-24);
  });

  it('synchronizes magnetic samples to E time with a centered Faraday update', () => {
    const s = grid(8);
    for (let i = 0; i < s.Ey.length; i++) s.Ey[i] = Math.sin(i * 0.71);
    s.step();
    const i = s.index(3, 2, 2);
    const curlZ = (s.Ey[i + 1] - s.Ey[i]) / s.dx - (s.Ex[i + s.nx] - s.Ex[i]) / s.dy;
    expect(s.synchronizedB(2, i)).toBeCloseTo(s.Bz[i] - s.dt * curlZ / 2, 24);
    const snapshot = s.snapshot(); s.synchronizedB(2, i);
    expect(Array.from(s.Bz)).toEqual(Array.from(snapshot.Bz));
  });

  it('preserves Gauss law across nonuniform permittivity and conduction', () => {
    const s = grid(8);
    for (let i = 0; i < s.rho.length; i++) {
      s.Ex[i] = Math.sin(i); s.Ey[i] = Math.cos(i * 0.31);
      s.epsX[i] = 1 + i % 4; s.epsY[i] = 1 + i % 3;
      s.sigmaX[i] = (i % 7) * EPSILON_0 / (100 * s.dt);
    }
    s.setChargeFromElectricField(); s.step(10);
    expect(s.diagnostics().divergenceE).toBeLessThan(1e-23);
  });

  it('rejects unstable dt after faster material coefficients are supplied', () => {
    const s = grid(4);
    s.epsX.fill(0.1); s.epsY.fill(0.1); s.epsZ.fill(0.1);
    expect(() => s.validateMaterials()).toThrow(/CFL|stable/i);
  });

  it('propagates in a dielectric at its material wave speed and impedance', () => {
    const n = 64, dx = 1 / n, eps = 4, mu = 2, speed = LIGHT_SPEED / Math.sqrt(eps * mu);
    const s = new YeeSolver({ nx: n, ny: 1, nz: 1, dx, dy: dx, dz: dx, boundary: periodic });
    s.epsX.fill(eps); s.epsY.fill(eps); s.epsZ.fill(eps);
    s.muX.fill(mu); s.muY.fill(mu); s.muZ.fill(mu); s.validateMaterials();
    for (let x = 0; x < n; x++) {
      s.Ey[x] = Math.sin(2 * Math.PI * x * dx);
      s.Bz[x] = Math.sin(2 * Math.PI * ((x + 0.5) * dx + speed * s.dt / 2)) / speed;
    }
    s.step(Math.round(0.3 / speed / s.dt));
    let error = 0;
    for (let x = 0; x < n; x++) error += (s.Ey[x] - Math.sin(2 * Math.PI * (x * dx - speed * s.time))) ** 2;
    expect(Math.sqrt(error / n)).toBeLessThan(0.003);
    expect(s.diagnostics().magneticEnergy / s.diagnostics().electricEnergy).toBeCloseTo(1, 2);
  });

  it('projects charge once and restores complete deterministic runtime snapshots', () => {
    const s = grid(8);
    s.rho[s.index(2, 3, 4)] = 1e-9;
    s.rho[s.index(5, 3, 4)] = -1e-9;
    const residual = s.projectElectricField(1e-11, 1000);
    expect(residual).toBeLessThan(1e-19);
    expect(s.diagnostics().divergenceE).toBeLessThan(1e-19);
    const saved = s.snapshot();
    s.Jy[15] = 1e-6; s.step(4);
    const result = s.snapshot();
    s.restore(saved); s.Jy[15] = 1e-6; s.step(4);
    expect(Array.from(s.Ey)).toEqual(Array.from(result.Ey));
    expect(s.time).toBe(result.time);
    expect(s.steps).toBe(4);
    s.reset();
    expect(s.steps).toBe(0);
    expect(s.diagnostics().totalEnergy).toBe(0);
  });

  it('enforces PEC tangential E while retaining a finite cavity wave', () => {
    const s = new YeeSolver({ nx: 30, ny: 1, nz: 1, dx: 0.02, dy: 0.02, dz: 0.02, boundary: { ...periodic, x: 'pec' } });
    for (let x = 0; x < s.nx; x++) s.Ey[x] = Math.sin(Math.PI * x / s.nx);
    s.step(150);
    expect(s.Ey[0]).toBe(0);
    expect(Number.isFinite(s.diagnostics().totalEnergy)).toBe(true);
    expect(s.diagnostics().totalEnergy).toBeGreaterThan(0);
  });

  it('absorbs an outgoing pulse with CPML derivative memories and replays them exactly', () => {
    const s = new YeeSolver({ nx: 100, ny: 1, nz: 1, dx: 0.01, dy: 0.01, dz: 0.01, boundary: { ...periodic, x: 'pml' }, pmlCells: 14 });
    for (let x = 0; x < s.nx; x++) {
      s.Ey[x] = Math.exp(-(((x - 40) / 6) ** 2));
      s.Bz[x] = Math.exp(-(((x + 0.5 - 40 + LIGHT_SPEED * s.dt / 0.01 / 2) / 6) ** 2)) / LIGHT_SPEED;
    }
    const initial = s.diagnostics().totalEnergy;
    s.step(60); const snapshot = s.snapshot();
    s.step(220); const end = Array.from(s.Ey);
    expect(s.diagnostics().totalEnergy / initial).toBeLessThan(0.002);
    s.restore(snapshot); s.step(220);
    expect(Array.from(s.Ey)).toEqual(end);
    expect(MU_0 * EPSILON_0 * LIGHT_SPEED ** 2).toBeCloseTo(1, 12);
  });

  it('preserves a captured static gradient through CPML without spurious magnetic fields', () => {
    const n = 14;
    const s = new YeeSolver({ nx: n, ny: n, nz: n, dx: 0.02, dy: 0.02, dz: 0.02,
      boundary: { x: 'pml', y: 'pml', z: 'pml' }, pmlCells: 3 });
    const phi = new Float64Array(n ** 3);
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
      phi[s.index(x, y, z)] = Math.sin(Math.PI * x / n) * Math.sin(Math.PI * y / n) * Math.sin(Math.PI * z / n) + 0.25 * Math.cos(2 * Math.PI * y / n);
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = s.index(x, y, z);
      s.Ex[i] = (phi[i] - phi[s.index((x + 1) % n, y, z)]) / s.dx;
      s.Ey[i] = (phi[i] - phi[s.index(x, (y + 1) % n, z)]) / s.dy;
      s.Ez[i] = (phi[i] - phi[s.index(x, y, (z + 1) % n)]) / s.dz;
    }
    s.setChargeFromElectricField(); s.captureStaticBackground();
    const initial = s.snapshot();
    s.step(120);
    expect(Math.max(...s.Bx.map(Math.abs), ...s.By.map(Math.abs), ...s.Bz.map(Math.abs))).toBeLessThan(1e-20);
    expect(Math.max(...s.Ex.map((v, i) => Math.abs(v - initial.Ex[i])))).toBeLessThan(1e-10);
    const evolved = s.snapshot(); s.restore(initial); s.step(120);
    expect(Array.from(s.Ex)).toEqual(Array.from(evolved.Ex));
  });
});

