import { signSession, verifyOwnSession } from "@/lib/session-jwt";
import { clientAddress, createRateLimiter } from "@/server/rate-limit";
import { sessionIssuer } from "@/server/session";

export const dynamic = "force-dynamic";

const allow = createRateLimiter({ limit: 30, windowMs: 60_000 });
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Issue a game session token for one browser tab. Send `{ previous }` with the
 * tab's last token to keep the same player identity (seat, team) across
 * refreshes; anything else gets a brand-new random identity.
 */
export async function POST(request: Request) {
  // Browsers label cross-site fetches; only this site's pages may mint sessions.
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ error: "cross-site" }, { status: 403, headers: NO_STORE });
  }
  if (!allow(clientAddress(request))) {
    return Response.json({ error: "rate-limited" }, { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } });
  }
  const config = await sessionIssuer();
  if (!config) return Response.json({ error: "sessions-unavailable" }, { status: 503, headers: NO_STORE });

  let previous: unknown;
  try {
    const body = await request.text();
    if (body.length > 4_096) return Response.json({ error: "too-large" }, { status: 413, headers: NO_STORE });
    previous = body ? (JSON.parse(body) as { previous?: unknown }).previous : undefined;
  } catch {
    return Response.json({ error: "bad-request" }, { status: 400, headers: NO_STORE });
  }
  const kept = typeof previous === "string" ? await verifyOwnSession(config.key, previous, { issuer: config.issuer }) : null;
  const { token, claims } = await signSession(config.key, { issuer: config.issuer, subject: kept?.sub });
  return Response.json({ token, expiresAt: claims.exp }, { headers: NO_STORE });
}
