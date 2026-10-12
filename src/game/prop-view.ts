import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { PropDef } from "./levels";
import { INK, PALETTE } from "./visual-theme";
import { canvasTexture, outlineMaterial, ownedToyMaterial, toyMaterial } from "./materials";

/**
 * Prop visuals. The physics prop is a plain ball/box/capsule; the view adds
 * identity (basketball seams, cargo stickers, an energy core, an egg with
 * feelings) plus the objective grammar: a bobbing gold marker over anything
 * the team must carry or throw, and an outline that brightens when a hand
 * is close enough to grab.
 */

export type PropStyle = "basketball" | "bouncy" | "crate" | "cargo" | "core" | "egg";

export interface PropMood {
  dt: number;
  held: boolean;
  /** Linear speed from the rendered motion. */
  speed: number;
  /** 0..1 how close the nearest hand is (1 = touching). */
  near: number;
}

export function propStyle(def: PropDef, levelId: string): PropStyle {
  if (def.kind === "egg") return "egg";
  if (def.kind === "ball") return def.scoring ? "basketball" : "bouncy";
  if (def.deliverable) return levelId === "summit-sync" ? "core" : "cargo";
  return "crate";
}

const OUT = 0.022;

export class PropView {
  object = new THREE.Group();
  /** World-space marker (added to the level group, not the prop: props spin). */
  marker: THREE.Group | null = null;
  style: PropStyle;
  objective: boolean;
  private inner = new THREE.Group();
  private outlines: THREE.Mesh[] = [];
  private nearMat: THREE.MeshBasicMaterial;
  private owned: (THREE.Material | THREE.BufferGeometry)[] = [];
  private jiggle = { x: 0, v: 0 };
  private time = Math.random() * 5;
  private glow: THREE.MeshStandardMaterial | null = null;
  private eggFace: { eyes: THREE.Mesh[]; happy: THREE.Object3D[]; mouthSmile: THREE.Object3D; mouthO: THREE.Object3D; sweat: THREE.Mesh } | null = null;
  private lastPos = new THREE.Vector3();
  private hasLast = false;

  constructor(public def: PropDef, levelId: string) {
    this.style = propStyle(def, levelId);
    this.objective = Boolean(def.deliverable || def.scoring);
    this.nearMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
    this.nearMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>\ntransformed += normalize(normal) * ${OUT.toFixed(3)};`);
    };
    this.nearMat.customProgramCacheKey = () => `outline:${OUT}`;
    this.owned.push(this.nearMat);
    this.object.add(this.inner);
    this.build();
    if (this.objective && this.style !== "basketball") this.buildMarker();
  }

  private g<T extends THREE.BufferGeometry>(geometry: T) {
    this.owned.push(geometry);
    return geometry;
  }

  private add(geometry: THREE.BufferGeometry, material: THREE.Material, outline = true, parent: THREE.Object3D = this.inner) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    if (outline) {
      const hull = new THREE.Mesh(geometry, this.nearMat);
      mesh.add(hull);
      this.outlines.push(hull);
    }
    return mesh;
  }

  private build() {
    const def = this.def;
    switch (this.style) {
      case "basketball":
      case "bouncy": {
        const r = def.radius ?? 0.3;
        const base = this.style === "basketball" ? "#ff7a2e" : def.color;
        this.add(this.g(new THREE.SphereGeometry(r, 28, 20)), toyMaterial(base, "rubber"));
        const seam = toyMaterial(this.style === "basketball" ? INK : "#ffffff", "matte");
        const ring = this.g(new THREE.TorusGeometry(r * 1.002, r * 0.045, 6, 40));
        const a = new THREE.Mesh(ring, seam);
        const b = new THREE.Mesh(ring, seam);
        b.rotation.y = Math.PI / 2;
        const c = new THREE.Mesh(ring, seam);
        c.rotation.x = Math.PI / 2;
        this.inner.add(a, b, c);
        if (this.style === "basketball") {
          // the two curved seams that make it read as a basketball
          for (const sx of [-1, 1]) {
            const curve = new THREE.Mesh(this.g(new THREE.TorusGeometry(r * 0.72, r * 0.045, 6, 30)), seam);
            curve.position.x = sx * r * 0.68;
            curve.rotation.y = Math.PI / 2;
            curve.scale.set(1, 1, 1);
            this.inner.add(curve);
          }
        }
        break;
      }
      case "crate":
      case "cargo": {
        const s = def.size ?? [0.6, 0.6, 0.6];
        const wood = this.style === "cargo" ? "#e9a94b" : def.color;
        this.add(this.g(new RoundedBoxGeometry(s[0], s[1], s[2], 2, Math.min(...s) * 0.08)), toyMaterial(wood, "matte"));
        const band = toyMaterial("#8a5a2b", "matte");
        for (const y of [-0.32, 0.32]) {
          const m = new THREE.Mesh(this.g(new THREE.BoxGeometry(s[0] * 1.03, s[1] * 0.12, s[2] * 1.03)), band);
          m.position.y = y * s[1];
          this.inner.add(m);
        }
        if (this.style === "cargo") {
          const tex = canvasTexture("cargo-label", 256, 256, (ctx, w) => {
            ctx.fillStyle = "#fff6e3";
            ctx.fillRect(0, 0, w, w);
            ctx.fillStyle = PALETTE.tape;
            for (let i = -2; i < 8; i++) {
              ctx.beginPath();
              ctx.moveTo(i * 40, 0);
              ctx.lineTo(i * 40 + 20, 0);
              ctx.lineTo(i * 40 - 20, 40);
              ctx.lineTo(i * 40 - 40, 40);
              ctx.fill();
            }
            ctx.fillStyle = INK;
            ctx.font = "900 62px system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("CARGO", w / 2, 120);
            ctx.font = "800 30px system-ui, sans-serif";
            ctx.fillText("▲ THIS SIDE UP ▲", w / 2, 190);
            ctx.lineWidth = 10;
            ctx.strokeStyle = INK;
            ctx.strokeRect(5, 5, w - 10, w - 10);
          });
          const label = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
          this.owned.push(label);
          const plane = this.g(new THREE.PlaneGeometry(s[0] * 0.66, s[1] * 0.42));
          for (const [rx, ry, px, pz] of [[0, 0, 0, 1], [0, Math.PI, 0, -1], [0, Math.PI / 2, 1, 0], [0, -Math.PI / 2, -1, 0]] as const) {
            const m = new THREE.Mesh(plane, label);
            m.rotation.set(rx, ry, 0);
            m.position.set((px * s[0]) / 2 + px * 0.017, 0, (pz * s[2]) / 2 + pz * 0.017);
            this.inner.add(m);
          }
        }
        break;
      }
      case "core": {
        const s = def.size ?? [0.5, 0.5, 0.5];
        // metal cage, glowing crystal inside
        const frame = toyMaterial("#3b4766", "metal");
        const t = Math.min(...s) * 0.12;
        for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
          const post = this.add(this.g(new THREE.BoxGeometry(t, s[1], t)), frame, false);
          post.position.set((x * (s[0] - t)) / 2, 0, (z * (s[2] - t)) / 2);
        }
        for (const y of [-1, 1]) {
          const plate = this.add(this.g(new RoundedBoxGeometry(s[0], t * 1.2, s[2], 2, t * 0.4)), frame, true);
          plate.position.y = (y * (s[1] - t)) / 2;
        }
        this.glow = ownedToyMaterial("#a98bff", "glow");
        this.glow.emissive.set("#7a5cff");
        this.glow.emissiveIntensity = 0.8;
        this.owned.push(this.glow);
        const crystal = this.add(this.g(new THREE.OctahedronGeometry(Math.min(...s) * 0.34, 0)), this.glow, false);
        crystal.scale.y = 1.3;
        crystal.name = "crystal";
        break;
      }
      case "egg": {
        const r = def.radius ?? 0.28;
        const shell = this.add(this.g(new THREE.SphereGeometry(r, 28, 20)), toyMaterial("#fff4d6", "plastic"));
        shell.scale.set(1, 1.28, 1);
        // speckles
        const speck = toyMaterial("#e8cf9f", "matte");
        const speckGeo = this.g(new THREE.SphereGeometry(r * 0.07, 6, 4));
        const rng = mulberry(7);
        for (let i = 0; i < 9; i++) {
          const th = rng() * Math.PI * 2;
          const ph = 0.5 + rng() * 1.6;
          const m = new THREE.Mesh(speckGeo, speck);
          m.position.set(Math.cos(th) * Math.sin(ph) * r * 0.99, Math.cos(ph) * r * 1.26, Math.sin(th) * Math.sin(ph) * r * 0.99);
          if (m.position.z < -r * 0.4 && Math.abs(m.position.y) < r * 0.6) continue;
          m.scale.set(1, 1, 0.4);
          m.lookAt(0, 0, 0);
          this.inner.add(m);
        }
        const ink = toyMaterial(INK, "matte");
        const white = toyMaterial("#ffffff", "plastic");
        const eyes: THREE.Mesh[] = [];
        const happy: THREE.Object3D[] = [];
        for (const sx of [-1, 1]) {
          const eye = new THREE.Mesh(this.g(new THREE.SphereGeometry(r * 0.15, 12, 10)), ink);
          eye.position.set(sx * r * 0.32, r * 0.22, -r * 0.93);
          eye.scale.set(1, 1.2, 0.5);
          const glint = new THREE.Mesh(this.g(new THREE.SphereGeometry(r * 0.05, 6, 4)), white);
          glint.position.set(sx * 0.2 * r * 0.15, r * 0.06, -r * 0.05);
          eye.add(glint);
          this.inner.add(eye);
          eyes.push(eye);
          const arc = new THREE.Mesh(this.g(new THREE.TorusGeometry(r * 0.12, r * 0.035, 6, 12, Math.PI)), ink);
          arc.position.set(sx * r * 0.32, r * 0.2, -r * 0.97);
          arc.visible = false;
          this.inner.add(arc);
          happy.push(arc);
          const blush = new THREE.Mesh(this.g(new THREE.CircleGeometry(r * 0.11, 12)), toyMaterial("#ff9db0", "matte"));
          blush.position.set(sx * r * 0.55, -r * 0.05, -r * 0.84);
          blush.rotation.y = Math.PI + sx * 0.55;
          this.inner.add(blush);
        }
        const smile = new THREE.Mesh(this.g(new THREE.TorusGeometry(r * 0.16, r * 0.035, 6, 14, Math.PI)), ink);
        smile.rotation.z = Math.PI;
        smile.position.set(0, -r * 0.08, -r * 0.98);
        this.inner.add(smile);
        const o = new THREE.Mesh(this.g(new THREE.CircleGeometry(r * 0.12, 14)), ink);
        o.rotation.y = Math.PI;
        o.position.set(0, -r * 0.18, -r * 0.985);
        o.visible = false;
        this.inner.add(o);
        const sweat = new THREE.Mesh(this.g(new THREE.SphereGeometry(r * 0.09, 8, 6)), toyMaterial("#8fd8ff", "plastic"));
        sweat.scale.set(0.8, 1.4, 0.6);
        sweat.position.set(r * 0.62, r * 0.55, -r * 0.62);
        sweat.visible = false;
        this.inner.add(sweat);
        this.eggFace = { eyes, happy, mouthSmile: smile, mouthO: o, sweat };
        break;
      }
    }
  }

  private buildMarker() {
    const m = new THREE.Group();
    const gold = toyMaterial(PALETTE.gold, "glow");
    const gem = new THREE.Mesh(this.g(new THREE.OctahedronGeometry(0.16, 0)), gold);
    gem.scale.set(0.8, 1.3, 0.8);
    gem.add(new THREE.Mesh(gem.geometry, outlineMaterial(0.02)));
    m.add(gem);
    const arrow = new THREE.Mesh(this.g(new THREE.ConeGeometry(0.11, 0.18, 4)), gold);
    arrow.rotation.x = Math.PI;
    arrow.position.y = -0.3;
    m.add(arrow);
    this.marker = m;
  }

  /** Bounce/bump reaction: a quick jiggle, and a gasp from the egg. */
  bump(force: number) {
    this.jiggle.v += 6 * Math.min(1, force);
  }

  update(mood: PropMood) {
    const dt = Math.min(mood.dt, 0.1);
    this.time += dt;
    // jiggle spring
    const a = -260 * this.jiggle.x - 10 * this.jiggle.v;
    this.jiggle.v += a * dt;
    this.jiggle.x += this.jiggle.v * dt;
    const j = THREE.MathUtils.clamp(this.jiggle.x, -0.5, 0.5) * 0.18;
    this.inner.scale.set(1 + j, 1 - j, 1 + j);

    // grab-ability: outline warms to gold as a hand approaches
    const near = THREE.MathUtils.clamp(mood.near, 0, 1);
    if (mood.held) this.nearMat.color.set(PALETTE.ink);
    else this.nearMat.color.set(PALETTE.ink).lerp(new THREE.Color(this.objective ? PALETTE.gold : "#ffffff"), near * (0.7 + 0.3 * Math.sin(this.time * 10)));

    if (this.glow) {
      this.glow.emissiveIntensity = 0.7 + Math.sin(this.time * 4) * 0.35;
      const crystal = this.inner.getObjectByName("crystal");
      if (crystal) crystal.rotation.y += dt * 1.6;
    }

    if (this.eggFace) {
      const scared = mood.speed > 2.2 || Math.abs(this.jiggle.x) > 0.25;
      const calm = mood.held && mood.speed < 1.2;
      const f = this.eggFace;
      for (const e of f.eyes) {
        e.visible = !calm || scared;
        e.scale.y = scared ? 1.6 : 1.2;
      }
      for (const h of f.happy) h.visible = calm && !scared;
      f.mouthSmile.visible = !scared;
      f.mouthO.visible = scared;
      f.mouthO.scale.y = 1 + Math.sin(this.time * 20) * 0.15;
      f.sweat.visible = mood.held && mood.speed > 1.4;
      if (f.sweat.visible) f.sweat.position.y = this.def.radius! * (0.55 - ((this.time * 0.6) % 0.4));
    }

    if (this.marker) {
      const p = this.object.position;
      this.marker.visible = !mood.held;
      const lift = this.style === "egg" ? 0.85 : 0.75;
      this.marker.position.set(p.x, p.y + lift + Math.sin(this.time * 3) * 0.08, p.z);
      this.marker.rotation.y += dt * 2.2;
    }
    this.lastPos.copy(this.object.position);
    this.hasLast = true;
  }

  /** Rendered speed estimate (works on replicas too). */
  speedSince(prev: THREE.Vector3, dt: number) {
    return dt > 0 && this.hasLast ? this.object.position.distanceTo(prev) / dt : 0;
  }

  dispose() {
    for (const o of this.owned) o.dispose();
    this.object.removeFromParent();
    this.marker?.removeFromParent();
  }
}

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
