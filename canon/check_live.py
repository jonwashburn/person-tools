#!/usr/bin/env python3
"""Read the LIVE surfaces and fail on any disagreement with the canon (scoreboard B1).

  python3 canon/check_live.py [--site HOST] [--api HOST] [--json]
Defaults: the fallback hosts in canon/names.json (askpeople-*.pages.dev). Exit 0 = every surface agrees; 1 = a disagreement
(each printed as FAIL with where and what); 2 = a surface could not be read.

What it checks:
 1. Site machine files (/llms.txt, /price.json, /canon.json, /promise.json, /promise.txt, /tools.json, /questions.md,
    /start.md): each equals what canon/gen_site.py writes now, with hosts filled for that site host (timestamps ignored).
 2. The MCP server at API/mcp: server instructions and every tool's name, title, description and annotations equal
    canon/out/tools.json word for word; no tool is missing or extra.
 3. The discovery file API/.well-known/<wire_prefix>: it exists and names the same wire prefix.
 4. Every live page a person or machine reads on the site and the api host (front page included): no rival's company
    name, no claim of real calls for everyone, the preview line present on the front page, and any router-fee percentage
    or pay floor stated equals the canon's.
 5. A quote on the live API for a paid simulated call: the router fee line equals the canon's formula.
Only the standard library is used; a test key is read from ~/.config/humancall/market_test.env when present.
"""
import json, os, re, sys, argparse, urllib.request, tempfile, subprocess, html

W = os.environ.get('HC_WORK') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEYFILE = os.path.expanduser('~/.config/humancall/market_test.env')
RIVALS = ['Prolific', 'RentAHuman', 'Rent a Human', 'Upwork', 'Fiverr', 'Mechanical Turk', 'MTurk', 'CloudResearch', 'Terac',
          'hiloop', 'gotoHuman', 'LetsClarify', 'UserTesting', 'Respondent.io', 'HumanLayer', 'Pearl']
OUT = []

def fail(where, what): OUT.append(('FAIL', where, what))
def ok(where, what=''): OUT.append(('ok', where, what))

def _team_check():
    try:
        for ln in open(os.path.expanduser('~/.config/humancall/team_check.env')):
            if '=' in ln and not ln.startswith('#'): return {'x-hc-team-check': ln.split('=', 1)[1].strip().strip('"').strip("'")}
    except OSError: pass
    return {}

def get(url, data=None, headers=None, timeout=25):
    h = {'User-Agent': 'canon-check/1', 'Accept': '*/*'}
    h.update(headers or {})
    if data is not None: h.update(_team_check())   # our own check's writes count as ours (OWNER_router_5 item 3); never printed
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None, headers=h,
                                 method='POST' if data is not None else 'GET')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.headers, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read().decode('utf-8', 'replace')
    except Exception as e:
        return 0, {}, str(e)

def hosts_for(site):
    if 'askpeople-site' in site:
        return {'SITE': site, 'API': 'askpeople-api.pages.dev', 'SPEC': 'askpeople-spec.pages.dev', 'RUN': 'askpeople-run.pages.dev'}
    b = re.sub(r'^www\.', '', site)
    return {'SITE': b, 'API': 'api.' + b, 'SPEC': 'spec.' + b, 'RUN': 'run.' + b}

def norm(text):
    # timestamps and build stamps are allowed to differ
    text = re.sub(r'"generated": "[^"]*"', '"generated": "*"', text)
    text = re.sub(r'built \d{4}-\d\d-\d\dT\d\d:\d\dZ', 'built *', text)
    return text.strip()

def key():
    if os.path.exists(KEYFILE):
        for l in open(KEYFILE):
            if '=' in l and not l.startswith('#'): return l.strip().split('=', 1)[1].strip().strip('"')
    return None

def mcp(api, k):
    url = 'https://%s/mcp' % api
    hd = {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'}
    if k: hd['Authorization'] = 'Bearer ' + k
    def rpc(i, m, p):
        s, h, b = get(url, {'jsonrpc': '2.0', 'id': i, 'method': m, 'params': p}, hd)
        if b.lstrip().startswith(('event:', 'data:')):
            for ln in b.splitlines():
                if ln.startswith('data:'):
                    try: return json.loads(ln[5:])
                    except Exception: pass
        try: return json.loads(b)
        except Exception: return {'error': {'message': 'HTTP %s %s' % (s, b[:200])}}
    init = rpc(1, 'initialize', {'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'canon-check', 'version': '1'}})
    get(url, {'jsonrpc': '2.0', 'method': 'notifications/initialized'}, hd)
    tl = rpc(2, 'tools/list', {})
    return init, tl

def visible_text(h):
    h = re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>', ' ', h)
    return html.unescape(re.sub(r'<[^>]+>', ' ', h))

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--site'); ap.add_argument('--api'); ap.add_argument('--json', action='store_true')
    ap.add_argument('--only', choices=['site', 'api'], help='site: checks 1 and 4 on the site; api: checks 2, 3, 5 and 4 on the api host')
    a = ap.parse_args()
    names = json.load(open(W + '/canon/names.json')); canon = json.load(open(W + '/canon/canon.json'))
    site = a.site or (names['hosts']['site'] if names.get('zone_active') else names['fallback_hosts']['site']); H = hosts_for(site); api = a.api or H['API']
    SITE = a.only in (None, 'site'); API = a.only in (None, 'api')
    # 1. site machine files
    tmp = tempfile.mkdtemp(prefix='canoncheck_')
    r = subprocess.run([sys.executable, W + '/canon/gen_site.py', '--out', tmp], capture_output=True, text=True)
    if r.returncode: fail('generator', r.stderr[-300:])
    # an unfilled format placeholder in a generated page (15 Nov 2026: an inline comment cut a '%' line and /start showed '%s')
    _bad = [fn for fn in os.listdir(tmp) if fn.endswith(('.html', '.md', '.txt')) and re.search(r'%[sd]\b|%\(\w+\)s|(?<!%)%(API|SITE|SPEC|RUN)%(?!%)', open(os.path.join(tmp, fn), errors='replace').read())]
    if _bad: fail('generator', 'unfilled placeholders in %s' % ', '.join(sorted(_bad)))
    for f in (['llms.txt', 'price.json', 'canon.json', 'promise.json', 'promise.txt', 'tools.json', 'questions.md', 'start.md'] if SITE else []):
        exp = open(os.path.join(tmp, f)).read()
        exp = re.sub(r'%%(API|SITE|SPEC|RUN)%%', lambda m: H[m.group(1)], exp)
        s, h, b = get('https://%s/%s' % (site, f))
        if s != 200: fail('site /' + f, 'HTTP %s' % s); continue
        if norm(b) != norm(exp):
            el, bl = norm(exp).splitlines(), norm(b).splitlines()
            diff = next(((i, x, y) for i, (x, y) in enumerate(zip(el, bl)) if x != y), (min(len(el), len(bl)), '(end)', '(end)'))
            fail('site /' + f, 'differs from the canon at line %d: live %r, canon %r' % (diff[0] + 1, diff[2][:120], diff[1][:120]))
        else: ok('site /' + f)
    # 2. MCP words
    T = json.load(open(W + '/canon/out/tools.json'))
    init, tl = mcp(api, key()) if API else ({'result': {'instructions': T['server_instructions']}}, {'result': {'tools': T['tools']}})
    if 'result' not in (init or {}): fail('mcp initialize', str((init or {}).get('error'))[:200])
    else:
        ins = init['result'].get('instructions')
        if ins != T['server_instructions']: fail('mcp server instructions', 'live %r != canon %r' % ((ins or '')[:100], T['server_instructions'][:100]))
        else: ok('mcp server instructions')
    live = {t['name']: t for t in ((tl or {}).get('result') or {}).get('tools', [])}
    if not live: fail('mcp tools/list', str((tl or {}).get('error'))[:200])
    want = {t['name']: t for t in T['tools']}
    for n in sorted(set(want) | set(live)):
        if n not in live: fail('mcp tool ' + n, 'missing on the live server'); continue
        if n not in want: fail('mcp tool ' + n, 'on the live server but not in the canon'); continue
        L, C = live[n], want[n]; bad = []
        if L.get('description') != C['description']: bad.append('description')
        if C.get('title') and (L.get('title') or (L.get('annotations') or {}).get('title')) != C['title']: bad.append('title')
        la = {k: v for k, v in (L.get('annotations') or {}).items() if k != 'title'}
        if la != C['annotations']: bad.append('annotations %s != %s' % (la, C['annotations']))
        # the field words (each input property's description) of a tool that has its own (ask_people; the quote's schema has
        # no descriptions by design: router mcp.js callSchema deletes them). Missed until 14 Nov 2026, when v25's field words
        # were live on the site but not on MCP
        fwords = C.get('field_words') or {}
        props = ((L.get('inputSchema') or {}).get('properties') or {}) if L.get('inputSchema') else None
        if props is not None:
            stale = [k for k, w in fwords.items() if isinstance(props.get(k), dict) and props[k].get('description') != w]
            if stale: bad.append('field words differ: ' + ', '.join(sorted(stale)))
        if bad: fail('mcp tool ' + n, ', '.join(bad))
        else: ok('mcp tool ' + n)
    # 3. discovery
    s, h, b = get('https://%s/.well-known/%s' % (api, names['wire_prefix'])) if API else (200, {}, '{}')
    if s != 200: fail('discovery', 'HTTP %s at /.well-known/%s' % (s, names['wire_prefix']))
    else:
        try:
            d = json.loads(b); ok('discovery', 'served')
            for k in ('network', 'standard', 'tool'):
                for path in (d.get('names') or {}, d):
                    if k in path and path[k] != names[k]: fail('discovery names.' + k, '%r != canon %r' % (path[k], names[k]))
        except Exception: fail('discovery', 'not JSON')
    # 4. pages people read
    PP = json.load(open(W + '/money/price.json'))['public']
    pr = {'router_fee_pct': PP['router_fee']['pct'], 'router_fee_min_usd': PP['router_fee']['min_usd_per_call'], 'pay_floor_usd_per_hour': PP['pay_floor']['usd_per_hour'], 'pay_default_usd_per_hour': PP['pay_default']['usd_per_hour']}
    for url in (['https://%s/' % site, 'https://%s/start' % site, 'https://%s/questions' % site] if SITE else []) + (['https://%s/' % api] if API else []) + (['https://%s/' % H['RUN']] if a.only is None else []):
        s, h, b = get(url)
        if s != 200: fail('page ' + url, 'HTTP %s' % s); continue
        t = visible_text(b)
        for rv in RIVALS:
            if re.search(r'\b%s\b' % re.escape(rv), t, re.I): fail('page ' + url, 'names %r (no rival named on any live page)' % rv)
        for m in re.finditer(r'(\d+(?:\.\d+)?)\s?%\s+(?:router\s+)?fee|fee\s+of\s+(\d+(?:\.\d+)?)\s?%', t, re.I):
            v = m.group(1) or m.group(2)
            if float(v) != float(pr['router_fee_pct']): fail('page ' + url, 'states a %s%% fee; canon says %s%%' % (v, pr['router_fee_pct']))
        for m in re.finditer(r'\$(\d+(?:\.\d\d)?)\s*(?:an|per|/)\s*hour', t, re.I):
            if float(m.group(1)) not in (float(pr['pay_floor_usd_per_hour']), float(pr['pay_default_usd_per_hour'])):
                fail('page ' + url, 'states $%s an hour; canon floor %s, default %s' % (m.group(1), pr['pay_floor_usd_per_hour'], pr['pay_default_usd_per_hour']))
        if url == 'https://%s/' % site and not re.search(r'preview', t, re.I):
            fail('page ' + url, 'front page does not say it is a preview')
        if re.search(r'real (people|calls) for everyone|open to everyone', t, re.I): fail('page ' + url, 'claims real calls for everyone')
        ok('page ' + url, 'read')
    # 4b. every link on our pages that points at our own hosts answers (no claim without a source that opens)
    if SITE:
        ours = re.compile(r'^https://(%s)(/[^\s"\'<>)]*)?$' % '|'.join(re.escape(x) for x in set(H.values())))
        seen_links = {}
        for path in ['/', '/start', '/questions', '/security', '/policy', '/people/', '/llms.txt', '/questions.md', '/start.md']:
            s0, h0, b0 = get('https://%s%s' % (site, path))
            if s0 != 200: continue
            for href in set(re.findall(r'href="([^"#]+)', b0) + re.findall(r'\((https://[^)\s]+)\)', b0) + re.findall(r'(https://[a-z0-9.-]+/[^\s"<>)]*)', b0)):
                u = href if href.startswith('http') else ('https://%s%s' % (site, href) if href.startswith('/') else None)
                if not u or not ours.match(u.rstrip('.,;')): continue
                u = u.rstrip('.,;')
                if '{' in u or 'CALL_ID' in u or u.endswith('/mcp') or '/v1/' in u: continue
                seen_links.setdefault(u, path)
        bad = 0
        for u, path in sorted(seen_links.items()):
            # /status runs a live simulated call and waits up to 15 s for its answers, so it may take 20 s or more (15 Nov 2026: two
            # site deploys rolled back on 'HTTP 0' at 25 s); our own pages get 60 s
            s1, _, _ = get(u, timeout=60)
            if s1 >= 400 or s1 == 0: fail('link on ' + path, '%s answers HTTP %s' % (u, s1)); bad += 1
        if not bad: ok('links', '%d links to our own hosts answer' % len(seen_links))
    # 4c. every tool name a page gives is one the server has (questions.md named one that no longer exists, found 14 Nov 2026)
    if SITE:
        real = set(x['name'].replace('{tool}', names['tool']) for x in json.load(open(W + '/canon/tools.json'))['tools'])
        wrong = {}
        for path in ['/', '/start', '/questions', '/security', '/policy', '/people/', '/llms.txt', '/questions.md', '/start.md', '/approve']:
            s0, h0, b0 = get('https://%s%s' % (site, path))
            if s0 != 200: continue
            bodies = [(path, b0)]
            for src in set(re.findall(r'<script[^>]+src="(/[^"?]+\.js)(?:\?[^"]*)?"', b0)):   # the scripts the page loads (names may be built there)
                s1, _, b1 = get('https://%s%s' % (site, src))
                if s1 == 200: bodies.append((src, b1))
            for where, body in bodies:
                for m in set(re.findall(r'\b%s(?:_[a-z]+)*\b' % re.escape(names['tool']), body)):
                    if m not in real: wrong.setdefault(m, where)
                for suf in set(re.findall(r'_tool\s*\+\s*["\'](_[a-z_]+)["\']', body)):   # a name glued onto the tool name in code
                    if names['tool'] + suf not in real: wrong.setdefault(names['tool'] + suf + ' (built in code)', where)
        for m, path in sorted(wrong.items()): fail('tool name on ' + path, '%r is not a tool the server has (%s)' % (m, ', '.join(sorted(real))))
        if not wrong: ok('tool names', 'every tool name on the pages is one the server has')
    # 4d. the note on 'Error code: 1010' (Python's urllib refused by the zone's browser check) is on the pages exactly while the edge refuses it
    if SITE:
        s0, _, b0 = get('https://%s/llms.txt' % site, headers={'User-Agent': 'Python-urllib/3.12'})
        refused = s0 == 403 and '1010' in b0
        s1, _, b1 = get('https://%s/llms.txt' % site)
        noted = 'Error code: 1010' in b1
        if refused and not noted: fail('urllib note', "the edge refuses Python's urllib (Error code: 1010) and llms.txt does not say so")
        elif noted and not refused: fail('urllib note', "the edge no longer refuses Python's urllib: remove EDGE_1010 from canon/gen_site.py")
        else: ok('urllib note', 'refused and noted' if refused else 'not refused, no note')
    # 4e. a contact address on the pages receives mail: its domain has an MX record (CEO 14 Nov: hello@person.tools)
    if SITE and (canon.get('contact') or {}).get('value'):
        _dom = canon['contact']['value'].split('@')[-1]
        s0, _, b0 = get('https://cloudflare-dns.com/dns-query?name=%s&type=MX' % _dom, headers={'Accept': 'application/dns-json'})
        try: _mx = [x for x in (json.loads(b0).get('Answer') or []) if x.get('type') == 15]
        except Exception: _mx = []
        if _mx: ok('contact address', '%s receives mail (MX present)' % canon['contact']['value'])
        else: fail('contact address', '%s is on the pages but %s has no MX record, so mail to it bounces' % (canon['contact']['value'], _dom))
    # 4f. our public pages are indexable (TRUST's release check trust/checks/indexable.py, 15 Nov 2026): no noindex meta tag or
    # X-Robots-Tag on the site's public pages and the standard's front page, and no robots.txt Disallow covering them
    if SITE:
        _spec = H.get('SPEC') or ('spec.' + site)
        _pages = [('https://%s' % site, ['/', '/start', '/questions', '/proof', '/llms.txt']), ('https://%s' % _spec, ['/'])]
        _blocked = []
        for _host, _paths in _pages:
            s0, _, rb = get(_host + '/robots.txt')
            if s0 == 200:
                _dis = []; _all = False
                for ln in rb.splitlines():
                    ln = ln.split('#', 1)[0].strip()
                    if ln.lower().startswith('user-agent:'): _all = ln.split(':', 1)[1].strip() == '*'
                    elif _all and ln.lower().startswith('disallow:'):
                        d = ln.split(':', 1)[1].strip()
                        if d: _dis.append(d)
                for pth in _paths:
                    if any(pth.startswith(d) for d in _dis): _blocked.append('%s%s (robots.txt Disallow)' % (_host, pth))
            for pth in _paths:
                s1, h1, b1 = get(_host + pth)
                xr = (h1.get('X-Robots-Tag') or h1.get('x-robots-tag') or '') if hasattr(h1, 'get') else ''
                if 'noindex' in xr.lower(): _blocked.append('%s%s (X-Robots-Tag)' % (_host, pth))
                if re.search(r'<meta[^>]+name="robots"[^>]+noindex', b1 or '', re.I): _blocked.append('%s%s (meta robots)' % (_host, pth))
        if _blocked: fail('indexable', 'blocked: ' + '; '.join(_blocked))
        else: ok('indexable', 'the site\'s public pages and the standard\'s front page let search engines in')
    # 3b. the API's own status line (discovery file ext) is the canon's status.plain (SERVICE bakes it at each build since
    # 15 Nov 2026; a canon edit reaches it only on SERVICE's next deploy, so drift shows here)
    if API:
        s0, _, bd = get('https://%s/.well-known/%s' % (api, names['wire_prefix']))
        try:
            _st = (json.loads(bd).get('ext') or {}).get(names['domain'], {}).get('status')
        except Exception:
            _st = None
        if _st is None: fail('api status line', 'the discovery file carries no ext status')
        elif _st != canon['status']['plain']: fail('api status line', 'live %r != canon %r (SERVICE redeploys after a canon status edit)' % (_st[:90], canon['status']['plain'][:90]))
        else: ok('api status line', 'the discovery file says the canon\'s status')
    # 4g. the human pages (the front page and /people/, built by SERVICE from the canon) say the canon's status line
    # (found 15 Nov 2026: they said "calls to them open after our last safety checks" for two hours after the gate opened)
    if SITE:
        import html as _h
        _want = canon['status']['plain']
        for pth in ('/', '/people/'):
            s0, _, b0 = get('https://%s%s' % (site, pth))
            if s0 != 200: continue
            if _want in b0 or _h.escape(_want, quote=True) in b0 or _want.replace("'", '&#x27;') in b0 or _want.replace("'", '&#39;') in b0: ok('status on ' + pth)
            else: fail('status on ' + pth, "the page does not carry the canon's status line (SERVICE rebuilds the human pages from the canon)")
    # 4h. /start's retention numbers are the API's (discovery file 'retention'); added 15 Nov 2026 after an agent in our own-people test
    # (TEST_18c) declined with "I couldn't find out what it keeps or for how long"
    if SITE:
        s0, _, b0 = get('https://%s/start.md' % site); s1, _, b1 = get('https://%s/.well-known/x-hc-draft' % api)
        try: _r = json.loads(b1).get('retention') or {}
        except Exception: _r = {}
        _m = re.search(r'Answers are kept (\d+) days[^.]*?recordings (\d+) days and other records (\d+) days', b0 or '')
        if s0 != 200 or s1 != 200 or not _r: fail('retention on /start', 'could not read /start.md (HTTP %s) or the discovery retention (HTTP %s)' % (s0, s1))
        elif not _m: fail('retention on /start', 'the retention sentence is missing from /start.md')
        elif [int(x) for x in _m.groups()] != [_r.get('responses_days'), _r.get('recordings_days'), _r.get('records_days')]:
            fail('retention on /start', '/start says %s days; the API says answers %s, recordings %s, records %s' % ('/'.join(_m.groups()), _r.get('responses_days'), _r.get('recordings_days'), _r.get('records_days')))
        else: ok('retention on /start', 'matches the API (%s/%s/%s days)' % _m.groups())
    # 5. a live quote
    k = key() if API else None
    if k:
        # 5a. every example in the tool text must work as a quote on the live server (the words promise it)
        for nm in ('example_call', 'example_quote'):
            ex = {kk: vv for kk, vv in T.get(nm, {}).items() if kk not in ('max_total_usd', 'idempotency_key')}
            if not ex: continue
            s, h, b = get('https://%s/v1/quotes' % api, ex, {'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json'})
            if s != 200: fail('tool text ' + nm, 'the example in the tool text is refused by the live quote: HTTP %s %s' % (s, b[:220]))
            else: ok('tool text ' + nm, 'works as a live quote')
        call = {'ask': 'Which headline is clearer?', 'kind': 'compare', 'content': ['https://example.com/a.png', 'https://example.com/b.png'], 'people': 10,
                'pay_per_person_usd': '2.00', 'minutes': 2, 'pool': 'simulated'}
        s, h, b = get('https://%s/v1/quotes' % api, call, {'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json'})
        try:
            q = json.loads(b); lines = q.get('lines') or []
            fee = [l for l in lines if (l.get('kind') or l.get('line') or l.get('name')) == 'router_fee'] or [l for l in lines if 'router' in json.dumps(l).lower()]
            people = 10 * 2.00; want_fee = max(people * pr['router_fee_pct'] / 100.0, float(pr['router_fee_min_usd']))
            got = None
            for l in fee:
                for kk in ('amount_usd', 'usd', 'amount'):
                    if kk in l: got = float(l[kk]); break
                if got is not None: break
            if got is None: fail('live quote', 'no router fee line found in %s' % json.dumps(lines)[:200])
            elif abs(got - want_fee) > 0.005: fail('live quote', 'router fee %.2f on $%.2f of pay; canon gives %.2f' % (got, people, want_fee))
            else: ok('live quote', 'router fee %.2f matches the canon' % got)
        except Exception as e:
            fail('live quote', 'HTTP %s, unreadable: %s' % (s, b[:160]))
    elif API:
        OUT.append(('skip', 'live quote', 'no test key at %s' % KEYFILE))
    fails = [x for x in OUT if x[0] == 'FAIL']
    if a.json: print(json.dumps([{'state': s, 'where': w, 'what': x} for s, w, x in OUT], indent=1))
    else:
        for s, w, x in OUT: print('%-4s %s%s' % (s, w, (': ' + x) if x else ''))
        print('%d checks, %d disagreements' % (len(OUT), len(fails)))
    sys.exit(1 if fails else 0)

if __name__ == '__main__':
    main()
