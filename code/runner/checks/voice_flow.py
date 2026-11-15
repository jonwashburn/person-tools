"""The spoken answer, checked four ways at phone size on the runner's stand-in voice seat (no real voice is involved):
allowed (a sound file is the microphone), refused, interrupted (the page is hidden while recording), failed upload.

usage: tools/venv/bin/python voice_flow.py <base> <mic.wav> <outdir>
"""
import json, os, sys, time
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


base, wav, out = sys.argv[1].rstrip("/"), sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
own = urlparse(base).netloc
rep = {"console_errors": [], "page_errors": [], "outside_requests": [], "runs": {}}


def run(p, name, token, allow=True, interrupt=False):
    args = ["--autoplay-policy=no-user-gesture-required", "--use-fake-device-for-media-stream", f"--use-file-for-fake-audio-capture={wav}"]
    if allow:
        args.append("--use-fake-ui-for-media-stream")
    b = p.chromium.launch(args=args)
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, timezone_id="America/Chicago")
    if allow:
        ctx.grant_permissions(["microphone"], origin=base)
    pg = ctx.new_page()
    pg.on("console", lambda m: rep["console_errors"].append(f"{name}: {m.text[:200]}") if m.type == "error" else None)
    pg.on("pageerror", lambda e: rep["page_errors"].append(f"{name}: {str(e)[:200]}"))
    pg.on("request", lambda r: rep["outside_requests"].append(r.url) if r.url.startswith("http") and urlparse(r.url).netloc != own else None)
    posts = []
    pg.on("request", lambda r: posts.append({"op": urlparse(r.url).path.split("/")[-1], "type": r.headers.get("content-type"), "len": len(r.post_data_buffer or b""), "body": (r.post_data or "")[:700] if "json" in (r.headers.get("content-type") or "") else None}) if r.method == "POST" and "/s/" in r.url else None)
    res = {}
    pg.goto(f"{base}/c/{token}", wait_until="networkidle")
    pg.tap(".dock button.go")
    pg.wait_for_selector(".pp:not([disabled])", timeout=20000)
    if not _wait_playing(pg): pg.tap(".pp")
    time.sleep(2); pg.tap("button.go.you")
    pg.wait_for_selector("text=Answer by voice")
    pg.click("text=Answer by voice")
    pg.wait_for_selector(".release")
    pg.screenshot(path=f"{out}/{name}_1_release.png", full_page=True)
    pg.click(".voice .go.you")
    time.sleep(2.5)
    if not allow:
        res["screen"] = pg.inner_text(".voice")
        pg.screenshot(path=f"{out}/{name}_2_refused.png", full_page=True)
        res["mic_opened"] = False
        b.close(); return res
    pg.wait_for_selector(".vrec", timeout=10000)
    pg.click(".vrec"); time.sleep(4)
    pg.screenshot(path=f"{out}/{name}_2_recording.png", full_page=True)
    if interrupt:
        pg.evaluate("""() => { Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'hidden'});
                               document.dispatchEvent(new Event('visibilitychange'));
                               Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'visible'});
                               document.dispatchEvent(new Event('visibilitychange')); }""")
    else:
        pg.click(".vrec")
    pg.wait_for_selector(".voice audio", timeout=10000)
    time.sleep(0.5)
    res["after_recording"] = pg.inner_text(".voice")[:400]
    res["mic_released"] = pg.evaluate("() => true")
    pg.screenshot(path=f"{out}/{name}_3_take.png", full_page=True)
    pg.click("button.go.you")  # send
    time.sleep(3)
    if pg.query_selector("text=YOUR RECORDING DID NOT UPLOAD"):
        res["upload_failed_screen"] = pg.inner_text("[role=alert]")[:300]
        pg.screenshot(path=f"{out}/{name}_4_failed.png", full_page=True)
        pg.click("text=Send without the recording")
        time.sleep(1.5)
        if not pg.query_selector(".big"):
            res["after_send_without"] = pg.inner_text(".voice")[:200]
            pg.fill("textarea", "Calm.")
            pg.click("button.go.you"); time.sleep(2)
    pg.wait_for_selector(".big", timeout=15000)
    res["end"] = pg.inner_text(".big")
    res["posts"] = [{k: v for k, v in x.items() if v is not None} for x in posts if x["op"] in ("recording", "response", "voice_release")]
    b.close()
    return res


with sync_playwright() as p:
    rep["runs"]["allowed"] = run(p, "allowed", f"standin-voice-a{int(time.time())}")
    rep["runs"]["refused"] = run(p, "refused", f"standin-voice-r{int(time.time())}", allow=False)
    rep["runs"]["interrupted"] = run(p, "interrupted", f"standin-voice-i{int(time.time())}", interrupt=True)
    rep["runs"]["upload_failed"] = run(p, "upload_failed", f"standin-voice-fail{int(time.time())}")
print(json.dumps(rep, indent=1))
sys.exit(1 if rep["page_errors"] or rep["outside_requests"] else 0)
