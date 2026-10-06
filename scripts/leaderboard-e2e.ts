/*
 * End-to-end test for the global leaderboard in the game server module.
 * Browsers cannot submit scores: the server files a run itself when a team
 * it timed finishes, and only for full squads (or a lone free-for-all racer)
 * that beat the course's plausibility floor. This suite plays real rounds on
 * a throwaway database and checks what lands on the board.
 *
 * Usage: npm run e2e:leaderboard   (publishes a throwaway database; see scripts/run-e2e.mjs)
 */
import {
  boardOf, check, connect, DB, finish, fire, meOf, roomCode, roomOf, sleep, startIssuer, stopIssuer, teamOf,
  until, URI, type Client,
} from "./e2e/harness";

const COURSE = "slam-dunk"; // shortest plausibility floor (5 s) keeps the suite quick
const FLOOR_MS = 5_000;

async function startRace(leader: Client, members: Client[]) {
  fire(leader.conn.reducers.setChallenge({ challengeId: COURSE }));
  await until(() => roomOf(leader)?.challengeId === COURSE);
  for (const c of members) fire(c.conn.reducers.setReady({ ready: true }));
  await sleep(200);
  fire(leader.conn.reducers.startRound({ force: true }));
  await until(() => roomOf(leader)?.phase === "playing", 7_000);
}

async function squadRoom(names: string[], size: 3 | 5) {
  const code = roomCode();
  const clients: Client[] = [];
  for (const name of names) {
    const c = await connect(name);
    fire(c.conn.reducers.joinRoom({ code, name, solo: false }));
    await until(() => meOf(c) != null);
    if (clients.length === 0) {
      fire(c.conn.reducers.setSquad({ size }));
      await until(() => roomOf(c)?.squadSize === size);
    }
    clients.push(c);
  }
  return clients;
}

async function main() {
  console.log(`Leaderboard E2E against ${URI} / ${DB}`);
  await startIssuer();
  const tag = Date.now().toString(36).slice(-4).toUpperCase();

  /* ---------- no client write path ---------- */
  const probe = await connect("Probe");
  check("clients have no score-submission reducer", !("submitScore" in probe.conn.reducers));
  const httpBase = URI.replace(/^ws(s?):/, "http$1:");
  const forged = await fetch(`${httpBase}/v1/database/${DB}/call/submit_score`, {
    method: "POST",
    headers: { Authorization: `Bearer ${probe.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(["slam-dunk", 3, "Forged", ["Mallory"], 1_234]),
  });
  check("a forged score call is refused", !forged.ok, `HTTP ${forged.status}`);
  let configureRejected = false;
  await probe.conn.reducers.configureAccess({ issuer: "" }).catch(() => {
    configureRejected = true;
  });
  check("only the database owner can change access", configureRejected);
  check("access stays configured after a player's attempt", (await connect("After")).hex.length > 0);
  const startRows = boardOf(probe).filter((r) => r.challengeId === COURSE && r.squadSize === 3).length;

  /* ---------- a full squad ranks; a short-handed one does not ---------- */
  const full = await squadRoom([`Ann${tag}`, `Ben${tag}`, `Cy${tag}`], 3);
  const short = await squadRoom([`Dee${tag}`, `Eli${tag}`], 3);
  fire(full[0].conn.reducers.renameTeam({ name: `Full ${tag}` }));
  fire(short[0].conn.reducers.renameTeam({ name: `Short ${tag}` }));
  await sleep(300);
  await Promise.all([startRace(full[0], full), startRace(short[0], short)]);
  check("both rooms are racing", roomOf(full[0])?.phase === "playing" && roomOf(short[0])?.phase === "playing");
  await sleep(FLOOR_MS + 600);
  const simulatorOf = (team: Client[]) => team.find((c) => teamOf(c)?.hostId?.toHexString() === c.hex)!;
  fire(simulatorOf(full).conn.reducers.finishRun({ round: roomOf(full[0])!.round }));
  fire(simulatorOf(short).conn.reducers.finishRun({ round: roomOf(short[0])!.round }));
  await until(() => boardOf(probe).some((r) => r.teamName === `Full ${tag}`));
  await sleep(300);
  const fullRow = boardOf(probe).find((r) => r.teamName === `Full ${tag}`);
  check("a full squad's finish lands on the board", fullRow != null);
  check(
    "the row names the people who raced",
    fullRow != null && [...fullRow.players].sort().join() === [`Ann${tag}`, `Ben${tag}`, `Cy${tag}`].sort().join(),
    fullRow?.players.join(),
  );
  check(
    "the time is the server's own",
    fullRow != null && Number(fullRow.timeMs) === Number(teamOf(full[0])?.finishMs),
    `${fullRow?.timeMs} vs ${teamOf(full[0])?.finishMs}`,
  );
  check("a short-handed squad is not ranked", !boardOf(probe).some((r) => r.teamName === `Short ${tag}`));

  /* ---------- the same crew keeps one row, its best ---------- */
  fire(full[0].conn.reducers.startRound({ force: true }));
  await until(() => roomOf(full[0])?.phase === "playing", 7_000);
  await sleep(FLOOR_MS + 2_500);
  fire(simulatorOf(full).conn.reducers.finishRun({ round: roomOf(full[0])!.round }));
  await until(() => teamOf(full[0])?.finishMs != null);
  await sleep(400);
  const crewRows = boardOf(probe).filter((r) => r.teamName === `Full ${tag}`);
  check("a slower repeat does not add a second row", crewRows.length === 1, crewRows.length);
  check("the crew keeps its faster time", crewRows[0] != null && fullRow != null && crewRows[0].timeMs === fullRow.timeMs);

  /* ---------- solo racers rank, the board stays capped ---------- */
  const racers: Client[] = [];
  for (let i = 0; i < 11; i++) {
    const c = await connect(`R${i}${tag}`);
    fire(c.conn.reducers.joinRoom({ code: roomCode(), name: `R${i}${tag}`, solo: true }));
    racers.push(c);
  }
  await until(() => racers.every((c) => roomOf(c) != null));
  await Promise.all(racers.map((c) => startRace(c, [c])));
  await sleep(FLOOR_MS + 300);
  for (const [i, c] of racers.entries()) {
    await sleep(120);
    fire(c.conn.reducers.finishRun({ round: roomOf(c)!.round }));
    void i;
  }
  await sleep(1_200);
  const board = boardOf(probe).filter((r) => r.challengeId === COURSE && r.squadSize === 3);
  check("a solo free-for-all racer ranks", board.some((r) => r.teamName === `R0${tag}` && r.players.join() === `R0${tag}`));
  check("each board keeps at most ten rows", board.length === 10, `${board.length} rows (started with ${startRows})`);
  check("the slowest run is the one evicted", !board.some((r) => r.teamName === `R10${tag}`));

  for (const c of [probe, ...full, ...short, ...racers]) c.conn.disconnect();
  stopIssuer();
  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
