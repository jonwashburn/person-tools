// SOMEONE ELSE'S CONTACT DETAILS ON AN ASK (OWNER_router_29 item 1; protocol/ORDER_REQUEST_SERVICE.md tier 2, items 9 to 15; the standard's
// 27.7; TRUST's DATA.md row "contacts on an ask", 2:43 PM CT 16 Nov). One field, contacts: at most four people who contacted the asker
// first or agreed to be contacted. Their name, phone and email are seen only by the person the ask is for, on the open ask, and by the
// service that sent them; they are deleted within a minute of the ask leaving open (the answer path, withdraw, lapse and the retention
// sweep), keeping id, role, ref, consent and consent_at. Never passed on, never in an alert, a push, history, a count or a log.
import { fixable, notFixable } from './spec.js';
import { iso } from './util.js';

const CONSENTS = ['they_contacted_the_asker', 'they_agreed_to_be_contacted'];
const REF_RX = /\{c([1-9])\}/g;
const LONG_NUMBER = /\d(?:[\s().-]*\d){6,}/;   // seven or more digits in a run; spaces, brackets, dots and hyphens do not break it
const EXAMPLE = [{ id: 'c1', role: 'shopper', name: 'Avery Johnson', phone: '+15125550142', consent: 'they_contacted_the_asker' }];

function readOne(c, i) {
  const f = `contacts[${i}]`;
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw fixable('invalid_field', f, 'A contact is {"id", "role", "name"?, "phone"?, "email"?, "ref"?, "consent"}.', EXAMPLE[0], {}, 400);
  for (const k of Object.keys(c)) if (!['id', 'role', 'name', 'phone', 'email', 'ref', 'consent'].includes(k)) throw fixable('unknown_field', `${f}.${k}`, `"${k}" is not part of a contact.`, null, {}, 400);
  if (typeof c.id !== 'string' || !/^c[1-4]$/.test(c.id)) throw fixable('invalid_field', `${f}.id`, 'id is c1, c2, c3 or c4.', 'c1', {}, 400);
  const role = typeof c.role === 'string' ? c.role.trim().replace(/\s+/g, ' ') : '';
  if (!/^[\p{L} ]{1,30}$/u.test(role)) throw fixable('invalid_field', `${f}.role`, 'role is who they are to the person ("shopper", "caller", "the plumber"): 1 to 30 letters and spaces.', 'shopper', {}, 400);
  const out = { id: c.id, role };
  if (c.name !== undefined) { if (typeof c.name !== 'string' || !c.name.trim() || c.name.trim().length > 80 || /[‪-‮⁦-⁩]/.test(c.name)) throw fixable('invalid_field', `${f}.name`, 'name is 1 to 80 characters.', 'Avery Johnson', {}, 400); out.name = c.name.trim().replace(/\s+/g, ' '); }
  if (c.phone !== undefined) { if (typeof c.phone !== 'string' || !/^\+[1-9]\d{6,14}$/.test(c.phone)) throw fixable('invalid_field', `${f}.phone`, 'phone is in E.164 (a +, the country code, then the number, digits only); it is not rewritten.', '+15125550142', {}, 400); out.phone = c.phone; }
  if (c.email !== undefined) { if (typeof c.email !== 'string' || c.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) throw fixable('invalid_field', `${f}.email`, 'email is one address, at most 254 characters.', 'avery@example.com', {}, 400); out.email = c.email; }
  if (c.ref !== undefined) { if (typeof c.ref !== 'string' || !c.ref.trim() || c.ref.length > 80) throw fixable('invalid_field', `${f}.ref`, 'ref is the service\'s own id for them, 1 to 80 characters.', 'cv_812', {}, 400); out.ref = c.ref.trim(); }
  if (!out.name && !out.phone && !out.email) throw fixable('invalid_field', f, 'A contact gives a name, a phone or an email (or more than one).', EXAMPLE[0], {}, 400);
  if (!CONSENTS.includes(c.consent)) throw fixable('invalid_field', `${f}.consent`, 'consent is the service\'s statement: "they_contacted_the_asker" (they got in touch first) or "they_agreed_to_be_contacted". Someone who contacted nobody is not put in contacts at all.', 'they_contacted_the_asker', {}, 400);
  out.consent = c.consent;
  // TRUST 2:43 PM CT: a role is never a name: no word after the first starts with a capital, and no word of the contact's name
  const words = role.split(' ');
  const nameWords = new Set(String(out.name || '').toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 2));
  if (words.slice(1).some((w) => /^\p{Lu}/u.test(w)) || words.some((w) => nameWords.has(w.toLowerCase()))) throw fixable('invalid_field', `${f}.role`, 'A role says who they are to the person, never their name ("shopper", not "Avery").', 'shopper', {}, 400);
  return out;
}

// the words an ask carries that may refer to a contact, with where each stands
export function askWords(title, step, card, unlocks) {
  const w = [['title', title]];
  if (unlocks) w.push(['unlocks', unlocks]);   // PROTOCOL 9:58: unlocks, line_for labels and approval labels may refer too
  if (step) { if (step.text) w.push(['step.text', step.text]); (step.choices || []).forEach((c, i) => w.push([`step.choices[${i}]`, c]));
    for (const [k, v] of Object.entries(step.line_for || {})) w.push([`step.line_for.${k}`, v]);
    if (step.approve_label) w.push(['step.approve_label', step.approve_label]); if (step.deny_label) w.push(['step.deny_label', step.deny_label]); }
  for (const [i, b] of ((card && card.blocks) || []).entries()) {
    const f = `card.blocks[${i}]`;
    if (b.headline) w.push([f + '.headline', b.headline]); if (b.text) w.push([f + '.text', b.text]);
    if (b.facts) b.facts.forEach((r, j) => w.push([`${f}.facts[${j}].value`, r.value]));
    if (b.quote) w.push([f + '.quote.text', b.quote.text]);
    if (b.when_where) { if (b.when_where.when) w.push([f + '.when_where.when', b.when_where.when]); if (b.when_where.where) w.push([f + '.when_where.where', b.when_where.where]); }
  }
  return w.filter(([, v]) => typeof v === 'string' && v);
}
// unlocks and the remaining card words: checked for long numbers, never for references
function otherWords(unlocks, card) {
  const w = [];   // unlocks is read with the ask's own words (askWords)
  for (const [i, b] of ((card && card.blocks) || []).entries()) { if (b.quote && b.quote.by) w.push([`card.blocks[${i}].quote.by`, b.quote.by]); if (b.facts) b.facts.forEach((r, j) => w.push([`card.blocks[${i}].facts[${j}].label`, r.label])); }
  return w;
}

// an ask's contacts: read, and every reference, call step and contact block checked against them. -> the stored list, or null
export function askContacts(raw, { title, step, card, unlocks }, placedAt) {
  let list = null;
  if (raw !== undefined && raw !== null) {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 4) throw fixable('invalid_field', 'contacts', 'contacts is 1 to 4 people who contacted the asker first or agreed to be contacted.', EXAMPLE, {}, 400);
    list = raw.map(readOne);
    const ids = list.map((c) => c.id); if (new Set(ids).size !== ids.length) throw fixable('invalid_field', 'contacts', 'Each contact has its own id.', null, {}, 400);
    for (const c of list) c.consent_at = iso(placedAt);
  }
  const has = new Set((list || []).map((c) => c.id));
  for (const [field, v] of askWords(title, step, card, unlocks)) for (const m of v.matchAll(REF_RX)) if (!has.has('c' + m[1])) throw fixable('unknown_reference', field, `{c${m[1]}} names a contact this ask does not carry.`, null, {}, 400);
  if (step && step.type === 'call') {
    const c = (list || []).find((x) => x.id === step.contact);
    if (!c) throw fixable('unknown_reference', 'step.contact', `${step.contact} is not a contact of this ask.`, 'c1', {}, 400);
    if (!c.phone) throw fixable('invalid_field', 'step.contact', 'A call step names a contact that has a phone.', 'c1', {}, 400);
  }
  for (const [i, b] of ((card && card.blocks) || []).entries()) if (b.contact && !has.has(b.contact)) throw fixable('unknown_reference', `card.blocks[${i}].contact`, `${b.contact} is not a contact of this ask.`, null, {}, 400);
  if (list) for (const [i, c] of list.entries()) if (c.ref && LONG_NUMBER.test(c.ref)) throw fixable('number_outside_contacts', `contacts[${i}].ref`, 'A ref outlives the ask, so it never holds a long number: give the id a letter prefix, such as lead-5125.', 'lead-5125', {}, 400);   // TRUST 5:06
  if (list) for (const [i, c] of list.entries()) if (c.name && LONG_NUMBER.test(c.name)) throw fixable('number_outside_contacts', `contacts[${i}].name`, 'A long number goes in the contact\'s phone, never in its name.', EXAMPLE, {}, 400);
  if (list) for (const [field, v] of [...askWords(title, step, card, unlocks), ...otherWords(unlocks, card)]) if (LONG_NUMBER.test(v)) throw fixable('number_outside_contacts', field, 'A long number in an ask that carries contacts goes in contacts: put it there and write {c1} where it stood.', EXAMPLE, {}, 400);
  return list;
}
// a person's ask to their own people, a call or an offer: no one else's details (ASKS-20)
export function refuseContacts(raw) { if (raw !== undefined) throw notFixable(400, 'contacts_not_allowed', 'Contacts travel only on an ask from a person\'s own AI or from a principal to its own private panel; nothing was stored.'); }
// what a log may keep of words: long numbers and email addresses masked (TRUST 5:06: the refusal list kept a phone number)
export const maskForLog = (v) => typeof v === 'string' ? v.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[an email address]').replace(/\d(?:[\s().-]*\d){6,}/g, '[a long number]') : v;
export const parse = (json) => { try { const v = JSON.parse(json || 'null'); return Array.isArray(v) && v.length ? v : null; } catch { return null; } };
// the person's own list: everything but the service's ref
export const forPerson = (list) => list ? list.map(({ ref, ...c }) => c) : null;
// where details never go (alerts, logs, any line outside the open card): a reference reads as the contact's role
// PROTOCOL 5:33 PM CT: drawn as "the <role>" (a role that already starts with the, a, an, my or your is left as it is)
export const drawRoles = (text, list) => { const s = String(text == null ? '' : text); return s.replace(REF_RX, (m, n, at) => {
  const c = (list || []).find((x) => x.id === 'c' + n); const w = c ? (/^(?:the|a|an|my|your)\s/i.test(c.role) ? c.role : 'the ' + c.role) : 'someone';
  return at === 0 || /[.!?]\s+$/.test(s.slice(0, at)) ? w.charAt(0).toUpperCase() + w.slice(1) : w; }); };   // PROTOCOL 5:55 (CARD-12): a sentence's first word takes a capital
// the open card, as the person saw it (a signed approval's digest covers this)
export const drawNames = (text, list) => String(text == null ? '' : text).replace(REF_RX, (m, n) => { const c = (list || []).find((x) => x.id === 'c' + n); return c ? (c.name || c.role) : m; });
export const hasRefs = (text) => /\{c[1-9]\}/.test(String(text || ''));
// a reply's contact_ref: a call step's contact, or a choice that is a reference
export function contactRef(list, step, choice) {
  const id = step && step.type === 'call' ? step.contact : (typeof choice === 'string' && /^\{c[1-4]\}$/.test(choice) ? choice.slice(1, -1) : null);
  if (!id) return undefined;
  const c = (list || []).find((x) => x.id === id); return c ? (c.ref || null) : null;
}
// name, phone and email deleted once the ask has left open (ASKS-19): for one ask, or (id null) every closed ask still holding them
export const STRIP_SQL = "UPDATE tasks SET contacts_json = (SELECT json_group_array(json(json_remove(value, '$.name', '$.phone', '$.email'))) FROM json_each(tasks.contacts_json)) WHERE contacts_json IS NOT NULL AND state != 'open' AND (contacts_json LIKE '%\"name\"%' OR contacts_json LIKE '%\"phone\"%' OR contacts_json LIKE '%\"email\"%')";
export async function stripClosed(env, taskId) {
  if (taskId) return env.DB.prepare(STRIP_SQL + ' AND id = ?').bind(taskId).run();
  return env.DB.prepare(STRIP_SQL).run();
}
