# Tasks: one exact step for one named person

Rules for person.tools (working name), version 1, 15 Nov 2026. The kind comes from the CEO's order of 8:28 AM CT
(owner/OWNER_all_7.md), on the operator's request for one place where all of our agents can give him tasks. The CEO's
addition of 8:32 AM CT:
tasks are addressed to one named member. TRUST owns these bounds; the router codes from this file. Everything in
`RING_RULES.md`, `POLICY.md` and `DATA.md` still applies except where this file says otherwise.

## What a task is

One thing only a person can do or decide: a command to copy (with where to paste it), one link to open, or one question with
two to four choices (or a typed line). It names what it unlocks, who asks (the program and its session), and how urgent it is
(now, today, whenever). The person answers Done, a choice or a line, or Not now, with a note if they like.

## The bounds

**The CEO's ruling, 10:08 AM CT, 15 Nov 2026 (owner/OWNER_router_2.md), word for word:** "a task placed by an operator or team key
to that operator's OWN panel is the lab asking its own person, and the screen written for strangers does not apply to it. For that
case keep exactly one check: a secret's VALUE (a key- or token-shaped string). That check must not trip on a web address, in --link
or in the step's text, nor on a number inside an address, nor on the words key, login, password or code. Everything else comes off
for that case. Nothing changes for any other key or any other kind of call: outsiders still cannot place tasks, and calls to
strangers keep the full screen."

So, today:
1. **Our own keys only.** Tasks come only from operator-made keys (`real_` keys the owner lists, such as the operator's own) and the team's own
   keys. Any other key is refused (403).
2. **The key's own panel, one named person.** A task goes only to a panel of the key's own principal, addressed to ONE member,
   and reaches only that member. A join link for that same panel is the person's own way in, not a secret.
3. **One check on the words: no secret's value.** A key- or token-shaped string is refused, looked for after every web address
   is removed and never in the link itself. The words key, login, password or code are not secrets.
4. **A pasted secret never rests with us.** A key- or token-shaped string in the person's reply or note is replaced with
   "[removed]" before it is stored, and the receipt says: "A key-shaped value was removed; save it to the file the step names."
5. **The sender's duty, and two checks kept.** One task, one step; only what a person must do or decide. No subject the
   operator does not share and no confidential material the operator names: these two are also checked in code, from lists
   kept only in the service's database (never in this source); with a list unreadable, the task is refused until it can be
   read. (`screening/task_bounds.js` keeps the fuller bounds and task screen for any future case
   the CEO opens to other keys.)

## Rings (RING_RULES.md applies, with these three lines)

6. **"now" rings once; "today" and "whenever" never ring.** They only join the list. A "now" task rings only when the person
   is On, outside their quiet hours and under rules 1 and 5 (one ring in 30 minutes, four in an hour); if it cannot ring, it
   waits on the list and does not ring later.
7. **An unanswered task is not a miss.** A task stays on the list until it is answered, so leaving a task ring unanswered
   does not count toward switching the person Off (rule 6 is about calls whose seats lapse).
8. **Not now is an answer.** The asker gets it like any other answer.

## What is kept (DATA.md row "tasks")

The task as sent, its state, the answer and the note, and the times; open tasks until answered or 30 days, answered ones in
the person's history for 180 days or until they delete them. The asker reads its own task's state and answer by id. Answers
copied to the asking machine (`~/.person_tools/answers/<id>.json`) are that machine's, outside the service.
