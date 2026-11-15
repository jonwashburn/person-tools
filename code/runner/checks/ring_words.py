"""The ring's words (P2, RING_RULES rule 7): the notification says only 'An unpaid test call: N minutes' or 'A call for you:
N minutes, $X' (or 'What the answers changed' / 'You are switched Off' / 'A call came and went'), never the asker's words or
an outcome's words. Runs the real public/sw.js in Node (ring_words_harness.js) on stand-in replies; no network, no person.
usage: tools/venv/bin/python -I ring_words.py      (Node from $NODE or PATH; exit 1 on any FAIL)
"""
import json, os, shutil, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__)); SW = os.environ.get("RING_SW") or os.path.join(HERE, "..", "public", "sw.js")   # RING_SW: test a changed copy
node = os.environ.get("NODE") or shutil.which("node")
results = []
def line(ok, name, why=""):
    results.append(ok); print(("PASS " if ok else "FAIL ") + name + ("" if ok else ": " + why))
if not node:
    line(False, "the ring's words: Node is available to run the service worker", "set NODE"); sys.exit(1)
ASK = "Tell me about your private medical history and your address"
LINE = "We changed the chorus because of what you said"
def run(case):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f: json.dump(case, f); p = f.name
    try: out = subprocess.run([node, os.path.join(HERE, "ring_words_harness.js"), SW, p], capture_output=True, text=True, timeout=20).stdout.strip()
    finally: os.unlink(p)
    try: return json.loads(out.splitlines()[-1])
    except Exception: return {"error": out[:200]}
def clean(n): return n and ASK.split()[2] not in (n.get("title", "") + n.get("body", "")) and "medical" not in (n.get("title", "") + n.get("body", "")) and LINE not in (n.get("title", "") + n.get("body", ""))
offer = {"seat_token": "st_x", "ask": ASK, "kind": "listen", "minutes": 2, "state": "offered"}
n = run({"member": "mt_x", "offers": {"offers": [dict(offer, pay={"per_person_usd": "0.00", "unpaid_test": True})]}})
line(bool(n) and n.get("title") == "An unpaid test call: 2 minutes" and clean(n) and n.get("url") == "/c/st_x", "the ring for an unpaid call says only 'An unpaid test call: 2 minutes', opens the call, and carries none of the ask", json.dumps(n)[:160])
n = run({"member": "mt_x", "offers": {"offers": [dict(offer, minutes=3, pay={"per_person_usd": "1.50"})]}})
line(bool(n) and n.get("title") == "A call for you: 3 minutes, $1.50" and clean(n), "the ring for a paid call says only the minutes and the pay, and none of the ask", json.dumps(n)[:160])
n = run({"member": "mt_x", "offers": {"offers": [], "on": "on"}, "receipts": {"receipts": [{"receipt": {"receipt_id": "rc_1"}, "what_changed": LINE}]}})
line(bool(n) and n.get("title") == "What the answers changed" and clean(n) and n.get("url") == "/m/mt_x", "an outcome ring says 'What the answers changed' without the line's words and opens the person's page", json.dumps(n)[:160])
n = run({"member": "mt_x", "offers": {"offers": [], "on": "off", "missed_rings": 2}})
line(bool(n) and n.get("title") == "You are switched Off" and clean(n), "after two unanswered calls the ring says 'You are switched Off', with no asker's words", json.dumps(n)[:160])
n = run({"member": None, "offers": None})
line(bool(n) and n.get("title") == "A call for you" and clean(n), "with no member known to this phone the ring says only 'A call for you'", json.dumps(n)[:160])
sys.exit(0 if all(results) else 1)
