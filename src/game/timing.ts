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

/** Buffer one-to-two snapshots, then predict briefly instead of freezing on jitter. */
export const SNAPSHOT_INTERPOLATION_DELAY_MS = 55;
export const SNAPSHOT_MAX_EXTRAPOLATION_MS = 45;

export function snapshotExtrapolationSeconds(renderTimeMs: number, latestReceiveTimeMs: number): number {
  if (!Number.isFinite(renderTimeMs) || !Number.isFinite(latestReceiveTimeMs)) return 0;
  const aheadMs = Math.max(0, renderTimeMs - latestReceiveTimeMs);
  return Math.min(aheadMs, SNAPSHOT_MAX_EXTRAPOLATION_MS) / 1_000;
}
