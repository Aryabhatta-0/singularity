import assert from "node:assert/strict";
import test from "node:test";
import { compareLeaderboardRows, topLeaderboardRows } from "../src/game/leaderboard.ts";
import { CHALLENGES } from "../src/game/types.ts";
import { overflowLeaderboardIds } from "../server/src/leaderboard.ts";

const row = (overrides = {}) => ({
  id: "1",
  challengeId: "wobble-run",
  squadSize: 5,
  teamName: "Team 1",
  players: ["Solo"],
  timeMs: 10_000,
  ...overrides,
});

test("leaderboards use the configured squad size instead of player count", () => {
  const soloFivePlayerMode = row({ players: ["Solo"], squadSize: 5 });
  const soloThreePlayerMode = row({ id: "2", players: ["Solo"], squadSize: 3 });

  assert.deepEqual(topLeaderboardRows([soloFivePlayerMode, soloThreePlayerMode], "wobble-run", 5), [soloFivePlayerMode]);
  assert.deepEqual(topLeaderboardRows([soloFivePlayerMode, soloThreePlayerMode], "wobble-run", 3), [soloThreePlayerMode]);
});

test("category filtering happens before the display limit", () => {
  const noisyCategory = Array.from({ length: 20 }, (_, index) =>
    row({ id: String(index + 1), challengeId: "ferry-job", timeMs: index + 1 })
  );
  const wanted = row({ id: "100", challengeId: "wobble-run", squadSize: 3, timeMs: 55_000 });

  assert.deepEqual(topLeaderboardRows([...noisyCategory, wanted], "wobble-run", 3, 1), [wanted]);
});

test("every configured game has an independent leaderboard", () => {
  const allGames = CHALLENGES.map((challenge, index) =>
    row({ id: String(index + 1), challengeId: challenge.id, timeMs: 10_000 + index })
  );

  for (const [index, challenge] of CHALLENGES.entries()) {
    assert.deepEqual(topLeaderboardRows(allGames, challenge.id, 5), [allGames[index]]);
  }
});

test("ties are deterministic by numeric auto-increment id without mutating input", () => {
  const later = row({ id: "10", timeMs: 12_345 });
  const earlier = row({ id: "2", timeMs: 12_345 });
  const fastest = row({ id: "99", timeMs: 1_000 });
  const input = [later, earlier, fastest];

  assert.deepEqual([...input].sort(compareLeaderboardRows), [fastest, earlier, later]);
  assert.deepEqual(topLeaderboardRows(input, "wobble-run", 5), [fastest, earlier, later]);
  assert.deepEqual(input, [later, earlier, fastest]);
});

test("server materialization evicts every row beyond the category limit", () => {
  const stored = Array.from({ length: 11 }, (_, index) => ({
    id: BigInt(index + 1),
    time_ms: BigInt(index === 0 ? 50_000 : index * 1_000),
  }));

  assert.deepEqual(overflowLeaderboardIds(stored, 10), [1n]);
  assert.equal(stored[0].id, 1n);
});
