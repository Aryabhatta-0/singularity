const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0c1122"/>
  <path d="M46 18H25c-6 0-10 3-10 8 0 13 27 5 27 14 0 3-3 5-8 5H16" fill="none" stroke="#edb200" stroke-width="8" stroke-linecap="round"/>
  <circle cx="48" cy="45" r="5" fill="#2fa84f"/>
</svg>`;

export function GET() {
  return new Response(FAVICON, {
    headers: {
      "Cache-Control": "public, max-age=86400, immutable",
      "Content-Type": "image/svg+xml; charset=utf-8",
    },
  });
}
