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

## A person's own asks, and passing an ask on (owner/OWNER_router_18.md)

When the operator has made a panel a person's own, that person can send the same one-step asks and cards to the people who joined
it. Anyone can pass an ask on their list to one of their own people. The CEO's ruling of about 6:00 PM CT, 15 Nov 2026, as the order
records it, adopts four guards. With TRUST's points they are:

9. **The sender's name is checked, never typed.** The name a person sees ("From ...") is the owner's account name. It passes the
   same check as an asker's name (no bank, government, known company, person.tools itself, "official" or "verified"), with the
   operator's lists read, and nothing typed into an ask can change it. A passed ask shows the name it came from and the person who
   passed it on. Both come from records that passed the same check, the name of a person's own AI included.
10. **Only to their own people.** An ask or a pass goes only to members of the sender's own panels who have not left, never to
    the sender's own memberships. Anything else is refused, and nothing is sent. Each ask is addressed to one membership and reaches
    only that person, even when several people joined through one link.
11. **A daily cap the receiver sets.** Each person sets how many asks one sender may give them in a day (0 to 100; 20 unless they
    change it). The count runs in the receiver's own day, and passes count the same way as sends. Over the cap, an ask waits until
    the receiver's next day and the sender is told when; nothing is dropped. One sender sends at most 300 asks a day.
12. **Links show where they go.** Only https links are taken. A link that hides where it goes (a bare address, a short link,
    look-alike letters, a name before an @) or that downloads a program is refused, and so is a link whose words name another
    site. A sign-in page is marked as one, and every link shows its real domain beside it. This check reads the address, not the
    message.
13. **People who joined earlier are told first.** Someone who joined a panel before its owner could send asks sees, once, what
    joining now also means, with Mute and Leave beside it. No person's ask reaches their list, or can be answered, until they have
    read it. Someone who joined through a page that showed this line first counts as told.
14. **Mute, block, and where the answer goes.** A receiver can mute a sender, a passer or a panel's owner (the asks stay on the
    list but never ring), or block them (the sender sees only "not available"). The answer goes back to the sender; for a passed ask,
    it goes to the original asker and to the person who passed it on. The original asker never learns who answered, and a line
    between a passer and the receiver stays between the two of them.
15. **Passing has limits.** An ask can be passed on at most 3 times. It never goes back through someone it has already reached,
    except straight back to the person who passed it, and a media check meant for person.tools's own reviewer is never passed on.
    Rule 3's secret-value check applies to everything sent or passed, and rule 4 to every reply and note. Asks between people are
    counted separately on /proof, and only real people's answers count.

DATA.md rows: panel owners, owner memberships, mutes, passes, send limits.

## What is kept (DATA.md row "tasks")

The task as sent, its state, the answer and the note, and the times. An open task waits until it is answered or its own time
runs out (the asker sets 60 seconds to 30 days; 30 days if it doesn't). Then it lapses: it leaves the person's list at once, it is
never answered on their behalf, and the asker is told "lapsed" (by its webhook, and on reading the task for 30 more days). Answered
ones stay in the person's history for 180 days or until they delete them. The asker reads its own task's state and answer by id. Answers
copied to the asking machine (`~/.person_tools/answers/<id>.json`) are that machine's, outside the service.
