import { describe, expect, it } from 'vitest';
import { borisStep, gyroperiod, gyroradius } from '../src/engine/particles/boris';
import { ParticleSystem } from '../src/engine/particles/system';
import { getPreset } from '../src/scene/presets';
import type { Vec3 } from '../src/engine/math/vec3';

const ELECTRON_Q = -1.602176634e-19;
const ELECTRON_M = 9.1093837015e-31;

describe('Boris pusher', () => {
  it('conserves speed in a pure magnetic field', () => {
    const B: Vec3 = [0, 0, 0.012];
    const period = gyroperiod(ELECTRON_Q, ELECTRON_M, 0.012);
    const dt = period / 240;
    let position: Vec3 = [0, 0, 0];
    let velocity: Vec3 = [1e6, 0, 0];
    const v0 = Math.hypot(...velocity);
    for (let i = 0; i < 240 * 8; i++) {
      const next = borisStep({ position, velocity, charge: ELECTRON_Q, mass: ELECTRON_M, E: [0, 0, 0], B, dt });
      position = next.position;
      velocity = next.velocity;
    }
    const v1 = Math.hypot(...velocity);
    expect(Math.abs(v1 - v0) / v0).toBeLessThan(1e-9);
    // Eight full periods return to the start.
    expect(Math.hypot(...position)).toBeLessThan(2e-5);
  });

  it('reproduces the analytic gyroradius', () => {
    const B: Vec3 = [0, 0, 1.2e-4];
    const r = gyroradius([1e6, 0, 0], ELECTRON_Q, ELECTRON_M, B);
    expect(r).toBeCloseTo(0.0474, 3);
  });

  it('drifts at E x B / B^2 in crossed fields', () => {
    const E: Vec3 = [0, 30, 0];
    const B: Vec3 = [0, 0, 1.2e-4];
    const vd = E[1] / B[2]; // 2.5e5 m/s along +x
    const period = gyroperiod(ELECTRON_Q, ELECTRON_M, B[2]);
    const dt = period / 200;
    let position: Vec3 = [0, 0, 0];
    let velocity: Vec3 = [0, 0, 0];
    const steps = Math.round((period * 40) / dt);
    for (let i = 0; i < steps; i++) {
      const next = borisStep({ position, velocity, charge: ELECTRON_Q, mass: ELECTRON_M, E, B, dt });
      position = next.position;
      velocity = next.velocity;
    }
    const elapsed = steps * dt;
    expect(position[0] / elapsed).toBeCloseTo(vd, -3);
    expect(Math.abs(position[1])).toBeLessThan(0.12);
    expect(Math.abs(position[2])).toBeLessThan(1e-9);
  });
});

describe('ParticleSystem', () => {
  it('advances the preset particle and records a trail inside the domain', () => {
    const scene = getPreset('lorentz-eb')!.create();
    const system = new ParticleSystem(scene);
    expect(system.active).toBe(true);
    let frame = system.advance(1 / 60, 1);
    expect(frame).not.toBeNull();
    for (let i = 0; i < 120; i++) frame = system.advance(1 / 60, 1);
    const p = frame!.particles[0];
    expect(system.time).toBeGreaterThan(0);
    expect(frame!.time).toBeCloseTo(system.time, 12);
    expect(p.trail.length / 3).toBeGreaterThan(50);
    const half = scene.domain.size.map((v) => v / 2) as Vec3;
    for (let a = 0; a < 3; a++) {
      expect(Math.abs(p.position[a] - scene.domain.center[a])).toBeLessThan(half[a]);
    }
    expect(p.speed).toBeGreaterThan(1e5);
    expect(p.speed).toBeLessThan(5e6);
    expect(Number.isFinite(p.gyroRadius)).toBe(true);
    expect(p.gyroPeriod).toBeGreaterThan(0);
  });
});
