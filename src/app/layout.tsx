import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Archivo, Bebas_Neue, JetBrains_Mono } from "next/font/google";
import "./globals.css";

export const metadata: Metadata = {
  title: "Singularity — five players, one body",
  description: "A chaotic co-op physics party game: five players share one ragdoll body and race through timed challenges. Realtime backend powered by SpacetimeDB.",
  icons: { icon: "/favicon.ico" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0c1122",
};

const display = Bebas_Neue({ weight: "400", subsets: ["latin"], variable: "--meet-display", display: "swap" });
const sans = Archivo({ weight: ["500", "700", "800", "900"], subsets: ["latin"], variable: "--meet-sans", display: "swap" });
const mono = JetBrains_Mono({ weight: ["500", "700"], subsets: ["latin"], variable: "--meet-mono", display: "swap" });

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${sans.variable} ${mono.variable} bg-[#0c1122] text-white antialiased`}>
        <div
          aria-hidden="true"
          style={{ display: "none" }}
          dangerouslySetInnerHTML={{
            __html: `<!-- THESIS: One squad, one body, head-to-head heats; refuses the generic gradient hero plus emoji cards. OWN-WORLD: Floodlit cinder track at dusk; chalk bone, ink, cinder-red action; Bebas condensed, tabular times, lane numbers, tonal press states; lobby stays night heat-sheet over live 3D, gameplay RHS becomes race rail, loading bridges paper to night. STORY: Visitor grasps shared-body in seconds, names self, creates or joins, picks an event, acts. FIRST VIEWPORT: Left offer, name, Create versus, Solo, join code; right shared-body linkage plus event lanes; primary Create versus left. FORM: Grounded candidate 7 crew-call and starting-blocks, seed 3b7b86a5, raised by cartoon lockup, chalk grain, tonal press, joint keyframes, graticule measure. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance -->`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
