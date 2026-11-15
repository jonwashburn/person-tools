// BLOCK THE CALLER (owner/OWNER_router_4 item 1; SPEC 4.5.2 and 8.1 "blocks"): one tap blocks the principal behind a call or a task, for
// good, until the person removes it. It belongs to the person: it covers this membership and those linked to their passkey account. Offers, rings and tasks never reach a member who blocked the principal; the asker
// hears only "not available", never "blocked". The person's list names the principal by its display name, never its id.
import { rid, nowMs, iso } from './util.js';
import { fixable, notFixable } from './spec.js';

// the person's memberships the block covers: this one, and those linked to the same passkey account (each by its own credential).
// Never by name (TRUST 3:11; the CEO's 1:56 ruling: a name joins nothing).
async function siblings(env, m) {
  const ids = new Set([m.id]);
  try { for (const r of ((await env.DB.prepare(`SELECT member_id AS id FROM person_members WHERE person_id = (SELECT person_id FROM person_members WHERE member_id = ?)`).bind(m.id).all()).results || [])) ids.add(r.id); } catch { }
  return [...ids];
}

export async function addBlock(env, m, b) {
  for (const k of Object.keys(b || {})) if (!['call_id', 'task_id'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not a field here; send call_id or task_id.`, null);
  let pr = null;
  if (b && b.call_id) {   // a call on this member's panel: one they were shown, even after the offer lapsed (TRUST 3:11)
    pr = await env.DB.prepare('SELECT c.principal_id, COALESCE(c.asker_name, p.asker_name) AS seen FROM calls c LEFT JOIN panels p ON p.id = c.panel_id WHERE c.id = ? AND c.panel_id = ?').bind(String(b.call_id), m.panel_id).first();
  } else if (b && b.task_id) {   // a task on this member's list
    pr = await env.DB.prepare(`SELECT principal_id, program AS seen FROM tasks WHERE id = ? AND panel_id = ? AND (to_name = ? OR to_name = ?)`).bind(String(b.task_id), m.panel_id, m.person_name || '\u0000', 'mb:' + m.id).first();
  } else throw fixable('missing_field', 'call_id', 'Send the call_id or task_id of the ask whose asker you are blocking.', null);
  if (!pr) throw notFixable(404, 'not_found', 'No call or task of yours has that id.');
  // the name the person saw (TRUST 3:34): the asker's name on the card, the AI's name, or a brand that proved its domain; never an id
  const { brandOf } = await import('./cards.js'); const br = await brandOf(env, pr.principal_id).catch(() => null);
  const pn = await env.DB.prepare('SELECT name FROM principals WHERE id = ?').bind(pr.principal_id).first();
  const plain = pn && pn.name && !/\bpr_[a-z0-9]+|^(?:test|team check) principal\b/i.test(pn.name) ? pn.name : null;
  const p = { name: pr.seen || (br && br.name) || plain || 'an asker' };
  const now = nowMs(), mine = await siblings(env, m), id = rid('bk_');
  await env.DB.batch(mine.map((mid) => env.DB.prepare('INSERT OR IGNORE INTO blocks (id, member_id, principal_id, name, created_at) VALUES (?,?,?,?,?)').bind(mid === m.id ? id : rid('bk_'), mid, pr.principal_id, (p && p.name) || 'an asker', now)));
  // what it was still asking you is withdrawn from your list at once
  await env.DB.prepare(`UPDATE tasks SET state = 'withdrawn', withdrawn_at = ?, withdraw_why = 'You blocked this asker.' WHERE principal_id = ? AND state = 'open' AND panel_id IN (SELECT panel_id FROM members WHERE id IN (${mine.map(() => '?').join(',')}))`)
    .bind(now, pr.principal_id, ...mine).run();
  const row = await env.DB.prepare('SELECT id, name, created_at FROM blocks WHERE member_id = ? AND principal_id = ?').bind(m.id, pr.principal_id).first();
  return { block_id: row.id, name: row.name, since: iso(row.created_at), covers: mine.length, note: 'It cannot reach you any more. It is only told you are not available.' };
}
export async function listBlocks(env, m) {
  const rows = (await env.DB.prepare('SELECT id, name, created_at FROM blocks WHERE member_id = ? ORDER BY created_at DESC').bind(m.id).all()).results || [];
  return { blocks: rows.map((r) => ({ block_id: r.id, name: r.name, since: iso(r.created_at) })) };
}
export async function removeBlock(env, m, id) {
  const r = await env.DB.prepare('SELECT principal_id FROM blocks WHERE id = ? AND member_id = ?').bind(String(id || ''), m.id).first();
  if (!r) throw notFixable(404, 'not_found', 'No block of yours has that id.');
  const mine = await siblings(env, m);
  await env.DB.prepare(`DELETE FROM blocks WHERE principal_id = ? AND member_id IN (${mine.map(() => '?').join(',')})`).bind(r.principal_id, ...mine).run();
  return { block_id: id, removed: true };
}
// for the offer, ring and task paths: does any of these members block this principal?
export async function blocked(env, principalId, memberIds) {
  if (!memberIds.length) return false;
  try { return !!(await env.DB.prepare(`SELECT 1 AS x FROM blocks WHERE principal_id = ? AND member_id IN (${memberIds.map(() => '?').join(',')}) LIMIT 1`).bind(principalId, ...memberIds).first()); } catch { return false; }
}
