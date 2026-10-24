import { describe, expect, it } from 'vitest';
import { makeWire, makeLoop, makeCoil, localToWorld } from '../../src/scene/defaults';
import { wirePath } from '../../src/scene/wirePath';
import type { Vec3 } from '../../src/engine/math/vec3';
import { makeFilamentGeometry } from '../../src/engine/maxwell/conductingFilament';

describe('resolved passive conducting filament geometry', () => {
  it('keeps the physical wire radius and includes the finite end caps', () => {
    const wire = makeWire([[0, 0, 0], [1, 0, 0]]); wire.wireRadius = 0.03;
    const tube = makeFilamentGeometry(wire, 0.01);
    expect(tube.contains([0.5, 0.029, 0])).toBe(true);
    expect(tube.contains([0.5, 0.0301, 0])).toBe(false);
    expect(tube.contains([-0.029, 0, 0])).toBe(true);
    expect(tube.contains([-0.0301, 0, 0])).toBe(false);
    expect(tube.min).toEqual([-0.03, -0.03, -0.03]);
    expect(tube.max).toEqual([1.03, 0.03, 0.03]);
  });
  it('uses the closing segment only when the authored wire is closed', () => {
    const wire = makeWire([[0, 0, 0], [0.5, 0, 0], [0.5, 0.5, 0]]); wire.wireRadius = 0.03;
    expect(makeFilamentGeometry(wire, 0.01).contains([0.25, 0.25, 0])).toBe(false);
    wire.closed = true;
    expect(makeFilamentGeometry(wire, 0.01).contains([0.25, 0.25, 0])).toBe(true);
  });
  it('follows the shared smooth wire centreline rather than its control polygon', () => {
    const wire = makeWire([[-0.4, 0, 0], [0, 0.4, 0], [0.4, 0, 0]]); wire.wireRadius = 0.01; wire.path = 'smooth';
    const path = wirePath(wire), point = path[Math.floor(path.length / 4)];
    expect(makeFilamentGeometry(wire, 0.005).contains(point)).toBe(true);
    wire.path = 'polyline';
    expect(makeFilamentGeometry(wire, 0.005).contains(point)).toBe(false);
  });
  it('uses an exact toroidal tube without filling the loop aperture', () => {
    const loop = makeLoop([0, 0, 0], 0.3); loop.wireRadius = 0.03;
    const tube = makeFilamentGeometry(loop, 0.01);
    expect(tube.contains([0.32, 0, 0])).toBe(true);
    expect(tube.contains([0.331, 0, 0])).toBe(false);
    expect(tube.contains([0.3, 0, 0.029])).toBe(true);
    expect(tube.contains([0.3, 0, 0.031])).toBe(false);
    expect(tube.contains([0, 0, 0])).toBe(false);
  });
  it('captures the supplied Euler XYZ pose and returns enclosing world bounds', () => {
    const loop = makeLoop([0.2, -0.4, 0.6], 0.3); loop.wireRadius = 0.03; loop.rotation = [0.4, -0.6, 0.8];
    const tube = makeFilamentGeometry(loop, 0.01), centerline = localToWorld(loop, [0.3, 0, 0]);
    expect(tube.contains(centerline)).toBe(true);
    expect(tube.contains(localToWorld(loop, [0, 0, 0]))).toBe(false);
    for (let a = 0; a < 3; a++) { expect(centerline[a]).toBeGreaterThanOrEqual(tube.min[a]); expect(centerline[a]).toBeLessThanOrEqual(tube.max[a]); }
    loop.position[0] += 10;
    expect(tube.contains(centerline)).toBe(true);
  });
  it('follows the coil winding direction, rounded turn count and finite endpoints', () => {
    const coil = makeCoil([0, 0, 0], 0.3, 1.2, 2.2); coil.wireRadius = 0.03;
    const tube = makeFilamentGeometry(coil, 0.01);
    expect(tube.contains([0.3, 0, -0.6])).toBe(true);
    expect(tube.contains([0.3, 0, 0.6])).toBe(true);
    expect(tube.contains([0, 0.3, -0.45])).toBe(true);
    expect(tube.contains([0, -0.3, -0.45])).toBe(false);
    expect(tube.contains([0.3, 0, -0.631])).toBe(false);
    expect(tube.contains([0, 0, 0])).toBe(false);
  });
  it('matches a geometric nearest-segment reference for long diagonal segments', () => {
    const points: Vec3[] = [[-1, -1, -1], [1, 1, 1], [-1, 1, -1], [1, -1, 1]];
    const wire = makeWire(points); wire.wireRadius = 0.04;
    const tube = makeFilamentGeometry(wire, 0.02);
    const distance2 = (p: Vec3, a: Vec3, b: Vec3) => {
      const d = b.map((v, i) => v - a[i]), r = p.map((v, i) => v - a[i]);
      const t = Math.max(0, Math.min(1, d.reduce((s, v, i) => s + v * r[i], 0) / d.reduce((s, v) => s + v * v, 0)));
      return r.reduce((s, v, i) => s + (v - t * d[i]) ** 2, 0);
    };
    let seed = 12345;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (let n = 0; n < 500; n++) {
      const p: Vec3 = [random() * 2.2 - 1.1, random() * 2.2 - 1.1, random() * 2.2 - 1.1];
      const expected = points.slice(1).some((b, i) => distance2(p, points[i], b) <= wire.wireRadius ** 2);
      expect(tube.contains(p)).toBe(expected);
    }
  });
  it('rejects unresolved thickness and invalid geometry with actionable errors', () => {
    const wire = makeWire(); wire.wireRadius = 0.014;
    expect(() => makeFilamentGeometry(wire, 0.01)).toThrow(/radius.*0.015|spacing|resolution/i);
    wire.wireRadius = 0;
    expect(() => makeFilamentGeometry(wire, 0.01)).toThrow(/radius.*positive|positive.*radius/i);
    wire.wireRadius = 0.03; wire.points = [[0, 0, 0], [0, 0, 0]];
    expect(() => makeFilamentGeometry(wire, 0.01)).toThrow(/length|distinct|degenerate/i);
    const coil = makeCoil(); coil.wireRadius = 0.03; coil.length = NaN;
    expect(() => makeFilamentGeometry(coil, 0.01)).toThrow(/finite|length/i);
  });
});
