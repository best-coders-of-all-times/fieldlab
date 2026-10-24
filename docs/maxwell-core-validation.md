# Maxwell CPU kernel validation

Measured on 2026-10-24 with Node v24.19.0, Vitest 5.0.5, and the CPU `YeeSolver` using Float64 storage and SI units. These benchmarks exercise the kernel directly; they do not certify every scene adapter, moving-body model, browser backend, or the complete Maxwell migration.

Reproduce the measurements with:

```powershell
npm test -- tests/maxwell/benchmarks.test.ts --silent=false
npm test -- tests/maxwell/yee.test.ts tests/maxwell/initialization.test.ts
npx tsc --noEmit
```

The benchmark command prints its numerical results. Its six tests passed in the recorded run. The checks require accuracy or refinement of the measured observables, rather than only finite arrays.

## Dielectric interface: signed electric amplitudes

A unit-amplitude Gaussian `Ey` pulse starts at x = 0.35 m in a 1.6 m periodic 1D domain. Its envelope is `exp(-((x-0.35)/0.045)^2)`. Vacuum occupies x < 0.8 m; the transmitted material has relative epsilon 4 and relative mu 1. The initial `Bz` uses the vacuum impedance, the Yee face offset, and the negative half-step time. The short observation ends before waves wrap through the periodic boundary.

For normal incidence, continuity of tangential E and H gives electric reflection `r = (Z2-Z1)/(Z2+Z1) = -1/3` and transmission `t = 2 Z2/(Z2+Z1) = 2/3`. After `ct` is approximately 0.75 m, the separated pulse peaks are measured away from the material interface, using a three-point parabolic estimate. Error is absolute coefficient error divided by the magnitude of its analytic coefficient. These are electric amplitudes, not energy reflectance/transmittance. Fresnel comparisons are also described in the [Meep interface tutorial](https://meep.readthedocs.io/en/stable/Scheme_Tutorials/Basics/).

| dx (m) | nx | Signed reflection | Transmission | Reflection error | Transmission error |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0.005 | 320 | -0.3375791080 | 0.6655361145 | 1.27373% | 0.169583% |
| 0.0025 | 640 | -0.3343695070 | 0.6670206498 | 0.310852% | 0.0530975% |

The coarse reflected amplitude misses the 1% target. The fine grid meets it, with reflection error reduced by a factor of 4.10. The test retains the coarse result and requires this convergence; it does not assert that every resolution reaches 1%.

## PEC cavity frequency

A 1 m 1D cavity has PEC closure at x = 0 and x = 1 m, with periodic invariant transverse axes. Initial `Ey = sin(3 pi x/L)` excites the third mode. Its analytic frequency is `3c/(2L) = 449688687 Hz`. The magnetic initialization includes its spatial and temporal staggering. Linear interpolation of positive-going zero crossings over approximately ten cycles estimates frequency. No sampling at a conductor singularity or material interface is involved.

| dx (m) | nx | Measured frequency (Hz) | Relative error |
| --- | ---: | ---: | ---: |
| 1/24 | 24 | 449138330.410 | 0.122386% |
| 1/48 | 48 | 449551158.776 | 0.0305830% |

Both meet 1%, with error reduced by a factor of 4.00 under refinement. This validates a stationary PEC frequency, not a moving PEC interface.

## Finite conductivity: attenuation and energy loss

The attenuation case uses a 1 GHz electric-current sheet at x = 0.15 m, vacuum before x = 0.4 m, and a homogeneous material with epsilon = epsilon0, mu = mu0, and sigma = 0.1 S/m after that interface. A 0.08 m CPML surrounds a 1.2 m physical interval. A linear six-cycle source ramp is followed by continued harmonic driving; Fourier sums over the final ten of 36 cycles measure electric amplitude at x = 0.52 and 0.64 m, inside the material and away from its interface.

For the full conducting-wave dispersion relation, the exact attenuation is

```text
alpha = (omega/c) sqrt((sqrt(1 + (sigma/(omega epsilon0))^2) - 1)/2)
      = 15.2360152416 m^-1.
```

The estimator is `log(|E(0.52)|/|E(0.64)|)/0.12`. The displacement current is retained: this material is not evaluated using the good-conductor asymptotic skin-depth approximation. The physical attenuation length is `1/alpha`, approximately 0.06563 m. Conducting-wave and skin-depth relations are discussed in the [MIT electromagnetics notes](https://live.ocw.mit.edu/courses/6-013-electromagnetics-and-applications-spring-2009/d3be4ea78b036a6362230fb41780cf54_MIT6_013S09_notes.pdf).

| dx (m) | Measured alpha (m^-1) | Relative error |
| --- | ---: | ---: |
| 0.005 | 15.2500989045 | 0.0924367% |
| 0.0025 | 15.2395057373 | 0.0229095% |

Both meet 1%, with error reduced by a factor of 4.03. The integrated Ohmic losses are positive. Their raw joule values change with the transverse area of the single-cell 1D storage, so they are not compared across grids as an invariant.

A separate uniform-field periodic test isolates the loss ledger without boundary flux: `E(0)=2 V/m`, `sigma dt/epsilon0=1/40`, and 80 steps. The analytic electric decay is `2 exp(-2)`. Its relative field error is 0.0104171%, and `|(Ufinal + OhmicLoss)/Uinitial - 1|` is `1.24345e-14`. This validates the stationary constitutive loss update. It does not validate the scene adapter's separation of impressed, conducting, and mechanical work or a general outgoing-flux energy budget.

## CPML: reflected electric amplitude

The measurements below use the stated finite windows. The later [extended CPML audit](maxwell-pml-validation.md) finds a delayed normal-pulse reflection exceeding the 1e-3 target in this historical profile, then validates a correction to its physical-width scaling. Its report distinguishes old and corrected measurements and unresolved oblique late tails. These early-window tables are historical; they do not establish long-time absorption or complete M3 acceptance.

Reflection is measured with paired short and longer domains sharing the same initial incident packet, left PML, and probe. The longer domain places its significant far-boundary reflected pulse outside the observation window. Subtracting the probe fields removes the incident pulse and common initialization/propagation error. The reported quantity is the maximum reflected electric amplitude divided by maximum incident electric amplitude, not residual whole-domain energy. No static background is captured in these propagating-wave tests.

At normal incidence, the carrier wavelength is 0.14 m, the Gaussian width is 0.035 m, the packet starts at x = 0.3 m, and the probe is at x = 0.45 m. The short/long physical intervals are 1/1.8 m. Incident and reflected time windows are respectively `ct < 0.5 m` and `0.7 m < ct < 2 m`.

| dx (m) | PML cells per side | PML thickness (m) | Reflected amplitude / incident amplitude |
| --- | ---: | ---: | ---: |
| 0.005 | 8 | 0.04 | 7.03362e-4 |
| 0.005 | 16 | 0.08 | 1.31597e-5 |
| 0.0025 | 32 | 0.08 | 1.64690e-6 |

Increasing thickness lowers reflection; refining the same physical 0.08 m layer lowers it again. The finest selected case is below `1e-3` amplitude reflection.

The oblique case is a 2D TE packet (`Ez`, `Bx`, `By`) with a periodic 0.4 m transverse y interval. Its central wave vector has `ky=2 pi/0.4`, `kx=sqrt(3) ky`, giving a central angle of 30 degrees to the PML normal and wavelength 0.2 m. The finite packet has an angular spread. Its initialization superposes 121 exact vacuum Yee eigenmodes with Gaussian x-wave-number weights, including component offsets, discrete dispersion, and half-time magnetic phase. It does not rotate an arbitrary pulse and assume it remains divergence-compatible.

The packet center starts at x = 0.5 m, its Gaussian width is 0.25 m, and the probe is at x = 0.7 m. Short/long intervals are 1.6/2.6 m. The transverse complex Fourier coefficient isolates the periodic mode. Windows are `ct < 0.8 m` for incidence and `1.3 m < ct < 3.3 m` for reflection.

| dx = dy (m) | ny | PML cells per side | Thickness (m) | Reflected amplitude / incident amplitude |
| --- | ---: | ---: | ---: | ---: |
| 0.01 | 40 | 8 | 0.08 | 1.72082e-4 |
| 0.01 | 40 | 16 | 0.16 | 4.80845e-6 |

This selected oblique packet reaches `1e-3` and improves with thickness. It is not an angle/frequency sweep, grazing-incidence validation, or a demonstrated grid-convergence study at oblique incidence. These results also do not establish an exact isolated DC boundary condition. PML limitations and the need to check thickness are discussed in [Meep's PML documentation](https://meep.readthedocs.io/en/latest/Perfectly_Matched_Layer/).

## Scope of the evidence

The accompanying core tests separately check compatible Gauss constraints, conserved impressed-current charge evolution, nonuniform material conduction, vacuum/material wave speed and impedance, second-order smooth-wave convergence, material CFL validation, deterministic replay including CPML histories, static background preservation, and off-center electrostatic preparation.

Native Meep comparisons are documented separately in [the Meep validation report](maxwell-meep-validation.md). No WebGPU comparison, moving dielectric/PEC benchmark, arbitrary rigid-body momentum balance, skin response of a moving conductor, or universal browser-performance claim is included here. These CPU benchmarks validate the stated stationary kernel problems and selected absorbing-boundary pulses; the implementation plan's remaining milestones retain their own acceptance requirements.

## Finite-volume field energy balance

`fieldBalance.ts` checks the discrete Poynting theorem over one update in a box inside the ordinary Yee region. The balance includes outward boundary flux and work by **all** current used in Ampere, including deposited, implicit Ohmic and Drude current. Tests require relative closure below 1e-12 for a nonuniform driven/Ohmic/Drude field and below 1e-10 for the moving-capacitor scene.

The exact discrete field energy uses E at integer time and the product B_(n-1/2) dot B_(n+1/2), rather than claiming that the displayed centered physical-energy estimate is an exact invariant. Flux uses the corresponding discrete boundary product. CPML cells/PEC closure are excluded from the control volume. This optional validation copies E and is not imposed on every rendered frame. It treats carrier/body current work as transfer out of the field; it does not establish a closed mechanical/source/support energy or momentum budget.
