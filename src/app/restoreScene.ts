import type { Scene } from '../scene/types';

/**
 * Merge a scene read from localStorage over the current defaults. Older saves
 * may be missing newer display/simulation keys, so a shallow spread alone is
 * not enough; nested records are filled from `base`.
 */
export function restoreScene(saved: unknown, base: Scene): Scene | null {
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
