import type { Vec3 } from '../engine/math/vec3';
import type {
  CameraState,
  ChargedSphereObject,
  ChargeObject,
  CoilObject,
  ConductorObject,
  DielectricObject,
  DipoleAntennaObject,
  DisplaySettings,
  Domain,
  LoopObject,
  MagnetObject,
  ParticleObject,
  PlaneWaveObject,
  PointSourceObject,
  ProbeObject,
  Scene,
  SceneObject,
  SceneObjectBase,
  ShapeKind,
  SimulationSettings,
  WireObject,
} from './types';

let counter = 0;

export function uid(prefix = 'obj'): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function defaultDomain(): Domain {
  return { center: [0, 0, 0], size: [1, 1, 1] };
}

export function defaultDisplay(): DisplaySettings {
  return {
    fieldLines: 'E',
    lineCount: 36,
    arrows: 'none',
    arrowDensity: 9,
    slices: { xy: true, xz: false, yz: false },
    slicePositions: { x: 0, y: 0, z: 0 },
    sliceQuantity: 'Emag',
    sliceOpacity: 0.88,
    sliceResolution: 160,
    showGrid: true,
    showAxes: true,
    showDomain: true,
    showBoundCurrent: false,
    showProbeLabels: true,
    colormap: 'electric',
    logScale: false,
    autoRange: true,
    range: null,
    vectorScale: 1,
  };
}

export function defaultSimulation(): SimulationSettings {
  return {
    resolution: 64,
    staticBoundary: 'grounded',
    externalField: [0, 0, 0],
    externalB: [0, 0, 0],
    boundary: { x: 'pml', y: 'pml', z: 'pml' },
    pmlCells: 10,
    cfl: 0.9,
    stepsPerFrame: 2,
    timeScale: 1,
  };
}

export function defaultCamera(): CameraState {
  return { position: [1.55, 1.15, 1.55], target: [0, 0, 0], orthographic: false };
}

function base(
  kind: SceneObject['kind'],
  name: string,
  position: Vec3 = [0, 0, 0],
): SceneObjectBase {
  return {
    id: uid(kind),
    kind,
    name,
    position,
    rotation: [0, 0, 0],
    visible: true,
  };
}

export function makeCharge(position: Vec3 = [0, 0, 0], charge = 1e-9): ChargeObject {
  return { ...base('charge', 'Point charge', position), kind: 'charge', charge };
}

export function makeChargedSphere(
  position: Vec3 = [0, 0, 0],
  charge = 1e-8,
  radius = 0.12,
  shell = false,
): ChargedSphereObject {
  return {
    ...base('chargedSphere', shell ? 'Charged shell' : 'Charged sphere', position),
    kind: 'chargedSphere',
    charge,
    radius,
    shell,
  };
}

export function makeConductor(
  position: Vec3 = [0, 0, 0],
  shape: ShapeKind = 'box',
  size: Vec3 = [0.3, 0.3, 0.3],
): ConductorObject {
  return {
    ...base('conductor', 'Conductor', position),
    kind: 'conductor',
    shape,
    size,
    potential: 0,
    floating: false,
    netCharge: 0,
  };
}

export function makeDielectric(
  position: Vec3 = [0, 0, 0],
  shape: ShapeKind = 'box',
  size: Vec3 = [0.3, 0.3, 0.3],
  epsilonR = 4,
): DielectricObject {
  return {
    ...base('dielectric', 'Dielectric', position),
    kind: 'dielectric',
    shape,
    size,
    epsilonR,
    muR: 1,
    sigma: 0,
  };
}

export function makeWire(points: Vec3[] = [[-0.3, 0, 0], [0.3, 0, 0]], current = 1): WireObject {
  return {
    ...base('wire', 'Current wire', [0, 0, 0]),
    kind: 'wire',
    points: points.map((p) => [...p] as Vec3),
    current,
    wireRadius: 0.008,
    closed: false,
  };
}

export function makeLoop(position: Vec3 = [0, 0, 0], radius = 0.2, current = 1): LoopObject {
  return {
    ...base('loop', 'Current loop', position),
    kind: 'loop',
    radius,
    current,
    wireRadius: 0.008,
    axis: [0, 0, 1],
  };
}

export function makeCoil(position: Vec3 = [0, 0, 0], radius = 0.09, length = 0.4, turns = 12): CoilObject {
  return {
    ...base('coil', 'Solenoid', position),
    kind: 'coil',
    radius,
    length,
    turns,
    current: 1,
    wireRadius: 0.006,
    axis: [0, 0, 1],
  };
}

export function makeMagnet(position: Vec3 = [0, 0, 0], radius = 0.05, length = 0.24): MagnetObject {
  return {
    ...base('magnet', 'Bar magnet', position),
    kind: 'magnet',
    radius,
    length,
    magnetization: 8e5,
    axis: [0, 0, 1],
  };
}

export function makeParticle(
  position: Vec3 = [0, 0, 0],
  species: ParticleObject['species'] = 'electron',
  velocity: Vec3 = [0, 0, 0],
  charge = -1.602176634e-19,
  mass = 9.1093837015e-31,
): ParticleObject {
  return {
    ...base('particle', species === 'proton' ? 'Proton' : 'Electron', position),
    kind: 'particle',
    species,
    charge,
    mass,
    velocity,
    trailLength: 900,
  };
}

export function makeProbe(position: Vec3 = [0, 0, 0]): ProbeObject {
  return {
    ...base('probe', 'Field probe', position),
    kind: 'probe',
    quantity: 'E',
  };
}

export function makePlaneWave(): PlaneWaveObject {
  return {
    ...base('planeWave', 'Plane wave', [0, 0, 0]),
    kind: 'planeWave',
    direction: [1, 0, 0],
    polarization: 'z',
    frequency: 3e8,
    amplitude: 1,
    waveform: 'cw',
  };
}

export function makePointSource(
  position: Vec3 = [0, 0, 0],
  component: PointSourceObject['component'] = 'Ez',
): PointSourceObject {
  return {
    ...base('pointSource', 'Point source', position),
    kind: 'pointSource',
    component,
    frequency: 3e8,
    amplitude: 1,
    waveform: 'pulse',
  };
}

export function makeAntenna(position: Vec3 = [0, 0, 0]): DipoleAntennaObject {
  return {
    ...base('antenna', 'Dipole antenna', position),
    kind: 'antenna',
    length: 0.25,
    frequency: 3e8,
    amplitude: 1,
    axis: [0, 1, 0],
    waveform: 'cw',
  };
}

export function makeScene(partial: Partial<Scene> & { name: string }): Scene {
  return {
    version: 1,
    id: uid('scene'),
    name: partial.name,
    subtitle: partial.subtitle,
    description: partial.description,
    mode: partial.mode ?? 'fields',
    tags: partial.tags ?? [],
    domain: partial.domain ?? defaultDomain(),
    objects: partial.objects ?? [],
    display: partial.display ?? defaultDisplay(),
    simulation: partial.simulation ?? defaultSimulation(),
    theory: partial.theory,
    camera: partial.camera ?? defaultCamera(),
  };
}

/** Rotate a local vector by Euler XYZ (same order as Three.js). */
export function rotateEuler(v: Vec3, rot: Vec3): Vec3 {
  const [rx, ry, rz] = rot;
  let [x, y, z] = v;
  // X
  let c = Math.cos(rx), s = Math.sin(rx);
  [y, z] = [c * y - s * z, s * y + c * z];
  // Y
  c = Math.cos(ry); s = Math.sin(ry);
  [x, z] = [c * x + s * z, -s * x + c * z];
  // Z
  c = Math.cos(rz); s = Math.sin(rz);
  [x, y] = [c * x - s * y, s * x + c * y];
  return [x, y, z];
}

export function localToWorld(obj: SceneObjectBase, p: Vec3): Vec3 {
  const r = rotateEuler(p, obj.rotation);
  return [r[0] + obj.position[0], r[1] + obj.position[1], r[2] + obj.position[2]];
}

export function worldToLocal(obj: SceneObjectBase, p: Vec3): Vec3 {
  const d: Vec3 = [p[0] - obj.position[0], p[1] - obj.position[1], p[2] - obj.position[2]];
  const [rx, ry, rz] = obj.rotation;
  // inverse Z, Y, X
  let [x, y, z] = d;
  let c = Math.cos(-rz), s = Math.sin(-rz);
  [x, y] = [c * x - s * y, s * x + c * y];
  c = Math.cos(-ry); s = Math.sin(-ry);
  [x, z] = [c * x + s * z, -s * x + c * z];
  c = Math.cos(-rx); s = Math.sin(-rx);
  [y, z] = [c * y - s * z, s * y + c * z];
  return [x, y, z];
}

export function worldAxis(obj: SceneObjectBase, localAxis: Vec3): Vec3 {
  return rotateEuler(localAxis, obj.rotation);
}

export function cloneObject<T extends SceneObject>(obj: T): T {
  return {
    ...obj,
    id: uid(obj.kind),
    position: [...obj.position] as Vec3,
    rotation: [...obj.rotation] as Vec3,
    ...(obj.kind === 'wire' ? { points: obj.points.map((p) => [...p] as Vec3) } : {}),
  } as T;
}
