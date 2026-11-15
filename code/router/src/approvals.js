// The over-cap approval (A3): a call above a key's cap opens nothing and returns the quote and an approve_url. The link
// carries a signed token naming one approval; the human who opens it sees the quote's lines and total (no ask text, no
// principal), and approves once. The agent then sends the same call again and it opens once above the key's cap, never
// above the approved total or the call's own max_total_usd. Without the approvals table (its DATA.md row first) nothing
// here runs and the link points at the site's explanation.
import { rid, nowMs, iso, b64url, unb64url, hmac, siteBase } from './util.js';
import { notFixable } from './spec.js';

const enc = new TextEncoder(), dec = new TextDecoder();
const TTL = 24 * 3600000;

async function tokenFor(env, id, exp) {
  const body = b64url(enc.encode(JSON.stringify({ ap: id, exp })));
  return 'ap_' + body + '.' + b64url(await hmac(env.SEAT_SECRET || 'local', 'approve.' + body));
}
async function readToken(env, t) {
  if (typeof t !== 'string' || !t.startsWith('ap_')) return null;
  const [body, sig] = t.slice(3).split('.');
  if (!body || !sig) return null;
  const want = b64url(await hmac(env.SEAT_SECRET || 'local', 'approve.' + body));
  if (want !== sig) return null;
  try { return JSON.parse(dec.decode(unb64url(body))); } catch { return null; }
}

// Over the cap: an approved, unused approval for this exact call lets it open (returns its id to mark used); otherwise
// make (or reuse) a waiting approval and return its link.
export async function overCap(env, request, key, callHash, totalCents, quoteLines) {
  try {
    const now = nowMs();
    const ok = await env.DB.prepare('SELECT id FROM approvals WHERE key_id = ? AND call_hash = ? AND approved_at IS NOT NULL AND used_at IS NULL AND total_cents >= ? AND created_at > ? ORDER BY approved_at DESC LIMIT 1')
      .bind(key.id, callHash, totalCents, now - TTL).first();
    if (ok) return { approvedId: ok.id };
    let row = await env.DB.prepare('SELECT * FROM approvals WHERE key_id = ? AND call_hash = ? AND approved_at IS NULL AND created_at > ? LIMIT 1').bind(key.id, callHash, now - TTL).first();
    if (!row) {
      row = { id: rid('ap_'), created_at: now };
      await env.DB.prepare('INSERT INTO approvals (id, key_id, call_hash, total_cents, quote_json, created_at) VALUES (?,?,?,?,?,?)').bind(row.id, key.id, callHash, totalCents, JSON.stringify(quoteLines), now).run();
    }
    return { approve_url: siteBase(request) + '/approve?t=' + encodeURIComponent(await tokenFor(env, row.id, row.created_at + TTL)), expires_at: iso(row.created_at + TTL) };
  } catch (e) {
    return { approve_url: siteBase(request) + '/approve' };   // the table is not there yet
  }
}

// Mark an approval used, once; true if this request used it.
export async function useApproval(env, id) {
  const r = await env.DB.prepare('UPDATE approvals SET used_at = ? WHERE id = ? AND used_at IS NULL').bind(nowMs(), id).run();
  return r.meta.changes === 1;
}

export async function getApproval(env, token) {
  const p = await readToken(env, token);
  if (!p) throw notFixable(404, 'not_found', 'This approval link is not valid.');
  const row = await env.DB.prepare('SELECT * FROM approvals WHERE id = ?').bind(p.ap).first();
  if (!row) throw notFixable(404, 'not_found', 'This approval link is not valid.');
  const quote = JSON.parse(row.quote_json || '[]');
  const status = row.used_at ? 'used' : row.approved_at ? 'approved' : (nowMs() > p.exp ? 'expired' : 'waiting');
  return { row, exp: p.exp, out: { status, quote: { lines: quote, total_usd: (row.total_cents / 100).toFixed(2) }, test_money: true, expires_at: iso(p.exp),
    note: status === 'waiting' ? 'Approving lets the agent open this one call above its key\'s cap, for at most this total. Nothing is spent until it opens.' : undefined } };
}

export async function approve(env, token, body) {
  const { row, exp, out } = await getApproval(env, token);
  if (!body || body.approve !== true) return out;
  if (out.status !== 'waiting') return out;
  if (nowMs() > exp) return { ...out, status: 'expired' };
  await env.DB.prepare('UPDATE approvals SET approved_at = ? WHERE id = ? AND approved_at IS NULL').bind(nowMs(), row.id).run();
  return { ...out, status: 'approved', note: 'Approved. The agent can send the same call again now; it opens once, for at most this total.' };
}
