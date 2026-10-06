/**
 * Local/self-host signing key: generated once into `.singularity/` (git-ignored)
 * so tokens stay valid across restarts of `npm run host` / `npm run dev`.
 * Production deployments configure SINGULARITY_SESSION_PRIVATE_KEY instead.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { generatePrivateJwk } from "./session-jwt";

export const DEV_KEY_PATH = join(process.cwd(), ".singularity", "session-key.json");

export async function loadOrCreateDevKey(path = DEV_KEY_PATH): Promise<JsonWebKey> {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as JsonWebKey;
  } catch {
    const jwk = await generatePrivateJwk();
    mkdirSync(dirname(path), { recursive: true });
    // `wx` fails if another process created the file first; read theirs instead.
    try {
      writeFileSync(path, `${JSON.stringify(jwk)}\n`, { flag: "wx", mode: 0o600 });
      return jwk;
    } catch {
      return JSON.parse(readFileSync(path, "utf8")) as JsonWebKey;
    }
  }
}
