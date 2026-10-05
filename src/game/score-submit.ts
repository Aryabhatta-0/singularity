import { CHALLENGES, type SquadSize } from "./types";

/**
 * Score submit module — one deep module behind one seam for Squad naming,
 * board ordering, and score submission.
 *
 * Two adapters justify the seam: the durable SpacetimeDB table in prod
 * (via Net) and an in-memory board in tests. Server bounds are mirrored
 * here so invalid runs never leave the client; the deployed server module
 * keeps its own copy (separate process, separate `spacetime build`
 * toolchain — shared imports would break its bundle).
 */
export type { SquadSize };

export const MAX_TEAM_NAME_LENGTH = 22;
export const MAX_PLAYER_NAME_LENGTH = 16;
export const MAX_SQUAD_PLAYERS = 6;
export const LEADERBOARD_LIMIT = 10;
export const MIN_RANKED_RUN_MS = 1_000;
export const MAX_RANKED_RUN_MS = 86_400_000;

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

/** Historical name for ScoreRow — kept so the rename reads as a rename. */
export type LeaderboardRow = ScoreRow;

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

/* ------------------------------- submission ------------------------------- */

export interface ScoreSubmit {
  challengeId: string;
  squadSize: SquadSize;
  teamName: string;
  players: string[];
  timeMs: number;
}

/**
 * Build a submittable run, or null when the server would drop it.
 * Bounds mirror the server reducer: challenge known, squad 3|5, team
 * 2..22 chars, 1..6 non-empty players, sane client-clocked duration.
 */
export function buildScoreSubmit(input: {
  challengeId: string;
  squadSize: number;
  teamName: string;
  players: readonly string[];
  timeMs: number;
}): ScoreSubmit | null {
  if (!isKnownChallenge(input.challengeId)) return null;
  if (input.squadSize !== 3 && input.squadSize !== 5) return null;
  const teamName = normalizeTeamName(input.teamName);
  if (teamName.length < 2 || teamName.length > MAX_TEAM_NAME_LENGTH) return null;
  if (input.players.length === 0 || input.players.length > MAX_SQUAD_PLAYERS) return null;
  const players = input.players.map(normalizePlayerName);
  if (players.some((name) => name.length === 0)) return null;
  if (!Number.isFinite(input.timeMs)) return null;
  const timeMs = Math.max(0, Math.round(input.timeMs));
  if (timeMs < MIN_RANKED_RUN_MS || timeMs > MAX_RANKED_RUN_MS) return null;
  return { challengeId: input.challengeId, squadSize: input.squadSize, teamName, players, timeMs };
}

/* --------------------------- in-memory adapter --------------------------- */

export interface MemoryScoreBoard {
  submit(row: ScoreRow): { kept: boolean; overflow: string[] };
  topRows(challengeId: string, squadSize: SquadSize, limit?: number): ScoreRow[];
}

/**
 * Test adapter at the same seam: same ordering, same per-board cap as the
 * durable table. Overflow ids mirror the server's eviction choice.
 */
export function createMemoryScoreBoard(): MemoryScoreBoard {
  const rows = new Map<string, ScoreRow>();
  return {
    submit(row: ScoreRow) {
      rows.set(row.id, { ...row, players: [...row.players] });
      const groups = new Map<string, ScoreRow[]>();
      for (const candidate of rows.values()) {
        const key = `${candidate.challengeId}:${candidate.squadSize}`;
        const group = groups.get(key) ?? [];
        group.push(candidate);
        groups.set(key, group);
      }
      const overflow: string[] = [];
      for (const group of groups.values()) {
        group.sort(compareScoreRows);
        for (const evicted of group.slice(LEADERBOARD_LIMIT)) {
          rows.delete(evicted.id);
          overflow.push(evicted.id);
        }
      }
      return { kept: rows.has(row.id), overflow };
    },
    topRows(challengeId: string, squadSize: SquadSize, limit = LEADERBOARD_LIMIT) {
      return topScoreRows(rows.values(), challengeId, squadSize, limit);
    },
  };
}
