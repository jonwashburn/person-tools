// Apple push for the person's iPhone app (the owner, 10:44 PM CT 14 Nov 2026: the operator asked for a mobile app).
// Token-based auth with Apple's .p8 key: APNS_KEY_P8 (the PKCS#8 private key, PEM or bare base64), APNS_KEY_ID, APNS_TEAM_ID,
// APNS_TOPIC (the app's bundle id, tools.person.app). Until all four exist nothing is sent, each offer's ring record says
// 'apple push not configured', and GET /v1/status says so; device tokens are kept, so the app rings the moment the key is set.
// The alert names who answers for the call and what it is (its kind, minutes and pay); never the asker's words.

export const apnsConfigured = (env) => !!(env && env.APNS_KEY_P8 && env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_TOPIC);

const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uText = (s) => b64u(new TextEncoder().encode(s));

let KEY = null, KEY_FOR = null, JWT = null, JWT_AT = 0, JWT_FOR = null;
async function signingKey(p8) {
  if (KEY && KEY_FOR === p8) return KEY;
  const body = String(p8).replace(/-----[A-Z ]+-----/g, '').replace(/\\n/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  KEY = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  KEY_FOR = p8;
  return KEY;
}

// The provider token: ES256, header {alg, kid}, claims {iss: team, iat}. Apple accepts one for an hour and refuses a new one
// more often than every 20 minutes, so it is kept 40 minutes.
export async function providerToken(env, nowSec = Math.floor(Date.now() / 1000)) {
  const who = env.APNS_KEY_ID + ':' + env.APNS_TEAM_ID;
  if (JWT && JWT_FOR === who && nowSec - JWT_AT < 2400) return JWT;
  const head = b64uText(JSON.stringify({ alg: 'ES256', kid: env.APNS_KEY_ID }));
  const claims = b64uText(JSON.stringify({ iss: env.APNS_TEAM_ID, iat: nowSec }));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signingKey(env.APNS_KEY_P8), new TextEncoder().encode(head + '.' + claims));
  JWT = head + '.' + claims + '.' + b64u(sig); JWT_AT = nowSec; JWT_FOR = who;
  return JWT;
}

const KIND_WORD = { listen: 'Listen', watch: 'Watch', look: 'Look', view: 'Look', play: 'Play', compare: 'Compare', read: 'Read', answer: 'Answer' };

// The alert for one offer (RING_RULES 7 as trust changed it, 11:13 PM CT 14 Nov): the title names who answers for the call
// only on a private panel (the person joined that asker's panel and knows them); otherwise "A call for you". The body: kind,
// minutes and pay (or that it is an unpaid test). Never the ask or the material: Apple carries these words readable.
// OWNER_router_6: a person who chose no sounds gets the same alert with no "sound" key at all
export function offerAlert({ askerName, privatePanel, kind, minutes, payCents, callId, seatId, expiresAt, sound = true }) {
  const pay = payCents > 0 ? `$${(payCents / 100).toFixed(2)}` : 'unpaid test';
  return {
    aps: { alert: { title: privatePanel && askerName ? String(askerName).slice(0, 80) : 'A call for you', body: `${KIND_WORD[kind] || 'A call'} · about ${minutes} min · ${pay}` },
      category: 'OFFER', 'thread-id': callId, ...(sound ? { sound: 'ring.caf' } : {}), 'interruption-level': 'time-sensitive' },   // the app bundles ring.caf (owner 11:28 PM CT)
    call_id: callId, seat_id: seatId, offer_expires_at: new Date(expiresAt).toISOString(), held_until: new Date(expiresAt).toISOString(),
  };
}

// A "now" task's one ring (tasks.js ringTask): who it is from, never the task's words
// OWNER_router_30: YESNO for a question answered Yes or No with no line and nothing signed; TASK otherwise. Both let the app's extension
// fetch the line (mutable-content) when the person turned it on; an offer (a call's ring) never waits for an extension.
export function isYesNo(step) {
  return !!(step && step.type === 'question' && Array.isArray(step.choices) && step.choices.length === 2 && step.choices.includes('Yes') && step.choices.includes('No') && !step.line_for);
}
export function taskAlert({ program, taskId, sound = true, step = null }) {
  const yesno = isYesNo(step), who = program || 'one of your programs';
  return { aps: { alert: { title: String(who).slice(0, 80), body: 'Press and hold to answer.' }, category: yesno ? 'YESNO' : 'TASK', 'thread-id': 'tasks',   // OWNER_router_34: who is asking, then how to answer
    'mutable-content': 1, ...(sound ? { sound: 'ring.caf' } : {}), 'interruption-level': 'time-sensitive' }, task_id: taskId };
}

// Whether this Worker can reach Apple's push service at all (Apple speaks HTTP/2 only): one request with a made-up provider
// token to a made-up device on the development host. Reached, Apple answers 403 with a JSON reason (InvalidProviderToken or
// similar); a refused connection or a non-JSON answer means the Worker cannot speak to it directly.
export async function probeApns() {
  const t0 = Date.now();
  try {
    const r = await fetch('https://api.sandbox.push.apple.com/3/device/' + '0'.repeat(64), { method: 'POST',
      headers: { authorization: 'bearer probe.probe.probe', 'apns-topic': 'tools.person.app', 'apns-push-type': 'alert', 'content-type': 'application/json' },
      body: JSON.stringify({ aps: { alert: 'probe' } }) });
    const text = await r.text();
    let reason = null; try { reason = JSON.parse(text).reason || null; } catch { }
    return { reached: !!reason, status: r.status, reason, body: reason ? undefined : text.slice(0, 200), ms: Date.now() - t0 };
  } catch (e) { return { reached: false, status: 0, error: String(e && e.message || e).slice(0, 200), ms: Date.now() - t0 }; }
}

// One alert to one device. -> { ok, status, why, gone } (gone: Apple says the token is dead; the caller forgets it)
export async function sendApns(env, device, payload, { expiresAt, collapseId } = {}) {
  if (!apnsConfigured(env)) return { ok: false, status: 0, why: 'apple push not configured' };
  if (!device || !device.token) return { ok: false, status: 0, why: 'no device' };
  const host = device.env === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  let r;
  try {
    r = await fetch(`https://${host}/3/device/${device.token}`, {
      method: 'POST',
      headers: { authorization: 'bearer ' + (await providerToken(env)), 'apns-topic': env.APNS_TOPIC, 'apns-push-type': 'alert', 'apns-priority': '10',
        'apns-expiration': String(Math.floor((expiresAt || Date.now() + 60000) / 1000)), ...(collapseId ? { 'apns-collapse-id': String(collapseId).slice(0, 64) } : {}),
        'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) { return { ok: false, status: 0, why: 'apple push unreachable: ' + String(e && e.message || e).slice(0, 80) }; }
  if (r.status === 200) return { ok: true, status: 200 };
  let reason = null; try { reason = (await r.json()).reason || null; } catch { }
  return { ok: false, status: r.status, why: reason || 'apple push answered ' + r.status, gone: r.status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered' };   // operations 10:19: nothing else drops a token
}
