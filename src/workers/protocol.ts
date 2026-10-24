import type { Vec3 } from '../engine/math/vec3';
import type { MotionTransform } from '../engine/induction/system';
import type {
  FdtdMeta,
  FdtdSample,
} from '../engine/fdtd/fdtd3d';
import type {
  FieldLineData,
  SliceData,
  StaticsSummary,
} from '../engine/staticsEngine';
import type {
  ProbeReading,
  Scene,
  SliceQuantity,
  DisplaySettings,
  ProbeObject,
} from '../scene/types';

export type StaticsRequest =
  | { type: 'init'; generation: number; scene: Scene }
  | { type: 'frame'; generation: number; requestId: number; time: number;
      transforms: MotionTransform[]; display: DisplaySettings; probes: ProbeObject[] }
  | {
      type: 'slice';
      generation: number;
      requestId: number;
      axis: 'x' | 'y' | 'z';
      position: number;
      quantity: SliceQuantity;
      resolution: number;
      colormap: string;
      signed: boolean;
    }
  | {
      type: 'lines';
      generation: number;
      requestId: number;
      field: 'E' | 'B';
      count: number;
    }
  | {
      type: 'probe';
      generation: number;
      requestId: number;
      points: Array<{ id: string; position: Vec3 }>;
    }
  | {
      type: 'lattice';
      generation: number;
      requestId: number;
      field: 'E' | 'B' | 'P';
      count: number;
    };

export type StaticsResponse =
  | { type: 'frame'; generation: number; requestId: number; time: number;
      slices: SliceData[]; probes: ProbeReading[]; summary: StaticsSummary;
      lines?: { field: 'E' | 'B'; lines: FieldLineData[] };
      lattice?: { field: 'E' | 'B' | 'P'; positions: Float32Array; vectors: Float32Array; magnitudes: Float32Array } }
  | {
      type: 'ready';
      generation: number;
      summary: StaticsSummary;
      probes: ProbeReading[];
      slice?: SliceData;
    }
  | {
      type: 'slice';
      generation: number;
      requestId: number;
      slice: SliceData;
    }
  | {
      type: 'lines';
      generation: number;
      requestId: number;
      field: 'E' | 'B';
      lines: FieldLineData[];
    }
  | {
      type: 'probe';
      generation: number;
      requestId: number;
      probes: ProbeReading[];
    }
  | {
      type: 'lattice';
      generation: number;
      requestId: number;
      field: 'E' | 'B' | 'P';
      positions: Float32Array;
      vectors: Float32Array;
      magnitudes: Float32Array;
    }
  | { type: 'error'; generation: number; message: string };

export interface FdtdProbeFrame {
  id: string;
  position: Vec3;
  sample: FdtdSample & { D?: Vec3; J?: Vec3; rho?: number };
}

export interface WaveSlice {
  axis: 'x' | 'y' | 'z';
  position: number;
  quantity: SliceQuantity;
  resolution: number;
  data: Float32Array;
  min: number;
  max: number;
}

export interface FdtdFrame {
  type: 'frame';
  generation: number;
  time: number;
  steps: number;
  meta: FdtdMeta;
  slices: WaveSlice[];
  lattice?: {
    positions: Float32Array;
    vectors: Float32Array;
    magnitudes: Float32Array;
    field: 'E' | 'B' | 'P';
  };
  probes: FdtdProbeFrame[];
  energy: { electric: number; magnetic: number };
  /** Present for the unified Maxwell engine; all poses share this frame time. */
  transforms?: MotionTransform[];
  lines?: { field: 'E' | 'B'; lines: FieldLineData[] };
  diagnostics?: Record<string, number>;
}

export type FdtdRequest =
  | { type: 'init'; generation: number; scene: Scene }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'reset' }
  | { type: 'config'; generation: number; scene: Scene }
  | { type: 'singleStep' };

export type FdtdResponse =
  | { type: 'ready'; generation: number; meta: FdtdMeta }
  | FdtdFrame
  | { type: 'error'; generation: number; message: string };
