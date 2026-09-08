"""E2E: Free-for-all uses combined whole-body controls.

Asserts the reported issue is fixed:
- solo lobby shows NO 3/5 squad picker and NO body-part (joint) picking
- solo shows the combined whole-body note + crew + role card instead
- READY UP -> START PRACTICE reaches live gameplay with combined inputs
- touch controls expose combined actions with no role switcher
- versus rooms keep the 3/5 picker and joint picking (no regression)

Run with the Next.js dev server on PLAYWRIGHT_BASE_URL (default
http://localhost:3001) and local SpacetimeDB on 127.0.0.1:3000.
Uses the system Chrome channel with SwiftShader WebGL, like
playwright_regression.py.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("PLAYWRIGHT_BASE_URL", "http://localhost:3001")
ARTIFACT_DIR = Path(os.environ.get("PLAYWRIGHT_ARTIFACT_DIR", ".test-dist/browser"))
SOLO_ROOM_URL = re.compile(r"/play/[A-Z0-9]{8}\?solo=1$")
VERSUS_ROOM_URL = re.compile(r"/play/[A-Z0-9]{8}$")


def assert_no_horizontal_overflow(page) -> None:
    assert page.evaluate(
        "document.documentElement.scrollWidth <= window.innerWidth + 1"
    ), "page has horizontal overflow"


def webgl_alive(page) -> bool:
    return page.locator("canvas").evaluate(
        "c => { const gl = c.getContext('webgl2') || c.getContext('webgl');"
        " return !!gl && !gl.isContextLost(); }"
    )


def run() -> None:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    page_errors: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            channel="chrome",
            headless=True,
            args=[
                "--use-angle=swiftshader",
                "--enable-webgl",
                "--ignore-gpu-blocklist",
                "--disable-dev-shm-usage",
            ],
        )

        # ---------- desktop solo ----------
        desktop = browser.new_context(viewport={"width": 1440, "height": 900})
        page = desktop.new_page()
        page.on("pageerror", lambda error: page_errors.append(f"solo-desktop: {error}"))
        page.goto(BASE_URL, wait_until="domcontentloaded", timeout=30_000)
        page.get_by_role("button", name=re.compile("Free-for-all", re.I)).wait_for(timeout=30_000)
        page.wait_for_timeout(750)

        page.get_by_role("button", name=re.compile("Free-for-all", re.I)).click()
        page.wait_for_url(SOLO_ROOM_URL, timeout=10_000)

        ready = page.get_by_role("button", name=re.compile(r"^(READY UP|READY)$"))
        ready.wait_for(state="visible", timeout=30_000)
        assert webgl_alive(page), "solo game did not boot a live WebGL context"

        # No 3/5 choosing in solo.
        assert page.get_by_test_id("solo-combined-note").is_visible(), (
            "solo lobby must show the combined whole-body note"
        )
        assert page.get_by_role("button", name=re.compile(r"^3 players", re.I)).count() == 0, (
            "solo lobby must NOT offer a 3-player choice"
        )
        assert page.get_by_role("button", name=re.compile(r"^5 players", re.I)).count() == 0, (
            "solo lobby must NOT offer a 5-player choice"
        )
        # No body-part choosing in solo (joint buttons expose ", free" / owner names).
        assert page.get_by_test_id("solo-crew").is_visible(), (
            "solo lobby must show the static whole-body crew"
        )
        assert page.get_by_role("button", name=re.compile(r", free$", re.I)).count() == 0, (
            "solo lobby must NOT offer free-joint picking"
        )
        # Combined role card, no Tab-switch hint, no per-role tabs.
        solo_card = page.get_by_test_id("solo-role-card")
        solo_card.wait_for(state="visible", timeout=10_000)
        assert "Whole body" in solo_card.inner_text()
        assert page.get_by_text("Switch body part", exact=False).count() == 0, (
            "solo must NOT mention Tab / body-part switching"
        )
        assert page.get_by_role("button", name=re.compile(r"^Control ", re.I)).count() == 0, (
            "solo must NOT show per-role Control tabs"
        )
        assert_no_horizontal_overflow(page)
        page.screenshot(path=str(ARTIFACT_DIR / "solo-combined-lobby.png"))

        # Solo auto-marks ready server-side; press READY UP only if not ready yet.
        if ready.is_visible() and ready.inner_text().strip() == "READY UP":
            ready.click()
        start = page.get_by_role("button", name=re.compile(r"^(START PRACTICE|Start anyway)$"))
        start.wait_for(state="visible", timeout=10_000)
        start.click()
        page.locator(".game-timer").wait_for(state="visible", timeout=15_000)
        page.wait_for_timeout(4_000)
        # Combined card persists into gameplay; still no switching UI.
        assert page.get_by_test_id("solo-role-card").is_visible()
        assert page.get_by_text("Switch body part", exact=False).count() == 0
        assert page.get_by_role("button", name=re.compile(r"^Control ", re.I)).count() == 0

        # Drive the combined body: W (stride+lean+arms) + Space (grab+jump+brace).
        canvas = page.locator("canvas")
        page.keyboard.down("w")
        page.wait_for_timeout(600)
        page.keyboard.down("Space")
        page.wait_for_timeout(300)
        page.keyboard.up("Space")
        page.keyboard.up("w")
        assert canvas.is_visible(), "game stopped rendering after combined input"
        page.screenshot(path=str(ARTIFACT_DIR / "solo-combined-playing.png"))
        desktop.close()

        # ---------- mobile solo: combined touch controls, no role switcher ----------
        mobile_options = dict(playwright.devices["iPhone 13"])
        mobile_options.update(viewport={"width": 390, "height": 844})
        mobile = browser.new_context(**mobile_options)
        mobile_page = mobile.new_page()
        mobile_page.on("pageerror", lambda error: page_errors.append(f"solo-mobile: {error}"))
        mobile_page.goto(BASE_URL, wait_until="domcontentloaded", timeout=30_000)
        mobile_page.get_by_role("button", name=re.compile("Free-for-all", re.I)).wait_for(timeout=30_000)
        mobile_page.wait_for_timeout(750)
        mobile_page.get_by_role("button", name=re.compile("Free-for-all", re.I)).click()
        mobile_page.wait_for_url(SOLO_ROOM_URL, timeout=10_000)
        mobile_ready = mobile_page.get_by_role("button", name=re.compile(r"^(READY UP|READY)$"))
        mobile_ready.wait_for(state="visible", timeout=30_000)
        if mobile_ready.is_visible() and mobile_ready.inner_text().strip() == "READY UP":
            mobile_ready.click()
        mobile_start = mobile_page.get_by_role(
            "button", name=re.compile(r"^(START PRACTICE|Start anyway)$")
        )
        mobile_start.wait_for(state="visible", timeout=10_000)
        mobile_start.click()
        controls = mobile_page.get_by_label("Touch controls")
        controls.wait_for(state="visible", timeout=15_000)
        mobile_page.wait_for_timeout(4_000)
        assert "WHOLE BODY" in controls.inner_text(), (
            "solo touch controls must label the combined body"
        )
        assert mobile_page.get_by_label("Whole body actions").is_visible(), (
            "solo touch controls must expose the combined action pad"
        )
        assert mobile_page.locator(".mobile-role-options").count() == 0, (
            "solo touch controls must NOT offer a body-part switcher"
        )
        assert mobile_page.get_by_label("Grab", exact=True).is_visible(), (
            "solo touch controls must expose a dedicated Grab button"
        )
        assert mobile_page.get_by_label("Jump", exact=True).is_visible(), (
            "solo touch controls must expose a dedicated Jump button"
        )
        assert mobile_page.get_by_role("button", name=re.compile(r"Grab.*Jump", re.I)).count() == 0, (
            "solo touch controls must NOT stack Grab+Jump on one button"
        )
        mobile_page.screenshot(path=str(ARTIFACT_DIR / "solo-combined-mobile.png"))
        mobile.close()

        # ---------- versus guard: pickers still exist outside solo ----------
        versus = browser.new_context(viewport={"width": 1280, "height": 800})
        versus_page = versus.new_page()
        versus_page.on("pageerror", lambda error: page_errors.append(f"versus: {error}"))
        versus_page.goto(BASE_URL, wait_until="domcontentloaded", timeout=30_000)
        versus_page.get_by_role("button", name=re.compile("Team versus", re.I)).wait_for(timeout=30_000)
        versus_page.wait_for_timeout(750)
        versus_page.get_by_role("button", name=re.compile("Team versus", re.I)).click()
        versus_page.wait_for_url(VERSUS_ROOM_URL, timeout=10_000)
        versus_page.get_by_role("button", name="READY UP").wait_for(state="visible", timeout=30_000)
        assert versus_page.get_by_role("button", name=re.compile(r"^3 players", re.I)).is_visible(), (
            "versus lobby must keep the 3-player choice"
        )
        assert versus_page.get_by_role("button", name=re.compile(r"^5 players", re.I)).is_visible(), (
            "versus lobby must keep the 5-player choice"
        )
        assert versus_page.get_by_role("button", name=re.compile(r", free$", re.I)).count() > 0, (
            "versus lobby must keep joint picking"
        )
        assert versus_page.get_by_test_id("solo-combined-note").count() == 0, (
            "versus lobby must NOT show the solo combined note"
        )
        versus.close()

        assert not page_errors, f"uncaught browser errors: {page_errors[:5]}"
        browser.close()

    print("solo combined-controls E2E: PASS")


if __name__ == "__main__":
    run()
