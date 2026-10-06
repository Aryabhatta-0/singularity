import { CHALLENGES, type SquadSize } from "./types";

/**
 * Scores module: squad naming and leaderboard board ordering on the client.
 *
 * Browsers never submit scores. The game server files ranked runs itself,
 * from finishes it timed (server/src/leaderboard.ts); this side only names
 * squads and sorts/filters the rows it reads back.
 */
export type { SquadSize };

export const MAX_TEAM_NAME_LENGTH = 22;
export const MAX_PLAYER_NAME_LENGTH = 16;
export const LEADERBOARD_LIMIT = 10;

/** Challenge IDs own one source: the Challenge list. */
export const CHALLENGE_IDS: ReadonlySet<string> = new Set(CHALLENGES.map((c) => c.id));

export function isKnownChallenge(challengeId: string): boolean {
  return CHALLENGE_IDS.has(challengeId);
}

/* ------------------------------- naming ------------------------------- */

const CONTROL_CHARS = "[\\u0000-\\u001f\\u007f]";

/** Strip control chars, trim, collapse whitespace. Slicing stays with callers. */
export function normalizeTeamName(name: string): string {
  return name.replace(new RegExp(CONTROL_CHARS, "g"), "").trim().replace(/\s+/g, " ");
}

export function isValidTeamName(name: string): boolean {
  const normalized = normalizeTeamName(name);
  return normalized.length >= 2 && normalized.length <= MAX_TEAM_NAME_LENGTH;
}

export function normalizePlayerName(name: string): string {
  return normalizeTeamName(name).slice(0, MAX_PLAYER_NAME_LENGTH);
}

export function isTeamNameTaken(
  teams: readonly { id: number; name: string }[],
  ownId: number,
  name: string,
): boolean {
  const key = normalizeTeamName(name).toLocaleLowerCase();
  return teams.some((t) => t.id !== ownId && t.name.toLocaleLowerCase() === key);
}

/** Preferred name wins, else the smallest unused "Team N" (N >= 1). */
export function pickSquadName(existingNames: readonly string[], preferred?: string): string {
  const used = new Set(existingNames.map((n) => n.toLocaleLowerCase()));
  if (preferred) {
    const p = normalizeTeamName(preferred).slice(0, MAX_TEAM_NAME_LENGTH);
    if (p.length >= 2 && !used.has(p.toLocaleLowerCase())) return p;
  }
  for (let n = 1; ; n++) {
    const candidate = `Team ${n}`;
    if (!used.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

/* ------------------------------ board order ------------------------------ */

export interface ScoreRow {
  id: string;
  challengeId: string;
  squadSize: SquadSize;
  teamName: string;
  players: string[];
  timeMs: number;
}

/**
 * Fastest time wins; an earlier auto-increment id wins an exact tie.
 * IDs are u64s — bigint comparison keeps "10" after "2".
 */
export function compareScoreRows(a: ScoreRow, b: ScoreRow): number {
  if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
  const aId = BigInt(a.id);
  const bId = BigInt(b.id);
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

/** Select one board before limiting it, so busy categories cannot starve others. */
export function topScoreRows(
  rows: Iterable<ScoreRow>,
  challengeId: string,
  squadSize: SquadSize,
  limit = LEADERBOARD_LIMIT,
): ScoreRow[] {
  return [...rows]
    .filter((row) => row.challengeId === challengeId && row.squadSize === squadSize)
    .sort(compareScoreRows)
    .slice(0, Math.max(0, limit));
}

/** Wire-format squad size: the table only knows 3- and 5-Joint boards. */
export function coerceSquadSize(value: number): SquadSize {
  return value === 3 ? 3 : 5;
}
