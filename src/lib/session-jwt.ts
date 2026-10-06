/**
 * ES256 session tokens for the game database, built on WebCrypto only.
 *
 * The web app signs a token per browser tab; SpacetimeDB verifies it against
 * the public keys the app publishes at `/.well-known/jwks.json` (it discovers
 * them through `/.well-known/openid-configuration`). The token carries no
 * personal data: a random subject, the issuer, the audience and an expiry.
 *
 * Pure (no Next.js or `server-only` imports) so Node scripts can mint tokens
 * for end-to-end tests with the same code the app uses.
 */

export const SESSION_AUDIENCE = "singularity";
export const SESSION_TTL_SECONDS = 6 * 60 * 60;
/** A token this old may still be exchanged for a fresh one with the same subject. */
export const SESSION_REFRESH_WINDOW_SECONDS = 7 * 24 * 60 * 60;

export interface SigningKey {
  kid: string;
  privateKey: CryptoKey;
  publicJwk: JsonWebKey & { kid: string; alg: "ES256"; use: "sig" };
}

export interface SessionClaims {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
}

const ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGNATURE = { name: "ECDSA", hash: "SHA-256" } as const;
const SUBJECT = /^[A-Za-z0-9_-]{16,64}$/;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const encodeJson = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));

/** Thumbprint-style key id (RFC 7638 member order), so rotating keys changes the kid. */
async function keyId(jwk: JsonWebKey): Promise<string> {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return base64url(new Uint8Array(digest)).slice(0, 16);
}

/** Import a private P-256 JWK (the `d` member must be present). */
export async function importSigningKey(privateJwk: JsonWebKey): Promise<SigningKey> {
  if (privateJwk.kty !== "EC" || privateJwk.crv !== "P-256" || !privateJwk.d || !privateJwk.x || !privateJwk.y) {
    throw new Error("Session signing key must be a private EC P-256 JWK.");
  }
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", d: privateJwk.d, x: privateJwk.x, y: privateJwk.y },
    ALGORITHM,
    false,
    ["sign"],
  );
  const kid = await keyId(privateJwk);
  return {
    kid,
    privateKey,
    publicJwk: { kty: "EC", crv: "P-256", x: privateJwk.x, y: privateJwk.y, kid, alg: "ES256", use: "sig" },
  };
}

export async function generatePrivateJwk(): Promise<JsonWebKey> {
  const pair = (await crypto.subtle.generateKey(ALGORITHM, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { kty: jwk.kty, crv: jwk.crv, d: jwk.d, x: jwk.x, y: jwk.y };
}

export function newSubject(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(18)));
}

export async function signSession(
  key: SigningKey,
  input: { issuer: string; subject?: string; nowSeconds?: number; ttlSeconds?: number },
): Promise<{ token: string; claims: SessionClaims }> {
  const iat = Math.floor(input.nowSeconds ?? Date.now() / 1000);
  const claims: SessionClaims = {
    iss: input.issuer,
    sub: input.subject ?? newSubject(),
    aud: SESSION_AUDIENCE,
    iat,
    exp: iat + (input.ttlSeconds ?? SESSION_TTL_SECONDS),
  };
  const signingInput = `${encodeJson({ alg: "ES256", typ: "JWT", kid: key.kid })}.${encodeJson(claims)}`;
  const signature = await crypto.subtle.sign(SIGNATURE, key.privateKey, new TextEncoder().encode(signingInput));
  return { token: `${signingInput}.${base64url(new Uint8Array(signature))}`, claims };
}

/**
 * Check a token this app signed earlier. Returns its claims when the
 * signature, issuer and audience match and it is not older than the refresh
 * window; expiry itself is not enforced here (refresh is the point).
 */
export async function verifyOwnSession(
  key: SigningKey,
  token: string,
  input: { issuer: string; nowSeconds?: number },
): Promise<SessionClaims | null> {
  if (typeof token !== "string" || token.length > 2_048) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(fromBase64url(parts[0])));
    if (header?.alg !== "ES256" || header?.kid !== key.kid) return null;
    const verifier = await crypto.subtle.importKey("jwk", key.publicJwk, ALGORITHM, false, ["verify"]);
    const valid = await crypto.subtle.verify(
      SIGNATURE,
      verifier,
      fromBase64url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) return null;
    const claims = JSON.parse(new TextDecoder().decode(fromBase64url(parts[1]))) as SessionClaims;
    const now = Math.floor(input.nowSeconds ?? Date.now() / 1000);
    if (claims.iss !== input.issuer || claims.aud !== SESSION_AUDIENCE) return null;
    if (typeof claims.sub !== "string" || !SUBJECT.test(claims.sub)) return null;
    if (!Number.isFinite(claims.exp) || now - claims.exp > SESSION_REFRESH_WINDOW_SECONDS) return null;
    return claims;
  } catch {
    return null;
  }
}

/** Expiry (seconds) of a token without verifying it — for client-side refresh timing only. */
export function peekExpiry(token: string): number | null {
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromBase64url(token.split(".")[1] ?? "")));
    return Number.isFinite(claims?.exp) ? claims.exp : null;
  } catch {
    return null;
  }
}
