// The model read's daily spend, kept in the router's own `meta` table (policy/DATA.md, row `meta`: settings and counters
// the router keeps for itself; no data about any person). One row a day, keyed by the date in Chicago:
// model_read_cents:YYYY-MM-DD -> cents spent that day. Rows older than two days are deleted when a read is counted.
// The router passes ctx.modelBudget = d1Budget(env.DB) with ctx.modelClient (screening/README.md).
const PREFIX = "model_read_cents:";
const DAY_MS = 86400000;
function chicagoDate(ms) { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(ms)); }

export function d1Budget(db, now = () => Date.now()) {
  return {
    async spentToday() {
      const row = await db.prepare("SELECT v FROM meta WHERE k = ?").bind(PREFIX + chicagoDate(now())).first();
      const v = row ? Number(row.v) : 0;
      if (!Number.isFinite(v)) throw new Error("spend row unreadable");
      return v;
    },
    async add(cents) {
      const c = Number(cents);
      if (!Number.isFinite(c) || c <= 0) return;
      await db.prepare("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = CAST(CAST(meta.v AS REAL) + CAST(excluded.v AS REAL) AS TEXT)")
        .bind(PREFIX + chicagoDate(now()), String(c)).run();
      await db.prepare("DELETE FROM meta WHERE k LIKE 'model_read_cents:%' AND k < ?").bind(PREFIX + chicagoDate(now() - 2 * DAY_MS)).run();
    },
  };
}
