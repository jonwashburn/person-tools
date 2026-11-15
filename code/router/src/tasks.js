// TASKS (the CEO, owner/OWNER_all_7.md, 8:29 AM CT 15 Nov 2026: one place where the operator's programs give the operator
// tasks). A task is a call of its own kind: one named person on the key's own panel is asked to do ONE exact thing (a command
// to paste, a link to open) or answer ONE question (two to four choices, or a typed line). The person sees one list (the
// member page, the app) and replies Done, an answer, or Not now, with an optional note; the asker reads the state by id.
// "now" rings once; "today" and "whenever" only join the list. A task to one named person never reaches anyone else.
// Only the operator's own keys (operator-made or team) place tasks for now (the CEO 8:56 AM CT 15 Nov; TRUST 8:50), and a
// task's text passes the same screen as any call (screening's checkTask).
// Bounds (TRUST checks them; screening's taskBounds when present): no key's value anywhere (name its file), nothing the
// operator does not share and no confidential material the operator names (the operator's own rule; the lists are read at
// run time from the database, private_terms.js), one step only.
import { rid, nowMs, iso, apiBase } from './util.js';
import { fixable, notFixable } from './spec.js';
import { taskBounds } from './screening/task_bounds.js';   // TRUST's bounds (policy/TASKS.md 2 to 7)
import { taskTerms } from './private_terms.js';

const URGENCY = ['now', 'today', 'whenever'];
const RANK = { now: 0, today: 1, whenever: 2 };
const SECRET_RX = /\b(?:sk-[A-Za-z0-9_-]{8,}|(?:test|real|live|mt|st|jc|ar)_[A-Za-z0-9_.-]{12,}|Bearer\s+\S{8,}|[A-Fa-f0-9]{40,}|[A-Za-z0-9+_-]{48,}={0,2})/;   // no '/' here: a long link path is not a key
const str = (v, field, min, max, example) => {
  if (typeof v !== 'string' || v.trim().length < min || v.length > max) throw fixable(v === undefined ? 'missing_field' : 'invalid_field', field, `${field} is ${min} to ${max} characters.`, example);
  return v.trim();
};

function readStep(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw fixable('missing_field', 'step', 'step is ONE thing to do: {"type":"command","command":"..."}, {"type":"link","url":"https://..."} or {"type":"question","text":"...","choices":["A","B"]}. Four asks are four tasks.', { type: 'command', command: 'bin/golive askpeople-api -m "..."', where: 'Terminal on the laptop, in ~/humancall' });
  if (Array.isArray(s.steps) || Array.isArray(s.commands)) throw fixable('invalid_field', 'step', 'A task is one step: send each step as its own task.', null);
  const known = { command: ['type', 'command', 'where'], link: ['type', 'url', 'text'], question: ['type', 'text', 'choices'], approve: ['type', 'text', 'approve_label', 'deny_label'], approval: ['type', 'text', 'approve_label', 'deny_label'] };
  if (!known[s.type]) throw fixable('invalid_field', 'step.type', 'step.type is "command", "link", "question" or "approve" (the person approves or denies).', 'command');
  if (s.type === 'approve' || s.type === 'approval') {   // OWNER_all_10 C, in the app's shape (APP_FOR_SERVICE 11:55)
    for (const k of Object.keys(s)) if (!known.approve.includes(k)) throw fixable('unknown_field', 'step.' + k, `"${k}" is not a field of an approve step; send text, approve_label and deny_label.`, null);
    return { type: 'approve', text: str(s.text, 'step.text', 3, 4000, 'Let the courier in through the side gate?'),
      approve_label: s.approve_label === undefined ? 'Approve' : str(s.approve_label, 'step.approve_label', 1, 30, 'Let them in'),
      deny_label: s.deny_label === undefined ? 'Deny' : str(s.deny_label, 'step.deny_label', 1, 30, 'Keep it locked') };
  }
  for (const k of Object.keys(s)) if (!known[s.type].includes(k)) throw fixable('unknown_field', 'step.' + k, `"${k}" is not a field of a ${s.type} step; send ${known[s.type].slice(1).join(', ')}.`, null);
  if (s.type === 'command') return { type: 'command', command: str(s.command, 'step.command', 1, 2000, 'bin/golive askpeople-api -m "..."'), where: s.where === undefined ? null : str(s.where, 'step.where', 1, 200, 'Terminal on the laptop') };
  if (s.type === 'link') {
    const u = str(s.url, 'step.url', 8, 2000, 'https://dash.cloudflare.com/');
    if (!/^https:\/\/[^\s]+$/.test(u)) throw fixable('invalid_field', 'step.url', 'step.url is one https address.', 'https://dash.cloudflare.com/');
    return { type: 'link', url: u, text: s.text === undefined ? null : str(s.text, 'step.text', 1, 4000, 'Open it and switch Email Routing on.') };
  }
  const text = str(s.text, 'step.text', 3, 4000, 'Which name do we use?');
  let choices = null;
  if (s.choices !== undefined) {
    if (!Array.isArray(s.choices) || s.choices.length < 2 || s.choices.length > 4 || s.choices.some(c => typeof c !== 'string' || !c.trim() || c.length > 120))
      throw fixable('invalid_field', 'step.choices', 'choices are 2 to 4 short strings (or leave them out for a typed answer).', ['Yes', 'No']);
    choices = s.choices.map(c => c.trim());
  }
  return { type: 'question', text, choices };
}

// TRUST's shape: step is {command, where} | {link, text} | {question, choices}; every string anywhere is scanned
async function boundsOpts(env) {
  return { ...(await taskTerms(env)),
    knownSecrets: ['ADMIN_TOKEN', 'TICK_TOKEN', 'ANTHROPIC_API_KEY', 'APNS_KEY_P8', 'SEAT_SECRET', 'VAPID_PRIVATE_JWK', 'TEAM_CHECK_TOKEN', 'FIXTURE_SECRET', 'POOL_TOKEN_KEY', 'PROLIFIC_TOKEN']
      .map(k => env && env[k]).filter(x => typeof x === 'string') };
}
function trustShape(task) {
  const s = task.step || {};
  const step = s.type === 'command' ? { command: s.command, ...(s.where ? { where: s.where } : {}) } : s.type === 'link' ? { link: s.url, ...(s.text ? { text: s.text } : {}) }
    : s.type === 'question' ? { question: s.text, ...(s.choices ? { choices: s.choices } : {}) } : undefined;
  return { ...task, ...(step ? { step } : {}) };
}
// The CEO's ruling (OWNER_router_2, 10:08 AM CT 15 Nov): a task placed by an operator or team key on its own principal's panel
// is the lab asking its own person; the screen written for strangers does not apply. Three checks stay: a secret's VALUE
// (SECRET_RX on the words with every web address taken out; the link field is never read by it), and the operator's own
// standing rules (operations 10:14): the two private lists, exact terms only (TRUST's checks, read on their own).
// Only operator and team keys place tasks (createTask), and only on their own panel, so this is every task today.
const URL_RX = /\bhttps?:\/\/[^\s"'<>]+/g;
function taskFields(task) {
  const s = task.step || {}, f = [['title', task.title], ['unlocks', task.unlocks], ['asker.program', task.asker && task.asker.program], ['asker.session', task.asker && task.asker.session]];
  if (s.type === 'command') f.push(['step.command', s.command], ['step.where', s.where]);
  if (s.type === 'link') f.push(['step.text', s.text]);
  if (s.type === 'question') { f.push(['step.text', s.text]); (s.choices || []).forEach((c, i) => f.push([`step.choices[${i}]`, c])); }
  return f.filter(([, v]) => typeof v === 'string' && v);
}
function standingRules(field, text, opts) {   // the two private lists only: any other finding of TRUST's bounds is not used here
  const r = taskBounds({ title: 'check', step: { command: 'true' }, note: String(text).replace(URL_RX, ' ') }, opts);
  if (r && r.ok === false && r.code === 'list_unreadable') throw notFixable(503, 'list_unreadable', [r.why, r.fix].filter(Boolean).join(' '));   // fails closed: nothing is stored
  if (r && r.ok === false && ['withheld_material', 'private_material'].includes(r.code)) throw fixable(r.code, field, [r.why, r.fix].filter(Boolean).join(' '), null, {}, 422);
}
async function bounds(task, env) {
  const opts = await boundsOpts(env);
  if (!opts.withheldTerms.length || !opts.privateTerms.length) throw notFixable(503, 'list_unreadable', 'The operator\'s lists could not be read just now, so nothing was stored. Send it again in a minute.');
  for (const [field, v] of taskFields(task)) {
    if (SECRET_RX.test(String(v).replace(URL_RX, ' '))) throw fixable('secret_in_task', field, 'Something here looks like a key or a token. Never send a key\'s value: name the file it is in.', null, {}, 422);
    standingRules(field, v, opts);
  }
  if (task.step && task.step.type === 'link') standingRules('step.url', task.step.url, opts);
}
export { bounds as ownTaskBounds };

// OWNER_router_2 item 2: a key-shaped value in a person's reply never rests in the service
const SECRET_RX_G = new RegExp(SECRET_RX.source, 'g');
function maskSecrets(v) { if (typeof v !== 'string') return { v, masked: false }; const m = v.replace(SECRET_RX_G, '[removed]'); return { v: m, masked: m !== v }; }

function out(t, request) {
  return { task_id: t.id, state: t.state, title: t.title, to: t.connection_id ? 'the person who connected this AI' : t.to_name.startsWith('mb:') ? 'the panel\'s one member' : t.to_name, urgency: t.urgency,
    step: JSON.parse(t.step_json), unlocks: t.unlocks || null, asker: { program: t.program || null, session: t.session || null },
    created_at: iso(t.created_at), rang: !!t.rang_at, reply: t.reply_json ? JSON.parse(t.reply_json) : null, url: apiBase(request) + '/v1/tasks/' + t.id,
    ...(t.state === 'withdrawn' ? { withdrawn_at: iso(t.withdrawn_at), withdraw_why: t.withdraw_why } : {}) };
}

async function panelFor(env, key, ref) {
  const rows = (await env.DB.prepare('SELECT * FROM panels WHERE principal_id = ? AND kind = \'private\' AND COALESCE(join_code_hash, \'\') NOT LIKE \'gone:%\'').bind(key.principal_id).all()).results || [];
  if (ref !== undefined) {
    const p = rows.find(r => r.id === ref || r.name === ref);
    if (!p) throw fixable('unknown_pool', 'panel', 'A task goes only to a panel of this key\'s own principal (GET /v1/panels lists them).', rows[0] ? rows[0].id : null);
    return p;
  }
  if (rows.length === 1) return rows[0];
  throw fixable('missing_field', 'panel', rows.length ? 'This key has several panels: name one in "panel".' : 'This key has no panel yet: make one with POST /v1/panels, and have your people join it.', rows[0] ? rows[0].id : null);
}

// the people a task can be for on this panel: named ones, or the one member of an unnamed panel of one
async function addressee(env, panel, to) {
  const ms = (await env.DB.prepare('SELECT id, person_name FROM members WHERE panel_id = ? AND left_at IS NULL').bind(panel.id).all()).results || [];
  const names = [...new Set(ms.map(m => m.person_name).filter(Boolean))];
  if (to !== undefined) {
    const n = String(to).trim().toLowerCase();
    if (!names.includes(n)) throw fixable('invalid_field', 'to', names.length ? `"to" is one person on this panel: ${names.map(x => `"${x}"`).join(', ')}.` : 'Nobody on this panel has a name for tasks yet; the operator names them.', names[0] || null);
    return n;
  }
  if (names.length === 1) return names[0];
  if (!names.length && ms.length === 1) return 'mb:' + ms[0].id;
  if (!ms.length) throw fixable('invalid_field', 'panel', 'Nobody has joined this panel yet: send its join link first.', null);
  throw fixable('missing_field', 'to', names.length ? `Name the one person this task is for: ${names.map(x => `"${x}"`).join(', ')}.` : 'This panel has several people and none has a name for tasks yet.', names[0] || null);
}

// The one ring of a "now" task: the person's own phone (web push or the app), when On and outside quiet hours and not rung in
// the last 30 minutes. Returns true when a ring went out.
export async function ringTask(env, t) {
  const { ringDecision } = await import('./rings.js');
  const now = nowMs();
  const ms = (await env.DB.prepare(t.to_name.startsWith('mb:') ? 'SELECT * FROM members WHERE id = ? AND left_at IS NULL' : 'SELECT * FROM members WHERE panel_id = ? AND person_name = ? AND left_at IS NULL')
    .bind(...(t.to_name.startsWith('mb:') ? [t.to_name.slice(3)] : [t.panel_id, t.to_name])).all()).results || [];
  let rang = false;
  for (const m of ms) {
    if (!ringDecision(m, now, []).ok) continue;
    let ok = false;
    if (m.push_json) { const { ringMember } = await import('./calls.js'); const r = await ringMember(env, m).catch(() => ({ ok: false })); ok = ok || !!r.ok; }
    if (m.apns_token) {
      const { apnsConfigured, sendApns, taskAlert } = await import('./apns.js');
      if (apnsConfigured(env)) {
        const payload = taskAlert({ program: t.program, taskId: t.id, sound: m.sounds !== 0 });   // OWNER_router_6: no sound for a person who chose none
        const r = await sendApns(env, { token: m.apns_token, env: m.apns_env }, payload, { expiresAt: now + 3600000, collapseId: t.id }).catch(() => ({ ok: false }));
        ok = ok || !!r.ok;
      }
    }
    if (ok) { await env.DB.prepare('UPDATE members SET last_ring_at = ? WHERE id = ?').bind(now, m.id).run(); rang = true; break; }   // ONE ring per task
  }
  if (rang) await env.DB.prepare('UPDATE tasks SET rang_at = ? WHERE id = ?').bind(now, t.id).run();
  return rang;
}

export async function createTask(env, request, key, b) {
  try { return await createTask0(env, request, key, b); }
  catch (e) { if (e && e.status >= 400 && e.status < 500 && e.status !== 401) await recordRefusal(env, key, b, e); throw e; }
}
async function createTask0(env, request, key, b) {
  if (!key || key.anon) throw fixable('unauthorized', 'Authorization', 'A task needs a key: the key whose own panel the person joined.', 'Bearer real_...', {}, 401);
  if (key.connection) return connectionTask(env, request, key, b || {});
  if (key.class !== 'real') {   // the CEO 8:56: no outsider key places a task until that offer is designed on purpose
    const pr = await env.DB.prepare('SELECT team FROM principals WHERE id = ?').bind(key.principal_id).first();
    if (!pr || pr.team !== 1 || !key.team) throw fixable('forbidden_for_key_class', 'Authorization', 'Tasks are open only to the operator\'s own keys for now; ask your people with POST /v1/calls, which is screened.', null, {}, 403);
  }
  const KNOWN = ['panel', 'to', 'title', 'step', 'unlocks', 'asker', 'urgency', 'idempotency_key'];
  for (const k of Object.keys(b || {})) if (!KNOWN.includes(k)) throw fixable('unknown_field', k, `"${k}" is not a field of a task; send ${KNOWN.join(', ')}.`, null);
  if (b.idempotency_key !== undefined) {
    const idem = str(b.idempotency_key, 'idempotency_key', 1, 128, 'task-001');
    const had = await env.DB.prepare('SELECT * FROM tasks WHERE key_id = ? AND idem = ?').bind(key.id, idem).first();
    if (had) return { status: 200, body: { ...out(had, request), repeated: true } };
  }
  const title = str(b.title, 'title', 3, 120, 'Turn On in the app');
  const step = readStep(b.step);
  const unlocks = b.unlocks === undefined ? null : str(b.unlocks, 'unlocks', 1, 300, 'The first real call can ring you.');
  const a = b.asker || {};
  if (b.asker !== undefined && (typeof a !== 'object' || Array.isArray(a))) throw fixable('invalid_field', 'asker', 'asker is {"program": "...", "session": "..."}.', { program: 'my-program', session: 'session-1' });
  const program = a.program === undefined ? null : str(a.program, 'asker.program', 1, 40, 'my-program');
  const session = a.session === undefined ? null : str(a.session, 'asker.session', 1, 80, 'session-1');
  const urgency = b.urgency === undefined ? 'today' : String(b.urgency);
  if (!URGENCY.includes(urgency)) throw fixable('invalid_field', 'urgency', 'urgency is "now" (rings once), "today" or "whenever" (the list only).', 'today');
  await bounds({ title, step, unlocks, asker: { program, session }, urgency }, env);
  const panel = await panelFor(env, key, b.panel);
  const to = await addressee(env, panel, b.to);
  const id = rid('tk_'), now = nowMs();
  await env.DB.prepare(`INSERT INTO tasks (id, principal_id, key_id, panel_id, to_name, title, step_json, unlocks, program, session, urgency, state, created_at, idem)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'open',?,?)`).bind(id, key.principal_id, key.id, panel.id, to, title, JSON.stringify(step), unlocks, program, session, urgency, now,
      b.idempotency_key === undefined ? null : String(b.idempotency_key).trim()).run();
  let t = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  if (urgency === 'now') { try { await ringTask(env, t); } catch { } t = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first(); }
  return { status: 201, body: out(t, request) };
}

// OWNER_all_10 B: a connected AI asks its own person. The size limits (readStep, str) and a key's value are checked; nothing else
// of the content is screened (the person's own AI, asking them). A lab program's connection keeps the operator's standing rules.
async function connectionTask(env, request, key, b) {
  const c = key.connection;
  if (c.blocked) throw notFixable(403, 'not_available', 'This person is not available to this AI.');
  const KNOWN = ['title', 'step', 'unlocks', 'urgency', 'idempotency_key', 'media', 'webhook'];
  for (const k of Object.keys(b)) if (!KNOWN.includes(k)) throw fixable('unknown_field', k, ['panel', 'to', 'asker'].includes(k) ? 'This key asks one person, the one who connected it, under the name they gave it: leave out panel, to and asker.' : `"${k}" is not a field of a task; send ${KNOWN.join(', ')}.`, null);
  if (b.idempotency_key !== undefined) {
    const idem = str(b.idempotency_key, 'idempotency_key', 1, 128, 'ask-001');
    const had = await env.DB.prepare('SELECT * FROM tasks WHERE key_id = ? AND idem = ?').bind(key.id, idem).first();
    if (had) return { status: 200, body: { ...out(had, request), repeated: true } };
  }
  const title = str(b.title, 'title', 3, 120, 'Someone is at the front door');
  const step = readStep(b.step);
  const unlocks = b.unlocks === undefined ? null : str(b.unlocks, 'unlocks', 1, 300, 'The door opens if you say yes.');
  const urgency = b.urgency === undefined ? 'today' : String(b.urgency);
  if (!URGENCY.includes(urgency)) throw fixable('invalid_field', 'urgency', 'urgency is "now" (first on the list, and it rings once unless the person quieted this AI), "today" or "whenever".', 'today');
  for (const [field, v] of taskFields({ title, step, unlocks })) if (SECRET_RX.test(String(v).replace(URL_RX, ' '))) throw fixable('secret_in_task', field, 'Something here looks like a key or a token. Never send a key\'s value: name the file it is in.', null, {}, 422);
  if (c.lab) await bounds({ title, step, unlocks, urgency }, env);
  const now = nowMs();
  const day = await env.DB.prepare('SELECT COUNT(*) AS n, SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) AS h FROM tasks WHERE connection_id = ? AND created_at > ?').bind(now - 3600000, c.id, now - 86400000).first();
  if (day && day.n >= 300) throw notFixable(429, 'rate_limited', 'This AI has asked 300 times today; nothing was stored. Its person reads the list tomorrow.', { retry_after_seconds: 3600 });
  if (day && day.h >= 60) throw notFixable(429, 'rate_limited', 'This AI has asked 60 times this hour; nothing was stored.', { retry_after_seconds: 600 });   // policy/CONNECTIONS.md 6
  let hook = null;
  if (b.webhook !== undefined) {
    const { webhookUrl } = await import('./own.js'); const { publicHost } = await import('./media.js');
    hook = webhookUrl(b.webhook, publicHost);
    if (!c.secret_enc) throw fixable('invalid_field', 'webhook', 'This connection has no signing secret yet: its person makes one where they connected this AI. Until then, read the reply with GET /v1/tasks/{task_id}.', null);
  }
  const here = await env.DB.prepare(c.person_name ? 'SELECT id FROM members WHERE panel_id = ? AND person_name = ? AND left_at IS NULL LIMIT 1' : 'SELECT id FROM members WHERE id = ? AND left_at IS NULL')
    .bind(...(c.person_name ? [c.panel_id, c.person_name] : [c.member_id])).first();
  if (!here) throw notFixable(403, 'not_available', 'This person is not available to this AI.');
  const id = rid('tk_');
  const attach = b.media === undefined ? null : await (await import('./own.js')).attachOwn(env, c, b.media, id, now);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO tasks (id, principal_id, key_id, panel_id, to_name, title, step_json, unlocks, program, session, urgency, state, created_at, idem, connection_id, webhook_url)
      VALUES (?,?,?,?,?,?,?,?,?,NULL,?,'open',?,?,?,?)`).bind(id, key.principal_id, key.id, c.panel_id, c.person_name || ('mb:' + c.member_id), title, JSON.stringify(step), unlocks,
      c.name, urgency, now, b.idempotency_key === undefined ? null : String(b.idempotency_key).trim(), c.id, hook),
    env.DB.prepare('UPDATE connections SET last_used_at = ? WHERE id = ?').bind(now, c.id),
    ...(attach ? [attach] : []),
  ]);
  let t = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  if (urgency === 'now' && !c.quiet) { try { await ringTask(env, t); } catch { } t = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first(); }
  return { status: 201, body: out(t, request) };
}

export async function getTask(env, request, key, id) {
  if (!key || key.anon) throw fixable('unauthorized', 'Authorization', 'A key is needed.', 'Bearer real_...', {}, 401);
  const t = await env.DB.prepare('SELECT * FROM tasks WHERE id = ? AND principal_id = ?').bind(String(id || ''), key.principal_id).first();
  if (!t) throw notFixable(404, 'not_found', 'No task of yours has that id.');
  return out(t, request);
}

export async function listTasks(env, request, key, state) {
  if (!key || key.anon) throw fixable('unauthorized', 'Authorization', 'A key is needed.', 'Bearer real_...', {}, 401);
  const rows = (await env.DB.prepare(`SELECT * FROM tasks WHERE principal_id = ? ${state === 'all' ? '' : 'AND state = \'open\''} ORDER BY created_at DESC LIMIT 200`).bind(key.principal_id).all()).results || [];
  return { tasks: rows.map(t => out(t, request)) };
}

// ---- the person's side: one list, and the reply
function forMember(m) { return m.person_name ? ['(t.to_name = ? OR t.to_name = ?)', [m.person_name, 'mb:' + m.id]] : ['t.to_name = ?', ['mb:' + m.id]]; }

export async function memberTasks(env, request, m, q) {
  const [w, args] = forMember(m);
  const open = (await env.DB.prepare(`SELECT t.* FROM tasks t WHERE t.panel_id = ? AND ${w} AND (t.state = 'open' OR (t.state = 'withdrawn' AND t.withdrawn_at > ?)) ORDER BY t.created_at DESC LIMIT 200`).bind(m.panel_id, ...args, nowMs() - 86400000).all()).results || [];
  // urgency (now, today, whenever), then newest first; a withdrawn task goes to the end of its group (OWNER_router_3)
  open.sort((x, y) => (RANK[x.urgency] - RANK[y.urgency]) || (y.created_at - x.created_at));
  const live = open.filter(t => t.state === 'open'), gone = open.filter(t => t.state === 'withdrawn');
  open.length = 0; open.push(...live);
  for (const g of gone) { let at = -1; open.forEach((t, i) => { if ((t.program || '') === (g.program || '')) at = i; }); if (at < 0) open.push(g); else open.splice(at + 1, 0, g); }
  const like = typeof q === 'string' && q.trim() ? '%' + q.trim().slice(0, 80).replace(/[%_]/g, '') + '%' : null;
  const hist = (await env.DB.prepare(`SELECT t.* FROM tasks t WHERE t.panel_id = ? AND ${w} AND t.state NOT IN ('open', 'withdrawn')
      ${like ? 'AND (t.title LIKE ? OR t.step_json LIKE ? OR t.unlocks LIKE ? OR t.program LIKE ?)' : ''} ORDER BY t.answered_at DESC LIMIT 100`)
    .bind(m.panel_id, ...args, ...(like ? [like, like, like, like] : [])).all()).results || [];
  const view = (t) => ({ task_id: t.id, title: t.title, urgency: t.urgency, from: t.program || 'one of your programs', step: JSON.parse(t.step_json), unlocks: t.unlocks || null,
    created_at: iso(t.created_at), state: t.state, reply: t.reply_json ? JSON.parse(t.reply_json) : null,
    ...(t.state === 'withdrawn' ? { withdrawn_at: iso(t.withdrawn_at), withdraw_why: t.withdraw_why } : {}),
    shell_only: JSON.parse(t.step_json).type === 'command' ? 'Only you can run this: copy the line and paste it where it says. The service cannot run it for you.' : undefined });
  const groups = [];
  for (const t of open) { const g = groups.find(x => x.from === (t.program || 'one of your programs')); if (g) g.task_ids.push(t.id); else groups.push({ from: t.program || 'one of your programs', task_ids: [t.id] }); }
  const out = { open: open.map(view), groups, history: hist.map(view) };
  const own = [...out.open, ...out.history].filter((x, i) => (i < out.open.length ? open[i] : hist[i - out.open.length]).connection_id);
  if (own.length) {
    const { ownMaterialView } = await import('./own.js'); const rows = [...open, ...hist]; const seen = {};
    for (const x of own) {
      const t = rows.find(r => r.id === x.task_id);
      const c = seen[t.connection_id] || (seen[t.connection_id] = await env.DB.prepare('SELECT id, name, icon FROM connections WHERE id = ?').bind(t.connection_id).first());
      if (c) x.connection = { id: c.id, name: c.name, icon: String(c.icon || '').startsWith('img:') ? null : (c.icon || null), ...(String(c.icon || '').startsWith('img:') ? { icon_url: apiBase(request) + '/v1/member/connections/' + c.id + '/icon' } : {}) };
      const v = await ownMaterialView(env, x.task_id); if (v) x.media = v;
    }
  }
  return out;
}

export async function memberReply(env, request, m, taskId, b) {
  const [w, args] = forMember(m);
  const t = await env.DB.prepare(`SELECT t.* FROM tasks t WHERE t.id = ? AND t.panel_id = ? AND ${w}`).bind(String(taskId || ''), m.panel_id, ...args).first();
  if (!t) throw notFixable(404, 'not_found', 'No task of yours has that id.');
  // TRUST 10:47: an answer acts once; a second answer to an answered or withdrawn task does nothing (a Refuse after a Pass
  // must never refuse a call that is already ringing)
  if (t.state !== 'open') throw notFixable(409, 'already_answered', `This task is ${t.state === 'withdrawn' ? 'withdrawn' : 'already answered'}; nothing changed.`);
  if (JSON.parse(t.step_json).type === 'review') {   // the media check: pass, refuse (with a reason), or not now
    for (const k of Object.keys(b || {})) if (!['action', 'reason', 'text'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not a field here; send action, reason and text.`, null);
    return reviewReply(env, request, m, t, JSON.parse(t.step_json), b);
  }
  for (const k of Object.keys(b || {})) if (!['action', 'choice', 'text', 'note'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not a field here; send action, choice, text and note.`, null);
  const action = b.action;
  const step = JSON.parse(t.step_json);
  const ACTIONS = step.type === 'approve' ? ['approve', 'deny', 'not_now'] : ['done', 'answer', 'not_now'];   // SPEC 8.1; OWNER_all_10 C
  if (!ACTIONS.includes(action)) throw fixable('invalid_field', 'action', `action is ${ACTIONS.map(a => '"' + a + '"').join(', ')}.`, ACTIONS[0]);
  let choice = null, text = null;
  if (action === 'answer') {
    if (b.choice !== undefined) { if (!step.choices || !step.choices.includes(b.choice)) throw fixable('invalid_field', 'choice', 'choice is one of the task\'s choices.', step.choices ? step.choices[0] : null); choice = b.choice; }
    if (b.text !== undefined) text = str(b.text, 'text', 1, 4000, 'my answer');
    if (choice === null && text === null) throw fixable('missing_field', 'choice', 'An answer is a choice or a typed line.', step.choices ? step.choices[0] : null);
  }
  let note = b.note === undefined || b.note === '' ? null : str(b.note, 'note', 1, 4000, 'Done from the laptop.');
  const mt = maskSecrets(text), mn = maskSecrets(note); text = mt.v; note = mn.v;
  const now = nowMs();
  const reply = { action, choice, text, note, at: iso(now), ...(mt.masked || mn.masked ? { masked: 'A key-shaped value was removed; save it to the file the step names.' } : {}) };
  const state = action === 'done' ? 'done' : ['answer', 'approve', 'deny'].includes(action) ? 'answered' : 'not_now';
  await env.DB.prepare('UPDATE tasks SET state = ?, reply_json = ?, answered_at = ?, answered_by = ? WHERE id = ?').bind(state, JSON.stringify(reply), now, m.id, t.id).run();
  // OWNER_all_10 C: a connected AI that named a webhook gets this answer there too (signed; app.js sends it after the reply)
  let delivery = null;
  if (t.webhook_url && t.connection_id) { const { queueAnswer } = await import('./own.js'); delivery = await queueAnswer(env, { ...t, state }).catch(() => null); }
  return { task_id: t.id, state, reply, ...(delivery ? { _delivery: delivery } : {}) };
}


// ---- the media check (the CEO, OWNER_all_8 item 3; TRUST's policy/MEDIA_REVIEW.md): an outsider's audio or video for its own
// panel is held until a person at person.tools has checked it; the check reaches that person as a task on the operator's own
// panel (meta review_panel, review_to; POST /internal/review_config). Pass opens the call; Refuse refuses it with the reason and
// deletes the piece at once; Not now leaves it on the list. The reviewer is never named to the asker or the people.
export const REVIEW_REASONS = [
  'Sexual content or nudity.',
  'A child, or anyone who may be under 18.',
  'Violence, gore, or cruelty to people or animals.',
  'Hate, or harassment of anyone.',
  'Someone\'s private information (a name with a face, an address, a phone number, a plate, a screen of messages).',
  'A scam or a pretence: it poses as a bank, a company, a government, a real person, or person.tools.',
  'Selling, or sending people elsewhere: buy, pay, download, sign up, visit, call, scan a code.',
  'Medical, legal or money advice, or political campaigning.',
  'Flashing or strobing light, or a sudden very loud or harsh sound.',
  'Someone\'s voice or image recorded or made without their agreement (a private call, a cloned voice, a face swap).',
  'It is not what the ask says it is, it changes partway, or it will not play.',
  'Something else (one line).',
];
export const REVIEW_MAX_BYTES = 20 * 1024 * 1024, REVIEW_MAX_SECONDS = 60;
export const ACCEPTED_FOR_REVIEW = 'The call is accepted: your people are rung once a person at person.tools has checked the audio or video. Read its status with the call id.';

export async function reviewConfig(env) {
  const r = (await env.DB.prepare('SELECT k, v FROM meta WHERE k IN (\'review_panel\', \'review_to\')').all()).results || [];
  const c = Object.fromEntries(r.map(x => [x.k, x.v]));
  return c.review_panel && c.review_to ? { panel: c.review_panel, to: c.review_to } : null;
}

// one task per held call; null when no reviewer is set up or the piece cannot be checked here
export async function createReviewTask(env, call, media, info) {
  const cfg = await reviewConfig(env); if (!cfg) return null;
  const pn = await env.DB.prepare('SELECT * FROM panels WHERE id = ?').bind(cfg.panel).first(); if (!pn) return null;
  if (!media || !media.id || !(media.bytes > 0) || media.bytes > REVIEW_MAX_BYTES) return null;
  const had = await env.DB.prepare('SELECT id FROM tasks WHERE panel_id = ? AND step_json LIKE ? LIMIT 1').bind(pn.id, '%"' + call.id + '"%').first();
  if (had) return had.id;
  // TRUST 10:54 AM CT: the same piece and the same ask in another held call joins the open review already waiting for it
  const ask = String(call.ask || '').slice(0, 300);
  const same = ((await env.DB.prepare('SELECT id, step_json FROM tasks WHERE panel_id = ? AND state = \'open\' AND step_json LIKE ?').bind(pn.id, '%"media_id":"' + media.id + '"%').all()).results || [])
    .find(t => { try { const s = JSON.parse(t.step_json); return s.type === 'review' && s.media_id === media.id && s.ask === ask; } catch { return false; } });
  if (same) {
    const s = JSON.parse(same.step_json); s.call_ids = [...new Set([...(Array.isArray(s.call_ids) ? s.call_ids : [s.call_id]), call.id])];
    await env.DB.prepare('UPDATE tasks SET step_json = ? WHERE id = ? AND state = \'open\'').bind(JSON.stringify(s), same.id).run();
    return same.id;
  }
  const watch = /^video\//.test(media.content_type || '') || call.kind === 'watch';
  const step = { type: 'review', call_id: call.id, media_id: media.id, kind: watch ? 'watch' : 'listen', content_type: media.content_type, seconds: media.seconds || null,
    people: call.people, asker: info.asker || 'an asker', ask: String(call.ask || '').slice(0, 300) };
  const id = rid('tk_');
  await env.DB.prepare(`INSERT INTO tasks (id, principal_id, key_id, panel_id, to_name, title, step_json, unlocks, program, session, urgency, state, created_at)
      VALUES (?,?,NULL,?,?,?,?,?,?,NULL,'today','open',?)`).bind(id, pn.principal_id, pn.id, cfg.to, watch ? 'Check this before anyone sees it' : 'Check this before anyone hears it',
      JSON.stringify(step), 'Pass opens the call for that asker\'s people; Refuse tells the asker the reason and deletes the piece.', 'person.tools check', nowMs()).run();
  return id;
}

export async function reviewStatus(env) {
  try {
    const r = await env.DB.prepare('SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM tasks WHERE state = \'open\' AND step_json LIKE \'%"type":"review"%\'').first();
    return { waiting: (r && r.n) || 0, oldest_minutes: r && r.oldest ? Math.round((nowMs() - r.oldest) / 60000) : null,
      note: 'Outsiders\' audio and video for their own panels, waiting for a person at person.tools to check them.' };
  } catch { return { waiting: 0, oldest_minutes: null }; }
}

export async function reviewMedia(env, request, m, taskId) {
  const [w, args] = forMember(m);
  const own = await env.DB.prepare(`SELECT t.id FROM tasks t WHERE t.id = ? AND t.panel_id = ? AND ${w} AND t.connection_id IS NOT NULL`).bind(String(taskId || ''), m.panel_id, ...args).first();
  if (own) { const { serveOwn } = await import('./own.js'); const r = await serveOwn(env, own.id); if (r) return r; throw notFixable(404, 'not_found', 'Nothing came with this ask, or it has been deleted on your schedule.'); }
  const t = await env.DB.prepare(`SELECT t.* FROM tasks t WHERE t.id = ? AND t.panel_id = ? AND ${w} AND t.state = 'open'`).bind(String(taskId || ''), m.panel_id, ...args).first();
  const step = t ? JSON.parse(t.step_json) : null;
  if (!step || step.type !== 'review') throw notFixable(404, 'not_found', 'No piece to check here.');
  const { serveMedia } = await import('./seats.js');
  const r = await serveMedia(env, request, step.media_id);
  const h = new Headers(r.headers); h.set('Cache-Control', 'no-store'); h.set('Content-Disposition', 'inline');   // played in our page only, never kept
  return new Response(r.body, { status: r.status, headers: h });
}

async function reviewReply(env, request, m, t, step, b) {
  const action = b.action;
  if (!['pass', 'refuse', 'not_now'].includes(action)) throw fixable('invalid_field', 'action', 'action is "pass", "refuse" or "not_now".', 'pass');
  const now = nowMs();
  if (action === 'not_now') return { task_id: t.id, state: 'open', note: 'It stays on your list.' };
  const { releaseHeld, refuseHeld } = await import('./calls.js');
  const ids = Array.isArray(step.call_ids) && step.call_ids.length ? step.call_ids : [step.call_id];   // every held call waiting on this piece
  const each = async (fn) => { let n = 0; for (const id of ids) { try { await fn(id); n++; } catch (e) { if (!(e && e.body && e.body.code === 'not_held')) throw e; } } return n; };   // a call the asker closed meanwhile is skipped
  let reply;
  if (action === 'pass') {
    await each((id) => releaseHeld(env, request, id));
    reply = { action: 'answer', choice: 'Pass', text: null, note: null, at: iso(now) };
  } else {
    const n = Number(b.reason);
    if (!(Number.isInteger(n) && n >= 1 && n <= REVIEW_REASONS.length)) throw fixable('invalid_field', 'reason', `reason is the number of one of the ${REVIEW_REASONS.length} reasons.`, 1);
    const other = n === REVIEW_REASONS.length ? str(b.text, 'text', 3, 200, 'It names a real shop and its prices.') : null;
    const why = n === REVIEW_REASONS.length ? other : REVIEW_REASONS[n - 1];
    await each((id) => refuseHeld(env, id, `Refused after a person at person.tools checked the ${step.kind === 'watch' ? 'video' : 'audio'}: ${why}`));
    try {   // the piece is deleted at once (MEDIA_REVIEW.md), unless an open or held call still uses it (TRUST 10:54: never mid-play)
      const inUse = await env.DB.prepare('SELECT id FROM calls WHERE status IN (\'open\', \'held\') AND spec_json LIKE ? LIMIT 1').bind('%"' + step.media_id + '"%').first();
      const md = inUse ? null : await env.DB.prepare('SELECT * FROM media WHERE id = ?').bind(step.media_id).first();
      if (md) { await env.MEDIA.delete(md.r2_key); await env.DB.prepare('DELETE FROM media WHERE id = ?').bind(md.id).run(); }
    } catch (e) { console.log('review delete', step.media_id, String(e && e.message || e)); }
    reply = { action: 'answer', choice: 'Refuse', text: why, note: null, at: iso(now) };
  }
  await env.DB.prepare('UPDATE tasks SET state = \'answered\', reply_json = ?, answered_at = ?, answered_by = ? WHERE id = ?').bind(JSON.stringify(reply), now, m.id, t.id).run();
  return { task_id: t.id, state: 'answered', reply };
}

// OWNER_router_3: withdraw an open task (the placing key's principal, or the operator). Shown struck through for a day, then gone.
export async function withdrawTask(env, request, key, id, b, admin = false) {
  if (!admin && (!key || key.anon)) throw fixable('unauthorized', 'Authorization', 'A key is needed.', 'Bearer real_...', {}, 401);
  const t = await env.DB.prepare(admin ? 'SELECT * FROM tasks WHERE id = ?' : 'SELECT * FROM tasks WHERE id = ? AND principal_id = ?').bind(...(admin ? [String(id || '')] : [String(id || ''), key.principal_id])).first();
  if (!t) throw notFixable(404, 'not_found', 'No task of yours has that id.');   // another principal's task answers the same (TRUST 10:17)
  for (const k of Object.keys(b || {})) if (k !== 'why') throw fixable('unknown_field', k, `"${k}" is not a field here; send why.`, null);
  const why = str(b && b.why, 'why', 3, 200, 'Not needed any more: the step was done another way.');
  if (SECRET_RX.test(why.replace(URL_RX, ' '))) throw fixable('secret_in_task', 'why', 'Something here looks like a key or a token. Never send a key\'s value.', null, {}, 422);
  if (t.state === 'withdrawn') return out(t, request);   // idempotent
  if (t.state !== 'open') throw notFixable(409, 'already_answered', `This task was already answered (${t.state}); it stays as it is.`);
  await env.DB.prepare('UPDATE tasks SET state = \'withdrawn\', withdrawn_at = ?, withdraw_why = ? WHERE id = ? AND state = \'open\'').bind(nowMs(), why, t.id).run();
  return out(await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(t.id).first(), request);
}

// OWNER_router_1 item 4: every refused task, for the operator (GET /internal/task_refusals?hours=24). Never a matched secret.
export async function recordRefusal(env, key, b, err) {
  try {
    const a = (b && typeof b.asker === 'object' && b.asker) || {};
    const clip = (v, n) => typeof v === 'string' ? maskSecrets(v.slice(0, n)).v : null;
    const e = (err && err.body) || {};
    await env.DB.prepare('INSERT INTO task_refusals (id, principal_id, program, session, title, rule, field, message, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(rid('tr_'), key && !key.anon ? key.principal_id : null, clip(a.program, 40), clip(a.session, 80), clip(b && b.title, 120), e.code || 'error', e.field || null, clip(e.message, 300), nowMs()).run();
  } catch { }
}
export async function taskRefusals(env, hours) {
  const h = Math.max(1, Math.min(24 * 30, Number(hours) || 24));
  const rows = (await env.DB.prepare('SELECT * FROM task_refusals WHERE created_at > ? ORDER BY created_at DESC LIMIT 500').bind(nowMs() - h * 3600000).all()).results || [];
  return { hours: h, refusals: rows.map(r => ({ at: iso(r.created_at), program: r.program, session: r.session, title: r.title, rule: r.rule, field: r.field, message: r.message })) };
}
