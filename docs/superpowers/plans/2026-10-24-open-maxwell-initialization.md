# Open initial-state correction

The approved full-Maxwell plan requires compatible initial Gauss fields and meaningful moving-capacitor convergence. Review found that open initialization includes bare charge potential but omits induced electrode multipoles. Plate-only preparation therefore uses a grounded finite exterior box. Fixed PML cell counts also move that box during refinement.

Implement a one-time free-space initial solve for fully PML scenes with the open electrostatic boundary selected. Retain the compatible nodal Poisson/forward-gradient/backward-divergence operator. No electrostatic correction is applied during time stepping.

1. Use a reusable geometric Coulomb tree (quadrupole moments, controlled opening angle) plus direct summation reference. Geometry and opening decisions must be independent of charges so the boundary map is linear. Compare neutral signed distributions against direct sums and refine the tree criterion independently.
2. Reconstruct physical vacuum-equivalent charge epsilon_0 div_h E only on known charge/material support, excluding artificial backing-wall charge. Dielectric polarization must contribute, not just free rho.
3. Solve boundary self-consistency with restarted GMRES, rather than assume fixed-point contraction. Apply the existing interior solver to zero-source, zero-electrode boundary responses. Reconstruct the actual initial state with source charge, electrode potentials and the solved boundary potential. Require explicit residual convergence or throw.
4. Apply the same boundary operator to floating-electrode background and unit-potential capacitance solves. Preserve physical body-owned charge accounting.
5. Test direct/tree numerical agreement, boundary self-consistency, isolated charge and floating charge, stationary no-spurious-B behavior, and independent mesh/domain refinement. Re-run existing source/conductor/browser tests. Record limitations and actual measured cost.

Physical PEC walls retain their own boundary conditions; mixed PEC/open domains require separate validation and will retain the declared finite preparation model. The exterior must be vacuum, with physical matter inside the scene domain. The open boundary uses continuum Coulomb potential on finite-grid charge, whose discrepancy from the discrete infinite-grid Green function is a numerical error to refine, not a claim of exact continuum self-force.
