# Explicit terminal current feeds

Continuation of approved full-Maxwell plan M4. Keep the rollback tag and the experimental solver label.

Ruling: the first terminal source is an externally powered current source on a visible authored wire path, connected to two stationary finite-conductivity bodies. Voltage-clamped and moving terminals require separate validation; reject them rather than pretending an isolated initial voltage is a supply. The path contains the feed and return leads, with displacement current closing the capacitor circuit. This is an impressed filament source with explicit contacts, not a resolved passive lead.

## Contract

- Extend wire electricalModel with `currentFeed`, and optional terminalFeed `{ from: string, to: string, riseTime: number }`. Current keeps its SI ampere meaning and points/path keep the existing visible geometry. First endpoint withdraws positive charge from `from`; last deposits it in `to`. References and inactive settings survive saves and model switches.
- Require two distinct, visible, stationary conducting bodies, an open stationary wire, finite current and nonnegative rise time. The authored endpoint must have its full nonzero CIC support inside the named body's initial material lattice. Never snap, prune or renormalize unresolved contacts. Reject missing contacts, unsupported motion, contacts with other bodies and clipped paths with actionable errors.
- Integrate a cubic smooth-start waveform exactly over each physical step. Transfer `I_average * dt` between terminal-owned material nodes. Deposit the authored path plus contact fan branches with the existing conserved trajectory operator. Branches cancel the free endpoint charge; independent lattice charge and Maxwell rho must agree to roundoff.
- Apply terminal transfer after Ohmic redistribution and before body transport. Snapshot/reset must reproduce charge, fields and source-work counters. No runtime potential solve or algebraic B overlay.
- Measure source work using the actual deposited-current adjoint line integral and time-centered E. Label it external-source work; do not claim the general mechanical ledger is complete.

## Tasks and checks

1. Add a pure terminal-feed helper with exact waveform integration, resolved CIC contact construction and conserved path/contact deposition. Write failing tests first: diagonal contacts, exact terminal charge, no stray endpoint charge, missing contact rejection, zero/signed current, step-size independent integrated charge, adjoint work.
2. Integrate schema/compiler, lattice-owned terminal transfer and source-work accounting. Test neutral charging capacitor, independent body/core charge closure, nonzero propagated B, replay, disabled approximation gate, unsupported motion and unresolved contacts.
3. Add inspector source/terminal controls, saved parameter regression and a direct-load charging-capacitor Maxwell preset with visible return lead and smooth turn-on. Browser-check edit/rewind/replay and current/charge readouts.
4. Compare charge with analytic integrated current, integral Ampere-Maxwell/Faraday and finite-volume energy/work/flux closure. Record grid/domain/source-startup limitations. Run relevant numerical tests, full suite, browser suite and production build; commit a reviewable checkpoint.

Acceptance for this increment: a user can charge a stationary isolated capacitor through explicit authored terminals; terminal/body charge is conserved independently of Maxwell's continuity update, B is evolved, source work is measured and replay preserves edits. General voltage feeds, moving feeds and all M5/M6/GPU requirements remain tracked separately.
