/*
 * The one networking seam GameClient talks to. Two adapters sit behind it:
 * RoomNet (live match on the game server) and OfflineNet (single-tab
 * practice, no server needed).
 */
import type { Snap } from "./game";
import type { ScoreRow } from "./scores";
import type { LinkGrade } from "./timing";
import type { Role, RoleInput, RoomSnapshot, SquadSize } from "./types";

export interface NetHandlers {
  onRoom?: (room: RoomSnapshot) => void;
  onRemoteInputs?: (inputs: Partial<Record<Role, RoleInput>>) => void;
  onSnapshot?: (teamId: number, snap: Snap) => void;
  onSnapshotCleared?: (teamId: number) => void;
  onTeamFinished?: (teamId: number, timeMs: number, teamName: string) => void;
  onConnectionChange?: (connected: boolean) => void;
  /** The game server could not be reached on the first try (still retrying). */
  onUnreachable?: (serverUri: string) => void;
  /** Global leaderboard rows (read-only for every client). */
  onScores?: (rows: ScoreRow[]) => void;
  /** Player-facing connection quality changed; rttMs is the smoothed round trip. */
  onLinkQuality?: (grade: LinkGrade, rttMs: number | null) => void;
}

export interface GameNet {
  /** This client's player id (empty until connected). */
  readonly myId: string;
  /** Game server address, or null when playing offline. */
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
  /** This client's simulation of the shared body reached the objective. */
  completeRun(snapshot: Snap, timeMs: number): void;
  sendInputs(payload: Partial<Record<Role, RoleInput>>): void;
  publishSnapshot(snapshot: Snap): void;
  /** Wall clock aligned with whoever owns the round timeline. */
  serverNow(): number;
  close(): void;
}
