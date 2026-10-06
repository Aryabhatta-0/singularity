import { ImageResponse } from "next/og";
import { MARK_SVG } from "../../site";

const SIZES = new Set([180, 192, 512]);

/**
 * PNG app icons (home screen, manifest) rendered from the same mark as the
 * favicon. Rendered on request and cached for a day: prerendering "180.png"
 * style params trips Vercel's route-to-function mapping.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size.replace(/\.png$/, ""));
  if (!SIZES.has(size)) return new Response("Not found", { status: 404 });
  const src = `data:image/svg+xml;base64,${Buffer.from(MARK_SVG).toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: "#BFE4FF" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- rendered to PNG by satori, not the DOM */}
        <img src={src} width={size} height={size} alt="" />
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=86400, immutable" } },
  );
}
