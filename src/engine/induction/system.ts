import type {
  CoilObject,
  LoopObject,
  MotionSpec,
  Scene,
  SceneObject,
  WireObject,
} from '../../scene/types';
import { isCoil, isLoop, isWire } from '../../scene/types';
import type { Vec3 } from '../math/vec3';
import { cross, dot, len } from '../math/vec3';
import { localToWorld, worldAxis } from '../../scene/defaults';
import { buildMagnetostaticSources, fluxThroughLoop, sampleBAt } from '../magnetostatics/biotSavart';

export interface MotionTransform {
  id: string;
  position: Vec3;
  rotation: Vec3;
}

export interface InductionReading {
  id: string;
  name: string;
  /** Flux linkage in Wb (turns included). */
  flux: number;
  /** Induced EMF in volts, -dΦ/dt. */
  emf: number;
  turns: number;
}

export interface InductionFrame {
  time: number;
  transforms: MotionTransform[];
  readings: InductionReading[];
}

interface MotionState {
  object: SceneObject;
  spec: MotionSpec;
  axis: Vec3;
  angular: number; // rad/s
}

function normalizeAxis(axis: Vec3): Vec3 {
  const l = len(axis);
  return l < 1e-12 ? [0, 0, 1] : [axis[0] / l, axis[1] / l, axis[2] / l];
}

/** Euler rotation for a spin about a principal axis (other components kept). */
function spinRotation(base: Vec3, axis: Vec3, angle: number): Vec3 {
  const rotation: Vec3 = [base[0], base[1], base[2]];
  let index = 0;
  let weight = Math.abs(axis[0]);
  if (Math.abs(axis[1]) > weight) { index = 1; weight = Math.abs(axis[1]); }
  if (Math.abs(axis[2]) > weight) { index = 2; }
  rotation[index] += angle * Math.sign(axis[index] || 1);
  return rotation;
}

/**
 * Scripted induction demos: rigid motion, flux through loops and coils, and
 * motional EMF in a moving wire. Fields themselves remain quasi-static and are
 * still supplied by the analytic/Biot–Savart stack.
 */
export class InductionSystem {
  private scene: Scene;
  private states: MotionState[] = [];
  private previousFlux = new Map<string, number>();
  private simTime = 0;

  constructor(scene: Scene) {
    this.scene = scene;
    for (const object of scene.objects) {
      if (!object.visible || !object.motion) continue;
      const axis = normalizeAxis(object.motion.axis);
      this.states.push({
        object,
        spec: object.motion,
        axis,
        angular: Math.PI * 2 * object.motion.frequency,
      });
    }
  }

  get active(): boolean {
    return this.states.length > 0;
  }

  get time(): number {
    return this.simTime;
  }

  private evaluate(state: MotionState, t: number): MotionTransform {
    const phase = state.spec.phase ?? 0;
    const angle = state.angular * t + phase;
    if (state.spec.kind === 'spin') {
      return {
        id: state.object.id,
        position: [state.object.position[0], state.object.position[1], state.object.position[2]],
        rotation: spinRotation(state.object.rotation, state.axis, angle),
      };
    }
    const offset = state.spec.amplitude * Math.sin(angle);
    return {
      id: state.object.id,
      position: [
        state.object.position[0] + state.axis[0] * offset,
        state.object.position[1] + state.axis[1] * offset,
        state.object.position[2] + state.axis[2] * offset,
      ],
      rotation: [state.object.rotation[0], state.object.rotation[1], state.object.rotation[2]],
    };
  }

  private velocity(state: MotionState, t: number): Vec3 {
    const phase = state.spec.phase ?? 0;
    const angle = state.angular * t + phase;
    if (state.spec.kind === 'spin') {
      return [state.axis[0] * state.angular, state.axis[1] * state.angular, state.axis[2] * state.angular];
    }
    const speed = state.spec.amplitude * state.angular * Math.cos(angle);
    return [state.axis[0] * speed, state.axis[1] * speed, state.axis[2] * speed];
  }

  advance(wallSeconds: number, timeScale = 1): InductionFrame | null {
    if (this.states.length === 0) return null;
    const dt = Math.min(Math.max(wallSeconds, 0), 0.08) * Math.max(0.02, timeScale);
    if (dt <= 0) return null;
    this.simTime += dt;

    const transforms = this.states.map((s) => this.evaluate(s, this.simTime));
    const transformById = new Map(transforms.map((t) => [t.id, t]));
    const adjusted: SceneObject[] = this.scene.objects.map((o) => {
      const t = transformById.get(o.id);
      return t ? { ...o, position: t.position, rotation: t.rotation } : o;
    });
    const adjustedById = new Map(adjusted.map((o) => [o.id, o]));
    const segments = buildMagnetostaticSources(adjusted).segments;
    const externalB = this.scene.simulation.externalB;
    const readings: InductionReading[] = [];

    for (const object of this.scene.objects) {
      const moving = adjustedById.get(object.id) ?? object;
      if (isLoop(object)) {
        const flux = this.loopFlux(segments, moving as LoopObject, externalB);
        readings.push(this.reading(object.id, object.name, flux, 1, dt));
      } else if (isCoil(object)) {
        const coil = moving as CoilObject;
        const loop: LoopObject = {
          id: coil.id,
          kind: 'loop',
          name: coil.name,
          position: coil.position,
          rotation: coil.rotation,
          visible: coil.visible,
          radius: coil.radius,
          current: 0,
          wireRadius: coil.wireRadius,
          axis: [0, 0, 1],
        };
        const turns = Math.max(1, Math.round(coil.turns));
        const flux = this.loopFlux(segments, loop, externalB) * turns;
        readings.push(this.reading(object.id, object.name, flux, turns, dt));
      } else if (isWire(object) && object.motion) {
        const emf = this.motionalEmf(object, moving as WireObject, segments, externalB);
        readings.push({
          id: `${object.id}:motional`,
          name: `${object.name} motional EMF`,
          flux: Number.NaN,
          emf,
          turns: 1,
        });
      }
    }

    return { time: this.simTime, transforms, readings };
  }

  private loopFlux(segments: ReturnType<typeof buildMagnetostaticSources>['segments'], loop: LoopObject, externalB: Vec3): number {
    const normal = worldAxis(loop, [0, 0, 1]);
    const area = Math.PI * loop.radius * loop.radius;
    const uniform = dot(externalB, normal) * area;
    const induced = fluxThroughLoop(segments, loop, 12);
    return uniform + induced;
  }

  private reading(id: string, name: string, flux: number, turns: number, dt: number): InductionReading {
    const previous = this.previousFlux.get(id);
    const emf = previous === undefined ? 0 : -(flux - previous) / dt;
    this.previousFlux.set(id, flux);
    return { id, name, flux, emf, turns };
  }

  private motionalEmf(wire: WireObject, moved: WireObject, segments: ReturnType<typeof buildMagnetostaticSources>['segments'], externalB: Vec3): number {
    const points = moved.points;
    if (points.length < 2) return 0;
    const state = this.states.find((s) => s.object.id === wire.id);
    if (!state) return 0;
    const v0 = this.velocity(state, this.simTime);
    let emf = 0;
    for (let i = 0; i + 1 < points.length; i++) {
      const a = localToWorld(moved, points[i]);
      const b = localToWorld(moved, points[i + 1]);
      const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      let v: Vec3 = v0;
      if (state.spec.kind === 'spin') {
        const r: Vec3 = [mid[0] - moved.position[0], mid[1] - moved.position[1], mid[2] - moved.position[2]];
        v = cross(v0, r);
      }
      const bField = sampleBAt(segments, mid);
      const B: Vec3 = [bField[0] + externalB[0], bField[1] + externalB[1], bField[2] + externalB[2]];
      const drift = cross(v, B);
      const dl: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      emf += dot(drift, dl);
    }
    return emf;
  }
}
