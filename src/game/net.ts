/*
 * Pick the networking adapter for a match and resolve where its databases live.
 */
import type { GameNet } from "./game-net";
import { OfflineNet } from "./offline-net";
import { RoomNet } from "./room-net";
import {
  DEFAULT_LEADERBOARD_DATABASE,
  DEFAULT_ROOM_DATABASE,
  resolveLeaderboardUri,
  resolveRoomServerUri,
} from "./server-address";

export type { GameNet, NetHandlers } from "./game-net";

// Literal process.env reads so Next.js inlines them at build time.
const ROOM_SERVER_URI = process.env.NEXT_PUBLIC_ROOM_SERVER_URI;
const ROOM_DATABASE = process.env.NEXT_PUBLIC_ROOM_DATABASE || DEFAULT_ROOM_DATABASE;
const LEADERBOARD_URI = process.env.NEXT_PUBLIC_LEADERBOARD_URI;
const LEADERBOARD_DATABASE = process.env.NEXT_PUBLIC_LEADERBOARD_DATABASE || DEFAULT_LEADERBOARD_DATABASE;

export function createNet(options: {
  code: string;
  name: string;
  solo: boolean;
  /** Single-tab practice without a room server. */
  offline: boolean;
  /** `?server=` override from the invite link. */
  serverQuery: string | null;
}): GameNet {
  const location = window.location;
  const leaderboard = {
    uri: resolveLeaderboardUri({ env: LEADERBOARD_URI, location }),
    database: LEADERBOARD_DATABASE,
  };
  if (options.offline) return new OfflineNet(options.code, options.name, options.solo, leaderboard);
  const serverUri = resolveRoomServerUri({ query: options.serverQuery, env: ROOM_SERVER_URI, location });
  return new RoomNet(options.code, options.name, options.solo, serverUri, ROOM_DATABASE, leaderboard);
}
