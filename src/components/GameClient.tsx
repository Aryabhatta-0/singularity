"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { CHALLENGES, ROLE_INFO, TEAM_COLORS, formatTime, squadRoles, type Role, type RoleInput, type RoomSnapshot, type SquadSize } from "@/game/types";
import type { Game, HudState, Snap } from "@/game/game";
import { Net } from "@/game/net";
import { topLeaderboardRows, type LeaderboardRow } from "@/game/leaderboard";
import { InputManager, inputsEqual } from "@/game/input";
import { getLevel } from "@/game/levels";
import { planPlayingTransition } from "@/game/round-transition";
import { mergeLiveProgress, progressFromSnapshot, roundStandings, type LiveTeamProgress } from "@/game/round-standings";
import { INPUT_CHANGE_SEND_INTERVAL_MS, INPUT_REFRESH_INTERVAL_MS } from "@/game/network-tuning";
import MobileControls from "@/components/MobileControls";
import { ChallengeIcon, CheckIcon, CopyIcon, FlagIcon, PlusIcon, RoleIcon, RotateIcon, SoundOffIcon, SoundOnIcon } from "@/components/icons";

interface Toast {
  id: number;
  text: string;
  tone: "good" | "bad" | "info";
}

type ConnectionState = "connecting" | "online" | "reconnecting" | "restored";

const MAX_TEAM_NAME_LENGTH = 22;

function TeamNameEditor({ name, onRename }: { name: string; onRename: (name: string) => boolean }) {
  const [value, setValue] = useState(name);
  const normalized = value.trim().replace(/\s+/g, " ");
  const canSave = normalized.length >= 2 && normalized !== name;

  const commit = () => {
    if (!canSave || !onRename(normalized)) {
      setValue(name);
      return;
    }
    setValue(normalized);
  };

  return (
    <form
      className="flex min-w-0 flex-1 items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        commit();
      }}
    >
      <input
        aria-label="Team name"
        value={value}
        maxLength={MAX_TEAM_NAME_LENGTH}
        onChange={(event) => setValue(event.target.value)}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.form?.contains(next)) return;
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setValue(name);
            event.currentTarget.blur();
          }
        }}
        className="lobby-team-editor min-w-0 flex-1 rounded-md px-2 py-1 font-black outline-none transition"
      />
      <button
        type="submit"
        disabled={!canSave}
        className="lobby-team-save rounded-md bg-white px-2.5 py-1.5 text-xs font-black uppercase tracking-wide text-black transition disabled:cursor-default disabled:opacity-30"
      >
        Save
      </button>
    </form>
  );
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
  const connectionStateRef = useRef<ConnectionState>("connecting");
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const joinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSnapshotsRef = useRef(new Map<number, Snap>());
  const finishReconcileKeyRef = useRef<string | null>(null);
  const rosterKeyRef = useRef<string | null>(null);

  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [activeRole, setActiveRole] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [boardSquad, setBoardSquad] = useState<SquadSize>(5);
  const [muted, setMuted] = useState(false);
  const [gameReady, setGameReady] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [pointerLocked, setPointerLocked] = useState(false);
  const [finishToast, setFinishToast] = useState<{ team: string; time: number; color: string } | null>(null);
  const [myFinish, setMyFinish] = useState<number | null>(null);
  const [myId, setMyId] = useState("");
  const [roomUnavailable, setRoomUnavailable] = useState(false);
  const [liveProgress, setLiveProgress] = useState<Record<number, LiveTeamProgress>>({});

  const me = useMemo(() => room?.players.find((p) => p.id === myId) ?? null, [room, myId]);
  const myTeam = useMemo(() => room?.teams.find((t) => t.id === me?.teamId) ?? null, [room, me]);
  const isLeader = !!room && !!me && room.leaderId === me.id;
  const isHost = !!myTeam && !!me && myTeam.hostId === me.id;
  const myRoles = me?.roles ?? [];
  const ready = me?.ready ?? false;
  const currentRole: Role | null = myRoles[Math.min(activeRole, Math.max(0, myRoles.length - 1))] ?? null;
  const challenge = CHALLENGES.find((c) => c.id === room?.challengeId) ?? CHALLENGES[0];

  const addToast = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  const renameMyTeam = useCallback(
    (name: string) => {
      if (!room || !myTeam || !isHost) return false;
      if (room.teams.some((team) => team.id !== myTeam.id && team.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        addToast("That team name is already taken.", "bad");
        return false;
      }
      netRef.current?.renameTeam(name);
      addToast(`Team renamed to ${name}.`, "good");
      return true;
    },
    [room, myTeam, isHost, addToast]
  );

  const recordTeamProgress = useCallback((teamId: number, snap: Snap) => {
    const currentRoom = roomRef.current;
    if (!currentRoom || (currentRoom.phase !== "countdown" && currentRoom.phase !== "playing")) return;
    const next = progressFromSnapshot(getLevel(currentRoom.challengeId), snap);
    setLiveProgress((current) => {
      const previous = current[teamId];
      const merged = mergeLiveProgress(previous, next);
      if (
        previous &&
        Math.abs(previous.progress - merged.progress) < 0.003 &&
        previous.score === merged.score &&
        previous.fallen === merged.fallen &&
        Math.floor(previous.timerMs / 500) === Math.floor(merged.timerMs / 500)
      ) {
        return current;
      }
      return { ...current, [teamId]: merged };
    });
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
    const pendingSnapshots = pendingSnapshotsRef.current;
    netRef.current = net;
    const markConnection = (next: ConnectionState) => {
      connectionStateRef.current = next;
      setConnectionState(next);
    };
    const clearRecoveryTimer = () => {
      if (!recoveryTimerRef.current) return;
      clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    };
    const markRestored = () => {
      markConnection("restored");
      recoveryTimerRef.current = setTimeout(() => {
        recoveryTimerRef.current = null;
        markConnection("online");
      }, 3_200);
    };
    const clearJoinTimer = () => {
      if (!joinTimerRef.current) return;
      clearTimeout(joinTimerRef.current);
      joinTimerRef.current = null;
    };
    const awaitRoomMembership = () => {
      if (roomRef.current?.players.some((player) => player.id === net.myId)) {
        clearJoinTimer();
        return;
      }
      if (joinTimerRef.current) return;
      joinTimerRef.current = setTimeout(() => {
        joinTimerRef.current = null;
        if (!roomRef.current?.players.some((player) => player.id === net.myId)) {
          setRoomUnavailable(true);
        }
      }, 5_000);
    };
    net.setHandlers({
      onRoom: (r) => {
        roomRef.current = r;
        setRoom(r);
        if (r.players.some((player) => player.id === net.myId)) {
          clearJoinTimer();
          setRoomUnavailable(false);
        } else {
          awaitRoomMembership();
        }
      },
      onRemoteInputs: (inputs) => gameRef.current?.setRemoteInputs(inputs),
      onSnapshot: (teamId, snap) => {
        recordTeamProgress(teamId, snap);
        const g = gameRef.current;
        const r = roomRef.current;
        if (!g || !r) {
          pendingSnapshotsRef.current.set(teamId, snap);
          return;
        }
        const myT = r.players.find((p) => p.id === netRef.current?.myId)?.teamId;
        if (teamId === myT) {
          if (!g.isHost) g.applyOwnSnapshot(snap);
        } else {
          const t = r.teams.find((x) => x.id === teamId);
          g.applyGhostSnapshot(teamId, t?.color ?? "#999", t?.name ?? "Team", snap);
        }
      },
      onSnapshotCleared: (teamId) => {
        pendingSnapshotsRef.current.delete(teamId);
        setLiveProgress((current) => {
          if (!(teamId in current)) return current;
          const next = { ...current };
          delete next[teamId];
          return next;
        });
        const g = gameRef.current;
        if (!g) return;
        const r = roomRef.current;
        const myT = r?.players.find((player) => player.id === netRef.current?.myId)?.teamId;
        if (teamId === myT) g.clearOwnSnapshots();
        else g.removeGhost(teamId);
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
        clearRecoveryTimer();
        if (!ok) {
          clearJoinTimer();
          markConnection("reconnecting");
          return;
        }
        setMyId(net.myId);
        awaitRoomMembership();
        if (connectionStateRef.current === "reconnecting") {
          markRestored();
        } else {
          markConnection("online");
        }
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
    const onOffline = () => {
      clearRecoveryTimer();
      markConnection("reconnecting");
    };
    document.addEventListener("pointerlockchange", onPL);
    const beforeUnload = () => net.close();
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("offline", onOffline);
    if (!navigator.onLine) onOffline();
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("pointerlockchange", onPL);
      clearRecoveryTimer();
      clearJoinTimer();
      if (goTimerRef.current) {
        clearTimeout(goTimerRef.current);
        goTimerRef.current = null;
      }
      pendingSnapshots.clear();
      net.close();
      input.detach();
      gameRef.current?.dispose();
      gameRef.current = null;
    };
  }, [code, solo, recordTeamProgress]);

  const creationLevelId = room?.challengeId;
  const creationSquadSize = room?.squadSize;
  const creationPlayerId = me?.id;
  const creationTeamId = myTeam?.id;
  const creationTeamColor = myTeam?.color;

  // ---------- create game when room + canvas are ready ----------
  useEffect(() => {
    if (
      !creationLevelId ||
      !creationPlayerId ||
      creationTeamId == null ||
      !creationTeamColor ||
      creationSquadSize == null ||
      gameRef.current ||
      creatingRef.current ||
      !canvasRef.current
    ) return;
    let cancelled = false;
    let settled = false;
    creatingRef.current = true;
    const canvas = canvasRef.current;
    const teamId = creationTeamId;
    (async () => {
      const { Game } = await import("@/game/game");
      const g = await Game.create({
        canvas,
        levelId: creationLevelId,
        teamId,
        teamColor: creationTeamColor,
        // Start as a replica so a snapshot received during async creation can
        // seed a newly promoted host before authoritative physics is built.
        isHost: false,
        squadSize: creationSquadSize,
        onEvent: (ev) => {
          if (cancelled) return;
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
      if (cancelled) {
        g.dispose();
        return;
      }
      const latestRoom = roomRef.current;
      const latestMe = latestRoom?.players.find((player) => player.id === netRef.current?.myId);
      const latestTeam = latestRoom?.teams.find((team) => team.id === latestMe?.teamId);
      if (!latestRoom || !latestMe || !latestTeam || latestTeam.id !== teamId) {
        g.dispose();
        creatingRef.current = false;
        return;
      }
      g.setTeamName(latestTeam.name);
      const bufferedOwnSnapshot = pendingSnapshotsRef.current.get(teamId);
      if (bufferedOwnSnapshot) g.applyOwnSnapshot(bufferedOwnSnapshot);
      g.setHost(latestTeam.hostId === latestMe.id);
      for (const [pendingTeamId, pendingSnapshot] of pendingSnapshotsRef.current) {
        if (pendingTeamId === teamId) continue;
        const pendingTeam = latestRoom.teams.find((team) => team.id === pendingTeamId);
        if (pendingTeam) g.applyGhostSnapshot(pendingTeamId, pendingTeam.color, pendingTeam.name, pendingSnapshot);
      }
      pendingSnapshotsRef.current.clear();
      g.onSnapshot = (s) => {
        const r = roomRef.current;
        const playerId = netRef.current?.myId;
        const teamId = r?.players.find((player) => player.id === playerId)?.teamId;
        if (teamId != null) recordTeamProgress(teamId, s);
        if (
          r &&
          (r.phase === "countdown" || r.phase === "playing") &&
          r.players.length > 1
        ) {
          netRef.current?.publishSnapshot(s);
        }
      };
      gameRef.current = g;
      inputRef.current?.attach(canvas);
      setGameReady(true);
      creatingRef.current = false;
      settled = true;
    })().catch((e) => {
      if (cancelled) return;
      console.error(e);
      creatingRef.current = false;
      addToast("Failed to start 3D engine (WebGL required)", "bad");
    });
    return () => {
      if (settled) return;
      cancelled = true;
      creatingRef.current = false;
    };
  }, [creationLevelId, creationPlayerId, creationSquadSize, creationTeamColor, creationTeamId, addToast, recordTeamProgress]);

  // ---------- react to room changes ----------
  /* eslint-disable react-hooks/set-state-in-effect -- SpacetimeDB phase changes intentionally synchronize engine and UI state. */
  useEffect(() => {
    const g = gameRef.current;
    if (!g || !room || !me || !myTeam) return;
    g.setTeam(myTeam.id, myTeam.color, myTeam.name);
    const shouldHost = myTeam.hostId === me.id;
    g.setHost(shouldHost);
    const reconciliationKey = `${room.code}:${room.round}:${myTeam.id}`;
    if (
      shouldHost &&
      myTeam.finishMs == null &&
      g.finished &&
      finishReconcileKeyRef.current !== reconciliationKey
    ) {
      finishReconcileKeyRef.current = reconciliationKey;
      // takeSnapshot (not buildSnapshot) drains queued events/messages so the
      // finish proof is not replayed by the next periodic publish.
      netRef.current?.completeRun(g.takeSnapshot(), g.timer * 1_000);
    }
    g.squadSize = room.squadSize;
    // Only wipe teammate inputs when the roster/roles actually changed; room
    // rows are re-emitted on every heartbeat/touchRoom, and clearing unconditionally
    // hitches the host's merged controls for up to an input-refresh interval.
    const rosterKey = room.players
      .map((p) => `${p.id}:${p.teamId}:${p.roles.slice().sort().join(",")}`)
      .sort()
      .join("|");
    if (rosterKey !== rosterKeyRef.current) {
      rosterKeyRef.current = rosterKey;
      g.clearRemoteInputs();
    }
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
        g.clearOwnSnapshots();
        pendingSnapshotsRef.current.clear();
        for (const id of [...g.ghosts.keys()]) g.removeGhost(id);
        setCountdown(null);
        setMyFinish(null);
        setLiveProgress({});
      } else if (room.phase === "countdown") {
        setMyFinish(null);
        setLiveProgress({});
        g.prepareRun();
        if (inputRef.current) {
          inputRef.current.yaw = g.level.spawnYaw;
          inputRef.current.pitch = 0;
        }
        ensureAudio();
        const net = netRef.current!;
        // Match the server's 4.2s countdown budget when the scheduled start
        // timestamp is missing so the local "GO!" stays in sync with the flip.
        const startAt = room.startAt ?? net.serverNow() + 4200;
        let lastShown: number | null = null;
        const tick = () => {
          const remaining = startAt - net.serverNow();
          if (remaining <= 0) {
            setCountdown(0);
            g.go();
            g.audio.beep(true);
            setTimeout(() => setCountdown(null), 900);
            return;
          }
          const n = Math.min(4, Math.ceil(remaining / 1000));
          if (lastShown !== n) g.audio.beep(false);
          lastShown = n;
          setCountdown(n);
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
        if (
          (changed && t - lastSendTimeRef.current >= INPUT_CHANGE_SEND_INTERVAL_MS) ||
          t - lastSendTimeRef.current >= INPUT_REFRESH_INTERVAL_MS
        ) {
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
    netRef.current?.setReady(next);
  };
  const onCanvasClick = () => {
    ensureAudio();
    const hasFinePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (hasFinePointer && (myRoles.includes("torso") || myRoles.includes("head")) && room?.phase !== "lobby") inputRef.current?.requestPointerLock();
  };

  const allReady = !!room && room.players.length > 0 && room.players.every((p) => p.ready);
  const phase = room?.phase ?? "lobby";
  const activeTeams = useMemo(
    () => room?.teams.filter((team) => room.players.some((player) => player.teamId === team.id)) ?? [],
    [room]
  );
  const standings = useMemo(() => roundStandings(activeTeams, liveProgress), [activeTeams, liveProgress]);
  const sortedTeams = standings.map((standing) => standing.team);
  const myStanding = standings.find((standing) => standing.team.id === myTeam?.id) ?? null;
  const competitive = activeTeams.length > 1;
  // Brace is consumed by whoever plays Torso — show the stamina meter to that
  // player (host or not), since they're the one told to "hold BRACE to get up".
  const iControlBrace = myRoles.includes("torso") || myRoles.includes("head");
  const level = room ? getLevel(room.challengeId) : null;
  const threePlayerRosterTooLarge = !!room && room.teams.some(
    (team) => room.players.filter((player) => player.teamId === team.id).length > 3
  );
  const leaderboardSections = useMemo(
    () => CHALLENGES.map((entry) => ({
      challenge: entry,
      rows: topLeaderboardRows(leaderboard, entry.id, boardSquad, 5),
    })),
    [leaderboard, boardSquad]
  );

  return (
    <div className="game-shell relative h-dvh w-full overflow-hidden bg-[#0c1122] text-white select-none">
      <canvas ref={canvasRef} onClick={onCanvasClick} className="game-canvas absolute inset-0 block h-full w-full" style={{ width: "100%", height: "100%" }} />

      {/* Loading bridge: a miniature starting gate in daylight. */}
      {(!room || !gameReady) && (
        <div className="absolute inset-0 z-40 flex items-center justify-center px-5" style={{ background: "rgb(21 39 66 / 45%)" }}>
          <div className="meet-loader-card w-full max-w-md rounded-xl p-5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="lobby-step-title">SINGULARITY</span>
              <span className="meet-tabular lobby-code text-2xl font-bold tracking-[0.18em]">{code}</span>
            </div>
            <div className="meet-loader-rule mt-3 h-1.5 rounded-full">
              <div
                className="meet-loader-fill h-full rounded-full"
                style={{ width: !room ? "34%" : !gameReady ? "72%" : "100%" }}
              />
            </div>
            <ul className="mt-3 space-y-1.5 text-xs font-bold">
              <li className={`meet-loader-step flex items-center gap-2 rounded-lg px-2.5 py-1.5 ${room ? "is-done" : ""}`}>
                <span className="flex gap-1" aria-hidden="true">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <span key={i} className={`meet-loader-dot h-1.5 w-1.5 rounded-full ${room ? "is-done" : ""}`} />
                  ))}
                </span>
                <span className={room ? "" : "opacity-60"}>
                  {room ? "Connected to room" : connectionState === "reconnecting" ? "Reconnecting to the match…" : "Connecting to room…"}
                </span>
                {room && <CheckIcon className="ml-auto h-3.5 w-3.5 text-[#1e7a3c]" />}
              </li>
              <li className={`meet-loader-step flex items-center gap-2 rounded-lg px-2.5 py-1.5 ${gameReady ? "is-done" : ""}`}>
                <span className="grid h-4 w-4 place-items-center" aria-hidden="true">
                  {gameReady ? (
                    <CheckIcon className="h-3.5 w-3.5 text-[#1e7a3c]" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-black/25" />
                  )}
                </span>
                <span className={gameReady ? "" : "opacity-60"}>
                  {gameReady ? "Physics and course ready" : "Loading physics and course…"}
                </span>
                {gameReady && <CheckIcon className="ml-auto h-3.5 w-3.5 text-[#1e7a3c]" />}
              </li>
            </ul>
            <p className="meet-loader-tip mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed">
              {challenge.id === "ferry-job" || challenge.id === "summit-sync"
                ? "Tip: both hands hold grab together — one hand alone will not lift it."
                : challenge.id === "wobble-run"
                  ? "Tip: legs alternate — left, then right. Both at once and you face-plant."
                  : "Tip: if you fall, Torso holds brace to stand back up."}
            </p>
          </div>
        </div>
      )}

      {(connectionState === "reconnecting" || connectionState === "restored") && (
        <div
          className={`game-connection-status game-connection-status--${connectionState}`}
          role="status"
          aria-live="polite"
          data-testid="connection-status"
        >
          <span className="game-connection-dot" aria-hidden="true" />
          <span>
            <strong>{connectionState === "reconnecting" ? "Connection lost" : "Back online"}</strong>
            <span>{connectionState === "reconnecting" ? "Reconnecting…" : "Match connection restored"}</span>
          </span>
        </div>
      )}

      {roomUnavailable && (
        <div className="absolute inset-0 z-[60] grid place-items-center px-5" style={{ background: "rgb(21 39 66 / 55%)" }} role="alert">
          <div className="meet-loader-card w-full max-w-md rounded-xl p-6 text-center">
            <div className="lobby-step-title">SINGULARITY</div>
            <h1 className="mt-1 text-2xl font-black">Room unavailable</h1>
            <p className="lobby-note mt-2 text-sm leading-relaxed">
              {connectionState === "reconnecting"
                ? "The match server could not be reached. Check your connection and try again."
                : `Room ${code} was not found, or its match is already in progress. Check the invite code and try again.`}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Link href="/" className="meet-cta rounded-xl px-5 py-3 font-black">
                Return to landing
              </Link>
              <button onClick={() => location.reload()} className="lobby-quiet-btn rounded-xl px-5 py-3 font-black">
                Retry connection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="game-top-bar pointer-events-none absolute top-0 left-0 right-0 z-20 flex items-start justify-between p-2 sm:p-4">
        <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-3">
          <Link href="/" className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/45 px-2 py-2 text-xs font-bold backdrop-blur hover:bg-black/65 sm:px-3 sm:text-sm" aria-label="Back to landing">
            <span aria-hidden="true">←</span> Lobby
          </Link>
          <div className="rounded-xl border border-white/10 bg-black/45 px-2 py-2 text-xs backdrop-blur sm:px-3 sm:text-sm">
            Room <span className="meet-tabular font-bold tracking-[0.18em] text-[#edb200]">{code}</span>
          </div>
        </div>
        {/* Timer */}
        {phase !== "lobby" && (
          <div className="game-timer absolute left-1/2 top-14 flex -translate-x-1/2 flex-col items-center sm:static sm:translate-x-0">
            <div className="max-w-[min(240px,calc(100vw-7rem))] rounded-xl border border-white/10 bg-black/55 px-3 py-1 text-center shadow-lg backdrop-blur sm:max-w-none sm:rounded-2xl sm:px-6 sm:py-2">
              <div className="meet-tabular text-2xl font-bold tracking-tight sm:text-4xl">{formatTime((myFinish ?? (hud?.timer ?? 0) * 1000) || 0)}</div>
              <div className="flex max-w-[220px] items-center justify-center gap-1.5 truncate text-xs uppercase tracking-wider text-white/70 sm:max-w-none sm:tracking-widest">
                <span className="meet-tabular shrink-0">R{room?.round ?? 0} · {myStanding ? `#${myStanding.place}/${standings.length}` : "RACE"}</span>
                <ChallengeIcon challenge={challenge} className="h-3.5 w-3.5 shrink-0 text-white/60" />
                <span className="truncate">{level?.objective}{hud && hud.scoreTarget > 0 ? ` · ${hud.score}/${hud.scoreTarget}` : ""}</span>
              </div>
            </div>
          </div>
        )}
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? "Unmute game audio" : "Mute game audio"}
            aria-pressed={muted}
            title={muted ? "Sound off" : "Sound on"}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/45 px-2.5 py-2 text-xs font-bold backdrop-blur hover:bg-black/65 sm:px-3 sm:text-sm"
          >
            {muted ? <SoundOffIcon className="h-4 w-4" /> : <SoundOnIcon className="h-4 w-4" />}
            <span className="hidden sm:inline">{muted ? "Muted" : "Sound"}</span>
          </button>
        </div>
      </div>

      {/* Race rail — RHS during gameplay only. Same sheet as the lobby. */}
      {room && phase !== "lobby" && phase !== "results" && (
        <div data-testid="team-standings" className="game-team-status pointer-events-none absolute right-2 top-28 z-20 flex max-h-[50dvh] w-52 max-w-[52vw] flex-col overflow-hidden sm:right-4 sm:top-20 sm:w-60">
          <div className="race-rail pointer-events-auto overflow-hidden rounded-xl">
            <div className="lobby-step px-3 pt-2.5">
              <span className="lobby-step-no">HEAT</span>
              <span className="lobby-step-title">R{room.round} · {standings.length} TEAMS</span>
            </div>
            <div className="flex max-h-[38dvh] flex-col overflow-y-auto px-1.5 pb-1.5">
              {standings.map((standing) => {
                const t = standing.team;
                const isMine = t.id === myTeam?.id;
                const status = t.finishMs != null
                  ? formatTime(t.finishMs)
                  : level?.targetScore
                    ? `${standing.score}/${level.targetScore}`
                    : `${Math.round(standing.progress * 100)}%`;
                return (
                  <div
                    key={t.id}
                    data-testid={`team-standing-${t.id}`}
                    className={`race-row relative flex items-center gap-2 px-1.5 py-2 text-xs sm:text-sm ${isMine ? "is-mine" : ""}`}
                  >
                    <span className="meet-tabular w-6 shrink-0 font-bold text-white/70">#{standing.place}</span>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color }} aria-hidden="true" />
                    <span className="game-team-name min-w-0 flex-1 truncate font-bold">{t.name}</span>
                    {standing.fallen && t.finishMs == null && (
                      <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-white/75" title="Fallen — needs Torso brace">
                        <span className="race-fallen-dot h-1.5 w-1.5 rounded-full" aria-hidden="true" />
                        <span className="hidden sm:inline">Down</span>
                      </span>
                    )}
                    <span className="meet-tabular shrink-0 font-bold text-white/85">{status}</span>
                    <span className="race-progress absolute inset-x-1.5 bottom-0 h-0.5 rounded-full">
                      <span className="block h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.min(100, Math.max(0, standing.progress * 100))}%`, background: t.color }} />
                    </span>
                  </div>
                );
              })}
            </div>
            {myStanding && myTeam && (
              <div className="flex items-center gap-2 border-t border-white/10 px-3 py-2 text-xs text-white/70">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: myTeam.color }} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">You: <span className="font-bold text-white">{myTeam.name}</span></span>
                <span className="meet-tabular shrink-0 font-bold text-[#edb200]">#{myStanding.place}</span>
              </div>
            )}
          </div>
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
                  aria-pressed={i === activeRole}
                  aria-label={`Control ${ROLE_INFO[r].label}`}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold ${i === activeRole ? "bg-[#edb200] text-[#1a1405]" : "bg-black/45 text-white/80 hover:bg-black/65"}`}
                >
                  <span className="meet-tabular opacity-70">{i + 1}</span>
                  <RoleIcon role={r} className="h-3.5 w-3.5" />
                  {ROLE_INFO[r].short}
                </button>
              ))}
            </div>
          )}
          <div className="rounded-2xl border border-white/10 bg-black/55 p-4 shadow-xl backdrop-blur">
            <div className="flex items-center gap-3">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-white/15 bg-black/40" style={{ color: myTeam?.color }}>
                <RoleIcon role={currentRole} className="h-8 w-8" />
              </span>
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.18em] text-white/60">You control</div>
                <div className="truncate text-xl font-black" style={{ color: myTeam?.color }}>
                  {ROLE_INFO[currentRole].label}
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              {ROLE_INFO[currentRole].keys.map((k) => (
                <div key={k.key} className="contents">
                  <kbd className="whitespace-nowrap rounded bg-white/15 px-1.5 py-0.5 font-mono text-xs font-bold">{k.key}</kbd>
                  <span className="text-white/80">{k.does}</span>
                </div>
              ))}
              {myRoles.length > 1 && (
                <div className="contents">
                  <kbd className="rounded bg-white/15 px-1.5 py-0.5 font-mono text-xs font-bold">Tab / 1-5</kbd>
                  <span className="text-white/80">Switch body part</span>
                </div>
              )}
            </div>
            {(currentRole === "torso" || currentRole === "head") && !pointerLocked && phase !== "lobby" && <div className="mt-2 text-xs font-bold text-[#edb200]">Click the game to capture the mouse</div>}
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
          teamColor={myTeam?.color ?? "#edb200"}
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
          {hud.fallen && <div className="flex items-center gap-2 rounded-xl bg-[#d33a2c] px-4 py-2 font-black shadow-lg"><RotateIcon className="h-4 w-4" /> Fallen — Torso: hold Brace to get up</div>}
          {hud.hanging && <div className="rounded-xl bg-[#2b4bff] px-4 py-2 font-black shadow-lg">Hanging — Arms: pull down · Legs: step</div>}
          {hud.holding > 0 && !hud.hanging && <div className="rounded-xl bg-[#2fa84f] px-4 py-2 font-black text-[#06130b] shadow-lg">Holding — Arms: throw when ready</div>}
          {hud.crouch && <div className="rounded-xl bg-black/55 px-3 py-1 text-sm font-bold">Crouching</div>}
          {iControlBrace && hud.brace < 1 && (
            <div
              className="w-40 rounded-full bg-black/55 p-1"
              role="meter"
              aria-label="Brace stamina"
              aria-valuenow={Math.round(hud.brace * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="h-2 rounded-full bg-[#edb200] transition-all" style={{ width: `${hud.brace * 100}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Toasts */}
      <div role="status" aria-live="polite" className="game-toast-stack pointer-events-none absolute left-1/2 top-[22%] z-30 flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={`toast game-toast game-toast--${t.tone}`}>
            {t.text}
          </div>
        ))}
        {finishToast && (
          <div
            className="toast game-toast game-toast--finish flex items-center gap-2"
            style={{ "--toast-color": finishToast.color } as CSSProperties}
          >
            <FlagIcon className="h-4 w-4" />
            {finishToast.team} finished in {formatTime(finishToast.time)}
          </div>
        )}
      </div>

      {/* Countdown */}
      {countdown !== null && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center" role="status" aria-live="polite">
          <div key={countdown} aria-label={countdown === 0 ? "Go" : `Starting in ${countdown}`} className="countdown meet-tabular text-[7rem] font-bold drop-shadow-[0_6px_0_rgba(0,0,0,0.45)] sm:text-[10rem]" style={{ color: countdown === 0 ? "#2fa84f" : "#edb200" }}>
            {countdown === 0 ? "GO!" : countdown}
          </div>
        </div>
      )}

      {/* Finish banner (mine) */}
      {myFinish != null && phase === "playing" && (
        <div className="pointer-events-none absolute inset-x-0 top-[30%] z-30 flex flex-col items-center">
          <div className="countdown text-4xl font-black text-[#edb200] drop-shadow-[0_5px_0_rgba(0,0,0,0.45)] sm:text-6xl">
            {myStanding ? `#${myStanding.place} FINISH` : "FINISHED"}
          </div>
          <div className="meet-tabular mt-2 text-3xl font-bold">{formatTime(myFinish)}</div>
          <div className="mt-1 text-white/80">Waiting for other teams…</div>
        </div>
      )}

      {/* Lobby panel — flat scoresheet, four compact steps, RHS dock kept */}
      {room && me && phase === "lobby" && (
        <div className="game-lobby-panel lobby-sheet absolute inset-y-0 right-0 z-20 flex w-full max-w-[440px] touch-pan-y scroll-pb-48 flex-col gap-2 overflow-y-auto p-3 pt-20">
          <div className="lobby-heat-plate rounded-xl p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="lobby-step-title">ROOM</span>
                <span className="meet-tabular lobby-code truncate text-2xl font-bold tracking-[0.18em]">{code}</span>
              </div>
              <button
                onClick={() => {
                  const link = `${location.origin}/play/${code}`;
                  // Clipboard API can be missing/rejecting on non-secure origins
                  // (LAN play). Fall back to a legacy execCommand copy.
                  const fallbackCopy = () => {
                    try {
                      const ta = document.createElement("textarea");
                      ta.value = link;
                      ta.style.position = "fixed";
                      ta.style.opacity = "0";
                      document.body.appendChild(ta);
                      ta.select();
                      const ok = document.execCommand("copy");
                      ta.remove();
                      return ok;
                    } catch {
                      return false;
                    }
                  };
                  if (navigator.clipboard?.writeText) {
                    navigator.clipboard
                      .writeText(link)
                      .then(() => addToast("Invite link copied!", "good"))
                      .catch(() => {
                        if (fallbackCopy()) addToast("Invite link copied!", "good");
                        else addToast(`Copy failed — invite link: ${link}`, "bad");
                      });
                  } else if (fallbackCopy()) {
                    addToast("Invite link copied!", "good");
                  } else {
                    addToast(`Copy failed — invite link: ${link}`, "bad");
                  }
                }}
                aria-label="Copy invite link"
                title="Copy invite link"
                className="lobby-quiet-btn flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold"
              >
                <CopyIcon className="h-4 w-4" />
                Invite
              </button>
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-xs font-bold">
              <span className={`h-2 w-2 shrink-0 rounded-full ${competitive ? "bg-[#1e7a3c]" : "bg-[#8a5e00]"}`} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">
                {competitive ? `${activeTeams.length} teams in` : solo ? "Solo practice — one body, all yours" : "Add a rival team for head-to-head"}
              </span>
              <span className="meet-tabular lobby-count shrink-0 text-xs">
                {room.players.filter((p) => p.ready).length}/{room.players.length} ready · {room.squadSize}P · {challenge.name}
              </span>
            </div>
          </div>

          {/* Step 1 — Squad size */}
          <div className="lobby-card rounded-xl p-3">
            <div className="lobby-step">
              <span className="lobby-step-no">SQUAD</span>
              <span className="lobby-step-title">{isLeader ? "YOU PICK" : `${room.squadSize} PLAYERS`}</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {([3, 5] as SquadSize[]).map((n) => (
                <button
                  key={n}
                  disabled={!isLeader || (n === 3 && threePlayerRosterTooLarge)}
                  onClick={() => netRef.current?.setSquad(n)}
                  title={n === 3 && threePlayerRosterTooLarge ? "A team has more than 3 players" : undefined}
                  aria-pressed={room.squadSize === n}
                  className={`lobby-squad rounded-lg px-2.5 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-45 ${room.squadSize === n ? "is-selected" : ""}`}
                >
                  <span className="font-black leading-tight">{n} players <span className="lobby-event-sub text-xs font-bold">{n === 3 ? "· Arms · Torso · Legs" : "· Hands · Torso · Legs"}</span></span>
                </button>
              ))}
            </div>
            {threePlayerRosterTooLarge && (
              <div className="lobby-note mt-1.5 text-xs">
                3-player mode needs every team at 3 or fewer players first.
              </div>
            )}
          </div>

          {/* Step 2 — Challenge */}
          <div className="lobby-card rounded-xl p-3">
            <div className="lobby-step">
              <span className="lobby-step-no">HEAT</span>
              <span className="lobby-step-title">{isLeader ? "YOU PICK" : challenge.name.toUpperCase()}</span>
            </div>
            <div className="flex flex-col gap-1">
              {CHALLENGES.map((c) => (
                <button
                  key={c.id}
                  disabled={!isLeader}
                  onClick={() => netRef.current?.setChallenge(c.id)}
                  aria-pressed={room.challengeId === c.id}
                  className={`lobby-event flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left ${room.challengeId === c.id ? "is-selected" : ""}`}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-black/[0.07]">
                    <ChallengeIcon challenge={c} className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-black leading-tight">
                      {c.name} <span className={`diff diff-${c.difficulty} ml-1`}>{c.difficulty}</span>
                    </span>
                    <span className="lobby-event-sub block truncate text-xs">{c.tagline}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Step 3 — Teams: my squad expanded, rivals collapsed to one line */}
          <div className="lobby-step px-1">
            <span className="lobby-step-no">CREW</span>
            <span className="lobby-step-title">TEAMS &amp; ROLES</span>
          </div>
          {room.teams.map((t) => {
            const members = room.players.filter((p) => p.teamId === t.id);
            const mine = t.id === me.teamId;
            const filled = squadRoles(room.squadSize).filter((r) => members.some((m) => m.roles.includes(r))).length;
            const readyCount = members.filter((m) => m.ready).length;
            if (!mine) {
              return (
                <div key={t.id} className="lobby-lane flex items-center gap-2 rounded-xl px-3 py-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-sm font-black">{t.name}</span>
                  <span className="meet-tabular lobby-count shrink-0 text-xs">
                    {members.length}/{room.squadSize} · {filled}/{room.squadSize} joints · {readyCount} ready
                  </span>
                  {members.length < room.squadSize ? (
                    <button onClick={() => netRef.current?.joinTeam(t.id)} className="lobby-quiet-btn shrink-0 rounded-md px-2.5 py-1.5 text-xs font-bold">
                      Join
                    </button>
                  ) : (
                    <span className="lobby-count shrink-0 rounded bg-black/[0.05] px-2 py-1 text-xs font-bold">Full</span>
                  )}
                </div>
              );
            }
            return (
              <div key={t.id} className="lobby-lane rounded-xl p-3" style={{ ["--lane-color" as string]: t.color, borderColor: t.color }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color }} />
                    {isHost ? <TeamNameEditor key={t.name} name={t.name} onRename={renameMyTeam} /> : <span className="truncate text-sm font-black">{t.name}</span>}
                    <span className="lobby-quiet-btn shrink-0 rounded px-1.5 py-0.5 text-xs font-black uppercase tracking-wide">You</span>
                    <span className="meet-tabular lobby-count shrink-0 text-xs">
                      {members.length}/{room.squadSize} · {filled}/{room.squadSize}
                    </span>
                  </div>
                </div>
                <div className={`mt-2 grid gap-1 ${room.squadSize === 3 ? "grid-cols-3" : "grid-cols-5"}`}>
                  {squadRoles(room.squadSize).map((r) => {
                    const owner = members.find((m) => m.roles.includes(r));
                    const isMe = owner?.id === me.id;
                    return (
                      <button
                        key={r}
                        onClick={() => netRef.current?.setRole(r)}
                        title={ROLE_INFO[r].blurb}
                        aria-pressed={isMe}
                        aria-label={`${ROLE_INFO[r].label}${owner ? `, taken by ${owner.name}` : ", free"}`}
                        className={`lobby-joint flex flex-col items-center rounded-lg px-1 py-1.5 text-center ${isMe ? "is-mine" : ""}`}
                        style={{ ["--lane-color" as string]: t.color }}
                      >
                        <RoleIcon role={r} className="h-4 w-4" />
                        <span className="mt-0.5 text-xs font-black uppercase tracking-wide">{ROLE_INFO[r].short}</span>
                        <span className="lobby-joint-sub mt-0 line-clamp-1 text-xs">{owner ? owner.name : "Free"}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {members.map((m) => (
                    <span key={m.id} className={`member-chip flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${m.ready ? "is-ready" : ""}`}>
                      {m.ready && <CheckIcon className="h-3 w-3" />}
                      {m.name}
                      {m.id === t.hostId ? <span className="opacity-60">· host</span> : null}
                    </span>
                  ))}
                  {members.length === 0 && <span className="lobby-note text-xs">No one here yet — pick a joint.</span>}
                </div>
              </div>
            );
          })}
          <button
            data-testid="new-rival-team"
            disabled={room.teams.length >= TEAM_COLORS.length || solo}
            onClick={() => netRef.current?.createTeam()}
            className="lobby-quiet-btn flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-black/25 py-1.5 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            {solo ? "Solo practice uses one team" : room.teams.length >= TEAM_COLORS.length ? "Maximum 6 teams" : "New rival team"}
          </button>

          <div className="lobby-action-bar sticky bottom-0 flex flex-col gap-1.5 rounded-xl p-2.5">
            <div className="lobby-step px-1">
              <span className="lobby-step-no">READY</span>
              <span className="lobby-step-title">START THE HEAT</span>
            </div>
            <div className="flex gap-2">
              <button onClick={toggleReady} aria-pressed={ready} className={`lobby-ready flex items-center justify-center gap-1.5 flex-1 rounded-lg py-2.5 text-base font-black ${ready ? "" : "is-armed"}`}>
                {ready && <CheckIcon className="h-4 w-4" />}
                {ready ? "READY" : "READY UP"}
              </button>
              {isLeader && (
                <button
                  onClick={() => {
                    ensureAudio();
                    netRef.current?.startRound(!allReady);
                  }}
                  className={`lobby-start flex-1 rounded-lg py-2.5 text-base font-black ${allReady ? "is-go" : ""}`}
                >
                  {allReady ? (competitive ? "START RACE" : "START PRACTICE") : "Start anyway"}
                </button>
              )}
            </div>
            <div className="lobby-note text-center text-xs">
              {isLeader ? "You are the room leader." : `Waiting for ${room.players.find((p) => p.id === room.leaderId)?.name ?? "leader"} to start.`} The course is live while you wait.
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {room && phase === "results" && (
        <div className="game-results-overlay absolute inset-0 z-30 flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm sm:p-4">
          <div className="game-results-panel max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl touch-pan-y overflow-y-auto rounded-3xl border border-white/10 bg-[#121a33] p-4 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:p-6">
            <div className="text-center">
              <div className="text-xs uppercase tracking-[0.3em] text-white/60">{challenge.name}</div>
              <div className="meet-tabular text-4xl font-bold tracking-wide">RESULTS</div>
            </div>
            <div className="mt-5 grid gap-6 md:grid-cols-2">
              <div>
                <div className="mb-2 text-xs uppercase tracking-widest text-white/60">This room · round results</div>
                <div className="flex flex-col gap-2">
                  {sortedTeams.map((t, i) => (
                    <div key={t.id} className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ background: i === 0 && t.finishMs != null ? t.color : "rgba(255,255,255,0.06)", color: i === 0 && t.finishMs != null ? "#14100a" : "#fff" }}>
                      <div className="meet-tabular w-10 shrink-0 text-2xl font-bold">{i === 0 && t.finishMs != null ? "1ST" : `#${i + 1}`}</div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-black">{t.name}</div>
                        <div className="truncate text-xs opacity-70">{room.players.filter((p) => p.teamId === t.id).map((p) => p.name).join(", ")}</div>
                      </div>
                      <div className="meet-tabular shrink-0 text-xl font-bold">{t.finishMs != null ? formatTime(t.finishMs) : "DNF"}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs uppercase tracking-widest text-white/60">Historical leaderboard</span>
                  <span className="flex gap-1">
                    {([3, 5] as SquadSize[]).map((n) => (
                      <button
                        key={n}
                        onClick={() => setBoardSquad(n)}
                        aria-pressed={boardSquad === n}
                        className={`rounded-lg px-2 py-0.5 text-xs font-black ${boardSquad === n ? "bg-[#2fa84f] text-[#06130b]" : "bg-white/10 text-white/70 hover:bg-white/20"}`}
                      >
                        {n}P
                      </button>
                    ))}
                  </span>
                </div>
                <div className="mb-2 text-xs text-white/45">
                  Complete non-practice squads are ranked separately for every game and squad size.
                </div>
                <div className="flex max-h-80 flex-col gap-3 overflow-y-auto pr-1">
                  {leaderboardSections.map(({ challenge: boardChallenge, rows }) => (
                    <section key={boardChallenge.id} aria-label={`${boardChallenge.name} leaderboard`}>
                      <div className="mb-1 flex items-center gap-1.5 text-xs font-black">
                        <ChallengeIcon challenge={boardChallenge} className="h-4 w-4" />
                        <span>{boardChallenge.name}</span>
                        {room.challengeId === boardChallenge.id && (
                          <span className="rounded bg-[#edb200]/15 px-1.5 py-0.5 text-xs uppercase tracking-wider text-[#edb200]">Current</span>
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        {rows.length === 0 && <div className="rounded-lg bg-white/[0.03] px-2 py-1 text-xs text-white/40">No times yet — be the first crew on the board.</div>}
                        {rows.map((row, i) => {
                          const isUs = room.challengeId === boardChallenge.id && !!myTeam && row.teamName === myTeam.name && myFinish != null && row.timeMs === myFinish;
                          return (
                            <div key={row.id} className={`flex items-center gap-2 rounded-lg px-2 py-1 text-sm ${isUs ? "bg-[#edb200] text-[#1a1405]" : "bg-white/5"}`}>
                              <span className="meet-tabular w-6 font-bold">{i + 1}</span>
                              <span className="min-w-0 flex-1 truncate">
                                <span className="font-bold">{row.teamName}</span> <span className="text-xs opacity-60">{(row.players ?? []).join(", ")}</span>
                              </span>
                              <span className="meet-tabular font-bold">{formatTime(row.timeMs)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-6 flex flex-col items-center gap-2">
              {isLeader ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <button onClick={() => netRef.current?.startRound(true)} className="flex items-center gap-2 rounded-xl bg-[#edb200] px-6 py-3 text-lg font-black text-[#1a1405] hover:brightness-105">
                    <RotateIcon className="h-5 w-5" />
                    Play again
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
