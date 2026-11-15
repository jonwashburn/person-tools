// Deletion on time (policy/DATA.md, ops/RETENTION_JOBS.md), run by /internal/tick (the supervisor calls it every five
// minutes). Bounded work per run; the tick returns how many rows each job deleted.
// Money lines stay (the ledger keeps ids and amounts only, kept 7 years); everything else of a call goes.
const DAY = 86400000;

// Everything of one call but its money lines: events, responses, receipts, seats, held record, the call.
async function deleteCall(env, callId) {
  const seats = '(SELECT id FROM seats WHERE call_id = ?)';
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM events WHERE seat_id IN ${seats}`).bind(callId),
    env.DB.prepare('DELETE FROM responses WHERE call_id = ?').bind(callId),
    env.DB.prepare('DELETE FROM receipts WHERE call_id = ?').bind(callId),
    env.DB.prepare('DELETE FROM seats WHERE call_id = ?').bind(callId),
    env.DB.prepare('DELETE FROM held_calls WHERE call_id = ?').bind(callId),
    env.DB.prepare('DELETE FROM calls WHERE id = ?').bind(callId),
  ]);
}

export async function retention(env, now, until = Infinity) {
  const late = () => Date.now() > until;   // bounded: the tick answers within its budget; the rest waits for the next tick
  const out = { idempotency: 0, events: 0, self_calls: 0, test_principals: 0, keyless_calls: 0, members_left: 0, old_calls: 0, held_records: 0 };
  // 1. idempotency records: 7 days
  out.idempotency = (await env.DB.prepare('DELETE FROM idempotency WHERE created_at < ?').bind(now - 7 * DAY).run()).meta.changes;
  // 2. events: 30 days after the call closes (no appeals table yet)
  out.events = (await env.DB.prepare('DELETE FROM events WHERE id IN (SELECT e.id FROM events e JOIN seats s ON s.id = e.seat_id JOIN calls c ON c.id = s.call_id WHERE c.closed_at IS NOT NULL AND c.closed_at < ? LIMIT 500)').bind(now - 30 * DAY).run()).meta.changes;
  if (late()) return out;
  // 3. the front page's demo calls (pool self): 24 hours after close, with the visitor's member row
  for (const c of (await env.DB.prepare('SELECT id FROM calls WHERE panel_id = \'p_self\' AND closed_at IS NOT NULL AND closed_at < ? LIMIT 20').bind(now - DAY).all()).results || []) {
    await deleteCall(env, c.id);
    await env.DB.prepare('DELETE FROM members WHERE id = ?').bind('mb_self_' + c.id.slice(5)).run();
    out.self_calls++;
  }
  if (late()) return out;
  // 5. keyless calls: 30 days after close
  for (const c of (await env.DB.prepare('SELECT id FROM calls WHERE principal_id = \'pr_anonymous\' AND panel_id IS NOT \'p_self\' AND closed_at IS NOT NULL AND closed_at < ? LIMIT 20').bind(now - 30 * DAY).all()).results || []) {
    await deleteCall(env, c.id); out.keyless_calls++;
  }
  if (late()) return out;
  // 4. test principals (never the team's, never pr_anonymous) 30 days after their keys' last use (a call, or the key's making)
  // never a person's connected AI: its principal stays while the person keeps it (its own retention is in own.js)
  const idle = (await env.DB.prepare(`SELECT p.id FROM principals p WHERE p.class = 'test' AND p.team = 0 AND p.id != 'pr_anonymous'
      AND p.id NOT IN (SELECT principal_id FROM connections)
      AND COALESCE((SELECT MAX(created_at) FROM calls c WHERE c.principal_id = p.id), p.created_at) < ?
      AND NOT EXISTS (SELECT 1 FROM calls c WHERE c.principal_id = p.id AND c.closed_at IS NULL)
      -- a principal whose panels are already closed waits for its members' rows to go (rule 10) without taking a place here
      AND NOT EXISTS (SELECT 1 FROM panels pn JOIN members m ON m.panel_id = pn.id WHERE pn.principal_id = p.id AND pn.join_code_hash LIKE 'gone:%') LIMIT 10`).bind(now - 30 * DAY).all()).results || [];
  for (const p of idle) {
    // OWN_PANELS.md rule 10: its panels close and each member is told once; the principal waits until those members are gone
    try {
      const { closePrincipalPanels } = await import('./panels.js');
      if ((await closePrincipalPanels(env, p.id, 'stopped using it, so it was closed after 30 days')) > 0) continue;
    } catch { continue; }
    for (const c of (await env.DB.prepare('SELECT id FROM calls WHERE principal_id = ?').bind(p.id).all()).results || []) await deleteCall(env, c.id);
    try { await env.DB.prepare('DELETE FROM pool_accounts WHERE principal_id = ?').bind(p.id).run(); } catch { }   // a connected pool account goes with its principal
    try { await env.DB.prepare('DELETE FROM stranger_requests WHERE principal_id = ?').bind(p.id).run(); } catch { }   // DATA.md stranger_requests: with its principal
    await env.DB.batch([env.DB.prepare('DELETE FROM keys WHERE principal_id = ?').bind(p.id), env.DB.prepare('DELETE FROM principals WHERE id = ?').bind(p.id)]);
    out.test_principals++;
  }
  if (late()) return out;
  // 6. members who left: their link to past seats is removed, then the row
  for (const m of (await env.DB.prepare('SELECT id FROM members WHERE left_at IS NOT NULL AND left_at < ? AND (gone_note IS NULL OR left_at < ?) LIMIT 50').bind(now - DAY, now - 30 * DAY).all()).results || []) {
    await env.DB.batch([
      env.DB.prepare('UPDATE seats SET member_id = NULL WHERE member_id = ?').bind(m.id),
      env.DB.prepare('UPDATE seats SET offered_to = NULL WHERE offered_to = ?').bind(m.id),
      env.DB.prepare('UPDATE receipts SET member_id = NULL WHERE member_id = ?').bind(m.id),
      env.DB.prepare('DELETE FROM members WHERE id = ?').bind(m.id),
    ]);
    out.members_left++;
  }
  if (late()) return out;
  // 8. calls of real principals: 13 months after close (money lines kept)
  for (const c of (await env.DB.prepare('SELECT id FROM calls WHERE closed_at IS NOT NULL AND closed_at < ? LIMIT 20').bind(now - 395 * DAY).all()).results || []) {
    await deleteCall(env, c.id); out.old_calls++;
  }
  // 13. quotes: one day
  try { out.quotes = (await env.DB.prepare('DELETE FROM quotes WHERE created_at < ?').bind(now - DAY).run()).meta.changes; } catch { }
  // 14. tester feedback: 90 days (the one-tap leave deletes it at once)
  try { out.feedback = (await env.DB.prepare('DELETE FROM feedback WHERE created_at < ?').bind(now - 90 * DAY).run()).meta.changes; } catch { }
  try { out.stranger_requests = (await env.DB.prepare('DELETE FROM stranger_requests WHERE created_at < ?').bind(now - 90 * DAY).run()).meta.changes; } catch { }
  // OWNER_router_13: an ask nobody answered lapses at 30 days (never a default answer); its webhook says so; the row stays 30 more days
  try {
    const due = (await env.DB.prepare('SELECT * FROM tasks WHERE state = \'open\' AND created_at < ? LIMIT 50').bind(now - 30 * DAY).all()).results || [];
    for (const t of due) {
      const r = await env.DB.prepare('UPDATE tasks SET state = \'lapsed\', lapsed_at = ? WHERE id = ? AND state = \'open\'').bind(now, t.id).run();
      if (r.meta.changes === 1 && t.webhook_url && t.connection_id) { try { const { queueAnswer } = await import('./own.js'); await queueAnswer(env, { ...t, state: 'lapsed' }); } catch { } }
    }
    out.tasks_lapsed = due.length;
    out.tasks = (await env.DB.prepare('DELETE FROM tasks WHERE (state = \'lapsed\' AND lapsed_at < ?) OR (state NOT IN (\'open\', \'lapsed\') AND COALESCE(answered_at, created_at) < ?)').bind(now - 30 * DAY, now - 180 * DAY).run()).meta.changes;
  } catch { }
  // 10. held-call records: 13 months after the decision
  out.held_records = (await env.DB.prepare('DELETE FROM held_calls WHERE released_at IS NOT NULL AND released_at < ?').bind(now - 395 * DAY).run()).meta.changes;
  // 9. askers' media (uploaded or copied in): 30 days after the last call using it closes; never a seeded sample. The stored
  //    file goes only when no other row still points at it (the same file uploaded twice shares one object).
  if (!late()) {
    out.media = 0;
    // a brand's pictures stay while its brand does (OWNER_router_9); they go with the principal
    const old = (await env.DB.prepare('SELECT id, r2_key FROM media WHERE sample = 0 AND created_at < ? AND r2_key NOT LIKE \'brand/%\' ORDER BY RANDOM() LIMIT 10').bind(now - 30 * DAY).all()).results || [];
    for (const m of old) {
      const inUse = await env.DB.prepare('SELECT 1 AS x FROM calls WHERE spec_json LIKE ? AND (closed_at IS NULL OR closed_at > ?) LIMIT 1').bind('%"' + m.id + '"%', now - 30 * DAY).first();
      if (inUse) continue;
      const shared = await env.DB.prepare('SELECT COUNT(*) AS n FROM media WHERE r2_key = ? AND id != ?').bind(m.r2_key, m.id).first();
      if (env.MEDIA && m.r2_key && !(shared && shared.n > 0)) { try { await env.MEDIA.delete(m.r2_key); } catch { continue; } }
      await env.DB.prepare('DELETE FROM media WHERE id = ?').bind(m.id).run();
      out.media++;
      if (late()) break;
    }
  }
  // 15. a person's own material, connections revoked 30 days ago, webhook deliveries (OWNER_all_10; DATA.md, policy/CONNECTIONS.md)
  if (!late()) { try { const { ownRetention } = await import('./own.js'); Object.assign(out, await ownRetention(env, now)); } catch (e) { out.own_error = String(e && e.message || e).slice(0, 120); } }
  // 7 waits for December 2027; 11 has no table.
  return out;
}
