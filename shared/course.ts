export const SIMULATION_HZ = 30;
export const FINAL_ALIGNMENT_THRESHOLD = 0.9;

export const CHALLENGE = { Easy: 0, Medium: 1, Difficult: 2 } as const;
export type ChallengeId = (typeof CHALLENGE)[keyof typeof CHALLENGE];
export type CrewSize = 3 | 5;
export const CREW_SIZES = [3, 5] as const;

export type StageKind =
  | "relay"
  | "bridge"
  | "delivery"
  | "switches"
  | "storm"
  | "finish"
  | "walk"
  | "duck"
  | "lift"
  | "movingCarry"
  | "narrowCarry"
  | "balance"
  | "climbLatch"
  | "climb"
  | "unstable"
  | "precisionLift"
  | "unstableCarry"
  | "placeFirst"
  | "secondLift"
  | "placeSecond"
  | "finalTiming";

export type Stage = {
  name: string;
  hint: string;
  gate: number;
  spawn: number;
  kind: StageKind;
};

export type Challenge = {
  id: ChallengeId;
  difficulty: "Easy" | "Medium" | "Difficult";
  name: string;
  environment: string;
  summary: string;
  accent: string;
  fallPenaltyMs: number;
  timingPenaltyMs: number;
  stages: readonly Stage[];
};

export type CoursePalette = {
  background: number;
  fog: number;
  floor: number;
  dark: number;
  signal: number;
  hazard: number;
  hemisphere: number;
  label: string;
};

export type PayloadDefinition = {
  spawn: readonly [x: number, y: number, z: number];
  dock: readonly [x: number, y: number, z: number];
  label: string;
  settleRadius: number;
  settleHeight: number;
  approachRadius: number;
  releaseRadius: number;
};

export type HazardDefinition = {
  z: number;
  y: number;
  size: readonly [width: number, height: number, depth: number];
  speed: number;
  amplitude: number;
  phase: number;
  hitHalfExtents: readonly [x: number, z: number];
};

export type FoundationDefinition = {
  centerZ: number;
  depth: number;
  width: number;
  centerY: number;
};

export type PlatformBand = {
  minZ: number;
  maxZ: number;
  halfWidth: number;
  groundY: number;
  speed: number;
  amplitude: number;
  phaseStep: number;
  phaseStride: number;
  renderY: number;
  renderSize: readonly [width: number, height: number, depth: number];
  renderZ: readonly number[];
};

export type CourseDefinition = Challenge & {
  length: number;
  debrisSeed: number;
  palette: CoursePalette;
  payloads: readonly PayloadDefinition[];
  hazards: readonly HazardDefinition[];
  foundations: readonly FoundationDefinition[];
  platformBands: readonly PlatformBand[];
};

export const COURSE_DEFINITIONS = [
  {
    id: CHALLENGE.Easy,
    difficulty: "Easy",
    name: "Suspended Disbelief",
    environment: "Orbital training facility / Sector 07",
    summary: "Learn the body: relays, balance, one careful delivery, and a clean finish.",
    accent: "#91dfc5",
    fallPenaltyMs: 3000,
    timingPenaltyMs: 0,
    length: 65,
    debrisSeed: 0,
    palette: { background: 0x12212b, fog: 0x12212b, floor: 0xcedbd5, dark: 0x273b45, signal: 0x96e9cd, hazard: 0xff806e, hemisphere: 0xd7f8ff, label: "#c5f8e9" },
    payloads: [{ spawn: [0, 0.45, 19], dock: [0, 0.45, 25.7], label: "cargo drop", settleRadius: 1.8, settleHeight: 0.5, approachRadius: 1.1, releaseRadius: 0.7 }],
    hazards: [{ z: 42.5, y: 1.1, size: [0.62, 1.1, 7], speed: 1.8, amplitude: 3.6, phase: 0, hitHalfExtents: [0.78, 1.65] }],
    foundations: [
      { centerZ: 1, depth: 12, width: 9.2, centerY: -0.4 },
      { centerZ: 21, depth: 12, width: 9.2, centerY: -0.4 },
      { centerZ: 46, depth: 38, width: 9.2, centerY: -0.4 },
    ],
    platformBands: [],
    stages: [
      { name: "First contact", hint: "Both hands: touch the amber relay and hold grip together", gate: 5, spawn: 0, kind: "relay" },
      { name: "Hold the line", hint: "Torso: brace at the far end of the windy bridge", gate: 16, spawn: 6, kind: "bridge" },
      { name: "Special delivery", hint: "Both hands: carry the crate onto the mint pad, then release", gate: 26, spawn: 17, kind: "delivery" },
      { name: "Two to tango", hint: "Both feet: hold your switches at the same time", gate: 33, spawn: 28, kind: "switches" },
      { name: "Storm watch", hint: "Hands on both relays while Torso braces beyond the sweeper", gate: 47, spawn: 35, kind: "storm" },
      { name: "Home stretch", hint: "Keep your balance and bring the whole body through the finish", gate: 60, spawn: 49, kind: "finish" },
    ],
  },
  {
    id: CHALLENGE.Medium,
    difficulty: "Medium",
    name: "Freight Expectations",
    environment: "Cyclone cargo yard / Monsoon deck",
    summary: "A longer freight run through low gantries, moving sweepers, and a narrow carry lane.",
    accent: "#69d9ff",
    fallPenaltyMs: 5000,
    timingPenaltyMs: 0,
    length: 109,
    debrisSeed: 1.3,
    palette: { background: 0x071f2b, fog: 0x0c3543, floor: 0x6d91a1, dark: 0x163642, signal: 0x69d9ff, hazard: 0xffb45f, hemisphere: 0xc9f7ff, label: "#ccefff" },
    payloads: [{ spawn: [0, 0.45, 25], dock: [0, 0.45, 76.2], label: "power cell dock", settleRadius: 1.15, settleHeight: 0.5, approachRadius: 1.1, releaseRadius: 0.7 }],
    hazards: [
      { z: 41, y: 1.1, size: [0.65, 1.15, 4.2], speed: 1.45, amplitude: 3.6, phase: 0, hitHalfExtents: [0.78, 1.65] },
      { z: 58, y: 1.1, size: [0.65, 1.15, 3.2], speed: 1.9, amplitude: 3.15, phase: 1.3, hitHalfExtents: [0.78, 1.65] },
    ],
    foundations: [
      { centerZ: 13.5, depth: 37, width: 9.6, centerY: -0.42 },
      { centerZ: 41.5, depth: 15, width: 4.3, centerY: -0.42 },
      { centerZ: 72.5, depth: 13, width: 9.6, centerY: -0.42 },
      { centerZ: 99, depth: 18, width: 9.6, centerY: -0.42 },
    ],
    platformBands: [{
      minZ: 80,
      maxZ: 91,
      halfWidth: 1.7,
      groundY: 0,
      speed: 0.9,
      amplitude: 1.15,
      phaseStep: 0,
      phaseStride: 1,
      renderY: -0.28,
      renderSize: [3.35, 0.55, 3],
      renderZ: [82, 85.5, 89],
    }],
    stages: [
      { name: "Walking papers", hint: "Legs set the pace while Torso keeps the body centered", gate: 8, spawn: 0, kind: "walk" },
      { name: "Duckworks", hint: "Torso: hold bend and coordinate a low walk under the pipe rack", gate: 21, spawn: 9, kind: "duck" },
      { name: "Team lift", hint: "Bring both hands to the power cell and grip together", gate: 32, spawn: 22, kind: "lift" },
      { name: "Pendulum passage", hint: "Carry the cell past the moving sweepers without losing either hand", gate: 49, spawn: 33, kind: "movingCarry" },
      { name: "Thread the needle", hint: "Stay on the narrow zig-zag lane and keep the cell secure", gate: 65, spawn: 50, kind: "narrowCarry" },
      { name: "Soft landing", hint: "Lower the cell onto the blue dock and release both hands", gate: 78, spawn: 66, kind: "delivery" },
      { name: "Gimbal walk", hint: "Both feet push while Torso braces across the shifting deck", gate: 90, spawn: 79, kind: "balance" },
      { name: "Clock out", hint: "Bring every part of the body through the cargo gate", gate: 104, spawn: 92, kind: "finish" },
    ],
  },
  {
    id: CHALLENGE.Difficult,
    difficulty: "Difficult",
    name: "The Coordination Tax",
    environment: "Solar foundry / Rupture tower",
    summary: "Climb, cross unstable plates, seat two cores precisely, then commit on the launch beat.",
    accent: "#ff9b73",
    fallPenaltyMs: 8000,
    timingPenaltyMs: 7000,
    length: 113,
    debrisSeed: 2.5,
    palette: { background: 0x210f1b, fog: 0x321523, floor: 0x6e4754, dark: 0x2c1b2b, signal: 0xff9b73, hazard: 0xe84c72, hemisphere: 0xffc2b0, label: "#ffd3c0" },
    payloads: [
      { spawn: [0, 0.65, 39], dock: [-1.55, 0.65, 70.5], label: "CORE A", settleRadius: 0.82, settleHeight: 0.65, approachRadius: 1.1, releaseRadius: 0.7 },
      { spawn: [0, 0.65, 76], dock: [1.55, 0.65, 92.2], label: "CORE B", settleRadius: 0.82, settleHeight: 0.65, approachRadius: 1.1, releaseRadius: 0.7 },
    ],
    hazards: [
      { z: 29, y: 3.1, size: [0.7, 1.4, 3], speed: 1.7, amplitude: 3.8, phase: 0, hitHalfExtents: [0.78, 1.65] },
      { z: 54, y: 1.25, size: [0.7, 1.25, 3], speed: 2.15, amplitude: 3.2, phase: 1.3, hitHalfExtents: [0.78, 1.65] },
    ],
    foundations: [
      { centerZ: 2, depth: 14, width: 9.4, centerY: -0.4 },
      { centerZ: 40.5, depth: 11, width: 9.4, centerY: -0.05 },
      { centerZ: 68, depth: 11, width: 9.4, centerY: -0.4 },
      { centerZ: 77, depth: 7, width: 9.4, centerY: -0.4 },
      { centerZ: 89, depth: 13, width: 9.4, centerY: -0.4 },
      { centerZ: 103, depth: 18, width: 9.4, centerY: -0.4 },
    ],
    platformBands: [
      { minZ: 21, maxZ: 35, halfWidth: 1.55, groundY: 1.92, speed: 0.75, amplitude: 1.35, phaseStep: 1.7, phaseStride: 4, renderY: 1.64, renderSize: [3.05, 0.55, 3.5], renderZ: [23, 27, 31.5] },
      { minZ: 46, maxZ: 63, halfWidth: 1.55, groundY: 0.35, speed: 1.05, amplitude: 1.1, phaseStep: 1.4, phaseStride: 4, renderY: 0.08, renderSize: [3.05, 0.55, 3.5], renderZ: [48, 52.5, 57, 61] },
    ],
    stages: [
      { name: "Wall handshake", hint: "Each hand takes one climbing latch; hold together to unlock the wall", gate: 8, spawn: 0, kind: "climbLatch" },
      { name: "Vertical argument", hint: "Legs climb the staggered blocks while both hands keep contact", gate: 20, spawn: 9, kind: "climb" },
      { name: "Loose orbit", hint: "Cross the unstable plates with both feet active and Torso braced", gate: 34, spawn: 22, kind: "unstable" },
      { name: "Zero margin", hint: "Center both hands precisely on the first reactor core", gate: 45, spawn: 35, kind: "precisionLift" },
      { name: "Shiver carry", hint: "Carry the core across the wandering plates without breaking grip", gate: 62, spawn: 46, kind: "unstableCarry" },
      { name: "Socket one", hint: "Place the first core in the left socket and release cleanly", gate: 72, spawn: 63, kind: "placeFirst" },
      { name: "Second payload", hint: "Coordinate another precise two-hand lift", gate: 82, spawn: 73, kind: "secondLift" },
      { name: "Twin lock", hint: "Carry the second core into the right socket and let go together", gate: 94, spawn: 83, kind: "placeSecond" },
      { name: "Launch window", hint: "Release while waiting. On ALIGN, every pilot presses ACT; when SYNC LOCKED, keep holding", gate: 108, spawn: 96, kind: "finalTiming" },
    ],
  },
] as const satisfies readonly CourseDefinition[];

export const CHALLENGES: readonly Challenge[] = COURSE_DEFINITIONS;
export const COURSE = CHALLENGES[CHALLENGE.Easy].stages;

export function isChallenge(value: number): value is ChallengeId {
  return Number.isInteger(value) && value >= CHALLENGE.Easy && value <= CHALLENGE.Difficult;
}

export function isCrewSize(value: number): value is CrewSize {
  return value === 3 || value === 5;
}

export function courseFor(value: number): CourseDefinition {
  return COURSE_DEFINITIONS[isChallenge(value) ? value : CHALLENGE.Easy];
}

export function challengeFor(value: number): Challenge {
  return courseFor(value);
}

export function platformCenter(challenge: number, z: number, ticks: number) {
  const band = courseFor(challenge).platformBands.find(candidate => z > candidate.minZ && z < candidate.maxZ);
  if (!band) return 0;
  const phase = Math.floor((z - band.minZ) / band.phaseStride) * band.phaseStep;
  return Math.sin(ticks / SIMULATION_HZ * band.speed + phase) * band.amplitude;
}

export function hazardX(challenge: number, index: number, ticks: number) {
  const hazards = courseFor(challenge).hazards;
  const hazard = hazards[index % hazards.length];
  return Math.sin(ticks / SIMULATION_HZ * hazard.speed + hazard.phase) * hazard.amplitude;
}

export function finalAlignment(ticks: number) {
  return Math.cos(ticks / SIMULATION_HZ * 1.35);
}

export function isFinalAligned(ticks: number) {
  return Math.abs(finalAlignment(ticks)) > FINAL_ALIGNMENT_THRESHOLD;
}

/** Whether input submitted after this completed tick will land inside the launch window. */
export function isNextFinalStepAligned(completedTicks: number) {
  return isFinalAligned(completedTicks + 1);
}

export function groundAt(challenge: number, x: number, z: number, ticks = 0) {
  if (!isChallenge(challenge)) return -30;
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
    const platform = courseFor(challenge).platformBands[0];
    if (z > platform.minZ && z < platform.maxZ) return Math.abs(x - platformCenter(challenge, z, ticks)) < platform.halfWidth ? platform.groundY : -30;
    return Math.abs(x) < 4.8 && z > -5 && z < 109 ? 0 : -30;
  }
  if (z > 9 && z <= 21) {
    const step = Math.min(4, Math.max(0, Math.floor((z - 9) / 3)));
    return Math.abs(x) < 2.2 ? step * 0.48 : -30;
  }
  const platform = courseFor(challenge).platformBands.find(candidate => z > candidate.minZ && z < candidate.maxZ);
  if (platform) return Math.abs(x - platformCenter(challenge, z, ticks)) < platform.halfWidth ? platform.groundY : -30;
  if (z > 35 && z <= 46) return Math.abs(x) < 2.45 ? 0.35 : -30;
  return Math.abs(x) < 4.8 && z > -5 && z < 113 ? 0 : -30;
}
