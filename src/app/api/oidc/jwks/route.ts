import { sessionIssuer } from "@/server/session";

export const dynamic = "force-dynamic";

/** Served at /.well-known/jwks.json (see next.config.ts): the public half of the session key. */
export async function GET() {
  const config = await sessionIssuer();
  if (!config) return Response.json({ keys: [] }, { status: 503, headers: { "Cache-Control": "no-store" } });
  return Response.json(
    { keys: [config.key.publicJwk] },
    { headers: { "Cache-Control": "public, max-age=300, s-maxage=300" } },
  );
}
