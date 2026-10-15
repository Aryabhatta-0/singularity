import * as THREE from "three";

/**
 * Third-person camera. Keeps the original follow feel (yaw follows the
 * dummy's heading, pitch follows the torso's look) and adds:
 *
 * - framing by situation: pull back with speed and when down, drop lower to
 *   show the ledge while hanging, a slow orbit to the face at the finish
 * - obstruction handling: pulls in (fast) when course geometry blocks the
 *   view, eases back out (slowly)
 * - trauma shake (smooth noise, squared falloff) and FOV kicks for big
 *   moments; both are off under prefers-reduced-motion
 * - a hard cut instead of a swoop when the dummy respawns far away
 */

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export interface CameraSubject {
  pelvis: THREE.Vector3;
  yaw: number;
  pitch: number;
  fallen: boolean;
  hanging: boolean;
  /** Seconds since this client saw its team finish, or -1. */
  finishedFor: number;
}

const BASE_FOV = 58;
const BASE_DIST = 5.6;

export class GameCamera {
  focus = new THREE.Vector3();
  yaw = 0;
  pitch = 0.36;
  dist = BASE_DIST;
  waterLevel = -0.85;
  reducedMotion = false;
  private trauma = 0;
  private fovKick = 0;
  private velocity = new THREE.Vector3();
  private lastPelvis = new THREE.Vector3();
  private hasLast = false;
  private clearDist = BASE_DIST;
  private t = Math.random() * 100;
  private desired = new THREE.Vector3();
  private look = new THREE.Vector3();
  private offset = new THREE.Vector3();
  private target = new THREE.Vector3();

  constructor(
    private camera: THREE.PerspectiveCamera,
    /** Distance along from→to until geometry blocks, or null if clear. */
    private probe: (from: THREE.Vector3, to: THREE.Vector3) => number | null,
  ) {}

  snapTo(focus: THREE.Vector3, yaw: number) {
    this.focus.copy(focus);
    this.yaw = yaw;
    this.hasLast = false;
    this.velocity.set(0, 0, 0);
    const cp = Math.cos(this.pitch);
    this.camera.position.copy(focus).add(this.offset.set(Math.sin(yaw) * cp, Math.sin(this.pitch) + 0.15, Math.cos(yaw) * cp).multiplyScalar(this.dist));
  }

  /** 0..1; shake grows with trauma squared and decays on its own. */
  addTrauma(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  kickFov(degrees: number) {
    this.fovKick = Math.max(this.fovKick, degrees);
  }

  update(dt: number, s: CameraSubject) {
    this.t += dt;
    if (dt > 0 && this.hasLast) {
      const v = this.offset.copy(s.pelvis).sub(this.lastPelvis).multiplyScalar(1 / dt);
      if (v.lengthSq() < 400) this.velocity.lerp(v, 1 - Math.exp(-dt * 6));
    }
    this.lastPelvis.copy(s.pelvis);
    this.hasLast = true;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);

    // focus with a little look-ahead in the direction of travel
    const ahead = Math.min(0.6, speed * 0.16);
    const lx = speed > 0.05 ? (this.velocity.x / speed) * ahead : 0;
    const lz = speed > 0.05 ? (this.velocity.z / speed) * ahead : 0;
    this.target.set(s.pelvis.x + lx, s.pelvis.y + 0.75, s.pelvis.z + lz);
    this.focus.lerp(this.target, 1 - Math.exp(-dt * 7));

    const finishing = s.finishedFor >= 0;
    if (finishing && !this.reducedMotion) {
      // swing round to the front and drift: show off the celebrating face
      const orbit = s.yaw + Math.PI * Math.min(1, s.finishedFor / 1.8) + s.finishedFor * 0.12;
      this.yaw = lerpAngle(this.yaw, orbit, 1 - Math.exp(-dt * 2.5));
    } else {
      this.yaw = lerpAngle(this.yaw, s.yaw, 1 - Math.exp(-dt * 5.5));
    }
    let pitchTarget = 0.36 - s.pitch * 0.6;
    if (s.fallen) pitchTarget += 0.14;
    if (s.hanging) pitchTarget -= 0.14;
    if (finishing) pitchTarget = 0.22;
    this.pitch = THREE.MathUtils.lerp(this.pitch, pitchTarget, 1 - Math.exp(-dt * 5));

    let distTarget = BASE_DIST + Math.min(0.75, speed * 0.2);
    if (s.fallen) distTarget += 0.6;
    if (s.hanging) distTarget += 0.5;
    if (finishing) distTarget = 4.4;
    this.dist = THREE.MathUtils.lerp(this.dist, distTarget, 1 - Math.exp(-dt * 2.5));

    const cp = Math.cos(this.pitch);
    this.offset.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch) + 0.15, Math.cos(this.yaw) * cp);
    // obstruction: pull in quickly, release slowly
    this.desired.copy(this.focus).addScaledVector(this.offset, this.dist);
    const hit = this.probe(this.focus, this.desired);
    const allowed = hit == null ? this.dist : Math.max(1.3, hit - 0.35);
    const rate = allowed < this.clearDist ? 18 : 2.5;
    this.clearDist = THREE.MathUtils.lerp(this.clearDist, allowed, 1 - Math.exp(-dt * rate));
    const d = Math.min(this.dist, this.clearDist);
    this.desired.copy(this.focus).addScaledVector(this.offset, d);
    if (this.desired.y < this.waterLevel + 0.4) this.desired.y = this.waterLevel + 0.4;
    this.camera.position.lerp(this.desired, 1 - Math.exp(-dt * 9));

    this.look.copy(this.focus).add(this.offset.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).multiplyScalar(finishing ? 0 : 1.2));
    this.look.y += 0.2 - s.pitch * 0.8;
    this.camera.lookAt(this.look);

    // shake: smooth noise on rotation, scaled by trauma²
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    const shake = this.reducedMotion ? 0 : this.trauma * this.trauma;
    if (shake > 0.0005) {
      const n = (f: number, p: number) => Math.sin(this.t * f + p) * 0.6 + Math.sin(this.t * f * 1.7 + p * 2.3) * 0.4;
      this.camera.rotateX(n(31, 1.3) * 0.035 * shake);
      this.camera.rotateY(n(27, 4.1) * 0.035 * shake);
      this.camera.rotateZ(n(23, 2.7) * 0.05 * shake);
    }
    this.fovKick = Math.max(0, this.fovKick - dt * 9);
    const fov = BASE_FOV + (this.reducedMotion ? 0 : this.fovKick) + Math.min(3, speed * 0.6);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, fov, 1 - Math.exp(-dt * 10));
      this.camera.updateProjectionMatrix();
    }
  }
}
