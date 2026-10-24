import type { FdtdFrame } from '../workers/protocol';
import type { FieldLineData, SliceData } from '../engine/staticsEngine';
import type { ParticleFrame } from '../engine/particles/system';
import type { InductionFrame } from '../engine/induction/system';
import type { ProbeReading } from '../scene/types';

export interface StaticsLinesPayload {
  field: 'E' | 'B';
  lines: FieldLineData[];
}

export interface LatticePayload {
  field: 'E' | 'B' | 'P';
  positions: Float32Array;
  vectors: Float32Array;
  magnitudes: Float32Array;
}

interface Events {
  'probes': ProbeReading[];
  'statics-slice': SliceData;
  'statics-lines': StaticsLinesPayload;
  'statics-lattice': LatticePayload;
  'fdtd-frame': FdtdFrame;
  'particles-frame': ParticleFrame;
  'induction-frame': InductionFrame;
  'statics-clear': undefined;
  'fdtd-clear': undefined;
  'particles-clear': undefined;
  'induction-clear': undefined;
}

type Handler<T> = (payload: T) => void;

class FieldBus {
  private target = new EventTarget();

  on<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    const listener = (event: Event) => handler((event as CustomEvent<Events[K]>).detail);
    this.target.addEventListener(type, listener);
    return () => this.target.removeEventListener(type, listener);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    this.target.dispatchEvent(new CustomEvent(type, { detail: payload }));
  }
}

export const fieldBus = new FieldBus();
