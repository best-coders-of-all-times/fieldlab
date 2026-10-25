import { describe, expect, it } from 'vitest';
import { normalizePlaybackSettings, restoreScene } from '../src/app/restoreScene';
import { defaultPlayback } from '../src/scene/defaults';
import { getPreset } from '../src/scene/presets';

const base = getPreset('point-charges')!.create();

describe('restoreScene', () => {
  it('rejects corrupt or incomplete saves', () => {
    expect(restoreScene(null, base)).toBeNull();
    expect(restoreScene('nope', base)).toBeNull();
    expect(restoreScene({ mode: 'fields' }, base)).toBeNull();
    expect(restoreScene({ mode: 'bogus', objects: [] }, base)).toBeNull();
  });

  it('merges older saves over current defaults', () => {
    const saved = {
      name: 'Saved scene',
      mode: 'waves',
      objects: [],
      display: { sliceQuantity: 'Bmag' },
      simulation: { resolution: 96 },
      camera: null,
    };
    const restored = restoreScene(saved, base)!;
    expect(restored.name).toBe('Saved scene');
    expect(restored.mode).toBe('waves');
    expect(restored.objects).toEqual([]);
    expect(restored.display.sliceQuantity).toBe('Bmag');
    expect(restored.display.slices).toEqual(base.display.slices);
    expect(restored.simulation.resolution).toBe(96);
    expect(restored.simulation.cfl).toBe(base.simulation.cfl);
    expect(restored.camera?.position).toHaveLength(3);
  });

  it('round trips authored playback settings without runtime cache state', () => {
    const scene = JSON.parse(JSON.stringify(base));
    scene.simulation.playback = {
      startTime: 2e-10,
      endTime: 8e-10,
      sampleMode: 'interval',
      sampleCount: 75,
      sampleInterval: 5e-11,
      fps: 60,
      loop: false,
    };
    const restored = restoreScene(JSON.parse(JSON.stringify(scene)), base)!;
    expect(restored.simulation.playback).toEqual(scene.simulation.playback);
    const serialized = JSON.stringify(restored);
    expect(serialized).not.toContain('playbackCache');
    expect(serialized).not.toContain('framesDone');
    expect(serialized).not.toContain('sampleTimes');
    expect(serialized).not.toContain('"mode":"cached"');
  });

  it('normalizes invalid playback fields independently instead of rejecting the scene', () => {
    const fallback = defaultPlayback();
    const restored = normalizePlaybackSettings({
      startTime: -1,
      endTime: 0,
      sampleMode: 'nonsense',
      sampleCount: 1e9,
      sampleInterval: -2,
      fps: 15,
      loop: 'yes',
    }, fallback);
    expect(restored).toEqual({
      ...fallback,
      startTime: fallback.startTime,
      endTime: fallback.endTime,
      sampleMode: fallback.sampleMode,
      sampleCount: 1200,
      sampleInterval: fallback.sampleInterval,
      fps: 30,
      loop: true,
    });
    expect(normalizePlaybackSettings(null, fallback)).toEqual(fallback);
    expect(normalizePlaybackSettings({ sampleCount: 4.6, fps: 12, loop: false }, fallback)).toMatchObject({
      sampleCount: 5, fps: 12, loop: false,
    });
  });

  it('supplies defaults for older saves without playback settings', () => {
    const saved = JSON.parse(JSON.stringify(base));
    delete saved.simulation.playback;
    const restored = restoreScene(saved, base)!;
    expect(restored.simulation.playback).toEqual(defaultPlayback());
  });
});
