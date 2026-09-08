import { emptyInput, type Role, type RoleInput } from "./types";

const ALL_ROLES = new Set<Role>(["arms", "torso", "legs", "lhand", "rhand", "lleg", "rleg", "head"]);
const axis = (value: number) => Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
const lookX = (value: number) => Number.isFinite(value) ? value : 0;

function safeInput(input: RoleInput): RoleInput {
  return {
    f: axis(input.f),
    s: axis(input.s),
    a: input.a === true,
    b: input.b === true,
    q: input.q === true,
    e: input.e === true,
    lx: lookX(input.lx),
    ly: axis(input.ly),
  };
}

export interface RemoteInputRow {
  identity: string;
  teamId: number;
  roles: readonly string[];
  inputs: readonly RoleInput[];
  /** Server receipt time. Omit while interoperating with an older schema. */
  updatedAtMs?: number;
}

/** A remote update is a complete state description, never a patch. */
export function replaceRemoteInputs(next: Partial<Record<Role, RoleInput>>): Partial<Record<Role, RoleInput>> {
  return { ...next };
}

export function neutralInputsForRoles(roles: readonly Role[]): Partial<Record<Role, RoleInput>> {
  const neutral: Partial<Record<Role, RoleInput>> = {};
  for (const role of roles) neutral[role] = emptyInput();
  return neutral;
}

export function collectRemoteInputs(
  rows: Iterable<RemoteInputRow>,
  options: { teamId: number; ownIdentity: string; nowMs: number; leaseMs: number },
): Partial<Record<Role, RoleInput>> {
  const merged: Partial<Record<Role, RoleInput>> = {};
  for (const row of rows) {
    if (row.teamId !== options.teamId || row.identity === options.ownIdentity) continue;
    if (row.updatedAtMs != null && options.nowMs - row.updatedAtMs > options.leaseMs) continue;
    row.roles.forEach((rawRole, index) => {
      const role = rawRole as Role;
      const input = row.inputs[index];
      if (input && ALL_ROLES.has(role)) merged[role] = safeInput(input);
    });
  }
  return merged;
}
