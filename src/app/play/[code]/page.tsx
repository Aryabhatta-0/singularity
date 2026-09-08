"use client";

import dynamic from "next/dynamic";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { isValidRoomCode, normalizeRoomCode } from "@/app/room-code";

const GameClient = dynamic(() => import("@/components/GameClient"), { ssr: false });

export default function PlayPage() {
  const params = useParams<{ code: string }>();
  const search = useSearchParams();
  const code = normalizeRoomCode(String(params.code ?? ""));
  const solo = search.get("solo") === "1";
  if (!isValidRoomCode(code)) {
    return (
      <main className="meet-landing grid min-h-dvh place-items-center px-5 text-center">
        <div className="meet-panel w-full max-w-md rounded-2xl p-6">
          <div className="meet-display text-sm tracking-[0.28em] text-black/50">SINGULARITY</div>
          <h1 className="mt-1 text-2xl font-black">That room code will not scan</h1>
          <p className="mt-2 text-sm leading-relaxed text-black/60">Room codes use 3–8 letters or numbers. Check the invite and try again.</p>
          <Link href="/" className="meet-cta mt-5 inline-flex rounded-xl px-5 py-3 font-black">Return to landing</Link>
        </div>
      </main>
    );
  }
  return <GameClient code={code} solo={solo} />;
}
