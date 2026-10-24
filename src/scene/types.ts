import type { ColormapName } from '../engine/colormap';
import type { Vec3 } from '../engine/math/vec3';

export type SceneMode = 'fields' | 'waves';

/**
 * Scripted rigid motion used by the induction demos. `oscillate` translates
 * along `axis` with the given amplitude; `spin` adds a rotation rate about
 * the (axis-aligned) `axis`.
 */
export interface PeriodicMotion {
  kind: 'oscillate' | 'spin';
  axis: Vec3;
  amplitude: number; // metres, oscillate only
  frequency: number; // Hz
  phase?: number; // radians
}

export interface MotionKeyframe {
  time: number; // seconds
  position: Vec3; // offset from initial position, metres
  rotation: Vec3; // offset from initial Euler angles, radians
}

export type MotionSpec = PeriodicMotion | {
  kind: 'keyframes';
  keyframes: MotionKeyframe[];
  loop: boolean;
};

export interface BodyDynamics {
  mode: 'fixed' | 'prescribed' | 'forceDriven';
  mass: number; // kg
  inertia: Vec3; // principal moments about local axes, kg m²
  velocity: Vec3; // initial world velocity, m/s
  angularVelocity: Vec3; // initial world angular velocity, rad/s
}

export interface SceneObjectBase {
  id: string;
  kind: string;
  name: string;
  position: Vec3;
  rotation: Vec3; // Euler XYZ, radians
  visible: boolean;
  locked?: boolean;
  motion?: MotionSpec;
  dynamics?: BodyDynamics;
}

export interface ChargeObject extends SceneObjectBase {
  kind: 'charge';
  charge: number; // C
  color?: string;
}

export interface ChargedSphereObject extends SceneObjectBase {
  kind: 'chargedSphere';
  charge: number; // C
  radius: number; // m
  shell: boolean; // charged shell vs uniform solid sphere
}

export type ShapeKind = 'box' | 'sphere' | 'cylinder';

export interface ConductorObject extends SceneObjectBase {
  kind: 'conductor';
  shape: ShapeKind;
  size: Vec3; // full extents for box/cylinder; diameter for sphere
  potential: number; // V, used when floating=false
  floating: boolean;
  netCharge: number; // C, used when floating=true
  conductivity?: number; // S/m; Maxwell finite-conductivity model, default 0.01
  color?: string;
}

export interface DielectricObject extends SceneObjectBase {
  kind: 'dielectric';
  /** Missing selects the legacy nondispersive linear material. */
  materialModel?: 'linear' | 'drude';
  drude?: { omegaP: number; gamma: number }; // plasma angular frequency (rad/s), damping (s^-1)
  shape: ShapeKind;
  size: Vec3;
  epsilonR: number;
  muR: number;
  sigma: number; // S/m
  color?: string;
}

export interface WireObject extends SceneObjectBase {
  kind: 'wire';
  electricalModel?: 'impressed' | 'conducting' | 'currentFeed';
  /** Positive current transfers charge from the first endpoint/body to the last. */
  terminalFeed?: { from: string; to: string; riseTime: number }; // riseTime in seconds
  conductivity?: number; // S/m for passive Maxwell material; default 0.01
  points: Vec3[]; // local coordinates
  current: number; // A
  wireRadius: number; // m
  closed: boolean;
  path?: 'polyline' | 'smooth';
}

export interface LoopObject extends SceneObjectBase {
  kind: 'loop';
  electricalModel?: 'impressed' | 'conducting';
  conductivity?: number; // S/m for passive Maxwell material; default 0.01
  radius: number;
  current: number;
  wireRadius: number;
  axis: Vec3; // local +Z is the default normal
}

export interface CoilObject extends SceneObjectBase {
  kind: 'coil';
  electricalModel?: 'impressed' | 'conducting';
  conductivity?: number; // S/m for passive Maxwell material; default 0.01
  radius: number;
  length: number;
  turns: number;
  current: number;
  wireRadius: number;
  axis: Vec3; // local +Z left-handed winding axis
}

export interface MagnetObject extends SceneObjectBase {
  kind: 'magnet';
  radius: number;
  length: number;
  magnetization: number; // A/m (M)
  axis: Vec3; // local +Z from S to N
}

export type ParticleSpecies = 'electron' | 'proton' | 'custom';

export interface ParticleObject extends SceneObjectBase {
  kind: 'particle';
  species: ParticleSpecies;
  charge: number; // C
  mass: number; // kg
  velocity: Vec3; // m/s
  trailLength: number;
}

export interface ProbeObject extends SceneObjectBase {
  kind: 'probe';
  quantity: ProbeQuantity;
}

export type ProbeQuantity = 'E' | 'B' | 'phi' | 'energy';

export type WavePolarization = 'y' | 'z';

export interface PlaneWaveObject extends SceneObjectBase {
  kind: 'planeWave';
  direction: Vec3; // propagation direction, normalized by engine
  polarization: WavePolarization;
  frequency: number; // Hz
  amplitude: number; // V/m
  waveform: 'cw' | 'pulse';
}

export type FieldComponent = 'Ex' | 'Ey' | 'Ez' | 'Hx' | 'Hy' | 'Hz';

export interface PointSourceObject extends SceneObjectBase {
  kind: 'pointSource';
  component: FieldComponent;
  frequency: number;
  amplitude: number;
  waveform: 'cw' | 'pulse';
}

export interface DipoleAntennaObject extends SceneObjectBase {
  kind: 'antenna';
  length: number;
  frequency: number;
  amplitude: number;
  axis: Vec3;
  waveform: 'cw' | 'pulse';
}

export type SceneObject =
  | ChargeObject
  | ChargedSphereObject
  | ConductorObject
  | DielectricObject
  | WireObject
  | LoopObject
  | CoilObject
  | MagnetObject
  | ParticleObject
  | ProbeObject
  | PlaneWaveObject
  | PointSourceObject
  | DipoleAntennaObject;

export type ObjectKind = SceneObject['kind'];

export interface Domain {
  center: Vec3;
  size: Vec3;
}

export type BoundaryKind = 'pml' | 'pec' | 'periodic';

export interface SimulationSettings {
  /** Retain the electrostatic/quasistatic model; false selects Maxwell FDTD. */
  useApproximation: boolean;
  /** Explicitly initialize from authored voltages/charges, then disconnect supplies. */
  maxwellConductorModel?: 'isolated';
  /** Number of cells along the longest domain axis. Maxwell UI offers 16–64. */
  resolution: 16 | 24 | 32 | 48 | 64 | 96;
  /** Static solver boundary. */
  staticBoundary: 'grounded' | 'open';
  externalField: Vec3;
  externalB: Vec3;
  /** FDTD boundary conditions per axis. */
  boundary: { x: BoundaryKind; y: BoundaryKind; z: BoundaryKind };
  pmlCells: number;
  cfl: number;
  stepsPerFrame: number;
  /** Multiplier for particle / quasistatic animation speed. */
  timeScale: number;
}

export type SliceQuantity =
  | 'Emag'
  | 'Ex'
  | 'Ey'
  | 'Ez'
  | 'Bmag'
  | 'phi'
  | 'energyE'
  | 'energyB'
  | 'poynting';

export type FieldLayer = 'none' | 'E' | 'B' | 'P';

export interface DisplaySettings {
  fieldLines: 'none' | 'E' | 'B';
  lineCount: number;
  arrows: FieldLayer;
  arrowDensity: number;
  slices: { xy: boolean; xz: boolean; yz: boolean };
  /** Normalized -1..1 positions within the domain. */
  slicePositions: { x: number; y: number; z: number };
  sliceQuantity: SliceQuantity;
  sliceOpacity: number;
  sliceResolution: number;
  showGrid: boolean;
  showAxes: boolean;
  showDomain: boolean;
  showBoundCurrent: boolean;
  showProbeLabels: boolean;
  conductorOpacity: number;
  colormap: ColormapName;
  logScale: boolean;
  autoRange: boolean;
  range: [number, number] | null;
  vectorScale: number;
}

export interface CameraState {
  position: Vec3;
  target: Vec3;
  orthographic: boolean;
}

export interface TheoryBlock {
  title: string;
  body: string;
  equations?: string[];
  prompts?: string[];
}

export interface Scene {
  version: 1;
  id: string;
  name: string;
  subtitle?: string;
  description?: string;
  mode: SceneMode;
  tags: string[];
  domain: Domain;
  objects: SceneObject[];
  display: DisplaySettings;
  simulation: SimulationSettings;
  theory?: TheoryBlock;
  camera?: CameraState;
}

export interface ProbeReading {
  id: string;
  position: Vec3;
  E: Vec3;
  B: Vec3;
  D?: Vec3; // electric displacement, C/m²
  H?: Vec3; // magnetic field strength, A/m
  J?: Vec3; // current density, A/m²
  rho?: number; // deposited charge density, including bound polarization, C/m³
  phi: number;
  Emag: number;
  Bmag: number;
}

export interface SolverStats {
  solveMs: number;
  iterations: number;
  residual: number;
  algorithm: string;
  cells: number;
}

export interface MeasurementSnapshot {
  solver?: SolverStats;
  probes?: ProbeReading[];
  capacitance?: number;
  inductance?: number;
  electricEnergy?: number;
  magneticEnergy?: number;
  emf?: number;
  flux?: number;
  dt?: number;
  dx?: number;
  frequency?: number;
  wavelength?: number;
  extra?: Record<string, number>;
}

export interface TimeSeriesPoint {
  t: number;
  values: Record<string, number>;
}

export const isCharge = (o: SceneObject): o is ChargeObject => o.kind === 'charge';
export const isChargedSphere = (o: SceneObject): o is ChargedSphereObject => o.kind === 'chargedSphere';
export const isConductor = (o: SceneObject): o is ConductorObject => o.kind === 'conductor';
export const isDielectric = (o: SceneObject): o is DielectricObject => o.kind === 'dielectric';
export const isWire = (o: SceneObject): o is WireObject => o.kind === 'wire';
export const isLoop = (o: SceneObject): o is LoopObject => o.kind === 'loop';
export const isCoil = (o: SceneObject): o is CoilObject => o.kind === 'coil';
export const isMagnet = (o: SceneObject): o is MagnetObject => o.kind === 'magnet';
export const isParticle = (o: SceneObject): o is ParticleObject => o.kind === 'particle';
export const isProbe = (o: SceneObject): o is ProbeObject => o.kind === 'probe';
export const isPlaneWave = (o: SceneObject): o is PlaneWaveObject => o.kind === 'planeWave';
export const isPointSource = (o: SceneObject): o is PointSourceObject => o.kind === 'pointSource';
export const isAntenna = (o: SceneObject): o is DipoleAntennaObject => o.kind === 'antenna';
