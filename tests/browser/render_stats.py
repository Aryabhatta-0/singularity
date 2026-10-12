"""Render cost probe: draw calls, triangles and fps per course (dev server only).

    python tests/browser/render_stats.py [base_url]
"""

from __future__ import annotations

import re
import sys

from playwright.sync_api import sync_playwright

BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3001"
COURSES = ["Wobble Run", "Ferry Job", "Summit Sync", "Egg Express", "Slam Dunk"]
FPS = """() => new Promise((resolve) => { let n = 0; const t0 = performance.now();
  const tick = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else resolve(n / ((performance.now() - t0) / 1000)); };
  requestAnimationFrame(tick); })"""


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True, args=["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        for i, course in enumerate(COURSES):
            page.goto(f"{BASE_URL}/play/STATS{i:03d}?offline=1&solo=1", wait_until="domcontentloaded")
            page.wait_for_selector(".lab-loader", state="detached", timeout=90_000)
            page.get_by_role("button", name=re.compile(course)).first.click()
            page.wait_for_timeout(2500)
            fps = page.evaluate(FPS)
            stats = page.evaluate("() => window.__singularityDebug?.render ?? null")
            level = page.evaluate("() => window.__singularityDebug?.renderLevel ?? null")
            print(f"{course:12s} fps={fps:5.1f} level={level} render={stats}")
        browser.close()


if __name__ == "__main__":
    main()
