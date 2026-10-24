/// <reference lib="webworker" />
import { FdtdSolver } from '../engine/fdtd/fdtd3d';
import type { FdtdFrame, FdtdRequest, FdtdResponse, WaveSlice } from './protocol';
import type { Scene, SliceQuantity } from '../scene/types';
import { isProbe } from '../scene/types';

interface WorkerCtx {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<FdtdRequest>) => void) | null;
  setTimeout(handler: () => void, timeout?: number): number;
}

const ctx = self as unknown as WorkerCtx;

let solver: FdtdSolver | null = null;
let scene: Scene | null = null;
let generation = -1;
let running = false;
let scheduled = false;

function post(message: FdtdResponse, transfer?: Transferable[]): void {
  ctx.postMessage(message, transfer);
}

function requestFrame(): void {
  if (!running || scheduled || !solver) return;
  scheduled = true;
  ctx.setTimeout(tick, 0);
}

function tick(): void {
  scheduled = false;
  if (!running || !solver || !scene) return;
  try {
    const steps = Math.max(1, Math.min(20, scene.simulation.stepsPerFrame));
    solver.step(steps);
    const frame = buildFrame();
    const transfer: Transferable[] = [];
    for (const s of frame.slices) transfer.push(s.data.buffer);
    if (frame.lattice) {
      transfer.push(
        frame.lattice.positions.buffer,
        frame.lattice.vectors.buffer,
        frame.lattice.magnitudes.buffer,
      );
    }
    post(frame, transfer);
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

function sliceQuantity(scene: Scene): SliceQuantity {
  return scene.display.sliceQuantity === 'phi' ? 'Emag' : scene.display.sliceQuantity;
}

function buildFrame(): FdtdFrame {
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
    .map((p) => ({ id: p.id, position: p.position, sample: s.sample(p.position) }));
  return {
    type: 'frame',
    generation,
    time: s.time,
    steps: s.steps,
    meta: s.meta,
    slices,
    lattice,
    probes,
    energy: s.energy(),
  };
}

function init(msg: Extract<FdtdRequest, { type: 'init' }>): void {
  generation = msg.generation;
  scene = msg.scene;
  running = false;
  scheduled = false;
  solver = new FdtdSolver(msg.scene);
  post({ type: 'ready', generation, meta: solver.meta });
  post(buildFrame());
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
    if (msg.type === 'config') {
      scene = msg.scene;
      if (!running) post(buildFrame());
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
      if (scene) post(buildFrame());
      return;
    }
    if (msg.type === 'singleStep') {
      if (scene) {
        solver.step(Math.max(1, scene.simulation.stepsPerFrame));
        post(buildFrame());
      }
    }
  } catch (err) {
    post({
      type: 'error',
      generation,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
