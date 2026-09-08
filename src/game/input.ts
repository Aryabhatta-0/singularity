import { emptyInput, type Role, type RoleInput } from "./types";

export type VirtualAction = "a" | "b" | "q" | "e";

const clampAxis = (value: number) => (Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0);

/**
 * Wrap yaw into (-π, π]. The server rejects `sendInput` outright when |lx|
 * exceeds 2π, and an unwrapped accumulator silently crosses that ceiling
 * within a couple of camera turns — which permanently kills every input the
 * drifting player sends until their row is swept. Consumers already tolerate
 * wrapping (angleWrap/lerpAngle), so this is safe for every reader.
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
}

export function inputsEqual(a: RoleInput, b: RoleInput) {
  return a.f === b.f && a.s === b.s && a.a === b.a && a.b === b.b && a.q === b.q && a.e === b.e && Math.abs(a.lx - b.lx) < 0.002 && Math.abs(a.ly - b.ly) < 0.002;
}
