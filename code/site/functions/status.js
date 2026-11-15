// /status: real checks of the live services, run from the edge when the page is asked for (one run cached 60 s for the
// page and status.json; the call check at most once in ten minutes; every request time-limited).
// What it checks is written on the page. Expected tool names come from the canon at build time (_expect.js).
import { EXPECT } from './_expect.js';
function hosts(h) {
  h = h.toLowerCase();
  if (h.includes('askpeople-site')) return { SITE: h, API: 'askpeople-api.pages.dev', SPEC: 'askpeople-spec.pages.dev', RUN: 'askpeople-run.pages.dev' };
  const b = h.replace(/^www\./, '');
  return { SITE: b, API: 'api.' + b, SPEC: 'spec.' + b, RUN: 'run.' + b };
}
async function timed(fn) { const t = Date.now(); try { const r = await fn(); return { ...r, ms: Date.now() - t }; } catch (e) { return { ok: false, detail: String(e).slice(0, 160), ms: Date.now() - t }; } }
// Every request has a time limit, so a slow API cannot hold the page (trust S6, 14 Nov 2:44 PM CT).
const tf = (u, o = {}, ms = 5000) => fetch(u, { ...o, signal: AbortSignal.timeout(ms) });
async function runChecks(H, ctx) {
  const ua = { 'user-agent': 'status-check/1 (askpeople-site)' };
  // Our own checks are marked as ours (SERVICE 5:01 PM CT, 14 Nov: each keyless status call otherwise counts as an outside
  // caller on /v1/proof): the TEAM_CHECK_TOKEN secret goes in x-hc-team-check, only to our two API hosts, never to the browser.
  const team = ctx && ctx.env && ctx.env.TEAM_CHECK_TOKEN && ['api.person.tools', 'askpeople-api.pages.dev'].includes(H.API) ? { 'x-hc-team-check': ctx.env.TEAM_CHECK_TOKEN } : {};
  const ta = { ...ua, ...team };
  const checks = [];
  checks.push({ name: 'API answers', what: 'GET the discovery file on the API host', ...(await timed(async () => {
    const r = await tf(`https://${H.API}/.well-known/${EXPECT.wire_prefix}`, { headers: ta });
    return { ok: r.status === 200, detail: `HTTP ${r.status}` }; })) });
  // the runbook's checks (ops/RUNBOOK.md), read from the API's own /v1/status
  const st = await timed(async () => { const r = await tf(`https://${H.API}/v1/status`, { headers: ta }); return { ok: r.status === 200, body: await r.json().catch(() => ({})), detail: `HTTP ${r.status}` }; });
  const sb = st.body || {};
  checks.push({ name: 'API status within 2 s', what: 'GET /v1/status on the API host answers 200 in under 2 seconds', ok: st.ok && st.ms < 2000, detail: `${st.detail}`, ms: st.ms });
  if ('ledger_sum_cents' in sb) checks.push({ name: 'Money adds up', what: 'the ledger and the balances each sum to exactly zero', ok: sb.ledger_sum_cents === 0 && sb.balances_sum_cents === 0, detail: `ledger ${sb.ledger_sum_cents}, balances ${sb.balances_sum_cents} (cents)`, ms: 0 });
  if ('screening' in sb) checks.push({ name: 'Screening is installed', what: 'every call is read before anyone is asked; screening fails closed', ok: String(sb.screening).startsWith('installed'), detail: String(sb.screening), ms: 0 });
  if ('last_tick' in sb) { const age = (Date.now() - Date.parse(sb.last_tick)) / 60000; checks.push({ name: 'The timer runs', what: 'a timer tick in the last 10 minutes', ok: age <= 10, detail: `last tick ${Math.round(age)} min ago`, ms: 0 }); }
  const ageDays = t => (Date.now() - Date.parse(t)) / 86400000;
  if ('oldest_idempotency_at' in sb && sb.oldest_idempotency_at) { const d = ageDays(sb.oldest_idempotency_at); checks.push({ name: 'Retry records deleted on time', what: 'no idempotency record older than its 7-day rule (ops retention job 1)', ok: d <= 8, detail: `oldest is ${d.toFixed(1)} days old`, ms: 0 }); }
  if ('oldest_event_at' in sb && sb.oldest_event_at) { const d = ageDays(sb.oldest_event_at); checks.push({ name: 'Raw traces deleted on time', what: 'no event older than 30 days after its call closed (calls last at most 7 days, so no event older than 37 days)', ok: d <= 37, detail: `oldest is ${d.toFixed(1)} days old`, ms: 0 }); }
  checks.push({ name: 'Tools offered', what: 'MCP initialize and tools/list at /mcp; every tool the canon names is there', ...(await timed(async () => {
    const hd = { ...ta, 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    await tf(`https://${H.API}/mcp`, { method: 'POST', headers: hd, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'status', version: '1' } } }) });
    const r = await tf(`https://${H.API}/mcp`, { method: 'POST', headers: hd, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) });
    let txt = await r.text(); if (txt.startsWith('event:') || txt.startsWith('data:')) txt = (txt.split('\n').find(l => l.startsWith('data:')) || 'data:{}').slice(5);
    const names = ((JSON.parse(txt).result || {}).tools || []).map(t => t.name);
    const missing = EXPECT.tools.filter(n => !names.includes(n));
    return { ok: missing.length === 0, detail: missing.length ? `missing: ${missing.join(', ')}` : `${names.length} tools` }; })) });
  checks.push({ name: 'Simulated calls', what: 'a price for a simulated call is returned, with no key', ...(await timed(async () => {
    const r = await tf(`https://${H.API}/v1/quotes`, { method: 'POST', headers: { ...ta, 'content-type': 'application/json' }, body: JSON.stringify({ ask: 'Status check: which is clearer?', kind: 'compare', content: [{ text: 'A' }, { text: 'B' }], people: 3, pool: 'simulated' }) });
    const q = await r.json().catch(() => ({}));
    return { ok: r.status === 200 && !!q.total_usd, detail: r.status === 200 ? `quoted ${q.total_usd} (test money)` : `HTTP ${r.status} ${q.code || ''}` }; })) });
  const ckey = new Request(`https://${H.SITE}/status-callcheck`); const cached = await caches.default.match(ckey);
  const callcheck = cached ? await cached.json() : await timed(async () => {
    const r = await tf(`https://${H.API}/v1/calls`, { method: 'POST', headers: { ...ta, 'content-type': 'application/json' }, body: JSON.stringify({ ask: 'Status check: which is clearer?', kind: 'compare', content: [{ text: 'A' }, { text: 'B' }], people: 2, max_total_usd: '0.00' }) });
    const c = await r.json().catch(() => ({}));
    if (r.status !== 201 || !c.call_id) return { ok: false, detail: `open: HTTP ${r.status} ${c.code || ''}` };
    const g = await tf(`https://${H.API}/v1/calls/${c.call_id}/responses?wait_seconds=10`, { headers: ta }, 15000);
    const j = await g.json().catch(() => ({}));
    const rs = j.responses || [];
    const marked = rs.length > 0 && rs.every(x => x.simulated === true);
    return { ok: g.status === 200 && marked, detail: g.status === 200 ? `${rs.length} answers, ${marked ? 'all marked simulated' : 'NOT all marked simulated'}` : `results: HTTP ${g.status}` }; });
  if (!cached) ctx.waitUntil(caches.default.put(ckey, new Response(JSON.stringify({ ...callcheck, detail: callcheck.detail + ' (checked ' + new Date().toISOString().slice(11, 16) + ' UTC; at most once in 10 minutes)' }), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=600' } })));
  checks.push({ name: 'A simulated call opens and answers', what: 'a call with no key on the simulated pool opens, and its answers come back marked simulated (run at most once in ten minutes)', ...callcheck });
  checks.push({ name: 'Promise lines checked after every release', what: 'how many of the twelve promises to the people who are called have a check that runs after every release (from /promise.json)', ok: null, ...(await timed(async () => {
    const r = await tf(`https://${H.SITE}/promise.json`, { headers: ua }); const p = await r.json().catch(() => ({}));
    return { ok: null, detail: p.checked || `HTTP ${r.status}` }; })) });
  checks.push({ name: 'Call page', what: 'GET the page a person opens when rung', ...(await timed(async () => { const r = await tf(`https://${H.RUN}/`, { headers: ua }); return { ok: r.status < 400, detail: `HTTP ${r.status}` }; })) });
  checks.push({ name: 'The standard', what: 'GET the standard\'s text', ...(await timed(async () => { const r = await tf(`https://${H.SPEC}/`, { headers: ua }); return { ok: r.status === 200, detail: `HTTP ${r.status}` }; })) });
  return checks;
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export async function onRequest(ctx) {
  const url = new URL(ctx.request.url); const H = hosts(url.host);
  const asJson = url.pathname.endsWith('.json');
  const cache = caches.default; const key = new Request(`https://${url.host}/status-checks`);   // one run serves the page and status.json
  const hit = await cache.match(key);
  let data;
  if (hit) data = await hit.json();
  else { data = { at: new Date().toISOString(), checks: await runChecks(H, ctx) }; ctx.waitUntil(cache.put(key, new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' } }))); }
  const checks = data.checks;
  const at = new Date(data.at);
  const ct = at.toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' }) + ' CT';
  const allOk = checks.every(c => c.ok !== false);
  let res;
  if (asJson) {
    res = new Response(JSON.stringify({ checked_at: at.toISOString(), all_ok: allOk, checks, note: EXPECT.status_plain }, null, 1), { headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=60' } });
  } else {
    const rows = checks.map(c => `<tr><td><span class="m-dot ${c.ok === null ? 'info' : (c.ok ? 'ok' : 'bad')}">${c.ok === null ? 'INFO' : (c.ok ? 'OK' : 'FAILING')}</span></td><td><strong>${esc(c.name)}</strong><br><span class="m-src">${esc(c.what)}</span></td><td class="m-src">${esc(c.detail || '')} &middot; ${c.ms} ms</td></tr>`).join('');
    const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Status: ${esc(EXPECT.network)}</title><link rel="stylesheet" href="/m.css"><style>.m-dot{font:700 12px/1 var(--mono);letter-spacing:.1em;padding:.3rem .45rem;color:#fff}.m-dot.ok{background:var(--ok)}.m-dot.bad{background:var(--stop)}.m-dot.info{background:var(--soft)}</style></head><body class="m-doc"><main><nav aria-label="Site"><a href="/">Home</a><a href="/start">First call</a><a href="/questions">Questions</a><a href="/status" aria-current="page">Status</a><a href="/proof">Proof</a></nav><div class="m-label">Status</div><h1>${allOk ? 'Everything we check is working' : 'Something we check is failing'}</h1><p class="m-lede">Checked ${esc(ct)}, from Cloudflare's edge, when this page was asked for (kept for up to a minute). Each line says exactly what was tried.</p><p class="m-status">${esc(EXPECT.status_plain)}</p><table class="m-table"><tbody>${rows}</tbody></table><p class="m-src">As data: <a href="/status.json">/status.json</a></p><footer>${esc(EXPECT.network)}</footer></main></body></html>`;
    res = new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' } });
  }
  return res;
}
