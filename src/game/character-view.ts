import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { PARTS, PART_COUNT, PELVIS, CHEST, HEAD, LUA, LFA, RUA, RFA, LTH, LSH, RTH, RSH } from "./body";
import { INK, PALETTE, teamGlyph } from "./visual-theme";
import { ghostMaterial, outlineMaterial, radialTexture, targetTexture, toyMaterial } from "./materials";
import type { Role } from "./types";

/**
 * The crash-test dummy. Pure presentation: it reads the physics transforms
 * (one per collider) and decorates them. Nothing here feeds back into the
 * simulation, so squash, wobble and faces are free to exaggerate.
 *
 * Every physics part gets a `group` (driven by the transform) holding a
 * `visual` sub-group that secondary motion is allowed to scale and nudge.
 */

export type Expression =
  | "neutral"
  | "walk"
  | "joy"
  | "dizzy"
  | "groggy"
  | "panic"
  | "whee"
  | "worried"
  | "strain"
  | "effort"
  | "ouch"
  | "yes"
  | "determined";

export type ReactionKind = "land" | "grab" | "twoHandGrab" | "release" | "throw" | "fall" | "getup" | "jump" | "impact" | "celebrate" | "splash" | "checkpoint" | "miss";

export interface FaceState {
  dt: number;
  lookYaw: number;
  lookPitch: number;
  fallen: boolean;
  holding: number;
  hanging: boolean;
}

/** Which body parts each squad role steers (for the "this is you" highlight). */
export const ROLE_PARTS: Record<Role, number[]> = {
  arms: [LUA, LFA, RUA, RFA],
  lhand: [LUA, LFA],
  rhand: [RUA, RFA],
  torso: [PELVIS, CHEST],
  head: [HEAD],
  legs: [LTH, LSH, RTH, RSH],
  lleg: [LTH, LSH],
  rleg: [RTH, RSH],
};

const BLOB_TEXTURE_KEY = "blob";
const SHORTS = "#26324a";

class Spring {
  x = 0;
  v = 0;
  constructor(private k = 170, private d = 11) {}
  step(dt: number, target = 0) {
    const h = Math.min(dt, 1 / 30);
    const a = -this.k * (this.x - target) - this.d * this.v;
    this.v += a * h;
    this.x += this.v * h;
  }
}

function isYellowish(color: string) {
  const hsl = new THREE.Color(color).getHSL({ h: 0, s: 0, l: 0 });
  return hsl.h > 0.09 && hsl.h < 0.19 && hsl.s > 0.5 && hsl.l > 0.45;
}

export class CharacterView {
  root = new THREE.Group();
  /** Physics-driven groups, one per collider. */
  parts: THREE.Group[] = [];
  /** Inner groups that secondary motion may scale/offset. */
  visuals: THREE.Group[] = [];
  label: THREE.Sprite | null = null;
  bubble: THREE.Sprite | null = null;
  showNameplate: boolean;
  expression: Expression = "neutral";

  private teamName: string;
  private teamColor: string;
  private teamId: number;
  private owned: (THREE.Material | THREE.Texture | THREE.BufferGeometry)[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private bubbleT = 0;
  private blinkT = 2;
  private eyes: THREE.Mesh[] = [];
  private pupils: THREE.Mesh[] = [];
  private happyEyes: THREE.Object3D[] = [];
  private xEyes: THREE.Object3D[] = [];
  private brows: THREE.Mesh[] = [];
  private mouths: Partial<Record<"smile" | "grin" | "o" | "flat" | "grit" | "frown", THREE.Object3D>> = {};
  private cheeks: THREE.Mesh[] = [];
  private capPivot = new THREE.Group();
  private hands: THREE.Group[] = [];
  private stars: THREE.Group | null = null;
  private blob: THREE.Mesh | null = null;
  private highlightMat: THREE.MeshBasicMaterial | null = null;
  private highlightParts = new Set<number>();
  private highlightShells: THREE.Mesh[] = [];
  private highlightPulse = 0;
  private highlightBoost = 0;

  // secondary motion
  private squash = new Spring(160, 9);
  private nod = new Spring(120, 8);
  private capX = new Spring(90, 5);
  private capZ = new Spring(90, 5);
  private handSquash = [new Spring(220, 12), new Spring(220, 12)];
  private prevPelvis = new THREE.Vector3();
  private prevHead = new THREE.Vector3();
  private headVel = new THREE.Vector3();
  private velocity = new THREE.Vector3();
  private hasPrev = false;
  private reactionT = 0;
  private reaction: Expression | null = null;
  private fallenT = 0;
  private time = Math.random() * 10;

  constructor(color: string, public ghost: boolean, teamName: string, teamId = 1, opts: { nameplate?: boolean } = {}) {
    this.teamName = teamName;
    this.teamColor = color;
    this.teamId = teamId;
    this.showNameplate = opts.nameplate ?? ghost;
    this.build();
  }

  /* ------------------------------ construction ------------------------------ */

  private mat(color: string, family: "plastic" | "rubber" | "matte" = "plastic") {
    return this.ghost ? ghostMaterial(color === INK || color === SHORTS ? "#ffffff" : this.teamColor, 0.36) : toyMaterial(color, family);
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private mesh(g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, outline = 0) {
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = !this.ghost;
    mesh.receiveShadow = false;
    parent.add(mesh);
    if (outline > 0 && !this.ghost) {
      const hull = new THREE.Mesh(g, outlineMaterial(outline));
      hull.castShadow = false;
      hull.userData.outline = true;
      mesh.add(hull);
    }
    return mesh;
  }

  private build() {
    const team = this.teamColor;
    const body = isYellowish(team) ? PALETTE.dummyAlt : PALETTE.dummy;
    const skin = this.mat(body);
    const teamMat = this.mat(team);
    const shorts = this.mat(SHORTS, "matte");
    const ink = this.mat(INK, "matte");
    const white = this.mat("#ffffff");
    const sole = this.mat("#f4f1ea", "rubber");
    const OUT = 0.016;

    for (let i = 0; i < PART_COUNT; i++) {
      const spec = PARTS[i];
      const g = new THREE.Group();
      const v = new THREE.Group();
      g.add(v);
      this.parts.push(g);
      this.visuals.push(v);
      this.root.add(g);

      if (spec.shape === "capsule") {
        const isArm = i >= LUA && i <= RFA;
        const isFore = i === LFA || i === RFA;
        const isThigh = i === LTH || i === RTH;
        const r = spec.size[1] * (isArm ? 1.18 : 1.12);
        this.mesh(this.geo(new THREE.CapsuleGeometry(r, spec.size[0] * 2, 2, 8)), skin, v, OUT);
        if (isArm && !isFore) {
          // shoulder joint disc
          this.mesh(this.geo(new THREE.SphereGeometry(r * 1.05, 8, 6)), ink, v).position.set(0, spec.size[0] + 0.02, 0);
        }
        if (isFore) {
          this.mesh(this.geo(new THREE.CylinderGeometry(r * 1.22, r * 1.22, 0.07, 10)), teamMat, v, OUT).position.set(0, -0.1, 0);
          const hand = new THREE.Group();
          hand.position.set(0, -0.2, 0);
          v.add(hand);
          this.mesh(this.geo(new THREE.SphereGeometry(0.098, 10, 8)), skin, hand, OUT).scale.set(1, 1.05, 0.9);
          this.mesh(this.geo(new THREE.SphereGeometry(0.042, 6, 4)), skin, hand).position.set(i === LFA ? 0.07 : -0.07, 0.03, -0.05);
          this.hands.push(hand);
        }
        if (isThigh) {
          this.mesh(this.geo(new THREE.CapsuleGeometry(r * 1.12, 0.05, 2, 8)), shorts, v, OUT).position.set(0, spec.size[0] * 0.7, 0);
          this.mesh(this.geo(new THREE.SphereGeometry(r * 0.92, 8, 6)), ink, v).position.set(0, -spec.size[0] - 0.02, 0);
        }
        if (i === LSH || i === RSH) {
          this.mesh(this.geo(new THREE.CylinderGeometry(r * 1.08, r * 1.08, 0.08, 10)), teamMat, v).position.set(0, -0.12, 0);
          // chunky sneaker: team upper, white sole, ink lace stripe
          const shoe = this.mesh(this.geo(new THREE.CapsuleGeometry(0.075, 0.16, 2, 8)), teamMat, v, OUT);
          shoe.rotation.x = Math.PI / 2;
          shoe.scale.set(1.05, 1, 0.78);
          shoe.position.set(0, -0.215, -0.06);
          const soleMesh = this.mesh(this.geo(new THREE.BoxGeometry(0.16, 0.035, 0.31)), sole, v, OUT);
          soleMesh.position.set(0, -0.255, -0.06);
          this.mesh(this.geo(new THREE.BoxGeometry(0.03, 0.012, 0.12)), white, v).position.set(0, -0.155, -0.11);
        }
      } else if (spec.shape === "box") {
        if (i === PELVIS) {
          this.mesh(this.geo(roundedBox(0.38, 0.24, 0.27, 0.08)), shorts, v, OUT);
          this.mesh(this.geo(new THREE.BoxGeometry(0.39, 0.045, 0.28)), teamMat, v).position.y = 0.1;
        } else {
          // chest: chunky jersey, neck, collar, calibration target, back glyph
          this.mesh(this.geo(roundedBox(0.46, 0.48, 0.29, 0.11)), teamMat, v, OUT);
          this.mesh(this.geo(new THREE.CylinderGeometry(0.075, 0.085, 0.14, 8)), skin, v).position.y = 0.27;
          const collar = this.mesh(this.geo(new THREE.TorusGeometry(0.1, 0.022, 4, 12)), white, v);
          collar.rotation.x = Math.PI / 2;
          collar.position.y = 0.235;
          if (!this.ghost) {
            const target = new THREE.Mesh(this.geo(new THREE.CircleGeometry(0.06, 20)), new THREE.MeshStandardMaterial({ map: targetTexture(), roughness: 0.6 }));
            this.owned.push(target.material as THREE.Material);
            target.position.set(0.11, 0.1, -0.147);
            target.rotation.y = Math.PI;
            v.add(target);
            const glyphTex = jerseyTexture(teamGlyph(this.teamId), this.teamId);
            this.owned.push(glyphTex);
            const back = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(0.28, 0.28)), new THREE.MeshStandardMaterial({ map: glyphTex, transparent: true, roughness: 0.7 }));
            this.owned.push(back.material as THREE.Material);
            back.position.set(0, 0.02, 0.147);
            v.add(back);
          }
        }
      } else {
        // head: oversized, readable from the back, a face worth watching
        this.mesh(this.geo(new THREE.SphereGeometry(0.236, 18, 12)), skin, v, OUT);
        if (!this.ghost) {
          for (const sx of [-1, 1]) {
            const t = new THREE.Mesh(this.geo(new THREE.CircleGeometry(0.07, 20)), new THREE.MeshStandardMaterial({ map: targetTexture(), roughness: 0.6 }));
            this.owned.push(t.material as THREE.Material);
            t.position.set(sx * 0.237, 0.02, 0.01);
            t.rotation.y = (sx * Math.PI) / 2;
            v.add(t);
          }
        }
        this.buildFace(v, white, ink);
        // cap with a wobble pivot at the crown
        this.capPivot.position.y = 0.05;
        v.add(this.capPivot);
        this.mesh(this.geo(new THREE.SphereGeometry(0.248, 16, 5, 0, Math.PI * 2, 0, Math.PI * 0.42)), teamMat, this.capPivot, OUT).position.y = -0.03;
        const brim = this.mesh(this.geo(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 10, 1, false, -Math.PI * 0.5, Math.PI)), teamMat, this.capPivot, OUT);
        brim.position.set(0, 0.07, -0.1);
        brim.scale.set(1.15, 1, 1.25);
        this.mesh(this.geo(new THREE.SphereGeometry(0.038, 6, 4)), white, this.capPivot).position.y = 0.21;
      }
    }

    if (!this.ghost) {
      // dizzy stars, shown while fallen
      this.stars = new THREE.Group();
      const starGeo = this.geo(new THREE.OctahedronGeometry(0.05, 0));
      for (let k = 0; k < 3; k++) {
        const s = new THREE.Mesh(starGeo, toyMaterial(PALETTE.dummy, "plastic", { emissive: PALETTE.goldGlow, emissiveIntensity: 0.6 }));
        s.scale.set(1, 1.6, 1);
        this.stars.add(s);
      }
      this.stars.visible = false;
      this.root.add(this.stars);
    }

    // contact shadow: grounds every jump and fall
    const blobMat = new THREE.MeshBasicMaterial({ map: radialTexture(BLOB_TEXTURE_KEY, "rgba(20,32,46,0.55)", "rgba(20,32,46,0)"), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.owned.push(blobMat);
    this.blob = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(1, 1)), blobMat);
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.renderOrder = 1;
    this.blob.visible = false;
    this.root.add(this.blob);

    if (this.showNameplate) this.setLabel(this.teamName, this.teamColor);
  }

  private buildFace(head: THREE.Group, white: THREE.Material, ink: THREE.Material) {
    const face = new THREE.Group();
    head.add(face);
    const eyeGeo = this.geo(new THREE.SphereGeometry(0.068, 10, 7));
    const pupilGeo = this.geo(new THREE.SphereGeometry(0.034, 8, 6));
    const arcGeo = this.geo(new THREE.TorusGeometry(0.045, 0.012, 6, 14, Math.PI));
    const barGeo = this.geo(new THREE.BoxGeometry(0.075, 0.016, 0.016));
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, white);
      eye.position.set(sx * 0.088, 0.035, -0.19);
      eye.scale.set(1, 1, 0.7);
      face.add(eye);
      this.eyes.push(eye);
      const pupil = new THREE.Mesh(pupilGeo, ink);
      pupil.position.set(0, 0, -0.05);
      eye.add(pupil);
      this.pupils.push(pupil);
      // ^ ^ happy eyes
      const happy = new THREE.Mesh(arcGeo, ink);
      happy.position.set(sx * 0.088, 0.03, -0.228);
      happy.visible = false;
      face.add(happy);
      this.happyEyes.push(happy);
      // X eyes
      const x = new THREE.Group();
      x.position.set(sx * 0.088, 0.035, -0.232);
      for (const r of [Math.PI / 4, -Math.PI / 4]) {
        const bar = new THREE.Mesh(barGeo, ink);
        bar.rotation.z = r;
        x.add(bar);
      }
      x.visible = false;
      face.add(x);
      this.xEyes.push(x);
      const brow = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.075, 0.018, 0.02)), ink);
      brow.position.set(sx * 0.09, 0.122, -0.205);
      face.add(brow);
      this.brows.push(brow);
      const cheek = new THREE.Mesh(this.geo(new THREE.CircleGeometry(0.03, 12)), this.ghost ? white : toyMaterial("#ff8fa3", "matte"));
      cheek.position.set(sx * 0.14, -0.035, -0.205);
      cheek.rotation.y = Math.PI + sx * 0.5;
      cheek.visible = false;
      face.add(cheek);
      this.cheeks.push(cheek);
    }
    const mouthZ = -0.222;
    const smile = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.05, 0.013, 6, 14, Math.PI)), ink);
    smile.rotation.z = Math.PI;
    smile.position.set(0, -0.055, mouthZ);
    face.add(smile);
    const grin = new THREE.Mesh(this.geo(new THREE.CircleGeometry(0.075, 10, 0, Math.PI)), ink);
    grin.rotation.set(0, Math.PI, Math.PI);
    grin.position.set(0, -0.045, mouthZ - 0.006);
    face.add(grin);
    const o = new THREE.Mesh(this.geo(new THREE.CircleGeometry(0.038, 16)), ink);
    o.rotation.y = Math.PI;
    o.scale.set(0.85, 1.15, 1);
    o.position.set(0, -0.075, mouthZ - 0.004);
    face.add(o);
    const flat = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.075, 0.016, 0.016)), ink);
    flat.position.set(0, -0.07, mouthZ + 0.004);
    face.add(flat);
    const grit = new THREE.Group();
    const teeth = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.1, 0.036, 0.016)), white);
    grit.add(teeth);
    const line = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.1, 0.006, 0.02)), ink);
    grit.add(line);
    const frame = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.112, 0.048, 0.012)), ink);
    frame.position.z = 0.005;
    grit.add(frame);
    grit.position.set(0, -0.07, mouthZ);
    face.add(grit);
    const frown = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.042, 0.012, 6, 14, Math.PI)), ink);
    frown.position.set(0, -0.09, mouthZ);
    face.add(frown);
    this.mouths = { smile, grin, o, flat, grit, frown };
    for (const m of Object.values(this.mouths)) if (m) m.visible = false;
    smile.visible = true;
  }

  /* ------------------------------ identity ------------------------------ */

  private setLabel(name: string, color: string) {
    if (this.label) {
      this.root.remove(this.label);
      disposeSprite(this.label);
    }
    this.label = makeNameplate(name, color, teamGlyph(this.teamId));
    this.label.scale.set(1.05, 0.26, 1);
    this.root.add(this.label);
  }

  setTeamName(name: string, color: string) {
    if (name === this.teamName && color === this.teamColor) return;
    this.teamName = name;
    if (this.showNameplate) this.setLabel(name, color);
  }

  /** Mark the parts this player steers; they get a pulsing team-colour outline. */
  setHighlight(roles: readonly Role[]) {
    if (this.ghost) return;
    const next = new Set<number>();
    for (const r of roles) for (const p of ROLE_PARTS[r] ?? []) next.add(p);
    if (next.size === this.highlightParts.size && [...next].every((p) => this.highlightParts.has(p))) return;
    for (const shell of this.highlightShells) shell.removeFromParent();
    this.highlightShells = [];
    this.highlightParts = next;
    if (next.size === 0) return;
    if (!this.highlightMat) {
      this.highlightMat = new THREE.MeshBasicMaterial({ color: this.teamColor, side: THREE.BackSide, transparent: true, depthWrite: false });
      this.highlightMat.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed += normalize(normal) * 0.034;");
      };
      this.highlightMat.customProgramCacheKey = () => "highlight-shell";
      this.owned.push(this.highlightMat);
    }
    for (const p of next) {
      this.visuals[p].traverse((o) => {
        if (!(o instanceof THREE.Mesh) || o.userData.outline || o.userData.shell) return;
        if (!o.children.some((c) => c.userData.outline)) return;
        const shell = new THREE.Mesh(o.geometry, this.highlightMat!);
        shell.userData.shell = true;
        shell.renderOrder = -1;
        o.add(shell);
        this.highlightShells.push(shell);
      });
    }
  }

  /** Flash the highlight (the player just pressed one of their controls). */
  pingHighlight() {
    this.highlightBoost = 1;
  }

  /* ------------------------------ per-frame ------------------------------ */

  setTransforms(arr: ArrayLike<number>, offset = 0) {
    for (let i = 0; i < PART_COUNT; i++) {
      const o = offset + i * 7;
      const g = this.parts[i];
      g.position.set(arr[o], arr[o + 1], arr[o + 2]);
      g.quaternion.set(arr[o + 3], arr[o + 4], arr[o + 5], arr[o + 6]);
    }
  }

  /** React to a gameplay moment: squash, faces, hand clench. */
  react(kind: ReactionKind, intensity = 1, hand?: number) {
    switch (kind) {
      case "land":
        this.squash.v += 2.6 * intensity;
        this.nod.v += 3 * intensity;
        if (intensity > 0.55) this.setReaction("ouch", 0.35);
        break;
      case "impact":
        this.squash.v += 1.6 * intensity;
        this.setReaction("ouch", 0.4);
        break;
      case "jump":
        this.squash.v -= 2.4;
        this.setReaction("whee", 0.5);
        break;
      case "grab":
      case "twoHandGrab":
        for (const h of hand === 0 || hand === 1 ? [hand] : [0, 1]) this.handSquash[h].v += kind === "twoHandGrab" ? 7 : 5;
        this.setReaction(kind === "twoHandGrab" ? "effort" : "yes", 0.6);
        break;
      case "release":
        for (const h of hand === 0 || hand === 1 ? [hand] : [0, 1]) this.handSquash[h].v -= 3;
        break;
      case "throw":
        this.squash.v -= 1.6;
        this.setReaction("whee", 0.7);
        break;
      case "fall":
        this.squash.v += 2;
        this.setReaction("panic", 0.4);
        break;
      case "getup":
        this.squash.v -= 2;
        this.setReaction("determined", 0.9);
        break;
      case "celebrate":
        this.squash.v -= 3;
        this.setReaction("joy", 2.4);
        break;
      case "checkpoint":
        this.setReaction("joy", 1);
        break;
      case "splash":
        this.setReaction("panic", 0.8);
        break;
      case "miss":
        this.setReaction("worried", 0.45);
        break;
    }
  }

  private setReaction(e: Expression, seconds: number) {
    // celebrations outrank small reactions
    if (this.reaction === "joy" && this.reactionT > 0.3 && e !== "joy") return;
    this.reaction = e;
    this.reactionT = seconds;
  }

  update(state: FaceState, groundProbe?: (x: number, y: number, z: number) => number | null) {
    const dt = Math.min(state.dt, 0.1);
    this.time += dt;
    const pelvis = this.parts[PELVIS].position;
    const head = this.parts[HEAD].position;

    // velocities from the rendered pose (works the same for host and replicas)
    if (this.hasPrev && dt > 0) {
      const vx = (pelvis.x - this.prevPelvis.x) / dt;
      const vy = (pelvis.y - this.prevPelvis.y) / dt;
      const vz = (pelvis.z - this.prevPelvis.z) / dt;
      if (Math.abs(vx) + Math.abs(vy) + Math.abs(vz) < 60) this.velocity.lerp(new THREE.Vector3(vx, vy, vz), 0.35);
      const hvx = (head.x - this.prevHead.x) / dt;
      const hvz = (head.z - this.prevHead.z) / dt;
      if (Math.abs(hvx) + Math.abs(hvz) < 60) {
        const ax = hvx - this.headVel.x;
        const az = hvz - this.headVel.z;
        this.capX.v += THREE.MathUtils.clamp(az, -20, 20) * 0.06;
        this.capZ.v -= THREE.MathUtils.clamp(ax, -20, 20) * 0.06;
        this.headVel.set(hvx, 0, hvz);
      }
    }
    this.prevPelvis.copy(pelvis);
    this.prevHead.copy(head);
    this.hasPrev = true;

    this.fallenT = state.fallen ? this.fallenT + dt : 0;
    this.reactionT = Math.max(0, this.reactionT - dt);
    if (this.reactionT <= 0) this.reaction = null;

    // springs
    this.squash.step(dt);
    this.nod.step(dt);
    this.capX.step(dt);
    this.capZ.step(dt);
    for (let h = 0; h < 2; h++) this.handSquash[h].step(dt, state.holding > 0 ? 0.12 : 0);

    // stretch on dramatic falls
    const fallStretch = THREE.MathUtils.clamp((-this.velocity.y - 5) * 0.025, 0, 0.12);
    const s = THREE.MathUtils.clamp(this.squash.x, -0.3, 0.3) * 0.12 - fallStretch;
    for (const p of [PELVIS, CHEST, HEAD]) this.visuals[p].scale.set(1 + s * 0.6, 1 - s, 1 + s * 0.6);
    this.visuals[HEAD].rotation.x = THREE.MathUtils.clamp(this.nod.x, -1, 1) * 0.08;
    this.capPivot.rotation.x = THREE.MathUtils.clamp(this.capX.x, -1, 1) * 0.25;
    this.capPivot.rotation.z = THREE.MathUtils.clamp(this.capZ.x, -1, 1) * 0.25;
    for (let h = 0; h < this.hands.length; h++) {
      const k = THREE.MathUtils.clamp(this.handSquash[h].x, -0.6, 0.6) * 0.3;
      this.hands[h].scale.set(1 + k * 0.7, 1 - k, 1 + k * 0.7);
    }

    this.expression = this.chooseExpression(state);
    this.applyFace(state, dt);

    // dizzy stars orbit above the head while down
    if (this.stars) {
      this.stars.visible = state.fallen && this.fallenT > 0.25;
      if (this.stars.visible) {
        this.stars.position.set(head.x, head.y + 0.36, head.z);
        this.stars.children.forEach((star, k) => {
          const a = this.time * 3.2 + (k * Math.PI * 2) / 3;
          star.position.set(Math.cos(a) * 0.22, Math.sin(a * 2) * 0.03, Math.sin(a) * 0.22);
          star.rotation.y = this.time * 6;
        });
      }
    }

    // nameplate floats above the head
    if (this.label) {
      this.label.visible = this.showNameplate;
      this.label.position.set(head.x, head.y + 0.62, head.z);
    }
    if (this.bubble) {
      this.bubbleT -= dt;
      this.bubble.visible = this.bubbleT > 0;
      if (this.bubble.visible) {
        const pop = Math.min(1, (1.6 - this.bubbleT) * 8);
        this.bubble.scale.set(1.5 * pop, 0.5 * pop, 1);
        this.bubble.position.set(head.x + 0.4, head.y + 0.85 + Math.sin(this.bubbleT * 12) * 0.03, head.z);
      }
    }

    // highlight pulse
    if (this.highlightMat) {
      this.highlightPulse += dt;
      this.highlightBoost = Math.max(0, this.highlightBoost - dt * 2.5);
      const base = 0.55 + 0.25 * Math.sin(this.highlightPulse * 4);
      this.highlightMat.opacity = Math.min(1, base + this.highlightBoost * 0.65);
      // Near-white with a hint of team: reads against the team-colour jersey and the yellow body alike.
      this.highlightMat.color.set(this.teamColor).lerp(new THREE.Color("#ffffff"), 0.7 + this.highlightBoost * 0.3);
    }

    // contact shadow
    if (this.blob) {
      const ground = groundProbe ? groundProbe(pelvis.x, pelvis.y, pelvis.z) : null;
      if (ground == null) this.blob.visible = false;
      else {
        const h = Math.max(0, pelvis.y - ground);
        const k = THREE.MathUtils.clamp(1 - (h - 0.9) / 3, 0.15, 1);
        this.blob.visible = true;
        this.blob.position.set(pelvis.x, ground + 0.02, pelvis.z);
        this.blob.scale.setScalar(0.95 * (0.6 + k * 0.4));
        (this.blob.material as THREE.MeshBasicMaterial).opacity = (this.ghost ? 0.5 : 1) * k;
      }
    }
  }

  private chooseExpression(state: FaceState): Expression {
    const vy = this.velocity.y;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.reaction === "joy") return "joy";
    if (state.fallen) {
      if (this.reaction === "determined") return "determined";
      return this.fallenT < 1.4 ? "dizzy" : "groggy";
    }
    if (this.reaction) return this.reaction;
    if (vy < -4.2) return "panic";
    if (vy > 3.2) return "whee";
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.parts[PELVIS].quaternion);
    if (up.y < 0.82) return "worried";
    if (state.hanging) return "strain";
    if (state.holding >= 2) return "effort";
    if (state.holding === 1) return "yes";
    if (speed > 0.7) return "walk";
    return "neutral";
  }

  private applyFace(state: FaceState, dt: number) {
    const e = this.expression;
    const dy = THREE.MathUtils.clamp(angleDelta(this.headYaw(), state.lookYaw) * 0.6, -1, 1);
    for (const p of this.pupils) {
      p.position.x = THREE.MathUtils.lerp(p.position.x, -dy * 0.025, 0.2);
      p.position.y = THREE.MathUtils.lerp(p.position.y, state.lookPitch * 0.03, 0.2);
      const big = e === "panic" || e === "whee" || e === "worried";
      p.scale.setScalar(THREE.MathUtils.lerp(p.scale.x, big ? 0.7 : 1, 0.25));
    }
    this.blinkT -= dt;
    if (this.blinkT < -0.12) this.blinkT = 2 + Math.random() * 3;
    const blink = this.blinkT < 0;
    const happy = e === "joy";
    const dizzy = e === "dizzy";
    let eyeY = 1;
    if (e === "groggy") eyeY = 0.35;
    else if (e === "strain" || e === "effort" || e === "determined") eyeY = 0.6;
    else if (e === "ouch") eyeY = 0.12;
    else if (e === "panic" || e === "whee" || e === "worried") eyeY = 1.2;
    if (blink && eyeY > 0.3) eyeY = 0.12;
    for (const eye of this.eyes) {
      eye.visible = !happy && !dizzy;
      eye.scale.y = THREE.MathUtils.lerp(eye.scale.y, eyeY, 0.45);
      eye.scale.x = THREE.MathUtils.lerp(eye.scale.x, e === "panic" ? 1.15 : 1, 0.3);
    }
    for (const h of this.happyEyes) h.visible = happy;
    for (const x of this.xEyes) {
      x.visible = dizzy;
      if (dizzy) x.rotation.z = Math.sin(this.time * 9) * 0.3;
    }
    // brows: [left, right]; inner ends down = angry/strain, up = worried/panic
    let browY = 0.122;
    let tilt = 0;
    if (e === "panic" || e === "whee") browY = 0.16;
    if (e === "worried") { browY = 0.15; tilt = -0.35; }
    if (e === "strain" || e === "effort" || e === "determined") { browY = 0.112; tilt = 0.35; }
    if (e === "joy" || e === "yes") browY = 0.145;
    if (e === "groggy") { browY = 0.105; tilt = -0.15; }
    this.brows.forEach((b, k) => {
      const sx = k === 0 ? -1 : 1;
      b.position.y = THREE.MathUtils.lerp(b.position.y, browY, 0.3);
      b.rotation.z = THREE.MathUtils.lerp(b.rotation.z, -sx * tilt, 0.3);
      b.visible = !dizzy;
    });
    const mouth: keyof CharacterView["mouths"] =
      e === "joy" || e === "whee" ? "grin"
        : e === "panic" || e === "worried" ? "o"
          : e === "strain" || e === "effort" ? "grit"
            : e === "ouch" || e === "determined" ? "flat"
              : e === "dizzy" || e === "groggy" ? "frown"
                : "smile";
    for (const [key, m] of Object.entries(this.mouths)) if (m) m.visible = key === mouth;
    if (mouth === "o" && this.mouths.o) this.mouths.o.scale.y = 1.15 + Math.sin(this.time * 18) * (e === "panic" ? 0.15 : 0.05);
    if (mouth === "smile" && this.mouths.smile) this.mouths.smile.scale.setScalar(e === "walk" ? 1.1 : e === "yes" ? 1.25 : 0.9);
    for (const c of this.cheeks) c.visible = e === "joy" || e === "effort" || e === "strain";
  }

  private headYaw() {
    const q = this.parts[PELVIS].quaternion;
    const v = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    return Math.atan2(-v.x, -v.z);
  }

  shout(text: string) {
    if (this.bubble) {
      this.root.remove(this.bubble);
      disposeSprite(this.bubble);
    }
    this.bubble = makeBubble(text);
    this.bubbleT = 1.6;
    this.root.add(this.bubble);
  }

  dispose() {
    if (this.label) disposeSprite(this.label);
    if (this.bubble) disposeSprite(this.bubble);
    for (const g of this.geometries) g.dispose();
    for (const o of this.owned) o.dispose();
    this.root.removeFromParent();
  }
}

/* ------------------------------ helpers ------------------------------ */

function roundedBox(w: number, h: number, d: number, r: number) {
  return new RoundedBoxGeometry(w, h, d, 3, r);
}

function angleDelta(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function jerseyTexture(glyph: string, teamId: number) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "900 64px system-ui, sans-serif";
  ctx.lineWidth = 10;
  ctx.strokeStyle = INK;
  ctx.fillStyle = "#ffffff";
  ctx.strokeText(glyph, 64, 50);
  ctx.fillText(glyph, 64, 50);
  ctx.font = "900 34px system-ui, sans-serif";
  ctx.lineWidth = 7;
  ctx.strokeText(String(teamId).padStart(2, "0"), 64, 104);
  ctx.fillText(String(teamId).padStart(2, "0"), 64, 104);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function spriteFrom(canvas: HTMLCanvasElement) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const s = new THREE.Sprite(mat);
  s.renderOrder = 10;
  return s;
}

/** Sticker nameplate: team colour pill, ink outline, team glyph, pointer tail. */
export function makeNameplate(text: string, color: string, glyph: string) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const label = text.slice(0, 20);
  let fontSize = 56;
  ctx.font = `900 ${fontSize}px system-ui, sans-serif`;
  while (fontSize > 30 && ctx.measureText(label).width > 340) {
    fontSize -= 4;
    ctx.font = `900 ${fontSize}px system-ui, sans-serif`;
  }
  const textW = ctx.measureText(label).width;
  const w = Math.min(496, textW + 130);
  const x = (512 - w) / 2;
  ctx.fillStyle = INK;
  roundRectPath(ctx, x, 10, w, 92, 46);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(240, 96);
  ctx.lineTo(256, 122);
  ctx.lineTo(272, 96);
  ctx.fill();
  ctx.fillStyle = color;
  roundRectPath(ctx, x + 7, 17, w - 14, 78, 39);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(x + 52, 56, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "900 36px system-ui, sans-serif";
  ctx.fillText(glyph, x + 52, 58);
  ctx.font = `900 ${fontSize}px system-ui, sans-serif`;
  ctx.fillText(label, x + 52 + 34 + textW / 2, 58);
  return spriteFrom(c);
}

function makeBubble(text: string) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 170;
  const ctx = c.getContext("2d")!;
  let fontSize = 60;
  ctx.font = `900 ${fontSize}px system-ui, sans-serif`;
  const label = text.slice(0, 16);
  while (fontSize > 34 && ctx.measureText(label).width > 420) {
    fontSize -= 4;
    ctx.font = `900 ${fontSize}px system-ui, sans-serif`;
  }
  ctx.fillStyle = INK;
  roundRectPath(ctx, 6, 6, 500, 124, 40);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(60, 120);
  ctx.lineTo(40, 166);
  ctx.lineTo(120, 120);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  roundRectPath(ctx, 14, 14, 484, 108, 34);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(66, 118);
  ctx.lineTo(50, 152);
  ctx.lineTo(108, 118);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 256, 70);
  const s = spriteFrom(c);
  s.center.set(0.15, 0);
  return s;
}

function disposeSprite(sprite: THREE.Sprite) {
  sprite.material.map?.dispose();
  sprite.material.dispose();
  sprite.removeFromParent();
}
