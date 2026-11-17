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
import * as TBX from './screening/task_bounds.js';   // TRUST 6:47 PM CT 15 Nov: keyShapeIn / maskKeyShapes (1.3.0), when the copy has them
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
  const known = { command: ['type', 'command', 'where'], link: ['type', 'url', 'text'], question: ['type', 'text', 'choices', 'line_for', 'keyboard'], call: ['type', 'contact', 'text'], approve: ['type', 'text', 'approve_label', 'deny_label', 'editable'], approval: ['type', 'text', 'approve_label', 'deny_label', 'editable'] };
  if (!known[s.type]) throw fixable('invalid_field', 'step.type', 'step.type is "command", "link", "question" or "approve" (the person approves or denies).', 'command');
  if (s.type === 'approve' || s.type === 'approval') {   // OWNER_all_10 C, in the app's shape (APP_FOR_SERVICE 11:55)
    for (const k of Object.keys(s)) if (!known.approve.includes(k)) throw fixable('unknown_field', 'step.' + k, `"${k}" is not a field of an approve step; send text, approve_label and deny_label.`, null);
    return { type: 'approve', text: str(s.text, 'step.text', 3, 4000, 'Let the courier in through the side gate?'),
      approve_label: s.approve_label === undefined ? 'Approve' : str(s.approve_label, 'step.approve_label', 1, 30, 'Let them in'),
      deny_label: s.deny_label === undefined ? 'Deny' : str(s.deny_label, 'step.deny_label', 1, 30, 'Keep it locked'),
      ...(s.editable !== undefined ? (() => { if (typeof s.editable !== 'boolean') throw fixable('invalid_field', 'step.editable', 'editable is true or false: may the person edit the text before approving it?', true); return s.editable ? { editable: true } : {}; })() : {}) };
  }
  for (const k of Object.keys(s)) if (!known[s.type].includes(k)) throw fixable('unknown_field', 'step.' + k, `"${k}" is not a field of a ${s.type} step; send ${known[s.type].slice(1).join(', ')}.`, null);
  if (s.type === 'command') return { type: 'command', command: str(s.command, 'step.command', 1, 2000, 'bin/golive askpeople-api -m "..."'), where: s.where === undefined ? null : str(s.where, 'step.where', 1, 200, 'Terminal on the laptop') };
  if (s.type === 'call') {   // OWNER_router_29 (27.6): a contact of the ask to ring, from the person's own phone; nothing is dialled by the service
    if (typeof s.contact !== 'string' || !/^c[1-4]$/.test(s.contact)) throw fixable('invalid_field', 'step.contact', 'contact names one of the ask\'s contacts: c1 to c4.', 'c1');
    return { type: 'call', contact: s.contact, text: str(s.text, 'step.text', 3, 4000, 'Call back about the trade-in.') };
  }
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
  // OWNER_router_26 item 7 (C5): a choice that takes a line ({"Other hours": "Your hours that day"}), and the keyboard for every line
  let line_for = null, keyboard = null;
  if (s.line_for !== undefined) {
    if (!choices) throw fixable('invalid_field', 'step.line_for', 'line_for maps one of the choices to the label of its line, so it needs choices.', null);
    if (!s.line_for || typeof s.line_for !== 'object' || Array.isArray(s.line_for) || !Object.keys(s.line_for).length) throw fixable('invalid_field', 'step.line_for', 'line_for is {"<one of the choices>": "<the line\'s label>"}.', { [choices[choices.length - 1]]: 'Your hours that day' });
    line_for = {};
    for (const [k, v] of Object.entries(s.line_for)) {
      if (!choices.includes(String(k).trim())) throw fixable('invalid_field', 'step.line_for', `"${String(k).slice(0, 40)}" is not one of the choices.`, { [choices[choices.length - 1]]: 'Your hours that day' });
      line_for[String(k).trim()] = str(v, 'step.line_for', 1, 80, 'Your hours that day');
    }
  }
  if (s.keyboard !== undefined) { if (!KEYBOARDS.includes(s.keyboard)) throw fixable('invalid_field', 'step.keyboard', `keyboard is ${KEYBOARDS.join(', ')}.`, 'text'); keyboard = s.keyboard; }
  return { type: 'question', text, choices, ...(line_for ? { line_for } : {}), ...(keyboard ? { keyboard } : {}) };
}
const KEYBOARDS = ['text', 'number', 'phone', 'email'];
// ASKS-15: the line's form, by its keyboard
function keyboardForm(kb, text) {
  const t = String(text).trim();
  if (kb === 'phone' && !(/^[+()\-\s\d]+$/.test(t) && (t.match(/\d/g) || []).length >= 7 && (t.match(/\d/g) || []).length <= 15)) throw fixable('invalid_field', 'text', 'This line takes a phone number: 7 to 15 digits, with +, spaces, brackets and hyphens.', '+1 312 555 0100');
  if (kb === 'number' && !/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$|^[+-]?\.\d+$/.test(t)) throw fixable('invalid_field', 'text', 'This line takes a number.', '42');
  if (kb === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) throw fixable('invalid_field', 'text', 'This line takes an email address.', 'name@example.com');
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
    : s.type === 'question' ? { question: s.text, ...(s.choices ? { choices: s.choices } : {}) } : s.type === 'call' ? { question: s.text } : undefined;
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
  if (s.type === 'link' || s.type === 'call') f.push(['step.text', s.text]);
  if (s.type === 'question') { f.push(['step.text', s.text]); (s.choices || []).forEach((c, i) => f.push([`step.choices[${i}]`, c])); Object.values(s.line_for || {}).forEach((v) => f.push(['step.line_for', v])); }
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
function maskSecrets(v) { if (typeof v !== 'string') return { v, masked: false }; let m = v.replace(SECRET_RX_G, '[removed]'); if (typeof TBX.maskKeyShapes === 'function') m = TBX.maskKeyShapes(m); return { v: m, masked: m !== v }; }
// TRUST 6:47: what a key-shaped value in these words looks like (card processors' live keys, AWS, GitHub, Slack, Google keys and more),
// or null; web addresses are taken out first (a long link path is not a key)
function keyShape(v) { const t = String(v == null ? '' : v).replace(URL_RX, ' '); if (typeof TBX.keyShapeIn === 'function') { const w = TBX.keyShapeIn(t); if (w) return w; } return SECRET_RX.test(t) ? 'a key or a token' : null; }

function out(t, request, brand) {
  const firstTo = t.orig_to_name || t.to_name;   // OWNER_router_18 item 7: a passed ask still reads as sent to its first addressee
  return { task_id: t.id, state: t.state, title: t.title, to: t.connection_id ? 'the person who connected this AI' : firstTo.startsWith('mb:') ? 'the panel\'s one member' : firstTo, urgency: t.urgency,
    step: JSON.parse(t.step_json), unlocks: t.unlocks || null, asker: { program: t.program || null, session: t.session || null },
    created_at: iso(t.created_at), rang: !!t.rang_at, reply: t.reply_json ? JSON.parse(t.reply_json) : null, url: apiBase(request) + '/v1/tasks/' + t.id,
    card: t.card_json ? JSON.parse(t.card_json) : null, contacts: t.contacts_json ? JSON.parse(t.contacts_json) : null, group: t.group_name || null, key: t.idem || null, ...(t.elsewhere ? { elsewhere: true } : {}), webhook: t.webhook_url || null,   // OWNER_router_26 item 21: what was sent, null when not
    ...(brand !== undefined ? { brand } : {}),
    notes: t.notes_json ? JSON.parse(t.notes_json).filter(n => !n.private) : [], expires_at: iso(t.expires_at || (t.created_at + 30 * 86400000)), ...(t.lapsed_at ? { lapsed_at: iso(t.lapsed_at) } : {}),
    ...(t.state === 'withdrawn' ? { withdrawn_at: iso(t.withdrawn_at), withdraw_why: t.withdraw_why } : {}) };
}

// the brand an asker's asks wear, as the asker reads it (item 21): {id, name}, or null
async function askerBrand(env, principalId) {
  const r = await env.DB.prepare('SELECT brand_json, brand_id FROM brands WHERE principal_id = ?').bind(principalId).first();
  if (!r) return null; try { return { id: r.brand_id || null, name: JSON.parse(r.brand_json).name || null }; } catch { return null; }
}

// OWNER_router_31 item 1 (27.8): a group of asks from one key to one person; question steps only; at most six open at once
async function readGroup(env, b, step, keyId, panelId, to) {
  if (b.group === undefined || b.group === null) return null;
  if (typeof b.group !== 'string' || !/^[A-Za-z0-9:_-]{1,80}$/.test(b.group)) throw fixable('invalid_field', 'group', 'group is 1 to 80 letters, digits, colons, underscores and hyphens, the same for each ask about one thing.', 'holiday:2026-12-24', {}, 400);
  if (step.type !== 'question') throw fixable('invalid_field', 'group', 'Only a question joins a group: an approval, a link, a command or a call stands on a card of its own.', null, {}, 400);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM tasks WHERE key_id = ? AND group_name = ? AND panel_id = ? AND to_name = ? AND state = 'open'").bind(keyId, b.group, panelId, to).first();
  if (n && n.n >= 6) throw fixable('group_full', 'group', 'This group has six open asks; wait for one to close, or start another group.', null, {}, 400);
  return b.group;
}

async function panelFor(env, key, ref) {
  let rows = (await env.DB.prepare('SELECT * FROM panels WHERE principal_id = ? AND kind = \'private\' AND COALESCE(join_code_hash, \'\') NOT LIKE \'gone:%\'').bind(key.principal_id).all()).results || [];
  { const { isPeoplePanel } = await import('./panels.js'); const keep = []; for (const r of rows) if (!(await isPeoplePanel(env, r))) keep.push(r); rows = keep; }   // TRUST 6:56 PM CT 15 Nov: no task to a person's people panel
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
  // OWNER_router_31 (ASKS-22): one alert for a group's asks placed within a minute of each other
  if (t.group_name && t.key_id && await env.DB.prepare('SELECT 1 AS x FROM tasks WHERE key_id = ? AND group_name = ? AND panel_id = ? AND to_name = ? AND id != ? AND rang_at IS NOT NULL AND rang_at >= ? LIMIT 1').bind(t.key_id, t.group_name, t.panel_id, t.to_name, t.id, now - 60000).first()) return false;
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
        const payload = taskAlert({ program: t.program, taskId: t.id, sound: m.sounds !== 0, step: (() => { try { return JSON.parse(t.step_json || '{}'); } catch { return null; } })() });   // OWNER_router_30: YESNO or TASK   // OWNER_router_6: no sound for a person who chose none
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
  const KNOWN = ['panel', 'to', 'title', 'step', 'unlocks', 'asker', 'urgency', 'idempotency_key', 'card', 'expires_in', 'contacts', 'group'];
  for (const k of Object.keys(b || {})) if (!KNOWN.includes(k)) throw fixable('unknown_field', k, `"${k}" is not a field of a task; send ${KNOWN.join(', ')}.`, null);
  if (b.idempotency_key !== undefined) {
    const idem = str(b.idempotency_key, 'idempotency_key', 1, 128, 'task-001');
    const had = await env.DB.prepare('SELECT * FROM tasks WHERE key_id = ? AND idem = ?').bind(key.id, idem).first();
    if (had) return { status: 200, body: { ...out(had, request, await askerBrand(env, had.brand_principal_id || had.principal_id)), repeated: true } };
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
  await notUs({ title, step, unlocks });   // OWNER_router_11 item 1
  const card = await cardFor(env, key, b.card, true, null, step);   // OWNER_router_9
  const contacts = (await import('./contacts.js')).askContacts(b.contacts, { title, step, card, unlocks }, nowMs());   // OWNER_router_29
  const bkey = await (await import('./cards.js')).brandByKey(env, request), brandPr = bkey ? bkey.pr : null;   // OWNER_router_31 (ASKS-9)
  const panel = await panelFor(env, key, b.panel);
  const to = await addressee(env, panel, b.to);
  { const { blocked } = await import('./blocks.js');   // OWNER_router_4 item 1: the asker hears only "not available"
    const ids = to.startsWith('mb:') ? [to.slice(3)] : ((await env.DB.prepare('SELECT id FROM members WHERE panel_id = ? AND person_name = ? AND left_at IS NULL').bind(panel.id, to).all()).results || []).map(r => r.id);
    if (await blocked(env, key.principal_id, ids)) throw notFixable(403, 'not_available', 'This person is not available.');
    if (bkey && !bkey.proved && ids.length && (await env.DB.prepare(`SELECT COUNT(*) AS n FROM members WHERE id IN (${ids.map(() => '?').join(',')}) AND is_real != 0`).bind(...ids).first()).n) throw notFixable(400, 'brand_not_proved', 'A brand that has not proved its domain reaches test members only; nothing was stored.'); }   // OWNER_router_32
  const group = await readGroup(env, b, step, key.id, panel.id, to);   // OWNER_router_31
  const id = rid('tk_'), now = nowMs();
  await env.DB.prepare(`INSERT INTO tasks (id, principal_id, key_id, panel_id, to_name, title, step_json, unlocks, program, session, urgency, state, created_at, idem, card_json, expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'open',?,?,?,?)`).bind(id, key.principal_id, key.id, panel.id, to, title, JSON.stringify(step), unlocks, program, session, urgency, now,
      b.idempotency_key === undefined ? null : String(b.idempotency_key).trim(), card ? JSON.stringify(card) : null, now + expiresIn(b) * 1000).run();
  if (contacts) await env.DB.prepare('UPDATE tasks SET contacts_json = ? WHERE id = ?').bind(JSON.stringify(contacts), id).run();
  if (group) await env.DB.prepare('UPDATE tasks SET group_name = ? WHERE id = ?').bind(group, id).run();
  if (brandPr) await env.DB.prepare('UPDATE tasks SET brand_principal_id = ? WHERE id = ?').bind(brandPr, id).run();
  let t = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  if (urgency === 'now') { try { await ringTask(env, t); } catch { } t = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first(); }
  return { status: 201, body: out(t, request, await askerBrand(env, t.brand_principal_id || t.principal_id)) };
}

// OWNER_router_11 item 1: no asker's text may claim to be us (title, step text, labels, choices, unlocks; cards in cardFor)
// TRUST 2:38 PM CT 16 Nov: a direction override or isolate makes words read differently from what was written; no honest use in an ask
const BIDI_RX = /[\u202A-\u202E\u2066-\u2069]/;
function noBidi(field, v) { if (typeof v === 'string' && BIDI_RX.test(v)) throw fixable('invalid_field', field, `${field} has a direction-control character (U+202A to U+202E or U+2066 to U+2069), which makes words read differently from what was written. Send the words without it.`, null); }
async function notUs(task) {
  const { claimsUs } = await import('./cards.js'); const s = task.step || {};
  for (const [field, v] of [['title', task.title], ['unlocks', task.unlocks], ['step.text', s.text], ['step.where', s.where], ['step.command', s.command], ['step.url', s.url], ['step.approve_label', s.approve_label], ['step.deny_label', s.deny_label], ...((s.choices || []).map((c, i) => [`step.choices[${i}]`, c])), ...Object.values(s.line_for || {}).map((v) => ['step.line_for', v])]) noBidi(field, v);
  { const { refuseReserved } = await import('./cards.js');   // OWNER_router_26 item 4
    for (const [field, v] of [['step.approve_label', s.approve_label], ['step.deny_label', s.deny_label], ...((s.choices || []).map((c, i) => [`step.choices[${i}]`, c]))]) if (typeof v === 'string' && v) await refuseReserved(field, v); }
  const f = [['title', task.title], ['unlocks', task.unlocks], ['step.text', s.text], ['step.where', s.where], ['step.approve_label', s.approve_label], ['step.deny_label', s.deny_label],
    ...((s.choices || []).map((c, i) => [`step.choices[${i}]`, c]))].filter(([, v]) => typeof v === 'string' && v);
  for (const [field, v] of f) if (await claimsUs(v)) throw fixable('claims_to_be_us', field, `"${String(v).slice(0, 60)}" reads as person.tools speaking (a check, a verification or our own controls): only the person's app draws those.`, null, {}, 422);
}
// OWNER_router_9: a card's blocks, checked (cards.js), and every word in them passes what the task's own words pass: a key's value
// never, and for the operator's own keys the two standing rules
async function cardFor(env, key, raw, standing, ownConnection, step) {
  if (raw === undefined || raw === null) return null;
  const { readCard, textOf } = await import('./cards.js');
  const card = await readCard(env, key, raw, { own: ownConnection });
  const opts = standing ? await boundsOpts(env) : null;
  for (const w of textOf(card)) {
    noBidi('card', w);
    if (keyShape(w)) throw fixable('secret_in_task', 'card', 'Something in the card looks like a key or a token. Never send a key\'s value.', null, {}, 400);
    if (opts) standingRules('card', w, opts);
  }
  { const { cardFitsStep } = await import('./cards.js'); cardFitsStep(card, step); }   // OWNER_router_26 item 5
  return card;
}

// OWNER_all_10 B: a connected AI asks its own person. The size limits (readStep, str) and a key's value are checked; nothing else
// of the content is screened (the person's own AI, asking them). A lab program's connection keeps the operator's standing rules.
async function connectionTask(env, request, key, b) {
  const c = key.connection;
  if (c.blocked) throw notFixable(403, 'not_available', 'This person is not available to this AI.');
  { const { blocked } = await import('./blocks.js'); if (await blocked(env, key.principal_id, [c.member_id])) throw notFixable(403, 'not_available', 'This person is not available to this AI.'); }
  const KNOWN = ['title', 'step', 'unlocks', 'urgency', 'idempotency_key', 'media', 'webhook', 'card', 'expires_in', 'contacts', 'group'];
  for (const k of Object.keys(b)) if (!KNOWN.includes(k)) throw fixable('unknown_field', k, ['panel', 'to', 'asker'].includes(k) ? 'This key asks one person, the one who connected it, under the name they gave it: leave out panel, to and asker.' : `"${k}" is not a field of a task; send ${KNOWN.join(', ')}.`, null);
  if (b.idempotency_key !== undefined) {
    const idem = str(b.idempotency_key, 'idempotency_key', 1, 128, 'ask-001');
    const had = await env.DB.prepare('SELECT * FROM tasks WHERE key_id = ? AND idem = ?').bind(key.id, idem).first();
    if (had) return { status: 200, body: { ...out(had, request, await askerBrand(env, had.brand_principal_id || had.principal_id)), repeated: true } };
  }
  const title = str(b.title, 'title', 3, 120, 'Someone is at the front door');
  const step = readStep(b.step);
  const unlocks = b.unlocks === undefined ? null : str(b.unlocks, 'unlocks', 1, 300, 'The door opens if you say yes.');
  const urgency = b.urgency === undefined ? 'today' : String(b.urgency);
  if (!URGENCY.includes(urgency)) throw fixable('invalid_field', 'urgency', 'urgency is "now" (first on the list, and it rings once unless the person quieted this AI), "today" or "whenever".', 'today');
  const { allowedUrgencies } = await import('./connections.js'); const allowed = allowedUrgencies(c);   // operations 12:25: a connection may be limited
  if (!allowed.includes(urgency)) throw fixable('invalid_field', 'urgency', `This person takes ${allowed.map(x => '"' + x + '"').join(' or ')} from this AI.`, allowed[0], { allowed }, 400);
  for (const [field, v] of [...taskFields({ title, step, unlocks }), ...(step.type === 'approve' ? [['step.text', step.text]] : [])]) if (keyShape(v)) throw fixable('secret_in_task', field, 'Something here looks like a key or a token. Never send a key\'s value: name the file it is in.', null, {}, 422);
  await notUs({ title, step, unlocks });   // OWNER_router_11 item 1
  if (c.lab) await bounds({ title, step, unlocks, urgency }, env);
  const card = await cardFor(env, key, b.card, !!c.lab, c.id, step);   // OWNER_router_9
  const contacts = (await import('./contacts.js')).askContacts(b.contacts, { title, step, card, unlocks }, nowMs());   // OWNER_router_29
  const bkey = await (await import('./cards.js')).brandByKey(env, request);   // OWNER_router_31: Brand-Key, else the brand it was connected from
  if (bkey && !bkey.proved) { const mm = await env.DB.prepare('SELECT is_real FROM members WHERE id = ?').bind(c.member_id).first(); if (!mm || Number(mm.is_real) !== 0) throw notFixable(400, 'brand_not_proved', 'A brand that has not proved its domain reaches test members only; nothing was stored.'); }   // OWNER_router_32
  const brandPr = (bkey && bkey.pr) || c.brand_principal_id || null;
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
  const group = await readGroup(env, b, step, key.id, c.panel_id, c.person_name || ('mb:' + c.member_id));   // OWNER_router_31
  const id = rid('tk_');
  const attach = b.media === undefined ? null : await (await import('./own.js')).attachOwn(env, c, b.media, id, now);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO tasks (id, principal_id, key_id, panel_id, to_name, title, step_json, unlocks, program, session, urgency, state, created_at, idem, connection_id, webhook_url, card_json, expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,NULL,?,'open',?,?,?,?,?,?)`).bind(id, key.principal_id, key.id, c.panel_id, c.person_name || ('mb:' + c.member_id), title, JSON.stringify(step), unlocks,
      c.name, urgency, now, b.idempotency_key === undefined ? null : String(b.idempotency_key).trim(), c.id, hook, card ? JSON.stringify(card) : null, now + expiresIn(b) * 1000),
    ...(contacts ? [env.DB.prepare('UPDATE tasks SET contacts_json = ? WHERE id = ?').bind(JSON.stringify(contacts), id)] : []),
    ...(group ? [env.DB.prepare('UPDATE tasks SET group_name = ? WHERE id = ?').bind(group, id)] : []),
    ...(brandPr ? [env.DB.prepare('UPDATE tasks SET brand_principal_id = ? WHERE id = ?').bind(brandPr, id)] : []),
    env.DB.prepare('UPDATE connections SET last_used_at = ? WHERE id = ?').bind(now, c.id),
    ...(attach ? [attach] : []),
  ]);
  let t = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  if (urgency === 'now' && !c.quiet) { try { await ringTask(env, t); } catch { } t = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first(); }
  return { status: 201, body: out(t, request, await askerBrand(env, t.brand_principal_id || t.principal_id)) };
}

// a note on a task, in order (operations 1:00 PM CT); masked like a reply; at most 50 per task
async function addNote(env, taskId, note, by, extra = {}) {
  const row = await env.DB.prepare('SELECT notes_json FROM tasks WHERE id = ?').bind(taskId).first();
  const notes = row && row.notes_json ? JSON.parse(row.notes_json) : [];
  if (notes.length >= 50) throw fixable('invalid_field', 'note', 'This task has 50 notes; answer it, or start a new one.', null, {}, 422);
  notes.push({ at: iso(nowMs()), note, by, ...extra });   // extra: the name drawn for a person sender or passer; private between a passer and a receiver
  await env.DB.prepare('UPDATE tasks SET notes_json = ? WHERE id = ?').bind(JSON.stringify(notes), taskId).run();
  return notes;
}
export async function askerNote(env, request, key, id, b) {
  if (!key || key.anon) throw fixable('unauthorized', 'Authorization', 'A key is needed.', 'Bearer real_...', {}, 401);
  const t = await env.DB.prepare('SELECT * FROM tasks WHERE id = ? AND principal_id = ?').bind(String(id || ''), key.principal_id).first();
  if (!t) throw notFixable(404, 'not_found', 'No task of yours has that id.');
  if (t.state !== 'open') throw notFixable(409, 'already_answered', 'This task is no longer open.');
  for (const k of Object.keys(b || {})) if (k !== 'note') throw fixable('unknown_field', k, 'Send {"note": "..."}.', null);
  const v = str(b && b.note, 'note', 1, 500, 'Thanks: changed.');
  if (/[\r\n]/.test(v)) throw fixable('invalid_field', 'note', 'An asker\'s note is one line.', 'Thanks: changed.');
  const mm = maskSecrets(v);
  return { task_id: t.id, notes: (await addNote(env, t.id, mm.v, 'asker')).filter(n => !n.private) };
}

// OWNER_router_15: the ask's life is the asker's choice: expires_in seconds, 60 to 30 days (30 days when not given)
function expiresIn(b) {
  if (b.expires_in === undefined) return 2592000;
  if (!Number.isInteger(b.expires_in) || b.expires_in < 60 || b.expires_in > 2592000) throw fixable('invalid_field', 'expires_in', 'expires_in is how long the ask stays open, in seconds: 60 to 2,592,000 (30 days). When it passes, you are told it lapsed; it is never answered for them.', 600);
  return b.expires_in;
}
// an open ask past its time lapses now (as retention does each minute): never a default answer; the webhook says lapsed
export async function lapseNow(env, t) {
  const r = await env.DB.prepare('UPDATE tasks SET state = \'lapsed\', lapsed_at = ? WHERE id = ? AND state = \'open\'').bind(nowMs(), t.id).run();
  if (r.meta.changes === 1 && t.contacts_json) { try { await (await import('./contacts.js')).stripClosed(env, t.id); } catch { } }
  if (r.meta.changes === 1 && t.webhook_url && t.connection_id) { try { const { queueAnswer } = await import('./own.js'); await queueAnswer(env, { ...t, state: 'lapsed' }); } catch { } }
}

export async function getTask(env, request, key, id) {
  if (!key || key.anon) throw fixable('unauthorized', 'Authorization', 'A key is needed.', 'Bearer real_...', {}, 401);
  let t = await env.DB.prepare('SELECT * FROM tasks WHERE id = ? AND principal_id = ?').bind(String(id || ''), key.principal_id).first();
  if (!t) throw notFixable(404, 'not_found', 'No task of yours has that id.');
  if (t.state === 'open' && (t.expires_at || t.created_at + 2592000000) < nowMs()) { await lapseNow(env, t); t = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(t.id).first(); }
  return out(t, request, await askerBrand(env, t.brand_principal_id || t.principal_id));
}

export async function listTasks(env, request, key, state) {
  if (!key || key.anon) throw fixable('unauthorized', 'Authorization', 'A key is needed.', 'Bearer real_...', {}, 401);
  const rows = (await env.DB.prepare(`SELECT * FROM tasks WHERE principal_id = ? ${state === 'all' ? '' : 'AND state = \'open\''} ORDER BY created_at DESC LIMIT 200`).bind(key.principal_id).all()).results || [];
  const brands = new Map(); for (const t of rows) { const bp = t.brand_principal_id || t.principal_id; if (!brands.has(bp)) brands.set(bp, await askerBrand(env, bp)); }
  return { tasks: rows.map(t => out(t, request, brands.get(t.brand_principal_id || t.principal_id))) };
}

// ---- the person's side: one list, and the reply
function forMember(m) { return m.person_name ? ['(t.to_name = ? OR t.to_name = ?)', [m.person_name, 'mb:' + m.id]] : ['t.to_name = ?', ['mb:' + m.id]]; }

// WEB 4:07: history is the last 50 by default; ?history=N asks for up to 200
function histLimit(request) { try { const v = new URL(request.url).searchParams.get('history'); if (v === null || v === '') return 50; const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 200 ? n : 50; } catch { return 50; } }   // WEB 4:21: no parameter is 50, not 0
export async function memberTasks(env, request, m, q) {
  const [w, args] = forMember(m);
  // WEB 12:36 PM CT 16 Nov: every read the list needs goes in ONE round trip (each one costs ~0.12 s from the function to the database):
  // the open asks, the history, the askers' brands, the person's AIs, their photos and clips, and the deck's own reads (people.js)
  const P = await import('./people.js'), now0 = nowMs();
  const like = typeof q === 'string' && q.trim() ? '%' + q.trim().slice(0, 80).replace(/[%_]/g, '') + '%' : null;
  const mine = `t.panel_id = ? AND ${w}`, mineArgs = [m.panel_id, ...args];
  const rs = ((await env.DB.batch([
    env.DB.prepare(`SELECT t.* FROM tasks t WHERE ${mine} AND COALESCE(t.hold_until, 0) <= ? AND ((t.state = 'open' AND COALESCE(t.expires_at, t.created_at + 2592000000) > ?) OR (t.state = 'withdrawn' AND t.withdrawn_at > ? AND COALESCE(t.elsewhere, 0) = 0)) ORDER BY t.created_at DESC LIMIT 200`)
      .bind(...mineArgs, now0, now0, now0 - 86400000),
    env.DB.prepare(`SELECT t.* FROM tasks t WHERE ${mine} AND (t.state NOT IN ('open', 'withdrawn', 'lapsed') OR (t.state = 'withdrawn' AND t.elsewhere = 1))
      ${like ? 'AND (t.title LIKE ? OR t.step_json LIKE ? OR t.unlocks LIKE ? OR t.program LIKE ?)' : ''} ORDER BY COALESCE(t.answered_at, t.withdrawn_at) DESC LIMIT ?`)
      .bind(...mineArgs, ...(like ? [like, like, like, like] : []), histLimit(request)),
    env.DB.prepare(`SELECT DISTINCT b.principal_id, b.brand_json, b.domain, b.verified_at, b.brand_id FROM brands b JOIN tasks t ON b.principal_id = COALESCE(t.brand_principal_id, t.principal_id) WHERE ${mine}`).bind(...mineArgs),
    env.DB.prepare(`SELECT DISTINCT c.id, c.name, c.icon FROM connections c JOIN tasks t ON t.connection_id = c.id WHERE ${mine}`).bind(...mineArgs),
    env.DB.prepare(`SELECT o.task_id, o.content_type, o.bytes, o.seconds, o.delete_at FROM own_material o JOIN tasks t ON t.id = o.task_id WHERE ${mine}`).bind(...mineArgs),
    ...P.deckStatements(env, m),
    env.DB.prepare("SELECT 1 AS own FROM panels WHERE id = ? AND join_code_hash LIKE 'self:%'").bind(m.panel_id),   // last: own_page (REACH 3:35)
  ])) || []).map(r => (r && r.results) || []);
  const extras = P.deckFromResults(m, rs.slice(5));   // OWNER_router_18: the notice, answers to read, what was passed on
  // asks from a person wait for the one-time notice (OWNER_router_18 item 8d)
  const open = extras.notice ? rs[0].filter(t => !t.sender_member_id && !t.passed_by) : rs[0];
  // urgency (now, today, whenever), then newest first; a withdrawn task goes to the end of its group (OWNER_router_3)
  open.sort((x, y) => (RANK[x.urgency] - RANK[y.urgency]) || (y.created_at - x.created_at));
  const live = open.filter(t => t.state === 'open'), gone = open.filter(t => t.state === 'withdrawn');
  open.length = 0; open.push(...live);
  for (const g of gone) { let at = -1; open.forEach((t, i) => { if ((t.program || '') === (g.program || '')) at = i; }); if (at < 0) open.push(g); else open.splice(at + 1, 0, g); }
  const hist = rs[1];
  const CT = await import('./contacts.js');
  const view = (t) => ({ task_id: t.id, title: t.title, urgency: t.urgency, from: (t.passed_by && t.passed_from) || t.program || 'one of your programs', step: JSON.parse(t.step_json), unlocks: t.unlocks || null,
    created_at: iso(t.created_at), state: t.state, reply: t.reply_json ? JSON.parse(t.reply_json) : null, notes: t.notes_json ? JSON.parse(t.notes_json) : [], expires_at: iso(t.expires_at || (t.created_at + 30 * 86400000)),
    ...(t.state === 'withdrawn' ? { withdrawn_at: iso(t.withdrawn_at), withdraw_why: t.withdraw_why } : {}),
    ...(t.contacts_json ? { contacts: CT.forPerson(CT.parse(t.contacts_json)) } : {}),   // OWNER_router_29: never the service's ref
    ...(t.group_name ? { group: t.group_name, group_id: (t.connection_id || t.principal_id) + '/' + t.group_name } : {}),   // OWNER_router_31; group_id: TRUST 7:40 (one service's group)
    ...(t.elsewhere ? { answered_elsewhere: true } : {}),   // OWNER_router_31 (CARD-17): settled in the service's own app
    ...(t.sender_member_id ? { sender: { name: t.program, kind: 'person', behind: `You joined ${t.program || 'this person'}'s people. The name is their account's, checked by person.tools; it is never typed into the ask.` } } : {}),
    ...(t.passed_by ? { passed_on_by: t.passed_by_name || 'one of your people' } : {}),
    shell_only: JSON.parse(t.step_json).type === 'command' ? 'Only you can run this: copy the line and paste it where it says. The service cannot run it for you.' : undefined });
  const groups = [];
  for (const t of open) { const g = groups.find(x => x.from === (t.program || 'one of your programs')); if (g) g.task_ids.push(t.id); else groups.push({ from: t.program || 'one of your programs', task_ids: [t.id] }); }
  const out = { open: open.map(view), groups, history: hist.map(view), ...extras, ...((rs[rs.length - 1] || [])[0] ? { own_page: true } : {}) };
  // OWNER_router_9: each ask's card as its asker sent it, and the asker's brand; "from" stays the service's own
  { const rows = [...open, ...hist], brands = {};
    const { brandView } = await import('./cards.js');   // OWNER_router_26 items 1, 3, 24: proved brands to all; test brands to test members only
    for (const b of rs[2]) { const v = brandView(b, m, apiBase(request)); if (v) brands[b.principal_id] = v; }
    for (const [i, x] of [...out.open, ...out.history].entries()) { const t = rows[i];
      if (t.card_json) x.card = JSON.parse(t.card_json);
      const bp = t.brand_principal_id || t.principal_id; if (brands[bp]) x.brand = brands[bp]; } }
  const own = [...out.open, ...out.history].filter((x, i) => (i < out.open.length ? open[i] : hist[i - out.open.length]).connection_id);
  if (own.length) {   // WEB 4:07: two queries for the whole list, not two per ask
    const rows = new Map([...open, ...hist].map(r => [r.id, r]));
    const cs = new Map(rs[3].map(c => [c.id, c])), ms = new Map(rs[4].map(r => [r.task_id, r]));   // read in the one batch above
    for (const x of own) {
      const c = cs.get(rows.get(x.task_id).connection_id);
      const passed = !!rows.get(x.task_id).passed_by;   // WEB 1:15 PM CT 16 Nov: an ask passed on is from the passer's AI, not the receiver's
      if (c && passed) x.connection = { name: c.name, yours: false, icon: String(c.icon || '').startsWith('img:') ? null : (c.icon || null) };
      else if (c) x.connection = { id: c.id, name: c.name, yours: true, icon: String(c.icon || '').startsWith('img:') ? null : (c.icon || null), ...(String(c.icon || '').startsWith('img:') ? { icon_url: apiBase(request) + '/v1/member/connections/' + c.id + '/icon' } : {}) };
      const md = ms.get(x.task_id);
      if (md) x.media = { kind: md.content_type.startsWith('video/') ? 'clip' : 'photo', content_type: md.content_type, bytes: md.bytes, seconds: md.seconds, deleted_at: iso(md.delete_at) };
    }
  }
  return out;
}

export async function memberReply(env, request, m, taskId, b) {
  const [w, args] = forMember(m);
  const t = await env.DB.prepare(`SELECT t.* FROM tasks t WHERE t.id = ? AND t.panel_id = ? AND ${w}`).bind(String(taskId || ''), m.panel_id, ...args).first();
  if (!t) throw notFixable(404, 'not_found', 'No task of yours has that id.');
  // TRUST 6:47 PM CT (OWNER_router_18): what the list does not show yet cannot be answered by its id
  if ((t.hold_until && t.hold_until > nowMs()) || ((t.sender_member_id || t.passed_by) && await (await import('./people.js')).hidesPersonAsks(env, m))) throw notFixable(404, 'not_found', 'No task of yours has that id.');
  // TRUST 10:47: an answer acts once; a second answer to an answered or withdrawn task does nothing (a Refuse after a Pass
  // must never refuse a call that is already ringing)
  if (t.state === 'open' && (t.expires_at || t.created_at + 2592000000) < nowMs()) { await lapseNow(env, t); throw notFixable(409, 'already_answered', 'This ask has lapsed: its time ran out before an answer; nothing changed.'); }
  if (t.state !== 'open') throw notFixable(409, 'already_answered', `This task is ${t.state === 'withdrawn' ? 'withdrawn' : t.state === 'lapsed' ? 'lapsed' : 'already answered'}; nothing changed.`);
  if (JSON.parse(t.step_json).type === 'review') {   // the media check: pass, refuse (with a reason), or not now
    for (const k of Object.keys(b || {})) if (!['action', 'reason', 'text'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not a field here; send action, reason and text.`, null);
    return reviewReply(env, request, m, t, JSON.parse(t.step_json), b);
  }
  for (const k of Object.keys(b || {})) if (!['action', 'choice', 'text', 'note'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not a field here; send action, choice, text and note.`, null);
  const action = b.action;
  const step = JSON.parse(t.step_json);
  const ACTIONS = step.type === 'approve' ? ['approve', 'deny', 'done', 'not_now', 'note'] : ['done', 'answer', 'not_now', 'note'];   // OWNER_router_26 item 6: done on every step   // SPEC 8.1; OWNER_all_10 C; 'note' (operations 1:00)
  if (!ACTIONS.includes(action)) throw fixable('invalid_field', 'action', `action is ${ACTIONS.map(a => '"' + a + '"').join(', ')}.`, ACTIONS[0]);
  let choice = null, text = null;
  if (action === 'answer') {
    if (b.choice !== undefined) { if (!step.choices || !step.choices.includes(b.choice)) throw fixable('invalid_field', 'choice', 'choice is one of the task\'s choices.', step.choices ? step.choices[0] : null); choice = b.choice; }
    if (b.text !== undefined) text = str(b.text, 'text', 1, 4000, 'my answer');
    if (choice === null && text === null && step.type !== 'call') throw fixable('missing_field', 'choice', 'An answer is a choice or a typed line.', step.choices ? step.choices[0] : null);
    // OWNER_router_26 items 7 and 26 (ASKS-14, ASKS-15): a choice that takes a line carries text; no other choice does; a line keeps its keyboard's form
    const takesLine = choice !== null && step.line_for && Object.prototype.hasOwnProperty.call(step.line_for, choice);
    if (takesLine && text === null) throw fixable('invalid_field', 'text', `"${choice}" takes a line: send text with it (${step.line_for[choice]}).`, null);
    if (choice !== null && !takesLine && text !== null) throw fixable('invalid_field', 'text', 'Only a choice that takes a line carries text; this one does not. Send the choice alone, or a note.', null);
    if (text !== null && step.keyboard && (takesLine || choice === null)) keyboardForm(step.keyboard, text);
  }
  if (action === 'note') {   // operations 1:00 PM CT: a note back to the asker; the task stays open and nothing is answered
    for (const k of Object.keys(b)) if (!['action', 'note'].includes(k)) throw fixable('unknown_field', k, 'A note is {"action": "note", "note": "..."}.', null);
    const mm = maskSecrets(str(b.note, 'note', 1, 2000, 'Change the second paragraph.'));
    const notes = await addNote(env, t.id, mm.v, 'person');
    return { task_id: t.id, state: 'open', notes, ...(mm.masked ? { masked: 'A key-shaped value was removed.' } : {}) };
  }
  if (action === 'approve' && b.text !== undefined) {   // the CEO 12:57: the person may edit what they approve, when the step allows it
    if (!step.editable) throw fixable('invalid_field', 'text', 'This step\'s text cannot be edited: approve or deny it as it is.', null);
    text = str(b.text, 'text', 1, 4000, step.text);
  }
  let note = b.note === undefined || b.note === '' ? null : str(b.note, 'note', 1, 4000, 'Done from the laptop.');
  const mt = maskSecrets(text), mn = maskSecrets(note); text = mt.v; note = mn.v;
  const now = nowMs();
  // WEB gap 36 (router_12 item 3): an approval from a client with no device key is allowed and carries no device_approved mark; it says so
  const CT = await import('./contacts.js'), clist = CT.parse(t.contacts_json), cref = action === 'answer' ? CT.contactRef(clist, step, choice) : undefined;
  // a signed approval of text that names a contact covers the text as the person saw it: only its digest is kept, never the name
  const drawn = action === 'approve' && clist && CT.hasRefs(text || step.text) ? { approved_digest_drawn: await (await import('./tasksig.js')).taskDigest(CT.drawNames(text || step.text, clist)) } : {};
  const reply = { action, choice, text, note, at: iso(now), ...(cref !== undefined ? { contact_ref: cref } : {}), ...drawn, ...(action === 'approve' ? { approved_text: text || step.text } : {}),   // the asker reads exactly what was approved
    ...(['approve', 'deny'].includes(action) ? { device_approved: false, mark: 'none: sent without a device signature, so it carries no device_approved mark' } : {}),
    ...(mt.masked || mn.masked ? { masked: 'A key-shaped value was removed; save it to the file the step names.' } : {}) };
  const state = action === 'done' ? 'done' : ['answer', 'approve', 'deny'].includes(action) ? 'answered' : 'not_now';
  await env.DB.prepare('UPDATE tasks SET state = ?, reply_json = ?, answered_at = ?, answered_by = ? WHERE id = ?').bind(state, JSON.stringify(reply), now, m.id, t.id).run();
  if (t.contacts_json) { try { await CT.stripClosed(env, t.id); } catch { } }   // OWNER_router_29: the details go with the open ask
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
    const r = await env.DB.prepare(`SELECT COUNT(*) AS n, MIN(t.created_at) AS oldest FROM tasks t LEFT JOIN calls c ON c.id = json_extract(t.step_json, '$.call_id')
        LEFT JOIN principals p ON p.id = c.principal_id WHERE t.state = 'open' AND t.step_json LIKE '%"type":"review"%' AND COALESCE(p.owner, 'outside') = 'outside'`).first();   // outsiders only (TRUST 12:35)
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
  for (const k of Object.keys(b || {})) if (!['why', 'elsewhere'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not a field here; send why (and elsewhere).`, null);
  if (b && b.elsewhere !== undefined && typeof b.elsewhere !== 'boolean') throw fixable('invalid_field', 'elsewhere', 'elsewhere is true when the person settled it in your own app, so the ask leaves their list without a word.', true);   // OWNER_router_31
  const why = str(b && b.why, 'why', 3, 200, 'Not needed any more: the step was done another way.');
  if (SECRET_RX.test(why.replace(URL_RX, ' '))) throw fixable('secret_in_task', 'why', 'Something here looks like a key or a token. Never send a key\'s value.', null, {}, 422);
  if (t.state === 'withdrawn') return out(t, request, await askerBrand(env, t.brand_principal_id || t.principal_id));   // idempotent
  if (t.state !== 'open') throw notFixable(409, 'already_answered', `This task was already answered (${t.state}); it stays as it is.`);
  await env.DB.prepare('UPDATE tasks SET state = \'withdrawn\', withdrawn_at = ?, withdraw_why = ?, elsewhere = ? WHERE id = ? AND state = \'open\'').bind(nowMs(), why, b && b.elsewhere === true ? 1 : null, t.id).run();
  if (t.contacts_json) { try { await (await import('./contacts.js')).stripClosed(env, t.id); } catch { } }
  return out(await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(t.id).first(), request, await askerBrand(env, t.brand_principal_id || t.principal_id));
}

// OWNER_router_1 item 4: every refused task, for the operator (GET /internal/task_refusals?hours=24). Never a matched secret.
export async function recordRefusal(env, key, b, err) {
  try {
    const a = (b && typeof b.asker === 'object' && b.asker) || {};
    const { maskForLog } = await import('./contacts.js');   // TRUST 5:06: no phone number or email address kept in the refusal list
    const clip = (v, n) => typeof v === 'string' ? maskSecrets(maskForLog(v).slice(0, n)).v : null;
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

// rows for a long list of ids, 90 at a time (D1's limit is 100 bound values a statement)
export async function inGroups(env, head, ids, tail = '') {
  const out = [];
  for (let i = 0; i < ids.length; i += 90) { const g = ids.slice(i, i + 90); out.push(...(((await env.DB.prepare(`${head} (${g.map(() => '?').join(',')}) ${tail}`).bind(...g).all()).results) || [])); }
  return out;
}
// OWNER_router_18: people.js sends and passes asks with the same checks
export { readStep, expiresIn, maskSecrets, notUs, cardFor, taskFields, addNote, forMember, str as taskStr, SECRET_RX, URL_RX, keyShape };
