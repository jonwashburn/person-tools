// The model read for screening, and its daily stop (the owner, 6:30 and 6:36 PM CT, 14 Nov 2026, from the CEO: paid model
// use for screening, text only, capped at $20 a day in code; at the cap the read stops and calls stay held, never allowed).
// Screening (./screening/model_read.js, trust's) does the read; the router gives it a client and a budget:
//   - modelClient(env): the official Anthropic SDK client, made only when the ANTHROPIC_API_KEY secret exists. Without it,
//     screening is rules alone and nothing here runs.
//   - cappedBudget(db): the day's spend, kept in `meta` under the same key as screening's d1Budget
//     (model_read_cents:<date in Chicago>; policy/DATA.md, row `meta`). Before each read it RESERVES the dearest read in
//     one guarded statement, so reads that run at the same moment can never pass the cap together; after the read the
//     reservation is trued up to the read's real cost. When the reservation does not fit under the cap, it reports the
//     day as full and screening holds the call for a person.
// Only text is sent: the ask, its kind, its fields and the material's description as JSON (model_read.js callModel).
import { BUDGET } from './screening/model_read.js';
import { MATERIAL_READ } from './screening/material_read.js';

const PREFIX = 'model_read_cents:';
const DAY_MS = 86400000;
export const chicagoDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(ms));
export const capCents = () => BUDGET.cap_cents_per_day;

let CLIENT = null, CLIENT_FOR = null;
export async function modelClient(env) {
  const key = env && env.ANTHROPIC_API_KEY;
  if (!key) return null;
  if (!CLIENT || CLIENT_FOR !== key) {
    const { Anthropic } = await import('./vendor/anthropic_sdk.mjs');
    // one retry, for a quick 429/5xx/connection failure; the read's own 8-second limit (model_read.js) bounds it all,
    // and the SDK's limit sits above that so a read cut at 8 s is never sent a second time
    CLIENT = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 9000 });
    CLIENT_FOR = key;
  }
  return CLIENT;
}

export function cappedBudget(db, now = () => Date.now()) {
  let reserved = 0, day = null;
  // one reservation covers the dearest of either read (the call's words: 15 c; its material, OWNER_all_5: 25 c); the two
  // reads of one call run one after the other, each reserving before and truing up after
  const W = Math.max(BUDGET.worst_read_cents, (MATERIAL_READ && MATERIAL_READ.worst_read_cents) || 0), CAP = BUDGET.cap_cents_per_day;
  return {
    // the spend before this read, with this read's dearest cost already set aside; the cap itself when no room is left
    async spentToday() {
      day = PREFIX + chicagoDay(now());
      const row = await db.prepare(`INSERT INTO meta (k, v) VALUES (?, CAST(? AS TEXT))
          ON CONFLICT(k) DO UPDATE SET v = CAST(CAST(meta.v AS REAL) + ? AS TEXT) WHERE CAST(meta.v AS REAL) + ? <= ?
          RETURNING v`).bind(day, W, W, W, CAP).first();
      if (!row) return CAP;   // the day is full: no read, the call stays held for a person
      const v = Number(row.v);
      if (!Number.isFinite(v)) throw new Error('spend row unreadable');
      reserved = W;
      return v - W;
    },
    // after the read (or its failure, counted at the dearest read): true the reservation up to the real cost
    async add(cents) {
      const c = Number(cents);
      const delta = (Number.isFinite(c) && c > 0 ? c : 0) - reserved;
      reserved = 0;
      if (day && delta !== 0) await db.prepare('UPDATE meta SET v = CAST(MAX(0, CAST(v AS REAL) + ?) AS TEXT) WHERE k = ?').bind(delta, day).run();
      await db.prepare("DELETE FROM meta WHERE k LIKE 'model_read_cents:%' AND k < ?").bind(PREFIX + chicagoDay(now() - 2 * DAY_MS)).run();
    },
  };
}

// The screening context's two parts, or nothing when the key is not set.
export async function modelParts(env) {
  const client = await modelClient(env).catch(() => null);
  return client && env.DB ? { modelClient: client, modelBudget: cappedBudget(env.DB) } : {};
}

// For GET /v1/status: whether the read is on, the cap, and today's spend (counts only; never a call's words)
export async function modelReadStatus(env) {
  const day = chicagoDay(Date.now());
  const row = env.DB ? await env.DB.prepare('SELECT v FROM meta WHERE k = ?').bind(PREFIX + day).first() : null;
  const cents = row ? Number(row.v) || 0 : 0;
  return { on: !!(env && env.ANTHROPIC_API_KEY), text_only: true, cap_usd: (BUDGET.cap_cents_per_day / 100).toFixed(2), spent_today_usd: (cents / 100).toFixed(2),
    day_in_chicago: day, at_cap: cents + Math.max(BUDGET.worst_read_cents, (MATERIAL_READ && MATERIAL_READ.worst_read_cents) || 0) > BUDGET.cap_cents_per_day,
    at_the_cap: 'the read stops for the rest of the day and calls it would have read stay held for a person; none is allowed by default' };
}
