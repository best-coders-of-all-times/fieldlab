# CPU Maxwell storage precision validation

Measured 2026-10-24. This is the Float32 prerequisite for M2/M7, not acceptance of a GPU backend or the full scene migration.

## Contract

`new YeeSolver({ ...grid, precision: 'float32' })` allocates actual `Float32Array` storage for all ten field/charge/impressed-current arrays, nine material arrays, three implicit-conduction arrays, optional nine Drude coefficient/current arrays, twelve CPML memories, twelve CPML static-reference arrays, and saved boundary electric values. Snapshots copy those arrays without promoting their precision. Drude storage remains lazy and is released by `configureDrude(null)`.

Omitting `precision`, or supplying `'float64'`, keeps Float64 storage and the existing Float64 stepping expressions. The class and snapshot types default to Float64, so existing callers retain their original types. For a runtime choice, use `YeeSolver<YeePrecision>` and accept `YeeArray<YeePrecision>` at the consumer boundary. Invalid precision strings throw before field allocation.

This CPU mode rounds on typed-array writes. JavaScript scalar expressions, diagnostic/loss accumulations, the small CPML coefficient profiles, and the temporary initial Gauss-projection solve remain Float64. Scalar intermediates can therefore differ from a future WGSL `f32` implementation. Projection writes its result into the chosen field precision. This is not emulated full-f32 arithmetic and does not validate GPU numerical parity.

Snapshots record precision. Restore requires matching metadata and array storage, and validates all array counts/lengths before copying fields. Legacy snapshots without precision metadata are treated as Float64. Cross-precision replay is rejected instead of silently quantizing a saved run. Same-precision replay restores materials, currents, charge, CPML references/memories, boundary values, losses, clock, and step index. The tested Float32 replay is bit exact.

The 22 always-present floating arrays use 88 bytes/cell in Float32 versus 176 in Float64. An enabled Drude pole adds 36 versus 72 bytes/cell; CPML memories plus references add 96 versus 192. Index arrays, CPML coefficient profiles, projection scratch, boundary arrays, retained snapshots, and higher-level scene allocations must be counted separately. These are core allocation counts, not a whole-scene peak-memory or speed benchmark.

## Reproduce

```powershell
npx vitest run tests/maxwell/precision.test.ts tests/maxwell/yee.test.ts tests/maxwell/drude.test.ts --disableConsoleIntercept --reporter=verbose
npx tsc --noEmit
npm run check:meep
```

The new suite was observed failing before implementation: seven precision-specific cases failed because Float64 storage ignored the requested precision or invalid precision was accepted. The default-precision characterization already passed. After implementation the focused suites pass 24 tests, and TypeScript reports no errors. The Meep checker compares against the existing native Meep 1.35.0 fixture; no native fixture regeneration was needed.

## Smooth periodic wave

The 1D periodic vacuum domain is one metre long, with one cell in inactive directions, CFL 0.8, `Ey=sin(2*pi*x) V/m` and staggered `Bz=sin(2*pi*(x+dx/2+c*dt/2))/c T`. There are no sources or materials. Each resolution advances exactly `3*N/4` steps, reaching `c*t=0.6 m`, or `t=2.0013845712e-9 s`.

The continuum error is spatial RMS of `Ey-sin(2*pi*(x-c*t))`, normalized by the fixed 1 V/m amplitude. Float32/Float64 electric RMS uses that same scale; magnetic RMS uses the fixed `1/c T` scale. Phase and amplitude come from the electric fundamental Fourier coefficient. Phase is in radians and amplitude error is relative to the Float64 coefficient. No samples are excluded.

| N | Steps | dt (s) | E precision RMS | B precision RMS | Phase difference | Relative amplitude difference | Float32 continuum RMS |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 32 | 24 | 8.339102380e-11 | 1.03449e-7 | 1.37611e-7 | 2.50803e-8 | 3.70095e-8 | 1.557448e-3 |
| 64 | 48 | 4.169551190e-11 | 1.19303e-7 | 1.33648e-7 | 8.30288e-10 | 4.41768e-8 | 3.870835e-4 |

Acceptance thresholds are 2e-6 for both normalized precision RMS errors, phase difference, and relative amplitude difference; continuum RMS must be below 0.003. Refinement must reduce continuum RMS by more than 3.7; measured reduction is 4.02355. These thresholds refer to this smooth resolved mode and duration, not arbitrary spectra or long runs.

## Charge, current, and Gauss constraints

Use fixed physical scales `E0=1 V/m`, `B0=E0/c T`, `dx=0.02 m`, and `rho0=epsilon_0*E0/dx`. Electric Gauss RMS is divided by `rho0`; magnetic Gauss RMS by `B0/dx`. These denominators never follow the instantaneous field or residual.

The 12-cubed periodic case starts with smooth trigonometric electric fields, impressed current of scale 0.001 A/m2, nonuniform `epsilon_r,x=2+0.2*sin(2*pi*x/N)`, nonuniform conductivity of scale 0.001 S/m, and a Drude pole `omegaP=1e9 rad/s`, `gamma=1e8 s^-1`. Initial charge is obtained once from the quantized electric field. At 80 fixed steps, CFL 0.5 and `t=1.5406665612e-9 s`:

| Observable | Measured | Acceptance |
| --- | ---: | ---: |
| Electric Gauss RMS / rho0 | 2.95207e-7 | <=1e-5 |
| Magnetic Gauss RMS / (B0/dx) | 1.54387e-7 | <=1e-5 |
| Absolute total charge (C) | 1.93997e-21 | Charge drift / (rho0 * domain volume) <1e-6 |

The CPML case is 24 by 20 by 1 cells with x/y absorbing boundaries, periodic z, three-cell layers and CFL 0.5. Initialize the discrete gradient of `phi=0.02*sin(2*pi*x/24)*cos(2*pi*y/20) V`, initialize compatible charge, then capture its static CPML references. A smooth impressed `Jx=0.001*sin(2*pi*x/24)*sin(2*pi*y/20) A/m2` advances charge for 40 steps to `t=9.4346173470e-10 s`.

The maximum over every cell and step of `abs(rho_new-rho_old+dt*div(J_used))/rho0` is 6.86931e-9 (threshold 2e-7). The interior electric Gauss RMS/rho0 is 1.09446e-7 (threshold 1e-5). Total charge drift divided by `rho0*domain volume` is below 1e-6. The continuity check includes all cells, while the Gauss diagnostic excludes CPML and its adjacent guard cell on each nonperiodic axis, as documented in the core. This check does not treat CPML divergence as physical vacuum Gauss evolution and does not measure broadband reflection.

## Ohmic and Drude response

The uniform periodic Ohmic test starts from `Ex=2 V/m`, with `sigma=epsilon_0/(20*dt)` and 20 fixed steps. Relative error versus `2/e V/m` is 2.08417e-4 (threshold 0.001) and integrated Ohmic loss is positive. Conductivity is scaled with dt here to keep the same analytic decay factor; this pair is not an Ohmic refinement study.

The uniform periodic Drude test has `epsilon_r=1`, `omegaP=2*pi*0.5e9 rad/s`, `gamma=2*pi*40e6 s^-1`, `Ex(0)=1 V/m`, and analytically staggered initial current. The analytic electric field is `exp(-gamma*t/2)*(cos(omega*t)+gamma/(2*omega)*sin(omega*t))`, where `omega=sqrt(omegaP^2-gamma^2/4)`. The four-cell grid has dx=0.02 m; all derivatives vanish. RMS is temporal RMS at one equivalent cell over the fixed 4 ns duration, normalized by 1 V/m.

| dt (s) | Steps | Float32 analytic RMS |
| ---: | ---: | ---: |
| 2e-11 | 200 | 6.029175e-4 |
| 1e-11 | 400 | 1.503378e-4 |

RMS must be below 0.003 and improve by more than 3.5 under temporal refinement; measured reduction is 4.01039. Drude dissipation must remain positive. The separate replay case combines conductivity, Drude response, a captured CPML reference and nonzero CPML memory, restoring after step 18 and reproducing all saved state after 29 further steps.

## Default reference and limits

The existing native Meep periodic vacuum/dielectric fixture comparison passes at N=32,64,128. Maximum Float64 CPU/Meep RMS remains between 1.08412e-16 and 2.50795e-16, with continuum refinement ratios 3.99804 to 4.00031, matching the previously recorded values in [the Meep report](maxwell-meep-validation.md). This checks that the default reference path retains its numerical behavior in those cases.

This work validates selectable CPU core storage and the declared smooth numerical cases. It does not establish full-scene Float32 preparation, sampling, moving materials, particles or force coupling; nor does it establish GPU parity, hardware acceleration, whole-app memory savings, or performance gains. Initial electrostatic solvers may remain Float64 and quantize when copying into a Float32 core. Fine-scale cancellation of tiny magnetic signals, underflow/overflow at other SI scales, interface singularities, long-duration drift and CPML reflection require their own error budgets.
