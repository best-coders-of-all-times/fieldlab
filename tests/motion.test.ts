import { describe, expect, it } from 'vitest';
import { motionAt, motionVelocityAt } from '../src/scene/motion';
import { localToWorld, makeCharge } from '../src/scene/defaults';

describe('prescribed motion kinematics', () => {
  it('uses the active fast keyframe segment rather than averaging over another timescale', () => {
    const o = makeCharge();
    o.motion = { kind: 'keyframes', loop: false, keyframes: [
      { time: 0, position: [0, 0, 0], rotation: [0, 0, 0] },
      { time: 1e-8, position: [1, 0, 0], rotation: [0, 0, 0] },
      { time: 2e-8, position: [5, 0, 0], rotation: [0, 0, 0] },
    ] };
    expect(motionVelocityAt(o, 0.5e-8, [0.5, 0, 0])).toEqual([1e8, 0, 0]);
    expect(motionVelocityAt(o, 1.5e-8, [3, 0, 0])[0]).toBeCloseTo(4e8, 5);
    expect(motionVelocityAt(o, -1, [0, 0, 0])).toEqual([0, 0, 0]);
    expect(motionVelocityAt(o, 2e-8, [5, 0, 0])).toEqual([0, 0, 0]);
  });

  it('differentiates oscillator phase and spin about a world axis exactly', () => {
    const o = makeCharge([1, 2, 3]);
    o.motion = { kind: 'oscillate', axis: [0, 2, 0], amplitude: 0.3, frequency: 7, phase: 0.7 };
    expect(motionVelocityAt(o, 0.04, [1, 2, 3])[1]).toBeCloseTo(0.3 * 14 * Math.PI * Math.cos(14 * Math.PI * 0.04 + 0.7), 12);
    o.rotation = [0.4, 0.5, 0.6];
    o.motion = { kind: 'spin', axis: [0, 0, 2], amplitude: 0, frequency: 2 };
    expect(motionVelocityAt(o, 0.03, [2, 2, 3])).toEqual([0, 4 * Math.PI, 0]);
  });

  it('converts interpolated XYZ Euler rates into world angular velocity', () => {
    const o = makeCharge([0.1, 0.2, 0.3]); o.rotation = [0.2, 0.4, -0.6];
    o.motion = { kind: 'keyframes', loop: false, keyframes: [
      { time: 0, position: [0, 0, 0], rotation: [0, 0, 0] },
      { time: 2, position: [0.2, 0.4, -0.6], rotation: [0.6, -0.8, 1.2] },
    ] };
    const t = 0.7, local: [number, number, number] = [0.4, -0.3, 0.2];
    const p = localToWorld({ ...o, ...motionAt(o, t) }, local);
    const a = localToWorld({ ...o, ...motionAt(o, t - 1e-6) }, local);
    const b = localToWorld({ ...o, ...motionAt(o, t + 1e-6) }, local);
    const v = motionVelocityAt(o, t, p);
    for (let i = 0; i < 3; i++) expect(v[i]).toBeCloseTo((b[i] - a[i]) / 2e-6, 8);
  });

  it('keeps fixed and force-driven authored poses independent of saved prescribed trajectories', () => {
    const o = makeCharge([1, 2, 3]);
    o.motion = { kind: 'oscillate', axis: [1, 0, 0], amplitude: 3, frequency: 2 };
    for (const mode of ['fixed', 'forceDriven'] as const) {
      o.dynamics = { mode, mass: 1, inertia: [1, 1, 1], velocity: [2, 0, 0], angularVelocity: [0, 0, 1] };
      expect(motionAt(o, 0.1).position).toEqual(o.position);
      expect(motionVelocityAt(o, 0.1, [2, 2, 3])).toEqual([0, 0, 0]);
    }
  });

  it('rejects nonfinite and unordered keyframes before interpolation', () => {
    const o = makeCharge();
    o.motion = { kind: 'keyframes', loop: false, keyframes: [
      { time: 1, position: [0, 0, 0], rotation: [0, 0, 0] },
      { time: 1, position: [1, 0, 0], rotation: [0, 0, 0] },
    ] };
    expect(() => motionAt(o, 0)).toThrow(/ordered|increas/i);
    o.motion.keyframes[1].time = 2; o.motion.keyframes[1].rotation[0] = NaN;
    expect(() => motionVelocityAt(o, 0, [0, 0, 0])).toThrow(/finite/i);
  });
});
