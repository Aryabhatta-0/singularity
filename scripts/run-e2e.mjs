#!/usr/bin/env node
/*
 * Run a SpacetimeDB end-to-end suite against a throwaway database.
 *
 *   npm run e2e:room
 *   npm run e2e:leaderboard
 *
 * 1. Bundles scripts/<suite>-e2e.ts with esbuild.
 * 2. Publishes server/ as a fresh scratch database (never `singularity`).
 * 3. Tells it to trust the suite's own session issuer (owner-only reducer).
 * 4. Runs the suite, then deletes the scratch database, pass or fail.
 *
 * Env: E2E_SERVER   SpacetimeDB server nickname or URL (default: local)
 *      E2E_SESSION_URL  mint tokens from a deployed /api/session instead of locally;
 *                       the scratch database then trusts that site's origin
 *      E2E_KEEP=1   keep the scratch database for inspection
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const suite = process.argv[2];
if (!["room", "leaderboard"].includes(suite ?? "")) {
  console.error("usage: node scripts/run-e2e.mjs <room|leaderboard>");
  process.exit(2);
}

const WINDOWS = process.platform === "win32";
const server = process.env.E2E_SERVER || "local";
const issuerPort = 3990;
const sessionUrl = process.env.E2E_SESSION_URL || "";
const issuer = sessionUrl ? new URL(sessionUrl).origin : `http://127.0.0.1:${issuerPort}`;
const database = `singularity-e2e-${suite}-${randomBytes(3).toString("hex")}`;
const wsUri = server === "local" ? "ws://127.0.0.1:3000"
  : server === "maincloud" ? "wss://maincloud.spacetimedb.com"
  : server.replace(/^http/, "ws");

function sh(command, args, { quiet = false } = {}) {
  const result = WINDOWS
    ? spawnSync([command, ...args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))].join(" "), { shell: true, stdio: quiet ? "pipe" : "inherit", encoding: "utf8" })
    : spawnSync(command, args, { stdio: quiet ? "pipe" : "inherit", encoding: "utf8" });
  return result;
}

function must(command, args, what) {
  const result = sh(command, args, { quiet: true });
  if (result.status !== 0) {
    console.error(`✗ ${what} failed:\n${(result.stderr || result.stdout || "").trim()}`);
    return false;
  }
  return true;
}

const bundle = `.test-dist/${suite}-e2e.mjs`;
if (!must("npx", ["esbuild", `scripts/${suite}-e2e.ts`, "--bundle", "--platform=node", "--format=esm", `--outfile=${bundle}`, "--log-level=warning"], "Bundling the suite")) {
  process.exit(1);
}

console.log(`• Publishing scratch database ${database} on ${server} …`);
if (!must("spacetime", ["publish", database, "--module-path", "server", "--server", server, "--delete-data=always", "--yes"], "Publishing the scratch database")) {
  process.exit(1);
}

let status = 1;
try {
  if (must("spacetime", ["call", database, "configure_access", JSON.stringify(issuer), "--server", server], "Configuring access")) {
    console.log(`• Trusting sessions from ${issuer}\n`);
    const run = spawnSync(process.execPath, [bundle], {
      stdio: "inherit",
      env: { ...process.env, E2E_URI: wsUri, E2E_DB: database, E2E_ISSUER_PORT: String(issuerPort) },
    });
    status = run.status ?? 1;
  }
} finally {
  if (process.env.E2E_KEEP === "1") {
    console.log(`\n• Kept ${database} on ${server}`);
  } else {
    must("spacetime", ["delete", database, "--server", server, "--yes"], `Deleting ${database}`);
    console.log(`\n• Deleted scratch database ${database}`);
  }
}
process.exit(status);
