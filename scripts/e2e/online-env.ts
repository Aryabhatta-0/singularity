/*
 * Defaults for scripts/online-smoke.ts. Imported before the harness so the
 * harness reads the production endpoints when it initialises.
 */
export const SITE = (process.env.SMOKE_SITE || "https://singularity-coral.vercel.app").replace(/\/+$/, "");

process.env.E2E_URI ||= "wss://maincloud.spacetimedb.com";
process.env.E2E_DB ||= "singularity";
process.env.E2E_SESSION_URL ||= `${SITE}/api/session`;
