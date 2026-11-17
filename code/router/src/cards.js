// CARDS (owner/OWNER_router_9.md, 12:41 PM CT 15 Nov 2026; SPEC_v0 8.1 "Cards": an asker may design how its asks look, as data, never
// as code). A brand belongs to a principal (or a connection, which is one): a name, a mark (a picture from our own store, with
// states), colours that each mean one thing, and two grounds. A card belongs to an ask: an ordered list of blocks from a fixed set.
// The person's client draws them within its limits and keeps for itself who is asking (the service's own "from"), the answers'
// edges, undo, Report and Stop: a brand can dress a card, never pass for another principal or draw those controls.
// TRUST 12:41 PM CT: the brand's name and every colour's meaning pass the same name check as an asker's name; an input block never
// asks for a password, a one-time code, a card or bank number, an ID number or a key; no address, script or code anywhere.
import { rid, nowMs, iso } from './util.js';
import { fixable, notFixable } from './spec.js';

const HEX = /^#[0-9a-fA-F]{6}$/;
const BLOCKS = ['headline', 'text', 'media', 'facts', 'price', 'when_where', 'choices', 'input', 'quote', 'contact'];   // quote, contact: OWNER_router_29
const NO_ADDRESS = /\b(?:https?:\/\/|www\.)|javascript:|data:|<\s*\/?\s*[a-z]/i;   // no remote address, script or markup in a card's words
const OURS = /^(?:report|stop|block|not now|undo|from person\.tools|person\.tools)$/i;   // the client's own controls and labels
const CREDENTIAL = /\b(?:pass ?words?|pass ?codes?|pins?|one[- ]time (?:code|password)|otp|verification code|2fa|security code|cvv|cvc|card numbers?|credit card|debit card|bank (?:account|number|routing)|routing numbers?|account numbers?|iban|sort code|social security|ssn|id numbers?|passport|driver'?s licen[cs]e|tax id|api keys?|secret keys?|private keys?|tokens?|seed phrase|recovery phrase)\b/i;

// TRUST 2:36 PM CT: read through the screen's own fold (homoglyphs, accents, digits as letters), so "Rеport" (a Cyrillic e) is "report"
let FOLD = null;
const OUR_START = /^(?:report|stop|block|not now|undo)\b/;
const VOUCH = /\b(?:verified|checked|approved|certified|official|endorsed|vouched|trusted)\b[^.]{0,40}\bperson ?\.? ?tools\b|\bperson ?\.? ?tools\b[^.]{0,40}\b(?:verified|checked|approved|certified|official|endorsed|vouched|trusted)\b/;
// OWNER_router_11 item 1 (TRUST 3:02): one check over every field a person reads. NFKC, zero-width and soft hyphens out, then the
// screen's fold (homoglyphs, accents, digits as letters, case); our controls at the start, any claim that person.tools checked,
// verified or vouches, and our own label are refused.
const CONTROL_EXACT = /^(?:(?:report|block)(?: this (?:call|ask|task|asker|ai))?|stop this (?:call|ask|task)|not now|undo)$/;
export async function claimsUs(text, strict = false) {
  if (!FOLD) { const S = await import('./screening/index.js'); FOLD = typeof S.foldForNames === 'function' ? S.foldForNames : (x) => String(x).toLowerCase(); }
  const t = String(text || '').normalize('NFKC').replace(/[\u00ad\u180e\u200b-\u200f\u2028-\u202f\u205f-\u206f\ufeff]/g, '');
  const f = FOLD(t), g = f.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  // a card may not even start with our controls (strict); an ask's own words may ("Report back by Friday"), but may not BE one
  return (strict ? (OUR_START.test(f) || OUR_START.test(g)) : CONTROL_EXACT.test(g)) || VOUCH.test(f) || VOUCH.test(g) || /\bnamed by the asker\b/.test(g) || /^report this (?:call|ask|task)\b/.test(g);
}
// OWNER_router_26 item 4 (C5, ASKS-13): Done, Later, Not now, Undo, Report, Stop and Block are the client's own words. No choice, approval
// label, card block or brand words may be one of them as a whole, after the fold (case, accents, look-alikes); free words are offered.
const RESERVED = { done: 'Did it', later: 'Another day', 'not now': 'Not today', undo: 'Change it', report: 'Tell them', stop: 'End it', block: 'Turn it away' };
export async function reservedWord(text) {
  if (!FOLD) { const S = await import('./screening/index.js'); FOLD = typeof S.foldForNames === 'function' ? S.foldForNames : (x) => String(x).toLowerCase(); }
  const t = String(text || '').normalize('NFKC').replace(/[\u00ad\u180e\u200b-\u200f\u2028-\u202f\u205f-\u206f\ufeff]/g, '');
  const g = FOLD(t).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (Object.prototype.hasOwnProperty.call(RESERVED, g)) return g;
  // TRUST 4:19 PM CT 16 Nov: letters only, so "Done!" and "D o n e" are the word too (and the fold of that, for a look-alike letter)
  const only = t.toLowerCase().replace(/[^\p{L}]/gu, ''), folded = FOLD(only).replace(/[^a-z]/g, '');
  for (const w of Object.keys(RESERVED)) { const sq = w.replace(/ /g, ''); if (only === sq || folded === sq) return w; }
  return null;
}
export async function refuseReserved(field, text) {
  const w = await reservedWord(text);
  if (w) throw fixable('reserved_word', field, `"${String(text).trim().slice(0, 40)}" is one of the client's own words (Done, Later, Not now, Undo, Report, Stop, Block), so an answer would read like a swipe. Use other words.`, RESERVED[w], {}, 400);
}
async function words(v, field, max, opt = {}) {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw fixable('invalid_field', field, `${field} is 1 to ${max} characters.`, opt.example || null, {}, 400);
  const s = v.trim().replace(/\s+/g, ' ');
  if (NO_ADDRESS.test(s)) throw fixable('invalid_field', field, `${field} carries no address, script or markup: words only.`, null, {}, 400);
  if (!FOLD) { const S = await import('./screening/index.js'); FOLD = typeof S.foldForNames === 'function' ? S.foldForNames : (x) => String(x).toLowerCase(); }
  const f = FOLD(s);
  await refuseReserved(field, s);
  if (OURS.test(s) || OURS.test(f) || OUR_START.test(f)) throw fixable('invalid_field', field, `"${s.slice(0, 40)}" is one of the client's own controls; a card cannot draw it.`, null, {}, 400);
  if (VOUCH.test(f) || /\bnamed by the asker\b/.test(f) || await claimsUs(s, true)) throw fixable('invalid_field', field, 'A card cannot say person.tools checked, verified or vouches for anything, or use its labels.', null, {}, 400);
  return s;
}

// ---- brands ----
async function nameCheck(env, v, field) {
  if (typeof v === 'string' && /<[\p{L}\/]/u.test(v)) throw fixable('invalid_field', field, `${field} carries no markup: words only.`, null, {}, 400);   // ASKS-6 (PROTOCOL 1:30 AM CT 17 Nov)
  const { checkAskerName } = await import('./panels.js'); const { screenTerms } = await import('./private_terms.js');
  try { return await checkAskerName(v, await screenTerms(env)); }
  catch (e) { if (e && e.body) { e.body.field = field; e.body.message = String(e.body.message || '').replace(/^asker_name/, field); e.status = 400; e.body.status = 400; } throw e; }
}
async function markMedia(env, principalId, id, field) {
  if (typeof id !== 'string' || !/^m_[a-z0-9_]{4,60}$/.test(id)) throw fixable('invalid_field', field, `${field} is a media id from this service (POST /v1/brand/mark gives one), never an address.`, null, {}, 400);
  const m = await env.DB.prepare('SELECT id, kind, principal_id, sample FROM media WHERE id = ?').bind(id).first();
  if (!m || m.kind !== 'image' || !(m.sample || m.principal_id === principalId)) throw fixable('invalid_field', field, `${field} is not a picture of yours in this service.`, null, {}, 400);
  return id;
}
// OWNER_router_26 item 2 (C2): a mark's state is a picture {"media"} or a glyph the client draws {"glyph", "colour"}; dressing colours are
// {ink, ink_soft, rule} and need a ground of the brand's own; corners; quiet_line. Floors (WCAG 2.2): words (ink, ink_soft) 4.5:1 and a
// glyph 3:1, checked only on the grounds the brand gives (where it gives none the client checks its own ground). rule has no floor.
const GLYPHS = ['disc', 'ring', 'square', 'frame'];
const STATES = ['idle', 'needs_you', 'answered'];
const WIRE = 'x-hc-draft';   // the wire prefix (discovery's protocol): the neutral proof path is /.well-known/x-hc-draft-brand
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
export function contrastRatio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
const down2 = (r) => (Math.floor(r * 100) / 100).toFixed(2);   // a refusal never rounds its ratio up to the floor
function mixHex(hex, to, t) { const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16); return '#' + [16, 8, 0].map(sh => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t).toString(16).padStart(2, '0')).join(''); }
function passingNear(hex, grounds, floor) {   // the nearest colour toward black or white that passes on every ground the brand gives
  let best = null;
  for (const to of ['#000000', '#ffffff']) for (let i = 1; i <= 20; i++) { const c = mixHex(hex, to, i / 20); if (grounds.every(g => contrastRatio(c, g) >= floor)) { if (!best || i < best.i) best = { c, i }; break; } }
  return best ? best.c : null;
}
function floorCheck(field, hex, grounds, floor) {
  for (const [name, g] of Object.entries(grounds || {})) {
    const r = contrastRatio(hex, g);
    if (r < floor) throw fixable('contrast_too_low', field, `${field} ${hex} on the ${name} ground ${g} is ${down2(r)}:1; the floor is ${floor}:1 (WCAG 2.2 ${floor === 4.5 ? '1.4.3, words' : '1.4.11, a mark'}). The example passes on every ground this brand gives.`, passingNear(hex, Object.values(grounds), floor), { ratio: down2(r), floor: String(floor), ground: g }, 400);   // item 30: the ground's colour
  }
}
async function markState(env, principalId, v, field, grounds) {
  if (typeof v === 'string') return { media: await markMedia(env, principalId, v, field) };   // a media id, as before (kept in the new shape)
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw fixable('invalid_field', field, `${field} is a glyph {"glyph": "disc", "colour": "#e8590c"} or a picture {"media": "m_..."}.`, { glyph: 'disc', colour: '#e8590c' }, {}, 400);
  if (v.media !== undefined) {
    for (const k of Object.keys(v)) if (k !== 'media') throw fixable('unknown_field', field + '.' + k, 'A picture state is {"media": "m_..."} alone.', null, {}, 400);
    return { media: await markMedia(env, principalId, v.media, field + '.media') };
  }
  for (const k of Object.keys(v)) if (!['glyph', 'colour'].includes(k)) throw fixable('unknown_field', field + '.' + k, 'A glyph state is {"glyph", "colour"}.', null, {}, 400);
  if (!GLYPHS.includes(v.glyph)) throw fixable('invalid_field', field + '.glyph', `glyph is ${GLYPHS.join(', ')}.`, 'disc', {}, 400);
  if (!HEX.test(v.colour || '')) throw fixable('invalid_field', field + '.colour', 'colour is #rrggbb, and a glyph needs one.', '#e8590c', {}, 400);
  const colour = v.colour.toLowerCase(); floorCheck(field + '.colour', colour, grounds, 3);
  return { glyph: v.glyph, colour };
}
// items 8 and 20 (C3): the neutral proof path first, the older person-tools one beside it; prove_it as fields and as sentences
function proveIt(domain, token) {
  const file = `https://${domain}/.well-known/${WIRE}-brand`, txt = `_${WIRE}-brand.${domain}`;
  return { token, file, txt_name: txt,
    say: `Serve ${file} as plain text with a line that is exactly ${token}, or put ${token} as the value of a TXT record named ${txt}. Then POST /v1/brand/verify (no body; at most once a minute).`,
    or_dns: `a TXT record on ${txt} with the value ${token}`,
    also: `The older names still work: https://${domain}/.well-known/person-tools-brand, or a TXT record on _person-tools.${domain}.`,
    then: 'POST /v1/brand/verify' };
}
export async function putBrand(env, key, b) {
  if (!key || key.anon) throw fixable('unauthorized', 'Authorization', 'A brand belongs to a key\'s principal: send the key.', 'Bearer test_...', {}, 401);
  const br = b && b.brand !== undefined ? b.brand : b;
  if (!br || typeof br !== 'object' || Array.isArray(br)) throw fixable('invalid_field', 'brand', 'brand is {"name", "domain", "mark", "colours", "grounds", "corners", "quiet_line"}; a name alone is a complete brand.', { name: 'CarGPT' }, {}, 400);
  const KNOWN = ['name', 'mark', 'colours', 'grounds', 'domain', 'corners', 'quiet_line'];
  for (const k of Object.keys(br)) if (!KNOWN.includes(k)) throw fixable('unknown_field', 'brand.' + k, `"${k}" is not part of a brand; send ${KNOWN.join(', ')}.`, null, {}, 400);
  const out = { name: await nameCheck(env, br.name, 'brand.name') };
  await refuseReserved('brand.name', out.name);
  // TRUST 4:19 PM CT 16 Nov: a brand never reads as the person's own AI
  if (/^(?:your|ur)(?: own)? (?:ai|a i|assistant|bot)$/.test(String(out.name).normalize('NFKC').toLowerCase().replace(/[^\p{L}]+/gu, ' ').trim())) throw fixable('invalid_field', 'brand.name', 'A brand cannot read as the person\'s own AI: use the service\'s own name.', 'CarGPT', {}, 400);
  // OWNER_router_10 C: the domain the brand proves it controls before it shows on anyone's card
  let domain = null;
  if (br.domain !== undefined) {
    domain = String(br.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) || /(^|\.)person\.tools$/.test(domain)) throw fixable('invalid_field', 'brand.domain', 'domain is the brand\'s own domain name, such as cargpt.pro.', 'cargpt.pro', {}, 400);
  }
  // the grounds first: every floor is checked on the grounds the brand gives
  if (br.grounds !== undefined) {
    const g = br.grounds; if (!g || typeof g !== 'object' || Array.isArray(g) || Object.keys(g).some(k => !['light', 'dark'].includes(k)) || Object.values(g).some(v => !HEX.test(v || '')))
      throw fixable('invalid_field', 'brand.grounds', 'grounds is {"light": "#rrggbb", "dark": "#rrggbb"}; either may be left out.', { light: '#f7f5f0', dark: '#141414' }, {}, 400);
    out.grounds = Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.toLowerCase()]));
  }
  const grounds = out.grounds || {};
  if (br.mark !== undefined) {
    const mk = br.mark; if (!mk || typeof mk !== 'object' || Array.isArray(mk)) throw fixable('invalid_field', 'brand.mark', 'mark is {"states": {...}}: each state a glyph {"glyph", "colour"} or a picture {"media": "m_..."}.', { states: { needs_you: { glyph: 'disc', colour: '#e8590c' } } }, {}, 400);
    for (const k of Object.keys(mk)) if (!['media', 'states'].includes(k)) throw fixable('unknown_field', 'brand.mark.' + k, `"${k}" is not part of a mark; send states.`, null, {}, 400);
    out.mark = {};
    if (mk.media !== undefined) out.mark.media = await markMedia(env, key.principal_id, mk.media, 'brand.mark.media');
    if (mk.states !== undefined) {
      if (!mk.states || typeof mk.states !== 'object' || Array.isArray(mk.states)) throw fixable('invalid_field', 'brand.mark.states', 'states maps needs_you, answered and idle to a glyph or a picture.', null, {}, 400);
      out.mark.states = {};
      for (const [k, v] of Object.entries(mk.states)) {
        if (!STATES.includes(k)) throw fixable('unknown_field', 'brand.mark.states.' + k, 'A state is needs_you, answered or idle.', null, {}, 400);
        out.mark.states[k] = await markState(env, key.principal_id, v, 'brand.mark.states.' + k, grounds);
      }
      if (!out.mark.states.needs_you && !out.mark.states.idle) throw fixable('invalid_field', 'brand.mark.states', 'A mark gives needs_you or idle at least (a missing state is drawn as idle, then as needs_you).', { needs_you: { glyph: 'disc', colour: '#e8590c' } }, {}, 400);
    }
    if (!out.mark.media && !out.mark.states) throw fixable('invalid_field', 'brand.mark', 'mark is {"states": {...}}.', { states: { needs_you: { glyph: 'disc', colour: '#e8590c' } } }, {}, 400);
  }
  if (br.colours !== undefined) {
    if (Array.isArray(br.colours)) {   // the older list: kept for a week, stored and drawn nowhere (C2)
      if (br.colours.length > 4) throw fixable('invalid_field', 'brand.colours', 'colours is {"ink", "ink_soft", "rule"} (the older list of at most 4 is still taken for a week).', { ink: '#0d0d0d' }, {}, 400);
      out.colours = [];
      for (const [i, c] of br.colours.entries()) {
        if (!c || typeof c !== 'object' || !HEX.test(c.value || '') || Object.keys(c).some(k => !['value', 'means'].includes(k))) throw fixable('invalid_field', `brand.colours[${i}]`, 'Each colour of the older list is {"value": "#rrggbb", "means": "what it is used for"}.', { value: '#e8590c', means: 'needs you' }, {}, 400);
        out.colours.push({ value: c.value.toLowerCase(), means: await nameCheck(env, c.means, `brand.colours[${i}].means`) });
      }
    } else if (br.colours && typeof br.colours === 'object') {
      for (const k of Object.keys(br.colours)) if (!['ink', 'ink_soft', 'rule'].includes(k)) throw fixable('unknown_field', 'brand.colours.' + k, 'colours is {"ink", "ink_soft", "rule"}: the card\'s words, its quieter words, and its lines.', null, {}, 400);
      if (!Object.keys(grounds).length) throw fixable('invalid_field', 'grounds', 'Dressing colours apply only on the brand\'s own ground: send grounds ({"light"} and/or {"dark"}) with colours.', { light: '#ffffff' }, {}, 400);
      out.colours = {};
      for (const k of ['ink', 'ink_soft', 'rule']) if (br.colours[k] !== undefined) {
        if (!HEX.test(br.colours[k] || '')) throw fixable('invalid_field', 'brand.colours.' + k, `${k} is #rrggbb.`, '#0d0d0d', {}, 400);
        const c = br.colours[k].toLowerCase(); if (k !== 'rule') floorCheck('brand.colours.' + k, c, grounds, 4.5); out.colours[k] = c;
      }
    } else throw fixable('invalid_field', 'brand.colours', 'colours is {"ink", "ink_soft", "rule"}.', { ink: '#0d0d0d', ink_soft: '#5d5d5d', rule: '#e6e6e6' }, {}, 400);
  }
  if (br.corners !== undefined) { if (!['square', 'round'].includes(br.corners)) throw fixable('invalid_field', 'brand.corners', 'corners is "square" or "round".', 'round', {}, 400); out.corners = br.corners; }
  if (br.quiet_line !== undefined) out.quiet_line = await words(br.quiet_line, 'brand.quiet_line', 40);
  const now = nowMs();
  const had = await env.DB.prepare('SELECT domain, domain_token, verified_at, brand_id FROM brands WHERE principal_id = ?').bind(key.principal_id).first();
  const same = had && had.domain === domain;
  const token = domain ? (same && had.domain_token ? had.domain_token : 'person-tools-brand=' + [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join('')) : null;
  const verified = same ? had.verified_at : null;   // a new domain proves itself again
  const brandId = (had && had.brand_id) || rid('br_');
  await env.DB.prepare('INSERT INTO brands (principal_id, brand_json, updated_at, domain, domain_token, verified_at, brand_id) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(principal_id) DO UPDATE SET brand_json = excluded.brand_json, updated_at = excluded.updated_at, domain = excluded.domain, domain_token = excluded.domain_token, verified_at = excluded.verified_at, brand_id = excluded.brand_id')
    .bind(key.principal_id, JSON.stringify(out), now, domain, token, verified, brandId).run();
  return { brand: out, id: brandId, updated_at: iso(now), domain, verified: !!verified, ...(domain && !verified ? { prove_it: proveIt(domain, token) } : {}),
    note: 'A brand shows on a person\'s card only once its domain is proved; until then only the server\'s own test members see it, marked as a test brand. The person\'s app always draws who is asking itself, from the service.' };
}
export async function getBrand(env, key) {
  if (!key || key.anon) throw fixable('unauthorized', 'Authorization', 'A key is needed.', 'Bearer test_...', {}, 401);
  const r = await env.DB.prepare('SELECT brand_json, updated_at, domain, domain_token, verified_at, brand_id FROM brands WHERE principal_id = ?').bind(key.principal_id).first();
  if (r && !r.brand_id) { r.brand_id = rid('br_'); await env.DB.prepare('UPDATE brands SET brand_id = ? WHERE principal_id = ? AND brand_id IS NULL').bind(r.brand_id, key.principal_id).run(); }   // OWNER_router_32
  return { brand: r ? JSON.parse(r.brand_json) : null, id: r ? r.brand_id || null : null, updated_at: r ? iso(r.updated_at) : null, domain: r ? r.domain : null, verified: !!(r && r.verified_at), verified_at: r ? iso(r.verified_at) : null,
    ...(r && r.domain && !r.verified_at ? { prove_it: proveIt(r.domain, r.domain_token) } : {}) };
}
// only a brand that proved its domain is shown on a card (OWNER_router_10 C), with that domain beside its name
export async function brandOf(env, principalId) {
  const r = await env.DB.prepare('SELECT brand_json, domain, verified_at FROM brands WHERE principal_id = ?').bind(principalId).first();
  return r && r.verified_at && r.domain ? { ...JSON.parse(r.brand_json), domain: r.domain, verified: true } : null;
}
// OWNER_router_26 items 1, 3 and 24 (C3, C10; ASKS-8, ASKS-10): the brand where a client draws it. A proved brand shows to everyone it
// asks; an unproved one only to the server's own test members (is_real 0), marked verified false and test true, whatever key gave it;
// never to a real member. Served as given, plus id, domain and verified, and each picture with its url on our own store.
export function brandView(r, member, base) {
  if (!r || !r.brand_json) return null;
  const proved = !!(r.verified_at && r.domain);
  if (!proved && !(member && Number(member.is_real) === 0)) return null;
  let b; try { b = JSON.parse(r.brand_json); } catch { return null; }
  const url = (id) => base + '/v1/brand_media/' + id;
  const out = { id: r.brand_id || null, ...b, domain: r.domain || null, verified: proved, ...(proved ? {} : { test: true }) };
  if (Array.isArray(out.colours)) delete out.colours;   // the older list: stored for a week, drawn nowhere
  if (b.mark) {
    const mk = {};
    if (b.mark.media) { mk.media = b.mark.media; mk.url = url(b.mark.media); out.mark_url = mk.url; }   // mark_url: the older field, kept
    if (b.mark.states) mk.states = Object.fromEntries(Object.entries(b.mark.states).map(([k, v]) => { const id = typeof v === 'string' ? v : v && v.media; return [k, id ? { media: id, url: url(id) } : v]; }));
    out.mark = mk;
  }
  return out;
}
// the first 4 KB of a proof file, and no more (item 27)
async function first4k(res) {
  const rd = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
  if (!rd) return (await res.text()).slice(0, 4096);
  const parts = []; let n = 0;
  while (n < 4096) { const { done, value } = await rd.read(); if (done) break; parts.push(value); n += value.length; }
  try { await rd.cancel(); } catch { }
  const all = new Uint8Array(Math.min(n, 4096)); let o = 0;
  for (const p of parts) { const take = Math.min(p.length, all.length - o); all.set(p.subarray(0, take), o); o += take; if (o >= all.length) break; }
  return new TextDecoder().decode(all);
}
// POST /v1/brand/verify (no body; at most once a minute): https://<domain>/.well-known/x-hc-draft-brand, or the older person-tools-brand
// file; or a TXT record on _x-hc-draft-brand.<domain>, or the older _person-tools.<domain>. No redirect is followed; LF or CRLF.
export async function verifyBrand(env, key) {
  if (!key || key.anon) throw fixable('unauthorized', 'Authorization', 'A key is needed.', 'Bearer test_...', {}, 401);
  const r = await env.DB.prepare('SELECT domain, domain_token, verified_at, verified_how, verify_tried_at, brand_id FROM brands WHERE principal_id = ?').bind(key.principal_id).first();
  if (!r || !r.domain || !r.domain_token) throw fixable('invalid_field', 'brand.domain', 'Set brand.domain with PUT /v1/brand first.', 'cargpt.pro', {}, 400);
  if (r.verified_at) return { domain: r.domain, verified: true, verified_at: iso(r.verified_at), how: r.verified_how || null, brand_id: r.brand_id || null };
  const now = nowMs();
  if (r.verify_tried_at && now - r.verify_tried_at < 60000) { const wait = Math.ceil((60000 - (now - r.verify_tried_at)) / 1000); throw notFixable(429, 'rate_limited', `POST /v1/brand/verify is at most once a minute: ask again in ${wait} s.`, { retry_after_seconds: wait }); }
  await env.DB.prepare('UPDATE brands SET verify_tried_at = ? WHERE principal_id = ?').bind(now, key.principal_id).run();
  let how = null;
  const { publicHost } = await import('./media.js');
  if (!publicHost(new URL(`https://${r.domain}/`))) throw fixable('invalid_field', 'brand.domain', 'That domain is not a plain public name.', null, {}, 400);
  for (const path of [`/.well-known/${WIRE}-brand`, '/.well-known/person-tools-brand']) {
    if (how) break;
    try {
      const f = await fetch(`https://${r.domain}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(6000), headers: { 'user-agent': 'person.tools-brand-check/1' } });
      if (f.status === 200) { const t = await first4k(f); if (t.split(/\r?\n/).some(l => l.trim() === r.domain_token)) how = 'file'; }
      else { try { await f.body?.cancel(); } catch { } }
    } catch { }
  }
  for (const name of [`_${WIRE}-brand.${r.domain}`, `_person-tools.${r.domain}`]) {
    if (how) break;
    try {
      const d = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(6000) });
      const j = await d.json(); if ((j.Answer || []).some(a => String(a.data || '').replace(/"/g, '').trim() === r.domain_token)) how = 'dns';
    } catch { }
  }
  if (!how) { const p = proveIt(r.domain, r.domain_token); return { domain: r.domain, verified: false, verified_at: null, note: `Not found yet. ${p.say} ${p.also}` }; }
  const { sha256hex } = await import('./util.js'); const bk = rid('bk_', 32);   // OWNER_router_31 (ASKS-9): shown once, kept as its hash
  await env.DB.prepare('UPDATE brands SET verified_at = ?, verified_how = ?, brand_key_hash = ?, brand_key_at = ? WHERE principal_id = ?').bind(now, how, await sha256hex(bk), now, key.principal_id).run();
  return { domain: r.domain, verified: true, verified_at: iso(now), how, brand_id: r.brand_id || null, brand_key: bk, brand_key_note: 'Shown once. An ask placed with the header Brand-Key wears this brand, whatever key places it. Keep it as you keep your other keys: never in an address, a log or an ask.' };
}
// OWNER_router_31 (ASKS-9): POST /v1/brand/key makes a new brand key for a proved brand and stops the old one
export async function newBrandKey(env, key) {
  if (!key || key.anon) throw fixable('unauthorized', 'Authorization', 'A key is needed.', 'Bearer test_...', {}, 401);
  const r = await env.DB.prepare('SELECT brand_id, verified_at, domain FROM brands WHERE principal_id = ?').bind(key.principal_id).first();
  if (!r) throw notFixable(400, 'brand_not_proved', 'Give a brand first: PUT /v1/brand.');
  const proved = !!(r.verified_at && r.domain);   // OWNER_router_32: a test brand's key reaches test members only
  const { sha256hex } = await import('./util.js'); const bk = rid('bk_', 32), now = nowMs();
  await env.DB.prepare('UPDATE brands SET brand_key_hash = ?, brand_key_at = ? WHERE principal_id = ?').bind(await sha256hex(bk), now, key.principal_id).run();
  return { brand_id: r.brand_id || null, brand_key: bk, ...(proved ? {} : { test: true }), note: proved ? 'Shown once; the old brand key is stopped.' : 'Shown once; the old brand key is stopped. This brand has not proved its domain, so its key reaches test members only, never a real person.' };
}
// an ask placed with Brand-Key: the proved brand it names (its principal), or 400 brand_not_proved and nothing stored
export async function brandByKey(env, request) {
  const raw = request && request.headers && request.headers.get('brand-key');
  if (!raw) return null;
  const v = String(raw).trim();
  const { sha256hex } = await import('./util.js');
  const r = /^bk_[a-z0-9]{8,80}$/.test(v) ? await env.DB.prepare('SELECT principal_id, verified_at, domain FROM brands WHERE brand_key_hash = ?').bind(await sha256hex(v)).first() : null;
  if (!r) throw notFixable(400, 'brand_not_proved', 'That Brand-Key names no brand (unknown or stopped); nothing was stored.');
  return { pr: r.principal_id, proved: !!(r.verified_at && r.domain) };   // OWNER_router_32: an unproved (test) brand reaches test members only
}
// OWNER_router_26 item 5 (C4, ASKS-11): a choices block shows the step's own choices, in order; the answers come from the step
export function cardFitsStep(card, step) {
  if (!card) return;
  const norm = (x) => String(x).trim().replace(/\s+/g, ' ');
  for (const [i, b] of card.blocks.entries()) if (b.input && !(step && step.type === 'question' && !(Array.isArray(step.choices) && step.choices.length))) {
    throw fixable('invalid_field', `card.blocks[${i}]`, 'An input block places the line of a question without choices; this step has none. A choice that takes a line gets its label from step.line_for.', null, {}, 400);   // item 31
  }
  for (const [i, b] of card.blocks.entries()) if (b.choices) {
    const sc = step && step.type === 'question' && Array.isArray(step.choices) ? step.choices.map(norm) : null;
    if (!sc || sc.length !== b.choices.length || sc.some((c, j) => c !== norm(b.choices[j]))) throw fixable('choices_differ', `card.blocks[${i}].choices`, 'A choices block shows the step\'s own choices, in order: what can be answered comes from step.choices.', sc, {}, 400);
  }
}

// a brand's picture: one image, at most 256 KB, kept in our store under the principal (POST /v1/brand/mark with the bytes)
const IMG = { 'image/png': (b) => b[0] === 0x89 && b[1] === 0x50, 'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8, 'image/webp': (b) => b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 };
export async function uploadMark(env, request, key) {
  if (!key || key.anon) throw fixable('unauthorized', 'Authorization', 'A key is needed.', 'Bearer test_...', {}, 401);
  const ct = String(request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!IMG[ct]) throw fixable('invalid_field', 'Content-Type', 'A mark is one png, jpeg or webp picture (no svg: it can carry script).', 'image/png', {}, 415);
  if (Number(request.headers.get('content-length') || 0) > 262144) throw notFixable(413, 'content_too_large', 'A mark is at most 256 KB.');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > 262144) throw notFixable(413, 'content_too_large', 'A mark is 1 byte to 256 KB.');
  if (!IMG[ct](bytes)) throw fixable('invalid_field', 'Content-Type', `The bytes are not a ${ct}.`, null, {}, 415);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM media WHERE principal_id = ? AND r2_key LIKE \'brand/%\'').bind(key.principal_id).first();
  if (n && n.n >= 12) throw fixable('invalid_field', 'body', 'At most 12 brand pictures per principal.', null, {}, 400);
  const id = rid('m_'), r2 = 'brand/' + key.principal_id + '/' + id;
  if (!env.MEDIA) throw notFixable(503, 'unavailable', 'Pictures cannot be kept yet.');
  await env.MEDIA.put(r2, bytes, { httpMetadata: { contentType: ct } });
  await env.DB.prepare('INSERT INTO media (id, principal_id, kind, content_type, bytes, r2_key, source, sample, created_at) VALUES (?,?,?,?,?,?,?,0,?)')
    .bind(id, key.principal_id, 'image', ct, bytes.length, r2, 'brand mark', nowMs()).run();
  return { media_id: id, content_type: ct, bytes: bytes.length, note: 'Use it as brand.mark.media or a state of the mark.' };
}
// a mark is shown to anyone the brand asks; served from our store only
export async function serveMark(env, id) {
  const m = await env.DB.prepare('SELECT r2_key, content_type FROM media WHERE id = ? AND (r2_key LIKE \'brand/%\' OR sample = 1) AND kind = \'image\'').bind(String(id || '')).first();
  if (!m || !env.MEDIA) throw notFixable(404, 'not_found', 'No such picture.');
  const o = await env.MEDIA.get(m.r2_key); if (!o) throw notFixable(404, 'not_found', 'No such picture.');
  return new Response(o.body, { status: 200, headers: { 'Content-Type': m.content_type, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" } });
}

// ---- cards ----
// -> the card as stored, or throws 400 naming the block (OWNER_router_26 item 25: the standard's registry). textOf(card) gives every word, for the checks every ask's words pass.
export async function readCard(env, key, card, opts = {}) {
  if (card === undefined || card === null) return null;
  if (typeof card !== 'object' || Array.isArray(card) || Object.keys(card).some(k => k !== 'blocks') || !Array.isArray(card.blocks))
    throw fixable('invalid_field', 'card', 'card is {"blocks": [...]}: headline, text, media, facts, price, when_where, choices or input, in order.', { blocks: [{ headline: 'Thanksgiving is Thursday.' }, { text: 'Are you open?' }] }, {}, 400);
  if (card.blocks.length < 1 || card.blocks.length > 12) throw fixable('invalid_field', 'card.blocks', 'A card has 1 to 12 blocks.', null, {}, 400);
  const out = [];
  for (const [i, b] of card.blocks.entries()) {
    const f = `card.blocks[${i}]`;
    if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).length !== 1) throw fixable('invalid_field', f, 'Each block is one object with one key: its type.', { headline: 'Thanksgiving is Thursday.' }, {}, 400);
    const [type, v] = Object.entries(b)[0];
    if (!BLOCKS.includes(type)) throw fixable('invalid_field', f, `"${type}" is not a block this service draws; the blocks are ${BLOCKS.join(', ')}.`, null, { block: i }, 400);
    if (type === 'headline') out.push({ headline: await words(v, f + '.headline', 80) });
    else if (type === 'text') out.push({ text: await words(v, f + '.text', 600) });
    else if (type === 'media') {
      const id = typeof v === 'string' ? v : null;
      if (!id || !(/^m_[a-z0-9_]{4,60}$/.test(id) || (opts.own && /^om_[a-z0-9]{4,60}$/.test(id)))) throw fixable('invalid_field', f + '.media', 'media is a media id from this service, never an address.', null, {}, 400);
      if (id.startsWith('m_')) await markMedia(env, key.principal_id, id, f + '.media');
      else if (!(await env.DB.prepare('SELECT 1 AS x FROM own_material WHERE id = ? AND connection_id = ?').bind(id, opts.own).first())) throw fixable('invalid_field', f + '.media', 'That piece is not one this AI sent.', null, {}, 400);
      out.push({ media: id });
    } else if (type === 'facts') {
      if (!Array.isArray(v) || !v.length || v.length > 8) throw fixable('invalid_field', f + '.facts', 'facts is 1 to 8 rows of {"label", "value"}.', [{ label: 'Hours', value: '9 to 5' }], {}, 400);
      const rows = [];
      for (const [j, r] of v.entries()) {
        if (!r || typeof r !== 'object' || Object.keys(r).some(k => !['label', 'value'].includes(k))) throw fixable('invalid_field', `${f}.facts[${j}]`, 'A row is {"label", "value"}.', null, {}, 400);
        rows.push({ label: await words(r.label, `${f}.facts[${j}].label`, 40), value: await words(String(r.value ?? ''), `${f}.facts[${j}].value`, 80) });
      }
      out.push({ facts: rows });
    } else if (type === 'price') {
      if (!v || typeof v !== 'object' || !/^\d{1,7}(?:\.\d{2})?$/.test(String(v.amount || '')) || !/^[A-Z]{3}$/.test(String(v.currency || 'USD')) || Object.keys(v).some(k => !['amount', 'currency', 'label'].includes(k)))
        throw fixable('invalid_field', f + '.price', 'price is {"amount": "12.50", "currency": "USD", "label"?}.', { amount: '12.50', currency: 'USD' }, {}, 400);
      out.push({ price: { amount: String(v.amount), currency: v.currency || 'USD', ...(v.label !== undefined ? { label: await words(v.label, f + '.price.label', 40) } : {}) } });
    } else if (type === 'when_where') {
      if (!v || typeof v !== 'object' || Object.keys(v).some(k => !['when', 'where'].includes(k)) || (v.when === undefined && v.where === undefined)) throw fixable('invalid_field', f + '.when_where', 'when_where is {"when"?, "where"?}.', { when: '2026-11-26', where: 'the north lot' }, {}, 400);
      out.push({ when_where: { ...(v.when !== undefined ? { when: await words(v.when, f + '.when', 60) } : {}), ...(v.where !== undefined ? { where: await words(v.where, f + '.where', 120) } : {}) } });
    } else if (type === 'quote') {
      if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !['text', 'by'].includes(k))) throw fixable('invalid_field', f + '.quote', 'quote is {"text", "by"}: words someone else said, and who said them.', { text: 'Do you have the blue one in stock?', by: 'the shopper' }, {}, 400);
      out.push({ quote: { text: await words(v.text, f + '.quote.text', 600), by: await words(v.by, f + '.quote.by', 40) } });
    } else if (type === 'contact') {
      if (typeof v !== 'string' || !/^c[1-4]$/.test(v)) throw fixable('invalid_field', f + '.contact', 'contact names one of the ask\'s contacts: c1 to c4.', 'c1', {}, 400);
      out.push({ contact: v });
    } else if (type === 'choices') {
      if (!Array.isArray(v) || v.length < 2 || v.length > 4) throw fixable('invalid_field', f + '.choices', 'choices shows 2 to 4 short labels (the answers themselves come from the ask\'s step).', ['Open as usual', 'Closed'], {}, 400);
      const cs = []; for (const [j, c] of v.entries()) cs.push(await words(c, `${f}.choices[${j}]`, 40)); out.push({ choices: cs });
    } else if (type === 'input') {
      if (!v || typeof v !== 'object' || Object.keys(v).some(k => !['label', 'placeholder'].includes(k))) throw fixable('invalid_field', f + '.input', 'input is {"label", "placeholder"?}.', { label: 'Opening time' }, {}, 400);
      const label = await words(v.label, f + '.input.label', 80), ph = v.placeholder === undefined ? null : await words(v.placeholder, f + '.input.placeholder', 80);
      if (CREDENTIAL.test(label) || (ph && CREDENTIAL.test(ph))) throw fixable('invalid_field', f + '.input', 'A card never asks for a password, a one-time code, a card or bank number, an ID number or a key.', null, { block: i }, 400);
      out.push({ input: { label, ...(ph ? { placeholder: ph } : {}) } });
    }
  }
  return { blocks: out };
}
export function textOf(card) {
  if (!card) return [];
  const t = [];
  for (const b of card.blocks) {
    if (b.headline) t.push(b.headline); if (b.text) t.push(b.text);
    if (b.facts) for (const r of b.facts) t.push(r.label, r.value);
    if (b.price && b.price.label) t.push(b.price.label);
    if (b.when_where) t.push(b.when_where.when || '', b.when_where.where || '');
    if (b.choices) t.push(...b.choices);
    if (b.input) t.push(b.input.label, b.input.placeholder || '');
    if (b.quote) t.push(b.quote.text, b.quote.by);
  }
  return t.filter(Boolean);
}
