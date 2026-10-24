import { afterEach, describe, expect, it } from 'vitest';
import { restoreScene } from '../src/app/restoreScene';
import { useAppStore } from '../src/app/store';
import { defaultSimulation, makeScene, makeConductor, makeWire, makeLoop, makeCoil, makeDielectric } from '../src/scene/defaults';

const initial = useAppStore.getState();
afterEach(() => useAppStore.setState(initial, true));

describe('simulation model migration', () => {
  it('keeps legacy dielectrics linear and round trips retained Drude parameters after switching to linear', () => {
    const legacy = makeScene({ name: 'legacy', objects: [makeDielectric()] });
    const restoredLegacy = restoreScene(JSON.parse(JSON.stringify(legacy)), makeScene({ name: 'base' }))!;
    expect(restoredLegacy.objects[0]).not.toHaveProperty('materialModel');
    expect(restoredLegacy.objects[0]).not.toHaveProperty('drude');
    const material = makeDielectric();
    material.materialModel = 'drude'; material.drude = { omegaP: 2e9, gamma: 3e8 };
    const scene = makeScene({ name: 'dispersion', objects: [material] });
    scene.simulation.useApproximation = false;
    useAppStore.setState({ scene });
    useAppStore.getState().updateObject(material.id, { materialModel: 'linear' });
    const restored = restoreScene(JSON.parse(JSON.stringify(useAppStore.getState().scene)), legacy)!;
    expect(restored.objects[0]).toMatchObject({ materialModel: 'linear', drude: { omegaP: 2e9, gamma: 3e8 } });
  });
  it.each([makeWire(), makeLoop(), makeCoil()])('starts a new $kind as an impressed source and preserves an explicit passive model on save', object => {
    expect(object.electricalModel).toBe('impressed');
    expect(object.conductivity).toBe(0.01);
    const saved = makeScene({ name: 'passive', objects: [{ ...object, electricalModel: 'conducting', conductivity: 0.025 }] });
    const restored = restoreScene(JSON.parse(JSON.stringify(saved)), makeScene({ name: 'base' }))!;
    expect(restored.objects[0]).toMatchObject({ electricalModel: 'conducting', conductivity: 0.025, current: object.current, wireRadius: object.wireRadius });
  });
  it('keeps legacy saves in approximation mode even when importing into a full Maxwell scene', () => {
    const base = makeScene({ name: 'Maxwell' });
    base.simulation.useApproximation = false;
    const restored = restoreScene({ mode: 'fields', objects: [], simulation: { resolution: 48 } }, base)!;
    expect(restored.simulation.useApproximation).toBe(true);
    expect(defaultSimulation().useApproximation).toBe(true);
  });

  it('round trips an explicit Maxwell and isolated conductor setup', () => {
    const scene = makeScene({ name: 'isolated', objects: [makeConductor()] });
    scene.simulation.useApproximation = false;
    scene.simulation.maxwellConductorModel = 'isolated';
    const restored = restoreScene(JSON.parse(JSON.stringify(scene)), makeScene({ name: 'base' }))!;
    expect(restored.simulation.useApproximation).toBe(false);
    expect(restored.simulation.maxwellConductorModel).toBe('isolated');
    expect(restored.objects[0].kind === 'conductor' && restored.objects[0].conductivity).toBe(0.01);
  });

  it('pauses and clears old runtime observations when changing the physical model, and retains an undo entry', () => {
    useAppStore.setState({ time: 4, playing: true, measurements: { electricEnergy: 9 } });
    const before = useAppStore.getState();
    useAppStore.getState().setSimulation({ useApproximation: false });
    const after = useAppStore.getState();
    expect(after.playing).toBe(false);
    expect(after.time).toBe(0);
    expect(after.measurements).toEqual({});
    expect(after.past.at(-1)).toEqual(before.scene);
    useAppStore.getState().undo();
    expect(useAppStore.getState().scene.simulation.useApproximation).toBe(true);
  });

  it('changes playback pacing without rewinding physical state', () => {
    useAppStore.setState({ time: 4, playing: true, measurements: { electricEnergy: 9 } });
    const before = useAppStore.getState();
    useAppStore.getState().setSimulation({ stepsPerFrame: 7 });
    const after = useAppStore.getState();
    expect(after.time).toBe(4);
    expect(after.playing).toBe(true);
    expect(after.resetRequest).toBe(before.resetRequest);
    expect(after.measurements.electricEnergy).toBe(9);
  });
});
