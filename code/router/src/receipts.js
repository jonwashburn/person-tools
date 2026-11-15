// Receipts (spec section 15.1): a JSON Web Signature in compact form (RFC 7515), Ed25519 ("alg":"EdDSA", RFC 8037), the
// key's kid in the header. Public keys: the JWKS at /.well-known/jwks.json (and in discovery's jwks_uri).
import { b64url, unb64url, unb64, sha256hex } from './util.js';
import { BUILD } from './build_info.js';

const enc = new TextEncoder(), dec = new TextDecoder();
const ALGS = [{ name: 'Ed25519' }, { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' }];

async function importPriv(pkcs8b64) {
  let last; for (const a of ALGS) { try { return await crypto.subtle.importKey('pkcs8', unb64(pkcs8b64), a, false, ['sign']); } catch (e) { last = e; } } throw last;
}
async function importPub(raw) {
  let last; for (const a of ALGS) { try { return await crypto.subtle.importKey('raw', raw, a, false, ['verify']); } catch (e) { last = e; } } throw last;
}

export function receiptKeys() { return BUILD.receipt_keys || []; }
export function jwks() {
  return { keys: receiptKeys().map(k => ({ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', use: 'sig', kid: k.key_id, x: b64url(unb64(k.public_key_b64)) })), revoked: [] };
}

export async function callRef(env, callId) { return 'sha256:' + await sha256hex(callId + ':' + (env.SEAT_SECRET || 'local')); }

export async function signJws(env, payload) {
  if (!env.RECEIPT_KEY_PKCS8) throw new Error('receipt signing key is not set');
  const kid = (receiptKeys()[0] || {}).key_id || 'rk_unset';
  const head = b64url(enc.encode(JSON.stringify({ alg: 'EdDSA', kid, typ: 'JWT' })));
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const k = await importPriv(env.RECEIPT_KEY_PKCS8);
  const sig = new Uint8Array(await crypto.subtle.sign(k.algorithm, k, enc.encode(head + '.' + body)));
  return { jws: head + '.' + body + '.' + b64url(sig), kid };
}

// RCPT-3: {valid, receipt, kid, revoked}
export async function verifyJws(jws) {
  if (typeof jws !== 'string' || jws.split('.').length !== 3) return { valid: false, receipt: null, kid: null, revoked: false, reason: 'not a compact JWS (three parts joined by dots)' };
  const [h, p, s] = jws.split('.');
  let header, receipt;
  try { header = JSON.parse(dec.decode(unb64url(h))); receipt = JSON.parse(dec.decode(unb64url(p))); } catch { return { valid: false, receipt: null, kid: null, revoked: false, reason: 'header or payload is not base64url JSON' }; }
  const kid = header.kid || null;
  if (header.alg !== 'EdDSA') return { valid: false, receipt, kid, revoked: false, reason: 'alg is not EdDSA' };
  const key = receiptKeys().find(k => k.key_id === kid);
  if (!key) return { valid: false, receipt, kid, revoked: false, reason: 'unknown kid; the keys are at jwks_uri' };
  let ok = false;
  try { const pk = await importPub(unb64(key.public_key_b64)); ok = await crypto.subtle.verify(pk.algorithm, pk, unb64url(s), enc.encode(h + '.' + p)); } catch { ok = false; }
  return ok ? { valid: true, receipt, kid, revoked: false } : { valid: false, receipt, kid, revoked: false, reason: 'the signature does not match' };
}
