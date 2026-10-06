#!/usr/bin/env node
/*
 * Network impairment proxy for multiplayer testing: put it between a browser
 * and SpacetimeDB to give that player a realistic bad connection.
 *
 *   node scripts/net-sim-proxy.mjs --listen=3300 --target=127.0.0.1:3000 --control=3301
 *
 * Every chunk, in both directions, is held for `delay ± jitter` ms (order is
 * preserved, like TCP), and `stallEvery`/`stallMs` add periodic freezes like a
 * cellular handoff or packet-loss retransmit. Profiles switch at runtime:
 *
 *   curl -X POST localhost:3301/profile -d '{"delay":120,"jitter":60}'
 *   curl -X POST localhost:3301/cut      (drop every connection, refuse new ones)
 *   curl -X POST localhost:3301/restore
 *   curl localhost:3301/stats
 */
import { createServer as createHttpServer } from "node:http";
import { connect, createServer } from "node:net";

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const LISTEN = Number(arg("listen", 3300));
const CONTROL = Number(arg("control", 3301));
const [TARGET_HOST, TARGET_PORT] = arg("target", "127.0.0.1:3000").split(":");

let profile = { delay: 0, jitter: 0, stallEvery: 0, stallMs: 0 };
let cut = false;
const sockets = new Set();
const stats = { connections: 0, chunks: 0, bytes: 0, stalls: 0, cuts: 0 };

/** Forward `from` -> `to` with per-chunk delay, never reordering. */
function pipeWithDelay(from, to) {
  let releaseAt = 0;
  let count = 0;
  from.on("data", (chunk) => {
    stats.chunks += 1;
    stats.bytes += chunk.length;
    count += 1;
    const now = Date.now();
    let hold = profile.delay + (Math.random() * 2 - 1) * profile.jitter;
    if (profile.stallEvery > 0 && count % profile.stallEvery === 0) {
      hold += profile.stallMs;
      stats.stalls += 1;
    }
    releaseAt = Math.max(releaseAt, now + Math.max(0, hold));
    setTimeout(() => {
      if (!to.destroyed) to.write(chunk);
    }, releaseAt - now);
  });
  from.on("end", () => setTimeout(() => to.end(), Math.max(0, releaseAt - Date.now())));
}

createServer((client) => {
  if (cut) {
    client.destroy();
    return;
  }
  stats.connections += 1;
  const upstream = connect(Number(TARGET_PORT), TARGET_HOST);
  for (const socket of [client, upstream]) {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => {
      sockets.delete(socket);
      client.destroy();
      upstream.destroy();
    });
  }
  pipeWithDelay(client, upstream);
  pipeWithDelay(upstream, client);
}).listen(LISTEN, "127.0.0.1");

createHttpServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    if (req.url === "/profile" && req.method === "POST") profile = { ...profile, ...JSON.parse(body || "{}") };
    else if (req.url === "/cut") {
      cut = true;
      stats.cuts += 1;
      for (const socket of sockets) socket.destroy();
    } else if (req.url === "/restore") cut = false;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ profile, cut, ...stats, open: sockets.size / 2 }));
  });
}).listen(CONTROL, "127.0.0.1");

console.log(`net-sim proxy :${LISTEN} -> ${TARGET_HOST}:${TARGET_PORT} (control :${CONTROL})`);
