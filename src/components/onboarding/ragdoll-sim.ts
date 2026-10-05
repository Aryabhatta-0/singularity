// A tiny 2D verlet ragdoll for the onboarding screens. No DOM, no React:
// the landing hero, the legs trainer and the unit tests all drive it the same way.
// Units are CSS pixels; `s` is the body unit (one thigh ≈ 1.2s).

export const J = {
  head: 0,
  lShoulder: 1,
  rShoulder: 2,
  lHip: 3,
  rHip: 4,
  lElbow: 5,
  lHand: 6,
  rElbow: 7,
  rHand: 8,
  lKnee: 9,
  lFoot: 10,
  rKnee: 11,
  rFoot: 12,
  tag: 13,
} as const;

export type Joint = (typeof J)[keyof typeof J];

export interface RigPoint {
  x: number;
  y: number;
  px: number;
  py: number;
  r: number;
}

interface Stick {
  a: number;
  b: number;
  len: number;
  k: number;
  /** min: only pushes apart; max: only pulls together. */
  kind: "rigid" | "min";
}

/** A rope from a puppeteer's cursor to one or more points (it pulls their centroid). */
export interface Cord {
  points: number[];
  ax: number;
  ay: number;
  len: number;
  active: boolean;
}

export interface Impact {
  speed: number;
  x: number;
  y: number;
}

const SUBSTEP = 1 / 120;
const ITERATIONS = 10;

/** Standing pose, feet on the ground at `groundY`, centered on `cx`. */
export function standingPose(cx: number, groundY: number, s: number): [number, number][] {
  const g = groundY;
  return [
    [cx, g - 5.15 * s], // head
    [cx - 0.68 * s, g - 4.1 * s], // l shoulder
    [cx + 0.68 * s, g - 4.1 * s], // r shoulder
    [cx - 0.48 * s, g - 2.45 * s], // l hip
    [cx + 0.48 * s, g - 2.45 * s], // r hip
    [cx - 1.15 * s, g - 3.2 * s], // l elbow
    [cx - 1.4 * s, g - 2.3 * s], // l hand
    [cx + 1.15 * s, g - 3.2 * s], // r elbow
    [cx + 1.4 * s, g - 2.3 * s], // r hand
    [cx - 0.55 * s, g - 1.27 * s], // l knee
    [cx - 0.6 * s, g - 0.3 * s], // l foot
    [cx + 0.55 * s, g - 1.27 * s], // r knee
    [cx + 0.6 * s, g - 0.3 * s], // r foot
    [cx + 1.45 * s, g - 1.45 * s], // luggage tag, hangs off the right hand
  ];
}

const RADII = [0.58, 0.3, 0.3, 0.3, 0.3, 0.26, 0.28, 0.26, 0.28, 0.28, 0.3, 0.28, 0.3, 0.2];

export class Rig {
  pts: RigPoint[];
  cords: Cord[] = [];
  s: number;
  groundY: number;
  width: number;
  gravity: number;
  /** Walls keep the body on stage; the legs trainer turns them off and wraps instead. */
  walls = true;
  private sticks: Stick[] = [];
  private acc = 0;
  private grabbed: { i: number; x: number; y: number } | null = null;
  private impact: Impact | null = null;

  constructor(opts: { cx: number; groundY: number; s: number; width: number }) {
    this.s = opts.s;
    this.groundY = opts.groundY;
    this.width = opts.width;
    this.gravity = 26 * opts.s;
    const pose = standingPose(opts.cx, opts.groundY, opts.s);
    this.pts = pose.map(([x, y], i) => ({ x, y, px: x, py: y, r: RADII[i] * opts.s }));

    const rigid = (a: number, b: number, k = 1) => this.link(a, b, k, "rigid");
    // Torso is a braced box so it visibly rotates when yanked.
    rigid(J.lShoulder, J.rShoulder);
    rigid(J.lHip, J.rHip);
    rigid(J.lShoulder, J.lHip);
    rigid(J.rShoulder, J.rHip);
    rigid(J.lShoulder, J.rHip);
    rigid(J.rShoulder, J.lHip);
    // Head on a stiff-ish neck.
    rigid(J.head, J.lShoulder);
    rigid(J.head, J.rShoulder);
    rigid(J.head, J.lHip, 0.12);
    rigid(J.head, J.rHip, 0.12);
    // Limbs: deliberately floppy.
    rigid(J.lShoulder, J.lElbow);
    rigid(J.lElbow, J.lHand);
    rigid(J.rShoulder, J.rElbow);
    rigid(J.rElbow, J.rHand);
    rigid(J.lHip, J.lKnee);
    rigid(J.lKnee, J.lFoot);
    rigid(J.rHip, J.rKnee);
    rigid(J.rKnee, J.rFoot);
    rigid(J.rHand, J.tag);
    // Keep knees and feet from crossing through each other.
    this.link(J.lKnee, J.rKnee, 0.5, "min", 0.7 * opts.s);
    this.link(J.lFoot, J.rFoot, 0.5, "min", 0.6 * opts.s);
  }

  private link(a: number, b: number, k: number, kind: Stick["kind"], len?: number) {
    const pa = this.pts[a];
    const pb = this.pts[b];
    this.sticks.push({ a, b, k, kind, len: len ?? Math.hypot(pb.x - pa.x, pb.y - pa.y) });
  }

  /** Rest length of a rigid link, for tests and drawing. */
  restLength(a: number, b: number): number {
    const st = this.sticks.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
    return st ? st.len : NaN;
  }

  addCord(points: number[], ax: number, ay: number, len?: number): Cord {
    const c = this.centroid(points);
    const cord: Cord = { points, ax, ay, len: len ?? Math.hypot(c.x - ax, c.y - ay), active: true };
    this.cords.push(cord);
    return cord;
  }

  centroid(points: number[]): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const i of points) {
      x += this.pts[i].x;
      y += this.pts[i].y;
    }
    return { x: x / points.length, y: y / points.length };
  }

  /** Bottom-most point of the body, ignoring the luggage tag. */
  lowestY(): number {
    let y = -Infinity;
    for (let i = 0; i < J.tag; i++) y = Math.max(y, this.pts[i].y);
    return y;
  }

  grab(i: number, x: number, y: number) {
    this.grabbed = { i, x, y };
  }

  moveGrab(x: number, y: number) {
    if (this.grabbed) {
      this.grabbed.x = x;
      this.grabbed.y = y;
    }
  }

  release() {
    this.grabbed = null;
  }

  get grabbedIndex(): number | null {
    return this.grabbed?.i ?? null;
  }

  /** Add velocity (px/s) to some points, or all of them. */
  impulse(vx: number, vy: number, which?: number[]) {
    const list = which ?? this.pts.map((_, i) => i);
    for (const i of list) {
      this.pts[i].px -= vx * SUBSTEP;
      this.pts[i].py -= vy * SUBSTEP;
    }
  }

  translate(dx: number, dy: number) {
    for (const p of this.pts) {
      p.x += dx;
      p.px += dx;
      p.y += dy;
      p.py += dy;
    }
  }

  /** Nearest point within `radius`, for pointer grabbing. */
  nearest(x: number, y: number, radius: number): number | null {
    let best: number | null = null;
    let bestD = radius;
    for (let i = 0; i < J.tag; i++) {
      const d = Math.hypot(this.pts[i].x - x, this.pts[i].y - y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** The hardest ground hit since the last call, in units of `s` per second. */
  consumeImpact(): Impact | null {
    const hit = this.impact;
    this.impact = null;
    return hit;
  }

  /** Advance by real time; runs fixed substeps so behaviour is frame-rate independent. */
  advance(dt: number) {
    this.acc = Math.min(this.acc + dt, 0.1);
    while (this.acc >= SUBSTEP) {
      this.step();
      this.acc -= SUBSTEP;
    }
  }

  step() {
    const dt = SUBSTEP;
    const g = this.gravity * dt * dt;
    for (const p of this.pts) {
      const vx = (p.x - p.px) * 0.996;
      const vy = (p.y - p.py) * 0.996;
      p.px = p.x;
      p.py = p.y;
      p.x += vx;
      p.y += vy + g;
    }
    for (let it = 0; it < ITERATIONS; it++) {
      this.solveGrab();
      for (const st of this.sticks) this.solveStick(st);
      for (const c of this.cords) if (c.active) this.solveCord(c);
      this.collide();
    }
  }

  private solveGrab() {
    if (!this.grabbed) return;
    const p = this.pts[this.grabbed.i];
    p.x += (this.grabbed.x - p.x) * 0.5;
    p.y += (this.grabbed.y - p.y) * 0.5;
  }

  private solveStick(st: Stick) {
    const a = this.pts[st.a];
    const b = this.pts[st.b];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 0.0001;
    if (st.kind === "min" && d >= st.len) return;
    const diff = ((d - st.len) / d) * 0.5 * st.k;
    a.x += dx * diff;
    a.y += dy * diff;
    b.x -= dx * diff;
    b.y -= dy * diff;
  }

  private solveCord(c: Cord) {
    const cen = this.centroid(c.points);
    const dx = c.ax - cen.x;
    const dy = c.ay - cen.y;
    const d = Math.hypot(dx, dy) || 0.0001;
    if (d <= c.len) return; // ropes only pull
    const pull = ((d - c.len) / d) * 0.6;
    for (const i of c.points) {
      if (this.grabbed?.i === i) continue;
      this.pts[i].x += dx * pull;
      this.pts[i].y += dy * pull;
    }
  }

  private collide() {
    for (let i = 0; i < this.pts.length; i++) {
      const p = this.pts[i];
      const floor = this.groundY - p.r;
      if (p.y > floor) {
        const vy = p.y - p.py;
        if (i !== J.tag && vy > 0) {
          const speed = vy / SUBSTEP / this.s;
          if (!this.impact || speed > this.impact.speed) this.impact = { speed, x: p.x, y: this.groundY };
        }
        p.y = floor;
        // Ground friction: feet plant, bodies skid to a stop.
        p.px = p.x - (p.x - p.px) * 0.55;
        p.py = p.y + vy * 0.18;
      }
      if (this.walls) {
        if (p.x < p.r) {
          p.x = p.r;
          p.px = p.x + (p.x - p.px) * 0.4;
        } else if (p.x > this.width - p.r) {
          p.x = this.width - p.r;
          p.px = p.x + (p.x - p.px) * 0.4;
        }
      }
    }
  }
}
