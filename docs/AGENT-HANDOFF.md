# Maxwell simulator handoff - 2026-10-25

## User objective and authorization

Implement the approved full-Maxwell FDTD plan, not only static field recomputation. Include prescribed OR force-driven motion, browser-local computation, explicit approximation mode/limits, edit-preserving rewind/replay, existing custom geometry and Git rollback. User repeatedly authorizes continuation; latest request is to preserve this handoff because quota is low, then keep working. Do not ask for already-given permission. General migration is NOT complete or accepted.

## Workspace and process

- Windows PowerShell: D:/Desktop/study_resources/physics/simulator; danger-full-access, approval never. Do not pass sandbox_permissions.
- Branch feature/maxwell-engine. Preserve shared working tree. No reset/clean/push/merge.
- No AGENTS.md found previously. Skills under C:/Users/Lenovo/.codex/plugins/cache/openai-api-curated/superpowers/1dc19589/skills. Already following subagent-driven-development, debugging, TDD, verification. That skill explicitly authorizes delegated work. Read applicable skills before further changes.
- The durable plan: docs/superpowers/plans/2026-10-24-full-maxwell-fdtd.md; durable execution ledger: docs/superpowers/plans/2026-10-24-maxwell-progress.md. Read them before redispatching completed work. Local ignored .superpowers/sdd/2026-10-24-full-maxwell-fdtd contains briefs/reports/review packages. .git/info/exclude locally excludes .superpowers/.
- Agents share files/index: serialize commits and stage exact paths. Commentary updates about every60s. PowerShell piped Python literals can corrupt Unicode or produce ANSI files: use ASCII/codepoint escapes and explicit encoding=utf-8. Validate docs decode as UTF8.

## Git rollback and latest verified checkpoint

- Original baseline c6f9590; pre-Maxwell bugfix/plan checkpoint236145c, tag checkpoint-before-maxwell-2026-10-24.
- Recent commits:219357f physical time targets/actual source coupling diagnostics;034b8b8 explicit smooth finite charge clouds;5f4f6d5 time-centered signed conducting-body work and momentum/passive audits.
- Current HEAD07a8900 (full07a8900643ec73440c9d81ad16e12f351bdf9feb): explicit source/test particle feedback selector and normally moving infinite-sheet reference. Do not undo it.
- Verified this checkpoint:249 unit tests in50 files passed; production build passed (existing bundle-size warning);16 browser flows passed in a serial confirmation run. Earlier first-browser startup ready timeout failed once then isolated pass and full16/16 pass. Build initially found a new test assertion TS type error; corrected to toMatchObject without production changes, build and focused21 passed. Independent review of test-particle spec/quality and normal-sheet numerical reference clean.
- Current dist was built from the production source at07a8900. It is current until a future production change; benchmark must rebuild after such change.

## What07a8900 added

ParticleObject.fieldFeedback?: source|testParticle. Undefined preserves existing full-mode source particle. Full-mode test particles use local native synchronized E/B and the field clock, deposit no rho/J and are excluded from source-only kinetic/work/momentum residuals. Saved cloud profile/width inactive, actual point bounds still enforced. Controller key invalidates worker on feedback edit. Approximation remains legacy test-particle behavior. Browser test covers generation, inactive settings/save/reload and rewind/replay. Docs explain intentional no-feedback approximation.

Normal-moving-planes test: prescribed smooth infinite charge sheets move along normals, convection J and displacement current cancel, Ex changes but B stays exactly zero. This does NOT accept finite changing-gap conductors/moving mirrors.

## Current uncommitted files / ownership (check git status)

Root owns changes to README.md, docs/maxwell-core-validation.md, docs/superpowers/plans/2026-10-24-maxwell-progress.md, this handoff. They add links/caveats for new audits. Do not stage other agent changes before ready/review.

Agent /root/pml_band_audit owns ONLY new scripts/audit-maxwell-pml.mjs and docs/maxwell-pml-validation.md. Brief/report in local SDD directory: pml-brief.md, pml-audit-report.md. Maintained17cases prepared; OLD-physics baseline17 run about to begin, ~100s. **HOLD src/engine/maxwell/cpml.ts and all production sources until agent signals baseline complete** so source provenance stays valid. Ask status before edits. Agent knows root physical-alpha hypothesis below. It must keep failures, not tune them away. No commits authorized to agents.

Agent /root/browser_perf_measurement owns ONLY new scripts/benchmark-maxwell-browser.mjs and docs/maxwell-browser-performance.md. Brief/report: browser-perf-brief.md, browser-perf-report.md. Completed actual production Edge runs16/32/48,3physicalsteps; currently doing requested manual code formatting, UTF8/corrupted glyph fixes, narrowed source manifest and final measured rerun (~15s). Await final report/review-ready. It coordinates CPU timing window with PML agent. No production changes or commits.

/root/review_test_feedback finished clean review. Other old agents may be listed but earlier work is done; do not redispatch completed increments.

## Important new PML finding: acceptance FAILS

Existing benchmarks.test.ts reflection windows were too short to establish long-time absorption. New audit uses actual Float64 YeeSolver via Vite SSR, three domains, paired subtraction, incident normalization, fixed physical thickness, grids, pulse scale and domain/window checks. Exact oblique Yee eigenpacket with native space/half-time phases. Source/build provenance, CLI bounds and JSON under artifacts. No new dependency.

Original13 finite-window rows all below1e-3. Normal fine early R1.6469e-6 throughct2m; extendedct3.2 gives9.5646e-5 at endpoint. Oblique45 rises2.7121e-6 throughct4.2 to1.3676e-5 throughct6, also endpoint maximum. These are NOT converged late-time maxima.

Investigation using original cosine normal pulse, h=.0025m, layer=.08m, domains1/8/10m: delayed sampled probe difference .0021324868V/m nearct10.50075m, incident about.99914138V/m => R~.0021343, FAILS1e-3. Far references agree at probe throughct14m. Fields bounded, bulk energy decays, delayed maximum initially sits in right PML then moves slowly. Zero-area sine control same envelope/carrier/B staggering gives much smaller absolute delayed signal (~171x); own incident normalization needed. Supports delayed near-DC reflection, NOT observed exponential instability. Original cosine integral sqrt(pi)*width*exp(-(kx*width/2)^2)~.0335m; sine integral0.

Maintained audit17cases adds normal-fine-tail and normal-sine-tail throughct14 with1/8/10m references, own denominator, running peaks and coarse snapshots. Old ignored artifacts/diagnose-pml-long.mjs and pml-diagnosis-*.json were investigation only; final docs must use maintained CLI, not depend on ignored-only scripts. New final artifact should make selectedSuiteMeetsTarget=false for baseline. Original15 measurements retained. Oblique45 has nonzero ky so no temporal DC mode; its near-tangential/backward content and delayed response need separate investigation, not the normal DC explanation.

## Exact next debugging step (NOT IMPLEMENTED YET)

Root found a concrete grid-profile inconsistency in src/engine/maxwell/cpml.ts:

rate = -4*c*log(1e-8)/(2*cells*h) * u^3
alpha = .05*c/h * (1-u)

For fixed physical layer thickness delta=cells*h, rate/kappa profile remains fixed but alpha grows as1/h under mesh refinement. Therefore fixed-delta grid studies change the continuum absorber; as h->0 alpha->infinity, stretch approaches real/nonabsorbing. This is separate from proving a coding sign error. Proposed minimal correction to investigate: alpha=.05*c/(cells*h)*(1-u), preserving prefactor while referring to physical layer thickness. **Do not implement until RED property regression and old baseline source hold ends.** Do not assume it fixes all late tails, static/moving models or45case.

Meaningful RED test proposal: new tests/maxwell/cpml-profile.test.ts. Instantiate Cpml directly with coarse shape[64,1,1],spacing[1/64,1,1],cells16,dt=.5*h/c and fine[128,1,1],h1/128,cells32,dt=.5*h/c. Same physical delta=.25m and backward coefficient location u=.5 (coordinate cells/2, index same). For one memory slot, input derivative1 once, then0 twice. Outputs y1,y2 after zero inputs give b=y2/y1 without reading private coefficients or mirroring alpha formula. Continuous memory decay rate=-log(b)/dt must be invariant at same physical depth. Old code fails (~20% difference). Test multiple interior depths if useful. This demonstrates physical-profile inconsistency independent of packet thresholds. Root has NOT written the test or changed cpml.ts yet.

Then record ruling in progress ledger, make smallest fix if evidence supports it, GREEN test, run late audit original pulse BEFORE accepting improved target. Need broad tests/build/browser and moving-charge/material/static-background/precision validation because CPML changes everywhere. Update measured docs honestly, keep old failed baseline with provenance. Do not just swap to sine and discard original failure. New regression should also protect actual late reflected amplitude if fix is intended to pass it. Consider physical alpha dimension/choice and compare reference/late windows rather than tune constants to target.

## Browser benchmark facts (before final formatting rerun)

Actual dist page + dedicated worker + viewport, headless Edge156, CoreUltra9275HX,3physicalsteps each16/32/48, one step per batch, finite authored physical target, no time/frequency/c rescaling. Ready about165.5/813.1/2867.3ms; final worker sampling52.1/74.4/171.8ms; cumulative stepping69.77/17.03/4.57steps/s; frame typed-array bytes113052/113020/113148. Zero-step/target same generation and time=steps*dt asserted. Before/after source/build manifests stable in initial run. Report warns startup/worker scheduling included; not pure transfer/render cost, peak memory, input latency or stable throughput. rAF/longtasks only bounded observations. Source-to-dist linkage comes from known prior build, hashes alone do not prove compilation.

Review concerns already sent: correct waitForFunction options must be third arg; reject different-drive output via isAbsolute(relativePath); format 628char lines; convert ANSI docs toUTF8 and replace corrupted ?t/? arrows with ASCII dt/to; hash own script plus src/dist instead of unrelated changing audit scripts. Agent working on these. Need independently reproduce a small row and review final diff. Browser production source must remain07a8900 until rebuild.

## Remaining major plan gaps

General moving PEC/interfaces/rotation, changing-gap and moving/fed capacitor acceptance, moving/voltage feeds, full force/torque/passive energy/momentum closure, general magnet feedback, complete preset migration and WebGPU parity. Current solver is Float64 CPU browser Worker; optional coreFloat32 exists but website notGPU. No server simulation service. Smooth sources improve selected coupling energy convergence but still mesh self-force; old CIC coupling fails badly. Signed body rest-frame work is diagnostic, not guaranteed passive heat. Keep all limits visible. Full milestones M3/M5/M6/M7 not accepted.

## Verification commands and next checkpoint

npm test; npm run test:ui; npm run build. Logs in artifacts/maxwell-unit.log, maxwell-browser-confirm.log, maxwell-build.log. New script node --check/help/invalidCLI and actual commands as reports. Avoid simultaneous heavy numerical runs with performance timings. Prepare review packages under local SDD workspace, independent review spec AND quality; then stage exact files and commit reversible checkpoint. User asked Git rollback, not push/deployment. Never claim full migration done merely because tests pass.
