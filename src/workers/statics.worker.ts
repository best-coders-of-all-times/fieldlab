/// <reference lib="webworker" />
import { StaticsEngine } from '../engine/staticsEngine';
import type { StaticsRequest, StaticsResponse } from './protocol';
import type { ProbeReading, Scene } from '../scene/types';

interface WorkerCtx {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<StaticsRequest>) => void) | null;
}

const ctx = self as unknown as WorkerCtx;

let engine: StaticsEngine | null = null;
let scene: Scene | null = null;
let generation = -1;

function reply(message: StaticsResponse, transfer?: Transferable[]): void {
  ctx.postMessage(message, transfer);
}

function handleInit(msg: Extract<StaticsRequest, { type: 'init' }>): void {
  generation = msg.generation;
  scene = msg.scene;
  engine = new StaticsEngine(msg.scene);
  reply({
    type: 'ready',
    generation,
    summary: engine.summary,
    probes: engine.probes(),
  });
}

ctx.onmessage = (event: MessageEvent<StaticsRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === 'init') {
      handleInit(msg);
      return;
    }
    if (!engine || msg.generation !== generation) return;

    if (msg.type === 'frame') {
      engine.updateMotion(msg.transforms);
      // Probe edits do not reinitialize physics; carry current IDs/positions.
      const transformed = new Map(msg.transforms.map(t => [t.id, t]));
      engine.scene = { ...engine.scene, objects: [
        ...engine.scene.objects.filter(o => o.kind !== 'probe'),
        ...msg.probes.map(p => ({ ...p, ...transformed.get(p.id) })),
      ] };
      const d = msg.display;
      const slices = [];
      if (d.slices.xy) slices.push(engine.slice('z', d.slicePositions.z, d.sliceQuantity, d.sliceResolution));
      if (d.slices.xz) slices.push(engine.slice('y', d.slicePositions.y, d.sliceQuantity, d.sliceResolution));
      if (d.slices.yz) slices.push(engine.slice('x', d.slicePositions.x, d.sliceQuantity, d.sliceResolution));
      const lines = d.fieldLines === 'none' ? undefined : { field: d.fieldLines, lines: engine.fieldLines(d.fieldLines, d.lineCount) };
      const lattice = d.arrows === 'none' ? undefined : { field: d.arrows, ...engine.lattice(d.arrowDensity, d.arrows) };
      const transfer: Transferable[] = slices.map(s => s.data.buffer);
      for (const l of lines?.lines ?? []) transfer.push(l.points.buffer, l.magnitudes.buffer);
      if (lattice) transfer.push(lattice.positions.buffer, lattice.vectors.buffer, lattice.magnitudes.buffer);
      reply({ type: 'frame', generation, requestId: msg.requestId, time: msg.time,
        slices, lines, lattice, probes: engine.probes(), summary: engine.summary }, transfer);
    } else if (msg.type === 'slice') {
      const slice = engine.slice(msg.axis, msg.position, msg.quantity, msg.resolution);
      reply({ type: 'slice', generation, requestId: msg.requestId, slice }, [slice.data.buffer]);
    } else if (msg.type === 'lines') {
      const lines = engine.fieldLines(msg.field, msg.count);
      const transfer: Transferable[] = [];
      for (const line of lines) {
        transfer.push(line.points.buffer, line.magnitudes.buffer);
      }
      reply({ type: 'lines', generation, requestId: msg.requestId, field: msg.field, lines }, transfer);
    } else if (msg.type === 'lattice') {
      const lattice = engine.lattice(msg.count, msg.field);
      reply({
        type: 'lattice',
        generation,
        requestId: msg.requestId,
        field: msg.field,
        ...lattice,
      }, [lattice.positions.buffer, lattice.vectors.buffer, lattice.magnitudes.buffer]);
    } else if (msg.type === 'probe') {
      const readings: ProbeReading[] = msg.points.map(({ id, position: p }) => {
        const E = engine!.sampleE(p);
        const B = engine!.sampleB(p);
        return {
          id,
          position: p,
          E,
          B,
          phi: engine!.samplePhi(p),
          Emag: Math.hypot(E[0], E[1], E[2]),
          Bmag: Math.hypot(B[0], B[1], B[2]),
        };
      });
      reply({ type: 'probe', generation, requestId: msg.requestId, probes: readings });
    }
    void scene;
  } catch (err) {
    reply({
      type: 'error',
      generation: msg.generation,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
