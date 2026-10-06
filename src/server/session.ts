import "server-only";
import { loadOrCreateDevKey } from "@/lib/dev-session-key";
import { importSigningKey, type SigningKey } from "@/lib/session-jwt";

/**
 * Session issuer configuration, server-side only.
 *
 * - SINGULARITY_SESSION_PRIVATE_KEY (secret): private EC P-256 JWK as JSON.
 * - SINGULARITY_SESSION_ISSUER: the exact issuer the game database trusts,
 *   normally this app's public origin (https://singularity-coral.vercel.app).
 *
 * Self-hosted/local runs may omit both: a key is generated into
 * `.singularity/` and the issuer defaults to this machine's loopback address,
 * which a local SpacetimeDB can reach. On Vercel both are required, and the
 * session endpoints refuse to work without them rather than guessing.
 */

export interface SessionIssuer {
  issuer: string;
  key: SigningKey;
}

const onVercel = () => process.env.VERCEL === "1";

function configuredIssuer(): string | null {
  const explicit = process.env.SINGULARITY_SESSION_ISSUER?.trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  if (onVercel()) return null;
  return `http://127.0.0.1:${process.env.PORT || 3001}`;
}

async function configuredKey(): Promise<SigningKey | null> {
  const raw = process.env.SINGULARITY_SESSION_PRIVATE_KEY?.trim();
  if (raw) return importSigningKey(JSON.parse(raw) as JsonWebKey);
  if (onVercel()) return null;
  return importSigningKey(await loadOrCreateDevKey());
}

let cached: Promise<SessionIssuer | null> | null = null;

/** The issuer and key, or null when this deployment is not configured to sign sessions. */
export function sessionIssuer(): Promise<SessionIssuer | null> {
  cached ??= (async () => {
    const issuer = configuredIssuer();
    if (!issuer) return null;
    const key = await configuredKey();
    return key ? { issuer, key } : null;
  })().catch((error) => {
    console.error("Session signing is misconfigured:", error instanceof Error ? error.message : error);
    cached = null;
    return null;
  });
  return cached;
}
