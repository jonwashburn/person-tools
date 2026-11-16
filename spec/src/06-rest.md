## 21. Security considerations

- **Keys.** A key is a bearer secret. A server MUST accept keys only over TLS and MUST NOT put a key in a URL, a log line
  or a response other than the one that issued it. A principal SHOULD be able to revoke a key at once.
- **Material from strangers.** Everything an agent sends for a person to meet is content from a stranger. **[SEC-1]** It
  MUST be copied into the server's own storage before any person is offered a seat, and the page that shows it MUST be
  unable to reach any other address: no request from a person's device goes to the agent's servers or anywhere else
  outside the server. Pages and builds run in a frame that cannot read the runner's own page. Password and payment
  fields are never shown.
- **Fetching on request.** **[SEC-2]** A server that fetches material from an address MUST fetch only `https`
  addresses on the public internet, MUST refuse addresses that resolve to private, loopback or link-local ranges, after
  every redirect, and SHOULD cap size and time.
- **Receipts.** The signing key is the server's most valuable secret. Keys rotate by adding a new key to the JWKS and
  signing with it. A compromised key moves from `keys` to `revoked` in the JWKS document, keeping its public part and
  gaining the time: `"revoked": [{ "kty": "OKP", "crv": "Ed25519", "x": "...", "kid": "...", "revoked_at": "..." }]`.
  The server re-signs the receipts it made with that key (RCPT-4); a receipt that checks only against a revoked key
  (`valid: true, revoked: true`) proves nothing about when it was signed, and `on_record` says whether it is genuine.
- **Seat links.** The link a person opens names one seat and is signed by the server; it carries no key and grants
  nothing but that seat. **[SEC-3]** A seat link MUST NOT reveal to anyone who holds it the person's identity, the
  principal's key, or other seats.
- **Answers are untrusted text.** An agent MUST treat people's answers as data, never as instructions.

## 22. Privacy considerations

- **[PRIV-1]** The agent never receives who a person is (section 13.2). It receives a `person_ref` that only joins
  calls from the same principal.
- Claims are returned at the coarsest value that answers the selector, with their basis.
- **[PRIV-2]** A recording of a person's voice is shared with the agent only if the person said yes for that call.
  Nothing in a conforming server tries to tell who is speaking from a voice.
- A server publishes in discovery, under `retention`, how long it keeps each kind of record (`recordings_days`,
  `responses_days`, `records_days`), and deletes on time. A person can have their own records deleted.
- On a small panel the people are told their answers cannot be anonymous (section 16.1).

## 23. The fair-call profile

A profile is a set of rules a server may declare beyond the core. 0.1 defines one, the rules that protect the people who
are called. Its identifier is `{{wire_prefix}}/fair-call/0.1`. A server that lists it in discovery under `profiles`
keeps every rule below for every pool it serves, and passes the profile's own checks.

| Rule | A server that declares the profile... |
|---|---|
| **FAIR-1** | lets no asker reject an answer or withhold pay. Pay is withheld only for fraud the server can show, the person is shown why, and can appeal. |
| **FAIR-2** | pays from the first second: a person who stops is paid by the formula of section 12.3, however early they stop. |
| **FAIR-3** | holds an offer for the one person it was made to for at least 60 seconds, and never lets a person do work on a seat that is already gone: the seat is taken before the thing starts. |
| **FAIR-4** | sets the floor as the higher of its own and the pool's, publishes it, and, if the median time of a call's answered seats exceeds `minutes`, tops up each answered person to the floor for that median, from the reserve. |
| **FAIR-5** | makes stopping free and paid at every moment; a person who stops because the call upset them is paid in full, and the call moves to `held` until it is reviewed. |
| **FAIR-6** | shows the person, before they take a seat: who answers for the call, that an AI is asking, the minutes, the pay and what it comes to an hour or that it is unpaid, the content rating, what will be recorded and for how long, the download size, whether the answers may train models, and on a panel its size. |
| **FAIR-7** | shows the person, on their receipt, what the asker paid for their seat and each fee. |
| **FAIR-8** | never asks a person an unpaid question to decide whether they qualify. |
| **FAIR-9** | rings nobody in their quiet hours (by default 9 PM to 8 AM where they are, which each person can change) or while they are switched off, and says so to the asker before it calls (MONEY-11). |

How each is checked from outside, through the simulated pool and `detail=full`: FAIR-2 and FAIR-5 by scripted stops
and the pay returned; FAIR-6 by the `offer` each response carries; FAIR-7 by the `fees` in each receipt; FAIR-3 and
FAIR-8 by the states and the offer a simulated person met; FAIR-1 by the absence of any operation that rejects; FAIR-4 by
a scripted call whose median runs long.

## 24. Registries

Each list below is closed in 0.1: a value not listed is invalid. A later version may add values; an extension uses its
own key under `ext` and never a new value in these lists.

- **Kinds:** `listen`, `watch`, `view`, `play`, `compare`, `answer`. Reserved: `talk` (a live conversation), `go` (a task
  away from the screen).
- **Pools:** `simulated`, `panel:<panel_id>`, and names a server lists in discovery.
- **Answer field types:** `text`, `boolean`, `number`, `choice`, `scale`.
- **How an answer was entered:** `typed`, `pasted`, `mixed`, `spoken`, `tapped`.
- **Call states:** `held`, `open`, `enough`, `complete`, `expired`, `cancelled`, `refused`.
- **Seat states:** `offered`, `taken`, `answered`, `stopped`, `declined`, `missed`, `withdrawn`.
- **Evidence levels:** `said`, `attended`, `voiced`. Reserved: `live`.
- **Unobserved:** `audible`, `eyes_on_screen`, `unassisted_answer`, `same_person`.
- **Quote lines:** `to_people`, `pool_fee`, `router_fee`, `rail_fee`, `reserve`, `tax`.
- **Selector keys:** `country`, `region`, `language`, `age_band`, `device`.
- **Claim bases:** `self`, `observed`, `document`, `vouched`, `earned`.
- **Screening categories:** `credentials`, `accounts`, `paid_engagement`, `impersonation`, `third_party_contact`,
  `personal_data`, `off_platform`, `sexual`, `minors`, `ban_evasion`, `deception`, `physical_world`; `outside_material`
  (a link or material the person would be sent to outside the server), `sensitive_data` (asking a person about their
  health, religion, sexuality, ethnicity, immigration or politics), `unpaid_screener` (an unpaid question to decide who
  qualifies), `harassment` (threats or harassment of anyone), `voice_misuse` (cloning a voice or identifying a speaker), `call_terms` (terms of the call the policy does
  not allow, such as its size or rating); and in 0.1 also `violent`, `medical`, `grief` (not allowed in the first
  version, warned or not).
- **Content ratings:** `general`.
- **Profiles:** `{{wire_prefix}}/fair-call/0.1`.
- **The person client's lists** (step types, actions on an ask, ask states, urgencies, note authors, card blocks, brand mark
  states, connection icons) are in section 26.12.

**Error codes:**

| Code | HTTP | Fixable | Meaning, and extra fields |
|---|---|---|---|
| `invalid_json` | 400 | yes | The body is not a JSON object; `field` is `body` and `example` a minimal valid body. |
| `missing_field` | 400 | yes | A required field is absent. |
| `invalid_field` | 400 | yes | A field's value is not allowed. |
| `unknown_field` | 400 | yes | A field this version does not define (section 2). |
| `unauthorized` | 401 | yes | No key, or a key the server does not know. |
| `forbidden_for_key_class` | 403 | either | A test key (or no key) asked for something only a live key may do; fixable, with `field` and `example`, when a change to the request avoids it (a pool, a pay of "0.00"); not fixable when it does not (making a panel, on a server that limits panels to live keys). |
| `not_found` | 404 | no | No such call, panel, receipt or media for this key. |
| `idempotency_key_reused` | 409 | yes | The same key with a different body. |
| `over_max_total_usd` | 400 | yes | The total is above `max_total_usd`. |
| `over_key_cap` | 402 | no | Above the key's cap for one call or for the day. `quote`, `approve_url`. |
| `insufficient_balance` | 402 | no | The balance is short. `top_up_url` when there is one. |
| `below_pay_floor` | 400 | yes | Pay is under the floor for `minutes`. |
| `unknown_pool` | 400 | yes | No such pool for this key. |
| `unknown_selector` | 400 | yes | A selector key the server does not know. |
| `selector_unsupported` | 400 | yes | A selector the pool cannot apply. |
| `privacy_floor` | 400 | yes | The selectors match too few people. |
| `content_unavailable` | 400 | yes | The material could not be fetched or held. |
| `content_too_large` | 413 | no | The material is larger than the server takes (100 MB for `POST /v1/media`); `message` says the limit. |
| `unsupported_feature` | 400 | either | A part of the call or an operation this server does not offer: fixable when the request can drop it (`voice`, an address as `content`), not fixable for an operation (`POST /v1/media`, `POST /v1/panels`). |
| `refused_screening` | 422 | either | Screening refused the call. `rule`, `category`, `rule_text`. |
| `outcome_not_allowed` | 409 | no | A fourth outcome line on a call. |
| `version_unsupported` | 400 | yes | A version the server does not serve; `field` is the version header, `example` a version it serves. `versions`. |
| `rate_limited` | 429 | no | Too many requests. `retry_after_seconds`. |
| `already_answered` | 409 | no | Section 26: the ask was answered already, on this or another device, or no longer takes notes. |
| `conflict` | 409 | no | Section 26: the request conflicts with the state of what it names, such as a sign-in code stopped by a wrong number. |
| `expired` | 410 | no | Section 26: what the request names has ended, such as a sign-in code. |
| `internal` | 500 | no | The server failed. Nothing was charged; try again later. |

## 25. Conformance

A call server conforms to {{standard}} 0.1 when it meets every MUST in sections 2 to 22 that applies to the kinds,
pools and features it lists in discovery. A server that offers only the core and the simulated pool conforms. The
conformance suite is the test, published beside this text: one command, run against any address with a test key (or
none, when the server issues test keys), driving every state, every kind the server lists and every error through the
simulated pool. Its file `traceability` maps every requirement identifier
in this text to the check that tests it, or says why none can.

A server that lists `person_client` in discovery also meets every requirement of section 26 marked `MEMBER-`, and a person
client meets those marked `CLIENT-` (section 26.13).

A server that passes says exactly: "passes suite `<version>` against {{standard}} 0.1 core", and, for each profile it
declares and passes, the profile's name. Nothing more. A pass by an implementation its authors wrote for this text's own
tests (such as the second implementations written to check this text) is a test of the text, and is not counted as
adoption.
