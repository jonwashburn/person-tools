// APPLE APP ATTEST (owner/OWNER_router_4 item 2; SPEC 4.5.3, mark device_approved): the app's signing key is made inside our app on
// real Apple hardware, and Apple's attestation says so. This file checks an attestation object the way Apple's "Validating apps that
// connect to your server" sets out: the certificate chain to Apple's App Attestation root (pinned below, from
// https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem, SHA-256 fingerprint
// 1C:B9:82:3B:A2:8B:A6:AD:2D:33:A0:06:94:1D:E2:AE:4F:51:3E:F1:D4:E8:31:B9:F7:E0:FA:7B:62:42:C9:32), the nonce in the leaf's extension
// 1.2.840.113635.100.8.2, the key id, the App ID's hash, a zero counter and Apple's own aaguid.
import { cbor, unb64u, b64u } from './webauthn.js';

export const APPLE_APP_ATTEST_ROOT = 'MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYwJAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwKQXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNaFw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlvbiBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9ybmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdhNbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9auYen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijVoyFraWVIyd/dganmrduC1bmTBGwD';

// ---- DER (ASN.1) ----
function tlv(b, i) {
  const tag = b[i]; let len = b[i + 1], off = i + 2;
  if (len & 0x80) { const n = len & 0x7f; if (n < 1 || n > 4) throw new Error('der length'); len = 0; for (let k = 0; k < n; k++) len = len * 256 + b[off + k]; off += n; }
  if (off + len > b.length) throw new Error('der short');
  return { tag, start: i, off, len, end: off + len };
}
function kids(b, t) { const out = []; let i = t.off; while (i < t.end) { const c = tlv(b, i); out.push(c); i = c.end; } return out; }
const bytes = (b, t) => b.slice(t.off, t.end);
function oid(u8) { const parts = [Math.floor(u8[0] / 40), u8[0] % 40]; let v = 0; for (let i = 1; i < u8.length; i++) { v = v * 128 + (u8[i] & 0x7f); if (!(u8[i] & 0x80)) { parts.push(v); v = 0; } } return parts.join('.'); }
function time(b, t) { const s = new TextDecoder().decode(bytes(b, t)); const y = t.tag === 0x17 ? (Number(s.slice(0, 2)) >= 50 ? 1900 : 2000) + Number(s.slice(0, 2)) : Number(s.slice(0, 4)); const r = t.tag === 0x17 ? s.slice(2) : s.slice(4);
  return Date.UTC(y, Number(r.slice(0, 2)) - 1, Number(r.slice(2, 4)), Number(r.slice(4, 6)), Number(r.slice(6, 8)), Number(r.slice(8, 10))); }
export function parseCert(der) {
  const b = der instanceof Uint8Array ? der : new Uint8Array(der);
  const cert = tlv(b, 0), [tbs, sigAlg, sigVal] = kids(b, cert);
  const t = kids(b, tbs); let k = 0; if (t[0].tag === 0xa0) k = 1;   // [0] version
  const validity = kids(b, t[k + 3]), spki = t[k + 5];
  const spkiKids = kids(b, spki), algKids = kids(b, spkiKids[0]);
  const curve = algKids[1] ? oid(bytes(b, algKids[1])) : null;
  const point = bytes(b, spkiKids[1]).slice(1);   // BIT STRING: the unused-bits byte first
  const ext = {}; const e = t.find((x) => x.tag === 0xa3);
  if (e) for (const one of kids(b, kids(b, e)[0])) { const f = kids(b, one); ext[oid(bytes(b, f[0]))] = bytes(b, f[f.length - 1]); }
  return { tbs: b.slice(tbs.start, tbs.end), sigAlg: oid(bytes(b, kids(b, sigAlg)[0])), sig: bytes(b, sigVal).slice(1), spki: b.slice(spki.start, spki.end), curve, point,
    notBefore: time(b, validity[0]), notAfter: time(b, validity[1]), ext };
}
const CURVE = { '1.2.840.10045.3.1.7': ['P-256', 32], '1.3.132.0.34': ['P-384', 48] };
const HASH = { '1.2.840.10045.4.3.2': 'SHA-256', '1.2.840.10045.4.3.3': 'SHA-384' };
function derSigToRaw(der, n) {
  const b = der; const s = tlv(b, 0); const [r, ss] = kids(b, s);
  const fix = (x) => { let v = bytes(b, x); while (v.length > n && v[0] === 0) v = v.slice(1); const o = new Uint8Array(n); o.set(v, n - v.length); return o; };
  const out = new Uint8Array(2 * n); out.set(fix(r), 0); out.set(fix(ss), n); return out;
}
export async function signedBy(child, parent) {   // exported for the local check only
  const c = CURVE[parent.curve], h = HASH[child.sigAlg]; if (!c || !h) throw new Error('a key or signature type Apple does not use');
  const key = await crypto.subtle.importKey('spki', parent.spki, { name: 'ECDSA', namedCurve: c[0] }, false, ['verify']);
  return crypto.subtle.verify({ name: 'ECDSA', hash: h }, key, derSigToRaw(child.sig, c[1]), child.tbs);
}
const sha256 = async (u8) => new Uint8Array(await crypto.subtle.digest('SHA-256', u8));
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// -> { publicKey (the attested key, an uncompressed P-256 point), environment: 'production' | 'development', receipt }
export async function verifyAppAttest({ attestation, keyId, clientDataHash, appId, now = Date.now() }) {
  const att = cbor(unb64u(attestation)).value;
  if (!(att instanceof Map) || att.get('fmt') !== 'apple-appattest') throw new Error('not an App Attest attestation');
  const st = att.get('attStmt'), authData = att.get('authData');
  const x5c = st instanceof Map ? st.get('x5c') : null;
  if (!Array.isArray(x5c) || x5c.length < 2 || !(authData instanceof Uint8Array)) throw new Error('attestation statement');
  const leaf = parseCert(x5c[0]), mid = parseCert(x5c[1]), root = parseCert(unb64u(APPLE_APP_ATTEST_ROOT.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')));
  for (const c of [leaf, mid]) if (now < c.notBefore || now > c.notAfter) throw new Error('a certificate is outside its dates');
  if (!(await signedBy(leaf, mid)) || !(await signedBy(mid, root))) throw new Error('the certificates do not lead to Apple\'s App Attestation root');
  // the nonce: SHA-256(authData || clientDataHash), in the leaf's extension as SEQUENCE { [1] { OCTET STRING } }
  const nonce = await sha256(new Uint8Array([...authData, ...clientDataHash]));
  const ext = leaf.ext['1.2.840.113635.100.8.2']; if (!ext) throw new Error('no nonce in the certificate');
  const s = tlv(ext, 0); const inner = kids(ext, s)[0]; const oct = inner.tag === 0x04 ? inner : kids(ext, inner)[0];
  if (!eq(bytes(ext, oct), nonce)) throw new Error('the nonce does not match');
  // the key id is SHA-256 of the leaf's public key (the uncompressed point)
  const kid = unb64u(keyId);
  if (!eq(await sha256(leaf.point), kid)) throw new Error('the key id does not match the attested key');
  const rpIdHash = authData.slice(0, 32), counter = ((authData[33] << 24) >>> 0) + (authData[34] << 16) + (authData[35] << 8) + authData[36];
  if (!eq(rpIdHash, await sha256(new TextEncoder().encode(appId)))) throw new Error('the App ID does not match');
  if (counter !== 0) throw new Error('the counter is not zero');
  const aaguid = new TextDecoder().decode(authData.slice(37, 53));
  const environment = aaguid === 'appattestdevelop' ? 'development' : aaguid === 'appattest\u0000\u0000\u0000\u0000\u0000\u0000\u0000' ? 'production' : null;
  if (!environment) throw new Error('not Apple\'s App Attest service');
  const n = (authData[53] << 8) | authData[54]; const credId = authData.slice(55, 55 + n);
  if (!eq(credId, kid)) throw new Error('the credential id is not the key id');
  return { publicKey: b64u(leaf.point), environment, receipt: st.get('receipt') ? b64u(st.get('receipt')) : null };
}
