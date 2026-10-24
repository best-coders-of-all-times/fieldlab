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

## Conductors and mechanics

Scene regressions check that a prepared stationary capacitor does not produce a spurious magnetic transient over 100 steps, while transported electrode charge produces a nonzero magnetic response with the expected orientation. Each conductor owns a distinct charge array, and its current advances both that array and total Maxwell charge with the same discrete divergence. A regression injects independent charge beside a moving conductor and verifies that the conductor does not entrain it.

The selected material is explicitly finite conductivity with a local rest-frame Ohm law and conserved, first-order upwind charge transport. It is not a moving PEC boundary or a model of real-metal frequency dispersion. Staircase interfaces, transport diffusion, conductivity/time-step stiffness and finite initial preparation require refinement studies.

Particle forces use synchronized fields and staggered relativistic Boris momentum. Distributed charged bodies gather Lorentz force from their charge elements. Rigid mechanics uses nonrelativistic Newton-Euler equations with body-local principal inertia and quaternion orientation; a focused torque-free test checks improving world angular momentum under time refinement. These tests do not yet establish the complete coupled field/body energy and momentum budget.

The full plan's moving-capacitor quantitative limit, moving-mirror frequency/amplitude benchmark, passive induction feedback, boundary flux accounting and general force-coupling acceptance remain separate requirements. The scene solver remains experimental while those requirements are unresolved.
