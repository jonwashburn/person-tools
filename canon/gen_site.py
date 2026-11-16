#!/usr/bin/env python3
"""Write everything a machine reads on the site from the canon.

Usage: python3 canon/gen_site.py --out DIR
Writes into DIR: llms.txt, price.json, canon.json (public), promise.json, promise.txt, tools.json, questions.md,
questions.html, start.md, start.html, robots.txt, sitemap.xml, _headers, m.css.
Hosts are never typed: %%API%%, %%SITE%%, %%SPEC%%, %%RUN%% are filled per request by code/site/functions/_middleware.js.
"""
import json, os, sys, re, html, argparse, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def money_short(s):
    return s[:-3] if s.endswith('.00') else s

def values():
    names, canon, promise, tools = gen.load(ROOT)
    v = gen.values(names, canon, tools)
    t = canon['offer']['terms']; ev = canon['evidence_levels']
    v.update({
        'one_sentence': gen.fill(canon['identity']['one_sentence'], v),
        'status_plain': canon['status']['plain'],
        'no_rejection': t['no_rejection'],
        'what_you_pay': t['what_you_pay'], 'short': t['short'], 'cancel': t['cancel'], 'overrun': t['overrun'], 'hold': t['hold'], 'stop': t['stop'],
        'lvl_attended': ev['attended'], 'lvl_said': ev['said'], 'lvl_voiced': ev['voiced'], 'lvl_never': ev['never'],
        'people_who': canon['people']['who'][0].upper() + canon['people']['who'][1:],
        'is_not_joined': ' '.join(canon['identity']['is_not']),
        'refused_joined': '; '.join(canon['offer']['refused']['value']),
        'not_allowed_joined': '; '.join(canon['offer']['refused']['not_allowed_in_first_version']),
        'standard_line': (lambda x: x[:1].upper() + x[1:])(gen.fill(canon['identity']['three_things']['standard'], v)),   # first letter only: the name keeps its case
        'standard_status': (lambda x: x[:1].upper() + x[1:])(re.sub(r'^draft;\s*', '', gen.fill(canon['status']['standard_text'], v))) + '.',   # the line before already says Draft
        'server_name': names['network'].replace('.', '-'),
        'keyless_line': 'Simulated calls need no key at all: point a client at the MCP address with no header. ' if canon['offer'].get('keyless_simulated', {}).get('value') else '',
    })
    for l in promise['lines']:
        v['p%d' % l['n']] = '“' + l['text'] + '”'
    # which promise lines the latest api baseline actually checks (canon/promise.json baseline_lines, or [P<n>] tags)
    # the newest api baseline that ran to its end (a passing one or a failed one): that is what 'after every release' means now
    import glob as _glob
    lp = os.path.join(ROOT, 'market', 'local_paths.json')   # the deploy folder's path is private to the operating server
    gd = os.path.expanduser(json.load(open(lp)).get('golive_dir', '')) if os.path.exists(lp) else ''   # every project's deploy runs the same baseline
    cands = [f for f in _glob.glob(os.path.join(gd, 'askpeople-*', 'baseline.txt')) + _glob.glob(os.path.join(gd, 'askpeople-*', 'baseline-failed-*.txt'))
             if os.path.exists(f) and 'after every check' in open(f).read()]
    seen = os.path.join(ROOT, 'market', 'baseline_api_last_complete.txt')
    # a baseline.txt being rewritten by a deploy in progress drops out of cands; the kept copy (its finish time preserved) stands in
    if os.path.exists(seen) and 'after every check' in open(seen).read(): cands.append(seen)
    bl = max(cands, key=os.path.getmtime) if cands else None
    if bl and bl != seen:
        import shutil as _sh; _sh.copy2(bl, seen)
    bl_from = os.path.relpath(bl, gd) if bl and bl.startswith(gd) else (os.path.basename(bl) if bl else None)
    bl_time = datetime.datetime.fromtimestamp(os.path.getmtime(bl), datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ') if bl else None
    passes = set(); tagged = set(); tag_lines = {}
    failed_full = set()
    if bl and os.path.exists(bl):
        for ln in open(bl):
            ln = ln.strip()
            if ln.startswith('PROMISE '): ln = ln[len('PROMISE '):]   # router prints runner's promise lines as 'PROMISE PASS [Pn] ...'
            if ln.startswith('PASS '):
                nm = ln[5:].strip(); passes.add(nm)
                for t in re.findall(r'\[P(\d+)\]', nm): tagged.add('P' + t); tag_lines.setdefault('P' + t, []).append(nm)   # '[Pn]' checks the whole of Pn; '[Pn part]' does not match
            elif ln.startswith('FAIL '):
                for t in re.findall(r'\[P(\d+)(?: part)?\]', ln): failed_full.add('P' + t)   # a failing line on any part of Pn uncounts Pn
    checked = [l['id'] for l in promise['lines'] if l['id'] not in failed_full and
               (l['id'] in tagged or (l.get('baseline_lines') and all(x in passes for x in l['baseline_lines'])))]
    for l in promise['lines']: l['_checked'] = l['id'] in checked
    n = len(checked); tot = len(promise['lines'])
    v['promises_checked_n'] = str(n)
    try:
        os.makedirs(os.path.join(ROOT, 'canon', 'out'), exist_ok=True)
        json.dump({'checked': checked, 'of': tot, 'from': bl_from, 'baseline_finished': bl_time, 'rule': promise.get('baseline_rule'),
                   'sentence': None}, open(os.path.join(ROOT, 'canon', 'out', 'promise_status.json'), 'w'), indent=1)
    except OSError:
        pass
    stamp = bl_time[:10] if bl_time else None   # the date only: a time would go stale (and fail the site check) whenever an API deploy finishes a newer baseline
    try:   # the date in US Central, the team's clock (a baseline finished at 00:35Z on 15 Nov ran at 6:35 PM CT on 14 Nov)
        from zoneinfo import ZoneInfo
        stamp = datetime.datetime.fromisoformat(bl_time.replace('Z', '+00:00')).astimezone(ZoneInfo('America/Chicago')).date().isoformat() if bl_time else None
    except Exception:
        pass
    v['record_checks'] = [{'promise': l['id'], 'text': l['text'], 'checked': stamp, 'how': 'the release checks on the live service, with our own headless test members; no real person was involved', 'lines': tag_lines.get(l['id']) or l['baseline_lines']} for l in promise['lines'] if l['_checked']]
    lst = ('line ' + checked[0][1:]) if n == 1 else ('lines ' + ', '.join(c[1:] for c in checked[:-1]) + ' and ' + checked[-1][1:]) if n else ''
    v['promises_checked_sentence'] = ('All %d are checked after every release, on the live service with our own test members.' % tot) if n == tot else ('%d of the %d %s checked after every release (%s); %s' % (n, tot, 'is' if n == 1 else 'are', lst,
        ('line %s failed %s check in the latest release and counts again when it passes.' % (' and '.join(sorted((x[1:] for x in failed_full), key=int)), 'its' if len(failed_full) == 1 else 'their')) if failed_full and len(failed_full) == tot - n
        else 'checks for the others are being built.')) if n else ('Checks after every release are being built; none of the %d runs yet.' % tot)
    return names, canon, promise, tools, v

FILL = re.compile(r'\{([a-z_0-9]+)\}')
def fill(s, v):
    def r(m):
        k = m.group(1)
        if k not in v: raise SystemExit('gen_site.py: no value for {%s}' % k)
        return v[k]
    return FILL.sub(r, s)

CSS = """@font-face{font-family:"InterVariable";src:url(/h/fonts/inter-var.woff2) format("woff2");font-weight:100 900;font-display:swap}
@font-face{font-family:"JetBrains Mono";src:url(/h/fonts/jbmono-400.woff2) format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:"JetBrains Mono";src:url(/h/fonts/jbmono-700.woff2) format("woff2");font-weight:700;font-display:swap}
:root{--paper:#faf8f3;--ink:#1d1d1b;--body:#2a2926;--soft:#3c3a36;--hair:#8a8a8a;--asker:#00759f;--ok:#0b7a3e;--stop:#c8401f;
--text:"InterVariable","Inter",-apple-system,"Helvetica Neue",Arial,sans-serif;--mono:"JetBrains Mono",ui-monospace,"SF Mono",Menlo,monospace}
@media (prefers-color-scheme:dark){:root{--paper:#141413;--ink:#faf8f3;--body:#e9e6df;--soft:#c9c5bc;--asker:#2bb3f0;--stop:#ff6a3d}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body.m-doc{margin:0;background:var(--paper);color:var(--body);font:420 18px/1.5 var(--text);font-optical-sizing:auto}
.m-doc main{max-width:46rem;margin:0 auto;padding:2.2rem 1.25rem 4rem}
.m-doc a{color:var(--ink);text-underline-offset:.18em}
.m-label{font:700 12.5px/1.3 var(--mono);text-transform:uppercase;letter-spacing:.14em;color:var(--soft)}
.m-doc h1{font-weight:820;font-size:clamp(2.2rem,7vw,3.6rem);line-height:.98;letter-spacing:-.038em;color:var(--ink);margin:.6rem 0 1rem}
.m-doc h2{font-weight:780;font-size:1.45rem;line-height:1.1;letter-spacing:-.02em;color:var(--ink);margin:2.4rem 0 .6rem}
.m-doc h3{font-weight:760;font-size:1.12rem;line-height:1.2;letter-spacing:-.01em;color:var(--ink);margin:1.8rem 0 .35rem}
.m-lede{font-weight:450;font-size:1.2rem;line-height:1.36;color:var(--ink)}
.m-status{border:2px solid var(--ink);padding:.7rem .9rem;margin:1.2rem 0;font-weight:520;color:var(--ink)}
.m-doc pre,.m-doc code{font-family:var(--mono);font-size:.84rem}
.m-doc pre{background:color-mix(in srgb,var(--ink) 6%,transparent);border-left:3px solid var(--asker);padding:.8rem .9rem;overflow-x:auto;line-height:1.45;white-space:pre-wrap;word-break:break-word}
.m-src{font:400 12.5px/1.4 var(--mono);color:var(--soft)}.m-src a{color:var(--soft)}
.m-doc nav{display:flex;gap:1.1rem;flex-wrap:wrap;margin-bottom:1.6rem}.m-doc nav a{font:700 12.5px/1.3 var(--mono);text-transform:uppercase;letter-spacing:.12em;text-decoration:none;color:var(--soft)}
.m-doc nav a[aria-current]{color:var(--ink);border-bottom:2px solid var(--ink)}
.m-doc ol li,.m-doc ul li{margin:.3rem 0}
.m-table{border-collapse:collapse;width:100%;font-size:.92rem;margin:1rem 0;display:block;overflow-x:auto;-webkit-overflow-scrolling:touch}.m-table td,.m-table th{overflow-wrap:anywhere;min-width:7rem}.m-doc code{overflow-wrap:anywhere}.m-table th,.m-table td{border-bottom:1px solid var(--hair);padding:.4rem .5rem;text-align:left;vertical-align:top}
.m-form label{display:block;font:700 12.5px/1.3 var(--mono);text-transform:uppercase;letter-spacing:.12em;color:var(--soft);margin:1rem 0 .3rem}
.m-form textarea,.m-form input{display:block;width:100%;margin-top:.35rem;font:420 1rem/1.4 var(--text);color:var(--ink);background:transparent;border:2px solid var(--ink);padding:.55rem;border-radius:0}
.m-form button{margin-top:1rem;font:780 1rem/1 var(--text);background:var(--ink);color:var(--paper);border:0;padding:.85rem 1.2rem;box-shadow:4px 4px 0 var(--hair);cursor:pointer}
.m-doc footer{margin-top:3rem;padding-top:1rem;border-top:1px solid var(--hair);font:400 13px/1.5 var(--mono);color:var(--soft)}
"""


def md_inline(t):
    t = html.escape(t)
    t = re.sub(r'`([^`]+)`', r'<code>\1</code>', t)
    t = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', t)
    t = re.sub(r'\[([^\]]+)\]\((https?://[^)\s]+|/[^)\s]*)\)', r'<a href="\2">\1</a>', t)
    return t

HEADING_IDS = [(r'^1\. Refused', 'refused'), (r'^2\. Held', 'held'), (r'^3\. Not allowed', 'not-allowed'), (r'^4\. Allowed', 'allowed'),
               (r'^6\. What this version cannot see', 'limits'), (r'^How a refusal reads', 'refusals'), (r'^The one rule', 'rule')]
def heading_id(t):
    for pat, hid in HEADING_IDS:
        if re.match(pat, t): return hid
    return None

def public_policy(md):
    """policy/POLICY.md for the public page: the opening sections, 1 to 4 and 6; no references to internal files."""
    parts = re.split(r'(?m)^(?=## )', md)
    keep = [p for p in parts if p.startswith('## ') and re.match(r'## (The one rule|How a refusal reads|1\.|2\.|3\.|4\.|6\.)', p)]  # the preamble is internal
    md = ''.join(keep)
    md = re.sub(r'\s*\((?:PLAN|TEAM|ROUND0|PROMPT)\.md[^)]*\)', '', md)
    md = re.sub(r'(?<=[.\n])[^.|#\n]*(?:\n(?!\n)[^.|#\n]*)*?(?:PLAN|TEAM|ROUND0|PROMPT)\.md[^.|]*?\.(?=\s)', '', md)  # sentences that cite internal files
    md = re.sub(r'[^.|\n]*(?:PLAN|TEAM|ROUND0|PROMPT)\.md[^.|\n]*(?:\.|(?=\s*\|))', '', md)  # the same inside table cells
    md = re.sub(r'hc-(?:trust|router|runner|market|chief)', 'the operator', md)
    md = re.sub(r'\s*\(?`?(?:ops|policy|trust|chief|owner|market|spec)/[A-Za-z0-9_./-]+`?\)?', '', md)
    md = re.sub(r'the\s+round-0\s+contract', 'the API', md, flags=re.I)
    md = re.sub(r'the\s+voice\s+and\s+data\s+rules\s+\(section\s+6\)', 'the voice and data rules', md, flags=re.I)
    md = re.sub(r'\s*\(`?(?:review|research|policy|ops|trust|chief)/[^)]*\)', '', md)
    out = []; drop = None
    for line in md.splitlines():
        if line.startswith('|'):
            cells = line.strip('|').split('|')
            if drop is None and any(c.strip() == 'Source' for c in cells): drop = [i for i, c in enumerate(cells) if c.strip() == 'Source'][0]
            if drop is not None and len(cells) > drop: cells = cells[:drop] + cells[drop + 1:]
            line = '|' + '|'.join(cells) + '|'
        else:
            drop = None
        out.append(line)
    return '\n'.join(out)

def md2html(md, skip_h1=True):
    """Enough Markdown for our own policy files: headings, paragraphs, - and 1. lists, bold, code, links, tables."""
    out = []; para = []; lst = None; table = []
    def flush():
        nonlocal para, lst, table
        if para: out.append('<p>%s</p>' % md_inline(' '.join(para))); para = []
        if lst: out.append('<%s>%s</%s>' % (lst[0], ''.join('<li>%s</li>' % md_inline(x) for x in lst[1]), lst[0])); lst = None
        if table:
            rows = [r for r in table if not re.match(r'^\|[\s:|-]+\|$', r)]
            cells = [[c.strip() for c in r.strip('|').split('|')] for r in rows]
            if cells:
                h = ''.join('<th>%s</th>' % md_inline(c) for c in cells[0])
                b = ''.join('<tr>%s</tr>' % ''.join('<td>%s</td>' % md_inline(c) for c in r) for r in cells[1:])
                out.append('<table class="m-table"><thead><tr>%s</tr></thead><tbody>%s</tbody></table>' % (h, b))
            table = []
    for line in md.splitlines():
        if line.startswith('```'): continue
        m = re.match(r'^(#{1,4})\s+(.*)', line)
        if m:
            flush()
            if len(m.group(1)) == 1 and skip_h1: continue
            hid = heading_id(m.group(2)); out.append('<h%d%s>%s</h%d>' % (len(m.group(1)), (' id="%s"' % hid) if hid else '', md_inline(m.group(2)), len(m.group(1)))); continue
        if line.startswith('|'):
            if para or lst: 
                t2 = table; table = []; flush(); table = t2
            table.append(line); continue
        m = re.match(r'^\s*(-|\d+\.)\s+(.*)', line)
        if m:
            kind = 'ol' if m.group(1)[0].isdigit() else 'ul'
            if para or table: flush()
            if lst and lst[0] != kind: flush()
            if not lst: lst = (kind, [])
            lst[1].append(m.group(2)); continue
        if line.strip() == '':
            flush(); continue
        if lst and line.startswith('  '):
            lst[1][-1] += ' ' + line.strip(); continue
        if table: flush()
        para.append(line.strip())
    flush()
    return '\n'.join(out)

def page(title, label, h1, lede, body_html, current, v):
    nav = [('/', 'Home'), ('/start', 'First call'), ('/questions', 'Questions'), ('/people/', 'For people who are called'), ('/status', 'Status'), ('/proof', 'Proof'), ('/llms.txt', 'Text index')]
    nv = ''.join('<a href="%s"%s>%s</a>' % (u, ' aria-current="page"' if u == current else '', n) for u, n in nav)
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>%s</title><meta name="description" content="%s"><link rel="stylesheet" href="/m.css">'
            '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; connect-src \'self\' https://%%%%API%%%%; base-uri \'none\'; object-src \'none\'; form-action \'self\'">'
            '<link rel="alternate" type="text/markdown" href="%s.md"></head><body class="m-doc"><main><nav aria-label="Site">%s</nav>'
            '<div class="m-label">%s</div><h1>%s</h1><p class="m-lede">%s</p><p class="m-status">%s</p>%s'
            '<footer>%s &middot; generated from one record (<a href="/canon.json">canon.json</a>) &middot; built %s</footer></main></body></html>'
            % (html.escape(title), html.escape(v['one_sentence']), current, nv, html.escape(label), html.escape(h1), html.escape(lede),
               html.escape(v['status_plain']), body_html, html.escape(v['network']), datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%MZ')))

def src_links(srcs):
    return '<p class="m-src">Source: ' + ', '.join('<a href="%s">%s</a>' % (html.escape(s), html.escape(s)) for s in srcs) + '</p>'

def esc_code(s): return html.escape(s)

def build(out, with_index=False):
    names, canon, promise, tools, v = values()
    os.makedirs(out, exist_ok=True)
    T = gen.gen_tools(names, canon, tools, gen.values(names, canon, tools))
    def w(name, data):
        p = os.path.join(out, name); os.makedirs(os.path.dirname(p), exist_ok=True)
        if isinstance(data, str) and name.endswith('.html'):
            # every inline script moves to its own file, so the page's content policy can allow scripts from this site only
            # (trust S2, 14 Nov 12:37 PM CT); the middleware fills %%API%% in .js as in .html
            n_js = [0]
            def _ext(m):
                n_js[0] += 1
                js = 'm-%s-%d.js' % (os.path.splitext(name.replace('/', '-'))[0], n_js[0])
                with open(os.path.join(out, js), 'w') as jf: jf.write(m.group(1))
                return '<script src="/%s" defer></script>' % js
            data = re.sub(r'<script>(.*?)</script>', _ext, data, flags=re.S)
        with open(p, 'w') as f:
            if isinstance(data, str): f.write(data)
            else: json.dump(data, f, indent=2, ensure_ascii=False); f.write('\n')
    now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    P = gen.price(ROOT)
    terms = {k: canon['offer']['terms'][k] for k in ('max_total', 'over_cap', 'what_you_pay', 'short', 'cancel', 'overrun', 'stop', 'hold', 'no_rejection', 'retries', 'errors', 'price_changes')}
    price = {'service': names['network'], 'currency': P['currency'], 'charged_now': P['charged_now'],
             'status': canon['offer']['price']['plain_status'], 'effective': P.get('effective'), 'changes_notice_days': P['changes_notice_days'],
             'price': P['public'], 'examples': [e for e in P.get('examples', []) if e.get('public')], 'terms': terms,
             'test_money': True, 'generated': now, 'source': '/canon.json'}
    w('price.json', price)
    # canon.json (public projection: no internal notes)
    pub = {'service': names['network'], 'standard': names['standard'], 'tool': names['tool'], 'names_are': 'working names',
           'wire_prefix': names['wire_prefix'], 'one_sentence': v['one_sentence'], 'longer': canon['identity']['longer'],
           'is_not': canon['identity']['is_not'],
           'three_things': {k: gen.fill(x, v) for k, x in canon['identity']['three_things'].items()},
           'status': {k: gen.fill(x, v) if isinstance(x, str) else x for k, x in canon['status'].items() if k not in ('source', 'read')},
           'kinds': canon['offer']['kinds'],
           'pools_reachable': {k: x for k, x in canon['offer']['pools'].items() if k in ('simulated', 'own_panel')},
           'pools_planned_not_reachable': canon['offer']['pools']['planned_not_reachable']['value'],
           'evidence_levels': {k: x for k, x in canon['evidence_levels'].items() if k not in ('status', 'source', 'read')},
           'refused': canon['offer']['refused']['value'], 'not_allowed_in_first_version': canon['offer']['refused']['not_allowed_in_first_version'],
           'how_it_starts': canon['offer']['how_it_starts']['value'], 'how_it_ends': canon['offer']['how_it_ends']['value'],
           'rely_on': canon['offer']['rely_on']['value'],
           'people': {k: x for k, x in canon['people'].items() if k not in ('source', 'read', 'promise_file')},
           'record': dict(canon['record'], checks_on_live=v.get('record_checks', [])), 'price': '/price.json', 'promise': '/promise.json', 'tools': '/tools.json',
           'generated': now}
    w('canon.json', pub)
    w('promise.json', {'service': names['network'], 'to': 'the people who are called',
                       'lines': [{'id': l['id'], 'text': l['text'], 'checked_after_every_release': l['_checked']} for l in promise['lines']],
                       'also': [x for x in promise['also'] if 'ops/' not in x],
                       'preview_note': 'During the preview every call is an unpaid test; the promises about pay apply to every paid call.',
                       'checked': v['promises_checked_sentence'], 'generated': now})
    w('promise.txt', 'What we promise the people who are called (%s)\n\n' % names['network'] + '\n'.join('%d. %s' % (l['n'], l['text']) for l in promise['lines']) + '\n\n' + '\n'.join(promise['also']) + '\n\n' + v['promises_checked_sentence'] + '\n')
    w('tools.json', {'mcp_server': 'https://%%API%%/mcp', 'server_instructions': T['server_instructions'], 'tools': T['tools']})
    # questions
    Q = json.load(open(os.path.join(ROOT, 'canon', 'questions.json')))['questions']
    qs = [(q['id'], fill(q['q'], v), fill(q['a'], v), q['sources']) for q in Q]
    md = ['# Questions an assistant may be asked about %s' % names['network'], '', v['status_plain'], '']
    for i, qq, aa, ss in qs:
        md += ['## ' + qq, '', aa, '', 'Source: ' + ', '.join(ss), '']
    w('questions.md', '\n'.join(md))
    body = ''.join('<section id="%s"><h3>%s</h3><p>%s</p>%s</section>' % (i, html.escape(qq), html.escape(aa), src_links(ss)) for i, qq, aa, ss in qs)
    w('questions.html', page('Questions about %s' % names['network'], 'Questions an assistant will be asked', 'Questions, answered once',
                             'Each answer comes from the same record as the tool text and the price file, so they cannot disagree.', body, '/questions', v))
    # start
    exc = dict(T['example_call'])
    if exc.get('kind') == 'listen': sm = tools.get('sample_media_id'); sm = sm.get('value') if isinstance(sm, dict) else sm; exc['content'] = sm or exc.get('content')   # /start's example works on any pool: a published sample, not a placeholder address
    ex = json.dumps(exc, indent=2)
    keyless = canon['offer'].get('keyless_simulated', {}).get('value')
    steps = [
        ('Get a test key' + (' (optional)' if keyless else ''), ('Simulated calls work with no key at all; a key adds a balance and caps. ' if keyless else '') + 'No account and no human needed. It holds $100 of test money; with it you can also make a panel your user\'s own people join, whose calls ring them.',
         'curl -s -X POST https://%%API%%/v1/keys \\\n  -H "content-type: application/json" -d \'{"class":"test"}\''),
        ('Connect the MCP server', ('Streamable HTTP. With no key it reaches simulated people; with a key, add an Authorization header. In Claude Code:' if keyless else 'Streamable HTTP, the key in an Authorization header. In Claude Code:'),
         ('claude mcp add --transport http %s https://%%%%API%%%%/mcp\n\n# with a key:\nclaude mcp add --transport http %s https://%%%%API%%%%/mcp \\\n  --header "Authorization: Bearer test_YOUR_KEY"' % (v['server_name'], v['server_name'])) if keyless else ('claude mcp add --transport http %s https://%%%%API%%%%/mcp \\\n  --header "Authorization: Bearer test_YOUR_KEY"' % v['server_name'])),
        ('Price a call (nothing is spent)', 'Call %s_quote, or POST /v1/quotes, with the same fields as the call. The material can wait: without content the quote is priced from minutes (stated, or 2) and says so in defaults_used. It returns each line of the price, test_money: true, and for_your_user, a sentence to show your user.' % names['tool'],
         'curl -s https://%%%%API%%%%/v1/quotes -H "authorization: Bearer test_YOUR_KEY" \\\n  -H "content-type: application/json" -d \'%s\'' % json.dumps({k: x for k, x in exc.items() if k not in ('max_total_usd', 'idempotency_key')})),
        ('Open the call', 'Call %s, or POST /v1/calls. Required: ask, kind, content (not for kind answer), people, max_total_usd. Send an idempotency_key too, so a retry returns the same call. It returns a call_id at once.' % names['tool'],
         ex),
        ('Fetch the answers', 'Call %s_results, or GET /v1/calls/{call_id}/responses?wait_seconds=25. Look again after next_check_after_seconds. Simulated answers carry simulated: true and begin "[simulated] ".' % names['tool'],
         'curl -s "https://%%API%%/v1/calls/CALL_ID/responses?wait_seconds=25" \\\n  -H "authorization: Bearer test_YOUR_KEY"'),
        ('Tell your user what came back', 'Say that the answers are simulated, what was spent (test money), and what you will change. If the answers change the work, send one line back with %s.' % next((t['name'] for t in T['tools'] if t['name'].endswith('outcome')), names['tool'] + '_send_outcome'), None),
    ]
    smd = ['# First call to %s, from nothing' % names['network'], '', v['status_plain'], '']
    sh = ''
    # One line, no key (the CEO, 4:24 PM CT, 14 Nov): working one-liners first, curl, Python requests, httpx; urllib sends
    # its own User-Agent (the edge refuses its default). Each prices a simulated call; nothing is spent.
    _q = {'ask': 'Which headline is clearer, and why?', 'kind': 'compare', 'people': 3, 'content': [{'text': 'Plan a week of dinners in five minutes'}, {'text': 'Dinner, decided'}]}
    _qp = repr(_q)
    ONE_LINERS = [
        ('curl', "curl -s https://%%API%%/v1/quotes -H 'content-type: application/json' -d '" + json.dumps(_q) + "'"),
        ('Python, requests', "python3 -c \"import requests; print(requests.post('https://%%API%%/v1/quotes', json=" + _qp + ").json()['for_your_user'])\""),
        ('Python, httpx', "python3 -c \"import httpx; print(httpx.post('https://%%API%%/v1/quotes', json=" + _qp + ").json()['for_your_user'])\""),
        ('Python, urllib (send a User-Agent of your own)', "python3 -c \"import json, urllib.request as u; r = u.Request('https://%%API%%/v1/quotes', data=json.dumps(" + _qp + ").encode(), headers={'content-type': 'application/json', 'user-agent': 'my-agent/1.0'}); print(json.load(u.urlopen(r))['for_your_user'])\""),
    ]
    smd += ['## One line, no key', '', 'Each prices a simulated call (nothing is spent) and prints the sentence to show your user.', '']
    for lab, code in ONE_LINERS: smd += [lab + ':', '', '```', code, '```', '']
    sh += '<h2>One line, no key</h2><p>Each prices a simulated call (nothing is spent) and prints the sentence to show your user.</p>' + ''.join('<p><strong>%s</strong></p><pre><code>%s</code></pre>' % (html.escape(lab), esc_code(code)) for lab, code in ONE_LINERS)
    # For a user who already has people (TEST_18, 15 Nov 2026: such agents read the site, not the tool list)
    OWN = ("If your user already has people whose reactions they want (testers, customers, players, a mailing list or a group "
           "chat), make a panel: POST /v1/panels with a name and asker_name (the name your user's people know them by, as in the example), or the panel tool. Its reply's "
           "for_your_user is a message your user drops into the email or chat they already use; each person joins on a phone in "
           "about two minutes. Then call with pool \"panel:<panel_id>\": their calls ring, and the answers come back to you, each "
           "with its record, with nothing for your user to collect. Free at zero pay.")
    smd += ['## Your user already has people', '', OWN, '',
            '```', "curl -s https://%%API%%/v1/panels -H 'authorization: Bearer test_YOUR_KEY' -H 'content-type: application/json' -d '{\"name\": \"beta testers\", \"asker_name\": \"Maple Games\"}'", '```', '']
    sh += '<h2>Your user already has people</h2><p>' + html.escape(OWN) + '</p><pre><code>' + esc_code("curl -s https://%%API%%/v1/panels -H 'authorization: Bearer test_YOUR_KEY' -H 'content-type: application/json' -d '{\"name\": \"beta testers\", \"asker_name\": \"Maple Games\"}'") + '</code></pre>'
    # Your own AI asks you (TEST_CONNECT_1, 15 Nov 2026: an agent that found us read us as "for surveying other people, not you", and
    # worked out /v1/tasks by trial and error because nothing it read named connections)
    MINE = ("If your user wants you to ask THEM (a yes or no, a choice, an approval, a step only they can do) on their phone: they open "
            "You, then Connect an AI, in the person.tools app or on their person.tools page, and give you the key (conn_...). Then POST "
            "/v1/tasks with that key, {\"title\", \"step\", \"unlocks\", \"urgency\"}, and GET /v1/tasks/<task_id> until state is done or "
            "answered; reply.choice, reply.text and reply.action hold the answer. Steps: question (2 to 4 choices, or none), approve, link, "
            "command. Or, with an MCP client, add https://%%API%%/mcp with that key as the bearer: two tools, ask_person and "
            "ask_person_reply. No page yet? They make one at https://%%RUN%%/start (a minute, no email). Asking your own user is free: no "
            "money, test or real. If nobody answers, the ask lapses after 30 days, or sooner with \"expires_in\" (60 s to 30 days; state "
            "\"lapsed\", and your webhook is "
            "told); there is no default answer, so you decide what to do while you wait, and you may withdraw it sooner (POST "
            "/v1/tasks/<task_id>/withdraw). Or add \"webhook\": \"https://...\" to the ask: the answer is POSTed there, signed with the "
            "connection's webhook secret (x-person-tools-signature). The whole page, with a prompt "
            "to paste: https://%%SITE%%/connect.")
    _m0, _h0 = len(smd), len(sh)   # the own-AI section goes first on /start (operations for the CEO, 12:20 PM CT 16 Nov)
    smd += ['## Your user wants you to ask them', '', MINE, '', '```', "curl -s https://%%API%%/v1/tasks -H 'authorization: Bearer conn_THEIR_KEY' -H 'content-type: application/json' -d '{\"title\": \"Refund over $50\", \"step\": {\"type\": \"question\", \"text\": \"Refund order 1042 ($64)?\", \"choices\": [\"Yes\", \"No\"]}, \"urgency\": \"now\"}'", '```', '']
    sh += '<h2>Your user wants you to ask them</h2><p>' + html.escape(MINE).replace('https://%%SITE%%/connect', '<a href="/connect">https://%%SITE%%/connect</a>') + '</p>'
    smd += [canon['own_ai_difference'], '', canon['preview_means'], '']
    sh += '<p>' + html.escape(canon['own_ai_difference']) + '</p><p>' + html.escape(canon['preview_means']) + '</p>'
    _mine_md, _mine_h = smd[_m0:], sh[_h0:]
    del smd[_m0:]; sh = sh[:_h0]
    assert smd[0].startswith('# First call') and smd[3] == ''
    smd[4:4] = _mine_md; sh = _mine_h + sh
    for n, (h, d, code) in enumerate(steps, 1):
        smd += ['## %d. %s' % (n, h), '', d, '']
        if code: smd += ['```', code, '```', '']
        sh += '<h2>%d. %s</h2><p>%s</p>%s' % (n, html.escape(h), html.escape(d), ('<pre><code>%s</code></pre>' % esc_code(code)) if code else '')
    rp = 'Real people are rung only on a panel whose members joined it themselves, from a link on their own phone. Any key can make a panel and its join link, a free test key too (POST /v1/panels, or the panel tool), and its calls ring the people who joined, when they are available and never in their quiet hours. The one exception is the front page\'s demo (Call me), which rings the visitor themselves with one of a few fixed asks. Strangers are not offered yet.'
    # Other ways in, once the code is public (owner, 14 Nov 2026, 10:18 PM CT): the plugin list, the registry entry, the source
    if names.get('public_repo'):
        _reg = names.get('registry_name') or ('.'.join(reversed(names['domain'].split('.'))) + '/' + names['tool'].replace('_', '-'))
        _plug = names['tool'].replace('_', '-') + '@' + names['network'].replace('.', '-')
        _repo = 'https://github.com/' + names['public_repo']
        _ways = [('Claude Code plugin', '/plugin marketplace add %s, then /plugin install %s' % (names['public_repo'], _plug)),
                 ('Official MCP registry', 'the entry %s (the same server)' % _reg),
                 ('Source', '%s, under the Apache License 2.0' % _repo)]
        smd += ['## Other ways in', ''] + ['- %s: %s' % (k, x) for k, x in _ways] + ['']
        sh += '<h2>Other ways in</h2><ul>' + ''.join('<li><strong>%s:</strong> %s</li>' % (html.escape(k), html.escape(x)) for k, x in _ways[:2]) + '<li><strong>Source:</strong> <a href="%s">%s</a>, under the Apache License 2.0</li></ul>' % (html.escape(_repo), html.escape(_repo))
    smd += ['## Real people', '', rp, '']
    sh += '<h2>Real people</h2><p>' + html.escape(rp) + '</p>'
    kinds = canon['offer']['kinds']
    EDGE_1010 = ('Python\'s built-in urllib gets "Error code: 1010" (HTTP 403) from the edge in front of the site and the API, before our code runs: its default User-Agent is refused for now. Send a User-Agent header of your own (for example "my-agent/1.0"); curl, httpx, requests and MCP clients are not affected.')
    bq = [('Will a retry open a second call?', 'No. The same idempotency_key with the same body returns the same call; the same key with a different body is the error idempotency_key_reused. With no idempotency_key, the same body within 10 minutes counts as the same call.'),
          ('How long does a call stay open?', 'Set deadline_minutes. Leave it out and defaults_used, in the quote and in the call, shows the deadline chosen. The longest allowed is under limits in the discovery file.'),
          ('What can content be?', 'A media id from GET /v1/media/samples (no key needed; m_sample_melody30 is one), an https address of the material, or {"text": "..."} for words to read (view and compare). For compare, a list of two to six of these. Uploading your own files is not open in the preview: the OpenAPI file lists POST /v1/media because the standard defines it, and this server does not offer it (media_upload is not among the features in its discovery file).'),
          ('Which kinds of call, and which answers?', 'Kinds: %s. Answer fields: text, boolean, number (min, max), choice (choices, multiple) and scale (min, max, at most 11 values).' % ', '.join(kinds)),
          ('What are the limits?', 'The discovery file lists them under limits: the most people on a call, the longest deadline and the longest wait for answers. Too many requests get rate_limited (HTTP 429) with retry_after_seconds.'),
          ('A Python script gets "Error code: 1010"', EDGE_1010),
          ('How does the key reach the MCP server?', 'As an Authorization header, as in step 2. Other MCP clients take the same header in their server settings.'),
          ('What happens to what I send?', 'It is shown to the people on the call and, if screening holds the call, to the operator who reviews it. A copy of your material is kept until the last call using it closes, plus 30 days. Answers are kept 395 days (or until you delete them), recordings 90 days and other records 30 days: retention in the discovery file. A quote keeps only its lines and total, for one day, so the person who approves a call can see them; never the ask or the content.')]
    smd += ['## Questions builders ask', '']
    for qq, aa in bq: smd += ['**%s** %s' % (qq, aa), '']
    sh += '<h2>Questions builders ask</h2>' + ''.join('<p><strong>%s</strong> %s</p>' % (html.escape(qq), html.escape(aa)) for qq, aa in bq)
    if (canon.get('contact') or {}).get('value'):
        # email_off: the edge's address obfuscation would hide the address from agents and break the link check (15 Nov 2026)
        sh += '<h2>Contact</h2><p><!--email_off--><a href="mailto:%s">%s</a><!--/email_off-->: questions and appeals; read by the operator, %s, %s. What we keep and for how long: <a href="/privacy">/privacy</a>.</p>' % (html.escape(canon['contact']['value']), html.escape(canon['contact']['value']), html.escape(canon['operator']['name']), html.escape(canon['operator']['address']))
        smd += ['## Contact', '', '%s: questions and appeals; read by the operator, %s, %s. What we keep and for how long: https://%%%%SITE%%%%/privacy.' % (canon['contact']['value'], canon['operator']['name'], canon['operator']['address']), '']
    sh += '<h2>Everything else</h2><p><a href="/tools.json">The tool text as served</a> &middot; <a href="/price.json">price and terms</a> &middot; <a href="/questions">questions</a> &middot; <a href="https://%%API%%/openapi.json">OpenAPI file</a> &middot; <a href="https://%%API%%/.well-known/' + names['wire_prefix'] + '">discovery file</a> &middot; <a href="https://%%SPEC%%/">the standard (draft)</a></p>'
    w('start.md', '\n'.join(smd))
    w('start.html', page('First call to %s' % names['network'], 'From nothing to a first call', 'Your first call, step by step',
                         'Your user wants you to ask them on their phone? One key from them, one ask, free. Calling other people? A test key, one tool call and one fetch; simulated people answer in seconds, so you can see the whole road before anyone real is rung.', sh, '/start', v))
    # llms.txt
    _ac = ((canon.get('identity') or {}).get('also_called') or {}).get('value') or []
    _rp = (canon.get('identity') or {}).get('real_people_line') or {}
    # own AI first (operations for the CEO, 12:20 PM CT 16 Nov: lead with 'your AIs ask you'; 4 of 8 cold agents had read us as built for panels)
    L = ['# %s' % names['network'], '', '> ' + v['one_sentence'], '',
         'Your own AIs ask you on your phone (approvals, choices, a line), free: you connect each one and give it a key; https://%%%%SITE%%%%/connect. Run by %s, Austin, Texas; contact %s.' % (canon['operator']['name'], (canon.get('contact') or {}).get('value') or 'see /security'), '',
         v['status_plain'] + ((' ' + _rp['value']) if _rp.get('live') else ''), '']
    if _ac: L += ['Also called: ' + ', '.join(_ac) + '.', '']
    L += [
         'Names are working names: %s (the service), %s (the open standard, draft), %s (the tool).' % (names['network'], names['standard'], names['tool']), '',
         '## Start', '',
         '- Your user wants you to ask THEM (yes or no, a choice, an approval) on their phone? They make a connection (You, then Connect an AI; no page yet? https://%%RUN%%/start) and give you its key; POST /v1/tasks with it and GET /v1/tasks/<id>, or add https://%%API%%/mcp with it (tools ask_person, ask_person_reply). Free; if nobody answers, the ask lapses after 30 days or your own expires_in (60 s up; state lapsed, and you are told), there is no default answer, and you may withdraw it sooner: https://%%SITE%%/connect',
         '- One line, no key (prices a simulated call; nothing is spent): ' + "curl -s https://%%API%%/v1/quotes -H 'content-type: application/json' -d '" + json.dumps({'ask': 'Which headline is clearer, and why?', 'kind': 'compare', 'people': 3, 'content': [{'text': 'Plan a week of dinners in five minutes'}, {'text': 'Dinner, decided'}]}) + "'",
         '- The same in Python: requests.post("https://%%API%%/v1/quotes", json={...}) or httpx.post(...); with urllib, send a User-Agent header of your own. All four in [start.md](https://%%SITE%%/start.md).',
         '- Your user already has people (testers, customers, players, a list or a chat)? POST /v1/panels gives a join link and a message (for_your_user) they drop into that email or chat; each person joins in about two minutes; calls with the panel\'s pool ring them and the answers come back to you. Free.',
         '- ' + canon['preview_means'],
         '- ' + canon['own_ai_difference'],
         '- [First call, from nothing](https://%%SITE%%/start.md): a free test key, the MCP server, one call, the answers.',
         '- MCP server (Streamable HTTP): https://%%API%%/mcp',
         '- HTTP API: https://%%API%%/v1/ ; OpenAPI file: https://%%API%%/openapi.json ; discovery file: https://%%API%%/.well-known/' + names['wire_prefix'],
         '- [Tool text as served](https://%%SITE%%/tools.json): the server instructions and every tool\'s words.',
         '- ' + EDGE_1010] + ([
         '- Claude Code plugin: /plugin marketplace add %s, then /plugin install %s' % (names['public_repo'], names['tool'].replace('_', '-') + '@' + names['network'].replace('.', '-')),
         '- Official MCP registry: %s' % (names.get('registry_name') or ('.'.join(reversed(names['domain'].split('.'))) + '/' + names['tool'].replace('_', '-'))),
         '- Source (Apache License 2.0): https://github.com/%s' % names['public_repo']] if names.get('public_repo') else []) + ['',
         '## Price and terms', '',
         '- [price.json](https://%%SITE%%/price.json): published price, not yet charged; every amount is test money during the preview.',
         '- Router fee %s%% of what the people are paid, at least $%s a call when anyone is paid; your own panel at zero pay is free; pay floor $%s an hour on the median time taken; default pay $%s an hour, at least $%s a person, on pools where we pay people (simulated calls and panels default to $0.00). Not charged during the preview.' % (v['fee_pct'], v['fee_min'], v['floor_hour'], v['default_hour'], v['min_call']), '',
         '## Real calls, as they happen', '', '- [proof.json](https://%%SITE%%/proof.json): real calls answered end to end (ours apart from outsiders\', read live from the API), the outside callers, and what each of our own calls changed.', '', '## The people who are called', '',
         '- [promise.json](https://%%SITE%%/promise.json): twelve promises to the people who are called. ' + v['promises_checked_sentence'], '- [For people who are called](https://%%SITE%%/people/): the promise, the pay rules and what a call looks like.', '',
         '## Questions', '',
         '- [Questions an assistant will be asked, with answers](https://%%SITE%%/questions.md)', '',
         '## The standard', '',
         '- [%s, draft](https://%%%%SPEC%%%%/): the open definition of the call; identifiers on the wire carry the placeholder %s until 0.1 is final.' % (names['standard'], names['wire_prefix']), '',
         '## Optional', '',
         '- [canon.json](https://%%SITE%%/canon.json): the one record every page and file here is generated from.', '']
    # the public contact address, once canon.json contact.value is set (CEO 14 Nov: hello@person.tools, forwarded to the owner;
    # shown only after the domain receives mail: check_live fails if it is shown with no MX record)
    _contact = (canon.get('contact') or {}).get('value')
    if _contact:
        L[-1:-1] = ['## Contact', '', '- %s: questions and appeals; read by the operator, %s, %s.' % (_contact, canon['operator']['name'], canon['operator']['address']), '- What we keep and for how long: https://%%SITE%%/privacy', '']
    w('llms.txt', '\n'.join(L))
    w('robots.txt', 'User-agent: *\nAllow: /\nSitemap: https://%%SITE%%/sitemap.xml\n')
    urls = ['/', '/start', '/questions', '/proof', '/people/', '/policy', '/status', '/security', '/privacy', '/connect', '/llms.txt', '/start.md', '/price.json', '/promise.json', '/tools.json', '/canon.json']
    if names.get('indexnow_key'): w('%s.txt' % names['indexnow_key'], names['indexnow_key'])   # IndexNow (Bing, Yandex): proves the site is ours
    # our own sample audio at a public address (TRUST, 10:47 AM CT 15 Nov 2026): copy-in takes public https addresses only, and an
    # outsider-style check needs our own audio on the site; it is the file offered as m_sample_melody30
    _smp = os.path.join(ROOT, 'samples', 'melody_30s.m4a')
    if os.path.exists(_smp):
        import shutil as _shs; os.makedirs(os.path.join(out, 'samples'), exist_ok=True); _shs.copyfile(_smp, os.path.join(out, 'samples', 'melody_30s.m4a'))
    w('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + ''.join('<url><loc>https://%%%%SITE%%%%%s</loc></url>\n' % u for u in urls) + '</urlset>\n')
    # /privacy and /terms (operations 1:08 PM CT 15 Nov 2026, for the app's Beta App Review; the operator named by its owner at 1:05):
    # canon/pages/privacy.md and terms.md, from policy/DATA.md, policy/CONNECTIONS.md and the tester notice; TRUST truth-passes them
    for _pg, _lede in (('privacy', 'What person.tools keeps, why, for how long, and how to delete it.'), ('terms', 'The terms of the person.tools preview.'),
                       ('connect', 'Let your own AI ask you things, and read your answers.')):
        _src = os.path.join(ROOT, 'canon', 'pages', _pg + '.md')
        if not os.path.exists(_src): continue
        _md = open(_src).read(); _t = _md.splitlines()[0].lstrip('# ').strip()
        w(_pg + '.md', _md)
        # email_off keeps the address readable (the edge's obfuscation turns it into a link that 404s for agents and the link check)
        _pre = []   # fenced blocks keep their lines (a prompt to copy as written)
        _md2 = re.sub(r'```\n(.*?)```', lambda mm: (_pre.append(mm.group(1)) or 'PREBLOCK%dX' % (len(_pre) - 1)), _md, flags=re.S)
        _body = md2html(_md2)
        for _i, _p in enumerate(_pre): _body = _body.replace('<p>PREBLOCK%dX</p>' % _i, '<pre class="m-pre"><code>%s</code></pre>' % html.escape(_p.rstrip()))
        _body = re.sub(r'([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,})', r'<!--email_off-->\1<!--/email_off-->', _body)
        w(_pg + '.html', page('%s: %s' % (_t, names['network']), _t, _t, _lede, _body, '/' + _pg, v))
    # /security: ops/SECURITY.md, minus its last section, with a report form (POST /v1/security-reports)
    secmd = open(os.path.join(ROOT, 'ops', 'SECURITY.md')).read()
    secmd = fill(secmd, {k: v[k] for k in ('network', 'standard', 'tool', 'domain')}) if re.search(r'\{(network|standard|tool|domain)\}', secmd) else secmd
    secmd = secmd[:secmd.rfind('\n## ')] if '\n## security.txt' in secmd else secmd
    # a public page names no lane and no internal file (TEAM.md s7; chief's truth pass 14 Nov 02:10 CT)
    secmd = re.sub(r'<!--.*?-->', '', secmd, flags=re.S)   # internal notes in the source stay out of the page
    secmd = re.sub(r'\s*Owner:\s*hc-[a-z]+\.', '', secmd)
    secmd = re.sub(r'\s*\(`policy/DATA\.md`[^)]*\)', ' (our data policy)', secmd)
    secmd = re.sub(r'\s*\(`?ops/HUMAN_JOBS\.md`?\)', '', secmd)
    secmd = re.sub(r'\s*\(`?(?:ops|policy|trust|chief|owner|market)/[^)]*\)', '', secmd)
    secmd = re.sub(r'`(?:ops|policy|trust|chief|owner|market)/[^`]*`', 'our records', secmd)
    form = ('<h2 id="report">Report a hole</h2><form class="m-form" id="secform"><label>What you found<textarea name="what" required rows="5"></textarea></label>'
            '<label>How to reproduce it<textarea name="how_to_reproduce" rows="5"></textarea></label>'
            '<label>Where to reply (optional: an address you choose to give)<input name="reply_to" type="text" autocomplete="off"></label>'
            '<button type="submit">Send the report</button><p class="m-src" id="secout" role="status"></p></form>'
            '<script>document.getElementById("secform").addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(e.target),o=document.getElementById("secout");'
            'o.textContent="Sending...";try{const r=await fetch("https://%%API%%/v1/security-reports",{method:"POST",headers:{"content-type":"application/json"},'
            'body:JSON.stringify({what:f.get("what"),how_to_reproduce:f.get("how_to_reproduce"),reply_to:f.get("reply_to")||undefined})});const j=await r.json().catch(()=>({}));'
            'o.textContent=r.ok?("Received"+(j.report_id?" as "+j.report_id:"")+". We answer within 72 hours."):("Not sent: "+(j.message||("HTTP "+r.status))+" The address is POST https://%%API%%/v1/security-reports.");}'
            'catch(x){o.textContent="Not sent (network). The address is POST https://%%API%%/v1/security-reports.";}});</script>')
    w('security.md', '# Reporting a security hole: %s\n\n' % names['network'] + secmd + '\n\nReport: POST https://%%API%%/v1/security-reports or the form at /security.\n')
    w('security.html', page('Reporting a security hole: %s' % names['network'], 'Security', 'Reporting a security hole',
                            'Tell us through the form below or the API. We answer within 72 hours.', md2html(secmd) + form, '/security', v))
    # /policy: policy/POLICY.md (what a call may ask), for agents and their humans to read before calling
    polp = os.path.join(ROOT, 'policy', 'POLICY.md')
    if os.path.exists(polp):
        pmd = open(polp).read()
        pmd = fill(pmd, {k: v[k] for k in ('network', 'standard', 'tool', 'domain')}) if re.search(r'\{(network|standard|tool|domain)\}', pmd) else pmd
        w('policy.md', '# What a call may ask: %s\n\n' % names['network'] + public_policy(pmd) + '\n')
        w('policy.html', page('What a call may ask: %s' % names['network'], 'Policy', 'What a call may ask',
                              'Every call is screened before anyone is asked. This is the rule list screening follows, with the reason each refusal gives.',
                              md2html(public_policy(pmd)), '/policy', v))
    # /approve: where an over-cap error's approve_url lands (trust's finding 14 Nov 2:29 AM CT: it served the home page)
    ab = ('<div id="m-approve-what" class="m-status" style="display:none"></div>'
          '<h2>What this link is for</h2><p>An agent tried to open a call that costs more than the cap set on its key. Nothing was '
          'opened and nothing was charged. This page is where the account owner would approve that one call or raise the cap.</p>'
          '<h2>Not open during the preview</h2><p>Approving a single call above a cap is not '
          'offered yet. What works now: ask your agent to make the call fit your cap (fewer people, lower pay or a lower '
          '<code>max_total_usd</code>). The cap is yours; nothing goes past it without you.</p>'
          '<p>The agent\'s quote lists every line of the price (the people\'s pay, the fee and the reserve); ask the agent to show it.</p>'
          '<script>(function(){var q=new URLSearchParams(location.search),id=q.get("quote"),t=q.get("total_usd")||q.get("total"),c=q.get("cap_usd")||q.get("cap"),'
          'el=document.getElementById("m-approve-what"),parts=[];function ok(x){return /^[0-9]+(\\.[0-9]{1,2})?$/.test(x||"")}'
          'if(id&&/^q_[A-Za-z0-9]{6,64}$/.test(id))parts.push("Quote "+id);if(ok(t))parts.push("total $"+t+" (test money)");if(ok(c))parts.push("over a cap of $"+c);'
          'if(parts.length){el.textContent=parts.join(", ")+".";el.style.display="block";}'
          'if(id&&/^q_[A-Za-z0-9]{6,64}$/.test(id)){fetch("https://%%API%%/v1/quotes/"+encodeURIComponent(id)).then(function(r){return r.ok?r.json():null}).then(function(j){'
          'if(!j||!j.lines)return;var t="Quote "+id+": ";var W={to_people:"the people\'s pay",router_fee:"router fee",pool_fee:"pool fee",reserve:"reserve",tax:"tax"};t+=j.lines.map(function(l){var k=l.kind||l.line;return (W[k]||k)+" $"+(l.amount_usd||l.usd)+(k==="reserve"?" (returned if unused)":"")}).join(", ");'
          't+="; total $"+j.total_usd+(j.test_money?" (test money)":"")+".";el.textContent=t;el.style.display="block";}).catch(function(){});}'
          '})();</script>')
    w('approve.html', page('Approving a call above a cap: %s' % names['network'], 'Approval', 'Approving a call above a cap',
                           'Nothing was opened and nothing was charged.', ab, '/approve', v))
    exp = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=365)).strftime('%Y-%m-%dT00:00:00Z')
    w('.well-known/security.txt', 'Contact: https://%%SITE%%/security\nExpires: ' + exp + '\nPreferred-Languages: en\nCanonical: https://%%SITE%%/.well-known/security.txt\nPolicy: https://%%SITE%%/security\n')
    # The owner's page: the scoreboard and RELEASES.md, newest first, from the chief's and the lanes' files. Unlisted (not in the
    # sitemap, noindex); its address is in market/JON_PAGE.md.
    tokf = os.path.join(ROOT, 'market', 'jon_page_token.txt')
    if os.path.exists(tokf):
        tok = open(tokf).read().strip()
        score = open(os.path.join(ROOT, 'chief', 'SCORE.md')).read() if os.path.exists(os.path.join(ROOT, 'chief', 'SCORE.md')) else '(no scoreboard yet)'
        rel = [l.strip() for l in open(os.path.join(ROOT, 'RELEASES.md')) if l.strip()] if os.path.exists(os.path.join(ROOT, 'RELEASES.md')) else []
        rel = [l.lstrip('- ').strip() for l in rel][::-1]
        tests = ''
        import glob as _g2
        for tf in sorted(_g2.glob(os.path.join(ROOT, 'market', 'rounds', 'TEST_*.md')), reverse=True):
            tt = open(tf).read()
            dec = tt.split('## Decision', 1)[1].split('\n## ', 1)[0].strip() if '## Decision' in tt else 'Declared; not run yet.'
            tests += '<h3>%s</h3><p>%s</p>' % (html.escape(os.path.basename(tf)[:-3].replace('_', ' ')), md_inline(' '.join(dec.split())[:900]))
        body = ('<h2>The customer\'s test</h2>' + (tests or '<p>Not run yet.</p>') + '<h2>Releases, newest first</h2><ol reversed>' + ''.join('<li>%s</li>' % md_inline(l) for l in rel) + '</ol>'
                '<h2>The scoreboard</h2>' + md2html(score))
        pg = page('%s: the build, for the owner' % names['network'], 'For the owner, unlisted', 'Where the build stands',
                  'What an agent or a person can now do, newest first, and every scoreboard item with its evidence. Rebuilt with each site deploy.', body, '/j', v)
        pg = pg.replace('<meta charset="utf-8">', '<meta charset="utf-8"><meta name="robots" content="noindex,nofollow">')
        w('j/%s/index.html' % tok, pg)
    w('m.css', CSS)
    if with_index:
        ib = ('<h2>For an agent</h2><p>Connect <code>https://%%API%%/mcp</code> and call <code>' + html.escape(names['tool']) + '</code>. '
              '<a href="/start">First call, from nothing</a> &middot; <a href="/llms.txt">text index</a> &middot; <a href="/tools.json">tool text</a> &middot; <a href="/questions">questions</a></p>'
              '<h2>For the person who approves the spending</h2><p>Every call states the most it may cost, and opens only if its full price is at or under it. <a href="/price.json">Price and terms</a>.</p>'
              '<h2>For the people who are called</h2><ol>' + ''.join('<li>%s</li>' % html.escape(l['text']) for l in promise['lines']) + '</ol>')
        w('index.html', page(names['network'], 'Preview', names['network'], v['one_sentence'], ib, '/', v))
    # A real 404 for any address the site does not have (without it Pages serves the front page with 200 to every unknown path)
    w('404.html', page('Not found: %s' % names['network'], 'Not found', 'There is no page at this address',
                       'The address may be mistyped, or the page has moved.', '<p><a href="/">The front page</a> &middot; <a href="/start">First call</a> &middot; <a href="/llms.txt">Text index</a></p>', '/404', v))
    # The official MCP registry's proof that person.tools is ours (HTTP method): the owner pastes the publisher key's public line
    # into canon/names.json mcp_registry_auth ("v=MCPv1; k=ed25519; p=..."); until then no file is served
    if names.get('mcp_registry_auth'):
        w('.well-known/mcp-registry-auth', names['mcp_registry_auth'].strip() + '\n')
    w('_headers', '/*.json\n  Access-Control-Allow-Origin: *\n  Content-Type: application/json; charset=utf-8\n/*.txt\n  Access-Control-Allow-Origin: *\n  Content-Type: text/plain; charset=utf-8\n/*.md\n  Access-Control-Allow-Origin: *\n  Content-Type: text/markdown; charset=utf-8\n/samples/*.m4a\n  Content-Type: audio/mp4\n  Access-Control-Allow-Origin: *\n')
    return sorted(os.listdir(out))

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--out', required=True); ap.add_argument('--with-index', action='store_true'); a = ap.parse_args()
    print(json.dumps(build(a.out, a.with_index)))
