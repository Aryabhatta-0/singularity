import assert from "node:assert/strict";
import test from "node:test";

import {
  httpBaseOf,
  inviteUrl,
  isLoopbackHost,
  normalizeServerUri,
  resolveServerUri,
  sameHostServerUri,
} from "../src/game/server-address.ts";

const lan = { protocol: "http:", hostname: "192.168.1.20" };
const online = { protocol: "https:", hostname: "singularity-coral.vercel.app" };

test("self-hosted: friends reach SpacetimeDB on the machine that served the page", () => {
  assert.equal(sameHostServerUri(lan), "ws://192.168.1.20:3000");
  assert.equal(sameHostServerUri({ protocol: "https:", hostname: "game.example" }), "wss://game.example:3000");
  assert.equal(sameHostServerUri({ protocol: "http:", hostname: "::1" }), "ws://[::1]:3000");
});

test("online: the pinned production database wins over the page's own address", () => {
  assert.equal(resolveServerUri({ env: "wss://maincloud.spacetimedb.com", location: online }), "wss://maincloud.spacetimedb.com");
  assert.equal(resolveServerUri({ env: "wss://maincloud.spacetimedb.com", location: lan }), "wss://maincloud.spacetimedb.com");
  assert.equal(resolveServerUri({ env: "", location: lan }), "ws://192.168.1.20:3000");
  assert.equal(resolveServerUri({ env: "nonsense://", location: lan }), "ws://192.168.1.20:3000");
});

test("typed host addresses become WebSocket URIs", () => {
  assert.equal(normalizeServerUri("192.168.1.5"), "ws://192.168.1.5:3000");
  assert.equal(normalizeServerUri(" 192.168.1.5:4000 "), "ws://192.168.1.5:4000");
  assert.equal(normalizeServerUri("http://10.0.0.2:3000/"), "ws://10.0.0.2:3000");
  assert.equal(normalizeServerUri("wss://maincloud.spacetimedb.com"), "wss://maincloud.spacetimedb.com");
  assert.equal(normalizeServerUri("https://host.example"), "wss://host.example");
});

test("unusable or smuggling addresses are ignored", () => {
  assert.equal(normalizeServerUri(""), null);
  assert.equal(normalizeServerUri(null), null);
  assert.equal(normalizeServerUri("ftp://host"), null);
  assert.equal(normalizeServerUri("http://"), null);
  assert.equal(normalizeServerUri("wss://user:pw@evil.example"), null);
  assert.equal(normalizeServerUri("wss://host.example/?token=x"), null);
});

test("the database's HTTP base sits on the same origin as its socket", () => {
  assert.equal(httpBaseOf("wss://maincloud.spacetimedb.com"), "https://maincloud.spacetimedb.com");
  assert.equal(httpBaseOf("ws://127.0.0.1:3000"), "http://127.0.0.1:3000");
});

test("invites are plain room links; a self-hoster on localhost shares their LAN address", () => {
  assert.ok(isLoopbackHost("localhost") && isLoopbackHost("127.0.0.1") && !isLoopbackHost("192.168.1.20"));
  assert.equal(
    inviteUrl({ origin: "https://singularity-coral.vercel.app", hostname: "singularity-coral.vercel.app", code: "ABCD2345" }),
    "https://singularity-coral.vercel.app/play/ABCD2345",
  );
  assert.equal(
    inviteUrl({ origin: "http://localhost:3001", hostname: "localhost", code: "ABCD2345", lanAddress: "192.168.1.20" }),
    "http://192.168.1.20:3001/play/ABCD2345",
  );
  assert.equal(
    inviteUrl({ origin: "http://192.168.1.20:3001", hostname: "192.168.1.20", code: "ABCD2345", lanAddress: "10.0.0.1" }),
    "http://192.168.1.20:3001/play/ABCD2345",
  );
});
