/*
 * Global leaderboard connection — the only durable data in SINGULARITY.
 *
 * Talks to the leaderboard database (leaderboard-server/), never the room
 * server: subscribe to the bounded `leaderboard` table and submit final runs.
 * Best-effort throughout — matches keep working without it.
 */
import { DbConnection, type EventContext } from "@/leaderboard_bindings";
import type { Leaderboard } from "@/leaderboard_bindings/types";
import { compareScoreRows, coerceSquadSize, type ScoreRow, type ScoreSubmit } from "./score-submit";
import { loadSpacetimeToken, saveSpacetimeToken } from "./spacetime-token";

const RECONNECT_MS = 10_000;

export class LeaderboardFeed {
  private conn: DbConnection | null = null;
  private rows = new Map<string, ScoreRow>();
  private pending: ScoreSubmit[] = [];
  private disposed = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly uri: string,
    private readonly database: string,
    private readonly onScores: (rows: ScoreRow[]) => void,
  ) {}

  connect() {
    if (this.disposed || this.conn) return;
    const tokenKey = `${this.uri}/${this.database}`;
    try {
      const conn = DbConnection.builder()
        .withUri(this.uri)
        .withDatabaseName(this.database)
        .withToken(loadSpacetimeToken(tokenKey))
        .onConnect((c, _identity, token) => {
          if (this.disposed) {
            c.disconnect();
            return;
          }
          saveSpacetimeToken(tokenKey, token);
          c.db.leaderboard.onInsert((_ctx: EventContext, row: Leaderboard) => {
            this.rows.set(row.id.toString(), toRow(row));
            this.emit();
          });
          c.db.leaderboard.onDelete((_ctx: EventContext, row: Leaderboard) => {
            if (this.rows.delete(row.id.toString())) this.emit();
          });
          c.subscriptionBuilder()
            .onApplied(() => {
              if (!this.disposed) this.flush();
            })
            .onError(() => {
              try {
                c.disconnect();
              } catch {}
            })
            .subscribe([`SELECT * FROM leaderboard`]);
        })
        .onConnectError(() => this.dropAndRetry())
        .onDisconnect(() => this.dropAndRetry())
        .build();
      this.conn = conn;
    } catch {
      this.dropAndRetry();
    }
  }

  /** Queue a run; it is sent now or as soon as the leaderboard is reachable. */
  submit(run: ScoreSubmit) {
    this.pending.push(run);
    this.flush();
  }

  close() {
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    try {
      this.conn?.disconnect();
    } catch {}
    this.conn = null;
  }

  private dropAndRetry() {
    this.conn = null;
    if (this.disposed || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, RECONNECT_MS);
  }

  private emit() {
    this.onScores([...this.rows.values()].sort(compareScoreRows));
  }

  private flush() {
    const conn = this.conn;
    if (!conn?.isActive) return;
    while (this.pending.length > 0) {
      const run = this.pending[0];
      try {
        conn.reducers.submitScore({
          challengeId: run.challengeId,
          squadSize: run.squadSize,
          teamName: run.teamName,
          players: run.players,
          timeMs: BigInt(run.timeMs),
        });
      } catch {
        return; // keep queued; the next (re)connect retries
      }
      this.pending.shift();
    }
  }
}

function toRow(row: Leaderboard): ScoreRow {
  return {
    id: row.id.toString(),
    challengeId: row.challengeId,
    squadSize: coerceSquadSize(row.squadSize),
    teamName: row.teamName,
    players: [...row.players],
    timeMs: Number(row.timeMs),
  };
}
