import { MARK_SVG } from "../site";

// Bold shapes only, so the mark still reads at 16px.
export function GET() {
  return new Response(MARK_SVG, {
    headers: {
      "Cache-Control": "public, max-age=86400, immutable",
      "Content-Type": "image/svg+xml; charset=utf-8",
    },
  });
}
