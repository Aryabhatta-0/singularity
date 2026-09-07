import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { configureDirectionalSun, DIRECTIONAL_SUN_OFFSET } from "../src/lighting.ts";

test("directional shadow bounds refresh their orthographic projection", () => {
  const sun = new THREE.DirectionalLight();
  const before = sun.shadow.camera.projectionMatrix.elements[0];

  configureDirectionalSun(sun);

  assert.deepEqual(sun.position.toArray(), [...DIRECTIONAL_SUN_OFFSET]);
  assert.equal(sun.castShadow, true);
  assert.deepEqual([sun.shadow.mapSize.width, sun.shadow.mapSize.height], [2048, 2048]);
  assert.equal(sun.shadow.camera.left, -30);
  assert.equal(sun.shadow.camera.right, 30);
  assert.equal(sun.shadow.camera.top, 90);
  assert.equal(sun.shadow.camera.bottom, -30);
  assert.notEqual(sun.shadow.camera.projectionMatrix.elements[0], before);
  assert.ok(Math.abs(sun.shadow.camera.projectionMatrix.elements[0] - 1 / 30) < 1e-12);
});
