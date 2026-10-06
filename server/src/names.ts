/**
 * Display text that other players see (player names, team names). Strips
 * control characters and bidirectional overrides so a name cannot reorder or
 * hide the text around it, then trims and collapses whitespace.
 */

export const MAX_PLAYER_NAME_LENGTH = 16;

// C0/C1 controls, zero-width joiners/marks, and bidi embeddings/overrides/isolates.
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

export function cleanDisplayText(value: string): string {
  return value.replace(UNSAFE_TEXT, "").trim().replace(/\s+/g, " ");
}

export function cleanPlayerName(value: string): string {
  return cleanDisplayText(value).slice(0, MAX_PLAYER_NAME_LENGTH).trim() || "Player";
}
