import type { PlaybackFps, PlaybackSettings, Scene } from '../scene/types';
import { defaultPlayback } from '../scene/defaults';
import { sceneValidationError } from '../scene/validation';

const PLAYBACK_FPS: PlaybackFps[] = [12, 24, 30, 60];

/** Normalize authored playback settings from an older or hand-edited scene.
 * Invalid fields fall back independently; one bad number must not reject the
 * whole scene.
 */
export function normalizePlaybackSettings(value: unknown, fallback = defaultPlayback()): PlaybackSettings {
  const raw = value && typeof value === 'object' ? value as Partial<PlaybackSettings> : {};
  const startTime = typeof raw.startTime === 'number' && Number.isFinite(raw.startTime) && raw.startTime >= 0
    ? raw.startTime : fallback.startTime;
  let endTime = typeof raw.endTime === 'number' && Number.isFinite(raw.endTime) && raw.endTime > startTime
    ? raw.endTime : fallback.endTime;
  if (!(endTime > startTime)) endTime = startTime + Math.max(1e-12, Math.abs(startTime) || 1);
  const sampleMode = raw.sampleMode === 'count' || raw.sampleMode === 'interval'
    ? raw.sampleMode : fallback.sampleMode;
  const roundedCount = typeof raw.sampleCount === 'number' && Number.isFinite(raw.sampleCount)
    ? Math.round(raw.sampleCount) : fallback.sampleCount;
  const sampleCount = Math.max(2, Math.min(1200, roundedCount));
  const sampleInterval = typeof raw.sampleInterval === 'number' && Number.isFinite(raw.sampleInterval) && raw.sampleInterval > 0
    ? raw.sampleInterval : fallback.sampleInterval;
  const fps = typeof raw.fps === 'number' && PLAYBACK_FPS.includes(raw.fps as PlaybackFps)
    ? raw.fps as PlaybackFps : 30;
  const loop = typeof raw.loop === 'boolean' ? raw.loop : true;
  return { startTime, endTime, sampleMode, sampleCount, sampleInterval, fps, loop };
}

/**
 * Merge a scene read from localStorage over the current defaults. Older saves
 * may be missing newer display/simulation keys, so a shallow spread alone is
 * not enough; nested records are filled from `base`.
 */
export function restoreScene(saved: unknown, base: Scene): Scene | null {
  if (sceneValidationError(saved)) return null;
  if (!saved || typeof saved !== 'object') return null;
  const value = saved as Partial<Scene>;
  if (!Array.isArray(value.objects)) return null;
  if (value.mode !== 'fields' && value.mode !== 'waves') return null;
  return {
    ...base,
    ...value,
    objects: value.objects as Scene['objects'],
    domain: {
      center: value.domain?.center ?? base.domain.center,
      size: value.domain?.size ?? base.domain.size,
    },
    display: {
      ...base.display,
      ...(value.display ?? {}),
      slices: { ...base.display.slices, ...(value.display?.slices ?? {}) },
      slicePositions: {
        ...base.display.slicePositions,
        ...(value.display?.slicePositions ?? {}),
      },
    },
    simulation: {
      ...base.simulation,
      ...(value.simulation ?? {}),
      useApproximation: value.simulation?.useApproximation ?? true,
      maxwellConductorModel: value.simulation?.maxwellConductorModel,
      targetTime: value.simulation?.targetTime,
      playback: normalizePlaybackSettings(
        value.simulation?.playback,
        base.simulation.playback ?? defaultPlayback(),
      ),
      boundary: {
        ...base.simulation.boundary,
        ...(value.simulation?.boundary ?? {}),
      },
    },
    camera: {
      position: value.camera?.position ?? base.camera?.position ?? [1.55, 1.15, 1.55],
      target: value.camera?.target ?? base.camera?.target ?? [0, 0, 0],
      orthographic: value.camera?.orthographic ?? base.camera?.orthographic ?? false,
    },
  };
}
