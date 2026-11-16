// The router's HTTP surface (askpeople-api), to the standard's HTTP binding (spec section 19).
// Every request first settles whatever is overdue (no background loop anywhere).
import CANON_STATUS from './canon_status.json';   // the canon's status line, written into the build by bin/golive
import { rid, nowMs, iso, fmt, sha256hex, apiBase, siteBase, parseUsd, teamCheck } from './util.js';
import { CallError, notFixable, fixable, LIMITS, PAY_FLOOR_CENTS_PER_HOUR, SAMPLE_ID } from './spec.js';
import { quote, openCall, results, cancelCall, settle, getCallFor, callObject, outcome, ANON } from './calls.js';
import { getSeat, takeSeat, postEvents, postResponse, postStop, seatMedia, seatReceipt, serveMedia, memberOffers, memberReceipts, memberLeave, memberSettings, memberPush, callSeatsForTeam } from './seats.js';
import { listPanels, createPanel, getPanel, joinPanel, joinInfo, setOn } from './panels.js';
import { handleMcp } from './mcp.js';
import { jwks, verifyJws } from './receipts.js';
import { posting, acct, PRICE, balance, WHAT_YOU_PAY } from './money.js';
import { BUILD } from './build_info.js';
import { selftest } from './selftest.js';
import * as SCREENING from './screening/index.js';

const VERSION = '0.1';
const VH = BUILD.wire_prefix + '-version';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': `Authorization, Content-Type, Idempotency-Key, Mcp-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, X-Person-Member, ${VH}`, 'Access-Control-Expose-Headers': `Mcp-Session-Id, ${VH}` };

// the private paths only (a reader that ignores Allow lines must still see /v1/status and the discovery file as open)
const ROBOTS_TXT = 'User-agent: *\n' + ['/internal/', '/mcp', '/v1/members/', '/v1/seats/', '/v1/join/', '/v1/arrivals/', '/v1/approvals/', '/v1/calls/', '/v1/quotes',
  '/v1/keys', '/v1/panels', '/v1/media', '/v1/receipts/', '/v1/pools/', '/v1/balance', '/v1/me'].map(x => 'Disallow: ' + x).join('\n') + '\n';
function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body, null, 1), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', [VH]: VERSION, ...CORS, ...extra } });
}
function withHeaders(r) { const h = new Headers(r.headers); for (const [k, v] of Object.entries(CORS)) h.set(k, v); h.set(VH, VERSION); return new Response(r.body, { status: r.status, headers: h }); }

const UNAUTH_EXAMPLE = 'Bearer test_... (make one with POST /v1/keys {"class":"test"})';
async function authKey(env, request) {
  const h = (request.headers.get('authorization') || '').trim();
  if (!h || /^Bearer$/i.test(h)) return { key: null };   // 'Bearer ' with nothing after it (a plugin whose key is not set) is no key (market, 8:49)
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  const raw = m ? m[1] : '';
  const bad = (msg) => ({ key: null, error: fixable('unauthorized', 'Authorization', msg, UNAUTH_EXAMPLE, {}, 401) });
  return keyFromRaw(env, raw, new URL(request.url).pathname, bad);
}
async function keyFromRaw(env, raw, path, bad) {
  if (!/^(test|real|conn)_[a-z0-9]{20,64}$/.test(raw)) return bad('That is not a key of this server. Keys start test_ or real_; make a free test key with POST /v1/keys.');
  const k = await env.DB.prepare('SELECT k.*, p.name AS principal_name, p.class AS principal_class FROM keys k JOIN principals p ON p.id = k.principal_id WHERE k.key_hash = ?').bind(await sha256hex(raw)).first();
  if (!k) return bad('Unknown key. Make a free test key with POST /v1/keys.');
  if (raw.startsWith('conn_') || k.label === 'connection') {   // OWNER_all_10 B: a connection's key does exactly one thing
    const { connectionForKey, CONNECTION_PATHS } = await import('./connections.js');
    const c = raw.startsWith('conn_') && k.label === 'connection' ? await connectionForKey(env, k.id) : null;
    if (!c || c.revoked_at || k.suspended_at) return bad('This AI was disconnected by its person. Only they can connect it again.');
    if (!CONNECTION_PATHS.some((rx) => rx.test(path))) return { key: null, error: fixable('forbidden_for_key_class', 'Authorization', 'This key only asks the person who connected it: POST /v1/tasks, then GET /v1/tasks/{task_id} for the reply.', null, {}, 403) };
    return { key: { ...k, connection: c } };
  }
  if (k.suspended_at) return bad('This key is suspended. Tell your user: only they, or the operator who suspended it, can restore it.');
  if (k.class === 'real' && !(BUILD.real_key_labels || []).includes(k.label)) return bad('This live key is not listed by the operator, so it reaches nobody. Use a test key.');
  return { key: k };
}
function needKey(a) { if (a.error) throw a.error; if (!a.key) throw fixable('unauthorized', 'Authorization', 'This needs a key: send "Authorization: Bearer <key>". Make a free test key with POST /v1/keys {"class":"test"}.', UNAUTH_EXAMPLE, {}, 401); return a.key; }
function keyOrAnon(a) { if (a.error) throw a.error; return a.key || ANON; }

async function body(request) {
  const t = await request.text();
  if (!t) return {};
  if (t.length > 200000) throw notFixable(413, 'content_too_large', 'A request body is at most 200 KB.');
  let j; try { j = JSON.parse(t); } catch { throw fixable('invalid_json', 'body', 'The body is not valid JSON.', null); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw fixable('invalid_json', 'body', 'The body is a JSON object.', null);
  return j;
}

async function ipHashOf(env, request) {
  return (await sha256hex('ip:' + (request.headers.get('cf-connecting-ip') || 'local') + ':' + (env.SEAT_SECRET || ''))).slice(0, 24);
}

async function mintTestKey(env, request, caps = { call: 5000, day: 20000 }, testRun = undefined) {
  const ipHash = await ipHashOf(env, request);
  const now = nowMs();
  // a stranger's limit counts strangers' keys: keys our own checks made with the team header ('Team check principal') are
  // lifted from the limit and never count toward it (14 Nov, 6:57 PM CT: 93 of them in an hour turned the baseline's
  // stranger-road check from this server into a 429)
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM principals WHERE created_ip_hash = ? AND created_at > ? AND name NOT LIKE \'Team check principal %\'').bind(ipHash, now - 3600000).first();
  if (n.n >= 100 && !teamCheck(env, request)) throw notFixable(429, 'rate_limited', 'At most 100 test keys an hour from one address. Reuse a key you made.', { retry_after_seconds: 600 });
  const pr = rid('pr_'); const kid = rid('k_'); const key = rid('test_', 32);
  const { ourServer, FROM_OUR_ADDRESS } = await import('./util.js'); const fromUs = !teamCheck(env, request) && (await ourServer(env, ipHash));   // OWNER_router_21: our servers only
  await env.DB.batch([
    // OWNER_router_5: ours when our own checks made it (the team header); the owner column decides counting only
    env.DB.prepare('INSERT INTO principals (id, class, name, team, created_ip_hash, created_at, owner, owner_note, test_run) VALUES (?,?,?,?,?,?,?,?,?)').bind(pr, 'test', (teamCheck(env, request) ? 'Team check principal ' : 'Test principal ') + pr, 0, ipHash, now,
      teamCheck(env, request) || fromUs ? 'team' : 'outside', !teamCheck(env, request) && fromUs ? FROM_OUR_ADDRESS : null, testRun || null),   // OWNER_router_16: our address is ours, header or not; a test_run is never counted
    env.DB.prepare('INSERT INTO keys (id, principal_id, key_hash, class, label, cap_call_cents, cap_day_cents, team, created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(kid, pr, await sha256hex(key), 'test', 'self-made test key', caps.call, caps.day, 0, now),
    ...posting(env.DB, 'grant:' + pr, [{ ...acct.testGrant(), cents: -PRICE.test_grant_cents }, { ...acct.avail(pr), cents: PRICE.test_grant_cents }], null, 'test money for a new test principal', now),
  ]);
  return { key, class: 'test', principal_id: pr, ...(testRun ? { test_run: testRun } : {}), balance_usd: fmt(PRICE.test_grant_cents), test_money: true,
    caps: { per_call_usd: fmt(caps.call), per_day_usd: fmt(caps.day) }, pools: ['simulated'], reaches: ['simulated'], mcp: apiBase(request) + '/mcp',
    note: 'Keep this key; it is shown once. It reaches simulated people (every simulated answer is marked simulated) and the people who join a panel you make with it (POST /v1/panels gives the join link). Send it as "Authorization: Bearer <key>".',
    first_call: { ask: 'Listen once. Then tell me what you felt, in your own words.', kind: 'listen', content: SAMPLE_ID, people: 3, max_total_usd: '0.00' } };
}

// team_ and live keys are made only with the admin token (the router's seed script; the owner's bin/make_real_key)
async function adminKey(env, request, b) {
  const pr = rid('pr_'); const kid = rid('k_');
  const cls = b.class === 'real' ? 'real' : 'test';
  const key = rid(cls + '_', 32); const now = nowMs();
  const team = b.team ? 1 : 0;
  const principalId = b.principal_id || pr;
  const st = [];
  // OWNER_router_5: the admin route's principals are ours, except the front page's demo for a visitor
  const { ourServer, FROM_OUR_ADDRESS } = await import('./util.js'); const visitorFromUs = b.owner === 'visitor' && (await ourServer(env, b.ip_hash));   // OWNER_router_16, 21
  if (!b.principal_id) st.push(env.DB.prepare('INSERT INTO principals (id, class, name, team, created_ip_hash, created_at, owner, owner_note) VALUES (?,?,?,?,?,?,?,?)').bind(principalId, cls, String(b.principal_name || (team ? `the ${BUILD.names.network} team (test)` : 'principal')).slice(0, 80), team, b.ip_hash || null, now,
    b.owner === 'visitor' && !visitorFromUs ? 'visitor' : 'team', visitorFromUs ? FROM_OUR_ADDRESS : null));
  st.push(env.DB.prepare('INSERT INTO keys (id, principal_id, key_hash, class, label, cap_call_cents, cap_day_cents, team, created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(kid, principalId, await sha256hex(key), cls, String(b.label || '').slice(0, 60), Number.isInteger(b.cap_call_cents) && b.cap_call_cents >= 0 ? b.cap_call_cents : 5000, Number.isInteger(b.cap_day_cents) && b.cap_day_cents >= 0 ? b.cap_day_cents : 20000, team, now));
  if (!b.principal_id) st.push(...posting(env.DB, 'grant:' + principalId, [{ ...acct.testGrant(), cents: -PRICE.test_grant_cents }, { ...acct.avail(principalId), cents: PRICE.test_grant_cents }], null, 'test money', now));
  await env.DB.batch(st);
  return { key, key_id: kid, principal_id: principalId, class: cls, team: !!team, label: b.label || '', test_money: true };
}

function discovery(request) {
  const base = apiBase(request);
  return {
    protocol: BUILD.wire_prefix,
    versions: [{ version: VERSION, status: 'draft' }],
    api_base: base, mcp: base + '/mcp', openapi: base + '/openapi.json', jwks_uri: base + '/.well-known/jwks.json',
    mcp_protocol_versions: ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'],
    kinds: ['listen', 'watch', 'view', 'play', 'compare', 'answer'],
    pools: ['simulated', 'panel'],   // 'self' (the front page's demo pool, fixed asks only) is accepted but not listed (chief 04:21)
    features: ['keyless', 'url_content', 'outcome', 'panels', 'person_client'],   // person_client: the member interface of the standard's section 26 (WEB 2:57 PM CT 16 Nov: schema and suite list it)
    profiles: [BUILD.wire_prefix + '/fair-call/0.1'],   // DISC-3: its checks (F01-F04) pass and are held by the baseline
    screening_policy: siteBase(request) + '/policy',
    test_keys: base + '/v1/keys',
    privacy_floor: 20,
    pay_floor_usd_per_hour: fmt(PAY_FLOOR_CENTS_PER_HOUR),
    limits: { max_people: LIMITS.max_people, max_deadline_minutes: LIMITS.max_deadline_minutes, max_wait_seconds: LIMITS.max_wait_seconds, stop_minimum_usd: LIMITS.stop_minimum_usd },
    retention: { recordings_days: 90, responses_days: 395, records_days: 30 },
    test_money: true,
    ext: { [(BUILD.names && (BUILD.names.domain || BUILD.names.network)) || 'person.tools']: { status: CANON_STATUS.plain || 'preview: simulated people for everyone; real calls by invitation; all money is test money', names: BUILD.names,
      wire_note: 'The wire name is a placeholder until the standard is final; it changes once, then never.', what_you_pay: WHAT_YOU_PAY,
      mcp_protocol_versions: ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'], no_key: 'quotes and simulated calls work without a key', build: BUILD.stamp,
      // REACH 2:39 PM CT: agents learn connections where they read the API
      connections: { what: 'A person connects their own AI and gives it a key (conn_...) or a link; the key only asks that person, under the name they gave it, and reads the answer.',
        make_a_page: 'https://run.' + new URL(base).host.replace(/^api\./, '').replace(/^askpeople-api\.pages\.dev$/, 'person.tools') + '/start', ask: 'POST ' + base + '/v1/tasks {"title", "step", "unlocks"?, "urgency"?}',
        read: 'GET ' + base + '/v1/tasks/{task_id}: reply.action, reply.choice, reply.text, reply.approved_text', link: 'POST <link> with the same body; GET <link>/{task_id}',
        mcp: base + '/mcp with Authorization: Bearer conn_...: tools ask_person and ask_person_reply only', step_types: ['question', 'approve', 'link', 'command'] },
      // OWNER_market_7 item 3: the stand-in for strangers, reached by name, never listed in pools (it completes calls only with stand-ins)
      strangers_stand_in: { pool: 'prolific', keys: 'any test key (POST /v1/keys); not without a key', money: 'test money only', people: 'scripted stand-ins: nobody at Prolific is asked or paid, and every answer is marked simulated',
        real: 'Real strangers open later, on the operator\'s own Prolific account first; this stand-in runs the same path end to end' } } },
  };
}

function route(path) { return path.replace(/\/+$/, '') || '/'; }
// operations 12:37 PM CT 15 Nov (found by the app builder): a path that holds a credential is never echoed. Each such segment is
// written as {token}, {seat}, {code} or {id} in any message, log line or note.
const SECRET_SEGMENTS = [[/^mt_/, '{token}'], [/^st_/, '{seat}'], [/^jc_/, '{code}'], [/^conn_/, '{id}'], [/^ar_/, '{arrival}'], [/^(?:test|real)_/, '{key}']];
export function shownPath(path) {
  return String(path || '').split('/').map((seg) => { for (const [rx, w] of SECRET_SEGMENTS) if (rx.test(seg)) return w; return seg.length > 40 ? '{id}' : seg; }).join('/');
}
// SPEC 8.1 (OWNER_router_7): a person client sends its member credential as "Authorization: Bearer mt_...", never in an address.
// /v1/member/<op> is served by the same code as the older /v1/members/<credential>/<op>, which keeps working until the app and the
// runner page have moved over. 8.1's names: devices (the older device).
function memberPath(request, path) {
  if (!path.startsWith('/v1/member/')) return path;
  if (/^Bearer\s+ps_[a-z0-9]{20,80}$/i.test((request.headers.get('authorization') || '').trim())) return '/v1/member-session/' + path.slice('/v1/member/'.length);   // OWNER_router_12 item 2
  if (/^Bearer\s+ds_[a-z0-9]{20,80}$/i.test((request.headers.get('authorization') || '').trim())) return '/v1/member-desk/' + path.slice('/v1/member/'.length);   // OWNER_router_14
  const t = /^Bearer\s+(mt_[a-z0-9]{4,80})$/i.exec((request.headers.get('authorization') || '').trim());
  if (!t) return '/v1/member-credential-missing';
  const rest = path.slice('/v1/member/'.length).replace(/^devices(?=$|\/)/, 'device');
  return '/v1/members/' + t[1] + '/' + rest;
}

const TEAM_ADDRESSES_SEEN = new Set();   // per isolate: one write per address, not one per request
async function rememberTeamAddress(env, request) {
  if (request.headers.get('cf-worker')) return;   // a Cloudflare function's address is shared with everyone's functions: never mark it ours
  const h = await ipHashOf(env, request);
  if (TEAM_ADDRESSES_SEEN.has(h)) return;
  TEAM_ADDRESSES_SEEN.add(h);
  await env.DB.prepare('INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)').bind('team_ip:' + h, String(nowMs())).run();
}

// Deletion on time from ordinary traffic too (trust, 5:36 AM CT): at most once in 10 minutes, claimed by compare-and-swap
// on meta 'last_retention', run after the answer is sent (ctx.waitUntil) within a 5-second budget. So rows are deleted on
// time whenever anything calls the API, with or without the supervisor's tick.
async function retentionFromTraffic(env) {
  const now = nowMs();
  const up = await env.DB.prepare('UPDATE meta SET v = ? WHERE k = \'last_retention\' AND CAST(v AS INTEGER) < ?').bind(String(now), now - 600000).run();
  if (up.meta.changes !== 1) {
    const ins = await env.DB.prepare('INSERT OR IGNORE INTO meta (k, v) VALUES (\'last_retention\', ?)').bind(String(now)).run();
    if (ins.meta.changes !== 1) return;
  }
  const { retention } = await import('./retention.js');
  await retention(env, now, Date.now() + 5000);
}

export async function handle(request, env, ctx) {
  const url = new URL(request.url);
  let path = memberPath(request, route(url.pathname));
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, [VH]: VERSION, 'Access-Control-Max-Age': '86400' } });
  // OWNER_router_21: no address is learned from traffic any more (rememberTeamAddress is kept, unused; its old rows stay for the record)
  if (ctx && typeof ctx.waitUntil === 'function' && env.DB && !path.startsWith('/internal/')) ctx.waitUntil(retentionFromTraffic(env).catch(e => console.log('retention from traffic', String(e && e.message || e))));
  if ((path === '/_build.txt' || /^\/schemas\/[a-z_]+\.json$/.test(path)) && env.ASSETS) return env.ASSETS.fetch(request);   // the standard's schemas, which /openapi.json refers to
  // TRUST 3:28 AM CT (trust/checks/indexable.py): the status and the discovery file are public; the rest is not
  if (path === '/robots.txt') return new Response(ROBOTS_TXT, { headers: { 'Content-Type': 'text/plain' } });
  const isCallsPost = path === '/v1/calls' && request.method === 'POST';
  let m0;
  try {
    // OWNER_router_12 item 2: a passkey session names one of its own memberships (X-Person-Member: mb_..., or ?member=mb_...), never by name
    if (path.startsWith('/v1/member-session/')) {
      const { personOf } = await import('./accounts.js'); const person = await personOf(env, request, false);
      const want = String(request.headers.get('x-person-member') || url.searchParams.get('member') || '');
      if (!/^mb_[a-z0-9]{4,80}$/.test(want)) throw fixable('missing_field', 'X-Person-Member', 'Name the membership with the header X-Person-Member: mb_... (or ?member=mb_...); GET /v1/account lists yours.', null, {}, 400);
      if (!(await env.DB.prepare('SELECT 1 AS x FROM person_members WHERE member_id = ? AND person_id = ?').bind(want, person).first())) throw notFixable(404, 'not_found', 'No membership of yours has that id.');
      const { SESSION_MEMBERS } = await import('./seats.js'); const now = Date.now();
      for (const [k, v] of SESSION_MEMBERS) if (v.until < now) SESSION_MEMBERS.delete(k);
      const eph = rid('mt_', 32); SESSION_MEMBERS.set(eph, { member: want, until: now + 60000 });
      path = '/v1/members/' + eph + '/' + path.slice('/v1/member-session/'.length);
    }
    // OWNER_router_14: a ds_ session (the Desk, signed in by the phone) acts for its one membership; never for the desk routes themselves
    if (path.startsWith('/v1/member-desk/')) {
      const rest = path.slice('/v1/member-desk/'.length);
      // WEB 4:00: the Desk may read its list of signed-in computers; signing computers in or out of others stays with the phone
      if (rest.startsWith('desk/') && !(rest === 'desk/sessions' && request.method === 'GET')) throw notFixable(403, 'forbidden', 'A computer signed in by the phone cannot sign in other computers or sign them out: use the phone.');
      const { deskMember } = await import('./desk.js'); const tokD = /^Bearer\s+(ds_[a-z0-9]{20,80})$/i.exec((request.headers.get('authorization') || '').trim())[1];
      const mid = await deskMember(env, tokD);
      const { SESSION_MEMBERS } = await import('./seats.js'); const now = Date.now();
      for (const [k, v] of SESSION_MEMBERS) if (v.until < now) SESSION_MEMBERS.delete(k);
      const eph = rid('mt_', 32); SESSION_MEMBERS.set(eph, { member: mid, until: now + 60000 });
      path = '/v1/members/' + eph + '/' + rest;
    }
    const want = request.headers.get(VH);
    if (want && want.trim() !== VERSION) throw fixable('version_unsupported', VH, `Version ${want} is not served here; this server serves ${VERSION}.`, VERSION, { versions: [VERSION] });
    // WEB 4:07 PM CT: a person's own list routes (the Desk refreshes them) settle in the background, not before they answer
    const bgSettle = /^\/v1\/members\/mt_[a-z0-9]+\/(tasks|settings|connections|blocks|desk|device_key|offers)(\/|$)|^\/v1\/(account|admin)(\/|$)/.test(path) && ctx && typeof ctx.waitUntil === 'function';   // offers settles its own panel first
    // WEB 12:36 PM CT 16 Nov: the person's people routes (people, sent, mutes, limits) settle in the background too
    const bgPeople = /^\/v1\/members\/mt_[a-z0-9]+\/(people|sent|mutes|limits)(\/|$)/.test(path) && ctx && typeof ctx.waitUntil === 'function';
    // TRUST 3:04 / REACH 3:06 PM CT 16 Nov: the public counts and the service's description need nothing settled first: they reply, then settle
    const bgRead = /^\/v1\/(proof|status)$|^\/\.well-known\/|^\/openapi\.(json|yaml)$|^\/$/.test(path) && ctx && typeof ctx.waitUntil === 'function';
    if (!path.startsWith('/internal/')) {
      if (bgSettle || bgPeople || bgRead) ctx.waitUntil(settle(env, request, { limit: 8 }).catch((e) => console.log('settle', String(e && e.stack || e))));
      else { try { await settle(env, request, { limit: 8 }); } catch (e) { console.log('settle', String(e && e.stack || e)); } }
    }

    if (path === '/mcp') { const a = await authKey(env, request);   // a person's own AI (conn_ key) sees only its two tools (REACH 2:09)
      if (a.key && a.key.connection) { const { personMcp } = await import('./mcp_person.js'); return withHeaders(await personMcp(env, request, a.key)); }
      return withHeaders(await handleMcp(env, request, a, await ipHashOf(env, request))); }
    if (path === '/' && request.method === 'GET') return json({ service: `${BUILD.names.network} API (preview)`, discovery: apiBase(request) + '/.well-known/' + BUILD.wire_prefix, mcp: apiBase(request) + '/mcp', openapi: apiBase(request) + '/openapi.json', test_keys: 'POST ' + apiBase(request) + '/v1/keys', status: CANON_STATUS.plain || 'preview: simulated people for everyone; all money is test money' });
    if (path === '/.well-known/' + BUILD.wire_prefix || path === '/.well-known/' + BUILD.wire_prefix + '.json') return json(discovery(request), 200, { 'Cache-Control': 'public, max-age=300', 'X-Robots-Tag': 'all' });
    if (path === '/.well-known/jwks.json') return json(jwks(), 200, { 'Cache-Control': 'public, max-age=300' });
    if (path === '/openapi.yaml' || path === '/openapi.json') { const { openapi } = await import('./openapi.js'); return json(openapi(request), 200, { 'Cache-Control': 'public, max-age=300' }); }
    if (path === '/v1/status' && request.method === 'GET') {
      const l = await env.DB.prepare('SELECT COALESCE(SUM(cents),0) AS s, COUNT(*) AS n FROM ledger').first();
      const b = await env.DB.prepare('SELECT COALESCE(SUM(cents),0) AS s FROM balances').first();
      const held = await env.DB.prepare('SELECT COUNT(*) AS n FROM held_calls WHERE released_at IS NULL').first();
      const lt = await env.DB.prepare('SELECT v FROM meta WHERE k = \'last_tick\'').first();
      const oe = await env.DB.prepare('SELECT MIN(received_at) AS t FROM events').first();
      const oi = await env.DB.prepare('SELECT MIN(created_at) AS t FROM idempotency').first();
      const { modelReadStatus } = await import('./model_cap.js');
      const model_read = await modelReadStatus(env).catch(() => ({ on: !!env.ANTHROPIC_API_KEY, error: 'the day\'s spend could not be read' }));
      const media = await env.DB.prepare(`SELECT
          SUM(CASE WHEN h.released_at IS NULL THEN 1 ELSE 0 END) AS waiting,
          SUM(CASE WHEN c.created_at >= ? THEN 1 ELSE 0 END) AS day
        FROM held_calls h JOIN calls c ON c.id = h.call_id JOIN principals p ON p.id = c.principal_id
        WHERE c.screening_json LIKE '%"uninspected_material"%' AND COALESCE(p.owner, 'outside') = 'outside'`).bind(nowMs() - 86400000).first().catch(() => null);   // outsiders only, as /v1/proof counts (TRUST 12:35)
      return json({ ok: l.s === 0 && b.s === 0, ledger_sum_cents: l.s, ledger_lines: l.n, balances_sum_cents: b.s, held_calls_waiting: held.n, build: BUILD.stamp,
        last_tick: lt ? lt.v : null, oldest_event_at: oe && oe.t ? iso(oe.t) : null, oldest_idempotency_at: oi && oi.t ? iso(oi.t) : null,
        screening: SCREENING.MISSING ? 'missing (every call from a live key is held)' : 'installed ' + (SCREENING.SCREENING_VERSION || SCREENING.VERSION || ''), time: iso(nowMs()),
        model_read,
        outsider_media_review: await (async () => { const { reviewStatus } = await import('./tasks.js'); return reviewStatus(env); })(),
        connected_ais: await (async () => { const { ownCounts } = await import('./own.js'); return ownCounts(env); })(),   // counts only
        apple_push: await (async () => { const { apnsConfigured } = await import('./apns.js'); const d = await env.DB.prepare('SELECT COUNT(*) AS n FROM members WHERE apns_token IS NOT NULL AND left_at IS NULL').first().catch(() => null);
          return { configured: apnsConfigured(env), devices: (d && d.n) || 0, note: apnsConfigured(env) ? 'offers alert the app' : 'not switched on: needs APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID, APNS_TOPIC; device tokens are kept, nothing is sent' }; })(),
        held_for_uninspected_material: { waiting_now: (media && media.waiting) || 0, held_last_24_hours: (media && media.day) || 0,
          note: 'Calls held because nothing has heard or seen their outside material; the model reads text only, so these wait for a person.' },
        ...(teamCheck(env, request) ? { team_check: true } : {}) }, 200, { 'X-Robots-Tag': 'all' });   // public: indexable (TRUST 3:28)
    }

    // ---- security reports (ops/SECURITY.md) and the waiting list (switched off during the build: stores nothing)
    if (path === '/.well-known/security.txt') {
      const site = siteBase(request);
      const exp = new Date(Date.now() + 365 * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      return new Response(`Contact: ${site}/security\nExpires: ${exp}\nPreferred-Languages: en\nCanonical: ${apiBase(request)}/.well-known/security.txt\nPolicy: ${site}/security\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600', ...CORS } });
    }
    if (path === '/v1/security-reports' && request.method === 'POST') {
      const b = await body(request);
      for (const k of Object.keys(b)) if (!['what', 'how_to_reproduce', 'reply_to'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not a field here; send what, how_to_reproduce and, if you like, reply_to.`, null);
      if (typeof b.what !== 'string' || b.what.trim().length < 5 || b.what.length > 5000) throw fixable(b.what === undefined ? 'missing_field' : 'invalid_field', 'what', 'what is 5 to 5,000 characters: what the hole is.', 'A seat link still opens after the call closed.');
      const ipHash = await ipHashOf(env, request); const now = nowMs();
      const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM security_reports WHERE ip_hash = ? AND created_at > ?').bind(ipHash, now - 3600000).first();
      if (n.n >= 10) throw notFixable(429, 'rate_limited', 'At most 10 reports an hour from one address.', { retry_after_seconds: 600 });
      await env.DB.prepare('INSERT INTO security_reports (id, what, how_to_reproduce, reply_to, ip_hash, created_at) VALUES (?,?,?,?,?,?)')
        .bind(rid('sr_'), b.what.slice(0, 5000), typeof b.how_to_reproduce === 'string' ? b.how_to_reproduce.slice(0, 10000) : null, typeof b.reply_to === 'string' ? b.reply_to.slice(0, 200) : null, ipHash, now).run();
      return json({ received: true, answer_within_hours: 72, note: 'It reaches our own database and nowhere else. Thank you.' }, 201);
    }
    if ((path === '/v1/waitlist' || path === '/v1/waitlist/remove') && request.method === 'POST') {
      await body(request);
      return json({ ok: false, open: false, stored: false, message: 'The waiting list is not open yet, so nothing was stored. It opens when real calls open to people outside the team.' });
    }

    // ---- over-cap approvals (A3): the human's side of approve_url (the site's /approve page calls these)
    if ((m0 = /^\/v1\/approvals\/(ap_[A-Za-z0-9_\-.%]+)$/.exec(path))) {
      const { getApproval, approve } = await import('./approvals.js');
      const t = decodeURIComponent(m0[1]);
      if (request.method === 'GET') return json((await getApproval(env, t)).out);
      if (request.method === 'POST') return json(await approve(env, t, await body(request)));
    }

    // ---- a principal's own account with an outside pool (N2's second mode, pools/accounts.js): connect, read, disconnect
    if ((m0 = /^\/v1\/pools\/([a-z0-9_-]{2,40})\/account$/.exec(path))) {
      const acc = await import('./pools/accounts.js');
      const k = needKey(await authKey(env, request));
      if (request.method === 'GET') return json(await acc.getAccount(env, k, m0[1]));
      if (request.method === 'PUT' || request.method === 'POST') return json(await acc.connectAccount(env, k, m0[1], await body(request)));
      if (request.method === 'DELETE') return json(await acc.disconnectAccount(env, k, m0[1]));
      throw notFixable(404, 'not_found', `No route ${request.method} ${shownPath(path)}: it takes GET, PUT or DELETE.`);
    }

    // ---- a person an outside pool sent (ADAPTERS.md step 3): the runner's /p/<token> page posts the pool's identifiers
    if ((m0 = /^\/v1\/arrivals\/(ar_[A-Za-z0-9_\-.]+)$/.exec(path)) && request.method === 'POST') {
      const { arrive } = await import('./calls.js');
      return json(await arrive(env, request, m0[1], await body(request)), 201);
    }

    // ---- the proof (CEO.md's two numbers; REACH's /proof page): counts only, and our own real calls with their outcome line
    if (path === '/v1/proof' && request.method === 'GET') {
      const { proof } = await import('./proof.js');
      return json(await proof(env), 200, { 'Cache-Control': 'public, max-age=60' });
    }

    // ---- a quote by its id, for the human who approves (D35): lines and total only, no key needed
    if ((m0 = /^\/v1\/quotes\/(q_[a-z0-9]{8,40})$/.exec(path)) && request.method === 'GET') {
      const q = await env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(m0[1]).first();
      if (!q) throw notFixable(404, 'not_found', 'No such quote (quotes are kept for one day).');
      return json({ quote_id: q.id, lines: JSON.parse(q.lines_json), total_usd: fmt(q.total_cents), expires_at: iso(q.expires_at), test_money: true });
    }

    // ---- top-ups (B6) against the stand-in processor
    if (path === '/v1/topups' && request.method === 'POST') { const k = needKey(await authKey(env, request)); const { startTopup } = await import('./topups.js'); return json(await startTopup(env, request, k, await body(request)), 201); }
    if (path === '/v1/topups/webhook' && request.method === 'POST') {
      const raw = await request.text();
      if (raw.length > 100000) throw notFixable(413, 'content_too_large', 'Too large.');
      const { applyEvent } = await import('./topups.js');
      const r = await applyEvent(env, raw, request.headers.get('stripe-signature'), { nowSec: Math.floor(Date.now() / 1000), secret: env.WEBHOOK_SECRET });
      return json(r.body, r.status);
    }

    // ---- keys and balance
    if (path === '/v1/keys' && request.method === 'POST') {
      const b = await body(request);
      for (const k of Object.keys(b)) if (!['class', 'caps', 'test_run'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not a field here; send {"class":"test"} and, if you like, caps and test_run.`, null);
      // OWNER_router_16 (the CEO, 5:25 PM CT 15 Nov): a harness or probe marks its own keys as tests; /v1/proof never counts them
      if (b.test_run !== undefined && (typeof b.test_run !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._:\/-]{0,59}$/.test(b.test_run)))
        throw fixable('invalid_field', 'test_run', 'test_run is a label for your test harness or probe (1 to 60 letters, digits, spaces and . _ : / -); /v1/proof never counts a key that carries one.', 'reach-harness-set-a');
      if (b.class !== undefined && b.class !== 'test') throw fixable('invalid_field', 'class', 'Only test keys are made here. Keys that reach real people come from the operator.', 'test');
      let caps = { call: 5000, day: 20000 };
      if (b.caps !== undefined) {
        if (!b.caps || typeof b.caps !== 'object' || Array.isArray(b.caps)) throw fixable('invalid_field', 'caps', 'caps is {"per_call_usd": "5.00", "per_day_usd": "20.00"}.', { per_call_usd: '5.00', per_day_usd: '20.00' });
        for (const k of Object.keys(b.caps)) if (!['per_call_usd', 'per_day_usd'].includes(k)) throw fixable('unknown_field', 'caps.' + k, `"${k}" is not a cap; caps are per_call_usd and per_day_usd.`, null);
        const pc = b.caps.per_call_usd === undefined ? 5000 : parseUsd(b.caps.per_call_usd), pd = b.caps.per_day_usd === undefined ? 20000 : parseUsd(b.caps.per_day_usd);
        if (Number.isNaN(pc) || pc > 5000) throw fixable('invalid_field', 'caps.per_call_usd', 'per_call_usd is dollars, at most 50.00 for a test key.', '5.00');
        if (Number.isNaN(pd) || pd > 20000) throw fixable('invalid_field', 'caps.per_day_usd', 'per_day_usd is dollars, at most 200.00 for a test key.', '20.00');
        caps = { call: pc, day: pd };
      }
      return json(await mintTestKey(env, request, caps, b.test_run), 201);
    }
    if ((path === '/v1/balance' || path === '/v1/me') && request.method === 'GET') {
      const k = needKey(await authKey(env, request));
      const held = await env.DB.prepare('SELECT COALESCE(SUM(b.cents),0) AS c FROM balances b JOIN calls c ON b.account = \'hold:\' || c.id WHERE c.principal_id = ?').bind(k.principal_id).first();
      const today = await env.DB.prepare('SELECT COALESCE(SUM(hold_cents),0) AS c FROM calls WHERE key_id = ? AND created_at > ?').bind(k.id, nowMs() - 86400000).first();
      return json({ balance_usd: fmt(await balance(env.DB, 'avail:' + k.principal_id)), held_usd: fmt(held.c), caps: { per_call_usd: fmt(k.cap_call_cents), per_day_usd: fmt(k.cap_day_cents) },
        spent_today_usd: fmt(today.c), test_money: true, class: k.class === 'real' ? 'live' : 'test', principal_id: k.principal_id });
    }

    // ---- calls
    if (path === '/v1/quotes' && request.method === 'POST') { const a = await authKey(env, request); if (a.error) throw a.error; return json(await quote(env, request, a.key, await body(request))); }
    if (isCallsPost) {
      const k = keyOrAnon(await authKey(env, request));
      const b = await body(request);
      const hk = request.headers.get('idempotency-key'); if (hk && b.idempotency_key === undefined) b.idempotency_key = hk;
      const r = await openCall(env, request, k, b, await ipHashOf(env, request));
      return json(r.body, r.status);
    }
    let m;
    if ((m = /^\/v1\/calls\/([A-Za-z0-9_-]{1,64})(\/[a-z]+)?$/.exec(path))) {
      const op = m[2] || '';
      const a = await authKey(env, request);
      const k = keyOrAnon(a);
      if (op === '' && request.method === 'GET') { await getCallFor(env, k, m[1]); await settle(env, request, { callId: m[1] }); return json(await callObject(env, request, await getCallFor(env, k, m[1]))); }
      if (op === '/responses' && request.method === 'GET') {
        const ws = url.searchParams.get('wait_seconds');   // above the limit is held to the limit (RES-1)
        if (ws !== null && !/^\d+$/.test(ws)) throw fixable('invalid_field', 'wait_seconds', `wait_seconds is a whole number from 0 to ${LIMITS.max_wait_seconds}.`, 20);
        return json(await results(env, request, k, m[1], { after: url.searchParams.get('after') || 0, wait: ws || 0, detail: url.searchParams.get('detail') || 'summary', person: url.searchParams.get('person') }));
      }
      if (op === '/cancel' && request.method === 'POST') return json(await cancelCall(env, request, k, m[1]));
      if (op === '/outcome' && request.method === 'POST') return json(await outcome(env, request, k, m[1], await body(request), await ipHashOf(env, request), SCREENING.screenOutcome));
      if (op === '/seats' && request.method === 'GET') return json(await callSeatsForTeam(env, request, needKey(a), m[1]));
    }

    // ---- material
    if (path === '/v1/media/samples' && request.method === 'GET') {
      const rows = (await env.DB.prepare('SELECT id, kind, content_type, bytes, seconds, source FROM media WHERE sample = 1 ORDER BY id').all()).results || [];
      const callKind = { audio: 'listen', video: 'watch', image: 'view', page: 'view', build: 'play' };   // the call kind the material is for (Q12)
      return json({ samples: rows.map(r => ({ media_id: r.id, kind: callKind[r.kind] || 'view', seconds: r.seconds, title: r.source, licence: 'made by the operator; free to use in any call', bytes: r.bytes, content_type: r.content_type })) });
    }
    if (path === '/v1/media' && request.method === 'POST') {
      const a = await authKey(env, request); if (a.error) throw a.error;
      const pr = a.key ? await env.DB.prepare('SELECT team FROM principals WHERE id = ?').bind(a.key.principal_id).first() : null;
      const { upload } = await import('./media.js');
      return json(await upload(env, request, a.key, pr), 201);
    }
    if ((m = /^\/v1\/media\/(m_[A-Za-z0-9_-]+)$/.exec(path)) && request.method === 'GET') {
      const md = await env.DB.prepare('SELECT sample FROM media WHERE id = ?').bind(m[1]).first();
      if (!md || !md.sample) throw notFixable(404, 'not_found', 'Only samples are served here.');
      return withHeaders(await serveMedia(env, request, m[1]));
    }

    // ---- seats (the runner, server to server; runner/SEAT_CONTRACT.md)
    if ((m = /^\/v1\/seats\/(st_[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)(\/[a-z]+)?(\/m_[A-Za-z0-9_-]+)?$/.exec(path))) {
      const tok = m[1], op = m[2] || '';
      if (op === '' && request.method === 'GET') return json(await getSeat(env, request, tok));
      if (op === '/take' && request.method === 'POST') { const r = await takeSeat(env, request, tok); return json(r.body, r.status); }
      if (op === '/events' && request.method === 'POST') return json(await postEvents(env, request, tok, await body(request)));
      if (op === '/response' && request.method === 'POST') return json(await postResponse(env, request, tok, await body(request)));
      if (op === '/stop' && request.method === 'POST') return json(await postStop(env, request, tok, await body(request)));
      if (op === '/media' && request.method === 'GET') return withHeaders(await seatMedia(env, request, tok, m[3] ? m[3].slice(1) : null));
      if (op === '/receipt' && request.method === 'GET') return json(await seatReceipt(env, request, tok));
    }
    // OWNER_router_10 B: one admin, two scopes (owner, operator), one interface; every action logged
    if (path.startsWith('/v1/admin/')) { const { handleAdmin } = await import('./admin.js'); return json(await handleAdmin(env, request, path, ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) ? await body(request) : null)); }
    // OWNER_router_10 A: accounts by passkey (SPEC 8.1 names)
    if (path.startsWith('/v1/account')) {
      const AC = await import('./accounts.js');
      if (path === '/v1/account/start' && request.method === 'POST') return json(await AC.startPage(env, request, await body(request), await ipHashOf(env, request), teamCheck(env, request)), 201);   // the CEO 2:21: a stranger's own page
      if (path === '/v1/account/passkey/options' && request.method === 'POST') return json(await AC.passkeyOptions(env, request));
      if (path === '/v1/account/passkey' && request.method === 'POST') return json(await AC.addPasskey(env, request, await body(request)), 201);
      if (path === '/v1/account/login/options' && request.method === 'POST') return json(await AC.loginOptions(env));
      if (path === '/v1/account/login' && request.method === 'POST') return json(await AC.login(env, request, await body(request)));
      if (path === '/v1/account/logout' && request.method === 'POST') return json(await AC.logout(env, request));
      if (path === '/v1/account/memberships' && request.method === 'POST') return json(await AC.linkMembership(env, request, await body(request)));   // TRUST 1:29
      if (path === '/v1/account' && request.method === 'GET') return json(await AC.account(env, request));
    }
    // OWNER_router_4 item 1 (SPEC 8.1 blocks): one tap blocks the asker behind a call or task; listed by its display name; removable
    if ((m0 = /^\/v1\/members\/(mt_[a-z0-9]+)\/blocks(?:\/(bk_[a-z0-9]+))?$/.exec(path))) {
      const { memberByToken } = await import('./seats.js'); const BL = await import('./blocks.js'); const mm = await memberByToken(env, m0[1]);
      if (!m0[2] && request.method === 'POST') return json(await BL.addBlock(env, mm, await body(request)), 201);
      if (!m0[2] && request.method === 'GET') return json(await BL.listBlocks(env, mm));
      if (m0[2] && request.method === 'DELETE') return json(await BL.removeBlock(env, mm, m0[2]));
    }
    // OWNER_router_4 item 2 (SPEC 8.1: device_key, signatures): the device's key, attested by Apple, and the answers it signs
    if ((m0 = /^\/v1\/members\/(mt_[a-z0-9]+)\/(device_key\/nonce|device_key|signatures|answers\/(call_[a-z0-9]+)\/signature)$/.exec(path))) {
      const { memberByToken } = await import('./seats.js'); const D = await import('./devicekeys.js'); const mm = await memberByToken(env, m0[1]);
      if (m0[2] === 'device_key/nonce' && request.method === 'GET') return json(await D.deviceNonce(env, mm));
      if (m0[2] === 'device_key' && request.method === 'POST') return json(await D.enrolDevice(env, mm, await body(request)), 201);
      if (m0[2] === 'signatures' && request.method === 'POST') return json(await D.signAnswer(env, mm, await body(request)));
      if (m0[3] && request.method === 'POST') return json(await D.signAnswer(env, mm, { ...(await body(request)), call_id: m0[3] }));
    }
    // OWNER_router_14: the Desk signs in with the phone (a QR, a number to match, one approval); a ds_ session acts for that one membership
    if (path === '/v1/desk/sign_out' && request.method === 'POST') { const tk = /^Bearer\s+(ds_[a-z0-9]{20,80})$/i.exec((request.headers.get('authorization') || '').trim()); if (!tk) throw fixable('unauthorized', 'Authorization', 'Send the Desk\'s own session ("Bearer ds_...").', 'Bearer ds_...', {}, 401); const { signOutDesk } = await import('./desk.js'); return json(await signOutDesk(env, tk[1])); }
    if (path === '/v1/desk/sign_in' && request.method === 'POST') { const { startDesk } = await import('./desk.js'); return json(await startDesk(env, request, await ipHashOf(env, request)), 201); }
    if ((m0 = /^\/v1\/desk\/sign_in\/(dp[a-z0-9]{20,64})$/.exec(path)) && request.method === 'GET') { const { pollDesk } = await import('./desk.js'); const r = await pollDesk(env, m0[1]); return json(r.body, r.status); }
    // a private relay in its own file, kept out of the public tree (TRUST 5:53 PM CT 15 Nov): an optional import, so the public tree
    // builds without it. It is asked only about paths with a six-letter segment starting with l, returns null
    // for any that are not its own, and those paths are 404 when it is absent; no other request goes near it
    if (/\/l[a-z]{5}(?:\/|$)/.test(path)) { let PR = null; try { const v = ''; PR = await import(`./lr${v}.js`); } catch { }
      if (PR && typeof PR.handle === 'function') { const r = await PR.handle(env, request, path, url, async (e, t) => (await import('./seats.js')).memberByToken(e, t)); if (r) return r; } }
    if ((m0 = /^\/v1\/members\/(mt_[a-z0-9]+)\/desk\/(preview|approve|sessions)(?:\/(dk_[a-z0-9]+))?$/.exec(path))) {
      const { memberByToken } = await import('./seats.js'); const D = await import('./desk.js'); const mm = await memberByToken(env, m0[1]);
      if (m0[2] === 'preview' && request.method === 'POST' && !m0[3]) return json(await D.previewDesk(env, mm, await body(request)));
      if (m0[2] === 'approve' && request.method === 'POST' && !m0[3]) return json(await D.approveDesk(env, mm, await body(request)));
      if (m0[2] === 'sessions' && request.method === 'GET' && !m0[3]) return json(await D.listDesks(env, mm));
      if (m0[2] === 'sessions' && request.method === 'DELETE' && m0[3]) return json(await D.revokeDesk(env, mm, m0[3]));
    }
    if (path === '/v1/member-credential-missing') throw fixable('unauthorized', 'Authorization', 'Send the member credential you got on joining as "Authorization: Bearer mt_...".', 'Bearer mt_...', {}, 401);
    // OWNER_all_10 B: the person's own AIs: connect one (its key and link shown once), list, change (name, icon, quiet, blocked), revoke
    if ((m = /^\/v1\/members\/(mt_[a-z0-9]+)\/connections(?:\/(cn_[a-z0-9]+))?$/.exec(path))) {
      const C = await import('./connections.js'); const { memberByToken } = await import('./seats.js');
      if (!m[2] && request.method === 'POST') return json(await C.createConnection(env, request, memberByToken, m[1], await body(request)), 201);
      if (!m[2] && request.method === 'GET') return json(await C.listConnections(env, request, memberByToken, m[1]));
      if (m[2] && request.method === 'PATCH') return json(await C.changeConnection(env, request, memberByToken, m[1], m[2], await body(request)));
      if (m[2] && request.method === 'DELETE') return json(await C.revokeConnection(env, request, memberByToken, m[1], m[2]));
    }
    if ((m = /^\/v1\/members\/(mt_[a-z0-9]+)\/connections\/(cn_[a-z0-9]+)\/(quiet|block)$/.exec(path)) && request.method === 'POST') {   // the app's shape
      const C = await import('./connections.js'); const { memberByToken } = await import('./seats.js');
      return json(await C.quietOrBlock(env, request, memberByToken, m[1], m[2], m[3], await body(request)));
    }
    if ((m = /^\/v1\/members\/(mt_[a-z0-9]+)\/connections\/(cn_[a-z0-9]+)\/icon$/.exec(path)) && request.method === 'GET') {   // the AI's picture, our copy
      const C = await import('./connections.js'); const { memberByToken } = await import('./seats.js');
      return withHeaders(await C.serveIcon(env, memberByToken, m[1], m[2]));
    }
    if ((m = /^\/v1\/members\/(mt_[a-z0-9]+)\/connections\/(cn_[a-z0-9]+)\/secret$/.exec(path)) && request.method === 'POST') {   // a new webhook secret, shown once
      const C = await import('./connections.js'); const { memberByToken } = await import('./seats.js');
      return json(await C.rotateSecret(env, request, memberByToken, m[1], m[2]));
    }
    // the connection's link, for an AI that can only call an address: POST asks, GET <link>/<task_id> reads the reply
    if ((m = /^\/hook\/(conn_[a-z0-9]{20,64})(?:\/(tk_[a-z0-9]+))?$/.exec(path))) {
      const bad = (msg) => ({ key: null, error: fixable('unauthorized', 'link', msg, null, {}, 401) });
      const a = await keyFromRaw(env, m[1], m[2] ? '/v1/tasks/' + m[2] : '/v1/tasks', bad); if (a.error) throw a.error;
      const T = await import('./tasks.js');
      if (!m[2] && request.method === 'POST') { const r = await T.createTask(env, request, a.key, await body(request)); return json(r.body, r.status); }
      if (m[2] && request.method === 'GET') return json(await T.getTask(env, request, a.key, m[2]));
    }
    if ((m = /^\/v1\/members\/(mt_[a-z0-9]+)\/offers\/(s_[a-z0-9]+)\/open_failed$/.exec(path)) && request.method === 'POST') {   // OWNER_router_22
      const { memberByToken } = await import('./seats.js'); const { openFailed } = await import('./calls.js'); return json(await openFailed(env, await memberByToken(env, m[1]), m[2], await body(request)), 201);
    }
    // OWNER_router_25: "Show the ask in my alerts" (alert_words) is taken beside the person's other settings and kept with their ask
    // settings; GET /v1/member/tasks/{id}/alert gives who is asking, and the ask's first line only while it is on
    if ((m = /^\/v1\/members\/(mt_[a-z0-9]+)\/settings$/.exec(path)) && ['GET', 'POST', 'PATCH'].includes(request.method)) {
      const S = await import('./seats.js'); const PP = await import('./people.js'); const mm = await S.memberByToken(env, m[1]);
      const allowed = await PP.alertWordsAllowed(env, mm);   // until TRUST's attack holds and it is opened: test members only, and nobody else sees it
      if (request.method === 'GET') { const r = await S.memberSettingsRead(env, request, m[1]); if (allowed) r.settings = { ...(r.settings || {}), alert_words: await PP.alertWordsOf(env, mm.id) }; return json(r); }
      const b = await body(request); let aw;
      if (b && Object.prototype.hasOwnProperty.call(b, 'alert_words')) {
        if (typeof b.alert_words !== 'boolean') throw fixable('invalid_field', 'alert_words', 'alert_words is true or false: show an ask\'s first line in your own alerts (off unless you turn it on).', false);
        if (!allowed) throw fixable('invalid_field', 'alert_words', 'This setting is not open yet.', null, {}, 403);
        aw = b.alert_words; delete b.alert_words;
      }
      const r = Object.keys(b || {}).length || aw === undefined ? await S.memberSettings(env, request, m[1], b) : await S.memberSettingsRead(env, request, m[1]);
      if (aw !== undefined) await PP.setAlertWords(env, mm, aw);
      if (allowed) r.settings = { ...(r.settings || {}), alert_words: aw !== undefined ? aw : await PP.alertWordsOf(env, mm.id) };
      return json(r);
    }
    if (path === '/internal/alert_words_open' && request.method === 'POST') {   // OWNER_router_25: open the setting to everyone once TRUST's attack holds
      const atok = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      if (!env.ADMIN_TOKEN || atok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
      const b = await body(request); if (!['all', 'test'].includes(b && b.to)) throw fixable('invalid_field', 'to', 'to is "all" (everyone may turn it on) or "test" (test members only).', 'all');
      await env.DB.prepare("INSERT INTO meta (k, v) VALUES ('alert_words_open', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(b.to).run();
      return json({ alert_words_open: b.to });
    }
    if ((m = /^\/v1\/members\/(mt_[a-z0-9]+)\/tasks\/(tk_[a-z0-9]+)\/alert$/.exec(path)) && request.method === 'GET') {
      const { memberByToken } = await import('./seats.js'); const mm = await memberByToken(env, m[1]);
      return json(await (await import('./people.js')).taskAlertLine(env, mm, m[2]));
    }
    if ((m = /^\/v1\/members\/(mt_[a-z0-9]+)\/leave$/.exec(path)) && request.method === 'POST') {   // TRUST 12:31 PM CT 16 Nov: the one-tap leave deletes everything kept for them
      const { memberByToken, memberLeave } = await import('./seats.js'); const mm = await memberByToken(env, m[1]);
      const r = await memberLeave(env, request, m[1], await body(request));
      const extra = await (await import('./people.js')).leaveCleanup(env, mm.id);   // the timer runs it again before the row goes
      if (r && r.deleted && typeof r.deleted === 'object') Object.assign(r.deleted, extra);
      return json(r);
    }
    if ((m = /^\/v1\/members\/(mt_[a-z0-9]+)\/(offers|receipts|on|leave|settings|push|device|apns|feedback)$/.exec(path))) {
      if (m[2] === 'feedback' && request.method === 'POST') { const { memberFeedback } = await import('./seats.js'); return json(await memberFeedback(env, request, m[1], await body(request)), 201); }
      if (m[2] === 'push' && request.method === 'POST') return json(await memberPush(env, request, m[1], await body(request)));
      if ((m[2] === 'device' || m[2] === 'apns') && request.method === 'POST') { const { memberDevice } = await import('./seats.js'); return json(await memberDevice(env, request, m[1], await body(request))); }
      if (m[2] === 'leave' && request.method === 'POST') return json(await memberLeave(env, request, m[1], await body(request)));
      if (m[2] === 'settings' && (request.method === 'POST' || request.method === 'PATCH')) return json(await memberSettings(env, request, m[1], await body(request)));
      if (m[2] === 'settings' && request.method === 'GET') { const { memberSettingsRead } = await import('./seats.js'); return json(await memberSettingsRead(env, request, m[1])); }
      if (m[2] === 'offers' && request.method === 'GET') return json(await memberOffers(env, request, m[1]));
      if (m[2] === 'receipts' && request.method === 'GET') return json(await memberReceipts(env, request, m[1]));
      if (m[2] === 'on' && request.method === 'POST') return json(await setOn(env, request, m[1], await body(request)));
    }
    // OWNER_router_18: the join page says the owner's line before anyone joins; a join that showed it is told already
    if ((m = /^\/v1\/join\/(jc_[a-z0-9]+)$/.exec(path)) && request.method === 'POST') { const jb = await body(request); const jr = await joinPanel(env, request, m[1], jb); try { await (await import('./people.js')).afterJoin(env, jr, jb); } catch { } return json(jr, 201); }
    if ((m = /^\/v1\/join\/(jc_[a-z0-9]+)$/.exec(path)) && request.method === 'GET') return json(await (await import('./people.js')).withOwnerLine(env, m[1], await joinInfo(env, request, m[1])));
    // OWNER_router_18: a person sends asks to their own people, reads what came back, passes an ask on; mutes; the one-time notice; the daily cap
    if ((m0 = /^\/v1\/members\/(mt_[a-z0-9]+)\/(people|people\/asks|people\/links|people\/notice|sent|sent\/read|mutes|limits|mutes\/(mu_[a-z0-9]+)|sent\/(tk_[a-z0-9]+)\/notes|tasks\/(tk_[a-z0-9]+)\/pass)$/.exec(path))) {
      const { memberByToken } = await import('./seats.js'); const PP = await import('./people.js'); const mm = await memberByToken(env, m0[1]); const r = m0[2], M = request.method;
      if (r === 'people' && M === 'GET') return json(await PP.listPeople(env, request, mm));
      if (r === 'people/asks' && M === 'POST') { const x = await PP.sendAsks(env, request, mm, await body(request)); return json(x.body, x.status); }
      if (r === 'people/links' && M === 'POST') return json(await PP.newLink(env, request, mm, await body(request)), 201);
      if (r === 'people/notice' && M === 'POST') return json(await PP.readNotice(env, mm));
      if (r === 'sent' && M === 'GET') return json(await PP.listSent(env, request, mm));
      if (r === 'sent/read' && M === 'POST') return json(await PP.markRead(env, mm, await body(request)));
      if (r === 'mutes' && M === 'GET') return json(await PP.listMutes(env, mm));
      if (r === 'mutes' && M === 'POST') return json(await PP.addMute(env, mm, await body(request)), 201);
      if (r === 'limits' && (M === 'GET' || M === 'POST')) return json(await PP.limits(env, mm, M === 'POST' ? await body(request) : null));
      if (m0[3] && M === 'DELETE') return json(await PP.removeMute(env, mm, m0[3]));
      if (m0[4] && M === 'POST') return json(await PP.sentNote(env, request, mm, m0[4], await body(request)), 201);
      if (m0[5] && M === 'POST') return json(await PP.passTask(env, request, mm, m0[5], await body(request)));
    }

    // ---- panels
    if (path === '/v1/panels' && request.method === 'GET') { const k = needKey(await authKey(env, request)); return json(await listPanels(env, request, k)); }
    if (path === '/v1/panels' && request.method === 'POST') { const k = needKey(await authKey(env, request)); return json(await createPanel(env, request, k, await body(request)), 201); }
    // TASKS (OWNER_all_7, the CEO 8:28 AM CT 15 Nov): our programs ask one named person on the key's own panel
    if ((m0 = /^\/v1\/tasks\/(tk_[a-z0-9]+)\/notes$/.exec(path)) && request.method === 'POST') { const k = needKey(await authKey(env, request)); const { askerNote } = await import('./tasks.js'); return json(await askerNote(env, request, k, m0[1], await body(request))); }   // operations 1:00
    // OWNER_router_9: the asker's brand (its own principal's), a brand picture, and the picture served from our store
    if (path === '/v1/brand' && (request.method === 'PUT' || request.method === 'GET')) { const k = needKey(await authKey(env, request)); const C = await import('./cards.js');
      return json(request.method === 'PUT' ? await C.putBrand(env, k, await body(request)) : await C.getBrand(env, k)); }
    if (path === '/v1/brand/verify' && request.method === 'POST') { const k = needKey(await authKey(env, request)); const { verifyBrand } = await import('./cards.js'); return json(await verifyBrand(env, k)); }   // OWNER_router_10 C
    if (path === '/v1/brand/mark' && request.method === 'POST') { const k = needKey(await authKey(env, request)); const { uploadMark } = await import('./cards.js'); return json(await uploadMark(env, request, k), 201); }
    if ((m0 = /^\/v1\/brand_media\/(m_[a-z0-9_]+)$/.exec(path)) && request.method === 'GET') { const { serveMark } = await import('./cards.js'); return withHeaders(await serveMark(env, m0[1])); }
    if (path === '/v1/tasks/media' && request.method === 'POST') { const k = needKey(await authKey(env, request)); const { uploadOwn } = await import('./own.js'); return json(await uploadOwn(env, request, k), 201); }   // OWNER_all_10 C
    if (path === '/v1/tasks' && request.method === 'POST') { const k = needKey(await authKey(env, request)); const { createTask } = await import('./tasks.js'); const r = await createTask(env, request, k, await body(request)); return json(r.body, r.status); }
    if (path === '/v1/tasks' && request.method === 'GET') { const k = needKey(await authKey(env, request)); const { listTasks } = await import('./tasks.js'); return json(await listTasks(env, request, k, url.searchParams.get('state') || 'open')); }
    if ((m0 = /^\/v1\/tasks\/(tk_[a-z0-9]+)\/withdraw$/.exec(path)) && request.method === 'POST') { const k = needKey(await authKey(env, request)); const { withdrawTask } = await import('./tasks.js'); return json(await withdrawTask(env, request, k, m0[1], await body(request))); }
    if ((m0 = /^\/v1\/tasks\/(tk_[a-z0-9]+)$/.exec(path)) && request.method === 'GET') { const k = needKey(await authKey(env, request)); const { getTask } = await import('./tasks.js'); return json(await getTask(env, request, k, m0[1])); }
    if ((m0 = /^\/v1\/members\/(mt_[a-z0-9]+)\/tasks$/.exec(path)) && request.method === 'GET') { const { memberTaskList } = await import('./seats.js'); return json(await memberTaskList(env, request, m0[1], url.searchParams.get('q'))); }
    if ((m0 = /^\/v1\/members\/(mt_[a-z0-9]+)\/tasks\/(tk_[a-z0-9]+)\/media$/.exec(path)) && request.method === 'GET') { const { memberTaskMedia } = await import('./seats.js'); return withHeaders(await memberTaskMedia(env, request, m0[1], m0[2])); }
    if ((m0 = /^\/v1\/members\/(mt_[a-z0-9]+)\/tasks\/(tk_[a-z0-9]+)$/.exec(path)) && request.method === 'POST') { const { memberTaskReply } = await import('./seats.js'); const r = await memberTaskReply(env, request, m0[1], m0[2], await body(request)); if (r && r._delivery) { const id = r._delivery; delete r._delivery; const { deliver } = await import('./own.js'); if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(deliver(env, id).catch(() => {})); } return json(r); }
    if ((m0 = /^\/v1\/panels\/(p_[a-z0-9]+)\/join_links$/.exec(path)) && request.method === 'POST') { const k = needKey(await authKey(env, request)); const { newPersonLink } = await import('./panels.js'); return json(await newPersonLink(env, request, k, m0[1], await body(request)), 201); }
    if ((m0 = /^\/v1\/panels\/(p_[a-z0-9]+)\/join_link$/.exec(path)) && request.method === 'DELETE') { const k = needKey(await authKey(env, request)); const { revokeJoinLink } = await import('./panels.js'); return json(await revokeJoinLink(env, request, k, m0[1])); }
    if ((m0 = /^\/v1\/panels\/(p_[a-z0-9]+)$/.exec(path)) && request.method === 'POST') { const k = needKey(await authKey(env, request)); const { setAskerName } = await import('./panels.js'); return json(await setAskerName(env, request, k, m0[1], await body(request))); }
    if ((m0 = /^\/v1\/panels\/(p_[a-z0-9]+)\/join_link$/.exec(path)) && request.method === 'POST') { const k = needKey(await authKey(env, request)); const { newJoinLink } = await import('./panels.js'); return json(await newJoinLink(env, request, k, m0[1]), 201); }
    if ((m = /^\/v1\/panels\/([A-Za-z0-9_-]{1,64})$/.exec(path)) && request.method === 'GET') { const k = needKey(await authKey(env, request)); return json(await getPanel(env, request, k, m[1])); }

    // ---- receipts
    if ((m = /^\/v1\/receipts\/([A-Za-z0-9_-]{1,64})$/.exec(path)) && request.method === 'GET') {
      const r = await env.DB.prepare('SELECT r.*, c.principal_id FROM receipts r JOIN calls c ON c.id = r.call_id WHERE r.id = ?').bind(m[1]).first();
      const a = await authKey(env, request);
      const k = a.key || ANON;
      if (!r || (r.principal_id !== k.principal_id && r.principal_id !== 'pr_anonymous')) throw notFixable(404, 'not_found', 'No such receipt for this key.');
      return json({ receipt: JSON.parse(r.body_json), jws: r.signature, verify: apiBase(request) + '/v1/receipts/verify' });
    }
    if (path === '/v1/receipts/verify' && request.method === 'POST') {
      let b = {}; try { b = await body(request); } catch { b = {}; }
      const v = await verifyJws(typeof b.jws === 'string' ? b.jws : '');   // anything that is not a receipt is simply not valid (RCPT-3)   // RCPT-4: whether this server holds the receipt
      const rid_ = v.receipt && v.receipt.receipt_id;
      const held = rid_ ? await env.DB.prepare('SELECT signature FROM receipts WHERE id = ?').bind(String(rid_)).first() : null;
      v.on_record = !!(held && v.valid); if (held && v.valid) v.latest_revision = held.signature === b.jws;   // a tampered receipt is never on record
      return json(v);
    }

    // ---- internal (the supervisor's timer, the team's scripts)
    if (path.startsWith('/internal/')) {
      const tok = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      if (path === '/internal/tick' && request.method === 'POST') {
        if (!env.TICK_TOKEN || tok !== env.TICK_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        // bounded: about 7 seconds of settling, then the deletions if time is left; it always answers 200 with what it did
        const t0 = Date.now(); const total = { seats: 0, calls: 0 }; let deleted = null; const problems = [];
        try { while (Date.now() - t0 < 4000) { const r = await settle(env, request, { limit: 20 }); total.seats += r.seats; total.calls += r.calls; if (r.seats < 20) break; } } catch (e) { problems.push('settle: ' + String(e.message || e).slice(0, 120)); }
        if (Date.now() - t0 < 4500) { try { const { retention } = await import('./retention.js'); deleted = await retention(env, nowMs(), t0 + 7000); } catch (e) { problems.push('retention: ' + String(e.message || e).slice(0, 120)); } }
        try { const { keepQuietBotQuiet } = await import('./rings.js'); await keepQuietBotQuiet(env, nowMs()); } catch (e) { problems.push('quiet bot: ' + String(e.message || e).slice(0, 120)); }
        try { const { deliverDue } = await import('./own.js'); total.answers_delivered = await deliverDue(env, t0 + 9000); } catch (e) { problems.push('webhooks: ' + String(e.message || e).slice(0, 120)); }   // OWNER_all_10 C
        try { await env.DB.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (\'last_tick\', ?)').bind(iso(nowMs())).run(); } catch { }
        return json({ settled: total, deleted, problems, ms: Date.now() - t0, at: iso(nowMs()) });
      }
      if (path === '/internal/selftest' && request.method === 'POST') {
        if (!env.TICK_TOKEN || tok !== env.TICK_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        return json(await selftest(env, request));
      }
      if (path === '/internal/members' && request.method === 'POST') {   // a throwaway headless member on a team panel (the baseline's leave check)
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const b = await body(request);
        const p = await env.DB.prepare('SELECT * FROM panels WHERE (id = ? OR name = ?) AND kind IN (\'team-test\',\'attack\')').bind(String(b.panel || ''), String(b.panel || '')).first();
        if (!p) throw notFixable(404, 'not_found', 'Only team and attack panels.');
        const token = rid('mt_', 32); const id = rid('mb_'); const now = nowMs();
        await env.DB.prepare('INSERT INTO members (id, panel_id, token_hash, alias, is_real, tz, quiet_start, quiet_end, on_state, adult_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
          .bind(id, p.id, await sha256hex(token), b.rules === 'real' ? 'team-test real-rules bot' : 'throwaway bot', 0, 'America/Chicago', 0, 0, b.on ? 'on' : 'off', now, now).run();
        return json({ member_id: id, member_token: token }, 201);
      }
      if (path.startsWith('/internal/calls/') && request.method === 'GET') {   // the operator's read of one call (bin/call_record)
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const id = path.slice('/internal/calls/'.length);
        const call = await env.DB.prepare('SELECT * FROM calls WHERE id = ?').bind(id).first();
        if (!call) throw notFixable(404, 'not_found', 'No such call.');
        const { buildResult: br } = await import('./calls.js');
        const rings = ((await env.DB.prepare('SELECT s.n, e.received_at, e.body_json FROM events e JOIN seats s ON s.id = e.seat_id WHERE s.call_id = ? AND e.body_json LIKE \'{"ring"%\' ORDER BY e.id').bind(id).all()).results || [])
          .map(r => ({ seat: r.n, at: iso(r.received_at), ...JSON.parse(r.body_json).ring }));
        return json({ call: await callObject(env, request, call), results: await br(env, request, call, { detail: 'full' }), rings });
      }
      if (path === '/internal/card_fixtures' && request.method === 'POST') {   // trust's nine processor events, in a scope of their own
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const { runFixtures } = await import('./topups.js'); const FX = (await import('./card_fixtures.json')).default;
        return json(await runFixtures(env, FX));
      }
      if (path === '/internal/keys/demo' && request.method === 'POST') {   // the front page's own mint (server side, its own token): a test key that may also use pool self
        if (!env.DEMO_MINT_TOKEN || tok !== env.DEMO_MINT_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        // per visitor: the site passes the visitor's address (x-forwarded-for), trusted only with this token; kept as a hash
        const visitor = (request.headers.get('x-hc-visitor-ip') || '').trim() || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.headers.get('cf-connecting-ip') || 'local';
        const ipHash = (await sha256hex('ip:' + visitor + ':' + (env.SEAT_SECRET || ''))).slice(0, 24);
        const since = nowMs() - 3600000;
        const mine = await env.DB.prepare('SELECT COUNT(*) AS n FROM principals WHERE created_ip_hash = ? AND created_at > ?').bind(ipHash, since).first();
        if (mine.n >= 60 && !teamCheck(env, request)) throw notFixable(429, 'rate_limited', 'At most 60 demo keys an hour from one visitor. Keep the one you have.', { retry_after_seconds: 600 });
        const all = await env.DB.prepare('SELECT COUNT(*) AS n FROM keys WHERE label = ? AND created_at > ?').bind('front-page demo', since).first();
        if (all.n >= 3000) throw notFixable(429, 'rate_limited', 'The front page has made many demo keys this hour; try again in ten minutes.', { retry_after_seconds: 600 });
        const r = await adminKey(env, request, { class: 'test', label: 'front-page demo', principal_name: 'a visitor trying the front page', cap_call_cents: 0, cap_day_cents: 0, ip_hash: ipHash, owner: 'visitor' });
        return json({ key: r.key, class: 'test', pools: ['simulated', 'self'], reaches: ['simulated', 'self'], test_money: true }, 201);
      }
      if (path === '/internal/screened' && request.method === 'GET') {   // trust 6:36 PM CT: what screening and the model read did in 24 hours (bin/screened, terminal only)
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const { screenedList } = await import('./calls.js'); return json(await screenedList(env));
      }
      if ((m = /^\/internal\/members\/(mb_[a-z0-9]+)\/bot$/.exec(path)) && request.method === 'POST') {   // TRUST 4:13: mark a team headless member, so a closed gate may still ring it
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const r = await env.DB.prepare('UPDATE members SET is_real = 0, alias = \'team bot\' WHERE id = ? AND left_at IS NULL').bind(m[1]).run();
        return json({ member_id: m[1], marked_bot: r.meta.changes === 1 });
      }
      if ((m = /^\/internal\/principals\/(pr_[a-z0-9]+)\/close_panels$/.exec(path)) && request.method === 'POST') {   // TRUST 5:55: OWN_PANELS.md rule 10, on demand (B7)
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const b = await body(request);
        const why = typeof b.reason === 'string' && b.reason.trim() ? b.reason.trim().slice(0, 120) : 'closed it';
        const { closePrincipalPanels } = await import('./panels.js');
        const still = await closePrincipalPanels(env, m[1], why);
        return json({ principal_id: m[1], closed: true, members_still_to_remove: still, reason: why });
      }
      if ((m = /^\/internal\/members\/(mb_[a-z0-9]+)\/name$/.exec(path)) && request.method === 'POST') {   // OWNER_all_7: the operator names a member, so a task reaches one person
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const b = await body(request); const n = b.name === null ? null : String(b.name || '').trim().toLowerCase();
        if (n !== null && !/^[a-z][a-z0-9 _-]{0,39}$/.test(n)) throw fixable('invalid_field', 'name', 'name is 1 to 40 letters, digits, spaces, hyphens (null clears it).', 'sam');
        const r = await env.DB.prepare('UPDATE members SET person_name = ? WHERE id = ? AND left_at IS NULL').bind(n, m[1]).run();
        if (n) { const { inheritSounds } = await import('./seats.js'); await inheritSounds(env, m[1]); }   // OWNER_router_6
        return json({ member_id: m[1], person_name: n, named: r.meta.changes === 1 });
      }
      if ((m = /^\/internal\/tasks\/(tk_[a-z0-9]+)\/withdraw$/.exec(path)) && request.method === 'POST') {   // OWNER_router_3: the operator withdraws any task
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const { withdrawTask } = await import('./tasks.js'); return json(await withdrawTask(env, request, null, m[1], await body(request), true));
      }
      if (path === '/internal/task_refusals' && request.method === 'GET') {   // OWNER_router_1 item 4
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const { taskRefusals } = await import('./tasks.js'); return json(await taskRefusals(env, url.searchParams.get('hours')));
      }
      if ((m = /^\/internal\/calls\/(call_[a-z0-9]+)\/refuse_held$/.exec(path)) && request.method === 'POST') {   // TRUST 12:35: our own probes' held calls, refused so the list starts at zero
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const b = await body(request); const why = typeof b.why === 'string' && b.why.trim() ? b.why.trim().slice(0, 200) : null;
        if (!why) throw fixable('missing_field', 'why', 'why is one line.', 'our own probe, closed');
        const c = await env.DB.prepare('SELECT c.id FROM calls c JOIN principals p ON p.id = c.principal_id WHERE c.id = ? AND c.status = \'held\' AND p.owner = \'team\'').bind(m[1]).first();
        if (!c) throw notFixable(404, 'not_found', 'No held call of the team\'s own has that id (an outsider\'s held call is read and decided, never refused from here).');
        const { refuseHeld } = await import('./calls.js'); return json(await refuseHeld(env, c.id, 'Refused by the operator: ' + why));
      }
      if ((m = /^\/internal\/connections\/(cn_[a-z0-9]+)$/.exec(path)) && request.method === 'PATCH') {   // operations 12:25: urgencies on a lab connection
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const { adminChangeConnection } = await import('./connections.js'); return json(await adminChangeConnection(env, request, m[1], await body(request)));
      }
      if ((m = /^\/internal\/members\/(mb_[a-z0-9]+)\/connections$/.exec(path)) && request.method === 'POST') {   // OWNER_all_10 B: the operator connects a lab program to a person
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const { adminConnection } = await import('./connections.js'); return json(await adminConnection(env, request, m[1], await body(request)), 201);
      }
      if ((m = /^\/internal\/members\/(mb_[a-z0-9]+)\/push_preview$/.exec(path)) && request.method === 'GET') {   // OWNER_router_6 item 4: what this member's phone would get
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const mm = await env.DB.prepare('SELECT id, sounds FROM members WHERE id = ?').bind(m[1]).first();
        if (!mm) throw notFixable(404, 'not_found', 'No such member.');
        const { offerAlert, taskAlert } = await import('./apns.js'); const sound = mm.sounds !== 0, at = nowMs() + 60000;
        return json({ member_id: mm.id, sounds: sound, apns_offer: offerAlert({ askerName: 'Preview', privatePanel: true, kind: 'listen', minutes: 2, payCents: 0, callId: 'call_preview', seatId: 'st_preview', expiresAt: at, sound }),
          apns_task: taskAlert({ program: 'preview', taskId: 'tk_preview', sound }), web: { silent: !sound } });
      }
      if ((m = /^\/internal\/principals\/(pr_[a-z0-9]+)\/owner$/.exec(path)) && request.method === 'POST') {   // OWNER_router_5: the operator corrects who owns a principal, with why
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const b = await body(request);
        if (!['team', 'outside'].includes(b.owner)) throw fixable('invalid_field', 'owner', 'owner is "team" or "outside".', 'team');
        const why = typeof b.why === 'string' && b.why.trim() ? b.why.trim().slice(0, 200) : null;
        if (!why) throw fixable('missing_field', 'why', 'why is one line: how this principal came to be.', 'the app builder\'s simulator check from the laptop');
        const r = await env.DB.prepare('UPDATE principals SET owner = ?, owner_note = ? WHERE id = ?').bind(b.owner, why, m[1]).run();
        return json({ principal_id: m[1], owner: b.owner, why, changed: r.meta.changes === 1 });
      }
      if ((m = /^\/internal\/seats\/(s_[a-z0-9]+)\/reoffer$/.exec(path)) && request.method === 'POST') {   // OWNER_router_22: operations re-offers a seat
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const { reofferSeat } = await import('./calls.js'); return json(await reofferSeat(env, m[1], await body(request)));
      }
      if (path === '/internal/team_server' && request.method === 'POST') {   // OWNER_router_21: enrol THIS caller's address as one of our servers
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        if (request.headers.get('cf-worker')) throw notFixable(403, 'forbidden', 'A Cloudflare function\'s address is shared with everyone\'s: call this from the server itself.');
        const b = await body(request); for (const k of Object.keys(b)) if (k !== 'name') throw fixable('unknown_field', k, 'Send {"name": "<the server>"}.', null);
        const nm = typeof b.name === 'string' ? b.name.trim() : '';
        if (!/^[a-z][a-z0-9-]{1,39}$/.test(nm)) throw fixable('invalid_field', 'name', 'name is the server\'s short name: 2 to 40 lowercase letters, digits, hyphens.', 'build-box');
        const h = await ipHashOf(env, request);
        await env.DB.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind('team_server_ip:' + h, nm + '; enrolled from the server at ' + nowMs()).run();
        return json({ name: nm, enrolled: true, address_hash_prefix: h.slice(0, 10), note: 'Keys, pages and asks made from this address are ours, with or without the team header; the address itself is never stored.' }, 201);
      }
      if (path === '/internal/team_servers' && request.method === 'GET') {   // OWNER_router_21: the list (names and hash prefixes only)
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const rows = (await env.DB.prepare('SELECT k, v FROM meta WHERE k LIKE \'team_server_ip:%\' ORDER BY k').all()).results || [];
        return json({ servers: rows.map(r => ({ name: String(r.v || '').split(';')[0], address_hash_prefix: r.k.slice(15, 25), how: String(r.v || '').split(';').slice(1).join(';').trim() })) });
      }
      if (path === '/internal/panels/people' && request.method === 'POST') {   // OWNER_router_23: a panel for one person's people, with their links moved to it
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const { makePeoplePanel } = await import('./people.js'); return json(await makePeoplePanel(env, await body(request)), 201);
      }
      if ((m = /^\/internal\/panels\/(p_[a-z0-9]+)\/owner$/.exec(path)) && request.method === 'POST') {   // OWNER_router_18: the operator makes a panel a person's own
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const { setOwner } = await import('./people.js'); return json(await setOwner(env, m[1], await body(request)));
      }
      if (path === '/internal/proof_audit' && request.method === 'GET') {   // OWNER_router_5 items 4 and 5: what /v1/proof counts as outside, and why
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const { proofAudit } = await import('./proof.js'); return json(await proofAudit(env));
      }
      if (path === '/internal/private_terms' && (request.method === 'GET' || request.method === 'POST')) {   // OWNER_all_9 item 5: counts only, never the words
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const P = await import('./private_terms.js');
        if (request.method === 'GET') return json({ counts: P.counts(await P.privateLists(env, true)) });
        const r = await P.addPrivateTerm(env, await body(request));
        if (r.error) throw fixable('invalid_field', r.error[0], r.error[1], null);
        return json(r);
      }
      if (path === '/internal/review_config' && request.method === 'POST') {   // OWNER_all_8 item 3: who checks outsiders' audio and video (a panel of the operator's and a person's name on it)
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const b = await body(request);
        if (b.panel_id !== undefined) {
          const pn = await env.DB.prepare('SELECT p.id FROM panels p JOIN principals pr ON pr.id = p.principal_id WHERE p.id = ? AND p.kind = \'private\' AND pr.class = \'real\'').bind(String(b.panel_id)).first();
          if (!pn) throw fixable('invalid_field', 'panel_id', 'A private panel the operator made.', null);
          const to = String(b.to || '').trim().toLowerCase();
          if (!/^[a-z][a-z0-9 _-]{0,39}$/.test(to)) throw fixable('invalid_field', 'to', 'to is the reviewer\'s name on that panel.', 'sam');
          await env.DB.batch([env.DB.prepare('INSERT INTO meta (k, v) VALUES (\'review_panel\', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(pn.id), env.DB.prepare('INSERT INTO meta (k, v) VALUES (\'review_to\', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(to)]);
        }
        const { reviewConfig } = await import('./tasks.js'); return json({ review: await reviewConfig(env) });
      }
      if (path === '/internal/strangers_state' && request.method === 'POST') {   // the operator moves the state every asker's replies carry
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const b = await body(request);
        const { STRANGERS_LINES, strangersState } = await import('./strangers.js');
        if (b.state !== undefined) {
          if (!STRANGERS_LINES[b.state]) throw fixable('invalid_field', 'state', 'state is not_open, ours or open.', 'not_open');
          await env.DB.prepare('INSERT INTO meta (k, v) VALUES (\'strangers_state\', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(b.state).run();
        }
        const st = await strangersState(env); return json({ state: st, line: STRANGERS_LINES[st] });
      }
      if (path === '/internal/strangers' && request.method === 'GET') {   // the owner's list of asks for real strangers (bin/strangers)
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const { strangersList } = await import('./strangers.js'); return json(await strangersList(env));
      }
      if (path === '/internal/own_panels_ring' && request.method === 'POST') {   // OWNER_all_6 gate: {open: true|false}; bin/own_panels_ring checks PERSON_READY first
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const b = await body(request);
        if (typeof b.open === 'boolean') await env.DB.prepare('INSERT INTO meta (k, v) VALUES (\'own_panels_ring\', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(b.open ? 'open' : 'closed').run();
        const { ownPanelsRingOpen } = await import('./panels.js');
        return json({ own_panels_ring: (await ownPanelsRingOpen(env)) ? 'open' : 'closed' });
      }
      if (path === '/internal/apns_probe' && request.method === 'POST') {   // the owner 11:13 PM CT: can a Worker reach Apple's push service (HTTP/2 only)?
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const { probeApns } = await import('./apns.js'); return json(await probeApns());
      }
      if (path === '/internal/screen' && request.method === 'POST') {   // trust 6:49 PM CT: one ask screened as an outsider's real call, with the read; opens nothing
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const b = await body(request);
        if (typeof b.ask !== 'string' || !b.ask.trim()) throw fixable(b.ask === undefined ? 'missing_field' : 'invalid_field', 'ask', 'ask is the words of the call, a string.', 'Which of these two logos is clearer? Say why.');
        const { measureScreen } = await import('./measure.js'); return json(await measureScreen(env, b));
      }
      if (path === '/internal/held' && request.method === 'GET') {   // the owner's list of held calls (bin/release_held --list)
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const { heldList } = await import('./calls.js'); return json(await heldList(env));
      }
      if ((m = /^\/internal\/held\/(call_[a-z0-9]+)\/release$/.exec(path)) && request.method === 'POST') {   // bin/release_held, for ids in owner/RELEASE_HELD.md
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const { releaseHeld } = await import('./calls.js'); return json(await releaseHeld(env, request, m[1]));
      }
      if (path === '/internal/test_money' && request.method === 'POST') {   // test money for a test principal (the team's key runs low)
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const b = await body(request);
        const p = await env.DB.prepare('SELECT id, class FROM principals WHERE id = ?').bind(String(b.principal_id || '')).first();
        const cents = Math.round(parseFloat(b.usd) * 100);
        if (!p || p.class !== 'test') throw fixable('invalid_field', 'principal_id', 'A test principal only.', null);
        if (!(cents > 0 && cents <= 100000)) throw fixable('invalid_field', 'usd', '0.01 to 1000.00.', '100.00');
        await env.DB.batch(posting(env.DB, 'grant:' + p.id + ':' + rid('', 10), [{ ...acct.testGrant(), cents: -cents }, { ...acct.avail(p.id), cents }], null, 'more test money for a test principal', nowMs()));
        return json({ principal_id: p.id, granted_usd: fmt(cents), balance_usd: fmt(await balance(env.DB, 'avail:' + p.id)), test_money: true });
      }
      if (path === '/internal/keys/suspend' && request.method === 'POST') {
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        const b = await body(request);
        // {"all_live": true}: the deadline's rule (TEAM.md s4): ringing real people stops unless the handover names an operator
        const r = b.all_live === true
          ? await env.DB.prepare('UPDATE keys SET suspended_at = ? WHERE class = \'real\' AND suspended_at IS NULL').bind(nowMs()).run()
          : await env.DB.prepare('UPDATE keys SET suspended_at = ? WHERE (id = ? OR label = ?) AND suspended_at IS NULL').bind(nowMs(), String(b.key_id || ''), String(b.label || '\u0000')).run();
        const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM keys WHERE class = \'real\' AND suspended_at IS NULL').first();
        return json({ suspended: r.meta.changes, live_keys_still_active: left.n });
      }
      if (path === '/internal/keys' && request.method === 'POST') {
        if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) throw notFixable(401, 'unauthorized', 'No.');
        return json(await adminKey(env, request, await body(request)), 201);
      }
    }
    throw notFixable(404, 'not_found', `No route ${request.method} ${shownPath(path)}. Start at ${apiBase(request)}/.well-known/${BUILD.wire_prefix} or the MCP server at ${apiBase(request)}/mcp.`, { route: 'unknown' });   // a client never mistakes this for a member who left
  } catch (e) {
    let st, b;
    if (e instanceof CallError) { st = e.status; b = { ...e.body }; }
    else { console.log('unhandled', String(e && e.stack || e)); st = 500; b = { code: 'internal', status: 500, fixable: false, message: 'The server failed. Nothing was charged twice: if this was opening a call, send it again with the same idempotency_key to get the call if it opened.', rule: null }; }
    if (isCallsPost) { b.charged_usd = '0.00'; b.anyone_asked = false; }
    return json(b, st);
  }
}
