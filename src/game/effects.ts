import * as THREE from "three";
import { PALETTE } from "./visual-theme";
import type { CourseTheme } from "./visual-theme";

/**
 * Pooled, instanced VFX. Three particle pools (chunks, puffs, confetti) and a
 * small pool of shockwave rings cover every effect in the game. Nothing is
 * allocated per effect; phones get fewer particles per burst.
 *
 * Feedback hierarchy: small actions (steps, grabs) get a handful of particles;
 * big moments (baskets, deliveries, the finish) get rings + confetti.
 */

type P3 = THREE.Vector3 | readonly [number, number, number];

interface EmitOpts {
  color?: string | readonly string[];
  speed?: number;
  up?: number;
  size?: number;
  life?: number;
  spread?: number;
  gravity?: number;
  drag?: number;
  /** Puffs grow before they shrink. */
  grow?: boolean;
  /** Bias velocity along a direction (x, z). */
  dir?: [number, number];
}

class Pool {
  mesh: THREE.InstancedMesh;
  pos: Float32Array;
  vel: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  size: Float32Array;
  spin: Float32Array;
  gravity: Float32Array;
  drag: Float32Array;
  grow: Uint8Array;
  head = 0;
  alive = 0;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();

  constructor(scene: THREE.Scene, geometry: THREE.BufferGeometry, material: THREE.Material, public max: number) {
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.spin = new Float32Array(max);
    this.gravity = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grow = new Uint8Array(max);
    this.dummy.scale.setScalar(0.0001);
    this.dummy.position.set(0, -500, 0);
    this.dummy.updateMatrix();
    for (let i = 0; i < max; i++) {
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.color.set(0xffffff));
    }
    scene.add(this.mesh);
  }

  emit(p: P3, count: number, o: EmitOpts) {
    const px = p instanceof THREE.Vector3 ? p.x : p[0];
    const py = p instanceof THREE.Vector3 ? p.y : p[1];
    const pz = p instanceof THREE.Vector3 ? p.z : p[2];
    const speed = o.speed ?? 2;
    const colors = typeof o.color === "string" ? [o.color] : o.color ?? ["#ffffff"];
    const sp = o.spread ?? 0.15;
    for (let n = 0; n < count; n++) {
      const i = this.head;
      this.head = (this.head + 1) % this.max;
      if (this.life[i] <= 0) this.alive++;
      this.pos[i * 3] = px + (Math.random() - 0.5) * sp;
      this.pos[i * 3 + 1] = py + (Math.random() - 0.5) * sp * 0.5;
      this.pos[i * 3 + 2] = pz + (Math.random() - 0.5) * sp;
      const a = Math.random() * Math.PI * 2;
      const r = 0.35 + Math.random() * 0.65;
      let vx = Math.cos(a) * r * speed;
      let vz = Math.sin(a) * r * speed;
      if (o.dir) {
        vx = vx * 0.4 + o.dir[0] * speed;
        vz = vz * 0.4 + o.dir[1] * speed;
      }
      this.vel[i * 3] = vx;
      this.vel[i * 3 + 1] = (o.up ?? 1.5) * (0.5 + Math.random());
      this.vel[i * 3 + 2] = vz;
      this.life[i] = this.maxLife[i] = (o.life ?? 0.6) * (0.6 + Math.random() * 0.6);
      this.size[i] = (o.size ?? 0.08) * (0.6 + Math.random() * 0.8);
      this.spin[i] = (Math.random() - 0.5) * 14;
      this.gravity[i] = o.gravity ?? 6;
      this.drag[i] = o.drag ?? 1.2;
      this.grow[i] = o.grow ? 1 : 0;
      this.mesh.setColorAt(i, this.color.set(colors[Math.floor(Math.random() * colors.length)]));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number) {
    if (this.alive <= 0) return;
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const i3 = i * 3;
      const damp = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= damp;
      this.vel[i3 + 2] *= damp;
      this.vel[i3 + 1] = this.vel[i3 + 1] * damp - this.gravity[i] * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const scale = this.life[i] <= 0 ? 0.0001 : this.grow[i] ? this.size[i] * Math.sin(Math.min(1, (1 - k) * 1.3 + 0.15) * Math.PI) * 1.4 + 0.0001 : this.size[i] * (0.25 + k * 0.85);
      const age = this.maxLife[i] - this.life[i];
      this.dummy.position.set(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2]);
      this.dummy.rotation.set(this.spin[i] * age, this.spin[i] * age * 0.7, this.spin[i] * 0.2 * age);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      if (this.life[i] > 0) alive++;
    }
    this.alive = alive;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

interface Ring {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  t: number;
  life: number;
  from: number;
  to: number;
  opacity: number;
}

export class Effects {
  private chunks: Pool;
  private puffs: Pool;
  private confettiPool: Pool;
  private rings: Ring[] = [];
  private ringHead = 0;
  private density: number;
  private dustColors: string[] = ["#e8dcc5", "#cfc3a8"];
  private waterColors: string[] = ["#8fd0ff", "#ffffff", "#3aa0e8"];
  private snowy = false;

  constructor(private scene: THREE.Scene, compact: boolean) {
    this.density = compact ? 0.6 : 1;
    const solid = () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, emissive: 0x222222 });
    this.chunks = new Pool(scene, new THREE.BoxGeometry(1, 1, 1), solid(), compact ? 260 : 420);
    this.puffs = new Pool(scene, new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0x555555, flatShading: true }), compact ? 200 : 320);
    const confettiMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, side: THREE.DoubleSide, emissive: 0x333333 });
    this.confettiPool = new Pool(scene, new THREE.PlaneGeometry(1, 0.6), confettiMat, compact ? 220 : 380);
    const ringGeo = new THREE.RingGeometry(0.82, 1, 40);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 10; i++) {
      const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(ringGeo, material);
      mesh.visible = false;
      mesh.renderOrder = 2;
      scene.add(mesh);
      this.rings.push({ mesh, material, t: 0, life: 0, from: 0, to: 1, opacity: 1 });
    }
  }

  /** Surface-aware dust and splash tints for the current course. */
  setTheme(theme: CourseTheme) {
    this.snowy = theme.surface === "snow";
    this.dustColors =
      theme.surface === "turf" || theme.surface === "meadow" ? [theme.ground.top, "#e8dcc5", "#cfe8b8"]
        : theme.surface === "sand" ? ["#f2d29a", "#e8b77a", "#fff0d0"]
          : theme.surface === "snow" ? ["#ffffff", "#e6eeff", "#cddcff"]
            : ["#f4d6a8", "#ffffff", "#e0b47c"];
    this.waterColors = this.snowy ? ["#ffffff", "#e6eeff", "#c9d6ff"] : [theme.water.shallow, "#ffffff", theme.water.foam, theme.water.deep];
  }

  private n(count: number) {
    return Math.max(1, Math.round(count * this.density));
  }

  ring(p: P3, color: string, from: number, to: number, life = 0.5, opacity = 0.9) {
    const r = this.rings[this.ringHead];
    this.ringHead = (this.ringHead + 1) % this.rings.length;
    const x = p instanceof THREE.Vector3 ? p.x : p[0];
    const y = p instanceof THREE.Vector3 ? p.y : p[1];
    const z = p instanceof THREE.Vector3 ? p.z : p[2];
    r.mesh.position.set(x, y, z);
    r.material.color.set(color);
    r.t = 0;
    r.life = life;
    r.from = from;
    r.to = to;
    r.opacity = opacity;
    r.mesh.visible = true;
  }

  /* ------------------------------ effect library ------------------------------ */

  dust(p: P3, count = 3) {
    this.puffs.emit(p, this.n(count), { color: this.dustColors, speed: 0.7, up: 0.6, size: 0.12, life: 0.45, grow: true, gravity: 0.5, drag: 3 });
  }

  landing(p: P3, intensity: number) {
    const k = THREE.MathUtils.clamp(intensity, 0.2, 1.4);
    this.puffs.emit(p, this.n(6 + k * 10), { color: this.dustColors, speed: 1.8 + k * 1.6, up: 0.5, size: 0.16 + k * 0.08, life: 0.55, grow: true, gravity: 0.4, drag: 3.5, spread: 0.35 });
    if (k > 0.5) this.chunks.emit(p, this.n(k * 8), { color: this.dustColors, speed: 2 + k, up: 2.2, size: 0.05, life: 0.5 });
    this.ring([p instanceof THREE.Vector3 ? p.x : p[0], (p instanceof THREE.Vector3 ? p.y : p[1]) + 0.03, p instanceof THREE.Vector3 ? p.z : p[2]], "#ffffff", 0.15, 0.6 + k * 0.5, 0.35, 0.5 * k);
    if (this.snowy) this.snowPuff(p, k);
  }

  jump(p: P3) {
    this.puffs.emit(p, this.n(8), { color: this.dustColors, speed: 2.2, up: 0.4, size: 0.14, life: 0.45, grow: true, gravity: 0.3, drag: 4, spread: 0.3 });
    this.ring(p, "#ffffff", 0.1, 0.7, 0.3, 0.45);
  }

  grabSpark(p: P3, color: string, strong: boolean) {
    this.chunks.emit(p, this.n(strong ? 10 : 5), { color: [color, "#ffffff", PALETTE.goldGlow], speed: strong ? 2.4 : 1.4, up: 1.2, size: strong ? 0.05 : 0.035, life: 0.32, gravity: 2 });
    if (strong) this.ring(p, color, 0.05, 0.38, 0.26, 0.9);
  }

  missPuff(p: P3) {
    this.puffs.emit(p, this.n(3), { color: ["#ffffff", "#dfe6f0"], speed: 0.5, up: 0.4, size: 0.07, life: 0.3, grow: true, gravity: 0, drag: 4 });
  }

  throwBurst(p: P3, dir: [number, number]) {
    this.chunks.emit(p, this.n(10), { color: ["#ffffff", PALETTE.goldGlow], speed: 3.4, up: 0.8, size: 0.045, life: 0.35, dir, gravity: 1, drag: 2 });
    this.puffs.emit(p, this.n(4), { color: ["#ffffff"], speed: 1.6, up: 0.3, size: 0.12, life: 0.35, grow: true, dir, gravity: 0, drag: 4 });
  }

  trail(p: P3, color: string) {
    this.puffs.emit(p, 1, { color: [color, "#ffffff"], speed: 0.1, up: 0.05, size: 0.1, life: 0.35, grow: true, gravity: 0, drag: 6, spread: 0.02 });
  }

  impact(p: P3, force: number) {
    const k = THREE.MathUtils.clamp(force, 0.1, 1);
    this.chunks.emit(p, this.n(3 + k * 7), { color: ["#ffffff", ...this.dustColors], speed: 1.4 + k * 2, up: 1.2, size: 0.05, life: 0.4 });
    if (k > 0.55) this.puffs.emit(p, this.n(4), { color: ["#ffffff"], speed: 1.2, up: 0.4, size: 0.12, life: 0.35, grow: true, gravity: 0, drag: 4 });
  }

  /** Surface break into water (or the cloud sea on Summit Sync). */
  splash(p: P3, big = true) {
    const k = big ? 1 : 0.5;
    this.chunks.emit(p, this.n(36 * k), { color: this.waterColors, speed: 2.6 * k + 1, up: 5.2 * k + 1, size: 0.11, life: 0.95, spread: 0.6, gravity: 9 });
    this.puffs.emit(p, this.n(14 * k), { color: this.snowy ? ["#ffffff", "#e9efff"] : ["#ffffff", this.waterColors[2] ?? "#ffffff"], speed: 2.2, up: 1.4, size: 0.32 * k + 0.1, life: 0.8, grow: true, gravity: 0.6, drag: 2.5, spread: 0.6 });
    this.ring(p, "#ffffff", 0.3, 2.2 * k + 0.4, 0.7, 0.85);
    this.ring(p, this.waterColors[0], 0.2, 1.4 * k + 0.4, 0.9, 0.6);
  }

  snowPuff(p: P3, k = 1) {
    this.puffs.emit(p, this.n(5 * k + 2), { color: ["#ffffff", "#eaf1ff"], speed: 1.6, up: 1.2, size: 0.13, life: 0.6, grow: true, gravity: 1.5, drag: 2.5, spread: 0.4 });
  }

  checkpoint(p: P3) {
    const [x, y, z] = p instanceof THREE.Vector3 ? [p.x, p.y, p.z] : p;
    this.chunks.emit([x, y + 1, z], this.n(26), { color: [PALETTE.mint, "#ffffff", PALETTE.dummy], speed: 2.6, up: 3.2, size: 0.07, life: 1, spread: 0.5 });
    this.confettiPool.emit([x, y + 1.6, z], this.n(18), { color: [PALETTE.mint, "#ffffff", PALETTE.dummy], speed: 2, up: 2.6, size: 0.12, life: 1.6, gravity: 2.4, drag: 2.2 });
    this.ring([x, y + 0.05, z], PALETTE.mint, 0.3, 2.6, 0.7, 0.9);
  }

  score(p: P3) {
    const [x, y, z] = p instanceof THREE.Vector3 ? [p.x, p.y, p.z] : p;
    this.chunks.emit([x, y, z], this.n(34), { color: ["#ff8a3d", PALETTE.gold, "#ffffff"], speed: 3.2, up: 3, size: 0.08, life: 1, spread: 0.5 });
    this.confettiPool.emit([x, y + 0.4, z], this.n(46), { color: ["#ff5d5d", "#4fa8ff", PALETTE.gold, PALETTE.mint, "#c58bff", "#ffffff"], speed: 3, up: 4.2, size: 0.13, life: 2.2, gravity: 2.2, drag: 1.8, spread: 0.8 });
    this.ring([x, y, z], PALETTE.gold, 0.3, 1.8, 0.55, 1);
  }

  delivery(p: P3) {
    const [x, y, z] = p instanceof THREE.Vector3 ? [p.x, p.y, p.z] : p;
    this.ring([x, y + 0.05, z], PALETTE.cyan, 0.4, 3.2, 0.9, 1);
    this.ring([x, y + 0.1, z], "#ffffff", 0.2, 2.2, 0.6, 0.9);
    this.chunks.emit([x, y + 0.4, z], this.n(30), { color: [PALETTE.cyan, "#ffffff", PALETTE.gold], speed: 2.2, up: 4.4, size: 0.08, life: 1.2, spread: 0.8, gravity: 4 });
    this.confettiPool.emit([x, y + 1.2, z], this.n(30), { color: [PALETTE.cyan, "#ffffff", PALETTE.gold, PALETTE.mint], speed: 2.4, up: 3.4, size: 0.13, life: 2, gravity: 2, drag: 2 });
  }

  crack(p: P3) {
    // shell shards, yolk blobs, a puff of feathers
    this.chunks.emit(p, this.n(26), { color: ["#fff4d6", "#ffffff", "#f3e2bd"], speed: 3, up: 3, size: 0.09, life: 1, spread: 0.3, gravity: 9 });
    this.puffs.emit(p, this.n(10), { color: [PALETTE.dummy, "#ffb31a"], speed: 1.8, up: 2, size: 0.12, life: 0.8, gravity: 6, spread: 0.2 });
    this.confettiPool.emit(p, this.n(12), { color: ["#ffffff", "#fff4d6"], speed: 1.6, up: 2.2, size: 0.1, life: 1.6, gravity: 1.2, drag: 3 });
    this.ring(p, "#ffffff", 0.1, 1.2, 0.4, 0.8);
  }

  confetti(p: P3, colors: readonly string[], count = 50, spread = 0.6, up = 5) {
    this.confettiPool.emit(p, this.n(count), { color: colors, speed: 3.2, up, size: 0.14, life: 2.6, gravity: 2.2, drag: 1.6, spread });
  }

  sparkle(p: P3, color: string, count = 8) {
    this.chunks.emit(p, this.n(count), { color: [color, "#ffffff"], speed: 1.2, up: 2.4, size: 0.05, life: 0.6, gravity: 1.5 });
  }

  update(dt: number) {
    this.chunks.update(dt);
    this.puffs.update(dt);
    this.confettiPool.update(dt);
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.t += dt;
      const k = Math.min(1, r.t / r.life);
      const ease = 1 - Math.pow(1 - k, 3);
      r.mesh.scale.setScalar(r.from + (r.to - r.from) * ease);
      r.material.opacity = r.opacity * (1 - k);
      if (k >= 1) r.mesh.visible = false;
    }
  }

  dispose() {
    this.chunks.dispose();
    this.puffs.dispose();
    this.confettiPool.dispose();
    const ringGeo = this.rings[0]?.mesh.geometry;
    for (const r of this.rings) {
      r.mesh.removeFromParent();
      r.material.dispose();
    }
    ringGeo?.dispose();
    void this.scene;
  }
}
