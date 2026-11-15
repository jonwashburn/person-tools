---
name: ask-people
description: Ask several people for a reaction a model cannot give (how a song feels, whether a page is clear, whether a game is fun, which version people prefer), through the person-tools MCP server, and report the answers truthfully.
---

# Asking people through person.tools

A preview. Simulated people for everyone, free. Your own people answer for real: they join your panel from a link on their phones, and your calls ring them. Strangers are not offered yet: ask for them in the call (wants_strangers), and your request and contact go to the operator. No money is charged: every amount is test money.

## When this fits
- Your user asked for other people's reactions to something, or said yes when you offered, and the answer needs a
  human: a song, a page, a game build, two versions of a headline.
- Not for your user's own taste (ask them), not for facts (search), not for anything done away from a screen.

## How
1. Price it first with `ask_people_quote` (nothing is spent; the file can wait, since a quote without `content` is priced from
   minutes). If your user has not named a budget, show them the quote's `for_your_user` sentence, which states the cost,
   and wait for their yes.
2. Open it with `ask_people`: `ask`, `kind`, `content` (a sample's media id from `GET /v1/media/samples`, an https URL, or `{"text": ...}`; not for kind answer), `people`,
   `max_total_usd` (the amount your user approved). Send an `idempotency_key`.
3. Fetch answers with `ask_people_results`, looking again after `next_check_after_seconds`.
4. Tell your user what came back: say plainly when answers are simulated (each one begins "[simulated] "), what was
   spent (test money during the preview), and what the evidence level of each answer was.
5. If the answers changed the work and your user agrees, send one line with `ask_people_send_outcome`.

The price, the terms and the promise to the people who answer: https://person.tools/price.json, https://person.tools/promise.json.
