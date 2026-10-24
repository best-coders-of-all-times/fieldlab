# Finite-pulse CPU CPML audit

This extends the M3 measurements with the actual Float64 `YeeSolver`, imported through Vite SSR. It measures selected finite packets and observation windows; it does not complete all M3 acceptance or establish general release readiness. The audit itself does not tune the production solver. The separately tested physical-profile correction and its measurements are recorded first; the failed original profile remains preserved below.

```powershell
node scripts/audit-maxwell-pml.mjs --help
node scripts/audit-maxwell-pml.mjs --quick
node scripts/audit-maxwell-pml.mjs --json artifacts/maxwell-pml-audit.json
```

The bounded default comprises 17 rows, three domains each. Progress is printed before and after each row. `--cases` selects only declared IDs; `--json` must stay inside `artifacts/` and end in `.json`. Exit zero means execution completed, including any measured target failures. The JSON retains raw electric numerator/denominator, physical and realized geometry, step counts, windows, initialization maxima, spectra, reference differences, runtime and before/after provenance.

## Corrected physical-layer profile

The original alpha rate was normalized by a single cell, `0.05*c/h`, while the sigma rate used the physical layer thickness `cells*h`. Refining a fixed physical layer therefore changed its continuous memory law. The production correction normalizes alpha by the same physical layer thickness: `0.05*c/(cells*h)`. The existing dimensionless prefactor is retained; pulse geometry and audit cases are unchanged. This is a correction to physical profile scaling, rather than a fitted parameter selected for these pulses.

The separate `tests/maxwell/cpml-profile.test.ts` measures the memory impulse-decay rate at fixed physical depths on coarse/fine representations of the same layer. The original implementation failed all three depth checks; the corrected profile passes them. A separate actual-Yee integration test retains the original broadband cosine packet and observes its reflected tail through ct=14 m. Its recorded red/green evidence is owned by the core correction, rather than inferred from audit exit codes.

The targeted maintained audit `artifacts/maxwell-pml-corrected-tails.json` records corrected normal-tail R=3.221461e-7 and sine-control R=3.642015e-7, with zero measured reference differences in both cases. The full corrected 17-row run is complete; reproduce with:

```powershell
node scripts/audit-maxwell-pml.mjs --json artifacts/maxwell-pml-corrected-17.json
node scripts/audit-maxwell-pml.mjs --cases normal-fine-tail,normal-sine-tail --json artifacts/maxwell-pml-corrected-tails.json
```

These are selected finite pulse/window checks. The corrected selected suite meets 1e-3 in its declared finite windows. This does not certify arbitrary angle/frequency, isolated DC, all-time absorption, or the whole M3 milestone. The broad 45-degree spectrum and finite-reference/window limitations remain relevant.

### Corrected measurements and remaining window limitation

| Corrected case | h (m) | Layer (m) | R | Cref |
| --- | ---: | ---: | ---: | ---: |
| normal-base | 0.005 | 0.04 | 5.177204e-4 | 0.000e+0 |
| normal-thick | 0.005 | 0.08 | 1.134671e-5 | 0.000e+0 |
| normal-fine | 0.0025 | 0.08 | 3.221461e-7 | 0.000e+0 |
| normal-low | 0.005 | 0.08 | 4.943154e-6 | 0.000e+0 |
| normal-high | 0.005 | 0.08 | 2.087116e-4 | 0.000e+0 |
| normal-long | 0.005 | 0.08 | 1.165622e-5 | 0.000e+0 |
| oblique-base | 0.01 | 0.08 | 1.271214e-4 | 5.106e-11 |
| oblique-thick | 0.01 | 0.16 | 4.603095e-6 | 3.508e-12 |
| oblique-fine | 0.005 | 0.16 | 2.625070e-7 | 1.629e-12 |
| oblique-low | 0.01 | 0.16 | 3.985312e-6 | 4.081e-12 |
| oblique-high | 0.01 | 0.16 | 5.496352e-6 | 2.219e-12 |
| oblique-long | 0.01 | 0.16 | 4.402500e-6 | 1.330e-11 |
| oblique-45 | 0.01 | 0.16 | 2.601488e-6 | 8.824e-8 |
| normal-fine-late | 0.0025 | 0.08 | 3.221461e-7 | 0.000e+0 |
| oblique-45-late | 0.01 | 0.16 | 1.385527e-5 | 6.324e-10 |
| normal-fine-tail | 0.0025 | 0.08 | 3.221461e-7 | 0.000e+0 |
| normal-sine-tail | 0.0025 | 0.08 | 3.642015e-7 | 0.000e+0 |

All 17 corrected finite-window measurements meet 1e-3; exit zero still means execution only. The full run took 113.85 seconds summed across rows. The original 17-case baseline failure remains below and in `artifacts/maxwell-pml-baseline-17.json`.

The corrected normal-fine tail has the same running peak R=3.221460676e-7 at ct=1.242 m in the original, ct=3.2 and ct=14 windows; the earlier delayed failure has disappeared in this observation interval. Its late-window maximum is 12.42% of the reflected peak. The independently normalized sine-control result is R=3.642015443e-7 at ct=1.2622500000000003 m. Both long/extra-long probe differences remain zero through ct=14.001750000000001 m. The cosine-tail reduction relative to the failed baseline is approximately 6625x, and the sine control improves approximately 61x. Physical-profile and pulse measurements together support the correction; they do not establish exact DC absorption.

**Open endpoint check:** corrected `oblique-45-late` still reaches its maximum R=1.385526559e-5 at its final sample ct=6.001215251930229 m, with a late-window/overall peak ratio of 1.000. The measured reference discrepancy is 6.324e-10, but a later reflected maximum is not bounded by this experiment. The physical-alpha correction therefore resolves the demonstrated normal delayed-tail acceptance failure, while the broad 45-degree spectrum still requires a separate later-window/reference-separation study. No general M3 acceptance is claimed.

Corrected artifact provenance: HEAD before/after `9f77f915aa71d95ce9b75338aac3b90d3fc92fe4` / `9f77f915aa71d95ce9b75338aac3b90d3fc92fe4`; `sourceChangedDuringRun=false`. SHA-256: audit `87addbfe255300715724b04748edaeec296b093cadcc17338b9b7e006c479773`; Yee `063b834138b125f067df5adbbbd66cfec9f7dcb046a0c2a0d8e7f7bff67d0d3c`; corrected CPML `85116a090a3aae6a068101f02f165869566a0fa9553a8abcbd98fab7caf45a79`; original packet harness `7d3e3e1b56d2c155504a8d855b5755c274c093a577a9510db8bb6a05537fb694`. Git status is captured verbatim and includes the uncommitted correction and parallel documentation work; this is measured dirty-source evidence, not a clean release certification.

## Estimator and initialization

Each row evolves short, long and extra-long domains with identical left boundary, PML thickness, initial packet and probe. The reflected electric amplitude is `max |Eshort-Elong| / max |Elong|`, with separate reflected and incident windows. Normal rows use `Ey`; oblique rows use the complex transverse Fourier coefficient of `Ez`. There is no whole-domain residual-energy estimator. `max |Elong-Eextra| / incident` over the same reflected window estimates finite-reference contamination; it is not a mathematical upper bound on both references' shared errors.

Normal initialization reproduces the existing Gaussian-envelope cosine packet: wavelength 0.14 m, envelope width 0.035 m, center 0.3 m, probe 0.45 m, physical length 1 m. Its magnetic packet includes face and negative half-time shifts using continuum propagation. It is deliberately the existing harness rather than an exact discrete eigenpacket. Its broad Fourier lobes overlap zero frequency: the positive carrier lobe's 1%-amplitude support is approximately -77.75 to 167.51 rad/m. Therefore it is a broadband pulse test, not a narrow-band or isolated-DC acceptance test.

The oblique packet reproduces the harness's 121 exact vacuum Yee eigenmodes. At scale one, `ky=2pi/0.4`, central `kx=sqrt(3)ky`, width 0.25 m, center 0.5 m and probe 0.7 m; physical length is 1.6 m. Each component uses its native spatial and magnetic half-time offset, with `qx=2sin(kx h/2)/h`, `qy=2sin(ky h/2)/h` and `omega=2 asin(c dt sqrt(qx²+qy²)/2)/dt`. Weights are `exp(-((kx-kx0)width/2)^2)` at spacing `pi/(5 scale)`. Factoring the transverse phase only reduces initialization cost and preserves this sum.

At scale one and h=0.01 m, modes with weights at least 1% span 19.58–56.89 degrees and 0.895–2.229 GHz. This is an angular spectrum, not a single-angle ray. Low/high rows scale all packet lengths, positions and physical intervals by 1.5/0.75 while keeping physical PML thickness independently fixed; nominal oblique wavelengths become 0.3/0.15 m, with corresponding 1%-weight frequency ranges 0.596–1.489 / 1.192–2.963 GHz. Gaussian weights below 1% are still present; the JSON records the actual retained-mode diagnostic rather than a hard spectral cutoff. No per-frequency reflection transfer function is inferred from a pulse peak.

The genuinely different `oblique-45` spectrum changes central kx to ky. Its 1%-weight angular interval reaches 25.68–94.57 degrees; about 0.230% of summed amplitude weights have negative kx. It includes weak backward-directed content and cannot certify grazing incidence. Shared left-boundary responses cancel in paired subtraction but are not thereby independently validated. Oblique initialization is nonzero in the left layer: base-thick peak electric field in PML is approximately 0.0156 and at the outer boundary 0.000939 for unit packet amplitude. The JSON records both E and cB boundary maxima for each domain. This finite initial truncation is a limitation rather than a claimed compactly supported source.

## Historical original-profile results

Measured with Node v24.19.0. The final 17-row baseline run took 114.84 seconds summed across rows (oblique-fine 40.20 s; each far-reference tail row 12.6 s). Distances are SI meters. R is reflected/incident electric amplitude; Cref is long-minus-extra-long/incident. These are finite-window measurements.

| Case | h | Layer thickness | R | Cref |
| --- | ---: | ---: | ---: | ---: |
| normal-base | .005 | .04 | 7.033619e-4 | 0 |
| normal-thick | .005 | .08 | 1.315971e-5 | 0 |
| normal-fine | .0025 | .08 | 1.646904e-6 | 0 |
| normal-low | .005 | .08 | 4.308812e-6 | 0 |
| normal-high | .005 | .08 | 2.368674e-4 | 0 |
| normal-long | .005 | .08 | 1.379037e-5 | 0 |
| oblique-base | .01 | .08 | 1.720822e-4 | 4.828e-11 |
| oblique-thick | .01 | .16 | 4.808446e-6 | 3.345e-12 |
| oblique-fine | .005 | .16 | 2.809882e-7 | 1.610e-12 |
| oblique-low | .01 | .16 | 4.144571e-6 | 3.746e-12 |
| oblique-high | .01 | .16 | 5.715894e-6 | 2.145e-12 |
| oblique-long | .01 | .16 | 4.598919e-6 | 1.314e-11 |
| oblique-45 | .01 | .16 | 2.712090e-6 | 8.870e-8 |
| normal-fine-late | .0025 | .08 | 9.564590e-5 | 0 |
| oblique-45-late | .01 | .16 | 1.367603e-5 | 6.292e-10 |
| normal-fine-tail | .0025 | .08 | **2.134325e-3 (FAIL)** | 0 |
| normal-sine-tail | .0025 | .08 | 2.211093e-5 | 0 |

**The original-profile default 17-row suite fails the 1e-3 target:** `normal-fine-tail` measures 2.134325e-3. The original 15 shorter-window rows meet the target, but their success does not survive the longer normal-packet observation. No target failures were removed or adjusted away. In the original windows, fixed-physical-thickness refinement lowers normal R by about 8x and oblique R by about 17x. The late-window failure below prevents interpreting these early-window numbers as converged absorption or a general grid-convergence result. Increasing the layer thickness also improves both base packets. Frequency scaling at fixed layer thickness produces a substantially worse high-frequency normal result, retained above.

The `*-long` rows extend the physical short domain by 0.4 m and extend the observation endpoint by `2*0.4/cos(theta)` in ct. Normal thick/long R changes about 4.8%; oblique thick/long about 4.4%. Their reflected peaks occur at ct approximately 1.436/2.259 m and 2.310/3.227 m respectively, within the extended windows; moving a reflection beyond the window is not counted as absorption. Central geometric travel times are diagnostics, not assumed exact group velocities for the broad discrete packet.

Base windows reproduce the harness: normal incidence ct<0.5 m and reflection 0.7<ct<2 m; oblique incidence ct<0.8 m and reflection 1.3<ct<3.3 m. These scale with packet lengths. The 45-degree row extends to ct=4.2 m. Late reflected tails remain: maxima in the last 10% of the window are approximately 30% of the overall peak for oblique-fine and 55% for oblique-45; normal-fine's maximum occurs at its final sample. Thus these rows do not demonstrate an all-time reflected maximum. Zero normal reference differences mean identical floating-point probe samples within this finite window, not an exact zero physical reflection. The 45-degree reference discrepancy is about 3.3% of its measured reflection, materially larger than other rows, so interpret its small ratio with that finite-reference uncertainty.

The two explicit endpoint-sensitivity rows extend both reference domains by another 1 m. `normal-fine-late` runs to ct=3.20175 m and increases R by about 58x to 9.564590e-5; `oblique-45-late` runs to ct=6.00122 m and increases R by about 5x to 1.367603e-5. In both cases the maximum again occurs at the final sample and the last-10% maximum equals the overall maximum. The late-window convergence check therefore **fails**: these tails are still rising, and these measurements do not locate the eventual maximum or diagnose whether later growth is a CPML stability problem, a weak spectral component, or another boundary effect. The extra-long subtraction remains zero for the normal row and 6.292e-10 relative to incidence for the 45-degree row, so this discrepancy is not explained by the measured reference difference. Production tuning was not attempted. The finite-window target is met; stable long-time absorption remains unresolved.

## Provenance and limits

The ignored artifact records SHA-256 for `yee.ts`, its runtime dependency `cpml.ts`, the original benchmark harness and this audit script, plus git HEAD/status before and after execution. This captures dirty-source state rather than implying a clean release. Native Meep remains an offline reference; no new dependency or browser runtime path is introduced. The existing harness and [core validation report](maxwell-core-validation.md) are the source of packet mathematics and baseline geometry.

The suite covers two transverse angular spectra and three packet scales, independently varied thickness, fixed-thickness grid refinement and a shifted-domain/window check. It does not cover arbitrary frequency or angle, a hard finite spectral support, all-time tails, arbitrary 3D polarization, static/DC isolation, moving materials, WebGPU parity or all M3 requirements.


Verification: `node --check scripts/audit-maxwell-pml.mjs` and `--help` exited zero. Unknown option, unknown case, duplicate case, missing case value, artifact-directory escape and non-JSON artifact extension were each exercised through a Node `spawnSync` matrix and exited one with a specific diagnostic. The historical 15-row run used HEAD `07a8900643ec73440c9d81ad16e12f351bdf9feb`; before/after source hashes were identical (`sourceChangedDuringRun=false`). The script SHA-256 was `81fba50695e9fc4557a1d9f8864a53f7ac5812d49e99e3cd204f0dd47cf61cc0`, Yee SHA-256 `063b834138b125f067df5adbbbd66cfec9f7dcb046a0c2a0d8e7f7bff67d0d3c`, CPML SHA-256 `d583c79ad9a11bdff72fbb410dd24083a7ecc7df971d7e0d4704a9b4843ecbcc`. Git status changed during the run because a separate browser benchmark script was created; the physics/audit sources and HEAD stayed fixed. Full hashes/status and exact floating-point results are in `artifacts/maxwell-pml-audit.json`.


## Follow-up diagnosis: delayed near-DC response and a measured target failure

The original 15-window measurements remain retained; two maintained late-tail rows now extend the default suite. They use the production solver without replacing the original pulse or tuning CPML. Reproduce the normal 1D investigation with:

```powershell
node scripts/audit-maxwell-pml.mjs --cases normal-fine-tail,normal-sine-tail --json artifacts/maxwell-pml-tail-audit.json
```

The script records probe signals, whole-domain electric maxima and their locations, interior/left-layer/right-layer maxima, and solver field-energy diagnostics at ct intervals of approximately 0.5 m through ct=14 m. The historical exploratory run also continued to ct=20 m. Domains are 1, 8 and 10 m, with h=0.0025 m and the same 0.08 m PML. These two maintained audit rows include full-step running peaks and use each pulse's own incident denominator. Historical diagnostic raw outputs are `artifacts/pml-diagnosis-cos-long.json` and `artifacts/pml-diagnosis-sine-long.json`; maintained results are recorded in the audit JSON.

For the original cosine pulse, the sampled reflected amplitude reaches **0.0021324868 V/m at ct=10.50075 m**, or approximately **2.1343e-3 relative to the previously measured incident amplitude 0.99914138 V/m**. This is a genuine measured failure of the 1e-3 target for the original packet at this longer observation time. It is a sampled lower bound on the maximum; no exact-peak interpolation is claimed. The 8 m and 10 m reference probe signals are identical through ct<14 m, including this peak. The earlier 2.8/3.6 m references become contaminated at later times and underestimate this tail; their apparent turnaround near ct=7.5 m is not a trustworthy maximum of the isolated reflection.

The short-domain field is bounded and subsequently decays: its whole-domain electric maximum is about 0.00225 V/m near ct=9 m, 0.00220 at ct=10.5 m and 0.00020 at ct=20 m. The maximum initially remains in the right PML near x=1.075 m, then moves left slowly. Short-domain diagnostic energy decreases from 1.565e-18 J at ct=0.5 m to 3.118e-22 J at ct=10.5 m and 1.699e-22 J at ct=20 m. This energy includes the stored field diagnostic, not an asserted exact dissipative CPML energy theorem. These observations do not support exponential instability over this run.

A controlled change from cosine to sine retains the same Gaussian envelope, carrier, positions, grids, layers, boundaries and compatible continuum-shifted magnetic initialization, while making the spatial electric integral zero. Its sampled maximum probe difference before ct=14 m is 1.24823e-5 V/m at ct=5.50125 m, approximately 171 times smaller in absolute amplitude than the cosine tail. The sine packet's peak incident amplitude differs, so this factor is an absolute signal comparison rather than a normalized reflection-coefficient comparison. References again agree exactly at the probe during that window.

The measured behavior is consistent with the CPML's low-frequency response. The original cosine packet has nonzero spatial integral `sqrt(pi)*width*exp(-(kx*width/2)^2)`, approximately 0.0335 m for unit peak; the sine integral is zero. Directly from the implemented memory recurrence, the zero-frequency derivative multiplier is `1/kappa + a/(1-b) = alpha/(rate + kappa*alpha)` inside a layer cell. This multiplier is real, can be very small deep in the layer and supplies no zero-frequency attenuation. Equivalently, the complex-frequency-shifted stretch has finite real static response where alpha>0; low-frequency signals propagate slowly and their attenuation tends to zero toward DC. The bounded delayed tail, its spatial location, and the zero-area control support delayed near-DC reflection as the cause of the normal packet's misleading early-window result. They do not establish a general stability theorem or diagnose every possible boundary pathology.

A concrete numerical regression for the intended target is to initialize the original normal-fine packet, use 1/8/10 m domains and compare the short/reference probe near ct=10.50075 m: requiring `abs(Eshort-Elong)/0.9991413798311465 < 1e-3` fails, yielding about 0.0021343. This is an acceptance-target regression, not evidence that the CPML recurrence has a coding defect. The documented earlier finite-window passes must not be promoted to all-time absorption acceptance.

The 45-degree packet has no temporal DC mode because ky is nonzero, but does include nearly tangential and backward-directed kx components. Its late response needs its own spectral/group-delay investigation; the normal near-DC control does not explain it by itself. The original 45-degree late-window limitation remains open.

A separate source-level concern affects interpretation of the original grid comparison: the production profile at this baseline uses `alpha_max=0.05*c/h`, while its sigma rate is normalized by physical layer thickness `cells*h`. Thus refining h at fixed physical layer thickness changes the alpha profile and does not hold the absorbing continuum model fixed. The original grid comparison only holds physical geometry fixed; it does not isolate discretization error of one fixed CPML profile. A separate scalar physical-depth profile regression exposed this mismatch; the correction is described above. The original baseline data are retained unchanged.


Maintained baseline reproduction: `node scripts/audit-maxwell-pml.mjs --json artifacts/maxwell-pml-baseline-17.json` completed with exit zero and `selectedSuiteMeetsTarget=false`. All 17 rows retain full-step reflected peak tracking. `normal-fine-tail` has incident amplitude 0.9991413798311465 V/m, reflected peak 0.002132492500199403 V/m at ct=10.512 m and R=0.0021343250747554777. `normal-sine-tail` has its independently measured incident amplitude 0.5655103255441459 V/m, reflected peak 0.000012503958725822013 V/m at ct=5.382 m and R=0.00002211092912192265. Both run to ct=14.00175 m and have identically zero long-minus-extra-long probe differences throughout the measurement window. Tail rows include electric/cB maxima and locations, layer/interior maxima and diagnostic energy snapshots every approximately 0.5 ct m.

The maintained 17-row artifact records stable HEAD `54ffd61ab089e4271cae02bcc3ae9ce791aca595`, unchanged source hashes and `sourceChangedDuringRun=false`. Its final audit SHA-256 is `87addbfe255300715724b04748edaeec296b093cadcc17338b9b7e006c479773`; Yee/CPML hashes match the earlier baseline given above. This supersedes the earlier 15-row artifact as the complete baseline suite. It does not supersede or remove its shorter-window numerical results.
