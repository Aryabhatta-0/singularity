import * as THREE from "three";

export const DIRECTIONAL_SUN_OFFSET = [-15, 28, 10] as const;

export function configureDirectionalSun(sun: THREE.DirectionalLight) {
  sun.position.set(...DIRECTIONAL_SUN_OFFSET);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -30,
    right: 30,
    top: 90,
    bottom: -30,
    far: 140,
  });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
}
