import {
  CHALLENGE,
  DT,
  RULESET,
  createBody,
  decodeSnapshot,
  elapsedMs as bodyElapsedMs,
  encodeSnapshot,
  isChallenge,
  isCrewSize,
  practiceInputs,
  rolesFor,
  step,
  type Body,
  type ChallengeId,
  type CrewSize,
  type Input,
} from "../shared/physics.ts";

export type RankedPhase = "lobby" | "countdown" | "racing" | "finished";

export type RaceSetup = Readonly<{
  challenge: ChallengeId;
  crewSize: CrewSize;
}>;

export type RankedMember = Readonly<{
  name: string;
  team: number;
  role: number;
  online: boolean;
}>;

export type RankedTeamProjection = Readonly<{
  number: number;
  finishMs: number;
  snapshot: string;
}>;

export type RankedProjection = Readonly<{
  connected: boolean;
  room: Readonly<{
    code: string;
    phase: RankedPhase;
    startAtMs: number;
    ruleset: number;
    challenge: number;
    crewSize: number;
    isHost: boolean;
  }>;
  assignment: Readonly<{
    team: number;
    role: number;
    online: boolean;
  }>;
  members: readonly RankedMember[];
  teams: readonly RankedTeamProjection[];
}>;

export type RaceSessionCommand =
  | { type: "configure"; challenge: number; crewSize: number }
  | { type: "select-role"; role: number }
  | { type: "start-practice" }
  | { type: "leave" };

export type RaceSessionSignal =
  | { type: "leave-ranked"; roomCode: string }
  | { type: "play-started"; mode: "practice" | "ranked"; matchId: string }
  | { type: "stage-cleared"; stage: number }
  | { type: "fell"; falls: number; penaltyMs: number }
  | { type: "timing-missed"; mistakes: number; penaltyMs: number }
  | { type: "completed"; ranked: boolean; finishMs: number }
  | { type: "ranked-ended-without-finish" }
  | { type: "snapshot-rejected"; team: number; error: string }
  | { type: "command-rejected"; error: string };

export type StoredTeam = {
  number: number;
  finishMs: number;
  body: Body;
};

type IdleRun = { kind: "idle"; body: Body };
type PracticeRun = { kind: "practice"; id: string; body: Body };
type RankedRun = {
  kind: "ranked";
  connected: boolean;
  room: {
    code: string;
    phase: RankedPhase;
    startAtMs: number;
    isHost: boolean;
  };
  assignment: { team: number; role: number; online: boolean };
  members: RankedMember[];
  teams: StoredTeam[];
};

type StoredRun = IdleRun | PracticeRun | RankedRun;

export type RaceSessionSnapshot = {
  setup: { challenge: ChallengeId; crewSize: CrewSize };
  roleSelection: number;
  run: StoredRun;
};

export type RaceSessionView = Readonly<{
  mode: "idle" | "practice" | "ranked";
  phase: "setup" | RankedPhase;
  setup: RaceSetup;
  roleSelection: number;
  controlledRole: number;
  body: Body;
  teams: readonly StoredTeam[];
  members: readonly RankedMember[];
  playing: boolean;
  configLocked: boolean;
  roleLocked: boolean;
  canStart: boolean;
  canSendInput: boolean;
  elapsedMs: number;
  countdownSeconds: number;
  room?: Readonly<{
    code: string;
    team: number;
    assignedRole: number;
    isHost: boolean;
    crewReady: boolean;
    matchId: string | null;
  }>;
}>;

export interface RaceSession {
  dispatch(command: RaceSessionCommand): readonly RaceSessionSignal[];
  synchronize(projection: RankedProjection, intent: "adopt" | "update"): readonly RaceSessionSignal[];
  advance(deltaSeconds: number, input: Input, simulationEnabled: boolean): readonly RaceSessionSignal[];
  view(nowMs: number): RaceSessionView;
  snapshot(): RaceSessionSnapshot;
}

type FeedbackCursor = {
  matchId: string;
  stage: number;
  falls: number;
  mistakes: number;
  finished: boolean;
  endedWithoutFinish: boolean;
};

const freshSetup = (): RaceSetup => ({ challenge: CHALLENGE.Easy, crewSize: 5 });
const cloneBody = (body: Body) => {
  const decoded = decodeSnapshot(encodeSnapshot(body));
  if (!decoded.ok) throw new Error(decoded.error);
  return decoded.body;
};

function roleFor(setup: RaceSetup, candidate: number) {
  const last = rolesFor(setup.crewSize).length - 1;
  return Number.isInteger(candidate) ? Math.max(0, Math.min(last, candidate)) : last;
}

function matchId(run: RankedRun) {
  return run.room.phase === "lobby" ? null : `${run.room.code}:${run.room.startAtMs}`;
}

function localTeam(run: RankedRun) {
  return run.teams.find(team => team.number === run.assignment.team)!;
}

function cursorFor(id: string, body: Body): FeedbackCursor {
  return { matchId: id, stage: body.stage, falls: body.falls, mistakes: body.mistakes, finished: body.finished, endedWithoutFinish: false };
}

function bodySignals(cursor: FeedbackCursor, body: Body, ranked: boolean, finishMs: number) {
  const signals: RaceSessionSignal[] = [];
  if (body.stage > cursor.stage) signals.push({ type: "stage-cleared", stage: body.stage });
  if (body.falls > cursor.falls) signals.push({ type: "fell", falls: body.falls, penaltyMs: body.penaltyMs });
  if (body.mistakes > cursor.mistakes) signals.push({ type: "timing-missed", mistakes: body.mistakes, penaltyMs: body.penaltyMs });
  if (body.finished && !cursor.finished) signals.push({ type: "completed", ranked, finishMs: ranked ? finishMs : bodyElapsedMs(body) });
  cursor.stage = body.stage;
  cursor.falls = body.falls;
  cursor.mistakes = body.mistakes;
  cursor.finished = body.finished;
  return signals;
}

function validProjection(projection: RankedProjection) {
  const { room, assignment } = projection;
  return room.ruleset === RULESET &&
    isChallenge(room.challenge) &&
    isCrewSize(room.crewSize) &&
    ["lobby", "countdown", "racing", "finished"].includes(room.phase) &&
    Number.isFinite(room.startAtMs) && room.startAtMs >= 0 &&
    /^[A-Z0-9]{3,12}$/.test(room.code) &&
    Number.isInteger(assignment.team) && assignment.team >= 0 && assignment.team <= 3 &&
    Number.isInteger(assignment.role) && assignment.role >= 0 && assignment.role < rolesFor(room.crewSize).length;
}

function restore(initial?: RaceSessionSnapshot): RaceSessionSnapshot {
  if (!initial || !isChallenge(initial.setup?.challenge) || !isCrewSize(initial.setup?.crewSize)) {
    const setup = freshSetup();
    return { setup: { ...setup }, roleSelection: 4, run: { kind: "idle", body: createBody(setup.challenge, setup.crewSize) } };
  }
  const setup = { ...initial.setup };
  const roleSelection = roleFor(setup, initial.roleSelection);
  try {
    if (initial.run.kind === "practice") return { setup, roleSelection, run: { kind: "practice", id: initial.run.id, body: cloneBody(initial.run.body) } };
    if (initial.run.kind === "ranked") {
      const ranked = initial.run;
      const teams = ranked.teams.map(team => ({ number: team.number, finishMs: team.finishMs, body: cloneBody(team.body) }));
      if (!teams.some(team => team.number === ranked.assignment.team)) throw new Error("Missing local team.");
      return {
        setup,
        roleSelection,
        run: {
          kind: "ranked",
          connected: ranked.connected,
          room: { ...ranked.room },
          assignment: { ...ranked.assignment },
          members: ranked.members.map(member => ({ ...member })),
          teams,
        },
      };
    }
    return { setup, roleSelection, run: { kind: "idle", body: cloneBody(initial.run.body) } };
  } catch {
    return { setup, roleSelection, run: { kind: "idle", body: createBody(setup.challenge, setup.crewSize) } };
  }
}

export function createRaceSession(initial?: RaceSessionSnapshot): RaceSession {
  let state = restore(initial);
  let accumulator = 0;
  let practiceSequence = 0;
  let cursor: FeedbackCursor | undefined;

  function dispatch(command: RaceSessionCommand): readonly RaceSessionSignal[] {
    const signals: RaceSessionSignal[] = [];
    if (command.type === "configure") {
      if (state.run.kind !== "idle") return [{ type: "command-rejected", error: "Leave the current room or course before changing its setup." }];
      if (!isChallenge(command.challenge) || !isCrewSize(command.crewSize)) return [{ type: "command-rejected", error: "Choose a valid challenge and crew size." }];
      state.setup = { challenge: command.challenge, crewSize: command.crewSize };
      state.roleSelection = roleFor(state.setup, state.roleSelection);
      state.run = { kind: "idle", body: createBody(command.challenge, command.crewSize) };
      return signals;
    }
    if (command.type === "select-role") {
      const locked = state.run.kind === "practice" || (state.run.kind === "ranked" && (state.run.room.phase === "countdown" || state.run.room.phase === "racing"));
      if (locked) return [{ type: "command-rejected", error: "Your role is locked for this race." }];
      if (!Number.isInteger(command.role) || command.role < 0 || command.role >= rolesFor(state.setup.crewSize).length) return [{ type: "command-rejected", error: "Choose a valid role." }];
      state.roleSelection = command.role;
      return signals;
    }
    if (command.type === "start-practice") {
      if (state.run.kind === "ranked") signals.push({ type: "leave-ranked", roomCode: state.run.room.code });
      const id = `practice:${++practiceSequence}`;
      state.run = { kind: "practice", id, body: createBody(state.setup.challenge, state.setup.crewSize) };
      accumulator = 0;
      cursor = cursorFor(id, state.run.body);
      signals.push({ type: "play-started", mode: "practice", matchId: id });
      return signals;
    }
    if (state.run.kind === "ranked") signals.push({ type: "leave-ranked", roomCode: state.run.room.code });
    state.run = { kind: "idle", body: createBody(state.setup.challenge, state.setup.crewSize) };
    accumulator = 0;
    cursor = undefined;
    return signals;
  }

  function synchronize(projection: RankedProjection, intent: "adopt" | "update"): readonly RaceSessionSignal[] {
    if (state.run.kind === "practice") return [{ type: "command-rejected", error: "Leave practice before joining a ranked room." }];
    if (!validProjection(projection)) return [{ type: "command-rejected", error: "The ranked room projection is incompatible." }];
    if (intent === "update" && (state.run.kind !== "ranked" || state.run.room.code !== projection.room.code)) return [];

    const previous = state.run.kind === "ranked" && state.run.room.code === projection.room.code ? state.run : undefined;
    const signals: RaceSessionSignal[] = [];
    const setup: RaceSetup = { challenge: projection.room.challenge as ChallengeId, crewSize: projection.room.crewSize as CrewSize };
    const decodedTeams: StoredTeam[] = [];
    for (const team of projection.teams) {
      if (!Number.isInteger(team.number) || team.number < 0 || team.number > 3 || !Number.isInteger(team.finishMs) || team.finishMs < 0) {
        signals.push({ type: "snapshot-rejected", team: team.number, error: "Team metadata is invalid." });
        continue;
      }
      const decoded = decodeSnapshot(team.snapshot, { version: projection.room.ruleset, challenge: setup.challenge, crewSize: setup.crewSize });
      if (!decoded.ok) {
        signals.push({ type: "snapshot-rejected", team: team.number, error: decoded.error });
        continue;
      }
      if (!decodedTeams.some(candidate => candidate.number === team.number)) decodedTeams.push({ number: team.number, finishMs: team.finishMs, body: decoded.body });
    }
    let local = decodedTeams.find(team => team.number === projection.assignment.team);
    if (!local) {
      const retained = previous?.teams.find(team => team.number === projection.assignment.team);
      local = retained ? { ...retained } : { number: projection.assignment.team, finishMs: 0, body: createBody(setup.challenge, setup.crewSize) };
      decodedTeams.push(local);
    }
    decodedTeams.sort((left, right) => left.number - right.number);

    const next: RankedRun = {
      kind: "ranked",
      connected: projection.connected,
      room: {
        code: projection.room.code,
        phase: projection.room.phase,
        startAtMs: projection.room.startAtMs,
        isHost: projection.room.isHost,
      },
      assignment: { ...projection.assignment },
      members: projection.members.map(member => ({ ...member })),
      teams: decodedTeams,
    };
    state.setup = { ...setup };
    state.roleSelection = roleFor(setup, state.roleSelection);
    if (next.room.phase === "countdown" || next.room.phase === "racing") state.roleSelection = next.assignment.role;
    state.run = next;

    const id = matchId(next);
    const previousId = previous ? matchId(previous) : null;
    if (id && id !== previousId) {
      cursor = cursorFor(id, local.body);
      signals.push({ type: "play-started", mode: "ranked", matchId: id });
    } else if (id) {
      cursor ??= cursorFor(id, local.body);
      signals.push(...bodySignals(cursor, local.body, true, local.finishMs));
      if (next.room.phase === "finished" && !local.body.finished && !cursor.endedWithoutFinish) {
        cursor.endedWithoutFinish = true;
        signals.push({ type: "ranked-ended-without-finish" });
      }
    } else cursor = undefined;
    accumulator = 0;
    return signals;
  }

  function advance(deltaSeconds: number, input: Input, simulationEnabled: boolean): readonly RaceSessionSignal[] {
    if (state.run.kind !== "practice") {
      accumulator = 0;
      return [];
    }
    if (!simulationEnabled) {
      accumulator = 0;
      return [];
    }
    accumulator += Math.max(0, Math.min(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0.1));
    const signals: RaceSessionSignal[] = [];
    cursor ??= cursorFor(state.run.id, state.run.body);
    while (accumulator + Number.EPSILON >= DT) {
      step(state.run.body, practiceInputs(state.run.body, state.roleSelection, input));
      accumulator -= DT;
      signals.push(...bodySignals(cursor, state.run.body, false, 0));
    }
    return signals;
  }

  function view(nowMs: number): RaceSessionView {
    const run = state.run;
    const setup = state.setup;
    if (run.kind === "idle") {
      return {
        mode: "idle",
        phase: "setup",
        setup,
        roleSelection: state.roleSelection,
        controlledRole: state.roleSelection,
        body: run.body,
        teams: [{ number: 0, finishMs: 0, body: run.body }],
        members: [],
        playing: false,
        configLocked: false,
        roleLocked: false,
        canStart: false,
        canSendInput: false,
        elapsedMs: 0,
        countdownSeconds: 0,
      };
    }
    if (run.kind === "practice") {
      return {
        mode: "practice",
        phase: "racing",
        setup,
        roleSelection: state.roleSelection,
        controlledRole: state.roleSelection,
        body: run.body,
        teams: [{ number: 0, finishMs: 0, body: run.body }],
        members: [],
        playing: true,
        configLocked: true,
        roleLocked: true,
        canStart: false,
        canSendInput: false,
        elapsedMs: bodyElapsedMs(run.body),
        countdownSeconds: 0,
      };
    }

    const team = localTeam(run);
    const id = matchId(run);
    const activeTeams = [...new Set(run.members.filter(member => member.online).map(member => member.team))];
    const crewReady = activeTeams.length > 0 && activeTeams.every(teamNumber =>
      rolesFor(setup.crewSize).every((_, role) => run.members.some(member => member.team === teamNumber && member.role === role && member.online)),
    );
    const playing = run.room.phase !== "lobby";
    const roleLocked = run.room.phase === "countdown" || run.room.phase === "racing";
    const countdownSeconds = run.room.phase === "countdown" ? Math.max(0, Math.ceil((run.room.startAtMs - nowMs) / 1000)) : 0;
    const elapsed = team.finishMs || (run.room.phase === "finished"
      ? bodyElapsedMs(team.body)
      : run.room.phase === "racing"
        ? Math.max(0, Math.round(nowMs - run.room.startAtMs)) + team.body.penaltyMs
        : 0);
    return {
      mode: "ranked",
      phase: run.room.phase,
      setup,
      roleSelection: state.roleSelection,
      controlledRole: roleLocked || run.room.phase === "finished" ? run.assignment.role : state.roleSelection,
      body: team.body,
      teams: run.teams,
      members: run.members,
      playing,
      configLocked: true,
      roleLocked,
      canStart: run.connected && run.room.isHost && crewReady && (run.room.phase === "lobby" || run.room.phase === "finished"),
      canSendInput: run.connected && run.assignment.online && run.room.phase === "racing",
      elapsedMs: elapsed,
      countdownSeconds,
      room: {
        code: run.room.code,
        team: run.assignment.team,
        assignedRole: run.assignment.role,
        isHost: run.room.isHost,
        crewReady,
        matchId: id,
      },
    };
  }

  function snapshot(): RaceSessionSnapshot {
    const cloned = JSON.parse(JSON.stringify(state)) as RaceSessionSnapshot;
    return restore(cloned);
  }

  return { dispatch, synchronize, advance, view, snapshot };
}
