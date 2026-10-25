import { describe, expect, it } from 'vitest';
import { defaultDisplay } from '../src/scene/defaults';
import type { FdtdMeta } from '../src/engine/fdtd/fdtd3d';
import type { CachedFdtdFrame } from '../src/workers/protocol';
import {
  PLAYBACK_CACHE_LIMIT_BYTES,
  estimateCacheBytes,
  estimateFrameBytes,
  framePayloadBytes,
} from '../src/engine/maxwell/playbackPayload';
import {
  appendPlaybackFrame,
  createPlaybackCache,
} from '../src/app/playbackCache';
import { planPlaybackSamples } from '../src/engine/maxwell/playbackSchedule';

const meta: FdtdMeta = {
  nx: 16, ny: 16, nz: 16,
  physical: { x0: 4, x1: 12, y0: 4, y1: 12, z0: 4, z1: 12 },
  dx: 0.01, dy: 0.01, dz: 0.01, dt: 1e-11, cfl: 0.9,
  wavelengthCells: 10, frequency: 1e9,
  domainMin: [-0.5, -0.5, -0.5], domainMax: [0.5, 0.5, 0.5], pad: [4, 4, 4],
};

function frame(): CachedFdtdFrame {
  return {
    time: 2e-11,
    steps: 2,
    slices: [{
      axis: 'z', position: 0, quantity: 'Emag', resolution: 16,
      data: new Float32Array(16 * 16), min: 0, max: 1,
    }],
    probes: [{
      id: 'p1', position: [0, 0, 0],
      sample: {
        H: [1, 2, 3], E: [4, 5, 6], B: [7, 8, 9], Emag: 8.8, Bmag: 13.9,
        epsilonR: 1, muR: 1,
      },
    }],
    energy: { electric: 1, magnetic: 2 },
    transforms: [{ id: 'o1', position: [0, 0, 0], rotation: [0, 0, 0] }],
    lines: {
      field: 'E',
      lines: [{ points: new Float32Array(12), magnitudes: new Float32Array(4) }],
    },
  };
}

describe('playback payload accounting', () => {
  it('counts every transferred typed-array byte exactly', () => {
    const f = frame();
    const arrays = 16 * 16 * 4 + 12 * 4 + 4 * 4;
    expect(framePayloadBytes(f)).toBeGreaterThan(arrays);
    expect(framePayloadBytes(f)).toBeLessThan(arrays + 2000);
  });

  it('counts lattice arrays exactly', () => {
    const f = frame();
    delete f.lines;
    f.lattice = {
      field: 'E', positions: new Float32Array(30), vectors: new Float32Array(30),
      magnitudes: new Float32Array(10),
    };
    const without = frame();
    delete without.lines;
    without.lattice = {
      field: 'E', positions: new Float32Array(0), vectors: new Float32Array(0),
      magnitudes: new Float32Array(0),
    };
    expect(framePayloadBytes(f) - framePayloadBytes(without)).toBe(30 * 4 * 2 + 10 * 4);
  });

  it('estimates a representative reduced frame as an upper bound', () => {
    const display = defaultDisplay();
    display.arrows = 'none';
    display.fieldLines = 'none';
    const actual = framePayloadBytes(frame());
    expect(estimateFrameBytes(display, meta, { probes: 1, transforms: 1 })).toBeGreaterThanOrEqual(actual);
  });

  it('uses the worker sampling clamps in the estimate', () => {
    const display = defaultDisplay();
    display.slices = { xy: false, xz: false, yz: false };
    display.arrows = 'E';
    display.arrowDensity = 1;
    display.fieldLines = 'E';
    display.lineCount = 1000;
    const base = estimateFrameBytes(display, meta);
    expect(base).toBe(512 + 3 ** 3 * 7 * 4 + 100 * 360 * 16);
    display.sliceResolution = 1000;
    display.slices.xy = true;
    expect(estimateFrameBytes(display, meta) - base).toBe(256 * 256 * 4);
  });

  it('accounts for the cache header once', () => {
    const display = defaultDisplay();
    const one = estimateFrameBytes(display, meta);
    const cacheBytes = estimateCacheBytes(display, meta, 3);
    expect(cacheBytes).toBeGreaterThanOrEqual(3 * one);
    expect(cacheBytes - 3 * one).toBe(new TextEncoder().encode(JSON.stringify(meta)).byteLength);
  });
});

describe('playback cache', () => {
  const plan = planPlaybackSamples({
    startTime: 0, endTime: 4e-11, sampleMode: 'count', sampleCount: 3,
  }, meta.dt);

  it('stores complete frames and accumulated payload bytes', () => {
    const cache = createPlaybackCache(plan, meta);
    expect(appendPlaybackFrame(cache, frame(), 100)).toBe(true);
    expect(appendPlaybackFrame(cache, frame(), 50)).toBe(true);
    expect(cache.frames).toHaveLength(2);
    expect(cache.bytes).toBe(150);
    expect(cache.frameBytes).toBe(50);
  });

  it('refuses a frame that crosses the cap without mutating the cache', () => {
    const cache = createPlaybackCache(plan, meta);
    appendPlaybackFrame(cache, frame(), 100);
    expect(appendPlaybackFrame(cache, frame(), PLAYBACK_CACHE_LIMIT_BYTES)).toBe(false);
    expect(cache.frames).toHaveLength(1);
    expect(cache.bytes).toBe(100);
    expect(appendPlaybackFrame(cache, frame(), 10, 110)).toBe(true);
  });

  it('rejects invalid byte counts', () => {
    const cache = createPlaybackCache(plan, meta);
    expect(appendPlaybackFrame(cache, frame(), Number.NaN)).toBe(false);
    expect(appendPlaybackFrame(cache, frame(), -1)).toBe(false);
    expect(cache.frames).toHaveLength(0);
  });
});
