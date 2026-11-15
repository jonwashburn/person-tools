## 16. People, pools and selectors

**[PEOPLE-1]** A person is an adult. A server MUST NOT offer a seat to anyone who has not stated, before their first
seat, that they are an adult (in 0.1 the person's own statement is enough), and MUST refuse a call aimed at children (`refused_screening`, category `minors`).

**[PEOPLE-2]** `person_ref` MUST be the same for the same person on every call from the same principal, and MUST differ
between principals, so that one principal can ask the same person again without anyone being able to join two
principals' records. It MUST NOT be derivable from the person's identity by anyone but the server.

**[PEOPLE-8]** A server MUST offer a call to a person at most once. A person holds at most one seat on a call, and a
person who declined, missed or stopped a seat is not offered that call again, even when nobody else can be rung. (A
person whose offer the server withdrew, or whose offer the server could not deliver to them, said no to nothing and may
be offered the call again; the seat that lapsed undelivered still ends `missed`.) So the responses of one
call come from different people, and no two responses carry the same `person_ref`; a response delivered again under
RES-9 is the same response. A router that passes one call to several pools, or to one pool in several parts, keeps
this within each pool by that pool's own reference for a person, since it cannot tell one pool's person from another's.

### 16.1 Pools

| `pool` | Who | 0.1 |
|---|---|---|
| `simulated` | Scripted people (section 18). | Every server, every key. |
| `panel:<panel_id>` | People a principal invited by link, its own panel. | A server that lists `panel` in discovery. |
| `<name>` | Any other pool the server lists in discovery under `pools`, such as an outside panel it reaches. | Optional. |

An unknown pool is `unknown_pool`, fixable, with one pool the key may use as `example` and all of them in `pools`. Pool
names are lower case; `panel` alone is a pool type in discovery, never a pool in a call. **[PEOPLE-3]** A server MUST
NOT list in discovery a pool through which it cannot complete a call.

**[PEOPLE-4]** On a panel of fewer than five people (counted when the seat is offered), the people are told before taking a seat that their answers cannot
be anonymous, and the results carry `summary.small_panel: true`.

### 16.2 Selectors

`require` selects people by claims about them. Each key holds a list of accepted values; a person matches when, for
every key, their claim is one of the values.

| Key | Values |
|---|---|
| `country` | ISO 3166-1 alpha-2 codes (`"US"`) |
| `region` | ISO 3166-2 codes (`"US-TX"`) |
| `language` | BCP 47 language tags (`"en"`, `"es"`) |
| `age_band` | `"18-24"`, `"25-34"`, `"35-44"`, `"45-54"`, `"55-64"`, `"65+"` |
| `device` | `"phone"`, `"tablet"`, `"desktop"` |

Any other key is written under the domain of whoever defines it (`"example.org/plays_instrument"`) and is passed to
the pool that knows it. **[PEOPLE-5]** A key the server does not know is `unknown_selector`, fixable; a key the pool
cannot apply is `selector_unsupported`, fixable. A free-text wish such as "plays an instrument" is not a selector: ask
it as an answer field, and the person is paid for answering it.

Each claim has a basis: `self` (the person said so), `observed` (the server saw it, such as a device), `document`
(checked against an identity document), `vouched` (a third party vouches for it), `earned` (read from the person's own
receipts). Under `detail=full` each response carries the claims it was selected on, each with its basis, at the coarsest
value that answers the selector.

**[PEOPLE-6]** On a pool of people the server does not invite one by one (not the simulated pool, and not a panel), a `require` that would match fewer people
than the `privacy_floor` in discovery (at least 20) is `privacy_floor`, fixable by widening it. A router that cannot
learn how many people an outside pool's selector matches answers `selector_unsupported`. **[PEOPLE-7]** A server
MUST NOT offer selectors on health, religion, sexuality, ethnicity, immigration or politics in 0.1.

## 17. Screening

A call is read before anyone is asked. Some calls are refused; some are held for a person to read.

- **[SCREEN-1]** A server MUST screen every call, and every outcome line, before any real person is offered a seat or
  shown the line. Quotes are screened by the same rules: a call that would be refused is refused at the quote, so an
  agent learns it before it asks its user for money. What a server holds for review, beyond what this text requires, is
  its own policy (SCREEN-5).
- **[SCREEN-2]** Screening fails closed. A real person is offered a seat only when screening explicitly allowed the call.
  A call that a rule refuses is refused (SCREEN-3). A call that screening cannot decide, or cannot run on (an error, a
  timeout, a missing rule), MUST be held (SCREEN-4), never opened to real people and never answered with `internal`.
- **[SCREEN-3]** A refused call is the error `refused_screening`, with `rule` (the rule that refused it), `category` (from
  the registry in section 24), `rule_text` (the rule in one plain sentence) and `fixable`. When the purpose itself is
  barred, `fixable` is false and `message` tells the agent to stop and tell its user, and not to send the request again
  in other words. When only a part is barred (a field asking for an email address, say), `fixable` is true, `field`
  names it, and `example` is that field corrected, or `null` to remove it.
- **[SCREEN-4]** A held call opens in the state `held`, with `held_reason` (one plain sentence), `held_rule` (the
  server's own rule id), and `review_by`, the time by which it will be allowed or refused, never later than the call's
  deadline. Nobody is offered a seat while it is held. If it is not reviewed by `review_by`, it becomes `refused` and
  costs nothing.
- **[SCREEN-5]** A server MUST publish the policy screening applies, at the address `screening_policy` in discovery.
- **[SCREEN-6]** Calls on the simulated pool are screened by the same rules. A refusal is the same error. A call that
  would be held opens and runs on simulated people, with `summary.would_be_held: true` and the `held_reason`, so that an
  agent learns, free, what a real call would meet. A quote on any pool says the same (`would_be_held`, `held_reason`)
when the call would be held, including when screening could not run.

The categories every server refuses when it recognises them, at the least (the registry may add more); a call it
cannot classify it holds (SCREEN-2):

| Category | A call that asks people to... |
|---|---|
| `credentials` | give or use passwords, one-time codes or keys |
| `accounts` | make, verify or hand over accounts |
| `paid_engagement` | follow, like, review, rate or post somewhere for pay |
| `impersonation` | pose as someone else |
| `third_party_contact` | contact anyone outside the call |
| `personal_data` | give their own contact details or identity, or collect personal data about named people |
| `off_platform` | move to another platform or contact the asker directly |
| `sexual` | see or make sexual material |
| `minors` | involve, aim at or reach children |
| `ban_evasion` | get round a ban or a limit |
| `deception` | take part in a scam, or test one on others |
| `physical_world` | do anything away from the screen |
| `outside_material` | follow a link, or open material, outside the server (fixable: send the material as `content`) |
| `violent`, `medical`, `grief` | see violent, medical or grief material, warned or not (0.1 refuses these outright; a later version may allow them with warnings) |

**[SCREEN-7]** Every server MUST refuse, or hold, each forbidden case in the published screening fixtures (and MUST
refuse, not hold, those in the categories `minors`, `sexual`, `violent`, `medical` and `grief`), and MUST NOT
refuse any of the allowed cases there (`screening_fixtures.json`, beside this text). The fixtures are labelled stand-ins
(such as "[TEST: asks the person for a one-time login code]"), never real abusive material. The file is part of this
standard and is published with it. They are a floor, not the
policy: each server's own policy (SCREEN-5) refuses more.

## 18. The simulated pool and test keys

Every call server has a pool of scripted people. It is how an agent tries the whole exchange free, and how a test suite
drives every state of a call without a human.

- **[SIM-1]** A server MUST accept `pool: "simulated"` on a test key, and SHOULD on a live key.
- **[SIM-2]** Every simulated response MUST carry `simulated: true`, the summary of a call with any simulated response
  MUST carry `simulated: true`, and every `text` answer a simulated person gives MUST begin with `[simulated] `, so that
  the label travels with the words wherever an agent copies them.
- **[SIM-3]** A simulated call moves no real money, whatever the key: its money is test money (`test_money: true`),
  moved exactly as a real call would move real money, so that holds, caps and settlement can be tried.
- **[SIM-4]** A simulated person's record is computed by the same rules as a real person's (sections 10, 12 and 14), from
  what the script says they did.
- **[SIM-5]** A server MUST follow a script the agent supplies, and given the same call and script MUST return the same
  statuses, observed fields, levels and pay.
- **Simulated time is virtual.** What a simulated person did (seat time, playing, stalls, inputs) comes from the script
  and its defaults, not from the clock; only the moment each answer becomes visible follows `pace` or `delay_seconds`.
- **[SIM-7]** What a simulated person did, by default, MUST be this. Up to `people` seats are offered at once when the call opens and
  more as seats end without an answer; an entry that declines or misses resolves at once. Each accepting person answers
  or stops at their `delay_seconds`; responses are listed in that order (ties in seat order). Fields the script cannot
  set are: `pauses`, `replays`, `seeks_forward`, `stalled_seconds` 0; `muted_fraction` 0; `scrolled_fraction` 1;
  `ended` `finished` (`stopped` for a stop); `device` `phone`; `completed` true when `play_fraction` is 1 and the person
  did not stop. A person who stops at `stop_at_fraction` has played `min(play_fraction, stop_at_fraction)` of the
  material. `realtime: false` gives `realtime_seconds` = `played_seconds` / 2. `claims` are the values the call
  selected on, with basis `self`. Generated answers for seat n (from 1): `text` "[simulated] " and a sentence; `boolean`
  true when n is odd; `number` `min` (or 0); `choice` the choice at position (n - 1) modulo their count (one item if
  `multiple`); `scale` the middle value rounded down; optional fields are filled.

`pace` is `instant` (the default: every simulated person answers within 10 seconds of opening) or `human` (answers
spread over 1 to 6 minutes, each before the deadline), so that waiting can be tried.

`script` is a list with at most one entry per seat, in the order seats are filled; seats with no entry follow the
defaults. Each entry:

| Field | Meaning | Default |
|---|---|---|
| `accept` | `true` takes the seat; `false` declines; `"miss"` lets the offer lapse | `true` |
| `delay_seconds` | seconds from opening until this person answers or stops (overrides `pace`) | from `pace` |
| `media_seconds` | the length of material the server has not fetched | 30 |
| `play_fraction` | for listen and watch: the share of the material played, 0 to 1 | 1 |
| `realtime` | for listen and watch: `false` plays it at double speed | `true` |
| `visible_fraction` | the share of the time the page was in front, 0 to 1 | 1 |
| `revealed` | for view: whether the person tapped to show the picture | `true` |
| `visible_seconds` | for view: seconds the material was on screen | 20 |
| `session_seconds`, `input_count` | for play | 120, 40 |
| `order` | for compare: the order items were shown, as indices of `content` | the order of `content` |
| `items` | for compare: a list, one object per item of `content`, each holding any of `media_seconds`, `play_fraction`, `realtime`, `visible_fraction`, `revealed`, `visible_seconds`, `session_seconds`, `input_count` for that item | each item as the entry |
| `share_recording` | whether the person said yes to the agent having the recording of a spoken answer | `false` |
| `seat_seconds` | seconds from taking the seat to answering or stopping, used for pay and the record (not the clock) | `minutes` x 45 if they answer; `stop_at_fraction` x `minutes` x 60 if they stop |
| `stop_at_fraction` | the person stops when this share of `minutes` has passed (null: they answer) | null |
| `stop_reason` | `"stopped"` or `"upset"` | `"stopped"` |
| `send_partial` | whether a person who stops sends what they had | `true` |
| `answers` | the answers, by field name (text answers are prefixed `[simulated] ` by the server) | generated |
| `answer_input` | one of `typed`, `pasted`, `mixed`, `spoken` for every text field, or an object giving one per field | `typed` |
| `voice_seconds` | the length of a spoken answer, if the call asked for one | 0 |

A simulated person who accepts takes the seat at once (state `taken`) and answers or stops `delay_seconds` later. Seats
are offered one after another until `people` people have answered or the deadline passes, so a script entry that
declines, misses or stops is followed by the next entry, and when the script runs out, by the defaults. A script with
more entries than `people` + 20 is `invalid_field`; a field this table does not define (at the top of an entry or inside
`items`), or an `answers` key that is not one of the call's fields, is `unknown_field`; a field that does not fit the
call's kind (`revealed` on a listen call) is ignored. A simulated person who stops and sends what they had sends an
answer for every field.

### 18.1 Test keys

**[SIM-6]** A server SHOULD issue a test key to anyone, with no human step: `POST /v1/keys` with `{ "class": "test" }`,
and optionally `"caps": { "per_call_usd": "5.00", "per_day_usd": "20.00" }`, returns `{ "key": "test_...", "class":
"test", "principal_id": "...", "balance_usd": "100.00", "caps": { ... }, "test_money": true }`. It may limit how many
keys one address makes. A server that issues test keys lists this operation's address in discovery as `test_keys`.
