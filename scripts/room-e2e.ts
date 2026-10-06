/*
 * End-to-end test for live rooms in the game server module (server/).
 * Simulates several players on separate identities: a three-player squad
 * joins, a rival team forms, the round runs (countdown -> playing -> results)
 * with inputs and snapshots relayed, the server times the finish, a dropped
 * player reconnects into their seat, free-for-all invite links race solo,
 * rooms stay invisible to outsiders, and connections without a trusted
 * session are refused.
 *
 * Usage: npm run e2e:room   (publishes a throwaway database; see scripts/run-e2e.mjs)
 */
import {
  boardOf, check, connect, DB, finish, fire, meOf, mintForeignToken, mintToken, neutral, playersOf, refused,
  roomCode, roomOf, sleep, snapshotArgs, startIssuer, stopIssuer, teamOf, teamsOf, until, URI,
} from "./e2e/harness";

async function main() {
  console.log(`Room E2E against ${URI} / ${DB}`);
  await startIssuer();
  const CODE = roomCode();

  /* ---------- access ---------- */
  check("anonymous connections are refused", await refused(undefined));
  check("sessions from another issuer are refused", await refused(await mintForeignToken()));

  /* ---------- lobby ---------- */
  const alice = await connect("Alice");
  fire(alice.conn.reducers.joinRoom({ code: CODE, name: "Alice", solo: false }));
  await until(() => roomOf(alice) != null);
  check("creator opens the room and starts it", roomOf(alice)?.leaderId?.toHexString() === alice.hex);
  fire(alice.conn.reducers.setSquad({ size: 3 }));
  await until(() => roomOf(alice)?.squadSize === 3);
  check("creator switches to a 3-player squad", roomOf(alice)?.squadSize === 3);

  let bob = await connect("Bob");
  const carol = await connect("Carol");
  fire(bob.conn.reducers.joinRoom({ code: CODE, name: "Bob‮ evil", solo: false }));
  fire(carol.conn.reducers.joinRoom({ code: CODE, name: "Carol", solo: false }));
  await until(() => playersOf(alice).length === 3);
  check("friends land on the same team", teamOf(bob)?.id === teamOf(alice)?.id && teamOf(carol)?.id === teamOf(alice)?.id);
  const roles = playersOf(alice).flatMap((p) => p.roles).sort();
  check("each friend gets a distinct seat", roles.join() === "arms,legs,torso", roles.join());
  check("first joiner simulates the team body", teamOf(alice)?.hostId?.toHexString() === alice.hex);
  check("bidi overrides are stripped from names", meOf(bob)?.name === "Bob evil", JSON.stringify(meOf(bob)?.name));

  fire(bob.conn.reducers.setChallenge({ challengeId: "ferry-job" }));
  await sleep(300);
  check("only the room's starter picks the challenge", roomOf(alice)?.challengeId === "wobble-run");
  fire(alice.conn.reducers.setChallenge({ challengeId: "ferry-job" }));
  await until(() => roomOf(bob)?.challengeId === "ferry-job");
  check("starter picks the challenge", roomOf(bob)?.challengeId === "ferry-job");

  fire(carol.conn.reducers.renameTeam({ name: "Wobble  Crew" }));
  await until(() => teamOf(alice)?.name === "Wobble Crew");
  check("any squad member can rename the team", teamOf(alice)?.name === "Wobble Crew", teamOf(alice)?.name);

  const dave = await connect("Dave");
  fire(dave.conn.reducers.joinRoom({ code: CODE, name: "Dave", solo: false }));
  await until(() => teamOf(dave) != null);
  check("a full squad sends the next friend to a rival team", teamOf(dave) != null && teamOf(dave)?.id !== teamOf(alice)?.id);
  check("rival team is numbered", teamOf(dave)?.name === "Team 1" || teamOf(dave)?.name === "Team 2", teamOf(dave)?.name);

  const spy = await connect("Spy");
  fire(spy.conn.reducers.joinRoom({ code: roomCode(), name: "Spy", solo: false }));
  await until(() => roomOf(spy) != null);
  check("outsiders cannot see this room", !playersOf(spy).some((p) => p.code === CODE) && !teamsOf(spy).some((t) => t.code === CODE));
  await sleep(400);
  const [hopA, hopB] = [roomCode(), roomCode()];
  fire(spy.conn.reducers.joinRoom({ code: hopA, name: "Spy", solo: false }));
  fire(spy.conn.reducers.joinRoom({ code: hopB, name: "Spy", solo: false }));
  await sleep(400);
  check("hopping between room codes is throttled", meOf(spy)?.code === hopA, meOf(spy)?.code);

  /* ---------- round ---------- */
  for (const c of [alice, bob, carol, dave]) fire(c.conn.reducers.setReady({ ready: true }));
  await sleep(300);
  fire(alice.conn.reducers.startRound({ force: false }));
  await until(() => roomOf(bob)?.phase === "countdown");
  check("ready room counts down", roomOf(bob)?.phase === "countdown", roomOf(bob)?.phase);
  check("rival team got every seat", (meOf(dave)?.roles.length ?? 0) === 3, meOf(dave)?.roles.join());

  // A player forging the scheduler's call must not skip the countdown.
  const httpBase = URI.replace(/^ws(s?):/, "http$1:");
  const forged = await fetch(`${httpBase}/v1/database/${DB}/call/on_round_timer`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bob.token}`, "Content-Type": "application/json" },
    body: JSON.stringify([{ scheduled_id: 1, scheduled_at: { Time: 0 }, code: CODE, round: roomOf(bob)!.round, kind: "start" }]),
  }).catch(() => null);
  await sleep(300);
  check("players cannot fire the round timer", roomOf(bob)?.phase === "countdown", `HTTP ${forged?.status}`);

  await until(() => roomOf(carol)?.phase === "playing", 6_000);
  check("server flips to playing after 4.2s", roomOf(carol)?.phase === "playing", roomOf(carol)?.phase);
  const round = roomOf(alice)!.round;

  fire(bob.conn.reducers.sendInput({ roles: meOf(bob)!.roles, inputs: meOf(bob)!.roles.map(() => ({ ...neutral, f: 1 })) }));
  await until(() => [...alice.conn.db.visibleInput.iter()].some((row) => row.identity.toHexString() === bob.hex));
  const relayed = [...alice.conn.db.visibleInput.iter()].find((row) => row.identity.toHexString() === bob.hex);
  check("teammate input reaches the simulating teammate", relayed?.inputs[0]?.f === 1);
  fire(bob.conn.reducers.sendInput({ roles: ["rleg"], inputs: [neutral] }));
  await sleep(200);
  const stolen = [...alice.conn.db.visibleInput.iter()].find((row) => row.identity.toHexString() === bob.hex);
  check("inputs for unowned seats are rejected", stolen == null || stolen.roles.join() === meOf(bob)!.roles.join());
  fire(bob.conn.reducers.sendInput({ roles: meOf(bob)!.roles, inputs: meOf(bob)!.roles.map(() => ({ ...neutral, f: Number.NaN })) }));
  await sleep(200);
  const nan = [...alice.conn.db.visibleInput.iter()].find((row) => row.identity.toHexString() === bob.hex);
  check("NaN inputs are rejected", nan == null || Number.isFinite(nan.inputs[0]?.f));

  const before = dave.snapshots;
  fire(alice.conn.reducers.publishSnapshot(snapshotArgs(round)));
  fire(bob.conn.reducers.publishSnapshot(snapshotArgs(round)));
  await until(() => dave.snapshots > before);
  check("simulator snapshot reaches the rival team", dave.snapshots > before);
  const snaps = [...dave.conn.db.visibleSnapshot.iter()];
  check("snapshots from non-simulating players are rejected", snaps.length === 1 && snaps[0].teamId === teamOf(alice)?.id, snaps.length);
  fire(alice.conn.reducers.publishSnapshot({ ...snapshotArgs(round), p: new Array(77).fill(9_999) }));
  await sleep(200);
  const wild = [...dave.conn.db.visibleSnapshot.iter()].find((s) => s.teamId === teamOf(alice)?.id);
  check("out-of-world snapshots are rejected", wild != null && wild.p[0] < 1);

  /* ---------- reconnect ---------- */
  const bobToken = bob.token;
  bob.conn.disconnect();
  await sleep(500);
  check("dropped player keeps their seat", playersOf(alice).some((p) => p.identity.toHexString() === bob.hex));
  bob = await connect("Bob", await mintToken(bobToken));
  fire(bob.conn.reducers.joinRoom({ code: CODE, name: "Bob", solo: false }));
  await until(() => meOf(bob) != null);
  check("reconnect restores the same player mid-round", meOf(bob)?.teamId === teamOf(alice)?.id);

  /* ---------- finish ---------- */
  fire(bob.conn.reducers.finishRun({ round }));
  await sleep(300);
  check("only the simulating teammate can finish", teamOf(alice)?.finishMs == null);
  const startedAt = Number(roomOf(alice)!.startAtMicros / 1000n);
  const boardBefore = boardOf(alice).length;
  const sentAt = Date.now();
  fire(alice.conn.reducers.finishRun({ round }));
  await until(() => teamOf(carol)?.finishMs != null);
  const finishMs = teamOf(carol)?.finishMs;
  const expected = sentAt - startedAt;
  check("server times the finish from its own start", finishMs != null && Math.abs(Number(finishMs) - expected) < 1_500, `${finishMs} vs ~${expected}`);
  check("an impossibly fast finish is not ranked", boardOf(alice).length === boardBefore, `${boardOf(alice).length} rows`);
  check("rival still racing keeps the round open", roomOf(alice)?.phase === "playing");
  fire(dave.conn.reducers.publishSnapshot(snapshotArgs(round)));
  await sleep(100);
  fire(dave.conn.reducers.finishRun({ round }));
  await until(() => roomOf(bob)?.phase === "results");
  check("last finish ends the round", roomOf(bob)?.phase === "results", roomOf(bob)?.phase);
  fire(alice.conn.reducers.backToLobby({}));
  await until(() => roomOf(carol)?.phase === "lobby");
  check("starter returns everyone to the lobby", roomOf(carol)?.phase === "lobby" && teamOf(carol)?.finishMs == null);

  /* ---------- creator leaves ---------- */
  fire(alice.conn.reducers.leaveRoom({}));
  await until(() => roomOf(bob)?.leaderId?.toHexString() === bob.hex);
  check("the room survives its creator leaving", roomOf(bob) != null && playersOf(bob).length === 3);
  check("the next player takes over starting races", roomOf(bob)?.leaderId?.toHexString() === bob.hex);
  check("the body is re-assigned to a connected teammate", teamOf(bob)?.hostId != null && teamOf(bob)?.hostId?.toHexString() !== alice.hex);

  /* ---------- free-for-all ---------- */
  const FFA = roomCode();
  const erin = await connect("Erin");
  const finn = await connect("Finn");
  fire(erin.conn.reducers.joinRoom({ code: FFA, name: "Erin", solo: true }));
  await until(() => roomOf(erin) != null);
  fire(finn.conn.reducers.joinRoom({ code: FFA, name: "Finn", solo: false }));
  await until(() => meOf(finn) != null);
  check("free-for-all room is flagged", roomOf(erin)?.ffa === true);
  check("plain invite link into free-for-all races solo", meOf(finn)?.solo === true);
  check("racers own their own team", teamOf(erin)?.name === "Erin" && teamOf(finn)?.name === "Finn", `${teamOf(erin)?.name}/${teamOf(finn)?.name}`);

  /* ---------- mode switch ---------- */
  fire(finn.conn.reducers.setMode({ ffa: false }));
  await sleep(400);
  check("only the starter switches mode", roomOf(erin)?.ffa === true);
  fire(erin.conn.reducers.setMode({ ffa: false }));
  await until(() => roomOf(finn)?.ffa === false);
  check("starter switches to team versus", roomOf(finn)?.ffa === false && roomOf(finn)?.squadSize === 5);
  check(
    "versus packs racers into one squad",
    teamOf(erin)?.id === teamOf(finn)?.id && teamOf(erin)?.name === "Team 1" && teamsOf(erin).length === 1,
    `${teamOf(erin)?.name}/${teamOf(finn)?.name} (${teamsOf(erin).length} teams)`,
  );
  check(
    "versus gives each player one joint",
    meOf(erin)?.solo === false && meOf(finn)?.solo === false && meOf(erin)?.roles.length === 1 &&
      meOf(finn)?.roles.length === 1 && meOf(erin)?.roles[0] !== meOf(finn)?.roles[0],
  );
  fire(erin.conn.reducers.setMode({ ffa: true }));
  await until(() => roomOf(finn)?.ffa === true && meOf(finn)?.solo === true);
  check(
    "switching back gives every racer their own body",
    roomOf(finn)?.ffa === true && meOf(finn)?.solo === true && meOf(finn)?.roles.length === 3 &&
      teamOf(erin)?.id !== teamOf(finn)?.id && teamOf(erin)?.name === "Erin" && teamOf(finn)?.name === "Finn",
    `${teamOf(erin)?.name}/${teamOf(finn)?.name}`,
  );

  /* ---------- teardown ---------- */
  for (const c of [bob, carol, dave, spy, erin, finn]) fire(c.conn.reducers.leaveRoom({}));
  await sleep(500);
  const late = await connect("Late");
  fire(late.conn.reducers.joinRoom({ code: CODE, name: "Late", solo: false }));
  await until(() => roomOf(late) != null);
  check("empty rooms are deleted", roomOf(late)?.round === 0 && playersOf(late).length === 1, roomOf(late)?.round);
  fire(late.conn.reducers.leaveRoom({}));
  await sleep(200);
  for (const c of [alice, bob, carol, dave, spy, erin, finn, late]) c.conn.disconnect();
  stopIssuer();
  finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
