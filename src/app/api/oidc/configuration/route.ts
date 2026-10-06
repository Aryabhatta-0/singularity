import { sessionIssuer } from "@/server/session";

export const dynamic = "force-dynamic";

/**
 * Served at /.well-known/openid-configuration (see next.config.ts).
 * SpacetimeDB reads it to find the keys that verify game session tokens.
 */
export async function GET() {
  const config = await sessionIssuer();
  if (!config) return Response.json({ error: "sessions-unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  return Response.json(
    {
      issuer: config.issuer,
      jwks_uri: `${config.issuer}/.well-known/jwks.json`,
      id_token_signing_alg_values_supported: ["ES256"],
      response_types_supported: ["id_token"],
      subject_types_supported: ["public"],
    },
    { headers: { "Cache-Control": "public, max-age=300, s-maxage=300" } },
  );
}
