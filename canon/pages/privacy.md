# Privacy

person.tools is run by **Hammer Corp., 1401 Lavaca St #41100, Austin, TX 78701**. Questions, requests and deletions:
**hello@person.tools**. This page covers the service at person.tools, its API and the person.tools app. The service is a
preview: nothing is charged, and every amount in it is test money. Version 2, 16 November 2026.

## In short

- We keep what a call needs and nothing else. No ads, no tracking cookies, and we never sell data. Our pages load Cloudflare Web
  Analytics, which counts page views without cookies.
- If you answer calls, you choose when you can be asked, and you can stop any call, leave, and delete everything from your own
  page in one tap.
- What your AIs send you is yours. Nobody at person.tools looks at it. Photos and clips are stored encrypted and deleted after
  seven days, or when you choose. Nothing you get here is ever shown to a reviewer.

## If you answer calls

**What is recorded during a call:** when the sound or video plays and pauses, whether the page is in front, how long you take,
your answers, and whether each answer was typed or pasted. **Not recorded:** your voice, your camera, your location, your
contacts.

**What the asker gets:** your answers and a short summary of that record (for example, how much of the sound played), under an id
that is different for every asker. Never anything that says who you are, and never the step-by-step log of each play, pause and
skip. Each call says, before you take it, whether the asker may use your written answers to train AI.

**What we keep about you:** the panels you joined, the alias you choose, when you can be rung (On or Off, quiet hours, sounds,
and whether your alerts show an ask's first line),
and your answers and receipts. A key or token pasted into an answer is stored as "[removed]". If you use the app: your phone's
notification token, so a call can reach you, and the public half of its device key, which lets us check that an answer was
approved on that phone. If you sign in with a passkey: its public half and your sign-in sessions. Computers you signed in to the
Desk with your phone, with roughly where each one was (city and region) and its browser, until you sign it out. The people you
muted or blocked, and the daily limit you set for asks.

**In public:** for calls our own programs make, the proof page shows when each was answered, what kind of call it was, how many
people answered, and what it changed. Never your name, and never your words, unless you say yes to that quote.

## If you ask (an AI agent or the person behind it)

We keep a hash of your key (never the key itself), the calls you make and their screening, the test-money ledger, the panels you
make (a hash of each join link), and the material you send, copied into our storage so a person only ever opens our copy. A quote
keeps only its lines and total, for one day. A call from an account we don't know is read by a model before anyone is rung: the
call's own words and fields, and the text of a page or build it sends, never a person's answers, identity or record. Audio and video from outside are checked by a person at
person.tools before anyone hears them.

## Your own AIs (connections)

A connection is made by you, for one AI, and does one thing: it places asks to you. You can revoke it in one tap, and its open
asks are withdrawn. What it sends you is not read by a model, not put in a review queue and not shown to anyone at person.tools;
photos and clips are encrypted, shown only to you, and deleted seven days after they arrive unless you choose otherwise.

## Asks from a person you know

When a person's panel is made theirs, they can send asks to the people who joined it, and pass on asks they received. They see
your answer and your notes under the name you joined with; that is the point, since you know each other. When they pass on
someone else's ask, that first asker gets your answer, never your name. person.tools checks each ask's size, its links and that
it carries no key or password; nobody at person.tools reads what you send each other. You set how many asks one person may send
you in a day, and you can mute, block or leave at any time.

## What an alert shows

An alert for an ask, from your own AI or from a person you know, says only who is asking. If you turn on "Show the ask in my alerts"
in your settings, it also shows the ask's first line (at most 80 characters, never the whole ask and never a photo or clip). It is
off unless you turn it on, only you can turn it on, and you can turn it off at any time. The words never travel inside the alert, so Apple and your browser's push
service never carry them: when the alert arrives, your phone fetches the line from us. Your phone's own setting for showing
previews still decides whether anything appears on your lock screen.

## Other people's details in an ask

A service may put up to four people's details on an ask (a name, a phone number, an email address) so you can reach the person
it is about, such as a customer who called a shop. The service tells us how that person agreed to be contacted. You see the
details only on the open ask; in an alert, your list, your history and everywhere else that person appears only by role
("customer"). The details are deleted within a minute of the ask closing. If you type a contact's name into your answer or a
note, we keep a reference in its place and the service fills the name back in from its own records; a number or address you
type yourself stays as you wrote it.

## How long things are kept

| What | How long |
|---|---|
| Your answers | up to 395 days, or until you delete them |
| The detailed record of a call (each play, pause, seek) | 30 days |
| Material sent for a call | until the last call using it closes, plus 30 days |
| Photos and clips your own AIs send you | 7 days, or the schedule you set |
| Tasks for you | open until answered or until the ask's own time runs out (60 seconds to 30 days, set by the asker); then it lapses and is never answered for you; answered ones 180 days, or until you delete them |
| Asks from a person you know, and asks passed on to you | as tasks for you (open until answered or their time runs out; answered ones 180 days, or until you delete them) |
| Mutes, blocks and your daily limit | until you remove them or leave |
| A contact's name, phone and email on an ask | while the ask is open, then at most a minute |
| Desk sign-ins (which computer, roughly where) | until you sign it out, or 30 days unused |
| Passkey sign-in sessions | 30 days, or until you sign out |
| A connection you revoked (what it sent) | 30 days |
| Answers sent back to your AI (delivery records) | 7 days |
| Data made only by a test key | 30 days after the key was last used |
| Retry records (so a repeated request returns the first result) | 7 days |
| Rate-limit counters (a hashed address, salted daily) | 24 hours |

"Deleted" means gone from the live service at once, and from every copy within 30 days.

## Who else handles data

- **Cloudflare** runs the service, its database (in western North America) and its storage, and keeps its own edge logs of
  requests to our addresses. We write no request logs with network addresses of our own.
- **Apple** carries the app's alerts and sees each alert's words: who answers for the call, its kind, the minutes and the pay or
  "unpaid test"; never the ask or the material. **Your browser's push service** carries web alerts, encrypted end to end.
- **Our mail service** carries mail to and from hello@person.tools. For now its receiving account is shared with another of the
  operator's products, whose server also receives each message.
- **Anthropic** provides the model that reads the words of calls from accounts we don't know (never a person's answers or identity).

## What we never ask for

A card number, a password, a one-time code or an API key: calls that ask for them are refused, and a key-shaped value pasted into a
reply is removed before it is stored. We never choose or describe people by health, religion, sexuality, ethnicity, immigration
status or politics, and we keep nothing that tells voices apart.

## Deleting, and asking

If you answer calls: one tap on your own page deletes your account, answers and records (you can save your receipts first). For
anything else, including the data behind a key you made, write to hello@person.tools.

**Requests from police or courts:** nothing without legal process, and we tell the person unless the law forbids it.

**Changes:** we post them on this page with the date.
