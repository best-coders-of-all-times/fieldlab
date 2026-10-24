import { afterEach, describe, expect, it } from 'vitest';
import { makeScene, makeMagnet, makeWire, worldAxis } from '../src/scene/defaults';
import { motionAt } from '../src/scene/motion';
import { InductionSystem } from '../src/engine/induction/system';
import { useAppStore } from '../src/app/store';

const initial = useAppStore.getState();
afterEach(() => useAppStore.setState(initial, true));

describe('Custom scene motion and reset', () => {
  it('shows B when the first source added to a blank scene is a wire', () => {
    useAppStore.getState().setScene(makeScene({ name: 'blank' }), { presetId: null });
    useAppStore.getState().addObject(makeWire());
    expect(useAppStore.getState().scene.display.fieldLines).toBe('B');
    expect(useAppStore.getState().scene.display.sliceQuantity).toBe('Bmag');
  });
  it('interpolates prescribed position and rotation keyframes', () => {
    const magnet = makeMagnet([0.1, 0, 0]);
    magnet.motion = { kind: 'keyframes', loop: false, keyframes: [
      { time: 0, position: [0, 0, 0], rotation: [0, 0, 0] },
      { time: 1, position: [0.4, 0.2, 0], rotation: [0, 0, Math.PI] },
    ] };
    const motion = new InductionSystem(makeScene({ name: 'custom', objects: [magnet] }));
    let frame;
    for (let i = 0; i < 30; i++) frame = motion.advance(1 / 60)!;
    expect(frame!.transforms[0].position[0]).toBeCloseTo(0.3);
    expect(frame!.transforms[0].position[1]).toBeCloseTo(0.1);
    expect(frame!.transforms[0].rotation[2]).toBeCloseTo(Math.PI / 2);
    for (let i = 0; i < 90; i++) frame = motion.advance(1 / 60)!;
    expect(frame!.transforms[0].position[0]).toBeCloseTo(0.5);
  });

  it('rewinds a custom scene without deleting its objects', () => {
    const wire = makeWire();
    useAppStore.getState().setScene(makeScene({ name: 'my design', objects: [wire] }), { presetId: null });
    useAppStore.getState().resetScene();
    expect(useAppStore.getState().scene.objects[0]?.id).toBe(wire.id);
  });

  it('spins about the actual arbitrary world axis', () => {
    const magnet = makeMagnet();
    magnet.motion = { kind: 'spin', axis: [1, 1, 0], amplitude: 0, frequency: 0.25 };
    const posed = { ...magnet, ...motionAt(magnet, 1) };
    const normal = worldAxis(posed, [0, 0, 1]);
    expect(normal[0]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(normal[1]).toBeCloseTo(-Math.SQRT1_2, 12);
    expect(normal[2]).toBeCloseTo(0, 12);
  });

  it('repeats a keyframe path on its specified duration', () => {
    const magnet = makeMagnet();
    magnet.motion = { kind: 'keyframes', loop: true, keyframes: [
      { time: 0, position: [0, 0, 0], rotation: [0, 0, 0] },
      { time: 2, position: [0.4, 0.2, 0], rotation: [0, 0, 0] },
    ] };
    expect(motionAt(magnet, 2.5).position).toEqual([0.1, 0.05, 0]);
  });
});
