import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeCharge, makeProbe, makeScene } from '../src/scene/defaults';
import { useAppStore, idlePlaybackRuntime } from '../src/app/store';
import { SimulationController } from '../src/app/controller';
import { planPlaybackSamples } from '../src/engine/maxwell/playbackSchedule';
import { framePayloadBytes } from '../src/engine/maxwell/playbackPayload';
import type { CachedFdtdFrame } from '../src/workers/protocol';
import type { Scene } from '../src/scene/types';

let clock = 0;
let nextRaf = 1;
let rafs = new Map<number, FrameRequestCallback>();
let workers: any[] = [];

const meta = {
  nx: 16, ny: 16, nz: 16,
  physical: { x0: 4, x1: 12, y0: 4, y1: 12, z0: 4, z1: 12 },
  dx: 0.01, dy: 0.01, dz: 0.01, dt: 1e-10, cfl: 0.9,
  wavelengthCells: 10, frequency: 0,
  domainMin: [-0.5, -0.5, -0.5], domainMax: [0.5, 0.5, 0.5], pad: [4, 4, 4],
};

class WorkerMock {
  messages: any[] = [];
  onmessage: any;
  onerror: any;
  constructor() { workers.push(this); }
  postMessage(message: any) { this.messages.push(message); }
  terminate() {}
}

function playbackScene(resolution = 16): Scene {
  const scene = makeScene({ name: 'cached', objects: [makeCharge()] });
  Object.assign(scene.simulation, {
    resolution, pmlCells: 4, useApproximation: false,
    playback: {
      startTime: 0, endTime: 3e-10, sampleMode: 'count' as const,
      sampleCount: 4, sampleInterval: 1e-10, fps: 30 as const, loop: true,
    },
  });
  scene.objects.push(makeProbe([0.1, 0, 0]));
  return scene;
}

function resetStore(scene: Scene): void {
  useAppStore.setState({
    scene,
    playing: false,
    time: 0,
    status: { phase: 'idle' },
    fdtdMeta: null,
    measurements: {},
    probes: [],
    chart: { series: [], points: [] },
    error: null,
    playback: idlePlaybackRuntime(scene.simulation.playback!),
    playbackCommand: null,
  });
}

async function setup(scene: Scene) {
  workers = []; clock = 0; nextRaf = 1; rafs = new Map();
  vi.stubGlobal('Worker', WorkerMock);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextRaf++;
    rafs.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { rafs.delete(id); });
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  resetStore(scene);
  const controller = new SimulationController();
  controller.update(scene, false);
  const worker = workers[0];
  const generation = worker.messages[0].generation;
  worker.onmessage({ data: { type: 'ready', generation, meta } });
  return { controller, worker, generation };
}

function cachedFrame(index: number): CachedFdtdFrame {
  return {
    time: index * meta.dt,
    steps: index,
    slices: [],
    probes: [{
      id: 'probe', position: [0.1, 0, 0],
      sample: {
        H: [1, 2, 3], E: [4, 5, 6], B: [7, 8, 9],
        Emag: 8.8, Bmag: 13.9, epsilonR: 1, muR: 1,
      },
    }],
    energy: { electric: index + 1, magnetic: index + 2 },
    transforms: [{ id: 'charge', position: [0, 0, 0], rotation: [0, 0, 0] }],
  };
}

function finishPrecompute(worker: any, generation: number): any {
  const request = [...worker.messages].reverse().find((m: any) => m.type === 'precompute');
  const plan = planPlaybackSamples(request.plan, meta.dt);
  worker.onmessage({ data: { type: 'precompute-start', generation, requestId: request.requestId, meta, plan } });
  const frames = plan.sampleSteps.map((_, index) => cachedFrame(index));
  frames.forEach((frame, index) => worker.onmessage({
    data: {
      type: 'precompute-frame', generation, requestId: request.requestId,
      index, frame, payloadBytes: framePayloadBytes(frame),
    },
  }));
  const bytes = frames.reduce((sum, frame) => sum + framePayloadBytes(frame), 0);
  worker.onmessage({
    data: {
      type: 'precompute-done', generation, requestId: request.requestId,
      sampleCount: frames.length, steps: 3, elapsedMs: 50, sampledBytes: bytes,
    },
  });
  return { plan, frames, bytes, requestId: request.requestId };
}

function startCached(controller: SimulationController, worker: any, generation: number) {
  useAppStore.getState().requestPrecompute();
  const command = useAppStore.getState().playbackCommand!;
  controller.handlePlaybackCommand(command);
  return finishPrecompute(worker, generation);
}

function advanceRaf(ms: number): void {
  clock += ms;
  const pending = [...rafs.entries()];
  rafs.clear();
  for (const [, cb] of pending) cb(clock);
}

beforeEach(() => { vi.useRealTimers(); });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAppStore.setState({ playback: idlePlaybackRuntime(playbackScene().simulation.playback!), playbackCommand: null });
});

it('drives idle to computing to cached and applies cached frames without chart growth', async () => {
  const scene = playbackScene();
  const { controller, worker, generation } = await setup(scene);
  const { plan, bytes, frames } = startCached(controller, worker, generation);
  const state = useAppStore.getState();
  expect(state.playback.mode).toBe('cached');
  expect(state.playback.frameCount).toBe(4);
  expect(state.playback.frameIndex).toBe(0);
  expect(state.playback.bytes).toBe(bytes);
  expect(state.playback.sampleTimes).toEqual(plan.sampleTimes);
  expect(state.time).toBe(0);
  expect(state.status.phase).toBe('ready');
  expect(state.probes[0].Emag).toBe(frames[0].probes[0].sample.Emag);
  expect(state.chart.points).toHaveLength(4);
  controller.dispose();
});

it('plays, pauses, steps and seeks cached frames', async () => {
  const scene = playbackScene();
  const { controller, worker, generation } = await setup(scene);
  startCached(controller, worker, generation);
  useAppStore.getState().setPlaying(true);
  controller.update(scene, true);
  advanceRaf(1000 / 30);
  expect(useAppStore.getState().playback.frameIndex).toBe(1);
  expect(useAppStore.getState().time).toBeCloseTo(meta.dt, 18);
  useAppStore.getState().setPlaying(false);
  controller.update(scene, false);
  controller.step();
  expect(useAppStore.getState().playback.frameIndex).toBe(2);
  expect(useAppStore.getState().playing).toBe(false);
  controller.handlePlaybackCommand({ serial: 9, kind: 'seek', index: 0 });
  expect(useAppStore.getState().playback.frameIndex).toBe(0);
  expect(useAppStore.getState().time).toBe(0);
  expect(useAppStore.getState().playing).toBe(false);
  controller.dispose();
});

it('rewind and replay seek the cache instead of restarting the solver', async () => {
  const scene = playbackScene();
  const { controller, worker, generation } = await setup(scene);
  startCached(controller, worker, generation);
  controller.handlePlaybackCommand({ serial: 5, kind: 'seek', index: 3 });
  expect(useAppStore.getState().playback.frameIndex).toBe(3);
  useAppStore.getState().rewindSimulation();
  controller.handlePlaybackCommand(useAppStore.getState().playbackCommand!);
  expect(workers).toHaveLength(1);
  expect(useAppStore.getState().playback.frameIndex).toBe(0);
  expect(useAppStore.getState().playing).toBe(false);
  useAppStore.getState().replaySimulation();
  controller.update(scene, true);
  controller.handlePlaybackCommand(useAppStore.getState().playbackCommand!);
  expect(useAppStore.getState().playback.frameIndex).toBe(0);
  expect(useAppStore.getState().playing).toBe(true);
  controller.dispose();
});

it('returns to live and rebuilds the worker', async () => {
  const scene = playbackScene();
  const { controller, worker, generation } = await setup(scene);
  startCached(controller, worker, generation);
  useAppStore.getState().exitPlayback();
  controller.handlePlaybackCommand(useAppStore.getState().playbackCommand!);
  expect(useAppStore.getState().playback.mode).toBe('idle');
  expect(useAppStore.getState().time).toBe(0);
  expect(useAppStore.getState().probes).toEqual([]);
  expect(workers).toHaveLength(2);
  expect(workers[1].messages[0].type).toBe('init');
  controller.dispose();
});

it('discards the cache immediately when physics or display editing begins', async () => {
  vi.useFakeTimers();
  const scene = playbackScene();
  const { controller, worker, generation } = await setup(scene);
  startCached(controller, worker, generation);
  const edited = {
    ...scene,
    objects: [{ ...scene.objects[0], position: [0.1, 0, 0] as [number, number, number] }, scene.objects[1]],
  };
  controller.update(edited, false);
  expect(useAppStore.getState().playback.mode).toBe('idle');
  expect(worker.messages.at(-1).type).toBe('pause');
  vi.advanceTimersByTime(170);
  expect(workers).toHaveLength(2);
  controller.dispose();
});

it('locks structural, display and physics edits while cached or computing', async () => {
  const scene = playbackScene();
  const { controller, worker, generation } = await setup(scene);
  useAppStore.getState().requestPrecompute();
  controller.handlePlaybackCommand(useAppStore.getState().playbackCommand!);
  const store = useAppStore.getState();
  const before = store.scene;
  store.setDisplay({ sliceResolution: 32 });
  store.updateObject(scene.objects[0].id, { position: [1, 2, 3] });
  store.addObject(makeProbe([0, 0, 0]));
  store.undo();
  store.setGizmoMode('rotate');
  store.setSimulation({ resolution: 32 });
  expect(useAppStore.getState().scene).toBe(before);
  expect(useAppStore.getState().gizmoMode).toBe('translate');
  store.updatePlaybackSettings({ fps: 60 });
  expect(useAppStore.getState().scene.simulation.playback?.fps).toBe(60);
  store.updatePlaybackSettings({ startTime: 1e-10 });
  expect(useAppStore.getState().scene.simulation.playback?.startTime).toBe(0);
  store.cancelPlayback();
  controller.handlePlaybackCommand(useAppStore.getState().playbackCommand!);
  expect(useAppStore.getState().playback.mode).toBe('idle');
  controller.dispose();
});

it('rejects an over-cap preflight before posting a precompute request', async () => {
  const scene = playbackScene(64);
  scene.display.sliceResolution = 256;
  scene.display.slices = { xy: true, xz: true, yz: true };
  scene.simulation.playback = {
    ...scene.simulation.playback!, sampleCount: 1200, endTime: 1e-7,
  };
  const { controller, worker } = await setup(scene);
  useAppStore.getState().requestPrecompute();
  controller.handlePlaybackCommand(useAppStore.getState().playbackCommand!);
  expect(useAppStore.getState().error).toMatch(/cache limit/);
  expect(worker.messages.some((m: any) => m.type === 'precompute')).toBe(false);
  expect(useAppStore.getState().playback.mode).toBe('idle');
  controller.dispose();
});

it('returns to live and reports a cache inconsistency on a bad done message', async () => {
  const scene = playbackScene();
  const { controller, worker, generation } = await setup(scene);
  const request = (() => {
    useAppStore.getState().requestPrecompute();
    controller.handlePlaybackCommand(useAppStore.getState().playbackCommand!);
    return [...worker.messages].reverse().find((m: any) => m.type === 'precompute');
  })();
  const plan = planPlaybackSamples(request.plan, meta.dt);
  worker.onmessage({ data: { type: 'precompute-start', generation, requestId: request.requestId, meta, plan } });
  worker.onmessage({
    data: {
      type: 'precompute-done', generation, requestId: request.requestId,
      sampleCount: 4, steps: 3, elapsedMs: 1, sampledBytes: 0,
    },
  });
  expect(useAppStore.getState().error).toMatch(/inconsistent/);
  expect(useAppStore.getState().playback.mode).toBe('idle');
  expect(workers).toHaveLength(2);
  controller.dispose();
});
