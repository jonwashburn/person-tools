// SIGN IN TO THE DESK WITH THE PHONE (owner/OWNER_router_14 and owner/APP_MENU.md "The service"; TRUST 3:50 PM CT 15 Nov 2026 on QR-jacking).
// The Desk asks for a code and shows it as a QR beside a two-digit number; the person scans it with the app (Menu, Use on a computer),
// sees where the computer is and taps the number their computer shows (a wrong tap kills the code), then approves; the Desk's poll gets a
// ds_ session once. A ds_ session acts as that one membership on /v1/member/*, ends after 30 days unused, and is listed and revoked from
// the phone. Codes are single use, live 60 seconds, five a minute per address; the QR carries only the code; ds_ never travels in an address.
import { rid, nowMs, iso, sha256hex } from './util.js';
import { fixable, notFixable } from './spec.js';

const CODE_MS = 60000, SESSION_UNUSED_MS = 30 * 86400000;
function whereOf(request) {
  const cf = request.cf || {}, ua = String(request.headers.get('user-agent') || '');
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'a browser';
  const system = /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) && !/iPhone|iPad/.test(ua) ? 'a Mac' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'an iPhone or iPad' : /Linux/.test(ua) ? 'Linux' : 'a computer';
  const place = [cf.city, cf.region || cf.country].filter(Boolean).join(', ');
  return (place ? 'near ' + place + ', ' : '') + browser + ' on ' + system;
}

// POST /v1/desk/sign_in (the Desk, no credential) -> {code (for the QR), poll (kept in the Desk's memory), number (shown big), expires_in}
export async function startDesk(env, request, ipHash) {
  const now = nowMs();
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM desk_codes WHERE ip_hash = ? AND created_at > ?').bind(ipHash, now - 60000).first();
  if (n && n.n >= 5) throw notFixable(429, 'rate_limited', 'At most five sign-in codes a minute from one address.', { retry_after_seconds: 60 });
  const code = rid('dc', 24), poll = rid('dp', 32), number = 10 + (crypto.getRandomValues(new Uint8Array(1))[0] % 90);
  await env.DB.batch([env.DB.prepare('DELETE FROM desk_codes WHERE expires_at < ?').bind(now - 3600000),
    env.DB.prepare('INSERT INTO desk_codes (code_hash, poll_hash, number, ip_hash, where_text, created_at, expires_at) VALUES (?,?,?,?,?,?,?)')
      .bind(await sha256hex(code), await sha256hex(poll), number, ipHash, whereOf(request), now, now + CODE_MS)]);
  return { code, poll, number, expires_in: 60, note: 'Show the code as a QR and the number beside it. Keep poll in memory only: GET /v1/desk/sign_in/{poll} gives the session once it is approved.' };
}
async function codeRow(env, code) {
  const r = await env.DB.prepare('SELECT * FROM desk_codes WHERE code_hash = ?').bind(await sha256hex(String(code || ''))).first();
  if (!r) throw notFixable(404, 'not_found', 'That sign-in code is not known: scan again.');
  if (r.killed_at) throw notFixable(409, 'conflict', 'That sign-in code was stopped: ask the computer for a new one.');
  if (r.approved_at) throw notFixable(409, 'conflict', 'That sign-in code was already used.');
  if (r.expires_at < nowMs()) throw notFixable(410, 'expired', 'That sign-in code ran out (60 seconds): the computer shows a new one.');
  return r;
}
// POST /v1/member/desk/preview {code} (the phone): where the computer is, and three numbers to choose from (one is right)
export async function previewDesk(env, m, b) {
  const r = await codeRow(env, b && b.code);
  const set = new Set([r.number]); while (set.size < 3) set.add(10 + (crypto.getRandomValues(new Uint8Array(1))[0] % 90));
  const numbers = [...set].sort(() => crypto.getRandomValues(new Uint8Array(1))[0] - 128);
  return { where: r.where_text, asked_at: iso(r.created_at), numbers, ask: `Sign in a computer ${r.where_text}, just now? Tap the number it shows.` };
}
// POST /v1/member/desk/approve {code, number} (the phone): binds the code to this membership once; a wrong number stops the code
export async function approveDesk(env, m, b) {
  for (const k of Object.keys(b || {})) if (!['code', 'number', 'sig'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not a field here; send code and number.`, null);
  const r = await codeRow(env, b && b.code);
  if (Number(b && b.number) !== r.number) {
    await env.DB.prepare('UPDATE desk_codes SET killed_at = ? WHERE code_hash = ?').bind(nowMs(), r.code_hash).run();
    throw notFixable(409, 'conflict', 'That is not the number the computer shows, so this code is stopped. If you did not start a sign-in yourself, someone else did: nothing was signed in.');
  }
  const u = await env.DB.prepare('UPDATE desk_codes SET approved_member_id = ?, approved_at = ? WHERE code_hash = ? AND approved_at IS NULL AND killed_at IS NULL AND expires_at >= ?').bind(m.id, nowMs(), r.code_hash, nowMs()).run();
  if (u.meta.changes !== 1) throw notFixable(409, 'conflict', 'That sign-in code was already used.');
  return { approved: true, where: r.where_text, note: 'That computer is signed in as you on this page for up to 30 days unused. Sign it out any time under Use on a computer.' };
}
// GET /v1/desk/sign_in/{poll} (the Desk): 202 while waiting; the session exactly once; then 410
export async function pollDesk(env, poll) {
  const r = await env.DB.prepare('SELECT * FROM desk_codes WHERE poll_hash = ?').bind(await sha256hex(String(poll || ''))).first();
  if (!r || r.killed_at || r.session_issued_at || (!r.approved_at && r.expires_at < nowMs())) throw notFixable(410, 'expired', 'This sign-in is over: show a new code.');
  if (!r.approved_at) return { status: 202, body: { waiting: true, expires_at: iso(r.expires_at) } };
  const u = await env.DB.prepare('UPDATE desk_codes SET session_issued_at = ? WHERE code_hash = ? AND session_issued_at IS NULL').bind(nowMs(), r.code_hash).run();
  if (u.meta.changes !== 1) throw notFixable(410, 'expired', 'This sign-in is over: show a new code.');
  const tok = rid('ds_', 40), id = rid('dk_'), now = nowMs();
  await env.DB.prepare('INSERT INTO desk_sessions (id, token_hash, member_id, where_text, created_at, last_used_at) VALUES (?,?,?,?,?,?)').bind(id, await sha256hex(tok), r.approved_member_id, r.where_text, now, now).run();
  return { status: 200, body: { session: tok, member_id: r.approved_member_id, note: 'Send it as "Authorization: Bearer ds_..." to /v1/member/...; never in an address. It ends after 30 days unused, or when the phone signs it out.' } };
}
// a ds_ session -> its member id (app.js stands it in for one request), refreshing its last use
export async function deskMember(env, tok) {
  const s = await env.DB.prepare('SELECT * FROM desk_sessions WHERE token_hash = ? AND revoked_at IS NULL').bind(await sha256hex(tok)).first();
  if (!s || s.last_used_at < nowMs() - SESSION_UNUSED_MS) throw notFixable(401, 'unauthorized', 'This computer is signed out: scan a new code with your phone.');
  await env.DB.prepare('UPDATE desk_sessions SET last_used_at = ? WHERE id = ?').bind(nowMs(), s.id).run();
  return s.member_id;
}
export async function listDesks(env, m) {
  const rows = (await env.DB.prepare('SELECT id, where_text, created_at, last_used_at FROM desk_sessions WHERE member_id = ? AND revoked_at IS NULL AND last_used_at > ? ORDER BY last_used_at DESC').bind(m.id, nowMs() - SESSION_UNUSED_MS).all()).results || [];
  return { sessions: rows.map((r) => ({ id: r.id, where: r.where_text, signed_in_at: iso(r.created_at), last_used_at: iso(r.last_used_at) })) };
}
export async function revokeDesk(env, m, id) {
  const r = await env.DB.prepare('UPDATE desk_sessions SET revoked_at = ? WHERE id = ? AND member_id = ? AND revoked_at IS NULL').bind(nowMs(), String(id || ''), m.id).run();
  if (r.meta.changes !== 1) throw notFixable(404, 'not_found', 'No computer of yours has that id.');
  return { id, signed_out: true };
}
