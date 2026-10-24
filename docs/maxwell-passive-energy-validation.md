# Passive conductor energy accounting audit

Time-centered conductor work accounting reduces the selected actual moving-body energy residual from 0.693% to 0.0134% at mesh 32, while leaving the recorded field and rigid-motion measures exactly unchanged. A small moving-body residual remains under time refinement. These are transfer-normalized errors, not percentages of the much larger initial field or kinetic energy. They do **not** establish full M6 passive-body acceptance, exact thermodynamic heat, or conservation for arbitrary moving materials.

The maintained [audit script](../scripts/audit-maxwell-passive-energy.mjs) runs the production `MaxwellSceneSolver` through Vite SSR. It independently measures actual rigid kinetic energy and the exact discrete field-energy budget, including all update-current work and finite-volume flux. It never derives kinetic energy from `mechanicalWork`, adds power to force-driven dynamics, changes deposited current, or substitutes analytic fields during evolution. Exit 0 means measurements completed.

## Reproduction and provenance

Run from the repository root with installed Node/Vite dependencies:

```powershell
node --check scripts/audit-maxwell-passive-energy.mjs
node scripts/audit-maxwell-passive-energy.mjs --quick --json artifacts/maxwell-passive-energy-quick.json
node scripts/audit-maxwell-passive-energy.mjs --json artifacts/maxwell-passive-energy-audit.json
```

`--quick` selects one mesh 16 case with a final physical time of 1 ns. The default study uses meshes 16/24/32, then halves and quarters dt independently at mesh 32, for five cases. The script chooses an integer step count and corresponding CFL no larger than 0.7 to reach the same physical final time. Parameters affecting motion or material response do not change between rows.

Targeted commands:

```powershell
node scripts/audit-maxwell-passive-energy.mjs --grids 16,32 --time-grid 32 --time-factors 1,2,4 --duration 1e-9 --json artifacts/maxwell-passive-energy-selected.json
node scripts/audit-maxwell-passive-energy.mjs --grids 32 --time-grid 32 --time-factors 8,16 --json artifacts/maxwell-passive-energy-fine-time.json
node scripts/audit-maxwell-passive-energy.mjs --quick --duration 3e-10 --json artifacts/maxwell-passive-energy-short.json
node scripts/audit-maxwell-passive-energy.mjs --help
```

`--grids` accepts integer resolutions 8..48; `--time-grid` defaults to 32; `--time-factors` accepts integer multiples 1..64 of that grid's baseline step count; `--duration` is seconds in (0,1e-8]. Explicit time-study options also apply with `--quick`. Duplicate baseline cases are reused. JSON output paths must lie inside ignored `artifacts/`.

Every output includes Git HEAD, branch and status; Node/platform; the command and physical settings; source/dependency/script SHA-256 hashes before and after execution; and separate `sourceChangedDuringRun`, `headChangedDuringRun`, and `statusChangedDuringRun` flags. An engine-source change invalidates interpretation as a single-revision measurement. A HEAD/status change is recorded even if the hashed numerical sources remain identical. A failed run writes its completed rows before exiting with an error. Vite uses middleware mode and does not open an application HTTP port.

## Physical case and feedback

A 1 m vacuum cube contains a single 0.25 m cubic conducting body centered at zero. It is floating and neutral, uses `maxwellConductorModel: isolated`, conductivity 0.01 S/m, mass 1e-15 kg, and isotropic principal inertia 1e-17 kg m^2. Its dynamics are `forceDriven` with initial velocity (0,1e6,0) m/s and zero angular velocity. There are no prescribed trajectories, source particles, other bodies, impressed currents, driven magnets, feeds, or wave sources.

Initial E is zero. The actual stored core B starts uniformly at (0,0,0.001) T and evolves through the Maxwell solver; it is not added to samples as a static overlay. Four PML cells on every side and open electrostatic preparation are used. The noncompact initial magnetic field is part of the measured control-volume energy. Its boundary flux cannot be assumed zero.

At startup, v cross B produces real lattice conduction despite zero net charge. The current creates polarization and changes subsequent fields, current, Lorentz force, and actual body velocity. At mesh 32 and dt/16 before the heat change, final y velocity is 999847.655 m/s rather than the initial 1e6 m/s, displacement is 0.999920 mm, and the sum of absolute deposited charge is about 1.254 nC. Net charge remains near 1e-26 C. This is actual feedback from evolved fields.

## Closed energy ledger

For each actual scene step, `measureFieldBalance` evaluates the native discrete Yee energy

```text
U = dV/2 sum(epsilon0 E_native^2 + B_previous_half B_next_half/mu0)
B_next_half = 2 B_synchronized - B_previous_half
W = dt dV sum(E_time_average dot J_actual_update)
F = dt times outward boundary power on the matching native stencil
field residual = delta U + W + F
```

Every update current counts in W, including conductor conduction and transported polarization charge. This finite-volume identity uses the exact discrete Yee energy rather than the physical centered-B-squared estimate. Its control volume has padded-grid low indices[5,5,5] and high indices[resolution+3,resolution+3,resolution+3]. It lies in ordinary Yee cells with a one-cell halo. The physical integration box consequently approaches the domain boundary as resolution increases; this does not affect the matter mismatch R when all current is enclosed, but field and flux columns describe different finite boxes across meshes.

Actual integer-time rigid velocity gives translational K=m|v|^2/2. Rotational K=I|omega|^2/2 is included; this expression uses the deliberately isotropic inertia. The separate `mechanicalWork` diagnostic uses force dot updated velocity and omits torque work, so it is not a kinetic-energy substitute.

H is the cumulative actual `diagnostics().conductorLoss` change. Before the diagnostic change it used old-time current times old-time electric-plus-motional edge voltage; it was an explicit approximate heat integral. The revised diagnostic retains the accepted edge current and its actual deposited weights/path, then uses the average old/new electric-plus-motional voltage after the field step. Its stationary electric part therefore matches the native deposited-current work. The moving motional part remains a constitutive/work estimate, without assuming H is an exact proper-frame thermodynamic quantity. The decisive residuals are

```text
R = delta K + H - W
closed residual = delta U + delta K + H + F
transfer scale = max(abs(delta K), abs(H), sum(abs(W_step)))
relative residual = abs(R)/transfer scale
```

The two residuals differ only by the separately measured field residual. No diagnostic correction is fed back into fields or mechanics, and no residual is algebraically removed.

## Before-change measurements

The following seven rows were measured with the unchanged numerical engine at commit `034b8b854028c27634a9503b80237361fab600ea`, before the conductor-heat diagnostic change. They come from `artifacts/passive-energy-audit/passive-energy.json` and `passive-energy-fine-time.json`. The promoted script independently reproduced the mesh 16 row in `artifacts/maxwell-passive-energy-baseline-quick.json`, with unchanged before/after source hashes. The baseline scene-solver SHA-256 was `8b3fc7194bfc7b2f6553ec1d7e1aca5fc059928ed55ff05091bc93a3fb07d9f4`.

| Mesh | Time factor | dt (s) | Actual delta K (J) | Old-time H (J) | Actual W (J) | R (J) | abs(R) / transfer |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 16 | 1 | 8.333333e-11 | -1.861841e-7 | 1.452047e-7 | -4.388655e-8 | 2.907183e-9 | 1.561456% |
| 24 | 1 | 5.555556e-11 | -1.638652e-7 | 1.288188e-7 | -3.663159e-8 | 1.585192e-9 | 0.967375% |
| 32 | 1 | 4.166667e-11 | -1.531988e-7 | 1.209744e-7 | -3.328542e-8 | 1.061015e-9 | 0.692574% |
| 32 | 2 | 2.083333e-11 | -1.527347e-7 | 1.201600e-7 | -3.308929e-8 | 5.145683e-10 | 0.336903% |
| 32 | 4 | 1.041667e-11 | -1.525047e-7 | 1.197584e-7 | -3.299223e-8 | 2.459693e-10 | 0.161286% |
| 32 | 8 | 5.208333e-12 | -1.523903e-7 | 1.195591e-7 | -3.294392e-8 | 1.127656e-10 | 0.073998% |
| 32 | 16 | 2.604167e-12 | -1.523332e-7 | 1.194598e-7 | -3.291981e-8 | 4.643160e-11 | 0.030480% |

The initial halvings reduce R by about a factor two, consistent with a leading explicit first-order temporal accounting error. The finer ratios deviate from exactly two; these rows alone do not establish a nonzero limiting defect or an asymptotic order. The independent time study is essential: fixed-CFL mesh refinement simultaneously changes geometry quadrature and dt.

Finite-volume field/flux terms for the baseline mesh rows are:

| Mesh | delta U (J) | Outward F (J) | Cumulative field residual (J) |
| --- | ---: | ---: | ---: |
| 16 | 2.148275e-7 | -1.709410e-7 | -5.896693e-15 |
| 24 | 6.980336e-8 | -3.317172e-8 | 5.233602e-14 |
| 32 | 4.197406e-8 | -8.688514e-9 | 1.268078e-13 |

Negative F is inward energy flux under the outward-positive convention. Initial uniform magnetic energy is roughly 0.3 J, so native subtraction to obtain changes around 1e-8..1e-7 J limits field-residual precision. Across all seven baseline rows the cumulative field residual remains below 1.44e-13 J and maximum individual-step residual below 1.48e-14 J, much smaller than the matter mismatch.

## After time-centered heat accounting

The maintained script was rerun after the heat-only implementation, at the same final time and unchanged physical parameters:

```powershell
node scripts/audit-maxwell-passive-energy.mjs --grids 16,32 --time-grid 32 --time-factors 1,2,4 --duration 1e-9 --json artifacts/maxwell-passive-energy-after-heat.json
```

This completed four actual cases on 2026-10-24 with Node v24.19.0 on Windows. HEAD was still `034b8b854028c27634a9503b80237361fab600ea`, with the heat implementation uncommitted in the working tree; the measured scene-solver SHA-256 was `f89d817c57322a40b234b5e0333044df3559dc59d76b51b847690464813e608b`. Before/after numerical source hashes and HEAD were unchanged. `statusChangedDuringRun` was true because the concurrent focused regression work changed working-tree status; engine, scene, dependency and audit-script hashes stayed fixed.

| Mesh | Time factor | Revised H (J) | Before R (J) | After R (J) | After closed residual (J) | After abs(R) / transfer |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 16 | 1 | 1.422620e-7 | 2.907183e-9 | -3.559144e-11 | -3.559733e-11 | 0.019116% |
| 32 | 1 | 1.198928e-7 | 1.061015e-9 | -2.053855e-11 | -2.041174e-11 | 0.013406% |
| 32 | 2 | 1.196253e-7 | 5.145683e-10 | -2.013315e-11 | -1.999600e-11 | 0.013182% |
| 32 | 4 | 1.194925e-7 | 2.459693e-10 | -1.992962e-11 | -1.978858e-11 | 0.013068% |

For every selected row, direct comparisons against the saved before-change data found identical JavaScript numbers for actual delta K, all-current W, delta U, outward F, field-only residual, and initial/final field energy, plus identical serialized final rigid state. The observed improvement comes entirely from the changed work/heat accounting; the fields, forces and actual feedback trajectory were not altered to close a budget. The independent comparison record is `artifacts/passive-energy-audit/before-after-comparison.json`.

The leading old-time accounting error is strongly reduced: at the base mesh 32 timestep, R falls by roughly a factor 52 in magnitude. The revised values approach a negative residual near 2e-11 J when dt is halved. This remaining moving-coupling residual is larger than the roughly 1.4e-13 J field identity uncertainty and does not vanish in these refinements. The audit does not determine how much comes from transported-charge force/current pairing, constitutive/frame energy, or other moving-material discretization. It is not valid to label the full passive closed system exactly conserved, remove this residual algebraically, or infer torque/other-geometry acceptance from the symmetric box.

## Geometry and independent checks

The physical conductor volume is 0.015625 m^3. Inclusive node rasterization gives 125/343/729 nodes and 300/882/1944 edges at 16/24/32. The sum of x-edge volume weights is 0.0244141/0.0212674/0.0197754 m^3, approaching the physical volume from above. Spatial refinement therefore includes geometry quadrature error; these rows are not independent proof of continuum material convergence. The actual moving-Ohm admission check accepts every row without reducing conductivity or bypassing stability checks.

The script independently sums core rho over the entire padded domain and computes the ordinary-volume Gauss residual from native backward differences of E. Gauss relative RMS normalizes by the combined rho and epsilon0 E/h scale. It also integrates absolute deposited current outside the control volume, checks actual center speed and the conservative rigid material bound |v|+|omega| times the box corner radius, and records geometry counts.

All seven baseline rows have zero outside-current integral, maximum absolute net charge below 2.6e-26 C, normalized Gauss RMS below 7.4e-16, and maximum material speed 0.003336c, below the rigid solver's 0.01c limit. The only private-member read is lattice geometry introspection, explicitly marked in the script as an unstable diagnostic API; heat comes from public diagnostics and rigid state from `bodies`.

This selected case has negligible rotation by symmetry and isotropic inertia. Including rotational K prevents an incomplete ledger, but does not validate torque, anisotropic rigid dynamics, arbitrary geometry, relativistic material energy, or full passive M6 acceptance. Momentum/stress validation remains separate.


## Signed work and diagnostic precision

The revised quantity is displayed as body rest-frame work estimate. For a stationary body it exactly follows the accepted current's native E-average work. It is not guaranteed positive Joule heat: a deliberately under-resolved compact electric loop at CFL0.9 gives negative work on its first explicit-current step. The regression preserves the signed result without clipping. Resolved CFL0.5 stationary work equality and positive cumulative dissipation are checked separately. Passive, time-centered constitutive integration remains additional work; changing reporting does not establish that physical property.

The optional field audit subsequently gained compensated volume summation to resolve small exchanges on the large uniform magnetic background. A fresh maintained-script run after both changes uses:

```powershell
node scripts/audit-maxwell-passive-energy.mjs --grids 32 --time-grid 32 --time-factors 1,4 --json artifacts/maxwell-passive-energy-compensated.json
```

The run completed with unchanged numerical sources. Cumulative field-only residuals are now `2.03e-17 J` at baseline dt and `-8.01e-18 J` at dt/4, rather than approximately `1.3e-13 J` with naive summation. The actual moving matter residuals remain `-2.05385e-11 J` and `-1.99296e-11 J`; improved measurement precision does not remove the physical/numerical coupling floor. The historical before/after heat tables above used the earlier summation implementation and their recorded hashes distinguish them from this later diagnostic-only correction.

Retaining one step of edge currents, path weights and geometry adds allocation and field-gather overhead. Throughput and memory for this increment have not been benchmarked; earlier performance measurements are historical and must not be read as a current cost guarantee.
