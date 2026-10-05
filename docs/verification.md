# Verification

Commands are listed in `../README.md`.

## 2026-10-05 — host-run multiplayer revival

Verified locally on Windows 11 with SpacetimeDB 2.10.0 and Node 24. No hosted database or deployment was touched.

- `npm run typecheck` and `npm run lint` are clean; `npm run build` succeeds.
- `npm test`: 153 unit tests pass.
- `npm run e2e:room`: 28/28 checks pass against a local `singularity-room`. They cover squad seating, leader-only settings, rival team numbering, room privacy, countdown → playing, input and snapshot relays (including non-host rejection), reconnecting into a seat mid-round, server-timed finishes, the results → lobby return, free-for-all invite contagion and empty-room cleanup.
- `npm run e2e:leaderboard`: all checks pass against a scratch database (`singularity-e2e`, deleted afterwards).
- Browser suites (headless Chrome, SwiftShader WebGL):
  - `tests/browser/shared_body_e2e.py`: two browsers share one body. Only the first joiner simulates, the friend's key presses arrive at the host as remote input, and the friend's view tracks the host's pose.
  - `tests/browser/ffa_teams_e2e.py` passes against `next dev` and also against `npm run host` loaded through the host's LAN address, which is the path a friend takes.
  - `playwright_regression.py`, `solo_combined_e2e.py` and `solo_ferry_play.py` pass.
- An unreachable room server shows the "No one is hosting here" panel, and its Practice offline button opens a working single-tab lobby with the invite button hidden.

Not covered here: play across two physical machines, and play over the internet.
