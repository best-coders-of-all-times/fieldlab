import { describe, expect, it } from 'vitest';
import { StaticsEngine } from '../src/engine/staticsEngine';
import { makeScene, makeCharge, makeConductor, makeMagnet, makeProbe } from '../src/scene/defaults';

describe('Static fields and live sampling', () => {
  it('includes incoming external field lines even when charges supply seeds', () => {
    const scene = makeScene({ name: 'applied field', objects: [makeCharge()] });
    scene.simulation.staticBoundary = 'open';
    scene.simulation.externalField = [0, 1000, 0];
    const engine = new StaticsEngine(scene);
    expect(engine.sampleE([0.3, 0, 0])[1]).toBeCloseTo(1000);
    const lines = engine.fieldLines('E', 24);
    expect(lines.some(l => l.points[1] < -0.45)).toBe(true);
  });

  it('reports uniform magnetic energy and presence without magnetic objects', () => {
    const scene = makeScene({ name: 'uniform B' });
    scene.simulation.externalB = [0, 0, 0.002];
    const engine = new StaticsEngine(scene);
    expect(engine.summary.hasB).toBe(true);
    expect(engine.summary.magneticEnergy).toBeCloseTo(1.59154943, 5);
  });

  it('ignores hidden materials when choosing the electrostatic solver', () => {
    const hidden = makeConductor();
    hidden.visible = false;
    const engine = new StaticsEngine(makeScene({ name: 'hidden', objects: [hidden] }));
    expect(engine.summary.hasGrid).toBe(false);
  });

  it('updates field samples and lines when a magnetic source moves', () => {
    const magnet = makeMagnet();
    const probe = makeProbe([0.2, 0, 0]);
    const engine = new StaticsEngine(makeScene({ name: 'moving', objects: [magnet, probe] }));
    const before = engine.probes()[0].Bmag;
    engine.updateMotion([{ id: magnet.id, position: [0.25, 0, 0], rotation: [0, 0, 0] }]);
    const after = engine.probes()[0];
    expect(after.id).toBe(probe.id);
    expect(after.Bmag).toBeGreaterThan(before * 2);
    const lines = engine.fieldLines('B', 12);
    expect(lines.some(l => l.points[0] > 0.25)).toBe(true);
  });

  it('clears unavailable capacitance and refreshes diagnostics when electrode geometry moves', () => {
    const a = makeConductor([-0.15, 0, 0], 'box', [0.04, 0.3, 0.3]);
    const b = makeConductor([0.15, 0, 0], 'box', [0.04, 0.3, 0.3]);
    a.potential = 1;
    const scene = makeScene({ name: 'moving capacitor', objects: [a, b] });
    scene.simulation.resolution = 48;
    const engine = new StaticsEngine(scene);
    expect(engine.summary.differentialCapacitance).toBeGreaterThan(0);
    engine.updateMotion([{ id: a.id, position: [-0.25, 0, 0], rotation: [0, 0, 0] }]);
    expect(engine.summary.differentialCapacitance).toBeUndefined();
    expect(engine.summary.capacitanceMatrix).toEqual([]);
    expect(engine.summary.stats.solveMs).toBe(engine.poisson!.stats.solveMs);
  });
});
