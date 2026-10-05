import assert from "node:assert/strict";
import test from "node:test";
import {
  InputManager,
  collectTeamRemoteInputs,
  createJointMixState,
  mergeTeamInputs,
  normalizeJoystickDisplacement,
  resolveTeamBodyInputs,
  sampleLocalTeamInput,
  teamPayloadsEqual,
  REMOTE_INPUT_LEASE_MS,
} from "../src/game/joint-input.ts";
import { emptyInput } from "../src/game/types.ts";

const input = (overrides = {}) => ({ ...emptyInput(), ...overrides });

test("squad sample keeps only the active Joint hot and steers with Torso", () => {
  const manager = new InputManager();
  manager.keys.add("KeyW");
  manager.keys.add("Space");

  const payload = sampleLocalTeamInput(manager, {
    solo: false,
    roles: ["arms", "torso", "legs"],
    activeRole: "legs",
    dt: 0.016,
  });

  assert.equal(payload.legs.f, 1, "active legs walk");
  assert.equal(payload.legs.a, true, "active legs jump");
  assert.equal(payload.arms.f, 0, "inactive arms stay neutral");
  assert.equal(payload.torso.f, 0, "inactive torso stays neutral");
  // Look is still live on every role.
  for (const role of ["arms", "torso", "legs"]) {
    assert.equal(payload[role].lx, manager.yaw);
  }
});

test("torso camera turns with movement, legs camera does not", () => {
  const torso = new InputManager();
  torso.keys.add("KeyD");
  sampleLocalTeamInput(torso, { solo: false, roles: ["torso"], activeRole: "torso", dt: 0.5 });
  assert.notEqual(torso.yaw, 0, "torso steers the camera");

  const legs = new InputManager();
  legs.keys.add("KeyD");
  sampleLocalTeamInput(legs, { solo: false, roles: ["legs"], activeRole: "legs", dt: 0.5 });
  assert.equal(legs.yaw, 0, "legs never steer the camera");
});

test("solo sample separates channels and never turns the camera by keyboard", () => {
  const manager = new InputManager();
  manager.keys.add("KeyW");
  manager.keys.add("ArrowUp");
  manager.keys.add("KeyE");

  const payload = sampleLocalTeamInput(manager, {
    solo: true,
    roles: ["arms", "torso", "legs"],
    activeRole: "legs",
    dt: 0.5,
  });

  assert.equal(payload.legs.f, 1);
  assert.equal(payload.arms.f, 1);
  assert.equal(payload.arms.a, true);
  assert.equal(payload.legs.a, false, "grab must not jump");
  assert.equal(manager.yaw, 0, "keyboard never turns the solo camera");
});

test("local presses win over remote in the merge", () => {
  const merged = mergeTeamInputs(
    { torso: input({ f: 1 }) },
    { torso: input({ f: -1 }), legs: input({ f: -1 }) },
  );
  assert.equal(merged.torso.f, 1, "local wins");
  assert.equal(merged.legs.f, -1, "remote fills gaps");
});

test("remote collection enforces the default lease inside the module", () => {
  assert.ok(REMOTE_INPUT_LEASE_MS > 0);
  const moving = input({ f: 1 });
  const found = collectTeamRemoteInputs(
    [{ identity: "guest", teamId: 3, roles: ["legs"], inputs: [moving], updatedAtMs: 9_500 }],
    { teamId: 3, ownIdentity: "host", nowMs: 10_000 },
  );
  assert.equal(found.legs.f, 1, "fresh row survives the default lease");

  const gone = collectTeamRemoteInputs(
    [{ identity: "guest", teamId: 3, roles: ["legs"], inputs: [moving], updatedAtMs: 0 }],
    { teamId: 3, ownIdentity: "host", nowMs: 10_000 },
  );
  assert.deepEqual(Object.keys(gone), [], "stale row expires");
});

test("resolve concentrates squad mixing behind the seam", () => {
  const state = createJointMixState();
  const phys = resolveTeamBodyInputs(
    { legs: input({ f: 1 }), arms: input({ f: 0.5, a: true }), torso: input() },
    3,
    0.31,
    state,
  );
  assert.ok(Math.abs(phys.lleg.f) > 0 || Math.abs(phys.rleg.f) > 0, "legs stride");
  assert.equal(phys.arms.f, 0.5);
  assert.equal(phys.arms.a, true);
});

test("five-player hands need both players for the two-hand grab", () => {
  const both = resolveTeamBodyInputs(
    { lhand: input({ a: true }), rhand: input({ a: true }), torso: input() },
    5,
    0.016,
    createJointMixState(),
  );
  assert.equal(both.arms.a, true);

  const single = resolveTeamBodyInputs(
    { lhand: input({ a: true }), rhand: input({ a: false }), torso: input() },
    5,
    0.016,
    createJointMixState(),
  );
  assert.equal(single.arms.a, false, "one hand alone must not two-hand grab");
});

test("payload equality ignores key order and spots real changes", () => {
  const a = { torso: input({ f: 1 }), legs: input() };
  const b = { legs: input(), torso: input({ f: 1 }) };
  assert.equal(teamPayloadsEqual(a, b), true);
  assert.equal(teamPayloadsEqual(a, { torso: input({ f: 0.5 }), legs: input() }), false);
});

test("touch math stays reachable through the intake seam", () => {
  const still = normalizeJoystickDisplacement(0, 0, 28, 0.14);
  assert.deepEqual([still.forward, still.side], [0, 0]);
  const pushed = normalizeJoystickDisplacement(0, -28, 28, 0.14);
  assert.ok(pushed.forward > 0.9, "full deflection drives forward");
});
