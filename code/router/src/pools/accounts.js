// A principal's own account with an outside pool: N2's second mode (TEAM.md, Pools: "a principal's own account with its
// own key"; PLAN s3). The principal connects its own pool token once; its calls on that pool then make and pay the pool's
// jobs on its own account, so the pool pays its people from the principal's balance there and this router charges only
// its router fee. Data: policy/DATA.md row 'pool_accounts' (the token sealed at rest, never logged, never returned).
//
// A token that starts with "recorded_" is the team's stand-in: the account is recorded, every request is answered from the
// adapter's recorded file and nothing reaches the pool. Any other token is a real one: calls on it stay refused until the
// pool confirms in writing that a router may hold a principal's key and the operator switches it on (<POOL>_PRINCIPAL_ACCOUNTS=on).
import { nowMs, iso, b64, unb64 } from '../util.js';
import { fixable, notFixable } from '../spec.js';
import { getAdapter } from './index.js';

const enc = new TextEncoder(), dec = new TextDecoder();

async function sealingKey(env) {
  if (!env.POOL_TOKEN_KEY) throw notFixable(500, 'internal', 'Connecting your own pool account is not set up on this server yet.');
  return crypto.subtle.importKey('raw', unb64(env.POOL_TOKEN_KEY), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
// AES-GCM, the row's principal and pool bound in as additional data, so a sealed token cannot be moved to another row.
async function seal(env, text, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, await sealingKey(env), enc.encode(text)));
  return b64(iv) + '.' + b64(ct);
}
async function unseal(env, sealed, aad) {
  const [iv, ct] = String(sealed).split('.');
  return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: enc.encode(aad) }, await sealingKey(env), unb64(ct)));
}

export function principalSwitchOn(env, pool) { return env[pool.toUpperCase() + '_PRINCIPAL_ACCOUNTS'] === 'on'; }

function poolOf(name) {
  const ad = getAdapter(name);
  if (!ad || !ad.principal_accounts) throw fixable('unknown_pool', 'pool', `"${name}" is not a pool you can connect your own account to. Pools that take one: prolific.`, 'prolific');
  return ad;
}

function mayConnect(key) {
  if (!key || key.anon) throw fixable('unauthorized', 'Authorization', 'Connecting your own pool account needs a key: send "Authorization: Bearer <key>".', 'Bearer real_...', {}, 401);
  if (key.class !== 'real' && !key.team) throw fixable('forbidden_for_key_class', 'Authorization', 'A test key reaches simulated people only, so it has no pool account to connect. A live key can connect one.', null, {}, 403);
}

function view(ad, row, env) {
  if (!row) return { pool: ad.name, connected: false, account: 'ours', note: `Calls on pool "${ad.name}" use this service's own account there.` };
  return { pool: ad.name, connected: true, account: 'yours', token_hint: '...' + row.token_hint, recorded: !!row.recorded, connected_at: iso(row.created_at),
    calls_open: !!row.recorded || principalSwitchOn(env, ad.name),
    note: row.recorded
      ? `A recorded stand-in account: calls on pool "${ad.name}" run through your account's path, answered by scripted stand-ins; nothing reaches ${ad.name}.`
      : principalSwitchOn(env, ad.name)
        ? `Calls on pool "${ad.name}" make and pay studies on your own account there; this service charges its router fee only.`
        : `Connected, but calls on a principal's own ${ad.name} account open only once ${ad.name} confirms in writing that a router may hold a principal's key. Until then your calls on pool "${ad.name}" are refused; disconnect to use this service's own account.` };
}

export async function getAccount(env, key, name) {
  mayConnect(key); const ad = poolOf(name);
  return view(ad, await accountRow(env, key.principal_id, ad.name), env);
}

export async function connectAccount(env, key, name, body) {
  mayConnect(key); const ad = poolOf(name);
  for (const k of Object.keys(body || {})) if (k !== 'token') throw fixable('unknown_field', k, `"${k}" is not a field here; send token.`, null);
  const token = body && body.token;
  if (typeof token !== 'string' || token.length < 8 || token.length > 400 || /\s/.test(token))
    throw fixable(token === undefined ? 'missing_field' : 'invalid_field', 'token', `token is your own ${ad.name} API token (8 to 400 characters, no spaces). It is sealed at rest and never shown again.`, null);
  const recorded = token.startsWith('recorded_');
  if (recorded && !key.team) throw fixable('invalid_field', 'token', 'That is a recorded stand-in token; connect your own real token.', null);
  // policy/DATA.md 'pool_accounts' (trust, 5:47 AM CT): a real pool token makes studies that reach real people, so only a
  // live key's principal may connect one. The team's keys may connect only a recorded stand-in, which reaches nobody.
  if (!recorded && key.class !== 'real') throw fixable('forbidden_for_key_class', 'Authorization', 'Only a live key may connect a real pool account: the studies it makes reach real people.', null, {}, 403);
  const aad = key.principal_id + ':' + ad.name;
  const row = { principal_id: key.principal_id, pool: ad.name, token_sealed: await seal(env, token, aad), token_hint: token.slice(-4), recorded: recorded ? 1 : 0, created_at: nowMs() };
  try {
    await env.DB.prepare('INSERT OR REPLACE INTO pool_accounts (principal_id, pool, token_sealed, token_hint, recorded, created_at) VALUES (?,?,?,?,?,?)')
      .bind(row.principal_id, row.pool, row.token_sealed, row.token_hint, row.recorded, row.created_at).run();
  } catch (e) { throw fixable('unsupported_feature', 'pool', 'Connecting your own pool account is not open yet on this server.', null); }
  return view(ad, row, env);
}

export async function disconnectAccount(env, key, name) {
  mayConnect(key); const ad = poolOf(name);
  let n = 0;
  try { n = (await env.DB.prepare('DELETE FROM pool_accounts WHERE principal_id = ? AND pool = ?').bind(key.principal_id, ad.name).run()).meta.changes; } catch { }
  return { pool: ad.name, connected: false, deleted: n, account: 'ours', note: n ? 'Your token is deleted from this service.' : 'No account of yours was connected.' };
}

// The router's own reads. accountRow never opens the seal; tokenFor does, only when a live request is about to be made.
export async function accountRow(env, principalId, pool) {
  try { return await env.DB.prepare('SELECT * FROM pool_accounts WHERE principal_id = ? AND pool = ?').bind(principalId, pool).first(); } catch { return null; }
}
export async function tokenFor(env, principalId, pool) {
  const row = await accountRow(env, principalId, pool);
  if (!row) throw new Error('no pool account');
  return unseal(env, row.token_sealed, principalId + ':' + pool);
}
