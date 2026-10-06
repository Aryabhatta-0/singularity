import "server-only";

/**
 * Best-effort fixed-window limiter, per server instance. It blunts scripted
 * floods of the session endpoint; it is not a distributed quota (serverless
 * instances do not share memory), and the game database enforces its own
 * per-identity and global ceilings regardless.
 */
export function createRateLimiter(options: { limit: number; windowMs: number; maxKeys?: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const maxKeys = options.maxKeys ?? 10_000;
  return function allow(key: string, now = Date.now()): boolean {
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      if (hits.size >= maxKeys) {
        for (const [candidate, value] of hits) if (value.resetAt <= now) hits.delete(candidate);
        if (hits.size >= maxKeys) hits.clear();
      }
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= options.limit;
  };
}

/** Client address as reported by the platform proxy (Vercel sets x-forwarded-for). */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}
