import { compareScoreRows } from "@/game/scores";
import { readLeaderboard } from "@/server/leaderboard";

export const dynamic = "force-dynamic";

/**
 * Public, read-only global leaderboard. Cached at the edge so a busy landing
 * page costs the database one small query every half minute at most.
 */
export async function GET() {
  try {
    const rows = (await readLeaderboard()).sort(compareScoreRows);
    return Response.json(
      { status: "ok", rows },
      { headers: { "Cache-Control": "public, max-age=15, s-maxage=30, stale-while-revalidate=300" } },
    );
  } catch (error) {
    console.error("Leaderboard unavailable:", error instanceof Error ? error.message : error);
    return Response.json(
      { status: "unavailable", rows: [] },
      { status: 503, headers: { "Cache-Control": "public, max-age=5, s-maxage=10" } },
    );
  }
}
