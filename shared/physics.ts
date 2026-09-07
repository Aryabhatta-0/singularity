import {
  CHALLENGE,
  SIMULATION_HZ,
  challengeFor,
  courseFor,
  finalAlignment,
  groundAt,
  hazardX,
  isChallenge,
  isCrewSize,
  isFinalAligned,
  isNextFinalStepAligned,
  platformCenter,
  type ChallengeId,
  type CrewSize,
} from "./course.ts";

export {
  CHALLENGE,
  CHALLENGES,
  COURSE,
  COURSE_DEFINITIONS,
  CREW_SIZES,
  challengeFor,
  courseFor,
  finalAlignment,
  groundAt,
  hazardX,
  isChallenge,
  isCrewSize,
  isFinalAligned,
  isNextFinalStepAligned,
  platformCenter,
} from "./course.ts";
export type { Challenge, ChallengeId, CourseDefinition, CrewSize, Stage, StageKind } from "./course.ts";

export const DT = 1 / SIMULATION_HZ;
export const RULESET = 4;

const LEG_TARGET_SPEED = 5.2;
const GROUNDED_DRIVE_RESPONSE = 0.32;
const GROUNDED_BRAKE_RESPONSE = 0.48;
const BRACED_DRIVE_RESPONSE = 0.38;
const BRACED_BRAKE_RESPONSE = 0.62;
const AIRBORNE_DRIVE_RESPONSE = 0.07;
const STRIDE_UP_VELOCITY = 10;
const STRIDE_FORWARD_VELOCITY = 0.85;
const HOLD_OBJECTIVE_KINDS = ["switches", "balance", "climb", "unstable", "finalTiming"] as const;

export type RoleDefinition = {
  name: string;
  help: string;
  action: string;
  icon: string;
};

const THREE_PLAYER_ROLES: readonly RoleDefinition[] = [
  { name: "Arms", help: "WASD moves both arms · hold ACT to grip with both hands", action: "GRIP", icon: "↔" },
  { name: "Torso", help: "WASD shifts balance · hold ACT to brace or bend", action: "BRACE", icon: "▥" },
  { name: "Legs", help: "WASD drives both feet · ACT hops or holds both switches", action: "STEP", icon: "⌁" },
];

const FIVE_PLAYER_ROLES: readonly RoleDefinition[] = [
  { name: "Left Hand", help: "WASD moves the left hand · hold ACT to grip", action: "L GRIP", icon: "L↔" },
  { name: "Right Hand", help: "WASD moves the right hand · hold ACT to grip", action: "R GRIP", icon: "↔R" },
  { name: "Torso", help: "WASD shifts balance · hold ACT to brace or bend", action: "BRACE", icon: "▥" },
  { name: "Left Leg", help: "WASD drives the left foot · ACT hops or holds its switch", action: "L STEP", icon: "L⌁" },
  { name: "Right Leg", help: "WASD drives the right foot · ACT hops or holds its switch", action: "R STEP", icon: "⌁R" },
];

export function rolesFor(value: number): readonly RoleDefinition[] {
  return value === 3 ? THREE_PLAYER_ROLES : FIVE_PLAYER_ROLES;
}

export type Input = { x: number; z: number; action: boolean };
export type Node = { x: number; y: number; z: number; px: number; py: number; pz: number };
export type Body = {
  version: number;
  challenge: ChallengeId;
  crewSize: CrewSize;
  nodes: Node[];
  objects: Node[];
  placed: boolean[];
  handGrip: number[];
  stage: number;
  falls: number;
  mistakes: number;
  penaltyMs: number;
  ticks: number;
  finished: boolean;
  look: number;
  charge: number;
  feet: number[];
  brace: boolean;
  bend: boolean;
  previousActions: boolean[];
  hazardContacts: boolean[];
  lockout: number;
  syncStarted: boolean;
};

export type SnapshotExpectation = {
  version?: number;
  challenge?: number;
  crewSize?: number;
};

export type SnapshotDecodeResult =
  | { ok: true; body: Body }
  | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isNonNegativeInteger = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 0;

function snapshotError(value: unknown, expected: SnapshotExpectation): string | undefined {
  if (!isRecord(value)) return "Snapshot must be an object.";
  const challenge = value.challenge;
  const crewSize = value.crewSize;
  if (value.version !== RULESET) return "Snapshot ruleset is incompatible.";
  if (!isFiniteNumber(challenge) || !isChallenge(challenge)) return "Snapshot challenge is invalid.";
  if (!isFiniteNumber(crewSize) || !isCrewSize(crewSize)) return "Snapshot crew size is invalid.";
  if (expected.version !== undefined && value.version !== expected.version) return "Snapshot does not match the room ruleset.";
  if (expected.challenge !== undefined && challenge !== expected.challenge) return "Snapshot does not match the room challenge.";
  if (expected.crewSize !== undefined && crewSize !== expected.crewSize) return "Snapshot does not match the room crew size.";

  const course = courseFor(challenge);
  if (!Array.isArray(value.nodes) || value.nodes.length !== 6) return "Snapshot body nodes are invalid.";
  if (!Array.isArray(value.objects) || value.objects.length !== course.payloads.length) return "Snapshot payload nodes are invalid.";
  for (const point of [...value.nodes, ...value.objects]) {
    if (!isRecord(point) || ![point.x, point.y, point.z, point.px, point.py, point.pz].every(isFiniteNumber)) return "Snapshot contains a non-finite node.";
  }
  if (!Array.isArray(value.placed) || value.placed.length !== course.payloads.length || !value.placed.every(item => typeof item === "boolean")) return "Snapshot payload placement is invalid.";
  if (!Array.isArray(value.handGrip) || value.handGrip.length !== 2 || !value.handGrip.every(item => Number.isInteger(item) && Number(item) >= -1 && Number(item) < course.payloads.length)) return "Snapshot hand grip state is invalid.";
  if (!Array.isArray(value.feet) || value.feet.length !== 2 || !value.feet.every(item => isFiniteNumber(item) && item >= 0 && item <= 1)) return "Snapshot foot state is invalid.";
  if (!Array.isArray(value.previousActions) || value.previousActions.length !== crewSize || !value.previousActions.every(item => typeof item === "boolean")) return "Snapshot action history is invalid.";
  if (!Array.isArray(value.hazardContacts) || value.hazardContacts.length !== course.hazards.length || !value.hazardContacts.every(item => typeof item === "boolean")) return "Snapshot hazard contact state is invalid.";

  if (!isNonNegativeInteger(value.stage) || value.stage > course.stages.length) return "Snapshot stage is invalid.";
  if (!isNonNegativeInteger(value.falls) || !isNonNegativeInteger(value.mistakes) || !isNonNegativeInteger(value.penaltyMs) || !isNonNegativeInteger(value.ticks) || !isNonNegativeInteger(value.lockout)) return "Snapshot counters are invalid.";
  if (!isFiniteNumber(value.look) || !isFiniteNumber(value.charge) || value.charge < 0 || value.charge > 1) return "Snapshot pose state is invalid.";
  if (![value.finished, value.brace, value.bend, value.syncStarted].every(item => typeof item === "boolean")) return "Snapshot flags are invalid.";
  if (value.finished !== (value.stage === course.stages.length)) return "Snapshot completion state is inconsistent.";
  return undefined;
}

export function decodeSnapshot(serialized: string, expected: SnapshotExpectation = {}): SnapshotDecodeResult {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return { ok: false, error: "Snapshot is not valid JSON." };
  }
  const error = snapshotError(value, expected);
  return error ? { ok: false, error } : { ok: true, body: value as Body };
}

export function encodeSnapshot(body: Body): string {
  const error = snapshotError(body, {});
  if (error) throw new Error(`Cannot encode invalid snapshot: ${error}`);
  return JSON.stringify(body);
}

type CanonicalInputs = {
  hands: [Input, Input];
  torso: Input;
  legs: [Input, Input];
};

export const neutralInput = (): Input => ({ x: 0, z: 0, action: false });
export const neutralInputs = (crewSize: number = 5): Input[] => rolesFor(crewSize).map(neutralInput);
const node = (x: number, y: number, z: number): Node => ({ x, y, z, px: x, py: y, pz: z });

function spawnBodyNodes(challenge: ChallengeId, z: number, ticks: number) {
  const center = platformCenter(challenge, z, ticks);
  const queriedSurface = groundAt(challenge, center, z, ticks);
  const surface = queriedSurface > -10 ? queriedSurface : 0;
  return [
    node(center, surface + 2, z),
    node(center, surface + 3, z),
    node(center - 1, surface + 2, z),
    node(center + 1, surface + 2, z),
    node(center - 0.45, surface + 0.35, z),
    node(center + 0.45, surface + 0.35, z),
  ];
}

export function createBody(challenge: number = CHALLENGE.Easy, crewSize: number = 5, z?: number): Body {
  const challengeId = isChallenge(challenge) ? challenge : CHALLENGE.Easy;
  const size = isCrewSize(crewSize) ? crewSize : 5;
  const course = courseFor(challengeId);
  const start = z ?? course.stages[0].spawn;
  return {
    version: RULESET,
    challenge: challengeId,
    crewSize: size,
    nodes: spawnBodyNodes(challengeId, start, 0),
    objects: course.payloads.map(({ spawn: [x, y, objectZ] }) => node(x, y, objectZ)),
    placed: course.payloads.map(() => false),
    handGrip: [-1, -1],
    stage: 0,
    falls: 0,
    mistakes: 0,
    penaltyMs: 0,
    ticks: 0,
    finished: false,
    look: 0,
    charge: 0,
    feet: [0, 0],
    brace: false,
    bend: false,
    previousActions: neutralInputs(size).map(() => false),
    hazardContacts: course.hazards.map(() => false),
    lockout: 0,
    syncStarted: false,
  };
}

export const LINKS = [
  [0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1.7], [0, 5, 1.7],
  [4, 5, 0.9], [1, 2, 1.4], [1, 3, 1.4],
] as const;

export const clamp = (v: number, min = -1, max = 1) => Math.max(min, Math.min(max, v));
export const angleDelta = (target: number, current: number) => Math.atan2(Math.sin(target - current), Math.cos(target - current));

function sanitizeInputs(body: Body, raw: Input[]) {
  return neutralInputs(body.crewSize).map((_, i) => ({
    x: Number.isFinite(raw[i]?.x) ? clamp(raw[i].x) : 0,
    z: Number.isFinite(raw[i]?.z) ? clamp(raw[i].z) : 0,
    action: raw[i]?.action === true,
  }));
}

function expandCrewInputs(body: Body, raw: Input[]): CanonicalInputs {
  const inputs = sanitizeInputs(body, raw);
  if (body.crewSize === 3) return { hands: [{ ...inputs[0] }, { ...inputs[0] }], torso: { ...inputs[1] }, legs: [{ ...inputs[2] }, { ...inputs[2] }] };
  return { hands: [{ ...inputs[0] }, { ...inputs[1] }], torso: { ...inputs[2] }, legs: [{ ...inputs[3] }, { ...inputs[4] }] };
}

function integrate(n: Node, fx = 0, fy = 0, fz = 0, planarRetention = 0.9) {
  const vx = (n.x - n.px) * planarRetention, vy = (n.y - n.py) * 0.98, vz = (n.z - n.pz) * planarRetention;
  n.px = n.x; n.py = n.y; n.pz = n.z;
  n.x += vx + fx * DT * DT; n.y += vy + (fy - 15) * DT * DT; n.z += vz + fz * DT * DT;
}

function planarVelocity(n: Node) {
  return { x: (n.x - n.px) / DT, z: (n.z - n.pz) / DT };
}

function setLegTargetVelocity(n: Node, input: Input, grounded: boolean, braced: boolean) {
  const velocity = planarVelocity(n);
  const inputLength = Math.hypot(input.x, input.z);
  const inputScale = inputLength > 1 ? 1 / inputLength : 1;
  const targetX = input.x * inputScale * LEG_TARGET_SPEED;
  const targetZ = input.z * inputScale * LEG_TARGET_SPEED;
  const response = inputLength > 0.01
    ? grounded
      ? braced ? BRACED_DRIVE_RESPONSE : GROUNDED_DRIVE_RESPONSE
      : AIRBORNE_DRIVE_RESPONSE
    : grounded
      ? braced ? BRACED_BRAKE_RESPONSE : GROUNDED_BRAKE_RESPONSE
      : 0;
  if (response <= 0) return;
  const nextX = velocity.x + (targetX - velocity.x) * response;
  const nextZ = velocity.z + (targetZ - velocity.z) * response;
  n.px = n.x - nextX * DT;
  n.pz = n.z - nextZ * DT;
}

function addVelocityImpulse(n: Node, x: number, y: number, z: number) {
  n.px -= x * DT;
  n.py -= y * DT;
  n.pz -= z * DT;
}

function legRoleIndex(body: Body, side: number) {
  return body.crewSize === 3 ? 2 : side + 3;
}

function pin(n: Node, x: number, y: number, z: number, smoothing = 1) {
  const nx = n.x + (x - n.x) * smoothing, ny = n.y + (y - n.y) * smoothing, nz = n.z + (z - n.z) * smoothing;
  n.px += nx - n.x; n.py += ny - n.y; n.pz += nz - n.z;
  n.x = nx; n.y = ny; n.z = nz;
}

function activeObjectIndex(body: Body) {
  const kind = challengeFor(body.challenge).stages[body.stage]?.kind;
  if (body.challenge !== CHALLENGE.Difficult) return 0;
  return kind === "secondLift" || kind === "placeSecond" || body.stage > 7 ? 1 : 0;
}

export function securelyHeld(body: Body, objectIndex = activeObjectIndex(body)) {
  return body.handGrip[0] === objectIndex && body.handGrip[1] === objectIndex;
}

function resetObjectAtCheckpoint(body: Body, objectIndex: number) {
  if (body.placed[objectIndex]) return;
  const stage = challengeFor(body.challenge).stages[body.stage];
  const carrying = ["movingCarry", "narrowCarry", "unstableCarry"].includes(stage?.kind ?? "");
  const spawn = courseFor(body.challenge).payloads[objectIndex].spawn;
  const x = carrying ? platformCenter(body.challenge, stage.spawn + 1.8, body.ticks) : spawn[0];
  const y = carrying ? groundAt(body.challenge, x, stage.spawn + 1.8, body.ticks) + 0.6 : spawn[1];
  const z = carrying ? stage.spawn + 1.8 : spawn[2];
  body.objects[objectIndex] = node(x, y, z);
}

function recover(body: Body) {
  const stage = challengeFor(body.challenge).stages[body.stage];
  body.nodes = spawnBodyNodes(body.challenge, stage?.spawn ?? 0, body.ticks);
  body.falls++;
  body.penaltyMs += challengeFor(body.challenge).fallPenaltyMs;
  body.handGrip = [-1, -1]; body.charge = 0; body.feet = [0, 0]; body.brace = false; body.bend = false; body.lockout = 12;
  body.syncStarted = false;
  body.hazardContacts.fill(false);
  body.objects.forEach((_, index) => resetObjectAtCheckpoint(body, index));
}

function movingPlatformDelta(body: Body, point: Node, maxHeight: number) {
  const band = courseFor(body.challenge).platformBands.find(candidate =>
    point.z > candidate.minZ && point.z < candidate.maxZ
  );
  if (!band || point.y < band.groundY - 0.1 || point.y > band.groundY + maxHeight) return undefined;
  const previousCenter = platformCenter(body.challenge, point.z, body.ticks - 1);
  if (Math.abs(point.x - previousCenter) > band.halfWidth + 0.12) return undefined;
  return platformCenter(body.challenge, point.z, body.ticks) - previousCenter;
}

function carryMovingSupports(body: Body) {
  const footDeltas = body.nodes
    .slice(4)
    .map(foot => movingPlatformDelta(body, foot, 0.46))
    .filter((value): value is number => value !== undefined);
  if (footDeltas.length > 0) {
    const delta = footDeltas.reduce((sum, value) => sum + value, 0) / footDeltas.length;
    for (const point of body.nodes) {
      point.x += delta;
      point.px += delta;
    }
  }
  for (let index = 0; index < body.objects.length; index++) {
    if (body.placed[index] || body.handGrip.includes(index)) continue;
    const object = body.objects[index];
    const delta = movingPlatformDelta(body, object, 0.62);
    if (delta === undefined) continue;
    object.x += delta;
    object.px += delta;
  }
}

function advance(body: Body) {
  body.stage++;
  body.charge = 0;
  body.feet = [0, 0];
  body.syncStarted = false;
  body.finished = body.stage === challengeFor(body.challenge).stages.length;
}

function applyGate(body: Body, gate: number) {
  const torso = body.nodes[0];
  if (torso.z <= gate) return;
  const dz = torso.z - gate;
  for (const point of body.nodes) { point.z -= dz; point.pz = point.z; }
}

function relayReady(body: Body, z: number, actions: [boolean, boolean]) {
  return [0, 1].every(side => {
    const hand = body.nodes[side + 2];
    const x = side === 0 ? -0.9 : 0.9;
    return actions[side] && Math.hypot(hand.x - x, hand.z - z) < 1.45;
  });
}

function allPilotActions(body: Body, inputs: Input[]) {
  return inputs.length === body.crewSize && inputs.every(input => input.action);
}

function updateObjects(body: Body, controls: CanonicalInputs) {
  const hands = [body.nodes[2], body.nodes[3]];
  for (let side = 0; side < 2; side++) {
    if (!controls.hands[side].action) body.handGrip[side] = -1;
    const held = body.handGrip[side];
    if (held >= 0 && body.placed[held]) body.handGrip[side] = -1;
    if (body.handGrip[side] < 0 && controls.hands[side].action) {
      const candidate = body.objects
        .map((object, index) => ({ index, distance: body.placed[index] ? Infinity : Math.hypot(hands[side].x - object.x, hands[side].y - object.y, hands[side].z - object.z) }))
        .sort((a, b) => a.distance - b.distance || a.index - b.index)[0];
      if (candidate && candidate.distance < 1.65) body.handGrip[side] = candidate.index;
    }
  }
  if (controls.hands.every(input => input.action)) {
    const midpoint = {
      x: (hands[0].x + hands[1].x) / 2,
      y: (hands[0].y + hands[1].y) / 2,
      z: (hands[0].z + hands[1].z) / 2,
    };
    const shared = body.objects
      .map((object, index) => ({ index, distance: body.placed[index] ? Infinity : Math.hypot(midpoint.x - object.x, midpoint.y - object.y, midpoint.z - object.z) }))
      .sort((a, b) => a.distance - b.distance || a.index - b.index)[0];
    if (shared && shared.distance < 1.9) body.handGrip = [shared.index, shared.index];
  }
  for (let index = 0; index < body.objects.length; index++) {
    const object = body.objects[index];
    if (body.placed[index]) {
      const dock = courseFor(body.challenge).payloads[index].dock;
      pin(object, dock[0], dock[1], dock[2]);
      continue;
    }
    const gripping = [0, 1].filter(side => body.handGrip[side] === index);
    if (gripping.length === 2) {
      const left = hands[0], right = hands[1];
      pin(object, (left.x + right.x) / 2, Math.min(left.y, right.y) - 0.36, (left.z + right.z) / 2 + 0.5, 0.82);
    } else if (gripping.length === 1) {
      integrate(object);
      const hand = hands[gripping[0]];
      pin(object, hand.x, hand.y - 0.48, hand.z + 0.42, 0.22);
    } else integrate(object);
    const floor = groundAt(body.challenge, object.x, object.z, body.ticks) + 0.45;
    if (object.y < floor && floor > -20) { object.y = floor; object.py = floor; }
  }
}

function applyHazards(body: Body) {
  const torso = body.nodes[0];
  for (const [index, hazard] of courseFor(body.challenge).hazards.entries()) {
    const { z } = hazard;
    const x = hazardX(body.challenge, index, body.ticks);
    const overlapping = Math.abs(torso.z - z) <= hazard.hitHalfExtents[1] &&
      Math.abs(torso.x - x) <= hazard.hitHalfExtents[0];
    if (!overlapping) {
      body.hazardContacts[index] = false;
      continue;
    }
    if (body.hazardContacts[index]) continue;
    body.hazardContacts[index] = true;
    const direction = Math.sign(torso.x - x) || Math.sign(Math.cos(body.ticks * DT)) || 1;
    const lateralVelocity = body.brace ? 1.15 : 3.4;
    const liftVelocity = body.brace ? 0.35 : 1.15;
    for (const point of body.nodes)
      addVelocityImpulse(point, direction * lateralVelocity, liftVelocity, 0);
    if (!body.brace && body.handGrip.some(grip => grip >= 0)) body.handGrip = [-1, -1];
  }
}

function stageProgress(body: Body, crewInputs: Input[], controls: CanonicalInputs) {
  const course = challengeFor(body.challenge);
  const stage = course.stages[body.stage];
  if (!stage) return;
  const torso = body.nodes[0];
  const nearGate = torso.z > stage.gate - 2 && Math.abs(torso.x - platformCenter(body.challenge, torso.z, body.ticks)) < 2.2 && torso.y > -1;
  const handActions: [boolean, boolean] = [controls.hands[0].action, controls.hands[1].action];
  const legActions: [boolean, boolean] = [controls.legs[0].action, controls.legs[1].action];
  let charging = false, chargeSeconds = 0.8;
  switch (stage.kind) {
    case "relay": charging = relayReady(body, stage.gate, handActions); break;
    case "bridge": charging = nearGate && body.brace && Math.abs(torso.x) < 0.85; break;
    case "delivery": {
      const objectIndex = activeObjectIndex(body), payload = courseFor(body.challenge).payloads[objectIndex], dock = payload.dock, object = body.objects[objectIndex];
      const released = body.handGrip.every(grip => grip !== objectIndex);
      charging = released && Math.hypot(object.x - dock[0], object.z - dock[2]) < payload.settleRadius && object.y < dock[1] + payload.settleHeight;
      if (charging && body.charge + DT / chargeSeconds >= 1) body.placed[objectIndex] = true;
      break;
    }
    case "switches":
      for (let foot = 0; foot < 2; foot++) {
        const point = body.nodes[foot + 4], expectedX = foot === 0 ? -0.45 : 0.45;
        const pressed = nearGate && legActions[foot] && Math.abs(point.x - expectedX) < 0.75 && Math.abs(point.z - stage.gate) < 2.1;
        body.feet[foot] = pressed ? Math.min(1, body.feet[foot] + DT) : 0;
      }
      charging = body.feet.every(value => value >= 0.75); chargeSeconds = 0.2; break;
    case "storm": charging = nearGate && body.brace && relayReady(body, stage.gate, handActions); break;
    case "walk": charging = nearGate && body.nodes.every(point => point.z > stage.gate - 2.7); chargeSeconds = 0.25; break;
    case "duck": charging = nearGate && body.bend && body.nodes[1].y < groundAt(body.challenge, torso.x, torso.z, body.ticks) + 2.72; break;
    case "lift": charging = nearGate && securelyHeld(body, 0); break;
    case "movingCarry":
    case "narrowCarry": charging = nearGate && securelyHeld(body, 0); chargeSeconds = 0.45; break;
    case "balance": charging = nearGate && body.brace && legActions.every(Boolean); break;
    case "climbLatch": charging = relayReady(body, stage.gate, handActions); break;
    case "climb": charging = nearGate && handActions.every(Boolean) && legActions.every(Boolean) && torso.y > 3.1; break;
    case "unstable": charging = nearGate && body.brace && legActions.every(Boolean); break;
    case "precisionLift": charging = nearGate && securelyHeld(body, 0) && Math.abs(body.objects[0].x) < 0.88; chargeSeconds = 1; break;
    case "unstableCarry": charging = nearGate && securelyHeld(body, 0) && body.brace; break;
    case "placeFirst":
    case "placeSecond": {
      const objectIndex = stage.kind === "placeFirst" ? 0 : 1, payload = courseFor(body.challenge).payloads[objectIndex], dock = payload.dock, object = body.objects[objectIndex];
      charging = body.handGrip.every(grip => grip !== objectIndex) && Math.hypot(object.x - dock[0], object.z - dock[2]) < payload.settleRadius && Math.abs(object.y - dock[1]) < payload.settleHeight;
      chargeSeconds = 1.1;
      if (charging && body.charge + DT / chargeSeconds >= 1) body.placed[objectIndex] = true;
      break;
    }
    case "secondLift": charging = nearGate && securelyHeld(body, 1) && Math.abs(body.objects[1].x) < 0.88; break;
    case "finalTiming": {
      const everybody = allPilotActions(body, crewInputs), aligned = isFinalAligned(body.ticks);
      const previouslyTogether = body.previousActions.length === body.crewSize && body.previousActions.every(Boolean);
      if (!everybody) {
        body.syncStarted = false;
        body.charge = 0;
      }
      if (nearGate && everybody && !previouslyTogether && body.lockout <= 0) {
        if (aligned) body.syncStarted = true;
        else {
          body.mistakes++;
          body.penaltyMs += course.timingPenaltyMs;
          body.lockout = 30;
          body.charge = 0;
        }
      }
      charging = nearGate && everybody && body.syncStarted && body.lockout <= 0; chargeSeconds = 0.3; break;
    }
    case "finish":
      if (nearGate && body.nodes.every(point => point.z >= stage.gate - 0.75)) advance(body);
      return;
  }
  if (charging) body.charge = Math.min(1, body.charge + DT / chargeSeconds);
  else body.charge = Math.max(0, body.charge - DT * (stage.kind === "finalTiming" ? 3.5 : 1.8));
  if (body.charge >= 1) advance(body);
}

export function step(body: Body, raw: Input[]) {
  if (body.version !== RULESET) throw new Error("Incompatible race snapshot; start a new match.");
  if (body.finished) return;
  const stage = challengeFor(body.challenge).stages[body.stage];
  const crewInputs = sanitizeInputs(body, raw), controls = expandCrewInputs(body, crewInputs);
  if (body.nodes[0].y < -5 || body.objects.some((object, index) => !body.placed[index] && object.y < -8)) { recover(body); return; }
  body.ticks++; body.lockout = Math.max(0, body.lockout - 1); body.brace = controls.torso.action; body.bend = stage.kind === "duck" && controls.torso.action;
  carryMovingSupports(body);
  const torso = body.nodes[0];
  const canonical = [controls.torso, neutralInput(), controls.hands[0], controls.hands[1], controls.legs[0], controls.legs[1]];
  const stationaryBrace = body.brace &&
    Math.hypot(controls.torso.x, controls.torso.z) < 0.05 &&
    Math.hypot(controls.legs[0].x, controls.legs[0].z) < 0.05 &&
    Math.hypot(controls.legs[1].x, controls.legs[1].z) < 0.05;
  for (let index = 0; index < body.nodes.length; index++) {
    const point = body.nodes[index], input = canonical[index], isHand = index === 2 || index === 3, isLeg = index >= 4;
    const surface = groundAt(body.challenge, point.x, point.z, body.ticks);
    const baseHeight = body.bend ? index === 0 ? 1.35 : index === 1 ? 2.15 : isHand ? 1.45 : 0.35 : index === 0 ? 2 : index === 1 ? 3 : isHand ? 2 : 0.35;
    const target = surface > -10 ? surface + baseHeight : point.y, support = surface > -10;
    const supportStrength = body.brace ? 84 : 70;
    const supportDamping = body.brace ? 160 : 130;
    const fy = support ? (target - point.y) * supportStrength - (point.y - point.py) * supportDamping : 0;
    if (isLeg) {
      const grounded = support && point.y < surface + 0.58;
      setLegTargetVelocity(point, input, grounded, body.brace);
      const side = index - 4;
      const strideAllowed = !HOLD_OBJECTIVE_KINDS.includes(stage.kind as typeof HOLD_OBJECTIVE_KINDS[number]);
      const freshAction = input.action && !body.previousActions[legRoleIndex(body, side)];
      if (strideAllowed && grounded && freshAction) {
        const inputLength = Math.hypot(input.x, input.z);
        const directionScale = inputLength > 0.01 ? 1 / Math.max(1, inputLength) : 0;
        addVelocityImpulse(
          point,
          input.x * directionScale * STRIDE_FORWARD_VELOCITY,
          STRIDE_UP_VELOCITY,
          input.z * directionScale * STRIDE_FORWARD_VELOCITY,
        );
      }
    }
    const armRest = isHand ? (torso.x + (index === 2 ? -1 : 1) - point.x) * 6 : 0;
    const fx = (index === 1 || isLeg ? 0 : input.x * (index === 0 ? 22 : 13)) + armRest;
    const fz = index === 1 || isLeg ? 0 : input.z * (index === 0 ? 8 : 9);
    integrate(point, fx, fy, fz, isLeg ? 1 : stationaryBrace ? 0.84 : 0.9);
  }
  const travelX = clamp(controls.torso.x * 0.45 + controls.legs[0].x * 0.2 + controls.legs[1].x * 0.2);
  body.look = angleDelta(Math.atan2(travelX, 1), body.look) * 0.08 + body.look;
  if (body.challenge === CHALLENGE.Easy && torso.z > 7 && torso.z < 15) {
    const wind = Math.sin(body.ticks * DT * 2) * (body.brace ? 0.001 : 0.018);
    body.nodes[0].x += wind; body.nodes[1].x += wind;
  }
  applyHazards(body);
  for (let pass = 0; pass < 7; pass++) {
    for (const [a, c, length] of LINKS) {
      const p = body.nodes[a], q = body.nodes[c], dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
      const distance = Math.hypot(dx, dy, dz) || 1, correction = ((distance - length) / distance) * 0.5;
      p.x += dx * correction; p.y += dy * correction; p.z += dz * correction;
      q.x -= dx * correction; q.y -= dy * correction; q.z -= dz * correction;
    }
    for (const point of body.nodes) {
      const floor = groundAt(body.challenge, point.x, point.z, body.ticks) + 0.25;
      if (floor > -20 && point.y < floor) { point.y = floor; point.py = floor; }
    }
  }
  updateObjects(body, controls);
  const oldStage = body.stage;
  stageProgress(body, crewInputs, controls);
  if (body.stage === oldStage) applyGate(body, stage.gate);
  body.previousActions = crewInputs.map(input => input.action);
  if (!body.finished && (body.nodes[0].y < -5 || body.objects.some((object, index) => !body.placed[index] && object.y < -8))) recover(body);
}

function targetForStage(body: Body) {
  const stage = challengeFor(body.challenge).stages[body.stage], objectIndex = activeObjectIndex(body), object = body.objects[objectIndex], payload = courseFor(body.challenge).payloads[objectIndex], dock = payload.dock;
  const placing = ["delivery", "placeFirst", "placeSecond"].includes(stage.kind);
  const objectAtDock = Math.hypot(object.x - dock[0], object.z - dock[2]) < payload.approachRadius;
  const needsObject = !securelyHeld(body, objectIndex) && (["lift", "precisionLift", "secondLift"].includes(stage.kind) || (placing && !objectAtDock));
  const targetZ = needsObject ? object.z : placing && securelyHeld(body, objectIndex) ? dock[2] : stage.gate;
  const targetX = placing && securelyHeld(body, objectIndex) ? dock[0] : platformCenter(body.challenge, body.nodes[0].z + 2.5, body.ticks);
  return { stage, objectIndex, object, payload, dock, targetX, targetZ };
}

export function teammateInputs(body: Body): Input[] {
  const { stage, objectIndex, object, payload, dock, targetX, targetZ } = targetForStage(body), torso = body.nodes[0];
  const nearGate = torso.z > stage.gate - 2.3, secure = securelyHeld(body, objectIndex);
  const objectAtDock = Math.hypot(object.x - dock[0], object.z - dock[2]) < payload.approachRadius;
  const liftStage = ["lift", "precisionLift", "secondLift"].includes(stage.kind);
  const placing = ["delivery", "placeFirst", "placeSecond"].includes(stage.kind);
  const acquiring = !secure && (liftStage || (placing && !objectAtDock));
  const carrying = secure && (placing || liftStage || ["movingCarry", "narrowCarry", "unstableCarry"].includes(stage.kind));
  const readyToRelease = placing && secure && Math.hypot(object.x - dock[0], object.z - dock[2]) < payload.releaseRadius;
  const desiredZ = acquiring ? object.z - 0.25 : carrying && placing ? dock[2] - 0.65 : targetZ;
  const desiredX = acquiring ? object.x : carrying && placing ? dock[0] : targetX;
  const steer = clamp((desiredX - torso.x) * 1.25);
  let forward = clamp((desiredZ - torso.z) * 0.8, -0.65, 1);
  if (nearGate && !["finish", "walk"].includes(stage.kind)) forward = Math.min(forward, 0.28);
  const torsoAction = ["bridge", "duck", "storm", "balance", "unstable", "unstableCarry"].includes(stage.kind);
  const handInputs = [0, 1].map(side => {
    const hand = body.nodes[side + 2];
    let x = clamp((desiredX + (side === 0 ? -0.3 : 0.3) - hand.x) * 1.2), z = clamp((desiredZ - hand.z) * 1.1), action = false;
    if (["relay", "storm", "climbLatch"].includes(stage.kind)) {
      const relayX = side === 0 ? -0.9 : 0.9;
      x = clamp((relayX - hand.x) * 1.4); z = clamp((stage.gate - hand.z) * 1.2); action = true;
    } else if (stage.kind === "climb") {
      x = clamp(((side === 0 ? -0.7 : 0.7) - hand.x) * 1.1); z = forward; action = true;
    } else if ((acquiring || carrying || ["movingCarry", "narrowCarry", "unstableCarry"].includes(stage.kind)) && !readyToRelease) action = true;
    else if (placing && !secure) {
      action = false; x = clamp((dock[0] + (side === 0 ? -0.3 : 0.3) - hand.x) * 1.1); z = clamp((dock[2] - hand.z) * 1.1);
    }
    return { x, z, action };
  }) as [Input, Input];
  const finalReady = stage.kind === "finalTiming" && isAtFinaleGate(body) && isNextFinalStepAligned(body.ticks);
  if (stage.kind === "finalTiming") handInputs.forEach(input => { input.action = finalReady; });
  const legAction = ["switches", "balance", "climb", "unstable"].includes(stage.kind) || finalReady;
  const legs: [Input, Input] = [{ x: steer, z: forward, action: legAction }, { x: steer, z: forward, action: legAction }];
  const torsoInput: Input = { x: steer, z: forward * 0.2, action: torsoAction || finalReady };
  if (body.crewSize === 3) return [{ x: (handInputs[0].x + handInputs[1].x) / 2, z: (handInputs[0].z + handInputs[1].z) / 2, action: handInputs[0].action && handInputs[1].action }, torsoInput, { x: steer, z: forward, action: legAction }];
  return [handInputs[0], handInputs[1], torsoInput, legs[0], legs[1]];
}

export function practiceInputs(body: Body, role: number, input: Input): Input[] {
  const result = teammateInputs(body);
  if (role >= 0 && role < result.length) result[role] = { ...input };
  return result;
}

/** Whether the body is inside the same spatial finale gate used by the simulation. */
export function isAtFinaleGate(body: Body) {
  const stage = challengeFor(body.challenge).stages[body.stage];
  if (stage?.kind !== "finalTiming") return false;
  const torso = body.nodes[0];
  return torso.z > stage.gate - 2 &&
    Math.abs(torso.x - platformCenter(body.challenge, torso.z, body.ticks)) < 2.2 &&
    torso.y > -1;
}

export function finaleNeedsRelease(body: Body) {
  const stage = challengeFor(body.challenge).stages[body.stage];
  return stage?.kind === "finalTiming" &&
    body.previousActions.length === body.crewSize &&
    body.previousActions.every(Boolean);
}

/** Whether a fresh ACT edge submitted now can start the finale synchronization. */
export function isFinaleInputWindow(body: Body) {
  return isAtFinaleGate(body) &&
    !body.syncStarted &&
    body.lockout <= 0 &&
    !finaleNeedsRelease(body) &&
    isNextFinalStepAligned(body.ticks);
}

export function stageProgressValue(body: Body) {
  const stage = challengeFor(body.challenge).stages[body.stage];
  return stage?.kind === "switches" ? Math.min(...body.feet) : body.charge;
}

export function elapsedMs(body: Body) {
  return Math.round(body.ticks * 1000 / 30) + body.penaltyMs;
}

export function formatTime(ms: number) {
  const minutes = Math.floor(ms / 60000).toString().padStart(2, "0");
  const seconds = ((ms % 60000) / 1000).toFixed(3).padStart(6, "0");
  return `${minutes}:${seconds}`;
}
