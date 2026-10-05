/*
 * Offline practice: the whole room lives in this tab (LocalRoom) and this
 * client always simulates its own body. No room server needed — useful for
 * solo training when nobody is hosting. Finishes still reach the leaderboard
 * when it is reachable.
 */
import type { Snap } from "./game";
import type { GameNet, NetHandlers } from "./game-net";
import { LeaderboardFeed } from "./leaderboard-feed";
import { LocalRoom } from "./local-room";
import { buildScoreSubmit, isRankedRoster } from "./score-submit";
import { nowMs } from "./timing";
import type { Role, RoleInput, SquadSize } from "./types";

export class OfflineNet implements GameNet {
  readonly serverUri = null;
  private room: LocalRoom | null = null;
  private handlers: NetHandlers = {};
  private leaderboard: LeaderboardFeed;
  private disposed = false;
  private me = "";

  constructor(
    private readonly code: string,
    private readonly name: string,
    private readonly solo: boolean,
    leaderboard: { uri: string; database: string },
  ) {
    this.leaderboard = new LeaderboardFeed(leaderboard.uri, leaderboard.database, (rows) =>
      this.handlers.onScores?.(rows)
    );
  }

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
    this.leaderboard.connect();
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
    const room = this.room;
    if (!room) return;
    const finished = room.completeRun(timeMs);
    if (!finished) return;
    const snap = room.snapshot();
    const me = snap.players.find((p) => p.id === this.me);
    if (!isRankedRoster({ memberCount: 1, squadSize: snap.squadSize, solo: me?.solo ?? false })) return;
    const submit = buildScoreSubmit({
      challengeId: snap.challengeId,
      squadSize: snap.squadSize,
      teamName: finished.teamName,
      players: [me?.name ?? this.name],
      timeMs: finished.time,
    });
    if (submit) this.leaderboard.submit(submit);
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
    this.leaderboard.close();
  }
}
