## 26. The person client

One app where a person answers every AI in their life, and the people around them, on an open standard any service can
brand and anyone can build an app for.

Sections 9 to 18 describe a call from the agent's side. This section describes the person's side: the interface between a
call server and the app a person uses to answer, the **person client**. Through it a person receives calls, and also
**asks**: short questions and approvals from AIs the person connected themselves (a home camera, a car, a kitchen, a
business), and from people they know. An app that implements this section can serve any server's people; a server that
implements it can be served by any app, so a person can change app without changing server.

A server that offers this interface lists `person_client` under `features` in discovery (section 5) and keeps every rule
below marked for servers. A client keeps every rule marked for clients. Requirement identifiers beginning `MEMBER-` bind the
server; those beginning `CLIENT-` bind the client. The section's objects have schemas named `member_*.json`, with examples
taken from a live server's answers, and its routes are in the OpenAPI file under the tag `member`.

### 26.1 Who asks a person

- **The person's own AIs.** A person connects an AI by making a **connection** (26.8). Each connection is a principal of its
  own, named on every ask, with a key that does one thing: place asks on that person and follow them. Those asks reach
  nobody else, so the server checks them for size and for values shaped like secrets and reads nothing else. Their material
  is the person's own, kept encrypted and deleted on the person's schedule.
- **A principal with a call.** A call (section 9) reaches a person who is a member of the pool it names, as an **offer**
  (26.7).
- **A person.** A person may send asks to their own people: those who joined a panel from a link that person made (26.10).
  The ask arrives under the sender's name as the server holds it on the sender's account, never text the sender typed.
- **A person passing an ask on.** Any ask on a person's list may be passed on to one of their own people, with an optional
  line. The receiver's answer answers the original ask; the asker receives it as any answer, and never learns who the
  receiver is (section 13.2).

A person is a **member** of each panel or pool they joined. Each membership has its own credential and its own list of asks
and offers. A person who holds several memberships may keep them in one **account** (26.11).

### 26.2 Credentials, and where a client talks

The member routes live on the server's API host, under `/v1/member/`. Every request to them carries one of three bearer
credentials in `Authorization: Bearer ...`:

| Credential | How a client gets it | What it acts for |
|---|---|---|
| The **member credential** | `member_token` in the answer to a join (26.9); also the last path segment of the person's page link, `page` in the same answer | its one membership |
| An **account session** | a passkey sign-in (26.11) | any membership of the account, named on each request |
| A **computer session** | a code shown on a computer and approved from a device that holds the member credential (26.11) | the membership that approved it |

**[CLIENT-1]** A client MUST send a credential only in the `Authorization` header and MUST NOT put it into an address of its
own: its address bar, a link it makes or shares, a query string, or a log. A client that is handed the person's page link
takes the credential from the link's last path segment and then forgets the link. **[MEMBER-1]** A server MUST accept each
credential in the `Authorization` header on every member route it serves, and MUST NOT require one in an address.

**[MEMBER-2]** A server MUST answer cross-origin requests to `/v1/member/*`, `/v1/seats/*`, `/v1/account*` and `/v1/desk/*`
so that a client served from another host can work: `access-control-allow-origin: *` (credentials travel in a header, never
in cookies), allowing the headers `Authorization`, `Content-Type` and `X-Person-Member` and the methods GET, POST, PATCH,
PUT and DELETE, and answering a preflight with 204.

`GET /v1/member/settings` carries `member_id`, the membership's own identifier, for a client that needs to tell memberships
apart.

### 26.3 Errors on member routes

Member routes answer errors in the object of section 8. A client shows `message` to the person and acts on `code`:

| Status | `code` | Means |
|---|---|---|
| 400 | `invalid_field`, `missing_field`, `unknown_field` | fixable; `field` names it; `example` is a valid value where one exists |
| 404 | `not_found` | the identifier is not this membership's; on `GET /v1/member/tasks`, the credential no longer works |
| 409 | `already_answered` | the ask was answered already, on this or another device; nothing changed |
| 409 | `conflict` | the request conflicts with the state of what it names (26.11: a code stopped by a wrong number) |
| 410 | `expired` | what the request names has ended (26.11: a sign-in code) |
| 429 | `rate_limited` | too many requests; `retry_after_seconds` |

**[MEMBER-3]** A server MUST answer `GET /v1/member/tasks` with 404 `not_found` when the credential no longer works (the
person left, or the credential was replaced), and a client treats that answer, and no other, as "sign in again". The words of
`message` are not part of this text.

### 26.4 What a client does, and the operations

| The client | Operation |
|---|---|
| Learns what a panel is, then joins it | `GET /v1/join/{code}`, then `POST /v1/join/{code}` with the person's attestations (26.9) |
| Says whether calls may reach the person now | `POST /v1/member/on` (26.7) |
| Registers where to ring | `POST /v1/member/devices` (26.7) |
| Receives work | `GET /v1/member/offers` (calls), `GET /v1/member/tasks` (asks) |
| Answers an ask | `POST /v1/member/tasks/{task_id}` (26.5) |
| Shows an ask's material | `GET /v1/member/tasks/{task_id}/media` (26.5) |
| Takes or declines a call | the seat named in the offer: `/v1/seats/{seat_token}` (26.7) |
| Keeps the person's settings | `GET` and `PATCH /v1/member/settings` (26.8) |
| Connects, quiets, blocks and revokes the person's AIs | `/v1/member/connections` (26.8) |
| Blocks and unblocks any other asker | `/v1/member/blocks` (26.8) |
| Holds the person's receipts | `GET /v1/member/receipts` (section 15; 26.8) |
| Sends asks to the person's own people and reads what came back | `/v1/member/people`, `/v1/member/people/asks`, `/v1/member/sent` (26.10) |
| Passes an ask on | `POST /v1/member/tasks/{task_id}/pass` (26.10) |
| Mutes a person, and sets how many asks a person may send a day | `/v1/member/mutes`, `/v1/member/limits` (26.10) |
| Tells the server something about its service | `POST /v1/member/feedback` (26.8) |
| Leaves | `POST /v1/member/leave` (26.8) |
| Signs in with a passkey, or signs in a computer | `/v1/account/...`, `/v1/desk/...` (26.11) |

How a client lays asks out (a list, a deck of cards, a watch face) is its own choice. What each kind of ask offers, and what
every client shows, is not (26.5, 26.6).

### 26.5 Asks

**The list.** `GET /v1/member/tasks` answers

```json
{ "open":    [ <task>, ... ],
  "groups":  [ { "from": "Home camera", "task_ids": ["tk_1", "tk_2"] } ],
  "history": [ <task>, ... ] }
```

**[MEMBER-4]** `open` MUST hold the asks waiting for the person, most urgent first and oldest first within an urgency;
`history` holds the asks the person answered, newest answer first. `groups` gives the open asks by who is asking. The list may
also carry the fields of 26.10 (`notice`, `answers_to_read`, `passed_on`). `?history=N` asks for at most N answered asks (0
to 200); without it a server returns at most 50.

An ask (a task):

| Field | Type | Meaning |
|---|---|---|
| `task_id` | string | its identifier |
| `title` | string, 3 to 120 characters | a few words naming the ask |
| `urgency` | `now`, `today` or `whenever` | in that order; `now` puts it first and marks it, and never means a sound by itself |
| `from` | string | the name to show as who is asking: the connection's name, or the principal's |
| `connection` | `{ "id", "name", "icon", "yours" }` | the AI that asked; `yours` is true only for an AI this person connected themself |
| `step` | object | what is asked and how it may be answered (below) |
| `unlocks` | string, up to 300 characters | what the answer lets the asker do; shown with the ask |
| `created_at`, `expires_at` | times | when it was asked; when it lapses unanswered (an ask lapses after 30 days at most) |
| `state` | `open`, `answered`, `done`, `not_now`, `lapsed` | below |
| `reply` | `null` or the reply | below |
| `notes` | array | the note thread, oldest first |
| `card` | optional `{ "blocks": [...] }` | the asker's layout (26.6) |
| `brand` | optional | the asker's brand, once it has proved its domain (26.6) |
| `media` | optional | a photo or clip sent with the ask (below) |
| `sender`, `passed_on_by` | optional | an ask from a person, or passed on by one (26.10) |
| `shell_only` | optional string, on a command | the server's sentence that only the person can run it |

An ask carries no estimated time. A client that sorts by speed sorts by the kind of answer (a choice is quicker than a line,
a line than a link or a command) and says so.

**Steps and the answers each takes.**

| `step.type` | Fields | The client offers | Shown as |
|---|---|---|---|
| `question` with `choices` | `text`; `choices`: 2 to 4 strings | `answer` with `choice`; `not_now`; `note` | the question and its choices |
| `question` without `choices` | `text` | `answer` with `text` (1 to 4,000 characters); `done`; `not_now`; `note` | the question and a field |
| `link` | `url` (https), `text` (what to do there), optional `domain`, `sign_in_page` | `done`; `not_now`; `note` | where it goes and what to do there; it opens without losing the ask |
| `command` | `command` (the exact line), `where` (where to run it) | `done`; `not_now`; `note` | the exact line, copyable, where to run it, and that only the person can run it |
| `approve` | `text` (exactly what will be done), `approve_label`, `deny_label` (the ask's own words on its two answers; "Approve" and "Deny" when the asker gave none), `editable` | `approve` (with `text` when `editable` and changed); `deny`; `not_now`; `note` | what is asked, with its own words on its two answers |

**[CLIENT-2]** A client MUST offer every answer in its row and no other answer, and MUST offer Not now on every ask. Not now
is never held against the person. A server MAY accept more than the table offers; a client never relies on it. **[MEMBER-5]**
A server MUST answer an action the step does not take with 400 `invalid_field` on `action`, naming the actions it takes; a
`choice` that is not one of `choices` with 400 on `choice`; and `text` with `approve` on a step that is not `editable` with
400.

**Answering.** `POST /v1/member/tasks/{task_id}` with `{"action", "choice", "text", "note"}`, sending only the fields the
action uses. `note` (1 to 2,000 characters) may ride with any answer. It answers `200 {"task_id", "state", "reply"}`, where
`reply` is `{"action", "choice", "text", "note", "at"}`, plus `approved_text` (the words approved, edited or not) after
`approve`. `answer`, `approve` and `deny` give the state `answered`; `done` gives `done`; `not_now` gives `not_now`. The
asker reads the same reply. **[MEMBER-6]** A value shaped like a secret key in `text` or `note` MUST be stored as
`[removed]`, and the reply then carries `masked`, a sentence saying so.

**[CLIENT-3]** No route takes an answer back. A client that offers undo MUST hold the request on the device until its undo
time ends, and MUST send it at once if the client is closing. A "later" pile is a client's own: nothing is sent, and the asker
is not told.

**Notes.** A note alone, `{"action": "note", "note": "..."}`, answers `200 {"task_id", "state": "open", "notes"}`: the ask
stays open, and a client shows it as a note, not an answer. `notes` is `[{"at", "note", "by", "name", "private"}]`, where
`by` is `person` (this person), `asker` (the AI or person who asked), or `passer` (the person who passed the ask on, 26.10).
The asker may answer a note with one line, which appears with `by: "asker"`; a client shows who wrote each line and marks an
ask whose last line is the asker's. **[MEMBER-7]** A thread takes notes only while the ask is open: once it is answered,
lapsed or withdrawn, a note from either side MUST be refused with 409 `already_answered`, and the client offers a new ask
instead.

**Material.** An ask carries at most one photo or short clip, described as `"media": {"kind", "content_type", "bytes",
"seconds", "deleted_at"}` (`deleted_at`: when the person's schedule deletes it). **[MEMBER-8]** `GET
/v1/member/tasks/{task_id}/media` MUST return the bytes with their content type and `cache-control: no-store, private`, and
404 `not_found` when the ask has none or it was deleted. **[CLIENT-4]** A client fetches material with the credential in the
header, shows it from memory and MUST NOT store it.

### 26.6 What every client shows, approvals, and cards

**Who is asking.** **[CLIENT-5]** On every ask a client MUST show who is asking, drawn by the client from `from` with its
basis (for an AI the person connected, "your AI, you connected it"; for a person, 26.10), what the answer unlocks, and the
urgency. A brand never names who is asking.

**Before a call is accepted.** **[CLIENT-6]** Before the person takes a seat, a client MUST show that an AI is asking, the
principal who answers for the call and the basis of that claim, the content rating, the estimated minutes and the pay or that
it is unpaid (FAIR-6 lists what a server that declares the fair-call profile shows). A client never sends the person's
identity to an asker.

**Sound.** **[CLIENT-7]** A client MUST NOT make a sound for an ask or a call when the person's settings say none (26.8).

**Approvals.** An approval is worth what the asker's own guard can check. A tap in an app is the person's word to the server,
not to the asker's permission system. A server that offers signed answers (a key the person's device made, its signature
over exactly the approved text and the time) marks a signed approval `"device_approved": true`. **[MEMBER-9]** A server MUST
accept an approval sent without a device signature and MUST mark it `"device_approved": false` with a `mark` saying it
carries no device signature, both in the person's reply and in what the asker reads; the asker's guard decides from
`device_approved` which approvals it accepts. **[CLIENT-8]** A client that cannot sign MUST tell the person, on the ask, that
its approval is not signed. A server that offers signed answers takes the device's public key with its platform's
attestation at `POST /v1/member/device_key`, and a signature over the digest of exactly what was approved, and when, at
`POST /v1/member/signatures`; the shapes of both are left for a later version (Appendix A).

**Cards.** An asker may design how its asks look, as data, never as code. The **brand** belongs to the asker's principal and
is given once: a `name`; a `mark` (one picture, optionally with pictures for the ask's states `idle`, `needs_you`,
`answered`); `colours`, each `{"value": "#rrggbb", "means": "..."}` and used only for what it means, never as decoration; and
`grounds` (`light`, `dark`). A name alone is a complete brand. The **layout** belongs to the ask: `card.blocks`, an ordered
list from a fixed set (`headline`, `text`, `media`, `facts` (label and value rows), `price`, `when_where`, `choices`,
`input`), followed by the ask's own answers.

```json
{ "card": { "blocks": [ { "headline": "Thanksgiving is Thursday." }, { "text": "Are you open?" } ] },
  "step": { "type": "question", "text": "Are you open on Thanksgiving?", "choices": ["Open as usual", "Closed"] } }
```

A brand proves that its principal controls the domain it names (the server tells the asker how: a file it names on that
domain, or a DNS record) before any card carries it. **[MEMBER-10]** A server MUST NOT put a `brand` on an ask until its
domain is proved; it then carries `"brand": {"name", "mark", "colours", "grounds", "domain", "verified": true, "mark_url"}`,
where `mark_url` serves the mark as an image with no credential.

**[CLIENT-9]** A client draws the blocks in order and ignores a block it does not know. A card's `media` block stands for the
ask's own material, drawn where the block stands, or after the other blocks when there is none. A client MUST NOT run anything
a card carries (there are no scripts and no remote code), shows pictures only from the server, and MUST draw a brand's text
and colours only where they meet a contrast of 4.5:1 on the ground they are drawn on, using its own colours otherwise.
Whatever the brand, a client keeps for itself: who is asking, undo, a device's own check before a signed approval, the
evidence marks, and every label this section names. A brand may dress a card; it may not pass for another principal, hide
what an answer does, or remove a label.

### 26.7 Calls on the person's side

**On and Off.** `POST /v1/member/on` with `{"on": true, "until": "<time>"}`, `{"on": true, "hours": <number>}` or `{"on":
false}` answers `{"member_id", "on": "on_until" | "off", "on_until"}`. **[MEMBER-11]** On MUST end by itself: it lasts at most
12 hours (a longer `until` or `hours` is cut to 12), and 2 hours when neither is given. `on` is a boolean. Off means no call
reaches the person; their AIs' asks arrive either way.

**Offers.** `GET /v1/member/offers` answers the person's ring state and the calls held for them: `member_id`; `on` and
`on_until` (as below); `quiet` and `settings` (`longer_hold`, `sounds`; 26.8); `silent` (true when alerts make no sound);
`ring_cap` (`used`, `limit`, `resets_at`, `applies`: how many times the person was rung in the last hour, the most allowed,
when the count falls, and whether the cap applies to this person); `missed_rings` (rings in a row that reached nobody);
`quiet_now`; `next_ring_at` (the earliest a call could reach the person, given On and quiet hours); `calls_waiting` (calls on
the person's panel that could reach them); `calls_not_reached` (offers in the last day that lapsed without reaching them,
which count for nothing against them); `offers`; `checked_at`; and `look_again_after_seconds`. An offer: `{"seat_id",
"call_id", "state", "ask", "kind", "minutes", "pay": {"per_person_usd", "unpaid_test"}, "asker": {"name"}, "notification",
"held_until", "seat_token", "seat_url"}`, where `notification` is the line an alert for it shows. An offer does not carry all
that a client shows before acceptance (CLIENT-6): the client reads the seat, `GET /v1/seats/{seat_token}`, which answers
`seat_id`, `call_id`, `status`, `offer_expires_at`, `deadline`; who answers for the call (`asker`: `name`, `note`) and
`asker_is_ai`; `ask` and `minutes`; `pay` (`per_person_usd`, `unpaid_test`, `per_hour_usd`, `test_money`); `content_rating`;
what is `recorded` (plain lines) and how long it is `kept` (`answers_days`, `record_days`, `recordings_days`, `note`; and
`kept_days`, the longest); `download_bytes`; `may_train_on_answers`; the `experience` (`kind`, `text`, `items`, `media_id`,
`media_ids`, `media_url`, `seconds`); its answer `fields`; the `panel` (`name`, `members`, `anonymous`); `simulated_person`;
`report`, how to stop the call because it upset the person; and, once the seat is answered, `evidence` and `paid_usd`.

**Taking a call.** A client opens `seat_url`, the server's own page for that seat, where the person starts the call and the
server records what section 10 says. A client that runs the experience itself is left for a later version (Appendix A). A
seat token names one seat on one call and stops working when the seat ends; unlike a member credential it may travel in an
address (SEC-3).

**Declining.** `POST /v1/seats/{seat_token}/stop` with `{"reason": "decline"}`, before the seat is taken. **[MEMBER-12]** A
decline MUST be free, MUST leave no mark against the person, and the call MUST NOT be offered to them again; the offer leaves
`GET /v1/member/offers`.

**Reaching the person.** `POST /v1/member/devices` with `{"apns_token", "environment"}` (`environment` is `sandbox` for a
development build) registers an Apple device for alerts. 0.1 defines no other push. **[CLIENT-10]** A client that receives no
push looks again by itself, at most as often as `look_again_after_seconds` says for offers and every 15 seconds or more for
asks while it is in front, and at once when it comes back to the front.

**Words in alerts.** A person may choose to see the first line of an ask in their own alerts: `alert_words` in the settings,
off by default and theirs alone; no asker or sender can set it. A server MAY offer it to some members only: to the others it
is absent from the settings, and changing it answers 403. **[MEMBER-13]** The words MUST NOT travel in a push: an alert
carries only who is asking and an identifier. The client fetches the rest with `GET /v1/member/tasks/{task_id}/alert`, which
answers `{"from", "passed_on_by", "note"}` (`passed_on_by` only for an ask passed on), with `line` added when the setting is
on: a first line of at most 80 characters, cut at a word. A client obeys the device's own setting for showing previews.

### 26.8 Settings, the person's AIs, blocks, receipts, leaving

**Settings.** `GET /v1/member/settings` answers `{"member_id", "quiet": {"start", "end", "tz"}, "settings": {"sounds",
"longer_hold", "material_days", "alert_words"}, "note"}`. `PATCH /v1/member/settings` takes any of `sounds` (false: no app of
the server's makes a sound for this person), `longer_hold` (true: an offer held for this person for less than three minutes is
held for three), `quiet_start` and `quiet_end` (whole hours 0 to 23 in `quiet.tz`; no call reaches the person between them),
`tz` (the person's time zone, an IANA name such as `America/Chicago`), `material_days` (1 to 30: how long the person's AIs'
photos and clips are kept) and `alert_words`, and answers with the whole object. An unknown field is 400 `unknown_field`.

**The person's AIs.** `POST /v1/member/connections` with `{"name", "icon"}` (`name` 2 to 40 characters; `icon` one of `home`,
`chef`, `car`, `business`, `lab`, `other`, one emoji, up to three letters, or an https address of a picture) answers 201 with
the connection and, shown once, the AI's `key`, a `link` with the same power, a `webhook_secret` that signs what is posted
back to the AI, a `note`, and `how` (`key_use`, `link_use`, `step_examples`: words and sample steps a client may hand the
person to give their AI). A connection is `{"id", "connection_id" (the same), "name", "icon", "made_at", "last_used_at",
"quiet", "blocked", "revoked_at", "lab", "urgencies", "icon_url"}`, where `lab` is true for a connection the server made
itself for a program it runs, and in the list (`GET /v1/member/connections`, `{"connections": [...], "limit"}`) also
`asks_waiting`. `PATCH /v1/member/connections/{id}` takes `quiet` (its asks never ring), `blocked` (it hears only "not
available") and `urgencies` (the urgencies this AI may use). **[MEMBER-14]** A connection's key MUST be able to do nothing but
place asks on its person, follow them (their replies and notes) and withdraw them, and `DELETE /v1/member/connections/{id}`
MUST stop the key at once and withdraw its open asks; a revoked connection stays in the list with `revoked_at`. A picture sent
as an address is copied by the server into its own storage (an image of at most 256 KB); the connection then answers `icon:
null` and `icon_url`, an address on the server read with the member's credential. A client draws `icon_url` from the server
and never loads the AI's own address.

**Blocks.** `POST /v1/member/blocks` with `{"call_id"}` or `{"task_id"}` blocks the asker of that call or ask, and answers 201
`{"block_id", "name", "since"}`; `GET /v1/member/blocks` answers `{"blocks": [{"block_id", "name", "since"}]}`; `DELETE
/v1/member/blocks/{block_id}` unblocks (`{"block_id", "removed": true}`); a new block's answer also carries `covers` (how many
open asks and calls it took off the list) and a `note`. **[MEMBER-15]** A blocked asker MUST be told only that the person is
not available. The person's own AIs are blocked on their connection instead.

**Receipts and feedback.** `GET /v1/member/receipts` answers `{"member_id", "receipts": [...], "verify", "test_money"}`, the
person's signed receipts (section 15). `POST /v1/member/feedback` with `{"text"}` (1 to 2,000 characters) reaches the people
who run the server, and answers 201 `{"stored": true, "note"}`.

**Leaving.** `POST /v1/member/leave` with `{"confirm": true}` (without it, 400 `missing_field` on `confirm`) answers `{"left":
true, "deleted": {"answers", "records", "receipts", "feedback"}, "link", "kept"}`: how many of each were deleted, that the
link no longer works, and in `kept` a sentence on what is kept and why. **[MEMBER-16]** Leaving MUST end the membership for
good and delete what it held of the person's except what `kept` names with its reason; afterwards the credential answers 404
everywhere. A client offers to save the receipts first.

### 26.9 Joining

`GET /v1/join/{code}` answers the panel and who asks through it: `{"panel": {"name", "members", "anonymous"}, "own", "asker",
"principal_name", "owner", "notice_id", "accepted_notice_ids", "notice_url", "attestations"}`. `own` is true for a principal's
own panel (16.1); `asker` is the name the person will see and `principal_name` the principal's checked name; `notice_url` is
the notice the person accepts, `notice_id` its current version and `accepted_notice_ids` the versions the server still takes;
`attestations` is `{"send": {...}, "optional": [...], "means"}`, the exact object to send once the person has said each thing
in it is true. When a person owns the panel, `owner` is `{"name", "line", "shown"}`: **[CLIENT-15]** the client MUST show
`owner.line` ("<name> can send you tasks and questions here; you can mute or leave at any time") before the person joins, and
then sends `"owner_line_seen": true` with the join. `POST /v1/join/{code}` with those attestations answers 201 `{"member_id",
"member_token", "page", "panel", "on", "note"}`. Every person is an adult (section 16), so `send` always holds `"adult":
true`; a server names any other statement it needs there, such as where the person lives.

### 26.10 Asks between people

**A person's own people.** `GET /v1/member/people` answers `{"name", "people": [{"member_id", "name", "joined_at", "state":
"joined"}], "waiting": [{"name", "sent_at", "state": "not yet", "resend"}], "note"}`; `name` is the sender's own name as the
server holds it. A join link is shown once, when made: `POST /v1/member/people/links` with `{"label"}` answers 201 `{"label",
"join_url", "for_them", "note"}`, and making a new one for the same label stops the old. `resend` on a waiting person is that
request, ready to send.

**Sending.** `POST /v1/member/people/asks` with `{"to": ["<member_id>", ...], "title", "step", "urgency", "expires_in",
"card"}` places one ask on each person named, each answered on its own, and answers 201 `{"from", "sent": [{"to", "name",
"task_id"}], "not_sent", "read"}`: `from` is the name the receivers see, and `not_sent` lists anyone it could not reach, with
why. **[MEMBER-17]** A server MUST give an ask from a person `"sender": {"name", "kind": "person", "behind"}`, where `name` is
the sender's name as held on their account (never text typed into the ask) and `behind` one sentence on what stands behind it;
MUST give a link step its real `domain`, MUST refuse a link whose shown text names another address, and MUST mark a sign-in
page with `"sign_in_page": true`. Asks between people follow the rules of a person's own AIs: checks for size and secret
values only, material kept encrypted on the receiver's schedule, and no money.

**What came back.** `GET /v1/member/sent` answers `{"sent": [thread], "passed": [thread with "from", "passed_at"]}`, a thread
being `{"task_id", "to": {"member_id", "name"}, "title", "step", "urgency", "created_at", "expires_at", "state", "reply",
"answered_at", "notes", "new"}`. The sender adds a note with `POST /v1/member/sent/{task_id}/notes` and `{"note"}`, while the
ask is open (MEMBER-7). `new` is true when an answer, or a note from the receiver, arrived after the sender last marked the
thread read; reading the route marks nothing, and `POST /v1/member/sent/read` with `{"task_ids": [...]}` (at most 80) marks
those threads read on every device, answering `{"read": <how many>}`. The sender's `GET /v1/member/tasks` also carries
`answers_to_read`, each `{"task_id", "title", "from", "reply", "state", "at", "read"}` (`read` names where the whole thread is
read), until they are marked read.

**The receiver's side.** **[CLIENT-11]** A client MUST say that a person is asking, show `sender.name` and `sender.behind` as
the server gives them, show a link's `domain` beside it, and say when a link opens a sign-in page. A person who joined before
a server let people send asks is told once: while `GET /v1/member/tasks` carries `"notice": {"text", "from", "read", "mute",
"leave"}`, **[MEMBER-18]** the server MUST list no ask from a person; the client shows `text` with an OK, which sends `POST
/v1/member/people/notice`, and with Mute (the body in `mute`) and Leave beside it.

**Muting, and a daily limit.** `POST /v1/member/mutes` with `{"task_id"}` mutes the person who sent that ask, with
`{"task_id", "passer": true}` the person who passed it on, and with `{"panel_owner": true}` the panel's owner. A muted
person's asks never ring and are still listed. A new mute answers 201 `{"mute_id", "name", "note"}`;
`GET /v1/member/mutes` answers `{"mutes": [{"mute_id", "name", "since"}]}`; `DELETE /v1/member/mutes/{mute_id}` unmutes
(`{"mute_id", "removed": true}`). `GET /v1/member/limits` answers `{"asks_per_person_per_day", "note"}`, and
`POST /v1/member/limits` with `{"asks_per_person_per_day"}` (a whole number from 0 to 100) sets it. Over the limit, a person's
asks wait for the receiver's next day and the sender is told; nothing is dropped, and only the receiver sees the limit.

**Passing an ask on.** `POST /v1/member/tasks/{task_id}/pass` with `{"to": "<member_id>", "note"}` moves the ask to one of the
person's own people. It arrives with the original `from`, `connection` and `step`, and `"passed_on_by": "<the passer's
name>"`; on the receiver's copy `connection.yours` is false and carries no identifier. The passer's line arrives as a note
with `"by": "passer"`, `"name"` and `"private": true`. **[MEMBER-19]** A private note MUST NOT reach the asker, and the
receiver's identity MUST NOT reach the asker (PRIV-1). **[CLIENT-12]** A client MUST show a passer's note under the passer's
name, never as the person's own. The passer's `GET /v1/member/tasks` carries `"passed_on": [{"task_id", "title", "from",
"passed_to", "passed_at", "state", "reply"}]`.

A client that answers a two-choice ask from the keyboard SHOULD keep a choice that reads as yes on its yes key and one that
reads as no on its no key, whatever order the asker wrote them in.

### 26.11 Signing in

**With a passkey.** A person's account holds their memberships and passkeys. `POST /v1/account/login/options` (no body)
answers `{"challenge_id", "publicKey"}`, the WebAuthn request options with `challenge` and any credential identifiers in
base64url. The client decodes them, calls `navigator.credentials.get({publicKey})` and sends `POST /v1/account/login` with
`{"challenge_id", "credential": {"id", "rawId", "type", "response": {"clientDataJSON", "authenticatorData", "signature",
"userHandle"}}}`, each binary field in base64url (`userHandle` may be null). The answer is `{"session", "person_id",
"expires_at", "note"}`, where `session` is an account session; `POST /v1/account/logout` with it ends it. The relying party is
the server's own domain, so a client on any of its hosts can sign in.

**[MEMBER-20]** An account session MUST act on `/v1/member/*` only for a membership the request names, in the header
`X-Person-Member` (or the query `member`): a membership that is not the account's answers 404, and a request that names none
answers 400. `GET /v1/account` (with an account session, or a member credential whose membership belongs to an account)
answers `{"person_id", "handle", "made_at", "memberships": [{"member_id", "panel", "asked_by", "name_on_panel", "on",
"joined_at"}], "passkeys": [{"id", "name", "made_at", "last_used_at", "synced"}], "devices": [{"member_id", "apple_push",
"web_push"}], "open_case"}`, where a passkey's `id` is shortened for display and `open_case` says what recovers an account
when every device is lost; with a member credential whose membership belongs to no account, 404, and the client
offers to add a passkey. **[CLIENT-13]** A client MUST NOT choose a membership for the person by a name, and tells memberships
apart by `member_id` and `joined_at`, never by `name_on_panel` alone: one person's memberships may share a panel and a name.

Adding a passkey: `POST /v1/account/passkey/options` (signed in by the member credential while the account has no passkey,
otherwise by an account session) answers `{"challenge_id", "publicKey"}`, the WebAuthn creation options in base64url; the
client calls `navigator.credentials.create({publicKey})` and sends `POST /v1/account/passkey` with `{"challenge_id",
"credential": {"id", "rawId", "type", "response": {"clientDataJSON", "attestationObject", "transports"}}}`. Another
membership joins the account only when the person, signed in, presents that membership's own credential: `POST
/v1/account/memberships` with `{"member_credential"}`. A membership never joins an account by a name.

**A computer, from a device that holds the membership.** A computer with no credential asks for a code: `POST
/v1/desk/sign_in` (no body, no credential) answers 201 `{"code", "qr", "poll", "number", "expires_in"}`. **[CLIENT-14]** The
client MUST draw `qr` exactly (the code and nothing else) as a QR code, show `number` beside it, keep `poll` in memory only,
and ask for a new code after `expires_in` seconds. The person scans the code with the app that holds their membership, picks
on it the number the computer shows, and that app sends `POST /v1/member/desk/approve` with `{"code", "number"}` and its
member credential. **[MEMBER-21]** A missing or wrong number MUST stop the code (409 `conflict`) and sign nothing in. The
computer asks `GET /v1/desk/sign_in/{poll}` every two seconds or more: 202 `{"waiting": true, "expires_at"}` until the code is
approved; 200 `{"session", "member_id", "note"}` once, where `session` is a computer session; 410 `expired` when the code ran
out, was used or was stopped; 429 when asked too often. A computer session acts on `/v1/member/*` for the membership that
approved it, with no `X-Person-Member`; it lasts until it is unused for 30 days or is signed out, and `POST /v1/desk/sign_out`
with it ends it. `GET /v1/member/desk/sessions` answers `{"sessions": [...]}`, the computers signed in for the membership, to
the member credential, and read only to a computer session. **[MEMBER-22]** Approving a code, and signing out another
computer, MUST need the member credential (403 for a computer session).

### 26.12 Registries for this section

Closed in 0.1, as in section 24:

- **Step types:** `question`, `link`, `command`, `approve`.
- **Actions on an ask:** `answer`, `done`, `not_now`, `approve`, `deny`, `note`.
- **Ask states:** `open`, `answered`, `done`, `not_now`, `lapsed`.
- **Urgencies:** `now`, `today`, `whenever`.
- **Note authors (`by`):** `person`, `asker`, `passer`.
- **Card blocks:** `headline`, `text`, `media`, `facts`, `price`, `when_where`, `choices`, `input`.
- **Brand mark states:** `idle`, `needs_you`, `answered`.
- **Connection icons:** `home`, `chef`, `car`, `business`, `lab`, `other`, one emoji, or up to three letters; a picture is
  given as an https address, which the server copies in and serves as `icon_url` (26.8).
- **Error codes** added to section 24's: `already_answered` (409, not fixable: the ask was answered already, or no longer
  takes notes), `conflict` (409, not fixable: the request conflicts with the state of what it names), `expired` (410, not
  fixable: what the request names has ended).

### 26.13 Conformance for this section

A server that lists `person_client` conforms to this section when it meets every requirement marked `MEMBER-`. A person client
conforms when it meets every requirement marked `CLIENT-` against any server that lists `person_client`. A client may offer
less than the whole interface (one that answers asks and never joins a panel, say) and conforms for what it offers, as long as
everything it shows and sends keeps these rules.

### 26.14 Changes to this section

Most of these came from building a desktop client from this section's text alone. Each place where the builder had to guess,
probe a live server or read a server's code was a gap, and each gap was closed in the text; fifty-two were closed.

- 16 Nov 2026: words in alerts, with the words never in a push (26.7). Where a client finds an asker's brand (26.6). Asks
  between people as the receiver sees them: the sender's checked name, the one-time notice, mutes, the daily limit and asks
  passed on (26.10). The account and passkeys, and signing a computer in from a device (26.11). On's length (26.7). Notes stop
  at the answer, and `new` holds until a thread is marked read (26.5, 26.10).
- 15 Nov 2026: a person as asker, and passing an ask on (26.1, 26.10). Declining a call, approvals from a client that cannot
  sign, and the join's attestations (26.6, 26.7, 26.9). Passkey sign-in reaching the member routes (26.11). The shape of an
  ask, its steps and the answers each takes, field limits, answering and the reply, undo and "later", notes, material, the
  page link and the credential, cross-origin requests, errors, settings, connections, blocks, offers and the seat a client
  reads before acceptance, leaving, and how a client learns of new asks (26.2 to 26.9). The section itself, with its table of
  operations, the kinds of ask and the answers each offers, and cards.
