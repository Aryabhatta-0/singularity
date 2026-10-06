import type { Metadata } from "next";
import Link from "next/link";
import DummyAssembly from "@/components/onboarding/DummyAssembly";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <main className="relative min-h-dvh bg-[#BFE4FF]">
      <div className="lab-loader">
        <div className="lab-loader-card">
          <DummyAssembly stage={-1} />
          <div className="min-w-0">
            <h1 className="lab-loader-title">Nothing to grab here</h1>
            <p className="lab-loader-note">That page doesn&apos;t exist. If a friend sent you a room link, check it was copied whole.</p>
            <Link href="/" className="lab-btn lab-btn--go mt-4" style={{ fontSize: "1.05rem" }}>
              Back to the lab
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
