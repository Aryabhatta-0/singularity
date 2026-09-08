import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type RAPIER_T from "@dimforge/rapier3d-compat";
import { RagdollBody, PARTS, PART_COUNT, PELVIS, HEAD, CHEST, GROUP_ENV, GROUP_PROP, groups, findStaticGrab, type BodyEvent, type GrabTarget } from "./body";
import { getLevel, type LevelDef, type PropDef, type ZoneDef } from "./levels";
import { GameAudio } from "./audio";
import type { Role, RoleInput, SquadSize } from "./types";
import { makeSquadMixState, resolvePhysInputs, type SquadMixState } from "./squad";
import {
  createCommentarySystem,
  type CommentaryChallengeId,
  type CommentaryFrame,
  type CommentaryLine,
  type CommentaryObjectiveEvent,
} from "./commentary";
import { FixedStepClock } from "./simulation-clock";
import {
  SNAPSHOT_INTERPOLATION_DELAY_MS,
  SNAPSHOT_SEND_INTERVAL_SECONDS,
  snapshotExtrapolationSeconds,
} from "./network-tuning";

type R = typeof RAPIER_T;
let RAPIER: R | null = null;
async function loadRapier(): Promise<R> {
  if (RAPIER) return RAPIER;
  const mod = await import("@dimforge/rapier3d-compat");
  const R = (mod.default ?? mod) as R;
  await R.init();
  RAPIER = R;
  return R;
}

function usesCompactRenderProfile() {
  return window.matchMedia("(pointer: coarse), (max-width: 900px)").matches;
}

export interface Snap {
  t: number;
  p: number[];
  props: number[];
  yaw: number;
  pitch: number;
  timer: number;
  fallen: number;
  score: number;
  ev: (BodyEvent | { type: string; pos: [number, number, number] })[];
  msg?: string;
  state?: {
    checkpoint: number;
    delivered: boolean;
    moverTime: number;
    running: boolean;
    finished: boolean;
    frozen: boolean;
    holds?: { hand: 0 | 1; propId: number }[];
    bodyVelocities?: number[];
    propVelocities?: number[];
  };
}

export interface HudState {
  timer: number;
  fallen: boolean;
  holding: number;
  score: number;
  scoreTarget: number;
  crouch: boolean;
  brace: number;
  hanging: boolean;
  objective: string;
  running: boolean;
  finished: boolean;
}

export type GameEvent = { type: "finish"; timeMs: number } | { type: "message"; text: string; tone?: "good" | "bad" | "info" } | { type: "hud"; hud: HudState };

export interface GameOptions {
  canvas: HTMLCanvasElement;
  levelId: string;
  teamId: number;
  teamColor: string;
  isHost: boolean;
  squadSize?: SquadSize;
  onEvent: (ev: GameEvent) => void;
}

interface Mover {
  rb: RigidBodyT;
  mesh: THREE.Mesh;
  base: THREE.Vector3;
  axis: "x" | "z";
  dist: number;
  speed: number;
  phase: number;
}

const SKIN = "#ffd9b3";
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/* ---------------------------------- Body visuals ---------------------------------- */
class BodyView {
  root = new THREE.Group();
  parts: THREE.Group[] = [];
  pupils: THREE.Mesh[] = [];
  eyes: THREE.Mesh[] = [];
  mouth: THREE.Mesh = new THREE.Mesh();
  hands: THREE.Mesh[] = [];
  materials: THREE.MeshStandardMaterial[] = [];
  label: THREE.Sprite | null = null;
  bubble: THREE.Sprite | null = null;
  bubbleT = 0;
  blinkT = 2;
  private teamName: string;

  constructor(color: string, public ghost: boolean, teamName: string) {
    this.teamName = teamName;
    const mat = (c: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
      const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, metalness: 0.02, ...extra });
      if (ghost) {
        m.transparent = true;
        m.opacity = 0.42;
        m.depthWrite = false;
      }
      this.materials.push(m);
      return m;
    };
    const team = mat(color);
    const skin = mat(SKIN);
    const dark = mat("#2b2d42");
    const white = mat("#ffffff", { roughness: 0.5 });
    const shoe = mat("#f5f5f5", { roughness: 0.6 });

    for (let i = 0; i < PART_COUNT; i++) {
      const spec = PARTS[i];
      const g = new THREE.Group();
      let mesh: THREE.Mesh;
      if (spec.shape === "capsule") {
        const isLeg = i >= 7;
        const isFore = i === 4 || i === 6;
        mesh = new THREE.Mesh(new THREE.CapsuleGeometry(spec.size[1] * 1.05, spec.size[0] * 2, 6, 14), isLeg ? (i === 8 || i === 10 ? skin : team) : isFore ? skin : team);
      } else if (spec.shape === "box") {
        mesh = new THREE.Mesh(new RoundedBoxGeometry(spec.size[0] * 2, spec.size[1] * 2, spec.size[2] * 2, 4, 0.06), i === PELVIS ? dark : team);
      } else {
        mesh = new THREE.Mesh(new THREE.SphereGeometry(spec.size[0], 28, 20), skin);
      }
      mesh.castShadow = !ghost;
      mesh.receiveShadow = !ghost;
      g.add(mesh);
      if (spec.extra) {
        for (const ex of spec.extra) {
          const em =
            ex.shape === "ball"
              ? new THREE.Mesh(new THREE.SphereGeometry(ex.size[0] * 1.15, 16, 12), white)
              : new THREE.Mesh(new RoundedBoxGeometry(ex.size[0] * 2.2, ex.size[1] * 2.2, ex.size[2] * 2.1, 3, 0.03), shoe);
          em.position.set(ex.offset[0], ex.offset[1], ex.offset[2]);
          em.castShadow = !ghost;
          g.add(em);
          if (ex.shape === "ball") this.hands.push(em);
        }
      }
      if (i === HEAD) {
        // eyes
        for (const sx of [-1, 1]) {
          const eye = new THREE.Mesh(new THREE.SphereGeometry(0.062, 16, 12), white);
          eye.position.set(sx * 0.078, 0.045, -0.165);
          g.add(eye);
          this.eyes.push(eye);
          const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), dark);
          pupil.position.set(0, 0, -0.045);
          eye.add(pupil);
          this.pupils.push(pupil);
        }
        this.mouth = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 8, 14, Math.PI), dark);
        this.mouth.position.set(0, -0.06, -0.185);
        this.mouth.rotation.z = Math.PI;
        g.add(this.mouth);
        // cap
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.205, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), team);
        cap.position.y = 0.02;
        cap.castShadow = !ghost;
        g.add(cap);
        const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.025, 24, 1, false, -Math.PI * 0.5, Math.PI), team);
        brim.position.set(0, 0.075, -0.06);
        g.add(brim);
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), white);
        knob.position.y = 0.23;
        g.add(knob);
        // name label
        this.label = makeTextSprite(teamName, color);
        this.label.position.set(0, 0.55, 0);
        this.label.scale.set(1.2, 0.3, 1);
        g.add(this.label);
      }
      if (i === CHEST) {
        const badge = new THREE.Mesh(new THREE.CircleGeometry(0.09, 20), white);
        badge.position.set(0, 0.1, -0.125);
        g.add(badge);
      }
      this.parts.push(g);
      this.root.add(g);
    }
  }

  setTeamName(name: string, color: string) {
    if (name === this.teamName) return;
    this.teamName = name;
    const previous = this.label;
    if (!previous) return;
    const next = makeTextSprite(name, color);
    next.position.copy(previous.position);
    next.scale.copy(previous.scale);
    this.parts[HEAD].remove(previous);
    disposeTextSprite(previous);
    this.label = next;
    this.parts[HEAD].add(next);
  }

  setTransforms(arr: ArrayLike<number>, offset = 0) {
    for (let i = 0; i < PART_COUNT; i++) {
      const o = offset + i * 7;
      const g = this.parts[i];
      g.position.set(arr[o], arr[o + 1], arr[o + 2]);
      g.quaternion.set(arr[o + 3], arr[o + 4], arr[o + 5], arr[o + 6]);
    }
  }

  setFace(dt: number, lookYaw: number, lookPitch: number, headYaw: number, fallen: boolean, holding: boolean) {
    const dy = Math.max(-1, Math.min(1, lerpAngleDelta(headYaw, lookYaw) * 0.6));
    for (const p of this.pupils) {
      p.position.x = THREE.MathUtils.lerp(p.position.x, -dy * 0.025, 0.2);
      p.position.y = THREE.MathUtils.lerp(p.position.y, lookPitch * 0.03, 0.2);
    }
    this.blinkT -= dt;
    const sy = this.blinkT < 0 ? 0.15 : 1;
    if (this.blinkT < -0.12) this.blinkT = 2 + Math.random() * 3;
    for (const e of this.eyes) e.scale.y = THREE.MathUtils.lerp(e.scale.y, fallen ? 0.35 : sy, 0.5);
    this.mouth.scale.setScalar(fallen ? 0.6 : holding ? 1.3 : 1);
    this.mouth.rotation.z = fallen ? 0 : Math.PI;
    if (this.bubble) {
      this.bubbleT -= dt;
      this.bubble.visible = this.bubbleT > 0;
      if (this.bubble.visible) this.bubble.position.y = 0.95 + Math.sin(this.bubbleT * 12) * 0.03;
    }
  }

  shout(text: string) {
    if (this.bubble) {
      this.parts[HEAD].remove(this.bubble);
      disposeTextSprite(this.bubble);
    }
    this.bubble = makeTextSprite(text, "#ffffff", "#222222");
    this.bubble.position.set(0.35, 0.95, 0);
    this.bubble.scale.set(1.6, 0.5, 1);
    this.bubbleT = 1.4;
    this.parts[HEAD].add(this.bubble);
  }

  dispose() {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
      if (o instanceof THREE.Sprite) disposeTextSprite(o);
    });
    for (const m of this.materials) m.dispose();
  }
}

function lerpAngleDelta(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function makeTextSprite(text: string, bg: string, fg = "#ffffff") {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = bg;
  roundRect(ctx, 8, 8, 496, 112, 40);
  ctx.fill();
  ctx.fillStyle = fg;
  const displayText = text.slice(0, 22);
  let fontSize = 64;
  ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  while (fontSize > 34 && ctx.measureText(displayText).width > 440) {
    fontSize -= 4;
    ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(displayText, 256, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const s = new THREE.Sprite(mat);
  s.renderOrder = 10;
  return s;
}

function disposeTextSprite(sprite: THREE.Sprite) {
  sprite.material.map?.dispose();
  sprite.material.dispose();
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

/* ---------------------------------- Particles ---------------------------------- */
class Particles {
  mesh: THREE.InstancedMesh;
  max = 700;
  pos: Float32Array;
  vel: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  size: Float32Array;
  spin: Float32Array;
  head = 0;
  dummy = new THREE.Object3D();
  color = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.pos = new Float32Array(this.max * 3);
    this.vel = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max);
    this.maxLife = new Float32Array(this.max);
    this.size = new Float32Array(this.max);
    this.spin = new Float32Array(this.max);
    for (let i = 0; i < this.max; i++) {
      this.dummy.position.set(0, -100, 0);
      this.dummy.scale.setScalar(0.0001);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.color.set(0xffffff));
    }
    scene.add(this.mesh);
  }

  emit(p: THREE.Vector3 | [number, number, number], count: number, opts: { color?: string | string[]; speed?: number; up?: number; size?: number; life?: number; spread?: number } = {}) {
    const px = Array.isArray(p) ? p[0] : p.x;
    const py = Array.isArray(p) ? p[1] : p.y;
    const pz = Array.isArray(p) ? p[2] : p.z;
    const speed = opts.speed ?? 2;
    const colors = Array.isArray(opts.color) ? opts.color : [opts.color ?? "#e8dcc5"];
    for (let n = 0; n < count; n++) {
      const i = this.head;
      this.head = (this.head + 1) % this.max;
      const sp = opts.spread ?? 0.15;
      this.pos[i * 3] = px + (Math.random() - 0.5) * sp;
      this.pos[i * 3 + 1] = py + (Math.random() - 0.5) * sp;
      this.pos[i * 3 + 2] = pz + (Math.random() - 0.5) * sp;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random();
      this.vel[i * 3] = Math.cos(a) * r * speed;
      this.vel[i * 3 + 1] = (opts.up ?? 1.5) * (0.5 + Math.random());
      this.vel[i * 3 + 2] = Math.sin(a) * r * speed;
      this.life[i] = this.maxLife[i] = (opts.life ?? 0.6) * (0.6 + Math.random() * 0.6);
      this.size[i] = (opts.size ?? 0.08) * (0.6 + Math.random() * 0.8);
      this.spin[i] = Math.random() * 6;
      this.mesh.setColorAt(i, this.color.set(colors[Math.floor(Math.random() * colors.length)]));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= 5 * dt;
      this.vel[i * 3] *= 0.98;
      this.vel[i * 3 + 2] *= 0.98;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.dummy.position.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      this.dummy.rotation.set(this.spin[i] * this.life[i], this.spin[i], 0);
      this.dummy.scale.setScalar(this.life[i] <= 0 ? 0.0001 : this.size[i] * (0.3 + k));
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    const materials = Array.isArray(this.mesh.material) ? this.mesh.material : [this.mesh.material];
    for (const material of materials) material.dispose();
  }
}

/* ---------------------------------- Props ---------------------------------- */
interface Prop {
  id: number;
  def: PropDef;
  body: RigidBodyT | null;
  colliderHandle: number;
  mesh: THREE.Object3D;
  radius: number;
  start: THREE.Vector3;
  cooldown: number;
}
type RigidBodyT = RAPIER_T.RigidBody;

interface TeamGhost {
  view: BodyView;
  buffer: { recv: number; snap: Snap }[];
  lastEvT: number;
}

/* ---------------------------------- Game ---------------------------------- */
export class Game {
  R!: R;
  world!: RAPIER_T.World;
  eventQueue!: RAPIER_T.EventQueue;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  particles: Particles;
  audio = new GameAudio();
  sun: THREE.DirectionalLight;
  level!: LevelDef;
  levelGroup = new THREE.Group();
  staticBodies: RigidBodyT[] = [];
  nonGrabHandles = new Set<number>();
  props: Prop[] = [];
  body: RagdollBody | null = null;
  view: BodyView;
  ghosts = new Map<number, TeamGhost>();
  ownBuffer: { recv: number; snap: Snap }[] = [];
  isHost: boolean;
  teamId: number;
  teamColor: string;
  teamName = "Team";
  remoteInputs: Partial<Record<Role, RoleInput>> = {};
  localInputs: Partial<Record<Role, RoleInput>> = {};
  squadSize: SquadSize = 5;
  squadMix: SquadMixState = makeSquadMixState();
  commentary = createCommentarySystem();
  commentaryInputs: Partial<Record<Role, RoleInput>> = {};
  commentaryRun = 0;
  movers: Mover[] = [];
  moverT = 0;
  delivered = false;
  denyCooldown = 0;
  skyMat: THREE.ShaderMaterial | null = null;
  sky: THREE.Mesh | null = null;
  onEvent: GameOptions["onEvent"];
  // camera
  camYaw = 0;
  camPitch = 0.3;
  camFocus = new THREE.Vector3();
  shake = 0;
  // timing
  running = false;
  finished = false;
  frozen = false;
  timer = 0;
  score = 0;
  checkpointIdx = -1;
  lastFrame = 0;
  raf = 0;
  fixedDt = 1 / 120;
  // Foreground hosts stay real-time down to 1 FPS. Longer discontinuities are
  // bounded to one second; hidden hosts proactively yield to a teammate.
  simulationClock = new FixedStepClock(this.fixedDt, 120, 1);
  sendAcc = 0;
  pendingEvents: Snap["ev"] = [];
  pendingMsg: string | undefined;
  hudAcc = 0;
  disposed = false;
  delayedEffects = new Set<ReturnType<typeof setTimeout>>();
  displayYaw = 0;
  displayPitch = 0;
  displayFallen = false;
  displayHolding = 0;
  displayTransforms: number[] = new Array(PART_COUNT * 7).fill(0);
  finishGate: THREE.Group | null = null;
  deliverPad: THREE.Mesh | null = null;
  checkpointMeshes: THREE.Mesh[] = [];
  water: THREE.Mesh | null = null;
  onSnapshot: ((s: Snap) => void) | null = null;

  static async create(opts: GameOptions) {
    const R = await loadRapier();
    const g = new Game(opts);
    g.R = R;
    g.setLevel(opts.levelId);
    g.start();
    return g;
  }

  private constructor(opts: GameOptions) {
    this.onEvent = opts.onEvent;
    this.isHost = opts.isHost;
    this.teamId = opts.teamId;
    this.teamColor = opts.teamColor;
    this.squadSize = opts.squadSize === 3 ? 3 : 5;
    const canvas = opts.canvas;
    const compactRenderProfile = usesCompactRenderProfile();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, compactRenderProfile ? 1.35 : 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 300);
    this.scene.fog = new THREE.Fog(new THREE.Color("#cfe3ff"), 45, 160);

    // sky dome
    const skyGeo = new THREE.SphereGeometry(200, 24, 12);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { top: { value: new THREE.Color("#3f7fe0") }, mid: { value: new THREE.Color("#8fc2ff") }, bot: { value: new THREE.Color("#e6f1ff") } },
      vertexShader: `varying vec3 vW; void main(){ vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vW; void main(){ float h = normalize(vW).y; vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.7)) : mix(mid, bot, clamp(-h*4.0,0.0,1.0)); gl_FragColor = vec4(c,1.0); }`,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.frustumCulled = false;
    this.scene.add(sky);
    this.sky = sky;
    this.skyMat = skyMat;

    const hemi = new THREE.HemisphereLight("#cfe4ff", "#5f8a4a", 0.75);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight("#fff4e0", 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(compactRenderProfile ? 1024 : 2048, compactRenderProfile ? 1024 : 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 120;
    this.sun.shadow.camera.left = -22;
    this.sun.shadow.camera.right = 22;
    this.sun.shadow.camera.top = 22;
    this.sun.shadow.camera.bottom = -22;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // water
    const water = new THREE.Mesh(new THREE.PlaneGeometry(600, 600, 1, 1), new THREE.MeshStandardMaterial({ color: "#2f8fe0", roughness: 0.25, metalness: 0.1 }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = -3;
    water.receiveShadow = true;
    this.scene.add(water);
    this.water = water;

    this.scene.add(this.levelGroup);
    this.particles = new Particles(this.scene);
    this.view = new BodyView(this.teamColor, false, "");
    this.scene.add(this.view.root);

    this.resize();
    window.addEventListener("resize", this.resize);
    window.addEventListener("blur", this.releaseLocalControls);
    document.addEventListener("visibilitychange", this.releaseLocalControls);
  }

  private releaseLocalControls = () => {
    this.localInputs = {};
    this.simulationClock.reset();
    this.lastFrame = performance.now();
  };

  resize = () => {
    const c = this.renderer.domElement;
    const w = c.clientWidth || window.innerWidth;
    const h = c.clientHeight || window.innerHeight;
    const pixelRatio = Math.min(window.devicePixelRatio, usesCompactRenderProfile() ? 1.35 : 1.75);
    if (Math.abs(this.renderer.getPixelRatio() - pixelRatio) > 0.01) this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  setTeamName(name: string) {
    if (name === this.teamName) return;
    this.teamName = name;
    this.view.setTeamName(name, this.teamColor);
  }

  /** Rebind the local renderer and simulation after a lobby team switch. */
  setTeam(teamId: number, color: string, name: string) {
    if (teamId === this.teamId && color === this.teamColor) {
      this.setTeamName(name);
      return;
    }

    this.teamId = teamId;
    this.teamColor = color;
    this.teamName = name;
    this.ownBuffer = [];
    this.remoteInputs = {};
    this.localInputs = {};
    this.commentaryInputs = {};

    const previous = this.view;
    const replacement = new BodyView(color, false, name);
    replacement.setTransforms(this.displayTransforms);
    this.scene.add(replacement.root);
    this.scene.remove(previous.root);
    previous.dispose();
    this.view = replacement;

    // Team changes are lobby-only. Reset the private physics copy so the new
    // team starts at its own spawn instead of inheriting the old team's pose.
    if (this.R && this.level) {
      const levelId = this.level.id;
      this.setLevel(levelId);
      this.freeRoam();
    }
  }

  private scheduleEffect(callback: () => void, delayMs: number) {
    const timeoutId = setTimeout(() => {
      this.delayedEffects.delete(timeoutId);
      if (!this.disposed) callback();
    }, delayMs);
    this.delayedEffects.add(timeoutId);
  }

  private clearDelayedEffects() {
    for (const timeoutId of this.delayedEffects) clearTimeout(timeoutId);
    this.delayedEffects.clear();
  }

  /* ------------------------------- Level ------------------------------- */
  private disposeLevelAssets() {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.levelGroup.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of meshMaterials) {
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) textures.add(value);
        }
      }
    });
    for (const texture of textures) texture.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.levelGroup.clear();
  }

  setLevel(levelId: string) {
    this.clearDelayedEffects();
    this.level = getLevel(levelId);
    this.commentary.reset(`${this.teamId}:${this.level.id}:level`);
    this.commentaryInputs = {};
    // reset physics world entirely
    if (this.eventQueue) this.eventQueue.free();
    if (this.world) this.world.free();
    const R = this.R;
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = this.fixedDt;
    this.eventQueue = new R.EventQueue(true);
    this.body = null;
    this.staticBodies = [];
    this.nonGrabHandles.clear();
    this.props = [];
    this.disposeLevelAssets();
    this.checkpointMeshes = [];
    this.finishGate = null;
    this.deliverPad = null;
    this.movers = [];
    this.moverT = 0;
    this.delivered = false;
    this.squadMix = makeSquadMixState();
    this.score = 0;
    this.checkpointIdx = -1;
    this.timer = 0;
    this.running = false;
    this.finished = false;

    const L = this.level;
    // per-level sky + water tint (falls back to day blue)
    if (this.skyMat) {
      const sky = L.sky ?? { top: "#3f7fe0", mid: "#8fc2ff", bot: "#e6f1ff", fog: "#cfe3ff" };
      this.skyMat.uniforms.top.value.set(sky.top);
      this.skyMat.uniforms.mid.value.set(sky.mid);
      this.skyMat.uniforms.bot.value.set(sky.bot);
      this.scene.fog = new THREE.Fog(new THREE.Color(sky.fog), 45, 160);
    }
    if (this.water) {
      (this.water.material as THREE.MeshStandardMaterial).color.set(L.water ?? "#2f8fe0");
      this.water.position.y = L.killY < -3 ? -4 : -3;
    }
    for (const s of L.statics) {
      const rot = new THREE.Euler(s.rot?.[0] ?? 0, s.rot?.[1] ?? 0, s.rot?.[2] ?? 0);
      const q = new THREE.Quaternion().setFromEuler(rot);
      const isMover = Boolean(s.slide);
      const moverPhase = s.slide?.phase ?? 0;
      const initialOffset = isMover ? Math.sin(moverPhase) * s.slide!.dist : 0;
      const initialX = s.pos[0] + (s.slide?.axis === "x" ? initialOffset : 0);
      const initialZ = s.pos[2] + (s.slide?.axis === "z" ? initialOffset : 0);
      const desc = isMover
        ? R.RigidBodyDesc.kinematicVelocityBased().setTranslation(initialX, s.pos[1], initialZ).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        : R.RigidBodyDesc.fixed().setTranslation(s.pos[0], s.pos[1], s.pos[2]).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      const rb = this.world.createRigidBody(desc);
      const col = this.world.createCollider(R.ColliderDesc.cuboid(s.size[0] / 2, s.size[1] / 2, s.size[2] / 2).setFriction(0.9).setCollisionGroups(groups(GROUP_ENV, 0xffff)), rb);
      if (s.grab === false) this.nonGrabHandles.add(col.handle);
      this.staticBodies.push(rb);
      const side = new THREE.MeshStandardMaterial({ color: s.color ?? "#999", roughness: 0.85 });
      const top = new THREE.MeshStandardMaterial({ color: s.top ?? s.color ?? "#bbb", roughness: 0.85 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.size[0], s.size[1], s.size[2]), [side, side, top, side, side, side]);
      mesh.position.set(initialX, s.pos[1], initialZ);
      mesh.quaternion.copy(q);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.levelGroup.add(mesh);
      if (isMover) this.movers.push({ rb, mesh, base: new THREE.Vector3(s.pos[0], s.pos[1], s.pos[2]), axis: s.slide!.axis, dist: s.slide!.dist, speed: s.slide!.speed, phase: moverPhase });
      if (s.kind === "ground" || s.kind === "block") {
        // decorative edge stripe
        const stripe = new THREE.Mesh(
          new THREE.BoxGeometry(s.size[0] + 0.02, 0.08, s.size[2] + 0.02),
          new THREE.MeshStandardMaterial({ color: new THREE.Color(s.top ?? "#fff").multiplyScalar(0.85), roughness: 0.9 })
        );
        stripe.position.set(s.pos[0], s.pos[1] + s.size[1] / 2 - 0.12, s.pos[2]);
        stripe.quaternion.copy(q);
        this.levelGroup.add(stripe);
      }
    }
    // props
    L.props.forEach((p, idx) => this.createProp(p, idx));
    // zones
    L.checkpoints.forEach((cp, i) => this.levelGroup.add(this.makeCheckpointVisual(cp, i)));
    if (L.finish) {
      this.finishGate = this.makeFinishGate(L.finish);
      this.levelGroup.add(this.finishGate);
    }
    if (L.deliver) {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(L.deliver.size[0] * 0.55, L.deliver.size[0] * 0.6, 0.12, 32), new THREE.MeshStandardMaterial({ color: "#5ff5ea", emissive: "#2ad2c8", emissiveIntensity: 0.8, roughness: 0.4 }));
      pad.position.set(L.deliver.pos[0], L.deliver.pos[1] - L.deliver.size[1] / 2 + 0.06, L.deliver.pos[2]);
      pad.receiveShadow = true;
      this.levelGroup.add(pad);
      this.deliverPad = pad;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(L.deliver.size[0] * 0.6, 0.05, 10, 40), new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#5ff5ea", emissiveIntensity: 1 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.copy(pad.position).add(new THREE.Vector3(0, 0.08, 0));
      this.levelGroup.add(ring);
    }
    if (L.hoop) {
      const h = L.hoop;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(h.radius, 0.05, 12, 40), new THREE.MeshStandardMaterial({ color: "#ff5d3d", roughness: 0.4, metalness: 0.3 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(h.pos[0], h.pos[1], h.pos[2]);
      ring.castShadow = true;
      this.levelGroup.add(ring);
      // net (cone wireframe)
      const net = new THREE.Mesh(new THREE.CylinderGeometry(h.radius, h.radius * 0.6, 0.55, 16, 3, true), new THREE.MeshBasicMaterial({ color: "#ffffff", wireframe: true, transparent: true, opacity: 0.6 }));
      net.position.set(h.pos[0], h.pos[1] - 0.3, h.pos[2]);
      this.levelGroup.add(net);
      // hoop physics ring as static segments
      const segs = 12;
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const x = h.pos[0] + Math.cos(a) * h.radius;
        const z = h.pos[2] + Math.sin(a) * h.radius;
        const rb = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, h.pos[1], z));
        const col = this.world.createCollider(R.ColliderDesc.ball(0.06).setCollisionGroups(groups(GROUP_ENV, 0xffff)), rb);
        this.nonGrabHandles.add(col.handle);
      }
    }
    // rest pose for rendering before the first physics/snapshot update
    {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), L.spawnYaw);
      for (let i = 0; i < PART_COUNT; i++) {
        const p = PARTS[i];
        const v = new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]).applyQuaternion(q).add(new THREE.Vector3(...L.spawn));
        const o = i * 7;
        this.displayTransforms[o] = v.x;
        this.displayTransforms[o + 1] = v.y;
        this.displayTransforms[o + 2] = v.z;
        this.displayTransforms[o + 3] = q.x;
        this.displayTransforms[o + 4] = q.y;
        this.displayTransforms[o + 5] = q.z;
        this.displayTransforms[o + 6] = q.w;
      }
      this.displayYaw = L.spawnYaw;
      this.displayPitch = 0;
    }
    // spawn own body
    this.camYaw = L.spawnYaw;
    this.camFocus.set(L.spawn[0], L.spawn[1] + 1, L.spawn[2]);
    if (this.isHost) this.spawnBody(new THREE.Vector3(...L.spawn), L.spawnYaw);
    this.ownBuffer = [];
    for (const g of this.ghosts.values()) g.buffer = [];
    this.emitHud();
  }

  private createProp(p: PropDef, id: number) {
    const R = this.R;
    const pos = new THREE.Vector3(...p.pos);
    let mesh: THREE.Object3D;
    let radius: number;
    let body: RigidBodyT | null = null;
    let colliderHandle = -1;
    if (p.kind === "ball") {
      radius = p.radius ?? 0.3;
      const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 28, 20), new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.55 }));
      const stripe = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.98, 0.02, 8, 40), new THREE.MeshStandardMaterial({ color: "#2b2d42" }));
      m.add(stripe);
      const stripe2 = stripe.clone();
      stripe2.rotation.y = Math.PI / 2;
      m.add(stripe2);
      mesh = m;
    } else if (p.kind === "egg") {
      radius = p.radius ?? 0.28;
      const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 28, 20), new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.4 }));
      m.scale.set(1, 1.28, 1);
      const face = new THREE.Group();
      for (const sx of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshStandardMaterial({ color: "#2b2d42" }));
        eye.position.set(sx * 0.09, 0.08, -radius * 0.92);
        face.add(eye);
      }
      const blush1 = new THREE.Mesh(new THREE.CircleGeometry(0.035, 12), new THREE.MeshStandardMaterial({ color: "#ff9db0" }));
      blush1.position.set(-0.15, 0.0, -radius * 0.93);
      const blush2 = blush1.clone();
      blush2.position.x = 0.15;
      face.add(blush1, blush2);
      const wrap = new THREE.Group();
      wrap.add(m, face);
      mesh = wrap;
    } else {
      const s = p.size ?? [0.6, 0.6, 0.6];
      radius = Math.max(...s) * 0.75;
      const m = new THREE.Mesh(new RoundedBoxGeometry(s[0], s[1], s[2], 3, 0.04), new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.8 }));
      const band = new THREE.Mesh(new THREE.BoxGeometry(s[0] * 1.02, s[1] * 0.18, s[2] * 1.02), new THREE.MeshStandardMaterial({ color: "#8a5a2b", roughness: 0.9 }));
      m.add(band);
      mesh = m;
    }
    mesh.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    mesh.position.copy(pos);
    this.levelGroup.add(mesh);
    if (this.isHost) {
      body = this.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setLinearDamping(0.2).setAngularDamping(0.6).setCcdEnabled(true));
      let cd: RAPIER_T.ColliderDesc;
      if (p.kind === "ball") cd = R.ColliderDesc.ball(radius).setRestitution(0.55);
      else if (p.kind === "egg") cd = R.ColliderDesc.capsule(radius * 0.25, radius * 0.95).setRestitution(0.2);
      else {
        const s = p.size ?? [0.6, 0.6, 0.6];
        cd = R.ColliderDesc.cuboid(s[0] / 2, s[1] / 2, s[2] / 2).setRestitution(0.1);
      }
      cd.setMass(p.mass).setFriction(0.8).setCollisionGroups(groups(GROUP_PROP, 0xffff));
      cd.setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(p.fragile ? (this.level.fragileForce ?? 900) * 0.5 : 150);
      const col = this.world.createCollider(cd, body);
      colliderHandle = col.handle;
    }
    this.props.push({ id, def: p, body, colliderHandle, mesh, radius, start: pos.clone(), cooldown: 0 });
  }

  private makeCheckpointVisual(cp: ZoneDef, i: number) {
    const g = new THREE.Group();
    const s = cp.spawn ?? cp.pos;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 10), new THREE.MeshStandardMaterial({ color: "#eeeeee" }));
    pole.position.set(s[0] + cp.size[0] / 2 - 0.5, s[1] + 1.1, s[2]);
    pole.castShadow = true;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.45), new THREE.MeshStandardMaterial({ color: "#ffd23f", side: THREE.DoubleSide, emissive: "#ffd23f", emissiveIntensity: 0.2 }));
    flag.position.set(-0.42, 0.85, 0);
    pole.add(flag);
    flag.userData.idx = i;
    this.checkpointMeshes.push(flag);
    g.add(pole);
    return g;
  }

  private makeFinishGate(z: ZoneDef) {
    const g = new THREE.Group();
    const w = Math.min(z.size[0], 7);
    const h = 3.6;
    const pillarMat = new THREE.MeshStandardMaterial({ color: "#f4f4f8", roughness: 0.5 });
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(new RoundedBoxGeometry(0.4, h, 0.4, 3, 0.05), pillarMat);
      p.position.set(z.pos[0] + (sx * w) / 2, z.pos[1] - z.size[1] / 2 + h / 2, z.pos[2]);
      p.castShadow = true;
      g.add(p);
    }
    // checkered banner
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 96;
    const ctx = c.getContext("2d")!;
    for (let y = 0; y < 3; y++) for (let x = 0; x < 16; x++) {
      ctx.fillStyle = (x + y) % 2 ? "#111" : "#fff";
      ctx.fillRect(x * 32, y * 32, 32, 32);
    }
    ctx.fillStyle = "#ff3b3b";
    ctx.font = "bold 60px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#fff";
    ctx.strokeText("FINISH", 256, 48);
    ctx.fillText("FINISH", 256, 48);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const banner = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.7, 0.2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    banner.position.set(z.pos[0], z.pos[1] - z.size[1] / 2 + h - 0.35, z.pos[2]);
    banner.castShadow = true;
    g.add(banner);
    return g;
  }

  /* ------------------------------- Body ------------------------------- */
  spawnBody(pos: THREE.Vector3, yaw: number) {
    if (this.body) this.body.dispose();
    this.body = new RagdollBody(this.R, this.world, pos, yaw);
    this.body.findGrab = (hp, exclude) => this.findGrab(hp, exclude);
    this.body.inputs.head.lx = yaw;
  }

  setHost(isHost: boolean) {
    if (isHost === this.isHost) return;
    this.isHost = isHost;
    if (isHost) {
      // Rebuild authoritative physics, then restore the complete last received
      // pose/objective state instead of restarting at a checkpoint.
      const last = this.ownBuffer[this.ownBuffer.length - 1]?.snap;
      const cp = this.level.checkpoints[this.checkpointIdx];
      const fallbackState = {
        checkpoint: this.checkpointIdx,
        delivered: this.delivered,
        moverTime: this.moverT,
        running: this.running,
        finished: this.finished,
        frozen: this.frozen,
      };
      this.setLevel(this.level.id);
      if (last) this.restoreAuthoritativeSnapshot(last);
      else {
        if (cp?.spawn) this.body?.teleport(new THREE.Vector3(...cp.spawn), this.level.spawnYaw);
        this.restoreObjectiveState(fallbackState);
      }
      this.simulationClock.reset();
    } else {
      if (this.body) this.body.dispose();
      this.body = null;
    }
  }

  private restoreObjectiveState(state: NonNullable<Snap["state"]>) {
    this.checkpointIdx = state.checkpoint;
    this.delivered = state.delivered;
    this.moverT = state.moverTime;
    this.running = state.running;
    this.finished = state.finished;
    this.frozen = state.frozen;
    for (let i = 0; i < this.checkpointMeshes.length; i++) {
      (this.checkpointMeshes[i].material as THREE.MeshStandardMaterial).color.set(i <= state.checkpoint ? "#6ef29a" : "#ffd23f");
    }
    for (const mover of this.movers) {
      const offset = Math.sin(this.moverT * mover.speed + mover.phase) * mover.dist;
      const x = mover.base.x + (mover.axis === "x" ? offset : 0);
      const z = mover.base.z + (mover.axis === "z" ? offset : 0);
      mover.rb.setTranslation({ x, y: mover.base.y, z }, true);
      mover.rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      mover.mesh.position.set(x, mover.base.y, z);
    }
    if (this.body) this.body.frozen = state.frozen;
  }

  private restoreAuthoritativeSnapshot(snapshot: Snap) {
    if (!this.body) return;
    this.body.restoreTransforms(snapshot.p, snapshot.yaw, snapshot.pitch, snapshot.fallen === 1, snapshot.state?.bodyVelocities);
    this.displayTransforms = [...snapshot.p];
    this.displayYaw = snapshot.yaw;
    this.displayPitch = snapshot.pitch;
    this.displayFallen = snapshot.fallen === 1;
    this.timer = snapshot.timer;
    this.score = snapshot.score;
    for (let offset = 0; offset + 7 < snapshot.props.length; offset += 8) {
      const prop = this.props.find((candidate) => candidate.id === snapshot.props[offset]);
      if (!prop?.body) continue;
      prop.body.setTranslation({ x: snapshot.props[offset + 1], y: snapshot.props[offset + 2], z: snapshot.props[offset + 3] }, true);
      prop.body.setRotation({ x: snapshot.props[offset + 4], y: snapshot.props[offset + 5], z: snapshot.props[offset + 6], w: snapshot.props[offset + 7] }, true);
      const velocityOffset = snapshot.state?.propVelocities?.findIndex((value, index) => index % 7 === 0 && value === prop.id) ?? -1;
      if (velocityOffset >= 0 && snapshot.state?.propVelocities) {
        const velocities = snapshot.state.propVelocities;
        prop.body.setLinvel({ x: velocities[velocityOffset + 1], y: velocities[velocityOffset + 2], z: velocities[velocityOffset + 3] }, true);
        prop.body.setAngvel({ x: velocities[velocityOffset + 4], y: velocities[velocityOffset + 5], z: velocities[velocityOffset + 6] }, true);
      } else {
        prop.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        prop.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
      prop.mesh.position.set(snapshot.props[offset + 1], snapshot.props[offset + 2], snapshot.props[offset + 3]);
      prop.mesh.quaternion.set(snapshot.props[offset + 4], snapshot.props[offset + 5], snapshot.props[offset + 6], snapshot.props[offset + 7]);
    }
    if (snapshot.state) {
      this.restoreObjectiveState(snapshot.state);
      for (const held of snapshot.state.holds ?? []) {
        if (held.propId < 0) {
          this.body.restoreStaticHold(held.hand, held.propId);
        } else {
          const prop = this.props.find((candidate) => candidate.id === held.propId);
          if (prop?.body) this.body.restoreDynamicHold(held.hand, prop.body, prop.id, prop.def.mass);
        }
      }
    }
    this.displayHolding = this.body.holds.length;
  }

  private findGrab(hp: THREE.Vector3, exclude: number[]): GrabTarget | null {
    let best: GrabTarget | null = null;
    let bestD = 0.24;
    for (const p of this.props) {
      if (!p.body || exclude.includes(p.id)) continue;
      const t = p.body.translation();
      const d = Math.hypot(t.x - hp.x, t.y - hp.y, t.z - hp.z) - p.radius;
      if (d < bestD) {
        bestD = d;
        const r = p.body.rotation();
        tmpQ.set(r.x, r.y, r.z, r.w).invert();
        const local = tmpV.copy(hp).sub(tmpV2.set(t.x, t.y, t.z)).applyQuaternion(tmpQ);
        // hand rests just outside the surface so the palm doesn't crush the prop
        if (local.lengthSq() < 1e-6) local.set(0, 1, 0);
        local.setLength(p.radius + 0.06);
        best = { body: p.body, localAnchor: local.clone(), isStatic: false, mass: p.def.mass, id: p.id };
      }
    }
    if (best) return best;
    return findStaticGrab(this.R, this.world, hp, this.body?.heading ?? 0, (h) => !this.nonGrabHandles.has(h));
  }

  /* ------------------------------- Inputs ------------------------------- */
  setLocalInput(role: Role, input: RoleInput) {
    this.localInputs[role] = input;
  }
  setRemoteInputs(inputs: Partial<Record<Role, RoleInput>>) {
    // A remote update is a complete state description, never a patch.
    this.remoteInputs = { ...inputs };
  }
  clearRemoteInputs() {
    this.remoteInputs = {};
  }
  clearOwnSnapshots() {
    this.ownBuffer = [];
  }

  /* ------------------------------- Flow ------------------------------- */
  prepareRun() {
    // teleport to spawn, freeze, reset props and state
    this.clearOwnSnapshots();
    this.finished = false;
    this.running = false;
    this.timer = 0;
    this.score = 0;
    this.checkpointIdx = -1;
    this.delivered = false;
    this.denyCooldown = 0;
    this.moverT = 0;
    this.simulationClock.reset();
    this.squadMix = makeSquadMixState();
    this.commentaryRun += 1;
    this.commentary.reset(`${this.teamId}:${this.level.id}:${this.commentaryRun}`);
    for (const f of this.checkpointMeshes) (f.material as THREE.MeshStandardMaterial).color.set("#ffd23f");
    for (const m of this.movers) {
      const initialOffset = Math.sin(m.phase) * m.dist;
      const x = m.base.x + (m.axis === "x" ? initialOffset : 0);
      const z = m.base.z + (m.axis === "z" ? initialOffset : 0);
      m.mesh.position.set(x, m.base.y, z);
      if (this.isHost) {
        m.rb.setTranslation({ x, y: m.base.y, z }, true);
        m.rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    if (this.isHost && this.body) {
      this.body.teleport(new THREE.Vector3(...this.level.spawn), this.level.spawnYaw);
      for (const p of this.props) this.resetProp(p);
      this.body.frozen = true;
    }
    this.frozen = true;
    this.emitHud();
  }
  go() {
    this.frozen = false;
    if (this.body) this.body.frozen = false;
    this.running = true;
    this.timer = 0;
    this.commentOnObjective({ type: "start" });
    this.emitHud();
  }
  freeRoam() {
    this.frozen = false;
    this.running = false;
    this.finished = false;
    if (this.body) this.body.frozen = false;
    this.emitHud();
  }
  stopRun() {
    this.running = false;
    this.emitHud();
  }

  private resetProp(p: Prop) {
    if (!p.body) return;
    p.body.setTranslation({ x: p.start.x, y: p.start.y, z: p.start.z }, true);
    p.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    p.cooldown = 0.5;
  }

  /* ------------------------------- Loop ------------------------------- */
  start() {
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      if (document.visibilityState === "hidden") {
        this.lastFrame = now;
        return;
      }
      let dt = (now - this.lastFrame) / 1000;
      this.lastFrame = now;
      if (!Number.isFinite(dt) || dt < 0) dt = 0;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private frame(dt: number) {
    if (this.isHost && this.body) {
      // merge squad inputs (3P/5P) into the 5 physics channels
      const merged: Partial<Record<Role, RoleInput>> = { ...this.remoteInputs, ...this.localInputs };
      this.commentaryInputs = merged;
      const steps = this.simulationClock.advance(dt);
      for (let step = 0; step < steps; step++) {
        const phys = resolvePhysInputs(merged, this.squadSize, this.fixedDt, this.squadMix);
        Object.assign(this.body.inputs, phys);
        this.stepPhysics(this.fixedDt);
      }
      this.body.writeTransforms(this.displayTransforms);
      this.displayYaw = this.body.heading;
      this.displayPitch = this.body.headPitch;
      this.displayFallen = this.body.fallen;
      this.displayHolding = this.body.holds.length;
      for (const p of this.props) {
        if (!p.body) continue;
        const t = p.body.translation();
        const r = p.body.rotation();
        p.mesh.position.set(t.x, t.y, t.z);
        p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      }
      for (const m of this.movers) {
        const t = m.rb.translation();
        m.mesh.position.set(t.x, t.y, t.z);
      }
      this.sendAcc += dt;
      if (this.sendAcc >= SNAPSHOT_SEND_INTERVAL_SECONDS) {
        this.sendAcc %= SNAPSHOT_SEND_INTERVAL_SECONDS;
        const snapshot = this.takeSnapshot();
        this.onSnapshot?.(snapshot);
      }
    } else {
      this.applyInterpolated(this.ownBuffer, this.displayTransforms, true);
      // guests mirror deterministic movers locally (host runs the physics)
      if (this.movers.length > 0 && !this.frozen) {
        this.moverT += dt;
        for (const m of this.movers) {
          const off = Math.sin(this.moverT * m.speed + m.phase) * m.dist;
          m.mesh.position.set(m.base.x + (m.axis === "x" ? off : 0), m.base.y, m.base.z + (m.axis === "z" ? off : 0));
        }
      }
    }
    this.view.setTransforms(this.displayTransforms);
    this.view.setFace(dt, this.displayYaw, this.displayPitch, this.pelvisYawFromDisplay(), this.displayFallen, this.displayHolding > 0);
    // ghosts
    for (const g of this.ghosts.values()) {
      const arr: number[] = new Array(PART_COUNT * 7);
      const ok = this.applyInterpolated(g.buffer, arr, false);
      g.view.root.visible = ok;
      if (ok) {
        g.view.setTransforms(arr);
        const last = g.buffer[g.buffer.length - 1].snap;
        g.view.setFace(dt, last.yaw, last.pitch, last.yaw, last.fallen === 1, false);
      }
    }
    this.updateCamera(dt);
    this.particles.update(dt);
    // deco animation
    const t = performance.now() / 1000;
    if (this.deliverPad) (this.deliverPad.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6 + Math.sin(t * 4) * 0.4;
    for (const f of this.checkpointMeshes) f.rotation.y = Math.sin(t * 3 + f.userData.idx) * 0.2;
    this.sun.position.copy(this.camFocus).add(new THREE.Vector3(18, 32, 14));
    this.sun.target.position.copy(this.camFocus);
    this.hudAcc += dt;
    if (this.hudAcc > 0.1) {
      this.hudAcc = 0;
      this.emitHud();
    }
    this.renderer.render(this.scene, this.camera);
  }

  private pelvisYawFromDisplay() {
    tmpQ.set(this.displayTransforms[3], this.displayTransforms[4], this.displayTransforms[5], this.displayTransforms[6]);
    tmpV.set(0, 0, -1).applyQuaternion(tmpQ);
    return Math.atan2(-tmpV.x, -tmpV.z);
  }

  private stepPhysics(dt: number) {
    const body = this.body!;
    // kinematic movers (ferries / timing gates) — ponytail: velocity-based so riders get carried
    if (this.movers.length > 0 && !this.frozen) {
      this.moverT += dt;
      for (const m of this.movers) {
        const off = Math.sin(this.moverT * m.speed + m.phase) * m.dist;
        const nx = m.base.x + (m.axis === "x" ? off : 0);
        const nz = m.base.z + (m.axis === "z" ? off : 0);
        const cur = m.rb.translation();
        m.rb.setLinvel({ x: (nx - cur.x) / dt, y: 0, z: (nz - cur.z) / dt }, true);
      }
    }
    body.update(dt);
    // props cooldown
    for (const p of this.props) p.cooldown = Math.max(0, p.cooldown - dt);
    this.denyCooldown = Math.max(0, this.denyCooldown - dt);
    this.world.step(this.eventQueue);
    if (this.running && !this.finished) this.timer += dt;
    const commentaryFrame = this.makeCommentaryFrame();
    if (commentaryFrame) this.emitCommentary(this.commentary.update(commentaryFrame));
    // body events
    for (const ev of body.events) this.handleBodyEvent(ev, true);
    // contact force events
    this.eventQueue.drainContactForceEvents((ev) => {
      const h1 = ev.collider1();
      const h2 = ev.collider2();
      const f = ev.totalForceMagnitude();
      const c1 = this.world.getCollider(h1);
      const c2 = this.world.getCollider(h2);
      if (!c1 || !c2) return;
      const bodyPart = body.colliderHandles.has(h1) || body.colliderHandles.has(h2);
      const prop = this.props.find((p) => p.colliderHandle === h1 || p.colliderHandle === h2);
      const other = body.colliderHandles.has(h1) ? c2 : c1;
      const t = other.translation();
      const pos: [number, number, number] = bodyPart ? (() => {
        const bc = body.colliderHandles.has(h1) ? c1 : c2;
        const bt = bc.translation();
        return [bt.x, bt.y, bt.z];
      })() : [t.x, t.y, t.z];
      if (prop?.def.fragile && f > (this.level.fragileForce ?? 900) && prop.cooldown <= 0) {
        const heldByUs = body.isHolding(prop.id) && bodyPart;
        if (!heldByUs) {
          this.breakProp(prop);
          return;
        }
      }
      if (bodyPart && f > 500) this.handleLevelEvent({ type: "thud", pos, force: Math.min(1, f / 1500) }, true);
      else if (prop && f > 250) this.handleLevelEvent({ type: "bounce", pos, force: Math.min(1, f / 1200) }, true);
    });
    this.eventQueue.drainCollisionEvents(() => {});
    // objectives
    this.checkObjectives();
  }

  private breakProp(p: Prop) {
    const t = p.body!.translation();
    this.handleLevelEvent({ type: "crack", pos: [t.x, t.y, t.z] }, true);
    if (this.body) for (const h of [...this.body.holds]) if (h.id === p.id) this.body.releaseAll(true);
    this.resetProp(p);
    this.commentOnObjective({ type: "crack", subject: "egg" });
  }

  private checkObjectives() {
    const body = this.body!;
    const L = this.level;
    const pp = body.pelvisPos(tmpV);
    // kill plane
    if (pp.y < L.killY) {
      const cp = L.checkpoints[this.checkpointIdx];
      const spawn = cp?.spawn ? new THREE.Vector3(...cp.spawn) : new THREE.Vector3(...L.spawn);
      this.handleLevelEvent({ type: "splash", pos: [pp.x, -3, pp.z] }, true);
      body.teleport(spawn, L.spawnYaw);
      this.commentOnObjective({ type: "splash", subject: "player" });
    }
    for (const p of this.props) {
      if (!p.body) continue;
      const t = p.body.translation();
      if (t.y < L.killY) {
        this.handleLevelEvent({ type: "splash", pos: [t.x, -3, t.z] }, true);
        if (body.isHolding(p.id)) body.releaseAll(true);
        this.resetProp(p);
        if (p.def.deliverable) {
          const subject = L.id === "egg-express" ? "egg" : L.id === "summit-sync" ? "core" : "cargo";
          this.commentOnObjective({ type: "splash", subject });
        }
      }
    }
    if (!this.running || this.finished) return;
    // checkpoints
    L.checkpoints.forEach((cp, i) => {
      if (i > this.checkpointIdx && inZone(pp, cp)) {
        this.checkpointIdx = i;
        (this.checkpointMeshes[i].material as THREE.MeshStandardMaterial).color.set("#6ef29a");
        this.handleLevelEvent({ type: "checkpoint", pos: [pp.x, pp.y, pp.z] }, true);
        this.commentOnObjective({ type: "checkpoint", value: i });
      }
    });
    if (L.deliver) {
      for (const p of this.props) {
        if (!p.def.deliverable || !p.body) continue;
        const t = p.body.translation();
        const v = p.body.linvel();
        if (inZone(tmpV2.set(t.x, t.y, t.z), L.deliver) && !body.isHolding(p.id) && Math.hypot(v.x, v.y, v.z) < 0.8) {
          if (L.requireDeliverThenFinish && L.finish) {
            if (!this.delivered) {
              this.delivered = true;
              this.handleLevelEvent({ type: "score", pos: [t.x, t.y, t.z] }, true);
              this.commentOnObjective({ type: "delivery", subject: "core" });
            }
          } else this.finish();
        }
      }
    }
    if (L.finish && inZone(pp, L.finish) && !body.fallen) {
      if (!L.requireDeliverThenFinish) this.finish();
      else {
        // the core must STILL be on the pad when you cross — knocked off = go back
        let placed = false;
        for (const p of this.props) {
          if (!p.def.deliverable || !p.body) continue;
          const t = p.body.translation();
          const v = p.body.linvel();
          if (inZone(tmpV2.set(t.x, t.y, t.z), L.deliver!) && !body.isHolding(p.id) && Math.hypot(v.x, v.y, v.z) < 0.8) { placed = true; break; }
        }
        if (placed) this.finish();
        else if (this.denyCooldown <= 0) {
          this.denyCooldown = 2.5;
          this.message(this.delivered ? "The core fell off! Put it back!" : "Place the core first!", "bad");
        }
      }
    }
    if (L.hoop) {
      for (const p of this.props) {
        if (!p.def.scoring || !p.body || p.cooldown > 0) continue;
        const t = p.body.translation();
        const v = p.body.linvel();
        if (v.y < -0.5 && inZone(tmpV2.set(t.x, t.y, t.z), L.hoop.zone)) {
          this.score++;
          this.handleLevelEvent({ type: "score", pos: [t.x, t.y, t.z] }, true);
          this.commentOnObjective({ type: "score", value: this.score, target: L.targetScore });
          p.cooldown = 1.5;
          this.scheduleEffect(() => this.resetProp(p), 900);
          if (this.score >= (L.targetScore ?? 3)) this.finish();
        }
      }
    }
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    this.running = false;
    // Capture the exact completion pose before the finish reducer is sent. The
    // server uses the resulting host snapshot as a lightweight objective proof.
    this.body?.writeTransforms(this.displayTransforms);
    this.displayFallen = this.body?.fallen ?? this.displayFallen;
    const pp = this.body!.pelvisPos(new THREE.Vector3());
    this.handleLevelEvent({ type: "finish", pos: [pp.x, pp.y + 1, pp.z] }, true);
    this.commentOnObjective({ type: "finish" });
    this.onEvent({ type: "finish", timeMs: Math.round(this.timer * 1000) });
    this.emitHud();
  }

  private message(text: string, tone: "good" | "bad" | "info" = "info") {
    this.onEvent({ type: "message", text, tone });
    this.pendingMsg = `${tone}|${text}`;
  }

  private makeCommentaryFrame(): CommentaryFrame | null {
    const body = this.body;
    if (!body) return null;
    const rotation = body.quat(PELVIS, tmpQ);
    const localUp = tmpV2.set(0, 1, 0).applyQuaternion(rotation);
    const velocity = body.parts[PELVIS].linvel();
    return {
      timeMs: Math.round(this.timer * 1000),
      challengeId: this.level.id as CommentaryChallengeId,
      running: this.running,
      finished: this.finished,
      squadSize: this.squadSize,
      inputs: this.commentaryInputs,
      pelvisTilt: Math.acos(THREE.MathUtils.clamp(localUp.y, -1, 1)),
      grounded: body.grounded,
      fallen: body.fallen,
      hanging: body.holds.some((hold) => hold.isStatic),
      holding: body.holds.length,
      verticalSpeed: velocity.y,
      horizontalSpeed: body.speed,
      brace: body.brace,
      crouch: body.crouch > 0.5,
      checkpoint: this.checkpointIdx,
      score: this.score,
      delivery: this.delivered,
    };
  }

  private emitCommentary(line: CommentaryLine | null) {
    if (line) this.message(line.text, line.tone);
  }

  private commentOnObjective(event: CommentaryObjectiveEvent) {
    const frame = this.makeCommentaryFrame();
    if (frame) this.emitCommentary(this.commentary.onObjectiveEvent(event, frame));
  }

  /* ------------------------------- Events / FX ------------------------------- */
  handleBodyEvent(ev: BodyEvent, local: boolean) {
    const a = this.audio;
    const p = ev.pos;
    switch (ev.type) {
      case "step":
        a.step();
        this.particles.emit(p, 3, { color: ["#e8dcc5", "#cfc3a8"], speed: 0.8, up: 0.8, size: 0.06, life: 0.4 });
        break;
      case "land":
        a.thud(0.8);
        this.particles.emit([p[0], p[1] - 0.9, p[2]], 12, { color: ["#e8dcc5", "#cfc3a8"], speed: 2, up: 1.5, size: 0.08, life: 0.5, spread: 0.4 });
        this.shake = Math.max(this.shake, 0.25);
        break;
      case "grab":
        a.grab();
        this.particles.emit(p, 5, { color: "#ffffff", speed: 0.6, up: 0.6, size: 0.04, life: 0.3 });
        break;
      case "release":
        a.release();
        break;
      case "throw":
        a.whoosh();
        this.particles.emit(p, 10, { color: ["#ffffff", "#ffe08a"], speed: 2.5, up: 1, size: 0.06, life: 0.4 });
        break;
      case "fall":
        a.fall();
        this.particles.emit(p, 16, { color: ["#e8dcc5", "#cfc3a8"], speed: 2.5, up: 1.6, size: 0.08, life: 0.6, spread: 0.6 });
        this.shake = Math.max(this.shake, 0.5);
        break;
      case "getup":
        a.getup();
        this.particles.emit(p, 8, { color: ["#ffe08a", "#ffffff"], speed: 1.5, up: 2.5, size: 0.06, life: 0.5 });
        break;
      case "jump":
        a.jump();
        this.particles.emit([p[0], p[1] - 0.9, p[2]], 14, { color: ["#e8dcc5", "#ffffff"], speed: 2.5, up: 0.8, size: 0.07, life: 0.5, spread: 0.5 });
        break;
      case "kick":
        a.kick();
        break;
      case "climb":
        a.climb();
        break;
      case "shout": {
        a.shout();
        const words = ["LEFT!", "RIGHT!", "NO NO NO", "LEG!!", "GRAB IT!", "WAIT!", "GO GO GO", "LEAN!", "OTHER LEFT!", "AAAH", "CROUCH!", "JUMP!!", "why", "STOP!", "TOGETHER!"];
        this.view.shout(words[Math.floor(Math.random() * words.length)]);
        break;
      }
    }
    if (local) {
      const frame = this.makeCommentaryFrame();
      if (frame) {
        this.emitCommentary(this.commentary.onBodyEvent({
          type: ev.type,
          hand: ev.hand === 0 || ev.hand === 1 ? ev.hand : undefined,
          propId: ev.propId,
        }, frame));
      }
      this.pendingEvents.push(ev);
    }
  }

  handleLevelEvent(ev: { type: string; pos: [number, number, number]; force?: number }, local: boolean) {
    const a = this.audio;
    switch (ev.type) {
      case "thud":
        a.thud(ev.force ?? 0.5);
        this.particles.emit(ev.pos, 6, { color: ["#e8dcc5", "#ffffff"], speed: 1.5, up: 1, size: 0.06, life: 0.4 });
        this.shake = Math.max(this.shake, 0.15 * (ev.force ?? 0.5));
        break;
      case "bounce":
        a.thud((ev.force ?? 0.5) * 0.5);
        this.particles.emit(ev.pos, 4, { color: "#ffffff", speed: 1.2, up: 1, size: 0.05, life: 0.3 });
        break;
      case "splash":
        a.splash();
        this.particles.emit(ev.pos, 40, { color: ["#8fd0ff", "#ffffff", "#3aa0e8"], speed: 3, up: 4, size: 0.12, life: 0.9, spread: 0.8 });
        break;
      case "crack":
        a.crack();
        this.particles.emit(ev.pos, 40, { color: ["#fff4d6", "#ffd23f", "#ffffff"], speed: 3, up: 3, size: 0.1, life: 0.9, spread: 0.3 });
        this.shake = Math.max(this.shake, 0.4);
        break;
      case "checkpoint":
        a.checkpoint();
        this.particles.emit([ev.pos[0], ev.pos[1] + 1, ev.pos[2]], 30, { color: ["#6ef29a", "#ffffff", "#ffd23f"], speed: 2.5, up: 3, size: 0.08, life: 1, spread: 0.5 });
        break;
      case "score":
        a.score();
        this.particles.emit(ev.pos, 40, { color: ["#ff8a3d", "#ffd23f", "#ffffff"], speed: 3, up: 2.5, size: 0.08, life: 1, spread: 0.5 });
        break;
      case "finish":
        a.fanfare();
        for (let i = 0; i < 6; i++)
          this.scheduleEffect(() => this.particles.emit([ev.pos[0] + (Math.random() - 0.5) * 3, ev.pos[1] + 1.5, ev.pos[2] + (Math.random() - 0.5) * 3], 50, { color: ["#ff5d5d", "#4fa8ff", "#ffd23f", "#6ef29a", "#c58bff", "#ffffff"], speed: 3.5, up: 5, size: 0.1, life: 2.2, spread: 0.5 }), i * 180);
        break;
    }
    if (local) {
      if (ev.type === "thud" || ev.type === "bounce") {
        this.commentOnObjective({ type: ev.type, force: ev.force });
      }
      this.pendingEvents.push(ev);
    }
  }

  /* ------------------------------- Networking ------------------------------- */
  buildSnapshot(): Snap {
    const props: number[] = [];
    const propVelocities: number[] = [];
    for (const p of this.props) {
      if (!p.body) continue;
      const t = p.body.translation();
      const r = p.body.rotation();
      const linear = p.body.linvel();
      const angular = p.body.angvel();
      props.push(p.id, r3(t.x), r3(t.y), r3(t.z), r3(r.x), r3(r.y), r3(r.z), r3(r.w));
      propVelocities.push(p.id, rv(linear.x), rv(linear.y), rv(linear.z), rv(angular.x), rv(angular.y), rv(angular.z));
    }
    const bodyVelocities: number[] = [];
    for (const part of this.body?.parts ?? []) {
      const linear = part.linvel();
      const angular = part.angvel();
      bodyVelocities.push(rv(linear.x), rv(linear.y), rv(linear.z), rv(angular.x), rv(angular.y), rv(angular.z));
    }
    return {
      t: performance.now(),
      p: this.displayTransforms.map(r3),
      props,
      yaw: this.displayYaw,
      pitch: this.displayPitch,
      timer: this.timer,
      fallen: this.displayFallen ? 1 : 0,
      score: this.score,
      ev: this.pendingEvents,
      msg: this.pendingMsg,
      state: {
        checkpoint: this.checkpointIdx,
        delivered: this.delivered,
        moverTime: this.moverT,
        running: this.running,
        finished: this.finished,
        frozen: this.frozen,
        holds: this.body?.holds.map((hold) => ({ hand: hold.hand, propId: hold.id })) ?? [],
        ...(bodyVelocities.length === PART_COUNT * 6 ? { bodyVelocities } : {}),
        ...(propVelocities.length > 0 ? { propVelocities } : {}),
      },
    };
  }

  /** Build a network snapshot and consume its one-shot effects/message. */
  takeSnapshot(): Snap {
    const snapshot = this.buildSnapshot();
    this.pendingEvents = [];
    this.pendingMsg = undefined;
    return snapshot;
  }

  /** Snapshot from own team's host (when this client is not the host). */
  applyOwnSnapshot(s: Snap) {
    const now = performance.now();
    this.ownBuffer.push({ recv: now, snap: s });
    while (this.ownBuffer.length > 12) this.ownBuffer.shift();
    this.timer = s.timer;
    this.score = s.score;
    this.displayYaw = s.yaw;
    this.displayPitch = s.pitch;
    this.displayFallen = s.fallen === 1;
    if (s.state) this.restoreObjectiveState(s.state);
    for (const ev of s.ev) {
      if (isBodyEvent(ev)) this.handleBodyEvent(ev, false);
      else this.handleLevelEvent(ev, false);
    }
    if (s.msg) {
      const [tone, ...rest] = s.msg.split("|");
      this.onEvent({ type: "message", text: rest.join("|"), tone: tone as "good" | "bad" | "info" });
    }
  }

  applyGhostSnapshot(teamId: number, color: string, name: string, s: Snap) {
    let g = this.ghosts.get(teamId);
    if (!g) {
      const view = new BodyView(color, true, name);
      this.scene.add(view.root);
      g = { view, buffer: [], lastEvT: 0 };
      this.ghosts.set(teamId, g);
    }
    g.view.setTeamName(name, color);
    g.buffer.push({ recv: performance.now(), snap: s });
    while (g.buffer.length > 12) g.buffer.shift();
    for (const ev of s.ev) if (ev.type === "shout") g.view.shout(["HEY!", "MOVE!", "LOL", "NOOO", "FASTER!"][Math.floor(Math.random() * 5)]);
  }

  removeGhost(teamId: number) {
    const g = this.ghosts.get(teamId);
    if (!g) return;
    this.scene.remove(g.view.root);
    g.view.dispose();
    this.ghosts.delete(teamId);
  }

  private applyInterpolated(buffer: { recv: number; snap: Snap }[], out: number[], withProps: boolean): boolean {
    if (buffer.length === 0) return false;
    const rt = performance.now() - SNAPSHOT_INTERPOLATION_DELAY_MS;
    let a = buffer[0];
    let b = buffer[buffer.length - 1];
    for (let i = 0; i < buffer.length - 1; i++) {
      if (buffer[i].recv <= rt && buffer[i + 1].recv >= rt) {
        a = buffer[i];
        b = buffer[i + 1];
        break;
      }
    }
    if (rt > b.recv) a = b;
    const span = b.recv - a.recv;
    const k = span > 0 ? THREE.MathUtils.clamp((rt - a.recv) / span, 0, 1) : 1;
    const predictionSeconds = snapshotExtrapolationSeconds(rt, b.recv);
    const bodyVelocities = predictionSeconds > 0 ? b.snap.state?.bodyVelocities : undefined;
    for (let i = 0; i < PART_COUNT; i++) {
      const o = i * 7;
      out[o] = THREE.MathUtils.lerp(a.snap.p[o], b.snap.p[o], k);
      out[o + 1] = THREE.MathUtils.lerp(a.snap.p[o + 1], b.snap.p[o + 1], k);
      out[o + 2] = THREE.MathUtils.lerp(a.snap.p[o + 2], b.snap.p[o + 2], k);
      tmpQ.set(a.snap.p[o + 3], a.snap.p[o + 4], a.snap.p[o + 5], a.snap.p[o + 6]);
      tmpQ2.set(b.snap.p[o + 3], b.snap.p[o + 4], b.snap.p[o + 5], b.snap.p[o + 6]);
      tmpQ.slerp(tmpQ2, k);
      out[o + 3] = tmpQ.x;
      out[o + 4] = tmpQ.y;
      out[o + 5] = tmpQ.z;
      out[o + 6] = tmpQ.w;
      if (bodyVelocities?.length === PART_COUNT * 6) {
        const velocityOffset = i * 6;
        out[o] += bodyVelocities[velocityOffset] * predictionSeconds;
        out[o + 1] += bodyVelocities[velocityOffset + 1] * predictionSeconds;
        out[o + 2] += bodyVelocities[velocityOffset + 2] * predictionSeconds;
        tmpV.set(
          bodyVelocities[velocityOffset + 3],
          bodyVelocities[velocityOffset + 4],
          bodyVelocities[velocityOffset + 5],
        );
        const angularSpeed = tmpV.length();
        if (angularSpeed > 1e-6) {
          tmpQ.set(out[o + 3], out[o + 4], out[o + 5], out[o + 6]);
          tmpQ2.setFromAxisAngle(tmpV.multiplyScalar(1 / angularSpeed), angularSpeed * predictionSeconds);
          tmpQ.premultiply(tmpQ2).normalize();
          out[o + 3] = tmpQ.x;
          out[o + 4] = tmpQ.y;
          out[o + 5] = tmpQ.z;
          out[o + 6] = tmpQ.w;
        }
      }
    }
    if (withProps) {
      const pa = a.snap.props;
      const pb = b.snap.props;
      for (let i = 0; i + 7 < pb.length; i += 8) {
        const id = pb[i];
        const prop = this.props.find((p) => p.id === id);
        if (!prop) continue;
        const j = pa.length === pb.length ? i : -1;
        if (j >= 0) {
          prop.mesh.position.set(THREE.MathUtils.lerp(pa[j + 1], pb[i + 1], k), THREE.MathUtils.lerp(pa[j + 2], pb[i + 2], k), THREE.MathUtils.lerp(pa[j + 3], pb[i + 3], k));
          tmpQ.set(pa[j + 4], pa[j + 5], pa[j + 6], pa[j + 7]);
          tmpQ2.set(pb[i + 4], pb[i + 5], pb[i + 6], pb[i + 7]);
          prop.mesh.quaternion.copy(tmpQ.slerp(tmpQ2, k));
        } else {
          prop.mesh.position.set(pb[i + 1], pb[i + 2], pb[i + 3]);
          prop.mesh.quaternion.set(pb[i + 4], pb[i + 5], pb[i + 6], pb[i + 7]);
        }
        if (predictionSeconds > 0) {
          const velocities = b.snap.state?.propVelocities;
          const velocityOffset = velocities?.findIndex((value, index) => index % 7 === 0 && value === id) ?? -1;
          if (velocities && velocityOffset >= 0) {
            prop.mesh.position.x += velocities[velocityOffset + 1] * predictionSeconds;
            prop.mesh.position.y += velocities[velocityOffset + 2] * predictionSeconds;
            prop.mesh.position.z += velocities[velocityOffset + 3] * predictionSeconds;
            tmpV.set(velocities[velocityOffset + 4], velocities[velocityOffset + 5], velocities[velocityOffset + 6]);
            const angularSpeed = tmpV.length();
            if (angularSpeed > 1e-6) {
              tmpQ.setFromAxisAngle(tmpV.multiplyScalar(1 / angularSpeed), angularSpeed * predictionSeconds);
              prop.mesh.quaternion.premultiply(tmpQ).normalize();
            }
          }
        }
      }
    }
    return true;
  }

  /* ------------------------------- Camera ------------------------------- */
  private updateCamera(dt: number) {
    const px = this.displayTransforms[0];
    const py = this.displayTransforms[1];
    const pz = this.displayTransforms[2];
    const k1 = 1 - Math.exp(-dt * 7);
    this.camFocus.lerp(tmpV.set(px, py + 0.75, pz), k1);
    this.camYaw = lerpAngle(this.camYaw, this.displayYaw, 1 - Math.exp(-dt * 5.5));
    this.camPitch = THREE.MathUtils.lerp(this.camPitch, 0.36 - this.displayPitch * 0.6, 1 - Math.exp(-dt * 5));
    const dist = 5.6;
    const cp = Math.cos(this.camPitch);
    tmpV2.set(Math.sin(this.camYaw) * cp, Math.sin(this.camPitch) + 0.15, Math.cos(this.camYaw) * cp).multiplyScalar(dist);
    const desired = tmpV.copy(this.camFocus).add(tmpV2);
    if (desired.y < -2.2) desired.y = -2.2;
    this.camera.position.lerp(desired, 1 - Math.exp(-dt * 9));
    this.shake = Math.max(0, this.shake - dt * 1.8);
    if (this.shake > 0) {
      const s = this.shake * 0.08;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
    const look = tmpV2.copy(this.camFocus).add(tmpV.set(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw)).multiplyScalar(1.2));
    look.y += 0.2 - this.displayPitch * 0.8;
    this.camera.lookAt(look);
  }

  /* ------------------------------- HUD ------------------------------- */
  private emitHud() {
    this.onEvent({
      type: "hud",
      hud: {
        timer: this.timer,
        fallen: this.displayFallen,
        holding: this.displayHolding,
        score: this.score,
        scoreTarget: this.level.targetScore ?? 0,
        crouch: this.body ? this.body.crouch > 0.5 : false,
        brace: this.body ? this.body.braceStamina : 1,
        hanging: this.body ? this.body.holds.some((h) => h.isStatic) : false,
        objective: this.level.objective,
        running: this.running,
        finished: this.finished,
      },
    });
  }

  dispose() {
    this.disposed = true;
    this.clearDelayedEffects();
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("blur", this.releaseLocalControls);
    document.removeEventListener("visibilitychange", this.releaseLocalControls);
    this.audio.dispose();
    for (const id of [...this.ghosts.keys()]) this.removeGhost(id);
    this.view.dispose();
    if (this.body) this.body.dispose();
    this.disposeLevelAssets();
    this.particles.dispose();
    if (this.sky) {
      this.sky.removeFromParent();
      this.sky.geometry.dispose();
      const materials = Array.isArray(this.sky.material) ? this.sky.material : [this.sky.material];
      for (const material of materials) material.dispose();
      this.sky = null;
      this.skyMat = null;
    }
    if (this.water) {
      this.water.removeFromParent();
      this.water.geometry.dispose();
      const materials = Array.isArray(this.water.material) ? this.water.material : [this.water.material];
      for (const material of materials) material.dispose();
      this.water = null;
    }
    this.eventQueue?.free();
    this.world?.free();
    this.renderer.dispose();
  }
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const rv = (x: number) => r3(Math.max(-100, Math.min(100, x)));

function inZone(p: THREE.Vector3, z: ZoneDef) {
  return Math.abs(p.x - z.pos[0]) <= z.size[0] / 2 && Math.abs(p.y - z.pos[1]) <= z.size[1] / 2 && Math.abs(p.z - z.pos[2]) <= z.size[2] / 2;
}

function isBodyEvent(ev: { type: string }): ev is BodyEvent {
  return ["step", "land", "grab", "release", "throw", "fall", "getup", "jump", "kick", "shout", "climb"].includes(ev.type);
}
