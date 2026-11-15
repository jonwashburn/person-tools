// Calls (spec sections 9, 11, 12, 13, 15): quote, open, settle (the lazy timer), results, cancel, outcome.
import { rid, nowMs, iso, fmt, sha256hex, canonical, hmacHex, sleep, siteBase, apiBase, teamCheck } from './util.js';
import { normalizeCall, callOut, fixable, notFixable, CallError, SAMPLE_ID, PAY_FLOOR_CENTS_PER_HOUR, STOP_MINIMUM_CENTS, defaultPayCents } from './spec.js';
import { PRICE, quoteLines, linesOut, acct, posting, balance, isDuplicatePosting, isFloorBreach, WHAT_YOU_PAY } from './money.js';
import { simOutcome, delayMs, entryFor } from './sim.js';
import { runScreening, gate } from './screen_gate.js';
import { signJws, callRef } from './receipts.js';
import { evidenceFor } from './evidence.js';
import { getAdapter } from './pools/index.js';
import { transport as prolificTransport } from './pools/prolific.js';
import { accountRow, tokenFor, principalSwitchOn } from './pools/accounts.js';
import { holdAdvice } from './hold_advice.js';
import { modelParts } from './model_cap.js';
import { screenTerms } from './private_terms.js';   // OWNER_all_9 item 5: the operator's lists, read at run time
import { matchDemo, DEMOS, SELF_LINK_MINUTES } from './demos.js';
import { BUILD } from './build_info.js';
import { signSeatToken, signArrivalToken, readArrivalToken, runnerBase } from './util.js';

export const TEST_MONEY = true;
export const ANON = { id: 'k_anonymous', principal_id: 'pr_anonymous', class: 'test', team: 0, anon: true, cap_call_cents: 5000, cap_day_cents: 1e12 };
const REVIEW_HOURS = 24;

function availOf(key) { return key.anon ? { account: 'avail:pr_anonymous', floor0: 0 } : acct.avail(key.principal_id); }

// ---------- pools and material ----------

// account: 'ours' (this service's account with the pool) or 'principal' (the principal's own, N2's second mode); a live
// request on the principal's account opens its sealed token at that moment and nowhere else.
// ad: the adapter, which carries its own transport (ADAPTERS.md); Prolific's is the fallback for an adapter without one.
function adapterCtx(env, request, call, mode, principalName, account = 'ours', ad = null) {
  const name = ad ? ad.name : 'prolific';
  const make = (ad && ad.transport) || prolificTransport;
  const tr = async (method, path, body) => {
    const token = account === 'principal' && mode === 'live' ? await tokenFor(env, call.principal_id, name) : null;
    return make(env, mode, token)(method, path, body);
  };
  return { mode, account, fetch: tr, now: () => nowMs(), log: (l) => console.log(l), principalName: principalName || 'a team test caller',
    arrivalUrl: runnerBase(request) + '/p/' + (call && call.arrival_token || '') };
}

async function resolvePool(env, key, spec) {
  if (spec.pool_kind === 'simulated') return { simulated: true, panel: null, members: 0 };
  if (spec.pool_kind === 'adapter') {
    const ad = getAdapter(spec.pool); let mode = ad.mode(env);
    // N2's second mode: the principal's own account with the pool, when it connected one (pools/accounts.js)
    const own = key.anon || !ad.principal_accounts ? null : await accountRow(env, key.principal_id, ad.name);
    if (own) {
      if (own.recorded) mode = 'recorded';
      else if (!principalSwitchOn(env, ad.name)) throw fixable('unsupported_feature', 'pool', `Your own ${ad.name} account is connected, but calls on a principal's own account open only once ${ad.name} confirms in writing that a router may hold a principal's key. To use this service's account instead, disconnect yours: DELETE /v1/pools/${ad.name}/account.`, null);
      else mode = 'live';
      spec.pool_account = 'principal';
    }
    // recorded mode is the team's own check of the adapter path; live mode needs the owner's grant and a live key
    if (mode === 'recorded' && !key.team) throw fixable('unknown_pool', 'pool', `The pool "${spec.pool}" is not open yet. Pools this key may use: "simulated".`, 'simulated', { pools: ['simulated'] });
    if (mode === 'live' && key.class !== 'real') throw fixable('forbidden_for_key_class', 'pool', `The pool "${spec.pool}" reaches real people and needs a live key.`, 'simulated', {}, 403);
    ad.check(spec);
    const floor = Math.ceil(Math.max(PAY_FLOOR_CENTS_PER_HOUR, ad.floor_cents_per_hour) * spec.minutes / 60);
    if (spec.pay_cents < floor) throw fixable('below_pay_floor', 'pay_per_person_usd', `Send pay_per_person_usd "${fmt(floor)}" or more: on an outside panel each person is paid at least ${fmt(floor)} for ${spec.minutes} minutes (${fmt(Math.max(PAY_FLOOR_CENTS_PER_HOUR, ad.floor_cents_per_hour))} an hour).`, fmt(floor));
    spec.pool_fee_rate = ad.fee_rate;
    return { simulated: mode === 'recorded', adapter: ad, mode, panel: { id: 'p_pool_' + ad.name, kind: 'team-test', name: 'pool: ' + ad.name }, members: 0, members_on_now: 0 };
  }
  if (spec.pool_kind === 'self') {
    if (key.anon || key.class !== 'test') throw fixable('unauthorized', 'Authorization', 'Pool "self" is the front page\'s own demo; use pool "simulated".', 'Bearer test_...', {}, 401);
    if (key.label !== 'front-page demo') throw fixable('forbidden_for_key_class', 'pool', 'Pool "self" is only the front page\'s own demo. A test key reaches simulated people and its own panels: use pool "simulated".', 'simulated', {}, 403);
    const demo = matchDemo(spec);
    if (!demo) throw fixable('invalid_field', 'ask', `Pool "self" takes only a fixed demo ask, word for word (ask, kind, content and answer_fields): ${Object.keys(DEMOS).join(', ')}.`, DEMOS['listen-felt'].ask, { demos: DEMOS });
    if (spec.people !== 1) throw fixable('invalid_field', 'people', 'Pool "self" has one seat: yours.', 1);
    if (spec.pay_cents > 0) throw fixable('invalid_field', 'pay_per_person_usd', 'Pool "self" is unpaid.', '0.00');
    if (spec.deadline_minutes > SELF_LINK_MINUTES) spec.deadline_minutes = SELF_LINK_MINUTES;
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM calls WHERE key_id = ? AND panel_id = \'p_self\' AND created_at > ?').bind(key.id, nowMs() - 86400000).first();
    if (n.n >= 20) throw notFixable(429, 'rate_limited', 'At most 20 calls a day on pool "self" from one key.', { retry_after_seconds: 3600 });
    return { simulated: false, self: true, demo, panel: { id: 'p_self', kind: 'team-test', name: 'self' }, members: 1, members_on_now: 1 };
  }
  // AUTH-5: no key on any pool but simulated is unauthorized; D33: a test key (not the team's) on a panel is forbidden before any lookup
  if (key.anon) throw fixable('unauthorized', 'Authorization', 'Without a key only the simulated pool can be called. Make a free test key with POST /v1/keys, or use pool "simulated".', 'Bearer test_...', {}, 401);
  if (key.class === 'test' && !key.team) {
    const own = spec.panel_ref ? await env.DB.prepare('SELECT id FROM panels WHERE (id = ? OR name = ?) AND principal_id = ? AND kind = \'private\'').bind(spec.panel_ref, spec.panel_ref, key.principal_id).first() : null;
    if (!own) throw fixable('forbidden_for_key_class', 'pool', 'A test key reaches the simulated pool and the panels it made itself (POST /v1/panels makes one). Use pool "simulated".', 'simulated', {}, 403);
  }
  const ref = spec.panel_ref;
  const panel = await env.DB.prepare('SELECT * FROM panels WHERE (id = ? OR name = ?) AND (principal_id = ? OR (? = 1 AND kind IN (\'team-test\',\'attack\')))').bind(ref, ref, key.principal_id, key.team ? 1 : 0).first();
  if (!panel && key.class === 'test') {
    const exists = await env.DB.prepare('SELECT kind FROM panels WHERE id = ? OR name = ?').bind(ref, ref).first();
    if (exists) throw fixable('forbidden_for_key_class', 'pool', 'A test key reaches the simulated pool only (and the team\'s own test panels with a team key). Use pool "simulated".', 'simulated', {}, 403);
  }
  if (panel && panel.kind === 'private' && key.class !== 'real' && panel.principal_id !== key.principal_id) throw fixable('forbidden_for_key_class', 'pool', 'A private panel of real people needs a live key. Use pool "simulated".', 'simulated', {}, 403);
  // OWN_PANELS.md rule 10: a closed panel answers the quote as the call does (TRUST 6:09: an agent is never told yes first)
  if (panel && String(panel.join_code_hash || '').startsWith('gone:')) throw fixable('unknown_pool', 'pool', `The panel "${ref}" is closed: nobody can be asked on it. Make a new panel (POST /v1/panels), or use pool "simulated".`, 'simulated');
  if (!panel) throw fixable('unknown_pool', 'pool', `No panel "${ref}" belongs to this key's principal. The pools this key may use: "simulated"${key.class === 'real' ? ' and your panels (ask_people_panel lists them)' : ''}.`, 'simulated');
  if (spec.pay_cents > 0) throw fixable('unsupported_feature', 'pay_per_person_usd', 'During the preview a call to a panel is unpaid: paying people you invited through this service opens later. Set pay_per_person_usd to "0.00".', '0.00');
  const ms = (await env.DB.prepare('SELECT * FROM members WHERE panel_id = ? AND left_at IS NULL').bind(panel.id).all()).results || [];
  const { isOn } = await import('./rings.js');
  return { simulated: false, panel, members: ms.length, members_on_now: ms.filter(m => isOn(m, nowMs())).length };
}

// ownPanel: the call goes to the key's own private panel (the CEO, OWNER_all_8 item 2a, 9:26 AM CT 15 Nov): its material is
// copied in like the operator's, and read and held exactly as before (pages and builds by the model; audio and video by a person)
async function resolveContent(env, key, spec, simulated, copy = false, ownPanel = false) {
  const items = [];
  for (let i = 0; i < spec.content.length; i++) {
    const c = spec.content[i]; const path = spec.kind === 'compare' ? `content[${i}]` : 'content';
    if (c.media_id) {
      const m = await env.DB.prepare('SELECT * FROM media WHERE id = ?').bind(c.media_id).first();
      if (!m || (!m.sample && m.principal_id !== key.principal_id))
        throw fixable('content_unavailable', path, `No material ${c.media_id} for this key. Any key may use the sample ${SAMPLE_ID}; GET /v1/media/samples lists the samples.`, SAMPLE_ID);
      items.push({ media_id: m.id, kind: m.kind, seconds: m.seconds, bytes: m.bytes, content_type: m.content_type });
    } else if (c.url) {
      if (!simulated) {
        // copied into our storage before anyone is offered a seat (CALL-5); only for the operator's own principals for now
        const pr = key.anon ? null : await env.DB.prepare('SELECT team FROM principals WHERE id = ?').bind(key.principal_id).first();
        const { mayUpload, copyIn } = await import('./media.js');
        if (!mayUpload(key, pr) && !ownPanel) throw fixable('content_unavailable', path, 'This server copies addresses in only for its own principals for now: a person only ever opens material from our own storage. Use a media id (the sample m_sample_melody30 works with any key).', SAMPLE_ID);
        if (!copy) { items.push({ url: c.url, fetched: false, will_copy: true }); continue; }
        const m = await copyIn(env, key.principal_id, c.url);
        items.push({ media_id: m.media_id, kind: m.kind, seconds: m.seconds || null, bytes: m.bytes, content_type: m.content_type, copied_from: new URL(c.url).host });
        continue;
      }
      items.push({ url: c.url, fetched: false });
    } else items.push({ text: c.text });
  }
  return items;
}

// The material read on calls (the CEO, OWNER_all_5, 3:01 AM CT 15 Nov): screening is given the call's material as text so
// a model can read pages (and, later, game builds) instead of holding them for a person. OFF until TRUST writes "red team
// passed" (pages) and, separately, for builds. Every page and build is served by the runner sandboxed with no network
// ("sandbox allow-scripts; default-src 'none'; connect-src 'none'", runner/lib/seat.js), so sandbox_ok is true; an item that
// is not text, is over 100 KB, or was not copied into our storage goes in without text, and screening keeps the call held.
export const MATERIAL_ON_CALLS = { pages: true, builds: true };   // builds: TRUST's red team passed 3:41 AM; the CEO OWNER_all_8 2a (9:26): pages and builds read by the model
const ownPanelOf = (pool, key) => !!(key && !key.anon && pool && pool.panel && pool.panel.kind === 'private' && pool.panel.principal_id === key.principal_id);   // pages on: trust 'red team passed (pages)' 3:41 AM CT, CEO OWNER_all_6 item 5
async function materialFor(env, items) {
  if (!MATERIAL_ON_CALLS.pages) return {};
  const out = [];
  for (const it of items) {
    if (typeof it.text === 'string' && !it.media_id) continue;   // words in the call itself: the call read reads them
    if (!it.media_id) { out.push({ content_type: '', bytes: 0, text: null }); continue; }
    const m = await env.DB.prepare('SELECT r2_key, content_type, bytes FROM media WHERE id = ?').bind(it.media_id).first();
    const ct = String((m && m.content_type) || '').toLowerCase();
    let text = null;
    if (m && /^(?:text\/html|text\/plain|image\/svg\+xml)\b/.test(ct) && m.bytes <= 100000) {
      try { const o = await env.MEDIA.get(m.r2_key); text = o ? await o.text() : null; } catch { text = null; }
    }
    out.push({ content_type: ct, bytes: m ? m.bytes : 0, text });
  }
  return out.length ? { material: out, sandbox_ok: true, material_builds_enabled: !!MATERIAL_ON_CALLS.builds } : {};
}

// ---------- the quote (section 12.1) ----------

function expectation(spec, pool) {
  if (pool && pool.adapter) return { m: pool.adapter.expected.minutes, note: pool.adapter.expected.note + (pool.mode === 'recorded' ? '; this is the recorded stand-in of the pool, answering in seconds with scripted people' : '') };
  if (spec.pool_kind === 'self') return { m: null, note: 'one seat, yours: it is answered when you open the link' };
  if (spec.pool_kind === 'simulated') return spec.pace === 'human' ? { m: 6, note: 'simulated people at human pace answer over 1 to 6 minutes' } : { m: 0.2, note: 'simulated people answer within 10 seconds' };
  if (pool && pool.panel && pool.panel.kind === 'team-test') return { m: 2, note: "the team's own headless test members answer within a few minutes" };
  return { m: null, note: 'a private panel answers as its members switch On and accept; this server has no record yet to estimate from' };
}

async function quoteObject(env, request, key, spec, defaults_used, pool) {
  const q = quoteLines(spec);
  const ex = expectation(spec, pool);
  const out = {
    quote_id: 'q_' + (await sha256hex(canonical(spec.pool_account ? { ...callOut(spec), pool_account: spec.pool_account } : callOut(spec)))).slice(0, 24),
    pool: spec.pool, people: spec.people, pay_per_person_usd: fmt(spec.pay_cents),
    lines: linesOut(q.lines), total_usd: fmt(q.total_cents),
    ...(q.paid_elsewhere ? { pool_account: 'yours', paid_elsewhere: q.paid_elsewhere } : {}),
    pay_floor_usd_per_hour: fmt(PAY_FLOOR_CENTS_PER_HOUR),
    expected_minutes_to_enough: ex.m, expected_note: ex.note,
    expires_at: iso(nowMs() + 15 * 60000),
    what_you_pay: WHAT_YOU_PAY,
    defaults_used, simulated: spec.pool_kind === 'simulated', test_money: TEST_MONEY,
  };
  if (pool && pool.panel && !pool.adapter) {
    out.panel_size = pool.members; out.members_on_now = pool.members_on_now; out.small_panel = pool.members < 5;   // MONEY-12
    if (!pool.self) {
      const { panelOutlook } = await import('./rings.js');
      const o = await panelOutlook(env, pool.panel.id, nowMs());
      out.earliest_ring_at = o.earliest_ring_at ? iso(o.earliest_ring_at) : null;
      out.members_on_now = o.on_now;   // who can be rung now: On and outside their quiet hours
      // MONEY-11: the expected minutes count from the first moment anyone can be rung
      if (!o.on_now && o.earliest_ring_at) out.expected_minutes_to_enough = Math.max(0, Math.round((o.earliest_ring_at - nowMs()) / 60000)) + ex.m;
      if (!o.on_now) out.expected_note = o.earliest_ring_at ? `nobody on the panel can be asked now (${o.quiet} in quiet hours, ${o.off} Off); the first offer can go at ${iso(o.earliest_ring_at)}` : `nobody on the panel can be asked now: ${o.off} of ${o.members} are Off; offers go when someone switches On`;
    }
  }
  return { out, total: q.total_cents };
}

// MONEY-13 (D34): one or two plain sentences an agent can show its user to approve the call.
function forYourUser(spec, q, pool) {
  const n = spec.people, one = n === 1;
  const who = spec.pool_kind === 'simulated' ? `${n} simulated ${one ? 'person' : 'people'} (made-up answers, free to try)` : spec.pool_kind === 'self' ? 'you yourself, once' : pool && pool.adapter ? `${n} ${one ? 'person' : 'people'} from an outside panel` : `${n} ${one ? 'person' : 'people'} from your own panel`;
  let what = { listen: 'listen to it', watch: 'watch it', view: 'look at it', play: 'play it', compare: 'compare them', answer: 'answer' }[spec.kind];
  if (spec.kind !== 'answer' && !(spec.content || []).length) what += spec.kind === 'compare' ? ' once you send them to me' : ' once you send it to me';   // CALL-7: priced before the material
  const lines = (q.lines || []).filter(l => l.amount_usd !== '0.00').map(l => l.kind === 'reserve' ? `${l.amount_usd} held in reserve, returned if unused` : `${l.kind.replace('_', ' ')} ${l.amount_usd}`).join(', ');
  let when = q.expected_minutes_to_enough == null ? 'answers come as people take it' : q.expected_minutes_to_enough < 1 ? 'answers come within seconds' : `answers usually come in about ${q.expected_minutes_to_enough} minutes`;
  const wait = q.earliest_ring_at ? Math.round((Date.parse(q.earliest_ring_at) - nowMs()) / 60000) : 0;
  if (wait >= 2) {   // nobody can be rung yet (quiet hours, or everyone Off until then): say so, in words the user can check
    // the agent turns earliest_ring_at into the user's own clock; the sentence a person reads says only how long (chief, 6:47)
    const then = Math.max(1, (q.expected_minutes_to_enough || 0) - wait);
    when = `nobody can be asked for ${wait < 90 ? `about ${wait} minutes` : `about ${Math.round(wait / 60)} hours`}; then answers usually come in about ${then} minutes`;
  }
  let money = q.total_usd === '0.00' ? 'It costs nothing' : `It costs at most $${q.total_usd} (${lines})${q.test_money ? ', in test money, so nothing is charged' : ''}`;
  if (q.paid_elsewhere) money += `, and ${spec.pool} takes the people's pay and its fee (${q.paid_elsewhere.total_usd}) from your own ${spec.pool} account`;
  // PAY_RULES (TRUST 5:45 AM CT 15 Nov): a pool that can pay only its whole reward pays a person who stops in full, and the
  // asker is charged that seat in full; the quote says so before the call opens
  if (pool && pool.adapter && pool.adapter.pays_people) money += `; on ${spec.pool} a person who stops early is paid in full, and that seat is charged in full`;
  const ask = spec.ask.length > 120 ? spec.ask.slice(0, 117) + '...' : spec.ask;
  return `I'd like to ask ${who} to ${what}: "${ask}"${/[.?!]$/.test(ask) ? '' : '.'} ${money}; ${when}. Shall I go ahead?`;
}

// When the caller left minutes out, a listen or watch takes the material's own length plus a minute, once that length is
// known (a sample, or a file read at upload or copy-in): a four-minute song is not a two-minute call. The pay floor is
// judged again on the new minutes.
function minutesFromMaterial(spec, defaults_used) {
  if (defaults_used.minutes === undefined || !['listen', 'watch'].includes(spec.kind) || !(spec.media_seconds_hint > 0)) return;
  const m = Math.min(120, Math.ceil(spec.media_seconds_hint / 60) + 1);
  if (m === spec.minutes) return;
  spec.minutes = m; defaults_used.minutes = m;
  if (defaults_used.pay_per_person_usd !== undefined && spec.pool_kind === 'adapter') { spec.pay_cents = defaultPayCents(m); defaults_used.pay_per_person_usd = fmt(spec.pay_cents); }
  const floor = Math.ceil(PAY_FLOOR_CENTS_PER_HOUR * m / 60);
  if (spec.pay_cents > 0 && spec.pay_cents < floor) throw fixable('below_pay_floor', 'pay_per_person_usd', `Send pay_per_person_usd "${fmt(floor)}" or more: the material is ${Math.round(spec.media_seconds_hint)} seconds long, so each person needs about ${m} minutes, paid at least ${fmt(floor)} (${fmt(PAY_FLOOR_CENTS_PER_HOUR)} an hour); ${fmt(spec.pay_cents)} is under it.`, fmt(floor));
}

export async function quote(env, request, key, body) {
  const k = key || ANON;
  const { spec, defaults_used } = normalizeCall(body, Date.now(), { quote: true });   // CALL-7: no material needed for a price
  const wantS = spec.wants_strangers ? (await import('./strangers.js')).readWantsStrangers(spec.wants_strangers) : null;   // OWNER_all_6 item 2
  const pool = await resolvePool(env, k, spec);
  if (spec.floorError && !pool.adapter) throw spec.floorError;
  const items = await resolveContent(env, k, spec, pool.simulated, false, ownPanelOf(pool, k));
  if (!spec.media_seconds_hint) { const s = items.find(i => i.seconds); if (s) spec.media_seconds_hint = s.seconds; }
  minutesFromMaterial(spec, defaults_used);
  const qo = await quoteObject(env, request, k, spec, defaults_used, pool);
  const out = qo.out;
  try {   // D35: kept one day so the human who approves can see the lines and the total (never the ask)
    await env.DB.prepare('INSERT OR REPLACE INTO quotes (id, lines_json, total_cents, expires_at, created_at) VALUES (?,?,?,?,?)').bind(out.quote_id, JSON.stringify(out.lines), qo.total, Date.parse(out.expires_at), nowMs()).run();
  } catch (e) { }
  // SCREEN-6: a quote on any pool says whether the call would be held on real people, including when screening cannot run
  const principal = k.anon ? null : await env.DB.prepare('SELECT team FROM principals WHERE id = ?').bind(k.principal_id).first();
  const sres = await runScreening(spec, { key_class: k.class, pool: spec.pool, simulated: pool.simulated, call_id: 'quote', pool_real: true,
    principal_is_ours: !!(principal && principal.team) && spec.pool_account !== 'principal', principal_new: true, accepts_content_url: pool.simulated, ...(await screenTerms(env)),
    // read like the call would be: a live key's quote, and a test key's quote on its own panel once people have joined it
    // (an empty panel's quote never spends on the read)
    ...(k.class === 'real' || (pool.panel && pool.panel.kind === 'private' && pool.panel.principal_id === k.principal_id && pool.members > 0)
      ? { ...(await modelParts(env)), ...(await materialFor(env, items)) }
      : (pool.panel && pool.panel.kind === 'private' && pool.panel.principal_id === k.principal_id ? { panel_empty: true } : {})) });   // trust 5:47: a principal's own pool account is screened as an outsider's
  if (sres.decision === 'REFUSE') {   // SCREEN-1: a call that would be refused is refused at the quote, with the same error
    const r = sres.result || {}; const er = r.error || r;
    const msg = er.message || r.message || 'Screening refused this call.';
    throw new CallError(422, { code: 'refused_screening', status: 422, fixable: !!er.fixable, rule: er.rule || r.rule || null, category: er.category || r.category || null,
      rule_text: er.rule_text || r.rule_text || null, message: er.fixable || /stop and tell your user/i.test(msg) ? msg : msg + ' Stop and tell your user; do not send this request again in other words.',
      field: er.fixable ? (er.field || r.where || 'ask') : undefined, example: er.fixable ? (er.example === undefined ? null : er.example) : undefined, problems: er.problems });
  }
  out.for_your_user = forYourUser(spec, out, pool);
  if (pool && pool.adapter && pool.adapter.pays_people) out.stop_pays = `On this pool a person who stops early is paid in full (${spec.pool} can pay only its whole reward), and that seat is charged in full.`;
  if (wantS) out.strangers = await (await import('./strangers.js')).recordStrangers(env, request, k, wantS, out.quote_id);
  { const sl = await (await import('./strangers.js')).strangersLineFor(env, request, k); if (sl) out.strangers_status = sl; }
  if (!['ALLOW', 'REFUSE'].includes(sres.decision)) {
    out.would_be_held = true;
    const adv = holdAdvice(sres, spec);   // OWNER_all_4 item 2: why, in one sentence; what to change, in one more
    out.held_reason = adv.text;
    out.ext = { ...(out.ext || {}), hold: adv.detail };
  }
  return out;
}

// ---------- the owner releases a held call (owner/RELEASE_HELD.md; bin/release_held) ----------

// A call screening held (or a person reported) waits for a person to read it. When the owner releases it, it opens as
// any call would: the money is held now, seats are made (or a report's withdrawn seats wait again), and the deadline
// window starts again from now, since the wait was ours, not the asker's. Outside pools are not released (live is off).
// The media check refused it (tasks.js reviewReply): the call is refused, the asker reads why, nothing was ever rung or charged
export async function refuseHeld(env, callId, reason) {
  const now = nowMs();
  const call = await env.DB.prepare('SELECT * FROM calls WHERE id = ?').bind(callId).first();
  if (!call || call.status !== 'held' || call.closed_at) throw notFixable(409, 'not_held', `The call is ${call ? call.status : 'gone'}, not held; nothing to refuse.`);
  const scr = JSON.parse(call.screening_json || '{}');
  Object.assign(scr, { held_reason: reason, held_rule: 'media_review_refused' });
  await env.DB.batch([
    env.DB.prepare('UPDATE calls SET status = \'refused\', closed_at = ?, screening_json = ? WHERE id = ? AND status = \'held\'').bind(now, JSON.stringify(scr), callId),
    env.DB.prepare('UPDATE held_calls SET released_at = ?, decided = ? WHERE call_id = ?').bind(now, 'refused after the media check', callId),
  ]);
  return { call_id: callId, status: 'refused' };
}

export async function releaseHeld(env, request, callId) {
  const now = nowMs();
  const call = await env.DB.prepare('SELECT * FROM calls WHERE id = ?').bind(callId).first();
  if (!call) throw notFixable(404, 'not_found', 'No such call.');
  if (call.status !== 'held' || call.closed_at) throw notFixable(409, 'not_held', `The call is ${call.status}, not held; nothing to release.`);
  const spec = JSON.parse(call.spec_json);
  if (call.pool_ref || spec.pool_kind === 'adapter') throw notFixable(409, 'not_held', 'A call on an outside pool cannot be released here (live outside pools are off).');
  const deadline = now + (spec.deadline_minutes || 120) * 60000;
  const st = [
    env.DB.prepare('UPDATE calls SET status = \'open\', deadline_at = ?, reported_at = NULL WHERE id = ? AND status = \'held\' AND closed_at IS NULL').bind(deadline, callId),
    env.DB.prepare('UPDATE held_calls SET decided = \'released by the owner\', released_at = ? WHERE call_id = ? AND released_at IS NULL').bind(now, callId),
  ];
  const seats = (await env.DB.prepare('SELECT COUNT(*) AS n FROM seats WHERE call_id = ?').bind(callId).first()).n;
  if (seats === 0) {   // held when it opened: no money held and no seats yet
    const q = JSON.parse(call.quote_json || '{}');
    const total = Math.round(parseFloat(q.total_usd || '0') * 100) || 0;
    if (total > 0) {
      st.push(env.DB.prepare('UPDATE calls SET hold_cents = ? WHERE id = ?').bind(total, callId));
      st.push(...posting(env.DB, 'hold:' + callId, [{ ...acct.avail(call.principal_id), cents: -total }, { ...acct.hold(callId), cents: total }], callId, 'hold when the owner released the call', now));
    }
    for (let n = 0; n < call.people; n++) st.push(seatInsert(env, callId, spec, n, now, now, false));
  } else {   // a reported call: the seats the report withdrew wait again
    st.push(env.DB.prepare('UPDATE seats SET state = \'waiting\', stop_reason = NULL, due_at = ? WHERE call_id = ? AND state = \'released\' AND stop_reason = \'withdrawn\'').bind(now, callId));
  }
  try { await env.DB.batch(st); }
  catch (e) {
    if (isFloorBreach(e)) throw notFixable(402, 'insufficient_balance', 'The principal\'s balance cannot hold this call any more; nothing was released.');
    if (isDuplicatePosting(e)) throw notFixable(409, 'not_held', 'Released already.');
    throw e;
  }
  await settle(env, request, { callId });
  return callObject(env, request, await env.DB.prepare('SELECT * FROM calls WHERE id = ?').bind(callId).first());
}

// The owner's list of what waits: id, why, when, and the ask to read (admin only; the terminal, never a file).
// The operator's list of calls in the last 24 hours that screening held or would hold on real people, and every call the
// model read, with what the rules held and what the read said (trust, 6:36 PM CT, 14 Nov). Quotes are not kept (D35: a quote keeps its lines and
// total only); their reads are in the day's total. A call the model refused is never made, so it is listed from its
// refusal (idempotency), without its words.
export async function screenedList(env) {
  const since = nowMs() - 86400000;
  // TRUST 6:26 AM CT 15 Nov: with own panels ringing, outsiders' calls to real people that rules alone allowed are listed too,
  // with what TRUST needs to judge them (the ask's first 300 characters, the material's id, the asker's name, the counts)
  const rows = (await env.DB.prepare(`SELECT c.id, c.status, c.kind, c.people, c.created_at, c.simulated, c.pool, c.screening_json, p.team,
        substr(c.ask, 1, 300) AS ask, c.spec_json, c.asker_name, c.reported_at,
        (SELECT COUNT(*) FROM seats s WHERE s.call_id = c.id AND s.offered_to IS NOT NULL) AS offered_now,
        (SELECT COUNT(*) FROM seats s WHERE s.call_id = c.id AND s.state = 'answered') AS answered
      FROM calls c LEFT JOIN principals p ON p.id = c.principal_id
      WHERE c.created_at >= ? AND (c.screening_json LIKE '%"model_read"%' OR c.screening_json LIKE '%"hold_rules"%' OR c.status = 'held'
        OR (COALESCE(p.team, 0) = 0 AND c.pool LIKE 'panel:%' AND c.simulated = 0))
      ORDER BY c.created_at DESC LIMIT 500`).bind(since).all()).results || [];
  const calls = rows.map(c => {
    const s = (() => { try { return JSON.parse(c.screening_json || '{}'); } catch { return {}; } })();
    return { at: iso(c.created_at), call_id: c.id, ours: !!c.team, pool: c.pool, simulated: !!c.simulated,
      status: c.status, kind: c.kind, people: c.people, screening: s.decision || null, rules_held: s.hold_rules || [], model_read: s.model_read || null,
      final: c.status === 'held' ? 'held' : s.would_hold_on_real_pool ? 'ran; would be held on real people' : 'ran',
      ask: c.ask, content: (() => { try { return (JSON.parse(c.spec_json || '{}').content || []).map(x => x && (x.media_id || (x.url ? 'url' : x.text !== undefined ? 'text' : null))); } catch { return []; } })(),
      asker_name: c.asker_name || null, offered_now: c.offered_now, answered: c.answered, reported_at: c.reported_at ? iso(c.reported_at) : null };
  });
  const refused = ((await env.DB.prepare(`SELECT key_id, created_at, response_json FROM idempotency
      WHERE op = 'call' AND status = 422 AND created_at >= ? AND response_json LIKE '%"rule":"model_read"%' ORDER BY created_at DESC LIMIT 200`).bind(since).all()).results || [])
    .map(r => { const e = (() => { try { return JSON.parse(r.response_json || '{}'); } catch { return {}; } })(); return { at: iso(r.created_at), final: 'refused by the model read', category: e.category || null, reason: String(e.rule_text || '').slice(0, 300) }; });
  const { modelReadStatus } = await import('./model_cap.js');
  const day = await modelReadStatus(env).catch(() => null);
  const read = calls.filter(c => c.model_read);
  return { model_read: day, reads_listed: read.length + refused.length,
    lifted_by_the_read: calls.filter(c => c.model_read && c.model_read.decision === 'ALLOW').length,
    held_after_the_read: read.filter(c => c.model_read.decision === 'HOLD').length, refused_by_the_read: refused.length,
    calls, refused, note: 'Calls in the last 24 hours that screening held or would hold on real people, and every call the model read, newest first. Quotes and POST /internal/screen measurements are not kept; their reads count in the day\'s total. Terminal only: never paste this into a file.' };
}

export async function heldList(env) {
  const rows = (await env.DB.prepare(`SELECT h.call_id, h.rule, h.reason, h.created_at, c.status, c.ask, c.kind, c.pool, c.people, c.reported_at, p.name AS principal, p.team
      FROM held_calls h JOIN calls c ON c.id = h.call_id JOIN principals p ON p.id = c.principal_id WHERE h.released_at IS NULL ORDER BY h.created_at`).all()).results || [];
  return { waiting: rows.map(r => ({ call_id: r.call_id, rule: r.rule, reason: r.reason, held_at: iso(r.created_at), status: r.status, reported: !!r.reported_at,
    principal: r.principal, ours: !!r.team, kind: r.kind, pool: r.pool, people: r.people, ask: r.ask })) };
}

// ---------- a person an outside pool sent (ADAPTERS.md step 3) ----------

// One conditional statement (R13): the seat is made only if the call still has room, nobody with this pid has a seat, and
// the hold can pay one more seat in full after every seat already taken; concurrent arrivals cannot overfill the call.
async function admitPoolSeat(env, call, { id, memberId, now, simJson, due, pid }) {
  const per = perSeatCost(call);
  const r = await env.DB.prepare(`INSERT INTO seats (id, call_id, n, state, member_id, taken_at, offer_expires_at, sim_json, due_at, pool_pid)
      SELECT ?, ?, (SELECT COALESCE(MAX(n), -1) + 1 FROM seats WHERE call_id = ?), 'taken', ?, ?, ?, ?, ?, ?
      WHERE (SELECT COUNT(*) FROM seats WHERE call_id = ? AND state IN ('taken', 'answered')) < ?
        AND NOT EXISTS (SELECT 1 FROM seats WHERE call_id = ? AND pool_pid = ?)
        AND (? = 0 OR COALESCE((SELECT cents FROM balances WHERE account = ?), 0) - (SELECT COUNT(*) FROM seats WHERE call_id = ? AND state = 'taken') * ? >= ?)`)
    .bind(id, call.id, call.id, memberId, now, now, simJson, due, pid, call.id, call.people, call.id, pid, call.pay_cents, 'hold:' + call.id, call.id, per, per).run();
  return r.meta.changes === 1;
}

// Where the pool's person goes when their seat ends (Prolific: its completion address with our code).
export async function poolReturn(env, request, call, how = 'answered') {
  if (!call.pool_ref) return null;
  const ref = JSON.parse(call.pool_ref); const ad = getAdapter(ref.adapter); if (!ad) return null;
  const r = await ad.finish(adapterCtx(env, request, call, ref.mode, null, ref.account || 'ours', ad), call, ref, how);
  return r && r.completion_url || null;
}

// The arrival address a team check uses on a recorded pool (the same token the study's address carries).
export async function arrivalUrlFor(env, request, call) {
  const tok = await signArrivalToken(env.SEAT_SECRET, { arr: call.id, exp: call.deadline_at + 3600000 });
  return { token: tok, url: runnerBase(request) + '/p/' + tok };
}

// POST /v1/arrivals/{ar_token} {pid, study, session}: the runner's /p/ page posts the pool's own identifiers; the router makes
// a seat for that person on the spot, already taken (they chose the job themselves), and answers with its link. The same
// pid again gets the same seat. On the recorded stand-in only the team's 'recorded_' ids arrive.
export async function arrive(env, request, token, body) {
  const p = await readArrivalToken(env.SEAT_SECRET, token);
  if (!p || !p.arr) throw notFixable(404, 'not_found', 'This link is not valid.');
  if (p.exp && nowMs() > p.exp) throw notFixable(410, 'call_closed', 'This study has closed. Please return it on the panel\'s site; nothing is marked against you.');
  for (const k of Object.keys(body || {})) if (!['pid', 'study', 'session'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not a field here; send pid, study and session.`, null);
  const pid = body && body.pid;
  if (typeof pid !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(pid)) throw fixable('invalid_field', 'pid', 'pid is the panel\'s id for the person (letters and digits).', null);
  const call = await env.DB.prepare('SELECT * FROM calls WHERE id = ?').bind(p.arr).first();
  if (!call || !call.pool_ref) throw notFixable(404, 'not_found', 'This link is not valid.');
  const ref = JSON.parse(call.pool_ref);
  if (ref.mode === 'recorded' && !pid.startsWith('recorded_')) throw notFixable(404, 'not_found', 'This link is not valid.');
  const have = await env.DB.prepare('SELECT * FROM seats WHERE call_id = ? AND pool_pid = ?').bind(call.id, pid).first();
  const { seatLink } = await import('./seats.js');
  if (have) throw notFixable(409, 'already_arrived', 'This place is already taken. If it is yours, go back to the page you were on; if not, please return the study on the panel\'s site. Nothing is marked against you.');
  const now = nowMs();
  if (call.status !== 'open' || now > call.deadline_at || call.reported_at) throw notFixable(410, 'call_closed', 'This study has closed. Please return it on the panel\'s site; nothing is marked against you.');
  const timeout = now + Math.max(call.est_minutes * 3 * 60000, 30 * 60000);
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = rid('s_');
    let ok = false;
    try { ok = await admitPoolSeat(env, call, { id, memberId: 'pool:' + id, now, simJson: null, due: timeout, pid }); }
    catch (e) { if (/UNIQUE/.test(String(e && e.message || e))) continue; throw e; }   // two seats numbered alike at once: try again
    if (!ok) {
      if (await env.DB.prepare('SELECT 1 AS x FROM seats WHERE call_id = ? AND pool_pid = ?').bind(call.id, pid).first()) throw notFixable(409, 'already_arrived', 'This place is already taken. If it is yours, go back to the page you were on; if not, please return the study on the panel\'s site. Nothing is marked against you.');
      throw notFixable(409, 'call_full', 'This study is full. Please return it on the panel\'s site; nothing is marked against you.');
    }
    const seat = await env.DB.prepare('SELECT * FROM seats WHERE id = ?').bind(id).first();
    const l = await seatLink(env, request, seat, call, seat.member_id);
    return { seat_token: l.token, seat_url: l.url };
  }
  throw notFixable(409, 'call_full', 'This study is full. Please return it on the panel\'s site; nothing is marked against you.');
}

// ---------- open a call ----------

// Without an idempotency_key, the same body within 10 minutes is a retry. Ten-minute buckets keep concurrent retries on one
// key (the UNIQUE guard); a record in the bucket before, made less than 10 minutes ago, is the same call (a bucket's edge
// must not split a retry seconds apart: suite C07 caught it at 5:15 AM CT).
async function autoIdemKey(env, scope, op, hash, now) {
  const b = Math.floor(now / 600000), h = hash.slice(0, 32);
  const prev = await env.DB.prepare('SELECT idem_key FROM idempotency WHERE key_id = ? AND op = ? AND idem_key = ? AND created_at > ?').bind(scope, op, 'auto:' + h + ':' + (b - 1), now - 600000).first();
  return prev ? prev.idem_key : 'auto:' + h + ':' + b;
}

export async function openCall(env, request, key, body, ipHash) {
  const now = nowMs();
  const { spec, defaults_used, idempotency_key } = normalizeCall(body, now);
  const wantS = spec.wants_strangers ? (await import('./strangers.js')).readWantsStrangers(spec.wants_strangers) : null;   // OWNER_all_6 item 2
  // a keyless call our own checks make (the team header) keeps a scope of its own, so GET /v1/proof never counts it
  const idemScope = key.anon ? (teamCheck(env, request) ? 'anon:team:' : 'anon:') + ipHash : key.id;
  const reqHash = await sha256hex(canonical({ ...callOut(spec), script: spec.script || null, ext: spec.ext || null }));   // equal calls are equal however written
  let idem = idempotency_key;
  if (!idem) { idem = await autoIdemKey(env, idemScope, 'call', reqHash, now); defaults_used.idempotency_key = 'none given: the same body from the same ' + (key.anon ? 'address' : 'principal') + ' within 10 minutes returns this call'; }
  const prior = await env.DB.prepare('SELECT request_hash, status, response_json FROM idempotency WHERE key_id = ? AND op = ? AND idem_key = ? AND created_at > ?').bind(idemScope, 'call', idem, now - 86400000).first();
  if (prior) {
    if (prior.request_hash !== reqHash) throw fixable('idempotency_key_reused', 'idempotency_key', 'This idempotency_key was already used with a different body. Use a new key for a new call, or send the first body unchanged to get its answer again.', 'a-new-key-' + rid('', 6), {}, 409);
    const first = JSON.parse(prior.response_json);
    if (prior.status >= 400) throw new CallError(prior.status, first);
    const call = await env.DB.prepare('SELECT * FROM calls WHERE id = ?').bind(first.call_id).first();
    return { status: prior.status, body: { ...(await callObject(env, request, call)), repeated: true } };
  }
  if (key.anon && spec.pay_cents > 0) throw fixable('forbidden_for_key_class', 'pay_per_person_usd', 'A call without a key is unpaid: pay_per_person_usd "0.00". To try a paid call in test money, make a free test key with POST /v1/keys.', '0.00', {}, 403);
  const pool = await resolvePool(env, key, spec);   // a keyless call to any pool but simulated is unauthorized before any limit
  if (spec.floorError && !pool.adapter) throw spec.floorError;
  const copyAtOpen = true;
  if (key.anon) {
    // per address; generous, because many agents (and this team's own checks) share one address
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM idempotency WHERE key_id = ? AND op = \'call\' AND created_at > ?').bind(idemScope, now - 3600000).first();
    if (n.n >= 300 && !teamCheck(env, request)) throw notFixable(429, 'rate_limited', 'At most 300 calls an hour without a key from one address. Make a free test key with POST /v1/keys.', { retry_after_seconds: 600 });
  }

  const items = await resolveContent(env, key, spec, pool.simulated, copyAtOpen, ownPanelOf(pool, key));
  if (!spec.media_seconds_hint) { const s = items.find(i => i.seconds); if (s) spec.media_seconds_hint = s.seconds; }
  minutesFromMaterial(spec, defaults_used);
  if (['listen', 'watch'].includes(spec.kind) && items.some(i => i.kind && !['audio', 'video'].includes(i.kind)))
    throw fixable('invalid_field', 'kind', `The material is ${items[0].kind}, which is not for "${spec.kind}".`, items[0].kind === 'image' ? 'view' : 'listen');
  if (!pool.simulated && !pool.adapter && pool.members === 0) throw fixable('unknown_pool', 'pool', 'That panel has no members yet. Share its join link first, or use pool "simulated".', 'simulated');

  const { out: qb, total } = await quoteObject(env, request, key, spec, defaults_used, pool);
  if (spec.max_total_cents === null) throw fixable('missing_field', 'max_total_usd', `max_total_usd is required: the most this call may cost, every fee included, so whoever approves the call sees the ceiling. This call costs ${fmt(total)}.`, fmt(total), { quote: qb });
  if (total > spec.max_total_cents)
    throw fixable('over_max_total_usd', 'max_total_usd', `This call would cost ${fmt(total)} and max_total_usd is ${fmt(spec.max_total_cents)}. Nothing was opened. Raise max_total_usd to ${fmt(total)} once your user agrees, or ask fewer people or pay less.`, fmt(total), { quote: qb, test_money: TEST_MONEY });
  const dayRow = await env.DB.prepare('SELECT COALESCE(SUM(hold_cents),0) AS c FROM calls WHERE key_id = ? AND created_at > ?').bind(key.id, now - 86400000).first();
  let approvedId = null;
  if (!key.anon && (total > key.cap_call_cents || (dayRow.c + total) > key.cap_day_cents)) {
    // A3: the human approves this one call at approve_url; the same call sent again then opens once above the cap
    const { overCap, useApproval } = await import('./approvals.js');
    const ap = await overCap(env, request, key, reqHash, total, qb.lines);
    if (ap.approvedId && (await useApproval(env, ap.approvedId))) approvedId = ap.approvedId;
    else {
      const which = total > key.cap_call_cents ? `the key's cap for one call (${fmt(key.cap_call_cents)})` : `the key's cap for the day (${fmt(key.cap_day_cents)}; ${fmt(dayRow.c)} already held in the last 24 hours)`;
      const how = ap.approvedId === undefined && ap.approve_url && ap.approve_url.includes('?t=')
        ? 'Tell your user the amount and ask them to approve it at approve_url; once they have, send the same call again and it opens.'
        : 'Tell your user the amount; approve_url explains to them what they can do. Do not make another key to get past a cap.';
      throw notFixable(402, 'over_key_cap', `This call would cost ${fmt(total)}, above the cap your user set: ${which}. Nothing was opened. ${how}`,
        { approve_url: ap.approve_url, approve_expires_at: ap.expires_at, quote: qb, test_money: TEST_MONEY });
    }
  }

  // screening, before anyone is asked; fails closed for anything that can reach a real person
  const callId = rid('call_', 26);
  const canReachReal = key.class === 'real';
  const poolReal = !pool.simulated && !(pool.panel && ['team-test', 'attack'].includes(pool.panel.kind));
  const principal = key.anon ? null : await env.DB.prepare('SELECT team FROM principals WHERE id = ?').bind(key.principal_id).first();
  const paidBefore = key.anon ? null : await env.DB.prepare('SELECT COUNT(*) AS n FROM calls WHERE principal_id = ? AND status = \'complete\' AND hold_cents > 0 AND created_at < ?').bind(key.principal_id, now - 30 * 86400000).first();
  const sres = await runScreening(spec, { key_class: key.class, pool: spec.pool, simulated: pool.simulated, call_id: callId,
    pool_real: poolReal || canReachReal, principal_is_ours: !!(principal && principal.team) && spec.pool_account !== 'principal', principal_new: !(paidBefore && paidBefore.n > 0), accepts_content_url: pool.simulated, ...(await screenTerms(env)),
    ...(poolReal || canReachReal ? { ...(await modelParts(env)), ...(await materialFor(env, items)) } : {}) });
  const verdict = gate(sres, { canReachReal, poolReal });
  if (verdict === 'refuse') {
    const r = sres.result || {}; const er = r.error || r;
    const errBody = { code: 'refused_screening', status: 422, fixable: !!er.fixable, rule: er.rule || r.rule || null, category: er.category || r.category || null,
      rule_text: er.rule_text || r.rule_text || null, message: er.message || r.message || 'Screening refused this call.',
      field: er.fixable ? (er.field || r.where || 'ask') : undefined, example: er.fixable ? (er.example === undefined ? null : er.example) : undefined,
      problems: er.problems, policy_section: er.policy_section, also: er.also,
      policy_url: (er.policy_url || r.policy_url) ? ((er.policy_url || r.policy_url).startsWith('/') ? siteBase(request) + (er.policy_url || r.policy_url) : (er.policy_url || r.policy_url)) : undefined };
    if (!errBody.fixable) {
      if (!/stop and tell your user/i.test(errBody.message)) errBody.message += ' Stop and tell your user; do not send this request again in other words.';
      await env.DB.prepare('INSERT OR IGNORE INTO idempotency (key_id, op, idem_key, request_hash, status, response_json, created_at) VALUES (?,?,?,?,?,?,?)').bind(idemScope, 'call', idem, reqHash, 422, JSON.stringify(errBody), now).run();
    }
    throw new CallError(422, errBody);
  }

  // the team's check of the owner's release (bin/baseline): '[TEST: hold for release]' holds a team key's call on a team
  // panel as screening would hold a real one (only there: a team key, a team-test panel)
  const testHold = !!(key.team && pool.panel && pool.panel.kind === 'team-test' && !pool.adapter && !pool.self && /\[TEST: hold for release\]/.test(spec.ask));
  const held = verdict === 'hold' || testHold;
  const deadline = now + spec.deadline_minutes * 60000;
  const holdMsg = sres.result && sres.result.hold && sres.result.hold.message;
  const holdRule = sres.result && sres.result.hold && sres.result.hold.reasons && sres.result.hold.reasons[0] ? sres.result.hold.reasons[0].rule : (sres.summary.rule || sres.summary.decision.toLowerCase());
  const marked = held || sres.summary.would_hold_on_real_pool;
  // OWNER_all_8 item 3: a call to a panel a key made for its own people, held ONLY because nothing has heard or seen its audio
  // or video (in our storage, 20 MB at most), goes to a person at person.tools as a review task; the asker is told so, no time
  let reviewPiece = null;
  if (held && pool.panel && pool.panel.kind === 'private' && pool.panel.principal_id === key.principal_id) {
    const reasons = (sres.result && sres.result.hold && sres.result.hold.reasons) || [];
    const ownPr = await env.DB.prepare('SELECT class FROM principals WHERE id = ?').bind(key.principal_id).first();
    if (ownPr && ownPr.class !== 'real' && reasons.length && reasons.every(r => r.rule === 'uninspected_material')) {
      for (const it of items) {
        if (!it.media_id) continue;
        const md = await env.DB.prepare('SELECT id, content_type, bytes, seconds FROM media WHERE id = ?').bind(it.media_id).first();
        if (md && /^(?:audio|video)\//.test(md.content_type || '')) { reviewPiece = md; break; }
      }
      const { reviewConfig, REVIEW_MAX_BYTES } = await import('./tasks.js');
      if (reviewPiece && (reviewPiece.bytes > REVIEW_MAX_BYTES || !(await reviewConfig(env)))) reviewPiece = null;
    }
  }
  const adv = !marked ? null : reviewPiece
    ? { text: (await import('./tasks.js')).ACCEPTED_FOR_REVIEW, detail: { rule: 'media_review', fixable: false, field: null, to_pass: 'Nothing to change; read its status with the call id.', example: null } }
    : (testHold && verdict !== 'hold')
    ? { text: 'Held for the owner\'s release check, a team test. The owner releases it.', detail: { rule: 'test_hold', fixable: false, field: null, to_pass: 'The owner releases it.', example: null } }
    : holdAdvice(sres, spec);
  const sr = sres.result || {};
  const screening = { ...sres.summary, held_reason: marked ? adv.text : undefined, hold_fix: marked ? adv.detail : undefined,
    hold_rules: sr.hold && Array.isArray(sr.hold.reasons) ? sr.hold.reasons.map(x => x.rule) : undefined,
    model_read: sr.model_read ? { decision: sr.model_read.decision, category: sr.model_read.category || null, reason: String(sr.model_read.reason || '').slice(0, 300) } : undefined,
    held_rule: marked ? (reviewPiece ? 'media_review' : holdRule) : undefined, review_by: held && !reviewPiece ? iso(Math.min(now + REVIEW_HOURS * 3600000, now + spec.deadline_minutes * 60000)) : undefined };   // never later than the deadline
  const st = [];
  st.push(env.DB.prepare(`INSERT INTO calls (id, principal_id, key_id, status, pool, panel_id, simulated, kind, ask, spec_json, defaults_json, quote_json,
      people, enough, pay_cents, est_minutes, max_total_cents, hold_cents, deadline_at, screening_json, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(callId, key.principal_id, key.id, held ? 'held' : 'open', spec.pool,
    pool.panel && !pool.adapter ? pool.panel.id : null, pool.simulated ? 1 : 0, spec.kind, spec.ask, JSON.stringify({ ...spec, items }), JSON.stringify(defaults_used),
    JSON.stringify(qb), spec.people, spec.enough, spec.pay_cents, Math.max(1, Math.round(spec.minutes)), spec.max_total_cents, held ? 0 : total, deadline,
    JSON.stringify(screening), now));
  if (held) {
    st.push(env.DB.prepare('INSERT INTO held_calls (call_id, reason, rule, created_at) VALUES (?,?,?,?)').bind(callId, screening.held_reason || 'held', screening.held_rule || null, now));
  } else {
    if (total > 0) st.push(...posting(env.DB, 'hold:' + callId, [{ ...availOf(key), cents: -total }, { ...acct.hold(callId), cents: total }], callId, 'hold when the call opens', now));
    if (pool.self) {
      const mb = 'mb_self_' + callId.slice(5);
      st.push(env.DB.prepare('INSERT INTO members (id, panel_id, token_hash, alias, is_real, tz, quiet_start, quiet_end, on_state, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(mb, 'p_self', 'self:' + callId, 'a visitor', 0, 'America/Chicago', 0, 0, 'on', now));
      st.push(env.DB.prepare('INSERT INTO seats (id, call_id, n, state, offered_to, offer_expires_at, due_at) VALUES (?,?,?,?,?,?,?)').bind('s_' + callId.slice(5, 25), callId, 0, 'offered', mb, now + SELF_LINK_MINUTES * 60000, now + SELF_LINK_MINUTES * 60000));
    } else if (!pool.adapter) for (let n = 0; n < spec.people; n++) st.push(seatInsert(env, callId, spec, n, now, now, pool.simulated));
  }
  if (pool.panel && pool.panel.kind === 'private' && pool.panel.asker_name && key.class !== 'real') st.push(env.DB.prepare('UPDATE calls SET asker_name = ? WHERE id = ?').bind(pool.panel.asker_name, callId));
  st.push(env.DB.prepare('INSERT INTO idempotency (key_id, op, idem_key, request_hash, status, response_json, created_at) VALUES (?,?,?,?,?,?,?)').bind(idemScope, 'call', idem, reqHash, 201, JSON.stringify({ call_id: callId }), now));
  try { await env.DB.batch(st); }
  catch (e) {
    const msg = String(e && e.message || e);
    if (/UNIQUE constraint failed: idempotency/.test(msg)) return openCall(env, request, key, body, ipHash);   // a concurrent retry won; answer as it did
    if (isFloorBreach(e)) {
      const bal = await balance(env.DB, availOf(key).account);
      throw notFixable(402, 'insufficient_balance', `The balance is ${fmt(bal)} and this call needs ${fmt(total)} held. Nothing was opened. ${key.class === 'test' ? 'This is test money: make a new test key with POST /v1/keys, or ask fewer people.' : 'Ask your user to top up the balance.'}`, { balance_usd: fmt(bal), needed_usd: fmt(total), test_money: TEST_MONEY });
    }
    throw e;
  }
  let call = await env.DB.prepare('SELECT * FROM calls WHERE id = ?').bind(callId).first();
  if (reviewPiece) {
    try { const { createReviewTask } = await import('./tasks.js'); await createReviewTask(env, call, reviewPiece, { asker: pool.panel.asker_name ? `${pool.panel.asker_name} (named by the asker; not checked by person.tools)` : 'an asker' }); }
    catch (e) { console.log('review task', callId, String(e && e.message || e)); }
  }
  if (pool.adapter && !held) {
    // the pool's job is created after the money is held; if the pool refuses, the call is cancelled and the hold returned
    try {
      call.arrival_token = await signArrivalToken(env.SEAT_SECRET, { arr: callId, exp: deadline + 3600000 });
      const pr = key.anon ? null : await env.DB.prepare('SELECT name, class FROM principals WHERE id = ?').bind(key.principal_id).first();
      const account = spec.pool_account === 'principal' ? 'principal' : 'ours';
      const { ref } = await pool.adapter.open(adapterCtx(env, request, call, pool.mode, pr && pr.class === 'real' ? pr.name : null, account, pool.adapter), call, spec);
      await env.DB.prepare('UPDATE calls SET pool_ref = ? WHERE id = ?').bind(JSON.stringify({ ...ref, mode: pool.mode, adapter: pool.adapter.name, account }), callId).run();
    } catch (e) {
      await env.DB.prepare('UPDATE calls SET status = \'cancelled\', cancelled_at = ? WHERE id = ?').bind(now, callId).run();
      await settle(env, request, { callId });
      throw notFixable(502, 'internal', `The pool "${spec.pool}" did not take the call (${String(e.message).slice(0, 120)}). Nothing was charged; the hold was returned.`);
    }
    call = await env.DB.prepare('SELECT * FROM calls WHERE id = ?').bind(callId).first();
  }
  const out = await callObject(env, request, call);
  if (pool.self && !held) {
    const tok = await signSeatToken(env.SEAT_SECRET, { seat: 's_' + callId.slice(5, 25), call: callId, mb: 'mb_self_' + callId.slice(5), exp: now + SELF_LINK_MINUTES * 60000 });
    out.self_seat_url = runnerBase(request) + '/c/' + tok;
    out.self_seat_token = tok;
    out.self_note = `Your own seat: open self_seat_url within ${SELF_LINK_MINUTES} minutes. What you do there comes back here as a real record (not simulated), in test money, and is deleted 24 hours after the call closes.`;
  }
  if (wantS) out.strangers = await (await import('./strangers.js')).recordStrangers(env, request, key, wantS, callId);
  { const sl = await (await import('./strangers.js')).strangersLineFor(env, request, key); if (sl) out.strangers_status = sl; }
  return { status: 201, body: out };
}

// a seat row; simulated seats carry their script index in n and are due when their person answers, stops, declines or misses
function seatInsert(env, callId, spec, n, openedAt, now, simulated) {
  const sid = rid('s_');
  if (!simulated) return env.DB.prepare('INSERT INTO seats (id, call_id, n, state, due_at) VALUES (?,?,?,?,?)').bind(sid, callId, n, 'waiting', now);
  const e = entryFor(spec, n);
  const accept = e.accept === undefined ? true : e.accept;
  const due = accept === true ? Math.max(now + 200, openedAt + delayMs(spec, n, e)) : now;   // SIM-7: a decline or a miss resolves at once
  return accept === true
    ? env.DB.prepare('INSERT OR IGNORE INTO seats (id, call_id, n, state, taken_at, offer_expires_at, sim_json, due_at) VALUES (?,?,?,?,?,?,?,?)').bind(sid, callId, n, 'taken', now, now, '{}', due)
    : env.DB.prepare('INSERT OR IGNORE INTO seats (id, call_id, n, state, offer_expires_at, sim_json, due_at) VALUES (?,?,?,?,?,?,?)').bind(sid, callId, n, 'offered', due, '{}', due);
}

// ---------- settle: the lazy timer ----------

export async function settle(env, request, opts = {}) {
  const now = nowMs();
  const limit = opts.limit || 40;
  const q = opts.callId
    ? env.DB.prepare('SELECT * FROM seats WHERE call_id = ? AND due_at IS NOT NULL AND due_at <= ? ORDER BY due_at LIMIT ?').bind(opts.callId, now, limit)
    : env.DB.prepare('SELECT * FROM seats WHERE due_at IS NOT NULL AND due_at <= ? ORDER BY due_at LIMIT ?').bind(now, limit);
  try { await pollAdapters(env, request, now, opts.callId); } catch (e) { console.log('pollAdapters', String(e && e.stack || e)); }
  const due = (await q.all()).results || [];
  for (const s of due) {
    try { await settleSeat(env, request, s, now); }
    catch (e) {   // a seat that cannot be settled waits ten minutes, so one broken seat never slows every request
      console.log('settleSeat', s.id, String(e && e.stack || e));
      try { await env.DB.prepare('UPDATE seats SET due_at = ? WHERE id = ? AND due_at = ?').bind(now + 600000, s.id, s.due_at).run(); } catch { }
    }
  }
  const calls = opts.callId
    ? (await env.DB.prepare('SELECT * FROM calls WHERE id = ? AND closed_at IS NULL').bind(opts.callId).all()).results
    : (await env.DB.prepare(`SELECT * FROM calls WHERE closed_at IS NULL AND (deadline_at <= ? OR status = 'cancelled' OR (status = 'held' AND created_at <= ?)
        OR id IN (SELECT call_id FROM seats WHERE due_at IS NULL AND state IN ('answered','stopped','expired','released'))) LIMIT ?`).bind(now, now - REVIEW_HOURS * 3600000, limit).all()).results;
  for (const c of calls || []) { try { await maybeClose(env, request, c, now); } catch (e) { console.log('maybeClose', c.id, String(e && e.stack || e)); } }
  return { seats: due.length, calls: (calls || []).length };
}

// Pay follows the pool's own record (PROLIFIC_GO_LIVE.md, preconditions for live mode; the CEO 4:25 AM CT 15 Nov):
//   1. a seat whose person never appears in the pool's own list of submissions within ten minutes is released unpaid (the
//      study's address carries the arrival token, so anyone who reads it could post invented ids and be paid at timeout);
//   2. a person who stopped early and came back to the pool with the stop code is approved there, so the pool pays them
//      (the ledger already pays a pool seat's stop in full: an approval pays the whole reward).
// On the recorded stand-in, Prolific's list is every arrived "recorded_" id except one containing "_invented", and its
// window is 20 seconds so the release check can see it.
const RECONCILE_MS = { live: 10 * 60000, recorded: 20000 };
async function reconcilePool(env, request, call, ref, ad, got, now) {
  const seats = (await env.DB.prepare('SELECT id, state, pool_pid, taken_at FROM seats WHERE call_id = ? AND pool_pid IS NOT NULL').bind(call.id).all()).results || [];
  if (!seats.length) return;
  const subs = ref.mode === 'recorded'
    ? seats.filter(s => s.pool_pid.startsWith('recorded_') && !s.pool_pid.includes('_invented')).map(s => ({ id: 'recorded_sub_' + s.id, pid: s.pool_pid,
        status: s.state === 'stopped' ? 'AWAITING REVIEW' : s.state === 'answered' ? 'APPROVED' : 'ACTIVE', code: s.state === 'stopped' ? ref.stop_code : s.state === 'answered' ? ref.code : null }))
    : (got && got.submissions) || [];
  const byPid = new Map(subs.map(x => [x.pid, x]));
  const ev = (seatId, body) => env.DB.prepare('INSERT INTO events (seat_id, received_at, body_json) VALUES (?,?,?)').bind(seatId, now, JSON.stringify(body)).run();
  for (const s of seats) {
    const sub = byPid.get(s.pool_pid);
    if (!sub && s.state === 'taken' && now - s.taken_at >= (RECONCILE_MS[ref.mode] || RECONCILE_MS.live)) {
      const r = await env.DB.prepare('UPDATE seats SET state = \'released\', stop_reason = \'not_on_panel\', due_at = NULL WHERE id = ? AND state = \'taken\'').bind(s.id).run();
      if (r.meta.changes === 1) await ev(s.id, { not_on_panel: true });
    }
    if (sub && s.state === 'stopped' && ref.stop_code && sub.code === ref.stop_code && /AWAITING/i.test(String(sub.status || ''))) {
      const done = await env.DB.prepare('SELECT 1 AS x FROM events WHERE seat_id = ? AND body_json LIKE \'{"stop_approved"%\'').bind(s.id).first();
      if (done) continue;
      try { await adapterCtx(env, request, call, ref.mode, null, ref.account || 'ours', ad).fetch('POST', `/submissions/${sub.id}/transition/`, { action: 'APPROVE' }); await ev(s.id, { stop_approved: true }); }
      catch (e) { console.log('pool stop approval', call.id, String(e && e.message || e)); }
    }
  }
}

// Outside pools: who arrived since the last look (recorded mode: the recorded participants, as scripted stand-ins).
async function pollAdapters(env, request, now, callId) {
  const calls = callId
    ? (await env.DB.prepare('SELECT * FROM calls WHERE id = ? AND pool_ref IS NOT NULL AND closed_at IS NULL AND status = \'open\'').bind(callId).all()).results || []
    : (await env.DB.prepare('SELECT * FROM calls WHERE pool_ref IS NOT NULL AND closed_at IS NULL AND status = \'open\' AND (pool_polled_at IS NULL OR pool_polled_at < ?) LIMIT 5').bind(now - 15000).all()).results || [];
  for (const call of calls) {
    const ref = JSON.parse(call.pool_ref); const ad = getAdapter(ref.adapter); if (!ad) continue;
    if (now >= call.deadline_at) continue;
    const ok = await env.DB.prepare('UPDATE calls SET pool_polled_at = ? WHERE id = ? AND (pool_polled_at IS NULL OR pool_polled_at < ?)').bind(now, call.id, now - (ref.mode === 'live' ? 30000 : 1000)).run();
    if (ok.meta.changes !== 1) continue;
    const got = await ad.poll(adapterCtx(env, request, call, ref.mode, null, ref.account || 'ours', ad), call, ref);
    try { await reconcilePool(env, request, call, ref, ad, got, now); } catch (e) { console.log('reconcilePool', call.id, String(e && e.message || e)); }
    for (const a of got.arrivals || []) {
      const have = await env.DB.prepare('SELECT id FROM seats WHERE call_id = ? AND pool_pid = ?').bind(call.id, a.pid).first();
      if (have) continue;
      const due = a.recorded ? Math.max(now + 200, call.created_at + 1000 * ((a.script && a.script.delay_seconds) || 5)) : null;
      let ok = false;
      try { ok = await admitPoolSeat(env, call, { id: rid('s_'), memberId: null, now, simJson: a.recorded ? JSON.stringify({ script: a.script || {} }) : null, due, pid: a.pid }); }
      catch (e) { if (!/UNIQUE/.test(String(e && e.message || e))) throw e; }
      if (!ok) break;   // full, or the hold cannot pay another seat (R13)
    }
  }
}

async function settleSeat(env, request, s, now) {
  const call = await env.DB.prepare('SELECT * FROM calls WHERE id = ?').bind(s.call_id).first();
  if (!call) return;
  const spec = JSON.parse(call.spec_json);
  if (s.sim_json) {
    if (call.closed_at) { await env.DB.prepare('UPDATE seats SET due_at = NULL WHERE id = ?').bind(s.id).run(); return; }
    const own = s.sim_json && s.sim_json !== '{}' ? (JSON.parse(s.sim_json).script || null) : null;
    if (!spec.minutes) spec.minutes = spec.estimated_minutes || call.est_minutes || 2;           // a call stored before the 0.1 shape
    if (!Array.isArray(spec.content)) spec.content = [];
    spec.content = spec.content.map(c => typeof c === 'string' ? (c.startsWith('m_') ? { media_id: c } : { url: c }) : c);
    const o = simOutcome(call.id, spec, s.n, spec.items || [], own);
    if (s.state === 'offered') {   // a simulated person who declines or lets the offer lapse
      const ok = await setSeat(env, s.id, 'offered', { state: 'expired', stop_reason: o.state === 'declined' ? 'declined' : 'missed', ended_at: now, due_at: null });
      if (ok) await nextSimSeat(env, call, spec, now);
      return;
    }
    if (s.state === 'taken') {
      const r = await finishSeat(env, request, call, s, { state: o.state, stop_reason: o.stop_reason, seatSeconds: o.seat_seconds, answers: o.answers, input: o.input,
        partial: o.partial, record: o.record, evidence: o.level, levelReason: o.level_reason, simulated: true,
        person: s.pool_pid ? await personRef(env, call.principal_id, 'pool:' + s.pool_pid) : (call.principal_id === 'pr_anonymous' ? 'pp_' + (await hmacHex(env.SEAT_SECRET || 'local', 'anon:' + s.id)).slice(0, 20) : 'sim_' + (s.n + 1)),
        memberId: null, endedAt: now, fullPay: call.status === 'cancelled' || now >= call.deadline_at });
      if (o.state === 'stopped' && !r.already) await nextSimSeat(env, call, spec, now);
      return;
    }
    await env.DB.prepare('UPDATE seats SET due_at = NULL WHERE id = ?').bind(s.id).run();
    return;
  }
  // a seat on a panel
  if (s.state === 'waiting') {
    if (!['open', 'enough'].includes(liveStatus(call, now))) { await setSeat(env, s.id, 'waiting', { state: 'released', stop_reason: 'withdrawn', due_at: null }); return; }
    await offerSeat(env, call, s, now);
    return;
  }
  if (s.state === 'offered' && s.offer_expires_at <= now && call.panel_id === 'p_self') { await setSeat(env, s.id, 'offered', { state: 'expired', stop_reason: 'missed', due_at: null }); return; }
  if (s.state === 'offered' && s.offer_expires_at <= now) {
    const ch = await env.DB.prepare('UPDATE seats SET state = \'waiting\', offered_to = NULL, offer_expires_at = NULL, due_at = ? WHERE id = ? AND state = \'offered\' AND offer_expires_at <= ?').bind(now, s.id, now).run();
    // RING_RULES (chief's ruling, 2:38 PM CT): a lapsed offer counts as missed (toward Off, and PEOPLE-8's 'never again')
    // only if it reached the person: the push service accepted the ring for them, or their open page listed the offer.
    // An offer they were never told about counts for nothing; their page is told a call could not reach them.
    const reached = s.offered_to ? await env.DB.prepare(`SELECT 1 AS x FROM events WHERE seat_id = ? AND received_at >= ? AND (
        (body_json LIKE '{"seen_by"%' AND json_extract(body_json, '$.seen_by') = ?) OR
        (body_json LIKE '{"ring"%' AND json_extract(body_json, '$.ring.ok') = 1 AND json_extract(body_json, '$.ring.to') = ?)) LIMIT 1`)
      .bind(s.id, (s.offer_expires_at || now) - 185000, s.offered_to, s.offered_to).first() : null;
    if (ch.meta.changes === 1 && s.offered_to && !reached) {
      await env.DB.prepare('INSERT INTO events (seat_id, received_at, body_json) VALUES (?,?,?)').bind(s.id, now, JSON.stringify({ unreached: s.offered_to })).run();
    }
    if (ch.meta.changes === 1 && s.offered_to && reached) {
      await env.DB.prepare('INSERT INTO events (seat_id, received_at, body_json) VALUES (?,?,?)').bind(s.id, now, JSON.stringify({ missed_by: s.offered_to })).run();
      // two missed rings in a row switch a real person Off (RING_RULES); the team's headless members are never switched off
      await env.DB.prepare('UPDATE members SET missed_rings = missed_rings + 1, on_state = CASE WHEN (is_real = 1 OR alias = \'team-test missed bot\') AND missed_rings + 1 >= 2 THEN \'off\' ELSE on_state END WHERE id = ?').bind(s.offered_to).run();
      const mm = await env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(s.offered_to).first();
      if (mm && (mm.is_real || mm.alias === 'team-test missed bot') && mm.on_state === 'off' && mm.missed_rings === 2) await ringMember(env, mm);   // P2: switched Off, and told
    }
    return;
  }
  if (s.state === 'taken') {   // still inside after the deadline's grace: stopped and paid as if they had answered (STATE-5)
    await finishPanelSeat(env, request, call, s, { reason: 'timeout', answers: null, input: null, fullPay: true }, now);
    return;
  }
  await env.DB.prepare('UPDATE seats SET due_at = NULL WHERE id = ?').bind(s.id).run();
}

// What one seat costs at full pay: the pay, the router fee on it (none on a principal's own panel), the pool's fee on it.
function perSeatCost(call) {
  const sp = JSON.parse(call.spec_json);
  if (sp.pool_account === 'principal') return Math.floor(call.pay_cents * PRICE.router_fee_rate + 0.5);
  const rate = sp.pool_fee_rate || 0;
  return call.pay_cents + (call.panel_id ? 0 : Math.floor(call.pay_cents * PRICE.router_fee_rate + 0.5)) + Math.floor(call.pay_cents * rate + 0.5);
}

// STATE-4: a seat is admitted only while the hold can still pay it in full, after every seat already taken is paid in full
async function canAdmit(env, call) {
  if (call.pay_cents === 0) return true;
  const per = perSeatCost(call);
  const holdBal = await balance(env.DB, 'hold:' + call.id);
  const taken = await env.DB.prepare('SELECT COUNT(*) AS n FROM seats WHERE call_id = ? AND state = \'taken\'').bind(call.id).first();
  return holdBal - taken.n * per >= per;
}

async function nextSimSeat(env, call, spec, now) {
  const c = await seatCounts(env, call.id);
  if (c.answered + c.taken >= call.people) return;
  if (!(await canAdmit(env, call))) return;
  if (now >= call.deadline_at || call.status === 'cancelled') return;
  const mx = await env.DB.prepare('SELECT MAX(n) AS n FROM seats WHERE call_id = ?').bind(call.id).first();
  const n = (mx && mx.n != null ? mx.n : -1) + 1;
  if (n > 3 * call.people + 40) return;
  const e = entryFor(spec, n);
  const accept = e.accept === undefined ? true : e.accept;
  const due = accept === true ? Math.max(now + 200, call.created_at + delayMs(spec, n, e)) : now;
  const per = perSeatCost(call);
  const guard = `WHERE (SELECT COUNT(*) FROM seats WHERE call_id = ? AND state IN ('taken', 'answered')) < ?
      AND (? = 0 OR COALESCE((SELECT cents FROM balances WHERE account = ?), 0) - (SELECT COUNT(*) FROM seats WHERE call_id = ? AND state = 'taken') * ? >= ?)`;
  const g = [call.id, call.people, call.pay_cents, 'hold:' + call.id, call.id, per, per];
  if (accept === true)
    await env.DB.prepare(`INSERT OR IGNORE INTO seats (id, call_id, n, state, taken_at, offer_expires_at, sim_json, due_at) SELECT ?, ?, ?, 'taken', ?, ?, '{}', ? ${guard}`)
      .bind(rid('s_'), call.id, n, now, now, due, ...g).run();
  else
    await env.DB.prepare(`INSERT OR IGNORE INTO seats (id, call_id, n, state, offer_expires_at, sim_json, due_at) SELECT ?, ?, ?, 'offered', ?, '{}', ? ${guard}`)
      .bind(rid('s_'), call.id, n, due, due, ...g).run();
}

async function setSeat(env, id, fromState, to) {
  const cols = Object.keys(to); const vals = cols.map(k => to[k]);
  const r = await env.DB.prepare(`UPDATE seats SET ${cols.map(c => c + ' = ?').join(', ')} WHERE id = ? AND state = ?`).bind(...vals, id, fromState).run();
  return r.meta.changes === 1;
}

export const PRIVATE_HOLD_MS = 15 * 60000;
// Offer a waiting seat on a panel to one eligible member, held for that person for one minute (FAIR-3); 15 on a private panel.
async function offerSeat(env, call, s, now) {
  if (call.reported_at) { await env.DB.prepare('UPDATE seats SET due_at = NULL WHERE id = ?').bind(s.id).run(); return; }
  if (!(await canAdmit(env, call))) { await env.DB.prepare('UPDATE seats SET due_at = ? WHERE id = ?').bind(now + 60000, s.id).run(); return; }
  const c = await seatCounts(env, call.id);
  if (c.answered + c.taken >= call.people) { await setSeat(env, s.id, 'waiting', { state: 'released', stop_reason: 'withdrawn', due_at: null }); return; }
  const pk = await env.DB.prepare('SELECT p.kind, p.paused_at, pr.class AS pclass FROM panels p LEFT JOIN principals pr ON pr.id = p.principal_id WHERE p.id = ?').bind(call.panel_id).first();
  const privatePanel = !!(pk && pk.kind === 'private');
  // OWNER_all_6 gate: a panel a test key made rings nobody real until the operator opens ringing for such panels; the team's
  // own headless members marked as bots (POST /internal/members/{id}/bot) may be offered meanwhile, for TRUST's proofs
  let botsOnly = false;
  if (privatePanel && pk.pclass !== 'real') {
    if (pk.paused_at) { await env.DB.prepare('UPDATE seats SET due_at = ? WHERE id = ?').bind(now + 600000, s.id).run(); return; }   // rule 9: reports pause the panels
    const { ownPanelsRingOpen } = await import('./panels.js');
    if (!(await ownPanelsRingOpen(env))) botsOnly = true;
  }
  // a 'throwaway bot' exists only for the release checks' leave and device lines and never answers: it is never offered a seat
  // (one leaked from a timed-out check took the second seat of every team call, 15 Nov 9:20 AM CT, and rolled back three releases)
  const members = (await env.DB.prepare(`SELECT m.* FROM members m WHERE m.panel_id = ? AND m.left_at IS NULL AND m.adult_at IS NOT NULL AND m.alias != 'throwaway bot'
      AND m.id NOT IN (SELECT COALESCE(offered_to, '') FROM seats WHERE call_id = ? AND offered_to IS NOT NULL)
      AND m.id NOT IN (SELECT COALESCE(member_id, '') FROM seats WHERE call_id = ? AND member_id IS NOT NULL)
      AND m.id NOT IN (SELECT COALESCE(json_extract(e.body_json, '$.declined_by'), json_extract(e.body_json, '$.missed_by'), '') FROM events e JOIN seats s2 ON s2.id = e.seat_id
                       WHERE s2.call_id = ? AND (e.body_json LIKE '{"declined_by"%' OR e.body_json LIKE '{"missed_by"%'))
      ORDER BY COALESCE(m.last_ring_at, 0) LIMIT 20`).bind(call.panel_id, call.id, call.id, call.id).all()).results || [];
  // RING_RULES rule 11 (trust R12): a person is offered a call at most once; after declining it or letting it lapse, never again
  const { canRing } = await import('./rings.js');
  const eligible = botsOnly ? members.filter(m => !m.is_real) : members;
  if (botsOnly && !eligible.length) { await env.DB.prepare('UPDATE seats SET due_at = ? WHERE id = ?').bind(now + 600000, s.id).run(); return; }
  for (const m of eligible) {
    const ok = await canRing(env, m, now);
    if (!ok.ok) continue;
    // RING_RULES rule 2: a 3-minute hold for a person who asked for longer. The CEO, 10:46 PM CT 14 Nov (the operator's first real
    // call lapsed twice at one minute): until the app rings, an offer on a PRIVATE panel is held 15 minutes; outside pools keep 60 s
    const hold = privatePanel ? PRIVATE_HOLD_MS : m.slow_hold ? 180000 : 60000;
    const r = await env.DB.prepare('UPDATE seats SET state = \'offered\', offered_to = ?, offer_expires_at = ?, due_at = ? WHERE id = ? AND state = \'waiting\'').bind(m.id, now + hold, now + hold, s.id).run();
    if (r.meta.changes !== 1) return;
    await env.DB.prepare('UPDATE members SET last_ring_at = ? WHERE id = ?').bind(now, m.id).run();
    const web = await ringMember(env, m);   // the ring: a push with no words; the phone asks our page what is on offer
    // the iPhone app's ring (owner 10:44 PM CT 14 Nov): an Apple alert naming who answers for the call, its kind, minutes, pay
    const apple = m.apns_token ? await appleRing(env, m, call, s, now + hold, privatePanel && !call.asker_name) : null;   // a self-given name stays off the lock screen
    const rr = apple && apple.ok && !web.ok ? apple : web;
    // a ring that reached no phone (no subscription, no keys, a push service that refused) rang nobody: it does not start
    // the person's 30 minutes (RING_RULES 1; found on the operator's first real call, 10:39 PM CT 14 Nov, whose next offer would
    // otherwise have waited half an hour for a ring that never happened)
    if (!rr || !rr.ok) await env.DB.prepare('UPDATE members SET last_ring_at = ? WHERE id = ? AND last_ring_at = ?').bind(m.last_ring_at || null, m.id, now).run();
    // what the push service answered, kept on the seat (the operator's call read shows it): no words, no address
    try { await env.DB.prepare('INSERT INTO events (seat_id, received_at, body_json) VALUES (?,?,?)').bind(s.id, now, JSON.stringify({ ring: { ok: !!rr.ok, status: rr.status || 0, why: rr.why || null, real: !!m.is_real, to: m.id,
      ...(apple ? { apple: { ok: !!apple.ok, status: apple.status || 0, why: apple.why || null } } : {}) } })).run(); } catch { }
    return;
  }
  await env.DB.prepare('UPDATE seats SET due_at = ? WHERE id = ? AND state = \'waiting\'').bind(now + 60000, s.id).run();
}

// The iPhone app's ring: one Apple alert for this offer (apns.js). A token Apple calls dead is forgotten.
async function appleRing(env, m, call, s, expiresAt, privatePanel) {
  try {
    const { apnsConfigured, offerAlert, sendApns } = await import('./apns.js');
    if (!apnsConfigured(env)) return { ok: false, status: 0, why: 'apple push not configured' };
    const pr = await env.DB.prepare('SELECT name FROM principals WHERE id = ?').bind(call.principal_id).first();
    const payload = offerAlert({ askerName: pr && pr.name, privatePanel, kind: call.kind, minutes: call.est_minutes, payCents: call.pay_cents, callId: call.id, seatId: s.id, expiresAt, sound: m.sounds !== 0 });
    const r = await sendApns(env, { token: m.apns_token, env: m.apns_env }, payload, { expiresAt, collapseId: s.id });
    if (r.gone) await env.DB.prepare('UPDATE members SET apns_token = NULL, apns_env = NULL WHERE id = ? AND apns_token = ?').bind(m.id, m.apns_token).run();
    return r;
  } catch (e) { return { ok: false, status: 0, why: 'apple push failed: ' + String(e && e.message || e).slice(0, 80) }; }
}

// One ring to a member's phone (P2): a web push with no payload, only if they gave us a subscription. A dead one is dropped.
export async function ringMember(env, m) {
  if (!m.push_json || !env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC_KEY) return { ok: false, why: 'no subscription or no keys' };
  let sub; try { sub = JSON.parse(m.push_json); } catch { return { ok: false }; }
  const { isPushService } = await import('./seats.js');
  if (!isPushService(sub.endpoint)) { await env.DB.prepare('UPDATE members SET push_json = NULL WHERE id = ?').bind(m.id).run(); return { ok: false, why: 'not a push service' }; }
  const { sendRing } = await import('./webpush.js');
  const r = await sendRing(sub, env);
  if (r.gone) await env.DB.prepare('UPDATE members SET push_json = NULL WHERE id = ?').bind(m.id).run();
  return r;
}

async function personRef(env, principalId, memberId) {
  return 'pp_' + (await hmacHex(env.SEAT_SECRET || 'local', 'person:' + principalId + ':' + memberId)).slice(0, 20);
}

// section 12.3, rounded half up to the cent
function payFor(call, state, seatSeconds, stopReason, fullPay) {
  const base = call.pay_cents;
  if (base === 0) return 0;
  if (state === 'answered' || fullPay || stopReason === 'upset') return base;
  // max(stop_minimum_usd, pay x min(1, seat_seconds / (60 x minutes))), half up; the minimum never above the pay itself
  const sp = JSON.parse(call.spec_json); const minutes = sp.minutes || sp.estimated_minutes || call.est_minutes || 2;
  return Math.min(base, Math.max(STOP_MINIMUM_CENTS, Math.floor(base * Math.min(1, (Number(seatSeconds) || 0) / (60 * Math.max(0.5, minutes))) + 0.5)));
}

export async function finishPanelSeat(env, request, call, s, { reason, answers, input, partial, fullPay }, now) {
  const ev = await evidenceFor(env, call, s, now);
  const seatSeconds = Math.max(0, Math.round((now - (s.taken_at || now)) / 1000));
  const person = await personRef(env, call.principal_id, s.pool_pid ? 'pool:' + s.pool_pid : s.member_id);
  return finishSeat(env, request, call, s, {
    state: answers && !partial ? 'answered' : 'stopped', stop_reason: answers && !partial ? null : (reason === 'upset' ? 'upset' : 'stopped'), seatSeconds,
    answers, input, partial: !!partial, record: ev.record, evidence: ev.level, levelReason: ev.reason, simulated: !!(s.pool_pid && call.simulated), person, memberId: s.member_id, endedAt: now,
    fullPay: fullPay || !!s.pool_pid,
  });
}

// One batch: the seat's end, its response, its pay and fee, its receipt. Guards: responses.seat_id UNIQUE, receipts.seat_id
// UNIQUE, ledger UNIQUE(txn,line), balances CHECK. A second finisher fails as a whole and changes nothing.
async function finishSeat(env, request, call, s, f) {
  const now = f.endedAt;
  let pay = payFor(call, f.state, f.seatSeconds, f.stop_reason, f.fullPay);
  const isPool = !!call.pool_ref; const poolRate = isPool ? (JSON.parse(call.spec_json).pool_fee_rate || 0) : 0;
  const elsewhere = isPool && JSON.parse(call.spec_json).pool_account === 'principal';   // the pool pays people from the principal's own account
  let fee = (call.panel_id && !isPool) || pay === 0 ? 0 : Math.floor(pay * PRICE.router_fee_rate + 0.5);
  if (fee > 0) {   // never more router fee over the call than the quote's router_fee line (the asker was told that number)
    const q = JSON.parse(call.quote_json); const line = (q.lines || []).find(l => l.kind === 'router_fee');
    const quoted = line ? Math.round(parseFloat(line.amount_usd) * 100) : fee;
    const so_far = (await env.DB.prepare('SELECT COALESCE(SUM(fee_cents),0) AS c FROM seats WHERE call_id = ?').bind(call.id).first()).c;
    fee = Math.max(0, Math.min(fee, quoted - so_far));
  }
  const poolFee = isPool && !elsewhere ? Math.floor(pay * poolRate + 0.5) : 0;
  let cover = 0;
  if (pay > 0 && elsewhere) {   // only the router fee moves here; never more than the hold can give
    const holdBal = await balance(env.DB, 'hold:' + call.id);
    const open = await env.DB.prepare('SELECT COUNT(*) AS n FROM seats WHERE call_id = ? AND state = \'taken\' AND id != ?').bind(call.id, s.id).first();
    fee = Math.max(0, Math.min(fee, holdBal - (open ? open.n : 0) * perSeatCost(call)));
  } else if (pay > 0) {   // never more than the hold can give while keeping base pay for people still inside
    const holdBal = await balance(env.DB, 'hold:' + call.id);
    const open = await env.DB.prepare('SELECT COUNT(*) AS n FROM seats WHERE call_id = ? AND state = \'taken\' AND id != ?').bind(call.id, s.id).first();
    const keep = (open ? open.n : 0) * perSeatCost(call);
    const room = Math.max(0, holdBal - keep);
    // a person is always paid in full by the table; when the hold runs short, the fee shrinks first and the operator
    // covers the rest, so the asker never pays more than was held (MONEY-6) and nobody is underpaid
    if (pay + fee > room) {
      fee = Math.max(0, room - pay);
      if (f.simulated) pay = Math.min(pay, room); else cover = Math.max(0, pay - room);
    }
  }
  const st = [];
  st.push(env.DB.prepare('UPDATE seats SET state = ?, ended_at = ?, stop_reason = ?, pay_cents = ?, fee_cents = ?, evidence = ?, due_at = NULL WHERE id = ? AND state = \'taken\'')
    .bind(f.state, now, f.stop_reason, pay, fee, f.evidence, s.id));
  const receiptId = rid('rc_');
  let responseId = null;
  if (f.state === 'stopped' && !f.answers) { f.answers = {}; f.partial = true; }   // every stopped seat comes back, partial (s11.2)
  if (f.answers) {
    responseId = rid('r_');
    const rec = { ...f.record, level_reason: f.levelReason, seat_status: f.state, stop_reason: f.stop_reason, paid_cents: pay, receipt_id: receiptId };
    st.push(env.DB.prepare(`INSERT INTO responses (id, call_id, seat_id, seq, simulated, person_ref, answers_json, input_json, record_json, evidence, partial, created_at)
        VALUES (?,?,?,(SELECT COALESCE(MAX(seq),0)+1 FROM responses WHERE call_id = ?),?,?,?,?,?,?,?,?)`)
      .bind(responseId, call.id, s.id, call.id, f.simulated ? 1 : 0, f.person, JSON.stringify(f.answers), JSON.stringify(f.input || {}), JSON.stringify(rec), f.evidence, f.partial ? 1 : 0, now));
  }
  if (elsewhere) {
    if (fee > 0) st.push(...posting(env.DB, 'pay:' + s.id, [{ ...acct.hold(call.id), cents: -fee }, { ...acct.routerFees(), cents: fee }], call.id, 'router fee (the pool paid the person from the principal\'s own account)', now));
  } else if (pay + fee + poolFee > 0) {
    const payee = isPool ? { account: 'pool:' + JSON.parse(call.pool_ref).adapter + (f.simulated ? ':recorded' : ''), floor0: 1 } : acct.paid(f.simulated ? 'simulated' : (f.memberId || 'unknown'));
    const lines = [{ ...acct.hold(call.id), cents: -(pay + fee + poolFee - cover) }, { ...payee, cents: pay + poolFee }];
    if (cover > 0) lines.push({ account: 'operator:covers', floor0: 0, cents: -cover });
    if (fee > 0) lines.push({ ...acct.routerFees(), cents: fee });
    st.push(...posting(env.DB, 'pay:' + s.id, lines, call.id, f.state === 'answered' ? 'pay for an answer' : 'pay for time on a stop', now));
  }
  const principal = await env.DB.prepare('SELECT id, name, class, team FROM principals WHERE id = ?').bind(call.principal_id).first();
  const outs = JSON.parse((await env.DB.prepare('SELECT outcomes_json FROM calls WHERE id = ?').bind(call.id).first() || {}).outcomes_json || '[]');
  const payload = {
    receipt_id: receiptId, iss: apiBase(request), rev: 1, issued_at: iso(now), call_ref: await callRef(env, call.id),
    answered_for: answeredFor(principal, call), kind: call.kind, seat_status: f.state,
    evidence: f.evidence, minutes: Math.round(f.seatSeconds / 6) / 10, paid_usd: fmt(pay), unpaid: call.pay_cents === 0, ...(elsewhere ? { paid_by: 'the pool, from the asker\'s own account there' } : {}),
    fees: [...(fee > 0 ? [{ kind: 'router_fee', amount_usd: fmt(fee) }] : []), ...(poolFee > 0 ? [{ kind: 'pool_fee', amount_usd: fmt(poolFee) }] : [])], simulated: !!f.simulated, test_money: TEST_MONEY,
    outcomes: outs.filter(o => o.status === 'delivered').map(o => ({ text: o.text, at: o.at })),
  };
  if (outs.some(o => o.status === 'delivered')) payload.rev = 1;
  const signed = await signJws(env, payload);
  st.push(env.DB.prepare('INSERT INTO receipts (id, call_id, seat_id, member_id, body_json, signature, key_id, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(receiptId, call.id, s.id, f.memberId || null, JSON.stringify(payload), signed.jws, signed.kid, now));
  try { await env.DB.batch(st); }
  catch (e) { if (/UNIQUE constraint failed: (responses|receipts|ledger)/.test(String(e && e.message || e))) return { already: true }; throw e; }
  return { receipt_id: receiptId, paid_usd: fmt(pay), response_id: responseId, unpaid: payload.unpaid, evidence: f.evidence };
}

// Who answers for a call, as a person reads it on a ring card and a receipt: a principal's own name; the team's test
// principal by its name; a self-made test key or no key: "an unnamed test caller"; pool self: the visitor themselves.
export function answeredFor(principal, call) {
  if (call && call.asker_name) return `${call.asker_name} (named by the asker; not checked by person.tools)`;   // OWN_PANELS.md rule 12
  if (call && call.panel_id === 'p_self') return `you, trying it on the ${(BUILD.names && BUILD.names.network) || ''} page`.replace(/\s+page$/, ' page');
  if (!principal || principal.id === 'pr_anonymous' || (principal.class === 'test' && !principal.team)) return 'an unnamed test caller';
  return principal.name;
}

// The status a reader sees now, even if nothing has run since the deadline passed (STATE-3).
export function liveStatus(call, now, counts) {
  if (call.closed_at) return call.status;
  if (call.status === 'held') return now >= reviewBy(call) ? 'refused' : 'held';
  if (call.status === 'cancelled') return 'cancelled';
  if (counts && counts.answered >= call.people) return 'complete';
  if (now >= call.deadline_at) return 'expired';
  if (counts && counts.answered >= call.enough) return 'enough';
  return 'open';
}

function reviewBy(call) {
  const scr = JSON.parse(call.screening_json || '{}');
  const t = scr.review_by ? Date.parse(scr.review_by) : NaN;
  return isFinite(t) ? t : Math.min(call.created_at + REVIEW_HOURS * 3600000, call.deadline_at);
}

// Close a call at a terminal state: settle every seat, return the unspent hold (STATE-2).
async function maybeClose(env, request, call, now) {
  if (call.status === 'held') {
    if (now < reviewBy(call)) return false;
    await env.DB.batch([env.DB.prepare('UPDATE calls SET status = \'refused\', closed_at = ? WHERE id = ? AND status = \'held\' AND closed_at IS NULL').bind(now, call.id),
      env.DB.prepare('UPDATE held_calls SET decided = \'refused: not reviewed in time\', released_at = ? WHERE call_id = ?').bind(now, call.id)]);
    return true;
  }
  let c = await seatCounts(env, call.id);
  const full = c.answered >= call.people;
  const past = now >= call.deadline_at;
  const cancelled = call.status === 'cancelled';
  if (!full && !past && !cancelled) {
    if (c.waiting + c.offered + c.taken > 0 || !call.simulated || call.pool_ref) return false;   // simulated: every attempt used
  }
  if (full || past || cancelled) {
    await env.DB.prepare('UPDATE seats SET state = \'released\', stop_reason = \'withdrawn\', offered_to = NULL, due_at = NULL WHERE call_id = ? AND state IN (\'waiting\',\'offered\')').bind(call.id).run();
    if (!call.simulated) await env.DB.prepare('UPDATE seats SET due_at = ? WHERE call_id = ? AND state = \'taken\' AND (due_at IS NULL OR due_at > ?)').bind(Math.max(now, call.deadline_at) + 1800000, call.id, Math.max(now, call.deadline_at) + 1800000).run();
    c = await seatCounts(env, call.id);
  }
  if (c.taken > 0) return false;
  const finalStatus = cancelled ? 'cancelled' : (c.answered >= call.people ? 'complete' : 'expired');
  if (call.pool_ref) { try { const ref = JSON.parse(call.pool_ref); const ad = getAdapter(ref.adapter); if (ad) await ad.close(adapterCtx(env, request, call, ref.mode, null, ref.account || 'ours', ad), call, ref); } catch (e) { console.log('adapter close', String(e)); } }
  try { await fairTopUp(env, request, call, now); } catch (e) { console.log('fairTopUp', String(e && e.stack || e)); }
  const st = [env.DB.prepare('UPDATE calls SET status = ?, closed_at = ? WHERE id = ? AND closed_at IS NULL').bind(finalStatus, now, call.id)];
  const holdBal = await balance(env.DB, 'hold:' + call.id);
  const paid = await env.DB.prepare('SELECT COALESCE(SUM(pay_cents),0) AS pay, COALESCE(SUM(fee_cents),0) AS fee FROM seats WHERE call_id = ?').bind(call.id).first();
  let rest = holdBal;
  if (!call.panel_id && paid.pay > 0 && paid.fee < PRICE.router_fee_min_cents) {   // (also on a principal's own pool account: the fee is ours)
    const topFee = Math.min(rest, PRICE.router_fee_min_cents - paid.fee);
    if (topFee > 0) { st.push(...posting(env.DB, 'minfee:' + call.id, [{ ...acct.hold(call.id), cents: -topFee }, { ...acct.routerFees(), cents: topFee }], call.id, 'router fee: the minimum for a call', now)); rest -= topFee; }
  }
  if (rest > 0) {
    const back = call.principal_id === 'pr_anonymous' ? { account: 'avail:pr_anonymous', floor0: 0 } : acct.avail(call.principal_id);
    st.push(...posting(env.DB, 'release:' + call.id, [{ ...acct.hold(call.id), cents: -rest }, { ...back, cents: rest }], call.id, 'unused hold returned when the call closed', now));
  }
  try { await env.DB.batch(st); } catch (e) { if (isDuplicatePosting(e)) return false; throw e; }
  return true;
}

// FAIR-4: if the median time of a call's answered seats exceeds its minutes, each answered person is topped up to the floor
// for that median, from the reserve (and by the operator past it, so the promise holds). Shown as top_up_usd on the
// response and on the receipt, which is issued again (rev one higher).
async function fairTopUp(env, request, call, now) {
  if (call.pay_cents === 0) return;
  const spec = JSON.parse(call.spec_json);
  if (spec.pool_account === 'principal') return;   // a bonus through the pool from the principal's account: not built; live stays off until it is
  const rows = (await env.DB.prepare('SELECT r.id AS rid, r.record_json, s.id AS sid, s.pay_cents, s.member_id FROM responses r JOIN seats s ON s.id = r.seat_id WHERE r.call_id = ? AND s.state = \'answered\'').bind(call.id).all()).results || [];
  if (!rows.length) return;
  const secs = rows.map(x => { const o = (JSON.parse(x.record_json).observed) || {}; return Number(o.seat_seconds) || 0; }).sort((a, b) => a - b);
  const median = secs.length % 2 ? secs[(secs.length - 1) / 2] : (secs[secs.length / 2 - 1] + secs[secs.length / 2]) / 2;
  if (median <= spec.minutes * 60) return;
  const floor = Math.ceil(PAY_FLOOR_CENTS_PER_HOUR * median / 3600);
  for (const x of rows) {
    const top = floor - x.pay_cents;
    if (top <= 0) continue;
    const holdBal = await balance(env.DB, 'hold:' + call.id);
    const fromHold = Math.min(top, holdBal), cover = top - fromHold;
    const lines = [{ ...acct.hold(call.id), cents: -fromHold }, { ...acct.paid(call.simulated ? 'simulated' : (x.member_id || 'unknown')), cents: top }];
    if (cover > 0) lines.push({ account: 'operator:covers', floor0: 0, cents: -cover });
    const rec = JSON.parse(x.record_json); rec.paid_cents = (rec.paid_cents || 0) + top; rec.top_up_cents = top;
    const st = [...posting(env.DB, 'topup:' + x.sid, lines.filter(l => l.cents !== 0), call.id, 'FAIR-4: top-up to the floor for the median time', now),
      env.DB.prepare('UPDATE seats SET pay_cents = pay_cents + ? WHERE id = ?').bind(top, x.sid),
      env.DB.prepare('UPDATE responses SET record_json = ? WHERE id = ?').bind(JSON.stringify(rec), x.rid),
      // RES-9: a response that changed after delivery is delivered again after the cursor, with the same response_id
      env.DB.prepare('UPDATE responses SET seq = (SELECT COALESCE(MAX(seq), 0) + 1 FROM responses WHERE call_id = ?) WHERE id = ?').bind(call.id, x.rid)];
    const rc = await env.DB.prepare('SELECT * FROM receipts WHERE seat_id = ?').bind(x.sid).first();
    if (rc) {
      const p = JSON.parse(rc.body_json); const np = { ...p, rev: (p.rev || 1) + 1, issued_at: iso(now), paid_usd: fmt(x.pay_cents + top), top_up_usd: fmt(top) };
      const signed = await signJws(env, np);
      st.push(env.DB.prepare('UPDATE receipts SET body_json = ?, signature = ?, key_id = ? WHERE id = ?').bind(JSON.stringify(np), signed.jws, signed.kid, rc.id));
    }
    try { await env.DB.batch(st); } catch (e) { if (!isDuplicatePosting(e)) throw e; }
  }
}

export async function seatCounts(env, callId) {
  const rows = (await env.DB.prepare('SELECT state, stop_reason, COUNT(*) AS n FROM seats WHERE call_id = ? GROUP BY state, stop_reason').bind(callId).all()).results || [];
  const c = { waiting: 0, offered: 0, taken: 0, answered: 0, stopped: 0, declined: 0, missed: 0, withdrawn: 0 };
  for (const r of rows) {
    if (r.state === 'expired') c[r.stop_reason === 'declined' ? 'declined' : r.stop_reason === 'missed' ? 'missed' : 'withdrawn'] += r.n;
    else if (r.state === 'released') c.withdrawn += r.n;
    else c[r.state] = (c[r.state] || 0) + r.n;
  }
  const ev = await env.DB.prepare('SELECT SUM(CASE WHEN e.body_json LIKE \'{"missed_by"%\' OR e.body_json LIKE \'{"unreached"%\' THEN 1 ELSE 0 END) AS m, SUM(CASE WHEN e.body_json LIKE \'{"declined_by"%\' THEN 1 ELSE 0 END) AS d FROM events e JOIN seats s ON s.id = e.seat_id WHERE s.call_id = ?').bind(callId).first();
  c.missed += ev && ev.m ? ev.m : 0; c.declined += ev && ev.d ? ev.d : 0;
  // every offer ever made: each seat that reached a person, plus each time a seat went back and was offered again
  const everOffered = await env.DB.prepare('SELECT COUNT(*) AS n FROM seats WHERE call_id = ? AND (state IN (\'offered\',\'taken\',\'answered\',\'stopped\') OR (state = \'expired\' AND stop_reason IN (\'declined\',\'missed\')))').bind(callId).first();
  c.ever_offered = (everOffered ? everOffered.n : 0) + (ev && ev.m ? ev.m : 0) + (ev && ev.d ? ev.d : 0);
  return c;
}

// ---------- reading a call ----------

export async function getCallFor(env, key, callId) {
  const call = await env.DB.prepare('SELECT * FROM calls WHERE id = ?').bind(callId).first();
  // HTTP-1: another principal's call reads exactly as one that does not exist. A keyless call is read by its id alone (AUTH-5).
  if (!call || (call.principal_id !== key.principal_id && call.principal_id !== 'pr_anonymous')) throw notFixable(404, 'not_found', `No call ${callId} for this key.`);
  return call;
}

async function moneyOf(env, call) {
  const r = await env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN account = 'hold:' || call_id AND cents < 0 AND txn NOT LIKE 'release:%' THEN -cents ELSE 0 END),0) AS spent,
      COALESCE(SUM(CASE WHEN txn LIKE 'release:%' AND account LIKE 'avail:%' THEN cents ELSE 0 END),0) AS returned,
      COALESCE(SUM(CASE WHEN txn LIKE 'minfee:%' AND account = 'fees:router' THEN cents ELSE 0 END),0) AS minfee FROM ledger WHERE call_id = ?`).bind(call.id).first();
  const o = { held_usd: fmt(call.hold_cents), spent_usd: fmt(r.spent), returned_usd: fmt(r.returned), test_money: TEST_MONEY };
  if (r.minfee > 0) o.router_fee_minimum_usd = fmt(r.minfee);   // the call's minimum fee, beyond the seats' shares on their receipts
  return o;
}

function tallyOf(fields, rows) {
  const t = {};
  for (const [name, f] of Object.entries(fields)) {
    const vals = rows.map(r => r.answers[name]).filter(v => v !== undefined && v !== null && v !== '');
    if (f.type === 'boolean') t[name] = { true: vals.filter(v => v === true).length, false: vals.filter(v => v === false).length };
    else if (f.type === 'choice') { const o = {}; for (const ch of (f.choices || f.options || [])) o[ch] = 0; for (const v of vals) for (const x of (Array.isArray(v) ? v : [v])) o[x] = (o[x] || 0) + 1; t[name] = o; }
    else if (f.type === 'scale' || f.type === 'number') {
      const xs = vals.map(Number).filter(x => isFinite(x)).sort((a, b) => a - b);
      const med = xs.length ? (xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2) : null;
      t[name] = xs.length ? { n: xs.length, min: xs[0], median: med, max: xs[xs.length - 1] } : { n: 0 };
    } else t[name] = { n: vals.length };
  }
  return t;
}

export function ownPeopleSentence(request, keyless) {
  const api = apiBase(request);
  return `These answers are simulated; for real answers from your own people in about two minutes, ${keyless ? `make a free key (POST ${api}/v1/keys), then ` : ''}make a panel (POST ${api}/v1/panels with {"name": "my testers"}) and send its join_url to your testers, customers or players to join on their phones, then call with pool "panel:<panel_id>", free at zero pay.`;
}

function nextStep(status, s, call) {
  switch (status) {
    case 'held': return 'The call is held for a person to read; nobody is asked until it is allowed. Look again later, or cancel it.';
    case 'open':
      if (!s.answered) return `No answer yet: ${s.taken ? `${s.taken} ${s.taken === 1 ? 'person is' : 'people are'} in the call now` : s.offered_now ? `${s.offered_now} offered, waiting for ${s.offered_now === 1 ? 'a reply' : 'replies'}` : 'offers are going out'}. Look again after next_check_after_seconds.`;
      return `${s.answered} of ${call.people} answered so far; wait for more, or act on what is here.`;
    case 'enough': return `${s.answered} answers are in, enough to act on; up to ${call.people - s.answered} more may come before the deadline.`;
    case 'complete': return 'Every answer is in. Act on them, then tell the people what changed with the outcome operation.';
    case 'expired': return 'The deadline passed; the answers here stand and the unspent hold returns.';
    case 'cancelled': return 'The call was cancelled; answers that came in stand, and the unspent hold returns.';
    case 'refused': return 'The call was refused on review and cost nothing. Tell your user.';
    default: return '';
  }
}

async function summaryOf(env, call, spec, all, counts) {
  const answered = all.filter(r => r.status === 'answered');
  const ev = { attended: 0, said: 0, voiced: 0, said_because: {} };
  // every response delivered, answered or stopped (s13)
  for (const r of all) { ev[r.evidence] = (ev[r.evidence] || 0) + 1; if (r.evidence === 'said' && r.record.level_reason) ev.said_because[r.record.level_reason] = (ev.said_because[r.record.level_reason] || 0) + 1; }
  const s = { simulated: !!call.simulated || all.some(r => r.simulated), people: call.people, enough: call.enough,
    offered: counts.ever_offered, offered_now: counts.offered, taken: counts.taken, answered: counts.answered, stopped: counts.stopped, declined: counts.declined, missed: counts.missed, withdrawn: counts.withdrawn,
    evidence: ev, tally: tallyOf(spec.answer_fields, answered) };
  const scr = JSON.parse(call.screening_json || '{}');
  if (scr.would_hold_on_real_pool) { s.would_be_held = true; s.held_reason = scr.held_reason; }
  if (call.panel_id) { const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM members WHERE panel_id = ? AND left_at IS NULL').bind(call.panel_id).first(); if (n.n < 5) s.small_panel = true; }
  return s;
}

function responseOut(r, kind, detail, offer, jwsBySeat) {
  const rec = r.record || {};
  const o = { response_id: r.id, simulated: !!r.simulated, person_ref: r.person_ref, kind, status: rec.seat_status || 'answered', partial: !!r.partial,
    evidence: r.evidence, level_reason: rec.level_reason || null, answers: r.answers,
    answer_input: Object.fromEntries(Object.entries(r.input || {}).map(([k, v]) => [k, typeof v === 'string' ? v : (v && v.how) || 'typed'])),
    minutes: rec.observed && rec.observed.seat_seconds != null ? Math.round(rec.observed.seat_seconds / 6) / 10 : null,
    paid_usd: fmt(rec.paid_cents || 0), receipt_id: rec.receipt_id || null, received_at: iso(r.created_at) };
  if (rec.top_up_cents) o.top_up_usd = fmt(rec.top_up_cents);
  if (o.status === 'stopped') o.stop_reason = rec.stop_reason || 'stopped';
  if (detail === 'full') {
    o.record = { rule: rec.rule, observed: rec.observed, unobserved: rec.unobserved };
    if (rec.runner_claim) o.record.runner_claim = rec.runner_claim;
    o.offer = offer; o.claims = []; o.receipt_jws = (jwsBySeat && jwsBySeat[r.seat_id]) || null;
  }
  return o;
}

export function offerFor(call, spec, principalName, panelSize) {
  const items = spec.items || [];
  const bytes = items.reduce((a, i) => a + (i.bytes || 0), 0);
  const perHour = call.pay_cents > 0 ? fmt(Math.round(call.pay_cents * 60 / Math.max(0.5, spec.minutes))) : null;
  const recorded = { listen: ['how the sound played: pauses, skips, replays, how much played', 'whether the page was in front', 'your answers and how each was entered (typed, pasted or tapped)'],
    watch: ['how the video played: pauses, skips, replays, how much played, whether it was muted', 'whether the page was in front', 'your answers and how each was entered'],
    view: ['whether you showed the picture, and how long it was in view', 'how far you scrolled', 'your answers and how each was entered'],
    play: ['how long you played and how many inputs you made (not what they were)', 'your answers and how each was entered'],
    compare: ['the order the items were shown, and for each what is recorded for its kind', 'your answers and how each was entered'],
    answer: ['your answers and how each was entered'] }[spec.kind];
  return { answered_for: principalName, asker_is_ai: true, ask: call.ask, kind: spec.kind, minutes: spec.minutes, pay_per_person_usd: fmt(call.pay_cents),
    pay_per_hour_usd: perHour, unpaid: call.pay_cents === 0, content_rating: spec.content_rating || 'general', recorded, kept_days: 395,
    kept: { answers_days: 395, record_days: 30, recordings_days: 90, note: 'your answers up to 13 months, or until you delete them; the detailed record of what played 30 days' },
    download_bytes: bytes || null, may_train_on_answers: !!spec.may_train_on_answers, panel_size: call.panel_id ? panelSize : null };
}

export async function buildResult(env, request, call, { after = 0, detail = 'summary', person = null } = {}) {
  const spec = JSON.parse(call.spec_json);
  const all = ((await env.DB.prepare('SELECT * FROM responses WHERE call_id = ? ORDER BY seq').bind(call.id).all()).results || [])
    .map(r => { const record = JSON.parse(r.record_json); return { ...r, answers: JSON.parse(r.answers_json), input: JSON.parse(r.input_json), record, status: record.seat_status || 'answered' }; });
  const counts = await seatCounts(env, call.id);
  const status = liveStatus(call, nowMs(), counts);
  const fresh = all.filter(r => r.seq > after && (!person || r.person_ref === person || r.id === person));
  let offer = null, jwsBySeat = null;
  if (detail === 'full') {
    jwsBySeat = Object.fromEntries(((await env.DB.prepare('SELECT seat_id, signature FROM receipts WHERE call_id = ?').bind(call.id).all()).results || []).map(x => [x.seat_id, x.signature]));
    const p = await env.DB.prepare('SELECT id, name, class, team FROM principals WHERE id = ?').bind(call.principal_id).first();
    const n = call.panel_id ? (await env.DB.prepare('SELECT COUNT(*) AS n FROM members WHERE panel_id = ? AND left_at IS NULL').bind(call.panel_id).first()).n : null;
    offer = offerFor(call, spec, answeredFor(p, call), n);
  }
  const complete = !!call.closed_at || status === 'refused';
  const s = await summaryOf(env, call, spec, all, counts);
  let waitNote = null;
  if (call.panel_id && call.panel_id !== 'p_self' && ['open', 'enough'].includes(status) && counts.waiting > 0 && counts.offered === 0) {
    const pk = await env.DB.prepare('SELECT p.kind, pr.class AS pclass FROM panels p LEFT JOIN principals pr ON pr.id = p.principal_id WHERE p.id = ?').bind(call.panel_id).first();
    const { ownPanelsRingOpen } = await import('./panels.js');
    const pz = pk && pk.kind === 'private' && pk.pclass !== 'real' ? await env.DB.prepare('SELECT paused_at FROM panels WHERE id = ?').bind(call.panel_id).first() : null;
    if (pz && pz.paused_at) waitNote = { earliest_ring_at: null, next_step: 'Calls to your panels are paused while a person reads reports about them; nobody is asked meanwhile.' };
    else if (pk && pk.kind === 'private' && pk.pclass !== 'real' && !(await ownPanelsRingOpen(env)))
      waitNote = { earliest_ring_at: null, next_step: 'Nobody is asked yet: ringing people on a panel made with a test key opens once our last safety checks are done. Your people can join now; this call waits and is offered to them then.' };
  }
  if (!waitNote && call.panel_id && call.panel_id !== 'p_self' && ['open', 'enough'].includes(status) && counts.waiting > 0 && counts.offered === 0) {
    const { panelOutlook } = await import('./rings.js');
    const o = await panelOutlook(env, call.panel_id, nowMs());
    // PEOPLE-8: a person is offered a call once; when everyone left on the panel has declined, missed or taken it, say so
    const fresh = await env.DB.prepare(`SELECT COUNT(*) AS n FROM members m WHERE m.panel_id = ? AND m.left_at IS NULL
        AND m.id NOT IN (SELECT COALESCE(offered_to, '') FROM seats WHERE call_id = ? AND offered_to IS NOT NULL)
        AND m.id NOT IN (SELECT COALESCE(member_id, '') FROM seats WHERE call_id = ? AND member_id IS NOT NULL)
        AND m.id NOT IN (SELECT COALESCE(json_extract(e.body_json, '$.declined_by'), json_extract(e.body_json, '$.missed_by'), '') FROM events e JOIN seats s2 ON s2.id = e.seat_id
                         WHERE s2.call_id = ? AND (e.body_json LIKE '{"declined_by"%' OR e.body_json LIKE '{"missed_by"%'))`).bind(call.panel_id, call.id, call.id, call.id).first();
    if (call.reported_at) waitNote = { next_step: 'Someone who was asked reported this call; nobody new is asked while the operator reads it.', earliest_ring_at: null };
    else if (fresh && fresh.n === 0) waitNote = { earliest_ring_at: null, next_step: `Everyone on the panel has been offered this call (each person is asked once), and nobody else can be: ${counts.answered} answered, ${counts.declined + counts.missed} declined or let it pass. Act on what is here, or cancel to return the rest of the hold.` };
    else if (!o.on_now) waitNote = { earliest_ring_at: o.earliest_ring_at ? iso(o.earliest_ring_at) : null,
      next_step: o.earliest_ring_at ? `Nobody on the panel can be asked right now (${o.quiet} in quiet hours, ${o.off} Off). The first offer can go at ${iso(o.earliest_ring_at)}; look again then.` : `Nobody on the panel can be asked right now: ${o.off} of ${o.members} are Off. Offers go out when someone switches On.` };
  }
  const out = {
    call_id: call.id, status, complete, deadline: iso(call.deadline_at),
    summary: s,
    responses: fresh.map(r => responseOut(r, spec.kind, detail, offer, jwsBySeat)),
    money: await moneyOf(env, call),
    cursor: String(all.length ? all[all.length - 1].seq : after),
    next_check_after_seconds: complete ? null : (status === 'held' ? 300 : (call.simulated ? (spec.pace === 'human' ? 30 : 2) : 30)),
    next_step: waitNote ? waitNote.next_step : nextStep(status, s, call),
    test_money: TEST_MONEY,
  };
  // OWNER_all_6 item 1: an agent on a test key (or none) that gets simulated answers is told, in one sentence, how its user gets
  // real answers from their own people
  if (s.simulated && call.pool === 'simulated') {
    const kr = await env.DB.prepare('SELECT class, team FROM keys WHERE id = ?').bind(call.key_id).first().catch(() => null);
    if (call.key_id === 'k_anonymous' || (kr && kr.class === 'test' && !kr.team)) out.real_people = ownPeopleSentence(request, call.key_id === 'k_anonymous');
  }
  if (waitNote) { out.earliest_ring_at = waitNote.earliest_ring_at; if (waitNote.earliest_ring_at && !complete) out.next_check_after_seconds = Math.max(30, Math.min(300, Math.round((Date.parse(waitNote.earliest_ring_at) - nowMs()) / 1000))); }
  if (call.status === 'held') { const scr = JSON.parse(call.screening_json || '{}'); out.held_reason = scr.held_reason; out.held_rule = scr.held_rule; out.review_by = scr.review_by; }
  if (call.status === 'refused') { const scr = JSON.parse(call.screening_json || '{}'); if (scr.held_reason) out.refused_reason = scr.held_reason; }
  { const scr = JSON.parse(call.screening_json || '{}'); if (scr.hold_fix && (call.status === 'held' || scr.would_hold_on_real_pool)) out.ext = { ...(out.ext || {}), hold: scr.hold_fix }; }
  return out;
}

// The call as returned by POST /v1/calls, GET /v1/calls/{id} and cancel (section 19).
export async function callObject(env, request, call) {
  const spec = JSON.parse(call.spec_json);
  const r = await buildResult(env, request, call, { after: 1e9 });
  const o = {
    call_id: call.id, status: r.status, created_at: iso(call.created_at), deadline: iso(call.deadline_at),
    call: callOut(spec), defaults_used: JSON.parse(call.defaults_json), quote: JSON.parse(call.quote_json),
    summary: r.summary, money: r.money, simulated: !!call.simulated, test_money: TEST_MONEY, complete: r.complete,
    next_check_after_seconds: r.next_check_after_seconds, next_step: r.next_step,
    how_to_get_answers: `GET /v1/calls/${call.id}/responses?wait_seconds=20 (tool: ${(BUILD.names && BUILD.names.tool) || 'ask_people'}_results with call_id "${call.id}")`,
  };
  if (r.earliest_ring_at !== undefined) o.earliest_ring_at = r.earliest_ring_at;   // MONEY-11: the call says the same time as its results
  if (call.status === 'held') { o.held_reason = r.held_reason; o.held_rule = r.held_rule; o.review_by = r.review_by; o.charged_usd = '0.00'; o.anyone_asked = false; }
  if (r.ext && r.ext.hold) o.ext = { ...(o.ext || {}), hold: r.ext.hold };
  o.outcomes = JSON.parse(call.outcomes_json || '[]').map(x => ({ text: x.text, status: x.status, at: x.at }));
  if (call.principal_id === 'pr_anonymous') o.note = 'Opened without a key: anyone holding this call_id can read, cancel or send an outcome for it. Make a key with POST /v1/keys to keep calls to yourself.';
  return o;
}

export async function results(env, request, key, callId, { after = 0, wait = 0, detail = 'summary', person = null } = {}) {
  let call = await getCallFor(env, key, callId);
  if (!['summary', 'full'].includes(detail)) throw fixable('invalid_field', 'detail', 'detail is "summary" or "full".', 'summary');
  const started = Date.now();
  wait = Math.max(0, Math.min(25, Number(wait) || 0));
  after = Math.max(0, parseInt(String(after).replace(/^r/, ''), 10) || 0);
  let firstStatus = null;
  for (;;) {
    await settle(env, request, { callId });
    call = await env.DB.prepare('SELECT * FROM calls WHERE id = ?').bind(callId).first();
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM responses WHERE call_id = ? AND seq > ?').bind(callId, after).first();
    const st = liveStatus(call, nowMs(), null);
    if (firstStatus === null) firstStatus = st;
    if (n.n > 0 || call.closed_at || st !== firstStatus || ['held', 'refused'].includes(st)) break;
    const left = wait * 1000 - (Date.now() - started) - 800;
    if (left <= 0) break;
    const nextDue = await env.DB.prepare('SELECT MIN(due_at) AS d FROM seats WHERE call_id = ? AND due_at IS NOT NULL').bind(callId).first();
    const gap = nextDue && nextDue.d ? Math.max(250, nextDue.d - Date.now() + 50) : 2000;
    await sleep(Math.min(gap, 2500, left));
  }
  const out = await buildResult(env, request, call, { after, detail, person });
  { const sl = await (await import('./strangers.js')).strangersLineFor(env, request, key); if (sl) out.strangers_status = sl; }   // the CEO 5:55: the promise kept
  return out;
}

export async function cancelCall(env, request, key, callId) {
  const call = await getCallFor(env, key, callId);
  const now = nowMs();
  if (!call.closed_at) {
    if (call.status === 'held') {
      await env.DB.batch([
        env.DB.prepare('UPDATE calls SET status = \'cancelled\', cancelled_at = ?, closed_at = ? WHERE id = ? AND status = \'held\'').bind(now, now, callId),
        env.DB.prepare('UPDATE held_calls SET decided = \'cancelled by the asker\', released_at = ? WHERE call_id = ?').bind(now, callId)]);
    } else if (now < call.deadline_at && call.status === 'open') {
      const c = await seatCounts(env, callId);
      if (c.answered < call.people) {
        await env.DB.prepare('UPDATE calls SET status = \'cancelled\', cancelled_at = ? WHERE id = ? AND status = \'open\'').bind(now, callId).run();
        // nobody new: open offers are withdrawn. A person inside may finish (STATE-5); simulated people inside finish now.
        await env.DB.prepare('UPDATE seats SET state = \'released\', stop_reason = \'withdrawn\', due_at = NULL, offered_to = NULL WHERE call_id = ? AND state IN (\'waiting\',\'offered\')').bind(callId).run();
      }
    }
  }
  await settle(env, request, { callId });
  return callObject(env, request, await env.DB.prepare('SELECT * FROM calls WHERE id = ?').bind(callId).first());
}

// ---------- the outcome line (section 15.2) ----------

export async function outcome(env, request, key, callId, body, ipHash, screenOutcome) {
  const call = await getCallFor(env, key, callId);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fixable('invalid_json', null, 'The body is {"text": "...", "idempotency_key": "..."}.', null);
  for (const k of Object.keys(body)) if (!['text', 'idempotency_key', 'ext'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not a field of this operation; it takes text and idempotency_key.`, null);
  const text = body.text;
  if (typeof text !== 'string' || !text.trim() || text.length > 280 || /[\r\n]/.test(text)) throw fixable(text === undefined ? 'missing_field' : 'invalid_field', 'text', 'text is one line of at most 280 characters saying what you did with the answers.', 'We moved the chorus earlier because most of you drifted at 40 seconds.');
  const now = nowMs();
  const scope = key.anon ? 'anon:' + ipHash : key.id;
  const reqHash = await sha256hex(canonical({ call: callId, text }));
  const op = 'outcome:' + callId;
  const idem = body.idempotency_key || await autoIdemKey(env, scope, op, reqHash, now);
  const prior = await env.DB.prepare('SELECT request_hash, status, response_json FROM idempotency WHERE key_id = ? AND op = ? AND idem_key = ?').bind(scope, op, idem).first();
  if (prior) {
    if (prior.request_hash !== reqHash) throw fixable('idempotency_key_reused', 'idempotency_key', 'This idempotency_key was already used with a different line.', 'outcome-' + rid('', 6), {}, 409);
    const r = JSON.parse(prior.response_json); if (prior.status >= 400) throw new CallError(prior.status, r); return r;   // IDEM-2: the same body
  }
  // the same line again (under any key) is the same line, not a new one
  const already = JSON.parse((await env.DB.prepare('SELECT outcomes_json FROM calls WHERE id = ?').bind(callId).first()).outcomes_json || '[]').find(o => o.text === text);
  if (already) { const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM seats WHERE call_id = ? AND state IN (\'answered\',\'stopped\')').bind(callId).first()).n; return { status: already.status, people: already.status === 'delivered' ? n : 0 }; }
  const sent = { n: JSON.parse((await env.DB.prepare('SELECT outcomes_json FROM calls WHERE id = ?').bind(callId).first()).outcomes_json || '[]').length };
  const seats = (await env.DB.prepare('SELECT * FROM seats WHERE call_id = ? AND state IN (\'answered\',\'stopped\')').bind(callId).all()).results || [];
  if (!seats.length) throw notFixable(409, 'outcome_not_allowed', 'Nobody has answered this call yet, so there is nobody to tell. Send the line once answers are in.');
  if (sent.n >= 3) throw notFixable(409, 'outcome_not_allowed', 'This call has had its three outcome lines. Stop here.');
  let s;
  try { s = screenOutcome ? await screenOutcome(text, { pool_real: !call.simulated, ...(await screenTerms(env)) }) : { decision: 'HOLD' }; } catch { s = { decision: 'HOLD' }; }
  const decision = s && ['ALLOW', 'REFUSE', 'HOLD'].includes(s.decision) ? s.decision : 'HOLD';
  if (decision === 'REFUSE') {
    const er = s.error || {};
    throw new CallError(422, { code: 'refused_screening', status: 422, fixable: !!er.fixable, rule: er.rule || s.rule || null, category: er.category || s.category || null,
      rule_text: er.rule_text || s.rule_text || null, message: er.message || 'Screening refused this line.', field: er.fixable ? 'text' : undefined, example: er.fixable ? (typeof er.example === 'string' ? er.example : null) : undefined });
  }
  let out;
  const lines = JSON.parse((await env.DB.prepare('SELECT outcomes_json FROM calls WHERE id = ?').bind(callId).first()).outcomes_json || '[]');
  if (decision === 'HOLD') {
    out = { status: 'held', people: 0, note: 'Held for a person to read before anyone sees it.' };
    const before = (await env.DB.prepare('SELECT outcomes_json FROM calls WHERE id = ?').bind(callId).first()).outcomes_json;
    lines.push({ text, status: 'held', at: iso(now) });
    const cas = await env.DB.prepare('UPDATE calls SET outcomes_json = ? WHERE id = ? AND outcomes_json IS ?').bind(JSON.stringify(lines), callId, before).run();
    if (cas.meta.changes !== 1) throw notFixable(409, 'outcome_not_allowed', 'Another outcome line for this call arrived at the same moment; send yours again.');
  } else {
    // shown beside each receipt: each receipt is issued again with the line added to outcomes and rev one higher (OUT-2)
    const before = (await env.DB.prepare('SELECT outcomes_json FROM calls WHERE id = ?').bind(callId).first()).outcomes_json;
    // how many had answered when the line was sent, so a person's page can say 'to the 3 people who answered' (runner, 8:13)
    const answeredN = (await env.DB.prepare('SELECT COUNT(*) AS n FROM seats WHERE call_id = ? AND state = \'answered\'').bind(callId).first()).n;
    lines.push({ text, status: 'delivered', at: iso(now), people: answeredN });
    const cas = await env.DB.prepare('UPDATE calls SET what_changed = ?, what_changed_at = ?, outcomes_json = ? WHERE id = ? AND outcomes_json IS ?').bind(text, now, JSON.stringify(lines), callId, before).run();
    if (cas.meta.changes !== 1) throw notFixable(409, 'outcome_not_allowed', 'Another outcome line for this call arrived at the same moment; send yours again.');
    const st = [];
    const rcs = (await env.DB.prepare('SELECT * FROM receipts WHERE call_id = ?').bind(callId).all()).results || [];
    for (const rc of rcs) {
      const p = JSON.parse(rc.body_json); const np = { ...p, rev: (p.rev || 1) + 1, issued_at: iso(now), outcomes: [...(p.outcomes || []), { text, at: iso(now) }] }; delete np.outcome;
      const signed = await signJws(env, np);
      st.push(env.DB.prepare('UPDATE receipts SET body_json = ?, signature = ?, key_id = ? WHERE id = ?').bind(JSON.stringify(np), signed.jws, signed.kid, rc.id));
    }
    if (st.length) await env.DB.batch(st);
    out = { status: 'delivered', people: seats.length };
    const ms = (await env.DB.prepare('SELECT m.* FROM members m JOIN seats s ON s.member_id = m.id WHERE s.call_id = ? AND s.state IN (\'answered\',\'stopped\') AND m.push_json IS NOT NULL AND m.left_at IS NULL').bind(callId).all()).results || [];
    for (const m of ms) await ringMember(env, m);
  }
  await env.DB.prepare('INSERT OR IGNORE INTO idempotency (key_id, op, idem_key, request_hash, status, response_json, created_at) VALUES (?,?,?,?,?,?,?)').bind(scope, op, idem, reqHash, 200, JSON.stringify(out), now).run();
  return out;
}
