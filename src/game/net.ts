/*
 * Browser-local networking for SINGULARITY.
 *
 * Live multiplayer state (rooms, teams, roles, inputs, snapshots, round
 * lifecycle) is tab-local temp state via LocalRoom — no server round-trip.
 * SpacetimeDB is used only for the durable global leaderboard: subscribe to
 * `leaderboard` rows and submit final runs with the client-trusted clock.
 */
import { DbConnection, type EventContext } from "@/module_bindings";
import type { Leaderboard } from "@/module_bindings/types";
import type { Phase, PlayerInfo, Role, RoleInput, RoomSnapshot, SquadSize, TeamInfo } from "./types";
import type { Snap } from "./game";
import { compareLeaderboardRows, type LeaderboardRow } from "./leaderboard";
import { LocalRoom } from "./local-room";

export const SPACETIMEDB_URI = process.env.NEXT_PUBLIC_SPACETIMEDB_URI ?? "ws://127.0.0.1:3000";
export const SPACETIMEDB_MODULE = process.env.NEXT_PUBLIC_SPACETIMEDB_MODULE ?? "singularity";

const TOKEN_KEY = `singularity:spacetimedb-token:${SPACETIMEDB_URI}/${SPACETIMEDB_MODULE}`;

export function loadSpacetimeToken(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.sessionStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveSpacetimeToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Storage can be unavailable in hardened/private browser contexts. The
    // current connection still works; only identity continuity is unavailable.
  }
}

export interface NetHandlers {
  onRoom?: (room: RoomSnapshot) => void;
  onRemoteInputs?: (inputs: Partial<Record<Role, RoleInput>>) => void;
  onSnapshot?: (teamId: number, snap: Snap) => void;
  onSnapshotCleared?: (teamId: number) => void;
  onTeamFinished?: (teamId: number, timeMs: number, teamName: string) => void;
  onConnectionChange?: (connected: boolean) => void;
  onScores?: (rows: LeaderboardRow[]) => void;
}

export class Net {
  private room: LocalRoom | null = null;
  private handlers: NetHandlers = {};
  private code = "";
  private name = "";
  private solo = false;
  private me = "";
  private disposed = false;
  private leaderboardConn: DbConnection | null = null;
  private leaderboardRows = new Map<string, LeaderboardRow>();
  private pendingSubmit: {
    challengeId: string;
    squadSize: SquadSize;
    teamName: string;
    players: string[];
    timeMs: number;
  } | null = null;
  connected = false;

  constructor(code: string, name: string, solo: boolean) {
    this.code = code.toUpperCase();
    this.name = name;
    this.solo = solo;
  }

  setHandlers(h: NetHandlers) {
    this.handlers = h;
  }

  /** This client's local identity (stable for the tab lifetime). */
  get myId(): string {
    return this.me;
  }

  connect() {
    if (this.disposed || this.room) return;
    const room = new LocalRoom(this.code, this.name, this.solo);
    this.room = room;
    this.me = room.myId;
    room.setEvents({
      onChange: (snapshot) => this.handlers.onRoom?.(snapshot),
      onTeamFinished: (teamId, timeMs, teamName) =>
        this.handlers.onTeamFinished?.(teamId, timeMs, teamName),
    });
    this.connected = true;
    this.handlers.onScores?.([]);
    this.handlers.onConnectionChange?.(true);
    this.handlers.onRoom?.(room.snapshot());
    this.handlers.onRemoteInputs?.({});
    this.connectLeaderboard();
  }

  /* ------------------------- leaderboard (SpacetimeDB) ------------------------- */

  private connectLeaderboard() {
    if (this.disposed || this.leaderboardConn) return;
    try {
      const conn = DbConnection.builder()
        .withUri(SPACETIMEDB_URI)
        .withDatabaseName(SPACETIMEDB_MODULE)
        .withToken(loadSpacetimeToken())
        .onConnect((c, _identity, token) => {
          if (this.disposed) {
            c.disconnect();
            return;
          }
          saveSpacetimeToken(token);
          this.leaderboardConn = c;
          c.subscriptionBuilder()
            .onApplied(() => {
              if (this.disposed) return;
              this.flushPendingSubmit();
            })
            .onError(() => {
              // Leaderboard sync is best-effort; local play keeps working.
              try {
                c.disconnect();
              } catch {}
              if (this.leaderboardConn === c) this.leaderboardConn = null;
            })
            .subscribe([`SELECT * FROM leaderboard`]);
          c.db.leaderboard.onInsert((_ctx: EventContext, row: Leaderboard) => {
            this.leaderboardRows.set(row.id.toString(), toRow(row));
            this.emitScores();
          });
          c.db.leaderboard.onDelete((_ctx: EventContext, row: Leaderboard) => {
            if (this.leaderboardRows.delete(row.id.toString())) this.emitScores();
          });
        })
        .onConnectError(() => {
          // Best-effort: local play works without the leaderboard backend.
          this.leaderboardConn = null;
        })
        .onDisconnect(() => {
          this.leaderboardConn = null;
        })
        .build();
      this.leaderboardConn = conn;
    } catch {
      this.leaderboardConn = null;
    }
  }

  private emitScores() {
    const rows = [...this.leaderboardRows.values()].sort(compareLeaderboardRows);
    this.handlers.onScores?.(rows);
  }

  private flushPendingSubmit() {
    const pending = this.pendingSubmit;
    const conn = this.leaderboardConn;
    if (!pending || !conn) return;
    try {
      conn.reducers.submitScore({
        challengeId: pending.challengeId,
        squadSize: pending.squadSize,
        teamName: pending.teamName,
        players: pending.players,
        timeMs: BigInt(Math.max(0, Math.round(pending.timeMs))),
      });
      this.pendingSubmit = null;
    } catch {
      // Keep queued; a later table update or reconnect will retry.
    }
  }

  /* ---------------------------------- outbound ---------------------------------- */

  private snapshot(): RoomSnapshot | null {
    return this.room?.snapshot() ?? null;
  }

  setRole(role: Role) {
    this.room?.setRole(role);
  }
  joinTeam(teamId: number) {
    this.room?.joinTeam(teamId);
  }
  createTeam() {
    this.room?.createTeam();
  }
  renameTeam(name: string) {
    this.room?.renameTeam(name);
  }
  setReady(ready: boolean) {
    this.room?.setReady(ready);
  }
  setChallenge(challengeId: string) {
    this.room?.setChallenge(challengeId);
  }
  setSquad(squadSize: SquadSize) {
    this.room?.setSquad(squadSize);
  }
  startRound(force: boolean) {
    this.room?.startRound(force);
  }
  backToLobby() {
    this.room?.backToLobby();
  }

  completeRun(_snapshot: Snap, timeMs: number) {
    const room = this.room;
    if (!room) return;
    const finished = room.completeRun(timeMs);
    if (!finished) return;
    const snap = this.snapshot();
    if (!snap) return;
    const team = snap.teams.find((t: TeamInfo) => t.id === finished.teamId);
    const me = snap.players.find((p: PlayerInfo) => p.id === this.me);
    this.pendingSubmit = {
      challengeId: snap.challengeId,
      squadSize: snap.squadSize,
      teamName: team?.name ?? finished.teamName,
      players: [me?.name ?? this.name],
      timeMs: finished.time,
    };
    this.flushPendingSubmit();
  }

  sendInputs(_payload: Partial<Record<Role, RoleInput>>) {
    // Single local sim: the host applies its own inputs directly via
    // Game.setLocalInput, so there is no one to relay to.
  }

  publishSnapshot(_s: Snap) {
    // Single local sim: no teammates to broadcast to.
  }

  serverNow() {
    return Date.now();
  }

  get phase(): Phase {
    return this.room?.snapshot().phase ?? "lobby";
  }

  leave() {
    // Browser-local room: nothing to leave server-side.
  }

  close() {
    this.disposed = true;
    this.connected = false;
    this.room?.dispose();
    this.room = null;
    try {
      this.leaderboardConn?.disconnect();
    } catch {}
    this.leaderboardConn = null;
  }
}

function toRow(row: Leaderboard): LeaderboardRow {
  return {
    id: row.id.toString(),
    challengeId: row.challengeId,
    squadSize: row.squadSize === 3 ? 3 : 5,
    teamName: row.teamName,
    players: [...row.players],
    timeMs: Number(row.timeMs),
  };
}
