"use client";

import type { Role, RoleInput } from "@/game/types";
import { ROLE_INFO } from "@/game/types";
import { RoleIcon } from "@/components/icons";

/**
 * Progressive first-run coaching: one concept at a time, for the limb this
 * player actually owns. A step completes when the player does it, not when
 * they read it. Finished roles are remembered locally and never shown again.
 */

type Payload = Partial<Record<Role, RoleInput>>;

export interface CoachStep {
  key: string;
  touch: string;
  text: string;
  done: (p: Payload) => boolean;
}

const moved = (i?: RoleInput) => !!i && (Math.abs(i.f) > 0.3 || Math.abs(i.s) > 0.3);
const vertical = (i?: RoleInput) => !!i && Math.abs(i.f) > 0.3;

export const COACH: Partial<Record<Role | "solo", { intro: string; steps: CoachStep[] }>> = {
  lleg: {
    intro: "You are the LEFT LEG. Take turns with the Right Leg to walk.",
    steps: [
      { key: "W", touch: "Push the stick up", text: "Take a step", done: (p) => (p.lleg?.f ?? 0) > 0.3 },
      { key: "Space", touch: "Tap Step", text: "Kick. Kick with the Right Leg at the same moment to jump", done: (p) => !!p.lleg?.a },
    ],
  },
  rleg: {
    intro: "You are the RIGHT LEG. Take turns with the Left Leg to walk.",
    steps: [
      { key: "W", touch: "Push the stick up", text: "Take a step", done: (p) => (p.rleg?.f ?? 0) > 0.3 },
      { key: "Space", touch: "Tap Step", text: "Kick. Kick with the Left Leg at the same moment to jump", done: (p) => !!p.rleg?.a },
    ],
  },
  legs: {
    intro: "You are the LEGS. You set the rhythm; Torso keeps the balance.",
    steps: [
      { key: "W", touch: "Push the stick up", text: "Walk forward", done: (p) => (p.legs?.f ?? 0) > 0.3 },
      { key: "Space", touch: "Tap Jump", text: "Jump", done: (p) => !!p.legs?.a },
    ],
  },
  lhand: {
    intro: "You are the LEFT HAND. Lifting needs both hands.",
    steps: [
      { key: "W / S", touch: "Stick up and down", text: "Raise and lower the arm", done: (p) => vertical(p.lhand) },
      { key: "Q", touch: "Tap Grab", text: "Grab with your hand", done: (p) => !!p.lhand?.q },
      { key: "Space", touch: "Hold 2-hand", text: "Two-hand grab, together with Right Hand", done: (p) => !!p.lhand?.a },
    ],
  },
  rhand: {
    intro: "You are the RIGHT HAND. Lifting needs both hands.",
    steps: [
      { key: "W / S", touch: "Stick up and down", text: "Raise and lower the arm", done: (p) => vertical(p.rhand) },
      { key: "E", touch: "Tap Grab", text: "Grab with your hand", done: (p) => !!p.rhand?.e },
      { key: "Space", touch: "Hold 2-hand", text: "Two-hand grab, together with Left Hand", done: (p) => !!p.rhand?.a },
    ],
  },
  arms: {
    intro: "You are the ARMS. Reach, grab, carry, climb and throw.",
    steps: [
      { key: "W / S", touch: "Stick up and down", text: "Raise and lower both arms", done: (p) => vertical(p.arms) },
      { key: "Space", touch: "Hold Grab", text: "Grab with both hands", done: (p) => !!p.arms?.a },
      { key: "Shift", touch: "Tap Throw", text: "Throw what you hold", done: (p) => !!p.arms?.b },
    ],
  },
  torso: {
    intro: "You are the TORSO. Balance the body and steer the camera.",
    steps: [
      { key: "W A S D", touch: "Move the stick", text: "Lean the body", done: (p) => moved(p.torso) },
      { key: "Shift", touch: "Hold Crouch", text: "Crouch low", done: (p) => !!p.torso?.b },
      { key: "Space", touch: "Hold Brace", text: "Brace. Hold it to stand back up after a fall", done: (p) => !!p.torso?.a },
    ],
  },
  solo: {
    intro: "The whole body is yours. One thing at a time.",
    steps: [
      { key: "W A S D", touch: "Left stick", text: "Walk", done: (p) => moved(p.legs) },
      { key: "↑ ↓", touch: "Right stick", text: "Raise the arms", done: (p) => vertical(p.arms) },
      { key: "E", touch: "Hold Grab", text: "Grab with both hands", done: (p) => !!p.arms?.a },
      { key: "Space", touch: "Tap Jump", text: "Jump", done: (p) => !!p.legs?.a },
    ],
  },
};

export function coachFor(role: Role | null, solo: boolean) {
  return solo ? COACH.solo : role ? COACH[role] : undefined;
}

export function RoleCoach({
  role,
  solo,
  step,
  touch,
  color,
  onSkip,
}: {
  role: Role | null;
  solo: boolean;
  step: number;
  touch: boolean;
  color: string;
  onSkip: () => void;
}) {
  const plan = coachFor(role, solo);
  if (!plan) return null;
  const current = plan.steps[step];
  if (!current) return null;
  return (
    <div className="coach" style={{ "--team": color } as React.CSSProperties} role="region" aria-label="Controls coach">
      <div className="coach-head">
        <span className="coach-icon" aria-hidden="true">
          {solo ? "★" : role ? <RoleIcon role={role} className="h-5 w-5" /> : null}
        </span>
        <span className="coach-intro">{step === 0 ? plan.intro : solo ? "Whole body" : ROLE_INFO[role!].label}</span>
        <button type="button" className="coach-skip" onClick={onSkip} aria-label="Hide the controls coach">
          Got it
        </button>
      </div>
      <div className="coach-step" key={step} aria-live="polite">
        <kbd className="coach-key">{touch ? current.touch : current.key}</kbd>
        <span className="coach-text">{current.text}</span>
      </div>
      <div className="coach-pips" aria-hidden="true">
        {plan.steps.map((s, i) => (
          <span key={s.text} className={i < step ? "is-done" : i === step ? "is-now" : ""} />
        ))}
      </div>
    </div>
  );
}
