/*
 * Pick the networking adapter for a match and resolve where the game database lives.
 */
import type { GameNet } from "./game-net";
import { OfflineNet } from "./offline-net";
import { RoomNet } from "./room-net";
import { DEFAULT_DATABASE, resolveServerUri } from "./server-address";

export type { GameNet, NetHandlers } from "./game-net";

// Literal process.env reads so Next.js inlines them at build time.
const SERVER_URI = process.env.NEXT_PUBLIC_SPACETIMEDB_URI;
const DATABASE = process.env.NEXT_PUBLIC_SPACETIMEDB_DATABASE || DEFAULT_DATABASE;

export function createNet(options: {
  code: string;
  name: string;
  solo: boolean;
  /** Single-tab practice without a game server. */
  offline: boolean;
}): GameNet {
  if (options.offline) return new OfflineNet(options.code, options.name, options.solo);
  const serverUri = resolveServerUri({ env: SERVER_URI, location: window.location });
  return new RoomNet(options.code, options.name, options.solo, serverUri, DATABASE);
}
