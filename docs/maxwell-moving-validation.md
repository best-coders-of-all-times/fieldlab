# Moving-source validation status

The current CPU scene adapter evolves E and B from currents with the Yee Maxwell kernel. This document separates measured source accuracy from the remaining moving-material and mechanics work.

## Charge in uniform translation

Run `npm test -- tests/maxwell/moving-fields.test.ts --silent=false`.

The test uses a 1 m cubic vacuum region with eight CPML cells on each side, Float64 storage, CFL 0.9 and charge 1e-10 C. A prescribed trajectory raises the velocity smoothly from zero to 0.01c during 1 ns, using a cosine velocity ramp represented by 101 position keyframes. It then translates uniformly. Initial E comes from the consistent electrostatic preparation and initial B is zero. No analytic magnetic field is added during the run.

The probe is at (0, 0.25, 0) m. After the startup pulse has passed, at 4.0081403507 ns, E and B are compared against the continuum uniform-velocity point-charge field, using the instantaneous source position. The finite CIC source and finite domain contribute numerical error. The analytic reference is used only in the test.

| Longest-axis cells | Relative E error | Relative B error | Relative Gauss residual |
| --- | ---: | ---: | ---: |
| 16 | 12.5245% | 7.1474% | 1.36e-15 |
| 32 | 2.3093% | 1.8174% | 1.86e-15 |
| 64 | 0.5500% | 0.6761% | 2.42e-15 |

The measured errors improve with refinement. This is one source trajectory, probe, time and boundary setup; it does not establish a universal accuracy bound. Starting a mesh-scale point current abruptly created strong grid ringing, including a 29% B error in an early 32-cell sample. Such a discontinuity has unresolved high-frequency content. The smooth startup is part of the benchmark's physical source history, not a change applied secretly to user trajectories.

## Co-translating isolated capacitor

Run `npm test -- tests/maxwell/moving-conductor.test.ts`.

The defined case has a 1 m cubic physical domain; plates centered at x=+/-0.1875 m with size (0.125, 0.45, 0.5) m; initial potentials +/-3 V; conductivity 0.01 S/m. Preparation solves the self-consistent open initial state, then isolates the plates. Both plates accelerate smoothly during 1 ns to +y speed 0.001c, using the same cosine velocity ramp as the moving-charge test. After startup, the central probe compares B_z to -v E_x/c^2. This low-speed relation uses the measured evolved E; no analytic B is supplied to the integrator.

Physical absorbing-layer thickness is held at 0.1875 m while the field spacing is refined. The test samples all grids at 4.0081403507 ns.

| Cells across 1 m | PML cells per side | Relative magnetic relation error | Relative Gauss residual |
| --- | ---: | ---: | ---: |
| 16 | 3 | 1.23110% | 3.44e-16 |
| 32 | 6 | 0.561818% | 5.46e-16 |
| 64 | 12 | 0.329387% | 7.56e-16 |

The coarse case misses the 1% target; the finer cases pass and improve. A separate domain study enlarges the physical box from 1 to 1.5 m at fixed h=0.0625 m and the same physical PML thickness; the coarse error decreases from 1.2311% to 0.7049%. This distinguishes mesh and boundary effects. It remains a selected low-speed, finite-conductivity case, not a universal error guarantee. Changing-gap/fed capacitors and arbitrary rotation need their own validation.

The initial conducting node/edge graph is carried with each body. Edge charge transfers use deposition-adjoint electric line integrals and the declared covariant Ohm response; both transfer and body convection deposit compatible CIC trajectories. Rebuilt body-owned density agrees with its deposited current divergence. Rewind restores material charge as well as fields, CPML history and rigid-body state. Passive loop regressions check zero injection of saved impressed current and the sign opposing increasing linked magnet flux.

Two defects were reproduced before these changes. Open preparation omitted induced electrode multipoles, imposing zero potential at the finite backing box for plate-only scenes. A binary Eulerian conductivity mask also remained fixed during subcell motion and screened charge toward old grid surfaces, producing a 39% error at about 6 ns in the wider-gap case. The open boundary and body-carried conducting graph address these separately. The later-time regression retains this previously failing geometry.

## Open preparation and numerical acceleration

For fully PML/open scenes, physical vacuum-equivalent charge epsilon_0 div_h E supplies the exterior Coulomb potential. This includes induced electrode charge and dielectric polarization, and excludes backing-wall charge. Restarted GMRES solves boundary self-consistency to a checked relative residual of 1e-7. Floating-electrode background and unit-potential solves use this same operator.

A charge-independent quadrupole tree accelerates the initial boundary sums. Its default geometric criterion measured maximum normalized error 8.19e-5 against direct sums for 3,362 neutral signed sources and 31,104 targets. This spatial error is separate from the linear solve residual. Geometry-only opening decisions preserve superposition; no potential solve is reapplied during playback. The continuum Coulomb boundary on grid charge still has discretization error relative to an infinite discrete lattice.

## Force and stability scope

Particles use charge-compatible node averaging of synchronized fields and staggered relativistic Boris momentum. A resting isolated off-grid CIC charge (q=1e-10 C, mass=1e-20 kg) formerly acquired about 39 m/s in one step from inconsistent point gathering; the regression now requires below 1e-3 m/s. This is a finite-source mesh check, not continuum radiation-reaction validation.

Conducting-node charge gathers Lorentz force with the same momentum-compatible shape; edge currents contribute I dl cross B. Distributed charged bodies gather their charge-element forces. Rigid mechanics uses body-local inertia and quaternion Newton-Euler integration. Force-driven material-point speeds beyond 0.01c are rejected, including rotational velocity. Neutral material nodes receive speed validation too. Charge-reversal and torque-free refinement tests check selected responses; complete coupled field/body/source energy and momentum acceptance remains outstanding.

The explicit conductive response checks the actual gather/deposition row bound with the wave CFL and fastest stationary material speed. Separate bodies sharing unresolved current support are rejected. These are numerical admission checks, not a proof of all moving-material energy behavior. The scene model is finite conductivity, not moving PEC or real-metal dispersion. The independently tested planar moving-interface experiments are described in [the material report](maxwell-moving-material-validation.md); those Eulerian prototypes do not certify the body-carried scene graph at high speeds.

The scene solver remains experimental pending the remaining general moving-matter, feed, force/momentum and backend acceptance requirements in the approved plan.


## Normal sheet motion and changing electric fields

A reduced-dimensional reference in `tests/maxwell/normal-moving-planes.test.ts` evolves two finite-width charge sheets moving apart along their normals. Uniform periodic transverse directions represent infinite planes; this is a charge-source Maxwell reference, not a finite-conductor or moving-mirror acceptance case. The physical cubic-spline width is fixed at 0.025 m, surface charge is +/-1 nC/m^2, initial centers 0.3/0.7 m and imposed speeds -/+0.01c. Actual native charge/current are advanced for 20 field steps on 65 longitudinal nodes.

For normalized longitudinal density f and its cumulative F, the continuum reference is

```text
rho = sigma [f(x-a(t)) - f(x-b(t))]
Jx = sigma [a_dot f(x-a(t)) - b_dot f(x-b(t))]
Ex = sigma/epsilon0 [F(x-a(t)) - F(x-b(t))]
Jx + epsilon0 dEx/dt = 0
B = 0
```

The native endpoint-conserving current enforces the same cancellation. The test verifies changing E (over 1 V/m at some locations), deposited-charge consistency, convection/displacement cancellation, exact zero B and the electric energy/current-work balance. Thus a changing electric field does not alone require nonzero B: Ampere-Maxwell depends on the sum of conduction/convection and displacement currents. Motion direction, finite edges and source history matter. The existing transverse co-translation capacitor benchmark and finite conducting scenes still require their own magnetic-response validation.
