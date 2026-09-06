import assert from "node:assert/strict";
import test from "node:test";
import { planPlayingTransition } from "../src/game/round-transition.ts";

test("authoritative playing phase starts a round already prepared by countdown", () => {
  assert.deepEqual(
    planPlayingTransition({ running: false, finished: false, observedRound: 4, currentRound: 4 }),
    { prepare: false, start: true },
  );
});

test("joining after countdown prepares and starts the active round", () => {
  assert.deepEqual(
    planPlayingTransition({ running: false, finished: false, observedRound: -1, currentRound: 4 }),
    { prepare: true, start: true },
  );
});

test("playing transitions never restart a running or finished game", () => {
  assert.deepEqual(
    planPlayingTransition({ running: true, finished: false, observedRound: 4, currentRound: 4 }),
    { prepare: false, start: false },
  );
  assert.deepEqual(
    planPlayingTransition({ running: false, finished: true, observedRound: 4, currentRound: 4 }),
    { prepare: false, start: false },
  );
});
