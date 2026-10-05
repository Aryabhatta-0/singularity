import type { Snap } from "./game";
import { COUNTDOWN_MS } from "./local-room";
import { planPlayingTransition } from "./round-transition";
import type { PlayerInfo } from "./types";

/**
 * Room-round orchestration module — one deep module behind one seam for the
 * round lifecycle: countdown math, playing-transition policy, roster change
 * detection, and the snapshot buffer that bridges async engine creation.
 *
 * GameClient keeps rendering the Heat-sheet and Race rail; every phase,
 * timer, and buffering decision lives here.
 */
export { COUNTDOWN_MS, planPlayingTransition };

/** Scheduled-start fallback: matches the Room's 4.2s countdown budget. */
export const COUNTDOWN_FALLBACK_MS = COUNTDOWN_MS;

/** Countdown plate: at most "4", otherwise whole seconds remaining. */
export function countdownShown(remainingMs: number): number {
  return Math.min(4, Math.ceil(remainingMs / 1000));
}

/** Next countdown tick: wake exactly on the next whole-second flip. */
export function nextCountdownDelayMs(remainingMs: number): number {
  return Math.min(remainingMs, ((remainingMs - 1) % 1000) + 1);
}

/**
 * Roster fingerprint — only wipe teammate inputs when membership or roles
 * actually changed. Room rows re-emit on every heartbeat; clearing
 * unconditionally hitches the host's merged controls for up to an
 * input-refresh interval.
 */
export function rosterKey(players: readonly PlayerInfo[]): string {
  return players
    .map((p) => `${p.id}:${p.teamId}:${p.roles.slice().sort().join(",")}`)
    .sort()
    .join("|");
}

export type SnapshotRoute = "buffer" | "own" | "ghost";

/**
 * Route an inbound Ghost pose: buffer it while the engine is still
 * creating, apply it to your own body as a replica, or paint a rival Ghost.
 */
export function routeSnapshot(
  teamId: number,
  myTeamId: number | null | undefined,
  gameReady: boolean,
): SnapshotRoute {
  if (!gameReady) return "buffer";
  return teamId === myTeamId ? "own" : "ghost";
}

/**
 * Poses that arrive before the engine exists. Destructive takes keep the
 * creation drain to one pass with nothing left behind.
 */
export class PendingSnapshotBuffer {
  private readonly buffered = new Map<number, Snap>();

  get size(): number {
    return this.buffered.size;
  }

  set(teamId: number, snap: Snap): void {
    this.buffered.set(teamId, snap);
  }

  delete(teamId: number): void {
    this.buffered.delete(teamId);
  }

  clear(): void {
    this.buffered.clear();
  }

  /** Take one team's pose, removing it. */
  take(teamId: number): Snap | undefined {
    const snap = this.buffered.get(teamId);
    if (snap !== undefined) this.buffered.delete(teamId);
    return snap;
  }

  /** Take every remaining pose and empty the buffer. */
  takeAll(): [number, Snap][] {
    const drained = [...this.buffered];
    this.buffered.clear();
    return drained;
  }
}
