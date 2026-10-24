import {
  preview
} from 'vite';
import {
  chromium
} from '@playwright/test';
import {
  readFile,
  readdir,
  mkdir,
  writeFile
} from 'node:fs/promises';
import {
  createHash
} from 'node:crypto';
import {
  resolve,
  relative,
  dirname,
  sep,
  isAbsolute
} from 'node:path';
import {
  fileURLToPath
} from 'node:url';
import {
  cpus,
  platform,
  release,
  totalmem
} from 'node:os';
import {
  execFileSync
} from 'node:child_process';
const root = fileURLToPath(new URL('..', import.meta.url));
const help = `Usage: node scripts/benchmark-maxwell-browser.mjs [--steps 3] [--grids 16,32,48] [--json artifacts/maxwell-browser-benchmark.json]
Uses the existing production dist with a local Vite preview and headless Edge on Windows,
Chromium elsewhere. Fresh context per grid; actual worker and renderer. No dependencies added.
--steps: integer 1..20. --grids: unique subset of 16,32,48,64 (64 optional).
--json: path under repository artifacts only. Each grid has a 180-second timeout.
Build first with npm run build. Results are bounded smoke observations, not peak memory or pure rendering/transfer timings.`;
function options(args) {
  const o = {
    steps: 3,
    grids: [16, 32, 48],
    json: resolve(root, 'artifacts/maxwell-browser-benchmark.json')
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') return {
      help: true
    };
    const key = args[i],
    value = args[++i];
    if (!['--steps', '--grids', '--json'].includes(key)) throw Error(`Unknown argument: ${key}`);
    if (!value || value.startsWith('--')) throw Error(`Missing value: ${key}`);
    if (key === '--steps') {
      o.steps = Number(value);
      if (!Number.isInteger(o.steps) || o.steps < 1 || o.steps > 20) throw Error('--steps must be 1..20');
    } if (key === '--grids') {
      o.grids = value.split(',').map(Number);
      if (!o.grids.length || o.grids.some(n => ![16, 32, 48, 64].includes(n)) || new Set(o.grids).size !== o.grids.length) throw Error('--grids must be a unique subset of 16,32,48,64');
    } if (key === '--json') o.json = resolve(root, value);
  } const rel = relative(resolve(root, 'artifacts'), o.json);
  if (!rel || isAbsolute(rel) || rel.startsWith(`..${sep}`) || rel === '..' || resolve(o.json) === resolve(root, 'artifacts') || !o.json.endsWith('.json')) throw Error('--json must name a .json file under artifacts');
  return o;
} function scene(resolution, steps) {
  const base = (kind, id, position) => ({
    kind,
    id,
    name: id,
    position,
    rotation: [0, 0, 0],
    visible: true
  });
  return {
    version: 1,
    id: 'browser-benchmark',
    name: 'Measured moving isolated capacitor',
    mode: 'fields',
    tags: [],
    domain: {
      center: [0, 0, 0],
      size: [1, 1, 1]
    },
    objects: [-1, 1].map((sign, i) => ({
      ...base('conductor', `plate-${i}`, [sign*0.125, 0, 0]),
      shape: 'box',
      size: [0.08, 0.5, 0.5],
      potential: -sign*3,
      floating: false,
      netCharge: 0,
      conductivity: 0.01,
      motion: {
        kind: 'oscillate',
        axis: [0, 1, 0],
        amplitude: 0.02,
        frequency: 1e7
      }
    })).concat([[0, 0, 0], [0, 0.2, 0], [0.2, 0.1, 0.1]].map((p, i) => ({
      ...base('probe', `probe-${i}`, p),
      quantity: 'E'
    }))),
    simulation: {
      useApproximation: false,
      resolution,
      staticBoundary: 'open',
      externalField: [0, 0, 0],
      externalB: [0, 0, 0],
      boundary: {
        x:'pml',
        y:'pml',
        z:'pml'
      },
      pmlCells: 4,
      cfl: 0.9,
      stepsPerFrame: 1,
      timeScale: 1,
      maxwellConductorModel: 'isolated',
      targetTime: steps*0.9/(299792458*Math.sqrt(3*resolution**2))
    },
    display: {
      fieldLines:'E',
      lineCount:16,
      arrows:'E',
      arrowDensity:9,
      slices:{
        xy:true,
        xz:false,
        yz:false
      },
      slicePositions:{
        x:0,
        y:0,
        z:0
      },
      sliceQuantity:'Emag',
      sliceOpacity:0.88,
      sliceResolution:64,
      showGrid:true,
      showAxes:true,
      showDomain:true,
      showBoundCurrent:false,
      showProbeLabels:true,
      conductorOpacity:1,
      colormap:'electric',
      logScale:false,
      autoRange:true,
      range:null,
      vectorScale:1
    },
    camera: {
      position:[1.55, 1.15, 1.55],
      target:[0, 0, 0],
      orthographic:false
    }
  };
} async function hashes(directory) {
  const entries = await readdir(resolve(root, directory), {
    withFileTypes:true
  });
  const pairs = await Promise.all(entries.map(async e => e.isDirectory() ? Object.entries(await hashes(`${directory}/${e.name}`)) : [[`${directory}/${e.name}`, createHash('sha256').update(await readFile(resolve(root, directory, e.name))).digest('hex')]]));
  return Object.fromEntries(pairs.flat());
} async function main() {
  const o = options(process.argv.slice(2));
  if (o.help) {
    console.log(help);
    return;
  } const sourceSha256 = {
    ...await hashes('src'),
    'scripts/benchmark-maxwell-browser.mjs': createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex')
  },
  buildSha256 = await hashes('dist');
  let server,
  browser;
  try {
    server = await preview({
      root,
      configFile:false,
      logLevel:'error',
      preview:{
        host:'127.0.0.1',
        port:0,
        strictPort:true
      }
    });
    const address = server.httpServer.address(),
    url = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({
      headless:true,
      ...(process.platform === 'win32' ? {
        channel:'msedge'
      } : {
      })
    });
    const results = [];
    for (const resolution of o.grids) {
      console.error(`Production browser: grid ${resolution}, ${o.steps} physical steps`);
      const context = await browser.newContext({
        viewport:{
          width:1600,
          height:1000
        }
      });
      try {
        await context.addInitScript(({
          authored
        }) => {
          localStorage.setItem('fieldlab.scene.v1', JSON.stringify(authored));
          const obs = window.__maxwellBench = {
            requests:[],
            ready:[],
            frames:[],
            errors:[],
            raf:[],
            longTasks:[],
            longTaskSupported:false
          };
          let previous;
          function raf(t) {
            if (previous !== undefined && obs.raf.length < 20000) obs.raf.push({
              at:t,
              interval:t-previous
            });
            previous=t;
            requestAnimationFrame(raf);
          } requestAnimationFrame(raf);
          try {
            obs.longTaskSupported = PerformanceObserver.supportedEntryTypes.includes('longtask');
            if (obs.longTaskSupported) new PerformanceObserver(list => {
              for (const e of list.getEntries()) if(obs.longTasks.length < 20000) obs.longTasks.push({
                at:e.startTime,
                duration:e.duration
              });
            }).observe({
              type:'longtask',
              buffered:true
            });
          } catch {
          } const NativeWorker = window.Worker;
          window.Worker = class extends NativeWorker {
            constructor(...args) {
              super(...args);
              const workerUrl = String(args[0]);
              this.addEventListener('message', ({
                data:m
              }) => {
                const at = performance.now();
                if (m.type === 'error') obs.errors.push({
                  at,
                  workerUrl,
                  ...m
                });
                if (m.type === 'ready') obs.ready.push({
                  at,
                  workerUrl,
                  generation:m.generation,
                  meta:m.meta
                });
                if (m.type === 'frame') {
                  const buffers = new Set();
                  let bytes = 0;
                  const visit = v => {
                    if (!v || typeof v !== 'object') return;
                    if (ArrayBuffer.isView(v)) {
                      if(!buffers.has(v.buffer)) {
                        buffers.add(v.buffer);
                        bytes += v.buffer.byteLength;
                      } return;
                    } for (const x of Object.values(v)) visit(x);
                  };
                  visit(m);
                  obs.frames.push({
                    at,
                    workerUrl,
                    generation:m.generation,
                    time:m.time,
                    steps:m.steps,
                    dt:m.meta.dt,
                    targetReached:m.targetReached,
                    diagnostics:m.diagnostics,
                    typedArrayBytes:bytes,
                    slices:m.slices.length,
                    lineCount:m.lines?.lines.length,
                    probeCount:m.probes.length
                  });
                }
              });
            } postMessage(m, ...rest) {
              if (obs.requests.length < 1000) obs.requests.push({
                at:performance.now(),
                type:m.type,
                generation:m.generation
              });
              return super.postMessage(m, ...rest);
            }
          };
        }, {
          authored:scene(resolution, o.steps)
        });
        const page = await context.newPage();
        const pageErrors = [];
        let rejectPageFailure;
        const pageFailure = new Promise((_, reject) => { rejectPageFailure = reject; });
        page.on('pageerror', error => {
          pageErrors.push(error.stack || error.message);
          rejectPageFailure(new Error(`Uncaught page error: ${error.message}`));
        });
        await Promise.race([
          (async () => {
            await page.goto(url, { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(
              () => window.__maxwellBench.errors.length ||
                window.__maxwellBench.frames.some(frame => frame.targetReached),
              undefined,
              { timeout: 180000 },
            );
            await page.waitForTimeout(150);
          })(),
          pageFailure,
        ]);
        if (pageErrors.length) throw new Error(pageErrors.join('\n'));
        const observation = await page.evaluate(() => window.__maxwellBench);
        if (observation.errors.length) throw Error(JSON.stringify(observation.errors));
        const final = observation.frames.find(f => f.targetReached),
        initial = observation.frames.find(f => f.generation === final.generation && f.steps === 0);
        if (!initial || final.steps !== o.steps || Math.abs(final.time-final.steps*final.dt) > final.dt*1e-10) throw Error('Physical-step/time/generation invariant failed');
        const init = observation.requests.find(r => r.type === 'init' && r.generation === final.generation),
        ready = observation.ready.find(r => r.generation === final.generation);
        results.push({
          resolution,
          authoredScene:scene(resolution, o.steps),
          initialReadyMs:ready.at-init.at,
          initialFrameMs:initial.at-init.at,
          initialToTargetFrameMs:final.at-initial.at,
          final,
          observation
        });
      } finally {
        await context.close();
      }
    } const report = {
      generatedAt:new Date().toISOString(),
      command:['node', 'scripts/benchmark-maxwell-browser.mjs', ...process.argv.slice(2)],
      gitHead:execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd:root,
        encoding:'utf8'
      }).trim(),
      sourceSha256,
      buildSha256,
      sourceSha256After:{
        ...await hashes('src'),
        'scripts/benchmark-maxwell-browser.mjs': createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex')
      },
      buildSha256After:await hashes('dist'),
      environment:{
        node:process.version,
        platform:platform(),
        release:release(),
        cpu:cpus()[0]?.model,
        logicalCpus:cpus().length,
        totalMemoryBytes:totalmem(),
        browser:browser.version(),
        headless:true,
        viewport:{
          width:1600,
          height:1000
        }
      },
      settings:{
        steps:o.steps,
        grids:o.grids
      },
      results
    };
    await mkdir(dirname(o.json), {
      recursive:true
    });
    await writeFile(o.json, JSON.stringify(report, null, 2)+'\n');
    console.log(`Saved ${relative(root,o.json)}`);
  } finally {
    if(browser) await browser.close();
    if(server) await new Promise((res, rej) => server.httpServer.close(e => e ? rej(e) : res()));
  }
} main().catch(e => {
  console.error(e);
  process.exitCode=1;
});
