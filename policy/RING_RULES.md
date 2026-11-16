# When and how a person is rung

Ring rules for person.tools (working name), version 1, 14 Nov 2026. Built on PLAN.md section 5 (the
promise, the On switch, reaching a person), TEAM.md items P2 and P3 and section 7, and chief/DECISIONS.md D8. Router
codes from this file; runner shows what it says. Each numbered rule is one thing to build and one line in the baseline.

## Words

- **Ring**: an offer of one seat on one call, sent to one person (web push to the person's page; the page `/m/<token>`
  lists the same offers, and is the fallback when a push is missed).
- **Eligible**: a person who matches the call's selectors, is a member of the pool the call names, has not been offered
  a seat on this call before, and is not the call's own asker.
- Times are the router's own clock. A person's local time comes from the time zone they set at joining.

## The rules

1. **Who may be rung at all.** Nobody real is rung unless (a) the key is a `real_` key named in `owner/KEYS_REAL.md`,
   (b) screening returned ALLOW for that exact call, and (c) the call is open. `test_` keys and keyless calls ring the
   simulated pool and `team-test` only. During the preview, no real person is rung more than once in 30 minutes.
   This counts per person, not across the service (ruled 4:28 PM CT, 14 Nov 2026, for SERVICE's question): each real person
   gets at most one ring in any 30 minutes, whichever call it is for, so a call's three people may be rung at once. A ring
   that reached no phone (no push accepted, no open page) does not count and does not start the 30 minutes (10:41 PM CT, from
   the operator's first call, whose first ring reached no phone). Why:
   the rule protects a person from being rung again and again (TEAM.md: "at most one ring to any real person in thirty
   minutes"); a service-wide limit would protect nobody further and would make each three-person call take over an
   hour. What already bounds a burst: only an owner-made `real_` key, an explicit ALLOW, the operator's release of a
   held call, panels of at most five named adults (grant h), and never more open offers than open seats (rule 11).
2. **An offer holds a seat for one person, for 60 seconds** (3 minutes for a person who privately set "I use a screen
   reader" or "I need longer to answer"; the asker never sees that setting). The router never has more open offers than
   open seats, so nobody can open a call that is already full. If the person takes it inside the hold, the seat is
   theirs. If not, the offer lapses and the seat is offered to the next person.
   **On a private panel** (people the asker invited, unpaid tests) an offer holds for **15 minutes**: nobody else is
   waiting for that seat, and a person who is On may be across the room. The CEO's decision, 10:46 PM CT, 14 Nov 2026,
   after the operator's first call: its one-minute hold ran out on the open page before the button was found. Pools and the
   simulated pool keep 60 seconds (3 minutes with the longer-time setting).
3. **On, Off, On until.** A person is rung only while On. "On until" lasts two hours unless the person chooses another
   length, at most twelve, and ends by itself. A person joins Off and turns On themselves; the page says so.
4. **Quiet hours.** No ring between 9 PM and 8 AM in the person's own time zone, whatever the deadline, unless the person
   changed those hours themselves. A call opened when every eligible person is inside quiet hours rings nobody, and its
   quote says the earliest time it can ring (`earliest_ring_at`) and the expected time to enough answers from then.
5. **At most four rings an hour** to one person (any rolling 60 minutes), and at most one open offer at a time.
6. **Two misses switch a person Off.** A miss is an offer that reached the person and lapsed with no answer at all:
   their browser's push service accepted the ring for their subscription, or their own page was open and showed the
   offer. A ring that could not reach them (no subscription, the push service refused it, and no page open) is not a
   miss and counts for nothing; their page says plainly that a call came while it could not reach them, and how to let
   calls reach them. A decline is not a miss. After two misses in a row the person is switched Off and told, in one
   line: "You missed two calls, so we turned you Off. Turn On when you are ready." Taking or declining any offer sets
   the count back to zero. (Chief's ruling, 14 Nov 2026, 2:38 PM CT: a person who never allowed notifications must not
   be switched Off by calls they never saw.)
7. **What a ring says.** The notification says only "A call for you: N minutes, $X" or "An unpaid test call: N minutes",
   and on the iPhone app the kind ("Listen · about 2 min · unpaid test"). Never the ask, never the material: a lock
   screen is seen by others. **The asker's name appears only on a private panel** (as the title: who answers for the call,
   as the page's offer shows it), because the person joined that asker's panel and knows them; on a pool, never. Ruled
   11:13 PM CT for the iPhone app's alert. Everything else is on the ring card, inside the page, before the seat is taken.
8. **The ring card, before the seat is taken** (promise 1): who is responsible for the call; that an AI is asking; the minutes;
   the pay or UNPAID TEST; the content rating; what will be recorded (play, pause, the page in front or not, how each
   answer was entered, and voice only if the person turns it on for that call); whether the asker may use the written
   answer to train AI (a voice is never used to train anything); the download size; and that the person may stop at any
   time and still be paid for the time spent. On a private panel: the panel's size, and that the person who invited them
   knows who is on it and may be able to tell whose answer is whose. On a panel of fewer than five, both sides are told
   that answers cannot be anonymous.
9. **Report and stop.** Every screen a person sees has a way to report: "Report this call" on the ring card, "Stop or
   report" on every call screen. A report stops the call at once: open offers
   are withdrawn, nobody new is rung, people already in a seat may finish and are paid, and the call is held for a human
   (`policy/POLICY.md`). "Stop: this upset me" pays in full and is a report.
10. **The order people are rung in.** Among the eligible people who are On, outside quiet hours and under the cap, the
    router offers seats to those **rung least recently first**, and breaks ties at random. It never orders people by how
    often or how fast they accepted before, by their answers, by any rating, or by an asker's preference. A person
    never earns or loses calls for what they said.
11. **How many are rung at once.** As many offers as there are open seats, no more. When an offer lapses or is declined,
    the next person is offered that seat. A person is offered a call at most once: after they decline it or let its
    offer lapse, that call never rings them again (it goes to someone else, or waits), except an offer they tried to open and could not (rule 15). No ring is sent after the call's deadline, and open offers end at the
    deadline.
12. **No ring for a held, refused, complete, expired or cancelled call.** Cancelling withdraws every open offer at once
    (people already in a seat may finish: `PAY_RULES.md`).
13. **At the end of the build.** Unless `ops/OPERATOR_CHARGE.md` names an operator, every real person is switched Off at
    the deadline and told so in one line, and calls to real people are refused with "paused until the owner reopens".
    The simulated mode keeps working.
14. **Leaving.** Turning Off, leaving a panel and deleting the account each stop all rings at once and withdraw any open
    offer.

15. **An offer the person could not open is offered again** (the CEO, about 6:30 PM CT, 15 Nov 2026: "a lapse caused by our own fault
    is not his 'no'"). When the person's own app or page reports that it tried to open an offer and couldn't (POST
    /v1/member/offers/{seat_id}/open_failed, with the reason), that offer's lapse is not a miss under rule 6 and not a no under rule
    11: the same call is offered again, with a fresh hold, once the person is On. A client may report this at most once per call and
    only for an offer made to that member; a second report is refused, so it can never be used to dodge the two-misses rule.

16. **A person's own page, where only their own AIs ask.** On a page a person makes for themselves (`POST /v1/account/start`),
    nobody else can join and only the AIs they connect can ask them. There On starts on, with no end unless the person sets one,
    because every ask comes from something they connected; they can turn Off at any time. Quiet hours (rule 4), rule 5 and
    `policy/TASKS.md` rule 6 still hold. The notice they accept says so (`legal/tester_notice_self.json`). Everywhere else, rule
    3's On, with its end, holds.

## Worked checks (router: each is a line in the baseline)

| Situation | What must happen |
|---|---|
| A call opened at 3:00 AM in the person's time zone | Nobody is rung; the quote's `earliest_ring_at` is 8:00 AM that morning, their time |
| Two seats, five eligible people | Exactly two offers are open at once; a third person is offered only after one lapses or is declined |
| An offer is not answered for 60 s | It lapses; the seat goes to the next person; the first person's miss count is 1 |
| An offer on a private panel, not answered for 60 s | It is still open; it lapses only after 15 minutes, and only then counts as a miss |
| A second lapsed offer in a row | The person is Off and is told |
| A person declines | Not a miss; the count goes back to zero |
| A ring the push service refused, with the person's page closed | Not a miss; the count does not move; their page later says a call came while it could not reach them |
| A person declines, and nobody else on the panel can be rung | The seat waits; the person who declined is not offered it again, and their old link answers that the call is not theirs |
| A fifth ring inside one hour | Not sent; the next person is offered instead |
| "On until" set for 2 hours | No ring after 2 hours; the page shows Off |
| A test_ key names a real person's panel | Error `forbidden_for_key_class` (fixable: false; a real_ key is needed); nobody is rung |
| A report during a call | No new offers; the call is held; people in a seat may finish and are paid |
| Ring order | Never reads accept history; with equal last-ring times the order is random |
| Preview: one call with three seats, three real people On on its panel, none rung in the last 30 minutes | All three are offered a seat at once |
| Preview: a real person was rung 10 minutes ago for another call | They are not offered this call until 30 minutes have passed since that ring; the seat goes to another eligible person, or waits |
