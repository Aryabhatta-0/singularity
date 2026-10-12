/**
 * Course medals and local personal bests. No accounts, no currencies: a
 * medal is a fixed time threshold per course, and a personal best is the
 * fastest finish this browser has seen. Both exist only to answer "again?".
 */

export type Medal = "gold" | "silver" | "bronze";
/** Which body a run was raced with: solo free-for-all or a 3/5-player squad. */
export type SquadKey = "solo" | "3" | "5";

/** Solo thresholds in ms: [gold, silver, bronze]. */
const SOLO_MEDALS: Record<string, [number, number, number]> = {
  "wobble-run": [45_000, 75_000, 120_000],
  "ferry-job": [55_000, 90_000, 150_000],
  "summit-sync": [100_000, 160_000, 260_000],
  "egg-express": [60_000, 100_000, 165_000],
  "slam-dunk": [40_000, 75_000, 130_000],
};

/** Shared bodies are harder to drive: squads get proportionally more time. */
const SQUAD_FACTOR: Record<SquadKey, number> = { solo: 1, "3": 1.25, "5": 1.5 };

export const MEDALS: readonly Medal[] = ["gold", "silver", "bronze"];

export function medalThresholds(courseId: string, squad: SquadKey): Record<Medal, number> {
  const base = SOLO_MEDALS[courseId] ?? SOLO_MEDALS["wobble-run"];
  const k = SQUAD_FACTOR[squad];
  return { gold: Math.round(base[0] * k), silver: Math.round(base[1] * k), bronze: Math.round(base[2] * k) };
}

export function medalFor(courseId: string, squad: SquadKey, ms: number | null | undefined): Medal | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  const t = medalThresholds(courseId, squad);
  if (ms <= t.gold) return "gold";
  if (ms <= t.silver) return "silver";
  if (ms <= t.bronze) return "bronze";
  return null;
}

/** The next medal above this time, and how much faster it needs to be. */
export function nextMedal(courseId: string, squad: SquadKey, ms: number | null | undefined): { medal: Medal; target: number; gap: number | null } | null {
  const t = medalThresholds(courseId, squad);
  const current = medalFor(courseId, squad, ms);
  const next: Medal | null = current === "gold" ? null : current === "silver" ? "gold" : current === "bronze" ? "silver" : "bronze";
  if (!next) return null;
  return { medal: next, target: t[next], gap: ms == null ? null : Math.max(0, ms - t[next]) };
}

export function squadKey(solo: boolean, squadSize: number): SquadKey {
  return solo ? "solo" : squadSize === 3 ? "3" : "5";
}

/* ------------------------------ personal bests ------------------------------ */

export interface BestStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const pbKey = (courseId: string, squad: SquadKey) => `singularity_pb:v1:${courseId}:${squad}`;

export function readBest(store: BestStore | null | undefined, courseId: string, squad: SquadKey): number | null {
  try {
    const raw = store?.getItem(pbKey(courseId, squad));
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export interface BestResult {
  previous: number | null;
  best: number;
  improved: boolean;
  /** ms faster than the previous best (positive), or slower (negative). */
  delta: number | null;
}

/** Record a finish; returns whether it beat the stored best. */
export function recordBest(store: BestStore | null | undefined, courseId: string, squad: SquadKey, ms: number): BestResult {
  const previous = readBest(store, courseId, squad);
  const improved = previous == null || ms < previous;
  if (improved) {
    try {
      store?.setItem(pbKey(courseId, squad), String(Math.round(ms)));
    } catch {
      /* private mode: the run still counts, it just isn't remembered */
    }
  }
  return { previous, best: improved ? ms : previous!, improved, delta: previous == null ? null : previous - ms };
}

/* ------------------------------ onboarding ------------------------------ */

const COACH_KEY = "singularity_coached:v1";

export function coachedRoles(store: BestStore | null | undefined): Set<string> {
  try {
    const raw = store?.getItem(COACH_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function markCoached(store: BestStore | null | undefined, role: string) {
  const done = coachedRoles(store);
  done.add(role);
  try {
    store?.setItem(COACH_KEY, JSON.stringify([...done]));
  } catch {
    /* ignore */
  }
}
