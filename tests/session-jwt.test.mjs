import assert from "node:assert/strict";
import test from "node:test";

import {
  generatePrivateJwk,
  importSigningKey,
  peekExpiry,
  SESSION_AUDIENCE,
  SESSION_REFRESH_WINDOW_SECONDS,
  SESSION_TTL_SECONDS,
  signSession,
  verifyOwnSession,
} from "../src/lib/session-jwt.ts";

const ISSUER = "https://singularity.example";

test("session tokens carry only issuer, random subject, audience and expiry", async () => {
  const key = await importSigningKey(await generatePrivateJwk());
  const { token, claims } = await signSession(key, { issuer: ISSUER, nowSeconds: 1_000 });
  assert.deepEqual(Object.keys(claims).sort(), ["aud", "exp", "iat", "iss", "sub"]);
  assert.equal(claims.aud, SESSION_AUDIENCE);
  assert.equal(claims.exp - claims.iat, SESSION_TTL_SECONDS);
  assert.match(claims.sub, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(peekExpiry(token), claims.exp);
  const [header] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "ES256", typ: "JWT", kid: key.kid });
  assert.equal(key.publicJwk.d, undefined, "the published key never includes the private part");
});

test("a refresh keeps the identity of a genuine token, even shortly after expiry", async () => {
  const key = await importSigningKey(await generatePrivateJwk());
  const { token, claims } = await signSession(key, { issuer: ISSUER, nowSeconds: 1_000 });
  const later = claims.exp + 3_600;
  assert.equal((await verifyOwnSession(key, token, { issuer: ISSUER, nowSeconds: later }))?.sub, claims.sub);
  const stale = claims.exp + SESSION_REFRESH_WINDOW_SECONDS + 1;
  assert.equal(await verifyOwnSession(key, token, { issuer: ISSUER, nowSeconds: stale }), null, "too old to refresh");
});

test("forged, foreign or tampered tokens never keep an identity", async () => {
  const key = await importSigningKey(await generatePrivateJwk());
  const other = await importSigningKey(await generatePrivateJwk());
  const { token } = await signSession(key, { issuer: ISSUER, nowSeconds: 1_000 });
  const now = { issuer: ISSUER, nowSeconds: 1_001 };
  assert.equal(await verifyOwnSession(other, token, now), null, "another key");
  assert.equal(await verifyOwnSession(key, token, { ...now, issuer: "https://evil.example" }), null, "another issuer");
  const [h, p, s] = token.split(".");
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  const swapped = Buffer.from(JSON.stringify({ ...claims, sub: "victim-subject-0000000" })).toString("base64url");
  assert.equal(await verifyOwnSession(key, `${h}.${swapped}.${s}`, now), null, "edited payload");
  assert.equal(await verifyOwnSession(key, "not.a.token", now), null);
  assert.equal(await verifyOwnSession(key, "x".repeat(5_000), now), null, "oversized");
});

test("only private P-256 keys can sign", async () => {
  const jwk = await generatePrivateJwk();
  await assert.rejects(importSigningKey({ ...jwk, d: undefined }));
  await assert.rejects(importSigningKey({ ...jwk, crv: "P-384" }));
});
