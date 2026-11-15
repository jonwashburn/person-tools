#!/usr/bin/env python3
"""Write the launch files from the canon: the MCP registry file and the Claude Code plugin list.

  python3 canon/gen_launch.py     -> launch/registry/server.json, launch/plugin/ (a repository folder ready to publish)
Absolute hosts here come from canon/names.json 'hosts' (the canonical domain): these files are read by other people's
systems, not served by us. Nothing is published by this script; the owner publishes at the hour the owner granted.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
names, canon, promise, tools = gen.load(ROOT)
v = gen.values(names, canon, tools)
HOSTS = names['hosts'] if names.get('zone_active') else names['fallback_hosts']   # person.tools once the zone is active
api = 'https://%s/mcp' % HOSTS['api']; site = 'https://%s' % HOSTS['site']
short = canon['identity']['short']['value']; assert len(short) <= 100, len(short)
ns = '.'.join(reversed(names['domain'].split('.')))          # person.tools -> tools.person
slug = names['tool'].replace('_', '-')                        # ask_people -> ask-people
envvar = names['network'].upper().replace('.', '_').replace('-', '_') + '_KEY'
srv = names['network'].replace('.', '-')
L = os.path.join(ROOT, 'launch')
def w(rel, obj):
    p = os.path.join(L, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w') as f:
        if isinstance(obj, str): f.write(obj)
        else: json.dump(obj, f, indent=2, ensure_ascii=False); f.write('\n')
w('registry/server.json', {
    '$schema': 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
    'name': names.get('registry_name') or '%s/%s' % (ns, slug), 'title': names.get('registry_title') or names['network'], 'description': short, 'version': '0.1.1', 'websiteUrl': site,
    **({'repository': {'url': 'https://github.com/' + names['public_repo'], 'source': 'github'}} if names.get('public_repo') else {}),
    'remotes': [{'type': 'streamable-http', 'url': api, 'headers': [{'name': 'Authorization', 'isRequired': False, 'isSecret': True,   # optional: simulated calls need no key (goal 2: a first call with nothing to ask for)
        'description': 'Optional: Bearer <key>. Simulated calls need no key. A free test key (POST https://%s/v1/keys with {"class":"test"}) adds a balance of test money and caps; with it, a panel of people your user invites can be made and called.' % HOSTS['api']}]}]})
w('plugin/.claude-plugin/marketplace.json', {'name': srv, 'owner': {'name': names['network']},
    'plugins': [{'name': slug, 'source': './plugins/%s' % slug, 'description': short}]})
# The plugin is code: it names a licence only once the owner has chosen one (names.json code_licence_spdx); until then the
# README's sentence holds (all rights reserved), and plugin.json must not say otherwise.
_pj = {'name': slug, 'version': '0.1.0', 'description': short, 'author': {'name': names['network']}, 'homepage': site}
if names.get('code_licence_spdx'): _pj['license'] = names['code_licence_spdx']
w('plugin/plugins/%s/.claude-plugin/plugin.json' % slug, _pj)
w('plugin/plugins/%s/.mcp.json' % slug, {'mcpServers': {srv: {'type': 'http', 'url': api, 'headers': {'Authorization': 'Bearer ${%s}' % envvar}}}})
w('plugin/README.md', '# %s plugin list for Claude Code\n\n%s\n\n%s\n\nInstall: `claude plugin marketplace add %s` then `claude plugin install %s@%s`, with `%s` set to your key '
  '(a test key is free: `curl -s -X POST https://%s/v1/keys -H "content-type: application/json" -d \'{"class":"test"}\'`).\n' %
  (names['network'], v.get('one_sentence', gen.fill(canon['identity']['one_sentence'], v)), canon['status']['plain'], names.get('public_repo', '<owner>/<repo>'), slug, srv, envvar, HOSTS['api']))
print('wrote launch/registry/server.json and launch/plugin/ (namespace %s, server %s, env %s)' % (ns, srv, envvar))

# "A task written as a call" (B8): a launch draft generated from the canon, so its numbers cannot drift.
import re as _re
P = gen.price(ROOT)['public']
ex = gen.gen_tools(names, canon, tools, v)['example_call']
vals = dict(v)
vals.update({'status_plain': canon['status']['plain'], 'example_call': json.dumps(ex, indent=2), 'acceptance': P['acceptance'],
             'refused_joined': '; '.join(canon['offer']['refused']['value']),
             'own_material_line': canon['offer']['own_panel_material']['lines'][canon['offer']['own_panel_material']['value']],
             'first_call_title': canon['proof']['first_call']['title'],
             'first_call_line': canon['proof']['first_call']['text'] + ((' ' + canon['proof']['first_call']['outcome_lead'] + ' ' + canon['proof']['first_call']['outcome']) if canon['proof']['first_call'].get('outcome') else ''),
             'start_line': 'A free test key reaches simulated people, who answer in seconds: the steps are at https://%s/start. Real people answer on a panel of the user\'s own people, which any key can make.' % HOSTS['site']})
tpl = open(os.path.join(ROOT, 'canon', 'launch_templates', 'task_as_a_call.md')).read()
def _r(m):
    k = m.group(1)
    if k not in vals: raise SystemExit('gen_launch: no value for {%s}' % k)
    return vals[k]
w('TASK_AS_A_CALL.md', _re.sub(r'\{([a-z_]+)\}', _r, tpl))
print('wrote launch/TASK_AS_A_CALL.md')

vals.update({'api_host': HOSTS['api'], 'site_host': HOSTS['site'], 'spec_host': HOSTS['spec'], 'registry_name': names.get('registry_name') or '%s/%s' % (ns, slug),
             'plugin_ref': '%s@%s' % (slug, srv), 'public_repo': names.get('public_repo', 'OWNER/REPO')})
# The first real call's paragraph (REACH writes canon/launch_templates/first_call.md once the call is on /proof; empty before)
# Two cases (CEO, 10:20 PM CT, 14 Nov): the hour the first real call is on /proof (first_call.md, written then), or noon CT
# Sunday 15 Nov around the agent's own first call (first_call_noon.md), the real-call line left off
_fc = os.path.join(ROOT, 'canon', 'launch_templates', 'first_call.md')
_fn = os.path.join(ROOT, 'canon', 'launch_templates', 'first_call_noon.md')
_fcc = (canon.get('proof') or {}).get('first_call')   # 15 Nov 2026, 10:28 AM CT: the first real call, its paragraph in the canon
_real = bool(_fcc) or os.path.exists(_fc)
if _fcc: vals['first_call'] = '**%s.** %s\n\n' % (_fcc['title'], vals['first_call_line'])
else: vals['first_call'] = (open(_fc if _real else _fn).read().strip() + '\n\n') if (_real or os.path.exists(_fn)) else ''
vals['proof_line'] = (' ·\nReal calls answered so far, ours apart from outsiders\', as they happen: https://%s/proof' % HOSTS['site']) if _real else ''
vals['case_line'] = ('The real-call case: the first real call is on https://%s/proof.' % HOSTS['site']) if _real else ('The noon case (no real call on /proof yet): written around an agent\'s own first call; the real-call line is left off.')
tpl = open(os.path.join(ROOT, 'canon', 'launch_templates', 'announcement.md')).read()
w('ANNOUNCEMENT.md', _re.sub(r'\{([a-z_]+)\}', _r, tpl))
print('wrote launch/ANNOUNCEMENT.md')

# The public repository's README (round-3 order 1; D38): the same hosts as the rest of the kit, switched by zone_active
vals.update({'public_repo': names.get('public_repo', 'OWNER/REPO'), 'code_licence': names.get('code_licence') or 'The code carries no licence yet: until the owner adds a LICENSE file, all rights are reserved.'})
tpl = open(os.path.join(ROOT, 'canon', 'launch_templates', 'public_readme.md')).read()
w('PUBLIC_README.md', _re.sub(r'\{([a-z_]+)\}', _r, tpl))
print('wrote launch/PUBLIC_README.md')

# The plugin's skill: when and how to ask people, from the canon (B8)
T2 = gen.gen_tools(names, canon, tools, v)
tn = {t['name'] for t in T2['tools']}
q = names['tool'] + '_quote'; r = names['tool'] + '_results'; o = next((t for t in tn if t.endswith('outcome')), names['tool'] + '_send_outcome')
skill = """---
name: %(slug)s
description: Ask several people for a reaction a model cannot give (how a song feels, whether a page is clear, whether a game is fun, which version people prefer), through the %(srv)s MCP server, and report the answers truthfully.
---

# Asking people through %(net)s

%(status)s

## When this fits
- Your user asked for other people's reactions to something, or said yes when you offered, and the answer needs a
  human: a song, a page, a game build, two versions of a headline.
- Not for your user's own taste (ask them), not for facts (search), not for anything done away from a screen.

## How
1. Price it first with `%(q)s` (nothing is spent; the file can wait, since a quote without `content` is priced from
   minutes). If your user has not named a budget, show them the quote's `for_your_user` sentence, which states the cost,
   and wait for their yes.
2. Open it with `%(tool)s`: `ask`, `kind`, `content` (a sample's media id from `GET /v1/media/samples`, an https URL, or `{"text": ...}`; not for kind answer), `people`,
   `max_total_usd` (the amount your user approved). Send an `idempotency_key`.
3. Fetch answers with `%(r)s`, looking again after `next_check_after_seconds`.
4. Tell your user what came back: say plainly when answers are simulated (each one begins "[simulated] "), what was
   spent (test money during the preview), and what the evidence level of each answer was.
5. If the answers changed the work and your user agrees, send one line with `%(o)s`.

The price, the terms and the promise to the people who answer: https://%(site)s/price.json, https://%(site)s/promise.json.
""" % {'slug': slug, 'srv': srv, 'net': names['network'], 'status': canon['status']['plain'], 'q': q, 'tool': names['tool'], 'r': r, 'o': o, 'site': HOSTS['site']}
w('plugin/plugins/%s/skills/%s/SKILL.md' % (slug, slug), skill)
print('wrote the plugin skill')
