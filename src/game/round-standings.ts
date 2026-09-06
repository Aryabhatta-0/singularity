import type { Snap } from "./game";
import type { LevelDef } from "./levels";
import type { TeamInfo } from "./types";

export interface LiveTeamProgress {
  progress: number;
  score: number;
  fallen: boolean;
  timerMs: number;
}

export interface TeamStanding {
  team: TeamInfo;
  place: number;
  progress: number;
  score: number;
  fallen: boolean;
  timerMs: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Turn the network state every team already publishes into a compact race
 * progress value. Course challenges advance along their start-to-objective Z
 * axis; score challenges advance by baskets made.
 */
export function progressFromSnapshot(
  level: LevelDef,
  snapshot: Pick<Snap, "p" | "score" | "fallen" | "timer">
): LiveTeamProgress {
  const score = Number.isFinite(snapshot.score) ? Math.max(0, Math.floor(snapshot.score)) : 0;
  const targetScore = level.targetScore ?? 0;
  let progress = 0;

  if (targetScore > 0) {
    progress = score / targetScore;
  } else {
    const pelvisZ = snapshot.p[2];
    const targetZ = level.finish?.pos[2] ?? level.deliver?.pos[2] ?? level.hoop?.pos[2];
    const distance = targetZ == null ? 0 : targetZ - level.spawn[2];
    if (Number.isFinite(pelvisZ) && Number.isFinite(distance) && Math.abs(distance) > 0.001) {
      progress = (pelvisZ - level.spawn[2]) / distance;
    }
  }

  return {
    // The authoritative team row, not a guessed pose, owns the 100% state.
    progress: Math.min(0.995, clamp01(progress)),
    score,
    fallen: snapshot.fallen === 1,
    timerMs: Number.isFinite(snapshot.timer) ? Math.max(0, Math.round(snapshot.timer * 1000)) : 0,
  };
}

/** Keep checkpoint-like progress monotonic during a round, even after a fall. */
export function mergeLiveProgress(
  previous: LiveTeamProgress | undefined,
  next: LiveTeamProgress
): LiveTeamProgress {
  if (!previous) return next;
  return {
    progress: Math.max(previous.progress, next.progress),
    score: Math.max(previous.score, next.score),
    fallen: next.fallen,
    timerMs: Math.max(previous.timerMs, next.timerMs),
  };
}

/** Finishers lead by time; racing teams follow by live progress. */
export function roundStandings(
  teams: readonly TeamInfo[],
  live: Readonly<Record<number, LiveTeamProgress | undefined>>
): TeamStanding[] {
  return teams
    .map((team) => ({
      team,
      place: 0,
      progress: team.finishMs != null ? 1 : (live[team.id]?.progress ?? 0),
      score: live[team.id]?.score ?? 0,
      fallen: live[team.id]?.fallen ?? false,
      timerMs: team.finishMs ?? live[team.id]?.timerMs ?? 0,
    }))
    .sort((a, b) => {
      const aFinished = a.team.finishMs != null;
      const bFinished = b.team.finishMs != null;
      if (aFinished !== bFinished) return aFinished ? -1 : 1;
      if (aFinished && bFinished && a.team.finishMs !== b.team.finishMs) {
        return (a.team.finishMs ?? 0) - (b.team.finishMs ?? 0);
      }
      if (a.progress !== b.progress) return b.progress - a.progress;
      if (a.score !== b.score) return b.score - a.score;
      return a.team.id - b.team.id;
    })
    .map((standing, index) => ({ ...standing, place: index + 1 }));
}
