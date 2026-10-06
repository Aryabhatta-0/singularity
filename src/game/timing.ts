/**
 * Timing module — one deep module behind one seam for every clock,
 * conversion, and cadence constant in the game.
 *
 * Internal seams (step counting, unit conversion, send cadence) stay
 * composable inside; callers and tests cross this interface. Absorbs
 * time.ts, server-clock.ts, simulation-clock.ts, and network-tuning.ts.
 */

/* ------------------------------ wall clock ------------------------------ */

/** Local wall-clock milliseconds. Games ask the Timing module, not Date, so tests can substitute. */
export function nowMs(): number {
  return Date.now();
}

/** Convert SpacetimeDB timestamps, which are stored in microseconds, to milliseconds. */
export function microsToMilliseconds(micros: bigint): number {
  return Number(micros / 1000n);
}

/** Convert gameplay durations, which the module already stores in milliseconds. */
export function storedMilliseconds(milliseconds: bigint): number {
  return Number(milliseconds);
}

/* ------------------------------ server clock ------------------------------ */

/**
 * Estimates the room server's wall-clock offset from one-way timestamp
 * samples. Delivery delay only lowers a sample, so the highest recent sample
 * is the least biased. Keeps every client's countdown on the server's "GO".
 */
export class ServerClock {
  private samples: number[] = [];
  offsetMs = 0;

  constructor(private readonly capacity = 8) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("capacity must be a positive integer");
  }

  observe(serverTimestampMs: number, localReceiptMs: number) {
    if (!Number.isFinite(serverTimestampMs) || !Number.isFinite(localReceiptMs)) return;
    this.samples.push(serverTimestampMs - localReceiptMs);
    while (this.samples.length > this.capacity) this.samples.shift();
    this.offsetMs = Math.max(...this.samples);
  }

  now(localTimestampMs = nowMs()) {
    return localTimestampMs + this.offsetMs;
  }

  reset() {
    this.samples = [];
    this.offsetMs = 0;
  }
}

/* --------------------------- fixed-step simulation --------------------------- */

/**
 * Converts render-frame time into a bounded number of fixed simulation steps.
 * Work is bounded per render frame, but elapsed time is never silently erased.
 */
export class FixedStepClock {
  backlog = 0;

  constructor(
    readonly stepSeconds: number,
    readonly maxStepsPerFrame: number,
    readonly maxBacklogSeconds = Number.POSITIVE_INFINITY,
  ) {
    if (!(stepSeconds > 0) || !Number.isFinite(stepSeconds)) throw new Error("stepSeconds must be positive");
    if (!Number.isInteger(maxStepsPerFrame) || maxStepsPerFrame < 1) throw new Error("maxStepsPerFrame must be a positive integer");
    if (!(maxBacklogSeconds >= stepSeconds)) throw new Error("maxBacklogSeconds must cover at least one step");
  }

  advance(elapsedSeconds: number): number {
    if (Number.isFinite(elapsedSeconds) && elapsedSeconds > 0) {
      this.backlog = Math.min(this.maxBacklogSeconds, this.backlog + elapsedSeconds);
    }
    const available = Math.floor((this.backlog + this.stepSeconds * 1e-9) / this.stepSeconds);
    const steps = Math.min(available, this.maxStepsPerFrame);
    this.backlog = Math.max(0, this.backlog - steps * this.stepSeconds);
    return steps;
  }

  reset() {
    this.backlog = 0;
  }
}

/* ------------------------------ send cadence ------------------------------ */

/** Keep changed inputs responsive without turning every render frame into a reducer call. */
export const INPUT_CHANGE_SEND_INTERVAL_MS = 25;
export const INPUT_REFRESH_INTERVAL_MS = 100;

/** Host snapshots stay below the server's ~33 Hz hard ceiling. */
export const SNAPSHOT_SEND_INTERVAL_SECONDS = 1 / 30;

/* --------------------------- ghost interpolation --------------------------- */

/** Floor for the buffer: one-to-two snapshots, enough on a quiet LAN. */
export const SNAPSHOT_INTERPOLATION_DELAY_MS = 55;
/** Ceiling: past this, a viewer is better served by brief prediction than more lag. */
export const SNAPSHOT_MAX_INTERPOLATION_DELAY_MS = 320;
export const SNAPSHOT_MAX_EXTRAPOLATION_MS = 45;

export function snapshotExtrapolationSeconds(renderTimeMs: number, latestReceiveTimeMs: number): number {
  if (!Number.isFinite(renderTimeMs) || !Number.isFinite(latestReceiveTimeMs)) return 0;
  const aheadMs = Math.max(0, renderTimeMs - latestReceiveTimeMs);
  return Math.min(aheadMs, SNAPSHOT_MAX_EXTRAPOLATION_MS) / 1_000;
}

/**
 * Jitter buffer for one snapshot stream (a teammate's shared body or a rival
 * ghost). Each snapshot carries the server's receive time; stamping samples
 * on that timeline (shifted by the fastest delivery seen recently) keeps
 * their spacing even when the network delivers them in bursts. The render
 * delay then covers the delivery jitter actually measured: about one
 * snapshot interval on a LAN, a few hundred milliseconds on a shaky cellular
 * link. It grows at once when jitter rises and relaxes slowly, so playback
 * does not lurch back and forth.
 */
export class SnapshotTimeline {
  private offsets: number[] = [];
  private delayMs = SNAPSHOT_INTERPOLATION_DELAY_MS;
  private targetMs = SNAPSHOT_INTERPOLATION_DELAY_MS;
  private lastStamp = Number.NEGATIVE_INFINITY;
  private lastRenderAt: number | null = null;

  constructor(private readonly windowSize = 90) {}

  /** Local timeline stamp for a snapshot the server received at `serverMs`, observed locally at `localMs`. */
  observe(serverMs: number, localMs: number): number {
    if (!Number.isFinite(serverMs) || !Number.isFinite(localMs)) return Math.max(localMs, this.lastStamp + 1);
    this.offsets.push(localMs - serverMs);
    while (this.offsets.length > this.windowSize) this.offsets.shift();
    let fastest = Number.POSITIVE_INFINITY;
    for (const offset of this.offsets) fastest = Math.min(fastest, offset);
    // Second-worst lateness in the window: one freak delay should not set the pace.
    let worst = 0;
    let second = 0;
    for (const offset of this.offsets) {
      const late = offset - fastest;
      if (late > worst) {
        second = worst;
        worst = late;
      } else if (late > second) {
        second = late;
      }
    }
    const interval = SNAPSHOT_SEND_INTERVAL_SECONDS * 1_000;
    this.targetMs = Math.min(
      SNAPSHOT_MAX_INTERPOLATION_DELAY_MS,
      Math.max(SNAPSHOT_INTERPOLATION_DELAY_MS, (this.offsets.length > 1 ? second : worst) + interval + 12),
    );
    if (this.targetMs > this.delayMs) this.delayMs = this.targetMs;
    // A faster route can lower `fastest`; never stamp a sample before the previous one.
    this.lastStamp = Math.max(serverMs + fastest, this.lastStamp + 1);
    return this.lastStamp;
  }

  /** Where playback should sit now; call once per frame. */
  renderTime(localNowMs: number): number {
    const elapsed = this.lastRenderAt == null ? 0 : Math.max(0, localNowMs - this.lastRenderAt);
    this.lastRenderAt = localNowMs;
    // Relax by at most 4% of elapsed time, so shrinking the buffer is a gentle speed-up.
    if (this.targetMs < this.delayMs) this.delayMs = Math.max(this.targetMs, this.delayMs - elapsed * 0.04);
    return localNowMs - this.delayMs;
  }

  get currentDelayMs(): number {
    return this.delayMs;
  }

  reset() {
    this.offsets = [];
    this.delayMs = SNAPSHOT_INTERPOLATION_DELAY_MS;
    this.targetMs = SNAPSHOT_INTERPOLATION_DELAY_MS;
    this.lastStamp = Number.NEGATIVE_INFINITY;
    this.lastRenderAt = null;
  }
}

/* ------------------------------ link quality ------------------------------ */

export type LinkGrade = "good" | "fair" | "poor";

/**
 * Round-trip estimate from reducer acknowledgements (every input, snapshot
 * and heartbeat call is answered by the server). Smoothed like TCP's SRTT:
 * an average plus a mean deviation, so a single slow reply does not flip the
 * player-facing indicator.
 */
export class LinkQuality {
  rttMs: number | null = null;
  jitterMs = 0;
  private lastSampleAt = 0;

  observe(rttMs: number, atMs = nowMs()) {
    if (!Number.isFinite(rttMs) || rttMs < 0 || rttMs > 60_000) return;
    this.lastSampleAt = atMs;
    if (this.rttMs == null) {
      this.rttMs = rttMs;
      this.jitterMs = rttMs / 2;
      return;
    }
    this.jitterMs += (Math.abs(rttMs - this.rttMs) - this.jitterMs) / 4;
    this.rttMs += (rttMs - this.rttMs) / 8;
  }

  /** `quietMs`: how long the server has been silent while we expect traffic. */
  grade(quietMs = 0): LinkGrade {
    if (quietMs > 2_500) return "poor";
    if (this.rttMs == null) return "good";
    if (this.rttMs > 450 || this.jitterMs > 160) return "poor";
    if (this.rttMs > 200 || this.jitterMs > 70) return "fair";
    return "good";
  }

  get sampledAt(): number {
    return this.lastSampleAt;
  }

  reset() {
    this.rttMs = null;
    this.jitterMs = 0;
    this.lastSampleAt = 0;
  }
}
