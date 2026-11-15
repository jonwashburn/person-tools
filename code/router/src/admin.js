// ADMIN (owner/OWNER_router_10 B, 12:54 PM CT 15 Nov 2026): one admin, two scopes, one interface. Every admin action is a route under
// /v1/admin/... with a role check and a log line (who, what, when, from which credential; never a secret's value).
// - OWNER SCOPE: whoever owns a principal manages its own people (who is on; make, label and revoke links), its AIs (connections,
//   quiet, revoke), and sees its own asks and answers. Granted per principal.
// - OPERATOR SCOPE, a superset: every principal, keys (make, suspend), held calls (release, refuse), /proof's numbers and its audit,
//   and who holds which scope. Who is an admin is the owner's word; nobody gets operator scope until the owner names them.
// Two clients: the console (people, signed in by passkey: a session ps_...) and operations' command line (agents, the operator key).
import { rid, nowMs, iso } from './util.js';
import { fixable, notFixable } from './spec.js';

const bearer = (request) => { const m = /^Bearer\s+(\S+)$/i.exec((request.headers.get('authorization') || '').trim()); return m ? m[1] : null; };

// -> { via, who, operator, owns: [principal ids] }
export async function actor(env, request) {
  const tok = bearer(request);
  if (tok && env.ADMIN_TOKEN && tok === env.ADMIN_TOKEN) return { via: 'operator key', who: 'operator key', operator: true, owns: [] };
  if (tok && /^ps_[a-z0-9]{20,80}$/.test(tok)) {
    const { personOf } = await import('./accounts.js');
    const person = await personOf(env, request, false);
    const op = await env.DB.prepare('SELECT 1 AS x FROM admins WHERE person_id = ? AND scope = \'operator\'').bind(person).first();
    const owns = ((await env.DB.prepare('SELECT principal_id FROM principal_admins WHERE person_id = ?').bind(person).all()).results || []).map(r => r.principal_id);
    return { via: 'passkey session', who: person, operator: !!op, owns };
  }
  throw fixable('unauthorized', 'Authorization', 'Admin needs a session from a passkey sign-in ("Bearer ps_...") or the operator key.', 'Bearer ps_...', {}, 401);
}
const canOwn = (a, principalId) => a.operator || a.owns.includes(principalId);
function needOperator(a) { if (!a.operator) throw notFixable(403, 'forbidden', 'This needs operator scope, which only the owner grants.'); }
async function needOwner(env, a, principalId) {
  if (!principalId || !canOwn(a, principalId)) throw notFixable(404, 'not_found', 'Nothing of yours has that id.');
}
async function log(env, a, action, target) {
  try { await env.DB.prepare('INSERT INTO admin_log (id, at, actor, via, action, target) VALUES (?,?,?,?,?,?)').bind(rid('al_'), nowMs(), a.who, a.via, action, String(target || '').slice(0, 200)).run(); } catch { }
}
async function panelOf(env, a, panelId) {
  const p = await env.DB.prepare('SELECT * FROM panels WHERE id = ?').bind(String(panelId || '')).first();
  if (!p) throw notFixable(404, 'not_found', 'Nothing of yours has that id.');
  await needOwner(env, a, p.principal_id); return p;
}
async function memberOf(env, a, memberId) {
  const m = await env.DB.prepare('SELECT m.*, p.principal_id FROM members m JOIN panels p ON p.id = m.panel_id WHERE m.id = ?').bind(String(memberId || '')).first();
  if (!m) throw notFixable(404, 'not_found', 'Nothing of yours has that id.');
  await needOwner(env, a, m.principal_id); return m;
}

export async function handleAdmin(env, request, path, body) {
  const a = await actor(env, request); const M = request.method; let m;
  if (path === '/v1/admin/me' && M === 'GET') return { who: a.who, via: a.via, scopes: { operator: a.operator, owner_of: a.owns } };

  // ---- owner scope ----
  if (path === '/v1/admin/principals' && M === 'GET') {
    const rows = a.operator ? ((await env.DB.prepare('SELECT id, name, class, owner FROM principals WHERE owner = \'team\' AND class = \'real\' ORDER BY created_at').all()).results || [])
      : await Promise.all(a.owns.map(id => env.DB.prepare('SELECT id, name, class, owner FROM principals WHERE id = ?').bind(id).first()));
    return { principals: rows.filter(Boolean).map(p => ({ principal_id: p.id, name: p.name, class: p.class })) };
  }
  if ((m = /^\/v1\/admin\/principals\/(pr_[a-z0-9]+)$/.exec(path)) && M === 'GET') {
    await needOwner(env, a, m[1]);
    const pr = await env.DB.prepare('SELECT id, name, class FROM principals WHERE id = ?').bind(m[1]).first(); if (!pr) throw notFixable(404, 'not_found', 'Nothing of yours has that id.');
    const panels = (await env.DB.prepare(`SELECT p.id, p.name, p.kind, p.created_at, (SELECT COUNT(*) FROM members x WHERE x.panel_id = p.id AND x.left_at IS NULL) AS people,
        (SELECT COUNT(*) FROM members x WHERE x.panel_id = p.id AND x.left_at IS NULL AND x.on_state = 'on') AS on_now FROM panels p WHERE p.principal_id = ? AND p.kind = 'private' AND COALESCE(p.join_code_hash, '') NOT LIKE 'gone:%'`).bind(m[1]).all()).results || [];
    return { principal_id: pr.id, name: pr.name, panels: panels.map(p => ({ panel_id: p.id, name: p.name, people: p.people, on_now: p.on_now, made_at: iso(p.created_at) })) };
  }
  if ((m = /^\/v1\/admin\/panels\/(p_[a-z0-9]+)\/people$/.exec(path)) && M === 'GET') {
    const p = await panelOf(env, a, m[1]);
    const rows = (await env.DB.prepare('SELECT id, person_name, on_state, is_real, created_at, apns_token IS NOT NULL AS app FROM members WHERE panel_id = ? AND left_at IS NULL ORDER BY created_at').bind(p.id).all()).results || [];
    return { panel_id: p.id, people: rows.map(r => ({ member_id: r.id, name: r.person_name || null, on: r.on_state === 'on', a_person: !!r.is_real, in_the_app: !!r.app, joined_at: iso(r.created_at) })) };
  }
  if ((m = /^\/v1\/admin\/panels\/(p_[a-z0-9]+)\/links$/.exec(path)) && M === 'GET') {
    const p = await panelOf(env, a, m[1]);
    const rows = (await env.DB.prepare('SELECT code_hash, label, max_joins, joins, created_at, revoked_at FROM join_links WHERE panel_id = ? ORDER BY created_at DESC LIMIT 100').bind(p.id).all()).results || [];
    return { panel_id: p.id, links: rows.map(r => ({ link_id: r.code_hash.slice(0, 16), for: r.label, joins: r.joins, max_joins: r.max_joins, made_at: iso(r.created_at), revoked_at: iso(r.revoked_at) })) };
  }
  if ((m = /^\/v1\/admin\/panels\/(p_[a-z0-9]+)\/links$/.exec(path)) && M === 'POST') {
    const p = await panelOf(env, a, m[1]);
    const { newPersonLink } = await import('./panels.js');
    const r = await newPersonLink(env, request, { principal_id: p.principal_id, id: 'admin', class: 'real' }, p.id, body);
    await log(env, a, 'made a join link' + (body && body.label ? ' for ' + String(body.label).slice(0, 40) : ''), p.id);
    return r;
  }
  if ((m = /^\/v1\/admin\/panels\/(p_[a-z0-9]+)\/links\/([0-9a-f]{16})$/.exec(path)) && M === 'DELETE') {
    const p = await panelOf(env, a, m[1]);
    const r = await env.DB.prepare('UPDATE join_links SET revoked_at = ? WHERE panel_id = ? AND substr(code_hash, 1, 16) = ? AND revoked_at IS NULL').bind(nowMs(), p.id, m[2]).run();
    await log(env, a, 'revoked a join link', p.id + ' ' + m[2]);
    return { link_id: m[2], revoked: r.meta.changes === 1 };
  }
  if ((m = /^\/v1\/admin\/members\/(mb_[a-z0-9]+)\/name$/.exec(path)) && M === 'POST') {
    const mm = await memberOf(env, a, m[1]);
    const n = body && body.name === null ? null : String((body && body.name) || '').trim().toLowerCase();
    if (n !== null && !/^[a-z][a-z0-9 _-]{0,39}$/.test(n)) throw fixable('invalid_field', 'name', 'name is 1 to 40 letters, digits, spaces, hyphens (null clears it).', 'sam');
    await env.DB.prepare('UPDATE members SET person_name = ? WHERE id = ? AND left_at IS NULL').bind(n, mm.id).run();
    if (n) { const { inheritSounds } = await import('./seats.js'); await inheritSounds(env, mm.id); }
    await log(env, a, 'named a member', mm.id); return { member_id: mm.id, name: n };
  }
  if ((m = /^\/v1\/admin\/members\/(mb_[a-z0-9]+)\/remove$/.exec(path)) && M === 'POST') {
    const mm = await memberOf(env, a, m[1]);
    const why = typeof (body && body.why) === 'string' && body.why.trim() ? body.why.trim().slice(0, 120) : null;
    if (!why) throw fixable('missing_field', 'why', 'why is one line the person reads.', 'the team changed');
    await env.DB.prepare('UPDATE members SET left_at = ?, on_state = \'off\', gone_note = ? WHERE id = ? AND left_at IS NULL').bind(nowMs(), 'Removed from the panel: ' + why, mm.id).run();
    await log(env, a, 'removed a member from a panel', mm.id); return { member_id: mm.id, removed: true };
  }
  if ((m = /^\/v1\/admin\/principals\/(pr_[a-z0-9]+)\/connections$/.exec(path)) && M === 'GET') {
    await needOwner(env, a, m[1]);
    const rows = (await env.DB.prepare(`SELECT c.id, c.name, c.icon, c.quiet, c.blocked, c.lab, c.created_at, c.last_used_at, c.member_id FROM connections c JOIN panels p ON p.id = c.panel_id
        WHERE p.principal_id = ? AND c.revoked_at IS NULL ORDER BY c.created_at`).bind(m[1]).all()).results || [];
    return { connections: rows.map(c => ({ connection_id: c.id, name: c.name, icon: String(c.icon || '').startsWith('img:') ? null : c.icon, quiet: !!c.quiet, blocked: !!c.blocked, lab: !!c.lab, for_member: c.member_id, made_at: iso(c.created_at), last_used_at: iso(c.last_used_at) })) };
  }
  if ((m = /^\/v1\/admin\/connections\/(cn_[a-z0-9]+)(?:\/(quiet))?$/.exec(path)) && (M === 'DELETE' || (M === 'POST' && m[2]))) {
    const c = await env.DB.prepare('SELECT c.*, p.principal_id FROM connections c JOIN panels p ON p.id = c.panel_id WHERE c.id = ? AND c.revoked_at IS NULL').bind(m[1]).first();
    if (!c) throw notFixable(404, 'not_found', 'Nothing of yours has that id.');
    await needOwner(env, a, c.principal_id);
    if (M === 'POST') { const q = !!(body && body.quiet !== false); await env.DB.prepare('UPDATE connections SET quiet = ? WHERE id = ?').bind(q ? 1 : 0, c.id).run(); await log(env, a, q ? 'quieted an AI' : 'let an AI ring', c.id); return { connection_id: c.id, quiet: q }; }
    const now = nowMs();
    await env.DB.batch([env.DB.prepare('UPDATE connections SET revoked_at = ? WHERE id = ?').bind(now, c.id), env.DB.prepare('UPDATE keys SET suspended_at = ? WHERE id = ? AND suspended_at IS NULL').bind(now, c.key_id),
      env.DB.prepare('UPDATE tasks SET state = \'withdrawn\', withdrawn_at = ?, withdraw_why = ? WHERE connection_id = ? AND state = \'open\'').bind(now, 'This AI was removed.', c.id)]);
    try { const { deleteOwn } = await import('./own.js'); await deleteOwn(env, 'connection_id = ?', [c.id], 200); } catch { }
    await log(env, a, 'revoked an AI', c.id); return { connection_id: c.id, revoked: true };
  }
  if ((m = /^\/v1\/admin\/principals\/(pr_[a-z0-9]+)\/asks$/.exec(path)) && M === 'GET') {
    await needOwner(env, a, m[1]);
    const rows = (await env.DB.prepare(`SELECT t.id, t.title, t.state, t.urgency, t.program, t.created_at, t.answered_at, t.reply_json, t.notes_json, t.to_name FROM tasks t
        JOIN panels p ON p.id = t.panel_id WHERE p.principal_id = ? OR t.principal_id = ? ORDER BY t.created_at DESC LIMIT 100`).bind(m[1], m[1]).all()).results || [];
    return { asks: rows.map(t => ({ task_id: t.id, title: t.title, state: t.state, urgency: t.urgency, from: t.program, made_at: iso(t.created_at), answered_at: iso(t.answered_at),
      reply: t.reply_json ? JSON.parse(t.reply_json) : null, notes: t.notes_json ? JSON.parse(t.notes_json).length : 0 })) };
  }

  // ---- operator scope ----
  if (path === '/v1/admin/grants' && M === 'GET') {
    needOperator(a);
    const ops = (await env.DB.prepare('SELECT person_id, granted_by, granted_at FROM admins WHERE scope = \'operator\'').all()).results || [];
    const owners = (await env.DB.prepare('SELECT principal_id, person_id, granted_by, granted_at FROM principal_admins ORDER BY granted_at').all()).results || [];
    return { operators: ops.map(r => ({ person_id: r.person_id, granted_by: r.granted_by, granted_at: iso(r.granted_at) })), owners: owners.map(r => ({ principal_id: r.principal_id, person_id: r.person_id, granted_by: r.granted_by, granted_at: iso(r.granted_at) })) };
  }
  if (path === '/v1/admin/grants' && (M === 'POST' || M === 'DELETE')) {
    needOperator(a);
    const b = body || {}; const pe = String(b.person_id || '');
    if (!(await env.DB.prepare('SELECT 1 AS x FROM persons WHERE id = ?').bind(pe).first())) throw fixable('invalid_field', 'person_id', 'person_id is a person with a passkey account (GET /v1/account shows it).', null);
    if (b.scope === 'operator') {
      if (M === 'POST') await env.DB.prepare('INSERT OR IGNORE INTO admins (person_id, scope, granted_by, granted_at) VALUES (?, \'operator\', ?, ?)').bind(pe, a.who, nowMs()).run();
      else await env.DB.prepare('DELETE FROM admins WHERE person_id = ? AND scope = \'operator\'').bind(pe).run();
    } else if (b.scope === 'owner' && /^pr_[a-z0-9]+$/.test(String(b.principal_id || ''))) {
      if (M === 'POST') await env.DB.prepare('INSERT OR IGNORE INTO principal_admins (principal_id, person_id, granted_by, granted_at) VALUES (?, ?, ?, ?)').bind(b.principal_id, pe, a.who, nowMs()).run();
      else await env.DB.prepare('DELETE FROM principal_admins WHERE principal_id = ? AND person_id = ?').bind(b.principal_id, pe).run();
    } else throw fixable('invalid_field', 'scope', 'scope is "operator", or "owner" with a principal_id.', 'owner');
    await log(env, a, (M === 'POST' ? 'granted ' : 'took away ') + b.scope + ' scope', pe + (b.principal_id ? ' ' + b.principal_id : ''));
    return { person_id: pe, scope: b.scope, principal_id: b.principal_id || null, granted: M === 'POST' };
  }
  if (path === '/v1/admin/keys' && M === 'GET') {
    needOperator(a);
    const rows = (await env.DB.prepare(`SELECT k.id, k.label, k.class, k.team, k.suspended_at, k.created_at, p.id AS pr, p.name FROM keys k JOIN principals p ON p.id = k.principal_id
        WHERE k.class = 'real' OR k.team = 1 OR k.label = 'connection' ORDER BY k.created_at DESC LIMIT 200`).all()).results || [];
    return { keys: rows.map(k => ({ key_id: k.id, label: k.label, class: k.class, team: !!k.team, principal_id: k.pr, principal: k.name, suspended_at: iso(k.suspended_at), made_at: iso(k.created_at) })) };
  }
  if ((m = /^\/v1\/admin\/keys\/(k_[a-z0-9]+)\/suspend$/.exec(path)) && M === 'POST') {
    needOperator(a);
    const r = await env.DB.prepare('UPDATE keys SET suspended_at = ? WHERE id = ? AND suspended_at IS NULL').bind(nowMs(), m[1]).run();
    await log(env, a, 'suspended a key', m[1]); return { key_id: m[1], suspended: r.meta.changes === 1 };
  }
  if (path === '/v1/admin/held' && M === 'GET') {
    needOperator(a);
    const rows = (await env.DB.prepare(`SELECT h.call_id, h.rule, h.created_at, c.principal_id, p.owner FROM held_calls h JOIN calls c ON c.id = h.call_id JOIN principals p ON p.id = c.principal_id
        WHERE h.released_at IS NULL AND c.status = 'held' ORDER BY h.created_at LIMIT 100`).all()).results || [];
    return { held: rows.map(r => ({ call_id: r.call_id, rule: r.rule, principal_id: r.principal_id, ours: r.owner === 'team', held_at: iso(r.created_at) })) };
  }
  if ((m = /^\/v1\/admin\/calls\/(call_[a-z0-9]+)\/(release|refuse)$/.exec(path)) && M === 'POST') {
    needOperator(a);
    const { releaseHeld, refuseHeld } = await import('./calls.js');
    const why = typeof (body && body.why) === 'string' && body.why.trim() ? body.why.trim().slice(0, 200) : null;
    if (m[2] === 'refuse' && !why) throw fixable('missing_field', 'why', 'why is one line the asker reads.', 'it asks for something we do not carry');
    const r = m[2] === 'release' ? await releaseHeld(env, request, m[1]) : await refuseHeld(env, m[1], 'Refused by the operator: ' + why);
    await log(env, a, m[2] === 'release' ? 'released a held call' : 'refused a held call', m[1]); return r;
  }
  if ((m = /^\/v1\/admin\/calls\/(call_[a-z0-9]+)\/outcome_release$/.exec(path)) && M === 'POST') {   // operations 1:27 PM CT
    needOperator(a);
    const { releaseHeldOutcome } = await import('./calls.js');
    const r = await releaseHeldOutcome(env, request, m[1], body && body.public);
    await log(env, a, 'released a held outcome line', m[1]); return r;
  }
  if ((m = /^\/v1\/admin\/persons\/(pe_[a-z0-9]+)\/separate$/.exec(path)) && M === 'POST') {   // the CEO 1:56 PM CT: undo a merged account
    needOperator(a);
    const why = typeof (body && body.why) === 'string' && body.why.trim() ? body.why.trim().slice(0, 200) : null;
    if (!why) throw fixable('missing_field', 'why', 'why is one line for the log.', 'merged by the old name fold');
    const ms = ((await env.DB.prepare('SELECT member_id FROM person_members WHERE person_id = ?').bind(m[1]).all()).results || []).map(r => r.member_id);
    await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE person_id = ?').bind(m[1]), env.DB.prepare('DELETE FROM passkeys WHERE person_id = ?').bind(m[1]),
      env.DB.prepare('DELETE FROM person_members WHERE person_id = ?').bind(m[1]), env.DB.prepare('DELETE FROM admins WHERE person_id = ?').bind(m[1]),
      env.DB.prepare('DELETE FROM principal_admins WHERE person_id = ?').bind(m[1]), env.DB.prepare('DELETE FROM persons WHERE id = ?').bind(m[1])]);
    await log(env, a, 'separated an account: ' + why, m[1] + ' ' + ms.join(' '));
    return { person_id: m[1], separated: true, memberships_now_apart: ms, note: 'Each membership stands alone; its person adds a passkey again and links what is theirs by presenting each membership\'s own credential.' };
  }
  if (path === '/v1/admin/proof' && M === 'GET') {
    needOperator(a);
    const { proof, proofAudit } = await import('./proof.js');
    return { proof: await proof(env), audit: await proofAudit(env) };
  }
  if (path === '/v1/admin/log' && M === 'GET') {
    needOperator(a);
    const rows = (await env.DB.prepare('SELECT at, actor, via, action, target FROM admin_log ORDER BY at DESC LIMIT 200').all()).results || [];
    return { log: rows.map(r => ({ at: iso(r.at), who: r.actor, via: r.via, action: r.action, target: r.target })) };
  }
  throw notFixable(404, 'not_found', 'No such admin route.', { route: 'unknown' });
}
