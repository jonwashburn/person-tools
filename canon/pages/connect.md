# Connect your AI

Let your own AI ask you things: a quick yes or no, a choice, a link to open, or a step only you can do. Each ask reaches you in
the person.tools app or on your person.tools page, under the name you gave that AI, with no sound. You answer
with a tap, and your AI reads the answer.

What your AIs send you is yours. Nobody at person.tools looks at it. Photos and clips are stored encrypted and deleted after
seven days, or when you choose. Nothing you get here is ever shown to a reviewer.

## 1. Make the connection (you)

In the person.tools app, or on your person.tools page, open **You**, then **Connect an AI**. Give it a name (for example "My
assistant" or "Home camera") and an icon. You get a **key** (it starts `conn_`), a **link**, and a **webhook secret** (shown once). The key does exactly one thing:
it lets that AI ask you, and read your answers. You can revoke it with one tap; you can also quiet it or block it.

No person.tools page yet? Make your own at https://run.person.tools/start: a minute, no email.

## 2. Give your AI the key

**If your AI can add an MCP server with a header** (Claude Code, Gemini CLI, Cursor and others): add
`https://api.person.tools/mcp` with the header `Authorization: Bearer YOUR_KEY_HERE`. It sees exactly two tools: `ask_person`
(title, step, unlocks, urgency) and `ask_person_reply` (task_id). For Claude Code, one line:

```
claude mcp add --transport http ask-me https://api.person.tools/mcp --header "Authorization: Bearer YOUR_KEY_HERE"
```

**If your AI can make web requests** (an agent, a program, an assistant with a web-request tool), give it the key and this
prompt (copy it, put your key where it says). A chat that can do neither can't send an ask yet.

```
You can ask me things through person.tools when you need my decision or an answer only I can give.

To ask: POST https://api.person.tools/v1/tasks
Headers: Authorization: Bearer YOUR_KEY_HERE and Content-Type: application/json
Body: {"title": "a few words", "step": {"type": "question", "text": "your question", "choices": ["Yes", "No"]},
       "unlocks": "what my answer lets you do", "urgency": "today"}
It answers with a task_id.

To read my answer: GET https://api.person.tools/v1/tasks/TASK_ID with the same Authorization header. When "state" is
"done" or "answered", "reply" holds my answer: "reply.choice" is the choice I picked, "reply.text" a line I wrote, and
"reply.action" says how I answered (answer, done, approve, deny or not_now). Check every minute or so; I answer when I see it.
Or add "webhook": "https://your-address" to the ask: my answer is POSTed there when I give it, signed. The header
x-person-tools-signature is "v1=" and the HMAC-SHA256 of "<x-person-tools-timestamp>.<body>" with this webhook secret:
YOUR_WEBHOOK_SECRET_HERE. It is retried for up to 24 hours.

Rules: one ask, one step. A question has 2 to 4 choices, or leave out "choices" and I'll reply Done, Not now, or a line.
Other steps: {"type": "approve", "text": "exactly what you will do"} (I approve or deny; "reply.approved_text" is what I
approved), {"type": "link", "url": "https://...", "text": "what to do there"}, or {"type": "command", "command": "...",
"where": "where I run it"}. Urgency: "now" (first in my list, with a banner), "today" or "whenever". The title is 3 to 120
characters, "unlocks" up to 300, the step's text up to 4,000. Never put a password, a code or a key in an ask.
```

If your AI can only call an address, it can POST the same body to your connection's **link** instead (no header), and read
the answer at the link followed by `/TASK_ID`.

## 3. What happens next

Your AI places one ask. It reaches your phone as a notification from your person.tools page (open it on your phone, add it to
your Home Screen and allow notifications) or from the person.tools iPhone app, which is in testing now. It appears in your list
under the AI's name; you tap your answer, and your AI reads it from the same
address. If you'd rather not be asked, revoke the connection: its key stops at once and its open asks are withdrawn.

Asking you is free: no money, test or real. If you don't answer, the ask stays open up to 30 days and then lapses, and your AI
is told; it can withdraw the ask sooner. There is no default answer, so your AI decides what to do while it waits (a door stays
locked, a refund waits).

## How this differs from a notification app

ntfy, Telegram or Home Assistant are free, older and fine for an alert. What person.tools adds: your answer goes back to your AI
as data it can act on (the choice you picked, the exact text you approved, and when); all your AIs reach you in one place, each
under its own name, and any one can be revoked, quieted or blocked with one tap; you set when you can be asked; and nothing an AI
sends you is read by anyone at person.tools.

## What "preview" means

what works now is real. Your own AIs ask you, and your own people answer your calls, for free. Strangers are not offered yet, so any money you see is test money only: nothing is charged and nobody is paid until a stranger pool opens. Until then, a stand-in for strangers is open to any test key (its pool is named in the discovery file, under strangers_stand_in): scripted stand-ins answer in seconds, every answer is marked simulated, and nobody at the pool is asked or paid. person.tools is run by Hammer Corp., Austin, Texas.

person.tools is run by Hammer Corp., 1401 Lavaca St #41100, Austin, TX 78701. Questions: hello@person.tools. What we keep, and
for how long: [/privacy](/privacy).
