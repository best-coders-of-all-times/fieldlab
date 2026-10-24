# Analytic finite smooth-source coupling

The pure helper in `src/engine/maxwell/smoothCharge.ts` implements task 1 of the [smooth-source plan](superpowers/plans/2026-10-24-smooth-charge-coupling.md). It provides charge assignment, endpoint-conserving current and a compatible instantaneous electric gather. This helper does not implement temporal particle integration, a field solve, scene controls, or full M6 acceptance.

## Coordinates, density and native arrays

`center`, `from`, `to`, and `width` are in metres, measured from node zero. The continuum source is

`rho(x)/q = product_a beta3((x_a-center_a)/width)/width`,

where the centered cubic B-spline `beta3` integrates to one and has support `[-2,2]`. The physical support is therefore `center ± 2*width` on every axis. Width is an explicit source parameter, independent of grid spacing.

The complete density support must lie inside `[0,(n_a-1)*h_a]` on every axis. Support may touch this boundary, where the density vanishes. The pure deposition helper has no additional one-cell margin requirement: tents belonging to exterior nodes have zero overlap with a density wholly inside the closed node domain. Clipped clouds and periodic wrapping are unsupported and throw before deposition changes arrays.

All fields and deposits use flattened index `i + nx*(j + ny*k)`. Charge occupies nodes. Component `Ex[index(i,j,k)]` belongs to the forward edge from `(i,j,k)` to `(i+1,j,k)`, with analogous conventions for `Ey` and `Ez`. The last node on an axis has no forward edge on that axis and is never gathered or assigned current. Arrays may be Float32 or Float64; analytic shape arithmetic is Float64.

## Analytic assignment and derivative

`smoothChargeWeights` returns one-dimensional nodal weights `x,y,z` and their derivatives with respect to the corresponding center coordinate, `dx,dy,dz`, in inverse metres. Each assignment is the analytic integral of the density against the native CIC tent, rather than a collection of aligned particle samples.

The integral is mathematically the planned second difference of `F2`. To avoid subtracting nearly equal antiderivative values, the implementation splits at density knots and tent corners and integrates each cubic-density × linear-tent polynomial exactly. If the cubic's Taylor coefficients at an interval midpoint are `b0..b3`, its half length is `a`, and the tent midpoint/slope are `T,m`, the integral is

`2*a*(b0*T + (b2*T+b1*m)*a^2/3 + b3*m*a^4/5)`.

The center derivative integrates density times `+1/h` on the rising tent and `-1/h` on the falling tent. Near a spline support endpoint, cubic coefficients use the distance from interval endpoints; this retains a positive tail even when the midpoint itself rounds to the zero-density endpoint.

Weights are normalized by their total, with the quotient-rule correction applied to derivatives. A final accumulated-roundoff correction goes into the largest coefficient and its derivative. No physical coefficient is pruned, and negative weights are never clipped. Positive overlap that cannot produce a positive finite Float64 coefficient is rejected. Widths that cannot be resolved in floating-point center coordinates are also rejected; this is a numerical representability check, not a mesh-resolution recommendation.

`depositSmoothCharge(rho,grid,center,width,q)` adds `q*Sx*Sy*Sz/(dx*dy*dz)` in C/m³.

## Current and electric work

For old/new assignments `A,B`, each axis uses `C_i = sum_(j<=i)(A_j-B_j)` on forward edges. For transverse axes `y,z`, the factor is

`Ay*Az + ((By-Ay)*Az + Ay*(Bz-Az))/2 + (By-Ay)*(Bz-Az)/3`.

The returned signed line weight is `W = h*C_i*transverseFactor` in metres. The cyclic expressions form an exact algebraic decomposition of the endpoint tensor-product charge change. This construction integrates a linear interpolation of the endpoint one-dimensional assignments; it is not a claim that a translated continuum cloud follows this interpolation at intermediate times.

`smoothTrajectoryWeights(grid,from,to,width)` exposes `{axis,index,length: W}`. `depositSmoothTrajectory(Jx,Jy,Jz,grid,from,to,width,q,dt)` streams the same weights and adds `q*W/(dt*dx*dy*dz)` in A/m². Backward nodal divergence satisfies endpoint charge continuity to floating-point roundoff for stationary, diagonal and multicell motions. The cumulative sum uses compensated arithmetic; after its final nodal support the zero-total normalized source has no exterior edge flux, so accumulated roundoff is not propagated into an exterior current tail.

The current and geometric weights obey `dt*dv*sum(J*E) = q*sum(W*E)` to arithmetic roundoff. For a compatible native gradient `E_edge = (phi_node-phi_next)/h`, the right side is the endpoint deposited potential-energy decrease.

`gatherSmoothElectric(Ex,Ey,Ez,grid,center,width)` instead uses instantaneous edge weight `-h*sum_(j<=i)(dS_j/dcenter)` times transverse assignments. Discrete summation by parts gives `q*E_gather = -d(sum(rho*phi*dv))/dcenter` for that same compatible gradient. It reproduces a constant electric field and is the vanishing-displacement limit of the corresponding component of the endpoint line weights. Its accumulation uses compensated arithmetic.

## Limits and validation

Grids must have at least two nodes per axis, positive finite spacing, finite representable volume/extents, and no more than `128^3` total nodes. This bounds allocation and each component's support traversal. Deposition and gather stream edge contributions. The explicit `smoothTrajectoryWeights` list is limited to 1,000,000 entries, checked from the one-dimensional support counts before allocating per-edge objects; its error directs callers to streaming deposition or a smaller source/grid. Invalid charge, time step, array size, domain support or unresolvable source is rejected before deposited arrays change. Gather rejects nonfinite contributing field values.

Run `npx vitest run tests/maxwell/smooth-charge.test.ts`. The focused tests cover partition/positivity/support, independent high-order numerical integration across translation phases and anisotropic spacings, center derivatives, positive near-endpoint tails, atomic rejection, Float64 endpoint continuity, current-work adjointness, compatible potential drop and finite-difference energy gradient, constant fields, broad clouds and the instantaneous trajectory limit.

These results validate source geometry and spatial coupling. Closed-system time integration, energy/momentum convergence, physical-width mesh/time/phase studies, and passive-body feedback remain separate acceptance work. Passing these helper tests does not establish M6 acceptance.


## Scene integration and measured limits

Charge and source-particle inspectors explicitly select Legacy grid CIC or Finite smooth cloud and a width in metres. Undefined profile fields keep the legacy shape; switching profiles or solvers preserves inactive parameters. The approximation solver shows that this profile is inactive. Full initialization, prescribed-motion currents, force-driven initial half kick, electric force gather, work diagnostics and replay use the selected profile. Probe samples remain local field values. The lab-axis density does not rotate with the object or apply Lorentz contraction.

Complete density support must remain inside the physical domain. Bare PEC walls additionally require at least one grid cell between density support and the wall, so native charge/force assignment does not overlap the wall's unsupported contact stencil. A reproduced uniform-B attenuation for boundary-overlapping clouds led to this explicit rejection; interior uniform-B gathering is regression-tested. PML padding does not relax the physical-domain support requirement.

The independent actual-solver [coupling audit](maxwell-coupling-validation.md) records selected fixed-width asymmetric pair energy errors of 0.105%, 0.053%, 0.032% at 16/24/32 cells. At fixed 32-cell mesh, halving dt reduces the error by about four twice (to 0.00197% at dt/4). These measurements concern the stated smooth cloud, initial state, time and boundaries only. Legacy CIC sources and existing sphere quadrature retain their documented failed coupling acceptance.

An isolated cloud still experiences artificial mesh self-force. For one recorded phase, its impulse relative to the declared pair Coulomb reference is 2.39%, 0.374%, 0.0230% at 16/24/32 cells. A second phase is also recorded. Good energy bookkeeping does not remove this force error. Resolve the physical width and examine translation phase, spatial/time/domain refinement, and source history before quantitative use. Complete momentum/stress, torque and passive-body energy acceptance remain outstanding.
