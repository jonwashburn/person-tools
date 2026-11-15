// Material into our own storage (SEC-1, SEC-2, CALL-5): an asker's material is copied in before anyone is offered a seat,
// and a person's device only ever fetches it from us. Two ways in, for our own principals only until the upload check for
// outsiders exists (PLAN section 6: a check against known abuse imagery, and the registration to report a match):
//   POST /v1/media with the bytes as the body (a live key of ours), and an https address given as content (copied at open).
import { rid, nowMs, sha256hex } from './util.js';
import { fixable, notFixable } from './spec.js';
import { mediaLength } from './media_length.js';

const MAX_BYTES = 100 * 1024 * 1024;
const TYPES = { 'audio/': 'audio', 'video/': 'video', 'image/': 'image', 'text/html': 'build', 'application/zip': 'build' };

function kindOf(ct) { for (const [p, k] of Object.entries(TYPES)) if ((ct || '').toLowerCase().startsWith(p)) return k; return null; }

export function mayUpload(key, principal) {
  return key && key.class === 'real' && principal && principal.team === 1;
}

async function store(env, principalId, bytes, ct, source) {
  const kind = kindOf(ct);
  if (!kind) throw fixable('content_unavailable', 'content', `Material of type ${ct || 'unknown'} is not taken: audio, video, an image, a page (text/html) or a build (zip).`, null);
  if (bytes.byteLength > MAX_BYTES) throw notFixable(413, 'content_too_large', 'Material is at most 100 MB.');
  const sha = await sha256hex(bytes);
  const id = rid('m_');
  const ext = ct.split('/')[1].split(';')[0].replace(/[^a-z0-9.+-]/g, '').slice(0, 10) || 'bin';
  const key = `media/${principalId}/${sha}.${ext}`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: ct } });
  const seconds = kind === 'audio' || kind === 'video' ? mediaLength(bytes, ct) : null;   // read from the file's own header
  await env.DB.prepare('INSERT INTO media (id, principal_id, kind, r2_key, content_type, bytes, seconds, sha256, source, sample, created_at) VALUES (?,?,?,?,?,?,?,?,?,0,?)')
    .bind(id, principalId, kind, key, ct, bytes.byteLength, seconds, sha, source, nowMs()).run();
  return { media_id: id, kind, seconds, bytes: bytes.byteLength, content_type: ct };
}

// POST /v1/media: the bytes as the body, with their Content-Type.
export async function upload(env, request, key, principal) {
  // media_upload is not listed in discovery (only the operator's own principals may upload until the upload check exists),
  // so everyone else gets unsupported_feature (DISC-5)
  if (!mayUpload(key, principal)) throw fixable('unsupported_feature', 'content', 'This server does not take uploads yet. Use a sample\'s media id in content (GET /v1/media/samples), or an https address on the simulated pool.', 'm_sample_melody30');
  const ct = (request.headers.get('content-type') || '').split(';')[0].trim();
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw notFixable(413, 'content_too_large', 'Material is at most 100 MB.');
  const bytes = await request.arrayBuffer();
  return store(env, key.principal_id, bytes, ct, 'uploaded');
}

// A host that is a plain public web address: a name with a dot, not an address in figures, not ours to loop on.
export function publicHost(u) {
  const h = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || (u.port && u.port !== '443')) return false;
  if (!h.includes('.') || /^[0-9.]+$/.test(h) || h.includes(':') || h.startsWith('[')) return false;
  if (/(^|\.)(localhost|local|internal|intranet|home|lan|corp)$/.test(h)) return false;
  if (/(^|\.)(pages\.dev|person\.tools)$/.test(h) && /askpeople|api\.|run\./.test(h)) return false;
  return true;
}

// Copy an https address in, following at most three redirects by hand, each to a public host (SEC-2).
export async function copyIn(env, principalId, url) {
  let u; try { u = new URL(url); } catch { throw fixable('content_unavailable', 'content', 'That is not an address.', null); }
  for (let hop = 0; hop < 4; hop++) {
    if (!publicHost(u)) throw fixable('content_unavailable', 'content', `The address ${u.host} is not a plain public https address.`, null);
    const r = await fetch(u.toString(), { redirect: 'manual', headers: { 'User-Agent': 'call-server material copy' }, signal: AbortSignal.timeout(20000) });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { u = new URL(r.headers.get('location'), u); continue; }
    if (!r.ok) throw fixable('content_unavailable', 'content', `The address answered HTTP ${r.status}; nothing was copied.`, null);
    const len = Number(r.headers.get('content-length') || 0);
    if (len > MAX_BYTES) throw notFixable(413, 'content_too_large', 'Material is at most 100 MB.');
    const ct = (r.headers.get('content-type') || '').split(';')[0].trim();
    const bytes = await r.arrayBuffer();
    return store(env, principalId, bytes, ct, 'copied from ' + u.host);
  }
  throw fixable('content_unavailable', 'content', 'Too many redirects; nothing was copied.', null);
}
