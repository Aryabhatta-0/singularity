/*
 * End-to-end test for the SINGULARITY SpacetimeDB module.
 * Simulates a complete three-player squad joining, readying up, starting a round,
 * relaying inputs/snapshots, recording server-timed bounded leaderboard runs,
 * and cleaning up on disconnect.
 *
 * Usage:
 *   npx esbuild scripts/e2e.ts --bundle --platform=node --format=esm --outfile=scripts/e2e.mjs --external:ws
 *   node scripts/e2e.mjs
 */
import { DbConnection, type EventContext } from "../src/module_bindings/index.js";

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
const CODE = (process.env.STDB_CODE ?? `T${RUN_MARKER}`).toUpperCase().slice(-8);
const ALICE_NAME = `A-${RUN_MARKER}`;
const BOB_NAME = `B-${RUN_MARKER}`;
const CAROL_NAME = `C-${RUN_MARKER}`;
const PRACTICE_NAME = `P-${RUN_MARKER}`;
const LATE_HOST_NAME = `L1-${RUN_MARKER}`;
const LATE_TWO_NAME = `L2-${RUN_MARKER}`;
const LATE_THREE_NAME = `L3-${RUN_MARKER}`;
const LATE_FOUR_NAME = `L4-${RUN_MARKER}`;
const LATE_FIVE_NAME = `L5-${RUN_MARKER}`;
const LATE_SIX_NAME = `L6-${RUN_MARKER}`;
const LATE_SEVEN_NAME = `L7-${RUN_MARKER}`;
const LATE_EIGHT_NAME = `L8-${RUN_MARKER}`;
const SPY_NAME = `S-${RUN_MARKER}`;
const DAVE_NAME = `D-${RUN_MARKER}`;

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Client {
  conn: DbConnection;
  hex: string;
  token: string;
  snapshots: number;
  inputRows: number;
}

function connect(name: string, token?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const c: Partial<Client> = {};
    const timeout = setTimeout(() => reject(new Error(`connect timeout: ${name}`)), 15_000);
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB)
      .withToken(token)
      .onConnect((conn, identity, issuedToken) => {
        c.conn = conn;
        c.hex = identity.toHexString();
        c.token = issuedToken;
        c.snapshots = 0;
        c.inputRows = 0;
        conn.db.visibleSnapshot.onInsert(() => c.snapshots!++);
        conn.db.visibleSnapshot.onUpdate(() => c.snapshots!++);
        conn.db.visibleInput.onInsert(() => c.inputRows!++);
        conn.db.visibleInput.onUpdate(() => c.inputRows!++);
        conn.subscriptionBuilder()
          .onError((ctx) => {
            clearTimeout(timeout);
            reject(ctx.event ?? new Error(`subscription failed: ${name}`));
          })
          .onApplied(() => {
            clearTimeout(timeout);
            resolve(c as Client);
          })
          .subscribe([
            `SELECT * FROM visible_room`,
            `SELECT * FROM visible_player`,
            `SELECT * FROM visible_team`,
            `SELECT * FROM visible_snapshot`,
            `SELECT * FROM visible_input`,
            `SELECT * FROM visible_squad`,
            `SELECT * FROM leaderboard`,
          ]);
      })
      .onConnectError((_ctx: unknown, err: Error) => {
        clearTimeout(timeout);
        reject(err);
      })
      .build();
  });
}

const rows = <T,>(it: Iterable<T>): T[] => [...it];
const roomOf = (c: Client) => rows(c.conn.db.visibleRoom.iter()).find((r) => r.code === CODE);
const playersOf = (c: Client) => rows(c.conn.db.visiblePlayer.iter()).filter((p) => p.code === CODE);
const teamsOf = (c: Client) => rows(c.conn.db.visibleTeam.iter()).filter((t) => t.code === CODE);
const leaderboardOf = (c: Client) => rows(c.conn.db.leaderboard.iter());
const squadsOf = (c: Client) => rows(c.conn.db.visibleSquad.iter()).filter((s) => s.code === CODE);

async function main() {
  console.log(`E2E against ${URI} / ${DB}`);
  let alice = await connect(ALICE_NAME);
  let bob = await connect(BOB_NAME);
  const carol = await connect(CAROL_NAME);

  alice.conn.reducers.joinRoom({ code: CODE, name: ALICE_NAME, solo: false });
  await sleep(700);
  alice.conn.reducers.setSquad({ size: 3 });
  await sleep(300);
  bob.conn.reducers.joinRoom({ code: CODE, name: BOB_NAME, solo: false });
  await sleep(300);
  carol.conn.reducers.joinRoom({ code: CODE, name: CAROL_NAME, solo: false });
  await sleep(1000);

  const room = roomOf(alice);
  check("room created with lobby phase", !!room && room.phase === "lobby", room?.phase);
  check("complete three-player squad joined", playersOf(alice).length === 3);
  check("one team created", teamsOf(alice).length === 1);
  const team = teamsOf(alice)[0];
  check("team host assigned", !!team && !!team.hostId, team?.hostId?.toHexString().slice(0, 8));
  const roles = playersOf(alice).flatMap((p) => p.roles).sort();
  check("3P roles auto-assigned", roles.join(",") === "arms,legs,torso", roles.join(","));
  check("alice is earliest -> host & leader", !!team && team.hostId?.toHexString() === alice.hex && roomOf(alice)?.nextPlayerSeq === 3n);
  check("visible room exposes the authoritative connected leader", roomOf(alice)?.leaderId?.toHexString() === alice.hex);

  alice.conn.reducers.publishSnapshot({
    round: roomOf(alice)!.round, p: new Array(77).fill(0.5), props: [], yaw: 0, pitch: 0, timer: 0,
    fallen: false, score: 0, ev: "[]", msg: undefined,
  });
  await sleep(150);
  check("snapshot publication is rejected in the lobby", rows(alice.conn.db.visibleSnapshot.iter()).length === 0);

  const spy = await connect(SPY_NAME);
  check("unjoined clients cannot enumerate private room views", rows(spy.conn.db.visibleRoom.iter()).length === 0);
  spy.conn.reducers.joinRoom({ code: "ABC", name: SPY_NAME, solo: false });
  await sleep(300);
  check("short codes cannot create new enumerable rooms", rows(spy.conn.db.visiblePlayer.iter()).length === 0);
  spy.conn.reducers.joinRoom({ code: "BAD!CODE", name: SPY_NAME, solo: false });
  await sleep(200);
  check("non-alphanumeric room codes are rejected", rows(spy.conn.db.visiblePlayer.iter()).length === 0);
  spy.conn.disconnect();

  alice.conn.reducers.setReady({ ready: true });
  bob.conn.reducers.setReady({ ready: true });
  carol.conn.reducers.setReady({ ready: true });
  await sleep(400);
  alice.conn.reducers.startRound({ force: false });
  await sleep(500);
  const cd = roomOf(alice);
  check("phase countdown after start", cd?.phase === "countdown", cd?.phase);
  check("startAt scheduled", (cd?.startAtMicros ?? 0n) > 0n);

  // Bob (non-host) relays inputs; Alice (host) publishes a snapshot
  const bobRole = playersOf(alice).find((p) => p.identity.toHexString() === bob.hex)?.roles[0];
  check("bob owns a 3P input role", bobRole === "arms" || bobRole === "torso" || bobRole === "legs", bobRole);
  const validStateEvent = {
    type: "state", checkpoint: 0, delivered: false, moverTime: 1, running: true, finished: false, frozen: false,
    holds: [{ hand: 0, propId: -42 }], bodyVelocities: new Array(66).fill(0.5),
    propVelocities: [0, 1, 2, 3, 4, 5, 6],
  };
  bob.conn.reducers.sendInput({
    roles: [bobRole!],
    inputs: [{ f: 1, s: 0, a: true, b: false, q: false, e: false, lx: 0.5, ly: 0.1 }],
  });
  alice.conn.reducers.publishSnapshot({
    round: roomOf(alice)!.round,
    p: new Array(77).fill(0.5),
    props: [0, 1, 2, 3, 0, 0, 0, 1],
    yaw: 0.1,
    pitch: 0.2,
    timer: 1.5,
    fallen: false,
    score: 0,
    ev: JSON.stringify([
      { type: "shout", pos: [0, 1, 2] },
      validStateEvent,
    ]),
    msg: "good|CHECKPOINT!",
  });
  await sleep(150);
  const inputsSeenByAlice = rows(alice.conn.db.visibleInput.iter()).filter((i) => i.code === CODE);
  check("host received teammate input row", inputsSeenByAlice.length === 1 && inputsSeenByAlice[0].roles[0] === bobRole);
  const unauthorizedRole = (["arms", "torso", "legs"] as const).find((role) => role !== bobRole)!;
  bob.conn.reducers.sendInput({
    roles: [unauthorizedRole],
    inputs: [{ f: -1, s: 0, a: false, b: false, q: false, e: false, lx: 0, ly: 0 }],
  });
  await sleep(300);
  const afterUnauthorized = rows(alice.conn.db.visibleInput.iter()).find((i) => i.code === CODE && i.identity.toHexString() === bob.hex);
  check("unassigned role input rejected", afterUnauthorized == null || afterUnauthorized.roles[0] === bobRole, afterUnauthorized?.roles.join(","));
  check("bob received snapshot (row + callback)", bob.snapshots >= 1, `count=${bob.snapshots}`);
  // Note: the module broadcasts rows to all subscribers; the game's Net layer is
  // responsible for ignoring the host's own snapshot (which this raw client doesn't do).
  check("snapshot row visible to subscribers", alice.snapshots >= 1, `count=${alice.snapshots}`);
  const firstOrderedSnapshot = rows(alice.conn.db.visibleSnapshot.iter())[0]!;
  const firstSnapshotSequence = firstOrderedSnapshot.sequence;
  check("snapshot is stamped with the current round", firstOrderedSnapshot.round === roomOf(alice)?.round, String(firstOrderedSnapshot.round));
  check("first snapshot sequence starts at one", firstOrderedSnapshot.sequence === 1n, String(firstOrderedSnapshot.sequence));
  const relayedState = JSON.parse(rows(alice.conn.db.visibleSnapshot.iter())[0]!.ev)[1];
  check("valid body and prop velocities relay unchanged", relayedState.bodyVelocities.length === 66 && relayedState.propVelocities.join(",") === "0,1,2,3,4,5,6");
  const carolRole = playersOf(alice).find((p) => p.identity.toHexString() === carol.hex)?.roles[0];
  carol.conn.reducers.sendInput({
    roles: [carolRole!],
    inputs: [{ f: 2, s: 0, a: false, b: false, q: false, e: false, lx: 0, ly: 0 }],
  });
  await sleep(100);
  check("out-of-range control inputs are rejected", !rows(alice.conn.db.visibleInput.iter()).some((row) => row.identity.toHexString() === carol.hex));
  carol.conn.reducers.sendInput({
    roles: [carolRole!], inputs: [{ f: 0.25, s: 0, a: false, b: false, q: false, e: false, lx: 0, ly: 0 }],
  });
  carol.conn.reducers.sendInput({
    roles: [carolRole!], inputs: [{ f: 0.75, s: 0, a: false, b: false, q: false, e: false, lx: 0, ly: 0 }],
  });
  await sleep(100);
  check("input relay rate ceiling drops a rapid duplicate", rows(alice.conn.db.visibleInput.iter()).find((row) => row.identity.toHexString() === carol.hex)?.inputs[0]?.f === 0.25);
  alice.conn.reducers.yieldHost({});
  await sleep(300);
  check("host can yield simulation to a connected teammate", teamsOf(alice)[0]?.hostId?.toHexString() === bob.hex);
  const velocityProof = (ev: string) => ({
    round: roomOf(bob)!.round, p: new Array(77).fill(0.5), props: [] as number[], yaw: 0, pitch: 0, timer: 0,
    fallen: false, score: 0, ev, msg: undefined,
  });
  const rejectsVelocityProof = async (name: string, ev: string) => {
    const before = rows(alice.conn.db.visibleSnapshot.iter())[0]!.recvMicros;
    bob.conn.reducers.publishSnapshot(velocityProof(ev));
    await sleep(100);
    check(name, rows(alice.conn.db.visibleSnapshot.iter())[0]!.recvMicros === before);
  };
  await rejectsVelocityProof(
    "malformed body velocity length is rejected",
    JSON.stringify([{ ...validStateEvent, bodyVelocities: new Array(65).fill(0) }]),
  );
  const nonFiniteVelocityJson = JSON.stringify([
    { ...validStateEvent, bodyVelocities: ["NONFINITE", ...new Array(65).fill(0)] },
  ]).replace('"NONFINITE"', "1e400");
  await rejectsVelocityProof("non-finite body velocity is rejected", nonFiniteVelocityJson);
  await rejectsVelocityProof(
    "out-of-range body velocity is rejected",
    JSON.stringify([{ ...validStateEvent, bodyVelocities: [101, ...new Array(65).fill(0)] }]),
  );
  await rejectsVelocityProof(
    "malformed prop velocity stride is rejected",
    JSON.stringify([{ ...validStateEvent, propVelocities: [0, 1] }]),
  );
  await rejectsVelocityProof(
    "duplicate prop velocity ids are rejected",
    JSON.stringify([{ ...validStateEvent, propVelocities: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1] }]),
  );
  bob.conn.reducers.publishSnapshot({
    round: roomOf(bob)!.round, p: [0], props: [], yaw: 0, pitch: 0, timer: 0, fallen: false, score: 0, ev: "[]", msg: undefined,
  });
  await sleep(100);
  check("malformed snapshot shapes are rejected", rows(alice.conn.db.visibleSnapshot.iter())[0]?.p.length === 77);
  const firstRateSnapshot = new Array(77).fill(0.5);
  firstRateSnapshot[0] = 1;
  const secondRateSnapshot = [...firstRateSnapshot];
  secondRateSnapshot[0] = 2;
  bob.conn.reducers.publishSnapshot({ round: roomOf(bob)!.round, p: firstRateSnapshot, props: [], yaw: 0, pitch: 0, timer: 0, fallen: false, score: 0, ev: "[]", msg: undefined });
  bob.conn.reducers.publishSnapshot({ round: roomOf(bob)!.round, p: secondRateSnapshot, props: [], yaw: 0, pitch: 0, timer: 0, fallen: false, score: 0, ev: "[]", msg: undefined });
  await sleep(100);
  check("snapshot relay rate ceiling drops a rapid duplicate", rows(alice.conn.db.visibleSnapshot.iter())[0]?.p[0] === 1);
  check(
    "accepted snapshots advance the server-owned sequence",
    (rows(alice.conn.db.visibleSnapshot.iter())[0]?.sequence ?? 0n) > (firstSnapshotSequence ?? 0n),
    String(rows(alice.conn.db.visibleSnapshot.iter())[0]?.sequence),
  );
  const badQuaternion = new Array(77).fill(0.5);
  badQuaternion[3] = 2;
  bob.conn.reducers.publishSnapshot({
    round: roomOf(bob)!.round, p: badQuaternion, props: [], yaw: 0, pitch: 0, timer: 0, fallen: false, score: 0, ev: "[]", msg: undefined,
  });
  const hugePosition = new Array(77).fill(0.5);
  hugePosition[0] = 1_000_000;
  bob.conn.reducers.publishSnapshot({
    round: roomOf(bob)!.round, p: hugePosition, props: [], yaw: 0, pitch: 0, timer: 0, fallen: false, score: 0, ev: "[]", msg: undefined,
  });
  await sleep(100);
  check("non-normal and huge snapshot transforms are rejected", rows(alice.conn.db.visibleSnapshot.iter())[0]?.p[0] === 1);
  await sleep(900);
  check("stale relay inputs expire server-side", !rows(alice.conn.db.visibleInput.iter()).some((row) => row.identity.toHexString() === bob.hex));

  // wait for the scheduled countdown transition (4.2s)
  await sleep(4500);
  check("phase playing after countdown", roomOf(alice)?.phase === "playing", roomOf(alice)?.phase);

  const originalAliceIdentity = alice.hex;
  const originalTeamId = team.id;
  const aliceToken = alice.token;
  alice.conn.disconnect();
  await sleep(500);
  check("disconnect keeps roster membership during reconnect grace", playersOf(bob).some((player) => player.identity.toHexString() === originalAliceIdentity));
  check("disconnect promotes a connected teammate", teamsOf(bob)[0]?.hostId?.toHexString() === bob.hex);
  alice = await connect(ALICE_NAME, aliceToken);
  alice.conn.reducers.joinRoom({ code: CODE, name: ALICE_NAME, solo: false });
  await sleep(900);
  const recoveredAlice = playersOf(alice).find((player) => player.identity.toHexString() === alice.hex);
  check("active-round reconnect preserves identity", alice.hex === originalAliceIdentity);
  check("active-round reconnect restores the original team", recoveredAlice?.teamId === originalTeamId);
  alice.conn.reducers.joinRoom({ code: "SWITCH99", name: ALICE_NAME, solo: false });
  await sleep(200);
  check("active-round identities cannot switch rooms", playersOf(alice).some((player) => player.identity.toHexString() === alice.hex));

  const forgedClientTime = 999_999_999n;
  const finishPose = new Array(77).fill(0.5);
  finishPose[0] = 0;
  finishPose[1] = 1.5;
  finishPose[2] = -64;
  // Bob is the current host after Alice's disconnect promoted him. Publish a
  // normal frame and immediately finish with atomic proof inside the relay
  // ceiling; the proof must not be lost to snapshot throttling.
  bob.conn.reducers.publishSnapshot({
    round: roomOf(bob)!.round, p: new Array(77).fill(0.5), props: [], yaw: 0, pitch: 0, timer: 2,
    fallen: false, score: 0, ev: "[]", msg: undefined,
  });
  bob.conn.reducers.finishRunWithProof({
    timeMs: forgedClientTime,
    round: roomOf(bob)!.round,
    p: finishPose, props: [], yaw: 0, pitch: 0, timer: 2,
    fallen: false, score: 0, ev: "[]", msg: undefined,
  });
  await sleep(800);
  const teamAfter = teamsOf(alice)[0];
  check(
    "server-authoritative finish time recorded",
    teamAfter?.finishMs != null && teamAfter.finishMs > 0n && teamAfter.finishMs !== forgedClientTime,
    String(teamAfter?.finishMs)
  );
  const boardAfter = leaderboardOf(alice).filter((row) => row.challengeId === "wobble-run" && row.squadSize === 3);
  check(
    "complete squad objective proof writes a global ranked record",
    boardAfter.some((row) => row.players.includes(ALICE_NAME)),
    `rows=${boardAfter.length}`
  );
  check("leaderboard rows carry explicit squad size", boardAfter.every((row) => row.squadSize === 3));
  const boardCounts = new Map<string, number>();
  for (const row of leaderboardOf(alice)) {
    const key = `${row.challengeId}/${row.squadSize}`;
    boardCounts.set(key, (boardCounts.get(key) ?? 0) + 1);
  }
  check("every challenge/squad leaderboard is capped at ten", [...boardCounts.values()].every((count) => count <= 10));
  const leaderboardIdsAfterRankedRun = leaderboardOf(alice).map((row) => row.id).sort();
  check("single team finish -> results", roomOf(alice)?.phase === "results", roomOf(alice)?.phase);

  const rankedMarkerCount = leaderboardOf(alice).filter((row) => row.players.includes(ALICE_NAME)).length;
  // Alice keeps her original room-leader sequence through reconnect grace.
  alice.conn.reducers.backToLobby({});
  await sleep(500);
  check("back to lobby", roomOf(alice)?.phase === "lobby", roomOf(alice)?.phase);
  const originalTeamName = teamsOf(alice).find((candidate) => candidate.id === originalTeamId)?.name;
  carol.conn.reducers.renameTeam({ name: `NOPE-${RUN_MARKER}` });
  await sleep(250);
  check("non-host cannot rename a team", teamsOf(alice).find((candidate) => candidate.id === originalTeamId)?.name === originalTeamName);
  const renamedTeam = `Wobble ${RUN_MARKER}`.slice(0, 22);
  bob.conn.reducers.renameTeam({ name: `  ${renamedTeam.replace(" ", "   ")}  ` });
  await sleep(350);
  check("team host can set a normalized lobby name", teamsOf(alice).find((candidate) => candidate.id === originalTeamId)?.name === renamedTeam);
  alice.conn.reducers.startRound({ force: true });
  await sleep(300);
  check("starting a new round removes the previous round snapshot", rows(alice.conn.db.visibleSnapshot.iter()).length === 0);
  bob.conn.reducers.publishSnapshot({
    round: roomOf(bob)!.round - 1, p: new Array(77).fill(0.5), props: [], yaw: 0, pitch: 0, timer: 0,
    fallen: false, score: 0, ev: "[]", msg: undefined,
  });
  await sleep(150);
  check("queued snapshot from an old round is rejected", rows(alice.conn.db.visibleSnapshot.iter()).length === 0);
  bob.conn.reducers.publishSnapshot({
    round: roomOf(bob)!.round, p: new Array(77).fill(0.5), props: [], yaw: 0, pitch: 0, timer: 0,
    fallen: false, score: 0, ev: "[]", msg: undefined,
  });
  await sleep(150);
  const resetSnapshot = rows(alice.conn.db.visibleSnapshot.iter())[0];
  check("new-round snapshot is stamped with the new round", resetSnapshot?.round === roomOf(alice)?.round, String(resetSnapshot?.round));
  check("snapshot sequence resets once per round", resetSnapshot?.sequence === 1n, String(resetSnapshot?.sequence));
  await sleep(5_050);
  check("unverified round reached playing phase", roomOf(alice)?.phase === "playing", roomOf(alice)?.phase);
  bob.conn.reducers.finishRun({ timeMs: 1n });
  await sleep(600);
  check("finish without objective proof is rejected", teamsOf(alice)[0]?.finishMs == null);
  check("rejected finish does not end the round", roomOf(alice)?.phase === "playing", roomOf(alice)?.phase);
  check(
    "finish call without fresh objective proof is not ranked",
    leaderboardOf(alice).filter((row) => row.players.includes(ALICE_NAME)).length === rankedMarkerCount
  );
  alice.conn.reducers.backToLobby({});
  await sleep(500);

  const aliceRole = playersOf(alice).find((player) => player.identity.toHexString() === alice.hex)!.roles[0];
  alice.conn.reducers.sendInput({
    roles: [aliceRole], inputs: [{ f: 0.5, s: 0, a: false, b: false, q: false, e: false, lx: 0, ly: 0 }],
  });
  await sleep(100);
  check("displaced-role input exists before role steal", rows(alice.conn.db.visibleInput.iter()).some((row) => row.identity.toHexString() === alice.hex));
  carol.conn.reducers.setRole({ role: aliceRole });
  await sleep(200);
  check("stealing a role clears the displaced player's input", !rows(alice.conn.db.visibleInput.iter()).some((row) => row.identity.toHexString() === alice.hex));

  carol.conn.reducers.sendInput({
    roles: [playersOf(alice).find((player) => player.identity.toHexString() === carol.hex)!.roles[0]],
    inputs: [{ f: 0.5, s: 0, a: false, b: false, q: false, e: false, lx: 0, ly: 0 }],
  });
  await sleep(100);
  check("lobby relay row created for routing test", rows(alice.conn.db.visibleInput.iter()).some((row) => row.identity.toHexString() === carol.hex));
  carol.conn.reducers.createTeam({});
  await sleep(300);
  check("changing teams clears the old routed input", !rows(alice.conn.db.visibleInput.iter()).some((row) => row.identity.toHexString() === carol.hex));
  const rivalTeam = teamsOf(alice).find((candidate) => candidate.id !== originalTeamId);
  check("simultaneous rival teams have unique durable colors", new Set(teamsOf(alice).map((candidate) => candidate.color)).size === teamsOf(alice).length);
  void carol.conn.reducers.renameTeam({ name: renamedTeam.toUpperCase() }).catch(() => undefined);
  await sleep(250);
  check("team names are unique case-insensitively", teamsOf(alice).find((candidate) => candidate.id === rivalTeam?.id)?.name === rivalTeam?.name);
  carol.conn.reducers.joinTeam({ teamId: originalTeamId });
  await sleep(300);

  alice.conn.reducers.setSquad({ size: 5 });
  await sleep(300);
  const dave = await connect(DAVE_NAME);
  dave.conn.reducers.joinRoom({ code: CODE, name: DAVE_NAME, solo: false });
  await sleep(500);
  check("fourth player joins after expanding squad", playersOf(alice).length === 4);
  alice.conn.reducers.setSquad({ size: 3 });
  await sleep(300);
  check("5-to-3 shrink is rejected while a team exceeds capacity", squadsOf(alice)[0]?.size === 5);
  dave.conn.reducers.leaveRoom({});
  await sleep(200);
  dave.conn.disconnect();
  alice.conn.reducers.setSquad({ size: 3 });
  await sleep(300);

  // Keep only Bob eligible so the same-token lease handoff has an observable
  // effect on both the player flag and authoritative team host.
  alice.conn.reducers.setHostEligible({ eligible: false });
  carol.conn.reducers.setHostEligible({ eligible: false });
  await sleep(250);
  const bobLease = await connect(`${BOB_NAME}-lease`, bob.token);
  bobLease.conn.reducers.setReady({ ready: false });
  bob.conn.reducers.setReady({ ready: true });
  await sleep(300);
  check("superseded same-token connection cannot mutate player state", playersOf(alice).find((player) => player.identity.toHexString() === bob.hex)?.ready === false);
  bobLease.conn.reducers.setHostEligible({ eligible: false });
  await sleep(250);
  bob.conn.reducers.setHostEligible({ eligible: true });
  await sleep(250);
  check("inactive same-token eligibility is stored without overriding the active lease", playersOf(alice).find((player) => player.identity.toHexString() === bob.hex)?.hostEligible === false);
  check("hidden active lease leaves no eligible team host", teamsOf(alice)[0]?.hostId == null);
  bobLease.conn.disconnect();
  await sleep(400);
  check("visible fallback lease restores identity eligibility", playersOf(alice).find((player) => player.identity.toHexString() === bob.hex)?.hostEligible === true);
  check("visible fallback lease restores the team host", teamsOf(alice)[0]?.hostId?.toHexString() === bob.hex);
  bob.conn.reducers.setReady({ ready: true });
  await sleep(300);
  check("remaining same-token connection regains the active lease", playersOf(alice).find((player) => player.identity.toHexString() === bob.hex)?.ready === true);
  alice.conn.reducers.setHostEligible({ eligible: true });
  carol.conn.reducers.setHostEligible({ eligible: true });
  await sleep(250);

  alice.conn.disconnect();
  await sleep(500);
  check("leader disconnect immediately exposes the connected successor", roomOf(bob)?.leaderId?.toHexString() === bob.hex);
  bob.conn.reducers.setChallenge({ challengeId: "summit-sync" });
  await sleep(300);
  check("connected successor can use leader-only lobby controls", roomOf(bob)?.challengeId === "summit-sync");
  alice = await connect(ALICE_NAME, aliceToken);
  alice.conn.reducers.joinRoom({ code: CODE, name: ALICE_NAME, solo: false });
  await sleep(500);

  alice.conn.reducers.setHostEligible({ eligible: false });
  carol.conn.reducers.setHostEligible({ eligible: true });
  await sleep(250);
  const bobToken = bob.token;
  bob.conn.disconnect();
  await sleep(500);
  check("host failover skips an earlier ineligible teammate", teamsOf(alice)[0]?.hostId?.toHexString() === carol.hex);
  check("room leadership also skips an earlier ineligible teammate", roomOf(alice)?.leaderId?.toHexString() === carol.hex);
  carol.conn.reducers.setChallenge({ challengeId: "egg-express" });
  await sleep(250);
  check("eligible successor can use leader-only controls", roomOf(alice)?.challengeId === "egg-express");
  carol.conn.reducers.setHostEligible({ eligible: false });
  await sleep(300);
  check("a team has no host when every connected member is ineligible", teamsOf(alice)[0]?.hostId == null);
  check("a room has no leader when every connected member is ineligible", roomOf(alice)?.leaderId == null);
  alice.conn.reducers.setHostEligible({ eligible: true });
  await sleep(300);
  check("an eligible teammate resumes a hostless team", teamsOf(alice)[0]?.hostId?.toHexString() === alice.hex);
  check("an eligible teammate resumes room leadership", roomOf(alice)?.leaderId?.toHexString() === alice.hex);
  bob = await connect(BOB_NAME, bobToken);
  bob.conn.reducers.joinRoom({ code: CODE, name: BOB_NAME, solo: false });
  await sleep(500);

  // disconnect cleanup: players + room should disappear when the last connection drops
  alice.conn.reducers.leaveRoom({});
  bob.conn.reducers.leaveRoom({});
  carol.conn.reducers.leaveRoom({});
  await sleep(500);
  alice.conn.disconnect();
  bob.conn.disconnect();
  carol.conn.disconnect();
  await sleep(1500);
  const observer = await connect("Observer");
  await sleep(500);
  check("room cleaned up after everyone left", roomOf(observer) === undefined);
  check("players cleaned up after everyone left", playersOf(observer).length === 0);
  check(
    "room cleanup does not mutate the global leaderboard",
    leaderboardOf(observer).map((row) => row.id).sort().join(",") === leaderboardIdsAfterRankedRun.join(",")
  );

  const practice = await connect(PRACTICE_NAME);
  practice.conn.reducers.joinRoom({ code: CODE, name: PRACTICE_NAME, solo: true });
  await sleep(600);
  practice.conn.reducers.startRound({ force: true });
  await sleep(5_500);
  check("solo practice reached playing phase", roomOf(practice)?.phase === "playing", roomOf(practice)?.phase);
  practice.conn.reducers.publishSnapshot({
    round: roomOf(practice)!.round, p: finishPose, props: [], yaw: 0, pitch: 0, timer: 2, fallen: false, score: 0, ev: "[]", msg: undefined,
  });
  await sleep(100);
  practice.conn.reducers.finishRun({ timeMs: 1n });
  await sleep(600);
  check("solo practice still records round finish", teamsOf(practice)[0]?.finishMs != null);
  check(
    "solo practice is excluded from global rankings",
    !leaderboardOf(observer).some((row) => row.players.includes(PRACTICE_NAME))
  );
  practice.conn.reducers.leaveRoom({});
  await sleep(300);
  practice.conn.disconnect();

  await sleep(500);
  const lateHost = await connect(LATE_HOST_NAME);
  const lateTwo = await connect(LATE_TWO_NAME);
  const lateThree = await connect(LATE_THREE_NAME);
  const lateFour = await connect(LATE_FOUR_NAME);
  const lateFive = await connect(LATE_FIVE_NAME);
  const lateSix = await connect(LATE_SIX_NAME);
  const lateSeven = await connect(LATE_SEVEN_NAME);
  const lateEight = await connect(LATE_EIGHT_NAME);
  lateHost.conn.reducers.joinRoom({ code: CODE, name: LATE_HOST_NAME, solo: false });
  await sleep(500);
  lateHost.conn.reducers.setSquad({ size: 3 });
  await sleep(300);
  lateTwo.conn.reducers.joinRoom({ code: CODE, name: LATE_TWO_NAME, solo: false });
  await sleep(300);
  lateTwo.conn.reducers.createTeam({});
  await sleep(300);
  lateThree.conn.reducers.joinRoom({ code: CODE, name: LATE_THREE_NAME, solo: false });
  await sleep(300);
  lateThree.conn.reducers.createTeam({});
  await sleep(300);
  for (const [client, name] of [
    [lateFour, LATE_FOUR_NAME],
    [lateFive, LATE_FIVE_NAME],
    [lateSix, LATE_SIX_NAME],
  ] as const) {
    client.conn.reducers.joinRoom({ code: CODE, name, solo: false });
    await sleep(250);
    client.conn.reducers.createTeam({});
    await sleep(250);
  }
  lateSeven.conn.reducers.joinRoom({ code: CODE, name: LATE_SEVEN_NAME, solo: false });
  await sleep(300);
  const lateSevenTeam = playersOf(lateHost).find((player) => player.identity.toHexString() === lateSeven.hex)?.teamId;
  lateSeven.conn.reducers.createTeam({});
  await sleep(300);
  check("a room is capped at six teams", teamsOf(lateHost).length === 6 && playersOf(lateHost).find((player) => player.identity.toHexString() === lateSeven.hex)?.teamId === lateSevenTeam);
  check("all six simultaneous teams have unique colors", new Set(teamsOf(lateHost).map((teamRow) => teamRow.color)).size === 6);
  lateHost.conn.reducers.startRound({ force: true });
  await sleep(300);
  lateEight.conn.reducers.joinRoom({ code: CODE, name: LATE_EIGHT_NAME, solo: false });
  await sleep(5_000);
  check("new identities cannot join an active round", playersOf(lateHost).length === 7);
  check("late-join round reached playing phase", roomOf(lateHost)?.phase === "playing", roomOf(lateHost)?.phase);
  lateHost.conn.reducers.publishSnapshot({
    round: roomOf(lateHost)!.round, p: finishPose, props: [], yaw: 0, pitch: 0, timer: 2, fallen: false, score: 0, ev: "[]", msg: undefined,
  });
  await sleep(100);
  const graceStartedAt = Date.now();
  lateHost.conn.reducers.finishRun({ timeMs: 1n });
  await sleep(600);
  check("late-join round still records its finish", teamsOf(lateHost)[0]?.finishMs != null);
  check("first proven finish starts grace without ending competitors immediately", roomOf(lateHost)?.phase === "playing", roomOf(lateHost)?.phase);
  await sleep(5_000);
  lateTwo.conn.reducers.publishSnapshot({
    round: roomOf(lateTwo)!.round, p: finishPose, props: [], yaw: 0, pitch: 0, timer: 2, fallen: false, score: 0, ev: "[]", msg: undefined,
  });
  await sleep(100);
  lateTwo.conn.reducers.finishRun({ timeMs: 1n });
  await sleep(500);
  check("later team finish does not end a round with a stalled competitor", roomOf(lateHost)?.phase === "playing", roomOf(lateHost)?.phase);
  lateThree.conn.disconnect();
  const waitForOriginalGrace = Math.max(0, graceStartedAt + 46_500 - Date.now());
  await sleep(waitForOriginalGrace);
  check("first finish grace is not extended and bounds a disconnected competitor", roomOf(lateHost)?.phase === "results", roomOf(lateHost)?.phase);
  check(
    "incomplete active-round roster cannot write a ranked run",
    !leaderboardOf(observer).some((row) => row.players.includes(LATE_HOST_NAME))
  );
  lateHost.conn.reducers.leaveRoom({});
  lateTwo.conn.reducers.leaveRoom({});
  await sleep(300);
  lateHost.conn.disconnect();
  lateTwo.conn.disconnect();
  lateFour.conn.disconnect();
  lateFive.conn.disconnect();
  lateSix.conn.disconnect();
  lateSeven.conn.disconnect();
  lateEight.conn.disconnect();
  observer.conn.disconnect();

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
