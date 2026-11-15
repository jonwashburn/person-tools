"""A team-test member, played by a headless phone: opens the member's page, takes the first offer, listens, answers, sends.

usage: bin/member_bot <member_token | MEMBER_n | MEMBER_ANY> [--answer "..."] [--play-seconds N] [--hide-at N] [--stop | --upset]
                      [--base https://<runner host>] [--out DIR] [--wait-offer S] [--laptop] [--call call_id]

- MEMBER_n reads that name from ~/.config/humancall/team_test.env (the token is never printed).
- --play-seconds N: listen N seconds, then answer (default: the whole piece and a second more).
- --hide-at N: N seconds into listening, the page is hidden (visibilityState "hidden" and its event) for the rest of the
  listening, as when a person switches app. The router should then judge the response "said", not "attended".
- --stop / --upset: press Stop (or "Stop: this upset me") instead of sending.
- --wait-offer S: look for an offer for up to S seconds (default 60).
Prints one JSON line: what happened, the seat's status afterwards, and any evidence the seat reports. Exit 0 if the call
ended as asked, 1 otherwise. Never prints a token.
"""
import json, os, re, sys, time

def _wait_playing(root, tries=30):
    """Take starts a listening call's sound by itself (the tap is the gesture): tap Play only if it is not playing."""
    for _ in range(tries):
        try:
            if root.locator(".pp").first.get_attribute("aria-label") == "Pause": return True
        except Exception: pass
        time.sleep(0.1)
    return False

from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.abspath(os.path.join(HERE, "..", "..", ".."))


def arg(name, default=None, cast=str):
    if name in sys.argv:
        return cast(sys.argv[sys.argv.index(name) + 1])
    return default


def main():
    if len(sys.argv) < 2 or sys.argv[1].startswith("--"):
        print(__doc__); sys.exit(2)
    who = sys.argv[1]
    token = who
    names = json.load(open(os.path.join(WORK, "canon", "names.json")))
    base = (arg("--base") or "https://" + names["fallback_hosts"]["run"]).rstrip("/")
    if who == "MEMBER_ANY":  # whichever team-test member holds an open offer now (the router chooses who is offered)
        import urllib.request
        env = os.path.expanduser("~/.config/humancall/team_test.env")
        vals = dict(l.strip().split("=", 1) for l in open(env) if "=" in l and not l.startswith("#"))
        deadline = time.time() + arg("--wait-offer", 60, float)
        while who == "MEMBER_ANY" and time.time() < deadline:
            for k in sorted(v for v in vals if re.fullmatch(r"MEMBER_\d+", v)):
                try:
                    req = urllib.request.Request(f"{base}/o/{vals[k].strip()}", headers={"User-Agent": "member-bot/1 (team-test)", "Accept": "application/json"})
                    d = json.load(urllib.request.urlopen(req, timeout=15))
                    wc = arg("--call")
                    if any(o.get("state", "offered") == "offered" and (not wc or o.get("call_id") == wc) for o in d.get("offers", [])):
                        who = k; break
                except Exception:
                    pass
            if who == "MEMBER_ANY":
                time.sleep(3)
        if who == "MEMBER_ANY":
            print(json.dumps({"ok": False, "error": "no team-test member holds an offer"})); sys.exit(1)
    if re.fullmatch(r"MEMBER_\d+", who):
        env = os.path.expanduser("~/.config/humancall/team_test.env")
        vals = {}
        if os.path.exists(env):
            for line in open(env):
                if "=" in line and not line.lstrip().startswith("#"):
                    k, v = line.strip().split("=", 1); vals[k.strip()] = v.strip().strip('"').strip("'")
        token = vals.get(who)
        if not token:
            print(json.dumps({"ok": False, "error": f"{who} not found in ~/.config/humancall/team_test.env"})); sys.exit(1)
    answer = arg("--answer", "It felt calm and a little unfinished, like a question left open. I would listen again.")
    play_s = arg("--play-seconds", None, float)
    hide_at = arg("--hide-at", None, float)
    mode = "upset" if "--upset" in sys.argv else "stop" if "--stop" in sys.argv else "send"
    wait_offer = arg("--wait-offer", 60, float)
    out = arg("--out", None)
    laptop = "--laptop" in sys.argv
    if out:
        os.makedirs(out, exist_ok=True)

    from playwright.sync_api import sync_playwright
    res = {"ok": False, "who": who if who.startswith("MEMBER_") else "token", "base": base, "mode": mode,
           "console_errors": [], "outside_requests": []}
    own = urlparse(base).netloc
    t_start = time.time()
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        ctx = b.new_context(viewport={"width": 1440, "height": 900} if laptop else {"width": 390, "height": 844},
                            device_scale_factor=1 if laptop else 2, is_mobile=not laptop, has_touch=not laptop)
        pg = ctx.new_page()
        pg.on("console", lambda m: res["console_errors"].append(m.text[:300]) if m.type == "error" else None)
        pg.on("pageerror", lambda e: res["console_errors"].append("pageerror: " + str(e)[:300]))
        pg.on("request", lambda r: res["outside_requests"].append(r.url) if urlparse(r.url).netloc not in (own, "") and r.url.startswith("http") else None)
        tap = (lambda sel: pg.click(sel)) if laptop else (lambda sel: pg.tap(sel))

        def shot(n):
            if out:
                pg.screenshot(path=os.path.join(out, n + ".png"), full_page=True)

        # 1. the member's page, until an offer shows
        pg.goto(f"{base}/m/{token}", wait_until="networkidle")
        deadline = time.time() + wait_offer
        while time.time() < deadline:
            if pg.query_selector("a.offer-link"):
                break
            if pg.query_selector(".big"):
                res["error"] = pg.inner_text("main")[:200]; break
            time.sleep(2)
            if int(time.time() - t_start) % 20 < 2:
                pg.reload(wait_until="networkidle")
        if not pg.query_selector("a.offer-link"):
            res.setdefault("error", "no offer appeared on the member page")
            shot("0_member"); print(json.dumps(res)); b.close(); sys.exit(1)
        shot("0_member")
        want_call = arg("--call")
        href = pg.get_attribute("a.offer-link", "href") or ""
        if want_call:   # play exactly this call: find its offer through the member's own page data
            import urllib.request
            req = urllib.request.Request(f"{base}/o/{token}", headers={"User-Agent": "member-bot/1 (team-test)"})
            offs = json.load(urllib.request.urlopen(req, timeout=15)).get("offers", [])
            hit = [o for o in offs if o.get("call_id") == want_call]
            if not hit:
                res["error"] = f"no offer for call {want_call} on this member's page"; print(json.dumps(res)); b.close(); sys.exit(1)
            st = hit[0].get("seat_token") or str(hit[0].get("seat_url", "")).split("/c/")[-1]
            href = "/c/" + st
            pg.goto(base + href, wait_until="networkidle")
        else:
            pg.click("a.offer-link")
        seat_token = href.split("/c/")[-1]
        res["seat"] = "seen"
        # 2. the ring card, then take
        pg.wait_for_selector(".ask, .big", timeout=20000)
        shot("1_ring_card")
        if pg.query_selector(".big"):
            res["error"] = "ring card did not open: " + pg.inner_text(".big"); print(json.dumps(res)); b.close(); sys.exit(1)
        card = pg.inner_text("main")
        res["card_shows"] = {k: (k_re.search(card) is not None) for k, k_re in {
            "ai_is_asking": re.compile(r"An AI is asking"), "minutes": re.compile(r"\d+\s*min"),
            "pay_or_unpaid": re.compile(r"UNPAID TEST|PAID TO YOU"), "recorded": re.compile(r"WHAT IS RECORDED", re.I),
            "who_answers": re.compile(r"who is responsible for this call|who answers for this call")}.items()}
        tap(".dock button.go")
        pg.wait_for_selector(".pp:not([disabled]), .big, textarea", timeout=30000)
        if pg.query_selector(".big"):
            res["error"] = "take refused: " + pg.inner_text(".big"); shot("2_refused"); print(json.dumps(res)); b.close(); sys.exit(1)
        # 3. listen
        if pg.query_selector(".pp"):
            media = pg.evaluate("() => { const t = document.querySelector('.clock span:last-child'); return t ? t.textContent : '0:30'; }")
            mm, ss = (media.split(":") + ["0"])[:2]
            media_s = int(mm) * 60 + int(ss)
            listen_for = play_s if play_s is not None else media_s + 1.2
            if not _wait_playing(pg): tap(".pp")
            t0 = time.time()
            hidden = False
            while time.time() - t0 < listen_for:
                if hide_at is not None and not hidden and time.time() - t0 >= hide_at:
                    pg.evaluate("""() => { Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'hidden'});
                                           Object.defineProperty(document, 'hidden', {configurable: true, get: () => true});
                                           document.dispatchEvent(new Event('visibilitychange')); }""")
                    hidden = True
                time.sleep(0.25)
            if hidden:
                pg.evaluate("""() => { Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'visible'});
                                       Object.defineProperty(document, 'hidden', {configurable: true, get: () => false});
                                       document.dispatchEvent(new Event('visibilitychange')); }""")
            res["listened_s"] = round(time.time() - t0, 1)
            res["heard_on_page"] = pg.inner_text(".record") if pg.query_selector(".record") else None
            shot("3_listened")
        # 4. stop, or answer and send
        if mode in ("stop", "upset"):
            tap("#stop-btn"); pg.wait_for_selector("dialog .choice")
            tap("dialog .choice.upset" if mode == "upset" else "dialog .choice:not(.upset)")
            if pg.query_selector("dialog .choice") and "Send what you wrote" in pg.inner_text("dialog"):
                tap("dialog .choice:last-of-type")
            pg.wait_for_selector(".big", timeout=20000)
            res["end_screen"] = pg.inner_text(".big")
            res["ok"] = res["end_screen"].startswith("Stopped")
        else:
            if pg.query_selector("button.go.you") and not pg.query_selector("textarea"):
                tap("button.go.you")
            pg.wait_for_selector("textarea, .yn", timeout=15000)
            if pg.query_selector("textarea"):
                pg.fill("textarea", answer)
            for grp in pg.query_selector_all(".yn"):
                btn = grp.query_selector("button")
                if btn:
                    btn.click()
            shot("4_answer")
            tap("button.go.you")
            pg.wait_for_selector(".big", timeout=20000)
            res["end_screen"] = pg.inner_text(".big")
            rec = " ".join((e.text_content() or "") for e in pg.query_selector_all(".receipt"))
            m = re.search(r"(rc_[a-z0-9]+)", rec)
            res["receipt_id"] = m.group(1) if m else None
            res["ok"] = res["end_screen"].startswith("Arrived")
        shot("5_end")
        time.sleep(1.0)  # let the last beacon leave
        # 5. what the seat says now (through the runner's own address)
        try:
            r = pg.request.get(f"{base}/s/{seat_token}")
            d = r.json()
            res["seat_after"] = {k: d.get(k) for k in ("call_id", "status", "evidence", "receipt_id", "paid_usd") if k in d}
            if isinstance(d.get("response"), dict):
                res["seat_after"]["evidence"] = d["response"].get("evidence")
        except Exception as e:
            res["seat_after"] = {"error": str(e)[:120]}
        b.close()
    res["seconds"] = round(time.time() - t_start, 1)
    if res["console_errors"] or res["outside_requests"]:
        res["ok"] = False
    print(json.dumps(res))
    sys.exit(0 if res["ok"] else 1)


if __name__ == "__main__":
    main()
