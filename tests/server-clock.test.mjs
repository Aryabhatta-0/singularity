import assert from "node:assert/strict";
import test from "node:test";
import { ServerClock } from "../src/game/server-clock.ts";

test("server clock uses the least-delayed recent timestamp sample", () => {
  const clock = new ServerClock(4);
  clock.observe(9_880, 10_000); // 120 ms delivery delay
  clock.observe(10_080, 10_100); // 20 ms delivery delay
  clock.observe(10_140, 10_200); // 60 ms delivery delay

  assert.equal(clock.offsetMs, -20);
  assert.equal(clock.now(11_000), 10_980);
});

test("server clock bounds memory to recent samples", () => {
  const clock = new ServerClock(2);
  clock.observe(900, 1_000);
  clock.observe(1_990, 2_000);
  clock.observe(2_950, 3_000);

  assert.equal(clock.offsetMs, -10);
});
