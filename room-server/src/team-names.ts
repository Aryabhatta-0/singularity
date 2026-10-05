/** Team naming: versus squads are numbered Team 1, 2, 3… (no gaps from
 * deleted teams); free-for-all racers get a team named after themselves.
 * Pure helpers so the browser test bundle can cover them directly.
 */

export const MAX_TEAM_NAME_LENGTH = 22;

const TEAM_NUMBER = /^team (\d+)$/i;

/** Smallest unused "Team N" (N >= 1) for versus squads. */
export function nextSquadName(existingNames: readonly string[]): string {
  const taken = new Set(
    existingNames
      .map((name) => name.trim().toLowerCase())
      .filter((name) => TEAM_NUMBER.test(name)),
  );
  let n = 1;
  while (taken.has(`team ${n}`)) n += 1;
  return `Team ${n}`;
}

/** Dedupe a preferred name (free-for-all racer name) with a " 2"/" 3"… suffix. */
export function dedupeTeamName(existingNames: readonly string[], preferred: string): string {
  const taken = new Set(existingNames.map((name) => name.trim().toLowerCase()));
  const clean = (preferred.replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/\s+/g, " ") || "Racer").slice(
    0,
    MAX_TEAM_NAME_LENGTH,
  );
  if (!taken.has(clean.toLowerCase())) return clean;
  let n = 2;
  for (;;) {
    const suffix = ` ${n}`;
    const candidate = `${clean.slice(0, MAX_TEAM_NAME_LENGTH - suffix.length)}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
    n += 1;
  }
}

/** Full picker: preferred name wins (free-for-all), else next squad number. */
export function pickTeamName(existingNames: readonly string[], preferred?: string): string {
  if (preferred && preferred.trim().length > 0) return dedupeTeamName(existingNames, preferred);
  return nextSquadName(existingNames);
}
