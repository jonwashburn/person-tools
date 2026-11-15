// Runs every case in cases.json through screen() once and writes RESULTS.md beside it. Exit 1 on any miss.
// Run: node code/router/src/screening/check.mjs (Node 22 or later)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { screenSync as screen, screenOutcome, SCREENING_VERSION } from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const { cases } = JSON.parse(readFileSync(join(here, "cases.json"), "utf8"));
// The red-team rewordings are kept out of the public copy (cases_private.json); run them when the file is here.
let privateCount = 0;
try { const p = JSON.parse(readFileSync(join(here, "cases_private.json"), "utf8")).cases; for (const k of p) cases.push({ ...k, private: true }); privateCount = p.length; }
catch (e) { if (e.code !== "ENOENT") throw e; }
const BASE = {
  ask: "Listen once. Then tell me what you felt, in your own words.",
  experience: { kind: "listen", media_id: "m_sample_melody30", seconds: 30 },
  respond: { fields: { felt: { type: "text" }, would_play_again: { type: "boolean" } } },
  who: { count: 3, enough: 2, pool: "simulated" },
  pay: { per_person_usd: "0.00", estimated_minutes: 2 },
  by_minutes: 30, max_total_usd: "0.00", idempotency_key: "case",
};
// a stand-in for the operator's withheld list (the real one is in the service's database, never in this source)
const STAND_IN = ["zorblat (?:rule|law)"];
const ctxOf = (c) => ({ withheld_terms: STAND_IN, ...(c || {}) });
let miss = 0;
const rows = [];
for (const k of cases) {
  const call = k.shape === "flat" || k.outcome ? { ...k.call } : { ...BASE, ...k.call };
  const r = k.outcome ? await screenOutcome(k.call.ask, ctxOf(k.ctx)) : screen(call, ctxOf(k.ctx));
  const rule = r.error?.rule ?? (r.hold ? r.hold.reasons.map((x) => x.rule).join("+") : "");
  let ok;
  if (k.expect === "NOT_ALLOW") ok = r.decision !== "ALLOW";
  else if (k.expect === "NOT_REFUSE") ok = r.decision !== "REFUSE";
  else ok = r.decision === k.expect && (!k.rule || (r.error ? r.error.rule === k.rule : r.hold ? r.hold.reasons.some((x) => x.rule === k.rule) : true))
    && (k.fixable === undefined || r.error?.fixable === k.fixable);
  if (!ok) miss++;
  const fx = r.error ? (r.error.fixable ? "fixable" : "not fixable") : "";
  rows.push(`| ${k.id} | ${k.private ? "(a private red-team rewording; not shown)" : (typeof call.ask === "string" ? call.ask : JSON.stringify(call.ask)).replace(/\|/g, "/").replace(/[​]/g, "[ZWSP]").slice(0, 90)} | ${k.expect}${k.rule ? " " + k.rule : ""} | ${r.decision} ${rule} ${fx} | ${ok ? "yes" : "**NO**"} |`);
  if (!ok) console.log("MISS", k.id, r.decision, rule, JSON.stringify(r.fired));
}
// The standard's floor (spec/screening_fixtures.json, SCREEN-7): every forbidden case refused or held; no allowed case refused.
try {
  const fx = JSON.parse(readFileSync(join(here, "../../../../spec/screening_fixtures.json"), "utf8"));
  for (const [set, list] of [["forbidden", fx.forbidden], ["allowed", fx.allowed]]) for (const [i, k] of list.entries()) {
    const call = { ...k, people: 3 }; delete call.category;
    for (const ctx of [{ key_class: "test", pool: "simulated", simulated: true }, { pool_real: true, principal_is_ours: false, principal_new: false }]) {
      const r = screen(call, ctxOf(ctx));
      const ok = set === "forbidden" ? r.decision !== "ALLOW" && (!k.category || r.decision !== "REFUSE" || r.category === k.category) : r.decision !== "REFUSE";
      if (!ok) { miss++; console.log("MISS spec fixture", set, i, r.decision, r.category, k.category || ""); }
      rows.push(`| spec ${set} ${i + 1} | ${k.ask.replace(/\|/g, "/").slice(0, 90)} | ${set === "forbidden" ? "REFUSE or HOLD" + (k.category ? " " + k.category : "") : "not REFUSE"} | ${r.decision} ${r.category || ""} | ${ok ? "yes" : "**NO**"} |`);
    }
  }
} catch (e) { console.log("spec fixtures not read:", e.message); }
const when = new Date().toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" }) + " CT";
writeFileSync(join(here, "RESULTS.md"), `# Screening cases, run once\n\nScreening ${SCREENING_VERSION}, ${when}. ${rows.length} checks (${cases.length - privateCount} public cases, ${privateCount ? privateCount + " private red-team cases" : "no private red-team cases in this copy"}, and the standard's fixtures), ${rows.length - miss} as expected, ${miss} missed.\n\n| Case | Ask | Expected | Got | As expected |\n|---|---|---|---|---|\n${rows.join("\n")}\n`);
console.log(`${rows.length} checks, ${miss} missed`);
process.exit(miss ? 1 : 0);
