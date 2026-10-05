/*
 * The one networking seam GameClient talks to. Two adapters sit behind it:
 * RoomNet (live match on the host's room server) and OfflineNet (single-tab
 * practice, no server needed). Both report finishes to the leaderboard.
 */
import type { Snap } from "./game";
import type { ScoreRow } from "./score-submit";
import type { Role, RoleInput, RoomSnapshot, SquadSize } from "./types";

export interface NetHandlers {
  onRoom?: (room: RoomSnapshot) => void;
  onRemoteInputs?: (inputs: Partial<Record<Role, RoleInput>>) => void;
  onSnapshot?: (teamId: number, snap: Snap) => void;
  onSnapshotCleared?: (teamId: number) => void;
  onTeamFinished?: (teamId: number, timeMs: number, teamName: string) => void;
  onConnectionChange?: (connected: boolean) => void;
  /** The room server could not be reached on the first try (still retrying). */
  onUnreachable?: (serverUri: string) => void;
  onScores?: (rows: ScoreRow[]) => void;
}

export interface GameNet {
  /** This client's player id (empty until connected). */
  readonly myId: string;
  /** Room server address, or null when playing offline. */
  readonly serverUri: string | null;
  setHandlers(handlers: NetHandlers): void;
  connect(): void;
  setRole(role: Role): void;
  joinTeam(teamId: number): void;
  createTeam(): void;
  renameTeam(name: string): void;
  setReady(ready: boolean): void;
  setChallenge(challengeId: string): void;
  setSquad(squadSize: SquadSize): void;
  /** Leader-only, lobby-only: free-for-all (true) or team versus (false). */
  setMode(ffa: boolean): void;
  startRound(force: boolean): void;
  backToLobby(): void;
  /** The team host reached the objective. */
  completeRun(snapshot: Snap, timeMs: number): void;
  sendInputs(payload: Partial<Record<Role, RoleInput>>): void;
  publishSnapshot(snapshot: Snap): void;
  /** Wall clock aligned with whoever owns the round timeline. */
  serverNow(): number;
  close(): void;
}
