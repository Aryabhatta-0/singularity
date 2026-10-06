import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

// `npm run host -- --dev` serves friends over the LAN; let `next dev` answer
// this machine's own network addresses.
const lanAddresses = Object.values(networkInterfaces())
  .flat()
  .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
  .map((entry) => entry!.address);

/** Where browsers may open sockets: the pinned game database, else any (self-host on a LAN). */
function connectSources(): string {
  const pinned = process.env.NEXT_PUBLIC_SPACETIMEDB_URI?.trim();
  if (!pinned) return "'self' ws: wss: http: https:";
  try {
    const url = new URL(pinned);
    const https = url.protocol === "wss:" || url.protocol === "https:";
    const host = url.host;
    return `'self' ${https ? "wss" : "ws"}://${host} ${https ? "https" : "http"}://${host}`;
  } catch {
    return "'self'";
  }
}

const contentSecurityPolicy = [
  "default-src 'self'",
  // Next.js inlines its bootstrap scripts, Rapier compiles its physics WebAssembly,
  // and the SpacetimeDB SDK generates its binary serializers with `Function(...)`.
  // One policy for every page: client-side navigation into a room keeps the
  // landing page's document (and its policy), so rooms cannot get a looser one.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self'",
  "worker-src 'self' blob:",
  `connect-src ${connectSources()}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  // Development tooling (fast refresh, overlays) is not covered; only production builds get the policy.
  ...(process.env.NODE_ENV === "production" ? [{ key: "Content-Security-Policy", value: contentSecurityPolicy }] : []),
];

const nextConfig: NextConfig = {
  // Keep local Turbopack scoped to this app when unrelated lockfiles exist higher up.
  turbopack: { root: process.cwd() },
  allowedDevOrigins: lanAddresses,
  poweredByHeader: false,
  async redirects() {
    // The mark is SVG. Served as "favicon.ico", Vercel labels it an ICO by
    // extension and browsers (with nosniff) refuse to decode it.
    return [{ source: "/favicon.ico", destination: "/icon.svg", permanent: false }];
  },
  async rewrites() {
    return [
      // OpenID discovery for game session tokens (see src/server/session.ts).
      { source: "/.well-known/openid-configuration", destination: "/api/oidc/configuration" },
      { source: "/.well-known/jwks.json", destination: "/api/oidc/jwks" },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Room links carry a private code: keep them out of search results and referrers.
      {
        source: "/play/:code*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      { source: "/api/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
    ];
  },
};

export default nextConfig;
