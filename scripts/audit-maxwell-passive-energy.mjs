import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const help = `Usage: node scripts/audit-maxwell-passive-energy.mjs [options]

Measure the actual force-driven neutral conductor's field + rigid kinetic + heat budget.
  --quick                  One mesh16 case, unless explicitly overridden
  --grids 16,24,32         Spatial-study resolutions, integers 8..48
  --time-grid 32           Fixed resolution for independent timestep refinement
  --time-factors 1,2,4     Multiply baseline step count, integers 1..64
  --duration 1e-9          Final physical time in seconds, positive and <= 1e-8
  --json artifacts/FILE.json  Default: artifacts/maxwell-passive-energy-audit.json
  --help

The default runs meshes16/24/32 plus dt/2 and dt/4 at32: five cases.
The body, conductivity, mass, initial speed, and imposed initial B stay fixed.
Exit 0 means measurements completed, not M6 passive-body conservation acceptance.`;

function integerList(value, option, low, high) {
  const parts = value.split(','), values = parts.map(Number);
  if (parts.some(part => !part.trim()) || values.some(v => !Number.isInteger(v) || v < low || v > high)) {
    throw new Error(`${option} requires comma-separated integers in ${low}..${high}.`);
  }
  return [...new Set(values)];
}

function parseArgs(args) {
  const options = { quick: false, duration: 1e-9, timeGrid: 32 };
  let explicitTimeStudy = false;
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if (option === '--help' || option === '-h') return { help: true };
    if (option === '--quick') { options.quick = true; continue; }
    if (!['--grids', '--time-grid', '--time-factors', '--duration', '--json'].includes(option)) throw new Error(`Unknown option ${option}. Use --help.`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}.`);
    if (option === '--grids') options.grids = integerList(value, option, 8, 48);
    else if (option === '--time-factors') { options.timeFactors = integerList(value, option, 1, 64); explicitTimeStudy = true; }
    else if (option === '--time-grid') {
      const values = integerList(value, option, 8, 48);
      if (values.length !== 1) throw new Error('--time-grid requires one resolution.');
      options.timeGrid = values[0]; explicitTimeStudy = true;
    } else if (option === '--duration') {
      options.duration = Number(value);
      if (!(Number.isFinite(options.duration) && options.duration > 0 && options.duration <= 1e-8)) throw new Error('--duration requires seconds in (0, 1e-8].');
    } else options.json = resolve(projectRoot, value);
  }
  options.grids ??= options.quick ? [16] : [16, 24, 32];
  options.timeFactors ??= options.quick ? [1] : [1, 2, 4];
  options.includeTimeStudy = !options.quick || explicitTimeStudy;
  options.json ??= resolve(projectRoot, 'artifacts/maxwell-passive-energy-audit.json');
  const path = relative(resolve(projectRoot, 'artifacts'), options.json);
  if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path) || extname(options.json) !== '.json') throw new Error('--json must name a .json file inside the ignored artifacts directory.');
  return options;
}

function git(args) {
  try { return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8', windowsHide: true }).trim(); }
  catch { return null; }
}

async function provenance() {
  const paths = ['scripts/audit-maxwell-passive-energy.mjs', 'package.json', 'package-lock.json'];
  async function visit(directory) {
    for (const entry of await readdir(resolve(projectRoot, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(path);
      else if (/\.tsx?$/.test(path)) paths.push(path);
    }
  }
  await visit('src/engine'); await visit('src/scene');
  const sourceHashes = {};
  for (const path of paths.sort()) sourceHashes[path] = createHash('sha256').update(await readFile(resolve(projectRoot, path))).digest('hex');
  return { capturedAt: new Date().toISOString(), head: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']), status: git(['status', '--short']), sourceHashes };
}

const physics = {
  domainSize: [1, 1, 1], position: [0, 0, 0], size: [0.25, 0.25, 0.25],
  mass: 1e-15, principalInertia: [1e-17, 1e-17, 1e-17], conductivity: 0.01,
  initialVelocity: [0, 1e6, 0], initialAngularVelocity: [0, 0, 0], initialExternalB: [0, 0, 0.001],
  initialNetCharge: 0, maxCfl: 0.7, pmlCells: 4,
};
const lightSpeed = 299792458, epsilon0 = 8.8541878128e-12;
const norm = vector => Math.hypot(...vector);
const squaredNorm = vector => vector.reduce((sum, value) => sum + value * value, 0);

function kinetic(body) {
  // This case deliberately has isotropic principal inertia, so world omega is sufficient.
  const translation = physics.mass * squaredNorm(body.velocity) / 2;
  const rotation = physics.principalInertia[0] * squaredNorm(body.angularVelocity) / 2;
  return { translation, rotation, total: translation + rotation };
}

function independentChecks(core, volume) {
  const dv = core.dx * core.dy * core.dz;
  let charge = 0, chargeL1 = 0, outsideCurrent = 0, gauss2 = 0, gaussScale2 = 0, count = 0;
  for (let k = 0; k < core.nz; k++) for (let j = 0; j < core.ny; j++) for (let i = 0; i < core.nx; i++) {
    const index = core.index(i, j, k);
    charge += core.rho[index] * dv; chargeL1 += Math.abs(core.rho[index]) * dv;
    const inside = i >= volume.low[0] && i <= volume.high[0] && j >= volume.low[1] && j <= volume.high[1] && k >= volume.low[2] && k <= volume.high[2];
    if (!inside) {
      outsideCurrent += core.dt * dv * (Math.abs(core.currentAtUpdate(0, index)) + Math.abs(core.currentAtUpdate(1, index)) + Math.abs(core.currentAtUpdate(2, index)));
      continue;
    }
    const divD = epsilon0 * ((core.Ex[index] - core.Ex[index - 1]) / core.dx
      + (core.Ey[index] - core.Ey[index - core.nx]) / core.dy
      + (core.Ez[index] - core.Ez[index - core.nx * core.ny]) / core.dz);
    gauss2 += (divD - core.rho[index]) ** 2;
    gaussScale2 += core.rho[index] ** 2 + epsilon0 ** 2 * ((core.Ex[index] / core.dx) ** 2 + (core.Ey[index] / core.dy) ** 2 + (core.Ez[index] / core.dz) ** 2);
    count++;
  }
  return { charge, chargeL1, outsideCurrent, gaussRms: Math.sqrt(gauss2 / count), gaussRelative: Math.sqrt(gauss2 / Math.max(gaussScale2, 1e-100)) };
}

function geometry(solver, objectId) {
  // Read-only diagnostic introspection: lattices is a TypeScript-private member,
  // accessible in Vite's JS output, not a stable public solver API. No state is changed.
  // Field evolution, current work, heat and K do not depend on this introspection.
  const lattice = solver.lattices?.get(objectId);
  if (!lattice) throw new Error('Audit lattice introspection no longer matches the solver; update geometry() before measuring.');
  const dv = solver.core.dx * solver.core.dy * solver.core.dz;
  const edgesByAxis = [0, 1, 2].map(axis => lattice.edges.filter(edge => Math.abs(lattice.local[edge.to][axis] - lattice.local[edge.from][axis]) > 0).length);
  return { nodes: lattice.local.length, edges: lattice.edges.length, edgesByAxis, edgeVolumeByAxis: edgesByAxis.map(edges => edges * dv), physicalVolume: physics.size.reduce((product, length) => product * length, 1) };
}

function cases(options) {
  const result = options.grids.map(resolution => ({ resolution, timeFactor: 1 }));
  if (options.includeTimeStudy) for (const timeFactor of options.timeFactors) {
    if (!result.some(row => row.resolution === options.timeGrid && row.timeFactor === timeFactor)) result.push({ resolution: options.timeGrid, timeFactor });
  }
  return result;
}

function runCase({ MaxwellSceneSolver, makeScene, makeConductor, measureFieldBalance }, options, { resolution, timeFactor }) {
  const object = makeConductor(physics.position, 'box', physics.size);
  Object.assign(object, { id: 'passive-body', floating: true, netCharge: physics.initialNetCharge, conductivity: physics.conductivity,
    dynamics: { mode: 'forceDriven', mass: physics.mass, inertia: physics.principalInertia, velocity: physics.initialVelocity, angularVelocity: physics.initialAngularVelocity } });
  const steps = Math.ceil(options.duration * lightSpeed * Math.sqrt(3) * resolution / physics.maxCfl) * timeFactor;
  const cfl = options.duration / steps * lightSpeed * Math.sqrt(3) * resolution;
  const scene = makeScene({ name: 'Neutral passive conductor motional startup', objects: [object] });
  Object.assign(scene.simulation, { resolution, cfl, pmlCells: physics.pmlCells, maxwellConductorModel: 'isolated', useApproximation: false, staticBoundary: 'open', externalB: physics.initialExternalB });
  const started = performance.now(), solver = new MaxwellSceneSolver(scene), core = solver.core;
  const volume = { low: [5, 5, 5], high: [resolution + 3, resolution + 3, resolution + 3] };
  const body = solver.bodies.get(object.id), initialBody = structuredClone(body), initialKinetic = kinetic(body), initialDiagnostics = solver.diagnostics();
  const materialGeometry = geometry(solver, object.id), history = [];
  let firstField, lastField, work = 0, absoluteWork = 0, flux = 0, fieldChange = 0, fieldResidual = 0, maxFieldResidual = 0;
  let outsideCurrent = 0, maxNetCharge = 0, maxChargeL1 = 0, maxGaussRelative = 0, maxGaussRms = 0;
  let maxBodySpeed = norm(body.velocity), maxMaterialSpeedBound = maxBodySpeed;
  const materialRadius = norm(physics.size) / 2;
  for (let step = 0; step < steps; step++) {
    const oldKinetic = kinetic(body);
    const balance = measureFieldBalance(core, volume, () => solver.step());
    const nextKinetic = kinetic(body), deltaKStep = nextKinetic.total - oldKinetic.total;
    firstField ??= balance.before; lastField = balance.after;
    work += balance.matterWork; absoluteWork += Math.abs(balance.matterWork); flux += balance.boundaryEnergy;
    fieldChange += balance.change; fieldResidual += balance.residual; maxFieldResidual = Math.max(maxFieldResidual, Math.abs(balance.residual));
    const checks = independentChecks(core, volume);
    outsideCurrent += checks.outsideCurrent; maxNetCharge = Math.max(maxNetCharge, Math.abs(checks.charge)); maxChargeL1 = Math.max(maxChargeL1, checks.chargeL1);
    maxGaussRelative = Math.max(maxGaussRelative, checks.gaussRelative); maxGaussRms = Math.max(maxGaussRms, checks.gaussRms);
    const bodySpeed = norm(body.velocity), materialSpeedBound = bodySpeed + norm(body.angularVelocity) * materialRadius;
    maxBodySpeed = Math.max(maxBodySpeed, bodySpeed); maxMaterialSpeedBound = Math.max(maxMaterialSpeedBound, materialSpeedBound);
    history.push({ step: step + 1, time: solver.time, kinetic: nextKinetic, deltaKStep, matterWork: balance.matterWork,
      outwardBoundaryEnergy: balance.boundaryEnergy, fieldChange: balance.change, fieldResidual: balance.residual,
      bodySpeed, materialSpeedBound, ...checks });
  }
  const diagnostics = solver.diagnostics(), finalKinetic = kinetic(body), deltaK = finalKinetic.total - initialKinetic.total;
  const heat = diagnostics.conductorLoss - initialDiagnostics.conductorLoss;
  const passiveResidual = deltaK + heat - work, closedResidual = fieldChange + deltaK + heat + flux;
  const transferScale = Math.max(Math.abs(deltaK), Math.abs(heat), absoluteWork, 1e-40);
  return { resolution, timeFactor, steps, cfl, dt: core.dt, finalTime: solver.time, grid: [core.nx, core.ny, core.nz], volume, materialGeometry,
    initialKinetic, finalKinetic, deltaK, heat, matterWork: work, absoluteMatterWork: absoluteWork, outwardBoundaryEnergy: flux,
    fieldBefore: firstField, fieldAfter: lastField, fieldChange, fieldResidual, maxFieldResidual,
    passiveResidual, closedResidual, transferScale, relativeResidual: Math.abs(passiveResidual) / transferScale,
    checks: { closedVolumeValid: outsideCurrent === 0, integratedAbsoluteCurrentOutsideVolume: outsideCurrent, maxNetCharge, maxChargeL1,
      maxGaussRelative, maxGaussRms, maxBodySpeed, maxMaterialSpeedBound, maxMaterialSpeedOverC: maxMaterialSpeedBound / lightSpeed,
      nonrelativisticRangeValid: maxMaterialSpeedBound < 0.01 * lightSpeed },
    initialBody, finalBody: structuredClone(body), initialDiagnostics, diagnostics, elapsedMs: performance.now() - started, history };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(help); return; }
  const before = await provenance();
  const report = { generatedAt: new Date().toISOString(), arguments: process.argv.slice(2), environment: { node: process.version, platform: process.platform, architecture: process.arch },
    options, physics, provenance: { before }, limitations: [
      'Exit 0 is measurement completion, not passive-body acceptance.',
      'conductorLoss is the current implementation diagnostic, not assumed exact thermodynamic heat.',
      'lattice geometry uses read-only TypeScript-private introspection, not a stable solver API.',
      'Fixed CFL mesh refinement also changes dt and inclusive-node conductor geometry.',
      'Large uniform magnetic energy limits precision of native field-energy subtraction.',
      'The symmetric isotropic translating case does not validate torque or arbitrary conductor geometries.',
    ], results: [] };
  const server = await createServer({ root: projectRoot, configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom', logLevel: 'error' });
  try {
    const [{ MaxwellSceneSolver }, { makeScene, makeConductor }, { measureFieldBalance }] = await Promise.all([
      server.ssrLoadModule('/src/engine/maxwell/sceneSolver.ts'), server.ssrLoadModule('/src/scene/defaults.ts'), server.ssrLoadModule('/src/engine/maxwell/fieldBalance.ts'),
    ]);
    for (const selected of cases(options)) {
      const row = runCase({ MaxwellSceneSolver, makeScene, makeConductor, measureFieldBalance }, options, selected);
      report.results.push(row);
      console.log(JSON.stringify({ resolution: row.resolution, timeFactor: row.timeFactor, dt: row.dt, deltaK: row.deltaK, heat: row.heat,
        matterWork: row.matterWork, outwardBoundaryEnergy: row.outwardBoundaryEnergy, fieldChange: row.fieldChange, passiveResidual: row.passiveResidual,
        relativeResidual: row.relativeResidual, fieldResidual: row.fieldResidual, closedVolumeValid: row.checks.closedVolumeValid }));
    }
  } finally {
    await server.close();
    const after = await provenance(); report.provenance.after = after;
    report.provenance.sourceChangedDuringRun = JSON.stringify(before.sourceHashes) !== JSON.stringify(after.sourceHashes);
    report.provenance.headChangedDuringRun = before.head !== after.head;
    report.provenance.statusChangedDuringRun = before.status !== after.status;
    await mkdir(dirname(options.json), { recursive: true }); await writeFile(options.json, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(`Wrote ${relative(projectRoot, options.json)}; sourceChangedDuringRun=${report.provenance.sourceChangedDuringRun}.`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
