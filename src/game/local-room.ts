/*
 * Browser-only temp room store for SINGULARITY.
 *
 * Replaces the old SpacetimeDB live tables (room/player/team/squad): lobby,
 * teams, roles, ready-up and the round lifecycle live in tab memory and are
 * lost on reload. Only final leaderboard runs are durable (SpacetimeDB).
 */
import { SOLO_ROLES, SOLO_SQUAD } from "./squad";
import {
  CHALLENGES,
  TEAM_COLORS,
  type Phase,
  type PlayerInfo,
  type Role,
  type RoomSnapshot,
  type SquadSize,
  type TeamInfo,
} from "./types";

export const COUNTDOWN_MS = 4200;
const MAX_TEAMS = TEAM_COLORS.length;
const MAX_TEAM_NAME_LENGTH = 22;

const SQUAD_3: Role[] = ["arms", "torso", "legs"];
const SQUAD_5: Role[] = ["lhand", "rhand", "torso", "lleg", "rleg"];

const squadRoles = (squad: SquadSize): Role[] => (squad === 3 ? [...SQUAD_3] : [...SQUAD_5]);

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  }
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 0xffffffff).toString(36)}`;
}

function pickTeamName(taken: string[], preferred?: string): string {
  const used = new Set(taken.map((n) => n.toLocaleLowerCase()));
  if (preferred) {
    const p = preferred.trim().replace(/\s+/g, " ").slice(0, MAX_TEAM_NAME_LENGTH);
    if (p.length >= 2 && !used.has(p.toLocaleLowerCase())) return p;
  }
  for (let n = 1; ; n++) {
    const candidate = `Team ${n}`;
    if (!used.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

export interface LocalRoomEvents {
  onChange: (room: RoomSnapshot) => void;
  onTeamFinished: (teamId: number, timeMs: number, teamName: string) => void;
}

/** Single-tab room: one local player, local teams, host always (solo sim). */
export class LocalRoom {
  readonly code: string;
  readonly myId: string;
  readonly solo: boolean;

  private name: string;
  private phase: Phase = "lobby";
  private challengeId = "wobble-run";
  private squadSize: SquadSize;
  private players: PlayerInfo[] = [];
  private teams: TeamInfo[] = [];
  private nextTeamId = 1;
  private round = 0;
  private startAt: number | null = null;
  private countdownTimer: ReturnType<typeof setTimeout> | null = null;
  private events: LocalRoomEvents | null = null;

  constructor(code: string, name: string, solo: boolean) {
    this.code = code.toUpperCase();
    this.myId = randomId();
    this.solo = solo;
    this.name = name.trim().slice(0, 16) || "Player";
    this.squadSize = solo ? SOLO_SQUAD : 5;
    const team: TeamInfo = {
      id: this.nextTeamId++,
      name: solo ? this.name : "Team 1",
      color: TEAM_COLORS[0],
      hostId: this.myId,
      finishMs: null,
    };
    this.teams = [team];
    this.players = [
      {
        id: this.myId,
        name: this.name,
        teamId: team.id,
        roles: solo ? [...SOLO_ROLES] : squadRoles(this.squadSize),
        ready: solo,
        solo,
      },
    ];
  }

  setEvents(events: LocalRoomEvents | null) {
    this.events = events;
  }

  snapshot(): RoomSnapshot {
    return {
      code: this.code,
      phase: this.phase,
      challengeId: this.challengeId,
      squadSize: this.squadSize,
      players: this.players.map((p) => ({ ...p, roles: [...p.roles] })),
      teams: this.teams.map((t) => ({ ...t })),
      startAt: this.startAt,
      round: this.round,
      now: Date.now(),
      leaderId: this.myId,
    };
  }

  private emit() {
    this.events?.onChange(this.snapshot());
  }

  private me(): PlayerInfo {
    return this.players.find((p) => p.id === this.myId)!;
  }

  private myTeam(): TeamInfo {
    return this.teams.find((t) => t.id === this.me().teamId)!;
  }

  // ---------- lobby mutations (leader == me, always allowed in lobby) ----------

  setRole(role: Role) {
    if (this.phase !== "lobby" || this.me().solo) return;
    const me = this.me();
    if (me.roles.includes(role)) {
      if (me.roles.length <= 1) return;
      me.roles = me.roles.filter((r) => r !== role);
    } else {
      me.roles = [...me.roles, role];
    }
    this.emit();
  }

  joinTeam(teamId: number) {
    if (this.phase !== "lobby" || this.me().solo) return;
    const tm = this.teams.find((t) => t.id === teamId);
    if (!tm || tm.id === this.me().teamId) return;
    if (this.players.filter((p) => p.teamId === tm.id).length >= this.squadSize) return;
    const me = this.me();
    me.teamId = tm.id;
    me.roles = squadRoles(this.squadSize);
    me.ready = false;
    tm.hostId = this.myId;
    this.emit();
  }

  createTeam() {
    if (this.phase !== "lobby" || this.me().solo) return;
    if (this.teams.length >= MAX_TEAMS) return;
    const usedColors = new Set(this.teams.map((t) => t.color));
    const color = TEAM_COLORS.find((c) => !usedColors.has(c)) ?? TEAM_COLORS[0];
    const tm: TeamInfo = {
      id: this.nextTeamId++,
      name: pickTeamName(this.teams.map((t) => t.name)),
      color,
      hostId: this.myId,
      finishMs: null,
    };
    this.teams.push(tm);
    const me = this.me();
    me.teamId = tm.id;
    me.roles = squadRoles(this.squadSize);
    me.ready = false;
    this.emit();
  }

  renameTeam(name: string): boolean {
    if (this.phase !== "lobby") return false;
    const normalized = name.replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/\s+/g, " ");
    if (normalized.length < 2 || normalized.length > MAX_TEAM_NAME_LENGTH) return false;
    const key = normalized.toLocaleLowerCase();
    const tm = this.myTeam();
    if (this.teams.some((t) => t.id !== tm.id && t.name.toLocaleLowerCase() === key)) return false;
    tm.name = normalized;
    this.emit();
    return true;
  }

  setReady(ready: boolean) {
    if (this.phase !== "lobby") return;
    this.me().ready = ready;
    this.emit();
  }

  setChallenge(challengeId: string) {
    if (this.phase !== "lobby") return;
    if (!CHALLENGES.some((c) => c.id === challengeId)) return;
    this.challengeId = challengeId;
    for (const p of this.players) p.ready = p.solo ? p.ready : false;
    this.emit();
  }

  setSquad(squadSize: SquadSize) {
    if (this.phase !== "lobby" || this.solo) return;
    if (squadSize !== 3 && squadSize !== 5) return;
    if (squadSize === this.squadSize) return;
    if (squadSize === 3 && this.teams.some((t) => this.players.filter((p) => p.teamId === t.id).length > 3)) return;
    this.squadSize = squadSize;
    this.me().roles = squadRoles(squadSize);
    this.me().ready = false;
    this.emit();
  }

  // ---------- round lifecycle ----------

  startRound(force: boolean) {
    if (this.phase === "countdown" || this.phase === "playing") return;
    if (!force && this.players.some((p) => !p.ready)) return;
    if (this.countdownTimer) {
      clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.round += 1;
    this.phase = "countdown";
    this.startAt = Date.now() + COUNTDOWN_MS;
    for (const t of this.teams) {
      t.finishMs = null;
      t.hostId = this.myId;
    }
    if (this.me().roles.length === 0) this.me().roles = squadRoles(this.squadSize);
    this.emit();
    const round = this.round;
    this.countdownTimer = setTimeout(() => {
      this.countdownTimer = null;
      if (this.phase !== "countdown" || this.round !== round) return;
      this.phase = "playing";
      this.emit();
    }, COUNTDOWN_MS);
  }

  completeRun(timeMs: number): { teamId: number; teamName: string; time: number } | null {
    if (this.phase !== "playing") return null;
    const tm = this.myTeam();
    if (tm.finishMs != null) return null;
    const time = Math.max(0, Math.round(timeMs));
    tm.finishMs = time;
    this.phase = "results";
    this.startAt = null;
    this.emit();
    this.events?.onTeamFinished(tm.id, time, tm.name);
    return { teamId: tm.id, teamName: tm.name, time };
  }

  backToLobby() {
    if (this.countdownTimer) {
      clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.phase = "lobby";
    this.startAt = null;
    for (const p of this.players) p.ready = p.solo ? p.ready : false;
    for (const t of this.teams) t.finishMs = null;
    this.emit();
  }

  dispose() {
    if (this.countdownTimer) {
      clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.events = null;
  }
}
