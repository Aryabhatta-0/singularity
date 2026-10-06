import assert from "node:assert/strict";
import test from "node:test";
import {
  coerceSquadSize,
  compareScoreRows,
  isKnownChallenge,
  isTeamNameTaken,
  isValidTeamName,
  normalizePlayerName,
  normalizeTeamName,
  pickSquadName,
  topScoreRows,
} from "../src/game/scores.ts";

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
