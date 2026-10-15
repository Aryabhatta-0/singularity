import * as THREE from "three";
import type RAPIER_T from "@dimforge/rapier3d-compat";
import { RagdollBody, PARTS, PART_COUNT, PELVIS, HEAD, LFA, RFA, GROUP_ENV, GROUP_PROP, groups, findStaticGrab, HAND_LOCAL, type BodyEvent, type GrabTarget } from "./body";
import { getLevel, type LevelDef, type PropDef, type ZoneDef } from "./levels";
import { GameAudio } from "./audio";
import type { Role, RoleInput, SquadSize } from "./types";
import { createJointMixState, mergeTeamInputs, resolveTeamBodyInputs, type JointMixState } from "./joint-input";
import {
  createCommentarySystem,
  type CommentaryChallengeId,
  type CommentaryFrame,
  type CommentaryLine,
  type CommentaryObjectiveEvent,
} from "./commentary";
import {
  bracketSnapshots,
  snapshotExtrapolationSeconds,
} from "./ghost-snapshot";
import {
  FixedStepClock,
  SNAPSHOT_MAX_EXTRAPOLATION_MS,
  SNAPSHOT_SEND_INTERVAL_SECONDS,
  SnapshotTimeline,
} from "./timing";
import { RenderQuality } from "./render-quality";
import { CharacterView, type ReactionKind } from "./character-view";
import { Effects } from "./effects";
import { AmbientParticles, Sky, Water, buildClouds, disposeFoamMaterial } from "./atmosphere";
import { CourseView } from "./course-decor";
import { PropView } from "./prop-view";
import { SHARED_UNIFORMS, disposeSharedMaterials, isSharedResource } from "./materials";
import { courseTheme, PALETTE, type CourseTheme } from "./visual-theme";
import { GameCamera } from "./camera-rig";

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

/** Highest pixel ratio worth rendering at on this screen, before adaptive quality scales it down. */
function pixelRatioCap() {
  return Math.min(window.devicePixelRatio, usesCompactRenderProfile() ? 1.35 : 1.75);
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
  checkpoint: number;
  checkpointTotal: number;
  carrying: boolean;
  delivered: boolean;
}

export type GameEvent =
  | { type: "finish"; timeMs: number }
  | { type: "message"; text: string; tone?: "good" | "bad" | "info" }
  | { type: "hud"; hud: HudState }
  /** Presentation beat for the HUD (checkpoint pop, swish, splash wipe...). */
  | { type: "moment"; kind: MomentKind; value?: number; total?: number };

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
  mesh: THREE.Object3D;
  base: THREE.Vector3;
  axis: "x" | "z";
  dist: number;
  speed: number;
  phase: number;
}

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();

/** Everything the results screen can say about a run, counted from events. */
export interface RunStats {
  falls: number;
  splashes: number;
  grabs: number;
  throws: number;
  jumps: number;
  cracks: number;
  checkpoints: number;
  baskets: number;
}

export const emptyRunStats = (): RunStats => ({ falls: 0, splashes: 0, grabs: 0, throws: 0, jumps: 0, cracks: 0, checkpoints: 0, baskets: 0 });

export type MomentKind = "checkpoint" | "score" | "delivered" | "splash" | "crack" | "finish" | "fall" | "getup";

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/* ---------------------------------- Props ---------------------------------- */
interface Prop {
  id: number;
  def: PropDef;
  body: RigidBodyT | null;
  colliderHandle: number;
  mesh: THREE.Object3D;
  view: PropView;
  radius: number;
  start: THREE.Vector3;
  cooldown: number;
  /** Last rendered position, for speed-based moods and water crossings. */
  lastPos: THREE.Vector3;
}
type RigidBodyT = RAPIER_T.RigidBody;

interface TeamGhost {
  view: CharacterView;
  buffer: { recv: number; snap: Snap }[];
  timeline: SnapshotTimeline;
  /** Reused every frame for the interpolated pose. */
  pose: number[];
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
  effects: Effects;
  audio = new GameAudio();
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  theme: CourseTheme = courseTheme("wobble-run");
  course: CourseView | null = null;
  ambient: AmbientParticles | null = null;
  clouds: THREE.InstancedMesh | null = null;
  compact: boolean;
  reducedMotion = prefersReducedMotion();
  /** Roles this client steers: their limbs glow on the dummy. */
  localRoles: Role[] = [];
  runStats: RunStats = emptyRunStats();
  level!: LevelDef;
  levelGroup = new THREE.Group();
  staticBodies: RigidBodyT[] = [];
  nonGrabHandles = new Set<number>();
  props: Prop[] = [];
  body: RagdollBody | null = null;
  view: CharacterView;
  ghosts = new Map<number, TeamGhost>();
  ownBuffer: { recv: number; snap: Snap }[] = [];
  ownTimeline = new SnapshotTimeline();
  /** Replica frames drawn, and how many outran the jitter buffer (pose held past the prediction cap). */
  replicaFrames = 0;
  replicaStarvedFrames = 0;
  /** Steps resolution (then shadows) down when frames run slow, back up when they don't. */
  renderQuality = new RenderQuality();
  isHost: boolean;
  teamId: number;
  teamColor: string;
  teamName = "Team";
  remoteInputs: Partial<Record<Role, RoleInput>> = {};
  localInputs: Partial<Record<Role, RoleInput>> = {};
  squadSize: SquadSize = 5;
  squadMix: JointMixState = createJointMixState();
  commentary = createCommentarySystem();
  commentaryInputs: Partial<Record<Role, RoleInput>> = {};
  commentaryRun = 0;
  movers: Mover[] = [];
  moverT = 0;
  delivered = false;
  denyCooldown = 0;
  sky: Sky | null = null;
  onEvent: GameOptions["onEvent"];
  // camera
  rig: GameCamera;
  get camFocus() {
    return this.rig.focus;
  }
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
  displayHanging = false;
  displayTransforms: number[] = new Array(PART_COUNT * 7).fill(0);
  water: Water | null = null;
  onSnapshot: ((s: Snap) => void) | null = null;
  // presentation-only bookkeeping
  private visualTime = 0;
  private lastPelvisY = 0;
  private recentSplashes: { x: number; z: number; t: number }[] = [];
  private airborneMinVy = 0;
  private grabTimes: number[] = [-9, -9];
  private pendingMiss: { hand: 0 | 1; t: number }[] = [];
  private prevLocalPress = new Map<string, boolean>();
  private trails = new Map<number, number>();
  private finishedAt = -1;

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
    this.compact = compactRenderProfile;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(pixelRatioCap());
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Neutral tone mapping keeps toy colours saturated (ACES greys them out).
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 320);
    this.scene.fog = new THREE.Fog(new THREE.Color("#cfe3ff"), 45, 160);

    this.sky = new Sky();
    this.scene.add(this.sky.mesh);

    this.hemi = new THREE.HemisphereLight("#cfe4ff", "#5f8a4a", 0.9);
    this.scene.add(this.hemi);
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

    this.water = new Water(compactRenderProfile);
    this.scene.add(this.water.mesh);

    this.scene.add(this.levelGroup);
    this.effects = new Effects(this.scene, compactRenderProfile);
    this.view = new CharacterView(this.teamColor, false, "", this.teamId);
    this.view.root.userData.tag = "character";
    this.scene.add(this.view.root);
    this.rig = new GameCamera(this.camera, (from, to) => this.probeCamera(from, to));
    this.rig.reducedMotion = this.reducedMotion;

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
    const pixelRatio = pixelRatioCap() * this.renderQuality.scale;
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

  /** The limbs this client steers; they get a pulsing team-colour outline. */
  setLocalRoles(roles: readonly Role[]) {
    this.localRoles = [...roles];
    this.view.setHighlight(roles);
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
    this.clearOwnSnapshots();
    this.remoteInputs = {};
    this.localInputs = {};
    this.commentaryInputs = {};

    const previous = this.view;
    const replacement = new CharacterView(color, false, name, teamId);
    replacement.setTransforms(this.displayTransforms);
    replacement.setHighlight(this.localRoles);
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
    for (const p of this.props) p.view.dispose();
    this.course?.dispose();
    this.course = null;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.levelGroup.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (!isSharedResource(object.geometry)) geometries.add(object.geometry);
      const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of meshMaterials) {
        if (isSharedResource(material)) continue;
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture && !isSharedResource(value)) textures.add(value);
        }
      }
    });
    for (const texture of textures) texture.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.levelGroup.clear();
    this.ambient?.dispose();
    this.ambient = null;
    if (this.clouds) {
      this.clouds.removeFromParent();
      this.clouds.geometry.dispose();
      (this.clouds.material as THREE.Material).dispose();
      this.clouds = null;
    }
  }

  /** Decorative distance dressing follows adaptive quality (gameplay geometry never does). */
  private applyQualityTier() {
    const on = this.renderQuality.scenery;
    if (this.ambient) this.ambient.points.visible = on;
    if (this.clouds) this.clouds.visible = on;
    this.course?.group.traverse((o) => {
      if (o.name.startsWith("batch:scenery:")) o.visible = on;
    });
  }

  /** Course look: sky, fog, lights, water, rim sheen, weather. Presentation only. */
  private applyTheme(theme: CourseTheme) {
    this.theme = theme;
    this.sky?.apply(theme);
    this.scene.fog = new THREE.Fog(new THREE.Color(theme.fog.color), theme.fog.near, theme.fog.far);
    this.hemi.color.set(theme.hemi.sky);
    this.hemi.groundColor.set(theme.hemi.ground);
    this.hemi.intensity = theme.hemi.intensity;
    this.sun.color.set(theme.sun.color);
    this.sun.intensity = theme.sun.intensity;
    this.renderer.toneMappingExposure = theme.exposure;
    SHARED_UNIFORMS.uRimColor.value.set(theme.rim.color);
    SHARED_UNIFORMS.uRimStrength.value = theme.rim.strength;
    this.water?.apply(theme);
    this.effects.setTheme(theme);
    this.rig.waterLevel = theme.water.level;
    this.audio.setSurface(theme.surface === "snow" ? "snow" : theme.surface === "court" ? "wood" : "soft");
    this.audio.setAmbience(theme.surface === "snow" ? "wind" : theme.surface === "sand" ? "harbor" : theme.surface === "court" ? "arena" : "breeze");
    if (theme.ambient !== "none") {
      this.ambient = new AmbientParticles(theme.ambient, this.compact);
      this.scene.add(this.ambient.points);
    }
    const L = this.level;
    const mid = new THREE.Vector3(L.spawn[0], 0, (L.spawn[2] + (L.finish?.pos[2] ?? L.deliver?.pos[2] ?? L.hoop?.pos[2] ?? -30)) / 2);
    this.clouds = buildClouds(theme, mid);
    if (this.clouds) this.scene.add(this.clouds);
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
    this.movers = [];
    this.moverT = 0;
    this.delivered = false;
    this.squadMix = createJointMixState();
    this.score = 0;
    this.checkpointIdx = -1;
    this.timer = 0;
    this.running = false;
    this.finished = false;

    const L = this.level;
    this.runStats = emptyRunStats();
    this.finishedAt = -1;
    this.applyTheme(courseTheme(L.id));
    // Collision stays the plain boxes from levels.ts; CourseView dresses them.
    this.course = new CourseView(L, this.compact).build();
    this.levelGroup.add(this.course.group);
    this.applyQualityTier();
    for (const child of this.course.group.children) if (!child.name.startsWith("batch:") && !child.userData.tag) child.userData.tag = `course:${child.type}`;
    L.statics.forEach((s, staticIndex) => {
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
      if (isMover) {
        const visual = this.course!.movers.get(staticIndex) ?? new THREE.Group();
        visual.userData.tag = "mover";
        visual.position.set(initialX, s.pos[1], initialZ);
        this.movers.push({ rb, mesh: visual, base: new THREE.Vector3(s.pos[0], s.pos[1], s.pos[2]), axis: s.slide!.axis, dist: s.slide!.dist, speed: s.slide!.speed, phase: moverPhase });
      }
    });
    // props
    L.props.forEach((p, idx) => this.createProp(p, idx));
    if (L.hoop) {
      const h = L.hoop;
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
    this.rig.snapTo(new THREE.Vector3(L.spawn[0], L.spawn[1] + 1, L.spawn[2]), L.spawnYaw);
    this.lastPelvisY = L.spawn[1] + 1;
    if (this.isHost) this.spawnBody(new THREE.Vector3(...L.spawn), L.spawnYaw);
    this.clearOwnSnapshots();
    for (const g of this.ghosts.values()) {
      g.buffer = [];
      g.timeline.reset();
    }
    this.emitHud();
  }

  private createProp(p: PropDef, id: number) {
    const R = this.R;
    const pos = new THREE.Vector3(...p.pos);
    const view = new PropView(p, this.level.id);
    const mesh: THREE.Object3D = view.object;
    mesh.userData.tag = `prop:${view.style}`;
    const radius = p.kind === "ball" ? (p.radius ?? 0.3) : p.kind === "egg" ? (p.radius ?? 0.28) : Math.max(...(p.size ?? [0.6, 0.6, 0.6])) * 0.75;
    let body: RigidBodyT | null = null;
    let colliderHandle = -1;
    mesh.position.copy(pos);
    this.levelGroup.add(mesh);
    if (view.marker) this.levelGroup.add(view.marker);
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
    this.props.push({ id, def: p, body, colliderHandle, mesh, view, radius, start: pos.clone(), cooldown: 0, lastPos: pos.clone() });
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
    this.course?.setCheckpoint(state.checkpoint, true);
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

  /** Development-only QA helpers (the visual tour hops along each course). */
  debugTeleport(x: number, y: number, z: number) {
    if (!this.body) return;
    this.body.teleport(new THREE.Vector3(x, y, z), this.level.spawnYaw);
  }

  /** Dev-only: hide one presentation layer to measure what it costs. */
  debugToggle(layer: string) {
    const flip = (o: THREE.Object3D | null | undefined) => {
      if (o) o.visible = !o.visible;
    };
    if (layer === "water") flip(this.water?.mesh);
    if (layer === "sky") flip(this.sky?.mesh);
    if (layer === "ambient") flip(this.ambient?.points);
    if (layer === "clouds") flip(this.clouds);
    if (layer === "shadows") this.sun.castShadow = !this.sun.castShadow;
    if (layer === "shadowpass") this.renderer.shadowMap.autoUpdate = !this.renderer.shadowMap.autoUpdate;
    if (layer === "pixels") this.renderer.setPixelRatio(this.renderer.getPixelRatio() > 0.3 ? 0.25 : pixelRatioCap() * this.renderQuality.scale);
    if (layer === "character") flip(this.view.root);
    if (layer === "course") flip(this.levelGroup);
    if (layer === "movers") for (const m of this.movers) flip(m.mesh);
    if (layer.startsWith("name:")) this.levelGroup.traverse((o) => { if (o.name === layer.slice(5)) flip(o); });
    if (layer === "props") for (const p of this.props) flip(p.mesh);
    if (layer === "loose") {
      for (const o of this.course?.group.children ?? []) if (!o.name.startsWith("batch:") && !this.movers.some((m) => m.mesh === o)) flip(o);
    }
    if (layer === "scenery" || layer === "transparent" || layer === "batch") {
      this.levelGroup.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const m = o.material as THREE.Material;
        if (layer === "scenery" && o.name.startsWith("batch:scenery:")) o.visible = !o.visible;
        if (layer === "transparent" && m.transparent) o.visible = !o.visible;
        if (layer === "batch" && o.name.startsWith("batch:") && !o.name.startsWith("batch:scenery:")) o.visible = !o.visible;
      });
    }
  }

  debugBatchStats() {
    const out: Record<string, number> = {};
    this.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || !o.visible) return;
      const g = o.geometry;
      const tris = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o instanceof THREE.InstancedMesh ? o.count : 1);
      let key = o.name.startsWith("batch:") ? o.name : "";
      for (let a: THREE.Object3D | null = o; !key && a; a = a.parent) if (a.userData.tag) key = a.userData.tag as string;
      if (!key) key = o.parent === this.scene ? `root:${o.type}` : "other";
      out[key] = (out[key] ?? 0) + Math.round(tris);
    });
    return out;
  }

  debugFinish() {
    if (this.isHost && this.running && !this.finished) this.finish();
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
    this.ownTimeline.reset();
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
    this.squadMix = createJointMixState();
    this.commentaryRun += 1;
    this.commentary.reset(`${this.teamId}:${this.level.id}:${this.commentaryRun}`);
    this.course?.setCheckpoint(-1, true);
    this.course?.moment("reset");
    this.runStats = emptyRunStats();
    this.finishedAt = -1;
    this.trails.clear();
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
      if (this.renderQuality.sample(dt)) {
        this.sun.castShadow = this.renderQuality.shadows;
        this.applyQualityTier();
        this.resize();
      }
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private frame(dt: number) {
    if (this.isHost && this.body) {
      // merge squad inputs (3P/5P) into the 5 physics channels
      const merged: Partial<Record<Role, RoleInput>> = mergeTeamInputs(this.localInputs, this.remoteInputs);
      this.commentaryInputs = merged;
      const steps = this.simulationClock.advance(dt);
      for (let step = 0; step < steps; step++) {
        const phys = resolveTeamBodyInputs(merged, this.squadSize, this.fixedDt, this.squadMix);
        Object.assign(this.body.inputs, phys);
        this.stepPhysics(this.fixedDt);
      }
      this.body.writeTransforms(this.displayTransforms);
      this.displayYaw = this.body.heading;
      this.displayPitch = this.body.headPitch;
      this.displayFallen = this.body.fallen;
      this.displayHolding = this.body.holds.length;
      this.displayHanging = this.body.holds.some((h) => h.isStatic);
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
      this.applyInterpolated(this.ownBuffer, this.ownTimeline, this.displayTransforms, true);
      // guests mirror deterministic movers locally (host runs the physics)
      if (this.movers.length > 0 && !this.frozen) {
        this.moverT += dt;
        for (const m of this.movers) {
          const off = Math.sin(this.moverT * m.speed + m.phase) * m.dist;
          m.mesh.position.set(m.base.x + (m.axis === "x" ? off : 0), m.base.y, m.base.z + (m.axis === "z" ? off : 0));
        }
      }
    }
    this.renderFrame(dt);
  }

  /** Everything after simulation/replication: pure presentation. */
  private renderFrame(dt: number) {
    this.visualTime += dt;
    SHARED_UNIFORMS.uTime.value = this.visualTime;
    const probe = (x: number, y: number, z: number) => this.groundBelow(x, y, z);
    this.view.setTransforms(this.displayTransforms);
    this.view.update({ dt, lookYaw: this.displayYaw, lookPitch: this.displayPitch, fallen: this.displayFallen, holding: this.displayHolding, hanging: this.displayHanging }, probe);
    // ghosts
    for (const g of this.ghosts.values()) {
      const ok = this.applyInterpolated(g.buffer, g.timeline, g.pose, false);
      g.view.root.visible = ok;
      if (ok) {
        g.view.setTransforms(g.pose);
        const last = g.buffer[g.buffer.length - 1].snap;
        g.view.update({ dt, lookYaw: last.yaw, lookPitch: last.pitch, fallen: last.fallen === 1, holding: last.state?.holds?.length ?? 0, hanging: last.state?.holds?.some((h) => h.propId < 0) ?? false }, probe);
      }
    }
    const pelvis = tmpV.set(this.displayTransforms[0], this.displayTransforms[1], this.displayTransforms[2]);
    this.trackWaterCrossing(pelvis, dt);
    this.updateProps(dt);
    this.course?.update({
      time: this.visualTime,
      dt,
      player: pelvis,
      carrying: this.isCarryingObjective(),
      delivered: this.delivered,
      checkpoint: this.checkpointIdx,
      score: this.score,
      reducedMotion: this.reducedMotion,
    });
    this.updateCamera(dt);
    this.effects.update(dt);
    this.sky?.follow(this.camera);
    this.water?.follow(this.camera);
    this.ambient?.follow(this.camera);
    this.sun.position.copy(this.camFocus).add(tmpV2.set(...this.theme.sun.dir).normalize().multiplyScalar(40));
    this.sun.target.position.copy(this.camFocus);
    this.hudAcc += dt;
    if (this.hudAcc > 0.1) {
      this.hudAcc = 0;
      this.emitHud();
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Height of the course surface under a point (contact shadows). */
  private groundBelow(x: number, y: number, z: number): number | null {
    if (!this.world || !this.R) return null;
    const ray = new this.R.Ray({ x, y: y + 0.1, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, 6, true, undefined, groups(0xffff, GROUP_ENV));
    if (!hit) return null;
    return y + 0.1 - hit.timeOfImpact;
  }

  /** Distance from `from` toward `to` until course geometry blocks the view. */
  private probeCamera(from: THREE.Vector3, to: THREE.Vector3): number | null {
    if (!this.world || !this.R) return null;
    const dir = tmpV2.copy(to).sub(from);
    const len = dir.length();
    if (len < 1e-3) return null;
    dir.multiplyScalar(1 / len);
    const ray = new this.R.Ray({ x: from.x, y: from.y, z: from.z }, { x: dir.x, y: dir.y, z: dir.z });
    const hit = this.world.castRay(ray, len, true, undefined, groups(0xffff, GROUP_ENV), undefined, undefined, (c) => {
      // thin rails and props never block the view
      const parent = c.parent();
      return !parent || parent.isFixed();
    });
    return hit ? hit.timeOfImpact : null;
  }

  private isCarryingObjective() {
    if (this.body) return this.body.holds.some((h) => !h.isStatic && this.props.some((p) => p.id === h.id && p.def.deliverable));
    const holds = this.ownBuffer[this.ownBuffer.length - 1]?.snap.state?.holds ?? [];
    return holds.some((h) => this.props.some((p) => p.id === h.propId && p.def.deliverable));
  }

  /** Prop moods (egg nerves, grab-ability glow), throw trails, splashes. */
  private updateProps(dt: number) {
    const hands = [this.handWorld(0, new THREE.Vector3()), this.handWorld(1, new THREE.Vector3())];
    const held = new Set<number>();
    if (this.body) for (const h of this.body.holds) held.add(h.id);
    else for (const h of this.ownBuffer[this.ownBuffer.length - 1]?.snap.state?.holds ?? []) held.add(h.propId);
    for (const p of this.props) {
      const pos = p.mesh.position;
      const speed = dt > 0 ? pos.distanceTo(p.lastPos) / dt : 0;
      let near = 0;
      for (const hp of hands) {
        const d = hp.distanceTo(pos) - p.radius;
        near = Math.max(near, THREE.MathUtils.clamp(1 - (d - 0.05) / 0.55, 0, 1));
      }
      p.view.update({ dt, held: held.has(p.id), speed: speed < 40 ? speed : 0, near });
      const trailUntil = this.trails.get(p.id);
      if (trailUntil != null) {
        if (this.visualTime > trailUntil) this.trails.delete(p.id);
        else this.effects.trail(pos, p.def.scoring ? "#ff8a3d" : PALETTE.goldGlow);
      }
      const level = this.water?.level ?? -0.85;
      if (p.lastPos.y >= level && pos.y < level && speed < 40) this.surfaceSplash(pos.x, pos.z, false);
      p.lastPos.copy(pos);
    }
  }

  private handWorld(hand: 0 | 1, out: THREE.Vector3) {
    const o = (hand === 0 ? LFA : RFA) * 7;
    const t = this.displayTransforms;
    tmpQ2.set(t[o + 3], t[o + 4], t[o + 5], t[o + 6]);
    return out.copy(HAND_LOCAL).applyQuaternion(tmpQ2).add(tmpV2.set(t[o], t[o + 1], t[o + 2]));
  }

  /** The dummy hits the water surface: the big splash happens here, visually. */
  private trackWaterCrossing(pelvis: THREE.Vector3, dt: number) {
    const level = this.water?.level ?? -0.85;
    const vy = dt > 0 ? (pelvis.y - this.lastPelvisY) / dt : 0;
    if (Math.abs(pelvis.y - this.lastPelvisY) < 4) {
      if (this.lastPelvisY >= level + 0.2 && pelvis.y < level + 0.2) {
        this.surfaceSplash(pelvis.x, pelvis.z, true);
        this.view.react("splash");
      }
      // landing impact tracking for squash and dust size
      if (vy < this.airborneMinVy) this.airborneMinVy = vy;
    } else {
      // teleport (checkpoint respawn): cut the camera instead of swooping
      this.rig.snapTo(new THREE.Vector3(pelvis.x, pelvis.y + 0.75, pelvis.z), this.displayYaw);
    }
    this.lastPelvisY = pelvis.y;
    this.recentSplashes = this.recentSplashes.filter((r) => this.visualTime - r.t < 2.5);
  }

  private surfaceSplash(x: number, z: number, big: boolean) {
    const y = this.water?.level ?? -0.85;
    this.recentSplashes.push({ x, z, t: this.visualTime });
    this.effects.splash([x, y + 0.05, z], big);
    this.audio.splash(big ? 1 : 0.6);
    if (big) this.rig.addTrauma(0.35);
  }

  /**
   * Local presses, host or replica: flash the limbs you drive, and notice
   * grabs that close on nothing (a soft "whiff" instead of silence).
   */
  noteLocalInput(inputs: Partial<Record<Role, RoleInput>>) {
    let pressed = false;
    for (const [role, input] of Object.entries(inputs) as [Role, RoleInput][]) {
      if (!input) continue;
      for (const key of ["a", "b", "q", "e"] as const) {
        const id = `${role}:${key}`;
        const now = input[key];
        const was = this.prevLocalPress.get(id) ?? false;
        if (now && !was) {
          pressed = true;
          const grabRole = role === "arms" || role === "lhand" || role === "rhand";
          if (grabRole && (key === "a" || key === "q" || key === "e")) {
            const hands: (0 | 1)[] = key === "q" ? [0] : key === "e" ? [1] : role === "lhand" ? [0] : role === "rhand" ? [1] : [0, 1];
            for (const hand of hands) this.pendingMiss.push({ hand, t: this.visualTime });
          }
        }
        this.prevLocalPress.set(id, now);
      }
      if (Math.abs(input.f) > 0.3 || Math.abs(input.s) > 0.3) {
        const id = `${role}:move`;
        if (!this.prevLocalPress.get(id)) pressed = true;
        this.prevLocalPress.set(id, true);
      } else this.prevLocalPress.set(`${role}:move`, false);
    }
    if (pressed) this.view.pingHighlight();
    // resolve misses: no grab event for that hand within 0.35 s
    if (this.pendingMiss.length > 0) {
      const keep: typeof this.pendingMiss = [];
      for (const m of this.pendingMiss) {
        if (this.grabTimes[m.hand] >= m.t - 0.05) continue;
        if (this.visualTime - m.t < 0.35) keep.push(m);
        else if (!this.displayFallen && this.running) {
          const hp = this.handWorld(m.hand, new THREE.Vector3());
          this.effects.missPuff(hp);
          this.audio.miss();
          this.view.react("miss");
        }
      }
      this.pendingMiss = keep;
    }
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
        this.course?.setCheckpoint(i);
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
  /**
   * Feedback hierarchy: small actions get a sound and a puff; falls add a
   * little shake; objectives get rings, confetti, camera and UI moments.
   */
  handleBodyEvent(ev: BodyEvent, local: boolean) {
    const a = this.audio;
    const p = ev.pos;
    const feet: [number, number, number] = [p[0], p[1] - 0.95, p[2]];
    switch (ev.type) {
      case "step":
        a.step();
        this.effects.dust(p, 2);
        break;
      case "land": {
        const k = THREE.MathUtils.clamp(-this.airborneMinVy / 7, 0.3, 1.3);
        this.airborneMinVy = 0;
        a.land(k);
        this.effects.landing(feet, k);
        this.rig.addTrauma(0.08 + 0.18 * k);
        this.react("land", k);
        break;
      }
      case "grab": {
        const hand = ev.hand === 1 ? 1 : 0;
        const other = this.grabTimes[1 - hand];
        const strong = this.visualTime - other < 0.3 && ev.propId != null && ev.propId >= 0;
        this.grabTimes[hand] = this.visualTime;
        a.grab(strong);
        this.effects.grabSpark(p, this.teamColor, strong);
        this.react(strong ? "twoHandGrab" : "grab", 1, hand);
        this.runStats.grabs++;
        break;
      }
      case "release":
        a.release();
        this.react("release", 1, ev.hand);
        break;
      case "throw":
        a.whoosh();
        this.effects.throwBurst(p, [-Math.sin(this.displayYaw), -Math.cos(this.displayYaw)]);
        if (ev.propId != null) this.trails.set(ev.propId, this.visualTime + 0.8);
        this.react("throw");
        this.runStats.throws++;
        break;
      case "fall":
        a.fall();
        this.effects.landing(feet, 0.9);
        this.effects.impact(p, 0.7);
        this.rig.addTrauma(0.3);
        this.react("fall");
        this.runStats.falls++;
        this.moment("fall");
        break;
      case "getup":
        a.getup();
        this.effects.sparkle([p[0], p[1] + 0.6, p[2]], this.teamColor, 10);
        this.react("getup");
        this.moment("getup");
        break;
      case "jump":
        a.jump();
        this.effects.jump(feet);
        this.react("jump");
        this.runStats.jumps++;
        break;
      case "kick":
        a.kick();
        this.effects.dust(p, 2);
        break;
      case "climb":
        a.climb();
        this.effects.dust(p, 1);
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
    const force = ev.force ?? 0.5;
    switch (ev.type) {
      case "thud":
        a.thud(force);
        this.effects.impact(ev.pos, force);
        this.rig.addTrauma(0.12 * force);
        this.react("impact", force);
        break;
      case "bounce": {
        a.bounce(force);
        this.effects.impact(ev.pos, force * 0.5);
        const prop = this.nearestProp(ev.pos);
        if (prop) {
          prop.view.bump(force);
          if (prop.def.fragile) a.eek();
        }
        break;
      }
      case "splash": {
        const level = this.water?.level ?? -0.85;
        const seen = this.recentSplashes.some((r) => Math.hypot(r.x - ev.pos[0], r.z - ev.pos[2]) < 3.5);
        if (!seen) this.surfaceSplash(ev.pos[0], ev.pos[2], true);
        const px = this.displayTransforms[0];
        const pz = this.displayTransforms[2];
        const player = Math.hypot(px - ev.pos[0], pz - ev.pos[2]) < 2.5 && this.displayTransforms[1] < level + 1.5;
        a.respawn();
        if (player) {
          this.runStats.splashes++;
          this.moment("splash");
        } else this.moment("propSplash");
        void level;
        break;
      }
      case "crack":
        a.crack();
        this.effects.crack(ev.pos);
        this.rig.addTrauma(0.35);
        this.react("impact", 1);
        this.runStats.cracks++;
        this.moment("crack");
        break;
      case "checkpoint":
        a.checkpoint();
        this.effects.checkpoint(ev.pos);
        this.react("checkpoint");
        this.course?.moment("checkpoint", this.checkpointIdx);
        this.runStats.checkpoints++;
        this.moment("checkpoint", this.checkpointIdx + 1, this.level.checkpoints.length);
        break;
      case "score":
        if (this.level.hoop) {
          a.swish();
          a.cheer(0.8);
          this.effects.score(ev.pos);
          this.rig.addTrauma(0.22);
          this.rig.kickFov(4);
          this.course?.moment("score", this.score);
          this.runStats.baskets++;
          this.moment("score", this.score, this.level.targetScore ?? 3);
        } else {
          a.delivery();
          this.deliveryBurst();
          this.react("checkpoint");
          this.moment("delivered");
        }
        break;
      case "finish": {
        a.fanfare();
        if (this.level.hoop) a.cheer(1.4);
        if (this.level.deliver && !this.level.requireDeliverThenFinish) this.deliveryBurst();
        const z = this.level.finish;
        const origin: [number, number, number] = z ? [z.pos[0], z.pos[1] - z.size[1] / 2, z.pos[2]] : [ev.pos[0], ev.pos[1] - 1, ev.pos[2]];
        const colors = ["#ff5d5d", "#4fa8ff", PALETTE.dummy, PALETTE.mint, "#c58bff", "#ffffff", this.teamColor];
        const w = z ? Math.min(z.size[0], 7.2) / 2 + 0.75 : 1.5;
        for (let i = 0; i < 6; i++) {
          this.scheduleEffect(() => {
            for (const sx of [-1, 1]) this.effects.confetti([origin[0] + sx * w, origin[1] + 0.8, origin[2]], colors, 34, 0.4, 6.5);
            this.effects.confetti([ev.pos[0], ev.pos[1] + 1.8, ev.pos[2]], colors, 20, 1.2, 3);
          }, i * 200);
        }
        this.rig.addTrauma(0.25);
        this.rig.kickFov(5);
        this.course?.moment("finish");
        this.react("celebrate");
        this.finishedAt = this.visualTime;
        this.moment("finish");
        break;
      }
    }
    if (local) {
      if (ev.type === "thud" || ev.type === "bounce") {
        this.commentOnObjective({ type: ev.type, force: ev.force });
      }
      this.pendingEvents.push(ev);
    }
  }

  private react(kind: ReactionKind, intensity = 1, hand?: number) {
    this.view.react(kind, intensity, hand);
  }

  private moment(kind: MomentKind | "propSplash", value?: number, total?: number) {
    if (kind === "propSplash") return;
    this.onEvent({ type: "moment", kind, value, total });
  }

  private nearestProp(pos: [number, number, number]) {
    let best: Prop | null = null;
    let bestD = 1.2;
    for (const p of this.props) {
      const d = p.mesh.position.distanceTo(tmpV2.set(pos[0], pos[1], pos[2]));
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  private deliveryBurst() {
    const z = this.level.deliver;
    if (!z) return;
    const top = z.pos[1] - z.size[1] / 2 + 0.3;
    this.effects.delivery([z.pos[0], top, z.pos[2]]);
    this.rig.kickFov(3);
    this.rig.addTrauma(0.15);
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
    this.ownBuffer.push({ recv: this.ownTimeline.observe(s.t, performance.now()), snap: s });
    while (this.ownBuffer.length > 16) this.ownBuffer.shift();
    this.timer = s.timer;
    this.score = s.score;
    this.displayYaw = s.yaw;
    this.displayPitch = s.pitch;
    this.displayFallen = s.fallen === 1;
    if (s.state?.holds) {
      this.displayHolding = s.state.holds.length;
      this.displayHanging = s.state.holds.some((hold) => hold.propId < 0);
    }
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
      const view = new CharacterView(color, true, name, teamId);
      this.scene.add(view.root);
      g = { view, buffer: [], timeline: new SnapshotTimeline(), pose: new Array(PART_COUNT * 7).fill(0), lastEvT: 0 };
      this.ghosts.set(teamId, g);
    }
    g.view.setTeamName(name, color);
    g.buffer.push({ recv: g.timeline.observe(s.t, performance.now()), snap: s });
    while (g.buffer.length > 16) g.buffer.shift();
    for (const ev of s.ev) if (ev.type === "shout") g.view.shout(["HEY!", "MOVE!", "LOL", "NOOO", "FASTER!"][Math.floor(Math.random() * 5)]);
  }

  removeGhost(teamId: number) {
    const g = this.ghosts.get(teamId);
    if (!g) return;
    this.scene.remove(g.view.root);
    g.view.dispose();
    this.ghosts.delete(teamId);
  }

  private applyInterpolated(
    buffer: { recv: number; snap: Snap }[],
    timeline: SnapshotTimeline,
    out: number[],
    withProps: boolean,
  ): boolean {
    const rt = timeline.renderTime(performance.now());
    const bracket = bracketSnapshots(buffer, rt);
    if (!bracket) return false;
    const a = buffer[bracket.a];
    const b = buffer[bracket.b];
    const span = b.recv - a.recv;
    const k = span > 0 ? THREE.MathUtils.clamp((rt - a.recv) / span, 0, 1) : 1;
    const predictionSeconds = snapshotExtrapolationSeconds(rt, b.recv);
    if (withProps) {
      this.replicaFrames += 1;
      if (rt - b.recv > SNAPSHOT_MAX_EXTRAPOLATION_MS) this.replicaStarvedFrames += 1;
    }
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
    this.rig.update(dt, {
      pelvis: tmpV.set(this.displayTransforms[0], this.displayTransforms[1], this.displayTransforms[2]),
      yaw: this.displayYaw,
      pitch: this.displayPitch,
      fallen: this.displayFallen,
      hanging: this.displayHanging,
      finishedFor: this.finished && this.finishedAt >= 0 ? this.visualTime - this.finishedAt : -1,
    });
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
        hanging: this.displayHanging,
        objective: this.level.objective,
        running: this.running,
        finished: this.finished,
        checkpoint: this.checkpointIdx + 1,
        checkpointTotal: this.level.checkpoints.length,
        carrying: this.isCarryingObjective(),
        delivered: this.delivered,
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
    this.effects.dispose();
    this.sky?.mesh.removeFromParent();
    this.sky?.dispose();
    this.sky = null;
    this.water?.mesh.removeFromParent();
    this.water?.dispose();
    this.water = null;
    disposeFoamMaterial();
    disposeSharedMaterials();
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
