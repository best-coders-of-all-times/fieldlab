import type { Vec3 } from '../math/vec3';
import { C_LIGHT } from '../constants';

/** Lab-frame conduction current (A/m²) for scalar rest-frame conductivity (S/m).
 * Jcond = sigma gamma [E + v×B - v(v·E)/c²]. The transported free-charge
 * current rho*v is separate and must not be included twice by the caller.
 * See Mattia et al. (2023), DOI: 10.1051/0004-6361/202347126, covariant Ohm law.
 */
export function movingOhmCurrent(E: Vec3, B: Vec3, v: Vec3, sigma: number): Vec3 {
  for (let i = 0; i < 3; i++) if (!Number.isFinite(E[i]) || !Number.isFinite(B[i]) || !Number.isFinite(v[i])) throw new Error('Moving Ohm fields and velocity must be finite');
  if (!Number.isFinite(sigma) || sigma < 0) throw new Error('Moving Ohm conductivity must be finite and nonnegative');
  const speed = Math.hypot(...v), beta = speed / C_LIGHT;
  if (beta >= 1) throw new Error('Moving material speed must be below the speed of light');
  const gamma = 1 / Math.sqrt((1 - beta) * (1 + beta));
  const vDotEOverC2 = (v[0] * E[0] + v[1] * E[1] + v[2] * E[2]) / C_LIGHT ** 2;
  const factor = sigma * gamma;
  const current: Vec3 = [factor * (E[0] + v[1] * B[2] - v[2] * B[1] - v[0] * vDotEOverC2),
    factor * (E[1] + v[2] * B[0] - v[0] * B[2] - v[1] * vDotEOverC2),
    factor * (E[2] + v[0] * B[1] - v[1] * B[0] - v[2] * vDotEOverC2)];
  if (!Number.isFinite(current[0]) || !Number.isFinite(current[1]) || !Number.isFinite(current[2])) throw new Error('Moving Ohm current exceeds finite SI range');
  return current;
}
