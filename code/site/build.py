#!/usr/bin/env python3
"""Build askpeople-site into one folder.

  python3 code/site/build.py --out DIR
1. The human pages go in first, at the root: in bin/golive's build copy, human/ is runner's READY copy (golive replaces the
   working folder with .ready/human). With none, canon/gen_site.py writes a plain front page (--with-index).
2. Everything a machine reads is generated from the canon (canon/gen_site.py) and written on top: it never overwrites a
   human page except where the machine file has the same name, which is an error.
3. build.json: the stamp and the file list. Prints {"stamp", "files"} for bin/golive.
Functions (the host filler) are in code/site/functions/; deploy from code/site/ so Pages finds them.
"""
import json, os, sys, shutil, argparse, datetime, subprocess, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get('HC_WORK') or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # the work folder (canon/ lives there)
if not os.path.isdir(os.path.join(ROOT, 'canon')):
    sys.exit('build.py: set HC_WORK to the work folder (the one holding canon/); a build copy runs outside it')
ap = argparse.ArgumentParser(); ap.add_argument('--out', required=True); ap.add_argument('--ready', action='store_true'); a = ap.parse_args()
out = os.path.abspath(a.out)
if os.path.exists(out): shutil.rmtree(out)
os.makedirs(out)
human = None
for c in (os.path.join(HERE, 'human'),):  # inside bin/golive's build copy this is runner's READY copy (golive puts it there)
    if os.path.isdir(c) and os.listdir(c):
        human = c; break
src = human
if src: shutil.copytree(src, out, dirs_exist_ok=True)
# an address in a human page stays readable: the edge's email obfuscation would turn it into a /cdn-cgi link that 404s for
# agents and the link check (15 Nov 2026), so each one is wrapped in email_off, the edge's own marker (not twice)
import re as _re
if src:
    for _d, _, _fs in os.walk(out):
        for _f in _fs:
            if not _f.endswith('.html'): continue
            _p = os.path.join(_d, _f); _h = open(_p, encoding='utf-8').read()
            if 'email_off' in _h: continue
            _h2 = _re.sub(r'(<a [^>]*href="mailto:[^"]+"[^>]*>.*?</a>)', r'<!--email_off-->\1<!--/email_off-->', _h, flags=_re.S)
            if _h2 != _h: open(_p, 'w', encoding='utf-8').write(_h2)
human_files = set()
for d, _, fs in os.walk(out):
    for f in fs: human_files.add(os.path.relpath(os.path.join(d, f), out))
tmp = out + '.machine'
if os.path.exists(tmp): shutil.rmtree(tmp)
r = subprocess.run([sys.executable, os.path.join(ROOT, 'canon', 'gen_site.py'), '--out', tmp] + ([] if human else ['--with-index']), capture_output=True, text=True)
if r.returncode != 0:
    sys.stderr.write(r.stderr); sys.exit(4)
clash = []
for d, _, fs in os.walk(tmp):
    for f in fs:
        rel = os.path.relpath(os.path.join(d, f), tmp)
        if rel in human_files and rel != '_headers': clash.append(rel)
        dst = os.path.join(out, rel); os.makedirs(os.path.dirname(dst), exist_ok=True)
        if rel == '_headers' and os.path.exists(dst):
            open(dst, 'a').write('\n' + open(os.path.join(d, f)).read())
        else:
            shutil.copy(os.path.join(d, f), dst)
shutil.rmtree(tmp)
if clash:
    sys.stderr.write('build.py: machine files clash with human pages: %s\n' % clash); sys.exit(5)
# the status function's expectations, from the canon (written into this build copy's functions/)
sys.path.insert(0, os.path.join(ROOT, 'canon')); import gen as _g
_n, _c, _p, _t = _g.load(ROOT)
_tools = [x['name'] for x in _g.gen_tools(_n, _c, _t, _g.values(_n, _c, _t, ROOT))['tools']]
open(os.path.join(HERE, 'functions', '_expect.js'), 'w').write('export const EXPECT = ' + json.dumps({'tools': _tools, 'wire_prefix': _n['wire_prefix'], 'network': _n['network'], 'status_plain': _c['status']['plain'], 'first_call': {k: (_c.get('proof') or {}).get('first_call', {}).get(k) for k in ('title', 'text', 'outcome_lead', 'outcome')}}) + ';\n')
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
files = {}
for d, _, fs in os.walk(out):
    for f in fs:
        p = os.path.join(d, f); files[os.path.relpath(p, out)] = hashlib.sha256(open(p, 'rb').read()).hexdigest()[:16]
info = {'stamp': stamp, 'human_source': 'runner READY copy' if src else 'none (generated front page)', 'files': files}
json.dump(info, open(os.path.join(out, 'build.json'), 'w'), indent=1)
print(json.dumps({'stamp': stamp, 'files': {'all': sorted(files)}, 'human_source': info['human_source']}))
