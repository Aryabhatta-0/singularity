import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Anybody, Archivo, Bebas_Neue, JetBrains_Mono } from "next/font/google";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL } from "./site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME}: ${SITE_TAGLINE.toLowerCase()}`, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: ["online multiplayer", "co-op", "party game", "physics game", "ragdoll", "browser game", "free"],
  alternates: { canonical: "/" },
  icons: {
    icon: [{ url: "/favicon.ico?v=2", type: "image/svg+xml" }],
    apple: [{ url: "/icons/180.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME}: ${SITE_TAGLINE.toLowerCase()}`,
    description: SITE_DESCRIPTION,
    url: "/",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME}: ${SITE_TAGLINE.toLowerCase()}`,
    description: SITE_DESCRIPTION,
  },
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "default" },
  formatDetection: { telephone: false, email: false, address: false },
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
