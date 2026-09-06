"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CHALLENGES, ROLES_5, ROLE_INFO, formatTime, type SquadSize } from "@/game/types";
import { DbConnection, type EventContext } from "@/module_bindings";
import type { Leaderboard } from "@/module_bindings/types";
import { loadSpacetimeToken, saveSpacetimeToken, SPACETIMEDB_MODULE, SPACETIMEDB_URI } from "@/game/net";
import { storedMilliseconds } from "@/game/time";
import { compareLeaderboardRows, topLeaderboardRows, type LeaderboardRow } from "@/game/leaderboard";
import FeedbackDialog from "@/components/FeedbackDialog";

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

/** Live leaderboard straight from SpacetimeDB — no API routes involved. */
function useScoreFeed() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [online, setOnline] = useState(false);
  const cache = useRef(new Map<string, LeaderboardRow>());

  useEffect(() => {
    let disposed = false;
    let connection: DbConnection | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let generation = 0;

    const sync = () => {
      setRows([...cache.current.values()].sort(compareLeaderboardRows));
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer) return;
      setOnline(false);
      const delay = Math.min(5_000, 500 * 2 ** reconnectAttempt++);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed) return;
      const thisGeneration = ++generation;
      connection = DbConnection.builder()
        .withUri(SPACETIMEDB_URI)
        .withDatabaseName(SPACETIMEDB_MODULE)
        .withToken(loadSpacetimeToken())
        .onConnect((c, _identity, token) => {
          if (disposed || thisGeneration !== generation) {
            c.disconnect();
            return;
          }
          connection = c;
          saveSpacetimeToken(token);
          cache.current.clear();
          sync();

          const insert = (_ctx: EventContext, row: Leaderboard) => {
            if (disposed || thisGeneration !== generation) return;
            const id = row.id.toString();
            cache.current.set(id, {
              id,
              challengeId: row.challengeId,
              squadSize: row.squadSize === 3 ? 3 : 5,
              teamName: row.teamName,
              players: row.players,
              timeMs: storedMilliseconds(row.timeMs),
            });
            sync();
          };
          c.db.leaderboard.onInsert(insert);
          c.db.leaderboard.onDelete((_ctx: EventContext, row: Leaderboard) => {
            if (disposed || thisGeneration !== generation) return;
            if (cache.current.delete(row.id.toString())) sync();
          });
          c.subscriptionBuilder()
            .onApplied(() => {
              if (!disposed && thisGeneration === generation) {
                reconnectAttempt = 0;
                setOnline(true);
              }
            })
            .onError(() => {
              if (!disposed && thisGeneration === generation) c.disconnect();
            })
            .subscribe(["SELECT * FROM leaderboard"]);
        })
        .onConnectError(() => {
          if (thisGeneration === generation) {
            connection = null;
            scheduleReconnect();
          }
        })
        .onDisconnect(() => {
          if (thisGeneration !== generation) return;
          connection = null;
          scheduleReconnect();
        })
        .build();
    };

    const resume = () => {
      if (disposed) return;
      if (connection?.isSocketClosed) {
        const stale = connection;
        connection = null;
        generation += 1;
        reconnectAttempt = 0;
        setOnline(false);
        stale.disconnect();
        connect();
        return;
      }
      if (!connection) {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = null;
        reconnectAttempt = 0;
        connect();
      }
    };
    const resumeWhenVisible = () => {
      if (document.visibilityState === "visible") resume();
    };

    document.addEventListener("visibilitychange", resumeWhenVisible);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    window.addEventListener("pageshow", resume);
    connect();
    return () => {
      disposed = true;
      generation += 1;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      document.removeEventListener("visibilitychange", resumeWhenVisible);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("pageshow", resume);
      connection?.disconnect();
    };
  }, []);

  return { rows, online };
}

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<SquadSize>(5);
  const { rows, online } = useScoreFeed();

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
    router.push(`/play/${makeCode()}${solo ? "?solo=1" : ""}`);
  };
  const join = () => {
    const c = code.trim().toUpperCase();
    if (c.length < 3) return;
    saveName();
    setBusy(true);
    router.push(`/play/${c}`);
  };

  const top = (challengeId: string, n: number) =>
    topLeaderboardRows(rows, challengeId, tab, n);

  return (
    <main className="min-h-dvh bg-[radial-gradient(ellipse_at_top,#1d2a5a_0%,#0b1020_60%)] text-white">
      <div className="mx-auto max-w-5xl px-5 py-10 md:py-16">
        <header className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.25em] text-white/70">Co-op physics party game · SpacetimeDB</div>
          <h1 className="mt-4 text-5xl font-black tracking-tight sm:text-6xl md:text-8xl">
            SINGULARITY
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-white/75">
            3 or 5 players. <span className="font-black text-white">One body.</span> Torso steers the eyes and balance, hands grab and carry (both must agree), legs walk in rhythm. Walk, climb, ferry cargo — and try not to fall in the water.
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs font-bold">
            <span className="rounded-full bg-[#6ef29a] px-2 py-0.5 text-black">EASY · Wobble Run</span>
            <span className="rounded-full bg-[#4fa8ff] px-2 py-0.5 text-black">MEDIUM · Ferry Job</span>
            <span className="rounded-full bg-[#ff5d5d] px-2 py-0.5 text-black">HARD · Summit Sync</span>
            <span className="rounded-full bg-[#f6a6c1] px-2 py-0.5 text-black">BONUS · Egg Express</span>
            <span className="rounded-full bg-[#ffb347] px-2 py-0.5 text-black">BONUS · Slam Dunk</span>
          </div>
        </header>

        <div className="mt-10 grid gap-4 md:grid-cols-5">
          {ROLES_5.map((r, index) => (
            <div key={r} className="float rounded-2xl bg-white/5 p-4 text-center border border-white/10" style={{ animationDelay: `${((index * 7) % 10) / 5}s` }}>
              <div className="text-4xl">{ROLE_INFO[r].emoji}</div>
              <div className="mt-1 font-black">{ROLE_INFO[r].label}</div>
              <div className="mt-1 text-xs text-white/60">{ROLE_INFO[r].blurb}</div>
            </div>
          ))}
        </div>

        <section className="mt-10 grid gap-4 md:grid-cols-[1.2fr_1fr]">
          <div className="rounded-3xl bg-white/5 border border-white/10 p-6">
            <label className="text-xs uppercase tracking-widest text-white/60">Your name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={16}
              placeholder="e.g. Left Leg Larry"
              className="mt-1 w-full rounded-xl bg-black/40 px-4 py-3 text-lg font-bold outline-none ring-[#ffd23f] focus:ring-2"
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button disabled={busy} onClick={() => create(false)} className="rounded-2xl bg-[#ffd23f] px-5 py-4 text-xl font-black text-black shadow-[0_6px_0_#b8931a] transition hover:brightness-110 active:translate-y-1 active:shadow-none disabled:opacity-60">
                Create room
                <div className="text-xs font-bold opacity-70">3 or 5 per team · pick in lobby</div>
              </button>
              <button disabled={busy} onClick={() => create(true)} className="rounded-2xl bg-white/10 px-5 py-4 text-xl font-black shadow-[0_6px_0_rgba(0,0,0,0.4)] transition hover:bg-white/20 active:translate-y-1 active:shadow-none disabled:opacity-60">
                Solo practice
                <div className="text-xs font-bold opacity-70">control every part (Tab to switch)</div>
              </button>
            </div>
            <div className="mt-5 flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && join()}
                maxLength={6}
                placeholder="ROOM CODE"
                className="w-full rounded-xl bg-black/40 px-4 py-3 text-lg font-black tracking-[0.3em] outline-none ring-[#4fa8ff] focus:ring-2"
              />
              <button disabled={busy} onClick={join} className="rounded-xl bg-[#4fa8ff] px-6 py-3 text-lg font-black text-black hover:brightness-110 disabled:opacity-60">
                Join
              </button>
            </div>
            <div className="mt-5 grid gap-2 text-sm text-white/70 sm:grid-cols-2">
              <div className="rounded-xl bg-black/30 p-3">
                <div className="font-black text-white">How walking works</div>
                5P: left leg presses <kbd className="rounded bg-white/15 px-1">W</kbd>, then right leg presses <kbd className="rounded bg-white/15 px-1">W</kbd>. 3P: legs holds <kbd className="rounded bg-white/15 px-1">W</kbd> to auto-alternate. Both at once? You fall on your face.
              </div>
              <div className="rounded-xl bg-black/30 p-3">
                <div className="font-black text-white">How carrying works</div>
                5P: BOTH hands must hold <kbd className="rounded bg-white/15 px-1">Space</kbd> to grab together, both <kbd className="rounded bg-white/15 px-1">Shift</kbd> to throw. 3P: arms grabs alone. Shouting (Torso <kbd className="rounded bg-white/15 px-1">Q</kbd>) helps.
              </div>
            </div>
          </div>

          <div className="rounded-3xl bg-white/5 border border-white/10 p-6">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs uppercase tracking-widest text-white/60">Global leaderboard</div>
              <div className="flex items-center gap-1">
                {([3, 5] as SquadSize[]).map((n) => (
                  <button key={n} onClick={() => setTab(n)} className={`rounded-lg px-2 py-0.5 text-xs font-black ${tab === n ? "bg-[#6ef29a] text-black" : "bg-white/10 text-white/70 hover:bg-white/20"}`}>
                    {n}P
                  </button>
                ))}
                <span className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${online ? "bg-[#6ef29a]/15 text-[#6ef29a]" : "bg-white/10 text-white/50"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-[#6ef29a]" : "bg-white/40"}`} />
                  {online ? "live" : "offline"}
                </span>
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-4">
              {CHALLENGES.map((c) => (
                <div key={c.id}>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{c.icon}</span>
                    <div>
                      <div className="font-black">
                        {c.name}{" "}
                        <span className="ml-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-black uppercase text-white/70">{c.difficulty}</span>
                      </div>
                      <div className="text-xs text-white/60">{c.tagline}</div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-col gap-1">
                    {top(c.id, 5).length === 0 && <div className="text-xs text-white/40">No times yet.</div>}
                    {top(c.id, 5).map((row, i) => (
                      <div key={row.id} className="flex items-center gap-2 rounded-lg bg-black/30 px-2 py-1 text-xs">
                        <span className="w-4 font-black text-[#ffd23f]">{i + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-bold">{row.teamName}</span>
                          <span className="block truncate text-[10px] text-white/45">{row.players.join(", ")}</span>
                        </span>
                        <span className="font-mono">{formatTime(row.timeMs)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <footer className="mt-10 flex flex-col items-center gap-4 text-center text-xs text-white/60">
          <p>Built with Three.js + Rapier physics + SpacetimeDB. Play with a keyboard or mobile touch controls—and two to four friends yelling at you.</p>
          <FeedbackDialog />
        </footer>
      </div>
    </main>
  );
}
