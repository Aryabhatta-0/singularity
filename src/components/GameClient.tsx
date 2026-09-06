"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { CHALLENGES, ROLE_INFO, formatTime, squadRoles, type Role, type RoleInput, type RoomSnapshot, type SquadSize } from "@/game/types";
import type { Game, HudState, Snap } from "@/game/game";
import { Net } from "@/game/net";
import { topLeaderboardRows, type LeaderboardRow } from "@/game/leaderboard";
import { InputManager, inputsEqual } from "@/game/input";
import { getLevel } from "@/game/levels";
import { planPlayingTransition } from "@/game/round-transition";
import MobileControls from "@/components/MobileControls";

interface Toast {
  id: number;
  text: string;
  tone: "good" | "bad" | "info";
}

function getName() {
  return localStorage.getItem("singularity_name") || `Player${Math.floor(Math.random() * 90 + 10)}`;
}

export default function GameClient({ code, solo }: { code: string; solo: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const netRef = useRef<Net | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const roomRef = useRef<RoomSnapshot | null>(null);
  const goTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = useRef<Record<string, RoleInput>>({});
  const lastSendTimeRef = useRef(0);
  const activeRoleRef = useRef(0);
  const creatingRef = useRef(false);
  const phaseRef = useRef<string>("");
  const roundRef = useRef(-1);
  const toastId = useRef(0);

  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [activeRole, setActiveRole] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [boardSquad, setBoardSquad] = useState<SquadSize>(5);
  const [muted, setMuted] = useState(false);
  const [ready, setReady] = useState(false);
  const [gameReady, setGameReady] = useState(false);
  const [connErr, setConnErr] = useState(false);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [finishToast, setFinishToast] = useState<{ team: string; time: number; color: string } | null>(null);
  const [myFinish, setMyFinish] = useState<number | null>(null);
  const [myId, setMyId] = useState("");

  const me = useMemo(() => room?.players.find((p) => p.id === myId) ?? null, [room, myId]);
  const myTeam = useMemo(() => room?.teams.find((t) => t.id === me?.teamId) ?? null, [room, me]);
  const isLeader = !!room && !!me && room.leaderId === me.id;
  const isHost = !!myTeam && !!me && myTeam.hostId === me.id;
  const myRoles = me?.roles ?? [];
  const currentRole: Role | null = myRoles[Math.min(activeRole, Math.max(0, myRoles.length - 1))] ?? null;
  const challenge = CHALLENGES.find((c) => c.id === room?.challengeId) ?? CHALLENGES[0];

  const addToast = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  const ensureAudio = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    g.audio.ensure();
    g.audio.startMusic();
  }, []);

  // ---------- networking ----------
  useEffect(() => {
    const name = getName();
    const net = new Net(code, name, solo);
    netRef.current = net;
    net.setHandlers({
      onRoom: (r) => {
        roomRef.current = r;
        setRoom(r);
      },
      onRemoteInputs: (inputs) => gameRef.current?.setRemoteInputs(inputs),
      onSnapshot: (teamId, snap) => {
        const g = gameRef.current;
        const r = roomRef.current;
        if (!g || !r) return;
        const myT = r.players.find((p) => p.id === netRef.current?.myId)?.teamId;
        if (teamId === myT) {
          if (!g.isHost) g.applyOwnSnapshot(snap);
        } else {
          const t = r.teams.find((x) => x.id === teamId);
          g.applyGhostSnapshot(teamId, t?.color ?? "#999", t?.name ?? "Team", snap);
        }
      },
      onTeamFinished: (teamId, timeMs, teamName) => {
        const r = roomRef.current;
        const myT = r?.players.find((p) => p.id === netRef.current?.myId)?.teamId;
        if (teamId === myT) setMyFinish(timeMs);
        const t = r?.teams.find((x) => x.id === teamId);
        setFinishToast({ team: teamName, time: timeMs, color: t?.color ?? "#fff" });
        setTimeout(() => setFinishToast(null), 3500);
      },
      onConnectionChange: (ok) => {
        setConnErr(!ok);
        if (ok) setMyId(net.myId);
      },
      onScores: (rows) => setLeaderboard(rows),
    });
    net.connect();
    const input = new InputManager();
    inputRef.current = input;
    input.onRoleSwitch = (dir, idx) => {
      const n = roomRef.current?.players.find((p) => p.id === netRef.current?.myId)?.roles.length ?? 0;
      if (n <= 1) return;
      let next = activeRoleRef.current;
      if (dir === "index") next = Math.min(n - 1, idx ?? 0);
      else next = (next + (dir as number) + n) % n;
      input.resetVirtualControls();
      activeRoleRef.current = next;
      setActiveRole(next);
    };
    const onPL = () => setPointerLocked(document.pointerLockElement === canvasRef.current);
    document.addEventListener("pointerlockchange", onPL);
    const beforeUnload = () => net.close();
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("pointerlockchange", onPL);
      net.close();
      input.detach();
      gameRef.current?.dispose();
      gameRef.current = null;
    };
  }, [code, solo]);

  // ---------- create game when room + canvas are ready ----------
  useEffect(() => {
    if (!room || !me || !myTeam || gameRef.current || creatingRef.current || !canvasRef.current) return;
    creatingRef.current = true;
    const canvas = canvasRef.current;
    const host = myTeam.hostId === me.id;
    (async () => {
      const { Game } = await import("@/game/game");
      const g = await Game.create({
        canvas,
        levelId: room.challengeId,
        teamId: myTeam.id,
        teamColor: myTeam.color,
        isHost: host,
        squadSize: room.squadSize,
        onEvent: (ev) => {
          if (ev.type === "hud") setHud(ev.hud);
          else if (ev.type === "message") addToast(ev.text, ev.tone);
          else if (ev.type === "finish") {
            setMyFinish(ev.timeMs);
            const game = gameRef.current;
            if (game?.isHost) {
              netRef.current?.completeRun(game.takeSnapshot(), ev.timeMs);
            }
          }
        },
      });
      g.setTeamName(myTeam.name);
      g.onSnapshot = (s) => {
        const r = roomRef.current;
        if (r && r.players.length > 1) netRef.current?.publishSnapshot(s);
      };
      gameRef.current = g;
      inputRef.current?.attach(canvas);
      setGameReady(true);
      creatingRef.current = false;
    })().catch((e) => {
      console.error(e);
      creatingRef.current = false;
      addToast("Failed to start 3D engine (WebGL required)", "bad");
    });
  }, [room, me, myTeam, addToast]);

  // ---------- react to room changes ----------
  /* eslint-disable react-hooks/set-state-in-effect -- SpacetimeDB phase changes intentionally synchronize engine and UI state. */
  useEffect(() => {
    const g = gameRef.current;
    if (!g || !room || !me || !myTeam) return;
    g.setTeamName(myTeam.name);
    g.setHost(myTeam.hostId === me.id);
    g.squadSize = room.squadSize;
    g.clearRemoteInputs();
    // remove ghosts of vanished teams
    for (const id of [...g.ghosts.keys()]) if (!room.teams.some((t) => t.id === id) || id === myTeam.id) g.removeGhost(id);
    if (g.level.id !== room.challengeId) {
      g.setLevel(room.challengeId);
      if (inputRef.current) {
        inputRef.current.yaw = g.level.spawnYaw;
        inputRef.current.pitch = 0;
      }
      g.freeRoam();
    }
    const phaseKey = `${room.phase}:${room.round}`;
    if (phaseKey !== phaseRef.current) {
      phaseRef.current = phaseKey;
      if (goTimerRef.current) {
        clearTimeout(goTimerRef.current);
        goTimerRef.current = null;
      }
      if (room.phase === "lobby") {
        g.freeRoam();
        setCountdown(null);
        setMyFinish(null);
        setReady(false);
      } else if (room.phase === "countdown") {
        setMyFinish(null);
        g.prepareRun();
        if (inputRef.current) {
          inputRef.current.yaw = g.level.spawnYaw;
          inputRef.current.pitch = 0;
        }
        ensureAudio();
        const net = netRef.current!;
        const startAt = room.startAt ?? net.serverNow() + 4000;
        const tick = () => {
          const remaining = startAt - net.serverNow();
          if (remaining <= 0) {
            setCountdown(0);
            g.go();
            g.audio.beep(true);
            setTimeout(() => setCountdown(null), 900);
            return;
          }
          const n = Math.ceil(remaining / 1000);
          setCountdown((prev) => {
            if (prev !== n) g.audio.beep(false);
            return n;
          });
          goTimerRef.current = setTimeout(tick, Math.min(remaining, ((remaining - 1) % 1000) + 1));
        };
        tick();
      } else if (room.phase === "playing") {
        const transition = planPlayingTransition({
          running: g.running,
          finished: g.finished,
          observedRound: roundRef.current,
          currentRound: room.round,
        });
        if (transition.prepare) g.prepareRun();
        if (transition.start) g.go();
        setCountdown(null);
        roundRef.current = room.round;
      } else if (room.phase === "results") {
        g.stopRun();
        setCountdown(null);
        setBoardSquad(room.squadSize);
        g.audio.stopMusic();
      }
    }
    if (room.phase === "countdown" || room.phase === "playing") roundRef.current = room.round;
  }, [room, me, myTeam, gameReady, ensureAudio]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ---------- input loop ----------
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const g = gameRef.current;
      const input = inputRef.current;
      const r = roomRef.current;
      const pid = netRef.current?.myId;
      if (!g || !input || !r || !pid) return;
      const meNow = r.players.find((p) => p.id === pid);
      if (!meNow) return;
      const roles = meNow.roles;
      const idx = Math.min(activeRoleRef.current, Math.max(0, roles.length - 1));
      const active = roles[idx];
      input.enabled = r.phase !== "results";
      // Torso steers the camera (legacy Head role also works)
      input.tickHead(dt, active === "torso" || active === "head");
      const payload: Partial<Record<Role, RoleInput>> = {};
      let changed = false;
      if (g.isHost) g.localInputs = {};
      for (const role of roles) {
        const inp = input.read(role, role === active);
        payload[role] = inp;
        if (g.isHost) g.setLocalInput(role, inp);
        const prev = lastSentRef.current[role];
        if (!prev || !inputsEqual(prev, inp)) changed = true;
      }
      if (!g.isHost && roles.length > 0) {
        const t = performance.now();
        if ((changed && t - lastSendTimeRef.current > 45) || t - lastSendTimeRef.current > 200) {
          lastSendTimeRef.current = t;
          lastSentRef.current = payload as Record<string, RoleInput>;
          netRef.current?.sendInputs(payload);
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    gameRef.current?.audio.setMuted(muted);
  }, [muted]);

  // ---------- actions ----------
  const toggleReady = () => {
    ensureAudio();
    const next = !ready;
    setReady(next);
    netRef.current?.setReady(next);
  };
  const onCanvasClick = () => {
    ensureAudio();
    const hasFinePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (hasFinePointer && (myRoles.includes("torso") || myRoles.includes("head")) && room?.phase !== "lobby") inputRef.current?.requestPointerLock();
  };

  const allReady = !!room && room.players.length > 0 && room.players.every((p) => p.ready);
  const phase = room?.phase ?? "lobby";
  const sortedTeams = room ? [...room.teams].sort((a, b) => (a.finishMs ?? 1e12) - (b.finishMs ?? 1e12)) : [];
  const level = room ? getLevel(room.challengeId) : null;
  const roomScores = useMemo(
    () => topLeaderboardRows(leaderboard, room?.challengeId ?? "", boardSquad),
    [leaderboard, room?.challengeId, boardSquad]
  );

  return (
    <div className="game-shell relative h-dvh w-full overflow-hidden bg-[#0b1020] text-white select-none">
      <canvas ref={canvasRef} onClick={onCanvasClick} className="game-canvas absolute inset-0 block h-full w-full" style={{ width: "100%", height: "100%" }} />

      {/* Loading */}
      {(!room || !gameReady) && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-[#0b1020]">
          <div className="mb-3 text-4xl font-black tracking-tight sm:text-5xl">
            SINGULARITY
          </div>
          <div className="text-white/60 animate-pulse">{connErr ? "Connecting to SpacetimeDB…" : "Loading physics & shaders…"}</div>
        </div>
      )}

      {/* Top bar */}
      <div className="game-top-bar pointer-events-none absolute top-0 left-0 right-0 z-20 flex items-start justify-between p-2 sm:p-4">
        <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-3">
          <Link href="/" className="rounded-xl bg-black/40 px-2 py-2 text-xs font-bold backdrop-blur hover:bg-black/60 sm:px-3 sm:text-sm">
            ← Lobby
          </Link>
          <div className="rounded-xl bg-black/40 px-2 py-2 text-xs backdrop-blur sm:px-3 sm:text-sm">
            Room <span className="font-black tracking-widest text-[#ffd23f]">{code}</span>
          </div>
        </div>
        {/* Timer */}
        {phase !== "lobby" && (
          <div className="game-timer absolute left-1/2 top-14 flex -translate-x-1/2 flex-col items-center sm:static sm:translate-x-0">
            <div className="max-w-[min(240px,calc(100vw-7rem))] rounded-xl bg-black/50 px-3 py-1 text-center shadow-lg backdrop-blur sm:max-w-none sm:rounded-2xl sm:px-6 sm:py-2">
              <div className="font-mono text-2xl font-black tabular-nums tracking-tight sm:text-4xl">{formatTime((myFinish ?? (hud?.timer ?? 0) * 1000) || 0)}</div>
              <div className="max-w-[220px] truncate text-[9px] uppercase tracking-wider text-white/70 sm:max-w-none sm:text-xs sm:tracking-widest">
                {challenge.icon} {level?.objective}
                {hud && hud.scoreTarget > 0 ? ` · ${hud.score}/${hud.scoreTarget}` : ""}
              </div>
            </div>
          </div>
        )}
        <div className="pointer-events-auto flex items-center gap-2">
          <button onClick={() => setMuted((m) => !m)} className="rounded-xl bg-black/40 px-2.5 py-2 text-xs font-bold backdrop-blur hover:bg-black/60 sm:px-3 sm:text-sm">
            {muted ? "🔇" : "🔊"}
          </button>
        </div>
      </div>

      {/* Team status (right side) */}
      {room && phase !== "lobby" && (
        <div className="game-team-status pointer-events-none absolute right-2 top-28 z-20 flex flex-col gap-2 sm:right-4 sm:top-20">
          {sortedTeams.map((t) => (
            <div key={t.id} className="game-team-chip flex items-center gap-2 rounded-xl bg-black/40 backdrop-blur px-3 py-1.5 text-sm">
              <span className="h-3 w-3 rounded-full" style={{ background: t.color }} />
              <span className="game-team-name font-bold">{t.name}</span>
              <span className="font-mono text-white/80">{t.finishMs != null ? formatTime(t.finishMs) : "…"}</span>
            </div>
          ))}
        </div>
      )}

      {/* Role card */}
      {room && me && currentRole && (
        <div className="desktop-role-card absolute bottom-4 left-4 z-20 w-[320px] max-w-[calc(100vw-2rem)]">
          {myRoles.length > 1 && (
            <div className="mb-2 flex gap-1">
              {myRoles.map((r, i) => (
                <button
                  key={r}
                  onClick={() => {
                    inputRef.current?.resetVirtualControls();
                    activeRoleRef.current = i;
                    setActiveRole(i);
                  }}
                  className={`rounded-lg px-2 py-1 text-xs font-bold ${i === activeRole ? "bg-[#ffd23f] text-black" : "bg-black/40 text-white/80 hover:bg-black/60"}`}
                >
                  {i + 1} {ROLE_INFO[r].emoji} {ROLE_INFO[r].short}
                </button>
              ))}
            </div>
          )}
          <div className="rounded-2xl bg-black/50 backdrop-blur p-4 shadow-xl border border-white/10">
            <div className="flex items-center gap-3">
              <div className="text-4xl">{ROLE_INFO[currentRole].emoji}</div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-white/60">You control</div>
                <div className="text-xl font-black" style={{ color: myTeam?.color }}>
                  {ROLE_INFO[currentRole].label}
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              {ROLE_INFO[currentRole].keys.map((k) => (
                <div key={k.key} className="contents">
                  <kbd className="rounded bg-white/15 px-1.5 py-0.5 font-mono font-bold text-[11px] whitespace-nowrap">{k.key}</kbd>
                  <span className="text-white/80">{k.does}</span>
                </div>
              ))}
              {myRoles.length > 1 && (
                <div className="contents">
                  <kbd className="rounded bg-white/15 px-1.5 py-0.5 font-mono font-bold text-[11px]">Tab / 1-5</kbd>
                  <span className="text-white/80">Switch body part</span>
                </div>
              )}
            </div>
            {(currentRole === "torso" || currentRole === "head") && !pointerLocked && phase !== "lobby" && <div className="mt-2 text-[11px] text-[#ffd23f]">Click the game to capture the mouse</div>}
          </div>
        </div>
      )}

      {/* Mobile movement and role-aware actions */}
      {room && me && currentRole && phase !== "lobby" && phase !== "results" && (
        <MobileControls
          key={currentRole}
          inputRef={inputRef}
          role={currentRole}
          roles={myRoles}
          activeRole={activeRole}
          teamColor={myTeam?.color ?? "#ffd23f"}
          disabled={!gameReady || myFinish != null}
          onRoleSelect={(index) => {
            inputRef.current?.resetVirtualControls();
            activeRoleRef.current = index;
            setActiveRole(index);
          }}
          onFirstInteraction={ensureAudio}
        />
      )}

      {/* Status chips */}
      {hud && phase !== "lobby" && (
        <div className="game-status-chips pointer-events-none absolute bottom-4 right-4 z-20 flex flex-col items-end gap-2">
          {hud.fallen && <div className="animate-bounce rounded-xl bg-[#ff5d5d] px-4 py-2 font-black shadow-lg">FALLEN! Torso: hold BRACE to get up</div>}
          {hud.hanging && <div className="rounded-xl bg-[#4fa8ff] px-4 py-2 font-black shadow-lg">HANGING · Arms: pull down · Legs: step!</div>}
          {hud.holding > 0 && !hud.hanging && <div className="rounded-xl bg-[#6ef29a] text-black px-4 py-2 font-black shadow-lg">HOLDING · Arms: THROW when ready</div>}
          {hud.crouch && <div className="rounded-xl bg-black/50 px-3 py-1 text-sm font-bold">Crouching</div>}
          {isHost && hud.brace < 1 && (
            <div className="w-40 rounded-full bg-black/50 p-1">
              <div className="h-2 rounded-full bg-[#ffd23f] transition-all" style={{ width: `${hud.brace * 100}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Toasts */}
      <div className="game-toast-stack pointer-events-none absolute left-1/2 top-[22%] z-30 flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={`toast game-toast game-toast--${t.tone}`}>
            {t.text}
          </div>
        ))}
        {finishToast && (
          <div
            className="toast game-toast game-toast--finish"
            style={{ "--toast-color": finishToast.color } as CSSProperties}
          >
            🏁 {finishToast.team} finished in {formatTime(finishToast.time)}!
          </div>
        )}
      </div>

      {/* Countdown */}
      {countdown !== null && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
          <div key={countdown} className="countdown text-[7rem] font-black drop-shadow-[0_8px_0_rgba(0,0,0,0.4)] sm:text-[10rem]" style={{ color: countdown === 0 ? "#6ef29a" : "#ffd23f" }}>
            {countdown === 0 ? "GO!" : countdown}
          </div>
        </div>
      )}

      {/* Finish banner (mine) */}
      {myFinish != null && phase === "playing" && (
        <div className="pointer-events-none absolute inset-x-0 top-[30%] z-30 flex flex-col items-center">
          <div className="countdown text-4xl font-black text-[#ffd23f] drop-shadow-[0_6px_0_rgba(0,0,0,0.4)] sm:text-6xl">FINISHED!</div>
          <div className="mt-2 font-mono text-3xl font-black">{formatTime(myFinish)}</div>
          <div className="mt-1 text-white/80">Waiting for other teams…</div>
        </div>
      )}

      {/* Lobby panel */}
      {room && me && phase === "lobby" && (
        <div className="game-lobby-panel absolute inset-y-0 right-0 z-20 flex w-full max-w-[440px] touch-pan-y flex-col gap-3 overflow-y-auto p-4 pt-20">
          <div className="rounded-2xl bg-black/60 backdrop-blur p-4 border border-white/10 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-white/60">Room code</div>
                <div className="text-3xl font-black tracking-[0.3em] text-[#ffd23f]">{code}</div>
              </div>
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(`${location.origin}/play/${code}`);
                  addToast("Invite link copied!", "good");
                }}
                className="rounded-xl bg-white/10 px-3 py-2 text-sm font-bold hover:bg-white/20"
              >
                Copy invite link
              </button>
            </div>
            <div className="mt-2 text-xs text-white/60">Friends open the link, pick a body part, ready up. Missing parts get shared (Tab to switch).</div>
          </div>

          {/* Squad size */}
          <div className="rounded-2xl bg-black/60 backdrop-blur p-4 border border-white/10">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-white/60">Squad size {isLeader ? "(you pick)" : ""}</div>
            <div className="grid grid-cols-2 gap-2">
              {([3, 5] as SquadSize[]).map((n) => (
                <button
                  key={n}
                  disabled={!isLeader}
                  onClick={() => netRef.current?.setSquad(n)}
                  className={`rounded-xl px-3 py-2 text-left transition ${room.squadSize === n ? "bg-[#6ef29a] text-black" : "bg-white/5 hover:bg-white/10 disabled:hover:bg-white/5"}`}
                >
                  <div className="font-black leading-tight">{n} players</div>
                  <div className={`text-xs ${room.squadSize === n ? "text-black/70" : "text-white/60"}`}>
                    {n === 3 ? "Arms · Torso · Legs" : "2 hands · Torso · 2 legs"}
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-2 text-xs text-white/60">Separate leaderboards for 3P and 5P. Switching clears role picks.</div>
          </div>

          {/* Challenge */}
          <div className="rounded-2xl bg-black/60 backdrop-blur p-4 border border-white/10">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-white/60">Challenge {isLeader ? "(you pick)" : ""}</div>
            <div className="flex flex-col gap-2">
              {CHALLENGES.map((c) => (
                <button
                  key={c.id}
                  disabled={!isLeader}
                  onClick={() => netRef.current?.setChallenge(c.id)}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2 text-left transition ${room.challengeId === c.id ? "bg-[#ffd23f] text-black" : "bg-white/5 hover:bg-white/10 disabled:hover:bg-white/5"}`}
                >
                  <span className="text-2xl">{c.icon}</span>
                  <div className="min-w-0">
                    <div className="font-black leading-tight">
                      {c.name}{" "}
                      <span className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-black uppercase ${c.difficulty === "easy" ? "bg-[#6ef29a] text-black" : c.difficulty === "medium" ? "bg-[#4fa8ff] text-black" : c.difficulty === "hard" ? "bg-[#ff5d5d] text-black" : "bg-white/20 text-white"}`}>
                        {c.difficulty}
                      </span>
                    </div>
                    <div className={`text-xs ${room.challengeId === c.id ? "text-black/70" : "text-white/60"}`}>{c.tagline}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Teams */}
          {room.teams.map((t) => {
            const members = room.players.filter((p) => p.teamId === t.id);
            const mine = t.id === me.teamId;
            return (
              <div key={t.id} className="rounded-2xl bg-black/60 backdrop-blur p-4 border" style={{ borderColor: mine ? t.color : "rgba(255,255,255,0.1)" }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ background: t.color }} />
                    <span className="font-black">{t.name}</span>
                    <span className="text-xs text-white/50">
                      {members.length}/{room.squadSize}
                    </span>
                  </div>
                  {!mine && members.length < room.squadSize && (
                    <button onClick={() => netRef.current?.joinTeam(t.id)} className="rounded-lg bg-white/10 px-2 py-1 text-xs font-bold hover:bg-white/20">
                      Join
                    </button>
                  )}
                </div>
                <div className={`mt-3 grid gap-1 ${room.squadSize === 3 ? "grid-cols-3" : "grid-cols-5"}`}>
                  {squadRoles(room.squadSize).map((r) => {
                    const owner = members.find((m) => m.roles.includes(r));
                    const isMe = owner?.id === me.id;
                    return (
                      <button
                        key={r}
                        disabled={!mine}
                        onClick={() => netRef.current?.setRole(r)}
                        title={ROLE_INFO[r].blurb}
                        className={`flex flex-col items-center rounded-xl px-1 py-2 text-center transition ${isMe ? "text-black" : owner ? "bg-white/15" : "bg-white/5 hover:bg-white/10"}`}
                        style={isMe ? { background: t.color } : undefined}
                      >
                        <span className="text-xl">{ROLE_INFO[r].emoji}</span>
                        <span className="text-[9px] font-black uppercase tracking-wide">{ROLE_INFO[r].short}</span>
                        <span className={`mt-0.5 line-clamp-1 text-[10px] ${isMe ? "text-black/80" : "text-white/70"}`}>{owner ? owner.name : "free"}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {members.map((m) => (
                    <span key={m.id} className={`rounded-full px-2 py-0.5 text-[11px] ${m.ready ? "bg-[#6ef29a] text-black" : "bg-white/10"}`}>
                      {m.name}
                      {m.id === t.hostId ? " ★" : ""}
                      {m.ready ? " ✓" : ""}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
          <button onClick={() => netRef.current?.createTeam()} className="rounded-2xl border border-dashed border-white/20 py-2 text-sm font-bold text-white/70 hover:bg-white/5">
            + New team (compete on the same course)
          </button>

          <div className="sticky bottom-0 flex flex-col gap-2 rounded-2xl bg-black/70 backdrop-blur p-3 border border-white/10">
            <div className="flex gap-2">
              <button onClick={toggleReady} className={`flex-1 rounded-xl py-3 text-lg font-black transition ${ready ? "bg-[#6ef29a] text-black" : "bg-white text-black hover:bg-[#ffd23f]"}`}>
                {ready ? "READY ✓" : "READY UP"}
              </button>
              {isLeader && (
                <button
                  onClick={() => {
                    ensureAudio();
                    netRef.current?.startRound(!allReady);
                  }}
                  className={`flex-1 rounded-xl py-3 text-lg font-black transition ${allReady ? "bg-[#ffd23f] text-black animate-pulse" : "bg-white/10 text-white/70 hover:bg-white/20"}`}
                >
                  {allReady ? "START!" : "Start anyway"}
                </button>
              )}
            </div>
            <div className="text-center text-[11px] text-white/50">
              {isLeader ? "You are the room leader." : `Waiting for ${room.players.find((p) => p.id === room.leaderId)?.name ?? "leader"} to start.`} Practice with the body while you wait — the course is live.
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {room && phase === "results" && (
        <div className="game-results-overlay absolute inset-0 z-30 flex items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-4">
          <div className="game-results-panel max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl touch-pan-y overflow-y-auto rounded-3xl bg-[#121a33] border border-white/10 p-4 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:p-6">
            <div className="text-center">
              <div className="text-[11px] uppercase tracking-[0.3em] text-white/60">{challenge.name}</div>
              <div className="text-4xl font-black">RESULTS</div>
            </div>
            <div className="mt-5 grid gap-6 md:grid-cols-2">
              <div>
                <div className="mb-2 text-xs uppercase tracking-widest text-white/60">This round</div>
                <div className="flex flex-col gap-2">
                  {sortedTeams.map((t, i) => (
                    <div key={t.id} className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ background: i === 0 && t.finishMs != null ? t.color : "rgba(255,255,255,0.06)", color: i === 0 && t.finishMs != null ? "#111" : "#fff" }}>
                      <div className="text-2xl font-black w-8">{i === 0 && t.finishMs != null ? "🏆" : `#${i + 1}`}</div>
                      <div className="flex-1">
                        <div className="font-black">{t.name}</div>
                        <div className="text-xs opacity-70">{room.players.filter((p) => p.teamId === t.id).map((p) => p.name).join(", ")}</div>
                      </div>
                      <div className="font-mono text-xl font-black">{t.finishMs != null ? formatTime(t.finishMs) : "DNF"}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs uppercase tracking-widest text-white/60">Global leaderboard</span>
                  <span className="flex gap-1">
                    {([3, 5] as SquadSize[]).map((n) => (
                      <button
                        key={n}
                        onClick={() => setBoardSquad(n)}
                        className={`rounded-lg px-2 py-0.5 text-xs font-black ${boardSquad === n ? "bg-[#6ef29a] text-black" : "bg-white/10 text-white/70 hover:bg-white/20"}`}
                      >
                        {n}P
                      </button>
                    ))}
                  </span>
                </div>
                <div className="mb-2 text-[11px] text-white/45">
                  Only complete, non-practice squads locked at round start are globally ranked.
                </div>
                <div className="flex flex-col gap-1 max-h-72 overflow-y-auto pr-1">
                  {roomScores.length === 0 && <div className="text-sm text-white/50">No times yet. Be the first!</div>}
                  {roomScores.map((row, i) => {
                    const isUs = !!myTeam && row.teamName === myTeam.name && myFinish != null && row.timeMs === myFinish;
                    return (
                      <div key={row.id} className={`flex items-center gap-2 rounded-lg px-2 py-1 text-sm ${isUs ? "bg-[#ffd23f] text-black" : "bg-white/5"}`}>
                        <span className="w-6 font-black">{i + 1}</span>
                        <span className="flex-1 truncate">
                          <span className="font-bold">{row.teamName}</span> <span className="opacity-60 text-xs">{(row.players ?? []).join(", ")}</span>
                        </span>
                        <span className="font-mono font-bold">{formatTime(row.timeMs)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="mt-6 flex flex-col items-center gap-2">
              {isLeader ? (
                <div className="flex gap-2">
                  <button onClick={() => netRef.current?.startRound(true)} className="rounded-xl bg-[#ffd23f] px-6 py-3 text-lg font-black text-black hover:brightness-110">
                    ↻ Play again
                  </button>
                  <button onClick={() => netRef.current?.backToLobby()} className="rounded-xl bg-white/10 px-6 py-3 text-lg font-black hover:bg-white/20">
                    Change challenge
                  </button>
                </div>
              ) : (
                <div className="text-white/70">Waiting for the room leader to restart…</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
