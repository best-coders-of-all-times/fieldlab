import type { PlaybackSampleMode } from '../../scene/types';

export const MAX_PLAYBACK_FRAMES = 1200;
export const MAX_PLAYBACK_STEPS = 5_000_000;

export interface PlaybackPlanInput {
  startTime: number;
  endTime: number;
  sampleMode: PlaybackSampleMode;
  sampleCount?: number;
  sampleInterval?: number;
}

export interface PlaybackPlan {
  dt: number;
  startStep: number;
  endStep: number;
  /** Steps from 0 to the first cached sample. Always equals startStep. */
  warmupSteps: number;
  /** Steps from 0 to the final cached sample. Always equals endStep. */
  totalSteps: number;
  /** Strictly increasing grid steps; the authoritative playback timeline. */
  sampleSteps: number[];
  /** Exact solver times, sampleSteps[i] * dt. */
  sampleTimes: number[];
}

function gridStep(time: number, dt: number): number {
  const ratio = time / dt, integer = Math.round(ratio);
  // Exact decimal/grid multiples may divide a few ulps above an integer.
  const aligned = Math.abs(ratio - integer) <= Math.min(1e-7, 8 * Number.EPSILON * Math.max(1, Math.abs(ratio)));
  const step = aligned ? integer : Math.ceil(ratio);
  if (!Number.isSafeInteger(step)) throw new Error('Playback time exceeds the representable grid-step count.');
  return step;
}

function uniqueIncreasing(steps: number[]): number[] {
  const result: number[] = [];
  for (const step of steps) {
    if (!Number.isSafeInteger(step) || step < 0) throw new Error('Playback sample steps must be nonnegative integers.');
    if (result.length === 0 || step > result[result.length - 1]) result.push(step);
  }
  return result;
}

function formatSeconds(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) return value.toExponential(3);
  return String(Number(value.toPrecision(6)));
}

/**
 * Quantize an authored physical-time window to the solver grid and choose the
 * exact reduced-frame sample steps. Computation always starts at step 0; the
 * authored start is a cached-window boundary, not a resume point.
 */
export function planPlaybackSamples(
  input: PlaybackPlanInput,
  dt: number,
  limits: { maxFrames?: number; maxSteps?: number } = {},
): PlaybackPlan {
  const maxFrames = Math.floor(limits.maxFrames ?? MAX_PLAYBACK_FRAMES);
  const maxSteps = Math.floor(limits.maxSteps ?? MAX_PLAYBACK_STEPS);
  if (!Number.isFinite(dt) || dt <= 0) throw new Error('The solver grid step must be finite and positive.');
  if (!Number.isFinite(maxFrames) || maxFrames < 2) throw new Error('Playback frame limit must be at least two.');
  if (!Number.isFinite(maxSteps) || maxSteps < 1) throw new Error('Playback step limit must be positive.');
  if (!(Number.isFinite(input.startTime) && input.startTime >= 0)) {
    throw new Error('Playback start time must be finite and nonnegative.');
  }
  if (!(Number.isFinite(input.endTime) && input.endTime > input.startTime)) {
    throw new Error('Playback end time must be finite and greater than the start time.');
  }
  if (input.endTime - input.startTime < dt) {
    throw new Error(`The playback range must span at least one grid step (${formatSeconds(dt)} s).`);
  }

  const startStep = gridStep(input.startTime, dt);
  const endStep = gridStep(input.endTime, dt);
  if (endStep <= startStep) {
    throw new Error(`The playback range must span at least one grid step (${formatSeconds(dt)} s).`);
  }
  if (endStep > maxSteps) {
    throw new Error(`Playback requires ${endStep.toLocaleString('en-US')} steps; the limit is ${maxSteps.toLocaleString('en-US')}. Shorten the window.`);
  }

  const span = endStep - startStep;
  let sampleSteps: number[];

  if (input.sampleMode === 'count') {
    const requested = Math.floor(input.sampleCount ?? 0);
    if (!Number.isFinite(requested)) throw new Error('Playback frame count must be a finite integer.');
    const count = Math.min(maxFrames, Math.max(2, requested), span + 1);
    if (count < 2) throw new Error('The playback range cannot provide two distinct cached samples.');
    sampleSteps = Array.from({ length: count }, (_, i) =>
      startStep + Math.round((i * span) / (count - 1)));
    sampleSteps[0] = startStep;
    sampleSteps[count - 1] = endStep;
    sampleSteps = uniqueIncreasing(sampleSteps);
  } else if (input.sampleMode === 'interval') {
    const interval = input.sampleInterval;
    if (interval === undefined || !Number.isFinite(interval) || interval <= 0) {
      throw new Error('Playback sample interval must be finite and positive.');
    }
    const stepInterval = Math.max(1, Math.round(interval / dt));
    sampleSteps = [];
    for (let step = startStep; step < endStep; step += stepInterval) sampleSteps.push(step);
    if (sampleSteps[sampleSteps.length - 1] !== endStep) sampleSteps.push(endStep);
    sampleSteps = uniqueIncreasing(sampleSteps);
    if (sampleSteps.length > maxFrames) {
      const suggestion = (interval * (sampleSteps.length - 1)) / (maxFrames - 1);
      throw new Error(`The sample interval produces ${sampleSteps.length} frames; the limit is ${maxFrames}. Use an interval of at least ${formatSeconds(suggestion)} s.`);
    }
  } else {
    throw new Error('Playback sample mode must be "count" or "interval".');
  }

  if (sampleSteps.length < 2) throw new Error('The playback range cannot provide two distinct cached samples.');
  if (sampleSteps.length > maxFrames) throw new Error(`Playback requires ${sampleSteps.length} frames; the limit is ${maxFrames}.`);

  return {
    dt,
    startStep,
    endStep,
    warmupSteps: startStep,
    totalSteps: endStep,
    sampleSteps,
    sampleTimes: sampleSteps.map((step) => step * dt),
  };
}
