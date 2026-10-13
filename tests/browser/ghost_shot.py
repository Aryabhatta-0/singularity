"""Two racers in one free-for-all room: screenshot the rival's ghost (needs the room server)."""
import os, re
from pathlib import Path
from playwright.sync_api import sync_playwright
BASE = os.environ.get("PLAYWRIGHT_BASE_URL", "http://localhost:3001")
OUT = Path(os.environ.get("PLAYWRIGHT_ARTIFACT_DIR", ".test-dist/tour/final"))
ARGS = ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"]
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True, args=ARGS)
    a = b.new_context(viewport={"width": 1280, "height": 800}).new_page()
    a.goto(BASE, wait_until="domcontentloaded")
    a.get_by_role("button", name=re.compile("Free-for-all", re.I)).wait_for(timeout=30000)
    a.wait_for_timeout(800)
    a.get_by_role("button", name=re.compile("Free-for-all", re.I)).click()
    a.get_by_role("button", name="Create room", exact=True).click()
    a.wait_for_url(re.compile(r"/play/"), timeout=15000)
    READY = re.compile(r"^(READY UP|READY)$")
    a.get_by_role("button", name=READY).wait_for(timeout=60000)
    code = a.url.split("/play/")[1].split("?")[0]
    guest = b.new_context(viewport={"width": 1280, "height": 800}).new_page()
    guest.goto(f"{BASE}/play/{code}?ffa=1", wait_until="domcontentloaded")
    guest.get_by_role("button", name=READY).wait_for(timeout=60000)
    a.wait_for_timeout(1500)
    a.screenshot(path=str(OUT / "50-ffa-lobby.png"))
    for page in (a, guest):
        button = page.get_by_role("button", name=READY)
        if button.inner_text().strip() == "READY UP":
            button.click()
    a.get_by_role("button", name=re.compile(r"^(START RACE|Start anyway)$")).click()
    a.wait_for_timeout(7000)
    guest.keyboard.down("w"); a.keyboard.down("d")
    a.wait_for_timeout(1500)
    a.keyboard.up("d"); guest.wait_for_timeout(1500); guest.keyboard.up("w")
    a.wait_for_timeout(500)
    a.screenshot(path=str(OUT / "51-ffa-ghost.png"))
    b.close()
print("ok")
