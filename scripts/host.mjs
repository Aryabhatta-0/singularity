#!/usr/bin/env node
/*
 * `npm run host` — run the whole Singularity stack on this machine, for
 * development or a self-hosted LAN party. (Normal players don't need this:
 * the online game at https://singularity-coral.vercel.app works from anywhere.)
 *
 *  1. Checks Node, the SpacetimeDB CLI version, dependencies and ports.
 *  2. Starts SpacetimeDB on all interfaces, :3000 (unless it's already running).
 *  3. Publishes the game server as the local `singularity` database, trusting
 *     this machine's web app for session tokens, with rooms reset.
 *  4. Builds and serves the game on all interfaces, :3001, and prints the
 *     addresses to open.
 *
 * Flags: --dev runs `next dev` instead of a production build;
 *        --port=NNNN serves the game on another port (default 3001);
 *        --skip-version-check allows a SpacetimeDB CLI other than 2.10.x.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";
import { LOCAL_DATABASE, prepareLocalDatabase } from "./local-db.mjs";

const ONLINE_GAME = "https://singularity-coral.vercel.app";
const SPACETIME_PORT = 3000;
const SPACETIME_URL = `http://127.0.0.1:${SPACETIME_PORT}`;
const REQUIRED_CLI = "2.10";
const dev = process.argv.includes("--dev");
const skipVersionCheck = process.argv.includes("--skip-version-check");
const portFlag = process.argv.find((arg) => arg.startsWith("--port="));
const APP_PORT = portFlag ? Number(portFlag.slice("--port=".length)) : 3001;
const children = [];
const WINDOWS = process.platform === "win32";

// On Windows `spacetime`/`npx` are shims that need a shell; hand it one
// pre-joined command line (every argument here is a fixed, space-free token).
function launch(fn, command, args, options) {
  return WINDOWS ? fn([command, ...args].join(" "), { ...options, shell: true }) : fn(command, args, options);
}

function die(message, hint) {
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`  ${hint.split("\n").join("\n  ")}`);
  shutdown(1);
}

function envFileValue(name) {
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line);
      if (match && match[1] === name && match[2]) return match[2];
    }
  }
  return process.env[name] || "";
}

async function spacetimeUp() {
  try {
    const res = await fetch(`${SPACETIME_URL}/v1/ping`, { signal: AbortSignal.timeout(1_000) });
    return res.ok;
  } catch {
    return false;
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const probe = createServer()
      .once("error", () => resolve(false))
      .once("listening", () => probe.close(() => resolve(true)))
      .listen(port, "0.0.0.0");
  });
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

async function preflight() {
  const [major] = process.versions.node.split(".").map(Number);
  if (major < 24) die(`Node ${process.versions.node} is too old.`, "Singularity needs Node 24 (see .nvmrc). With nvm: nvm install 24 && nvm use 24");

  const version = launch(spawnSync, "spacetime", ["--version"], { encoding: "utf8" });
  if (version.status !== 0) {
    die("The SpacetimeDB CLI isn't installed (or isn't on PATH).", "Install it from https://spacetimedb.com/install, then open a new terminal.");
  }
  const found = /spacetimedb tool version (\d+\.\d+)\.\d+/.exec(version.stdout ?? "")?.[1];
  if (!skipVersionCheck && found !== REQUIRED_CLI) {
    die(
      `SpacetimeDB CLI ${found ?? "(unknown version)"} found; this project is built against ${REQUIRED_CLI}.x.`,
      `Install the matching version:  spacetime version install ${REQUIRED_CLI}.0 && spacetime version use ${REQUIRED_CLI}.0\nor re-run with --skip-version-check to try anyway.`,
    );
  }

  if (!existsSync("node_modules/next")) die("Dependencies aren't installed.", "Run: npm install");
  if (!existsSync("server/node_modules/spacetimedb")) {
    console.log("• Installing the game server's dependencies (first run) …");
    const install = launch(spawnSync, "npm", ["install", "--prefix", "server", "--no-audit", "--no-fund"], { stdio: "inherit" });
    if (install.status !== 0) die("Installing server dependencies failed.", "Run: npm install --prefix server");
  }

  if (!(await portFree(APP_PORT))) {
    die(`Port ${APP_PORT} is already in use (another dev server?).`, `Stop it, or pick another port: npm run host -- --port=${APP_PORT + 1}`);
  }

  const pinned = envFileValue("NEXT_PUBLIC_SPACETIMEDB_URI");
  if (pinned && !/^(wss?|https?):\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(pinned)) {
    console.log(`• Ignoring NEXT_PUBLIC_SPACETIMEDB_URI=${pinned} from your env files: npm run host is fully local.`);
  }
}

async function startSpacetime() {
  if (await spacetimeUp()) {
    console.log(`• SpacetimeDB already running on :${SPACETIME_PORT}`);
    return;
  }
  if (!(await portFree(SPACETIME_PORT))) {
    die(`Port ${SPACETIME_PORT} is taken by something that isn't SpacetimeDB.`, "Free the port, then run npm run host again.");
  }
  console.log(`• Starting SpacetimeDB on :${SPACETIME_PORT} …`);
  const server = launch(spawn, "spacetime", ["start", "--listen-addr", `0.0.0.0:${SPACETIME_PORT}`, "--non-interactive"], { stdio: "ignore" });
  children.push(server);
  server.on("exit", (code) => die(`SpacetimeDB exited (code ${code}).`, "Try running `spacetime start` yourself to see its output."));
  const deadline = Date.now() + 30_000;
  while (!(await spacetimeUp())) {
    if (Date.now() > deadline) die("SpacetimeDB did not come up within 30s.", "Try running `spacetime start` yourself to see its output.");
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function main() {
  await preflight();
  await startSpacetime();
  let issuer;
  try {
    ({ issuer } = prepareLocalDatabase({ port: APP_PORT }));
  } catch (error) {
    die(error.message, "If the module fails to compile, run: spacetime build --module-path server");
  }

  // Everything below is local: no remote database pin, the dev signing key, this machine as issuer.
  const env = {
    ...process.env,
    PORT: String(APP_PORT),
    NEXT_PUBLIC_SPACETIMEDB_URI: "",
    NEXT_PUBLIC_SPACETIMEDB_DATABASE: LOCAL_DATABASE,
    SINGULARITY_SESSION_ISSUER: issuer,
    SINGULARITY_SESSION_PRIVATE_KEY: "",
  };
  if (!dev) {
    console.log("• Building the game (production build) …");
    const build = launch(spawnSync, "npx", ["next", "build"], { stdio: "inherit", env });
    if (build.status !== 0) die("The production build failed (see the output above).", "Fix the error, or try npm run host -- --dev to skip the build.");
  }
  const app = launch(spawn, "npx", ["next", dev ? "dev" : "start", "-H", "0.0.0.0", "-p", String(APP_PORT)], {
    stdio: ["ignore", "ignore", "inherit"],
    env,
  });
  children.push(app);
  app.on("exit", (code) => shutdown(code ?? 0));

  // Wait for the app, and check the session issuer the database will call back into.
  const deadline = Date.now() + 90_000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    try {
      ready = (await fetch(`http://127.0.0.1:${APP_PORT}/.well-known/jwks.json`, { signal: AbortSignal.timeout(5_000) })).ok;
    } catch {}
    if (!ready) await new Promise((r) => setTimeout(r, 750));
  }
  if (!ready) die(`The game didn't answer on port ${APP_PORT} within 90s.`);

  const addresses = lanAddresses();
  const line = "─".repeat(64);
  const row = (label, value) => console.log(` ${label.padEnd(13)}${value}`);
  console.log(`\n${line}`);
  console.log(" SINGULARITY LOCAL DEV IS LIVE");
  console.log(line);
  row("Local app", `http://localhost:${APP_PORT}`);
  if (addresses.length === 0) row("LAN", "no network connection found");
  for (const [i, ip] of addresses.entries()) row(i === 0 ? "LAN" : "", `http://${ip}:${APP_PORT}${i === 0 ? "   ← friends on this network" : ""}`);
  row("SpacetimeDB", `local · port ${SPACETIME_PORT} · database "${LOCAL_DATABASE}"`);
  row("", `sessions signed by ${issuer}${dev ? " · next dev" : " · production build"}`);
  row("Online game", `${ONLINE_GAME}   (no setup needed)`);
  console.log(`\n Friends on other networks: send them the online game instead.`);
  console.log(` LAN friends can't connect? Allow ports ${APP_PORT} (game) and ${SPACETIME_PORT}`);
  console.log(` (SpacetimeDB) through this machine's firewall, for private networks only.`);
  console.log(` Ctrl+C stops everything this started.`);
  console.log(`${line}\n`);
}

main().catch((error) => {
  console.error(error);
  shutdown(1);
});
