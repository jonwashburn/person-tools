// Private panels (N1): a principal's own invited people. Making a panel and its join link need a live (real_) key that the
// owner listed (TEAM.md section 7); a test key gets forbidden_for_key_class (spec AUTH-4). Team keys see the team's test panels.
import { rid, nowMs, sha256hex, runnerBase, iso, teamCheck } from './util.js';
import { notFixable, fixable } from './spec.js';
import { isOn } from './rings.js';

export function requireListedReal(key, what) {
  if (!key || key.class !== 'real') throw fixable('forbidden_for_key_class', 'Authorization', `${what} needs a live key. A test key reaches the simulated pool: use pool "simulated".`, 'simulated', {}, 403);
}

export const OWN_PANELS_PER_PRINCIPAL = 3, LIVE_PANELS_PER_PRINCIPAL = 5;   // OWN_PANELS.md rule 1 (TRUST 4:26 AM CT)
export const OWN_PANEL_MAX_MEMBERS = 50, LIVE_PANEL_MAX_MEMBERS = 200, OWN_LINK_JOINS_PER_DAY = 25;   // rule 4
export const OWN_NOTICE_IDS = ['tester-notice-own-1'];   // legal/tester_notice_own.json (TRUST 4:13 AM CT)
export const PEOPLE_NOTICE_IDS = ['tester-notice-people-3', 'tester-notice-people-2'];   // TRUST 9:16: people-3 accepted; first once the page serves it   // TRUST 1:55 PM CT 16 Nov: people-2 adds the alerts sentence; people-1 still accepted   // legal/tester_notice_people.json (TRUST 8:19 PM CT 15 Nov; OWNER_router_23)
// rule 12: the name a principal gives itself, as people read it everywhere
export const askerDisplay = (n) => `${n} (named by the asker; not checked by person.tools)`;
import * as SCREENING from './screening/index.js';
import { screenTerms } from './private_terms.js';
export async function checkAskerName(v, ctx = {}) {
  const n = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  const bad = (why) => fixable('invalid_field', 'asker_name', `asker_name ${why}`, 'Maple Games');
  if (n.length < 2 || n.length > 60) throw bad('is 2 to 60 characters: the name your people know you by.');
  // the screen's own fold (homoglyphs, accents, case, digits read as letters), so "Bаnk" and "Acc0unt" read as what they say
  const f = typeof SCREENING.foldForNames === 'function' ? SCREENING.foldForNames(n) : n.toLowerCase();
  if (SCREENING.NAME_ADDRESS_RX instanceof RegExp && (SCREENING.NAME_ADDRESS_RX.test(f) || SCREENING.NAME_ADDRESS_RX.test(n.toLowerCase()))) throw bad('has no address, link, phone or email.');
  if (/@|https?:|www\.|\.(?:com|net|org|io|co|app|dev|ai|tools|us|uk)\b|\b\d[\d ().-]{6,}\d\b/i.test(n)) throw bad('has no address, link, phone or email.');
  if ([n, f].some(x => /person\s*\.?\s*tools|\bofficial\b|\bverified\b|\bcertified\b/i.test(x))) throw bad('may not say it is person.tools, official or verified.');
  // TRUST 4:28 AM CT: a principal's own members read this on the ring card; no bank, security, fraud or support desk, no
  // government body, no well-known company
  if ([n, f].some(x => /\b(?:bank|banking|credit union|security|fraud|support|help ?desk|customer (?:service|care)|account (?:team|services)|admin(?:istrator)?|police|sheriff|irs|tax|government|gov|federal|state of|apple|google|microsoft|amazon|paypal|venmo|zelle|cash ?app|meta|facebook|instagram|whatsapp|tiktok|netflix|chase|wells fargo|citi\w*)\b/i.test(x)))
    throw bad('may not claim a bank, a security, fraud or support desk, a government body or a well-known company: use the name your own people know you by.');
  try {
    const r = typeof SCREENING.screenOutcome === 'function' ? await SCREENING.screenOutcome(n, ctx) : null;
    // a name is not an ask, so screening calls every plain name "undecided": only a refusal, or a hold for any other reason
    // (a subject a person must read), turns it away
    const other = r && r.decision === 'HOLD' && ((r.hold && r.hold.reasons) || []).some(x => x.rule !== 'undecided');
    if (r && (r.decision === 'REFUSE' || other)) throw bad(`was not accepted by screening (${r.category || r.rule || 'held'}): choose the plain name your people know you by.`);
  } catch (e) { if (e && e.body) throw e; throw bad('could not be checked just now; send it again in a minute.'); }
  return n;
}
// The CEO 8:21 AM CT 15 Nov (with REACH): the panel reply hands the agent a message its user can forward as it stands: one
// sentence to the user, then the invite with the link and what the people will see (the join page's own notice says the same)
export function forwardMessage(askerName, joinUrl) {
  if (!askerName) return 'Your panel is made, but nobody can join it until you give the name your people know you by (asker_name); then I will give you the message to send them.';
  const invite = `${askerName} would like your quick reactions. Join on your phone in about two minutes: ${joinUrl || '<the join link you got when the panel was made>'}. It is unpaid; an AI asks each question for ${askerName}, you see each request before you answer, and you choose when you can be asked. Adults in the United States only.`;
  return `Your panel is ready. Send this to the people you want answers from: "${invite}"`;
}

// a panel a test key made: its own rules apply (OWN_PANELS.md)
export async function isOwnPanel(env, p) {
  if (!p || p.kind !== 'private') return false;
  const pr = await env.DB.prepare('SELECT class FROM principals WHERE id = ?').bind(p.principal_id).first();
  return !!(pr && pr.class !== 'real');
}
// OWNER_router_23 (TRUST 8:19 PM CT, operations 8:25): a panel made for one person's people (its principal is a person's, with no keys)
// has its own notice: who asks, that the owner sees each person's name beside their answers, the daily limit, mute, block, leave
// operations 3:53 PM CT 16 Nov: a panel the operator gave an owner (POST /internal/panels/{p}/owner) is joined as that person's people
async function hasOwner(env, p) { return !!(p && await env.DB.prepare('SELECT 1 AS x FROM panel_owners WHERE panel_id = ?').bind(p.id).first().catch(() => null)); }
export async function isPeoplePanel(env, p) {
  if (!p || p.kind !== 'private') return false;
  const r = await env.DB.prepare('SELECT 1 AS x FROM principals pr WHERE pr.id = ? AND pr.owner = \'person\' AND NOT EXISTS (SELECT 1 FROM keys k WHERE k.principal_id = pr.id)').bind(p.principal_id).first().catch(() => null);
  return !!r;
}
// The gate (OWNER_all_6: chief/PERSON_READY.md all SEEN, TRUST names what is unseen, the owner's yes): members of a panel a
// test key made are offered calls only once the operator opens it (meta own_panels_ring = open; bin/own_panels_ring).
export async function ownPanelsRingOpen(env) {
  try { const r = await env.DB.prepare('SELECT v FROM meta WHERE k = \'own_panels_ring\'').first(); return !!(r && r.v === 'open'); } catch { return false; }
}

async function panelOut(env, request, p, joinCode) {
  const ms = (await env.DB.prepare('SELECT * FROM members WHERE panel_id = ? AND left_at IS NULL').bind(p.id).all()).results || [];
  const now = nowMs();
  const o = { panel_id: p.id, name: p.name, kind: p.kind, pool: 'panel:' + p.id, members: ms.length, members_on_now: ms.filter(m => isOn(m, now)).length, anonymous: ms.length >= 5 };
  if (joinCode) o.join_url = runnerBase(request) + '/j/' + joinCode;
  if (p.asker_name) o.asker_name = p.asker_name;
  if (p.paused_at) o.paused = 'calls to this panel are paused while a person reads reports about them';
  return o;
}

export async function listPanels(env, request, key) {
  const rows = (await env.DB.prepare('SELECT * FROM panels WHERE principal_id = ? OR (? = 1 AND kind IN (\'team-test\',\'attack\')) ORDER BY created_at').bind(key.principal_id, key.team ? 1 : 0).all()).results || [];
  const panels = []; for (const p of rows) panels.push(await panelOut(env, request, p));
  return { panels, note: panels.length ? 'Use pool "panel:<panel_id>" in a call.' : 'No panels yet. A test key reaches pool "simulated".' };
}

export async function getPanel(env, request, key, id) {
  const p = await env.DB.prepare('SELECT * FROM panels WHERE (id = ? OR name = ?) AND (principal_id = ? OR (? = 1 AND kind IN (\'team-test\',\'attack\')))').bind(id, id, key.principal_id, key.team ? 1 : 0).first();
  if (!p) throw notFixable(404, 'not_found', 'No such panel for this key.');
  return panelOut(env, request, p);
}

export async function createPanel(env, request, key, b) {
  for (const k of Object.keys(b || {})) if (!['name', 'asker_name', 'idempotency_key', 'ext'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not a field here; send name, asker_name and idempotency_key.`, null);
  // OWNER_all_6 item 1 (the CEO, 3:56 AM CT 15 Nov): BRING YOUR OWN PEOPLE. Any key, a test key included, makes a private
  // panel of its own testers, customers or players and gets its join link; a key with no key must make a free one first.
  if (!key || key.anon) throw fixable('unauthorized', 'Authorization', 'Making a panel needs a key: make a free test key with POST /v1/keys, then make the panel with it.', 'Bearer test_...', {}, 401);
  const name = String(b.name || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]{1,59}$/.test(name)) throw fixable(b.name === undefined ? 'missing_field' : 'invalid_field', 'name', 'A panel name is 2 to 60 letters, digits, spaces, dots, hyphens or underscores.', 'album listeners');
  const existing = await env.DB.prepare('SELECT * FROM panels WHERE principal_id = ? AND name = ?').bind(key.principal_id, name).first();
  if (existing) {   // the same name is the same panel (idempotent); its join link was given once, when it was made
    if (b.asker_name !== undefined && key.class !== 'real') return setAskerName(env, request, key, existing.id, { asker_name: b.asker_name });   // name it through the same tool
    const o = await panelOut(env, request, existing);
    o.join_link = `The join link was given when this panel was made; POST /v1/panels/${existing.id}/join_link gives a new one (the old one stops working).`;
    return o;
  }
  {
    const most = key.class === 'real' ? LIVE_PANELS_PER_PRINCIPAL : OWN_PANELS_PER_PRINCIPAL;
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM panels WHERE principal_id = ? AND kind = \'private\' AND join_code_hash NOT LIKE \'gone:%\'').bind(key.principal_id).first();
    if (n && n.n >= most) throw fixable('invalid_field', 'name', `A key's principal may make at most ${most} panels for now; use one of yours (GET /v1/panels lists them) by its name.`, null);
  }
  const askerName = key.class !== 'real' && b.asker_name !== undefined ? await checkAskerName(b.asker_name, await screenTerms(env)) : null;
  const id = rid('p_'); const code = rid('jc_', 24);
  await env.DB.prepare('INSERT INTO panels (id, principal_id, name, kind, join_code_hash, created_at, asker_name) VALUES (?,?,?,?,?,?,?)').bind(id, key.principal_id, name, 'private', await sha256hex(code), nowMs(), askerName).run();
  const o = await panelOut(env, request, { id, name, kind: 'private' }, code);
  o.note = 'Send the join link only to adults you know. Each person reads the notice, says they are an adult, and chooses when they can be asked.';
  if (key.class !== 'real') {
    const open = await ownPanelsRingOpen(env);
    o.note = 'Send the join link to your own testers, customers or players (adults in the United States, for now): each joins on a phone in about two minutes, reads the notice and chooses when they can be asked. '
      + `Calls to them are free at zero pay (pay_per_person_usd "0.00"); call with pool "panel:${id}".`
      + (open ? '' : ' Your people can join now; ringing them opens once our last safety checks for panels like yours are done, and a call to them waits until then.');
    o.ringing = open ? 'open' : 'not yet: your people can join; calls wait until our last safety checks are done';
    o.asker_name = askerName;
    o.for_your_user = forwardMessage(askerName, o.join_url);
    if (!askerName) o.join_link_opens = `Nobody can join until you name yourself: POST /v1/panels/${id} with {"asker_name": "who answers for these calls"} (2 to 60 characters; no address, link, phone or email). People see it as "<name> (named by the asker; not checked by person.tools)".`;
  }
  return o;
}

import { BUILD } from './build_info.js';
export const CURRENT_NOTICE = BUILD.notice_id || 'tester-notice-2';   // legal/tester_notice.json's id, read at build
// While a new notice rolls out, the page may still show the one before it (the runner rebuilds after the API): both are
// accepted, and the member row records the one the person was shown (trust, 7:36 AM CT).
export const ACCEPTED_NOTICES = [CURRENT_NOTICE, ...(BUILD.notice_previous_id ? [BUILD.notice_previous_id] : [])];

// Rule 10: a principal's panels go (its account deleted, or a test principal idle 30 days). Each member still on one is
// switched Off and left, and told once, in one line, that the panel is gone (members.gone_note, cleared when shown); the
// panel takes nobody more. Returns how many members are still to be removed before the panels and the principal can go.
export async function closePrincipalPanels(env, principalId, why) {
  const now = nowMs();
  const ps = (await env.DB.prepare('SELECT * FROM panels WHERE principal_id = ? AND kind = \'private\'').bind(principalId).all()).results || [];
  for (const p of ps) {
    const who = p.asker_name ? askerDisplay(p.asker_name) : p.name;
    await env.DB.batch([
      env.DB.prepare(`UPDATE members SET left_at = ?, on_state = 'off', on_until = NULL, push_json = NULL, apns_token = NULL, apns_env = NULL, alias = '',
          gone_note = ? WHERE panel_id = ? AND left_at IS NULL`).bind(now, `The panel "${p.name}" is gone: ${who} ${why}. Nothing more will come from it, and nothing about you is kept.`, p.id),
      env.DB.prepare('UPDATE panels SET join_code_hash = ? WHERE id = ? AND join_code_hash NOT LIKE \'gone:%\'').bind('gone:' + rid('', 12), p.id),
    ]);
  }
  const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM members WHERE panel_id IN (SELECT id FROM panels WHERE principal_id = ?)').bind(principalId).first();
  if (left && left.n === 0) await env.DB.prepare('DELETE FROM panels WHERE principal_id = ?').bind(principalId).run();
  return (left && left.n) || 0;
}

// The asker's name for a panel it made (rule 12): POST /v1/panels/{id} {"asker_name"}
export async function setAskerName(env, request, key, panelId, b) {
  if (!key || key.anon) throw fixable('unauthorized', 'Authorization', 'A key is needed.', 'Bearer test_...', {}, 401);
  for (const k of Object.keys(b || {})) if (k !== 'asker_name') throw fixable('unknown_field', k, `"${k}" is not a field here; send asker_name.`, null);
  const p = await env.DB.prepare('SELECT * FROM panels WHERE id = ? AND principal_id = ? AND kind = \'private\'').bind(String(panelId || ''), key.principal_id).first();
  if (!p) throw notFixable(404, 'not_found', 'No panel of yours has that id (GET /v1/panels lists them).');
  const n = await checkAskerName(b && b.asker_name, await screenTerms(env));
  await env.DB.prepare('UPDATE panels SET asker_name = ? WHERE id = ?').bind(n, p.id).run();
  const o = await panelOut(env, request, { ...p, asker_name: n });
  o.asker_name = n; o.shown_as = askerDisplay(n);
  o.note = 'Your people now see this name on the join notice, each call and each receipt. Your join link works.';
  o.for_your_user = forwardMessage(n, null);
  return o;
}

// Revoke a panel's join link (rule 3): nobody more joins through it; people who joined stay
export async function revokeJoinLink(env, request, key, panelId) {
  if (!key || key.anon) throw fixable('unauthorized', 'Authorization', 'A key is needed.', 'Bearer test_...', {}, 401);
  const p = await env.DB.prepare('SELECT * FROM panels WHERE id = ? AND principal_id = ? AND kind = \'private\'').bind(String(panelId || ''), key.principal_id).first();
  if (!p) throw notFixable(404, 'not_found', 'No panel of yours has that id (GET /v1/panels lists them).');
  await env.DB.prepare('UPDATE panels SET join_code_hash = ? WHERE id = ?').bind('revoked:' + rid('', 16), p.id).run();
  return { panel_id: p.id, join_link: 'revoked: nobody more can join through it; POST /v1/panels/' + p.id + '/join_link makes a new one' };
}

// A new join link for a panel of this key's principal (the old link stops working; people who joined stay)
export async function newJoinLink(env, request, key, panelId) {
  if (!key || key.anon) throw fixable('unauthorized', 'Authorization', 'A key is needed.', 'Bearer test_...', {}, 401);
  const p = await env.DB.prepare('SELECT * FROM panels WHERE id = ? AND principal_id = ? AND kind = \'private\'').bind(String(panelId || ''), key.principal_id).first();
  if (!p) throw notFixable(404, 'not_found', 'No panel of yours has that id (GET /v1/panels lists them).');
  const code = rid('jc_', 24);
  await env.DB.prepare('UPDATE panels SET join_code_hash = ? WHERE id = ?').bind(await sha256hex(code), p.id).run();
  const o = await panelOut(env, request, p, code);
  o.note = 'A new join link: the old one no longer works; people who already joined stay on the panel.';
  if (p.asker_name) o.for_your_user = forwardMessage(p.asker_name, o.join_url);
  return o;
}

// A join code opens its panel: the panel's own link, or one of its per-person links (not revoked, not used up)
async function panelByCode(env, code) {
  const h = await sha256hex(String(code || ''));
  const p = await env.DB.prepare('SELECT * FROM panels WHERE join_code_hash = ?').bind(h).first();
  if (p) return { p, link: null };
  const l = await env.DB.prepare('SELECT * FROM join_links WHERE code_hash = ? AND revoked_at IS NULL AND (max_joins IS NULL OR joins < max_joins)').bind(h).first().catch(() => null);
  if (!l) return { p: null, link: null };
  return { p: await env.DB.prepare('SELECT * FROM panels WHERE id = ?').bind(l.panel_id).first(), link: l };
}

// A link for one named person (owner 8:33 AM CT 15 Nov): POST /v1/panels/{id}/join_links {"label": "emma", "max_joins": 1}.
// Other links stay as they are; the label becomes that person's name for tasks when they join.
export async function newPersonLink(env, request, key, panelId, b) {
  if (!key || key.anon) throw fixable('unauthorized', 'Authorization', 'A key is needed.', 'Bearer test_...', {}, 401);
  for (const k of Object.keys(b || {})) if (!['label', 'max_joins'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not a field here; send label and max_joins.`, null);
  const p = await env.DB.prepare('SELECT * FROM panels WHERE id = ? AND principal_id = ? AND kind = \'private\'').bind(String(panelId || ''), key.principal_id).first();
  if (!p) throw notFixable(404, 'not_found', 'No panel of yours has that id (GET /v1/panels lists them).');
  const label = b.label === undefined ? null : String(b.label).trim().toLowerCase();
  if (label !== null && !/^[a-z][a-z0-9 _-]{0,39}$/.test(label)) throw fixable('invalid_field', 'label', 'label is the person this link is for: 1 to 40 letters, digits, spaces, hyphens.', 'emma');
  if (label !== null) {   // TRUST 9:24: a second "ann" link joined a second "ann"; a label names one person
    const used = await env.DB.prepare('SELECT 1 AS x FROM members WHERE panel_id = ? AND person_name = ? AND left_at IS NULL UNION ALL SELECT 1 FROM join_links WHERE panel_id = ? AND label = ? AND revoked_at IS NULL AND (max_joins IS NULL OR joins < max_joins) LIMIT 1').bind(p.id, label, p.id, label).first();
    if (used) throw fixable('invalid_field', 'label', `"${label}" already names someone on this panel (or has a link waiting); choose another label.`, label + '-2');
  }
  const max = b.max_joins === undefined ? (label !== null ? 1 : null) : Number(b.max_joins);   // a labelled link is single-use unless said otherwise
  if (max !== null && !(Number.isInteger(max) && max >= 1 && max <= 200)) throw fixable('invalid_field', 'max_joins', 'max_joins is 1 (one person) to 200.', 1);
  const code = rid('jc_', 24);
  await env.DB.prepare('INSERT INTO join_links (code_hash, panel_id, label, max_joins, joins, created_at) VALUES (?,?,?,?,0,?)').bind(await sha256hex(code), p.id, label, max, nowMs()).run();
  const o = await panelOut(env, request, p, code);
  o.label = label; o.max_joins = max;
  o.note = 'A link for ' + (label ? `"${label}"` : 'one more person') + (max ? `, good for ${max} join${max === 1 ? '' : 's'}` : '') + '. Your other links still work.';
  if (p.asker_name) o.for_your_user = forwardMessage(p.asker_name, o.join_url);
  return o;
}

// What the join page may show before anyone joins: the panel's name and size (no member data).
export async function joinInfo(env, request, code) {
  const { p } = await panelByCode(env, code);
  if (!p) throw notFixable(404, 'not_found', 'This join link is not valid.');
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM members WHERE panel_id = ? AND left_at IS NULL').bind(p.id).first();
  if (await isPeoplePanel(env, p) || await hasOwner(env, p)) {   // OWNER_router_23: the people notice, with the owner's checked name (an owned panel too: operations 3:53 PM CT 16 Nov)
    const o = await env.DB.prepare('SELECT name FROM panel_owners WHERE panel_id = ?').bind(p.id).first().catch(() => null);
    if (!o) throw notFixable(404, 'not_found', 'This panel is not open for joining yet: it has no owner.');
    return { panel: { name: p.name, members: n.n, anonymous: n.n >= 5 }, people: true, owner_name: o.name,
      notice_id: PEOPLE_NOTICE_IDS[0], accepted_notice_ids: PEOPLE_NOTICE_IDS, notice_url: '/tester_notice_people.json', attestations: attest(PEOPLE_NOTICE_IDS[0]) };
  }
  if (await isOwnPanel(env, p)) {
    if (!p.asker_name) throw notFixable(404, 'not_found', 'This panel is not open for joining yet: whoever made it has not named themselves.');
    return { panel: { name: p.name, members: n.n, anonymous: n.n >= 5 }, own: true, asker: askerDisplay(p.asker_name), principal_name: p.asker_name,
      notice_id: OWN_NOTICE_IDS[0], accepted_notice_ids: OWN_NOTICE_IDS, notice_url: '/tester_notice_own.json', attestations: attest(OWN_NOTICE_IDS[0]) };
  }
  return { panel: { name: p.name, members: n.n, anonymous: n.n >= 5 }, notice_id: CURRENT_NOTICE, accepted_notice_ids: ACCEPTED_NOTICES, attestations: attest(CURRENT_NOTICE) };
}

// The runner's join page posts here: {adult: true, us_resident: true, notice_accepted: true, notice_id, tz, quiet_start, quiet_end, alias}
// WEB gap 26 (router_12 item 3): the join's attestations, named: the body POST /v1/join/{code} needs, word for word
const attest = (noticeId) => ({ send: { adult: true, us_resident: true, notice_accepted: true, notice_id: noticeId }, optional: ['alias', 'tz', 'quiet_start', 'quiet_end'],
  means: 'adult: you are 18 or older; us_resident: you live in the United States; notice_accepted with notice_id: you read this notice and accept it' });
export async function joinPanel(env, request, code, body) {
  const { p, link } = await panelByCode(env, code);
  if (!p) throw notFixable(404, 'not_found', 'This join link is not valid.');
  if (!body || body.adult !== true) throw fixable('invalid_field', 'adult', 'Only adults may join. Confirm you are 18 or older.', true);
  if (body.notice_accepted !== true) throw fixable('invalid_field', 'notice_accepted', 'Read and accept the notice first.', true);
  const own = await isOwnPanel(env, p), people = (await isPeoplePanel(env, p)) || (await hasOwner(env, p));   // an owned panel takes the people notice (operations 3:53 PM CT 16 Nov)
  if (own && !p.asker_name) throw notFixable(404, 'not_found', 'This panel is not open for joining yet: whoever made it has not named themselves.');
  if (people && !(await env.DB.prepare('SELECT 1 AS x FROM panel_owners WHERE panel_id = ?').bind(p.id).first().catch(() => null))) throw notFixable(404, 'not_found', 'This panel is not open for joining yet: it has no owner.');
  const notices = people ? PEOPLE_NOTICE_IDS : own ? OWN_NOTICE_IDS : ACCEPTED_NOTICES;   // OWNER_router_23: a people panel takes only its own notice
  if (!notices.includes(body.notice_id)) throw fixable('invalid_field', 'notice_id', 'The notice accepted is not the current one; read the current notice and accept it.', notices[0]);
  if (!own && p.kind === 'private') {   // rule 4: a live key's panel holds 200
    const m = await env.DB.prepare('SELECT COUNT(*) AS n FROM members WHERE panel_id = ? AND left_at IS NULL').bind(p.id).first();
    if (m && m.n >= LIVE_PANEL_MAX_MEMBERS) throw notFixable(409, 'panel_full', `This panel is full (${LIVE_PANEL_MAX_MEMBERS} people). Nothing about you was kept.`);
  }
  if (own) {   // rule 4: a link cannot gather a crowd
    const m = await env.DB.prepare('SELECT COUNT(*) AS n FROM members WHERE panel_id = ? AND left_at IS NULL').bind(p.id).first();
    if (m && m.n >= OWN_PANEL_MAX_MEMBERS) throw notFixable(409, 'panel_full', `This panel is full (${OWN_PANEL_MAX_MEMBERS} people). Nothing about you was kept.`);
    const d = await env.DB.prepare('SELECT COUNT(*) AS n FROM members WHERE panel_id = ? AND created_at > ?').bind(p.id, nowMs() - 86400000).first();
    if (d && d.n >= OWN_LINK_JOINS_PER_DAY) throw notFixable(429, 'rate_limited', `This link has taken ${OWN_LINK_JOINS_PER_DAY} people today; try again tomorrow. Nothing about you was kept.`, { retry_after_seconds: 3600 });
  }
  if (body.us_resident !== true) throw fixable('invalid_field', 'us_resident', 'For now only adults living in the United States may join.', true);
  const tz = typeof body.tz === 'string' && body.tz.length < 60 ? body.tz : 'America/Chicago';
  const qs = Number.isInteger(body.quiet_start) && body.quiet_start >= 0 && body.quiet_start < 24 ? body.quiet_start : 21;
  const qe = Number.isInteger(body.quiet_end) && body.quiet_end >= 0 && body.quiet_end < 24 ? body.quiet_end : 8;
  const token = rid('mt_', 32); const id = rid('mb_'); const now = nowMs();
  // OWNER_router_5 item 2: a join made with the team's check header, or on a panel of a team check principal (not the operator's
  // own, like the owner's), is one of our tools, never a person: it never counts and never rings as one
  const pp = p.principal_id ? await env.DB.prepare('SELECT class, owner FROM principals WHERE id = ?').bind(p.principal_id).first() : null;
  const ourTool = teamCheck(env, request) || !!(pp && pp.owner === 'team' && pp.class !== 'real');
  const isReal = p.kind === 'private' && !ourTool ? 1 : 0;
  if (link) {   // a per-person link: counted (and closed when used up) before anyone is added
    const u = await env.DB.prepare('UPDATE join_links SET joins = joins + 1 WHERE code_hash = ? AND revoked_at IS NULL AND (max_joins IS NULL OR joins < max_joins)').bind(link.code_hash).run();
    if (u.meta.changes !== 1) throw notFixable(404, 'not_found', 'This join link has been used. Ask whoever sent it for a new one.');
  }
  await env.DB.prepare('INSERT INTO members (id, panel_id, token_hash, alias, is_real, tz, quiet_start, quiet_end, on_state, adult_at, notice_id, notice_at, us_resident_at, created_at, person_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, p.id, await sha256hex(token), String(body.alias || '').slice(0, 40), isReal, tz, qs, qe, 'off', now, body.notice_id, now, now, now, link && link.label ? link.label : null).run();
  if (link && link.label) { const { inheritSounds } = await import('./seats.js'); await inheritSounds(env, id); }   // OWNER_router_6: the person's own choice follows them
  return { member_id: id, member_token: token, page: runnerBase(request) + '/m/' + token, panel: p.name, on: 'off',
    note: 'You are Off until you switch On. Keep this link: it is how you see calls and your receipts, and how you leave.' };
}

// The member's own switch: On, Off, or On for a time (2 hours unless chosen; 12 at most).
export async function setOn(env, request, memberToken, body) {
  const { memberByToken } = await import('./seats.js');   // a Desk (ds_) or passkey (ps_) session acts for its membership here too
  const m = await memberByToken(env, String(memberToken || '')).catch(() => null);
  if (!m) throw notFixable(404, 'not_found', 'This link is not valid.');
  const st = body && body.on;
  let on_state = 'off', on_until = null;
  if (st === true || st === 'on') {
    on_state = 'on_until';
    let h = Number(body.hours) || 2;
    if (body.until !== undefined) {   // WEB 6:23 PM CT 15 Nov: SPEC 8.1's field; the same bounds as hours (15 minutes to 12 hours)
      const t = Date.parse(String(body.until));
      if (!Number.isFinite(t) || t <= nowMs()) throw fixable('invalid_field', 'until', 'until is a time in the future (ISO 8601), at most 12 hours away.', new Date(nowMs() + 3600000).toISOString());
      h = (t - nowMs()) / 3600000;
    }
    h = Math.min(12, Math.max(0.25, h)); on_until = nowMs() + h * 3600000;
  }
  if (st === 'always') on_state = 'on';
  await env.DB.prepare('UPDATE members SET on_state = ?, on_until = ?, missed_rings = 0 WHERE id = ?').bind(on_state, on_until, m.id).run();
  return { member_id: m.id, on: on_state, on_until: iso(on_until) };
}
