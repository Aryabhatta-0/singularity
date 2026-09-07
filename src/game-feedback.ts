import { challengeFor, groundAt, isNextFinalStepAligned } from "../shared/course.ts";
import { DT, isFinaleInputWindow, type Body } from "../shared/physics.ts";

export type GameFeedbackKind =
  | "align"
  | "step"
  | "lift"
  | "land"
  | "grip"
  | "impact"
  | "stage"
  | "fall"
  | "mistake"
  | "finish";

export type GameFeedbackEvent = Readonly<{
  kind: GameFeedbackKind;
  x: number;
  y: number;
  z: number;
  strength: number;
}>;

type FeedbackEmitter = (event: GameFeedbackEvent) => void;

const STEP_TICKS = 7;

function hazardMask(body: Body) {
  let mask = 0;
  for (let index = 0; index < body.hazardContacts.length; index++)
    if (body.hazardContacts[index]) mask |= 1 << index;
  return mask;
}

function finaleWindowOpen(body: Body) {
  return challengeFor(body.challenge).stages[body.stage]?.kind === "finalTiming" &&
    isNextFinalStepAligned(body.ticks);
}

export class GameFeedbackTracker {
  private readonly emit: FeedbackEmitter;
  private initialized = false;
  private attemptId = "";
  private tick = -1;
  private challenge = -1;
  private crewSize = -1;
  private stage = 0;
  private falls = 0;
  private mistakes = 0;
  private hazardMask = 0;
  private grips: [number, number] = [-1, -1];
  private airborne = false;
  private stepBeat = 0;
  private finaleWindowAnnounced = false;

  constructor(emit: FeedbackEmitter) {
    this.emit = emit;
  }

  reset() {
    this.initialized = false;
  }

  update(attemptId: string, body: Body) {
    const incompatible = !this.initialized ||
      this.attemptId !== attemptId ||
      this.challenge !== body.challenge ||
      this.crewSize !== body.crewSize ||
      body.ticks < this.tick;
    if (incompatible) {
      this.capture(attemptId, body, true);
      return;
    }

    const torso = body.nodes[0];
    if (body.falls > this.falls) {
      this.emitAt("fall", torso, 1);
      this.capture(attemptId, body, true);
      return;
    }
    if (body.stage > this.stage)
      this.emitAt(body.finished ? "finish" : "stage", torso, body.finished ? 1 : 0.65);
    if (body.mistakes > this.mistakes) this.emitAt("mistake", torso, 0.85);
    const activeHazards = hazardMask(body);
    if ((activeHazards & ~this.hazardMask) !== 0) this.emitAt("impact", torso, body.brace ? 0.45 : 1);
    const windowOpen = finaleWindowOpen(body);
    if (!windowOpen) this.finaleWindowAnnounced = false;
    else if (body.syncStarted || body.lockout > 0) this.finaleWindowAnnounced = true;
    if (isFinaleInputWindow(body) && !this.finaleWindowAnnounced) {
      this.emitAt("align", torso, 0.55);
      this.finaleWindowAnnounced = true;
    }

    for (let side = 0; side < 2; side++) {
      if (this.grips[side] < 0 && body.handGrip[side] >= 0)
        this.emitAt("grip", body.nodes[side + 2], 0.45);
    }

    if (body.ticks !== this.tick) {
      const airborne = this.bodyIsAirborne(body);
      if (!this.airborne && airborne) this.emitAt("lift", torso, 0.5);
      if (this.airborne && !airborne) {
        const downwardSpeed = Math.max(0, -(torso.y - torso.py) / DT);
        this.emitAt("land", torso, Math.min(1, 0.35 + downwardSpeed * 0.13));
      }

      const speed = Math.hypot(torso.x - torso.px, torso.z - torso.pz) / DT;
      const beat = Math.floor(body.ticks / STEP_TICKS);
      if (!airborne && speed > 1.1 && beat > this.stepBeat) {
        const side = beat % 2;
        this.emitAt("step", body.nodes[side + 4], Math.min(0.5, speed / 8));
      }
      this.airborne = airborne;
      this.stepBeat = beat;
    }

    this.capture(attemptId, body, false);
  }

  private emitAt(kind: GameFeedbackKind, point: Body["nodes"][number], strength: number) {
    this.emit({ kind, x: point.x, y: point.y, z: point.z, strength });
  }

  private capture(attemptId: string, body: Body, resetMotion: boolean) {
    this.initialized = true;
    this.attemptId = attemptId;
    this.tick = body.ticks;
    this.challenge = body.challenge;
    this.crewSize = body.crewSize;
    this.stage = body.stage;
    this.falls = body.falls;
    this.mistakes = body.mistakes;
    this.hazardMask = hazardMask(body);
    this.grips[0] = body.handGrip[0];
    this.grips[1] = body.handGrip[1];
    if (resetMotion) {
      this.airborne = this.bodyIsAirborne(body);
      this.stepBeat = Math.floor(body.ticks / STEP_TICKS);
      this.finaleWindowAnnounced = finaleWindowOpen(body) &&
        (isFinaleInputWindow(body) || body.syncStarted || body.lockout > 0);
    }
  }

  private bodyIsAirborne(body: Body) {
    for (let side = 0; side < 2; side++) {
      const foot = body.nodes[side + 4];
      const surface = groundAt(body.challenge, foot.x, foot.z, body.ticks);
      if (surface > -10 && foot.y - surface - 0.25 <= 0.2) return false;
    }
    return true;
  }
}
