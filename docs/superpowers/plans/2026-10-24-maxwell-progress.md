# Maxwell implementation progress

Plan: `2026-10-24-full-maxwell-fdtd.md`.

Rollback: commit `236145c`, tag `checkpoint-before-maxwell-2026-10-24`; implementation branch `feature/maxwell-engine`.

Baseline verified: 38 tests and production build pass (existing bundle-size warning).

The user approved implementation and additionally requested a cost-saving, explicitly labelled approximation option with validity conditions.

Ruling: keep the current workspace on a dedicated branch rather than relocate the running website into a second worktree. The checkpoint preserves the current version; this keeps the user's existing launch path usable.

Ruling: the approximation switch is explicit and saved. Existing scene files retain their previous solver unless switched. Unsupported full-Maxwell material/source models must give an actionable error, never fall back silently.

Ruling: first moving conductive medium uses finite conductivity and transported charge, with its specified material law. Do not advertise an unvalidated moving PEC mask as a moving conductor solver. Voltage-initialized isolated conductors must be chosen explicitly; maintaining voltage requires explicit feeds.

| Milestone | Dependencies / shared contracts | Status |
| --- | --- | --- |
| M1 replay + approximation controls | Store resetRequest -> controller.reset; scene authored/runtime split | Implemented; store and browser replay tests pass. Old worker generations invalidated immediately on physical edits. |
| M2 compatible Yee core | SI, edge E/J, face B, node rho; backward divJ, forward divB | Float64 CPU core verified for stated cases, including native Meep wave comparison; Float32/backend comparison remains. |
| M3 materials/CPML | Core coefficient arrays; boundary diagnostics | Stationary epsilon/mu/conductivity, PEC and CPML tested quantitatively. Optional Drude ADE and a finite-volume field-energy/flux validation implemented. General angle/frequency sweeps and a closed coupled mechanical ledger remain. |
| M4 sources/initialization | Conserved CIC trajectory deposition; scene compiler | Charges, impressed filaments, current dipoles, prescribed M/P sources and one-time electrostatic preparation integrated. Explicit voltage feeds and periodic scene adapter remain unsupported. |
| M5 moving conductors | Conserved advection, specified rest-frame Ohm law, geometry | Experimental finite-conductivity bodies with separate owned charge. Stationary and selected co-translating capacitor mesh/domain regressions pass. Changing-gap/fed motion, general interfaces/rotation and force/momentum validation remain. |
| M6 force-driven dynamics | Shared physical dt, field gather, momentum/current deposition | Relativistic particle leapfrog, distributed charge forces and quaternion Newton-Euler integration implemented with focused tests. Resolved passive wire feedback implemented with sign/zero-injection regressions; quantitative coupled energy/momentum acceptance remains in progress. |
| M7 browser integration/performance | Worker, overlays, single clock, migration, benchmarks | CPU browser worker, synchronized poses/probes/lines and measured benchmark implemented; GPU/backend validation and complete preset migration remain. |

No milestone is accepted solely because it has implementation code. Numerical validation and limitations are recorded before completion claims.

Ruling: present the new scene solver as experimental until the remaining moving-matter and force-feedback acceptance checks pass. The actual Maxwell curl evolution is implemented; this is not a claim that every gadget/material model in the plan is complete.

Ruling: the static reference captured by CPML belongs only to preparation and boundary treatment. The time integrator never reapplies an electrostatic solution or adds an algebraic B-from-E field. An off-center static charge and a prepared stationary capacitor now remain free of artificial magnetic transients.

Ruling: conductor transport must use per-body owned charge, including its own current divergence. Using total rho inside a transport halo was rejected by an observed failing regression: unrelated free charge was entrained and neighboring halos could double the current. Conductive edges join two material nodes, matching the initial equipotential staircase.

Ruling: an unsupported periodic scene, transported driven filament, moving dielectric, magnetic point-current source, or clipped material must give an actionable error rather than silently switch solvers. The periodic core itself is separately validated, including native Meep reference fixtures.

Evidence and reproducibility:

- Native Meep 1.35.0 was installed under ignored `.reference-tools/` using WSL, without changing the website runtime or global system packages. `npm run check:meep` compares six native fixtures against the actual CPU kernel. Maximum normalized RMS difference: `2.51e-16`; smooth-wave continuum refinement ratios: about four. Scope: periodic vacuum and uniform dielectric standing waves only. See `docs/maxwell-meep-validation.md`.
- `docs/maxwell-core-validation.md` records Fresnel amplitudes, PEC cavity frequency, conductive attenuation/loss and normal/oblique CPML reflection. Coarse-grid target misses are retained explicitly.
- `docs/maxwell-performance.md` records actual CPU scene preparation, stepping, sampling, retained buffers and payload measurements. The admission estimate is conservative memory budgeting, not an exact allocation measurement.
- A smooth-start uniform-velocity charge benchmark at 0.01c, after 4.008 ns, measured magnetic relative errors 7.147%, 1.817%, 0.676% at resolutions 16, 32, 64; electric errors 12.524%, 2.309%, 0.550%. Relative Gauss residuals stayed below `3e-15`. Abrupt current startup produced substantial mesh ringing; resolving source bandwidth and shape is required. See `tests/maxwell/moving-fields.test.ts`.
- Browser checks verify edit-preserving rewind/replay, one field/pose/probe clock, isolated electrode initialization, magnetic response and paused display edits. These checks are workflow regressions, not a substitute for moving-body convergence benchmarks.

Further review corrections: force gathering now uses charge-compatible node averaging; PEC preparation matches wall conditions; explicit prescribed particles without trajectories remain fixed. Conductivity admission includes the combined wave/current bound and material wave speed. Separate conducting bodies sharing a material edge are rejected instead of silently adding unstable conductivities. These fixes were reproduced with failing regressions before implementation.

Passive wire/loop/coil controls explicitly select impressed current or finite-conductivity material. Physical diameter must span three cells; user geometry is never enlarged silently. Self-overlaps within one wire form conducting contact, without insulation. Separate-body contact and merging are unsupported. Full-mode particle controls now expose only the active initial velocity rather than duplicate legacy data.

Integral Faraday and Ampere-Maxwell tests check finite-surface flux against oriented boundary circulation, including displacement, impressed and Ohmic current. They complement local divergence and continuum benchmarks.

Earlier investigation (superseded by the carried-lattice correction below): the translating-capacitor limit had not passed mesh/domain convergence. Preparation's finite outer boundary omits induced electrode multipoles; a near 1% result from one geometry is not sufficient acceptance. See the measured caveats in `docs/maxwell-moving-validation.md`.

Open initial-state correction implemented: self-consistent Coulomb boundary Schur GMRES, compatible E/rho reconstruction, physical equivalent charge including dielectric response, floating-electrode superposition and a charge-independent quadrupole tree. Focused open/scene tests pass; independent review mixed two floating electrodes, dielectric, external field and free charge, recovering owned charges within 5e-21 C and exact replay. This fixes the grounded-box omission for fully PML/open scenes, not the remaining subcell conductor transport defect. Wider-gap capacitor checks still fail despite the corrected boundary. See `2026-10-24-open-maxwell-initialization.md`.

Moving-material correction: the previously observed 39% wider-gap capacitor error was reproduced as a failing test, then addressed with a body-carried conducting lattice. Charge transfer and convection use compatible CIC current deposition; conduction uses the exact adjoint electric line-integral gather. Snapshot/reset includes lattice charge. The fixed-physical-PML-thickness capacitor study now measures 1.231%, 0.562%, 0.329% magnetic relation error at 16/32/64 cells, with separate domain enlargement improving the coarse case to 0.705%. This accepts that selected finite-conductivity case; it does not accept all M5/M6 requirements. Current admission uses the actual E-response stencil row bound, including synchronized-B contribution, rather than a velocity-only heuristic. Neutral material nodes are speed-checked, and force-driven rigid material-point speed is limited to the declared 0.01c range.

Direct-load experimental Maxwell capacitor and passive pickup demos now provide explicit solver/material setup and authored MHz motion on the physical nanosecond clock. Full mode exposes 16/24/32/48/64 cell choices; saved legacy presets keep their approximation selection. Native Meep remains an offline reference only.

Stationary Drude integration: optional SI omega_p/gamma material controls, lazy pole state, combined wave/plasma and conductive timestep admission, free-carrier charge continuity and exact snapshot/replay of all auxiliary currents. Uniform plasma and selected 1/2 GHz reflection/attenuation/phase benchmarks meet their stated targets and refine. Full probes now include implicit Ohmic/Drude current at the preceding update half-time; field samples remain synchronized at the displayed time. Energy labels separate the approximate carrier contribution from field energy. The finite-volume discrete Poynting check closes field energy, boundary flux and all-current work in selected material/moving scenes, without claiming a complete mechanical ledger.

A browser reload regression exposed loss of edits inside the 700 ms autosave debounce. The page-hide/visibility flush now saves the latest authored scene, and the Drude switch/reload regression passes. Inactive material parameters remain saved. Full unit suite at this point: 168 tests in 39 files passed; production build passed; all 10 browser tests passed after the persistence correction. The 48-cell open-boundary capacitor preparation exceeded the former 15-second browser wait; the test now waits up to 60 seconds for explicit readiness, without changing physics assertions. Independent review found no confirmed defect and checked spatially varying material energy/flux closure; the regression now includes that case.
