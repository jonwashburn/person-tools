# Turning on the Prolific pool: the exact steps

Today the pool `prolific` runs in **recorded** mode only: the router's adapter (`src/pools/prolific.js`) makes every
request it would make to Prolific, and a file of recorded answers (`src/pools/prolific_recorded.json`) answers them, with
scripted stand-ins in place of people. Nothing is sent to Prolific and nobody there is asked anything. Only the team's own
keys can use it, and every answer it returns says `simulated: true`.

These are the steps that make it real, in order. Steps 1 to 3 are the operator's; the rest are the router's and take an hour.

## The operator's steps

1. **Open a Prolific researcher account for the business** (a company account; the fee is 42.857% of what people are paid,
   plus VAT on the fee where it applies). Add funds in Prolific's web app; its interface cannot add funds. Start with
   the float for about a week of calls, no more.
2. **Make an API token** in the account (Settings, API tokens) for one workspace kept for our own calls. Save it on the lane
   server as `~/.config/humancall/prolific.env` with one line, `PROLIFIC_TOKEN=...`. Never paste it anywhere else.
3. **Grant it** with one line in `owner/GRANTS.md`: "Prolific, our own account, our own calls only". Calls for outside
   principals on our account wait for Prolific's written answer (PLAN.md section 4, the first message on the standard's
   path); a principal's own account and key wait for the same answer.

## The router's steps (once 1 to 3 exist)

4. **Read the live interface once, before any study is published.** With the token, `GET /api/v1/users/me/` and
   `GET /api/v1/studies/` (both read-only). Compare the response fields with the recorded file: the recorded file's
   response field names (`id`, `status`, `participant_id`, `entered_code`) were written from memory of Prolific's public
   reference and are marked UNVERIFIED. Fix the adapter and the file where they differ.
5. **Read Prolific's Researcher Terms and API terms in a browser** (PLAN.md section 16, fact 1) and write what they say
   about a router posting for others into `router/PROLIFIC_NOTES.md`. If they forbid what step 3 grants, stop here and
   write one line in `chief/FOR_OWNER.md`.
6. **Push the token as a project secret**: `bin/cf pages secret put PROLIFIC_TOKEN --project-name=askpeople-api` from the
   file, and set `PROLIFIC_MODE=live` the same way.
7. **One study of our own, one place, the smallest pay that meets both floors**, through `ask_people` with a live key
   and `pool: "prolific"`, on a sample of ours. Watch it in the Prolific dashboard and in the call's results: the person
   arrives on our runner through `/p/<arrival_token>`, answers, is sent back with our completion code, and is approved
   automatically. Check the ledger: pay and Prolific's fee posted to `pool:prolific`.
8. **List the pool in discovery** (`pools`) only after step 7 completed a call (the standard's PEOPLE-3: a server never
   lists a pool it cannot complete a call through), and add its line to the baseline.

## The second mode: a principal's own Prolific account (built, recorded only)

A principal can connect its own Prolific account: `PUT /v1/pools/prolific/account {"token": "..."}` with its key (a live
key; the team's keys may connect a recorded stand-in token that starts with `recorded_`). The token is sealed at rest
(AES-GCM, project secret `POOL_TOKEN_KEY`, the row's principal and pool bound in), never logged and never returned: the
reply shows only its last four characters. `GET` reads the state; `DELETE` deletes the token at once.

While it is connected, that principal's calls on `pool: "prolific"` make and pay studies on its own account: the quote
holds only the router fee here (`total_usd` 0.30 on 3 x 1.00) and shows `paid_elsewhere` (pay 3.00 and Prolific's fee 1.29,
charged to its own account there); each seat moves only its router fee from the hold; receipts say `paid_by: "the pool,
from the asker's own account there"`. The baseline line "prolific (own account, recorded)" runs the whole road with a
recorded token.

Its own steps, after steps 1 to 8 above:

9. **Prolific's written yes** that a router may hold a principal's key and post studies on its account (PLAN.md section 4).
   Until then a real token can be connected but every call on it is refused with `unsupported_feature`, saying so.
10. **The bonus endpoint** (see below): FAIR-4's top-up for a call that ran long is a bonus through Prolific from the
   principal's account; on our own account it comes from the hold. Until it is built, the router skips the top-up on a
   principal's account, so mode 9 stays off.
11. **Switch it on** with one project secret: `PROLIFIC_PRINCIPAL_ACCOUNTS=on`.

## What the adapter already enforces, in code

- Typed answers only: a call with `voice` is refused (a recording needs Prolific's written approval).
- No selectors yet (`require` is refused), and nothing in a call may ask for a name or contact (screening refuses it).
- Pay at least the higher floor (ours, $18.00 an hour, over Prolific's $8.00).
- Every completed job is approved automatically by the completion code's own action. The adapter has no operation that
  rejects anyone.
- The person's Prolific id stays in our database (`seats.pool_pid`); the asker sees only our `person_ref`.
- The study is stopped when the call ends.

## Not built yet (and why)

- Reconciling Prolific's own submission list in live mode (returned studies, timed-out places) waits for step 4's read
  of the real fields. It is also a precondition for live mode, not a nicety: the study's address (with its arrival token)
  is visible to every participant who opens it, so one could post invented pids and take seats that would be paid in
  full at timeout. Before `PROLIFIC_MODE=live`, a seat whose pid does not appear in Prolific's own submissions for the
  study within ten minutes must be released unpaid, and pay must follow Prolific's own record of who completed. The arrival itself is built: `POST /v1/arrivals/{token}` takes `{pid, study, session}` (Prolific's
  documented URL placeholders) and makes a taken seat for that person (a pid that already has a seat gets 409, never its
  link); after an answer it answers `return_to`, the completion address with our code. The code is random per study, kept
  in `pool_ref` and shown only after an answered seat (trust's R15: a code derived from the call id could be read from the
  study's address). The runner's `/p/<token>` page posts it. The baseline line "prolific arrivals (recorded)" walks it.
- Paying a participant who stops partway: our promise pays for time on a stop, but only the completion code pays through
  Prolific, and it is given only after an answer. Before live mode, settle the stop's pay with Prolific's own means (a
  second, manually reviewed code, or a bonus) and make the router's ledger follow what Prolific actually pays.
- Bonuses (pay for time beyond the estimate) need the bonus endpoints' exact fields, which the research did not record.
