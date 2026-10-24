import type { Scene, SceneObject, ConductorObject, WireObject, LoopObject, CoilObject } from '../../scene/types';
import { isCharge, isChargedSphere, isConductor, isDielectric, isParticle, isMagnet } from '../../scene/types';
import type { Vec3 } from '../math/vec3';
import { C_LIGHT, EPS0, MU0 } from '../constants';
import { localToWorld, rotateEuler, worldToLocal } from '../../scene/defaults';
import { motionAt, motionVelocityAt } from '../../scene/motion';
import { objectBoundingBox, shapeContains } from '../../scene/rasterize';
import { collectAnalyticSources, sampleAnalyticPhi } from '../electrostatics/analytic';
import { solveDense } from '../electrostatics/multigrid';
import { buildMagnetostaticSources } from '../magnetostatics/biotSavart';
import type { FdtdMeta } from '../fdtd/fdtd3d';
import { YeeSolver } from './yee';
import { initializeElectric } from './initialization';
import { createOpenInitializer } from './openInitialization';
import { MaxwellSampler, cross } from './sampling';
import { depositCharge, depositTrajectory, trajectoryWeights } from './deposition';
import { advanceParticle, momentumFromVelocity, validateSubluminalVelocity } from './dynamics';
import { buildMagnetizationSources, magnetizationCurrent, polarizationCharge, type MagnetVectorField } from './magnetization';
import { advanceRigidBody } from './rigid';
import { makeFilamentGeometry, type FilamentGeometry } from './conductingFilament';

// Particle momentum is staggered at time-dt/2, as in the PIC leapfrog.
interface BodyState { position: Vec3; rotation: Vec3; velocity: Vec3; angularVelocity: Vec3; momentum: Vec3; }
interface ConductingLattice { local: Vec3[]; charge: Float64Array; initialCharge: Float64Array; edges: { from: number; to: number; conductance: number }[]; }
interface ChargeElement { object: SceneObject; local: Vec3; charge: number; }
const OFF: Vec3[] = [[0.5, 0, 0], [0, 0.5, 0], [0, 0, 0.5]];
type ConductingBody = ConductorObject | WireObject | LoopObject | CoilObject;
function usesParticleDynamics(o: SceneObject) {
  return (isCharge(o) || isParticle(o)) && (o.dynamics?.mode === 'forceDriven' || isParticle(o) && !o.dynamics && !o.motion);
}
function isConductingBody(o: SceneObject): o is ConductingBody {
  return isConductor(o) || (o.kind === 'wire' || o.kind === 'loop' || o.kind === 'coil') && o.electricalModel === 'conducting';
}

/** Scene adapter for the time-domain solver. Sources and matter supply J;
 * every subsequent E/B value comes from Maxwell evolution, not a static overlay.
 * Moving electrodes use a declared finite-conductivity material, not a PEC mask.
 */
export class MaxwellSceneSolver extends MaxwellSampler {
  readonly meta: FdtdMeta;
  readonly charges: ChargeElement[] = [];
  readonly bodies = new Map<string, BodyState>();
  private initial!: ReturnType<YeeSolver['snapshot']>;
  private initialBodies = new Map<string, BodyState>();
  private impressed: Float64Array[];
  private chargeScale = 1e-30;
  private preparationResidual = 0;
  private openBoundaryResidual = 0;
  private openBoundaryIterations = 0;
  private forces = new Map<string, { force: Vec3; torque: Vec3 }>();
  private mechanicalWork = 0;
  private polarization?: MagnetVectorField;
  private magnetization?: MagnetVectorField;
  private hasMagnets = false;
  private elapsedMs = 0;
  private bodyCharge = new Map<string, Float64Array>();
  private initialBodyCharge = new Map<string, Float64Array>();
  private conductorLoss = 0;
  private filaments = new Map<string, FilamentGeometry>();
  private lattices = new Map<string, ConductingLattice>();
  private conductingEdges?: Int32Array;
  private dampingRows?: Float64Array;
  private materialOhmLimit?: number;
  private motionKinematics = new Map<string, { time: number; center: Vec3; linear: Vec3; omega: Vec3 }>();

  constructor(scene: Scene) {
    const res = scene.simulation.resolution, size = scene.domain.size, longest = Math.max(...size);
    if (!size.every(v => Number.isFinite(v) && v > 0)) throw new Error('Domain dimensions must be positive.');
    if (!Number.isInteger(res) || res < 8 || res > 128) throw new Error('Maxwell resolution must be an integer between 8 and 128.');
    if (!Number.isInteger(scene.simulation.pmlCells) || scene.simulation.pmlCells < 2 || scene.simulation.pmlCells > 32) throw new Error('Absorbing layers require an integer thickness of 2 to 32 cells.');
    const physical = size.map(v => Math.max(8, Math.round(res * v / longest)) + 1);
    const ds = size.map((v, a) => v / (physical[a] - 1));
    const pad = (['x', 'y', 'z'] as const).map(a => scene.simulation.boundary[a] === 'pml' ? scene.simulation.pmlCells : 0);
    const dims = physical.map((v, a) => v + 2 * pad[a]);
    // Float64 reference implementation with auxiliary fields and working memory.
    const bytesPerCell = 1100 + 16 * scene.objects.filter(o => o.visible && isConductingBody(o)).length;
    if (dims.reduce((n, v) => n * v, 1) * bytesPerCell > 768 * 1024 ** 2) throw new Error('This Maxwell grid exceeds the 768 MiB working-memory budget. Lower resolution or absorbing-layer thickness.');
    const core = new YeeSolver({ nx: dims[0], ny: dims[1], nz: dims[2], dx: ds[0], dy: ds[1], dz: ds[2], cfl: scene.simulation.cfl,
      boundary: scene.simulation.boundary, pmlCells: Math.max(...pad) });
    const min = size.map((v, a) => scene.domain.center[a] - v / 2 - pad[a] * ds[a]) as Vec3;
    super(core, structuredClone(scene), min);
    this.impressed = [new Float64Array(core.rho.length), new Float64Array(core.rho.length), new Float64Array(core.rho.length)];
    for (const object of this.scene.objects) if (object.visible && isConductingBody(object) && !isConductor(object)) {
      this.filaments.set(object.id, makeFilamentGeometry({ ...object, position: [0, 0, 0], rotation: [0, 0, 0] }, Math.max(...ds)));
      this.bodyCharge.set(object.id, new Float64Array(core.rho.length));
    }
    this.validateScene();
    for (const object of this.scene.objects.filter(o => o.visible)) {
      const dynamics = object.dynamics;
      const active = dynamics?.mode === 'forceDriven' || usesParticleDynamics(object);
      const velocity: Vec3 = active ? dynamics?.velocity ?? (isParticle(object) ? object.velocity : [0, 0, 0]) : [0, 0, 0];
      validateSubluminalVelocity(velocity);
      this.bodies.set(object.id, { position: [...object.position], rotation: [...object.rotation], velocity: [...velocity],
        angularVelocity: [...(active ? dynamics?.angularVelocity ?? [0, 0, 0] : [0, 0, 0])] as Vec3, momentum: usesParticleDynamics(object) ? momentumFromVelocity(velocity, dynamics?.mass ?? (isParticle(object) ? object.mass : 1)) : [0, 0, 0] });
      if (isCharge(object) || isParticle(object)) this.charges.push({ object, local: [0, 0, 0], charge: object.charge });
      else if (isChargedSphere(object)) {
        const shells = object.shell ? 1 : 4, per = 48;
        for (let shell = 0; shell < shells; shell++) for (let i = 0; i < per; i++) {
          const r = object.radius * (object.shell ? 1 : Math.cbrt((shell + 0.5) / shells));
          const y = 1 - 2 * (i + 0.5) / per, rr = Math.sqrt(1 - y * y), phi = i * 2.399963229728653;
          this.charges.push({ object, local: [r * rr * Math.cos(phi), r * y, r * rr * Math.sin(phi)], charge: object.charge / (shells * per) });
        }
      }
    }
    this.assignMaterials();
    core.validateMaterials();
    this.materialOhmLimit = this.explicitOhmLimit();
    this.validateScene();
    for (const charge of this.charges) depositCharge(core.rho, core, this.gridPoint(localToWorld(this.pose(charge.object, 0), charge.local)), charge.charge);
    this.hasMagnets = this.scene.objects.some(o => o.visible && isMagnet(o));
    if (this.hasMagnets) {
      const sources = buildMagnetizationSources(this.scene, core, this.min, 0);
      this.polarization = sources.polarization; this.magnetization = sources.magnetization;
      const boundCharge = polarizationCharge(this.polarization, core);
      for (let c = 0; c < core.rho.length; c++) core.rho[c] += boundCharge[c];
    }
    this.initializeElectrodes();
    this.initializeConductingLattices();
    this.buildImpressedCurrents();
    this.initializeMagnetic();
    core.captureStaticBackground();
    for (const object of this.scene.objects.filter(o => o.visible)) {
      if (!(isParticle(object) || isCharge(object))) continue;
      if (!usesParticleDynamics(object)) continue;
      const body = this.bodies.get(object.id)!, field = this.sampleForForce(body.position);
      const mass = object.dynamics?.mass ?? (isParticle(object) ? object.mass : 1);
      body.momentum = advanceParticle(body.position, body.momentum, -object.charge, mass, field.E, field.B, core.dt / 2).momentum;
    }
    this.initial = core.snapshot();
    this.initialBodies = structuredClone(this.bodies);
    this.initialBodyCharge = structuredClone(this.bodyCharge);
    const frequency = Math.max(0, ...scene.objects.filter(o => o.visible && 'frequency' in o).map(o => 'frequency' in o ? o.frequency : 0));
    this.meta = { nx: core.nx, ny: core.ny, nz: core.nz, dx: core.dx, dy: core.dy, dz: core.dz, dt: core.dt, cfl: scene.simulation.cfl,
      physical: { x0: pad[0], x1: pad[0] + physical[0], y0: pad[1], y1: pad[1] + physical[1], z0: pad[2], z1: pad[2] + physical[2] },
      domainMin: size.map((v, a) => scene.domain.center[a] - v / 2) as Vec3, domainMax: size.map((v, a) => scene.domain.center[a] + v / 2) as Vec3,
      pad: pad as [number, number, number], frequency, wavelengthCells: frequency > 0 ? C_LIGHT / (frequency * Math.max(...ds)) : 0 };
    let scale = 0;
    for (const q of core.rho) scale += q * q;
    this.chargeScale = Math.max(Math.sqrt(scale / core.rho.length), 1e-30);
  }

  get time() { return this.core.time; }
  get steps() { return this.core.steps; }
  private gridPoint(p: Vec3): Vec3 { return p.map((v, a) => v - this.min[a]) as Vec3; }
  private point(i: number, j: number, k: number, off: Vec3 = [0, 0, 0]): Vec3 {
    return [this.min[0] + (i + off[0]) * this.core.dx, this.min[1] + (j + off[1]) * this.core.dy, this.min[2] + (k + off[2]) * this.core.dz];
  }

  private explicitOhmLimit() {
    if (this.materialOhmLimit !== undefined) return this.materialOhmLimit;
    const s = this.core;
    let epsilon = 1, mu = 1;
    for (const values of [s.epsX, s.epsY, s.epsZ]) for (const value of values) epsilon = Math.min(epsilon, value);
    for (const values of [s.muX, s.muY, s.muZ]) for (const value of values) mu = Math.min(mu, value);
    const courant2 = (C_LIGHT * s.dt) ** 2 * (1 / s.dx ** 2 + 1 / s.dy ** 2 + 1 / s.dz ** 2) / (epsilon * mu);
    // For the explicit-current Yee recurrence at the highest grid frequency,
    // sigma*dt/epsilon <= 2*(1-Courant^2). Reserve a 10% margin. Checking the
    // damping and vacuum CFL independently misses this coupled restriction.
    return epsilon * Math.max(0, Math.min(0.45, 1.8 * (1 - courant2)));
  }

  private validateScene() {
    if (Object.values(this.scene.simulation.boundary).includes('periodic')) throw new Error('Periodic scene initialization and transported sources are not yet validated in Maxwell mode. Choose absorbing (PML) or PEC boundaries.');
    const conductors = this.scene.objects.filter(o => o.visible && isConductor(o));
    if (conductors.length && this.scene.simulation.maxwellConductorModel !== 'isolated') throw new Error('Choose the electrical model “Initialize plate voltages, then isolate” in Solve. Full-wave voltage-clamped electrodes require an explicit feed and return path.');
    for (const o of this.scene.objects.filter(o => o.visible)) {
      if (o.motion?.kind === 'keyframes' && o.dynamics?.mode !== 'fixed' && o.dynamics?.mode !== 'forceDriven' && o.motion.loop && o.motion.keyframes.length > 1) {
        const first = o.motion.keyframes[0], last = o.motion.keyframes.at(-1)!;
        if (first.position.some((v, a) => Math.abs(v - last.position[a]) > 1e-12) || first.rotation.some((v, a) => Math.abs(v - last.rotation[a]) > 1e-12)) throw new Error(`${o.name}: looping keyframes must return continuously to the initial pose in Maxwell mode.`);
      }
      if (isDielectric(o) && (o.motion && o.dynamics?.mode !== 'fixed' || o.dynamics?.mode === 'forceDriven')) throw new Error(`${o.name}: moving dielectric constitutive response is not validated. Use a stationary dielectric or explicitly select approximation.`);
      if (['antenna', 'pointSource', 'planeWave'].includes(o.kind) && o.motion && o.dynamics?.mode !== 'fixed') throw new Error(`${o.name}: moving driven sources require a transported feed model. Use a fixed source or explicitly select approximation.`);
      if (o.dynamics?.mode === 'forceDriven' && !(isCharge(o) || isParticle(o) || isChargedSphere(o) || isConductingBody(o))) throw new Error(`${o.name}: force-driven motion is supported for charge distributions, particles and finite-conductivity bodies.`);
      if (isConductingBody(o)) {
        const sigma = o.conductivity ?? 0.01;
        if (!(sigma >= 0 && Number.isFinite(sigma)) || sigma * this.core.dt / EPS0 > this.explicitOhmLimit()) throw new Error(`${o.name}: conductivity is too stiff for the combined wave/current stability limit. Reduce CFL, refine the grid or explicitly choose a lower conductivity; no hidden conductivity cap is applied.`);
      }
      if (isParticle(o) && usesParticleDynamics(o) && !((o.dynamics?.mass ?? o.mass) > 0)) throw new Error(`${o.name}: particle mass must be positive.`);
      if (o.dynamics?.mode === 'forceDriven' && (!(o.dynamics.mass > 0) || o.dynamics.inertia.some(v => !(v > 0)))) throw new Error(`${o.name}: force-driven mass and principal inertia must be positive.`);
    }
    this.assertMatterInside(0);
  }

  private assertMatterInside(time: number) {
    const { center, size } = this.scene.domain;
    for (const original of this.scene.objects.filter(o => o.visible)) {
      const o = this.pose(original, time);
      let half: Vec3;
      if (isConductor(o) || isDielectric(o)) half = o.size.map(v => v / 2) as Vec3;
      else if (isMagnet(o)) {
        const margin = Math.min(this.core.dx, this.core.dy, this.core.dz) / 2;
        half = [o.radius + margin, o.radius + margin, o.length / 2 + margin];
      } else if (isChargedSphere(o)) half = [o.radius, o.radius, o.radius];
      else if (isCharge(o) || isParticle(o)) half = [0, 0, 0];
      else if (isConductingBody(o)) {
        const geometry = this.filaments.get(o.id)!;
        for (let corner = 0; corner < 8; corner++) {
          const p = localToWorld(o, geometry.min.map((v, a) => corner & (1 << a) ? geometry.max[a] : v) as Vec3);
          if (p.some((v, a) => Math.abs(v - center[a]) > size[a] / 2 + 1e-12)) throw new Error(`${o.name}: conducting filament left the physical domain. Enlarge the domain.`);
        }
        continue;
      }
      else continue;
      for (let corner = 0; corner < 8; corner++) {
        const p = localToWorld(o, half.map((v, a) => corner & (1 << a) ? v : -v) as Vec3);
        if (isConductor(o) && p.some((v, a) => this.scene.simulation.boundary[(['x', 'y', 'z'] as const)[a]] === 'pec' && Math.abs(v - center[a]) >= size[a] / 2 - 1e-12)) throw new Error(`${o.name}: an isolated electrode cannot contact a PEC wall. Separate it from the wall; electrical contact requires an explicit model.`);
        if (p.some((v, a) => !Number.isFinite(v) || Math.abs(v - center[a]) > size[a] / 2 + 1e-12))
          throw new Error(`${o.name}: material/source left the physical domain. Enlarge the domain; charge exit and clipped material models are unsupported.`);
      }
    }
  }

  private bodyContains(body: ConductingBody, point: Vec3): boolean {
    return isConductor(body) ? shapeContains(body, point) : this.filaments.get(body.id)!.contains(worldToLocal(body, point));
  }

  pose(object: SceneObject, time = this.time): SceneObject {
    const body = this.bodies.get(object.id);
    if (object.dynamics?.mode === 'forceDriven' || usesParticleDynamics(object)) return { ...object, position: body?.position ?? object.position, rotation: body?.rotation ?? object.rotation };
    return object.dynamics?.mode === 'fixed' ? object : { ...object, ...motionAt(object, time) };
  }

  poses() { return this.scene.objects.filter(o => o.visible).map(o => { const p = this.pose(o); return { id: o.id, position: p.position, rotation: p.rotation }; }); }

  override sample(p: Vec3) {
    const sample = super.sample(p);
    // The kernel evolves the linear background with bound currents supplied
    // explicitly. Macroscopic readouts must also include impressed P and M.
    if (this.polarization && this.magnetization) for (let a = 0; a < 3; a++) {
      const face: Vec3 = [0.5, 0.5, 0.5]; face[a] = 0;
      sample.D[a] += this.interpolate(p, OFF[a], c => this.polarization![a][c]);
      sample.H[a] -= this.interpolate(p, face, c => this.magnetization![a][c]);
    }
    // energyE/B remain the linear-background field energy, excluding the
    // internal energy of externally maintained polarization/magnetization.
    return sample;
  }

  private velocity(object: SceneObject, world: Vec3, time: number): Vec3 {
    const body = this.bodies.get(object.id)!;
    if (object.dynamics?.mode === 'fixed') return [0, 0, 0];
    if (object.dynamics?.mode === 'forceDriven' || usesParticleDynamics(object)) {
      const r = world.map((v, a) => v - body.position[a]) as Vec3, spin = cross(body.angularVelocity, r);
      const velocity = body.velocity.map((v, a) => v + spin[a]) as Vec3;
      if (object.dynamics?.mode === 'forceDriven' && !isCharge(object) && !isParticle(object) && Math.hypot(...velocity) > 0.01 * C_LIGHT) throw new Error(`${object.name}: rigid-body material-point speed exceeds the nonrelativistic mechanics range (0.01c). Reduce translation or angular velocity.`);
      return velocity;
    }
    let kinematics = this.motionKinematics.get(object.id);
    if (!kinematics || kinematics.time !== time) {
      const center = this.pose(object, time).position, linear = motionVelocityAt(object, time, center);
      const x: Vec3 = [...center], y: Vec3 = [...center]; x[0]++; y[1]++;
      const vx = motionVelocityAt(object, time, x), vy = motionVelocityAt(object, time, y);
      kinematics = { time, center, linear, omega: [vy[2] - linear[2], linear[2] - vx[2], vx[1] - linear[1]] };
      this.motionKinematics.set(object.id, kinematics);
    }
    const spin = cross(kinematics.omega, world.map((v, a) => v - kinematics!.center[a]) as Vec3);
    const velocity = kinematics.linear.map((v, a) => v + spin[a]) as Vec3;
    validateSubluminalVelocity(velocity);
    return velocity;
  }

  private assignMaterials() {
    const s = this.core, eps = [s.epsX, s.epsY, s.epsZ], mus = [s.muX, s.muY, s.muZ], sig = [s.sigmaX, s.sigmaY, s.sigmaZ];
    const dielectrics = this.scene.objects.filter(o => o.visible && isDielectric(o));
    for (let k = 0; k < s.nz; k++) for (let j = 0; j < s.ny; j++) for (let i = 0; i < s.nx; i++) {
      const c = i + s.nx * (j + s.ny * k);
      for (let a = 0; a < 3; a++) for (const object of dielectrics) if (isDielectric(object)) {
        if (shapeContains(object, this.point(i, j, k, OFF[a]))) { eps[a][c] = object.epsilonR; sig[a][c] = object.sigma; }
        const off: Vec3 = [0.5, 0.5, 0.5]; off[a] = 0;
        if (shapeContains(object, this.point(i, j, k, off))) mus[a][c] = object.muR;
      }
    }
  }

  private initializeElectrodes() {
    const s = this.core, n = s.rho.length;
    const electrodes = this.scene.objects.filter((o): o is ConductorObject => o.visible && isConductor(o)).map(o => this.pose(o, 0) as ConductorObject);
    const owner = new Int32Array(n).fill(-1), fixed = new Uint8Array(n), phi = new Float64Array(n);
    const analytic = collectAnalyticSources(this.scene.objects.filter(o => !isParticle(o)), this.scene.simulation.externalField);
    const sourceRho = s.rho.slice();
    for (let k = 0; k < s.nz; k++) for (let j = 0; j < s.ny; j++) for (let i = 0; i < s.nx; i++) {
      const c = i + s.nx * (j + s.ny * k), p = this.point(i, j, k);
      if (i === 0 || j === 0 || k === 0 || i === s.nx - 1 || j === s.ny - 1 || k === s.nz - 1) {
        const onPec = ([i, j, k] as number[]).some((v, a) => (v === 0 || v === [s.nx, s.ny, s.nz][a] - 1) && this.scene.simulation.boundary[(['x', 'y', 'z'] as const)[a]] === 'pec');
        fixed[c] = 1; phi[c] = onPec || this.scene.simulation.staticBoundary === 'grounded' ? 0 : sampleAnalyticPhi(analytic, p);
      }
      for (let a = 0; a < electrodes.length; a++) if (shapeContains(electrodes[a], p)) {
        if (owner[c] >= 0) throw new Error('Maxwell electrodes overlap on the grid. Separate them or increase resolution.');
        owner[c] = a; fixed[c] = 1; phi[c] = electrodes[a].floating ? 0 : electrodes[a].potential;
      }
    }
    for (let a = 0; a < electrodes.length; a++) {
      if (!owner.includes(a)) throw new Error(`${electrodes[a].name}: no electrode nodes are resolved. Increase its thickness or grid resolution.`);
    }
    const dv = s.dx * s.dy * s.dz;
    const chargeOn = (a: number, subtractSources = true) => { let q = 0; for (let c = 0; c < n; c++) if (owner[c] === a) q += (s.rho[c] - (subtractSources ? sourceRho[c] : 0)) * dv; return q; };
    const open = this.scene.simulation.staticBoundary !== 'grounded' && Object.values(this.scene.simulation.boundary).every(value => value === 'pml');
    const support: number[] = [];
    if (open) for (let k = 1; k < s.nz - 1; k++) for (let j = 1; j < s.ny - 1; j++) for (let i = 1; i < s.nx - 1; i++) {
      const c = i + s.nx * (j + s.ny * k);
      const near = [c - 1, c + 1, c - s.nx, c + s.nx, c - s.nx * s.ny, c + s.nx * s.ny];
      const electrodeSurface = owner[c] >= 0 && near.some(next => owner[next] !== owner[c]);
      const epsilon = [s.epsX[c], s.epsX[c - 1], s.epsY[c], s.epsY[c - s.nx], s.epsZ[c], s.epsZ[c - s.nx * s.ny]];
      const dielectricInterface = epsilon.some(value => value !== epsilon[0]);
      if (sourceRho[c] !== 0 || electrodeSurface || dielectricInterface) support.push(c);
    }
    const openInitialize = open ? createOpenInitializer(s, fixed, support, this.min) : undefined;
    const prepare = (values: Float64Array, sources: Float64Array, external: Vec3) => {
      s.rho.set(sources);
      if (!openInitialize) return initializeElectric(s, fixed, values);
      const result = openInitialize(sources, values, external);
      this.openBoundaryResidual = Math.max(this.openBoundaryResidual, result.boundaryResidual);
      this.openBoundaryIterations += result.boundaryIterations;
      return result;
    };
    const basePhi = phi.slice();
    const result = prepare(phi, sourceRho, this.scene.simulation.externalField);
    this.preparationResidual = result.residual;
    const floating = electrodes.map((o, a) => o.floating ? a : -1).filter(a => a >= 0);
    if (floating.length) {
      const background = floating.map(a => chargeOn(a)), matrix = floating.map(() => floating.map(() => 0));
      for (let a = 0; a < floating.length; a++) {
        const unit = new Float64Array(n);
        for (let c = 0; c < n; c++) if (owner[c] === floating[a]) unit[c] = 1;
        prepare(unit, new Float64Array(n), [0, 0, 0]);
        floating.forEach((v, row) => { matrix[row][a] = chargeOn(v, false); });
      }
      const voltage = solveDense(matrix, floating.map((v, a) => electrodes[v].netCharge - background[a]));
      for (let c = 0; c < n; c++) { const f = floating.indexOf(owner[c]); if (f >= 0) basePhi[c] = voltage[f]; }
      const final = prepare(basePhi, sourceRho, this.scene.simulation.externalField);
      this.preparationResidual = Math.max(this.preparationResidual, final.residual);
    }
    // Track only the charge belonging to each electrode. Independent free and
    // polarization charges must never be advected by a neighboring body.
    for (let a = 0; a < electrodes.length; a++) {
      const owned = new Float64Array(n);
      for (let c = 0; c < n; c++) if (owner[c] === a) owned[c] = s.rho[c] - sourceRho[c];
      this.bodyCharge.set(electrodes[a].id, owned);
    }
  }

  private buildImpressedCurrents() {
    const objects = this.scene.objects.filter(o => o.visible && ['wire', 'loop', 'coil'].includes(o.kind) && !isConductingBody(o));
    for (const object of objects) if (object.motion && object.dynamics?.mode !== 'fixed' || object.dynamics?.mode === 'forceDriven') throw new Error(`${object.name}: moving impressed filaments require a transported charge/feed model. Use stationary current sources or the explicit approximation option.`);
    const segments = buildMagnetostaticSources(objects).segments;
    for (let a = 0; a < segments.count; a++) {
      const start = Array.from(segments.segs.slice(a * 6, a * 6 + 3)) as Vec3, end = Array.from(segments.segs.slice(a * 6 + 3, a * 6 + 6)) as Vec3;
      depositTrajectory(this.impressed[0], this.impressed[1], this.impressed[2], this.core, this.gridPoint(start), this.gridPoint(end), segments.currents[a] * this.core.dt, this.core.dt);
    }
  }

  private magnetCurrents() {
    if (!this.hasMagnets) return;
    const s = this.core;
    const midpoint = buildMagnetizationSources(this.scene, s, this.min, this.time + s.dt / 2);
    const nextSources = buildMagnetizationSources(this.scene, s, this.min, this.time + s.dt);
    const next = nextSources.polarization;
    const bound = magnetizationCurrent(midpoint.magnetization, s);
    const currents = [s.Jx, s.Jy, s.Jz];
    for (let a = 0; a < 3; a++) for (let c = 0; c < s.rho.length; c++)
      currents[a][c] += bound[a][c] + (next[a][c] - this.polarization![a][c]) / s.dt;
    this.polarization = next;
    this.magnetization = nextSources.magnetization;
  }

  private initializeMagnetic() {
    const s = this.core, ext = this.scene.simulation.externalB;
    s.Bx.fill(ext[0]); s.By.fill(ext[1]); s.Bz.fill(ext[2]);
    // Currents start at t=0, producing a resolved electromagnetic transient.
    // No Biot-Savart field is added to samples during the run.
  }

  private advanceBodies() {
    for (const object of this.scene.objects.filter(o => o.visible)) {
      const b = this.bodies.get(object.id)!;
      const forceDriven = object.dynamics?.mode === 'forceDriven';
      if (usesParticleDynamics(object)) {
        const mass = object.dynamics?.mass ?? (isParticle(object) ? object.mass : 1), field = this.sampleForForce(b.position);
        const p = advanceParticle(b.position, b.momentum, 'charge' in object ? object.charge : 0, mass, field.E, field.B, this.core.dt);
        // E and synchronized B are sampled at x^n,t^n; p is staggered at
        // n-1/2 -> n+1/2, then the conserved trajectory drifts x^n -> x^(n+1).
        b.position = b.position.map((x, a) => x + p.velocity[a] * this.core.dt) as Vec3;
        b.momentum = p.momentum; b.velocity = p.velocity;
      } else if (forceDriven && object.dynamics) {
        const { mass, inertia } = object.dynamics, f = this.forces.get(object.id) ?? { force: [0, 0, 0] as Vec3, torque: [0, 0, 0] as Vec3 };
        if (isChargedSphere(object)) for (const charge of this.charges.filter(c => c.object.id === object.id)) {
          const p = localToWorld(this.pose(object), charge.local), field = this.sampleForForce(p), velocity = this.velocity(object, p, this.time);
          const magnetic = cross(velocity, field.B), force = field.E.map((v, a) => charge.charge * (v + magnetic[a])) as Vec3;
          const torque = cross(p.map((v, a) => v - b.position[a]) as Vec3, force);
          for (let a = 0; a < 3; a++) { f.force[a] += force[a]; f.torque[a] += torque[a]; }
        }
        Object.assign(b, advanceRigidBody(b, f.force, f.torque, mass, inertia, this.core.dt));
        if (Math.hypot(...b.velocity) > C_LIGHT * 0.01) throw new Error(`${object.name}: rigid-body Newton–Euler mechanics exceeds its declared nonrelativistic range (0.01c).`);
        this.mechanicalWork += f.force.reduce((sum, v, a) => sum + v * b.velocity[a], 0) * this.core.dt;
      }
    }
  }

  private initializeConductingLattices() {
    const s = this.core, dv = s.dx * s.dy * s.dz, ds = [s.dx, s.dy, s.dz], stride = [1, s.nx, s.nx * s.ny];
    for (const original of this.scene.objects) if (original.visible && isConductingBody(original)) {
      const object = this.pose(original, 0) as ConductingBody, rho = this.bodyCharge.get(original.id)!;
      const indices = new Int32Array(s.rho.length).fill(-1), cells: number[] = [], local: Vec3[] = [], charge: number[] = [];
      for (let k = 1; k < s.nz - 1; k++) for (let j = 1; j < s.ny - 1; j++) for (let i = 1; i < s.nx - 1; i++) {
        const p = this.point(i, j, k), c = i + s.nx * (j + s.ny * k);
        if (!this.bodyContains(object, p)) continue;
        indices[c] = local.length; cells.push(c); local.push(worldToLocal(object, p)); charge.push(rho[c] * dv);
      }
      const edges: ConductingLattice['edges'] = [], sigma = original.conductivity ?? 0.01;
      for (const c of cells) for (let a = 0; a < 3; a++) {
        const next = c + stride[a];
        if (indices[next] >= 0) edges.push({ from: indices[c], to: indices[next], conductance: sigma * dv / ds[a] ** 2 });
      }
      if (!edges.length) throw new Error(`${original.name}: no connected material edges are resolved. Increase its physical thickness or grid resolution.`);
      const values = new Float64Array(charge);
      this.lattices.set(original.id, { local, edges, charge: values, initialCharge: values.slice() });
    }
  }

  private conductorCurrents() {
    const s = this.core, arrays = [s.Ex, s.Ey, s.Ez], currents = [s.Jx, s.Jy, s.Jz], dv = s.dx * s.dy * s.dz;
    this.forces.clear();
    if (!this.lattices.size) return;
    const occupied = this.conductingEdges ??= new Int32Array(3 * s.rho.length), rows = this.dampingRows ??= new Float64Array(3 * s.rho.length);
    occupied.fill(-1); rows.fill(0);
    let bodyIndex = 0;
    for (const original of this.scene.objects) {
      const lattice = this.lattices.get(original.id); if (!lattice) continue;
      const object = this.pose(original), points = lattice.local.map(p => localToWorld(object, p)), forceDriven = original.dynamics?.mode === 'forceDriven';
      const force: Vec3 = [0, 0, 0], torque: Vec3 = [0, 0, 0], change = new Float64Array(lattice.charge.length);
      const addForce = (p: Vec3, f: Vec3) => {
        const arm = p.map((v, a) => v - object.position[a]) as Vec3, moment = cross(arm, f);
        for (let a = 0; a < 3; a++) { force[a] += f[a]; torque[a] += moment[a]; }
      };
      for (let n = 0; n < points.length; n++) {
        const velocity = this.velocity(original, points[n], this.time); validateSubluminalVelocity(velocity);
        const q = lattice.charge[n]; if (q === 0 || !forceDriven) continue;
        const field = this.sampleForForce(points[n]), vxB = cross(velocity, field.B);
        addForce(points[n], field.E.map((v, a) => q * (v + vxB[a])) as Vec3);
      }
      for (const edge of lattice.edges) {
        const from = points[edge.from], to = points[edge.to], delta = to.map((v, a) => v - from[a]) as Vec3;
        const middle = to.map((v, a) => (v + from[a]) / 2) as Vec3;
        const weights = trajectoryWeights(s, this.gridPoint(from), this.gridPoint(to));
        let electricVoltage = 0, lengthSum = 0;
        for (const w of weights) { electricVoltage += arrays[w.axis][w.index] * w.length; lengthSum += Math.abs(w.length); }
        const velocity = this.velocity(original, middle, this.time);
        validateSubluminalVelocity(velocity);
        const beta = Math.hypot(...velocity) / C_LIGHT, gamma = 1 / Math.sqrt((1 - beta) * (1 + beta));
        const vDotDelta = velocity.reduce((sum, v, a) => sum + v * delta[a], 0), spinStencil = cross(delta, velocity);
        const motionalVoltage = this.sampleProjection(middle, 'B', spinStencil);
        const longitudinalVoltage = vDotDelta === 0 ? 0 : vDotDelta / C_LIGHT ** 2 * this.sampleProjection(middle, 'E', velocity);
        // Covariant Ohm law integrated along the material edge. The adjoint
        // electric integral preserves a prepared equal-potential graph.
        const restVoltage = gamma * (electricVoltage + motionalVoltage - longitudinalVoltage);
        const current = edge.conductance * restVoltage;
        const ds = [s.dx, s.dy, s.dz];
        // Bound the actual E stencil: adjoint voltage, point-sampled vv.E,
        // and the E-curl contribution to synchronized B. This is a row-sum
        // admission bound, not a complete moving-body energy proof.
        const voltageBound = lengthSum + Math.abs(vDotDelta) * velocity.reduce((sum, v) => sum + Math.abs(v), 0) / C_LIGHT ** 2
          + s.dt * spinStencil.reduce((sum, value, a) => sum + Math.abs(value) * (1 / ds[(a + 1) % 3] + 1 / ds[(a + 2) % 3]), 0);
        change[edge.from] -= current * s.dt; change[edge.to] += current * s.dt;
        for (const w of weights) {
          const slot = w.axis * s.rho.length + w.index;
          if (occupied[slot] >= 0 && occupied[slot] !== bodyIndex) throw new Error('Conducting bodies overlap or contact within the grid current support. Separate them or refine the grid; electrical merging is not supported.');
          occupied[slot] = bodyIndex;
          rows[slot] += edge.conductance * gamma * Math.abs(w.length) * voltageBound / dv;
          currents[w.axis][w.index] += current * w.length / dv;
        }
        if (forceDriven) {
          const magnetic = cross(delta, this.sampleEB(middle).B).map(v => current * v) as Vec3;
          addForce(middle, magnetic);
        }
        const driveVoltage = electricVoltage + motionalVoltage;
        this.conductorLoss += current * driveVoltage * s.dt;
      }
      for (let n = 0; n < lattice.charge.length; n++) lattice.charge[n] += change[n];
      this.forces.set(original.id, { force, torque }); bodyIndex++;
    }
    const limit = this.explicitOhmLimit();
    for (let a = 0; a < 3; a++) for (let c = 0; c < s.rho.length; c++) if (rows[a * s.rho.length + c] * s.dt / EPS0 > limit)
      throw new Error('Moving material deposition became too stiff for the combined wave/current timestep. Reduce CFL, refine the grid or choose a lower conductivity.');
  }

  private transportConductors(before: Map<string, Vec3[]>) {
    const s = this.core;
    for (const original of this.scene.objects) {
      const lattice = this.lattices.get(original.id); if (!lattice) continue;
      const object = this.pose(original, this.time + s.dt), old = before.get(original.id)!, rho = this.bodyCharge.get(original.id)!;
      rho.fill(0);
      for (let n = 0; n < lattice.local.length; n++) {
        const to = localToWorld(object, lattice.local[n]), q = lattice.charge[n];
        validateSubluminalVelocity(to.map((v, a) => (v - old[n][a]) / s.dt) as Vec3);
        if (q === 0) continue;
        depositTrajectory(s.Jx, s.Jy, s.Jz, s, this.gridPoint(old[n]), this.gridPoint(to), q, s.dt);
        depositCharge(rho, s, this.gridPoint(to), q);
      }
    }
  }

  private waveCurrents() {
    const s = this.core, t = this.time + s.dt / 2;
    for (const object of this.scene.objects.filter(o => o.visible)) {
      if (object.kind === 'pointSource' && object.component.startsWith('H')) throw new Error('Magnetic point-current sources are not implemented in the charge-conserving electric-source adapter. Choose an electric current source.');
      if (object.kind === 'pointSource' || object.kind === 'antenna') {
        const phase = 2 * Math.PI * object.frequency * t;
        const ramp = Math.min(1, t * object.frequency / 3);
        const wave = object.waveform === 'pulse' ? Math.exp(-(((t * object.frequency - 4) / 2) ** 2)) * Math.sin(phase) : ramp * Math.sin(phase);
        const axis: Vec3 = object.kind === 'antenna' ? rotateEuler([0, 1, 0], object.rotation) : ['Ex', 'Ey', 'Ez'].map(c => object.component === c ? 1 : 0) as Vec3;
        const length = object.kind === 'antenna' ? object.length : Math.min(s.dx, s.dy, s.dz);
        const start = object.position.map((v, a) => v - axis[a] * length / 2) as Vec3, end = object.position.map((v, a) => v + axis[a] * length / 2) as Vec3;
        // Full mode amplitude is A (electric current), shown explicitly in UI.
        depositTrajectory(s.Jx, s.Jy, s.Jz, s, this.gridPoint(start), this.gridPoint(end), object.amplitude * wave * s.dt, s.dt);
      } else if (object.kind === 'planeWave') {
        const direction = object.direction, norm = Math.hypot(...direction);
        if (!(norm > 0) || Math.abs(direction[0] / norm - 1) > 1e-8) throw new Error('This plane-wave source currently supports +x propagation; use a +x source or an explicit current distribution.');
        const i = Math.round((object.position[0] - this.min[0]) / s.dx);
        if (i < this.meta.physical.x0 || i >= this.meta.physical.x1) throw new Error('Place the source sheet inside the physical domain.');
        const phase = 2 * Math.PI * object.frequency * t;
        const envelope = object.waveform === 'pulse' ? Math.exp(-(((t * object.frequency - 4) / 2) ** 2)) : Math.min(1, t * object.frequency / 3);
        const amplitude = object.amplitude * Math.sin(phase) * envelope;
        const axis = object.polarization === 'y' ? 1 : 2, eta = Math.sqrt(MU0 / EPS0);
        // A physical electric current sheet radiates in both x directions.
        // The label states this; it is not a claimed one-way TFSF boundary.
        for (let k = this.meta.physical.z0; k < this.meta.physical.z1; k++) for (let j = this.meta.physical.y0; j < this.meta.physical.y1; j++) {
          [s.Jx, s.Jy, s.Jz][axis][i + s.nx * (j + s.ny * k)] += -2 * amplitude / (eta * s.dx);
        }
      }
    }
  }

  step(count = 1) {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Step count must be a nonnegative integer.');
    const started = performance.now();
    for (let a = 0; a < count; a++) {
      const s = this.core;
      this.assertMatterInside(this.time);
      s.Jx.set(this.impressed[0]); s.Jy.set(this.impressed[1]); s.Jz.set(this.impressed[2]);
      const before = this.charges.map(c => localToWorld(this.pose(c.object), c.local));
      const materialBefore = new Map<string, Vec3[]>();
      for (const o of this.scene.objects) { const lattice = this.lattices.get(o.id); if (lattice) { const pose = this.pose(o); materialBefore.set(o.id, lattice.local.map(p => localToWorld(pose, p))); } }
      this.conductorCurrents();
      this.advanceBodies();
      this.assertMatterInside(this.time + s.dt);
      this.transportConductors(materialBefore);
      this.charges.forEach((charge, c) => {
        const to = localToWorld(this.pose(charge.object, this.time + s.dt), charge.local);
        const velocity = before[c].map((v, n) => (to[n] - v) / s.dt) as Vec3;
        validateSubluminalVelocity(velocity);
        depositTrajectory(s.Jx, s.Jy, s.Jz, s, this.gridPoint(before[c]), this.gridPoint(to), charge.charge, s.dt);
      });
      this.magnetCurrents();
      this.waveCurrents();
      s.step();
    }
    this.elapsedMs += performance.now() - started;
  }

  reset() { this.core.restore(this.initial); this.bodies.clear(); for (const [id, b] of structuredClone(this.initialBodies)) this.bodies.set(id, b); this.forces.clear(); this.mechanicalWork = 0; this.elapsedMs = 0; this.conductorLoss = 0;
    this.bodyCharge = structuredClone(this.initialBodyCharge);
    for (const lattice of this.lattices.values()) lattice.charge.set(lattice.initialCharge);
    this.motionKinematics.clear();
    if (this.hasMagnets) {
      const sources = buildMagnetizationSources(this.scene, this.core, this.min, 0);
      this.polarization = sources.polarization; this.magnetization = sources.magnetization;
    }
  }

  diagnostics() {
    const s = this.core, d = s.diagnostics(), p = this.meta.physical;
    let scale2 = 0, count = 0;
    for (let k = p.z0 + 1; k < p.z1 - 1; k++) for (let j = p.y0 + 1; j < p.y1 - 1; j++) for (let i = p.x0 + 1; i < p.x1 - 1; i++) {
      const c = i + s.nx * (j + s.ny * k);
      scale2 += s.rho[c] ** 2 + EPS0 ** 2 * ((s.epsX[c] * s.Ex[c] / s.dx) ** 2 + (s.epsY[c] * s.Ey[c] / s.dy) ** 2 + (s.epsZ[c] * s.Ez[c] / s.dz) ** 2);
      count++;
    }
    // Initially uncharged wave scenes need a field-based normalization; a
    // near-zero initial rho alone amplifies roundoff into a false alarm.
    const gaussScale = Math.max(this.chargeScale, Math.sqrt(scale2 / Math.max(count, 1)));
    return { ...d, gaussRelative: d.divergenceE / gaussScale, gaussScale, preparationResidual: this.preparationResidual, openBoundaryResidual: this.openBoundaryResidual, openBoundaryIterations: this.openBoundaryIterations,
      mechanicalWork: this.mechanicalWork, conductorLoss: this.conductorLoss, estimatedBytes: this.core.rho.length * (1100 + 16 * this.bodyCharge.size),
      stepsPerSecond: this.elapsedMs > 0 ? 1000 * this.steps / this.elapsedMs : 0 };
  }
  energy() { const d = this.core.diagnostics(); return { electric: d.electricEnergy, magnetic: d.magneticEnergy }; }
}
