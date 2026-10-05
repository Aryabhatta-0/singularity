/**
 * Where the two SpacetimeDB databases live.
 *
 * - Room server: run by whoever hosts the match (`npm run host`). Friends load
 *   the game from the host's machine, so by default the room server is the
 *   same hostname the page came from, on SpacetimeDB's port. `?server=` in the
 *   URL (or NEXT_PUBLIC_ROOM_SERVER_URI) points somewhere else.
 * - Leaderboard: the only database meant to be hosted publicly. Until it is
 *   (NEXT_PUBLIC_LEADERBOARD_URI), it sits beside the room server.
 */

export const SPACETIMEDB_PORT = 3000;
export const DEFAULT_ROOM_DATABASE = "singularity-room";
export const DEFAULT_LEADERBOARD_DATABASE = "singularity";

export interface PageLocation {
  protocol: string;
  hostname: string;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

function hostWithBrackets(hostname: string): string {
  return hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
}

/** SpacetimeDB on the machine that served this page. */
export function sameHostServerUri(location: PageLocation): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${hostWithBrackets(location.hostname)}:${SPACETIMEDB_PORT}`;
}

/**
 * Accept what a person would actually type or paste — `192.168.1.5`,
 * `192.168.1.5:3000`, `ws://…`, `wss://…`, `http(s)://…` — and return a
 * WebSocket URI, or null when it is not a usable address.
 */
export function normalizeServerUri(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `ws://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  const scheme = url.protocol === "wss:" || url.protocol === "https:" ? "wss"
    : url.protocol === "ws:" || url.protocol === "http:" ? "ws"
    : null;
  if (!scheme || !url.hostname) return null;
  const port = url.port || (/^[a-z]+:\/\//i.test(value) ? "" : String(SPACETIMEDB_PORT));
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  return `${scheme}://${url.hostname}${port ? `:${port}` : ""}${path}`;
}

export function resolveRoomServerUri(input: {
  query?: string | null;
  env?: string | null;
  location: PageLocation;
}): string {
  return normalizeServerUri(input.query) ?? normalizeServerUri(input.env) ?? sameHostServerUri(input.location);
}

export function resolveLeaderboardUri(input: { env?: string | null; location: PageLocation }): string {
  return normalizeServerUri(input.env) ?? sameHostServerUri(input.location);
}

/**
 * The address friends should open. A host browsing on `localhost` would
 * otherwise copy a link that points at each friend's own machine, so swap in
 * the host's LAN address when one is known.
 */
export function inviteUrl(input: {
  origin: string;
  hostname: string;
  code: string;
  lanAddress?: string | null;
  serverQuery?: string | null;
}): string {
  let origin = input.origin;
  if (isLoopbackHost(input.hostname) && input.lanAddress) {
    const url = new URL(input.origin);
    url.hostname = input.lanAddress;
    origin = url.origin;
  }
  const server = normalizeServerUri(input.serverQuery);
  return `${origin}/play/${input.code}${server ? `?server=${encodeURIComponent(server)}` : ""}`;
}
