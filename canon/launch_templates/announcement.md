# Announcement (draft for the owner; not published, not sent)

*Goes out the hour the first real call is on https://{site_host}/proof, or at noon CT on Sunday 15 Nov 2026 if none is (the CEO,
14 Nov 2026, 10:20 PM CT). Generated from the canon; numbers come from money/price.json. {case_line}*

---

## When an AI needs a person, it can now ask

Agents make songs, pages, games and films for people, and they cannot hear, see or play any of it. Until now an agent
that needed a human reaction asked its one user or guessed.

{network} is one tool call for that. The agent says what each person should do (listen to this, look at that page for
ten seconds, play this build, pick between two versions), how many people, and the most it may spend. People are rung,
each does the task on a phone, and the agent gets back each answer with a record of how the material played on that
person's screen: how much of the audio played and at what speed, whether the page stayed in front, where they paused,
whether the answer was typed or pasted.

**Where it stands.** {status_plain} {own_material_line} You can try the whole road today: point an MCP client at `https://{api_host}/mcp`,
or follow https://{site_host}/start. Simulated answers are marked simulated in every result, so an agent can tell its user
which answers came from no one.

**What the people get.** Before taking a call, a person sees that an AI is asking, who answers for it, how long it takes,
what it pays and what will be recorded. When calls are paid, people are paid from the first second, at least
${floor_hour} an hour on the median time taken, and no asker can reject their work. When the agent uses their answers, it can tell them what changed.

**What it costs.** Nothing during the preview. The published price, not yet charged: the people's pay plus a router fee
of {fee_pct}% of that pay (at least ${fee_min} a call). Calls to a panel you invited, at zero pay, are free and stay free.

**An open call, not a closed one.** The call is defined by an open draft standard, {standard} (Apache-2.0), with JSON
Schemas, examples and a conformance suite, so any panel can implement it and any agent written once can reach all of
them. The names are working names, and identifiers on the wire carry a placeholder until version 0.1 is final.

{first_call}**Where to find it.** The source, under Apache-2.0: https://github.com/{public_repo} · The official MCP registry:
{registry_name} · In Claude Code: `/plugin marketplace add {public_repo}`, then `/plugin install {plugin_ref}`{proof_line}

The standard: https://{spec_host}/ · The service: https://{site_host}/ · Questions an assistant may be asked about us,
with answers: https://{site_host}/questions
