// OWNER_router_27 item 1 (SPEC 8.1, 8.1.1 P15; 4.5.3): a task's approval or denial, signed by the person's enrolled device after its
// biometric check. The device signs UTF-8(task_id + "\n" + answer_digest + "\n" + time): answer_digest is base64url SHA-256 of the UTF-8
// bytes of exactly what was approved (the reply's approved_text: the step's text, or the person's edit) or, for a denial, the step's
// text; time is an ISO 8601 instant within ten minutes of the answer; sig is base64url, DER (X9.62) or raw r||s. Checked against the
// member's enrolled key (POST .../device_key). The reply then carries device_approved true with the mark (an attested key), for the
// person and for the asker (GET /v1/tasks/{id}). A call's signature stays with devicekeys.js signAnswer, unchanged.
import { nowMs, iso } from './util.js';
import { fixable, notFixable } from './spec.js';
import { unb64u, b64u } from './webauthn.js';
import { DEVICE_APPROVED_WORDS } from './devicekeys.js';
const te = new TextEncoder();
function sigRaw(sig) {
  if (sig.length === 64) return sig;
  if (sig[0] !== 0x30) throw new Error('signature format');
  let i = 2; if (sig[1] & 0x80) i += sig[1] & 0x7f;
  const part = () => { if (sig[i++] !== 0x02) throw new Error('signature format'); const n = sig[i++]; let v = sig.slice(i, i + n); i += n; while (v.length > 32 && v[0] === 0) v = v.slice(1); const o = new Uint8Array(32); o.set(v, 32 - v.length); return o; };
  const r = part(), s = part(); const o = new Uint8Array(64); o.set(r, 0); o.set(s, 32); return o;
}
export async function taskDigest(text) { return b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(String(text || ''))))); }
export async function signTask(env, m, b) {
  for (const k of Object.keys(b || {})) if (!['task_id', 'answer_digest', 'time', 'sig'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not a field here; send task_id, answer_digest, time and sig.`, null);
  const dk = await env.DB.prepare('SELECT * FROM device_keys WHERE member_id = ?').bind(m.id).first();
  if (!dk) throw notFixable(409, 'not_enrolled', 'This member has no device key yet: POST .../device_key first.');
  const taskId = String(b.task_id || ''), digest = String(b.answer_digest || ''), when = String(b.time || '');
  const t = await env.DB.prepare('SELECT id, step_json, reply_json, answered_at FROM tasks WHERE id = ? AND answered_by = ?').bind(taskId, m.id).first();
  if (!t || !t.reply_json) throw notFixable(404, 'not_found', 'No answer of yours to that ask is stored (the signature follows the approval).');
  const reply = JSON.parse(t.reply_json), step = JSON.parse(t.step_json || '{}');
  if (!['approve', 'deny'].includes(reply.action)) throw fixable('invalid_field', 'task_id', 'Only an approval or a denial is signed.', null, {}, 400);
  const text = reply.action === 'approve' ? (reply.approved_text || step.text || '') : (step.text || '');
  if (digest !== await taskDigest(text) && !(reply.approved_digest_drawn && digest === reply.approved_digest_drawn)) throw fixable('invalid_field', 'answer_digest', 'The digest does not match what was approved: base64url SHA-256 of the exact text approved (or, for a denial, the step\'s text), as UTF-8.', null, {}, 422);
  const ts = Date.parse(when);
  if (!isFinite(ts) || !t.answered_at || ts < t.answered_at - 600000 || ts > t.answered_at + 600000) throw fixable('invalid_field', 'time', 'time is when the device signed, within ten minutes of the answer.', null, {}, 422);
  let ok = false;
  try {
    const key = await crypto.subtle.importKey('raw', unb64u(dk.public_key), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sigRaw(unb64u(String(b.sig || ''))), te.encode(taskId + '\n' + digest + '\n' + when));
  } catch { ok = false; }
  if (!ok) throw fixable('invalid_field', 'sig', 'The signature does not verify with this member\'s device key.', null, {}, 422);
  const now = nowMs();
  const next = { ...reply, device_approved: !!dk.attested, device_signed_at: iso(now), mark: dk.attested ? DEVICE_APPROVED_WORDS : 'none: signed by a device key that is not attested, so it carries no device_approved mark' };
  await env.DB.prepare('UPDATE tasks SET reply_json = ? WHERE id = ?').bind(JSON.stringify(next), t.id).run();
  return { task_id: t.id, signed: true, device_approved: !!dk.attested, ...(dk.attested ? { mark: DEVICE_APPROVED_WORDS } : { note: 'Signed by a key that is not attested: recorded, not marked device_approved.' }) };
}
