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
      <main className="grid min-h-dvh place-items-center bg-[#0b1020] px-5 text-center text-white">
        <div className="max-w-md rounded-2xl border border-white/10 bg-white/5 p-6">
          <h1 className="text-2xl font-black">That room code is invalid</h1>
          <p className="mt-2 text-white/70">Room codes use 3–8 letters or numbers. Check the invite and try again.</p>
          <Link href="/" className="mt-5 inline-flex rounded-xl bg-[#ffd23f] px-5 py-3 font-black text-black hover:brightness-110">Return to lobby</Link>
        </div>
      </main>
    );
  }
  return <GameClient code={code} solo={solo} />;
}
