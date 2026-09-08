"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CHALLENGES, ROLES_5, ROLE_INFO } from "@/game/types";
import { createRoomCode, normalizeRoomCode, roomCodeError } from "./room-code";
import { ChallengeIcon, RoleIcon } from "@/components/icons";

const ROLE_SHORT: Record<string, string> = {
  lhand: "LH",
  rhand: "RH",
  torso: "TO",
  lleg: "LL",
  rleg: "RL",
};

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is intentionally read after hydration.
    setName(localStorage.getItem("singularity_name") ?? "");
  }, []);

  const saveName = () => {
    const n = name.trim().slice(0, 16) || `Player${Math.floor(Math.random() * 90 + 10)}`;
    localStorage.setItem("singularity_name", n);
    return n;
  };
  const create = (solo = false) => {
    saveName();
    setBusy(true);
    router.push(`/play/${createRoomCode()}${solo ? "?solo=1" : ""}`);
  };
  const join = () => {
    const error = roomCodeError(code);
    if (error) {
      setCodeError(error);
      return;
    }
    const c = normalizeRoomCode(code);
    saveName();
    setBusy(true);
    router.push(`/play/${c}`);
  };

  return (
    <main className="meet-landing min-h-dvh">
      <div className="meet-topbar sticky top-0 z-30">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-3">
          <span className="meet-wordmark font-black">SINGULARITY</span>
          <span className="hidden rounded-full border border-black/15 px-2.5 py-0.5 text-xs font-black tracking-[0.18em] text-black/60 sm:inline">
            5 PLAYERS · 1 BODY
          </span>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-5 pb-16 pt-10 md:pt-14">
        {/* Hero: offer + entry left, linkage + heats right. Fills the desktop void with real product truth. */}
        <div className="grid items-start gap-8 lg:grid-cols-[1.02fr_0.98fr]">
          <div className="min-w-0 max-w-2xl">
            <h1 className="meet-h1 font-black">
              FIVE PLAYERS.
              <br />
              <span className="meet-accent-text">ONE BODY.</span>
            </h1>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-black/70">
              Build a 3- or 5-player squad around <span className="font-black text-black">one shared body</span>, then
              race rival teams. Torso steers and balances, hands grab and carry, legs move in rhythm.
            </p>

            <section aria-label="Enter the game" className="meet-panel mt-6 rounded-2xl p-5">
              <label htmlFor="player-name" className="meet-display text-sm tracking-[0.14em] text-black/60">
                YOUR NAME
              </label>
              <input
                id="player-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={16}
                placeholder="e.g. Left Leg Larry"
                autoComplete="nickname"
                className="meet-field mt-2 w-full min-w-0 rounded-xl px-4 py-3 text-lg font-bold outline-none"
              />
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <button
                  disabled={busy}
                  onClick={() => create(false)}
                  className="meet-cta rounded-2xl px-5 py-4 text-left text-xl font-black disabled:opacity-60"
                >
                  Create versus room
                  <span className="block text-xs font-bold opacity-80">2–6 teams · 3 or 5 players each</span>
                </button>
                <button
                  disabled={busy}
                  onClick={() => create(true)}
                  className="meet-ghost-btn rounded-2xl px-5 py-4 text-left text-xl font-black disabled:opacity-60"
                >
                  Solo practice
                  <span className="block text-xs font-bold text-black/55">Control every part (Tab to switch)</span>
                </button>
              </div>
              <div className="mt-5">
                <label htmlFor="room-code" className="meet-display text-sm tracking-[0.14em] text-black/60">
                  ROOM CODE
                </label>
                <div className="mt-2 flex gap-2">
                  <input
                    id="room-code"
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value.toUpperCase());
                      if (codeError) setCodeError(null);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && join()}
                    maxLength={8}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    aria-invalid={codeError ? true : undefined}
                    aria-describedby="room-code-error"
                    placeholder="ROOM CODE"
                    className="meet-field meet-tabular min-w-0 w-full rounded-xl px-4 py-3 text-lg font-bold tracking-[0.22em] outline-none"
                  />
                  <button
                    disabled={busy}
                    onClick={join}
                    className="meet-join shrink-0 rounded-xl px-6 py-3 text-lg font-black disabled:opacity-60"
                  >
                    Join
                  </button>
                </div>
                <p id="room-code-error" role={codeError ? "alert" : undefined} className="mt-1 min-h-4 text-xs font-bold text-[#B3261E]">
                  {codeError}
                </p>
              </div>
            </section>

            <div id="how" className="mt-4 grid scroll-mt-24 gap-3 sm:grid-cols-3">
              <div className="meet-panel rounded-xl p-4">
                <div className="meet-tabular text-xs font-bold tracking-[0.14em] text-[#8F2006]">NAME</div>
                <div className="mt-1 text-sm font-black">Enter name</div>
                <p className="mt-0.5 text-xs leading-relaxed text-black/55">16 characters, picked once.</p>
              </div>
              <div className="meet-panel rounded-xl p-4">
                <div className="meet-tabular text-xs font-bold tracking-[0.14em] text-[#8F2006]">ENTER</div>
                <div className="mt-1 text-sm font-black">Create or join</div>
                <p className="mt-0.5 text-xs leading-relaxed text-black/55">Versus room or solo reps.</p>
              </div>
              <div className="meet-panel rounded-xl p-4">
                <div className="meet-tabular text-xs font-bold tracking-[0.14em] text-[#8F2006]">SYNC</div>
                <div className="mt-1 text-sm font-black">Pick roles, ready</div>
                <p className="mt-0.5 text-xs leading-relaxed text-black/55">Leader starts the heat.</p>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="meet-panel rounded-xl p-4 text-sm leading-relaxed text-black/75">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="meet-display text-sm tracking-[0.14em] text-black">WALKING</h2>
                  <span className="meet-tabular flex items-center gap-1 text-xs font-bold text-black/45" aria-hidden="true">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#1E7A3C]" />
                    <span>L</span>
                    <span className="text-black/25">·</span>
                    <span>R</span>
                    <span className="text-black/25">·</span>
                    <span>L</span>
                    <span className="text-black/25">·</span>
                    <span>R</span>
                  </span>
                </div>
                <p className="mt-1">
                  5P: left leg presses <kbd className="rounded px-1">W</kbd>, then right leg presses{" "}
                  <kbd className="rounded px-1">W</kbd>. 3P: legs hold{" "}
                  <kbd className="rounded px-1">W</kbd> to auto-alternate. Both at once? You fall on your face.
                </p>
              </div>
              <div className="meet-panel rounded-xl p-4 text-sm leading-relaxed text-black/75">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="meet-display text-sm tracking-[0.14em] text-black">CARRYING</h2>
                  <span className="meet-tabular flex items-center gap-1 text-xs font-bold text-black/45" aria-hidden="true">
                    <span className="inline-block h-1.5 w-3 rounded-full bg-[#1D5FC2]" />
                    <span className="inline-block h-1.5 w-3 rounded-full bg-[#1D5FC2]" />
                    <span>GRIP</span>
                  </span>
                </div>
                <p className="mt-1">
                  5P: BOTH hands hold <kbd className="rounded px-1">Space</kbd> to grab together, both{" "}
                  <kbd className="rounded px-1">Shift</kbd> to throw. 3P: arms grab alone. Torso{" "}
                  <kbd className="rounded px-1">Q</kbd> shouts the rhythm.
                </p>
              </div>
            </div>
          </div>

          {/* Right rail: shared-body diagram + tonight's heats. This is what the blank void was missing. */}
          <div className="grid min-w-0 gap-4">
            <div className="meet-linkage rounded-3xl p-5" aria-label="One body, five operators">
              <div className="flex items-center justify-between gap-2">
                <h2 className="meet-display text-lg tracking-[0.12em]">ONE BODY · FIVE OPERATORS</h2>
                <span className="meet-tabular rounded-full border border-black/15 px-2 py-0.5 text-xs font-bold tracking-[0.14em] text-black/55">
                  SYNC OR FALL
                </span>
              </div>
              <ol className="mt-4 grid grid-cols-5 items-center gap-1 text-center">
                {ROLES_5.map((r) => (
                  <li key={r} className="min-w-0">
                    <span
                      className="mx-auto grid h-12 w-12 place-items-center rounded-full border-2 border-[#BE2E0D] bg-white text-[#8F2006] md:h-14 md:w-14"
                      title={ROLE_INFO[r].label}
                    >
                      <RoleIcon role={r} className="h-6 w-6 md:h-7 md:w-7" />
                    </span>
                    <span className="meet-tabular mt-1.5 block text-xs font-bold tracking-[0.12em] text-black/60">
                      {ROLE_SHORT[r]}
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-3 rounded-2xl bg-black/[0.04] px-4 py-3 text-center">
                <p className="text-sm font-black tracking-wide">THE HUB ONLY MOVES WHEN THE CREW AGREES</p>
                <p className="mt-0.5 text-xs leading-relaxed text-black/55">
                  Legs set the rhythm · Torso keeps balance · Hands commit together. Rival squads race beside you as
                  live ghosts.
                </p>
              </div>
            </div>

            <section id="heats" aria-label="Tonight's heats" className="meet-panel scroll-mt-24 rounded-3xl p-5">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <h2 className="meet-display text-2xl tracking-[0.1em]">TONIGHT&apos;S HEATS</h2>
                <p className="meet-tabular text-xs font-bold tracking-[0.14em] text-black/50">5 EVENTS</p>
              </div>
              <ol className="mt-3 grid gap-2">
                {CHALLENGES.map((c, i) => (
                  <li key={c.id} className="meet-heat meet-sweep flex items-center gap-3 rounded-2xl px-3 py-2.5" style={{ animationDelay: `${i * 70}ms` }}>
                    <span className="meet-heat-lane-no meet-tabular w-8 shrink-0 text-center" aria-hidden="true">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-black/[0.05] text-black/70">
                      <ChallengeIcon challenge={c} className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-black">
                        {c.name} <span className={`diff diff-${c.difficulty} ml-1`}>{c.difficulty}</span>
                      </span>
                      <span className="block text-xs leading-snug text-black/55 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">{c.tagline}</span>                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-xs leading-relaxed text-black/50">
                Picked by the room leader in the lobby. Rival teams run the same course head-to-head.
              </p>
            </section>
          </div>
        </div>

        <section id="crew" aria-label="Crew roles" className="meet-panel mt-10 scroll-mt-24 rounded-3xl p-5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="meet-display text-2xl tracking-[0.1em]">PICK YOUR LIMB</h2>
            <p className="text-xs text-black/55">One joint per player. The line only holds when every joint pulls.</p>
          </div>
          <div className="relative mt-4">
            <div className="absolute left-6 right-6 top-7 hidden h-0.5 bg-black/15 md:block" aria-hidden="true" />
            <ol className="relative grid gap-3 sm:grid-cols-3 md:grid-cols-5">
              {ROLES_5.map((r) => (
                <li key={r} className="meet-joint relative rounded-2xl p-3 text-center">
                  <span className="mx-auto grid h-14 w-14 place-items-center rounded-full border-2 border-[#BE2E0D] bg-white text-[#8F2006]" aria-hidden="true">
                    <RoleIcon role={r} className="h-7 w-7" />
                  </span>
                  <div className="mt-2 text-sm font-black">{ROLE_INFO[r].label}</div>
                  <div className="mt-1 text-xs leading-snug text-black/55">{ROLE_INFO[r].blurb}</div>
                  {ROLE_INFO[r].keys[0] && (
                    <div className="meet-tabular mt-2 text-xs font-bold tracking-[0.1em] text-black/45">
                      {ROLE_INFO[r].keys[0].key}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <footer className="mt-8 flex flex-col items-center gap-2 pb-4 text-center text-xs leading-relaxed text-black/50">
          <p>
            Keyboard or mobile touch; rival squads race beside you as live, non-contact ghosts.
          </p>
          <p className="meet-tabular text-xs font-bold tracking-[0.18em]">3P · ARMS TORSO LEGS — 5P · HANDS TORSO LEGS</p>
        </footer>
      </div>
    </main>
  );
}
