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
