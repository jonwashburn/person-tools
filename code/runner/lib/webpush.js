// Web push with no payload (RFC 8030 + VAPID, RFC 8292), for Cloudflare Workers / Pages Functions (WebCrypto only).
// For the router to import: the ring carries no words; the person's service worker asks our own page what
// is on offer and shows only the minutes and the pay (RING_RULES rule 7). No payload means no message encryption.
//
// usage (router):
//   import { sendRing } from "../../runner/lib/webpush.js";   // or copy this file
//   const r = await sendRing(subscription, env);   // subscription = the JSON the page posted: {endpoint, keys:{p256dh, auth}}
//   // r = { ok, status, gone }   gone=true (404/410) means the subscription is dead: delete it from the member.
// env: VAPID_PRIVATE_JWK (JSON string {kty,crv,x,y,d}), VAPID_PUBLIC_KEY (base64url, 65 bytes), VAPID_SUBJECT (https URL).

const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uText = (s) => b64u(new TextEncoder().encode(s));

let keyCache = null;
async function signingKey(jwkText) {
  if (keyCache && keyCache.text === jwkText) return keyCache.key;
  const jwk = JSON.parse(jwkText);
  const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d, ext: true },
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  keyCache = { text: jwkText, key };
  return key;
}

// The VAPID token for one push service (aud = the endpoint's origin), valid 12 hours.
export async function vapidToken(endpoint, env, nowSec = Math.floor(Date.now() / 1000)) {
  const aud = new URL(endpoint).origin;
  const head = b64uText(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const body = b64uText(JSON.stringify({ aud, exp: nowSec + 12 * 3600, sub: env.VAPID_SUBJECT || "https://person.tools" }));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await signingKey(env.VAPID_PRIVATE_JWK), new TextEncoder().encode(head + "." + body));
  return head + "." + body + "." + b64u(sig);   // WebCrypto gives r||s (64 bytes), which is what JWS ES256 wants
}

// One ring. TTL 60 s (an offer is held for about a minute), urgency high. Returns quickly; never throws on a bad push.
export async function sendRing(subscription, env, { ttl = 60, topic = "call" } = {}) {
  try {
    if (!subscription || !subscription.endpoint || !/^https:\/\//.test(subscription.endpoint)) return { ok: false, status: 0, gone: true, why: "no endpoint" };
    const jwt = await vapidToken(subscription.endpoint, env);
    const r = await fetch(subscription.endpoint, {
      method: "POST",
      headers: { TTL: String(ttl), Urgency: "high", Topic: topic, Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`, "Content-Length": "0" },
    });
    return { ok: r.status >= 200 && r.status < 300, status: r.status, gone: r.status === 404 || r.status === 410 };
  } catch (e) {
    return { ok: false, status: 0, gone: false, why: String(e && e.message || e).slice(0, 120) };
  }
}
