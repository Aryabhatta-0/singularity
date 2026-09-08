import { emptyInput, type Role, type RoleInput } from "./types";

export type VirtualAction = "a" | "b" | "q" | "e";

/**
 * Solo practice drives the whole body alone with separated bindings — every
 * verb has its own key, nothing is stacked on one button:
 * - WASD: legs (walk/strafe), Space: jump
 * - Arrows: arms (raise/lower/swing), E: both-hands grab, Q/R: single-hand grab
 * - Shift: throw, C: crouch, B: brace/get up, mouse: camera (only)
 * Torso lean follows leg movement as a capped assist (no key of its own).
 */
export type SoloChannel = "legs" | "arms" | "torso";
export type SoloVirtualAction = "grab" | "throw" | "left" | "right" | "jump" | "crouch" | "brace";

const clampAxis = (value: number) => (Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0);

/**
 * Wrap yaw into (-π, π]. An unwrapped accumulator drifts unbounded within
 * a couple of camera turns. Consumers already tolerate wrapping
 * (angleWrap/lerpAngle), so this is safe for every reader.
 */
const wrapYaw = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  let y = value;
  while (y > Math.PI) y -= Math.PI * 2;
  while (y <= -Math.PI) y += Math.PI * 2;
  return y;
};

/** Keyboard + mouse + virtual controls → per-role inputs. */
export class InputManager {
  keys = new Set<string>();
  yaw = 0;
  pitch = 0;
  private virtualForward = 0;
  private virtualSide = 0;
  private virtualActions: Record<VirtualAction, boolean> = { a: false, b: false, q: false, e: false };
  private soloVirtualLegs = { f: 0, s: 0 };
  private soloVirtualArms = { f: 0, s: 0 };
  private soloVirtual: Record<SoloVirtualAction, boolean> = {
    grab: false,
    throw: false,
    left: false,
    right: false,
    jump: false,
    crouch: false,
    brace: false,
  };
  private canvas: HTMLElement | null = null;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  onRoleSwitch: ((dir: number | "index", idx?: number) => void) | null = null;
  enabled = true;

  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable)) return;
    if (t?.tagName === "BUTTON" && ["Tab", "Space", "Enter"].includes(e.code)) return;
    if (e.code === "Tab") {
      e.preventDefault();
      this.onRoleSwitch?.(e.shiftKey ? -1 : 1);
      return;
    }
    if (/^Digit[1-5]$/.test(e.code)) {
      this.onRoleSwitch?.("index", Number(e.code.slice(5)) - 1);
      return;
    }
    if (["Space", "ShiftLeft", "ShiftRight", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    this.keys.add(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
  private onBlur = () => {
    this.keys.clear();
    this.dragging = false;
    this.resetVirtualControls();
  };
  private onMouseMove = (e: MouseEvent) => {
    if (!this.enabled) return;
    const locked = document.pointerLockElement === this.canvas;
    if (locked) {
      this.yaw = wrapYaw(this.yaw - e.movementX * 0.0032);
      this.pitch -= e.movementY * 0.0022;
    } else if (this.dragging) {
      this.yaw = wrapYaw(this.yaw - (e.clientX - this.lastX) * 0.006);
      this.pitch -= (e.clientY - this.lastY) * 0.004;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    }
    this.pitch = Math.max(-0.9, Math.min(0.7, this.pitch));
  };
  private onMouseDown = (e: MouseEvent) => {
    if (e.target !== this.canvas) return;
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };
  private onMouseUp = () => {
    this.dragging = false;
  };

  attach(canvas: HTMLElement) {
    this.canvas = canvas;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
  }

  detach() {
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", this.onKeyDown);
      window.removeEventListener("keyup", this.onKeyUp);
      window.removeEventListener("blur", this.onBlur);
      window.removeEventListener("mousemove", this.onMouseMove);
      window.removeEventListener("mousedown", this.onMouseDown);
      window.removeEventListener("mouseup", this.onMouseUp);
    }
    this.keys.clear();
    this.dragging = false;
    this.resetVirtualControls();
    this.canvas = null;
  }

  requestPointerLock() {
    this.canvas?.requestPointerLock?.();
  }

  setVirtualMovement(forward: number, side: number) {
    this.virtualForward = clampAxis(forward);
    this.virtualSide = clampAxis(side);
  }

  setVirtualAction(action: VirtualAction, pressed: boolean) {
    this.virtualActions[action] = pressed;
  }

  resetVirtualControls() {
    this.virtualForward = 0;
    this.virtualSide = 0;
    this.virtualActions.a = false;
    this.virtualActions.b = false;
    this.virtualActions.q = false;
    this.virtualActions.e = false;
    this.soloVirtualLegs.f = 0;
    this.soloVirtualLegs.s = 0;
    this.soloVirtualArms.f = 0;
    this.soloVirtualArms.s = 0;
    for (const key of Object.keys(this.soloVirtual) as SoloVirtualAction[]) this.soloVirtual[key] = false;
  }

  /** Touch joystick for the solo legs channel (left stick). */
  setSoloVirtualLegs(forward: number, side: number) {
    this.soloVirtualLegs.f = clampAxis(forward);
    this.soloVirtualLegs.s = clampAxis(side);
  }

  /** Touch joystick for the solo arms channel (right stick). */
  setSoloVirtualArms(forward: number, side: number) {
    this.soloVirtualArms.f = clampAxis(forward);
    this.soloVirtualArms.s = clampAxis(side);
  }

  /** Touch buttons for solo verbs — one button per function, never stacked. */
  setSoloVirtualAction(action: SoloVirtualAction, pressed: boolean) {
    this.soloVirtual[action] = pressed;
  }

  private down(...codes: string[]) {
    return codes.some((c) => this.keys.has(c));
  }

  private movement() {
    const keyboardForward = (this.down("KeyW", "ArrowUp") ? 1 : 0) - (this.down("KeyS", "ArrowDown") ? 1 : 0);
    const keyboardSide = (this.down("KeyD", "ArrowRight") ? 1 : 0) - (this.down("KeyA", "ArrowLeft") ? 1 : 0);
    return {
      forward: clampAxis(keyboardForward + this.virtualForward),
      side: clampAxis(keyboardSide + this.virtualSide),
    };
  }

  private action(action: VirtualAction, ...codes: string[]) {
    return this.virtualActions[action] || this.down(...codes);
  }

  /** Update head yaw/pitch from keyboard or virtual movement (called each frame). */
  tickHead(dt: number, keysActive: boolean) {
    if (!keysActive) return;
    const { forward, side } = this.movement();
    this.yaw = wrapYaw(this.yaw - side * dt * 2.2);
    this.pitch = Math.max(-0.9, Math.min(0.7, this.pitch + forward * dt * 1.4));
  }

  read(role: Role, keysActive: boolean): RoleInput {
    const i = emptyInput();
    // Always wrap before publishing: the server hard-rejects |lx| > 2π.
    i.lx = wrapYaw(this.yaw);
    i.ly = this.pitch;
    if (!keysActive || !this.enabled) return i;
    if (role === "head") {
      i.a = this.action("a", "Space");
      return i;
    }
    const movement = this.movement();
    i.f = movement.forward;
    i.s = movement.side;
    i.a = this.action("a", "Space");
    i.b = this.action("b", "ShiftLeft", "ShiftRight");
    i.q = this.action("q", "KeyQ");
    i.e = this.action("e", "KeyE");
    return i;
  }

  /**
   * Separated solo read: legs / arms / torso each get their own bindings so
   * one player can walk, aim their arms, and work the torso at the same time.
   * Torso lean follows leg movement (documented assist, not a stacked button).
   * Camera stays mouse-only — keyboard never turns it in solo.
   */
  readSolo(): Record<SoloChannel, RoleInput> {
    const lx = wrapYaw(this.yaw);
    const ly = this.pitch;
    const base = (): RoleInput => ({ ...emptyInput(), lx, ly });
    const legs = base();
    const arms = base();
    const torso = base();
    if (this.enabled) {
      const legF = clampAxis(
        (this.down("KeyW") ? 1 : 0) - (this.down("KeyS") ? 1 : 0) + this.soloVirtualLegs.f
      );
      const legS = clampAxis(
        (this.down("KeyD") ? 1 : 0) - (this.down("KeyA") ? 1 : 0) + this.soloVirtualLegs.s
      );
      legs.f = legF;
      legs.s = legS;
      legs.a = this.soloVirtual.jump || this.down("Space");

      arms.f = clampAxis(
        (this.down("ArrowUp") ? 1 : 0) - (this.down("ArrowDown") ? 1 : 0) + this.soloVirtualArms.f
      );
      arms.s = clampAxis(
        (this.down("ArrowRight") ? 1 : 0) - (this.down("ArrowLeft") ? 1 : 0) + this.soloVirtualArms.s
      );
      arms.a = this.soloVirtual.grab || this.down("KeyE");
      arms.b = this.soloVirtual.throw || this.down("ShiftLeft", "ShiftRight");
      arms.q = this.soloVirtual.left || this.down("KeyQ");
      arms.e = this.soloVirtual.right || this.down("KeyR");

      // Torso leans gently with the stride (capped assist — full constant lean
      // while carrying tips the body over); magnitude-capped so diagonal
      // strafing leans no harder than straight walking. Crouch and brace
      // stay manual. Hold B (brace) to stiffen under heavy carries.
      {
        const mag = Math.hypot(legF, legS);
        const lean = mag > 1e-6 ? (0.45 * Math.min(1, mag)) / mag : 0;
        torso.f = clampAxis(legF * lean);
        torso.s = clampAxis(legS * lean);
      }
      torso.a = this.soloVirtual.brace || this.down("KeyB");
      torso.b = this.soloVirtual.crouch || this.down("KeyC");
    }
    return { legs, arms, torso };
  }
}

export function inputsEqual(a: RoleInput, b: RoleInput) {
  return a.f === b.f && a.s === b.s && a.a === b.a && a.b === b.b && a.q === b.q && a.e === b.e && Math.abs(a.lx - b.lx) < 0.002 && Math.abs(a.ly - b.ly) < 0.002;
}
