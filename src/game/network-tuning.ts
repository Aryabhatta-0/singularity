/** Keep changed inputs responsive without turning every render frame into a reducer call. */
export const INPUT_CHANGE_SEND_INTERVAL_MS = 25;
export const INPUT_REFRESH_INTERVAL_MS = 100;

/** Host snapshots stay below the server's ~33 Hz hard ceiling. */
export const SNAPSHOT_SEND_INTERVAL_SECONDS = 1 / 30;

/** Buffer one-to-two snapshots, then predict briefly instead of freezing on jitter. */
export const SNAPSHOT_INTERPOLATION_DELAY_MS = 55;
export const SNAPSHOT_MAX_EXTRAPOLATION_MS = 45;

export function snapshotExtrapolationSeconds(renderTimeMs: number, latestReceiveTimeMs: number): number {
  if (!Number.isFinite(renderTimeMs) || !Number.isFinite(latestReceiveTimeMs)) return 0;
  const aheadMs = Math.max(0, renderTimeMs - latestReceiveTimeMs);
  return Math.min(aheadMs, SNAPSHOT_MAX_EXTRAPOLATION_MS) / 1_000;
}
