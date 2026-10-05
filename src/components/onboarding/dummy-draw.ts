// Canvas drawing for the crash-test dummy. Sticker style: every shape gets the
// same ink outline so the dummy, cords and cursors read as one cartoon.
import { J, type Rig } from "./ragdoll-sim";

export const LAB = {
  sky: "#BFE4FF",
  turf: "#3FB55A",
  turfDeep: "#2E8F45",
  dummy: "#FFD21A",
  ink: "#14202E",
  tape: "#FF4F2E",
  paper: "#FFFFFF",
};

/** Puppeteer colors: team spot inks, minus yellow (it vanishes against the dummy). */
export const CORD_COLORS = ["#FF5D5D", "#4FA8FF", "#FF9A3C", "#6EF29A", "#C58BFF"];

export interface DrawOpts {
  alpha?: number;
  /** Tint replaces dummy yellow, used for rival ghosts and mini racers. */
  tint?: string;
  dizzy?: boolean;
  name?: string;
  /** 0..1 sticker slap progress; 1 = stuck flat. */
  sticker?: number;
  tag?: { text: string; alpha: number } | null;
}

const outline = (s: number) => Math.max(2.5, s * 0.085);

function seg(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, w: number, fill: string, ink: number) {
  ctx.lineCap = "round";
  ctx.strokeStyle = LAB.ink;
  ctx.lineWidth = w + ink * 2;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.strokeStyle = fill;
  ctx.lineWidth = w;
  ctx.stroke();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, ink: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = ink;
  ctx.strokeStyle = LAB.ink;
  ctx.stroke();
}

/** The crash-test calibration target: a circle in ink/yellow quadrants. */
export function target(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot = 0, fill = LAB.dummy) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.fillStyle = LAB.ink;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, r, 0, Math.PI / 2);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, r, Math.PI, Math.PI * 1.5);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, r * 0.18);
  ctx.strokeStyle = LAB.ink;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function drawGround(ctx: CanvasRenderingContext2D, w: number, h: number, groundY: number, s: number, scroll = 0) {
  ctx.fillStyle = LAB.turf;
  ctx.fillRect(0, groundY, w, h - groundY);
  // Mown stripes, scrolled by the legs trainer so walking reads as progress.
  ctx.fillStyle = LAB.turfDeep;
  const stripe = s * 1.6;
  const off = ((scroll % (stripe * 2)) + stripe * 2) % (stripe * 2);
  for (let x = -stripe * 2 - off; x < w + stripe * 2; x += stripe * 2) {
    ctx.beginPath();
    ctx.moveTo(x, groundY);
    ctx.lineTo(x + stripe, groundY);
    ctx.lineTo(x + stripe - s * 0.8, h);
    ctx.lineTo(x - s * 0.8, h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = LAB.ink;
  ctx.fillRect(0, groundY - 1.5, w, 3);
}

export function drawCord(ctx: CanvasRenderingContext2D, rig: Rig, cord: { points: number[]; ax: number; ay: number; len: number }, color: string, alpha = 1) {
  const c = rig.centroid(cord.points);
  const d = Math.hypot(c.x - cord.ax, c.y - cord.ay);
  const slack = Math.max(0, cord.len - d);
  const mx = (c.x + cord.ax) / 2;
  const my = (c.y + cord.ay) / 2 + Math.min(slack * 0.6, rig.s * 2.5);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.lineCap = "round";
  for (const [style, width] of [
    [LAB.ink, 5],
    [color, 2.5],
  ] as const) {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(cord.ax, cord.ay);
    ctx.quadraticCurveTo(mx, my, c.x, c.y);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawCursor(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, label: string, font: string, alpha = 1, labelLeft = false) {
  // Screen-space x (the legs trainer pans the canvas), for edge checks.
  const maxX = ctx.canvas.clientWidth || Infinity;
  const m = ctx.getTransform();
  const sx = (m.a * x + m.e) / (ctx.canvas.width / (ctx.canvas.clientWidth || 1));
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  // Classic arrow pointer, tip at the cord anchor.
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 19);
  ctx.lineTo(5, 14.5);
  ctx.lineTo(8.5, 22);
  ctx.lineTo(12, 20.5);
  ctx.lineTo(8.6, 13.2);
  ctx.lineTo(14.5, 13);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineJoin = "round";
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = LAB.ink;
  ctx.stroke();
  ctx.font = `700 12px ${font}`;
  const tw = ctx.measureText(label).width;
  // Labels hang off the outer side so neighbouring cursors don't collide,
  // and flip inward rather than run off the stage edge.
  const left = labelLeft ? sx - tw - 18 > 4 : sx + tw + 31 > maxX - 4;
  const bx = left ? -tw - 18 : 13;
  const by = left ? 20 : 18;
  ctx.beginPath();
  ctx.roundRect(bx, by, tw + 14, 20, 10);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = LAB.ink;
  ctx.textBaseline = "middle";
  ctx.fillText(label, bx + 7, by + 10.5);
  ctx.restore();
}

export function drawDummy(ctx: CanvasRenderingContext2D, rig: Rig, font: string, opts: DrawOpts = {}) {
  const p = rig.pts;
  const s = rig.s;
  const ink = outline(s);
  const body = opts.tint ?? LAB.dummy;
  ctx.save();
  ctx.globalAlpha *= opts.alpha ?? 1;

  // Luggage tag hangs behind the hand.
  if (opts.tag && opts.tag.alpha > 0.01) {
    ctx.save();
    ctx.globalAlpha *= opts.tag.alpha;
    const h = p[J.rHand];
    const t = p[J.tag];
    ctx.strokeStyle = LAB.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(h.x, h.y);
    ctx.lineTo(t.x, t.y);
    ctx.stroke();
    const ang = Math.atan2(t.y - h.y, t.x - h.x) - Math.PI / 2;
    ctx.translate(t.x, t.y);
    ctx.rotate(ang);
    ctx.font = `800 ${Math.round(s * 0.42)}px ${font}`;
    const tw = Math.max(ctx.measureText(opts.tag.text).width, s * 1.2);
    ctx.beginPath();
    ctx.roundRect(-tw / 2 - s * 0.25, 0, tw + s * 0.5, s * 0.8, s * 0.14);
    ctx.fillStyle = LAB.paper;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = LAB.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(opts.tag.text, 0, s * 0.42);
    ctx.restore();
  }

  // Legs, then torso, then arms, then head.
  for (const [hip, knee, foot] of [
    [J.lHip, J.lKnee, J.lFoot],
    [J.rHip, J.rKnee, J.rFoot],
  ]) {
    seg(ctx, p[hip].x, p[hip].y, p[knee].x, p[knee].y, s * 0.66, body, ink);
    seg(ctx, p[knee].x, p[knee].y, p[foot].x, p[foot].y, s * 0.58, body, ink);
    dot(ctx, p[foot].x, p[foot].y, s * 0.34, LAB.ink, ink);
  }

  const ls = p[J.lShoulder];
  const rs = p[J.rShoulder];
  const lh = p[J.lHip];
  const rh = p[J.rHip];
  ctx.beginPath();
  const pad = s * 0.28;
  const cx = (ls.x + rs.x + lh.x + rh.x) / 4;
  const cy = (ls.y + rs.y + lh.y + rh.y) / 4;
  const grow = (pt: { x: number; y: number }) => {
    const dx = pt.x - cx;
    const dy = pt.y - cy;
    const d = Math.hypot(dx, dy) || 1;
    return [pt.x + (dx / d) * pad, pt.y + (dy / d) * pad] as const;
  };
  const corners = [grow(ls), grow(rs), grow(rh), grow(lh)];
  ctx.moveTo((corners[0][0] + corners[1][0]) / 2, (corners[0][1] + corners[1][1]) / 2);
  for (let i = 1; i <= 4; i++) {
    const c = corners[i % 4];
    const n = corners[(i + 1) % 4];
    ctx.arcTo(c[0], c[1], (c[0] + n[0]) / 2, (c[1] + n[1]) / 2, s * 0.42);
  }
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = ink;
  ctx.strokeStyle = LAB.ink;
  ctx.lineJoin = "round";
  ctx.stroke();
  // Belt of hazard tape across the hips.
  const spine = Math.atan2(rs.y - ls.y, rs.x - ls.x);
  seg(ctx, lh.x, lh.y - s * 0.05, rh.x, rh.y - s * 0.05, s * 0.18, LAB.ink, 0);
  target(ctx, ls.x + (rs.x - ls.x) * 0.25 + (lh.x - ls.x) * 0.3, ls.y + (rs.y - ls.y) * 0.25 + (lh.y - ls.y) * 0.3, s * 0.2, spine, body);

  if (opts.name && (opts.sticker ?? 0) > 0) drawSticker(ctx, rig, opts.name, opts.sticker ?? 1, font);

  for (const [sh, el, hand] of [
    [J.lShoulder, J.lElbow, J.lHand],
    [J.rShoulder, J.rElbow, J.rHand],
  ]) {
    seg(ctx, p[sh].x, p[sh].y, p[el].x, p[el].y, s * 0.52, body, ink);
    seg(ctx, p[el].x, p[el].y, p[hand].x, p[hand].y, s * 0.46, body, ink);
    dot(ctx, p[hand].x, p[hand].y, s * 0.3, body, ink);
  }

  const hd = p[J.head];
  const neckX = (ls.x + rs.x) / 2;
  const neckY = (ls.y + rs.y) / 2;
  seg(ctx, neckX, neckY, hd.x, hd.y, s * 0.36, body, ink);
  dot(ctx, hd.x, hd.y, s * 0.6, body, ink);
  const tilt = Math.atan2(hd.y - neckY, hd.x - neckX) + Math.PI / 2;
  target(ctx, hd.x + Math.cos(tilt + Math.PI) * s * 0.3, hd.y + Math.sin(tilt + Math.PI) * s * 0.3 - s * 0.18, s * 0.17, tilt, body);
  // Face: two dots, or X eyes after a hard hit.
  ctx.save();
  ctx.translate(hd.x, hd.y);
  ctx.rotate(tilt);
  ctx.strokeStyle = LAB.ink;
  ctx.fillStyle = LAB.ink;
  ctx.lineWidth = Math.max(2, s * 0.08);
  ctx.lineCap = "round";
  for (const ex of [-0.2, 0.2]) {
    const x = ex * s + s * 0.08;
    const y = s * 0.02;
    if (opts.dizzy) {
      const r = s * 0.09;
      ctx.beginPath();
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x + r, y - r);
      ctx.lineTo(x - r, y + r);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, s * 0.075, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  ctx.restore();
}

function drawSticker(ctx: CanvasRenderingContext2D, rig: Rig, name: string, t: number, font: string) {
  const p = rig.pts;
  const s = rig.s;
  const cx = (p[J.lShoulder].x + p[J.rShoulder].x + p[J.lHip].x + p[J.rHip].x) / 4;
  // High on the chest, between the shoulders, so the arms don't cover it.
  const cy = (p[J.lShoulder].y * 3 + p[J.rShoulder].y * 3 + p[J.lHip].y + p[J.rHip].y) / 8 + s * 0.05;
  const ang = Math.atan2(p[J.rShoulder].y - p[J.lShoulder].y, p[J.rShoulder].x - p[J.lShoulder].x) - 0.12;
  // Slap: comes in big and spun, lands flat.
  const k = Math.min(1, t);
  const scale = 1 + (1 - k) * 1.6;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang + (1 - k) * 0.9);
  ctx.scale(scale, scale);
  ctx.globalAlpha *= Math.min(1, k * 2.5);
  const w = s * 1.3;
  const h = s * 0.86;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, s * 0.14);
  ctx.fillStyle = LAB.paper;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = LAB.ink;
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h * 0.36, [s * 0.14, s * 0.14, 0, 0]);
  ctx.fillStyle = LAB.tape;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = LAB.paper;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${Math.max(7, s * 0.2)}px ${font}`;
  ctx.fillText("HELLO", 0, -h / 2 + h * 0.19);
  ctx.fillStyle = LAB.ink;
  let size = s * 0.36;
  ctx.font = `800 ${size}px ${font}`;
  while (ctx.measureText(name).width > w * 0.86 && size > 6) {
    size -= 1;
    ctx.font = `800 ${size}px ${font}`;
  }
  ctx.fillText(name, 0, h * 0.17);
  ctx.restore();
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  r: number;
  color: string;
}

export function burst(list: Particle[], x: number, y: number, s: number, count: number, rand: () => number, color = "#F5EBD7") {
  for (let i = 0; i < count; i++) {
    const a = Math.PI + rand() * Math.PI;
    const v = (2 + rand() * 5) * s;
    list.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6, life: 0, max: 0.35 + rand() * 0.35, r: (0.18 + rand() * 0.28) * s, color });
  }
  if (list.length > 60) list.splice(0, list.length - 60);
}

export function stepParticles(ctx: CanvasRenderingContext2D, list: Particle[], dt: number) {
  for (let i = list.length - 1; i >= 0; i--) {
    const q = list[i];
    q.life += dt;
    if (q.life >= q.max) {
      list.splice(i, 1);
      continue;
    }
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    q.vx *= 0.9;
    q.vy = q.vy * 0.9 - 20 * dt;
    const k = 1 - q.life / q.max;
    ctx.globalAlpha = k;
    dot(ctx, q.x, q.y, q.r * (0.6 + 0.6 * (1 - k)), q.color, 2);
  }
  ctx.globalAlpha = 1;
}

/** A comic text stamp ("Bonk!") that pops in and fades. */
export interface Stamp {
  text: string;
  x: number;
  y: number;
  life: number;
  rot: number;
}

export function drawStamps(ctx: CanvasRenderingContext2D, list: Stamp[], dt: number, s: number, font: string) {
  for (let i = list.length - 1; i >= 0; i--) {
    const st = list[i];
    st.life += dt;
    if (st.life > 1.1) {
      list.splice(i, 1);
      continue;
    }
    const pop = Math.min(1, st.life / 0.12);
    const scale = st.life < 0.12 ? 1.6 - 0.6 * pop : 1;
    const alpha = st.life > 0.8 ? 1 - (st.life - 0.8) / 0.3 : 1;
    ctx.save();
    ctx.translate(st.x, st.y - st.life * s * 0.6);
    ctx.rotate(st.rot);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    ctx.font = `900 ${Math.round(s * 0.95)}px ${font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(4, s * 0.18);
    ctx.strokeStyle = LAB.ink;
    ctx.strokeText(st.text, 0, 0);
    ctx.fillStyle = LAB.paper;
    ctx.fillText(st.text, 0, 0);
    ctx.restore();
  }
}
