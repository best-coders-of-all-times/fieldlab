# Coupled Maxwell conservation audit

The current force-driven scene solver **fails the M6 closed-reference energy requirement**. Its exact field-only Yee balance closes, while mechanical kinetic energy does not account for the measured field-current work. Existing finite physical charged spheres also have an unsettled energy-refinement sequence. No complete momentum or torque acceptance is established.

The versioned audit runs the actual `MaxwellSceneSolver`, charge deposition, centered force gather, field evolution and mechanics. It uses existing point charges and uniform-volume charged spheres. It does not substitute an analytic field overlay, alter source quadrature, or load an experimental solver.

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

Point momentum is stored at `t−dt/2`. The audit applies a local Boris half kick using E and synchronized B at the current position to estimate integer-time momentum, without changing the accepted simulation state. Its relativistic kinetic energy is evaluated with the cancellation-safe expression `p² / [m (sqrt(1+(p/mc)²)+1)]`. This is a synchronization estimate, not an exact coupled invariant. The stored `body.velocity` still belongs to the particle half step and is not used as integer-time kinetic energy.

Spheres use the actual integer-time Newtonian velocity returned by `advanceRigidBody`, plus rotational energy. A particle half kick is not applied to rigid bodies. The rigid update samples force at the old field time; it has no implicit, time-centered work synchronization with the field update. `mechanicalWork` is retained as a diagnostic, but the audit computes kinetic energy directly instead of treating that diagnostic as a closed energy ledger.

The scene's `sourceParticleWork` and synchronized `sourceParticleKinetic` diagnostics cover source point particles. Their scope excludes the distributed rigid spheres. In the fresh quick run, independently integrated point field-current work agreed with `sourceParticleWork` to about `3.4e-24 J`, and independently estimated point K matched `sourceParticleKinetic`.

## Measured energy failure

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

## Momentum scope and remaining algorithmic work

The script integrates actual `ε0 E × B` over the finite box. Native E edges are averaged over four transverse edges to cell centers; synchronized B faces are averaged over two faces along their component axis. Mechanical momentum uses the same point synchronization estimate or actual rigid velocity described above. It records total momentum change and a fixed physical impulse scale `q0² T / (4π ε0 d²)`, with `q0 = 1 nC` and initial separation d.

The fresh asymmetric sphere baseline momentum-change norms decrease from `2.0354e-20` to `1.6104e-20 kg m/s` at N=16/24. The earlier N=32/48 values were `1.3068e-20` and `8.9263e-21 kg m/s`. The original asymmetric point sequence instead gives roughly `1.14e-18`, `1.11e-18`, `1.45e-18 kg m/s` at N=16/24/32. These are measured finite-volume momentum changes, **not complete momentum conservation residuals**: the integrated Maxwell-stress impulse, initial-tail/boundary discretization bound, and torque ledger are missing. Symmetric cancellation alone supplies no meaningful acceptance evidence.

The centered nodal CIC force gather cancels homogeneous electrostatic mesh self-force, but it differs from the electric gather adjoint to trajectory-current deposition. Moving a mesh charge changes its discrete Coulomb self-energy without the corresponding mesh force in that gather. Point CIC support also shrinks with h, so raw point self-energy diverges under refinement. A fixed physical uniform sphere avoids that particular width limit, but its 192 discrete quadrature elements have not been independently converged against translation phase and mesh refinement.

The next numerical design must test force/deposition pairing and source-shape integration together. A finite physical smooth shape needs a declared fixed width and converged integration against the deposition basis. An energy-compatible time-centered trajectory solve must also pass self-force and total-momentum checks; replacing the gather alone can exchange an energy defect for mesh thrust. Frozen finite-cloud translations can isolate the work/energy-gradient mismatch before broader coupled runs, provided the omitted Coulomb-tail energy is accounted for. Complete energy and Maxwell-stress surface ledgers, asymmetric cases, quadrature refinement and separate h/dt refinement remain required. The failed coupling requirement is retained; passing field-only tests or reporting the new work diagnostic does not close M6.
