// Who may be rung now (RING_RULES; trust's policy/RING_RULES.md refines these numbers).
// On / Off / On-for-a-time; quiet hours where the person is (default 9 PM to 8 AM); at most 4 rings an hour;
// at most one ring to a REAL person in 30 minutes (TEAM.md section 7, in code); two missed rings switch a real person Off.
export const RING = { quiet_default_start: 21, quiet_default_end: 8, max_rings_per_hour: 4, real_min_gap_ms: 30 * 60000 };

export function localHour(tz, ms) {
  try {
    const h = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).format(new Date(ms));
    return parseInt(h, 10) % 24;
  } catch { return new Date(ms).getUTCHours(); }
}

export function inQuietHours(m, ms) {
  const h = localHour(m.tz, ms);
  const a = m.quiet_start ?? RING.quiet_default_start, b = m.quiet_end ?? RING.quiet_default_end;
  if (a === b) return false;
  return a < b ? (h >= a && h < b) : (h >= a || h < b);
}

export function isOn(m, ms) {
  if (m.left_at) return false;
  if (m.on_state === 'on') return true;
  if (m.on_state === 'on_until') return m.on_until != null && ms < m.on_until;
  return false;
}

// Pure decision from the member row and its recent rings (so the baseline can check it without ringing anyone).
export function ringDecision(m, ms, recentRingTimes) {
  if (!isOn(m, ms)) return { ok: false, why: 'off' };
  if (inQuietHours(m, ms)) return { ok: false, why: 'quiet_hours' };
  if (m.is_real || m.alias === 'team-test real-rules bot') {   // the caps protect people; only marked test bots follow them too
    const lastHour = recentRingTimes.filter(t => t > ms - 3600000).length;
    if (lastHour >= RING.max_rings_per_hour) return { ok: false, why: 'four_an_hour' };
    const last = Math.max(m.last_ring_at || 0, ...recentRingTimes);
    if (last && ms - last < RING.real_min_gap_ms) return { ok: false, why: 'one_real_ring_in_30_minutes' };
  }
  return { ok: true };
}

// The team's quiet bot (MEMBER_QUIET on panel quiet-test, orders r2 item 3): its quiet hours always cover the present, so it
// is never rung and every call to its panel waits, saying when it could ring. Its 23-hour window is moved on by the tick
// once the free hour is less than two hours away, so the time a call says stays put for about 21 hours.
export async function keepQuietBotQuiet(env, ms) {
  const m = await env.DB.prepare('SELECT * FROM members WHERE id = \'mb_quiettest1\' AND is_real = 0 AND left_at IS NULL').first();
  if (!m || inQuietHours(m, ms + 2 * 3600000)) return false;
  const h = localHour(m.tz, ms);
  await env.DB.prepare('UPDATE members SET quiet_start = ?, quiet_end = ? WHERE id = ?').bind(h, (h + 23) % 24, m.id).run();
  return true;
}

// When this member could next be offered a seat, as far as their own settings say (null: when they switch On).
export function nextRingAt(m, ms) {
  if (m.left_at) return null;
  if (m.on_state === 'off' || (m.on_state === 'on_until' && !(m.on_until > ms))) return null;
  for (let k = 0; k <= 24 * 4; k++) {   // quarter-hours ahead
    const t = ms + k * 15 * 60000;
    if (m.on_state === 'on_until' && t >= m.on_until) return null;
    if (!inQuietHours(m, t)) return k === 0 ? ms : Math.floor(t / 900000) * 900000;
  }
  return null;
}

export async function panelOutlook(env, panelId, ms) {
  const ms_ = (await env.DB.prepare('SELECT * FROM members WHERE panel_id = ? AND left_at IS NULL').bind(panelId).all()).results || [];
  const out = { members: ms_.length, on_now: 0, off: 0, quiet: 0, earliest_ring_at: null };
  for (const m of ms_) {
    if (!isOn(m, ms)) { out.off++; continue; }
    if (inQuietHours(m, ms)) { out.quiet++; const t = nextRingAt(m, ms); if (t && (!out.earliest_ring_at || t < out.earliest_ring_at)) out.earliest_ring_at = t; continue; }
    out.on_now++; out.earliest_ring_at = ms;
  }
  return out;
}

export async function canRing(env, m, ms) {
  // RING_RULES rule 1 (trust, 4:28 PM CT): per person. ringDecision holds each person's own 30 minutes and four an hour.
  // when each standing offer started: its expiry less its hold (15 minutes on a private panel, else one minute)
  const rows = (await env.DB.prepare(`SELECT s.offer_expires_at - CASE WHEN c.panel_id IN (SELECT id FROM panels WHERE kind = 'private') THEN 900000 ELSE 60000 END AS t
      FROM seats s JOIN calls c ON c.id = s.call_id WHERE (s.offered_to = ? OR s.member_id = ?) AND s.offer_expires_at IS NOT NULL AND s.offer_expires_at > ?`)
    .bind(m.id, m.id, ms - 3600000).all()).results || [];
  return ringDecision(m, ms, rows.map(r => r.t));
}
