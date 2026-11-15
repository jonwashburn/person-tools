# How people are paid

Pay rules for person.tools (working name), version 1, 14 Nov 2026. Built on PLAN.md section 7 (the
floor and the fees; PLAN wins over the research on every number), chief/DECISIONS.md D16 and D20 (the stop formula's
shape), `research/trust_quality.md` decision 9 and `research/payments.md` decision 4. Router codes from this file; each
numbered rule is one thing to build. Every worked case below is a check router can run.

Today every call is on test money or is unpaid (`owner/GRANTS.md`: no card processor, no payouts). The rules run the
same way on test money, so that the day real money opens nothing changes but the money.

## Words

- **P**: `pay_per_person_usd`, the pay for one person who answers. **E**: `minutes`, the estimated minutes per person.
- **Seat time**: seconds from the router's receipt of `take` to its receipt of the answer, a stop, or the call's close.
  Measured by the router's own clock. The runner's clock and the person's claim are kept and never used for pay.
- **Counted**: a response that reached the router. Every counted response is paid. "Counted" is about pay; an asker may
  leave a response out of its own tally, and that changes neither the pay nor the receipt.
- **Paid pool**: a pool where we pay people (our pool, step 4; private panels paid through us, step 4). Simulated,
  `team-test`, `self` and unpaid private panels pay nothing (P = 0.00), and every rule below gives 0.00 there.
- Money is integer cents. Every rounding is half up, to the cent, once per line, at the moment the line is computed.

## 1. The floor (every paid call, simulated ones included)

1.1. P is at least **$1.00** and at least **$20.00 an hour × E**. That is the default P when the call does not set one.
1.2. A call may set P lower than the default but never below **$18.00 an hour × E** or below $1.00. Below that: error
     `below_pay_floor` (MONEY-10), fixable, field `pay_per_person_usd`, example = the lowest P that meets it. A paid call on
     the simulated pool is held to the same floor, so an agent meets the rule before it spends anything. "0.00" is allowed
     only on the simulated pool and on panels. Discovery publishes `pay_floor_usd_per_hour: "18.00"` and, under `limits`,
     `stop_minimum_usd: "0.25"`.
1.3. After the call closes, the router takes the **median seat time M** of the counted responses. If P is less than
     $18.00 an hour × M, every counted response is topped up by the same amount: `topup = 18.00 × M / 60 − P`
     (rounded). The top-up comes from the reserve (rule 3).
1.4. **During the preview, calls to a panel pay nothing.** A call on a panel pool (`panel:<id>`) must set
     `pay_per_person_usd` to "0.00"; any other amount is refused before anyone is asked: error `unsupported_feature` (the standard's code), fixable,
     field `pay_per_person_usd`, example "0.00", message "Paid panels are not open yet; pay 0.00." Paid private
     panels open at step 4 (PLAN.md section 11), and a person must never see an amount that will not reach them
     (promises 1 and 6). The simulated pool may still carry pay above zero, in test money, so caps and holds can be
     exercised (DECISIONS.md D16).
1.5. On Prolific (step 2) our adapter sets the panel's reward at or above this floor and approves within 24 hours.
     The panel's own rules decide the rest there, and the quote says so.

## 2. What one person is paid

| What happened | Pay |
|---|---|
| Answered (a counted response) | **P**, plus any top-up from 1.3 |
| Stopped partway | `max(min(P, 0.25), P × min(1, seat_seconds / (60 × E)))`. Paid from the first second; a stop always pays at least 25 cents or P, whichever is less |
| Stopped with "Stop: this upset me" | **P** in full. The call is reported (`RING_RULES.md` rule 9) |
| Stopped partway, on an outside pool that can only pay its whole reward (Prolific) | **P** in full: the pool pays a stop only by approving the whole reward, which is more than the formula above and never less. The asker is charged P for that seat, and the quote says so before the call opens ("on this pool a person who stops is paid in full"). Ruled 5:45 AM CT for SERVICE's Prolific stop code |
| In the seat when the call reaches its deadline | **P** in full. The person may finish if they wish (`review/person_called.md` finding 14) |
| In the seat when the asker cancels | **P** in full. The person may finish if they wish; cancelling stops new rings only |
| Offered and not taken (declined, missed, expired) | Nothing. No time was spent |
| Took a seat on a call that turned out full | Cannot happen: an offer holds one seat for one person (`RING_RULES.md` rule 2). If it ever does, the person is paid P |
| A fraud finding upheld after appeal (`policy/FRAUD.md`) | Nothing for that seat, and only then. While a finding is open the pay waits; it is never returned to the asker before the appeal is decided |

When a person stops, nothing they typed or said is sent to the asker unless they tap "Send what I have"; either way the
pay is the same.

Questions inside a call are paid like the rest of the call. Nobody is asked an unpaid screener: who qualifies is decided
before anyone is rung (`policy/POLICY.md`, rule `unpaid_screener`).

## 3. The quote and the hold

3.1. A quote is a list of lines, each in cents and each named:

| Line | Amount |
|---|---|
| `people` | `people × P` |
| `reserve` | **25% of `people`**, for top-ups (1.3) and for partial pay. Returned if unused |
| `pool_fee` | our pool: 20% of `people`; Prolific: its own fee on its own reward, shown as its own line; none elsewhere |
| `router_fee` | 10% of `people`, at least $0.25 a call. None on unpaid calls and none on a principal's own unpaid panel. A fee on any top-up (1.3) comes out of the reserve |
| `rail_fee` | 0.00 on a call. The card's cost (about 3% to 3.5%) is charged once, at top-up, and shown there |
| `tax` | 0.00 until the accountant answers (PLAN.md section 8) |
| **total** | the sum. A call opens only if total ≤ `max_total_usd` and within the key's caps |

3.2. Opening a call moves **total** from the principal's balance to the call's hold, in one ledger transaction. If the
     balance is short: error `insufficient_balance`, not fixable by the agent, with the amount and the top-up link.
3.3. As each seat settles (rule 2), its pay moves from the hold to that person's earnings, and the router fee on it
     (10% of what was paid) moves from the hold to fees.
3.4. When the call closes (complete, expired or cancelled) and every seat has settled, the rest of the hold, unused
     reserve and fees included, goes back to the balance in one transaction. At close the router fee is settled to
     max($0.25, 10% of everything paid on the call), or to nothing if nothing was paid. The result shows `held_usd`,
     `spent_usd`, `returned_usd`.
3.5. If a top-up (1.3) needs more than the reserve, the person is still paid in full. The difference comes first from
     the router fee on that call, then from the operator's own account, and the result says the estimate E was short.
     The asker is never charged above `max_total_usd`.
3.6. Every money event is one transaction whose lines sum to zero, with a key that makes a second attempt fail
     (`txn` + `line` unique). After any set of calls, cancellations and expiries, the ledger sums to zero.

## 4. When pay is counted and when it moves

4.1. A response is counted **by itself 24 hours after the router received it**, unless a fraud finding was opened on
     it inside those 24 hours (`policy/FRAUD.md`). No asker action is needed and no asker can stop it.
4.2. Pay posts to the person's earnings at counting. A stop's pay posts 24 hours after the stop, on the same rule.
4.3. From step 4, earnings leave by the licensed payout service within one business day of counting, once the person
     has passed the identity check. Earnings from a private panel paid through us wait **7 days** before they can leave
     (PLAN.md section 7: a card-funded balance paid to people the payer chose is how stolen cards are cashed out).
4.4. A person sees, for every call: what the asker paid in all, each fee, and what they were paid (promise 6).

## 5. Worked cases (router: each is a check)

All on a paid pool, E = 2 minutes, P = $1.00 (the floor: max($1.00, $20/h × 2 min = $0.67)), 3 people.

| Case | Seat time | Pay | Why |
|---|---|---|---|
| Answers at 1:30 | 90 s | $1.00 | rule 2, answered |
| Stops at 40 s | 40 s | $0.33 | $1.00 × 40/120 = 0.3333, rounded half up |
| Stops at 5 s | 5 s | $0.25 | 1.00 × 5/120 = 0.04, below the 25-cent minimum |
| "Stop: this upset me" at 10 s | 10 s | $1.00 | rule 2 |
| Answers at 3:00, 3:20 and 3:40 (median 200 s) | 200 s | $1.00 + $0.00 | $18/h × 200 s = $1.00 exactly; no top-up |
| Answers at 4:00, 4:20 and 4:40 (median 260 s) | 260 s | $1.00 + $0.30 each | 18 × 260/3600 = 1.30 |
| Call reaches its deadline with one person in the seat at 50 s | 50 s | $1.00 | rule 2, deadline: full pay |
| Asker cancels while one person is in the seat at 30 s; they leave without answering | 30 s | $1.00 | rule 2, cancel: full pay |

The quote for that call: people $3.00; reserve $0.75; router fee 10% × $3.00 = $0.30 (above the $0.25 minimum); total
$4.05. If all three answer inside 200 s: spent $3.00 + fee $0.30 = $3.30; returned $0.75.

And with the D20 shape kept exactly: `minimum_usd` = min(P, 0.25) on paid calls, 0.00 on unpaid ones.
