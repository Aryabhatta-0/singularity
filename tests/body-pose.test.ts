import assert from "node:assert/strict";
import test from "node:test";
import { CHALLENGE, createBody } from "../shared/physics.ts";
import { BodyPoseSampler, dampingAlpha } from "../src/body-pose.ts";

const close = (actual: number, expected: number, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

test("pose sampling blends authoritative ticks without extrapolation", () => {
  const sampler = new BodyPoseSampler();
  const body = createBody(CHALLENGE.Easy, 3);
  assert.equal(sampler.update("practice:1", body, 0).snapped, true);

  body.nodes[0].x = 3;
  body.look = Math.PI / 2;
  body.ticks++;
  close(sampler.update("practice:1", body, 1).positions[0], 0);
  const halfway = sampler.update("practice:1", body, 1 + 1 / 60);
  close(halfway.positions[0], 1.5);
  close(halfway.tick, 0.5);
  close(halfway.look, Math.PI / 4);
  close(sampler.update("practice:1", body, 2).positions[0], 3);
});

test("pose sampling snaps on falls, attempt changes, and tick rollback", () => {
  const sampler = new BodyPoseSampler();
  const body = createBody(CHALLENGE.Difficult, 5);
  sampler.update("ranked:A:1", body, 0);
  body.nodes[0].z = 1;
  body.ticks = 1;
  assert.equal(sampler.update("ranked:A:1", body, 1).snapped, false);

  body.falls++;
  body.nodes[0].z = 22;
  let sampled = sampler.update("ranked:A:1", body, 1.01);
  assert.equal(sampled.snapped, true);
  close(sampled.positions[2], 22);

  body.nodes[0].z = 0;
  body.ticks = 0;
  sampled = sampler.update("ranked:A:2", body, 1.02);
  assert.equal(sampled.snapped, true);
  close(sampled.positions[2], 0);
});

test("exponential damping is frame-rate invariant over equal wall time", () => {
  const simulate = (hz: number) => {
    let value = 0;
    for (let frame = 0; frame < hz; frame++)
      value += (1 - value) * dampingAlpha(7, 1 / hz);
    return value;
  };
  close(simulate(30), simulate(60));
  close(simulate(60), simulate(144));
  close(dampingAlpha(7, 0), 0);
  close(dampingAlpha(-1, 1 / 60), 0);
});
