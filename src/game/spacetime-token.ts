/**
 * SpacetimeDB identity tokens, one per database address. Session storage
 * survives reloads and reconnects while giving each tab its own identity, so
 * two tabs on one machine are two players.
 */
const PREFIX = "singularity:spacetimedb-token:";

export function loadSpacetimeToken(key: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.sessionStorage.getItem(PREFIX + key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveSpacetimeToken(key: string, token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PREFIX + key, token);
  } catch {
    // Storage can be unavailable in hardened/private browser contexts. The
    // current connection still works; only identity continuity is lost.
  }
}
