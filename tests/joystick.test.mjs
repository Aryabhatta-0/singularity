import assert from "node:assert/strict";
import test from "node:test";
import { floatingJoystickOrigin, normalizeJoystickDisplacement } from "../src/game/joystick.ts";

test("floating joystick appears exactly at the initiating touch, including screen edges", () => {
  assert.deepEqual(floatingJoystickOrigin(10, 18, 0, 0), { x: 10, y: 18 });
  assert.deepEqual(floatingJoystickOrigin(105, 240, 5, 40), { x: 100, y: 200 });
});

test("joystick maps in-radius displacement to forward and side axes", () => {
  assert.deepEqual(normalizeJoystickDisplacement(30, -40, 100, 0), {
    forward: 0.4,
    side: 0.3,
    knobX: 30,
    knobY: -40,
  });
});

test("joystick clamps the knob and axes to the circular radius", () => {
  assert.deepEqual(normalizeJoystickDisplacement(60, 80, 50, 0), {
    forward: -0.8,
    side: 0.6,
    knobX: 30,
    knobY: 40,
  });
});

test("joystick applies and rescales a radial dead zone", () => {
  assert.deepEqual(normalizeJoystickDisplacement(6, -8, 100, 0.25), {
    forward: 0,
    side: 0,
    knobX: 6,
    knobY: -8,
  });
  assert.deepEqual(normalizeJoystickDisplacement(0, -62.5, 100, 0.25), {
    forward: 0.5,
    side: 0,
    knobX: 0,
    knobY: -62.5,
  });
});

test("joystick sanitizes non-finite displacement components independently", () => {
  assert.deepEqual(normalizeJoystickDisplacement(Number.NaN, -50, 100, 0), {
    forward: 0.5,
    side: 0,
    knobX: 0,
    knobY: -50,
  });
  assert.deepEqual(normalizeJoystickDisplacement(25, Number.POSITIVE_INFINITY, 100, 0), {
    forward: 0,
    side: 0.25,
    knobX: 25,
    knobY: 0,
  });
});

test("joystick returns neutral output when the radius is not finite and positive", () => {
  const neutral = { forward: 0, side: 0, knobX: 0, knobY: 0 };
  assert.deepEqual(normalizeJoystickDisplacement(20, -10, 0), neutral);
  assert.deepEqual(normalizeJoystickDisplacement(20, -10, -50), neutral);
  assert.deepEqual(normalizeJoystickDisplacement(20, -10, Number.NaN), neutral);
  assert.deepEqual(normalizeJoystickDisplacement(20, -10, Number.POSITIVE_INFINITY), neutral);
});

test("joystick bounds the dead zone and defaults non-finite values", () => {
  const defaulted = normalizeJoystickDisplacement(0, -56, 100);
  assert.deepEqual(normalizeJoystickDisplacement(0, -56, 100, Number.NaN), defaulted);
  assert.deepEqual(normalizeJoystickDisplacement(0, -56, 100, Number.POSITIVE_INFINITY), defaulted);
  assert.deepEqual(
    normalizeJoystickDisplacement(30, -40, 100, -1),
    normalizeJoystickDisplacement(30, -40, 100, 0)
  );
  assert.deepEqual(normalizeJoystickDisplacement(30, -40, 100, 2), {
    forward: 0,
    side: 0,
    knobX: 30,
    knobY: -40,
  });
});

test("joystick canonicalizes neutral values to positive zero", () => {
  assert.deepEqual(normalizeJoystickDisplacement(-0, -0, 100, 0), {
    forward: 0,
    side: 0,
    knobX: 0,
    knobY: 0,
  });
});
