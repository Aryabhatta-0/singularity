"use client";

import dynamic from "next/dynamic";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { isValidRoomCode, normalizeRoomCode } from "@/app/room-code";
import DummyAssembly from "@/components/onboarding/DummyAssembly";

// While the game bundle loads, show the same test stand the loader uses so
// the launch iris lands on a dummy, not a blank screen.
const GameClient = dynamic(() => import("@/components/GameClient"), {
  ssr: false,
  loading: () => (
    <div className="relative h-dvh w-full bg-[#BFE4FF]">
      <div className="lab-loader">
        <div className="lab-loader-curtain" aria-hidden="true" />
        <div className="lab-loader-card">
          <DummyAssembly stage={0} />
          <div className="min-w-0">
            <h2 className="lab-loader-title">Assembling your body</h2>
            <p className="lab-loader-status" role="status">
              Loading the game…
            </p>
          </div>
        </div>
      </div>
    </div>
  ),
});

export default function PlayPage() {
  const params = useParams<{ code: string }>();
  const search = useSearchParams();
  const code = normalizeRoomCode(String(params.code ?? ""));
  // ?solo=1 is the free-for-all join flag (?ffa=1 accepted as an alias).
  const solo = search.get("solo") === "1" || search.get("ffa") === "1";
  // ?offline=1 practices in this tab alone; ?server= points at another host's room server.
  const offline = search.get("offline") === "1";
  const serverQuery = search.get("server");
  if (!isValidRoomCode(code)) {
    return (
      <main className="relative min-h-dvh bg-[#BFE4FF]">
        <div className="lab-loader">
          <div className="lab-loader-card">
            <DummyAssembly stage={-1} />
            <div className="min-w-0">
              <h1 className="lab-loader-title">That room code won&apos;t scan</h1>
              <p className="lab-loader-note">Room codes use 3–8 letters or numbers. Check the invite and try again.</p>
              <Link href="/" className="lab-btn lab-btn--go mt-4" style={{ fontSize: "1.05rem" }}>
                Return to landing
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }
  return <GameClient code={code} solo={solo} offline={offline} serverQuery={serverQuery} />;
}
