/**
 * Game session tokens, one per browser tab.
 *
 * The web app signs them (`/api/session`); the game database only accepts
 * connections that present one. Session storage survives reloads and
 * reconnects while giving each tab its own identity, so two tabs on one
 * machine are two players. A token near expiry is exchanged for a fresh one
 * with the same identity, so a long session keeps its seat.
 */
import { peekExpiry } from "@/lib/session-jwt";

const STORAGE_KEY = "singularity:session-token";
/** Refresh a little early so a token never expires mid-handshake. */
const REFRESH_MARGIN_SECONDS = 10 * 60;

export class SessionUnavailableError extends Error {
  constructor(readonly status: number) {
    super(`Game sessions are unavailable (HTTP ${status}).`);
  }
}

function load(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function save(token: string) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Storage can be unavailable in hardened/private browser contexts. The
    // current connection still works; only identity continuity is lost.
  }
}

let inFlight: Promise<string> | null = null;

/** A valid session token for this tab, fetching or refreshing one when needed. */
export function sessionToken(nowSeconds = Date.now() / 1000): Promise<string> {
  const stored = load();
  const expiry = stored ? peekExpiry(stored) : null;
  if (stored && expiry != null && expiry - nowSeconds > REFRESH_MARGIN_SECONDS) return Promise.resolve(stored);
  inFlight ??= (async () => {
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stored ? { previous: stored } : {}),
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new SessionUnavailableError(response.status);
      const body = (await response.json()) as { token?: unknown };
      if (typeof body.token !== "string") throw new SessionUnavailableError(response.status);
      save(body.token);
      return body.token;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Forget this tab's session, e.g. after the server refused it. */
export function dropSessionToken() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
}
