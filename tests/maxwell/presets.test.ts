import { describe, expect, it } from 'vitest';
import { MaxwellSceneSolver } from '../../src/engine/maxwell/sceneSolver';
import { getPreset, PRESET_GROUPS } from '../../src/scene/presets';
import { motionVelocityAt } from '../../src/scene/motion';
import { restoreScene } from '../../src/app/restoreScene';

describe('experimental Maxwell demos', () => {
  it.each(['maxwell-moving-capacitor', 'maxwell-passive-pickup'])('runs %s on the authored physical clock with coherent finite samples', id => {
    const preset = getPreset(id);
    expect(preset).toBeDefined();
    expect(preset!.group).toBe('Maxwell FDTD');
    expect(PRESET_GROUPS).toContain('Maxwell FDTD');
    const scene = preset!.create();
    const restored = restoreScene(JSON.parse(JSON.stringify(scene)), scene)!;
    expect(restored.simulation.resolution).toBe(16);
    expect(scene.simulation.useApproximation).toBe(false);
    expect(scene.simulation).toMatchObject({ resolution: 16, pmlCells: 4, cfl: 0.9, stepsPerFrame: 2 });
    for (const source of scene.objects.filter(object => object.motion)) {
      expect(Math.hypot(...motionVelocityAt(source, 0, source.position))).toBeLessThan(1e-8);
    }
    const solver = new MaxwellSceneSolver(scene);
    const moving = scene.objects.find(object => object.motion)!;
    const initialPose = solver.pose(moving).position;
    solver.step(2);
    expect(solver.steps).toBe(2);
    expect(solver.time).toBeCloseTo(2 * solver.meta.dt, 22);
    expect(solver.time).toBeGreaterThan(0);
    expect(solver.time).toBeLessThan(1e-9);
    expect(solver.pose(moving).position).not.toEqual(initialPose);
    const diagnostics = solver.diagnostics();
    expect(Object.values(diagnostics).every(Number.isFinite)).toBe(true);
    expect(diagnostics.gaussRelative).toBeLessThan(1e-4);
    expect(diagnostics.totalEnergy).toBeGreaterThan(0);
    const probe = scene.objects.find(object => object.kind === 'probe')!;
    const sample = solver.sample(probe.position);
    expect([...sample.E, ...sample.B, ...sample.D, ...sample.H, ...sample.J, sample.rho].every(Number.isFinite)).toBe(true);
  });

  it('declares isolated electrodes and a resolved passive pickup instead of hidden voltage or current drives', () => {
    const capacitor = getPreset('maxwell-moving-capacitor')!.create();
    expect(capacitor.simulation.maxwellConductorModel).toBe('isolated');
    const plates = capacitor.objects.filter(object => object.kind === 'conductor');
    expect(plates.map(plate => plate.potential)).toEqual([3, -3]);
    expect(plates.every(plate => plate.conductivity === 0.01)).toBe(true);
    const pickup = getPreset('maxwell-passive-pickup')!.create();
    const loop = pickup.objects.find(object => object.kind === 'loop')!;
    expect(loop).toMatchObject({ electricalModel: 'conducting', conductivity: 0.01, current: 0 });
    expect(loop.wireRadius).toBeGreaterThanOrEqual(1.5 / pickup.simulation.resolution);
    const magnet = pickup.objects.find(object => object.kind === 'magnet')!;
    expect(magnet).toMatchObject({ radius: 0.07, length: 0.2, magnetization: 10, axis: [0, 0, 1] });
  });
});
