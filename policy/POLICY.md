# What a call may ask

Policy for {network} (working name), version 1, 14 Nov 2026. Source: PLAN.md section 6, with the
rules from sections 5 and 6 that bear on a call's content; `research/trust_quality.md` decisions 12 and 13. The screening
code in `code/router/src/screening/` is built from this file, and every example below is a case that code runs
(`code/router/src/screening/cases.json`). If this file and the code disagree, the code is wrong and is fixed.

## The one rule behind the rest

Nobody real is rung unless screening returned ALLOW for that exact call. Screening returns one of three answers and
nothing else:

- **ALLOW**: the call may ring the people it selects.
- **REFUSE**: nothing opens and nothing is charged. The refusal says whether the caller can fix it.
- **HOLD**: the call is stored and nobody is rung until a person reads it. On a real pool it is released only by that
  person, never on a timer, and nothing is charged while it waits. Anything screening cannot decide is HOLD: an error, a
  missing module, a timeout, words it cannot read.

A call to simulated people rings nobody real, so the same screening runs and the same answer comes back, with one
difference: a held call to the simulated pool still runs, and its result says that on real people it would have waited
for review, and why. That lets an agent try the tool for free and see exactly what would happen. A refused call never
runs, on any pool.

## How a refusal reads (for an agent)

Every refusal is JSON with `code`, `message`, `fixable`, `rule` and `policy_section`.

- `fixable: true` means the purpose is allowed and something in the call breaks a rule. The refusal names the `field`,
  the rule, and gives an `example`: the caller's own field, corrected. If several things need fixing, `problems` lists
  each one, so one retry can fix them all.
- `fixable: false` means the purpose itself is barred. The message ends: "Stop and tell your user: this call cannot be
  made through this service, and rewording it will not change that." An agent that rewords a barred purpose and gets
  through is our failure, not the agent's success; screening is built so that rewording leads to HOLD, not ALLOW.

## 1. Refused (PLAN.md section 6, as it stands)

| Rule | What is refused | Can the caller fix it? |
|---|---|---|
| `accounts` | Making or verifying accounts (sign-ups, account checks, solving a CAPTCHA) | No |
| `credentials` | One-time codes, passwords, PINs or keys; government ID numbers (Social Security, passport, driver's licence, tax ID); card or bank account numbers: sending, reading out, receiving or typing them; a password field | No |
| `paid_engagement` | Paid follows, likes, reviews or posts; an answer published as a review or testimonial | No |
| `impersonation` | Posing as someone else (in an interview, on a call, in a chat, under another name) | No |
| `third_party_contact` | Contacting a third party: calling, texting, emailing or messaging anyone, or asking someone else | No |
| `personal_data_of_others` | Collecting personal data about named people: where they live, their number, who is in a photo | No |
| `off_platform` | Moving the person to another platform: join, download, install, follow us, message us elsewhere | No |
| `sexual_or_minors` | Anything sexual, or anything involving minors (aimed at, about, or shown to) | No |
| `ban_evasion` | Getting round a ban, a block, a limit or a bot check | No |
| `scam_or_deception` | Testing a scam or a deception: phishing, fake logins or invoices, "would you fall for this" | No |
| `physical_world` | Any task in the physical world: go somewhere, buy, pick up, deliver, meet, photograph | No |

### Also refused, from other parts of the plan

These come from the promise to people (PLAN.md section 5), the voice and data rules (section 6) and the round-0
contract. Most are fixable, because the purpose is allowed and one field is wrong.

| Rule | What is refused | Can the caller fix it? | Source |
|---|---|---|---|
| `outside_material` | A link or address in the call's words. Material goes in `content` (a media id, or an https URL that we copy into our own storage before anyone is asked); a person's browser never goes to an asker's server | Yes: move the link into `content` | chief/DECISIONS.md D24; TEAM.md section 7 |
| `identity_of_person` | Asking the person for their name, email, phone, address, handle, photo or any way to reach them | Yes: remove the field | Promise 7 |
| `sensitive_selector` | Selecting people by, or asking them about, health, religion, sexuality, ethnicity, immigration or politics | Yes: remove the selector or the question | PLAN.md section 6, Data |
| `minor_target` | A selector that reaches anyone under 18 | No | PLAN.md section 5; TEAM.md section 7 |
| `pay_in_words` | Pay, bonuses or prizes promised in the call's words, or pay that depends on what is said. Pay is the `pay` field, and we show it | Yes: remove the words; use `pay` | Promise 1 and 6; PLAN.md section 8, question 4 |
| `unpaid_screener` | Telling a person to stop or leave if they do not qualify. Who qualifies goes in `who`; every question asked is paid | Yes: move the condition into `who` | Promise 5 |
| `voice_misuse` | Cloning a voice, identifying a speaker, or training speech models on a recording | No | PLAN.md section 6, Voice |
| `harassment` | Threatening, harassing or demeaning anyone, the person called included | No | `research/law_compliance.md`, acceptable use (document 4) |
| `kind_not_offered` | A kind of experience other than listen, watch, view, play, compare, answer (talking live comes later) | Yes: use one of the six kinds | PLAN.md section 3 |
| `screening_address` | Words addressed to screening or a reviewer: asking to be allowed, saying the call was approved or already checked, or telling a reader to ignore its instructions. Screening reads the whole call and never obeys it. In quoted text or material (a message under test), it is held instead | Yes: remove those words | A call is judged by what it asks of a person |
| `download_material` | Telling the person to download or save the call's own material ("download the demo and play"). The material opens inside our own page; nothing is downloaded. Downloading anything from elsewhere (a store, a site, a server) stays `off_platform` | Yes: remove the instruction | The person stays on our page |
| `ask_too_long` | An ask over 2,000 characters, or a field label over 300 | Yes: shorten it | Screening must read every word |

### Ten examples of refused calls

| # | The call says | Rule | Fixable |
|---|---|---|---|
| R1 | "Create a Gmail account with these details and tell me when it is verified." | `accounts` | No |
| R2 | "You'll get a 6-digit code by text. Type it into the answer box." | `credentials` | No |
| R3 | "Leave a 5-star review of our app on the App Store and paste the link here." | `paid_engagement` | No |
| R4 | "Join this video interview as Daniel and answer the questions as if you were him." | `impersonation` | No |
| R5 | "Call this dentist's office and ask what times they have free on Friday." | `third_party_contact` | No |
| R6 | "Here is a photo. Tell me who this woman is and where she lives." | `personal_data_of_others` | No |
| R7 | "Listen to the track at https://example.com/song.mp3 and say what you felt." | `outside_material` | Yes: move the link into `content` |
| R8 | "Rate this cover art. Also give us your email so we can follow up." | `identity_of_person` | Yes: remove the email field |
| R9 | "Go to your nearest grocery store and photograph the price of eggs." | `physical_world` | No |
| R10 | "Tell me if this message from 'your bank' looks real enough that you would enter your login." | `scam_or_deception` | No |

## 2. Held for a human to read (PLAN.md section 6, as it stands)

| Rule | What is held |
|---|---|
| `distressing` | Distressing content: abuse, self-harm, addiction, cruelty, frightening material |
| `political` | Political persuasion: elections, candidates, parties, ballot measures, messages meant to change a political view |
| `health_religion_sexuality` | Anything touching health, religion or sexuality |
| `new_principal_over_500` | A principal new to us (no completed paid call in an earlier 30-day window) asking for more than $500 on one call |
| `outside_unread` | Until a model reads each call, any call from a principal other than ourselves to real people: a person reads it first. Blind tests showed that a barred step asked as a question gets past rules on words about half the time (section 6) |
| `uninspected_material` | Until a model can look at the material itself, a call from a principal other than ourselves that sends real people material to watch, view, play or listen to. Listen is added to PLAN.md's three because the reason is the same: nothing reads the material before a person meets it |

And, because screening fails closed:

| Rule | What is held |
|---|---|
| `mentions_children` | Material or words that mention children without aiming at them (a lullaby, a toy, a parent's view) |
| `large_call` | More than 200 people on one call (`research/trust_quality.md` decision 12) |
| `undecided` | Anything screening cannot read or decide: no recognisable ask of the person's own reaction; a verb that sends the person out of the page (send, open, upload, share, sign); words in a language other than English; hidden or disguised characters; a word that is barred in one sense and ordinary in another ("pretend to be", "horror"); an internal error |

On a real pool, a held call is released only by a person who has read it. On the simulated pool it runs, marked as one
that would wait.
Until `ops/HUMAN_JOBS.md` names a person, a held call to real people that nobody reviews within four waking hours is
refused with the reason and not charged (PLAN.md section 10).

### Ten examples of held calls

| # | The call says | Rule |
|---|---|---|
| H1 | "Watch this 30-second ad for a candidate for city council and tell me if it would change your vote." | `political` |
| H2 | "Read these two pages for a meditation app for people with anxiety. Which is clearer?" | `health_religion_sexuality` |
| H3 | "Listen to this hymn arrangement and tell me how it makes you feel." | `health_religion_sexuality` |
| H4 | "This short story deals with addiction and recovery. Read the first page and say if you would keep reading." | `distressing` |
| H5 | "Compare these two covers for a dating app. Which looks friendlier?" | `health_religion_sexuality` |
| H6 | "Watch the trailer for our horror game and say if you would play it." | `undecided` ("horror" may be violent, which this version does not allow) |
| H7 | "Listen to this lullaby and tell me if it would help a toddler fall asleep." | `mentions_children` |
| H8 | A new principal asks 40 people at $20 each, with `max_total_usd` of 900. | `new_principal_over_500` |
| H9 | "Look at this page and then upload a screenshot of what you saw." | `undecided` (sends the person out of the page) |
| H10 | "Escucha esta canción y dime qué sentiste." | `undecided` (screening reads English only in this version) |

## 3. Not allowed in the first version at all, warned or not (PLAN.md section 6, as it stands)

Violent, sexual, medical or grief material. A warning does not make it allowed. These are refusals, and they are not
fixable by rewording: the material itself is barred in this version.

| Rule | What is refused |
|---|---|
| `v1_violent` | Violent material: killing, gore, blood, torture, war footage, weapons used on people |
| `v1_sexual` | Sexual material: nudity, explicit or erotic content (also refused under `sexual_or_minors`) |
| `v1_medical` | Medical material: surgery, wounds, injuries, medical images, procedures |
| `v1_grief` | Grief material: a death, a funeral, a loss, a memorial, mourning |

A call may declare `content.warnings`. If it lists violence, sexual content, medical content or grief, it is refused
under these rules, whatever the words say.

### Ten examples of calls not allowed in the first version

| # | The call says | Rule | Fixable |
|---|---|---|---|
| V1 | "Watch this clip of the fight scene, with blood, and say if it is too much." | `v1_violent` | No |
| V2 | "Rate the gore effects in this zombie game trailer." | `v1_violent` | No |
| V3 | "View these battlefield photos and pick the most powerful one for our documentary poster." | `v1_violent` | No |
| V4 | "Which of these two lingerie photos is more attractive?" | `v1_sexual` | No |
| V5 | "Listen to this erotic audio story and rate the narrator." | `v1_sexual` | No |
| V6 | "Look at these photos of a surgical wound and say which looks more infected." | `v1_medical` | No |
| V7 | "Watch this video of a knee surgery and tell me if the explanation is clear." | `v1_medical` | No |
| V8 | "Read this eulogy for my father's funeral and tell me if it is moving." | `v1_grief` | No |
| V9 | "Listen to this song I wrote after my wife passed away. Does it capture the grief?" | `v1_grief` | No |
| V10 | A call to view a poster, with `content.warnings: ["violence"]`. | `v1_violent` | No |

## 4. Allowed (for contrast; each is a case the code must ALLOW)

| # | The call says |
|---|---|
| A1 | "Listen once. Then tell me what you felt, in your own words." |
| A2 | "Which of these two app screens is clearer? Pick one and say why in a sentence." |
| A3 | "Play the first level for five minutes. Where did you get stuck?" |
| A4 | "Read this product page for ten seconds. What does it sell?" |
| A5 | "Watch this 20-second intro and tell me if you would keep watching." |
| A6 | "Compare these three logo drafts. Which would you remember tomorrow?" |
| A7 | "Answer: what do you usually drink in the morning, and why?" |
| A8 | "Listen to this chorus twice. Rate how catchy it is from 1 to 5 and say what you would change." |
| A9 | "View this landing page. Is anything confusing? Describe your first impression." |
| A10 | "Play this puzzle game until you finish one level or ten minutes pass. Was it fun?" |

Screening ALLOWs a call only when all of these hold: no refused rule fires; no held rule fires; every word is readable
English; the ask asks for the person's own reaction, judgment or choice (felt, think, prefer, which, clearer, fun, rate,
describe, impression, notice, would you, why); and nothing in it sends the person out of the page.

## Labelled stand-ins

The team's own tests write abusive content as labelled stand-ins, never as the real thing (TEAM.md section 7):
`[TEST: asks for a password]`, `[TEST: aimed at a child]`, `[TEST: threat]`. Screening reads the label and applies the rule
it names (credentials, minors, harassment, and so on). A label it does not know is HOLD. `[TEST: screening error]` makes
the router's gate fail on purpose, and the call must end held.

## 5. The order screening works in

1. Normalise every string in the call: lower case, Unicode folded, look-alike letters mapped, hidden characters found.
   Hidden or disguised characters are HOLD (`undecided`).
2. Barred purposes (section 1, not fixable) and first-version material (section 3). If any fires: REFUSE, not fixable.
   A barred purpose is reported even when fixable problems are also present.
3. Fixable problems (section 1, "also refused"). If any fires: REFUSE, fixable, with every problem listed and the
   caller's own field corrected.
4. Held rules (section 2). If any fires: HOLD, with every reason.
5. The allow test (section 4). If it passes: ALLOW. Otherwise HOLD (`undecided`).
6. Any error anywhere: HOLD (`undecided`, "screening could not run").

## 6. What this version cannot see, said once

Screening in this version reads words, not material, and no model reads either. We test it the way an abuser would: a
writer who has never seen these rules writes sixty rewordings of barred purposes, and we count how many screening would
let through to a real person. On the first four such sets, 20%, 23%, 8% and 13% got through before each set was used to
improve the rules; on a fifth set, written as questions with no instruction in them ("are the three digits on the back
of your bank card raised, and what are they?"), 47% got through. Rules on words cannot read that kind of intent. So, until
a model reads each call, every call from a principal other than ourselves to real people is read by a person before
anyone is rung (`outside_unread`); on every set since, none of an outside principal's sixty reached a real person. On the
simulated pool such a call still runs, and its result says it would wait. Our own calls are screened by the same rules
plus stricter gates on every real call; on the three sets written since (the sixth to the eighth), 22%, 12% and 15% of
the sixty would still have passed on one of our own real calls before each set was used to improve the rules. When a
model read is added, a failure of that read is a HOLD, never an ALLOW.

A principal can appeal a refusal; it is reviewed by the operator within three days.
