import { describe, expect, it } from 'vitest';
import { restoreScene } from '../src/app/restoreScene';
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
});
