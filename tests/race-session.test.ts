import assert from "node:assert/strict";
import test from "node:test";
import {
  CHALLENGE,
  DT,
  RULESET,
  challengeFor,
  createBody,
  encodeSnapshot,
  neutralInput,
  practiceInputs,
  rolesFor,
  step,
  type Body,
  type Input,
} from "../shared/physics.ts";
import {
  createRaceSession,
  type RankedPhase,
  type RankedProjection,
} from "../src/race-session.ts";

function projection(options: {
  phase?: RankedPhase;
  startAtMs?: number;
  body?: Body;
  finishMs?: number;
  challenge?: number;
  crewSize?: 3 | 5;
  assignedRole?: number;
  connected?: boolean;
  completeCrew?: boolean;
  extraTeams?: RankedProjection["teams"];
} = {}): RankedProjection {
  const challenge = options.challenge ?? CHALLENGE.Easy;
  const crewSize = options.crewSize ?? 3;
  const body = options.body ?? createBody(challenge, crewSize);
  const members = options.completeCrew === false
    ? [{ name: "Solo", team: 0, role: 0, online: true }]
    : rolesFor(crewSize).map((_, role) => ({ name: `Pilot ${role + 1}`, team: 0, role, online: true }));
  return {
    connected: options.connected ?? true,
    room: {
      code: "ORBIT",
      phase: options.phase ?? "lobby",
      startAtMs: options.startAtMs ?? 10_000,
      ruleset: RULESET,
      challenge,
      crewSize,
      isHost: true,
    },
    assignment: { team: 0, role: options.assignedRole ?? 1, online: true },
    members,
    teams: [
      { number: 0, finishMs: options.finishMs ?? 0, snapshot: encodeSnapshot(body) },
      ...(options.extraTeams ?? []),
    ],
  };
}

test("session configuration clamps roles and locks atomically during a run", () => {
  const session = createRaceSession();
  assert.equal(session.view(0).roleSelection, 4);
  assert.deepEqual(session.dispatch({ type: "configure", challenge: CHALLENGE.Medium, crewSize: 3 }), []);
  assert.equal(session.view(0).roleSelection, 2);
  assert.deepEqual(session.dispatch({ type: "select-role", role: 0 }), []);
  assert.equal(session.view(0).roleSelection, 0);
  assert.equal(session.dispatch({ type: "start-practice" }).at(-1)?.type, "play-started");
  assert.equal(session.view(0).configLocked, true);
  assert.equal(session.dispatch({ type: "configure", challenge: CHALLENGE.Easy, crewSize: 5 })[0].type, "command-rejected");
  assert.equal(session.dispatch({ type: "select-role", role: 1 })[0].type, "command-rejected");
  session.dispatch({ type: "leave" });
  assert.equal(session.view(0).mode, "idle");
  assert.equal(session.view(0).configLocked, false);
});

test("practice advances at a fixed 30 Hz independent of render cadence", () => {
  const run = (frames: number) => {
    const session = createRaceSession();
    session.dispatch({ type: "start-practice" });
    for (let index = 0; index < frames; index++) session.advance(1 / frames, neutralInput(), true);
    return session.view(1000).body;
  };
  const at60 = run(60);
  const at144 = run(144);
  assert.equal(at60.ticks, 30);
  assert.deepEqual(at144, at60);

  const paused = createRaceSession();
  paused.dispatch({ type: "start-practice" });
  paused.advance(DT * 0.9, neutralInput(), true);
  paused.advance(10, neutralInput(), false);
  paused.advance(DT * 0.2, neutralInput(), true);
  assert.equal(paused.view(0).body.ticks, 0);
});

test("practice controls exactly the selected role", () => {
  const input: Input = { x: 1, z: 1, action: true };
  const session = createRaceSession();
  session.dispatch({ type: "configure", challenge: CHALLENGE.Easy, crewSize: 3 });
  session.dispatch({ type: "select-role", role: 0 });
  session.dispatch({ type: "start-practice" });
  session.advance(DT, input, true);

  const expected = createBody(CHALLENGE.Easy, 3);
  step(expected, practiceInputs(expected, 0, input));
  assert.deepEqual(session.view(0).body, expected);
});

test("explicit snapshots are JSON-safe and restore a session without shared references", () => {
  const original = createRaceSession();
  original.dispatch({ type: "start-practice" });
  original.advance(DT, neutralInput(), true);
  const serialized = JSON.stringify(original.snapshot());
  const restored = createRaceSession(JSON.parse(serialized));
  assert.deepEqual(restored.view(0).body, original.view(0).body);
  assert.notEqual(restored.view(0).body, original.view(0).body);
});

test("ranked lobby drafts stay separate from the authoritative assignment", () => {
  const session = createRaceSession();
  session.synchronize(projection({ phase: "lobby", assignedRole: 1 }), "adopt");
  assert.equal(session.view(0).configLocked, true);
  assert.equal(session.view(0).roleLocked, false);
  session.dispatch({ type: "select-role", role: 2 });
  assert.equal(session.view(0).roleSelection, 2);
  assert.equal(session.view(0).room?.assignedRole, 1);
  assert.equal(session.view(0).controlledRole, 2);

  session.synchronize(projection({ phase: "countdown", assignedRole: 1 }), "update");
  assert.equal(session.view(9_000).controlledRole, 1);
  assert.equal(session.view(9_000).roleSelection, 1);
  assert.equal(session.view(9_000).roleLocked, true);
  assert.equal(session.dispatch({ type: "select-role", role: 0 })[0].type, "command-rejected");
});

test("ranked clocks, readiness, and input eligibility are derived from one view", () => {
  const session = createRaceSession();
  session.synchronize(projection({ phase: "countdown", startAtMs: 10_500 }), "adopt");
  let view = session.view(9_000);
  assert.equal(view.countdownSeconds, 2);
  assert.equal(view.elapsedMs, 0);
  assert.equal(view.canStart, false);

  const racingBody = createBody(CHALLENGE.Easy, 3);
  racingBody.penaltyMs = 3_000;
  session.synchronize(projection({ phase: "racing", startAtMs: 10_500, body: racingBody }), "update");
  view = session.view(12_000);
  assert.equal(view.elapsedMs, 4_500);
  assert.equal(view.canSendInput, true);

  session.synchronize(projection({ phase: "finished", startAtMs: 10_500, body: racingBody, finishMs: 4_321 }), "update");
  assert.equal(session.view(50_000).elapsedMs, 4_321);

  racingBody.ticks = 90;
  session.synchronize(projection({ phase: "finished", startAtMs: 10_500, body: racingBody, finishMs: 0 }), "update");
  assert.equal(session.view(60_000).elapsedMs, 6_000);
  assert.equal(session.view(120_000).elapsedMs, 6_000);

  const lobby = createRaceSession();
  lobby.synchronize(projection({ phase: "lobby" }), "adopt");
  assert.equal(lobby.view(0).canStart, true);
  const incomplete = createRaceSession();
  incomplete.synchronize(projection({ phase: "lobby", completeCrew: false }), "adopt");
  assert.equal(incomplete.view(0).canStart, false);
});

test("invalid remote snapshots are isolated and stale updates cannot resurrect a leave", () => {
  const session = createRaceSession();
  const valid = createBody(CHALLENGE.Easy, 3);
  valid.ticks = 12;
  session.synchronize(projection({ phase: "racing", body: valid }), "adopt");
  const bad = projection({ phase: "racing", body: valid });
  const rejected = session.synchronize({
    ...bad,
    teams: [
      { number: 0, finishMs: 0, snapshot: "broken" },
      { number: 1, finishMs: 0, snapshot: encodeSnapshot(createBody(CHALLENGE.Easy, 3)) },
    ],
  }, "update");
  assert.ok(rejected.some(signal => signal.type === "snapshot-rejected" && signal.team === 0));
  assert.equal(session.view(0).body.ticks, 12);
  assert.equal(session.view(0).teams.length, 2);

  const leaveSignals = session.dispatch({ type: "leave" });
  assert.equal(leaveSignals[0].type, "leave-ranked");
  session.synchronize(projection({ phase: "racing", body: valid }), "update");
  assert.equal(session.view(0).mode, "idle");
});

test("ranked gameplay signals are baselined per match and fire once", () => {
  const session = createRaceSession();
  const initial = createBody(CHALLENGE.Easy, 3);
  const first = session.synchronize(projection({ phase: "racing", body: initial, startAtMs: 10_000 }), "adopt");
  assert.deepEqual(first.map(signal => signal.type), ["play-started"]);

  const progressed = createBody(CHALLENGE.Easy, 3);
  progressed.stage = 1;
  progressed.falls = 1;
  progressed.mistakes = 1;
  progressed.penaltyMs = 3_000;
  const progressSignals = session.synchronize(projection({ phase: "racing", body: progressed, startAtMs: 10_000 }), "update");
  assert.deepEqual(progressSignals.map(signal => signal.type), ["stage-cleared", "fell", "timing-missed"]);
  assert.deepEqual(session.synchronize(projection({ phase: "racing", body: progressed, startAtMs: 10_000 }), "update"), []);

  const finished = createBody(CHALLENGE.Easy, 3);
  finished.stage = challengeFor(CHALLENGE.Easy).stages.length;
  finished.finished = true;
  const complete = session.synchronize(projection({ phase: "finished", body: finished, finishMs: 12_345, startAtMs: 10_000 }), "update");
  assert.deepEqual(complete.map(signal => signal.type), ["stage-cleared", "completed"]);
  assert.deepEqual(session.synchronize(projection({ phase: "finished", body: finished, finishMs: 12_345, startAtMs: 10_000 }), "update"), []);

  const rematch = session.synchronize(projection({ phase: "countdown", body: createBody(CHALLENGE.Easy, 3), startAtMs: 50_000 }), "update");
  assert.deepEqual(rematch.map(signal => signal.type), ["play-started"]);
});

test("an unfinished ranked ending is reported once without masking a later verified finish", () => {
  const session = createRaceSession();
  session.synchronize(projection({ phase: "racing" }), "adopt");
  const ended = session.synchronize(projection({ phase: "finished" }), "update");
  assert.deepEqual(ended.map(signal => signal.type), ["ranked-ended-without-finish"]);
  assert.deepEqual(session.synchronize(projection({ phase: "finished" }), "update"), []);

  const finished = createBody(CHALLENGE.Easy, 3);
  finished.stage = challengeFor(CHALLENGE.Easy).stages.length;
  finished.finished = true;
  const upgraded = session.synchronize(projection({ phase: "finished", body: finished, finishMs: 9_999 }), "update");
  assert.ok(upgraded.some(signal => signal.type === "completed"));
});
