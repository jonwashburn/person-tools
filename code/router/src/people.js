// A PERSON SENDS ASKS TO THEIR OWN PEOPLE (owner/OWNER_router_18, operations 5:48 PM CT 15 Nov 2026; SPEC_v0 section 2 "A person as
// asker" and "Passing an ask on"; 8.1 rows).
// A panel gets an owner: a checked name (the account's name, never text typed into an ask) and the memberships that are that person's.
// The owner's people are the other members of the panels they own. The owner lists them, sends them the same asks and cards as any
// other (one task per person, "From <name>"), reads each answer and its thread, and replies with a note. Any ask on a person's deck can
// be passed on to one of their people; the receiver's answer answers the original ask, and the original asker never learns who answered.
// Rules (the CEO's ruling of ~6:00 PM CT, item 8, with TRUST's 5:49 and 5:57 points): size and key-value checks only, nothing read by
// us; a daily cap per sender set by each receiver (20 by default; over it the ask waits until their tomorrow, never dropped); every link
// shows its real domain, a link whose words name another address is refused, a sign-in page is marked, a link that hides where it goes
// or downloads a program is refused; people who joined before sending existed are told once before any send reaches them, with Mute
// and Leave beside it; a receiver can mute (no ring, still listed) or block any sender; passing goes only to the passer's own people
// (or straight back to the one who passed it), at most 3 times, never back through someone it already passed.
import { rid, nowMs, iso } from './util.js';
import { fixable, notFixable } from './spec.js';

const CAP_DEFAULT = 20, MAX_PASSES = 3, SEND_MAX_TO = 20, SENDER_DAY_MAX = 300;
const SHORTENERS = /(?:^|\.)(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|cutt\.ly|shorturl\.at|tiny\.cc|rb\.gy|bl\.ink|lnkd\.in|s\.id|t\.ly|v\.gd|qr\.ae|tr\.im|soo\.gd|shorte\.st|adf\.ly|bitly\.com|short\.io|tiny\.one|surl\.li)$/i;
const SIGN_IN = /(?:^|[./_-])(?:log-?in|sign-?in|signon|sso|oauth|auth|account|accounts|password|passwd|verify|verification|secure|wallet|banking)(?:$|[./_?#=-])/i;
const RUNNABLE = /\.(?:exe|msi|dmg|pkg|apk|ipa|bat|cmd|ps1|sh|scr|jar|app|deb|rpm|vbs|js)$/i;
const URL_ANY = /\bhttps?:\/\/[^\s"'<>]+/gi;
const DOMAIN_WORD = /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|co|app|dev|ai|tools|us|uk|gov|edu|info|biz|me|tv|xyz|online|site|shop|store|bank|pro|so|gg|ly|to|link|page|cloud))\b/gi;

const base2 = (h) => String(h || '').toLowerCase().replace(/\.$/, '').split('.').slice(-2).join('.');
function hostOf(u) { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } }

// a link a person is sent: where it really goes, in plain words; refused when it hides that or runs a program
function checkLink(u, field) {
  const url = String(u).replace(/[.,;:!)]+$/, ''), h = hostOf(url);
  if (!/^https:\/\//i.test(url)) throw fixable('invalid_link', field, 'Only https:// links go in an ask.', 'https://example.com/page', {}, 422);
  if (!h || /^\d{1,3}(?:\.\d{1,3}){3}$|^\[|:/.test(h) || /(?:^|\.)xn--/.test(h) || SHORTENERS.test(h) || /@/.test(url.split('/')[2] || '') || /[^\x00-\x7f]/.test(url.split('/')[2] || ''))
    throw fixable('invalid_link', field, `This link hides where it goes (${h || 'no address'}: a bare address, a short link, or look-alike letters). Send the full https:// address of the real site.`, 'https://example.com/page', {}, 422);
  let path = ''; try { path = new URL(url).pathname; } catch { }
  if (RUNNABLE.test(path)) throw fixable('invalid_link', field, `This link downloads a program from ${h}; an ask never does that.`, null, {}, 422);
  return { url, domain: h, sign_in_page: SIGN_IN.test(h) || SIGN_IN.test(path) };
}
// every link in the words of an ask, and the link step's own: the shown words may not name another address than the link's
function readLinks(step, fields) {
  const links = [];
  for (const [field, v] of fields) for (const m of String(v || '').match(URL_ANY) || []) links.push({ field, ...checkLink(m, field) });
  if (step && step.type === 'link') {
    const l = checkLink(step.url, 'step.url');
    for (const w of (String(step.text || '').replace(URL_ANY, ' ').match(DOMAIN_WORD) || [])) {
      if (base2(w) !== base2(l.domain)) throw fixable('link_mismatch', 'step.text', `The words name ${w}, but the link goes to ${l.domain}. A link's words and its address must agree.`, null, {}, 422);
    }
    step.domain = l.domain; if (l.sign_in_page) step.sign_in_page = true;
    links.push({ field: 'step.url', ...l });
  }
  return links;
}

// the memberships that are this person: this one, those linked to the same passkey account, and those the operator named as the
// same owner (owner_members); never by name (the CEO, 1:56 PM CT)
async function selves(env, m) {
  const ids = new Set([m.id]);
  try { for (const r of ((await env.DB.prepare('SELECT member_id AS id FROM person_members WHERE person_id = (SELECT person_id FROM person_members WHERE member_id = ?)').bind(m.id).all()).results || [])) ids.add(r.id); } catch { }
  try { for (const r of ((await env.DB.prepare(`SELECT DISTINCT b.member_id AS id FROM owner_members a JOIN owner_members b ON b.panel_id = a.panel_id WHERE a.member_id IN (${[...ids].map(() => '?').join(',')})`).bind(...ids).all()).results || [])) ids.add(r.id); } catch { }
  return [...ids];
}
// the panels this person owns, each with its checked name and its sender principal
async function ownedBy(env, m) {
  const me = await selves(env, m);
  return (await env.DB.prepare(`SELECT DISTINCT po.panel_id, po.name, po.principal_id FROM owner_members om JOIN panel_owners po ON po.panel_id = om.panel_id
      WHERE om.member_id IN (${me.map(() => '?').join(',')})`).bind(...me).all()).results || [];
}
// the owner's people: members of the owned panels who have not left and are not the owner's own memberships
async function peopleOf(env, owned) {
  if (!owned.length) return [];
  const ps = owned.map(o => o.panel_id);
  return (await env.DB.prepare(`SELECT m.* FROM members m WHERE m.panel_id IN (${ps.map(() => '?').join(',')}) AND m.left_at IS NULL
      AND m.id NOT IN (SELECT member_id FROM owner_members WHERE panel_id = m.panel_id) ORDER BY m.created_at`).bind(...ps).all()).results || [];
}
const shownName = (r) => (String(r.alias || '').trim() || String(r.person_name || '').trim() || 'someone who joined').slice(0, 40);
const toName = (r) => 'mb:' + r.id;   // TRUST 6:47: always the one membership, never a name two members may share
// the owner name of a panel a member is on (for the join page, the notice, and "passed on by")
export async function panelOwner(env, panelId) {
  try { return await env.DB.prepare('SELECT panel_id, name, principal_id FROM panel_owners WHERE panel_id = ?').bind(panelId).first(); } catch { return null; }
}
export const ownerLine = (name) => `${name} can send you tasks and questions here; you can mute or leave at any time.`;
async function muted(env, principalId, memberIds) {
  if (!principalId || !memberIds.length) return false;
  try { return !!(await env.DB.prepare(`SELECT 1 AS x FROM mutes WHERE principal_id = ? AND member_id IN (${memberIds.map(() => '?').join(',')}) LIMIT 1`).bind(principalId, ...memberIds).first()); } catch { return false; }
}
// the receiver's day, in their own time zone: when it began and when tomorrow begins
function dayOf(tz, now) {
  let p = {}; try { for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/Chicago', hourCycle: 'h23', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(now))) p[x.type] = Number(x.value); } catch { p = { hour: 0, minute: 0, second: 0 }; }
  const since = ((p.hour || 0) * 3600 + (p.minute || 0) * 60 + (p.second || 0)) * 1000 + (now % 1000);
  return { start: now - since, next: now - since + 86400000 };
}
// the first day (today, else a later one) with room under this receiver's cap for this sender: null today, else when it shows
async function askRow(env, memberId) { try { return (await env.DB.prepare('SELECT asks_cap, told_at FROM member_asks WHERE member_id = ?').bind(memberId).first()) || {}; } catch { return {}; } }
async function slotFor(env, principalId, r, now, passerIds = []) {
  const ar = await askRow(env, r.id);
  const cap = Number.isInteger(ar.asks_cap) && ar.asks_cap >= 0 ? ar.asks_cap : CAP_DEFAULT;
  const d = dayOf(r.tz, now);
  for (let i = 0; i < 30; i++) {
    const from = d.start + i * 86400000, to = from + 86400000;
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE principal_id = ? AND sender_member_id IS NOT NULL AND (to_name = ? OR (to_name = ? AND panel_id = ?)) AND COALESCE(hold_until, created_at) >= ? AND COALESCE(hold_until, created_at) < ?`)
      .bind(principalId || '\u0000', toName(r), r.person_name || '\u0000', r.panel_id, from, to).first();
    const p = passerIds.length ? await env.DB.prepare(`SELECT COUNT(*) AS n FROM task_passes WHERE to_member_id = ? AND from_member_id IN (${passerIds.map(() => '?').join(',')}) AND COALESCE(shows_at, created_at) >= ? AND COALESCE(shows_at, created_at) < ?`)
      .bind(r.id, ...passerIds, from, to).first() : { n: 0 };
    if (((n && n.n) || 0) + ((p && p.n) || 0) < cap) return i === 0 ? null : from;
  }
  throw notFixable(429, 'rate_limited', 'This person\'s list from you is full for the next 30 days; nothing was stored.', { retry_after_seconds: 86400 });
}

// ---- the operator names a panel's owner (POST /internal/panels/{p}/owner {name, members}); the name passes the asker-name check
export async function setOwner(env, panelId, b) {
  for (const k of Object.keys(b || {})) if (!['name', 'members'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not a field here; send name and members.`, null);
  const p = await env.DB.prepare('SELECT * FROM panels WHERE id = ?').bind(String(panelId || '')).first();
  if (!p) throw notFixable(404, 'not_found', 'No panel has that id.');
  const { checkAskerName } = await import('./panels.js');
  // the asker-name check with the operator's lists, as every other caller passes them (TRUST 6:47: without them the screen fails closed)
  const { screenTerms } = await import('./private_terms.js');
  let name; try { name = await checkAskerName(b && b.name, await screenTerms(env)); } catch (e) { if (e && e.body) { e.body.field = 'name'; e.body.message = String(e.body.message || '').replace(/^asker_name/, 'name'); } throw e; }
  const ms = Array.isArray(b && b.members) ? [...new Set(b.members.map(String))] : null;
  if (!ms || ms.length < 1 || ms.length > 10) throw fixable('invalid_field', 'members', 'members are 1 to 10 member ids: the memberships that are this person (their app, their page).', ['mb_...']);
  const found = (await env.DB.prepare(`SELECT id FROM members WHERE id IN (${ms.map(() => '?').join(',')}) AND left_at IS NULL`).bind(...ms).all()).results || [];
  if (found.length !== ms.length) throw fixable('invalid_field', 'members', 'Every id must be a membership that has not left.', null);
  const now = nowMs(), had = await panelOwner(env, p.id);
  // a people-only panel (made by POST /internal/panels/people) already belongs to a person principal with no keys: its owner sends as it
  const own = !had ? await env.DB.prepare('SELECT id FROM principals WHERE id = ? AND owner = \'person\' AND NOT EXISTS (SELECT 1 FROM keys WHERE principal_id = principals.id)').bind(p.principal_id).first() : null;
  const pr = had ? had.principal_id : own ? own.id : rid('pr_');
  await env.DB.batch([
    ...(had ? [env.DB.prepare('UPDATE panel_owners SET name = ? WHERE panel_id = ?').bind(name, p.id), env.DB.prepare('UPDATE principals SET name = ? WHERE id = ?').bind(name, pr)]
      : own ? [env.DB.prepare('UPDATE principals SET name = ? WHERE id = ?').bind(name, pr), env.DB.prepare('INSERT INTO panel_owners (panel_id, name, principal_id, created_at) VALUES (?,?,?,?)').bind(p.id, name, pr, now)]
      : [env.DB.prepare('INSERT INTO principals (id, class, name, team, created_ip_hash, created_at, owner, test_run) VALUES (?,?,?,?,?,?,?,(SELECT test_run FROM principals WHERE id = ?))').bind(pr, 'test', name, 0, null, now, 'person', p.principal_id),   // operations 3:14: a test panel's owner is a test run's too
         env.DB.prepare('INSERT INTO panel_owners (panel_id, name, principal_id, created_at) VALUES (?,?,?,?)').bind(p.id, name, pr, now)]),
    env.DB.prepare('UPDATE principals SET test_run = COALESCE(test_run, (SELECT test_run FROM principals WHERE id = ?)) WHERE id = ?').bind(p.principal_id, pr),
    env.DB.prepare('DELETE FROM owner_members WHERE panel_id = ?').bind(p.id),
    ...ms.map(id => env.DB.prepare('INSERT INTO owner_members (member_id, panel_id, added_at) VALUES (?,?,?)').bind(id, p.id, now)),
  ]);
  return { panel_id: p.id, name, members: ms, principal_id: pr, line: ownerLine(name), note: 'The join page now says the line before anyone joins; people who joined before are told it once, with Mute and Leave, before any send reaches them.' };
}

// ---- GET /v1/member/people: the owner's people, joined or not yet (a sent link not yet used), and how to resend
export async function listPeople(env, request, m) {
  const owned = await ownedBy(env, m);
  if (!owned.length) return { people: [], waiting: [], note: 'You have no people yet: they are the people who join a panel from a link you send. Ask the operator to make your panel yours.' };
  const people = await peopleOf(env, owned), ps = owned.map(o => o.panel_id);
  const links = (await env.DB.prepare(`SELECT label, created_at, panel_id FROM join_links WHERE panel_id IN (${ps.map(() => '?').join(',')}) AND revoked_at IS NULL AND (max_joins IS NULL OR joins < max_joins) ORDER BY created_at`).bind(...ps).all()).results || [];
  return {
    name: owned[0].name,
    people: people.map(r => ({ member_id: r.id, name: shownName(r), joined_at: iso(r.created_at), state: 'joined' })),
    waiting: links.map(l => ({ name: l.label || 'a link for anyone', sent_at: iso(l.created_at), state: 'not yet', resend: { method: 'POST', path: '/v1/member/people/links', body: { label: l.label || null } } })),
    note: 'A join link is shown only once, when it is made: to send it again, make a fresh one for that name (the old one stops).',
  };
}
// POST /v1/member/people/links {label}: a fresh single-use link for one person on the owner's panel; an unused one for that name stops
export async function newLink(env, request, m, b) {
  for (const k of Object.keys(b || {})) if (!['label', 'panel_id'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not a field here; send label.`, null);
  const owned = await ownedBy(env, m);
  if (!owned.length) throw notFixable(403, 'forbidden', 'Only the person whose panel it is can make its links.');
  const o = b && b.panel_id ? owned.find(x => x.panel_id === b.panel_id) : owned[0];
  if (!o) throw notFixable(404, 'not_found', 'No panel of yours has that id.');
  const label = String((b && b.label) || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9 _-]{0,39}$/.test(label)) throw fixable('invalid_field', 'label', 'label is the person this link is for: 1 to 40 letters, digits, spaces, hyphens.', 'emma');
  const taken = await env.DB.prepare('SELECT 1 AS x FROM members WHERE panel_id = ? AND person_name = ? AND left_at IS NULL').bind(o.panel_id, label).first();
  if (taken) throw fixable('invalid_field', 'label', `"${label}" has already joined.`, null, {}, 409);
  const { sha256hex, runnerBase } = await import('./util.js');
  const code = rid('jc_', 24), now = nowMs();
  await env.DB.batch([
    env.DB.prepare('UPDATE join_links SET revoked_at = ? WHERE panel_id = ? AND label = ? AND revoked_at IS NULL AND (max_joins IS NULL OR joins < max_joins)').bind(now, o.panel_id, label),
    env.DB.prepare('INSERT INTO join_links (code_hash, panel_id, label, max_joins, joins, created_at) VALUES (?,?,?,1,0,?)').bind(await sha256hex(code), o.panel_id, label, now),
  ]);
  const url = runnerBase(request) + '/j/' + code;
  return { label, join_url: url, for_them: `${o.name} would like to send you tasks and questions on person.tools. Join here (one tap, about a minute): ${url}`, note: 'This link works once; an older unused one for this name stopped.' };
}

// ---- POST /v1/member/people/asks: one task per person, "From <name>"; same steps and cards as /v1/tasks
export async function sendAsks(env, request, m, b) {
  const T = await import('./tasks.js');
  const KNOWN = ['to', 'title', 'step', 'unlocks', 'urgency', 'expires_in', 'card', 'idempotency_key'];
  (await import('./contacts.js')).refuseContacts(b && b.contacts);   // OWNER_router_29 (ASKS-20): no one else's details between people
  for (const k of Object.keys(b || {})) if (!KNOWN.includes(k)) throw fixable('unknown_field', k, ['from', 'asker', 'name', 'program'].includes(k) ? 'Your name comes from your account; it is never sent with the ask.' : `"${k}" is not a field here; send ${KNOWN.join(', ')}.`, null);
  const owned = await ownedBy(env, m);
  if (!owned.length) throw notFixable(403, 'forbidden', 'Only the person whose panel it is can send asks to its people.');
  const to = Array.isArray(b.to) ? [...new Set(b.to.map(String))] : typeof b.to === 'string' ? [b.to] : null;
  if (!to || !to.length || to.length > SEND_MAX_TO) throw fixable(b.to === undefined ? 'missing_field' : 'invalid_field', 'to', `to is 1 to ${SEND_MAX_TO} of your people's member ids (GET /v1/member/people lists them).`, ['mb_...']);
  const mine = new Map((await peopleOf(env, owned)).map(r => [r.id, r]));
  if (to.some(id => !mine.has(id))) throw notFixable(404, 'not_found', 'Asks go only to your own people: one of these ids is not one of them (GET /v1/member/people lists them). Nothing was sent.');
  const title = T.taskStr(b.title, 'title', 3, 120, 'Can you pick up the dry cleaning?');
  const step = T.readStep(b.step);
  if (step.type === 'call') throw fixable('invalid_field', 'step.type', 'A call step names a contact of the ask, and an ask to your own people carries none.', 'question');
  (await import('./contacts.js')).askContacts(undefined, { title, step, card: b.card && typeof b.card === 'object' ? b.card : null, unlocks: null }, 0);   // a {c1} names nobody here
  const unlocks = b.unlocks === undefined ? null : T.taskStr(b.unlocks, 'unlocks', 1, 300, 'I will know whether to go.');
  const urgency = b.urgency === undefined ? 'today' : String(b.urgency);
  if (!['now', 'today', 'whenever'].includes(urgency)) throw fixable('invalid_field', 'urgency', 'urgency is "now" (it rings once, unless they muted you), "today" or "whenever".', 'today');
  const life = T.expiresIn(b);
  const fields = [...T.taskFields({ title, step, unlocks }), ...(step.type === 'approve' ? [['step.text', step.text], ['step.approve_label', step.approve_label], ['step.deny_label', step.deny_label]] : [])];
  for (const [field, v] of fields) if (T.keyShape(v)) throw fixable('secret_in_task', field, `Something here looks like ${T.keyShape(v)}. Never send a key's value.`, null, {}, 422);
  await T.notUs({ title, step, unlocks });
  readLinks(step, fields.filter(([f]) => f !== 'step.text' || step.type !== 'link'));
  const now = nowMs();
  const me = await selves(env, m);
  const day = await dayCount(env, me, now);
  if (day + to.length > SENDER_DAY_MAX) throw notFixable(429, 'rate_limited', `At most ${SENDER_DAY_MAX} asks a day from one person; nothing was sent.`, { retry_after_seconds: 3600 });
  const idem = b.idempotency_key === undefined ? null : T.taskStr(b.idempotency_key, 'idempotency_key', 1, 100, 'ask-001');
  const sent = [], notSent = [];
  for (const id of to) {
    const r = mine.get(id), o = owned.find(x => x.panel_id === r.panel_id);
    const card = await T.cardFor(env, { principal_id: o.principal_id, id: null, class: 'test' }, b.card, false, null, step);
    if (idem) {
      const had = await env.DB.prepare('SELECT id, hold_until FROM tasks WHERE principal_id = ? AND idem = ?').bind(o.principal_id, idem + ':' + r.id).first();
      if (had) { sent.push({ to: r.id, name: shownName(r), task_id: had.id, repeated: true }); continue; }
    }
    const { blocked } = await import('./blocks.js');
    if (await blocked(env, o.principal_id, [r.id])) { notSent.push({ to: r.id, name: shownName(r), why: 'not available' }); continue; }   // never "blocked"
    const hold = await slotFor(env, o.principal_id, r, now, me);
    const tid = rid('tk_');
    await env.DB.prepare(`INSERT INTO tasks (id, principal_id, key_id, panel_id, to_name, title, step_json, unlocks, program, session, urgency, state, created_at, idem, card_json, expires_at, sender_member_id, hold_until)
        VALUES (?,?,NULL,?,?,?,?,?,?,NULL,?,'open',?,?,?,?,?,?)`).bind(tid, o.principal_id, r.panel_id, toName(r), title, JSON.stringify(step), unlocks, o.name, urgency, now,
      idem ? idem + ':' + r.id : null, card ? JSON.stringify(card) : null, (hold || now) + life * 1000, m.id, hold).run();
    // a "now" ask rings once: never while it waits for tomorrow, before they were told, or when they muted this sender
    if (urgency === 'now' && !hold && (await askRow(env, r.id)).told_at && !(await muted(env, o.principal_id, [r.id]))) { try { await T.ringTask(env, await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(tid).first()); } catch { } }
    sent.push({ to: r.id, name: shownName(r), task_id: tid, ...(hold ? { waits_until: iso(hold), why: 'This person\'s daily limit for you is reached; it shows on their list when their tomorrow starts.' } : {}) });
  }
  return { status: sent.length ? 201 : 200, body: { from: owned[0].name, sent, ...(notSent.length ? { not_sent: notSent } : {}), read: 'GET /v1/member/sent shows each answer and its thread.' } };
}

// a sent or passed ask's thread as its sender sees it (private notes between a passer and a receiver included)
function threadView(t, who) {
  return { task_id: t.id, to: who, title: t.title, step: JSON.parse(t.step_json), urgency: t.urgency, created_at: iso(t.created_at), state: t.state,
    ...(t.hold_until && t.hold_until > nowMs() ? { waits_until: iso(t.hold_until) } : {}), expires_at: iso(t.expires_at || (t.created_at + 30 * 86400000)),
    reply: t.reply_json ? JSON.parse(t.reply_json) : null, answered_at: iso(t.answered_at), notes: t.notes_json ? JSON.parse(t.notes_json) : [],
    ...(t.card_json ? { card: JSON.parse(t.card_json) } : {}), ...(t.state === 'withdrawn' ? { withdrawn_at: iso(t.withdrawn_at) } : {}) };
}
async function namesOf(env, ids) {
  if (!ids.length) return new Map();
  const { inGroups } = await import('./tasks.js');   // WEB 7:49: never more than 90 ids in one statement
  return new Map((await inGroups(env, 'SELECT id, alias, person_name FROM members WHERE id IN', [...new Set(ids)])).map(r => [r.id, shownName(r)]));
}
// ---- GET /v1/member/sent: what this person sent (each with its answer and thread), and what they passed on
export async function listSent(env, request, m) {
  const owned = await ownedBy(env, m), me = await selves(env, m), now = nowMs();
  const sent = owned.length ? (await env.DB.prepare(`SELECT * FROM tasks WHERE principal_id IN (${owned.map(() => '?').join(',')}) AND sender_member_id IS NOT NULL ORDER BY created_at DESC LIMIT 200`).bind(...owned.map(o => o.principal_id)).all()).results || [] : [];
  const passes = (await env.DB.prepare(`SELECT p.task_id, p.to_member_id, p.created_at AS passed_at FROM task_passes p WHERE p.from_member_id IN (${me.map(() => '?').join(',')}) ORDER BY p.created_at DESC LIMIT 200`).bind(...me).all()).results || [];
  const passedTasks = passes.length ? new Map((await (await import('./tasks.js')).inGroups(env, 'SELECT * FROM tasks WHERE id IN', [...new Set(passes.map(p => p.task_id))])).map(t => [t.id, t])) : new Map();
  const memberIds = [...new Set([...sent.map(t => t.to_name.startsWith('mb:') ? t.to_name.slice(3) : null).filter(Boolean), ...passes.map(p => p.to_member_id)])];
  const names = await namesOf(env, memberIds);
  // a named receiver ("emma" on the panel) is shown by the member who holds that name
  const named = sent.filter(t => !t.to_name.startsWith('mb:'));
  const byName = new Map();
  for (const t of named) { const k = t.panel_id + '|' + t.to_name; if (!byName.has(k)) { const r = await env.DB.prepare('SELECT alias, person_name FROM members WHERE panel_id = ? AND person_name = ? ORDER BY created_at LIMIT 1').bind(t.panel_id, t.to_name).first(); byName.set(k, r ? shownName(r) : t.to_name); } }
  const whoOf = (t) => t.to_name.startsWith('mb:') ? { member_id: t.to_name.slice(3), name: names.get(t.to_name.slice(3)) || 'someone who left' } : { name: byName.get(t.panel_id + '|' + t.to_name) || t.to_name };
  // WEB 7:15: reading never marks anything (two clients open at once would race for "new"); POST /v1/member/sent/read marks
  const seen = sent.filter(t => (t.answered_at || 0) > (t.sender_seen_at || 0) || (t.notes_json && JSON.parse(t.notes_json).some(n => n.by === 'person' && Date.parse(n.at) > (t.sender_seen_at || 0))));
  return {
    sent: sent.map(t => ({ ...threadView(t, whoOf(t)), new: seen.includes(t) })),
    passed: passes.map(p => { const t = passedTasks.get(p.task_id); return t ? { ...threadView(t, { member_id: p.to_member_id, name: names.get(p.to_member_id) || 'someone who left' }), from: t.program || 'one of your programs', passed_at: iso(p.passed_at) } : null; }).filter(Boolean),
  };
}
// POST /v1/member/sent/{task_id}/notes {note}: the sender (or the one who passed it) writes into the receiver's thread
export async function sentNote(env, request, m, taskId, b) {
  for (const k of Object.keys(b || {})) if (k !== 'note') throw fixable('unknown_field', k, 'Send {"note": "..."}.', null);
  const T = await import('./tasks.js');
  const owned = await ownedBy(env, m), me = await selves(env, m);
  const t = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(String(taskId || '')).first();
  const isSender = t && t.sender_member_id && owned.some(o => o.principal_id === t.principal_id);
  const isPasser = t && !isSender && !!(await env.DB.prepare(`SELECT 1 AS x FROM task_passes WHERE task_id = ? AND from_member_id IN (${me.map(() => '?').join(',')}) LIMIT 1`).bind(t.id, ...me).first());
  if (!t || (!isSender && !isPasser)) throw notFixable(404, 'not_found', 'No ask you sent or passed on has that id.');
  if (t.state !== 'open') throw notFixable(409, 'already_answered', 'This ask is no longer open; send a new one.');
  const v = T.taskStr(b && b.note, 'note', 1, 2000, 'Thanks: the blue one.');
  const mm = T.maskSecrets(v);
  const name = isSender ? owned.find(o => o.principal_id === t.principal_id).name : await passerName(env, m);
  return { task_id: t.id, notes: await T.addNote(env, t.id, mm.v, isSender ? 'asker' : 'passer', { name, ...(isPasser ? { private: true } : {}) }) };
}
async function passerName(env, m) {
  const owned = await ownedBy(env, m);
  return owned.length ? owned[0].name : shownName(m);
}

// ---- POST /v1/member/tasks/{task_id}/pass {to, note}: an ask on this person's deck goes to one of their people
export async function passTask(env, request, m, taskId, b) {
  for (const k of Object.keys(b || {})) if (!['to', 'note'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not a field here; send to and note.`, null);
  const T = await import('./tasks.js');
  const [w, args] = T.forMember(m);
  const t = await env.DB.prepare(`SELECT t.* FROM tasks t WHERE t.id = ? AND t.panel_id = ? AND ${w}`).bind(String(taskId || ''), m.panel_id, ...args).first();
  if (!t) throw notFixable(404, 'not_found', 'No ask on your list has that id.');
  if (t.state !== 'open' || (t.expires_at || t.created_at + 2592000000) < nowMs()) throw notFixable(409, 'already_answered', 'This ask is no longer open; nothing was passed.');
  if (t.contacts_json && t.contacts_json !== '[]') throw notFixable(409, 'has_contacts', 'This ask carries someone else\'s details, so it is not passed on.');   // OWNER_router_29
  const step = JSON.parse(t.step_json);
  if (step.type === 'review') throw notFixable(409, 'conflict', 'A media check is for person.tools\'s own reviewer; it cannot be passed on.');
  const passes = (await env.DB.prepare('SELECT * FROM task_passes WHERE task_id = ? ORDER BY created_at').bind(t.id).all()).results || [];
  const toId = String((b && b.to) || '');
  const last = passes.length ? passes[passes.length - 1] : null;
  const back = !!(last && last.to_member_id && (await selves(env, m)).includes(last.to_member_id) && toId === last.from_member_id);   // straight back to the one who passed it
  const owned = await ownedBy(env, m);
  const r = back ? await env.DB.prepare('SELECT * FROM members WHERE id = ? AND left_at IS NULL').bind(toId).first() : (await peopleOf(env, owned)).find(x => x.id === toId);
  if (!r) throw notFixable(404, 'not_found', 'An ask passes only to one of your own people (GET /v1/member/people lists them), or straight back to the one who passed it to you.');
  if (passes.length >= MAX_PASSES) throw notFixable(409, 'conflict', `This ask has been passed on ${MAX_PASSES} times: answer it, or say Not now.`);
  const through = new Set(passes.flatMap(p => [p.from_member_id, p.to_member_id]));
  if (!back && through.has(r.id)) throw notFixable(409, 'conflict', 'This ask has already been with that person; it can only go straight back to the one who passed it to you.');
  const passerPr = owned.length ? owned[0].principal_id : null;
  const { blocked } = await import('./blocks.js');
  if (await blocked(env, t.principal_id, [r.id]) || (passerPr && await blocked(env, passerPr, [r.id])) || (passerPr && await muted(env, passerPr, [r.id]))) throw notFixable(403, 'not_available', 'That person is not available for this ask.');
  const note = b && b.note !== undefined && b.note !== '' ? T.maskSecrets(T.taskStr(b.note, 'note', 1, 500, 'Can you take this one?')).v : null;
  const now = nowMs(), name = await passerName(env, m), me = await selves(env, m);
  if ((await dayCount(env, me, now)) + 1 > SENDER_DAY_MAX) throw notFixable(429, 'rate_limited', `At most ${SENDER_DAY_MAX} asks a day from one person, passes included; nothing was passed.`, { retry_after_seconds: 3600 });
  const hold = back ? null : await slotFor(env, passerPr, r, now, me);   // TRUST 6:47 item 5: a pass counts against the receiver's daily limit
  // TRUST 6:47 item 4: an AI's name is typed text; before it is shown to someone else it passes the asker-name check
  let from = t.program || null;
  if (t.connection_id && from) { try { const { checkAskerName } = await import('./panels.js'); const { screenTerms } = await import('./private_terms.js'); await checkAskerName(from, await screenTerms(env)); } catch { from = `one of ${name}'s AIs`; } }
  const u = await env.DB.prepare('UPDATE tasks SET panel_id = ?, to_name = ?, passed_by = ?, passed_by_name = ?, passed_from = ?, hold_until = ?, orig_to_name = COALESCE(orig_to_name, to_name) WHERE id = ? AND state = \'open\' AND panel_id = ? AND to_name = ?')
    .bind(r.panel_id, toName(r), m.id, name, from, hold, t.id, t.panel_id, t.to_name).run();
  if (u.meta.changes !== 1) throw notFixable(409, 'conflict', 'This ask changed just now (answered or passed); nothing was passed.');
  await env.DB.prepare('INSERT INTO task_passes (id, task_id, from_member_id, to_member_id, from_panel_id, from_to_name, note, created_at, shows_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(rid('tp_'), t.id, m.id, r.id, t.panel_id, t.to_name, note, now, hold).run();
  if (note) await T.addNote(env, t.id, note, 'passer', { name, private: true });
  if (t.urgency === 'now' && !hold && ((await askRow(env, r.id)).told_at || !(await noticeFor(env, r))) && !(passerPr && await muted(env, passerPr, [r.id])) && !(await muted(env, t.principal_id, [r.id]))) { try { await T.ringTask(env, await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(t.id).first()); } catch { } }
  return { task_id: t.id, passed_to: { member_id: r.id, name: shownName(r) }, ...(hold ? { waits_until: iso(hold), why: 'This person\'s daily limit for you is reached; it shows on their list when their tomorrow starts.' } : {}), note: 'It left your list. Their answer answers the original ask, and you see it in what you passed on (GET /v1/member/sent).' };
}

// ---- mutes: no ring from that sender, still listed (POST /v1/member/mutes {task_id, passer?}; GET; DELETE /v1/member/mutes/{id})
export async function addMute(env, m, b) {
  for (const k of Object.keys(b || {})) if (!['task_id', 'passer', 'panel_owner'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not a field here; send task_id (and passer: true to mute the one who passed it), or panel_owner: true.`, null);
  const T = await import('./tasks.js'); const [w, args] = T.forMember(m);
  let pr, name, t = null;
  if (b && b.panel_owner === true) {   // from the one-time notice, before any ask shows: the owner of the panel this person joined
    const o = await panelOwner(env, m.panel_id);
    if (!o) throw notFixable(404, 'not_found', 'Nobody sends asks on this panel.');
    pr = o.principal_id; name = o.name;
  } else {
    t = await env.DB.prepare(`SELECT t.* FROM tasks t WHERE t.id = ? AND t.panel_id = ? AND ${w}`).bind(String((b && b.task_id) || ''), m.panel_id, ...args).first();
    if (!t) throw notFixable(404, 'not_found', 'No ask on your list has that id.');
    pr = t.principal_id; name = t.program || 'an asker';
  }
  if (t && b.passer === true) {
    if (!t.passed_by) throw fixable('invalid_field', 'passer', 'Nobody passed this ask to you.', false);
    const o = await env.DB.prepare('SELECT po.principal_id, po.name FROM owner_members om JOIN panel_owners po ON po.panel_id = om.panel_id WHERE om.member_id = ? LIMIT 1').bind(t.passed_by).first();
    if (!o) throw notFixable(409, 'conflict', 'The one who passed this sends nothing of their own; there is nothing to mute.');
    pr = o.principal_id; name = o.name;
  }
  const me = await selves(env, m), now = nowMs(), id = rid('mu_');
  await env.DB.batch(me.map(mid => env.DB.prepare('INSERT OR IGNORE INTO mutes (id, member_id, principal_id, name, created_at) VALUES (?,?,?,?,?)').bind(mid === m.id ? id : rid('mu_'), mid, pr, name, now)));
  const row = await env.DB.prepare('SELECT id FROM mutes WHERE member_id = ? AND principal_id = ?').bind(m.id, pr).first();
  return { mute_id: row.id, name, note: 'Muted: its asks still come to your list, but never ring. Unmute any time.' };
}
export async function listMutes(env, m) {
  const rows = (await env.DB.prepare('SELECT id, name, created_at FROM mutes WHERE member_id = ? ORDER BY created_at DESC').bind(m.id).all()).results || [];
  return { mutes: rows.map(r => ({ mute_id: r.id, name: r.name, since: iso(r.created_at) })) };
}
export async function removeMute(env, m, id) {
  const r = await env.DB.prepare('SELECT principal_id FROM mutes WHERE id = ? AND member_id = ?').bind(String(id || ''), m.id).first();
  if (!r) throw notFixable(404, 'not_found', 'No mute of yours has that id.');
  const me = await selves(env, m);
  await env.DB.prepare(`DELETE FROM mutes WHERE principal_id = ? AND member_id IN (${me.map(() => '?').join(',')})`).bind(r.principal_id, ...me).run();
  return { mute_id: id, removed: true };
}

// ---- the one-time notice for people who joined before sending existed (POST /v1/member/people/notice once read)
export async function noticeFor(env, m) {
  if ((await askRow(env, m.id)).told_at) return null;
  const o = await panelOwner(env, m.panel_id);   // passes and sends reach only people of an owned panel, or go straight back to their passer
  if (!o || (await env.DB.prepare('SELECT 1 AS x FROM owner_members WHERE member_id = ? AND panel_id = ?').bind(m.id, m.panel_id).first())) return null;
  const name = o.name;
  return { text: ownerLine(name), from: name, read: { method: 'POST', path: '/v1/member/people/notice' }, mute: 'Mute: POST /v1/member/mutes {"task_id"} on any ask from them', leave: { method: 'POST', path: '/v1/member/leave', body: { confirm: true } },
    note: 'Asks from a person reach your list once you have read this.' };
}
export async function readNotice(env, m) {
  await env.DB.prepare('INSERT INTO member_asks (member_id, told_at) VALUES (?, ?) ON CONFLICT(member_id) DO UPDATE SET told_at = COALESCE(told_at, excluded.told_at)').bind(m.id, nowMs()).run();
  return { read: true, note: 'Asks from a person now reach your list. Mute or leave any time.' };
}

// ---- /v1/proof: asks between people are neither calls nor an AI's tasks; counted apart, never as outsiders
// OWNER_router_23 item 3 (operations 6:56 PM CT; TRUST 6:47): only real people: the one who answered and the one who sent are real
// memberships, and neither panel was made by a key a test run marked
export async function personAsksAnswered(env) {
  try { const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM tasks t JOIN members a ON a.id = t.answered_by JOIN members s ON s.id = t.sender_member_id
      WHERE t.sender_member_id IS NOT NULL AND t.state IN ('answered', 'done') AND a.is_real = 1 AND s.is_real = 1
        AND NOT EXISTS (SELECT 1 FROM panels pn JOIN principals pr ON pr.id = pn.principal_id WHERE pn.id IN (a.panel_id, s.panel_id) AND pr.test_run IS NOT NULL)`).first(); return (r && r.n) || 0; } catch { return 0; }
}
// asks a person sent or passed on in the last 24 hours (the 300 a day)
async function dayCount(env, me, now) {
  const a = await env.DB.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE sender_member_id IN (${me.map(() => '?').join(',')}) AND created_at > ?`).bind(...me, now - 86400000).first();
  const b = await env.DB.prepare(`SELECT COUNT(*) AS n FROM task_passes WHERE from_member_id IN (${me.map(() => '?').join(',')}) AND created_at > ?`).bind(...me, now - 86400000).first();
  return ((a && a.n) || 0) + ((b && b.n) || 0);
}

// ---- the join page says it before anyone joins (GET /v1/join/{code} gains "owner"); a join that showed it is told already
async function panelIdOfCode(env, code) {
  const { sha256hex } = await import('./util.js'); const h = await sha256hex(String(code || ''));
  const p = await env.DB.prepare('SELECT id FROM panels WHERE join_code_hash = ?').bind(h).first();
  if (p) return p.id;
  const l = await env.DB.prepare('SELECT panel_id FROM join_links WHERE code_hash = ?').bind(h).first().catch(() => null);
  return l ? l.panel_id : null;
}
export async function withOwnerLine(env, code, info) {
  const pid = await panelIdOfCode(env, code), o = pid ? await panelOwner(env, pid) : null;
  return o ? { ...info, owner: { name: o.name, line: ownerLine(o.name), shown: 'Show this line before anyone joins, then send "owner_line_seen": true with the join.' } } : info;
}
export async function afterJoin(env, joined, b) {
  if (!joined || !joined.member_id || !b || b.owner_line_seen !== true) return;
  const m = await env.DB.prepare('SELECT panel_id FROM members WHERE id = ?').bind(joined.member_id).first();
  if (m && await panelOwner(env, m.panel_id)) await env.DB.prepare('INSERT INTO member_asks (member_id, told_at) VALUES (?, ?) ON CONFLICT(member_id) DO UPDATE SET told_at = COALESCE(told_at, excluded.told_at)').bind(joined.member_id, nowMs()).run();
}

// ---- the receiver's daily cap per person who sends (GET/POST /v1/member/limits {"asks_per_person_per_day": 0..100}); 20 unless set
export async function limits(env, m, b) {
  if (b) {
    for (const k of Object.keys(b)) if (k !== 'asks_per_person_per_day') throw fixable('unknown_field', k, 'Send {"asks_per_person_per_day": 0 to 100}.', null);
    const v = b.asks_per_person_per_day;
    if (!Number.isInteger(v) || v < 0 || v > 100) throw fixable('invalid_field', 'asks_per_person_per_day', 'asks_per_person_per_day is how many asks one person may send you in a day: 0 to 100 (20 unless you change it). Over it, theirs wait until your tomorrow.', 20);
    const me = await selves(env, m);
    await env.DB.batch(me.map(id => env.DB.prepare('INSERT INTO member_asks (member_id, asks_cap) VALUES (?, ?) ON CONFLICT(member_id) DO UPDATE SET asks_cap = excluded.asks_cap').bind(id, v)));
  }
  const ar = await askRow(env, m.id);
  return { asks_per_person_per_day: Number.isInteger(ar.asks_cap) ? ar.asks_cap : CAP_DEFAULT, note: 'Over it, a person\'s asks wait until your tomorrow and they are told so; nothing is dropped. Only you see this.' };
}

// ---- for the person's own list (GET /v1/member/tasks): the notice, new answers to what they sent (lines to read), what they passed on
export async function deckExtras(env, request, m) {
  const out = {};
  const notice = await noticeFor(env, m); if (notice) out.notice = notice;
  const owned = await ownedBy(env, m), me = await selves(env, m);
  if (owned.length) {
    const rows = (await env.DB.prepare(`SELECT * FROM tasks WHERE principal_id IN (${owned.map(() => '?').join(',')}) AND sender_member_id IS NOT NULL AND answered_at IS NOT NULL AND answered_at > COALESCE(sender_seen_at, 0) ORDER BY answered_at DESC LIMIT 20`).bind(...owned.map(o => o.principal_id)).all()).results || [];
    if (rows.length) {
      const names = await namesOf(env, rows.filter(t => t.to_name.startsWith('mb:')).map(t => t.to_name.slice(3)));
      out.answers_to_read = rows.map(t => ({ task_id: t.id, title: t.title, from: t.to_name.startsWith('mb:') ? names.get(t.to_name.slice(3)) || 'someone who left' : t.to_name, state: t.state, reply: t.reply_json ? JSON.parse(t.reply_json) : null, at: iso(t.answered_at), read: 'GET /v1/member/sent' }));
    }
  }
  const passes = (await env.DB.prepare(`SELECT p.task_id, p.to_member_id, p.created_at FROM task_passes p WHERE p.from_member_id IN (${me.map(() => '?').join(',')}) ORDER BY p.created_at DESC LIMIT 50`).bind(...me).all()).results || [];
  if (passes.length) {
    const ts = new Map(((await env.DB.prepare(`SELECT id, title, program, state, reply_json, answered_at FROM tasks WHERE id IN (${passes.map(() => '?').join(',')})`).bind(...passes.map(p => p.task_id)).all()).results || []).map(t => [t.id, t]));
    const names = await namesOf(env, passes.map(p => p.to_member_id));
    out.passed_on = passes.map(p => { const t = ts.get(p.task_id); return t ? { task_id: t.id, title: t.title, from: t.program || 'one of your programs', passed_to: names.get(p.to_member_id) || 'someone who left', passed_at: iso(p.created_at), state: t.state, reply: t.reply_json ? JSON.parse(t.reply_json) : null } : null; }).filter(Boolean);
  }
  return out;
}
// whether this member's list hides asks from people (until the notice is read)
export async function hidesPersonAsks(env, m) { return !!(await noticeFor(env, m)); }

// ---- OWNER_router_23 (operations 6:56 PM CT; TRUST 6:56): a panel for one person's people, apart from the panel calls ring. It belongs to a
// person principal of class 'real' with no keys, so no key can place a call or a task on it (calls and tasks find a panel by the key's own
// principal); only that person's Send and pass-on reach it. The named unused join links move to it as they are (single use, same label,
// same code), so a link already texted joins the new panel. The owner is set afterwards with POST /internal/panels/{p}/owner.
export async function makePeoplePanel(env, b) {
  for (const k of Object.keys(b || {})) if (!['from_panel', 'labels', 'name'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not a field here; send from_panel, labels and name.`, null);
  const from = await env.DB.prepare('SELECT * FROM panels WHERE id = ?').bind(String((b && b.from_panel) || '')).first();
  if (!from) throw notFixable(404, 'not_found', 'No panel has that from_panel id.');
  const labels = Array.isArray(b.labels) ? [...new Set(b.labels.map(x => String(x).trim().toLowerCase()))] : [];
  if (labels.length < 1 || labels.length > 20 || labels.some(l => !/^[a-z][a-z0-9 _-]{0,39}$/.test(l))) throw fixable('invalid_field', 'labels', 'labels are 1 to 20 link labels on from_panel (the people the links are for).', ['emma']);
  const nm = typeof b.name === 'string' && b.name.trim().length >= 2 && b.name.trim().length <= 60 ? b.name.trim() : null;
  if (!nm) throw fixable('invalid_field', 'name', 'name is the new panel\'s name (2 to 60 characters), as the join page shows it.', 'Family');
  const links = (await env.DB.prepare(`SELECT code_hash, label, max_joins, joins FROM join_links WHERE panel_id = ? AND label IN (${labels.map(() => '?').join(',')}) AND revoked_at IS NULL AND (max_joins IS NULL OR joins < max_joins)`).bind(from.id, ...labels).all()).results || [];
  const missing = labels.filter(l => !links.some(x => x.label === l));
  if (missing.length) throw fixable('invalid_field', 'labels', `No unused link on that panel for: ${missing.join(', ')}. Nothing was made.`, null);
  if (links.some(x => x.max_joins !== 1)) throw fixable('invalid_field', 'labels', 'Only single-use labelled links move (TRUST 6:47: a label must name one person).', null);
  const now = nowMs(), pr = rid('pr_'), pn = rid('p_');
  await env.DB.batch([
    env.DB.prepare('INSERT INTO principals (id, class, name, team, created_ip_hash, created_at, owner) VALUES (?,?,?,?,?,?,?)').bind(pr, 'real', nm, 0, null, now, 'person'),
    env.DB.prepare('INSERT INTO panels (id, principal_id, name, kind, join_code_hash, created_at, asker_name) VALUES (?,?,?,?,?,?,?)').bind(pn, pr, nm, 'private', 'people:' + rid('x', 24), now, null),
    ...links.map(l => env.DB.prepare('UPDATE join_links SET panel_id = ? WHERE code_hash = ? AND panel_id = ?').bind(pn, l.code_hash, from.id)),
  ]);
  return { panel_id: pn, principal_id: pr, name: nm, moved: links.map(l => l.label), note: 'The links join this panel now, as they are. No key can place a call or a task on it. Set its owner with POST /internal/panels/' + pn + '/owner.' };
}

// POST /v1/member/sent/read {"task_ids": [...]}: the sender has read these answers (they leave answers_to_read; "new" turns false)
export async function markRead(env, m, b) {
  for (const k of Object.keys(b || {})) if (k !== 'task_ids') throw fixable('unknown_field', k, 'Send {"task_ids": ["tk_..."]}.', null);
  const ids = Array.isArray(b && b.task_ids) ? [...new Set(b.task_ids.map(String))].filter(x => /^tk_[a-z0-9]+$/.test(x)).slice(0, 80) : [];   // with the owner's principals, under D1's 100
  if (!ids.length) throw fixable('missing_field', 'task_ids', 'task_ids are the asks you sent whose answers you have read.', ['tk_...']);
  const owned = await ownedBy(env, m);
  if (!owned.length) throw notFixable(404, 'not_found', 'No ask you sent has those ids.');
  const r = await env.DB.prepare(`UPDATE tasks SET sender_seen_at = ? WHERE id IN (${ids.map(() => '?').join(',')}) AND principal_id IN (${owned.map(() => '?').join(',')}) AND sender_member_id IS NOT NULL`)
    .bind(nowMs(), ...ids, ...owned.map(o => o.principal_id)).run();
  return { read: r.meta.changes };
}

// ---- TRUST 12:31 PM CT 16 Nov: the one-tap leave deletes what asks between people, the Desk and the person's devices kept for them.
// The person's answers and their own notes on every ask addressed to (or answered by) this membership: the sender keeps only what it
// already read and sees "the person left"; the photos and clips their AIs sent; their mutes, daily limit, blocks, Desk sessions and the
// codes they approved, device key, owner rows and relay pairing. Called by the leave (app.js) and again by the timer before the row goes.
export async function leaveCleanup(env, memberId) {
  const id = String(memberId || ''); if (!id) return {};
  const out = {};
  const ts = (await env.DB.prepare('SELECT id, reply_json, notes_json FROM tasks WHERE answered_by = ? OR to_name = ?').bind(id, 'mb:' + id).all()).results || [];
  const gone = JSON.stringify({ person_left: true, note: 'The person left; their answer and their notes were deleted.' });
  const st = [];
  for (const t of ts) {
    let notes = []; try { notes = JSON.parse(t.notes_json || '[]'); } catch { }
    const kept = notes.filter(n => n.by !== 'person');
    if (!t.reply_json && kept.length === notes.length) continue;
    st.push(env.DB.prepare('UPDATE tasks SET reply_json = ?, notes_json = ? WHERE id = ?').bind(t.reply_json ? gone : null, JSON.stringify(kept), t.id));
  }
  out.answers_to_asks = st.length;
  try { const { deleteOwn } = await import('./own.js'); out.photos_and_clips = await deleteOwn(env, 'task_id IN (SELECT id FROM tasks WHERE answered_by = ? OR to_name = ?)', [id, 'mb:' + id], 200); } catch { }
  const del = [['mutes', 'DELETE FROM mutes WHERE member_id = ?'], ['daily_limit', 'DELETE FROM member_asks WHERE member_id = ?'], ['blocks', 'DELETE FROM blocks WHERE member_id = ?'],
    ['computers_signed_in', 'DELETE FROM desk_sessions WHERE member_id = ?'], ['sign_in_codes', 'DELETE FROM desk_codes WHERE approved_member_id = ?'], ['device_key', 'DELETE FROM device_keys WHERE member_id = ?'],
    ['owner_rows', 'DELETE FROM owner_members WHERE member_id = ?'], ['relay_envelopes', 'DELETE FROM lr_env WHERE pair_id IN (SELECT id FROM lr_pairs WHERE member_id = ?)'], ['relay_pairing', 'DELETE FROM lr_pairs WHERE member_id = ?']];
  for (let i = 0; i < st.length; i += 50) await env.DB.batch(st.slice(i, i + 50));
  for (const [name, sql] of del) { try { const r = await env.DB.prepare(sql).bind(id).run(); if (r.meta.changes) out[name] = r.meta.changes; } catch { } }
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return out;
}
// the timer: Desk sessions signed out or unused for 30 days, and sign-in codes an hour after they ran out (TRUST 12:31 PM CT 16 Nov)
export async function deskRetention(env, now) {
  const a = await env.DB.prepare('DELETE FROM desk_sessions WHERE revoked_at IS NOT NULL OR last_used_at < ?').bind(now - 30 * 86400000).run();
  const b = await env.DB.prepare('DELETE FROM desk_codes WHERE expires_at < ?').bind(now - 3600000).run();
  return { desk_sessions_deleted: a.meta.changes, desk_codes_deleted: b.meta.changes };
}

// ---- WEB 12:36 PM CT 16 Nov: the person's list reads everything in ONE round trip (each costs ~0.12 s from the function to the database).
// The deck's own reads as statements (memberTasks puts them in its batch), then read back without another query.
// "This person" here: the membership, those linked to its passkey account, and the owner memberships named with it.
const SELVES_SQL = 'SELECT ? AS id UNION SELECT member_id FROM person_members WHERE person_id = (SELECT person_id FROM person_members WHERE member_id = ?) UNION SELECT b.member_id FROM owner_members a JOIN owner_members b ON b.panel_id = a.panel_id WHERE a.member_id = ?';
export function deckStatements(env, m) {
  const sv = [m.id, m.id, m.id];
  return [
    env.DB.prepare('SELECT told_at FROM member_asks WHERE member_id = ?').bind(m.id),
    env.DB.prepare('SELECT name FROM panel_owners WHERE panel_id = ?').bind(m.panel_id),
    env.DB.prepare('SELECT 1 AS x FROM owner_members WHERE member_id = ? AND panel_id = ?').bind(m.id, m.panel_id),
    env.DB.prepare(`SELECT t.id, t.title, t.state, t.reply_json, t.answered_at, t.to_name, mm.alias AS mb_alias, mm.person_name AS mb_pname, mm.id AS mb_id
        FROM tasks t LEFT JOIN members mm ON t.to_name LIKE 'mb:%' AND mm.id = substr(t.to_name, 4)
        WHERE t.principal_id IN (SELECT po.principal_id FROM owner_members om JOIN panel_owners po ON po.panel_id = om.panel_id WHERE om.member_id IN (${SELVES_SQL}))
          AND t.sender_member_id IS NOT NULL AND t.answered_at IS NOT NULL AND t.answered_at > COALESCE(t.sender_seen_at, 0) ORDER BY t.answered_at DESC LIMIT 20`).bind(...sv),
    env.DB.prepare(`SELECT p.task_id, p.created_at AS passed_at, t.title, t.program, t.state, t.reply_json, mm.alias AS mb_alias, mm.person_name AS mb_pname, mm.id AS mb_id
        FROM task_passes p JOIN tasks t ON t.id = p.task_id LEFT JOIN members mm ON mm.id = p.to_member_id
        WHERE p.from_member_id IN (${SELVES_SQL}) ORDER BY p.created_at DESC LIMIT 50`).bind(...sv),
  ];
}
export function deckFromResults(m, rs) {
  const [told, owner, isOwner, answers, passes] = rs.map(r => r || []);
  const out = {};
  if (!(told[0] && told[0].told_at) && owner[0] && !isOwner[0]) {
    const name = owner[0].name;
    out.notice = { text: ownerLine(name), from: name, read: { method: 'POST', path: '/v1/member/people/notice' }, mute: 'Mute: POST /v1/member/mutes {"task_id"} on any ask from them', leave: { method: 'POST', path: '/v1/member/leave', body: { confirm: true } },
      note: 'Asks from a person reach your list once you have read this.' };
  }
  const nameOf = (r) => r.mb_id ? shownName({ alias: r.mb_alias, person_name: r.mb_pname }) : 'someone who left';
  if (answers.length) out.answers_to_read = answers.map(t => ({ task_id: t.id, title: t.title, from: t.to_name.startsWith('mb:') ? nameOf(t) : t.to_name, state: t.state,
    reply: t.reply_json ? JSON.parse(t.reply_json) : null, at: iso(t.answered_at), read: 'GET /v1/member/sent' }));
  if (passes.length) out.passed_on = passes.map(p => ({ task_id: p.task_id, title: p.title, from: p.program || 'one of your programs', passed_to: nameOf(p), passed_at: iso(p.passed_at),
    state: p.state, reply: p.reply_json ? JSON.parse(p.reply_json) : null }));
  return out;
}

// ---- OWNER_router_25 (the CEO, 1:52 PM CT 16 Nov): "Show the ask in my alerts", the person's own setting, off unless they turn it on.
// The words never ride in a push: an alert carries who and an id, and the client asks GET /v1/member/tasks/{id}/alert, which gives the first
// line (at most 80 characters, cut at a word, never media, never the whole ask) only while the setting is on. The phone's own preview
// setting still decides what shows on a locked screen (the client's part).
export async function alertWordsOf(env, memberId) {
  try { const r = await env.DB.prepare('SELECT alert_words FROM member_asks WHERE member_id = ?').bind(memberId).first(); return !!(r && r.alert_words); } catch { return false; }
}
// TRUST 1:55 PM CT 16 Nov: live for test members first, attacked, then opened (meta alert_words_open = 'all', POST /internal/alert_words_open)
export async function alertWordsAllowed(env, m) {
  if (!m.is_real) return true;
  try { const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'alert_words_open'").first(); return !!(r && r.v === 'all'); } catch { return false; }
}
export async function setAlertWords(env, m, on) {
  await env.DB.prepare('INSERT INTO member_asks (member_id, alert_words) VALUES (?, ?) ON CONFLICT(member_id) DO UPDATE SET alert_words = excluded.alert_words').bind(m.id, on ? 1 : 0).run();
}
// TRUST 2:38 PM CT 16 Nov: an alert's words are plain: no format or control characters (Cf, Cc), U+200D kept only between emoji
function plainText(v) {
  const out = [];
  for (const c of Array.from(String(v == null ? '' : v))) {
    if (!/[\p{Cc}\p{Cf}]/u.test(c)) { out.push(c); continue; }
    if (c === '\u200D' && out.length && /[\p{Extended_Pictographic}\u{FE0F}\u{1F3FB}-\u{1F3FF}]/u.test(out[out.length - 1])) out.push(c);
  }
  while (out.length && out[out.length - 1] === '\u200D') out.pop();
  for (let i = out.length - 2; i > 0; i--) if (out[i] === '\u200D' && !/\p{Extended_Pictographic}/u.test(out[i + 1])) out.splice(i, 1);
  return out.join('');
}
function firstLine(text, max = 80) {
  const one = String(text || '').split(/\r?\n/).map(x => plainText(x).trim()).find(Boolean) || '';
  if (one.length <= max) return one;
  const cut = one.slice(0, max - 1), sp = cut.lastIndexOf(' ');
  return (sp > 20 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '') + '\u2026';
}
// REACH 3:35 PM CT 16 Nov: a page of your own (made at /start) leads with the person's own AIs
export async function isOwnPage(env, m) {
  return !!(m && await env.DB.prepare("SELECT 1 AS x FROM panels WHERE id = ? AND join_code_hash LIKE 'self:%'").bind(m.panel_id).first());
}
export async function taskAlertLine(env, m, taskId) {
  const T = await import('./tasks.js'); const [w, args] = T.forMember(m);
  const t = await env.DB.prepare(`SELECT t.* FROM tasks t WHERE t.id = ? AND t.panel_id = ? AND ${w}`).bind(String(taskId || ''), m.panel_id, ...args).first();
  if (!t || (t.hold_until && t.hold_until > nowMs()) || ((t.sender_member_id || t.passed_by) && await hidesPersonAsks(env, m))) throw notFixable(404, 'not_found', 'No ask on your list has that id.');
  const from = (t.passed_by && t.passed_from) || t.program || 'one of your programs';
  const who = { from: plainText(from), ...(t.passed_by ? { passed_on_by: plainText(t.passed_by_name || 'one of your people') } : {}) };
  if (!(await alertWordsOf(env, m.id))) return { ...who, note: 'Only who is asking: turn on "Show the ask in my alerts" in your settings to see its first line here.' };
  const step = JSON.parse(t.step_json || '{}');
  const src = ['question', 'approve', 'link'].includes(step.type) && step.text ? step.text : t.title;
  const CT = await import('./contacts.js');   // OWNER_router_29: an alert draws a contact as their role, never their name
  return { ...who, line: firstLine(T.maskSecrets(CT.drawRoles(src, CT.parse(t.contacts_json))).v), note: 'Shown because you turned on "Show the ask in my alerts". Your phone\'s own preview setting decides what shows on a locked screen.' };
}
