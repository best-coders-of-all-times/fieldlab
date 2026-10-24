# Simulator repair and custom scenes

The user's requested changes and instruction to continue authorize implementation in the current workspace.

1. Reproduce field, probe, motion and geometry defects with focused regression tests. Keep existing physics tests as the baseline.
2. Update `StaticsEngine`, worker protocol and controller together: preserve probe IDs, seed applied fields at domain inflow faces, refresh moving source fields with one outstanding worker request, and discard obsolete replies. Reuse stationary electrostatic solutions for magnetic motion.
3. Add coordinate sampling with vector components in Edit and Data and labels beside probes. Refresh paused wave probes without advancing time.
4. Add conductor opacity in View, default the cavity preset to transparent, and keep geometry in the solve. Draw magnet surface current rings and tangential arrows with the sign of magnetization.
5. Keep Add, remove the top mode switch, and add a blank custom scene. Add shared smooth/polyline wire paths and timed position/rotation keyframes, including import/export persistence and input validation.
6. Correct additional verified defects: inconsistent mesh signatures, transform convention, per-source wire softening, floating conductor charge constraints and destructive custom-scene reset.
7. Document equations, boundary conditions, approximations, browser execution and hosting. Run regression tests, the full suite, production build and a browser smoke check when available.

Validation: `npm test`, `npm run build`, focused worker/controller and numerical regressions, and UI checks through a local browser where supported. No server computation service is needed; existing workers execute in the visitor's browser.
