// A PERSON'S OWN MATERIAL AND THE ANSWER BACK (owner/OWNER_all_10 part C; TRUST's policy/CONNECTIONS.md, the CEO's promise: "we do
// not look at a person's own material (a home camera's picture is theirs). It is stored encrypted, deleted on the schedule the person
// sets (seven days unless they say otherwise), and never put in front of a reviewer").
// - A connected AI may send one photo or one short clip with an ask: POST /v1/tasks/media (the bytes), then POST /v1/tasks with
//   "media": "<id>". It is encrypted with a key the service holds (AES-GCM, a key of its own for each piece, from the service's
//   secret) before it is stored, is served only to that person, and is deleted at its time (the person's schedule, seven days
//   unless they chose otherwise), at once when the connection is revoked, and an hour after upload if no ask used it. Nothing here
//   returns it to anyone else: no admin route, no log line, no export; the operator sees counts only.
// - The answer goes back by polling, or to the webhook the AI names with its ask, signed with the connection's own secret
//   (HMAC-SHA256 over "<timestamp>.<body>"), retried with backoff for up to 24 hours. Only that ask's answer is in it.
import { rid, nowMs, iso } from './util.js';
import { fixable, notFixable } from './spec.js';

const DAY = 86400000;
export const LIMITS = { photo_bytes: 10 * 1024 * 1024, clip_bytes: 20 * 1024 * 1024, clip_seconds: 60, asks_per_hour: 60, asks_per_day: 300 };
const IMAGE = { 'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, 'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/gif': (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46, 'image/webp': (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP',
  'image/heic': (b) => ascii(b, 4, 4) === 'ftyp' && /^(heic|heix|mif1|msf1|heim|heis)$/.test(ascii(b, 8, 4)) };
const VIDEO = { 'video/mp4': (b) => ascii(b, 4, 4) === 'ftyp', 'video/quicktime': (b) => ascii(b, 4, 4) === 'ftyp' || ascii(b, 4, 4) === 'moov' || ascii(b, 4, 4) === 'wide' || ascii(b, 4, 4) === 'mdat' };
function ascii(b, at, n) { let s = ''; for (let i = at; i < at + n && i < b.length; i++) s += String.fromCharCode(b[i]); return s; }

// The length of an MP4 or QuickTime clip, from its movie header (mvhd): timescale and duration. null if it has none.
export function clipSeconds(b) {
  for (let i = 4; i + 32 < b.length; i++) {
    if (b[i] !== 0x6d || b[i + 1] !== 0x76 || b[i + 2] !== 0x68 || b[i + 3] !== 0x64) continue;   // 'mvhd'
    const v = new DataView(b.buffer, b.byteOffset + i + 4);
    const ver = v.getUint8(0);
    const scale = ver === 1 ? v.getUint32(20) : v.getUint32(12);
    const dur = ver === 1 ? v.getUint32(24) * 4294967296 + v.getUint32(28) : v.getUint32(16);
    if (scale > 0) return dur / scale;
  }
  return null;
}

// ---- the service's key: one key of its own for each piece and each secret, from the service's secret (HKDF-SHA256) ----
async function keyFor(env, info) {
  if (!env.SEAT_SECRET) throw notFixable(503, 'unavailable', 'This server cannot store a person\'s material yet.');
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SEAT_SECRET), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('person.tools own material v1'), info: new TextEncoder().encode(info) },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function seal(env, info, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(env, info), bytes));
  const out = new Uint8Array(12 + ct.length); out.set(iv, 0); out.set(ct, 12); return out;
}
export async function unseal(env, info, sealed) {
  const b = new Uint8Array(sealed);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, await keyFor(env, info), b.slice(12)));
}
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// ---- the upload: POST /v1/tasks/media with the bytes (a connection's key only) ----
export async function uploadOwn(env, request, key) {
  const c = key.connection; if (!c) throw fixable('forbidden_for_key_class', 'Authorization', 'Only a connected AI sends its person a photo or a clip.', null, {}, 403);
  if (c.blocked) throw notFixable(403, 'not_available', 'This person is not available to this AI.');
  const ct = String(request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const isImage = !!IMAGE[ct], isClip = !!VIDEO[ct];
  if (!isImage && !isClip) throw fixable('invalid_field', 'Content-Type', 'Send one photo (image/jpeg, png, webp, gif or heic) or one clip (video/mp4 or video/quicktime) as the request body.', 'image/jpeg', {}, 415);
  const max = isImage ? LIMITS.photo_bytes : LIMITS.clip_bytes;
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > max) throw notFixable(413, 'content_too_large', isImage ? 'A photo is at most 10 MB; nothing was stored.' : 'A clip is at most 20 MB; nothing was stored.');
  const now = nowMs();
  const hour = await env.DB.prepare('SELECT COUNT(*) AS n FROM own_material WHERE connection_id = ? AND created_at > ?').bind(c.id, now - 3600000).first();
  if (hour && hour.n >= LIMITS.asks_per_hour) throw notFixable(429, 'rate_limited', 'This AI has sent 60 pieces this hour; nothing was stored.', { retry_after_seconds: 600 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > max) throw notFixable(413, 'content_too_large', isImage ? 'A photo is 1 byte to 10 MB; nothing was stored.' : 'A clip is 1 byte to 20 MB; nothing was stored.');
  if (!(isImage ? IMAGE[ct] : VIDEO[ct])(bytes)) throw fixable('invalid_field', 'Content-Type', `The bytes are not a ${ct}; nothing was stored.`, null, {}, 415);
  let seconds = null;
  if (isClip) {
    seconds = clipSeconds(bytes);
    if (seconds === null) throw fixable('invalid_field', 'body', 'The clip has no movie header to read its length from; send an MP4 or QuickTime file. Nothing was stored.', null, {}, 415);
    if (seconds > LIMITS.clip_seconds + 0.5) throw notFixable(413, 'content_too_large', 'A clip is at most 60 seconds; nothing was stored.');
  }
  if (!env.MEDIA) throw notFixable(503, 'unavailable', 'This server cannot store a person\'s material yet.');
  const id = rid('om_'), r2 = 'own/' + c.id + '/' + id;
  await env.MEDIA.put(r2, await seal(env, 'piece:' + id, bytes), { httpMetadata: { contentType: 'application/octet-stream' } });
  // unattached for now: an hour to be used by an ask, then deleted (retention)
  await env.DB.prepare('INSERT INTO own_material (id, task_id, connection_id, r2_key, content_type, bytes, seconds, created_at, delete_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(id, null, c.id, r2, ct, bytes.length, seconds, now, now + 3600000).run();
  return { media_id: id, content_type: ct, bytes: bytes.length, seconds, note: 'Send it with one ask within the hour: POST /v1/tasks {..., "media": "' + id + '"}. Only your person sees it; it is deleted on their schedule.' };
}

// attach one piece to a new ask (tasks.js connectionTask): the person's own schedule decides when it goes
export async function attachOwn(env, c, mediaId, taskId, now) {
  const m = await env.DB.prepare('SELECT * FROM own_material WHERE id = ? AND connection_id = ? AND task_id IS NULL').bind(String(mediaId || ''), c.id).first();
  if (!m) throw fixable('invalid_field', 'media', 'media is the id POST /v1/tasks/media gave this AI within the hour, not yet sent with an ask.', null);
  const who = await env.DB.prepare('SELECT material_days FROM members WHERE id = ?').bind(c.member_id).first();
  const days = who && Number.isInteger(who.material_days) && who.material_days >= 1 ? who.material_days : 7;
  return env.DB.prepare('UPDATE own_material SET task_id = ?, delete_at = ? WHERE id = ? AND task_id IS NULL').bind(taskId, m.created_at + days * DAY, m.id);
}
export async function ownMaterialView(env, taskId) {
  const m = await env.DB.prepare('SELECT id, content_type, bytes, seconds, delete_at FROM own_material WHERE task_id = ?').bind(taskId).first();
  return m ? { kind: m.content_type.startsWith('video/') ? 'clip' : 'photo', content_type: m.content_type, bytes: m.bytes, seconds: m.seconds, deleted_at: iso(m.delete_at) } : null;
}

// the person, and only the person, sees it (tasks.js reviewMedia, for a task of theirs)
export async function serveOwn(env, taskId) {
  const m = await env.DB.prepare('SELECT * FROM own_material WHERE task_id = ? AND delete_at > ?').bind(taskId, nowMs()).first();
  if (!m || !env.MEDIA) return null;
  const obj = await env.MEDIA.get(m.r2_key); if (!obj) return null;
  const bytes = await unseal(env, 'piece:' + m.id, await obj.arrayBuffer());
  return new Response(bytes, { status: 200, headers: { 'Content-Type': m.content_type, 'Cache-Control': 'no-store, private', 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff' } });
}

// deletion: at its time; at once for a revoked connection's pieces; an hour after upload if no ask used it
export async function deleteOwn(env, where, args, limit = 20) {
  const rows = (await env.DB.prepare(`SELECT id, r2_key FROM own_material WHERE ${where} LIMIT ${limit}`).bind(...args).all()).results || [];
  let n = 0;
  for (const r of rows) { try { if (env.MEDIA) await env.MEDIA.delete(r.r2_key); await env.DB.prepare('DELETE FROM own_material WHERE id = ?').bind(r.id).run(); n++; } catch { } }
  return n;
}

// ---- the webhook: the connection's own signing secret, shown once; the person can make a new one ----
export async function newSecret(env, connectionId) {
  const s = 'whsec_' + [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, '0')).join('');
  const enc = b64(await seal(env, 'secret:' + connectionId, new TextEncoder().encode(s)));
  return { secret: s, stmt: env.DB.prepare('UPDATE connections SET secret_enc = ?, secret_at = ? WHERE id = ?').bind(enc, nowMs(), connectionId) };
}
async function secretOf(env, c) { return c.secret_enc ? new TextDecoder().decode(await unseal(env, 'secret:' + c.id, unb64(c.secret_enc))) : null; }

export function webhookUrl(v, publicHost) {
  let u; try { u = new URL(String(v)); } catch { throw fixable('invalid_field', 'webhook', 'webhook is one https address where the answer is sent.', 'https://example.com/person-tools/answers'); }
  if (!publicHost(u) || u.username || u.password) throw fixable('invalid_field', 'webhook', 'webhook is a plain public https address (no bare IP, no internal name, not this service).', 'https://example.com/person-tools/answers');
  return u.toString();
}

const BACKOFF = [60e3, 5 * 60e3, 30 * 60e3, 2 * 3600e3, 6 * 3600e3, 12 * 3600e3, 24 * 3600e3];
export async function queueAnswer(env, t) {   // after the person answers a connected AI's ask that named a webhook
  if (!t.webhook_url || !t.connection_id) return null;
  const id = rid('wd_'), now = nowMs();
  await env.DB.prepare('INSERT INTO webhook_deliveries (id, connection_id, task_id, url, attempts, next_at, created_at) VALUES (?,?,?,?,0,?,?)').bind(id, t.connection_id, t.id, t.webhook_url, now, now).run();
  return id;
}
export async function deliver(env, id) {
  const d = await env.DB.prepare('SELECT * FROM webhook_deliveries WHERE id = ? AND delivered_at IS NULL AND given_up_at IS NULL').bind(id).first(); if (!d) return null;
  const c = await env.DB.prepare('SELECT * FROM connections WHERE id = ?').bind(d.connection_id).first();
  const t = await env.DB.prepare('SELECT id, state, reply_json, answered_at FROM tasks WHERE id = ?').bind(d.task_id).first();
  const now = nowMs();
  if (!c || c.revoked_at || !t || !c.secret_enc) { await env.DB.prepare('UPDATE webhook_deliveries SET given_up_at = ? WHERE id = ?').bind(now, id).run(); return { ok: false, why: 'gone' }; }
  const body = JSON.stringify({ task_id: t.id, key: t.idem || null, state: t.state, reply: t.reply_json ? JSON.parse(t.reply_json) : null, answered_at: iso(t.answered_at) });   // key: OWNER_router_31 item 17   // that ask's answer and nothing else
  const ts = String(Math.floor(now / 1000));
  const hk = await crypto.subtle.importKey('raw', new TextEncoder().encode(await secretOf(env, c)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', hk, new TextEncoder().encode(ts + '.' + body)))].map((x) => x.toString(16).padStart(2, '0')).join('');
  let status = 0;
  try {
    const r = await fetch(d.url, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(8000),
      headers: { 'content-type': 'application/json', 'user-agent': 'person.tools-webhook/1', 'x-person-tools-timestamp': ts, 'x-person-tools-signature': 'v1=' + sig, 'x-person-tools-delivery': d.id }, body });
    status = r.status;
  } catch { status = 0; }
  const attempts = d.attempts + 1;
  if (status >= 200 && status < 300) await env.DB.prepare('UPDATE webhook_deliveries SET attempts = ?, last_status = ?, delivered_at = ?, next_at = NULL WHERE id = ?').bind(attempts, status, now, id).run();
  else if (now - d.created_at > DAY || attempts > BACKOFF.length) await env.DB.prepare('UPDATE webhook_deliveries SET attempts = ?, last_status = ?, given_up_at = ?, next_at = NULL WHERE id = ?').bind(attempts, status, now, id).run();
  else await env.DB.prepare('UPDATE webhook_deliveries SET attempts = ?, last_status = ?, next_at = ? WHERE id = ?').bind(attempts, status, now + BACKOFF[attempts - 1], id).run();
  return { ok: status >= 200 && status < 300, status };
}
export async function deliverDue(env, until) {   // the tick: deliveries whose time has come
  const due = (await env.DB.prepare('SELECT id FROM webhook_deliveries WHERE delivered_at IS NULL AND given_up_at IS NULL AND next_at <= ? ORDER BY next_at LIMIT 10').bind(nowMs()).all()).results || [];
  let n = 0; for (const d of due) { if (Date.now() > until) break; await deliver(env, d.id); n++; }
  return n;
}

// ---- retention (DATA.md rows "connections", "a person's own material", "webhook deliveries") ----
export async function ownRetention(env, now) {
  const out = { own_material: 0, connections: 0, webhook_deliveries: 0 };
  out.own_material += await deleteOwn(env, 'delete_at < ?', [now]);
  out.own_material += await deleteOwn(env, 'connection_id IN (SELECT id FROM connections WHERE revoked_at IS NOT NULL)', []);
  out.own_material += await deleteOwn(env, 'task_id IN (SELECT t.id FROM tasks t JOIN connections c ON c.id = t.connection_id JOIN members m ON m.id = c.member_id WHERE m.left_at IS NOT NULL)', []);
  out.webhook_deliveries = (await env.DB.prepare('DELETE FROM webhook_deliveries WHERE created_at < ?').bind(now - 7 * DAY).run()).meta.changes;
  // a revoked connection: 30 days for the record of what it sent, then its asks, its principal and key, and the row
  const gone = (await env.DB.prepare('SELECT id, principal_id FROM connections WHERE revoked_at IS NOT NULL AND revoked_at < ? LIMIT 10').bind(now - 30 * DAY).all()).results || [];
  for (const c of gone) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM tasks WHERE connection_id = ?').bind(c.id),
      env.DB.prepare('DELETE FROM keys WHERE principal_id = ?').bind(c.principal_id),
      env.DB.prepare('DELETE FROM principals WHERE id = ?').bind(c.principal_id),
      env.DB.prepare('DELETE FROM connections WHERE id = ?').bind(c.id),
    ]);
    out.connections++;
  }
  return out;
}

// counts only, for the operator (GET /v1/status)
export async function ownCounts(env) {
  try {
    const r = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM connections WHERE revoked_at IS NULL) AS connections, (SELECT COUNT(*) FROM own_material) AS pieces,
        (SELECT COUNT(*) FROM webhook_deliveries WHERE delivered_at IS NULL AND given_up_at IS NULL) AS deliveries_waiting`).first();
    return { connections: r.connections, pieces_of_own_material: r.pieces, answers_waiting_to_be_delivered: r.deliveries_waiting, note: 'Counts only: nobody at person.tools sees what a person\'s own AIs send them.' };
  } catch { return null; }
}
