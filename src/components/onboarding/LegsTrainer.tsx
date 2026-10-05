"use client";

import { useEffect, useRef, useState } from "react";
import { J, Rig, type Cord } from "./ragdoll-sim";
import { CORD_COLORS, burst, drawCord, drawCursor, drawDummy, drawGround, drawStamps, stepParticles, type Particle, type Stamp } from "./dummy-draw";
import { mulberry32, useReducedMotion, useStageLoop, type StageFrame } from "./useStageLoop";

type Leg = "l" | "r";

interface Step {
  from: number;
  to: number;
  t: number;
}

interface Trainer {
  s: number;
  groundY: number;
  rig: Rig;
  torso: Cord;
  torsoRest: number;
  feet: Record<Leg, { cord: Cord; rest: number; x: number; step: Step | null; startedAt: number }>;
  bodyX: number;
  camX: number;
  last: Leg | null;
  fallen: number;
  dust: Particle[];
  stamps: Stamp[];
  rand: () => number;
}

const STEP_TIME = 0.3;
const SYNC_WINDOW = 0.14;

function build(w: number, h: number): Trainer {
  const groundY = h - Math.max(30, h * 0.16);
  // Leave the top band clear for the message bubble.
  const s = Math.max(11, Math.min((groundY - 70) / 7.6, 40));
  const cx = w / 2;
  const rig = new Rig({ cx, groundY, s, width: w });
  rig.walls = false;
  const torso = rig.addCord([J.lShoulder, J.rShoulder], cx, groundY - 7.4 * s);
  const torsoRest = torso.len * 0.985;
  torso.len = torsoRest;
  const foot = (i: number, x: number) => {
    const cord = rig.addCord([i], x, groundY - 6.6 * s);
    return { cord, rest: cord.len, x, step: null, startedAt: -9 };
  };
  return {
    s,
    groundY,
    rig,
    torso,
    torsoRest,
    feet: { l: foot(J.lFoot, rig.pts[J.lFoot].x), r: foot(J.rFoot, rig.pts[J.rFoot].x) },
    bodyX: cx,
    camX: 0,
    last: null,
    fallen: 0,
    dust: [],
    stamps: [],
    rand: mulberry32(11),
  };
}

export default function LegsTrainer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const trainerRef = useRef<Trainer | null>(null);
  const reduce = useReducedMotion();
  const [streak, setStreak] = useState(0);
  const streakRef = useRef(0);
  const [best, setBest] = useState(0);
  const [msg, setMsg] = useState("Left, right, left, right. Press both at once and see what happens.");

  const advanceInstantly = (tr: Trainer) => {
    // Reduced motion: resolve the move off-screen, then show the result.
    for (const leg of ["l", "r"] as const) {
      const f = tr.feet[leg];
      if (f.step) {
        f.cord.ax = f.step.to;
        f.x = f.step.to;
        f.step = null;
      }
    }
    tr.torso.ax = tr.bodyX;
    tr.torso.len = tr.fallen > 0 ? tr.torsoRest : tr.torso.len;
    tr.fallen = 0;
    for (let i = 0; i < 90; i++) tr.rig.step();
    tr.camX = tr.torso.ax - (canvasRef.current?.clientWidth ?? 0) / 2;
  };

  const press = (leg: Leg) => {
    const tr = trainerRef.current;
    if (!tr || tr.fallen > 0) return;
    const other: Leg = leg === "l" ? "r" : "l";
    const s = tr.s;
    const now = performance.now() / 1000;
    if (now - tr.feet[other].startedAt < SYNC_WINDOW) {
      // Both legs at once: the body has nothing to stand on.
      tr.fallen = 1.7;
      tr.torso.len = tr.torsoRest + 5 * s;
      for (const l of ["l", "r"] as const) {
        tr.feet[l].cord.len = Math.max(s, tr.feet[l].rest - 4 * s);
        tr.feet[l].step = null;
      }
      tr.stamps.push({ text: "Ouch.", x: tr.bodyX, y: tr.groundY - 5.5 * s, life: 0, rot: -0.1 });
      tr.last = null;
      streakRef.current = 0;
      setStreak(0);
      setMsg("Both legs at once. That's a face-plant. Alternate them.");
      if (reduce) advanceInstantly(tr);
      return;
    }
    if (tr.last === leg) {
      tr.rig.impulse(leg === "l" ? -5 * s : 5 * s, -3 * s, [J.lShoulder, J.rShoulder, J.head]);
      tr.stamps.push({ text: "Other leg!", x: tr.bodyX, y: tr.groundY - 5.8 * s, life: 0, rot: 0.08 });
      streakRef.current = 0;
      setStreak(0);
      setMsg(`That was the ${leg === "l" ? "left" : "right"} leg twice. Now the ${other === "l" ? "left" : "right"}.`);
      if (reduce) advanceInstantly(tr);
      return;
    }
    // Side-step to the right: the right foot leads, the left foot closes the gap.
    const f = tr.feet[leg];
    const otherX = tr.feet[other].step?.to ?? tr.feet[other].x;
    const to = leg === "r" ? otherX + 1.9 * s : otherX - 0.7 * s;
    f.step = { from: f.x, to: Math.max(to, f.x), t: 0 };
    f.startedAt = now;
    tr.last = leg;
    tr.bodyX = (to + otherX) / 2;
    streakRef.current += 1;
    setStreak(streakRef.current);
    setBest((b) => Math.max(b, streakRef.current));
    setMsg(leg === "l" ? "Left. Now right." : "Right. Now left.");
    if (reduce) advanceInstantly(tr);
  };

  const frame = ({ ctx, w, h, dt, font, resized }: StageFrame) => {
    let tr = trainerRef.current;
    if (!tr || resized) {
      tr = build(w, h);
      trainerRef.current = tr;
    }
    const { rig, s, groundY } = tr;

    if (!reduce) {
      for (const leg of ["l", "r"] as const) {
        const f = tr.feet[leg];
        if (f.step) {
          f.step.t += dt / STEP_TIME;
          const k = Math.min(1, f.step.t);
          const ease = 1 - Math.pow(1 - k, 3);
          f.cord.ax = f.step.from + (f.step.to - f.step.from) * ease;
          f.cord.len = f.rest - Math.sin(Math.PI * k) * 1.4 * s;
          if (k >= 1) {
            f.x = f.step.to;
            f.cord.len = f.rest;
            f.step = null;
            burst(tr.dust, rig.pts[leg === "l" ? J.lFoot : J.rFoot].x, groundY, s * 0.5, 3, tr.rand);
          }
        }
      }
      if (tr.fallen > 0) {
        tr.fallen -= dt;
        if (tr.fallen < 0.9) {
          tr.torso.len += (tr.torsoRest - tr.torso.len) * Math.min(1, dt * 3.5);
          for (const l of ["l", "r"] as const) tr.feet[l].cord.len += (tr.feet[l].rest - tr.feet[l].cord.len) * Math.min(1, dt * 4);
        }
        if (tr.fallen <= 0) {
          tr.fallen = 0;
          tr.torso.len = tr.torsoRest;
          for (const l of ["l", "r"] as const) {
            tr.feet[l].x = rig.pts[l === "l" ? J.lFoot : J.rFoot].x;
            tr.feet[l].cord.ax = tr.feet[l].x;
            tr.feet[l].cord.len = tr.feet[l].rest;
          }
          tr.bodyX = (tr.feet.l.x + tr.feet.r.x) / 2;
        }
      }
      tr.torso.ax += (tr.bodyX - tr.torso.ax) * Math.min(1, dt * 5);
      rig.advance(dt);
      const hit = rig.consumeImpact();
      if (hit && hit.speed > 14) burst(tr.dust, hit.x, hit.y, s * 0.8, 8, tr.rand);
      tr.camX += (tr.torso.ax - w / 2 - tr.camX) * Math.min(1, dt * 3);
    }

    ctx.save();
    drawGround(ctx, w, h, groundY, s, tr.camX);
    ctx.translate(-tr.camX, 0);
    drawCord(ctx, rig, tr.torso, CORD_COLORS[2]);
    drawCord(ctx, rig, tr.feet.l.cord, CORD_COLORS[3]);
    drawCord(ctx, rig, tr.feet.r.cord, CORD_COLORS[4]);
    drawDummy(ctx, rig, font, { dizzy: tr.fallen > 0 });
    drawCursor(ctx, tr.torso.ax, tr.torso.ay, CORD_COLORS[2], "Torso", font);
    drawCursor(ctx, tr.feet.l.cord.ax, tr.feet.l.cord.ay, CORD_COLORS[3], "You: A", font, 1, true);
    drawCursor(ctx, tr.feet.r.cord.ax, tr.feet.r.cord.ay, CORD_COLORS[4], "You: L", font);
    stepParticles(ctx, tr.dust, reduce ? 0 : dt);
    drawStamps(ctx, tr.stamps, reduce ? 0.4 : dt, s, font);
    ctx.restore();
  };

  const redraw = useStageLoop(canvasRef, frame, reduce);
  const pressRef = useRef(press);
  useEffect(() => {
    pressRef.current = (leg: Leg) => {
      press(leg);
      if (reduce) redraw();
    };
  });

  // A / L drive the legs while the trainer is on screen, unless you're typing.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    let visible = false;
    const io = new IntersectionObserver(([e]) => (visible = e.intersectionRatio > 0.4), { threshold: [0, 0.4, 1] });
    io.observe(el);
    const onKey = (e: KeyboardEvent) => {
      if (!visible || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "a") pressRef.current("l");
      else if (k === "l") pressRef.current("r");
    };
    window.addEventListener("keydown", onKey);
    return () => {
      io.disconnect();
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const pad = (leg: Leg, label: string, key: string) => (
    <button
      type="button"
      className={`lab-leg-pad lab-leg-pad--${leg}`}
      onPointerDown={(e) => {
        if (e.pointerType !== "mouse" || e.button === 0) pressRef.current(leg);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (!e.repeat) pressRef.current(leg);
        }
      }}
    >
      <span>{label}</span>
      <kbd>{key}</kbd>
    </button>
  );

  return (
    <div ref={sectionRef} className="lab-trainer">
      <canvas ref={canvasRef} className="lab-trainer-canvas" aria-hidden="true" />
      <div className="lab-trainer-hud">
        <p className="lab-trainer-msg" aria-live="polite">
          {msg}
        </p>
        <p className="lab-trainer-score">
          <span>
            Steps in a row <b className="lab-num">{streak}</b>
          </span>
          <span>
            Best <b className="lab-num">{best}</b>
          </span>
        </p>
      </div>
      <div className="lab-trainer-pads">
        {pad("l", "Left leg", "A")}
        {pad("r", "Right leg", "L")}
      </div>
    </div>
  );
}
