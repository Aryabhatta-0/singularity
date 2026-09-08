"""Manual playtest driver: solo Ferry Job (medium), muted.

Stages (STAGE env: lobby | grab | carry | all):
- opens a solo room, mutes audio, picks Ferry Job, starts practice
- grab: walks to the cargo and attempts a two-hand grab, reports Holding chip
- carry: continues through hurdle / squeeze bar / ferries / deliver, reporting
Dumps observations + screenshots to .test-dist/browser/ferry-*. Muted throughout.
"""

from __future__ import annotations

import io
import os
import re
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("PLAYWRIGHT_BASE_URL", "http://localhost:3001")
ARTIFACT_DIR = Path(".test-dist/browser")
STAGE = os.environ.get("STAGE", "grab")
BRACE = os.environ.get("BRACE", "1") == "1"


def holding(page) -> bool:
    """Cargo held = the Holding chip is visible (it hides while hanging, so
    ferry-edge grabs never count; HUD refreshes at 10Hz)."""
    try:
        return page.get_by_text("Holding — Arms", exact=False).count() > 0
    except Exception:
        return False


def pelvis_z(page) -> float | None:
    try:
        dbg = page.evaluate("() => window.__singularityDebug ?? null")
        p = (dbg or {}).get("pelvis")
        return p[2] if p else None
    except Exception:
        return None


def cargo_gold_px(page) -> int:
    """Gold pixels (#e3b04b crate) in the body ROI — ground truth for a held
    (or adjacent) cargo, independent of HUD chips."""
    shot = page.screenshot(
        clip={"x": 550, "y": 280, "width": 350, "height": 300}
    )
    img = Image.open(io.BytesIO(shot)).convert("RGB")
    px = img.load()
    n = 0
    for y in range(0, img.height, 2):
        for x in range(0, img.width, 2):
            r, g, b = px[x, y]
            if r > 200 and 150 <= g <= 200 and b < 120:
                n += 1
    return n


def observe(page, tag: str) -> dict:
    timer = ""
    try:
        timer = page.locator(".game-timer").inner_text().replace("\n", " | ")[:120]
    except Exception:
        pass
    chips = {}
    # NB: plain "Fallen" also matches the role-card docs — use chip prefixes.
    for name in ["Holding — Arms", "Fallen — Torso", "Hanging — Arms", "Crouching"]:
        try:
            chips[name] = page.get_by_text(name, exact=False).count()
        except Exception:
            chips[name] = -1
    results = page.get_by_text("RESULTS", exact=True).count() > 0
    try:
        gold = cargo_gold_px(page)
    except Exception:
        gold = -1
    obs = {"tag": tag, "timer": timer, "chips": chips, "results": results}
    print(f"[{tag}] timer={timer!r} chips={chips} gold={gold} results={results}", flush=True)
    page.screenshot(path=str(ARTIFACT_DIR / f"ferry-{tag}.png"))
    return obs


def hold(page, key: str, seconds: float) -> None:
    page.keyboard.down(key)
    page.wait_for_timeout(int(seconds * 1000))
    page.keyboard.up(key)


def leap(page, run_s: float = 0.25, air_s: float = 0.45) -> None:
    """Running jump: brief run-up, Space tap, keep walking to land + settle."""
    hold(page, "w", run_s)
    page.keyboard.down(" ")
    page.wait_for_timeout(120)
    page.keyboard.up(" ")
    hold(page, "w", air_s)


def ferry_center_x(page, roi: tuple[int, int, int, int]) -> float | None:
    """Screen x-centroid of the nearest teal ferry deck in ROI (or None).

    Ferry tops (#4fd1c5) are the only bright high-green+high-blue masses on
    the water; the white water-grid lines are too sparse to move the centroid.
    Clipped screenshots keep each poll ~0.3s so the prediction stays fresh.
    """
    x0, y0, x1, y1 = roi
    shot = page.screenshot(clip={"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0})
    img = Image.open(io.BytesIO(shot)).convert("RGB")
    px = img.load()
    xs: list[int] = []
    ys: list[int] = []
    for y in range(0, img.height, 2):
        for x in range(0, img.width, 2):
            r, g, b = px[x, y]
            if g > 150 and b > 150 and (r + g + b) > 430:
                xs.append(x + x0)
                ys.append(y + y0)
    if len(xs) < 150:
        return None
    # Nearest deck = lowest on screen; keep the lower half of pixels.
    order = sorted(range(len(xs)), key=lambda i: ys[i], reverse=True)
    near = order[: len(order) // 2]
    return sum(xs[i] for i in near) / len(near)


def wait_ferry_centered(page, roi: tuple[int, int, int, int], tag: str, tries: int = 12) -> bool:
    for attempt in range(tries):
        cx = ferry_center_x(page, roi)
        print(f"[ferry-servo:{tag}] attempt={attempt} cx={cx}", flush=True)
        if cx is not None and abs(cx - 720) < 130:
            return True
        page.wait_for_timeout(600)
    return False


def wait_ferry_extreme(page, roi: tuple[int, int, int, int], tag: str, tries: int = 40) -> float | None:
    """Wait until the ferry lingers near a slide extreme; return its side.

    Screen travel is only ~±105px, so extremes are detected by slowness, not
    position: |vx| < 40px/s while off-center means the deck sits nearly still
    for ~1.5s. Mounts there are gentle — no lateral drag to stumble the body
    or wrench the cargo. +1 = right, -1 = left.
    """
    import time as _time

    prev = ferry_center_x(page, roi)
    prev_t = _time.monotonic()
    for attempt in range(tries):
        page.wait_for_timeout(200)
        cx = ferry_center_x(page, roi)
        now = _time.monotonic()
        dt = max(0.05, now - prev_t)
        vx = None if (prev is None or cx is None) else (cx - prev) / dt
        print(f"[ferry-extreme:{tag}] attempt={attempt} cx={cx} vx={vx}", flush=True)
        prev, prev_t = cx, now
        if cx is None or vx is None:
            continue
        if abs(vx) < 40 and abs(cx - 725) > 55:
            return 1.0 if cx > 725 else -1.0
    return None


def wait_ferry_slow_ahead(page, roi: tuple[int, int, int, int], tag: str, tries: int = 40) -> bool:
    """Fire when the next deck is slow AND straight ahead of the body.

    Screen center = body line; slow (|vx| small) = gentle transfer. Used for
    ferry-to-ferry steps while riding a moving deck (crouched).
    """
    import time as _time

    prev = ferry_center_x(page, roi)
    prev_t = _time.monotonic()
    for attempt in range(tries):
        page.wait_for_timeout(200)
        cx = ferry_center_x(page, roi)
        now = _time.monotonic()
        dt = max(0.05, now - prev_t)
        vx = None if (prev is None or cx is None) else (cx - prev) / dt
        print(f"[ferry-slow:{tag}] attempt={attempt} cx={cx} vx={vx}", flush=True)
        prev, prev_t = cx, now
        if cx is None or vx is None:
            continue
        if abs(vx) < 60 and abs(cx - 720) < 120:
            return True
    return False


def beam_dx(page) -> float | None:
    """Horizontal screen offset of the nearest tan beam vs body (body ≈ x720).

    Positive => beam is right of the body => strafe D (+x) to recenter.
    """
    shot = page.screenshot()
    img = Image.open(io.BytesIO(shot)).convert("RGB")
    x0, y0, x1, y1 = (400, 420, 1050, 760)
    crop = img.crop((x0, y0, x1, y1))
    px = crop.load()
    xs: list[int] = []
    ys: list[int] = []
    for y in range(0, crop.height, 3):
        for x in range(0, crop.width, 3):
            r, g, b = px[x, y]
            if r > 180 and 120 <= g <= 200 and b < 140:
                xs.append(x + x0)
                ys.append(y + y0)
    if len(xs) < 300:
        return None
    order = sorted(range(len(xs)), key=lambda i: ys[i], reverse=True)
    near = order[: len(order) // 2]
    cx = sum(xs[i] for i in near) / len(near)
    return cx - 720


def run() -> None:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            channel="chrome",
            headless=True,
            args=[
                "--use-angle=swiftshader",
                "--enable-webgl",
                "--ignore-gpu-blocklist",
                "--disable-dev-shm-usage",
                "--autoplay-policy=no-user-gesture-required",
            ],
        )
        page = browser.new_context(viewport={"width": 1440, "height": 900}).new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)[:200]))

        page.goto(BASE_URL, wait_until="domcontentloaded", timeout=30_000)
        page.get_by_role("button", name=re.compile("Free-for-all", re.I)).wait_for(timeout=30_000)
        page.wait_for_timeout(750)
        page.get_by_role("button", name=re.compile("Free-for-all", re.I)).click()
        page.wait_for_url(re.compile(r"/play/[A-Z0-9]{8}\?solo=1$"), timeout=10_000)
        page.get_by_role("button", name=re.compile(r"^(READY UP|READY)$")).wait_for(
            state="visible", timeout=30_000
        )

        # Mute for the whole session.
        mute = page.get_by_role("button", name="Mute game audio")
        if mute.count() > 0 and mute.is_visible():
            mute.click()
            page.get_by_role("button", name="Unmute game audio").wait_for(timeout=5_000)
            print("[mute] audio muted", flush=True)

        # Pick the medium challenge.
        page.get_by_role("button", name=re.compile(r"Ferry Job", re.I)).click()
        page.wait_for_timeout(500)
        ready = page.get_by_role("button", name=re.compile(r"^(READY UP|READY)$"))
        if ready.inner_text().strip() == "READY UP":
            ready.click()
        start = page.get_by_role("button", name=re.compile(r"^(START PRACTICE|Start anyway)$"))
        start.wait_for(state="visible", timeout=10_000)
        start.click()
        page.locator(".game-timer").wait_for(state="visible", timeout=15_000)
        # Countdown runs ~4.2s with the body frozen (early inputs are harmless).
        page.wait_for_timeout(5500)
        observe(page, "spawn")

        # Approach the cargo pedestal (~3m ahead) — stop short, don't climb it.
        hold(page, "w", 0.7)
        page.wait_for_timeout(300)
        observe(page, "walk-1")

        # Grab: E down BEFORE contact, arms neutral, ease in with short taps.
        # (Raising first overshoots — hands must meet the crate at waist height.)
        page.keyboard.down("e")
        for step in range(8):
            hold(page, "w", 0.3)
            page.wait_for_timeout(400)
            obs = observe(page, f"grab-{step}")
            if holding(page):
                break
        if STAGE == "grab":
            page.keyboard.up("e")
            print(f"[done] page errors: {errors[:5]}", flush=True)
            browser.close()
            return

        # Carry at neutral height (BRACE=1 holds B to stiffen balance).
        # Hurdle ~7m ahead: walk most of it, then tap through gently so the
        # stride steps over instead of tripping at full speed.
        if BRACE:
            page.keyboard.down("b")
        hold(page, "w", 2.0)
        for _ in range(3):
            hold(page, "w", 0.4)
            page.wait_for_timeout(300)
        observe(page, "past-hurdle")

        # Squeeze bar: crouch + lower arms, push through.
        page.keyboard.down("c")
        page.keyboard.down("ArrowDown")
        page.wait_for_timeout(800)
        page.keyboard.up("ArrowDown")
        hold(page, "w", 3.0)
        page.keyboard.up("c")
        observe(page, "past-squeeze")

        # Ferries: approach the dock edge under pelvis closed-loop control —
        # tap + settle, never arrive hot (overshoot = swim = cargo reset).
        # B down only when BRACE=1 (matrix tests brace influence).
        if BRACE:
            page.keyboard.down("b")
        # Two-phase: normal taps far out, micro-taps near the edge. The
        # stride slides during settle, so big taps overshoot into the drink
        # (splash = cargo reset). Stop the pelvis at ~-18.5 (feet ~-18.9).
        for _ in range(14):
            z = pelvis_z(page)
            print(f"[dock-approach] z={z}", flush=True)
            if z is not None and z <= -18.5:
                break
            if z is not None and z <= -16.5:
                hold(page, "w", 0.15)
                page.wait_for_timeout(700)
            else:
                hold(page, "w", 0.3)
                page.wait_for_timeout(600)
        page.wait_for_timeout(800)
        observe(page, "dock-edge")
        if not holding(page):
            print("[dock-edge] arrived WITHOUT cargo — aborting carry", flush=True)
            page.keyboard.up("e")
            if BRACE:
                page.keyboard.up("b")
            print(f"[done] page errors: {errors[:5]}", flush=True)
            browser.close()
            return

        if STAGE == "mountdiag":
            # Bisect the standstill drop: LIFT=1 raises cargo first (old path),
            # LIFT=0 keeps it neutral. B held only if BRACE=1. Logs fallen to
            # catch sub-second micro-falls that release the holds invisibly.
            if os.environ.get("LIFT", "0") == "1":
                page.keyboard.down("ArrowUp")
                page.wait_for_timeout(500)
                page.keyboard.up("ArrowUp")
            if BRACE:
                page.keyboard.down("b")
            for sec in range(3):
                page.wait_for_timeout(2000)
                dbg = page.evaluate("() => window.__singularityDebug ?? null")
                print(f"[debug+{2*(sec+1)}s] {dbg}", flush=True)
            observe(page, "stand-still")
            hold(page, "w", 0.5)
            observe(page, "step-only")
            page.keyboard.up("b")
            page.keyboard.up("e")
            print(f"[done] page errors: {errors[:5]}", flush=True)
            browser.close()
            return
        # Mount ferry-1 with up to 2 recovery retries: wait for the deck to
        # linger at a slide extreme (slow), then land MID-deck with an
        # ADAPTIVE diagonal from the live pelvis position (fixed bursts
        # straddle edges or overshoot into the drink). E stays held, and W
        # NEVER comes up between mount and beam — feet keep stepping.
        mounted = False
        for cross in range(3):
            # Wide ROI: at the edge the near ferry sits LOW in frame; a
            # tight band clips it and the servo tracks the FAR ferry instead.
            side = wait_ferry_extreme(page, (520, 300, 980, 600), "ferry-1")
            dbg = page.evaluate("() => window.__singularityDebug ?? null") or {}
            pel = (dbg.get("pelvis") or [0, 1, -19.0])
            deck_cx = ferry_center_x(page, (580, 310, 920, 450))
            deck_x = ((deck_cx or 725) - 725) / 48.0
            dx, dz = deck_x - pel[0], -20.5 - pel[2]
            burst = min(0.9, max(abs(dx), abs(dz)) / 2.4 + 0.1)
            key = "d" if dx >= 0 else "a"
            print(f"[mount] pelvis={pel} deck_x={deck_x:.2f} burst={burst:.2f}s", flush=True)
            page.keyboard.down("w")
            if abs(dx) >= 0.4:
                page.keyboard.down(key)
            page.wait_for_timeout(int(burst * 1000))
            if abs(dx) >= 0.4:
                page.keyboard.up(key)
            # W STAYS DOWN — keep walking (feet keep stepping on decks).
            print(f"[mount] post: {page.evaluate('() => window.__singularityDebug ?? null')}", flush=True)
            page.wait_for_timeout(1500)
            observe(page, f"ferry-1-try{cross}")
            if holding(page):
                mounted = True
                break
            # Not holding: release W and recover (S-back + crouch re-grab).
            page.keyboard.up("w")
            print(f"[recover] crate dropped, stepping back to re-grab (try{cross})", flush=True)
            hold(page, "s", 1.2)
            page.keyboard.down("c")
            for tap in range(6):
                hold(page, "w", 0.3)
                page.wait_for_timeout(250)
                if holding(page):
                    break
                hold(page, "s", 0.3)
                page.wait_for_timeout(250)
                if holding(page):
                    break
            page.keyboard.up("c")
            observe(page, f"regrab{cross}")
            if not holding(page):
                print("[recover] crate is gone (likely reset to start) — aborting carry", flush=True)
                break
        if not mounted:
            page.keyboard.up("w")
            observe(page, "ferry-1")
            print("[ferry-1] mount failed — aborting carry", flush=True)
            page.keyboard.up("e")
            print(f"[done] page errors: {errors[:5]}", flush=True)
            browser.close()
            return
        # Still walking (W down since the mount): cross f1 + gap + f2 zones.
        page.wait_for_timeout(1200)
        observe(page, "ferry-2")
        if not holding(page):
            print("[ferry-2] lost cargo on transfer — aborting carry", flush=True)
            page.keyboard.up("w")
            page.keyboard.up("e")
            print(f"[done] page errors: {errors[:5]}", flush=True)
            browser.close()
            return
        # Walking beam servo: W NEVER comes up (feet keep stepping); strafe
        # toward the beam center-line without stopping. Beam is static/6m.
        # NOTE: W is already down from the mount — do not press it again.
        for attempt in range(3):
            dx = beam_dx(page)
            print(f"[beam-servo] attempt={attempt} dx={dx}", flush=True)
            if dx is None or abs(dx) < 60:
                break
            key = "d" if dx > 0 else "a"
            page.keyboard.down(key)
            page.wait_for_timeout(min(500, int(abs(dx) / 300 * 1000)))
            page.keyboard.up(key)
        page.wait_for_timeout(1200)
        page.keyboard.up("w")
        observe(page, "beam")

        # Deliver pad: walk in, release brace + grab.
        hold(page, "w", 3.0)
        if BRACE:
            page.keyboard.up("b")
        page.keyboard.up("e")
        page.wait_for_timeout(1500)
        observe(page, "deliver")
        hold(page, "w", 2.0)
        observe(page, "final")

        print(f"[done] page errors: {errors[:5]}", flush=True)
        browser.close()


if __name__ == "__main__":
    run()
