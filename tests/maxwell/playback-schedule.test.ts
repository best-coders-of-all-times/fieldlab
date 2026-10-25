import { describe, expect, it } from 'vitest';
import {
  MAX_PLAYBACK_STEPS,
  planPlaybackSamples,
} from '../../src/engine/maxwell/playbackSchedule';

const dt = 2e-10;

describe('planPlaybackSamples', () => {
  it('quantizes aligned window boundaries exactly', () => {
    const plan = planPlaybackSamples({
      startTime: 4e-10,
      endTime: 10e-10,
      sampleMode: 'count',
      sampleCount: 4,
    }, dt);
    expect(plan.startStep).toBe(2);
    expect(plan.endStep).toBe(5);
    expect(plan.warmupSteps).toBe(2);
    expect(plan.totalSteps).toBe(5);
    expect(plan.sampleSteps).toEqual([2, 3, 4, 5]);
    plan.sampleTimes.forEach((time, i) => expect(time).toBeCloseTo(plan.sampleSteps[i] * dt, 20));
  });

  it('ceils unaligned boundaries so the cached window covers the authored range', () => {
    const plan = planPlaybackSamples({
      startTime: 4.2e-10,
      endTime: 10.5e-10,
      sampleMode: 'count',
      sampleCount: 4,
    }, dt);
    expect(plan.startStep).toBe(3);
    expect(plan.endStep).toBe(6);
    expect(plan.sampleSteps).toEqual([3, 4, 5, 6]);
    expect(plan.sampleTimes[0]).toBeGreaterThanOrEqual(4.2e-10);
    expect(plan.sampleTimes.at(-1)).toBeGreaterThanOrEqual(10.5e-10);
  });

  it('rejects a range shorter than one grid step', () => {
    expect(() => planPlaybackSamples({
      startTime: 0,
      endTime: dt / 2,
      sampleMode: 'count',
      sampleCount: 4,
    }, dt)).toThrow(/at least one grid step/);
  });

  it('includes both endpoints and clamps count to distinct available steps', () => {
    const plan = planPlaybackSamples({
      startTime: 0,
      endTime: 2 * dt,
      sampleMode: 'count',
      sampleCount: 120,
    }, dt);
    expect(plan.sampleSteps).toEqual([0, 1, 2]);
    expect(plan.sampleSteps[0]).toBe(plan.startStep);
    expect(plan.sampleSteps.at(-1)).toBe(plan.endStep);
  });

  it('deduplicates count-mode steps and keeps them strictly increasing', () => {
    const plan = planPlaybackSamples({
      startTime: 0,
      endTime: 3 * dt,
      sampleMode: 'count',
      sampleCount: 1200,
    }, dt);
    expect(plan.sampleSteps).toEqual([0, 1, 2, 3]);
    expect(new Set(plan.sampleSteps).size).toBe(plan.sampleSteps.length);
  });

  it('samples by interval and appends the end boundary', () => {
    const plan = planPlaybackSamples({
      startTime: 0,
      endTime: 10e-10,
      sampleMode: 'interval',
      sampleInterval: 4e-10,
    }, dt);
    expect(plan.sampleSteps).toEqual([0, 2, 4, 5]);
    const wide = planPlaybackSamples({
      startTime: 0,
      endTime: 10e-10,
      sampleMode: 'interval',
      sampleInterval: 8e-10,
    }, dt);
    expect(wide.sampleSteps).toEqual([0, 4, 5]);
  });

  it('rejects interval plans above the frame cap with a larger-interval suggestion', () => {
    expect(() => planPlaybackSamples({
      startTime: 0,
      endTime: 100 * dt,
      sampleMode: 'interval',
      sampleInterval: dt,
    }, dt, { maxFrames: 20 })).toThrow(/limit is 20.*interval of at least/);
  });

  it('enforces step and frame limits', () => {
    expect(() => planPlaybackSamples({
      startTime: 0,
      endTime: 101 * dt,
      sampleMode: 'count',
      sampleCount: 2,
    }, dt, { maxSteps: 100 })).toThrow(/steps; the limit is 100/);
    const plan = planPlaybackSamples({
      startTime: 0,
      endTime: 100 * dt,
      sampleMode: 'count',
      sampleCount: 500,
    }, dt, { maxFrames: 5 });
    expect(plan.sampleSteps).toHaveLength(5);
  });

  it('uses five million steps as the default sanity ceiling', () => {
    expect(MAX_PLAYBACK_STEPS).toBe(5_000_000);
  });

  it('rejects invalid input', () => {
    expect(() => planPlaybackSamples({ startTime: -1, endTime: 1, sampleMode: 'count', sampleCount: 2 }, dt)).toThrow(/nonnegative/);
    expect(() => planPlaybackSamples({ startTime: 0, endTime: 0, sampleMode: 'count', sampleCount: 2 }, dt)).toThrow(/greater/);
    expect(() => planPlaybackSamples({ startTime: 0, endTime: dt, sampleMode: 'count', sampleCount: Number.NaN }, dt)).toThrow(/finite integer/);
    expect(() => planPlaybackSamples({ startTime: 0, endTime: dt, sampleMode: 'interval', sampleInterval: 0 }, dt)).toThrow(/interval/);
    expect(() => planPlaybackSamples({ startTime: 0, endTime: dt, sampleMode: 'count', sampleCount: 2 }, 0)).toThrow(/grid step/);
  });
});
