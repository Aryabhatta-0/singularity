/*
 * Live match networking: one WebSocket to the room server the hosting player
 * runs (room-server/). Rooms, teams, roles, inputs and physics snapshots flow
 * through it; each team's host simulates the shared body and publishes
 * snapshots, teammates send their inputs. Finishes are timed by the room
 * server, then the team host files the run with the separate leaderboard.
 */
import { DbConnection, type EventContext } from "@/room_bindings";
import type { Input, Player, Room, Snapshot, Team } from "@/room_bindings/types";
import type { Snap } from "./game";
import type { GameNet, NetHandlers } from "./game-net";
import { LeaderboardFeed } from "./leaderboard-feed";
import { collectRemoteInputs, neutralInputsForRoles, type RemoteInputRow } from "./remote-input-state";
import { buildScoreSubmit, coerceSquadSize, isRankedRoster } from "./score-submit";
import { decodeSnapshotRow, SnapshotOrderGate } from "./snapshot-codec";
import { loadSpacetimeToken, saveSpacetimeToken } from "./spacetime-token";
import { microsToMilliseconds, nowMs, ServerClock, storedMilliseconds } from "./timing";
import type { Phase, PlayerInfo, Role, RoleInput, SquadSize, TeamInfo } from "./types";

const ALL_ROLES: Role[] = ["arms", "torso", "legs", "lhand", "rhand", "lleg", "rleg", "head"];
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 5000;
const INPUT_LEASE_MS = 1_000;
const HEARTBEAT_MS = 20_000;

function hexOf(id: { toHexString(): string } | undefined | null): string {
  return id ? id.toHexString() : "";
}

function bySeq(a: Player, b: Player): number {
  return a.joinedSeq < b.joinedSeq ? -1 : a.joinedSeq > b.joinedSeq ? 1 : 0;
}

export class RoomNet implements GameNet {
  private conn: DbConnection | null = null;
  private handlers: NetHandlers = {};
  private me = "";
  private disposed = false;
  private everConnected = false;
  private hbTimer: ReturnType<typeof setInterval> | null = null;
  private inputLeaseTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private connectionGeneration = 0;
  private roomRow: Room | null = null;
  private players = new Map<string, Player>();
  private teams = new Map<string, Team>();
  private inputRows = new Map<string, Input>();
  private finishSeen = new Set<string>();
  /** `${round}:${teamId}` runs already sent to the leaderboard (survives reconnects). */
  private filedRuns = new Set<string>();
  private snapshotOrder = new SnapshotOrderGate();
  private serverClock = new ServerClock();
  private pendingFinish: { round: number; teamId: bigint; sentGeneration: number | null } | null = null;
  private lastInputRoles: Role[] = [];
  private refreshRemoteInputs: (() => void) | null = null;
  private leaderboard: LeaderboardFeed;

  constructor(
    private readonly code: string,
    private readonly name: string,
    private readonly solo: boolean,
    readonly serverUri: string,
    private readonly database: string,
    leaderboard: { uri: string; database: string },
  ) {
    this.code = code.toUpperCase();
    this.leaderboard = new LeaderboardFeed(leaderboard.uri, leaderboard.database, (rows) =>
      this.handlers.onScores?.(rows)
    );
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

  get myId(): string {
    return this.me;
  }

  connect() {
    if (this.disposed || this.conn) return;
    this.leaderboard.connect();
    const generation = ++this.connectionGeneration;
    const tokenKey = `${this.serverUri}/${this.database}`;
    const conn = DbConnection.builder()
      .withUri(this.serverUri)
      .withDatabaseName(this.database)
      .withToken(loadSpacetimeToken(tokenKey))
      .onConnect((conn, identity, token) => {
        if (this.disposed || generation !== this.connectionGeneration) {
          conn.disconnect();
          return;
        }
        saveSpacetimeToken(tokenKey, token);
        this.resetCaches();
        this.conn = conn;
        this.me = identity.toHexString();
        this.wire(conn, generation);
        conn.subscriptionBuilder()
          .onApplied(() => {
            if (this.disposed || generation !== this.connectionGeneration || this.conn !== conn) return;
            this.reconnectAttempt = 0;
            this.everConnected = true;
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
          ]);
      })
      .onConnectError(() => {
        if (generation !== this.connectionGeneration) return;
        this.conn = null;
        this.handlers.onRemoteInputs?.({});
        if (this.everConnected) this.handlers.onConnectionChange?.(false);
        else this.handlers.onUnreachable?.(this.serverUri);
        this.scheduleReconnect();
      })
      .onDisconnect(() => {
        if (generation !== this.connectionGeneration) return;
        this.conn = null;
        this.handlers.onRemoteInputs?.({});
        // A failed first handshake also lands here: nothing was lost yet.
        if (this.everConnected) this.handlers.onConnectionChange?.(false);
        else this.handlers.onUnreachable?.(this.serverUri);
        if (!this.disposed) this.scheduleReconnect();
      })
      .build();
    if (this.disposed || generation !== this.connectionGeneration) {
      conn.disconnect();
    } else {
      // Retain the in-flight connection so close() can tear down a pending handshake.
      this.conn = conn;
    }
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** this.reconnectAttempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.disposed) this.connect();
    }, delay);
  }

  private resume = () => {
    if (this.disposed) return;
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
    if (this.disposed) return;
    const stale = this.conn;
    this.conn = null;
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

  /** A hidden tab cannot simulate (rAF stops), so hand the body to a teammate. */
  private releaseHost = () => {
    this.neutralizeInputs();
    try {
      this.conn?.reducers.setHostEligible({ eligible: false });
    } catch {
      // A concurrent disconnect also makes the server elect a successor.
    }
  };

  private neutralizeInputs = () => {
    if (this.lastInputRoles.length === 0) return;
    try {
      this.sendInputs(neutralInputsForRoles(this.lastInputRoles));
    } catch {
      // The server-side input TTL still guarantees eventual neutralization.
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
      }, HEARTBEAT_MS);
    }
    if (!this.inputLeaseTimer) {
      this.inputLeaseTimer = setInterval(() => this.refreshRemoteInputs?.(), 250);
    }
  }

  private flushPendingFinish(conn: DbConnection | null = this.conn) {
    const pending = this.pendingFinish;
    if (!pending || !conn || this.conn !== conn || !this.everConnected) return;
    if (this.roomRow && this.roomRow.round !== pending.round) {
      this.pendingFinish = null;
      return;
    }
    const tm = this.teams.get(pending.teamId.toString());
    if (tm?.finishMs != null) {
      this.pendingFinish = null;
      return;
    }
    if (!tm || this.roomRow?.phase !== "playing") return;
    if (pending.sentGeneration === this.connectionGeneration) return;
    try {
      conn.reducers.finishRun({ round: pending.round });
      pending.sentGeneration = this.connectionGeneration;
    } catch {
      // Keep queued; a reconnect or the next table update retries.
    }
  }

  /** The team host files a server-timed finish with the global leaderboard, once. */
  private fileRun(team: Team) {
    const room = this.roomRow;
    if (!room || team.finishMs == null || hexOf(team.hostId) !== this.me) return;
    const key = `${room.round}:${team.id}`;
    if (this.filedRuns.has(key)) return;
    this.filedRuns.add(key);
    const members = [...this.players.values()].filter((p) => p.teamId === team.id).sort(bySeq);
    const squadSize = coerceSquadSize(room.squadSize);
    const solo = members.length > 0 && members.every((m) => m.solo);
    if (!isRankedRoster({ memberCount: members.length, squadSize, solo })) return;
    const submit = buildScoreSubmit({
      challengeId: room.challengeId,
      squadSize,
      teamName: team.name,
      players: members.map((m) => m.name),
      timeMs: storedMilliseconds(team.finishMs),
    });
    if (submit) this.leaderboard.submit(submit);
  }

  private wire(conn: DbConnection, generation: number) {
    const active = () => generation === this.connectionGeneration && this.conn === conn && !this.disposed;
    const inRoom = (code: string) => code === this.code;

    const cacheRoom = (row: Room) => {
      if (!active() || !inRoom(row.code)) return;
      this.roomRow = row;
      this.serverClock.observe(microsToMilliseconds(row.nowMicros), nowMs());
      this.emitRoom();
      this.flushPendingFinish(conn);
    };
    conn.db.visibleRoom.onInsert((_ctx: EventContext, row: Room) => cacheRoom(row));
    conn.db.visibleRoom.onUpdate((_ctx: EventContext, _prev: Room, next: Room) => cacheRoom(next));
    conn.db.visibleRoom.onDelete((_ctx: EventContext, row: Room) => {
      if (!active() || !inRoom(row.code)) return;
      this.roomRow = null;
      this.emitRoom();
    });

    const cachePlayer = (row: Player) => {
      if (!active() || !inRoom(row.code)) return;
      this.players.set(hexOf(row.identity), row);
      this.emitRoom();
      this.flushPendingFinish(conn);
    };
    conn.db.visiblePlayer.onInsert((_ctx: EventContext, row: Player) => cachePlayer(row));
    conn.db.visiblePlayer.onUpdate((_ctx: EventContext, _prev: Player, next: Player) => cachePlayer(next));
    conn.db.visiblePlayer.onDelete((_ctx: EventContext, row: Player) => {
      if (!active()) return;
      const hex = hexOf(row.identity);
      if (hex === this.me) {
        // Cleanup beat us to it (or we were removed) — rejoin.
        this.players.delete(hex);
        this.emitRoom();
        setTimeout(() => {
          if (active()) this.callJoinRoom(conn);
        }, 800);
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
        this.fileRun(row);
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
      // The host does not need to hear its own broadcast.
      if (row.teamId === this.myTeamId() && this.amHost()) return;
      if (!this.snapshotOrder.accept(Number(row.teamId), row.round, row.sequence, this.roomRow?.round)) return;
      const snap = decodeSnapshotRow(row);
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
      const rows: RemoteInputRow[] = [...this.inputRows.values()].map((row) => ({
        identity: hexOf(row.identity),
        teamId: Number(row.teamId),
        roles: row.roles,
        inputs: row.inputs,
        updatedAtMs: microsToMilliseconds(row.recvMicros),
      }));
      this.handlers.onRemoteInputs?.(collectRemoteInputs(rows, {
        teamId: Number(myTeam),
        ownIdentity: this.me,
        nowMs: this.serverNow(),
        leaseMs: INPUT_LEASE_MS,
      }));
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
  }

  private resetCaches() {
    this.roomRow = null;
    this.players.clear();
    this.teams.clear();
    this.inputRows.clear();
    this.finishSeen.clear();
    this.snapshotOrder.clear();
    this.refreshRemoteInputs = null;
    this.handlers.onRemoteInputs?.({});
  }

  private myTeamId(): bigint | null {
    return this.players.get(this.me)?.teamId ?? null;
  }

  private amHost(): boolean {
    const teamId = this.myTeamId();
    if (teamId == null) return false;
    return hexOf(this.teams.get(teamId.toString())?.hostId) === this.me;
  }

  private emitRoom() {
    if (!this.handlers.onRoom) return;
    const players = [...this.players.values()].sort(bySeq);
    const teams = [...this.teams.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
    const infos: PlayerInfo[] = players.map((p) => ({
      id: hexOf(p.identity),
      name: p.name,
      teamId: Number(p.teamId),
      roles: p.roles.filter((r): r is Role => ALL_ROLES.includes(r as Role)),
      ready: p.ready,
      solo: p.solo,
    }));
    const teamInfos: TeamInfo[] = teams.map((t) => ({
      id: Number(t.id),
      name: t.name,
      color: t.color,
      hostId: hexOf(t.hostId) || null,
      finishMs: t.finishMs != null ? storedMilliseconds(t.finishMs) : null,
    }));
    const room = this.roomRow;
    this.handlers.onRoom({
      code: this.code,
      phase: (room?.phase ?? "lobby") as Phase,
      challengeId: room?.challengeId ?? "wobble-run",
      squadSize: coerceSquadSize(room?.squadSize ?? 5),
      players: infos,
      teams: teamInfos,
      startAt: room && room.startAtMicros > 0n ? microsToMilliseconds(room.startAtMicros) : null,
      round: room?.round ?? 0,
      now: this.serverClock.now(),
      leaderId: hexOf(room?.leaderId) || null,
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

  completeRun(_snapshot: Snap, _timeMs: number) {
    // The room server times the run from its own scheduled start.
    const round = this.roomRow?.round ?? 0;
    const teamId = this.myTeamId();
    if (round <= 0 || teamId == null) return;
    this.pendingFinish = { round, teamId, sentGeneration: null };
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

  publishSnapshot(s: Snap) {
    const room = this.roomRow;
    if (!this.conn || !room || (room.phase !== "countdown" && room.phase !== "playing")) return;
    const events = s.state ? [{ type: "state", ...s.state }, ...s.ev].slice(0, 32) : s.ev.slice(0, 32);
    this.conn.reducers.publishSnapshot({
      round: room.round,
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

  serverNow() {
    return this.serverClock.now();
  }

  close() {
    this.neutralizeInputs();
    try {
      this.conn?.reducers.leaveRoom({});
    } catch {}
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
    this.conn?.disconnect();
    this.conn = null;
    this.leaderboard.close();
  }
}
