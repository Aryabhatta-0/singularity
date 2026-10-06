import { networkInterfaces } from "node:os";

export const dynamic = "force-dynamic";

/**
 * Self-hosting only: when `npm run host` serves the game, this machine's
 * network interfaces are the addresses friends on the same network can
 * reach. Private LAN ranges first (what a home network hands out), then the
 * rest. A hosted deployment has no LAN to share, so it answers with nothing.
 */
export function GET() {
  if (process.env.VERCEL === "1") return Response.json({ lanAddresses: [] }, { headers: { "Cache-Control": "no-store" } });
  const addresses: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
    }
  }
  const isPrivate = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  const lanAddresses = [...addresses.filter(isPrivate), ...addresses.filter((ip) => !isPrivate(ip))];
  return Response.json({ lanAddresses }, { headers: { "Cache-Control": "no-store" } });
}
