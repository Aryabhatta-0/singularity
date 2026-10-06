import assert from "node:assert/strict";
import test from "node:test";

import { isValidIssuer, sessionAllowed, SESSION_AUDIENCE } from "../server/src/access.ts";
import { cleanDisplayText, cleanPlayerName } from "../server/src/names.ts";

const policy = { issuer: "https://singularity-coral.vercel.app", audience: SESSION_AUDIENCE };
const claims = (overrides = {}) => ({ issuer: policy.issuer, audience: [SESSION_AUDIENCE], subject: "abc123", ...overrides });

test("only sessions from the configured issuer and audience may connect", () => {
  assert.equal(sessionAllowed(policy, claims()), true);
  assert.equal(sessionAllowed(policy, claims({ issuer: "localhost" })), false, "anonymous SpacetimeDB identity");
  assert.equal(sessionAllowed(policy, claims({ issuer: "https://singularity-coral.vercel.app/" })), false, "exact match only");
  assert.equal(sessionAllowed(policy, claims({ audience: ["spacetimedb"] })), false);
  assert.equal(sessionAllowed(policy, claims({ subject: "" })), false);
  assert.equal(sessionAllowed(policy, null), false);
});

test("an unconfigured database admits nobody but its owner", () => {
  assert.equal(sessionAllowed({ issuer: "", audience: SESSION_AUDIENCE }, claims()), false);
  assert.equal(sessionAllowed(null, claims()), false);
});

test("issuers are absolute http(s) URLs without trailing slashes or extras", () => {
  assert.equal(isValidIssuer("https://singularity-coral.vercel.app"), true);
  assert.equal(isValidIssuer("http://127.0.0.1:3001"), true);
  assert.equal(isValidIssuer("https://example.com/"), false);
  assert.equal(isValidIssuer("https://example.com?x=1"), false);
  assert.equal(isValidIssuer("javascript:alert(1)"), false);
  assert.equal(isValidIssuer(""), false);
});

test("display text loses control and bidi characters", () => {
  assert.equal(cleanDisplayText("  Bob‮  live\u0000 "), "Bob live");
  assert.equal(cleanDisplayText("a​b"), "ab");
  assert.equal(cleanPlayerName("   "), "Player");
  assert.equal(cleanPlayerName("Absolutely Enormous Player Name"), "Absolutely Enorm");
});
