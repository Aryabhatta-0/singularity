import * as THREE from "three";
import type { LevelDef, StaticDef, ZoneDef } from "./levels";
import { INK, PALETTE, courseTheme, type CourseTheme } from "./visual-theme";
import {
  Frame,
  GeometryBatcher,
  addBox,
  addChevron,
  addCylinder,
  addDisc,
  addRock,
  addRounded,
  addSphere,
  addStripes,
  addTuft,
  addCone,
  geo,
  seededRandom,
  type Batch,
  type V3,
} from "./environment-kit";
import { canvasTexture, outlineMaterial, ownedToyMaterial, toyMaterial } from "./materials";
import { foamMaterial, foamRingGeometry } from "./atmosphere";
import { decorateCourse } from "./course-scenery";

/**
 * Turns a LevelDef's collision boxes into a dressed course. Collision stays
 * exactly as defined in levels.ts; this module only adds visuals:
 *
 * - every static is styled by what it DOES (ground, hazard, climbable, rail,
 *   bridge, mover) so the same grammar reads on every course
 * - the course's own scenery comes from course-scenery.ts
 * - checkpoints, finish arch, delivery target and hoop share one language
 *
 * Static visuals merge into a few draw calls; movers and anything that
 * animates get their own small groups.
 */

export type StaticRole = "ground" | "hurdle" | "bar" | "backboard" | "rail" | "wall" | "block" | "bridge" | "ramp" | "pedestal" | "goalPedestal" | "pillar" | "ferry" | "bumper";

export function classifyStatic(s: StaticDef, level: LevelDef): StaticRole {
  const [, h, d] = s.size;
  const bottom = s.pos[1] - h / 2;
  if (s.slide) return s.kind === "ferry" ? "ferry" : "bumper";
  switch (s.kind) {
    case "ground":
      return "ground";
    case "hurdle":
      return "hurdle";
    case "bridge":
      return "bridge";
    case "ramp":
      return "ramp";
    case "pillar":
      return "pillar";
    case "pedestal": {
      const z = level.deliver;
      if (z && Math.abs(z.pos[0] - s.pos[0]) < s.size[0] / 2 && Math.abs(z.pos[2] - s.pos[2]) < s.size[2] / 2) return "goalPedestal";
      return "pedestal";
    }
    case "wall":
      if (level.hoop && d < 0.2 && s.pos[1] > 2) return "backboard";
      if (bottom > 0.6) return "bar";
      return h <= 1.2 ? "rail" : "wall";
    default:
      return "block";
  }
}

export interface CourseUpdate {
  time: number;
  dt: number;
  player: THREE.Vector3;
  carrying: boolean;
  delivered: boolean;
  checkpoint: number;
  score: number;
  reducedMotion: boolean;
}

/** Shared build context handed to scenery decorators. */
export interface BuildContext {
  level: LevelDef;
  theme: CourseTheme;
  /** Course pieces: cast and receive shadows. */
  b: GeometryBatcher;
  /** Far scenery: receives light only, never casts shadows. */
  scenery: GeometryBatcher;
  group: THREE.Group;
  waterLevel: number;
  rng: () => number;
  compact: boolean;
  animate: (fn: (u: CourseUpdate) => void) => void;
  own: <T extends THREE.Material | THREE.BufferGeometry | THREE.Texture>(r: T) => T;
  /** Moments the scenery can react to ("score", "finish", "checkpoint"). */
  onMoment: (fn: (kind: string, value?: number) => void) => void;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();

function staticMatrix(s: StaticDef) {
  _q.setFromEuler(_e.set(s.rot?.[0] ?? 0, s.rot?.[1] ?? 0, s.rot?.[2] ?? 0));
  return new THREE.Matrix4().compose(new THREE.Vector3(...s.pos), _q, new THREE.Vector3(1, 1, 1));
}

interface Eyes {
  group: THREE.Group;
  pupils: THREE.Mesh[];
}

export class CourseView {
  group = new THREE.Group();
  /** Visual group for each sliding static, keyed by its index in level.statics. */
  movers = new Map<number, THREE.Group>();
  private animators: ((u: CourseUpdate) => void)[] = [];
  private momentHandlers: ((kind: string, value?: number) => void)[] = [];
  private owned: (THREE.Material | THREE.BufferGeometry | THREE.Texture)[] = [];
  private checkpointSetters: ((active: boolean, instant: boolean) => void)[] = [];
  private checkpointState = -1;
  theme: CourseTheme;

  constructor(public level: LevelDef, private compact: boolean) {
    this.theme = courseTheme(level.id);
  }

  own<T extends THREE.Material | THREE.BufferGeometry | THREE.Texture>(r: T): T {
    this.owned.push(r);
    return r;
  }

  animate(fn: (u: CourseUpdate) => void) {
    this.animators.push(fn);
  }

  build() {
    const level = this.level;
    const theme = this.theme;
    const b = new GeometryBatcher();
    const scenery = new GeometryBatcher();
    const waterLevel = theme.water.level;
    const ctx: BuildContext = {
      level,
      theme,
      b,
      scenery,
      group: this.group,
      waterLevel,
      rng: seededRandom(`course:${level.id}`),
      compact: this.compact,
      animate: (fn) => this.animate(fn),
      own: (r) => this.own(r),
      onMoment: (fn) => this.momentHandlers.push(fn),
    };

    level.statics.forEach((s, index) => {
      const role = classifyStatic(s, level);
      if (role === "ferry" || role === "bumper") {
        const mover = this.buildMover(s, role, ctx);
        this.movers.set(index, mover);
        this.group.add(mover);
        return;
      }
      buildStatic(new Frame(b, staticMatrix(s)), s, role, ctx, index);
      if (role === "bar") this.addSign(s, "DUCK!", "↓", [0, 0, s.size[2] / 2 + 0.02], 0);
    });

    // shoreline foam where island skirts meet the water
    if (theme.surface !== "snow") this.buildFoam(ctx);

    level.checkpoints.forEach((cp, i) => this.buildCheckpoint(cp, i, ctx));
    if (level.finish) this.buildFinish(level.finish, ctx);
    if (level.deliver) this.buildDelivery(level.deliver, ctx);
    if (level.hoop) this.buildHoop(ctx);

    decorateCourse(ctx);

    for (const mesh of b.build()) this.group.add(mesh);
    for (const mesh of scenery.build()) {
      mesh.castShadow = false;
      this.group.add(mesh);
    }
    return this;
  }

  /* ------------------------------ movers ------------------------------ */

  private buildMover(s: StaticDef, role: "ferry" | "bumper", ctx: BuildContext) {
    const group = new THREE.Group();
    const mb = new GeometryBatcher();
    const f = new Frame(mb, new THREE.Matrix4().makeRotationFromEuler(_e.set(s.rot?.[0] ?? 0, s.rot?.[1] ?? 0, s.rot?.[2] ?? 0)));
    const [w, h, d] = s.size;
    const theme = ctx.theme;
    if (role === "ferry") {
      const deck = s.top ?? theme.accent;
      const hull = s.color ?? theme.wood.side;
      const icy = theme.surface === "snow";
      addRounded(f, [0, 0, 0], [w, h, d], 0.07, deck, icy ? "ice" : "plastic");
      // plank seams across the deck
      for (let z = -d / 2 + 0.45; z < d / 2 - 0.2; z += 0.45) addBox(f, [0, h / 2 + 0.004, z], [w * 0.92, 0.012, 0.035], shade(deck, -0.18), "matte");
      // slide-direction chevrons on both ends
      const axisYaw = s.slide!.axis === "x" ? Math.PI / 2 : 0;
      for (const sgn of [-1, 1]) {
        const px = s.slide!.axis === "x" ? sgn * (w / 2 - 0.32) : 0;
        const pz = s.slide!.axis === "z" ? sgn * (d / 2 - 0.32) : 0;
        addChevron(f, [px, h / 2 + 0.008, pz], axisYaw + (sgn > 0 ? Math.PI : 0), 0.34, "#ffffff", "matte");
      }
      if (icy) {
        // jagged ice underside: it floats on the wind, not water
        const rng = seededRandom(`floe:${s.pos.join(",")}`);
        for (let i = 0; i < 7; i++) {
          const x = (rng() - 0.5) * w * 0.7;
          const z = (rng() - 0.5) * d * 0.7;
          const len = 0.6 + rng() * 0.9;
          addCone(f, [x, -h / 2 - len / 2, z], 0.25 + rng() * 0.2, len, i % 2 ? hull : "#bff8f2", "ice", 5, [Math.PI, rng(), 0]);
        }
        addRounded(f, [0, -h / 2 - 0.06, 0], [w * 0.9, 0.14, d * 0.9], 0.05, "#bff8f2", "ice");
      } else {
        // pontoons and tyre bumpers
        for (const sx of [-1, 1]) {
          f.add(geo.cylinder(14), { pos: [sx * (w / 2 - 0.38), -h / 2 - 0.12, 0], rot: [Math.PI / 2, 0, 0], scale: [0.48, d * 0.92, 0.48] }, hull, "plastic");
          for (const sz of [-1, 1]) {
            f.add(geo.torus(0.32, 14), { pos: [sx * (w / 2 + 0.03), -0.02, sz * d * 0.25], rot: [0, Math.PI / 2, 0], scale: [0.26, 0.26, 0.26] }, INK, "rubber");
          }
        }
        // a little flag so motion reads at a glance
        f.add(geo.cylinder(6), { pos: [w / 2 - 0.15, h / 2 + 0.45, -d / 2 + 0.15], scale: [0.05, 0.9, 0.05] }, "#f4f4f4", "metal");
      }
      for (const m of mb.build()) group.add(m);
      if (!icy) {
        const flag = new THREE.Mesh(ctx.own(flagGeometry(0.5, 0.3)), toyMaterial(PALETTE.tape, "cloth"));
        flag.position.set(w / 2 - 0.15, h / 2 + 0.88, -d / 2 + 0.15);
        flag.rotation.y = Math.PI / 2;
        group.add(flag);
        const foam = new THREE.Mesh(ctx.own(foamRingGeometry(w * 0.95, d * 0.95, 0.4)), foamMaterial(theme.water.foam));
        foam.position.y = ctx.waterLevel + 0.04 - s.pos[1];
        foam.renderOrder = 1;
        group.add(foam);
      } else {
        const puff = new GeometryBatcher();
        const rng = seededRandom(`puff:${s.pos.join(",")}`);
        for (let i = 0; i < 5; i++) addSphere(puff, [(rng() - 0.5) * w, -h / 2 - 1.3 - rng() * 0.3, (rng() - 0.5) * d], [0.6 + rng() * 0.3, 0.3, 0.5 + rng() * 0.3], "#ffffff", "matte", 1);
        for (const m of puff.build()) {
          m.castShadow = false;
          group.add(m);
        }
      }
    } else {
      // padded bumper with a face: moving hazards get personality
      const defender = !!ctx.level.hoop;
      const body = defender ? (s.color ?? theme.accent) : PALETTE.tape;
      const r = Math.min(w, h, d) * 0.28;
      addRounded(f, [0, 0, 0], [w, h, d], r, body, "rubber");
      if (!defender) {
        addStripes(f, [0, 0, 0], w * 0.86, h * 0.86, d * 1.04, [PALETTE.tapeLight, body], { segment: Math.max(0.22, w / 6), family: "rubber" });
      } else {
        // jersey band + raised foam arms
        addBox(f, [0, -h * 0.18, 0], [w * 1.02, h * 0.14, d * 1.02], "#ffffff", "rubber");
        for (const sx of [-1, 1]) {
          f.add(geo.cylinder(10), { pos: [sx * (w / 2 + 0.05), h / 2 + 0.22, 0], rot: [0, 0, sx * 0.35], scale: [0.2, 0.75, 0.2] }, body, "rubber");
          f.add(geo.sphere(1), { pos: [sx * (w / 2 + 0.18), h / 2 + 0.6, 0], scale: [0.28, 0.28, 0.28] }, "#ffffff", "rubber");
        }
      }
      if (s.pos[1] - h / 2 < 0.2 && w > 3) {
        // the big sweeper gets warning lights
        for (const sx of [-1, 0, 1]) addSphere(f, [sx * w * 0.35, h / 2 + 0.06, 0], 0.09, PALETTE.gold, "glow", 1);
      }
      for (const m of mb.build()) group.add(m);
      const eyes = this.makeEyes(Math.min(h, w) * 0.17, defender);
      eyes.group.position.set(0, h * 0.14, d / 2 + 0.01);
      group.add(eyes.group);
      const outline = new THREE.Mesh(ctx.own(geo.rounded(w, h, d, r)), outlineMaterial(0.03));
      group.add(outline);
      this.animate((u) => {
        // eyes follow the dummy
        group.getWorldPosition(_v);
        const dx = u.player.x - _v.x;
        const dz = u.player.z - _v.z;
        const len = Math.hypot(dx, dz) || 1;
        for (const p of eyes.pupils) {
          const er = p.userData.r as number;
          p.position.x = THREE.MathUtils.lerp(p.position.x, THREE.MathUtils.clamp(dx / len, -1, 1) * er * 0.45, 0.2);
          p.position.y = THREE.MathUtils.lerp(p.position.y, THREE.MathUtils.clamp((u.player.y - _v.y) / 4, -0.4, 0.4) * er, 0.2);
        }
        const blink = (u.time * 0.7 + s.pos[2]) % 3.2 < 0.12;
        eyes.group.scale.y = blink ? 0.15 : 1;
      });
    }
    group.position.set(...s.pos);
    return group;
  }

  private makeEyes(r: number, angry: boolean): Eyes {
    const group = new THREE.Group();
    const white = toyMaterial("#ffffff", "plastic");
    const ink = toyMaterial(INK, "matte");
    const eyeGeo = this.own(new THREE.SphereGeometry(r, 16, 12));
    const pupilGeo = this.own(new THREE.SphereGeometry(r * 0.5, 12, 8));
    const pupils: THREE.Mesh[] = [];
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, white);
      eye.position.x = sx * r * 1.15;
      eye.scale.z = 0.55;
      eye.add(new THREE.Mesh(eyeGeo, outlineMaterial(0.012)));
      const pupil = new THREE.Mesh(pupilGeo, ink);
      pupil.position.z = r * 0.85;
      pupil.scale.z = 0.5;
      pupil.userData.r = r;
      eye.add(pupil);
      group.add(eye);
      pupils.push(pupil);
      if (angry) {
        const brow = new THREE.Mesh(this.own(new THREE.BoxGeometry(r * 1.6, r * 0.32, r * 0.3)), ink);
        brow.position.set(sx * r * 1.15, r * 1.05, r * 0.4);
        brow.rotation.z = sx * -0.45;
        group.add(brow);
      }
    }
    return { group, pupils };
  }

  /* ------------------------------ signs ------------------------------ */

  private addSign(s: StaticDef, text: string, icon: string, local: V3, yaw: number) {
    const tex = canvasTexture(`sign:${text}:${icon}`, 256, 128, (ctx, w, h) => {
      ctx.fillStyle = PALETTE.dummy;
      roundRect(ctx, 4, 4, w - 8, h - 8, 20);
      ctx.fill();
      ctx.lineWidth = 8;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "900 64px system-ui, sans-serif";
      ctx.fillText(`${icon} ${text}`, w / 2, h / 2 + 3);
    });
    const mat = this.own(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
    const sign = new THREE.Mesh(this.own(new THREE.PlaneGeometry(1.1, 0.55)), mat);
    sign.position.set(...local);
    sign.rotation.y = yaw;
    const holder = new THREE.Group();
    holder.applyMatrix4(staticMatrix(s));
    holder.add(sign);
    this.group.add(holder);
  }

  /* ------------------------------ foam ------------------------------ */

  private buildFoam(ctx: BuildContext) {
    const pieces: THREE.BufferGeometry[] = [];
    for (const s of ctx.level.statics) {
      if (s.slide || s.rot) continue;
      const role = classifyStatic(s, ctx.level);
      if (role !== "ground" && role !== "bridge" && role !== "block") continue;
      // only footprints whose visuals reach the water
      if (role === "bridge") {
        // posts only: small foam dots handled by scenery
        continue;
      }
      const g = foamRingGeometry(s.size[0], s.size[2], 0.55);
      g.translate(s.pos[0], ctx.waterLevel + 0.035, s.pos[2]);
      pieces.push(g);
    }
    if (pieces.length === 0) return;
    const merged = mergeFoam(pieces);
    const mesh = new THREE.Mesh(this.own(merged), foamMaterial(ctx.theme.water.foam));
    mesh.renderOrder = 1;
    this.group.add(mesh);
  }

  /* ------------------------------ checkpoints ------------------------------ */

  private buildCheckpoint(cp: ZoneDef, index: number, ctx: BuildContext) {
    const base = cp.spawn ?? [cp.pos[0], cp.pos[1] - cp.size[1] / 2, cp.pos[2]];
    const entryZ = cp.pos[2] + cp.size[2] / 2 - 0.15;
    const half = Math.min(cp.size[0] / 2 - 0.35, 3.6);
    const y = groundTopAt(ctx.level, base[0], entryZ, base[1] + 0.6) ?? base[1];
    const group = new THREE.Group();
    group.position.set(base[0], y, entryZ);
    const poleMat = toyMaterial("#f4f4f4", "metal");
    const flagMat = this.own(ownedToyMaterial(PALETTE.dummy, "cloth"));
    const ringMat = this.own(new THREE.MeshBasicMaterial({ color: PALETTE.mint, transparent: true, opacity: 0, depthWrite: false }));
    const stripeMat = this.own(ownedToyMaterial(PALETTE.dummy, "matte"));
    const poleGeo = this.own(new THREE.CylinderGeometry(0.05, 0.06, 2.4, 8));
    const flagGeo = this.own(flagGeometry(0.85, 0.52));
    const capGeo = this.own(new THREE.SphereGeometry(0.1, 10, 8));
    const flags: THREE.Mesh[] = [];
    for (const sx of [-1, 1]) {
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(sx * half, 1.2, 0);
      pole.castShadow = true;
      group.add(pole);
      const cap = new THREE.Mesh(capGeo, toyMaterial(PALETTE.dummy, "glow"));
      cap.position.set(sx * half, 2.45, 0);
      group.add(cap);
      const flag = new THREE.Mesh(flagGeo, flagMat);
      flag.position.set(sx * half, 2.36, 0);
      flag.rotation.y = sx < 0 ? 0 : Math.PI;
      flag.castShadow = true;
      group.add(flag);
      flags.push(flag);
    }
    // dashed line on the floor across the path
    const dashGeo = this.own(new THREE.BoxGeometry(0.34, 0.02, 0.16));
    const dashes = new THREE.InstancedMesh(dashGeo, stripeMat, Math.max(2, Math.floor((half * 2) / 0.5)));
    for (let i = 0; i < dashes.count; i++) {
      _m.makeTranslation(-half + 0.25 + i * 0.5, 0.012, 0);
      dashes.setMatrixAt(i, _m);
    }
    dashes.receiveShadow = true;
    group.add(dashes);
    const ringGeo = this.own(new THREE.RingGeometry(0.85, 1, 48));
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.03;
    ring.scale.setScalar(half);
    group.add(ring);
    this.group.add(group);

    let active = false;
    let pop = 0;
    this.checkpointSetters[index] = (on, instant) => {
      if (on === active) return;
      active = on;
      flagMat.color.set(on ? PALETTE.mint : PALETTE.dummy);
      stripeMat.color.set(on ? PALETTE.mint : PALETTE.dummy);
      pop = on && !instant ? 1 : 0;
    };
    this.animate((u) => {
      if (pop > 0) pop = Math.max(0, pop - u.dt * 1.4);
      const k = pop;
      for (const f of flags) {
        f.scale.setScalar(1 + Math.sin(k * Math.PI * 3) * 0.25 * k);
        f.position.y = 2.36 + Math.sin(k * Math.PI) * 0.3;
      }
      ringMat.opacity = active ? 0.25 + k * 0.6 + Math.sin(u.time * 3) * 0.08 : 0;
      ring.scale.setScalar(half * (1 + (1 - k) * 0.08));
    });
  }

  /** Light every checkpoint up to `index`; `instant` skips the pop (restores). */
  setCheckpoint(index: number, instant = false) {
    if (index === this.checkpointState) return;
    this.checkpointState = index;
    this.checkpointSetters.forEach((set, i) => set?.(i <= index, instant));
  }

  /* ------------------------------ finish ------------------------------ */

  private buildFinish(z: ZoneDef, ctx: BuildContext) {
    const theme = ctx.theme;
    const w = Math.min(z.size[0], 7.2);
    const h = 3.9;
    const baseY = groundTopAt(ctx.level, z.pos[0], z.pos[2], z.pos[1] + 1) ?? z.pos[1] - z.size[1] / 2;
    const group = new THREE.Group();
    group.position.set(z.pos[0], baseY, z.pos[2]);
    const fb = new GeometryBatcher();
    const pillar = theme.surface === "snow" ? "#e3ebff" : PALETTE.tape;
    for (const sx of [-1, 1]) {
      addRounded(fb, [(sx * w) / 2, h / 2, 0], [0.62, h, 0.62], 0.22, pillar, "rubber");
      addStripes(fb, [(sx * w) / 2, h * 0.32, 0], 0.66, 0.42, 0.66, ["#ffffff", pillar], { segment: 0.33 });
      addStripes(fb, [(sx * w) / 2, h * 0.62, 0], 0.66, 0.42, 0.66, ["#ffffff", pillar], { segment: 0.33 });
      addRounded(fb, [(sx * w) / 2, 0.12, 0], [0.9, 0.24, 0.9], 0.08, INK, "rubber");
      // confetti cannons
      addCylinder(fb, [(sx * (w / 2 + 0.75)), 0.35, 0.2], 0.2, 0.7, PALETTE.dummy, "plastic", 12, [0.3, 0, -sx * 0.3]);
    }
    // inflatable arch silhouette over the banner
    fb.add(geo.torus(0.12, 32), { pos: [0, h - 0.1, 0], rot: [0, 0, 0], scale: [w + 0.6, w * 0.32, 2.6] }, PALETTE.dummy, "rubber");
    for (const m of fb.build()) group.add(m);
    const tex = canvasTexture("finish-banner", 512, 128, (c, cw, ch) => {
      for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) {
        c.fillStyle = (x + y) % 2 ? INK : "#ffffff";
        c.fillRect(x * 32, y * 32, 32, 32);
      }
      c.fillStyle = PALETTE.dummy;
      roundRect(c, 110, 16, 292, 96, 26);
      c.fill();
      c.lineWidth = 8;
      c.strokeStyle = INK;
      c.stroke();
      c.fillStyle = INK;
      c.font = "900 66px system-ui, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("FINISH", cw / 2, ch / 2 + 3);
    });
    const bannerMat = this.own(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    const banner = new THREE.Mesh(this.own(new THREE.BoxGeometry(w + 0.5, 0.95, 0.24)), bannerMat);
    banner.position.y = h - 0.3;
    banner.castShadow = true;
    banner.add(new THREE.Mesh(banner.geometry, outlineMaterial(0.03)));
    group.add(banner);
    // finish line on the floor
    const lineTex = canvasTexture("finish-line", 256, 32, (c) => {
      for (let y = 0; y < 2; y++) for (let x = 0; x < 16; x++) {
        c.fillStyle = (x + y) % 2 ? INK : "#ffffff";
        c.fillRect(x * 16, y * 16, 16, 16);
      }
    });
    const line = new THREE.Mesh(this.own(new THREE.PlaneGeometry(w, 0.5)), this.own(new THREE.MeshStandardMaterial({ map: lineTex, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 })));
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.015;
    line.receiveShadow = true;
    group.add(line);
    this.group.add(group);
    let burst = 0;
    this.momentHandlers.push((kind) => {
      if (kind === "finish") burst = 1;
    });
    this.animate((u) => {
      const breathe = u.reducedMotion ? 0 : Math.sin(u.time * 2.2) * 0.02;
      burst = Math.max(0, burst - u.dt * 0.8);
      banner.scale.set(1 + breathe + burst * 0.08, 1 + breathe * 1.5 + burst * 0.15, 1);
      banner.position.y = h - 0.3 + Math.sin(u.time * 1.6) * 0.04;
    });
  }

  /* ------------------------------ delivery target ------------------------------ */

  private buildDelivery(z: ZoneDef, ctx: BuildContext) {
    const top = groundTopAt(ctx.level, z.pos[0], z.pos[2], z.pos[1] + z.size[1] / 2) ?? z.pos[1] - z.size[1] / 2;
    const r = Math.min(z.size[0], z.size[2]) * 0.48;
    const group = new THREE.Group();
    group.position.set(z.pos[0], top, z.pos[2]);
    // crash-test target painted on the pad (static, batched)
    const pb = new GeometryBatcher();
    addDisc(pb, [0, 0.012, 0], 0, r, "#ffffff", "matte", 40);
    for (let q = 0; q < 4; q++) {
      const g = new THREE.CircleGeometry(r * 0.78, 20, (q * Math.PI) / 2, Math.PI / 2);
      g.rotateX(-Math.PI / 2);
      pb.add(g, { pos: [0, 0.018, 0] }, q % 2 ? INK : PALETTE.dummy, "matte");
      g.dispose();
    }
    addDisc(pb, [0, 0.022, 0], r * 0.78, r * 0.86, INK, "matte", 40);
    for (const m of pb.build()) group.add(m);
    // rotating chevron ring pointing inward
    const ringMat = this.own(ownedToyMaterial(PALETTE.cyan, "glow"));
    const chevrons = new THREE.Group();
    const chevGeo = this.own(chevronGeometry(0.36));
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const m = new THREE.Mesh(chevGeo, ringMat);
      m.position.set(Math.cos(a) * (r + 0.32), 0.03, Math.sin(a) * (r + 0.32));
      m.rotation.y = -a - Math.PI / 2;
      chevrons.add(m);
    }
    group.add(chevrons);
    // distance-readable light column
    const beamGeo = this.own(beamGeometry(r * 0.95, 5.5, PALETTE.cyan));
    const beamMat = this.own(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.renderOrder = 3;
    group.add(beam);
    // bobbing "drop here" arrow
    const arrowMat = this.own(ownedToyMaterial(PALETTE.cyan, "glow"));
    const arrow = new THREE.Group();
    const cone = new THREE.Mesh(this.own(new THREE.ConeGeometry(0.28, 0.42, 4)), arrowMat);
    cone.rotation.x = Math.PI;
    cone.add(new THREE.Mesh(cone.geometry, outlineMaterial(0.025)));
    const stem = new THREE.Mesh(this.own(new THREE.BoxGeometry(0.16, 0.34, 0.16)), arrowMat);
    stem.position.y = 0.36;
    stem.add(new THREE.Mesh(stem.geometry, outlineMaterial(0.025)));
    arrow.add(cone, stem);
    group.add(arrow);
    this.group.add(group);
    let wasDelivered = false;
    let pulse = 0;
    this.animate((u) => {
      chevrons.rotation.y += u.dt * (u.carrying ? 1.4 : 0.5);
      const pull = u.reducedMotion ? 0 : Math.sin(u.time * 4) * 0.06;
      chevrons.scale.setScalar(1 + pull);
      if (u.delivered && !wasDelivered) pulse = 1;
      wasDelivered = u.delivered;
      pulse = Math.max(0, pulse - u.dt);
      const color = u.delivered ? PALETTE.mint : PALETTE.cyan;
      ringMat.color.set(color);
      arrowMat.color.set(color);
      beamMat.opacity = (u.carrying ? 1 : 0.7) * (0.75 + Math.sin(u.time * 3) * 0.15) + pulse;
      arrow.visible = !u.delivered;
      const bob = u.reducedMotion ? 0 : Math.sin(u.time * 3) * 0.15;
      arrow.position.y = 2.1 + bob;
      arrow.rotation.y += u.dt * 1.5;
      arrow.scale.setScalar(u.carrying ? 1.25 : 1);
    });
  }

  /* ------------------------------ hoop ------------------------------ */

  private buildHoop(ctx: BuildContext) {
    const h = ctx.level.hoop!;
    const group = new THREE.Group();
    group.position.set(...h.pos);
    const rim = new THREE.Mesh(this.own(new THREE.TorusGeometry(h.radius, 0.05, 10, 40)), toyMaterial("#ff5d2e", "metal"));
    rim.rotation.x = Math.PI / 2;
    rim.castShadow = true;
    rim.add(new THREE.Mesh(rim.geometry, outlineMaterial(0.02)));
    group.add(rim);
    // rim bracket back to the board
    const bracket = new THREE.Mesh(this.own(new THREE.BoxGeometry(0.12, 0.06, 0.55)), toyMaterial("#ff5d2e", "metal"));
    bracket.position.set(0, 0, -h.radius - 0.2);
    group.add(bracket);
    // rope net: vertical strands + rings, merged
    const strands: THREE.BufferGeometry[] = [];
    const strandCount = 14;
    for (let i = 0; i < strandCount; i++) {
      const a0 = (i / strandCount) * Math.PI * 2;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        const rr = h.radius * (1 - t * 0.42);
        const a = a0 + Math.sin(t * Math.PI) * 0.35 * (i % 2 ? 1 : -1);
        pts.push(new THREE.Vector3(Math.cos(a) * rr, -t * 0.62, Math.sin(a) * rr));
      }
      strands.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.012, 4, false));
    }
    for (let k = 1; k <= 3; k++) {
      const t = k / 4;
      const ring = new THREE.TorusGeometry(h.radius * (1 - t * 0.42), 0.01, 4, 24);
      ring.rotateX(Math.PI / 2);
      ring.translate(0, -t * 0.62, 0);
      strands.push(ring);
    }
    const netGeo = this.own(mergeFoam(strands.map((g) => {
      const n = g.index ? g.toNonIndexed() : g;
      for (const name of Object.keys(n.attributes)) if (name !== "position" && name !== "normal") n.deleteAttribute(name);
      return n;
    })));
    const net = new THREE.Mesh(netGeo, toyMaterial("#ffffff", "matte"));
    group.add(net);
    this.group.add(group);
    let swish = 0;
    this.momentHandlers.push((kind) => {
      if (kind === "score") swish = 1;
    });
    this.animate((u) => {
      swish = Math.max(0, swish - u.dt * 1.5);
      const k = swish;
      net.scale.set(1 - k * 0.12 * Math.sin(k * 12), 1 + k * 0.45 * Math.sin(k * Math.PI), 1 - k * 0.12 * Math.sin(k * 12));
      rim.rotation.z = Math.sin(k * 30) * 0.06 * k;
    });
  }

  /* ------------------------------ runtime ------------------------------ */

  moment(kind: string, value?: number) {
    for (const fn of this.momentHandlers) fn(kind, value);
  }

  update(u: CourseUpdate) {
    for (const fn of this.animators) fn(u);
  }

  dispose() {
    for (const r of this.owned) r.dispose();
    this.owned = [];
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.name.startsWith("batch:")) o.geometry.dispose();
    });
    this.group.removeFromParent();
  }
}

/* ------------------------------ static styling ------------------------------ */

function buildStatic(f: Frame, s: StaticDef, role: StaticRole, ctx: BuildContext, index: number) {
  const [w, h, d] = s.size;
  const t = ctx.theme;
  const top = h / 2;
  const eps = index * 0.0007;
  const rng = seededRandom(`static:${ctx.level.id}:${index}`);
  const localWaterBottom = (ctx.theme.surface === "snow" ? ctx.waterLevel - 3.5 : ctx.waterLevel - 0.6) - s.pos[1];
  switch (role) {
    case "ground": {
      const capH = 0.22;
      const topColor = s.top && t.surface === "court" ? t.ground.top : t.ground.top;
      addRounded(f, [0, top - capH / 2 + eps, 0], [w, capH, d], 0.09, topColor, "matte");
      const bodyTop = top - capH * 0.6;
      const bodyH = bodyTop - localWaterBottom;
      addBox(f, [0, bodyTop - bodyH / 2, 0], [w - 0.08, bodyH, d - 0.08], t.ground.side, "matte");
      addBox(f, [0, top - 0.62, 0], [w - 0.05, 0.14, d - 0.05], t.ground.deep, "matte");
      if (t.surface === "snow") addBox(f, [0, top - 1.5, 0], [w - 0.06, 0.2, d - 0.06], t.ground.deep, "matte");
      // mown stripes / sand ripples / court planks on top
      if (t.surface === "turf" || t.surface === "meadow") {
        const stripe = 1.4;
        for (let z = -d / 2 + stripe / 2; z < d / 2 - 0.2; z += stripe * 2) addBox(f, [0, top + 0.002 + eps, z + stripe / 2], [w - 0.24, 0.006, Math.min(stripe, d / 2 - z)], shade(t.ground.top, 0.045), "matte");
      } else if (t.surface === "sand") {
        for (let i = 0; i < Math.floor((w * d) / 10); i++) addBox(f, [(rng() - 0.5) * (w - 1), top + 0.003 + eps, (rng() - 0.5) * (d - 1)], [0.6 + rng() * 1.2, 0.006, 0.07], shade(t.ground.top, -0.06), "matte", [0, (rng() - 0.5) * 0.4, 0]);
      } else if (t.surface === "court") {
        for (let x = -w / 2 + 0.7; x < w / 2 - 0.2; x += 0.7) addBox(f, [x, top + 0.002, 0], [0.02, 0.005, d - 0.3], shade(t.ground.top, -0.08), "matte");
      }
      // edge dressing
      if (t.surface === "turf" || t.surface === "meadow") {
        const per = Math.max(2, Math.floor((w + d) / 1.6));
        for (let i = 0; i < per; i++) {
          const side = Math.floor(rng() * 4);
          const along = rng() - 0.5;
          const x = side < 2 ? along * (w - 0.3) : (side === 2 ? -1 : 1) * (w / 2 - 0.12);
          const z = side >= 2 ? along * (d - 0.3) : (side === 0 ? -1 : 1) * (d / 2 - 0.12);
          if (Math.abs(x) < 3.4 && side < 2 && w < 13) continue; // keep tufts off the walking lane edges
          addTuft(f, [x, top, z], t.ground.trim, rng);
        }
      }
      if (t.surface === "snow") {
        const per = Math.max(2, Math.floor((w + d) / 2));
        for (let i = 0; i < per; i++) {
          const side = Math.floor(rng() * 4);
          const along = rng() - 0.5;
          const x = side < 2 ? along * (w - 0.4) : (side === 2 ? -1 : 1) * (w / 2 - 0.05);
          const z = side >= 2 ? along * (d - 0.4) : (side === 0 ? -1 : 1) * (d / 2 - 0.05);
          addSphere(f, [x, top - 0.08, z], [0.26 + rng() * 0.2, 0.16, 0.26 + rng() * 0.2], "#ffffff", "matte", 0);
        }
        // icicles under the lip
        for (let i = 0; i < Math.floor(w / 1.4); i++) {
          const x = -w / 2 + 0.5 + i * 1.4 + rng() * 0.3;
          const len = 0.25 + rng() * 0.35;
          addCone(f, [x, top - capH - len / 2, d / 2 - 0.02], 0.06, len, "#c9fbf6", "ice", 5, [Math.PI, 0, 0]);
        }
      }
      break;
    }
    case "hurdle": {
      // candy-striped padded hazard on little feet
      addRounded(f, [0, h * 0.1, 0], [w, h * 0.8, d], Math.min(h, d) * 0.3, PALETTE.tape, "rubber");
      addStripes(f, [0, h * 0.1, 0], w * 0.94, h * 0.84, d * 1.06, [PALETTE.tapeLight, PALETTE.tape], { segment: 0.42, family: "rubber" });
      for (const sx of [-1, 1]) addRounded(f, [sx * (w / 2 - 0.25), -h / 2 + h * 0.15, 0], [0.3, h * 0.3, d * 1.7], 0.05, INK, "rubber");
      break;
    }
    case "rail": {
      const court = t.surface === "court";
      addRounded(f, [0, -0.04, 0], [w, h - 0.08, d], 0.08, court ? t.wall.side : t.wall.side, "plastic");
      addRounded(f, [0, top - 0.08, 0], [w + 0.08, 0.18, d + 0.04], 0.08, court ? t.wall.top : t.accent, "rubber");
      // alternating panels along the long axis
      const long = Math.max(w, d);
      const alongZ = d >= w;
      const panels = Math.floor(long / 2.2);
      for (let i = 0; i < panels; i++) {
        const off = -long / 2 + 1.1 + i * 2.2;
        const color = court ? (i % 2 ? t.accent : t.accent2) : i % 2 ? t.accent2 : "#ffffff";
        addBox(f, alongZ ? [0, 0, off] : [off, 0, 0], alongZ ? [w + 0.02, h * 0.42, 1.5] : [1.5, h * 0.42, d + 0.02], color, court ? "glow" : "plastic");
      }
      break;
    }
    case "wall": {
      addRounded(f, [0, -0.1, 0], [w, h - 0.2, d], 0.1, t.wall.side, "matte");
      addRounded(f, [0, top - 0.1, 0], [w + 0.14, 0.24, d + 0.06], 0.1, t.surface === "snow" ? "#ffffff" : t.wall.top, "matte");
      for (let i = 0; i < Math.floor(d / 1.6); i++) addRock(f, [(rng() - 0.5) * w, -h / 2 + 0.3 + rng() * (h - 0.8), -d / 2 + 0.8 + i * 1.6], [w * 1.25, 0.5, 0.6], shade(t.wall.side, -0.1), rng);
      break;
    }
    case "bar": {
      addRounded(f, [0, 0, 0], [w, h, d], Math.min(h, d) * 0.3, t.block.side, "rubber");
      // underside warning tape: duck!
      addStripes(f, [0, -h / 2 - 0.004, 0], w * 0.98, 0.02, d * 0.9, [PALETTE.tape, PALETTE.tapeLight], { segment: 0.4 });
      // grip tape on the front lip (it's grabbable)
      addStripes(f, [0, h / 2 - 0.06, d / 2 + 0.006], w * 0.96, 0.1, 0.02, [PALETTE.grip, INK], { segment: 0.3 });
      for (const sx of [-1, 1]) {
        const postH = s.pos[1] - h / 2;
        f.add(geo.cylinder(10), { pos: [sx * (w / 2 + 0.1), -h / 2 - postH / 2, 0], scale: [0.16, postH, 0.16] }, "#d7dbe6", "metal");
      }
      break;
    }
    case "backboard": {
      addRounded(f, [0, 0, 0], [w, h, d], 0.05, "#ffffff", "plastic");
      addRounded(f, [0, 0, -0.01], [w + 0.12, h + 0.12, d * 0.6], 0.05, INK, "plastic");
      // shooter's square
      const sw = 0.62;
      for (const [x, y, ww, hh] of [[0, -h * 0.18 + 0.2, sw, 0.05], [0, -h * 0.18 - 0.2, sw, 0.05], [-sw / 2, -h * 0.18, 0.05, 0.45], [sw / 2, -h * 0.18, 0.05, 0.45]] as const) {
        addBox(f, [x, y, d / 2 + 0.004], [ww, hh, 0.01], "#ff5d2e", "plastic");
      }
      break;
    }
    case "pillar": {
      addCylinder(f, [0, 0, 0], Math.min(w, d) * 0.62, h, "#555b6e", "metal", 14);
      addRounded(f, [0, -h / 2 + 0.55, 0], [0.62, 1.1, 0.62], 0.16, t.accent, "rubber");
      break;
    }
    case "block": {
      const snow = t.surface === "snow";
      const r = Math.min(0.14, h * 0.2);
      addRounded(f, [0, -0.02, 0], [w, h - 0.04, d], r, t.block.side, snow ? "matte" : "rubber");
      addRounded(f, [0, top - 0.07 + eps, 0], [w + (snow ? 0.12 : 0.02), snow ? 0.2 : 0.14, d + (snow ? 0.12 : 0.02)], 0.06, t.block.top, "matte");
      if (!snow) {
        // side seams make big blocks read as stacked gym mats
        for (let y = -h / 2 + 0.55; y < top - 0.35; y += 0.55) addBox(f, [0, y, 0], [w + 0.01, 0.03, d + 0.01], t.block.deep, "matte");
      } else {
        for (let i = 0; i < Math.floor(w / 1.1); i++) {
          const x = -w / 2 + 0.4 + i * 1.1 + rng() * 0.2;
          const len = 0.25 + rng() * 0.4;
          addCone(f, [x, top - 0.16 - len / 2, d / 2 + 0.03], 0.06, len, "#c9fbf6", "ice", 5, [Math.PI, 0, 0]);
        }
      }
      // grip tape on the approach edge: "hands hold here"
      if (s.grab !== false && h > 0.6) addStripes(f, [0, top - 0.13, d / 2 + 0.008], w * 0.96, 0.13, 0.025, [PALETTE.grip, INK], { segment: 0.3 });
      break;
    }
    case "bridge": {
      const alongZ = d >= w;
      const long = alongZ ? d : w;
      const short = alongZ ? w : d;
      const planks = Math.max(2, Math.round(long / 0.34));
      const step = long / planks;
      for (let i = 0; i < planks; i++) {
        const off = -long / 2 + step * (i + 0.5);
        const c = shade(t.wood.top, (rng() - 0.5) * 0.14);
        addRounded(f, alongZ ? [0, top - 0.06, off] : [off, top - 0.06, 0], alongZ ? [short, 0.12, step - 0.035] : [step - 0.035, 0.12, short], 0.025, c, "matte");
      }
      for (const sx of [-1, 1]) {
        const p: V3 = alongZ ? [sx * (short / 2 - 0.12), -0.02, 0] : [0, -0.02, sx * (short / 2 - 0.12)];
        addBox(f, p, alongZ ? [0.16, h - 0.08, long] : [long, h - 0.08, 0.16], t.wood.dark, "matte");
      }
      // stilts down into the water
      const postBottom = localWaterBottom;
      const postH = -h / 2 - postBottom;
      if (postH > 0.2) {
        const posts = Math.max(2, Math.round(long / 2.6) + 1);
        for (let i = 0; i < posts; i++) {
          const off = -long / 2 + 0.25 + (i * (long - 0.5)) / (posts - 1);
          for (const sx of [-1, 1]) {
            const x = alongZ ? sx * (short / 2 - 0.12) : off;
            const z = alongZ ? off : sx * (short / 2 - 0.12);
            f.add(geo.cylinder(8), { pos: [x, -h / 2 - postH / 2, z], scale: [0.2, postH, 0.2] }, t.wood.dark, "matte");
          }
        }
      }
      break;
    }
    case "ramp": {
      addRounded(f, [0, -0.02, 0], [w, h - 0.04, d], 0.05, t.wood.side, "matte");
      addRounded(f, [0, top - 0.05, 0], [w - 0.06, 0.1, d - 0.04], 0.03, t.wood.top, "matte");
      for (let z = -d / 2 + 0.5; z < d / 2 - 0.3; z += 0.62) addBox(f, [0, top + 0.01, z], [w * 0.86, 0.04, 0.09], t.wood.dark, "matte");
      for (const z of [-d / 4, d / 4]) addChevron(f, [0, top + 0.012, z], 0, 0.9, "#ffffff", "matte");
      break;
    }
    case "pedestal": {
      addRounded(f, [0, -0.02, 0], [w, h - 0.04, d], 0.08, "#ffffff", "plastic");
      addBox(f, [0, top - 0.09, 0], [w + 0.01, 0.07, d + 0.01], INK, "plastic");
      addTarget(f, [0, top + 0.004, 0], Math.min(w, d) * 0.42);
      break;
    }
    case "goalPedestal": {
      addRounded(f, [0, -0.02, 0], [w, h - 0.04, d], 0.12, "#ffffff", "plastic");
      addBox(f, [0, 0, 0], [w + 0.02, h * 0.28, d + 0.02], PALETTE.cyan, "glow");
      break;
    }
    default:
      addRounded(f, [0, 0, 0], [w, h, d], 0.05, s.color ?? "#999999", "matte");
  }
}

/** The crash-test calibration target, in geometry (merges with the course). */
export function addTarget(b: Batch, pos: V3, r: number) {
  addDisc(b, [pos[0], pos[1], pos[2]], 0, r, INK, "matte", 28);
  for (let q = 0; q < 4; q++) {
    const g = new THREE.CircleGeometry(r * 0.86, 14, (q * Math.PI) / 2, Math.PI / 2);
    g.rotateX(-Math.PI / 2);
    b.add(g, { pos: [pos[0], pos[1] + 0.003, pos[2]] }, q % 2 ? INK : PALETTE.dummy, "matte");
    g.dispose();
  }
}

/* ------------------------------ helpers ------------------------------ */

/** Highest static top under (x, z) that is at or below `maxY`. */
export function groundTopAt(level: LevelDef, x: number, z: number, maxY: number): number | null {
  let best: number | null = null;
  for (const s of level.statics) {
    if (s.slide || s.rot) continue;
    if (Math.abs(x - s.pos[0]) > s.size[0] / 2 || Math.abs(z - s.pos[2]) > s.size[2] / 2) continue;
    const top = s.pos[1] + s.size[1] / 2;
    if (top <= maxY + 1e-3 && (best == null || top > best)) best = top;
  }
  return best;
}

export function shade(color: string, amount: number) {
  const c = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l + amount, 0, 1));
  return `#${c.getHexString()}`;
}

/** Flag cloth with an aWave flutter weight (0 at the pole, 1 at the tip). */
export function flagGeometry(w: number, h: number) {
  const g = new THREE.PlaneGeometry(w, h, 6, 3);
  g.translate(w / 2, -h / 2, 0);
  const pos = g.attributes.position;
  const wave = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) wave[i] = pos.getX(i) / w;
  g.setAttribute("aWave", new THREE.BufferAttribute(wave, 1));
  return g;
}

function chevronGeometry(size: number) {
  const shape = new THREE.Shape();
  const t = size * 0.34;
  shape.moveTo(-size / 2, 0);
  shape.lineTo(0, -size * 0.55);
  shape.lineTo(size / 2, 0);
  shape.lineTo(size / 2, t);
  shape.lineTo(0, -size * 0.55 + t);
  shape.lineTo(-size / 2, t);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Open cylinder with an alpha gradient: a soft light column. */
function beamGeometry(r: number, height: number, color: string) {
  const g = new THREE.CylinderGeometry(r, r * 1.08, height, 24, 4, true);
  g.translate(0, height / 2, 0);
  const pos = g.attributes.position;
  const c = new THREE.Color(color);
  const colors = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const k = 1 - pos.getY(i) / height;
    colors[i * 4] = c.r;
    colors[i * 4 + 1] = c.g;
    colors[i * 4 + 2] = c.b;
    colors[i * 4 + 3] = 0.32 * k * k;
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 4));
  return g;
}

function mergeFoam(pieces: THREE.BufferGeometry[]) {
  // Tiny local merge to avoid importing BufferGeometryUtils twice.
  let count = 0;
  const names = Object.keys(pieces[0].attributes);
  for (const p of pieces) count += p.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const size = pieces[0].attributes[name].itemSize;
    const arr = new Float32Array(count * size);
    let offset = 0;
    for (const p of pieces) {
      const a = p.attributes[name];
      arr.set(a.array as Float32Array, offset);
      offset += a.count * size;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  for (const p of pieces) p.dispose();
  out.computeBoundingSphere();
  return out;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
