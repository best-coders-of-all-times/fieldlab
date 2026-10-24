import { afterEach, expect, it, vi } from 'vitest';
import { makeScene, makeProbe } from '../src/scene/defaults';

afterEach(() => vi.unstubAllGlobals());

it('updates paused wave probes and display without advancing time', async () => {
  const replies: any[] = [];
  const context = { postMessage: (m: unknown) => replies.push(m), onmessage: null as any };
  vi.stubGlobal('self', context);
  vi.resetModules();
  await import('../src/workers/fdtd.worker');
  const scene = makeScene({ name: 'paused waves', mode: 'waves' });
  scene.simulation.resolution = 48;
  scene.display.slices = { xy: false, xz: false, yz: false };
  scene.display.arrows = 'none';
  context.onmessage({ data: { type: 'init', generation: 1, scene } });
  const probe = makeProbe([0.1, 0.2, 0.3]);
  context.onmessage({ data: { type: 'config', generation: 1, scene: { ...scene, objects: [probe] } } });
  expect(replies.at(-1).type).toBe('frame');
  expect(replies.at(-1).time).toBe(0);
  expect(replies.at(-1).probes[0].id).toBe(probe.id);
  expect(replies.at(-1).probes[0].position).toEqual([0.1, 0.2, 0.3]);
});

it('stops Maxwell batches at a physical target and can extend it without rebuilding fields', async () => {
  const replies: any[] = [], scheduled: (() => void)[] = [];
  const context = { postMessage: (m: unknown) => replies.push(m), onmessage: null as any, setTimeout: (f: () => void) => { scheduled.push(f); return scheduled.length; } };
  vi.stubGlobal('self', context); vi.resetModules(); await import('../src/workers/fdtd.worker');
  const scene = makeScene({ name: 'target' });
  Object.assign(scene.simulation, { resolution: 16, pmlCells: 4, useApproximation: false, stepsPerFrame: 12 });
  Object.assign(scene.display, { fieldLines: 'none', arrows: 'none', slices: { xy: false, xz: false, yz: false } });
  const send = (data: any) => context.onmessage({ data });
  send({ type: 'init', generation: 2, scene });
  const dt = replies.find(r => r.type === 'ready').meta.dt;
  scene.simulation.targetTime = 2.5 * dt;
  send({ type: 'config', generation: 2, scene }); send({ type: 'start' });
  scheduled.shift()!();
  expect(replies.at(-1)).toMatchObject({ type: 'frame', steps: 3, targetReached: true });
  expect(scheduled).toHaveLength(0);
  send({ type: 'singleStep' }); expect(replies.at(-1).steps).toBe(3);
  scene.simulation.targetTime = 5 * dt; send({ type: 'config', generation: 2, scene });
  expect(replies.at(-1)).toMatchObject({ steps: 3, targetReached: false });
  send({ type: 'singleStep' }); expect(replies.at(-1)).toMatchObject({ steps: 5, targetReached: true });
  send({ type: 'reset' }); expect(replies.at(-1)).toMatchObject({ steps: 0, targetReached: false });
  send({ type: 'singleStep' }); expect(replies.at(-1)).toMatchObject({ steps: 5, targetReached: true });
});

it('validates zero/invalid Maxwell targets while retaining legacy approximation pacing', async () => {
  const replies: any[] = [], context = { postMessage: (m: unknown) => replies.push(m), onmessage: null as any };
  vi.stubGlobal('self', context); vi.resetModules(); await import('../src/workers/fdtd.worker');
  const scene = makeScene({ name: 'zero target' });
  Object.assign(scene.simulation, { resolution: 16, pmlCells: 4, useApproximation: false, targetTime: 0 });
  Object.assign(scene.display, { fieldLines: 'none', arrows: 'none', slices: { xy: false, xz: false, yz: false } });
  const send = (data: any) => context.onmessage({ data }); send({ type: 'init', generation: 4, scene });
  expect(replies.at(-1)).toMatchObject({ type: 'frame', steps: 0, targetReached: true });
  send({ type: 'singleStep' }); expect(replies.at(-1).steps).toBe(0);
  scene.simulation.targetTime = -1; send({ type: 'config', generation: 4, scene });
  expect(replies.at(-1)).toMatchObject({ type: 'error', generation: 4 });
  scene.mode = 'waves'; scene.simulation.useApproximation = true; scene.simulation.targetTime = 0; scene.simulation.resolution = 48;
  send({ type: 'init', generation: 5, scene }); send({ type: 'singleStep' });
  expect(replies.at(-1).steps).toBe(2); expect(replies.at(-1).targetReached).toBeUndefined();
});
