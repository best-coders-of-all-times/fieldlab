import { describe, expect, it } from 'vitest';
import { buildMagnetostaticSources, sampleBAt } from '../src/engine/magnetostatics/biotSavart';
import { makeLoop, makeMagnet, makeWire } from '../src/scene/defaults';

describe('Biot–Savart', () => {
  it('gives the right direction and magnitude for a straight wire', () => {
    const wire = makeWire([[-1, 0, 0], [1, 0, 0]], 2);
    // Reorient the wire along z by rotating the local x axis onto z.
    wire.rotation = [0, -Math.PI / 2, 0];
    const { segments } = buildMagnetostaticSources([wire]);
    const B = sampleBAt(segments, [0.1, 0, 0]);
    expect(B[1]).toBeGreaterThan(0);
    expect(Math.abs(B[0])).toBeLessThan(1e-9);
    expect(Math.abs(B[2])).toBeLessThan(1e-9);
    // Finite-wire Biot–Savart, softened by the wire radius.
    const expected = (2e-7 * 2) / Math.hypot(0.1, segments.softening);
    expect(B[1]).toBeCloseTo(expected, 6);
  });

  it('orients a bar magnet from S to N', () => {
    const magnet = makeMagnet([0, 0, 0], 0.05, 0.24);
    const { segments } = buildMagnetostaticSources([magnet]);
    // Default axis is local +z; the N pole is at +z and the external field
    // just outside it must point away from the magnet.
    const onAxis = sampleBAt(segments, [0, 0, 0.2]);
    expect(onAxis[2]).toBeGreaterThan(0);
    const centre = sampleBAt(segments, [0, 0, 0]);
    expect(centre[2]).toBeGreaterThan(0);
  });

  it('turns a current loop into a dipole along its normal', () => {
    const loop = makeLoop([0, 0, 0], 0.2, 3);
    const { segments } = buildMagnetostaticSources([loop]);
    const B = sampleBAt(segments, [0, 0, 0]);
    expect(B[2]).toBeGreaterThan(0);
    expect(B[0]).toBeCloseTo(0, 12);
    // Centre field of a circular loop: μ0 I / (2 R).
    const expected = (4 * Math.PI * 1e-7 * 3) / (2 * 0.2);
    expect(B[2]).toBeGreaterThan(expected * 0.95);
    expect(B[2]).toBeLessThan(expected * 1.05);
  });
});
