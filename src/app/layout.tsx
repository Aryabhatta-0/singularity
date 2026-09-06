import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Singularity — five players, one body",
  description: "A chaotic co-op physics party game: five players share one ragdoll body and race through timed challenges. Realtime backend powered by SpacetimeDB.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b1020",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#0b1020] text-white antialiased">{children}</body>
    </html>
  );
}
