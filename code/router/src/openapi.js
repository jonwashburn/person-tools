// A small OpenAPI 3.1 description of the HTTP operations. Market may replace it with the generated one (B2).
import CANON_STATUS from './canon_status.json';
import { apiBase } from './util.js';
import { BUILD } from './build_info.js';

const err = { description: 'Error: {error, code, message, fixable, field?, example?}', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
const ok = (d) => ({ description: d, content: { 'application/json': { schema: { type: 'object' } } } });

import SPEC from './openapi_spec.json';

// This service's own operations beside the standard's (REACH 2:39 PM CT 15 Nov: agents read the API here): a person's own AIs ask
// them through connections (a conn_ key does only this), and the person's answers come back as the reply.
const STEP = { type: 'object', required: ['type'], description: 'ONE thing to do or answer', properties: { type: { enum: ['question', 'approve', 'link', 'command'] }, text: { type: 'string', maxLength: 4000 },
  choices: { type: 'array', items: { type: 'string', maxLength: 120 }, minItems: 2, maxItems: 4 }, url: { type: 'string' }, command: { type: 'string' }, where: { type: 'string' }, approve_label: { type: 'string' }, deny_label: { type: 'string' }, editable: { type: 'boolean' } } };
const TASK_BODY = { type: 'object', required: ['title', 'step'], properties: { title: { type: 'string', minLength: 3, maxLength: 120 }, step: STEP, unlocks: { type: 'string', maxLength: 300 },
  urgency: { enum: ['now', 'today', 'whenever'] }, media: { type: 'string', description: 'an id from POST /v1/tasks/media (a connection only)' }, webhook: { type: 'string', description: 'https address for the signed answer (a connection only)' },
  card: { type: 'object', description: '{"blocks": [...]} headline, text, media, facts, price, when_where, choices, input' }, idempotency_key: { type: 'string' } } };
const REPLY = { type: 'object', description: 'state "open" until answered (up to 30 days; no default answer); then "answered" or "done" with reply; "lapsed" after 30 days unanswered (kept 30 more days); "withdrawn" if withdrawn', properties: { task_id: { type: 'string' }, state: { enum: ['open', 'answered', 'done', 'not_now', 'lapsed', 'withdrawn'] },
  reply: { type: 'object', properties: { action: { enum: ['answer', 'done', 'approve', 'deny', 'not_now'] }, choice: { type: 'string' }, text: { type: 'string' }, note: { type: 'string' }, approved_text: { type: 'string' } } },
  notes: { type: 'array', items: { type: 'object', properties: { at: { type: 'string' }, note: { type: 'string' }, by: { enum: ['person', 'asker'] } } } } } };
const id = { name: 'task_id', in: 'path', required: true, schema: { type: 'string' } };
const json = (schema) => ({ content: { 'application/json': { schema } } });
const OWN = {
  '/v1/tasks': { post: { summary: 'Ask your person one thing (a connection key, conn_..., asks only the person who connected it)', 'x-service-extension': true, requestBody: json(TASK_BODY), responses: { 201: { description: 'the task', ...json(REPLY) }, 403: err, 422: err, 429: err } },
    get: { summary: 'Your open asks', 'x-service-extension': true, responses: { 200: ok('{tasks}') } } },
  '/v1/tasks/{task_id}': { get: { summary: 'Read the answer', 'x-service-extension': true, parameters: [id], responses: { 200: { description: 'the task', ...json(REPLY) }, 404: err } } },
  '/v1/tasks/{task_id}/notes': { post: { summary: 'Answer a person\'s note in one line', 'x-service-extension': true, parameters: [id], requestBody: json({ type: 'object', required: ['note'], properties: { note: { type: 'string', maxLength: 500 } } }), responses: { 200: ok('{notes}') } } },
  '/v1/tasks/{task_id}/withdraw': { post: { summary: 'Withdraw an ask', 'x-service-extension': true, parameters: [id], responses: { 200: ok('{task_id, state}') } } },
  '/v1/tasks/media': { post: { summary: 'One photo (10 MB) or clip (60 s, 20 MB) for an ask, as the request body; a connection only', 'x-service-extension': true, requestBody: { content: { 'image/jpeg': {}, 'image/png': {}, 'video/mp4': {} } }, responses: { 201: ok('{media_id}') } } },
};
export function openapi(request) {
  if (SPEC && SPEC.openapi) return { ...SPEC, servers: [{ url: apiBase(request) }], paths: { ...(SPEC.paths || {}), ...OWN } };   // the standard's own file (spec/openapi.yaml), plus this service's own
  return {
    openapi: '3.1.0',
    info: { title: `${BUILD.names.network} API (preview)`, version: '0.1-draft', description: 'Ask people for a human reaction and get each answer back with a record of what they did. ' + (CANON_STATUS.plain || 'Preview: simulated people for everyone; all money is test money.') },
    servers: [{ url: apiBase(request) }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'test_... or real_...; POST /v1/keys makes a free test key.' } },
      schemas: {
        Error: { type: 'object', required: ['code', 'message', 'fixable'], properties: { error: { type: 'string' }, code: { type: 'string' }, message: { type: 'string' }, fixable: { type: 'boolean' }, field: { type: 'string' }, example: {}, charged_usd: { type: 'string' }, anyone_rung: { type: 'boolean' } } },
        Call: { type: 'object', required: ['ask', 'experience', 'max_total_usd'], properties: {
          ask: { type: 'string' }, experience: { type: 'object', properties: { kind: { enum: ['listen', 'watch', 'view', 'play', 'compare', 'answer'] }, media_id: { type: 'string' }, media_ids: { type: 'array', items: { type: 'string' } }, seconds: { type: 'number' } } },
          respond: { type: 'object', properties: { fields: { type: 'object' } } }, who: { type: 'object', properties: { count: { type: 'integer' }, enough: { type: 'integer' }, pool: { type: 'string' }, pace: { enum: ['instant', 'human'] }, script: { type: 'array' } } },
          pay: { type: 'object', properties: { per_person_usd: { type: 'string' }, estimated_minutes: { type: 'integer' } } }, by_minutes: { type: 'integer' }, max_total_usd: { type: 'string' }, idempotency_key: { type: 'string' } } },
      },
    },
    security: [{ bearer: [] }],
    paths: {
      '/v1/keys': { post: { summary: 'Make a free test key (reaches simulated people; $100 of test money)', security: [], responses: { 201: ok('{key, principal_id, balance_usd, test_money}'), 429: err } } },
      '/v1/quotes': { post: { summary: 'Price a call; nothing is spent', requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Call' } } } }, responses: { 200: ok('{quote_id, lines, total_usd, expected_minutes_to_enough, test_money}'), 400: err } } },
      '/v1/calls': { post: { summary: 'Open a call', parameters: [{ name: 'Idempotency-Key', in: 'header', schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Call' } } } }, responses: { 201: ok('{call_id, status, quote, held_usd, next_check_after_seconds}'), 400: err, 402: err, 403: err } } },
      '/v1/calls/{call_id}/responses': { get: { summary: 'Answers so far: tally first, one line per person, money', parameters: [{ name: 'call_id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'after', in: 'query', schema: { type: 'string' } }, { name: 'wait_seconds', in: 'query', schema: { type: 'integer', maximum: 25 } }, { name: 'detail', in: 'query', schema: { enum: ['summary', 'full'] } }, { name: 'person', in: 'query', schema: { type: 'string' } }], responses: { 200: ok('result'), 404: err } } },
      '/v1/calls/{call_id}/cancel': { post: { summary: 'Stop a call', parameters: [{ name: 'call_id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: ok('{call_id, status}') } } },
      '/v1/calls/{call_id}/changed': { post: { summary: 'Tell the people what their answers changed (one line, shown on their receipts)', parameters: [{ name: 'call_id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: ok('{what_changed}') } } },
      '/v1/media/samples': { get: { summary: 'Shared sample material any key may use', security: [], responses: { 200: ok('{samples}') } } },
      '/v1/panels': { get: { summary: 'Panels this key can call', responses: { 200: ok('{panels}') } }, post: { summary: 'Make a panel (real_ keys)', responses: { 201: ok('{panel_id, join_link}'), 403: err } } },
      '/v1/receipts/{receipt_id}': { get: { summary: 'A signed receipt', security: [], parameters: [{ name: 'receipt_id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: ok('{receipt, signature, key_id, receipt_text}') } } },
      '/v1/receipts/verify': { post: { summary: 'Check a receipt\'s signature', security: [], responses: { 200: ok('{valid}') } } },
      '/v1/status': { get: { summary: 'Health: the ledger sum and the build', security: [], responses: { 200: ok('{ok, ledger_sum_cents}') } } },
    },
  };
}
