import assert from "node:assert/strict";
import test from "node:test";
import { GameFeedbackTracker, type GameFeedbackEvent } from "../src/game-feedback.ts";
import {
  CHALLENGE,
  challengeFor,
  createBody,
  isNextFinalStepAligned,
} from "../shared/physics.ts";

function placeAtFinalGate(body: ReturnType<typeof createBody>) {
  body.stage = challengeFor(body.challenge).stages.length - 1;
  const gate = challengeFor(body.challenge).stages[body.stage].gate;
  const offset = gate - 1 - body.nodes[0].z;
  for (const point of body.nodes) {
    point.z += offset;
    point.pz += offset;
  }
}

test("feedback counters emit once and attempt changes reset quietly", () => {
  const events: GameFeedbackEvent[] = [];
  const tracker = new GameFeedbackTracker(event => events.push(event));
  const body = createBody(CHALLENGE.Easy, 5);
  tracker.update("attempt-a", body);
  assert.deepEqual(events, []);

  body.ticks++;
  body.hazardContacts[0] = true;
  tracker.update("attempt-a", body);
  tracker.update("attempt-a", body);
  assert.deepEqual(events.map(event => event.kind), ["impact"]);

  body.ticks++;
  body.stage++;
  tracker.update("attempt-a", body);
  body.ticks++;
  body.mistakes++;
  tracker.update("attempt-a", body);
  assert.deepEqual(events.map(event => event.kind), ["impact", "stage", "mistake"]);

  body.falls++;
  tracker.update("attempt-a", body);
  assert.equal(events.at(-1)?.kind, "fall");
  const count = events.length;
  tracker.update("attempt-b", body);
  assert.equal(events.length, count);
});

test("physical transitions distinguish steps, lifts, landings, and grips", () => {
  const events: GameFeedbackEvent[] = [];
  const tracker = new GameFeedbackTracker(event => events.push(event));
  const body = createBody(CHALLENGE.Easy, 3);
  tracker.update("run", body);

  body.ticks = 7;
  body.nodes[0].z += 0.1;
  body.nodes[0].pz = body.nodes[0].z - 0.1;
  tracker.update("run", body);
  assert.equal(events.at(-1)?.kind, "step");

  body.ticks++;
  body.nodes[4].y = body.nodes[5].y = 0.7;
  tracker.update("run", body);
  assert.equal(events.at(-1)?.kind, "lift");

  body.ticks++;
  body.nodes[4].y = body.nodes[5].y = 0.25;
  body.nodes[0].py = body.nodes[0].y + 0.1;
  tracker.update("run", body);
  assert.equal(events.at(-1)?.kind, "land");
  assert.ok(events.at(-1)!.strength > 0.35);

  body.ticks++;
  body.handGrip[0] = 0;
  tracker.update("run", body);
  assert.equal(events.at(-1)?.kind, "grip");
});

test("completion emits the payoff event instead of an extra stage pulse", () => {
  const events: GameFeedbackEvent[] = [];
  const tracker = new GameFeedbackTracker(event => events.push(event));
  const body = createBody(CHALLENGE.Easy, 5);
  tracker.update("run", body);
  body.ticks++;
  body.stage = 6;
  body.finished = true;
  tracker.update("run", body);
  assert.deepEqual(events.map(event => event.kind), ["finish"]);
});

test("finale alignment feedback announces one actionable edge per timing window", () => {
  const events: GameFeedbackEvent[] = [];
  const tracker = new GameFeedbackTracker(event => events.push(event));
  const body = createBody(CHALLENGE.Difficult, 5);
  body.stage = challengeFor(body.challenge).stages.length - 1;
  body.ticks = 59;

  tracker.update("run", body);
  assert.deepEqual(events, [], "an open clock window is not actionable away from the gate");

  placeAtFinalGate(body);
  tracker.update("run", body);
  tracker.update("run", body);
  assert.deepEqual(events.map(event => event.kind), ["align"]);

  const gateZ = body.nodes[0].z;
  for (const point of body.nodes) {
    point.z -= 12;
    point.pz -= 12;
  }
  tracker.update("run", body);
  for (const point of body.nodes) {
    point.z += 12;
    point.pz += 12;
  }
  assert.equal(body.nodes[0].z, gateZ);
  tracker.update("run", body);
  assert.deepEqual(events.map(event => event.kind), ["align"], "gate re-entry must not replay the same window");

  while (isNextFinalStepAligned(body.ticks)) body.ticks++;
  tracker.update("run", body);
  while (!isNextFinalStepAligned(body.ticks)) body.ticks++;
  tracker.update("run", body);
  assert.deepEqual(events.map(event => event.kind), ["align", "align"]);
});

test("finale alignment feedback is quiet on reset, lockout, and non-finale stages", () => {
  const events: GameFeedbackEvent[] = [];
  const tracker = new GameFeedbackTracker(event => events.push(event));
  const body = createBody(CHALLENGE.Difficult, 5);
  placeAtFinalGate(body);
  body.ticks = 59;

  tracker.update("run", body);
  tracker.reset();
  tracker.update("run", body);
  assert.deepEqual(events, [], "adopting an already-open attempt must not fabricate a cue");

  while (isNextFinalStepAligned(body.ticks)) body.ticks++;
  tracker.update("run", body);
  while (!isNextFinalStepAligned(body.ticks)) body.ticks++;
  body.lockout = 3;
  tracker.update("run", body);
  body.lockout = 0;
  tracker.update("run", body);
  assert.deepEqual(events, [], "lockout suppresses the entire active window");

  while (isNextFinalStepAligned(body.ticks)) body.ticks++;
  tracker.update("run", body);
  body.stage--;
  while (!isNextFinalStepAligned(body.ticks)) body.ticks++;
  tracker.update("run", body);
  assert.deepEqual(events, [], "clock alignment outside the finale is ambient, not actionable");
});
