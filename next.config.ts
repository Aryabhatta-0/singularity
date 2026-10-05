import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

// `npm run host -- --dev` serves friends over the LAN; let `next dev` answer
// this machine's own network addresses.
const lanAddresses = Object.values(networkInterfaces())
  .flat()
  .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
  .map((entry) => entry!.address);

const nextConfig: NextConfig = {
  // Keep local Turbopack scoped to this app when unrelated lockfiles exist higher up.
  turbopack: { root: process.cwd() },
  allowedDevOrigins: lanAddresses,
};

export default nextConfig;
