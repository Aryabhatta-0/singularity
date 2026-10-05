"""E2E: two players share one body through the room server.

- the host creates a versus room, a friend joins by link and lands on the same squad
- both ready up, the leader starts, both browsers reach "playing" together
- exactly one browser (the team host) simulates the body
- the friend's key presses reach the host's simulation as remote input
- the friend's screen follows the host's body via relayed snapshots

Run with the Next.js dev server on PLAYWRIGHT_BASE_URL (default
http://localhost:3001) and the room server published on 127.0.0.1:3000
(`npm run room:publish`). Uses the dev-only window.__singularityDebug hook.
"""

from __future__ import annotations

import math
import os
import re
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("PLAYWRIGHT_BASE_URL", "http://localhost:3001")
ARTIFACT_DIR = Path(os.environ.get("PLAYWRIGHT_ARTIFACT_DIR", ".test-dist/browser"))
VERSUS_ROOM_URL = re.compile(r"/play/[A-Z0-9]{8}$")


def debug(page):
    return page.evaluate("() => window.__singularityDebug ?? null")


def wait_for_debug(page, predicate, timeout_s: float, what: str):
    deadline = time.time() + timeout_s
    last = None
    while time.time() < deadline:
        last = debug(page)
        if last and predicate(last):
            return last
        page.wait_for_timeout(200)
    raise AssertionError(f"timed out waiting for {what}; last debug state: {last}")


def run() -> None:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    page_errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            channel="chrome",
            headless=True,
            args=["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"],
        )
        try:
            pages = {}
            for name in ("Ava", "Ben"):
                ctx = browser.new_context(viewport={"width": 1280, "height": 800})
                ctx.add_init_script(f"localStorage.setItem('singularity_name', {name!r})")
                page = ctx.new_page()
                page.on("pageerror", lambda error, n=name: page_errors.append(f"{n}: {error}"))
                pages[name] = page
            ava, ben = pages["Ava"], pages["Ben"]

            ava.goto(BASE_URL, wait_until="domcontentloaded", timeout=30_000)
            ava.get_by_role("button", name=re.compile("Team versus", re.I)).wait_for(timeout=30_000)
            ava.wait_for_timeout(750)
            ava.get_by_role("button", name=re.compile("Team versus", re.I)).click()
            ava.wait_for_url(VERSUS_ROOM_URL, timeout=10_000)
            code = ava.url.rsplit("/play/", 1)[1]

            ben.goto(f"{BASE_URL}/play/{code}", wait_until="domcontentloaded", timeout=30_000)
            for page in (ava, ben):
                page.get_by_role("button", name="READY UP").wait_for(state="visible", timeout=30_000)
            ava.wait_for_function("() => document.body.innerText.includes('Ben')", timeout=15_000)
            assert ben.get_by_text("Team 1", exact=True).first.is_visible(), "friend must join the host's squad"

            for page in (ava, ben):
                page.get_by_role("button", name="READY UP").click()
            start = ava.get_by_role("button", name=re.compile(r"^START (PRACTICE|RACE)$"))
            start.wait_for(state="visible", timeout=15_000)
            start.click()

            for page in (ava, ben):
                wait_for_debug(page, lambda d: d.get("phase") == "playing", 20, "playing phase")
            ava_state = wait_for_debug(ava, lambda d: d.get("isHost") is not None, 10, "host engine")
            ben_state = wait_for_debug(ben, lambda d: d.get("isHost") is not None, 10, "friend engine")
            assert ava_state["isHost"] is True and ben_state["isHost"] is False, (
                f"exactly the first joiner simulates: ava={ava_state['isHost']} ben={ben_state['isHost']}"
            )

            # Friend holds forward; the host must see it arrive as remote input.
            ben.locator("canvas").first.click(position={"x": 400, "y": 400})
            ben.keyboard.down("KeyW")
            try:
                relayed = wait_for_debug(
                    ava,
                    lambda d: any(abs(inp.get("f", 0)) > 0.5 for inp in (d.get("remote") or {}).values()),
                    10,
                    "friend's forward input at the host",
                )
            finally:
                ben.keyboard.up("KeyW")
            print(f"  relayed roles at host: {sorted((relayed.get('remote') or {}).keys())}")

            # The friend's view follows the host's simulated body.
            ava.wait_for_timeout(1_500)
            host_pelvis = debug(ava)["pelvis"]
            friend_state = wait_for_debug(ben, lambda d: d.get("pelvis") is not None, 10, "friend body pose")
            gap = math.dist(host_pelvis, friend_state["pelvis"])
            assert gap < 1.0, f"friend's body drifted from the host's: {gap:.2f} m"
            print(f"  host/friend pelvis gap: {gap:.3f} m")

            ava.screenshot(path=str(ARTIFACT_DIR / "shared-body-host.png"))
            ben.screenshot(path=str(ARTIFACT_DIR / "shared-body-friend.png"))
            assert not page_errors, f"uncaught browser errors: {page_errors[:5]}"
        finally:
            browser.close()

    print("shared body E2E: PASS")


if __name__ == "__main__":
    run()
