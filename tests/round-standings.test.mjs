import assert from "node:assert/strict";
import test from "node:test";
import { mergeLiveProgress, progressFromSnapshot, roundStandings } from "../src/game/round-standings.ts";
import { getLevel } from "../src/game/levels.ts";

const team = (id, finishMs = null) => ({
  id,
  name: `Team ${id}`,
  color: "#fff",
  hostId: null,
  finishMs,
});

const snapshot = (z, score = 0, fallen = 0, timer = 12.345) => ({
  p: [0, 1, z],
  score,
  fallen,
  timer,
});

test("course progress follows the published pelvis pose", () => {
  const level = getLevel("wobble-run");
  assert.equal(progressFromSnapshot(level, snapshot(level.spawn[2])).progress, 0);
  assert.ok(progressFromSnapshot(level, snapshot(-30)).progress > 0.45);
  assert.equal(progressFromSnapshot(level, snapshot(level.finish.pos[2])).progress, 0.995);
});

test("score challenge progress follows the team score", () => {
  const level = getLevel("slam-dunk");
  assert.equal(progressFromSnapshot(level, snapshot(0, 1)).progress, 1 / 3);
  assert.equal(progressFromSnapshot(level, snapshot(0, 3)).progress, 0.995);
});

test("live progress never rolls back after a fall or checkpoint reset", () => {
  const previous = { progress: 0.7, score: 1, fallen: false, timerMs: 8_000 };
  const next = { progress: 0.3, score: 0, fallen: true, timerMs: 9_000 };
  assert.deepEqual(mergeLiveProgress(previous, next), {
    progress: 0.7,
    score: 1,
    fallen: true,
    timerMs: 9_000,
  });
});

test("standings rank finishers by time then racers by progress", () => {
  const standings = roundStandings(
    [team(1), team(2, 15_000), team(3), team(4, 12_000)],
    {
      1: { progress: 0.8, score: 0, fallen: false, timerMs: 10_000 },
      3: { progress: 0.4, score: 0, fallen: true, timerMs: 10_000 },
    }
  );
  assert.deepEqual(standings.map((row) => row.team.id), [4, 2, 1, 3]);
  assert.deepEqual(standings.map((row) => row.place), [1, 2, 3, 4]);
});

test("standing ties are deterministic by team id", () => {
  const standings = roundStandings([team(9), team(3), team(6)], {});
  assert.deepEqual(standings.map((row) => row.team.id), [3, 6, 9]);
});
