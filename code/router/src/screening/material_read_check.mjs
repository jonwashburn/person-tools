// Checks material_read.js's locks once, with stand-in clients (no network, no key). Exit 1 on any miss.
// Run: node code/router/src/screening/material_read_check.mjs (Node 22)
import { screen } from "./index.js";
import { MATERIAL_READ } from "./material_read.js";
const OUT = { key_class: "real", pool_real: true, principal_is_ours: false, principal_new: false, withheld_terms: ["zorblat (?:rule|law)"] };   // a stand-in list
let calls = 0;
const fake = (callAns, matAns, o = {}) => ({ beta: { messages: { create: async (req) => {
  calls++;
  const isMaterial = /files/.test(JSON.stringify(req.messages));
  if (isMaterial && o.throws) throw new Error("network down");
  const a = isMaterial ? matAns : callAns;
  return { stop_reason: "end_turn", usage: { input_tokens: 2000, output_tokens: 200 }, content: [{ type: "text", text: JSON.stringify(a) }] };
} } } });
const budget = (spent = 0) => ({ spent, async spentToday() { return this.spent; }, async add(c) { this.spent += c; } });
const ok = { decision: "ALLOW", category: "none", reason: "a reaction" };
const page = (html) => [{ content_type: "text/html", bytes: html.length, text: html }];
const plainPage = page("<!doctype html><html><body><h1>Budget app</h1><form><label>Name <input></label><button>Next</button></form><script>document.querySelector('button').onclick=()=>alert('Thanks')</script></body></html>");
const view = { ask: "Look at this sign-up page. Is it clear what to do next? Use made-up details.", kind: "view", content: "m_page", people: 3 };
const play = { ask: "Play the first level. Where did you get stuck?", kind: "play", content: "m_build", people: 3 };
const listen = { ask: "Listen once, to the end. Then say what you felt.", kind: "listen", content: "m_song", people: 3 };
const big = page("<p>" + "x".repeat(MATERIAL_READ.max_bytes + 10) + "</p>");
const cases = [
  ["a plain page, both reads ALLOW, sandboxed: ALLOW", view, { material: plainPage, sandbox_ok: true }, fake(ok, ok), "ALLOW"],
  ["a page with a picture: held, no material read", view, { material: page("<p>Hi</p><img src='m_x.png'>"), sandbox_ok: true }, fake(ok, ok), "HOLD", /pictures/],
  ["a page that decodes text at run time: held", view, { material: page("<script>document.body.textContent=atob('aGk=')</script>"), sandbox_ok: true }, fake(ok, ok), "HOLD", /run time/],
  ["a page naming an outside address: held", view, { material: page("<a href='https://example.com'>more</a>"), sandbox_ok: true }, fake(ok, ok), "HOLD", /outside/],
  ["over 100 KB: held", view, { material: big, sandbox_ok: true }, fake(ok, ok), "HOLD", /100 KB/],
  ["not known to be sandboxed: held", view, { material: plainPage, sandbox_ok: false }, fake(ok, ok), "HOLD", /sandboxed/],
  ["a game build while builds are off: held", play, { material: plainPage, sandbox_ok: true }, fake(ok, ok), "HOLD", /not read by a model yet/],
  ["a game build with builds on, sandboxed: ALLOW", play, { material: plainPage, sandbox_ok: true, material_builds_enabled: true }, fake(ok, ok), "ALLOW"],
  ["a song: never read, held", listen, { material: [{ content_type: "audio/mpeg", bytes: 1000, text: null }], sandbox_ok: true }, fake(ok, ok), "HOLD"],
  ["the material read refuses: REFUSE", view, { material: plainPage, sandbox_ok: true }, fake(ok, { decision: "REFUSE", category: "deception", reason: "a look-alike bank login" }), "REFUSE"],
  ["the material read holds: held", view, { material: plainPage, sandbox_ok: true }, fake(ok, { decision: "HOLD", category: "none", reason: "unsure" }), "HOLD"],
  ["the material read fails: held", view, { material: plainPage, sandbox_ok: true }, fake(ok, ok, { throws: true }), "HOLD", /material read failed/],
  ["the cap is reached: held", view, { material: plainPage, sandbox_ok: true, _spent: 1990 }, fake(ok, ok), "HOLD", /daily cap/],
  ["the call read holds: no material read, held", view, { material: plainPage, sandbox_ok: true }, fake({ decision: "HOLD", category: "none", reason: "unsure" }, ok), "HOLD"],
  ["SVG as text, plain: ALLOW", view, { material: [{ content_type: "image/svg+xml", bytes: 120, text: "<svg xmlns='http://www.w3.org/2000/svg'><text x='1' y='9'>Hi</text></svg>" }], sandbox_ok: true }, fake(ok, ok), "ALLOW"],
];
let miss = 0;
for (const [name, call, extra, client, want, why] of cases) {
  const b = budget(extra._spent || 0);
  const r = await screen(call, { ...OUT, ...extra, modelClient: client, modelBudget: b });
  let good = r.decision === want;
  if (why && !(r.material_read && why.test(r.material_read.reason || "")) && !(r.model_read && why.test(r.model_read.reason || "")) && !(r.hold?.reply && why.test(r.hold.reply.why || ""))) good = false;
  if (!good) miss++;
  console.log(good ? "ok  " : "MISS", name, "->", r.decision, r.material_read ? JSON.stringify(r.material_read).slice(0, 100) : "", r.hold?.fix ? "| fix: " + r.hold.fix.why.slice(0, 80) : "");
}
console.log(`${cases.length} material-read checks, ${miss} missed`); process.exit(miss ? 1 : 0);
