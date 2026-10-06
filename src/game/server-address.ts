/**
 * Where the game database lives.
 *
 * - Online (production): the build pins NEXT_PUBLIC_SPACETIMEDB_URI, e.g.
 *   wss://maincloud.spacetimedb.com. Every player, on any network, connects
 *   there; the page's own address does not matter.
 * - Self-hosted (`npm run host`): nothing is pinned, so a browser connects to
 *   SpacetimeDB on the machine that served the page (port 3000). Friends on
 *   the same network open the host's LAN address and land on the same server.
 *
 * There is deliberately no per-link override: a session token must only ever
 * be sent to the database this build was configured for.
 */

export const SPACETIMEDB_PORT = 3000;
export const DEFAULT_DATABASE = "singularity";

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
 * Accept `host`, `host:port`, `ws://…`, `wss://…` or `http(s)://…` and return
 * a WebSocket URI, or null when it is not a usable address.
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
  if (!scheme || !url.hostname || url.username || url.password || url.search || url.hash) return null;
  const port = url.port || (/^[a-z]+:\/\//i.test(value) ? "" : String(SPACETIMEDB_PORT));
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  return `${scheme}://${url.hostname}${port ? `:${port}` : ""}${path}`;
}

export function resolveServerUri(input: { env?: string | null; location: PageLocation }): string {
  return normalizeServerUri(input.env) ?? sameHostServerUri(input.location);
}

/** The HTTP base for a WebSocket URI (SpacetimeDB serves both on one port). */
export function httpBaseOf(serverUri: string): string {
  return serverUri.replace(/^ws(s?):\/\//i, "http$1://");
}

/**
 * The address friends should open. A self-hoster browsing on `localhost`
 * would otherwise copy a link that points at each friend's own machine, so
 * swap in the host machine's LAN address when one is known.
 */
export function inviteUrl(input: {
  origin: string;
  hostname: string;
  code: string;
  lanAddress?: string | null;
}): string {
  let origin = input.origin;
  if (isLoopbackHost(input.hostname) && input.lanAddress) {
    const url = new URL(input.origin);
    url.hostname = input.lanAddress;
    origin = url.origin;
  }
  return `${origin}/play/${input.code}`;
}
