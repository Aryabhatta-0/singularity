/*
 * SpacetimeDB-backed networking for SINGULARITY.
 *
 * Replaces the old SSE + POST relay: rooms, teams, inputs, physics snapshots and
 * the leaderboard all flow through a single WebSocket into the SpacetimeDB module
 * (see server/src/index.ts). The rest of the game talks to this class exactly like
 * it talked to the old Net.
 */
import { DbConnection, type EventContext } from "@/module_bindings";
import type { Room, Player, Team, Snapshot, Input, Squad, Leaderboard } from "@/module_bindings/types";
import type { Phase, PlayerInfo, Role, RoleInput, RoomSnapshot, SquadSize, TeamInfo } from "./types";
import type { Snap } from "./game";
import { microsToMilliseconds, storedMilliseconds } from "./time";
import { compareLeaderboardRows, type LeaderboardRow } from "./leaderboard";
import { collectRemoteInputs, neutralInputsForRoles, type RemoteInputRow } from "./remote-input-state";
import { decodeSnapshotRow, SnapshotOrderGate } from "./snapshot-codec";
import { ServerClock } from "./server-clock";

export const SPACETIMEDB_URI = process.env.NEXT_PUBLIC_SPACETIMEDB_URI ?? "ws://127.0.0.1:3000";
export const SPACETIMEDB_MODULE = process.env.NEXT_PUBLIC_SPACETIMEDB_MODULE ?? "singularity";

const TOKEN_KEY = `singularity:spacetimedb-token:${SPACETIMEDB_URI}/${SPACETIMEDB_MODULE}`;

// Session storage survives reloads/reconnects while giving each multiplayer
// tab its own SpacetimeDB identity.
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

const ALL_ROLES: Role[] = ["arms", "torso", "legs", "lhand", "rhand", "lleg", "rleg", "head"];
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 5000;
const INPUT_LEASE_MS = 1_000;

export interface NetHandlers {
  onRoom?: (room: RoomSnapshot) => void;
  onRemoteInputs?: (inputs: Partial<Record<Role, RoleInput>>) => void;
  onSnapshot?: (teamId: number, snap: Snap) => void;
  onSnapshotCleared?: (teamId: number) => void;
  onTeamFinished?: (teamId: number, timeMs: number, teamName: string) => void;
  onConnectionChange?: (connected: boolean) => void;
  onScores?: (rows: LeaderboardRow[]) => void;
}

function hexOf(id: { toHexString(): string } | undefined | null): string {
  return id ? id.toHexString() : "";
}

export class Net {
  private conn: DbConnection | null = null;
  private handlers: NetHandlers = {};
  private code = "";
  private name = "";
  private solo = false;
  private me = "";
  private disposed = false;
  private hbTimer: ReturnType<typeof setInterval> | null = null;
  private inputLeaseTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private connectionGeneration = 0;
  private roomRow: Room | null = null;
  private squadSize: SquadSize = 5;
  private players = new Map<string, Player>();
  private teams = new Map<string, Team>();
  private inputRows = new Map<string, Input>();
  private leaderboardRows = new Map<string, LeaderboardRow>();
  private finishSeen = new Set<string>();
  private snapshotOrder = new SnapshotOrderGate();
  private serverClock = new ServerClock();
  private lastRound = 0;
  private lastTeamId: bigint | null = null;
  private pendingFinish: {
    round: number;
    teamId: bigint;
    timeMs: bigint;
    snapshot: Snap;
    sentGeneration: number | null;
    sentOnce: boolean;
  } | null = null;
  private lastInputRoles: Role[] = [];
  private refreshRemoteInputs: (() => void) | null = null;
  connected = false;

  constructor(code: string, name: string, solo: boolean) {
    this.code = code.toUpperCase();
    this.name = name;
    this.solo = solo;
    if (typeof window !== "undefined") {
      document.addEventListener("visibilitychange", this.resumeWhenVisible);
      window.addEventListener("focus", this.resume);
      window.addEventListener("online", this.reconnectOnOnline);
      window.addEventListener("pageshow", this.resume);
      window.addEventListener("blur", this.neutralizeInputs);
      window.addEventListener("offline", this.releaseHost);
      window.addEventListener("pagehide", this.releaseHost);
    }
  }

  setHandlers(h: NetHandlers) {
    this.handlers = h;
  }

  /** This client's SpacetimeDB identity hex (empty until connected). */
  get myId(): string {
    return this.me;
  }

  connect() {
    if (this.disposed  || this.conn) return;
    const generation = ++this.connectionGeneration;
    const conn = DbConnection.builder()
      .withUri(SPACETIMEDB_URI)
      .withDatabaseName(SPACETIMEDB_MODULE)
      .withToken(loadSpacetimeToken())
      .onConnect((conn, identity, token) => {
        if (this.disposed  || generation !== this.connectionGeneration) {
          conn.disconnect();
          return;
        }
        saveSpacetimeToken(token);
        this.resetCaches();
        this.conn = conn;
        this.me = identity.toHexString();
        this.wire(conn, generation);
        conn.subscriptionBuilder()
          .onApplied(() => {
            if (this.disposed || generation !== this.connectionGeneration || this.conn !== conn) return;
            this.reconnectAttempt = 0;
            this.connected = true;
            this.handlers.onConnectionChange?.(true);
            this.callJoinRoom(conn);
            this.flushPendingFinish(conn);
            this.emitRoom();
          })
          .onError(() => {
            if (generation === this.connectionGeneration && this.conn === conn) conn.disconnect();
          })
          .subscribe([
            `SELECT * FROM visible_room`,
            `SELECT * FROM visible_player`,
            `SELECT * FROM visible_team`,
            `SELECT * FROM visible_snapshot`,
            `SELECT * FROM visible_input`,
            `SELECT * FROM visible_squad`,
            `SELECT * FROM leaderboard`,
          ]);
      })
      .onConnectError(() => {
        if (generation !== this.connectionGeneration) return;
        this.conn = null;
        this.connected = false;
        this.handlers.onRemoteInputs?.({});
        this.handlers.onConnectionChange?.(false);
        this.scheduleReconnect();
      })
      .onDisconnect(() => {
        if (generation !== this.connectionGeneration) return;
        this.conn = null;
        this.connected = false;
        this.handlers.onRemoteInputs?.({});
        this.handlers.onConnectionChange?.(false);
        if (!this.disposed) this.scheduleReconnect();
      })
      .build();
    if (this.disposed  || generation !== this.connectionGeneration) {
      conn.disconnect();
    } else {
      // Retain the in-flight connection immediately so close() can tear down a
      // handshake that has not reached onConnect yet.
      this.conn = conn;
    }
  }

  private scheduleReconnect() {
    if (this.disposed  || this.reconnectTimer) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** this.reconnectAttempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.disposed) this.connect();
    }, delay);
  }

  private resume = () => {
    if (this.disposed ) return;
    if (this.reconnectTimer && !this.conn) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.reconnectAttempt = 0;
      this.connect();
      return;
    }

    const stale = this.conn;
    if (stale?.isSocketClosed) {
      this.conn = null;
      this.connectionGeneration += 1;
      this.reconnectAttempt = 0;
      this.connected = false;
      this.handlers.onConnectionChange?.(false);
      stale.disconnect();
      this.connect();
      return;
    }

    if (!this.conn) {
      this.reconnectAttempt = 0;
      this.connect();
      return;
    }
    if (document.visibilityState === "visible") {
      try {
        this.conn.reducers.setHostEligible({ eligible: true });
      } catch {}
    }
  };

  /** Re-open the transport after an offline interval so recovery is server-confirmed. */
  private reconnectOnOnline = () => {
    if (this.disposed ) return;
    const stale = this.conn;
    this.conn = null;
    this.connected = false;
    this.connectionGeneration += 1;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
    this.handlers.onRemoteInputs?.({});
    this.handlers.onConnectionChange?.(false);
    stale?.disconnect();
    this.connect();
  };

  private resumeWhenVisible = () => {
    if (document.visibilityState === "visible") {
      this.resume();
      return;
    }
    this.releaseHost();
  };

  private releaseHost = () => {
    this.neutralizeInputs();
    try {
      this.conn?.reducers.setHostEligible({ eligible: false });
    } catch {
      // A concurrent disconnect also causes the server to elect a successor.
    }
  };

  private neutralizeInputs = () => {
    if (this.lastInputRoles.length === 0) return;
    try {
      this.sendInputs(neutralInputsForRoles(this.lastInputRoles));
    } catch {
      // The browser may report offline only after the socket has already died.
      // The server-side lease still guarantees eventual neutralization.
    }
  };

  private callJoinRoom(conn: DbConnection) {
    conn.reducers.joinRoom({ code: this.code, name: this.name, solo: this.solo });
    conn.reducers.setHostEligible({ eligible: document.visibilityState === "visible" });
    if (!this.hbTimer) {
      this.hbTimer = setInterval(() => {
        try {
          this.conn?.reducers.heartbeat({});
        } catch {}
      }, 20_000);
    }
    if (!this.inputLeaseTimer) {
      this.inputLeaseTimer = setInterval(() => this.refreshRemoteInputs?.(), 250);
    }
  }

  private flushPendingFinish(conn: DbConnection | null = this.conn) {
    const pending = this.pendingFinish;
    if (!pending || !conn || !this.connected || this.conn !== conn) return;
    if (this.roomRow && this.roomRow.round !== pending.round) {
      this.pendingFinish = null;
      return;
    }
    const me = this.players.get(this.me);
    if (!me || me.teamId !== pending.teamId) return;
    const tm = this.teams.get(pending.teamId.toString());
    if (!tm) return;
    if (tm.finishMs != null) {
      this.pendingFinish = null;
      return;
    }
    if (!this.roomRow || this.roomRow.phase !== "playing") return;
    if (pending.sentGeneration === this.connectionGeneration) return;

    try {
      const proof = pending.sentOnce
        ? { ...pending.snapshot, ev: [], msg: undefined }
        : pending.snapshot;
      const events = proof.state ? [{ type: "state", ...proof.state }, ...proof.ev].slice(0, 32) : proof.ev.slice(0, 32);
      conn.reducers.finishRunWithProof({
        timeMs: pending.timeMs,
        round: pending.round,
        p: proof.p,
        props: proof.props,
        yaw: proof.yaw,
        pitch: proof.pitch,
        timer: proof.timer,
        fallen: proof.fallen === 1,
        score: proof.score,
        ev: JSON.stringify(events),
        msg: proof.msg,
      });
      pending.sentOnce = true;
      pending.sentGeneration = this.connectionGeneration;
    } catch {
      // Keep the completion queued. A reconnect or subsequent table update will
      // retry it with a fresh proof timestamp.
    }
  }

  private wire(conn: DbConnection, generation: number) {
    const active = () => generation === this.connectionGeneration && this.conn === conn && !this.disposed;
    const inRoom = (code: string) => code === this.code;

    conn.db.visibleRoom.onInsert((_ctx: EventContext, row: Room) => {
      if (!active() || !inRoom(row.code)) return;
      this.roomRow = row;
      this.lastRound = row.round;
      this.syncOffset(row);
      this.emitRoom();
      this.flushPendingFinish(conn);
    });
    conn.db.visibleRoom.onUpdate((_ctx: EventContext, _prev: Room, next: Room) => {
      if (!active() || !inRoom(next.code)) return;
      this.roomRow = next;
      this.lastRound = next.round;
      this.syncOffset(next);
      this.emitRoom();
      this.flushPendingFinish(conn);
    });
    conn.db.visibleRoom.onDelete((_ctx: EventContext, row: Room) => {
      if (!active() || !inRoom(row.code)) return;
      this.roomRow = null;
      this.emitRoom();
    });

    const cachePlayer = (row: Player) => {
      if (!active() || !inRoom(row.code)) return;
      this.players.set(hexOf(row.identity), row);
      if (row.identity.toHexString() === this.me) this.lastTeamId = row.teamId;
      this.emitRoom();
      this.flushPendingFinish(conn);
    };
    conn.db.visiblePlayer.onInsert((_ctx: EventContext, row: Player) => cachePlayer(row));
    conn.db.visiblePlayer.onUpdate((_ctx: EventContext, _prev: Player, next: Player) => cachePlayer(next));
    conn.db.visiblePlayer.onDelete((_ctx: EventContext, row: Player) => {
      if (!active()) return;
      const hex = hexOf(row.identity);
      if (hex === this.me) {
        // cleanup beat us to it (or we were kicked) — rejoin
        this.players.delete(hex);
        this.emitRoom();
        if (!this.disposed && this.conn) {
          setTimeout(() => {
            if (active()) this.callJoinRoom(conn);
          }, 800);
        }
        return;
      }
      if (this.players.delete(hex)) this.emitRoom();
    });

    const cacheTeam = (row: Team) => {
      if (!active() || !inRoom(row.code)) return;
      const id = row.id.toString();
      this.teams.set(id, row);
      if (row.finishMs == null) {
        this.finishSeen.delete(id);
      } else if (!this.finishSeen.has(id)) {
        this.finishSeen.add(id);
        this.handlers.onTeamFinished?.(Number(row.id), storedMilliseconds(row.finishMs), row.name);
      }
      this.emitRoom();
      this.flushPendingFinish(conn);
    };
    conn.db.visibleTeam.onInsert((_ctx: EventContext, row: Team) => cacheTeam(row));
    conn.db.visibleTeam.onUpdate((_ctx: EventContext, _prev: Team, next: Team) => cacheTeam(next));
    conn.db.visibleTeam.onDelete((_ctx: EventContext, row: Team) => {
      if (!active()) return;
      if (this.teams.delete(row.id.toString())) {
        this.finishSeen.delete(row.id.toString());
        this.emitRoom();
      }
    });

    const applySnapshot = (row: Snapshot) => {
      if (!active() || !inRoom(row.code)) return;
      // the host does not need to hear its own broadcast
      if (row.teamId === this.myTeamId() && this.amHost()) return;
      const rowRound = row.round ?? undefined;
      const rowSequence = row.sequence ?? undefined;
      if (!this.snapshotOrder.accept(Number(row.teamId), rowRound, rowSequence, this.roomRow?.round)) return;
      const snap = this.toSnap(row);
      if (snap) this.handlers.onSnapshot?.(Number(row.teamId), snap);
    };
    conn.db.visibleSnapshot.onInsert((_ctx: EventContext, row: Snapshot) => applySnapshot(row));
    conn.db.visibleSnapshot.onUpdate((_ctx: EventContext, _prev: Snapshot, next: Snapshot) => applySnapshot(next));
    conn.db.visibleSnapshot.onDelete((_ctx: EventContext, row: Snapshot) => {
      if (!active() || !inRoom(row.code)) return;
      const teamId = Number(row.teamId);
      this.snapshotOrder.clearTeam(teamId);
      this.handlers.onSnapshotCleared?.(teamId);
    });

    const applyInputs = () => {
      if (!active()) return;
      const myTeam = this.myTeamId();
      if (myTeam == null) return;
      const rows: RemoteInputRow[] = [...this.inputRows.values()].map((row) => {
        const recvMicros = (row as Input & { recvMicros?: bigint }).recvMicros;
        return {
          identity: hexOf(row.identity),
          teamId: Number(row.teamId),
          roles: row.roles,
          inputs: row.inputs,
          updatedAtMs: typeof recvMicros === "bigint" ? microsToMilliseconds(recvMicros) : undefined,
        };
      });
      const merged = collectRemoteInputs(rows, {
        teamId: Number(myTeam),
        ownIdentity: this.me,
        nowMs: this.serverNow(),
        leaseMs: INPUT_LEASE_MS,
      });
      this.handlers.onRemoteInputs?.(merged);
    };
    this.refreshRemoteInputs = applyInputs;
    conn.db.visibleInput.onInsert((_ctx: EventContext, row: Input) => {
      if (!active() || !inRoom(row.code)) return;
      this.inputRows.set(hexOf(row.identity), row);
      applyInputs();
    });
    conn.db.visibleInput.onUpdate((_ctx: EventContext, _prev: Input, next: Input) => {
      if (!active() || !inRoom(next.code)) return;
      this.inputRows.set(hexOf(next.identity), next);
      applyInputs();
    });
    conn.db.visibleInput.onDelete((_ctx: EventContext, row: Input) => {
      if (!active()) return;
      if (this.inputRows.delete(hexOf(row.identity))) applyInputs();
    });

    conn.db.leaderboard.onInsert((_ctx: EventContext, row: Leaderboard) => {
      if (!active()) return;
      const id = row.id.toString();
      this.leaderboardRows.set(id, {
        id,
        challengeId: row.challengeId,
        squadSize: row.squadSize === 3 ? 3 : 5,
        teamName: row.teamName,
        players: row.players,
        timeMs: storedMilliseconds(row.timeMs),
      });
      this.emitScores();
    });
    conn.db.leaderboard.onDelete((_ctx: EventContext, row: Leaderboard) => {
      if (!active()) return;
      if (this.leaderboardRows.delete(row.id.toString())) this.emitScores();
    });

    const applySquad = (row: Squad) => {
      if (!active() || !inRoom(row.code)) return;
      this.squadSize = row.size === 3 ? 3 : 5;
      this.emitRoom();
    };
    conn.db.visibleSquad.onInsert((_ctx: EventContext, row: Squad) => applySquad(row));
    conn.db.visibleSquad.onUpdate((_ctx: EventContext, _prev: Squad, next: Squad) => applySquad(next));
    conn.db.visibleSquad.onDelete((_ctx: EventContext, row: Squad) => {
      if (!active() || !inRoom(row.code)) return;
      this.squadSize = 5;
      this.emitRoom();
    });
  }

  private resetCaches() {
    this.roomRow = null;
    this.squadSize = 5;
    this.players.clear();
    this.teams.clear();
    this.inputRows.clear();
    this.leaderboardRows.clear();
    this.finishSeen.clear();
    this.snapshotOrder.clear();
    this.refreshRemoteInputs = null;
    this.handlers.onRemoteInputs?.({});
    this.handlers.onScores?.([]);
  }

  private emitScores() {
    const rows = [...this.leaderboardRows.values()].sort(compareLeaderboardRows);
    this.handlers.onScores?.(rows);
  }

  private syncOffset(row: Room) {
    this.serverClock.observe(microsToMilliseconds(row.nowMicros), Date.now());
  }

  private myTeamId(): bigint | null {
    const me = this.players.get(this.me);
    return me ? me.teamId : null;
  }

  private amHost(): boolean {
    const teamId = this.myTeamId();
    if (teamId == null) return false;
    const tm = this.teams.get(teamId.toString());
    return !!tm && hexOf(tm.hostId) === this.me;
  }

  private toSnap(row: Snapshot): Snap | null {
    return decodeSnapshotRow(row);
  }

  private emitRoom() {
    if (!this.handlers.onRoom) return;
    const players = [...this.players.values()].sort((a, b) => (a.joinedSeq < b.joinedSeq ? -1 : a.joinedSeq > b.joinedSeq ? 1 : 0));
    const teams = [...this.teams.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
    const infos: PlayerInfo[] = players.map((p) => ({
      id: hexOf(p.identity),
      name: p.name,
      teamId: Number(p.teamId),
      roles: p.roles.filter((r): r is Role => ALL_ROLES.includes(r as Role)),
      ready: p.ready,
    }));
    const teamInfos: TeamInfo[] = teams.map((t) => ({
      id: Number(t.id),
      name: t.name,
      color: t.color,
      hostId: hexOf(t.hostId) || null,
      finishMs: t.finishMs != null ? storedMilliseconds(t.finishMs) : null,
    }));
    this.handlers.onRoom({
      code: this.code,
      phase: (this.roomRow?.phase ?? "lobby") as Phase,
      challengeId: this.roomRow?.challengeId ?? "wobble-run",
      squadSize: this.squadSize,
      players: infos,
      teams: teamInfos,
      startAt: this.roomRow && this.roomRow.startAtMicros > 0n ? microsToMilliseconds(this.roomRow.startAtMicros) : null,
      round: this.roomRow?.round ?? 0,
      now: this.serverClock.now(),
      leaderId: hexOf(this.roomRow?.leaderId) || null,
    });
  }

  /* ---------------------------------- outbound ---------------------------------- */

  setRole(role: Role) {
    this.conn?.reducers.setRole({ role });
  }
  joinTeam(teamId: number) {
    this.conn?.reducers.joinTeam({ teamId: BigInt(teamId) });
  }
  createTeam() {
    this.conn?.reducers.createTeam({});
  }
  renameTeam(name: string) {
    this.conn?.reducers.renameTeam({ name });
  }
  setReady(ready: boolean) {
    this.conn?.reducers.setReady({ ready });
  }
  setChallenge(challengeId: string) {
    this.conn?.reducers.setChallenge({ challengeId });
  }
  setSquad(squadSize: SquadSize) {
    this.conn?.reducers.setSquad({ size: squadSize });
  }
  startRound(force: boolean) {
    this.conn?.reducers.startRound({ force });
  }
  backToLobby() {
    this.conn?.reducers.backToLobby({});
  }
  completeRun(snapshot: Snap, timeMs: number) {
    const round = this.roomRow?.round ?? this.lastRound;
    const teamId = this.players.get(this.me)?.teamId ?? this.lastTeamId;
    if (round <= 0 || teamId == null) return;
    this.pendingFinish = {
      round,
      teamId,
      timeMs: BigInt(Math.max(0, Math.round(timeMs))),
      snapshot: {
        ...snapshot,
        p: [...snapshot.p],
        props: [...snapshot.props],
        ev: [...snapshot.ev],
      },
      sentGeneration: null,
      sentOnce: false,
    };
    this.flushPendingFinish();
  }

  sendInputs(payload: Partial<Record<Role, RoleInput>>) {
    const roles = Object.keys(payload) as Role[];
    if (roles.length === 0) return;
    this.lastInputRoles = roles;
    this.conn?.reducers.sendInput({
      roles,
      inputs: roles.map((r) => {
        const i = payload[r]!;
        return { f: i.f, s: i.s, a: i.a, b: i.b, q: i.q, e: i.e, lx: i.lx, ly: i.ly };
      }),
    });
  }

  private sendSnapshot(conn: DbConnection, s: Snap) {
    const round = this.roomRow?.round;
    if (round == null) return;
    const events = s.state ? [{ type: "state", ...s.state }, ...s.ev].slice(0, 32) : s.ev.slice(0, 32);
    conn.reducers.publishSnapshot({
      round,
      p: s.p as number[],
      props: s.props as number[],
      yaw: s.yaw,
      pitch: s.pitch,
      timer: s.timer,
      fallen: s.fallen === 1,
      score: s.score,
      ev: JSON.stringify(events),
      msg: s.msg,
    });
  }

  publishSnapshot(s: Snap) {
    if (this.conn && (this.roomRow?.phase === "countdown" || this.roomRow?.phase === "playing")) {
      this.sendSnapshot(this.conn, s);
    }
  }

  serverNow() {
    return this.serverClock.now();
  }

  leave() {
    try {
      this.conn?.reducers.leaveRoom({});
    } catch {}
  }

  close() {
    this.neutralizeInputs();
    this.disposed = true;
    this.connectionGeneration += 1;
    if (this.hbTimer) clearInterval(this.hbTimer);
    if (this.inputLeaseTimer) clearInterval(this.inputLeaseTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (typeof window !== "undefined") {
      document.removeEventListener("visibilitychange", this.resumeWhenVisible);
      window.removeEventListener("focus", this.resume);
      window.removeEventListener("online", this.reconnectOnOnline);
      window.removeEventListener("pageshow", this.resume);
      window.removeEventListener("blur", this.neutralizeInputs);
      window.removeEventListener("offline", this.releaseHost);
      window.removeEventListener("pagehide", this.releaseHost);
    }
    this.leave();
    this.conn?.disconnect();
    this.conn = null;
  }
}

