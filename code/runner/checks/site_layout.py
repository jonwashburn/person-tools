"""The human pages (front page and /people/) at phone and laptop width: no two sections drawn over each other, no sideways
overflow. Serves code/site/human under the site's own origin (so the call frame loads), or checks the live site with --live.
usage: tools/venv/bin/python -I site_layout.py [--live] [--call]     exit 1 on any overlap or overflow
(axe and overflow checks cannot see two sections drawn over each other: 14 Nov 2026, /people/ pay section).
The phone: at 1100 and 1440 the page is scrolled top to bottom and the phone's box must never cross a heading, line or
cell of a later section (14 Nov 2026: a sticky phone covered the promises). --call presses Call me first (needs the team
header file TEAM_CHECK_ENV or ~/.config/humancall/team_check.env; the header goes to the site's /demo-key only)."""
import os, time, mimetypes, sys
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "site", "human")); SITE = "https://askpeople-site.pages.dev"
LIVE = "--live" in sys.argv; CALL = "--call" in sys.argv
TEAM = None
if CALL:
    for l in open(os.environ.get("TEAM_CHECK_ENV") or os.path.expanduser("~/.config/humancall/team_check.env")):
        if "=" in l and not l.startswith("#"): TEAM = l.split("=", 1)[1].strip().strip("'\""); break
out = os.environ.get("CHECK_SHOTS")   # a folder for full-page pictures, when wanted
if out: os.makedirs(out, exist_ok=True)
bad_any = []
def handler(route):
    path = route.request.url[len(SITE):].split("?")[0]; f = os.path.join(ROOT, path.lstrip("/"))
    if path.endswith("/") or path == "": f = os.path.join(f, "index.html")
    if os.path.isfile(f): route.fulfill(status=200, body=open(f, "rb").read(), headers={"Content-Type": mimetypes.guess_type(f)[0] or "text/html"})
    else: route.continue_()
JS = """() => { const s = [...document.querySelectorAll('main > section, main > figure, main > div:not(.stage), .stage > section:not(.hero), main section > .hero-words, main section > figure')]
  .filter(e => e.offsetParent !== null && e.getBoundingClientRect().height > 0);
  const r = s.map(e => [e.className || e.tagName, e.getBoundingClientRect()]); const bad = [];
  for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) { const a = r[i][1], b = r[j][1];
    if (/^(hero|stage)$/.test(r[i][0]) || /^(hero|stage)$/.test(r[j][0])) continue;
    const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ix > 4 && iy > 4) bad.push(r[i][0] + ' x ' + r[j][0] + ' (' + Math.round(iy) + ' px)'); }
  return bad; }"""
PHONE = """async (step) => { const ph = document.querySelector('.phone-col'); if (!ph || ph.offsetParent === null) return ['no phone column'];
  const later = [...document.querySelectorAll('main > section h2, main > section p.label, main > section li, main > section .fa-cell, main > section p.more')];
  const bad = []; const H = document.documentElement.scrollHeight;
  for (let y = 0; y <= H; y += step) { window.scrollTo(0, y); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const a = ph.getBoundingClientRect();
    for (const e of later) { const b = e.getBoundingClientRect(); const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ix > 2 && iy > 2) { bad.push('scrolled ' + y + ' px: the phone covers ' + e.tagName.toLowerCase() + ' "' + (e.textContent || '').trim().slice(0, 40) + '"'); break; } }
    if (bad.length >= 3) break; }
  window.scrollTo(0, 0); return bad; }"""
def ring(pg):
    """press Call me and wait until the call rings on the phone (the notification) or the seat opens"""
    pg.click("#ring-btn"); pg.wait_for_selector("#notif:not([hidden]), #seat:not([hidden])", timeout=60000); time.sleep(1)
with sync_playwright() as p:
    b = p.chromium.launch()
    for page in ("/", "/people/"):
        for w, hgt in ((390, 844), (1100, 800), (1440, 900)):
            ctx = b.new_context(viewport={"width": w, "height": hgt})
            if not LIVE: ctx.route(SITE + "/**", handler)
            if TEAM:
                def team(route):
                    route.continue_(headers={**route.request.headers, "x-hc-team-check": TEAM})
                ctx.route(SITE + "/demo-key", team)
            pg = ctx.new_page(); pg.goto(SITE + page, wait_until="networkidle"); time.sleep(1.2)
            ov, of = pg.evaluate(JS), pg.evaluate("() => document.documentElement.scrollWidth - innerWidth")
            print(("PASS " if not ov and of <= 0 else "FAIL ") + page + " " + str(w) + " overlaps: " + str(ov) + " | overflow " + str(of))
            if ov or of > 0: bad_any.append(page)
            if w >= 1000:
                called = False
                if CALL and page == "/":
                    try: ring(pg); called = True
                    except Exception as e: print("FAIL " + page + " " + str(w) + " Call me did not ring: " + str(e)[:120]); bad_any.append(page)
                ph = pg.evaluate(PHONE, 240)
                print(("PASS " if not ph else "FAIL ") + page + " " + str(w) + " the phone" + (" with a call on it" if called else "") + " crosses no later section: " + (str(ph) if ph else "none crossed"))
                if ph: bad_any.append(page)
            if out: pg.screenshot(path=f"{out}/{page.strip('/') or 'front'}_{w}_full.png", full_page=True)
            ctx.close()
    b.close()
sys.exit(1 if bad_any else 0)
