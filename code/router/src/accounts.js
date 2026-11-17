// ACCOUNTS BY PASSKEY (owner/OWNER_router_10 A, 12:54 PM CT 15 Nov 2026). One account per person: a passkey for person.tools, the same
// credential for the app and the web; Face ID (or the device's own check) is the sign-in. No email, no password, no account in between.
// A person holds their memberships (each joined by presenting its own credential while signed in; never by name) and their devices;
// a second device is a second passkey. Losing every device is an open case: nothing here recovers an account automatically.
// Routes (SPEC 8.1 names): POST /v1/account/passkey/options and /v1/account/passkey (register, signed in by a member credential or a
// session); POST /v1/account/login/options and /v1/account/login (sign in: a session credential ps_...); GET /v1/account; POST
// /v1/account/logout. Keys, challenges and sessions are kept as the browser gives them or hashed; never a secret in a log.
import { rid, nowMs, iso, sha256hex } from './util.js';
import { fixable, notFixable } from './spec.js';
import { RP_ID, ALGS, b64u, verifyRegistration, verifyAssertion } from './webauthn.js';

const DAY = 86400000;
const SESSION_DAYS = 30;
const CHALLENGE_MS = 5 * 60000;
const te = new TextEncoder();

const bearer = (request) => { const m = /^Bearer\s+(\S+)$/i.exec((request.headers.get('authorization') || '').trim()); return m ? m[1] : null; };

// the member a credential names (mt_...), and its person (made on first use, folding the same name's memberships on that principal)
async function memberOf(env, tok) {
  const m = await env.DB.prepare('SELECT * FROM members WHERE token_hash = ? AND left_at IS NULL').bind(await sha256hex(tok)).first();
  if (!m) throw notFixable(401, 'unauthorized', 'That member credential is not valid (or the member has left).');
  return m;
}
async function personForMember(env, m, make) {
  const pm = await env.DB.prepare('SELECT person_id FROM person_members WHERE member_id = ?').bind(m.id).first();
  if (pm) return pm.person_id;
  if (!make) return null;
  const id = rid('pe_'), now = nowMs();
  const st = [env.DB.prepare('INSERT INTO persons (id, created_at) VALUES (?, ?)').bind(id, now), env.DB.prepare('INSERT OR IGNORE INTO person_members (member_id, person_id, added_at) VALUES (?, ?, ?)').bind(m.id, id, now)];
  // The CEO 1:56 PM CT (SPEC 4.5.1a): NO folding by name anywhere, the operator's own panels included. A membership joins a person only
  // when that person, signed in, presents the membership's own credential (POST /v1/account/memberships).
  await env.DB.batch(st);
  return id;
}
async function sessionPerson(env, tok) {
  const s = await env.DB.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?').bind(await sha256hex(tok), nowMs()).first();
  if (!s) throw notFixable(401, 'unauthorized', 'That session has ended; sign in again with your passkey.');
  await env.DB.prepare('UPDATE sessions SET last_used_at = ? WHERE token_hash = ?').bind(nowMs(), s.token_hash).run();
  return s.person_id;
}
// -> person id for a request signed in by a session (ps_) or a member credential (mt_); make: create the person for a member.
// register: a member credential adds a passkey only to a person who has none yet (TRUST 1:29); after that, only a signed-in session.
export async function personOf(env, request, make = false, register = false) {
  const tok = bearer(request);
  if (tok && /^ps_[a-z0-9]{20,80}$/.test(tok)) return sessionPerson(env, tok);
  if (tok && /^mt_[a-z0-9]{4,80}$/.test(tok)) {
    const p = await personForMember(env, await memberOf(env, tok), make); if (!p) throw notFixable(404, 'not_found', 'This membership has no account yet: add a passkey first.');
    if (register && (await env.DB.prepare('SELECT 1 AS x FROM passkeys WHERE person_id = ? LIMIT 1').bind(p).first())) throw notFixable(403, 'forbidden', 'This account already has a passkey: sign in with it ("Bearer ps_...") to add another.');
    return p;
  }
  throw fixable('unauthorized', 'Authorization', 'Send your member credential ("Bearer mt_...") or your session ("Bearer ps_...").', 'Bearer mt_...', {}, 401);
}

async function challenge(env, purpose, personId) {
  const id = rid('wc_'), c = b64u(crypto.getRandomValues(new Uint8Array(32))), now = nowMs();
  await env.DB.batch([env.DB.prepare('DELETE FROM webauthn_challenges WHERE expires_at < ?').bind(now),
    env.DB.prepare('INSERT INTO webauthn_challenges (id, purpose, challenge, person_id, expires_at) VALUES (?, ?, ?, ?, ?)').bind(id, purpose, c, personId || null, now + CHALLENGE_MS)]);
  return { id, challenge: c };
}
async function takeChallenge(env, id, purpose) {   // one use only
  const c = await env.DB.prepare('DELETE FROM webauthn_challenges WHERE id = ? AND purpose = ? RETURNING challenge, person_id, expires_at').bind(String(id || ''), purpose).first();
  if (!c || c.expires_at < nowMs()) throw fixable('invalid_field', 'challenge_id', 'That challenge is unknown, used, or older than five minutes: ask for new options.', null, {}, 400);
  return c;
}

export async function passkeyOptions(env, request) {
  const person = await personOf(env, request, true, true);
  const p = await env.DB.prepare('SELECT handle FROM persons WHERE id = ?').bind(person).first();
  const keys = (await env.DB.prepare('SELECT id FROM passkeys WHERE person_id = ?').bind(person).all()).results || [];
  const c = await challenge(env, 'register', person);
  const name = (p && p.handle) || 'person.tools account';
  return { challenge_id: c.id, publicKey: {
    rp: { id: RP_ID, name: 'person.tools' }, user: { id: b64u(te.encode(person)), name, displayName: name }, challenge: c.challenge,
    pubKeyCredParams: ALGS.map((alg) => ({ type: 'public-key', alg })), timeout: CHALLENGE_MS, attestation: 'none',
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    excludeCredentials: keys.map((k) => ({ type: 'public-key', id: k.id })) } };
}
export async function addPasskey(env, request, b) {
  const person = await personOf(env, request, true, true);
  const c = await takeChallenge(env, b && b.challenge_id, 'register');
  if (c.person_id !== person) throw fixable('invalid_field', 'challenge_id', 'That challenge was made for another account.', null, {}, 400);
  let k; try { k = await verifyRegistration(b && b.credential, { challenge: c.challenge }); } catch (e) { throw fixable('invalid_field', 'credential', 'The passkey was not accepted: ' + String(e && e.message || e).slice(0, 120), null, {}, 400); }
  if (await env.DB.prepare('SELECT 1 AS x FROM passkeys WHERE id = ?').bind(k.id).first()) throw notFixable(409, 'already_registered', 'This passkey is already on an account.');
  const name = typeof (b && b.name) === 'string' && b.name.trim() ? b.name.trim().slice(0, 40) : null, now = nowMs();
  await env.DB.prepare('INSERT INTO passkeys (id, person_id, alg, jwk, sign_count, backed_up, transports, name, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(k.id, person, k.alg, JSON.stringify(k.jwk), k.signCount, k.backedUp ? 1 : 0, JSON.stringify(k.transports), name, now).run();
  return { person_id: person, passkey: { id: k.id.slice(0, 12) + '…', name, created_at: iso(now), backed_up: k.backedUp }, note: 'Sign in with it on any device that holds it: POST /v1/account/login/options, then /v1/account/login.' };
}

export async function loginOptions(env) {
  const c = await challenge(env, 'login', null);
  return { challenge_id: c.id, publicKey: { challenge: c.challenge, rpId: RP_ID, timeout: CHALLENGE_MS, userVerification: 'required', allowCredentials: [] } };
}
export async function login(env, request, b) {
  const c = await takeChallenge(env, b && b.challenge_id, 'login');
  const cred = b && b.credential;
  const pk = cred && typeof cred.id === 'string' ? await env.DB.prepare('SELECT * FROM passkeys WHERE id = ?').bind(cred.id).first() : null;
  if (!pk) throw notFixable(401, 'unauthorized', 'This passkey is not on any account here.');
  let r; try { r = await verifyAssertion(cred, { alg: pk.alg, jwk: JSON.parse(pk.jwk), signCount: pk.sign_count }, { challenge: c.challenge }); }
  catch (e) { throw notFixable(401, 'unauthorized', 'Sign-in failed: ' + String(e && e.message || e).slice(0, 120)); }
  if (r.userHandle && r.userHandle !== b64u(te.encode(pk.person_id))) throw notFixable(401, 'unauthorized', 'Sign-in failed: the passkey names another account.');
  const tok = rid('ps_', 40), now = nowMs();
  await env.DB.batch([
    env.DB.prepare('UPDATE passkeys SET sign_count = ?, last_used_at = ?, backed_up = ? WHERE id = ?').bind(r.signCount, now, r.backedUp ? 1 : 0, pk.id),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('INSERT INTO sessions (token_hash, person_id, passkey_id, created_at, expires_at, last_used_at) VALUES (?,?,?,?,?,?)').bind(await sha256hex(tok), pk.person_id, pk.id, now, now + SESSION_DAYS * DAY, now),
  ]);
  return { session: tok, person_id: pk.person_id, expires_at: iso(now + SESSION_DAYS * DAY), note: 'Send it as "Authorization: Bearer ps_..." to /v1/account. Keep it like a key; POST /v1/account/logout ends it.' };
}
export async function logout(env, request) {
  const tok = bearer(request);
  if (!tok || !/^ps_/.test(tok)) throw fixable('unauthorized', 'Authorization', 'Send the session to end.', 'Bearer ps_...', {}, 401);
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256hex(tok)).run();
  return { signed_out: true };
}
export async function account(env, request) {
  const person = await personOf(env, request, false);
  const p = await env.DB.prepare('SELECT id, handle, created_at FROM persons WHERE id = ?').bind(person).first();
  const ms = (await env.DB.prepare(`SELECT m.id, m.person_name, m.on_state, m.created_at, m.apns_token IS NOT NULL AS apple, m.push_json IS NOT NULL AS web, p.name AS panel_name, pr.name AS principal_name
      FROM person_members x JOIN members m ON m.id = x.member_id JOIN panels p ON p.id = m.panel_id JOIN principals pr ON pr.id = p.principal_id
      WHERE x.person_id = ? AND m.left_at IS NULL ORDER BY m.created_at`).bind(person).all()).results || [];
  const ks = (await env.DB.prepare('SELECT id, name, created_at, last_used_at, backed_up FROM passkeys WHERE person_id = ? ORDER BY created_at').bind(person).all()).results || [];
  return { person_id: p.id, handle: p.handle || null, made_at: iso(p.created_at),
    memberships: ms.map((m) => ({ member_id: m.id, panel: m.panel_name, asked_by: m.principal_name, name_on_panel: m.person_name || null, on: m.on_state === 'on', joined_at: iso(m.created_at) })),
    passkeys: ks.map((k) => ({ id: k.id.slice(0, 12) + '…', name: k.name, made_at: iso(k.created_at), last_used_at: iso(k.last_used_at), synced: !!k.backed_up })),
    devices: ms.map((m) => ({ member_id: m.member_id || m.id, apple_push: !!m.apple, web_push: !!m.web })),
    open_case: 'Losing every device: a member is vouched for again by the panel\'s owner; nothing recovers an account automatically yet.' };
}

// TRUST 1:29: a membership joins a signed-in person only by its own credential: POST /v1/account/memberships {"member_credential": "mt_..."}
export async function linkMembership(env, request, b) {
  const tok = bearer(request);
  if (!tok || !/^ps_[a-z0-9]{20,80}$/.test(tok)) throw fixable('unauthorized', 'Authorization', 'Sign in with your passkey first ("Bearer ps_...").', 'Bearer ps_...', {}, 401);
  const person = await sessionPerson(env, tok);
  const mt = b && b.member_credential;
  if (typeof mt !== 'string' || !/^mt_[a-z0-9]{4,80}$/.test(mt)) throw fixable('invalid_field', 'member_credential', 'member_credential is the membership\'s own credential (mt_...), in the body, never in an address.', null);
  const m = await memberOf(env, mt);
  const had = await env.DB.prepare('SELECT person_id FROM person_members WHERE member_id = ?').bind(m.id).first();
  if (had && had.person_id !== person) throw notFixable(409, 'conflict', 'This membership belongs to another account.');
  if (!had) await env.DB.prepare('INSERT INTO person_members (member_id, person_id, added_at) VALUES (?, ?, ?)').bind(m.id, person, nowMs()).run();
  return { person_id: person, member_id: m.id, linked: true };
}

// THE STRANGER'S OWN PAGE (operations 2:22 PM CT, the CEO 2:21: a person makes a connection without us). Anyone may make their own
// person.tools page: their own private panel with only themselves on it, so their own AIs can ask them (POST /v1/account/start, no key).
// Nobody can join that panel (it has no join link), it counts as nobody's outside principal (owner 'person'), and it reaches only them.
// A few a day from one address, so it cannot be farmed.
export async function startPage(env, request, b, ipHash, teamHeader) {
  const { ACCEPTED_NOTICES } = await import('./panels.js');
  for (const k of Object.keys(b || {})) if (!['adult', 'us_resident', 'notice_accepted', 'notice_id', 'tz', 'quiet_start', 'quiet_end'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not a field here.`, null);
  if (!b || b.adult !== true) throw fixable('invalid_field', 'adult', 'Only adults may make a page. Confirm you are 18 or older.', true);
  if (b.us_resident !== true) throw fixable('invalid_field', 'us_resident', 'For now only adults living in the United States may make a page.', true);
  // TRUST 3:08 PM CT 16 Nov: a page of your own accepts its own notice (SELF_NOTICE_IDS); the general ids stay accepted only until the page
  // that sends self-1 is live everywhere (step 2 takes them out)
  const SELF_NOTICE_IDS = ['tester-notice-self-3', 'tester-notice-self-2'];   // OWNER_router_34 item 3: the page serves self-3
  if (b.notice_accepted !== true || !SELF_NOTICE_IDS.includes(b.notice_id)) throw fixable('invalid_field', 'notice_id', `Read the notice for a page of your own (${SELF_NOTICE_IDS[0]}) and accept it.`, SELF_NOTICE_IDS[0]);   // step 2 (the page sends self-1 since 4:22 PM CT 16 Nov)
  const now = nowMs();
  // 3:3x PM CT 16 Nov: our own checks' pages (made with the team header; their member is not real) never count toward a stranger's five:
  // every page through run.person.tools reaches us from the relay's address, and 36 test pages a day had filled that address's five
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM principals p WHERE p.created_ip_hash = ? AND p.owner = \'person\' AND p.name = \'your own page\' AND p.created_at > ? AND EXISTS (SELECT 1 FROM panels pn JOIN members m ON m.panel_id = pn.id WHERE pn.principal_id = p.id AND m.is_real = 1)').bind(ipHash, now - DAY).first();
  if (n && n.n >= 5 && !teamHeader) throw notFixable(429, 'rate_limited', 'At most five pages a day from one address. Use the page you made.', { retry_after_seconds: 3600 });
  const tz = typeof b.tz === 'string' && b.tz.length < 60 ? b.tz : 'America/Chicago';
  const qs = Number.isInteger(b.quiet_start) && b.quiet_start >= 0 && b.quiet_start < 24 ? b.quiet_start : 21;
  const qe = Number.isInteger(b.quiet_end) && b.quiet_end >= 0 && b.quiet_end < 24 ? b.quiet_end : 8;
  const pr = rid('pr_'), pn = rid('p_'), mb = rid('mb_'), tok = rid('mt_', 32);
  const { ourServer, FROM_OUR_ADDRESS } = await import('./util.js'); const fromUs = !teamHeader && (await ourServer(env, ipHash));   // OWNER_router_21
  await env.DB.batch([
    env.DB.prepare('INSERT INTO principals (id, class, name, team, created_ip_hash, created_at, owner, owner_note) VALUES (?,?,?,?,?,?,?,?)').bind(pr, 'test', 'your own page', 0, ipHash, now, fromUs ? 'team' : 'person', fromUs ? FROM_OUR_ADDRESS : null),   // OWNER_router_16
    env.DB.prepare('INSERT INTO panels (id, principal_id, name, kind, join_code_hash, created_at, asker_name) VALUES (?,?,?,?,?,?,?)').bind(pn, pr, 'own page', 'private', 'self:' + rid('x', 24), now, null),
    env.DB.prepare('INSERT INTO members (id, panel_id, token_hash, alias, is_real, tz, quiet_start, quiet_end, on_state, adult_at, notice_id, notice_at, us_resident_at, created_at, person_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(mb, pn, await sha256hex(tok), '', teamHeader ? 0 : 1, tz, qs, qe, 'on', now, b.notice_id, now, now, now, 'you'),
  ]);
  const run = 'https://run.' + new URL(request.url).host.replace(/^api\./, '').replace(/^askpeople-api\.pages\.dev$/, 'person.tools');
  return { member_id: mb, member_token: tok, page: run + '/m/' + tok, on: true,
    note: 'This is your own page: only your own AIs reach you here. Keep the link (it is how you sign in until you add a passkey). Next: Connect an AI, and add a passkey.' };
}
