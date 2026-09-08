"""Browser regressions for the player-facing Singularity routes.

Run with a local Next.js server already listening on PLAYWRIGHT_BASE_URL
(defaults to http://localhost:3001 — the Next.js dev server runs on port 3001
so it never fights the local SpacetimeDB instance on 127.0.0.1:3000).
The suite intentionally uses the system Chrome channel so it does not require
a checked-in browser binary.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("PLAYWRIGHT_BASE_URL", "http://localhost:3001")
ARTIFACT_DIR = Path(os.environ.get("PLAYWRIGHT_ARTIFACT_DIR", ".test-dist/browser"))
ROOM_URL = re.compile(r"/play/[A-Z0-9]{8}$")
SOLO_ROOM_URL = re.compile(r"/play/[A-Z0-9]{8}\?solo=1$")


def assert_no_horizontal_overflow(page) -> None:
    assert page.evaluate(
        "document.documentElement.scrollWidth <= window.innerWidth + 1"
    ), "page has horizontal overflow"


def run() -> None:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    page_errors: list[str] = []

    def track_page_errors(page, label: str) -> None:
        page.on("pageerror", lambda error: page_errors.append(f"{label}: {error}"))

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

        desktop = browser.new_context(
            viewport={"width": 1440, "height": 900}, color_scheme="dark"
        )
        page = desktop.new_page()
        track_page_errors(page, "desktop")
        response = page.goto(BASE_URL, wait_until="domcontentloaded", timeout=30_000)
        assert response and response.ok, "homepage did not return HTTP 200"
        page.get_by_role("heading", name="SINGULARITY").wait_for()
        # The heading/input are server-rendered; wait for React to attach event
        # handlers before exercising client-side validation and navigation.
        page.wait_for_timeout(750)
        assert_no_horizontal_overflow(page)

        favicon = page.request.get(f"{BASE_URL}/favicon.ico")
        assert favicon.ok, f"favicon returned HTTP {favicon.status}"

        code_input = page.get_by_label("Room code")
        code_input.fill("NO!")
        page.get_by_role("button", name="Join", exact=True).click()
        page.locator("#room-code-error[role=alert]").wait_for(state="visible")
        assert "/play/" not in page.url

        code_input.fill("ABC")
        page.get_by_role("button", name="Join", exact=True).click()
        page.wait_for_url(re.compile(r"/play/ABC$"), timeout=10_000)
        try:
            page.get_by_role("heading", name="Room unavailable").wait_for(
                state="visible", timeout=8_000
            )
        except PlaywrightTimeoutError as error:
            page.screenshot(path=str(ARTIFACT_DIR / "room-unavailable-failure.png"))
            raise AssertionError(page.locator("body").inner_text()) from error
        assert page.get_by_role("link", name="Return to lobby").is_visible()
        assert page.get_by_role("button", name="Retry connection").is_visible()
        page.screenshot(path=str(ARTIFACT_DIR / "room-unavailable.png"))
        page.go_back(wait_until="domcontentloaded")

        page.get_by_role("button", name=re.compile("Create versus room", re.I)).click()
        page.wait_for_url(ROOM_URL, timeout=10_000)
        ready = page.get_by_role("button", name="READY UP")
        ready.wait_for(state="visible", timeout=30_000)
        canvas = page.locator("canvas")
        assert canvas.evaluate(
            "c => { const gl = c.getContext('webgl2') || c.getContext('webgl'); return !!gl && !gl.isContextLost(); }"
        ), "desktop game did not boot a live WebGL context"

        guests = []
        for _ in range(3):
            guest_context = browser.new_context(
                viewport={"width": 800, "height": 600}, color_scheme="dark"
            )
            guest = guest_context.new_page()
            track_page_errors(guest, "guest")
            guest.goto(page.url, wait_until="domcontentloaded", timeout=30_000)
            guest.get_by_role("button", name="READY UP").wait_for(
                state="visible", timeout=30_000
            )
            guests.append((guest_context, guest))

        page.get_by_text("4/5", exact=True).wait_for(state="visible", timeout=15_000)
        three_player_squad = page.get_by_role(
            "button", name=re.compile(r"^3 players", re.I)
        )
        assert three_player_squad.is_disabled(), (
            "3-player squads must be disabled while a team has four players"
        )

        team_name = page.get_by_label("Team name")
        team_name.fill("Red Comets")
        page.get_by_role("button", name="Save", exact=True).click()
        guests[0][1].get_by_text("Red Comets", exact=True).wait_for(
            state="visible", timeout=10_000
        )

        rival_page = guests[0][1]
        rival_page.get_by_test_id("new-rival-team").click()
        rival_page.get_by_text("2 teams ready to compete", exact=True).wait_for(
            state="visible", timeout=10_000
        )
        assert rival_page.get_by_role("button", name="Join", exact=True).is_visible(), (
            "creating a rival team did not move the player away from the original team"
        )
        rival_name = rival_page.get_by_label("Team name")
        rival_name.fill("Blue Rockets")
        rival_page.get_by_role("button", name="Save", exact=True).click()
        page.get_by_text("Blue Rockets", exact=True).wait_for(
            state="visible", timeout=10_000
        )

        for _guest_context, guest in guests:
            guest.get_by_role("button", name="READY UP").click()
        ready.click()
        start = page.get_by_role(
            "button", name=re.compile(r"^(START RACE!|Start anyway)$")
        )
        start.wait_for(state="visible", timeout=10_000)
        start.click()
        page.locator(".game-timer").wait_for(state="visible", timeout=15_000)
        standings = page.get_by_test_id("team-standings")
        standings.wait_for(state="visible", timeout=15_000)
        assert standings.locator("[data-testid^='team-standing-']").count() == 2, (
            "active multi-team round did not show both team standings"
        )
        page.wait_for_timeout(5_000)
        assert not ready.is_visible(), "match returned to the lobby before gameplay"

        page.keyboard.down("w")
        page.wait_for_timeout(150)
        page.evaluate("window.dispatchEvent(new Event('blur'))")
        page.keyboard.up("w")
        assert canvas.is_visible(), "game stopped rendering after window blur"

        desktop.set_offline(True)
        connection_status = page.get_by_test_id("connection-status")
        connection_status.wait_for(state="visible", timeout=10_000)
        assert "Connection lost" in connection_status.inner_text()
        assert canvas.is_visible(), "game canvas disappeared while offline"
        assert page.locator(".game-timer").is_visible(), "active match ended while offline"
        page.screenshot(path=str(ARTIFACT_DIR / "desktop-game-offline.png"))

        desktop.set_offline(False)
        page.evaluate(
            "window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus'))"
        )
        connection_status.get_by_text(re.compile("Back online", re.I)).wait_for(
            state="visible", timeout=15_000
        )
        page.set_viewport_size({"width": 900, "height": 600})
        page.wait_for_timeout(300)
        box = canvas.bounding_box()
        assert box and abs(box["width"] - 900) <= 1 and abs(box["height"] - 600) <= 1
        assert_no_horizontal_overflow(page)
        assert "Back online" in connection_status.inner_text(), (
            "recovery confirmation disappeared before players could read it"
        )
        page.screenshot(path=str(ARTIFACT_DIR / "desktop-game-restored.png"))

        for guest_context, _guest in guests:
            guest_context.close()
        desktop.close()

        mobile_options = dict(playwright.devices["iPhone 13"])
        mobile_options.update(
            viewport={"width": 390, "height": 844}, reduced_motion="reduce"
        )
        mobile = browser.new_context(**mobile_options)
        mobile_page = mobile.new_page()
        track_page_errors(mobile_page, "mobile")
        mobile_page.goto(BASE_URL, wait_until="domcontentloaded", timeout=30_000)
        mobile_page.get_by_role("heading", name="SINGULARITY").wait_for()
        mobile_page.wait_for_timeout(750)
        assert mobile_page.evaluate(
            "matchMedia('(prefers-reduced-motion: reduce)').matches"
        )
        assert_no_horizontal_overflow(mobile_page)
        mobile_page.get_by_role("button", name=re.compile("Solo practice", re.I)).click()
        mobile_page.wait_for_url(SOLO_ROOM_URL, timeout=10_000)
        try:
            mobile_page.get_by_role(
                "button", name=re.compile(r"^(READY UP|START PRACTICE)$")
            ).wait_for(
                state="visible", timeout=30_000
            )
        except PlaywrightTimeoutError as error:
            mobile_page.screenshot(path=str(ARTIFACT_DIR / "mobile-boot-failure.png"))
            raise AssertionError(mobile_page.locator("body").inner_text()) from error
        mobile_canvas = mobile_page.locator("canvas")
        assert mobile_canvas.evaluate(
            "c => { const gl = c.getContext('webgl2') || c.getContext('webgl'); return !!gl && !gl.isContextLost(); }"
        ), "mobile game did not boot a live WebGL context"
        mobile_ready = mobile_page.get_by_role("button", name="READY UP")
        if mobile_ready.is_visible():
            mobile_ready.click()
        mobile_start = mobile_page.get_by_role(
            "button", name=re.compile(r"^(START PRACTICE|Start anyway)$")
        )
        mobile_start.wait_for(state="visible", timeout=10_000)
        mobile_start.click()
        controls = mobile_page.get_by_label("Touch controls")
        controls.wait_for(state="visible", timeout=15_000)
        mobile_page.wait_for_timeout(5_000)
        action = mobile_page.locator(".mobile-action-button").first
        action.focus()
        mobile_page.keyboard.down("Space")
        assert action.get_attribute("aria-pressed") == "true"
        mobile_page.evaluate("window.dispatchEvent(new Event('blur'))")
        mobile_page.keyboard.up("Space")
        mobile_page.wait_for_timeout(100)
        assert action.get_attribute("aria-pressed") == "false"
        mobile_page.screenshot(path=str(ARTIFACT_DIR / "mobile-game-portrait.png"))

        mobile_page.set_viewport_size({"width": 740, "height": 390})
        mobile_page.wait_for_timeout(300)
        assert_no_horizontal_overflow(mobile_page)
        assert controls.is_visible(), "touch controls disappeared after orientation resize"
        mobile_page.screenshot(path=str(ARTIFACT_DIR / "mobile-game-landscape.png"))
        mobile.close()
        assert not page_errors, f"uncaught browser errors: {page_errors[:5]}"
        browser.close()


if __name__ == "__main__":
    run()
