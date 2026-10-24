import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const help = `Usage: node scripts/audit-maxwell-coupling.mjs [options]

Audit actual MaxwellSceneSolver force-driven charges; no alternate solver or quadrature.
  --quick                     Mesh 16,24 and time factors 1,2 (default: 16,24,32,48; 1,2,4)
  --model point|sphere|smooth|all   Default: all (legacy point and sphere); smooth is opt-in
  --width 0.075               Smooth source width in metres, independent of mesh
  --shift 0                   Translate both source centers along x, in metres
  --isolated                  One resting smooth source; requires --model smooth
  --position .013,.017,.021    Isolated initial position in metres (three components)
  --variant symmetric|asymmetric|all   Default: all
  --study mesh|time|all        Default: all
  --grids 16,24,32             Override mesh resolutions (integers 8..48)
  --time-grid 24               Fixed resolution for time refinement (8..48)
  --time-factors 1,2,4         Multiply base step count (integers 1..16)
  --json artifacts/FILE.json   Default: artifacts/maxwell-coupling-audit.json
  --help

JSON includes field-current work, exact Yee/physical field energies, mechanical
energy, finite-volume energy flux, momentum estimates, and source/git provenance.
Momentum stress flux is missing; this audit cannot establish full M6 acceptance.
Exit 0 means the audit ran, not that coupling conservation passed.`;

function integers(value, minimum, maximum, option) {
  const values = value.split(',').map(Number);
  if (!values.length || values.some(v => !Number.isInteger(v) || v < minimum || v > maximum)) {
    throw new Error(`${option} requires comma-separated integers ${minimum}..${maximum}.`);
  }
  return [...new Set(values)];
}

function parseArgs(args) {
  const options = { model: 'all', variant: 'all', study: 'all', timeGrid: 24, quick: false, width: 0.075, shift: 0, isolated: false, position: [0.013, 0.017, 0.021] };
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if (option === '--help' || option === '-h') return { help: true };
    if (option === '--quick') { options.quick = true; continue; }
    if (option === '--isolated') { options.isolated = true; continue; }
    if (!['--model', '--variant', '--study', '--grids', '--time-grid', '--time-factors', '--width', '--shift', '--position', '--json'].includes(option)) {
      throw new Error(`Unknown option ${option}. Use --help.`);
    }
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}.`);
    if (option === '--model' || option === '--variant' || option === '--study') {
      const choices = { '--model': ['point', 'sphere', 'smooth', 'all'], '--variant': ['symmetric', 'asymmetric', 'all'], '--study': ['mesh', 'time', 'all'] };
      if (!choices[option].includes(value)) throw new Error(`${option} requires ${choices[option].join('|')}.`);
      options[option.slice(2)] = value;
    } else if (option === '--grids') options.grids = integers(value, 8, 48, option);
    else if (option === '--time-factors') options.timeFactors = integers(value, 1, 16, option);
    else if (option === '--width' || option === '--shift') {
      const number = Number(value);
      if (!Number.isFinite(number) || option === '--width' && number <= 0) throw new Error(`${option} requires a finite ${option === '--width' ? 'positive ' : ''}number in metres.`);
      options[option.slice(2)] = number;
    } else if (option === '--position') {
      const position = value.split(',').map(Number);
      if (position.length !== 3 || position.some(v => !Number.isFinite(v))) throw new Error('--position requires three finite comma-separated coordinates in metres.');
      options.position = position;
    } else if (option === '--time-grid') {
      const values = integers(value, 8, 48, option);
      if (values.length !== 1) throw new Error('--time-grid requires one resolution.');
      options.timeGrid = values[0];
    } else options.json = resolve(projectRoot, value);
  }
  if (options.isolated && options.model !== 'smooth') throw new Error('--isolated requires the explicit --model smooth selection.');
  if (options.isolated && options.variant !== 'all') throw new Error('--variant is not applicable to an isolated single source.');
  options.grids ??= options.quick ? [16, 24] : [16, 24, 32, 48];
  options.timeFactors ??= options.quick ? [1, 2] : [1, 2, 4];
  options.json ??= resolve(projectRoot, 'artifacts/maxwell-coupling-audit.json');
  const artifactPath = relative(resolve(projectRoot, 'artifacts'), options.json);
  if (!artifactPath || artifactPath === '..' || artifactPath.startsWith(`..${sep}`) || isAbsolute(artifactPath) || extname(options.json) !== '.json') {
    throw new Error('--json must name a .json file inside the ignored artifacts directory.');
  }
  return options;
}

function git(args) {
  try { return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8', windowsHide: true }).trim(); }
  catch { return null; }
}

async function sourceHashes() {
  const paths = ['scripts/audit-maxwell-coupling.mjs', 'package.json', 'package-lock.json'];
  async function visit(directory) {
    for (const entry of await readdir(resolve(projectRoot, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(path);
      else if (/\.tsx?$/.test(path)) paths.push(path);
    }
  }
  await visit('src/engine'); await visit('src/scene');
  const hashes = {};
  for (const path of paths.sort()) hashes[path] = createHash('sha256').update(await readFile(resolve(projectRoot, path))).digest('hex');
  return hashes;
}

const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function makeAuditScene(api, model, variant, resolution, timeFactor, options) {
  const mass = 1e-23, charge = 1e-9, radius = model === 'sphere' ? 0.1 : null;
  const separation = model === 'point' ? 0.25 : 0.4;
  const duration = model === 'point' ? 4e-10 : 3e-10;
  const make = position => model === 'sphere' ? api.makeChargedSphere(position, charge, radius, false) : api.makeCharge(position, charge);
  const leftPosition = options.isolated ? options.position.map((value, axis) => value + (axis === 0 ? options.shift : 0)) : [-separation / 2 + options.shift, 0, 0];
  const left = make(leftPosition), right = make([separation / 2 + options.shift, 0, 0]);
  if (model === 'smooth') for (const object of [left, right]) Object.assign(object, { sourceProfile: 'smooth', sourceWidth: options.width });
  left.id = 'source-left'; right.id = 'source-right';
  right.charge = -charge * (variant === 'asymmetric' ? 0.8 : 1);
  // Isotropic inertia avoids interpreting world angular velocity as body-local.
  // These declared values also reproduce the original exploratory audit.
  const inertia = radius === null ? 1 : 0.4 * mass * radius ** 2;
  left.dynamics = { mode: 'forceDriven', mass, inertia: [inertia, inertia, inertia], velocity: [0, 0, 0], angularVelocity: [0, 0, 0] };
  right.dynamics = { ...structuredClone(left.dynamics), mass: mass * (variant === 'asymmetric' ? 1.2 : 1) };
  const steps = Math.ceil(duration * api.C_LIGHT * Math.sqrt(3) * resolution / 0.7) * timeFactor;
  const cfl = duration / steps * api.C_LIGHT * Math.sqrt(3) * resolution;
  const objects = options.isolated ? [left] : [left, right];
  const scene = api.makeScene({ name: `Coupled Maxwell audit: ${model}, ${variant}`, objects });
  Object.assign(scene.simulation, { resolution, pmlCells: 4, cfl, useApproximation: false, staticBoundary: 'open', externalField: [0, 0, 0], externalB: [0, 0, 0], boundary: { x: 'pml', y: 'pml', z: 'pml' } });
  return { scene, steps, parameters: { model, variant, isolated: options.isolated, resolution, timeFactor, duration, separation: options.isolated ? null : separation, impulseReferenceSeparation: separation, radius, sourceProfile: model === 'smooth' ? 'smooth' : model === 'point' ? 'cic' : 'uniformSphereQuadrature', sourceWidth: model === 'smooth' ? options.width : null, shift: options.shift, initialPositions: objects.map(object => object.position), cfl, charges: objects.map(object => object.charge), masses: objects.map(object => object.dynamics.mass), principalInertia: objects.map(object => object.dynamics.inertia) } };
}

function captureState(solver, volume, api) {
  const g = solver.core, electric = [g.Ex, g.Ey, g.Ez], magnetic = [g.Bx, g.By, g.Bz];
  const strides = [1, g.nx, g.nx * g.ny], dv = g.dx * g.dy * g.dz;
  let physicalFieldEnergy = 0, exactFieldEnergy = 0, kineticEnergy = 0;
  const fieldMomentum = [0, 0, 0], mechanicalMomentum = [0, 0, 0], bodies = [];
  for (let k = volume.low[2]; k <= volume.high[2]; k++) for (let j = volume.low[1]; j <= volume.high[1]; j++) for (let i = volume.low[0]; i <= volume.high[0]; i++) {
    const index = g.index(i, j, k), E = [], B = [];
    for (let axis = 0; axis < 3; axis++) {
      const centeredB = g.synchronizedB(axis, index), previousB = magnetic[axis][index];
      // Use the kernel constants for its exact discrete energy ledger.
      const electricTerm = api.EPSILON_0 * electric[axis][index] ** 2;
      physicalFieldEnergy += electricTerm + centeredB ** 2 / api.MU_0;
      exactFieldEnergy += electricTerm + previousB * (2 * centeredB - previousB) / api.MU_0;
      const a = strides[(axis + 1) % 3], b = strides[(axis + 2) % 3];
      E[axis] = (electric[axis][index] + electric[axis][index + a] + electric[axis][index + b] + electric[axis][index + a + b]) / 4;
      B[axis] = (centeredB + g.synchronizedB(axis, index + strides[axis])) / 2;
    }
    const momentumDensity = cross(E, B);
    for (let axis = 0; axis < 3; axis++) fieldMomentum[axis] += api.EPS0 * momentumDensity[axis] * dv;
  }
  for (const object of solver.scene.objects) {
    const body = solver.bodies.get(object.id), mass = object.dynamics.mass;
    const field = object.kind === 'charge' ? solver.sampleSourceForForce(object, body.position) : null;
    let momentum, kinetic;
    if (object.kind === 'charge') {
      // Stored p is at t-dt/2. This local half kick estimates p(t); it does
      // not alter accepted state and is not an exact coupled energy invariant.
      momentum = api.advanceParticle(body.position, body.momentum, object.charge, mass, field.E, field.B, g.dt / 2).momentum;
      const norm = Math.hypot(...momentum);
      kinetic = norm * (norm / mass) / (Math.hypot(1, norm / (mass * api.C_LIGHT)) + 1);
    } else {
      // Rigid velocities are the integer-time values returned by the actual
      // explicit force integrator. No fictitious particle half kick is applied.
      momentum = body.velocity.map(value => mass * value);
      kinetic = dot(momentum, momentum) / (2 * mass) + body.angularVelocity.reduce((sum, omega, axis) => sum + 0.5 * object.dynamics.inertia[axis] * omega ** 2, 0);
    }
    kineticEnergy += kinetic;
    for (let axis = 0; axis < 3; axis++) mechanicalMomentum[axis] += momentum[axis];
    const integerVelocity = object.kind === 'charge' ? api.velocityFromMomentum(momentum, mass) : [...body.velocity];
    bodies.push({ id: object.id, position: [...body.position], velocity: [...body.velocity], angularVelocity: [...body.angularVelocity], storedMomentum: [...body.momentum], estimatedIntegerMomentum: momentum, estimatedIntegerVelocity: integerVelocity, estimatedIntegerSpeed: Math.hypot(...integerVelocity), electricForce: field ? field.E.map(value => object.charge * value) : null, electricForceNorm: field ? Math.abs(object.charge) * Math.hypot(...field.E) : null, kineticEnergy: kinetic });
  }
  return { time: solver.time, physicalFieldEnergy: physicalFieldEnergy * dv / 2, exactFieldEnergy: exactFieldEnergy * dv / 2, kineticEnergy, fieldMomentum, mechanicalMomentum, totalMomentum: mechanicalMomentum.map((value, axis) => value + fieldMomentum[axis]), bodies };
}

function cases(options) {
  const selected = [], models = options.model === 'all' ? ['point', 'sphere'] : [options.model];
  const variants = options.isolated ? ['isolated'] : options.variant === 'all' ? ['symmetric', 'asymmetric'] : [options.variant];
  for (const model of models) for (const variant of variants) {
    const entries = new Map();
    const add = (resolution, timeFactor, study) => {
      const key = `${resolution}/${timeFactor}`;
      if (!entries.has(key)) entries.set(key, { model, variant, resolution, timeFactor, studies: [] });
      entries.get(key).studies.push(study);
    };
    if (options.study !== 'time') for (const resolution of options.grids) add(resolution, 1, 'mesh');
    if (options.study !== 'mesh') for (const factor of options.timeFactors) add(options.timeGrid, factor, 'time');
    selected.push(...entries.values());
  }
  return selected;
}

function auditCase(api, selected, options) {
  const prepared = makeAuditScene(api, selected.model, selected.variant, selected.resolution, selected.timeFactor, options);
  const started = performance.now(), solver = new api.MaxwellSceneSolver(prepared.scene), p = solver.meta.physical;
  const volume = { low: [p.x0 + 1, p.y0 + 1, p.z0 + 1], high: [p.x1 - 3, p.y1 - 3, p.z1 - 3] };
  const initial = captureState(solver, volume, api);
  let outwardBoundaryEnergy = 0, matterWork = 0, maximumFieldStepResidual = 0, sumFieldStepResidual = 0;
  for (let step = 0; step < prepared.steps; step++) {
    const balance = api.measureFieldBalance(solver.core, volume, () => solver.step());
    outwardBoundaryEnergy += balance.boundaryEnergy; matterWork += balance.matterWork;
    maximumFieldStepResidual = Math.max(maximumFieldStepResidual, Math.abs(balance.residual));
    sumFieldStepResidual += balance.residual;
  }
  const final = captureState(solver, volume, api), kineticChange = final.kineticEnergy - initial.kineticEnergy;
  const exactFieldChange = final.exactFieldEnergy - initial.exactFieldEnergy;
  const physicalFieldChange = final.physicalFieldEnergy - initial.physicalFieldEnergy;
  const transferScale = Math.max(Math.abs(kineticChange), Math.abs(matterWork), 1e-40);
  const momentumChange = final.totalMomentum.map((value, axis) => value - initial.totalMomentum[axis]);
  // Fixed physical impulse scale is useful even when total P cancels by symmetry.
  const impulseScale = (1e-9) ** 2 * prepared.parameters.duration / (4 * Math.PI * api.EPS0 * prepared.parameters.impulseReferenceSeparation ** 2);
  const diagnostics = solver.diagnostics();
  const isolatedControl = options.isolated ? { initialForceNorm: initial.bodies[0].electricForceNorm, finalIntegerSpeed: final.bodies[0].estimatedIntegerSpeed, mechanicalImpulseNorm: Math.hypot(...final.mechanicalMomentum), mechanicalImpulseOverReference: Math.hypot(...final.mechanicalMomentum) / impulseScale, displacement: final.bodies[0].position.map((value, axis) => value - initial.bodies[0].position[axis]) } : null;
  return { ...selected, parameters: prepared.parameters, fieldSteps: prepared.steps, dt: solver.core.dt, grid: [solver.core.nx, solver.core.ny, solver.core.nz], chargeElements: solver.charges.length, volume, elapsedMs: performance.now() - started, initial, final, isolatedControl,
    energy: { kineticChange, exactFieldChange, physicalFieldChange, matterWork, outwardBoundaryEnergy, transferScale, exactCoupledResidual: exactFieldChange + kineticChange + outwardBoundaryEnergy, physicalCoupledResidual: physicalFieldChange + kineticChange + outwardBoundaryEnergy, signedRelativeResidual: (exactFieldChange + kineticChange + outwardBoundaryEnergy) / transferScale, kineticMinusFieldWork: kineticChange - matterWork, fieldLedgerResidual: exactFieldChange + matterWork + outwardBoundaryEnergy, maximumFieldStepResidual, sumFieldStepResidual },
    momentum: { change: momentumChange, changeNorm: Math.hypot(...momentumChange), impulseScale, normalizedChange: Math.hypot(...momentumChange) / impulseScale, stressFluxIncluded: false },
    diagnostics: Object.fromEntries(['gaussRelative', 'preparationResidual', 'openBoundaryResidual', 'ohmicLoss', 'sourceParticleCount', 'sourceParticleKinetic', 'sourceParticleWork', 'sourceParticleCouplingResidual', 'sourceParticleCouplingRelative', 'mechanicalWork'].filter(key => key in diagnostics).map(key => [key, diagnostics[key]])) };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(help); return; }
  const beforeHashes = await sourceHashes();
  const provenance = { generatedAt: new Date().toISOString(), commandArguments: process.argv.slice(2), node: process.version, platform: process.platform, gitHead: git(['rev-parse', 'HEAD']), gitBranch: git(['branch', '--show-current']), gitStatus: git(['status', '--short']), sourceSha256: beforeHashes };
  const server = await createServer({ root: projectRoot, configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom', logLevel: 'error' });
  const results = [];
  try {
    const modules = await Promise.all(['/src/engine/maxwell/sceneSolver.ts', '/src/scene/defaults.ts', '/src/engine/maxwell/dynamics.ts', '/src/engine/maxwell/fieldBalance.ts', '/src/engine/maxwell/yee.ts', '/src/engine/constants.ts'].map(path => server.ssrLoadModule(path)));
    const api = Object.assign({}, ...modules);
    for (const selected of cases(options)) {
      const result = auditCase(api, selected, options); results.push(result);
      console.log(`${selected.model}/${selected.variant} N=${selected.resolution} dt/${selected.timeFactor}: coupled residual=${result.energy.exactCoupledResidual.toExponential(5)} J (${(100 * result.energy.signedRelativeResidual).toFixed(3)}% of transfer), field ledger=${result.energy.fieldLedgerResidual.toExponential(3)} J`);
      if (result.isolatedControl) console.log(`  Isolated initial force=${result.isolatedControl.initialForceNorm.toExponential(5)} N; final synchronized speed=${result.isolatedControl.finalIntegerSpeed.toPrecision(6)} m/s; mechanical impulse/reference=${(100 * result.isolatedControl.mechanicalImpulseOverReference).toPrecision(5)}%`);
    }
  } finally { await server.close(); }
  const afterHashes = await sourceHashes();
  provenance.finishedAt = new Date().toISOString();
  provenance.gitStatusAfter = git(['status', '--short']);
  provenance.changedSourceFilesDuringRun = [...new Set([...Object.keys(beforeHashes), ...Object.keys(afterHashes)])].filter(path => beforeHashes[path] !== afterHashes[path]);
  if (provenance.changedSourceFilesDuringRun.length) provenance.sourceSha256After = afterHashes;
  const report = { schemaVersion: 1, provenance, options, acceptance: { fullM6Accepted: false, statement: 'Coupled acceptance remains unestablished. Legacy reference cases expose an energy defect; selected finite-shape energy convergence does not complete momentum or general force-driven validation.', momentumBudgetComplete: false }, limitations: [
    'Field-only exact Yee conservation does not establish particle or rigid-body coupling conservation.',
    'Point p(t) uses an estimated local half kick; stored velocity remains at the particle half step.',
    'Rigid-body forces are sampled at the old field time and used by an explicit mechanics update; no implicit or adjoint field-work synchronization is implemented.',
    'Legacy CIC and sphere sources use a centered nodal force gather that differs from trajectory-deposition-adjoint electric work. Smooth sources use their own instantaneous shape-derivative electric gather, not an implicit time-centered work solve.',
    'Smooth beta3 source width is a declared physical length; the shape support extends two widths per Cartesian axis. Mesh phase, width resolution and self-thrust require separate convergence checks.',
    'Point CIC width shrinks with mesh spacing; its self-energy diverges. Uniform spheres retain the existing finite 192-element quadrature, whose integration error is not independently converged.',
    'Initial Coulomb tails are included inside the finite box and energy flux is measured. Maxwell-stress momentum flux and external-tail momentum bounds are missing.',
    'Symmetric total momentum cancellation alone is not an acceptance result. No torque budget or general force-driven material acceptance is established.',
  ], results };
  await mkdir(dirname(options.json), { recursive: true });
  await writeFile(options.json, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Audit JSON: ${relative(projectRoot, options.json)}\nM6 acceptance: NOT ESTABLISHED; momentum stress flux is missing. Exit 0 only confirms the audit ran.`);
}

main().catch(error => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
