# Stationary Drude ADE validation

The CPU Yee kernel optionally evolves one stationary Drude pole per electric component. The default nondispersive kernel allocates no Drude arrays. This is a local, linear constitutive model with specified plasma/damping parameters, not an assignment of real-metal properties or a model of moving dispersive matter.

The frequency response follows the Drude form described in [Meep's material documentation](https://meep.readthedocs.io/en/stable/Materials/). This API uses angular frequencies in SI; it does not use Meep's ordinary-frequency unit convention.

## API, state, and units

```typescript
solver.configureDrude({ omegaP: 2 * Math.PI * 1.5e9, gamma: 2 * Math.PI * 0.3e9 });
// Anisotropic or spatial parameters: each component is an SI scalar or Float64Array.
solver.configureDrude({ omegaP: { x: 0, y: omegaPAtYEdges, z: 0 }, gamma: 1e9 });
solver.configureDrude(null); // release the optional pole state
```

`omegaP` is the nonnegative plasma angular frequency in rad/s and `gamma` the nonnegative damping rate in s^-1. `gamma` defaults to zero. Array arguments are copied and must match the storage length. The existing `epsX/Y/Z` values remain the positive relative high-frequency permittivity, epsilon-infinity. They may not be replaced with a frequency-independent negative permittivity.

`solver.drude` is null when disabled. When enabled it exposes `omegaPX/Y/Z`, `gammaX/Y/Z`, and `Jx/Jy/Jz` as component-position Float64 arrays, plus accumulated damping `loss`. The current is stored at `time-dt/2`. These nine arrays require exactly 72 bytes per grid point, excluding small object/scalar overhead; a snapshot copies another 72 bytes per point when enabled. Mutable parameter arrays follow the existing material-array contract: fill them before stepping and call `validateMaterials()` after changes. Material edits in a running scene still require compatible reinitialization.

Snapshots include all pole coefficients, half-time currents and accumulated loss; restore enables/disables the pole as recorded. `reset()` retains coefficients and zeros currents/loss along with the field runtime. Reconfiguration resets the optional pole memory, so it is an explicit material-state operation, not a way to alter an ongoing trajectory without accounting for that change.

## Numerical update and charge meaning

The continuum equation is

```text
dJ_D/dt + gamma J_D = epsilon0 omegaP² E.
```

Its leapfrog ADE is

```text
J_D[n+1/2] = [(1-gamma dt/2) J_D[n-1/2]
              + epsilon0 omegaP² dt E[n]] / (1+gamma dt/2).
```

The updated Drude current enters the same Ampere update as impressed current and implicit nondispersive Ohmic current. Its backward divergence also enters the same discrete charge-continuity update. This implementation treats it as **free carrier current**: `D = epsilon0 epsilon∞ E`, and rho includes the charge accumulated by Drude conduction. It is not also added as a separate polarization term in D, which would double count it.

`currentAtUpdate(axis,index)` reports impressed/deposited current plus the latest implicit Ohmic current plus this free Drude current, all at the native electric edge. The material currents correspond to the last Ampere update at `time-dt/2`; E and synchronized B are at `time`. The impressed J arrays must still hold that update's deposited values. Since nondispersive Ohmic current is now observable, snapshots also include its three existing runtime arrays: this adds 24 bytes per point to every snapshot, without adding live runtime arrays. Initial/reset material-current history is zero unless a caller explicitly supplies consistent Drude half-time currents.

## Coupled timestep restriction

The validation uses the conservative sufficient bound

```text
dt² [ c² sum_axis(1/h_axis²)/(min(epsilon∞) min(mu_r))
       + max_component,cell(omegaP²/epsilon∞)/4 ] <= 1.
```

Invariant one-cell axes are excluded from the spatial sum, consistent with the existing reduced-dimensional kernel. With constant lossless parameters this follows from the Yee/ADE dispersion relation: spatial and plasma terms add inside `sin²(omega dt/2)`. Bounds on vacuum CFL and plasma frequency checked separately would miss that sum. For nonuniform parameters the separate extrema make this restriction conservative. Nonnegative centered damping is retained; no timestep increase is claimed from physical damping.

A regression deliberately selects `CFL=0.9` and `omegaP dt=0.95`. Both individual limits are below one/two respectively, but `0.9²+(0.95/2)²=1.035625>1`, and configuration is rejected atomically. The previously configured material remains intact on a rejected update. The pole does not silently reduce dt or change c.

## Diagnostics and their limits

The kinetic-energy density estimate is `J_D²/(2 epsilon0 omegaP²)` in active-pole cells. Its integer-time current is estimated by averaging the stored half-current and a one-step ADE preview driven by the current E. Damping loss accumulates `dt gamma J_D[n+1/2]²/(epsilon0 omegaP²)` over electric steps. The public diagnostics add `drudeKineticEnergy` and `drudeLoss`; `totalEnergy` includes the optional kinetic estimate, while `electricEnergy` and `magneticEnergy` preserve their field meanings. `ohmicLoss` remains the nondispersive sigma loss, and `sourceWork` counts supplied impressed current.

These are physical energy estimates with temporal quadrature. They are not asserted to be an exact discrete energy invariant or a complete budget including CPML flux and source/mechanical work. A zero-plasma-frequency component contributes no kinetic/loss term and must not be assigned an arbitrary carrier current. The model supplies one pole, stationary principal-axis coefficients, and no thermal/nonlocal or moving-medium dynamics.

## Reproduce

```powershell
npm test -- tests/maxwell/drude.test.ts --silent=false
npm test -- tests/maxwell/yee.test.ts tests/maxwell/initialization.test.ts
npx tsc --noEmit
node scripts/check-meep-reference.mjs
```

Measurements below use Float64 CPU storage, Node v24.19.0 and Vitest 5.0.5 on 2026-10-24. The focused Drude suite contains five tests: allocation/coupled stability, uniform plasma response, continuity/replay, total-current readout/replay, and the two-frequency/two-grid interface comparison. The unchanged native Meep fixture comparison covers six nondispersive periodic vacuum/dielectric cases; their maximum kernel RMS discrepancy remains `2.51e-16`. It is not a native Drude comparison.

## Uniform plasma oscillation and damping

The uniform periodic 4×4×4 grid uses 0.02 m spacing, epsilon-infinity 2, `omegaP=2 pi 0.5 GHz`, and `gamma=2 pi 40 MHz`. Initial E is 1 V/m along x. The analytic damped mode is

```text
Omega = sqrt(omegaP²/epsilon∞ - gamma²/4),
E(t) = exp(-gamma t/2) [cos(Omega t) + gamma/(2 Omega) sin(Omega t)].
```

The Drude half-current is initialized from this solution at `t=-dt/2`; initializing it to an unrelated time would introduce a startup phase error. Positive-going E crossings measure frequency; interpolated positive peaks measure exponential envelope decay over six cycles. The full E error uses the fixed initial 1 V/m scale.

| dt (ps) | Measured frequency (MHz) | Frequency error | Measured damping (s^-1) | Damping error | E RMS error (V/m) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 20 | 353.016810 | 0.00837360% | 125663852.249 | 0.000116267% | 3.23681e-4 |
| 10 | 352.994554 | 0.00206873% | 125663787.038 | 0.0000643738% | 8.08485e-5 |

References are 352.987251894 MHz and `gamma/2=125663706.144 s^-1`. The E RMS error improves by a factor of 4.00. The nonuniform-current regression additionally verifies `div D-rho < 1e-23 C/m³` after evolution and bitwise replay of E/current arrays after restoring all pole state.

## Dispersive interface and skin response

A stationary Drude half-space begins at x = 0.6 m, with epsilon-infinity and relative mu equal to one. Its plasma angular frequency is `2 pi 1.5 GHz` and damping `2 pi 0.3 GHz`. The 1.6 m physical interval is padded by 0.12 m CPML on each side. A current sheet at x = 0.2 m drives 1 or 2 GHz, using a six-cycle linear ramp. The final ten of 36 cycles determine sine/cosine/DC fits at the known drive frequency.

At a vacuum probe x = 0.35 m, native-face B is synchronized and spatially averaged, then `(Ey±c Bz)/2` separates incident/reflected waves. Their fitted amplitude ratio measures reflection magnitude. Material probes at x = 0.67 and 0.75 m measure attenuation `alpha=log(|E1|/|E2|)/0.08` and propagation phase `beta=arg(E2/E1)/0.08`. Their phase separation is below pi, so no reference-guided phase unwrapping is needed. Probes avoid the interface itself.

For the `exp(-i omega t)` convention,

```text
epsilon_r(omega) = epsilon∞ - omegaP²/(omega²+i gamma omega),
n = sqrt(epsilon_r),  |r| = |(1-n)/(1+n)|,
alpha = (omega/c) Im(n),  beta = (omega/c) Re(n),  skin length = 1/alpha.
```

The 1 GHz reference has epsilon `-1.06422018 + 0.61926606 i`, `|r|=0.767129506`, `alpha=22.45344639 m^-1`, and `beta=6.05734904 m^-1`. At 2 GHz they are `0.44987775 + 0.08251834 i`, `0.198356784`, `2.56778440 m^-1`, and `28.23190864 m^-1`. Thus the test checks both sides of the plasma transition, not a frequency-independent conducting substitute.

| Drive (GHz) | dx (m) | Measured reflection | Reflection error | Measured alpha (m^-1) | Alpha error | Measured beta (m^-1) | Beta error |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 0.005 | 0.767636040 | 0.0660299% | 22.45233859 | 0.00493376% | 6.04212391 | 0.251350% |
| 1 | 0.0025 | 0.767252078 | 0.0159780% | 22.45317164 | 0.00122366% | 6.05353782 | 0.0629190% |
| 2 | 0.005 | 0.200248998 | 0.953945% | 2.57545467 | 0.298712% | 28.16015654 | 0.254152% |
| 2 | 0.0025 | 0.198699623 | 0.172839% | 2.56970502 | 0.0747970% | 28.21401363 | 0.0633857% |

All selected errors meet 1% and improve under refinement. The largest coarse reflection error is close to that target, so no universal 1% accuracy at arbitrary resolution is implied. No metal-specific fit, multiple-pole model, moving dispersive interface, grazing/backward-wave CPML validation, or arbitrary 3D dispersive-body acceptance is claimed. Meep also documents [possible PML/dispersive-medium instabilities](https://meep.readthedocs.io/en/latest/FAQ/); the selected cases do not establish unrestricted CPML compatibility.
