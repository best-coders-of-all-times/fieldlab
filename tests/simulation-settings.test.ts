import { afterEach, describe, expect, it } from 'vitest';
import { restoreScene } from '../src/app/restoreScene';
import { useAppStore } from '../src/app/store';
import { defaultSimulation, makeScene, makeConductor, makeWire, makeLoop, makeCoil, makeDielectric, makeCharge, makeParticle } from '../src/scene/defaults';
import { getPreset } from '../src/scene/presets';

const initial = useAppStore.getState();
afterEach(() => useAppStore.setState(initial, true));

describe('simulation model migration', () => {
  it.each([makeCharge(), makeParticle()])('retains undefined legacy $kind source profiles through reload, rewind and solver switches', object => {
    const scene = makeScene({ name: 'legacy source', objects: [object] });
    useAppStore.setState({ scene });
    for (const useApproximation of [false, true, false]) {
      useAppStore.getState().setSimulation({ useApproximation });
      useAppStore.getState().rewindSimulation();
      const restored = restoreScene(JSON.parse(JSON.stringify(useAppStore.getState().scene)), scene)!;
      expect(restored.objects[0]).not.toHaveProperty('sourceProfile');
      expect(restored.objects[0]).not.toHaveProperty('sourceWidth');
    }
  });

  it.each([makeCharge(), makeParticle()])('preserves explicit $kind source shape and dormant SI width through export, rewind and solver switches', object => {
    const scene = makeScene({ name: 'finite source', objects: [object] });
    useAppStore.setState({ scene });
    useAppStore.getState().updateObject(object.id, { sourceProfile: 'smooth', sourceWidth: 0.073 });
    for (const sourceProfile of ['smooth', 'cic', 'smooth'] as const) {
      useAppStore.getState().updateObject(object.id, { sourceProfile });
      for (const useApproximation of [false, true]) {
        useAppStore.getState().setSimulation({ useApproximation });
        useAppStore.getState().rewindSimulation();
        const restored = restoreScene(JSON.parse(JSON.stringify(useAppStore.getState().scene)), scene)!;
        expect(restored.objects[0]).toMatchObject({ sourceProfile, sourceWidth: 0.073 });
        expect(restored.simulation.useApproximation).toBe(useApproximation);
      }
    }
  });

  it('provides a neutral Maxwell charging capacitor with explicit stationary terminal contacts and a visible return route', () => {
    const preset = getPreset('maxwell-charging-capacitor');
    expect(preset).toBeDefined();
    const scene = preset!.create();
    expect(scene.simulation).toMatchObject({ useApproximation: false, resolution: 16, maxwellConductorModel: 'isolated' });
    const plates = scene.objects.filter(o => o.kind === 'conductor');
    expect(plates).toHaveLength(2);
    for (const plate of plates) {
      expect(plate).toMatchObject({ shape: 'box', size: [0.125, 0.45, 0.5], floating: true, netCharge: 0, conductivity: 0.01 });
      expect(plate.motion).toBeUndefined();
    }
    expect(plates.map(o => o.position)).toEqual([[-0.1875, 0, 0], [0.1875, 0, 0]]);
    const feed = scene.objects.find(o => o.kind === 'wire');
    expect(feed).toMatchObject({ electricalModel: 'currentFeed', current: 0.01, closed: false, path: 'polyline', position: [0, 0, 0],
      terminalFeed: { from: plates[0].id, to: plates[1].id, riseTime: 1e-9 },
      points: [[-0.1875, 0, 0], [-0.1875, -0.375, 0], [0.1875, -0.375, 0], [0.1875, 0, 0]] });
    expect(feed?.motion).toBeUndefined();
  });

  it('retains terminal references, SI rise time and inactive current/conductivity across model switches and save reload', () => {
    const wire = makeWire();
    const from = makeConductor([-0.2, 0, 0]);
    const to = makeConductor([0.2, 0, 0]);
    const terminalFeed = { from: from.id, to: to.id, riseTime: 2e-9 };
    useAppStore.setState({ scene: makeScene({ name: 'terminal feed', objects: [wire, from, to] }) });
    useAppStore.getState().updateObject(wire.id, { electricalModel: 'currentFeed', terminalFeed, current: -0.02, conductivity: 0.025 });
    for (const electricalModel of ['conducting', 'impressed', 'currentFeed'] as const) {
      useAppStore.getState().updateObject(wire.id, { electricalModel });
      const restored = restoreScene(JSON.parse(JSON.stringify(useAppStore.getState().scene)), makeScene({ name: 'base' }))!;
      expect(restored.objects[0]).toMatchObject({ electricalModel, terminalFeed, current: -0.02, conductivity: 0.025 });
    }
  });

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
  it('changes a saved physical target without resetting time, fields or playback', () => {
    useAppStore.setState({ time: 4e-9, playing: true, measurements: { electricEnergy: 9 } });
    const before = useAppStore.getState();
    useAppStore.getState().setSimulation({ targetTime: 8e-9 });
    const after = useAppStore.getState();
    expect(after.time).toBe(4e-9); expect(after.playing).toBe(true);
    expect(after.resetRequest).toBe(before.resetRequest); expect(after.measurements.electricEnergy).toBe(9);
    expect(restoreScene(JSON.parse(JSON.stringify(after.scene)), before.scene)!.simulation.targetTime).toBe(8e-9);
    useAppStore.getState().rewindSimulation();
    expect(useAppStore.getState().scene.simulation.targetTime).toBe(8e-9);
  });

});
