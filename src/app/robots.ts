import type { MetadataRoute } from "next";
import { SITE_URL } from "./site";

/**
 * Index the public pages; keep room links (they carry private room codes) and
 * internal endpoints out of search results.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/privacy", "/terms"],
        disallow: ["/play/", "/api/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
