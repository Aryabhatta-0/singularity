import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Anybody, Archivo, Bebas_Neue, JetBrains_Mono } from "next/font/google";
import "./globals.css";

export const metadata: Metadata = {
  title: "Singularity — five players, one body",
  description: "A chaotic co-op physics party game: five players share one ragdoll body and race through timed challenges. Realtime backend powered by SpacetimeDB.",
  icons: { icon: "/favicon.ico?v=2" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#BFE4FF",
};

// Anybody's width axis lets onboarding type squash and stretch like the dummy.
const lab = Anybody({ subsets: ["latin"], axes: ["wdth"], variable: "--lab-display", display: "swap" });
const display = Bebas_Neue({ weight: "400", subsets: ["latin"], variable: "--meet-display", display: "swap" });
const sans = Archivo({ weight: ["500", "700", "800", "900"], subsets: ["latin"], variable: "--meet-sans", display: "swap" });
const mono = JetBrains_Mono({ weight: ["500", "700"], subsets: ["latin"], variable: "--meet-mono", display: "swap" });

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${lab.variable} ${display.variable} ${sans.variable} ${mono.variable} bg-[#0c1122] text-white antialiased`}>
        {children}
      </body>
    </html>
  );
}
