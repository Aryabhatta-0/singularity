import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

// Room links carry a private room code: never index them, never canonicalize them.
export const metadata: Metadata = {
  title: "In a room",
  robots: { index: false, follow: false, nocache: true },
  alternates: { canonical: null },
};

export const viewport: Viewport = {
  themeColor: "#0c1122",
};

export default function PlayLayout({ children }: { children: ReactNode }) {
  return children;
}
