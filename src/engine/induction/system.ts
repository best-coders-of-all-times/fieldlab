import type {
  CoilObject,
  LoopObject,
  Scene,
  SceneObject,
  WireObject,
} from '../../scene/types';
import { isCoil, isLoop, isWire } from '../../scene/types';
import type { Vec3 } from '../math/vec3';
import { cross, dot } from '../math/vec3';
import { motionAt } from '../../scene/motion';
import { localToWorld, worldAxis } from '../../scene/defaults';
import { wirePath } from '../../scene/wirePath';
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

/**
 * Scripted induction demos: rigid motion, flux through loops and coils, and
 * motional EMF in a moving wire. Fields themselves remain quasi-static and are
 * still supplied by the analytic/Biot–Savart stack.
 */
export class InductionSystem {
  private scene: Scene;
  private states: SceneObject[] = [];
  private previousFlux = new Map<string, number>();
  private simTime = 0;

  constructor(scene: Scene) {
    this.scene = scene;
    for (const object of scene.objects) {
      if (!object.visible || !object.motion) continue;
      this.states.push(object);
    }
  }

  get active(): boolean {
    return this.states.length > 0;
  }

  get time(): number {
    return this.simTime;
  }

  advance(wallSeconds: number, timeScale = 1): InductionFrame | null {
    if (this.states.length === 0) return null;
    const dt = Math.min(Math.max(wallSeconds, 0), 0.08) * Math.max(0.02, timeScale);
    if (dt <= 0) return null;
    this.simTime += dt;

    const transforms = this.states.map((o) => motionAt(o, this.simTime));
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
      if (!object.visible) continue;
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
    const path = wirePath(moved);
    const points = moved.closed && path.length > 1 ? [...path, path[0]] : path;
    if (points.length < 2) return 0;
    const delta = 1e-5;
    const earlier = { ...wire, ...motionAt(wire, this.simTime - delta) };
    const later = { ...wire, ...motionAt(wire, this.simTime + delta) };
    let emf = 0;
    for (let i = 0; i + 1 < points.length; i++) {
      const a = localToWorld(moved, points[i]);
      const b = localToWorld(moved, points[i + 1]);
      const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const localMid: Vec3 = points[i].map((v, k) => (v + points[i + 1][k]) / 2) as Vec3;
      const pa = localToWorld(earlier, localMid);
      const pb = localToWorld(later, localMid);
      const v: Vec3 = pa.map((v, k) => (pb[k] - v) / (2 * delta)) as Vec3;
      const bField = sampleBAt(segments, mid);
      const B: Vec3 = [bField[0] + externalB[0], bField[1] + externalB[1], bField[2] + externalB[2]];
      const drift = cross(v, B);
      const dl: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      emf += dot(drift, dl);
    }
    return emf;
  }
}
