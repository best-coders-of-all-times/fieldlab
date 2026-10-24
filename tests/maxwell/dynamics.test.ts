import { describe, expect, it } from 'vitest';
import { advanceParticle, momentumFromVelocity, velocityFromMomentum, validateSubluminalVelocity, C_LIGHT } from '../../src/engine/maxwell/dynamics';

describe('SI relativistic Boris dynamics', () => {
  it('drifts a free particle at its relativistic velocity', () => {
    const p = momentumFromVelocity([0.8 * C_LIGHT, 0, 0], 2);
    const next = advanceParticle([1, 2, 3], p, 1, 2, [0, 0, 0], [0, 0, 0], 1e-9);
    expect(next.position[0]).toBeCloseTo(1 + 0.8 * C_LIGHT * 1e-9, 13);
    expect(next.position.slice(1)).toEqual([2, 3]);
    expect(next.momentum).toEqual(p);
    expect(next.velocity[0] / C_LIGHT).toBeCloseTo(0.8, 14);
  });
  it('gives the exact uniform electric momentum impulse and reverses it with charge', () => {
    for (const q of [-2, 2]) {
      const next = advanceParticle([0, 0, 0], [0, 0, 0], q, 3, [4, -5, 6], [0, 0, 0], 0.2);
      expect(next.momentum[0]).toBeCloseTo(q * 4 * 0.2, 14);
      expect(next.momentum[1]).toBeCloseTo(-q, 14);
      expect(next.momentum[2]).toBeCloseTo(q * 6 * 0.2, 14);
    }
  });
  it('preserves relativistic kinetic energy in a magnetic field and rotates with charge sign', () => {
    const p = momentumFromVelocity([0.9 * C_LIGHT, 0, 0], 1);
    let state = { position: [0, 0, 0] as [number, number, number], momentum: p, velocity: [0, 0, 0] as [number, number, number] };
    for (let i = 0; i < 1000; i++) state = advanceParticle(state.position, state.momentum, 1, 1, [0, 0, 0], [0, 0, 10], 0.01);
    expect(Math.hypot(...state.momentum) / Math.hypot(...p)).toBeCloseTo(1, 13);
    expect(Math.hypot(...state.velocity)).toBeLessThan(C_LIGHT);
    expect(advanceParticle([0, 0, 0], [1, 0, 0], 1, 1, [0, 0, 0], [0, 0, 1], 0.1).momentum[1]).toBeLessThan(0);
    expect(advanceParticle([0, 0, 0], [1, 0, 0], -1, 1, [0, 0, 0], [0, 0, 1], 0.1).momentum[1]).toBeGreaterThan(0);
  });
  it('rejects superluminal prescribed motion and nonphysical particle parameters', () => {
    expect(() => validateSubluminalVelocity([C_LIGHT, 0, 0])).toThrow(/light|speed|subluminal/i);
    expect(() => momentumFromVelocity([0, NaN, 0], 1)).toThrow(/finite/i);
    expect(() => advanceParticle([0, 0, 0], [0, 0, 0], 1, 0, [0, 0, 0], [0, 0, 0], 1)).toThrow(/mass/i);
    expect(() => velocityFromMomentum([Infinity, 0, 0], 1)).toThrow(/finite/i);
  });
});
