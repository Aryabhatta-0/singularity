"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CHALLENGES, ROLE_INFO, ROLES_5, type Role } from "@/game/types";
import { createRoomCode, normalizeRoomCode, roomCodeError } from "./room-code";
import { ChallengeIcon } from "@/components/icons";
import LandingLeaderboardButton from "@/components/LandingLeaderboard";
import HeroStage, { type HeroPreview } from "@/components/onboarding/HeroStage";
import { SPRING_EASE, useReducedMotion } from "@/components/onboarding/useStageLoop";

const WORDMARK = "SINGULARITY".split("");

/** "Easy — hurdles, ..." → "Hurdles, ..." (difficulty already has its own badge). */
const shortTagline = (tagline: string) => {
  const rest = tagline.replace(/^[A-Za-z]+ — /, "");
  return rest.charAt(0).toUpperCase() + rest.slice(1);
};

export default function Home() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<HeroPreview>(null);
  const [mode, setMode] = useState<"versus" | "ffa" | null>(null);
  const [stuck, setStuck] = useState(false);
  const [launchKey, setLaunchKey] = useState(0);
  const [iris, setIris] = useState<{ x: number; y: number; room: string } | null>(null);
  const [hotLimb, setHotLimb] = useState<Role | null>(null);
  const [course, setCourse] = useState(0);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const nameRef = useRef(name);

  useEffect(() => {
    nameRef.current = name;
  });

  useEffect(() => {
    // Auto-generated "PlayerNN" fallbacks aren't real names; leave the field empty so the placeholder shows.
    const stored = localStorage.getItem("singularity_name") ?? "";
    if (/^Player\d+$/.test(stored)) localStorage.removeItem("singularity_name");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is intentionally read after hydration.
    else setName(stored);
  }, []);

  // The headline takes the hit when the dummy lands; returning players get their sticker slapped on.
  const onLand = useCallback(() => {
    titleRef.current?.animate([{ transform: "scale(1.06, 0.78)" }, { transform: "scale(1, 1)" }], {
      duration: 720,
      easing: SPRING_EASE,
    });
    window.setTimeout(() => setStuck((was) => was || nameRef.current.trim().length > 0), 1500);
  }, []);

  const saveName = () => {
    // Left blank, the game client picks a throwaway "PlayerNN" name for this session only.
    const n = name.trim().slice(0, 16);
    if (n) localStorage.setItem("singularity_name", n);
    else localStorage.removeItem("singularity_name");
  };

  const launch = (from: HTMLElement | null, room: string, href: string) => {
    saveName();
    setStuck(true);
    setBusy(true);
    setPreview(null);
    setLaunchKey((k) => k + 1);
    if (!reduce && from) {
      const r = from.getBoundingClientRect();
      setIris({ x: r.left + r.width / 2, y: r.top + r.height / 2, room });
    }
    router.push(href);
  };

  const create = (from: HTMLElement, solo = false) => {
    const room = createRoomCode();
    launch(from, room, `/play/${room}${solo ? "?solo=1" : ""}`);
  };

  const practice = (from: HTMLElement) => {
    const room = createRoomCode();
    launch(from, room, `/play/${room}?offline=1&solo=1`);
  };

  const join = (from: HTMLElement | null) => {
    const error = roomCodeError(code);
    if (error) {
      setCodeError(error);
      return;
    }
    const c = normalizeRoomCode(code);
    launch(from, c, `/play/${c}`);
  };

  const hover = (mode: HeroPreview) => ({
    onPointerEnter: () => !busy && setPreview(mode),
    onPointerLeave: () => setPreview(null),
    onFocus: () => !busy && setPreview(mode),
    onBlur: () => setPreview(null),
  });

  return (
    <main className="lab-landing min-h-dvh">
      <header className="lab-topbar">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3">
          <span className="lab-wordmark" aria-label="Singularity">
            {WORDMARK.map((ch, i) => (
              <span key={i} aria-hidden="true" style={{ "--i": i, "--sag": Math.round(5 * (1 - ((i - 5) / 5) ** 2)) } as CSSProperties}>
                {ch}
              </span>
            ))}
          </span>
          <LandingLeaderboardButton />
        </div>
      </header>

      <section className="lab-hero mx-auto grid max-w-6xl gap-x-6 px-5 lg:grid-cols-[minmax(30rem,0.92fr)_minmax(0,1.08fr)]">
        <div className="lab-hero-copy min-w-0 pt-8 lg:pt-[clamp(0.75rem,3dvh,3.5rem)]">
          <h1 ref={titleRef} className="lab-h1">
            <span className="lab-h1-wide">Five players.</span>
            <span className="lab-h1-tight">One body.</span>
          </h1>
          <p className="lab-lede">
            Up to five friends share one ragdoll, one limb each. Walk in rhythm, grab together and race rival squads
            online. Or fall over together, which happens a lot.
          </p>
        </div>

        <section aria-label="Enter the game" className="lab-clipboard min-w-0">
          <div className={`lab-name-sticker ${name.trim() ? "has-name" : ""} ${stuck ? "is-peeled" : ""}`} aria-hidden="true">
            <span className="lab-name-sticker-top">HELLO</span>
            <span className="lab-name-sticker-name">{name.trim() || "?"}</span>
          </div>
          <label htmlFor="player-name" className="lab-label">
            Your name
          </label>
          <input
            id="player-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!e.target.value.trim()) setStuck(false);
            }}
            onBlur={() => name.trim() && setStuck(true)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && setStuck(true)}
            maxLength={16}
            placeholder="Left Leg Larry"
            autoComplete="nickname"
            className="lab-field mt-1.5 w-full min-w-0"
          />
          <div role="group" aria-label="Game mode" className="mt-(--hero-gap) grid gap-2.5 sm:grid-cols-2">
            <button
              disabled={busy}
              aria-pressed={mode === "versus"}
              onClick={() => setMode("versus")}
              className="lab-btn lab-btn--pick"
              {...hover("versus")}
            >
              Team versus
              <span className="lab-btn-sub">Squads of 3 or 5 race head-to-head</span>
            </button>
            <button
              disabled={busy}
              aria-pressed={mode === "ffa"}
              onClick={() => setMode("ffa")}
              className="lab-btn lab-btn--pick"
              {...hover("ffa")}
            >
              Free-for-all
              <span className="lab-btn-sub">Everyone drives a whole body alone</span>
            </button>
          </div>
          <button
            disabled={busy || !mode}
            aria-busy={busy || undefined}
            onClick={(e) => mode && create(e.currentTarget, mode === "ffa")}
            className="lab-btn lab-btn--go lab-btn--start mt-[calc(var(--hero-gap)*0.65)] w-full"
          >
            {mode ? "Create room" : "Pick a mode"}
          </button>
          <div className="mt-(--hero-gap)">
            <label htmlFor="room-code" className="lab-label">
              Room code
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                id="room-code"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  if (codeError) setCodeError(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && join(e.currentTarget)}
                maxLength={96}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-invalid={codeError ? true : undefined}
                aria-describedby="room-code-error"
                placeholder="From your invite"
                className="lab-field lab-field--code min-w-0 w-full"
                {...hover("join")}
              />
              <button disabled={busy} onClick={(e) => join(e.currentTarget)} className="lab-btn lab-btn--ink shrink-0">
                Join
              </button>
            </div>
            <p id="room-code-error" role={codeError ? "alert" : undefined} className="lab-error">
              {codeError}
            </p>
          </div>
          <p className="lab-clipboard-note">
            Create a room and invite friends from anywhere. Same Wi-Fi or a strong signal is smoothest, but not required.{" "}
            <button type="button" disabled={busy} onClick={(e) => practice(e.currentTarget)} className="lab-textbtn">
              Practice solo offline
            </button>
          </p>
        </section>

        {/* After the form in the DOM so phones see the form first; on desktop the grid pins it to the right column. */}
        <div className="lab-hero-side min-w-0 lg:row-span-2">
          <div className="lab-hero-stage min-w-0">
            <HeroStage name={name} stuck={stuck} preview={busy ? null : (preview ?? mode)} code={code} launchKey={launchKey} onLand={onLand} />
            <p className="lab-stage-hint">Grab the dummy. It doesn&apos;t mind.</p>
          </div>
        </div>
      </section>

      <div className="lab-tape" aria-hidden="true" />

      <section id="courses" className="mx-auto max-w-6xl px-5 pt-14">
        <div className="lab-section-head">
          <h2 className="lab-h2">Five courses</h2>
          <p>The room leader picks one in the lobby. Rival squads run it at the same time, as see-through ghosts.</p>
        </div>
        <div className="lab-route" style={{ "--stop": course, "--sy": course % 2 } as CSSProperties}>
          <svg className="lab-route-line" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
            <path d="M100 30 C 200 30, 200 70, 300 70 S 400 30, 500 30 S 600 70, 700 70 S 800 30, 900 30" />
          </svg>
          <span className="lab-route-marker" aria-hidden="true">
            <span key={course} />
          </span>
          <ol className="lab-route-stops">
            {CHALLENGES.map((c, i) => (
              <li key={c.id} className="lab-stop" onPointerEnter={() => setCourse(i)}>
                <span className={`lab-stop-node diff-${c.difficulty}`}>
                  <ChallengeIcon challenge={c} className="h-6 w-6" />
                </span>
                <span className="lab-stop-name">
                  {c.name} <span className={`diff diff-${c.difficulty}`}>{c.difficulty}</span>
                </span>
                <span className="lab-stop-tag">{shortTagline(c.tagline)}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="limbs" className="mx-auto max-w-6xl px-5 pt-16">
        <div className="lab-section-head">
          <h2 className="lab-h2">Pick a limb</h2>
          <p>In a 5-player squad everyone owns one part of the body. With 3 players it&apos;s arms, torso and legs.</p>
        </div>
        <div className="lab-limbs">
          <ExplodedDummy hot={hotLimb} />
          {ROLES_5.map((r) => (
            <div key={r} className={`lab-limb lab-limb--${r}`} onPointerEnter={() => setHotLimb(r)} onPointerLeave={() => setHotLimb(null)}>
              <h3>{ROLE_INFO[r].label}</h3>
              <p>{ROLE_INFO[r].blurb}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="lab-footer mx-auto max-w-6xl px-5 pb-10 pt-16 text-center">
        <p className="lab-foot">Plays in the browser, with a keyboard or a touch screen. No account needed.</p>
        <nav aria-label="Site" className="lab-foot-links">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <a href="https://github.com/Aryabhatta-0/singularity" rel="noopener">
            Source code
          </a>
          <a href="https://github.com/Aryabhatta-0/singularity/issues/new/choose" rel="noopener">
            Report a problem
          </a>
        </nav>
      </footer>

      {iris && (
        <div className="lab-iris" style={{ "--x": `${iris.x}px`, "--y": `${iris.y}px` } as CSSProperties} aria-hidden="true">
          <span>Opening room {iris.room}</span>
        </div>
      )}
    </main>
  );
}

function ExplodedDummy({ hot }: { hot: Role | null }) {
  const ink = "#14202E";
  const body = "#FFD21A";
  const limb = (role: Role, d: string, end: [number, number], w: number, boot = false) => (
    <g className={`lab-xpart ${hot === role ? "is-hot" : ""}`}>
      <path d={d} fill="none" stroke={ink} strokeWidth={w + 7} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={body} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={end[0]} cy={end[1]} r={w * 0.62} fill={boot ? ink : body} stroke={ink} strokeWidth={3.5} />
    </g>
  );
  return (
    <svg viewBox="0 0 220 280" className="lab-exploded" aria-hidden="true">
      <g strokeDasharray="4 5" stroke={ink} strokeOpacity="0.35" strokeWidth="2">
        <path d="M80 92 L58 104" />
        <path d="M140 92 L162 104" />
        <path d="M96 160 L90 182" />
        <path d="M124 160 L130 182" />
      </g>
      {limb("lhand", "M50 104 L32 132 L26 158", [26, 160], 12)}
      {limb("rhand", "M170 104 L188 132 L194 158", [194, 160], 12)}
      {limb("lleg", "M90 188 L84 226 L82 256", [82, 258], 15, true)}
      {limb("rleg", "M130 188 L136 226 L138 256", [138, 258], 15, true)}
      <g className={`lab-xpart ${hot === "torso" ? "is-hot" : ""}`}>
        <rect x="80" y="84" width="60" height="76" rx="17" fill={body} stroke={ink} strokeWidth="4.5" />
        <rect x="82" y="146" width="56" height="5" fill={ink} />
        <circle cx="95" cy="100" r="7" fill={body} stroke={ink} strokeWidth="2.5" />
        <path d="M95 100 L102 100 A7 7 0 0 1 95 107 Z M95 100 L88 100 A7 7 0 0 1 95 93 Z" fill={ink} />
        <rect x="103" y="68" width="14" height="18" fill={body} stroke={ink} strokeWidth="4" />
        <circle cx="110" cy="54" r="22" fill={body} stroke={ink} strokeWidth="4.5" />
        <circle cx="104" cy="57" r="2.8" fill={ink} />
        <circle cx="117" cy="57" r="2.8" fill={ink} />
      </g>
    </svg>
  );
}
