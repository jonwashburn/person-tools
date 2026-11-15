// The simulated pool (spec section 18). Simulated people follow the agent's script entry by entry, in the order seats are
// filled; entries that decline, miss or stop are followed by the next entry, and after the script, by the defaults.
// The defaults are fixed (SIM-5: the same call and script give the same statuses, observed fields, levels and pay);
// only the made-up words of text answers vary, and every one starts "[simulated] " (SIM-2).
// Nothing runs in the background: each seat carries due_at, and settle() moves it when a request arrives after that time.
import { seeded } from './util.js';
import { levelFor, unobservedFor, RULE_NAME } from './evidence.js';

const TEXT = {
  listen: ['The opening pulled me in; by the middle it felt like it was circling.', 'Calm and a bit sad. I would play it while working.',
    'The melody is clear but the sound is thin; it needs something underneath.', 'I liked the first twenty seconds most. The ending stopped rather than finished.',
    'Pleasant, but nothing made me want to hear it twice.', 'It felt hopeful. The repeated phrase stuck with me afterwards.'],
  watch: ['Clear what it is about within the first few seconds.', 'The pace dragged in the middle.', 'I would share it; the ending landed.', 'I lost track of who was speaking.'],
  view: ['Clear at a glance; I knew what it was about in a few seconds.', 'I had to read it twice before it made sense.', 'Calm and easy to follow.', 'Too busy; I was not sure where to look first.'],
  play: ['Fun for two minutes, then repetitive.', 'The controls took a while to understand.', 'I wanted one more round, a good sign.', 'Too hard at the start; I almost quit.'],
  compare: ['The first felt warmer; the second felt more polished.', 'The second, because it was clearer at first glance.', 'Hard to choose; the first by a little.', 'The second. The first was too busy.'],
  answer: ['Mostly yes; it made sense to me.', 'Not really; I was unsure what was meant.', 'Somewhat. I would want more detail first.', 'Yes, without much doubt.'],
};

export function entryFor(spec, n) { return (spec.script && spec.script[n]) || {}; }

// When this seat's simulated person answers or stops, in ms since the call opened.
export function delayMs(spec, n, e) {
  if (e.delay_seconds !== undefined) return Math.round(e.delay_seconds * 1000);
  if (spec.pace === 'human') return (60 + ((n * 97) % 300)) * 1000;     // 1 to 6 minutes, fixed per seat
  return Math.min(9000, 1500 + n * 400);                                 // within 10 seconds of opening
}

function itemKind(c) {
  if (c.text) return 'view';
  if (c.kind === 'audio') return 'listen'; if (c.kind === 'video') return 'watch'; if (c.kind === 'build') return 'play';
  if (c.media_id === 'm_sample_melody30') return 'listen';
  return 'view';
}

function observedOne(kind, e, seatSeconds, mediaSeconds, isText = false) {
  const vf = e.visible_fraction ?? 1;
  if (e.media_seconds !== undefined) mediaSeconds = e.media_seconds;
  if (kind === 'listen' || kind === 'watch') {
    const pf = Math.min(e.play_fraction ?? 1, e.stop_at_fraction != null ? e.stop_at_fraction : 1);   // SIM-7: a stop plays min(play, stop)
    const played = Math.round(mediaSeconds * pf * 10) / 10;
    const o = { media_seconds: mediaSeconds, played_seconds: played, realtime_seconds: e.realtime === false ? Math.round(played / 2 * 10) / 10 : played,
      stalled_seconds: 0, visible_fraction: vf, pauses: 0, replays: 0, seeks_forward: 0, completed: (e.play_fraction ?? 1) >= 1 && e.stop_at_fraction == null };
    if (kind === 'watch') { o.muted_fraction = 0; o.revealed = e.revealed ?? true; }
    return o;
  }
  if (kind === 'view') return { revealed: isText ? true : (e.revealed ?? true), visible_seconds: e.visible_seconds ?? 20, scrolled_fraction: 1 };   // text has nothing to reveal
  if (kind === 'play') return { session_seconds: e.session_seconds ?? 120, input_count: e.input_count ?? 40, ended: e.stop_at_fraction != null ? 'stopped' : 'finished' };
  return {};
}

// The whole outcome of one simulated seat, decided from its script entry alone.
export function simOutcome(callId, spec, n, items, entryOverride = null) {
  const e = entryOverride || entryFor(spec, n);
  const accept = e.accept === undefined ? true : e.accept;
  if (accept === false) return { state: 'declined' };
  if (accept === 'miss') return { state: 'missed' };
  const stops = e.stop_at_fraction != null;
  const seat_seconds = e.seat_seconds !== undefined ? e.seat_seconds : Math.round(stops ? e.stop_at_fraction * spec.minutes * 60 : spec.minutes * 45);
  const mediaSeconds = (items[0] && items[0].seconds) || spec.media_seconds_hint || 30;
  const common = { seat_seconds, device: 'phone' };
  let observed;
  if (spec.kind === 'compare') {
    const k = spec.content.length; const order = Array.isArray(e.order) && e.order.length === k ? e.order.slice() : Array.from({ length: k }, (_, i) => i);
    observed = { ...common, order, items: spec.content.map((c, i) => { const ik = itemKind(items[i] || c); const ie = { ...e, ...((e.items && e.items[i]) || {}) }; delete ie.items; return { kind: ik, ...observedOne(ik, ie, Math.round(seat_seconds / k), (items[i] && items[i].seconds) || 30, !!c.text) }; }) };
  } else observed = { ...common, ...observedOne(spec.kind, e, seat_seconds, mediaSeconds, !!(spec.content[0] && spec.content[0].text)) };
  const lv = levelFor(spec.kind, observed, 0);
  const sendAnswers = !stops || e.send_partial !== false;
  let answers = null, input = null;
  if (sendAnswers) {
    const r = seeded(callId + ':' + n);
    answers = {}; input = {};
    // text: seats of one call walk the bank from a start fixed by the call, so three people never give one same sentence
    const start = Math.floor(seeded(callId)() * 1000); let fi = 0;
    for (const [name, f] of Object.entries(spec.answer_fields)) {
      fi++;
      let v = e.answers && e.answers[name] !== undefined ? e.answers[name] : undefined;
      if (v === undefined) {
        // SIM-7, for seat n counted from 1 (here n is from 0)
        if (f.type === 'boolean') v = (n + 1) % 2 === 1;
        else if (f.type === 'choice') { const ch = f.choices || f.options || ['A', 'B']; v = f.multiple ? [ch[n % ch.length]] : ch[n % ch.length]; }
        else if (f.type === 'scale') v = Math.floor((f.min + f.max) / 2);
        else if (f.type === 'number') v = f.min !== undefined ? f.min : 0;
        else { const bank = TEXT[spec.kind] || TEXT.answer; v = bank[(start + n + 2 * (fi - 1)) % bank.length]; }
      }
      if (f.type === 'text') v = '[simulated] ' + String(v).replace(/^\[simulated\]\s*/, '');
      answers[name] = v;
      input[name] = f.type === 'text' ? ((e.answer_input && typeof e.answer_input === 'object' ? e.answer_input[name] : e.answer_input) || 'typed') : 'tapped';
    }
  }
  return { state: stops ? 'stopped' : 'answered', stop_reason: stops ? (e.stop_reason || 'stopped') : null, partial: stops && sendAnswers,
    seat_seconds, answers, input, level: lv.level, level_reason: lv.reason,
    record: { rule: RULE_NAME(spec.kind), observed, unobserved: unobservedFor(spec.kind, spec.kind === 'compare' ? spec.content.map((c, i) => itemKind(items[i] || c)) : []), simulated: true } };
}
