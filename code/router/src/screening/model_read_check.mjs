// Checks model_read.js's combining rules and its daily stop once, with stand-in clients (no network, no key), and
// model_budget.js's SQL on a real SQLite table shaped like the router's `meta` (node:sqlite). Exit 1 on any miss.
import { screen } from "./index.js";
import { BUDGET, readCostCents } from "./model_read.js";
import { d1Budget } from "./model_budget.js";
const OUT = { pool_real: true, principal_is_ours: false, principal_new: false, withheld_terms: ["zorblat (?:rule|law)"] };   // a stand-in list
let calls = 0;
const fake = (answer, opts = {}) => ({ beta: { messages: { create: async () => {
  calls++;
  if (opts.throws) throw new Error("network down");
  if (opts.slow) await new Promise((r) => setTimeout(r, 9000));
  const usage = opts.usage ?? { input_tokens: 300, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0, output_tokens: 400 };
  if (opts.refusal) return { stop_reason: "refusal", content: [], usage };
  return { stop_reason: "end_turn", content: [{ type: "text", text: opts.raw ?? JSON.stringify(answer) }], usage };
} } } });
const memBudget = (start = 0, opts = {}) => { const b = { spent: start, async spentToday() { if (opts.readFails) throw new Error("db down"); return opts.nan ? "x" : b.spent; },
  async add(c) { if (opts.addFails) throw new Error("db down"); b.spent += c; } }; return b; };
const plain = { ask: "Which of these two logos is clearer? Say why.", kind: "answer", people: 3 };
const political = { ask: "Would this ad for a candidate change your vote?", kind: "answer", people: 3 };
const allow = { decision: "ALLOW", category: "none", reason: "a reaction" };
const cases = [
  ["model ALLOW lifts outside_unread", plain, fake(allow), memBudget(), "ALLOW"],
  ["model REFUSE refuses", plain, fake({ decision: "REFUSE", category: "credentials", reason: "asks for a code" }), memBudget(), "REFUSE"],
  ["model HOLD stays held", plain, fake({ decision: "HOLD", category: "none", reason: "unsure" }), memBudget(), "HOLD"],
  ["client error stays held", plain, fake(null, { throws: true }), memBudget(), "HOLD"],
  ["model refusal stays held", plain, fake(null, { refusal: true }), memBudget(), "HOLD"],
  ["unparseable answer stays held", plain, fake(null, { raw: "ALLOW!" }), memBudget(), "HOLD"],
  ["a political hold is never lifted", political, fake(allow), memBudget(), "HOLD"],
  ["no client: rules alone", plain, null, memBudget(), "HOLD"],
  ["timeout stays held", plain, fake(null, { slow: true }), memBudget(), "HOLD"],
  ["a client without a budget never reads", plain, fake(allow), null, "HOLD", { noCall: true }],
  ["the cap reached: no read, held for a person", plain, fake(allow), memBudget(BUDGET.cap_cents_per_day - BUDGET.worst_read_cents + 0.01), "HOLD", { noCall: true, reason: /daily cap/ }],
  ["just under the cap: reads", plain, fake(allow), memBudget(BUDGET.cap_cents_per_day - BUDGET.worst_read_cents - 0.01), "ALLOW"],
  ["spend unreadable: no read", plain, fake(allow), memBudget(0, { readFails: true }), "HOLD", { noCall: true }],
  ["spend not a number: no read", plain, fake(allow), memBudget(0, { nan: true }), "HOLD", { noCall: true }],
  ["counting fails after a read: the answer still stands", plain, fake(allow), memBudget(0, { addFails: true }), "ALLOW"],
];
let miss = 0;
for (const [name, call, client, budget, want, o = {}] of cases) {
  const before = calls, spentBefore = budget ? budget.spent : 0;
  const r = await screen(call, { ...OUT, modelClient: client, modelBudget: budget });
  let ok = r.decision === want;
  if (o.noCall && calls !== before) ok = false;
  if (o.reason && !(r.model_read && o.reason.test(r.model_read.reason))) ok = false;
  if (client && !o.noCall && budget && !name.startsWith("counting fails") && !name.startsWith("a political") && !(budget.spent > spentBefore)) ok = false;   // every read is counted
  if (!ok) miss++;
  console.log(ok ? "ok  " : "MISS", name, "->", r.decision, r.model_read ? JSON.stringify(r.model_read).slice(0, 90) : "", budget ? `spent ${Number(budget.spent).toFixed(4)}c` : "");
}
// The price of a typical read: 300 fresh input, 4000 cached system, 400 output tokens.
const typical = readCostCents({ input_tokens: 300, cache_read_input_tokens: 4000, output_tokens: 400 });
const priceOk = Math.abs(typical - (300 * 500 + 4000 * 50 + 400 * 2500) / 1e6) < 1e-9 && readCostCents(null) === BUDGET.worst_read_cents
  && readCostCents({ input_tokens: 9000, output_tokens: 2000 }) <= BUDGET.worst_read_cents;   // the dearest read fits under worst_read_cents
console.log(priceOk ? "ok  " : "MISS", `read price: typical ${typical} cents; 9000 in + 2000 out = ${readCostCents({ input_tokens: 9000, output_tokens: 2000 })} <= ${BUDGET.worst_read_cents}`);
if (!priceOk) miss++;
// model_budget.js on a real SQLite table (the D1 statements, through a small D1-shaped wrapper).
let sqlOk = true, sqlNote = "";
try {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  const D1 = { prepare: (sql) => ({ bind: (...a) => ({ first: async () => db.prepare(sql).get(...a) ?? null, run: async () => db.prepare(sql).run(...a) }) }) };
  let t = Date.parse("2026-11-14T22:00:00Z");   // 4:00 PM in Chicago
  const b = d1Budget(D1, () => t);
  db.prepare("INSERT INTO meta (k, v) VALUES (?, ?)").run("model_read_cents:2026-11-10", "5");
  await b.add(1.25); await b.add(2.5);
  const s1 = await b.spentToday();
  t = Date.parse("2026-11-15T07:00:00Z");   // 1:00 AM in Chicago, the next day
  const s2 = await b.spentToday(); await b.add(0.5);
  const keys = db.prepare("SELECT k FROM meta ORDER BY k").all().map((r) => r.k).join(",");
  sqlOk = s1 === 3.75 && s2 === 0 && (await b.spentToday()) === 0.5 && !keys.includes("2026-11-10") && keys.includes("2026-11-14") && keys.includes("2026-11-15");
  sqlNote = `same day ${s1}, next day ${s2}, rows ${keys}`;
} catch (e) { sqlOk = false; sqlNote = String(e && e.message || e); }
console.log(sqlOk ? "ok  " : "MISS", "model_budget.js on SQLite:", sqlNote);
if (!sqlOk) miss++;
console.log(`${cases.length + 2} model-read checks, ${miss} missed`); process.exit(miss ? 1 : 0);
