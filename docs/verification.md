# Multi-course coordination verification

Verification commands and isolated local-backend setup are in `../README.md`.

Verified locally on 2026-09-06. No cloud database or production deployment was changed.

- `npm test`: 94/94 deterministic physics, session, finale-status, feedback, lighting, snapshot and subscription-lifecycle tests passed.
- `npm run build`: strict TypeScript and the Vite production build passed. The final browser bundle is 696.54 kB minified / 185.72 kB gzip; Three.js and the live game load together, so no artificial lazy split was added to silence Vite's 500 kB advisory.
- `spacetime build --module-path server`: the authoritative server module passed.
- `node tests/browser.mjs`: the desktop/mobile UI suite passed with no page errors or horizontal overflow, including source-safe pointer, keyboard and assistive-technology controls.
- `npm run test:perf`: the browser-timestamped warm 1440×900 gate passed every challenge at 119.5 FPS, 8.5 ms p95 frame interval and 100% rendered-frame coverage. Easy, Medium and Difficult averaged 145.0, 148.8 and 138.9 WebGL draw calls per frame, with 46.0, 37.5 and 35.0 DOM mutations per second. Enforced budgets are at least 50 FPS, at most 34 ms p95, at least 98% rendered coverage, at most 150 mean draw calls and at most 120 DOM mutations per second. Before instancing and change-only writes, draw calls were about 191/201/190 and DOM writes about 960 per second.
- `node tests/multiplayer.mjs`: guarded local v4 multiplayer passed. It verifies identity-plus-connection leases, room and leaderboard subscription isolation, stable ranked DOM under 30 Hz snapshots, both crew sizes, abandonment, and authoritative categorized finishes. The final Difficult/3-player and Easy/5-player runs finished in 39.509s and 20.578s; the frame-aligned ranked UI sample measured 119.47 DOM mutations per second without replacing course, role or member nodes.
- Impeccable's full-parser detector completed after the final UI/accessibility changes. It reported zero blocking findings and 59 advisory notices that the established responsive Flight Deck palette and type literals are broader than the abbreviated DESIGN.md inventory.

The unit suite covers all three challenges in both crew modes, every requested role mapping, practice isolation, paired versus independent limb input, two-hand gripping, role necessity, ordered objectives, dynamic and narrow surfaces, course-specific checkpoint penalties, Difficult launch-window boundaries and pre-hold re-arming, cue precedence/copy, one-shot alignment feedback, exact millisecond formatting, deterministic replay, directional-shadow projection, finite constrained physics, gates and incompatible snapshots.

The browser suite covers all challenge choices, the requested three- and five-player role names, mode-specific practice, millisecond clocks, difficulty state, segregated leaderboard controls, assertive finale live-region semantics, an accessible 44px touch-control group, independent pointer/Enter/Space/synthetic activation, focus-transfer release behavior and mobile responsiveness. Finale transition copy is unit-tested; the browser suite verifies its live-region contract.

The multiplayer suite covers both crew sizes, configured challenge/crew joins, dynamic readiness, role and configuration conflicts, host-only start, countdown/racing locks, reconnect leases, stale bounded input, rematch reset, authoritative finishes and challenge/crew fields on persistent results.

All mutating multiplayer tests refuse non-local hosts and target only the local `singularity` database (or a strictly prefixed isolated variant). Screenshots live under `.impeccable/review/` and `test-results/`. The reference repository has no declared license, so no code or assets were copied; the coherent procedural Flight Deck art direction was retained and no external asset provenance file was needed. Automated clients complement the recorded desktop/mobile visual playtest; a public concurrency load test remains a separate release exercise.
