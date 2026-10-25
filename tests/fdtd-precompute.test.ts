import { afterEach, expect, it, vi } from 'vitest';
import { makePointSource, makeProbe, makeScene } from '../src/scene/defaults';
import { MaxwellSceneSolver } from '../src/engine/maxwell/sceneSolver';
import type { Scene } from '../src/scene/types';

afterEach(() => vi.unstubAllGlobals());

interface WorkerHarness {
  replies: any[];
  scheduled: Array<() => void>;
  send: (data: any) => void;
  drain: (limit?: number) => void;
}

async function harness(scene: Scene): Promise<WorkerHarness> {
  const replies: any[] = [], scheduled: Array<() => void> = [];
  const context = {
    postMessage: (m: unknown) => replies.push(m),
    onmessage: null as any,
    setTimeout: (f: () => void) => { scheduled.push(f); return scheduled.length; },
  };
  vi.stubGlobal('self', context);
  vi.resetModules();
  await import('../src/workers/fdtd.worker');
  const send = (data: any) => context.onmessage({ data });
  send({ type: 'init', generation: 1, scene });
  return {
    replies,
    scheduled,
    send,
    drain(limit = 20000) {
      let calls = 0;
      while (scheduled.length > 0) {
        scheduled.shift()!();
        if (++calls > limit) throw new Error('worker schedule did not settle');
      }
    },
  };
}

function precomputeScene(): Scene {
  const scene = makeScene({ name: 'precompute' });
  Object.assign(scene.simulation, {
    resolution: 16, pmlCells: 4, useApproximation: false, stepsPerFrame: 2,
  });
  Object.assign(scene.display, {
    fieldLines: 'none', arrows: 'none', slices: { xy: false, xz: false, yz: false },
  });
  scene.objects.push(makePointSource([0, 0, 0]), makeProbe([0.1, 0.1, 0.1]));
  return scene;
}

function frames(replies: any[]): any[] {
  return replies.filter((r) => r.type === 'precompute-frame');
}

it('caches reduced frames at the planned solver steps', async () => {
  const scene = precomputeScene();
  const direct = new MaxwellSceneSolver(structuredClone(scene));
  const dt = direct.meta.dt;
  const h = await harness(scene);
  h.send({
    type: 'precompute', generation: 1, requestId: 7,
    plan: { startTime: 2 * dt, endTime: 8 * dt, sampleMode: 'count', sampleCount: 4 },
  });
  h.drain();
  const start = h.replies.find((r) => r.type === 'precompute-start');
  expect(start.plan.sampleSteps).toEqual([2, 4, 6, 8]);
  expect(start.plan.sampleTimes.map((t: number) => t / dt)).toEqual([2, 4, 6, 8]);
  const cached = frames(h.replies);
  expect(cached.map((f) => f.index)).toEqual([0, 1, 2, 3]);
  expect(cached.map((f) => f.frame.steps)).toEqual([2, 4, 6, 8]);
  for (const entry of cached) {
    expect(entry.frame.time).toBeCloseTo(entry.frame.steps * dt, 18);
    expect(entry.frame.diagnostics).toBeUndefined();
    expect(entry.frame.targetReached).toBeUndefined();
    expect(entry.frame.meta).toBeUndefined();
    while (direct.steps < entry.frame.steps) direct.step(1);
    const expected = direct.sample([0.1, 0.1, 0.1]);
    const actual = entry.frame.probes[0].sample;
    expect(actual.Emag).toBeCloseTo(expected.Emag, 12);
    expect(actual.Bmag).toBeCloseTo(expected.Bmag, 12);
    expect(actual.E[0]).toBeCloseTo(expected.E[0], 12);
    expect(actual.B[2]).toBeCloseTo(expected.B[2], 12);
    expect(entry.payloadBytes).toBeGreaterThan(0);
  }
  const done = h.replies.find((r) => r.type === 'precompute-done');
  expect(done).toMatchObject({ sampleCount: 4, steps: 8 });
  expect(done.sampledBytes).toBe(cached.reduce((sum, f) => sum + f.payloadBytes, 0));
  expect(h.replies.some((r) => r.type === 'error')).toBe(false);
});

it('caches the zero-step state when the window starts at t = 0', async () => {
  const scene = precomputeScene();
  const dt = new MaxwellSceneSolver(structuredClone(scene)).meta.dt;
  const h = await harness(scene);
  h.send({
    type: 'precompute', generation: 1, requestId: 2,
    plan: { startTime: 0, endTime: 2 * dt, sampleMode: 'count', sampleCount: 3 },
  });
  h.drain();
  const cached = frames(h.replies);
  expect(cached.map((f) => f.frame.steps)).toEqual([0, 1, 2]);
  expect(cached[0].frame.time).toBe(0);
  expect(cached[0].frame.energy).toEqual({ electric: 0, magnetic: 0 });
});

it('warms up from step zero before the first cached sample', async () => {
  const scene = precomputeScene();
  const dt = new MaxwellSceneSolver(structuredClone(scene)).meta.dt;
  const h = await harness(scene);
  h.send({
    type: 'precompute', generation: 1, requestId: 3,
    plan: { startTime: 3 * dt, endTime: 5 * dt, sampleMode: 'count', sampleCount: 3 },
  });
  h.drain();
  const cached = frames(h.replies);
  expect(cached.map((f) => f.frame.steps)).toEqual([3, 4, 5]);
  const progress = h.replies.filter((r) => r.type === 'precompute-progress');
  expect(progress.some((r) => r.phase === 'warmup')).toBe(true);
  expect(progress.some((r) => r.phase === 'sampling')).toBe(true);
  expect(h.replies.find((r) => r.type === 'precompute-start').plan.warmupSteps).toBe(3);
});

it('stops future frames after cancellation', async () => {
  const scene = precomputeScene();
  const dt = new MaxwellSceneSolver(structuredClone(scene)).meta.dt;
  const h = await harness(scene);
  h.send({
    type: 'precompute', generation: 1, requestId: 11,
    plan: { startTime: 0, endTime: 5000 * dt, sampleMode: 'count', sampleCount: 2 },
  });
  h.scheduled.shift()!();
  expect(frames(h.replies).length).toBe(1);
  h.send({ type: 'precompute-cancel', generation: 1, requestId: 11 });
  expect(h.replies.find((r) => r.type === 'precompute-cancelled')).toBeTruthy();
  h.drain();
  expect(frames(h.replies)).toHaveLength(1);
  expect(h.replies.some((r) => r.type === 'precompute-done')).toBe(false);
});

it('drops stale precompute ticks after a new generation', async () => {
  const scene = precomputeScene();
  const dt = new MaxwellSceneSolver(structuredClone(scene)).meta.dt;
  const h = await harness(scene);
  h.send({
    type: 'precompute', generation: 1, requestId: 12,
    plan: { startTime: 0, endTime: 5000 * dt, sampleMode: 'count', sampleCount: 2 },
  });
  h.scheduled.shift()!();
  const before = frames(h.replies).length;
  h.send({ type: 'init', generation: 2, scene: { ...scene, name: 'replacement' } });
  h.drain();
  expect(frames(h.replies)).toHaveLength(before);
  expect(h.replies.filter((r) => r.type === 'precompute-done')).toHaveLength(0);
});

it('rejects legacy and approximation solvers', async () => {
  const scene = precomputeScene();
  scene.simulation.useApproximation = true;
  const h = await harness(scene);
  h.send({
    type: 'precompute', generation: 1, requestId: 13,
    plan: { startTime: 0, endTime: 1e-10, sampleMode: 'count', sampleCount: 2 },
  });
  const error = h.replies.find((r) => r.type === 'error');
  expect(error?.message).toMatch(/full Maxwell/);
  h.drain();
  expect(frames(h.replies)).toHaveLength(0);
});

it('ignores live transport and config while precomputing', async () => {
  const scene = precomputeScene();
  const dt = new MaxwellSceneSolver(structuredClone(scene)).meta.dt;
  const h = await harness(scene);
  h.send({
    type: 'precompute', generation: 1, requestId: 14,
    plan: { startTime: 0, endTime: 6 * dt, sampleMode: 'count', sampleCount: 4 },
  });
  h.send({ type: 'start' });
  h.send({ type: 'config', generation: 1, scene: { ...scene, name: 'changed' } });
  h.send({ type: 'singleStep' });
  h.drain();
  expect(frames(h.replies).map((f) => f.frame.steps)).toEqual([0, 2, 4, 6]);
  expect(h.replies.filter((r) => r.type === 'frame')).toHaveLength(1);
  expect(h.replies.find((r) => r.type === 'precompute-done').sampleCount).toBe(4);
});
