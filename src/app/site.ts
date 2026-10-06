/** Public origin used for canonical URLs, sitemaps and social cards. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://singularity-coral.vercel.app").replace(/\/+$/, "");

export const SITE_NAME = "Singularity";
export const SITE_TAGLINE = "Five players, one body";
export const SITE_DESCRIPTION =
  "A chaotic online co-op physics party game: up to five friends share one ragdoll, one limb each, and race rival squads. Free, in the browser, no account needed.";

/** The crash-test target from the dummy's chest: a quartered yellow-and-ink disc on a lab-sky tile. */
export const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect x="2" y="2" width="60" height="60" rx="15" fill="#BFE4FF" stroke="#14202E" stroke-width="4"/>
  <circle cx="32" cy="32" r="20" fill="#FFD21A" stroke="#14202E" stroke-width="4.5"/>
  <path d="M32 32V12a20 20 0 0 1 20 20Z M32 32v20a20 20 0 0 1-20-20Z" fill="#14202E"/>
</svg>`;
