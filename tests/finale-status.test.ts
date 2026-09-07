import assert from "node:assert/strict";
import test from "node:test";
import {
  finaleAnnouncement,
  finaleCueState,
  finaleRoleCopy,
  finaleSignalCopy,
} from "../src/finale-status.ts";
import { CHALLENGE, challengeFor, createBody } from "../shared/physics.ts";

function placeAtFinalGate(body: ReturnType<typeof createBody>) {
  body.stage = challengeFor(body.challenge).stages.length - 1;
  const stage = challengeFor(body.challenge).stages[body.stage];
  const offset = stage.gate - 1 - body.nodes[0].z;
  for (const point of body.nodes) {
    point.z += offset;
    point.pz += offset;
  }
}

test("finale cues share physics eligibility and explicit precedence", () => {
  const body = createBody(CHALLENGE.Difficult, 5);
  body.stage = challengeFor(body.challenge).stages.length - 1;
  body.ticks = 59;
  assert.equal(finaleCueState(body), "approach");

  body.previousActions.fill(true);
  assert.equal(finaleCueState(body), "rearm");
  body.lockout = 3;
  assert.equal(finaleCueState(body), "missed");
  body.syncStarted = true;
  assert.equal(finaleCueState(body), "locked");

  body.syncStarted = false;
  body.lockout = 0;
  body.previousActions.fill(false);
  placeAtFinalGate(body);
  assert.equal(finaleCueState(body), "align");
  body.ticks = 79;
  assert.equal(finaleCueState(body), "wait");
  body.stage--;
  assert.equal(finaleCueState(body), "inactive");
});

test("finale cue copy stays consistent across visual and live channels", () => {
  assert.match(finaleRoleCopy("rearm"), /RELEASE ACT/);
  assert.match(finaleSignalCopy("missed"), /MISSED BEAT/);
  assert.match(finaleAnnouncement("approach"), /Reach the launch gate/);
  assert.match(finaleAnnouncement("align"), /press action together now/);
  assert.equal(finaleAnnouncement("inactive"), "");
});
