/**
 * Singularity's visual language: one crash-test toy world.
 *
 * The landing page's crash-test lab (dummy yellow, ink outlines, hazard tape,
 * calibration targets) is the brand. The 3D courses reuse the same grammar so
 * a screenshot reads as Singularity at a glance:
 *
 * - ink outlines only on things that matter (the dummy, props, goals)
 * - hazard tape (red-orange + white stripes) means "this pushes or hurts you"
 * - yellow/ink grip tape on an edge means "hands can hold this"
 * - mint means "progress saved"; cyan target rings mean "deliver here"
 * - gold glow + a bobbing marker means "the objective: carry or throw me"
 *
 * Pure data: no Three.js imports, so tests and UI code can share it.
 */

export const INK = "#14202e";

export const PALETTE = {
  ink: INK,
  inkSoft: "#2b3a4f",
  paper: "#ffffff",
  cream: "#fff6e3",
  dummy: "#ffd21a",
  dummyDeep: "#e3a800",
  /** Used for the dummy body when the team colour is itself yellow. */
  dummyAlt: "#f4ead2",
  tape: "#ff4f2e",
  tapeDeep: "#c9361b",
  tapeLight: "#fff3ea",
  grip: "#ffd21a",
  mint: "#3fe08f",
  mintDeep: "#1e9c5c",
  cyan: "#38d9e6",
  cyanDeep: "#1597a8",
  gold: "#ffc531",
  goldGlow: "#ffe58a",
  pink: "#ff8fb8",
  violet: "#8a5cff",
  water: "#2a9be0",
} as const;

/** Team identity is colour AND shape: every team also gets a jersey glyph. */
export const TEAM_GLYPHS = ["●", "▲", "■", "◆", "★", "✚"] as const;
export const teamGlyph = (teamId: number) => TEAM_GLYPHS[(Math.max(1, teamId) - 1) % TEAM_GLYPHS.length];

export type SurfaceStyle = "turf" | "sand" | "snow" | "court" | "meadow";
export type AmbientKind = "none" | "pollen" | "snow" | "dust" | "feathers";

export interface CourseTheme {
  id: string;
  /** Sky dome gradient and sun glow. */
  sky: { top: string; mid: string; bottom: string; glow: string; clouds: string; cloudCount: number };
  fog: { color: string; near: number; far: number };
  hemi: { sky: string; ground: string; intensity: number };
  sun: { color: string; intensity: number; dir: [number, number, number] };
  /** Rim light added to every toy material: the soft plastic sheen. */
  rim: { color: string; strength: number };
  exposure: number;
  water: { deep: string; shallow: string; foam: string; sparkle: string; level: number };
  surface: SurfaceStyle;
  ground: { top: string; side: string; deep: string; trim: string };
  block: { top: string; side: string; deep: string };
  wood: { top: string; side: string; dark: string };
  wall: { top: string; side: string };
  accent: string;
  accent2: string;
  ambient: AmbientKind;
}

const wobbleRun: CourseTheme = {
  id: "wobble-run",
  sky: { top: "#2f7de6", mid: "#8fd2ff", bottom: "#eaf8ff", glow: "#fff4c9", clouds: "#ffffff", cloudCount: 14 },
  fog: { color: "#cdeaff", near: 55, far: 175 },
  hemi: { sky: "#dcefff", ground: "#73a65e", intensity: 1.05 },
  sun: { color: "#fff0d6", intensity: 2.5, dir: [0.55, 1, 0.42] },
  rim: { color: "#fff7e6", strength: 0.28 },
  exposure: 1.05,
  water: { deep: "#0f63b8", shallow: "#45c4f2", foam: "#ffffff", sparkle: "#ffffff", level: -0.85 },
  surface: "turf",
  ground: { top: "#63cf5c", side: "#c98b52", deep: "#9a643a", trim: "#4fae49" },
  block: { top: "#fff3dc", side: "#4f8dff", deep: "#3567d6" },
  wood: { top: "#eab070", side: "#c4834a", dark: "#8f5a2e" },
  wall: { top: "#ffffff", side: "#ffd9cf" },
  accent: "#4f8dff",
  accent2: "#ffd21a",
  ambient: "pollen",
};

const ferryJob: CourseTheme = {
  id: "ferry-job",
  sky: { top: "#3b7fd8", mid: "#a5d6f2", bottom: "#ffe0b5", glow: "#ffd28a", clouds: "#fff3e3", cloudCount: 9 },
  fog: { color: "#f2d6b0", near: 50, far: 165 },
  hemi: { sky: "#ffe9cc", ground: "#b8743f", intensity: 1.0 },
  sun: { color: "#ffd9a3", intensity: 2.7, dir: [-0.7, 0.85, 0.35] },
  rim: { color: "#ffe2b8", strength: 0.32 },
  exposure: 1.06,
  water: { deep: "#0c7a96", shallow: "#36d0d2", foam: "#f4fffd", sparkle: "#fff6d8", level: -0.85 },
  surface: "sand",
  ground: { top: "#f2c67e", side: "#d98a4a", deep: "#ae5e33", trim: "#e4ad66" },
  block: { top: "#f0b27a", side: "#c96a35", deep: "#9c4a22" },
  wood: { top: "#d69a5d", side: "#a8693a", dark: "#6e4223" },
  wall: { top: "#fff8ea", side: "#f0e2c8" },
  accent: "#1fb7c9",
  accent2: "#ff7a3d",
  ambient: "dust",
};

const summitSync: CourseTheme = {
  id: "summit-sync",
  sky: { top: "#0d1638", mid: "#36508f", bottom: "#c2d0f5", glow: "#ffd7b0", clouds: "#dfe6ff", cloudCount: 6 },
  fog: { color: "#9aa9d9", near: 28, far: 118 },
  hemi: { sky: "#c9d8ff", ground: "#465680", intensity: 0.95 },
  sun: { color: "#d8e6ff", intensity: 2.0, dir: [0.4, 0.75, -0.6] },
  rim: { color: "#cfe2ff", strength: 0.45 },
  exposure: 1.0,
  water: { deep: "#8190c8", shallow: "#d9e1fb", foam: "#ffffff", sparkle: "#cfefff", level: -3 },
  surface: "snow",
  ground: { top: "#f3f7ff", side: "#5a6c99", deep: "#36446b", trim: "#d6e2ff" },
  block: { top: "#e8efff", side: "#4a5b8a", deep: "#2f3b61" },
  wood: { top: "#b78a5f", side: "#7d5636", dark: "#4f3420" },
  wall: { top: "#e3ebff", side: "#45557f" },
  accent: "#ff7a3d",
  accent2: "#8ff3ee",
  ambient: "snow",
};

const eggExpress: CourseTheme = {
  id: "egg-express",
  sky: { top: "#6a58cc", mid: "#ff9fb2", bottom: "#ffe6c6", glow: "#fff0c4", clouds: "#fff1f4", cloudCount: 12 },
  fog: { color: "#f7c6bc", near: 48, far: 160 },
  hemi: { sky: "#ffe3ec", ground: "#7fae55", intensity: 1.05 },
  sun: { color: "#ffe3c0", intensity: 2.3, dir: [0.6, 0.8, 0.3] },
  rim: { color: "#fff0f5", strength: 0.36 },
  exposure: 1.04,
  water: { deep: "#2a7f99", shallow: "#6fd3d6", foam: "#ffffff", sparkle: "#fff6e8", level: -0.85 },
  surface: "meadow",
  ground: { top: "#8edb68", side: "#b7794a", deep: "#8a5532", trim: "#73c254" },
  block: { top: "#fff0f6", side: "#ff8fb8", deep: "#e0608f" },
  wood: { top: "#f2c48a", side: "#cf9152", dark: "#97602f" },
  wall: { top: "#ffffff", side: "#fbe4d6" },
  accent: "#ff8fb8",
  accent2: "#ffd36b",
  ambient: "feathers",
};

const slamDunk: CourseTheme = {
  id: "slam-dunk",
  sky: { top: "#0a0c2c", mid: "#3b2a7a", bottom: "#ff8d6c", glow: "#ffb38a", clouds: "#6a4f9a", cloudCount: 0 },
  fog: { color: "#3a2a66", near: 40, far: 140 },
  hemi: { sky: "#b9a8ff", ground: "#4a2f2a", intensity: 0.9 },
  sun: { color: "#fff1e0", intensity: 2.4, dir: [0.25, 1, 0.55] },
  rim: { color: "#c9b8ff", strength: 0.42 },
  exposure: 1.08,
  water: { deep: "#140f45", shallow: "#3b2f8f", foam: "#c8bfff", sparkle: "#ffd6f5", level: -0.85 },
  surface: "court",
  ground: { top: "#eeaa5e", side: "#40295f", deep: "#2a1a42", trim: "#c9813d" },
  block: { top: "#ffe0a8", side: "#7a4fd1", deep: "#563596" },
  wood: { top: "#e6a15a", side: "#b06f34", dark: "#6e4223" },
  wall: { top: "#8a5fd6", side: "#40295f" },
  accent: "#ff8a3d",
  accent2: "#4fd2ff",
  ambient: "dust",
};

export const COURSE_THEMES: Record<string, CourseTheme> = {
  [wobbleRun.id]: wobbleRun,
  [ferryJob.id]: ferryJob,
  [summitSync.id]: summitSync,
  [eggExpress.id]: eggExpress,
  [slamDunk.id]: slamDunk,
};

export function courseTheme(id: string): CourseTheme {
  return COURSE_THEMES[id] ?? wobbleRun;
}

/** Motion timings shared by 3D feedback and the DOM HUD (ms). */
export const MOTION = {
  tap: 90,
  quick: 160,
  base: 240,
  slow: 420,
  pop: 1200,
  celebrate: 2400,
} as const;
