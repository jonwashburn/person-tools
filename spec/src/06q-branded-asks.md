## 27. Asks from a service, and branded cards

A service that works for a person (a home camera, a car dealership's assistant, a kitchen, a business tool) reaches that person
through the person's client with **asks** (26.5). This section is the service's side: how it places an ask, follows it and
clears it; how it gives its asks a **brand** and lays each one out as a **card**; how an ask carries the contact details of
someone else; and what a client draws and keeps for itself. Everything a service sends is data. Nothing a service sends is run,
and nothing it sends can change what an answer does.

An example. Northside Motors' assistant needs to know whether the lot opens on Christmas Eve. It places one ask: the
question, three answers (Open as usual, Closed, Other hours, the last opening a line for the hours), and a card with a
headline and the date. The owner's phone draws it with Northside's lamp lit in its orange, on Northside's white card with
Northside's near-black words. The three answers, Done, Later and the line are the phone's own controls, in the phone's own
colours, exactly as on every other ask. The owner taps Closed; Northside's server receives that one answer, signed, and the
ask leaves the list.

A server that offers this section lists `branded_asks` under `features` in discovery (section 5). Requirement identifiers
beginning `ASKS-` bind the server, `ASKER-` bind the service that asks, and `CARD-` bind the person's client.

Section 26.6 sends its readers here for cards. This section also lets a connection's key give its own brand (MEMBER-14), and
adds rules of form and of names to the asks of 26.1 (no client words, no claim to be the server or another principal, no
addresses or markup in a card, contacts in their own field).

Every route here is on the server's API host: the host of the connection's `link` (26.8) and of discovery. A person who gives
the service only the key gives it that host as well; the link carries both.

**Words**, in this section, are text with no address (nothing beginning `http://`, `https://` or `www.`), no markup (no `<`
followed by a letter or `/`) and no script; ordinary punctuation, `&` included, is allowed. **The asker** is the service, or
the business it works for: a customer who reached the business reached the asker.

### 27.1 Three owners

- **The brand belongs to the service.** It says who the service is and how its cards look: a name, a mark, the colours of its
  words and its card, its grounds. It is given once, proved by a domain the service controls (27.4), and worn by the
  asks of the key that gave it and by any ask sent with its brand key (27.4).
- **The card belongs to the ask.** An ordered list of blocks from a fixed set (27.5), followed by the ask's answers, which the
  ask's `step` defines (26.5, 27.6).
- **The controls belong to the client.** Who is asking, the answers' controls, the words at an answer's edge, Done, Later, Not
  now, Undo, the device's check before a signed approval, the evidence marks, the consent line (27.7), Report, Block and "Paid,
  from <brand>" on an offer.

**[CARD-1]** A client MUST draw every control in its own neutral colours, on every card, whatever the brand: no brand colour
on a button, a choice, a field, a link, a swipe word, Done, Later, Not now, Undo, the device's check, an evidence mark, Report,
Block, the consent line or who is asking. A brand dresses a card. It never changes what an answer does, never passes for another
principal, and never hides or removes anything the client keeps. **[CARD-2]** A client that cannot draw a brand's part (an
old client, a watch, a screen reader) leaves it out; every ask is complete without its brand and its card.

### 27.2 Placing, following and clearing an ask

A service asks with a key that may place asks on the person: a connection's key (26.8), which reaches only the person who made
the connection, or a principal's key on its own private panel. A connection's key may also give its own brand (27.3, 27.4).
The service gets the key and the webhook secret from the person,
who is shown them once when they connect it (26.8), or by connecting from the service (27.9). This section's table and
webhook are for a connection's key; a principal's own key on its own panel names the member with `to` (a member id) and reads
answers with `GET /v1/tasks/{task_id}`.

`POST /v1/tasks` places one ask:

| Field | Required | Meaning |
|---|---|---|
| `title` | yes | 3 to 120 characters: a few words naming the ask |
| `step` | yes | what is asked and how it may be answered (26.5, 27.6); `step.text` 3 to 4,000 characters, each choice 1 to 120 |
| `urgency` | no | `now`, `today` (the default) or `whenever` (26.5); a new connection takes all three until the person limits them; one the person did not allow this AI (26.8), the default
included, is 400 `invalid_field` on `urgency`, and the refusal's `allowed` lists the ones allowed |
| `expires_in` | no | seconds the ask stays open, 60 to 2,592,000 (30 days, the default) |
| `unlocks` | no | up to 300 characters: what the answer lets the service do |
| `idempotency_key` | no | 1 to 128 characters: the service's own stable key for the thing it asks about (below) |
| `card` | no | the layout (27.5) |
| `media` | no | one photo or clip the service uploaded within the hour before (`POST /v1/tasks/media`, below) |
| `contacts` | no | someone else's contact details (27.7) |
| `group` | no | 1 to 80 characters (letters, digits, `:`, `_`, `-`): asks drawn together (27.8) |
| `webhook` | no | one https address on a public host (not a bare IP address, an internal name, a reserved top-level domain such as `.example`, or the server's own; else 400 `invalid_field` on `webhook`) where the answer is sent, signed (below) |

It answers 201 with the ask as the service sees it: `{"task_id", "state", "title", "urgency", "step", "unlocks", "card",
"contacts", "group", "webhook", "brand", "key", "created_at", "expires_at", "reply", "notes", "url"}`, where `url` is the address of
`GET /v1/tasks/{task_id}`, `brand` is `{"id", "name"}` of the brand the ask names, proved or not (what the person sees follows 27.4), or `null`, and `contacts` is what the service
sent while the ask is open and `[{"id", "role", "ref", "consent", "consent_at"}]` after it closes. Fields the service did not send are
`null`.

**One ask for one thing.** **[ASKS-1]** A repeat of an `idempotency_key` from the same key MUST return the ask it made, as it
is now (open, answered or closed), with 200 and `"repeated": true`, whatever the repeat's body, and open nothing, for at least
30 days after that ask was placed. Without an `idempotency_key` every request opens an ask, so a service that may retry sends
one. An ask names one
thing; to change it, the service withdraws it and places a new one with a new key. (This differs from section 7 on purpose: a repeat
answers 200 with `"repeated": true` rather than the first status, a changed body is not an error because the thing asked
about has not changed, and the key binds for 30 days rather than 24 hours.)

**Following.** `GET /v1/tasks/{task_id}` answers the same object; `reply` is `null` until the person answers, then
`{"action", "choice", "text", "note", "at"}` as in 26.5, with `approved_text` after an approval, `device_approved` and `mark`
(26.6), and `contact_ref` when the choice was a contact or the answer was a call step's Called (27.7). A note from the person appears in
`notes` with `"by": "person"`; the service answers one with `POST /v1/tasks/{task_id}/notes` `{"note"}` (one line, at most 500
characters) while the ask is open, and it answers 200 `{"task_id", "notes"}` (a note on an ask that is no longer open is 409
`already_answered`). Notes and withdrawals send nothing to the webhook: a service that wants them reads
`GET /v1/tasks/{task_id}`, at most once a minute.

**The answer, sent.** An ask takes one answer: once it is answered, done, not now, lapsed or withdrawn it takes no other
(`already_answered`, 26.3). **[ASKS-2]** When an ask that named a `webhook` is answered, done, not now or lapsed, the server MUST
post, once for that ask, `{"task_id", "key", "state", "reply", "answered_at"}` to it, where `key` is the ask's `idempotency_key` (`null` when it
had none), `answered_at` and `reply` are `null` for a lapse, and otherwise `reply` is the reply as `GET /v1/tasks/{task_id}`
shows it. Each ask is posted on its own: Done on a grouped card posts once for each of its asks, each with its own `key`. The body is
`application/json` (no version header) and is signed with the webhook secret the connection was
given (26.8):

- `<prefix>-timestamp`: the time of this try, in Unix seconds;
- `<prefix>-signature`: `v1=` followed by the lowercase hex HMAC-SHA256 of the timestamp, a full stop and the body exactly as
  sent, keyed by the UTF-8 bytes of the whole secret as given (`whsec_` included);
- `<prefix>-delivery`: one id for this answer, the same on every try.

`<prefix>` is discovery's `webhook_header_prefix` (section 5 gains it with this section), or `{{wire_prefix}}` when discovery
names none. The server follows no redirect and ignores the response's body. A try succeeds
when the service answers 2xx within 8 seconds; any other answer, or none, is a failed try, and none ends the retries early. **[ASKS-3]** A server MUST try again after a failed try, about 1 minute, 5
minutes, 30 minutes, 2 hours, 6 hours, 12 hours and 24 hours later, signing each try with its own timestamp, and then stop.
**[ASKER-1]** A service MUST check the signature before it acts on an answer, SHOULD refuse a timestamp more than five minutes
from its own clock, and MUST act on one delivery id once. The signature header carries exactly one `v1=` value. The secret is
shared by the server and the service alone; a service that wants a second word on an answer reads `GET /v1/tasks/{task_id}`
with its own key.

**The secret and a revoked connection.** The person can make the connection a new webhook secret (`POST
/v1/member/connections/{id}/secret`, which answers `{"webhook_secret"}` once), which stops the old one at once: tries after
that are signed with the new one, and the person gives it to the service as they gave the first. A revoked connection's key
answers 401 and its pending deliveries stop.

**A photo or clip.** A connection's key uploads one piece with `POST /v1/tasks/media`, the bytes as the body with their
`Content-Type` (a photo: `image/jpeg`, `image/png`, `image/webp`, `image/gif` or `image/heic`, at most 10 MB; a clip:
`video/mp4` or `video/quicktime`, at most 20 MB and 60 seconds). It answers 201 `{"media_id", "content_type", "bytes",
"seconds"}`; the ask that carries it is placed within the hour, and the piece is kept on the person's schedule (26.5).

**Clearing.** When the thing is settled elsewhere (the person answered in the service's own app), the service withdraws the
ask: `POST /v1/tasks/{task_id}/withdraw` `{"why", "elsewhere": true}` (`why` 3 to 200 characters). It answers 200 with the ask
as 27.2 shows it, in the state `withdrawn`; withdrawing it again returns it as it is, and an ask already answered is 409
`already_answered`. **[ASKS-4]** A withdrawn
ask MUST take no answer; a server MAY keep it in `open` for up to 24 hours, marked `"state": "withdrawn"` with
`withdrawn_at` and `withdraw_why`, so that a client can say it was taken back and why. **[CARD-17]** A client MUST NOT count,
alert or offer answers on a withdrawn ask; it may show it, quietly, until it leaves the list, except one withdrawn with
`elsewhere`, which it removes at once without showing anything, and whose history says it was answered in the service. **[ASKER-2]** A service MUST withdraw an ask it no longer needs, and MUST NOT place an ask
for a thing the person cannot act on: an ask always has an answer the person can give. No ask is sent to keep a service visible.

### 27.3 The brand

`PUT /v1/brand` `{"brand": {...}}`, with the key whose asks will wear it (a principal's key, or a connection's key), gives
the brand or replaces it whole, and answers 200 `{"brand", "id", "domain", "verified", "updated_at", "prove_it"}`, where `id` is the brand's `brand_id` from
the first `PUT` on (`prove_it` until the
domain is proved, 27.4). `GET /v1/brand` answers the same.

```json
{ "brand": {
    "name": "Northside Motors",
    "domain": "northside.example",
    "mark": { "states": {
        "needs_you": { "glyph": "disc", "colour": "#e8590c" },
        "idle":      { "glyph": "ring", "colour": "#181818" } } },
    "colours": { "ink": "#0d0d0d", "ink_soft": "#5d5d5d", "rule": "#e6e6e6" },
    "grounds": { "light": "#ffffff" },
    "corners": "round",
    "quiet_line": "Nothing needs you."
} }
```

A brand gives only what it has. A name and a domain alone are a complete brand. `domain` may be left out while a brand is
drafted, but a brand without one is shown to no one. After the proof, `prove_it` is left out of the answers; `verified_at`
says when.

| Field | What it is | Limits |
|---|---|---|
| `name` | the service's name, set as text by the client in the client's own typeface | 1 to 40 characters; words only |
| `domain` | the domain the service proves it controls (27.4); the client shows it beside the name | a public domain name; never the server's own; one under a reserved top-level domain (`.example`, `.test`, `.invalid`, `.localhost`) cannot be proved, so its brand stays a test brand |
| `mark.states` | the brand's one mark in each state: `needs_you` (the ask is open), `answered` (it was answered), `idle` (where the client shows the service with no open ask) | each state is a glyph `{"glyph", "colour"}` or a picture `{"media": "m_..."}`; `needs_you` or `idle` at least; a missing state is drawn as `idle`, then as `needs_you` |
| `glyph` | a shape the client draws: `disc` (filled circle), `ring` (circle outline), `square` (filled square), `frame` (square outline); an outline's stroke is 15% of the mark's size | one of the four |
| `colour` (in a state) | the mark's state colour, drawn in that state and nowhere else | `#rrggbb`; required with a glyph |
| `colours` | the card's dressing, each tied to one place: `ink` (the card's own words), `ink_soft` (fact labels, the when and where line, a quote's speaker), `rule` (the card's edge and the lines between blocks) | `#rrggbb` each; needs a ground of the brand's own |
| `grounds` | the card's ground, `light` and `dark` | `#rrggbb` each; either may be left out |
| `corners` | `square` or `round`; the client picks its own radius | |
| `quiet_line` | the service's words for having nothing open | 1 to 40 characters; words only |

A mark's picture is one png, jpeg or webp image of at most 256 KB, uploaded with `POST /v1/brand/mark` (the bytes, with their
content type), which answers 201 `{"media_id"}`. **[ASKS-5]** A server MUST refuse svg and any picture by address: nothing in a
brand or a card is fetched from the service's servers when a person looks at it.

**[ASKS-6]** A server MUST refuse (400 `invalid_field` on the field) a brand whose `name` or `quiet_line` carries an address, markup or script, reads as the server
or as one of the client's own words (27.6), or names a principal that is not the service (a bank, a government, a known company
that is not the service, the server itself), or the person's own AI in general words ("Your AI", "your assistant"). **[ASKS-7]** A server MUST refuse with `contrast_too_low` (the field, the ratio
measured, the floor and an `example` that passes) an `ink` or `ink_soft` under 4.5:1 against any ground the brand gives, and a
glyph `colour` under 3:1 against any ground the brand gives. These are WCAG 2.2's floors for text (1.4.3) and for graphical
objects (1.4.11). `rule` carries no meaning and has no floor. The refusal carries `ratio` and `floor` as strings ("2.81",
"4.5") and `ground`, the ground it was measured on. A place the brand leaves out (`ink_soft`, say) is drawn in the client's
own colour.

**The mark slot.** **[CARD-3]** A client MUST draw a brand's mark only in the card's one mark slot (at the card's top edge,
before the brand's name, no larger than the line of text beside it), where it groups asks by who is asking, and where it lists
the person's AIs (`needs_you` for an AI with an ask open, `idle` for one with none); never inside a
block, never on or beside a control, never as the ground. It MUST draw a state colour only in the mark slot. So a service whose
colour has one meaning ("this needs a person") keeps it to that meaning on every card. The client picks the state: `needs_you`
for an open ask, `answered` after.

**Light and dark.** **[CARD-4]** A client MUST apply the dressing colours only on the brand's own ground. In a mode the brand
gave no ground for, it draws the card on its own ground with its own ink and keeps only the name, the domain and the mark.

**Floors in the client.** **[CARD-5]** A client MUST check each brand colour against the ground it actually draws on: words
4.5:1, a glyph 3:1. Where a colour fails, it uses its own ink (for a glyph, its own ink in the same shape). The brand sets no
typeface and no size: the client draws every word in its own typeface at its own sizes, and never below 11 points or 11 CSS
pixels.

### 27.4 Proving a brand, and wearing it

**[ASKS-8]** A server MUST NOT put a brand on any ask until the brand has proved its domain, except a test brand (below). `PUT
/v1/brand` answers with `prove_it`: `{"token", "file", "txt_name"}`. The service proves the domain one of two ways: it
serves `file` (`https://<domain>/.well-known/{{wire_prefix}}-brand`) as plain text with a line that is exactly `token`, or it
puts `token` as the value of a TXT record named `txt_name` (`_{{wire_prefix}}-brand.<domain>`). The file may hold many lines,
one for each server or key that asked; LF or CRLF line ends; the server reads the first 4 KB and follows no redirect. Then the
service asks `POST /v1/brand/verify` (no body), at most once a minute (more often may be answered 429 `rate_limited` with
`retry_after_seconds`). The file answers 200, as plain UTF-8 text (a byte-order mark is ignored); its content type is not
checked. It answers 200
`{"domain", "verified": true, "verified_at", "how"}` (`how` is `file` or `dns`) once the token is found, and 200
`{"domain", "verified": false, "note"}` while it is not; with no `domain` set it is 400 `invalid_field` on `brand.domain`. A brand stays proved, and its token stays the same, while its domain is unchanged; because a `PUT` replaces the whole
brand, one sent without `domain` drops it, and the domain proves itself again with a new token. (A
server may also read a path of its own, which its `prove_it` then names.) A changed domain proves itself again. A changed name, mark or colour passes ASKS-6 and
ASKS-7 again.

**[CARD-6]** A client MUST show a proved brand's name with its domain beside it ("Northside Motors, northside.example"), and
MUST still draw who is asking itself (26.6): a person always sees both who dressed the card and who sent it.

**One brand, many keys.** A service reaches many people, each through a connection with its own key. The first time a brand is
proved, `POST /v1/brand/verify` also answers `brand_id` (`br_...`, the `id` the brand has had since its first `PUT`) and, once,
`brand_key` (`bk_...`). The `brand_id` never
changes and `GET /v1/brand` carries it from then on; a later proof (after the domain was dropped and given again) answers no
new brand key, and `POST /v1/brand/key` makes one when it is needed. **[ASKS-9]** A request
that places an ask and carries the header `Brand-Key: bk_...` MUST wear that brand, whatever key placed it; an unknown, stopped
or unproved brand key MUST be refused with `brand_not_proved` and nothing stored. The brand key does nothing else. `POST
/v1/brand/key` makes a new one, answers 200 `{"brand_id", "brand_key"}`, and stops the old one. An ask wears its brand as
the brand is when the client reads it: asks placed before the proof wear it once it is proved, and a changed brand changes
how open asks look. **[ASKER-3]** A service MUST keep its brand key as it keeps its other
keys: never in an address, a log or an ask.

**Test brands.** **[ASKS-10]** A brand that has not proved its domain MUST be shown only to the server's own test members
(members the server made for testing, never a real person), marked `"verified": false, "test": true`, whatever key gave it. Which test members a service may reach is the server's
to say; a service with none proves its domain before its brand shows anywhere. An ask that wears a brand which is not proved reaches a real person with no brand (`"brand": null`) and a test member
with the test brand. A test brand may also hold a brand key
(`POST /v1/brand/key`) and run the connect road of 27.9; both reach test members only. **[CARD-7]** A client
MUST draw a test brand with the words "Test brand, not verified" in its own colours.

### 27.5 The card

`"card": {"blocks": [...]}`: one to twelve blocks, each an object with exactly one key, its type.

| Block | Value | Drawn as | Limits |
|---|---|---|---|
| `headline` | words | the card's first line, in `ink` | 1 to 80 characters |
| `text` | words | a paragraph, in `ink` | 1 to 600 characters |
| `facts` | `[{"label", "value"}]` | label and value rows | 1 to 8 rows; label 1 to 40, value 1 to 80 characters |
| `when_where` | `{"when"?, "where"?}` | one line, in `ink_soft` | when 1 to 60, where 1 to 120 characters |
| `price` | `{"amount", "currency", "label"?}` | an amount with its currency | amount with two decimals, as a string; ISO 4217 currency |
| `media` | `"m_..."` | the ask's one photo or clip (26.5), where the block stands | from the server's store only |
| `quote` | `{"text", "by"}` | words someone else said, as a quotation, with who said them | text 1 to 600, by 1 to 40 characters |
| `contact` | `"c1"` | where the open card draws that contact's details (27.7) | names a contact of the ask |
| `choices` | the step's choices, in order | where the client draws the answers' controls | equal to `step.choices` |
| `input` | `{"label", "placeholder"?}` | where the client draws the step's line, with its label | label 1 to 80 characters |

`choices` and `input` only place the answers; an `input` block belongs to a question without choices (a choice's line takes
its label from `line_for`), and a server refuses it elsewhere. What the answers are, and what each does, comes from the step. A card without them
has its answers drawn after its last block. Wherever the answers are drawn, the step's question (`step.text`) is drawn right
before them, so no card shows answers without the question they answer.

**[ASKS-11]** A server MUST refuse a card with a block it does not know, a `choices` block that differs from `step.choices`
(`choices_differ`), an `input` that asks for a password, a one-time code, a card or bank number, an ID number or a key, and any
word that carries an address, markup or script, reads as one of the client's own words, says the server checked or vouches for
anything, or holds a value shaped like a secret. **[CARD-8]** A client MUST draw the blocks in order, ignore a block it does
not know, run nothing a card carries, and draw the step's question right before its answers.

```json
{ "title": "Christmas Eve is Thursday, Dec 24. Are you open?",
  "card": { "blocks": [ { "headline": "Christmas Eve is Thursday, Dec 24." },
                        { "text": "Shoppers and callers will ask. Tell me once and the AI uses it." },
                        { "when_where": { "when": "Thu 24 Dec" } },
                        { "choices": ["Open as usual", "Closed", "Other hours"] } ] },
  "step": { "type": "question", "text": "Are you open?",
            "choices": ["Open as usual", "Closed", "Other hours"],
            "line_for": { "Other hours": "Your hours that day" } } }
```

### 27.6 Answers

This section adds to 26.5's steps and answers.

**Done, Later and Not now on every ask.** **[CARD-9]** A client MUST offer, on every ask whatever its step, Done (`{"action":
"done"}`: the person dealt with it, or cleared it without an answer), Later (the client's own: the ask goes to the back of the
list and nothing is sent) and Not now (26.5). **[ASKS-12]** A server MUST accept `done` on every step, `approve` included, giving
the state `done`. The service reads `done` as cleared with no choice made.

**The client's own words.** Done, Later, Not now, Undo, Report, Stop and Block are the client's. **[ASKS-13]** A server MUST
refuse with `reserved_word` a choice, an approval's label, a card block or a brand's words that is, as a whole, one of them
(compared after folding case, accents and look-alike letters, and again with every character that is not a letter removed, so
"Done!" and "D o n e" are Done), and SHOULD name free words in `example` ("Did it" for "Done").
So a swipe word and an answer never read the same and do different things.

**A choice that takes a line.** `step.line_for` maps a choice to the label of a line: `{"Other hours": "Your hours that day"}`.
Each key is one of `choices`; each label is 1 to 80 characters. **[CARD-10]** Choosing it, a client MUST open the line and send
`{"action": "answer", "choice", "text"}`. **[ASKS-14]** A server MUST refuse that choice without `text` (1 to 4,000 characters), and `text` with any
other choice, each as 400 `invalid_field` on `text`.

**Keyboards.** `step.keyboard` names the keyboard for every line the ask takes (the line of a question without choices, and
each line of `line_for`): `text` (the default), `number`, `phone` or `email`.
**[ASKS-15]** A server MUST check the answer's form (a phone number has 7 to 15 digits, with `+`, spaces, brackets and hyphens;
a number reads as a number; an email address as an address) and refuse a wrong form with 400 on `text`.

**A call to make.** `{"type": "call", "contact": "c1", "text"}` names a contact of the ask (27.7) that has a `phone`; `text`
is what the call is about (3 to 4,000 characters), shown above the client's Call control. **[CARD-11]**
A client MUST draw the contact once (where a `contact` block stands, else beside the Call control) and its own Call control, which dials the number on the person's own device, then offer
"Called", which sends `{"action": "answer"}` (the person says they made the call; only this reply carries `contact_ref`), besides
Done (cleared without saying), Not now and a note. **[ASKS-16]** Nothing is dialled by the server or the service.

The step registry (26.12) gains `call`.

### 27.7 Someone else's contact details

An ask from a person's own AI, or from a principal to its own private panel, may carry the contact details of someone who is not
the person: a customer, a caller, a colleague. They travel in one field, `contacts`, with handling of its own.

```json
"contacts": [ { "id": "c1", "role": "shopper", "name": "Avery Johnson", "phone": "+15125550142",
                "ref": "cv_812", "consent": "they_contacted_the_asker" } ]
```

| Field | What it is | Limits |
|---|---|---|
| `id` | how the ask refers to the contact | `c1` to `c4`; at most four contacts |
| `role` | who they are to the person ("customer", "caller", "plumber"), shown wherever the details are not | 1 to 30 characters; letters and spaces; never a person's name |
| `name` | their name | 1 to 80 characters |
| `phone` | their number | E.164 |
| `email` | their address | at most 254 characters |
| `ref` | the service's own id for them, returned with the answer and kept after the close; never shown to the person | 1 to 80 characters; never holds a long number (27.7, Numbers), because a `ref` outlives the close: a service whose ids hold seven digits or more in a run sends a shorter id of its own |
| `consent` | the service's statement that they were contacted with their consent: `they_contacted_the_asker` (they got in touch with the asker first) or `they_agreed_to_be_contacted` | required; someone who contacted nobody (a vendor, a would-be colleague) is not put in `contacts` at all |

`id`, `role` and `consent` are required, and a name, a phone or an email, or more than one of them. A phone not written in
E.164 is refused, not rewritten. `contact_ref` in a reply is the contact's `ref` (`null` when it has none).

**References.** Lengths count a reference as written (`{c1}` is four characters). Words in the ask may refer to a contact as
`{c1}`: the title, `unlocks`, the step's text, choices and `line_for` labels, an approval's text and labels, and
a card's `headline`, `text`, `facts` values, a `quote`'s `text` and `by`, and `when_where`. **[ASKS-17]** A server MUST refuse a reference to a contact
the ask does not carry (`unknown_reference`), and a `role` that reads as a name: a role in which any word after the first
starts with a capital letter, or which repeats a word of the contact's `name`, is refused on `role`. **[CARD-12]** On the open card (the ask as the person opens it, while it is open)
a client MUST draw the contact's name for a reference ("the <role>" when it has none); everywhere else it MUST draw "the
<role>". Two contacts of one ask with the same role are numbered in the order given ("the shopper 1", "the shopper 2"), and a
reference that starts a sentence takes a capital ("The shopper wants ..."). A choice that is a
reference is answered with that string, and the reply carries `contact_ref`. The digest of a signed approval covers the text as
the person saw it, names drawn.

**Where the details show.** **[ASKS-18]** A server MUST carry a contact's `name`, `phone` and `email` only on the open ask in
`GET /v1/member/tasks` and, to the service that sent them, in its own view of the open ask (27.2), and never in a push, the alert line (26.7), `groups`, history, a receipt, an export, a public page, a
count or a log; where a reference stands in any of those, the role stands in its place. **[CARD-13]** A client MUST show the
details only on the open card, and under them, in its own words, whose statement the consent is: "Northside Motors says Avery Johnson got in touch first" for `they_contacted_the_asker`, and
"... says Avery Johnson agreed to be contacted" for the other, naming the brand the card shows, proved or test (or, with none, who is asking as
the client shows it) and the contact's `name` as given, or "the <role>" when it has none. It never says what the person agreed to beyond being contacted.

**Deleted at close.** **[ASKS-19]** When the ask is answered, done, not now, withdrawn or lapsed, the server MUST delete the
contact's `name`, `phone` and `email` within a minute, keeping `id`, `role`, `ref`, `consent` and `consent_at` (when the ask that stated it was placed).

**Not passed on, not to strangers.** **[ASKS-20]** A server MUST refuse to pass on an ask that carries contacts (409
`has_contacts`), and MUST refuse `contacts` on a call to a pool, an offer, and a person's ask to their own people
(`contacts_not_allowed`). **[CARD-14]** A client MUST NOT offer Pass on for an ask that carries contacts.

**Numbers.** A long number is seven or more digits in a run, where spaces, brackets, dots and hyphens between digits do not
break the run. **[ASKS-21]** A server that refuses long numbers in an ask's words (it need not) MUST NOT apply that rule to
`contacts[].phone`, and MUST apply it everywhere else as before, answering `number_outside_contacts` with an example that moves the number into
`contacts`.

**[ASKER-4]** A service MUST put another person's details only in `contacts`, MUST state consent truthfully, and MUST NOT carry
the details of anyone who did not contact it or agree to be contacted.

### 27.8 Groups, speed and the count

**Several questions on one card.** A service with several questions about one thing sends each as its own ask with its own
answer, and gives them the same `group`. A group belongs to one key asking one person; the oldest open ask in it (the earliest `created_at`; asks placed in the same
second, the lower `task_id`) heads the card, a lone open ask of a group is drawn alone, and
a group's name may be used again once all its asks have closed. **[ASKS-22]** A server MUST alert the person at most once for
the asks of one group placed within a minute of each other, so a service places them back to back. **[CARD-15]** A client MAY draw the open asks that share a `group_id` as one card (the
person's list gives each grouped ask a `group_id` naming both its asker and its group, since two of a person's AIs may use the
same group name; a client never groups by the name alone); such a card shows the oldest ask's title and card (the oldest: the earliest `created_at`, then the lower `task_id`),
then each ask's step as a row, the oldest first, with its own answers, its own `unlocks` and its own urgency and expiry (the
others' cards are not drawn); Done, Later and Not now on the whole card act on each open row. `group_id` is an opaque string;
26.5's `groups` (asks by who is asking) is unchanged. A client that does not group draws each ask alone and loses nothing. **[ASKS-23]** A server MUST refuse a seventh open ask in
one group (`group_full`), and an ask with a `group` whose step is not a question (400 `invalid_field` on `group`): an approval,
a link, a command or a call stands on a card of its own, so another ask's card never frames what it does.

**Speed.** `urgency` says how soon it matters and `expires_in` how long it stays open. **[CARD-16]** When an open ask expires
within the hour, a client MUST show the time left, and when it lapses, MUST remove it. Nobody's ask is answered for them: a
lapse reaches the service as `lapsed`.

**The count and the quiet line.** A client counts each service's open asks itself. **[ASKS-24]** `GET /v1/member/connections`
MUST carry, on each connection whose asks wear a brand, that `brand`, so that a client can draw the mark's `idle` state and the
`quiet_line` for a service with nothing open. A client draws the quiet line only there: never as an ask, never in an alert.

### 27.9 Connecting from the service (SHOULD)

A person connects their own AI by making a connection and giving the AI its key (26.8). A server SHOULD also let a service where
people sign in start the connection, so that the key reaches the right account:

1. The service sends the person to the server's connect page (discovery's `connect_page`; the reference server's is
   `https://run.person.tools/connect`) with the query parameters `brand` (its `brand_id`), `state` (the service's own value,
   1 to 500 characters, returned unchanged) and `return` (an https address on the brand's proved domain or a subdomain of it, on the default port: the proof covers no other).
2. The person, signed in to the server, sees the brand, its domain, that it is proved, and the urgencies it may use; may rename
   it; and connects it or not.
3. The server sends the person to `return` with `code` and the same `state`, or with `error=declined` (the person said no)
   or `error=` and an error code (anything else).
4. Within ten minutes, once, the service exchanges the code: `POST /v1/connect/token` `{"code"}` with `Brand-Key`, which answers
   the connection's `key`, `connection_id` and `webhook_secret`, as 26.8 gives them. This route and the page's own
   `POST /v1/connect/brand` `{"brand", "return"}` take no `Authorization` (add them to AUTH-1's list); the second answers
   200 `{"brand": {"id", "name", "domain", "verified"}, "return_ok": true, "urgencies", "note"}`, or refuses as ASKS-25 says. A connection made this way wears the brand on
   every ask without `Brand-Key`.

With a test brand (27.4) the connect page and the code exchange work only for the server's test members, and `return` must
still be on the brand's own domain, so a service can walk the whole road before it proves its domain. **[ASKS-25]** A server
that offers this MUST refuse a `return` outside the brand's domain (its proved domain, or a test brand's given one) (400
`invalid_field` on `return`), and a code used twice or after ten minutes (410 `expired`). The server never learns who the person is to the service, and the service learns nothing of the person but the
connection.

### 27.10 What a client reads

In `GET /v1/member/tasks`, an ask that wears a brand carries `brand`: the brand as given, with `id`, `domain`, `verified`
(`true`; or `false` with `test: true`, 27.4), and a `url` on each picture state that serves it with no credential (`GET
/v1/brand_media/{m_...}`). An ask that carries contacts has `contacts` (27.7; `ref` never), and an ask in a group has `group` and `group_id` (27.8). An ask
withdrawn with `elsewhere` leaves `open` at once and stands in `history` with `"state": "withdrawn"`, `"answered_elsewhere": true`,
`withdrawn_at` and `withdraw_why`; a client says it was answered in the service.
`from` and the connection's name stay the server's and the person's: the brand never names who is asking.

### 27.11 Errors and registries

New error codes, in section 24's registry: `contrast_too_low`, `reserved_word`, `choices_differ`, `unknown_reference`,
`number_outside_contacts`, `brand_not_proved`, `group_full` (each 400, fixable; `brand_not_proved` names `Brand-Key`),
`contacts_not_allowed` (400, not fixable) and `has_contacts` (409, not fixable). Other refusals use 26.3's codes.

`GET /v1/brand_media/{m_...}` takes no key (add it to AUTH-1's list). The `price` block shows an amount and moves no money,
so it may name any currency; `expires_in` keeps 26.10's name for seconds; `POST /v1/brand/mark` and `POST /v1/tasks/media`
take the picture's bytes, not JSON.

Closed in this version: **mark glyphs** `disc`, `ring`, `square`, `frame`; **dressing places** `ink`, `ink_soft`, `rule`;
**corners** `square`, `round`; **consent statements** `they_contacted_the_asker`, `they_agreed_to_be_contacted`; **keyboards**
`text`, `number`, `phone`, `email`; **card blocks** 26.12's and `quote`, `contact`; **step types** 26.12's and `call`; **ask states** 26.12's and `withdrawn`.
These extend 26.12's closed lists for a server that lists `branded_asks`.
**The client's own words**, which no ask may use as a whole label: Done, Later, Not now, Undo, Report, Stop, Block.

### 27.12 Conformance for this section

A server that lists `branded_asks` conforms when it meets every `ASKS-` requirement except ASKS-25, which binds only a server
that offers 27.9. A service conforms when it meets every `ASKER-` requirement. A client conforms when it meets every `CARD-`
requirement against any server that lists `branded_asks`.

### 27.13 One branded ask, from end to end (informative)

Northside Motors' assistant holds a connection key that a person at the lot made for it (26.8). `northside.example` stands in
for Northside's real domain throughout: a reserved domain itself can be neither proved nor used for a webhook. Shapes are abridged to the fields
this section names; the server adds the others 27.2 lists.

1. **The brand.** `PUT /v1/brand` with the connection key:

   ```json
   { "brand": { "name": "Northside Motors", "domain": "northside.example",
       "mark": { "states": { "needs_you": { "glyph": "disc", "colour": "#e8590c" },
                             "idle": { "glyph": "ring", "colour": "#8f8f8f" } } },
       "colours": { "ink": "#0d0d0d", "ink_soft": "#5d5d5d", "rule": "#e6e6e6" },
       "grounds": { "light": "#ffffff" }, "corners": "round", "quiet_line": "Nothing needs you." } }
   ```

   It answers 200 with the brand, its `id`, `"verified": false` and `prove_it`:
   `{"token": "<token>", "file": "https://northside.example/.well-known/{{wire_prefix}}-brand", "txt_name":
   "_{{wire_prefix}}-brand.northside.example"}`.
2. **The proof.** Northside serves the token as one line of that file, then sends `POST /v1/brand/verify` with no body. It answers
   `{"domain": "northside.example", "verified": true, "verified_at": "...", "how": "file", "brand_id": "br_...", "brand_key":
   "bk_..."}`; the brand key is kept with Northside's other keys.
3. **The ask.** `POST /v1/tasks` with the connection key:

   ```json
   { "title": "Christmas Eve is Thursday, Dec 24. Are you open?", "urgency": "whenever", "expires_in": 1209600,
     "idempotency_key": "holiday:2026-12-24", "webhook": "https://northside.example/asks/answers",
     "card": { "blocks": [ { "headline": "Christmas Eve is Thursday, Dec 24." },
                           { "text": "Shoppers and callers will ask. Tell me once and the AI uses it." },
                           { "when_where": { "when": "Thu 24 Dec" } },
                           { "choices": ["Open as usual", "Closed", "Other hours"] } ] },
     "step": { "type": "question", "text": "Are you open?", "choices": ["Open as usual", "Closed", "Other hours"],
               "line_for": { "Other hours": "Your hours that day" } } }
   ```

   It answers 201 with `"task_id": "tk_..."`, `"state": "open"`, `"key": "holiday:2026-12-24"` and `"brand": {"id": "br_...",
   "name": "Northside Motors"}`. A repeat of the same request answers 200 with the same ask and `"repeated": true`.
4. **The person's phone.** `GET /v1/member/tasks` carries the ask with its `card`, its `step` and `brand` (the brand as given, with
   `id`, `domain` and `"verified": true`). The client draws the lit lamp, "Northside Motors  northside.example", who is asking, the
   headline, the line, the date, "Are you open?" and its own three answers, Done, Later and Not now.
5. **The answer.** The person chooses Other hours and types the hours; the client sends `POST /v1/member/tasks/{task_id}`
   `{"action": "answer", "choice": "Other hours", "text": "9 AM to 2 PM"}`, which answers 200 with `"state": "answered"` and the
   reply.
6. **The answer, sent.** The server posts to the webhook, signed (27.2):
   `{"task_id": "tk_...", "key": "holiday:2026-12-24", "state": "answered", "reply": {"action": "answer", "choice": "Other
   hours", "text": "9 AM to 2 PM", "note": null, "at": "..."}, "answered_at": "..."}`. Northside checks the signature, sets its
   hours for the 24th, and acts on that delivery id once.
7. **Clearing.** When an owner answers the New Year's Eve question in Northside's own app instead, Northside sends `POST
   /v1/tasks/{task_id}/withdraw` `{"why": "Answered in Northside Motors' own app.", "elsewhere": true}`, which answers 200 with
   `"state": "withdrawn"`; the person's client removes the ask without a word.

### 27.14 Changes to this section

- 16 Nov 2026, later: a worked example, from a brand to a cleared ask (27.13); only questions carry a group, and a client groups
  only one asker's asks (27.8, CARD-15); a contact with
  no name reads "the <role>", and two contacts with one role are numbered (CARD-12, CARD-13).
- 16 Nov 2026: written from the draft's Cards paragraph, tested against a first service's eighteen moments, and then against a
  second service's brand and three asks built from sections 1 to 8, 26 and 27 alone. Each place a builder had to guess was closed
  in the text: the shape of `prove_it` and of a verification, the webhook's signing key, retries and delivery id, what a repeated
  `idempotency_key` does and how long it binds, the keyboard of a choice's line, the meaning of "the asker" and of a long number,
  a group's scope and title, test brands by member, this section's requirement prefixes, lengths, urgencies a person disallowed,
  a proof file's line ends and redirects, `text` with the wrong choice, the webhook's content type, statuses, the API host,
  reserved domains, a refused name's code, the proof file's answer, a verify too often, a re-proved brand's id, which reply
  carries `contact_ref`, a group's first ask, failed webhook tries and a new webhook secret; five contradictions with sections
  2, 5, 7 and 26 were removed. One fault was fixed: Done on a call step meant both "I called" and "cleared without an answer";
  "Called" is now the call step's answer.
  After the merge, requirement numbers stay as they are and a new requirement takes the next number. ASKS-4 now matches the
  reference server, which keeps a withdrawn ask listed for a day so a person can see it was taken back; CARD-17 keeps clients
  from counting or answering it. Two rules were added on review: a brand may not be named like the person's own AI, and the
  client's words are compared with spaces and punctuation removed.
