import { afterEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../src/app/store';
import { makeWire } from '../src/scene/defaults';

const initial = useAppStore.getState();
afterEach(() => useAppStore.setState(initial, true));

describe('edited scene transport', () => {
  it.each(['rewindSimulation', 'replaySimulation'] as const)('%s keeps authored edits, selection and undo history', action => {
    useAppStore.getState().loadPreset('capacitor');
    const plate = useAppStore.getState().scene.objects.find(o => o.kind === 'conductor')!;
    useAppStore.getState().updateObject(plate.id, { potential: 17, position: [0.1, 0.2, 0.3] });
    const wire = makeWire([[0, 0, 0], [0.2, 0.1, 0]]);
    wire.motion = { kind: 'spin', axis: [0, 0, 1], frequency: 0.4, amplitude: 0, phase: 0.5 };
    wire.dynamics = { mode: 'prescribed', mass: 2, inertia: [3, 4, 5], velocity: [6, 0, 0], angularVelocity: [0, 1, 0] };
    useAppStore.getState().addObject(wire);
    useAppStore.getState().setDisplay({ conductorOpacity: 0.25 });
    const before = useAppStore.getState();
    useAppStore.setState({ time: 8, playing: action === 'rewindSimulation', error: 'old error',
      measurements: { electricEnergy: 5 }, probes: [{ id: 'stale' } as never],
      chart: { series: ['E'], points: [{ t: 8, values: { E: 1 } }] } });
    useAppStore.getState()[action]();
    const after = useAppStore.getState();
    expect(after.scene).toBe(before.scene);
    expect(after.scene.objects.find(o => o.id === wire.id)).toEqual(wire);
    expect(after.scene.objects.find(o => o.id === plate.id)).toMatchObject({ potential: 17, position: [0.1, 0.2, 0.3] });
    expect(after.selectedId).toBe(wire.id);
    expect(after.presetId).toBe(before.presetId);
    expect(after.past).toBe(before.past);
    expect(after.future).toBe(before.future);
    expect(after.time).toBe(0);
    expect(after.playing).toBe(action === 'replaySimulation');
    expect(after.resetRequest).toBe(before.resetRequest + 1);
    expect(after.measurements).toEqual({});
    expect(after.probes).toEqual([]);
    expect(after.chart.points).toEqual([]);
    expect(after.error).toBeNull();
  });

  it('restores a preset as a distinct undoable action', () => {
    useAppStore.getState().loadPreset('point-charges');
    const first = useAppStore.getState().scene.objects[0];
    useAppStore.getState().updateObject(first.id, { position: [0.37, 0.2, 0] });
    const edited = useAppStore.getState().scene;
    useAppStore.getState().resetScene();
    expect(useAppStore.getState().scene.objects[0].position).not.toEqual([0.37, 0.2, 0]);
    useAppStore.getState().undo();
    expect(useAppStore.getState().scene).toEqual(edited);
  });
});
