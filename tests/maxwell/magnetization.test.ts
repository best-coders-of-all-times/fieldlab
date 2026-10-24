import { describe, expect, it } from 'vitest';
import { makeScene, makeMagnet } from '../../src/scene/defaults';
import type { Vec3 } from '../../src/engine/math/vec3';
import { C_LIGHT } from '../../src/engine/maxwell/dynamics';
import { buildMagnetizationSources, magnetizationCurrent, polarizationCharge } from '../../src/engine/maxwell/magnetization';

const g = { nx: 21, ny: 21, nz: 21, dx: 0.1, dy: 0.1, dz: 0.1 }, origin: Vec3 = [-1, -1, -1];
const size = g.nx * g.ny * g.nz, center = 10 + g.nx * (10 + g.ny * 10);
const maxAbs = (x: Float64Array) => x.reduce((a, b) => Math.max(a, Math.abs(b)), 0);
function moving(v: Vec3) {
  const magnet = makeMagnet([0, 0, 0], 0.5, 1.1);
  magnet.magnetization = 1e5;
  magnet.motion = { kind: 'keyframes', loop: false, keyframes: [
    { time: 0, position: [0, 0, 0], rotation: [0, 0, 0] },
    { time: 1e-8, position: v.map(x => x * 1e-8) as Vec3, rotation: [0, 0, 0] },
  ] };
  return makeScene({ name: 'moving magnet', objects: [magnet] });
}

describe('prescribed magnetization-polarization Maxwell sources', () => {
  it('produces stationary azimuthal bound current with exactly compatible zero divergence', () => {
    const scene = moving([0, 0, 0]);
    const { magnetization: m, polarization: p } = buildMagnetizationSources(scene, g, origin, 0);
    expect(m[2][center]).toBeCloseTo(1e5, 10);
    expect(p.every(a => a.every(x => x === 0))).toBe(true);
    const j = magnetizationCurrent(m, g);
    const negativeDivergence = polarizationCharge(j, g);
    expect(maxAbs(negativeDivergence)).toBeLessThan(1e-7);
    expect(maxAbs(j[0])).toBeGreaterThan(1e5);
    expect(j[0].some(x => x < 0) && j[0].some(x => x > 0)).toBe(true);
    expect(j[1].some(x => x < 0) && j[1].some(x => x > 0)).toBe(true);
    expect(j[2].every(x => x === 0)).toBe(true);
  });
  it('uses the hand-calculated transverse Lorentz boost and correct moving dipole sign', () => {
    const { magnetization: m, polarization: p } = buildMagnetizationSources(moving([0.6 * C_LIGHT, 0, 0]), g, origin, 0);
    expect(m[2][center]).toBeCloseTo(1.25e5, 8);
    expect(p[1][center]).toBeCloseTo(-1.25 * 0.6 * 1e5 / C_LIGHT, 14);
    expect(p[0][center]).toBe(0);
    expect(p[2][center]).toBe(0);
  });
  it('preserves parallel magnetization and signed components for a general 3D boost', () => {
    const v: Vec3 = [0.2 * C_LIGHT, -0.1 * C_LIGHT, 0.3 * C_LIGHT];
    const scene = moving(v), magnet = scene.objects[0];
    magnet.rotation = [Math.PI / 4, Math.PI / 3, 0];
    const rest = [Math.sin(Math.PI / 3), -Math.sin(Math.PI / 4) * Math.cos(Math.PI / 3), Math.cos(Math.PI / 4) * Math.cos(Math.PI / 3)].map(x => x * 1e5);
    const gamma = 1 / Math.sqrt(1 - 0.14), dot = rest.reduce((s, x, a) => s + x * v[a], 0), speed2 = v.reduce((s, x) => s + x * x, 0);
    const expected = rest.map((m, a) => gamma * m - (gamma - 1) * dot * v[a] / speed2);
    const { magnetization: m } = buildMagnetizationSources(scene, g, origin, 0);
    for (let a = 0; a < 3; a++) expect(m[a][center]).toBeCloseTo(expected[a], 8);
    const parallel = buildMagnetizationSources(moving([0, 0, 0.8 * C_LIGHT]), g, origin, 0);
    expect(parallel.magnetization[2][center]).toBeCloseTo(1e5, 8);
    expect(parallel.polarization.every(a => a.every(x => x === 0))).toBe(true);
  });
  it('gives discrete continuity from polarization differences plus bound curl current', () => {
    const scene = moving([0.3 * C_LIGHT, 0.2 * C_LIGHT, 0]), dt = 1e-10;
    const a = buildMagnetizationSources(scene, g, origin, 0), b = buildMagnetizationSources(scene, g, origin, dt);
    const rho0 = polarizationCharge(a.polarization, g), rho1 = polarizationCharge(b.polarization, g);
    const j = magnetizationCurrent(b.magnetization, g);
    for (let axis = 0; axis < 3; axis++) for (let c = 0; c < size; c++) j[axis][c] += (b.polarization[axis][c] - a.polarization[axis][c]) / dt;
    const minusDivJ = polarizationCharge(j, g);
    let residual = 0;
    for (let c = 0; c < size; c++) residual = Math.max(residual, Math.abs(rho1[c] - rho0[c] - dt * minusDivJ[c]));
    expect(residual / Math.max(maxAbs(rho0), maxAbs(rho1))).toBeLessThan(1e-13);
  });
  it('reverses polarization when translation reverses, with unchanged magnetization', () => {
    const a = buildMagnetizationSources(moving([0.4 * C_LIGHT, 0, 0]), g, origin, 0);
    const b = buildMagnetizationSources(moving([-0.4 * C_LIGHT, 0, 0]), g, origin, 0);
    expect(a.magnetization).toEqual(b.magnetization);
    for (let c = 0; c < size; c++) expect(a.polarization[1][c] + b.polarization[1][c]).toBe(0);
  });
  it('keeps div(curl M) at roundoff for arbitrary signed arrays and periodic boundaries', () => {
    const m = [0, 1, 2].map(a => Float64Array.from({ length: size }, (_, i) => Math.sin(i * 1.3 + a * 0.7))) as [Float64Array, Float64Array, Float64Array];
    expect(maxAbs(polarizationCharge(magnetizationCurrent(m, g, 'periodic'), g, 'periodic'))).toBeLessThan(2e-12);
  });
  it('uses local spin velocity and produces the hand-calculated axial-rotor bound charge', () => {
    const scene = moving([0, 0, 0]), magnet = scene.objects[0], omega = 1e6;
    magnet.motion = { kind: 'spin', axis: [0, 0, 1], amplitude: 0, frequency: omega / (2 * Math.PI) };
    const source = buildMagnetizationSources(scene, g, origin, 0);
    const expected = -2 * omega * 1e5 / C_LIGHT ** 2 / Math.sqrt(1 - (0.05 * omega / C_LIGHT) ** 2);
    expect(polarizationCharge(source.polarization, g)[center] / expected).toBeCloseTo(1, 13);
  });
  it('accepts subluminal axial spin using the radial tangential speed rather than body length', () => {
    const scene = moving([0, 0, 0]), magnet = scene.objects[0];
    magnet.motion = { kind: 'spin', axis: [0, 0, 1], amplitude: 0, frequency: 0.8 * C_LIGHT / (2 * Math.PI * 0.5) };
    expect(() => buildMagnetizationSources(scene, g, origin, 0)).not.toThrow();
  });
  it('rejects light-speed translation, excessive spin and force-driven magnets', () => {
    expect(() => buildMagnetizationSources(moving([C_LIGHT, 0, 0]), g, origin, 0)).toThrow(/light|speed|subluminal/i);
    const scene = moving([0, 0, 0]), magnet = scene.objects[0];
    magnet.motion = { kind: 'spin', axis: [0, 0, 1], amplitude: 0, frequency: C_LIGHT / Math.PI };
    expect(() => buildMagnetizationSources(scene, g, origin, 0)).toThrow(/light|speed|subluminal/i);
    magnet.dynamics = { mode: 'forceDriven', mass: 1, inertia: [1, 1, 1], velocity: [0, 0, 0], angularVelocity: [0, 0, 0] };
    expect(() => buildMagnetizationSources(scene, g, origin, 0)).toThrow(/force.driven|unsupported/i);
  });
});
