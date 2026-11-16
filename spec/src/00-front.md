# {{standard}}, version 0.1

**Status: DRAFT, not final.** {{standard}} is a working name. The identifiers that name this standard on the wire
(the version header `{{wire_prefix}}-version`, the discovery address `/.well-known/{{wire_prefix}}`, discovery's
`protocol` value and the profile name) carry the placeholder prefix `{{wire_prefix}}` (its letters mean nothing), which changes when 0.1 is
published as final. Paths, field names and tool names carry no prefix and do not change with it.

{{standard}} is an open interface through which a software agent asks people to do a short thing (listen, watch, look,
play, compare or answer), and gets back each person's answer with what their device recorded while they did it, at a
price quoted before anything is spent and never above a cap the agent sets, while each person is paid and keeps a
signed receipt.

How a call goes:

1. An agent sends a **call** to a **call server**: what people should do, how they answer, how many are wanted, what
   each is paid, and the most it may spend. It can ask the price first.
2. The server screens the call, refusing what may not be asked of people (section 17), then offers a **seat** to
   people who match what the call selects (section 16) until enough have answered.
3. A person who takes a seat does the thing in a page the server runs, which records what happened: how much played,
   whether the page stayed in front, how each answer was entered. It also says what it cannot see: whether the sound
   reached the person's ears, or whether they had help.
4. The agent fetches the answers as they arrive, each with that record and an **evidence level** (`said`, `attended`
   or `voiced`, each a step above the last) decided by rules in this text. The agent knows each person only by a
   reference that is different for every account. Each person is paid and keeps a signed **receipt**. Later the agent
   can tell them, in a line the server screens too, what their answers changed.

A company that runs a pool of people is a call server; so is a router that passes calls on to other pools. Every call
server also has a **simulated pool** of scripted people, so that any agent can try the whole exchange free and a test
suite can drive every state of a call without a human. A server whose only people are simulated still conforms, so
the core can be built and checked in a day. A server with real people keeps the core's rules for them too: adults only
(PEOPLE-1), every call and outcome line screened before anyone is offered a seat (SCREEN-1), pay by the table of section
12.3 (stopped seats included) or by terms it publishes, a published pay floor, people told before taking a seat when a
call is unpaid, and a signed receipt for every answer and every stop. Section 23 adds stronger promises a server may declare, such as pay from the first second, stopping that
is always free, and quiet hours.

## One call, from end to end

An agent wants three people to hear a thirty-second melody and say what they felt. It uses a test key, so the people are
simulated, their time is virtual (they answer within seconds; what they did comes from a script, section 18) and no
money moves.

**1. Ask the price.** Nothing is spent.

```http
POST /v1/quotes
Authorization: Bearer test_8Kq2...
Content-Type: application/json

{
  "ask": "Listen once. Then tell me what you felt, in your own words.",
  "kind": "listen",
  "content": "m_sample_melody30",
  "people": 3,
  "answer_fields": { "felt": "text", "would_play_again": "boolean" }
}
```

```json
{
  "quote_id": "q_7f3kd0a1m2n4p5q6r7s8",
  "lines": [ { "kind": "to_people", "amount_usd": "0.00" }, { "kind": "router_fee", "amount_usd": "0.00" } ],
  "total_usd": "0.00",
  "expected_minutes_to_enough": 1,
  "expires_at": "2026-11-14T06:40:00Z",
  "defaults_used": { "pool": "simulated", "enough": 3, "minutes": 2, "pay_per_person_usd": "0.00",
                     "deadline_minutes": 120, "pace": "instant", "content_rating": "general",
                     "may_train_on_answers": false },
  "simulated": true,
  "test_money": true
}
```

**2. Open the call.** The same body, plus the most the call may cost and a key that makes a retry safe. (The answer
is abridged here; section 19 lists the whole call object.)

```http
POST /v1/calls
Authorization: Bearer test_8Kq2...
Content-Type: application/json

{ ...the same body..., "max_total_usd": "0.00", "idempotency_key": "melody-check-1" }
```

```json
{
  "call_id": "call_2b9x0c4v6n8m1q3w5e7r",
  "status": "open",
  "deadline": "2026-11-14T08:25:00Z",
  "quote": { "...": "the quote of step 1, in full (section 12.1)" },
  "simulated": true,
  "test_money": true,
  "next_check_after_seconds": 5
}
```

**3. Collect the answers.** The server may hold the request up to `wait_seconds` for something new. (Abridged: one
of the three responses is shown.)

```http
GET /v1/calls/call_2b9x0c4v6n8m1q3w5e7r/responses?wait_seconds=25
Authorization: Bearer test_8Kq2...
```

```json
{
  "call_id": "call_2b9x0c4v6n8m1q3w5e7r",
  "status": "complete",
  "complete": true,
  "summary": {
    "simulated": true, "people": 3, "enough": 3, "answered": 3, "stopped": 0,
    "evidence": { "attended": 3, "said": 0, "voiced": 0 },
    "tally": { "felt": { "n": 3 }, "would_play_again": { "true": 2, "false": 1 } }
  },
  "responses": [
    {
      "response_id": "r_5t6y7u8i9o0p1a2s3d4f",
      "simulated": true,
      "person_ref": "pp_k2j3h4g5f6d7s8a9q0w1",
      "kind": "listen",
      "status": "answered",
      "partial": false,
      "evidence": "attended",
      "answers": { "felt": "[simulated] Calm at first; the last bars felt unresolved.", "would_play_again": true },
      "answer_input": { "felt": "typed", "would_play_again": "tapped" },
      "level_reason": "played all 30 seconds at normal speed, page in front throughout",
      "minutes": 1.5,
      "paid_usd": "0.00",
      "receipt_id": "rc_1q2w3e4r5t6y7u8i9o0p",
      "received_at": "2026-11-14T06:25:06Z"
    }
  ],
  "money": { "held_usd": "0.00", "spent_usd": "0.00", "returned_usd": "0.00", "test_money": true },
  "cursor": "3",
  "next_check_after_seconds": null,
  "next_step": "All three answered. Ask for detail=full to see each person's record."
}
```

**4. Tell the people what changed** (optional; the line is screened before anyone sees it, section 15).

```http
POST /v1/calls/call_2b9x0c4v6n8m1q3w5e7r/outcome
Authorization: Bearer test_8Kq2...
Content-Type: application/json

{ "text": "Two of three wanted more resolution, so the last four bars now return to the tonic.",
  "idempotency_key": "melody-check-1-outcome" }
```

Each person who answered or stopped sees that line beside their receipt. Each receipt is a signed record the person keeps
(section 15); anyone can check its signature against the keys the server publishes (section 5).

Every operation here is also a tool for any client of the Model Context Protocol, with identical JSON (section 20):
`{{tool}}_quote`, `{{tool}}`, `{{tool}}_results`, `{{tool}}_send_outcome`, and `{{tool}}_cancel` and `{{tool}}_panel`, which
this example does not need.

## How to read this document

Section 1 is the scope. Sections 2 to 8 are what every request shares. Sections 9 to 14 are the call, its kinds, its states, its price, what
comes back and how well it is evidenced. Sections 15 to 18 are receipts, people, screening and the simulated pool.
Sections 19 and 20 are the two bindings. Sections 21 and 22 are security and privacy. Section 23 is the profile of
stronger rules that protect people, which a server may declare; sections 24 and 25 are the registries and what
conformance means. Section 26 is the person's side: the interface between a server and the app a person answers in, for
calls and for asks from their own AIs and their own people. Appendix D gives an order for building the smallest conforming server in a day. Appendix A lists what is
left for later, with the reason for each; Appendix B how it composes with other protocols; Appendix C the reasons for
the main choices.

The machine-readable parts are normative for shape: one JSON Schema per object (`schemas/`), valid and invalid examples
for each (`examples/`), and one OpenAPI 3.1 document (`openapi.yaml`). Where the prose and a schema disagree, the prose
wins and the schema is a bug.
