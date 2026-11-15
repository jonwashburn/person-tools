// THE SIGNED ANSWER, STORED AND CHECKED (owner/OWNER_router_4 item 2; SPEC 4.5.3 and section 5's mark device_approved).
// The app makes a signing key in the phone's secure hardware, usable only after Face ID, and proves with Apple's App Attest that the key
// was made inside our app on real hardware. After the person answers, the app signs three things: the call's id, a digest of the
// answer, and the time. The service checks the signature against the stored key, the digest against the stored answer, and the time
// against the seat's window, then marks that response device_approved. A signature that arrives late for an answer already stored is
// taken. The words shown are only these: "the owner of an enrolled, Apple-attested device approved this answer with Face ID".
// Formats (for the app's builder):
//   nonce:        GET /v1/member/device_key/nonce -> {"nonce"} (base64url, one use, five minutes)
//   public_key:   base64url of the uncompressed P-256 point (65 bytes, 0x04 || x || y)
//   clientData:   public_key bytes || UTF-8(member_id) || UTF-8(nonce); App Attest's clientDataHash = SHA-256(clientData)
//   answer_digest: base64url SHA-256 of the answers as canonical JSON (keys sorted, no spaces), as GET .../offers or the receipt shows them
//   signed text:  UTF-8(call_id + "\n" + answer_digest + "\n" + time), time an ISO 8601 instant; sig: base64url, DER (X9.62) or raw r||s
import { rid, nowMs, iso } from './util.js';
import { fixable, notFixable } from './spec.js';
import { unb64u, b64u } from './webauthn.js';

export const DEVICE_APPROVED_WORDS = 'the owner of an enrolled, Apple-attested device approved this answer with Face ID';
const te = new TextEncoder();
const sha256 = async (u8) => new Uint8Array(await crypto.subtle.digest('SHA-256', u8));
export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
export async function answerDigest(answers) { return b64u(await sha256(te.encode(canonical(answers || {})))); }

export async function deviceNonce(env, m) {
  const id = rid('wc_'), nonce = b64u(crypto.getRandomValues(new Uint8Array(32))), now = nowMs();
  await env.DB.batch([env.DB.prepare('DELETE FROM webauthn_challenges WHERE expires_at < ?').bind(now),
    env.DB.prepare('INSERT INTO webauthn_challenges (id, purpose, challenge, person_id, expires_at) VALUES (?, ?, ?, ?, ?)').bind(id, 'appattest:' + m.id, nonce, null, now + 300000)]);
  return { nonce, expires_at: iso(now + 300000), note: 'Use it once, within five minutes: clientData = public_key bytes || member id || nonce.' };
}

export async function enrolDevice(env, m, b) {
  for (const k of Object.keys(b || {})) if (!['public_key', 'app_attest'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not a field here; send public_key and app_attest.`, null);
  let pub; try { pub = unb64u(String((b && b.public_key) || '')); } catch { pub = null; }
  if (!pub || pub.length !== 65 || pub[0] !== 4) throw fixable('invalid_field', 'public_key', 'public_key is the base64url uncompressed P-256 point (65 bytes, starting 0x04).', null);
  try { await crypto.subtle.importKey('raw', pub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']); } catch { throw fixable('invalid_field', 'public_key', 'That is not a P-256 public key.', null); }
  let attested = 0, environment = null, why = 'no App Attest attestation was sent';
  const aa = b && b.app_attest;
  if (aa) {
    for (const k of Object.keys(aa)) if (!['key_id', 'attestation', 'nonce'].includes(k)) throw fixable('unknown_field', 'app_attest.' + k, 'app_attest is {"key_id", "attestation", "nonce"}.', null);
    const c = await env.DB.prepare('DELETE FROM webauthn_challenges WHERE challenge = ? AND purpose = ? RETURNING expires_at').bind(String(aa.nonce || ''), 'appattest:' + m.id).first();
    if (!c || c.expires_at < nowMs()) throw fixable('invalid_field', 'app_attest.nonce', 'That nonce was not issued to this member, was used, or is older than five minutes: ask GET .../device_key/nonce again.', null);
    const team = env.APPLE_TEAM_ID || env.APNS_TEAM_ID;
    if (!team) throw notFixable(503, 'unavailable', 'This server does not know its Apple team yet.');
    const clientData = new Uint8Array([...pub, ...te.encode(m.id), ...te.encode(String(aa.nonce))]);
    const { verifyAppAttest } = await import('./appattest.js');
    try {
      const r = await verifyAppAttest({ attestation: String(aa.attestation || ''), keyId: String(aa.key_id || ''), clientDataHash: await sha256(clientData), appId: team + '.' + (env.APNS_TOPIC || 'tools.person.app') });
      attested = 1; environment = r.environment; why = null;
    } catch (e) { why = 'App Attest did not verify: ' + String(e && e.message || e).slice(0, 120); }
  }
  const now = nowMs();
  await env.DB.prepare('INSERT INTO device_keys (member_id, public_key, attested, environment, why_not, created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET public_key = excluded.public_key, attested = excluded.attested, environment = excluded.environment, why_not = excluded.why_not, created_at = excluded.created_at')
    .bind(m.id, b64u(pub), attested, environment, why, now).run();
  return { member_id: m.id, attested: !!attested, environment, ...(why ? { why_not_attested: why } : {}), enrolled_at: iso(now),
    note: attested ? 'Answers this key signs are marked device_approved.' : 'Kept, but not attested: answers it signs are recorded as signed, not as device_approved.' };
}

function sigRaw(sig) {
  if (sig.length === 64) return sig;
  if (sig[0] !== 0x30) throw new Error('signature format');
  let i = 2; if (sig[1] & 0x80) i += sig[1] & 0x7f;
  const part = () => { if (sig[i++] !== 0x02) throw new Error('signature format'); const n = sig[i++]; let v = sig.slice(i, i + n); i += n; while (v.length > 32 && v[0] === 0) v = v.slice(1); const o = new Uint8Array(32); o.set(v, 32 - v.length); return o; };
  const r = part(), s = part(); const o = new Uint8Array(64); o.set(r, 0); o.set(s, 32); return o;
}

export async function signAnswer(env, m, b) {
  for (const k of Object.keys(b || {})) if (!['call_id', 'answer_digest', 'time', 'sig'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not a field here; send call_id, answer_digest, time and sig.`, null);
  const dk = await env.DB.prepare('SELECT * FROM device_keys WHERE member_id = ?').bind(m.id).first();
  if (!dk) throw notFixable(409, 'not_enrolled', 'This member has no device key yet: POST .../device_key first.');
  const callId = String((b && b.call_id) || ''), digest = String((b && b.answer_digest) || ''), when = String((b && b.time) || '');
  const r = await env.DB.prepare(`SELECT r.id, r.answers_json, s.taken_at, r.created_at FROM responses r JOIN seats s ON s.id = r.seat_id WHERE r.call_id = ? AND s.member_id = ?`).bind(callId, m.id).first();
  if (!r) throw notFixable(404, 'not_found', 'No answer of this member on that call is stored (a late signature waits until the answer is stored).');
  if (digest !== await answerDigest(JSON.parse(r.answers_json || '{}'))) throw fixable('invalid_field', 'answer_digest', 'The digest does not match the stored answer (SHA-256 of the canonical JSON: keys sorted, no spaces).', null, {}, 422);
  const t = Date.parse(when);
  if (!isFinite(t) || t < (r.taken_at || r.created_at) - 60000 || t > r.created_at + 600000) throw fixable('invalid_field', 'time', 'time is when the device signed, within the seat\'s window (from taking the call to ten minutes after the answer).', null, {}, 422);
  let ok = false;
  try {
    const key = await crypto.subtle.importKey('raw', unb64u(dk.public_key), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sigRaw(unb64u(String((b && b.sig) || ''))), te.encode(callId + '\n' + digest + '\n' + when));
  } catch { ok = false; }
  if (!ok) throw fixable('invalid_field', 'sig', 'The signature does not verify with this member\'s device key.', null, {}, 422);
  const now = nowMs();
  await env.DB.prepare('UPDATE responses SET device_signed_at = ?, device_approved = ? WHERE id = ?').bind(now, dk.attested ? 1 : 0, r.id).run();
  return { call_id: callId, response_id: r.id, signed: true, device_approved: !!dk.attested, ...(dk.attested ? { mark: DEVICE_APPROVED_WORDS } : { note: 'Signed by a key that is not attested: recorded, not marked device_approved.' }) };
}
