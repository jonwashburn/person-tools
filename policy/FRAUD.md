# When pay may be withheld

Fraud rule for person.tools (working name), version 1, 14 Nov 2026. Built on the promise (PLAN.md
section 5, line 4: "No asker can reject your work. Pay is withheld only for proven fraud, shown to you, with an
appeal."), `research/trust_quality.md` (detectors are wrong about honest people too often: verified humans fail AI
detection about 2% of the time, and 14% of real people fail four classic attention checks), and
`review/person_called.md` findings 10 and 11.

## The rule in one paragraph

A person's pay for a seat is withheld only when a human has read proof of one of three things: someone else or a program
ran the session; the account was shared or sold; or the experience did not run at all. Nothing else is proof. Signals
(how fast, how many taps, a paste, a score from any detector) only label the evidence level the asker sees. They never
cut pay, never change a person's standing, and never change how often they are rung, alone or in any number together.

## 1. The three grounds, and what proof of each looks like

| Ground | What it means | What proof looks like | What it is not |
|---|---|---|---|
| **G1. Someone else, or a program, ran the session** | The person whose account took the seat did not do the call | The account holder says so; or an identity re-check through the vendor fails and a human compares the result (step 4 only); or the same account answered two calls at once from two devices with both players running in real time, which one person cannot do, and the holder cannot explain it when asked | Few pointer or touch events; no hover; tab switches; a paste; a fast answer; a fluent answer; a detector's score; a VPN or a shared network |
| **G2. The account was shared or sold** | The account is used by people other than the one who joined | The holder says so; or the account is offered for sale or rent and a human has seen the listing; or an identity re-check fails (step 4 only) | Logging in from a new phone or a new city; a household sharing one network |
| **G3. The experience did not run at all** | The material never reached the seat | The router's own record shows the material was never served to that seat **and** no play, view or input event ever arrived, while an answer did | A record of "said" rather than "attended"; audio stalled by a slow network; the screen off while audio played; a screen reader that produces no pointer events |

"Shown by more than a signal and read by a human" means: the file holds one of the proofs in the third column, and a
person (named in `ops/HUMAN_JOBS.md`; until one is named, the operator) has read it and signed the decision with a name
and a time. An agent may gather the file. It never decides.

## 2. Never proof, alone or in any number together

- A detector's score on text, of any kind and from any vendor, including ours.
- A failed attention check, comprehension check, gold trial or known-answer item. (Gold trials in `compare` calls show
  the asker how the record reads. They never cut pay.)
- Speed alone: a fast answer, a fast take, a short seat time.
- A paste. Pastes are recorded and shown to the asker. They are never blocked and never punished.
- An answer the asker dislikes, finds short, generic, unhelpful, "low effort", or like someone else's.
- Few pointer, touch or keystroke events; no hover; keyboard-only or switch navigation.
- Tab switches, the page hidden, the screen off while audio played.
- A stalled or slow connection, an older phone, a long seat time.
- A VPN, a shared network address, a new device, a time zone that does not match.
- Evidence level "said". A response that misses the rule for "attended" is still paid (PLAN.md section 4, item 3).
- An asker's complaint or report about a person. It is read; it is not proof.
- Any combination of the above. **No number of signals adds up to proof.**

## 3. People who use a screen reader, a slow phone or more time

The runner sends no pointer or touch traces and no key-by-key timing for anyone (`runner/A11Y_RECORD.md`, 14 Nov 2026), so
a screen-reader or keyboard user's record is identical to anyone else's. What can differ, and never counts against them:
- long gaps before the first input, and a long seat time;
- audio or video that stalls; the router counts stalled time (`stalled_seconds` from the runner) out of every threshold;
- the page hidden or the screen off while audio plays (`hidden_seconds`). Under D10 such a listen is `said` and is paid in
  full; the asker reads "the page was hidden for 0:25 (screen off or another app)", never "inattentive".

A person may set "I use a screen reader" or "I need longer to answer" privately on their page. It gives them a longer
offer hold (`RING_RULES.md` rule 2). The asker never sees the setting. No human check runs that a screen reader cannot
pass.

## 4. How a finding runs

1. **Opened only by the operator, within 24 hours of the response arriving** (before it is counted by itself,
   `PAY_RULES.md` 4.1). An asker cannot open one; it can report a suspicion, which the operator reads as a signal.
2. **The person is shown it at once,** in plain words: the ground, the proof, what happens to the pay, and a one-tap
   appeal with room for their own words. The pay waits; it is not returned to the asker.
3. **A human decides within three days** of the appeal, or of the finding if there is no appeal. If nobody decides in
   three days, the response is counted and paid (PLAN.md section 10).
4. **Upheld:** that seat is not paid, and that one receipt says "not paid: finding upheld on <date>, ground G<n>".
   Nothing else about the person changes for G3. For G1 or G2 the account leaves the pool and the person is told why;
   their receipts stay theirs. **Overturned:** paid at once, and the finding is removed from every record the person can
   see.
5. **The asker** sees only that a response was withdrawn after review, never the finding or the person.
6. **Counted and published:** findings opened, upheld and overturned, each month.

## 5. On outside panels

On Prolific (step 2) our adapter approves every submission. We never reject on Prolific. If Prolific itself removes one
of its participants under its own process, that is Prolific's decision under its terms, and our result says so.

## 6. What changes a person's standing, chance of being rung, or pay

Only an upheld finding on G1 or G2. Not a signal, not an evidence level, not a stop, not a decline, not a missed ring
(two misses switch a person Off and they can turn On again; that is not a penalty), and never an asker's preference.
