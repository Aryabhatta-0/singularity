import assert from "node:assert/strict";
import test from "node:test";
import {
  buildScoreSubmit,
  coerceSquadSize,
  compareScoreRows,
  createMemoryScoreBoard,
  isKnownChallenge,
  isTeamNameTaken,
  isValidTeamName,
  normalizePlayerName,
  normalizeTeamName,
  pickSquadName,
  topScoreRows,
} from "../src/game/score-submit.ts";

const row = (overrides = {}) => ({
  id: "1",
  challengeId: "wobble-run",
  squadSize: 3,
  teamName: "Team 1",
  players: ["Al"],
  timeMs: 60_000,
  ...overrides,
});

test("naming normalizes, validates, and picks without gaps", () => {
  assert.equal(normalizeTeamName("  Team   1  "), "Team 1");
  assert.equal(isValidTeamName("A"), false);
  assert.equal(isValidTeamName("Al"), true);
  assert.equal(normalizePlayerName("  Absolutely Enormous Player Name  "), "Absolutely Enorm");
  assert.equal(pickSquadName(["Team 1", "Team 2"]), "Team 3");
  assert.equal(pickSquadName(["Team 1"], "  Strikers "), "Strikers");
  assert.equal(pickSquadName(["Team 1", "Strikers"], "strikers"), "Team 2", "preferred falls back to numbered");
  assert.equal(
    isTeamNameTaken([{ id: 1, name: "Strikers" }, { id: 2, name: "Rivals" }], 2, "strikers"),
    true,
  );
  assert.equal(
    isTeamNameTaken([{ id: 1, name: "Strikers" }, { id: 2, name: "Rivals" }], 1, "Strikers"),
    false,
    "own name is not taken",
  );
});

test("challenge IDs come from the Challenge list", () => {
  assert.equal(isKnownChallenge("wobble-run"), true);
  assert.equal(isKnownChallenge("slam-dunk"), true);
  assert.equal(isKnownChallenge("nope"), false);
});

test("board ordering matches server semantics: time, then earlier id", () => {
  const rows = [row({ id: "10", timeMs: 60_000 }), row({ id: "2", timeMs: 60_000 }), row({ id: "1", timeMs: 59_000 })];
  assert.deepEqual(rows.sort(compareScoreRows).map((r) => r.id), ["1", "2", "10"]);
  const board = topScoreRows(
    [row({ id: "1", challengeId: "ferry-job", squadSize: 5 }), row({ id: "2" })],
    "wobble-run",
    3,
    5,
  );
  assert.deepEqual(board.map((r) => r.id), ["2"], "one board selected before limiting");
  assert.equal(coerceSquadSize(3), 3);
  assert.equal(coerceSquadSize(99), 5, "unknown sizes fall to the 5-Joint board");
});

test("submission mirrors server bounds, invalid runs never leave", () => {
  const good = buildScoreSubmit({
    challengeId: "wobble-run",
    squadSize: 3,
    teamName: "  Strikers ",
    players: ["Al"],
    timeMs: 60_123.6,
  });
  assert.deepEqual(good, {
    challengeId: "wobble-run",
    squadSize: 3,
    teamName: "Strikers",
    players: ["Al"],
    timeMs: 60_124,
  });
  const bad = [
    { challengeId: "nope", squadSize: 3, teamName: "Strikers", players: ["Al"], timeMs: 60_000 },
    { challengeId: "wobble-run", squadSize: 4, teamName: "Strikers", players: ["Al"], timeMs: 60_000 },
    { challengeId: "wobble-run", squadSize: 3, teamName: "X", players: ["Al"], timeMs: 60_000 },
    { challengeId: "wobble-run", squadSize: 3, teamName: "Strikers", players: [], timeMs: 60_000 },
    { challengeId: "wobble-run", squadSize: 3, teamName: "Strikers", players: ["Al"], timeMs: 500 },
    { challengeId: "wobble-run", squadSize: 3, teamName: "Strikers", players: ["Al"], timeMs: Number.NaN },
  ];
  for (const input of bad) assert.equal(buildScoreSubmit(input), null, JSON.stringify(input));
});

test("memory board caps like the durable table and evicts the slowest", () => {
  const board = createMemoryScoreBoard();
  for (let i = 1; i <= 11; i++) {
    board.submit(row({ id: String(i), timeMs: i * 1_000 }));
  }
  const top = board.topRows("wobble-run", 3);
  assert.equal(top.length, 10);
  assert.equal(top[0].id, "1", "fastest survives");
  assert.ok(!top.some((r) => r.id === "11"), "slowest evicted");
  const slow = board.submit(row({ id: "99", timeMs: 999_000 }));
  assert.equal(slow.kept, false, "slower than a full board is dropped");
  assert.deepEqual(slow.overflow, ["99"], "the dropped run is its own overflow");
  const fast = board.submit(row({ id: "100", timeMs: 500 }));
  assert.equal(fast.kept, true);
  assert.deepEqual(fast.overflow, ["10"], "eviction mirrors the server choice");
});
