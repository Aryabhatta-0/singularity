/*
 * End-to-end test for the SINGULARITY SpacetimeDB module (leaderboard-only).
 * Submits final runs with the client-trusted clock, checks they land on the
 * bounded leaderboard, and checks invalid submissions are ignored.
 *
 * Usage:
 *   npx esbuild scripts/e2e.ts --bundle --platform=node --format=esm --outfile=scripts/e2e.mjs --external:ws
 *   node scripts/e2e.mjs
 */
import { DbConnection } from "../src/module_bindings/index.js";

const URI =
  process.env.STDB_URI ??
  process.env.NEXT_PUBLIC_SPACETIMEDB_URI ??
  process.env.VITE_SPACETIMEDB_URI ??
  "ws://127.0.0.1:3000";
const DB =
  process.env.STDB_DB ??
  process.env.NEXT_PUBLIC_SPACETIMEDB_MODULE ??
  process.env.SPACETIMEDB_MODULE ??
  process.env.VITE_SPACETIMEDB_DATABASE ??
  "singularity";
const RUN_MARKER = `${Date.now().toString(36).slice(-6)}${process.pid.toString(36).slice(-3)}${Math.random()
  .toString(36)
  .slice(2, 5)}`.toUpperCase();
const TEAM = `E2E-${RUN_MARKER}`;
const PLAYER = `E2E-P-${RUN_MARKER}`;

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Client {
  conn: DbConnection;
}

function connect(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("connect timeout")), 15_000);
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB)
      .onConnect((conn) => {
        conn.subscriptionBuilder()
          .onError((ctx) => {
            clearTimeout(timeout);
            reject(ctx.event ?? new Error("subscription failed"));
          })
          .onApplied(() => {
            clearTimeout(timeout);
            resolve({ conn });
          })
          .subscribe([`SELECT * FROM leaderboard`]);
      })
      .onConnectError((_ctx: unknown, err: Error) => {
        clearTimeout(timeout);
        reject(err);
      })
      .build();
  });
}

const rows = <T,>(it: Iterable<T>): T[] => [...it];
const board = (c: Client) => rows(c.conn.db.leaderboard.iter());
const marked = (c: Client) => board(c).filter((r) => r.teamName === TEAM);

async function main() {
  console.log(`E2E against ${URI} / ${DB}`);
  const c = await connect();

  // 1. Valid submission lands on the board with the submitted fields.
  // Near-minimum time guarantees top-10 survival regardless of board state.
  c.conn.reducers.submitScore({
    challengeId: "wobble-run",
    squadSize: 3,
    teamName: TEAM,
    players: [PLAYER],
    timeMs: 1001n,
  });
  await sleep(800);
  const afterValid = marked(c);
  check("valid submitScore appears on leaderboard", afterValid.length >= 1);
  const row = afterValid.find((r) => r.timeMs === 1001n);
  check(
    "stored fields match submission",
    !!row &&
      row.challengeId === "wobble-run" &&
      row.squadSize === 3 &&
      // Player names are capped at 16 chars server-side (matches the lobby limit).
      row.players.includes(PLAYER.slice(0, 16))
  );
  const countAfterValid = marked(c).length;

  // 2. Unknown challenge is ignored.
  c.conn.reducers.submitScore({
    challengeId: "nope",
    squadSize: 3,
    teamName: TEAM,
    players: [PLAYER],
    timeMs: 1002n,
  });
  await sleep(600);
  check("unknown challenge ignored", marked(c).length === countAfterValid);

  // 3. Sub-minimum time is ignored.
  c.conn.reducers.submitScore({
    challengeId: "wobble-run",
    squadSize: 3,
    teamName: TEAM,
    players: [PLAYER],
    timeMs: 500n,
  });
  await sleep(600);
  check("sub-minimum time ignored", marked(c).length === countAfterValid);

  // 4. Empty team name is ignored.
  c.conn.reducers.submitScore({
    challengeId: "wobble-run",
    squadSize: 3,
    teamName: " ",
    players: [PLAYER],
    timeMs: 1003n,
  });
  await sleep(600);
  check("empty team name ignored", marked(c).length === countAfterValid);

  // 5. Board stays bounded at ten per challenge/squad.
  const key = (r: { challengeId: string; squadSize: number }) => `${r.challengeId}:${r.squadSize}`;
  const counts = new Map<string, number>();
  for (const r of board(c)) counts.set(key(r), (counts.get(key(r)) ?? 0) + 1);
  check(
    "every challenge/squad board capped at ten",
    [...counts.values()].every((n) => n <= 10),
    [...counts.entries()].map(([k, n]) => `${k}=${n}`).join(",")
  );

  c.conn.disconnect();
  console.log(failures === 0 ? "E2E OK" : `E2E FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("E2E ERROR", e);
  process.exit(1);
});
