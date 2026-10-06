import assert from "node:assert/strict";
import test from "node:test";

import { createRoomCode, isValidRoomCode, normalizeRoomCode, roomCodeError } from "../src/app/room-code.ts";

test("new room codes are 8 unambiguous characters", () => {
  for (let i = 0; i < 50; i++) {
    const code = createRoomCode();
    assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
    assert.equal(isValidRoomCode(code), true);
  }
});

test("pasted codes and whole invite links both work", () => {
  assert.equal(normalizeRoomCode(" abcd-2345 "), "ABCD2345");
  assert.equal(normalizeRoomCode("https://singularity-coral.vercel.app/play/abcd2345?solo=1"), "ABCD2345");
  assert.equal(normalizeRoomCode("HTTP://192.168.1.20:3001/PLAY/ABCD2345"), "ABCD2345");
});

test("wrong lengths and symbols explain themselves", () => {
  assert.match(roomCodeError("ABC") ?? "", /8 letters or numbers/);
  assert.match(roomCodeError("ABCD234!") ?? "", /letters A–Z and numbers/);
  assert.equal(roomCodeError("ABCD2345"), null);
});
