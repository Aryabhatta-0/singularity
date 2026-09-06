/**
 * Estimates server wall-clock offset from one-way timestamp samples. Delivery
 * delay only lowers a sample, so the highest recent sample is least biased.
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

  now(localTimestampMs = Date.now()) {
    return localTimestampMs + this.offsetMs;
  }

  reset() {
    this.samples = [];
    this.offsetMs = 0;
  }
}
