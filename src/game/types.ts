export const PHYS_ROLES = ["head", "arms", "torso", "lleg", "rleg"] as const;
export type PhysRole = (typeof PHYS_ROLES)[number];

// Squad roles players actually pick. 3-player: arms+torso+legs. 5-player: split hands + split legs.
export const ROLES_3 = ["arms", "torso", "legs"] as const;
export const ROLES_5 = ["lhand", "rhand", "torso", "lleg", "rleg"] as const;
export type SquadSize = 3 | 5;
// Union of every assignable role (legacy head kept for old rooms).
export const ROLES = ["arms", "torso", "legs", "lhand", "rhand", "lleg", "rleg", "head"] as const;
export type Role = (typeof ROLES)[number];

export function squadRoles(squad: SquadSize): readonly Role[] {
  return squad === 3 ? ROLES_3 : ROLES_5;
}

export const ROLE_INFO: Record<Role, { label: string; short: string; emoji: string; blurb: string; keys: { key: string; does: string }[] }> = {
  head: {
    label: "Head & Eyes (legacy)",
    short: "HEAD",
    emoji: "👀",
    blurb: "Legacy role — pick Torso instead (Torso now steers the camera).",
    keys: [{ key: "Mouse / A D", does: "Turn head (body follows)" }],
  },
  arms: {
    label: "Arms & Hands",
    short: "ARMS",
    emoji: "🙌",
    blurb: "3-player mode: both hands together. Reach, grab, carry, climb and throw.",
    keys: [
      { key: "W S", does: "Raise / lower arms (pull up when hanging)" },
      { key: "A D", does: "Swing arms left / right" },
      { key: "Space", does: "Grab (hold) both hands" },
      { key: "Q / E", does: "Grab left / right hand" },
      { key: "Shift", does: "THROW held object" },
    ],
  },
  legs: {
    label: "Legs (both)",
    short: "LEGS",
    emoji: "🦵",
    blurb: "3-player mode: hold W to auto-alternate steps. You do the rhythm, Torso does the balance.",
    keys: [
      { key: "W / S", does: "Walk forward / back (auto-alternates)" },
      { key: "A D", does: "Side step" },
      { key: "Space", does: "JUMP" },
    ],
  },
  lhand: {
    label: "Left Hand",
    short: "L HAND",
    emoji: "🤚",
    blurb: "Own the left hand. BOTH hands must hold Space to two-hand grab; Q grabs left alone.",
    keys: [
      { key: "W S", does: "Raise / lower (averages with right hand)" },
      { key: "A D", does: "Swing (averages with right hand)" },
      { key: "Space", does: "Two-hand grab (needs BOTH players)" },
      { key: "Q", does: "Grab left hand alone" },
      { key: "Shift", does: "THROW (needs BOTH players)" },
    ],
  },
  rhand: {
    label: "Right Hand",
    short: "R HAND",
    emoji: "✋",
    blurb: "Own the right hand. BOTH hands must hold Space to two-hand grab; E grabs right alone.",
    keys: [
      { key: "W S", does: "Raise / lower (averages with right hand)" },
      { key: "A D", does: "Swing (averages with right hand)" },
      { key: "Space", does: "Two-hand grab (needs BOTH players)" },
      { key: "E", does: "Grab right hand alone" },
      { key: "Shift", does: "THROW (needs BOTH players)" },
    ],
  },
  torso: {
    label: "Torso & Balance",
    short: "TORSO",
    emoji: "🧘",
    blurb: "Lean, crouch, brace. If the body falls over, you get it back up.",
    keys: [
      { key: "W S", does: "Lean forward / back" },
      { key: "A D", does: "Lean left / right" },
      { key: "Shift", does: "Crouch (reach the floor)" },
      { key: "Space", does: "Brace / GET UP" },
      { key: "Q", does: "Call out to the team" },
    ],
  },
  lleg: {
    label: "Left Leg",
    short: "L LEG",
    emoji: "🦵",
    blurb: "Take steps. Alternate with the right leg to walk. Lift both at once and... good luck.",
    keys: [
      { key: "W", does: "Step forward" },
      { key: "S", does: "Step back" },
      { key: "A D", does: "Side step" },
      { key: "Space", does: "Kick (both legs together = JUMP)" },
    ],
  },
  rleg: {
    label: "Right Leg",
    short: "R LEG",
    emoji: "🦿",
    blurb: "Take steps. Alternate with the left leg to walk. Timing is everything.",
    keys: [
      { key: "W", does: "Step forward" },
      { key: "S", does: "Step back" },
      { key: "A D", does: "Side step" },
      { key: "Space", does: "Kick (both legs together = JUMP)" },
    ],
  },
};

export interface RoleInput {
  f: number; // forward/back axis -1..1
  s: number; // side axis -1..1
  a: boolean; // space
  b: boolean; // shift
  q: boolean;
  e: boolean;
  lx: number; // head yaw (radians, absolute)
  ly: number; // head pitch (radians, absolute)
}

export const emptyInput = (): RoleInput => ({ f: 0, s: 0, a: false, b: false, q: false, e: false, lx: 0, ly: 0 });

export type Phase = "lobby" | "countdown" | "playing" | "results";

export interface PlayerInfo {
  id: string;
  name: string;
  teamId: number;
  roles: Role[];
  ready: boolean;
}

export interface TeamInfo {
  id: number;
  name: string;
  color: string;
  hostId: string | null;
  finishMs: number | null;
}

export interface RoomSnapshot {
  code: string;
  phase: Phase;
  challengeId: string;
  squadSize: SquadSize;
  players: PlayerInfo[];
  teams: TeamInfo[];
  startAt: number | null;
  round: number;
  now: number;
  leaderId: string | null;
}

export interface ChallengeMeta {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  difficulty: "easy" | "medium" | "hard" | "bonus";
}

export const CHALLENGES: ChallengeMeta[] = [
  { id: "wobble-run", name: "Wobble Run", tagline: "Easy — hurdles, moving bumpers, a skinny bridge and a co-op climb.", icon: "🏁", difficulty: "easy" },
  { id: "ferry-job", name: "Ferry Job", tagline: "Medium — grab the cargo, ride sliding ferries, don't drop it.", icon: "📦", difficulty: "medium" },
  { id: "summit-sync", name: "Summit Sync", tagline: "Hard — climb, cross sinking ferries, place the core, beat the gate.", icon: "⛰️", difficulty: "hard" },
  { id: "egg-express", name: "Egg Express", tagline: "Bonus — crouch, cross a ferry and keep the fragile egg intact.", icon: "🥚", difficulty: "bonus" },
  { id: "slam-dunk", name: "Slam Dunk", tagline: "Bonus — dodge moving defenders and throw three balls through the hoop.", icon: "🏀", difficulty: "bonus" },
];

export const TEAM_COLORS = ["#ff5d5d", "#4fa8ff", "#ffd23f", "#6ef29a", "#c58bff", "#ff9a3c"];

export function formatTime(ms: number | null | undefined): string {
  if (ms == null) return "--:--.--";
  const total = Math.max(0, Math.floor(ms));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const cs = Math.floor((total % 1000) / 10);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}
