import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { groundAt } from "../shared/course";
import type { Body } from "../shared/physics";
import { BodyPoseSampler, dampingAlpha } from "./body-pose";

const UP = new THREE.Vector3(0, 1, 0);

function shade(color: THREE.ColorRepresentation, amount: number) {
  const result = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  result.getHSL(hsl);
  result.setHSL(
    hsl.h,
    Math.min(1, hsl.s * (amount < 0 ? 0.95 : 1)),
    Math.min(1, Math.max(0, hsl.l + amount)),
  );
  return result;
}

function enableShadows(mesh: THREE.Mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function setSegment(
  mesh: THREE.Mesh,
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  direction: THREE.Vector3,
) {
  direction.copy(end).sub(start);
  const length = Math.max(direction.length(), 0.001);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.scale.set(radius, length, radius);
  mesh.quaternion.setFromUnitVectors(UP, direction.multiplyScalar(1 / length));
}

export interface CharacterRig {
  root: THREE.Group;
  setVisible(visible: boolean): void;
  update(attemptId: string, body: Body, time: number, deltaSeconds: number, preview: boolean): void;
  getFocus(target: THREE.Vector3): THREE.Vector3;
  getRenderTick(): number;
}

/**
 * Imperative Three.js port of the supplied character kit. The game keeps its
 * six authoritative physics nodes; this rig derives the extra elbows, knees,
 * chest, pelvis and facial detail strictly as presentation.
 */
export function createCharacter(
  team: number,
  color: THREE.ColorRepresentation,
): CharacterRig {
  const root = new THREE.Group();
  root.name = `team-${team}-character`;

  const bodyColor = new THREE.Color(color);
  const materials = {
    body: new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.55,
      metalness: 0.05,
    }),
    dark: new THREE.MeshStandardMaterial({
      color: shade(bodyColor, -0.22),
      roughness: 0.7,
    }),
    skin: new THREE.MeshStandardMaterial({
      color: 0xffd9b8,
      roughness: 0.6,
    }),
    glove: new THREE.MeshStandardMaterial({
      color: 0xfffaf0,
      roughness: 0.5,
    }),
    shoe: new THREE.MeshStandardMaterial({
      color: 0x2b2a3a,
      roughness: 0.5,
    }),
    white: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
    }),
    black: new THREE.MeshStandardMaterial({
      color: 0x1c1b28,
      roughness: 0.4,
    }),
    blush: new THREE.MeshStandardMaterial({
      color: 0xff9db0,
      roughness: 1,
      transparent: true,
      opacity: 0.6,
    }),
    badge: new THREE.MeshStandardMaterial({
      color: shade(bodyColor, 0.28),
      roughness: 0.4,
      emissive: bodyColor,
      emissiveIntensity: 0.25,
    }),
    cargo: new THREE.MeshStandardMaterial({
      color: 0xffcc70,
      roughness: 0.35,
      metalness: 0.25,
    }),
    cell: new THREE.MeshStandardMaterial({
      color: 0x69d9ff,
      roughness: 0.28,
      metalness: 0.45,
      emissive: 0x123c56,
      emissiveIntensity: 0.45,
    }),
    core: new THREE.MeshStandardMaterial({
      color: 0xff7b68,
      roughness: 0.22,
      metalness: 0.5,
      emissive: 0x6b1821,
      emissiveIntensity: 0.55,
    }),
  };

  const chest = enableShadows(
    new THREE.Mesh(
      new RoundedBoxGeometry(0.92, 0.88, 0.56, 4, 0.14),
      materials.body,
    ),
  );
  const pelvis = enableShadows(
    new THREE.Mesh(
      new RoundedBoxGeometry(0.72, 0.4, 0.5, 4, 0.12),
      materials.dark,
    ),
  );
  root.add(chest, pelvis);

  const badge = new THREE.Mesh(
    new THREE.CircleGeometry(0.14, 24),
    materials.badge,
  );
  badge.position.set(0, 0.04, 0.286);
  chest.add(badge);

  const segmentGeometry = new THREE.CylinderGeometry(1, 1, 1, 14);
  const upperArms = [0, 1].map(() =>
    enableShadows(new THREE.Mesh(segmentGeometry, materials.body)),
  );
  const forearms = [0, 1].map(() =>
    enableShadows(new THREE.Mesh(segmentGeometry, materials.skin)),
  );
  const thighs = [0, 1].map(() =>
    enableShadows(new THREE.Mesh(segmentGeometry, materials.body)),
  );
  const shins = [0, 1].map(() =>
    enableShadows(new THREE.Mesh(segmentGeometry, materials.body)),
  );
  root.add(...upperArms, ...forearms, ...thighs, ...shins);

  const jointGeometry = new THREE.SphereGeometry(1, 14, 10);
  const elbows = [0, 1].map(() =>
    enableShadows(new THREE.Mesh(jointGeometry, materials.skin)),
  );
  const knees = [0, 1].map(() =>
    enableShadows(new THREE.Mesh(jointGeometry, materials.body)),
  );
  const hands = [0, 1].map(() =>
    enableShadows(new THREE.Mesh(jointGeometry, materials.glove)),
  );
  root.add(...elbows, ...knees, ...hands);
  elbows.forEach((mesh) => mesh.scale.setScalar(0.145));
  knees.forEach((mesh) => mesh.scale.setScalar(0.17));
  hands.forEach((mesh) => mesh.scale.set(0.23, 0.21, 0.23));

  const feet = [0, 1].map(() =>
    enableShadows(
      new THREE.Mesh(
        new RoundedBoxGeometry(0.43, 0.25, 0.68, 4, 0.11),
        materials.shoe,
      ),
    ),
  );
  root.add(...feet);

  const neck = enableShadows(new THREE.Mesh(segmentGeometry, materials.skin));
  root.add(neck);

  const head = new THREE.Group();
  const headBase = enableShadows(
    new THREE.Mesh(new THREE.SphereGeometry(0.43, 24, 18), materials.skin),
  );
  const hair = enableShadows(
    new THREE.Mesh(
      new THREE.SphereGeometry(
        0.35,
        18,
        12,
        0,
        Math.PI * 2,
        0,
        Math.PI * 0.52,
      ),
      materials.body,
    ),
  );
  hair.position.set(0, 0.3, -0.05);
  hair.rotation.x = 0.3;
  head.add(headBase, hair);

  const eyes = [-0.15, 0.15].map((x) => {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.105, 14, 10),
      materials.white,
    );
    eye.position.set(x, 0.055, 0.35);
    head.add(eye);
    return eye;
  });
  const pupils = [-0.15, 0.15].map((x) => {
    const pupil = new THREE.Mesh(
      new THREE.SphereGeometry(0.047, 10, 8),
      materials.black,
    );
    pupil.position.set(x, 0.055, 0.436);
    head.add(pupil);
    return pupil;
  });
  const brows = [-0.15, 0.15].map((x) => {
    const brow = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.025, 0.022),
      materials.black,
    );
    brow.position.set(x, 0.17, 0.375);
    head.add(brow);
    return brow;
  });
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(0.09, 0.015, 6, 16, Math.PI),
    materials.black,
  );
  smile.position.set(0, -0.12, 0.4);
  smile.rotation.z = Math.PI;
  const surprisedMouth = new THREE.Mesh(
    new THREE.SphereGeometry(0.065, 12, 10),
    materials.black,
  );
  surprisedMouth.position.set(0, -0.14, 0.395);
  const flatMouth = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.022, 0.02),
    materials.black,
  );
  flatMouth.position.set(0, -0.13, 0.414);
  const cheeks = [-0.26, 0.26].map((x) => {
    const cheek = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 10, 8),
      materials.blush,
    );
    cheek.position.set(x, -0.06, 0.29);
    head.add(cheek);
    return cheek;
  });
  head.add(smile, surprisedMouth, flatMouth, ...cheeks);
  root.add(head);

  const payloads = [0, 1].map(() => {
    const group = new THREE.Group();
    const crate = enableShadows(
      new THREE.Mesh(
        new RoundedBoxGeometry(0.9, 0.9, 0.9, 3, 0.12),
        materials.cargo,
      ),
    );
    crate.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(crate.geometry),
        new THREE.LineBasicMaterial({ color: 0xfff3c4 }),
      ),
    );
    const cell = enableShadows(
      new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.9, 18), materials.cell),
    );
    cell.rotation.z = Math.PI / 2;
    const core = enableShadows(
      new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), materials.core),
    );
    const coreRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.66, 0.035, 8, 36),
      new THREE.MeshBasicMaterial({ color: 0xffd1a5 }),
    );
    core.add(coreRing);
    group.add(crate, cell, core);
    root.add(group);
    return { group, crate, cell, core };
  });

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.8, 0.85, 48),
    new THREE.MeshBasicMaterial({
      color: bodyColor,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  root.add(ring);

  const torsoPosition = new THREE.Vector3();
  const headPosition = new THREE.Vector3();
  const handPositions = [new THREE.Vector3(), new THREE.Vector3()];
  const footPositions = [new THREE.Vector3(), new THREE.Vector3()];
  const shoulders = [new THREE.Vector3(), new THREE.Vector3()];
  const elbowsTarget = [new THREE.Vector3(), new THREE.Vector3()];
  const hips = [new THREE.Vector3(), new THREE.Vector3()];
  const kneesTarget = [new THREE.Vector3(), new THREE.Vector3()];
  const basisUp = new THREE.Vector3();
  const basisRight = new THREE.Vector3();
  const basisForward = new THREE.Vector3();
  const supportRight = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const pole = new THREE.Vector3();
  const ikDirection = new THREE.Vector3();
  const ikPole = new THREE.Vector3();
  const neckStart = new THREE.Vector3();
  const neckEnd = new THREE.Vector3();
  const previousTorso = new THREE.Vector3();
  const bodyQuaternion = new THREE.Quaternion();
  const displayQuaternion = new THREE.Quaternion();
  const previewQuaternion = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);
  const bodyMatrix = new THREE.Matrix4();
  const poseSampler = new BodyPoseSampler();
  let renderTick = 0;
  let headYaw = 0;
  let poseInitialized = false;
  let wasGrounded = true;
  let landingPulse = 0;

  function readPoint(target: THREE.Vector3, positions: Float64Array, index: number) {
    const offset = index * 3;
    return target.set(positions[offset], positions[offset + 1], positions[offset + 2]);
  }

  function setExpression(body: Body, time: number) {
    const torsoNode = body.nodes[0];
    const falling = torsoNode.y < 1.15 || torsoNode.y - torsoNode.py < -0.16;
    const airborne = body.nodes[4].y > 0.72 && body.nodes[5].y > 0.72;
    const expression = body.finished
      ? 3
      : falling
        ? 2
        : body.brace || body.handGrip.some((grip) => grip >= 0)
          ? 1
          : airborne
            ? 3
            : 0;
    const blinking = (time + team * 0.73) % 3.6 < 0.11;
    const eyeOpen = expression === 3 ? 0.18 : blinking ? 0.1 : expression === 2 ? 1.35 : 1;
    eyes.forEach((eye) => eye.scale.set(1, eyeOpen, 1));
    pupils.forEach((pupil) => pupil.scale.setScalar(expression === 2 ? 0.65 : 1));
    smile.visible = expression === 0 || expression === 3;
    smile.scale.setScalar(expression === 3 ? 1.35 : 1);
    surprisedMouth.visible = expression === 2;
    flatMouth.visible = expression === 1;
    const browAngle = expression === 1 ? 0.5 : expression === 2 ? -0.35 : expression === 3 ? -0.15 : 0.1;
    const browY = expression === 2 ? 0.21 : 0.17;
    brows[0].rotation.z = -browAngle;
    brows[1].rotation.z = browAngle;
    brows.forEach((brow) => (brow.position.y = browY));
  }

  return {
    root,
    setVisible(visible) {
      if (!visible && root.visible) poseSampler.reset();
      root.visible = visible;
    },
    update(attemptId, body, time, deltaSeconds, preview) {
      const sampled = poseSampler.update(attemptId, body, time);
      renderTick = sampled.tick;
      readPoint(torsoPosition, sampled.positions, 0);
      readPoint(headPosition, sampled.positions, 1);
      readPoint(handPositions[0], sampled.positions, 2);
      readPoint(handPositions[1], sampled.positions, 3);
      readPoint(footPositions[0], sampled.positions, 4);
      readPoint(footPositions[1], sampled.positions, 5);

      const grounded = footPositions.some((foot) =>
        foot.y <= groundAt(body.challenge, foot.x, foot.z, sampled.tick) + 0.34
      );
      const verticalSpeed = poseInitialized && deltaSeconds > 0
        ? (torsoPosition.y - previousTorso.y) / Math.min(deltaSeconds, 0.1)
        : 0;
      landingPulse *= Math.exp(-10 * Math.min(Math.max(deltaSeconds, 0), 0.1));
      if (!sampled.snapped && poseInitialized && !wasGrounded && grounded && verticalSpeed < -0.8)
        landingPulse = Math.max(landingPulse, Math.min(1, (-verticalSpeed - 0.8) * 0.16));
      if (sampled.snapped) landingPulse = 0;
      previousTorso.copy(torsoPosition);
      poseInitialized = true;
      wasGrounded = grounded;

      buildBodyBasis(
        torsoPosition,
        headPosition,
        footPositions[0],
        footPositions[1],
        sampled.look,
        basisUp,
        basisRight,
        basisForward,
        supportRight,
      );
      bodyMatrix.makeBasis(basisRight, basisUp, basisForward);
      bodyQuaternion.setFromRotationMatrix(bodyMatrix);
      displayQuaternion.copy(bodyQuaternion);
      if (preview) displayQuaternion.premultiply(previewQuaternion);

      const squash = landingPulse;
      chest.position.copy(torsoPosition).addScaledVector(basisUp, 0.1 - squash * 0.035);
      chest.quaternion.copy(displayQuaternion);
      chest.scale.set(1 + squash * 0.055, 1 - squash * 0.11, 1 + squash * 0.055);
      pelvis.position.copy(torsoPosition).addScaledVector(basisUp, -0.42 + squash * 0.025);
      pelvis.quaternion.copy(displayQuaternion);
      pelvis.scale.set(1 + squash * 0.05, 1 - squash * 0.08, 1 + squash * 0.05);
      neckStart.copy(torsoPosition).addScaledVector(basisUp, 0.42 - squash * 0.035);
      neckEnd.copy(headPosition).addScaledVector(basisUp, -0.38);
      setSegment(neck, neckStart, neckEnd, 0.18, direction);
      head.position.copy(headPosition);
      const targetHeadYaw = sampled.look + (preview ? Math.PI : 0);
      headYaw = sampled.snapped
        ? targetHeadYaw
        : headYaw + angleDelta(targetHeadYaw, headYaw) * dampingAlpha(18, deltaSeconds);
      head.rotation.y = headYaw;
      setExpression(body, time);

      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? -1 : 1;
        shoulders[side]
          .copy(torsoPosition)
          .addScaledVector(basisRight, sign * (0.47 + squash * 0.025))
          .addScaledVector(basisUp, 0.28 - squash * 0.045);
        pole.copy(shoulders[side])
          .addScaledVector(basisRight, sign * 0.64)
          .addScaledVector(basisForward, -0.26)
          .addScaledVector(basisUp, 0.04);
        solveTwoBoneJoint(
          elbowsTarget[side],
          shoulders[side],
          handPositions[side],
          0.52,
          0.5,
          pole,
          ikDirection,
          ikPole,
        );
        elbows[side].position.copy(elbowsTarget[side]);
        hands[side].position.copy(handPositions[side]);
        setSegment(
          upperArms[side],
          shoulders[side],
          elbowsTarget[side],
          0.13,
          direction,
        );
        setSegment(
          forearms[side],
          elbowsTarget[side],
          handPositions[side],
          0.115,
          direction,
        );

        hips[side]
          .copy(torsoPosition)
          .addScaledVector(basisRight, sign * 0.22)
          .addScaledVector(basisUp, -0.42 + squash * 0.025);
        pole.copy(hips[side])
          .addScaledVector(basisRight, sign * 0.08)
          .addScaledVector(basisForward, 0.68)
          .addScaledVector(basisUp, -0.12);
        solveTwoBoneJoint(
          kneesTarget[side],
          hips[side],
          footPositions[side],
          0.72,
          0.72,
          pole,
          ikDirection,
          ikPole,
        );
        knees[side].position.copy(kneesTarget[side]);
        feet[side].position.copy(footPositions[side]);
        feet[side].position.y = Math.max(feet[side].position.y - 0.12, 0.14);
        feet[side].rotation.y = sampled.look + (preview ? Math.PI : 0);
        feet[side].scale.set(1 + squash * 0.04, 1 - squash * 0.05, 1 + squash * 0.08);
        setSegment(
          thighs[side],
          hips[side],
          kneesTarget[side],
          0.17,
          direction,
        );
        setSegment(
          shins[side],
          kneesTarget[side],
          footPositions[side],
          0.145,
          direction,
        );
      }

      payloads.forEach((payload, index) => {
        payload.group.visible = index < sampled.objectCount;
        if (!payload.group.visible) return;
        readPoint(payload.group.position, sampled.positions, sampled.nodeCount + index);
        payload.group.rotation.y = time * (0.18 + index * 0.05);
        payload.crate.visible = body.challenge === 0;
        payload.cell.visible = body.challenge === 1;
        payload.core.visible = body.challenge === 2;
      });
      ring.position.set(torsoPosition.x, 0.06, torsoPosition.z);
      const ringScale = ring.scale.x + ((body.brace ? 1.5 : 1) - ring.scale.x) * dampingAlpha(12, deltaSeconds);
      ring.scale.setScalar(ringScale);
    },
    getFocus(target) {
      return target.copy(torsoPosition);
    },
    getRenderTick() {
      return renderTick;
    },
  };
}

function buildBodyBasis(
  torso: THREE.Vector3,
  head: THREE.Vector3,
  leftFoot: THREE.Vector3,
  rightFoot: THREE.Vector3,
  look: number,
  up: THREE.Vector3,
  right: THREE.Vector3,
  forward: THREE.Vector3,
  support: THREE.Vector3,
) {
  up.copy(head).sub(torso);
  if (up.lengthSq() < 0.0025) up.copy(UP);
  else up.normalize();
  if (up.dot(UP) < 0.2) up.lerp(UP, 0.7).normalize();

  forward.set(Math.sin(look), 0, Math.cos(look));
  forward.addScaledVector(up, -forward.dot(up));
  if (forward.lengthSq() < 0.0025) forward.set(0, 0, 1);
  forward.normalize();
  right.crossVectors(up, forward).normalize();

  support.copy(rightFoot).sub(leftFoot);
  support.addScaledVector(up, -support.dot(up));
  if (support.lengthSq() > 0.01) {
    support.normalize();
    if (support.dot(right) < 0) support.negate();
    right.lerp(support, 0.32).normalize();
  }
  forward.crossVectors(right, up).normalize();
  right.crossVectors(up, forward).normalize();
}

function solveTwoBoneJoint(
  joint: THREE.Vector3,
  start: THREE.Vector3,
  end: THREE.Vector3,
  upperLength: number,
  lowerLength: number,
  pole: THREE.Vector3,
  direction: THREE.Vector3,
  poleDirection: THREE.Vector3,
) {
  direction.copy(end).sub(start);
  const distance = Math.max(direction.length(), 0.001);
  direction.multiplyScalar(1 / distance);
  const stretch = Math.max(1, distance / Math.max(upperLength + lowerLength - 0.001, 0.001));
  const upper = upperLength * stretch;
  const lower = lowerLength * stretch;
  const along = Math.min(
    upper,
    Math.max(0, (upper * upper - lower * lower + distance * distance) / (2 * distance)),
  );
  const height = Math.sqrt(Math.max(0, upper * upper - along * along));

  poleDirection.copy(pole).sub(start);
  poleDirection.addScaledVector(direction, -poleDirection.dot(direction));
  if (poleDirection.lengthSq() < 0.0001) {
    poleDirection.crossVectors(direction, UP);
    if (poleDirection.lengthSq() < 0.0001) poleDirection.set(1, 0, 0);
  }
  poleDirection.normalize();
  joint.copy(start)
    .addScaledVector(direction, along)
    .addScaledVector(poleDirection, height);
}

function angleDelta(target: number, current: number) {
  return Math.atan2(Math.sin(target - current), Math.cos(target - current));
}
