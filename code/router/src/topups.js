// Top-ups (B6), against a stand-in: no card processor is connected in the preview (PLAN s11 step 2 is the operator's switch).
// POST /v1/topups starts one and returns a stand-in hosted page; POST /v1/topups/webhook takes the processor's events,
// signed the way the processor signs them (Stripe-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "t.raw_body")>).
// Rules (trust's money/card_flow/fixtures.json, money/PAYMENTS_BY_STEP.md):
//  1. a missing or wrong signature, or a timestamp more than 300 s from our clock, is refused (400), nothing moves;
//  2. a balance is credited once per event (a repeat is a no-op), in one ledger posting that sums to zero;
//  3. a refund returns the unspent balance to the card; a dispute freezes up to the disputed amount from what is left;
//  4. no first top-up over $200.00, no more than $2,000.00 held by a principal (available, held for calls and frozen
//     together) and no more than $2,000.00 credited in a day: such a payment is refused (owed back), never credited (T6);
//  5. only a session this server started, still open, for the same principal and amount, is credited (T7);
//  6. if crediting fails, the event is not kept as handled, so the processor's retry credits it once (T5).
import { rid, nowMs, iso, fmt, siteBase } from './util.js';
import { fixable, notFixable } from './spec.js';
import { posting, balance, isDuplicatePosting } from './money.js';

const FIRST_LIMIT = 20000, BALANCE_LIMIT = 200000, MIN_TOPUP = 5000;
const enc = new TextEncoder();

async function hmacHexOf(secret, text) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function startTopup(env, request, key, body) {
  if (env.CARD_PROCESSOR !== 'on') throw fixable('unsupported_feature', 'amount_usd', 'Top-ups are not open yet: no card processor is connected in the preview, and nothing is charged. Every key holds test money (a new test key starts with 100.00).', null);
  if (!key) throw fixable('unauthorized', 'Authorization', 'A top-up needs a key: send "Authorization: Bearer <key>".', 'Bearer test_...', {}, 401);
  for (const k of Object.keys(body || {})) if (k !== 'amount_usd') throw fixable('unknown_field', k, `"${k}" is not a field here; send amount_usd.`, null);
  const cents = Math.round(parseFloat(body && body.amount_usd) * 100);
  if (!(cents >= MIN_TOPUP && cents <= FIRST_LIMIT)) throw fixable('invalid_field', 'amount_usd', 'A top-up is 50.00 to 200.00 in the preview (a first top-up is at most 200.00, and a balance at most 2,000.00).', '50.00');
  const id = 'cs_test_' + rid('', 24);
  try { await env.DB.prepare('INSERT INTO topups (id, principal_id, amount_cents, status, created_at, updated_at) VALUES (?,?,?,?,?,?)').bind(id, key.principal_id, cents, 'open', nowMs(), nowMs()).run(); }
  catch (e) { throw fixable('unsupported_feature', 'amount_usd', 'Top-ups are not open yet: every key holds test money, and a test key starts with 100.00. Make a new test key with POST /v1/keys if you need more.', null); }
  return { topup_id: id, amount_usd: fmt(cents), checkout_url: siteBase(request) + '/topup?session=' + encodeURIComponent(id), status: 'open', test_money: true,
    note: 'No card processor is connected in the preview: this page is a stand-in, and nothing is charged. A paid top-up credits the balance once the processor confirms it.' };
}

function parseSig(h) {
  const out = {}; for (const part of String(h || '').split(',')) { const [k, v] = part.split('='); if (k && v) (out[k.trim()] = out[k.trim()] || []).push(v.trim()); }
  return { t: out.t ? Number(out.t[0]) : NaN, v1: out.v1 || [] };
}

// The one place events are judged. scope keeps a check's events and accounts apart from real ones (the fixture run).
// T8: the fixtures' secret is public (money/card_flow/make_fixtures.py); as the live secret it would let anyone sign a payment.
const FIXTURE_SECRET = 'whsec_test_fixture_only_not_a_real_key';

export async function applyEvent(env, raw, sigHeader, { nowSec, secret, scope = '' }) {
  if (!scope && secret === FIXTURE_SECRET) secret = null;   // only the fixture run, in its own scope, may use it
  if (!secret) return { status: 400, body: { code: 'invalid_json', status: 400, fixable: false, message: 'Webhooks are not set up here.' } };
  const sig = parseSig(sigHeader);
  if (!isFinite(sig.t) || !sig.v1.length) return { status: 400, body: { code: 'invalid_field', status: 400, fixable: false, message: 'Missing signature.' } };
  const want = await hmacHexOf(secret, `${sig.t}.${raw}`);
  if (!sig.v1.includes(want)) return { status: 400, body: { code: 'invalid_field', status: 400, fixable: false, message: 'The signature does not match.' } };
  if (Math.abs(nowSec - sig.t) > 300) return { status: 400, body: { code: 'invalid_field', status: 400, fixable: false, message: 'The timestamp is more than 300 seconds from our clock (a replay).' } };
  let ev; try { ev = JSON.parse(raw); } catch { return { status: 400, body: { code: 'invalid_json', status: 400, fixable: false, message: 'Not JSON.' } }; }
  const evId = scope + String(ev.id || '');
  const o = (ev.data && ev.data.object) || {};
  const now = nowMs();
  // once per event id: a repeat is answered 200 and moves nothing
  const first = await env.DB.prepare('INSERT OR IGNORE INTO processor_events (id, type, received_at, outcome) VALUES (?,?,?,?)').bind(evId, String(ev.type || ''), now, 'received').run();
  if (first.meta.changes !== 1) return { status: 200, body: { received: true, outcome: 'already handled', balance_change_usd: '0.00' } };
  const done = async (outcome, extra = {}) => { await env.DB.prepare('UPDATE processor_events SET outcome = ? WHERE id = ?').bind(outcome, evId).run(); return { status: 200, body: { received: true, outcome, ...extra } }; };
  try { return await judge(env, ev, evId, scope, now, done); }
  catch (e) {   // T5: a failure leaves no trace of the event, so the processor's retry is judged afresh
    try { await env.DB.prepare('DELETE FROM processor_events WHERE id = ?').bind(evId).run(); } catch { }
    throw e;
  }
}

async function judge(env, ev, evId, scope, now, done) {
  const o = (ev.data && ev.data.object) || {};
  const acct = (pr) => ({ account: 'avail:' + scope + pr, floor0: 1 });
  const card = { account: 'card:processor' + (scope ? ':' + scope.replace(/:$/, '') : ''), floor0: 0 };

  if (ev.type === 'checkout.session.completed') {
    const cents = Number(o.amount_total) || 0;
    // T7: only a session this server started, still open, for the same principal and amount
    const ours = o.id ? await env.DB.prepare('SELECT * FROM topups WHERE id = ?').bind(scope + o.id).first() : null;
    if (!ours) return done('ignored: a session this server did not start', { balance_change_usd: '0.00' });
    if (ours.status !== 'open') return done(`ignored: the session is ${ours.status}, not open`, { balance_change_usd: '0.00' });
    const pr = ours.principal_id.slice(scope.length);
    const named = (o.metadata && o.metadata.principal_id) || o.client_reference_id;
    if ((named && named !== pr) || cents !== ours.amount_cents) return done('ignored: the event does not match the session we started', { balance_change_usd: '0.00' });
    if (o.payment_status !== 'paid') return done('pending: not paid yet', { balance_change_usd: '0.00' });
    const paidBefore = await env.DB.prepare('SELECT COUNT(*) AS n FROM topups WHERE principal_id = ? AND status IN (\'paid\', \'refunded\')').bind(scope + pr).first();
    // T6: what the principal holds here (available, held for calls, frozen), and what was credited in the last day
    const bal = await balance(env.DB, acct(pr).account);
    const frozen = await balance(env.DB, 'frozen:' + scope + pr);
    let held = 0;
    if (!scope) { try { held = (await env.DB.prepare('SELECT COALESCE(SUM(b.cents), 0) AS c FROM balances b JOIN calls c ON b.account = \'hold:\' || c.id WHERE c.principal_id = ?').bind(pr).first()).c; } catch { held = 0; } }
    const day = await env.DB.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS c FROM topups WHERE principal_id = ? AND status IN (\'paid\', \'refunded\') AND updated_at > ?').bind(scope + pr, now - 86400000).first();
    if ((paidBefore.n === 0 && cents > FIRST_LIMIT) || bal + held + frozen + cents > BALANCE_LIMIT || day.c + cents > BALANCE_LIMIT) {
      await env.DB.prepare('UPDATE topups SET status = \'refused\', payment_intent = ?, updated_at = ? WHERE id = ?').bind(o.payment_intent || null, now, scope + o.id).run();
      return done('refused over the limit: owed back to the card', { balance_change_usd: '0.00' });
    }
    try {
      await env.DB.batch([
        ...posting(env.DB, 'topup:' + scope + o.id, [{ ...card, cents: -cents }, { ...acct(pr), cents }], null, 'a top-up, paid', now),
        env.DB.prepare('UPDATE topups SET status = \'paid\', payment_intent = ?, updated_at = ? WHERE id = ?').bind(o.payment_intent || null, now, scope + o.id),
      ]);
    } catch (e) { if (isDuplicatePosting(e)) return done('already credited', { balance_change_usd: '0.00' }); throw e; }
    return done('credited', { balance_change_usd: fmt(cents) });
  }
  if (ev.type === 'charge.refunded') {
    const t = await env.DB.prepare('SELECT * FROM topups WHERE payment_intent = ? AND status IN (\'paid\',\'refunded\') AND id LIKE ?').bind(o.payment_intent || '', scope + '%').first();
    const pr = t ? t.principal_id.slice(scope.length) : ((o.metadata && o.metadata.principal_id) || null);
    if (!pr) return done('ignored: unknown charge', { balance_change_usd: '0.00' });
    const want = Number(o.amount_refunded) || 0;
    const already = await env.DB.prepare('SELECT COALESCE(SUM(cents), 0) AS c FROM ledger WHERE txn LIKE ? AND account = ?').bind('refund:' + scope + (o.id || '') + ':%', card.account).first();
    const amount = Math.min(Math.max(0, want - already.c), await balance(env.DB, acct(pr).account));   // only the unspent balance goes back
    if (amount <= 0) return done('nothing left to refund', { balance_change_usd: '0.00' });
    await env.DB.batch(posting(env.DB, 'refund:' + scope + (o.id || '') + ':' + evId, [{ ...acct(pr), cents: -amount }, { ...card, cents: amount }], null, 'a refund to the card', now));
    return done('refunded', { balance_change_usd: fmt(-amount) });
  }
  if (ev.type === 'charge.dispute.created') {
    const t = await env.DB.prepare('SELECT * FROM topups WHERE payment_intent = ? AND id LIKE ?').bind(o.payment_intent || '', scope + '%').first();
    if (!t) return done('ignored: unknown charge', { frozen_usd: '0.00' });
    const pr = t.principal_id.slice(scope.length);
    const amount = Math.min(Number(o.amount) || 0, await balance(env.DB, acct(pr).account));   // what is left; money paid to people stays paid
    if (amount <= 0) return done('nothing left to freeze', { frozen_usd: '0.00' });
    await env.DB.batch(posting(env.DB, 'dispute:' + evId, [{ ...acct(pr), cents: -amount }, { account: 'frozen:' + scope + pr, floor0: 1, cents: amount }], null, 'frozen while a dispute is open', now));
    return done('frozen', { frozen_usd: fmt(amount) });
  }
  return done('ignored: an event this server does not use', {});
}

// Trust's nine fixtures, through the same function, with their own clock and a scope of their own (never real accounts).
export async function runFixtures(env, fixtures) {
  const scope = 'fx' + rid('', 8) + ':';
  const secret = FIXTURE_SECRET;   // a test value written in money/card_flow/make_fixtures.py
  const out = [];
  for (const c of fixtures.cases || []) {   // T7: the sessions a principal started, as startTopup writes them (first body per session)
    let ev; try { ev = JSON.parse(c.raw_body); } catch { continue; }
    const o = (ev.data && ev.data.object) || {};
    if (ev.type !== 'checkout.session.completed' || !o.id) continue;
    const pr = (o.metadata && o.metadata.principal_id) || o.client_reference_id || 'pr_fixture_principal';
    await env.DB.prepare('INSERT OR IGNORE INTO topups (id, principal_id, amount_cents, status, created_at, updated_at) VALUES (?,?,?,?,?,?)').bind(scope + o.id, scope + pr, Number(o.amount_total) || 0, 'open', nowMs(), nowMs()).run();
  }
  for (const c of fixtures.cases || []) {
    const before = await balance(env.DB, 'avail:' + scope + 'pr_fixture_principal');
    const r = await applyEvent(env, c.raw_body, c.headers['Stripe-Signature'], { nowSec: fixtures.clock_unix, secret, scope });
    const after = await balance(env.DB, 'avail:' + scope + 'pr_fixture_principal');
    const change = fmt(after - before);
    const ex = c.expect || {};
    const ok = r.status === ex.status && (ex.balance_change_usd === undefined || ex.balance_change_usd === change) && (ex.frozen_usd === undefined || ex.frozen_usd === (r.body.frozen_usd || '0.00'));
    out.push({ name: c.name, ok, status: r.status, balance_change_usd: change, frozen_usd: r.body.frozen_usd, outcome: r.body.outcome || r.body.message });
  }
  const l = await env.DB.prepare('SELECT COALESCE(SUM(cents), 0) AS s FROM ledger').first();
  return { scope, pass: out.length === 9 && out.every(x => x.ok) && l.s === 0, ledger_sum_cents: l.s, cases: out, ran: out.length };
}
