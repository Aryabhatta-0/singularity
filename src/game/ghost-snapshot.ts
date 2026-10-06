import type { Snap } from "./game";
import type { LevelDef } from "./levels";
import type { TeamInfo } from "./types";
import {
  decodeSnapshotRow,
  SnapshotOrderGate,
  type SnapshotWireRow,
} from "./snapshot-codec";
import {
  mergeLiveProgress,
  progressFromSnapshot,
  roundStandings,
  type LiveTeamProgress,
  type TeamStanding,
} from "./round-standings";
import {
  SNAPSHOT_INTERPOLATION_DELAY_MS,
  SNAPSHOT_MAX_EXTRAPOLATION_MS,
  snapshotExtrapolationSeconds,
} from "./timing";

/**
 * Ghost snapshot module — one deep module behind one seam for everything a
 * Ghost needs: wire validation, ordering, interpolation timing, live
 * progress, and Race rail standings.
 *
 * Callers ask for Ghost poses and standings; strides (77 floats, stride 8),
 * the prediction cap, and progress fallbacks stay inside. The adaptive
 * render delay lives in timing.ts (SnapshotTimeline).
 */
export {
  decodeSnapshotRow,
  SnapshotOrderGate,
  mergeLiveProgress,
  progressFromSnapshot,
  roundStandings,
  SNAPSHOT_INTERPOLATION_DELAY_MS,
  SNAPSHOT_MAX_EXTRAPOLATION_MS,
  snapshotExtrapolationSeconds,
};
export type {
  LiveTeamProgress,
  SnapshotWireRow,
  TeamInfo,
  TeamStanding,
};

/** A Ghost pose freezes below this stride; finer updates are render noise. */
const LIVE_PROGRESS_EPS = 0.003;
/** Timer text only changes twice a second — skip renders inside a bucket. */
const LIVE_TIMER_BUCKET_MS = 500;

export interface SnapshotBracket {
  a: number;
  b: number;
}

/**
 * Pick the buffer pair straddling the render time. Pure: the renderer owns
 * Three.js, this module owns which two poses it may blend.
 */
export function bracketSnapshots(
  buffer: readonly { recv: number }[],
  renderTimeMs: number,
): SnapshotBracket | null {
  if (buffer.length === 0) return null;
  let a = 0;
  let b = buffer.length - 1;
  for (let i = 0; i < buffer.length - 1; i++) {
    if (buffer[i].recv <= renderTimeMs && buffer[i + 1].recv >= renderTimeMs) {
      a = i;
      b = i + 1;
      break;
    }
  }
  if (renderTimeMs > buffer[b].recv) a = b;
  return { a, b };
}

/**
 * True when the merged progress is noise — keep the current Race rail state
 * instead of re-rendering. Falls and checkpoints still flow through: only
 * sub-stride drift inside a timer bucket is swallowed.
 */
export function shouldKeepLiveProgress(
  previous: LiveTeamProgress | undefined,
  merged: LiveTeamProgress,
): boolean {
  if (!previous) return false;
  return (
    Math.abs(previous.progress - merged.progress) < LIVE_PROGRESS_EPS &&
    previous.score === merged.score &&
    previous.fallen === merged.fallen &&
    Math.floor(previous.timerMs / LIVE_TIMER_BUCKET_MS) ===
      Math.floor(merged.timerMs / LIVE_TIMER_BUCKET_MS)
  );
}

/** One call from a fresh Ghost pose to stored Race rail progress. */
export function trackGhostProgress(
  level: LevelDef,
  snap: Pick<Snap, "p" | "score" | "fallen" | "timer">,
  previous: LiveTeamProgress | undefined,
): { next: LiveTeamProgress; keep: boolean } {
  const fresh = progressFromSnapshot(level, snap);
  const next = mergeLiveProgress(previous, fresh);
  return { next, keep: shouldKeepLiveProgress(previous, next) };
}

/** Finishers lead by time; racing Ghosts follow by live progress. */
export function ghostStandings(
  teams: readonly TeamInfo[],
  live: Readonly<Record<number, LiveTeamProgress | undefined>>,
): TeamStanding[] {
  return roundStandings(teams, live);
}
