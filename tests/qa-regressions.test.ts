import { describe, expect, it } from 'vitest';
import { restoreScene } from '../src/app/restoreScene';
import { PRESETS } from '../src/scene/presets';
import { makeParticle } from '../src/scene/defaults';
import { useAppStore } from '../src/app/store';

const base = PRESETS[0].create();

describe('QA scene validation regressions', () => {
  it.each([{}, null, { ...base.objects[0], position: [0, 1] },
    { ...base.objects[0], kind: 'unknown' }, { ...base.objects[0], charge: 'NaN' }])(
    'rejects malformed objects without changing the current scene: %j', object => {
      const before = JSON.stringify(base);
      expect(restoreScene({ ...base, objects: [object] }, base)).toBeNull();
      expect(JSON.stringify(base)).toBe(before);
    });
  it.each([null, 123])('rejects non-string scene name: %j', name => {
    expect(restoreScene({ ...base, name }, base)).toBeNull();
  });
  it('rejects duplicate IDs, infinite values and unsafe solver settings', () => {
    expect(restoreScene({ ...base, objects: [base.objects[0], base.objects[0]] }, base)).toBeNull();
    expect(restoreScene({ ...base, domain: { ...base.domain, size: [0, 1, 1] } }, base)).toBeNull();
    expect(restoreScene({ ...base, simulation: { ...base.simulation, resolution: 999999 } }, base)).toBeNull();
    expect(restoreScene({ ...base, display: { ...base.display, lineCount: Infinity } }, base)).toBeNull();
  });
  it.each(PRESETS.map(p => [p.title, p]))('retains valid preset %s', (_, preset) => {
    const scene = preset.create();
    expect(restoreScene(JSON.parse(JSON.stringify(scene)), base)).toEqual(scene);
  });
});

describe('QA object editing regressions', () => {
  it('keeps particle body mass and velocity consistent after editing', () => {
    const particle = makeParticle();
    particle.dynamics = { mode: 'fixed', mass: 2, inertia: [1, 1, 1], velocity: [1, 0, 0], angularVelocity: [0, 0, 0] };
    useAppStore.setState({ scene: { ...base, objects: [particle] } });
    useAppStore.getState().updateObject(particle.id, { mass: 3, velocity: [2, 0, 0] });
    const updated = useAppStore.getState().scene.objects[0];
    expect(updated.dynamics?.mass).toBe(3);
    expect(updated.dynamics?.velocity).toEqual([2, 0, 0]);
  });
  it('does not accept blank object names', () => {
    const particle = makeParticle();
    useAppStore.setState({ scene: { ...base, objects: [particle] } });
    useAppStore.getState().updateObject(particle.id, { name: '   ' });
    expect(useAppStore.getState().scene.objects[0].name.trim()).not.toBe('');
  });
});
