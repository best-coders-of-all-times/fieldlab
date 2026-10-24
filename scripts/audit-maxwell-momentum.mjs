import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const help = `Usage: node scripts/audit-maxwell-momentum.mjs [options]

Physical momentum and Maxwell-stress audit of actual smooth force-driven sources.
  --quick                       Mesh 16 only; time factors 1,2
  --variant asymmetric|translated|all   Default: all
  --study mesh|time|all          Default: mesh
  --grids 16,24,32               Mesh resolutions, integers 8..48
  --time-grid 32                 Fixed grid for time refinement
  --time-factors 1,2,4           Multiply baseline step count, integers 1..8
  --half-extents .4375           Physical half-widths of centered cubic boxes, metres
  --quadrature exact|midpoint|both   Default: exact; both compares volume/surface rules
  --width .075                  Fixed physical beta3 source width, metres
  --shift .013                  Translation of the translated symmetric pair, metres
  --json artifacts/FILE.json     Default: artifacts/maxwell-momentum-audit.json
  --help

Exact quadrature integrates piecewise-trilinear reconstructed field products,
not an exact discrete Yee momentum invariant. Initial Coulomb stress is retained.
Boxes intersecting assigned-charge dual support or the PML halo are excluded.
Exit 0 means measurements completed, not M6 acceptance; torque remains unvalidated.`;

function numberList(value, option, minimum, maximum, integral = false) {
  const parts = value.split(','), values = parts.map(Number);
  if (parts.some(p => !p.trim()) || values.some(v => !Number.isFinite(v) || v < minimum || v > maximum || integral && !Number.isInteger(v))) {
    throw new Error(`${option} requires comma-separated ${integral ? 'integers' : 'numbers'} in ${minimum}..${maximum}.`);
  }
  return [...new Set(values)];
}

function parseArgs(args) {
  const options = { variant: 'all', study: 'mesh', timeGrid: 32, halfExtents: [0.4375], quadrature: 'exact', width: 0.075, shift: 0.013, quick: false };
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if (option === '--help' || option === '-h') return { help: true };
    if (option === '--quick') { options.quick = true; continue; }
    if (!['--variant', '--study', '--grids', '--time-grid', '--time-factors', '--half-extents', '--quadrature', '--width', '--shift', '--json'].includes(option)) throw new Error(`Unknown option ${option}. Use --help.`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}.`);
    if (['--variant', '--study', '--quadrature'].includes(option)) {
      const choices = { '--variant': ['asymmetric', 'translated', 'all'], '--study': ['mesh', 'time', 'all'], '--quadrature': ['exact', 'midpoint', 'both'] };
      if (!choices[option].includes(value)) throw new Error(`${option} requires ${choices[option].join('|')}.`);
      options[option.slice(2)] = value;
    } else if (option === '--grids') options.grids = numberList(value, option, 8, 48, true);
    else if (option === '--time-factors') options.timeFactors = numberList(value, option, 1, 8, true);
    else if (option === '--half-extents') options.halfExtents = numberList(value, option, Number.MIN_VALUE, 0.5);
    else if (option === '--time-grid') {
      const values = numberList(value, option, 8, 48, true);
      if (values.length !== 1) throw new Error('--time-grid requires one resolution.');
      options.timeGrid = values[0];
    } else if (option === '--width' || option === '--shift') {
      const number = Number(value);
      if (!Number.isFinite(number) || option === '--width' && number <= 0) throw new Error(`${option} requires a finite ${option === '--width' ? 'positive ' : ''}length in metres.`);
      options[option.slice(2)] = number;
    } else options.json = resolve(projectRoot, value);
  }
  options.grids ??= options.quick ? [16] : [16, 24, 32];
  options.timeFactors ??= options.quick ? [1, 2] : [1, 2, 4];
  options.json ??= resolve(projectRoot, 'artifacts/maxwell-momentum-audit.json');
  const path = relative(resolve(projectRoot, 'artifacts'), options.json);
  if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path) || extname(options.json) !== '.json') throw new Error('--json must name a .json file inside the ignored artifacts directory.');
  return options;
}

function git(args) {
  try { return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8', windowsHide: true }).trim(); }
  catch { return null; }
}

async function sourceHashes() {
  const paths = ['scripts/audit-maxwell-momentum.mjs', 'package.json', 'package-lock.json'];
  async function visit(directory) {
    for (const entry of await readdir(resolve(projectRoot, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(path);
      else if (/\.tsx?$/.test(path)) paths.push(path);
    }
  }
  await visit('src/engine'); await visit('src/scene');
  const result = {};
  for (const path of paths.sort()) result[path] = createHash('sha256').update(await readFile(resolve(projectRoot, path))).digest('hex');
  return result;
}

const add = (a, b) => a.map((value, axis) => value + b[axis]);
const subtract = (a, b) => a.map((value, axis) => value - b[axis]);
const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => Math.hypot(...a);
const electricOffsets = [[0.5, 0, 0], [0, 0.5, 0], [0, 0, 0.5]];
const magneticOffsets = [[0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]];

function fieldReconstruction(solver) {
  const g = solver.core, electric = [g.Ex, g.Ey, g.Ez];
  const magnetic = [0, 1, 2].map(axis => Float64Array.from({ length: g.rho.length }, (_, index) => g.synchronizedB(axis, index)));
  function interpolate(values, p, offset) {
    const x = p[0] - offset[0], y = p[1] - offset[1], z = p[2] - offset[2];
    const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), u = x - i, v = y - j, w = z - k;
    const index = g.index(i, j, k), sy = g.nx, sz = g.nx * g.ny;
    const lower = (values[index] * (1 - u) + values[index + 1] * u) * (1 - v) + (values[index + sy] * (1 - u) + values[index + sy + 1] * u) * v;
    const upper = (values[index + sz] * (1 - u) + values[index + sz + 1] * u) * (1 - v) + (values[index + sz + sy] * (1 - u) + values[index + sz + sy + 1] * u) * v;
    return lower * (1 - w) + upper * w;
  }
  return point => ({ E: electric.map((values, axis) => interpolate(values, point, electricOffsets[axis])), B: magnetic.map((values, axis) => interpolate(values, point, magneticOffsets[axis])) });
}

/** Coordinates and weights are in grid units. Native Yee interpolants have
 * knots at integer OR half-integer coordinates, depending on the component.
 * Split at every half integer, then use two Gauss nodes per interval. Products
 * of reconstructed E/B have degree <=2 in each coordinate within each piece.
 */
function axisQuadrature(low, high, rule) {
  const step = rule === 'exact' ? 0.5 : 1, cuts = [low];
  for (let value = (Math.floor(low / step) + 1) * step; value < high - 1e-12; value += step) cuts.push(value);
  cuts.push(high);
  const nodes = [], weights = [];
  for (let i = 1; i < cuts.length; i++) {
    const midpoint = (cuts[i - 1] + cuts[i]) / 2, half = (cuts[i] - cuts[i - 1]) / 2;
    if (half <= 0) continue;
    if (rule === 'exact') {
      nodes.push(midpoint - half / Math.sqrt(3), midpoint + half / Math.sqrt(3)); weights.push(half, half);
    } else { nodes.push(midpoint); weights.push(2 * half); }
  }
  return { nodes, weights };
}

function assignedSourceBounds(solver, api) {
  const g = solver.core, spacing = [g.dx, g.dy, g.dz], low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  for (const object of solver.scene.objects) {
    const position = solver.bodies.get(object.id)?.position ?? object.position;
    const center = position.map((value, axis) => value - solver.min[axis]);
    const w = api.smoothChargeWeights(g, center, object.sourceWidth);
    for (let axis = 0; axis < 3; axis++) {
      const values = [w.x, w.y, w.z][axis];
      for (let index = 0; index < values.length; index++) if (values[index] > 0) {
        low[axis] = Math.min(low[axis], solver.min[axis] + (index - 0.5) * spacing[axis]);
        high[axis] = Math.max(high[axis], solver.min[axis] + (index + 0.5) * spacing[axis]);
      }
    }
  }
  return { low, high, convention: 'Union of dual cells centered at all strictly positive production smoothChargeWeights assignments; no arbitrary density threshold.' };
}

function volumes(solver, options, api) {
  const spacing = [solver.core.dx, solver.core.dy, solver.core.dz], support = assignedSourceBounds(solver, api);
  return options.halfExtents.map(halfExtent => {
    const clearance = Math.min(...support.low.map(value => value + halfExtent), ...support.high.map(value => halfExtent - value));
    const reasons = [];
    if (halfExtent > 0.5 - Math.max(...spacing) + 1e-12) reasons.push('Surface lacks the required one-cell ordinary-Yee halo before the PML interface.');
    if (clearance < -1e-12) reasons.push('Surface intersects assigned-source nodal dual support; full mechanical source momentum is not enclosed.');
    const low = spacing.map((h, axis) => (-halfExtent - solver.min[axis]) / h), high = spacing.map((h, axis) => (halfExtent - solver.min[axis]) / h);
    const rules = options.quadrature === 'both' ? ['midpoint', 'exact'] : [options.quadrature];
    return { halfExtent, low, high, support, assignedSupportClearance: clearance, excluded: reasons.length > 0, exclusionReasons: reasons, quadrature: Object.fromEntries(rules.map(rule => [rule, low.map((value, axis) => axisQuadrature(value, high[axis], rule))])) };
  });
}

function mechanical(solver, api) {
  const momentum = [0, 0, 0], electricForce = [0, 0, 0], bodies = [];
  for (const object of solver.scene.objects) {
    const body = solver.bodies.get(object.id), field = solver.sampleSourceForForce(object, body.position);
    const p = api.advanceParticle(body.position, body.momentum, object.charge, object.dynamics.mass, field.E, field.B, solver.core.dt / 2).momentum;
    for (let axis = 0; axis < 3; axis++) { momentum[axis] += p[axis]; electricForce[axis] += object.charge * field.E[axis]; }
    bodies.push({ id: object.id, position: [...body.position], estimatedIntegerMomentum: p });
  }
  return { momentum, electricForce, bodies };
}

function fieldMomentum(solver, volume, rule, sample, api) {
  const q = volume.quadrature[rule], result = [0, 0, 0], dv = solver.core.dx * solver.core.dy * solver.core.dz;
  for (let k = 0; k < q[2].nodes.length; k++) for (let j = 0; j < q[1].nodes.length; j++) for (let i = 0; i < q[0].nodes.length; i++) {
    const f = sample([q[0].nodes[i], q[1].nodes[j], q[2].nodes[k]]), p = cross(f.E, f.B), weight = api.EPSILON_0 * dv * q[0].weights[i] * q[1].weights[j] * q[2].weights[k];
    for (let axis = 0; axis < 3; axis++) result[axis] += weight * p[axis];
  }
  return result;
}

function surfaceTraction(solver, volume, rule, sample, api) {
  const q = volume.quadrature[rule], spacing = [solver.core.dx, solver.core.dy, solver.core.dz], traction = [0, 0, 0];
  for (let normal = 0; normal < 3; normal++) {
    const b = (normal + 1) % 3, d = (normal + 2) % 3;
    for (const side of [-1, 1]) for (let j = 0; j < q[b].nodes.length; j++) for (let k = 0; k < q[d].nodes.length; k++) {
      const point = [0, 0, 0]; point[normal] = side < 0 ? volume.low[normal] : volume.high[normal]; point[b] = q[b].nodes[j]; point[d] = q[d].nodes[k];
      const { E, B } = sample(point), halfTrace = 0.5 * (api.EPSILON_0 * dot(E, E) + dot(B, B) / api.MU_0), area = spacing[b] * spacing[d] * q[b].weights[j] * q[d].weights[k];
      for (let axis = 0; axis < 3; axis++) traction[axis] += side * area * (api.EPSILON_0 * E[axis] * E[normal] + B[axis] * B[normal] / api.MU_0 - (axis === normal ? halfTrace : 0));
    }
  }
  return traction;
}

function selectedCases(options) {
  const variants = options.variant === 'all' ? ['asymmetric', 'translated'] : [options.variant], result = [];
  for (const variant of variants) {
    const entries = new Map();
    const addCase = (resolution, timeFactor, study) => {
      const key = `${resolution}/${timeFactor}`;
      if (!entries.has(key)) entries.set(key, { variant, resolution, timeFactor, studies: [] });
      entries.get(key).studies.push(study);
    };
    if (options.study !== 'time') for (const resolution of options.grids) addCase(resolution, 1, 'mesh');
    if (options.study !== 'mesh') for (const factor of options.timeFactors) addCase(options.timeGrid, factor, 'time');
    result.push(...entries.values());
  }
  return result;
}

function auditCase(selected, options, api) {
  const started = performance.now(), duration = 3e-10, charge = 1e-9, mass = 1e-23, separation = 0.4, shift = selected.variant === 'translated' ? options.shift : 0;
  const objects = [-1, 1].map((side, index) => {
    const object = api.makeCharge([side * separation / 2 + shift, 0, 0], side < 0 ? charge : -charge * (selected.variant === 'asymmetric' ? 0.8 : 1));
    object.id = index === 0 ? 'source-left' : 'source-right';
    Object.assign(object, { sourceProfile: 'smooth', sourceWidth: options.width, dynamics: { mode: 'forceDriven', mass: mass * (index === 1 && selected.variant === 'asymmetric' ? 1.2 : 1), inertia: [1, 1, 1], velocity: [0, 0, 0], angularVelocity: [0, 0, 0] } });
    return object;
  });
  const steps = Math.ceil(duration * api.LIGHT_SPEED * Math.sqrt(3) * selected.resolution / 0.7) * selected.timeFactor;
  const scene = api.makeScene({ name: 'Actual smooth-source momentum and stress audit', objects });
  Object.assign(scene.simulation, { resolution: selected.resolution, pmlCells: 4, cfl: duration / steps * api.LIGHT_SPEED * Math.sqrt(3) * selected.resolution, useApproximation: false, staticBoundary: 'open', externalField: [0, 0, 0], externalB: [0, 0, 0], boundary: { x: 'pml', y: 'pml', z: 'pml' } });
  const solver = new api.MaxwellSceneSolver(scene), boxes = volumes(solver, options, api), valid = boxes.filter(box => !box.excluded);
  const initialMechanical = mechanical(solver, api), initialSample = fieldReconstruction(solver);
  const captured = valid.map(box => ({ box, initialP: Object.fromEntries(Object.keys(box.quadrature).map(rule => [rule, fieldMomentum(solver, box, rule, initialSample, api)])), surfaces: Object.fromEntries(Object.keys(box.quadrature).map(rule => { const initial = surfaceTraction(solver, box, rule, initialSample, api); return [rule, { initial, previous: initial, impulse: [0, 0, 0] }]; })) }));
  if (valid.length) for (let step = 0; step < steps; step++) {
    solver.step(); const sample = fieldReconstruction(solver);
    const support = assignedSourceBounds(solver, api);
    for (const box of valid) {
      for (let axis = 0; axis < 3; axis++) {
        box.support.low[axis] = Math.min(box.support.low[axis], support.low[axis]);
        box.support.high[axis] = Math.max(box.support.high[axis], support.high[axis]);
      }
      box.assignedSupportClearance = Math.min(...box.support.low.map(value => value + box.halfExtent), ...box.support.high.map(value => box.halfExtent - value));
      if (box.assignedSupportClearance < -1e-12 && !box.excluded) {
        box.excluded = true;
        box.exclusionReasons.push('Transported source assignment left the enclosed dual support during the run.');
      }
    }
    for (const state of captured) for (const [rule, ledger] of Object.entries(state.surfaces)) {
      const traction = surfaceTraction(solver, state.box, rule, sample, api);
      for (let axis = 0; axis < 3; axis++) ledger.impulse[axis] += solver.core.dt * (ledger.previous[axis] + traction[axis]) / 2;
      ledger.previous = traction;
    }
  }
  const finalMechanical = mechanical(solver, api), finalSample = fieldReconstruction(solver), impulseScale = charge ** 2 * duration / (4 * Math.PI * api.EPSILON_0 * separation ** 2), measurements = [];
  for (const state of captured.filter(state => !state.box.excluded)) for (const volumeRule of Object.keys(state.box.quadrature)) {
    const finalP = fieldMomentum(solver, state.box, volumeRule, finalSample, api), deltaField = subtract(finalP, state.initialP[volumeRule]), deltaMechanical = subtract(finalMechanical.momentum, initialMechanical.momentum), deltaTotal = add(deltaMechanical, deltaField);
    for (const [surfaceRule, ledger] of Object.entries(state.surfaces)) {
      const residual = subtract(deltaTotal, ledger.impulse), initialStaticStressImpulse = ledger.initial.map(value => duration * value);
      measurements.push({ halfExtent: state.box.halfExtent, volumeQuadrature: volumeRule, surfaceQuadrature: surfaceRule, initialFieldMomentum: state.initialP[volumeRule], finalFieldMomentum: finalP, deltaFieldMomentum: deltaField, deltaMechanicalMomentum: deltaMechanical, rawTotalMomentumChange: deltaTotal, initialSurfaceTraction: ledger.initial, finalSurfaceTraction: ledger.previous, initialStaticStressImpulse, integratedStressImpulse: ledger.impulse, stressChangeImpulse: subtract(ledger.impulse, initialStaticStressImpulse), residual, residualNorm: norm(residual), relativeResidual: norm(residual) / impulseScale });
    }
  }
  for (const result of measurements) if (![...result.residual, result.residualNorm, result.relativeResidual].every(Number.isFinite)) throw new Error('Nonfinite momentum measurement.');
  // Quadrature arrays are reproducible from these bounds, and need not inflate JSON.
  const boxMetadata = boxes.map(({ quadrature: _quadrature, ...box }) => box);
  return { ...selected, parameters: { duration, width: options.width, separation, shift, charges: objects.map(o => o.charge), masses: objects.map(o => o.dynamics.mass), initialPositions: objects.map(o => o.position) }, fieldSteps: solver.steps, plannedSteps: steps, dt: solver.core.dt, elapsedMs: performance.now() - started, impulseScale, boxes: boxMetadata, initialMechanical, finalMechanical, measurements };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(help); return; }
  const beforeHashes = await sourceHashes(), provenance = { startedAt: new Date().toISOString(), node: process.version, platform: process.platform, arguments: process.argv.slice(2), gitHead: git(['rev-parse', 'HEAD']), gitBranch: git(['branch', '--show-current']), gitStatus: git(['status', '--short']), sourceSha256: beforeHashes };
  const server = await createServer({ root: projectRoot, configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom', logLevel: 'error' }), results = [];
  try {
    const modules = await Promise.all(['/src/engine/maxwell/sceneSolver.ts', '/src/scene/defaults.ts', '/src/engine/maxwell/dynamics.ts', '/src/engine/maxwell/yee.ts', '/src/engine/maxwell/smoothCharge.ts'].map(path => server.ssrLoadModule(path))), api = Object.assign({}, ...modules);
    for (const selected of selectedCases(options)) {
      const result = auditCase(selected, options, api); results.push(result);
      for (const box of result.boxes.filter(box => box.excluded)) console.log(`${selected.variant} N=${selected.resolution} L/2=${box.halfExtent}: EXCLUDED: ${box.exclusionReasons.join(' ')}`);
      for (const m of result.measurements) console.log(`${selected.variant} N=${selected.resolution} dt/${selected.timeFactor} L/2=${m.halfExtent} P:${m.volumeQuadrature}/T:${m.surfaceQuadrature}: |deltaP-stress|=${m.residualNorm.toExponential(5)} kg m/s (${(100 * m.relativeResidual).toFixed(5)}% of fixed impulse scale)`);
    }
  } finally { await server.close(); }
  const afterHashes = await sourceHashes(); provenance.finishedAt = new Date().toISOString(); provenance.gitHeadAfter = git(['rev-parse', 'HEAD']);
  provenance.changedSourceFilesDuringRun = [...new Set([...Object.keys(beforeHashes), ...Object.keys(afterHashes)])].filter(path => beforeHashes[path] !== afterHashes[path]);
  provenance.sourceChangedDuringRun = provenance.changedSourceFilesDuringRun.length > 0;
  if (provenance.changedSourceFilesDuringRun.length) provenance.sourceSha256After = afterHashes;
  const report = { schemaVersion: 1, provenance, options, convention: { stress: 'Tij=epsilon0(EiEj-deltaij E²/2)+(BiBj-deltaij B²/2)/mu0', sign: 'd(Pmatter+Pfield)/dt=integral T dot outward_normal dA; residual=deltaP-integratedStressImpulse', fieldMomentum: 'epsilon0 integral E cross synchronized B dV', exactQuadrature: 'Split at every native integer/half-integer reconstruction knot; tensor two-point Gauss on each piece integrates reconstructed quadratic products exactly.', timeQuadrature: 'Trapezoidal integer-time stress, including the entire initial Coulomb stress.', mechanical: 'Local source-shape-matched Boris half kick estimates integer momentum from stored half-step momentum.', normalization: 'Fixed q0² T/(4 pi epsilon0 d²), q0=1nC,d=.4m,T=.3ns, independent of measured cancellation.' }, acceptance: { fullM6Accepted: false, exactDiscreteMomentumInvariant: false, statement: 'Physical reconstructed-field momentum budget only. Grid/time/box/source-shape errors, torque and passive-body validation remain outstanding.' }, results };
  await mkdir(dirname(options.json), { recursive: true }); await writeFile(options.json, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Audit JSON: ${relative(projectRoot, options.json)}\nExit 0 confirms audit completion, not conservation acceptance.`);
}

main().catch(error => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
