# Verification

The commands are in `../README.md`.

## 2026-10-06 — best times on a click, plain-language docs

- The main page does not show the best times when it opens. A **Best times** button in the top bar opens them in a dialog. The game gets the scores only after the click.
- `npm run typecheck`, `npm run lint` and `next build` pass.
- A headless Chrome check at 1280 × 800 and 390 × 844 opened the dialog, waited for the rows, and closed it with the close button and with Escape.
- The README, the other docs and the Privacy and Terms pages use ASD-STE100 Simplified Technical English. The Privacy page uses plain words and no technical terms.

## 2026-10-06 — online-first production pass

Production: <https://singularity-coral.vercel.app> on Vercel. The SpacetimeDB Maincloud database is `singularity` (new, with access control).

- `npm run typecheck`, `npm run lint`, `npm test` (180 unit tests) and `vercel build --prod` pass.
- `npm run e2e:room` (45 checks) and `npm run e2e:leaderboard` (14) pass locally. They also pass on temporary Maincloud databases that trust the production issuer. We deleted the temporary databases.
- The production database gives 403 to anonymous SQL and reducer calls. `npm run e2e:online` (27 checks) passes against production. It does not write to the best times.
- These browser tests pass against production: `playwright_regression.py`, `ffa_teams_e2e.py`, `solo_combined_e2e.py` and `mobile_layout_e2e.py` (320–768 px portrait and landscape, and desktop).
- `shared_body_e2e.py` and `network_conditions_e2e.py` need the debug hook that only development has. Thus, we ran them locally. On simulated LAN, broadband and mobile links, the copy of the body missed 0%, 0% and 14% of frames with the adaptive buffer. With the old fixed 55 ms delay, it missed 12%, 74% and 83%. After a cut in the middle of a round, the player connected again into the same round.
- `perf_profile.py` uses headless SwiftShader, which is a software GPU. Compare its numbers only with each other. With adaptive render quality, the in-game fps increased from 9.7 to 23.1 on desktop. On a phone viewport, it increased from 21.8 to 30.4. CPU throttling did not change the fps much. Thus, the render was the bottleneck, not the physics or the network.

Not tested: real phones and GPUs, and play between networks that are physically separate. (The network profiles are simulated.)

## 2026-10-05 — crash-test lab onboarding

We tested the merged branch (onboarding redesign and host-run multiplayer) with `npm run host -- --dev`.

- `npm run typecheck`, `npm run lint` and `npm run build` pass with no errors. `npm test`: 157 unit tests pass. These include the ragdoll simulation tests: the limb lengths stay the same, a pull on the two legs makes it fall, each hit is reported one time, and the result is the same each time.
- `npm run e2e:room`: all checks pass.
- These browser tests pass against the hosted game: `playwright_regression.py`, `ffa_teams_e2e.py`, `solo_combined_e2e.py`, `shared_body_e2e.py` and `solo_ferry_play.py`.
- We examined screenshots of a headless Chrome walkthrough. It showed the dummy drop-in, the fall when the legs are out of sync, the name sticker, the versus and free-for-all previews, the launch iris, the loader and the lobby. There were no page errors.
- With `prefers-reduced-motion: reduce`, the dummy does not move.
- On a 390 px mobile viewport, nothing scrolls to the side.

Not tested: real touch devices, and frame rates on slow GPUs. The main page does not load Three.js or Rapier. Its canvas loop stops when it is off the screen and when the tab is hidden.

## 2026-10-05 — host-run multiplayer revival

We tested locally on Windows 11 with SpacetimeDB 2.10.0 and Node 24. We did not change a hosted database or a deployment.

- `npm run typecheck` and `npm run lint` pass with no errors. `npm run build` passes.
- `npm test`: 153 unit tests pass.
- `npm run e2e:room`: 33 of 33 checks pass against a local `singularity-room`. They test these items: team seats, settings that only the leader can change, rival team numbers, room privacy, countdown to playing, input and snapshot relays (and the refusal of relays from non-hosts), reconnect into a seat during a round, finish times from the server, return from results to the lobby, free-for-all invites, the switch between versus and free-for-all (leader only) and the removal of empty rooms.
- `npm run e2e:leaderboard`: all checks pass against a temporary database (`singularity-e2e`). We deleted it after the test.
- Browser tests (headless Chrome, SwiftShader WebGL):
  - `tests/browser/shared_body_e2e.py`: two browsers share one body. Only the first player to join calculates the physics. The key presses of the friend go to the host as remote input. The view of the friend follows the pose from the host.
  - `tests/browser/ffa_teams_e2e.py` passes against `next dev`. It also passes against `npm run host` through the LAN address of the host. A friend uses this same path.
  - `playwright_regression.py`, `solo_combined_e2e.py` and `solo_ferry_play.py` pass.
- If the room server is not available, the game shows the "No one is hosting here" panel. Its Practice offline button opens a single-tab lobby that works. The invite button is hidden.

Not tested: play on two physical computers, and play over the internet.
