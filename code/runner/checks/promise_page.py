"""The promise lines a person can see, checked on the live runner page after every release (TEAM.md item P6).

usage: tools/venv/bin/python -I promise_page.py [--base https://<runner host>] [--member MEMBER_n] [--leave]
Prints one line per check: "PASS [Pn] name" or "FAIL [Pn] name: why". Exit 1 if any line fails.
Tags: [Pn] marks a line in a set that, all passing, checks the WHOLE of promise Pn on the person's side; [Pn part] marks
a line that checks only part of Pn (the rest is the service's to check: pay, ring rules, what is stored). A counter
should count Pn only when every [Pn] line passed and no [Pn] or [Pn part] line failed. Uses the runner's own
stand-in seats (standin-*), so it needs no key, no router state and no person; with --member it also reads a team-test
member's page and one of its receipts (MEMBER_n from team_test.env). bin/baseline may run it as it is.
"""
import json, os, re, sys, time, urllib.request
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


HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
names = json.load(open(os.path.join(WORK, "canon", "names.json")))
args = sys.argv[1:]
base = (args[args.index("--base") + 1] if "--base" in args else "https://" + names["fallback_hosts"]["run"]).rstrip("/")
receipt = args[args.index("--receipt") + 1] if "--receipt" in args else None
own = urlparse(base).netloc
results = []


def line(ok, tag, name, why=""):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + f"[{tag}] {name}" + ("" if ok else f": {why}"))


stamp = str(int(time.time()))
with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])

    def page():
        ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, timezone_id="America/Chicago")
        pg = ctx.new_page()
        pg._outside = []
        pg._blocked = []   # outside requests the page's own CSP stopped before they left (a zone once injected an analytics tag)
        pg.on("request", lambda r: pg._outside.append(r.url) if r.url.startswith("http") and urlparse(r.url).netloc != own else None)
        pg.on("requestfailed", lambda r: pg._blocked.append(r.url) if r.url in pg._outside and "csp" in str(r.failure or "").lower() else None)
        pg.add_init_script("""(() => { window.__mic = 0; const md = navigator.mediaDevices; if (md && md.getUserMedia) { const g = md.getUserMedia.bind(md);
            md.getUserMedia = (c) => { window.__mic++; return g(c); }; } })();""")
        return ctx, pg

    # P1: the ring card, before the seat is taken
    ctx, pg = page()
    resp = pg.goto(f"{base}/c/standin-promise{stamp}", wait_until="networkidle")
    pg.wait_for_selector(".dock button.go", timeout=20000)
    card = pg.inner_text("main")
    need = {"an AI is asking": r"An AI is asking", "who answers for the call": r"who is responsible for this call|who answers for this call", "minutes": r"\d+\s*min",
            "pay or UNPAID TEST": r"UNPAID TEST|PAID TO YOU", "the content rating": r"Content\.", "what will be recorded": r"WHAT IS RECORDED"}
    missing = [k for k, rx in need.items() if not re.search(rx, card, re.I)]
    line(not missing, "P1", "the ring card shows who answers, that an AI asks, minutes, pay, rating and what is recorded, before the seat is taken", "missing " + ", ".join(missing))
    csp = (resp.headers or {}).get("content-security-policy", "")
    line("default-src 'self'" in csp and "connect-src 'self'" in csp, "P7 part", "the call page's content-security policy lets it reach only our own address", csp[:80] or "no CSP header")
    line("no mark against you" in card, "P2 part", "the card says declining leaves no mark", "sentence missing")
    line(not pg.query_selector("main textarea, main input, main select"), "P5 part", "no question is asked before the seat is taken (the ring card has no field to fill)", "a field on the ring card")
    held = pg.inner_text("#held") if pg.query_selector("#held") else ""
    line(bool(re.search(r"Your place is held(?::? (?:for )?about (?:a minute|\d+ min(?:utes)?)|(?: for|:) \d+:\d\d)", held)), "P3", "the ring card says how long the offer is held for the person (exact seconds in the last 20)", held[:60] or "no hold line")
    line("Report this call" in card, "P11 part", "a call can be reported from the ring card, before taking it (the tester notice names 'Report this call')", "no report control on the card")
    # take, listen a little: Stop and 'Stop: this upset me' on the experience screen
    pg.tap(".dock button.go")
    pg.wait_for_selector(".pp:not([disabled])", timeout=20000)
    if not _wait_playing(pg): pg.tap(".pp")
    time.sleep(2)
    stop_vis = pg.is_visible("#stop-btn")
    pg.tap("#stop-btn"); pg.wait_for_selector("dialog .choice")
    sheet = pg.inner_text("dialog")
    line(stop_vis and "Stop: this upset me" in sheet and "Nothing counts against you" in sheet, "P11 part", "Stop and 'Stop: this upset me' are on the listening screen, and stopping counts against nobody", sheet[:120])
    pg.click("dialog .quiet")  # keep going
    pg.tap("button.go.you")
    pg.wait_for_selector("textarea")
    line(pg.is_visible("#stop-btn"), "P11 part", "Stop is on the answer screen too", "no stop button")
    pg.fill("textarea", "A half-finished thought.")
    pg.tap("#stop-btn"); pg.wait_for_selector("dialog .choice")
    pg.click("dialog .choice:not(.upset)")
    pg.wait_for_selector("dialog .choice")
    partial = pg.inner_text("dialog")
    line("Send what you wrote?" in partial and "Don" in partial, "P2 part", "a partial answer goes to the asker only if the person chooses", partial[:100])
    pg.click("text=Don’t send it")
    pg.wait_for_selector(".big")
    end = pg.inner_text("main")
    line("Stopped." in end and "not sent" in end, "P2 part", "stopping without sending sends nothing", end[:100])
    left = [u for u in pg._outside if u not in pg._blocked]
    if pg._blocked: print("NOTE [P7] blocked by the page's CSP before leaving (not sent): " + ", ".join(sorted(set(u.split("?")[0][:90] for u in pg._blocked))))
    line(not left, "P7 part", "a whole call makes no request outside our own address (material from our own storage)", ", ".join(left[:3]))
    ctx.close()

    # P3: a full call never lets work start
    ctx, pg = page()
    pg.goto(f"{base}/c/standin-full", wait_until="networkidle")
    pg.wait_for_selector(".dock button.go"); pg.tap(".dock button.go")
    pg.wait_for_selector(".big", timeout=15000)
    t = pg.inner_text("main")
    line("Nothing is lost" in t and not pg.query_selector(".pp, textarea"), "P3", "a call that filled first says so before any work, and nothing counts against the person", t[:100])
    ctx.close()

    # P8: no microphone before the release is signed
    ctx, pg = page()
    pg.goto(f"{base}/c/standin-voice-promise{stamp}", wait_until="networkidle")
    pg.wait_for_selector(".dock button.go"); pg.tap(".dock button.go")
    pg.wait_for_selector(".pp:not([disabled])"); pg.tap("button.go.you")
    pg.wait_for_selector("text=Answer by voice"); pg.click("text=Answer by voice")
    pg.wait_for_selector(".release")
    before = pg.evaluate("() => window.__mic")
    pg.click(".voice .go.you"); time.sleep(2)
    after = pg.evaluate("() => window.__mic")
    line(before == 0 and after >= 1, "P8 part", "the microphone is not asked for until the release is signed on the screen", f"mic calls before={before}, after={after}")
    # P8: after a take, sharing the recording starts at No, and the person sees that the asker gets the words only
    share_txt, recv = "", ""
    try:
        pg.wait_for_selector(".vrec", timeout=10000); pg.click(".vrec"); time.sleep(2.5); pg.click(".vrec")
        pg.wait_for_selector(".voice audio", timeout=10000); time.sleep(0.5)
        tg = pg.query_selector(".voice .toggle")
        share_txt = (tg.get_attribute("aria-pressed") + " " + tg.inner_text()) if tg else ""
        recv = pg.inner_text("main")
    except Exception as e:
        share_txt = "error: " + str(e)[:80]
    line(share_txt.startswith("false") and "only the words" in share_txt and "The recording itself: no" in recv, "P8 part",
         "after a spoken answer, sharing the recording starts at No, and the screen says the asker gets the words only", share_txt[:80])
    ctx.close()

    # P6/P7 on the person's page: each receipt says who is responsible and whether it was paid (chief's round-1 order 1)
    member = args[args.index("--member") + 1] if "--member" in args else None
    if member:
        env = dict(l.strip().split("=", 1) for l in open(os.path.expanduser("~/.config/humancall/team_test.env")) if "=" in l)
        ctx, pg = page()
        pg.goto(f"{base}/m/{env[member]}", wait_until="networkidle"); time.sleep(3)
        if pg.query_selector(".show-all"): pg.click(".show-all"); time.sleep(0.5)   # the page shows the newest five first
        rows = [r.inner_text() for r in pg.query_selector_all("a.rrow")]
        bad_rows = [r for r in rows if not (re.search(r"For \S", r) and re.search(r"unpaid test|\$\d", r))]
        line(bool(rows) and not bad_rows, "P6 part", "every receipt on the person's page says who is responsible and the pay (or unpaid test)", f"{len(bad_rows)} of {len(rows)} rows lack it")
        got = []
        for label in ("Save all your receipts", "or as a data file, for checking by a program"):
            try:
                with pg.expect_download(timeout=15000) as dl:
                    pg.click(f"text={label}")
                f = dl.value.path(); body = open(f, encoding="utf-8").read() if f else ""
                got.append((dl.value.suggested_filename, len(body), body.count("rc_") >= len(rows) > 0))
            except Exception as e:
                got.append((label, 0, False))
        line(len(got) == 2 and all(g[2] for g in got), "P10 part", "the person can save every receipt from their page, as a readable page and as data", repr(got)[:120])
        on = pg.inner_text("[aria-labelledby=on-h]") if pg.query_selector("[aria-labelledby=on-h]") else ""
        line(bool(re.search(r"Off\.|On until|On, with no end|quiet hours", on, re.I)), "P9 part", "the person's page says whether they can be rung, and quiet hours", on[:80])
        # P12: where the asker said what the answers changed, the person sees it on their page and on that receipt
        changed_rows = [r for r in pg.query_selector_all("a.rrow") if "What the answers changed" in (r.inner_text() or "")]
        if changed_rows:
            href = changed_rows[0].get_attribute("href")
            line(True, "P12", "the asker's line about what the answers changed shows on the person's page", "")
            pg.goto(base + href, wait_until="networkidle"); pg.wait_for_selector(".sentence", timeout=20000)
            t = pg.inner_text("main")
            line(("WHAT THE ANSWERS CHANGED" in t.upper() or "WHAT YOUR ANSWER CHANGED" in t.upper()) and "has not said yet" not in t, "P12", "and at the top of that receipt", t[:100])
            # P6: the receipt lists what the asker paid and each fee
            if pg.query_selector("details.money"): pg.click("details.money summary"); time.sleep(0.3)   # an unpaid test folds the lines
            paid = pg.inner_text(".lines") if pg.query_selector(".lines") else ""
            line("The asker paid" in paid and ("fee" in paid.lower()), "P6", "the receipt lists what the asker paid and each fee (or that there was none)", paid[:100])
            # P7: the receipt is the person's to keep and anyone can check it: the signature holds, a changed copy fails
            ok_sig = bad_sig = ""
            try:
                pg.click("text=Check it yourself (technical)")
                pg.click("text=Check the signature"); pg.wait_for_selector(".verdict.good, .verdict.bad", timeout=15000)
                ok_sig = pg.inner_text(".verdict.good") if pg.query_selector(".verdict.good") else "not good"
                pg.click("text=See a changed copy fail"); time.sleep(2.5)
                bad_sig = " | ".join(v.inner_text() for v in pg.query_selector_all(".verdict.bad"))
            except Exception as e:
                ok_sig = "error: " + str(e)[:80]
            line(ok_sig.startswith("Valid") and "Not valid" in bad_sig, "P7 part", "the receipt's signature checks out on its page, and a copy with the pay changed fails", (ok_sig + " / " + bad_sig)[:120])
        else:
            line(False, "P12", "the asker's line about what the answers changed shows on the person's page", "no receipt with a line on this member's page")
        ctx.close()
    # P10: leave and delete, on a disposable team-test member only (router's MEMBER_DISPOSABLE), never on a working bot
    disp = None
    try:
        envd = dict(l.strip().split("=", 1) for l in open(os.path.expanduser("~/.config/humancall/team_test.env")) if "=" in l)
        disp = envd.get("MEMBER_DISPOSABLE")
    except Exception:
        pass
    if disp and "--leave" in args:
        ctx, pg = page()
        pg.goto(f"{base}/m/{disp}", wait_until="networkidle"); time.sleep(2)
        pg.click("text=Leave and delete everything"); pg.wait_for_selector("text=Save your receipts first?")
        pg.click("dialog .choice.upset, .leave .choice.upset"); pg.wait_for_selector(".big", timeout=15000)
        gone = pg.inner_text("main")
        req = pg.request.get(f"{base}/o/{disp}")
        line("Gone." in gone and req.status in (404, 401), "P10 part", "one tap, after an offer to save receipts, deletes the member; the link then finds nothing", f"screen={gone[:40]!r} lookup={req.status}")
        ctx.close()

    # (--receipt is kept for old callers: a receipt opens only from the person's own page since 14 Nov 2:43 AM CT, so the
    # receipt lines above, reached by a tap on the person's page, are the check.)
    b.close()
sys.exit(0 if all(results) else 1)
