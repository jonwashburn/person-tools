// Evidence (spec section 14, rules version 1) and the record (section 10).
// The level is computed ONLY from record.observed, by levelFor(), for simulated and real people alike, so anyone can
// recompute it from detail=full (EVID-2). For real people, observed fields come from the events the router received,
// timed by the router's own clock; the runner's own summary is kept as a claim and never trusted (EVID-1).

const UNOBSERVED = {
  listen: ['audible', 'unassisted_answer', 'same_person'],
  watch: ['audible', 'eyes_on_screen', 'unassisted_answer', 'same_person'],
  view: ['eyes_on_screen', 'unassisted_answer', 'same_person'],
  play: ['eyes_on_screen', 'unassisted_answer', 'same_person'],
  answer: ['unassisted_answer', 'same_person'],
};
export function unobservedFor(kind, itemKinds = []) {
  if (kind !== 'compare') return UNOBSERVED[kind] || UNOBSERVED.answer;
  const s = new Set(); for (const k of itemKinds) for (const u of (UNOBSERVED[k] || [])) s.add(u);
  s.add('unassisted_answer'); s.add('same_person');
  return ['audible', 'eyes_on_screen', 'unassisted_answer', 'same_person'].filter(u => s.has(u));
}

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;

// -> { level: 'said'|'attended'|'voiced', reason: one plain sentence }
export function levelFor(kind, o, voiceSeconds = 0) {
  let att = false, why = '';
  if (kind === 'listen' || kind === 'watch') {
    const what = kind === 'listen' ? 'audio' : 'video';
    const a = o.played_seconds >= 0.9 * o.media_seconds, b = o.realtime_seconds >= 0.9 * o.played_seconds, c = o.visible_fraction >= 0.9;
    att = a && b && c;
    why = att ? `played ${Math.round(o.played_seconds)} of ${Math.round(o.media_seconds)} seconds at normal speed, page in front ${Math.round(o.visible_fraction * 100)}% of the time`
      : !a ? `played ${Math.round(100 * o.played_seconds / (o.media_seconds || 1))}% of the ${what}`
      : !b ? `played faster than normal speed (${r1(o.realtime_seconds)} s of clock time for ${r1(o.played_seconds)} s of ${what})`
      : `page in front only ${Math.round(o.visible_fraction * 100)}% of the time the ${what} played`;
  } else if (kind === 'view') {
    att = o.revealed === true && o.visible_seconds >= 5;
    why = att ? `looked for ${Math.round(o.visible_seconds)} seconds after showing it` : (o.revealed !== true ? 'never tapped to show the picture' : `in view for only ${r1(o.visible_seconds)} seconds`);
  } else if (kind === 'play') {
    att = o.session_seconds >= 30 && o.input_count >= 5;
    why = att ? `played for ${Math.round(o.session_seconds)} seconds with ${o.input_count} inputs` : (o.session_seconds < 30 ? `played for only ${Math.round(o.session_seconds)} seconds` : `only ${o.input_count} inputs`);
  } else if (kind === 'compare') {
    const items = o.items || [];
    const lv = items.map(it => levelFor(it.kind, it).level);
    att = items.length > 0 && lv.every(l => l === 'attended' || l === 'voiced');
    const short = lv.findIndex(l => l !== 'attended' && l !== 'voiced');   // R6: never items[-1]
    why = att ? `met every item as asked (${items.length} items)` : (short < 0 ? 'no item was shown' : `item ${short + 1} fell short: ${levelFor(items[short].kind, items[short]).reason}`);
  } else {
    att = false; why = 'answered; for this kind nothing more is shown';
  }
  if ((att || kind === 'answer') && voiceSeconds >= 3) return { level: 'voiced', reason: why + `, and spoke for ${Math.round(voiceSeconds)} seconds` };
  return { level: att ? 'attended' : 'said', reason: why };
}

export const RULE_NAME = (kind) => kind + '/1';

// ---------- real people: observed fields from the events the router received ----------

export function observedFromBatches(kind, batches, mediaSeconds, takenAt, endedAt, opts = {}) {
  const evs = [];
  for (const b of batches) {
    let body; try { body = JSON.parse(b.body_json); } catch { continue; }
    for (const e of (body.events || [])) evs.push({ seq: e.seq ?? null, t: Number(e.t ?? e.t_ms ?? 0), type: String(e.type || ''), pos: e.pos ?? e.pos_s, from: e.from, to: e.to, at: b.received_at, field: e.field,
      item: e.item, media_id: e.media_id, count: e.count, order: e.order });
  }
  evs.sort((a, b) => (a.seq != null && b.seq != null) ? a.seq - b.seq : a.t - b.t);
  const seat_seconds = takenAt ? Math.max(0, Math.round((endedAt - takenAt) / 1000)) : 0;
  const common = { seat_seconds, device: 'unknown' };
  for (const b of batches) { try { const x = JSON.parse(b.body_json); if (x.device && ['phone', 'tablet', 'desktop'].includes(x.device)) common.device = x.device; } catch { } }
  if (kind === 'answer') return common;
  if (kind === 'view') {
    let revealed = !!opts.text, visMs = 0, visStart = opts.text ? (evs.length ? evs[0].t : 0) : null, lastT = 0, scrolled = 0;
    for (const e of evs) {
      lastT = Math.max(lastT, e.t);
      if (e.type === 'reveal' || e.type === 'revealed') { revealed = true; if (visStart === null) visStart = e.t; }
      if ((e.type === 'hidden' || e.type === 'pagehide') && visStart !== null) { visMs += e.t - visStart; visStart = null; }
      if (e.type === 'visible' && revealed && visStart === null) visStart = e.t;
      if (e.type === 'scroll' && typeof e.pos === 'number') scrolled = Math.max(scrolled, Math.min(1, e.pos));
    }
    if (visStart !== null) visMs += Math.max(0, lastT - visStart);
    // never more than the router's own clock allows
    return { ...common, revealed, visible_seconds: r1(Math.min(visMs / 1000, seat_seconds)), scrolled_fraction: r2(scrolled) };
  }
  if (kind === 'play') {
    let inputs = 0;
    for (const e of evs) if (e.type === 'game_input') inputs += Math.max(0, Math.min(10000, Number(e.count) || 0));
    return { ...common, session_seconds: seat_seconds, input_count: inputs, ended: 'left' };   // 'finished' cannot be seen from a sandbox
  }
  // listen / watch (compare's items are added when the runner sends them per item)
  const media = mediaSeconds || 30;
  const intervals = []; let playing = false, lastPos = null, lastT = null;
  let pauses = 0, replays = 0, seeksFwd = 0, hiddenStart = null, hiddenDuringPlayMs = 0, playMs = 0, stalledMs = 0, stallStart = null;
  let coveredAt = null, mutedMs = 0, muteStart = null, completed = false;
  const add = (a, b) => { if (b > a) intervals.push([Math.max(0, a), Math.min(media, b)]); };
  const covered = () => {
    const iv = intervals.slice().sort((x, y) => x[0] - y[0]); let tot = 0, cs = null, ce = null;
    for (const [a, b] of iv) { if (cs === null) { cs = a; ce = b; } else if (a <= ce) ce = Math.max(ce, b); else { tot += ce - cs; cs = a; ce = b; } }
    if (cs !== null) tot += ce - cs; return tot;
  };
  for (const e of evs) {
    const pos = e.pos != null ? Number(e.pos) : null;
    switch (e.type) {
      case 'play': case 'playing':
        if (stallStart !== null) { stalledMs += e.t - stallStart; stallStart = null; }
        if (pos != null && lastPos != null && pos < lastPos - 1) replays++;
        if (!playing) { playing = true; } if (pos != null) lastPos = pos; lastT = e.t; break;
      case 'timeupdate': case 'tick': case 'pause': case 'ended': case 'waiting': case 'stalled': {
        if (playing && pos != null && lastPos != null) {
          const dt = Math.max(0, (e.t - lastT) / 1000);
          if (pos >= lastPos && pos - lastPos <= dt * 1.1 + 1.0) { add(lastPos, pos); playMs += Math.max(0, e.t - lastT); }
          else if (pos < lastPos - 1) replays++;
          lastPos = pos; lastT = e.t;
        } else if (pos != null) { lastPos = pos; lastT = e.t; }
        if (e.type === 'pause') { pauses++; playing = false; }
        if (e.type === 'ended') { playing = false; completed = true; }
        if ((e.type === 'waiting' || e.type === 'stalled') && stallStart === null) stallStart = e.t;
        break;
      }
      case 'seek': case 'seeked': {
        const to = e.to != null ? Number(e.to) : pos; const from = e.from != null ? Number(e.from) : lastPos;
        if (to != null && from != null && to > from + 1) seeksFwd++;
        if (to != null && from != null && to < from - 1) replays++;
        if (to != null) { lastPos = to; lastT = e.t; }
        break;
      }
      case 'hidden': case 'pagehide': if (hiddenStart === null) hiddenStart = { t: e.t, playing }; break;
      case 'visible': if (hiddenStart !== null) { const d = Math.max(0, e.t - hiddenStart.t); if (hiddenStart.playing || playing) hiddenDuringPlayMs += d; hiddenStart = null; } break;
      case 'mute': if (muteStart === null) muteStart = e.t; break;
      case 'unmute': if (muteStart !== null) { mutedMs += e.t - muteStart; muteStart = null; } break;
      default: break;
    }
    if (coveredAt === null && covered() >= 0.9 * media) coveredAt = e.at;
  }
  // a hidden span still open when the seat closed counts as hidden to the end of play: a lost last post never raises a level
  const lastEventT = evs.length ? Math.max(...evs.map(e => e.t)) : null;
  if (hiddenStart !== null && lastEventT !== null && (hiddenStart.playing || playing)) hiddenDuringPlayMs += Math.max(0, lastEventT - hiddenStart.t);
  const played = Math.min(media, covered());
  // realtime_seconds: the router's clock from taking the seat to the post that brought coverage to its final amount,
  // less the time the runner reported as stalled (never trusting the runner's clock to shorten it)
  const lastAt = batches.length ? batches[batches.length - 1].received_at : endedAt;
  const reach = coveredAt || lastAt;
  const routerSec = takenAt ? Math.max(0, (Math.min(reach, endedAt) - takenAt) / 1000) : 0;
  const stalled = Math.min(stalledMs / 1000, routerSec);
  const realtime = Math.max(0, routerSec - stalled);
  const playSec = Math.max(playMs / 1000, 0.001);
  const vis = played > 0 ? Math.max(0, 1 - (hiddenDuringPlayMs / 1000) / playSec) : 0;
  const o = { ...common, media_seconds: r1(media), played_seconds: r1(played), realtime_seconds: r1(Math.min(realtime, Math.max(played, realtime))), stalled_seconds: r1(stalled),
    visible_fraction: r2(Math.min(1, vis)), pauses, replays, seeks_forward: seeksFwd, completed: completed || played >= media - 0.5 };
  if (kind === 'watch') { o.muted_fraction = r2(Math.min(1, (mutedMs / 1000) / playSec)); o.revealed = evs.some(e => e.type === 'reveal' || e.type === 'revealed'); }
  return o;
}

// compare: the order the runner showed, then each item's own observed fields from the events that name that item.
export function compareObserved(batches, items, takenAt, endedAt) {
  const all = []; let pageEnd = 0;
  for (const b of batches) { let body; try { body = JSON.parse(b.body_json); } catch { continue; } if (Number(body.page_ms) > pageEnd) pageEnd = Number(body.page_ms); for (const e of (body.events || [])) all.push({ ...e, at: b.received_at }); }
  all.sort((a, b) => (a.seq != null && b.seq != null) ? a.seq - b.seq : (Number(a.t) || 0) - (Number(b.t) || 0));
  const front = new Map(); let cur = null, curT = 0;
  const keyOf = (e) => Number.isInteger(e.content_index) ? 'ci:' + e.content_index : (e.media_id || e.item);
  // Two short pieces can be on a phone's screen together: when the page sends in_view / out_of_view, each piece's time
  // is the sum of its own spans (runner, 4:49 AM CT); pages without them fall back to 'the one in front'.
  const isSpan = (e) => e.type === 'in_view' || e.type === 'out_of_view';
  const spans = new Map(), open = new Map();
  for (const e of all) { if (!isSpan(e)) continue; const k = keyOf(e); if (!k) continue; const t = Number(e.t) || 0;
    if (e.type === 'in_view') { if (!open.has(k)) open.set(k, t); }
    else if (open.has(k)) { spans.set(k, (spans.get(k) || 0) + Math.max(0, t - open.get(k))); open.delete(k); } }
  for (const [k, t0] of open) spans.set(k, (spans.get(k) || 0) + Math.max(0, Math.max(pageEnd, t0) - t0));
  for (const e of all) { if (isSpan(e)) continue; const key = keyOf(e); if (!key) continue; const t = Number(e.t) || 0; if (cur !== null) front.set(cur, (front.get(cur) || 0) + Math.max(0, t - curT)); cur = key; curT = t; }
  if (cur !== null) front.set(cur, (front.get(cur) || 0) + Math.max(0, Math.max(pageEnd, curT) - curT));
  const ids = items.map(i => i.media_id || null);
  const ord = all.find(e => e.type === 'order' && (Array.isArray(e.order_index) || Array.isArray(e.order)));
  const order = ord ? (Array.isArray(ord.order_index) ? ord.order_index.filter(i => Number.isInteger(i) && i >= 0 && i < items.length) : ord.order.map(id => ids.indexOf(id)).filter(i => i >= 0)) : null;
  const seat_seconds = takenAt ? Math.max(0, Math.round((endedAt - takenAt) / 1000)) : 0;
  const itemKind = (it) => it.text ? 'view' : it.kind === 'audio' ? 'listen' : it.kind === 'video' ? 'watch' : it.kind === 'build' ? 'play' : 'view';
  const perItem = items.map((it, i) => {
    const mine = all.filter(e => e.content_index === i || (!Number.isInteger(e.content_index) && ((it.media_id && e.media_id === it.media_id) || (!it.media_id && e.item === String.fromCharCode(65 + i)))));
    const k = itemKind(it);
    const o = observedFromBatches(k, [{ body_json: JSON.stringify({ events: mine }), received_at: endedAt }], it.seconds || 30, takenAt, endedAt, { text: !!it.text });
    delete o.seat_seconds; delete o.device;
    if (k === 'view') {   // the time this item was on screen (its spans), else the time it was the one in front
      const sk = spans.has('ci:' + i) ? 'ci:' + i : (it.media_id && spans.has(it.media_id) ? it.media_id : null);
      const ms = sk ? spans.get(sk) : (front.get('ci:' + i) || 0) + (front.get(it.media_id || String.fromCharCode(65 + i)) || 0);
      o.visible_seconds = Math.round(Math.min(ms / 1000, seat_seconds) * 10) / 10;
    }
    return { kind: k, ...o };
  });
  return { seat_seconds, device: 'unknown', order, items: perItem };
}

export async function evidenceFor(env, call, seat, now) {
  const spec = JSON.parse(call.spec_json);
  const batches = (await env.DB.prepare('SELECT body_json, received_at FROM events WHERE seat_id = ? ORDER BY id').bind(seat.id).all()).results || [];
  const item = (spec.items || [])[0] || {};
  const claim = lastSummary(batches);
  // The media's length: the stored file's when known; else the person's player's (an uploaded or copied file whose length
  // was not read); never the 30-second stand-in when the page says otherwise, so a long song is not "heard to the end"
  // after 30 seconds. The record says which.
  const pageLen = claim && Number(claim.media_seconds) > 0 && Number(claim.media_seconds) <= 4 * 3600 ? Number(claim.media_seconds) : null;
  const mediaLen = item.seconds || pageLen || spec.media_seconds_hint || 30;
  const observed = spec.kind === 'compare' ? compareObserved(batches, spec.items || [], seat.taken_at, now)
    : observedFromBatches(spec.kind, batches, mediaLen, seat.taken_at, now, { text: !!item.text });
  const lv = levelFor(spec.kind, observed);
  // where the length came from goes in the plain sentence (the observed object's fields are fixed by the standard's schema)
  if ((spec.kind === 'listen' || spec.kind === 'watch') && !item.seconds) {
    const from = pageLen ? ` The length (${Math.round(pageLen)} s) came from the person's player; the file's own was not read.` : ' The length of the material was not known: 30 seconds assumed.';
    lv.reason = (String(lv.reason || '').replace(/[.\s]+$/, '') + '.' + from).slice(0, 300);
  }
  const record = { rule: RULE_NAME(spec.kind), observed, unobserved: unobservedFor(spec.kind, (spec.items || []).map(i => i.kind)) };
  if (claim) record.runner_claim = claim;
  return { level: lv.level, reason: lv.reason, record };
}

function lastSummary(batches) {
  for (let i = batches.length - 1; i >= 0; i--) { try { const b = JSON.parse(batches[i].body_json); if (b.summary) return b.summary; } catch { } }
  return null;
}
