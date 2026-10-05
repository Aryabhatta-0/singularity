import assert from "node:assert/strict";
import test from "node:test";
import { microsToMilliseconds, storedMilliseconds } from "../src/game/timing.ts";

test("SpacetimeDB timestamps and gameplay durations keep their distinct units", () => {
  assert.equal(microsToMilliseconds(65_432_000n), 65_432);
  assert.equal(storedMilliseconds(65_432n), 65_432);
});
