import { expect, it } from 'vitest';
import { MaxwellSceneSolver } from '../../src/engine/maxwell/sceneSolver';
import { makeConductor, makeScene, makeWire } from '../../src/scene/defaults';
import { EPSILON_0, MU_0 } from '../../src/engine/maxwell/yee';
import { measureFieldBalance } from '../../src/engine/maxwell/fieldBalance';

function fedCapacitor(current = 0.01) {
  const from = makeConductor([-0.1875, 0, 0], 'box', [0.125, 0.45, 0.5]);
  const to = makeConductor([0.1875, 0, 0], 'box', [0.125, 0.45, 0.5]);
  const wire = Object.assign(makeWire([[-0.18, 0.01, 0.02], [-0.1875, -0.375, 0], [0.1875, -0.375, 0], [0.18, 0.01, 0.02]], current), {
    electricalModel: 'currentFeed' as never, terminalFeed: { from: from.id, to: to.id, riseTime: 1e-9 },
  });
  const scene = makeScene({ name: 'Explicit capacitor feed', objects: [from, to, wire] });
  Object.assign(scene.simulation, { resolution: 16, pmlCells: 4, useApproximation: false, maxwellConductorModel: 'isolated' });
  return { scene, from, to, wire };
}

it('charges only the named material terminals, produces evolved B and replays the current source', () => {
  const { scene, from, to } = fedCapacitor(), authored = JSON.stringify(scene), solver = new MaxwellSceneSolver(scene);
  solver.step(20);
  const d = solver.diagnostics() as Record<string, number>, q = 0.01 * (solver.time - 0.5e-9);
  expect(d[`bodyCharge:${from.id}`]).toBeCloseTo(-q, 22);
  expect(d[`bodyCharge:${to.id}`]).toBeCloseTo(q, 22);
  expect(d.feedTransferredCharge).toBeCloseTo(q, 22);
  const owned = (solver as any).bodyCharge as Map<string, Float64Array>;
  let residual = 0, scale = 0;
  for (let n = 0; n < solver.core.rho.length; n++) {
    const rho = [...owned.values()].reduce((sum, values) => sum + values[n], 0);
    residual = Math.max(residual, Math.abs(rho - solver.core.rho[n])); scale = Math.max(scale, Math.abs(rho));
  }
  console.log('Fed capacitor charge', JSON.stringify({ time: solver.time, expectedTransferredCharge: q, terminalChargeError: Math.abs(d[`bodyCharge:${to.id}`] / q - 1), ownedDensityResidual: residual / scale, gauss: d.gaussRelative, B: solver.sample([0, 0.0625, 0]).B, sourceWork: d.feedSourceWork }));
  expect(residual / scale).toBeLessThan(1e-12);
  expect(d.gaussRelative).toBeLessThan(1e-8);
  expect(solver.sample([0, 0.0625, 0]).Bmag).toBeGreaterThan(1e-12);
  expect(d.feedSourceWork).toBeGreaterThan(0);
  const fields = solver.sample([0, 0.0625, 0]);
  solver.reset();
  expect((solver.diagnostics() as Record<string, number>).feedTransferredCharge).toBe(0);
  solver.step(20);
  expect(solver.sample([0, 0.0625, 0])).toEqual(fields);
  expect((solver.diagnostics() as Record<string, number>).feedSourceWork).toBe(d.feedSourceWork);
  expect(JSON.stringify(scene)).toBe(authored);
});

it('accounts for the external feed work and body heat in the finite-volume field balance', () => {
  const solver = new MaxwellSceneSolver(fedCapacitor().scene); solver.step(8);
  const p = solver.meta.physical, before = solver.diagnostics() as Record<string, number>;
  const b = measureFieldBalance(solver.core, { low: [p.x0 + 1, p.y0 + 1, p.z0 + 1], high: [p.x1 - 2, p.y1 - 2, p.z1 - 2] }, () => solver.step());
  const after = solver.diagnostics() as Record<string, number>;
  console.log('Fed capacitor field balance', b.relativeResidual);
  expect(b.relativeResidual).toBeLessThan(1e-11);
  // Stationary adjoint Ohm work also needs time-centered E for exact closure;
  // the existing body heat row remains a separate numerical estimate.
  expect(after.feedSourceWork - before.feedSourceWork).toBeGreaterThan(0);
  expect(Number.isFinite(after.conductorLoss)).toBe(true);
});

it('rejects moving/missing/unresolved terminal connections instead of depositing unowned charge', () => {
  const missing = fedCapacitor(); missing.wire.terminalFeed.to = 'missing';
  expect(() => new MaxwellSceneSolver(missing.scene)).toThrow(/terminal|contact/i);
  const moving = fedCapacitor(); moving.to.motion = { kind: 'oscillate', axis: [0, 1, 0], amplitude: 0.01, frequency: 1e7 };
  expect(() => new MaxwellSceneSolver(moving.scene)).toThrow(/stationary|moving.*terminal/i);
  const unresolved = fedCapacitor(); unresolved.wire.points[0] = [0, 0, 0];
  expect(() => new MaxwellSceneSolver(unresolved.scene)).toThrow(/contact|support|terminal/i);
  const clipped = fedCapacitor(); clipped.wire.points[1] = [0, -0.6, 0];
  expect(() => new MaxwellSceneSolver(clipped.scene)).toThrow(/domain|path/i);
  const contact = fedCapacitor(); contact.scene.objects.push(makeConductor([0, -0.375, 0], 'box', [0.125, 0.125, 0.125]));
  expect(() => new MaxwellSceneSolver(contact.scene)).toThrow(/another conducting body|contact/i);
});

it('leaves neutral bodies and fields unchanged for zero feed current', () => {
  const solver = new MaxwellSceneSolver(fedCapacitor(0).scene); solver.step(10);
  expect((solver.diagnostics() as Record<string, number>).feedTransferredCharge).toBe(0);
  expect(solver.core.Ex.every(value => value === 0)).toBe(true);
  expect(solver.core.Bz.every(value => value === 0)).toBe(true);
});

it('balances magnetic circulation around both the physical return lead and the displacement-current gap', () => {
  const solver = new MaxwellSceneSolver(fedCapacitor().scene); solver.step(30);
  const s = solver.core, p = solver.meta.physical, oldE = s.Ex.slice(); solver.step();
  const surface = (y0: number, y1: number, z0: number, z1: number) => {
    const x = p.x0 + 8;
    let displacement = 0, current = 0, circulation = 0;
    for (let k = z0; k <= z1; k++) for (let j = y0; j <= y1; j++) {
      const n = s.index(x, j, k), area = s.dy * s.dz;
      displacement += EPSILON_0 * s.epsX[n] * (s.Ex[n] - oldE[n]) / s.dt * area;
      current += s.currentAtUpdate(0, n) * area;
    }
    const hz = (j: number, k: number) => { const n = s.index(x, j, k); return s.Bz[n] / (MU_0 * s.muZ[n]); };
    const hy = (j: number, k: number) => { const n = s.index(x, j, k); return s.By[n] / (MU_0 * s.muY[n]); };
    for (let k = z0; k <= z1; k++) circulation += (hz(y1, k) - hz(y0 - 1, k)) * s.dz;
    for (let j = y0; j <= y1; j++) circulation += (hy(j, z0 - 1) - hy(j, z1)) * s.dy;
    const scale = Math.abs(displacement) + Math.abs(current) + Math.abs(circulation);
    const residual = Math.abs(displacement + current - circulation) / scale;
    console.log('Fed capacitor Ampere surface', JSON.stringify({ displacement, current, circulation, residual }));
    expect(residual).toBeLessThan(1e-12);
    return { displacement, current, circulation };
  };
  const lead = surface(p.y0 + 1, p.y0 + 3, p.z0 + 7, p.z0 + 9);
  expect(lead.current).toBeCloseTo(0.01, 14);
  const gap = surface(p.y0 + 6, p.y0 + 10, p.z0 + 6, p.z0 + 10);
  expect(gap.current).toBe(0);
  expect(Math.abs(gap.displacement)).toBeGreaterThan(1e-5);
});

it('rejects a thin third body whose resolved lattice crosses the feed between geometric samples', () => {
  const { scene, wire } = fedCapacitor();
  wire.points = [[-0.18, 0.01, 0.02], [-0.18, -0.375, 0], [0.18, -0.375, 0], [0.18, 0.01, 0.02]];
  scene.objects.push(makeConductor([0.0625, -0.375, 0], 'box', [0.001, 0.125, 0.125]));
  expect(() => new MaxwellSceneSolver(scene)).toThrow(/contact|support|another conducting body/i);
});

it('halts before a moving third body enters a stationary feed current support', () => {
  const { scene } = fedCapacitor(), other = makeConductor([0, -0.125, 0], 'box', [0.0625, 0.125, 0.125]);
  other.motion = { kind: 'keyframes', loop: false, keyframes: [
    { time: 0, position: [0, 0, 0], rotation: [0, 0, 0] },
    { time: 2e-9, position: [0, -0.25, 0], rotation: [0, 0, 0] },
  ] };
  scene.objects.push(other);
  const solver = new MaxwellSceneSolver(scene);
  expect(() => solver.step(20)).toThrow(/feed.*support|contacts a terminal feed/i);
});
