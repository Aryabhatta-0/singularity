# Verification

Commands are listed in `../README.md`.

## 2026-10-05 — crash-test lab onboarding

Verified on the merged branch (onboarding redesign + host-run multiplayer) with `npm run host -- --dev`.

- `npm run typecheck`, `npm run lint` and `npm run build` are clean. `npm test`: 157 unit tests pass, including the ragdoll sim (limb lengths hold, both-legs yank topples it, impacts reported once, deterministic).
- `npm run e2e:room`: all checks pass.
- Browser suites pass against the hosted game: `playwright_regression.py`, `ffa_teams_e2e.py`, `solo_combined_e2e.py`, `shared_body_e2e.py`, `solo_ferry_play.py`.
- A headless Chrome walkthrough was checked from screenshots: dummy drop-in, the out-of-sync face-plant, the name sticker, the versus and free-for-all previews, the launch iris, loader assembly and the lobby. There were no page errors.
- With `prefers-reduced-motion: reduce`, the dummy holds a static pose.
- On a 390 px mobile viewport, nothing scrolls horizontally.

Not covered: real touch devices, and low-end GPU frame rates. The landing loads no Three.js or Rapier; its canvas loop pauses offscreen and when the tab is hidden.

## 2026-10-05 — host-run multiplayer revival

Verified locally on Windows 11 with SpacetimeDB 2.10.0 and Node 24. No hosted database or deployment was touched.

- `npm run typecheck` and `npm run lint` are clean; `npm run build` succeeds.
- `npm test`: 153 unit tests pass.
- `npm run e2e:room`: 33/33 checks pass against a local `singularity-room`. They cover squad seating, leader-only settings, rival team numbering, room privacy, countdown → playing, input and snapshot relays (including non-host rejection), reconnecting into a seat mid-round, server-timed finishes, the results → lobby return, free-for-all invite contagion, the leader-only versus ↔ free-for-all switch and empty-room cleanup.
- `npm run e2e:leaderboard`: all checks pass against a scratch database (`singularity-e2e`, deleted afterwards).
- Browser suites (headless Chrome, SwiftShader WebGL):
  - `tests/browser/shared_body_e2e.py`: two browsers share one body. Only the first joiner simulates, the friend's key presses arrive at the host as remote input, and the friend's view tracks the host's pose.
  - `tests/browser/ffa_teams_e2e.py` passes against `next dev` and also against `npm run host` loaded through the host's LAN address, which is the path a friend takes.
  - `playwright_regression.py`, `solo_combined_e2e.py` and `solo_ferry_play.py` pass.
- An unreachable room server shows the "No one is hosting here" panel, and its Practice offline button opens a working single-tab lobby with the invite button hidden.

Not covered here: play across two physical machines, and play over the internet.
