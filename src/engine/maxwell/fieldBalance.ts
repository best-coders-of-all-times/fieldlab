import { EPSILON_0, MU_0, type YeeSolver } from './yee';

export interface FieldVolume { low: [number, number, number]; high: [number, number, number]; }

/** Validate the finite-volume, discrete Poynting theorem over one field step.
 * The box must lie in the ordinary Yee region with a one-cell halo, outside
 * CPML/PEC closure. This optional diagnostic copies E; it is not run in every
 * animation frame. All update current (including material current) counts as
 * work on matter. It is a field-only budget, not a closed mechanical ledger.
 */
export function measureFieldBalance(s: YeeSolver, volume: FieldVolume, advance: () => void) {
  const dims = [s.nx, s.ny, s.nz], ds = [s.dx, s.dy, s.dz], stride = [1, s.nx, s.nx * s.ny];
  const { low, high } = volume;
  for (let a = 0; a < 3; a++) if (!Number.isInteger(low[a]) || !Number.isInteger(high[a]) || low[a] < 1 || high[a] < low[a] || high[a] >= dims[a] - 1) throw new Error('Field-balance volume requires a one-cell grid halo');
  const E = [s.Ex, s.Ey, s.Ez], B = [s.Bx, s.By, s.Bz], eps = [s.epsX, s.epsY, s.epsZ], mu = [s.muX, s.muY, s.muZ], dv = s.dx * s.dy * s.dz;
  const sumVolume = (at: (c: number) => number) => {
    let total = 0;
    for (let k = low[2]; k <= high[2]; k++) for (let j = low[1]; j <= high[1]; j++) for (let i = low[0]; i <= high[0]; i++) total += at(s.index(i, j, k));
    return total;
  };
  const energy = () => dv / 2 * sumVolume(c => {
    let density = 0;
    for (let a = 0; a < 3; a++) {
      // Exact Yee energy uses neighboring half-time magnetic fields, rather
      // than the non-invariant physical centered-B squared estimate.
      const nextHalfB = 2 * s.synchronizedB(a as 0 | 1 | 2, c) - B[a][c];
      density += EPSILON_0 * eps[a][c] * E[a][c] ** 2 + B[a][c] * nextHalfB / (MU_0 * mu[a][c]);
    }
    return density;
  });
  const before = energy(), previousE = E.map(values => values.slice()), initialStep = s.steps;
  advance();
  if (s.steps !== initialStep + 1) throw new Error('Field-balance capture must advance exactly one field step');
  const after = energy(), averageE = (a: number, c: number) => (previousE[a][c] + E[a][c]) / 2;
  const matterWork = s.dt * dv * sumVolume(c => {
    let work = 0; for (let a = 0; a < 3; a++) work += averageE(a, c) * s.currentAtUpdate(a as 0 | 1 | 2, c);
    return work;
  });
  let outwardPower = 0;
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3, d = (a + 2) % 3;
    const flux = (c: number) => averageE(b, c + stride[a]) * B[d][c] / (MU_0 * mu[d][c]) - averageE(d, c + stride[a]) * B[b][c] / (MU_0 * mu[b][c]);
    for (let j = low[b]; j <= high[b]; j++) for (let k = low[d]; k <= high[d]; k++) {
      const lower = [0, 0, 0], upper = [0, 0, 0];
      lower[a] = low[a] - 1; upper[a] = high[a]; lower[b] = upper[b] = j; lower[d] = upper[d] = k;
      outwardPower += (flux(s.index(upper[0], upper[1], upper[2])) - flux(s.index(lower[0], lower[1], lower[2]))) * ds[b] * ds[d];
    }
  }
  const boundaryEnergy = s.dt * outwardPower, change = after - before;
  const residual = change + matterWork + boundaryEnergy;
  const scale = Math.max(Math.abs(change) + Math.abs(matterWork) + Math.abs(boundaryEnergy), 1e-40);
  return { before, after, change, matterWork, boundaryEnergy, residual, relativeResidual: Math.abs(residual) / scale };
}
