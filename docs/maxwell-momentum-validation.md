# Physical Maxwell momentum and surface-stress audit

The actual smooth-source solver shows decreasing momentum residuals under the selected mesh refinement, but a remaining spatial and placement-dependent floor. Time refinement does not remove that floor. These measurements do **not** establish full M6 momentum acceptance, an exact discrete momentum invariant, torque conservation, or passive-body feedback acceptance. The previously measured isolated-cloud mesh self-force remains a separate limitation.

The maintained [audit script](../scripts/audit-maxwell-momentum.mjs) imports the current `MaxwellSceneSolver` through Vite SSR, advances its fields and force-driven sources, and independently integrates physical field momentum and Maxwell stress. It does not modify the solver, project momentum, subtract initial stress, or substitute analytic fields during evolution. Exit 0 means measurements completed, including explicitly excluded boxes; it is not conservation acceptance.

## Reproduction and provenance

From the repository root with installed Node/Vite dependencies:

```powershell
node --check scripts/audit-maxwell-momentum.mjs
node scripts/audit-maxwell-momentum.mjs --quick --json artifacts/maxwell-momentum-quick.json
node scripts/audit-maxwell-momentum.mjs --study all --json artifacts/maxwell-momentum-fixed-box.json
```

The default mesh study runs two variants at resolutions 16, 24 and 32. `--study all` adds factors two and four of time refinement at resolution 32, reusing the baseline row: ten distinct cases. `--quick` selects resolution 16 for the mesh study; time studies still use the explicitly selected/default `--time-grid`. Physical box half-extents stay fixed across mesh refinement. Arbitrary box endpoints are supported, including endpoints not aligned with mesh planes.

Additional targeted commands:

```powershell
node scripts/audit-maxwell-momentum.mjs --study time --variant asymmetric --time-grid 32 --time-factors 1,2,4 --json artifacts/maxwell-momentum-time.json
node scripts/audit-maxwell-momentum.mjs --variant asymmetric --grids 32 --half-extents .4375,.46875 --quadrature both --json artifacts/maxwell-momentum-quadrature-boxes.json
node scripts/audit-maxwell-momentum.mjs --quick --variant asymmetric --half-extents .375,.4375,.46875 --json artifacts/maxwell-momentum-support-quick.json
node scripts/audit-maxwell-momentum.mjs --grids 48 --json artifacts/maxwell-momentum-48.json
node scripts/audit-maxwell-momentum.mjs --help
```

`--width` is a fixed physical source width, default 0.075 m. `--shift` sets the translated pair's x displacement, default 0.013 m. `--half-extents` accepts centered cubic integration surfaces in metres. `--quadrature both` compares all midpoint/exact volume and surface combinations. JSON paths must be inside ignored `artifacts/`. Output records arguments, physical parameters, individual mechanical/field momenta, stress impulses, exclusions, Git HEAD/status, Node/platform and SHA-256 hashes of engine/scene sources, dependencies and the audit script. Before/after hashes populate `sourceChangedDuringRun`; a changed HEAD alone is recorded separately. A run whose sources change cannot be treated as a single-revision measurement. The Vite middleware server does not open an application HTTP port.

The ten-case fixed-box command above completed on 2026-10-24 with Node v24.19.0 on Windows, branch `feature/maxwell-engine`, HEAD `034b8b854028c27634a9503b80237361fab600ea`. No hashed source changed during execution. That run's solver SHA-256 was `8b3fc7194bfc7b2f6553ec1d7e1aca5fc059928ed55ff05091bc93a3fb07d9f4`; the JSON retains all other hashes and working-tree state. The two-row initial quick run also reproduced the coarse-grid values, with unchanged source hashes across a parent commit.

## Physical model and balance

Both cases use a 1 m vacuum cube, Float64 fields, four PML cells per side, open Coulomb initialization, initially resting force-driven sources and no imposed external E/B or feeds. The production smooth profile is the lab-axis separable cubic B-spline density with width 0.075 m and physical support extending twice that width along each axis. Its width is independent of mesh spacing. This density is a chosen finite charge model; these results do not transfer to the legacy CIC point or uniform-sphere model.

Centers start at x = -0.2 and +0.2 m. The left charge/mass are 1 nC and `1e-23 kg`. In the asymmetric case, the right charge is -0.8 nC and its mass is `1.2e-23 kg`. In the translated symmetric case the right charge is -1 nC, the masses match, and both centers move initially by +0.013 m along x. Both evolve for 0.3 ns. Baseline grids 16/24/32 take 4/6/8 steps, giving dt = 75/50/37.5 ps; time-refined runs reach the same final time exactly.

The audit measures

```text
Pfield = epsilon0 integral_V E cross B dV
Tij = epsilon0 (Ei Ej - deltaij |E|^2/2)
      + (Bi Bj - deltaij |B|^2/2)/mu0
R = delta(Pmechanical + Pfield) - integral_0^t integral_boundary(V) T n dA dt
```

Here `n` points outward. The sign follows the local Maxwell momentum identity `f_L = div(T) - d(epsilon0 E cross B)/dt`: outward stress traction equals the rate of change of matter plus field momentum. Defining an outgoing momentum-flux tensor would introduce the opposite sign. The audit consistently uses stress traction.

Particle momenta are stored at half time steps. At initial/final integer times the audit estimates synchronized mechanical momentum using the actual `sampleSourceForForce` profile gather and a local Boris half kick. Initial resting momenta cancel the initialization back kick to roundoff. This synchronization is an estimate with temporal truncation error, not a new implicit particle integration algorithm. The field B samples use the solver's integer-time `synchronizedB` reconstruction.

All percentages use the **fixed** reference impulse

`Iref = (1 nC)^2 * (0.3 ns) / (4*pi*epsilon0*(0.4 m)^2) = 1.68516596105e-17 kg m/s`.

It does not depend on the small measured net momentum, the asymmetric charge product, or a cancellation between field and particles. Reported residuals are vector norms.

## Reconstruction and closed-surface requirements

Native Yee E and synchronized B components are independently trilinearly reconstructed at their staggered spatial offsets. Their interpolation knots occur at integers or half integers depending on the component and axis. Exact mode splits each integration axis at **every half-integer knot**, then uses two-point Gauss quadrature on each resulting interval. Each product in `E cross B` or Maxwell stress is at most quadratic per coordinate on a piece, so the tensor quadrature integrates the selected reconstructed fields to floating-point accuracy. For an aligned full cell this uses 64 volume samples; an aligned full face patch uses 16 samples. An unsplit Gauss rule would not have this polynomial exactness across staggered knots.

This is exact integration of a specified interpolation, **not** exact evaluation of the underlying continuum fields or an exact discrete Yee conservation law. The solver's field-only energy identity uses a different native discrete functional. This physical momentum integral need not obey an algebraically exact stencil identity. Midpoint mode is retained to expose reconstruction and quadrature sensitivity, not as a substitute acceptance result. Surface traction is sampled at every integer time and integrated with the trapezoidal rule; time quadrature remains approximate.

The default physical integration box is `[-.4375,.4375]^3 m` on every grid. The script conservatively checks the actual production `smoothChargeWeights`: every strictly positive assigned nodal weight contributes its complete nodal dual cell, extending half a grid cell in each direction. It tracks their union at every drift endpoint. A box intersecting that support is excluded because the script adds the entire source mechanical momentum, rather than a partial continuum matter momentum. It also requires one ordinary Yee cell before the physical PML interface. These checks deliberately retain arbitrarily small positive assignment tails and do not use a density threshold.

For example, at resolution 16 a half-extent of 0.375 m can enclose the nominal continuum density while cutting assigned nodal dual support, which extends to 0.40625 m. Such a surface is excluded. Half-extent 0.46875 m at that resolution fails the ordinary-cell PML margin. Neither excluded case provides closed-reference acceptance evidence. The default box has a positive assigned-support clearance throughout each measured run.

## Fixed-volume measurements

The following data come from `artifacts/maxwell-momentum-fixed-box.json`, generated by the maintained script and command above. Both volume and surface rules are exact piecewise reconstruction quadrature, and the physical half-extent is 0.4375 m throughout.

| Variant | Grid | Steps | Residual norm (kg m/s) | Percent of fixed Iref |
| --- | ---: | ---: | ---: | ---: |
| Asymmetric | 16 | 4 | 8.72253e-20 | 0.51761% |
| Asymmetric | 24 | 6 | 1.05003e-20 | 0.06231% |
| Asymmetric | 32 | 8 | 5.66457e-21 | 0.03361% |
| Translated symmetric | 16 | 4 | 1.20320e-19 | 0.71399% |
| Translated symmetric | 24 | 6 | 4.72555e-20 | 0.28042% |
| Translated symmetric | 32 | 8 | 1.15563e-20 | 0.06858% |

Refinement improves these selected cases, with placement-dependent rates. Three meshes and two placements do not establish a universal convergence order or a general accuracy bound.

At grid 32, holding the physical box and final time fixed:

| Variant | dt (ps) | Steps | Residual norm (kg m/s) |
| --- | ---: | ---: | ---: |
| Asymmetric | 37.5 | 8 | 5.66457e-21 |
| Asymmetric | 18.75 | 16 | 5.60227e-21 |
| Asymmetric | 9.375 | 32 | 5.58667e-21 |
| Translated symmetric | 37.5 | 8 | 1.1556284e-20 |
| Translated symmetric | 18.75 | 16 | 1.1556651e-20 |
| Translated symmetric | 9.375 | 32 | 1.1556743e-20 |

The remaining residual is not removed by smaller dt. This differs from the smooth-source energy budget's measured time refinement, documented in the [coupling audit](maxwell-coupling-validation.md).

## Initial stress, surface extent and limitations

The initial Coulomb tails cross the integration surface. At grid 32 in the fixed box, the asymmetric initial x stress impulse is `-7.89415346e-21 kg m/s`; the complete time integral is `-7.89416297e-21`. The translated symmetric values are `9.13855297e-21` initially and `9.13864621e-21` after time integration. The dynamic change is much smaller than the initial contribution in these short runs. The JSON records both, but **the complete initial stress is retained in R**. Subtracting it would alter the momentum budget rather than validate it.

The reconstructed electrostatic net traction is not zero even though these are isolated, all-source configurations. Its grid and surface dependence indicates discretization/reconstruction error in the static initial state and stress diagnostic. A box outside all sources is still a finite spatial reconstruction, not a continuum proof that these numerical contributions vanish. Ignoring them, or treating all static tails as absent because no newly radiated disturbance has arrived, is invalid.

The targeted quadrature/extent command above also completed on the same HEAD with unchanged source hashes. For the asymmetric grid-32 baseline:

| Box half-extent (m) | Volume rule | Surface rule | Residual norm (kg m/s) |
| ---: | --- | --- | ---: |
| 0.4375 | Midpoint | Midpoint | 5.41440e-21 |
| 0.4375 | Midpoint | Exact | 3.97446e-22 |
| 0.4375 | Exact | Midpoint | 1.14764e-20 |
| 0.4375 | Exact | Exact | 5.66457e-21 |
| 0.46875 | Midpoint | Midpoint | 6.00560e-21 |
| 0.46875 | Midpoint | Exact | 2.45594e-21 |
| 0.46875 | Exact | Midpoint | 1.20676e-20 |
| 0.46875 | Exact | Exact | 8.51794e-21 |

The much smaller mixed-rule result in the first box comes from cancellation between different reconstruction quadratures. It is not stronger conservation evidence. The two exact-rule boxes also disagree at this finite mesh. Their comparison keeps both extents physical and enclosed, rather than silently moving the integration volume as the mesh changes.

The targeted quick support command completed with the 0.375 m and 0.46875 m boxes excluded for the reasons above, while the valid 0.4375 m result reproduced `8.72253e-20 kg m/s`. Syntax checking and these measured commands returned exit 0. They verify reproducibility and guards; they do not turn the residuals into a passing M6 test.

The isolated smooth source already has measured mesh self-thrust, recorded with two translation phases in the [coupling report](maxwell-coupling-validation.md). Energy-compatible instantaneous spatial gathering does not give exact translational invariance on the finite grid. The present pair residual combines force/gather discretization, initial-state spatial error, reconstructed field momentum/stress, time integration and particle synchronization; this audit does not uniquely assign each contribution. It must not hide self-thrust behind a favorable energy result or a small cancellation at one surface.

Further acceptance needs independent initial-static traction and force/field momentum convergence across fixed physical volumes, additional mesh/placement/domain studies, and a justified discrete or continuum momentum-error analysis. Stress and volume quadrature must be held consistent. Torque/angular momentum, finite bodies, passive material feedback and general prescribed/force-driven configurations remain outstanding. No physics correction is introduced by this audit.
