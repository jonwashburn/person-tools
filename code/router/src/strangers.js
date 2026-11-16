// Asking for real strangers in-band (the CEO, OWNER_all_6 item 2, 3:56 AM CT 15 Nov 2026; policy/DATA.md row
// `stranger_requests`, TRUST 4:08 AM CT). An agent sets wants_strangers: {purpose, contact} on a call or a quote. Strangers
// are not open yet: nothing is rung and nothing is sent back; the request is kept for the owner, who reads the list each
// sweep, and counted (never shown) in GET /v1/proof. Kept 90 days, or until the asker's principal is deleted. The contact
// is used at most once, when strangers open, from our own address; it is never shared.
import { rid, nowMs, sha256hex, iso, teamCheck } from './util.js';
import { fixable } from './spec.js';

// anything shaped like a key or a token comes out before anything is stored (TRUST 4:08)
const SECRET_RX = /\b(?:sk-[A-Za-z0-9_-]{8,}|(?:test|real|live|mt|st|jc|ar)_[A-Za-z0-9_.-]{12,}|Bearer\s+\S+|[A-Fa-f0-9]{32,}|[A-Za-z0-9+/_-]{40,}={0,2})/g;
const scrub = (s) => String(s).replace(SECRET_RX, '[removed]').replace(/\s+/g, ' ').trim();

// one contact: an email, a phone, or an address (a web or postal address), nothing else
function contactOf(c) {
  if (c === undefined || c === null || c === '') return null;
  if (typeof c !== 'string' || c.length > 200) throw fixable('invalid_field', 'wants_strangers.contact', 'contact is one way to reach your user, at most 200 characters: an email, a phone or an address.', 'name@example.com');
  const v = scrub(c);
  const email = /^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,}$/.test(v), phone = /^\+?[0-9 ().-]{7,24}$/.test(v), addr = /^[^\n]{6,200}$/.test(v) && /[A-Za-z]/.test(v) && !/[@]/.test(v) || /^https?:\/\/[^\s]+$/.test(v);
  if (!(email || phone || addr) || v.includes('[removed]')) throw fixable('invalid_field', 'wants_strangers.contact', 'contact is one email, one phone or one address, and nothing like a key or a password.', 'name@example.com');
  return v;
}

// the field as an agent sends it: top level wants_strangers, or ext["person.tools"].wants_strangers
export function readWantsStrangers(body) {
  const w = body && (body.wants_strangers !== undefined ? body.wants_strangers : body.ext && body.ext['person.tools'] && body.ext['person.tools'].wants_strangers);
  if (w === undefined || w === null || w === false) return null;
  if (w === true) throw fixable('invalid_field', 'wants_strangers', 'wants_strangers is {"purpose": "...", "contact": "..."}: what your user wants strangers for, and how to reach your user.', { purpose: 'Twenty strangers to try our sign-up page this week', contact: 'name@example.com' });
  if (typeof w !== 'object' || Array.isArray(w)) throw fixable('invalid_field', 'wants_strangers', 'wants_strangers is an object: {"purpose", "contact"}.', { purpose: 'Twenty strangers to try our sign-up page this week', contact: 'name@example.com' });
  for (const k of Object.keys(w)) if (!['purpose', 'contact'].includes(k)) throw fixable('unknown_field', 'wants_strangers.' + k, `"${k}" is not a field of wants_strangers; send purpose and contact.`, null);
  if (typeof w.purpose !== 'string' || w.purpose.trim().length < 3 || w.purpose.length > 300) throw fixable(w.purpose === undefined ? 'missing_field' : 'invalid_field', 'wants_strangers.purpose', 'purpose is 3 to 300 characters: what your user wants real strangers for.', 'Twenty strangers to try our sign-up page this week');
  return { purpose: scrub(w.purpose).slice(0, 300), contact: contactOf(w.contact) };
}

async function askerOf(env, request, key) {
  if (key && !key.anon) return key.principal_id;
  const h = (await sha256hex('ip:' + (request.headers.get('cf-connecting-ip') || 'local') + ':' + (env.SEAT_SECRET || ''))).slice(0, 24);
  return 'anon:' + h;
}

// Keep it (once a day per asker and purpose) and say what happens next.
export async function recordStrangers(env, request, key, w, refId) {
  const asker = await askerOf(env, request, key), now = nowMs();
  const dup = await env.DB.prepare('SELECT id FROM stranger_requests WHERE asker = ? AND purpose = ? AND created_at > ?').bind(asker, w.purpose, now - 86400000).first();
  const { ourServer } = await import('./util.js');   // OWNER_router_16, 21: from one of our servers it is ours, header or not
  const fromUs = !teamCheck(env, request) && (await ourServer(env, (await sha256hex('ip:' + (request.headers.get('cf-connecting-ip') || 'local') + ':' + (env.SEAT_SECRET || ''))).slice(0, 24)));
  if (!dup) await env.DB.prepare('INSERT INTO stranger_requests (id, asker, principal_id, key_id, ref_id, purpose, contact, created_at, owner) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(rid('sr_'), asker, key && !key.anon ? key.principal_id : null, key && !key.anon ? key.id : null, refId || null, w.purpose, w.contact, now, teamCheck(env, request) || fromUs ? 'team' : 'outside').run();
  return { recorded: true, note: 'Listed: we\'ll tell you here, in this tool\'s replies to your key, when strangers open. Nothing is rung meanwhile, and nobody else sees your request. Your own people can answer now: make a panel (POST /v1/panels) and send them its join link.' };
}

// The promise kept (the CEO, 5:55 AM CT 15 Nov): every later reply to a key (or a keyless address) that asked carries ONE line
// with the state of strangers. The operator moves the state (meta strangers_state; POST /internal/strangers_state).
export const STRANGERS_LINES = {
  not_open: 'Strangers: not open yet. You are on the list; this line will say here when it opens.',
  ours: 'Strangers: open for our own calls only, not yet to you. You are on the list; this line will say here when it opens to you.',
  open: 'Strangers: open to you now. Quote a call with pool "prolific" (pay at or above the floor), then send it.',
};
export async function strangersState(env) {
  try { const r = await env.DB.prepare('SELECT v FROM meta WHERE k = \'strangers_state\'').first(); return r && STRANGERS_LINES[r.v] ? r.v : 'not_open'; } catch { return 'not_open'; }
}
export async function strangersLineFor(env, request, key) {
  try {
    const asker = await askerOf(env, request, key);
    const row = await env.DB.prepare('SELECT 1 AS x FROM stranger_requests WHERE asker = ? LIMIT 1').bind(asker).first();
    return row ? STRANGERS_LINES[await strangersState(env)] : null;
  } catch { return null; }
}

// The owner's list (GET /internal/strangers; bin/strangers, terminal only)
export async function strangersList(env) {
  // ours exactly as /v1/proof decides it (proof.js): the owner recorded when the principal (or a keyless request) was made
  const rows = (await env.DB.prepare(`SELECT s.created_at, s.asker, s.ref_id, s.purpose, s.contact,
      COALESCE(p.owner, s.owner, 'outside') != 'outside' AS ours
      FROM stranger_requests s LEFT JOIN principals p ON p.id = s.principal_id ORDER BY s.created_at DESC LIMIT 200`).all()).results || [];
  return { requests: rows.map(r => ({ at: iso(r.created_at), asker: r.asker, ours: !!r.ours, with: r.ref_id, purpose: r.purpose, contact: r.contact })),
    outsiders: rows.filter(r => !r.ours).length, newest_purposes: rows.filter(r => !r.ours).slice(0, 3).map(r => r.purpose), state: await strangersState(env),
    note: 'Who asked for real strangers, newest first. Terminal only: never paste this into a file.' };
}
