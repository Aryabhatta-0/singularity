import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep local Turbopack scoped to this app when unrelated lockfiles exist higher up.
  turbopack: { root: process.cwd() },
};

export default nextConfig;
