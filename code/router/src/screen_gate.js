// The screening gate. Trust writes the rules in ./screening/index.js (shipped from trust's READY copy by bin/golive):
//   export async function screen(call, ctx) -> { decision: 'ALLOW' | 'REFUSE' | 'HOLD', rule, rule_text, where, found,
//                                                fixable, fix, corrected_example, what_to_do, message }
// When no READY copy exists, bin/golive ships a stub that exports MISSING = true.
// Fails closed: for any call that can reach a real person, anything but an explicit ALLOW is a HOLD
// (a missing module, an error, a timeout, an unknown answer). Explicit REFUSE and HOLD apply to every key, simulated too,
// so an agent learns the same answer it would get on a real pool.
import * as S from './screening/index.js';

const TIMEOUT_MS = 2000;
const TIMEOUT_WITH_MODEL_MS = 10000;   // trust 6:36 PM CT: the model read has 8 seconds of its own (model_read.js)
const TIMEOUT_WITH_MATERIAL_MS = 30000;   // trust 3:04 AM CT 15 Nov: the material read has 20 seconds of its own, after the call read

export async function runScreening(spec, ctx, mod = S) {
  const view = {
    ask: spec.ask, kind: spec.kind, content: spec.content, answer_fields: spec.answer_fields, pool: spec.pool,
    people: spec.people, pay_per_person_cents: spec.pay_cents, estimated_minutes: spec.estimated_minutes,
    content_rating: spec.content_rating, deadline_minutes: spec.deadline_minutes,
  };
  if (mod.MISSING || typeof mod.screen !== 'function') return { decision: 'MISSING', result: null, summary: { decision: 'MISSING', reason: 'screening module not installed' } };
  try {
    if (/\[TEST: screening error\]/.test(spec.ask)) throw new Error('screening failure requested by the call text (a test)');
    const r = await Promise.race([
      Promise.resolve().then(() => mod.screen(view, ctx)),
      new Promise((_, rej) => setTimeout(() => rej(new Error('screening timed out')), ctx && ctx.modelClient ? (ctx.material ? TIMEOUT_WITH_MATERIAL_MS : TIMEOUT_WITH_MODEL_MS) : TIMEOUT_MS)),
    ]);
    const d = r && typeof r.decision === 'string' ? r.decision.toUpperCase() : 'UNKNOWN';
    const decision = ['ALLOW', 'REFUSE', 'HOLD'].includes(d) ? d : 'UNKNOWN';
    return { decision, result: r || null, summary: { decision, rule: r && r.rule || null, reason: r && (r.reason || r.rule_text || r.message) || (decision === 'UNKNOWN' ? 'screening gave no clear answer' : null), version: mod.VERSION || null } };
  } catch (e) {
    return { decision: 'ERROR', result: null, summary: { decision: 'ERROR', reason: String(e && e.message || e).slice(0, 200) } };
  }
}

// -> 'open' | 'refuse' | 'hold'
// Trust's protocol (src/screening/README.md): REFUSE -> nothing opens; HOLD on a real pool -> held, nobody rung;
// HOLD on the simulated pool or team-test -> the call runs, marked would_hold_on_real_pool. Anything that is not an
// explicit answer (missing module, error, timeout, unknown) is a HOLD for every call from a real_ key.
export function gate(sres, { canReachReal, poolReal = canReachReal }) {
  if (sres.decision === 'REFUSE') return 'refuse';
  if (sres.decision === 'ALLOW') return 'open';
  if (sres.decision === 'HOLD') {
    if (poolReal) return 'hold';
    sres.summary.would_hold_on_real_pool = true;
    sres.summary.note = (sres.result && sres.result.hold && sres.result.hold.message) || 'On real people this call would be held for a human to read first.';
    return 'open';
  }
  if (canReachReal || poolReal) return 'hold';
  sres.summary.note = `Screening did not return an answer (${sres.decision.toLowerCase()}); this call reaches no real person, so it opened. On a real pool it would be held.`;
  return 'open';
}
