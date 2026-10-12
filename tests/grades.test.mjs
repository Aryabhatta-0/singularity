import assert from "node:assert/strict";
import test from "node:test";

import { coachedRoles, markCoached, medalFor, medalThresholds, nextMedal, readBest, recordBest, squadKey } from "../src/game/grades.ts";
import { CHALLENGES } from "../src/game/types.ts";

const memoryStore = () => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
};

test("every course has ordered medal thresholds, looser for bigger squads", () => {
  for (const { id } of CHALLENGES) {
    const solo = medalThresholds(id, "solo");
    assert.ok(solo.gold < solo.silver && solo.silver < solo.bronze, `${id} medals are ordered`);
    const five = medalThresholds(id, "5");
    assert.ok(five.gold > solo.gold, `${id} gives 5-player squads more time`);
  }
});

test("medals are deterministic thresholds, inclusive at the boundary", () => {
  const t = medalThresholds("wobble-run", "solo");
  assert.equal(medalFor("wobble-run", "solo", t.gold), "gold");
  assert.equal(medalFor("wobble-run", "solo", t.gold + 1), "silver");
  assert.equal(medalFor("wobble-run", "solo", t.bronze), "bronze");
  assert.equal(medalFor("wobble-run", "solo", t.bronze + 1), null);
  assert.equal(medalFor("wobble-run", "solo", null), null);
  assert.equal(medalFor("wobble-run", "solo", 0), null);
});

test("next medal reports the target and the gap to close", () => {
  const t = medalThresholds("ferry-job", "3");
  assert.deepEqual(nextMedal("ferry-job", "3", t.silver + 500), { medal: "silver", target: t.silver, gap: 500 });
  assert.equal(nextMedal("ferry-job", "3", t.gold - 1), null);
  assert.equal(nextMedal("ferry-job", "3", null)?.medal, "bronze");
});

test("personal bests only improve, and survive a broken store", () => {
  const store = memoryStore();
  assert.equal(readBest(store, "slam-dunk", "solo"), null);
  const first = recordBest(store, "slam-dunk", "solo", 60_000);
  assert.deepEqual(first, { previous: null, best: 60_000, improved: true, delta: null });
  const slower = recordBest(store, "slam-dunk", "solo", 65_000);
  assert.equal(slower.improved, false);
  assert.equal(slower.best, 60_000);
  assert.equal(slower.delta, -5_000);
  const faster = recordBest(store, "slam-dunk", "solo", 52_500);
  assert.equal(faster.improved, true);
  assert.equal(faster.delta, 7_500);
  assert.equal(readBest(store, "slam-dunk", "solo"), 52_500);
  assert.equal(readBest(store, "slam-dunk", "5"), null, "squad sizes keep separate bests");
  const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
  assert.equal(readBest(broken, "slam-dunk", "solo"), null);
  assert.equal(recordBest(broken, "slam-dunk", "solo", 1000).improved, true);
});

test("squad keys and coaching memory", () => {
  assert.equal(squadKey(true, 3), "solo");
  assert.equal(squadKey(false, 3), "3");
  assert.equal(squadKey(false, 5), "5");
  const store = memoryStore();
  markCoached(store, "lleg");
  markCoached(store, "torso");
  assert.deepEqual([...coachedRoles(store)].sort(), ["lleg", "torso"]);
});
