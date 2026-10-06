/**
 * Adaptive render quality. On a GPU that can't keep up (older phones,
 * software rendering), pixels are the cheapest thing to give up: physics,
 * input and networking never depend on them. Frame times are averaged over
 * two-second windows; a slow window steps resolution down (and finally drops
 * shadows), and only a run of comfortably fast windows steps it back up, so
 * quality never flickers between levels.
 */

/** Resolution multipliers applied to the device pixel ratio cap, best first. The last level also drops shadows. */
export const RENDER_LEVELS = [1, 0.85, 0.7, 0.6, 0.6] as const;
export const SHADOWLESS_LEVEL = RENDER_LEVELS.length - 1;

const WINDOW_SECONDS = 2;
/** Below ~28 fps. Kept under 33 ms so a display or battery saver capped at 30 Hz isn't mistaken for a slow GPU. */
const SLOW_FRAME_SECONDS = 0.036;
/** Above ~45 fps: room to spare. */
const FAST_FRAME_SECONDS = 0.022;
const FAST_WINDOWS_TO_RECOVER = 3;
/** Frames this long are hitches (tab switch, GC, alert), not render cost. */
const HITCH_SECONDS = 0.25;

export class RenderQuality {
  level = 0;
  private elapsed = 0;
  private frames = 0;
  private fastWindows = 0;

  get scale(): number {
    return RENDER_LEVELS[this.level];
  }

  get shadows(): boolean {
    return this.level < SHADOWLESS_LEVEL;
  }

  /** Feed one frame's duration. Returns true when the level changed. */
  sample(dtSeconds: number): boolean {
    if (!(dtSeconds > 0) || dtSeconds > HITCH_SECONDS) return false;
    this.elapsed += dtSeconds;
    this.frames += 1;
    if (this.elapsed < WINDOW_SECONDS) return false;
    const average = this.elapsed / this.frames;
    this.elapsed = 0;
    this.frames = 0;
    if (average > SLOW_FRAME_SECONDS && this.level < RENDER_LEVELS.length - 1) {
      this.level += 1;
      this.fastWindows = 0;
      return true;
    }
    if (average < FAST_FRAME_SECONDS && this.level > 0) {
      this.fastWindows += 1;
      if (this.fastWindows >= FAST_WINDOWS_TO_RECOVER) {
        this.level -= 1;
        this.fastWindows = 0;
        return true;
      }
      return false;
    }
    this.fastWindows = 0;
    return false;
  }
}
