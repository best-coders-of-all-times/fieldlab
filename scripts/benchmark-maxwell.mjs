import { createServer } from 'vite';
import { performance } from 'node:perf_hooks';
import { cpus, platform, release, arch, totalmem } from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const help = `Usage: npm run bench:maxwell -- [--include64] [--steps 3] [--json PATH] [--report PATH]

Runs the actual Float64 MaxwellSceneSolver at resolutions 16, 32 and 48,
with four PML cells on each side. --include64 adds resolution 64.
--steps accepts 1..20; default 3. JSON is always printed to stdout.
Optional output paths are relative to the current working directory.
This CPU benchmark runs in Node, outside the browser worker and renderer.`;

function parseArgs(args) {
  const options = { steps: 3, include64: false, json: undefined, report: undefined };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--include64') options.include64 = true;
    else if (arg === '--steps' || arg === '--json' || arg === '--report') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}.`);
      if (arg === '--steps') {
        options.steps = Number(value);
        if (!Number.isInteger(options.steps) || options.steps < 1 || options.steps > 20) throw new Error('--steps must be an integer between 1 and 20.');
      } else options[arg.slice(2)] = resolve(value);
    } else throw new Error(`Unknown argument: ${arg}. Use --help for usage.`);
  }
  if (options.json && options.json === options.report) throw new Error('JSON and Markdown report paths must differ.');
  return options;
}

function timed(action) {
  const start = performance.now();
  const value = action();
  return { value, ms: performance.now() - start };
}

// Count unique ArrayBuffers reachable from the live solver, including snapshots,
// CPML memories and body-owned charge. This is retained buffer storage, not peak
// process memory; JS objects, transient allocations and runtime overhead differ.
function retainedBufferBytes(root) {
  const visited = new WeakSet(), buffers = new Set();
  const visit = value => {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (ArrayBuffer.isView(value)) { buffers.add(value.buffer); return; }
    if (value instanceof ArrayBuffer) { buffers.add(value); return; }
    if (value instanceof Map) { for (const [key, item] of value) { visit(key); visit(item); } return; }
    if (value instanceof Set) { for (const item of value) visit(item); return; }
    for (const item of Object.values(value)) visit(item);
  };
  visit(root);
  return [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0);
}

async function writeOutput(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, 'utf8');
}

function markdown(report) {
  const n = value => value.toFixed(2);
  const mib = value => (value / 1048576).toFixed(2);
  const quote = String.fromCharCode(96);
  return `# Measured Maxwell CPU performance

Measured at ${report.generatedAt} with ${quote}npm run bench:maxwell -- ${report.commandArguments.join(' ')}${quote}.

Environment: Node ${report.environment.node}, ${report.environment.platform} ${report.environment.release} (${report.environment.arch}); ${report.environment.cpuModel}; ${report.environment.logicalCpus} logical CPUs; ${mib(report.environment.systemMemoryBytes / 1024)} GiB system RAM. This is one sequential run, with ${report.settings.steps} measured field steps per grid and no explicit warm-up or forced garbage collection. The JSON records SHA-256 hashes of the benchmark and solver source files from the measured working tree.

The script loads the actual ${quote}MaxwellSceneSolver${quote} through Vite ${quote}createServer().ssrLoadModule()${quote}, using the existing project dependencies. Vite startup and module transformation are excluded from preparation time. Preparation includes grid allocation, source/material preparation, electrostatic initialization and the initial rewind snapshot. Each row constructs a fresh moving, isolated, finite-conductivity capacitor: a 1 m cubic domain, two 0.08 × 0.5 × 0.5 m plates at x = ±0.125 m, initial potentials ±3 V, conductivity 0.01 S/m, and shared sinusoidal y motion of amplitude 0.02 m at 10 MHz. CFL is 0.9 and each boundary has four PML cells. This deliberately fast motion is an authored benchmark parameter, not a rescaling of any saved scene.

| Requested resolution | Padded grid | Δt (s) | Preparation (ms) | Step (ms/step) | Retained buffers (MiB) | Solver budget estimate (MiB) |
| --- | --- | --- | --- | --- | --- | --- |
${report.results.map(r => `| ${r.resolution} | ${r.grid.join(' × ')} | ${r.dt.toExponential(4)} | ${n(r.preparationMs)} | ${n(r.steppingMsPerStep)} | ${mib(r.retainedArrayBufferBytes)} | ${mib(r.solverEstimatedBytes)} |`).join('\n')}

Sampling is timed once per operation after stepping, without changing the field clock: one 64 × 64 central xy |E| slice, three probes, a 9 × 9 × 9 E-arrow lattice, 16 E field-line seeds, and diagnostics. Lines have variable output lengths. These display settings are fixed across grids; they are not the complete browser frame cost.

| Resolution | Slice (ms) | Three probes (ms) | Arrows (ms) | Lines (ms) | Diagnostics (ms) | Explicit transfer bytes | Line buffer bytes |
| --- | --- | --- | --- | --- | --- | --- | --- |
${report.results.map(r => `| ${r.resolution} | ${n(r.samplingMs.slice)} | ${n(r.samplingMs.probes)} | ${n(r.samplingMs.arrows)} | ${n(r.samplingMs.lines)} | ${n(r.samplingMs.diagnostics)} | ${r.framePayload.explicitTransferBytes} | ${r.framePayload.lineArrayBytes} |`).join('\n')}

Explicit transfer bytes count the slice and lattice ArrayBuffers listed in the current worker transfer list. Line buffer bytes count the typed arrays currently sent through structured clone, separately. Probe JSON byte counts in the JSON artifact are UTF-8 serialization sizes for comparison, not measured worker wire sizes. Metadata and JavaScript object overhead are excluded from the table. Retained buffers are unique reachable ArrayBuffers in the solver after stepping; they exclude temporary allocations, JavaScript heap objects, browser rendering storage and process overhead. The solver's conservative admission estimate is reported separately from that count; the current allocation guard is 768 MiB.

Node executes this benchmark on the calling thread. The browser runs the solver in a dedicated worker, with additional message scheduling, structured cloning, transferred-buffer handling, Three.js rendering and UI work. This benchmark does not measure those costs or certify UI responsiveness. JIT compilation, garbage collection, CPU load, power management and browser engine differences can change results; use repeated browser and worker measurements for capacity planning. The short run is a smoke benchmark, not a statistically stable throughput estimate or a peak-memory measurement.

Physical time is independent of animation pacing. The measured steps advance only ${report.results.map(r => `${r.resolution}: ${r.physicalTime.toExponential(3)} s`).join('; ')}. A one-second mechanical trajectory still requires roughly 1/Δt field steps. These timings do not establish real-time performance or validate moving interfaces, material models, convergence or conservation.

Reproduce with ${quote}npm run bench:maxwell -- --json artifacts/maxwell-benchmark.json --report docs/maxwell-performance.md${quote}. Add ${quote}--include64${quote} for the larger grid, or ${quote}--steps 5${quote} for a slightly longer run. The JSON artifact includes operation times, field metadata, charge/energy diagnostics, payload counts, retained storage and environment details.
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(help); return; }
  const server = await createServer({ root: projectRoot, configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const [{ MaxwellSceneSolver }, { makeScene, makeConductor, makeProbe }] = await Promise.all([
      server.ssrLoadModule('/src/engine/maxwell/sceneSolver.ts'),
      server.ssrLoadModule('/src/scene/defaults.ts'),
    ]);
    const settings = { steps: options.steps, pmlCells: 4, cfl: 0.9, sliceResolution: 64, arrowDensity: 9, lineSeeds: 16 };
    const results = [];
    for (const resolution of [16, 32, 48, ...(options.include64 ? [64] : [])]) {
      console.error(`Benchmarking resolution ${resolution}: preparation, ${options.steps} steps, display sampling...`);
      const a = makeConductor([-0.125, 0, 0], 'box', [0.08, 0.5, 0.5]);
      const b = makeConductor([0.125, 0, 0], 'box', [0.08, 0.5, 0.5]);
      a.potential = 3; b.potential = -3;
      a.motion = b.motion = { kind: 'oscillate', axis: [0, 1, 0], amplitude: 0.02, frequency: 1e7 };
      const positions = [[0, 0, 0], [0, 0.2, 0], [0.2, 0.1, 0.1]];
      const scene = makeScene({ name: 'Measured moving isolated capacitor', objects: [a, b, ...positions.map(p => makeProbe(p))] });
      Object.assign(scene.simulation, { resolution, pmlCells: settings.pmlCells, cfl: settings.cfl, useApproximation: false, maxwellConductorModel: 'isolated' });
      const preparation = timed(() => new MaxwellSceneSolver(scene));
      const solver = preparation.value;
      const stepping = timed(() => solver.step(options.steps));
      const slice = timed(() => solver.sampleSlice('z', 0, 'Emag', settings.sliceResolution));
      const probes = timed(() => positions.map(position => ({ position, sample: solver.sample(position) })));
      const arrows = timed(() => solver.sampleLattice(settings.arrowDensity, 'E'));
      const lines = timed(() => solver.fieldLines('E', settings.lineSeeds));
      const diagnostics = timed(() => solver.diagnostics());
      const explicitTransferBytes = slice.value.data.byteLength + arrows.value.positions.byteLength + arrows.value.vectors.byteLength + arrows.value.magnitudes.byteLength;
      const lineArrayBytes = lines.value.reduce((sum, line) => sum + line.points.byteLength + line.magnitudes.byteLength, 0);
      results.push({ resolution, grid: [solver.meta.nx, solver.meta.ny, solver.meta.nz], cells: solver.core.rho.length,
        dt: solver.meta.dt, physicalTime: solver.time, fieldSteps: solver.steps, preparationMs: preparation.ms,
        steppingMs: stepping.ms, steppingMsPerStep: stepping.ms / options.steps,
        samplingMs: { slice: slice.ms, probes: probes.ms, arrows: arrows.ms, lines: lines.ms, diagnostics: diagnostics.ms },
        retainedArrayBufferBytes: retainedBufferBytes(solver), solverEstimatedBytes: diagnostics.value.estimatedBytes, memoryBudgetBytes: 768 * 1048576,
        processMemory: process.memoryUsage(), framePayload: { explicitTransferBytes, lineArrayBytes, totalTypedArrayBytes: explicitTransferBytes + lineArrayBytes,
          probeJsonUtf8Bytes: Buffer.byteLength(JSON.stringify(probes.value)), actualLineCount: lines.value.length,
          linePoints: lines.value.reduce((sum, line) => sum + line.points.length / 3, 0) }, diagnostics: diagnostics.value });
      console.error(`Resolution ${resolution}: ${preparation.ms.toFixed(1)} ms preparation, ${(stepping.ms / options.steps).toFixed(1)} ms/step.`);
    }
    const sourceSha256 = Object.fromEntries(await Promise.all([
      'scripts/benchmark-maxwell.mjs', 'src/engine/maxwell/sceneSolver.ts', 'src/engine/maxwell/yee.ts',
      'src/engine/maxwell/sampling.ts', 'src/engine/maxwell/cpml.ts', 'src/engine/maxwell/initialization.ts',
      'src/engine/maxwell/deposition.ts', 'src/engine/maxwell/dynamics.ts', 'src/engine/maxwell/rigid.ts',
    ].map(async path => [path, createHash('sha256').update(await readFile(resolve(projectRoot, path))).digest('hex')])));
    const report = { generatedAt: new Date().toISOString(), commandArguments: process.argv.slice(2), sourceSha256,
      environment: { node: process.version, platform: platform(), release: release(), arch: arch(), cpuModel: cpus()[0]?.model ?? 'unknown', logicalCpus: cpus().length, systemMemoryBytes: totalmem() },
      model: 'moving isolated finite-conductivity capacitor', settings, results };
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (options.json) await writeOutput(options.json, json);
    if (options.report) await writeOutput(options.report, markdown(report));
    console.log(json);
  } finally { await server.close(); }
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
