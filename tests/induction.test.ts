import { describe, expect, it } from 'vitest';
import { InductionSystem } from '../src/engine/induction/system';
import { getPreset } from '../src/scene/presets';

function run(id: string, seconds: number) {
  const scene = getPreset(id)!.create();
  const system = new InductionSystem(scene);
  expect(system.active).toBe(true);
  const frames = [];
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    const frame = system.advance(1 / 60, 1);
    expect(frame).not.toBeNull();
    frames.push(frame!);
  }
  return { scene, system, frames };
}

describe('Induction demos', () => {
  it('moves the magnet and drives a changing flux', () => {
    const { frames } = run('magnet-loop', 3.5);
    const fluxes = frames.map((f) => f.readings[0].flux);
    const emfs = frames.map((f) => f.readings[0].emf);
    const maxFlux = Math.max(...fluxes.map(Math.abs));
    const maxEmf = Math.max(...emfs.map(Math.abs));
    expect(maxFlux).toBeGreaterThan(1e-4);
    expect(maxEmf).toBeGreaterThan(1e-4);
    // For this coaxial geometry the flux keeps one sign but varies strongly.
    expect(Math.max(...fluxes)).toBeGreaterThan(Math.min(...fluxes) * 3);
    expect(Math.min(...fluxes)).toBeGreaterThan(0);
    const positions = frames.map((f) => f.transforms[0].position[0]);
    expect(Math.max(...positions) - Math.min(...positions)).toBeGreaterThan(0.4);
  });

  it('reaches the analytic AC generator amplitude', () => {
    const { frames } = run('rotating-loop', 2.2);
    const emfs = frames.map((f) => f.readings[0].emf);
    const b = 2e-3;
    const a = Math.PI * 0.22 * 0.22;
    const omega = 2 * Math.PI * 0.5;
    const expected = b * a * omega;
    const measured = Math.max(...emfs.map(Math.abs));
    expect(measured).toBeGreaterThan(expected * 0.75);
    expect(measured).toBeLessThan(expected * 1.15);
  });

  it('gives Bℓv for the sliding rod', () => {
    const { frames } = run('rod-rails', 2.2);
    const emfs = frames.map((f) => f.readings[0].emf);
    const expected = 0.05 * 0.24 * (2 * Math.PI * 0.5 * 0.16);
    const measured = Math.max(...emfs.map(Math.abs));
    expect(measured).toBeGreaterThan(expected * 0.85);
    expect(measured).toBeLessThan(expected * 1.08);
  });
});
