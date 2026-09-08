import { ROLES_3, emptyInput, type PhysRole, type Role, type RoleInput, type SquadSize } from "./types";
import type { BodyInputs } from "./body";

export interface SquadMixState {
  legT: number;
}

/** fresh per-run mixer state (3P auto-alternate legs) */
export const makeSquadMixState = (): SquadMixState => ({ legT: 0 });

/**
 * Solo practice controls the whole body alone — no squad-size choice, no
 * body-part picking. Solo is locked to the 3-role layout (merged arms +
 * auto-alternating legs) because identical inputs on split 5P legs produce no
 * stride (both legs lift together and cancel propulsion).
 */
export const SOLO_SQUAD: SquadSize = 3;
export const SOLO_ROLES: readonly Role[] = ROLES_3;

/** Broadcast one physical input (keyboard/mouse/touch) to every solo channel. */
export function buildSoloPayload(base: RoleInput): Partial<Record<Role, RoleInput>> {
  return {
    arms: { ...base },
    torso: { ...base },
    legs: { ...base },
  };
}

/**
 * Separated solo payload: legs / arms / torso each carry their own bindings
 * (see InputManager.readSolo) so walking, aiming arms, and crouch/brace never
 * fight over one button. Torso lean arrives pre-mixed from the read.
 */
export function buildSoloSeparatedPayload(channels: {
  legs: RoleInput;
  arms: RoleInput;
  torso: RoleInput;
}): Partial<Record<Role, RoleInput>> {
  return {
    legs: { ...channels.legs },
    arms: { ...channels.arms },
    torso: { ...channels.torso },
  };
}

const get = (ext: Partial<Record<Role, RoleInput>>, r: Role): RoleInput => ext[r] ?? emptyInput();

/**
 * Merge squad-sized player inputs into the 5 internal physics channels.
 * - Camera/heading always follows Torso's mouse (legacy Head falls back).
 * - 5P hands: raise/swing average (must move together), two-hand grab + throw
 *   require BOTH players (Space / Shift), Q/E grab a single hand alone.
 * - 3P legs: hold a direction to auto-alternate steps; Space jumps.
 */
export function resolvePhysInputs(
  ext: Partial<Record<Role, RoleInput>>,
  squad: SquadSize,
  dt: number,
  st: SquadMixState
): BodyInputs {
  const torso = get(ext, "torso");
  const headLeg = get(ext, "head");
  const yaw = ext.torso?.lx ?? headLeg.lx ?? 0;
  const pitch = ext.torso?.ly ?? headLeg.ly ?? 0;

  const head: RoleInput = { ...emptyInput(), lx: yaw, ly: pitch, a: torso.q || headLeg.a };

  let arms: RoleInput;
  if (squad === 3) {
    arms = { ...get(ext, "arms"), lx: yaw, ly: pitch };
  } else {
    const l = ext.lhand;
    const r = ext.rhand;
    if (!l && !r) {
      // solo / legacy fallback: shared arms role drives both hands
      arms = { ...get(ext, "arms"), lx: yaw, ly: pitch };
    } else {
      const lf = l?.f ?? 0;
      const rf = r?.f ?? 0;
      const ls = l?.s ?? 0;
      const rs = r?.s ?? 0;
      arms = {
        f: (lf + rf) / 2,
        s: (ls + rs) / 2,
        a: Boolean(l?.a && r?.a),
        b: Boolean(l?.b && r?.b),
        q: Boolean(l?.q),
        e: Boolean(r?.e),
        lx: yaw,
        ly: pitch,
      };
    }
  }

  let lleg: RoleInput;
  let rleg: RoleInput;
  if (squad === 3) {
    const legs = ext.legs ?? (ext.lleg ?? ext.rleg);
    if (!legs || (Math.abs(legs.f) < 0.2 && Math.abs(legs.s) < 0.2)) {
      lleg = { ...emptyInput(), lx: yaw, ly: pitch, a: Boolean(legs?.a) };
      rleg = { ...emptyInput(), lx: yaw, ly: pitch, a: Boolean(legs?.a) };
    } else {
      st.legT += dt;
      const phase = Math.floor(st.legT / 0.3) % 2;
      const active: RoleInput = { ...legs, lx: yaw, ly: pitch };
      const idle: RoleInput = { ...emptyInput(), lx: yaw, ly: pitch, a: legs.a };
      lleg = phase === 0 ? active : idle;
      rleg = phase === 1 ? active : idle;
      lleg.a = Boolean(legs.a);
      rleg.a = Boolean(legs.a);
    }
  } else {
    lleg = { ...get(ext, "lleg"), lx: yaw, ly: pitch };
    rleg = { ...get(ext, "rleg"), lx: yaw, ly: pitch };
    if (ext.legs && !ext.lleg && !ext.rleg) {
      lleg = { ...ext.legs, lx: yaw, ly: pitch };
      rleg = { ...ext.legs, lx: yaw, ly: pitch };
    }
  }

  const out: BodyInputs = { head, arms, torso: { ...torso, lx: yaw, ly: pitch }, lleg, rleg };
  return out as Record<PhysRole, RoleInput> as BodyInputs;
}
