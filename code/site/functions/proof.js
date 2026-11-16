// /proof: the real calls, as they happen (CEO.md goal 1 and 2). Read from the API's GET /v1/proof when the page is asked for
// (kept for up to a minute), never typed: real calls answered end to end, ours apart from outsiders', the outside callers,
// and each of our own calls with what its answers changed. No figure here is written by hand.
import { EXPECT } from './_expect.js';
function hosts(h) {
  h = h.toLowerCase();
  if (h.includes('askpeople-site')) return { SITE: h, API: 'askpeople-api.pages.dev' };
  const b = h.replace(/^www\./, '');
  return { SITE: b, API: 'api.' + b };
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n = x => (typeof x === 'number' && isFinite(x) ? x : null);

export async function onRequest(ctx) {
  const url = new URL(ctx.request.url); const H = hosts(url.host);
  const asJson = url.pathname.endsWith('.json');
  const cache = caches.default; const key = new Request(`https://${url.host}/proof-data`);
  let data = null; const hit = await cache.match(key);
  if (hit) data = await hit.json();
  else {
    try {
      const r = await fetch(`https://${H.API}/v1/proof`, { headers: { 'user-agent': 'proof-page/1 (askpeople-site)' }, signal: AbortSignal.timeout(15000) });   // /v1/proof took 5 to 9 s on 16 Nov; the page is cached 60 s, so a slow count costs one wait a minute
      if (r.ok) { data = await r.json(); ctx.waitUntil(cache.put(key, new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' } }))); }
    } catch (e) { data = null; }
  }
  if (asJson) {
    return new Response(JSON.stringify(data || { error: 'The API did not answer; try again in a minute.' }, null, 1),
      { status: data ? 200 : 503, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': data ? 'public, max-age=60' : 'no-store' } });
  }
  // a count that contradicts itself is not shown (15 Nov 2026): an outsider's real call needs a key, so it cannot exist
  // without an outside principal; show nothing rather than a number that may be wrong
  if (data && n((data.real_calls_answered || {}).outsiders) > 0 && !(n(data.outside_principals_with_a_call) > 0)) data = { _inconsistent: true };
  let main;
  if (data && data._inconsistent) {
    main = '<h1>The count is being checked</h1><p class="m-lede">The latest count disagrees with itself, so no number is shown until it is put right. Nothing is shown rather than a number that may be wrong.</p>';
  } else if (!data) {
    main = '<h1>The count could not be read just now</h1><p class="m-lede">The API did not answer in time. Nothing is shown rather than an old or guessed number; try again in a minute.</p>';
  } else {
    const rc = data.real_calls_answered || {};
    const ours = n(rc.ours), outs = n(rc.outsiders), princ = n(data.outside_principals_with_a_call), keyless = n(data.keyless_outside_callers_last_7_days), asked = n(data.outsiders_who_asked_for_real_people);
    const ownAi = n(data.outside_principals_with_an_answered_ask);   // goal 4 (16 Nov): an outsider's own AI asked them and they answered; shown once the API counts it
    const notes = Array.isArray(data.record_notes) ? data.record_notes.filter(x => typeof x === 'string' && x.trim()) : [];   // OWNER_router_27: the record, said plainly
    const when = data.counted_at ? new Date(data.counted_at).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' }) + ' CT' : '';
    const total = (ours || 0) + (outs || 0);
    const h1 = total === 0 ? 'No real call has been answered yet' : `${total} real ${total === 1 ? 'call has' : 'calls have'} been answered`;
    const list = (data.ours || []).map(c => `<li><strong>${esc(c.kind || 'call')}</strong>, answered ${esc(c.answered_at ? new Date(c.answered_at).toLocaleDateString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium' }) : '')} by ${esc(c.people_answered)} ${c.people_answered === 1 ? 'person' : 'people'}${c.outcome_public ? `. What it changed: ${esc(c.outcome_public)}` : ((c.outcome_sent || c.outcome_line) ? '. The people were told what their answers changed' : '')}</li>`).join('');
    main = `<h1>${esc(h1)}</h1>
<p class="m-lede">Counted by the API at ${esc(when)}, read when this page was asked for (kept for up to a minute). A real call is one a real person answered: not a simulated one.</p>
${(ours || 0) > 0 && EXPECT.first_call && EXPECT.first_call.text ? `<h2>${esc(EXPECT.first_call.title)}</h2><p>${esc(EXPECT.first_call.text)}${(() => { const sent = (data.ours || []).some(c => c.outcome_sent || c.outcome_line); return sent && EXPECT.first_call.outcome ? ' ' + esc(EXPECT.first_call.outcome_lead) + ' ' + esc(EXPECT.first_call.outcome) : ''; })()}</p>` : ''}
<table class="m-table"><tbody>
<tr><td><strong>${esc(ours)}</strong></td><td>Real calls answered that our own programs made (the films, pages, songs and games we make for people)</td></tr>
<tr><td><strong>${esc(outs)}</strong></td><td>Real calls answered that someone outside made</td></tr>
<tr><td><strong>${esc(princ)}</strong></td><td>Outside accounts that have made a call, free or paid (our own checks and the front page's demo never count)</td></tr>
<tr><td><strong>${esc(keyless)}</strong></td><td>Outside callers with no key, last seven days, counted by address (we keep no more)</td></tr>${ownAi === null ? '' : `<tr><td><strong>${esc(ownAi)}</strong></td><td>Outside people whose own AI asked them on their phone and got their answer (pages made by our team or a test never count)</td></tr>`}${asked === null ? '' : `<tr><td><strong>${esc(asked)}</strong></td><td>Outsiders whose call asked for strangers (recorded for the operator; strangers are not offered yet)</td></tr>`}
</tbody></table>
<h2>Our own calls</h2>${list ? `<ul>${list}</ul>` : '<p>None answered yet. Each of our calls appears here with what its answers changed.</p>'}
${notes.length ? `<h2>The record, said plainly</h2>${notes.map(x => `<p>${esc(x)}</p>`).join('')}` : ''}
<h2>How it is counted</h2><p>${esc(data.how_counted || '')}</p>`;
  }
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Proof: ${esc(EXPECT.network)}</title><link rel="stylesheet" href="/m.css"></head><body class="m-doc"><main><nav aria-label="Site"><a href="/">Home</a><a href="/start">First call</a><a href="/questions">Questions</a><a href="/status">Status</a><a href="/proof" aria-current="page">Proof</a></nav><div class="m-label">Proof</div>${main}<p class="m-status">${esc(EXPECT.status_plain)}</p><p class="m-src">As data: <a href="/proof.json">/proof.json</a> · from the API: <a href="https://${esc(H.API)}/v1/proof">/v1/proof</a></p><footer>${esc(EXPECT.network)}</footer></main></body></html>`;
  return new Response(body, { status: data ? 200 : 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': data ? 'public, max-age=60' : 'no-store' } });
}
