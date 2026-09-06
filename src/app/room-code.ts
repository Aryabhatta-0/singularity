export const ROOM_CODE_LENGTH = 8;
export const LEGACY_ROOM_CODE_MIN_LENGTH = 3;

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ACCEPTED_ROOM_CODE = /^[A-Z0-9]{3,8}$/;

export function createRoomCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => ROOM_CODE_ALPHABET[byte & 31]).join("");
}

export function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase();
}

export function roomCodeError(value: string): string | null {
  const code = normalizeRoomCode(value);
  if (code.length < LEGACY_ROOM_CODE_MIN_LENGTH || code.length > ROOM_CODE_LENGTH) {
    return "Room codes contain 3–8 letters or numbers.";
  }
  if (!ACCEPTED_ROOM_CODE.test(code)) {
    return "Remove spaces and symbols; use letters A–Z and numbers 0–9.";
  }
  return null;
}

export function isValidRoomCode(value: string): boolean {
  return roomCodeError(value) === null;
}
