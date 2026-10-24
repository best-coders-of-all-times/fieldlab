import { afterEach, expect, it, vi } from 'vitest';
import { makeCharge, makeScene } from '../src/scene/defaults';
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
