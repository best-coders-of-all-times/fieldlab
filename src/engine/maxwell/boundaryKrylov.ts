/** Restarted GMRES for the linear open-boundary Schur system. The map is
 * generally nonsymmetric; conjugate gradients and raw Picard iteration do not
 * have the required convergence guarantees. Always check the true residual.
 */
export function solveBoundaryGmres(apply: (v: Float64Array) => Float64Array, b: Float64Array,
  tolerance = 1e-7, maxIterations = 60, restart = 12) {
  const dot = (a: Float64Array, c: Float64Array) => { let sum = 0; for (let i = 0; i < a.length; i++) sum += a[i] * c[i]; return sum; };
  const norm = (a: Float64Array) => Math.sqrt(dot(a, a));
  const x = new Float64Array(b.length), scale = norm(b);
  if (scale === 0) return { solution: x, iterations: 0, residual: 0 };
  let residual = b.slice(), iterations = 0;
  while (iterations < maxIterations) {
    const beta = norm(residual);
    if (beta <= tolerance * scale) return { solution: x, iterations, residual: beta / scale };
    const basis = [Float64Array.from(residual, value => value / beta)];
    const h = Array.from({ length: restart + 1 }, () => new Float64Array(restart));
    const cosine = new Float64Array(restart), sine = new Float64Array(restart), g = new Float64Array(restart + 1); g[0] = beta;
    let columns = 0;
    for (let j = 0; j < restart && iterations < maxIterations; j++) {
      const w = apply(basis[j]);
      // Reorthogonalization keeps cancellation-heavy neutral source cases stable.
      for (let pass = 0; pass < 2; pass++) for (let i = 0; i <= j; i++) {
        const value = dot(w, basis[i]); h[i][j] += value;
        for (let k = 0; k < w.length; k++) w[k] -= value * basis[i][k];
      }
      h[j + 1][j] = norm(w);
      const breakdown = h[j + 1][j] < 1e-14;
      if (!breakdown) basis.push(Float64Array.from(w, value => value / h[j + 1][j]));
      for (let i = 0; i < j; i++) {
        const first = h[i][j], second = h[i + 1][j];
        h[i][j] = cosine[i] * first + sine[i] * second; h[i + 1][j] = -sine[i] * first + cosine[i] * second;
      }
      const radius = Math.hypot(h[j][j], h[j + 1][j]);
      if (!(radius > 0 && Number.isFinite(radius))) throw new Error('Open-boundary Krylov solve broke down');
      cosine[j] = h[j][j] / radius; sine[j] = h[j + 1][j] / radius;
      h[j][j] = radius; h[j + 1][j] = 0;
      g[j + 1] = -sine[j] * g[j]; g[j] *= cosine[j];
      iterations++; columns = j + 1;
      if (Math.abs(g[j + 1]) <= tolerance * scale || breakdown) break;
    }
    const y = new Float64Array(columns);
    for (let i = columns - 1; i >= 0; i--) {
      let value = g[i]; for (let j = i + 1; j < columns; j++) value -= h[i][j] * y[j];
      y[i] = value / h[i][i];
    }
    for (let i = 0; i < columns; i++) for (let k = 0; k < x.length; k++) x[k] += y[i] * basis[i][k];
    const actual = apply(x); residual = Float64Array.from(b, (value, i) => value - actual[i]);
  }
  const relative = norm(residual) / scale;
  if (relative <= tolerance) return { solution: x, iterations, residual: relative };
  throw new Error(`Open-boundary preparation did not converge (relative residual ${relative.toExponential(2)}). Increase the domain clearance or review source/material geometry.`);
}
