// GET /v1/proof: what the service has done with real people and for outsiders, counted, never described person by person.
// CEO.md keeps two numbers: real calls answered end to end (ours apart from outsiders'), and outside principals who made a
// call. Ours and outside are read only from principals.owner, recorded when the principal is made (OWNER_router_5, the CEO
// 11:21 AM CT 15 Nov 2026): 'team' when the admin route or our own checks (the team header) made it, 'outside' otherwise;
// a visitor's front-page demo key ('visitor') and keyless calls ('keyless') are neither. A row without an owner counts as
// outside, so nothing is ever hidden. Our own real calls are listed, with whether the people were told what their answers changed (never the line itself);
// outsiders' calls are only counted. No answer, no person, no ask is ever shown here.
import { iso } from './util.js';

const DAY = 86400000;
// OWNER_router_5: the only test of ours and outside (a missing owner counts as outside: nothing is hidden)
const OURS_P = `p.owner = 'team'`;
const OUTSIDER_P = `COALESCE(p.owner, 'outside') = 'outside'`;
// a request with a key reads its principal's owner (corrections included); without a key, or once the principal is gone, its own
const ASKED_OUTSIDE = `COALESCE(p.owner, s.owner, 'outside') = 'outside'`;
const ANSWERED = (call) => `EXISTS (SELECT 1 FROM responses r JOIN seats s ON s.id = r.seat_id LEFT JOIN members m ON m.id = s.member_id
      WHERE r.call_id = ${call} AND r.simulated = 0 AND s.state = 'answered' AND (m.id IS NULL OR m.is_real = 1))`;
const REAL_POOL = (c) => `(${c}.panel_id IN (SELECT id FROM panels WHERE kind = 'private') OR (${c}.pool_ref IS NOT NULL AND ${c}.simulated = 0))
      AND ${c}.key_id NOT IN (SELECT id FROM keys WHERE label LIKE 'standin%')`;

export async function proof(env) {
  const now = Date.now();
  // answered by a person: the team's headless members (is_real 0, the 'team bot' marks of TRUST's proofs included) never count
  const answered = `EXISTS (SELECT 1 FROM responses r JOIN seats s ON s.id = r.seat_id LEFT JOIN members m ON m.id = s.member_id
      WHERE r.call_id = c.id AND r.simulated = 0 AND s.state = 'answered' AND (m.id IS NULL OR m.is_real = 1))`;
  // a live key the owner made for a proof (label standin-*) rings only the team's bots on a private panel: never a real call
  const realPool = `(c.panel_id IN (SELECT id FROM panels WHERE kind = 'private') OR (c.pool_ref IS NOT NULL AND c.simulated = 0))
      AND c.key_id NOT IN (SELECT id FROM keys WHERE label LIKE 'standin%')`;
  const rc = await env.DB.prepare(`SELECT SUM(CASE WHEN ${OURS_P} THEN 1 ELSE 0 END) AS ours, SUM(CASE WHEN ${OUTSIDER_P} THEN 1 ELSE 0 END) AS outsiders
      FROM calls c JOIN principals p ON p.id = c.principal_id WHERE ${realPool} AND ${answered}`).first();
  const outside = await env.DB.prepare(`SELECT COUNT(DISTINCT p.id) AS n FROM principals p JOIN calls c ON c.principal_id = p.id WHERE ${OUTSIDER_P}`).first();
  // keyless callers: our own checks send the team header, which marks their keyless calls 'anon:team:'
  const keyless = await env.DB.prepare(`SELECT COUNT(DISTINCT key_id) AS n FROM idempotency
      WHERE op = 'call' AND status = 201 AND key_id LIKE 'anon:%' AND key_id NOT LIKE 'anon:team:%' AND created_at > ?`).bind(now - 7 * DAY).first();
  let asked = { n: 0 };
  try {
    asked = await env.DB.prepare(`SELECT COUNT(DISTINCT s.asker) AS n FROM stranger_requests s LEFT JOIN principals p ON p.id = s.principal_id WHERE ${ASKED_OUTSIDE}`).first();
  } catch { }
  const ours = (await env.DB.prepare(`SELECT c.id, c.kind, c.outcomes_json,
        (SELECT MIN(r.created_at) FROM responses r WHERE r.call_id = c.id AND r.simulated = 0) AS first_at,
        (SELECT COUNT(*) FROM seats s WHERE s.call_id = c.id AND s.state = 'answered') AS people
      FROM calls c JOIN principals p ON p.id = c.principal_id WHERE ${OURS_P} AND ${realPool} AND ${answered}
      ORDER BY c.created_at DESC LIMIT 20`).all()).results || [];
  const shown = [];
  for (const c of ours) {
    const lines = (() => { try { return JSON.parse(c.outcomes_json || '[]').filter(o => o.status === 'delivered'); } catch { return []; } })();
    let line = lines.length ? lines[lines.length - 1].text : null, kept = false;
    if (line) {
      const aliases = ((await env.DB.prepare('SELECT m.alias FROM seats s JOIN members m ON m.id = s.member_id WHERE s.call_id = ? AND s.state = \'answered\'').bind(c.id).all()).results || [])
        .map(r => String(r.alias || '').trim()).filter(Boolean);
      const words = new Set(aliases.flatMap(a => [a, ...a.split(/\s+/).filter(w => w.length >= 2)]).map(w => w.toLowerCase()));
      const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const names = [...words].some(w => new RegExp('(^|[^\\p{L}\\p{N}])' + esc(w) + '($|[^\\p{L}\\p{N}])', 'iu').test(line));
      if (/["\u201C\u201D\u2018\u2019]/.test(line) || names) { line = null; kept = true; }
    }
    // operations 1:25 PM CT 15 Nov: the line an asker sent a person is written to that person, and often in their words; it is never
    // shown in public. Only that one was sent.
    // a public line the asker wrote for anyone (or, on the first call's record, the line operations rewrote at 1:27 PM CT, which keeps
    // the text sent to him apart as text_sent_to_person); nothing else
    const last = lines.length ? lines[lines.length - 1] : null;
    const pub = last ? (last.public || (last.text_sent_to_person ? last.text : null)) : null;
    const da = await env.DB.prepare('SELECT COUNT(*) AS n FROM responses WHERE call_id = ? AND device_approved = 1').bind(c.id).first().catch(() => null);
    shown.push({ answered_at: iso(c.first_at), kind: c.kind, people_answered: c.people, ...(da && da.n ? { device_approved_answers: da.n, device_approved_means: 'the owner of an enrolled, Apple-attested device approved this answer with Face ID' } : {}), outcome_sent: !!(line || kept), ...(pub ? { outcome_public: pub } : (line || kept) ? { outcome_kept_private: true } : {}) });
  }
  return {
    real_calls_answered: { ours: (rc && rc.ours) || 0, outsiders: (rc && rc.outsiders) || 0 },
    outside_principals_with_a_call: (outside && outside.n) || 0,
    keyless_outside_callers_last_7_days: (keyless && keyless.n) || 0,
    outsiders_who_asked_for_real_people: (asked && asked.n) || 0,
    // the CEO (OWNER_all_8 item 1): a task counts only when a real person answered it: the member who answered is a person
    // (not a headless test member) on a panel the operator made; tasks are placed only by the operator's own keys, so
    // outsiders' answered tasks are 0 by construction
    real_tasks_answered: await (async () => { try {
      const t = await env.DB.prepare(`SELECT COUNT(*) AS ours FROM tasks k JOIN principals p ON p.id = k.principal_id JOIN members m ON m.id = k.answered_by
          JOIN panels pn ON pn.id = k.panel_id JOIN principals pp ON pp.id = pn.principal_id
          WHERE k.state IN ('done', 'answered') AND ${OURS_P} AND m.is_real = 1 AND pp.class = 'real'`).first();
      return { ours: (t && t.ours) || 0, outsiders: 0 }; } catch { return { ours: 0, outsiders: 0 }; } })(),
    ours: shown,
    counted_at: iso(now),
    how_counted: 'A real call is one answered by at least one real person (not simulated) on a private panel or an outside pool. Ours are made by our own programs; outsiders are everyone else, as recorded when each principal was made. An outside principal counts once it has made any call, free or paid; keys our own checks make, and the front page\'s demo for visitors, never count. Keyless callers are counted by address for the last 7 days only (we keep no more).',
  };
}

// OWNER_router_5 items 4 and 5: every principal /v1/proof counts as outside, every keyless outside asker, and every member
// counted as a person on a panel that is not the operator's own, each with how it came to be; and the numbers they make,
// which must equal /v1/proof's (the baseline checks it at every deploy). Ids and dates only: no name a person chose.
export async function proofAudit(env) {
  const pr = (await env.DB.prepare(`SELECT p.id, p.class, p.owner, p.owner_note, p.name LIKE 'Test principal %' AS self_made, p.created_at,
        (SELECT GROUP_CONCAT(DISTINCT k.label) FROM keys k WHERE k.principal_id = p.id) AS key_labels,
        (SELECT COUNT(*) FROM calls c WHERE c.principal_id = p.id) AS calls,
        (SELECT COUNT(*) FROM calls c WHERE c.principal_id = p.id AND ${REAL_POOL('c')} AND ${ANSWERED('c.id')}) AS real_calls_answered,
        (SELECT COUNT(*) FROM stranger_requests s WHERE s.principal_id = p.id) AS asked_for_strangers,
        (SELECT COUNT(*) FROM panels pn WHERE pn.principal_id = p.id AND pn.kind = 'private') AS panels
      FROM principals p WHERE ${OUTSIDER_P}
        AND (EXISTS (SELECT 1 FROM calls c WHERE c.principal_id = p.id) OR EXISTS (SELECT 1 FROM stranger_requests s WHERE s.principal_id = p.id))
      ORDER BY p.created_at`).all()).results || [];
  const keylessAsked = (await env.DB.prepare(`SELECT COUNT(DISTINCT s.asker) AS n, MIN(s.created_at) AS first FROM stranger_requests s LEFT JOIN principals p ON p.id = s.principal_id
      WHERE p.id IS NULL AND COALESCE(s.owner, 'outside') = 'outside'`).first()) || {};
  const members = (await env.DB.prepare(`SELECT m.id, m.panel_id, m.created_at, m.left_at, pp.id AS principal_id, pp.class, pp.owner,
        (SELECT COUNT(*) FROM seats s WHERE s.member_id = m.id AND s.state = 'answered') AS answered
      FROM members m JOIN panels pn ON pn.id = m.panel_id JOIN principals pp ON pp.id = pn.principal_id
      WHERE m.is_real = 1 AND pp.class != 'real' ORDER BY m.created_at`).all()).results || [];
  const how = (p) => p.owner_note ? 'set by the operator: ' + p.owner_note
    : p.owner === null ? 'made without an owner recorded (the minute of a deploy)'
    : p.self_made ? 'a self-made test key from an address that did not send the team header' : 'made by ' + (p.key_labels || 'a key');
  const t = (ms) => ms ? new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z') : null;
  return {
    outside_principals: pr.map(p => ({ principal_id: p.id, class: p.class, made: t(p.created_at), how: how(p), calls: p.calls, real_calls_answered: p.real_calls_answered,
      asked_for_strangers: p.asked_for_strangers, private_panels: p.panels })),
    askers_for_strangers_without_a_principal: { count: keylessAsked.n || 0, first: t(keylessAsked.first), how: 'asked without a key (or the principal is gone) and without the team header' },
    people_on_panels_not_the_operators: members.map(m => ({ member_id: m.id, panel_id: m.panel_id, panel_principal: m.principal_id, principal_owner: m.owner,
      joined: t(m.created_at), left: t(m.left_at), answered: m.answered,
      how: 'joined through the panel\'s link without the team header' })),
    numbers: {
      real_calls_answered_outsiders: pr.reduce((a, p) => a + (p.real_calls_answered || 0), 0),
      outside_principals_with_a_call: pr.filter(p => p.calls > 0).length,
      outsiders_who_asked_for_real_people: pr.filter(p => p.asked_for_strangers > 0).length + (keylessAsked.n || 0),
    },
    note: 'Ids and dates only. Every row is a principal or a person /v1/proof counts as outside; expected none from our own tools.',
  };
}
