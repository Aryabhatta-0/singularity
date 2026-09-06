import * as THREE from "three";
import type RAPIER_T from "@dimforge/rapier3d-compat";
import { PHYS_ROLES, emptyInput, type PhysRole, type RoleInput } from "./types";

type R = typeof RAPIER_T;
type World = RAPIER_T.World;
type RigidBody = RAPIER_T.RigidBody;

export type BodyInputs = Record<PhysRole, RoleInput>;
export const makeInputs = (): BodyInputs => ({ head: emptyInput(), arms: emptyInput(), torso: emptyInput(), lleg: emptyInput(), rleg: emptyInput() });

export const GROUP_ENV = 0b001;
export const GROUP_BODY = 0b010;
export const GROUP_PROP = 0b100;
export const groups = (mem: number, filt: number) => (((mem & 0xffff) << 16) | (filt & 0xffff)) >>> 0;

export const PELVIS = 0, CHEST = 1, HEAD = 2, LUA = 3, LFA = 4, RUA = 5, RFA = 6, LTH = 7, LSH = 8, RTH = 9, RSH = 10;
export const PART_COUNT = 11;

export interface PartSpec {
  name: string;
  parent: number;
  shape: "capsule" | "box" | "ball";
  size: [number, number, number]; // capsule: [halfHeight, radius]; box: half extents; ball: [radius]
  pos: [number, number, number]; // rest position (standing, pelvis at y=1)
  anchorParent: [number, number, number];
  anchorSelf: [number, number, number];
  mass: number;
  kp: number;
  kd: number;
  maxT: number;
  inertia: number;
  extra?: { shape: "box" | "ball"; size: [number, number, number]; offset: [number, number, number] }[];
}

const PELVIS_H = 1.0;
export const PARTS: PartSpec[] = [
  { name: "pelvis", parent: -1, shape: "box", size: [0.17, 0.1, 0.11], pos: [0, PELVIS_H, 0], anchorParent: [0, 0, 0], anchorSelf: [0, 0, 0], mass: 9, kp: 0, kd: 0, inertia: 0.7, maxT: 0 },
  { name: "chest", parent: PELVIS, shape: "box", size: [0.2, 0.22, 0.12], pos: [0, PELVIS_H + 0.37, 0], anchorParent: [0, 0.15, 0], anchorSelf: [0, -0.22, 0], mass: 11, kp: 260, kd: 22, inertia: 0.3, maxT: 260 },
  { name: "head", parent: CHEST, shape: "ball", size: [0.2, 0, 0], pos: [0, PELVIS_H + 0.84, 0], anchorParent: [0, 0.27, 0], anchorSelf: [0, -0.2, 0], mass: 2.2, kp: 18, kd: 2.2, inertia: 0.05, maxT: 30 },
  { name: "lUpperArm", parent: CHEST, shape: "capsule", size: [0.13, 0.06, 0], pos: [-0.28, PELVIS_H + 0.34, 0], anchorParent: [-0.28, 0.16, 0], anchorSelf: [0, 0.19, 0], mass: 1.5, kp: 46, kd: 3.4, inertia: 0.035, maxT: 60 },
  { name: "lForearm", parent: LUA, shape: "capsule", size: [0.12, 0.055, 0], pos: [-0.28, PELVIS_H - 0.02, 0], anchorParent: [0, -0.19, 0], anchorSelf: [0, 0.17, 0], mass: 1.2, kp: 24, kd: 2.0, inertia: 0.03, maxT: 32, extra: [{ shape: "ball", size: [0.075, 0, 0], offset: [0, -0.2, 0] }] },
  { name: "rUpperArm", parent: CHEST, shape: "capsule", size: [0.13, 0.06, 0], pos: [0.28, PELVIS_H + 0.34, 0], anchorParent: [0.28, 0.16, 0], anchorSelf: [0, 0.19, 0], mass: 1.5, kp: 46, kd: 3.4, inertia: 0.035, maxT: 60 },
  { name: "rForearm", parent: RUA, shape: "capsule", size: [0.12, 0.055, 0], pos: [0.28, PELVIS_H - 0.02, 0], anchorParent: [0, -0.19, 0], anchorSelf: [0, 0.17, 0], mass: 1.2, kp: 24, kd: 2.0, inertia: 0.03, maxT: 32, extra: [{ shape: "ball", size: [0.075, 0, 0], offset: [0, -0.2, 0] }] },
  { name: "lThigh", parent: PELVIS, shape: "capsule", size: [0.14, 0.08, 0], pos: [-0.1, PELVIS_H - 0.3, 0], anchorParent: [-0.1, -0.08, 0], anchorSelf: [0, 0.22, 0], mass: 4.5, kp: 70, kd: 6, inertia: 0.09, maxT: 110 },
  { name: "lShin", parent: LTH, shape: "capsule", size: [0.14, 0.07, 0], pos: [-0.1, PELVIS_H - 0.73, 0], anchorParent: [0, -0.22, 0], anchorSelf: [0, 0.21, 0], mass: 3, kp: 48, kd: 4.2, inertia: 0.07, maxT: 70, extra: [{ shape: "box", size: [0.06, 0.03, 0.11], offset: [0, -0.24, -0.04] }] },
  { name: "rThigh", parent: PELVIS, shape: "capsule", size: [0.14, 0.08, 0], pos: [0.1, PELVIS_H - 0.3, 0], anchorParent: [0.1, -0.08, 0], anchorSelf: [0, 0.22, 0], mass: 4.5, kp: 70, kd: 6, inertia: 0.09, maxT: 110 },
  { name: "rShin", parent: RTH, shape: "capsule", size: [0.14, 0.07, 0], pos: [0.1, PELVIS_H - 0.73, 0], anchorParent: [0, -0.22, 0], anchorSelf: [0, 0.21, 0], mass: 3, kp: 48, kd: 4.2, inertia: 0.07, maxT: 70, extra: [{ shape: "box", size: [0.06, 0.03, 0.11], offset: [0, -0.24, -0.04] }] },
];

export const HAND_LOCAL = new THREE.Vector3(0, -0.22, 0);
export const FOOT_LOCAL = new THREE.Vector3(0, -0.26, -0.04);

export interface GrabTarget {
  body: RigidBody;
  localAnchor: THREE.Vector3;
  isStatic: boolean;
  mass: number;
  id: number;
  snapFrom?: THREE.Vector3; // start anchor (local) to slide from, for smooth ledge snapping
}

export interface BodyEvent {
  type: "step" | "land" | "grab" | "release" | "throw" | "fall" | "getup" | "jump" | "kick" | "shout" | "climb";
  pos: [number, number, number];
  hand?: number;
  propId?: number;
}

export interface Hold {
  hand: 0 | 1;
  joint: RAPIER_T.ImpulseJoint;
  target: RigidBody;
  isStatic: boolean;
  mass: number;
  id: number;
  snapFrom?: THREE.Vector3;
  snapTo?: THREE.Vector3;
  snapT: number;
}

interface LegState {
  lifted: boolean;
  t: number;
  dir: THREE.Vector2;
  kickT: number;
  lastPressed: number;
  wasDown: boolean;
  pressTime: number;
}

const _qP = new THREE.Quaternion();
const _qC = new THREE.Quaternion();
const _qT = new THREE.Quaternion();
const _qE = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();
const _qL = new THREE.Quaternion();
const _err = new THREE.Vector3();
const _torque = new THREE.Vector3();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

function angleWrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class RagdollBody {
  parts: RigidBody[] = [];
  colliderHandles = new Set<number>();
  inputs: BodyInputs = makeInputs();
  prev: BodyInputs = makeInputs();
  heading = 0;
  headPitch = 0;
  pelvisYaw = 0;
  armRaise = 0.1;
  armYaw = 0;
  throwT = 0;
  crouch = 0;
  brace = 0;
  braceStamina = 1;
  legs: LegState[] = [
    { lifted: false, t: 9, dir: new THREE.Vector2(), kickT: 0, lastPressed: -9, wasDown: false, pressTime: -9 },
    { lifted: false, t: 9, dir: new THREE.Vector2(), kickT: 0, lastPressed: -9, wasDown: false, pressTime: -9 },
  ];
  lastStrideLeg = -1;
  fallen = false;
  fallT = 0;
  recoverT = 0;
  balance = 1;
  grounded = true;
  groundDist = 1;
  airT = 0;
  jumpCooldown = 0;
  holds: Hold[] = [];
  frozen = false;
  time = 0;
  totalMass = 0;
  events: BodyEvent[] = [];
  shoutCooldown = 0;
  speed = 0;
  hangT = 0;
  grabLock = 0;
  findGrab: ((handPos: THREE.Vector3, excludeIds: number[]) => GrabTarget | null) | null = null;

  constructor(public R: R, public world: World, spawn: THREE.Vector3, yaw: number) {
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    for (let i = 0; i < PARTS.length; i++) {
      const p = PARTS[i];
      const local = new THREE.Vector3(p.pos[0], p.pos[1] - PELVIS_H, p.pos[2]).applyQuaternion(q);
      const pos = local.add(spawn).add(new THREE.Vector3(0, PELVIS_H, 0));
      const desc = R.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setLinearDamping(i === PELVIS ? 0.2 : 0.4)
        .setAngularDamping(i === PELVIS ? 3 : 2)
        .setAdditionalMassProperties(0, { x: 0, y: 0, z: 0 }, { x: p.inertia, y: p.inertia, z: p.inertia }, { x: 0, y: 0, z: 0, w: 1 })
        .setCcdEnabled(true);
      const rb = world.createRigidBody(desc);
      let cd: RAPIER_T.ColliderDesc;
      if (p.shape === "capsule") cd = R.ColliderDesc.capsule(p.size[0], p.size[1]);
      else if (p.shape === "box") cd = R.ColliderDesc.cuboid(p.size[0], p.size[1], p.size[2]);
      else cd = R.ColliderDesc.ball(p.size[0]);
      cd.setMass(p.mass).setFriction(i === LSH || i === RSH ? 0.7 : 0.25).setRestitution(0.05).setCollisionGroups(groups(GROUP_BODY, GROUP_ENV | GROUP_PROP));
      cd.setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(450);
      const col = world.createCollider(cd, rb);
      this.colliderHandles.add(col.handle);
      if (p.extra) {
        for (const ex of p.extra) {
          const ecd = ex.shape === "ball" ? R.ColliderDesc.ball(ex.size[0]) : R.ColliderDesc.cuboid(ex.size[0], ex.size[1], ex.size[2]);
          ecd.setTranslation(ex.offset[0], ex.offset[1], ex.offset[2]).setMass(0.3).setFriction(ex.shape === "ball" ? 0.4 : 0.9).setCollisionGroups(groups(GROUP_BODY, GROUP_ENV | GROUP_PROP));
          const ec = world.createCollider(ecd, rb);
          this.colliderHandles.add(ec.handle);
        }
      }
      this.parts.push(rb);
      this.totalMass += p.mass + (p.extra?.length ?? 0) * 0.3;
    }
    for (let i = 1; i < PARTS.length; i++) {
      const p = PARTS[i];
      const jd = R.JointData.spherical(
        { x: p.anchorParent[0], y: p.anchorParent[1], z: p.anchorParent[2] },
        { x: p.anchorSelf[0], y: p.anchorSelf[1], z: p.anchorSelf[2] }
      );
      world.createImpulseJoint(jd, this.parts[p.parent], this.parts[i], true);
    }
    this.heading = yaw;
    this.pelvisYaw = yaw;
    this.inputs.head.lx = yaw;
  }

  dispose() {
    this.releaseAll(false);
    for (const p of this.parts) this.world.removeRigidBody(p);
    this.parts = [];
  }

  pos(i: number, out = new THREE.Vector3()) {
    const t = this.parts[i].translation();
    return out.set(t.x, t.y, t.z);
  }
  quat(i: number, out = new THREE.Quaternion()) {
    const r = this.parts[i].rotation();
    return out.set(r.x, r.y, r.z, r.w);
  }
  handPos(hand: 0 | 1, out = new THREE.Vector3()) {
    const i = hand === 0 ? LFA : RFA;
    return out.copy(HAND_LOCAL).applyQuaternion(this.quat(i, _qC)).add(this.pos(i, _v2));
  }
  footPos(leg: 0 | 1, out = new THREE.Vector3()) {
    const i = leg === 0 ? LSH : RSH;
    return out.copy(FOOT_LOCAL).applyQuaternion(this.quat(i, _qC)).add(this.pos(i, _v2));
  }
  pelvisPos(out = new THREE.Vector3()) {
    return this.pos(PELVIS, out);
  }

  teleport(spawn: THREE.Vector3, yaw: number) {
    this.releaseAll(false);
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    for (let i = 0; i < PARTS.length; i++) {
      const p = PARTS[i];
      const local = new THREE.Vector3(p.pos[0], p.pos[1] - PELVIS_H, p.pos[2]).applyQuaternion(q);
      const pos = local.add(spawn).add(new THREE.Vector3(0, PELVIS_H, 0));
      const rb = this.parts[i];
      rb.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
      rb.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.heading = yaw;
    this.pelvisYaw = yaw;
    this.headPitch = 0;
    this.inputs.head.lx = yaw;
    this.inputs.head.ly = 0;
    this.fallen = false;
    this.balance = 1;
    this.recoverT = 0;
    this.fallT = 0;
    this.armRaise = 0.1;
    this.crouch = 0;
    for (const l of this.legs) {
      l.lifted = false;
      l.t = 9;
      l.kickT = 0;
    }
  }

  /** Restore an authoritative pose after this client is promoted to host. */
  restoreTransforms(transforms: ArrayLike<number>, heading: number, headPitch: number, fallen: boolean, velocities?: ArrayLike<number>) {
    this.releaseAll(false);
    for (let i = 0; i < PART_COUNT; i++) {
      const offset = i * 7;
      const rb = this.parts[i];
      rb.setTranslation({ x: transforms[offset], y: transforms[offset + 1], z: transforms[offset + 2] }, true);
      rb.setRotation({ x: transforms[offset + 3], y: transforms[offset + 4], z: transforms[offset + 5], w: transforms[offset + 6] }, true);
      const velocityOffset = i * 6;
      rb.setLinvel({ x: velocities?.[velocityOffset] ?? 0, y: velocities?.[velocityOffset + 1] ?? 0, z: velocities?.[velocityOffset + 2] ?? 0 }, true);
      rb.setAngvel({ x: velocities?.[velocityOffset + 3] ?? 0, y: velocities?.[velocityOffset + 4] ?? 0, z: velocities?.[velocityOffset + 5] ?? 0 }, true);
    }
    this.heading = heading;
    this.pelvisYaw = heading;
    this.headPitch = headPitch;
    this.inputs.head.lx = heading;
    this.inputs.head.ly = headPitch;
    this.fallen = fallen;
    this.balance = fallen ? 0 : 1;
  }

  /** Rebuild a dynamic prop joint from the restored hand and prop poses. */
  restoreDynamicHold(hand: 0 | 1, target: RigidBody, id: number, mass: number) {
    if (this.holds.some((hold) => hold.hand === hand)) return;
    const handWorld = this.handPos(hand, new THREE.Vector3());
    const targetPos = target.translation();
    const targetRotation = target.rotation();
    const localAnchor = handWorld
      .sub(new THREE.Vector3(targetPos.x, targetPos.y, targetPos.z))
      .applyQuaternion(new THREE.Quaternion(targetRotation.x, targetRotation.y, targetRotation.z, targetRotation.w).invert());
    const forearm = this.parts[hand === 0 ? LFA : RFA];
    const jointData = this.R.JointData.spherical(
      { x: HAND_LOCAL.x, y: HAND_LOCAL.y, z: HAND_LOCAL.z },
      { x: localAnchor.x, y: localAnchor.y, z: localAnchor.z },
    );
    const joint = this.world.createImpulseJoint(jointData, forearm, target, true);
    this.holds.push({ hand, joint, target, isStatic: false, mass, id, snapT: 1 });
  }

  /** Rebuild a static ledge joint from the deterministic collider id in a snapshot. */
  restoreStaticHold(hand: 0 | 1, id: number) {
    if (this.holds.some((hold) => hold.hand === hand) || !Number.isSafeInteger(id) || id >= 0) return;
    const collider = this.world.getCollider(-1 - id);
    const target = collider?.parent();
    if (!target) return;
    const handWorld = this.handPos(hand, new THREE.Vector3());
    const targetPos = target.translation();
    const targetRotation = target.rotation();
    const localAnchor = handWorld
      .sub(new THREE.Vector3(targetPos.x, targetPos.y, targetPos.z))
      .applyQuaternion(new THREE.Quaternion(targetRotation.x, targetRotation.y, targetRotation.z, targetRotation.w).invert());
    const forearm = this.parts[hand === 0 ? LFA : RFA];
    const jointData = this.R.JointData.spherical(
      { x: HAND_LOCAL.x, y: HAND_LOCAL.y, z: HAND_LOCAL.z },
      { x: localAnchor.x, y: localAnchor.y, z: localAnchor.z },
    );
    const joint = this.world.createImpulseJoint(jointData, forearm, target, true);
    this.holds.push({ hand, joint, target, isStatic: true, mass: 0, id, snapT: 1 });
  }

  private emit(type: BodyEvent["type"], p: THREE.Vector3, extra?: Partial<BodyEvent>) {
    this.events.push({ type, pos: [p.x, p.y, p.z], ...extra });
  }

  private drive(child: number, parent: number, localTarget: THREE.Quaternion, gain = 1) {
    const spec = PARTS[child];
    const c = this.parts[child];
    const p = this.parts[parent];
    const rp = p.rotation();
    const rc = c.rotation();
    _qP.set(rp.x, rp.y, rp.z, rp.w);
    _qC.set(rc.x, rc.y, rc.z, rc.w);
    _qT.copy(_qP).multiply(localTarget);
    _qInv.copy(_qC).invert();
    _qE.copy(_qT).multiply(_qInv);
    if (_qE.w < 0) _qE.set(-_qE.x, -_qE.y, -_qE.z, -_qE.w);
    const w = clamp(_qE.w, -1, 1);
    const ang = 2 * Math.acos(w);
    const s = Math.sqrt(Math.max(0, 1 - w * w));
    if (s < 1e-5) _err.set(0, 0, 0);
    else _err.set(_qE.x / s, _qE.y / s, _qE.z / s).multiplyScalar(ang);
    const wc = c.angvel();
    const wp = p.angvel();
    const kp = spec.kp * gain;
    const kd = spec.kd * Math.min(1.15, Math.sqrt(Math.max(gain, 0.05)));
    _torque.set(kp * _err.x - kd * (wc.x - wp.x), kp * _err.y - kd * (wc.y - wp.y), kp * _err.z - kd * (wc.z - wp.z));
    const maxT = spec.maxT * Math.max(gain, 0.3);
    if (_torque.lengthSq() > maxT * maxT) _torque.setLength(maxT);
    c.addTorque({ x: _torque.x, y: _torque.y, z: _torque.z }, true);
    p.addTorque({ x: -_torque.x, y: -_torque.y, z: -_torque.z }, true);
  }

  /** Called once per physics step (dt = step size). */
  update(dt: number) {
    const R = this.R;
    this.time += dt;
    this.events.length = 0;
    const inp = this.frozen ? makeInputs() : this.inputs;
    if (this.frozen) inp.head.lx = this.heading;
    for (const rb of this.parts) {
      rb.resetForces(true);
      rb.resetTorques(true);
    }

    // ---- Head / heading ----
    this.heading = inp.head.lx;
    this.headPitch = clamp(inp.head.ly, -0.9, 0.7);
    if (inp.head.a && !this.prev.head.a && this.shoutCooldown <= 0) {
      this.shoutCooldown = 1.2;
      this.emit("shout", this.pos(HEAD, _v));
    }
    this.shoutCooldown -= dt;

    // ---- Ground probe ----
    const pp = this.pelvisPos(_v);
    const ray = new R.Ray({ x: pp.x, y: pp.y, z: pp.z }, { x: 0, y: -1, z: 0 });
    const heldHandles = new Set(this.holds.map((h) => h.target.handle));
    const hit = this.world.castRay(ray, 3, false, undefined, groups(0xffff, GROUP_ENV | GROUP_PROP), undefined, undefined, (c) => {
      const parent = c.parent();
      return !parent || !heldHandles.has(parent.handle);
    });
    const mainDist = hit ? hit.timeOfImpact : 99;
    this.groundDist = mainDist;
    let mantling = false;
    if (this.holds.some((h) => h.isStatic)) {
      if (mainDist < 0.75) {
        // we made it over the ledge: let go so the hover can finish standing up
        for (const h of [...this.holds]) if (h.isStatic) this.release(h, false);
        this.emit("climb", pp);
      } else {
        const fx = -Math.sin(this.heading), fz = -Math.cos(this.heading);
        const probe = new R.Ray({ x: pp.x + fx * 0.45, y: pp.y + 0.05, z: pp.z + fz * 0.45 }, { x: 0, y: -1, z: 0 });
        const ph = this.world.castRay(probe, 3, false, undefined, groups(0xffff, GROUP_ENV));
        if (ph && ph.timeOfImpact < PELVIS_H - 0.05 && ph.timeOfImpact < mainDist - 0.05) {
          this.groundDist = ph.timeOfImpact;
          mantling = true;
        }
      }
    }
    const pelvisQ = this.quat(PELVIS, _qP);
    _v2.copy(UP).applyQuaternion(pelvisQ);
    const tilt = Math.acos(clamp(_v2.y, -1, 1));
    _e.setFromQuaternion(pelvisQ, "YXZ");
    this.pelvisYaw = _e.y;
    const lin = this.parts[PELVIS].linvel();
    this.speed = Math.hypot(lin.x, lin.z);

    // ---- Torso ----
    const wantCrouch = inp.torso.b ? 1 : 0;
    this.crouch = lerp(this.crouch, wantCrouch, 1 - Math.exp(-dt * 8));
    if (inp.torso.a && !this.fallen && this.braceStamina > 0) {
      this.brace = 1;
      this.braceStamina = Math.max(0, this.braceStamina - dt / 2.5);
    } else {
      this.brace = 0;
      this.braceStamina = Math.min(1, this.braceStamina + dt / 4);
    }
    const leanF = inp.torso.f;
    const leanS = inp.torso.s;

    // ---- Legs: strides, kicks, jumps ----
    const legInputs = [inp.lleg, inp.rleg];
    let planted = 0;
    let bothKick = false;
    for (let i = 0; i < 2; i++) {
      const L = this.legs[i];
      const li = legInputs[i];
      const down = Math.abs(li.f) > 0.3 || Math.abs(li.s) > 0.3;
      if (down && !L.wasDown && !this.fallen) {
        L.lifted = true;
        L.t = 0;
        L.dir.set(li.s, li.f).normalize();
        L.pressTime = this.time;
      } else if (down && L.wasDown) {
        L.dir.set(li.s, li.f).normalize();
      }
      if (!down && L.wasDown) {
        L.lifted = false;
        if (this.grounded && !this.fallen) {
          this.emit("step", this.footPos(i as 0 | 1, _v2));
        }
      }
      L.wasDown = down;
      L.t += dt;
      // kick
      if (li.a && !(i === 0 ? this.prev.lleg.a : this.prev.rleg.a) && !this.fallen) {
        L.kickT = 0.32;
        L.lastPressed = this.time;
        const other = this.legs[1 - i];
        if (this.time - other.lastPressed < 0.22 && this.grounded && this.jumpCooldown <= 0 && !this.fallen) bothKick = true;
        else this.emit("kick", this.footPos(i as 0 | 1, _v2));
      }
      L.kickT = Math.max(0, L.kickT - dt);
      if (!L.lifted && L.kickT <= 0) planted++;
    }
    const hanging = this.holds.some((h) => h.isStatic);
    const climbing = hanging && inp.arms.f < -0.3 && !mantling;
    const support = this.fallen || climbing ? 0 : mantling ? 1 : planted === 2 ? 1 : planted === 1 ? 0.92 : 0;
    const targetH = mantling ? 0.6 : PELVIS_H + 0.03 - this.crouch * 0.38;
    const wasGrounded = this.grounded;
    this.grounded = this.groundDist < targetH + 0.35;
    if (this.grounded && !wasGrounded && this.airT > 0.25) this.emit("land", pp);
    this.airT = this.grounded ? 0 : this.airT + dt;
    this.jumpCooldown -= dt;

    // ---- Falling / recovery ----
    if (!this.fallen && tilt > 1.08 && !hanging) {
      this.fallen = true;
      this.fallT = 0;
      this.recoverT = 0;
      this.releaseAll(true);
      this.emit("fall", pp);
    }
    if (this.fallen) {
      this.fallT += dt;
      const wantsUp = inp.torso.a || this.fallT > 2.6;
      if (wantsUp) this.recoverT += dt;
      else this.recoverT = Math.max(0, this.recoverT - dt * 0.5);
      this.balance = clamp(this.recoverT / 0.7, 0, 1) * 0.75 + (this.fallT < 0.15 ? 0.4 : 0);
      if (this.recoverT > 0.5 && tilt < 0.55) {
        this.fallen = false;
        this.balance = 1;
        this.emit("getup", pp);
      } else if (this.recoverT > 2.2) {
        // physics assist: hard reset orientation
        const q = new THREE.Quaternion().setFromAxisAngle(UP, this.heading);
        const rb = this.parts[PELVIS];
        rb.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
        rb.setTranslation({ x: pp.x, y: pp.y + 0.5, z: pp.z }, true);
        rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
        rb.setLinvel({ x: 0, y: 1.5, z: 0 }, true);
        this.fallen = false;
        this.balance = 1;
        this.emit("getup", pp);
      }
    } else {
      this.balance = lerp(this.balance, 1, 1 - Math.exp(-dt * 6));
    }
    const bal = this.balance;
    const limbGain = this.fallen ? 0.12 : 1;

    // ---- Hover / support ----
    const pelvis = this.parts[PELVIS];
    const m = this.totalMass;
    const g = 9.81;
    if (support > 0 && this.grounded && !this.fallen) {
      const err = targetH - this.groundDist;
      const vy = lin.y;
      let f = m * (55 * err - 9 * vy) * support * bal + m * g * support * bal;
      if (err < -0.25) f = Math.max(Math.min(f, 0), -m * g * 0.6); // don't yank down when high
      f -= m * g * 0.7 * this.crouch;
      if (bothKick) f = 0;
      pelvis.addForce({ x: 0, y: f, z: 0 }, true);
    } else if (this.fallen && this.recoverT > 0.05) {
      const err = targetH - this.groundDist;
      const f = m * g * 0.95 * clamp(this.recoverT / 0.7, 0, 1) + m * 30 * Math.max(err, 0);
      pelvis.addForce({ x: 0, y: f, z: 0 }, true);
    }
    if (bothKick) {
      this.jumpCooldown = 1.0;
      const fwd = _v2.set(-Math.sin(this.heading), 0, -Math.cos(this.heading));
      pelvis.applyImpulse({ x: fwd.x * m * 1.5, y: m * 4.7, z: fwd.z * m * 1.5 }, true);
      this.emit("jump", pp);
    }

    // ---- Locomotion forces ----
    const fwd = new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading));
    const right = new THREE.Vector3(Math.cos(this.heading), 0, -Math.sin(this.heading));
    let pushing = false;
    if (!this.fallen && this.grounded) {
      for (let i = 0; i < 2; i++) {
        const L = this.legs[i];
        const other = this.legs[1 - i];
        if (L.lifted && L.t < 0.42 && !other.lifted) {
          pushing = true;
          const strength = this.lastStrideLeg === i && L.t < 0.02 ? 0.55 : 1;
          if (L.t < 0.02) this.lastStrideLeg = i;
          const same = this.lastStrideLeg === i;
          const k = (same ? strength : 1) * (1 - L.t / 0.42);
          const speedMax = 3.4 - this.crouch * 1.2;
          const desired = _v2.copy(fwd).multiplyScalar(L.dir.y * speedMax).addScaledVector(right, L.dir.x * speedMax * 0.8);
          const fx = m * (desired.x - lin.x) * 9 * k;
          const fz = m * (desired.z - lin.z) * 9 * k;
          pelvis.addForce({ x: fx, y: 0, z: fz }, true);
        }
      }
      // leaning forward drifts you
      if (Math.abs(leanF) > 0.2 && planted > 0) {
        pelvis.addForce({ x: fwd.x * m * leanF * 1.4, y: 0, z: fwd.z * m * leanF * 1.4 }, true);
      }
      if (!pushing && planted > 0) {
        const brake = planted === 2 ? 5.5 : 2.2;
        pelvis.addForce({ x: -lin.x * m * brake, y: 0, z: -lin.z * m * brake }, true);
      }
    }

    // ---- Climb assist while hanging ----
    if (hanging) {
      this.hangT += dt;
      if (mantling) {
        pelvis.addForce({ x: fwd.x * m * 3.5, y: 0, z: fwd.z * m * 3.5 }, true);
      } else if (climbing) {
        const vy = lin.y;
        pelvis.addForce({ x: fwd.x * m * 2.0, y: m * g * 1.75 - m * vy * 4, z: fwd.z * m * 2.0 }, true);
        if (this.hangT > 0.3 && Math.floor(this.time * 3) !== Math.floor((this.time - dt) * 3)) this.emit("climb", pp);
      } else if (!this.grounded) {
        pelvis.addForce({ x: 0, y: m * g * 0.5, z: 0 }, true);
      }
    } else this.hangT = 0;

    // ---- Upright controller on pelvis ----
    {
      const targetPitch = -leanF * 0.28;
      const targetRoll = -leanS * 0.3 + (planted === 1 ? (this.legs[0].lifted ? -0.05 : 0.05) : 0);
      _e.set(targetPitch, this.heading, targetRoll, "YXZ");
      _qT.setFromEuler(_e);
      _qInv.copy(pelvisQ).invert();
      _qE.copy(_qT).multiply(_qInv);
      if (_qE.w < 0) _qE.set(-_qE.x, -_qE.y, -_qE.z, -_qE.w);
      const w = clamp(_qE.w, -1, 1);
      const ang = 2 * Math.acos(w);
      const s = Math.sqrt(Math.max(0, 1 - w * w));
      if (s < 1e-5) _err.set(0, 0, 0);
      else _err.set(_qE.x / s, _qE.y / s, _qE.z / s).multiplyScalar(ang);
      const yawE = _err.y;
      const tiltEx = _err.x;
      const tiltEz = _err.z;
      const av = pelvis.angvel();
      const kU = (this.fallen ? 260 : 440) * bal * (1 + this.brace * 0.8) * (this.grounded ? 1 : 0.35);
      const dU = 60 * Math.sqrt(bal) * (1 + this.brace * 0.5);
      const kY = 160 * bal;
      const dY = 30;
      _torque.set(kU * tiltEx - dU * av.x, kY * yawE - dY * av.y, kU * tiltEz - dU * av.z);
      const maxT = (this.fallen ? 220 : 270) * (1 + this.brace * 0.6);
      if (_torque.lengthSq() > maxT * maxT) _torque.setLength(maxT);
      pelvis.addTorque({ x: _torque.x, y: _torque.y, z: _torque.z }, true);
    }

    // ---- Joint targets ----
    // chest
    _e.set(-leanF * 0.55 + this.crouch * 0.35, 0, -leanS * 0.4, "YXZ");
    this.drive(CHEST, PELVIS, _qL.setFromEuler(_e), limbGain * (1 + this.brace * 0.5));
    // head
    const headYaw = clamp(angleWrap(this.heading - this.pelvisYaw), -1.3, 1.3);
    _e.set(this.headPitch + leanF * 0.3, headYaw, 0, "YXZ");
    this.drive(HEAD, CHEST, _qL.setFromEuler(_e), limbGain);

    // arms
    this.armRaise = clamp(this.armRaise + inp.arms.f * dt * 1.6, 0, 1);
    this.armYaw = lerp(this.armYaw, -inp.arms.s * 0.9, 1 - Math.exp(-dt * 6));
    if (inp.arms.b && !this.prev.arms.b && this.holds.length > 0) this.throw();
    this.throwT = Math.max(0, this.throwT - dt);
    const throwSwing = this.throwT > 0 ? Math.sin((this.throwT / 0.35) * Math.PI) : 0;
    const baseArm = 0.12 + this.armRaise * 2.5 + throwSwing * 1.2 + (this.fallen ? 0.5 : 0);
    const holdingAny = this.holds.length > 0;
    for (let side = 0; side < 2; side++) {
      const sgn = side === 0 ? -1 : 1;
      const holding = this.holds.some((h) => h.hand === side);
      const raise = holding ? Math.max(baseArm, 0.9) : baseArm;
      const spread = holding ? 0.05 : 0.18 + (this.armRaise > 0.2 ? 0 : 0);
      _e.set(raise, this.armYaw, sgn * spread, "YXZ");
      this.drive(side === 0 ? LUA : RUA, CHEST, _qL.setFromEuler(_e), limbGain * (holding ? 1.6 : 1) * (this.throwT > 0 ? 2 : 1));
      const elbow = holdingAny ? 0.5 : 0.25 + this.armRaise * 0.5 + throwSwing * 0.8;
      _e.set(elbow, 0, sgn * 0.15, "YXZ");
      this.drive(side === 0 ? LFA : RFA, side === 0 ? LUA : RUA, _qL.setFromEuler(_e), limbGain);
    }

    // legs
    for (let i = 0; i < 2; i++) {
      const L = this.legs[i];
      const sgn = i === 0 ? -1 : 1;
      let pitch = 0.04 + this.crouch * 1.25;
      let knee = -0.08 - this.crouch * 1.9;
      let roll = sgn * 0.04;
      let gain = 1 - this.crouch * 0.45;
      if (L.lifted && !this.fallen) {
        const sw = clamp(L.t / 0.18, 0, 1);
        pitch = L.dir.y * (0.95 - sw * 0.3) + 0.15;
        knee = -(0.95 + Math.abs(L.dir.y) * 0.85) * (1 - sw * 0.3);
        roll = L.dir.x * 0.65 + sgn * 0.05;
        gain = 1.3;
      }
      if (L.kickT > 0) {
        pitch = 1.6;
        knee = -0.15;
        gain = 2.4;
      }
      if (!this.grounded && this.airT > 0.1 && !hanging) {
        pitch += 0.6;
        knee -= 0.8;
      }
      if (hanging) {
        pitch = 0.35;
        knee = -0.9;
      }
      _e.set(pitch, 0, roll, "YXZ");
      this.drive(i === 0 ? LTH : RTH, PELVIS, _qL.setFromEuler(_e), limbGain * gain);
      _e.set(knee, 0, 0, "YXZ");
      this.drive(i === 0 ? LSH : RSH, i === 0 ? LTH : RTH, _qL.setFromEuler(_e), limbGain * gain);
    }

    // ---- Grabbing ----
    const wantL = inp.arms.a || inp.arms.q;
    const wantR = inp.arms.a || inp.arms.e;
    this.grabLock = Math.max(0, this.grabLock - dt);
    if (!this.fallen) {
      this.updateHand(0, wantL);
      this.updateHand(1, wantR);
    }
    // slide ledge-snap anchors smoothly
    for (const h of this.holds) {
      if (h.snapFrom && h.snapTo && h.snapT < 1) {
        h.snapT = Math.min(1, h.snapT + dt / 0.3);
        const k = h.snapT * h.snapT * (3 - 2 * h.snapT);
        h.joint.setAnchor2({ x: lerp(h.snapFrom.x, h.snapTo.x, k), y: lerp(h.snapFrom.y, h.snapTo.y, k), z: lerp(h.snapFrom.z, h.snapTo.z, k) });
      }
    }
    // carry assist: partially cancel weight of held dynamic props
    for (const h of this.holds) {
      if (!h.isStatic) {
        h.target.resetForces(true);
        h.target.addForce({ x: 0, y: h.mass * g * 0.72, z: 0 }, true);
      }
    }

    // copy prev
    for (const r of PHYS_ROLES) Object.assign(this.prev[r], inp[r]);
  }

  private updateHand(hand: 0 | 1, want: boolean) {
    const held = this.holds.find((h) => h.hand === hand);
    if (want && !held && this.findGrab && this.grabLock <= 0) {
      const hp = this.handPos(hand, new THREE.Vector3());
      const t = this.findGrab(hp, []);
      if (t) {
        const fa = this.parts[hand === 0 ? LFA : RFA];
        const a2 = t.snapFrom ?? t.localAnchor;
        const jd = this.R.JointData.spherical({ x: HAND_LOCAL.x, y: HAND_LOCAL.y, z: HAND_LOCAL.z }, { x: a2.x, y: a2.y, z: a2.z });
        const joint = this.world.createImpulseJoint(jd, fa, t.body, true);
        this.holds.push({ hand, joint, target: t.body, isStatic: t.isStatic, mass: t.mass, id: t.id, snapFrom: t.snapFrom, snapTo: t.snapFrom ? t.localAnchor : undefined, snapT: 0 });
        this.emit("grab", hp, { hand, propId: t.id });
      }
    } else if (!want && held) {
      this.release(held, true);
    }
  }

  private release(h: Hold, emit: boolean) {
    this.world.removeImpulseJoint(h.joint, true);
    if (!h.isStatic) h.target.resetForces(true);
    this.holds = this.holds.filter((x) => x !== h);
    if (emit) this.emit("release", this.handPos(h.hand, new THREE.Vector3()), { hand: h.hand, propId: h.id });
  }

  releaseAll(emit: boolean) {
    for (const h of [...this.holds]) this.release(h, emit);
  }

  isHolding(id: number) {
    return this.holds.some((h) => h.id === id);
  }

  private throw() {
    const fwd = new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading));
    const upAmt = 0.22 + this.armRaise * 0.55 + Math.max(0, this.headPitch) * 0.5;
    const dir = fwd.clone().multiplyScalar(Math.cos(upAmt)).add(new THREE.Vector3(0, Math.sin(upAmt), 0)).normalize();
    const thrown = new Set<RigidBody>();
    for (const h of [...this.holds]) {
      const target = h.target;
      const isStatic = h.isStatic;
      const mass = h.mass;
      this.release(h, false);
      if (isStatic || thrown.has(target)) continue;
      thrown.add(target);
      const mag = Math.min(mass, 8) * 8.5 + 3;
      target.applyImpulse({ x: dir.x * mag, y: dir.y * mag, z: dir.z * mag }, true);
      this.emit("throw", this.pos(CHEST, new THREE.Vector3()), { propId: h.id });
    }
    this.throwT = 0.35;
    this.grabLock = 0.7;
    // recoil
    const m = this.totalMass;
    this.parts[CHEST].applyImpulse({ x: -dir.x * m * 0.25, y: 0, z: -dir.z * m * 0.25 }, true);
  }

  /** Flat transforms for rendering / networking: 7 numbers per part */
  writeTransforms(out: number[], offset = 0) {
    for (let i = 0; i < PART_COUNT; i++) {
      const t = this.parts[i].translation();
      const r = this.parts[i].rotation();
      const o = offset + i * 7;
      out[o] = t.x;
      out[o + 1] = t.y;
      out[o + 2] = t.z;
      out[o + 3] = r.x;
      out[o + 4] = r.y;
      out[o + 5] = r.z;
      out[o + 6] = r.w;
    }
    return out;
  }
}


/** Static-geometry grab with ledge snapping: prefers a walkable top surface near the hand. */
export function findStaticGrab(R: R, world: World, hp: THREE.Vector3, heading: number, grabbable: (handle: number) => boolean): GrabTarget | null {
  const fx = -Math.sin(heading);
  const fz = -Math.cos(heading);
  const filter = groups(0xffff, GROUP_ENV);
  // 1) ledge probe: look for a top surface slightly ahead/above the hand
  for (const ahead of [0.2, 0.08]) {
    const origin = { x: hp.x + fx * ahead, y: hp.y + 0.3, z: hp.z + fz * ahead };
    const ray = new R.Ray(origin, { x: 0, y: -1, z: 0 });
    const hit = world.castRayAndGetNormal(ray, 0.6, false, undefined, filter);
    if (hit && hit.normal.y > 0.7 && grabbable(hit.collider.handle)) {
      const py = origin.y - hit.timeOfImpact;
      if (py > hp.y - 0.22 && py < hp.y + 0.25) {
        const rb = hit.collider.parent();
        if (rb) {
          const t = rb.translation();
          const r = rb.rotation();
          const q = new THREE.Quaternion(r.x, r.y, r.z, r.w).invert();
          const local = new THREE.Vector3(origin.x - t.x, py + 0.02 - t.y, origin.z - t.z).applyQuaternion(q);
          const from = new THREE.Vector3(hp.x - t.x, hp.y - t.y, hp.z - t.z).applyQuaternion(q);
          return { body: rb, localAnchor: local, isStatic: true, mass: 0, id: -1 - hit.collider.handle, snapFrom: from };
        }
      }
    }
  }
  // 2) any nearby surface
  const proj = world.projectPoint({ x: hp.x, y: hp.y, z: hp.z }, true, undefined, filter);
  if (proj) {
    const d = Math.hypot(proj.point.x - hp.x, proj.point.y - hp.y, proj.point.z - hp.z);
    if (d < 0.2 && grabbable(proj.collider.handle)) {
      const rb = proj.collider.parent();
      if (rb) {
        const t = rb.translation();
        const r = rb.rotation();
        const q = new THREE.Quaternion(r.x, r.y, r.z, r.w).invert();
        const local = new THREE.Vector3(proj.point.x - t.x, proj.point.y - t.y, proj.point.z - t.z).applyQuaternion(q);
        return { body: rb, localAnchor: local, isStatic: true, mass: 0, id: -1 - proj.collider.handle };
      }
    }
  }
  return null;
}
