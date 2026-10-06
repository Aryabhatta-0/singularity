/*
 * Offline practice: the whole room lives in this tab (LocalRoom) and this
 * client always simulates its own body. No game server needed. Practice
 * times stay in this tab: nothing a browser reports on its own can rank, so
 * the global leaderboard is shown read-only.
 */
import type { Snap } from "./game";
import type { GameNet, NetHandlers } from "./game-net";
import { fetchLeaderboard } from "./leaderboard-http";
import { LocalRoom } from "./local-room";
import { nowMs } from "./timing";
import type { Role, RoleInput, SquadSize } from "./types";

export class OfflineNet implements GameNet {
  readonly serverUri = null;
  private room: LocalRoom | null = null;
  private handlers: NetHandlers = {};
  private leaderboardFetch: AbortController | null = null;
  private disposed = false;
  private me = "";

  constructor(
    private readonly code: string,
    private readonly name: string,
    private readonly solo: boolean,
  ) {}

  get myId(): string {
    return this.me;
  }

  setHandlers(h: NetHandlers) {
    this.handlers = h;
  }

  connect() {
    if (this.disposed || this.room) return;
    const room = new LocalRoom(this.code, this.name, this.solo);
    this.room = room;
    this.me = room.myId;
    room.setEvents({
      onChange: (snapshot) => this.handlers.onRoom?.(snapshot),
      onTeamFinished: (teamId, timeMs, teamName) => this.handlers.onTeamFinished?.(teamId, timeMs, teamName),
    });
    this.handlers.onScores?.([]);
    this.handlers.onConnectionChange?.(true);
    this.handlers.onRoom?.(room.snapshot());
    this.handlers.onRemoteInputs?.({});
    this.refreshLeaderboard();
  }

  /** Best effort: practice works the same whether or not the board loads. */
  private refreshLeaderboard() {
    this.leaderboardFetch?.abort();
    const controller = new AbortController();
    this.leaderboardFetch = controller;
    fetchLeaderboard(controller.signal)
      .then((rows) => {
        if (!this.disposed) this.handlers.onScores?.(rows);
      })
      .catch(() => {});
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
  setMode(ffa: boolean) {
    this.room?.setMode(ffa);
  }
  startRound(force: boolean) {
    this.room?.startRound(force);
  }
  backToLobby() {
    this.room?.backToLobby();
  }

  completeRun(_snapshot: Snap, timeMs: number) {
    if (this.room?.completeRun(timeMs)) this.refreshLeaderboard();
  }

  sendInputs(_payload: Partial<Record<Role, RoleInput>>) {
    // This tab is the only simulator; Game applies local inputs directly.
  }

  publishSnapshot(_s: Snap) {
    // Nobody else to show the body to.
  }

  serverNow() {
    return nowMs();
  }

  close() {
    this.disposed = true;
    this.room?.dispose();
    this.room = null;
    this.leaderboardFetch?.abort();
  }
}
