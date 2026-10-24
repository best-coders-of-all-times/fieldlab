# Production-browser Maxwell smoke measurement

Historical measurement at revision `07a8900`, taken 2026-10-25 with the actual production page, dedicated FDTD worker and Three.js viewport. This closes part of the browser evidence gap in M7; it does not establish performance acceptance or complete M7.

Reproduce after `npm run build`:

```powershell
node scripts/benchmark-maxwell-browser.mjs --steps 3 --grids 16,32,48 --json artifacts/maxwell-browser-benchmark.json
```

The saved JSON records the exact command, authored scene, all reduced worker observations, environment, and SHA-256 manifests of every source file, the benchmark script and every built file before and after the run. Both manifests were unchanged during measurement. Git HEAD was `07a8900643ec73440c9d81ad16e12f351bdf9feb`. The pre-existing successful production build was provided by the coordinating run at that revision; the benchmark itself does not rebuild or prove a source-to-build relationship from hashes alone. The actual loaded worker was `assets/fdtd.worker-CFaY3m6i.js`, SHA-256 `6625ad8b18b8b9f8f29ef16019b9aa9cdb2980f1e0520341312c8d64169a7328`.

Environment: Windows 10.0.26200, Intel Core Ultra 9 275HX, 24 logical CPUs, 33,752,997,888 bytes system RAM; Node v24.19.0; headless Microsoft Edge 156.0.4314.42; 1600 × 1000 viewport. Rows ran serially after the separate physics audit released its CPU timing window. There was one run per grid, no warm-up, no forced garbage collection, and a fresh browser context per row (the browser process and HTTP server were shared).

The authored scene matches the Node benchmark capacitor: 1 m cube, two 0.08 × 0.5 × 0.5 m finite-conductivity plates at x = ±0.125 m, initial potentials ±3 V, conductivity 0.01 S/m, isolated conductor model, sinusoidal y displacement of amplitude 0.02 m at 10 MHz, CFL 0.9 and four PML cells on every side. Fixed requested display settings are one central 64 × 64 xy |E| slice, three visible probes, E arrows on a 9³ lattice and 16 E field lines. The localStorage schema follows `makeScene`/conductor/probe defaults and `restoreScene` preserves these authored settings. Field-line output size can vary with the fields. The worker frames confirmed one slice, three probes and 16 lines at the final target.

The page starts playing by default. Its authored physical-time target is three CFL steps, with one step per worker batch, so no pause race or extra unbounded startup steps are needed. Every row reached exactly three steps in the same generation as its zero-step frame, with observed physical time equal to steps × observed dt within the script's tolerance. No source frequency, light speed, integrator or physical time was adjusted for measurement.

| Resolution | Padded grid | dt (s) | Physical time (s) | Init request to ready (ms) | Init request to first frame (ms) | Zero-step to target frame (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| 16 | 25 x 25 x 25 | 1.08328118e-10 | 3.24984353e-10 | 157.4 | 247.9 | 208.2 |
| 32 | 41 x 41 x 41 | 5.41640588e-11 | 1.62492176e-10 | 784.1 | 870.9 | 394.6 |
| 48 | 57 x 57 x 57 | 3.61093725e-11 | 1.08328118e-10 | 4128.0 | 4368.0 | 1309.1 |

Readiness is a main-thread observation from posting init to receiving ready, including worker scheduling, construction and messaging. Zero-step-to-target time includes stepping, sampling, messaging and scheduling; it is not pure stepping or transfer time. The final frame's worker diagnostics provide more narrowly scoped measurements:

| Resolution | Final worker samplingMs | Cumulative worker steps/s | Final payload typed-array bytes |
| --- | --- | --- | --- |
| 16 | 51.6 | 76.73 | 113052 |
| 32 | 67.4 | 16.44 | 113020 |
| 48 | 152.1 | 4.75 | 113148 |

`samplingMs` measures the worker's complete frame construction, including slices, lattice, probes, diagnostics, transforms and lines. `stepsPerSecond` is the solver's cumulative stepping diagnostic across these three steps, excluding preparation and sampling. Payload bytes count unique ArrayBuffers backing received typed arrays, excluding metadata, JavaScript objects, GPU allocations and structured-clone overhead. They are not memory usage or measured transfer duration. The observer retains reduced metadata and diagnostics, never the large frame arrays.

Animation callbacks and Long Tasks were observed from document initialization through 150 ms after target receipt, including page startup and preparation. These observations cover different durations per row and are not comparable fixed-duration throughput samples.

| Resolution | rAF intervals | Median interval (ms) | Maximum interval (ms) | Long tasks | Sum / maximum long-task duration (ms) |
| --- | --- | --- | --- | --- | --- |
| 16 | 24 | 16.7 | 266.7 | 2 | 188 / 109 |
| 32 | 101 | 16.7 | 100.0 | 2 | 119 / 69 |
| 48 | 366 | 16.7 | 100.0 | 2 | 129 / 74 |

Long Tasks were supported by this browser. A rAF interval measures callback pacing, not pure rendering cost or GPU completion; it does not prove that every worker frame was drawn. No input latency, compositor timing, pure message-transfer cost, rendering-only timing, peak memory, browser responsiveness guarantee, or statistically stable throughput estimate is available. Headless execution and the observer itself can affect timings. A 64-grid row was not measured. These nanosecond physical runs do not establish real-time simulation or physical convergence.

The script bounds steps to 1..20 and grids to a unique subset of 16/32/48/64, constrains JSON files to repository `artifacts`, uses a private localhost preview port, and closes each context, browser and server in `finally`. Worker error messages fail the run. CLI help, invalid step count, duplicate grids and a different-drive JSON escape were checked; the latter three exited nonzero before launching a browser. A separate one-step grid16 lifecycle run and the complete three-row run exited zero.


The benchmark subsequently gained fail-fast handling for uncaught page errors: it retains the error text and rejects the row even if the worker can continue. This observation-only fix was checked with an ignored benchmark copy injecting `INJECTED_VIEWPORT_FAILURE` in a page timer; the actual browser run exited 1 with that error and wrote no result artifact, while cleanup returned promptly. Syntax checking also passed. The historical JSON records the earlier benchmark hash; its timing rows have not been rerun against the later CPML profile change and do not describe that newer production build.
