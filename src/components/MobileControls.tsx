"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { InputManager, SoloVirtualAction, VirtualAction } from "@/game/input";
import { floatingJoystickOrigin, normalizeJoystickDisplacement } from "@/game/joystick";
import { ROLE_INFO, type Role } from "@/game/types";
import { RoleIcon } from "@/components/icons";

const STICK_TRAVEL = 28;
const STICK_DEAD_ZONE = 0.14;

interface MobileAction {
  action: VirtualAction;
  label: string;
  glyph: string;
  primary?: boolean;
  /** Solo verb — when set, the button drives its own solo channel. */
  solo?: SoloVirtualAction;
}

const ACTIONS: Record<Role, MobileAction[]> = {
  head: [{ action: "a", label: "Action", glyph: "●", primary: true }],
  arms: [
    { action: "q", label: "Left", glyph: "L" },
    { action: "a", label: "Grab", glyph: "●", primary: true },
    { action: "b", label: "Throw", glyph: "↗" },
    { action: "e", label: "Right", glyph: "R" },
  ],  legs: [{ action: "a", label: "Jump", glyph: "↑", primary: true }],
  lhand: [
    { action: "q", label: "Grab", glyph: "◉", primary: true },
    { action: "a", label: "2-hand", glyph: "●" },
    { action: "b", label: "Throw", glyph: "↗" },
  ],
  rhand: [
    { action: "e", label: "Grab", glyph: "◉", primary: true },
    { action: "a", label: "2-hand", glyph: "●" },
    { action: "b", label: "Throw", glyph: "↗" },
  ],
  torso: [
    { action: "a", label: "Brace", glyph: "◆", primary: true },
    { action: "b", label: "Crouch", glyph: "↓" },
    { action: "q", label: "Call", glyph: "!" },
  ],
  lleg: [{ action: "a", label: "Step", glyph: "↑", primary: true }],
  rleg: [{ action: "a", label: "Step", glyph: "↑", primary: true }],
};

/**
 * Solo practice drives the whole body at once, so the touch pad exposes one
 * button per verb on its own channel — never stacked on a single button.
 */
export const SOLO_ACTIONS: MobileAction[] = [
  { action: "q", solo: "left", label: "Left", glyph: "L" },
  { action: "a", solo: "grab", label: "Grab", glyph: "●", primary: true },
  { action: "b", solo: "throw", label: "Throw", glyph: "↗" },
  { action: "e", solo: "right", label: "Right", glyph: "R" },
  { action: "a", solo: "jump", label: "Jump", glyph: "↑" },
  { action: "b", solo: "crouch", label: "Crouch", glyph: "↓" },
  { action: "a", solo: "brace", label: "Brace", glyph: "◆" },
];

interface ActionButtonProps {
  inputRef: RefObject<InputManager | null>;
  spec: MobileAction;
  disabled: boolean;
  onFirstInteraction: () => void;
}

function ActionButton({ inputRef, spec, disabled, onFirstInteraction }: ActionButtonProps) {
  const activePointers = useRef(new Set<number>());
  const keyboardPressed = useRef(false);
  const [pressed, setPressed] = useState(false);

  const write = useCallback(
    (value: boolean) => {
      if (spec.solo) inputRef.current?.setSoloVirtualAction(spec.solo, value);
      else inputRef.current?.setVirtualAction(spec.action, value);
    },
    [inputRef, spec.action, spec.solo],
  );

  const release = useCallback(
    (pointerId?: number) => {
      if (pointerId == null) {
        activePointers.current.clear();
        keyboardPressed.current = false;
      }
      else activePointers.current.delete(pointerId);
      const stillPressed = keyboardPressed.current || activePointers.current.size > 0;
      setPressed(stillPressed);
      write(stillPressed);
    },
    [write],
  );

  useEffect(() => {
    if (disabled) release();
  }, [disabled, release]);

  useEffect(() => {
    const pointers = activePointers.current;
    const input = inputRef.current;
    const cancel = () => release();
    const onVisibility = () => {
      if (document.visibilityState !== "visible") cancel();
    };
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", onVisibility);
      pointers.clear();
      keyboardPressed.current = false;
      if (spec.solo) input?.setSoloVirtualAction(spec.solo, false);
      else input?.setVirtualAction(spec.action, false);
    };
  }, [inputRef, release, spec.action, spec.solo]);

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    onFirstInteraction();
    activePointers.current.add(event.pointerId);
    event.currentTarget.setPointerCapture(event.pointerId);
    setPressed(true);
    write(true);
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    release(event.pointerId);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled || (event.key !== " " && event.key !== "Enter")) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    onFirstInteraction();
    keyboardPressed.current = true;
    setPressed(true);
    write(true);
  };

  const onKeyUp = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    keyboardPressed.current = false;
    release(-1);
  };

  return (
    <button
      type="button"
      aria-label={spec.label}
      aria-pressed={pressed}
      disabled={disabled}
      className={`mobile-action-button ${spec.primary ? "is-primary" : ""} ${pressed ? "is-pressed" : ""}`}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={(event) => release(event.pointerId)}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={() => release()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span className="mobile-action-glyph" aria-hidden="true">
        {spec.glyph}
      </span>
      <span className="mobile-action-label">{spec.label}</span>
    </button>
  );
}

interface FloatingJoystickProps {
  inputRef: RefObject<InputManager | null>;
  disabled: boolean;
  onFirstInteraction: () => void;
  /** Solo split sticks: left half drives legs, right half drives arms. */
  half?: "left" | "right";
  onMove?: (forward: number, side: number) => void;
}

function FloatingJoystick({ inputRef, disabled, onFirstInteraction, half, onMove }: FloatingJoystickProps) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<number | null>(null);
  const originRef = useRef({ x: 0, y: 0 });
  const [active, setActive] = useState(false);
  const [base, setBase] = useState({ x: 0, y: 0 });
  const moveRef = useRef(onMove);
  useEffect(() => {
    moveRef.current = onMove;
  }, [onMove]);

  const writeMove = useCallback(
    (forward: number, side: number) => {
      if (moveRef.current) moveRef.current(forward, side);
      else inputRef.current?.setVirtualMovement(forward, side);
    },
    [inputRef],
  );

  const reset = useCallback(
    (pointerId?: number) => {
      if (pointerId != null && pointerRef.current !== pointerId) return;
      pointerRef.current = null;
      setActive(false);
      if (knobRef.current) knobRef.current.style.transform = "translate3d(0, 0, 0)";
      writeMove(0, 0);
    },
    [writeMove],
  );

  const update = useCallback(
    (clientX: number, clientY: number) => {
      const dx = clientX - originRef.current.x;
      const dy = clientY - originRef.current.y;
      const movement = normalizeJoystickDisplacement(dx, dy, STICK_TRAVEL, STICK_DEAD_ZONE);
      if (knobRef.current) knobRef.current.style.transform = `translate3d(${movement.knobX}px, ${movement.knobY}px, 0)`;
      writeMove(movement.forward, movement.side);
    },
    [writeMove],
  );

  useEffect(() => {
    if (disabled) reset();
  }, [disabled, reset]);

  useEffect(() => {
    const cancel = () => reset();
    const onVisibility = () => {
      if (document.visibilityState !== "visible") cancel();
    };
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", onVisibility);
      writeMove(0, 0);
    };
  }, [reset, writeMove]);

  useEffect(() => {
    const isInteractiveTarget = (target: EventTarget | null) =>
      target instanceof Element &&
      target.closest("button, a, input, select, textarea, dialog, [role='button'], [data-joystick-ignore]") != null;

    const onPointerDown = (event: PointerEvent) => {
      if (disabled || pointerRef.current != null || event.button !== 0 || isInteractiveTarget(event.target)) return;
      const zone = zoneRef.current;
      if (!zone) return;

      const rect = zone.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;

      if (event.cancelable) event.preventDefault();
      onFirstInteraction();

      const origin = floatingJoystickOrigin(event.clientX, event.clientY, rect.left, rect.top);

      pointerRef.current = event.pointerId;
      originRef.current = { x: event.clientX, y: event.clientY };
      setBase(origin);
      setActive(true);
      update(event.clientX, event.clientY);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (pointerRef.current !== event.pointerId) return;
      if (event.cancelable) event.preventDefault();
      update(event.clientX, event.clientY);
    };

    const onPointerEnd = (event: PointerEvent) => {
      if (pointerRef.current !== event.pointerId) return;
      if (event.cancelable) event.preventDefault();
      reset(event.pointerId);
    };

    window.addEventListener("pointerdown", onPointerDown, { capture: true, passive: false });
    window.addEventListener("pointermove", onPointerMove, { capture: true, passive: false });
    window.addEventListener("pointerup", onPointerEnd, { capture: true, passive: false });
    window.addEventListener("pointercancel", onPointerEnd, { capture: true, passive: false });
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerEnd, true);
      window.removeEventListener("pointercancel", onPointerEnd, true);
    };
  }, [disabled, onFirstInteraction, reset, update]);

  return (
    <div
      ref={zoneRef}
      className="mobile-joystick-zone"
      aria-label={half === "right" ? "Arms joystick" : half === "left" ? "Legs joystick" : "Movement joystick"}
      style={
        half === "left"
          ? { inset: 0, right: "50%" }
          : half === "right"
            ? { inset: 0, left: "50%" }
            : undefined
      }
    >
      {active && (
        <div className="mobile-joystick-base is-active" style={{ left: base.x, top: base.y }} aria-hidden="true">
          <span className="mobile-joystick-direction is-up">▲</span>
          <span className="mobile-joystick-direction is-right">▶</span>
          <span className="mobile-joystick-direction is-down">▼</span>
          <span className="mobile-joystick-direction is-left">◀</span>
          <div ref={knobRef} className="mobile-joystick-knob" />
        </div>
      )}
    </div>
  );
}

interface MobileControlsProps {
  inputRef: RefObject<InputManager | null>;
  role: Role;
  roles: Role[];
  activeRole: number;
  teamColor: string;
  disabled?: boolean;
  solo?: boolean;
  onRoleSelect: (index: number) => void;
  onFirstInteraction: () => void;
}

export default function MobileControls({
  inputRef,
  role,
  roles,
  activeRole,
  teamColor,
  disabled = false,
  solo = false,
  onRoleSelect,
  onFirstInteraction,
}: MobileControlsProps) {
  const actions = useMemo(() => (solo ? SOLO_ACTIONS : ACTIONS[role]), [role, solo]);
  const style = { "--mobile-team": teamColor } as CSSProperties;

  useEffect(() => {
    inputRef.current?.resetVirtualControls();
  }, [disabled, inputRef, role, solo]);

  useEffect(() => {
    const input = inputRef.current;
    return () => input?.resetVirtualControls();
  }, [inputRef]);

  return (
    <div className="mobile-game-controls" style={style} aria-label="Touch controls" data-testid={solo ? "solo-touch-controls" : undefined}>
      {solo ? (
        <>
          <FloatingJoystick
            inputRef={inputRef}
            disabled={disabled}
            onFirstInteraction={onFirstInteraction}
            half="left"
            onMove={(forward, side) => inputRef.current?.setSoloVirtualLegs(forward, side)}
          />
          <FloatingJoystick
            inputRef={inputRef}
            disabled={disabled}
            onFirstInteraction={onFirstInteraction}
            half="right"
            onMove={(forward, side) => inputRef.current?.setSoloVirtualArms(forward, side)}
          />
        </>
      ) : (
        <FloatingJoystick inputRef={inputRef} disabled={disabled} onFirstInteraction={onFirstInteraction} />
      )}

      <div className="mobile-role-switcher" role="group" aria-label="Body part" data-joystick-ignore>
        <div className="mobile-current-role">
          <RoleIcon role={role} className="h-4 w-4" />
          <span>{solo ? "WHOLE BODY" : ROLE_INFO[role].short}</span>
        </div>
        {!solo && roles.length > 1 && (
          <div className="mobile-role-options">
            {roles.map((item, index) => (
              <button
                key={item}
                type="button"
                aria-label={`Control ${ROLE_INFO[item].label}`}
                aria-pressed={index === activeRole}
                title={ROLE_INFO[item].label}
                className={index === activeRole ? "is-active" : ""}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onFirstInteraction();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onRoleSelect(index);
                }}
              >
                <RoleIcon role={item} className="h-5 w-5" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        className="mobile-action-cluster"
        role="group"
        aria-label={solo ? "Whole body actions" : `${ROLE_INFO[role].short} actions`}
        style={{ gridTemplateColumns: actions.length === 1 ? "4.5rem" : "repeat(2, 4rem)" }}
      >
        {actions.map((spec) => (
          <ActionButton key={spec.solo ?? spec.action} inputRef={inputRef} spec={spec} disabled={disabled} onFirstInteraction={onFirstInteraction} />
        ))}
      </div>
    </div>
  );
}
