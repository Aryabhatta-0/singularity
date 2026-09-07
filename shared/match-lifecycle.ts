import { type CrewSize, isCrewSize } from "./course.ts";

export const MATCH_PHASES = ["lobby", "countdown", "racing", "finished"] as const;
export type MatchPhase = (typeof MATCH_PHASES)[number];

export const COUNTDOWN_MICROS = 3_000_000n;
export const DISCONNECT_GRACE_MICROS = 15_000_000n;
export const RACE_TIMEOUT_MICROS = 600_000_000n;

export type MatchAssignment = {
  room: string;
  team: number;
  role: number;
  ruleset: number;
  challenge: number;
  crewSize: number;
};

export type MatchMember = {
  id: string;
  team: number;
  role: number;
  online: boolean;
  disconnectedAtMicros: bigint;
};

export type MatchTeam = {
  number: number;
  finished: boolean;
};

export type PhasePolicy = {
  phase: MatchPhase | null;
  assignmentLocked: boolean;
  reserveAssignmentOnRelease: boolean;
  acceptsInput: boolean;
  canStart: boolean;
};

export type StartMatchPlan =
  | {
      ok: true;
      activeTeams: readonly number[];
      startAtMicros: bigint;
    }
  | {
      ok: false;
      reason: "invalid-phase" | "invalid-crew-size" | "no-active-team" | "incomplete-team";
      team?: number;
      missingRoles?: readonly number[];
    };

export type MatchTickPlan = {
  phase: MatchPhase;
  finishReason: "invalid-phase" | "corrupt-state" | null;
  deleteRoom: boolean;
  nextHostId: string | null;
  abandonedTeamNumbers: readonly number[];
  purgeMemberIds: readonly string[];
  contendingTeamNumbers: readonly number[];
  simulateTeamNumbers: readonly number[];
};

export function isMatchPhase(value: string): value is MatchPhase {
  return MATCH_PHASES.some(phase => phase === value);
}

export function phasePolicy(phase: string | undefined): PhasePolicy {
  switch (phase) {
    case "lobby":
      return { phase, assignmentLocked: false, reserveAssignmentOnRelease: false, acceptsInput: false, canStart: true };
    case "countdown":
      return { phase, assignmentLocked: true, reserveAssignmentOnRelease: true, acceptsInput: false, canStart: false };
    case "racing":
      return { phase, assignmentLocked: true, reserveAssignmentOnRelease: true, acceptsInput: true, canStart: false };
    case "finished":
      return { phase, assignmentLocked: false, reserveAssignmentOnRelease: false, acceptsInput: false, canStart: true };
    default:
      return { phase: null, assignmentLocked: true, reserveAssignmentOnRelease: true, acceptsInput: false, canStart: false };
  }
}

function sameAssignment(left: MatchAssignment, right: MatchAssignment): boolean {
  return left.room === right.room &&
    left.team === right.team &&
    left.role === right.role &&
    left.ruleset === right.ruleset &&
    left.challenge === right.challenge &&
    left.crewSize === right.crewSize;
}

export function assignmentConflict(input: {
  current?: MatchAssignment;
  currentRoomPhase?: string;
  request: MatchAssignment;
  targetRoomPhase?: string;
}): "current-match-locked" | "target-match-locked" | null {
  const unchanged = input.current && sameAssignment(input.current, input.request);
  if (input.current && input.currentRoomPhase !== undefined &&
    phasePolicy(input.currentRoomPhase).assignmentLocked && !unchanged)
    return "current-match-locked";
  if (input.targetRoomPhase !== undefined && phasePolicy(input.targetRoomPhase).assignmentLocked && !unchanged)
    return "target-match-locked";
  return null;
}

export function connectedTeamNumbers(members: readonly MatchMember[]): readonly number[] {
  return [...new Set(members.filter(member => member.online).map(member => member.team))]
    .sort((left, right) => left - right);
}

export function planMatchStart(input: {
  phase: string;
  crewSize: number;
  nowMicros: bigint;
  members: readonly MatchMember[];
}): StartMatchPlan {
  if (!phasePolicy(input.phase).canStart)
    return { ok: false, reason: "invalid-phase" };
  if (!isCrewSize(input.crewSize))
    return { ok: false, reason: "invalid-crew-size" };

  const activeTeams = connectedTeamNumbers(input.members);
  if (activeTeams.length === 0) return { ok: false, reason: "no-active-team" };

  for (const team of activeTeams) {
    const missingRoles = requiredRoles(input.crewSize).filter(role =>
      !input.members.some(member => member.online && member.team === team && member.role === role));
    if (missingRoles.length > 0)
      return { ok: false, reason: "incomplete-team", team, missingRoles };
  }

  return {
    ok: true,
    activeTeams,
    startAtMicros: input.nowMicros + COUNTDOWN_MICROS,
  };
}

export function planMatchTick(input: {
  phase: string;
  nowMicros: bigint;
  startAtMicros: bigint;
  hostId: string;
  members: readonly MatchMember[];
  teams: readonly MatchTeam[];
}): MatchTickPlan {
  const policy = phasePolicy(input.phase);
  const unlocked = policy.phase === "lobby" || policy.phase === "finished";
  const abandonedTeamNumbers = policy.assignmentLocked
    ? input.teams
      .filter(team => !team.finished && teamIsAbandoned(team.number, input.members, input.nowMicros))
      .map(team => team.number)
      .sort((left, right) => left - right)
    : [];
  const abandoned = new Set(abandonedTeamNumbers);
  const purgeMemberIds = input.members
    .filter(member => (unlocked && !member.online) || abandoned.has(member.team))
    .map(member => member.id)
    .sort();
  const purgeMembers = new Set(purgeMemberIds);
  const retainedMembers = input.members.filter(member => !purgeMembers.has(member.id));
  const retainedTeams = input.teams.filter(team => !abandoned.has(team.number));
  const retainedOnline = retainedMembers.filter(member => member.online);
  const missingTeam = retainedMembers.some(member =>
    !retainedTeams.some(team => team.number === member.team));

  const phase = policy.phase === "countdown" && input.nowMicros >= input.startAtMicros
    ? "racing"
    : policy.phase ?? "finished";
  const finishReason = policy.phase === null
    ? "invalid-phase"
    : missingTeam && policy.assignmentLocked
      ? "corrupt-state"
      : null;
  const terminalPhase = finishReason ? "finished" : phase;
  const contendingTeamNumbers = retainedTeams
    .filter(team => team.finished || retainedMembers.some(member => member.team === team.number))
    .map(team => team.number)
    .sort((left, right) => left - right);
  const simulateTeamNumbers = terminalPhase === "racing"
    ? retainedTeams
      .filter(team => !team.finished && retainedMembers.some(member => member.team === team.number))
      .map(team => team.number)
      .sort((left, right) => left - right)
    : [];
  const nextHostId = retainedOnline.some(member => member.id === input.hostId)
    ? input.hostId
    : retainedOnline.map(member => member.id).sort()[0] ?? null;

  return {
    phase: terminalPhase,
    finishReason,
    deleteRoom: retainedMembers.length === 0 || (unlocked && retainedOnline.length === 0),
    nextHostId,
    abandonedTeamNumbers,
    purgeMemberIds,
    contendingTeamNumbers,
    simulateTeamNumbers,
  };
}

export function raceEndReason(input: {
  nowMicros: bigint;
  startAtMicros: bigint;
  contendingTeamNumbers: readonly number[];
  teams: readonly MatchTeam[];
}): "completed" | "timeout" | null {
  if (input.nowMicros - input.startAtMicros >= RACE_TIMEOUT_MICROS) return "timeout";
  if (input.contendingTeamNumbers.length === 0) return null;
  return input.contendingTeamNumbers.every(number =>
    input.teams.some(team => team.number === number && team.finished))
    ? "completed"
    : null;
}

function teamIsAbandoned(team: number, members: readonly MatchMember[], nowMicros: bigint): boolean {
  const crew = members.filter(member => member.team === team);
  return crew.length === 0 || (crew.every(member => !member.online) &&
    crew.every(member => nowMicros - member.disconnectedAtMicros >= DISCONNECT_GRACE_MICROS));
}

function requiredRoles(crewSize: CrewSize): readonly number[] {
  return Array.from({ length: crewSize }, (_, role) => role);
}
