// The MCP server at /mcp (spec section 20): stateless, plain JSON over HTTP POST. Speaks the modern revision (2026-07-28:
// server/discover, per-request _meta, resultType) and the handshake revisions (2024-11-05 .. 2025-11-25: initialize).
// Wire facts: router/MCP_WIRE.md. Each tool's structuredContent is the JSON body its HTTP operation returns (MCP-2).
import { WORDS } from './words.js';
import { KINDS, FIELD_TYPES, CallError, SELECTORS, fixable } from './spec.js';
import { quote, openCall, results, cancelCall, outcome, ANON } from './calls.js';
import { listPanels, createPanel, getPanel } from './panels.js';
import { BUILD } from './build_info.js';
import { apiBase } from './util.js';
import * as SCREENING from './screening/index.js';

const T = (BUILD.names && BUILD.names.tool) || 'ask_people';   // the working tool name (canon/names.json); the rest are suffixes
const NAME = (suffix) => T + suffix;
const SUFFIXES = ['_quote', '', '_results', '_cancel', '_send_outcome', '_panel'];
const MODERN = ['2026-07-28'];
const HANDSHAKE = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];
const M = 'io.modelcontextprotocol/';

function pfw(k, fallback) { const w = WORDS.tools['_panel'] && WORDS.tools['_panel'].field_words; return (w && w[k]) || fallback; }
function fw(k, fallback) { const w = WORDS.tools[''] && WORDS.tools[''].field_words; return (w && w[k]) || fallback; }

const money = (d) => ({ type: ['string', 'number'], description: d });
function callSchema(isCall) {
  const item = { oneOf: [{ type: 'string', description: 'a media id (m_...) or an https address' }, { type: 'object', properties: { text: { type: 'string', maxLength: 5000 } }, required: ['text'], additionalProperties: false }] };
  const s = {
    type: 'object',
    properties: {
      ask: { type: 'string', minLength: 1, maxLength: 2000, description: fw('ask', 'What the person reads first, in plain words.') },
      kind: { type: 'string', enum: KINDS, description: fw('kind', 'listen, watch, view, play, compare or answer.') },
      content: { description: fw('content', 'A media id (the sample m_sample_melody30 works with any key), an https address, {"text": "..."}, or for compare a list of 2 to 6 of these.'), anyOf: [{ $ref: '#/$defs/item' }, { type: 'array', items: { $ref: '#/$defs/item' }, minItems: 2, maxItems: 6 }] },
      people: { type: 'integer', minimum: 1, maximum: 100, description: fw('people', 'How many answers you want.') },
      enough: { type: 'integer', minimum: 1, description: fw('enough', 'How many answers make the call usable (default 70% of people, rounded up).') },
      pool: { type: 'string', description: fw('pool', '"simulated" (default) or "panel:<panel_id>".') },
      answer_fields: { type: 'object', description: fw('answer_fields', 'The answers you want: each name and its type (text, boolean, number, choice, scale), or an object {type, label, choices, min, max, optional}. Default {"answer": "text"}.'),
        additionalProperties: { anyOf: [{ type: 'string', enum: FIELD_TYPES }, { type: 'object', properties: { type: { type: 'string', enum: FIELD_TYPES }, label: { type: 'string' }, optional: { type: 'boolean' }, max_length: { type: 'integer' }, min: { type: 'number' }, max: { type: 'number' }, choices: { type: 'array', items: { type: 'string' } }, multiple: { type: 'boolean' }, min_label: { type: 'string' }, max_label: { type: 'string' } }, required: ['type'] }] } },
      minutes: { type: 'number', minimum: 0.5, maximum: 120, description: fw('minutes', 'How long one person should take, in minutes.') },
      pay_per_person_usd: money(fw('pay_per_person_usd', 'What each person who answers is paid, in dollars ("2.00"). Default "0.00" on the simulated pool and on panels.')),
      deadline_minutes: { type: 'integer', minimum: 1, maximum: 10080, description: fw('deadline_minutes', 'Minutes until the call closes (default 120).') },
      require: { type: 'object', description: `Selectors over people's claims: ${SELECTORS.join(', ')}, each a list of accepted values.`, additionalProperties: { type: 'array', items: { type: 'string' } } },
      content_rating: { type: 'string', enum: ['general'] },
      may_train_on_answers: { type: 'boolean', description: 'Whether your principal may train models on the written answers (default false). People see this before they start.' },
      pace: { type: 'string', enum: ['instant', 'human'], description: fw('pace', 'Simulated pool only: "instant" (answers within 10 seconds, the default) or "human" (over 1 to 6 minutes).') },
      script: { type: 'array', description: 'Simulated pool only: one entry per seat in order: {accept (true, false or "miss"), delay_seconds, play_fraction, realtime, visible_fraction, revealed, seat_seconds, stop_at_fraction, stop_reason, send_partial, answers, answer_input}.', items: { type: 'object' } },
      max_total_usd: money(fw('max_total_usd', 'The most this call may cost, every fee included, in dollars ("10.00"). Required to open a call.')),
      idempotency_key: { type: 'string', minLength: 1, maxLength: 128, description: fw('idempotency_key', 'Any unique string; repeating the call with it returns the first call and opens nothing new.') },
      wants_strangers: { type: 'object', properties: { purpose: { type: 'string', minLength: 3, maxLength: 300 }, contact: { type: 'string', maxLength: 200 } }, required: ['purpose'], additionalProperties: false,
        description: fw('wants_strangers', 'To ask for real strangers: what your user wants them for, and one way to reach your user. We\'ll list you for strangers and tell you here, in this tool\'s replies to your key, when it opens. Nothing is rung meanwhile.') },
      ext: { type: 'object' },
    },
    required: isCall ? ['ask', 'kind', 'people', 'max_total_usd'] : ['ask', 'kind', 'people'],
    additionalProperties: false,
    $defs: { item },   // one content item, written once (market, 5:44 AM CT)
  };
  // the quote takes the same fields as ask_people, whose schema says what each means: here, types and limits only
  if (!isCall) for (const v of Object.values(s.properties)) delete v.description;
  return s;
}
const OUT = { type: 'object', description: 'The JSON body of the HTTP operation (spec section 19), or the error object of section 8 when isError is true.' };

function toolList(handshake = false) {
  const t = (suffix, inputSchema) => {
    const w = WORDS.tools[suffix];
    const o = { name: NAME(suffix), title: w.title, description: w.description, inputSchema, outputSchema: OUT, annotations: { title: w.title, ...w.annotations } };
    if (handshake && suffix === '') o.execution = { taskSupport: 'optional' };   // 2025-11-25 tasks: the call may run as a task
    return o;
  };
  return [
    t('_quote', callSchema(false)),
    t('', callSchema(true)),
    t('_results', { type: 'object', properties: {
      call_id: { type: 'string', description: `The call_id ${NAME('')} returned.` },
      after: { type: 'string', description: 'The cursor from the last result; only newer answers come back.' },
      wait_seconds: { type: 'integer', minimum: 0, maximum: 25, description: 'Wait up to this many seconds for a new answer (default 20).' },
      detail: { type: 'string', enum: ['summary', 'full'], description: '"full" adds each person\'s record and what they were shown.' },
    }, required: ['call_id'], additionalProperties: false }),
    t('_cancel', { type: 'object', properties: { call_id: { type: 'string' } }, required: ['call_id'], additionalProperties: false }),
    t('_send_outcome', { type: 'object', properties: {
      call_id: { type: 'string' }, text: { type: 'string', maxLength: 280, description: 'One line: what you did with the answers.' },
      idempotency_key: { type: 'string', minLength: 1, maxLength: 128 } }, required: ['call_id', 'text'], additionalProperties: false }),
    t('_panel', { type: 'object', properties: {
      name: { type: 'string', description: pfw('name', 'The panel\'s name, for you (your people see asker_name). The same name again returns the same panel.') },
      asker_name: { type: 'string', minLength: 2, maxLength: 60, description: pfw('asker_name', 'The name your people know you by, shown to them as "<name> (named by the asker; not checked by person.tools)". Nobody can join until it is set; send it again with the same name to set it later.') },
      idempotency_key: { type: 'string' } }, required: ['name'], additionalProperties: false }),
  ];
}

function summaryLine(wire, out, isErr) {
  const base = summaryLineBase(wire, out, isErr);
  // the CEO 5:55 AM CT 15 Nov: every later reply to a key that asked for strangers carries one line with their state
  return !isErr && out && out.strangers_status && ['', '_quote', '_results'].includes(suffixOf(wire)) ? `${base} ${out.strangers_status}` : base;
}
function summaryLineBase(wire, out, isErr) {
  const line = summaryLine0(wire, out, isErr);
  // a held call says why and what to change on the first line an agent reads (OWNER_all_4 item 2)
  if (!isErr && out && out.status === 'held' && out.held_reason) return `${line} HELD: ${out.held_reason}`;
  if (!isErr && out && out.would_be_held && out.held_reason && out.simulated === false && suffixOf(wire) === '_quote') return `${line} It would be held: ${out.held_reason}`;
  if (!isErr && out && out.real_people && suffixOf(wire) === '_results') return `${line} ${out.real_people}`;
  // REACH 6:10: agents mostly quote and read only the first line; a hold they can fix in their words goes on it too
  if (!isErr && out && out.would_be_held && out.held_reason && out.ext && out.ext.hold && out.ext.hold.fixable === true && suffixOf(wire) === '_quote') return `${line} On real people it would be HELD: ${out.held_reason}`;
  return line;
}
function summaryLine0(wire, out, isErr) {
  const name = suffixOf(wire);
  if (isErr) return `ERROR ${out.code}: ${out.message || ''}`.trim();
  const sim = out.simulated || (out.summary && out.summary.simulated) ? 'SIMULATED. ' : '';
  if (name === '') return `${sim}Call ${out.call_id} is ${out.status}${out.repeated ? ' (the same call as before; nothing new opened)' : ''}. Held ${out.money ? out.money.held_usd : '0.00'} of test money. Get answers with ${NAME('_results')} after ${out.next_check_after_seconds ?? 2} s.`;
  if (name === '_quote') return `${sim}Total ${out.total_usd} (test money); set max_total_usd to at least ${out.total_usd} to open it.`;
  if (name === '_results') return `${sim}${out.summary.answered} of ${out.summary.people} answered (enough is ${out.summary.enough}); status ${out.status}${out.complete ? '' : `; look again after ${out.next_check_after_seconds} s`}. Spent ${out.money.spent_usd} of ${out.money.held_usd} held (test money).`;
  if (name === '_cancel') return `${sim}Call ${out.call_id} is ${out.status}.`;
  if (name === '_panel') return out.for_your_user || `Panel ${out.name || ''} (${out.panel_id || ''}): ${out.members ?? 0} members.`;   // the CEO 8:21: a message the user can forward
  if (name === '_send_outcome') return `The line was ${out.status}; ${out.people} ${out.people === 1 ? 'person' : 'people'} will see it.`;
  return 'Done.';
}

function suffixOf(wire) { return typeof wire === 'string' && wire.startsWith(T) && SUFFIXES.includes(wire.slice(T.length)) ? wire.slice(T.length) : null; }

async function callTool(env, request, auth, ipHash, wire, args) {
  const name = suffixOf(wire);
  args = args && typeof args === 'object' ? args : {};
  const known = (keys) => { for (const k of Object.keys(args)) if (!keys.includes(k)) throw fixable('unknown_field', k, `"${k}" is not an argument of ${wire}.`, null); };
  if (auth.error) throw auth.error;
  const key = auth.key;
  const k = key || ANON;
  switch (name) {
    case '_quote': return await quote(env, request, key, args);
    case '': { const r = await openCall(env, request, k, args, ipHash); return r.body; }
    case '_results': known(['call_id', 'after', 'wait_seconds', 'detail']); return await results(env, request, k, String(args.call_id || ''), { after: args.after || 0, wait: args.wait_seconds ?? 20, detail: args.detail || 'summary' });
    case '_cancel': known(['call_id']); return await cancelCall(env, request, k, String(args.call_id || ''));
    case '_send_outcome': { known(['call_id', 'text', 'idempotency_key']); const { call_id, ...b } = args; return await outcome(env, request, k, String(call_id || ''), b, ipHash, SCREENING.screenOutcome); }
    case '_panel': {
      known(['name', 'asker_name', 'idempotency_key']);
      if (!key) throw fixable('unauthorized', 'Authorization', 'Making a panel needs a key: make a free test key with POST /v1/keys (no sign-up), then call this tool with it as a Bearer token.', 'Bearer test_...', {}, 401);
      return await createPanel(env, request, key, { name: args.name, idempotency_key: args.idempotency_key, ...(args.asker_name !== undefined ? { asker_name: args.asker_name } : {}) });
    }
    default: return undefined;
  }
}

function rpcErr(id, code, message, data) { const e = { jsonrpc: '2.0', id: id ?? null, error: { code, message } }; if (data !== undefined) e.error.data = data; return e; }
const httpFor = (code) => [-32700, -32600, -32602, -32020, -32021, -32022].includes(code) ? 400 : code === -32601 ? 404 : 200;
function json(body, status) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }

export async function handleMcp(env, request, auth, ipHash) {
  if (request.method !== 'POST') return new Response(JSON.stringify(rpcErr(null, -32600, 'Use POST with a JSON-RPC body. This server is stateless and opens no event stream.')), { status: 405, headers: { 'Content-Type': 'application/json', Allow: 'POST' } });
  let msg;
  const text = await request.text();
  if (text.length > 200000) return json(rpcErr(null, -32600, 'A request is at most 200 KB.'), 413);
  try { msg = JSON.parse(text); } catch { return json(rpcErr(null, -32700, 'Parse error'), 400); }
  if (Array.isArray(msg)) {     // 2025-03-26 batches: at most 10, and nothing in a batch waits
    if (msg.length > 10) return json(rpcErr(null, -32600, 'At most 10 requests in a batch.'), 400);
    const outs = [];
    for (const m of msg) { if (m && m.params && m.params.arguments && typeof m.params.arguments === 'object') m.params.arguments.wait_seconds = 0; const r = await one(env, request, auth, ipHash, m, true); if (r) outs.push(r.body); }
    return outs.length ? json(outs, 200) : new Response(null, { status: 202 });
  }
  const r = await one(env, request, auth, ipHash, msg);
  if (!r) return new Response(null, { status: 202 });
  return json(r.body, r.status);
}

async function one(env, request, auth, ipHash, m, inBatch = false) {
  if (!m || typeof m !== 'object' || m.jsonrpc !== '2.0' || typeof m.method !== 'string') {
    if (m && (m.result !== undefined || m.error !== undefined)) return null;
    return { status: 400, body: rpcErr(m && m.id, -32600, 'Invalid request') };
  }
  if (m.id === undefined || m.id === null) return null;   // notifications: 202, no body
  const hv = request.headers.get('mcp-protocol-version');
  const params = m.params && typeof m.params === 'object' ? m.params : {};
  const meta = params._meta && typeof params._meta === 'object' ? params._meta : null;
  const modern = (hv && !HANDSHAKE.includes(hv)) || (meta && meta[M + 'protocolVersion'] && !HANDSHAKE.includes(meta[M + 'protocolVersion']));
  const serverInfo = { name: T.replace(/_/g, '-'), title: (BUILD.names && BUILD.names.network) || '', version: BUILD.stamp };
  const out = (result, status = 200) => ({ status, body: { jsonrpc: '2.0', id: m.id, result } });
  const err = (code, message, data) => ({ status: httpFor(code), body: rpcErr(m.id, code, message, data) });

  if (modern) {
    if (m.method === 'initialize') return err(-32022, 'Unsupported protocol version', { supported: MODERN, requested: hv || '' });
    if (!meta || !meta[M + 'protocolVersion'] || !meta[M + 'clientCapabilities']) return err(-32602, 'params._meta needs io.modelcontextprotocol/protocolVersion and io.modelcontextprotocol/clientCapabilities');
    const v = meta[M + 'protocolVersion'];
    if (hv && hv !== v) return err(-32020, 'mcp-protocol-version header does not match params._meta');
    const mh = request.headers.get('mcp-method'); if (mh && mh !== m.method) return err(-32020, 'mcp-method header does not match the method');
    if (m.method === 'tools/call') { const nh = request.headers.get('mcp-name'); if (nh && nh !== params.name) return err(-32020, 'mcp-name header does not match params.name'); }
    if (!MODERN.includes(v)) return err(-32022, 'Unsupported protocol version', { supported: MODERN, requested: v });
    const rmeta = { [M + 'serverInfo']: serverInfo };
    if (m.method === 'server/discover') return out({ supportedVersions: MODERN, capabilities: { tools: { listChanged: false } }, instructions: WORDS.server_instructions, resultType: 'complete', ttlMs: 0, cacheScope: 'public', _meta: rmeta });
    if (m.method === 'tools/list') return out({ tools: toolList(), resultType: 'complete', ttlMs: 0, cacheScope: 'public', _meta: rmeta });
    if (m.method === 'ping') return out({ resultType: 'complete', _meta: rmeta });
    if (m.method === 'tools/call') { const r = await toolResult(env, request, auth, ipHash, params); if (r.rpcError) return err(r.rpcError.code, r.rpcError.message); return out({ ...r, resultType: 'complete', _meta: rmeta }); }
    return err(-32601, 'Method not found');
  }
  if (m.method === 'initialize') {
    const want = params.protocolVersion;
    const v = HANDSHAKE.includes(want) ? want : '2025-11-25';
    const caps = { tools: { listChanged: false } };
    if (v === '2025-11-25') caps.tasks = { cancel: {}, requests: { tools: { call: {} } } };
    return out({ protocolVersion: v, capabilities: caps, serverInfo, instructions: WORDS.server_instructions });
  }
  if (m.method === 'ping') return out({});
  if (m.method === 'tools/list') return out({ tools: toolList((hv || '2025-11-25') === '2025-11-25') });
  if (m.method === 'tools/call') {
    // a client that asks for a task gets the call as one (2025-11-25): the task id is the call id
    if (params.task && typeof params.task === 'object' && params.name === NAME('')) {
      const r = await toolResult(env, request, auth, ipHash, params);
      if (r.rpcError) return { status: 200, body: rpcErr(m.id, r.rpcError.code, r.rpcError.message) };
      if (r.isError) return out(r);
      return out({ task: await taskOf(env, request, auth, r.structuredContent.call_id) });
    }
    const r = await toolResult(env, request, auth, ipHash, params); if (r.rpcError) return { status: 200, body: rpcErr(m.id, r.rpcError.code, r.rpcError.message) }; return out(r);
  }
  if (m.method === 'tasks/get' || m.method === 'tasks/result' || m.method === 'tasks/cancel') {
    const id = String(params.taskId || '');
    try {
      if (m.method === 'tasks/cancel') { await cancelCall(env, request, auth.key || ANON, id); return out(await taskOf(env, request, auth, id)); }
      if (m.method === 'tasks/get') return out(await taskOf(env, request, auth, id));
      // tasks/result: the results of section 13, waiting up to 25 seconds for the call to reach enough or end
      const res = await results(env, request, auth.key || ANON, id, { wait: inBatch ? 0 : 25 });
      return out({ content: [{ type: 'text', text: summaryLine(NAME('_results'), res, false) + '\n' + JSON.stringify(res) }], structuredContent: res, _meta: { [M + 'related-task']: { taskId: id } } });
    } catch (e) {
      if (e instanceof CallError) return { status: 200, body: rpcErr(m.id, -32602, e.body.message || e.body.code) };
      throw e;
    }
  }
  if (m.method === 'server/discover') return { status: 404, body: rpcErr(m.id, -32601, 'Method not found') };
  return { status: 200, body: rpcErr(m.id, -32601, 'Method not found') };
}

// A task's state from its call (taskId = call_id): working until enough answers or the end; completed at enough, complete or
// expired; cancelled; failed when refused.
async function taskOf(env, request, auth, callId) {
  const r = await results(env, request, auth.key || ANON, callId, { wait: 0 });
  const st = r.status;
  const status = st === 'cancelled' ? 'cancelled' : st === 'refused' ? 'failed' : (['enough', 'complete', 'expired'].includes(st) ? 'completed' : 'working');
  const call = await env.DB.prepare('SELECT created_at, deadline_at FROM calls WHERE id = ?').bind(callId).first();
  return { taskId: callId, status, statusMessage: r.next_step, createdAt: new Date(call.created_at).toISOString(), lastUpdatedAt: new Date().toISOString(),
    ttl: Math.max(0, call.deadline_at + 7 * 86400000 - call.created_at), pollInterval: (r.next_check_after_seconds || 2) * 1000 };
}

async function toolResult(env, request, auth, ipHash, params) {
  const name = params.name;
  if (suffixOf(name) === null) return { rpcError: { code: -32602, message: `Unknown tool: ${name}` } };
  try {
    const o = await callTool(env, request, auth, ipHash, name, params.arguments);
    return { content: [{ type: 'text', text: summaryLine(name, o, false) + '\n' + JSON.stringify(o) }], structuredContent: o };
  } catch (e) {
    let b;
    if (e instanceof CallError) b = { ...e.body };
    else { console.log('tool error', name, String(e && e.stack || e)); b = { code: 'internal', status: 500, fixable: false, message: `The server failed. If this was ${NAME('')}, send it again with the same idempotency_key: it returns the call if it opened, and nothing is charged twice.`, rule: null }; }
    if (name === NAME('')) { b.charged_usd = '0.00'; b.anyone_asked = false; }
    return { content: [{ type: 'text', text: summaryLine(name, b, true) + '\n' + JSON.stringify(b) }], structuredContent: b, isError: true };
  }
}
