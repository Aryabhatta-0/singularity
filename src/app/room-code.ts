export const ROOM_CODE_LENGTH = 8;

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ACCEPTED_ROOM_CODE = /^[A-Z0-9]{8}$/;

export function createRoomCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => ROOM_CODE_ALPHABET[byte & 31]).join("");
}

/** Accept what people paste: lowercase, spaces or dashes from a chat app, or a whole invite link. */
export function normalizeRoomCode(value: string): string {
  const trimmed = value.trim();
  const fromLink = /\/play\/([A-Za-z0-9]{8})(?:[/?#]|$)/i.exec(trimmed)?.[1];
  return (fromLink ?? trimmed).replace(/[\s-]+/g, "").toUpperCase();
}

export function roomCodeError(value: string): string | null {
  const code = normalizeRoomCode(value);
  if (code.length !== ROOM_CODE_LENGTH) {
    return "Room codes are 8 letters or numbers. Check your invite.";
  }
  if (!ACCEPTED_ROOM_CODE.test(code)) {
    return "Use letters A–Z and numbers 0–9 only.";
  }
  return null;
}

export function isValidRoomCode(value: string): boolean {
  return roomCodeError(value) === null;
}
