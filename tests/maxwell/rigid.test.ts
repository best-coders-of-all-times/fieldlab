import { expect, it } from 'vitest';
import { advanceRigidBody } from '../../src/engine/maxwell/rigid';
import { rotateEuler } from '../../src/scene/defaults';

it('integrates translation and a torque about a rotated principal axis', () => {
  const body = { position: [0, 0, 0], rotation: [0, 0, Math.PI / 2], velocity: [1, 0, 0], angularVelocity: [0, 0, 0] } as const;
  const next = advanceRigidBody(body, [2, 0, 0], [0, 2, 0], 2, [1, 3, 5], 0.01);
  expect(next.position[0]).toBeCloseTo(0.01005, 12);
  expect(next.velocity[0]).toBeCloseTo(1.01, 12);
  expect(next.angularVelocity[1]).toBeCloseTo(0.02, 8);
});

it('preserves torque-free world angular momentum with improving time refinement', () => {
  const errors = [0.01, 0.005].map(dt => {
    let body = { position: [0, 0, 0], rotation: [0, 0, 0], velocity: [0, 0, 0], angularVelocity: [1, 2, 3] };
    for (let n = 0; n < Math.round(0.5 / dt); n++) body = advanceRigidBody(body as never, [0, 0, 0], [0, 0, 0], 1, [1, 2, 3], dt);
    // R^-1 omega, then R I R^-1 omega.
    const basis = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(v => rotateEuler(v as [number, number, number], body.rotation as [number, number, number]));
    const local = basis.map(v => v.reduce((sum, x, a) => sum + x * body.angularVelocity[a], 0));
    const momentum = [0, 1, 2].map(a => basis.reduce((sum, v, j) => sum + v[a] * (j + 1) * local[j], 0));
    return Math.hypot(...momentum.map((v, a) => v - [1, 4, 9][a]));
  });
  expect(errors[0]).toBeLessThan(0.003);
  expect(errors[1]).toBeLessThan(errors[0] / 3);
});
