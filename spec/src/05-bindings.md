## 19. The HTTP binding

Paths are relative to `api_base` in discovery (a host, such as `https://api.example.com`). The OpenAPI 3.1 document (`openapi.yaml`) gives every shape; this table
is the list.

| Operation | Method and path | Success | Key |
|---|---|---|---|
| Price a call | `POST /v1/quotes` | 200, a quote | any |
| Open a call | `POST /v1/calls` | 201, the call | any |
| A call's state | `GET /v1/calls/{call_id}` | 200, the call | the key's principal |
| Answers so far | `GET /v1/calls/{call_id}/responses` | 200, results (section 13) | the key's principal |
| Stop a call | `POST /v1/calls/{call_id}/cancel` | 200, the call | the key's principal |
| Tell the people what changed | `POST /v1/calls/{call_id}/outcome` | 200 | the key's principal |
| Make a panel and its join link | `POST /v1/panels` | 201, the panel | any key where the server offers panels (a server MAY limit it to live keys) |
| A panel's state | `GET /v1/panels/{panel_id}` | 200, the panel | the key's principal |
| Add material | `POST /v1/media` | 201, `{ "media_id", "kind", "seconds", "bytes" }` | as the server allows (section 6); feature `media_upload` |
| Samples anyone may use | `GET /v1/media/samples` | 200, a list of media ids with kind and length; **[HTTP-5]** at least one sample for each of `listen`, `watch` and `play` that the server lists, and for `view` if it takes more than `{text}` | any, or none |
| A receipt | `GET /v1/receipts/{receipt_id}` | 200, `{ "receipt", "jws" }` | the principal of the call |
| The key's balance | `GET /v1/balance` | 200, `{ "balance_usd", "held_usd", "caps": { "per_call_usd", "per_day_usd" }, "spent_today_usd", "test_money" }` | any key |
| Check a receipt | `POST /v1/receipts/verify` | 200 | none |
| Make a test key | `POST /v1/keys` | 201 | none |
| Discovery | `GET /.well-known/{{wire_prefix}}` | 200 | none |
| The addresses discovery names (`jwks_uri`, `openapi`, `mcp`, `screening_policy`) | as named | 200 | none; at `mcp`, each tool needs what its HTTP operation needs (AUTH-5) |

**The call, as returned** by `POST /v1/calls`, `GET /v1/calls/{id}` and cancel:

```json
{
  "call_id": "call_2b9x0c4v6n8m1q3w5e7r",
  "status": "open",
  "created_at": "2026-11-14T06:25:00Z",
  "deadline": "2026-11-14T08:25:00Z",
  "call": { "...the call as the server understood it, defaults applied and fields in object form..." },
  "defaults_used": { "...": "every default applied (CALL-2)" },
  "outcomes": [],
  "quote": { "...section 12.1..." },
  "summary": { "...section 13..." },
  "money": { "held_usd": "0.00", "spent_usd": "0.00", "returned_usd": "0.00", "test_money": true },
  "simulated": true,
  "test_money": true,
  "next_check_after_seconds": 5
}
```

- **[HTTP-1]** A request for a call or panel that belongs to another principal MUST be answered exactly as one for a call
  or panel that does not exist: `not_found`, 404.
- **[HTTP-2]** A server MUST answer every API route above with JSON, including errors, and MUST NOT answer an API route
  with an HTML page. The documents discovery names (the policy, the OpenAPI file) are served in their own formats.
- **[HTTP-3]** Rate limits are the error `rate_limited`, 429, with `retry_after_seconds`.
- **[HTTP-4]** A path or method this table does not list, and discovery does not name, is `not_found`, 404, as JSON.
- Material: `POST /v1/media` takes the bytes as the body with their `Content-Type` (audio, video, an image, a page as
  HTML, or a build as a zip), at most 100 MB, and returns `{ "media_id", "kind", "seconds", "bytes" }`. `GET
  /v1/media/samples` returns `{ "samples": [ { "media_id", "kind", "seconds", "title", "licence" } ] }`: material the
  server publishes for anyone to use in a call.
- A panel: `POST /v1/panels` with `{ "name": "...", "idempotency_key": "..." }` returns `{ "panel_id", "name",
  "join_url", "members": 0, "members_on_now": 0 }`. The join link is for the principal to send to people it chooses.

## 20. The tool binding (Model Context Protocol)

The same operations are tools on a Model Context Protocol server at the address `mcp` in discovery, over Streamable
HTTP, without session state. **[MCP-1]** A server MUST complete the protocol's handshake and `tools/list` and
`tools/call` for at least one of the revisions 2026-07-28, 2025-11-25 and 2025-06-18 of the Model Context Protocol
(modelcontextprotocol.io/specification), MUST list the revisions it accepts in discovery under `mcp_protocol_versions`,
and SHOULD accept 2026-07-28 and one handshake-era revision. Under 2026-07-28 a client opens with `server/discover`.
A server that lists 2026-07-28 MUST answer `server/discover` and MUST give every result the members that revision
requires (such as `resultType`, `ttlMs` and `cacheScope` on `tools/list`). A server that does not list it MUST answer
`server/discover` with JSON-RPC "method not found" (-32601), so that the client falls back to the handshake. A server
that also lists a handshake-era revision (2025-06-18 or 2025-11-25) MUST answer the older `initialize` handshake with
one of those, never with 2026-07-28, or no current client can open it. A server that lists only 2026-07-28 MUST answer
`initialize` with "method not found" (-32601).

| Tool | Operation | Arguments |
|---|---|---|
| `{{tool}}_quote` | `POST /v1/quotes` | the call (section 9) |
| `{{tool}}` | `POST /v1/calls` | the call |
| `{{tool}}_results` | `GET /v1/calls/{call_id}/responses` | `call_id`, and optionally `after`, `wait_seconds`, `detail` |
| `{{tool}}_cancel` | `POST /v1/calls/{call_id}/cancel` | `call_id` |
| `{{tool}}_send_outcome` | `POST /v1/calls/{call_id}/outcome` | `call_id`, `text`, and optionally `idempotency_key` |
| `{{tool}}_panel` | `POST /v1/panels` | `name`, and optionally `idempotency_key`; it makes a panel and returns it with its join link |

- `{{tool}}_send_outcome` and `{{tool}}_panel` are offered only by a server that lists the features `outcome` and `panels`.
  Reading a panel is HTTP only (`GET /v1/panels/{panel_id}`); a quote on `panel:<id>` already says how many people are
  on it and how many are on now, so an agent need not read the panel to call it.
- **[MCP-2]** Apart from checking JSON types and required fields, a tool's `inputSchema` MUST NOT reject an argument
  object that its operation would accept or would answer with its own error: it names the fields of `schemas/tool_args.json` with their JSON types, lets money be a string or a
  number, requires only the required fields, and allows further properties, so that the operation's own validation answers with the errors of section 8 (an `unknown_field`
  with `did_you_mean`, say). A tool name the server does not offer is a JSON-RPC error (-32602). A tool result's
  `structuredContent` MUST be the JSON body the operation would return over HTTP, field for field.
- **[MCP-3]** A tool result MUST also carry one `text` content block: a plain first line saying what happened (for a
  simulated call, beginning with the word SIMULATED), then the same JSON.
- **[MCP-4]** An error is a tool result with `isError: true` whose `structuredContent` is the error object of section 8.
  It is never a protocol error, so that an agent reads `fixable`, `field` and `example`.
- **[MCP-5]** Every tool MUST declare an `outputSchema` and these annotations, which describe the worst case a client
  must plan for: `{{tool}}_quote` and `{{tool}}_results` `readOnlyHint: true`, `idempotentHint: true`; `{{tool}}`
  `destructiveHint: true` (it can spend money), `idempotentHint: false` (without a key, a repeat after ten minutes opens
  a new call), `openWorldHint: true`; `{{tool}}_cancel` `destructiveHint: true` (a cancelled call cannot be reopened),
  `idempotentHint: true`; `{{tool}}_send_outcome` `destructiveHint: true` (a line shown to people cannot be taken back),
  `idempotentHint: false`, `openWorldHint: true`; `{{tool}}_panel` `destructiveHint: false`, `idempotentHint: false`,
  `openWorldHint: true`. Every tool but the first two has `readOnlyHint: false`.
- **[MCP-6]** A tool description MUST say what the tool does, when not to use it, and what it costs in time and money,
  and MUST NOT praise the tool or instruct the model beyond that.
- Authentication is the same bearer key, in the `Authorization` header of the MCP request.
- Where a client and server both declare the protocol's long-running tasks, a server MAY also offer `{{tool}}` as a
  task whose result is the results of section 13 once the call reaches `enough` or ends. The tools above remain the
  binding every client can use.

The tool names are part of the wire. They are working names in this draft and are fixed when 0.1 is final.
