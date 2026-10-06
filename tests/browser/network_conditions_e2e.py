"""E2E: online play under real-world network conditions.

Two players in one room, each in an isolated browser context:
- Ava connects to SpacetimeDB directly (DIRECT_URL) and creates the room, so
  her browser simulates the squad's shared body and walks it forward.
- Ben, on a phone-sized touch context, reaches SpacetimeDB through
  scripts/net-sim-proxy.mjs (IMPAIRED_URL is a dev build whose
  NEXT_PUBLIC_SPACETIMEDB_URI points at the proxy), so his link can be made
  LAN-fast, broadband-WAN, or cellular-bad at runtime.

Checks, per profile: Ben's replica keeps rendering the shared body (few
frames outrun the jitter buffer), his buffer adapts to the measured jitter,
the round stays in sync, and his connection indicator tells the truth. Then
the proxy cuts Ben off mid-round: he must see "Reconnecting…", get back into
his seat and see "Reconnected". Finally Ava leaves mid-round and Ben's
browser must take over the body without the room falling apart.

Needs: `npm run host` (or any build) on DIRECT_URL, a dev server on
IMPAIRED_URL built with NEXT_PUBLIC_SPACETIMEDB_URI=ws://127.0.0.1:3300, and
`node scripts/net-sim-proxy.mjs` (control on PROXY_CONTROL).
"""

from __future__ import annotations

import json
import math
import os
import re
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

DIRECT_URL = os.environ.get("DIRECT_URL", "http://localhost:3101")
IMPAIRED_URL = os.environ.get("IMPAIRED_URL", "http://localhost:3102")
PROXY_CONTROL = os.environ.get("PROXY_CONTROL", "http://127.0.0.1:3301")
ARTIFACT_DIR = Path(os.environ.get("PLAYWRIGHT_ARTIFACT_DIR", ".test-dist/browser"))
ROOM_URL = re.compile(r"/play/[A-Z0-9]{8}$")

PROFILES = {
    "lan": {"delay": 2, "jitter": 1, "stallEvery": 0, "stallMs": 0},
    "broadband-wan": {"delay": 110, "jitter": 25, "stallEvery": 0, "stallMs": 0},
    "cellular": {"delay": 160, "jitter": 110, "stallEvery": 45, "stallMs": 450},
}


def proxy(path: str, body: dict | None = None) -> dict:
    request = urllib.request.Request(
        f"{PROXY_CONTROL}{path}", data=json.dumps(body or {}).encode(), method="POST"
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.loads(response.read())


def debug(page) -> dict:
    return page.evaluate("() => window.__singularityDebug ?? {}")


def wait_debug(page, predicate, seconds: float, what: str) -> dict:
    deadline = time.time() + seconds
    state = debug(page)
    while time.time() < deadline:
        state = debug(page)
        if predicate(state):
            return state
        page.wait_for_timeout(250)
    raise AssertionError(f"timed out waiting for {what}: {state}")


def measure(page, seconds: float) -> dict:
    """Replica frames and buffer over a window, plus how far the shared body moved."""
    start = debug(page)
    page.wait_for_timeout(int(seconds * 1000))
    end = debug(page)
    frames = end["replicaFrames"] - start["replicaFrames"]
    starved = end["replicaStarvedFrames"] - start["replicaStarvedFrames"]
    moved = math.dist(start["pelvis"], end["pelvis"]) if start.get("pelvis") and end.get("pelvis") else 0.0
    return {
        "frames": frames,
        "starved_pct": round(100 * starved / max(1, frames), 1),
        "interp_delay_ms": end["interpDelayMs"],
        "grade": (end.get("link") or {}).get("grade"),
        "rtt_ms": round((end.get("link") or {}).get("rttMs") or 0),
        "pelvis_moved_m": round(moved, 2),
        "phase": end["phase"],
        "round": end["round"],
    }


def run() -> None:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []
    results: dict[str, dict] = {}
    proxy("/restore")
    proxy("/profile", PROFILES["lan"])

    with sync_playwright() as playwright:
        # One browser per player: separate processes, like separate devices.
        launch = lambda: playwright.chromium.launch(  # noqa: E731
            channel="chrome",
            headless=True,
            args=["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
        )
        ava_browser, ben_browser = launch(), launch()
        ava_ctx = ava_browser.new_context(viewport={"width": 800, "height": 500})
        ava_ctx.add_init_script("localStorage.setItem('singularity_name', 'Ava')")
        ava = ava_ctx.new_page()
        ava.on("pageerror", lambda e: errors.append(f"ava: {e}"))
        ava.goto(DIRECT_URL, wait_until="domcontentloaded")
        ava.get_by_role("button", name=re.compile("Team versus", re.I)).wait_for(timeout=30_000)
        ava.wait_for_timeout(750)
        ava.get_by_role("button", name=re.compile("Team versus", re.I)).click()
        ava.get_by_role("button", name="Create room", exact=True).click()
        ava.wait_for_url(ROOM_URL, timeout=15_000)
        ava.get_by_role("button", name="READY UP").wait_for(timeout=30_000)
        code = ava.url.rsplit("/", 1)[1]
        ava.get_by_role("button", name=re.compile(r"^3 players", re.I)).click()

        phone = dict(playwright.devices["iPhone 13"])
        ben_ctx = ben_browser.new_context(**phone)
        ben_ctx.add_init_script("localStorage.setItem('singularity_name', 'Ben')")
        ben = ben_ctx.new_page()
        ben.on("pageerror", lambda e: errors.append(f"ben: {e}"))
        ben.goto(f"{IMPAIRED_URL}/play/{code}", wait_until="domcontentloaded")
        ben.get_by_role("button", name=re.compile(r"^(READY UP|READY)$")).wait_for(timeout=45_000)
        assert ben.get_by_text("host", exact=True).count() == 0, "players must never see a 'host' label"

        ava.get_by_role("button", name=re.compile(r"^(START RACE|START PRACTICE|Start anyway)$")).click()
        state = wait_debug(ben, lambda d: d.get("phase") == "playing", 20, "Ben to see the round start")
        assert state["isHost"] is False, "the room's creator, not Ben, should simulate first"
        ava.locator("canvas").click(position={"x": 400, "y": 250})
        # Ava drives arms and legs (the uncovered seat went to her); switch to legs, then walk.
        ava.get_by_role("button", name=re.compile("Control Legs", re.I)).click()
        ava.keyboard.down("w")

        for name in ("lan", "broadband-wan", "cellular"):
            proxy("/profile", PROFILES[name])
            ben.wait_for_timeout(2_500)  # let the buffer settle on the new link
            results[name] = measure(ben, 6)
            print(f"  {name:14s} {results[name]}")
            assert results[name]["phase"] == "playing", f"{name}: round fell out of sync"
            assert results[name]["frames"] > 60, f"{name}: replica stopped rendering"
        ben.screenshot(path=str(ARTIFACT_DIR / "network-cellular-phone.png"))

        assert results["lan"]["starved_pct"] < 5, f"LAN replica starved: {results['lan']}"
        assert results["broadband-wan"]["starved_pct"] < 10, f"WAN replica starved: {results['broadband-wan']}"
        assert results["cellular"]["interp_delay_ms"] > results["lan"]["interp_delay_ms"], "buffer must grow with jitter"
        assert results["lan"]["grade"] == "good", f"LAN link graded {results['lan']['grade']}"
        assert results["cellular"]["grade"] in ("fair", "poor"), "a cellular link must not claim to be good"

        # ---- hard cut, as in a tunnel or a Wi-Fi -> cellular handoff ----
        proxy("/profile", PROFILES["broadband-wan"])
        team_before = debug(ben)
        proxy("/cut")
        status = ben.get_by_test_id("connection-status")
        status.wait_for(state="visible", timeout=15_000)
        assert "Reconnecting" in status.inner_text()
        ben.wait_for_timeout(5_000)
        proxy("/restore")
        status.get_by_text(re.compile("^Reconnected$")).wait_for(timeout=30_000)
        after = wait_debug(ben, lambda d: d.get("phase") == "playing", 15, "Ben back in the round")
        assert after["round"] == team_before["round"], "reconnect must land in the same round"
        results["reconnect"] = {"phase": after["phase"], "round": after["round"]}
        print("  reconnect     ", results["reconnect"])

        # ---- the creator leaves mid-round ----
        ava.keyboard.up("w")
        ava_ctx.close()
        took_over = wait_debug(ben, lambda d: d.get("isHost") is True, 45, "Ben to take over the body")
        assert took_over["phase"] == "playing", "the round must survive its creator leaving"
        assert ben.get_by_text("host", exact=True).count() == 0
        results["creator_left"] = {"ben_simulates": True, "phase": took_over["phase"]}
        print("  creator left  ", results["creator_left"])

        (ARTIFACT_DIR / "network-conditions.json").write_text(json.dumps(results, indent=2))
        ben_ctx.close()
        ava_browser.close()
        ben_browser.close()

    assert not errors, f"uncaught browser errors: {errors[:5]}"
    print("network conditions E2E: PASS")


if __name__ == "__main__":
    run()
