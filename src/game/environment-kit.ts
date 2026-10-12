import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { toyFamilyMaterial, type ToyFamily } from "./materials";

/**
 * Procedural environment kit. Every static piece of course dressing is added
 * to a GeometryBatcher, which bakes colours into vertices and merges each
 * material family into ONE mesh. A whole course renders in a handful of draw
 * calls no matter how much dressing it carries.
 */

export type V3 = [number, number, number];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const _v = new THREE.Vector3();

/** Deterministic PRNG: dressing looks the same for every player, every run. */
export function seededRandom(seedText: string) {
  let seed = 2166136261;
  for (let i = 0; i < seedText.length; i++) seed = Math.imul(seed ^ seedText.charCodeAt(i), 16777619);
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Placement {
  pos: V3 | THREE.Vector3;
  rot?: V3 | THREE.Quaternion;
  scale?: V3 | number;
}

export function placementMatrix(p: Placement, out = _m) {
  const pos = Array.isArray(p.pos) ? _p.set(p.pos[0], p.pos[1], p.pos[2]) : _p.copy(p.pos);
  if (!p.rot) _q.identity();
  else if (Array.isArray(p.rot)) _q.setFromEuler(_e.set(p.rot[0], p.rot[1], p.rot[2]));
  else _q.copy(p.rot);
  if (p.scale == null) _s.set(1, 1, 1);
  else if (typeof p.scale === "number") _s.setScalar(p.scale);
  else _s.set(p.scale[0], p.scale[1], p.scale[2]);
  return out.compose(pos, _q, _s);
}

/* ------------------------------ Geometry templates ------------------------------ */

const templates = new Map<string, THREE.BufferGeometry>();
function template(key: string, make: () => THREE.BufferGeometry) {
  let g = templates.get(key);
  if (!g) {
    g = make();
    templates.set(key, g);
  }
  return g;
}

export const geo = {
  box: () => template("box", () => new THREE.BoxGeometry(1, 1, 1)),
  sphere: (detail = 1) => template(`sphere:${detail}`, () => new THREE.IcosahedronGeometry(0.5, detail)),
  smoothSphere: () => template("smoothSphere", () => new THREE.SphereGeometry(0.5, 20, 14)),
  cylinder: (segments = 12) => template(`cyl:${segments}`, () => new THREE.CylinderGeometry(0.5, 0.5, 1, segments)),
  cone: (segments = 8) => template(`cone:${segments}`, () => new THREE.ConeGeometry(0.5, 1, segments)),
  torus: (tube = 0.18, segments = 24) => template(`torus:${tube}:${segments}`, () => new THREE.TorusGeometry(0.5, tube, 8, segments)),
  dodeca: () => template("dodeca", () => new THREE.DodecahedronGeometry(0.5, 0)),
  rock: () => template("rock", () => new THREE.IcosahedronGeometry(0.5, 0)),
  /** Rounded box with a radius in absolute units; not a reusable template (dims baked in). */
  rounded: (w: number, h: number, d: number, r: number, segments = 2) => {
    const radius = Math.max(0.001, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
    return new RoundedBoxGeometry(w, h, d, segments, radius);
  },
};

/* ------------------------------ Batcher ------------------------------ */

/** Anything kit primitives can draw into: the world batcher or a local frame. */
export interface Batch {
  add(geometry: THREE.BufferGeometry, placement: Placement | THREE.Matrix4, color: THREE.ColorRepresentation, family?: ToyFamily, wave?: (local: THREE.Vector3) => number): void;
}

/** Draws into a parent batch through a local transform (rotated statics, movers). */
export class Frame implements Batch {
  private tmp = new THREE.Matrix4();
  constructor(private parent: Batch, public matrix: THREE.Matrix4) {}
  add(geometry: THREE.BufferGeometry, placement: Placement | THREE.Matrix4, color: THREE.ColorRepresentation, family: ToyFamily = "matte", wave?: (local: THREE.Vector3) => number) {
    const local = placement instanceof THREE.Matrix4 ? this.tmp.copy(placement) : this.tmp.copy(placementMatrix(placement));
    this.parent.add(geometry, local.premultiply(this.matrix), color, family, wave);
  }
}

interface BatchEntry {
  geometry: THREE.BufferGeometry;
}

export class GeometryBatcher implements Batch {
  private buckets = new Map<ToyFamily, BatchEntry[]>();
  private castShadow = new Map<ToyFamily, boolean>();

  /**
   * Bake `geometry` (copied, never mutated) at `placement` in a flat colour.
   * `wave` (cloth only) maps a local-space vertex to its flutter weight 0..1.
   */
  add(geometry: THREE.BufferGeometry, placement: Placement | THREE.Matrix4, color: THREE.ColorRepresentation, family: ToyFamily = "matte", wave?: (local: THREE.Vector3) => number) {
    let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    const count = g.attributes.position.count;
    let waveAttr: Float32Array | null = null;
    if (family === "cloth") {
      waveAttr = new Float32Array(count);
      const pos = g.attributes.position;
      for (let i = 0; i < count; i++) waveAttr[i] = wave ? wave(_v.fromBufferAttribute(pos, i)) : 0;
    }
    g.applyMatrix4(placement instanceof THREE.Matrix4 ? placement : placementMatrix(placement));
    for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal") g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    _c.set(color);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = _c.r;
      colors[i * 3 + 1] = _c.g;
      colors[i * 3 + 2] = _c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    if (waveAttr) g.setAttribute("aWave", new THREE.BufferAttribute(waveAttr, 1));
    g.morphAttributes = {};
    if (g !== geometry && g.groups.length) g.clearGroups();
    const list = this.buckets.get(family) ?? [];
    list.push({ geometry: g });
    this.buckets.set(family, list);
    // Disposing the toNonIndexed/clone temp happens after the merge.
    g = null as unknown as THREE.BufferGeometry;
  }

  /** Families that should not cast shadows (thin decals, glows). */
  noShadow(family: ToyFamily) {
    this.castShadow.set(family, false);
  }

  build(): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const [family, entries] of this.buckets) {
      if (entries.length === 0) continue;
      const merged = mergeGeometries(entries.map((e) => e.geometry), false);
      for (const e of entries) e.geometry.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, toyFamilyMaterial(family));
      mesh.castShadow = this.castShadow.get(family) ?? family !== "glow";
      mesh.receiveShadow = family !== "glow";
      mesh.name = `batch:${family}`;
      meshes.push(mesh);
    }
    this.buckets.clear();
    return meshes;
  }
}

/* ------------------------------ Primitives ------------------------------ */

export function addBox(b: Batch, pos: V3, size: V3, color: string, family: ToyFamily = "matte", rot?: V3) {
  b.add(geo.box(), { pos, rot, scale: size }, color, family);
}

export function addRounded(b: Batch, pos: V3, size: V3, radius: number, color: string, family: ToyFamily = "matte", rot?: V3 | THREE.Quaternion) {
  const g = geo.rounded(size[0], size[1], size[2], radius);
  b.add(g, { pos, rot }, color, family);
  g.dispose();
}

export function addCylinder(b: Batch, pos: V3, radius: number, height: number, color: string, family: ToyFamily = "matte", segments = 12, rot?: V3) {
  b.add(geo.cylinder(segments), { pos, rot, scale: [radius * 2, height, radius * 2] }, color, family);
}

export function addSphere(b: Batch, pos: V3, radius: number | V3, color: string, family: ToyFamily = "matte", detail = 1) {
  const scale: V3 = typeof radius === "number" ? [radius * 2, radius * 2, radius * 2] : [radius[0] * 2, radius[1] * 2, radius[2] * 2];
  b.add(geo.sphere(detail), { pos, scale }, color, family);
}

export function addCone(b: Batch, pos: V3, radius: number, height: number, color: string, family: ToyFamily = "matte", segments = 8, rot?: V3) {
  b.add(geo.cone(segments), { pos, rot, scale: [radius * 2, height, radius * 2] }, color, family);
}

/** Low-poly rock with a deterministic lumpy silhouette. */
export function addRock(b: Batch, pos: V3, size: V3, color: string, rng: () => number) {
  b.add(geo.rock(), { pos, rot: [rng() * 3, rng() * 6, rng() * 3], scale: size }, color, "matte");
}

/** Grass tuft: three leaning blades. */
export function addTuft(b: Batch, pos: V3, color: string, rng: () => number, height = 0.28) {
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rng();
    const h = height * (0.7 + rng() * 0.6);
    b.add(geo.cone(4), { pos: [pos[0] + Math.cos(a) * 0.05, pos[1] + h / 2, pos[2] + Math.sin(a) * 0.05], rot: [Math.sin(a) * 0.35, 0, Math.cos(a) * 0.35], scale: [0.07, h, 0.07] }, color, "matte");
  }
}

/** Alternating stripes along X of a box face (hazard tape, grip tape, court lines). */
export function addStripes(
  b: Batch,
  center: V3,
  length: number,
  height: number,
  depth: number,
  colors: [string, string],
  opts: { segment?: number; rotY?: number; family?: ToyFamily; slant?: number } = {},
) {
  const seg = opts.segment ?? 0.36;
  const n = Math.max(2, Math.round(length / seg));
  const step = length / n;
  const rotY = opts.rotY ?? 0;
  const cos = Math.cos(rotY);
  const sin = Math.sin(rotY);
  for (let i = 0; i < n; i++) {
    const off = -length / 2 + step * (i + 0.5);
    b.add(geo.box(), { pos: [center[0] + off * cos, center[1], center[2] - off * sin], rot: [0, rotY, opts.slant ?? 0], scale: [step * 1.001, height, depth] }, colors[i % 2], opts.family ?? "rubber");
  }
}

/** Flag on a pole. `facing` is the yaw the cloth flies toward. */
export function addFlag(b: Batch, base: V3, height: number, color: string, opts: { facing?: number; pole?: string; width?: number; tall?: number; pennant?: boolean } = {}) {
  const pole = opts.pole ?? "#f4f4f4";
  addCylinder(b, [base[0], base[1] + height / 2, base[2]], 0.045, height, pole, "metal", 8);
  addSphere(b, [base[0], base[1] + height + 0.05, base[2]], 0.07, "#ffd21a", "plastic", 0);
  const w = opts.width ?? 0.85;
  const h = opts.tall ?? 0.5;
  const shape = new THREE.Shape();
  if (opts.pennant) {
    shape.moveTo(0, 0);
    shape.lineTo(w, -h / 2);
    shape.lineTo(0, -h);
  } else {
    shape.moveTo(0, 0);
    shape.lineTo(w, 0);
    shape.lineTo(w * 0.86, -h / 2);
    shape.lineTo(w, -h);
    shape.lineTo(0, -h);
  }
  const g = new THREE.ShapeGeometry(shape, 1);
  // Subdivide-ish: ShapeGeometry is coarse, so flutter is gentle anyway.
  const facing = opts.facing ?? 0;
  b.add(g, { pos: [base[0], base[1] + height - 0.04, base[2]], rot: [0, facing, 0] }, color, "cloth", (v) => Math.min(1, v.x / w));
  g.dispose();
}

/** Triangular pennants hung on a sagging line between two points. */
export function addBunting(b: Batch, from: V3, to: V3, colors: readonly string[], opts: { sag?: number; spacing?: number; size?: number } = {}) {
  const a = new THREE.Vector3(...from);
  const c = new THREE.Vector3(...to);
  const len = a.distanceTo(c);
  const sag = opts.sag ?? Math.min(0.8, len * 0.08);
  const n = Math.max(2, Math.floor(len / (opts.spacing ?? 0.55)));
  const size = opts.size ?? 0.32;
  const yaw = Math.atan2(-(c.z - a.z), c.x - a.x);
  const point = (t: number) => new THREE.Vector3().lerpVectors(a, c, t).add(new THREE.Vector3(0, -Math.sin(t * Math.PI) * sag, 0));
  // line
  const curve = new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, i) => point(i / 8)));
  const tube = new THREE.TubeGeometry(curve, 16, 0.018, 4, false);
  b.add(tube, { pos: [0, 0, 0] }, "#2b3a4f", "matte");
  tube.dispose();
  const tri = new THREE.BufferGeometry();
  tri.setAttribute("position", new THREE.Float32BufferAttribute([-size / 2, 0, 0, size / 2, 0, 0, 0, -size * 1.2, 0], 3));
  tri.computeVertexNormals();
  for (let i = 1; i < n; i++) {
    const p = point(i / n);
    b.add(tri, { pos: [p.x, p.y, p.z], rot: [0, yaw, 0] }, colors[i % colors.length], "cloth", (v) => Math.min(1, -v.y / (size * 1.2)) * 0.6);
  }
  tri.dispose();
}

/** Rope sagging between two points. */
export function addRope(b: Batch, from: V3, to: V3, color = "#c9a26b", sag = 0.25, radius = 0.035) {
  const a = new THREE.Vector3(...from);
  const c = new THREE.Vector3(...to);
  const curve = new THREE.CatmullRomCurve3(Array.from({ length: 7 }, (_, i) => new THREE.Vector3().lerpVectors(a, c, i / 6).add(new THREE.Vector3(0, -Math.sin((i / 6) * Math.PI) * sag, 0))));
  const tube = new THREE.TubeGeometry(curve, 12, radius, 5, false);
  b.add(tube, { pos: [0, 0, 0] }, color, "matte");
  tube.dispose();
}

/** Striped harbour buoy. */
export function addBuoy(b: Batch, pos: V3, color: string, scale = 1) {
  addSphere(b, [pos[0], pos[1], pos[2]], [0.32 * scale, 0.26 * scale, 0.32 * scale], color, "plastic", 1);
  addCylinder(b, [pos[0], pos[1] + 0.05 * scale, pos[2]], 0.33 * scale, 0.09 * scale, "#ffffff", "plastic", 14);
  addCylinder(b, [pos[0], pos[1] + 0.38 * scale, pos[2]], 0.05 * scale, 0.42 * scale, "#2b3a4f", "metal", 6);
  addSphere(b, [pos[0], pos[1] + 0.62 * scale, pos[2]], 0.09 * scale, "#ffd21a", "glow", 0);
}

/** Wooden crate with darker banding. */
export function addCrate(b: Batch, pos: V3, size: number, color: string, band: string, rotY = 0) {
  addRounded(b, pos, [size, size, size], size * 0.06, color, "matte", [0, rotY, 0]);
  addBox(b, [pos[0], pos[1], pos[2]], [size * 1.03, size * 0.16, size * 1.03], band, "matte", [0, rotY, 0]);
}

/** Bolt heads: tiny domes that sell "this was built". */
export function addBolt(b: Batch, pos: V3, color = "#c7cdd8", r = 0.05) {
  addSphere(b, pos, [r, r * 0.6, r], color, "metal", 0);
}

/** Arrow chevron painted flat on a surface (route markings). */
export function addChevron(b: Batch, pos: V3, yaw: number, size: number, color: string, family: ToyFamily = "matte") {
  const shape = new THREE.Shape();
  const w = size;
  const t = size * 0.32;
  shape.moveTo(-w / 2, 0);
  shape.lineTo(0, -w * 0.55);
  shape.lineTo(w / 2, 0);
  shape.lineTo(w / 2, t);
  shape.lineTo(0, -w * 0.55 + t);
  shape.lineTo(-w / 2, t);
  shape.closePath();
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  b.add(g, { pos, rot: [0, yaw, 0] }, color, family);
  g.dispose();
}

/** Flat disc/ring painted on a surface. */
export function addDisc(b: Batch, pos: V3, inner: number, outer: number, color: string, family: ToyFamily = "matte", segments = 32) {
  const g = inner > 0 ? new THREE.RingGeometry(inner, outer, segments) : new THREE.CircleGeometry(outer, segments);
  g.rotateX(-Math.PI / 2);
  b.add(g, { pos }, color, family);
  g.dispose();
}
