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

## Additional regression evidence

- A resting isolated CIC charge at x=0.01 m (q=1e-10 C, mass=1e-20 kg, 16 cells) previously acquired about 39 m/s in one step through an inconsistent point gather. Charge-node averaging with the same CIC weights now keeps the speed below 1e-3 m/s. This removes the demonstrated mesh self-force; it does not validate continuum point-particle radiation reaction.
- An off-center prepared charge in a PEC box remains below 1e-17 T over ten steps. Static preparation now uses the physical PEC wall potential even when the separate electrostatic boundary selector says open.
- Passive-loop regressions verify zero injection from a retained impressed-current setting and an induced current opposing increasing magnet flux. The latter checks sign and charge compatibility, not a complete loop-energy/Lenz-force convergence study.
- Two overlapping passive loops previously bypassed individual conductivity limits and grew from about 4e-10 J to hundreds of joules in 60 steps. Shared material edges are now rejected. A second regression checks the tighter combined wave/current stability limit in a mu_r=0.9 medium.
- Explicit prescribed particles without trajectories stay fixed; fixed modes ignore stored inactive velocities; force-driven particles ignore saved inactive trajectories.

A moving capacitor must be checked against both mesh and domain refinement. An exploratory 1 m box with ?3 V plates at x=?0.125 m, plate size (0.08, 0.5, 0.5) m, sigma=0.01 S/m, smooth 1 ns startup to 0.001c in +y, sampled at 4.008 ns gave B_z/(-v E_x/c?) relative errors 1.10%, 1.70%, 2.35% at 16/32/48 cells. Those numbers are **not a convergence pass**. A second geometry with a wider gap shows substantially larger errors. Open preparation currently truncates induced electrode multipoles at the finite outer boundary; staircase changes, diffusive transport and this finite-domain reference must be separated before claiming the translating-capacitor limit. Exploratory scripts/results remain under ignored artifacts; accepted benchmarks belong in tests with explicit geometry and tolerances.

## Open-boundary preparation correction

The finite-box omission described above has been corrected for fully PML/open scenes. The initial solve includes physical equivalent charge epsilon_0 div_h E (including dielectric polarization and induced electrode charge), excludes backing-wall charge, and solves a linear boundary Schur equation with restarted GMRES to relative residual 1e-7. Unit responses used by floating electrodes use the same operator. A charge-independent quadrupole tree accelerates potential sums; its default geometric criterion measured normalized max error 8.19e-5 against direct summation for 3,362 neutral signed sources and 31,104 targets. Tree error is separate from the linear residual. Fixed geometry/opening preserves superposition.

Re-running the first capacitor geometry after this correction gives magnetic relation errors 0.2503%, 0.00815%, 0.1676% at 16/32/48 cells at 4.008 ns. This improves that case but does not establish general moving-material acceptance. The wider-gap geometry (plate centers ?0.1875, width 0.125, height 0.45, depth 0.5 m) still gives errors about 30%, 24%, 21% at the same time, increasing later. Subcell material transport must be investigated; a binary conductivity mask can remain fixed while charge moves by a fraction of a cell. The earlier finite-boundary issue was real, but it was not the only moving-conductor limitation.
