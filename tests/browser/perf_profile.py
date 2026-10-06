"""Performance profile: landing-page load and in-game frame times, normal and
throttled (Chrome DevTools CPU throttling plus a slow mobile network).

Writes PLAYWRIGHT_ARTIFACT_DIR/perf.json and prints a table. Numbers are only
comparable on the same machine: headless Chrome renders WebGL with
SwiftShader (a CPU rasteriser), so absolute frame rates are a pessimistic
floor, not what a phone GPU achieves. The point is to compare profiles and
to separate render cost (frame times) from network cost (load timings).

    PLAYWRIGHT_BASE_URL=https://singularity-coral.vercel.app python tests/browser/perf_profile.py
"""

from __future__ import annotations

import json
import os
import re
import statistics
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("PLAYWRIGHT_BASE_URL", "http://localhost:3001")
ARTIFACT_DIR = Path(os.environ.get("PLAYWRIGHT_ARTIFACT_DIR", ".test-dist/browser"))
SLOW_4G = {"offline": False, "latency": 150, "downloadThroughput": 1_600_000 / 8, "uploadThroughput": 750_000 / 8}
PROFILES = {
    "desktop": {"viewport": (1440, 900), "cpu": 1, "network": None},
    "phone": {"viewport": (390, 844), "cpu": 1, "network": None},
    "phone-4x-cpu-slow-4g": {"viewport": (390, 844), "cpu": 4, "network": SLOW_4G},
}

OBSERVE = """
window.__perf = { lcp: 0, longTasks: 0, longTaskMs: 0 };
new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.lcp = e.startTime; })
  .observe({ type: 'largest-contentful-paint', buffered: true });
new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__perf.longTasks++; window.__perf.longTaskMs += e.duration; } })
  .observe({ type: 'longtask', buffered: true });
"""

FRAMES = """(ms) => new Promise((resolve) => {
  const times = []; let last = performance.now(); const end = last + ms;
  const tick = (now) => { times.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else resolve(times); };
  requestAnimationFrame(tick);
})"""


def pct(values: list[float], p: float) -> float:
    ordered = sorted(values)
    return round(ordered[min(len(ordered) - 1, int(p * len(ordered)))], 1)


def run() -> None:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    report: dict[str, dict] = {}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            channel="chrome", headless=True,
            args=["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
        )
        for name, profile in PROFILES.items():
            width, height = profile["viewport"]
            phone = width < 1000
            ctx = browser.new_context(viewport={"width": width, "height": height}, has_touch=phone, is_mobile=phone)
            ctx.add_init_script(OBSERVE)
            page = ctx.new_page()
            cdp = ctx.new_cdp_session(page)
            cdp.send("Network.enable")
            cdp.send("Network.setCacheDisabled", {"cacheDisabled": True})
            if profile["cpu"] > 1:
                cdp.send("Emulation.setCPUThrottlingRate", {"rate": profile["cpu"]})
            if profile["network"]:
                cdp.send("Network.emulateNetworkConditions", profile["network"])

            page.goto(BASE_URL, wait_until="load", timeout=120_000)
            page.wait_for_timeout(2_500)
            load = page.evaluate("""() => {
              const nav = performance.getEntriesByType('navigation')[0];
              const fcp = performance.getEntriesByName('first-contentful-paint')[0];
              const res = performance.getEntriesByType('resource');
              const js = res.filter((r) => r.initiatorType === 'script' || r.name.endsWith('.js'));
              return {
                ttfb_ms: Math.round(nav.responseStart), fcp_ms: Math.round(fcp?.startTime ?? 0),
                lcp_ms: Math.round(window.__perf.lcp), load_ms: Math.round(nav.loadEventEnd),
                requests: res.length + 1,
                js_kb: Math.round(js.reduce((s, r) => s + (r.encodedBodySize || r.transferSize || 0), 0) / 1024),
                long_tasks: window.__perf.longTasks, long_task_ms: Math.round(window.__perf.longTaskMs),
              };
            }""")
            landing_frames = page.evaluate(FRAMES, 3_000)

            # In-game, offline practice: render + physics cost without network effects.
            page.goto(f"{BASE_URL}/play/PERFTEST?offline=1&solo=1", wait_until="domcontentloaded", timeout=120_000)
            start = page.get_by_role("button", name=re.compile(r"^(START PRACTICE|Start anyway)$"))
            start.wait_for(timeout=120_000)
            ready = page.get_by_role("button", name="READY UP")
            if ready.is_visible():
                ready.click()
            start.click()
            page.locator(".game-timer").wait_for(timeout=60_000)
            page.wait_for_timeout(5_000)  # countdown, then let the scene settle
            page.keyboard.down("w")
            frames = page.evaluate(FRAMES, 8_000)
            page.keyboard.up("w")
            pixel_ratio = page.evaluate("() => { const c = document.querySelector('canvas'); return c ? +(c.width / c.clientWidth).toFixed(2) : null; }")
            report[name] = {
                "landing": {**load, "landing_fps": round(1000 / statistics.mean(landing_frames), 1)},
                "game": {
                    "fps": round(1000 / statistics.mean(frames), 1),
                    "frame_p50_ms": pct(frames, 0.5), "frame_p95_ms": pct(frames, 0.95), "frame_max_ms": pct(frames, 1.0),
                    "render_scale": pixel_ratio,
                },
            }
            print(f"{name:22s} landing {report[name]['landing']}")
            print(f"{'':22s} game    {report[name]['game']}")
            ctx.close()
        browser.close()
    (ARTIFACT_DIR / "perf.json").write_text(json.dumps(report, indent=2))


if __name__ == "__main__":
    run()
