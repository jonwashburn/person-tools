// The fixed asks a visitor may send to themselves on pool "self" (chief D29 with trust's limits, router/INBOX.md 12:26 AM):
// never free text, only a seeded sample, one seat, a link that works for 15 minutes, no push or email, deleted 24 hours
// after the call closes. A call on pool "self" must match one of these exactly (ask, kind, content, answer_fields).
export const DEMOS = {
  'listen-felt': {
    ask: 'Listen once, to the end. Then say what you felt, in your own words.',
    kind: 'listen', content: 'm_sample_melody30',
    answer_fields: { felt: { type: 'text', label: 'What did you feel?' }, would_play_again: { type: 'boolean', label: 'Would you play it again?' } },
  },
  // OWNER_market_5 (the CEO 12:14 PM CT 15 Nov; market/DEMO_ONE_TAP.md): one question, one tap, no material and no sound. The page
  // shows the line the visitor picks: A is today's first line, B the other.
  'pick-line': {
    ask: 'Which first line should this page show you?',
    kind: 'answer', content: null,
    answer_fields: { line: { type: 'choice', label: 'Which first line should this page show you?', choices: ['A', 'B'] } },
  },
};
export const SELF_LINK_MINUTES = 15;

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
// -> the demo id, or null
export function matchDemo(spec) {
  for (const [id, d] of Object.entries(DEMOS)) {
    const f = Object.fromEntries(Object.entries(d.answer_fields).map(([k, v]) => [k, { ...v, ...(v.type === 'text' ? { max_length: 2000 } : {}) }]));
    const content = d.content ? spec.content.length === 1 && spec.content[0].media_id === d.content : !(spec.content && spec.content.length);   // pick-line has none
    if (spec.ask === d.ask && spec.kind === d.kind && content && same(spec.answer_fields, f)) return id;
  }
  return null;
}
