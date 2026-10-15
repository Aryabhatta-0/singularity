import * as THREE from "three";
import { INK } from "./visual-theme";

/**
 * Shared, cached materials. The whole world uses a handful of shader programs:
 *
 * - toy families (vertex-coloured MeshStandardMaterial + a soft rim light),
 *   used by the merged static course geometry
 * - solid-colour toy materials for things that move on their own (the dummy,
 *   props, movers), cached per colour
 * - one inverted-hull ink outline
 *
 * Every material created here is flagged `userData.shared` so level teardown
 * never disposes it; `disposeSharedMaterials` releases them with the game.
 */

export type ToyFamily = "plastic" | "matte" | "rubber" | "metal" | "ice" | "glow" | "cloth";

const FAMILY_PARAMS: Record<ToyFamily, { roughness: number; metalness: number; rim: number; glow?: number }> = {
  plastic: { roughness: 0.5, metalness: 0.02, rim: 1 },
  matte: { roughness: 0.92, metalness: 0, rim: 0.7 },
  rubber: { roughness: 0.68, metalness: 0, rim: 1.1 },
  metal: { roughness: 0.32, metalness: 0.55, rim: 0.6 },
  ice: { roughness: 0.14, metalness: 0.05, rim: 1.8 },
  glow: { roughness: 0.5, metalness: 0, rim: 0.4, glow: 0.85 },
  cloth: { roughness: 0.85, metalness: 0, rim: 0.8 },
};

/** Uniforms every toy material reads, so a course swap retunes them all at once. */
export const SHARED_UNIFORMS = {
  uTime: { value: 0 },
  uRimColor: { value: new THREE.Color("#ffffff") },
  uRimStrength: { value: 0.3 },
};

const cache = new Map<string, THREE.Material>();

function remember<T extends THREE.Material>(key: string, make: () => T): T {
  const hit = cache.get(key);
  if (hit) return hit as T;
  const made = make();
  made.userData.shared = true;
  cache.set(key, made);
  return made;
}

interface ToyShaderOptions {
  rim: number;
  glow?: number;
  /** Vertex wave driven by an `aWave` attribute (flags, bunting). */
  wave?: boolean;
  vertexColors: boolean;
}

function injectToyShader(material: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial, opts: ToyShaderOptions) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = SHARED_UNIFORMS.uTime;
    shader.uniforms.uRimColor = SHARED_UNIFORMS.uRimColor;
    shader.uniforms.uRimStrength = SHARED_UNIFORMS.uRimStrength;
    if (opts.wave) {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aWave;\nuniform float uTime;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          float wPhase = uTime * 5.5 + position.x * 1.7 + position.z * 1.3;
          transformed.y += sin(wPhase) * 0.07 * aWave;
          transformed.x += cos(wPhase * 0.8) * 0.05 * aWave;
          transformed.z += sin(wPhase * 1.1 + 1.3) * 0.05 * aWave;`,
        );
    }
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uRimColor;\nuniform float uRimStrength;")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        float rimDot = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        totalEmissiveRadiance += uRimColor * pow(rimDot, 3.0) * uRimStrength * ${opts.rim.toFixed(2)};
        ${opts.glow ? `totalEmissiveRadiance += diffuseColor.rgb * ${opts.glow.toFixed(2)};` : ""}`,
      );
  };
  material.customProgramCacheKey = () => `toy:${opts.rim}:${opts.glow ?? 0}:${opts.wave ? 1 : 0}:${opts.vertexColors ? 1 : 0}`;
}

/** Vertex-coloured family material for merged static geometry. */
export function toyFamilyMaterial(family: ToyFamily): THREE.MeshStandardMaterial {
  return remember(`family:${family}`, () => {
    const p = FAMILY_PARAMS[family];
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: p.roughness, metalness: p.metalness, side: family === "cloth" ? THREE.DoubleSide : THREE.FrontSide });
    injectToyShader(m, { rim: p.rim, glow: p.glow, wave: family === "cloth", vertexColors: true });
    return m;
  });
}

/**
 * Cheap Lambert variant for far scenery (mesas, mountains, islets): no
 * specular, no shadow sampling. Fill-rate is what phones run out of first.
 */
export function sceneryFamilyMaterial(family: ToyFamily): THREE.MeshLambertMaterial {
  return remember(`scenery:${family}`, () => {
    const p = FAMILY_PARAMS[family];
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: family === "cloth" ? THREE.DoubleSide : THREE.FrontSide });
    injectToyShader(m, { rim: p.rim, glow: p.glow, wave: family === "cloth", vertexColors: true });
    m.customProgramCacheKey = () => `scenery:${p.rim}:${p.glow ?? 0}:${family === "cloth" ? 1 : 0}`;
    return m;
  });
}

/** Solid colour toy material, cached per colour + family. */
export function toyMaterial(color: THREE.ColorRepresentation, family: ToyFamily = "plastic", extra: { emissive?: string; emissiveIntensity?: number } = {}): THREE.MeshStandardMaterial {
  const key = `solid:${family}:${new THREE.Color(color).getHexString()}:${extra.emissive ?? ""}:${extra.emissiveIntensity ?? 0}`;
  return remember(key, () => {
    const p = FAMILY_PARAMS[family];
    const m = new THREE.MeshStandardMaterial({ color, roughness: p.roughness, metalness: p.metalness, side: family === "cloth" ? THREE.DoubleSide : THREE.FrontSide });
    if (extra.emissive) {
      m.emissive.set(extra.emissive);
      m.emissiveIntensity = extra.emissiveIntensity ?? 0.5;
    }
    injectToyShader(m, { rim: p.rim, glow: p.glow, wave: family === "cloth", vertexColors: false });
    return m;
  });
}

/**
 * An unshared toy material (its colour or emissive animates per object).
 * The caller owns and disposes it.
 */
export function ownedToyMaterial(color: THREE.ColorRepresentation, family: ToyFamily = "plastic"): THREE.MeshStandardMaterial {
  const p = FAMILY_PARAMS[family];
  const m = new THREE.MeshStandardMaterial({ color, roughness: p.roughness, metalness: p.metalness, side: family === "cloth" ? THREE.DoubleSide : THREE.FrontSide });
  injectToyShader(m, { rim: p.rim, glow: p.glow, wave: family === "cloth", vertexColors: false });
  return m;
}

/** Inverted-hull ink outline: back faces pushed out along the normal. */
export function outlineMaterial(width = 0.018, color: string = INK): THREE.MeshBasicMaterial {
  return remember(`outline:${width}:${color}`, () => {
    const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\ntransformed += normalize(normal) * ${width.toFixed(4)};`,
      );
    };
    m.customProgramCacheKey = () => `outline:${width}`;
    return m;
  });
}

/** Rival ghosts: see-through, tinted, never writing depth. */
export function ghostMaterial(color: THREE.ColorRepresentation, opacity = 0.42): THREE.MeshStandardMaterial {
  const key = `ghost:${new THREE.Color(color).getHexString()}:${opacity}`;
  return remember(key, () => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, transparent: true, opacity, depthWrite: false });
    injectToyShader(m, { rim: 2.4, vertexColors: false });
    return m;
  });
}

export function basicMaterial(color: THREE.ColorRepresentation, opts: { transparent?: boolean; opacity?: number; side?: THREE.Side; depthWrite?: boolean; blending?: THREE.Blending } = {}) {
  const key = `basic:${new THREE.Color(color).getHexString()}:${opts.transparent ? 1 : 0}:${opts.opacity ?? 1}:${opts.side ?? 0}:${opts.depthWrite ?? true}:${opts.blending ?? 1}`;
  return remember(key, () => new THREE.MeshBasicMaterial({ color, transparent: opts.transparent, opacity: opts.opacity ?? 1, side: opts.side ?? THREE.FrontSide, depthWrite: opts.depthWrite ?? true, blending: opts.blending ?? THREE.NormalBlending }));
}

const textures = new Map<string, THREE.Texture>();

/** Canvas-drawn texture, cached by key and shared. */
export function canvasTexture(key: string, width: number, height: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const hit = textures.get(key);
  if (hit) return hit as THREE.CanvasTexture;
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  draw(c.getContext("2d")!, width, height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.userData.shared = true;
  textures.set(key, tex);
  return tex;
}

/** The crash-test calibration target: a circle in ink/yellow quadrants. */
export function targetTexture(fill = "#ffd21a"): THREE.CanvasTexture {
  return canvasTexture(`target:${fill}`, 128, 128, (ctx, w) => {
    const r = w / 2 - 6;
    ctx.translate(w / 2, w / 2);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK;
    for (const start of [0, Math.PI]) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, start, start + Math.PI / 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.lineWidth = 9;
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  });
}

/** Soft round blob used for contact shadows and glows. */
export function radialTexture(key: string, inner: string, outer: string): THREE.CanvasTexture {
  return canvasTexture(`radial:${key}`, 128, 128, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

export function isSharedResource(resource: THREE.Material | THREE.Texture | THREE.BufferGeometry) {
  return resource.userData?.shared === true;
}

export function disposeSharedMaterials() {
  for (const m of cache.values()) m.dispose();
  cache.clear();
  for (const t of textures.values()) t.dispose();
  textures.clear();
}
