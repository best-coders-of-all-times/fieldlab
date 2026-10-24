import { afterEach, expect, it, vi } from 'vitest';
import { makeCharge, makeScene, makeLoop, makeDielectric, makeWire } from '../src/scene/defaults';
import { useAppStore } from '../src/app/store';
import { SimulationController } from '../src/app/controller';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('invalidates old Maxwell replies immediately while expensive edits are debounced', () => {
  vi.useFakeTimers();
  const workers: any[] = [];
  class WorkerMock {
    messages: any[] = []; onmessage: any; onerror: any;
    constructor() { workers.push(this); }
    postMessage(m: unknown) { this.messages.push(m); }
    terminate() {}
  }
  vi.stubGlobal('Worker', WorkerMock);
  const scene = makeScene({ name: 'editing', objects: [makeCharge()] });
  scene.simulation.useApproximation = false;
  const controller = new SimulationController();
  controller.update(scene, true);
  const old = workers[0], generation = old.messages[0].generation;
  useAppStore.getState().setTime(0);
  controller.update({ ...scene, objects: [{ ...scene.objects[0], position: [0.1, 0, 0] }] }, true);
  expect(old.messages.at(-1).type).toBe('pause');
  old.onmessage({ data: { type: 'frame', generation, time: 10 } });
  expect(useAppStore.getState().time).toBe(0);
  vi.advanceTimersByTime(170);
  expect(workers).toHaveLength(2);
  expect(workers[1].messages[0].scene.objects[0].position).toEqual([0.1, 0, 0]);
  controller.dispose();
});

it('reports unsupported passive material in approximation mode without using impressed current', () => {
  const loop = makeLoop(); loop.electricalModel = 'conducting';
  const scene = makeScene({ name: 'passive', objects: [loop] });
  const workers: unknown[] = [];
  vi.stubGlobal('Worker', class { constructor() { workers.push(this); } postMessage() {} terminate() {} });
  const controller = new SimulationController(); controller.update(scene, false);
  expect(useAppStore.getState().status.phase).toBe('error');
  expect(useAppStore.getState().status.message).toMatch(/passive|Maxwell/i);
  expect(workers).toHaveLength(0);
  controller.dispose();
});

it('rejects Drude material in approximation mode rather than silently using epsilon infinity', () => {
  const material = Object.assign(makeDielectric(), { materialModel: 'drude', drude: { omegaP: 1e9, gamma: 1e8 } });
  const scene = makeScene({ name: 'dispersive', objects: [material] });
  const workers: unknown[] = [];
  vi.stubGlobal('Worker', class { constructor() { workers.push(this); } postMessage() {} terminate() {} });
  const controller = new SimulationController(); controller.update(scene, false);
  expect(useAppStore.getState().status.phase).toBe('error');
  expect(useAppStore.getState().status.message).toMatch(/Drude|dispers/i);
  expect(workers).toHaveLength(0); controller.dispose();
});

it('requires Maxwell mode for a saved terminal current feed', () => {
  const wire = Object.assign(makeWire(), { electricalModel: 'currentFeed' as never, terminalFeed: { from: 'a', to: 'b', riseTime: 1e-9 } });
  const scene = makeScene({ name: 'fed', objects: [wire] });
  const workers: unknown[] = [];
  vi.stubGlobal('Worker', class { constructor() { workers.push(this); } postMessage() {} terminate() {} });
  const controller = new SimulationController(); controller.update(scene, false);
  expect(useAppStore.getState().status.phase).toBe('error');
  expect(useAppStore.getState().status.message).toMatch(/terminal|feed/i);
  expect(workers).toHaveLength(0); controller.dispose();
});
