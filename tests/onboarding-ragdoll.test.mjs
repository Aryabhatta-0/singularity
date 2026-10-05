import assert from "node:assert/strict";
import test from "node:test";

import { J, Rig } from "../src/components/onboarding/ragdoll-sim.ts";

const S = 40;
const GROUND = 600;

function puppet() {
  const rig = new Rig({ cx: 400, groundY: GROUND, s: S, width: 800 });
  const torso = rig.addCord([J.lShoulder, J.rShoulder], 400, GROUND - 7.5 * S);
  const lFoot = rig.addCord([J.lFoot], 380, GROUND - 6.4 * S);
  const rFoot = rig.addCord([J.rFoot], 420, GROUND - 6.4 * S);
  return { rig, torso, lFoot, rFoot };
}

const run = (rig, seconds) => {
  for (let t = 0; t < seconds; t += 1 / 60) rig.advance(1 / 60);
};

test("ragdoll keeps its limb lengths while hanging from cords", () => {
  const { rig } = puppet();
  run(rig, 3);
  for (const [a, b] of [
    [J.lShoulder, J.lElbow],
    [J.lElbow, J.lHand],
    [J.rHip, J.rKnee],
    [J.rKnee, J.rFoot],
    [J.lShoulder, J.rShoulder],
  ]) {
    const pa = rig.pts[a];
    const pb = rig.pts[b];
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    const rest = rig.restLength(a, b);
    assert.ok(Math.abs(len - rest) / rest < 0.06, `link ${a}-${b} stretched to ${len.toFixed(1)} from ${rest.toFixed(1)}`);
  }
  assert.ok(rig.pts[J.head].y < rig.pts[J.lHip].y, "puppet hangs upright");
  for (const p of rig.pts) assert.ok(p.y <= GROUND + 0.01, "nothing sinks through the ground");
});

test("yanking both legs while the torso goes slack face-plants the body", () => {
  const { rig, torso, lFoot, rFoot } = puppet();
  run(rig, 1.5);
  torso.len += 6 * S;
  lFoot.len = S * 0.5;
  rFoot.len = S * 0.5;
  let toppled = false;
  for (let t = 0; t < 2.5; t += 1 / 60) {
    rig.advance(1 / 60);
    if (rig.pts[J.head].y > rig.pts[J.lHip].y && rig.pts[J.head].y > rig.pts[J.rHip].y) toppled = true;
  }
  assert.ok(toppled, "head ends up below the hips");
});

test("a dropped ragdoll reports a hard ground impact once", () => {
  const rig = new Rig({ cx: 400, groundY: GROUND, s: S, width: 800 });
  rig.translate(0, -8 * S);
  let hardest = 0;
  for (let t = 0; t < 1.5; t += 1 / 60) {
    rig.advance(1 / 60);
    const hit = rig.consumeImpact();
    if (hit) hardest = Math.max(hardest, hit.speed);
  }
  assert.ok(hardest > 15, `impact speed ${hardest.toFixed(1)} s/s`);
  assert.equal(rig.consumeImpact()?.speed > 15, false, "impact is consumed");
});

test("simulation is deterministic for identical inputs", () => {
  const a = puppet();
  const b = puppet();
  for (const { rig, torso } of [a, b]) {
    for (let i = 0; i < 180; i++) {
      torso.ax = 400 + Math.sin(i / 10) * S;
      rig.advance(1 / 60);
    }
  }
  assert.deepEqual(
    a.rig.pts.map((p) => [p.x, p.y]),
    b.rig.pts.map((p) => [p.x, p.y]),
  );
});
