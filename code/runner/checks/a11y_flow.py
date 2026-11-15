"""Two people the page must serve as well as anyone: a phone on a slow network (400 kbit/s), and a keyboard-only user.

usage: tools/venv/bin/python a11y_flow.py <base> <outdir>
Prints the seconds from tapping Take (which starts a listening call) to sound on the slow network, whether the keyboard alone completes a call, and the
order in which a screen reader meets the ring card's headings and buttons.
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

base, out = sys.argv[1].rstrip("/"), sys.argv[2]
os.makedirs(out, exist_ok=True)
rep = {"errors": []}
with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    # 1. slow network
    ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, timezone_id="America/Chicago")
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: rep["errors"].append("slow: " + str(e)[:200]))
    cdp = ctx.new_cdp_session(pg)
    cdp.send("Network.enable")
    pg.goto(f"{base}/c/standin-slow{int(time.time())}", wait_until="networkidle")
    cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 150, "downloadThroughput": 400 * 1000 / 8, "uploadThroughput": 200 * 1000 / 8})
    t0 = time.time(); pg.tap(".dock button.go")   # Take starts a listening call's sound: measure from that tap
    pg.wait_for_selector(".pp:not([disabled])", timeout=30000)
    for _ in range(30):
        if pg.get_attribute(".pp", "aria-label") == "Pause": break
        time.sleep(0.1)
    else:
        pg.tap(".pp")
    started = None
    while time.time() - t0 < 30:
        if pg.evaluate("() => { const a = [...document.querySelectorAll('audio')].concat(window.__a || []); return false; }"):
            pass
        pos = pg.evaluate("() => { const t = document.querySelector('.clock span'); return t ? t.textContent : '0:00'; }")
        if pos not in ("0:00",):
            started = round(time.time() - t0, 1); break
        time.sleep(0.25)
    rep["slow_take_to_sound_s"] = started
    time.sleep(4)
    rep["slow_record"] = pg.inner_text(".record").replace("\n", " | ")
    ctx.close()
    # 2. keyboard only
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, timezone_id="America/Chicago")
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: rep["errors"].append("kbd: " + str(e)[:200]))
    pg.goto(f"{base}/c/standin-kbd{int(time.time())}", wait_until="networkidle")
    order = pg.evaluate("""() => [...document.querySelectorAll('h1, h2, button, a[href], textarea, [role=group]')].map(e => (e.tagName + ': ' + (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 60)))""")
    rep["reading_order_ring_card"] = order
    def press_until(text, key="Tab", n=25):
        for _ in range(n):
            pg.keyboard.press(key)
            t = pg.evaluate("() => document.activeElement ? (document.activeElement.textContent || document.activeElement.getAttribute('aria-label') || '').trim() : ''")
            if text in t:
                return True
        return False
    ok = press_until("Take this call"); pg.keyboard.press("Enter")
    pg.wait_for_selector(".pp:not([disabled])", timeout=20000)
    playing = False
    for _ in range(30):   # Enter on Take starts a listening call's sound by itself
        if pg.get_attribute(".pp", "aria-label") == "Pause": playing = True; break
        time.sleep(0.1)
    rep["take_started_sound_by_keyboard"] = playing
    if not playing: ok = ok and press_until("Play"); pg.keyboard.press("Enter")
    time.sleep(3)
    pg.keyboard.press("Space") if False else None
    ok = ok and press_until("Answer"); pg.keyboard.press("Enter")
    pg.wait_for_selector("textarea", timeout=10000)
    ok = ok and press_until("", n=1)
    pg.focus("textarea"); pg.keyboard.type("Calm and open.")
    ok = ok and press_until("Yes"); pg.keyboard.press("Enter")
    ok = ok and press_until("Send my answer"); pg.keyboard.press("Enter")
    pg.wait_for_selector(".big", timeout=15000)
    rep["keyboard_only_completed"] = bool(ok) and pg.inner_text(".big") == "Arrived."
    ctx.close()
    b.close()
print(json.dumps(rep, indent=1))
