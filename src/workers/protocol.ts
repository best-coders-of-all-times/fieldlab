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
import type { PlaybackPlan, PlaybackPlanInput } from '../engine/maxwell/playbackSchedule';

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
  /** Full-Maxwell physical target reached at the first applicable grid step. */
  targetReached?: boolean;
}

/** Reduced frame stored in the playback cache; cache-wide metadata is shared. */
export type CachedFdtdFrame = Omit<
  FdtdFrame,
  'type' | 'generation' | 'meta' | 'diagnostics' | 'targetReached'
>;

export type FdtdRequest =
  | { type: 'init'; generation: number; scene: Scene }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'reset' }
  | { type: 'config'; generation: number; scene: Scene }
  | { type: 'singleStep' }
  | {
      type: 'precompute';
      generation: number;
      requestId: number;
      plan: PlaybackPlanInput;
    }
  | { type: 'precompute-cancel'; generation: number; requestId: number };

export type FdtdResponse =
  | { type: 'ready'; generation: number; meta: FdtdMeta }
  | FdtdFrame
  | {
      type: 'precompute-start';
      generation: number;
      requestId: number;
      meta: FdtdMeta;
      plan: PlaybackPlan;
    }
  | {
      type: 'precompute-progress';
      generation: number;
      requestId: number;
      phase: 'warmup' | 'sampling';
      steps: number;
      totalSteps: number;
      sampleIndex: number;
      sampleCount: number;
      elapsedMs: number;
      stepsPerSecond: number;
      sampledBytes: number;
    }
  | {
      type: 'precompute-frame';
      generation: number;
      requestId: number;
      index: number;
      frame: CachedFdtdFrame;
      payloadBytes: number;
    }
  | {
      type: 'precompute-done';
      generation: number;
      requestId: number;
      sampleCount: number;
      steps: number;
      elapsedMs: number;
      sampledBytes: number;
    }
  | {
      type: 'precompute-cancelled';
      generation: number;
      requestId: number;
      steps: number;
    }
  | { type: 'error'; generation: number; message: string };
