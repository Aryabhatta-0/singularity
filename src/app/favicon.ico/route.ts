// The crash-test target from the dummy's chest: a quartered yellow-and-ink
// disc on a lab-sky tile. Bold shapes only, so it still reads at 16px.
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect x="2" y="2" width="60" height="60" rx="15" fill="#BFE4FF" stroke="#14202E" stroke-width="4"/>
  <circle cx="32" cy="32" r="20" fill="#FFD21A" stroke="#14202E" stroke-width="4.5"/>
  <path d="M32 32V12a20 20 0 0 1 20 20Z M32 32v20a20 20 0 0 1-20-20Z" fill="#14202E"/>
</svg>`;

export function GET() {
  return new Response(FAVICON, {
    headers: {
      "Cache-Control": "public, max-age=86400, immutable",
      "Content-Type": "image/svg+xml; charset=utf-8",
    },
  });
}
