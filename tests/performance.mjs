import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

const requestedChannel = process.env.PLAYWRIGHT_CHANNEL;
const channel = requestedChannel || (existsSync(chromium.executablePath()) ? undefined : "chrome");
const browser = await chromium.launch({
  ...(channel ? { channel } : {}),
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist"],
});
const url = process.env.TEST_URL || "http://127.0.0.1:5173";
const results = [];

try {
  for (const challenge of [0, 1, 2]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.addInitScript(() => {
      const metrics = { frameCalls: 0, domMutations: 0 };
      window.__singularityRenderMetrics = metrics;
      window.__singularityMutationObserver = new MutationObserver(records => {
        metrics.domMutations += records.length;
      });
      window.__singularityMutationObserver.observe(document, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      });
      const patched = new Set();
      for (const prototype of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
        for (const name of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
          const original = prototype[name];
          if (typeof original !== "function" || patched.has(original)) continue;
          patched.add(original);
          prototype[name] = function (...args) {
            metrics.frameCalls++;
            return original.apply(this, args);
          };
        }
      }
      window.__measureSingularityRender = durationMs => new Promise(resolve => {
        requestAnimationFrame(start => {
          const samples = [];
          let previous = start;
          metrics.frameCalls = 0;
          metrics.domMutations = 0;
          window.__singularityMutationObserver.takeRecords();
          const sample = now => {
            samples.push({ frameMs: now - previous, drawCalls: metrics.frameCalls });
            metrics.frameCalls = 0;
            previous = now;
            if (now - start >= durationMs) {
              metrics.domMutations += window.__singularityMutationObserver.takeRecords().length;
              resolve({ samples, durationMs: now - start, domMutations: metrics.domMutations });
              return;
            }
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
      });
    });
    await page.goto(url);
    await page.locator(`[data-home-challenge="${challenge}"]`).click();
    await page.locator("#practice").click();
    await page.waitForFunction(() => document.body.classList.contains("playing"));
    await page.waitForTimeout(1_500);
    const { samples, durationMs, domMutations } = await page.evaluate(() => window.__measureSingularityRender(2_000));
    assert.deepEqual(pageErrors, []);
    assert.ok(samples.length > 0, `challenge ${challenge} produced no animation frames`);
    const rendered = samples.filter(sample => sample.drawCalls > 0);
    assert.ok(rendered.length > 0, `challenge ${challenge} produced no rendered frames`);
    const percentile = (values, rank) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * rank) - 1))];
    };
    const frameTimes = samples.map(sample => sample.frameMs);
    const drawCalls = rendered.map(sample => sample.drawCalls);
    const fps = samples.length * 1_000 / durationMs;
    const meanFrameMs = durationMs / samples.length;
    const p95FrameMs = percentile(frameTimes, 0.95);
    const maxFrameMs = Math.max(...frameTimes);
    const meanDrawCalls = drawCalls.reduce((sum, value) => sum + value, 0) / drawCalls.length;
    const p95DrawCalls = percentile(drawCalls, 0.95);
    const renderedRatio = rendered.length / samples.length;
    const mutationsPerSecond = domMutations * 1_000 / durationMs;
    assert.ok(fps >= 50, `challenge ${challenge} ran at ${fps.toFixed(1)} FPS`);
    assert.ok(p95FrameMs <= 34, `challenge ${challenge} p95 frame time was ${p95FrameMs.toFixed(1)}ms`);
    assert.ok(renderedRatio >= 0.98, `challenge ${challenge} rendered only ${(renderedRatio * 100).toFixed(1)}% of animation frames`);
    assert.ok(meanDrawCalls <= 150, `challenge ${challenge} averaged ${meanDrawCalls.toFixed(1)} draw calls`);
    assert.ok(mutationsPerSecond <= 120, `challenge ${challenge} produced ${mutationsPerSecond.toFixed(1)} DOM mutations/sec`);
    results.push({
      challenge,
      fps: Number(fps.toFixed(1)),
      frames: samples.length,
      durationMs: Number(durationMs.toFixed(1)),
      meanFrameMs: Number(meanFrameMs.toFixed(2)),
      p95FrameMs: Number(p95FrameMs.toFixed(2)),
      maxFrameMs: Number(maxFrameMs.toFixed(2)),
      meanDrawCalls: Number(meanDrawCalls.toFixed(1)),
      p95DrawCalls,
      renderedRatio: Number(renderedRatio.toFixed(3)),
      mutationsPerSecond: Number(mutationsPerSecond.toFixed(1)),
    });
    await page.close();
  }
  console.log(`PASS: warm render budget ${JSON.stringify(results)}`);
} finally {
  await browser.close();
}
