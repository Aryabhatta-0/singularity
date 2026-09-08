/*
 * SINGULARITY — SpacetimeDB server module (leaderboard-only).
 *
 * Live multiplayer state (rooms, teams, roles, ready-up, round lifecycle,
 * input relay, physics snapshots) is browser-local temp state now — see
 * src/game/local-room.ts / src/game/net.ts. This module durably stores only
 * final leaderboard runs, submitted by clients that trust their local clock.
 */
import { schema, table, t } from 'spacetimedb/server';
import { overflowLeaderboardIds } from './leaderboard';

/* ---------------------------------- constants ---------------------------------- */

const CHALLENGE_IDS = new Set(['wobble-run', 'ferry-job', 'summit-sync', 'egg-express', 'slam-dunk']);
const LEADERBOARD_LIMIT = 10;
const MIN_RANKED_RUN_MS = 1_000n;
const MAX_RANKED_RUN_MS = 86_400_000n; // 24h sanity cap for client-reported times
const MAX_TEAM_NAME_LENGTH = 22;
const MAX_PLAYER_NAME_LENGTH = 16;
const MAX_PLAYERS = 6;

/* ---------------------------------- tables ---------------------------------- */

/**
 * Materialized global leaderboard, kept bounded to the ten fastest runs for
 * each challenge and squad size. Schema is unchanged from the full module so
 * existing rows survive the slimming migration.
 */
const leaderboard = table(
  {
    name: 'leaderboard',
    public: true,
    indexes: [
      {
        accessor: 'challenge_squad',
        algorithm: 'btree',
        columns: ['challenge_id', 'squad_size'] as const,
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    challenge_id: t.string(),
    squad_size: t.u8(),
    team_name: t.string(),
    players: t.array(t.string()),
    time_ms: t.u64(),
    created_at: t.timestamp(),
  }
);

const spacetimedb = schema({
  leaderboard,
});
export default spacetimedb;

/* ---------------------------------- helpers (unexported) ---------------------------------- */

function leaderboardRows(ctx: any, challengeId: string, squadSize: number): any[] {
  return [...ctx.db.leaderboard.challenge_squad.filter([challengeId, squadSize])];
}

/* ---------------------------------- reducers ---------------------------------- */

/**
 * Store a final run on the global leaderboard. Client-reported time is
 * trusted (no objective proof); only shape/bounds are validated and each
 * challenge/squad board stays capped at the ten fastest runs.
 */
export const submitScore = spacetimedb.reducer(
  {
    challengeId: t.string(),
    squadSize: t.u8(),
    teamName: t.string(),
    players: t.array(t.string()),
    timeMs: t.u64(),
  },
  (ctx, { challengeId, squadSize, teamName, players, timeMs }) => {
    if (!CHALLENGE_IDS.has(challengeId)) return;
    if (squadSize !== 3 && squadSize !== 5) return;
    if (timeMs < MIN_RANKED_RUN_MS || timeMs > MAX_RANKED_RUN_MS) return;
    const normalizedTeam = teamName.replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ');
    if (normalizedTeam.length < 2 || normalizedTeam.length > MAX_TEAM_NAME_LENGTH) return;
    if (players.length === 0 || players.length > MAX_PLAYERS) return;
    const normalizedPlayers = players.map((name: string) =>
      name.replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ').slice(0, MAX_PLAYER_NAME_LENGTH)
    );
    if (normalizedPlayers.some((name: string) => name.length === 0)) return;

    ctx.db.leaderboard.insert({
      id: 0n,
      challenge_id: challengeId,
      squad_size: squadSize,
      team_name: normalizedTeam,
      players: normalizedPlayers,
      time_ms: timeMs,
      created_at: ctx.timestamp,
    });
    const overflowIds = overflowLeaderboardIds(
      leaderboardRows(ctx, challengeId, squadSize),
      LEADERBOARD_LIMIT
    );
    for (const id of overflowIds) ctx.db.leaderboard.id.delete(id);
  }
);
