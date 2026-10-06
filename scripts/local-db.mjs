#!/usr/bin/env node
/*
 * `npm run db:local` — publish the game server module to the SpacetimeDB
 * running on this machine, as the database `singularity`, and point it at
 * this machine's web app for session tokens. `npm run host` runs the same
 * steps; use this one when you prefer `spacetime start` + `npm run dev`.
 *
 * Keeps the local leaderboard (only a breaking schema change wipes data),
 * and clears live rooms so every session starts clean.
 *
 * Flags: --port=NNNN  the web app's port (default 3001), which is part of the issuer.
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const LOCAL_DATABASE = "singularity";
const WINDOWS = process.platform === "win32";

function spacetime(args) {
  const quoted = args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a));
  return WINDOWS
    ? spawnSync(["spacetime", ...quoted].join(" "), { shell: true, encoding: "utf8" })
    : spawnSync("spacetime", args, { encoding: "utf8" });
}

function fail(step, result) {
  const detail = (result.stderr || result.stdout || "").trim().split(/\r?\n/).slice(-8).join("\n");
  const error = new Error(`${step} failed${detail ? `:\n${detail}` : "."}`);
  error.step = step;
  throw error;
}

/** Publish, trust the local issuer, reset rooms. Throws with a readable message on failure. */
export function prepareLocalDatabase({ port = 3001, log = console.log } = {}) {
  const issuer = `http://127.0.0.1:${port}`;
  log(`• Publishing the game server (${LOCAL_DATABASE}, local leaderboard kept) …`);
  const publish = spacetime(["publish", LOCAL_DATABASE, "--module-path", "server", "--server", "local", "--delete-data=on-conflict", "--yes"]);
  if (publish.status !== 0) fail("Publishing the local database", publish);
  let access = spacetime(["call", LOCAL_DATABASE, "configure_access", JSON.stringify(issuer), "--server", "local"]);
  if (access.status !== 0 && /403|only accepts Singularity/.test(`${access.stderr}${access.stdout}`)) {
    // A database created by an older module never recorded its owner (its `init`
    // predates access control), so nobody may configure it. Locally, rebuild it once.
    log("• This local database predates access control; recreating it (local rooms and scores reset) …");
    const fresh = spacetime(["publish", LOCAL_DATABASE, "--module-path", "server", "--server", "local", "--delete-data=always", "--yes"]);
    if (fresh.status !== 0) fail("Recreating the local database", fresh);
    access = spacetime(["call", LOCAL_DATABASE, "configure_access", JSON.stringify(issuer), "--server", "local"]);
  }
  if (access.status !== 0) fail("Configuring local access", access);
  const reset = spacetime(["call", LOCAL_DATABASE, "reset_rooms", "--server", "local"]);
  if (reset.status !== 0) fail("Clearing old rooms", reset);
  log(`• Database trusts game sessions from ${issuer}`);
  return { database: LOCAL_DATABASE, issuer };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const portFlag = process.argv.find((arg) => arg.startsWith("--port="));
  try {
    prepareLocalDatabase({ port: portFlag ? Number(portFlag.slice(7)) : 3001 });
  } catch (error) {
    console.error(`✗ ${error.message}\n  Is SpacetimeDB running? Start it with: spacetime start`);
    process.exit(1);
  }
}
