import type { Body } from "../shared/physics.ts";

const TICK_SECONDS = 1 / 30;
const MAX_BLEND_SECONDS = 0.12;
const TELEPORT_DISTANCE = 4;

export type SampledBodyPose = {
  positions: Float64Array;
  nodeCount: number;
  objectCount: number;
  tick: number;
  look: number;
  snapped: boolean;
};

export class BodyPoseSampler {
  private from = new Float64Array();
  private target = new Float64Array();
  private output = new Float64Array();
  private fromTick = 0;
  private targetTick = 0;
  private fromLook = 0;
  private targetLook = 0;
  private receivedAt = 0;
  private blendSeconds = TICK_SECONDS;
  private attemptId = "";
  private challenge = -1;
  private crewSize = -1;
  private falls = -1;
  private sourceTick = -1;
  private initialized = false;
  private readonly sampled: SampledBodyPose = {
    positions: this.output,
    nodeCount: 0,
    objectCount: 0,
    tick: 0,
    look: 0,
    snapped: true,
  };

  reset() {
    this.initialized = false;
  }

  update(attemptId: string, body: Body, nowSeconds: number): SampledBodyPose {
    const now = Number.isFinite(nowSeconds) ? nowSeconds : 0;
    const pointCount = body.nodes.length + body.objects.length;
    const coordinateCount = pointCount * 3;
    const incompatible = !this.initialized ||
      this.attemptId !== attemptId ||
      this.challenge !== body.challenge ||
      this.crewSize !== body.crewSize ||
      this.falls !== body.falls ||
      body.ticks < this.sourceTick ||
      this.target.length !== coordinateCount ||
      this.teleported(body);

    if (incompatible) {
      this.resize(coordinateCount);
      capture(body, this.target);
      this.from.set(this.target);
      this.output.set(this.target);
      this.fromTick = this.targetTick = body.ticks;
      this.fromLook = this.targetLook = body.look;
      this.receivedAt = now;
      this.assignSource(attemptId, body);
      this.writeResult(body, true);
      return this.sampled;
    }

    if (body.ticks !== this.sourceTick) {
      this.interpolate(now);
      this.from.set(this.output);
      this.fromTick = this.sampled.tick;
      this.fromLook = this.sampled.look;
      capture(body, this.target);
      this.targetTick = body.ticks;
      this.targetLook = body.look;
      this.blendSeconds = Math.min(
        MAX_BLEND_SECONDS,
        Math.max(TICK_SECONDS, (body.ticks - this.sourceTick) * TICK_SECONDS),
      );
      this.receivedAt = now;
      this.assignSource(attemptId, body);
    }

    this.interpolate(now);
    this.writeResult(body, false);
    return this.sampled;
  }

  private resize(length: number) {
    if (this.target.length === length) return;
    this.from = new Float64Array(length);
    this.target = new Float64Array(length);
    this.output = new Float64Array(length);
    this.sampled.positions = this.output;
  }

  private teleported(body: Body) {
    if (!this.initialized || this.target.length < 3 || body.nodes.length === 0) return false;
    const torso = body.nodes[0];
    return Math.hypot(
      torso.x - this.target[0],
      torso.y - this.target[1],
      torso.z - this.target[2],
    ) > TELEPORT_DISTANCE;
  }

  private assignSource(attemptId: string, body: Body) {
    this.attemptId = attemptId;
    this.challenge = body.challenge;
    this.crewSize = body.crewSize;
    this.falls = body.falls;
    this.sourceTick = body.ticks;
    this.initialized = true;
  }

  private interpolate(now: number) {
    const alpha = clamp((now - this.receivedAt) / this.blendSeconds, 0, 1);
    for (let index = 0; index < this.output.length; index++)
      this.output[index] = this.from[index] + (this.target[index] - this.from[index]) * alpha;
    this.sampled.tick = this.fromTick + (this.targetTick - this.fromTick) * alpha;
    this.sampled.look = this.fromLook + angleDelta(this.targetLook, this.fromLook) * alpha;
  }

  private writeResult(body: Body, snapped: boolean) {
    this.sampled.nodeCount = body.nodes.length;
    this.sampled.objectCount = body.objects.length;
    this.sampled.snapped = snapped;
  }
}

export function dampingAlpha(rate: number, deltaSeconds: number): number {
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return 0;
  return 1 - Math.exp(-rate * Math.min(deltaSeconds, 0.1));
}

function capture(body: Body, output: Float64Array) {
  let offset = 0;
  for (const point of [...body.nodes, ...body.objects]) {
    output[offset++] = point.x;
    output[offset++] = point.y;
    output[offset++] = point.z;
  }
}

function angleDelta(target: number, current: number) {
  return Math.atan2(Math.sin(target - current), Math.cos(target - current));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
