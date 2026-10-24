export const C_LIGHT = 299792458;
export type ParticleVector = [number, number, number];
type VectorInput = readonly [number, number, number];

function finiteVector(v: VectorInput, name: string): void {
  if (v.some(x => !Number.isFinite(x))) throw new Error(`${name} must be finite`);
}
function positiveMass(mass: number): void {
  if (!Number.isFinite(mass) || mass <= 0) throw new Error('Particle mass must be finite and positive');
}
const cross = (a: VectorInput, b: VectorInput): ParticleVector => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function validateSubluminalVelocity(velocity: VectorInput): void {
  finiteVector(velocity, 'Velocity');
  if (Math.hypot(...velocity) >= C_LIGHT) throw new Error('Prescribed velocity must be below the speed of light');
}

/** Convert SI velocity (m/s) to relativistic mechanical momentum (kg m/s). */
export function momentumFromVelocity(velocity: VectorInput, mass: number): ParticleVector {
  positiveMass(mass); validateSubluminalVelocity(velocity);
  const beta = Math.hypot(...velocity) / C_LIGHT;
  const gammaMass = mass / Math.sqrt((1 - beta) * (1 + beta));
  const momentum = velocity.map(v => gammaMass * v) as ParticleVector;
  finiteVector(momentum, 'Momentum');
  return momentum;
}

export function velocityFromMomentum(momentum: VectorInput, mass: number): ParticleVector {
  positiveMass(mass); finiteVector(momentum, 'Momentum');
  const norm = Math.hypot(...momentum), mc = mass * C_LIGHT;
  // Scale by momentum norm to avoid squaring large SI momenta.
  const speed = C_LIGHT * (norm / Math.hypot(norm, mc));
  return norm === 0 ? [0, 0, 0] : momentum.map(p => p / norm * speed) as ParticleVector;
}

/** A relativistic Boris kick/rotation and trapezoidal position drift in SI units.
 * E/B must be sampled at the particle's midpoint time/location by the caller.
 * This primitive excludes self force, deposition, radiation reaction and boundaries.
 */
export function advanceParticle(position: VectorInput, momentum: VectorInput, charge: number, mass: number,
  E: VectorInput, B: VectorInput, dt: number): { position: ParticleVector; momentum: ParticleVector; velocity: ParticleVector } {
  positiveMass(mass); finiteVector(position, 'Position'); finiteVector(momentum, 'Momentum');
  finiteVector(E, 'Electric field'); finiteVector(B, 'Magnetic field');
  if (!Number.isFinite(charge)) throw new Error('Particle charge must be finite');
  if (!Number.isFinite(dt) || dt <= 0) throw new Error('Particle dt must be finite and positive');
  const half = charge * dt / 2;
  const minus = momentum.map((p, i) => p + half * E[i]) as ParticleVector;
  const gamma = Math.hypot(1, Math.hypot(...minus) / mass / C_LIGHT);
  const t = B.map(b => half * b / mass / gamma) as ParticleVector;
  const factor = 2 / (1 + t[0] ** 2 + t[1] ** 2 + t[2] ** 2);
  const s = t.map(x => x * factor) as ParticleVector;
  const rotation = cross(minus, t), prime = minus.map((p, i) => p + rotation[i]) as ParticleVector;
  const rotated = cross(prime, s);
  const nextMomentum = minus.map((p, i) => p + rotated[i] + half * E[i]) as ParticleVector;
  finiteVector(nextMomentum, 'Updated momentum');
  const velocity = velocityFromMomentum(nextMomentum, mass), oldVelocity = velocityFromMomentum(momentum, mass);
  const nextPosition = position.map((p, i) => p + dt * (oldVelocity[i] + velocity[i]) / 2) as ParticleVector;
  finiteVector(nextPosition, 'Updated position');
  return { position: nextPosition, momentum: nextMomentum, velocity };
}
