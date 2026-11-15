"""The front page as a visitor meets it: first screen, Call me, the ring, the call inside the phone, then the agent's side.

usage: tools/venv/bin/python front_flow.py <page url> <outdir> [--phone] [--dark] [--listen-seconds N] [--team]
--team: the team's own check: the header x-hc-team-check (token from the file named by TEAM_CHECK_ENV, a NAME=value file
with TEAM_CHECK_TOKEN) goes on the page's own /demo-key request only, so the demo mint's per-network limit does not make it
a rehearsal. Pictures of each agent step (step_*.png), and every request outside the page's own addresses is listed.
Exit 1 on a console error, a page error, a horizontal overflow or a request outside our addresses.
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

def _wait_playing(root, tries=30):
    """Take starts a listening call's sound by itself (the tap is the gesture): tap Play only if it is not playing."""
    for _ in range(tries):
        try:
            if root.locator(".pp").first.get_attribute("aria-label") == "Pause": return True
        except Exception: pass
        time.sleep(0.1)
    return False


url, out = sys.argv[1], sys.argv[2]
phone = "--phone" in sys.argv
dark = "--dark" in sys.argv
listen = float(sys.argv[sys.argv.index("--listen-seconds") + 1]) if "--listen-seconds" in sys.argv else 4
os.makedirs(out, exist_ok=True)
rep = {"url": url, "size": "phone" if phone else "laptop", "dark": dark, "console_errors": [], "page_errors": [], "steps": [], "outside_requests": [], "blocked_by_csp": [], "rehearsal": None}
OURS = ("askpeople-site.pages.dev", "askpeople-run.pages.dev", "askpeople-api.pages.dev", "person.tools")
team_tok = None
if "--team" in sys.argv:
    f = os.path.expanduser(os.environ.get("TEAM_CHECK_ENV", ""))
    for line in (open(f) if f and os.path.exists(f) else []):
        if line.startswith("TEAM_CHECK_TOKEN="): team_tok = line.strip().split("=", 1)[1]
    if not team_tok: sys.exit("--team needs TEAM_CHECK_ENV naming a file with TEAM_CHECK_TOKEN=...")
with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": 390, "height": 844} if phone else {"width": 1440, "height": 900},
                        device_scale_factor=2 if phone else 1, is_mobile=phone, has_touch=phone,
                        color_scheme="dark" if dark else "light")
    if team_tok:   # only on the page's own /demo-key request; never printed
        ctx.route("**/demo-key", lambda r: r.continue_(headers={**r.request.headers, "x-hc-team-check": team_tok}))
    ctx.on("request", lambda r: rep["outside_requests"].append(r.url[:120]) if r.url.startswith("http") and not any(h in r.url.split("/")[2] for h in OURS) else None)
    # an outside request the page's own CSP stops before it leaves is not sent (the person.tools zone injects an analytics tag): noted, not failed
    ctx.on("requestfailed", lambda r: rep["blocked_by_csp"].append(r.url[:120]) if r.url[:120] in rep["outside_requests"] and "csp" in str(r.failure or "").lower() else None)
    pg = ctx.new_page()
    pg.on("console", lambda m: rep["console_errors"].append(m.text[:300]) if m.type == "error" else None)
    pg.on("pageerror", lambda e: rep["page_errors"].append(str(e)[:300]))
    pg.goto(url, wait_until="networkidle")
    time.sleep(0.6)
    pg.screenshot(path=f"{out}/1_first_screen.png")
    rep["overflow_px"] = pg.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
    pg.click("#ring-btn")
    pg.wait_for_selector("#notif:not([hidden])", timeout=30000)
    time.sleep(0.5)
    pg.screenshot(path=f"{out}/2_ringing.png")
    pg.click("#notif")
    fr = pg.frame_locator("#seat")
    fr.locator(".dock button.go").wait_for(timeout=20000)
    time.sleep(0.4)
    pg.screenshot(path=f"{out}/3_ring_card.png")
    fr.locator(".dock button.go").click()
    fr.locator(".pp:not([disabled])").wait_for(timeout=20000)
    if not _wait_playing(fr): fr.locator(".pp").click()
    time.sleep(listen)
    pg.screenshot(path=f"{out}/4_listening.png")
    fr.locator("button.go.you").click()
    fr.locator("textarea").fill("Calm. The last notes lifted, like a question.")
    fr.locator(".yn button").first.click()
    fr.locator("button.go.you").click()
    fr.locator(".big").wait_for(timeout=20000)
    try:
        pg.wait_for_selector("#step-result, #step-wait.done", timeout=40000)
    except Exception:
        pass
    time.sleep(2.5)
    pg.screenshot(path=f"{out}/5_after.png")
    pg.screenshot(path=f"{out}/6_full.png", full_page=True)
    rep["steps"] = pg.eval_on_selector_all(".step .label", "els => els.map(e => e.textContent)")
    rep["rehearsal"] = bool(pg.query_selector("#step-standin"))
    try: pg.wait_for_selector("#step-outcome.done", timeout=20000)
    except Exception: pass
    for i, el in enumerate(pg.query_selector_all("#steps .step")):
        try: el.scroll_into_view_if_needed(); el.screenshot(path=f"{out}/step_{i}.png")
        except Exception: pass
    rep["steps"] = pg.eval_on_selector_all(".step .label", "els => els.map(e => e.textContent)")
    b.close()
print(json.dumps(rep, indent=1))
left = [u for u in rep["outside_requests"] if u not in rep["blocked_by_csp"]]
blocked_hosts = sorted(set(u.split("/")[2] for u in rep["blocked_by_csp"]))
# the browser's own report of a script it refused is not a page fault; any other console error still fails (chief and trust, 10:24/10:28)
errs = [e for e in rep["console_errors"] if not (any(h in e for h in blocked_hosts) and "Content Security Policy" in e)]
if rep["blocked_by_csp"]: print("NOTE blocked by the page's CSP before leaving (not sent): " + ", ".join(sorted(set(u.split("?")[0][:90] for u in rep["blocked_by_csp"]))))
sys.exit(1 if errs or rep["page_errors"] or rep["overflow_px"] > 0 or left else 0)
