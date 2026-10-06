import assert from "node:assert/strict";
import test from "node:test";
import {
  bracketSnapshots,
  decodeSnapshotRow,
  ghostStandings,
  shouldKeepLiveProgress,
  SnapshotOrderGate,
  trackGhostProgress,
} from "../src/game/ghost-snapshot.ts";
import { getLevel } from "../src/game/levels.ts";

const live = (overrides = {}) => ({ progress: 0.5, score: 0, fallen: false, timerMs: 1_000, ...overrides });

test("bracket picks the pair straddling render time", () => {
  const buffer = [{ recv: 0 }, { recv: 100 }, { recv: 200 }];
  assert.deepEqual(bracketSnapshots(buffer, 150), { a: 1, b: 2 });
  assert.deepEqual(bracketSnapshots(buffer, 0), { a: 0, b: 1 });
  // Predicting past the latest pose pins to it.
  assert.deepEqual(bracketSnapshots(buffer, 500), { a: 2, b: 2 });
  assert.deepEqual(bracketSnapshots([{ recv: 10 }], 500), { a: 0, b: 0 });
  assert.equal(bracketSnapshots([], 100), null);
});

test("sub-stride drift inside a timer bucket keeps the rail state", () => {
  const previous = live();
  assert.equal(
    shouldKeepLiveProgress(previous, live({ progress: previous.progress + 0.001 })),
    true,
    "drift below stride is noise",
  );
  assert.equal(shouldKeepLiveProgress(previous, live({ progress: previous.progress + 0.01 })), false);
  assert.equal(shouldKeepLiveProgress(previous, live({ fallen: true })), false, "falls always flow through");
  assert.equal(shouldKeepLiveProgress(previous, live({ timerMs: 1_600 })), false, "bucket flips re-render");
  assert.equal(shouldKeepLiveProgress(undefined, live()), false, "first pose always stores");
});

test("tracking stores monotonic progress from a Ghost pose", () => {
  const level = getLevel("wobble-run");
  const snap = { p: [0, 0, level.spawn[2], 0, 0, 0, 1], score: 0, fallen: 0, timer: 1 };
  const first = trackGhostProgress(level, snap, undefined);
  assert.equal(first.keep, false);
  const same = trackGhostProgress(level, snap, first.next);
  assert.equal(same.keep, true, "identical pose is noise");
  assert.ok(same.next.progress >= first.next.progress, "progress never rolls back");
});

test("standings put finishers by time, racers by progress", () => {
  const teams = [
    { id: 1, name: "Team 1", color: "#fff", hostId: null, finishMs: null },
    { id: 2, name: "Team 2", color: "#000", hostId: null, finishMs: 60_000 },
  ];
  const rows = ghostStandings(teams, { 1: live({ progress: 0.9 }) });
  assert.equal(rows[0].team.id, 2, "finisher leads");
  assert.deepEqual(rows.map((r) => r.place), [1, 2]);
});

test("wire validation stays reachable through the Ghost seam", () => {
  const gate = new SnapshotOrderGate();
  assert.equal(gate.accept(1, undefined, undefined), true, "legacy rows pass");
  const bad = decodeSnapshotRow({
    recvMicros: 1_000n,
    p: [0],
    props: [],
    yaw: 0,
    pitch: 0,
    timer: 1,
    fallen: false,
    score: 0,
    ev: "[]",
  });
  assert.equal(bad, null, "short transforms rejected before interpolation");
});
