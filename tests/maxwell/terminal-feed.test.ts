import { describe, expect, it } from 'vitest';
import { depositCharge, depositTrajectory, type DepositionGrid } from '../../src/engine/maxwell/deposition';
import { compileFeedWeights, integrateFeedCharge, resolveFeedContact } from '../../src/engine/maxwell/terminalFeed';
import type { Vec3 } from '../../src/engine/math/vec3';

const grid: DepositionGrid = { nx: 8, ny: 7, nz: 6, dx: 0.25, dy: 0.5, dz: 0.125 };
const size = grid.nx * grid.ny * grid.nz;
const volume = grid.dx * grid.dy * grid.dz;
const index = (i: number, j: number, k: number) => i + grid.nx * (j + grid.ny * k);
const block = (i: number, j: number, k: number): Vec3[] => {
  const nodes: Vec3[] = [];
  for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    nodes.push([(i + x) * grid.dx, (j + y) * grid.dy, (k + z) * grid.dz]);
  }
  return nodes;
};
const fromNodes = block(1, 1, 1), toNodes = block(5, 3, 3);
const path: Vec3[] = [[0.375, 0.75, 0.1875], [0.75, 2, 0.5], [1.375, 1.75, 0.4375]];

describe('exact smooth-start terminal charge', () => {
  it('integrates the cubic startup and crossing interval with signed SI charge', () => {
    expect(integrateFeedCharge(4, 2, 0, 1)).toBeCloseTo(0.75, 14);
    expect(integrateFeedCharge(4, 2, 1, 2)).toBeCloseTo(7.25, 14);
    expect(integrateFeedCharge(-4, 2, 0, 3)).toBeCloseTo(-8, 14);
    expect(integrateFeedCharge(0, 2, 0.3, 0.7)).toBe(0);
    expect(integrateFeedCharge(-3, 0, 0, 0.25)).toBe(-0.75);
    expect(integrateFeedCharge(3, 2, 1e30, 0.25)).toBe(0.75);
  });

  it('preserves integrated charge across unequal physical time steps', () => {
    const steps = [0.01, 0.19, 0.37, 0.03, 0.8, 0.6, 1];
    let time = 0, charge = 0;
    for (const dt of steps) { charge += integrateFeedCharge(4, 2, time, dt); time += dt; }
    expect(time).toBeCloseTo(3, 14);
    expect(charge).toBeCloseTo(8, 13);
    expect(integrateFeedCharge(4, 2, 0, 3)).toBeCloseTo(charge, 13);
  });

  it('rejects invalid current, startup and time inputs', () => {
    for (const args of [[NaN, 1, 0, 1], [1, Infinity, 0, 1], [1, -1, 0, 1], [1, 1, -1, 1], [1, 1, 0, 0], [1, 1, 0, Infinity]]) {
      expect(() => integrateFeedCharge(...args as [number, number, number, number])).toThrow(/finite|time|positive|nonnegative/i);
    }
  });
});

describe('resolved material contacts', () => {
  it('retains every nonzero CIC corner for a diagonal off-grid endpoint', () => {
    const contact = resolveFeedContact(grid, path[0], fromNodes);
    expect(contact).toEqual(Array.from({ length: 8 }, (_, node) => ({ node, weight: 0.125 })));
    expect(resolveFeedContact(grid, fromNodes[0], fromNodes)).toEqual([{ node: 0, weight: 1 }]);
    const perturbed = fromNodes.map(p => p.map(v => v + Number.EPSILON) as Vec3);
    expect(resolveFeedContact(grid, path[0], perturbed)).toEqual(contact);
  });

  it('rejects missing or ambiguous material support instead of pruning or snapping', () => {
    expect(() => resolveFeedContact(grid, path[0], fromNodes.slice(1))).toThrow(/support|contact/i);
    expect(() => resolveFeedContact(grid, path[0], [...fromNodes, fromNodes[0]])).toThrow(/unique|duplicate|ambiguous/i);
    expect(() => resolveFeedContact(grid, [0.25 + Number.EPSILON, 0.5, 0.125], [fromNodes[0]])).toThrow(/support|contact/i);
    expect(() => resolveFeedContact(grid, [-0.1, 0.5, 0.125], fromNodes)).toThrow(/domain|boundary/i);
    expect(() => resolveFeedContact(grid, path[0], [[0.3, 0.5, 0.125]])).toThrow(/aligned|lattice/i);
    expect(() => resolveFeedContact({ ...grid, dx: 0 }, path[0], fromNodes)).toThrow(/grid|spacing/i);
  });
});

describe('terminal current path and contact fan', () => {
  it('closes continuity against independently updated material charge with no free endpoint charge', () => {
    const fromContact = Array.from({ length: 8 }, (_, node) => ({ node, weight: 0.125 }));
    const toContact = Array.from({ length: 8 }, (_, node) => ({ node, weight: 0.125 }));
    const weights = compileFeedWeights(grid, path, fromNodes, fromContact, toNodes, toContact);
    const q = -1.7, dt = 0.13;
    const rho = new Float64Array(size), current = [new Float64Array(size), new Float64Array(size), new Float64Array(size)];
    for (const c of fromContact) depositCharge(rho, grid, fromNodes[c.node], -q * c.weight);
    for (const c of toContact) depositCharge(rho, grid, toNodes[c.node], q * c.weight);
    for (const w of weights) current[w.axis][w.index] += q / (dt * volume) * w.length;
    let residual = 0;
    for (let k = 0; k < grid.nz; k++) for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) {
      const c = index(i, j, k);
      const divergence = (current[0][c] - (i ? current[0][index(i - 1, j, k)] : 0)) / grid.dx
        + (current[1][c] - (j ? current[1][index(i, j - 1, k)] : 0)) / grid.dy
        + (current[2][c] - (k ? current[2][index(i, j, k - 1)] : 0)) / grid.dz;
      residual = Math.max(residual, Math.abs(rho[c] + dt * divergence) * volume / Math.abs(q));
    }
    expect(residual).toBeLessThan(2e-14);
    expect(rho.reduce((sum, v) => sum + v, 0) * volume).toBeCloseTo(0, 14);
  });

  it('pairs the full contact path voltage with independently deposited field work', () => {
    const fromContact = Array.from({ length: 8 }, (_, node) => ({ node, weight: 0.125 }));
    const toContact = Array.from({ length: 8 }, (_, node) => ({ node, weight: 0.125 }));
    const weights = compileFeedWeights(grid, path, fromNodes, fromContact, toNodes, toContact);
    const fields = [0.3, 0.7, 1.1].map(phase => Float64Array.from({ length: size }, (_, i) => Math.sin(i * phase) + Math.cos(i * 0.31)));
    const current = [new Float64Array(size), new Float64Array(size), new Float64Array(size)], q = 0.73, dt = 0.17;
    const deposit = (a: Vec3, b: Vec3, charge: number) => depositTrajectory(current[0], current[1], current[2], grid, a, b, charge, dt);
    for (let i = 1; i < path.length; i++) deposit(path[i - 1], path[i], q);
    for (const c of fromContact) deposit(fromNodes[c.node], path[0], q * c.weight);
    for (const c of toContact) deposit(path.at(-1)!, toNodes[c.node], q * c.weight);
    let fieldWork = 0;
    for (let axis = 0; axis < 3; axis++) for (let i = 0; i < size; i++) fieldWork += dt * volume * fields[axis][i] * current[axis][i];
    const voltage = weights.reduce((sum, w) => sum + fields[w.axis][w.index] * w.length, 0);
    expect(Math.abs(q * voltage - fieldWork)).toBeLessThan(2e-14);
  });

  it('rejects invalid paths and forged contacts before exposing a compiled source', () => {
    const fromContact = resolveFeedContact(grid, path[0], fromNodes), toContact = resolveFeedContact(grid, path.at(-1)!, toNodes);
    const compile = (p = path, from = fromContact) => compileFeedWeights(grid, p, fromNodes, from, toNodes, toContact);
    expect(() => compile([path[0]])).toThrow(/path|point/i);
    expect(() => compile([path[0], [2, 0, 0], path.at(-1)!])).toThrow(/domain|boundary/i);
    expect(() => compile(path, fromContact.slice(1))).toThrow(/support|contact/i);
    expect(() => compile(path, [...fromContact, fromContact[0]])).toThrow(/unique|duplicate|contact/i);
    expect(() => compile(path, fromContact.map(c => ({ ...c, weight: c.weight * 2 })))).toThrow(/weight|contact/i);
    expect(() => compile(path, [{ node: 90, weight: 1 }])).toThrow(/node|contact/i);
  });
});
