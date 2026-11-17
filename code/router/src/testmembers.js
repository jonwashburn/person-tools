// OWNER_router_37 (spec 26.13, MEMBER-24; PROTOCOL's order request item 42; TRUST's five conditions): a conformance run's test member.
// POST /v1/test/members with a test key and {}: 201 {member_id, member_token, test: true, expires_at}. The member has a page of its own
// (its panel belongs to the key's principal and has no join link), so only that principal and the AIs the member itself connects reach
// it; it is not a real person (is_real 0), so it is never offered a call from a pool, never counted in a public number or a proof, and
// it sees test brands. No name, contact or alias is taken. At most five live per test key; each is removed after 29 days with all it
// holds (the timer, below), and its row goes a day after that.
import { rid, nowMs, iso, sha256hex } from './util.js';
import { fixable, notFixable } from './spec.js';
const DAY = 86400000, LIFE = 29 * DAY, MAX_LIVE = 5;
export const testMark = (m) => (m && m.test_key_id ? { test: true } : {});
export async function makeTestMember(env, request, key, b) {
  if (!key || key.anon) throw fixable('unauthorized', 'Authorization', 'A test member needs a test key: POST /v1/keys {"class": "test"} gives one.', 'Bearer test_...', {}, 401);
  if (key.class !== 'test' || key.connection) throw fixable('forbidden_for_key_class', 'Authorization', 'Test members are made only with a test key, never with a key that can reach a real person.', null, {}, 403);
  for (const k of Object.keys(b || {})) throw fixable('unknown_field', k, 'Send {}: a test member takes no name, contact or alias.', null);
  const now = nowMs();
  const live = await env.DB.prepare('SELECT COUNT(*) AS n FROM members WHERE test_key_id = ? AND left_at IS NULL').bind(key.id).first();
  if (live && live.n >= MAX_LIVE) throw notFixable(429, 'rate_limited', `At most ${MAX_LIVE} live test members per test key: one leaves (POST /v1/member/leave {"confirm": true}) or is removed when it expires.`, { retry_after_seconds: 3600 });
  const pn = rid('p_'), mb = rid('mb_'), tok = rid('mt_', 32);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO panels (id, principal_id, name, kind, join_code_hash, created_at, asker_name) VALUES (?,?,?,?,?,?,?)').bind(pn, key.principal_id, 'test member ' + pn, 'private', 'self:test:' + rid('x', 24), now, null),
    env.DB.prepare('INSERT INTO members (id, panel_id, token_hash, alias, is_real, tz, quiet_start, quiet_end, on_state, adult_at, notice_id, notice_at, us_resident_at, created_at, person_name, test_key_id, test_until) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(mb, pn, await sha256hex(tok), '', 0, 'America/Chicago', 0, 0, 'on', now, null, null, now, now, 'you', key.id, now + LIFE),
  ]);
  return { member_id: mb, member_token: tok, test: true, expires_at: iso(now + LIFE) };
}
// the timer: a test member past its time is removed with all it holds (its asks and answers, the AIs it connected, its records); the
// row itself goes a day later with the other members who left (retention step 6)
export async function expireTestMembers(env, now, limit = 10) {
  const rows = (await env.DB.prepare('SELECT id, panel_id FROM members WHERE test_key_id IS NOT NULL AND left_at IS NULL AND test_until < ? LIMIT ?').bind(now, limit).all()).results || [];
  for (const m of rows) {
    try { const { deleteOwn } = await import('./own.js'); await deleteOwn(env, 'task_id IN (SELECT id FROM tasks WHERE panel_id = ?)', [m.panel_id], 200); } catch { }
    const onPanel = '(SELECT id FROM tasks WHERE panel_id = ?)', seatIds = '(SELECT id FROM seats WHERE member_id = ?)';
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM webhook_deliveries WHERE task_id IN ${onPanel}`).bind(m.panel_id),
      env.DB.prepare(`DELETE FROM task_passes WHERE task_id IN ${onPanel}`).bind(m.panel_id),
      env.DB.prepare('DELETE FROM tasks WHERE panel_id = ?').bind(m.panel_id),
      env.DB.prepare('UPDATE connections SET revoked_at = ? WHERE member_id = ? AND revoked_at IS NULL').bind(now, m.id),
      env.DB.prepare(`DELETE FROM responses WHERE seat_id IN ${seatIds}`).bind(m.id),
      env.DB.prepare('DELETE FROM receipts WHERE member_id = ?').bind(m.id),
      env.DB.prepare('DELETE FROM feedback WHERE member_id = ?').bind(m.id),
      env.DB.prepare('UPDATE members SET token_hash = ?, alias = \'\', push_json = NULL, apns_token = NULL, apns_env = NULL, tz = \'\', on_state = \'off\', on_until = NULL, left_at = ? WHERE id = ?').bind('left:' + m.id, now, m.id),
      env.DB.prepare('UPDATE panels SET join_code_hash = ? WHERE id = ?').bind('gone:test:' + m.panel_id, m.panel_id),
    ]);
    try { await (await import('./people.js')).leaveCleanup(env, m.id); } catch { }
  }
  return rows.length;
}
