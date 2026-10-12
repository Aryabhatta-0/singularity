"""Visual QA tour: screenshots of every screen and course in offline practice.

Run with a local Next.js server already listening on PLAYWRIGHT_BASE_URL
(defaults to http://localhost:3001):

    python tests/browser/visual_tour.py [label]

Screenshots go to .test-dist/tour/<label>/. Offline practice needs no game
server, so the tour covers the lobby, all five courses, the mobile HUD and
(through the dev-only debug hook, when present) the results screen.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("PLAYWRIGHT_BASE_URL", "http://localhost:3001")
LABEL = sys.argv[1] if len(sys.argv) > 1 else "latest"
OUT = Path(os.environ.get("PLAYWRIGHT_ARTIFACT_DIR", ".test-dist/tour")) / LABEL
COURSES = ["Wobble Run", "Ferry Job", "Summit Sync", "Egg Express", "Slam Dunk"]
ARGS = ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"]


def wait_for_game(page) -> None:
    page.wait_for_selector(".lab-loader", state="detached", timeout=60_000)
    page.wait_for_timeout(600)


def start_course(page, course: str) -> None:
    page.get_by_role("button", name=re.compile(course)).first.click()
    page.wait_for_timeout(900)
    page.get_by_role("button", name=re.compile(r"start", re.I)).first.click()
    page.wait_for_timeout(5200)


def debug(page, script: str):
    return page.evaluate(f"() => {{ const d = window.__singularityDev; if (!d) return null; {script}; return true; }}")


def run() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True, args=ARGS)

        desktop = browser.new_context(viewport={"width": 1440, "height": 900})
        page = desktop.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(BASE_URL, wait_until="networkidle", timeout=60_000)
        page.wait_for_timeout(2500)
        page.screenshot(path=str(OUT / "01-landing.png"))

        page.goto(f"{BASE_URL}/play/TOURROOM?offline=1&solo=1", wait_until="domcontentloaded")
        wait_for_game(page)
        page.wait_for_timeout(1500)
        page.screenshot(path=str(OUT / "02-lobby.png"))

        for index, course in enumerate(COURSES):
            if index > 0:
                page.goto(f"{BASE_URL}/play/TOURRM{index:02d}?offline=1&solo=1", wait_until="domcontentloaded")
                wait_for_game(page)
            start_course(page, course)
            slug = course.lower().replace(" ", "-")
            page.screenshot(path=str(OUT / f"1{index}-{slug}-start.png"))
            page.keyboard.down("KeyW")
            page.wait_for_timeout(2200)
            page.keyboard.up("KeyW")
            page.wait_for_timeout(400)
            page.screenshot(path=str(OUT / f"1{index}-{slug}-run.png"))
            # Dev hook: hop along the course for a look at its landmarks.
            stops = (-6, -10, -12) if course == "Slam Dunk" else (-14, -28, -45)
            for stop, z in enumerate(stops):
                if debug(page, f"d.teleport(0, 1.2, {z})") is None:
                    break
                page.wait_for_timeout(1400)
                page.screenshot(path=str(OUT / f"1{index}-{slug}-z{stop}.png"))

        # Results via the dev hook (finish the run on the spot).
        if debug(page, "d.finishRun()") is not None:
            page.wait_for_timeout(4500)
            page.screenshot(path=str(OUT / "30-results.png"))

        phone = browser.new_context(
            viewport={"width": 844, "height": 390}, is_mobile=True, has_touch=True, device_scale_factor=2
        )
        mobile = phone.new_page()
        mobile.on("pageerror", lambda error: errors.append(f"mobile: {error}"))
        mobile.goto(f"{BASE_URL}/play/TOURMOBL?offline=1", wait_until="domcontentloaded")
        wait_for_game(mobile)
        mobile.screenshot(path=str(OUT / "40-mobile-lobby.png"))
        start_course(mobile, "Wobble Run")
        mobile.screenshot(path=str(OUT / "41-mobile-hud.png"))

        portrait = browser.new_context(
            viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2
        )
        tall = portrait.new_page()
        tall.goto(f"{BASE_URL}/play/TOURPORT?offline=1&solo=1", wait_until="domcontentloaded")
        wait_for_game(tall)
        tall.screenshot(path=str(OUT / "42-portrait-lobby.png"))
        start_course(tall, "Ferry Job")
        tall.screenshot(path=str(OUT / "43-portrait-hud.png"))
        browser.close()

    print(f"screenshots in {OUT}")
    if errors:
        print("page errors:")
        for error in errors:
            print("  ", error)


if __name__ == "__main__":
    run()
