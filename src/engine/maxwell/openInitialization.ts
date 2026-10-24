import type { Vec3 } from '../math/vec3';
import { EPSILON_0, type YeeSolver } from './yee';
import { initializeElectric } from './initialization';
import { CoulombBoundaryEvaluator } from './coulombBoundary';
import { solveBoundaryGmres } from './boundaryKrylov';

/** One-time open electrostatic preparation. Physical equivalent charge supplies
 * the exterior Coulomb boundary, including electrode/dielectric response.
 * The compatible Maxwell fields are reconstructed only after convergence.
 * Source support must include all free charge and all material charge nodes;
 * the artificial backing wall must never be included.
 */
export function createOpenInitializer(s: YeeSolver, fixed: Uint8Array, support: readonly number[], min: Vec3) {
  const { nx, ny, nz, dx, dy, dz } = s, n = s.rho.length, dv = dx * dy * dz;
  const point = (c: number): Vec3 => [min[0] + c % nx * dx, min[1] + Math.floor(c / nx) % ny * dy, min[2] + Math.floor(c / (nx * ny)) * dz];
  const boundary: number[] = [];
  let responsive = false;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = s.index(i, j, k);
    if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) { boundary.push(c); fixed[c] = 1; }
    else if (fixed[c]) responsive = true;
    if (s.epsX[c] !== 1 || s.epsY[c] !== 1 || s.epsZ[c] !== 1) responsive = true;
  }
  const targets = boundary.map(point), positions = support.map(point);
  const evaluator = positions.length ? new CoulombBoundaryEvaluator(positions) : null;
  const equivalent = new Float64Array(support.length), zeroRho = new Float64Array(n);
  const vacuumCharge = () => {
    for (let a = 0; a < support.length; a++) {
      const c = support[a];
      equivalent[a] = EPSILON_0 * ((s.Ex[c] - s.Ex[c - 1]) / dx + (s.Ey[c] - s.Ey[c - nx]) / dy + (s.Ez[c] - s.Ez[c - nx * ny]) / dz) * dv;
    }
    evaluator!.setCharges(equivalent);
    return evaluator!.evaluate(targets);
  };
  return (rho: Float64Array, potential: Float64Array, external: Vec3) => {
    const source = rho.slice(), physical = potential.slice();
    const externalPotential = Float64Array.from(targets, p => -external.reduce((sum, field, a) => sum + field * p[a], 0));
    let boundaryValue: Float64Array, iterations = 0, boundaryResidual = 0;
    if (!responsive) {
      if (evaluator) {
        evaluator.setCharges(Float64Array.from(support, c => source[c] * dv));
        boundaryValue = evaluator.evaluate(targets);
      } else boundaryValue = new Float64Array(boundary.length);
      for (let a = 0; a < boundary.length; a++) boundaryValue[a] += externalPotential[a];
    } else {
      if (!evaluator) throw new Error('Open material preparation requires physical charge support');
      for (const c of boundary) physical[c] = 0;
      s.rho.set(source); initializeElectric(s, fixed, physical.slice());
      const base = vacuumCharge();
      const rhs = Float64Array.from(base, (value, a) => value + externalPotential[a]);
      const apply = (value: Float64Array) => {
        const response = new Float64Array(n);
        boundary.forEach((c, a) => { response[c] = value[a]; });
        s.rho.set(zeroRho); initializeElectric(s, fixed, response);
        const induced = vacuumCharge();
        return Float64Array.from(value, (v, a) => v - induced[a]);
      };
      const solved = solveBoundaryGmres(apply, rhs);
      boundaryValue = solved.solution; iterations = solved.iterations; boundaryResidual = solved.residual;
    }
    // Restore the actual physical sources/electrode values after Krylov probes.
    const finalPotential = potential.slice();
    boundary.forEach((c, a) => { finalPotential[c] = boundaryValue[a]; });
    s.rho.set(source);
    const result = initializeElectric(s, fixed, finalPotential);
    potential.set(finalPotential);
    return { ...result, boundaryIterations: iterations, boundaryResidual };
  };
}
