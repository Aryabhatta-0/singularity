import * as THREE from "three";
import type { BuildContext } from "./course-decor";
import { addTarget, flagGeometry, shade } from "./course-decor";
import {
  GeometryBatcher,
  addBox,
  addBunting,
  addBuoy,
  addChevron,
  addCone,
  addCrate,
  addCylinder,
  addDisc,
  addFlag,
  addRock,
  addRope,
  addRounded,
  addSphere,
  addStripes,
  addTuft,
  geo,
  type Batch,
  type V3,
} from "./environment-kit";
import { INK, PALETTE } from "./visual-theme";
import { canvasTexture, ownedToyMaterial, toyMaterial } from "./materials";

/**
 * Per-course dressing: the landmarks and set pieces that make each course an
 * episode with its own identity. Everything sits off the walkable path (or
 * below it) and has no collision; it only tells the player where they are.
 */

export function decorateCourse(ctx: BuildContext) {
  switch (ctx.level.id) {
    case "wobble-run":
      return wobbleRun(ctx);
    case "ferry-job":
      return ferryJob(ctx);
    case "summit-sync":
      return summitSync(ctx);
    case "egg-express":
      return eggExpress(ctx);
    case "slam-dunk":
      return slamDunk(ctx);
  }
}

/* ------------------------------ shared set pieces ------------------------------ */

/** A small island rising out of the water; returns its top height. */
function islet(ctx: BuildContext, b: Batch, x: number, z: number, w: number, d: number, rise = 0.7) {
  const t = ctx.theme;
  const top = ctx.waterLevel + rise;
  const depth = rise + 0.8;
  addRounded(b, [x, top - 0.11, z], [w, 0.22, d], 0.1, t.ground.top, "matte");
  addRounded(b, [x, top - 0.2 - depth / 2, z], [w - 0.1, depth, d - 0.1], 0.2, t.ground.side, "matte");
  for (let i = 0; i < 4; i++) addRock(b, [x + (ctx.rng() - 0.5) * w, ctx.waterLevel + 0.05, z + (ctx.rng() > 0.5 ? 1 : -1) * (d / 2 + 0.15)], [0.7, 0.5, 0.6], shade(t.ground.side, -0.12), ctx.rng);
  return top;
}

function toyTree(b: Batch, x: number, y: number, z: number, s: number, leaf: string, rng: () => number) {
  addCylinder(b, [x, y + 0.5 * s, z], 0.12 * s, 1 * s, "#8f5a2e", "matte", 8);
  addSphere(b, [x, y + 1.35 * s, z], 0.62 * s, leaf, "matte", 1);
  addSphere(b, [x + 0.3 * s, y + 1.1 * s, z + 0.15 * s], 0.42 * s, shade(leaf, 0.06), "matte", 1);
  addSphere(b, [x - 0.28 * s, y + 1.15 * s, z - 0.1 * s], 0.38 * s, shade(leaf, -0.05), "matte", 1);
  void rng;
}

function pine(b: Batch, x: number, y: number, z: number, s: number, snowy: boolean) {
  addCylinder(b, [x, y + 0.25 * s, z], 0.1 * s, 0.5 * s, "#6e4223", "matte", 6);
  for (let k = 0; k < 3; k++) {
    const r = (0.62 - k * 0.15) * s;
    const yy = y + (0.75 + k * 0.5) * s;
    addCone(b, [x, yy, z], r, 0.8 * s, "#2f7a55", "matte", 7);
    if (snowy) addCone(b, [x, yy + 0.22 * s, z], r * 0.6, 0.38 * s, "#ffffff", "matte", 7);
  }
}

function lighthouse(ctx: BuildContext, b: Batch, x: number, y: number, z: number, h: number) {
  const bands = 5;
  for (let i = 0; i < bands; i++) {
    const r0 = 0.85 - i * 0.07;
    b.add(geo.cylinder(16), { pos: [x, y + (i + 0.5) * (h / bands), z], scale: [r0 * 2, h / bands, r0 * 2] }, i % 2 ? "#ffffff" : PALETTE.tape, "plastic");
  }
  addCylinder(b, [x, y + h + 0.12, z], 0.75, 0.24, INK, "metal", 16);
  addCylinder(b, [x, y + h + 0.6, z], 0.45, 0.75, PALETTE.goldGlow, "glow", 12);
  addCone(b, [x, y + h + 1.25, z], 0.6, 0.6, PALETTE.tape, "plastic", 12);
  // sweeping light beam
  const beamMat = ctx.own(new THREE.MeshBasicMaterial({ color: PALETTE.goldGlow, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  const cone = ctx.own(new THREE.ConeGeometry(1.4, 14, 16, 1, true));
  cone.translate(0, -7, 0);
  cone.rotateZ(Math.PI / 2);
  const beam = new THREE.Mesh(cone, beamMat);
  const pivot = new THREE.Group();
  pivot.position.set(x, y + h + 0.6, z);
  pivot.add(beam);
  ctx.group.add(pivot);
  ctx.animate((u) => {
    pivot.rotation.y = u.time * 0.8;
  });
}

/** World-space sign: dummy-yellow sticker, ink outline, big type. */
function sign(ctx: BuildContext, text: string, pos: V3, yaw: number, size: [number, number] = [2.4, 0.9], colors: [string, string] = [PALETTE.dummy, INK]) {
  const tex = canvasTexture(`ssign:${text}:${colors.join()}`, 512, 192, (c, w, h) => {
    c.fillStyle = colors[1];
    roundRect(c, 0, 0, w, h, 34);
    c.fill();
    c.fillStyle = colors[0];
    roundRect(c, 10, 10, w - 20, h - 20, 26);
    c.fill();
    c.fillStyle = colors[1];
    c.textAlign = "center";
    c.textBaseline = "middle";
    let fs = 96;
    c.font = `900 ${fs}px system-ui, sans-serif`;
    while (c.measureText(text).width > w - 60 && fs > 40) {
      fs -= 6;
      c.font = `900 ${fs}px system-ui, sans-serif`;
    }
    c.fillText(text, w / 2, h / 2 + 4);
  });
  const mesh = new THREE.Mesh(ctx.own(new THREE.PlaneGeometry(size[0], size[1])), ctx.own(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide })));
  mesh.position.set(...pos);
  mesh.rotation.y = yaw;
  ctx.group.add(mesh);
  return mesh;
}

function trafficCone(b: Batch, x: number, y: number, z: number) {
  addBox(b, [x, y + 0.02, z], [0.42, 0.04, 0.42], PALETTE.tape, "rubber");
  addCone(b, [x, y + 0.3, z], 0.16, 0.56, PALETTE.tape, "rubber", 12);
  addCylinder(b, [x, y + 0.3, z], 0.118, 0.1, "#ffffff", "rubber", 12);
}

function hayBale(b: Batch, x: number, y: number, z: number, rotY = 0) {
  b.add(geo.cylinder(14), { pos: [x, y + 0.36, z], rot: [Math.PI / 2, rotY, 0], scale: [0.72, 1.1, 0.72] }, "#f2c94c", "matte");
  for (const o of [-0.3, 0.3]) b.add(geo.torus(0.06, 18), { pos: [x + Math.sin(rotY) * o, y + 0.36, z + Math.cos(rotY) * o], rot: [0, rotY, 0], scale: [0.74, 0.74, 0.74] }, "#c99a2e", "matte");
}

function picketFence(b: Batch, from: [number, number], to: [number, number], y: number) {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const yaw = Math.atan2(-(to[1] - from[1]), to[0] - from[0]);
  const n = Math.max(2, Math.floor(len / 0.32));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = from[0] + (to[0] - from[0]) * t;
    const z = from[1] + (to[1] - from[1]) * t;
    addBox(b, [x, y + 0.32, z], [0.1, 0.64, 0.05], "#ffffff", "plastic", [0, yaw, 0]);
    addCone(b, [x, y + 0.7, z], 0.07, 0.12, "#ffffff", "plastic", 4, [0, yaw + Math.PI / 4, 0]);
  }
  for (const h of [0.22, 0.48]) addBox(b, [(from[0] + to[0]) / 2, y + h, (from[1] + to[1]) / 2], [len, 0.07, 0.04], "#f0ece4", "plastic", [0, yaw, 0]);
}

function sunflower(b: Batch, x: number, y: number, z: number, h: number, yaw: number) {
  addCylinder(b, [x, y + h / 2, z], 0.03, h, "#3f8f3a", "matte", 5);
  addCylinder(b, [x, y + h, z], 0.2, 0.05, "#ffc531", "matte", 10, [Math.PI / 2 - 0.3, yaw, 0]);
  addCylinder(b, [x, y + h, z + 0.02], 0.09, 0.07, "#6e4223", "matte", 8, [Math.PI / 2 - 0.3, yaw, 0]);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Animated group built from its own small batcher (windmill blades, balloons). */
function animatedPiece(ctx: BuildContext, build: (b: GeometryBatcher) => void, shadows = false) {
  const g = new THREE.Group();
  const b = new GeometryBatcher();
  build(b);
  for (const m of b.build()) {
    m.castShadow = shadows;
    g.add(m);
  }
  ctx.group.add(g);
  return g;
}

/* ------------------------------ Wobble Run ------------------------------ */

function wobbleRun(ctx: BuildContext) {
  const { b, scenery, theme, rng } = ctx;
  const flagColors = [theme.accent, PALETTE.dummy, PALETTE.tape, PALETTE.mint];
  // Starting gantry the team runs under.
  const gz = -2.5;
  for (const sx of [-1, 1]) {
    addRounded(b, [sx * 4.75, 2.3, gz], [0.55, 4.6, 0.55], 0.18, "#ffffff", "plastic");
    addStripes(b, [sx * 4.75, 0.9, gz], 0.6, 1.6, 0.6, [PALETTE.tape, "#ffffff"], { segment: 0.3 });
    addRounded(b, [sx * 4.75, 0.1, gz], [0.95, 0.2, 0.95], 0.06, INK, "rubber");
  }
  addRounded(b, [0, 4.75, gz], [10.1, 0.8, 0.6], 0.2, theme.accent, "plastic");
  for (const [i, c] of [PALETTE.tape, PALETTE.dummy, PALETTE.mint].entries()) addSphere(b, [3.2 + i * 0.5, 4.75, gz + 0.3], 0.14, c, "glow", 1);
  sign(ctx, "WOBBLE RUN", [-0.6, 4.75, gz + 0.31], 0, [4.4, 0.62]);
  // Route markings: lane lines and chevrons between the hurdles.
  for (const sx of [-1, 1]) addBox(b, [sx * 2.75, 0.004, -10], [0.09, 0.01, 13.4], "#ffffff", "matte");
  for (const z of [-4.9, -8, -11]) addChevron(b, [0, 0.006, z], 0, 1.1, "#ffffff");
  for (const z of [-28.6, -31.6]) addChevron(b, [0, 0.006, z], 0, 1.1, "#ffffff");
  for (const z of [-58.5, -61.5]) addChevron(b, [0, 0.006, z], 0, 1.3, "#ffffff");
  // Flags along the gauntlet, bunting over the lane entrances.
  [-4, -9, -14].forEach((z, i) => {
    for (const sx of [-1, 1]) addFlag(b, [sx * 4.05, 0, z], 2.6, flagColors[(i + (sx > 0 ? 1 : 0)) % flagColors.length], { facing: sx > 0 ? Math.PI : 0 });
  });
  for (const z of [-3.3, -16.6]) {
    for (const sx of [-1, 1]) addCylinder(b, [sx * 4.05, 1.9, z], 0.05, 3.8, "#f4f4f4", "metal", 8);
    addBunting(b, [-4.05, 3.75, z], [4.05, 3.75, z], flagColors, { sag: 0.5 });
  }
  // Training-ground props on the start pad.
  for (const sx of [-1, 1]) {
    trafficCone(b, sx * 4.8, 0, 6.6);
    trafficCone(b, sx * 4.8, 0, -1.8);
    for (let k = 0; k < 3; k++) b.add(geo.torus(0.35, 18), { pos: [sx * 5.2, 0.07 + k * 0.13, 1.2 - (k === 2 ? 0.1 : 0)], rot: [Math.PI / 2, 0, 0], scale: [0.5, 0.5, 0.5] }, INK, "rubber");
  }
  // Buoys and lane ropes along the skinny bridge.
  const buoyZ = [-17.4, -20.4, -23.6, -26.6];
  for (const sx of [-1, 1]) {
    buoyZ.forEach((z, i) => {
      addBuoy(b, [sx * 2.1, ctx.waterLevel + 0.05, z], i % 2 ? PALETTE.tape : "#ffffff", 0.9);
      if (i > 0) addRope(b, [sx * 2.1, ctx.waterLevel + 0.28, buoyZ[i - 1]], [sx * 2.1, ctx.waterLevel + 0.28, z], PALETTE.dummy, 0.08, 0.03);
    });
  }
  for (const z of [-29.2, -32.2]) for (const sx of [-1, 1]) addFlag(b, [sx * 4.1, 0, z], 2.2, flagColors[(z > -30 ? 0 : 2) + (sx > 0 ? 1 : 0)], { facing: sx > 0 ? Math.PI : 0 });
  // The climb: corner flags on the plateaus, a "PULL UP" sign on the wall.
  for (const sx of [-1, 1]) addFlag(b, [sx * 3.1, 2, -39.6], 1.8, PALETTE.dummy, { facing: sx > 0 ? Math.PI : 0, pennant: true });
  sign(ctx, "↑ PULL UP ↑", [0, 2.42, -44.96], 0, [2.2, 0.62]);
  // Finish towers.
  for (const sx of [-1, 1]) {
    addRounded(b, [sx * 4.55, 2.6, -63], [0.5, 5.2, 0.5], 0.15, "#ffffff", "plastic");
    addStripes(b, [sx * 4.55, 4.4, -63], 0.55, 1.2, 0.55, [INK, "#ffffff"], { segment: 0.27 });
    addFlag(b, [sx * 4.55, 5.2, -63], 1.4, sx < 0 ? PALETTE.tape : theme.accent, { facing: sx > 0 ? Math.PI : 0, width: 1.4, tall: 0.8 });
  }
  // Islets with toy trees, a lighthouse and a hot-air balloon for depth.
  const islets: [number, number, number, number][] = [[-11.5, -6, 6, 7], [12.5, -21, 7, 6], [-12.5, -37, 7, 8], [12, -51, 8, 6], [-11, -63, 6, 6], [13, 2, 5, 5]];
  for (const [x, z, w, d] of islets) {
    const top = islet(ctx, scenery, x, z, w, d, 0.6 + rng() * 0.5);
    for (let k = 0; k < 3; k++) toyTree(scenery, x + (rng() - 0.5) * (w - 2), top, z + (rng() - 0.5) * (d - 2), 0.9 + rng() * 0.6, k % 2 ? "#4fbf5a" : "#7ad65e", rng);
    for (let k = 0; k < 4; k++) addTuft(scenery, [x + (rng() - 0.5) * w * 0.8, top, z + (rng() - 0.5) * d * 0.8], theme.ground.trim, rng, 0.35);
  }
  const lhTop = ctx.waterLevel + 1.1;
  islet(ctx, scenery, -14, -24, 4.5, 4.5, 1.1);
  lighthouse(ctx, scenery, -14, lhTop, -24, 8);
  const balloon = animatedPiece(ctx, (pb) => {
    const colors = [PALETTE.tape, "#ffffff", theme.accent, PALETTE.dummy];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      pb.add(geo.sphere(1), { pos: [Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15], rot: [0, -a, 0], scale: [1.7, 2.1, 0.9] }, colors[i % colors.length], "plastic");
    }
    addCone(pb, [0, -1.25, 0], 0.7, 0.7, PALETTE.tape, "plastic", 8, [Math.PI, 0, 0]);
    addRounded(pb, [0, -2.1, 0], [0.55, 0.42, 0.55], 0.06, "#b07a45", "matte");
    for (const [x, z] of [[-0.22, -0.22], [0.22, -0.22], [0.22, 0.22], [-0.22, 0.22]]) addCylinder(pb, [x, -1.75, z], 0.012, 0.6, INK, "matte", 4);
  });
  balloon.position.set(17, 11, -44);
  balloon.scale.setScalar(1.6);
  ctx.animate((u) => {
    balloon.position.y = 11 + Math.sin(u.time * 0.4) * 0.6;
    balloon.rotation.y = u.time * 0.1;
  });
}

/* ------------------------------ Ferry Job ------------------------------ */

function mesa(ctx: BuildContext, b: Batch, x: number, z: number, w: number, d: number, h: number) {
  const t = ctx.theme;
  const layers = Math.max(3, Math.round(h / 2.2));
  const lh = (h + 1.5) / layers;
  for (let i = 0; i < layers; i++) {
    const k = 1 - (i / layers) * 0.18;
    const color = i % 3 === 0 ? t.block.side : i % 3 === 1 ? t.ground.side : shade(t.block.side, 0.06);
    addRounded(b, [x, ctx.waterLevel - 1.5 + lh * (i + 0.5), z], [w * k, lh + 0.02, d * k], Math.min(0.5, lh * 0.3), color, "matte");
  }
  const top = ctx.waterLevel - 1.5 + lh * layers;
  addRounded(b, [x, top + 0.05, z], [w * 0.84, 0.2, d * 0.84], 0.1, t.ground.top, "matte");
  return top;
}

function cactus(b: Batch, x: number, y: number, z: number, s: number) {
  const green = "#4f9a4a";
  addCylinder(b, [x, y + 0.7 * s, z], 0.16 * s, 1.4 * s, green, "matte", 8);
  addSphere(b, [x, y + 1.4 * s, z], 0.16 * s, green, "matte", 1);
  addCylinder(b, [x + 0.28 * s, y + 0.85 * s, z], 0.1 * s, 0.5 * s, green, "matte", 8);
  addBox(b, [x + 0.16 * s, y + 0.62 * s, z], [0.26 * s, 0.14 * s, 0.14 * s], green, "matte");
}

function ferryJob(ctx: BuildContext) {
  const { b, scenery, theme, rng } = ctx;
  // Canyon walls of stacked sandstone mesas.
  for (const sx of [-1, 1]) {
    for (let z = 10; z > -56; z -= 11 + rng() * 4) {
      const w = 6 + rng() * 5;
      const x = sx * (21 + rng() * 8);
      const top = mesa(ctx, scenery, x, z, w, 6 + rng() * 5, 6 + rng() * 10);
      if (rng() > 0.4) cactus(scenery, x + (rng() - 0.5) * w * 0.4, top + 0.15, z, 1.2);
    }
  }
  // The canyon arch beyond the drop-off: a landmark you can aim for.
  for (const sx of [-1, 1]) mesa(ctx, scenery, sx * 9, -64, 3, 3, 10);
  scenery.add(geo.torus(0.12, 28), { pos: [0, ctx.waterLevel + 10.2, -64], rot: [0, 0, 0], scale: [18, 9, 3] }, theme.block.side, "matte");
  // Loading zones: hatched pick-up and cyan drop-off.
  hatch(b, 0, 0, 2.7, 2.7, [PALETTE.dummy, INK]);
  hatch(b, 0, -37.5, 3.4, 3.4, [PALETTE.cyan, "#ffffff"]);
  for (const z of [-4.9, -8.6, -13.6]) addChevron(b, [0, 0.006, z], 0, 1.1, "#ffffff");
  for (const z of [-34, -35.5]) addChevron(b, [0, 0.006, z], 0, 1.0, "#ffffff");
  // Cargo stacks on the quay.
  const crateColors = [theme.accent, PALETTE.tape, "#fff3dc", theme.accent2];
  for (const sx of [-1, 1]) {
    for (const z of [6.4, -1.6]) {
      const n = 2 + Math.floor(rng() * 2);
      for (let k = 0; k < n; k++) addCrate(b, [sx * (4.7 - (k === 2 ? 0 : 0)), 0.35 + k * 0.7, z + (k === 1 ? 0.1 : 0)], 0.7, crateColors[(k + (sx > 0 ? 1 : 0) + Math.floor(z)) % crateColors.length], shade(crateColors[k % crateColors.length], -0.2), rng() * 0.4);
    }
  }
  // Mooring posts, buoys and lane ropes along the ferry crossing.
  for (const sx of [-1, 1]) {
    for (const z of [-15.8, -19.2]) {
      addCylinder(b, [sx * 1.9, (ctx.waterLevel + 0.45) / 2, z], 0.13, 0.45 - ctx.waterLevel + 0.2, theme.wood.dark, "matte", 8);
      addSphere(b, [sx * 1.9, 0.48, z], 0.15, theme.wood.dark, "matte", 1);
    }
    const bz = [-19.6, -22.8, -26];
    bz.forEach((z, i) => {
      addBuoy(b, [sx * 4.9, ctx.waterLevel + 0.05, z], i % 2 ? "#ffffff" : PALETTE.tape, 1);
      if (i > 0) addRope(b, [sx * 4.9, ctx.waterLevel + 0.3, bz[i - 1]], [sx * 4.9, ctx.waterLevel + 0.3, z], PALETTE.dummy, 0.08, 0.03);
    });
  }
  sign(ctx, "FERRY ↓", [-2.4, 2.1, -16.2], 0.25, [1.6, 0.6]);
  addCylinder(b, [-2.4, 0.9, -16.25], 0.05, 1.8, "#f4f4f4", "metal", 6);
  // Harbour crane with a dangling crate.
  const cTop = islet(ctx, b, -9, -12, 4, 4, 1);
  addRounded(b, [-9, cTop + 4, -12], [0.7, 8, 0.7], 0.08, PALETTE.dummy, "plastic");
  for (let y = 1; y < 8; y += 1.2) addBox(b, [-9, cTop + y, -12], [0.74, 0.08, 0.74], INK, "metal");
  addRounded(b, [-6.2, cTop + 8.2, -12], [6.4, 0.45, 0.5], 0.08, PALETTE.dummy, "plastic");
  addRounded(b, [-10.4, cTop + 8.2, -12], [1.6, 0.9, 0.9], 0.1, INK, "plastic");
  addCylinder(b, [-3.6, cTop + 6.9, -12], 0.02, 2.6, INK, "matte", 4);
  addCrate(b, [-3.6, cTop + 5.3, -12], 0.8, PALETTE.tape, "#9c3a20", 0.3);
  // Lighthouse on the far point.
  const lt = islet(ctx, scenery, 9, -45, 4.5, 4.5, 1.1);
  lighthouse(ctx, scenery, 9, lt, -45, 7.5);
  // Rocks at the waterline.
  for (let i = 0; i < 18; i++) addRock(scenery, [(rng() > 0.5 ? 1 : -1) * (7 + rng() * 6), ctx.waterLevel + 0.1, 8 - rng() * 56], [0.8 + rng(), 0.6 + rng() * 0.6, 0.8 + rng()], shade(theme.block.side, -0.05), rng);
}

function hatch(b: Batch, x: number, z: number, w: number, d: number, colors: [string, string]) {
  const t = 0.18;
  addStripes(b, [x, 0.006, z - d / 2], w, 0.012, t, colors, { segment: 0.26, family: "matte" });
  addStripes(b, [x, 0.006, z + d / 2], w, 0.012, t, colors, { segment: 0.26, family: "matte" });
  addStripes(b, [x - w / 2, 0.006, z], d, 0.012, t, colors, { segment: 0.26, rotY: Math.PI / 2, family: "matte" });
  addStripes(b, [x + w / 2, 0.006, z], d, 0.012, t, colors, { segment: 0.26, rotY: Math.PI / 2, family: "matte" });
}

/* ------------------------------ Summit Sync ------------------------------ */

function mountain(b: Batch, x: number, z: number, r: number, h: number, base: number, rock: string) {
  b.add(geo.cone(7), { pos: [x, base + h / 2, z], rot: [0, x * 0.1, 0], scale: [r * 2, h, r * 2] }, rock, "matte");
  b.add(geo.cone(7), { pos: [x, base + h * 0.82, z], rot: [0, x * 0.1, 0], scale: [r * 0.74, h * 0.36, r * 0.74] }, "#f3f7ff", "matte");
  b.add(geo.cone(5), { pos: [x + r * 0.35, base + h * 0.38, z + r * 0.2], rot: [0, 0.5, 0], scale: [r * 1.1, h * 0.6, r * 1.1] }, shade(rock, -0.06), "matte");
}

function summitSync(ctx: BuildContext) {
  const { b, scenery, theme, rng } = ctx;
  // A ring of peaks rising out of the cloud sea.
  const base = ctx.waterLevel - 2;
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * Math.PI * 2 + rng() * 0.3;
    const r = 46 + rng() * 26;
    mountain(scenery, Math.cos(a) * r, -30 + Math.sin(a) * r, 11 + rng() * 9, 22 + rng() * 26, base, i % 2 ? theme.ground.side : theme.block.side);
  }
  mountain(scenery, -26, -78, 18, 52, base, theme.block.deep);
  // Base camp: tent, crates, snowy pines.
  addBox(b, [-4.4, 0.55, 6], [0.05, 1.1, 1.9], "#ff7a3d", "cloth");
  b.add(geo.box(), { pos: [-4.75, 0.48, 6], rot: [0, 0, 0.62], scale: [0.05, 1.25, 1.9] }, "#ff7a3d", "matte");
  b.add(geo.box(), { pos: [-4.05, 0.48, 6], rot: [0, 0, -0.62], scale: [0.05, 1.25, 1.9] }, "#ff7a3d", "matte");
  addCrate(b, [4.6, 0.3, 6.4], 0.6, "#c98a52", "#6e4223", 0.2);
  addCrate(b, [4.8, 0.3, 5.6], 0.5, theme.accent, "#9c4a22", -0.3);
  for (const [x, z] of [[-5.3, -2.5], [5.2, 1.5], [-3.6, -46.5], [3.6, -43.5], [-3.4, -48.2]]) pine(b, x, 0, z, 1.1 + rng() * 0.4, true);
  // Expedition flags on the approach.
  [-4, -9, -14].forEach((z, i) => {
    for (const sx of [-1, 1]) addFlag(b, [sx * 4.05, 0, z], 2.2, i % 2 ? theme.accent : "#ffffff", { facing: sx > 0 ? Math.PI : 0, pennant: true });
  });
  // Prayer-flag lines along the ridge plateau.
  const prayer = ["#ff5d5d", "#ffd21a", "#3fe08f", "#4f8dff", "#ffffff"];
  for (const sx of [-1, 1]) {
    for (const z of [-24.6, -29]) addCylinder(b, [sx * 3.3, 1.9 + 1.2, z], 0.04, 2.4, "#c8b08a", "matte", 6);
    addBunting(b, [sx * 3.3, 4.2, -24.6], [sx * 3.3, 4.2, -29], prayer, { sag: 0.35, spacing: 0.42, size: 0.28 });
  }
  for (const sx of [-1, 1]) {
    addCylinder(b, [sx * 3.8, 1.1, -42.6], 0.04, 2.2, "#c8b08a", "matte", 6);
    addCylinder(b, [sx * 3.8, 1.1, -48.4], 0.04, 2.2, "#c8b08a", "matte", 6);
    addBunting(b, [sx * 3.8, 2.15, -42.6], [sx * 3.8, 2.15, -48.4], prayer, { sag: 0.3, spacing: 0.42, size: 0.26 });
  }
  // Ice crystals poking out of the cliffs.
  for (let i = 0; i < 26; i++) {
    const z = 4 - rng() * 62;
    const x = (rng() > 0.5 ? 1 : -1) * (4.6 + rng() * 2.5);
    const y = -0.6 - rng() * 2;
    addCone(scenery, [x, y, z], 0.18 + rng() * 0.2, 0.8 + rng() * 1.1, rng() > 0.5 ? theme.accent2 : "#d9fffb", "ice", 5, [(rng() - 0.5) * 1.2, rng() * 3, (rng() - 0.5) * 1.2]);
  }
  // Summit beacons on the timing corridor: orange flares you can see from the climb.
  for (const sx of [-1, 1]) {
    addCylinder(b, [sx * 2.6, 2.9, -61.1], 0.09, 1.8, "#3b4766", "metal", 8);
    addRounded(b, [sx * 2.6, 2.05, -61.1], [0.5, 0.1, 0.5], 0.03, "#3b4766", "metal");
  }
  const flareMat = ctx.own(ownedToyMaterial(PALETTE.tape, "glow"));
  const flareGeo = ctx.own(new THREE.SphereGeometry(0.26, 16, 12));
  const beamMat = ctx.own(new THREE.MeshBasicMaterial({ color: "#ffb36b", transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  const beamGeo = ctx.own(new THREE.CylinderGeometry(0.12, 0.5, 18, 12, 1, true));
  beamGeo.translate(0, 9, 0);
  const flares: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    const flare = new THREE.Mesh(flareGeo, flareMat);
    flare.position.set(sx * 2.6, 4, -61.1);
    ctx.group.add(flare);
    flares.push(flare);
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.copy(flare.position);
    ctx.group.add(beam);
  }
  ctx.animate((u) => {
    const k = 0.5 + 0.5 * Math.sin(u.time * 4);
    flareMat.emissive.set(PALETTE.tape);
    flareMat.emissiveIntensity = 0.6 + k * 0.9;
    for (const f of flares) f.scale.setScalar(1 + k * 0.15);
    beamMat.opacity = 0.14 + k * 0.12;
  });
  // A warning sign at the first gap.
  sign(ctx, "⚠ MIND THE GAP", [-1.95, 1.0, -29.6], 0.35, [1.9, 0.5], [PALETTE.dummy, INK]);
  addCylinder(b, [-1.95, 0.25, -29.65], 0.04, 0.9, "#f4f4f4", "metal", 6);
}

/* ------------------------------ Egg Express ------------------------------ */

function eggExpress(ctx: BuildContext) {
  const { b, scenery, theme, rng } = ctx;
  // The farm: a red barn and silo on their own meadow.
  const bt = islet(ctx, scenery, -11, 0, 7, 8, 0.8);
  addRounded(scenery, [-11, bt + 1.5, 0.4], [4.2, 3, 4.6], 0.08, "#d94a3c", "matte");
  for (const sx of [-1, 1]) scenery.add(geo.box(), { pos: [-11 + sx * 1.15, bt + 3.55, 0.4], rot: [0, 0, sx * -0.62], scale: [2.75, 0.2, 5] }, "#7a2a22", "matte");
  addBox(scenery, [-11, bt + 1.1, 2.72], [1.7, 2.2, 0.05], "#ffffff", "plastic");
  addBox(scenery, [-11, bt + 1.1, 2.75], [1.5, 2.0, 0.05], "#b23a2e", "matte");
  for (const r of [0.85, -0.85]) scenery.add(geo.box(), { pos: [-11, bt + 1.1, 2.79], rot: [0, 0, r], scale: [2.3, 0.12, 0.04] }, "#ffffff", "plastic");
  addCylinder(scenery, [-13.6, bt + 2.6, -2.2], 1, 5.2, "#c9ced8", "metal", 16);
  addSphere(scenery, [-13.6, bt + 5.2, -2.2], [1, 0.75, 1], "#7a2a22", "plastic", 2);
  for (let k = 0; k < 4; k++) {
    // chicks pecking around the barn
    const x = -9.4 + rng() * 2.5;
    const z = 3.2 + rng() * 0.6;
    addSphere(scenery, [x, bt + 0.14, z], 0.15, PALETTE.dummy, "plastic", 1);
    addSphere(scenery, [x, bt + 0.32, z - 0.08], 0.1, PALETTE.dummy, "plastic", 1);
    addCone(scenery, [x, bt + 0.32, z - 0.2], 0.03, 0.07, "#ff8a3d", "plastic", 4, [-Math.PI / 2, 0, 0]);
  }
  hayBale(scenery, -8.3, bt, -2.6, 0.2);
  hayBale(scenery, -8.6, bt, -1.4, -0.1);
  hayBale(scenery, -8.45, bt + 0.72, -2.0, 0.05);
  // Picket fences and sunflowers on the start meadow.
  for (const sx of [-1, 1]) {
    picketFence(b, [sx * 5.7, 7.4], [sx * 5.7, -3.2], 0);
    for (let k = 0; k < 4; k++) sunflower(b, sx * 5.35, 0, 6.6 - k * 2.6 - rng() * 0.6, 0.9 + rng() * 0.4, sx > 0 ? -Math.PI / 2 : Math.PI / 2);
    picketFence(b, [sx * 4.7, -35.4], [sx * 4.7, -42.6], 0);
  }
  // The nest the egg starts in.
  b.add(geo.torus(0.2, 20), { pos: [0, 0.62, 0], rot: [Math.PI / 2, 0, 0], scale: [0.62, 0.62, 0.62] }, "#d9a64a", "matte");
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    b.add(geo.box(), { pos: [Math.cos(a) * 0.32, 0.66, Math.sin(a) * 0.32], rot: [rng() * 0.4, a, rng() * 0.4], scale: [0.22, 0.02, 0.02] }, "#b8862e", "matte");
  }
  // The hatchery at the end: a big nest and a heart sign.
  b.add(geo.torus(0.3, 28), { pos: [0, 0.74, -40], rot: [Math.PI / 2, 0, 0], scale: [2.2, 2.2, 1.4] }, "#d9a64a", "matte");
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2;
    b.add(geo.box(), { pos: [Math.cos(a) * 1.08, 0.82, -40 + Math.sin(a) * 1.08], rot: [rng() * 0.5, a + 0.4, rng() * 0.5], scale: [0.55, 0.03, 0.03] }, "#b8862e", "matte");
  }
  addCylinder(b, [-1.9, 1.2, -42.4], 0.06, 2.4, "#ffffff", "plastic", 8);
  addCylinder(b, [1.9, 1.2, -42.4], 0.06, 2.4, "#ffffff", "plastic", 8);
  sign(ctx, "♥ HATCHERY ♥", [0, 2.3, -42.4], 0, [3.8, 0.8], [PALETTE.pink, INK]);
  // Soft padding: hay bales outside the lane, cushioned corners.
  for (const sx of [-1, 1]) {
    hayBale(b, sx * 4.1, 0, -5.5, 0);
    hayBale(b, sx * 4.1, 0, -13.5, 0);
  }
  for (const z of [-5, -8.8, -12.4]) addChevron(b, [0, 0.006, z], 0, 1, "#ffffff");
  // Windmill on its own island (the blades turn).
  const wt = islet(ctx, scenery, 9.5, -40, 4.5, 4.5, 0.9);
  addCylinder(scenery, [9.5, wt + 3, -40], 0.8, 6, "#fff3e6", "plastic", 10);
  addCone(scenery, [9.5, wt + 6.5, -40], 1.05, 1.2, "#d94a3c", "plastic", 10);
  const blades = animatedPiece(ctx, (pb) => {
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      pb.add(geo.box(), { pos: [Math.cos(a) * 1.6, Math.sin(a) * 1.6, 0], rot: [0, 0, a], scale: [3, 0.55, 0.06] }, k % 2 ? "#ffffff" : PALETTE.pink, "plastic");
    }
    addSphere(pb, [0, 0, 0.1], 0.3, INK, "plastic", 1);
  }, true);
  blades.position.set(9.5, wt + 5.4, -39.05);
  ctx.animate((u) => {
    blades.rotation.z = -u.time * 0.9;
  });
  // Flower meadows on more islets.
  for (const [x, z, w, d] of [[11, -12, 6, 6], [-12, -24, 6, 7], [12, -27, 5, 5], [-10, -45, 6, 6]] as const) {
    const top = islet(ctx, scenery, x, z, w, d, 0.6);
    for (let k = 0; k < 2; k++) toyTree(scenery, x + (rng() - 0.5) * (w - 2), top, z + (rng() - 0.5) * (d - 2), 1 + rng() * 0.4, k % 2 ? "#ff9fbf" : "#7ad65e", rng);
    for (let k = 0; k < 5; k++) addSphere(scenery, [x + (rng() - 0.5) * w * 0.8, top + 0.08, z + (rng() - 0.5) * d * 0.8], 0.08, k % 2 ? "#ffffff" : PALETTE.pink, "matte", 0);
  }
}

/* ------------------------------ Slam Dunk ------------------------------ */

function slamDunk(ctx: BuildContext) {
  const { b, scenery, theme, rng } = ctx;
  const line = "#ffffff";
  const y = 0.006;
  // Court: boundary, the paint, free-throw circle, three-point arc, logo.
  addBox(b, [0, y, -13.75], [15.9, 0.01, 0.09], line, "matte");
  addBox(b, [0, y, 7.25], [15.9, 0.01, 0.09], line, "matte");
  for (const sx of [-1, 1]) addBox(b, [sx * 7.95, y, -3.25], [0.09, 0.01, 21], line, "matte");
  addBox(b, [0, y - 0.001, -10.6], [3.6, 0.01, 4.4], "#7a4fd1", "matte");
  for (const sx of [-1, 1]) addBox(b, [sx * 1.8, y + 0.001, -10.6], [0.08, 0.01, 4.4], line, "matte");
  addBox(b, [0, y + 0.001, -8.4], [3.6, 0.01, 0.08], line, "matte");
  addDisc(b, [0, y + 0.001, -8.4], 1.72, 1.8, line, "matte", 40);
  {
    const arc = new THREE.RingGeometry(6.15, 6.25, 56, 1, Math.PI, Math.PI);
    arc.rotateX(-Math.PI / 2);
    b.add(arc, { pos: [0, y + 0.001, -12] }, line, "matte");
    arc.dispose();
    for (const sx of [-1, 1]) addBox(b, [sx * 6.2, y + 0.001, -12.9], [0.09, 0.01, 1.8], line, "matte");
  }
  addDisc(b, [0, y, 1.5], 1.7, 1.8, line, "matte", 40);
  addTarget(b, [0, y + 0.002, 1.5], 1.5);
  // Bleachers with a crowd on both sides.
  const rows = 4;
  const crowd: { x: number; y: number; z: number; color: string; phase: number }[] = [];
  const shirt = ["#ff5d5d", "#4fa8ff", "#ffd23f", "#6ef29a", "#c58bff", "#ff9a3c", "#ffffff"];
  for (const sx of [-1, 1]) {
    const top = islet(ctx, scenery, sx * 13.4, -3, 6.4, 22, 0.5);
    for (let r = 0; r < rows; r++) {
      const rx = sx * (11 + r * 1.1);
      const ry = top + 0.35 + r * 0.55;
      addBox(scenery, [rx, ry - 0.2, -3], [1.1, 0.55 + r * 0.55, 20], r % 2 ? "#3b2a6a" : "#4a3584", "plastic");
      addBox(scenery, [rx, ry + 0.09, -3], [1.12, 0.06, 20.02], theme.accent, "glow");
      const seats = ctx.compact ? 14 : 26;
      for (let k = 0; k < seats; k++) crowd.push({ x: rx, y: ry + 0.12, z: -12.5 + (k * 19) / (seats - 1) + (rng() - 0.5) * 0.25, color: shirt[Math.floor(rng() * shirt.length)], phase: rng() * Math.PI * 2 });
    }
  }
  const bodyGeo = ctx.own(new THREE.CapsuleGeometry(0.2, 0.25, 3, 8));
  const headGeo = ctx.own(new THREE.SphereGeometry(0.17, 10, 8));
  const bodies = new THREE.InstancedMesh(bodyGeo, ctx.own(new THREE.MeshStandardMaterial({ roughness: 0.8 })), crowd.length);
  const heads = new THREE.InstancedMesh(headGeo, ctx.own(new THREE.MeshStandardMaterial({ color: PALETTE.dummy, roughness: 0.6 })), crowd.length);
  const tmpColor = new THREE.Color();
  crowd.forEach((c, i) => bodies.setColorAt(i, tmpColor.set(c.color)));
  bodies.frustumCulled = false;
  heads.frustumCulled = false;
  ctx.group.add(bodies, heads);
  let excite = 0.3;
  ctx.onMoment((kind) => {
    if (kind === "score") excite = 1.6;
    if (kind === "finish") excite = 2.4;
    if (kind === "miss") excite = Math.max(excite, 0.7);
  });
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  let frame = 0;
  ctx.animate((u) => {
    excite = Math.max(0.25, excite - u.dt * 0.5);
    if (ctx.compact && frame++ % 2) return;
    crowd.forEach((c, i) => {
      const hop = Math.max(0, Math.sin(u.time * (4 + excite * 3) + c.phase)) * 0.12 * excite;
      p.set(c.x, c.y + 0.32 + hop, c.z);
      bodies.setMatrixAt(i, m.compose(p, q, sc));
      p.y += 0.42;
      heads.setMatrixAt(i, m.compose(p, q, sc));
    });
    bodies.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
  });
  // Jumbotron behind the hoop.
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const tex = ctx.own(new THREE.CanvasTexture(canvas));
  tex.colorSpace = THREE.SRGBColorSpace;
  const target = ctx.level.targetScore ?? 3;
  const draw = (score: number, flash: boolean) => {
    const c = canvas.getContext("2d")!;
    c.fillStyle = flash ? PALETTE.dummy : "#0b0d2c";
    c.fillRect(0, 0, 512, 256);
    c.fillStyle = flash ? INK : "#7a6ad6";
    c.font = "900 44px system-ui, sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(flash ? "SWISH!" : "SLAM DUNK", 256, 48);
    c.fillStyle = flash ? INK : PALETTE.dummy;
    c.font = "900 130px system-ui, sans-serif";
    c.fillText(`${score} / ${target}`, 256, 158);
    for (let i = 0; i < target; i++) {
      c.beginPath();
      c.arc(256 - (target - 1) * 26 + i * 52, 236, 13, 0, Math.PI * 2);
      c.fillStyle = i < score ? (flash ? INK : "#ff8a3d") : "#2b2d55";
      c.fill();
    }
    tex.needsUpdate = true;
  };
  draw(0, false);
  const screen = new THREE.Mesh(ctx.own(new THREE.PlaneGeometry(4.2, 2.1)), ctx.own(new THREE.MeshBasicMaterial({ map: tex })));
  screen.position.set(0, 7.3, -14.69);
  ctx.group.add(screen);
  addRounded(b, [0, 7.3, -15], [4.6, 2.5, 0.55], 0.12, INK, "plastic");
  for (const sx of [-1, 1]) addCylinder(b, [sx * 1.8, 9.6, -15], 0.03, 2.2, "#c9ced8", "metal", 4);
  let flashT = 0;
  let shown = 0;
  ctx.onMoment((kind, value) => {
    if (kind === "score") {
      shown = value ?? shown + 1;
      flashT = 1.4;
      draw(shown, true);
    }
    if (kind === "reset") {
      shown = 0;
      draw(0, false);
    }
  });
  ctx.animate((u) => {
    if (u.score !== shown && flashT <= 0) {
      shown = u.score;
      draw(shown, false);
    }
    if (flashT > 0) {
      flashT -= u.dt;
      if (flashT <= 0) draw(shown, false);
    }
  });
  // Light towers with soft beams.
  const beamMat = ctx.own(new THREE.MeshBasicMaterial({ color: "#fff3d6", transparent: true, opacity: 0.07, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  for (const [x, z] of [[-9.6, -14.5], [9.6, -14.5], [-9.6, 8.4], [9.6, 8.4]] as const) {
    addCylinder(scenery, [x, (ctx.waterLevel + 10) / 2, z], 0.18, 10 - ctx.waterLevel, "#3b2a6a", "metal", 8);
    addRounded(scenery, [x, 10, z], [1.4, 0.7, 0.5], 0.1, INK, "metal");
    for (const sx of [-0.4, 0, 0.4]) addSphere(scenery, [x + sx, 10, z + Math.sign(-z) * 0.26], 0.15, "#fff6d6", "glow", 1);
    if (!ctx.compact) {
      const len = Math.hypot(x, 10, z + 3);
      const cone = ctx.own(new THREE.ConeGeometry(2.4, len, 18, 1, true));
      cone.translate(0, -len / 2, 0);
      const beam = new THREE.Mesh(cone, beamMat);
      beam.position.set(x, 10, z);
      beam.lookAt(0, 0, -3);
      beam.rotateX(-Math.PI / 2);
      ctx.group.add(beam);
    }
  }
  // Pennants over the court and a sign behind the hoop.
  addBunting(b, [-9.6, 9, -14.5], [9.6, 9, -14.5], [theme.accent, "#ffffff", theme.accent2, PALETTE.dummy], { sag: 0.9, spacing: 0.7, size: 0.45 });
  const flag = new THREE.Mesh(ctx.own(flagGeometry(1.2, 0.7)), toyMaterial(theme.accent, "cloth"));
  flag.position.set(-9.6, 11, 8.4);
  ctx.group.add(flag);
}
