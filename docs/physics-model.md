# FieldLab physics model and execution

**Solve → Use approximation** is an explicit saved solver choice. Existing presets and older files default to their previous behavior. Approximation field scenes use the electrostatic/quasistatic tools; approximation wave presets retain the legacy wave solver. Switching approximation off selects the **experimental Maxwell scene solver**. Unsupported configurations fail visibly rather than falling back to static fields.

The experimental path evolves Maxwell fields for specified models. It is not a completed, universally validated moving-material, circuit and mechanics solver. The [implementation plan](superpowers/plans/2026-10-24-full-maxwell-fdtd.md) retains acceptance requirements beyond the current code and measurements.

## Approximation: electrostatics and magnetostatics

Open charge-only scenes superpose analytic Coulomb fields, charged sphere/shell formulas and uniform external E in `electrostatics/analytic.ts`. Point-charge visualization uses a 0.2 mm softening length. Conductors, dielectrics or grounded boundaries select the multigrid finite-volume Poisson model:

```text
div(epsilon_r grad(phi)) = -rho / epsilon_0
E = -grad(phi)
```

Geometry/interfaces are staircased; point charge uses cloud-in-cell deposition. Fixed conductors impose equipotential regions. Floating conductor potentials follow a numerical capacitance matrix and prescribed net charges. Capacitance depends on geometry, resolution and finite boundary. Grounded box fixes outer phi to zero. Open + external E supplies bare-source potential minus `E_external · r` on the faces; truncating induced multipoles makes this an approximate open boundary.

`magnetostatics/biotSavart.ts` integrates regularized current segments. Wires share their sampled curve with the viewport. A uniformly magnetized cylinder uses 16 equivalent surface-current loops with `K_b = M × n`; this is not a hysteresis, saturation, demagnetization or micromagnetic model. Static B uses vacuum permeability; dielectric permeability/conductivity do not modify this approximation. Open filaments omit return paths. Inductance uses thin-wire/long-solenoid formulas.

Moving-source overlays apply those solutions instantaneously at prescribed poses. `L/(cT) ≪ 1` and `v/c ≪ 1` are useful checks, but neither guarantees that omitted inductive E, eddy currents or circuit feedback are negligible. The appropriate reduction depends on the observable and electrical configuration.

## Approximation: induction and test particles

`induction/system.ts` differentiates numerical loop/coil flux linkage for `EMF = -dPhi/dt`, or integrates `(v × B) · dl` for a moving wire. Coils use central loop area times turns. Oscillation, arbitrary-axis spin and keyframes are authored kinematics. There is no passive circuit-current solve or feedback. E probes show the electrostatic contribution; EMF alone does not reconstruct spatial nonconservative E. Propagation/radiation is omitted.

Legacy particles are nonrelativistic Boris **test particles**. They feel the initial analytic/Biot–Savart source snapshot and uniform fields, but do not source fields, use conductor/dielectric Poisson fields, or follow moving-source fields. Wall reflection/damping and capped adaptive stepping are modeling choices. Particle time maps one wall second to 200 ns at 1×; prescribed induction maps it to one second. Mixed legacy animation therefore has no coupled physical clock. Prescribed particle motion replaces its Boris orbit. Explicit force-driven source-body overrides require Maxwell mode and otherwise give an error; legacy particles without overrides remain available.

## Legacy wave presets

With approximation retained, `fdtd/fdtd3d.ts` advances Yee-style Faraday and Ampere–Maxwell curl updates for prescribed wave sources, stationary linear isotropic nondispersive epsilon/mu/conductivity and PEC masks. Its graded impedance-matched absorbing sponge is **not CPML**. Source injection and display interpolation follow legacy conventions; static charge, particle, magnet and current-filament gadgets are not coupled into that solver. These restrictions apply to that path, not to every Maxwell calculation in the app.

## Experimental Maxwell kernel and clock

`engine/maxwell/yee.ts` stores Float64 electric/current components on edges, magnetic components on faces and charge on nodes. Compatible curl/divergence operators advance fields and nodal charge. `deposition.ts` deposits finite cloud-in-cell charge trajectories with matching discrete continuity. The adapter supplies current from its source/matter models; runtime E/B come from field evolution, without an independent Biot–Savart overlay added to the answer.

Field steps, source trajectories, source particles and runtime body poses share physical dt. The dedicated browser worker returns step, time, generation, probes, transforms and diagnostics. Rendering consumes accepted frames rather than driving a second wall-clock Maxwell motion oscillator. Restart invalidates old generations, including replies already in flight.

The core supports stationary linear isotropic nondispersive materials, conductivity, PEC closure and CPML with CFL/material validation. The scene adapter currently accepts PEC/CPML and rejects periodic scenes pending initialization/transport validation. Core/native-reference periodic tests do not enable arbitrary periodic source scenes.

Initialization prepares electrostatic E/charge with finite-domain boundary/electrode conditions. External B is the initial uniform B. Impressed currents start at t = 0 and generate a transient. Static initial E with suddenly assigned velocity and no compatible magnetic/source history is not an established uniformly moving solution. Capturing a prepared static background for CPML does not establish an exact isolated DC boundary for every configuration.

## Experimental source and matter models

| Object/model | Current behavior | Important limit |
| --- | --- | --- |
| Point charge / source particle | Grid-scale cloud-in-cell charge and conserved trajectory current; prescribed or field-driven motion | Finite shape, not continuum point self-force or separate radiation reaction. Closed deposition-domain exits are rejected. |
| Sphere/shell | Distributed charge samples: four radial shells for a solid, 48 angular samples per shell | Quadrature and grid require refinement; no analytic sphere formula during Maxwell evolution. |
| Wire/loop/coil | Stationary impressed current, or explicitly selected resolved passive conducting material | Passive wires share the finite-conductivity body model. Diameter must span three cells; no automatic enlargement or separate-body electrical contact. Impressed filaments cannot move. |
| Electric point source / antenna | Current deposition; amplitude in amperes | Magnetic point-current components and moving driven sources are rejected; no general calibrated port. |
| Plane-wave gadget | Fixed x-normal current sheet; amplitude specifies an E scale; radiates both ways | Authored +x sheet orientation only, not a one-way TFSF source. |
| Stationary dielectric | Staircased linear epsilon_r, mu_r and conductivity | No dispersion, hysteresis or general moving constitutive response; moving dielectrics are rejected. |
| Conductor | Initialized isolated charge, finite conductivity and transported body-owned charge | Not a moving PEC, voltage supply or validated arbitrary moving interface. |
| Permanent magnet | Prescribed laboratory-shape impressed polarization/magnetization, including motion | No force-driven magnet, rest-shape contraction, hysteresis or internal magnetic relaxation. |

### Open initial fields

For fully absorbing boundaries and the open electrostatic selector, preparation now solves a self-consistent Coulomb outer potential, including induced electrode charge and dielectric polarization. A restarted GMRES boundary solve wraps the compatible interior Poisson operator; its true residual must converge. Floating-electrode background and unit-voltage solves use that same operator. The charge-independent quadrupole tree has a separate spatial error: the default opening criterion measured maximum normalized error 8.2e-5 on the documented neutral test cloud. This is a one-time numerical initial solve; playback never reapplies electrostatics. PEC walls and explicitly grounded preparation retain their physical finite-boundary conditions. Mixed PEC/PML initialization is not a general free-space Green solve.

### Isolated finite-conductivity electrodes

The user must choose **Initialize plate voltages, then isolate**. Fixed potentials prepare initial charge; floating objects prepare net charge through a capacitance solve. The voltage constraint is then removed. No hidden battery, voltage clamp, supply wire or return path is introduced.

The selected lab/rest-frame finite-conductivity law is:

```text
J_body = rho_body v + sigma gamma [E + v × B - v(v · E)/c²]
```

Conductive edges join resolved material nodes. Body-owned charge is transported through matching discrete divergence, not deleted when voxel membership changes. Geometry is staircased and charge advection upwind. The explicit update requires `sigma gamma dt / epsilon_0 ≤ 0.45`; excessive conductivity gives an error without a hidden cap. The default 0.01 S/m is a demonstration parameter, not a claim to model copper or an ideal conductor at coarse resolution.

Moving-capacitor regressions check magnetic response, replay and charge constraints. They do not establish moving-PEC boundary accuracy, moving-mirror frequency/amplitude, general moving skin response or convergence of arbitrary rotating boundaries. Those remain separate validation requirements.

### Impressed permanent magnets

`magnetization.ts` treats the cylinder as the instantaneous **laboratory shape**, with a grid-scale smooth surface transition. It evaluates the selected local Lorentz transformation of impressed rest magnetization with zero rest polarization, using material-point velocity. It deposits compatible `curl M` and `dP/dt` current and initial bound polarization charge. Prescribed translation/rotation shares field time with subluminal material-point checks.

This is an externally maintained source, not a globally Lorentz-contracted rigid rest body under arbitrary acceleration. Elasticity, hysteresis, saturation, demagnetization dynamics and force feedback are absent. Macroscopic readouts include `D = epsilon E + P` and `H = B/mu - M`; background-field energies omit the prescribed magnets' internal/source energy.

### Force-driven motion

Fixed mode represents an external support; prescribed mode represents a mechanical drive. Authored initial data survives mode changes. Point charges/source particles use a relativistic staggered momentum pusher, field gather and conserved trajectory current on the field dt. Existing particle mass/velocity supplies initial data unless explicitly overridden. Prescribed mode without a trajectory stays at the authored initial pose; inactive stored velocities do not affect fixed or prescribed bodies. The force gather averages edge E and synchronized face B onto charge nodes, then uses the same CIC weights as charge deposition. A stationary isolated charge regression checks that its own mesh field does not cause artificial acceleration. This gather differs from a point probe, which interpolates each native Yee component directly.

Charged spheres and finite-conductivity bodies use experimental classical rigid-body force/torque integration, mass, principal inertia and initial linear/angular velocity. Translation beyond `0.01c` is rejected for that mechanics model. Controls do not establish a validated relativistic extended-body or isolated-body momentum model. Complete field/body/source/support energy and momentum accounting, prescribed-drive work and general self-force convergence remain incomplete. Individual work/loss diagnostics are not a closed global ledger.

## Probes, resolution and physical time

Full-mode probes return E/B and available D/H/J and deposited nodal charge density in SI. J includes the deposited contributions used by the field update. In impressed-magnet configurations rho includes bound polarization charge, so it is not exclusively free charge. B is synchronized to the electric sample time; each component is interpolated from its Yee location. Recentring/interpolation remain numerical approximations, especially at interfaces.

A unique electrostatic phi cannot describe full evolving E; full-mode potential is not displayed as a computed zero. Poynting uses `E × H`. Linear-background field energies do not include magnet internal energy or complete mechanical/feed work.

Resolve charge width, sphere/plate thickness, motion and source bandwidth, including startup. Abrupt point-current/velocity starts can produce persistent grid ringing. Smooth ramps help but do not replace spatial/time/domain/absorber refinement. Small B can reflect symmetry, physical scale or causal travel time; dramatic field lines do not measure accuracy.

Frequencies, velocities and c are never silently rescaled. With cubic `dx = 0.01 m`, vacuum CFL 0.9 gives `dt ≈ 1.73e-11 s`: about `5.77e10` steps per physical second. A 1 Hz full-wave mechanical cycle can be prohibitively costly. Steps per frame changes pacing, not dt or authored frequency.

## Replay, editing and local execution

**Rewind to t = 0** pauses and reinitializes the current definition, clearing runtime trails/charts while preserving edits, selection and undo history. **Replay** reinitializes it and starts. **Restore preset** separately restores the library definition and can be undone; it is disabled for custom scenes. Display/probe edits do not advance field time. Physics changes initialize a new run; generations prevent old worker results replacing it.

Poisson and both FDTD paths already run in local browser Web Workers. Legacy approximation particle/motion/EMF stepping remains on the main thread; experimental supported motion/particles run in the field worker. Rendering uses WebGL. Hosting delivers assets rather than computing fields. Offline Meep does not serve browser sessions. No WebGPU Maxwell backend is currently validated.

**Conservative memory budget** is the solver's admission estimate, not measured live allocation, peak memory or browser RSS. [CPU performance](maxwell-performance.md) separately records retained buffers, preparation, stepping and sampling, with Node/browser worker/transfer/render distinctions.

## Measured evidence and remaining work

- [Core validation](maxwell-core-validation.md): specified Fresnel electric amplitudes, stationary PEC frequency, stationary conductive attenuation/loss and normal/30-degree CPML reflected amplitudes, with stated refinement/exclusions. Stationary optics does not validate moving media.
- [Native Meep](maxwell-meep-validation.md): actual Meep 1.35.0 vacuum and epsilon_r = 4 periodic standing waves at 32/64/128 cells. Maximum selected CPU/Meep RMS is `2.51e-16`; independent continuum errors decrease approximately fourfold with doubled resolution. Matching discrete updates is distinct from continuum accuracy. These cases exclude charge, PML, interfaces, moving bodies and browser execution.
- `tests/maxwell/moving-fields.test.ts`: a `1e-10 C` grid source ramps along x through a sampled smooth 1 ns velocity ramp to `0.01c`. At approximately 4.008 ns, the field at `(0, 0.25, 0)` is compared with the uniform-velocity charge field after the startup pulse passes. The source begins from electrostatic preparation, not an assumed moving steady state.

| Requested resolution | Relative E error | Relative B error |
| --- | --- | --- |
| 16 | 12.52% | 7.15% |
| 32 | 2.31% | 1.82% |
| 64 | 0.55% | 0.676% |

That selected charge benchmark's normalized Gauss residual is below `3e-15`. These errors apply to its history, finite-grid shape, point, time and boundary setup away from the source. They are not universal sub-percent claims. Abrupt starts produced unresolved ringing and are not interchangeable with this ramped benchmark.

Replay/browser tests check authored-data preservation, worker generations, frame/probe/pose timing, explicit conductor setup and readouts. They do not establish physical correctness merely from finite fields or visible B. Moving PEC/mirror validation, general moving media, explicit voltage feeds, quantitative passive-circuit feedback, a closed energy/momentum ledger and CPU/WebGPU parity remain outstanding plan requirements.
