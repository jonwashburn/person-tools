"""axe-core (WCAG 2.2 A/AA rules) on the person's screens at phone size: ring card, listening, answer, end; member home;
receipt; join. Prints each violation with its impact and the elements it names. Exit 1 on any serious or critical one.

usage: tools/venv/bin/python -I axe_pages.py [--base https://<runner host>] [--member MEMBER_n] [--receipt rc_...]
axe-core comes from the file named by AXE_JS (npm axe-core 4.14.0, MPL-2.0, package/axe.min.js); it is
injected only in this check's browser (CSP bypassed for the check), never served.
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


HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
names = json.load(open(os.path.join(WORK, "canon", "names.json")))
args = sys.argv[1:]
base = (args[args.index("--base") + 1] if "--base" in args else "https://" + names["fallback_hosts"]["run"]).rstrip("/")
member = args[args.index("--member") + 1] if "--member" in args else None
if not os.environ.get("AXE_JS"): sys.exit("set AXE_JS to the path of axe.min.js (npm axe-core 4.14.0)")
AXE = open(os.path.expanduser(os.environ["AXE_JS"])).read()
bad = 0


def run_axe(pg, label):
    global bad
    pg.add_script_tag(content=AXE)
    res = pg.evaluate("""async () => { const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice'] } });
        return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 4).map(n => n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\\n').slice(1, 2).join('')) })); }""")
    print(f"== {label}: {len(res)} violation(s)")
    for v in res:
        print(f"  [{v['impact']}] {v['id']}: {v['help']}")
        for n in v["nodes"]:
            print("      ", n[:200])
        if v["impact"] in ("serious", "critical"):
            bad += 1


with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    for scheme in ("light", "dark"):
        ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, bypass_csp=True, color_scheme=scheme, timezone_id="America/Chicago")
        pg = ctx.new_page()
        pg.goto(f"{base}/c/standin-axe{int(time.time())}", wait_until="networkidle"); pg.wait_for_selector(".dock .go")
        run_axe(pg, f"ring card ({scheme})")
        pg.tap(".dock .go"); pg.wait_for_selector(".pp:not([disabled])")
        if not _wait_playing(pg): pg.tap(".pp")
        time.sleep(2)
        run_axe(pg, f"listening ({scheme})")
        pg.tap("button.go.you"); pg.wait_for_selector("textarea"); pg.fill("textarea", "Calm.")
        run_axe(pg, f"answer ({scheme})")
        pg.tap("button.go.you"); pg.wait_for_selector(".big")
        run_axe(pg, f"arrived ({scheme})")
        if member and scheme == "light":
            env = dict(l.strip().split("=", 1) for l in open(os.path.expanduser("~/.config/humancall/team_test.env")) if "=" in l)
            pg.goto(f"{base}/m/{env[member]}", wait_until="networkidle"); time.sleep(2.5)
            run_axe(pg, "member home")
            if pg.query_selector("a.rrow"):
                pg.click("a.rrow"); pg.wait_for_selector(".sentence"); time.sleep(1)
                run_axe(pg, "receipt")
            pg.goto(f"{base}/j/jc_axecheck0000", wait_until="networkidle"); time.sleep(1.5)
            run_axe(pg, "join (invalid code)")
        # the join road the operator meets (stand-in code: nothing is kept), in both schemes: the notice, then "You're in"
        pg.goto(f"{base}/j/jc_standinjoin1", wait_until="networkidle"); time.sleep(1.5)
        run_axe(pg, f"join notice ({scheme})")
        pg.click(".join-actions button >> nth=0"); pg.wait_for_selector("text=You're in", timeout=20000); time.sleep(1)
        run_axe(pg, f"joined ({scheme})")
        ctx.close()
    b.close()
sys.exit(1 if bad else 0)
