# SINGULARITY

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)


**Five players. One body.** Singularity is a co-op physics party game. You play it in your web browser.

![The Singularity landing page](docs/landing.png)

## Play online

**<https://singularity-coral.vercel.app>**

1. Create a room.
2. Send the invite link to your friends.
3. Play.

Your friends can join from any location and any network. They can use a computer or a phone. You do not install anything. You do not make an account. Players on the same Wi-Fi or with a strong connection get the smoothest game. A strong connection is not necessary.

## What is Singularity?

Each player controls one part of the same body. One player controls the torso. One player controls the arms. Two players control one leg each. Together, you walk, climb, grab and throw. You also try not to fall into the water. Rival teams race on the same course as see-through "ghosts".

## Features

- **Teams of 3 or 5.** With 3 players, the parts are arms, torso and legs. With 5 players, the parts are left hand, right hand, torso, left leg and right leg.
- **Five courses**: Wobble Run, Egg Express, Slam Dunk, Ferry Job and Summit Sync.
- **Team versus or free-for-all.** Rival teams race as ghosts. Or each player races alone.
- **Best times.** The game server keeps the best times for each course. Click **Best times** on the main page to see them.
- **Made for real networks.** The game smooths out slow connections. It shows the quality of your connection. If your connection stops, the game puts you back in your seat.
- **Phones are welcome.** Phones show a joystick and buttons for your body part.
- **Offline practice.** You can practice alone in one browser tab. You do not need a server.

| Part | Keys |
| --- | --- |
| Legs | `W` `A` `S` `D` walk and step to the side. `Space` jumps. |
| Arms | Arrow keys raise, lower and swing. `E` grabs with two hands. `Q` and `R` grab with the left and right hand. `Shift` throws. |
| Torso | `C` crouches. `B` braces or gets up. The mouse looks around. |

## How online play works

```
   players' browsers (anywhere)
   ├─ page, session token ──────▶ Vercel: Next.js app
   │                               ├ /api/session        signs short-lived game sessions
   │                               ├ /.well-known/*      public key that SpacetimeDB uses to check them
   │                               └ /api/leaderboard    cached, read-only best times
   │
   └─ wss: rooms, inputs, snapshots ─▶ SpacetimeDB Maincloud: database `singularity`
                                        (accepts only sessions that the app signs)
```

- **The web app** (`src/`) runs on Vercel. Before a browser connects to the game server, it gets a signed session token from `/api/session`. The token uses ES256. It is valid for six hours, and the app refreshes it automatically. Only Vercel's server keeps the signing key.
- **The game server** (`server/`) is one SpacetimeDB module. Its database name is `singularity`. The server refuses all connections that do not have a token from the app. Thus, it is not an open public datastore. The server controls rooms, teams, seats and the ready check. It controls the round steps: countdown, playing and results. It also sends inputs and physics snapshots between players. Each room is private. The server shows you only the data for your room.
- **Physics** runs in the browser. In each team, one player's browser calculates the shared body. It sends snapshots to the team. The teammates send their inputs. Their browsers show the snapshots through an adaptive jitter buffer. If that player leaves or stops, the browser of a different team member continues the round. Players do not see this as a "host" role.
- **The server keeps the time.** It starts each round and records the time of each finish. When a team finishes, the server adds the run to the best times if the run qualifies. A run qualifies if it is a full team or a solo free-for-all run, and the time is possible. Players cannot write scores.
- **Offline practice** (`?offline=1`) keeps the full room in one tab without a server. If the game cannot connect to the game server, it offers offline practice automatically.

## Quick start for development

You must have **Node 24** and the [SpacetimeDB CLI](https://spacetimedb.com/install) **2.10**.

```bash
git clone https://github.com/Aryabhatta-0/singularity.git
cd singularity
npm install
npm run host
```

`npm run host` does these steps:

1. It checks your setup.
2. It starts SpacetimeDB on your computer.
3. It publishes the game server to SpacetimeDB.
4. It builds the game.
5. It shows the addresses where you can play:

```
 SINGULARITY LOCAL DEV IS LIVE
 ──────────────────────────────────────────────────────────
 Local app    http://localhost:3001
 LAN          http://192.168.1.20:3001   ← friends on this network
 SpacetimeDB  local · port 3000 · database "singularity"
              sessions signed by http://127.0.0.1:3001 · production build
 Online game  https://singularity-coral.vercel.app   (no setup needed)
```

To play with yourself, open two browser windows. Each tab is a different player. To stop all parts, push Ctrl+C.

If you do not have the SpacetimeDB CLI, do `npm install && npm run dev`. Then start a room and select **Practice offline**.

## Self-host and local development

The local setup is a small copy of the production setup. The app on port `:3001` makes a signing key in `.singularity/`. Git ignores this folder. The local `singularity` database trusts this key.

- To use `next dev` (hot reload) and not a production build, do `npm run host -- --dev`.
- To use a different port, do `npm run host -- --port=4000`.
- To use separate terminals, do `spacetime start`, then `npm run db:local`, then `npm run dev`.
- When you restart, the game keeps the local best times and deletes old rooms.
- Friends on your network can open the LAN address. If they cannot connect, open ports **3001** and **3000** in your firewall. Use self-hosting only on networks that you trust. To play over the internet, use the online game.

## SpacetimeDB

| | Local | Production |
| --- | --- | --- |
| Server | `spacetime start` on `:3000` | Maincloud |
| Database | `singularity` | `singularity` |
| Trusted session issuer | `http://127.0.0.1:3001` | `https://singularity-coral.vercel.app` |
| Publish | `npm run db:local` | `npm run db:publish:maincloud` (does not delete data) |

After you change `server/`, do `npm run bindings` to make the client bindings again. Then commit `src/module_bindings/`.

The owner of the database is the person who published it. The owner must tell the database which issuer to trust. Do this one time for each database:

```bash
spacetime call singularity configure_access '"https://singularity-coral.vercel.app"' --server maincloud
```

## Environment variables

Local development does not need environment variables. For a hosted deployment, read [`.env.example`](.env.example).

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SPACETIMEDB_URI` | public | The game server address, for example `wss://maincloud.spacetimedb.com`. If you do not set it, the game uses port 3000 on the computer that sent the page. |
| `NEXT_PUBLIC_SPACETIMEDB_DATABASE` | public | The database name. The default is `singularity`. |
| `NEXT_PUBLIC_SITE_URL` | public | The main URL of the site. The metadata and the sitemap use it. |
| `SINGULARITY_SESSION_ISSUER` | server | The public address of this site. SpacetimeDB gets the public keys from this address. |
| `SINGULARITY_SESSION_PRIVATE_KEY` | **secret** | The ES256 private JWK that signs game sessions. If it is missing, a Vercel deployment does not give sessions. |

## Testing

| Command | What it tests |
| --- | --- |
| `npm run typecheck`, `npm run lint` | TypeScript and ESLint |
| `npm test` | Unit tests: gameplay, input, timing, jitter buffer, snapshots, sessions, access rules and best-time rules |
| `npm run e2e:room` | The full game server on a temporary database: access control, teams, seats, rounds, relays, reconnects, privacy and abuse limits |
| `npm run e2e:leaderboard` | Best times from the server: ranking rules, duplicates, limits, and a check that players cannot write scores |
| `npm run e2e:online` | A quick test of a deployed site and its database. It does not change the best times. |
| `npm run test:browser` | Playwright tests in Python. They run against `npm run host`. They need Chrome and `pip install -r tests/requirements-browser.txt`. |

There are more browser tests in `tests/browser/`. For example, `network_conditions_e2e.py` plays a round through `scripts/net-sim-proxy.mjs`. It tests LAN, broadband and mobile connections, and a disconnect during a round. The `e2e:*` tests need a local SpacetimeDB (`spacetime start`). They delete their temporary database when they finish.

## Project structure

```
server/                 SpacetimeDB module: access control, rooms, relays, rounds, best times
src/app/                Next.js routes: landing page, /play/[code], /privacy, /terms, API and metadata routes
src/components/         GameClient (lobby, HUD, results), best-times dialog, mobile controls
src/game/               engine: physics body, levels, input, networking, jitter buffer
src/lib/, src/server/   session signing (shared), and server-only session, rate limit and best-time helpers
src/module_bindings/    generated client bindings (do not edit)
scripts/host.mjs        npm run host
scripts/*-e2e.ts        end-to-end tests (they run through scripts/run-e2e.mjs)
tests/                  unit tests (node:test), browser tests (Playwright), load test (Locust)
docs/verification.md    what we tested, and how
```

## Contributing

We welcome your help. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the setup and the checks. Obey the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

To tell us about a security problem, use the private steps in [SECURITY.md](SECURITY.md). That file also gives the threat model and the known limits.

## Privacy

The game has no accounts and does not track you. It keeps a small quantity of information: your name, a random player number, your room while you play, and the best times. The [Privacy page](https://singularity-coral.vercel.app/privacy) and the [Terms](https://singularity-coral.vercel.app/terms) give the full details.

## License

[MIT](LICENSE) © 2026 Sankalp H S and SINGULARITY contributors.

## Credits

Made by [@sankalphs](https://github.com/sankalphs/) and [@sathvikar01](https://github.com/sathvikar01).
