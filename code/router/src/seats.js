// What the runner (the page a person opens) says to the router, and the member's own list of offers (chief D8).
import { rid, nowMs, iso, fmt, signSeatToken, readSeatToken, sha256hex, runnerBase, apiBase } from './util.js';
import { settle, finishPanelSeat, offerFor, answeredFor } from './calls.js';
import { notFixable, fixable } from './spec.js';
import { BUILD } from './build_info.js';
import { isOn, inQuietHours, nextRingAt } from './rings.js';

const RECORDED = {
  listen: ['When the audio plays, pauses, skips and ends, and how much of it played', 'Whether this page was in front or in the background',
    'Your answers, and whether each was typed or pasted', 'Not recorded: your voice, your camera, your keystrokes, your location'],
  watch: ['When the video plays, pauses, skips and ends, and how much of it played', 'Whether this page was in front or in the background',
    'Your answers, and whether each was typed or pasted', 'Not recorded: your voice, your camera, your keystrokes, your location'],
  default: ['How long the call was open on your screen, and whether this page was in front', 'Your answers, and whether each was typed or pasted',
    'Not recorded: your voice, your camera, your keystrokes, your location'],
};

export async function seatLink(env, request, seat, call, memberId) {
  const tok = await signSeatToken(env.SEAT_SECRET, { seat: seat.id, call: call.id, mb: memberId, exp: call.deadline_at + 86400000 });
  return { token: tok, url: runnerBase(request) + '/c/' + tok };
}

async function loadSeat(env, token) {
  const p = await readSeatToken(env.SEAT_SECRET, token);
  if (!p) throw notFixable(404, 'not_found', 'This link is not valid.');
  if (p.exp && nowMs() > p.exp) throw notFixable(410, 'offer_expired', 'This link has expired.');
  const seat = await env.DB.prepare('SELECT * FROM seats WHERE id = ? AND call_id = ?').bind(p.seat, p.call).first();
  if (!seat) throw notFixable(404, 'not_found', 'This link is not valid.');
  const call = await env.DB.prepare('SELECT * FROM calls WHERE id = ?').bind(p.call).first();
  if (typeof p.mb === 'string' && p.mb.startsWith('pool:')) {   // a person an outside pool sent: their own seat, nothing else
    if (!call || !call.pool_ref || !seat.pool_pid || p.mb !== 'pool:' + seat.id || seat.member_id !== p.mb) throw notFixable(404, 'not_found', 'This link is not valid.');
    return { p, seat, call };
  }
  const m = await env.DB.prepare('SELECT left_at, panel_id FROM members WHERE id = ?').bind(p.mb).first();
  if (!m || m.left_at || m.panel_id !== call.panel_id) throw notFixable(404, 'not_found', 'This link is not valid.');
  return { p, seat, call };
}

function statusFor(seat, call, mb, counts, now) {
  if (seat.member_id) return seat.member_id === mb ? seat.state : 'full';
  const closed = !!call.closed_at || !['open'].includes(call.status) || now > call.deadline_at || call.reported_at;
  if (closed) return 'closed';
  if (counts.answered + counts.taken >= call.people) return 'full';
  if (seat.state === 'offered') return seat.offered_to === mb && seat.offer_expires_at > now ? 'offered' : 'expired';
  if (['expired', 'released'].includes(seat.state)) return 'expired';
  return 'offered';
}

async function card(env, request, seat, call, mb) {
  const spec = JSON.parse(call.spec_json);
  const principal = await env.DB.prepare('SELECT * FROM principals WHERE id = ?').bind(call.principal_id).first();
  const panel = call.panel_id ? await env.DB.prepare('SELECT * FROM panels WHERE id = ?').bind(call.panel_id).first() : null;
  const nMembers = panel ? (await env.DB.prepare('SELECT COUNT(*) AS n FROM members WHERE panel_id = ? AND left_at IS NULL').bind(panel.id).first()).n : 0;
  const rows = (await env.DB.prepare('SELECT state, COUNT(*) AS n FROM seats WHERE call_id = ? GROUP BY state').bind(call.id).all()).results || [];
  const counts = { answered: 0, taken: 0 }; for (const r of rows) counts[r.state] = r.n;
  const now = nowMs();
  const item = (spec.items || [])[0] || {};
  const unpaid = call.pay_cents === 0;
  const offer = offerFor(call, spec, answeredFor(principal, call), nMembers);
  return {
    seat_id: seat.id, call_id: call.id,
    status: statusFor(seat, call, mb, counts, now),
    offer_expires_at: iso(seat.offer_expires_at),
    asker: { name: answeredFor(principal, call), note: principal && principal.class === 'test' ? 'a test: nobody is paid' : undefined },
    asker_is_ai: true,
    ask: call.ask,
    minutes: call.est_minutes,
    pay: { per_person_usd: fmt(call.pay_cents), unpaid_test: unpaid, per_hour_usd: offer.pay_per_hour_usd, test_money: true },
    kept_days: offer.kept_days, kept: offer.kept, download_bytes: offer.download_bytes, may_train_on_answers: offer.may_train_on_answers,
    evidence: seat.evidence || null, paid_usd: seat.pay_cents != null ? fmt(seat.pay_cents) : null,
    content_rating: spec.content_rating || 'general',
    recorded: offer.recorded,
    experience: { kind: spec.kind, media_id: item.media_id || null, media_ids: (spec.items || []).map(i => i.media_id).filter(Boolean), seconds: item.seconds || spec.media_seconds_hint || null, text: item.text || null,
      items: (spec.items || []).map((it, i) => it.text != null ? { content_index: i, text: it.text } : { content_index: i, media_id: it.media_id || null, kind: it.kind || null, content_type: it.content_type || null, seconds: it.seconds || null, bytes: it.bytes || null }),
      media_url: item.media_id ? '/v1/seats/{token}/media' : null },
    fields: spec.answer_fields,
    panel: panel ? { name: panel.name, members: nMembers, anonymous: nMembers >= 5 } : null,
    simulated_person: false,
    deadline: iso(call.deadline_at),
    report: 'POST /v1/seats/{token}/stop with {"reason":"upset"} stops the call for everyone and reaches the operator; you are paid in full.',
    ...(spec.card ? { card: spec.card } : {}),   // OWNER_router_9: drawn by the client within its limits; "asker" stays the service's own
  };
}

export async function getSeat(env, request, token) {
  const { p, seat, call } = await loadSeat(env, token);
  await settle(env, request, { callId: call.id });
  const s2 = await env.DB.prepare('SELECT * FROM seats WHERE id = ?').bind(seat.id).first();
  return card(env, request, s2, call, p.mb);
}

export async function takeSeat(env, request, token) {
  const { p, seat, call } = await loadSeat(env, token);
  const now = nowMs();
  if (seat.member_id === p.mb && seat.state === 'taken') return { status: 200, body: await card(env, request, seat, call, p.mb) };
  if (call.status !== 'open' || now > call.deadline_at || call.reported_at) throw notFixable(410, 'call_closed', 'This call has closed. Nothing is owed to it; thank you.');
  const timeout = now + Math.max(call.est_minutes * 3 * 60000, 30 * 60000);
  // take the seat with one conditional update and read the count of changed rows (never a silent WHERE)
  const r = await env.DB.prepare(`UPDATE seats SET state = 'taken', member_id = ?, taken_at = ?, due_at = ?
      WHERE id = ? AND state = 'offered' AND offered_to = ? AND offer_expires_at > ?
      AND EXISTS (SELECT 1 FROM members WHERE id = ? AND panel_id = ? AND left_at IS NULL)`)
    .bind(p.mb, now, timeout, seat.id, p.mb, now, p.mb, call.panel_id).run();
  if (r.meta.changes !== 1) {
    const s2 = await env.DB.prepare('SELECT * FROM seats WHERE id = ?').bind(seat.id).first();
    if (s2.state === 'offered' && s2.offered_to === p.mb && s2.offer_expires_at <= now) throw notFixable(410, 'offer_expired', 'The time this offer was held for you has passed.');
    throw notFixable(409, 'call_full', 'This call is full. Nothing is owed to it, and nothing is marked against you.');
  }
  await env.DB.prepare('UPDATE members SET missed_rings = 0 WHERE id = ?').bind(p.mb).run();
  const s3 = await env.DB.prepare('SELECT * FROM seats WHERE id = ?').bind(seat.id).first();
  return { status: 200, body: await card(env, request, s3, call, p.mb) };
}

async function insideSeat(env, token) {
  const x = await loadSeat(env, token);
  if (x.seat.member_id !== x.p.mb) throw notFixable(409, 'not_your_seat', 'This seat is not taken by this link.');
  return x;
}

export async function postEvents(env, request, token, body) {
  const { seat } = await insideSeat(env, token);
  if (seat.state !== 'taken') return { accepted: 0, note: 'the seat is already finished' };
  const text = JSON.stringify(body || {});
  if (text.length > 65536) throw notFixable(413, 'too_large', 'An events post is at most 64 KB.');
  // one conditional insert: at most 2,000 posts and 1 MB a seat in all
  const r = await env.DB.prepare(`INSERT INTO events (seat_id, received_at, body_json) SELECT ?, ?, ? WHERE
      (SELECT COUNT(*) FROM events WHERE seat_id = ?) < 2000 AND (SELECT COALESCE(SUM(LENGTH(body_json)), 0) FROM events WHERE seat_id = ?) + ? <= 1048576`)
    .bind(seat.id, nowMs(), text, seat.id, seat.id, text.length).run();
  if (r.meta.changes !== 1) return { accepted: 0, note: 'the limit of events for this seat is reached' };
  return { accepted: (body && Array.isArray(body.events)) ? body.events.length : 0, received_at: iso(nowMs()) };
}

function checkAnswers(fields, answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw fixable('invalid_field', 'answers', 'answers is an object keyed by field name.', {});
  const out = {};
  for (const [name, f] of Object.entries(fields)) {
    let v = answers[name];
    if (v === undefined || v === null || v === '') continue;
    if (f.type === 'boolean') v = v === true || v === 'true' || v === 'yes';
    else if (f.type === 'choice') { v = String(v); if (!(f.choices || []).includes(v)) throw fixable('invalid_field', 'answers.' + name, `${name} is one of ${(f.choices || []).join(', ')}.`, (f.choices || [])[0] || null); }
    else if (f.type === 'scale' || f.type === 'number') { v = Number(v); if (!isFinite(v)) throw fixable('invalid_field', 'answers.' + name, `${name} is a number.`, 1); }
    else v = String(v).slice(0, 5000);
    out[name] = v;
  }
  return out;
}

function inputOf(fields, ai) {
  const out = {};
  for (const name of Object.keys(fields)) {
    const x = ai && ai[name];
    if (!x) continue;
    const how = typeof x === 'string' ? x : x.how;
    out[name] = { how: ['typed', 'pasted', 'mixed', 'spoken', 'tapped'].includes(how) ? how : 'typed' };
    if (x && typeof x === 'object') { if (x.typed_chars != null) out[name].typed_chars = Number(x.typed_chars) || 0; if (x.pasted_chars != null) out[name].pasted_chars = Number(x.pasted_chars) || 0; }
  }
  return out;
}

export async function postResponse(env, request, token, body) {
  const { seat, call } = await insideSeat(env, token);
  const spec = JSON.parse(call.spec_json);
  if (seat.state !== 'taken') {
    const rc = await env.DB.prepare('SELECT id, body_json FROM receipts WHERE seat_id = ?').bind(seat.id).first();
    if (rc) { const b = JSON.parse(rc.body_json); return { receipt_id: rc.id, receipt_url: apiBase(request) + '/v1/receipts/' + rc.id, paid_usd: b.paid_usd, unpaid_test: b.unpaid, evidence: b.evidence, test_money: true, repeated: true, ...(seat.state === 'answered' ? await returnTo(env, request, call) : {}) }; }
    throw notFixable(409, 'seat_finished', 'This seat is already finished.');
  }
  const answers = checkAnswers(spec.answer_fields, body && body.answers);
  if (Object.keys(answers).length === 0) throw fixable('missing_field', 'answers', 'Send at least one answer.', {});
  const r = await finishPanelSeat(env, request, call, seat, { reason: null, answers, input: inputOf(spec.answer_fields, body && body.answer_input), partial: false }, nowMs());
  if (r.already) return postResponse(env, request, token, body);
  return { receipt_id: r.receipt_id, receipt_url: apiBase(request) + '/v1/receipts/' + r.receipt_id, paid_usd: r.paid_usd, unpaid_test: r.unpaid, evidence: r.evidence, test_money: true, ...(await returnTo(env, request, call)) };
}

export async function postStop(env, request, token, body) {
  const { p, seat, call } = await loadSeat(env, token);
  const reason = ['stop', 'upset', 'decline'].includes(body && body.reason) ? body.reason : 'stop';
  const now = nowMs();
  if (reason === 'decline' || (seat.state === 'offered' && seat.offered_to === p.mb)) {
    // declining is free and leaves no mark: the seat goes back to be offered to someone else
    const r = await env.DB.prepare('UPDATE seats SET state = \'waiting\', offered_to = NULL, offer_expires_at = NULL, due_at = ? WHERE id = ? AND state = \'offered\' AND offered_to = ?').bind(now, seat.id, p.mb).run();
    if (r.meta.changes === 1) await env.DB.prepare('INSERT INTO events (seat_id, received_at, body_json) VALUES (?,?,?)').bind(seat.id, now, JSON.stringify({ declined_by: p.mb })).run();
    if (reason !== 'upset') return { paid_usd: '0.00', note: 'declined; nothing is marked against you', test_money: true };
  }
  if (reason === 'upset') {   // "report this call": nobody else is offered it, and the operator reads it (FAIR-5)
    const scr = JSON.parse(call.screening_json || '{}');
    Object.assign(scr, { held_reason: 'A person who was asked reported this call; nobody else is asked until the operator reviews it.', held_rule: 'report_this_call', review_by: new Date(Math.min(now + 86400000, call.deadline_at)).toISOString().replace(/\.\d{3}Z$/, 'Z') });
    await env.DB.batch([
      env.DB.prepare('UPDATE calls SET reported_at = COALESCE(reported_at, ?), status = CASE WHEN status = \'open\' THEN \'held\' ELSE status END, screening_json = ? WHERE id = ?').bind(now, JSON.stringify(scr), call.id),
      env.DB.prepare('INSERT OR IGNORE INTO held_calls (call_id, reason, rule, created_at) VALUES (?,?,?,?)').bind(call.id, 'reported by a person who was asked: it upset them', 'report_this_call', now),
      env.DB.prepare('UPDATE seats SET state = \'released\', stop_reason = \'withdrawn\', offered_to = NULL, due_at = NULL WHERE call_id = ? AND state IN (\'waiting\',\'offered\')').bind(call.id),
    ]);
    // OWN_PANELS.md rule 9: two reports about one principal's calls in 30 days pause all of its own panels until a person reads them
    try {
      const r2 = await env.DB.prepare('SELECT COUNT(*) AS n FROM calls WHERE principal_id = ? AND reported_at > ?').bind(call.principal_id, now - 30 * 86400000).first();
      if (r2 && r2.n >= 2) await env.DB.prepare('UPDATE panels SET paused_at = ? WHERE principal_id = ? AND kind = \'private\' AND paused_at IS NULL AND principal_id IN (SELECT id FROM principals WHERE class != \'real\')').bind(now, call.principal_id).run();
    } catch { }
  }
  if (seat.state !== 'taken' || seat.member_id !== p.mb) return { paid_usd: '0.00', reported: reason === 'upset', test_money: true };
  const spec = JSON.parse(call.spec_json);
  let answers = null, input = null;
  if (body && body.send_partial && body.answers) { answers = checkAnswers(spec.answer_fields, body.answers); input = inputOf(spec.answer_fields, body.answer_input); if (!Object.keys(answers).length) answers = null; }
  const r = await finishPanelSeat(env, request, call, seat, { reason, answers, input, partial: true, fullPay: reason === 'upset' }, now);
  return { paid_usd: r.paid_usd || '0.00', receipt_id: r.receipt_id, receipt_url: r.receipt_id ? apiBase(request) + '/v1/receipts/' + r.receipt_id : undefined, reported: reason === 'upset', evidence: r.evidence, test_money: true, ...(seat.pool_pid ? await returnTo(env, request, call, 'stopped') : {}) };   // R15: the answer's code only after an answer; a stop gets the pool's reviewed stop code (CEO 4:25 AM CT 15 Nov)
}

// How many had answered when the latest delivered line was sent (runner, 8:47): the same number as outcomes[].people.
function peopleOf(outcomesJson, text) {
  if (!text) return null;
  try { const d = JSON.parse(outcomesJson || '[]').filter(o => o.status === 'delivered' && o.text === text).pop(); return d && Number.isInteger(d.people) ? d.people : null; } catch { return null; }
}

// A person an outside pool sent goes back to it when their seat ends (its completion address; the pool then pays them).
async function returnTo(env, request, call, how = 'answered') {
  if (!call.pool_ref) return {};
  const { poolReturn } = await import('./calls.js');
  try { const u = await poolReturn(env, request, call, how); return u ? { return_to: u } : {}; } catch { return {}; }
}

// What the person did, in the kind's main observed numbers, shown beside their receipt (unsigned).
function heardOf(recordJson) {
  if (!recordJson) return null;
  let o; try { o = JSON.parse(recordJson).observed || {}; } catch { return null; }
  if (o.media_seconds != null) return { played_seconds: o.played_seconds, media_seconds: o.media_seconds };
  if (o.visible_seconds != null) return { visible_seconds: o.visible_seconds };
  if (o.session_seconds != null) return { session_seconds: o.session_seconds };
  return o.seat_seconds != null ? { seat_seconds: o.seat_seconds } : null;
}

export async function seatReceipt(env, request, token) {
  const { p, seat, call } = await loadSeat(env, token);
  if (seat.member_id !== p.mb) throw notFixable(404, 'not_found', 'No receipt for this link.');
  const rc = await env.DB.prepare('SELECT id, body_json, signature FROM receipts WHERE seat_id = ?').bind(seat.id).first();
  if (!rc) throw notFixable(404, 'not_found', 'No receipt yet: it is issued when the seat ends.');
  const outs = JSON.parse(call.outcomes_json || '[]').filter(o => o.status === 'delivered').map(o => ({ text: o.text, at: o.at, ...(Number.isInteger(o.people) ? { people: o.people } : {}) }));
  const resp = await env.DB.prepare('SELECT record_json FROM responses WHERE seat_id = ?').bind(seat.id).first();
  return { receipt_id: rc.id, receipt: JSON.parse(rc.body_json), jws: rc.signature, ask: call.ask, heard: heardOf(resp && resp.record_json), outcomes: outs, verify: apiBase(request) + '/v1/receipts/verify', test_money: true };
}

export async function seatMedia(env, request, token, mediaId) {
  const { p, seat, call } = await loadSeat(env, token);
  if (!((seat.state === 'offered' && seat.offered_to === p.mb) || (seat.member_id === p.mb)))
    throw notFixable(403, 'not_your_seat', 'Material is shown only to the person holding this seat.');
  const spec = JSON.parse(call.spec_json);
  const ids = (spec.items || []).map(i => i.media_id).filter(Boolean);
  const id = mediaId || ids[0];
  if (!id || !ids.includes(id)) throw notFixable(404, 'not_found', 'No such material on this call.');
  return serveMedia(env, request, id);
}

export async function serveMedia(env, request, id) {
  const m = await env.DB.prepare('SELECT * FROM media WHERE id = ?').bind(id).first();
  if (!m) throw notFixable(404, 'not_found', 'No such material.');
  const range = request.headers.get('range');
  let obj;
  const size = m.bytes;
  let start = 0, end = size - 1, partial = false;
  if (range) {
    const mm = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (mm) {
      if (mm[1] === '' && mm[2] !== '') { start = Math.max(0, size - parseInt(mm[2], 10)); }
      else { start = parseInt(mm[1] || '0', 10); if (mm[2] !== '') end = Math.min(size - 1, parseInt(mm[2], 10)); }
      if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      partial = true;
    }
  }
  obj = await env.MEDIA.get(m.r2_key, partial ? { range: { offset: start, length: end - start + 1 } } : undefined);
  if (!obj) throw notFixable(404, 'not_found', 'The material is missing from storage.');
  const h = new Headers({ 'Content-Type': m.content_type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff' });
  if (partial) { h.set('Content-Range', `bytes ${start}-${end}/${size}`); h.set('Content-Length', String(end - start + 1)); }
  else h.set('Content-Length', String(size));
  return new Response(obj.body, { status: partial ? 206 : 200, headers: h });
}

// ---------- a member's own page data (chief D8) ----------

// OWNER_router_12 item 2: a passkey session (ps_) acts for one membership joined to its person (SPEC 4.5.1a: joined by its own
// credential); app.js checks that and stands it in here for that one request, under a one-minute name that is never returned
export const SESSION_MEMBERS = new Map();
export async function memberByToken(env, token) {
  const sm = typeof token === 'string' ? SESSION_MEMBERS.get(token) : null;
  if (sm) {
    if (sm.until < Date.now()) { SESSION_MEMBERS.delete(token); throw notFixable(404, 'not_found', 'This link is not valid.'); }
    const m = await env.DB.prepare('SELECT * FROM members WHERE id = ? AND left_at IS NULL').bind(sm.member).first();
    if (!m) throw notFixable(404, 'not_found', 'That membership has left.');
    return m;
  }
  if (typeof token !== 'string' || !token.startsWith('mt_')) throw notFixable(404, 'not_found', 'This link is not valid.');
  const h = await sha256hex(token);
  const m = await env.DB.prepare('SELECT * FROM members WHERE token_hash = ? AND left_at IS NULL').bind(h).first();
  if (!m) {   // OWN_PANELS.md rule 10: told once that the panel is gone
    const g = await env.DB.prepare('SELECT id, gone_note FROM members WHERE token_hash = ? AND left_at IS NOT NULL AND gone_note IS NOT NULL').bind(h).first().catch(() => null);
    if (g) { await env.DB.prepare('UPDATE members SET gone_note = NULL WHERE id = ?').bind(g.id).run(); throw notFixable(410, 'panel_gone', g.gone_note); }
    throw notFixable(404, 'not_found', 'This link is not valid.');
  }
  return m;
}

async function waitingOnPanel(env, m, now) {
  if (isOn(m, now) && !inQuietHours(m, now)) return 0;
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM calls c WHERE c.panel_id = ? AND c.status = \'open\' AND c.deadline_at > ? AND NOT EXISTS (SELECT 1 FROM seats s WHERE s.call_id = c.id AND s.offered_to = ?)').bind(m.panel_id, now, m.id).first();
  return r ? r.n : 0;
}

export async function memberOffers(env, request, token) {
  const m = await memberByToken(env, token);
  // settle the calls this member's panel has open, so offers are current
  const open = (await env.DB.prepare('SELECT id FROM calls WHERE panel_id = ? AND status = \'open\' LIMIT 10').bind(m.panel_id).all()).results || [];
  for (const c of open) await settle(env, request, { callId: c.id });
  const now = nowMs();
  const rows = (await env.DB.prepare(`SELECT s.*, c.ask, c.est_minutes, c.pay_cents, c.kind, c.deadline_at FROM seats s JOIN calls c ON c.id = s.call_id
      WHERE ((s.state = 'offered' AND s.offered_to = ? AND s.offer_expires_at > ?) OR (s.state = 'taken' AND s.member_id = ?)) AND c.reported_at IS NULL
        AND NOT (s.state = 'offered' AND c.principal_id IN (SELECT principal_id FROM blocks WHERE member_id = ?))   -- WEB 3:21: a blocked asker's offer leaves the list at once
      ORDER BY s.offer_expires_at`).bind(m.id, now, m.id, m.id).all()).results || [];
  const offers = [];
  for (const s of rows) {
    if (s.state === 'offered') {   // the page shows it: the offer reached them (RING_RULES, chief's ruling 2:38 PM CT)
      const seen = JSON.stringify({ seen_by: m.id });
      if (!(await env.DB.prepare('SELECT 1 AS x FROM events WHERE seat_id = ? AND body_json = ? AND received_at >= ? LIMIT 1').bind(s.id, seen, (s.offer_expires_at || now) - 905000).first()))   // once per offer: holds run up to 15 minutes (private panels)
        await env.DB.prepare('INSERT INTO events (seat_id, received_at, body_json) VALUES (?,?,?)').bind(s.id, now, seen).run();
    }
    const call = { id: s.call_id, deadline_at: s.deadline_at };
    const link = await seatLink(env, request, s, call, m.id);
    const pr = await env.DB.prepare('SELECT CASE WHEN c.asker_name IS NOT NULL THEN c.asker_name || \' (named by the asker; not checked by person.tools)\' ELSE p.name END AS name FROM principals p JOIN calls c ON c.principal_id = p.id WHERE c.id = ?').bind(s.call_id).first();
    offers.push({ seat_id: s.id, call_id: s.call_id, state: s.state, ask: s.ask, kind: s.kind, minutes: s.est_minutes,
      pay: { per_person_usd: fmt(s.pay_cents), unpaid_test: s.pay_cents === 0 }, asker: { name: pr ? pr.name : 'not stated' },
      notification: s.pay_cents === 0 ? 'An unpaid test call' : `A call for you: ${s.est_minutes} minutes, ${fmt(s.pay_cents)}`,
      held_until: iso(s.offer_expires_at), seat_token: link.token, seat_url: link.url });
  }
  const rung = ((await env.DB.prepare('SELECT s.offer_expires_at - CASE WHEN c.panel_id IN (SELECT id FROM panels WHERE kind = \'private\') THEN 900000 WHEN COALESCE(?, 0) = 1 THEN 180000 ELSE 60000 END AS t FROM seats s JOIN calls c ON c.id = s.call_id WHERE (s.offered_to = ? OR s.member_id = ?) AND s.offer_expires_at IS NOT NULL AND s.offer_expires_at > ? ORDER BY s.offer_expires_at').bind(m.slow_hold, m.id, m.id, now - 3600000).all()).results || []).map(x => x.t).filter(t => t > now - 3600000);
  return { member_id: m.id, on: m.on_state, on_until: iso(m.on_until), quiet: { start: m.quiet_start, end: m.quiet_end, tz: m.tz }, settings: { longer_hold: !!m.slow_hold, sounds: m.sounds !== 0 },
    silent: m.sounds === 0,   // OWNER_router_6: the page's ring shows with no sound (sw.js reads this when a push arrives)
    ring_cap: { used: rung.length, limit: 4, resets_at: rung.length ? iso(rung[0] + 3600000) : null, applies: !!m.is_real }, missed_rings: m.missed_rings || 0,
    // the person's side of MONEY-11/FAIR-9: in quiet hours nothing rings; calls waiting on this panel, and when one could ring
    quiet_now: inQuietHours(m, now), next_ring_at: iso(nextRingAt(m, now)), calls_waiting: await waitingOnPanel(env, m, now),
    // offers in the last day that lapsed without reaching this person (no ring delivered, page closed): they count for nothing
    calls_not_reached: ((await env.DB.prepare('SELECT COUNT(*) AS n FROM events e JOIN seats s ON s.id = e.seat_id JOIN calls c ON c.id = s.call_id WHERE c.panel_id = ? AND e.body_json = ? AND e.received_at > ?').bind(m.panel_id, JSON.stringify({ unreached: m.id }), now - 86400000).first()) || {}).n || 0,
    offers, checked_at: iso(now), look_again_after_seconds: 10 };
}

export async function memberReceipts(env, request, token) {
  const m = await memberByToken(env, token);
  const rows = (await env.DB.prepare('SELECT r.id, r.seat_id, r.body_json, r.signature, r.key_id, c.what_changed, c.what_changed_at, c.outcomes_json, c.ask, (SELECT record_json FROM responses WHERE seat_id = r.seat_id) AS record_json FROM receipts r JOIN calls c ON c.id = r.call_id WHERE r.member_id = ? ORDER BY r.created_at').bind(m.id).all()).results || [];
  return { member_id: m.id, receipts: rows.map(r => ({ receipt: JSON.parse(r.body_json), jws: r.signature, ask: r.ask, heard: heardOf(r.record_json), what_changed: r.what_changed || null, what_changed_at: r.what_changed ? iso(r.what_changed_at) : null, what_changed_people: peopleOf(r.outcomes_json, r.what_changed) })),
    verify: 'POST /v1/receipts/verify with {"jws": "..."}', test_money: true };
}

// P7: leave and delete everything, in one tap (the page offers to save receipts first). What goes: the member's answers,
// records (events), receipts and settings; the link stops working. What stays: the ledger lines (money law), which name
// only an opaque id, and the asker's copy of answers it already received.
export async function memberLeave(env, request, token, body) {
  const m = await memberByToken(env, token);
  if (!body || body.confirm !== true) throw fixable('missing_field', 'confirm', 'Send {"confirm": true} to leave and delete everything. Save your receipts first if you want them.', true);
  const now = nowMs();
  // a seat in progress ends first, paid for the time so far; open offers go back to be offered to someone else
  const inside = (await env.DB.prepare('SELECT * FROM seats WHERE member_id = ? AND state = \'taken\'').bind(m.id).all()).results || [];
  for (const s of inside) { const call = await env.DB.prepare('SELECT * FROM calls WHERE id = ?').bind(s.call_id).first(); await finishPanelSeat(env, request, call, s, { reason: 'stop', answers: null, input: null, partial: true }, now); }
  await env.DB.prepare('UPDATE seats SET state = \'waiting\', offered_to = NULL, offer_expires_at = NULL, due_at = ? WHERE offered_to = ? AND state = \'offered\'').bind(now, m.id).run();
  const seatIds = '(SELECT id FROM seats WHERE member_id = ?)';
  const r = await env.DB.batch([
    env.DB.prepare(`DELETE FROM responses WHERE seat_id IN ${seatIds}`).bind(m.id),
    env.DB.prepare(`DELETE FROM events WHERE seat_id IN ${seatIds} OR seat_id IN (SELECT id FROM seats WHERE offered_to = ?)`).bind(m.id, m.id),
    env.DB.prepare('DELETE FROM receipts WHERE member_id = ?').bind(m.id),
    env.DB.prepare('DELETE FROM feedback WHERE member_id = ?').bind(m.id),
    env.DB.prepare('UPDATE members SET token_hash = ?, alias = \'\', push_json = NULL, apns_token = NULL, apns_env = NULL, tz = \'\', on_state = \'off\', on_until = NULL, left_at = ? WHERE id = ?').bind('left:' + m.id, now, m.id),
  ]);
  return { left: true, deleted: { answers: r[0].meta.changes, records: r[1].meta.changes, receipts: r[2].meta.changes, feedback: r[3].meta.changes }, link: 'no longer works',
    kept: 'Money records name only an opaque number, as the law on records of payments requires; an asker keeps the answers it already received, which never carried who you are.' };
}

// Only the browsers' own push services (round-1 order 1; ATTACK_0): an address anyone could choose would let a join link
// make our server post to a host of the holder's choice.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/];
export function isPushService(endpoint) {
  try { const u = new URL(endpoint); return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some(r => r.test(u.hostname)); } catch { return false; }
}

// The member's phone, for the ring (P2): the page posts its push subscription {endpoint, keys:{p256dh, auth}}.
export async function memberPush(env, request, token, body) {
  const m = await memberByToken(env, token);
  const sub = body && body.subscription;
  if (sub === null) { await env.DB.prepare('UPDATE members SET push_json = NULL WHERE id = ?').bind(m.id).run(); return { member_id: m.id, ring: 'off: no push' }; }
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\/[^\s]{8,1000}$/.test(sub.endpoint) || !sub.keys || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string')
    throw fixable('invalid_field', 'subscription', 'subscription is the push subscription the browser gave: {endpoint (https), keys: {p256dh, auth}}; null removes it.', null);
  if (!isPushService(sub.endpoint)) throw fixable('invalid_field', 'subscription.endpoint', 'Only a browser push service may be given here (Google, Mozilla, Apple or Microsoft).', null);
  await env.DB.prepare('UPDATE members SET push_json = ? WHERE id = ?').bind(JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }), m.id).run();
  return { member_id: m.id, ring: 'on: a call rings this phone when you are On and outside your quiet hours' };
}

// The iPhone app's device (owner 10:44 PM CT 14 Nov): {apns_token: hex, environment: 'production' | 'sandbox'}; null removes it.
// One device, one member: the same phone joining as another member leaves the old membership's token.
export async function memberDevice(env, request, token, body) {
  const m = await memberByToken(env, token);
  // the app builder's first draft (router/FOR_SERVICE_from_ios_app.md) names: device_token, environment "development", bundle_id, categories
  const given = body || {};
  body = {};
  for (const k of Object.keys(given)) if (!['device_token', 'bundle_id', 'categories'].includes(k)) body[k] = given[k];
  if (given.device_token !== undefined && body.apns_token === undefined) body.apns_token = given.device_token;
  if (body.environment === 'development') body.environment = 'sandbox';
  for (const k of Object.keys(body)) if (!['apns_token', 'environment'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not a field here; send apns_token and, for a development build, environment "sandbox".`, null);
  const { apnsConfigured } = await import('./apns.js');
  if (body.apns_token === null) { await env.DB.prepare('UPDATE members SET apns_token = NULL, apns_env = NULL WHERE id = ?').bind(m.id).run(); return { member_id: m.id, apple_push: 'off' }; }
  const t = typeof body.apns_token === 'string' ? body.apns_token.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{64,200}$/.test(t)) throw fixable(body.apns_token === undefined ? 'missing_field' : 'invalid_field', 'apns_token', 'apns_token is the device token the app received from Apple, as hex (64 characters or more); null removes it.', null);
  const where = body.environment === undefined ? 'production' : body.environment;
  if (!['production', 'sandbox'].includes(where)) throw fixable('invalid_field', 'environment', 'environment is "production" (App Store and TestFlight builds) or "sandbox" (development builds).', 'sandbox');
  await env.DB.batch([
    env.DB.prepare('UPDATE members SET apns_token = NULL, apns_env = NULL WHERE apns_token = ? AND id != ?').bind(t, m.id),
    env.DB.prepare('UPDATE members SET apns_token = ?, apns_env = ? WHERE id = ?').bind(t, where, m.id),
  ]);
  return { member_id: m.id, environment: where, apple_push: apnsConfigured(env) ? 'on: a call offered to you alerts this phone while you are On and outside your quiet hours'
    : 'kept: Apple push is not switched on yet on our side; this phone will be alerted once it is, with nothing more to do' };
}

// TASKS (OWNER_all_7): the person's one list and their reply
export async function memberTaskList(env, request, token, q) { const m = await memberByToken(env, token); const { memberTasks } = await import('./tasks.js'); return memberTasks(env, request, m, q); }
export async function memberTaskMedia(env, request, token, taskId) { const m = await memberByToken(env, token); const { reviewMedia } = await import('./tasks.js'); return reviewMedia(env, request, m, taskId); }
export async function memberTaskReply(env, request, token, taskId, body) { const m = await memberByToken(env, token); const { memberReply } = await import('./tasks.js'); return memberReply(env, request, m, taskId, body); }

// What a tester tells us to change (policy/DATA.md 'Tester feedback'): text, member, time; seen by the operator only.
export async function memberFeedback(env, request, token, body) {
  const m = await memberByToken(env, token);
  for (const k of Object.keys(body || {})) if (k !== 'text') throw fixable('unknown_field', k, `"${k}" is not a field here; send text.`, null);
  const text = body && body.text;
  if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw fixable(text === undefined ? 'missing_field' : 'invalid_field', 'text', 'text is what you want changed, up to 2,000 characters.', 'The button to stop was hard to find.');
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback WHERE member_id = ? AND created_at > ?').bind(m.id, nowMs() - 3600000).first();
  if (n.n >= 20) throw notFixable(429, 'rate_limited', 'At most 20 notes an hour; thank you for them.', { retry_after_seconds: 600 });
  await env.DB.prepare('INSERT INTO feedback (id, member_id, text, created_at) VALUES (?,?,?,?)').bind(rid('fb_'), m.id, text.trim(), nowMs()).run();
  return { stored: true, note: 'Thank you. It reaches the operator and nowhere else.' };
}

// The member's private settings: quiet hours, time zone, and 'screen reader' / 'longer to answer' (a 3-minute hold).
export async function memberSettings(env, request, token, body) {
  const m = await memberByToken(env, token);
  const b = body || {};
  for (const k of Object.keys(b)) if (!['quiet_start', 'quiet_end', 'tz', 'screen_reader', 'longer_to_answer', 'sounds', 'material_days'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not a setting.`, null);
  if (b.material_days !== undefined && !(Number.isInteger(b.material_days) && b.material_days >= 1 && b.material_days <= 30)) throw fixable('invalid_field', 'material_days', 'material_days is how many days your AIs\' photos and clips are kept: 1 to 30.', 7);
  if (b.sounds !== undefined && typeof b.sounds !== 'boolean') throw fixable('invalid_field', 'sounds', 'sounds is true or false.', false);
  const sounds = b.sounds === undefined ? (m.sounds === 0 ? 0 : 1) : (b.sounds ? 1 : 0);
  const hr = (v, k) => { if (!Number.isInteger(v) || v < 0 || v > 23) throw fixable('invalid_field', k, `${k} is an hour from 0 to 23.`, k === 'quiet_start' ? 21 : 8); return v; };
  const qs = b.quiet_start !== undefined ? hr(b.quiet_start, 'quiet_start') : m.quiet_start;
  const qe = b.quiet_end !== undefined ? hr(b.quiet_end, 'quiet_end') : m.quiet_end;
  let tz = m.tz;
  if (b.tz !== undefined) { try { new Intl.DateTimeFormat('en-US', { timeZone: String(b.tz) }); tz = String(b.tz); } catch { throw fixable('invalid_field', 'tz', 'tz is a time zone name such as America/Chicago.', 'America/Chicago'); } }
  let slow = m.slow_hold || 0;
  if (b.screen_reader !== undefined || b.longer_to_answer !== undefined) slow = (b.screen_reader === true || b.longer_to_answer === true) ? 1 : 0;
  const days = b.material_days !== undefined ? b.material_days : (m.material_days || 7);
  await env.DB.prepare('UPDATE members SET quiet_start = ?, quiet_end = ?, tz = ?, slow_hold = ?, sounds = ?, material_days = ? WHERE id = ?').bind(qs, qe, tz, slow, sounds, days, m.id).run();
  // OWNER_router_6: sounds is the person's setting: every membership with the same name on the same principal's panels follows
  if (b.sounds !== undefined && m.person_name) await env.DB.prepare('UPDATE members SET sounds = ? WHERE person_name = ? AND left_at IS NULL AND panel_id IN (SELECT id FROM panels WHERE principal_id = (SELECT principal_id FROM panels WHERE id = ?))')
    .bind(sounds, m.person_name, m.panel_id).run();
  return { member_id: m.id, quiet: { start: qs, end: qe, tz }, settings: { longer_hold: !!slow, sounds: !!sounds, material_days: days }, note: 'These settings are private: no asker sees them, and they never decide who is asked first.' };
}

// For the team's harness only (chief D8 question from runner): the seat links of a team-test call, for a team key.
export async function callSeatsForTeam(env, request, key, callId) {
  const call = await env.DB.prepare('SELECT * FROM calls WHERE id = ?').bind(callId).first();
  if (!call || call.principal_id !== key.principal_id) throw notFixable(404, 'not_found', 'No such call for this key.');
  const recordedPool = call.pool_ref && JSON.parse(call.pool_ref).mode === 'recorded';
  if (!key.team || (call.pool !== 'panel:team-test' && !recordedPool)) throw notFixable(403, 'not_allowed', 'Seat links are listed only for team keys on the team-test panel and the recorded pools.');
  await settle(env, request, { callId });
  const rows = (await env.DB.prepare('SELECT * FROM seats WHERE call_id = ? ORDER BY n').bind(callId).all()).results || [];
  const out = [];
  for (const s of rows) {
    const mb = s.member_id || s.offered_to;
    out.push({ seat_id: s.id, n: s.n, state: s.state, member_id: mb || null, seat_url: mb ? (await seatLink(env, request, s, call, mb)).url : null });
  }
  if (recordedPool) { const { arrivalUrlFor } = await import('./calls.js'); const a = await arrivalUrlFor(env, request, call); return { call_id: callId, seats: out, arrival_token: a.token, arrival_url: a.url }; }
  return { call_id: callId, seats: out };
}

// OWNER_router_6: GET /v1/members/{token}/settings (the app reads it once it answers; the same settings memberSettings writes)
export async function memberSettingsRead(env, request, token) {
  const m = await memberByToken(env, token);
  return { member_id: m.id, quiet: { start: m.quiet_start, end: m.quiet_end, tz: m.tz }, settings: { longer_hold: !!m.slow_hold, sounds: m.sounds !== 0, material_days: m.material_days || 7 },
    note: 'These settings are private: no asker sees them, and they never decide who is asked first. sounds: false means nothing of ours makes a sound for you.' };
}

// OWNER_router_6: a later membership given a name takes the quietest choice that person already made on the same principal's panels
export async function inheritSounds(env, memberId) {
  await env.DB.prepare(`UPDATE members SET sounds = 0 WHERE id = ? AND person_name IS NOT NULL AND EXISTS (SELECT 1 FROM members o
      WHERE o.id != ? AND o.person_name = members.person_name AND o.sounds = 0 AND o.left_at IS NULL
        AND o.panel_id IN (SELECT id FROM panels WHERE principal_id = (SELECT principal_id FROM panels WHERE id = members.panel_id)))`).bind(memberId, memberId).run();
}
