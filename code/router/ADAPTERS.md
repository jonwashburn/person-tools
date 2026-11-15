# Adding a pool: the adapter contract

A pool is a set of people the router can reach. The router has two built in: `simulated` (scripted people) and
`panel:<id>` (people a principal invited). Every other pool is an **adapter**: one JavaScript module in
`src/pools/` that turns the router's call into the pool's own interface and back. An agent never sees the difference:
the call, the quote, the results and the receipts have the same shape on every pool.

This page is what you need to add one. The Prolific adapter (`src/pools/prolific.js`) is the worked example.

## What an adapter is

```js
export const adapter = {
  name: 'prolific',                 // the pool's name on the wire: pool "prolific"
  pays_people: true,                // true: the pool pays people itself; the router's ledger moves their pay to the pool
  fee_rate: 0.42857,                // the pool's own fee on what people are paid, shown as its own quote line (pool_fee)
  floor_cents_per_hour: 800,        // the pool's own pay floor; the router uses the higher of its floor and this
  kinds: ['listen', 'watch', 'view', 'answer', 'compare'],   // what its people can do (through our runner page)
  expected: { minutes: 240, note: '...' },                   // an honest estimate for the quote (MONEY-3)

  mode(env) -> 'live' | 'recorded' | 'off',                  // from the environment: credentials present, and allowed
  check(spec) -> null | CallError,                           // the pool's own rules, before anything is spent
  async open(ctx, call, spec) -> { ref },                    // create the pool's job and publish it
  async poll(ctx, call, ref) -> { arrivals, submissions },   // what happened since the last look
  async finish(ctx, call, ref, seat, outcome) -> { completion_url },   // a person is done: tell the pool
  async close(ctx, call, ref),                               // the call ended: stop the pool's job
};
```

`ctx` gives an adapter what it may use and nothing more: `ctx.fetch(method, path, body)` (the pool's HTTP interface, through the
transport the mode chose), `ctx.arrivalUrl` (the address a pool's person opens to start, on our runner, with the pool's
placeholders), `ctx.now()`, and `ctx.log(line)`.

## How a call runs on an adapter

1. **Quote.** The router adds the pool's fee line (`fee_rate` x pay to people) and uses `expected` for the time. A pool
   that is `off` is refused with `unknown_pool`, and discovery does not list it (the standard's PEOPLE-3: never list a
   pool a call cannot complete through).
2. **Open.** The router screens the call as always, holds the money, then calls `open`. The adapter creates the pool's
   job (Prolific: a study whose external address is our runner) and returns its reference, which the router stores.
3. **Arrival.** A person the pool sends opens `ctx.arrivalUrl` on our runner. The runner posts the pool's identifiers to
   `POST /v1/arrivals/{arrival_token}` (in recorded mode, `poll` reports the recorded arrivals instead); the router makes a seat for that person on the spot, already taken (they chose
   the job themselves), and answers with the seat's link. From there it is the ordinary seat: the same page, the same
   record, the same evidence rule, the same receipt.
4. **Finish.** When the seat ends (answered or stopped), the router calls `finish`; the adapter returns where the
   person goes next (Prolific: its completion address with our code). The runner sends the person there.
5. **Settle.** Every request and every tick, the router calls `poll` for open calls on the pool and reconciles: who
   arrived, who finished, who returned the job. Pay is charged against the hold as each seat ends, exactly as on any pool;
   when `pays_people` is true it is posted to the pool's own account in the ledger (`pool:<name>`), because the pool pays.
6. **Close.** At a terminal state the router calls `close`, then returns the unspent hold.

## Whose account: ours, or the principal's own

An adapter that sets `principal_accounts: true` lets a principal connect its own account with the pool
(`PUT /v1/pools/<pool>/account {"token": "..."}`; `src/pools/accounts.js` seals the token at rest and shows only its last four
characters). The adapter's code does not change: `ctx.account` says `'ours'` or `'principal'`, and `ctx.fetch` carries the
right token. The router changes the money: on the principal's own account the pool pays people from that account, so the
quote holds only the router fee and lists the rest under `paid_elsewhere`, and each seat moves only its router fee. A real
token stays refused until the pool allows a router to hold a principal's key and the owner sets
`<POOL>_PRINCIPAL_ACCOUNTS=on`; a token starting `recorded_` runs the recorded path for the team's checks.

## Rules an adapter must keep

- **Nothing an asker sends reaches the pool's people except through our runner.** The pool's job points at our runner,
  never at the asker's material; material is served only from our storage.
- **The pool's own rules are code, not prose.** `check` refuses, with the standard's errors, whatever the pool forbids
  (Prolific: spoken answers without its written approval, questions asking for identity or contact, pay under its floor).
- **A person is never rejected by the router.** If the pool can reject (Prolific can), the adapter approves every
  completed job automatically and never calls the pool's reject operation.
- **The pool's identifiers never reach an asker.** The person's reference on the result is the router's own
  `person_ref`, made from the pool's id with a secret; the pool's id stays in the router's database.
- **Two modes, one code path.** `recorded` replays answers shaped like the pool's documented interface, from a file
  next to the adapter, so the whole path runs with no account and no real person. `live` uses the same code with the
  pool's real transport and needs its credentials in the environment and the owner's grant.

## Adding one, step by step

1. **`src/pools/<name>_recorded.json`**: the requests your adapter makes, each with the answer the pool's own
   documentation shows, keyed `"METHOD /path/"` (ids in paths written `{id}`), and a list of stand-in participants
   (`participant_id` starting `recorded_`, `arrive_after_seconds`, and a `script` in the simulated pool's terms:
   `delay_seconds`, `play_fraction`, `stop_at_fraction` and so on). Mark any field you could not confirm as unverified.
2. **`src/pools/<name>.js`**, from this skeleton (the Prolific file is the full example):

```js
import { fixable } from '../spec.js';
import RECORDED from './<name>_recorded.json';

export const adapter = {
  name: '<name>', pays_people: true, fee_rate: 0.30, floor_cents_per_hour: 0,
  kinds: ['listen', 'view', 'answer'],
  expected: { minutes: 240, note: 'an outside panel: its people choose tasks themselves' },
  principal_accounts: false,                       // true only once you handle a principal's own token (see above)
  mode(env) { return env.<NAME>_MODE === 'live' && env.<NAME>_TOKEN ? 'live' : 'recorded'; },
  check(spec) {                                    // the pool's own rules, as the standard's errors
    if (!this.kinds.includes(spec.kind)) throw fixable('unsupported_feature', 'kind', `The pool "<name>" takes ${this.kinds.join(', ')}.`, this.kinds[0]);
    if (spec.pay_cents === 0) throw fixable('below_pay_floor', 'pay_per_person_usd', 'People on an outside panel are paid.', null);
    return null;
  },
  async open(ctx, call, spec) {                    // make the pool's job; its address is ctx.arrivalUrl plus the pool's placeholders
    const job = await ctx.fetch('POST', '/jobs/', { title: `A short task (${spec.minutes} min)`, url: ctx.arrivalUrl + '?pid=<PLACEHOLDER>', places: spec.people, reward_cents: spec.pay_cents });
    return { ref: { job_id: job.id, code: 'HC' + call.id.slice(5, 13).toUpperCase() } };
  },
  async poll(ctx, call, ref) {                     // recorded: the stand-ins arrive on their schedule; live: read the pool's list
    if (ctx.mode === 'recorded') { const since = (ctx.now() - call.created_at) / 1000; return { arrivals: RECORDED.participants.filter(p => p.arrive_after_seconds <= since).map(p => ({ pid: p.participant_id, script: p.script, recorded: true })), submissions: [] }; }
    return { arrivals: [], submissions: [] };
  },
  async finish(ctx, call, ref) { return { completion_url: 'https://<pool>/complete?code=' + encodeURIComponent(ref.code) }; },
  async close(ctx, call, ref) { try { await ctx.fetch('POST', `/jobs/${ref.job_id}/stop/`, {}); } catch (e) { ctx.log('close: ' + e.message); } },
};
export function transport(env, mode, token = null) { /* recorded: look the request up in the recorded file; live: the pool's HTTP interface */ }
```

3. **Register the name in two places**: `src/pools/index.js` (`ADAPTERS`) and `ADAPTER_POOLS` in `src/spec.js` (the call's
   `pool` field is read before any adapter loads). End the adapter's file with `adapter.transport = transport;`: the router
   builds `ctx.fetch` from it, with the principal's own token when the call runs on their account.
4. **Check it on the recorded pool** with a team key: a quote shows the pool's fee as its own line; a call opens the job
   through your adapter; the stand-ins arrive, answer or stop, and the call completes with every answer marked
   simulated; spent plus returned equals held. Then the arrival road: open a call with `ext: {"recorded_arrivals": "none"}`,
   read `arrival_token` from `GET /v1/calls/{id}/seats`, post `POST /v1/arrivals/{token} {"pid": "recorded_x1"}`, answer
   in that seat, and find your completion address in the answer's `return_to`. The baseline's Prolific lines do exactly
   this; copy them for the new name.
5. **Write the page of exact steps** that turn on `live` (see `PROLIFIC_GO_LIVE.md`), and list the pool in discovery only
   after one live call through it has completed (PEOPLE-3).
