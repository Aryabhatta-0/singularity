# Architecture

SINGULARITY is a Next.js 16 / React 19 app with a Three.js renderer and Rapier physics, plus two SpacetimeDB modules written in TypeScript. See `../README.md` for hosting and test commands.

## Who runs what

| Piece | Runs on | Holds |
| --- | --- | --- |
| Game (Next.js) | the host's machine, `:3001` | pages, `/api/host-info` (the host's LAN addresses) |
| Room server (`room-server/`, `singularity-room`) | the host's machine, SpacetimeDB `:3000` | live rooms only; wiped each time hosting starts |
| Leaderboard (`leaderboard-server/`, `singularity`) | beside the room server for now; meant to be hosted publicly | top 10 runs per challenge × squad size |
| Physics | each **team host's** browser | the squad's shared ragdoll |

A browser finds the room server on the hostname that served the page, unless `?server=` or `NEXT_PUBLIC_ROOM_SERVER_URI` says otherwise (`src/game/server-address.ts`).

## The shared body

A squad is 3 players (Arms, Torso, Legs) or 5 players (L Hand, R Hand, Torso, L Leg, R Leg). Every seat is one input channel into one 11-part Rapier ragdoll (`src/game/body.ts`). In 3P, Arms drives both hands and Legs drives both feet. `src/game/joint-input.ts` merges the channels into body inputs: legs must alternate to walk, and both hands must grab to lift heavy cargo.

The squad's earliest connected, visible member is the **team host**:

1. Teammates send their seat inputs to the room server (`sendInput`, at most 125 Hz). Inputs older than 750 ms are swept, so a backgrounded tab can't leave a key held.
2. The team host merges remote and local inputs, steps physics at a fixed rate, and publishes snapshots (`publishSnapshot`, about 30 Hz).
3. Teammates render their own body from those snapshots. Rival squads show up as non-contact ghosts, interpolated about 55 ms behind (`src/game/ghost-snapshot.ts`).
4. If the team host disconnects or hides the tab, the server hands hosting to the next teammate.

## Round lifecycle

The room server owns the round: `lobby → countdown (4.2 s) → playing → results`. The leader (the earliest connected player) picks the challenge and squad size and starts the round. At countdown the server fills uncovered seats and records each squad's roster, so a dropped player can rejoin their seat mid-round (30 s grace).

When a team host's simulation reaches the objective, it calls `finishRun`. The server stamps the time from its own scheduled start. The first finish gives everyone else 45 s, and a round never runs longer than 15 minutes. Clients align countdowns to the server clock (`ServerClock` in `src/game/timing.ts`).

Free-for-all rooms (`?solo=1`, alias `?ffa=1`) give every joiner their own whole body and a team named after them. Plain invite links into such a room race solo too.

## Leaderboard

After a finish, the team host files the server-timed run with the leaderboard (`src/game/leaderboard-feed.ts`). Only full squads and lone free-for-all racers are ranked (`isRankedRoster` in `src/game/score-submit.ts`). Times are trusted from the room server, and the leaderboard only validates shape and bounds.

## Client networking

`GameClient` talks to one interface, `GameNet` (`src/game/game-net.ts`), which has two adapters:

- `RoomNet` connects to the room server and handles reconnects, host hand-off, input leases and snapshot ordering.
- `OfflineNet` is `LocalRoom` in one tab. It's for practice when nobody is hosting.

## Courses

Five challenges live in `src/game/levels.ts`, with metadata in `src/game/types.ts`: Wobble Run (easy), Ferry Job (medium), Summit Sync (hard), and the bonus courses Egg Express and Slam Dunk.
