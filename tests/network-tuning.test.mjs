import assert from "node:assert/strict";
import test from "node:test";
import {
  INPUT_CHANGE_SEND_INTERVAL_MS,
  INPUT_REFRESH_INTERVAL_MS,
  SNAPSHOT_INTERPOLATION_DELAY_MS,
  SNAPSHOT_MAX_EXTRAPOLATION_MS,
  SNAPSHOT_SEND_INTERVAL_SECONDS,
  snapshotExtrapolationSeconds,
} from "../src/game/network-tuning.ts";

test("network cadence favors responsiveness while staying below server ceilings", () => {
  assert.equal(INPUT_CHANGE_SEND_INTERVAL_MS, 25);
  assert.equal(INPUT_REFRESH_INTERVAL_MS, 100);
  assert.equal(SNAPSHOT_SEND_INTERVAL_SECONDS, 1 / 30);
  assert.equal(SNAPSHOT_INTERPOLATION_DELAY_MS, 55);
});

test("snapshot prediction only extrapolates forward for a bounded interval", () => {
  assert.equal(snapshotExtrapolationSeconds(1_000, 1_010), 0);
  assert.equal(snapshotExtrapolationSeconds(1_025, 1_000), 0.025);
  assert.equal(snapshotExtrapolationSeconds(2_000, 1_000), SNAPSHOT_MAX_EXTRAPOLATION_MS / 1_000);
  assert.equal(snapshotExtrapolationSeconds(Number.NaN, 1_000), 0);
});
