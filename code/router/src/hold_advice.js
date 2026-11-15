// What a held call says to the agent (OWNER_all_4 item 2, the CEO, 6:00 PM CT): until a named person watches held calls,
// a held call's own reply says in ONE plain sentence why it was held and in one more what to change so it passes, with a
// corrected ask when one exists, so an agent can fix its ask without us. TRUST owns the words: when screening gives a fix
// for the hold (hold.fix, or a reason's fix), it is used as it stands; the fallbacks below cover the rest.
// held_reason carries the two sentences (the standard's field); ext.hold carries the parts: fixable, field, example, rule.

const NOT_WORDS = {
  outside_unread: ['A call from an outside account to real people is read by a person before anyone is rung (within three days), until a model reads each call.',
    'Nothing in the words needs to change: on the simulated pool the call runs now; on real people it waits for that read.'],
  uninspected_material: ['The material comes from outside, and real people only see material a person has looked at first.',
    'To try it now, use one of our samples (GET /v1/media/samples) or the simulated pool; on real people it waits for that look (within three days).'],
  large_call: ['A call this large is read by a person before anyone is rung.', 'Ask fewer people or set a smaller max_total_usd, or wait for that read (within three days).'],
  new_principal_over_500: ['A new account\'s first large call is read by a person before anyone is rung.', 'Set a smaller max_total_usd for a first call, or wait for that read (within three days).'],
};

// After the model read (model_cap.js) the call is still held: say what the read did, never "no model reads calls"
function afterRead(mr) {
  const r = String((mr && mr.reason) || '');
  if (/daily cap/i.test(r)) return ['A call from an outside account to real people is read by a model before anyone is rung, and that read has stopped for today, so a person reads this one first (within three days).',
    'Nothing in the words needs to change; on the simulated pool the call runs now.'];
  if (/failed|could not be read|no daily cap/i.test(r)) return ['The model that reads calls from outside accounts could not read this one just now, so it is held and nobody is rung.',
    'Nothing in the words needs to change: a person reads it within three days, and on the simulated pool the call runs now.'];
  return ['A model read this call and did not clear it for real people, so a person reads it before anyone is rung (within three days).',
    'If the ask asks for anything beyond the person\'s own reaction to what the page shows, take that part out and send it again; otherwise wait for that read.'];
}

// the phrase screening matched, as the agent wrote it (the quoted part of "an action beyond reacting: \"follow\"")
function phraseOf(matched) {
  if (!matched) return null;
  const q = /"([^"]{1,80})"/.exec(String(matched));
  return (q ? q[1] : String(matched)).trim() || null;
}

// the ask without the sentence that holds the phrase, when something is left that still asks for a reaction
function exampleWithout(ask, phrase) {
  if (!ask || !phrase) return null;
  const parts = String(ask).split(/(?<=[.?!])\s+/);
  if (parts[0].toLowerCase().includes(phrase.toLowerCase())) return null;   // the first sentence says what the person meets: keep it whole
  const keep = parts.filter(p => !p.toLowerCase().includes(phrase.toLowerCase()));
  const out = keep.join(' ').trim();
  return keep.length && keep.length < parts.length && out.length >= 12 ? out : null;
}

const clean = (s) => String(s || '').trim().replace(/[.\s]+$/, '');

export function holdAdvice(sres, spec) {
  const r = (sres && sres.result) || {};
  const h = r.hold || {};
  // the reason to name first: one the agent can fix in its words; else that the caller is from outside; else the material
  const rs = h.reasons || [];
  const rank = (x) => !NOT_WORDS[x.rule] ? 0 : x.rule === 'outside_unread' ? 1 : x.rule === 'uninspected_material' ? 3 : 2;
  const reason = rs.slice().sort((a, b) => rank(a) - rank(b))[0] || { rule: (sres && sres.summary && sres.summary.rule) || 'undecided', why: (sres && sres.summary && sres.summary.reason) || 'screening could not decide' };
  const rule = reason.rule || 'undecided';
  const fired = (r.fired || []).filter(f => f.rule === rule);
  const phrase = phraseOf(fired[0] && fired[0].matched);
  // TRUST's words win: hold.reply (screening 1.3.12+) as given, unless a model read has since lifted the reason it names
  // (or it names outside_unread, which the read answers: afterRead below)
  const mr = r.model_read || null;
  const stillHeld = new Set(rs.map(x => x.rule));
  // screening 1.3.15+ rebuilds the reply after a read (rules model_read, model_read_cap, model_read_unavailable, or the reason
  // that still holds): used as given. An older reply written before the read is used only if its reason still holds and it
  // does not say that no model reads calls.
  const replyStands = !!(h.reply && h.reply.why && (!mr || /^(?:model|material)_read/.test(String(h.reply.rule || ''))
    || (stillHeld.has(h.reply.rule) && !/no model reads/i.test(String(h.reply.why)))));
  if (replyStands) {
    const rp = h.reply;
    const text = `${clean(rp.why)}. ${clean(rp.what_to_change)}.`;
    return { text, detail: { rule: rp.rule || rule, fixable: !!rp.fixable, field: rp.fixable ? (rp.field || 'ask') : null, why: rp.why, what_to_change: rp.what_to_change,
      corrected_example: rp.corrected_example === undefined ? null : rp.corrected_example, what_to_do: rp.what_to_do || null,
      to_pass: `${clean(rp.what_to_change)}.`, example: rp.corrected_example === undefined ? null : rp.corrected_example } };
  }
  const fx = (h.reply && !replyStands ? null : h.fix) || reason.fix || null;   // hold.fix repeats hold.reply's words
  let why, toPass, fixable, field = 'ask', example = null;
  if (fx) {
    why = fx.why || `Held: ${clean(reason.why)}${phrase ? ` ("${phrase}")` : ''}.`;
    toPass = fx.change || fx.fix || fx.to_pass || '';
    fixable = !!fx.fixable; field = fx.field || 'ask'; example = fx.example === undefined ? null : fx.example;
  } else if (rule === 'outside_unread' && mr) {
    [why, toPass] = afterRead(mr); fixable = false; field = null;
  } else if (NOT_WORDS[rule]) {
    [why, toPass] = NOT_WORDS[rule]; fixable = false; field = null;
  } else if (/could not run|cannot run|missing/i.test(reason.why || '')) {
    why = 'Screening could not run just now, so the call is held, never rung.'; toPass = 'Send the same call again in a minute.'; fixable = false; field = null;
  } else {
    why = `Held because the ask has ${phrase ? `words screening reads two ways: "${phrase}"` : clean(reason.why)}.`;
    example = exampleWithout(spec && spec.ask, phrase);
    toPass = phrase ? `Reword or leave out "${phrase}", asking only for the person's own reaction to the material${example ? ', as in the example' : ''}.`
      : 'Ask only for the person\'s own reaction to the material, in plain words.';
    fixable = true;
  }
  const text = `${clean(why)}. ${clean(toPass)}.`;
  return { text, detail: { rule, fixable, field, to_pass: `${clean(toPass)}.`, example } };
}
