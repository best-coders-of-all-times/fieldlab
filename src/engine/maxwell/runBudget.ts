/** Physical target pacing only: no change to c, dt, source frequency or motion. */
export function maxwellRunBudget(dt: number, steps: number, targetTime: number | undefined, requestedBatch: number, stepsPerSecond?: number) {
  if (!(Number.isFinite(dt) && dt > 0) || !Number.isSafeInteger(steps) || steps < 0) throw new Error('Physical step and step count must be finite, positive and representable');
  const batch = Math.max(1, Math.min(20, Math.floor(requestedBatch) || 1));
  if (targetTime === undefined) return { stepsThisBatch: batch, reached: false, targetStep: undefined, targetGridTime: undefined, remainingSteps: undefined, estimatedSeconds: undefined };
  if (!(Number.isFinite(targetTime) && targetTime >= 0)) throw new Error('Physical target time must be finite and nonnegative');
  const ratio = targetTime / dt, integer = Math.round(ratio);
  // Exact decimal/grid multiples may divide a few ulps above an integer.
  const aligned = Math.abs(ratio - integer) <= Math.min(1e-7, 8 * Number.EPSILON * Math.max(1, Math.abs(ratio)));
  const targetStep = aligned ? integer : Math.ceil(ratio);
  if (!Number.isSafeInteger(targetStep) || targetStep < 0) throw new Error('Physical target exceeds the representable step count');
  const remainingSteps = Math.max(0, targetStep - steps);
  return { targetStep, targetGridTime: targetStep * dt, remainingSteps, reached: remainingSteps === 0,
    stepsThisBatch: Math.min(batch, remainingSteps),
    estimatedSeconds: stepsPerSecond !== undefined && Number.isFinite(stepsPerSecond) && stepsPerSecond > 0 ? remainingSteps / stepsPerSecond : undefined };
}
