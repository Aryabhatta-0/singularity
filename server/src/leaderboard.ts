/**
 * Global leaderboard rules. The module files a run itself, straight from a
 * server-timed finish, so browsers have no way to submit or edit scores.
 *
 * Pure so the unit-test bundle can cover it directly.
 */

export const LEADERBOARD_LIMIT = 10;
export const MAX_RANKED_RUN_MS = 900_000n; // the server's own 15 minute round cap

/**
 * Fastest finish a human squad could plausibly post on each course: roughly
 * half the time a body at full walking speed (3.4 m/s) needs for the straight
 * line from spawn to the goal. Runs below it are refused, not ranked.
 */
export const MIN_RANKED_RUN_MS: Readonly<Record<string, bigint>> = {
  "wobble-run": 10_000n,
  "egg-express": 6_000n,
  "slam-dunk": 5_000n,
  "ferry-job": 6_000n,
  "summit-sync": 9_000n,
};

export interface StoredLeaderboardRow {
  id: bigint;
  time_ms: bigint;
}

export interface RankedRunInput {
  challengeId: string;
  ffa: boolean;
  squadSize: number;
  /** Everyone seated on the team when the round started. */
  rosterSize: number;
  timeMs: bigint;
}

/**
 * A full squad with one person per seat, or a lone free-for-all racer driving
 * the whole body. Short-handed squads covering extra seats are fun, but their
 * times are not comparable.
 */
export function isRankedRun(run: RankedRunInput): boolean {
  const floor = MIN_RANKED_RUN_MS[run.challengeId];
  if (floor == null) return false;
  if (run.timeMs < floor || run.timeMs > MAX_RANKED_RUN_MS) return false;
  if (run.ffa) return run.rosterSize === 1;
  return (run.squadSize === 3 || run.squadSize === 5) && run.rosterSize === run.squadSize;
}

/** Fastest time wins; an earlier auto-increment id wins an exact tie. */
export function compareStoredLeaderboardRows(a: StoredLeaderboardRow, b: StoredLeaderboardRow): number {
  if (a.time_ms !== b.time_ms) return a.time_ms < b.time_ms ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function overflowLeaderboardIds<T extends StoredLeaderboardRow>(rows: Iterable<T>, limit: number): bigint[] {
  return [...rows].sort(compareStoredLeaderboardRows).slice(limit).map((row) => row.id);
}

/** Same team name and same people, ignoring case and seat order. */
export function crewKey(teamName: string, players: readonly string[]): string {
  const names = players.map((name) => name.toLowerCase()).sort();
  return `${teamName.toLowerCase()}\u0000${names.join("\u0000")}`;
}
