import type { Scene, ParticleObject } from '../../scene/types';
import { isParticle } from '../../scene/types';
import type { Vec3 } from '../math/vec3';
import { cross, len } from '../math/vec3';
import { borisStep, gyroperiod, gyroradius } from './boris';
import { collectAnalyticSources, sampleAnalyticE } from '../electrostatics/analytic';
import type { AnalyticSources } from '../electrostatics/analytic';
import { buildMagnetostaticSources, sampleBAt } from '../magnetostatics/biotSavart';
import type { SegmentSet } from '../magnetostatics/biotSavart';

/**
 * Wall-clock to simulation-time ratio. Particle dynamics happen on ns
 * timescales, so a wall second is mapped to 200 ns of plasma time. At this
 * rate a cyclotron orbit in the demo presets takes about one second to draw.
 */
export const PARTICLE_TIME_RATE = 2e-7;

const MAX_SUBSTEPS = 240;
const FIELD_SOFTENING = 4e-4;

export interface ParticleFrameItem {
  id: string;
  position: Vec3;
  velocity: Vec3;
  charge: number;
  speed: number;
  E: Vec3;
  B: Vec3;
  gyroRadius: number;
  gyroPeriod: number;
  trail: Float32Array;
}

export interface ParticleFrame {
  /** Simulated time, seconds. */
  time: number;
  particles: ParticleFrameItem[];
}

interface State {
  object: ParticleObject;
  position: Vec3;
  velocity: Vec3;
  E: Vec3;
  B: Vec3;
  trail: number[];
  capacity: number;
}

export class ParticleSystem {
  private states: State[] = [];
  private sources: AnalyticSources;
  private segments: SegmentSet;
  private externalB: Vec3;
  private center: Vec3;
  private half: Vec3;
  private simTime = 0;

  constructor(scene: Scene) {
    this.sources = collectAnalyticSources(scene.objects, scene.simulation.externalField);
    this.segments = buildMagnetostaticSources(scene.objects).segments;
    this.externalB = scene.simulation.externalB;
    this.center = scene.domain.center;
    this.half = [
      scene.domain.size[0] / 2,
      scene.domain.size[1] / 2,
      scene.domain.size[2] / 2,
    ];
    for (const obj of scene.objects) {
      if (!isParticle(obj) || !obj.visible) continue;
      this.states.push(this.makeState(obj));
    }
  }

  get active(): boolean {
    return this.states.length > 0;
  }

  get time(): number {
    return this.simTime;
  }

  private makeState(obj: ParticleObject): State {
    const position: Vec3 = [obj.position[0], obj.position[1], obj.position[2]];
    const velocity: Vec3 = [obj.velocity[0], obj.velocity[1], obj.velocity[2]];
    const capacity = Math.max(48, Math.round(obj.trailLength));
    return {
      object: obj,
      position,
      velocity,
      E: [0, 0, 0],
      B: [0, 0, 0],
      trail: [position[0], position[1], position[2]],
      capacity,
    };
  }

  /** Integrate for one wall-clock interval. */
  advance(wallSeconds: number, timeScale = 1): ParticleFrame | null {
    if (this.states.length === 0) return null;
    const wall = Math.min(Math.max(wallSeconds, 0), 0.08);
    const simDt = wall * PARTICLE_TIME_RATE * Math.max(0.02, timeScale);
    if (simDt <= 0) return this.frame();

    // Pick a substep that resolves both the gyration and the electric
    // acceleration for every particle.
    let minStep = Infinity;
    for (const s of this.states) {
      this.sampleFields(s);
      const b = len(s.B);
      const accel = this.acceleration(s);
      if (b > 1e-12) {
        const period = gyroperiod(s.object.charge, s.object.mass, b);
        if (Number.isFinite(period)) minStep = Math.min(minStep, period / 64);
      }
      const speed = len(s.velocity);
      if (accel > 1e-12) {
        minStep = Math.min(minStep, (0.08 * Math.max(speed, 2e4)) / accel);
      }
    }
    if (!Number.isFinite(minStep) || minStep <= 0) minStep = simDt;
    const substeps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(simDt / minStep)));
    const dt = simDt / substeps;

    for (let k = 0; k < substeps; k++) {
      for (const s of this.states) {
        this.sampleFields(s);
        const next = borisStep({
          position: s.position,
          velocity: s.velocity,
          charge: s.object.charge,
          mass: s.object.mass,
          E: s.E,
          B: s.B,
          dt,
        });
        s.position = next.position;
        s.velocity = next.velocity;
        this.reflectAtBoundary(s);
        this.pushTrail(s);
      }
    }
    this.simTime += simDt;
    return this.frame();
  }

  private acceleration(s: State): number {
    const vxb = cross(s.velocity, s.B);
    const ex = s.E[0] + vxb[0];
    const ey = s.E[1] + vxb[1];
    const ez = s.E[2] + vxb[2];
    return (Math.abs(s.object.charge) / Math.max(s.object.mass, 1e-32)) * Math.hypot(ex, ey, ez);
  }

  private sampleFields(s: State): void {
    s.E = sampleAnalyticE(this.sources, s.position, FIELD_SOFTENING);
    const b = sampleBAt(this.segments, s.position);
    s.B = [b[0] + this.externalB[0], b[1] + this.externalB[1], b[2] + this.externalB[2]];
  }

  private reflectAtBoundary(s: State): void {
    const margin = Math.min(this.half[0], this.half[1], this.half[2]) * 0.02;
    for (let axis = 0; axis < 3; axis++) {
      const lo = this.center[axis] - this.half[axis] + margin;
      const hi = this.center[axis] + this.half[axis] - margin;
      if (s.position[axis] < lo) {
        s.position[axis] = lo + (lo - s.position[axis]) * 0.5;
        s.velocity[axis] = Math.abs(s.velocity[axis]) * 0.72;
      } else if (s.position[axis] > hi) {
        s.position[axis] = hi - (s.position[axis] - hi) * 0.5;
        s.velocity[axis] = -Math.abs(s.velocity[axis]) * 0.72;
      }
    }
  }

  private pushTrail(s: State): void {
    const n = s.trail.length;
    if (n >= 3) {
      const dx = s.position[0] - s.trail[n - 3];
      const dy = s.position[1] - s.trail[n - 2];
      const dz = s.position[2] - s.trail[n - 1];
      if (dx * dx + dy * dy + dz * dz < 2.5e-7) return;
    }
    s.trail.push(s.position[0], s.position[1], s.position[2]);
    if (s.trail.length > s.capacity * 3) {
      s.trail.splice(0, s.trail.length - s.capacity * 3);
    }
  }

  private frame(): ParticleFrame {
    return {
      time: this.simTime,
      particles: this.states.map((s) => {
        const b = len(s.B);
        return {
          id: s.object.id,
          position: [s.position[0], s.position[1], s.position[2]],
          velocity: [s.velocity[0], s.velocity[1], s.velocity[2]],
          charge: s.object.charge,
          speed: len(s.velocity),
          E: [s.E[0], s.E[1], s.E[2]],
          B: [s.B[0], s.B[1], s.B[2]],
          gyroRadius: b > 1e-15
            ? gyroradius(s.velocity, s.object.charge, s.object.mass, s.B)
            : Infinity,
          gyroPeriod: b > 1e-15
            ? gyroperiod(s.object.charge, s.object.mass, b)
            : Infinity,
          trail: new Float32Array(s.trail),
        };
      }),
    };
  }
}
