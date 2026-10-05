/*
 * SINGULARITY — room server (SpacetimeDB module).
 *
 * The hosting player runs this module on their own machine (`npm run host`);
 * everyone else in the match connects to it as a client. It owns all live
 * match state: rooms, teams, roles, ready-up, the round lifecycle
 * (countdown -> playing -> results), the input relay (teammates -> team host)
 * and the physics snapshot relay (team host -> everyone in the room).
 *
 * It stores nothing durable. Final runs go to the separate leaderboard module
 * (leaderboard-server/), which is the only database meant to be hosted.
 */
import { schema, table, t, SenderError } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';
import { pickTeamName } from './team-names';

/* ---------------------------------- constants ---------------------------------- */

const CHALLENGE_IDS = new Set(['wobble-run', 'ferry-job', 'summit-sync', 'egg-express', 'slam-dunk']);
// Squad roles players actually pick. 3-player: arms+torso+legs. 5-player: split hands + split legs.
const SQUAD_3 = ['arms', 'torso', 'legs'];
const SQUAD_5 = ['lhand', 'rhand', 'torso', 'lleg', 'rleg'];
// Every assignable role (legacy head kept: it maps onto the torso camera).
const ROLES = new Set(['arms', 'torso', 'legs', 'lhand', 'rhand', 'lleg', 'rleg', 'head']);
const TEAM_COLORS = ['#ff5d5d', '#4fa8ff', '#ffd23f', '#6ef29a', '#c58bff', '#ff9a3c'];
const MAX_TEAMS = TEAM_COLORS.length;
const MAX_TEAM_NAME_LENGTH = 22;

const COUNTDOWN_MICROS = 4_200_000n; // 4.2s
const GRACE_MICROS = 45_000_000n; // first finish gives everyone else 45s
const ROUND_TIMEOUT_MICROS = 900_000_000n; // server-owned 15 minute cap
const CLEANUP_INTERVAL_MICROS = 5_000_000n; // 5s
const INPUT_SWEEP_INTERVAL_MICROS = 250_000n;
const INPUT_TTL_MICROS = 750_000n;
const RECONNECT_GRACE_MICROS = 30_000_000n;
const STALE_MICROS = 600_000_000n; // 10min without heartbeat -> gone
const INPUT_MIN_INTERVAL_MICROS = 8_000n; // hard ceiling: 125Hz
const SNAPSHOT_MIN_INTERVAL_MICROS = 30_000n; // hard ceiling: ~33Hz
const BODY_FLOATS = 77;
const MAX_PROP_FLOATS = 512;
const MAX_EVENT_JSON_LENGTH = 4_096;
const MAX_EVENTS = 32;
const MAX_MESSAGE_LENGTH = 192;
const MAX_ABS_WORLD_VALUE = 512;
const ROOM_CODE = /^[A-Z0-9]{3,8}$/;
const NEW_ROOM_CODE_LENGTH = 8;
const SNAPSHOT_EVENT_TYPES = new Set([
  'step', 'land', 'grab', 'release', 'throw', 'fall', 'getup', 'jump', 'kick', 'climb', 'shout',
  'thud', 'bounce', 'splash', 'crack', 'checkpoint', 'score', 'finish',
]);

/* ---------------------------------- validation ---------------------------------- */

function finiteIn(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

function validRoleInput(value: {
  f: number; s: number; lx: number; ly: number;
}): boolean {
  return finiteIn(value.f, -1, 1) && finiteIn(value.s, -1, 1) &&
    finiteIn(value.lx, -Math.PI * 2, Math.PI * 2) && finiteIn(value.ly, -Math.PI / 2, Math.PI / 2);
}

function validBodyVelocities(value: unknown): boolean {
  return value == null || (Array.isArray(value) && value.length === 66 &&
    value.every((component) => typeof component === 'number' && finiteIn(component, -100, 100)));
}

function validPropVelocities(value: unknown): boolean {
  if (value == null) return true;
  if (!Array.isArray(value) || value.length > 64 * 7 || value.length % 7 !== 0) return false;
  const ids = new Set<number>();
  for (let offset = 0; offset < value.length; offset += 7) {
    const propId = value[offset];
    if (typeof propId !== 'number' || !Number.isInteger(propId) || propId < 0 || propId > 63 || ids.has(propId)) return false;
    ids.add(propId);
    for (let component = offset + 1; component < offset + 7; component++) {
      if (typeof value[component] !== 'number' || !finiteIn(value[component], -100, 100)) return false;
    }
  }
  return true;
}

function validSnapshotEvents(encoded: string): boolean {
  if (encoded.length > MAX_EVENT_JSON_LENGTH) return false;
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    return false;
  }
  if (!Array.isArray(value) || value.length > MAX_EVENTS) return false;
  return value.every((event) => {
    if (event == null || typeof event !== 'object') return false;
    const candidate = event as Record<string, unknown>;
    if (candidate.type === 'state') {
      const holds = candidate.holds;
      const validHolds = holds == null || (Array.isArray(holds) && holds.length <= 2 &&
        new Set(holds.map((hold) => hold != null && typeof hold === 'object' ? (hold as Record<string, unknown>).hand : undefined)).size === holds.length &&
        holds.every((hold) => {
          if (hold == null || typeof hold !== 'object') return false;
          const item = hold as Record<string, unknown>;
          return (item.hand === 0 || item.hand === 1) && typeof item.propId === 'number' &&
            Number.isInteger(item.propId) && item.propId >= -1_000_000 && item.propId <= 63;
        }));
      return validHolds && typeof candidate.checkpoint === 'number' && Number.isInteger(candidate.checkpoint) &&
        candidate.checkpoint >= -1 && candidate.checkpoint <= 64 &&
        typeof candidate.delivered === 'boolean' &&
        typeof candidate.moverTime === 'number' && finiteIn(candidate.moverTime, 0, 7_200) &&
        typeof candidate.running === 'boolean' && typeof candidate.finished === 'boolean' &&
        typeof candidate.frozen === 'boolean' && validBodyVelocities(candidate.bodyVelocities) &&
        validPropVelocities(candidate.propVelocities);
    }
    if (typeof candidate.type !== 'string' || !SNAPSHOT_EVENT_TYPES.has(candidate.type)) return false;
    if (!Array.isArray(candidate.pos) || candidate.pos.length !== 3 ||
      !candidate.pos.every((axis) => typeof axis === 'number' && finiteIn(axis, -MAX_ABS_WORLD_VALUE, MAX_ABS_WORLD_VALUE))) return false;
    if (candidate.force != null && (typeof candidate.force !== 'number' || !finiteIn(candidate.force, 0, 100))) return false;
    if (candidate.hand != null && candidate.hand !== 0 && candidate.hand !== 1) return false;
    if (candidate.propId != null &&
      (typeof candidate.propId !== 'number' || !Number.isInteger(candidate.propId) || candidate.propId < 0 || candidate.propId > 1_000)) return false;
    return true;
  });
}

interface SnapshotPayload {
  p: number[]; props: number[]; yaw: number; pitch: number; timer: number; ev: string; msg?: string;
  fallen: boolean; score: number;
}

function validSnapshot(args: SnapshotPayload): boolean {
  const validQuaternion = (values: number[], offset: number): boolean => {
    const quaternion = values.slice(offset, offset + 4);
    if (quaternion.length !== 4 || !quaternion.every((value) => finiteIn(value, -1, 1))) return false;
    const normSquared = quaternion.reduce((sum, value) => sum + value * value, 0);
    return normSquared >= 0.8 && normSquared <= 1.2;
  };
  if (args.p.length !== BODY_FLOATS) return false;
  for (let offset = 0; offset < args.p.length; offset += 7) {
    if (!args.p.slice(offset, offset + 3).every((value) => finiteIn(value, -MAX_ABS_WORLD_VALUE, MAX_ABS_WORLD_VALUE)) ||
      !validQuaternion(args.p, offset + 3)) return false;
  }
  if (args.props.length > MAX_PROP_FLOATS || args.props.length % 8 !== 0) return false;
  const propIds = new Set<number>();
  for (let offset = 0; offset < args.props.length; offset += 8) {
    const propId = args.props[offset];
    if (!Number.isInteger(propId) || propId < 0 || propId > 63 || propIds.has(propId)) return false;
    propIds.add(propId);
    if (!args.props.slice(offset + 1, offset + 4).every((value) => finiteIn(value, -MAX_ABS_WORLD_VALUE, MAX_ABS_WORLD_VALUE)) ||
      !validQuaternion(args.props, offset + 4)) return false;
  }
  if (!finiteIn(args.yaw, -Math.PI * 2, Math.PI * 2) || !finiteIn(args.pitch, -Math.PI / 2, Math.PI / 2) ||
    !finiteIn(args.timer, 0, 86_400)) return false;
  if (!validSnapshotEvents(args.ev)) return false;
  return args.msg == null ||
    (args.msg.length <= MAX_MESSAGE_LENGTH && /^(?:good|bad|info)\|[^\u0000-\u001f\u007f]+$/.test(args.msg));
}

/* ---------------------------------- types ---------------------------------- */

const RoleInput = t.object('RoleInput', {
  f: t.f32(), // forward/back axis -1..1
  s: t.f32(), // side axis -1..1
  a: t.bool(), // space
  b: t.bool(), // shift
  q: t.bool(),
  e: t.bool(),
  lx: t.f32(), // head yaw (radians, absolute)
  ly: t.f32(), // head pitch (radians, absolute)
});

/* ---------------------------------- tables ---------------------------------- */

const room = table(
  { name: 'room', public: false },
  {
    code: t.string().primaryKey(),
    phase: t.string(), // 'lobby' | 'countdown' | 'playing' | 'results'
    challenge_id: t.string(),
    squad_size: t.u8(), // 3 or 5
    ffa: t.bool(), // free-for-all: every joiner races their own whole body
    round: t.u32(),
    start_at_micros: t.u64(),
    now_micros: t.u64(),
    next_team_id: t.u32(),
    next_player_seq: t.u64(),
    leader_id: t.option(t.identity()),
  }
);

const player = table(
  { name: 'player', public: false },
  {
    identity: t.identity().primaryKey(),
    code: t.string().index('btree'),
    name: t.string(),
    team_id: t.u64(),
    roles: t.array(t.string()),
    ready: t.bool(),
    solo: t.bool(),
    joined_seq: t.u64(),
    last_seen_micros: t.u64(),
    host_eligible: t.bool(),
  }
);

const team = table(
  { name: 'team', public: false },
  {
    id: t.u64().primaryKey().autoInc(),
    code: t.string().index('btree'),
    name: t.string(),
    color: t.string(),
    host_id: t.option(t.identity()),
    finish_ms: t.option(t.u64()),
  }
);

/** Published by each team's host at ~30Hz; subscribed by everyone else in the room. */
const snapshot = table(
  { name: 'snapshot', public: false },
  {
    team_id: t.u64().primaryKey(),
    code: t.string().index('btree'),
    recv_micros: t.u64(),
    p: t.array(t.f32()), // 11 parts * 7 floats (pos xyz + quat)
    props: t.array(t.f32()), // propId, pos xyz, quat xyzw per prop
    yaw: t.f32(),
    pitch: t.f32(),
    timer: t.f32(),
    fallen: t.bool(),
    score: t.u32(),
    ev: t.string(), // JSON array of sound/FX events since last snapshot
    msg: t.option(t.string()), // "tone|text" toast from the host
    round: t.u32(),
    sequence: t.u64(),
  }
);

/** Per-role control inputs, written by non-host players, consumed by their team host. */
const input = table(
  { name: 'input', public: false },
  {
    identity: t.identity().primaryKey(),
    code: t.string().index('btree'),
    team_id: t.u64(),
    roles: t.array(t.string()),
    inputs: t.array(RoleInput),
    recv_micros: t.u64(),
  }
);

/** Each team's roster when a round begins, so a dropped player can rejoin mid-round. */
const round_roster = table(
  { name: 'round_roster', public: false },
  {
    team_id: t.u64().primaryKey(),
    code: t.string().index('btree'),
    round: t.u32(),
    player_ids: t.array(t.identity()),
  }
);

/** One-shot scheduled timers: countdown, first-finish grace, and absolute round cap. */
const round_timer = table(
  { name: 'round_timer', scheduled: (): any => onRoundTimer },
  {
    scheduled_id: t.u64().primaryKey().autoInc(),
    scheduled_at: t.scheduleAt(),
    code: t.string(),
    round: t.u32(),
    kind: t.string(),
  }
);

/** Recurring maintenance tick (stale player/room cleanup). */
const cleanup_timer = table(
  { name: 'cleanup_timer', scheduled: (): any => onCleanup },
  {
    scheduled_id: t.u64().primaryKey().autoInc(),
    scheduled_at: t.scheduleAt(),
  }
);

/** Fast recurring sweep so a backgrounded client cannot leave controls latched. */
const input_cleanup_timer = table(
  { name: 'input_cleanup_timer', scheduled: (): any => onInputCleanup },
  {
    scheduled_id: t.u64().primaryKey().autoInc(),
    scheduled_at: t.scheduleAt(),
  }
);

/** Private live connection inventory. Connection ids are never gameplay data. */
const conn = table(
  { name: 'conn', public: false },
  {
    connection_id: t.connectionId().primaryKey(),
    identity: t.identity().index('btree'),
    host_eligible: t.bool(),
  }
);

/** The only connection currently allowed to mutate state for an identity. */
const connection_lease = table(
  { name: 'connection_lease', public: false },
  {
    identity: t.identity().primaryKey(),
    connection_id: t.connectionId(),
  }
);

/** Keeps membership reserved briefly after the active connection disappears. */
const reconnect_grace = table(
  { name: 'reconnect_grace', public: false },
  {
    identity: t.identity().primaryKey(),
    disconnected_at_micros: t.u64(),
  }
);

/** Per-identity relay ceilings; private implementation metadata. */
const relay_limit = table(
  { name: 'relay_limit', public: false },
  {
    identity: t.identity().primaryKey(),
    input_micros: t.u64(),
    snapshot_micros: t.u64(),
  }
);

const spacetimedb = schema({
  room,
  player,
  team,
  snapshot,
  input,
  round_roster,
  round_timer,
  cleanup_timer,
  input_cleanup_timer,
  conn,
  connection_lease,
  reconnect_grace,
  relay_limit,
});
export default spacetimedb;

// Caller-scoped views: the underlying tables stay private, so a client only
// ever sees the room it joined — never other room codes or identities.
export const visibleRoom = spacetimedb.view(
  { name: 'visible_room', public: true },
  t.option(room.rowType),
  (ctx) => {
    const me = ctx.db.player.identity.find(ctx.sender);
    return me ? ctx.db.room.code.find(me.code) ?? undefined : undefined;
  }
);

export const visiblePlayer = spacetimedb.view(
  { name: 'visible_player', public: true },
  t.array(player.rowType),
  (ctx) => {
    const me = ctx.db.player.identity.find(ctx.sender);
    return me ? [...ctx.db.player.code.filter(me.code)] : [];
  }
);

export const visibleTeam = spacetimedb.view(
  { name: 'visible_team', public: true },
  t.array(team.rowType),
  (ctx) => {
    const me = ctx.db.player.identity.find(ctx.sender);
    return me ? [...ctx.db.team.code.filter(me.code)] : [];
  }
);

export const visibleSnapshot = spacetimedb.view(
  { name: 'visible_snapshot', public: true },
  t.array(snapshot.rowType),
  (ctx) => {
    const me = ctx.db.player.identity.find(ctx.sender);
    return me ? [...ctx.db.snapshot.code.filter(me.code)] : [];
  }
);

export const visibleInput = spacetimedb.view(
  { name: 'visible_input', public: true },
  t.array(input.rowType),
  (ctx) => {
    const me = ctx.db.player.identity.find(ctx.sender);
    return me ? [...ctx.db.input.code.filter(me.code)] : [];
  }
);

/* ---------------------------------- helpers (unexported) ---------------------------------- */

function normCode(code: string): string {
  return code.trim().toUpperCase();
}

function nowMicros(ctx: { timestamp: { microsSinceUnixEpoch: bigint } }): bigint {
  return ctx.timestamp.microsSinceUnixEpoch;
}

function isActiveConnection(ctx: any): boolean {
  if (!ctx.connectionId) return false;
  const lease = ctx.db.connection_lease.identity.find(ctx.sender);
  return lease != null && lease.connection_id.equals(ctx.connectionId);
}

function isConnected(ctx: any, identity: any): boolean {
  return ctx.db.connection_lease.identity.find(identity) != null;
}

function clearInput(ctx: any, identity: any) {
  ctx.db.input.identity.delete(identity);
}

function relayAllowed(ctx: any, kind: 'input' | 'snapshot', micros: bigint): boolean {
  const existing = ctx.db.relay_limit.identity.find(ctx.sender);
  const minInterval = kind === 'input' ? INPUT_MIN_INTERVAL_MICROS : SNAPSHOT_MIN_INTERVAL_MICROS;
  if (existing) {
    const previous = kind === 'input' ? existing.input_micros : existing.snapshot_micros;
    if (previous !== 0n && micros >= previous && micros - previous < minInterval) return false;
    if (kind === 'input') existing.input_micros = micros;
    else existing.snapshot_micros = micros;
    ctx.db.relay_limit.identity.update(existing);
  } else {
    ctx.db.relay_limit.insert({
      identity: ctx.sender,
      input_micros: kind === 'input' ? micros : 0n,
      snapshot_micros: kind === 'snapshot' ? micros : 0n,
    });
  }
  return true;
}

function touchRoom(ctx: any, r: any, micros: bigint) {
  if (!r) return;
  r.now_micros = micros;
  r.leader_id = leaderOf(ctx, r.code)?.identity;
  ctx.db.room.code.update(r);
}

function playersIn(ctx: any, code: string) {
  return [...ctx.db.player.code.filter(code)];
}

function teamsIn(ctx: any, code: string) {
  return [...ctx.db.team.code.filter(code)];
}

function storeSnapshot(ctx: any, playerRow: any, teamRow: any, roomRow: any, args: SnapshotPayload, micros: bigint) {
  const existing = ctx.db.snapshot.team_id.find(teamRow.id);
  const sequence = existing?.round === roomRow.round ? existing.sequence + 1n : 1n;
  const row = {
    team_id: teamRow.id,
    code: playerRow.code,
    recv_micros: micros,
    round: roomRow.round,
    sequence,
    p: args.p,
    props: args.props,
    yaw: args.yaw,
    pitch: args.pitch,
    timer: args.timer,
    fallen: args.fallen,
    score: args.score,
    ev: args.ev,
    msg: args.msg,
  };
  if (existing) ctx.db.snapshot.team_id.update(row);
  else ctx.db.snapshot.insert(row);
}

function bySeq(a: any, b: any): number {
  return a.joined_seq < b.joined_seq ? -1 : a.joined_seq > b.joined_seq ? 1 : 0;
}

function earliest(members: any[]): any | null {
  let best: any | null = null;
  for (const m of members) if (!best || m.joined_seq < best.joined_seq) best = m;
  return best;
}

function leaderOf(ctx: any, code: string): any | null {
  return earliest(playersIn(ctx, code).filter((member: any) =>
    isConnected(ctx, member.identity) && member.host_eligible
  ));
}

/** Reassign team hosts after membership changes; delete teams with no members. */
function fixHosts(ctx: any, code: string) {
  for (const tm of teamsIn(ctx, code)) {
    const members = playersIn(ctx, code).filter((p: any) => p.team_id === tm.id);
    if (members.length === 0) {
      ctx.db.round_roster.team_id.delete(tm.id);
      ctx.db.snapshot.team_id.delete(tm.id);
      ctx.db.team.id.delete(tm.id);
      continue;
    }
    const connectedMembers = members.filter((member: any) =>
      isConnected(ctx, member.identity) && member.host_eligible
    );
    const hostOk = tm.host_id != null && connectedMembers.some((m: any) => m.identity.equals(tm.host_id!));
    if (!hostOk) {
      const host = earliest(connectedMembers);
      tm.host_id = host ? host.identity : undefined;
      ctx.db.team.id.update(tm);
      if (host) clearInput(ctx, host.identity);
    }
  }
}

/** Remove a player; clean up their input row, host pointers, and empty rooms. */
function removePlayer(ctx: any, identity: any, micros: bigint) {
  const p = ctx.db.player.identity.find(identity);
  if (!p) return;
  const code = p.code;
  ctx.db.player.identity.delete(identity);
  clearInput(ctx, identity);
  ctx.db.reconnect_grace.identity.delete(identity);
  ctx.db.relay_limit.identity.delete(identity);
  fixHosts(ctx, code);
  if (playersIn(ctx, code).length === 0) deleteRoom(ctx, code);
  else touchRoom(ctx, ctx.db.room.code.find(code), micros);
}

function deleteRoom(ctx: any, code: string) {
  for (const tm of teamsIn(ctx, code)) {
    ctx.db.round_roster.team_id.delete(tm.id);
    ctx.db.team.id.delete(tm.id);
  }
  for (const s of [...ctx.db.snapshot.code.filter(code)]) ctx.db.snapshot.team_id.delete(s.team_id);
  for (const i of [...ctx.db.input.code.filter(code)]) ctx.db.input.identity.delete(i.identity);
  for (const rt of [...ctx.db.round_timer.iter()]) if (rt.code === code) ctx.db.round_timer.scheduled_id.delete(rt.scheduled_id);
  ctx.db.room.code.delete(code);
}

function squadRolesOf(r: any): string[] {
  return r.squad_size === 3 ? SQUAD_3 : SQUAD_5;
}

/** Auto-assign the first free role on a team; returns the assigned roles array. */
function pickFreeRole(ctx: any, r: any, teamId: bigint): string[] {
  const taken = new Set(
    playersIn(ctx, r.code)
      .filter((p: any) => p.team_id === teamId)
      .flatMap((p: any) => p.roles)
  );
  for (const role of squadRolesOf(r)) if (!taken.has(role)) return [role];
  return [];
}

/** Versus squads are numbered "Team N"; free-for-all racers get a team named after themselves. */
function newTeam(ctx: any, code: string, racerName?: string): any {
  const r = ctx.db.room.code.find(code);
  const seq = r.next_team_id;
  r.next_team_id += 1;
  ctx.db.room.code.update(r);
  const existing = teamsIn(ctx, code);
  const usedColors = new Set(existing.map((tm: any) => tm.color));
  const preferredColor = (seq - 1) % TEAM_COLORS.length;
  let color = TEAM_COLORS[preferredColor];
  for (let offset = 0; offset < TEAM_COLORS.length; offset++) {
    const candidate = TEAM_COLORS[(preferredColor + offset) % TEAM_COLORS.length];
    if (!usedColors.has(candidate)) {
      color = candidate;
      break;
    }
  }
  return ctx.db.team.insert({
    id: 0n,
    code,
    name: pickTeamName(existing.map((tm: any) => tm.name), racerName),
    color,
    host_id: undefined,
    finish_ms: undefined,
  });
}

/* ---------------------------------- lifecycle ---------------------------------- */

function ensureMaintenanceSchedules(ctx: any) {
  if (ctx.db.cleanup_timer.count() === 0n) {
    ctx.db.cleanup_timer.insert({ scheduled_id: 0n, scheduled_at: ScheduleAt.interval(CLEANUP_INTERVAL_MICROS) });
  }
  if (ctx.db.input_cleanup_timer.count() === 0n) {
    ctx.db.input_cleanup_timer.insert({ scheduled_id: 0n, scheduled_at: ScheduleAt.interval(INPUT_SWEEP_INTERVAL_MICROS) });
  }
}

export const init = spacetimedb.init((ctx) => {
  ensureMaintenanceSchedules(ctx);
});

export const clientConnected = spacetimedb.clientConnected((ctx) => {
  // A no-delete republish skips `init`; the first connection self-heals schedules.
  ensureMaintenanceSchedules(ctx);
  if (!ctx.connectionId) return;
  ctx.db.conn.insert({ connection_id: ctx.connectionId, identity: ctx.sender, host_eligible: true });
  const lease = ctx.db.connection_lease.identity.find(ctx.sender);
  if (lease) {
    lease.connection_id = ctx.connectionId;
    ctx.db.connection_lease.identity.update(lease);
  } else {
    ctx.db.connection_lease.insert({ identity: ctx.sender, connection_id: ctx.connectionId });
  }
  ctx.db.reconnect_grace.identity.delete(ctx.sender);
  const p = ctx.db.player.identity.find(ctx.sender);
  if (p) {
    p.host_eligible = true;
    ctx.db.player.identity.update(p);
    fixHosts(ctx, p.code);
    touchRoom(ctx, ctx.db.room.code.find(p.code), nowMicros(ctx));
  }
});

export const clientDisconnected = spacetimedb.clientDisconnected((ctx) => {
  const micros = nowMicros(ctx);
  if (ctx.connectionId) ctx.db.conn.connection_id.delete(ctx.connectionId);
  const lease = ctx.db.connection_lease.identity.find(ctx.sender);
  if (!ctx.connectionId || !lease || !lease.connection_id.equals(ctx.connectionId)) return;
  const remaining = [...ctx.db.conn.identity.filter(ctx.sender)];
  const p = ctx.db.player.identity.find(ctx.sender);
  if (remaining.length > 0) {
    const promoted = remaining[0];
    lease.connection_id = promoted.connection_id;
    ctx.db.connection_lease.identity.update(lease);
    if (p) {
      p.host_eligible = promoted.host_eligible;
      ctx.db.player.identity.update(p);
      fixHosts(ctx, p.code);
      touchRoom(ctx, ctx.db.room.code.find(p.code), micros);
    }
    return;
  }
  ctx.db.connection_lease.identity.delete(ctx.sender);
  clearInput(ctx, ctx.sender);
  if (p) {
    p.last_seen_micros = micros;
    ctx.db.player.identity.update(p);
    const grace = ctx.db.reconnect_grace.identity.find(ctx.sender);
    if (grace) {
      grace.disconnected_at_micros = micros;
      ctx.db.reconnect_grace.identity.update(grace);
    } else {
      ctx.db.reconnect_grace.insert({ identity: ctx.sender, disconnected_at_micros: micros });
    }
    fixHosts(ctx, p.code);
    touchRoom(ctx, ctx.db.room.code.find(p.code), micros);
  }
});

/* ---------------------------------- room lifecycle reducers ---------------------------------- */

export const joinRoom = spacetimedb.reducer(
  { code: t.string(), name: t.string(), solo: t.bool() },
  (ctx, { code: rawCode, name, solo: soloFlag }) => {
    if (!isActiveConnection(ctx)) return;
    const micros = nowMicros(ctx);
    const code = normCode(rawCode);
    if (!ROOM_CODE.test(code)) return;
    const foundRoom = ctx.db.room.code.find(code);
    // New rooms use the full 8-character code; shorter codes only join existing rooms.
    if (!foundRoom && code.length !== NEW_ROOM_CODE_LENGTH) return;
    let existing = ctx.db.player.identity.find(ctx.sender);
    if (existing && existing.code !== code) {
      const previousRoom = ctx.db.room.code.find(existing.code);
      if (previousRoom && (previousRoom.phase === 'countdown' || previousRoom.phase === 'playing')) return;
      removePlayer(ctx, ctx.sender, micros);
      existing = null;
    }
    const r = foundRoom ?? ctx.db.room.insert({
      code,
      phase: 'lobby',
      challenge_id: 'wobble-run',
      // The free-for-all creator fixes the room's mode; solo bodies use the 3P mapping.
      squad_size: soloFlag ? 3 : 5,
      ffa: soloFlag,
      round: 0,
      start_at_micros: 0n,
      now_micros: micros,
      next_team_id: 1,
      next_player_seq: 0n,
      leader_id: undefined,
    });
    // Friends who follow a plain invite link into a free-for-all room race solo too.
    const solo = soloFlag || r.ffa;
    const displayName = name.trim().slice(0, 16) || 'Player';
    if (existing) {
      existing.name = displayName;
      existing.last_seen_micros = micros;
      ctx.db.player.identity.update(existing);
      fixHosts(ctx, existing.code);
      touchRoom(ctx, ctx.db.room.code.find(code), micros);
      return;
    }

    let tm: any;
    let roles: string[] = [];
    let ready = false;
    const cap = r.squad_size;
    const activeRound = r.phase === 'countdown' || r.phase === 'playing';
    if (activeRound) {
      // Mid-round joins are only allowed to restore a dropped racer's seat.
      const roster = [...ctx.db.round_roster.code.filter(code)].find((entry: any) =>
        entry.round === r.round && entry.player_ids.some((identity: any) => identity.equals(ctx.sender))
      );
      tm = roster ? ctx.db.team.id.find(roster.team_id) : undefined;
      if (!tm || tm.code !== code) return;
      if (playersIn(ctx, code).filter((member: any) => member.team_id === tm.id).length >= cap) return;
      roles = solo ? [...squadRolesOf(r)] : pickFreeRole(ctx, r, tm.id);
      ready = true;
    } else if (solo) {
      if (teamsIn(ctx, code).length >= MAX_TEAMS) return;
      tm = newTeam(ctx, code, displayName);
      roles = [...squadRolesOf(r)];
      ready = true;
    } else {
      // Fill the fullest team that still has a free seat, else start a new team.
      const counts = new Map<bigint, number>();
      for (const p of playersIn(ctx, code)) counts.set(p.team_id, (counts.get(p.team_id) ?? 0) + 1);
      const candidates = teamsIn(ctx, code)
        .filter((candidate: any) => (counts.get(candidate.id) ?? 0) < cap)
        .sort((a: any, b: any) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0));
      if (candidates.length > 0) tm = candidates[candidates.length - 1];
      else {
        if (teamsIn(ctx, code).length >= MAX_TEAMS) return;
        tm = newTeam(ctx, code);
      }
      roles = pickFreeRole(ctx, r, tm.id);
    }
    const room = ctx.db.room.code.find(code)!;
    const seq = room.next_player_seq;
    room.next_player_seq += 1n;
    ctx.db.room.code.update(room);
    const connection = ctx.connectionId ? ctx.db.conn.connection_id.find(ctx.connectionId) : undefined;
    ctx.db.player.insert({
      identity: ctx.sender,
      code,
      name: displayName,
      team_id: tm.id,
      roles,
      ready,
      solo,
      joined_seq: seq,
      last_seen_micros: micros,
      host_eligible: connection?.host_eligible ?? true,
    });
    fixHosts(ctx, code);
    touchRoom(ctx, ctx.db.room.code.find(code), micros);
  }
);

/** Periodic presence ping. */
export const heartbeat = spacetimedb.reducer((ctx) => {
  if (!isActiveConnection(ctx)) return;
  const micros = nowMicros(ctx);
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p) return;
  p.last_seen_micros = micros;
  ctx.db.player.identity.update(p);
  touchRoom(ctx, ctx.db.room.code.find(p.code), micros);
});

export const leaveRoom = spacetimedb.reducer((ctx) => {
  if (!isActiveConnection(ctx)) return;
  removePlayer(ctx, ctx.sender, nowMicros(ctx));
});

export const setRole = spacetimedb.reducer({ role: t.string() }, (ctx, { role }) => {
  if (!isActiveConnection(ctx)) return;
  if (!ROLES.has(role)) return;
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p || p.solo) return;
  const r = ctx.db.room.code.find(p.code);
  if (!r || r.phase !== 'lobby') return;
  // Only the current squad's roles (plus legacy head, which maps onto the torso camera).
  if (!squadRolesOf(r).includes(role) && role !== 'head') return;
  if (p.roles.includes(role)) {
    p.roles = p.roles.filter((x: string) => x !== role);
  } else {
    // Take the role from a teammate if it is already claimed.
    for (const other of playersIn(ctx, p.code)) {
      if (other.team_id === p.team_id && !other.identity.equals(ctx.sender) && other.roles.includes(role)) {
        other.roles = other.roles.filter((x: string) => x !== role);
        clearInput(ctx, other.identity);
        ctx.db.player.identity.update(other);
      }
    }
    p.roles = [...p.roles, role];
  }
  clearInput(ctx, ctx.sender);
  ctx.db.player.identity.update(p);
  touchRoom(ctx, r, nowMicros(ctx));
});

export const joinTeam = spacetimedb.reducer({ teamId: t.u64() }, (ctx, { teamId }) => {
  if (!isActiveConnection(ctx)) return;
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p || p.solo) return;
  const r = ctx.db.room.code.find(p.code);
  if (!r || r.phase !== 'lobby') return;
  const tm = ctx.db.team.id.find(teamId);
  if (!tm || tm.code !== p.code || tm.id === p.team_id) return;
  const members = playersIn(ctx, p.code).filter((x: any) => x.team_id === tm.id);
  if (members.length >= r.squad_size) return;
  p.team_id = tm.id;
  const taken = new Set(members.flatMap((x: any) => x.roles));
  p.roles = p.roles.filter((role: string) => !taken.has(role));
  if (p.roles.length === 0) p.roles = pickFreeRole(ctx, r, tm.id);
  p.ready = false;
  clearInput(ctx, ctx.sender);
  ctx.db.player.identity.update(p);
  fixHosts(ctx, p.code);
  touchRoom(ctx, ctx.db.room.code.find(p.code), nowMicros(ctx));
});

export const createTeam = spacetimedb.reducer((ctx) => {
  if (!isActiveConnection(ctx)) return;
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p || p.solo) return;
  const r = ctx.db.room.code.find(p.code);
  if (!r || r.phase !== 'lobby') return;
  if (teamsIn(ctx, p.code).length >= MAX_TEAMS) return;
  const tm = newTeam(ctx, p.code);
  p.team_id = tm.id;
  p.roles = pickFreeRole(ctx, r, tm.id);
  p.ready = false;
  clearInput(ctx, ctx.sender);
  ctx.db.player.identity.update(p);
  fixHosts(ctx, p.code);
  touchRoom(ctx, ctx.db.room.code.find(p.code), nowMicros(ctx));
});

export const renameTeam = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
  if (!isActiveConnection(ctx)) return;
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p) return;
  const r = ctx.db.room.code.find(p.code);
  if (!r || r.phase !== 'lobby') return;
  const tm = ctx.db.team.id.find(p.team_id);
  if (!tm || tm.code !== p.code || tm.host_id == null || !tm.host_id.equals(ctx.sender)) return;

  const normalized = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ');
  if (normalized.length < 2 || normalized.length > MAX_TEAM_NAME_LENGTH) {
    throw new SenderError(`Team names must be between 2 and ${MAX_TEAM_NAME_LENGTH} characters.`);
  }
  const key = normalized.toLowerCase();
  if (teamsIn(ctx, p.code).some((other: any) => other.id !== tm.id && other.name.toLowerCase() === key)) {
    throw new SenderError('That team name is already taken in this room.');
  }
  if (tm.name === normalized) return;
  tm.name = normalized;
  ctx.db.team.id.update(tm);
  touchRoom(ctx, r, nowMicros(ctx));
});

/** Let a backgrounding host hand simulation to a connected teammate. */
export const yieldHost = spacetimedb.reducer((ctx) => {
  if (!isActiveConnection(ctx)) return;
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p) return;
  const tm = ctx.db.team.id.find(p.team_id);
  if (!tm || tm.host_id == null || !tm.host_id.equals(ctx.sender)) return;
  const successor = earliest(
    playersIn(ctx, p.code).filter((member: any) =>
      member.team_id === tm.id && !member.identity.equals(ctx.sender) &&
      isConnected(ctx, member.identity) && member.host_eligible
    )
  );
  if (!successor) return;
  tm.host_id = successor.identity;
  ctx.db.team.id.update(tm);
  clearInput(ctx, successor.identity);
  touchRoom(ctx, ctx.db.room.code.find(p.code), nowMicros(ctx));
});

/** Advertise whether this connection can currently run team physics (hidden tabs cannot). */
export const setHostEligible = spacetimedb.reducer({ eligible: t.bool() }, (ctx, { eligible }) => {
  if (!ctx.connectionId) return;
  const connection = ctx.db.conn.connection_id.find(ctx.connectionId);
  if (!connection || !connection.identity.equals(ctx.sender)) return;
  connection.host_eligible = eligible;
  ctx.db.conn.connection_id.update(connection);

  // Every connection remembers its own visibility, but only the active lease
  // may project that value onto identity-level gameplay state.
  if (!isActiveConnection(ctx)) return;
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p || p.host_eligible === eligible) return;
  p.host_eligible = eligible;
  ctx.db.player.identity.update(p);
  fixHosts(ctx, p.code);
  touchRoom(ctx, ctx.db.room.code.find(p.code), nowMicros(ctx));
});

export const setReady = spacetimedb.reducer({ ready: t.bool() }, (ctx, { ready }) => {
  if (!isActiveConnection(ctx)) return;
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p) return;
  const r = ctx.db.room.code.find(p.code);
  if (!r || r.phase !== 'lobby') return;
  p.ready = ready;
  ctx.db.player.identity.update(p);
  touchRoom(ctx, r, nowMicros(ctx));
});

export const setChallenge = spacetimedb.reducer({ challengeId: t.string() }, (ctx, { challengeId }) => {
  if (!isActiveConnection(ctx)) return;
  if (!CHALLENGE_IDS.has(challengeId)) return;
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p) return;
  const r = ctx.db.room.code.find(p.code);
  const leader = leaderOf(ctx, p.code);
  if (!r || r.phase !== 'lobby' || !leader || !leader.identity.equals(ctx.sender)) return;
  if (r.challenge_id === challengeId) return;
  r.challenge_id = challengeId;
  ctx.db.room.code.update(r);
  for (const other of playersIn(ctx, p.code)) {
    if (other.solo) continue;
    other.ready = false;
    ctx.db.player.identity.update(other);
  }
  touchRoom(ctx, ctx.db.room.code.find(p.code), nowMicros(ctx));
});

/** Leader-only squad switch (3 or 5 players). Clears role picks; everyone re-picks. */
export const setSquad = spacetimedb.reducer({ size: t.u8() }, (ctx, { size }) => {
  if (!isActiveConnection(ctx)) return;
  if (size !== 3 && size !== 5) return;
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p) return;
  const r = ctx.db.room.code.find(p.code);
  const leader = leaderOf(ctx, p.code);
  if (!r || r.ffa || r.phase !== 'lobby' || !leader || !leader.identity.equals(ctx.sender)) return;
  if (r.squad_size === size) return;
  if (size === 3 && teamsIn(ctx, p.code).some((tm: any) =>
    playersIn(ctx, p.code).filter((member: any) => member.team_id === tm.id).length > 3
  )) return;
  r.squad_size = size;
  ctx.db.room.code.update(r);
  const roles = squadRolesOf(r);
  for (const tm of teamsIn(ctx, p.code)) {
    const members = playersIn(ctx, p.code).filter((m: any) => m.team_id === tm.id).sort(bySeq);
    members.forEach((m: any, index: number) => {
      m.roles = index < roles.length ? [roles[index]] : [];
      m.ready = false;
      clearInput(ctx, m.identity);
      ctx.db.player.identity.update(m);
    });
  }
  touchRoom(ctx, ctx.db.room.code.find(p.code), nowMicros(ctx));
});

export const startRound = spacetimedb.reducer({ force: t.bool() }, (ctx, { force }) => {
  if (!isActiveConnection(ctx)) return;
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p) return;
  const r = ctx.db.room.code.find(p.code);
  const leader = leaderOf(ctx, p.code);
  if (!r || !leader || !leader.identity.equals(ctx.sender)) return;
  if (r.phase === 'countdown' || r.phase === 'playing') return;
  const members = playersIn(ctx, p.code);
  if (!force && members.some((m: any) => !m.ready)) return;
  const round = r.round + 1;

  // Auto-assign uncovered roles per team to whoever holds the fewest.
  for (const tm of teamsIn(ctx, p.code)) {
    const teamMembers = members.filter((m: any) => m.team_id === tm.id).sort(bySeq);
    if (teamMembers.length === 0) continue;
    const taken = new Set(teamMembers.flatMap((m: any) => m.roles));
    for (const role of squadRolesOf(r)) {
      if (taken.has(role)) continue;
      const target = [...teamMembers].sort((a: any, b: any) => a.roles.length - b.roles.length)[0];
      target.roles = [...target.roles, role];
      ctx.db.player.identity.update(target);
    }
    tm.finish_ms = undefined;
    ctx.db.team.id.update(tm);
    ctx.db.snapshot.team_id.delete(tm.id);

    const roster = { team_id: tm.id, code: p.code, round, player_ids: teamMembers.map((m: any) => m.identity) };
    if (ctx.db.round_roster.team_id.find(tm.id)) ctx.db.round_roster.team_id.update(roster);
    else ctx.db.round_roster.insert(roster);
  }

  const micros = nowMicros(ctx);
  const startAt = micros + COUNTDOWN_MICROS;
  for (const rt of [...ctx.db.round_timer.iter()]) {
    if (rt.code === p.code) ctx.db.round_timer.scheduled_id.delete(rt.scheduled_id);
  }
  r.round = round;
  r.phase = 'countdown';
  r.start_at_micros = startAt;
  ctx.db.room.code.update(r);
  ctx.db.round_timer.insert({ scheduled_id: 0n, scheduled_at: ScheduleAt.time(startAt), code: p.code, round, kind: 'start' });
  ctx.db.round_timer.insert({
    scheduled_id: 0n,
    scheduled_at: ScheduleAt.time(startAt + ROUND_TIMEOUT_MICROS),
    code: p.code,
    round,
    kind: 'timeout',
  });
  touchRoom(ctx, ctx.db.room.code.find(p.code), micros);
});

/**
 * The team host reports that its simulation reached the objective. The server
 * stamps the duration from its own scheduled start, so every client agrees on
 * the time even if their local clocks drift.
 */
export const finishRun = spacetimedb.reducer({ round: t.u32() }, (ctx, { round }) => {
  if (!isActiveConnection(ctx)) return;
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p) return;
  const r = ctx.db.room.code.find(p.code);
  if (!r || r.phase !== 'playing' || r.round !== round) return;
  const tm = ctx.db.team.id.find(p.team_id);
  if (!tm || tm.finish_ms != null || tm.host_id == null || !tm.host_id.equals(ctx.sender)) return;
  const micros = nowMicros(ctx);
  tm.finish_ms = micros >= r.start_at_micros ? (micros - r.start_at_micros) / 1000n : 0n;
  ctx.db.team.id.update(tm);

  if (teamsIn(ctx, p.code).every((x: any) => x.finish_ms != null)) {
    r.phase = 'results';
    ctx.db.room.code.update(r);
  } else {
    const hasGrace = [...ctx.db.round_timer.iter()].some((timer: any) =>
      timer.code === p.code && timer.round === r.round && timer.kind === 'grace'
    );
    if (!hasGrace) {
      ctx.db.round_timer.insert({
        scheduled_id: 0n,
        scheduled_at: ScheduleAt.time(micros + GRACE_MICROS),
        code: p.code,
        round: r.round,
        kind: 'grace',
      });
    }
  }
  touchRoom(ctx, ctx.db.room.code.find(p.code), micros);
});

export const backToLobby = spacetimedb.reducer((ctx) => {
  if (!isActiveConnection(ctx)) return;
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p) return;
  const r = ctx.db.room.code.find(p.code);
  const leader = leaderOf(ctx, p.code);
  if (!r || !leader || !leader.identity.equals(ctx.sender)) return;
  for (const rt of [...ctx.db.round_timer.iter()]) {
    if (rt.code === p.code) ctx.db.round_timer.scheduled_id.delete(rt.scheduled_id);
  }
  r.phase = 'lobby';
  r.start_at_micros = 0n;
  ctx.db.room.code.update(r);
  for (const other of playersIn(ctx, p.code)) {
    other.ready = other.solo;
    ctx.db.player.identity.update(other);
  }
  for (const tm of teamsIn(ctx, p.code)) {
    tm.finish_ms = undefined;
    ctx.db.team.id.update(tm);
    ctx.db.snapshot.team_id.delete(tm.id);
  }
  touchRoom(ctx, ctx.db.room.code.find(p.code), nowMicros(ctx));
});

/* ---------------------------------- gameplay relay reducers ---------------------------------- */

export const sendInput = spacetimedb.reducer(
  { roles: t.array(t.string()), inputs: t.array(RoleInput) },
  (ctx, { roles, inputs }) => {
    if (!isActiveConnection(ctx)) return;
    if (roles.length !== inputs.length || roles.length === 0 || roles.length > SQUAD_5.length) return;
    if (new Set(roles).size !== roles.length || !roles.every((x) => ROLES.has(x)) || !inputs.every(validRoleInput)) return;
    const p = ctx.db.player.identity.find(ctx.sender);
    if (!p) return;
    const assigned = new Set(p.roles);
    if (!roles.every((role) => assigned.has(role))) return;
    const tm = ctx.db.team.id.find(p.team_id);
    if (!tm) return;
    // The team host applies its own inputs locally.
    if (tm.host_id != null && tm.host_id.equals(ctx.sender)) return;
    const micros = nowMicros(ctx);
    if (!relayAllowed(ctx, 'input', micros)) return;
    const row = { identity: ctx.sender, code: p.code, team_id: tm.id, roles, inputs, recv_micros: micros };
    if (ctx.db.input.identity.find(ctx.sender)) ctx.db.input.identity.update(row);
    else ctx.db.input.insert(row);
  }
);

export const publishSnapshot = spacetimedb.reducer(
  {
    round: t.u32(),
    p: t.array(t.f32()),
    props: t.array(t.f32()),
    yaw: t.f32(),
    pitch: t.f32(),
    timer: t.f32(),
    fallen: t.bool(),
    score: t.u32(),
    ev: t.string(),
    msg: t.option(t.string()),
  },
  (ctx, args) => {
    if (!isActiveConnection(ctx) || !validSnapshot(args)) return;
    const p = ctx.db.player.identity.find(ctx.sender);
    if (!p) return;
    const tm = ctx.db.team.id.find(p.team_id);
    if (!tm || tm.host_id == null || !tm.host_id.equals(ctx.sender)) return;
    const r = ctx.db.room.code.find(p.code);
    if (!r || args.round !== r.round || (r.phase !== 'countdown' && r.phase !== 'playing')) return;
    const micros = nowMicros(ctx);
    if (!relayAllowed(ctx, 'snapshot', micros)) return;
    storeSnapshot(ctx, p, tm, r, args, micros);
  }
);

/* ---------------------------------- scheduled reducers ---------------------------------- */

export const onRoundTimer = spacetimedb.reducer({ timer: round_timer.rowType }, (ctx, { timer }) => {
  const r = ctx.db.room.code.find(timer.code);
  if (!r || r.round !== timer.round) return;
  if (timer.kind === 'start' && r.phase === 'countdown') {
    r.phase = 'playing';
    ctx.db.room.code.update(r);
  } else if ((timer.kind === 'grace' || timer.kind === 'timeout') && r.phase === 'playing') {
    r.phase = 'results';
    ctx.db.room.code.update(r);
  }
  touchRoom(ctx, ctx.db.room.code.find(timer.code), nowMicros(ctx));
});

export const onCleanup = spacetimedb.reducer({ _timer: cleanup_timer.rowType }, (ctx) => {
  const micros = nowMicros(ctx);
  for (const p of [...ctx.db.player.iter()]) {
    const grace = ctx.db.reconnect_grace.identity.find(p.identity);
    const graceExpired = grace != null && !isConnected(ctx, p.identity) && micros >= grace.disconnected_at_micros &&
      micros - grace.disconnected_at_micros > RECONNECT_GRACE_MICROS;
    const heartbeatExpired = isConnected(ctx, p.identity) && micros >= p.last_seen_micros &&
      micros - p.last_seen_micros > STALE_MICROS;
    if (graceExpired || heartbeatExpired) removePlayer(ctx, p.identity, micros);
  }
});

export const onInputCleanup = spacetimedb.reducer({ _timer: input_cleanup_timer.rowType }, (ctx) => {
  const micros = nowMicros(ctx);
  for (const row of [...ctx.db.input.iter()]) {
    if (micros >= row.recv_micros && micros - row.recv_micros > INPUT_TTL_MICROS) {
      ctx.db.input.identity.delete(row.identity);
    }
  }
});
