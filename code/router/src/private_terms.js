// The operator's private screen lists (owner/OWNER_all_9 item 5, 15 Nov 2026). Two JSON lists of patterns live in the
// service's database, table meta, keys 'withheld_terms' and 'private_terms' (the operator's own rule: what is never shared,
// and confidential material the operator names). The source carries the mechanism and no list. They are read at run time,
// cached at most 60 seconds in this isolate, and handed to the call screen (ctx.withheld_terms) and to the task bounds
// (withheldTerms, privateTerms). A list that cannot be read arrives empty, and the screen then holds every call to real
// people and the task bounds store nothing: the check fails closed, never open.
// The admin route adds one pattern (POST /internal/private_terms {"list", "add"}) and answers counts only (GET); no word is
// ever written to a log, an answer or a file.
export const PRIVATE_LISTS = ['withheld_terms', 'private_terms'];
const TTL_MS = 60000;
let CACHE = { at: 0, lists: null };

const clean = (v) => { try { const a = JSON.parse(v); return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x) : []; } catch { return []; } };

export async function privateLists(env, fresh = false) {
  const now = Date.now();
  if (!fresh && CACHE.lists && now - CACHE.at < TTL_MS) return CACHE.lists;
  const out = { withheld_terms: [], private_terms: [] };
  try {
    const r = await env.DB.prepare('SELECT k, v FROM meta WHERE k IN (\'withheld_terms\', \'private_terms\')').all();
    for (const row of (r && r.results) || []) out[row.k] = clean(row.v);
    CACHE = { at: now, lists: out };   // a failed read is not cached: the next call reads again
  } catch { }
  return out;
}

// for screen(call, ctx) and screenOutcome(text, ctx)
export async function screenTerms(env) { return { withheld_terms: (await privateLists(env)).withheld_terms }; }

// for taskBounds(task, opts): the database lists, plus the private setting while it still exists (never weaker than before)
export async function taskTerms(env) {
  const l = await privateLists(env);
  const fromSetting = String((env && env.TASK_PRIVATE_TERMS) || '').split('\n').map((x) => x.trim()).filter((x) => x && !x.startsWith('#'));
  return { withheldTerms: l.withheld_terms, privateTerms: [...new Set([...l.private_terms, ...fromSetting])] };
}

export const counts = (l) => ({ withheld_terms: l.withheld_terms.length, private_terms: l.private_terms.length });

// POST {"list": "withheld_terms" | "private_terms", "add": "<pattern>"} -> { added, counts }; the pattern is never echoed
export async function addPrivateTerm(env, b) {
  const list = b && b.list, p = b && typeof b.add === 'string' ? b.add.trim() : '';
  if (!PRIVATE_LISTS.includes(list)) return { error: ['list', 'list is "withheld_terms" or "private_terms".'] };
  if (!p || p.length > 300 || /[\r\n]/.test(p)) return { error: ['add', 'add is one pattern of 1 to 300 characters on one line.'] };
  try { new RegExp(`\\b(?:${p})\\b`, 'i'); } catch { return { error: ['add', 'add is not a valid pattern.'] }; }
  // one statement: creates the list, or appends the pattern only when the list does not already hold it
  const r = await env.DB.prepare(
    'INSERT INTO meta (k, v) VALUES (?, json_array(?)) ON CONFLICT(k) DO UPDATE SET v = json_insert(CASE WHEN json_valid(meta.v) AND json_type(meta.v) = \'array\' THEN meta.v ELSE \'[]\' END, \'$[#]\', ?) '
    + 'WHERE NOT EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(meta.v) AND json_type(meta.v) = \'array\' THEN meta.v ELSE \'[]\' END) WHERE value = ?)').bind(list, p, p, p).run();
  CACHE = { at: 0, lists: null };   // this isolate reads the new list at once; others within 60 seconds
  return { added: !!(r && r.meta && r.meta.changes === 1), counts: counts(await privateLists(env, true)) };
}
