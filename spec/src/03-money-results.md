## 12. The quote and the money

### 12.1 The quote

`POST /v1/quotes` takes a call body and returns what it would cost. Nothing is held or spent, and nobody is asked.

```json
{
  "quote_id": "q_7f3kd0a1m2n4p5q6r7s8",
  "pool": "panel:p_family",
  "panel_size": 9,
  "members_on_now": 4,
  "people": 8,
  "pay_per_person_usd": "2.00",
  "lines": [
    { "kind": "to_people", "amount_usd": "16.00" },
    { "kind": "router_fee", "amount_usd": "1.60", "note": "10% of what people are paid, at least 0.25" },
    { "kind": "reserve", "amount_usd": "4.00", "note": "for pay above the estimate; returned if unused" }
  ],
  "total_usd": "21.60",
  "pay_floor_usd_per_hour": "20.00",
  "expected_minutes_to_enough": 12,
  "expected_note": "a private panel of 9; most answer within 15 minutes",
  "expires_at": "2026-11-14T06:40:00Z",
  "defaults_used": { "content_rating": "general", "may_train_on_answers": false },
  "simulated": false,
  "test_money": false
}
```

- **[MONEY-1]** `lines` MUST list each charge separately, each with a `kind` from the registry (section 24):
  `to_people`, `pool_fee`, `router_fee`, `rail_fee`, `reserve`, `tax`. A line of zero MAY be shown.
- **[MONEY-2]** `total_usd` MUST equal the sum of the lines, to the cent.
- `expected_minutes_to_enough` is the server's honest estimate of the minutes until `enough` answers; `null` when it
  cannot say, with `expected_note` saying why. **[MONEY-3]** A server MUST NOT state an estimate it has no basis for.
- **[MONEY-12]** On a panel, the quote MUST carry `panel_size` and `members_on_now`, and `small_panel: true` when the
  panel has fewer than five people, so the agent knows before it calls that the answers cannot be anonymous.
- **[MONEY-11]** When nobody the call could reach can be offered a seat now (everyone is off, in their quiet hours or at
  their limit of rings), the quote MUST carry `earliest_ring_at`, the time the first seat can be offered, and
  `expected_minutes_to_enough` MUST count from then; the call and its results say the same in `next_step` until the
  first offer goes out. When `earliest_ring_at` is after the call's deadline, the quote's `expected_note` says that
  nobody can be rung before the deadline; a call opened anyway expires unanswered and costs nothing.
- **[MONEY-13]** A quote SHOULD carry `for_your_user`: at most 600 characters of plain sentences, ending in a question,
  that an agent can show its user to ask for approval. It names what people will be asked to do, how many, the total
  with each line, whether it is real or test money, and when answers are expected. For example: "This asks 8 people to
  listen to your track and say what they felt, for $21.60 of real money: $16.00 to the people, a $1.60 fee and a $4.00
  reserve that comes back if unused, with most answers within 15 minutes. Shall I go ahead?"
- **[MONEY-14]** An agent that quotes, asks its user, and then calls with `max_total_usd` equal to the quote's total
  must not be refused for the price. So a call MUST NOT need more than a quote's `total_usd` when all of these hold: the
  call's body and the quote's body, each without `max_total_usd` and `idempotency_key`, are the same (section 7); the
  call comes from the principal that asked for the quote (a quote asked without a key protects only a call sent without
  a key, from the same network address); and it opens before the quote's `expires_at`. When several quotes qualify, the
  lowest total counts: the server opens the call at that quote's lines and total, holds no more, and echoes that quote
  in the call's `quote`, even when its own price has risen since. A server MUST set `expires_at`
  at least 10 minutes after it gives the quote, or leave it null when the quote does not expire. A quote given without
  `content` (CALL-7) is a different body from the call that adds it: it protects nothing, and the agent quotes again
  once it has the material (for listen and watch, the default `minutes` follows the material's length).
- Beyond that, a quote does not bind the server: `max_total_usd` on the call is the agent's guarantee. `quote_id` names the quote
  in the call's echo and in logs; `expires_at` is when the server stops standing behind its estimate.
- `reserve` is optional and the server's own: it bounds pay above the estimate (FAIR-4) and is returned if unused.
- `test_money` is true whenever the money is not real. **[MONEY-4]** Every response body that carries a call's or a key's
  money (a quote, a call, results, a balance, a receipt) MUST carry `test_money`, at its top level or in the object that
  holds the amounts (a quote and a call carry it at their top level, results in `money`, and an error that carries a
  quote inside that quote). An
  error's `charged_usd` (always "0.00", ERR-3) and the published rates in discovery are not money moved and need none.

### 12.2 Opening, holding and settling

**[MONEY-5]** When a call opens (as `open` or as `held`), the server MUST hold `total_usd` from the principal's balance,
in one step that either holds all of it or opens nothing. A keyless call holds nothing. A call MUST NOT open when:

- `total_usd` is above the call's `max_total_usd`: the error `over_max_total_usd`, fixable, with the total as the
  `example`;
- `total_usd` is above the key's cap for one call, or would take the key past its cap for the day: the error
  `over_key_cap`, not fixable, with the `quote` and an `approve_url` where the principal can approve this call;
- the balance is short: the error `insufficient_balance`, not fixable, with a `top_up_url` when the server has one.

**[MONEY-6]** As each seat ends, the server charges what that seat costs (its pay and its share of each fee) against the
hold. At a terminal state it returns the rest. For every call, at every moment, `spent_usd + returned_usd <= held_usd`,
and at a terminal state the two sides are equal. Results carry these three amounts in `money`.

A seat's share of a fee line is the line's amount times the seat's pay over the call's total pay, rounded half up to
the cent; at the terminal state the fees charged are trued up to exactly what the fee's rule gives for the pay actually
made (a minimum fee, for instance), and that true-up is shown in `money` as `fees_true_up_usd` (negative when the rule gives less than the shares charged). A call that paid nobody
is charged no fee. **[MONEY-7]** Fees on a seat
are charged only on what that seat was paid. A seat that is `declined`, `missed` or
`withdrawn` costs nothing.

### 12.3 What a person is paid

| The seat ends | The person is paid |
|---|---|
| `answered` | `pay_per_person_usd` |
| `stopped` | `max(min(stop_minimum_usd, pay_per_person_usd), pay_per_person_usd x min(1, seat_seconds / (60 x minutes)))` |
| `stopped`, with the reason `upset` | `pay_per_person_usd` |
| still `taken` when the call is cancelled or expires | `pay_per_person_usd` |
| `declined`, `missed`, `withdrawn` | nothing |

Amounts are rounded half up to the cent, except the default pay of section 9, which is rounded up to the cent so
that it always meets the floor. `stop_minimum_usd` is published in discovery under `limits` (0.00 when absent)
and is 0.00 on unpaid calls. `seat_seconds` runs from taking the seat to stopping, by the server's clock.

**[MONEY-8]** A server MUST pay by this table, except where its published terms say otherwise and discovery lists
them under `pay_terms` (an operator that pays on approval, say); it then reports what it actually paid in `paid_usd`. A
server that declares the fair-call profile pays at least the table, may add a top-up (FAIR-4) shown as `top_up_usd` on
the response and the receipt, and may not list `pay_terms` that pay less. **[MONEY-9]** On a call with `pay_per_person_usd` of `"0.00"`, every amount is
zero and the person MUST be told before taking the seat that the call is unpaid.

**[MONEY-10]** A server that pays people publishes `pay_floor_usd_per_hour` in discovery and MUST refuse a paid call
where `pay_per_person_usd` is below `pay_floor_usd_per_hour x minutes / 60`, with the error `below_pay_floor`,
fixable, and the lowest `pay_per_person_usd` that meets it as the `example`. Unpaid calls (`"0.00"`) are allowed only on the
simulated pool and on panels; elsewhere `"0.00"` is `below_pay_floor`. A paid call on the simulated pool is held to the
same floor when the server publishes one, so an agent meets the rule before it spends anything. Pay meets the floor when
`pay_per_person_usd` is at least `pay_floor_usd_per_hour x minutes / 60` rounded up to the cent.

## 13. Results: the response and its record

`GET /v1/calls/{call_id}/responses` returns the call's state, a summary, and the responses after a cursor.

| Query | Meaning |
|---|---|
| `after` | A cursor from an earlier answer; only responses after it are returned. Absent: from the first. |
| `wait_seconds` | 0 to `limits.max_wait_seconds` (at least 20); a larger value is treated as the maximum. The server MAY hold the request until a new response arrives or the state changes, and returns at once when either happens. |
| `detail` | `summary` (the default) or `full` (section 13.3). |

**[RES-1]** A server MUST answer within `wait_seconds` plus 5 seconds. **[RES-2]** Every answer whose `complete` is false
MUST carry `next_check_after_seconds`, a whole number from 1 to 300; a client SHOULD NOT ask again sooner. When
`complete` is true it is `null`.

```json
{
  "call_id": "call_2b9x0c4v6n8m1q3w5e7r",
  "status": "enough",
  "complete": false,
  "deadline": "2026-11-14T06:55:00Z",
  "summary": {
    "simulated": false, "people": 8, "enough": 5,
    "offered": 9, "taken": 1, "answered": 6, "stopped": 1, "declined": 1, "missed": 0, "withdrawn": 0,
    "evidence": { "attended": 5, "said": 1, "voiced": 0,
                  "said_because": { "played 41% of the audio": 1 } },
    "tally": {
      "would_play_again": { "true": 4, "false": 2 },
      "drift_at_seconds": { "n": 3, "min": 41, "median": 88, "max": 97 },
      "felt": { "n": 6 }
    }
  },
  "responses": [],
  "money": { "held_usd": "21.60", "spent_usd": "14.08", "returned_usd": "0.00", "test_money": false },
  "cursor": "7",
  "next_check_after_seconds": 30,
  "next_step": "Six answers are in, which is enough to act on; up to two more may come before 06:55 UTC."
}
```

- `responses` lists, oldest first, the responses after the cursor (empty in the example above; section 13.1 shows one).
- `summary.tally`, per field, over `answered` responses: for `boolean`, the count of each value; for `choice`, the count
  of each choice; for `number` and `scale`, `n`, `min`, `median` and `max`; for `text`, `n` only. **[RES-3]** A server
  MUST NOT summarise, rank or rewrite the words of `text` answers.
- **[RES-4]** `summary.simulated` MUST be true when any response on the call is simulated.
- `next_step`, on results and on the call, is one plain sentence saying what the agent can do next.
- `summary.offered` counts every seat ever offered on the call; the other seat counts are seats now in that state.
  `summary.evidence` counts every response delivered, answered or stopped. `deadline` and every seat count are always
  present.
- **[RES-9]** A response that changes after it was delivered (a transcript becomes ready, a top-up is paid) MUST be
  delivered again after the cursor, with the same `response_id`; a client replaces what it had.
- `summary.evidence.said_because` counts, for responses at `said`, the plain reason each fell short of `attended`; each
  response carries its own reason in `level_reason`, a short sentence an agent can repeat to its user.

### 13.1 A response

By default (`detail=summary`) a response is compact:

```json
{
  "response_id": "r_5t6y7u8i9o0p1a2s3d4f",
  "simulated": false,
  "person_ref": "pp_k2j3h4g5f6d7s8a9q0w1",
  "kind": "listen",
  "status": "answered",
  "partial": false,
  "evidence": "attended",
  "level_reason": "played all 30 seconds at normal speed, page in front throughout",
  "answers": { "felt": "It opened up at the key change, then I lost it.", "would_play_again": true, "drift_at_seconds": 97 },
  "answer_input": { "felt": "typed", "would_play_again": "tapped", "drift_at_seconds": "typed" },
  "minutes": 1.2,
  "paid_usd": "2.00",
  "receipt_id": "rc_1q2w3e4r5t6y7u8i9o0p",
  "received_at": "2026-11-14T06:21:13Z"
}
```

With `detail=full` it also carries the record the level was decided from:

```json
"record": {
  "rule": "listen/1",
  "observed": { "seat_seconds": 74, "device": "phone", "media_seconds": 30, "played_seconds": 30,
                "realtime_seconds": 31.2, "stalled_seconds": 0, "visible_fraction": 1.0, "pauses": 1, "replays": 1,
                "seeks_forward": 0, "completed": true },
  "unobserved": [ "audible", "unassisted_answer", "same_person" ]
}
```

- `answers` holds the person's answers under the call's field names, and nothing else, so no field name can collide
  with the response's own keys.
- `person_ref` is the same for the same person on every call from the same principal, and different for every other
  principal (section 16).
- **[RES-5]** `simulated` MUST be present on every response, true or false.
- A `stopped` response carries `stop_reason`: `stopped`, or `upset` when the person stopped because the call upset them.
- `kind` is the call's kind. `level_reason` is one plain sentence saying why the response has its level, which an agent
  can repeat to its user. `minutes` is `seat_seconds` / 60, to one decimal place.
- `voice`, when the person spoke: `{ "seconds": 41, "transcript_status": "ready", "transcript": "...", "recording_url":
  null }`. **[RES-6]** `recording_url` MUST be null unless the person said yes, for this call, to the agent having the
  recording. `transcript_status` is `ready`, `pending` or `none`; while it is not `ready`, only `seconds` reaches the
  agent.

### 13.2 What never reaches the agent

**[RES-7]** A response MUST NOT carry the person's name, contact, account, any identifier usable outside this server,
their recording without their yes for this call, or the raw trace of what their hands did.

### 13.3 `detail=full`

Adds, to each response: `record` (section 13.1); `offer` (exactly what the person was shown before taking the seat: who answers for the call,
that an AI is asking, the minutes, the pay and what it comes to an hour or that it is unpaid, the content rating, what
would be recorded and how long it is kept, the download size, whether the answers may train models, and on a panel its
size); `claims`
(the claims the person was selected on, section 16); and `receipt_jws`, the signed receipt (section 15). **[RES-8]** A
server MUST return `offer` under `detail=full`, with these keys (a key the server cannot state is `null`):

```json
"offer": {
  "answered_for": "Example Studio", "asker_is_ai": true, "ask": "Listen once, to the end...", "kind": "listen",
  "minutes": 5, "pay_per_person_usd": "2.00", "pay_per_hour_usd": "24.00", "unpaid": false,
  "content_rating": "general", "recorded": [ "how the sound played: pauses, skips, replays", "whether the page was in front", "your answers and how each was entered" ],
  "kept_days": 90, "download_bytes": 2310441, "may_train_on_answers": false, "panel_size": 9
}
```

## 14. Evidence levels

An answer is evidenced at one of three levels. **[EVID-1]** The server decides the level from what it recorded, by the
rule for the kind below, and MUST NOT take the runner's own claim about the level. **[EVID-2]** The level returned MUST
be the one these rules give when applied to the `record.observed` returned with it under `detail=full`, so that any
reader can recompute it.

| Level | Meaning |
|---|---|
| `said` | The person answered. Nothing more is shown. |
| `attended` | The record shows the thing was done as asked: played through, at normal speed, in front. |
| `voiced` | `attended`, and the person also gave a spoken answer of at least 3 seconds in the same seat. |

The rules, version 1 (`record.rule` names them, such as `listen/1`). Observed seconds are given to 0.1 s and fractions
to 0.01, and the rules are computed in decimal on those values, so every reader gets the same level; a fraction of
nothing (no play at all) is 0.

- **listen, watch:** `attended` when `played_seconds >= 0.9 x media_seconds`, `realtime_seconds >= 0.9 x
  played_seconds`, and `visible_fraction >= 0.9`.
- **view:** `attended` when `revealed` is true and `visible_seconds >= 5`.
- **play:** `attended` when `session_seconds >= 30` and `input_count >= 5`.
- **compare:** `attended` when every item meets its own kind's rule.
- **answer:** never `attended`. `voiced` when `voice_seconds >= 3`; otherwise `said`.
- **any kind:** `voiced` when the kind's `attended` rule holds (for `answer`, always) and `voice_seconds >= 3` in the
  same seat. Otherwise `attended` if its rule holds, otherwise `said`.

**[EVID-3]** A response at `said` is paid like any other. **[EVID-4]** No level shows that the answer was formed without
help. A server MUST NOT describe any level, in any text, as proof of an unassisted answer.

## 15. Receipts and the outcome line

### 15.1 Receipts

**[RCPT-1]** For every seat that ends `answered` or `stopped`, the server MUST issue a receipt: a JSON Web Signature in
compact form (RFC 7515), signed with Ed25519 (`"alg": "EdDSA"`, RFC 8037), with the signing key's `kid` in its header.
Its payload:

```json
{
  "receipt_id": "rc_1q2w3e4r5t6y7u8i9o0p",
  "iss": "https://api.example.com",
  "rev": 1,
  "issued_at": "2026-11-14T06:21:14Z",
  "call_ref": "sha256:9b1c0e5f4a7d2c3b8e6f1a0d9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b",
  "answered_for": "Example Studio",
  "kind": "listen",
  "seat_status": "answered",
  "evidence": "attended",
  "minutes": 1.2,
  "paid_usd": "2.00",
  "unpaid": false,
  "fees": [ { "kind": "router_fee", "amount_usd": "0.20" } ],
  "simulated": false,
  "test_money": false,
  "outcomes": []
}
```

- `iss` is the server's canonical origin, the same on every receipt it signs, whatever host a request used. `answered_for` is the name the principal gave the server (for a test or keyless
  call, "an unnamed test caller"). `minutes` is the seat's own time. `evidence` is the level of what the seat recorded,
  whether or not an answer was sent.
- `call_ref` is `"sha256:"` and the hex digest of the call id joined to a secret the server keeps, so the person can tell
  their calls apart and nobody can learn the call from it.
- `fees` is this seat's share of each fee line, so the person sees what the asker paid for their seat.
- **[RCPT-4]** When a signing key is revoked, the server MUST issue again, under a current key and with `rev` one
  higher, every receipt it signed with the revoked key before the revocation. A reader trusts a receipt whose signature
  checks against a key in `keys`; one that checks only against a revoked key proves nothing about when it was signed.
  `POST /v1/receipts/verify` also answers `on_record`: whether the server holds that receipt in its own records, which a
  forgery made with a stolen key is not.
- **[RCPT-2]** The person MUST be able to see and save every receipt of theirs. The server keeps a copy for them, since
  0.1 does not assume a person holds a key.
- **[RCPT-3]** `POST /v1/receipts/verify` with `{ "jws": "..." }` MUST, for anyone and without a key, answer
  `{ "valid": true|false, "receipt": {...}, "kid": "...", "revoked": true|false, "on_record": true|false }`.
- An agent may fetch the receipt of a response it received with `GET /v1/receipts/{receipt_id}`, which returns
  `{ "receipt": {...}, "jws": "..." }`, with the key the call was opened with, or with no key for a keyless call (whose
  receipt ids carry at least 120 random bits).
- A `jws` that is missing, too long, not a compact JWS, or does not parse, is answered `valid: false` with `receipt`
  and `kid` null, `revoked` false and `on_record` false, HTTP 200: the verify operation always answers a JSON body (a
  body that is not JSON is `invalid_json`). A JWS that parses but whose signature fails comes back with its decoded
  payload (when the payload is a receipt; otherwise `receipt` null) and `kid` and `valid: false`. `on_record` is decided by the exact JWS, so every revision the server issued is
  on record.

### 15.2 The outcome line

`POST /v1/calls/{call_id}/outcome` with `{ "text": "...", "idempotency_key": "..." }` lets the agent tell the people
what it did with their answers. `text` is one line of at most 280 characters.

**[OUT-1]** The server MUST screen the line as it screens a call (section 17). **[OUT-2]** Once allowed, the line MUST be
shown to each person whose seat on the call ended `answered` or `stopped`, beside their receipt, including people who
answer after it was sent, and each such receipt is issued again with the line added to `outcomes` and `rev` one higher.
Earlier revisions still verify. **[OUT-3]** The answer is `{ "status": "delivered" | "held", "people": <how many see it
now> }`; a refused line is the error `refused_screening`. The call object lists every line under `outcomes`, each with
its `status` (`delivered`, `held`, `refused`), so an agent can see what became of a held line. A line may be sent while
the call is open or after it ends; at most three delivered or held lines per call (a refused line does not count; a
fourth is `outcome_not_allowed`).