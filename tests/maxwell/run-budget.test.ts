import { expect, it } from 'vitest';
import { maxwellRunBudget } from '../../src/engine/maxwell/runBudget';

it('bounds physical steps at the first grid time reaching the target', () => {
  expect(maxwellRunBudget(0.1, 0, 0.3, 20)).toMatchObject({ targetStep: 3, remainingSteps: 3, stepsThisBatch: 3, reached: false });
  expect(maxwellRunBudget(0.1, 2, 0.31, 20)).toMatchObject({ targetStep: 4, remainingSteps: 2, stepsThisBatch: 2, targetGridTime: 0.4 });
  expect(maxwellRunBudget(0.1, 4, 0.31, 20)).toMatchObject({ remainingSteps: 0, stepsThisBatch: 0, reached: true });
  expect(maxwellRunBudget(0.1, 9, 0, 20)).toMatchObject({ targetStep: 0, stepsThisBatch: 0, reached: true });
  expect(maxwellRunBudget(0.1, 0, 100, 12)).toMatchObject({ stepsThisBatch: 12 });
  expect(maxwellRunBudget(1, 0, 1e15 + 0.125, 12).targetStep).toBe(1e15 + 1);
});

it('estimates only measured stepping cost and supports unlimited runs', () => {
  expect(maxwellRunBudget(1e-10, 20, 1e-8, 12, 40)).toMatchObject({ remainingSteps: 80, estimatedSeconds: 2 });
  expect(maxwellRunBudget(1e-10, 20, 1e-8, 12, 0).estimatedSeconds).toBeUndefined();
  expect(maxwellRunBudget(1e-10, 20, undefined, 12)).toMatchObject({ stepsThisBatch: 12, reached: false });
  expect(maxwellRunBudget(1e-10, 20, undefined, 12).targetStep).toBeUndefined();
});

it('rejects invalid or unrepresentable targets before running a field step', () => {
  for (const target of [-1, NaN, Infinity, 1e30]) expect(() => maxwellRunBudget(1e-10, 0, target, 12)).toThrow(/target|finite|step/i);
  expect(() => maxwellRunBudget(0, 0, 1, 12)).toThrow(/step|positive/i);
  expect(() => maxwellRunBudget(1, -1, 1, 12)).toThrow(/step/i);
});
