import assert from "node:assert/strict";
import test from "node:test";

import { RENDER_LEVELS, RenderQuality, SCENERYLESS_LEVEL, SHADOWLESS_LEVEL } from "../src/game/render-quality.ts";

/** Feed `windows` two-second measurement windows of frames at `fps`. */
function run(quality, fps, windows) {
  const frames = Math.ceil(2 * fps + 1e-6);
  for (let w = 0; w < windows; w++) for (let i = 0; i < frames; i++) quality.sample(1 / fps);
}

test("a smooth 60 fps game keeps full quality", () => {
  const quality = new RenderQuality();
  run(quality, 60, 15);
  assert.equal(quality.level, 0);
  assert.equal(quality.scale, 1);
  assert.equal(quality.shadows, true);
});

test("a 30 Hz capped display is not mistaken for a slow GPU", () => {
  const quality = new RenderQuality();
  run(quality, 30, 15);
  assert.equal(quality.level, 0);
});

test("a struggling GPU steps resolution down, then drops shadows last", () => {
  const quality = new RenderQuality();
  run(quality, 12, 1);
  assert.equal(quality.level, 1, "one slow window, one step");
  run(quality, 12, 10);
  assert.equal(quality.level, SHADOWLESS_LEVEL);
  assert.equal(quality.shadows, false);
  assert.equal(quality.scale, RENDER_LEVELS.at(-1));
});

test("quality recovers only after sustained headroom, one step at a time", () => {
  const quality = new RenderQuality();
  run(quality, 12, 10);
  const lowest = quality.level;
  run(quality, 60, 2);
  assert.equal(quality.level, lowest, "two fast windows are not enough");
  run(quality, 60, 1);
  assert.equal(quality.level, lowest - 1);
  assert.equal(quality.shadows, true, "shadows come back first");
});

test("hitches like tab switches are ignored", () => {
  const quality = new RenderQuality();
  for (let i = 0; i < 50; i++) quality.sample(1.5);
  quality.sample(Number.NaN);
  quality.sample(-1);
  assert.equal(quality.level, 0);
});

test("decorative scenery goes before shadows, and comes back with quality", () => {
  const quality = new RenderQuality();
  assert.equal(quality.scenery, true);
  run(quality, 12, SCENERYLESS_LEVEL);
  assert.equal(quality.level, SCENERYLESS_LEVEL);
  assert.equal(quality.scenery, false);
  assert.equal(quality.shadows, true, "shadows outlive scenery");
  assert.ok(SCENERYLESS_LEVEL < SHADOWLESS_LEVEL);
});
