/*
 * End-to-end test for the SINGULARITY room server (room-server/).
 * Simulates a host plus friends on one machine: a three-player squad joins,
 * a rival team forms, the round runs (countdown -> playing -> results) with
 * inputs and snapshots relayed, the server times the finish, a dropped player
 * reconnects into their seat, free-for-all invite links race solo, and rooms
 * stay invisible to outsiders.
 *
 * Usage (needs `spacetime start` and the room module published):
 *   npm run e2e:room
 */
import { DbConnection } from "../src/room_bindings/index.js";

const URI = process.env.NEXT_PUBLIC_ROOM_SERVER_URI || "ws://127.0.0.1:3000";
const DB = process.env.NEXT_PUBLIC_ROOM_DATABASE || "singularity-room";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const roomCode = () => Array.from({ length: 8 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");

let failures = 0;
function check(name: string, cond: boolean, extra: unknown = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra !== "" ? ` — ${String(extra)}` : ""}`);
  if (!cond) failures++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Client {
  name: string;
  conn: DbConnection;
  hex: string;
  token: string;
  snapshots: number;
}

function connect(name: string, token?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`connect timeout: ${name}`)), 15_000);
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB)
      .withToken(token)
      .onConnect((conn, identity, issuedToken) => {
        const client: Client = { name, conn, hex: identity.toHexString(), token: issuedToken, snapshots: 0 };
        conn.db.visibleSnapshot.onInsert(() => client.snapshots++);
        conn.db.visibleSnapshot.onUpdate(() => client.snapshots++);
        conn.subscriptionBuilder()
          .onError(() => {
            clearTimeout(timeout);
            reject(new Error(`subscription failed: ${name}`));
          })
          .onApplied(() => {
            clearTimeout(timeout);
            resolve(client);
          })
          .subscribe([
            "SELECT * FROM visible_room",
            "SELECT * FROM visible_player",
            "SELECT * FROM visible_team",
            "SELECT * FROM visible_snapshot",
            "SELECT * FROM visible_input",
          ]);
      })
      .onConnectError((_ctx: unknown, err: Error) => {
        clearTimeout(timeout);
        reject(err);
      })
      .build();
  });
}

const roomOf = (c: Client) => [...c.conn.db.visibleRoom.iter()][0];
const playersOf = (c: Client) => [...c.conn.db.visiblePlayer.iter()];
const teamsOf = (c: Client) => [...c.conn.db.visibleTeam.iter()];
const meOf = (c: Client) => playersOf(c).find((p) => p.identity.toHexString() === c.hex);
const teamOf = (c: Client) => teamsOf(c).find((t) => t.id === meOf(c)?.teamId);

// 11 body parts x (pos xyz + quat xyzw). 0.5 everywhere is a unit quaternion.
const snapshotArgs = (round: number) => ({
  round, p: new Array(77).fill(0.5), props: [] as number[], yaw: 0, pitch: 0, timer: 1,
  fallen: false, score: 0, ev: "[]", msg: undefined,
});
const neutral = { f: 0, s: 0, a: false, b: false, q: false, e: false, lx: 0, ly: 0 };

async function main() {
  console.log(`Room server E2E against ${URI} / ${DB}`);
  const CODE = roomCode();

  /* ---------- lobby ---------- */
  const alice = await connect("Alice");
  alice.conn.reducers.joinRoom({ code: CODE, name: "Alice", solo: false });
  await sleep(500);
  check("host creates the room and leads it", roomOf(alice)?.leaderId?.toHexString() === alice.hex);
  alice.conn.reducers.setSquad({ size: 3 });
  await sleep(300);
  check("leader switches to a 3-player squad", roomOf(alice)?.squadSize === 3);

  let bob = await connect("Bob");
  const carol = await connect("Carol");
  bob.conn.reducers.joinRoom({ code: CODE, name: "Bob", solo: false });
  carol.conn.reducers.joinRoom({ code: CODE, name: "Carol", solo: false });
  await sleep(600);
  check("friends land on the host's team", teamOf(bob)?.id === teamOf(alice)?.id && teamOf(carol)?.id === teamOf(alice)?.id);
  const roles = playersOf(alice).flatMap((p) => p.roles).sort();
  check("each friend gets a distinct seat", roles.join() === "arms,legs,torso", roles.join());
  check("first joiner simulates the team body", teamOf(alice)?.hostId?.toHexString() === alice.hex);

  bob.conn.reducers.setChallenge({ challengeId: "ferry-job" });
  await sleep(300);
  check("only the leader picks the challenge", roomOf(alice)?.challengeId === "wobble-run");
  alice.conn.reducers.setChallenge({ challengeId: "ferry-job" });
  await sleep(300);
  check("leader picks the challenge", roomOf(bob)?.challengeId === "ferry-job");

  const dave = await connect("Dave");
  dave.conn.reducers.joinRoom({ code: CODE, name: "Dave", solo: false });
  await sleep(500);
  check("a full squad sends the next friend to a rival team", teamOf(dave) != null && teamOf(dave)?.id !== teamOf(alice)?.id);
  check("rival team is numbered", teamOf(dave)?.name === "Team 2", teamOf(dave)?.name);

  const spy = await connect("Spy");
  spy.conn.reducers.joinRoom({ code: roomCode(), name: "Spy", solo: false });
  await sleep(400);
  check("outsiders cannot see this room", !playersOf(spy).some((p) => p.code === CODE));

  /* ---------- round ---------- */
  for (const c of [alice, bob, carol, dave]) c.conn.reducers.setReady({ ready: true });
  await sleep(300);
  alice.conn.reducers.startRound({ force: false });
  await sleep(300);
  check("ready room counts down", roomOf(bob)?.phase === "countdown", roomOf(bob)?.phase);
  check("rival team got every seat", (meOf(dave)?.roles.length ?? 0) === 3, meOf(dave)?.roles.join());
  await sleep(4_300);
  check("server flips to playing after 4.2s", roomOf(carol)?.phase === "playing", roomOf(carol)?.phase);
  const round = roomOf(alice)!.round;

  bob.conn.reducers.sendInput({ roles: meOf(bob)!.roles, inputs: meOf(bob)!.roles.map(() => ({ ...neutral, f: 1 })) });
  await sleep(300);
  const relayed = [...alice.conn.db.visibleInput.iter()].find((row) => row.identity.toHexString() === bob.hex);
  check("teammate input reaches the team host", relayed?.inputs[0]?.f === 1);
  bob.conn.reducers.sendInput({ roles: ["rleg"], inputs: [neutral] });
  await sleep(200);
  const stolen = [...alice.conn.db.visibleInput.iter()].find((row) => row.identity.toHexString() === bob.hex);
  check("inputs for unowned seats are rejected", stolen?.roles.join() === meOf(bob)!.roles.join());

  const before = dave.snapshots;
  alice.conn.reducers.publishSnapshot(snapshotArgs(round));
  bob.conn.reducers.publishSnapshot(snapshotArgs(round));
  await sleep(300);
  check("host snapshot reaches the rival room", dave.snapshots > before);
  const snaps = [...dave.conn.db.visibleSnapshot.iter()];
  check("non-host snapshots are rejected", snaps.length === 1 && snaps[0].teamId === teamOf(alice)?.id, snaps.length);

  /* ---------- reconnect ---------- */
  const bobToken = bob.token;
  bob.conn.disconnect();
  await sleep(500);
  check("dropped player keeps their seat", playersOf(alice).some((p) => p.identity.toHexString() === bob.hex));
  bob = await connect("Bob", bobToken);
  bob.conn.reducers.joinRoom({ code: CODE, name: "Bob", solo: false });
  await sleep(500);
  check("reconnect restores the same player mid-round", meOf(bob)?.teamId === teamOf(alice)?.id);

  /* ---------- finish ---------- */
  bob.conn.reducers.finishRun({ round });
  await sleep(300);
  check("only the team host can finish", teamOf(alice)?.finishMs == null);
  const startedAt = Number(roomOf(alice)!.startAtMicros / 1000n);
  alice.conn.reducers.finishRun({ round });
  await sleep(400);
  const finishMs = teamOf(carol)?.finishMs;
  const expected = Date.now() - 400 - startedAt;
  check("server times the finish from its own start", finishMs != null && Math.abs(Number(finishMs) - expected) < 1_500, `${finishMs} vs ~${expected}`);
  check("rival still racing keeps the round open", roomOf(alice)?.phase === "playing");
  dave.conn.reducers.publishSnapshot(snapshotArgs(round));
  await sleep(100);
  dave.conn.reducers.finishRun({ round });
  await sleep(400);
  check("last finish ends the round", roomOf(bob)?.phase === "results", roomOf(bob)?.phase);
  alice.conn.reducers.backToLobby({});
  await sleep(300);
  check("leader returns everyone to the lobby", roomOf(carol)?.phase === "lobby" && teamOf(carol)?.finishMs == null);

  /* ---------- free-for-all ---------- */
  const FFA = roomCode();
  const erin = await connect("Erin");
  const finn = await connect("Finn");
  erin.conn.reducers.joinRoom({ code: FFA, name: "Erin", solo: true });
  await sleep(400);
  finn.conn.reducers.joinRoom({ code: FFA, name: "Finn", solo: false });
  await sleep(500);
  check("free-for-all room is flagged", roomOf(erin)?.ffa === true);
  check("plain invite link into free-for-all races solo", meOf(finn)?.solo === true);
  check("racers own their own team", teamOf(erin)?.name === "Erin" && teamOf(finn)?.name === "Finn", `${teamOf(erin)?.name}/${teamOf(finn)?.name}`);

  /* ---------- teardown ---------- */
  for (const c of [alice, bob, carol, dave, spy, erin, finn]) c.conn.reducers.leaveRoom({});
  await sleep(500);
  const late = await connect("Late");
  late.conn.reducers.joinRoom({ code: CODE, name: "Late", solo: false });
  await sleep(400);
  check("empty rooms are deleted", roomOf(late)?.round === 0 && playersOf(late).length === 1, roomOf(late)?.round);
  late.conn.reducers.leaveRoom({});
  await sleep(200);
  for (const c of [alice, bob, carol, dave, spy, erin, finn, late]) c.conn.disconnect();

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
