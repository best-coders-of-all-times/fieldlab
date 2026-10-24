# Measured Maxwell CPU performance

Measured at 2026-10-24T11:06:45.427Z with `npm run bench:maxwell -- --steps 5 --json artifacts/maxwell-benchmark.json --report docs/maxwell-performance.md`.

Environment: Node v24.19.0, win32 10.0.26200 (x64); Intel(R) Core(TM) Ultra 9 275HX; 24 logical CPUs; 31.43 GiB system RAM. This is one sequential run, with 5 measured field steps per grid and no explicit warm-up or forced garbage collection. The JSON records SHA-256 hashes of the benchmark and solver source files from the measured working tree.

The script loads the actual `MaxwellSceneSolver` through Vite `createServer().ssrLoadModule()`, using the existing project dependencies. Vite startup and module transformation are excluded from preparation time. Preparation includes grid allocation, source/material preparation, electrostatic initialization and the initial rewind snapshot. Each row constructs a fresh moving, isolated, finite-conductivity capacitor: a 1 m cubic domain, two 0.08 × 0.5 × 0.5 m plates at x = ±0.125 m, initial potentials ±3 V, conductivity 0.01 S/m, and shared sinusoidal y motion of amplitude 0.02 m at 10 MHz. CFL is 0.9 and each boundary has four PML cells. This deliberately fast motion is an authored benchmark parameter, not a rescaling of any saved scene.

| Requested resolution | Padded grid | Δt (s) | Preparation (ms) | Step (ms/step) | Retained buffers (MiB) | Solver budget estimate (MiB) |
| --- | --- | --- | --- | --- | --- | --- |
| 16 | 25 × 25 × 25 | 1.0833e-10 | 279.42 | 19.39 | 12.77 | 16.87 |
| 32 | 41 × 41 × 41 | 5.4164e-11 | 2481.94 | 66.39 | 56.22 | 74.40 |
| 48 | 57 × 57 × 57 | 3.6109e-11 | 9304.83 | 156.56 | 150.90 | 199.93 |

Sampling is timed once per operation after stepping, without changing the field clock: one 64 × 64 central xy |E| slice, three probes, a 9 × 9 × 9 E-arrow lattice, 16 E field-line seeds, and diagnostics. Lines have variable output lengths. These display settings are fixed across grids; they are not the complete browser frame cost.

| Resolution | Slice (ms) | Three probes (ms) | Arrows (ms) | Lines (ms) | Diagnostics (ms) | Explicit transfer bytes | Line buffer bytes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 16 | 72.10 | 0.58 | 15.75 | 48.27 | 12.74 | 113052 | 76256 |
| 32 | 54.78 | 0.07 | 11.57 | 50.12 | 25.32 | 113020 | 76224 |
| 48 | 59.80 | 0.22 | 11.21 | 41.98 | 62.65 | 113148 | 76352 |

Explicit transfer bytes count slice, lattice and field-line ArrayBuffers in the worker transfer list. Line buffer bytes are the field-line subset of that total; they are transferred rather than copied by structured clone. Probe JSON byte counts in the JSON artifact are UTF-8 serialization sizes for comparison, not measured worker wire sizes. Metadata and JavaScript object overhead are excluded from the table. Retained buffers are unique reachable ArrayBuffers in the solver after stepping; they exclude temporary allocations, JavaScript heap objects, browser rendering storage and process overhead. The solver's conservative admission estimate is reported separately from that count; the current allocation guard is 768 MiB.

Node executes this benchmark on the calling thread. The browser runs the solver in a dedicated worker, with additional message scheduling, structured cloning, transferred-buffer handling, Three.js rendering and UI work. This benchmark does not measure those costs or certify UI responsiveness. JIT compilation, garbage collection, CPU load, power management and browser engine differences can change results; use repeated browser and worker measurements for capacity planning. The short run is a smoke benchmark, not a statistically stable throughput estimate or a peak-memory measurement.

Physical time is independent of animation pacing. The measured steps advance only 16: 5.416e-10 s; 32: 2.708e-10 s; 48: 1.805e-10 s. A one-second mechanical trajectory still requires roughly 1/Δt field steps. These timings do not establish real-time performance or validate moving interfaces, material models, convergence or conservation.

Reproduce with `npm run bench:maxwell -- --json artifacts/maxwell-benchmark.json --report docs/maxwell-performance.md`. Add `--include64` for the larger grid, or `--steps 5` for a slightly longer run. The JSON artifact includes operation times, field metadata, charge/energy diagnostics, payload counts, retained storage and environment details.
