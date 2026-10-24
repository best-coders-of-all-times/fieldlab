# Moving conductive material correction

Observed defect: a binary Eulerian conductivity mask can remain unchanged while a body translates by less than one cell. Ohmic screening then pins charge near the old staircase surface even though its advection is conservative. A wider-gap capacitor benchmark loses tens of percent of the expected magnetic response; corrected open initial fields alone do not fix it.

Replace Eulerian body-owned upwind charge transport with a Lagrangian conducting lattice coupled to the fixed Yee grid. The initial resolved material nodes/edges use exactly the same geometry as electrode preparation. Their local coordinates stay attached to the authored body. Charges flow along neighboring material edges through the specified finite-conductivity law and are transported by rigid/prescribed body motion. Both transfers and motion deposit compatible CIC trajectories, so total charge evolves from precisely the supplied current.

- Share geometric trajectory weights between deposition and its adjoint electric line-integral gather. A compatible gradient must integrate to the CIC potential difference; initial equal-potential material edges therefore produce no spurious current.
- Use rest-frame Ohm response integrated along each moving material edge, retaining the existing covariant electric/motional law and resolved cross section. No potential solve or imposed B relation during playback.
- Compute material-node charge Lorentz force with the charge-compatible gather; conducting-edge magnetic force is I dl?B. Keep mechanics explicitly experimental until coupled energy/momentum acceptance passes.
- Use the actual deposition/gather weights to bound explicit conductive stiffness with a row-sum bound, combined with the material wave CFL. Reject overlapping/unresolved separate-body current support rather than silently merge contacts.
- Snapshot material charge alongside fields/bodies for exact rewind. Check stationary preservation, passive induction, grid-fraction translation, compatibility of rho/J, and moving-capacitor relation under geometry/grid/domain variation.

The lattice is a resolved numerical finite-conductivity material, not ideal PEC, a real-metal dispersion model, an insulated circuit network, or exact relativistic deformable mechanics. Initial staircase shape is carried continuously by the body rather than rerasterized every step. Coarse shape and current response require refinement.
