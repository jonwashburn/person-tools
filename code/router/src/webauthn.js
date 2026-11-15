// Passkeys (WebAuthn Level 2) for person accounts (owner/OWNER_router_10 A, 12:54 PM CT 15 Nov 2026; operations 12:57: "accept ANY
// authenticator"): attestation "none" (no list of authenticator makers), user verification required, discoverable credentials.
// The relying party is person.tools; its pages on person.tools and its subdomains, and the iPhone app (associated domain), sign in.
// This file only checks what a browser or phone sends; accounts.js keeps the people, the challenges and the sessions.

export const RP_ID = 'person.tools';
export const ORIGINS = ['https://person.tools', 'https://www.person.tools', 'https://run.person.tools', 'https://admin.person.tools'];
export const ALGS = [-7, -8, -257];   // ES256, EdDSA, RS256

export const b64u = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function unb64u(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(s)) throw new Error('not base64url');
  const t = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  return Uint8Array.from(atob(t + '='.repeat((4 - t.length % 4) % 4)), (c) => c.charCodeAt(0));
}
const sha256 = async (u8) => new Uint8Array(await crypto.subtle.digest('SHA-256', u8));
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---- a small CBOR reader (RFC 8949): what attestation objects and COSE keys use ----
export function cbor(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); let i = 0;
  const need = (n) => { if (i + n > b.length) throw new Error('cbor: short'); };
  const uint = (ai) => {
    if (ai < 24) return ai;
    if (ai === 24) { need(1); return b[i++]; }
    if (ai === 25) { need(2); const v = (b[i] << 8) | b[i + 1]; i += 2; return v; }
    if (ai === 26) { need(4); const v = ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]; i += 4; return v; }
    if (ai === 27) { need(8); let v = 0; for (let k = 0; k < 8; k++) v = v * 256 + b[i + k]; i += 8; return v; }
    throw new Error('cbor: indefinite lengths are not used here');
  };
  const item = (depth = 0) => {
    if (depth > 16) throw new Error('cbor: too deep');
    need(1); const ib = b[i++], mt = ib >> 5, ai = ib & 31;
    if (mt === 0) return uint(ai);
    if (mt === 1) return -1 - uint(ai);
    if (mt === 2) { const n = uint(ai); need(n); const v = b.slice(i, i + n); i += n; return v; }
    if (mt === 3) { const n = uint(ai); need(n); const v = new TextDecoder().decode(b.slice(i, i + n)); i += n; return v; }
    if (mt === 4) { const n = uint(ai); const a = []; for (let k = 0; k < n; k++) a.push(item(depth + 1)); return a; }
    if (mt === 5) { const n = uint(ai); const m = new Map(); for (let k = 0; k < n; k++) { const key = item(depth + 1); m.set(key, item(depth + 1)); } return m; }
    if (mt === 7) { if (ai === 20) return false; if (ai === 21) return true; if (ai === 22) return null; throw new Error('cbor: float or simple value not used here'); }
    throw new Error('cbor: tag not used here');
  };
  const v = item(); return { value: v, end: i };
}

// ---- authenticator data ----
export function parseAuthData(ad) {
  if (ad.length < 37) throw new Error('authenticator data is short');
  const flags = ad[32], out = { rpIdHash: ad.slice(0, 32), flags, up: !!(flags & 1), uv: !!(flags & 4), be: !!(flags & 8), bs: !!(flags & 16), at: !!(flags & 64),
    signCount: ((ad[33] << 24) >>> 0) + (ad[34] << 16) + (ad[35] << 8) + ad[36] };
  if (out.at) {
    if (ad.length < 55) throw new Error('attested credential data is short');
    out.aaguid = ad.slice(37, 53);
    const n = (ad[53] << 8) | ad[54];
    if (n < 16 || n > 1023 || ad.length < 55 + n) throw new Error('credential id length');
    out.credentialId = ad.slice(55, 55 + n);
    const k = cbor(ad.slice(55 + n)); out.coseKey = k.value;
  }
  return out;
}

// ---- a COSE key as a JWK WebCrypto can use ----
export function coseToJwk(m) {
  if (!(m instanceof Map)) throw new Error('not a COSE key');
  const kty = m.get(1), alg = m.get(3);
  if (kty === 2 && alg === -7 && m.get(-1) === 1) return { alg: -7, jwk: { kty: 'EC', crv: 'P-256', x: b64u(m.get(-2)), y: b64u(m.get(-3)), ext: true } };
  if (kty === 1 && alg === -8 && m.get(-1) === 6) return { alg: -8, jwk: { kty: 'OKP', crv: 'Ed25519', x: b64u(m.get(-2)), ext: true } };
  if (kty === 3 && alg === -257) return { alg: -257, jwk: { kty: 'RSA', n: b64u(m.get(-1)), e: b64u(m.get(-2)), alg: 'RS256', ext: true } };
  throw new Error('a key type this service does not take (ES256, EdDSA or RS256)');
}

// ES256 signatures arrive DER-encoded; WebCrypto wants r||s, each 32 bytes
function derToRaw(der) {
  let i = 0; if (der[i++] !== 0x30) throw new Error('signature');
  let len = der[i++]; if (len & 0x80) i += len & 0x7f;
  const part = () => { if (der[i++] !== 0x02) throw new Error('signature'); const n = der[i++]; let v = der.slice(i, i + n); i += n; while (v.length > 32 && v[0] === 0) v = v.slice(1); const o = new Uint8Array(32); o.set(v, 32 - v.length); return o; };
  const r = part(), s = part(); const o = new Uint8Array(64); o.set(r, 0); o.set(s, 32); return o;
}
async function verifySig(alg, jwk, sig, data) {
  if (alg === -7) return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']), derToRaw(sig), data);
  if (alg === -8) return crypto.subtle.verify({ name: 'Ed25519' }, await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['verify']), sig, data);
  if (alg === -257) return crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']), sig, data);
  return false;
}

function clientData(raw, type, challenge, origins) {
  let c; try { c = JSON.parse(new TextDecoder().decode(raw)); } catch { throw new Error('clientDataJSON is not JSON'); }
  if (c.type !== type) throw new Error('clientDataJSON type');
  if (c.challenge !== challenge) throw new Error('the challenge does not match (or it was used, or it ran out)');
  if (!origins.includes(c.origin)) throw new Error('origin ' + String(c.origin).slice(0, 60) + ' is not one of ours');
  if (c.crossOrigin === true) throw new Error('cross-origin');
  return c;
}

// registration: the browser's PublicKeyCredential (as JSON, base64url fields) -> the credential to keep
export async function verifyRegistration(cred, { challenge, origins = ORIGINS, rpId = RP_ID }) {
  const r = cred && cred.response; if (!r || cred.type !== 'public-key') throw new Error('not a public-key credential');
  const cdRaw = unb64u(r.clientDataJSON);
  clientData(cdRaw, 'webauthn.create', challenge, origins);
  const att = cbor(unb64u(r.attestationObject)).value;
  if (!(att instanceof Map) || !(att.get('authData') instanceof Uint8Array)) throw new Error('attestation object');
  const ad = parseAuthData(att.get('authData'));
  if (!eq(ad.rpIdHash, await sha256(new TextEncoder().encode(rpId)))) throw new Error('relying party id');
  if (!ad.up || !ad.uv) throw new Error('user presence and verification are required');
  if (!ad.at || !ad.credentialId) throw new Error('no credential in the attestation');
  if (b64u(ad.credentialId) !== cred.id) throw new Error('credential id mismatch');
  const k = coseToJwk(ad.coseKey);
  return { id: cred.id, alg: k.alg, jwk: k.jwk, signCount: ad.signCount, backupEligible: ad.be, backedUp: ad.bs, aaguid: b64u(ad.aaguid),
    transports: Array.isArray(r.transports) ? r.transports.filter((t) => typeof t === 'string').slice(0, 6) : [] };
}

// sign-in: the assertion -> ok, with the new counter
export async function verifyAssertion(cred, stored, { challenge, origins = ORIGINS, rpId = RP_ID }) {
  const r = cred && cred.response; if (!r || cred.type !== 'public-key') throw new Error('not a public-key credential');
  const cdRaw = unb64u(r.clientDataJSON);
  clientData(cdRaw, 'webauthn.get', challenge, origins);
  const adRaw = unb64u(r.authenticatorData); const ad = parseAuthData(adRaw);
  if (!eq(ad.rpIdHash, await sha256(new TextEncoder().encode(rpId)))) throw new Error('relying party id');
  if (!ad.up || !ad.uv) throw new Error('user presence and verification are required');
  const data = new Uint8Array(adRaw.length + 32); data.set(adRaw, 0); data.set(await sha256(cdRaw), adRaw.length);
  if (!(await verifySig(stored.alg, stored.jwk, unb64u(r.signature), data))) throw new Error('the signature does not verify');
  if (stored.signCount > 0 && ad.signCount > 0 && ad.signCount <= stored.signCount) throw new Error('the counter went backwards (a copied key?)');
  return { signCount: ad.signCount, backedUp: ad.bs, userHandle: r.userHandle || null };
}
