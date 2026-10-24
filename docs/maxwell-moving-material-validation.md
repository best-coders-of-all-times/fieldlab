# Moving finite-conductivity interface validation

This report records a prescribed translating, finite-conductivity half-space test of the Float64 CPU `YeeSolver` and the shared `movingOhmCurrent` constitutive helper. The selected carrier frequency and amplitude meet 1% accuracy. The binary moving interface retains more than 1% broadband waveform error at both measured grids, so this result is not acceptance of a general moving-conductor adapter or moving PEC model.

The helper implements the SI lab-frame conduction current

```text
Jcond = sigma gamma [E + v cross B - v (v dot E)/c²],
gamma = 1/sqrt(1-|v|²/c²).
```

Transported free-charge current `rho*v` is separate. The helper validates finite fields, velocity, nonnegative conductivity, and speed below c. The scalar rest-frame conductivity law follows the covariant Ohm formulation in [Mattia et al., A&A 679, A49 (2023), DOI 10.1051/0004-6361/202347126](https://doi.org/10.1051/0004-6361/202347126), with the explicit SI factors restored. This experiment does not implement that paper's MHD fluid dynamics.

## Reproduce

```powershell
npm test -- tests/maxwell/moving-material.test.ts --silent=false
npx tsc --noEmit
```

Measured on 2026-10-24, Node v24.19.0 and Vitest 5.0.5. Five tests passed in 57.39 s: three constitutive-law/input checks and two two-grid interface comparisons. This runtime describes the local test run, not browser performance. Numerical results are printed by the test.

## Physical and numerical model

- Vacuum occupies the region before `x_m(t) = 1.5 m + 0.1c t`. After this interface is a medium translating at `v = 0.1c` along +x, with scalar rest-frame conductivity 0.3 S/m and vacuum epsilon/mu. This is a finite-conductivity half-space, not an imposed PEC wall.
- A prescribed 1 GHz electric-current sheet at x = 0.3 m drives `Jy = -2 Eamp sin(omega t)/(eta0 dx)`, with `Eamp = 1 V/m` and a linear three-cycle ramp. No electric field value is clamped to the source waveform.
- The physical x interval is 6 m, with a 0.1 m CPML at either end. Transverse invariant axes use one periodic cell each. The two grids use dx = 0.002/0.001 m, 3000/6000 physical cells, and 50/100 CPML cells per side. The CFL factor is 0.9; dt is approximately 6.004/3.002 ps.
- Only `Ey`, `Bz`, and `Jy` participate. All sources and fields are independent of y and z. Thus `div J = 0` and rho remains zero; this experiment does not validate moving longitudinal charge or surface-charge deposition.
- Ohm current is supplied explicitly to the actual Yee curl update. The benchmark obtains its exact transverse linear coefficients from `movingOhmCurrent`; this avoids revalidating identical velocity/material inputs millions of times. It uses `Jy = sigma gamma (Ey - v Bz)` without an electrostatic or magnetic overlay. B is synchronized to E time using the core's Faraday interpolation and averaged from the adjacent x faces onto the electric location.
- The raw explicit Ohm numbers `sigma gamma dt/epsilon0` are 0.2044592 and 0.1022296. Including `(1+beta)` gives 0.2249052 and 0.1124526, below the checked combined Maxwell/explicit-current bound `2(1-CFL²)=0.38`. This records the chosen update's stability restriction; it is not a universal bound for arbitrary moving or dispersive media.
- Incident and reflected fields are measured at x = 0.8 m as `Eplus = (Ey+c Bz)/2` and `Eminus = (Ey-c Bz)/2`. The probe stays in vacuum. The 20–40 ns analysis window excludes source startup and the first interface encounter.

The binary-interface comparison matches time-n node membership: an electric node conducts iff `x >= x_m(t_n)`. The fractional prototype instead uses `clamp((x+dx/2-x_m(t_n+dt/2))/dx,0,1)` as the conducting fraction. The latter is a different interface discretization and is not silently substituted for the scene adapter's geometry.

## Independent analytic reference

Let `beta=0.1`, `gamma=1/sqrt(1-beta²)`, and `D=(1-beta)/(1+beta)=9/11`. The wave frequency in the material rest frame is `omega' = gamma(1-beta) omega`. For vacuum epsilon/mu and scalar rest-frame conductivity, the conducting refractive index and electric Fresnel coefficient are

```text
n' = sqrt(1 + i sigma/(epsilon0 omega')),
r' = (1-n')/(1+n').
```

Transforming the incident and reflected transverse fields back to the lab gives

```text
f_reflected = D f_incident = 818181818.182 Hz,
|E_reflected/E_incident| = D |r'| = 0.451699705954.
```

The amplitude reference retains finite conductivity and its rest-frame frequency shift. Replacing it with the perfect-reflector amplitude `D` would be the wrong reference for this experiment.

## Measurement method and an avoided false conclusion

Frequency is measured from data, not set to the analytic Doppler value. A data-scaled Schmitt threshold first identifies carrier cycles without counting several small interface-ripple zero crossings. A sine/cosine/DC least-squares spectral search spans 0.5–1.5 times this measured estimate, then refines the peak. No expected frequency enters the estimator. Amplitude comes from that independently fitted carrier; its ratio is normalized by the measured incident amplitude. Frequency error compares the measured reflected frequency with `D` times the measured incident frequency.

The residual metric is `RMS(signal - fitted carrier - DC)/fitted carrier amplitude`; it includes all unfitted broadband ripple. It is not reduced by filtering the waveform before fitting.

An initial unrestricted zero-crossing counter incorrectly reported 883.7/985.7 MHz for the binary reflected signal because small grid-crossing oscillations created extra crossings near the carrier's zeros. Fitting a sinusoid at those erroneous frequencies produced misleading apparent amplitude losses of 80–91%. Those numbers were estimator failures, not physical reflection measurements. The data-driven spectral fit recovers the dominant carrier and separately exposes the genuine residual below.

## Results: binary interface

| dx (m) | Measured reflected frequency (MHz) | Doppler frequency error | Measured amplitude ratio | Amplitude error | Reflected normalized residual |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0.002 | 818.180494 | 0.000155442% | 0.453952019 | 0.498631% | 2.82343% |
| 0.001 | 818.181356 | 0.0000597422% | 0.452751474 | 0.232847% | 1.43039% |

The incident fits are 999.999936/1000.000032 MHz, with amplitude 1.00002227/1.00000478 V/m. Their residuals are 0.345411%/0.203982%.

The carrier amplitude improves by a factor of 2.14 under refinement and both measured carrier observables reach 1%. The reflected waveform residual improves by a factor of 1.97 but remains above 1%. The test checks the strict carrier targets and residual refinement. It deliberately does not claim that the binary waveform passes a 1% residual target.

The binary jump is a plausible source of this broadband error: each node switches conductivity abruptly as the boundary crosses it, at rates of order `v/dx` (15/30 GHz on these grids), rather than continuously resolving its occupied volume. The measured improvement under refinement supports treating it as interface-discretization error. A full spectrum or geometric conservation proof has not been established here.

## Results: fractional-interface prototype

| dx (m) | Measured reflected frequency (MHz) | Doppler frequency error | Measured amplitude ratio | Amplitude error | Reflected normalized residual |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0.002 | 818.180126 | 0.000204802% | 0.453695444 | 0.441829% | 0.267315% |
| 0.001 | 818.181421 | 0.0000495440% | 0.452707507 | 0.223113% | 0.129302% |

The incident residuals are 0.0227577%/0.0110848%. This prototype reaches 1% for the selected carrier and residual metrics, with amplitude and residual errors improving by about a factor of two. Explicit constitutive current and interface transport are not asserted to provide second-order accuracy. The prototype has not been integrated into the 3D scene adapter by this validation change.

## Scene-adapter scope update

The 3D scene adapter now carries conducting nodes/edges with the moving body and uses deposition-adjoint Ohm voltage gathers, following a demonstrated subcell charge-pinning defect in a binary mask. The two Eulerian half-space cases above remain independent constitutive/interface benchmarks. They do not directly validate that newer material graph. Its low-speed capacitor measurements and remaining limits are recorded in [the moving-source report](maxwell-moving-validation.md).

## Further interface work and limits

A focused next step is to carry a material volume fraction at each electric location, evaluate its swept occupancy over the same timestep as the current, and use that fraction consistently in constitutive integration. The planar fractional result supports testing this approach. Generalizing it requires consistent initial conductor preparation and conservative transfer of body-owned free/surface charge across swept cells. Multiplying sigma by a smoothed mask while retaining incompatible initial fields or charge transport is insufficient.

This experiment validates a flat, uniformly translating, neutral finite-conductivity interface under one transverse excitation. It does not validate arbitrary rotation, curved surfaces, overlapping transport halos, moving dielectric polarization, force-driven mechanics, DC isolation, energy/momentum budgets, or the ideal moving-PEC limit. It is not evidence that all moving gadgets or the full Maxwell migration are complete. Stationary kernel checks and native Meep comparisons are documented in [the CPU report](maxwell-core-validation.md) and [the Meep report](maxwell-meep-validation.md).
