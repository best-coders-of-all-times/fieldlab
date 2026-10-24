#!/usr/bin/env node
// Native Meep is needed only to regenerate the fixture, never to run this check.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixturePath = new URL('../tests/fixtures/maxwell/meep-periodic.json', import.meta.url);
const reportIndex = process.argv.indexOf('--report');
if (process.argv.some((arg, i) => i > 1 && arg !== '--report' && i !== reportIndex + 1)) {
  throw new Error('Usage: node scripts/check-meep-reference.mjs [--report PATH]');
}
if (reportIndex !== -1 && !process.argv[reportIndex + 1]) throw new Error('--report requires a path');
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
assert.equal(fixture.schemaVersion, 1);
assert.equal(fixture.cases.length, 6);
const server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { YeeSolver, LIGHT_SPEED } = await server.ssrLoadModule('/src/engine/maxwell/yee.ts');
  const results = [];
  const rms = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
  for (const c of fixture.cases) {
    const n = c.resolution, eps = c.relativePermittivity;
    assert.equal(c.electricPositions.length, n);
    assert.equal(c.magneticPositions.length, n);
    assert.ok(Math.abs(c.dt - c.courant * c.dx) < 1e-15);
    const solver = new YeeSolver({ nx: 1, ny: 1, nz: n, dx: c.dx, dy: c.dx, dz: c.dx,
      dt: c.dt / LIGHT_SPEED, boundary: { x: 'periodic', y: 'periodic', z: 'periodic' } });
    solver.epsX.fill(eps); solver.epsY.fill(eps); solver.epsZ.fill(eps);
    solver.validateMaterials();
    for (let i = 0; i < n; i++) {
      solver.Ex[i] = Math.cos(2 * Math.PI * c.electricPositions[i]);
      solver.By[i] = -Math.sqrt(eps) * Math.sin(2 * Math.PI * c.magneticPositions[i]) * Math.sin(c.discretePhaseStep / 2) / LIGHT_SPEED;
    }
    let maximumKernelError = 0;
    for (const snapshot of c.snapshots) {
      solver.step(snapshot.step - solver.steps);
      assert.ok(Math.abs(solver.time * LIGHT_SPEED - snapshot.time) < 1e-12);
      for (const [key, actual, amplitude] of [
        ['Ex', Array.from(solver.Ex), 1],
        ['By', Array.from(solver.By, value => value * LIGHT_SPEED), Math.sqrt(eps)],
        ['BySynchronized', Array.from({ length: n }, (_, i) => solver.synchronizedB(1, i) * LIGHT_SPEED), Math.sqrt(eps)],
      ]) {
        assert.equal(snapshot[key].length, n);
        const error = rms(actual.map((value, i) => (value - snapshot[key][i]) / amplitude));
        assert.ok(Number.isFinite(error) && error < 1e-10,
          `${c.name} n=${n} step=${snapshot.step} ${key}: Meep/CPU RMS ${error}`);
        maximumKernelError = Math.max(maximumKernelError, error);
      }
    }
    const final = c.snapshots.at(-1), omega = 2 * Math.PI / Math.sqrt(eps);
    const eError = final.Ex.map((value, i) => value - Math.cos(2 * Math.PI * c.electricPositions[i]) * Math.cos(omega * final.time));
    const bError = final.BySynchronized.map((value, i) => value / Math.sqrt(eps) - Math.sin(2 * Math.PI * c.magneticPositions[i]) * Math.sin(omega * final.time));
    const continuumError = Math.sqrt((rms(eError) ** 2 + rms(bError) ** 2) / 2);
    assert.ok(continuumError < 0.01, `${c.name} n=${n}: continuum RMS ${continuumError}`);
    results.push({ name: c.name, resolution: n, epsilon: eps, finalTime: final.time,
      maximumKernelError, continuumError });
  }
  for (const name of new Set(results.map(r => r.name))) {
    const series = results.filter(r => r.name === name).sort((a, b) => a.resolution - b.resolution);
    for (let i = 1; i < series.length; i++) {
      const ratio = series[i - 1].continuumError / series[i].continuumError;
      assert.ok(ratio > 3.8 && ratio < 4.2, `${name}: second order refinement ratio ${ratio}`);
      series[i].refinementRatio = ratio;
    }
  }
  const report = { meepVersion: fixture.meepVersion, fixture: 'tests/fixtures/maxwell/meep-periodic.json',
    kernelRmsTolerance: 1e-10, results };
  if (reportIndex !== -1) await writeFile(process.argv[reportIndex + 1], JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await server.close();
}
