#!/usr/bin/env python3
"""Generate every surface from the canon (names.json, canon.json, promise.json, tools.json).

Usage: python3 canon/gen.py [--root DIR] [--out DIR]
  --root: the folder holding canon/ (default: this file's parent's parent)
  --out:  where generated files go (default: ROOT/canon/out)
Only known placeholders are filled ({tool}, {network}, ...); other braces (JSON in examples) are left alone.
A placeholder with no value stops the run, so nothing half-filled is ever written.
"""
import json, re, sys, os, argparse

def load(root, tools_path=None):
    c = lambda n: json.load(open(os.path.join(root, 'canon', n)))
    t = json.load(open(tools_path)) if tools_path else c('tools.json')
    return c('names.json'), c('canon.json'), c('promise.json'), t

def price(root):
    """The price record is money/price.json; only its public block reaches a surface."""
    return json.load(open(os.path.join(root, 'money', 'price.json')))

def short_money(x):
    return x[:-3] if x.endswith('.00') else x

def values(names, canon, tools, root=None):
    P = price(root or os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    pub = P['public']
    v = {
        'network': names['network'], 'standard': names['standard'], 'tool': names['tool'],
        'domain': names['domain'], 'wire_prefix': names['wire_prefix'],
        'fee_pct': str(pub['router_fee']['pct']), 'fee_min': pub['router_fee']['min_usd_per_call'],
        'floor_hour': short_money(pub['pay_floor']['usd_per_hour']),
        'min_call': short_money(pub['pay_default']['min_per_person_usd']),
        'default_hour': short_money(pub['pay_default']['usd_per_hour']),
        'notice_days': str(P['changes_notice_days']),
        'reserve_pct': str(pub['reserve']['pct_of_people']),
        'sample_media_id': tools['sample_media_id']['value'],
    }
    return v

PH = re.compile(r'\{(network|standard|tool|domain|wire_prefix|fee_pct|fee_min|floor_hour|min_call|default_hour|notice_days|reserve_pct|sample_media_id|example_call|example_quote|short_rule|cancel_rule|stop_rule)\}')

def fill(s, v):
    def r(m):
        k = m.group(1)
        if k not in v:
            raise SystemExit(f'gen.py: placeholder {{{k}}} has no value')
        return v[k]
    out = PH.sub(r, s)
    return out

def fill_obj(o, v):
    if isinstance(o, str): return fill(o, v)
    if isinstance(o, list): return [fill_obj(x, v) for x in o]
    if isinstance(o, dict): return {fill(k, v): fill_obj(x, v) for k, x in o.items()}
    return o

def gen_tools(names, canon, tools, v):
    v = dict(v)
    T = canon['offer']['terms']; v.update({'short_rule': T['short'], 'cancel_rule': T['cancel'], 'stop_rule': T['stop']})
    ex = fill_obj(tools['example_call'], v)
    v['example_call'] = json.dumps(ex, separators=(',', ':'))
    exq = fill_obj(tools.get('example_quote', tools['example_call']), v)
    v['example_quote'] = json.dumps(exq, separators=(',', ':'))
    out = {
        'generated_from': 'canon/tools.json v%s + canon/names.json + canon/canon.json' % tools['version'],
        'server_instructions': fill(tools['server_instructions'], v),
        'tools': [fill_obj({k: t[k] for k in t}, v) for t in tools['tools']],
        'example_call': ex,
        'example_quote': exq,
    }
    return out

def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap.add_argument('--root', default=here)
    ap.add_argument('--out', default=None)
    ap.add_argument('--tools', default=None, help='a candidate tools source (market/candidates/tools_vN.json); write its output with --out, never into canon/out')
    a = ap.parse_args()
    out = a.out or os.path.join(a.root, 'canon', 'out')
    os.makedirs(out, exist_ok=True)
    if a.tools and not a.out: raise SystemExit('gen.py: a candidate (--tools) needs --out outside canon/out')
    names, canon, promise, tools = load(a.root, a.tools)
    v = values(names, canon, tools, a.root)
    t = gen_tools(names, canon, tools, v)
    def w(name, obj):
        p = os.path.join(out, name); tmp = p + '.tmp'
        with open(tmp, 'w') as f:
            if isinstance(obj, str): f.write(obj)
            else: json.dump(obj, f, indent=2, ensure_ascii=False); f.write('\n')
        os.replace(tmp, p)
    w('tools.json', t)
    # plain-text copy for reading
    lines = ['SERVER INSTRUCTIONS (%d characters)' % len(t['server_instructions']), t['server_instructions'], '']
    for x in t['tools']:
        lines += ['=' * 70, 'TOOL %s  (title: %s)' % (x['name'], x['title']), 'annotations: ' + json.dumps(x['annotations']), '', x['description'], '']
    w('tools.txt', '\n'.join(lines) + '\n')
    print('gen.py: wrote', ', '.join(sorted(os.listdir(out))), 'in', out)

if __name__ == '__main__':
    main()
