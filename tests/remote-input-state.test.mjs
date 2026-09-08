import assert from "node:assert/strict";
import test from "node:test";
import { collectRemoteInputs, neutralInputsForRoles, replaceRemoteInputs } from "../src/game/remote-input-state.ts";

const moving = { f: 1, s: 0, a: false, b: false, q: false, e: false, lx: 0, ly: 0 };

test("remote input updates replace omitted roles with neutral state", () => {
  const next = replaceRemoteInputs({ torso: { ...moving, f: -1 } });

  assert.deepEqual(Object.keys(next), ["torso"]);
  assert.equal(next.torso.f, -1);
});

test("remote input collection ignores rows whose lease has expired", () => {
  const inputs = collectRemoteInputs(
    [
      { identity: "fresh", teamId: 7, roles: ["torso"], inputs: [moving], updatedAtMs: 9_800 },
      { identity: "stale", teamId: 7, roles: ["legs"], inputs: [moving], updatedAtMs: 8_000 },
      { identity: "other-team", teamId: 8, roles: ["arms"], inputs: [moving], updatedAtMs: 9_900 },
    ],
    { teamId: 7, ownIdentity: "host", nowMs: 10_000, leaseMs: 750 },
  );

  assert.deepEqual(Object.keys(inputs), ["torso"]);
});

test("losing focus produces an explicit neutral update for every assigned role", () => {
  assert.deepEqual(neutralInputsForRoles(["torso", "legs"]), {
    torso: { f: 0, s: 0, a: false, b: false, q: false, e: false, lx: 0, ly: 0 },
    legs: { f: 0, s: 0, a: false, b: false, q: false, e: false, lx: 0, ly: 0 },
  });
});

test("remote input collection clamps axes and neutralizes non-finite values", () => {
  const unsafe = { ...moving, f: 5, s: Number.NaN, lx: Number.POSITIVE_INFINITY, ly: -8 };
  const inputs = collectRemoteInputs(
    [{ identity: "guest", teamId: 7, roles: ["torso"], inputs: [unsafe] }],
    { teamId: 7, ownIdentity: "host", nowMs: 10_000, leaseMs: 750 },
  );
  assert.deepEqual(inputs.torso, { ...moving, f: 1, s: 0, lx: 0, ly: -1 });
});
