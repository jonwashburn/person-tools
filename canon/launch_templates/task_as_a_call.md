# A task written as a call

*For people who used to post judgment tasks on Mechanical Turk: listen to this clip, watch this ad, which thumbnail,
is this page clear. Draft for the launch kit; not published.*

{status_plain}

## The same task, two ways

A task you might have posted:

> **Title:** Listen to a 30-second jingle and rate it
> **Reward:** $0.15 · **Assignments:** 50 · **Time allotted:** 5 minutes
> **Instructions:** Play the audio below to the end. Then answer: how memorable is it (1 to 5)? Would you skip it in a
> podcast? Write one sentence about how it made you feel.

The same thing as a call, made by your agent with one tool call to `{tool}`:

```json
{
  "ask": "Play the jingle to the end. Then answer the three questions in your own words.",
  "kind": "listen",
  "content": "https://example.com/jingle.mp3",
  "people": 50,
  "answer_fields": {
    "memorable": {"type": "number", "label": "How memorable, 1 to 5"},
    "would_skip_in_a_podcast": "boolean",
    "how_it_felt": "text"
  },
  "pay_per_person_usd": "1.00",
  "minutes": 2,
  "max_total_usd": "70.00"
}
```

Fifty people at $1.00 for two minutes each is $30 an hour. The live quote for it, in test money, read 14 Nov 2026: $50.00
to the people, a $5.00 router fee, a $12.50 reserve that comes back if unused, $67.50 in all.

## What comes back

Each answer arrives with a record of what that person's screen captured: how much of the audio played and at what
speed, whether the page stayed in front, where they paused or replayed, and whether each answer was typed or pasted.
The server, not the page, decides the evidence level: **attended** when the material played in real time with its page
in front for nearly all its length, **said** otherwise (still paid). No level claims to know that a person formed the
answer without help, and no person is ever given a score.

A result opens with a tally of each answer field, then one line per person, then the money: held, spent, returned.

## What is different, and why

- **The people are told who is asking.** Before taking a call, each person sees that an AI is asking, who answers for
  it, how long it takes, what it pays and what will be recorded.
- **Pay is per hour of real time, not per piece.** The floor is ${floor_hour} an hour on the median time actually taken,
  at least ${min_call} a call, and a person who stops partway is paid for the time spent. A 30-second listen with three
  questions costs more than $0.15, because a person's two minutes cost more than that.
- **No rejections.** No asker can reject a person's work. {acceptance}
- **The price is shown before anything is spent.** A free quote lists each line: the people's pay, a router fee of
  {fee_pct}% of that pay (at least ${fee_min} a call), and a reserve that comes back if unused. Every call states the
  most it may cost, and opens only at or under it.
- **Your own people are free.** A panel you invite by link costs nothing at zero pay, and stays free.

## What this is not for

Labelling at a cent a row, one-question polls, and anything done away from a screen. Calls are refused that involve
{refused_joined}.

## Try it today

{start_line}
