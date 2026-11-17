// CONNECTING FROM THE SERVICE (OWNER_router_31 item 2; order item 19; the standard's 27.9, ASKS-25). A service where people sign in sends the
// person to run.person.tools/connect with brand, state and return; the person, on their own page's credential, sees the proved brand and
// connects it or not; the service gets a code (single use, ten minutes) and exchanges it with its Brand-Key for the connection's key and
// webhook secret. The key is minted at the exchange (the one made with the connection is never shown or kept), so no key waits in the
// database. The server never learns who the person is to the service; the service learns nothing of the person but the connection.
import { fixable, notFixable } from './spec.js';
import { rid, nowMs, sha256hex, iso } from './util.js';

const TEN_MIN = 600000;
async function provedBrand(env, brandId) {
  if (typeof brandId !== 'string' || !/^br_[a-z0-9]{4,80}$/.test(brandId)) throw fixable('invalid_field', 'brand', 'brand is the service\'s brand_id (br_...).', null, {}, 400);
  const r = await env.DB.prepare('SELECT principal_id, brand_json, domain, verified_at, brand_id FROM brands WHERE brand_id = ?').bind(brandId).first();
  if (!r || !r.domain) throw notFixable(400, 'brand_not_proved', 'That brand names no domain, so nothing can connect to it.');
  r.proved = !!r.verified_at;   // OWNER_router_32: an unproved (test) brand connects test members only
  return r;
}
// ASKS-25: return is an https address on the brand's proved domain, or nothing happens
function checkReturn(ret, domain) {
  let u; try { u = new URL(String(ret || '')); } catch { u = null; }
  if (!u || u.protocol !== 'https:' || u.username || u.password || u.port !== '' || !(u.hostname === domain || u.hostname.endsWith('.' + domain)))   // u.port: TRUST 8:11 (the proof covers 443 only)
    throw fixable('invalid_field', 'return', `return is an https address on ${domain} (or a subdomain), the brand's proved domain, on the default port.`, `https://${domain}/person-tools/return`, {}, 400);
  return u;
}
// POST /v1/connect/brand {brand, return}: what the connect page shows (the brand as anyone may see it), with the return checked first
export async function connectInfo(env, request, b) {
  for (const k of Object.keys(b || {})) if (!['brand', 'return'].includes(k)) throw fixable('unknown_field', k, 'Send {"brand", "return"}.', null, {}, 400);
  const r = await provedBrand(env, b && b.brand);
  checkReturn(b && b.return, r.domain);
  const { brandView } = await import('./cards.js'); const { apiBase } = await import('./util.js');
  return { brand: brandView(r, { is_real: r.proved ? 1 : 0 }, apiBase(request)), ...(r.proved ? {} : { test: true, test_note: 'A test brand, not verified: it connects test members only.' }), return_ok: true, urgencies: ['now', 'today', 'whenever'],
    note: 'Connecting gives this service a key that asks only you, under its proved name. You can rename it, limit how urgent its asks may be, and revoke it on your page at any time.' };
}
// POST /v1/members/{t}/connect {brand, state, return, name?, urgencies?}: the person connects the service from their own page
export async function connectForPerson(env, request, memberByToken, token, b) {
  for (const k of Object.keys(b || {})) if (!['brand', 'state', 'return', 'name', 'urgencies'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not a field here; send brand, state, return, name and urgencies.`, null, {}, 400);
  const r = await provedBrand(env, b && b.brand);
  const u = checkReturn(b && b.return, r.domain);
  const state = b && b.state;
  if (typeof state !== 'string' || !state || state.length > 500) throw fixable('invalid_field', 'state', 'state is the service\'s own value, 1 to 500 characters, sent back unchanged.', null, {}, 400);
  let brandName = 'A service'; try { brandName = String(JSON.parse(r.brand_json).name || brandName); } catch { }
  if (!r.proved) { const mm = await memberByToken(env, token); if (Number(mm.is_real) !== 0) throw notFixable(400, 'brand_not_proved', 'This brand has not proved its domain, so it connects test members only.'); }   // OWNER_router_32
  const { createConnection } = await import('./connections.js');
  const made = await createConnection(env, request, memberByToken, token, { name: (b && b.name) || brandName.slice(0, 40), ...(b && b.urgencies !== undefined ? { urgencies: b.urgencies } : {}) });
  const code = rid('cc_', 32), now = nowMs();
  await env.DB.prepare('UPDATE connections SET brand_principal_id = ?, connect_code_hash = ?, connect_code_until = ? WHERE id = ?').bind(r.principal_id, await sha256hex(code), now + TEN_MIN, made.connection_id).run();
  if (!r.proved) await env.DB.prepare("UPDATE principals SET test_run = 'test-brand' WHERE id = (SELECT principal_id FROM connections WHERE id = ?)").bind(made.connection_id).run();   // OWNER_router_32: marked as a test run's
  u.searchParams.set('code', code); u.searchParams.set('state', state);
  return { redirect: u.toString(), connection_id: made.connection_id, name: made.name, note: 'Connected. The service finishes it with the code; until then it cannot ask you.' };
}
// POST /v1/connect/token {code} with Brand-Key: once, within ten minutes, the connection's key, id and webhook secret
export async function connectToken(env, request, b) {
  for (const k of Object.keys(b || {})) if (k !== 'code') throw fixable('unknown_field', k, 'Send {"code"} with the header Brand-Key.', null, {}, 400);
  const { brandByKey } = await import('./cards.js');
  const bkey = await brandByKey(env, request);
  if (!bkey) throw notFixable(400, 'brand_not_proved', 'Send your Brand-Key header with the code.');
  const brandPr = bkey.pr;
  const code = String((b && b.code) || '');
  const c = /^cc_[a-z0-9]{8,80}$/.test(code) ? await env.DB.prepare('SELECT * FROM connections WHERE connect_code_hash = ? AND revoked_at IS NULL').bind(await sha256hex(code)).first() : null;
  if (!c || c.brand_principal_id !== brandPr || !(c.connect_code_until > nowMs())) throw notFixable(410, 'expired', 'That code is used, expired or not yours: start the connection again.');
  const claim = await env.DB.prepare('UPDATE connections SET connect_code_hash = NULL, connect_code_until = NULL WHERE id = ? AND connect_code_hash IS NOT NULL').bind(c.id).run();
  if (!claim.meta || claim.meta.changes !== 1) throw notFixable(410, 'expired', 'That code is used, expired or not yours: start the connection again.');
  const key = rid('conn_', 32);
  await env.DB.prepare('UPDATE keys SET key_hash = ? WHERE id = ?').bind(await sha256hex(key), c.key_id).run();   // the first key was never shown: this one replaces it
  const { newSecret } = await import('./own.js'); const sec = await newSecret(env, c.id); await sec.stmt.run();
  return { key, connection_id: c.id, webhook_secret: sec.secret, connected_at: iso(c.created_at), note: 'Shown once. The key asks only the person who connected you, wearing your brand; keep it as you keep your other keys.' };
}
