/*
 * Read-only global leaderboard over HTTP (`/api/leaderboard`, edge-cached).
 * Used where no game connection is open: the landing page and offline
 * practice. Live rooms read the same table over their existing connection.
 */
import { compareScoreRows, type ScoreRow } from "./scores";

export type LeaderboardStatus = "loading" | "ok" | "unavailable";

export async function fetchLeaderboard(signal?: AbortSignal): Promise<ScoreRow[]> {
  const response = await fetch("/api/leaderboard", { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = (await response.json()) as { rows?: ScoreRow[] };
  return Array.isArray(body.rows) ? [...body.rows].sort(compareScoreRows) : [];
}
