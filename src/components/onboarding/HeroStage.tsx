"use client";

import { useEffect, useRef } from "react";
import { J, Rig, type Cord } from "./ragdoll-sim";
import { CORD_COLORS, LAB, burst, drawCord, drawCursor, drawDummy, drawGround, drawStamps, stepParticles, type Particle, type Stamp } from "./dummy-draw";
import { mulberry32, useReducedMotion, useStageLoop, type StageFrame } from "./useStageLoop";

export type HeroPreview = "versus" | "ffa" | "join" | null;

interface Puppeteer {
  cord: Cord;
  color: string;
  label: string;
  short: string;
  /** Anchor home, in body units relative to (cx, groundY). */
  hx: number;
  hy: number;
  rest: number;
  target: number;
  rate: number;
}

interface Mini {
  rig: Rig;
  cord: Cord;
  color: string;
  alpha: number;
}

interface Scene {
  w: number;
  h: number;
  s: number;
  cx: number;
  groundY: number;
  rig: Rig;
  crew: Puppeteer[];
  solo: Cord;
  ghost: Rig;
  ghostCords: Cord[];
  ghostRest: number[];
  ghostX: number;
  ghostAlpha: number;
  minis: Mini[];
  dust: Particle[];
  stamps: Stamp[];
  phase: "drop" | "attach" | "idle" | "launch";
  phaseT: number;
  hitStop: number;
  dizzy: number;
  gagIn: number;
  gagT: number;
  sticker: number;
  stickerLanded: boolean;
  tagAlpha: number;
  crewAlpha: number;
  mode: HeroPreview;
  launchSeen: number;
  rand: () => number;
}

const CREW = [
  { role: "lhand", points: [J.lHand], hx: -3.3, hy: -5.7, label: "Left hand", short: "L hand" },
  { role: "rhand", points: [J.rHand], hx: 3.3, hy: -5.7, label: "Right hand", short: "R hand" },
  { role: "torso", points: [J.lShoulder, J.rShoulder], hx: 0, hy: -8.4, label: "Torso", short: "Torso" },
  { role: "lleg", points: [J.lFoot], hx: -1.5, hy: -7.4, label: "Left leg", short: "L leg" },
  { role: "rleg", points: [J.rFoot], hx: 1.5, hy: -7.4, label: "Right leg", short: "R leg" },
] as const;

const BONKS = ["Bonk!", "Oof!", "Thud!", "Ow!"];

function layout(w: number, h: number) {
  const groundY = h - Math.max(34, h * 0.12);
  const s = Math.max(14, Math.min((groundY - 30) / 9.4, w / 9.2));
  return { groundY, s, cx: w * 0.52 };
}

function buildScene(w: number, h: number, played: boolean, seed: number): Scene {
  const { groundY, s, cx } = layout(w, h);
  const rig = new Rig({ cx, groundY, s, width: w });
  const crew: Puppeteer[] = CREW.map((c, i) => {
    const ax = cx + c.hx * s;
    const ay = groundY + c.hy * s;
    const cord = rig.addCord([...c.points], ax, ay);
    const rest = cord.len * (c.role === "torso" ? 0.985 : 1);
    cord.len = rest;
    cord.active = played;
    return { cord, color: CORD_COLORS[i], label: c.label, short: c.short, hx: c.hx, hy: c.hy, rest, target: rest, rate: 8 };
  });
  const solo = rig.addCord([J.lShoulder, J.rShoulder], cx, groundY - 8.4 * s);
  solo.active = false;

  // Rival ghost: smaller, further back, always marching so it is mid-stride when revealed.
  const gs = s * 0.74;
  const gx = Math.max(gs * 2, cx - 3.6 * s);
  const ghost = new Rig({ cx: gx, groundY: groundY - s * 0.3, s: gs, width: w });
  const ghostCords = [
    ghost.addCord([J.lShoulder, J.rShoulder], gx, groundY - 0.3 * s - 7.6 * gs),
    ghost.addCord([J.lFoot], gx - 1.4 * gs, groundY - 0.3 * s - 6.6 * gs),
    ghost.addCord([J.rFoot], gx + 1.4 * gs, groundY - 0.3 * s - 6.6 * gs),
  ];

  if (!played) rig.translate(0, -(h + 2 * s));
  return {
    w,
    h,
    s,
    cx,
    groundY,
    rig,
    crew,
    solo,
    ghost,
    ghostCords,
    ghostRest: ghostCords.map((c) => c.len),
    ghostX: gx,
    ghostAlpha: 0,
    minis: [],
    dust: [],
    stamps: [],
    phase: played ? "idle" : "drop",
    phaseT: 0,
    hitStop: 0,
    dizzy: 0,
    gagIn: 4.5,
    gagT: -1,
    sticker: 0,
    stickerLanded: false,
    tagAlpha: 0,
    crewAlpha: played ? 1 : 0,
    mode: null,
    launchSeen: 0,
    rand: mulberry32(seed),
  };
}

export default function HeroStage({
  name,
  stuck,
  preview,
  code,
  launchKey,
  onLand,
}: {
  name: string;
  stuck: boolean;
  preview: HeroPreview;
  code: string;
  launchKey: number;
  onLand?: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const playedRef = useRef(false);
  const propsRef = useRef({ name, stuck, preview, code, launchKey, onLand });
  const reduce = useReducedMotion();

  useEffect(() => {
    propsRef.current = { name, stuck, preview, code, launchKey, onLand };
  });

  const shake = (strength: number) => {
    if (reduce) return;
    const k = strength;
    wrapRef.current?.animate(
      [
        { transform: "translate(0, 0)" },
        { transform: `translate(${-k}px, ${k * 0.8}px)` },
        { transform: `translate(${k * 0.8}px, ${-k * 0.5}px)` },
        { transform: `translate(${-k * 0.4}px, ${k * 0.3}px)` },
        { transform: "translate(0, 0)" },
      ],
      { duration: 260, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }
    );
  };

  const frame = ({ ctx, w, h, dt, t, font, resized }: StageFrame) => {
    const props = propsRef.current;
    let sc = sceneRef.current;
    if (!sc || resized) {
      sc = buildScene(w, h, playedRef.current || reduce, 7);
      sc.launchSeen = props.launchKey;
      sceneRef.current = sc;
    }
    const { rig, s, groundY, cx } = sc;
    const narrow = w < 520;

    // ── Choreography ──────────────────────────────────────────────
    if (!reduce) {
      sc.phaseT += dt;
      if (props.launchKey !== sc.launchSeen && sc.phase !== "launch") {
        sc.launchSeen = props.launchKey;
        sc.phase = "launch";
        sc.phaseT = 0;
        rig.walls = false;
        for (const p of sc.crew) p.cord.active = false;
        sc.solo.active = false;
        rig.impulse(26 * s, -40 * s);
        rig.impulse(10 * s, -14 * s, [J.head]);
        sc.stamps.push({ text: "Wheee!", x: rig.pts[J.head].x, y: rig.pts[J.head].y - s, life: 0, rot: -0.12 });
      }

      // Mode previews.
      const mode = sc.phase === "idle" ? props.preview : null;
      if (mode !== sc.mode) {
        if (mode === "ffa") {
          for (const p of sc.crew) p.cord.active = false;
          sc.solo.ax = cx;
          sc.solo.ay = groundY - 8.4 * s;
          const c = rig.centroid(sc.solo.points);
          sc.solo.len = Math.hypot(c.x - sc.solo.ax, c.y - sc.solo.ay);
          sc.solo.active = true;
          sc.stamps.push({ text: "Snap!", x: cx, y: groundY - 7 * s, life: 0, rot: 0.1 });
          const ms = s * 0.46;
          const xs = narrow ? [0.12, 0.88] : [0.1, 0.24, 0.8, 0.92];
          sc.minis = xs.map((fx, i) => {
            const mx = w * fx;
            const mini = new Rig({ cx: mx, groundY, s: ms, width: w });
            const cord = mini.addCord([J.lShoulder, J.rShoulder], mx, groundY - 8.4 * ms);
            mini.translate(0, -(h * 0.5 + i * ms * 2));
            return { rig: mini, cord, color: CORD_COLORS[(i + 1) % CORD_COLORS.length], alpha: 1 };
          });
        } else if (sc.mode === "ffa") {
          sc.solo.active = false;
          for (const p of sc.crew) {
            const c = rig.centroid(p.cord.points);
            p.cord.len = Math.hypot(c.x - p.cord.ax, c.y - p.cord.ay);
            p.cord.active = true;
            p.target = p.rest;
            p.rate = 5;
          }
        }
        sc.mode = mode;
      }
      sc.ghostAlpha += ((mode === "versus" ? 1 : 0) - sc.ghostAlpha) * Math.min(1, dt * 9);
      sc.tagAlpha += ((mode === "join" ? 1 : 0) - sc.tagAlpha) * Math.min(1, dt * 9);
      if (mode !== "ffa") for (const m of sc.minis) m.alpha -= dt * 4;
      sc.minis = sc.minis.filter((m) => m.alpha > 0);

      if (sc.phase === "attach") {
        sc.crewAlpha = Math.min(1, sc.crewAlpha + dt * 4);
        sc.crew.forEach((p, i) => {
          if (!p.cord.active && sc.phaseT > 0.35 + i * 0.09) {
            const c = rig.centroid(p.cord.points);
            p.cord.len = Math.hypot(c.x - p.cord.ax, c.y - p.cord.ay) + s * 0.6;
            p.cord.active = true;
            p.target = p.rest;
            p.rate = 4.5;
            burst(sc.dust, p.cord.ax, p.cord.ay + 10, s * 0.6, 4, sc.rand, p.color);
          }
        });
        if (sc.phaseT > 1.6) {
          sc.phase = "idle";
          sc.phaseT = 0;
        }
      }

      // Idle: everybody tugs on their own rhythm; legs march in alternation.
      if (sc.phase === "idle" || sc.phase === "attach") {
        const [lh, rh, torso, ll, rl] = sc.crew;
        const sway = Math.sin(t * 1.9) * 0.35;
        torso.cord.ax = cx + (torso.hx + sway) * s;
        torso.cord.ay = groundY + (torso.hy + Math.sin(t * 1.3) * 0.18) * s;
        lh.cord.ax = cx + (lh.hx + Math.sin(t * 2.6) * 0.7) * s;
        lh.cord.ay = groundY + (lh.hy + Math.cos(t * 2.6) * 0.6) * s;
        rh.cord.ax = cx + (rh.hx + Math.sin(t * 2.2 + 1.7) * 0.6) * s;
        rh.cord.ay = groundY + (rh.hy + Math.cos(t * 2.2 + 1.7) * 0.7) * s;
        ll.cord.ax = cx + (ll.hx + sway * 0.6) * s;
        rl.cord.ax = cx + (rl.hx + sway * 0.6) * s;
        ll.cord.ay = groundY + ll.hy * s;
        rl.cord.ay = groundY + rl.hy * s;

        if (sc.phase === "idle" && sc.mode === null && rig.grabbedIndex === null) {
          sc.gagIn -= dt;
          if (sc.gagIn <= 0 && sc.gagT < 0) sc.gagT = 0;
        }
        if (sc.gagT >= 0) {
          // "Sync or fall": both legs yank at once, torso lets go, body eats turf.
          sc.gagT += dt;
          const g = sc.gagT;
          if (g < 1.15) {
            torso.target = torso.rest + 5 * s;
            torso.rate = 30;
            ll.target = rl.target = Math.max(s, ll.rest - 4 * s);
            ll.rate = rl.rate = 16;
            ll.cord.ay = rl.cord.ay = groundY + (ll.hy - 0.9) * s;
          } else if (g < 2.4) {
            torso.target = torso.rest;
            torso.rate = 3.2;
            ll.target = ll.rest;
            rl.target = rl.rest;
            ll.rate = rl.rate = 4;
          } else {
            sc.gagT = -1;
            sc.gagIn = 7.5;
            torso.rate = ll.rate = rl.rate = 8;
          }
          if (g > 0.32 && g - dt <= 0.32) {
            sc.stamps.push({ text: "Out of sync!", x: cx, y: groundY - 6.2 * s, life: 0, rot: -0.08 });
          }
        } else {
          const step = t * 3.4;
          ll.target = ll.rest - Math.max(0, Math.sin(step)) * 1.05 * s;
          rl.target = rl.rest - Math.max(0, -Math.sin(step)) * 1.05 * s;
          torso.target = torso.rest;
          lh.target = lh.rest;
          rh.target = rh.rest;
        }
        for (const p of sc.crew) p.cord.len += (p.target - p.cord.len) * Math.min(1, dt * p.rate);
        if (sc.solo.active) {
          sc.solo.ax = cx + sway * s;
          sc.solo.len += (sc.crew[2].rest - sc.solo.len) * Math.min(1, dt * 4);
        }
      }

      // Rival ghost marches regardless, so the reveal lands mid-stride.
      const gstep = t * 3.4 + 1.2;
      const [gt, gl, gr] = sc.ghostCords;
      const [gtRest, glRest, grRest] = sc.ghostRest;
      gt.ax = sc.ghostX + Math.sin(t * 1.9 + 0.8) * 0.3 * s;
      gt.len = gtRest;
      gl.len = glRest - Math.max(0, Math.sin(gstep)) * 1.05 * sc.ghost.s;
      gr.len = grRest - Math.max(0, -Math.sin(gstep)) * 1.05 * sc.ghost.s;

      // Sticker slap.
      const wantSticker = props.stuck && props.name.trim().length > 0;
      if (wantSticker) sc.sticker = Math.min(1, sc.sticker + dt / 0.26);
      else {
        sc.sticker = 0;
        sc.stickerLanded = false;
      }
      if (wantSticker && sc.sticker >= 1 && !sc.stickerLanded) {
        sc.stickerLanded = true;
        const c = rig.centroid([J.lShoulder, J.rShoulder, J.lHip, J.rHip]);
        burst(sc.dust, c.x, c.y, s * 0.7, 8, sc.rand, LAB.tape);
        rig.impulse(-6 * s, 2 * s, [J.lShoulder, J.rShoulder, J.head]);
        sc.stamps.push({ text: "Slap!", x: c.x + 1.6 * s, y: c.y - 1.2 * s, life: 0, rot: 0.14 });
        shake(3);
      }

      // Physics, with hit-stop on big impacts.
      if (sc.hitStop > 0) sc.hitStop -= dt;
      else {
        rig.advance(dt);
        sc.ghost.advance(dt);
        for (const m of sc.minis) m.rig.advance(dt);
      }
      sc.dizzy = Math.max(0, sc.dizzy - dt);

      const hit = rig.consumeImpact();
      if (hit && hit.speed > 13) {
        if (sc.phase === "drop") {
          playedRef.current = true;
          sc.phase = "attach";
          sc.phaseT = 0;
          sc.hitStop = 0.075;
          sc.dizzy = 1.3;
          burst(sc.dust, hit.x, hit.y, s, 12, sc.rand);
          shake(7);
          props.onLand?.();
        } else if (sc.phase !== "launch") {
          burst(sc.dust, hit.x, hit.y, s * 0.8, hit.speed > 20 ? 9 : 5, sc.rand);
          if (hit.speed > 21 && sc.gagT < 0) {
            sc.dizzy = 0.9;
            sc.stamps.push({ text: BONKS[Math.floor(sc.rand() * BONKS.length)], x: hit.x, y: hit.y - 2.4 * s, life: 0, rot: (sc.rand() - 0.5) * 0.4 });
            shake(4);
          } else if (sc.gagT >= 0 && hit.speed > 11) {
            sc.dizzy = 1.2;
            shake(3);
          }
        }
      }
      for (const m of sc.minis) m.rig.consumeImpact();
      sc.ghost.consumeImpact();
      if (sc.phase === "launch") sc.crewAlpha = Math.max(0, sc.crewAlpha - dt * 3);
    } else {
      sc.sticker = props.stuck && props.name.trim() ? 1 : 0;
      sc.tagAlpha = props.preview === "join" ? 1 : 0;
      sc.ghostAlpha = props.preview === "versus" ? 1 : 0;
    }

    // ── Draw ──────────────────────────────────────────────────────
    drawGround(ctx, w, h, groundY, s);

    if (sc.ghostAlpha > 0.02) {
      for (const c of sc.ghostCords) drawCord(ctx, sc.ghost, c, "#4FA8FF", sc.ghostAlpha * 0.5);
      drawDummy(ctx, sc.ghost, font, { alpha: sc.ghostAlpha * 0.5, tint: "#9CCBFF" });
      drawCursor(ctx, sc.ghostCords[0].ax, sc.ghostCords[0].ay, "#4FA8FF", "Rival squad", font, sc.ghostAlpha);
    }
    for (const m of sc.minis) {
      drawCord(ctx, m.rig, m.cord, m.color, m.alpha);
      drawDummy(ctx, m.rig, font, { alpha: m.alpha, tint: m.color });
      drawCursor(ctx, m.cord.ax, m.cord.ay, m.color, "Racer", font, m.alpha * 0.95);
    }

    const showName = props.stuck && props.name.trim() ? props.name.trim() : "";
    for (const p of sc.crew) if (p.cord.active) drawCord(ctx, rig, p.cord, p.color);
    if (sc.solo.active) drawCord(ctx, rig, sc.solo, LAB.ink);
    drawDummy(ctx, rig, font, {
      dizzy: sc.dizzy > 0,
      name: showName,
      sticker: sc.sticker,
      tag: sc.tagAlpha > 0.01 ? { text: props.code.trim() || "?", alpha: sc.tagAlpha } : null,
    });
    if (sc.crewAlpha > 0.01) {
      sc.crew.forEach((p, i) => {
        const hidden = sc.mode === "ffa";
        const label = i === 3 && showName ? showName : narrow ? p.short : p.label;
        drawCursor(ctx, p.cord.ax, p.cord.ay, p.color, label, font, sc.crewAlpha * (hidden ? 0.25 : 1), p.hx < 0);
      });
      if (sc.solo.active) drawCursor(ctx, sc.solo.ax, sc.solo.ay, LAB.paper, showName || "You", font);
    }
    stepParticles(ctx, sc.dust, reduce ? 0 : dt);
    drawStamps(ctx, sc.stamps, reduce ? 0 : dt, s, font);
  };

  const redraw = useStageLoop(canvasRef, frame, reduce);
  useEffect(() => {
    if (reduce) redraw();
  }, [reduce, redraw, name, stuck, preview, code]);

  // Pointer grab: any joint, mouse or touch. Optional, never needed to proceed.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || reduce) return;
    let released: Cord[] = [];
    const local = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = (e: PointerEvent) => {
      const sc = sceneRef.current;
      if (!sc || sc.phase === "launch") return;
      const { x, y } = local(e);
      const i = sc.rig.nearest(x, y, sc.s * 1.1);
      if (i === null) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      sc.rig.grab(i, x, y);
      released = [...sc.crew.map((p) => p.cord), sc.solo].filter((c) => c.active && c.points.includes(i));
      for (const c of released) c.active = false;
      canvas.style.cursor = "grabbing";
    };
    const move = (e: PointerEvent) => {
      const sc = sceneRef.current;
      if (!sc) return;
      const { x, y } = local(e);
      if (sc.rig.grabbedIndex !== null) sc.rig.moveGrab(x, y);
      else canvas.style.cursor = sc.rig.nearest(x, y, sc.s * 1.1) !== null ? "grab" : "";
    };
    const up = () => {
      const sc = sceneRef.current;
      if (!sc || sc.rig.grabbedIndex === null) return;
      sc.rig.release();
      for (const c of released) {
        const cen = sc.rig.centroid(c.points);
        c.len = Math.max(c.len, Math.hypot(cen.x - c.ax, cen.y - c.ay));
        c.active = true;
      }
      released = [];
      canvas.style.cursor = "";
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }, [reduce]);

  return (
    <div ref={wrapRef} className="lab-stage">
      <canvas
        ref={canvasRef}
        className="lab-stage-canvas"
        role="img"
        aria-label="A yellow crash-test dummy dangling from five colored cords, one per player. It marches, and falls over when the legs pull together."
      />
    </div>
  );
}
