import { expect, it } from 'vitest';
import { MaxwellSceneSolver } from '../../src/engine/maxwell/sceneSolver';
import { measureFieldBalance } from '../../src/engine/maxwell/fieldBalance';
import { makeConductor, makeScene } from '../../src/scene/defaults';
import { C_LIGHT } from '../../src/engine/constants';

function stationaryConductor(cfl = 0.5) {
  const conductor = makeConductor([0, 0, 0], 'box', [0.25, 0.25, 0.25]);
  conductor.floating = true;
  conductor.netCharge = 0;
  conductor.conductivity = 0.01;
  conductor.dynamics = { mode: 'fixed', mass: 1, inertia: [1, 1, 1], velocity: [0, 0, 0], angularVelocity: [0, 0, 0] };
  const scene = makeScene({ name: 'stationary conductor heat', objects: [conductor] });
  Object.assign(scene.simulation, { resolution: 16, pmlCells: 4, cfl, useApproximation: false, maxwellConductorModel: 'isolated' });
  return new MaxwellSceneSolver(scene);
}

function injectElectricLoop(solver: MaxwellSceneSolver) {
  const s = solver.core, n = s.index(Math.floor(s.nx / 2), Math.floor(s.ny / 2), Math.floor(s.nz / 2));
  // A compact backward curl of H_z. Its backward divergence is exactly zero,
  // so the neutral constructor's rho remains valid without a source current.
  s.Ex[n] = 10; s.Ex[n + s.nx] = -10;
  s.Ey[n] = -10; s.Ey[n + 1] = 10;
}

it('matches stationary conductor heat to independently measured native current work each step', () => {
  const solver = stationaryConductor(), s = solver.core, p = solver.meta.physical;
  injectElectricLoop(solver);
  // Check Gauss directly on native differences, independently of diagnostics.
  for (let k = p.z0 + 1; k < p.z1 - 1; k++) for (let j = p.y0 + 1; j < p.y1 - 1; j++) for (let i = p.x0 + 1; i < p.x1 - 1; i++) {
    const n = s.index(i, j, k);
    expect((s.Ex[n] - s.Ex[n - 1]) / s.dx + (s.Ey[n] - s.Ey[n - s.nx]) / s.dy + (s.Ez[n] - s.Ez[n - s.nx * s.ny]) / s.dz).toBe(0);
    expect(s.rho[n]).toBe(0);
  }
  let totalWork = 0;
  for (let step = 0; step < 10; step++) {
    const previousHeat = solver.diagnostics().conductorLoss;
    const balance = measureFieldBalance(s,
      { low: [p.x0 + 1, p.y0 + 1, p.z0 + 1], high: [p.x1 - 2, p.y1 - 2, p.z1 - 2] }, () => solver.step());
    const heat = solver.diagnostics().conductorLoss - previousHeat;
    expect(Math.abs(balance.matterWork)).toBeGreaterThan(1e-20);
    expect(Math.abs(heat - balance.matterWork) / Math.abs(balance.matterWork)).toBeLessThan(1e-11);
    expect(balance.relativeResidual).toBeLessThan(1e-11);
    totalWork += balance.matterWork;
  }
  expect(totalWork).toBeGreaterThan(1e-14);
  expect(solver.diagnostics().gaussRelative).toBeLessThan(1e-12);
});

it('preserves signed negative work of an underresolved explicit-current step without clipping', () => {
  const solver = stationaryConductor(0.9), p = solver.meta.physical;
  injectElectricLoop(solver);
  const balance = measureFieldBalance(solver.core,
    { low: [p.x0 + 1, p.y0 + 1, p.z0 + 1], high: [p.x1 - 2, p.y1 - 2, p.z1 - 2] }, () => solver.step());
  expect(balance.matterWork).toBeLessThan(-1e-16);
  expect(Math.abs(solver.diagnostics().conductorLoss - balance.matterWork) / Math.abs(balance.matterWork)).toBeLessThan(1e-11);
});

it('clears accumulated conductor heat and reproduces it after reset', () => {
  const solver = stationaryConductor();
  injectElectricLoop(solver);
  solver.step(6);
  const heat = solver.diagnostics().conductorLoss, fields = solver.core.snapshot();
  expect(heat).toBeGreaterThan(1e-14);
  solver.reset();
  expect(solver.diagnostics().conductorLoss).toBe(0);
  injectElectricLoop(solver);
  solver.step(6);
  expect(solver.diagnostics().conductorLoss).toBe(heat);
  expect(solver.core.snapshot()).toEqual(fields);
});

it('averages electric and motional work at the deposited path using the new material velocity and synchronized B', () => {
  const conductor = makeConductor([0, 0, 0], 'box', [0.25, 0.25, 0.25]);
  conductor.floating = true;
  const oldSpeed = 1e6, newSpeed = 2e6, turn = 5e-11, end = 1e-8, magneticField = 1e-4;
  conductor.motion = { kind: 'keyframes', loop: false, keyframes: [
    { time: 0, position: [0, 0, 0], rotation: [0, 0, 0] },
    { time: turn, position: [oldSpeed * turn, 0, 0], rotation: [0, 0, 0] },
    { time: end, position: [oldSpeed * turn + newSpeed * (end - turn), 0, 0], rotation: [0, 0, 0] },
  ] };
  const scene = makeScene({ name: 'moving conductor heat', objects: [conductor] });
  Object.assign(scene.simulation, { resolution: 16, pmlCells: 4, useApproximation: false, maxwellConductorModel: 'isolated', externalB: [0, 0, magneticField] });
  const solver = new MaxwellSceneSolver(scene), s = solver.core;
  expect(s.dt).toBeGreaterThan(turn);
  solver.step();

  // The initial neutral, grid-aligned 5^3-node box has 100 y-directed
  // edges. Only those edges carry initial graph current: I=sigma*h*gamma
  // *(-v_x*B_z*h). Evaluate their final voltages from native arrays directly;
  // transport current is separate and must not enter conducting-edge heat.
  const h = 1 / 16, center = 12, gamma = 1 / Math.sqrt(1 - (oldSpeed / C_LIGHT) ** 2);
  const oldVoltage = -oldSpeed * magneticField * h, current = 0.01 * h * gamma * oldVoltage;
  let electricWork = 0, motionalWork = 0, oldTimeMotionalWork = 0, rawBMotionalWork = 0;
  for (let k = center - 2; k <= center + 2; k++) for (let j = center - 2; j < center + 2; j++) for (let i = center - 2; i <= center + 2; i++) {
    const n = s.index(i, j, k), newVoltage = s.Ey[n] * h;
    // B_z is half a cell displaced in x from the old y-edge midpoint.
    const newB = (s.synchronizedB(2, n - 1) + s.synchronizedB(2, n)) / 2;
    const rawB = (s.Bz[n - 1] + s.Bz[n]) / 2;
    electricWork += current * s.dt * newVoltage / 2;
    motionalWork += current * s.dt * (oldVoltage - newSpeed * newB * h) / 2;
    oldTimeMotionalWork += current * s.dt * (oldVoltage - oldSpeed * newB * h) / 2;
    rawBMotionalWork += current * s.dt * (oldVoltage - newSpeed * rawB * h) / 2;
  }
  const expected = electricWork + motionalWork;
  expect(electricWork).toBeLessThan(-1e-12);
  expect(motionalWork).toBeGreaterThan(1e-10);
  expect(Math.abs(motionalWork - oldTimeMotionalWork)).toBeGreaterThan(1e-11);
  expect(Math.abs(motionalWork - rawBMotionalWork)).toBeGreaterThan(1e-18);
  expect(Math.abs(solver.diagnostics().conductorLoss - expected) / Math.abs(expected)).toBeLessThan(1e-11);
});
