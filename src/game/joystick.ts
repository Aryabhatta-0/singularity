export interface NormalizedJoystickDisplacement {
  forward: number;
  side: number;
  knobX: number;
  knobY: number;
}

export interface FloatingJoystickOrigin {
  x: number;
  y: number;
}

/** Position a floating joystick exactly under the initiating pointer. */
export function floatingJoystickOrigin(clientX: number, clientY: number, zoneLeft: number, zoneTop: number): FloatingJoystickOrigin {
  return {
    x: clientX - zoneLeft,
    y: clientY - zoneTop,
  };
}

export function normalizeJoystickDisplacement(
  x: number,
  y: number,
  radius: number,
  deadZone = 0.12
): NormalizedJoystickDisplacement {
  if (!Number.isFinite(radius) || radius <= 0) {
    return { forward: 0, side: 0, knobX: 0, knobY: 0 };
  }
  const finiteDeadZone = Number.isFinite(deadZone) ? deadZone : 0.12;
  const boundedDeadZone = Math.min(1, Math.max(0, finiteDeadZone));
  const safeX = Number.isFinite(x) ? x : 0;
  const safeY = Number.isFinite(y) ? y : 0;
  const distance = Math.hypot(safeX, safeY);
  const scale = distance > radius ? radius / distance : 1;
  const scaledX = safeX * scale;
  const scaledY = safeY * scale;
  // Canonicalize -0 to +0 so downstream strict-equality and deepEqual checks see a stable neutral.
  const knobX = scaledX + 0;
  const knobY = scaledY + 0;
  const knobDistance = Math.hypot(knobX, knobY);
  const normalizedDistance = knobDistance / radius;
  if (normalizedDistance <= boundedDeadZone || boundedDeadZone >= 1) {
    return { forward: 0, side: 0, knobX, knobY };
  }
  const outputMagnitude = (normalizedDistance - boundedDeadZone) / (1 - boundedDeadZone);
  return {
    forward: knobY === 0 ? 0 : (-knobY / knobDistance) * outputMagnitude,
    side: knobX === 0 ? 0 : (knobX / knobDistance) * outputMagnitude,
    knobX,
    knobY,
  };
}
