import type { FdtdMeta } from '../engine/fdtd/fdtd3d';
import type { PlaybackPlan } from '../engine/maxwell/playbackSchedule';
import { PLAYBACK_CACHE_LIMIT_BYTES } from '../engine/maxwell/playbackPayload';
import type { CachedFdtdFrame } from '../workers/protocol';

export interface PlaybackCacheHeader {
  plan: PlaybackPlan;
  meta: FdtdMeta;
  createdAt: number;
}

/** Session-only reduced-frame cache. Owned by SimulationController, never
 * placed in Zustand or serialized with the scene. */
export interface PlaybackCache {
  header: PlaybackCacheHeader;
  frames: CachedFdtdFrame[];
  bytes: number;
  /** Payload bytes of the most recently appended frame. */
  frameBytes: number;
}

export function createPlaybackCache(plan: PlaybackPlan, meta: FdtdMeta): PlaybackCache {
  return {
    header: { plan, meta, createdAt: Date.now() },
    frames: [],
    bytes: 0,
    frameBytes: 0,
  };
}

/**
 * Append one complete reduced frame. Returns false without mutating the cache
 * when the payload cap would be exceeded; the caller must discard the partial
 * cache rather than expose it as playable.
 */
export function appendPlaybackFrame(
  cache: PlaybackCache,
  frame: CachedFdtdFrame,
  payloadBytes: number,
  limit = PLAYBACK_CACHE_LIMIT_BYTES,
): boolean {
  if (!(Number.isFinite(payloadBytes) && payloadBytes >= 0)) return false;
  if (cache.bytes + payloadBytes > limit) return false;
  cache.frames.push(frame);
  cache.bytes += payloadBytes;
  cache.frameBytes = payloadBytes;
  return true;
}
