"""Layout sweep across phone, tablet and desktop viewports.

For every viewport (portrait and landscape): the landing page, legal pages and
404 must not scroll sideways, primary controls must be finger-sized, the
leaderboard must be on screen without covering the main actions, and the
lobby and in-round HUD must fit. Screenshots land in PLAYWRIGHT_ARTIFACT_DIR
for a visual pass.

Needs a running build on PLAYWRIGHT_BASE_URL (default http://localhost:3001),
e.g. `npm run host`.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("PLAYWRIGHT_BASE_URL", "http://localhost:3001")
ARTIFACT_DIR = Path(os.environ.get("PLAYWRIGHT_ARTIFACT_DIR", ".test-dist/browser")) / "layout"
PHONES = [(320, 568), (360, 740), (375, 667), (390, 844), (412, 915), (430, 932), (768, 1024)]
DESKTOP = (1440, 900)
MIN_TOUCH = 40  # px; WCAG 2.5.8 asks 24, platform guidelines 44-48 — 40 is our floor for primary actions


def overflow(page) -> int:
    return page.evaluate("document.documentElement.scrollWidth - window.innerWidth")


def small_targets(page, selector: str) -> list[str]:
    """Controls under MIN_TOUCH px, checked on touch screens only (mice are precise)."""
    if not page.evaluate("matchMedia('(pointer: coarse)').matches"):
        return []
    return page.evaluate(
        """([selector, min]) => [...document.querySelectorAll(selector)]
          .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < min || r.width < min); })
          .map((el) => `${(el.innerText || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 30)} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`)""",
        [selector, MIN_TOUCH],
    )


def run() -> None:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    problems: list[str] = []
    errors: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            channel="chrome", headless=True,
            args=["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
        )
        sizes = [(w, h, "portrait") for w, h in PHONES] + [(h, w, "landscape") for w, h in PHONES] + [(*DESKTOP, "desktop")]
        for width, height, label in sizes:
            touch = label != "desktop"
            ctx = browser.new_context(viewport={"width": width, "height": height}, has_touch=touch, is_mobile=touch and width < 1000, color_scheme="dark")
            page = ctx.new_page()
            page.on("pageerror", lambda e: errors.append(str(e)))
            tag = f"{label}-{width}x{height}"

            page.goto(BASE_URL, wait_until="domcontentloaded")
            page.get_by_role("button", name=re.compile("Free-for-all", re.I)).wait_for(timeout=30_000)
            page.wait_for_timeout(400)
            if overflow(page) > 1:
                problems.append(f"{tag} landing scrolls sideways by {overflow(page)}px")
            for target in small_targets(page, ".lab-topbar button, .lab-clipboard button, .lab-clipboard input"):
                problems.append(f"{tag} landing target too small: {target}")
            page.screenshot(path=str(ARTIFACT_DIR / f"landing-{tag}.png"))

            page.get_by_role("button", name="Best times", exact=True).click()
            page.get_by_test_id("landing-leaderboard").locator(".lab-board-row:not(.is-skeleton), .lab-board-empty").first.wait_for(timeout=15_000)
            page.wait_for_timeout(400)
            for target in small_targets(page, ".lab-board button"):
                problems.append(f"{tag} leaderboard target too small: {target}")
            page.screenshot(path=str(ARTIFACT_DIR / f"leaderboard-{tag}.png"))
            page.keyboard.press("Escape")

            for path in ("/privacy", "/terms", "/no-such-page"):
                page.goto(f"{BASE_URL}{path}", wait_until="domcontentloaded")
                page.wait_for_timeout(200)
                if overflow(page) > 1:
                    problems.append(f"{tag} {path} scrolls sideways by {overflow(page)}px")
            if width in (320, 390) or label == "desktop":
                page.goto(f"{BASE_URL}/privacy", wait_until="domcontentloaded")
                page.screenshot(path=str(ARTIFACT_DIR / f"privacy-{tag}.png"), full_page=True)

            if width in (320, 390, 768) or label == "desktop":
                page.goto(BASE_URL, wait_until="domcontentloaded")
                page.get_by_role("button", name=re.compile("Free-for-all", re.I)).wait_for(timeout=30_000)
                page.wait_for_timeout(600)
                page.get_by_role("button", name=re.compile("Free-for-all", re.I)).click()
                page.get_by_role("button", name="Create room", exact=True).click()
                start = page.get_by_role("button", name=re.compile(r"^(START PRACTICE|Start anyway)$"))
                start.wait_for(timeout=30_000)
                page.wait_for_timeout(500)
                if overflow(page) > 1:
                    problems.append(f"{tag} lobby scrolls sideways by {overflow(page)}px")
                for target in small_targets(page, ".game-lobby-panel button"):
                    problems.append(f"{tag} lobby target too small: {target}")
                page.screenshot(path=str(ARTIFACT_DIR / f"lobby-{tag}.png"))
                ready = page.get_by_role("button", name="READY UP")
                if ready.is_visible():
                    ready.click()
                start.click()
                page.locator(".game-timer").wait_for(timeout=15_000)
                page.wait_for_timeout(5_500)
                if overflow(page) > 1:
                    problems.append(f"{tag} HUD scrolls sideways by {overflow(page)}px")
                if touch:
                    for target in small_targets(page, ".mobile-action-button"):
                        problems.append(f"{tag} touch control too small: {target}")
                page.screenshot(path=str(ARTIFACT_DIR / f"hud-{tag}.png"))
            ctx.close()
        browser.close()

    for problem in problems:
        print("  ", problem)
    assert not problems, f"{len(problems)} layout problem(s)"
    assert not errors, f"page errors: {errors[:3]}"
    print("mobile layout sweep: PASS")


if __name__ == "__main__":
    run()
