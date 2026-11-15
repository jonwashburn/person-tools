// POST /internal/screen (the admin token only): TRUST's measurement of screening with the model read on the live service
// (the owner, 6:38 PM CT, 14 Nov: the 150 ordinary text asks and the 300 barred asks against LIVE). It screens one ask
// exactly as an outsider's call to real people is screened (a live key, a real pool, not ours), with the model client and
// the capped budget (model_cap.js), and opens nothing: no call, no quote, no seat, nobody rung. The only thing it leaves is
// the read's cost in the day's total, so the $20 stop counts it like any other read.
import { runScreening } from './screen_gate.js';
import { modelParts } from './model_cap.js';
import { screenTerms } from './private_terms.js';
import { holdAdvice } from './hold_advice.js';

export async function measureScreen(env, b) {
  const spec = {
    ask: String(b.ask).slice(0, 4000), kind: typeof b.kind === 'string' ? b.kind : 'answer', content: b.content === undefined ? null : b.content,
    answer_fields: b.answer_fields === undefined ? null : b.answer_fields, pool: 'panel:measure', people: Number.isInteger(b.people) && b.people > 0 ? b.people : 3,
    pay_cents: Number.isInteger(b.pay_cents) && b.pay_cents >= 0 ? b.pay_cents : 100, estimated_minutes: 3, content_rating: b.content_rating, deadline_minutes: 60,
  };
  const parts = await modelParts(env);
  // trust's red team for the material read (OWNER_all_5; trust 3:04 AM CT 15 Nov): {material: [{content_type, bytes, text}],
  // sandbox_ok, builds}; measurement only, no call is made
  const mat = Array.isArray(b.material) ? b.material.slice(0, 10).map(it => ({ content_type: String((it && it.content_type) || ''),
    bytes: Number(it && it.bytes) || (typeof (it && it.text) === 'string' ? new TextEncoder().encode(it.text).length : 0), text: typeof (it && it.text) === 'string' ? it.text : null })) : null;
  const sres = await runScreening(spec, { key_class: 'real', pool: spec.pool, simulated: false, call_id: 'measure', pool_real: true,
    principal_is_ours: false, principal_new: b.principal_new === true, accepts_content_url: false, ...parts, ...(await screenTerms(env)),
    ...(mat ? { material: mat, sandbox_ok: b.sandbox_ok === true, material_builds_enabled: b.builds === true } : {}) });
  const r = sres.result || {};
  const final = sres.decision === 'ALLOW' ? 'would open' : sres.decision === 'REFUSE' ? 'refused' : 'held';
  const adv = final === 'held' ? holdAdvice(sres, spec) : null;
  return { decision: sres.decision, final, model_read_on: !!parts.modelClient, hold_rules: r.hold && Array.isArray(r.hold.reasons) ? r.hold.reasons.map(x => x.rule) : [],
    model_read: r.model_read || null, material_read: r.material_read || null, rule: r.rule || null, category: r.category || null, held_reason: adv ? adv.text : null, held_rule: adv ? adv.detail.rule : null,
    version: (sres.summary && sres.summary.version) || null };
}
