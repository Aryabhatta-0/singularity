/*
 * Shared plumbing for the SpacetimeDB end-to-end suites (run them through
 * scripts/run-e2e.mjs, which publishes a throwaway database first).
 *
 * Players connect exactly like browsers do: with a signed session token.
 * Against a local server the suite is its own token issuer (an HTTP server on
 * E2E_ISSUER_PORT serving the OIDC discovery document and keys, signing with
 * the same dev key the app uses). Against a hosted server, E2E_SESSION_URL
 * points at a deployed `/api/session` and tokens come from there.
 */
import { createServer, type Server } from "node:http";
import { DbConnection } from "../../src/module_bindings/index.js";
import { loadOrCreateDevKey } from "../../src/lib/dev-session-key";
import { importSigningKey, signSession, type SigningKey } from "../../src/lib/session-jwt";

export const URI = process.env.E2E_URI || "ws://127.0.0.1:3000";
export const DB = process.env.E2E_DB || "singularity-e2e";
const ISSUER_PORT = Number(process.env.E2E_ISSUER_PORT || 3990);
const SESSION_URL = process.env.E2E_SESSION_URL || "";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const roomCode = () => Array.from({ length: 8 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
/** Fixed waits stretch on a hosted server, where a round trip costs ~100ms instead of ~1ms. */
const SLACK = /^wss?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(URI) ? 1 : 3;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms * SLACK));

let failures = 0;
export function check(name: string, cond: boolean, extra: unknown = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra !== "" ? ` — ${String(extra)}` : ""}`);
  if (!cond) failures++;
}

export function finish(): never {
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

/** Reducer calls return promises; validation rejections are expected in these suites. */
export function fire(call: Promise<unknown> | unknown) {
  if (call instanceof Promise) call.catch(() => {});
}

/* ---------------------------------- sessions ---------------------------------- */

let issuer: { server: Server | null; key: SigningKey | null; origin: string } | null = null;

export async function startIssuer(): Promise<string> {
  if (SESSION_URL) return new URL(SESSION_URL).origin;
  const key = await importSigningKey(await loadOrCreateDevKey());
  const origin = `http://127.0.0.1:${ISSUER_PORT}`;
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/.well-known/openid-configuration") {
      res.end(JSON.stringify({ issuer: origin, jwks_uri: `${origin}/.well-known/jwks.json` }));
    } else if (req.url === "/.well-known/jwks.json") {
      res.end(JSON.stringify({ keys: [key.publicJwk] }));
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  await new Promise<void>((resolve) => server.listen(ISSUER_PORT, "127.0.0.1", resolve));
  issuer = { server, key, origin };
  return origin;
}

export function stopIssuer() {
  issuer?.server?.close();
}

/** A fresh player identity (or the same one again when `previous` is passed). */
export async function mintToken(previous?: string): Promise<string> {
  if (SESSION_URL) {
    const response = await fetch(SESSION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(previous ? { previous } : {}),
    });
    if (!response.ok) throw new Error(`session endpoint answered HTTP ${response.status}`);
    return ((await response.json()) as { token: string }).token;
  }
  if (!issuer?.key) throw new Error("startIssuer() first");
  if (previous) return previous;
  return (await signSession(issuer.key, { issuer: issuer.origin })).token;
}

/** Sign with an issuer the database does not trust (same key shape, wrong origin). */
export async function mintForeignToken(): Promise<string> {
  const key = await importSigningKey(await loadOrCreateDevKey());
  return (await signSession(key, { issuer: "https://evil.example" })).token;
}

/* ---------------------------------- clients ---------------------------------- */

export interface Client {
  name: string;
  conn: DbConnection;
  hex: string;
  token: string;
  snapshots: number;
}

const ROOM_QUERIES = [
  "SELECT * FROM visible_room",
  "SELECT * FROM visible_player",
  "SELECT * FROM visible_team",
  "SELECT * FROM visible_snapshot",
  "SELECT * FROM visible_input",
  "SELECT * FROM leaderboard",
];

export function connectWith(name: string, token: string | undefined, options: { lightMode?: boolean } = {}): Promise<Client> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`connect timeout: ${name}`)), 15_000);
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB)
      .withToken(token)
      .withLightMode(options.lightMode ?? true)
      .withConfirmedReads(false)
      .onConnect((conn, identity) => {
        const client: Client = { name, conn, hex: identity.toHexString(), token: token ?? "", snapshots: 0 };
        conn.db.visibleSnapshot.onInsert(() => client.snapshots++);
        conn.db.visibleSnapshot.onUpdate(() => client.snapshots++);
        conn.subscriptionBuilder()
          .onError(() => {
            clearTimeout(timeout);
            reject(new Error(`subscription failed: ${name}`));
          })
          .onApplied(() => {
            clearTimeout(timeout);
            resolve(client);
          })
          .subscribe(ROOM_QUERIES);
      })
      .onConnectError((_ctx: unknown, err: Error) => {
        clearTimeout(timeout);
        reject(err);
      })
      .build();
  });
}

export async function connect(name: string, token?: string): Promise<Client> {
  return connectWith(name, token ?? (await mintToken()));
}

/** Resolves true when the server refuses the handshake. */
export async function refused(token: string | undefined): Promise<boolean> {
  try {
    const client = await connectWith("probe", token);
    client.conn.disconnect();
    return false;
  } catch {
    return true;
  }
}

export const roomOf = (c: Client) => [...c.conn.db.visibleRoom.iter()][0];
export const playersOf = (c: Client) => [...c.conn.db.visiblePlayer.iter()];
export const teamsOf = (c: Client) => [...c.conn.db.visibleTeam.iter()];
export const boardOf = (c: Client) => [...c.conn.db.leaderboard.iter()];
export const meOf = (c: Client) => playersOf(c).find((p) => p.identity.toHexString() === c.hex);
export const teamOf = (c: Client) => teamsOf(c).find((t) => t.id === meOf(c)?.teamId);

// 11 body parts x (pos xyz + quat xyzw). 0.5 everywhere is a unit quaternion.
export const snapshotArgs = (round: number) => ({
  round, p: new Array(77).fill(0.5), props: [] as number[], yaw: 0, pitch: 0, timer: 1,
  fallen: false, score: 0, ev: "[]", msg: undefined,
});
export const neutral = { f: 0, s: 0, a: false, b: false, q: false, e: false, lx: 0, ly: 0 };

/** Wait until `predicate` holds (polling), or give up after `ms`. */
export async function until(predicate: () => boolean, ms = 3_000, step = 50): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(step);
  }
  return predicate();
}
