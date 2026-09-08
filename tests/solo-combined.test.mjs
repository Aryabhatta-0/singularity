import assert from "node:assert/strict";
import test from "node:test";

import { emptyInput } from "../src/game/types.ts";
import {
  SOLO_ROLES,
  SOLO_SQUAD,
  buildSoloSeparatedPayload,
  makeSquadMixState,
  resolvePhysInputs,
} from "../src/game/squad.ts";
import { InputManager } from "../src/game/input.ts";

const input = (overrides = {}) => ({ ...emptyInput(), ...overrides });

test("solo is locked to the combined 3-channel body", () => {
  assert.equal(SOLO_SQUAD, 3);
  assert.deepEqual([...SOLO_ROLES], ["arms", "torso", "legs"]);
});

test("solo read separates legs / arms / torso bindings", () => {
  const manager = new InputManager();
  manager.keys.add("KeyW");
  manager.keys.add("ArrowUp");
  manager.keys.add("KeyE");
  manager.keys.add("KeyC");
  manager.yaw = 0.5;
  manager.pitch = -0.1;

  const { legs, arms, torso } = manager.readSolo();

  // Legs: WASD only.
  assert.equal(legs.f, 1);
  assert.equal(legs.a, false, "E must not jump");
  // Arms: arrows + E only.
  assert.equal(arms.f, 1);
  assert.equal(arms.a, true, "E grabs with both hands");
  assert.equal(arms.b, false, "no throw without Shift");
  // Torso: gentle capped lean with the stride, crouch on its own key.
  assert.equal(torso.f, 0.45, "torso leans gently with leg movement");
  assert.equal(torso.b, true, "C crouches");
  assert.equal(torso.a, false, "E must not brace");
  // One camera for every channel.
  for (const channel of [legs, arms, torso]) {
    assert.equal(channel.lx, manager.yaw);
    assert.equal(channel.ly, manager.pitch);
  }
});

test("solo diagonal strafing leans no harder than straight walking", () => {
  const manager = new InputManager();
  manager.keys.add("KeyW");
  manager.keys.add("KeyA");
  const { legs, torso } = manager.readSolo();
  assert.deepEqual({ f: legs.f, s: legs.s }, { f: 1, s: -1 });
  const lean = Math.hypot(torso.f, torso.s);
  assert.ok(Math.abs(lean - 0.45) < 1e-9, `diagonal lean capped at 0.45, got ${lean}`);
});

test("solo verbs never share a button", () => {  const jumpOnly = new InputManager();
  jumpOnly.keys.add("Space");
  const jumped = jumpOnly.readSolo();
  assert.equal(jumped.legs.a, true, "Space jumps");
  assert.equal(jumped.arms.a, false, "Space must not grab");
  assert.equal(jumped.torso.a, false, "Space must not brace");

  const grabOnly = new InputManager();
  grabOnly.keys.add("KeyE");
  const grabbed = grabOnly.readSolo();
  assert.equal(grabbed.arms.a, true, "E grabs");
  assert.equal(grabbed.legs.a, false, "E must not jump");
  assert.equal(grabbed.torso.b, false, "E must not crouch");

  const throwOnly = new InputManager();
  throwOnly.keys.add("ShiftLeft");
  const thrown = throwOnly.readSolo();
  assert.equal(thrown.arms.b, true, "Shift throws");
  assert.equal(thrown.torso.b, false, "Shift must not crouch");

  const braceOnly = new InputManager();
  braceOnly.keys.add("KeyB");
  const braced = braceOnly.readSolo();
  assert.equal(braced.torso.a, true, "B braces");
  assert.equal(braced.arms.a, false, "B must not grab");
  assert.equal(braced.legs.a, false, "B must not jump");
});

test("solo single-hand grabs stay independent", () => {
  const manager = new InputManager();
  manager.keys.add("KeyQ");
  const { arms } = manager.readSolo();
  assert.equal(arms.q, true);
  assert.equal(arms.a, false, "Q alone must not two-hand grab");
  assert.equal(arms.e, false);

  const right = new InputManager();
  right.keys.add("KeyR");
  assert.equal(right.readSolo().arms.e, true);
  assert.equal(right.readSolo().arms.a, false, "R alone must not two-hand grab");
});

test("separated payload walks, aims arms, and braces independently", () => {
  const payload = buildSoloSeparatedPayload({
    legs: input({ f: 1, s: 0, a: false }),
    arms: input({ f: 0.5, s: 0, a: true }),
    torso: input({ f: 1, s: 0, a: false, b: true }),
  });
  assert.deepEqual(Object.keys(payload).sort(), ["arms", "legs", "torso"]);

  const phys = resolvePhysInputs(payload, SOLO_SQUAD, 0.31, makeSquadMixState());
  // Legs stride on their own axis while arms hold their own raise + grab.
  assert.ok(Math.abs(phys.lleg.f) > 0 || Math.abs(phys.rleg.f) > 0, "legs stride");
  assert.equal(phys.lleg.a, false, "no jump without Space");
  assert.equal(phys.arms.f, 0.5, "arms keep their own raise");
  assert.equal(phys.arms.a, true, "both-hands grab held");
  assert.equal(phys.torso.b, true, "crouch held while walking");
  assert.equal(phys.head.lx, 0, "no camera drift without mouse");
});

test("solo touch verbs write to their own channel only", () => {
  const manager = new InputManager();
  manager.setSoloVirtualLegs(1, 0);
  manager.setSoloVirtualArms(-1, 0.5);
  manager.setSoloVirtualAction("grab", true);
  manager.setSoloVirtualAction("crouch", true);

  const { legs, arms, torso } = manager.readSolo();
  assert.deepEqual({ f: legs.f, s: legs.s }, { f: 1, s: 0 });
  assert.equal(legs.a, false);
  assert.deepEqual({ f: arms.f, s: arms.s }, { f: -1, s: 0.5 });
  assert.equal(arms.a, true);
  assert.equal(torso.b, true);
  assert.equal(torso.a, false);

  manager.resetVirtualControls();
  const cleared = manager.readSolo();
  assert.deepEqual(
    { f: cleared.legs.f, a: cleared.legs.a, grab: cleared.arms.a, crouch: cleared.torso.b },
    { f: 0, a: false, grab: false, crouch: false },
  );
});

test("solo camera is mouse-only: strafing never turns it", () => {
  const manager = new InputManager();
  manager.keys.add("KeyA");
  manager.keys.add("KeyW");
  const before = manager.yaw;
  // GameClient passes keysActive=false for solo (mouse steers via listeners).
  manager.tickHead(0.5, false);
  assert.equal(manager.yaw, before, "keyboard must not turn the solo camera");
  const { legs } = manager.readSolo();
  assert.equal(legs.s, -1, "strafe still strafes");
});
