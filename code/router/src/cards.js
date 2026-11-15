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
const BLOCKS = ['headline', 'text', 'media', 'facts', 'price', 'when_where', 'choices', 'input'];
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
async function words(v, field, max, opt = {}) {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw fixable('invalid_field', field, `${field} is 1 to ${max} characters.`, opt.example || null, {}, 422);
  const s = v.trim().replace(/\s+/g, ' ');
  if (NO_ADDRESS.test(s)) throw fixable('invalid_field', field, `${field} carries no address, script or markup: words only.`, null, {}, 422);
  if (!FOLD) { const S = await import('./screening/index.js'); FOLD = typeof S.foldForNames === 'function' ? S.foldForNames : (x) => String(x).toLowerCase(); }
  const f = FOLD(s);
  if (OURS.test(s) || OURS.test(f) || OUR_START.test(f)) throw fixable('invalid_field', field, `"${s.slice(0, 40)}" is one of the client's own controls; a card cannot draw it.`, null, {}, 422);
  if (VOUCH.test(f) || /\bnamed by the asker\b/.test(f) || await claimsUs(s, true)) throw fixable('invalid_field', field, 'A card cannot say person.tools checked, verified or vouches for anything, or use its labels.', null, {}, 422);
  return s;
}

// ---- brands ----
async function nameCheck(env, v, field) {
  const { checkAskerName } = await import('./panels.js'); const { screenTerms } = await import('./private_terms.js');
  try { return await checkAskerName(v, await screenTerms(env)); }
  catch (e) { if (e && e.body) { e.body.field = field; e.body.message = String(e.body.message || '').replace(/^asker_name/, field); e.status = 422; e.body.status = 422; } throw e; }
}
async function markMedia(env, principalId, id, field) {
  if (typeof id !== 'string' || !/^m_[a-z0-9_]{4,60}$/.test(id)) throw fixable('invalid_field', field, `${field} is a media id from this service (POST /v1/brand/mark gives one), never an address.`, null, {}, 422);
  const m = await env.DB.prepare('SELECT id, kind, principal_id, sample FROM media WHERE id = ?').bind(id).first();
  if (!m || m.kind !== 'image' || !(m.sample || m.principal_id === principalId)) throw fixable('invalid_field', field, `${field} is not a picture of yours in this service.`, null, {}, 422);
  return id;
}
export async function putBrand(env, key, b) {
  if (!key || key.anon) throw fixable('unauthorized', 'Authorization', 'A brand belongs to a key\'s principal: send the key.', 'Bearer test_...', {}, 401);
  const br = b && b.brand !== undefined ? b.brand : b;
  if (!br || typeof br !== 'object' || Array.isArray(br)) throw fixable('invalid_field', 'brand', 'brand is {"name", "mark", "colours", "grounds"}; a name alone is a complete brand.', { name: 'CarGPT' }, {}, 422);
  for (const k of Object.keys(br)) if (!['name', 'mark', 'colours', 'grounds', 'domain'].includes(k)) throw fixable('unknown_field', 'brand.' + k, `"${k}" is not part of a brand; send name, mark, colours, grounds and domain.`, null, {}, 422);
  const out = { name: await nameCheck(env, br.name, 'brand.name') };
  // OWNER_router_10 C: the domain the brand proves it controls before it shows on anyone's card
  let domain = null;
  if (br.domain !== undefined) {
    domain = String(br.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) || /(^|\.)person\.tools$/.test(domain)) throw fixable('invalid_field', 'brand.domain', 'domain is the brand\'s own domain name, such as cargpt.pro.', 'cargpt.pro', {}, 422);
  }
  if (br.mark !== undefined) {
    const mk = br.mark; if (!mk || typeof mk !== 'object' || Array.isArray(mk)) throw fixable('invalid_field', 'brand.mark', 'mark is {"media", "states"}.', null, {}, 422);
    for (const k of Object.keys(mk)) if (!['media', 'states'].includes(k)) throw fixable('unknown_field', 'brand.mark.' + k, `"${k}" is not part of a mark.`, null, {}, 422);
    out.mark = { media: await markMedia(env, key.principal_id, mk.media, 'brand.mark.media') };
    if (mk.states !== undefined) {
      if (!mk.states || typeof mk.states !== 'object' || Array.isArray(mk.states)) throw fixable('invalid_field', 'brand.mark.states', 'states maps idle, needs_you and answered to media ids.', null, {}, 422);
      out.mark.states = {};
      for (const [k, v] of Object.entries(mk.states)) { if (!['idle', 'needs_you', 'answered'].includes(k)) throw fixable('unknown_field', 'brand.mark.states.' + k, 'A state is idle, needs_you or answered.', null, {}, 422); out.mark.states[k] = await markMedia(env, key.principal_id, v, 'brand.mark.states.' + k); }
    }
  }
  if (br.colours !== undefined) {
    if (!Array.isArray(br.colours) || br.colours.length > 4) throw fixable('invalid_field', 'brand.colours', 'colours is a list of at most 4 {"value": "#rrggbb", "means": "..."}.', [{ value: '#e8590c', means: 'needs you' }], {}, 422);
    out.colours = [];
    for (const [i, c] of br.colours.entries()) {
      if (!c || typeof c !== 'object' || !HEX.test(c.value || '') || Object.keys(c).some(k => !['value', 'means'].includes(k))) throw fixable('invalid_field', `brand.colours[${i}]`, 'Each colour is {"value": "#rrggbb", "means": "what it is used for"}.', { value: '#e8590c', means: 'needs you' }, {}, 422);
      out.colours.push({ value: c.value.toLowerCase(), means: await nameCheck(env, c.means, `brand.colours[${i}].means`) });
    }
  }
  if (br.grounds !== undefined) {
    const g = br.grounds; if (!g || typeof g !== 'object' || Object.keys(g).some(k => !['light', 'dark'].includes(k)) || Object.values(g).some(v => !HEX.test(v || '')))
      throw fixable('invalid_field', 'brand.grounds', 'grounds is {"light": "#rrggbb", "dark": "#rrggbb"}.', { light: '#f7f5f0', dark: '#141414' }, {}, 422);
    out.grounds = Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.toLowerCase()]));
  }
  const now = nowMs();
  const had = await env.DB.prepare('SELECT domain, domain_token, verified_at FROM brands WHERE principal_id = ?').bind(key.principal_id).first();
  const same = had && had.domain === domain;
  const token = domain ? (same && had.domain_token ? had.domain_token : 'person-tools-brand=' + [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join('')) : null;
  const verified = same ? had.verified_at : null;   // a new domain proves itself again
  await env.DB.prepare('INSERT INTO brands (principal_id, brand_json, updated_at, domain, domain_token, verified_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(principal_id) DO UPDATE SET brand_json = excluded.brand_json, updated_at = excluded.updated_at, domain = excluded.domain, domain_token = excluded.domain_token, verified_at = excluded.verified_at')
    .bind(key.principal_id, JSON.stringify(out), now, domain, token, verified).run();
  return { brand: out, updated_at: iso(now), domain, verified: !!verified, ...(domain && !verified ? { prove_it: { file: `https://${domain}/.well-known/person-tools-brand containing the line ${token}`, or_dns: `a TXT record on _person-tools.${domain} with the value ${token}`, then: 'POST /v1/brand/verify' } } : {}),
    note: 'A brand shows on a person\'s card only once its domain is proved. The person\'s app always draws who is asking itself, from the service.' };
}
export async function getBrand(env, key) {
  if (!key || key.anon) throw fixable('unauthorized', 'Authorization', 'A key is needed.', 'Bearer test_...', {}, 401);
  const r = await env.DB.prepare('SELECT brand_json, updated_at, domain, domain_token, verified_at FROM brands WHERE principal_id = ?').bind(key.principal_id).first();
  return { brand: r ? JSON.parse(r.brand_json) : null, updated_at: r ? iso(r.updated_at) : null, domain: r ? r.domain : null, verified_at: r ? iso(r.verified_at) : null,
    ...(r && r.domain && !r.verified_at ? { prove_it: { file: `https://${r.domain}/.well-known/person-tools-brand containing the line ${r.domain_token}`, or_dns: `a TXT record on _person-tools.${r.domain} with the value ${r.domain_token}` } } : {}) };
}
// only a brand that proved its domain is shown on a card (OWNER_router_10 C), with that domain beside its name
export async function brandOf(env, principalId) {
  const r = await env.DB.prepare('SELECT brand_json, domain, verified_at FROM brands WHERE principal_id = ?').bind(principalId).first();
  return r && r.verified_at && r.domain ? { ...JSON.parse(r.brand_json), domain: r.domain, verified: true } : null;
}
// POST /v1/brand/verify: the file at https://<domain>/.well-known/person-tools-brand, or a TXT record on _person-tools.<domain>
export async function verifyBrand(env, key) {
  if (!key || key.anon) throw fixable('unauthorized', 'Authorization', 'A key is needed.', 'Bearer test_...', {}, 401);
  const r = await env.DB.prepare('SELECT domain, domain_token, verified_at FROM brands WHERE principal_id = ?').bind(key.principal_id).first();
  if (!r || !r.domain || !r.domain_token) throw fixable('invalid_field', 'brand.domain', 'Set brand.domain with PUT /v1/brand first.', 'cargpt.pro', {}, 422);
  if (r.verified_at) return { domain: r.domain, verified: true, verified_at: iso(r.verified_at) };
  let how = null;
  const { publicHost } = await import('./media.js');
  if (!publicHost(new URL(`https://${r.domain}/`))) throw fixable('invalid_field', 'brand.domain', 'That domain is not a plain public name.', null, {}, 422);
  try {
    const f = await fetch(`https://${r.domain}/.well-known/person-tools-brand`, { redirect: 'manual', signal: AbortSignal.timeout(6000), headers: { 'user-agent': 'person.tools-brand-check/1' } });
    if (f.status === 200) { const t = (await f.text()).slice(0, 4096); if (t.split(/\r?\n/).some(l => l.trim() === r.domain_token)) how = 'file'; }
  } catch { }
  if (!how) {
    try {
      const d = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent('_person-tools.' + r.domain)}&type=TXT`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(6000) });
      const j = await d.json(); if ((j.Answer || []).some(a => String(a.data || '').replace(/"/g, '').trim() === r.domain_token)) how = 'dns';
    } catch { }
  }
  if (!how) return { domain: r.domain, verified: false, note: `Not found yet: put ${r.domain_token} in https://${r.domain}/.well-known/person-tools-brand, or a TXT record on _person-tools.${r.domain}, then ask again.` };
  const now = nowMs();
  await env.DB.prepare('UPDATE brands SET verified_at = ?, verified_how = ? WHERE principal_id = ?').bind(now, how, key.principal_id).run();
  return { domain: r.domain, verified: true, verified_at: iso(now), how };
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
  if (n && n.n >= 12) throw fixable('invalid_field', 'body', 'At most 12 brand pictures per principal.', null, {}, 422);
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
// -> the card as stored, or throws 422 naming the block. textOf(card) gives every word, for the checks every ask's words pass.
export async function readCard(env, key, card, opts = {}) {
  if (card === undefined || card === null) return null;
  if (typeof card !== 'object' || Array.isArray(card) || Object.keys(card).some(k => k !== 'blocks') || !Array.isArray(card.blocks))
    throw fixable('invalid_field', 'card', 'card is {"blocks": [...]}: headline, text, media, facts, price, when_where, choices or input, in order.', { blocks: [{ headline: 'Thanksgiving is Thursday.' }, { text: 'Are you open?' }] }, {}, 422);
  if (card.blocks.length < 1 || card.blocks.length > 12) throw fixable('invalid_field', 'card.blocks', 'A card has 1 to 12 blocks.', null, {}, 422);
  const out = [];
  for (const [i, b] of card.blocks.entries()) {
    const f = `card.blocks[${i}]`;
    if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).length !== 1) throw fixable('invalid_field', f, 'Each block is one object with one key: its type.', { headline: 'Thanksgiving is Thursday.' }, {}, 422);
    const [type, v] = Object.entries(b)[0];
    if (!BLOCKS.includes(type)) throw fixable('invalid_field', f, `"${type}" is not a block this service draws; the blocks are ${BLOCKS.join(', ')}.`, null, { block: i }, 422);
    if (type === 'headline') out.push({ headline: await words(v, f + '.headline', 80) });
    else if (type === 'text') out.push({ text: await words(v, f + '.text', 600) });
    else if (type === 'media') {
      const id = typeof v === 'string' ? v : null;
      if (!id || !(/^m_[a-z0-9_]{4,60}$/.test(id) || (opts.own && /^om_[a-z0-9]{4,60}$/.test(id)))) throw fixable('invalid_field', f + '.media', 'media is a media id from this service, never an address.', null, {}, 422);
      if (id.startsWith('m_')) await markMedia(env, key.principal_id, id, f + '.media');
      else if (!(await env.DB.prepare('SELECT 1 AS x FROM own_material WHERE id = ? AND connection_id = ?').bind(id, opts.own).first())) throw fixable('invalid_field', f + '.media', 'That piece is not one this AI sent.', null, {}, 422);
      out.push({ media: id });
    } else if (type === 'facts') {
      if (!Array.isArray(v) || !v.length || v.length > 8) throw fixable('invalid_field', f + '.facts', 'facts is 1 to 8 rows of {"label", "value"}.', [{ label: 'Hours', value: '9 to 5' }], {}, 422);
      const rows = [];
      for (const [j, r] of v.entries()) {
        if (!r || typeof r !== 'object' || Object.keys(r).some(k => !['label', 'value'].includes(k))) throw fixable('invalid_field', `${f}.facts[${j}]`, 'A row is {"label", "value"}.', null, {}, 422);
        rows.push({ label: await words(r.label, `${f}.facts[${j}].label`, 40), value: await words(String(r.value ?? ''), `${f}.facts[${j}].value`, 80) });
      }
      out.push({ facts: rows });
    } else if (type === 'price') {
      if (!v || typeof v !== 'object' || !/^\d{1,7}(?:\.\d{2})?$/.test(String(v.amount || '')) || !/^[A-Z]{3}$/.test(String(v.currency || 'USD')) || Object.keys(v).some(k => !['amount', 'currency', 'label'].includes(k)))
        throw fixable('invalid_field', f + '.price', 'price is {"amount": "12.50", "currency": "USD", "label"?}.', { amount: '12.50', currency: 'USD' }, {}, 422);
      out.push({ price: { amount: String(v.amount), currency: v.currency || 'USD', ...(v.label !== undefined ? { label: await words(v.label, f + '.price.label', 40) } : {}) } });
    } else if (type === 'when_where') {
      if (!v || typeof v !== 'object' || Object.keys(v).some(k => !['when', 'where'].includes(k)) || (v.when === undefined && v.where === undefined)) throw fixable('invalid_field', f + '.when_where', 'when_where is {"when"?, "where"?}.', { when: '2026-11-26', where: 'the north lot' }, {}, 422);
      out.push({ when_where: { ...(v.when !== undefined ? { when: await words(v.when, f + '.when', 60) } : {}), ...(v.where !== undefined ? { where: await words(v.where, f + '.where', 120) } : {}) } });
    } else if (type === 'choices') {
      if (!Array.isArray(v) || v.length < 2 || v.length > 4) throw fixable('invalid_field', f + '.choices', 'choices shows 2 to 4 short labels (the answers themselves come from the ask\'s step).', ['Open as usual', 'Closed'], {}, 422);
      const cs = []; for (const [j, c] of v.entries()) cs.push(await words(c, `${f}.choices[${j}]`, 40)); out.push({ choices: cs });
    } else if (type === 'input') {
      if (!v || typeof v !== 'object' || Object.keys(v).some(k => !['label', 'placeholder'].includes(k))) throw fixable('invalid_field', f + '.input', 'input is {"label", "placeholder"?}.', { label: 'Opening time' }, {}, 422);
      const label = await words(v.label, f + '.input.label', 80), ph = v.placeholder === undefined ? null : await words(v.placeholder, f + '.input.placeholder', 80);
      if (CREDENTIAL.test(label) || (ph && CREDENTIAL.test(ph))) throw fixable('invalid_field', f + '.input', 'A card never asks for a password, a one-time code, a card or bank number, an ID number or a key.', null, { block: i }, 422);
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
  }
  return t.filter(Boolean);
}
