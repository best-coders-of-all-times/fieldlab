# FieldLab

A 3D electromagnetism sandbox for electrostatics, magnetostatics, charged-particle motion, induction and time-domain Maxwell waves. Built with Vite, TypeScript, React and Three.js.

![FieldLab](public/favicon.svg)

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # physics + solver tests (Vitest)
npm run build      # type-check and production build
```

## What it does

FieldLab has two solver regimes, chosen with the **Fields / Waves** switch in the top bar.

### Fields — static and quasistatic

- **Electrostatics.** Point charges, dipoles and charged spheres/shells use exact analytic superposition. Scenes with conductors or dielectrics run a 3D finite-volume Poisson solve on a collocated grid with geometric multigrid V-cycles, red–black Gauss–Seidel smoothing, full-weighting restriction and trilinear prolongation. Variable ε, floating and fixed-potential conductors, capacitance and differential capacitance are supported.
- **Magnetostatics.** Wires, loops, coils and permanent magnets are discretised into current segments and evaluated with Biot–Savart. A bar magnet is represented by stacked equivalent surface-current loops, so the bound-current overlay and the field use the same model. Flux through loops and approximate inductance are computed from the same source set.
- **Charged particles.** A Boris pusher advances test charges in the superposition of the analytic electric field, the Biot–Savart magnetic field and any uniform external **E**/**B**. Kinetic energy is conserved in a pure magnetic field, and crossed fields reproduce the **E × B / B²** drift. Trails are drawn as glowing world-lines. The displayed cyclotron radius and period come from the instantaneous fields.
- **Induction.** Scripted `oscillate`/`spin` motion (set by the induction presets) drives:
  - numerical flux and **ε = −dΦ/dt** through loops and coils (coil turns included),
  - uniform-field flux **B·n̂ A**,
  - motional EMF **∫(v × B)·dl** in a moving wire.

  Readouts appear in the viewport HUD and in the **Data** tab, and are plotted in the chart drawer.

### Waves — time-domain Maxwell

- A 3D Yee-lattice FDTD solver advances the full Faraday and Ampère–Maxwell curl equations with a leapfrog schedule.
- Materials support relative permittivity/permeability and conductivity, plus PEC masks.
- Plane-wave, point and dipole-antenna sources; CW or pulse waveforms.
- Boundaries per axis: PEC, periodic, or a graded impedance-matched absorbing layer.
- Slice heatmaps (|E|, components, |B|, energy, Poynting), vector arrows (E/B/P), probes, probe time series, and electric/magnetic energy diagnostics.

## Presets

- **Electrostatics** — point charges, charged sphere E(r), parallel-plate capacitor, capacitor with dielectric at fixed V and fixed Q, dielectric slab, conductor cavity, conducting sphere in E.
- **Magnetostatics** — straight wire, current loop, solenoid, parallel wires, bar magnet.
- **Dynamics** — electron in crossed E and B.
- **Induction** — magnet through a loop, rotating-loop AC generator, rod on rails.
- **Waves** — plane wave, reflection at a PEC, Fresnel reflection at a dielectric, Faraday cage, dipole antenna.

Each preset carries a **Theory** tab with equations and suggested experiments.

## Using the app

- **Drag** to orbit, **scroll** to zoom, **right-drag** to pan.
- **Click** an object to select it; use the transform gizmo or the inspector to edit it.
- **Space** play/pause, **Delete** remove selection, **G/R/S** translate/rotate/scale gizmo, **1–4** camera presets, **F** reset the camera.
- The **View** tab controls field lines, arrows, slice planes, colormaps and overlays. The **Solve** tab exposes resolution, boundaries, external fields and the particle/induction slow-motion factor. The **Data** tab shows capacitance, inductance, energies, EMF/flux, particle telemetry, probes and solver statistics.
- Scenes autosave to `localStorage` and are restored on reload; **Export/Import** in the top bar round-trips the scene as JSON.

## Numerics and limitations

- **Absorber.** The wave solver uses a graded impedance-matched sponge, not a true CPML. Reflections are small but not zero; increase the layer thickness or use periodic walls for exact embedded 1D propagation.
- **Resolution.** FDTD runs on the CPU in a Web Worker at 48³–96³ cells. Keep at least ~15 cells per wavelength. The FDTD speed test in `tests/fdtd_speed.test.ts` measures a phase velocity within a few percent of *c*.
- **Particles are test charges.** They feel the field but do not source it (no PIC feedback). Their fields come from the analytic/Biot–Savart stack; a Poisson solution for conductors is not fed back into the particle pusher. Motion is non-relativistic.
- **Scripted motion.** Induction demos move objects on prescribed trajectories; the statics worker does not re-solve the field while a magnet moves, so in the moving-magnet scene the object moves but the static field overlay is intentionally hidden. Flux/EMF are still recomputed every frame from the moved sources.
- **Induction is quasistatic.** There is no self-consistent circuit/current solve, no eddy-current solver, and no radiation reaction. Magnetic forces on moving conductors are not included.
- **Magnet model.** Bar magnets are approximated by 16 stacked current loops with a small Biot–Savart softening radius. This is accurate at the display scale but is not a full micromagnetic solve.
- **Units and scale.** SI throughout. The default domain is under a metre; fields, charges and currents can be edited over many orders of magnitude, so readouts use SI prefixes/scientific notation.
- **Particle time.** Wall time is mapped to 200 ns of plasma time at 1× (the **Particle slow-motion** control scales this), so cyclotron orbits are visible rather than instantaneous.

## Project layout

```
src/
  engine/
    electrostatics/   analytic fields, multigrid Poisson, capacitance
    magnetostatics/   Biot–Savart segments, magnets, flux, inductance
    particles/        Boris pusher and test-particle system
    induction/        scripted motion, flux/EMF, motional EMF
    fdtd/             Yee-lattice Maxwell solver
    grid.ts           grids and sampling
    colormap.ts       sRGB + linear-light colormaps
  scene/              scene model, defaults, rasterisation, presets
  workers/            statics and FDTD Web Workers
  viewport/           Three.js objects, field layers, slices, arrows, trails
  ui/                 React panels, charts, theory, transport
  app/                Zustand store, controller, field bus
tests/                physics and solver regression tests
```

## Tests

`npm test` covers multigrid convergence, the parallel-plate capacitor, FDTD stability and phase velocity, the Boris pusher (energy conservation, gyroradius, **E × B** drift), Biot–Savart directions and magnitudes, all three induction demos (including the analytic **NBAω** and **Bℓv** amplitudes), and autosave restoration/merging.

