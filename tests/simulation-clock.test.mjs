import assert from "node:assert/strict";
import test from "node:test";
import { FixedStepClock } from "../src/game/simulation-clock.ts";

test("fixed-step clock preserves real-time simulation at low render frame rates", () => {
  const clock = new FixedStepClock(1 / 120, 24);

  assert.equal(clock.advance(1 / 20), 6);
  assert.equal(clock.advance(1 / 10), 12);
  assert.ok(clock.backlog < 1 / 120);
});

test("fixed-step clock retains excess backlog instead of discarding elapsed time", () => {
  const clock = new FixedStepClock(1 / 120, 12);

  assert.equal(clock.advance(0.25), 12);
  assert.ok(clock.backlog >= 0.149 && clock.backlog <= 0.151);
  assert.equal(clock.advance(0), 12);
  assert.ok(clock.backlog >= 0.049 && clock.backlog <= 0.051);
});

test("fixed-step clock stays real-time at one FPS and bounds longer discontinuities", () => {
  const clock = new FixedStepClock(1 / 120, 120, 1);

  assert.equal(clock.advance(1), 120);
  assert.ok(clock.backlog < 1 / 120);
  assert.equal(clock.advance(10), 120);
  assert.ok(clock.backlog < 1 / 120);
});
