import { describe, expect, it } from 'vitest';
import { K_E } from '../../src/engine/constants';
import type { Vec3 } from '../../src/engine/math/vec3';
import { CoulombBoundaryEvaluator, directCoulombPotentials } from '../../src/engine/maxwell/coulombBoundary';

function capacitor() {
  const positions: Vec3[] = [], charge: number[] = [];
  for (let j = 0; j < 41; j++) for (let k = 0; k < 41; k++) {
    const y = -0.25 + j / 80 + 0.037, z = -0.2 + k / 100 - 0.021;
    const q = 1e-12 * (1 + 0.17 * Math.sin(j * 0.63) + 0.12 * Math.cos(k * 0.49));
    positions.push([-0.05, y, z], [0.19, y, z]); charge.push(q, -q);
  }
  const targets: Vec3[] = [];
  const lo = [-0.7, -0.6, -0.8], hi = [0.9, 0.75, 0.65];
  for (let axis = 0; axis < 3; axis++) for (let side = 0; side < 2; side++) for (let j = 0; j < 7; j++) for (let k = 0; k < 7; k++) {
    const p: Vec3 = [0, 0, 0], a = (axis + 1) % 3, b = (axis + 2) % 3;
    p[axis] = side ? hi[axis] : lo[axis]; p[a] = lo[a] + j / 6 * (hi[a] - lo[a]); p[b] = lo[b] + k / 6 * (hi[b] - lo[b]);
    targets.push(p);
  }
  return { positions, charges: Float64Array.from(charge), targets };
}
const relativeError = (actual: Float64Array, expected: Float64Array) => {
  let err = 0, scale = 0;
  for (let i = 0; i < actual.length; i++) { err = Math.max(err, Math.abs(actual[i] - expected[i])); scale = Math.max(scale, Math.abs(expected[i])); }
  return err / scale;
};

describe('free-space Coulomb boundary evaluator', () => {
  it('matches literal signed SI Coulomb potentials without softening', () => {
    const p: Vec3[] = [[0, 0, 0], [1, 0, 0]], q = new Float64Array([2e-10, -1e-10]);
    const targets: Vec3[] = [[2, 0, 0], [0, 1, 0]];
    const direct = directCoulombPotentials(p, q, targets);
    expect(direct[0]).toBeCloseTo(0, 14);
    expect(direct[1]).toBeCloseTo(K_E * (2e-10 - 1e-10 / Math.sqrt(2)), 13);
    const evaluator = new CoulombBoundaryEvaluator(p);
    evaluator.setCharges(q);
    expect(evaluator.evaluate(targets)).toEqual(direct);
  });
  it('resolves an off-centre neutral capacitor on face centres, edges and corners', () => {
    const c = capacitor(), tree = new CoulombBoundaryEvaluator(c.positions);
    tree.setCharges(c.charges);
    const direct = tree.evaluateDirect(c.targets);
    expect(relativeError(tree.evaluate(c.targets), direct)).toBeLessThan(1e-4);
  });
  it('retains the hand-calculated leading dipole and quadrupole when net charge vanishes', () => {
    const q = 1e-12, r = 1000;
    const dipole = new CoulombBoundaryEvaluator([[1, 0, 0], [-1, 0, 0]], { leafSize: 1 });
    dipole.setCharges(new Float64Array([q, -q]));
    expect(dipole.evaluate([[r, 0, 0]])[0] * r ** 2 / (K_E * q)).toBeCloseTo(2, 13);
    const quadrupole = new CoulombBoundaryEvaluator([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]], { leafSize: 1 });
    quadrupole.setCharges(new Float64Array([q, q, -q, -q]));
    expect(quadrupole.evaluate([[r, 0, 0]])[0] * r ** 3 / (K_E * q)).toBeCloseTo(3, 13);
  });
  it('converges to direct sums as the geometric opening angle is refined', () => {
    const c = capacitor(), direct = directCoulombPotentials(c.positions, c.charges, c.targets);
    const errors = [0.4, 0.2, 0.1].map(openingAngle => {
      const tree = new CoulombBoundaryEvaluator(c.positions, { openingAngle, leafSize: 12 }); tree.setCharges(c.charges);
      return relativeError(tree.evaluate(c.targets), direct);
    });
    expect(errors[2]).toBeLessThan(1e-4);
    expect(errors[2]).toBeLessThan(errors[0] / 8);
    expect(errors[2]).toBeLessThan(errors[1] / 3);
  });
  it('reuses the same geometry with a linear map for independent charge vectors', () => {
    const c = capacitor(), tree = new CoulombBoundaryEvaluator(c.positions, { openingAngle: 0.45, leafSize: 12 });
    const q2 = Float64Array.from(c.charges, (q, i) => q * Math.cos(i * 0.79));
    tree.setCharges(c.charges); const first = tree.evaluate(c.targets);
    tree.setCharges(q2); const second = tree.evaluate(c.targets);
    tree.setCharges(Float64Array.from(q2, (q, i) => 1.3 * c.charges[i] - 0.7 * q)); const combined = tree.evaluate(c.targets);
    const expected = Float64Array.from(first, (q, i) => 1.3 * q - 0.7 * second[i]);
    expect(relativeError(combined, expected)).toBeLessThan(5e-14);
    tree.setCharges(new Float64Array(c.charges.length)); expect(tree.evaluate(c.targets).every(x => x === 0)).toBe(true);
  });
  it('supports exact theta zero, duplicate sources, empty sources and output reuse', () => {
    const positions: Vec3[] = [[0, 0, 0], [0, 0, 0], [0.3, 0.2, -0.4]], charges = new Float64Array([1, -2, 3]);
    const targets: Vec3[] = [[1, 2, 3]], tree = new CoulombBoundaryEvaluator(positions, { openingAngle: 0, leafSize: 1 });
    tree.setCharges(charges); const output = new Float64Array(1);
    expect(tree.evaluate(targets, output)).toBe(output);
    expect(output[0]).toBeCloseTo(directCoulombPotentials(positions, charges, targets)[0], 5);
    const empty = new CoulombBoundaryEvaluator([]); empty.setCharges(new Float64Array()); expect(empty.evaluate(targets)[0]).toBe(0);
  });
  it('rejects nonfinite values, mismatched arrays and coincident targets explicitly', () => {
    expect(() => new CoulombBoundaryEvaluator([[NaN, 0, 0]])).toThrow(/finite/i);
    expect(() => new CoulombBoundaryEvaluator([[0, 0, 0]], { openingAngle: -1 })).toThrow(/angle/i);
    const tree = new CoulombBoundaryEvaluator([[0, 0, 0]]);
    expect(() => tree.setCharges(new Float64Array([Infinity]))).toThrow(/finite/i);
    expect(() => tree.setCharges(new Float64Array(2))).toThrow(/size|length/i);
    tree.setCharges(new Float64Array([1]));
    expect(() => tree.evaluate([[0, 0, 0]])).toThrow(/coincident|singular/i);
    expect(() => tree.evaluate([[0, Infinity, 0]])).toThrow(/finite/i);
    expect(() => directCoulombPotentials([[0, 0, 0]], new Float64Array([1]), [[0, 0, 0]])).toThrow(/coincident|singular/i);
  });
});
