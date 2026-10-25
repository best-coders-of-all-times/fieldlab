/// <reference lib="webworker" />
import { FdtdSolver } from '../engine/fdtd/fdtd3d';
import { MaxwellSceneSolver } from '../engine/maxwell/sceneSolver';
import { maxwellRunBudget } from '../engine/maxwell/runBudget';
import {
  planPlaybackSamples,
  type PlaybackPlan,
  type PlaybackPlanInput,
} from '../engine/maxwell/playbackSchedule';
import { framePayloadBytes } from '../engine/maxwell/playbackPayload';
import type {
  CachedFdtdFrame,
  FdtdFrame,
  FdtdRequest,
  FdtdResponse,
  WaveSlice,
} from './protocol';
import type { Scene, SliceQuantity } from '../scene/types';
import { isProbe } from '../scene/types';

interface WorkerCtx {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<FdtdRequest>) => void) | null;
  setTimeout(handler: () => void, timeout?: number): number;
}

const ctx = self as unknown as WorkerCtx;

let solver: FdtdSolver | MaxwellSceneSolver | null = null;
let scene: Scene | null = null;
let generation = -1;
let running = false;
let scheduled = false;

interface PrecomputeState {
  requestId: number;
  plan: PlaybackPlan;
  index: number;
  startedAt: number;
  lastProgressAt: number;
  sampledBytes: number;
}
let precompute: PrecomputeState | null = null;

function post(message: FdtdResponse, transfer?: Transferable[]): void {
  ctx.postMessage(message, transfer);
}

function requestFrame(): void {
  if (!running || scheduled || !solver) return;
  scheduled = true;
  const requestedGeneration = generation;
  ctx.setTimeout(() => { if (generation === requestedGeneration) tick(); }, 0);
}

function frameTransfers(frame: Pick<FdtdFrame, 'slices' | 'lattice' | 'lines'>): Transferable[] {
  const transfer: Transferable[] = [];
  for (const slice of frame.slices) transfer.push(slice.data.buffer);
  if (frame.lattice) transfer.push(frame.lattice.positions.buffer, frame.lattice.vectors.buffer, frame.lattice.magnitudes.buffer);
  for (const line of frame.lines?.lines ?? []) transfer.push(line.points.buffer, line.magnitudes.buffer);
  return transfer;
}

function publishFrame(): void {
  const frame = buildFrame();
  post(frame, frameTransfers(frame));
}

function tick(): void {
  scheduled = false;
  if (!running || !solver || !scene) return;
  try {
    advanceRequestedBatch();
    publishFrame();
  } catch (err) {
    running = false;
    post({
      type: 'error',
      generation,
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  requestFrame();
}

function targetBudget() {
  if (!(solver instanceof MaxwellSceneSolver) || !scene) return undefined;
  return maxwellRunBudget(solver.meta.dt, solver.steps, scene.simulation.targetTime, scene.simulation.stepsPerFrame);
}

function advanceRequestedBatch() {
  if (!solver || !scene) return;
  const count = targetBudget()?.stepsThisBatch ?? Math.max(1, Math.min(20, Math.floor(scene.simulation.stepsPerFrame) || 1));
  if (count > 0) solver.step(count);
  if (targetBudget()?.reached) running = false;
}

function sliceQuantity(scene: Scene): SliceQuantity {
  return scene.display.sliceQuantity === 'phi' ? 'Emag' : scene.display.sliceQuantity;
}

function buildFrame(forCache = false): FdtdFrame {
  const started = performance.now();
  const s = solver!;
  const sc = scene!;
  const slices: WaveSlice[] = [];
  const q = sliceQuantity(sc);
  const addSlice = (axis: 'x' | 'y' | 'z', position: number) => {
    const data = s.sampleSlice(axis, position, q, sc.display.sliceResolution);
    slices.push({
      axis, position, quantity: q, resolution: sc.display.sliceResolution,
      data: data.data, min: data.min, max: data.max,
    });
  };
  if (sc.display.slices.xy) addSlice('z', sc.display.slicePositions.z);
  if (sc.display.slices.xz) addSlice('y', sc.display.slicePositions.y);
  if (sc.display.slices.yz) addSlice('x', sc.display.slicePositions.x);
  let lattice: FdtdFrame['lattice'];
  if (sc.display.arrows !== 'none') {
    const field = sc.display.arrows === 'P' ? 'P' : sc.display.arrows;
    const l = s.sampleLattice(sc.display.arrowDensity, field);
    lattice = { ...l, field };
  }
  const probes = sc.objects
    .filter(isProbe)
    .filter(p => p.visible)
    .map((p) => {
      const position = s instanceof MaxwellSceneSolver ? s.pose(p).position : p.position;
      return { id: p.id, position, sample: s.sample(position) };
    });
  const maxwell = s instanceof MaxwellSceneSolver;
  // Cached frames are a reduced display payload. Full diagnostics are only
  // meaningful for the live state and would waste cache memory.
  const diagnostics: Record<string, number> | undefined = maxwell && !forCache ? s.diagnostics() : undefined;
  const frame = {
    type: 'frame',
    generation,
    time: s.time,
    steps: s.steps,
    ...(forCache ? {} : { meta: s.meta }),
    slices,
    lattice,
    probes,
    energy: diagnostics
      ? { electric: diagnostics.electricEnergy, magnetic: diagnostics.magneticEnergy }
      : s.energy(),
    ...(maxwell ? {
      transforms: s.poses(),
      lines: sc.display.fieldLines === 'none' ? undefined : { field: sc.display.fieldLines, lines: s.fieldLines(sc.display.fieldLines, sc.display.lineCount) },
      ...(forCache ? {} : { diagnostics, targetReached: targetBudget()?.reached }),
    } : {}),
  } as FdtdFrame;
  if (diagnostics) diagnostics.samplingMs = performance.now() - started;
  return frame;
}

function startPrecompute(msg: Extract<FdtdRequest, { type: 'precompute' }>): void {
  if (!scene || scene.simulation.useApproximation !== false || !(solver instanceof MaxwellSceneSolver)) {
    throw new Error('Cached playback requires the full Maxwell scene solver.');
  }
  if (precompute) throw new Error('A cached precompute is already running.');
  running = false;
  solver.reset();
  if (solver.steps !== 0 || solver.time !== 0) throw new Error('The Maxwell solver did not return to its initial state.');
  const plan = planPlaybackSamples(msg.plan, solver.meta.dt);
  const state: PrecomputeState = {
    requestId: msg.requestId,
    plan,
    index: 0,
    startedAt: performance.now(),
    lastProgressAt: 0,
    sampledBytes: 0,
  };
  precompute = state;
  post({ type: 'precompute-start', generation, requestId: msg.requestId, meta: solver.meta, plan });
  postPrecomputeProgress(state, true);
  const requestedGeneration = generation;
  ctx.setTimeout(() => precomputeTick(state, requestedGeneration), 0);
}

function postPrecomputeProgress(state: PrecomputeState, force: boolean): void {
  if (!solver) return;
  const now = performance.now(), elapsedMs = Math.max(0, now - state.startedAt);
  if (!force && now - state.lastProgressAt < 100) return;
  state.lastProgressAt = now;
  post({
    type: 'precompute-progress',
    generation,
    requestId: state.requestId,
    phase: solver.steps < state.plan.startStep ? 'warmup' : 'sampling',
    steps: solver.steps,
    totalSteps: state.plan.totalSteps,
    sampleIndex: state.index,
    sampleCount: state.plan.sampleSteps.length,
    elapsedMs,
    stepsPerSecond: elapsedMs > 0 ? solver.steps / (elapsedMs / 1000) : 0,
    sampledBytes: state.sampledBytes,
  });
}

function precomputeTick(state: PrecomputeState, requestedGeneration: number): void {
  if (precompute !== state || generation !== requestedGeneration || !solver || !scene) return;
  try {
    const target = state.plan.sampleSteps[state.index];
    if (solver.steps > target) throw new Error('The precompute plan fell behind the solver state.');
    const chunkStart = performance.now();
    while (solver.steps < target) {
      solver.step(1);
      // Yield between field steps so progress and cancellation stay responsive
      // even when one coarse-grid step takes a substantial fraction of a second.
      if (performance.now() - chunkStart > 20) break;
    }
    if (solver.steps === target) {
      const frame = buildFrame(true);
      const cached = frame as CachedFdtdFrame;
      const payloadBytes = framePayloadBytes(cached);
      post({
        type: 'precompute-frame',
        generation,
        requestId: state.requestId,
        index: state.index,
        frame: cached,
        payloadBytes,
      }, frameTransfers(frame));
      state.index++;
      state.sampledBytes += payloadBytes;
      postPrecomputeProgress(state, true);
    } else {
      postPrecomputeProgress(state, false);
    }
    if (state.index >= state.plan.sampleSteps.length) {
      const elapsedMs = Math.max(0, performance.now() - state.startedAt);
      post({
        type: 'precompute-done',
        generation,
        requestId: state.requestId,
        sampleCount: state.plan.sampleSteps.length,
        steps: solver.steps,
        elapsedMs,
        sampledBytes: state.sampledBytes,
      });
      precompute = null;
      return;
    }
    ctx.setTimeout(() => precomputeTick(state, requestedGeneration), 0);
  } catch (err) {
    precompute = null;
    running = false;
    post({
      type: 'error',
      generation,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function cancelPrecompute(msg: Extract<FdtdRequest, { type: 'precompute-cancel' }>): void {
  if (!precompute || precompute.requestId !== msg.requestId) return;
  precompute = null;
  post({
    type: 'precompute-cancelled',
    generation,
    requestId: msg.requestId,
    steps: solver?.steps ?? 0,
  });
}

function init(msg: Extract<FdtdRequest, { type: 'init' }>): void {
  generation = msg.generation;
  scene = msg.scene;
  running = false;
  scheduled = false;
  precompute = null;
  solver = msg.scene.simulation.useApproximation === false ? new MaxwellSceneSolver(msg.scene) : new FdtdSolver(msg.scene);
  post({ type: 'ready', generation, meta: solver.meta });
  publishFrame();
}

ctx.onmessage = (event: MessageEvent<FdtdRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === 'init') {
      init(msg);
      return;
    }
    if (!solver) return;
    if ('generation' in msg && msg.generation !== generation) return;
    if (msg.type === 'precompute') {
      startPrecompute(msg);
      return;
    }
    if (msg.type === 'precompute-cancel') {
      cancelPrecompute(msg);
      return;
    }
    // While precomputing, live transport and display/config messages are
    // ignored. Only cancellation, re-init and generation invalidation apply.
    if (precompute) return;
    if (msg.type === 'config') {
      if (solver instanceof MaxwellSceneSolver) maxwellRunBudget(solver.meta.dt, solver.steps, msg.scene.simulation.targetTime, msg.scene.simulation.stepsPerFrame);
      scene = msg.scene;
      if (solver instanceof MaxwellSceneSolver) solver.scene.display = scene.display;
      if (!running) publishFrame();
      return;
    }
    if (msg.type === 'start') {
      running = true;
      requestFrame();
      return;
    }
    if (msg.type === 'pause') {
      running = false;
      return;
    }
    if (msg.type === 'reset') {
      solver.reset();
      if (scene) publishFrame();
      return;
    }
    if (msg.type === 'singleStep') {
      if (scene) {
        advanceRequestedBatch();
        publishFrame();
      }
    }
  } catch (err) {
    running = false;
    post({
      type: 'error',
      generation,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
