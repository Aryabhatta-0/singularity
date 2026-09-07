import assert from "node:assert/strict";
import test from "node:test";
import {
  CHALLENGE,
  COURSE_DEFINITIONS,
  FINAL_ALIGNMENT_THRESHOLD,
  SIMULATION_HZ,
  courseFor,
  finalAlignment,
  groundAt,
  hazardX,
  isFinalAligned,
  isNextFinalStepAligned,
  platformCenter,
} from "../shared/course.ts";

function legacyPlatformCenter(challenge: number, z: number, ticks: number) {
  if (challenge === CHALLENGE.Medium && z > 80 && z < 91) return Math.sin(ticks / SIMULATION_HZ * 0.9) * 1.15;
  if (challenge === CHALLENGE.Difficult && z > 21 && z < 35) return Math.sin(ticks / SIMULATION_HZ * 0.75 + Math.floor((z - 21) / 4) * 1.7) * 1.35;
  if (challenge === CHALLENGE.Difficult && z > 46 && z < 63) return Math.sin(ticks / SIMULATION_HZ * 1.05 + Math.floor((z - 46) / 4) * 1.4) * 1.1;
  return 0;
}

function legacyHazardX(challenge: number, index: number, ticks: number) {
  const speeds = challenge === CHALLENGE.Medium ? [1.45, 1.9] : challenge === CHALLENGE.Difficult ? [1.7, 2.15] : [1.8];
  const amplitudes = challenge === CHALLENGE.Difficult ? [3.8, 3.2] : [3.6, 3.15];
  return Math.sin(ticks / SIMULATION_HZ * speeds[index % speeds.length] + index * 1.3) * amplitudes[index % amplitudes.length];
}

function legacyGroundAt(challenge: number, x: number, z: number, ticks = 0) {
  if (challenge < CHALLENGE.Easy || challenge > CHALLENGE.Difficult) return -30;
  if (challenge === CHALLENGE.Easy) {
    if (z > 7 && z < 15) return Math.abs(x) < 1.3 ? 0 : -30;
    return Math.abs(x) < 4.6 && z > -5 && z < 65 ? 0 : -30;
  }
  if (challenge === CHALLENGE.Medium) {
    if (z > 34 && z < 49) return Math.abs(x) < 2.15 ? 0 : -30;
    if (z >= 50 && z < 66) {
      const center = Math.sin(z * 0.72) * 0.72;
      return Math.abs(x - center) < 1.18 ? 0 : -30;
    }
    if (z > 80 && z < 91) return Math.abs(x - legacyPlatformCenter(challenge, z, ticks)) < 1.7 ? 0 : -30;
    return Math.abs(x) < 4.8 && z > -5 && z < 109 ? 0 : -30;
  }
  if (z > 9 && z <= 21) {
    const step = Math.min(4, Math.max(0, Math.floor((z - 9) / 3)));
    return Math.abs(x) < 2.2 ? step * 0.48 : -30;
  }
  if ((z > 21 && z < 35) || (z > 46 && z < 63)) return Math.abs(x - legacyPlatformCenter(challenge, z, ticks)) < 1.55 ? (z < 35 ? 1.92 : 0.35) : -30;
  if (z > 35 && z <= 46) return Math.abs(x) < 2.45 ? 0.35 : -30;
  return Math.abs(x) < 4.8 && z > -5 && z < 113 ? 0 : -30;
}

test("course definitions own ordered payload, hazard, and platform truth", () => {
  assert.deepEqual(COURSE_DEFINITIONS.map(course => course.payloads.map(payload => payload.spawn)), [
    [[0, 0.45, 19]],
    [[0, 0.45, 25]],
    [[0, 0.65, 39], [0, 0.65, 76]],
  ]);
  assert.deepEqual(COURSE_DEFINITIONS.map(course => course.payloads.map(payload => payload.dock)), [
    [[0, 0.45, 25.7]],
    [[0, 0.45, 76.2]],
    [[-1.55, 0.65, 70.5], [1.55, 0.65, 92.2]],
  ]);
  assert.deepEqual(COURSE_DEFINITIONS.map(course => course.hazards.map(hazard => hazard.z)), [[42.5], [41, 58], [29, 54]]);
  assert.deepEqual(COURSE_DEFINITIONS.map(course => course.platformBands.flatMap(band => band.renderZ)), [[], [82, 85.5, 89], [23, 27, 31.5, 48, 52.5, 57, 61]]);
  for (const course of COURSE_DEFINITIONS) {
    assert.ok(course.foundations.every(foundation => groundAt(course.id, 0, foundation.centerZ) > -20));
    assert.ok(course.payloads.every(payload => payload.settleRadius > 0 && payload.approachRadius >= payload.releaseRadius));
    assert.ok(course.hazards.every(hazard => hazard.hitHalfExtents.every(value => value > 0)));
  }
});

test("one launch-window query serves simulation, rendering, and HUD callers", () => {
  assert.equal(FINAL_ALIGNMENT_THRESHOLD, 0.9);
  for (let ticks = 0; ticks < 300; ticks++) {
    assert.equal(isFinalAligned(ticks), Math.abs(finalAlignment(ticks)) > FINAL_ALIGNMENT_THRESHOLD);
    assert.equal(isNextFinalStepAligned(ticks), isFinalAligned(ticks + 1));
  }
  assert.equal(isFinalAligned(59), false);
  assert.equal(isNextFinalStepAligned(59), true, "input shown after tick 59 is judged on aligned tick 60");
  assert.equal(isFinalAligned(79), true);
  assert.equal(isNextFinalStepAligned(79), false, "input shown after tick 79 is judged on closed tick 80");
  let longestWindow = 0, currentWindow = 0;
  for (let ticks = 1; ticks < 600; ticks++) {
    currentWindow = isFinalAligned(ticks) ? currentWindow + 1 : 0;
    longestWindow = Math.max(longestWindow, currentWindow);
  }
  assert.ok(longestWindow >= 20, `launch window lasted only ${longestWindow} simulation ticks`);
});

test("course motion queries preserve the deterministic ruleset", () => {
  for (const course of COURSE_DEFINITIONS) {
    for (const ticks of [0, 1, 17, 30, 91, 300]) {
      for (const z of [-1, 22, 29, 48, 54, 82, 89]) {
        assert.equal(platformCenter(course.id, z, ticks), legacyPlatformCenter(course.id, z, ticks));
      }
      course.hazards.forEach((_, index) => {
        assert.equal(hazardX(course.id, index, ticks), legacyHazardX(course.id, index, ticks));
      });
    }
  }
});

test("course ground queries preserve edge and moving-surface behavior", () => {
  const samples = [-5.01, -5, -4.99, 7, 7.01, 9, 9.01, 15, 21, 21.01, 34, 34.01, 35, 35.01, 46, 46.01, 49, 50, 62.99, 63, 65, 66, 80, 80.01, 91, 108.99, 109, 113];
  for (const course of COURSE_DEFINITIONS) {
    for (const ticks of [0, 37, 133]) {
      for (const z of samples) {
        for (const x of [-5, -2.5, -1.2, 0, 1.2, 2.5, 5]) {
          assert.equal(groundAt(course.id, x, z, ticks), legacyGroundAt(course.id, x, z, ticks));
        }
      }
    }
  }
  assert.equal(courseFor(999), COURSE_DEFINITIONS[CHALLENGE.Easy]);
});
