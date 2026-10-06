"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { CHALLENGES, ROLE_INFO, TEAM_COLORS, formatTime, squadRoles, type Role, type RoleInput, type RoomSnapshot, type SquadSize } from "@/game/types";
import { SOLO_SQUAD } from "@/game/squad";
import type { Game, HudState, Snap } from "@/game/game";
import { createNet, type GameNet } from "@/game/net";
import { inviteUrl, isLoopbackHost } from "@/game/server-address";
import type { LinkGrade } from "@/game/timing";
import { MAX_TEAM_NAME_LENGTH, isTeamNameTaken, topScoreRows, type ScoreRow as LeaderboardRow } from "@/game/scores";
import { InputManager, inputsEqual, sampleLocalTeamInput, SOLO_ROLES } from "@/game/joint-input";
import { getLevel } from "@/game/levels";
import {
  COUNTDOWN_FALLBACK_MS,
  PendingSnapshotBuffer,
  countdownShown,
  nextCountdownDelayMs,
  planPlayingTransition,
  rosterKey,
  routeSnapshot,
} from "@/game/room-round";
import { ghostStandings, trackGhostProgress, type LiveTeamProgress } from "@/game/ghost-snapshot";
import { INPUT_CHANGE_SEND_INTERVAL_MS, INPUT_REFRESH_INTERVAL_MS } from "@/game/timing";
import MobileControls from "@/components/MobileControls";
import DummyAssembly from "@/components/onboarding/DummyAssembly";
import { burstConfetti } from "@/components/onboarding/confetti";
import { ChallengeIcon, CheckIcon, CopyIcon, FlagIcon, PlusIcon, RoleIcon, RotateIcon, SoundOffIcon, SoundOnIcon } from "@/components/icons";

interface Toast {
  id: number;
  text: string;
  tone: "good" | "bad" | "info";
}

type ConnectionState = "connecting" | "online" | "reconnecting" | "restored";

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

/** "L HAND" → "L hand": role shorts are stored shouty for the lobby joints. */
const sentenceCase = (text: string) => text.charAt(0) + text.slice(1).toLowerCase();

const ordinal = (n: number) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
};

/** Free-for-all drives every joint from one keyboard. */
const SOLO_KEYS: [string, string][] = [
  ["W A S D", "Walk and strafe"],
  ["Mouse", "Steer the camera"],
  ["Arrows", "Raise, lower and swing arms"],
  ["E", "Hold to grab with both hands"],
  ["Q / R", "Grab with one hand"],
  ["Space", "Jump"],
  ["Shift", "Throw what you hold"],
  ["C", "Hold to crouch"],
  ["B", "Hold to brace, or to get up"],
];

function getName() {
  return localStorage.getItem("singularity_name") || `Player${Math.floor(Math.random() * 90 + 10)}`;
}

export default function GameClient({
  code,
  solo,
  offline,
}: {
  code: string;
  solo: boolean;
  /** Single-tab practice: no game server. */
  offline: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const netRef = useRef<GameNet | null>(null);
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
  const pendingSnapshotsRef = useRef(new PendingSnapshotBuffer());
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
  const [loaderGone, setLoaderGone] = useState(false);
  const [serverUnreachable, setServerUnreachable] = useState<string | null>(null);
  const [lanAddress, setLanAddress] = useState<string | null>(null);
  const [link, setLink] = useState<{ grade: LinkGrade; rttMs: number | null }>({ grade: "good", rttMs: null });
  const linkRef = useRef(link);
  useEffect(() => {
    linkRef.current = link;
  }, [link]);
  const [liveProgress, setLiveProgress] = useState<Record<number, LiveTeamProgress>>({});

  const me = useMemo(() => room?.players.find((p) => p.id === myId) ?? null, [room, myId]);
  const myTeam = useMemo(() => room?.teams.find((t) => t.id === me?.teamId) ?? null, [room, me]);
  // Free-for-all: the server flag once we are in the room (the leader can switch
  // modes in the lobby); until then the URL flag (?solo=1) we joined with.
  const soloMode = me ? me.solo : solo;
  const isLeader = !!room && !!me && room.leaderId === me.id;
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
      if (!room || !myTeam) return false;
      if (isTeamNameTaken(room.teams, myTeam.id, name)) {
        addToast("That team name is already taken.", "bad");
        return false;
      }
      netRef.current?.renameTeam(name);
      addToast(`Team renamed to ${name}.`, "good");
      return true;
    },
    [room, myTeam, addToast]
  );

  const recordTeamProgress = useCallback((teamId: number, snap: Snap) => {
    const currentRoom = roomRef.current;
    if (!currentRoom || (currentRoom.phase !== "countdown" && currentRoom.phase !== "playing")) return;
    setLiveProgress((current) => {
      const tracked = trackGhostProgress(getLevel(currentRoom.challengeId), snap, current[teamId]);
      if (tracked.keep) return current;
      return { ...current, [teamId]: tracked.next };
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
    const net = createNet({ code, name, solo, offline });
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
        const myT = r?.players.find((p) => p.id === netRef.current?.myId)?.teamId;
        const route = routeSnapshot(teamId, myT, !!g && !!r);
        if (route === "buffer" || !g || !r) {
          pendingSnapshotsRef.current.set(teamId, snap);
          return;
        }
        if (route === "own") {
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
      onUnreachable: (uri) => setServerUnreachable(uri),
      onConnectionChange: (ok) => {
        clearRecoveryTimer();
        if (ok) setServerUnreachable(null);
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
      onLinkQuality: (grade, rttMs) => setLink({ grade, rttMs }),
    });
    net.connect();
    const input = new InputManager();
    inputRef.current = input;
    input.onRoleSwitch = (dir, idx) => {
      // Solo practice drives the whole body at once — no body-part switching.
      // The server flag wins once joined: the leader can switch modes in the lobby.
      const soloPlayer = roomRef.current?.players.find((p) => p.id === netRef.current?.myId)?.solo ?? solo;
      if (soloPlayer) return;
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
  }, [code, solo, offline, recordTeamProgress]);

  // Self-hosting: a player browsing on localhost would copy an invite that
  // points at each friend's own machine; ask the local Next server for this
  // machine's LAN address instead. (Online play is never on loopback.)
  useEffect(() => {
    if (offline || !isLoopbackHost(location.hostname)) return;
    let cancelled = false;
    fetch("/api/host-info")
      .then((res) => (res.ok ? res.json() : null))
      .then((info: { lanAddresses?: string[] } | null) => {
        if (!cancelled) setLanAddress(info?.lanAddresses?.[0] ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [offline]);

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
      const bufferedOwnSnapshot = pendingSnapshotsRef.current.take(teamId);
      if (bufferedOwnSnapshot) g.applyOwnSnapshot(bufferedOwnSnapshot);
      g.setHost(latestTeam.hostId === latestMe.id);
      for (const [pendingTeamId, pendingSnapshot] of pendingSnapshotsRef.current.takeAll()) {
        const pendingTeam = latestRoom.teams.find((team) => team.id === pendingTeamId);
        if (pendingTeam) g.applyGhostSnapshot(pendingTeamId, pendingTeam.color, pendingTeam.name, pendingSnapshot);
      }
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
    const nextRosterKey = rosterKey(room.players);
    if (nextRosterKey !== rosterKeyRef.current) {
      rosterKeyRef.current = nextRosterKey;
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
        const startAt = room.startAt ?? net.serverNow() + COUNTDOWN_FALLBACK_MS;
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
          const n = countdownShown(remaining);
          if (lastShown !== n) g.audio.beep(false);
          lastShown = n;
          setCountdown(n);
          goTimerRef.current = setTimeout(tick, nextCountdownDelayMs(remaining));
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
  // Solo practice combines controls: one keyboard/mouse/touch state drives
  // arms + torso + legs together, so there is no active-role switching.
  const soloRef = useRef(soloMode);
  useEffect(() => {
    soloRef.current = soloMode;
  }, [soloMode]);
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
      const isSolo = soloRef.current;
      const roles = isSolo ? [...SOLO_ROLES] : meNow.roles;
      const idx = Math.min(activeRoleRef.current, Math.max(0, roles.length - 1));
      const active = roles[idx];
      input.enabled = r.phase !== "results";
      // One seam for every Joint press: camera rule, solo channels, and
      // active-role gating all live inside the intake module.
      const payload = sampleLocalTeamInput(input, { solo: isSolo, roles, activeRole: active, dt });
      let changed = false;
      if (g.isHost) g.localInputs = {};
      for (const role of roles) {
        const inp = payload[role]!;
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

  // Dev-only introspection for automated playtests (key state + hold state).
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const id = setInterval(() => {
      const input = inputRef.current;
      const g = gameRef.current;
      (window as unknown as { __singularityDebug?: unknown }).__singularityDebug = {
        keys: input ? [...input.keys] : [],
        solo: soloRef.current ? input?.readSolo() : undefined,
        holding: g ? (g as unknown as { body?: { holds?: unknown[] } }).body?.holds?.length ?? null : null,
        fallen: (g as unknown as { body?: { fallen?: boolean } })?.body?.fallen ?? null,
        pelvis: (() => {
          try {
            const parts = (g as unknown as { body?: { parts?: { translation(): { x: number; y: number; z: number } }[] } }).body?.parts;
            const t = parts?.[0]?.translation();
            if (t) return [t.x, t.y, t.z];
            // Teammates do not simulate: report the host's latest relayed pose.
            const relayed = g?.ownBuffer[g.ownBuffer.length - 1]?.snap.p;
            return relayed ? [relayed[0], relayed[1], relayed[2]] : null;
          } catch {
            return null;
          }
        })(),
        isHost: g?.isHost ?? null,
        // Teammate inputs as the team host received them from the room server.
        remote: g?.remoteInputs ?? null,
        phase: roomRef.current?.phase ?? null,
        round: roomRef.current?.round ?? null,
        // Jitter buffer the replica is currently running, and the link grade the player sees.
        interpDelayMs: g ? Math.round(g.ownTimeline.currentDelayMs) : null,
        replicaFrames: g?.replicaFrames ?? 0,
        replicaStarvedFrames: g?.replicaStarvedFrames ?? 0,
        renderLevel: g?.renderQuality.level ?? null,
        link: linkRef.current,
      };
    }, 250);
    return () => clearInterval(id);
  }, []);

  // Solo practice is locked to the combined 3-channel body. If the room is
  // still on another squad size (legacy room, slow subscription), coerce it
  // once when we are the leader.
  const soloSquadFixRef = useRef(false);
  useEffect(() => {
    if (!soloMode || !room || !me || !isLeader) return;
    if (room.phase !== "lobby" || room.squadSize === SOLO_SQUAD) {
      return;
    }
    if (soloSquadFixRef.current) return;
    soloSquadFixRef.current = true;
    netRef.current?.setSquad(SOLO_SQUAD);
  }, [soloMode, room, me, isLeader]);

  // ---------- actions ----------
  const inviteFriends = (button: HTMLElement) => {
    const link = inviteUrl({ origin: location.origin, hostname: location.hostname, code, lanAddress });
    const copied = () => {
      addToast("Invite link copied!", "good");
      burstConfetti(button);
    };
    // Clipboard API can be missing/rejecting on non-secure origins
    // (self-hosted LAN play). Fall back to a legacy execCommand copy.
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
    const copy = () => {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard
          .writeText(link)
          .then(copied)
          .catch(() => {
            if (fallbackCopy()) copied();
            else addToast(`Copy failed — invite link: ${link}`, "bad");
          });
      } else if (fallbackCopy()) {
        copied();
      } else {
        addToast(`Copy failed — invite link: ${link}`, "bad");
      }
    };
    // Phones get the native share sheet (Messages, WhatsApp…); desktops copy.
    if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
      navigator
        .share({ title: "Join my Singularity room", text: `Room ${code}: five players, one body.`, url: link })
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) copy();
        });
      return;
    }
    copy();
  };
  const toggleReady = () => {
    ensureAudio();
    const next = !ready;
    netRef.current?.setReady(next);
  };
  const onCanvasClick = () => {
    ensureAudio();
    const hasFinePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (hasFinePointer && (soloMode || myRoles.includes("torso") || myRoles.includes("head")) && room?.phase !== "lobby") inputRef.current?.requestPointerLock();
  };

  const allReady = !!room && room.players.length > 0 && room.players.every((p) => p.ready);
  const phase = room?.phase ?? "lobby";
  const activeTeams = useMemo(
    () => room?.teams.filter((team) => room.players.some((player) => player.teamId === team.id)) ?? [],
    [room]
  );
  const standings = useMemo(() => ghostStandings(activeTeams, liveProgress), [activeTeams, liveProgress]);
  const sortedTeams = standings.map((standing) => standing.team);
  const myStanding = standings.find((standing) => standing.team.id === myTeam?.id) ?? null;
  const competitive = activeTeams.length > 1;
  // Brace is consumed by whoever plays Torso — show the stamina meter to that
  // player (host or not), since they're the one told to "hold BRACE to get up".
  // Solo always drives Torso as part of the combined body.
  const iControlBrace = soloMode || myRoles.includes("torso") || myRoles.includes("head");
  const level = room ? getLevel(room.challengeId) : null;
  const ffaRosterTooLarge = !!room && room.players.length > TEAM_COLORS.length;
  const threePlayerRosterTooLarge = !!room && room.teams.some(
    (team) => room.players.filter((player) => player.teamId === team.id).length > 3
  );
  const leaderboardSections = useMemo(
    () => CHALLENGES.map((entry) => ({
      challenge: entry,
      rows: topScoreRows(leaderboard, entry.id, boardSquad, 5),
    })),
    [leaderboard, boardSquad]
  );

  // Keep the loader up briefly once ready so the last limb visibly snaps on.
  const loaderDone = !!room && gameReady;
  useEffect(() => {
    if (!loaderDone) return;
    const t = window.setTimeout(() => setLoaderGone(true), 800);
    return () => window.clearTimeout(t);
  }, [loaderDone]);

  return (
    <div className="game-shell relative h-dvh w-full overflow-hidden bg-[#0c1122] text-white select-none">
      <canvas ref={canvasRef} onClick={onCanvasClick} className="game-canvas absolute inset-0 block h-full w-full" style={{ width: "100%", height: "100%" }} />

      {/* Loading bridge: the dummy is assembled on a test stand as each real stage lands. */}
      {!(loaderDone && loaderGone) && (
        <div className={`lab-loader ${loaderDone ? "is-done" : ""}`}>
          <div className="lab-loader-curtain" aria-hidden="true" />
          <div className="lab-loader-card">
            <DummyAssembly stage={!room ? 0 : !gameReady ? 1 : 2} />
            <div className="min-w-0">
              <h2 className="lab-loader-title">{loaderDone ? "Body assembled" : "Assembling your body"}</h2>
              <span className="lab-loader-code">{code}</span>
              <p className="lab-loader-status" role="status" aria-live="polite">
                {room
                  ? gameReady
                    ? "Ready. Dropping you in."
                    : "Joined the room. Loading physics and the course…"
                  : connectionState === "reconnecting"
                    ? "Reconnecting to the match…"
                    : "Connecting to room…"}
              </p>
              <p className="lab-loader-tip">
                {challenge.id === "ferry-job" || challenge.id === "summit-sync"
                  ? "Both hands hold grab together. One hand alone won't lift it."
                  : challenge.id === "wobble-run"
                    ? "Legs take turns: left, then right. Both at once and you face-plant."
                    : "If you fall, Torso holds brace to stand back up."}
              </p>
            </div>
          </div>
        </div>
      )}

      {!offline && connectionState === "online" && link.grade === "poor" && phase !== "lobby" && (
        <div className="game-connection-status game-connection-status--unstable" role="status" aria-live="polite" data-testid="connection-unstable">
          <span className="game-connection-dot" aria-hidden="true" />
          <span>
            <strong>Connection unstable</strong>
            <span>Moves may lag a little; stay close to your router or a strong signal</span>
          </span>
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
            <strong>{connectionState === "reconnecting" ? "Reconnecting…" : "Reconnected"}</strong>
            <span>{connectionState === "reconnecting" ? "Hang tight, your seat is saved" : "You're back in the match"}</span>
          </span>
        </div>
      )}

      {serverUnreachable && !room && (
        <div className="lab-loader" style={{ zIndex: 60 }} role="alert">
          <div className="lab-loader-card">
            <DummyAssembly stage={-1} />
            <div className="min-w-0">
              <h1 className="lab-loader-title">Can&apos;t reach the game</h1>
              <p className="lab-loader-note">
                {navigator.onLine
                  ? "The game server isn't answering right now. We'll keep trying in the background, or you can practice on your own meanwhile."
                  : "You look offline. Check your Wi-Fi or mobile data; we'll reconnect as soon as you're back."}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <a href={`/play/${code}?offline=1${solo ? "&solo=1" : ""}`} className="lab-btn lab-btn--go" style={{ fontSize: "1.05rem" }}>
                  Practice offline
                </a>
                <button onClick={() => location.reload()} className="lab-btn lab-btn--plain" style={{ fontSize: "1.05rem" }}>
                  Retry connection
                </button>
                <Link href="/" className="lab-btn lab-btn--plain" style={{ fontSize: "1.05rem" }}>
                  Return to landing
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {roomUnavailable && (
        <div className="lab-loader" style={{ zIndex: 60 }} role="alert">
          <div className="lab-loader-card">
            <DummyAssembly stage={-1} />
            <div className="min-w-0">
              <h1 className="lab-loader-title">Room unavailable</h1>
              <p className="lab-loader-note">
                {connectionState === "reconnecting"
                  ? "We lost the connection to the game. Check your connection and try again."
                  : `Room ${code} is mid-race or no longer open. Check the invite code, or start a new room and invite your friends.`}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/" className="lab-btn lab-btn--go" style={{ fontSize: "1.05rem" }}>
                  Return to landing
                </Link>
                <button onClick={() => location.reload()} className="lab-btn lab-btn--plain" style={{ fontSize: "1.05rem" }}>
                  Retry connection
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top bar — above the lobby dock so room/mute stay clickable pre-race. */}
      <div className="game-top-bar pointer-events-none absolute top-0 left-0 right-0 z-30 flex items-start justify-between p-2 sm:p-4">
        <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-2">
          <Link href="/" className="hud-chip hud-chip--btn" aria-label="Back to landing">
            <span aria-hidden="true">←</span> Leave
          </Link>
          <div className="hud-chip">
            <span className="hidden sm:inline">Room</span>
            <span className="hud-code">{code}</span>
          </div>
          {!offline && room && (
            <div
              className="hud-chip hud-signal"
              data-grade={connectionState === "reconnecting" ? "poor" : link.grade}
              role="img"
              aria-label={`Connection ${connectionState === "reconnecting" ? "lost" : link.grade === "good" ? "good" : link.grade === "fair" ? "okay" : "unstable"}`}
              title={link.rttMs != null ? `Round trip ${Math.round(link.rttMs)} ms` : "Measuring connection"}
              data-testid="connection-signal"
            >
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
            </div>
          )}
        </div>
        {/* Timer: a scoreboard sticker. Ink plate for the clock, paper strip for the job. */}
        {phase !== "lobby" && (
          <div className="game-timer absolute left-1/2 top-14 flex -translate-x-1/2 flex-col items-center sm:static sm:translate-x-0">
            <div className="hud-timer">
              <div className="hud-timer-clock meet-tabular">{formatTime((myFinish ?? (hud?.timer ?? 0) * 1000) || 0)}</div>
              <div className="hud-timer-job">
                <ChallengeIcon challenge={challenge} className="h-4 w-4 shrink-0" />
                <span className="truncate">{level?.objective}</span>
                {hud && hud.scoreTarget > 0 && (
                  <span className="hud-timer-score meet-tabular">
                    {hud.score}/{hud.scoreTarget}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
        {/* In the lobby the sound toggle lives on the room card instead. */}
        <div className={`pointer-events-auto flex items-center gap-2 ${room && me && phase === "lobby" ? "invisible" : ""}`}>
          <button
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? "Unmute game audio" : "Mute game audio"}
            aria-pressed={muted}
            title={muted ? "Sound off" : "Sound on"}
            className="hud-chip hud-chip--btn"
          >
            {muted ? <SoundOffIcon className="h-4 w-4" /> : <SoundOnIcon className="h-4 w-4" />}
            <span className="hidden sm:inline">{muted ? "Muted" : "Sound"}</span>
          </button>
        </div>
      </div>

      {/* Race rail — RHS during gameplay only. The lobby's sticker card, shrunk to a standings board. */}
      {room && phase !== "lobby" && phase !== "results" && (
        <div data-testid="team-standings" className="game-team-status pointer-events-none absolute right-2 top-28 z-20 flex max-h-[50dvh] w-52 max-w-[52vw] flex-col overflow-hidden sm:right-4 sm:top-20 sm:w-64">
          <div className="race-rail pointer-events-auto flex min-h-0 flex-col">
            <div className="race-rail-head">
              <span className="race-rail-title">Standings</span>
              <span className="race-rail-round meet-tabular">Round {room.round}</span>
            </div>
            <ol className="race-rail-rows">
              {standings.map((standing) => {
                const t = standing.team;
                const isMine = t.id === myTeam?.id;
                const done = t.finishMs != null;
                const status = done
                  ? formatTime(t.finishMs!)
                  : level?.targetScore
                    ? `${standing.score}/${level.targetScore}`
                    : `${Math.round(standing.progress * 100)}%`;
                return (
                  <li
                    key={t.id}
                    data-testid={`team-standing-${t.id}`}
                    className={`race-row ${isMine ? "is-mine" : ""} ${done ? "is-done" : ""}`}
                    style={{ "--team": t.color } as CSSProperties}
                  >
                    <span className="race-place">{standing.place}</span>
                    <span className="race-swatch" aria-hidden="true" />
                    <span className="game-team-name race-name">
                      {t.name}
                      {isMine && <span className="sr-only"> (your team)</span>}
                    </span>
                    {standing.fallen && !done && (
                      <span className="race-down" title="Fallen — Torso holds Brace to get up">
                        Down
                      </span>
                    )}
                    <span className="race-status meet-tabular">{status}</span>
                    <span className="race-progress" aria-hidden="true">
                      <span style={{ width: `${Math.min(100, Math.max(0, standing.progress * 100))}%` }} />
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}

      {/* Role card — solo shows one combined whole-body card, never role tabs. */}
      {room && me && (soloMode || currentRole) && (
        <div className="desktop-role-card absolute bottom-4 left-4 z-20 w-[320px] max-w-[calc(100vw-2rem)]">
          {soloMode ? (
            <div data-testid="solo-role-card" className="hud-card" style={{ "--team": myTeam?.color } as CSSProperties}>
              <div className="hud-card-head">
                <span className="hud-role-badge">
                  {SOLO_ROLES.map((r) => (
                    <RoleIcon key={r} role={r} className="h-5 w-5" />
                  ))}
                </span>
                <div className="min-w-0">
                  <div className="hud-card-title">Whole body</div>
                  <div className="hud-card-sub">Arms, torso and legs, all yours</div>
                </div>
              </div>
              <dl className="hud-keys">
                {SOLO_KEYS.map(([key, does]) => (
                  <div key={key} className="contents">
                    <dt>
                      <kbd>{key}</kbd>
                    </dt>
                    <dd>{does}</dd>
                  </div>
                ))}
              </dl>
              {!pointerLocked && phase !== "lobby" && <div className="hud-hint">Click the course to lock the mouse</div>}
            </div>
          ) : (
            <>
              {myRoles.length > 1 && (
                <div className="mb-2 flex gap-1.5">
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
                      className="hud-chip hud-chip--btn hud-role-tab"
                    >
                      <span className="meet-tabular opacity-60">{i + 1}</span>
                      <RoleIcon role={r} className="h-3.5 w-3.5" />
                      {sentenceCase(ROLE_INFO[r].short)}
                    </button>
                  ))}
                </div>
              )}
              <div className="hud-card" style={{ "--team": myTeam?.color } as CSSProperties}>
                <div className="hud-card-head">
                  <span className="hud-role-badge">
                    <RoleIcon role={currentRole!} className="h-6 w-6" />
                  </span>
                  <div className="min-w-0">
                    <div className="hud-card-title">{ROLE_INFO[currentRole!].label}</div>
                    <div className="hud-card-sub">Your part of the body</div>
                  </div>
                </div>
                <dl className="hud-keys">
                  {ROLE_INFO[currentRole!].keys.map((k) => (
                    <div key={k.key} className="contents">
                      <dt>
                        <kbd>{k.key}</kbd>
                      </dt>
                      <dd>{k.does}</dd>
                    </div>
                  ))}
                  {myRoles.length > 1 && (
                    <div className="contents">
                      <dt>
                        <kbd>Tab / 1-5</kbd>
                      </dt>
                      <dd>Switch body part</dd>
                    </div>
                  )}
                </dl>
                {(currentRole === "torso" || currentRole === "head") && !pointerLocked && phase !== "lobby" && <div className="hud-hint">Click the course to lock the mouse</div>}
              </div>
            </>
          )}
        </div>
      )}

      {/* Mobile movement and role-aware actions — solo uses combined touch controls. */}
      {room && me && (soloMode || currentRole) && phase !== "lobby" && phase !== "results" && (
        <MobileControls
          key={soloMode ? "solo" : currentRole}
          inputRef={inputRef}
          role={soloMode ? "arms" : currentRole!}
          roles={soloMode ? [...SOLO_ROLES] : myRoles}
          activeRole={activeRole}
          teamColor={myTeam?.color ?? "#edb200"}
          disabled={!gameReady || myFinish != null}
          solo={soloMode}
          onRoleSelect={(index) => {
            if (soloMode) return;
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
          {hud.fallen && (
            <div className="hud-status hud-status--fallen">
              <RotateIcon className="h-4 w-4 shrink-0" /> Down. Torso holds Brace to get up
            </div>
          )}
          {hud.hanging && <div className="hud-status hud-status--hanging">Hanging. Arms pull down, legs step</div>}
          {hud.holding > 0 && !hud.hanging && <div className="hud-status hud-status--holding">Holding. Arms throw when ready</div>}
          {hud.crouch && <div className="hud-status">Crouching</div>}
          {iControlBrace && hud.brace < 1 && (
            <div
              className="hud-meter"
              role="meter"
              aria-label="Brace stamina"
              aria-valuenow={Math.round(hud.brace * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span className="hud-meter-label">Brace</span>
              <span className="hud-meter-track">
                <span style={{ width: `${hud.brace * 100}%` }} />
              </span>
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
          <div key={countdown} aria-label={countdown === 0 ? "Go" : `Starting in ${countdown}`} className={`countdown hud-countdown ${countdown === 0 ? "is-go" : ""}`}>
            {countdown === 0 ? "Go!" : countdown}
          </div>
        </div>
      )}

      {/* Finish banner (mine) */}
      {myFinish != null && phase === "playing" && (
        <div className="pointer-events-none absolute inset-x-0 top-[28%] z-30 flex justify-center px-4">
          <div className="countdown hud-finish">
            <div className="hud-finish-title">{myStanding && standings.length > 1 ? `Finished ${ordinal(myStanding.place)}` : "Finished"}</div>
            <div className="hud-finish-time meet-tabular">{formatTime(myFinish)}</div>
            {standings.length > 1 && <div className="hud-finish-note">Waiting for the other teams</div>}
          </div>
        </div>
      )}

      {/* Lobby panel — flat scoresheet, compact steps, RHS dock kept */}
      {room && me && phase === "lobby" && (
        <div className="game-lobby-panel lobby-sheet absolute inset-y-0 right-0 z-20 flex w-full max-w-[440px] touch-pan-y scroll-pb-48 flex-col gap-2 overflow-y-auto p-3">
          <div className="lobby-heat-plate rounded-xl p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="lobby-step-title hidden sm:inline">Room</span>
                <span className="meet-tabular lobby-code truncate text-xl font-bold tracking-[0.14em] sm:text-2xl sm:tracking-[0.18em]">{code}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {!offline && (
                  <button
                    onClick={(e) => inviteFriends(e.currentTarget)}
                    aria-label="Invite friends: share or copy the room link"
                    title="Share or copy the room link"
                    className="lobby-quiet-btn flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold"
                  >
                    <CopyIcon className="h-4 w-4" />
                    Invite
                  </button>
                )}
                <button
                  onClick={() => setMuted((m) => !m)}
                  aria-label={muted ? "Unmute game audio" : "Mute game audio"}
                  aria-pressed={muted}
                  title={muted ? "Sound off" : "Sound on"}
                  className="lobby-quiet-btn grid h-8 w-8 shrink-0 place-items-center rounded-lg"
                >
                  {muted ? <SoundOffIcon className="h-4 w-4" /> : <SoundOnIcon className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-xs font-bold">
              <span className={`h-2 w-2 shrink-0 rounded-full ${competitive ? "bg-[#1e7a3c]" : "bg-[#8a5e00]"}`} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">
                {competitive
                  ? `${activeTeams.length} ${soloMode ? "racers" : "teams"} in`
                  : soloMode
                    ? "Invite friends to race against"
                    : "Add a rival team for head-to-head"}
              </span>
              <span className="meet-tabular lobby-count shrink-0 text-xs">
                {room.players.filter((p) => p.ready).length} of {room.players.length} ready
              </span>
            </div>
            <p className="lobby-note mt-1.5 text-xs leading-snug" data-testid="lobby-network-note">
              {offline
                ? "Practice room: just you, in this tab. Times here stay off the leaderboard."
                : "Friends can join from anywhere with the invite link. Same Wi-Fi or a strong signal makes it smoothest."}
            </p>
          </div>

          {/* Step 1 — Mode, and squad size for team versus. */}
          <div className="lobby-card rounded-xl p-3">
            <div className="lobby-step">
              <span className="lobby-step-no">Mode</span>
              <span className="lobby-step-title">{isLeader ? "You pick" : room.ffa ? "Free-for-all" : "Team versus"}</span>
            </div>
            <div role="group" aria-label="Game mode" className="grid grid-cols-2 gap-1.5">
              {([false, true] as const).map((ffa) => (
                <button
                  key={String(ffa)}
                  disabled={!isLeader || (ffa && ffaRosterTooLarge)}
                  onClick={() => {
                    if (room.ffa === ffa) return;
                    netRef.current?.setMode(ffa);
                    addToast(ffa ? "Free-for-all: everyone drives their own body." : "Team versus: pick a joint on your squad.", "info");
                  }}
                  title={ffa && ffaRosterTooLarge ? `Free-for-all fits up to ${TEAM_COLORS.length} racers` : undefined}
                  aria-pressed={room.ffa === ffa}
                  className={`lobby-mode rounded-lg px-2.5 py-2 text-left disabled:cursor-not-allowed ${room.ffa === ffa ? "is-selected" : ""}`}
                >
                  <span className="block font-black leading-tight">{ffa ? "Free-for-all" : "Team versus"}</span>
                  <span className="lobby-event-sub block text-xs font-bold">{ffa ? "Everyone drives a whole body" : "Squads share one body"}</span>
                </button>
              ))}
            </div>
            {soloMode ? (
              <p data-testid="solo-combined-note" className="lobby-note mt-2 text-xs leading-relaxed">
                You drive arms, torso and legs together. WASD walks, arrows work the arms, E grabs, Space jumps, C crouches.
              </p>
            ) : (
              <>
                <div className="lobby-sublabel mt-2.5 mb-1 text-xs font-bold">Squad size</div>
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
                      <span className="block font-black leading-tight">{n} players</span>
                      <span className="lobby-event-sub block text-xs font-bold">{n === 3 ? "Arms, torso, legs" : "Two hands, torso, two legs"}</span>
                    </button>
                  ))}
                </div>
                {threePlayerRosterTooLarge && (
                  <div className="lobby-note mt-1.5 text-xs">
                    3-player squads need every team at 3 or fewer players first.
                  </div>
                )}
              </>
            )}
          </div>

          {/* Step 2 — Challenge */}
          <div className="lobby-card rounded-xl p-3">
            <div className="lobby-step">
              <span className="lobby-step-no">Course</span>
              <span className="lobby-step-title">{isLeader ? "You pick" : challenge.name}</span>
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

          {/* Step 3 — Crew: free-for-all shows your body plus rival racers. */}
          <div className="lobby-step px-1">
            <span className="lobby-step-no">Crew</span>
            <span className="lobby-step-title">{soloMode ? "Racers" : "Teams and roles"}</span>
          </div>
          {soloMode ? (
            <>
              {room.teams
                .filter((t) => t.id === me.teamId)
                .map((t) => {
                  const members = room.players.filter((p) => p.teamId === t.id);
                  return (
                    <div key={t.id} data-testid="solo-crew" className="lobby-lane rounded-xl p-3" style={{ ["--lane-color" as string]: t.color, borderColor: t.color }}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color }} />
                          <TeamNameEditor key={t.name} name={t.name} onRename={renameMyTeam} />
                          <span className="lobby-quiet-btn shrink-0 rounded px-1.5 py-0.5 text-xs font-black uppercase tracking-wide">You</span>
                        </div>
                      </div>
                      <p className="lobby-note mt-1.5 text-xs">Combined controls — every joint follows your input.</p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {members.map((m) => (
                          <span key={m.id} className={`member-chip flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${m.ready ? "is-ready" : ""}`}>
                            {m.ready && <CheckIcon className="h-3 w-3" />}
                            {m.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              {room.teams
                .filter((t) => t.id !== me.teamId)
                .map((t) => {
                  const members = room.players.filter((p) => p.teamId === t.id);
                  const readyCount = members.filter((m) => m.ready).length;
                  return (
                    <div key={t.id} data-testid="ffa-rival" className="lobby-lane flex items-center gap-2 rounded-xl px-3 py-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color }} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-sm font-black">{t.name}</span>
                      <span className="meet-tabular lobby-count shrink-0 text-xs">
                        1v1 rival · {readyCount}/{members.length} ready
                      </span>
                    </div>
                  );
                })}
            </>
          ) : (
          room.teams.map((t) => {
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
                    <TeamNameEditor key={t.name} name={t.name} onRename={renameMyTeam} />
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
                    </span>
                  ))}
                  {members.length === 0 && <span className="lobby-note text-xs">No one here yet — pick a joint.</span>}
                </div>
              </div>
            );
          }))}
          <button
            data-testid="new-rival-team"
            disabled={room.teams.length >= TEAM_COLORS.length || soloMode}
            onClick={() => netRef.current?.createTeam()}
            className="lobby-quiet-btn flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-black/25 py-1.5 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            {soloMode ? "Free-for-all gives every racer their own team" : room.teams.length >= TEAM_COLORS.length ? "Maximum 6 teams" : "New rival team"}
          </button>

          <div className="lobby-action-bar sticky bottom-0 flex flex-col gap-1.5 rounded-xl p-2.5">
            <div className="lobby-step px-1">
              <span className="lobby-step-no">Ready</span>
              <span className="lobby-step-title">Start the race</span>
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
              {isLeader ? "You start the race when everyone's ready." : `Waiting for ${room.players.find((p) => p.id === room.leaderId)?.name ?? "the room"} to start.`} The course is live while you wait.
            </div>
          </div>
        </div>
      )}

      {/* Results: the lab comes back. Paper sheet, ink outline, same buttons as the landing. */}
      {room && phase === "results" && (
        <div className="game-results-overlay absolute inset-0 z-30 flex items-center justify-center p-3 sm:p-4">
          <div className="game-results-panel results-sheet max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl touch-pan-y overflow-y-auto p-4 sm:max-h-[calc(100dvh-2rem)] sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
              <h2 className="results-title">Results</h2>
              <span className="results-course">
                <ChallengeIcon challenge={challenge} className="h-4 w-4" />
                {challenge.name}, round {room.round}
              </span>
            </div>
            <div className="mt-5 grid gap-6 md:grid-cols-2">
              <section aria-label="This round">
                <h3 className="results-h3">This round</h3>
                <ol className="flex flex-col gap-2">
                  {sortedTeams.map((t, i) => {
                    const won = i === 0 && t.finishMs != null;
                    return (
                      <li key={t.id} className={`results-row ${won ? "is-winner" : ""}`} style={{ "--team": t.color } as CSSProperties}>
                        <span className="results-place">{t.finishMs != null ? ordinal(i + 1) : "–"}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-black">{t.name}</span>
                          <span className="results-players block truncate">{room.players.filter((p) => p.teamId === t.id).map((p) => p.name).join(", ")}</span>
                        </span>
                        <span className="meet-tabular shrink-0 text-lg font-bold">{t.finishMs != null ? formatTime(t.finishMs) : "Did not finish"}</span>
                      </li>
                    );
                  })}
                </ol>
              </section>
              <section aria-label="Best times">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="results-h3 mb-0">Best times</h3>
                  <span className="flex gap-1">
                    {([3, 5] as SquadSize[]).map((n) => (
                      <button key={n} onClick={() => setBoardSquad(n)} aria-pressed={boardSquad === n} className="results-toggle">
                        {n} players
                      </button>
                    ))}
                  </span>
                </div>
                <p className="results-note">Full squads and solo free-for-all runs rank. Offline practice doesn&apos;t count.</p>
                <div className="flex max-h-80 flex-col gap-3 overflow-y-auto pr-1">
                  {leaderboardSections.map(({ challenge: boardChallenge, rows }) => (
                    <section key={boardChallenge.id} aria-label={`${boardChallenge.name} leaderboard`}>
                      <div className="mb-1 flex items-center gap-1.5 text-sm font-black">
                        <ChallengeIcon challenge={boardChallenge} className="h-4 w-4" />
                        <span>{boardChallenge.name}</span>
                        {room.challengeId === boardChallenge.id && <span className="results-current">This course</span>}
                      </div>
                      <div className="flex flex-col gap-1">
                        {rows.length === 0 && <div className="results-empty">No times yet.</div>}
                        {rows.map((row, i) => {
                          const isUs = room.challengeId === boardChallenge.id && !!myTeam && row.teamName === myTeam.name && myFinish != null && row.timeMs === myFinish;
                          return (
                            <div key={row.id} className={`results-board-row ${isUs ? "is-us" : ""}`}>
                              <span className="meet-tabular w-5 font-bold">{i + 1}</span>
                              <span className="min-w-0 flex-1 truncate">
                                <span className="font-bold">{row.teamName}</span> <span className="results-players">{(row.players ?? []).join(", ")}</span>
                              </span>
                              <span className="meet-tabular font-bold">{formatTime(row.timeMs)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </section>
            </div>
            <div className="mt-6 flex flex-col items-center gap-2">
              {isLeader ? (
                <div className="flex flex-wrap justify-center gap-2.5">
                  <button onClick={() => netRef.current?.startRound(true)} className="lab-btn lab-btn--go">
                    Play again
                  </button>
                  <button onClick={() => netRef.current?.backToLobby()} className="lab-btn lab-btn--plain">
                    Change course
                  </button>
                </div>
              ) : (
                <p className="results-note mb-0">Waiting for {room.players.find((p) => p.id === room.leaderId)?.name ?? "the room"} to restart.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
