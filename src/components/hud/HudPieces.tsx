"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { MomentKind } from "@/game/game";
import { formatTime } from "@/game/types";
import type { Medal } from "@/game/grades";

/* ------------------------------ objective tracker ------------------------------ */

export interface ObjectiveProgress {
  /** Checkpoints passed and how many the course has. */
  checkpoint: number;
  checkpointTotal: number;
  /** Delivery courses: carrying the objective right now / already placed. */
  carrying: boolean;
  delivered: boolean;
  score: number;
  scoreTarget: number;
  kind: "race" | "carry" | "carryThenRace" | "score";
}

/** Progress at a glance: pips for checkpoints, steps for carries, balls for baskets. */
export function ObjectiveTracker({ p }: { p: ObjectiveProgress }) {
  if (p.kind === "score") {
    return (
      <span className="hud-track" aria-label={`${p.score} of ${p.scoreTarget} baskets`}>
        {Array.from({ length: p.scoreTarget }, (_, i) => (
          <span key={i} className={`hud-track-ball ${i < p.score ? "is-on" : ""}`} aria-hidden="true" />
        ))}
      </span>
    );
  }
  const steps: { label: string; on: boolean; now: boolean }[] = [];
  if (p.kind === "carry" || p.kind === "carryThenRace") {
    steps.push({ label: "Grab", on: p.carrying || p.delivered, now: !p.carrying && !p.delivered });
    steps.push({ label: "Carry", on: p.delivered, now: p.carrying && !p.delivered });
    steps.push({ label: "Place", on: p.delivered, now: false });
  }
  const pips = Array.from({ length: p.checkpointTotal }, (_, i) => i < p.checkpoint);
  return (
    <span className="hud-track" aria-label={`${p.checkpoint} of ${p.checkpointTotal} checkpoints${p.delivered ? ", objective placed" : ""}`}>
      {steps.map((s) => (
        <span key={s.label} className={`hud-track-step ${s.on ? "is-on" : ""} ${s.now ? "is-now" : ""}`}>
          {s.label}
        </span>
      ))}
      {p.kind !== "carry" &&
        pips.map((on, i) => <span key={i} className={`hud-track-pip ${on ? "is-on" : ""}`} aria-hidden="true" />)}
      {(p.kind === "race" || p.kind === "carryThenRace") && <span className="hud-track-flag" aria-hidden="true">⚑</span>}
    </span>
  );
}

/* ------------------------------ moments ------------------------------ */

export interface Moment {
  id: number;
  kind: MomentKind;
  value?: number;
  total?: number;
}

const MOMENT_TEXT: Partial<Record<MomentKind, (m: Moment) => { title: string; sub?: string; tone: string }>> = {
  checkpoint: (m) => ({ title: "Checkpoint!", sub: m.total ? `${m.value} of ${m.total} saved` : undefined, tone: "mint" }),
  score: (m) => ({ title: m.value != null && m.total != null && m.value >= m.total ? "Game!" : "Swish!", sub: m.total ? `${m.value} / ${m.total}` : undefined, tone: "gold" }),
  delivered: () => ({ title: "Delivered!", sub: "Now the timing gate", tone: "cyan" }),
  splash: () => ({ title: "Splash!", sub: "Back to the last checkpoint", tone: "water" }),
  crack: () => ({ title: "Crack!", sub: "A fresh egg is waiting", tone: "tape" }),
  finish: () => ({ title: "Finished!", tone: "gold" }),
};

/** Big sticker pops for the beats that matter, plus a water wipe on splashes. */
export function MomentLayer({ moment, reducedMotion }: { moment: Moment | null; reducedMotion: boolean }) {
  const [shown, setShown] = useState<Moment | null>(null);
  useEffect(() => {
    if (!moment) return;
    const spec = MOMENT_TEXT[moment.kind];
    if (!spec) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- each moment is a one-shot pop
    setShown(moment);
    const t = window.setTimeout(() => setShown((s) => (s?.id === moment.id ? null : s)), moment.kind === "finish" ? 1600 : 1250);
    return () => window.clearTimeout(t);
  }, [moment]);
  if (!shown) return null;
  const spec = MOMENT_TEXT[shown.kind]!(shown);
  return (
    <>
      {shown.kind === "splash" && <div key={`wipe-${shown.id}`} className={`hud-wipe ${reducedMotion ? "is-reduced" : ""}`} aria-hidden="true" />}
      <div className="hud-moment-wrap" aria-hidden="true">
        <div key={shown.id} className={`hud-moment hud-moment--${spec.tone}`}>
          <span className="hud-moment-title">{spec.title}</span>
          {spec.sub && <span className="hud-moment-sub">{spec.sub}</span>}
        </div>
      </div>
    </>
  );
}

/* ------------------------------ announcer ------------------------------ */

export interface AnnouncerLine {
  id: number;
  text: string;
  tone: "good" | "bad" | "info";
  color?: string;
}

/** Commentary as a play-by-play announcer card, out of the middle of the screen. */
export function Announcer({ lines }: { lines: AnnouncerLine[] }) {
  return (
    <div className="hud-announcer" role="status" aria-live="polite">
      {lines.map((l) => (
        <div key={l.id} className={`hud-announce hud-announce--${l.tone}`} style={l.color ? ({ "--announce": l.color } as CSSProperties) : undefined}>
          <span className="hud-announce-mic" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
            </svg>
          </span>
          <span className="hud-announce-text">{l.text}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ medals ------------------------------ */

const MEDAL_LABEL: Record<Medal, string> = { gold: "Gold", silver: "Silver", bronze: "Bronze" };

export function MedalBadge({ medal, size = "md" }: { medal: Medal | null; size?: "sm" | "md" | "lg" }) {
  if (!medal) return null;
  return (
    <span className={`medal medal--${medal} medal--${size}`} title={`${MEDAL_LABEL[medal]} medal`}>
      <span className="medal-disc" aria-hidden="true" />
      <span className="medal-label">{MEDAL_LABEL[medal]}</span>
    </span>
  );
}

/** "PB 00:52.10 · Gold under 00:45.00": the time to beat while you race. */
export function TargetChip({ best, nextLabel, nextTime }: { best: number | null; nextLabel: string | null; nextTime: number | null }) {
  if (best == null && nextLabel == null) return null;
  return (
    <div className="hud-target">
      {best != null && (
        <span>
          <span className="hud-target-k">PB</span> <span className="meet-tabular">{formatTime(best)}</span>
        </span>
      )}
      {nextLabel && nextTime != null && (
        <span>
          <span className={`hud-target-dot medal-dot--${nextLabel.toLowerCase()}`} aria-hidden="true" />
          <span className="hud-target-k">{nextLabel}</span> <span className="meet-tabular">{formatTime(nextTime)}</span>
        </span>
      )}
    </div>
  );
}
