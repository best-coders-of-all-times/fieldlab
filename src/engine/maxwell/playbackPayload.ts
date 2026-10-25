import type { FdtdMeta } from '../fdtd/fdtd3d';
import type { CachedFdtdFrame } from '../../workers/protocol';
import type { DisplaySettings } from '../../scene/types';

export const PLAYBACK_CACHE_LIMIT_BYTES = 256 * 1024 ** 2;
export const PLAYBACK_CACHE_WARN_BYTES = 192 * 1024 ** 2;

export interface PlaybackPayloadCounts {
  /** Visible probes sampled into every frame. */
  probes?: number;
  /** Visible object poses included with every frame. */
  transforms?: number;
}

const encoder = new TextEncoder();

/** Payload bytes only. JS object overhead, allocator slack, structured-clone
 * copies, Three.js geometry and GPU memory are additional. */
export function framePayloadBytes(frame: CachedFdtdFrame): number {
  let bytes = 0;
  for (const slice of frame.slices) bytes += slice.data.byteLength;
  if (frame.lattice) {
    bytes += frame.lattice.positions.byteLength;
    bytes += frame.lattice.vectors.byteLength;
    bytes += frame.lattice.magnitudes.byteLength;
  }
  for (const line of frame.lines?.lines ?? []) {
    bytes += line.points.byteLength;
    bytes += line.magnitudes.byteLength;
  }
  const metadata = {
    time: frame.time,
    steps: frame.steps,
    slices: frame.slices.map(({ data: _data, ...rest }) => rest),
    lattice: frame.lattice ? { field: frame.lattice.field } : undefined,
    probes: frame.probes,
    energy: frame.energy,
    transforms: frame.transforms,
    lines: frame.lines ? {
      field: frame.lines.field,
      lines: frame.lines.lines.map((line) => ({
        points: line.points.length,
        magnitudes: line.magnitudes.length,
      })),
    } : undefined,
  };
  return bytes + encoder.encode(JSON.stringify(metadata)).byteLength;
}

function enabledSliceCount(display: DisplaySettings): number {
  return Number(display.slices.xy) + Number(display.slices.xz) + Number(display.slices.yz);
}

/**
 * Upper-bound preflight estimate for one reduced display frame. The worker's
 * sampleSlice/sampleLattice clamps are applied exactly; the rest are fixed
 * allowances. Compare against PLAYBACK_CACHE_LIMIT_BYTES before computing.
 */
export function estimateFrameBytes(
  display: DisplaySettings,
  _meta: FdtdMeta,
  counts: PlaybackPayloadCounts = {},
): number {
  let bytes = 512;
  const sliceResolution = Math.max(16, Math.min(256, Math.round(display.sliceResolution)));
  bytes += enabledSliceCount(display) * sliceResolution * sliceResolution * 4;
  if (display.arrows !== 'none') {
    const density = Math.max(3, Math.min(20, Math.round(display.arrowDensity)));
    bytes += density ** 3 * 7 * 4;
  }
  if (display.fieldLines !== 'none') {
    const lineCount = Math.max(1, Math.min(100, Math.floor(display.lineCount)));
    bytes += lineCount * 360 * 4 * 4;
  }
  bytes += Math.max(0, counts.probes ?? 0) * 256;
  bytes += Math.max(0, counts.transforms ?? 0) * 80;
  return bytes;
}

/** Estimated reduced-frame payload for the whole cache, including the
 * cache-wide solver metadata header counted once. */
export function estimateCacheBytes(
  display: DisplaySettings,
  meta: FdtdMeta,
  count: number,
  counts: PlaybackPayloadCounts = {},
): number {
  const frames = Math.max(0, Math.floor(count));
  return frames * estimateFrameBytes(display, meta, counts) + encoder.encode(JSON.stringify(meta)).byteLength;
}
