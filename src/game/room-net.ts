/*
 * Live match networking: one WebSocket to the game database (server/).
 * Rooms, teams, seats, inputs, physics snapshots and the global leaderboard
 * all flow through it. In each squad one browser simulates the shared body
 * and publishes snapshots while teammates send their inputs; who that is
 * is an implementation detail the server re-elects as people come and go.
 * Finishes are timed, and ranked runs filed, by the server itself.
 *
 * Built for real networks: the socket reconnects with backoff and resumes the
 * same identity (and seat) after drops, network handoffs and backgrounding;
 * every reducer call is acknowledged, which doubles as a round-trip sample
 * for the player-facing connection indicator.
 */
import { DbConnection, type EventContext } from "@/module_bindings";
import type { Input, Leaderboard, Player, Room, Snapshot, Team } from "@/module_bindings/types";
import type { Snap } from "./game";
import type { GameNet, NetHandlers } from "./game-net";
import { collectRemoteInputs, neutralInputsForRoles, type RemoteInputRow } from "./remote-input-state";
import { coerceSquadSize, compareScoreRows, type ScoreRow } from "./scores";
import { decodeSnapshotRow, SnapshotOrderGate } from "./snapshot-codec";
import { httpBaseOf } from "./server-address";
import { dropSessionToken, sessionToken } from "./session-token";
import { LinkQuality, microsToMilliseconds, nowMs, ServerClock, storedMilliseconds, type LinkGrade } from "./timing";
import type { Phase, PlayerInfo, Role, RoleInput, SquadSize, TeamInfo } from "./types";

const ALL_ROLES: Role[] = ["arms", "torso", "legs", "lhand", "rhand", "lleg", "rleg", "head"];
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 8_000;
const INPUT_LEASE_MS = 1_000;
const HEARTBEAT_MS = 15_000;
/** Consecutive refused handshakes before this tab's session is assumed stale and replaced. */
const SESSION_RETRY_LIMIT = 3;
const QUALITY_TICK_MS = 1_000;

function hexOf(id: { toHexString(): string } | undefined | null): string {
  return id ? id.toHexString() : "";
}

function bySeq(a: Player, b: Player): number {
  return a.joinedSeq < b.joinedSeq ? -1 : a.joinedSeq > b.joinedSeq ? 1 : 0;
}

function toScoreRow(row: Leaderboard): ScoreRow {
  return {
    id: row.id.toString(),
    challengeId: row.challengeId,
    squadSize: coerceSquadSize(row.squadSize),
    teamName: row.teamName,
    players: [...row.players],
    timeMs: Number(row.timeMs),
  };
}

export class RoomNet implements GameNet {
  private conn: DbConnection | null = null;
  private handlers: NetHandlers = {};
  private me = "";
  private disposed = false;
  private everConnected = false;
  private hbTimer: ReturnType<typeof setInterval> | null = null;
  private inputLeaseTimer: ReturnType<typeof setInterval> | null = null;
  private qualityTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private failedHandshakes = 0;
  private connectionGeneration = 0;
  private roomRow: Room | null = null;
  private players = new Map<string, Player>();
  private teams = new Map<string, Team>();
  private inputRows = new Map<string, Input>();
  private scores = new Map<string, ScoreRow>();
  private finishSeen = new Set<string>();
  private snapshotOrder = new SnapshotOrderGate();
  private serverClock = new ServerClock();
  private link = new LinkQuality();
  private lastGrade: LinkGrade = "good";
  private lastServerMessageAt = 0;
  private pendingFinish: { round: number; teamId: bigint; sentGeneration: number | null } | null = null;
  private lastInputRoles: Role[] = [];
  private refreshRemoteInputs: (() => void) | null = null;

  constructor(
    private readonly code: string,
    private readonly name: string,
    private readonly solo: boolean,
    readonly serverUri: string,
    private readonly database: string,
  ) {
    this.code = code.toUpperCase();
    if (typeof window !== "undefined") {
      document.addEventListener("visibilitychange", this.resumeWhenVisible);
      document.addEventListener("freeze", this.releaseHost);
      document.addEventListener("resume", this.resume);
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
    if (this.disposed || this.conn || this.reconnectTimer) return;
    const generation = ++this.connectionGeneration;
    sessionToken()
      .then((token) => {
        if (this.disposed || generation !== this.connectionGeneration) return;
        this.open(token, generation);
      })
      .catch(() => {
        // No session (offline, or the site cannot sign one): same as an unreachable server.
        if (generation !== this.connectionGeneration) return;
        this.connectionFailed();
      });
  }

  private open(token: string, generation: number) {
    const conn = DbConnection.builder()
      .withUri(this.serverUri)
      .withDatabaseName(this.database)
      .withToken(token)
      // Only table updates matter here, and gameplay state is transient:
      // skip other players' reducer metadata and do not wait on durability.
      .withLightMode(true)
      .withConfirmedReads(false)
      .onConnect((conn, identity) => {
        if (this.disposed || generation !== this.connectionGeneration) {
          conn.disconnect();
          return;
        }
        this.failedHandshakes = 0;
        this.resetCaches();
        this.conn = conn;
        this.me = identity.toHexString();
        this.lastServerMessageAt = nowMs();
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
            this.emitScores();
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
            `SELECT * FROM leaderboard`,
          ]);
      })
      .onConnectError((_ctx: unknown, error: Error) => {
        if (generation !== this.connectionGeneration) return;
        this.connectionFailed();
        void this.noteRefusedHandshake(error);
      })
      .onDisconnect(() => {
        if (generation !== this.connectionGeneration) return;
        this.connectionFailed();
      })
      .build();
    if (this.disposed || generation !== this.connectionGeneration) {
      conn.disconnect();
    } else {
      // Retain the in-flight connection so close() can tear down a pending handshake.
      this.conn = conn;
    }
  }

  /**
   * A handshake can fail because the network is down (keep the session: the
   * seat is waiting) or because the server refuses this session (replace it).
   * Browsers report both as a bare WebSocket error, so ask the server whether
   * it is reachable before concluding the session itself is the problem.
   */
  private async noteRefusedHandshake(error: Error) {
    let refused = /Failed to verify token/i.test(error?.message ?? "");
    if (!refused) {
      try {
        const ping = await fetch(`${httpBaseOf(this.serverUri)}/v1/ping`, { cache: "no-store", signal: AbortSignal.timeout(3_000) });
        refused = ping.ok;
      } catch {
        refused = false;
      }
    }
    if (!refused) {
      this.failedHandshakes = 0;
      return;
    }
    if (++this.failedHandshakes >= SESSION_RETRY_LIMIT) {
      this.failedHandshakes = 0;
      dropSessionToken();
    }
  }

  private connectionFailed() {
    this.conn = null;
    this.handlers.onRemoteInputs?.({});
    // A failed first handshake lands here too: nothing was lost yet.
    if (this.everConnected) this.handlers.onConnectionChange?.(false);
    else this.handlers.onUnreachable?.(this.serverUri);
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer) return;
    const base = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** this.reconnectAttempt++);
    // Jitter so a room full of phones does not reconnect in lockstep after an outage.
    const delay = base * (0.75 + Math.random() * 0.5);
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
    if (document.visibilityState === "visible") this.call((c) => c.reducers.setHostEligible({ eligible: true }));
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
    if (this.everConnected) this.handlers.onConnectionChange?.(false);
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

  /** A hidden or frozen tab cannot simulate (rAF stops), so hand the body to a teammate. */
  private releaseHost = () => {
    this.neutralizeInputs();
    // A concurrent disconnect also makes the server elect a successor.
    this.call((c) => c.reducers.setHostEligible({ eligible: false }));
  };

  private neutralizeInputs = () => {
    if (this.lastInputRoles.length === 0) return;
    // The server-side input TTL still guarantees eventual neutralization.
    this.sendInputs(neutralInputsForRoles(this.lastInputRoles));
  };

  /**
   * Fire a reducer on the live connection. Rejections (validation errors,
   * a socket closing mid-call) are expected and never surface as unhandled
   * promise errors; acknowledged calls feed the round-trip estimate.
   */
  private call(invoke: (conn: DbConnection) => Promise<void> | void, onError?: (error: unknown) => void) {
    const conn = this.conn;
    if (!conn || !conn.isActive) return;
    const sentAt = nowMs();
    try {
      const pending = invoke(conn);
      if (pending && typeof pending.then === "function") {
        pending.then(
          () => {
            if (this.conn === conn) this.link.observe(nowMs() - sentAt);
          },
          (error) => onError?.(error),
        );
      }
    } catch (error) {
      onError?.(error);
    }
  }

  private callJoinRoom(conn: DbConnection) {
    if (this.conn !== conn) return;
    this.call((c) => c.reducers.joinRoom({ code: this.code, name: this.name, solo: this.solo }));
    this.call((c) => c.reducers.setHostEligible({ eligible: document.visibilityState === "visible" }));
    this.hbTimer ??= setInterval(() => this.call((c) => c.reducers.heartbeat({})), HEARTBEAT_MS);
    this.inputLeaseTimer ??= setInterval(() => this.refreshRemoteInputs?.(), 250);
    this.qualityTimer ??= setInterval(() => this.emitLinkQuality(), QUALITY_TICK_MS);
  }

  private emitLinkQuality() {
    const room = this.roomRow;
    const racing = room?.phase === "countdown" || room?.phase === "playing";
    // During a round the server talks constantly (snapshots, acks); long silence means trouble.
    const quiet = racing && this.conn ? nowMs() - Math.max(this.lastServerMessageAt, this.link.sampledAt) : 0;
    const grade = this.conn ? this.link.grade(quiet) : "poor";
    if (grade === this.lastGrade) return;
    this.lastGrade = grade;
    this.handlers.onLinkQuality?.(grade, this.link.rttMs);
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
    pending.sentGeneration = this.connectionGeneration;
    // Keep queued on failure; a reconnect or the next table update retries.
    this.call(
      (c) => c.reducers.finishRun({ round: pending.round }),
      () => {
        if (this.pendingFinish === pending) pending.sentGeneration = null;
      },
    );
  }

  private wire(conn: DbConnection, generation: number) {
    const active = () => generation === this.connectionGeneration && this.conn === conn && !this.disposed;
    const inRoom = (code: string) => code === this.code;
    const heard = () => {
      this.lastServerMessageAt = nowMs();
    };

    const cacheRoom = (row: Room) => {
      if (!active() || !inRoom(row.code)) return;
      heard();
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
      heard();
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
      heard();
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
      heard();
      // The simulating client does not need to hear its own broadcast.
      if (row.teamId === this.myTeamId() && this.amSimulating()) return;
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
      heard();
      this.inputRows.set(hexOf(row.identity), row);
      applyInputs();
    });
    conn.db.visibleInput.onUpdate((_ctx: EventContext, _prev: Input, next: Input) => {
      if (!active() || !inRoom(next.code)) return;
      heard();
      this.inputRows.set(hexOf(next.identity), next);
      applyInputs();
    });
    conn.db.visibleInput.onDelete((_ctx: EventContext, row: Input) => {
      if (!active()) return;
      if (this.inputRows.delete(hexOf(row.identity))) applyInputs();
    });

    conn.db.leaderboard.onInsert((_ctx: EventContext, row: Leaderboard) => {
      if (!active()) return;
      this.scores.set(row.id.toString(), toScoreRow(row));
      this.emitScores();
    });
    conn.db.leaderboard.onDelete((_ctx: EventContext, row: Leaderboard) => {
      if (!active()) return;
      if (this.scores.delete(row.id.toString())) this.emitScores();
    });
  }

  private resetCaches() {
    this.roomRow = null;
    this.players.clear();
    this.teams.clear();
    this.inputRows.clear();
    this.scores.clear();
    this.finishSeen.clear();
    this.snapshotOrder.clear();
    this.link.reset();
    this.refreshRemoteInputs = null;
    this.handlers.onRemoteInputs?.({});
  }

  private myTeamId(): bigint | null {
    return this.players.get(this.me)?.teamId ?? null;
  }

  private amSimulating(): boolean {
    const teamId = this.myTeamId();
    if (teamId == null) return false;
    return hexOf(this.teams.get(teamId.toString())?.hostId) === this.me;
  }

  private emitScores() {
    this.handlers.onScores?.([...this.scores.values()].sort(compareScoreRows));
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
      ffa: room?.ffa ?? false,
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
    this.call((c) => c.reducers.setRole({ role }));
  }
  joinTeam(teamId: number) {
    this.call((c) => c.reducers.joinTeam({ teamId: BigInt(teamId) }));
  }
  createTeam() {
    this.call((c) => c.reducers.createTeam({}));
  }
  renameTeam(name: string) {
    this.call((c) => c.reducers.renameTeam({ name }));
  }
  setReady(ready: boolean) {
    this.call((c) => c.reducers.setReady({ ready }));
  }
  setChallenge(challengeId: string) {
    this.call((c) => c.reducers.setChallenge({ challengeId }));
  }
  setSquad(squadSize: SquadSize) {
    this.call((c) => c.reducers.setSquad({ size: squadSize }));
  }
  setMode(ffa: boolean) {
    this.call((c) => c.reducers.setMode({ ffa }));
  }
  startRound(force: boolean) {
    this.call((c) => c.reducers.startRound({ force }));
  }
  backToLobby() {
    this.call((c) => c.reducers.backToLobby({}));
  }

  completeRun(_snapshot: Snap, _timeMs: number) {
    // The server times the run from its own scheduled start.
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
    const inputs = roles.map((r) => {
      const i = payload[r]!;
      return { f: i.f, s: i.s, a: i.a, b: i.b, q: i.q, e: i.e, lx: i.lx, ly: i.ly };
    });
    this.call((c) => c.reducers.sendInput({ roles, inputs }));
  }

  publishSnapshot(s: Snap) {
    const room = this.roomRow;
    if (!room || (room.phase !== "countdown" && room.phase !== "playing")) return;
    const events = s.state ? [{ type: "state", ...s.state }, ...s.ev].slice(0, 32) : s.ev.slice(0, 32);
    this.call((c) => c.reducers.publishSnapshot({
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
    }));
  }

  serverNow() {
    return this.serverClock.now();
  }

  close() {
    this.neutralizeInputs();
    this.call((c) => c.reducers.leaveRoom({}));
    this.disposed = true;
    this.connectionGeneration += 1;
    if (this.hbTimer) clearInterval(this.hbTimer);
    if (this.inputLeaseTimer) clearInterval(this.inputLeaseTimer);
    if (this.qualityTimer) clearInterval(this.qualityTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (typeof window !== "undefined") {
      document.removeEventListener("visibilitychange", this.resumeWhenVisible);
      document.removeEventListener("freeze", this.releaseHost);
      document.removeEventListener("resume", this.resume);
      window.removeEventListener("focus", this.resume);
      window.removeEventListener("online", this.reconnectOnOnline);
      window.removeEventListener("pageshow", this.resume);
      window.removeEventListener("blur", this.neutralizeInputs);
      window.removeEventListener("offline", this.releaseHost);
      window.removeEventListener("pagehide", this.releaseHost);
    }
    this.conn?.disconnect();
    this.conn = null;
  }
}
