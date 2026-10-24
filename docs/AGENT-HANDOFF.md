# Maxwell simulator handoff - 2026-10-25

## READ FIRST: current recovery state

- The next CPML checkpoint contains the physical-width correction, four regressions, the two maintained measurement tools and their reports. Run `git log -3 --oneline` for its exact hash. Earlier production checkpoint `07a8900` and pre-Maxwell rollback tag remain preserved.
- **253 unit tests in 51 files pass; production build passes.** All four new tests were observed failing with the old profile, then the corrected source was restored exactly. Independent numerical review found no actionable defect.
- Full corrected 17-case audit completed: `artifacts/maxwell-pml-corrected-17.json`, all selected finite-window targets pass, source hashes unchanged and verified against actual files. Normal-pulse tail R = 3.2214607e-7 through ct = 14 m, versus old R = 0.0021343; sine control R = 3.6420154e-7. The normal maximum now stays at ct = 1.242 m across extended windows.
- **Open:** the 45-degree packet still has a rising late tail, R = 1.3855266e-5 at the ct = 6 m endpoint. It is below target in that window but not converged in time. Do not mark general M3 or the entire Maxwell migration accepted.
- Browser flows: 15 pass in the full corrected run; the first approximation test hits its known 30-second cold-readiness timeout. Its isolated recheck passes (44.7-second test, 47.4-second run). Every flow has passed across those runs; do not claim a single-run 16/16 pass for this correction.
- Both measurement tools pass independent spec and quality review. Browser uncaught-page exceptions now fail measurement, with an actual injected-exception failure check. Browser performance numbers remain explicitly historical at `07a8900`, before the CPML correction; the historical artifact is preserved.
- No runtime jobs need to continue after the corrected audit finishes. Next priorities: investigate the 45-degree late tail and cold development-startup flake, then the remaining M5/M6/M7 gates. Reproduce from maintained scripts; do not repeat completed regressions or silently tune away failed acceptance.
- Detailed notes below include earlier chronological states. This section supersedes stale running-job and source-hold notes.

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

## Latest update after handoff commit54ffd61

Root wrote tests/maxwell/cpml-profile.test.ts and observed RED: all3 relative-depth cases fail the fixed-physical-profile invariance property. Atdepth.5 measured continuous memory decay differs11.527%; atdepth.75 differs3.343%. Log artifacts/cpml-profile-red.log. This is intentional failing uncommitted next-step regression; no production patch yet. PML agent baseline17 is on final row, original cosine late target FAIL confirmedR2.134325e-3, reference0throughct14. Wait for source-hold release before cpml change. Browser agent final formatting/UTF8 follow-up done, final16/32/48 successful, report refreshed and source/build manifests unchanged. Latest ready157.4/784.1/4128.0ms. Combined measurement review package ready in local SDD workspace.

## Active correction after baseline hold released

Baseline17 completed on stable54ffd61 production: artifacts/maxwell-pml-baseline-17.json, selectedSuiteMeetsTarget=false. Full-running normal-tail peakR.002134325 atct10.512; sineR2.211093e-5, reference0throughct14.00175. Root recorded rationale in progress ledger, changed src/engine/maxwell/cpml.ts alpha scaling from .05*c/h to .05*c/(cells*h), and GREEN3/3 CPMLprofile tests pass (artifacts/cpml-profile-green.log). This production fix is UNCOMMITTED and NOT YET broadly accepted. Root started corrected two-tail actual audit: command node scripts/audit-maxwell-pml.mjs --cases normal-fine-tail,normal-sine-tail --json artifacts/maxwell-pml-corrected-tails.json; log artifacts/maxwell-pml-corrected-tails.log, exec session11360. Build rerun started; check artifacts/maxwell-build.log/result. Need tailresults before claims, full npmtest/browser/build and meaningful corrected-case regression/review. Browser performance report measures OLD07a8900 dist, must remain historical or be regenerated after newbuild. Measurement tool reviewer /root/review_measurement_tools active on combineddiffpackage; sourcecorrection is outside its review.

## Latest verification and running jobs

Corrected two-tail audit completed: normalR3.221461e-7, sineR3.642015e-7, far reference difference0 (artifacts/maxwell-pml-corrected-tails.json). Root added actual late pulse integration regression, temporarily restored ONLYoldalpha under Pythontry/finally, confirmed all4newtests RED includingR.0021343250747552, then restored exact correctedsource. Freshbuild passes. Full npmtest running execsession82213/logartifacts/maxwell-unit.log (started01:11:~50). Combinedmeasurementreview: PML PASSspec/quality; browser mediumfinding pageerrorwasmerelylogged; browseragent correcting tofailrow andtestfaultpath. CPMLfixreviewpackage/brief ready inlocalSDD. Need broadGREENunit, browser, fullcorrected17audit, independentCPMLreview, browsertoolrereview and updatedhistoricaldocs beforecommit. No completednewproductioncheckpoint yet; HEAD54ffd61, source07a8900+uncommittedcpmlfix.

## Latest completed verification (supersedes running-unit note)

Corrected solver full npmtest PASS253tests/51files,135.87s; session82213 finishedexit0. Fresh npmrunbuildPASS withexistingbundlewarning. Corrected-tail session11360 finishedexit0. Full16browser confirmation now RUNNING execsession56909, logartifacts/maxwell-browser-cpml.log. PMLagent instructed to preparecorrectedreport but HOLDheavyfull17 untilbrowsercomplete, then runfull17corrected stableartifact/report preservingoldfailedbaseline. Corefixreviewagent /root/review_cpml_profile_fix active; measurementreviewPMLclean, browseragentfixespageerror mediumfinding (needsrereview). Handoffcapturesnewchangesbeforeproductioncommit.

## Review results and current browser caveat

IndependentCPMLfixreview: SPEC/codequality/physicalvalidityclean; noteslimitedintegeroffset/oneaxis/Float64impulse andnormalpulse coverage. Measurementtoolsreview: PMLspec+qualityPASS. BrowserpageerrorfindingfixedwithPromise.race andretainederrors; actualinjecteduncaughtEdgeexceptionexits1/noartifact/finallycleanup; scopedrereviewPASSboth. Browserperformance reportexplicitlyhistorical07measurements, notnewCPMLtimings. Currentfullbrowserrun againhitfirstapproximationcoldready30s timeout; laterflowscontinuing. This startupflakepredatestheCPMLchange andneedsisolatedrecheck/clearreport; doNOTclaimfullsingle-runpass. No uncontrolledproductioneditsmadebeyondCPMLalpha.

## Final audit now active

The isolated browser recheck exited0; all16flows have passed on correctedproduction across the15-pass fullrun plus1isolatedrecheck, but the fullrun retains its cold-start failure. PMLagent is NOWRUNNING completecorrected17cases, outputartifacts/maxwell-pml-corrected-17.json, sourceheldunchanged. Allotherreviewsareclean. Remainingcheckpointwork: inspectthatartifact/report and UTF8/sourcehashes, finaldiffcheck, updatethisfile, stageexact10files andcommit. Newtests/sourcealreadyverified253unit+build. README/corevalidationnoteslabeloldmeasurements historical. Noadditionalphysicschangesneeded unlesscorrected17findsnewfailure.
