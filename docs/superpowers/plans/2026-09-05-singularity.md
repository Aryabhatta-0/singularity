# Singularity implementation plan

Goal: six players pilot one physical body against other teams through a timed relay.
Architecture: a Three.js browser client hosted as a static Hugging Face Space; SpacetimeDB TypeScript reducers own a fixed-step constrained-body simulation, role leases, match clocks, checkpoints and persistent results. The identical pure simulation runs locally for clearly labelled unranked practice. No paid GPU hosting.

User delegates architecture and requests efficient implementation and a commit/push after every subphase, so execute inline without further design approval ceremonies.

- [x] Phase 1: pure physics simulation, tests, authoritative SpacetimeDB module; build module and commit/push.
- [x] Phase 2: polished 3D course, responsive HUD, lobby, controls and real subscriptions; build and commit/push.
- [x] Phase 3: multiplayer verification, production build, publish to HF and smoke test; commit/push.

Validation: test role-specific forces, joint bounds, falls, ordered checkpoint completion, deterministic replay; compile database module; browser smoke and two-client role/race checks. Ranked results may only be created by the authoritative scheduled reducer. An unavailable backend must be visibly reported, never silently replaced with local ranked results.

## Verification results

- Nine simulation tests pass, including deterministic replay, ordered objectives, a complete coordinated run, and delivered-cargo fall recovery.
- TypeScript and Vite production builds pass; database module compiles and is published on Maincloud.
- Two Chrome clients verify cloud role conflicts, host-only start, shared countdown, live role switching and exit. Desktop/mobile screenshots inspected.
- Six independent local SpacetimeDB clients complete two simultaneous team races in 13.286 and 14.680 seconds. Rankings, completed match state, persistent results after reconnect, empty-room cleanup and rematch reset verified.
- Deployed static Space completes a full assisted practice run in Chrome and connects to the live leaderboard without page errors.
- Procedural Three.js assets and a custom constrained-body solver keep the game browser-playable.
