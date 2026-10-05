#!/usr/bin/env node
/*
 * `npm run host` — turn this machine into the match host.
 *
 *  1. Starts SpacetimeDB (if it is not already running) on all interfaces, :3000.
 *  2. Publishes the room server as a fresh `singularity-room` database
 *     (live match state only, so every host session starts clean).
 *  3. Publishes the leaderboard locally, keeping its data — skipped when
 *     NEXT_PUBLIC_LEADERBOARD_URI points at a hosted leaderboard.
 *  4. Serves the game on all interfaces, :3001, and prints the addresses
 *     friends on the same network should open.
 *
 * Flags: --dev runs `next dev` instead of a production build;
 *        --port=NNNN serves the game on another port (default 3001).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";

const SPACETIME_URL = "http://127.0.0.1:3000";
const ROOM_DATABASE = "singularity-room";
const LEADERBOARD_DATABASE = "singularity";
const dev = process.argv.includes("--dev");
const portFlag = process.argv.find((arg) => arg.startsWith("--port="));
const APP_PORT = portFlag ? Number(portFlag.slice("--port=".length)) : 3001;
const children = [];
const WINDOWS = process.platform === "win32";

// On Windows `spacetime`/`npx` are shims that need a shell; hand it one
// pre-joined command line (every argument here is a fixed, space-free token).
function launch(fn, command, args, options) {
  return WINDOWS ? fn([command, ...args].join(" "), { ...options, shell: true }) : fn(command, args, options);
}

function loadEnvFile() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

function run(command, args) {
  const result = launch(spawnSync, command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\n✗ ${command} ${args.join(" ")} failed.`);
    shutdown(1);
  }
}

async function spacetimeUp() {
  try {
    const res = await fetch(`${SPACETIME_URL}/v1/ping`, { signal: AbortSignal.timeout(1_000) });
    return res.ok;
  } catch {
    return false;
  }
}

function lanAddresses() {
  const all = Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
  const isPrivate = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  return [...all.filter(isPrivate), ...all.filter((ip) => !isPrivate(ip))];
}

function shutdown(code = 0) {
  for (const child of children) {
    try {
      // Children run through a shell on Windows; kill the whole tree, not just cmd.exe.
      if (WINDOWS) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else child.kill();
    } catch {}
  }
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function main() {
  loadEnvFile();
  if (launch(spawnSync, "spacetime", ["--version"], { stdio: "ignore" }).status !== 0) {
    console.error("✗ The SpacetimeDB CLI is not installed. Get it from https://spacetimedb.com/install");
    process.exit(1);
  }

  if (await spacetimeUp()) {
    console.log("• SpacetimeDB already running on :3000");
  } else {
    console.log("• Starting SpacetimeDB on :3000 …");
    const server = launch(spawn, "spacetime", ["start", "--listen-addr", "0.0.0.0:3000", "--non-interactive"], {
      stdio: "ignore",
    });
    children.push(server);
    server.on("exit", (code) => {
      console.error(`\n✗ SpacetimeDB exited (code ${code}).`);
      shutdown(1);
    });
    const deadline = Date.now() + 30_000;
    while (!(await spacetimeUp())) {
      if (Date.now() > deadline) {
        console.error("✗ SpacetimeDB did not come up within 30s.");
        shutdown(1);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`• Publishing the room server (${ROOM_DATABASE}, fresh) …`);
  run("spacetime", ["publish", ROOM_DATABASE, "--module-path", "room-server", "--server", "local", "--delete-data=always", "--yes"]);

  if (process.env.NEXT_PUBLIC_LEADERBOARD_URI) {
    console.log(`• Leaderboard is hosted at ${process.env.NEXT_PUBLIC_LEADERBOARD_URI} — not publishing locally`);
  } else {
    console.log(`• Publishing the leaderboard (${LEADERBOARD_DATABASE}, data kept) …`);
    run("spacetime", ["publish", LEADERBOARD_DATABASE, "--module-path", "leaderboard-server", "--server", "local", "--delete-data=never", "--yes"]);
  }

  if (!dev) {
    console.log("• Building the game …");
    run("npx", ["next", "build"]);
  }
  const app = launch(spawn, "npx", ["next", dev ? "dev" : "start", "-H", "0.0.0.0", "-p", String(APP_PORT)], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  children.push(app);
  app.on("exit", (code) => shutdown(code ?? 0));

  const addresses = lanAddresses();
  const line = "─".repeat(58);
  console.log(`\n${line}`);
  console.log(" SINGULARITY is hosted on this machine");
  console.log(line);
  console.log(` You:      http://localhost:${APP_PORT}`);
  if (addresses.length === 0) {
    console.log(" Friends:  no network connection found");
  } else {
    for (const [i, ip] of addresses.entries()) {
      console.log(` ${i === 0 ? "Friends: " : "          "} http://${ip}:${APP_PORT}`);
    }
  }
  console.log(`\n Friends must be on the same network. If they cannot connect,`);
  console.log(` allow ports ${APP_PORT} (game) and 3000 (room server) through`);
  console.log(` your firewall. Ctrl+C stops hosting.`);
  console.log(`${line}\n`);
}

main().catch((error) => {
  console.error(error);
  shutdown(1);
});
