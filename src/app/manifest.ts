import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "./site";

/** Lets phones add the game to the home screen and launch it without browser chrome. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME}: five players, one body`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#BFE4FF",
    theme_color: "#BFE4FF",
    categories: ["games", "entertainment"],
    icons: [
      { src: "/icons/192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
