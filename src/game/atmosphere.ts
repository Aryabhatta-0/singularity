import * as THREE from "three";
import type { CourseTheme, AmbientKind } from "./visual-theme";
import { seededRandom } from "./environment-kit";
import { SHARED_UNIFORMS } from "./materials";

/**
 * Sky, clouds, water, shoreline foam and ambient particles. All cheap:
 * one shader each, no render targets, no reflections. Phones get fewer
 * water vertices and ambient particles.
 */

/* ---------------------------------- Sky ---------------------------------- */

export class Sky {
  mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uTop: { value: new THREE.Color() },
        uMid: { value: new THREE.Color() },
        uBot: { value: new THREE.Color() },
        uGlow: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBot; uniform vec3 uGlow; uniform vec3 uSunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 c = h > 0.0 ? mix(uMid, uTop, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(uMid, uBot, clamp(-h * 3.0, 0.0, 1.0));
          c = mix(c, uBot, exp(-abs(h) * 12.0) * 0.6);
          float s = max(dot(d, normalize(uSunDir)), 0.0);
          c += uGlow * (pow(s, 90.0) * 1.1 + pow(s, 8.0) * 0.22);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.material);
    this.mesh.scale.setScalar(250);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  apply(theme: CourseTheme) {
    const u = this.material.uniforms;
    u.uTop.value.set(theme.sky.top);
    u.uMid.value.set(theme.sky.mid);
    u.uBot.value.set(theme.fog.color);
    u.uGlow.value.set(theme.sky.glow);
    u.uSunDir.value.set(...theme.sun.dir).normalize();
  }

  follow(camera: THREE.Camera) {
    this.mesh.position.copy(camera.position);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/* ---------------------------------- Clouds ---------------------------------- */

/** Chunky toy clouds on a far ring; unfogged so they stay crisp against the sky. */
export function buildClouds(theme: CourseTheme, center: THREE.Vector3): THREE.InstancedMesh | null {
  if (theme.sky.cloudCount <= 0) return null;
  const rng = seededRandom(`clouds:${theme.id}`);
  const puffs: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < theme.sky.cloudCount; i++) {
    const a = (i / theme.sky.cloudCount) * Math.PI * 2 + rng() * 0.4;
    const r = 120 + rng() * 50;
    const cx = center.x + Math.cos(a) * r;
    const cz = center.z + Math.sin(a) * r;
    const cy = 22 + rng() * 26;
    const n = 3 + Math.floor(rng() * 3);
    const span = 7 + rng() * 6;
    for (let k = 0; k < n; k++) {
      const t = n === 1 ? 0 : k / (n - 1) - 0.5;
      const size = (k === Math.floor(n / 2) ? 7 : 4.5) * (0.8 + rng() * 0.5);
      p.set(cx + Math.cos(a + Math.PI / 2) * t * span, cy + rng() * 1.5 - (Math.abs(t) * 2), cz + Math.sin(a + Math.PI / 2) * t * span);
      s.set(size, size * 0.62, size * 0.8);
      puffs.push(m.compose(p, q, s).clone());
    }
  }
  const material = new THREE.MeshStandardMaterial({ color: theme.sky.clouds, roughness: 1, flatShading: true, fog: false, emissive: theme.sky.clouds, emissiveIntensity: 0.35 });
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 1), material, puffs.length);
  puffs.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  return mesh;
}

/* ---------------------------------- Water ---------------------------------- */

export class Water {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  level = -0.8;
  private cloudSea = false;

  constructor(compact: boolean) {
    const segments = compact ? 56 : 96;
    const geometry = new THREE.PlaneGeometry(220, 220, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    this.material = new THREE.ShaderMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uDeep: { value: new THREE.Color() },
          uShallow: { value: new THREE.Color() },
          uFoam: { value: new THREE.Color() },
          uSparkle: { value: new THREE.Color() },
          uAmp: { value: 1 },
          uCloud: { value: 0 },
        },
      ]),
      vertexShader: /* glsl */ `
        #include <common>
        #include <fog_pars_vertex>
        uniform float uTime; uniform float uAmp;
        varying vec3 vWorld; varying float vWave;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float w = sin(wp.x * 0.33 + uTime * 1.05) * 0.11 + sin(wp.z * 0.41 - uTime * 0.85) * 0.09 + sin((wp.x + wp.z) * 0.95 + uTime * 1.8) * 0.035;
          w *= uAmp;
          wp.y += w;
          vWave = w;
          vWorld = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        uniform float uTime; uniform float uCloud;
        uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uFoam; uniform vec3 uSparkle;
        varying vec3 vWorld; varying float vWave;
        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - clamp(viewDir.y, 0.0, 1.0), 3.0);
          float dist = length(cameraPosition.xz - vWorld.xz);
          vec3 col = mix(uShallow, uDeep, clamp(dist / 55.0, 0.0, 1.0) * 0.7 + 0.15 - vWave * 1.2);
          col = mix(col, uShallow * 1.1, fres * 0.5);
          float s1 = sin(vWorld.x * 1.25 + uTime * 1.5 + sin(vWorld.z * 0.65 + uTime) * 1.6);
          float s2 = sin(vWorld.z * 1.05 - uTime * 1.15 + sin(vWorld.x * 0.55) * 1.6);
          float spark = smoothstep(0.9, 1.0, s1 * s2) * (1.0 - uCloud);
          col += uSparkle * spark * 0.55;
          col = mix(col, uFoam, smoothstep(0.12, 0.2, vWave) * (0.22 + uCloud * 0.4));
          // Cloud sea: soft billows instead of glints.
          float billow = sin(vWorld.x * 0.21 + uTime * 0.25) * sin(vWorld.z * 0.17 - uTime * 0.2);
          col = mix(col, uFoam, uCloud * smoothstep(-0.2, 0.9, billow) * 0.55);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.material.uniforms.uTime = SHARED_UNIFORMS.uTime;
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  apply(theme: CourseTheme) {
    const u = this.material.uniforms;
    u.uDeep.value.set(theme.water.deep);
    u.uShallow.value.set(theme.water.shallow);
    u.uFoam.value.set(theme.water.foam);
    u.uSparkle.value.set(theme.water.sparkle);
    this.cloudSea = theme.surface === "snow";
    u.uCloud.value = this.cloudSea ? 1 : 0;
    u.uAmp.value = this.cloudSea ? 2.2 : 1;
    this.level = theme.water.level;
    this.mesh.position.y = this.level;
  }

  /** Keep the finite plane under the camera; snapped so waves never swim. */
  follow(camera: THREE.Camera) {
    this.mesh.position.x = Math.round(camera.position.x / 4) * 4;
    this.mesh.position.z = Math.round(camera.position.z / 4) * 4;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/* ---------------------------------- Shoreline foam ---------------------------------- */

const foamMaterialCache: { m: THREE.ShaderMaterial | null } = { m: null };

export function foamMaterial(color: string) {
  if (!foamMaterialCache.m) {
    foamMaterialCache.m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uTime: SHARED_UNIFORMS.uTime, uColor: { value: new THREE.Color(color) } },
      vertexShader: /* glsl */ `
        attribute float aEdge;
        varying float vEdge; varying vec3 vWorld;
        void main() {
          vEdge = aEdge;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uColor;
        varying float vEdge; varying vec3 vWorld;
        void main() {
          float pulse = 0.5 + 0.5 * sin(uTime * 2.2 - vEdge * 5.0 + (vWorld.x + vWorld.z) * 0.8);
          float band = smoothstep(1.0, 0.25, vEdge) * smoothstep(0.0, 0.12, vEdge + 0.12);
          float a = band * (0.45 + 0.4 * pulse) * (1.0 - smoothstep(0.55 + pulse * 0.25, 1.0, vEdge));
          gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }`,
    });
    foamMaterialCache.m.userData.shared = true;
  }
  foamMaterialCache.m.uniforms.uColor.value.set(color);
  return foamMaterialCache.m;
}

export function disposeFoamMaterial() {
  foamMaterialCache.m?.dispose();
  foamMaterialCache.m = null;
}

/**
 * Foam frame around a rectangular footprint (in the XZ plane, local to the
 * footprint centre). aEdge = 0 at the hull, 1 at the outer fade.
 */
export function foamRingGeometry(w: number, d: number, spread = 0.45): THREE.BufferGeometry {
  const hw = w / 2;
  const hd = d / 2;
  const corners: [number, number][] = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  const outer: [number, number][] = [[-hw - spread, -hd - spread], [hw + spread, -hd - spread], [hw + spread, hd + spread], [-hw - spread, hd + spread]];
  const inset = 0.04;
  const inner: [number, number][] = [[-hw + inset, -hd + inset], [hw - inset, -hd + inset], [hw - inset, hd - inset], [-hw + inset, hd - inset]];
  const pos: number[] = [];
  const edge: number[] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    // inner strip (slightly under the hull) then outer fade strip
    const quads: [[number, number][], [number, number][], number, number][] = [
      [inner, corners, -0.1, 0],
      [corners, outer, 0, 1],
    ];
    for (const [a, b, ea, eb] of quads) {
      pos.push(a[i][0], 0, a[i][1], b[i][0], 0, b[i][1], b[j][0], 0, b[j][1]);
      edge.push(ea, eb, eb);
      pos.push(a[i][0], 0, a[i][1], b[j][0], 0, b[j][1], a[j][0], 0, a[j][1]);
      edge.push(ea, eb, ea);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aEdge", new THREE.Float32BufferAttribute(edge, 1));
  return g;
}

/* ---------------------------------- Ambient particles ---------------------------------- */

const AMBIENT: Record<Exclude<AmbientKind, "none">, { color: string; count: number; size: number; fall: number; sway: number; opacity: number }> = {
  snow: { color: "#ffffff", count: 700, size: 7, fall: 1.6, sway: 0.9, opacity: 0.9 },
  pollen: { color: "#fff6b8", count: 160, size: 4, fall: -0.08, sway: 0.5, opacity: 0.7 },
  dust: { color: "#ffe6c4", count: 160, size: 3.5, fall: 0.05, sway: 0.35, opacity: 0.55 },
  feathers: { color: "#ffffff", count: 120, size: 6, fall: 0.35, sway: 1.1, opacity: 0.85 },
};

/** Weather around the camera: one Points draw, wrapped in a box that follows the view. */
export class AmbientParticles {
  points: THREE.Points;
  private material: THREE.ShaderMaterial;

  constructor(kind: Exclude<AmbientKind, "none">, compact: boolean) {
    const spec = AMBIENT[kind];
    const count = Math.round(spec.count * (compact ? 0.5 : 1));
    const rng = seededRandom(`ambient:${kind}`);
    const base = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      base[i * 3] = rng() * 40;
      base[i * 3 + 1] = rng() * 18;
      base[i * 3 + 2] = rng() * 40;
      seed[i] = rng();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(base, 3));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: SHARED_UNIFORMS.uTime,
        uCam: { value: new THREE.Vector3() },
        uColor: { value: new THREE.Color(spec.color) },
        uSize: { value: spec.size * (typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio) : 1) },
        uFall: { value: spec.fall },
        uSway: { value: spec.sway },
        uOpacity: { value: spec.opacity },
      },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime; uniform vec3 uCam; uniform float uSize; uniform float uFall; uniform float uSway;
        varying float vFade;
        void main() {
          vec3 box = vec3(40.0, 18.0, 40.0);
          vec3 p = position;
          p.y -= uTime * uFall * (0.6 + aSeed * 0.8);
          p.x += sin(uTime * 0.7 + aSeed * 31.0) * uSway;
          p.z += cos(uTime * 0.5 + aSeed * 17.0) * uSway;
          vec3 origin = uCam - box * 0.5;
          p = mod(p - origin, box) + origin;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          vFade = smoothstep(0.5, 3.0, d) * (1.0 - smoothstep(14.0, 20.0, d));
          gl_PointSize = uSize * (0.6 + aSeed * 0.8) * (12.0 / max(d, 1.0));
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uOpacity;
        varying float vFade;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float r = dot(c, c);
          if (r > 0.25) discard;
          gl_FragColor = vec4(uColor, uOpacity * vFade * smoothstep(0.25, 0.08, r));
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
  }

  follow(camera: THREE.Camera) {
    this.material.uniforms.uCam.value.copy(camera.position);
  }

  dispose() {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
