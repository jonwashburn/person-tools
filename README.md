# person.tools

Human feedback for AI agents: one tool call sends a short task to people and returns each answer. **Try it now, no key
and no account** (simulated people answer in seconds, free, and every simulated answer is marked as such):

```
claude mcp add --transport http person-tools https://api.person.tools/mcp
```

Then ask Claude to get three people's reaction to something. Or price a call with one line of curl:

```
curl -s https://api.person.tools/v1/quotes -H 'content-type: application/json' -d '{"ask": "Which headline is clearer, and why?", "kind": "compare", "people": 3, "content": [{"text": "Plan a week of dinners in five minutes"}, {"text": "Dinner, decided"}]}'
```

**The first real call.** On 15 November 2026 at 10:26 AM CT, one of our own programs asked a real person on the operator's own panel to listen once to a 30-second piece of music, then say what they felt and the one thing they would change. The answer came at 10:28 AM CT, under two minutes later: "Calm", and "It's boring and dull". The record shows 74% of the audio played. The answer changed the work: the front-page sample was replaced the same morning. The new one has a beat, a bass line, chords and a hook.

An agent can't hear a song it made or play a game it built. person.tools lets it ask people instead: one tool call sends a
short task to several people (listen to this, look at that page for ten seconds, play this build for two minutes, pick
the clearer of two versions), and the answers come back one person at a time, each with a record of what that person's
page observed: how much of the audio or video played in real time, whether the page stayed in front, pauses and replays,
and whether each answer was typed or pasted. The record does not show that a person listened or watched.

A preview. Simulated people for everyone, free. Your own people answer for real: they join your panel from a link on their phones, and your calls ring them. Strangers are not offered yet: ask for them in the call (wants_strangers), and your request and contact go to the operator. No money is charged: every amount is test money. Real people are rung only on a panel they joined themselves from a link on their own phone; any key can make
one (POST /v1/panels), and the reply carries a message to send them. Your own pages and builds reach your people after a model reads them; your own audio and video after a person at person.tools has checked it.

This repository holds the service, the standard it implements, and the suite that checks any server against that
standard.

## A first call

Over plain HTTP, with no key (simulated people answer, free):

```
curl -s https://api.person.tools/v1/quotes -H "content-type: application/json" \
  -d '{"ask": "Which headline is clearer, and why?", "kind": "compare", "people": 3,
       "content": [{"text": "Plan a week of dinners in five minutes"}, {"text": "Dinner, decided"}]}'
```

The answer lists each line of the price, the total (0.00 on the simulated pool), and `for_your_user`, a sentence an
agent can show its user before anything is spent. `POST /v1/calls` with the same body plus `max_total_usd` opens the call;
`GET /v1/calls/CALL_ID/responses` returns the answers. A free test key (`POST https://api.person.tools/v1/keys` with
`{"class":"test"}`; the key is in the answer's `key` field and starts `test_`) adds a balance of test money and caps.

Over MCP (Streamable HTTP), the server is `https://api.person.tools/mcp` and its tools are `ask_people_quote` (price a call, free),
`ask_people` (open it), `ask_people_results`, `ask_people_cancel`, `ask_people_send_outcome` and `ask_people_panel`. In Claude Code:
`claude mcp add --transport http person-tools https://api.person.tools/mcp` (add `--header "Authorization: Bearer test_..."`
with a key). Each field is explained at https://person.tools/start; agents that read text indexes start at
https://person.tools/llms.txt.

This repository is also a Claude Code plugin list: in Claude Code, `/plugin marketplace add jonwashburn/person-tools`, then
`/plugin install ask-people@person-tools` (from a shell: `claude plugin marketplace add jonwashburn/person-tools`).

## Testing a server

`code/conformance/run https://api.example.com` checks a server from outside, through the simulated pool. The address is
the server's API base, where `/.well-known/x-hc-draft` answers. The suite makes its own test keys through the server's
`POST /v1/keys`, or takes one with `--key-file`. It needs Python 3.10 or later with
`pip install httpx jsonschema cryptography mcp`, and exits 0 only when nothing fails. On 14 November 2026 the service at
`https://api.person.tools` passed every check the suite ran against it (0.1.0-draft.1; voice is not offered, so its check was skipped; the fair-call
profile is a separate run with `--profile fair-call`).

## What is here

| Folder | What it is |
|---|---|
| `spec/` | the Ahoy Protocol: the definition of the call, as text (`spec/src/`), JSON Schemas, examples, an OpenAPI file and screening fixtures. Published at https://spec.person.tools/. |
| `code/conformance/` | The suite. |
| `code/router/` | The call server: quotes, calls, money held and returned, screening of what a call may ask, evidence levels, signed receipts for each person, the MCP binding. |
| `code/runner/` | The page a person opens when rung: what they see before they take the call, how the material plays, what is recorded. |
| `code/site/` | The site and its machine-readable files, generated from `canon/`. |
| `canon/` | The one record every page, file and tool description is generated from, including the twelve promises to the people who are called (`canon/promise.json`, also at https://person.tools/promise.json). |
| `policy/` | What a call may ask, what is kept and for how long, how people are paid, when people may be rung. |
| `.claude-plugin/`, `plugins/` | The Claude Code plugin list. |

## The standard's status

Version 0.1 of the Ahoy Protocol is a public draft. Until 0.1 is final, identifiers on the wire (the discovery path, headers)
carry the placeholder prefix `x-hc-draft`, so a server built to the draft says so. "Core" means the standard without
its optional profiles. A server may say it "passes suite 0.1.0-draft.1 against the standard 0.1 core" only when the suite
finds no failure.

## Names and licence

person.tools, the Ahoy Protocol and `ask_people` are working names. The standard's text, schemas and examples are under the Apache
License 2.0 (`LICENSE`); the standard is a draft. Third-party fonts, libraries and samples, and their licences,
are listed in `LICENSES.md`. The code is under the Apache License 2.0 too.

## Reporting a security hole

https://person.tools/security has a form; `/.well-known/security.txt` on the site says the same.
