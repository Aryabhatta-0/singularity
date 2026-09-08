"""E2E: free-for-all rooms spawn one racer-named team per player.

Asserts the requested rename/behavior change:
- "Free-for-all" (ex solo) host gets a team named after THEM, not "Team 1"
- a second player joining the FFA room gets their OWN team named after them
- both racers see each other as rivals (ffa-rival rows), no joint picking
- ?ffa=1 works as a join-flag alias for ?solo=1
- versus rooms still number squads Team 1, Team 2, … (no gaps, no racer names)

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
FFA_ROOM_URL = re.compile(r"/play/[A-Z0-9]{8}\?(solo|ffa)=1$")
VERSUS_ROOM_URL = re.compile(r"/play/[A-Z0-9]{8}$")


def launch():
    from playwright.sync_api import sync_playwright as sp

    playwright = sp().start()
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
    return playwright, browser


def new_named_context(browser, name: str, **kwargs):
    context = browser.new_context(**kwargs)
    context.add_init_script(f"localStorage.setItem('singularity_name', {name!r})")
    return context


def run() -> None:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    page_errors: list[str] = []
    playwright, browser = launch()
    try:
        # ---------- FFA host: team named after her, not "Team 1" ----------
        host_ctx = new_named_context(browser, "Ava", viewport={"width": 1440, "height": 900})
        host = host_ctx.new_page()
        host.on("pageerror", lambda error: page_errors.append(f"ffa-host: {error}"))
        host.goto(BASE_URL, wait_until="domcontentloaded", timeout=30_000)
        host.get_by_role("button", name=re.compile("Free-for-all", re.I)).wait_for(timeout=30_000)
        host.wait_for_timeout(750)
        host.get_by_role("button", name=re.compile("Free-for-all", re.I)).click()
        host.wait_for_url(FFA_ROOM_URL, timeout=10_000)
        host.get_by_role("button", name=re.compile(r"^(READY UP|READY)$")).wait_for(
            state="visible", timeout=30_000
        )

        assert host.get_by_test_id("solo-crew").is_visible(), "FFA host must see her own crew card"
        own_name = host.locator("input[aria-label='Team name']").input_value()
        assert own_name == "Ava", f"FFA host team must be named after her, got {own_name!r}"
        assert host.get_by_text("Team 1", exact=True).count() == 0, (
            "FFA room must NOT contain a numbered Team 1"
        )
        assert host.get_by_test_id("ffa-rival").count() == 0, "no rivals before anyone joins"
        assert host.get_by_test_id("new-rival-team").is_disabled(), (
            "FFA must not offer manual rival-team creation"
        )
        code = FFA_ROOM_URL.search(host.url).group(0).split("/play/")[1].split("?")[0]

        # ---------- FFA guest via ?ffa=1 alias: own team, sees host as rival ----------
        guest_ctx = new_named_context(browser, "Ben", viewport={"width": 1440, "height": 900})
        guest = guest_ctx.new_page()
        guest.on("pageerror", lambda error: page_errors.append(f"ffa-guest: {error}"))
        guest.goto(f"{BASE_URL}/play/{code}?ffa=1", wait_until="domcontentloaded", timeout=30_000)
        guest.get_by_role("button", name=re.compile(r"^(READY UP|READY)$")).wait_for(
            state="visible", timeout=30_000
        )
        guest_own = guest.locator("input[aria-label='Team name']").input_value()
        assert guest_own == "Ben", f"FFA guest team must be named after him, got {guest_own!r}"
        guest_rivals = guest.get_by_test_id("ffa-rival")
        guest_rivals.filter(has_text="Ava").wait_for(state="visible", timeout=15_000)
        assert guest.get_by_text("Team 1", exact=True).count() == 0, (
            "FFA room must NOT contain a numbered Team 1"
        )
        assert guest.get_by_role("button", name=re.compile(r", free$", re.I)).count() == 0, (
            "FFA must NOT offer joint picking"
        )

        # Host sees the newcomer as a rival live.
        host.get_by_test_id("ffa-rival").filter(has_text="Ben").wait_for(
            state="visible", timeout=15_000
        )
        host.screenshot(path=str(ARTIFACT_DIR / "ffa-two-racers.png"))
        host_ctx.close()
        guest_ctx.close()

        # ---------- versus guard: squads numbered Team 1, Team 2, … ----------
        # Two racers share Team 1; the first clicking "New rival team" moves
        # onto Team 2 (empty squads are cleaned up, so a rival only exists
        # once someone sits on it).
        versus_ctx = new_named_context(browser, "Cat", viewport={"width": 1280, "height": 800})
        versus = versus_ctx.new_page()
        versus.on("pageerror", lambda error: page_errors.append(f"versus: {error}"))
        versus.goto(BASE_URL, wait_until="domcontentloaded", timeout=30_000)
        versus.get_by_role("button", name=re.compile("Team versus", re.I)).wait_for(timeout=30_000)
        versus.wait_for_timeout(750)
        versus.get_by_role("button", name=re.compile("Team versus", re.I)).click()
        versus.wait_for_url(VERSUS_ROOM_URL, timeout=10_000)
        versus.get_by_role("button", name="READY UP").wait_for(state="visible", timeout=30_000)
        assert versus.locator("input[aria-label='Team name']").first.input_value() == "Team 1", (
            "first versus squad must be named Team 1"
        )
        versus_code = VERSUS_ROOM_URL.search(versus.url).group(0).split("/play/")[1]

        versus2_ctx = new_named_context(browser, "Dan", viewport={"width": 1280, "height": 800})
        versus2 = versus2_ctx.new_page()
        versus2.on("pageerror", lambda error: page_errors.append(f"versus2: {error}"))
        versus2.goto(f"{BASE_URL}/play/{versus_code}", wait_until="domcontentloaded", timeout=30_000)
        versus2.get_by_role("button", name="READY UP").wait_for(state="visible", timeout=30_000)
        # Dan joins Cat's squad: not team host, so he sees the name as text.
        assert versus2.get_by_text("Team 1", exact=True).first.is_visible(), (
            "joiner must land on the existing Team 1 squad"
        )

        versus.get_by_test_id("new-rival-team").click()
        versus.wait_for_function(
            "() => [...document.querySelectorAll(\"input[aria-label='Team name']\")].some(i => i.value === 'Team 2')",
            timeout=10_000,
        )
        assert versus.get_by_text("Team 1", exact=True).count() > 0, (
            "Team 1 must survive on the creator's screen after they move to Team 2"
        )
        versus2.wait_for_function(
            "() => document.body.innerText.includes('Team 2')",
            timeout=15_000,
        )
        assert versus2.locator("input[aria-label='Team name']").first.input_value() == "Team 1", (
            "remaining racer must keep Team 1"
        )
        versus.screenshot(path=str(ARTIFACT_DIR / "versus-team-numbers.png"))
        versus_ctx.close()
        versus2_ctx.close()

        assert not page_errors, f"uncaught browser errors: {page_errors[:5]}"
    finally:
        browser.close()
        playwright.stop()

    print("free-for-all teams E2E: PASS")


if __name__ == "__main__":
    run()
