# FieldLab

A browser-based 3D electromagnetism sandbox built with Vite, TypeScript, React and Three.js. Choose the electrostatic/quasistatic tools or an **experimental Maxwell FDTD scene solver** with an explicit physical model.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # numerical and application regressions
npm run test:ui    # browser integration tests
npm run build      # type-check and production build
```

Simulation computation already runs on the visitor's device. Browser Web Workers perform the field solves; no remote physics service is required. Deploy by serving `dist/` from a static host with JavaScript worker support. Native Meep is an optional offline reference tool, never a browser dependency.

## Choose the physical model

**Solve → Use approximation** is saved with the scene. Existing presets and older files retain their previous solver by default. Switching it off selects the experimental Maxwell scene solver for either kind of preset. The top bar and viewport identify the choice. Unsupported configurations report an error instead of silently using static fields.

| Choice | Computes | Main limits |
| --- | --- | --- |
| Approximation, field scenes | Analytic charge fields or multigrid Poisson; Biot–Savart B; prescribed-motion flux/EMF; legacy Boris test particles | E is electrostatic. No spatial induced E, retarded radiation or passive circuit feedback. Legacy particles do not source fields. |
| Approximation, wave presets | Existing `fdtd/fdtd3d.ts` wave solver with prescribed wave sources, stationary materials/PEC masks and a graded absorbing sponge | Separate from the experimental coupled scene solver; gadget support and absorber differ. |
| Experimental Maxwell FDTD | Float64 Yee evolution, conserved source deposition, CPML, selected material/source models, common field-time motion and source particles | Finite grid and model restrictions. Moving PEC, voltage feeds, general moving dielectrics and a complete body/field energy–momentum ledger remain unfinished. |

For quasistatics, `L/(cT) ≪ 1` and `v/c ≪ 1` are useful conditions, but do not establish that omitted inductive E or circuit feedback is negligible. See [the physics model](docs/physics-model.md) for both paths.

## Experimental Maxwell models

- Point charges and source particles deposit finite-grid charge/current. In full mode their **Source profile** can explicitly select a finite smooth cloud with a width in metres; its density has support center +/-2 widths in each lab axis. Legacy files retain CIC. Width and source history must be resolved; coarse clouds exhibit mesh self-force. Spheres/shells use discrete charge samples. These numerical shapes are not continuum point-charge self-force models.
- Stationary linear, isotropic, nondispersive dielectrics support relative permittivity, permeability and conductivity. Moving dielectrics are rejected.
- Conductors require **Initialize plate voltages, then isolate** in Solve. Authored voltages or floating net charges prepare the initial charge; subsequent evolution uses isolated finite-conductivity bodies. There is no implicit battery or continuing voltage clamp. A wire can explicitly select Terminal current feed, two stationary bodies, a visible return route and a rise time. Excessive conductivity gives a stability error.
- Permanent magnets are impressed magnetization sources in the authored laboratory shape, including prescribed motion and bound charge/current. This is not a hysteresis, micromagnetic, demagnetization, rest-shape contraction or force-driven magnet model.
- The **Maxwell: charging capacitor** preset demonstrates a stationary terminal current source; **Maxwell: moving isolated capacitor** demonstrates charge transport without a continuing supply.
- Wires, loops and coils can supply stationary impressed current or act as resolved passive finite-conductivity material. Passive conductors respond to the evolved fields and may move; their physical diameter must span at least three grid cells. Separate conducting bodies may not overlap or make electrical contact. Moving impressed filaments/driven wave sources still require additional feed models and are rejected. Full-mode electric point/antenna amplitudes are in amperes. The plane-wave gadget is a bidirectional x-normal current sheet, not a one-way incident-wave boundary.
- **Dynamics** offers fixed, prescribed and force-driven modes. Point/source-particle motion uses a relativistic momentum pusher. Charged spheres and conducting bodies use experimental classical rigid-body mechanics with a declared `0.01c` translation limit. Body force/torque and complete energy/momentum accounting require further validation.
- Scene boundaries support PEC or CPML. Periodic boundaries are tested in the core/native references, but the coupled scene adapter rejects them pending initialization/transport validation.

Selecting evolving Maxwell equations for these models does not mean that the full general-purpose migration is complete or validated.

## Editing, transport and probes

- **Rewind to t = 0** pauses and reinitializes the current edited definition. It clears runtime trails/charts while preserving objects, parameters, trajectories, selection and undo history.
- **Replay** reinitializes that definition and starts it. **Restore preset** separately discards edits in favor of the library preset and can be undone; it is disabled for custom scenes.
- In full Maxwell mode, **Solve > Stop at physical time** sets an absolute target in seconds. The run stops at the first field step reaching it; changing the target preserves the current state. Rewind/replay preserves the target as well as edits. The remaining-step count and measured stepping-time estimate help assess cost.
- **Space** plays/pauses; **Single step** advances the selected solver. Maxwell sources, bodies and fields share physical dt. Display edits do not advance that clock. Physics edits initialize a new run; obsolete worker generations cannot replace its results.
- Use **New custom scene** and **Add**. Wires support 3D control points and smooth curves. Select prescribed Dynamics for oscillation, arbitrary-axis spin or timed keyframes. Rows are `t, x, y, z, rx, ry, rz`: seconds, metre offsets and degree offsets from the authored initial pose. Maxwell loops must return continuously to the first pose; piecewise-linear velocity changes can still excite high frequencies.
- Enter probe coordinates under **Edit → Position**, or **Data → Sample at coordinate → Add probe here**. Maxwell probes show E, B, D, H, J and deposited charge density when available. A unique electrostatic potential is not reported for full evolving E. Outside-domain probes are marked unavailable.
- **View** controls field lines, arrows, slices and opacity. Transparency is visual only. Scenes autosave to `localStorage`; Export/Import preserves the authored JSON definition.
- Drag to orbit, scroll to zoom, right-drag to pan; click to select. **Delete** removes selection, **G/R/S** changes the gizmo, **1–4** selects camera views, and **F** resets the camera.

## Resolution, startup and cost

Resolve source width, motion, interfaces and the highest significant source frequency, including its startup ramp. Abrupt current/velocity starts and under-resolved charge shapes can produce persistent grid ringing. Smooth source history and spatial/time/domain refinement are required before interpreting weak B or radiation. Frequencies and velocities are never silently rescaled to speed up a mechanical cycle.

Physical time is not wall-clock animation time. With cubic `dx = 0.01 m` and CFL 0.9, vacuum `dt ≈ 1.73e-11 s`, requiring about `5.77e10` steps per physical second. Steps per frame changes pacing, not c or the authored motion frequency. Nanosecond experiments can be practical while a 1 Hz full-wave mechanical cycle is extremely costly.

The UI's **Conservative memory budget** is the solver's admission estimate, not exact live allocation or browser memory. See [measured CPU performance](docs/maxwell-performance.md) for preparation, stepping, sampling, buffer/payload counts and Node-versus-browser caveats.

```bash
npm run bench:maxwell -- --json artifacts/maxwell-benchmark.json --report docs/maxwell-performance.md
# Add --include64 for the larger grid; default is three steps per grid.
```

## Validation and remaining work

- [CPU Float32 storage comparison](docs/maxwell-precision-validation.md): optional kernel storage against the Float64 reference. The website still uses Float64; this is not WebGPU parity.
- [Momentum and surface-stress audit](docs/maxwell-momentum-validation.md): fixed physical control surfaces, initial Coulomb stress, reconstruction sensitivity and remaining spatial error.
- [Passive-body energy audit](docs/maxwell-passive-energy-validation.md): actual magnetic drag, polarization, signed material work and measured closed-budget limits.
- [Smooth finite-source model](docs/maxwell-smooth-source-validation.md): analytic density assignment, conserved motion current and compatible electric force gathering, including support and self-force limits.
- [Coupled source audit](docs/maxwell-coupling-validation.md): legacy force-driven point/sphere coupling fails energy acceptance; selected smooth-cloud cases now show energy refinement, with mesh self-force and incomplete momentum acceptance recorded. Data exposes particle kinetic energy, deposited-current work and their mismatch; these diagnostics do not correct the coupling.
- [Numerical core validation](docs/maxwell-core-validation.md): specified Fresnel amplitudes, stationary cavity frequency, finite-conductivity attenuation/loss and selected normal/oblique CPML pulses, with refinement and exclusions.
- [Native Meep comparison](docs/maxwell-meep-validation.md): actual Meep 1.35.0 source-free periodic standing waves in vacuum and relative permittivity 4. Maximum selected CPU/Meep RMS difference is `2.51e-16`; continuum error is reported separately and converges at second order. This does not validate moving bodies, charge sources or CPML.
- [Physics model and evidence](docs/physics-model.md): source initialization, moving-charge refinement, observable meanings and force/material limitations.
- [Terminal current source validation](docs/maxwell-terminal-validation.md): explicit charging/return path, independently conserved plate charge and displacement-current circulation.
- [Stationary Drude validation](docs/maxwell-drude-validation.md): angular-frequency material parameters, coupled stability and measured dispersion/penetration.
- [Full implementation plan](docs/superpowers/plans/2026-10-24-full-maxwell-fdtd.md): outstanding moving-PEC/mirror, general moving-media, moving/voltage-feed and passive-circuit, complete energy/momentum and WebGPU parity acceptance requirements.

Browser tests exercise actual worker frames, edited-scene replay, probes, conductor setup and common physical time. They use Edge on Windows; install Playwright Chromium elsewhere. Screenshots go to `artifacts/`. Passing tests and selected references do not provide a universal accuracy guarantee.

Check the committed native fixture without installing Meep:

```bash
node scripts/check-meep-reference.mjs
```

Native regeneration is documented in [the Meep report](docs/maxwell-meep-validation.md).

## Project layout

```text
src/engine/electrostatics/   analytic fields and multigrid Poisson
src/engine/magnetostatics/  approximate Biot–Savart tools
src/engine/particles/       legacy test-particle pusher
src/engine/induction/       approximate prescribed-motion flux/EMF
src/engine/fdtd/            legacy wave solver
src/engine/maxwell/         experimental Yee core and coupled scene models
src/scene/                 authored definitions, motion, defaults and presets
src/workers/               local field workers and generation-tagged messages
src/app/, src/ui/          state, controllers, transport and panels
src/viewport/              Three.js rendering and field overlays
tests/, scripts/, docs/    regressions, offline references and measured reports
```
