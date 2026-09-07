import { schema, table, t, SenderError } from "spacetimedb/server";
import { ScheduleAt } from "spacetimedb";
import {
  createBody,
  decodeSnapshot,
  encodeSnapshot,
  step,
  neutralInputs,
  RULESET,
  isChallenge,
  isCrewSize,
  rolesFor,
} from "../../shared/physics";
import {
  assignmentConflict,
  phasePolicy,
  planMatchStart,
  planMatchTick,
  raceEndReason,
  type MatchAssignment,
  type MatchMember,
} from "../../shared/match-lifecycle";
const room = table(
  { public: true },
  {
    id: t.string().primaryKey(),
    host: t.identity(),
    state: t.string(),
    startAt: t.u64(),
    created: t.u64(),
    ruleset: t.u32().default(RULESET),
    challenge: t.u32().default(0),
    crewSize: t.u32().default(5),
  },
);
const player = table(
  { public: true },
  {
    id: t.identity().primaryKey(),
    room: t.string(),
    team: t.u32(),
    role: t.u32(),
    name: t.string(),
    x: t.f64(),
    z: t.f64(),
    action: t.bool(),
    seen: t.u64(),
    online: t.bool(),
  },
);
const team = table(
  { public: true },
  {
    id: t.string().primaryKey(),
    room: t.string(),
    number: t.u32(),
    body: t.string(),
    finishMs: t.u32(),
    challenge: t.u32().default(0),
    crewSize: t.u32().default(5),
  },
);
const result = table(
  { public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    room: t.string(),
    team: t.u32(),
    names: t.string(),
    timeMs: t.u32(),
    ruleset: t.u32(),
    created: t.u64(),
    // Appended defaults preserve legacy leaderboard rows as Easy / five-player.
    challenge: t.u32().default(0),
    crewSize: t.u32().default(5),
  },
);
const connectionLease = table(
  {},
  {
    id: t.identity().primaryKey(),
    connection: t.connectionId(),
  },
);
const tick = table(
  {},
  { id: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt() },
);
const db = schema({ room, player, team, result, connectionLease, tick });
export default db;
const now = (ctx: { timestamp: { microsSinceUnixEpoch: bigint } }) =>
  ctx.timestamp.microsSinceUnixEpoch;
const lifecycleMember = (p: {
  id: { toHexString(): string };
  team: number;
  role: number;
  online: boolean;
  seen: bigint;
}): MatchMember => ({
  id: p.id.toHexString(),
  team: p.team,
  role: p.role,
  online: p.online,
  disconnectedAtMicros: p.online ? 0n : p.seen,
});
export const init = db.init((ctx) => {
  ctx.db.tick.insert({ id: 0n, scheduledAt: ScheduleAt.interval(33333n) });
});
export const join = db.reducer(
  {
    code: t.string(),
    name: t.string(),
    teamNumber: t.u32(),
    role: t.u32(),
    ruleset: t.u32(),
    challenge: t.u32(),
    crewSize: t.u32(),
  },
  (ctx, a) => {
    if (!ctx.connectionId)
      throw new SenderError("Join from a connected game client.");
    if (a.ruleset !== RULESET)
      throw new SenderError("Update your client to join this course.");
    if (!isChallenge(a.challenge) || !isCrewSize(a.crewSize))
      throw new SenderError("Choose a valid challenge and crew size.");
    const requestedRoles = rolesFor(a.crewSize);
    const code = a.code.trim().toUpperCase();
    if (
      !/^[A-Z0-9]{3,12}$/.test(code) ||
      a.role >= requestedRoles.length ||
      a.teamNumber > 3 ||
      !a.name.trim()
    )
      throw new SenderError(
        "Enter a room code (3–12 letters/numbers), name, and valid role.",
      );
    const previous = ctx.db.player.id.find(ctx.sender);
    const priorRoom = previous && ctx.db.room.id.find(previous.room);
    const request: MatchAssignment = {
      room: code,
      team: a.teamNumber,
      role: a.role,
      ruleset: a.ruleset,
      challenge: a.challenge,
      crewSize: a.crewSize,
    };
    const current = previous && priorRoom ? {
      room: previous.room,
      team: previous.team,
      role: previous.role,
      ruleset: priorRoom.ruleset,
      challenge: priorRoom.challenge,
      crewSize: priorRoom.crewSize,
    } : undefined;
    let r = ctx.db.room.id.find(code);
    const conflict = assignmentConflict({
      current,
      currentRoomPhase: priorRoom?.state,
      request,
      targetRoomPhase: r?.state,
    });
    if (conflict === "current-match-locked")
      throw new SenderError(
        "Your room, challenge, crew size, team, and role are locked until this race ends.",
      );
    if (conflict === "target-match-locked")
      throw new SenderError(
        "This race is locked. Only its assigned pilots can reconnect.",
      );
    if (!r) {
      if ([...ctx.db.room.iter()].length >= 200)
        throw new SenderError("Lobby capacity reached.");
      r = ctx.db.room.insert({
        id: code,
        host: ctx.sender,
        state: "lobby",
        startAt: 0n,
        created: now(ctx),
        ruleset: a.ruleset,
        challenge: a.challenge,
        crewSize: a.crewSize,
      });
    }
    if (
      r.ruleset !== a.ruleset ||
      r.challenge !== a.challenge ||
      r.crewSize !== a.crewSize
    )
      throw new SenderError(
        "This room is configured for a different challenge or crew size.",
      );
    for (const p of ctx.db.player.iter())
      if (
        p.room === code &&
        p.team === a.teamNumber &&
        p.role === a.role &&
        !p.id.isEqual(ctx.sender)
      ) {
        if (!phasePolicy(r.state).assignmentLocked && !p.online)
          ctx.db.player.id.delete(p.id);
        else
          throw new SenderError("That body part already has a pilot.");
      }
    ctx.db.player.id.delete(ctx.sender);
    ctx.db.connectionLease.id.delete(ctx.sender);
    ctx.db.connectionLease.insert({
      id: ctx.sender,
      connection: ctx.connectionId,
    });
    ctx.db.player.insert({
      id: ctx.sender,
      room: code,
      team: a.teamNumber,
      role: a.role,
      name: phasePolicy(r.state).assignmentLocked ? previous!.name : a.name.trim().slice(0, 20),
      x: 0,
      z: 0,
      action: false,
      seen: now(ctx),
      online: true,
    });
    const id = code + ":" + a.teamNumber;
    if (!ctx.db.team.id.find(id))
      ctx.db.team.insert({
        id,
        room: code,
        number: a.teamNumber,
        body: encodeSnapshot(createBody(r.challenge, r.crewSize)),
        finishMs: 0,
        challenge: r.challenge,
        crewSize: r.crewSize,
      });
  },
);
export const input = db.reducer(
  { x: t.f64(), z: t.f64(), action: t.bool() },
  (ctx, a) => {
    const lease = ctx.db.connectionLease.id.find(ctx.sender);
    if (!ctx.connectionId || !lease?.connection.isEqual(ctx.connectionId)) return;
    const p = ctx.db.player.id.find(ctx.sender);
    if (!p || !p.online) return;
    if (!phasePolicy(ctx.db.room.id.find(p.room)?.state).acceptsInput) return;
    if (!Number.isFinite(a.x) || !Number.isFinite(a.z))
      throw new SenderError("Invalid input");
    if (now(ctx) - p.seen < 25000n) return;
    ctx.db.player.id.update({
      ...p,
      x: Math.max(-1, Math.min(1, a.x)),
      z: Math.max(-1, Math.min(1, a.z)),
      action: a.action,
      seen: now(ctx),
    });
  },
);
export const start = db.reducer((ctx) => {
  const lease = ctx.db.connectionLease.id.find(ctx.sender);
  if (!ctx.connectionId || !lease?.connection.isEqual(ctx.connectionId))
    throw new SenderError("Join first");
  const p = ctx.db.player.id.find(ctx.sender);
  if (!p || !p.online) throw new SenderError("Join first");
  const r = ctx.db.room.id.find(p.room);
  if (!r) throw new SenderError("Join first");
  if (!r.host.isEqual(ctx.sender))
    throw new SenderError("Only the room host can start a race");
  const members = [...ctx.db.player.iter()].filter(q => q.room === r.id);
  const plan = planMatchStart({
    phase: r.state,
    crewSize: r.crewSize,
    nowMicros: now(ctx),
    members: members.map(lifecycleMember),
  });
  if (!plan.ok && plan.reason === "invalid-phase")
    throw new SenderError("Race already running");
  if (!isChallenge(r.challenge) || !isCrewSize(r.crewSize) || r.ruleset !== RULESET)
    throw new SenderError("This room has an incompatible course configuration.");
  if (!plan.ok) {
    if (plan.reason === "incomplete-team")
      throw new SenderError(
        `Team ${plan.team! + 1} needs all ${r.crewSize} connected roles before starting.`,
      );
    if (plan.reason === "no-active-team")
      throw new SenderError("At least one complete connected team is required.");
    throw new SenderError("This room has an incompatible course configuration.");
  }
  const activeTeams = new Set(plan.activeTeams);
  for (const q of members) {
    if (!activeTeams.has(q.team)) ctx.db.player.id.delete(q.id);
    else ctx.db.player.id.update({ ...q, x: 0, z: 0, action: false, seen: 0n });
  }
  const resetTeams = new Set<number>();
  for (const tm of ctx.db.team.iter()) {
    if (tm.room !== r.id) continue;
    if (!activeTeams.has(tm.number)) ctx.db.team.id.delete(tm.id);
    else {
      resetTeams.add(tm.number);
      ctx.db.team.id.update({
        ...tm,
        body: encodeSnapshot(createBody(r.challenge, r.crewSize)),
        finishMs: 0,
        challenge: r.challenge,
        crewSize: r.crewSize,
      });
    }
  }
  for (const number of activeTeams)
    if (!resetTeams.has(number))
      ctx.db.team.insert({
        id: `${r.id}:${number}`,
        room: r.id,
        number,
        body: encodeSnapshot(createBody(r.challenge, r.crewSize)),
        finishMs: 0,
        challenge: r.challenge,
        crewSize: r.crewSize,
      });
  ctx.db.room.id.update({
    ...r,
    state: "countdown",
    startAt: plan.startAtMicros,
  });
});
// A disconnected pilot retains the same match lease. Leaving cannot bypass the lock.
const releasePlayer = (ctx: any) => {
  const lease = ctx.db.connectionLease.id.find(ctx.sender);
  if (!ctx.connectionId || !lease?.connection.isEqual(ctx.connectionId)) return;
  ctx.db.connectionLease.id.delete(ctx.sender);
  const p = ctx.db.player.id.find(ctx.sender);
  if (!p) return;
  const r = ctx.db.room.id.find(p.room);
  if (phasePolicy(r?.state).reserveAssignmentOnRelease)
    ctx.db.player.id.update({
      ...p,
      online: false,
      x: 0,
      z: 0,
      action: false,
      seen: p.online ? now(ctx) : p.seen,
    });
  else ctx.db.player.id.delete(ctx.sender);
};
export const leave = db.reducer(releasePlayer);
export const disconnected = db.clientDisconnected(releasePlayer);
export const simulate = db.reducer(
  { onSchedule: tick },
  { arg: tick.rowType },
  (ctx) => {
    const time = now(ctx);
    const players = [...ctx.db.player.iter()];
    for (const r0 of ctx.db.room.iter()) {
      let r = r0;
      const members = players.filter((p) => p.room === r.id);
      const roomTeams = [...ctx.db.team.iter()].filter(tm => tm.room === r.id);
      const plan = planMatchTick({
        phase: r.state,
        nowMicros: time,
        startAtMicros: r.startAt,
        hostId: r.host.toHexString(),
        members: members.map(lifecycleMember),
        teams: roomTeams.map(tm => ({ number: tm.number, finished: tm.finishMs > 0 })),
      });
      const purgeMembers = new Set(plan.purgeMemberIds);
      const abandonedTeams = new Set(plan.abandonedTeamNumbers);
      if (plan.deleteRoom) {
        for (const p of members) ctx.db.player.id.delete(p.id);
        for (const tm of roomTeams) ctx.db.team.id.delete(tm.id);
        ctx.db.room.id.delete(r.id);
        continue;
      }
      for (const p of members)
        if (purgeMembers.has(p.id.toHexString())) ctx.db.player.id.delete(p.id);
      for (const tm of roomTeams)
        if (abandonedTeams.has(tm.number)) ctx.db.team.id.delete(tm.id);

      const retainedMembers = members.filter(p => !purgeMembers.has(p.id.toHexString()));
      const retainedTeams = roomTeams.filter(tm => !abandonedTeams.has(tm.number));
      const nextHost = plan.nextHostId === null
        ? undefined
        : retainedMembers.find(p => p.id.toHexString() === plan.nextHostId)?.id;
      if (r.state !== plan.phase || (nextHost && !r.host.isEqual(nextHost))) {
        r = { ...r, state: plan.phase, host: nextHost ?? r.host };
        ctx.db.room.id.update(r);
      }
      const finishRoom = () => {
        for (const p of retainedMembers)
          if (!p.online) ctx.db.player.id.delete(p.id);
        r = { ...r, state: "finished" };
        ctx.db.room.id.update(r);
      };
      if (plan.finishReason) {
        finishRoom();
        continue;
      }
      if (plan.simulateTeamNumbers.length === 0) {
        if (plan.phase === "racing" && raceEndReason({
          nowMicros: time,
          startAtMicros: r.startAt,
          contendingTeamNumbers: plan.contendingTeamNumbers,
          teams: retainedTeams.map(tm => ({ number: tm.number, finished: tm.finishMs > 0 })),
        })) finishRoom();
        continue;
      }
      if (!isChallenge(r.challenge) || !isCrewSize(r.crewSize) || r.ruleset !== RULESET) {
        finishRoom();
        continue;
      }
      const roomRoles = rolesFor(r.crewSize);
      const simulationTeams = new Set(plan.simulateTeamNumbers);
      const teamState = retainedTeams.map(tm => ({ number: tm.number, finished: tm.finishMs > 0 }));
      let corrupt = false;
      for (const tm of retainedTeams) {
        if (!simulationTeams.has(tm.number)) continue;
        const snapshot = decodeSnapshot(tm.body, { version: r.ruleset, challenge: r.challenge, crewSize: r.crewSize });
        if (!snapshot.ok || tm.challenge !== r.challenge || tm.crewSize !== r.crewSize) {
          corrupt = true;
          break;
        }
        const b = snapshot.body;
        const inputs = neutralInputs(r.crewSize);
        for (const p of retainedMembers)
          if (p.online && p.team === tm.number && p.role < roomRoles.length && time - p.seen < 500000n)
            inputs[p.role] = { x: p.x, z: p.z, action: p.action };
        step(b, inputs);
        // Wall-clock time is authoritative; simulation lag never improves a ranked result.
        const finishMs = b.finished
          ? Number((time - r.startAt) / 1000n) + b.penaltyMs
          : 0;
        ctx.db.team.id.update({
          ...tm,
          body: encodeSnapshot(b),
          finishMs,
          challenge: r.challenge,
          crewSize: r.crewSize,
        });
        const progress = teamState.find(team => team.number === tm.number)!;
        progress.finished = finishMs > 0;
        if (finishMs) {
          ctx.db.result.insert({
            id: 0n,
            room: r.id,
            team: tm.number,
            names: retainedMembers
              .filter((p) => p.team === tm.number)
              .map((p) => p.name)
              .join(", "),
            timeMs: finishMs,
            ruleset: RULESET,
            challenge: r.challenge,
            crewSize: r.crewSize,
            created: time,
          });
        }
      }
      if (corrupt || raceEndReason({
        nowMicros: time,
        startAtMicros: r.startAt,
        contendingTeamNumbers: plan.contendingTeamNumbers,
        teams: teamState,
      })) finishRoom();
    }
  },
);
