# Full Maxwell FDTD engine, motion, and replay

**Status:** Implementation plan only. No solver or UI implementation is included in this change.

**Goal:** Replace the separate static, wave, particle, and induction field paths with one time-dependent Maxwell solver for the supported scene models. Provide both prescribed and force-driven motion, and rewind to zero without losing edits.

**User requirements:** Full Maxwell evolution using FDTD; moving capacitor magnetic response; preserve the existing gadgets and custom wire geometry; prescribed trajectories or force-driven motion as an option; keep computation in the visitor's browser; plan before implementation. Do not add a redundant top Fields/Waves selector.

**Execution:** Work through the milestones in dependency order. Write and observe failing numerical/behavioral regressions before each implementation. A milestone is accepted only on its stated evidence. Preserve the existing uncommitted simulator repairs. Do not call a partial milestone the completed Maxwell migration.

## 1. What “full Maxwell” will mean

Evolve both curl equations, including displacement current and induction, with compatible divergence constraints and charge conservation:

\[
\partial_t\mathbf B=-\nabla\times\mathbf E,\qquad
\partial_t\mathbf D=\nabla\times\mathbf H-\mathbf J_f,
\]
\[
\nabla\cdot\mathbf D=\rho_f,\qquad
\nabla\cdot\mathbf B=0,\qquad
\partial_t\rho_f+\nabla\cdot\mathbf J_f=0.
\]

Use material relations \(\mathbf D=\epsilon_0\mathbf E+\mathbf P\) and \(\mathbf B=\mu_0(\mathbf H+\mathbf M)\), with specified constitutive models. In stationary, nondispersive materials these reduce to the usual epsilon/mu relations. This follows the D/B evolution and constitutive separation described in [Meep's introduction](https://meep.readthedocs.io/en/latest/Introduction/) and visible in its [step sequence](https://github.com/NanoComp/meep/blob/495abd14cb26854df61110987c66e0cc08f8e9e9/src/step.cpp).

There will be no electrostatic replacement of time evolution or algebraic B-from-E patch inside the Maxwell solver. A Poisson solve is allowed for consistent initial conditions or an explicitly requested constraint correction, with the correction and residual reported. It must not overwrite the evolving solution every animation frame.

A changing E does not require nonzero B at every coordinate: symmetry and the combination of conduction and displacement current matter. The capacitor regressions must specify plate motion, connections, initial conditions and probe locations, and compare vector fields against the corresponding reference problem.

“Full” refers to these field equations, not exact continuum arithmetic or an unspecified model of all matter. Grid error, finite charge shapes, PEC idealization, the chosen material laws, and mechanical assumptions remain explicit. Ferromagnetic hysteresis, quantum matter, and relativistic rigid-body mechanics are not implied by a Maxwell solver. The first supported magnetic body is a prescribed permanent magnetization, not a hysteresis model.

## 2. Findings in the current repository

| Location | Relevant limitation | Planned treatment |
| --- | --- | --- |
| `src/engine/staticsEngine.ts` | Motion recomputes electrostatics; B has no transported electrode charge | Stop using this path for evolved Maxwell fields; retain useful initialization/reference routines |
| `src/engine/fdtd/fdtd3d.ts` | Curl updates exist, but rho/J evolution is absent; sources add directly to fields | Replace internals with compatible Yee D/B updates and conserved sources |
| Same file | Conductors are static voxel masks that set all E components to zero | Separate stationary PEC, finite-conductivity, and moving-boundary treatments |
| Same file | Scalar electric/magnetic damping is a sponge | Implement and validate CPML |
| Same file | Material coefficients/readouts share a cell-centred raster; CFL uses vacuum speed only | Use component locations, material-aware stability, and aligned spatial/temporal sampling |
| `src/engine/induction/system.ts`, `particles/system.ts` | Independent clocks and external-field approximations | Couple to the Maxwell state and one physical clock |
| `src/app/store.ts`, `controller.ts`, `TopBar.tsx` | Reset can restore preset data | Separate rewind of runtime state from restore of authored scene |
| Existing FDTD tests | Finite fields and a broad propagation-speed check are insufficient | Add conservation, convergence, interface, source, and moving-body benchmarks |

These are architecture findings from reading the code, not claims that a new solver has been implemented or validated.

## 3. Architecture choice and Meep's role

| Approach | Benefit | Cost / constraint |
| --- | --- | --- |
| **Browser FDTD core, with native Meep reference fixtures — recommended** | Retains static hosting and integrates editable gadgets, charge transport, and mechanics | We must implement and validate the supported numerics ourselves |
| Port Meep to WebAssembly | Potential reuse of a mature numerical core | Requires a build/dependency/size feasibility study; scene sources and mechanics still need integration |
| Run native Meep as a backend | Direct access to its native facilities | Adds server compute and a simulation service; changes the browser-only deployment objective |

Use Meep's numerical documentation, equations, test cases, and an offline reference runner. Do not assume Meep is already a browser library. Directly reusing its source would additionally need to respect its [GPL license](https://github.com/NanoComp/meep/blob/master/doc/docs/License_and_Copyright.md); the proposed initial browser kernel is independently implemented.

Reference repository HEAD observed during planning: `495abd14cb26854df61110987c66e0cc08f8e9e9`. Record the actual installed Meep version, scripts, units, and fixture-generation command when producing reference data. No native Meep run has been performed during planning.

Begin with a deterministic CPU reference implementation in a Web Worker. Add a WebGPU backend behind the same stepping/sampling contract after conservation tests pass. Keep the CPU path for unsupported browsers and cross-checking. WebAssembly remains a measured optimization option, not a dependency for the first correctness milestone.

## 4. Numerical design

### Grid, state, and stepping

- Explicit Yee component offsets, with D/E/J on electric edges and B/H on magnetic faces. Charge occupies the associated dual control volumes. Compatible divergence and curl operators must satisfy discrete div(curl) = 0.
- Leapfrog B and D with material/source quantities evaluated at the corresponding physical times. Sampling must interpolate components to one coordinate and synchronize E/B in time; probes, energy, flux, forces, and displayed geometry must report the same frame time. [Meep documents the spatial sampling requirement](https://meep.readthedocs.io/en/latest/Yee_Lattice/).
- Internally normalize length, time, fields, charge, and current consistently; convert every UI value and exported result to/from SI. This is a numerical conditioning choice, not a change to c or the physical time scale.
- Use Float64 for reference tests and stable accumulation of diagnostics; compare Float32/browser acceleration against it, especially when magnetic signals are much smaller than electric ones.
- Compute the CFL bound from grid spacing and the fastest characteristic speed of the supported material formulation. Add material-pole, moving-interface, and small-cut-cell restrictions where applicable. Never increase the physics step to match the display refresh rate.
- Implement CPML auxiliary memories with distinct treatment of each curl derivative; support PEC and periodic outer walls. Test PML separately from charge conservation in the physical interior, and record boundary charge/energy flux. Do not assume an absorbing wave layer supplies an exact isolated DC boundary condition. Check static domain-size sensitivity too. [Meep's PML notes](https://meep.readthedocs.io/en/latest/Perfectly_Matched_Layer/) explain the finite-grid and geometry limitations.

### Charge and source contract

Use old/new charge positions and shape functions to deposit currents that satisfy the **discrete** continuity equation. Use an Esirkepov or Villasenor–Buneman deposition with segment splitting at cell/periodic crossings. Ordinary sampling of rho*v is not an acceptable substitute if it fails continuity. [WarpX's source configuration](https://github.com/BLAST-WarpX/warpx/blob/development/Docs/source/usage/parameters.rst) is another reference for charge-conserving FDTD deposition.

Every source must define its units, spatial shape, waveform, associated charge evolution, power, and treatment at domain boundaries. Compile scene objects into these sources:

| Gadget | Maxwell representation |
| --- | --- |
| Point charge, charged sphere/shell | Finite, resolution-controlled charge distribution; conserved trajectory deposition; initialize matching fields |
| Wire / loop / coil | Resolved conductor with a feed, or explicitly labelled impressed current distribution. Open impressed paths accumulate terminal charge unless a return path is supplied; closed paths preserve discrete divergence-free current |
| Antenna / point electric source | Spatially distributed electric current with charge continuity and a physical waveform; no arbitrary field increment per step |
| Plane wave / external field | Incident-field boundary/source or specified initial background. Time-dependent applied fields require compatible excitation; a field cannot be replaced everywhere instantaneously |
| Permanent magnet | Evolved field with a specified magnetization distribution and consistent bound charge/current representation, including motion-induced polarization when moving. Do not also inject equivalent current loops and double-count magnetization |
| Probe | Sample the same evolved state; provide E/B/D/H, local rho/J, and validity/domain information as applicable |

Impressed-current and resolved-conductor modes have different meanings: an ideal current source maintains the prescribed current; a passive conducting loop develops current through the field/material response. Make that distinction explicit in the object inspector. Meep likewise treats specified source currents as externally supplied, as described in its [source FAQ](https://meep.readthedocs.io/en/latest/FAQ/#how-is-the-source-current-defined).

### Conductors, capacitors, and moving matter

1. Support stationary PEC boundary conditions and stationary finite-conductivity materials first. Add a Drude auxiliary-current model where its frequency response is needed; expose material parameters rather than silently assigning real-metal properties. Validate skin depth and the timestep required by material dynamics. [Meep's material models](https://meep.readthedocs.io/en/latest/Materials/) are the reference for this separation.
2. A capacitor needs an explicit electrical model: **isolated initial charge** or **fed through specified terminals and a return connection**. For full-wave operation, voltage means a defined port path/integral and excitation, not a scalar potential clamped throughout a moving object. Existing fixed-potential scenes require a visible migration/setup step; do not invent hidden supply wires.
3. Initialize charged conductors with a compatible field and surface charge distribution; allow an explicit charging transient instead. For a uniformly translating precharged configuration, supply compatible moving initial fields or source history; E from a static solve with B=0 is not generally the intended moving steady state.
4. For moving media, evolve transported free charge and material state. Evaluate constitutive response in the local material rest frame and transform fields/current consistently. Rerasterizing epsilon(x,t) alone models temporal modulation and does not establish the correct physics of moving matter.
5. Treat moving PEC interfaces using conservative interface/swept-volume geometry and the rest-frame tangential electric boundary condition, with charge/current transfer across swept cells. Never wipe fields/charge when a voxel changes membership. First prototype planar translation in 1D/2D; then extend the verified update to 3D and rotation. This is a research and validation milestone. The [moving-structure FDTD paper](https://arxiv.org/abs/2306.10035) specifically shows that conventional updates can give incorrect amplitudes; its published examples do not certify our future arbitrary 3D implementation.
6. Require continuous, subluminal trajectories, including material-point speeds on rotating bodies. Reject teleporting looped keyframes; add smooth interpolation and velocity/acceleration controls. User-defined lab-frame trajectories do not imply a physically realizable perfectly rigid relativistic solid.

Do not substitute a quasistatic solver if a moving-boundary benchmark fails. Keep that object configuration explicitly unsupported until the Maxwell implementation is validated.

### Prescribed and force-driven motion

Each supported body gets `fixed`, `prescribed`, or `forceDriven` dynamics. Prescribed mode uses the authored trajectory and records the mechanical work of the external drive. Force-driven mode needs mass, centre of mass, inertia tensor, initial linear/angular velocity, and allowed degrees of freedom. Support constraints/fixtures must be explicit.

- Source particles: relativistic particle pusher, staggered field gather, charge-conserving deposition, and particle boundary accounting on the same field clock. Distinguish test particles from particles that source the fields. Finite-size PIC does not promise continuum point-charge self-force or a separate radiation-reaction model.
- Rigid bodies: integrate translation and quaternion rotation with the field timestep, using a force/torque evaluator consistent with electromagnetic momentum balance. For a vacuum enclosing surface, include the time derivative of enclosed field momentum as well as Maxwell stress; stress flux alone is insufficient in a transient. Include feed/support momentum and source work in the budget. Start with separated bodies with a resolved sampling surface.
- The first force-driven rigid-body model uses classical Newton–Euler mechanics with an explicit nonrelativistic operating range; relativistic extended-body mechanics requires a separate model. This does not replace or drop terms from Maxwell's field equations.
- Preserve user intent when changing modes: explicit authored initial pose/velocity; do not turn the current rendered pose into a new initial condition automatically.

## 5. Time, replay, and editing

Create a separate immutable authored `SceneDefinition` and mutable `SimulationState`. The latter includes the step index, fields, charge/current, material memory, CPML state, circuit/feed state, particles, rigid-body poses/momenta, and diagnostics.

- **Rewind to t = 0:** pause, restore the initialized runtime state for the current edited definition, clear runtime trails/charts, and preserve all objects, parameters, trajectories, selection, and undo history.
- **Replay:** rewind the same definition and start. A deterministic CPU run must reproduce samples at the same integer step; accelerated runs have declared numerical tolerances.
- **Restore preset:** separately restore the library definition; make its destructive effect explicit in the action label.
- A display/probe edit does not restart physics. A source/material/geometry edit pauses and starts a new initialized run, with a clear state indicator; never splice incompatible old fields into the new scene.
- One clock advances field state, sources, motion, particles, and ports. Geometry rendering interpolates the accepted simulation frames and does not run ahead on a wall-clock oscillator.
- Show physical time, step count, dt, target duration, measured steps/second, estimated remaining wall time, grid/memory estimate, and resolution diagnostics. Playback speed controls pacing, not c or source velocities.
- A full-wave solution generally cannot use a unique scalar electrostatic potential for all of E. Do not display `phi = 0` as a computed observable. Provide total E/B and a separately defined port voltage or clearly labelled longitudinal potential only if implemented.

For illustration, in vacuum with cubic dx = 0.01 m and safety factor 0.9:

\[
\Delta t\leq\frac{0.9\Delta x}{c\sqrt{3}}\simeq1.73\times10^{-11}\ \mathrm{s}.
\]

One simulated second is about 5.77e10 steps at that setting. This is a derived cost estimate, not a measured runtime. Nanosecond wave experiments can be practical while a 1 Hz mechanical cycle remains extremely expensive. GPU acceleration does not remove that time-resolution requirement. Never silently rescale a 1 Hz trajectory to MHz. Meep also notes the inefficiency of time-domain solving for static/lumped problems in its [FAQ](https://meep.readthedocs.io/en/latest/FAQ/#can-meep-model-electrostatic-effects).

## 6. Proposed modules and interfaces

Keep the UI/Three.js stack. Introduce focused modules under `src/engine/maxwell/`:

| Module | Responsibility |
| --- | --- |
| `yee.ts`, `operators.ts` | Component layouts, boundary indexing, compatible differential operators |
| `state.ts`, `solver.ts` | D/B state, leapfrog ordering, stepping and backend contract |
| `materials.ts`, `cpml.ts` | Constitutive updates, material memory, absorbing boundaries |
| `sources.ts`, `deposition.ts` | Scene compilation, rho/J deposition, feeds and impressed currents |
| `initialization.ts` | Consistent initial fields, constraints, histories, saved initial state |
| `movingGeometry.ts`, `movingMaterials.ts` | Swept geometry, transported state, moving interface/rest-frame response |
| `dynamics.ts`, `forces.ts` | Prescribed motion, particle/body integration, momentum/work accounting |
| `diagnostics.ts`, `sampling.ts` | Residuals, energy/flux budgets, collocated/synchronized readouts |
| `backends/cpu.ts`, `backends/webgpu.ts` | Same physical update contract, different execution backend |

Add `src/workers/maxwell.worker.ts` and generation-tagged init/step/run/pause/rewind/sample messages in `src/workers/protocol.ts`. A frame includes `generation`, `step`, `time`, aligned poses, requested overlays/probes, diagnostics, and compute metadata. Keep one bounded frame-transfer pipeline; the worker advances many steps between renders without dropping physical steps.

Update `src/app/controller.ts`, `store.ts`, `App.tsx`, `src/scene/types.ts`, `defaults.ts`, `restoreScene.ts`, `presets.ts`, `src/ui/TopBar.tsx`, `RightPanel.tsx`, `MotionEditor.tsx`, `ProbeReadout.tsx`, and `src/viewport/ViewportController.ts` at the relevant milestones. Version scene files and migrate authored data without silently changing electrical connections, source units, material meaning, or motion frequency.

## 7. Implementation milestones

### M1 — Replay and run-state contract

**Files:** Store/controller/protocol/TopBar/App plus `tests/replay.test.ts` and browser transport tests.

- [ ] Reproduce edited-preset data loss and stale in-flight replies after restart.
- [ ] Introduce independent rewind/replay/restore actions, generation invalidation, and authored/runtime state separation.
- [ ] Restore every auxiliary state and initial pose, including paused nonzero-phase trajectories.
- [ ] Verify edited capacitor parameters, wire control points, prescribed/force-driven initial data, display and selection survive rewind and replay. Verify restore remains a distinct action.

**Acceptance:** Replay of a current edited scene reproduces probe samples at fixed steps without undoing edits; old worker frames cannot overwrite the restarted run.

### M2 — Verified CPU Maxwell core

**Files:** `yee.ts`, `operators.ts`, `state.ts`, `solver.ts`, `backends/cpu.ts`, `sampling.ts`; `tests/maxwell/operators.test.ts`, `vacuum.test.ts`, `sampling.test.ts`.

- [ ] Write failing div(curl), plane-wave phase/impedance, field synchronization, and source-free energy tests.
- [ ] Implement compatible D/B leapfrog updates and component-aligned material-free sampling, first reduced-dimensional tests and then 3D.
- [ ] Establish grid/time refinement tests and Float64/Float32 comparisons.
- [ ] Add CFL validation and reject unstable settings before allocation/run.

**Acceptance:** Both E and B propagate together; vacuum wave speed and impedance converge toward analytic values. Smooth source-free cases approach second-order convergence. Constraint errors remain at the established roundoff scale rather than growing with time.

### M3 — Materials, boundaries, and reference harness

**Files:** `materials.ts`, `cpml.ts`, `diagnostics.ts`; `tools/reference/meep/`, `tests/fixtures/maxwell/`, `tests/maxwell/materials.test.ts`, `boundaries.test.ts`.

- [ ] Implement stationary nondispersive materials, finite conductivity, stationary PEC, and CPML; add Drude memory with its stability restrictions.
- [ ] Compare Fresnel reflection/transmission, cavity resonances, conductor skin depth and loss against analytic results.
- [ ] Create native Meep scripts and versioned fixtures for overlapping models; match units, geometry, sources, boundaries, sampling positions and times.
- [ ] Measure PML reflection for normal and oblique pulses across the declared test band, with layer-thickness and domain-size refinement.

**Acceptance:** Quantitative interface/cavity agreement and improving convergence; proposed initial target <1% error for well-resolved smooth benchmarks and <1e-3 reflected field amplitude for the defined PML pulse suite. These are acceptance targets, not current measurements or promises for every frequency/geometry.

### M4 — Conserved charges, gadget sources, and capacitor feeds

**Files:** `deposition.ts`, `sources.ts`, `initialization.ts`; scene schema/migration/inspector; `tests/maxwell/deposition.test.ts`, `sources.test.ts`, `capacitor.test.ts`.

- [ ] Test conservation for diagonal/multi-cell paths, periodic crossings, conductor terminals, and boundary exit.
- [ ] Implement conserved finite charge shapes and scene-source compilation, including current endpoint charges, polarization/magnetization sources and specified feeds.
- [ ] Initialize charged scenes consistently; reject net charge in a fully periodic box unless an explicit compatible neutralization model is chosen.
- [ ] Build isolated-charge and fed charging-capacitor examples. Feed plus return path must be visible and persisted.
- [ ] Validate Ampere–Maxwell circulation using conduction plus displacement current, and Faraday circulation using evolving B.

**Acceptance:** A stationary charging capacitor generates the appropriate B from the evolved equations; integrated charge budgets and Gauss residuals stay bounded. Source amplitude does not change physical meaning when dt/resolution changes. No independent Biot–Savart overlay supplies the answer.

### M5 — Prescribed motion and moving-body field validation

**Files:** `movingGeometry.ts`, `movingMaterials.ts`, `dynamics.ts`; shared motion evaluator/editor and controller/viewport; `tests/maxwell/moving-charge.test.ts`, `moving-interface.test.ts`, `moving-capacitor.test.ts`.

- [ ] Establish constant-velocity charge/charge-cloud benchmarks against analytic electromagnetic fields away from the finite charge shape.
- [ ] Implement transported material/source state with conservative remapping and local rest-frame constitutive response.
- [ ] Prototype translating planar conductor/interface updates; validate moving-mirror frequency **and amplitude** before 3D extension.
- [ ] Extend verified interface updates to 3D translation, then smooth rotation; account for small-cell timestep restrictions and swept charge.
- [ ] Test a co-translating isolated capacitor, a changing-gap isolated capacitor, and a fed moving capacitor separately. Include startup/source-history choices and boundary/domain refinement.
- [ ] Integrate smooth custom trajectories; validate every material-point speed and reject discontinuous loops.

**Acceptance:** The low-speed co-translation limit approaches B = v cross E / c^2 in the appropriate vacuum region, as a benchmark only. General motion is still evolved with Maxwell updates. Turning points, charge transport, radiated transients, and moving-boundary response pass conservation/convergence tests. Missing or tiny B is assessed quantitatively, not judged by whether field lines look dramatic.

### M6 — Force-driven option and induction feedback

**Files:** `forces.ts`, `dynamics.ts`, source coupling, schema/inspector; `tests/maxwell/dynamics.test.ts`, `momentum.test.ts`, `induction.test.ts`.

- [ ] Add the per-object motion-mode selector, mass/inertia/initial velocities, and explicit fixed constraints.
- [ ] Couple source particles to evolved fields with conserved deposition; retain a labelled test-particle option.
- [ ] Implement force/torque and mechanical integration with field momentum, losses, source work and prescribed-drive work in the accounting.
- [ ] Verify force reversal on charge reversal, uniform-field particle motion, attraction of oppositely charged bodies, and an isolated body's absence of a systematic spurious grid thrust under refinement.
- [ ] Upgrade magnet-through-loop to a resolved passive conducting loop; verify induced current opposes flux change and energy transfers to field/loss/mechanical work. Keep impressed-current loops explicitly distinct.

**Acceptance:** Switching between prescribed and force-driven modes changes the motion model without detaching it from field time. Closed reference cases have convergent total energy and momentum budgets; driven cases account for external work. This milestone is required for the user's requested option, not an unmentioned later enhancement.

### M7 — Browser performance, presentation, and migration

**Files:** `backends/webgpu.ts`, maxwell worker/controller/protocol, viewport, all affected presets/import-export, UI/help/physics audit/README; browser tests and benchmark scripts.

- [ ] Benchmark measured step cost, render/sampling cost, transfer cost and exact allocated memory at several padded grid sizes. Bound requested allocations before starting.
- [ ] Add WebGPU stepping after CPU acceptance, and compare fields/constraints/diagnostics at fixed step counts with the CPU backend. Keep GPU state resident; transfer only requested samples/overlays, and preserve a CPU fallback.
- [ ] Provide one-clock transport, physical-time targets, wall-time estimates, consistent frame geometry/fields, force/current overlays, and truthful full-wave voltage/probe readouts.
- [ ] Migrate every preset only when its material, charge, circuit and dynamics semantics are supported; expose unresolved choices instead of silently using old static fields.
- [ ] Replace the existing split physics dispatch for migrated scenes, preserving Add, custom curves, saved scene editing, and transparency/probe features. Do not introduce the redundant top mode selector.
- [ ] Run CPU/GPU numerical suites, existing regression tests, browser tests, production build, and replay/import/export checks.

**Acceptance:** Full browser workflow for a moving capacitor and magnet/loop, both motion options, replay preserving edits, and documented measured performance. Static hosting remains sufficient; native Meep is an offline validation dependency only. There is no promise of a realtime 1 Hz mechanical cycle on an explicit full-wave grid.

## 8. Validation and release rule

For each numerical benchmark, record the physical model, initialization, precision/backend, source waveform, boundary treatment, grid/time refinement, comparison observable, error norm and excluded singular/interface sampling points. Use analytic references where possible; use native Meep only for configurations it represents equivalently. A Meep comparison of stationary optics does not validate moving conductors or force coupling.

Measure at least:

- Discrete continuity residual and total charge including terminal/boundary flux.
- Electric and magnetic Gauss residuals in physical cells, reported separately from CPML.
- Faraday and Ampere–Maxwell integral residuals.
- Energy change plus outgoing flux, Ohmic loss, and source/mechanical work.
- Field/body/particle momentum and torque budgets for force-driven tests.
- Numerical dispersion, interface error, PML reflection and low-frequency signal precision.
- Deterministic CPU replay and bounded CPU/GPU differences.

Initial smooth-case targets: normalized continuity/operator errors near Float64 roundoff in isolated deposition/operator tests; <=1e-5 normalized Gauss residuals in the defined Float32 interior regression cases; <1% selected well-resolved analytic observables, with improvement under refinement. Define normalization with a fixed physical scale so cancellation/near-zero fields cannot hide errors. Interface singularities and transient material/mechanical cases require separately published error budgets, not an inappropriate universal second-order claim.

Final project checks remain `npm test`, `npm run test:ui`, and `npm run build`; add focused numerical/reference/benchmark commands during implementation. Tests passing is necessary but does not replace the convergence and conservation report.

**Release condition:** M1 through M7, including both motion options and the moving-capacitor validation, are complete. Earlier milestones can be reviewed independently, but the website must not claim the requested general Maxwell migration is complete while a gadget still uses an unlabelled static approximation or a moving-boundary/force model remains unvalidated.
