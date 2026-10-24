import { describe, expect, it } from 'vitest';
import { Euler, Vector3 } from 'three';
import { localToWorld, worldToLocal, makeWire } from '../src/scene/defaults';
import { buildMagnetostaticSources, sampleBAt } from '../src/engine/magnetostatics/biotSavart';
import { wirePath } from '../src/scene/wirePath';

describe('Geometry shared by rendering and physics', () => {
  it('uses the same Euler XYZ convention as the viewport', () => {
    const wire = makeWire();
    wire.rotation = [0.4, -0.6, 0.8];
    wire.position = [0.1, 0.2, -0.1];
    const expected = new Vector3(0.2, -0.3, 0.4).applyEuler(new Euler(...wire.rotation));
    const world = localToWorld(wire, [0.2, -0.3, 0.4]);
    world.forEach((v, i) => expect(v - wire.position[i]).toBeCloseTo(expected.getComponent(i), 12));
    worldToLocal(wire, world).forEach((v, i) => expect(v).toBeCloseTo([0.2, -0.3, 0.4][i], 12));
  });

  it('keeps each wire radius independent of object ordering', () => {
    const thin = makeWire([[-0.4, 0, 0], [0.4, 0, 0]], 3);
    thin.wireRadius = 0.001;
    const thick = makeWire([[-0.4, 0.4, 0], [0.4, 0.4, 0]], 2);
    thick.wireRadius = 0.08;
    const a = sampleBAt(buildMagnetostaticSources([thin, thick]).segments, [0, 0.02, 0]);
    const b = sampleBAt(buildMagnetostaticSources([thick, thin]).segments, [0, 0.02, 0]);
    expect(a[2]).toBeCloseTo(b[2], 12);
  });

  it('uses the shared smooth centreline rather than the control polygon for current segments', () => {
    const wire = makeWire([[-0.2, 0, 0], [0, 0.2, 0], [0.2, 0, 0]], 2);
    wire.path = 'smooth';
    const path = wirePath(wire);
    expect(path.length).toBeGreaterThan(32);
    const segments = buildMagnetostaticSources([wire]).segments;
    // This short sampled arc needs no further segment subdivision.
    expect(segments.count).toBe(path.length - 1);
    const mid = Math.floor((path.length - 1) / 3);
    const segmentStart = Array.from(segments.segs.slice(mid * 6, mid * 6 + 3));
    expect(segmentStart[0]).toBeCloseTo(path[mid][0], 6);
    expect(segmentStart[1]).toBeCloseTo(path[mid][1], 6);
    expect(segmentStart[1]).toBeGreaterThan(0.1);
  });
});
