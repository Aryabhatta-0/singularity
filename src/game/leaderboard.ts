/**
 * Board ordering lives in the Score submit module now — this file stays as
 * its historical import path so existing callers and tests keep working.
 */
export {
  LEADERBOARD_LIMIT,
  compareScoreRows as compareLeaderboardRows,
  topScoreRows as topLeaderboardRows,
  type ScoreRow as LeaderboardRow,
} from "./score-submit";
