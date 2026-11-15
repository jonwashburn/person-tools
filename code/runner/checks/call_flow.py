"""One person's whole call in a real browser: ring card, take, listen, answer, send (or stop).

usage: tools/venv/bin/python call_flow.py <base> <seat_token> <outdir> [--laptop] [--stop|--upset] [--listen-seconds N] [--mic file.wav]

Writes pictures of each screen and report.json: console errors, page errors, every request that left our own address
(there must be none), and the screens reached. Exit 1 on any console error, page error or outside request.
"""
import json, sys, time, os
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

def _wait_playing(root, tries=30):
    """Take starts a listening call's sound by itself (the tap is the gesture): tap Play only if it is not playing."""
    for _ in range(tries):
        try:
            if root.locator(".pp").first.get_attribute("aria-label") == "Pause": return True
        except Exception: pass
        time.sleep(0.1)
    return False


args = sys.argv[1:]
base, token, out = args[0].rstrip("/"), args[1], args[2]
laptop = "--laptop" in args
mode = "upset" if "--upset" in args else "stop" if "--stop" in args else "send"
listen_s = float(args[args.index("--listen-seconds") + 1]) if "--listen-seconds" in args else 6
mic = args[args.index("--mic") + 1] if "--mic" in args else None
os.makedirs(out, exist_ok=True)
own = urlparse(base).netloc
report = {"base": base, "token": token, "size": "laptop" if laptop else "phone", "mode": mode,
          "console_errors": [], "page_errors": [], "outside_requests": [], "screens": [], "seat_posts": []}

launch = ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]
if mic:
    launch.append(f"--use-file-for-fake-audio-capture={mic}")
with sync_playwright() as p:
    b = p.chromium.launch(args=launch)
    ctx = b.new_context(viewport={"width": 1440, "height": 900} if laptop else {"width": 390, "height": 844},
                        device_scale_factor=1 if laptop else 3, is_mobile=not laptop, has_touch=not laptop,
                        user_agent=None if laptop else "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")
    pg = ctx.new_page()
    pg.on("console", lambda m: report["console_errors"].append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: report["page_errors"].append(str(e)))

    def on_req(r):
        u = urlparse(r.url)
        if u.scheme in ("http", "https") and u.netloc != own:
            report["outside_requests"].append(r.url)
        if u.netloc == own and r.method == "POST" and u.path.startswith("/s/"):
            report["seat_posts"].append({"path": u.path.split("/", 3)[-1], "body": (r.post_data or "")[:600]})
    pg.on("request", on_req)

    def shot(name):
        pg.screenshot(path=f"{out}/{name}.png", full_page=True)
        report["screens"].append({"name": name, "bar": pg.inner_text("#bar-label")})

    pg.goto(f"{base}/c/{token}", wait_until="networkidle")
    pg.wait_for_selector(".ask, .big", timeout=15000)
    shot("1_ring_card")
    if pg.query_selector(".big"):
        json.dump(report, open(f"{out}/report.json", "w"), indent=1); b.close(); sys.exit(0)
    tap = (lambda sel: pg.tap(sel)) if not laptop else (lambda sel: pg.click(sel))
    tap("button.go")
    pg.wait_for_selector(".pp:not([disabled])", timeout=20000)
    shot("2_player_ready")
    if not _wait_playing(pg): tap(".pp")
    time.sleep(listen_s)
    tap(".pp")  # pause once
    time.sleep(0.6)
    tap(".pp")  # resume
    time.sleep(1.5)
    shot("3_listening")
    if mode in ("stop", "upset"):
        tap("#stop-btn")
        pg.wait_for_selector("dialog .choice")
        shot("4_stop_sheet")
        tap("dialog .choice.upset" if mode == "upset" else "dialog .choice:not(.upset)")
        pg.wait_for_selector(".big", timeout=15000)
        shot("5_stopped")
    else:
        tap("button.go.you")
        pg.wait_for_selector("textarea", timeout=10000)
        pg.fill("textarea", "Calm, a little like waiting for a bus at dawn. The last notes lifted.")
        pg.type("textarea", " I liked it.")
        yn = pg.query_selector(".yn button")
        if yn:
            yn.click()
        time.sleep(0.4)
        shot("4_answer")
        tap("button.go.you")
        pg.wait_for_selector(".big", timeout=15000)
        shot("5_arrived")
    time.sleep(0.5)
    b.close()

json.dump(report, open(f"{out}/report.json", "w"), indent=1)
bad = report["console_errors"] or report["page_errors"] or report["outside_requests"]
print(json.dumps({k: (v if not isinstance(v, list) or len(v) < 8 else v[:8]) for k, v in report.items() if k != "seat_posts"}, indent=1))
print("seat posts:", [s["path"] for s in report["seat_posts"]])
sys.exit(1 if bad else 0)
