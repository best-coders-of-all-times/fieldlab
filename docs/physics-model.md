# FieldLab physics model and execution

FieldLab uses equations from classical electromagnetism with explicit model assumptions and numerical approximations. It does **not** solve a fully coupled, general Maxwell problem for every scene. An animated magnet's changing B overlay does not imply that the displayed E includes its induced electric field.

## Electrostatics

For an open scene containing only charges, `electrostatics/analytic.ts` superposes Coulomb fields, uniformly charged spheres/shells, and a prescribed uniform E. Point charges have a 0.2 mm softening length for field visualization; they are not mathematical singularities. Sphere formulas are exact without softening, but exterior sampling also uses that small regularization.

Conductors, dielectrics, or the Grounded box setting select `electrostatics/poisson.ts`. It solves

```
div(epsilon_r grad(phi)) = -rho / epsilon_0
E = -grad(phi)
```

on a finite node grid using multigrid. Charges use cloud-in-cell deposition; sphere charge is distributed over intersecting cells. Geometry and interfaces are staircased. The selected 48/64/96 cell resolution, solver tolerance and finite domain affect the result.

Fixed conductors impose an equipotential. Floating conductor potentials are determined from a numerical capacitance matrix and prescribed total charges, including charge induced by free sources and the applied boundary field. Capacitance is for the modeled finite geometry and boundary, rather than an exact isolated-body formula.

Grounded box fixes phi = 0 on the outer faces and screens an imposed external E. Open + external E uses the bare source potential minus E_external dot r on those faces. This approximates an isolated domain; it truncates the induced multipole field at the outer boundary. Enlarge the domain and compare resolutions to assess sensitivity.

These are the static reduction of Maxwell's equations, explained in [Feynman's electrostatics lectures](https://www.feynmanlectures.caltech.edu/II_04.html). The finite grid, softening and finite boundary are implementation approximations.

## Magnetostatics and moving sources

`magnetostatics/biotSavart.ts` evaluates the Biot–Savart integral with straight source segments, midpoint quadrature and a regularized denominator. Segment length is at most 3 cm; curved wires share a sampled Catmull–Rom centreline with the viewport. Each filament retains its own softening radius, normally 1.2 times its wire radius with a 1 mm minimum.

A permanent magnet is a uniformly magnetized cylinder, represented by 16 stacked equivalent surface-current loops. Each loop has current M times length / 16. Its side surface has K_b = M cross n, magnitude |M|; the end faces have zero bound current for axial magnetization. This uses a 6 mm regularization and is not a micromagnetic, hysteresis, saturation or demagnetization calculation. The gold overlay samples this surface-current direction; the mint arrow marks magnetization.

Static B assumes vacuum permeability. Changing a dielectric's mu_r or conductivity affects wave scenes, not this Biot–Savart calculation. Open straight wires represent prescribed current sections with their return paths omitted. Loop/coil inductance readouts use thin-wire/long-solenoid formulas, not a general mutual-inductance matrix.

Magnetostatics drops time derivatives in Maxwell's equations; see [Feynman's derivation](https://www.feynmanlectures.caltech.edu/II_13.html). Moving-source scenes apply that solution instantaneously at successive prescribed poses. This is a quasistatic approximation, with no retarded propagation or radiation.

## Induction and particles

`induction/system.ts` integrates B through pickup loops and differentiates flux linkage to obtain EMF = -dPhi/dt. Coils use their central loop area times turn count. Moving wires use the integral of (v cross B) dot dl. Motion can oscillate, spin about an arbitrary world axis, or interpolate timed position/rotation offsets. Keyframes are prescribed kinematics, not a mechanics solver. Repeating mismatched endpoints produces a discontinuity.

There is no circuit resistance/current solve, eddy current, induced-current feedback on B, radiation reaction or magnetic force feedback on moving objects. E probes in these scenes report the **electrostatic contribution only**. The spatial, nonconservative induced E is not reconstructed from Faraday's law. The full coupling is described by [Maxwell's equations](https://www.feynmanlectures.caltech.edu/II_18.html); reporting an integrated EMF does not supply that missing field solution.

Particles use a nonrelativistic Boris pusher. They are test charges and do not source fields. Their force uses the initial analytic E/Biot–Savart source snapshot and uniform external fields; it does not use conductor/dielectric Poisson fields or follow moving source fields. Particle walls reflect and damp velocity artificially. The adaptive step count is capped. Particle animation maps one wall second to 200 ns at 1x, while prescribed motion maps one wall second to one second. Mixed particle/induction scenes are therefore not a coupled common-time simulation. Assigning prescribed motion to a particle replaces its Boris trajectory.

## Wave scenes

`fdtd/fdtd3d.ts` advances discrete Faraday and Ampere–Maxwell curl equations with a Yee-style leapfrog finite-difference scheme. It includes linear, isotropic, nondispersive epsilon_r, mu_r and conductivity, PEC masks, and per-axis periodic/PEC/absorbing boundaries. Material readouts use B = mu H, electric energy epsilon |E|^2 / 2, magnetic energy mu |H|^2 / 2, and Poynting vector E cross H.

This is a numerical Maxwell curl solver, not an exact continuum solution. Grid dispersion, finite time steps, staircased materials, and interpolation affect accuracy. E/H samples share a display interpolation convention rather than exact space/time recentering of every staggered component. Source injection is prescribed: there is no self-consistent charge evolution, continuity enforcement or Gauss-law projection for arbitrary user sources. The plane-wave gadget is a fixed x-oriented electric source sheet, rather than an arbitrary-direction calibrated incident wave. Particle, static charge, current-filament and permanent-magnet gadgets are not coupled into FDTD.

The absorbing boundary is an impedance-matched graded sponge, **not CPML**. Reflections remain. Check convergence with resolution, keep many cells per wavelength (including the shorter wavelength inside materials), and use the documented linear material range. This is an educational simulator rather than a validated general engineering solver.

## Browser computation and hosting

All simulation code executes on the visitor's device. Poisson, field overlays and FDTD run in browser Web Workers. Particle stepping, prescribed motion and induction flux/EMF currently run on the browser's main thread. Rendering uses WebGL. Vite's development server serves files; it does not compute visitors' fields.

For deployment, run `npm run build` and host `dist/` on a static host/CDN with JavaScript worker support. Each visitor supplies their own computation; more visitors increase asset delivery traffic rather than a shared physics CPU load. Large scenes can still burden an individual visitor's CPU, memory and battery. Dynamic overlays use one outstanding worker frame and keep the latest pose rather than queuing every animation frame. Heavy solves can refresh more slowly than object animation.

An exact general-purpose upgrade would require one consistent electromagnetic model, charge-conserving sources and a common clock, dynamic materials/moving boundaries, circuit or particle coupling as needed, and convergence/validation for the intended experiments. Changing where the same code runs would not supply those missing physics.
