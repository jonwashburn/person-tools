// Checks of the fences in the LIVE code, without ringing anyone (bin/baseline calls POST /internal/selftest).
// Each line exercises the same function the call path uses.
import { runScreening, gate } from './screen_gate.js';
import { ringDecision } from './rings.js';
import { observedFromBatches, levelFor } from './evidence.js';
import { requireListedReal } from './panels.js';
import { CallError } from './spec.js';
import { posting } from './money.js';

const SPEC = { ask: 'Listen once.', kind: 'listen', content: ['m_sample_melody30'], answer_fields: { answer: { type: 'text' } }, pool: 'panel:x', people: 1, pay_cents: 0, estimated_minutes: 2, content_rating: 'general', deadline_minutes: 30 };

export async function selftest(env, request) {
  const lines = [];
  const add = (name, pass, detail) => lines.push({ name, pass: !!pass, detail });

  // screening fails closed for anything that can reach a real person
  const cases = [
    ['missing module', { MISSING: true }],
    ['module throws', { screen: () => { throw new Error('boom'); } }],
    ['module times out', { screen: () => new Promise(() => {}) }],
    ['unknown answer', { screen: () => ({ decision: 'MAYBE' }) }],
    ['explicit HOLD', { screen: () => ({ decision: 'HOLD', rule: 'needs_review' }) }],
  ];
  for (const [n, mod] of cases) {
    const r = await runScreening(SPEC, {}, mod);
    add(`screening ${n} -> HOLD for a real_ key`, gate(r, { canReachReal: true }) === 'hold', r.decision);
  }
  const ref = await runScreening(SPEC, {}, { screen: () => ({ decision: 'REFUSE', rule: 'x', fixable: false }) });
  add('screening REFUSE -> refused for every key', gate(ref, { canReachReal: false }) === 'refuse' && gate(ref, { canReachReal: true }) === 'refuse', ref.decision);
  const err = await runScreening({ ...SPEC, ask: '[TEST: screening error] listen' }, {}, { screen: () => ({ decision: 'ALLOW' }) });
  add('a call whose screening errors ends HOLD for a real_ key', gate(err, { canReachReal: true }) === 'hold', err.decision);

  // the two classes of key
  let refused = false; try { requireListedReal({ class: 'test' }, 'Making a panel'); } catch (e) { refused = e instanceof CallError && e.status === 403; }
  add('a test_ key cannot make a panel, issue a join link or upload', refused, 'real_key_required');

  // ringing rules (pure decision on a made-up member; nobody is rung)
  const base = { on_state: 'on', tz: 'America/Chicago', quiet_start: 21, quiet_end: 8, is_real: 1, last_ring_at: null, left_at: null };
  const at = (h) => { const d = new Date('2026-11-14T00:00:00-06:00'); return d.getTime() + h * 3600000; };   // CT hours
  add('no ring in quiet hours (3 AM local)', !ringDecision(base, at(3), []).ok, ringDecision(base, at(3), []).why);
  add('a ring at 2 PM local when On', ringDecision(base, at(14), []).ok, 'ok');
  add('no ring when Off', !ringDecision({ ...base, on_state: 'off' }, at(14), []).ok, 'off');
  add('On for a time ends by itself', !ringDecision({ ...base, on_state: 'on_until', on_until: at(13) }, at(14), []).ok, 'on_until passed');
  add('at most one ring to a real person in 30 minutes', !ringDecision({ ...base, last_ring_at: at(14) - 10 * 60000 }, at(14), []).ok, 'one_real_ring_in_30_minutes');
  add('at most four rings an hour to a person', !ringDecision({ ...base, last_ring_at: at(14) - 31 * 60000 }, at(14), [at(14) - 31 * 60000, at(14) - 35 * 60000, at(14) - 40 * 60000, at(14) - 50 * 60000]).ok, 'four_an_hour');

  // the evidence rule (chief D10)
  const play = (rate, hiddenS) => {
    const ev = [{ seq: 1, t: 0, type: 'play', pos: 0 }]; let seq = 2;
    for (let s = 5; s <= 30; s += 5) ev.push({ seq: seq++, t: (s / rate) * 1000, type: 'timeupdate', pos: s });
    ev.push({ seq: seq++, t: (30 / rate) * 1000 + 10, type: 'ended', pos: 30 });
    if (hiddenS) { ev.push({ seq: seq++, t: 2000, type: 'hidden' }); ev.push({ seq: seq++, t: 2000 + hiddenS * 1000, type: 'visible' }); ev.sort((a, b) => a.t - b.t); ev.forEach((e, i) => e.seq = i + 1); }
    return ev;
  };
  const t0 = 1_000_000;
  const lvl = (events, at) => { const o = observedFromBatches('listen', [{ body_json: JSON.stringify({ events }), received_at: at }], 30, t0, at + 500); return { o, ...levelFor('listen', o) }; };
  const att = lvl(play(1), t0 + 31000);
  add('30 s played in real time, visible -> attended (listen/1)', att.level === 'attended', att.o);
  const fast = lvl(play(2), t0 + 16000);
  add('played at double speed -> said', fast.level === 'said', fast.reason);
  const hid = lvl(play(1, 10), t0 + 31000);
  add('page hidden 10 s of 30 -> said', hid.level === 'said', hid.reason);
  const short = lvl(play(1).slice(0, 4), t0 + 31000);
  add('stopped at 15 of 30 s -> said', short.level === 'said', short.reason);

  // money: the ledger and the balances each sum to zero
  const l = await env.DB.prepare('SELECT COALESCE(SUM(cents),0) AS s FROM ledger').first();
  const b = await env.DB.prepare('SELECT COALESCE(SUM(cents),0) AS s FROM balances').first();
  const neg = await env.DB.prepare('SELECT COUNT(*) AS n FROM balances WHERE floor0 = 1 AND cents < 0').first();
  add('the ledger sums to zero', l.s === 0, l.s);
  add('the balances sum to zero', b.s === 0, b.s);
  add('no guarded balance is below zero', neg.n === 0, neg.n);
  // the guard is a constraint that fails, not a WHERE that matches nothing
  let guarded = false;
  try { await env.DB.batch(posting(env.DB, 'selftest:' + Date.now(), [{ account: 'selftest:nobody', floor0: 1, cents: -1 }, { account: 'selftest:sink', floor0: 0, cents: 1 }], null, 'selftest: must fail', Date.now())); }
  catch (e) { guarded = /CHECK constraint failed/.test(String(e.message)); }
  add('a debit past zero fails the whole batch (CHECK constraint)', guarded, guarded ? 'refused by the database' : 'NOT refused');

  return { pass: lines.every(x => x.pass), lines };
}
