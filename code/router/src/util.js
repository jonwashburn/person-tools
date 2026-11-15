// Small helpers shared by every part of the router. No dependencies.

const B32 = 'abcdefghijkmnpqrstuvwxyz23456789'; // 32 symbols, no l/o/0/1 to misread

export function rid(prefix, n = 20) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += B32[x & 31];
  return prefix + s;
}

export function nowMs() { return Date.now(); }

// The team's own checks (orders r2 item 2): a header holding TEAM_CHECK_TOKEN exempts a request from the per-address
// hourly limits (keyless calls, test keys, demo keys). It changes no other rule: never which pool, never who is rung.
export function teamCheck(env, request) {
  const want = env && env.TEAM_CHECK_TOKEN, got = request && request.headers.get('x-hc-team-check');
  if (!want || !got || got.length !== want.length) return false;
  let d = 0; for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return d === 0;
}
export function iso(ms) { return ms == null ? null : new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'); }

// Money: integer cents inside, "12.34" strings on the wire (chief D5).
export function fmt(cents) {
  const neg = cents < 0; const c = Math.abs(Math.round(cents));
  return (neg ? '-' : '') + Math.floor(c / 100) + '.' + String(c % 100).padStart(2, '0');
}
export function parseUsd(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') { if (!isFinite(v) || v < 0) return NaN; const c = Math.round(v * 100); if (Math.abs(v * 100 - c) > 1e-6) return NaN; return c; }
  if (typeof v !== 'string') return NaN;
  const s = v.trim().replace(/^\$/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  const [a, b = ''] = s.split('.');
  return parseInt(a, 10) * 100 + parseInt((b + '00').slice(0, 2), 10);
}

export function b64url(bytes) {
  let s = ''; const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
  const bin = atob(s); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
export function b64(bytes) { let s = ''; for (const x of bytes) s += String.fromCharCode(x); return btoa(s); }
export function unb64(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

const enc = new TextEncoder();
export async function sha256hex(text) {
  const d = await crypto.subtle.digest('SHA-256', typeof text === 'string' ? enc.encode(text) : text);
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function hmac(secret, text) {
  const k = await hmacKey(secret);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(text)));
}
export async function hmacHex(secret, text) {
  return [...(await hmac(secret, text))].map(x => x.toString(16).padStart(2, '0')).join('');
}

// Seat tokens (chief D6): st_ + base64url(payload) + "." + base64url(HMAC-SHA256)
export async function signSeatToken(secret, payload) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = b64url(await hmac(secret, 'seat.' + body));
  return 'st_' + body + '.' + sig;
}
export async function readSeatToken(secret, token) {
  if (typeof token !== 'string' || !token.startsWith('st_')) return null;
  const [body, sig] = token.slice(3).split('.');
  if (!body || !sig) return null;
  const k = await hmacKey(secret);
  let ok = false;
  try { ok = await crypto.subtle.verify('HMAC', k, unb64url(sig), enc.encode('seat.' + body)); } catch { ok = false; }
  if (!ok) return null;
  try { return JSON.parse(new TextDecoder().decode(unb64url(body))); } catch { return null; }
}

// Arrival tokens for outside pools: their own prefix and their own signing text, never readable as a seat token (R10).
export async function signArrivalToken(secret, payload) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return 'ar_' + body + '.' + b64url(await hmac(secret, 'arrival.' + body));
}

export async function readArrivalToken(secret, token) {
  if (typeof token !== 'string' || !token.startsWith('ar_')) return null;
  const [body, sig] = token.slice(3).split('.');
  if (!body || !sig) return null;
  let ok = false;
  try { ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64url(sig), enc.encode('arrival.' + body)); } catch { ok = false; }
  if (!ok) return null;
  try { return JSON.parse(new TextDecoder().decode(unb64url(body))); } catch { return null; }
}

// Canonical JSON (chief D13): sorted keys, no whitespace.
export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

export function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(v))); }
export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Deterministic pseudo-random numbers for the simulated pool (so a call's simulated people are stable on re-read).
export function seeded(seedText) {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) { h ^= seedText.charCodeAt(i); h = Math.imul(h, 16777619); }
  return function () {
    h += 0x6D2B79F5; let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hostOf(request) { return new URL(request.url).host; }
export function apiBase(request) { const u = new URL(request.url); return u.protocol + '//' + u.host; }
// chief D1: run <-> api by the first label, askpeople-run <-> askpeople-api anywhere in the host.
export function runnerBase(request) {
  const u = new URL(request.url); let h = u.host;
  if (h.includes('askpeople-api')) h = h.replace('askpeople-api', 'askpeople-run');
  else if (h.startsWith('api.')) h = 'run.' + h.slice(4);
  else if (h.startsWith('127.0.0.1') || h.startsWith('localhost')) return u.protocol + '//' + h; // local check
  return u.protocol + '//' + h;
}
export function siteBase(request) {
  const u = new URL(request.url); let h = u.host;
  if (h.includes('askpeople-api')) h = h.replace('askpeople-api', 'askpeople-site');
  else if (h.startsWith('api.')) h = h.slice(4);
  return u.protocol + '//' + h;
}
