export interface StoredLeaderboardRow {
  id: bigint;
  time_ms: bigint;
}

/** Fastest time wins; an earlier auto-increment id wins an exact tie. */
export function compareStoredLeaderboardRows(a: StoredLeaderboardRow, b: StoredLeaderboardRow): number {
  if (a.time_ms !== b.time_ms) return a.time_ms < b.time_ms ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function overflowLeaderboardIds<T extends StoredLeaderboardRow>(
  rows: Iterable<T>,
  limit: number
): bigint[] {
  return [...rows].sort(compareStoredLeaderboardRows).slice(limit).map((row) => row.id);
}
