# Connecting an AI: one place where a person's own AIs reach them

Rules for person.tools (working name), version 1, 15 Nov 2026, for the CEO's order of 11:47 AM CT (owner/OWNER_all_10.md items B
and C): "every person has one place where AIs reach them, on their terms; every AI has one call to reach a person." Everything
in `TASKS.md`, `RING_RULES.md` and `DATA.md` still applies; this file says only what is new. TRUST owns these words.

## The promise (the CEO's words, as set in OWNER_all_10, quoted exactly)

"we do not look at a person's own material (a home camera's picture is theirs). It is stored encrypted, deleted on the schedule
the person sets (seven days unless they say otherwise), and never put in front of a reviewer."

## What follows from it

1. **The person makes the connection; no AI connects itself.** A connection is made by the person, from their own page or the
   app: a name, an icon, and a link or key to give that one AI. It is its own principal under the person. Only the person
   sets or changes the name and icon; a picture given by address is copied into our storage when the connection is made (an
   image, at most 256 KB) and never loaded from the AI's own address, which would tell it each time the person looks.
2. **One thing only.** A connection's key places asks (tasks and calls) on that person's own panel, to that person. It cannot
   reach another panel, a pool or anyone else, read another connection's asks, or do anything else.
3. **No content screen, no reader.** A person's own AI's asks reach only that person, so they get no content screen beyond the
   size limits and the secret-value check (no key's or token's value in the words). Nothing a connection sends is read by a
   model, put in a review queue, or shown to anyone at person.tools. (The lab's own programs keep their two extra checks.)
4. **The person's own material.** A photo or a short clip shown with an ask is stored encrypted, shown only to that person,
   and deleted on the person's schedule: seven days after it arrives unless they choose otherwise. No admin route, log, export
   or check returns it; the operator sees counts only. A pasted key in the person's reply is still stored as "[removed]".
5. **Revoke, quiet, block.** One tap revokes a connection: its key stops at once and its open asks are withdrawn. A connection
   can be quieted (its asks wait silently) or blocked on its own. Urgent means first in the list and a banner, never a sound.
6. **Limits, so a leaked key cannot flood a person.** At most 60 asks an hour and 300 a day per connection; a photo at most
   10 MB, a clip at most 60 seconds and 20 MB. Beyond them: 429, and nothing stored.
7. **The answer back.** By polling with the connection's key, or by a webhook the person's AI names: https only, to a public
   address (the same address rules as copying material in: no bare IPs, no internal names, no loops to us), signed with
   HMAC-SHA256 over the exact body with the connection's own secret (shown once when made; the person can rotate it), with a
   timestamp, retried with backoff for up to 24 hours. Nothing but the answer to that ask goes in it.

8. **Brands and cards (OWNER_router_9).** A principal or connection may brand its asks (a name, a mark, colours) and lay an ask
   out as a card from a fixed set of blocks. The service's own "from" line (who answers for the ask, and how we know) and the
   person's Report and Stop are always drawn by us, never by a brand or a card. A brand's name passes the same check as an
   asker's name (OWN_PANELS rule 12): it may not say it is person.tools, official or verified, or name a company it is not.
   Pictures come only from our own store. No block carries code, a script or a remote address, and no input asks for a password,
   a one-time code, a card or bank number, an ID number or a key. Calls to anyone but the person's own AI pass the full call
   screen over every block.

## On the page (the words the person reads where they connect an AI)

"What your AIs send you is yours. Nobody at person.tools looks at it. Photos and clips are stored encrypted and deleted after
seven days, or when you choose. Nothing you get here is ever shown to a reviewer."

## Kept (DATA.md rows "connections" and "a person's own material")
