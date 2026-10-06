import assert from "node:assert/strict";
import test from "node:test";

import { crewKey, isRankedRun, MIN_RANKED_RUN_MS } from "../server/src/leaderboard.ts";
import { CHALLENGES } from "../src/game/types.ts";

const run = (overrides = {}) => ({ challengeId: "wobble-run", ffa: false, squadSize: 3, rosterSize: 3, timeMs: 60_000n, ...overrides });

test("every course has a plausibility floor", () => {
  for (const challenge of CHALLENGES) assert.ok(MIN_RANKED_RUN_MS[challenge.id] > 0n, challenge.id);
});

test("full squads and lone free-for-all racers rank; nobody else does", () => {
  assert.equal(isRankedRun(run()), true);
  assert.equal(isRankedRun(run({ squadSize: 5, rosterSize: 5 })), true);
  assert.equal(isRankedRun(run({ rosterSize: 2 })), false, "short-handed squad");
  assert.equal(isRankedRun(run({ squadSize: 5, rosterSize: 6 })), false, "over-full squad");
  assert.equal(isRankedRun(run({ ffa: true, rosterSize: 1 })), true);
  assert.equal(isRankedRun(run({ ffa: true, rosterSize: 2 })), false);
  assert.equal(isRankedRun(run({ squadSize: 4, rosterSize: 4 })), false);
});

test("impossible times and unknown courses never rank", () => {
  assert.equal(isRankedRun(run({ timeMs: 1_000n })), false, "faster than a body can walk the course");
  assert.equal(isRankedRun(run({ timeMs: MIN_RANKED_RUN_MS["wobble-run"] })), true, "the floor itself counts");
  assert.equal(isRankedRun(run({ timeMs: 900_001n })), false, "beyond the round cap");
  assert.equal(isRankedRun(run({ challengeId: "moon-base" })), false);
});

test("a crew is the same team name and people, regardless of case or seat order", () => {
  assert.equal(crewKey("Wobble Crew", ["Ann", "Ben"]), crewKey("wobble crew", ["ben", "ANN"]));
  assert.notEqual(crewKey("Wobble Crew", ["Ann", "Ben"]), crewKey("Wobble Crew", ["Ann", "Cy"]));
});
