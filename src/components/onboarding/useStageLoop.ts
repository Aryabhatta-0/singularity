"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduce(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduce;
}

export interface StageFrame {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  dt: number;
  /** Seconds since the loop started (pauses don't count). */
  t: number;
  font: string;
  /** True on the first frame after a resize. */
  resized: boolean;
}

/**
 * Runs `frame` on requestAnimationFrame while the canvas is on screen and the
 * tab is visible. With `still`, it draws one frame per resize instead of looping.
 */
export function useStageLoop(canvasRef: RefObject<HTMLCanvasElement | null>, frame: (f: StageFrame) => void, still: boolean) {
  const frameRef = useRef(frame);
  const drawRef = useRef<(dt: number) => void>(() => {});
  useEffect(() => {
    frameRef.current = frame;
  });
  const redraw = useCallback(() => drawRef.current(0), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let resized = true;
    let raf = 0;
    let last = 0;
    let t = 0;
    let onScreen = true;
    let font = getComputedStyle(canvas).fontFamily || "system-ui";

    const draw = (dt: number) => {
      if (w === 0 || h === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      frameRef.current({ ctx, w, h, dt, t, font, resized });
      resized = false;
    };
    drawRef.current = draw;

    const tick = (now: number) => {
      raf = 0;
      const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 1 / 60;
      last = now;
      t += dt;
      draw(dt);
      schedule();
    };

    const schedule = () => {
      if (still || raf || !onScreen || document.hidden) return;
      raf = requestAnimationFrame(tick);
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      resized = true;
      if (still) draw(0);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      last = 0;
      schedule();
    });
    io.observe(canvas);
    const onVis = () => {
      last = 0;
      schedule();
    };
    document.addEventListener("visibilitychange", onVis);
    // Canvas text needs the web font; redraw once it lands.
    document.fonts?.ready.then(() => {
      font = getComputedStyle(canvas).fontFamily || font;
      if (still) draw(0);
    });

    resize();
    schedule();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      drawRef.current = () => {};
    };
  }, [canvasRef, still]);

  return redraw;
}

/** Small seeded PRNG so choreography is repeatable. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SPRING_EASE =
  "linear(0, 0.065, 0.23, 0.449, 0.681, 0.895, 1.068, 1.189, 1.256, 1.275, 1.255, 1.208, 1.147, 1.083, 1.025, 0.979, 0.946, 0.929, 0.924, 0.931, 0.944, 0.961, 0.978, 0.994, 1.007, 1.015, 1.02, 1.021, 1.019, 1.015, 1.01, 1.006, 1.001, 0.998, 0.996, 0.995, 0.994, 0.995, 0.996, 0.997, 1)";
