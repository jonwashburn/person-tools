## 1. Status and scope

This is version 0.1 of {{standard}}, a draft. It defines one conformance class, the **call server**: an HTTP service an
agent calls to ask people to do something, which returns their answers with a record of what they did. A router and an
operator of a pool are both call servers; a router reaches another call server through this same interface.

0.1 defines: the call, the quote, the response and its record, the states of a call and of a person's seat, evidence
levels, receipts, errors, idempotency, authentication, discovery, a required simulated pool, the HTTP binding and the
mapping to tools of the Model Context Protocol. It defines a profile of rules that protect the people called (section
23), which a server may declare and a separate set of checks tests. What 0.1 leaves for later is in Appendix A, each item
with its reason.

Each requirement carries an identifier in brackets, such as `[CALL-3]`. The conformance suite maps every identifier to
a check, or says why it has none (section 25).

## 2. Conventions

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, MAY and OPTIONAL are to be
read as described in BCP 14 (RFC 2119, RFC 8174) when, and only when, they appear in capitals.

- **JSON.** Every body is a JSON object (RFC 8259) in UTF-8, sent with `Content-Type: application/json`.
- **Money** is a string of decimal digits with exactly two places, such as `"12.50"`, in US dollars. A field that holds
  money ends in `_usd`. 0.1 has one currency. **[CONV-1]** A server MUST NOT send money as a JSON number.
- **Times** are RFC 3339 strings in UTC with a `Z`, such as `"2026-11-14T06:40:00Z"`. Lengths of time are numbers whose
  field name carries the unit: `_seconds`, `_minutes`.
- **Identifiers** are opaque strings of 1 to 64 characters from `A-Z a-z 0-9 _ -`. A client MUST NOT parse them. The
  prefixes in the examples (`call_`, `r_`, `q_`) are a convention of the examples, not a requirement.
- **Unknown fields.** **[CONV-2]** A server MUST refuse a request body that contains a field this version does not
  define, with the error `unknown_field` naming the field and, where one is close, the field that was probably meant.
  Fields inside an object named `ext` are exempt: `ext` holds extensions, each under a key that is a domain name its
  author controls (`"ext": { "example.org": { ... } }`). Reason: an agent that misspells a field should hear about it
  at once, not get a call it did not mean. **[CONV-3]** A client MUST ignore fields it does not know in a response; a
  server adds fields this version does not define only under `ext`.
- **Text a person reads** (`ask`, field labels, choices, the outcome line) is plain text. **[CONV-4]** A server MUST NOT
  interpret markup or follow links in it; it is shown to the person as written, as text.

## 3. Roles and terms

- **Agent** (the asker): the software that makes the call.
- **Principal**: the person or company accountable for the agent and for paying. Every key belongs to one principal.
- **Person**: a human who may be asked. A person is an adult (section 16).
- **Call server**: the service the agent calls. It screens the call, finds people, shows each the thing, records what
  happened, decides the evidence level, settles pay and issues receipts. It may do some of this through other call
  servers.
- **Pool**: a set of people a call server can reach, named by a string (section 16). Every call server has the pool
  `simulated`.
- **Seat**: one person's place on one call, from the moment they are offered it to the moment they answer, stop, decline
  or let the offer lapse.
- **Runner**: the page a person opens to do the thing. The runner is part of the call server; this document says what it
  must record, not how it is built.

## 4. Versions

**[VER-1]** A request MAY carry the header `{{wire_prefix}}-version: 0.1`. A server MUST answer a request without it as
the newest version it lists in discovery, whatever that version's status, and MUST answer a version it does not serve with the error
`version_unsupported` and the list of versions it does serve. **[VER-2]** Every response from a server carries the header
`{{wire_prefix}}-version` with the version that answered.

A server MUST keep serving a version for at least twelve months after it lists its successor as stable (**[VER-3]**).

## 5. Discovery

**[DISC-1]** A call server MUST serve a discovery document at `/.well-known/{{wire_prefix}}` on the host of its API, as
JSON, without authentication:

```json
{
  "protocol": "{{wire_prefix}}",
  "versions": [ { "version": "0.1", "status": "draft" } ],
  "api_base": "https://api.example.com",
  "mcp": "https://api.example.com/mcp",
  "openapi": "https://api.example.com/openapi.yaml",
  "jwks_uri": "https://api.example.com/.well-known/jwks.json",
  "mcp_protocol_versions": [ "2026-07-28", "2025-06-18" ],
  "kinds": [ "listen", "watch", "view", "play", "compare", "answer" ],
  "pools": [ "simulated", "panel" ],
  "features": [ "keyless", "url_content", "media_upload", "outcome", "voice", "panels" ],
  "profiles": [ "{{wire_prefix}}/fair-call/0.1" ],
  "screening_policy": "https://example.com/policy",
  "test_keys": "https://api.example.com/v1/keys",
  "privacy_floor": 20,
  "pay_terms": null,
  "pay_floor_usd_per_hour": "20.00",
  "limits": { "max_people": 50, "max_deadline_minutes": 10080, "max_wait_seconds": 25, "stop_minimum_usd": "0.00" },
  "retention": { "recordings_days": 90, "responses_days": 365, "records_days": 365 }
}
```

- `kinds` lists the kinds the server accepts. **[DISC-2]** It MUST include every kind the server accepts and no other.
  The core is `listen`, `view` (with `{text}` content at least) and `answer`; a server MUST accept those three.
- `features` lists the optional parts of this text the server offers: `keyless` (AUTH-5), `url_content` (https
  addresses as content, section 9.1), `media_upload` (`POST /v1/media`), `outcome` (section 15.2), `voice` (spoken
  answers), `panels` (section 16.1). **[DISC-5]** A server MUST offer every feature it lists, and MUST answer a request
  that needs a feature it does not list with `unsupported_feature` (a request without a key, where `keyless` is not
  listed, is `unauthorized`), fixable where a change to the call avoids it. A
  server that offers only the core and the simulated pool conforms: it is a call server whose people are all scripted,
  which is what a developer runs to test an agent.
- `pools` lists the pool types it accepts; `panel` means private panels (`panel:<id>`).
- `profiles` lists the profiles the server declares (section 23). A server that lists a profile MUST pass that profile's
  checks (**[DISC-3]**).
- `jwks_uri` is a JSON Web Key Set (RFC 7517) holding the public keys that sign receipts. **[DISC-4]** Every receipt the
  server has issued in the last twelve months MUST verify against a key in that set, or against a key the set lists
  under `"revoked"` with the time it was revoked.
- `test_keys` is present when the server issues test keys to anyone (section 18).
- `api_base`, `mcp` and every other address in discovery are absolute `https` addresses, except that a server run for
  local testing on a loopback address (`localhost`, `127.0.0.1`, `[::1]`) may use `http`. A server serving one host
  uses that host in every address; one serving several builds them from the request's host. A server reachable under more than one host SHOULD build them from
  the host of the request.
- When a field is absent, these defaults apply: `limits.max_people` 50, `limits.max_deadline_minutes` 10080,
  `limits.max_wait_seconds` 20, `limits.stop_minimum_usd` "0.00", `privacy_floor` 20, `features` empty, `profiles`
  empty. `pay_floor_usd_per_hour` is REQUIRED of a server that pays people.

## 6. Authentication and keys

**[AUTH-1]** Every request except discovery, the JWKS, `GET /v1/media/samples`, `POST /v1/keys` and
`POST /v1/receipts/verify` MUST carry
`Authorization: Bearer <key>`, unless the server serves it without a key under AUTH-5 below. A missing key where one is
needed, or a key the server does not know, is the error `unauthorized` (HTTP 401), which is fixable: `field` is
`Authorization`, `example` is `"Bearer test_..."`, and `message` says how to get a test key when the server issues them.

**[AUTH-5]** A server SHOULD serve requests that carry no key on the simulated pool: quotes, and calls with
`pool: "simulated"`, each such call belonging to no principal. The `call_id` of a call opened without a key, which MUST
carry at least 120 random bits, is then the only authority to read, cancel or send an outcome line for it. Any other pool
without a key is `unauthorized`. A keyless call is unpaid (`pay_per_person_usd` "0.00"; anything else is
`forbidden_for_key_class`, fixable, `field` `pay_per_person_usd`, `example` "0.00"), holds no money, gets a fresh
`person_ref` for every response, and its receipts say `"answered_for": "an unnamed test caller"`. On a server that lists `keyless`, a request without a key for a call that was opened with one is answered as for a
call that does not exist (`not_found`); on a server that does not, any request without a key is `unauthorized`. A
request with a key may not read or change a keyless call (`not_found`). Reason: an agent that has found only a server's address can make a first call, and see
everything a call returns, before anyone makes it a key.

There are two classes of key, and a server MUST tell them apart (**[AUTH-2]**):

- A **test key** reaches the simulated pool, any test panels the server names (it may name none) and, where the server
  lets test keys make panels, the panels its own principal made; it moves only test money, and **[AUTH-3]** MUST NOT
  cause any real person to be offered a seat except a person who joined one of its principal's own panels from that
  panel's join link. A test key's string begins `test_`.
- A **live key** may reach real people. It belongs to a principal who has accepted the server's terms. 0.1 does not
  define how a principal gets one.

**[AUTH-4]** A request that a test key may not make (a real pool, a panel that is neither a test panel nor its principal's own, an upload where the
server allows uploads to live keys only) is the error `forbidden_for_key_class` (HTTP 403), fixable, with `field` naming
what to change and an `example` that a test key may use.

A key MAY carry caps set by its principal: the most one call may cost and the most the key may spend in a day. How a
principal sets them is outside 0.1, except for test keys, whose caps may be set when the key is made (section 18.1).
Section 12 says what happens at a cap. CALL-1 gives the order in which errors are reported.

## 7. Idempotency

Agents retry. A retry must never open a second call or spend twice.

- **[IDEM-1]** `POST /v1/calls`, `POST /v1/calls/{id}/outcome` and `POST /v1/panels` SHOULD carry
  `idempotency_key` in the body: a string of 1 to 128 characters chosen by the client. When it is absent, a server MUST
  treat the same body from the same principal (or, without a key, from the same network address) within 10 minutes as a
  repeat under IDEM-2, and MUST say so in `defaults_used`.
- **[IDEM-2]** A repeat of the same key, by the same principal (or, without a key, from the same address), to the same
  operation, with the same body, within 24 hours, MUST return the same status and the same body as the first successful
  answer, with every field that changes over time (state, counts, money, outcomes, review times,
  `next_check_after_seconds`, `next_step`) as it is now, and MUST NOT open, charge or send anything again. Only a successful answer binds a key:
  after an error, a retry with the same key is tried afresh.
- **[IDEM-3]** A repeat of the same key with a different body, within the 24 hours of IDEM-2, is the error
  `idempotency_key_reused` (HTTP 409), fixable, with `field: "idempotency_key"`. After 24 hours the key is free again.
- **[IDEM-4]** `POST /v1/calls/{id}/cancel` is idempotent by nature: cancelling a cancelled or finished call returns
  the call as it is, with HTTP 200.

Two bodies are the same when they are equal as JSON values after money is written as two-decimal strings: the order of
keys, white space, and `2` versus `"2.00"` do not matter.

## 8. Errors

**[ERR-1]** Every error is a JSON body with an HTTP status of 400 or above, of this shape:

```json
{
  "code": "over_max_total_usd",
  "message": "This call would cost 12.40 and max_total_usd is 10.00.",
  "status": 400,
  "fixable": true,
  "field": "max_total_usd",
  "example": "12.40",
  "rule": null
}
```

- `code` comes from the registry in section 24. A client acts on `code`, never on `message`.
- `message` is one or two plain sentences an agent can show its user.
- `fixable` says whether the agent can fix this by changing its request. **[ERR-2]** When `fixable` is true, the error
  MUST name the `field` (a dotted path such as `answer_fields.felt.type`, or a header name such as
  `Authorization`) and give an `example`: a value for that field that would not cause this error, or `null` when the fix
  is to remove the field. `example` is always a value for `field`, never a whole body. When `fixable` is false, `message` MUST say what the agent should do instead, such as "stop and tell
  your user" or "ask your user to approve this amount at approve_url".
- `rule` names the policy rule that decided a screening refusal (section 17).
- **[ERR-3]** An error in answer to `POST /v1/calls` MUST carry `"charged_usd": "0.00"` and `"anyone_asked": false`:
  a refused call costs nothing and reaches nobody. An agent can say so to its user.
- An error MAY carry `problems`: a list of `{ "field", "example", "message" }` when more than one change is needed, so
  that one retry can fix them all; the top-level `field` and `example` repeat the first.
- `unknown_field` names the field and, where a defined field is close, adds `did_you_mean`; its `example` is `null`
  (remove the field). `unknown_pool` adds `pools`, the pools the key may use, and its `example` is one of them.
- `field` is a dotted path; array items are numbered from 0 (`script.0.answers`, `content.1`). Lengths in this text
  count Unicode code points.
- Some codes carry more fields, named in the registry: `quote` and `approve_url` with `over_key_cap`;
  `retry_after_seconds` with `rate_limited`; `versions` with `version_unsupported`.

The body is compatible with RFC 9457 problem details: a server MAY add `type`, `title` and `detail`, and MAY send it
as `application/problem+json`.
