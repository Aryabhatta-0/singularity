import type { BodyInputs } from "./body";
import { InputManager, inputsEqual, type SoloChannel, type SoloVirtualAction, type VirtualAction } from "./input";
import {
  floatingJoystickOrigin,
  normalizeJoystickDisplacement,
  type FloatingJoystickOrigin,
  type NormalizedJoystickDisplacement,
} from "./joystick";
import {
  collectRemoteInputs,
  neutralInputsForRoles,
  replaceRemoteInputs,
  type RemoteInputRow,
} from "./remote-input-state";
import {
  buildSoloSeparatedPayload,
  makeSquadMixState,
  resolvePhysInputs,
  SOLO_ROLES,
  SOLO_SQUAD,
  type SquadMixState,
} from "./squad";
import { emptyInput, type Role, type RoleInput, type SquadSize } from "./types";

/**
 * Joint-input intake module — one deep module behind one seam.
 *
 * Every Joint press (keyboard, touch stick, solo verbs, remote squad mates)
 * enters here and leaves as either a per-role payload or resolved physics
 * channels. The small modules below stay as internal seams: callers and
 * tests cross this module's interface, never theirs directly.
 */
export {
  InputManager,
  floatingJoystickOrigin,
  normalizeJoystickDisplacement,
  replaceRemoteInputs,
  neutralInputsForRoles,
  inputsEqual,
  emptyInput,
  makeSquadMixState,
  SOLO_ROLES,
  SOLO_SQUAD,
};
export type {
  BodyInputs,
  FloatingJoystickOrigin,
  NormalizedJoystickDisplacement,
  RemoteInputRow,
  Role,
  RoleInput,
  SoloChannel,
  SoloVirtualAction,
  SquadMixState,
  SquadSize,
  VirtualAction,
};

/** Remote Joint presses expire — a silent guest must read as neutral, not stuck. */
export const REMOTE_INPUT_LEASE_MS = 1000;

export type JointMixState = SquadMixState;

export const createJointMixState = (): JointMixState => makeSquadMixState();

export interface LocalTeamSample {
  solo: boolean;
  roles: readonly Role[];
  activeRole: Role;
  dt: number;
}

/**
 * Sample every local Joint press for one frame: steers the camera (Torso, or
 * legacy Head; never the keyboard in solo), then reads each assigned role.
 * Only the active Joint goes hot — the rest read neutral with live look.
 */
export function sampleLocalTeamInput(
  manager: InputManager,
  sample: LocalTeamSample,
): Partial<Record<Role, RoleInput>> {
  if (sample.solo) {
    manager.tickHead(sample.dt, false);
    const channels = manager.readSolo();
    const combined = buildSoloSeparatedPayload(channels);
    const payload: Partial<Record<Role, RoleInput>> = {};
    for (const role of sample.roles) {
      const input = combined[role];
      if (input) payload[role] = input;
    }
    return payload;
  }
  const cameraRole = sample.activeRole === "torso" || sample.activeRole === "head";
  manager.tickHead(sample.dt, cameraRole);
  const payload: Partial<Record<Role, RoleInput>> = {};
  for (const role of sample.roles) {
    payload[role] = manager.read(role, role === sample.activeRole);
  }
  return payload;
}

/** Local presses win over remote: your own Joint is never overridden by a guest. */
export function mergeTeamInputs(
  local: Partial<Record<Role, RoleInput>>,
  remote: Partial<Record<Role, RoleInput>>,
): Partial<Record<Role, RoleInput>> {
  return { ...remote, ...local };
}

export interface RemoteTeamScope {
  teamId: number;
  ownIdentity: string;
  nowMs: number;
  leaseMs?: number;
}

/** Collect squad-mate presses, dropping stale leases and strangers' teams. */
export function collectTeamRemoteInputs(
  rows: Iterable<RemoteInputRow>,
  scope: RemoteTeamScope,
): Partial<Record<Role, RoleInput>> {
  return collectRemoteInputs(rows, {
    teamId: scope.teamId,
    ownIdentity: scope.ownIdentity,
    nowMs: scope.nowMs,
    leaseMs: scope.leaseMs ?? REMOTE_INPUT_LEASE_MS,
  });
}

/**
 * Resolve a merged team payload into the 5 physics channels (3P stride
 * alternation, 5P hand averaging with the both-hands gate, Torso camera).
 */
export function resolveTeamBodyInputs(
  ext: Partial<Record<Role, RoleInput>>,
  squad: SquadSize,
  dt: number,
  state: JointMixState,
): BodyInputs {
  return resolvePhysInputs(ext, squad, dt, state);
}

/** True when nothing worth sending changed since the last payload. */
export function teamPayloadsEqual(
  a: Partial<Record<Role, RoleInput>>,
  b: Partial<Record<Role, RoleInput>>,
): boolean {
  const roles = new Set<Role>([...(Object.keys(a) as Role[]), ...(Object.keys(b) as Role[])]);
  for (const role of roles) {
    const x = a[role] ?? emptyInput();
    const y = b[role] ?? emptyInput();
    if (!inputsEqual(x, y)) return false;
  }
  return true;
}
