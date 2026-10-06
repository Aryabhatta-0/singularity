/**
 * Who may open a connection to the game database.
 *
 * Every player connects with a short-lived session token signed by the web
 * app (`/api/session`, published keys at `/.well-known/jwks.json`).
 * SpacetimeDB verifies the signature and expiry before the module runs; this
 * module then only has to check that the token came from the one issuer the
 * database owner configured, for this game's audience. Anonymous SpacetimeDB
 * identities and tokens from any other issuer are refused at connect time.
 *
 * Pure so the unit-test bundle can cover it directly.
 */

export const SESSION_AUDIENCE = "singularity";
export const MAX_ISSUER_LENGTH = 200;

export interface AccessPolicy {
  /** Exact `iss` claim accepted from players. Empty means nobody but the owner. */
  issuer: string;
  audience: string;
}

export interface SessionClaims {
  issuer: string;
  audience: readonly string[];
  subject: string;
}

/** An issuer is an absolute http(s) origin-ish URL with no trailing slash, query or fragment. */
export function isValidIssuer(issuer: string): boolean {
  if (issuer.length === 0 || issuer.length > MAX_ISSUER_LENGTH) return false;
  return /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?(?:\/[A-Za-z0-9._~-]+)*$/i.test(issuer);
}

export function sessionAllowed(policy: AccessPolicy | null | undefined, claims: SessionClaims | null | undefined): boolean {
  if (!policy || !policy.issuer || !claims) return false;
  if (claims.issuer !== policy.issuer) return false;
  if (!claims.audience.includes(policy.audience)) return false;
  return typeof claims.subject === "string" && claims.subject.length > 0 && claims.subject.length <= 128;
}
