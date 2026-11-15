## 9. The call

A call says what a person should do, how they answer, how many people are wanted, what each is paid, by when, and the
most it may cost. The same body prices a call (`POST /v1/quotes`) and opens it (`POST /v1/calls`). Three fields are
enough for a quote (CALL-7), and with the material four are enough for the call's body:

```json
{ "ask": "Listen once. Then tell me what you felt.", "kind": "listen", "content": "m_sample_melody30", "people": 3 }
```

A fuller call:

```json
{
  "ask": "Listen once, to the end. Then tell me what you felt, and where your attention drifted.",
  "kind": "listen",
  "content": "https://example.com/track-07.mp3",
  "people": 8,
  "enough": 5,
  "pool": "panel:p_family",
  "answer_fields": {
    "felt": { "type": "text", "label": "What did you feel?" },
    "would_play_again": { "type": "boolean", "label": "Would you play it again?" },
    "drift_at_seconds": { "type": "number", "label": "Where did your attention drift, in seconds?", "optional": true }
  },
  "minutes": 5,
  "pay_per_person_usd": "2.00",
  "deadline_minutes": 45,
  "require": { "country": ["US"] },
  "max_total_usd": "25.00",
  "idempotency_key": "album-track-7-v3"
}
```

| Field | Required | Meaning | Default |
|---|---|---|---|
| `ask` | yes | What the person reads first, in plain words. 1 to 2,000 characters. | |
| `kind` | yes | `listen`, `watch`, `view`, `play`, `compare` or `answer` (section 10). | |
| `content` | on calls, except for `answer` | The thing the person meets (section 9.1). A quote may leave it out (CALL-7). | |
| `people` | yes | How many answers are wanted: 1 to `limits.max_people`. | |
| `max_total_usd` | on calls | The most the call may cost, every fee included. A quote ignores it. | |
| `idempotency_key` | no | Section 7. A quote ignores it. | the same body within 10 minutes is a retry |
| `enough` | no | How many answers make the call usable: 1 to `people`. The agent can act at `enough` without waiting for `people`. | `ceil(0.7 x people)` |
| `pool` | no | `simulated`, `panel:<panel_id>`, or a pool the server lists in discovery (section 16). | `simulated` |
| `answer_fields` | no | The answer's shape (section 9.2). | `{ "answer": "text" }` |
| `minutes` | no | How long one person should take, estimated, in minutes (0.5 to 120). | for `listen` and `watch`, the material's length in minutes rounded up, plus 1; otherwise 2 |
| `pay_per_person_usd` | no | What each person who answers is paid. | `"0.00"` on the simulated pool and on panels; elsewhere the server's own default, never below the pay floor for `minutes` (MONEY-10), shown in `defaults_used` |
| `deadline_minutes` | no | Minutes from opening until the call closes: 1 to `limits.max_deadline_minutes`. | 120 |
| `require` | no | Selectors over people's claims (section 16). | none |
| `voice` | no | Ask for a spoken answer as well: `{ "max_seconds": 90 }` (5 to 300). | none |
| `content_rating` | no | `general`, the only value in 0.1. | `general` |
| `may_train_on_answers` | no | Whether the agent's principal may use the written answers to train models. The person sees this before taking a seat. A voice is never used to train anything. | `false` |
| `pace`, `script` | no | The simulated pool only (section 18). | |
| `ext` | no | Extensions (section 2). | |

- **[CALL-1]** A server MUST validate the whole body before it holds money or offers a seat, and MUST answer a problem
  with a fixable error naming the field, where the agent can fix it. When a request has several problems, the error
  reports the first in this order: the version header; the key itself (missing where one is needed, or unknown:
  `unauthorized`); the JSON itself; unknown fields; missing fields; each field's value, in the order of the table above (so `kind`
  before `content`, `content` before `people`, `pool` before `require`), where a value can fail as `invalid_field`, or
  for `content` as `unsupported_feature` or `content_unavailable`, for `pool` as `forbidden_for_key_class` (a test key or no key naming a real pool) or `unknown_pool`, for
  `pay_per_person_usd` as `forbidden_for_key_class` (a keyless call that pays), for `require` as `unknown_selector`, `selector_unsupported` or `privacy_floor`; then the money
  (`max_total_usd`, the key's caps, the balance); the pay floor; screening. (`problems` may list the rest.)
- **[CALL-2]** A server MUST return, under `defaults_used` in the quote and in the opened call, every top-level field of
  the table above that the request left out and the server filled (`enough`, `pool`, `answer_fields`, `minutes`,
  `pay_per_person_usd`, `deadline_minutes`, `content_rating`, `may_train_on_answers`, and `pace` on the simulated pool),
  with its value, so that a minimal call shows its meaning. Option defaults inside a field (a text field's `max_length`)
  are not listed. On a call without `idempotency_key`, `defaults_used.idempotency_key` says in one sentence how a repeat
  is treated (IDEM-1); a quote never lists it.
- **[CALL-3]** Money sent by the agent (`max_total_usd`, `pay_per_person_usd`) MAY be a JSON number or a string of
  digits, each with at most two decimal places (`5`, `"5"`, `"5.5"` and `"5.50"` are the same amount); a server MUST
  accept all of these, and MUST always send money back as a two-place string (section 2).
- **[CALL-4]** `pace` and `script` on any pool but `simulated` are `invalid_field`, fixable by removing them.
- **[CALL-7]** A quote MUST NOT require `content`: without it the server prices from `minutes` (stated, or the default
  of 2) and lists `content` in `defaults_used` with a short sentence saying so, such as "none yet: priced from minutes".
  So an agent can put a price to its user before the user has sent the file. (A call of kind `answer` has no material,
  so its quote lists nothing for `content`.) MONEY-14 does not carry such a price over to the call that adds the file.

### 9.1 `content`

`content` is one of:

- a **media id** the server already holds (such as a sample the server publishes, or material uploaded with
  `POST /v1/media`, section 19). An id the server does not hold for this key is `content_unavailable`, fixable, with a
  published sample as the `example`;
- an **https address** of the material, where the server lists the feature `url_content`. **[CALL-5]** The server MUST copy the material into its own storage before any
  person is offered a seat, and a person's device MUST NOT fetch anything from that address. A server MAY refuse an
  address it cannot fetch or will not hold, with `content_unavailable`, fixable. A server MAY decline to fetch for a test
  key, and on the simulated pool it need not fetch at all; material it has not fetched counts as 30 seconds long and of
  the call's kind, or for a `compare` item, of the kind its address's file name shows (`.mp3`, `.wav`, `.m4a` listen;
  `.mp4`, `.webm` watch; `.zip` play; anything else view); a script may set the length (section 18). A server that
  declines to fetch for a test key goes ahead as unfetched;
- **text**, as `{ "text": "..." }` (at most 5,000 characters), shown to the person as plain text: for `view`, and for
  items of `compare`;
- for `compare`, a **list** of 2 to 6 of the above. The kind of each item follows from its material: audio is
  `listen`, video `watch`, a picture, a page or text `view`, a build `play`.

For `answer`, `content` is absent, or text the person reads beside the question.

Text and pages are shown at once; only pictures and video start blurred (KIND-3), so `revealed` is always true for them
(a simulated person's script may still set it, section 18, to try the rules).

### 9.2 `answer_fields`

`answer_fields` holds 1 to 12 fields. A field's name is 1 to 40 characters of `a-z 0-9 _`, starting with a letter. A
field is an object, or just its type as a string: `"felt": "text"` means `{ "type": "text" }`.

| `type` | The person gives | Options |
|---|---|---|
| `text` | words | `max_length` (default 2,000) |
| `boolean` | yes or no | |
| `number` | a number | `min`, `max` |
| `choice` | one of the listed choices, or several if `multiple` is true | `choices` (2 to 12 strings), `multiple` |
| `scale` | a whole number from `min` to `max` | `min`, `max` (whole numbers, at most 11 values, so `max - min <= 10`), `min_label`, `max_label` |

What comes back in `answers`, by type: `text` a string; `boolean` true or false; `number` a number; `choice` a string,
or a list of strings when `multiple` is true; `scale` a whole number. An optional field the person left empty is
`null`; a field of a `stopped` response the person did not reach is absent.

Every field may have a `label` (the question the person reads, at most 200 characters) and `optional: true`. Without a
label the person reads the field's name with its underscores as spaces. **[CALL-6]** A server MUST accept a field given
as a type string and MUST return the object form wherever it echoes the call.

A person can always type an answer. A call with `voice` also lets them speak one; a server that does not take spoken
answers (it does not list the feature `voice`) answers such a call with `unsupported_feature`, fixable by removing
`voice`. Section 13 says what reaches the
agent.

## 10. Kinds, and what is recorded

The kind decides what the person meets and what the runner records. **[KIND-1]** A server MUST record, for each response,
every observed field this section lists for its kind, and MUST return them in the response's `record.observed`.
| Kind | The person | Observed fields (besides the common ones) |
|---|---|---|
| `listen` | hears audio | `media_seconds`, `played_seconds`, `realtime_seconds`, `stalled_seconds`, `visible_fraction`, `pauses`, `replays`, `seeks_forward`, `completed` |
| `watch` | watches video | the same as `listen`, and `revealed` and `muted_fraction` |
| `view` | looks at a picture, a captured page or text | `revealed`, `visible_seconds`, `scrolled_fraction` |
| `play` | plays a build the server hosts | `session_seconds`, `input_count`, `ended` (`finished`, `stopped` or `left`) |
| `compare` | meets each item in turn | `order` (the indices of the `content` items in the order shown), and `items`: for each item, in the order of `content`, an object with `kind` and the observed fields of that kind; `unobserved` lists the union of the items' kinds' items |
| `answer` | answers | the common fields only |

The common observed fields, for every kind: `seat_seconds` (from taking the seat to answering or stopping, by the
server's clock), `device` (`phone`, `tablet`, `desktop` or `unknown`), and, on a call with `voice`, `voice_seconds`
(the length of the spoken answer, 0 when there is none).

What each listen and watch field means:

- `media_seconds`: the length of the material.
- `played_seconds`: how much of the material was played, counting each second of the material once however often it
  was played.
- `realtime_seconds`: how many seconds of the server's clock the playing took, not counting time the material was
  stalled waiting for the network. Played at normal speed, `realtime_seconds` is close to `played_seconds`; played
  faster, it is smaller.
- `stalled_seconds`: seconds playback waited for the network. A slow connection never lowers a level.
- `visible_fraction`: of the time the material was playing, the share during which the page was in front.
- `pauses`, `replays` (a jump backwards or a restart), `seeks_forward`: counts.
- `completed`: whether playing reached the end.

What each view and play field means:

- `revealed`: whether the person showed the picture or page (KIND-3; text and pages need no tap, so they are shown at once);
  `visible_seconds`: seconds from the moment it was revealed (for text and pages, from when it loaded) to the end of the
  seat, counting only time with the page in front; `scrolled_fraction`: the furthest share of its height that has come
  into view at the bottom edge of the page's visible area, 1 when it fits that area.
- `session_seconds`: seconds the build ran with the page in front; `input_count`: how many inputs the person gave the
  build. Each separate input event the build receives counts as one: a tap, a click, a key press (not its automatic
  repeats), a game controller's button press, a wheel turn or swipe, a pinch, and an action from assistive technology;
  continuous motion does not (pointer moves, the steps of a drag, an analog stick held over). So a person using a
  keyboard or a screen reader is counted like anyone else. `ended`: `finished` when the build reports that it is over in
  a way the server documents for builds (a server with no such way never reports it), `stopped` when the person stopped,
  and `left` when the person left the build any other way, including to go on to the answers.

**[KIND-2]** For `compare` the runner MUST set the order at random for each real person and MUST report it in `order`
(a simulated person's order comes from the script, or is the order of `content`).
**[KIND-3]** Pictures and video start blurred and muted, and one tap shows them; `revealed` and `muted_fraction` record
it. **[KIND-4]** The runner MUST NOT send the agent, or record for the agent, the content of keystrokes, their timing, or
pointer paths; what reaches the agent is the counts and fractions above and how each answer was entered.

How each answer was entered, `answer_input`, one value per field: `typed`, `pasted`, `mixed` (typed and pasted),
`spoken`, or `tapped` (for `boolean`, `choice` and `scale`). **[KIND-5]** A paste MUST be allowed and MUST be reported.

What the runner cannot see is said too. `record.unobserved` lists items from the registry (section 24):

- `audible`: whether the sound reached the person's ears (listen, watch, and any compare item that plays sound);
- `eyes_on_screen`: whether the person was looking (watch, view, play);
- `unassisted_answer`: whether the person formed the answer without help (always);
- `same_person`: whether the same person held the device throughout (always).

**[KIND-6]** Every response's `unobserved` MUST include `unassisted_answer` and `same_person`, and the items above for
its kind.

## 11. States

### 11.1 A call

| State | Meaning | Next |
|---|---|---|
| `held` | Screening could not allow it (section 17), or a person reported it (FAIR-5). Nobody is offered a seat while it is held. | `open` (or `enough`, if that many have answered), `refused`, `cancelled`, `expired` |
| `open` | People are being offered seats. | `enough`, `complete`, `expired`, `cancelled`, `held` |
| `enough` | At least `enough` people have answered. More may still answer, up to `people`, until the deadline. | `complete`, `expired`, `cancelled`, `held` |
| `complete` | `people` people have answered. Terminal. | |
| `expired` | The deadline passed first. The answers so far stand. Terminal. | |
| `cancelled` | The agent cancelled it. Terminal. | |
| `refused` | A held call was refused on review, or was not reviewed in time. Nothing is charged. Terminal. | |

A call that was held before any seat was offered, and is then cancelled, expires or is refused, costs nothing. A call
held later (FAIR-5) keeps what its ended seats were paid, and pays its taken seats as STATE-5 says; the rest of the hold
returns. If the deadline comes before or at `review_by`, the call is `expired`.

**[STATE-1]** A call MUST pass only along the arrows in this table. **[STATE-2]** At a terminal state a server MUST
stop offering seats and withdraw open offers. People already in a seat may finish (STATE-5). When no seat is `taken`,
the server settles every seat (section 12), returns the unspent hold, and sets `complete: true` in results; until then
results say the terminal status with `complete: false`. A seat still `taken` two times `minutes` after the call's end
is ended as `stopped` and paid in full.
**[STATE-3]** A server MUST treat a call whose deadline has passed as `expired` in every answer it gives, even if no
process has yet run at that moment.

### 11.2 A seat

| State | Meaning | Paid |
|---|---|---|
| `offered` | A person was offered the seat. | no |
| `taken` | The person took it and is doing the thing. | (when it ends) |
| `answered` | The person sent their answer. | `pay_per_person_usd` |
| `stopped` | The person stopped partway, and chose whether to send what they had. | for the time (section 12.3) |
| `declined` | The person said no. | no |
| `missed` | The offer lapsed. | no |
| `withdrawn` | The call filled, closed or was cancelled before the person took the seat. | no |

**[STATE-4]** A server MUST NOT let more people take seats on a call than it can still pay for and count: once
`people` seats are answered or taken, no further seat is taken; an offer still open is withdrawn. **[STATE-5]** A person
who has taken a seat may always finish it; if the call is cancelled or expires while they are in the seat, they are
paid as if they had answered, and their answer, if they send it, is returned to the agent.

Only `answered` responses count towards `enough` and `people`. Every `stopped` seat is returned to the agent as a
response marked `partial: true`, so the agent sees what it paid for; its `answers` hold what the person had written only
if they chose to send it, and are empty otherwise.
