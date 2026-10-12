"""Dev-only: fps with each presentation layer switched off (SwiftShader)."""
import re, sys
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3001"
COURSE = sys.argv[2] if len(sys.argv) > 2 else "Ferry Job"
FPS = """() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2500) requestAnimationFrame(f); else r(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); })"""
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True, args=["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
    page = b.new_page(viewport={"width": 1440, "height": 900})
    page.goto(f"{BASE}/play/LAYERCST?offline=1&solo=1", wait_until="domcontentloaded")
    page.wait_for_selector(".lab-loader", state="detached", timeout=90_000)
    page.get_by_role("button", name=re.compile(COURSE)).first.click()
    page.wait_for_timeout(9000)
    page.wait_for_timeout(12000)  # let adaptive quality settle
    for layer in (sys.argv[3].split(",") if len(sys.argv) > 3 else ["water", "sky", "character", "scenery", "batch", "movers", "props", "loose", "course"]):
        on = page.evaluate(FPS)
        page.evaluate(f"() => window.__singularityDev.toggle('{layer}')")
        off = page.evaluate(FPS)
        page.evaluate(f"() => window.__singularityDev.toggle('{layer}')")
        print(f"{layer:12s} on={on:5.1f} off={off:5.1f} gain={off - on:+5.1f}")
    b.close()
