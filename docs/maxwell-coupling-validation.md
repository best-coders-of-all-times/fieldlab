# Coupled Maxwell conservation audit

The legacy CIC point and uniform-sphere sources **fail the M6 closed-reference energy requirement**. Their exact field-only Yee balance closes, while mechanical kinetic energy does not account for the measured field-current work. The new explicitly selected smooth source substantially improves the measured energy budget and shows approximately second-order time refinement in the cases below. It retains a measurable mesh self-thrust. No complete momentum, torque, or general M6 acceptance is established.

The versioned audit runs the actual `MaxwellSceneSolver`, source-profile force gather, charge deposition, field evolution and mechanics. It supports legacy point charges, uniform-volume charged spheres, and the explicit finite smooth profile. It does not substitute an analytic field overlay, alter source quadrature, or load an experimental solver.

## Reproduction and provenance

From the repository root, using the installed Node/Vite dependencies:

```powershell
node scripts/audit-maxwell-coupling.mjs --quick --json artifacts/maxwell-coupling-audit-quick.json
```

This runs both source models, symmetric/asymmetric pairs, mesh resolutions 16 and 24, and a factor-two time refinement at resolution 24. Overlapping mesh/time baseline rows are run once: 12 distinct cases. A complete default study adds resolutions 32 and 48 and a factor-four time refinement:

```powershell
node scripts/audit-maxwell-coupling.mjs --json artifacts/maxwell-coupling-audit.json
```

Selected reproductions:

```powershell
node scripts/audit-maxwell-coupling.mjs --model point --variant symmetric --study mesh --grids 16,24,32
node scripts/audit-maxwell-coupling.mjs --model sphere --variant asymmetric --study time --time-grid 24 --time-factors 1,2,4
node scripts/audit-maxwell-coupling.mjs --help
```

The existing default `--model all` retains the legacy point and sphere studies. Smooth sources are an explicit opt-in, keeping the legacy audit's scope and cost stable:

```powershell
node scripts/audit-maxwell-coupling.mjs --model smooth --grids 16,24,32 --time-grid 32 --time-factors 1,2,4 --json artifacts/maxwell-smooth-coupling-audit.json
node scripts/audit-maxwell-coupling.mjs --model smooth --shift .013 --grids 16,24,32 --time-grid 32 --time-factors 1,2,4 --json artifacts/maxwell-smooth-coupling-shifted.json
```

`--width` sets the smooth source's physical width in metres, default 0.075 m. It does not scale with the mesh. `--shift` translates both centers along x in metres, default zero, allowing placement sensitivity to be measured without changing their separation. Both parameters are recorded in the JSON; invalid or clipped profiles are rejected by the actual solver. `--isolated --model smooth` selects a single resting source and suppresses pair variants; `--position x,y,z` selects its initial physical position.

`--json` accepts paths inside the ignored `artifacts/` directory. Each run records arguments, Node/platform, Git HEAD/branch/status, source SHA-256 hashes, complete initial/final measurements, and physical parameters. Engine/scene source hashes are compared before and after execution; changed files are flagged. The middleware Vite server disables WebSockets and does not start the application's HTTP server. Exit 0 means the audit completed; it is not a conservation acceptance result.

The 12-case quick command above completed on 2026-10-24 with Node v24.19.0 on Windows, branch `feature/maxwell-engine`, HEAD `8a2cb71d56166b6bae3bb06eba617faa4d16dc10`, with working-tree changes recorded in its JSON. No hashed source changed during that run. The additional 32/48 and factor-four measurements below are identified separately as the preceding exploratory study; they are reproducible with the versioned script's equivalent selectors.

## Physical models and initial data

All cases use a 1 m vacuum cube centered at the origin, Float64 CPU fields, four PML cells on each side, open Coulomb initialization, initially resting sources, and no impressed external E/B or feeds. The positive charge is 1 nC and its mass is `1e-23 kg`. Both objects use `forceDriven` dynamics.

| Property | Point pair | Existing uniform-volume sphere pair |
| --- | --- | --- |
| Initial centers | `(−0.125,0,0)`, `(0.125,0,0)` m | `(−0.20,0,0)`, `(0.20,0,0)` m |
| Physical sphere radius | None; CIC support depends on h | 0.10 m |
| Source representation | One CIC charge per object | Existing four radial shells × 48 angular points: 192 CIC elements per object |
| Final physical time | 0.40 ns | 0.30 ns |
| Symmetric right charge/mass | −1 nC / `1e-23 kg` | Same |
| Asymmetric right charge/mass | −0.8 nC / `1.2e-23 kg` | Same |

The sphere's three declared principal inertias are each `4e-26 kg m²`, including the asymmetric right sphere; angular velocities begin at zero. The inertias are isotropic, so rotational kinetic energy can be evaluated from world angular velocity without a frame conversion. Observed sphere speeds are below the implemented rigid-body limit of 0.01c. Point speeds reach about 0.018c and use relativistic mechanics.

For each mesh, the baseline step count is `ceil(T c sqrt(3) N / 0.7)`. CFL is selected to reach the same final physical time exactly with that count; it remains at most 0.7. Time refinement multiplies the count while retaining the same mesh, initial data and final time. These are authored nanosecond experiments, with no rescaling of a user's trajectory.

The budget volume is a box in the ordinary Yee region, outside CPML, with a one-cell sampling halo. For padded physical index bounds it uses `low = physical.low + 1` and `high = physical.highExclusive − 3`, inclusive. In this cubic study that is `[5,5,5]` through `[N+2,N+2,N+2]`. Initial Coulomb tails inside the box are included. Physical radiative disturbances have not reached its surface at the selected final times, but the initial fields are noncompact: boundary energy flux is measured rather than assumed zero. Numerical precursor/tail effects are retained in that measurement.

## What the audit measures

At each field step, `measureFieldBalance` measures the exact discrete Yee field energy, work on matter and outward boundary energy. In vacuum,

```text
U_Yee(n) = ΔV/2 Σ [ε0 E(n)^2 + B(n−1/2) B(n+1/2)/μ0]
W_matter = Δt ΔV Σ [(E(n)+E(n+1))/2] · J_update
R_field = ΔU_Yee + W_matter + outward_boundary_energy
```

Component products use native Yee locations and the kernel's constants. `B(n+1/2)` is obtained from the next Faraday half-time value using `2 B_synchronized(n) − B(n−1/2)`. The separately reported physical energy estimate squares synchronized B instead. That estimate is useful for physical readouts but is not the exact discrete invariant. The script records both coupled residuals and their difference.

The coupled energy residual is

```text
R_coupled = ΔU_Yee + ΔK_mechanical + outward_boundary_energy
transfer_scale = max(|ΔK_mechanical|, |Σ W_matter|, 1e−40 J)
signed_relative_residual = R_coupled / transfer_scale
```

It also records `ΔK − ΣW_matter`, every step's field-balance residual, and the accumulated field ledger. This distinguishes field integration from force/deposition coupling. Normalizing by transferred energy prevents a large initial point self-energy from hiding the error. This normalization describes the measured defect; it does not replace an approved accuracy target.

Point momentum, including an explicitly selected smooth source, is stored at `t−dt/2`. The audit applies a local Boris half kick using `sampleSourceForForce(object, position)`, matching the selected shape's E and synchronized B gather, to estimate integer-time momentum without changing the accepted simulation state. Its relativistic kinetic energy is evaluated with the cancellation-safe expression `p² / [m (sqrt(1+(p/mc)²)+1)]`. This is a synchronization estimate, not an exact coupled invariant. The stored `body.velocity` still belongs to the particle half step and is not used as integer-time kinetic energy.

Spheres use the actual integer-time Newtonian velocity returned by `advanceRigidBody`, plus rotational energy. A particle half kick is not applied to rigid bodies. The rigid update samples force at the old field time; it has no implicit, time-centered work synchronization with the field update. `mechanicalWork` is retained as a diagnostic, but the audit computes kinetic energy directly instead of treating that diagnostic as a closed energy ledger.

The scene's `sourceParticleWork` and synchronized `sourceParticleKinetic` diagnostics cover source point particles. Their scope excludes the distributed rigid spheres. In the fresh quick run, independently integrated point field-current work agreed with `sourceParticleWork` to about `3.4e-24 J`, and independently estimated point K matched `sourceParticleKinetic`.

## Measured legacy energy failure

These baseline rows were reproduced by the quick command above. Energy values are in joules; the percentage is signed residual divided by the transfer scale.

| Model / pair | N | Steps | ΔK | Field-current work | Coupled residual | Relative residual |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Point / symmetric | 16 | 5 | 3.0013e-10 | 1.1319e-8 | −1.1018e-8 | −97.348% |
| Point / symmetric | 24 | 8 | 2.1490e-10 | 2.0442e-8 | −2.0227e-8 | −98.949% |
| Point / asymmetric | 16 | 5 | 1.9089e-10 | 7.1297e-9 | −6.9389e-9 | −97.323% |
| Point / asymmetric | 24 | 8 | 1.4086e-10 | 1.3098e-8 | −1.2957e-8 | −98.925% |
| Sphere / symmetric | 16 | 4 | 2.9976e-11 | 3.3932e-11 | −3.9561e-12 | −11.659% |
| Sphere / symmetric | 24 | 6 | 2.8661e-11 | 2.5342e-11 | +3.3189e-12 | +11.580% |
| Sphere / asymmetric | 16 | 4 | 1.7650e-11 | 2.0382e-11 | −2.7325e-12 | −13.406% |
| Sphere / asymmetric | 24 | 6 | 1.6901e-11 | 1.5351e-11 | +1.5503e-12 | +9.173% |

The maximum absolute per-step field-only residual in the quick run was `3.12e-21 J`. The largest accumulated outward boundary energy was `3.63e-16 J`, from a coarse sphere case. Both are far smaller than the coupled defects. In the original point study, changing from exact Yee to synchronized-B-squared field energy changes the coupled residual by roughly `5e-13` to `1.5e-12 J`; it cannot explain defects around `1e-8 J`.

The preceding exploratory runs of the same production source representations extended the mesh sequence:

| Model / pair | N=32 coupled residual | N=48 coupled residual | N=32 / N=48 relative residual |
| --- | ---: | ---: | ---: |
| Point / symmetric | −3.1758e-8 J | Not measured in that study | −99.483% / — |
| Point / asymmetric | −2.0646e-8 J | Not measured in that study | −99.453% / — |
| Sphere / symmetric | −8.3758e-12 J | +7.6927e-13 J | −22.941% / +2.773% |
| Sphere / asymmetric | −5.4114e-12 J | −8.4418e-13 J | −24.582% / −4.900% |

Point energy error worsens under the measured refinement. Existing sphere results oscillate and have not demonstrated an accepted convergence sequence. A smaller single sphere error at N=48 does not establish a convergence order or general accuracy.

At fixed N=24, reducing dt also leaves a substantial defect. Factors one and two were reproduced by the quick audit; factor four below is from the preceding original-sphere exploratory run.

| Model / pair | Baseline steps / residual | Twice the steps / residual | Four times the steps / residual |
| --- | --- | --- | --- |
| Point / symmetric | 8 / −2.0227e-8 J | 16 / −2.0213e-8 J | Not measured in that study |
| Point / asymmetric | 8 / −1.2957e-8 J | 16 / −1.2950e-8 J | Not measured in that study |
| Sphere / symmetric | 6 / +3.3189e-12 J | 12 / +3.2580e-12 J | 24 / +3.2271e-12 J |
| Sphere / asymmetric | 6 / +1.5503e-12 J | 12 / +1.5226e-12 J | Not measured in that study |

## Explicit smooth source: energy improvement and remaining self-thrust

The two smooth commands above completed on 2026-10-24 at HEAD `219357f146b7cfdadd787806406abb979dbed70b`, with the new smooth implementation present as recorded working-tree changes. Both runs recorded no engine/scene source changes during execution. They each contain 10 distinct cases: mesh N=16/24/32 and time factors 1/2/4 at N=32, for symmetric and asymmetric pairs.

The smooth model uses charge objects with `sourceProfile: 'smooth'` and `sourceWidth: 0.075`. Centers begin at x=±0.20 m plus the declared shift, final time is 0.30 ns, and charges/masses match the sphere-pair values above. This is a different declared physical charge density from a uniform sphere or a mesh-sized CIC point. It is a tensor product of normalized cubic B-spline (`beta3`) densities in laboratory axes. Density support extends ±2 widths along each Cartesian axis; width is neither a radius nor a Gaussian standard deviation. Its convolution with the nodal CIC tents is integrated analytically, avoiding a finite point-quadrature representation.

The production solver transports this shape with endpoint charge-conserving current weights and gathers the instantaneous electric force using the derivative of its deposited shape. Its magnetic force is averaged over the cloud. This is not an implicit finite-time work solve: temporal truncation error remains measurable. All following numbers come from actual field and particle evolution with that implementation.

| Pair | N | Steps | Exact coupled residual (J) | Residual / transfer |
| --- | ---: | ---: | ---: | ---: |
| Symmetric | 16 | 4 | −3.6540e-14 | −0.13366% |
| Symmetric | 24 | 6 | −1.8887e-14 | −0.06795% |
| Symmetric | 32 | 8 | −1.0985e-14 | −0.04010% |
| Symmetric | 32 | 16 | −2.7425e-15 | −0.01001% |
| Symmetric | 32 | 32 | −6.8540e-16 | −0.00250% |
| Asymmetric | 16 | 4 | −1.6942e-14 | −0.10505% |
| Asymmetric | 24 | 6 | −8.7961e-15 | −0.05349% |
| Asymmetric | 32 | 8 | −5.1136e-15 | −0.03154% |
| Asymmetric | 32 | 16 | −1.2766e-15 | −0.00788% |
| Asymmetric | 32 | 32 | −3.1905e-16 | −0.00197% |

At fixed N=32, halving dt reduces the residual by approximately four for both pairs. Across the baseline meshes, kinetic energy transfer remains substantial: symmetric ΔK is approximately `2.73–2.78e-11 J`; asymmetric ΔK is `1.61–1.64e-11 J`. Source-particle work diagnostics agree with the independently accumulated field-current work within `4.3e-26 J`; the independent shape-matched kinetic-energy readout agrees exactly with the scene diagnostic in the unshifted run.

Changing the phase with `--shift .013` gives symmetric residuals `−3.7393e-14`, `−1.8727e-14`, `−1.0987e-14 J` at N=16/24/32, and `−6.8551e-16 J` at N=32 with factor-four time refinement. The corresponding asymmetric values are `−1.7420e-14`, `−8.7327e-15`, `−5.1141e-15 J`, and `−3.1908e-16 J`. Thus the selected energy improvement survives this translation. Trajectory accuracy is a separate observable: symmetric ΔK changes by about 2.17%, 0.95%, and 0.053% between the two placements at N=16/24/32, despite their similar energy residuals.

Maximum per-step field-only residuals were `1.37e-21 J` unshifted and `1.04e-21 J` shifted. Accumulated boundary energy reaches `1.76e-15 J` in the shifted coarse case and is included in every budget. For this smaller error regime, the physical synchronized-B energy estimate is materially different from exact Yee energy: at N=32, symmetric baseline and factor-four results differ by `6.88e-15` and `4.29e-16 J`, respectively. The table consistently uses exact Yee energy.

The isolated-rest control uses the actual solver, one 1 nC smooth charge, mass `1e-23 kg`, width 0.075 m, no other source or applied field, and final time 0.30 ns. It uses the same baseline CFL choice and two fixed physical initial positions. Reproduce both phases through the versioned audit:

```powershell
node scripts/audit-maxwell-coupling.mjs --isolated --model smooth --study mesh --grids 16,24,32 --json artifacts/maxwell-smooth-isolated-phase1.json
node scripts/audit-maxwell-coupling.mjs --isolated --model smooth --position .0065,.0085,.0105 --study mesh --grids 16,24,32 --json artifacts/maxwell-smooth-isolated-phase2.json
```

The first position defaults to `(0.013,0.017,0.021)` m. Initial force, synchronized final velocity, displacement, actual field-current work, full energy diagnostics, and provenance are recorded. The initial force and final synchronized speed expose the finite-mesh self-thrust:

| Initial position (m) | N | Initial force norm (N) | Final estimated speed (m/s) |
| --- | ---: | ---: | ---: |
| `(0.013,0.017,0.021)` | 16 | 1.3647e-9 | 40245 |
| Same | 24 | 2.1431e-10 | 6303 |
| Same | 32 | 1.3208e-11 | 388 |
| `(0.0065,0.0085,0.0105)` | 16 | 1.1152e-9 | 32888 |
| Same | 24 | 3.2740e-10 | 9629 |
| Same | 32 | 2.2143e-11 | 651 |

The six isolated cases were first measured by a direct exploratory production-solver probe and then reproduced through the two versioned commands above. They are explicit isolated controls, not extra cases silently included in the pair audit. The JSON has `separation: null`; the fixed impulse reference still uses 1 nC charges separated by 0.4 m for comparison, without introducing a second source. The finite box/open preparation is a numerical boundary treatment, so this is not an analytic all-space self-force proof. The measured thrust decreases strongly under refinement at both sampled positions, but remains substantial on the coarse grid. At the first position, its final mechanical impulse is 2.39%, 0.374%, and 0.0230% of that reference scale at N=16/24/32. Conserving discrete energy more accurately does not eliminate this mesh force or establish physical trajectory accuracy.

## Momentum scope and remaining algorithmic work

The script integrates actual `ε0 E × B` over the finite box. Native E edges are averaged over four transverse edges to cell centers; synchronized B faces are averaged over two faces along their component axis. Mechanical momentum uses the same point synchronization estimate or actual rigid velocity described above. It records total momentum change and a fixed physical impulse scale `q0² T / (4π ε0 d²)`, with `q0 = 1 nC` and initial separation d.

The fresh asymmetric sphere baseline momentum-change norms decrease from `2.0354e-20` to `1.6104e-20 kg m/s` at N=16/24. The earlier N=32/48 values were `1.3068e-20` and `8.9263e-21 kg m/s`. The original asymmetric point sequence instead gives roughly `1.14e-18`, `1.11e-18`, `1.45e-18 kg m/s` at N=16/24/32. These are measured finite-volume momentum changes, **not complete momentum conservation residuals**: the integrated Maxwell-stress impulse, initial-tail/boundary discretization bound, and torque ledger are missing. Symmetric cancellation alone supplies no meaningful acceptance evidence.

The new unshifted smooth asymmetric sequence gives momentum-change norms `1.0368e-19`, `1.0541e-20`, `7.4969e-21 kg m/s` at N=16/24/32. The shifted symmetric pair, which avoids exact symmetry about the grid, gives `1.5084e-19`, `3.4166e-20`, `2.4205e-21 kg m/s`. These selected sequences improve, but the missing stress flux prevents interpreting their small values as a complete conserved-momentum result. N=32 time refinement leaves a spatial floor in these momentum changes.

The centered nodal CIC force gather cancels homogeneous electrostatic mesh self-force, but it differs from the electric gather adjoint to trajectory-current deposition. Moving a mesh charge changes its discrete Coulomb self-energy without the corresponding mesh force in that gather. Point CIC support also shrinks with h, so raw point self-energy diverges under refinement. A fixed physical uniform sphere avoids that particular width limit, but its 192 discrete quadrature elements have not been independently converged against translation phase and mesh refinement.

Force/deposition pairing and source-shape integration must be assessed together. The explicit smooth model now supplies a declared physical width, analytic integration against the deposition basis, and improving selected energy budgets; it also exposes a measurable, placement-sensitive mesh force. Wider width-resolution/phase studies and physical trajectory comparisons remain necessary. An alternative time-centered trajectory solve must also pass self-force and total-momentum checks. Complete energy and Maxwell-stress surface ledgers, asymmetric cases, separate h/dt refinement, and validation of the other supported force-driven bodies remain required. The legacy failed coupling requirement is retained; the improved finite-shape energy results do not close general M6 acceptance.
