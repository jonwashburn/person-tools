// Reads a call body to the standard (spec/src/02-call.md, section 9) and returns the call with every default named,
// or a fixable error naming the field, whose `example` is a value FOR THAT FIELD (section 8), never a whole body.
// ROUND0's nested shape (experience/respond/who/pay/by_minutes) is read until 6:01 AM CT Sat 14 Nov (chief/ARCHITECTURE.md 1).
import { parseUsd, fmt } from './util.js';
import { BUILD } from './build_info.js';

// money/price.json public.pay_default, embedded at build: the pay used when a call sets none, on pools where we pay people
const PAY_DEFAULT = (BUILD && BUILD.pay_default) || { usd_per_hour: '20.00', min_per_person_usd: '1.00' };
export function defaultPayCents(minutes) {
  const perHour = Math.round(parseFloat(PAY_DEFAULT.usd_per_hour) * 100), least = Math.round(parseFloat(PAY_DEFAULT.min_per_person_usd) * 100);
  return Math.max(least, Math.ceil(perHour * minutes / 60));
}

export const KINDS = ['listen', 'watch', 'view', 'play', 'compare', 'answer'];
export const FIELD_TYPES = ['text', 'boolean', 'number', 'choice', 'scale'];
export const SELECTORS = ['country', 'region', 'language', 'age_band', 'device'];
export const AGE_BANDS = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
// trust's policy/PAY_RULES.md (aligned to the text 1:27 AM CT): floor $18.00 an hour; a stop on a paid call pays at least $0.25
export const LIMITS = { max_people: 100, max_deadline_minutes: 10080, max_wait_seconds: 25, stop_minimum_usd: '0.25' };
export const STOP_MINIMUM_CENTS = 25;
export const PAY_FLOOR_CENTS_PER_HOUR = 1800;
const NESTED_UNTIL = Date.parse('2026-11-14T12:01:00Z');   // 6:01 AM CT Sat 14 Nov

const TOP = ['ask', 'kind', 'content', 'people', 'max_total_usd', 'idempotency_key', 'enough', 'pool', 'answer_fields', 'minutes',
  'pay_per_person_usd', 'deadline_minutes', 'require', 'voice', 'content_rating', 'may_train_on_answers', 'pace', 'script', 'ext', 'wants_strangers', 'card'];
const NESTED = ['experience', 'respond', 'who', 'pay', 'by_minutes'];
const FIELD_KEYS = ['type', 'label', 'optional', 'max_length', 'min', 'max', 'choices', 'multiple', 'min_label', 'max_label'];
const SCRIPT_KEYS = ['accept', 'delay_seconds', 'media_seconds', 'play_fraction', 'realtime', 'visible_fraction', 'revealed', 'visible_seconds',
  'session_seconds', 'input_count', 'order', 'items', 'share_recording', 'seat_seconds', 'stop_at_fraction', 'stop_reason', 'send_partial', 'answers', 'answer_input', 'voice_seconds'];
const ITEM_KEYS = ['media_seconds', 'play_fraction', 'realtime', 'visible_fraction', 'revealed', 'visible_seconds', 'session_seconds', 'input_count'];

export class CallError extends Error {
  constructor(status, body) { super(body.message || body.code); this.status = status; this.body = { ...body, status: body.status || status }; }
}
export function fixable(code, field, message, example, extra = {}, status = 400) {
  return new CallError(status, { code, message, status, fixable: true, field, example: example === undefined ? null : example, rule: null, ...extra });
}
export function notFixable(status, code, message, extra = {}) {
  return new CallError(status, { code, message, status, fixable: false, rule: null, ...extra });
}

export const SAMPLE_ID = 'm_sample_melody30';
export const ADAPTER_POOLS = ['prolific'];   // outside pools through adapters (src/pools/, code/router/ADAPTERS.md)
export const EXAMPLE_ASK = 'Listen once. Then tell me what you felt, in your own words.';
export const MINIMAL_EXAMPLE = { ask: EXAMPLE_ASK, kind: 'listen', content: SAMPLE_ID, people: 3 };

function lev(a, b) {
  const m = a.length, n = b.length; const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
const ALIASES = { experience: 'kind and content', respond: 'answer_fields', who: 'people, enough and pool', pay: 'pay_per_person_usd and minutes', by_minutes: 'deadline_minutes',
  count: 'people', estimated_minutes: 'minutes', options: 'choices', media_id: 'content', fields: 'answer_fields', question: 'ask', max_total: 'max_total_usd', deadline: 'deadline_minutes', seconds: 'minutes', delay_s: 'delay_seconds', stop_at_s: 'stop_at_fraction' };
function unknownField(name, allowed, path) {
  if (name === 'contacts') return notFixable(400, 'contacts_not_allowed', 'Calls to a pool and offers carry no one else\'s contact details: contacts belong on an ask from a person\'s own AI or to a principal\'s own private panel. Nothing was stored.');   // OWNER_router_29 (ASKS-20)
  let best = ALIASES[name] || null;
  if (!best) { let bd = 99; for (const a of allowed) { const d = lev(name, a); if (d < bd) { bd = d; best = a; } } if (bd > Math.max(2, Math.floor(name.length / 3))) best = null; }
  return fixable('unknown_field', path, `"${path}" is not a field of this version${best ? `; did you mean ${best}?` : '.'} Remove it, or put extensions under "ext".`, null, best ? { did_you_mean: best } : {});
}
function checkKeys(obj, allowed, prefix) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) throw unknownField(k, allowed, prefix ? prefix + '.' + k : k);
}

function money(v, field, extra) {
  const c = parseUsd(v);
  if (Number.isNaN(c)) throw fixable('invalid_field', field, `${field} is dollars with at most two places, as a string ("2.50") or a number (2.5).`, '2.00', extra);
  return c;
}

function fromNested(body) {
  // ROUND0 nested shape -> flat (until NESTED_UNTIL)
  const b = {}; for (const k of Object.keys(body)) if (!NESTED.includes(k)) b[k] = body[k];
  const e = body.experience, r = body.respond, w = body.who, p = body.pay;
  if (e !== undefined) {
    if (!e || typeof e !== 'object') throw fixable('invalid_field', 'experience', 'experience is an object (the older shape); send kind and content instead.', null);
    checkKeys(e, ['kind', 'media_id', 'media_ids', 'seconds', 'content', 'url'], 'experience');
    if (e.kind !== undefined) b.kind = e.kind;
    const c = e.media_ids || e.media_id || e.content || e.url; if (c !== undefined) b.content = c;
    if (e.seconds !== undefined) b.__seconds = e.seconds;
  }
  if (r !== undefined) { if (!r || typeof r !== 'object') throw fixable('invalid_field', 'respond', 'respond is an object (the older shape); send answer_fields instead.', null); checkKeys(r, ['fields'], 'respond'); if (r.fields !== undefined) b.answer_fields = r.fields; }
  if (w !== undefined) {
    if (!w || typeof w !== 'object') throw fixable('invalid_field', 'who', 'who is an object (the older shape); send people, enough and pool instead.', null);
    checkKeys(w, ['count', 'enough', 'pool', 'pace', 'script'], 'who');
    if (w.count !== undefined) b.people = w.count; if (w.enough !== undefined) b.enough = w.enough; if (w.pool !== undefined) b.pool = w.pool;
    if (w.pace !== undefined) b.pace = w.pace; if (w.script !== undefined) b.script = w.script;
  }
  if (p !== undefined) { if (!p || typeof p !== 'object') throw fixable('invalid_field', 'pay', 'pay is an object (the older shape); send pay_per_person_usd and minutes instead.', null); checkKeys(p, ['per_person_usd', 'estimated_minutes'], 'pay'); if (p.per_person_usd !== undefined) b.pay_per_person_usd = p.per_person_usd; if (p.estimated_minutes !== undefined) b.minutes = p.estimated_minutes; }
  if (body.by_minutes !== undefined) b.deadline_minutes = body.by_minutes;
  // older answer-field spelling: options -> choices
  if (b.answer_fields && typeof b.answer_fields === 'object') for (const f of Object.values(b.answer_fields)) if (f && typeof f === 'object' && f.options && !f.choices) { f.choices = f.options; delete f.options; }
  return b;
}

function normContent(raw, kind) {
  const one = (c, path) => {
    if (typeof c === 'string') {
      if (/^m_[A-Za-z0-9_-]{1,62}$/.test(c)) return { media_id: c };
      if (/^(\/|~|file:|[A-Za-z]:\\|\.\.?\/)/.test(c.trim())) throw fixable('invalid_field', path, 'That is a file on your user\'s machine, which cannot be sent from here. Ask your user for an https link to it, or try the call first with a sample (GET /v1/media/samples).', SAMPLE_ID);
      if (/^http:\/\//.test(c.trim())) throw fixable('invalid_field', path, 'Only https addresses are taken; give the https form of the address.', c.trim().replace(/^http:/, 'https:'));
      if (/^https:\/\/[^\s]{4,2000}$/.test(c)) return { url: c };
      throw fixable('invalid_field', path, `${path} is a media id (such as ${SAMPLE_ID}), an https address, or {"text": "..."}.`, SAMPLE_ID);
    }
    if (c && typeof c === 'object' && !Array.isArray(c)) {
      checkKeys(c, ['text'], path);
      if (typeof c.text !== 'string' || !c.text.trim() || c.text.length > 5000) throw fixable('invalid_field', path + '.text', 'text is 1 to 5,000 characters shown to the person as plain text.', 'Two short lines of text to read.');
      return { text: c.text };
    }
    throw fixable('invalid_field', path, `${path} is a media id, an https address, or {"text": "..."}.`, SAMPLE_ID);
  };
  if (kind === 'compare') {
    if (!Array.isArray(raw) || raw.length < 2 || raw.length > 6) {
      const first = Array.isArray(raw) && raw.length ? raw[0] : (raw && raw !== null ? raw : null);
      const example = first && typeof first === 'object' && first.text !== undefined ? [first, { text: 'The second version, as text.' }]
        : typeof first === 'string' ? [first, first.startsWith('m_') ? 'm_sample_page_b' : 'https://example.com/version-b'] : [{ text: 'Version A' }, { text: 'Version B' }];
      throw fixable(raw === undefined ? 'missing_field' : 'invalid_field', 'content', 'compare needs content as a list of 2 to 6 items, each a media id, an https address or {"text": "..."}.', Array.isArray(raw) && raw.length > 6 ? raw.slice(0, 6) : example);
    }
    return raw.map((c, i) => one(c, `content[${i}]`));
  }
  if (raw === undefined || raw === null) {
    if (kind === 'answer') return [];
    throw fixable('missing_field', 'content', `kind "${kind}" needs content: a media id or an https address${kind === 'view' ? ', or {"text": "..."}' : ''}. If your user has not sent the material yet, ask them for it; a quote prices the call without it. To try the service now, use the sample ${({ watch: 'm_sample_clip8 (an 8-second clip)', play: 'm_sample_game_dots (a one-page game)', view: 'm_sample_page_a (a web page)' })[kind] || SAMPLE_ID + ' (30 seconds of audio)'}.`, kind === 'view' ? { text: 'A short paragraph to read.' } : ({ watch: 'm_sample_clip8', play: 'm_sample_game_dots' })[kind] || SAMPLE_ID);
  }
  if (Array.isArray(raw)) throw fixable('invalid_field', 'content', 'A list of items is for compare; give one item.', raw.length && typeof raw[0] === 'string' ? raw[0] : SAMPLE_ID);
  const c = one(raw, 'content');
  if (c.text && !['view', 'answer'].includes(kind)) throw fixable('invalid_field', 'content', `Text content is for view, answer and compare items; "${kind}" needs material.`, SAMPLE_ID);
  if (kind === 'answer' && !c.text) throw fixable('invalid_field', 'content', 'For answer, content is absent or {"text": "..."} the person reads beside the question.', null);
  return [c];
}

function normFields(raw, defaults) {
  if (raw === undefined || raw === null) { defaults.answer_fields = { answer: { type: 'text' } }; return { answer: { type: 'text', max_length: 2000 } }; }
  if (typeof raw !== 'object' || Array.isArray(raw)) throw fixable('invalid_field', 'answer_fields', 'answer_fields is an object: each answer\'s name and its type.', { felt: 'text', would_play_again: 'boolean' });
  const names = Object.keys(raw);
  if (names.length < 1 || names.length > 12) throw fixable('invalid_field', 'answer_fields', 'answer_fields holds 1 to 12 fields.', { answer: 'text' });
  const out = {};
  for (const name of names) {
    const path = 'answer_fields.' + name;
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(name)) throw fixable('invalid_field', 'answer_fields', `The field name "${name}" is not allowed: 1 to 40 characters of a-z 0-9 _, starting with a letter.`, { ...Object.fromEntries(Object.entries(raw).filter(([k]) => k !== name)), [name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]+/, '').slice(0, 40) || 'answer']: raw[name] });
    let f = raw[name];
    if (typeof f === 'string') f = { type: f };
    if (!f || typeof f !== 'object' || Array.isArray(f)) throw fixable('invalid_field', path, 'Each field is a type name ("text") or an object with "type".', 'text');
    checkKeys(f, FIELD_KEYS, path);
    const type = f.type;
    if (!FIELD_TYPES.includes(type)) throw fixable(type === undefined ? 'missing_field' : 'invalid_field', path + '.type', `type is one of ${FIELD_TYPES.join(', ')}.`, 'text');
    const g = { type };
    if (f.label !== undefined) { if (typeof f.label !== 'string' || f.label.length > 200) throw fixable('invalid_field', path + '.label', 'A label is the question the person reads, at most 200 characters.', 'What did you feel?'); g.label = f.label; }
    if (f.optional !== undefined) { if (typeof f.optional !== 'boolean') throw fixable('invalid_field', path + '.optional', 'optional is true or false.', true); if (f.optional) g.optional = true; }
    const only = (keys) => { for (const k of ['max_length', 'min', 'max', 'choices', 'multiple', 'min_label', 'max_label']) if (f[k] !== undefined && !keys.includes(k)) throw fixable('invalid_field', `${path}.${k}`, `${k} does not apply to a ${type} field.`, null); };
    if (type === 'text') { only(['max_length']); g.max_length = 2000; if (f.max_length !== undefined) { if (!Number.isInteger(f.max_length) || f.max_length < 1 || f.max_length > 5000) throw fixable('invalid_field', path + '.max_length', 'max_length is 1 to 5,000.', 2000); g.max_length = f.max_length; } }
    if (type === 'boolean') only([]);
    if (type === 'number') { only(['min', 'max']); for (const k of ['min', 'max']) if (f[k] !== undefined) { if (typeof f[k] !== 'number' || !isFinite(f[k])) throw fixable('invalid_field', `${path}.${k}`, `${k} is a number.`, k === 'min' ? 0 : 100); g[k] = f[k]; } if (g.min !== undefined && g.max !== undefined && g.min > g.max) throw fixable('invalid_field', path + '.max', 'max is at least min.', g.min); }
    if (type === 'choice') {
      only(['choices', 'multiple']);
      const ch = f.choices;
      if (!Array.isArray(ch) || ch.length < 2 || ch.length > 12 || ch.some(x => typeof x !== 'string' || !x.trim() || x.length > 80) || new Set(ch).size !== ch.length)
        throw fixable(ch === undefined ? 'missing_field' : 'invalid_field', path + '.choices', 'choices is a list of 2 to 12 different strings (each at most 80 characters).', ['A', 'B']);
      g.choices = ch.slice();
      if (f.multiple !== undefined) { if (typeof f.multiple !== 'boolean') throw fixable('invalid_field', path + '.multiple', 'multiple is true or false.', false); if (f.multiple) g.multiple = true; }
    }
    if (type === 'scale') {
      only(['min', 'max', 'min_label', 'max_label']);
      g.min = f.min === undefined ? 1 : f.min; g.max = f.max === undefined ? 5 : f.max;
      if (!Number.isInteger(g.min)) throw fixable('invalid_field', path + '.min', 'min is a whole number.', 1);
      if (!Number.isInteger(g.max) || g.max <= g.min || g.max - g.min > 10) throw fixable('invalid_field', path + '.max', 'max is a whole number above min, at most 11 steps in all.', Math.min(g.min + 4, g.min + 10));
      for (const k of ['min_label', 'max_label']) if (f[k] !== undefined) { if (typeof f[k] !== 'string' || f[k].length > 80) throw fixable('invalid_field', `${path}.${k}`, `${k} is at most 80 characters.`, k === 'min_label' ? 'not at all' : 'very much'); g[k] = f[k]; }
    }
    out[name] = g;
  }
  return out;
}

function normRequire(raw, poolKind) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw fixable('invalid_field', 'require', 'require is an object: a selector key and its list of accepted values.', { country: ['US'] });
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const path = 'require.' + k;
    if (k.includes('/')) throw fixable('selector_unsupported', path, `No pool here can apply "${k}". Ask it as an answer field instead; the person is paid for answering it.`, null);
    if (!SELECTORS.includes(k)) throw fixable('unknown_selector', path, `"${k}" is not a selector this server knows: ${SELECTORS.join(', ')}. A free-text wish is asked as an answer field.`, null);
    const vals = Array.isArray(v) ? v : [v];
    if (!vals.length || vals.length > 50 || vals.some(x => typeof x !== 'string')) throw fixable('invalid_field', path, `${k} is a list of strings.`, k === 'country' ? ['US'] : (k === 'age_band' ? ['25-34'] : (k === 'device' ? ['phone'] : (k === 'language' ? ['en'] : ['US-TX']))));
    const ok = { country: x => /^[A-Z]{2}$/.test(x), region: x => /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(x), language: x => /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(x), age_band: x => AGE_BANDS.includes(x), device: x => ['phone', 'tablet', 'desktop'].includes(x) }[k];
    const bad = vals.find(x => !ok(x));
    if (bad !== undefined) throw fixable('invalid_field', path, `"${bad}" is not a ${k} value.`, k === 'country' ? ['US'] : (k === 'age_band' ? AGE_BANDS.slice(1, 3) : (k === 'device' ? ['phone'] : (k === 'language' ? ['en'] : ['US-TX']))));
    out[k] = vals;
  }
  if (poolKind === 'panel' && Object.keys(out).length) throw fixable('selector_unsupported', 'require', 'A panel is the people its principal invited; it is not selected by claims. Remove require.', null);
  return Object.keys(out).length ? out : null;
}

function normScript(raw, people, poolKind) {
  if (raw === undefined || raw === null) return null;
  if (poolKind !== 'simulated') throw fixable('invalid_field', 'script', 'script is for the simulated pool only; remove it.', null);
  if (!Array.isArray(raw) || raw.length > people + 20) throw fixable('invalid_field', 'script', `script is a list of at most people + 20 (${people + 20}) entries, one per seat in the order seats are filled.`, [{ accept: true }]);
  return raw.map((e, i) => {
    const p = `script[${i}]`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw fixable('invalid_field', p, 'Each script entry is an object.', { accept: true });
    for (const k of Object.keys(e)) if (!SCRIPT_KEYS.includes(k)) throw unknownField(k, SCRIPT_KEYS, `${p}.${k}`);
    const o = {};
    if (e.accept !== undefined) { if (![true, false, 'miss'].includes(e.accept)) throw fixable('invalid_field', p + '.accept', 'accept is true, false or "miss".', true); o.accept = e.accept; }
    const num = (k, lo, hi, ex) => { if (e[k] === undefined || e[k] === null) return; const x = Number(e[k]); if (typeof e[k] !== 'number' || !(x >= lo && x <= hi)) throw fixable('invalid_field', `${p}.${k}`, `${k} is a number from ${lo} to ${hi}.`, ex); o[k] = x; };
    num('delay_seconds', 0, 604800, 5); num('play_fraction', 0, 1, 1); num('visible_fraction', 0, 1, 1); num('seat_seconds', 0, 86400, 60); num('stop_at_fraction', 0, 1, 0.5); num('voice_seconds', 0, 300, 0);
    num('media_seconds', 0.1, 36000, 30); num('visible_seconds', 0, 86400, 20); num('session_seconds', 0, 86400, 120); num('input_count', 0, 1e6, 40);
    if (e.input_count !== undefined && !Number.isInteger(e.input_count)) throw fixable('invalid_field', p + '.input_count', 'input_count is a whole number.', 40);
    for (const k of ['realtime', 'revealed', 'send_partial', 'share_recording']) if (e[k] !== undefined) { if (typeof e[k] !== 'boolean') throw fixable('invalid_field', `${p}.${k}`, `${k} is true or false.`, true); o[k] = e[k]; }
    if (e.order !== undefined) { if (!Array.isArray(e.order) || e.order.some(x => !Number.isInteger(x) || x < 0)) throw fixable('invalid_field', p + '.order', 'order is a list of indices of content.', [1, 0]); o.order = e.order; }
    if (e.items !== undefined) {
      if (!Array.isArray(e.items)) throw fixable('invalid_field', p + '.items', 'items is a list, one object per item of content.', [{}, {}]);
      o.items = e.items.map((it, j) => { if (!it || typeof it !== 'object' || Array.isArray(it)) throw fixable('invalid_field', `${p}.items[${j}]`, 'Each item is an object.', {}); for (const k of Object.keys(it)) if (!ITEM_KEYS.includes(k)) throw unknownField(k, ITEM_KEYS, `${p}.items[${j}].${k}`); return { ...it }; });
    }
    if (e.stop_at_fraction === null) o.stop_at_fraction = null;
    if (e.stop_reason !== undefined) { if (!['stopped', 'upset'].includes(e.stop_reason)) throw fixable('invalid_field', p + '.stop_reason', 'stop_reason is "stopped" or "upset".', 'stopped'); o.stop_reason = e.stop_reason; }
    if (e.answers !== undefined) { if (!e.answers || typeof e.answers !== 'object' || Array.isArray(e.answers)) throw fixable('invalid_field', p + '.answers', 'answers is an object keyed by answer field.', {}); o.answers = e.answers; }
    if (e.answer_input !== undefined) {
      const okv = (v) => ['typed', 'pasted', 'mixed', 'spoken'].includes(v);
      if (typeof e.answer_input === 'string' ? !okv(e.answer_input) : (!e.answer_input || typeof e.answer_input !== 'object' || Object.values(e.answer_input).some(v => !okv(v))))
        throw fixable('invalid_field', p + '.answer_input', 'answer_input is typed, pasted, mixed or spoken, or an object giving one per field.', 'typed');
      o.answer_input = e.answer_input;
    }
    return o;
  });
}

// Returns {spec, defaults_used, idempotency_key}. Money and pool access are checked by the caller.
// opts.quote: CALL-7 (D36), a quote prices without the material: content may be left out, priced from minutes.
export function normalizeCall(body0, now = Date.now(), opts = {}) {
  if (!body0 || typeof body0 !== 'object' || Array.isArray(body0)) throw fixable('invalid_json', 'body', 'The body is a JSON object holding the call.', null);
  let body = body0;
  const nestedKeys = Object.keys(body0).filter(k => NESTED.includes(k));
  if (nestedKeys.length) {
    if (now >= NESTED_UNTIL) throw unknownField(nestedKeys[0], TOP, nestedKeys[0]);
    body = fromNested(JSON.parse(JSON.stringify(body0)));
  }
  checkKeys(Object.fromEntries(Object.entries(body).filter(([k]) => k !== '__seconds')), TOP, '');
  const defaults = {};

  if (body.ask === undefined) throw fixable('missing_field', 'ask', 'ask is required: what the person reads first, in plain words.', EXAMPLE_ASK);
  if (typeof body.ask !== 'string' || !body.ask.trim() || body.ask.length > 2000) throw fixable('invalid_field', 'ask', 'ask is 1 to 2,000 characters of plain text.', typeof body.ask === 'string' ? body.ask.slice(0, 2000) : EXAMPLE_ASK);
  if (body.kind === undefined) throw fixable('missing_field', 'kind', `kind is required: one of ${KINDS.join(', ')}.`, 'listen');
  if (!KINDS.includes(body.kind)) throw fixable('invalid_field', 'kind', `kind is one of ${KINDS.join(', ')}.`, KINDS.find(k => typeof body.kind === 'string' && body.kind.toLowerCase().startsWith(k.slice(0, 3))) || 'listen');
  const kind = body.kind;
  let content;
  if (opts.quote && (body.content === undefined || body.content === null) && kind !== 'answer') { content = []; defaults.content = 'none yet: priced from minutes'; }
  else content = normContent(body.content, kind);

  if (body.people === undefined) throw fixable('missing_field', 'people', 'people is required: how many answers you want.', 3);
  if (!Number.isInteger(body.people) || body.people < 1 || body.people > LIMITS.max_people) throw fixable('invalid_field', 'people', `people is a whole number from 1 to ${LIMITS.max_people}.`, Math.min(LIMITS.max_people, Math.max(1, Math.round(Number(body.people)) || 3)));
  const people = body.people;

  let enough = body.enough;
  if (enough === undefined) { enough = Math.max(1, Math.ceil(people * 0.7)); defaults.enough = enough; }
  else if (!Number.isInteger(enough) || enough < 1 || enough > people) throw fixable('invalid_field', 'enough', 'enough is a whole number from 1 to people: how many answers make the call usable.', Math.max(1, Math.ceil(people * 0.7)));

  let pool = body.pool;
  if (pool === undefined) { pool = 'simulated'; defaults.pool = 'simulated'; }
  if (typeof pool !== 'string') throw fixable('unknown_pool', 'pool', 'pool is "simulated" or "panel:<panel_id>".', 'simulated', { pools: ['simulated'] });
  let pool_kind, panel_ref = null;
  if (pool === 'simulated') pool_kind = 'simulated';
  else if (pool === 'self') pool_kind = 'self';
  else if (ADAPTER_POOLS.includes(pool)) pool_kind = 'adapter';
  else if (/^panel:[A-Za-z0-9_-]{1,64}$/.test(pool)) { pool_kind = 'panel'; panel_ref = pool.slice(6); }
  else throw fixable('unknown_pool', 'pool', `No pool "${pool}" here. Pools: "simulated" (any key), "self" (the key's own holder, one of the demo asks) and "panel:<panel_id>" (a panel your principal made).`, 'simulated', { pools: ['simulated', 'self'] });

  const answer_fields = normFields(body.answer_fields, defaults);

  let minutes = body.minutes;
  if (minutes === undefined) {
    const sec = body.__seconds || (content.some(c => c.media_id === SAMPLE_ID) ? 30 : null);
    minutes = ['listen', 'watch'].includes(kind) && sec ? Math.ceil(sec / 60) + 1 : 2;
    defaults.minutes = minutes;
  } else if (typeof minutes !== 'number' || !(minutes >= 0.5 && minutes <= 120)) throw fixable('invalid_field', 'minutes', 'minutes is how long one person should take, 0.5 to 120.', 2);

  let pay_cents;
  if (body.pay_per_person_usd === undefined) {
    pay_cents = pool_kind === 'adapter' ? defaultPayCents(minutes) : 0;   // an outside pool pays its people; simulated and panels are unpaid
    defaults.pay_per_person_usd = fmt(pay_cents);
  }
  else { pay_cents = money(body.pay_per_person_usd, 'pay_per_person_usd'); if (pay_cents > 50000) throw fixable('invalid_field', 'pay_per_person_usd', 'pay_per_person_usd is at most 500.00.', '500.00'); }
  const floorCents = Math.ceil(PAY_FLOOR_CENTS_PER_HOUR * minutes / 60);
  // judged after the pool and the key's class (CALL-1's order): the caller throws it once the pool is known
  const floorError = pay_cents > 0 && pay_cents < floorCents ? fixable('below_pay_floor', 'pay_per_person_usd', `Send pay_per_person_usd "${fmt(floorCents)}" or more: each person is paid at least ${fmt(floorCents)} for ${minutes} minutes (${fmt(PAY_FLOOR_CENTS_PER_HOUR)} an hour); ${fmt(pay_cents)} is under it. Or ask for fewer minutes.`, fmt(floorCents)) : null;

  let deadline = body.deadline_minutes;
  if (deadline === undefined) { deadline = 120; defaults.deadline_minutes = 120; }
  else if (!Number.isInteger(deadline) || deadline < 1 || deadline > LIMITS.max_deadline_minutes) throw fixable('invalid_field', 'deadline_minutes', `deadline_minutes is a whole number from 1 to ${LIMITS.max_deadline_minutes}.`, 120);

  const require = normRequire(body.require, pool_kind);
  if (body.voice !== undefined) throw fixable('unsupported_feature', 'voice', 'Spoken answers are not offered yet; every person can type. Remove voice.', null);
  let content_rating = body.content_rating;
  if (content_rating === undefined) { content_rating = 'general'; defaults.content_rating = 'general'; }
  else if (content_rating !== 'general') throw fixable('invalid_field', 'content_rating', 'Only "general" in this version: no violent, sexual, medical or grief material, warned or not.', 'general');
  let may_train = body.may_train_on_answers;
  if (may_train === undefined) { may_train = false; defaults.may_train_on_answers = false; }
  else if (typeof may_train !== 'boolean') throw fixable('invalid_field', 'may_train_on_answers', 'may_train_on_answers is true or false.', false);

  let pace = body.pace;
  if (pace !== undefined && pool_kind !== 'simulated') throw fixable('invalid_field', 'pace', 'pace is for the simulated pool only; remove it.', null);
  if (pace === undefined) { pace = 'instant'; if (pool_kind === 'simulated') defaults.pace = 'instant'; }
  else if (!['instant', 'human'].includes(pace)) throw fixable('invalid_field', 'pace', 'pace is "instant" (answers within 10 seconds) or "human" (answers over 1 to 6 minutes).', 'instant');
  const script = normScript(body.script, people, pool_kind);

  let max_total_cents = null;
  if (body.max_total_usd !== undefined && body.max_total_usd !== null) max_total_cents = money(body.max_total_usd, 'max_total_usd');
  const idem = body.idempotency_key;
  if (idem !== undefined && (typeof idem !== 'string' || idem.length < 1 || idem.length > 128)) throw fixable('invalid_field', 'idempotency_key', 'idempotency_key is 1 to 128 characters, unique for each call you mean to open.', 'my-call-001');
  if (body.ext !== undefined && (!body.ext || typeof body.ext !== 'object' || Array.isArray(body.ext))) throw fixable('invalid_field', 'ext', 'ext is an object of extensions, each under a domain name.', null);

  const spec = { ask: body.ask, kind, content, people, enough, pool, pool_kind, panel_ref, answer_fields, minutes, pay_cents, deadline_minutes: deadline,
    require, content_rating, may_train_on_answers: may_train, pace, script, max_total_cents, media_seconds_hint: body.__seconds || null, ext: body.ext || null };
  Object.defineProperty(spec, 'floorError', { value: floorError, enumerable: false });   // not stored with the call
  // OWNER_all_6 item 2: the in-band ask for real strangers; kept apart (strangers.js), never in the stored call or its quote
  Object.defineProperty(spec, 'card_raw', { value: body.card === undefined ? null : body.card, enumerable: false });   // checked in calls.js (cards.js), then stored as spec.card
  Object.defineProperty(spec, 'wants_strangers', { value: body.wants_strangers !== undefined || (body.ext && body.ext['person.tools'] && body.ext['person.tools'].wants_strangers !== undefined) ? body : null, enumerable: false });
  return { spec, defaults_used: defaults, idempotency_key: idem };
}

export function contentOut(items) {
  const one = (c) => c.media_id || c.url || { text: c.text };
  return items.length === 0 ? null : (items.length === 1 && !items.is_list ? one(items[0]) : items.map(one));
}

// The call as the server understood it: defaults applied, every field in object form (CALL-2, CALL-6).
export function callOut(spec) {
  const o = { ask: spec.ask, kind: spec.kind, content: spec.kind === 'compare' ? spec.content.map(c => c.media_id || c.url || { text: c.text }) : (spec.content[0] ? (spec.content[0].media_id || spec.content[0].url || { text: spec.content[0].text }) : null),
    people: spec.people, enough: spec.enough, pool: spec.pool, answer_fields: spec.answer_fields, minutes: spec.minutes, pay_per_person_usd: fmt(spec.pay_cents),
    deadline_minutes: spec.deadline_minutes, require: spec.require, content_rating: spec.content_rating, may_train_on_answers: spec.may_train_on_answers,
    max_total_usd: spec.max_total_cents === null ? null : fmt(spec.max_total_cents) };
  if (spec.content.length === 0) delete o.content;
  if (!spec.require) delete o.require;
  if (spec.pool_kind === 'simulated') { o.pace = spec.pace; if (spec.script) o.script = spec.script; }
  return o;
}
