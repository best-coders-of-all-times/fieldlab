import { expect, it } from 'vitest';
import { solveBoundaryGmres } from '../../src/engine/maxwell/boundaryKrylov';

it('solves a nonsymmetric boundary response whose raw fixed-point map diverges', () => {
  // A = I-L, with a negative response eigenvalue below -1. This occurs
  // for large conductors close to finite electrostatic boundaries.
  const apply = (v: Float64Array) => new Float64Array([3 * v[0] + 0.7 * v[1], 0.2 * v[0] + 2 * v[1]]);
  const expected = new Float64Array([0.4, -0.6]);
  const result = solveBoundaryGmres(apply, apply(expected), 1e-12);
  expected.forEach((value, i) => expect(result.solution[i]).toBeCloseTo(value, 12));
  expect(result.residual).toBeLessThan(1e-12);
});

it('rejects an unsolvable boundary equation instead of accepting an iteration limit', () => {
  expect(() => solveBoundaryGmres(v => new Float64Array(v.length), new Float64Array([1, 2]))).toThrow(/broke down|converge/i);
});
