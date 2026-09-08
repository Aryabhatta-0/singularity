# Multi-course coordination verification

Verification commands and isolated local-backend setup are in `../README.md`.

Verified locally on 2026-09-06. No cloud database or production deployment was changed.

- `npm test`: the deterministic unit suite (commentary, gameplay matrix, joystick, round transitions, mobile input, time, leaderboard, objective proof, simulation clock, remote input state, snapshot codec, round standings, server clock, network tuning) passes — see `tests/all.test.mjs`.
- `spacetime build --module-path server`: the authoritative server module passed.
- `node scripts/e2e.mjs`: the SpacetimeDB module end-to-end suite (simulated squad flow, round lifecycle, leaderboards, host handoff) passed against the local database.
- The historical notes below reference since-removed Vite-era commands (`node tests/browser.mjs`, `npm run test:perf`, `node tests/multiplayer.mjs`); those suites no longer exist. The browser regression suite now lives in `tests/browser/playwright_regression.py` (`npm run test:browser`).

Historical results (Vite-era tooling, kept for reference): the 1440×900 perf gate averaged 119.5 FPS, 8.5 ms p95 frame interval and 100% rendered-frame coverage; the browser bundle was 696.54 kB minified / 185.72 kB gzip.

The unit suite covers all three challenges in both crew modes, every requested role mapping, practice isolation, paired versus independent limb input, two-hand gripping, role necessity, ordered objectives, dynamic and narrow surfaces, course-specific checkpoint penalties, Difficult launch-window boundaries and pre-hold re-arming, cue precedence/copy, one-shot alignment feedback, exact millisecond formatting, deterministic replay, directional-shadow projection, finite constrained physics, gates and incompatible snapshots.

The browser suite covers all challenge choices, the requested three- and five-player role names, mode-specific practice, millisecond clocks, difficulty state, segregated leaderboard controls, assertive finale live-region semantics, an accessible 44px touch-control group, independent pointer/Enter/Space/synthetic activation, focus-transfer release behavior and mobile responsiveness. Finale transition copy is unit-tested; the browser suite verifies its live-region contract.

The multiplayer suite covers both crew sizes, configured challenge/crew joins, dynamic readiness, role and configuration conflicts, host-only start, countdown/racing locks, reconnect leases, stale bounded input, rematch reset, authoritative finishes and challenge/crew fields on persistent results.

All mutating multiplayer tests refuse non-local hosts and target only the local `singularity` database (or a strictly prefixed isolated variant). Screenshots live under `.impeccable/review/` and `test-results/`. The reference repository has no declared license, so no code or assets were copied; the coherent procedural Flight Deck art direction was retained and no external asset provenance file was needed. Automated clients complement the recorded desktop/mobile visual playtest; a public concurrency load test remains a separate release exercise.
