import { expect, it } from 'vitest';
import { YeeSolver, LIGHT_SPEED } from '../../src/engine/maxwell/yee';
import { measureFieldBalance } from '../../src/engine/maxwell/fieldBalance';
import { MaxwellSceneSolver } from '../../src/engine/maxwell/sceneSolver';
import { getPreset } from '../../src/scene/presets';

it('balances displacement/flux and all deposited, Ohmic and Drude work in a finite control volume', () => {
  const s = new YeeSolver({ nx: 12, ny: 12, nz: 12, dx: 0.02, dy: 0.03, dz: 0.04, boundary: { x: 'periodic', y: 'periodic', z: 'periodic' }, cfl: 0.8 });
  s.configureDrude({ omegaP: 1e9, gamma: 1e8 });
  for (let n = 0; n < s.rho.length; n++) {
    s.Ex[n] = Math.sin(n * 0.43); s.Ey[n] = Math.cos(n * 0.72); s.Ez[n] = Math.sin(n * 0.27);
    s.Bx[n] = Math.cos(n * 0.14) / LIGHT_SPEED; s.By[n] = Math.sin(n * 0.23) / LIGHT_SPEED; s.Bz[n] = Math.cos(n * 0.64) / LIGHT_SPEED;
    s.epsX[n] = 1 + 0.03 * (n % 7); s.epsY[n] = 1 + 0.02 * (n % 5); s.epsZ[n] = 1 + 0.04 * (n % 3);
    s.muX[n] = 1 + 0.02 * (n % 4); s.muY[n] = 1 + 0.03 * (n % 6); s.muZ[n] = 1 + 0.01 * (n % 5);
    s.sigmaX[n] = 0.002; s.sigmaY[n] = 0.001; s.Jx[n] = 0.001 * Math.sin(n);
  }
  for (let step = 0; step < 3; step++) {
    const balance = measureFieldBalance(s, { low: [2, 3, 2], high: [8, 9, 7] }, () => s.step());
    expect(Math.abs(balance.matterWork)).toBeGreaterThan(1e-17);
    expect(balance.relativeResidual).toBeLessThan(1e-12);
  }
});

it('closes the field budget around a moving material scene, including source and boundary flux', () => {
  const solver = new MaxwellSceneSolver(getPreset('maxwell-moving-capacitor')!.create());
  solver.step(3);
  const p = solver.meta.physical;
  const balance = measureFieldBalance(solver.core, { low: [p.x0 + 1, p.y0 + 1, p.z0 + 1], high: [p.x1 - 2, p.y1 - 2, p.z1 - 2] }, () => solver.step());
  expect(balance.relativeResidual).toBeLessThan(1e-10);
  expect(solver.diagnostics().gaussRelative).toBeLessThan(1e-8);
});

it('resolves small work and flux changes against a large uniform magnetic background', () => {
  const s = new YeeSolver({ nx: 32, ny: 32, nz: 32, dx: 1 / 32, dy: 1 / 32, dz: 1 / 32, cfl: 0.6, boundary: { x: 'periodic', y: 'periodic', z: 'periodic' } });
  s.Bz.fill(0.001); s.sigmaX.fill(0.002);
  for (let k = 0; k < s.nz; k++) for (let j = 0; j < s.ny; j++) for (let i = 0; i < s.nx; i++) s.Ex[s.index(i, j, k)] = 25 * Math.sin(2 * Math.PI * j / s.ny);
  for (let step = 0; step < 4; step++) {
    const balance = measureFieldBalance(s, { low: [2, 2, 2], high: [29, 29, 29] }, () => s.step());
    expect(Math.abs(balance.matterWork)).toBeGreaterThan(1e-12);
    expect(Math.abs(balance.change) / balance.before).toBeLessThan(1e-3);
    expect(Math.abs(balance.residual) / balance.before).toBeLessThan(2e-15);
  }
});
