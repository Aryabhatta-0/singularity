/*
 * Smoke test for the deployed game: the website, its session issuer, and the
 * production SpacetimeDB database, exercised the way browsers use them.
 *
 *   npm run e2e:online                      (https://singularity-coral.vercel.app)
 *   SMOKE_SITE=https://<preview>.vercel.app npm run e2e:online
 *
 * Safe to run against production: it opens one private room with a random
 * code, never finishes a run (so nothing reaches the leaderboard), and every
 * player leaves at the end. Session tokens come from the site's /api/session.
 */
import { SITE } from "./e2e/online-env";
import {
  check, connect, DB, finish, fire, meOf, mintForeignToken, neutral, playersOf, refused, roomCode, roomOf,
  sleep, snapshotArgs, startIssuer, teamOf, teamsOf, until, URI,
} from "./e2e/harness";

async function get(path: string, init?: RequestInit) {
  return fetch(`${SITE}${path}`, { redirect: "manual", ...init });
}

async function site() {
  const home = await get("/");
  const html = await home.text();
  check("landing page loads", home.ok, `HTTP ${home.status}`);
  check("landing page leaks no local addresses", !/localhost|127\.0\.0\.1|ws:\/\//.test(html));
  for (const path of ["/privacy", "/terms", "/sitemap.xml", "/manifest.webmanifest", "/favicon.ico", "/opengraph-image"]) {
    const response = await get(path);
    check(`${path} loads`, response.ok, `HTTP ${response.status}`);
  }
  const missing = await get("/definitely-not-a-page");
  check("unknown pages answer 404", missing.status === 404, `HTTP ${missing.status}`);

  const robots = await (await get("/robots.txt")).text();
  check("robots.txt keeps rooms and the API out of search", /Disallow: \/play\//.test(robots) && /Disallow: \/api\//.test(robots));
  const room = await get("/play/ABCDEFGH");
  check("room pages are noindex", /noindex/.test(room.headers.get("x-robots-tag") ?? ""));
  check("security headers are set", home.headers.get("x-content-type-options") === "nosniff" && !!home.headers.get("content-security-policy"));

  const discovery = await (await get("/.well-known/openid-configuration")).json() as { issuer?: string; jwks_uri?: string };
  check("session issuer is this site", discovery.issuer === SITE, discovery.issuer);
  const jwks = await (await get("/.well-known/jwks.json")).json() as { keys?: Array<{ d?: string }> };
  check("signing key is published, private part is not", (jwks.keys?.length ?? 0) > 0 && jwks.keys!.every((k) => k.d == null));

  const crossSite = await get("/api/session", { method: "POST", headers: { "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json" }, body: "{}" });
  check("other sites cannot mint sessions", crossSite.status === 403, `HTTP ${crossSite.status}`);
  const hostInfo = await (await get("/api/host-info")).json() as { lanAddresses?: string[] };
  if (SITE.startsWith("https://")) check("hosted site shares no LAN addresses", hostInfo.lanAddresses?.length === 0);
  const board = await get("/api/leaderboard");
  const boardBody = await board.json() as { status?: string };
  check("leaderboard is readable through the site", board.ok && boardBody.status !== "unavailable", `HTTP ${board.status}`);
}

async function multiplayer() {
  check("anonymous database connections are refused", await refused(undefined));
  check("sessions from another issuer are refused", await refused(await mintForeignToken()));

  const CODE = roomCode();
  const ava = await connect("Ava");
  fire(ava.conn.reducers.joinRoom({ code: CODE, name: "Smoke Ava", solo: false }));
  check("creating a room works", await until(() => roomOf(ava) != null, 8_000));
  fire(ava.conn.reducers.setSquad({ size: 3 }));
  await until(() => roomOf(ava)?.squadSize === 3);

  const ben = await connect("Ben");
  fire(ben.conn.reducers.joinRoom({ code: CODE, name: "Smoke Ben", solo: false }));
  check("a friend joins the same room", await until(() => playersOf(ava).length === 2, 8_000));
  check("friends share a team", teamOf(ben)?.id != null && teamOf(ben)?.id === teamOf(ava)?.id);

  const outsider = await connect("Outsider");
  fire(outsider.conn.reducers.joinRoom({ code: roomCode(), name: "Smoke Outsider", solo: false }));
  await until(() => roomOf(outsider) != null, 8_000);
  check("rooms are invisible to other rooms", !playersOf(outsider).some((p) => p.code === CODE) && !teamsOf(outsider).some((t) => t.code === CODE));

  // An incomplete squad (2 of 3) never ranks, and this run is never finished anyway.
  for (const c of [ava, ben]) fire(c.conn.reducers.setReady({ ready: true }));
  await sleep(500);
  fire(ava.conn.reducers.startRound({ force: true }));
  check("the round counts down", await until(() => roomOf(ben)?.phase === "countdown", 8_000), roomOf(ben)?.phase);
  check("the round starts", await until(() => roomOf(ben)?.phase === "playing", 10_000), roomOf(ben)?.phase);
  const round = roomOf(ava)!.round;

  const simulator = teamOf(ava)?.hostId?.toHexString() === ava.hex ? ava : ben;
  const other = simulator === ava ? ben : ava;
  const sent = Date.now();
  const before = other.snapshots;
  fire(simulator.conn.reducers.publishSnapshot(snapshotArgs(round)));
  check("the shared body reaches the teammate", await until(() => other.snapshots > before, 5_000));
  console.log(`      snapshot relay round trip ≈ ${Date.now() - sent} ms`);
  const roles = meOf(other)!.roles;
  fire(other.conn.reducers.sendInput({ roles, inputs: roles.map(() => ({ ...neutral, f: 1 })) }));
  check("teammate input reaches the simulator", await until(
    () => [...simulator.conn.db.visibleInput.iter()].some((row) => row.identity.toHexString() === other.hex), 5_000,
  ));

  for (const c of [ava, ben, outsider]) {
    fire(c.conn.reducers.leaveRoom({}));
  }
  await sleep(800);
  for (const c of [ava, ben, outsider]) c.conn.disconnect();
}

async function main() {
  console.log(`Online smoke against ${SITE} and ${URI} / ${DB}\n`);
  await startIssuer();
  await site();
  await multiplayer();
  finish();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
