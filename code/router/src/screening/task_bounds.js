// The bounds on a TASK (policy/TASKS.md, 15 Nov 2026). TRUST owns these bounds; the router calls taskBounds() when a task is created, before anything
// is stored, and refuses (422, with the fix) when it answers ok:false. Pure: no I/O, no clock.
//
// A task never carries:
//   1. a key's or token's value (name the file instead), nor a step that puts one on the screen;
//   2. a subject the operator does not share (the operator's own rule), and
//   3. confidential material the operator names: neither list is in this file (this file is public); the router reads both
//      from the service's database and passes them in as opts.withheldTerms and opts.privateTerms (patterns). With either list
//      missing or empty, every task is refused until it can be read (the check fails closed);
// and it is ONE step: one command to copy, or one link to open, or one question with two to four choices.
//
// taskBounds(task, { withheldTerms, privateTerms, knownSecrets = [] }) -> { ok: true } | { ok: false, code, field, why, fix }
//   knownSecrets: the service's own secret values (the router may pass its env secrets); any of them anywhere is refused.

import { withheldRegexps, foldForNames } from "./index.js";

export const TASK_BOUNDS_VERSION = "1.3.0";

// --- 1. key and token values -------------------------------------------------------------------------------------------
// Shapes of secrets, matched on the raw text (case kept). Each is long enough that ordinary words never match.
const KEY_SHAPES = [
  [/\bsk-ant-[A-Za-z0-9_-]{16,}/, "an Anthropic key"],
  [/\b(?:test|real|live)_[A-Za-z0-9]{16,}/, "a person.tools key"],
  [/\b(?:mt|st)_[a-z0-9]{16,}/, "a member's or seat's private token"],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/, "a GitHub token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "an AWS key"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, "a Slack token"],
  [/\bsk_(?:live|test)_[A-Za-z0-9]{16,}|\brk_(?:live|test)_[A-Za-z0-9]{16,}|\bwhsec_[A-Za-z0-9]{16,}/, "a card processor's key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "a signed token"],
  [/\bBearer\s+[A-Za-z0-9._~+\/-]{20,}=*/i, "a bearer token"],
  // NAME=value where the name says key/token/secret (not an _ID, _NAME, _FILE, _PATH or _URL) and the value is not a
  // placeholder (<x>, {x}, $X) or a path, and has a digit
  [/\b(?![A-Z0-9_]*_(?:ID|NAME|FILE|PATH|URL|ENV)\s*[=:])[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PAT|P8)[A-Z0-9_]*\s*[=:]\s*["']?(?![<{$\/~.])(?=[^\s"'<>]*\d)[^\s"'<>]{8,}/, "a secret set to its value"],
  [/\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd)\s*[=:]\s*["']?(?![<{$\/~.])(?=[^\s"'<>]*\d)[^\s"'<>]{8,}/i, "a secret set to its value"],
  [/[?&](?:token|key|api_key|apikey|access_token|sig|signature|x-amz-signature|password)=[^&\s]{8,}/i, "a token in a link"],
  [/\bhttps?:\/\/[^\s\/:@]+:[^\s\/@]+@/i, "a password in a link"],
];
// A long run of mixed letters and digits with no spaces reads as a secret (a 40-character hex commit id does not: hex only).
const HIGH_ENTROPY = /(?<![A-Za-z0-9_\/.-])(?=[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-]))(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{32,}/;
// For the service's other paths (a person's sends to their people, an AI's asks, notes, replies): the same list of key shapes,
// so every path refuses or masks the same values (TRUST, router_18 attack, 15 Nov 2026: a card processor's live key got through
// a send and an AI's ask, whose narrower pattern missed it).
export function keyShapeIn(text) { const s = String(text ?? ""); for (const [rx, what] of KEY_SHAPES) if (rx.test(s)) return what; return HIGH_ENTROPY.test(s) ? "a long run of mixed letters and digits" : null; }
export function maskKeyShapes(text) { let s = String(text ?? ""); for (const rx of [...KEY_SHAPES.map((k) => k[0]), HIGH_ENTROPY]) s = s.replace(new RegExp(rx.source, rx.flags.replace("g", "") + "g"), "[removed]"); return s; }
// A step that would put a secret on the screen (so it could be copied into a chat): printing a key file or the environment.
// Only in a command, and only when the output lands on the terminal (a pipe or a redirect sends it elsewhere).
const SECRET_FILE = String.raw`(?:\S*\.env\b|\S*\.p8\b|\S*\.pem\b|\S*\bid_(?:rsa|ed25519)\b|\S*secrets?\/\S*|\S*\.config\/humancall\S*)`;
const TO_SCREEN = String.raw`(?=\s*(?:$|;|&&|\n))`;
const SHOWS_SECRET = new RegExp(String.raw`(?:^|[;&(]\s*|\$\(\s*)(?:sudo\s+)?(?:cat|less|more|head|tail|bat|nano|vi|vim|open|code)\s+[^|;&\n>]*${SECRET_FILE}[^|;&\n>]*${TO_SCREEN}` +
  String.raw`|(?:^|[;&(]\s*)(?:echo|printf)\s+[^|;&\n>]*\$\{?[A-Z_]*(?:KEY|TOKEN|SECRET|PASSWORD)\b[^|;&\n>]*${TO_SCREEN}|^\s*(?:printenv|env|set)\s*$`, "m");

// --- 2 and 3. the operator's two lists: read at run time, never in this source ----------------------------------------

// --- the shape: one step ---------------------------------------------------------------------------------------------
const STEP_FIELDS = ["command", "link", "question"];
const LIST_MARKERS = /(?:^|\n)\s*(?:\d{1,2}[.)]|[a-d][.)]|[-*•])\s+\S/g;
const MORE_STEPS = /\b(?:and then|after that|then also)\b|\bnext,?\s+(?:please\s+)?(?:run|open|click|go|do|make|send|paste|type|sign|create|add|turn|set|upload|save|copy|reply|enter|choose|install|deploy)\b|\bsecond(?:ly)?,/i;

function strings(v, path = "", out = []) {
  if (typeof v === "string") out.push([path || "task", v]);
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${path}[${i}]`, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) strings(x, path ? `${path}.${k}` : k, out);
  return out;
}
const no = (code, field, why, fix) => ({ ok: false, code, field, why, fix });

export function taskBounds(task, opts = {}) {
  if (!task || typeof task !== "object" || Array.isArray(task)) return no("bad_task", "task", "A task is an object.", 'Send {"title", "step": {"command" | "link" | "question"}, ...}.');
  const privateRx = (Array.isArray(opts.privateTerms) ? opts.privateTerms : []).filter(Boolean).map((t) => { try { return new RegExp(t, "i"); } catch { return null; } }).filter(Boolean);
  const withheldRx = withheldRegexps(opts.withheldTerms);
  if (!withheldRx.length || !privateRx.length) return no("list_unreadable", "task", "The operator's lists could not be read just now, so nothing was stored.", "Send it again in a minute.");
  const known = (opts.knownSecrets || []).filter((x) => typeof x === "string" && x.length >= 12);
  for (const [field, raw] of strings(task)) {
    for (const k of known) if (raw.includes(k)) return no("secret_in_task", field, "This task carries one of the service's own secret values.", "Name the file that holds it; never its value.");
    for (const [rx, what] of KEY_SHAPES) if (rx.test(raw)) return no("secret_in_task", field, `This looks like ${what}'s value. A task never carries a key or token.`, "Name the file that holds it (for example ~/.config/humancall/<name>.env) and what to do with it; never paste the value.");
    if (HIGH_ENTROPY.test(raw)) return no("secret_in_task", field, "A long run of mixed letters and digits reads as a key or token. A task never carries one.", "Name the file that holds it; if it is not a secret (an id), shorten it or say what it is.");
    if (/(?:^|\.)command$/.test(field) && SHOWS_SECRET.test(raw)) return no("shows_secret", field, "This step would print a key or the environment on the screen, where it can be copied into a chat.", "Use the file directly (for example: wrangler secret put NAME < file) or name the file; do not print it.");
    const folded = foldForNames(raw);
    if (withheldRx.some((rx) => rx.test(raw) || rx.test(folded))) return no("withheld_material", field, "This touches a subject the operator does not share, in a task or anywhere else.", "Leave it out; ask the owner in person.");
    for (const rx of privateRx) if (rx.test(raw) || rx.test(folded)) return no("private_material", field, "This carries confidential material the operator names, which never goes into a task.", "Leave it out; name the file on his own machine if he needs to open it.");
  }
  // one step
  const step = task.step && typeof task.step === "object" ? task.step : task;
  const given = STEP_FIELDS.filter((f) => step[f] !== undefined && step[f] !== null && step[f] !== "");
  if (given.length === 0) return no("no_step", "step", "A task has one exact step: a command to copy, a link to open, or a question with two to four choices.", 'Add step.command, step.link or step.question (with step.choices).');
  if (given.length > 1) return no("one_step", "step", `This task has ${given.join(" and ")}; a task is one step.`, "Send each as its own task: four asks are four tasks.");
  const f = given[0], v = step[f];
  if (typeof v !== "string") return no("bad_step", `step.${f}`, `step.${f} is text.`, null);
  if (f === "link") {
    let u; try { u = new URL(v); } catch { return no("bad_link", "step.link", "The link is not a web address.", "Send one https:// link."); }
    if (u.protocol !== "https:") return no("bad_link", "step.link", "Only https:// links open from a task.", "Send one https:// link.");
    if (/\s/.test(v.trim())) return no("one_step", "step.link", "One link per task.", "Send each link as its own task.");
  }
  if (f === "question") {
    const ch = step.choices;
    if (ch !== undefined && (!Array.isArray(ch) || ch.length < 2 || ch.length > 4 || ch.some((c) => typeof c !== "string" || !c.trim() || c.length > 80)))
      return no("bad_choices", "step.choices", "A question offers two to four choices, each a short line (at most 80 characters), or none for a typed answer.", null);
    if ((v.match(/\?/g) || []).length > 1) return no("one_step", "step.question", "This asks more than one question; a task is one.", "Send each question as its own task.");
  }
  const several = (x) => typeof x === "string" && ((x.match(LIST_MARKERS) || []).length >= 2 || MORE_STEPS.test(x));
  if (several(task.title)) return no("one_step", "title", "This reads as several steps; a task is one.", "Send each step as its own task: four asks are four tasks.");
  if (f !== "command" && several(v)) return no("one_step", `step.${f}`, "This reads as several steps; a task is one.", "Send each step as its own task: four asks are four tasks.");
  if (typeof task.title === "string" && task.title.length > 120) return no("long_title", "title", "The title is at most 120 characters.", null);
  if (task.urgency !== undefined && !["now", "today", "whenever"].includes(task.urgency)) return no("bad_urgency", "urgency", 'Urgency is "now", "today" or "whenever".', null);
  return { ok: true };
}

// --- the screen for a task (the CEO, 8:56 AM CT 15 Nov 2026: "a task's text passes the SAME SCREEN as any call (a command or
// a link is exactly what a screen is for)") ---------------------------------------------------------------------------------
// screenTask runs the call screen (screenSync) on the task's words and keeps every content rule it fires (barred subjects,
// credentials, other people's data, children, disguised words, the soft words for money, violence, weapons...). It sets aside
// only what the call screen holds because a CALL must be an ask of the person's own reaction inside our page: "no question
// about the person's own reaction", "an instruction", a link to outside material, signing in to an account, using another
// platform. In a task those ARE the step; what makes a step dangerous is checked by the task rules below instead.
import { screenSync, RULES } from "./index.js";

const TASK_SET_ASIDE = new Set(["outside_material", "off_platform", "accounts", "outside_unread"]);
const SHAPE_UNDECIDED = /^(?:no ask|no question about the person's own reaction|an instruction|a request beyond reacting|an action beyond reacting|a step that is not the person's own reaction|not a reaction)/i;
// soft words that are ordinary in a task's step (the rest of the soft list stays: money, crypto, weapons, violence, explicit...)
const TASK_WORDS = /^(?:verif\w*|upload\w*|attach\w*|confirm\w*|sign\w*|sign ?(?:in|up|out)|log ?(?:in|out)|login|register\w*|install\w*|download\w*|open|visit|go|copy|paste|subscribe|click\w*|tap|search|google|join|invite|record|print|email|e-mail|send|share|forward|text|message|keys?|tokens?|api keys?|passwords?|secrets?|credentials?|codes?|the person'?s? own|an email address)$/i;
const OUR_MAIL = /^[^@\s]+@(?:[a-z0-9-]+\.)*person\.tools$/i;

// a command that harms the machine, runs code fetched from elsewhere, or sends private files out
export const SHELL_DANGER = [
  [/\b(?:curl|wget|fetch|iwr|invoke-webrequest)\b[^|\n]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|dash|ksh|fish|python3?|perl|ruby|node|php|iex|invoke-expression)\b/i, "runs code fetched from the web"],
  [/\b(?:bash|sh|zsh)\s+(?:-c\s+)?["']?\$?\(?\s*(?:curl|wget)\b|\beval\s+["']?\$\(\s*(?:curl|wget)\b|<\(\s*(?:curl|wget)\b/i, "runs code fetched from the web"],
  [/\bbase64\s+(?:-d|--decode|-D)\b[^|\n]*\|\s*(?:sh|bash|zsh|python3?)\b/i, "runs hidden code"],
  [/(?:^|[;&|(]\s*)sudo\b/m, "runs as the machine's administrator"],
  [/\brm\s+(?:-[a-zA-Z]*\s+)*-?[a-zA-Z]*[rR][a-zA-Z]*\s+(?:-[a-zA-Z]+\s+)*(?:~\/?|\/|\$HOME\/?|\*|\.\.?\/?)(?:\s|$)/, "deletes a whole folder tree"],
  [/\bchmod\s+(?:-R\s+)?(?:777|a\+rwx)\b|\b(?:spctl\s+--master-disable|csrutil\s+disable|xattr\s+-[a-z]*d[a-z]*\s+com\.apple\.quarantine|defaults\s+write\s+\S*(?:gatekeeper|LSQuarantine))/i, "turns off the machine's protections"],
  [/\b(?:dd\s+if=|mkfs\b|diskutil\s+(?:erase|zero)|format\s+[a-z]:)/i, "erases a disk"],
  [/\b(?:curl|wget|scp|rsync|sftp|nc|ncat)\b[^\n]*(?:\.ssh\b|id_(?:rsa|ed25519)|\.env\b|\.p8\b|\.pem\b|secrets?\/|\.config\/humancall|keychain|\.aws\/credentials|\.netrc)/i, "sends a private file out"],
  [/\b(?:crontab\s+-r|launchctl\s+(?:load|bootstrap)|osascript\s+-e)\b/i, "changes what the machine runs on its own"],
];
const SHORTENERS = /^(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|ow\.ly|buff\.ly|cutt\.ly|rb\.gy|shorturl\.at|tiny\.cc|rebrand\.ly|s\.id|t\.ly|v\.gd)$/i;
const KNOWN_HOSTS = /(?:^|\.)(?:person\.tools|apple\.com|cloudflare\.com|google\.com|github\.com|githubusercontent\.com|prolific\.com|prolific\.co|stripe\.com|anthropic\.com|claude\.ai|claude\.com|zenodo\.org|npmjs\.com|python\.org|pypi\.org|icloud\.com|developer\.apple\.com)$/i;
const BAIT_LABEL = /(?:^|[.-])(?:log-?in|sign-?in|verify|verification|secure|security|account|accounts|wallet|bank|banking|update|support|password|unlock|recover|recovery|billing|invoice|refund|helpdesk)(?:[.-]|$)/i;
const RUNNABLE = /\.(?:exe|dmg|pkg|mpkg|msi|apk|sh|command|scpt|app|jar|bat|cmd|ps1|vbs|js|zip)(?:[?#]|$)/i;
const URL_RX = /\b(?:https?|ftp|file|data|javascript):[^\s"'<>)]*/gi;
// asking for a secret in the ANSWER (it would be stored with us): the key's file name or its id is fine
const SECRET_IN_ANSWER = /\b(?:reply|answer|type|paste|enter|send|give|tell|write)\b[^.\n?]{0,40}\b(?:the |your |its |a )?(?:key|token|password|passphrase|secret|passcode|pin|one-time code|2fa code|verification code|api key|private key|seed phrase|recovery phrase)\b(?! (?:id|ids|file|files|name|names|path)\b)/i;

// Only words the person answers with count (a command's answer is Done); a clause that says NOT to share it, or that is about a
// record published in public DNS (a site-verification line), is not asking for a secret (owner 10:08 AM CT: three honest tasks
// for the operator were refused: "never paste the token into a chat", "reply with it here (it is not a secret)", a TXT record).
const NEGATED = /\b(?:never|don'?t|do not|not)\b[^,;]{0,12}$/i;   // right before the verb
const PUBLIC_RECORD = /\b(?:txt record|dns (?:line|record)|in dns|site-verification|verification (?:line|record))\b/i;
function secretInAnswer(parts) {
  for (const [f, v] of parts) {
    if (/(?:^|\.)command$/.test(f)) continue;
    for (const c of String(v).split(/[.;!?\n()]+/)) {
      const m = SECRET_IN_ANSWER.exec(c);
      if (!m) continue;
      if (NEGATED.test(c.slice(0, m.index)) || /\bnot an? (?:secret|key|token|password)\b/i.test(m[0]) || (PUBLIC_RECORD.test(c) && !/\b(?:password|passphrase|pin|seed|private key|api key|token)\b/i.test(c))) continue;
      return true;
    }
  }
  return false;
}
function hostOf(u) { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } }

export function screenTask(task, ctx = {}) {
  const parts = strings(task).filter(([f]) => !/^(?:urgency|asker\.session|idempotency_key|to|panel)$/.test(f));
  const text = parts.map(([, v]) => v).join("\n");
  const out = (decision, rule, why, fix, fired) => ({ decision, rule, why, fix, fired, task_screen: TASK_BOUNDS_VERSION });
  // the task rules first
  const command = parts.filter(([f]) => /(?:^|\.)command$/.test(f)).map(([, v]) => v).join("\n");
  for (const [rx, what] of SHELL_DANGER) if (rx.test(command)) return out("REFUSE", "task_dangerous_command", `This command ${what}. A task never asks a person to run that.`, "If it is truly needed, the owner asks in person.", [{ rule: "task_dangerous_command", matched: what }]);
  for (const m of text.match(URL_RX) || []) {
    const u = m.replace(/[.,;:!]+$/, ""), h = hostOf(u);
    if (!/^https:\/\//i.test(u)) return out("REFUSE", "task_link", "Only https:// links go in a task.", "Send one https:// link.", [{ rule: "task_link", matched: u.slice(0, 60) }]);
    if (!h || /^\d{1,3}(?:\.\d{1,3}){3}$|^\[|:/.test(h) || /(?:^|\.)xn--/.test(h) || SHORTENERS.test(h) || /@/.test(u.split("/")[2] || ""))
      return out("REFUSE", "task_link", "This link hides where it goes (a bare address, a short link, or look-alike letters).", "Send the full https:// address of the real site.", [{ rule: "task_link", matched: h }]);
    if (!KNOWN_HOSTS.test(h) && BAIT_LABEL.test(h)) return out("HOLD", "task_link", `This link's address (${h}) reads like a sign-in or account page on a site we do not know.`, "A person reads it first; or link the service's own site.", [{ rule: "task_link", matched: h }]);
    if (!KNOWN_HOSTS.test(h) && RUNNABLE.test(new URL(u).pathname)) return out("HOLD", "task_link", `This link downloads a program from ${h}.`, "A person reads it first.", [{ rule: "task_link", matched: h }]);
  }
  if (secretInAnswer(parts)) return out("REFUSE", "task_secret_answer", "This asks for a secret in the answer, where it would be kept with us.", "Ask the person to save it as a file and reply with the file's name (or the key's id).", [{ rule: "task_secret_answer" }]);
  // the call screen, as for a call to real people from our own principal
  // a command is read by the shell rules above and the bounds; the call screen reads the words around it
  const words = parts.filter(([f]) => !/(?:^|\.)command$/.test(f) && !/(?:^|\.)link$/.test(f)).map(([, v]) => v).join("\n").replace(URL_RX, " (a link) ");   // links are judged by the link rules above
  const r = screenSync({ ask: words, kind: "answer" }, { withheld_terms: ctx.withheld_terms, ...ctx, pool_real: true, principal_is_ours: true, principal_new: false, purpose: "task" });
  const kept = (r.fired || []).filter((f) => {
    if (TASK_SET_ASIDE.has(f.rule)) return false;
    if (f.rule === "undecided") {
      const m = String(f.matched || "").trim();
      if (SHAPE_UNDECIDED.test(m) || TASK_WORDS.test(m)) return false;
      if (m === "an email address") return !(text.match(/\S+@\S+\.\w{2,}/g) || []).every((e) => OUR_MAIL.test(e.replace(/[.,;:!)]+$/, "")));
    }
    return true;
  });
  const refuse = kept.find((f) => (RULES[f.rule] || {}).outcome === "REFUSE");
  const hold = kept.find((f) => (RULES[f.rule] || {}).outcome !== "REFUSE");
  if (refuse) return out("REFUSE", refuse.rule, (RULES[refuse.rule] || {}).what || "The screen refuses this.", "Leave it out.", kept);
  if (hold) return out("HOLD", hold.rule, `${(RULES[hold.rule] || {}).what || "The screen holds this for a person"} (${String(hold.matched || "").slice(0, 60)})`, "A person reads it first; or reword it.", kept);
  return out("ALLOW", null, null, null, kept);
}

// One call for the router: the bounds, then the screen. { ok: true } | { ok: false, decision, code, field, why, fix }
export function checkTask(task, opts = {}) {
  const b = taskBounds(task, opts);
  if (!b.ok) return { ...b, decision: "REFUSE" };
  const s = screenTask(task, { withheld_terms: opts.withheldTerms, ...(opts.ctx || {}) });
  if (s.decision === "ALLOW") return { ok: true, screen: s };
  return { ok: false, decision: s.decision, code: s.rule, field: "task", why: s.why, fix: s.fix, screen: s };
}
