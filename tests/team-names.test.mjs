import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_TEAM_NAME_LENGTH,
  dedupeTeamName,
  nextSquadName,
  pickTeamName,
} from "../server/src/team-names.ts";

test("versus squads are numbered Team 1, 2, 3… from an empty room", () => {
  assert.equal(nextSquadName([]), "Team 1");
  assert.equal(nextSquadName(["Team 1"]), "Team 2");
  assert.equal(nextSquadName(["Team 1", "Team 2"]), "Team 3");
});

test("versus numbering fills gaps left by deleted teams", () => {
  assert.equal(nextSquadName(["Team 1", "Team 3"]), "Team 2");
  assert.equal(nextSquadName(["Team 2"]), "Team 1");
});

test("versus numbering ignores racer-named teams and casing", () => {
  assert.equal(nextSquadName(["ava", "Ben 2", "team 1"]), "Team 2");
  assert.equal(nextSquadName(["TEAM 1", "Team 10"]), "Team 2");
});

test("free-for-all teams take the racer name untouched when free", () => {
  assert.equal(dedupeTeamName([], "Ava"), "Ava");
  assert.equal(dedupeTeamName(["Team 1"], "Ben"), "Ben");
});

test("duplicate racer names get a 2 / 3 … suffix", () => {
  assert.equal(dedupeTeamName(["Ava"], "Ava"), "Ava 2");
  assert.equal(dedupeTeamName(["Ava", "Ava 2"], "Ava"), "Ava 3");
  assert.equal(dedupeTeamName(["ava"], "AVA"), "AVA 2");
});

test("racer names are cleaned and capped before suffixing", () => {
  assert.equal(dedupeTeamName([], "  Ava   Racer  "), "Ava Racer");
  assert.equal(dedupeTeamName([], ""), "Racer");
  assert.equal(dedupeTeamName([], "   "), "Racer");
  const long = "A".repeat(MAX_TEAM_NAME_LENGTH + 10);
  const capped = dedupeTeamName([], long);
  assert.equal(capped.length, MAX_TEAM_NAME_LENGTH);
  const suffixed = dedupeTeamName([capped], long);
  assert.ok(suffixed.length <= MAX_TEAM_NAME_LENGTH);
  assert.ok(suffixed.endsWith(" 2"));
});

test("picker prefers the racer name, falls back to squad numbers", () => {
  assert.equal(pickTeamName(["Team 1"], "Ava"), "Ava");
  assert.equal(pickTeamName(["Ava"], "Ava"), "Ava 2");
  assert.equal(pickTeamName(["Team 1"]), "Team 2");
  assert.equal(pickTeamName(["Team 1"], "  "), "Team 2");
  assert.equal(pickTeamName([], undefined), "Team 1");
});
