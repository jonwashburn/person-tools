// CONNECT AN AI (owner/OWNER_all_10.md part B; the CEO, 11:47 AM CT 15 Nov 2026: "every person has one place where AIs reach
// them, on their terms; every AI has one call to reach a person"). A person connects one of their own AIs (a home camera, a
// robot chef, a car, a business program): the connection is its own principal under that person, with a name and an icon,
// and its key (or its link) does exactly ONE thing: place asks (tasks) for that person, on the panel where they made it, and
// read the replies. Nobody else is reached. A person's own AI asking that person passes no content screen beyond the size
// limits and the check for a key's value; connections the operator makes for the lab's programs keep the operator's two
// standing checks. One tap revokes a connection; it can also be quieted (its asks never ring) or blocked (its asks are
// refused, and the AI is told only "not available").
import { rid, nowMs, iso, sha256hex, apiBase } from './util.js';
import { fixable, notFixable } from './spec.js';
// an AI's name passes the asker-name check with the operator's lists (no bank, fraud or support desk, government, known company, us)
async function aiName(env, name) {
  const { checkAskerName } = await import('./panels.js'); const { screenTerms } = await import('./private_terms.js');
  try { await checkAskerName(name, await screenTerms(env)); } catch (e) { if (e && e.body) { e.body.field = 'name'; e.body.message = String(e.body.message || '').replace(/^asker_name/, 'name'); } throw e; }
}

const MAX_PER_PERSON = 20;
const ICON_RX = /^[\p{Extended_Pictographic}\p{Emoji_Component}‍️]{1,8}$|^[A-Za-z0-9]{1,3}$/u;   // one emoji, or up to three letters
const str = (v, field, min, max, example) => {
  if (typeof v !== 'string' || v.trim().length < min || v.trim().length > max) throw fixable(v === undefined ? 'missing_field' : 'invalid_field', field, `${field} is ${min} to ${max} characters.`, example);
  return v.trim().replace(/\s+/g, ' ');
};
const ICON_WORDS = ['home', 'chef', 'car', 'business', 'lab', 'other'];
// an icon: one of the words, one emoji, up to three letters, or an https address of the AI's own picture, which is copied into our
// storage when the person sets it (an image, at most 256 KB) and served from there: the app never loads the AI's address (TRUST 12:13)
async function icon(env, v, connectionId) {
  if (v === undefined || v === null) return null;
  const s = typeof v === 'string' ? v.trim() : '';
  if (ICON_WORDS.includes(s.toLowerCase())) return s.toLowerCase();
  if (/^https:\/\//i.test(s)) return copyIcon(env, s, connectionId);
  if (!ICON_RX.test(s)) throw fixable('invalid_field', 'icon', `icon is one of ${ICON_WORDS.join(', ')}; one emoji; or an https address of the AI's own picture.`, 'home');
  return s;
}
async function copyIcon(env, url, connectionId) {
  const bad = (why) => fixable('invalid_field', 'icon', why, 'home');
  const { publicHost } = await import('./media.js');
  let u; try { u = new URL(url); } catch { throw bad('icon is not an address.'); }
  if (!publicHost(u) || u.username || u.password) throw bad('The picture\'s address is not a plain public https address.');
  let r; try { r = await fetch(u.toString(), { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'person.tools-icon/1' } }); } catch { throw bad('The picture could not be fetched; send it again, or use a word.'); }
  const ct = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (r.status !== 200 || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(ct)) throw bad('The address did not answer with one picture (png, jpeg, webp or gif).');
  if (Number(r.headers.get('content-length') || 0) > 262144) throw bad('The picture is over 256 KB.');
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (!bytes.length || bytes.length > 262144) throw bad('The picture is over 256 KB.');
  if (!env.MEDIA) throw bad('Pictures cannot be kept yet; use a word.');
  await env.MEDIA.put('icons/' + connectionId, bytes, { httpMetadata: { contentType: ct } });
  return 'img:' + ct;
}
export async function serveIcon(env, memberByToken, token, id) {
  const m = await memberByToken(env, token); const c = await mine(env, m, id);
  if (!String(c.icon || '').startsWith('img:') || !env.MEDIA) throw notFixable(404, 'not_found', 'This AI has no picture.');
  const o = await env.MEDIA.get('icons/' + c.id); if (!o) throw notFixable(404, 'not_found', 'This AI has no picture.');
  return new Response(o.body, { status: 200, headers: { 'Content-Type': c.icon.slice(4), 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
}

const URGENCIES = ['now', 'today', 'whenever'];
export const allowedUrgencies = (c) => { try { const a = JSON.parse(c.urgencies || 'null'); return Array.isArray(a) && a.length ? a : URGENCIES; } catch { return URGENCIES; } };
function urgencies(v) {
  if (v === null) return null;
  if (!Array.isArray(v) || !v.length || v.some(x => !URGENCIES.includes(x)) || new Set(v).size !== v.length) throw fixable('invalid_field', 'urgencies', 'urgencies is a list of "now", "today" and "whenever" (at least one); null allows all three.', ['today', 'whenever']);
  return JSON.stringify(URGENCIES.filter(x => v.includes(x)));
}
function view(c, request) {
  const pic = String(c.icon || '').startsWith('img:');
  return { connection_id: c.id, id: c.id, name: c.name, icon: pic ? null : (c.icon || null), ...(pic ? { icon_url: apiBase(request) + '/v1/member/connections/' + c.id + '/icon' } : {}), made_at: iso(c.created_at), last_used_at: iso(c.last_used_at), quiet: !!c.quiet, blocked: !!c.blocked,
    revoked_at: iso(c.revoked_at), lab: !!c.lab, urgencies: allowedUrgencies(c) };
}
const how = (request, key) => ({
  key_use: 'Send "Authorization: Bearer <key>" with POST ' + apiBase(request) + '/v1/tasks {"title", "step", "urgency"} to ask this person one thing; GET /v1/tasks/{task_id} reads the reply. That is all this key does.',
  link_use: 'Or POST the same body to the link, and GET <link>/<task_id> for the reply: for an AI that can only call an address.',
  step_examples: [{ type: 'question', text: 'Someone is at the front door. Let them in?', choices: ['Yes', 'No'] }, { type: 'link', url: 'https://example.com/report', text: 'Read the report.' }, { type: 'command', command: 'echo ready', where: 'your laptop' }],
});

async function make(env, request, m, b, lab) {
  for (const k of Object.keys(b || {})) if (!['name', 'icon', 'urgencies'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not a field of a connection; send name, icon and urgencies.`, null);
  const urg = b.urgencies === undefined ? null : urgencies(b.urgencies);
  const name = str(b.name, 'name', 2, 40, 'Home camera');
  await aiName(env, name);   // TRUST 6:47 (OWNER_router_18): the name is shown "From <name>", also to people an ask is passed to
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM connections WHERE member_id = ? AND revoked_at IS NULL').bind(m.id).first();
  if (n && n.n >= MAX_PER_PERSON) throw fixable('invalid_field', 'name', `At most ${MAX_PER_PERSON} AIs connected at once; revoke one you no longer use.`, null);
  const id = rid('cn_'), pr = rid('pr_'), kid = rid('k_'), key = rid('conn_', 32), now = nowMs();
  const ic = await icon(env, b.icon, id);
  await env.DB.batch([
    // its own principal: a person's own AI is neither the team's nor an outsider's ('person'); the lab's programs are the team's
    env.DB.prepare('INSERT INTO principals (id, class, name, team, created_ip_hash, created_at, owner) VALUES (?,?,?,?,?,?,?)').bind(pr, 'test', name, 0, null, now, lab ? 'team' : 'person'),
    env.DB.prepare('INSERT INTO keys (id, principal_id, key_hash, class, label, cap_call_cents, cap_day_cents, team, created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(kid, pr, await sha256hex(key), 'test', 'connection', 0, 0, 0, now),
    env.DB.prepare('INSERT INTO connections (id, member_id, panel_id, person_name, principal_id, key_id, name, icon, lab, created_at, urgencies) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, m.id, m.panel_id, m.person_name || null, pr, kid, name, ic, lab ? 1 : 0, now, urg),
  ]);
  const { newSecret } = await import('./own.js'); const sec = await newSecret(env, id); await sec.stmt.run();   // OWNER_all_10 C: signs the answers sent to its webhook
  const c = await env.DB.prepare('SELECT * FROM connections WHERE id = ?').bind(id).first();
  return { ...view(c, request), key, link: apiBase(request) + '/hook/' + key, webhook_secret: sec.secret, how: how(request),
    note: 'The key, the link and the webhook secret are shown once: give them to your AI. They only ask you; revoke them here with one tap.' };
}

export async function createConnection(env, request, memberByToken, token, b) {
  const m = await memberByToken(env, token);
  // TRUST 6:56 (OWNER_router_23): a panel someone made for their own people takes only that person's asks: no AI connects from it
  const o = await env.DB.prepare('SELECT 1 AS x FROM panel_owners WHERE panel_id = ?').bind(m.panel_id).first().catch(() => null);
  if (o && !(await env.DB.prepare('SELECT 1 AS x FROM owner_members WHERE member_id = ? AND panel_id = ?').bind(m.id, m.panel_id).first().catch(() => null)))
    throw notFixable(403, 'forbidden', 'This panel is for asks from the person whose link you joined. Connect your own AIs from your own page.');
  return make(env, request, m, b || {}, false);
}
export async function adminConnection(env, request, memberId, b) {   // the operator, for a lab program (one connection per program)
  const m = await env.DB.prepare('SELECT * FROM members WHERE id = ? AND left_at IS NULL').bind(String(memberId || '')).first();
  if (!m) throw notFixable(404, 'not_found', 'No such member.');
  return make(env, request, m, b || {}, true);
}

export async function listConnections(env, request, memberByToken, token) {
  const m = await memberByToken(env, token);
  const rows = (await env.DB.prepare(`SELECT c.*, (SELECT COUNT(*) FROM tasks t WHERE t.connection_id = c.id AND t.state = 'open') AS waiting FROM connections c
      WHERE c.revoked_at IS NULL AND (c.member_id = ? OR (c.person_name IS NOT NULL AND c.person_name = ? AND c.panel_id = ?)) ORDER BY c.created_at`).bind(m.id, m.person_name || '\u0000', m.panel_id).all()).results || [];
  return { connections: rows.map(c => ({ ...view(c, request), asks_waiting: c.waiting || 0 })), limit: MAX_PER_PERSON };
}

async function mine(env, m, id) {
  const c = await env.DB.prepare('SELECT * FROM connections WHERE id = ? AND revoked_at IS NULL AND (member_id = ? OR (person_name IS NOT NULL AND person_name = ? AND panel_id = ?))')
    .bind(String(id || ''), m.id, m.person_name || '\u0000', m.panel_id).first();
  if (!c) throw notFixable(404, 'not_found', 'No AI of yours is connected with that id.');
  return c;
}

export async function changeConnection(env, request, memberByToken, token, id, b) {
  const m = await memberByToken(env, token); const c = await mine(env, m, id);
  for (const k of Object.keys(b || {})) if (!['name', 'icon', 'quiet', 'blocked', 'urgencies'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not something to change here; send name, icon, quiet, blocked or urgencies.`, null);
  const urg = b.urgencies === undefined ? c.urgencies : urgencies(b.urgencies);
  for (const k of ['quiet', 'blocked']) if (b[k] !== undefined && typeof b[k] !== 'boolean') throw fixable('invalid_field', k, `${k} is true or false.`, true);
  const name = b.name === undefined ? c.name : str(b.name, 'name', 2, 40, 'Home camera');
  if (b.name !== undefined) await aiName(env, name);
  const ic = b.icon === undefined ? c.icon : await icon(env, b.icon, c.id);
  const quiet = b.quiet === undefined ? c.quiet : (b.quiet ? 1 : 0), blocked = b.blocked === undefined ? c.blocked : (b.blocked ? 1 : 0);
  await env.DB.batch([
    env.DB.prepare('UPDATE connections SET name = ?, icon = ?, quiet = ?, blocked = ?, urgencies = ? WHERE id = ?').bind(name, ic, quiet, blocked, urg, c.id),
    env.DB.prepare('UPDATE principals SET name = ? WHERE id = ?').bind(name, c.principal_id),
  ]);
  return view(await env.DB.prepare('SELECT * FROM connections WHERE id = ?').bind(c.id).first(), request);
}

// The person makes a new webhook secret (the old one stops signing at once); shown once
export async function rotateSecret(env, request, memberByToken, token, id) {
  const m = await memberByToken(env, token); const c = await mine(env, m, id);
  const { newSecret } = await import('./own.js'); const sec = await newSecret(env, c.id); await sec.stmt.run();
  return { connection_id: c.id, webhook_secret: sec.secret, note: 'Shown once: give it to your AI. Answers are signed with it from now on.' };
}

// One tap: the key and the link stop at once, and the asks still waiting are withdrawn from the person's list
export async function revokeConnection(env, request, memberByToken, token, id) {
  const m = await memberByToken(env, token); const c = await mine(env, m, id); const now = nowMs();
  await env.DB.batch([
    env.DB.prepare('UPDATE connections SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(now, c.id),
    env.DB.prepare('UPDATE keys SET suspended_at = ? WHERE id = ? AND suspended_at IS NULL').bind(now, c.key_id),
    env.DB.prepare('UPDATE tasks SET state = \'withdrawn\', withdrawn_at = ?, withdraw_why = ? WHERE connection_id = ? AND state = \'open\'').bind(now, 'You removed this AI.', c.id),
  ]);
  try { const { deleteOwn } = await import('./own.js'); await deleteOwn(env, 'connection_id = ?', [c.id], 200); } catch { }   // its photos and clips go at once (policy/CONNECTIONS.md 4)
  return { connection_id: c.id, revoked: true, revoked_at: iso(now), note: 'Its key and link no longer work, and what it was still asking is off your list.' };
}

// The key's one road (app.js authKey): the connection behind a conn_ key, or why it may not ask
export async function connectionForKey(env, keyId) {
  return env.DB.prepare('SELECT * FROM connections WHERE key_id = ?').bind(keyId).first();
}
export const CONNECTION_PATHS = [/^\/v1\/tasks$/, /^\/v1\/tasks\/media$/, /^\/v1\/tasks\/tk_[a-z0-9]+$/, /^\/v1\/tasks\/tk_[a-z0-9]+\/withdraw$/, /^\/v1\/tasks\/tk_[a-z0-9]+\/notes$/, /^\/v1\/brand$/, /^\/v1\/brand\/mark$/, /^\/v1\/brand\/verify$/, /^\/mcp$/];   // its own brand too (OWNER_router_9)

// The app's proposal (APP_FOR_SERVICE 11:55): POST .../quiet {"quiet": true|false} and POST .../block {"blocked"?: true|false}
export async function quietOrBlock(env, request, memberByToken, token, id, which, b) {
  const v = which === 'quiet' ? (b && b.quiet !== undefined ? b.quiet : true) : (b && b.blocked !== undefined ? b.blocked : true);
  if (typeof v !== 'boolean') throw fixable('invalid_field', which === 'quiet' ? 'quiet' : 'blocked', 'true or false.', true);
  return changeConnection(env, request, memberByToken, token, id, which === 'quiet' ? { quiet: v } : { blocked: v });
}

// The operator changes a connection it made for a lab program (operations 12:25: urgencies); the person's own AIs are only theirs
export async function adminChangeConnection(env, request, id, b) {
  const c = await env.DB.prepare('SELECT * FROM connections WHERE id = ? AND revoked_at IS NULL AND lab = 1').bind(String(id || '')).first();
  if (!c) throw notFixable(404, 'not_found', 'No connection the operator made has that id.');
  for (const k of Object.keys(b || {})) if (!['urgencies', 'quiet'].includes(k)) throw fixable('unknown_field', k, `"${k}" is not something the operator changes here; send urgencies or quiet.`, null);
  const urg = b.urgencies === undefined ? c.urgencies : urgencies(b.urgencies);
  const quiet = b.quiet === undefined ? c.quiet : (b.quiet === true ? 1 : b.quiet === false ? 0 : (() => { throw fixable('invalid_field', 'quiet', 'true or false.', true); })());
  await env.DB.prepare('UPDATE connections SET urgencies = ?, quiet = ? WHERE id = ?').bind(urg, quiet, c.id).run();
  return view(await env.DB.prepare('SELECT * FROM connections WHERE id = ?').bind(c.id).first(), request);
}
