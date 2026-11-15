// Money: the price formula, the quote's lines, and double-entry postings.
// Every amount is integer cents. Every posting's lines sum to zero, and it goes to the database in ONE batch together with
// the state change it pays for. Two constraints are the guard (never a WHERE that can silently match nothing):
//   balances: CHECK (floor0 = 0 OR cents >= 0)  -> a debit past zero fails the whole batch;
//   ledger:   UNIQUE (txn, line)                 -> the same money event posted twice fails the whole batch.
import { fmt } from './util.js';

// WORKING price (PLAN.md section 7; trust's money/PRICE.md and market's canon replace these numbers when they exist).
export const PRICE = {
  router_fee_rate: 0.10,
  router_fee_min_cents: 25,
  reserve_rate: 0.25,          // held for people who take longer than estimated; returned if unused
  pay_floor_cents_per_hour: 1800,
  pay_floor_min_cents: 100,
  test_grant_cents: 10000,     // a new test principal's starting test money
};

import TERMS from './canon_terms.json';
// The terms an asker reads come from the canon (canon/canon.json offer.terms) so no surface can drift; the text below is
// only the fallback when the build had no canon.
export const TERMS_OUT = TERMS && TERMS.what_you_pay ? ['what_you_pay', 'short', 'cancel', 'overrun', 'hold'].map(k => TERMS[k]).filter(Boolean).join(' ') : null;
const WHAT_YOU_PAY_FALLBACK =
  'What you pay, always within max_total_usd: people who finished, at the quoted pay; people who stopped, for their time; ' +
  'the router fee on those amounts; nothing for people never rung. On cancel, nobody new is rung and people already inside ' +
  'are paid for their time. A person who takes longer than estimated is paid for the extra time from the reserve, never ' +
  'above max_total_usd. The unused hold returns to your balance when the call closes, and the result says how much.';
export const WHAT_YOU_PAY = TERMS_OUT || WHAT_YOU_PAY_FALLBACK;

export function quoteLines(spec) {
  const people = spec.people, pay = spec.pay_cents;
  const toPeople = people * pay;
  const ownPanel = spec.pool_kind === 'panel' || spec.pool_kind === 'self';
  const routerFee = toPeople > 0 && !ownPanel ? Math.max(PRICE.router_fee_min_cents, Math.floor(toPeople * PRICE.router_fee_rate + 0.5)) : 0;
  const reserve = toPeople > 0 ? Math.floor(toPeople * PRICE.reserve_rate + 0.5) : 0;
  const poolFee = spec.pool_fee_rate ? Math.floor(toPeople * spec.pool_fee_rate + 0.5) : 0;
  if (spec.pool_account === 'principal') {   // N2's second mode: the pool pays its people from the principal's own account there
    const pct = Math.round(spec.pool_fee_rate * 1000) / 10;
    const feeReserve = routerFee > 0 ? Math.floor(routerFee * PRICE.reserve_rate + 0.5) : 0;
    const lines = [
      { kind: 'to_people', cents: 0, note: `${people} x ${fmt(pay)} = ${fmt(toPeople)}, paid by ${spec.pool} from your own account there, not held here` },
      { kind: 'pool_fee', cents: 0, note: `${spec.pool}'s own fee, ${pct}% of pay (${fmt(poolFee)}), charged to your own account there` },
      { kind: 'router_fee', cents: routerFee, note: `10% of what people are paid, at least ${fmt(PRICE.router_fee_min_cents)} when anyone is paid` },
      { kind: 'reserve', cents: feeReserve, note: 'on the router fee, so a person who stops can be replaced; returned if unused' },
      { kind: 'tax', cents: 0, note: 'none on test money' },
    ];
    return { lines, total_cents: routerFee + feeReserve, paid_elsewhere: { total_usd: fmt(toPeople + poolFee), where: `your own ${spec.pool} account`, to_people_usd: fmt(toPeople), pool_fee_usd: fmt(poolFee) } };
  }
  const lines = [
    { kind: 'to_people', cents: toPeople, note: `${people} x ${fmt(pay)}` + (pay === 0 ? (spec.pool_kind === 'simulated' ? '; simulated people, nobody is paid' : '; unpaid') : '') },
    { kind: 'pool_fee', cents: poolFee, note: spec.pool_fee_rate ? `the outside panel's own fee, ${Math.round(spec.pool_fee_rate * 1000) / 10}% of pay` : (spec.pool_kind === 'simulated' ? 'the simulated pool has no pool fee' : 'your own panel has no pool fee') },
    { kind: 'router_fee', cents: routerFee, note: ownPanel ? 'none on your own panel' : `10% of what people are paid, at least ${fmt(PRICE.router_fee_min_cents)} when anyone is paid` },
    { kind: 'reserve', cents: reserve, note: 'returned if unused' },
    { kind: 'tax', cents: 0, note: 'none on test money' },
  ];
  const total = lines.reduce((a, l) => a + l.cents, 0);
  return { lines, total_cents: total };
}

export function linesOut(lines) {
  return lines.map(l => ({ kind: l.kind, amount_usd: fmt(l.cents), note: l.note }));
}

// Account names. floor0 = 1 means the account may never go below zero.
export const acct = {
  avail: (pr) => ({ account: 'avail:' + pr, floor0: 1 }),
  hold: (call) => ({ account: 'hold:' + call, floor0: 1 }),
  paid: (who) => ({ account: 'paid:' + who, floor0: 1 }),
  routerFees: () => ({ account: 'fees:router', floor0: 1 }),
  testGrant: () => ({ account: 'grant:test', floor0: 0 }),   // the source of test money; goes negative by design
};

// Build the statements for one posting. lines: [{account, floor0, cents}] summing to zero.
export function posting(db, txn, lines, callId, memo, now) {
  const sum = lines.reduce((a, l) => a + l.cents, 0);
  if (sum !== 0) throw new Error(`posting ${txn} does not balance (${sum})`);
  const st = [];
  lines.forEach((l, i) => {
    if (!Number.isInteger(l.cents)) throw new Error(`posting ${txn}: non-integer cents`);
    st.push(db.prepare('INSERT INTO ledger (txn, line, account, cents, call_id, memo, created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(txn, i, l.account, l.cents, callId || null, memo || '', now));
    // ensure the row (zero), then move it: the UPDATE always finds its row, and CHECK (cents >= 0) fails the batch on an
    // overdraft. (An upsert would not do: SQLite checks CHECK on the would-be inserted row before the conflict branch.)
    st.push(db.prepare('INSERT OR IGNORE INTO balances (account, cents, floor0) VALUES (?,0,?)').bind(l.account, l.floor0));
    st.push(db.prepare('UPDATE balances SET cents = cents + ? WHERE account = ?').bind(l.cents, l.account));
  });
  return st;
}

export async function balance(db, account) {
  const r = await db.prepare('SELECT cents FROM balances WHERE account = ?').bind(account).first();
  return r ? r.cents : 0;
}

// True when a batch failed only because the money event was already posted (another request got there first).
export function isDuplicatePosting(err) {
  return /UNIQUE constraint failed: ledger\.txn/.test(String(err && err.message || err));
}
export function isFloorBreach(err) {
  return /CHECK constraint failed/.test(String(err && err.message || err));
}
