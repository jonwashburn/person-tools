# Screening, version 1 (rules only): how the router calls it

Policy: `policy/POLICY.md`. Cases: `cases.json`, run once by `check.mjs` (results in `RESULTS.md`).

```js
import { screen, screenOutcome, SCREENING_VERSION, RULES } from "../src/screening/index.js";

const s = await screen(body, {
  key_class, pool,     // router's form: "test"|"real", and the pool name; a test key or a fenced pool (simulated, self,
                       // panel:team-test, panel:attack-*) means nobody real can be rung
  team,                // true for the team's and owner's own principals (their material is not "uninspected")
  principal_new,       // true until the principal has a completed paid call in an earlier 30-day window
});                    // (pool_real / principal_is_ours are accepted too)
// s.decision is "ALLOW" | "REFUSE" | "HOLD". Nothing else.
// Flat fields on every result: rule, category, rule_text, where, found, fixable, fix, corrected_example, what_to_do, message.
```

- **Policy links:** every refusal carries `policy_url` (and a hold `hold.policy_url`), a path on the SITE (`/policy#refused`,
  `#held`, `#not-allowed`); prefix it with the site's base for the request's host (`siteBase(request)`), as D1 says.
- **REFUSE**: return `s.error` as the error body (HTTP 422). It already has `code`, `message`, `fixable`, `rule`,
  `policy_section`, and when fixable `field`, `example` and `problems` (every problem, so one retry fixes all). Nothing
  opens and nothing is charged. D23 names the error `refused_screening`: set `code` to whatever the standard's registry says;
  the rest of the body is as given.
- **HOLD**, on a real pool: store the call `held`, ring nobody, write `s.hold.reasons` to `held_calls`. Released only by
  the owner naming the id in `owner/RELEASE_HELD.md`. Show the asker `s.hold.message`.
- **HOLD**, on `simulated` or `panel:team-test`: run the call, and put `screening: "HOLD"`, `would_be_held: true`
  (the standard's name) and `s.hold.message` in the result, so an agent sees what would happen on real people.
- **ALLOW**: go on.
- Wrap it anyway: `let s; try { s = await screen(body, ctx) } catch { s = null }`; if `s` is missing or its decision is
  not one of the three, treat it as HOLD. The module never throws, but a missing file must also be a HOLD.
- Store `s` (it is small: `screening_version`, `fired`, and `error` or `hold`) in `calls.screening_json`.
- The outcome line (D21): `await screenOutcome(text, ctx)` returns the same three answers. Show it to people only on ALLOW.
- Both call shapes are read: ROUND0 nested (`experience`, `respond`, `who`, `pay`) and D24 flat (`kind`, `content`,
  `people`, `answer_fields`, `require`, `content_rating`, `voice`). A `content` URL or media id is material, not words;
  `content.text` is read by the word rules as material (instruction rules do not apply to it).
- **The model read, built and switched off:** `model_read.js`. When paid model use is switched on, the router sets
  the secret `ANTHROPIC_API_KEY` and passes, together, `ctx.modelClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })`
  (the official SDK, `@anthropic-ai/sdk`) and `ctx.modelBudget = d1Budget(env.DB)` (`model_budget.js`: the $20-a-day
  stop, one row a day in `meta`); without the secret it passes neither and screening is rules alone. **A client without
  a budget never reads.** The read runs only on outside principals' calls that rules held as unread (`outside_unread`) or
  undecided, uses the model named in `MODEL_READ` at low effort with a JSON schema, and its own timeout is 8 s: **raise
  the gate's 2 s timeout in screen_gate.js to 10 s when a modelClient is passed.** Its error, timeout, refusal or
  unparseable answer leaves the call HOLD; it never lifts a subject hold. When the day's spend (Chicago date) plus the
  dearest read (`BUDGET.worst_read_cents`) would pass `BUDGET.cap_cents_per_day`, there is no read and the call stays
  held for a person (`model_read.reason` says so). Each read is counted from its `usage` at the dearer of this model's and
  its fallbacks' prices; a failed or timed-out read at the dearest. `model_read_check.mjs` (Node 22,
  `--experimental-sqlite`) checks the combining rules and the stop with stand-in clients, and `model_budget.js`'s SQL on
  SQLite. `policy_text.js` is generated from POLICY.md by `gen_policy_text.mjs`.
- `RULES` is the registry: rule id, outcome, fixable, policy section, the sentence an agent reads. The spec's screening
  categories can be generated from it.
