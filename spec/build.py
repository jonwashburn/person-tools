#!/usr/bin/env python3
"""Build the standard's site from spec/src/*.md, spec/schemas, spec/examples and spec/openapi.yaml.

Run: python3 spec/build.py   (needs the markdown package; PYTHON_EXTRA_PATH may name a folder holding it)
Writes spec/site/ (deployed to askpeople-spec). Every name comes from canon/names.json; nothing is typed by hand.
"""
import html, json, os, re, shutil, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
if os.environ.get("PYTHON_EXTRA_PATH"):
    sys.path.insert(0, os.environ["PYTHON_EXTRA_PATH"])
import markdown  # noqa: E402

CANON = Path(os.environ.get("HC_CANON", str(ROOT / "canon")))
names = json.loads((CANON / "names.json").read_text())
TOKENS = {
    "{{standard}}": names["standard"],
    "{{wire_prefix}}": names["wire_prefix"],
    "{{tool}}": names["tool"],
    "{{network}}": names["network"],
}
STD_TITLE = names["standard"].removeprefix("the ").strip()  # "Ahoy Protocol"
PUBLIC = (HERE / "PUBLIC").exists()  # the chief creates spec/PUBLIC only when chief/PUBLIC_READY.md is all yes


def sub(text: str) -> str:
    for k, v in TOKENS.items():
        text = text.replace(k, v)
    # "{{standard}}" at the start of a sentence reads "The Ahoy Protocol"; inside one, "the Ahoy Protocol".
    return text


def sub_sentence_case(text: str) -> str:
    std = names["standard"]
    cap = std[0].upper() + std[1:]
    text = re.sub(r"(^# |^|[.!?](?:\*\*)?\s+|\| )\{\{standard\}\}", lambda m: m.group(1) + cap, text, flags=re.M)
    text = text.replace("{{standard}}", std)
    for k, v in TOKENS.items():
        if k != "{{standard}}":
            text = text.replace(k, v)
    return text


src_files = sorted((HERE / "src").glob("*.md"))
md_text = "\n\n".join(sub_sentence_case(p.read_text()) for p in src_files)

# Requirement ids: **[CALL-1]** -> anchor
REQ = re.compile(r"\*\*\[([A-Z]+-\d+)\]\*\*")
reqs = []
section = ""
for line in md_text.splitlines():
    h = re.match(r"^(#{2,3}) (.+)$", line)
    if h:
        section = h.group(2)
    for m in REQ.finditer(line):
        reqs.append({"id": m.group(1), "section": section, "line": re.sub(r"\s+", " ", line.strip())[:300]})
ids = [r["id"] for r in reqs]
dups = sorted({i for i in ids if ids.count(i) > 1})
if dups:
    sys.exit(f"duplicate requirement ids: {dups}")

body = markdown.markdown(md_text, extensions=["tables", "fenced_code", "toc", "sane_lists"],
                         extension_configs={"toc": {"permalink": False, "toc_depth": "2-3"}})
# Beside each requirement: how the reference server did on the last conformance run (spec/reference_run.json, a copy of
# `code/conformance/run --json` against the live API). Absent file: no badges.
RUN = {}
run_path = HERE / "reference_run.json"
if run_path.exists():
    RUN = json.loads(run_path.read_text())
by_req = {}
for r in RUN.get("results", []):
    for q in re.findall(r"[A-Z]+-\d+", " ".join(r.get("reqs", []) if isinstance(r.get("reqs"), list) else [str(r.get("reqs", ""))])):
        by_req.setdefault(q, []).append(r)


def badge(rid):
    rs = by_req.get(rid)
    if not RUN:
        return ""
    if not rs:
        return '<span class="rs rs-none" title="no check in the suite for this requirement">not checked</span>'
    rs = [r for r in rs if not r["line"].startswith("check raised")] or rs  # a crash in the suite is not the server's fault
    if any(r["status"] == "FAIL" and not r["line"].startswith("check raised") for r in rs):
        why = html.escape("; ".join(r["check"] + ": " + r["line"][:140] for r in rs if r["status"] == "FAIL")[:400])
        return f'<span class="rs rs-fail" title="{why}">reference server: fails</span>'
    if all(r["status"] == "SKIP" for r in rs):
        return '<span class="rs rs-none" title="skipped on the last run">skipped</span>'
    return '<span class="rs rs-pass">reference server: passes</span>'


body = re.sub(r"<strong>\[([A-Z]+-\d+)\]</strong>",
              lambda m: f'<a class="req" id="{m.group(1)}" href="#{m.group(1)}">{m.group(1)}</a>{badge(m.group(1))}', body)
if RUN:
    c = RUN.get("counts", {})
    npass = sum(1 for q, rs in by_req.items() if rs and not any(r["status"] == "FAIL" for r in rs) and not all(r["status"] == "SKIP" for r in rs))
    nfail = sum(1 for q, rs in by_req.items() if any(r["status"] == "FAIL" and not r["line"].startswith("check raised") for r in rs))
    REFLINE = (f'<p class="refline label">Beside each requirement: how the reference server did on the conformance suite, '
               f'{html.escape(RUN.get("when", ""))}: {npass} requirements pass, {nfail} fail '
               f'({c.get("PASS", 0)} checks passed, {c.get("FAIL", 0)} failed, {c.get("SKIP", 0)} skipped). '
               f'The text is the standard; where the server fails, the server is being changed.</p>')
    body = re.sub(r'(<h2 id="1-status-and-scope">.*?</h2>)', lambda m: REFLINE + m.group(1), body, count=1, flags=re.S)

# The first page runs its own example (spec/run.js): a block after the section's first paragraph.
LIVE = ('<div id="live-run" class="live"><p class="label">Run it</p><p>The four steps below, made now by this page '
        'against the reference server\'s simulated pool. No account, no money, and nobody real is asked (if the server wants a key, the page makes a free test key first). What comes back is that server as it runs today: where it differs from this text, the text is the standard and the server is being changed to match it.</p>'
        '<button type="button">Run this call</button> <span class="live-status" role="status"></span>'
        '<div class="live-out"></div></div>')
body = re.sub(r'(<h2 id="one-call-from-end-to-end">.*?</h2>\s*<p>.*?</p>)', lambda m: m.group(1) + LIVE, body, count=1, flags=re.S)

# Table of contents from h2s
toc = []
for m in re.finditer(r'<h2 id="([^"]+)">(.+?)</h2>', body):
    toc.append((m.group(1), re.sub(r"<[^>]+>", "", m.group(2))))
toc_html = "\n".join(f'<li><a href="#{i}">{html.escape(html.unescape(t))}</a></li>' for i, t in toc)

robots = "" if PUBLIC else '<meta name="robots" content="noindex, nofollow">'
draft_bar = ("DRAFT 0.1 · working names · wire prefix " + names["wire_prefix"] +
             " is a placeholder and changes once, when 0.1 is final")

page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
{robots}
<title>{html.escape(STD_TITLE)} 0.1 (draft)</title>
<meta name="description" content="{html.escape(names['standard'][0].upper() + names['standard'][1:])}: an open interface through which a software agent asks people to do a short thing and gets back each answer with a record of what the person did. Draft 0.1.">
<link rel="alternate" type="text/markdown" href="0.1.md">
<link rel="stylesheet" href="spec.css">
</head>
<body>
<div class="draftbar label">{html.escape(draft_bar)}</div>
<div class="wrap">
<nav class="toc" aria-label="Sections">
<details id="tocd"><summary class="label">Contents</summary>
<ol>{toc_html}</ol>
</details>
<p class="label files">Files</p>
<ul class="files">
<li><a href="0.1.md">The text as Markdown</a></li>
<li><a href="openapi.yaml">openapi.yaml</a></li>
<li><a href="schemas/">JSON Schemas</a></li>
<li><a href="examples/">Examples, valid and invalid</a></li>
<li><a href="requirements.json">Every requirement, as data</a></li>
<li><a href="screening_fixtures.json">Screening fixtures</a></li>
</ul>
</nav>
<script src="page.js"></script>
<script src="run.js" defer></script>
<main>
{body}
</main>
</div>
</body>
</html>
"""

SITE = HERE / "site"
if SITE.exists():
    shutil.rmtree(SITE)
SITE.mkdir()
(SITE / "index.html").write_text(page)
(SITE / "0.1.md").write_text(md_text)
(SITE / "requirements.json").write_text(json.dumps({"version": "0.1", "status": "draft", "count": len(reqs), "requirements": reqs}, indent=1))
shutil.copy(HERE / "spec.css", SITE / "spec.css")
shutil.copy(HERE / "run.js", SITE / "run.js")
shutil.copy(HERE / "page.js", SITE / "page.js")
shutil.copytree(HERE / "fonts", SITE / "fonts")
if run_path.exists():
    shutil.copy(run_path, SITE / "reference_run.json")
# The conformance suite is published with the text only when the code goes public (spec/PUBLIC, chief/PUBLIC_READY.md).
SUITE = Path(os.environ.get("HC_WORK", str(ROOT))) / "code" / "conformance"
if PUBLIC and SUITE.exists():
    (SITE / "conformance").mkdir(exist_ok=True)
    for name in ("run", "suite.py", "README.md", "traceability.md"):
        if (SUITE / name).exists():
            shutil.copy(SUITE / name, SITE / "conformance" / name)


def copy_tree_sub(src: Path, dst: Path):
    if not src.exists():
        return 0
    n = 0
    for p in sorted(src.rglob("*")):
        if p.is_file():
            q = dst / p.relative_to(src)
            q.parent.mkdir(parents=True, exist_ok=True)
            q.write_text(sub(p.read_text()))
            n += 1
    return n


n_schemas = copy_tree_sub(HERE / "schemas", SITE / "schemas")
n_examples = copy_tree_sub(HERE / "examples", SITE / "examples")
if (HERE / "screening_fixtures.json").exists():
    (SITE / "screening_fixtures.json").write_text(sub_sentence_case((HERE / "screening_fixtures.json").read_text()))
if (HERE / "openapi.yaml").exists():
    (SITE / "openapi.yaml").write_text(sub((HERE / "openapi.yaml").read_text()))


def index_page(d: Path, title: str):
    items = sorted(p for p in d.rglob("*") if p.is_file() and p.name != "index.html")
    lis = "\n".join(f'<li><a href="{html.escape(str(p.relative_to(d)))}">{html.escape(str(p.relative_to(d)))}</a></li>' for p in items)
    (d / "index.html").write_text(f'<!doctype html><meta charset="utf-8">{robots}<meta name="viewport" content="width=device-width, initial-scale=1">'
                                  f'<link rel="stylesheet" href="../spec.css"><title>{title}</title><main class="list"><p class="label">{html.escape(draft_bar)}</p>'
                                  f'<h1>{title}</h1><p><a href="../">Back to the text</a></p><ul>{lis}</ul></main>')


for d, t in ((SITE / "schemas", "JSON Schemas"), (SITE / "examples", "Examples")):
    if d.exists():
        index_page(d, t)

# The page loads nothing from anyone else: fonts and scripts are its own; fetches may go to any https server (the "Run it"
# button can be pointed at another call server with ?api=). This also stops a script a host or zone might inject.
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; "
       "connect-src 'self' https:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
headers = ["/*", "  X-Content-Type-Options: nosniff", "  Referrer-Policy: no-referrer", "  Content-Security-Policy: " + CSP]
if not PUBLIC:
    headers.append("  X-Robots-Tag: noindex, nofollow")
headers += ["/*.md", "  Content-Type: text/markdown; charset=utf-8", "/*.yaml", "  Content-Type: application/yaml; charset=utf-8",
            "/*.json", "  Content-Type: application/json; charset=utf-8", "  Access-Control-Allow-Origin: *"]
(SITE / "_headers").write_text("\n".join(headers) + "\n")
# Public (owner, 15 Nov 2026, 3:25 AM CT): robots point to a sitemap of the standard's pages (the CEO's web-index order)
SPEC_HOST = "spec.person.tools"
try:
    _n = json.loads((Path(os.environ.get("HC_CANON", str(ROOT / "canon"))) / "names.json").read_text())
    SPEC_HOST = _n["hosts"]["spec"] if _n.get("zone_active") else _n["fallback_hosts"]["spec"]
except Exception:
    pass
if PUBLIC:
    try:
        if _n.get('indexnow_key'): (SITE / ('%s.txt' % _n['indexnow_key'])).write_text(_n['indexnow_key'])   # IndexNow ownership file
    except NameError:
        pass
    _urls = ["/", "/0.1.md"] + (["/conformance/README.md"] if (SITE / "conformance" / "README.md").exists() else [])
    (SITE / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "".join("  <url><loc>https://%s%s</loc></url>\n" % (SPEC_HOST, u) for u in _urls) + "</urlset>\n")
(SITE / "robots.txt").write_text(("User-agent: *\nAllow: /\nSitemap: https://%s/sitemap.xml\n" % SPEC_HOST) if PUBLIC else "User-agent: *\nDisallow: /\n")

leftover = [str(p) for p in SITE.rglob("*") if p.is_file() and p.suffix in (".html", ".md", ".json", ".yaml") and "{{" in p.read_text()]
if leftover:
    sys.exit(f"unsubstituted tokens in: {leftover[:5]}")
print(f"built spec/site: {len(src_files)} sections, {len(reqs)} requirements, {n_schemas} schema files, {n_examples} example files, public={PUBLIC}")
