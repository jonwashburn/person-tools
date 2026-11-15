"""Every kind of call, as a person meets it at phone size: ring card, take, the experience, answer, send.

usage: tools/venv/bin/python kinds_flow.py <base> <outdir> [kinds...]     (kinds: listen watch view compare play)
A kind may be given as kind=<seat token> to run a real seat (a team-test call's seat) instead of a stand-in.
Uses the runner's stand-in seats (standin-<kind>-...). Exit 1 on a console error, a page error or an outside request.
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


base, out = sys.argv[1].rstrip("/"), sys.argv[2]
kinds = sys.argv[3:] or ["listen", "watch", "view", "compare", "play"]
os.makedirs(out, exist_ok=True)
own = urlparse(base).netloc
rep = {"console_errors": [], "page_errors": [], "outside_requests": [], "blocked_by_csp": [], "kinds": {}}
with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    for k in kinds:
        k, _, real_tok = k.partition("=")
        ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, timezone_id="America/Chicago")
        pg = ctx.new_page()
        pg.on("console", lambda m, k=k: rep["console_errors"].append(f"{k}: {m.text[:200]}") if m.type == "error" else None)
        pg.on("pageerror", lambda e, k=k: rep["page_errors"].append(f"{k}: {str(e)[:200]}"))
        pg.on("request", lambda r: rep["outside_requests"].append(r.url) if r.url.startswith("http") and urlparse(r.url).netloc != own else None)
        # an outside request the page's own CSP stops before it leaves is not sent (a zone once injected an analytics tag): noted, not failed
        pg.on("requestfailed", lambda r: rep["blocked_by_csp"].append(r.url) if r.url in rep["outside_requests"] and "csp" in str(r.failure or "").lower() else None)
        posts = []
        pg.on("request", lambda r: posts.append((urlparse(r.url).path.split("/")[-1], (r.post_data or "")[:900])) if r.method == "POST" and "/s/" in r.url else None)
        pg.goto(f"{base}/c/{real_tok}" if real_tok else f"{base}/c/standin-{k}-check{int(time.time())}", wait_until="networkidle")
        pg.wait_for_selector(".dock button.go", timeout=15000)
        pg.screenshot(path=f"{out}/{k}_1_card.png")
        pg.tap(".dock button.go")
        time.sleep(1.5)
        if k in ("listen", "watch"):
            pg.wait_for_selector(".pp:not([disabled])", timeout=20000)
            if k == "watch":
                pg.tap(".reveal")
            if not _wait_playing(pg, 15 if k == "listen" else 1): pg.tap(".pp")
            time.sleep(3.5)
            if k == "watch":
                pg.click("text=Sound on")
            time.sleep(1)
            if real_tok:   # real seats: to the end, as a person who was asked to would
                media = pg.evaluate("() => { const t = document.querySelector('.clock span:last-child'); return t ? t.textContent : '0:30'; }")
                mm, ss = (media.split(":") + ["0"])[:2]
                time.sleep(max(0, int(mm) * 60 + int(ss) - 4.5 + 1.5))
        elif k == "view":
            pg.wait_for_selector(".reveal, .cmp-text")
            if pg.query_selector(".reveal"): pg.tap(".reveal")   # a picture starts blurred; a text is shown at once
            time.sleep(5.5 if real_tok else 1.2)   # real seats: long enough to count (5 s)
            pg.mouse.wheel(0, 900); time.sleep(1.5)
        elif k == "compare":
            pg.wait_for_selector(".reveal, .cmp-text")
            if not pg.query_selector(".reveal"): time.sleep(13 if real_tok else 2.5)   # text pieces: read them
            for el in pg.query_selector_all(".reveal"):   # a person looks at each piece for a while (real seats: long enough to count)
                el.scroll_into_view_if_needed(); el.tap(); time.sleep(6.5 if real_tok else 1.2)
                if real_tok: pg.mouse.wheel(0, 120); time.sleep(0.4)
        elif k == "play":
            pg.wait_for_selector("iframe.game"); time.sleep(1.5)
            fr = pg.frame_locator("iframe.game")
            fr.locator("#go").click(); time.sleep(3)
            t_play = time.time()
            for _ in range(10 if real_tok else 4):   # real seats: 30 s and 5 inputs count as attended
                d = fr.locator(".dot").first
                try:
                    d.click(timeout=800)
                except Exception:
                    pass
            if real_tok: time.sleep(max(0, 33 - (time.time() - t_play)))
            time.sleep(1)
        pg.screenshot(path=f"{out}/{k}_2_experience.png", full_page=True)
        rec = pg.inner_text(".record") if pg.query_selector(".record") else ""
        if k != "answer": pg.click("button.go.you")   # an answer-only call opens on its questions
        pg.wait_for_selector(".field", timeout=10000)
        if pg.query_selector("textarea"):
            for t in pg.query_selector_all("textarea"):
                t.fill("It was clear: a clock that shows the tide.")
        for grp in pg.query_selector_all(".choices, .scale, .yn"):
            bt = grp.query_selector_all("button")
            if bt:
                bt[-1].click()
        time.sleep(0.4)
        pg.screenshot(path=f"{out}/{k}_3_answer.png", full_page=True)
        gets = pg.inner_text(".gets") if pg.query_selector(".gets") else ""
        pg.click("button.go.you")
        pg.wait_for_selector(".big", timeout=15000)
        sent = [x for x in posts if x[0] == "response"]
        rep["kinds"][k] = {"record_on_screen": rec.replace("\n", " | ")[:300], "asker_receives_box": gets.replace("\n", " | ")[:400],
                           "end": pg.inner_text(".big"), "response_body": sent[-1][1] if sent else None}
        if k == "play":
            # the game's frame must not reach anything: its document is sandboxed with no network
            rep["kinds"][k]["frame_sandbox"] = pg.evaluate("() => null")
        ctx.close()
    b.close()
print(json.dumps(rep, indent=1))
left = [u for u in rep["outside_requests"] if u not in rep["blocked_by_csp"]]
blocked = sorted(set(u.split("?")[0][:90] for u in rep["blocked_by_csp"]))
# the browser's own report of a script it refused is not a page fault; any other console error still fails
errs = [e for e in rep["console_errors"] if not any(urlparse(b).netloc in e and "Content Security Policy" in e for b in blocked)]
if blocked: print("NOTE blocked by the page's CSP before leaving (not sent): " + ", ".join(blocked))
sys.exit(1 if errs or rep["page_errors"] or left else 0)
