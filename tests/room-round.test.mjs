import assert from "node:assert/strict";
import test from "node:test";
import {
  COUNTDOWN_FALLBACK_MS,
  COUNTDOWN_MS,
  PendingSnapshotBuffer,
  countdownShown,
  nextCountdownDelayMs,
  planPlayingTransition,
  rosterKey,
  routeSnapshot,
} from "../src/game/room-round.ts";

test("countdown plates cap at 4 and tick on whole-second flips", () => {
  assert.equal(COUNTDOWN_FALLBACK_MS, COUNTDOWN_MS);
  assert.equal(countdownShown(4_200), 4);
  assert.equal(countdownShown(3_000), 3);
  assert.equal(countdownShown(500), 1);
  assert.ok(nextCountdownDelayMs(4_200) <= 1_000, "wakes on the next flip");
  assert.equal(nextCountdownDelayMs(3_000), 1_000);
  assert.ok(nextCountdownDelayMs(100) <= 100, "never oversleeps the flip");
});

test("playing transition prepares on a fresh round and starts a cold engine", () => {
  const cold = planPlayingTransition({ running: false, finished: false, observedRound: -1, currentRound: 1 });
  assert.deepEqual(cold, { prepare: true, start: true });
  const steady = planPlayingTransition({ running: true, finished: false, observedRound: 1, currentRound: 1 });
  assert.deepEqual(steady, { prepare: false, start: false });
});

test("roster fingerprint ignores order but spots role changes", () => {
  const a = [
    { id: "x", teamId: 1, roles: ["torso", "arms"] },
    { id: "y", teamId: 2, roles: ["legs"] },
  ];
  const reordered = [
    { id: "y", teamId: 2, roles: ["legs"] },
    { id: "x", teamId: 1, roles: ["arms", "torso"] },
  ];
  assert.equal(rosterKey(a), rosterKey(reordered));
  assert.notEqual(
    rosterKey(a),
    rosterKey([{ id: "x", teamId: 1, roles: ["torso"] }, { id: "y", teamId: 2, roles: ["legs"] }]),
  );
});

test("snapshot routing buffers while creating, then splits own vs ghost", () => {
  assert.equal(routeSnapshot(1, 1, false), "buffer");
  assert.equal(routeSnapshot(2, 1, false), "buffer");
  assert.equal(routeSnapshot(1, 1, true), "own");
  assert.equal(routeSnapshot(2, 1, true), "ghost");
});

test("pending buffer drains destructively with nothing left behind", () => {
  const buffer = new PendingSnapshotBuffer();
  const own = { tag: "own" };
  const ghost = { tag: "ghost" };
  buffer.set(1, own);
  buffer.set(2, ghost);
  assert.equal(buffer.size, 2);
  assert.equal(buffer.take(1), own);
  assert.equal(buffer.size, 1);
  assert.deepEqual(buffer.takeAll(), [[2, ghost]]);
  assert.equal(buffer.size, 0);
  assert.equal(buffer.take(9), undefined);
});
