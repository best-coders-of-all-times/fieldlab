# Stationary terminal current source validation

The new wire model is an ideal externally powered current filament with two explicit contacts. It withdraws positive charge from the first body and deposits it in the second; the visible authored route contains the feed and return lead. The two finite-conductivity terminal bodies and the source path must remain stationary. It is a current source, not a voltage clamp, passive lead material, or a complete external circuit.

A source of signed amplitude I uses the cubic startup I(3u^2-2u^3), u=t/T until the selected rise time T; then it supplies I. Each physical step integrates that waveform analytically. For t>=T the transferred charge is Q=I(t-T/2). Changing dt does not change the source's physical ampere meaning. Zero rise time explicitly selects an abrupt startup.

Every nonzero endpoint CIC weight must belong to the selected body's initial material lattice. No endpoint snapping, support pruning, geometry enlargement or weight renormalization occurs. Compatible contact fan currents connect those actual material nodes to the visible path, cancelling free endpoint charge. Transferred charge is independently added/subtracted from the body lattice; Maxwell rho still evolves only from the divergence of the same deposited current. Other bodies sharing the feed's resolved nodal/current support are rejected at preparation and before/after motion. This conservative numerical-contact check can reject physically separated but unresolved geometry; refine or separate it.

## Reproducible CPU case

Run `npx vitest run tests/maxwell/terminal-feed.test.ts tests/maxwell/fed-capacitor.test.ts --reporter=verbose --silent=false`.

The scene test uses Float64 CPU, a 1 m cubic physical domain, 16 cells per side plus four CPML layers, CFL 0.9, two initially neutral plates at x=+/-0.1875 m with dimensions 0.125 by 0.45 by 0.5 m and conductivity 0.01 S/m. A 0.01 A source rises over 1 ns. Its off-node contacts are (-0.18,0.01,0.02) and (0.18,0.01,0.02); the return route runs at y=-0.375 m. Initial E/B and carrier/body charge are zero. This deliberately includes contacts with eight nonzero CIC weights.

After 20 steps, t=2.16656235174 ns:

| Observable | Measured |
| --- | --- |
| Analytic transferred charge | 1.66656235174e-11 C |
| Relative terminal charge error | 2.22e-16 |
| Max independently owned/core density difference, normalized by max owned density | 4.04e-16 |
| Relative electric Gauss residual | 2.53e-16 |
| B_z at (0,0.0625,0) m | 1.36502e-8 T |
| External source work, time-centered E against actual deposited current | 7.57161e-11 J |

A finite control volume outside CPML closes the discrete field energy/work/flux budget to relative residual 7.56e-16 on the selected ninth step. Source work uses the full adjoint path/contact integral and time-centered E. This is field-to-matter work accounting; the separately displayed body heat remains a numerical estimate, and a closed general mechanical ledger is still outstanding.

At step 31 an Ampere-Maxwell contour cutting the return lead measures conduction current 0.01 A, displacement current -9.21269e-5 A and magnetic circulation 0.00990787 A. A second contour cutting the capacitor gap has zero conduction current, displacement current -0.00165949 A and the same value for magnetic circulation; its normalized residual is 1.31e-16. These are independently accumulated finite-surface/circulation sums over the actual scene fields, not a Biot-Savart overlay.

The helper suite additionally checks signed/zero current, exact ramp integration across multiple step partitions, full diagonal contact continuity, missing/ambiguous contacts, boundary exits, forged weights and work adjointness. Scene tests reject moving/missing/unresolved terminals, clipped paths and thin third-party contacts; runtime motion into a feed support also stops explicitly. Reset restores fields, charges and source counters, with bit-identical selected replay samples. Browser regressions cover the direct-load charging preset, edited source settings, save/reload, explicit approximation rejection and ten-step replay.

## Scope

The roundoff-scale checks validate discrete conservation and source coupling; they do not establish continuum accuracy for a 16-cell capacitor, singular thin filament or arbitrary material interface. The magnetic sample above is a measured result, not an analytic accuracy target. Grid/domain/CPML/source-bandwidth studies are required for quantitative use. Source voltage depends on the chosen physical path in a time-dependent field. Voltage-clamped ports, transported/moving feeds, resolved lead/circuit response and complete coupled mechanical energy/momentum acceptance remain open in the main plan.
