import assert from "node:assert/strict";
import test from "node:test";
import {
  COUNTDOWN_MICROS,
  DISCONNECT_GRACE_MICROS,
  RACE_TIMEOUT_MICROS,
  assignmentConflict,
  connectedTeamNumbers,
  phasePolicy,
  planMatchStart,
  planMatchTick,
  raceEndReason,
} from "../shared/match-lifecycle.ts";

const assignment = (overrides: Partial<Parameters<typeof assignmentConflict>[0]["request"]> = {}) => ({
  room: "CREW",
  team: 0,
  role: 1,
  ruleset: 3,
  challenge: 0,
  crewSize: 3,
  ...overrides,
});

const crew = (team: number, online = true, size = 3, disconnectedAtMicros = 0n) =>
  Array.from({ length: size }, (_, role) => ({
    id: `${team}:${role}`,
    team,
    role,
    online,
    disconnectedAtMicros,
  }));

const teams = (...values: Array<[number, boolean]>) =>
  values.map(([number, finished]) => ({ number, finished }));

test("the phase matrix fails closed and retains active identity leases", () => {
  assert.deepEqual(phasePolicy("lobby"), {
    phase: "lobby", assignmentLocked: false, reserveAssignmentOnRelease: false, acceptsInput: false, canStart: true,
  });
  assert.deepEqual(phasePolicy("countdown"), {
    phase: "countdown", assignmentLocked: true, reserveAssignmentOnRelease: true, acceptsInput: false, canStart: false,
  });
  assert.deepEqual(phasePolicy("racing"), {
    phase: "racing", assignmentLocked: true, reserveAssignmentOnRelease: true, acceptsInput: true, canStart: false,
  });
  assert.deepEqual(phasePolicy("finished"), {
    phase: "finished", assignmentLocked: false, reserveAssignmentOnRelease: false, acceptsInput: false, canStart: true,
  });
  assert.deepEqual(phasePolicy("unknown"), {
    phase: null, assignmentLocked: true, reserveAssignmentOnRelease: true, acceptsInput: false, canStart: false,
  });

  for (const phase of ["countdown", "racing"]) {
    assert.equal(assignmentConflict({
      current: assignment(), currentRoomPhase: phase, request: assignment({ role: 2 }),
    }), "current-match-locked");
    assert.equal(assignmentConflict({ request: assignment(), targetRoomPhase: phase }), "target-match-locked");
    assert.equal(assignmentConflict({
      current: assignment(), currentRoomPhase: phase, request: assignment(), targetRoomPhase: phase,
    }), null);
  }
  assert.equal(assignmentConflict({ current: assignment(), request: assignment({ room: "NEW" }) }), null);
  assert.equal(assignmentConflict({ request: assignment() }), null);
});

test("start plans require at least one complete connected crew", () => {
  assert.deepEqual(planMatchStart({ phase: "racing", crewSize: 3, nowMicros: 10n, members: crew(0) }), {
    ok: false, reason: "invalid-phase",
  });
  assert.deepEqual(planMatchStart({ phase: "lobby", crewSize: 4, nowMicros: 10n, members: crew(0) }), {
    ok: false, reason: "invalid-crew-size",
  });
  assert.deepEqual(planMatchStart({ phase: "lobby", crewSize: 3, nowMicros: 10n, members: crew(0, false) }), {
    ok: false, reason: "no-active-team",
  });
  assert.deepEqual(planMatchStart({ phase: "lobby", crewSize: 3, nowMicros: 10n, members: crew(0).slice(0, 2) }), {
    ok: false, reason: "incomplete-team", team: 0, missingRoles: [2],
  });
});

test("start plans retain complete online teams and schedule one canonical countdown", () => {
  const members = [...crew(2), ...crew(0), ...crew(1, false)];
  assert.deepEqual(connectedTeamNumbers(members), [0, 2]);
  assert.deepEqual(planMatchStart({ phase: "finished", crewSize: 3, nowMicros: 40n, members }), {
    ok: true, activeTeams: [0, 2], startAtMicros: 40n + COUNTDOWN_MICROS,
  });
});

test("tick planning advances countdown and elects hosts deterministically", () => {
  const members = [
    { ...crew(0)[0], id: "ff", online: false },
    { ...crew(0)[1], id: "bb" },
    { ...crew(0)[2], id: "aa" },
  ];
  const before = planMatchTick({
    phase: "countdown", nowMicros: 99n, startAtMicros: 100n, hostId: "ff", members, teams: teams([0, false]),
  });
  assert.equal(before.phase, "countdown");
  assert.equal(before.nextHostId, "aa");
  assert.deepEqual(before.simulateTeamNumbers, []);

  const started = planMatchTick({
    phase: "countdown", nowMicros: 100n, startAtMicros: 100n, hostId: "aa", members, teams: teams([0, false]),
  });
  assert.equal(started.phase, "racing");
  assert.equal(started.nextHostId, "aa");
  assert.deepEqual(started.simulateTeamNumbers, [0]);
});

test("active rooms survive brief whole-crew disconnects and expire at the grace boundary", () => {
  const recent = crew(0, false, 3, 1n);
  const reconnectable = planMatchTick({
    phase: "racing",
    nowMicros: DISCONNECT_GRACE_MICROS,
    startAtMicros: 0n,
    hostId: "0:0",
    members: recent,
    teams: teams([0, false]),
  });
  assert.equal(reconnectable.deleteRoom, false);
  assert.deepEqual(reconnectable.abandonedTeamNumbers, []);
  assert.deepEqual(reconnectable.contendingTeamNumbers, [0]);

  const expired = planMatchTick({
    phase: "racing",
    nowMicros: DISCONNECT_GRACE_MICROS + 1n,
    startAtMicros: 0n,
    hostId: "0:0",
    members: recent,
    teams: teams([0, false]),
  });
  assert.equal(expired.deleteRoom, true);
  assert.deepEqual(expired.abandonedTeamNumbers, [0]);
  assert.deepEqual(expired.purgeMemberIds, ["0:0", "0:1", "0:2"]);
});

test("an abandoned unfinished team stops blocking connected finishers", () => {
  const nowMicros = DISCONNECT_GRACE_MICROS + 10n;
  const plan = planMatchTick({
    phase: "racing",
    nowMicros,
    startAtMicros: 0n,
    hostId: "0:0",
    members: [...crew(0), ...crew(1, false)],
    teams: teams([0, true], [1, false]),
  });
  assert.deepEqual(plan.abandonedTeamNumbers, [1]);
  assert.deepEqual(plan.contendingTeamNumbers, [0]);
  assert.equal(raceEndReason({
    nowMicros,
    startAtMicros: 0n,
    contendingTeamNumbers: plan.contendingTeamNumbers,
    teams: teams([0, true]),
  }), "completed");

  const partial = planMatchTick({
    phase: "racing",
    nowMicros,
    startAtMicros: 0n,
    hostId: "0:0",
    members: [...crew(0), ...crew(1, false), { ...crew(1)[0], id: "1:online" }],
    teams: teams([0, true], [1, false]),
  });
  assert.deepEqual(partial.abandonedTeamNumbers, []);
  assert.equal(raceEndReason({
    nowMicros,
    startAtMicros: 0n,
    contendingTeamNumbers: partial.contendingTeamNumbers,
    teams: teams([0, true], [1, false]),
  }), null);
});

test("unknown phases, missing team state, and timeout fail safely", () => {
  const invalid = planMatchTick({
    phase: "wat", nowMicros: 0n, startAtMicros: 0n, hostId: "0:0", members: crew(0), teams: teams([0, false]),
  });
  assert.equal(invalid.phase, "finished");
  assert.equal(invalid.finishReason, "invalid-phase");

  const corrupt = planMatchTick({
    phase: "racing", nowMicros: 0n, startAtMicros: 0n, hostId: "0:0", members: crew(0), teams: [],
  });
  assert.equal(corrupt.phase, "finished");
  assert.equal(corrupt.finishReason, "corrupt-state");
  assert.equal(raceEndReason({
    nowMicros: RACE_TIMEOUT_MICROS - 1n,
    startAtMicros: 0n,
    contendingTeamNumbers: [0],
    teams: teams([0, false]),
  }), null);
  assert.equal(raceEndReason({
    nowMicros: RACE_TIMEOUT_MICROS,
    startAtMicros: 0n,
    contendingTeamNumbers: [0],
    teams: teams([0, false]),
  }), "timeout");
});
