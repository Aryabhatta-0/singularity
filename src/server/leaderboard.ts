import "server-only";
import { signSession } from "@/lib/session-jwt";
import { coerceSquadSize, isKnownChallenge, type ScoreRow } from "@/game/scores";
import { DEFAULT_DATABASE, httpBaseOf, normalizeServerUri } from "@/game/server-address";
import { sessionIssuer } from "./session";

/**
 * Read the global leaderboard over SpacetimeDB's SQL HTTP API, as this server
 * (with its own short-lived session token). The landing page and offline
 * practice use this instead of opening a database socket in the browser.
 */

const LOCAL_HTTP_BASE = "http://127.0.0.1:3000";
const QUERY_TIMEOUT_MS = 4_000;

interface SqlResult {
  schema?: { elements?: { name?: { some?: string } }[] };
  rows?: unknown[][];
}

function databaseHttpBase(): string {
  const pinned = normalizeServerUri(process.env.NEXT_PUBLIC_SPACETIMEDB_URI);
  return pinned ? httpBaseOf(pinned) : LOCAL_HTTP_BASE;
}

function toRow(record: Record<string, unknown>): ScoreRow | null {
  const id = record.id;
  const timeMs = Number(record.time_ms);
  const challengeId = record.challenge_id;
  const teamName = record.team_name;
  const players = record.players;
  if ((typeof id !== "number" && typeof id !== "string") || typeof challengeId !== "string" || !isKnownChallenge(challengeId)) return null;
  if (typeof teamName !== "string" || !Array.isArray(players) || !Number.isFinite(timeMs) || timeMs <= 0) return null;
  return {
    id: String(id),
    challengeId,
    squadSize: coerceSquadSize(Number(record.squad_size)),
    teamName: teamName.slice(0, 32),
    players: players.filter((name): name is string => typeof name === "string").slice(0, 6).map((name) => name.slice(0, 24)),
    timeMs,
  };
}

export async function readLeaderboard(): Promise<ScoreRow[]> {
  const config = await sessionIssuer();
  if (!config) throw new Error("sessions-unavailable");
  const { token } = await signSession(config.key, { issuer: config.issuer, ttlSeconds: 120 });
  const database = process.env.NEXT_PUBLIC_SPACETIMEDB_DATABASE?.trim() || DEFAULT_DATABASE;
  const response = await fetch(`${databaseHttpBase()}/v1/database/${encodeURIComponent(database)}/sql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
    body: "SELECT * FROM leaderboard",
    cache: "no-store",
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`leaderboard query failed: HTTP ${response.status}`);
  const [result] = (await response.json()) as SqlResult[];
  const columns = result?.schema?.elements?.map((element) => element.name?.some ?? "") ?? [];
  const rows: ScoreRow[] = [];
  for (const values of result?.rows ?? []) {
    if (!Array.isArray(values)) continue;
    const row = toRow(Object.fromEntries(columns.map((column, index) => [column, values[index]])));
    if (row) rows.push(row);
  }
  return rows;
}
