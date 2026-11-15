// A PERSON'S OWN AI OVER MCP (REACH 2:09 PM CT 15 Nov; the CEO 2:21: the stranger's path first). A chat assistant whose connector speaks
// MCP can use its connection key (conn_...) on /mcp and sees exactly two tools: ask_person (one ask to the person who connected it) and
// ask_person_reply (read that ask's answer). Nothing else answers to a connection key, here or anywhere.
import { fixable } from './spec.js';

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const STEP = { type: 'object', description: 'ONE thing: {"type":"question","text":"...","choices":["A","B"]} (2 to 4 choices, or none for a typed line), {"type":"approve","text":"exactly what you will do"}, {"type":"link","url":"https://...","text":"what to do there"}, or {"type":"command","command":"...","where":"where to run it"}.',
  properties: { type: { type: 'string', enum: ['question', 'approve', 'link', 'command'] }, text: { type: 'string' }, choices: { type: 'array', items: { type: 'string' } }, url: { type: 'string' }, command: { type: 'string' }, where: { type: 'string' },
    approve_label: { type: 'string' }, deny_label: { type: 'string' }, editable: { type: 'boolean' } }, required: ['type'] };
const TOOLS = [
  { name: 'ask_person', title: 'Ask your person', description: 'Ask the person who connected you ONE thing. It reaches only them, under the name they gave you, with no sound; they answer with a tap. Returns a task_id: read the answer with ask_person_reply. Never put a password, a code or a key in an ask.',
    inputSchema: { type: 'object', properties: { title: { type: 'string', description: '3 to 120 characters' }, step: STEP, unlocks: { type: 'string', description: 'what their answer lets you do (optional)' },
      urgency: { type: 'string', enum: ['now', 'today', 'whenever'] } }, required: ['title', 'step'], additionalProperties: false } },
  { name: 'ask_person_reply', title: 'Read their answer', description: 'Read the answer to an ask. state "open" means not yet answered (look again in a minute or so; an ask stays open up to 30 days, with no default answer); "answered" or "done" means reply holds it: reply.choice, reply.text, reply.action, and reply.approved_text for an approve step; "lapsed" means 30 days passed with no answer; "withdrawn" means it was withdrawn.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'], additionalProperties: false } },
];

const rpc = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcErr = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }

export async function personMcp(env, request, key) {
  if (request.method !== 'POST') return json(rpcErr(null, -32600, 'Use POST with a JSON-RPC body.'), 405);
  const text = await request.text();
  if (text.length > 200000) return json(rpcErr(null, -32600, 'A request is at most 200 KB.'), 413);
  let m; try { m = JSON.parse(text); } catch { return json(rpcErr(null, -32700, 'Parse error'), 400); }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return json(rpcErr(null, -32600, 'One JSON-RPC request at a time.'), 400);
  const id = m.id === undefined ? null : m.id, p = m.params || {};
  if (m.id === undefined) return new Response(null, { status: 202 });   // a notification (notifications/initialized and the like)
  if (m.method === 'initialize') {
    const v = VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : VERSIONS[1];
    return json(rpc(id, { protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'person.tools: your person', version: '1' },
      instructions: 'You are connected to one person, who made this connection for you. Ask them one thing at a time with ask_person, and read the answer with ask_person_reply.' }));
  }
  if (m.method === 'ping') return json(rpc(id, {}));
  if (m.method === 'tools/list') return json(rpc(id, { tools: TOOLS }));
  if (m.method === 'tools/call') {
    const T = await import('./tasks.js'); const args = p.arguments && typeof p.arguments === 'object' ? p.arguments : {};
    try {
      let out;
      if (p.name === 'ask_person') { const r = await T.createTask(env, request, key, args); out = r.body; }
      else if (p.name === 'ask_person_reply') { if (typeof args.task_id !== 'string') throw fixable('missing_field', 'task_id', 'task_id is the id ask_person gave you.', null); out = await T.getTask(env, request, key, args.task_id); }
      else return json(rpcErr(id, -32602, 'Unknown tool: this connection has ask_person and ask_person_reply.'));
      const line = p.name === 'ask_person' ? `Asked. task_id ${out.task_id}; read the answer with ask_person_reply.` : out.state === 'open' ? 'Not answered yet: look again in a minute or so.'
        : `Answered (${out.state}): ${out.reply ? (out.reply.approved_text ? 'approved: ' + out.reply.approved_text : out.reply.choice || out.reply.text || out.reply.action) : ''}`;
      return json(rpc(id, { content: [{ type: 'text', text: line }], structuredContent: out, isError: false }));
    } catch (e) {
      const b = (e && e.body) || { code: 'error', message: String(e && e.message || e) };
      return json(rpc(id, { content: [{ type: 'text', text: `ERROR ${b.code}: ${b.message || ''}` }], structuredContent: b, isError: true }));
    }
  }
  return json(rpcErr(id, -32601, 'Method not found'));
}
