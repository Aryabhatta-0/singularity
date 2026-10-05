import assert from "node:assert/strict";
import test from "node:test";

import {
  inviteUrl,
  isLoopbackHost,
  normalizeServerUri,
  resolveLeaderboardUri,
  resolveRoomServerUri,
  sameHostServerUri,
} from "../src/game/server-address.ts";

const lan = { protocol: "http:", hostname: "192.168.1.20" };

test("friends reach the room server on the machine that served the page", () => {
  assert.equal(sameHostServerUri(lan), "ws://192.168.1.20:3000");
  assert.equal(sameHostServerUri({ protocol: "https:", hostname: "game.example" }), "wss://game.example:3000");
  assert.equal(sameHostServerUri({ protocol: "http:", hostname: "::1" }), "ws://[::1]:3000");
});

test("typed host addresses become WebSocket URIs", () => {
  assert.equal(normalizeServerUri("192.168.1.5"), "ws://192.168.1.5:3000");
  assert.equal(normalizeServerUri(" 192.168.1.5:4000 "), "ws://192.168.1.5:4000");
  assert.equal(normalizeServerUri("http://10.0.0.2:3000/"), "ws://10.0.0.2:3000");
  assert.equal(normalizeServerUri("wss://maincloud.spacetimedb.com"), "wss://maincloud.spacetimedb.com");
  assert.equal(normalizeServerUri("https://host.example"), "wss://host.example");
});

test("unusable addresses are ignored", () => {
  assert.equal(normalizeServerUri(""), null);
  assert.equal(normalizeServerUri(null), null);
  assert.equal(normalizeServerUri("ftp://host"), null);
  assert.equal(normalizeServerUri("http://"), null);
});

test("room server: invite override, then build config, then same host", () => {
  assert.equal(resolveRoomServerUri({ query: "10.0.0.9", env: "ws://cfg:3000", location: lan }), "ws://10.0.0.9:3000");
  assert.equal(resolveRoomServerUri({ query: null, env: "ws://cfg:3000", location: lan }), "ws://cfg:3000");
  assert.equal(resolveRoomServerUri({ query: "nonsense://", env: undefined, location: lan }), "ws://192.168.1.20:3000");
});

test("leaderboard uses the hosted address when configured, else sits beside the room server", () => {
  assert.equal(resolveLeaderboardUri({ env: "wss://maincloud.spacetimedb.com", location: lan }), "wss://maincloud.spacetimedb.com");
  assert.equal(resolveLeaderboardUri({ env: "", location: lan }), "ws://192.168.1.20:3000");
});

test("a host on localhost copies an invite friends can open", () => {
  assert.ok(isLoopbackHost("localhost") && isLoopbackHost("127.0.0.1") && !isLoopbackHost("192.168.1.20"));
  assert.equal(
    inviteUrl({ origin: "http://localhost:3001", hostname: "localhost", code: "ABCD2345", lanAddress: "192.168.1.20" }),
    "http://192.168.1.20:3001/play/ABCD2345"
  );
  assert.equal(
    inviteUrl({ origin: "http://192.168.1.20:3001", hostname: "192.168.1.20", code: "ABCD2345", lanAddress: "10.0.0.1" }),
    "http://192.168.1.20:3001/play/ABCD2345"
  );
  assert.equal(
    inviteUrl({ origin: "http://localhost:3001", hostname: "localhost", code: "ABCD2345", serverQuery: "10.0.0.9" }),
    "http://localhost:3001/play/ABCD2345?server=ws%3A%2F%2F10.0.0.9%3A3000"
  );
});
