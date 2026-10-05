# SINGULARITY

[![CI](https://github.com/Aryabhatta-0/singularity/actions/workflows/ci.yml/badge.svg)](https://github.com/Aryabhatta-0/singularity/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node 24](https://img.shields.io/badge/node-24-339933?logo=node.js&logoColor=white)

Five players. **One body.** A chaotic co-op physics party game: someone steers with the torso, someone works the arms, and two people each own a leg. Walk, climb, grab, throw, and try not to fall in the water. Rival squads race the same course as live ghosts.

- **Squads of 3 or 5.** Three players split arms / torso / legs; five split left hand, right hand, torso, left leg and right leg.
- **Five courses**: Wobble Run, Egg Express, Slam Dunk, Ferry Job and Summit Sync, from a moving gauntlet to carrying a fragile egg and sinking baskets.
- **Versus or free-for-all.** Rival squads race as ghosts, or everyone runs solo.
- **No accounts, no cloud.** One player hosts from their own machine; friends just open a link. Phones get on-screen controls.
- **Offline practice** in a single tab, no server needed.

Built with [Next.js](https://nextjs.org), [Three.js](https://threejs.org), [Rapier](https://rapier.rs) physics and [SpacetimeDB](https://spacetimedb.com).

## Contents

- [Quick start](#quick-start)
- [Controls](#controls)
- [How multiplayer works](#how-multiplayer-works)
- [Host a game](#host-a-game)
- [Develop](#develop)
- [Repo layout](#repo-layout)
- [Contributing](#contributing)
- [License](#license)

## Quick start

Just want to see it? With Node 24:

```bash
npm install
npm run dev
```

Open <http://localhost:3001> and start a room. With no room server running, the game offers **Practice offline**, a single-tab room that needs no server. For real multiplayer, see [Host a game](#host-a-game).

## Controls

Each player only drives their own part of the body; in solo practice you get all of them at once.

| Part | Keys |
| --- | --- |
| Legs | `W` `A` `S` `D` walk / strafe, `Space` jump |
| Arms | Arrow keys raise / lower / swing, `E` grab with both hands, `Q` / `R` left / right hand, `Shift` throw |
| Torso | `C` crouch, `B` brace / get up, mouse looks around |

On touch screens the game shows a joystick and buttons for your role.

## How multiplayer works

One player **hosts**: their machine runs the room server (a SpacetimeDB database) and serves the game. Everyone else opens the host's address in a browser and plays as a client. A separate leaderboard database stores finished runs, and it's the only thing meant to live on the internet.

```
 host's machine (npm run host)                          later: hosted
┌──────────────────────────────────────────┐           ┌──────────────────────┐
│ Next.js game :3001   SpacetimeDB :3000   │           │ leaderboard database │
│                      ├ singularity-room  │  (until   │ leaderboard-server/  │
│                      └ singularity  ─────┼── then) ─▶│ submitScore only     │
└───────▲───────────────────────▲──────────┘           └──────────────────────┘
        │ page                  │ ws: rooms, inputs, snapshots
   friends' browsers (same network)
```

- **Room server** (`room-server/`, database `singularity-room`). It holds everything live: rooms, teams, seats, ready-up, the countdown → playing → results lifecycle, the input relay and the physics snapshot relay. Each squad's first player is its **team host**: their browser runs the Rapier physics for the shared body, teammates send inputs, and everyone else sees snapshots. The server times every finish from its own scheduled start, so all clients agree. The database is wiped each time someone starts hosting.
- **Leaderboard** (`leaderboard-server/`, database `singularity`). It stores the top 10 runs per challenge and squad size, and nothing else. The team host files a run after the room server times the finish. Only full squads (one person per seat) and solo free-for-all racers are ranked. Until it's hosted publicly, it runs beside the room server and keeps its data across restarts.
- **Offline practice** (`?offline=1`). The whole room lives in one tab and needs no server. When nobody is hosting, the game offers it automatically.

## Host a game

You need Node 24 and the [SpacetimeDB CLI](https://spacetimedb.com/install) (2.10).

```bash
npm install
npm install --prefix room-server
npm install --prefix leaderboard-server

npm run host
```

`npm run host` does the following:

1. Starts SpacetimeDB on all network interfaces (port 3000) if it isn't already running.
2. Publishes a fresh room server.
3. Publishes the leaderboard, keeping its data.
4. Builds and serves the game on port 3001.

It then prints the addresses to share:

```
 You:      http://localhost:3001
 Friends:  http://192.168.1.20:3001
```

Friends must be on the same network (or a VPN such as Tailscale). If they can't connect, allow ports **3001** and **3000** through the host's firewall. Ctrl+C stops hosting.

To try multiplayer alone, open the game in two browser windows. Each tab gets its own identity.

Options:

- `npm run host -- --dev` serves the game with `next dev` instead of a production build.
- `npm run host -- --port=4000` serves the game on another port.

### Pointing at a different room server

By default a browser looks for the room server on the machine the page came from. To use one somewhere else, add `?server=<address>` to the URL, for example `/play/ABCD2345?server=192.168.1.20`. Invite links keep that override. A host browsing on `localhost` copies an invite with their LAN address swapped in. Build-time defaults live in `.env` (see `.env.example`).

### Hosting the leaderboard later

Publish `leaderboard-server/` to a public SpacetimeDB, for example Maincloud:

```bash
spacetime publish singularity --module-path leaderboard-server --server maincloud
```

Then set `NEXT_PUBLIC_LEADERBOARD_URI` (and `NEXT_PUBLIC_LEADERBOARD_DATABASE` if the name differs) in `.env`. `npm run host` stops publishing a local copy once that's set.

## Develop

```bash
spacetime start                 # local SpacetimeDB on :3000
npm run room:publish            # fresh room server (singularity-room)
npm run leaderboard:publish     # leaderboard (singularity), data kept
npm run dev                     # http://localhost:3001
npm run bindings                # regenerate src/room_bindings + src/leaderboard_bindings after module changes
```

| Command | What it checks |
| --- | --- |
| `npm test` | Unit tests: gameplay, input mapping, timing, snapshots, standings, addresses, scores |
| `npm run typecheck`, `npm run lint` | TypeScript and ESLint |
| `npm run e2e:room` | Room server flow against a running SpacetimeDB: squads, seats, round lifecycle, relays, reconnects, free-for-all, mode switching, room privacy |
| `npm run e2e:leaderboard` | Leaderboard submit and validation. It writes test rows, so point it at a scratch database with `NEXT_PUBLIC_LEADERBOARD_DATABASE` |
| `npm run test:browser` | Playwright regression in Python (needs `npm run dev`, Chrome and `pip install -r tests/requirements-browser.txt`). More suites live in `tests/browser/`, including `shared_body_e2e.py`, which has two browsers drive one body |
| `npm run test:load` | Locust load test against a running game server |

## Repo layout

```
room-server/            SpacetimeDB module: live rooms, relays, round lifecycle
leaderboard-server/     SpacetimeDB module: bounded global leaderboard
src/app/                Next.js routes: landing, /play/[code], /api/host-info
src/components/         GameClient (lobby, HUD, results) and mobile controls
src/components/onboarding/  landing dummy: 2D ragdoll sim, canvas drawing, loader assembly
src/game/               engine: physics body, levels, input, networking adapters
src/room_bindings/      generated client bindings — do not edit
src/leaderboard_bindings/
scripts/host.mjs        npm run host
scripts/*-e2e.ts        module end-to-end suites
tests/                  unit tests (node:test), browser suites (Playwright), load test (Locust)
docs/verification.md    what was verified, and how
```

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup and the checks to run, and please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Sankalp H S and SINGULARITY contributors.
