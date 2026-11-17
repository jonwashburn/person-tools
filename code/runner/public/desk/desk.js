/* person.tools Desk: answer your AIs from a desktop. Built from the person-client contract (spec section 8.1).
   Plain JavaScript, no outside requests but the API. Everything an AI wrote is put into the page as text, never as HTML. */
'use strict';
(() => {

const API = ((document.querySelector('meta[name="desk-api"]') || {}).content || 'https://api.person.tools').replace(/\/+$/, '');
const POLL_MS = 15000;
const UNDO_MS = 5000;
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
// Passkey sign-in is shown only once TRUST has said the session road holds (SERVICE, 3:27 PM CT, 15 Nov).
const PASSKEY_ON = (document.querySelector('meta[name="desk-passkey"]') || {}).content === 'on';
// The QR road (SERVICE's router_14) is switched on when SERVICE says it is live.
const QR_ON = (document.querySelector('meta[name="desk-qr"]') || {}).content === 'on' && typeof window.qrcode === 'function';
const MOD = IS_MAC ? '⌘' : 'Ctrl';

/* ---------- small helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
// replaceChildren(null) writes the word "null": every pane is filled through this, which drops empty children
function fill(el, ...kids) { el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false)); return el; }
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return e;
}
const kbd = (k) => h('kbd', { 'aria-hidden': 'true' }, k);
const enc = encodeURIComponent;
function store(kind) { try { return kind === 'local' ? window.localStorage : window.sessionStorage; } catch (e) { return null; } }
function sget(kind, k) { try { const s = store(kind); return s ? s.getItem(k) : null; } catch (e) { return null; } }
function sset(kind, k, v) { try { const s = store(kind); if (s) s.setItem(k, v); } catch (e) { /* storage blocked: keep in memory */ } }
function sdel(kind, k) { try { const s = store(kind); if (s) s.removeItem(k); } catch (e) { /* nothing */ } }
function pref(k, d) { const v = sget('local', 'desk.pref.' + k); return v === null ? d : v; }
function setPref(k, v) { sset('local', 'desk.pref.' + k, v); }
function sr(msg) { const n = $('#sr'); n.textContent = ''; setTimeout(() => { n.textContent = msg; }, 30); }

/* ---------- time, in the person's own clock with its zone ---------- */
const fmtClock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const fmtClockZ = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const ms = (iso) => { const t = Date.parse(iso || ''); return isNaN(t) ? 0 : t; };
function sameDay(a, b) { const x = new Date(a), y = new Date(b); return x.toDateString() === y.toDateString(); }
function when(iso) {
  const t = ms(iso); if (!t) return '';
  return sameDay(t, Date.now()) ? fmtClockZ.format(t) : fmtDay.format(t) + ', ' + fmtClockZ.format(t);
}
function age(iso) {
  const t = ms(iso); if (!t) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return '<1m';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}
function leftWords(iso) {
  // An ask that closes within the hour shows its time left; later ones show nothing (router_15).
  const t = ms(iso); if (!t) return null;
  const s = (t - Date.now()) / 1000;
  if (s <= 0 || s > 3600) return null;
  if (s < 60) return 'under a minute left';
  const m = Math.ceil(s / 60); return m + (m === 1 ? ' minute left' : ' minutes left');
}
function agoWords(iso) {
  const t = ms(iso); if (!t) return 'never';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) { const m = Math.floor(s / 60); return m + (m === 1 ? ' minute ago' : ' minutes ago'); }
  if (s < 86400) { const x = Math.floor(s / 3600); return x + (x === 1 ? ' hour ago' : ' hours ago'); }
  const d = Math.floor(s / 86400); return d + (d === 1 ? ' day ago' : ' days ago');
}

/* ---------- the API: the credential goes in a header, never in an address ---------- */
function authHeaders() {
  const h0 = { 'Authorization': 'Bearer ' + S.cred };
  if (S.member && /^ps_/.test(S.cred || '')) h0['X-Person-Member'] = S.member;
  return h0;
}
let inflight = new AbortController(); // signing out cancels every request still on its way
async function api(method, path, body, opts = {}) {
  if (!S.cred) throw { status: 0, code: 'signed_out', message: 'Signed out.' };
  const headers = authHeaders();
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let r;
  try {
    r = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: !!opts.keepalive, signal: opts.keepalive ? undefined : inflight.signal });
  } catch (e) {
    if (e && e.name === 'AbortError') throw { status: 0, code: 'signed_out', message: 'Signed out.' };
    throw { status: 0, code: 'unreached', message: 'The Desk could not reach person.tools. Check this computer\'s connection.' };
  }
  let data = null;
  try { data = await r.json(); } catch (e) { data = null; }
  if (!r.ok) throw { status: r.status, code: data && data.code, message: (data && data.message) || ('person.tools answered ' + r.status + '.'), data };
  return data;
}
async function apiBlob(path) {
  if (!S.cred) throw { status: 0 };
  const r = await fetch(API + path, { headers: authHeaders(), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: inflight.signal });
  if (!r.ok) throw { status: r.status };
  return r.blob();
}

/* ---------- state ---------- */
const S = {
  cred: null, remember: false, memberId: null,
  open: [], history: [], conns: null, settings: null,
  sel: null, hsel: null, view: 'asks',
  features: new Set(),     // the server's optional parts, from discovery
  sort: pref('sort', 'fair'), filter: null,
  pending: new Map(),      // task_id -> {task, body, label, until, timer}
  sentLocal: new Map(),    // task_id -> task with reply, answered here this session
  closed: new Map(),       // task_id -> when this Desk saw it close (answered, already answered, gone); a list fetched
                           // before that moment may still hold it, so it stays out for a minute
  drafts: new Map(),       // task_id -> {text, note, approve}
  failed: new Map(),       // task_id -> {message}
  gone: null,              // a line about an ask that left the list while selected
  later: {},               // task_id -> when marked Later (kept on this computer)
  seen2: new Set(),        // task ids opened on this computer
  blockedCalls: new Set(), // calls whose caller was blocked here (the service may still list the offer)
  people: null, sent: null, ssel: null, sentSeen: new Set(), compose: null, pendingSend: null, // a person as asker
  media: new Map(),        // task_id -> {url, type} | {error}
  lastOk: 0, lastErr: null, pollTimer: null, pollDelay: POLL_MS, loading: false,
  shownOnce: null,         // a new connection's key and link, shown once, never stored
  offers: [], seats: new Map(), seen: {}, // calls offered to the person; their ring cards; when each was first seen
  cardSig: '',
};
const URG = { now: 0, today: 1, whenever: 2 };
const urg = (t) => (t.urgency in URG ? URG[t.urgency] : 1);
const tms = (t) => ms(t.created_at);
const passerName = (t) => { const pb = t.passed_on_by || t.passed_by; return pb ? (typeof pb === 'string' ? pb : (pb.name || pb.alias || '')) : ''; };
// An ask passed on to this person groups apart from their own AIs, even when the names match ("Home camera via <passer>")
const whoKey = (t) => (passerName(t) ? 'via:' + passerName(t) + ':' : '') + ((t.connection && t.connection.id) || ('from:' + (t.from || '')));
const whoLabel = (t) => whoName(t) + (passerName(t) ? ' via ' + passerName(t) : '');
const whoName = (t) => t.from || (t.connection && t.connection.name) || 'An AI';
function draft(id) { if (!S.drafts.has(id)) S.drafts.set(id, { text: '', note: '', approve: null }); return S.drafts.get(id); }
const isLater = (t) => Object.prototype.hasOwnProperty.call(S.later, t.task_id);
function laterKey() { return 'desk.later.' + (S.memberId || 'x'); }
// New since you last looked: the ids of asks opened on this computer (ids only, nothing an AI wrote).
function seenKey() { return 'desk.seen.' + (S.memberId || 'x'); }
function loadSeen() { try { S.seen2 = new Set(JSON.parse(sget('local', seenKey()) || '[]')); } catch (e) { S.seen2 = new Set(); } }
function markSeen(id) {
  if (!id || !S.memberId || S.seen2.has(id)) return;
  S.seen2.add(id); const arr = [...S.seen2].slice(-2000); sset('local', seenKey(), JSON.stringify(arr));
}
const isNew = (t) => S.memberId && !t.isCall && !S.seen2.has(t.task_id);
function loadLater() { try { S.later = JSON.parse(sget('local', laterKey()) || '{}') || {}; } catch (e) { S.later = {}; } }
function saveLater() { sset('local', laterKey(), JSON.stringify(S.later)); }

/* ---------- what kind of ask, in the words a person uses ---------- */
function kindOf(t) {
  if (t.isCall) return 'call';
  const s = t.step || {};
  if (s.type === 'question') return (Array.isArray(s.choices) && s.choices.length) ? 'choice' : 'words';
  if (s.type === 'approve') return 'approve';
  if (s.type === 'link') return 'link';
  if (s.type === 'command') return 'command';
  if (s.type === 'call' && contactOf(t, s.contact)) return 'dial';   // History keeps the contact's role, not the number
  return 'other';
}
const KIND_WORD = { choice: 'Pick one', words: 'Answer in words', approve: 'Approve or deny', link: 'Open a link', command: 'Run a command', call: 'A call', dial: 'Make a call', other: 'An ask' };

/* ---------- someone else's contact details (section 27.7: CARD-11 to CARD-14) ----------
   A contact's name, phone and email show only on the open card. Everywhere else (the list, the line across the top, History,
   search) a reference reads as the contact's role, and the Desk keeps no copy of the details once the ask closes. */
const contactsOf = (t) => (Array.isArray(t && t.contacts) ? t.contacts.filter((c) => c && typeof c === 'object' && /^c[1-4]$/.test(c.id || '')) : []);
const contactOf = (t, id) => contactsOf(t).find((c) => c.id === id) || null;
const roleOf = (c) => 'the ' + String(c.role || 'contact');
// settled in the service's own app: the person's list says answered_elsewhere (live, 7:43 PM CT 16 Nov), the asker's view elsewhere
const settledElsewhere = (t) => !!(t && (t.answered_elsewhere || t.elsewhere));
// Off the open card a reference reads as the role; two contacts with the same role are told apart: 'the shopper 1', 'the shopper 2'
function roleWords(t) {
  const cs = contactsOf(t), n = {}, seen = {}, out = {};
  for (const c of cs) n[c.role] = (n[c.role] || 0) + 1;
  for (const c of cs) { seen[c.role] = (seen[c.role] || 0) + 1; out[c.id] = roleOf(c) + (n[c.role] > 1 ? ' ' + seen[c.role] : ''); }
  return out;
}
const capFirst = (w) => w.charAt(0).toUpperCase() + w.slice(1);
// A reference that starts a sentence takes a capital (CARD-12): the start of the text or a line, or after . ! ? or an ellipsis
// and a space; quotes and brackets between are passed over
function startsSentence(text, at) {
  let i = at - 1, gap = false;
  while (i >= 0 && /[\s"'\u201c\u201d\u2018\u2019(\[]/u.test(text[i])) { if (text[i] === '\n') return true; if (/\s/u.test(text[i])) gap = true; i--; }
  return i < 0 || (gap && /[.!?\u2026]/u.test(text[i]));
}
function refs(t, str, open) {   // {c1}: the contact's name on the open card, "the <role>" everywhere else (CARD-12)
  if (typeof str !== 'string' || str.indexOf('{c') < 0 || !contactsOf(t).length) return str;
  const rw = roleWords(t);
  return str.replace(/\{(c[1-4])\}/g, (m, id, at) => { const c = contactOf(t, id); if (!c) return m; const w = open && c.name ? String(c.name) : rw[id]; return startsSentence(str, at) ? capFirst(w) : w; });
}
function forgetDetails(t) {   // what History keeps of a closed ask's contacts: who they were to the person, never their details
  if (!contactsOf(t).length) return t;
  return Object.assign({}, t, { contacts: contactsOf(t).map((c) => ({ id: c.id, role: c.role, consent: c.consent })) });
}
const E164 = /^\+[1-9][0-9]{6,14}$/;
function fmtPhone(p) {
  const v = String(p || ''); const m = /^\+1([0-9]{3})([0-9]{3})([0-9]{4})$/.exec(v);
  return m ? '(' + m[1] + ') ' + m[2] + '-' + m[3] : v;
}
function contactBlock(t, id, open) {   // CARD-13: the details, and under them whose statement the consent is
  const c = contactOf(t, id); if (!c) return null;
  if (!open || !(c.name || c.phone || c.email)) return h('p', { class: 'b-contact gone' }, capFirst(roleWords(t)[c.id]) + '\u2019s details were deleted when the ask closed.');
  const b = brandOf(t), who = b ? b.name : whoName(t), nm = c.name ? String(c.name) : roleOf(c);
  const mail = typeof c.email === 'string' && /^[^\s@<>"]+@[^\s@<>"]+$/.test(c.email) ? c.email : null;
  return h('div', { class: 'b-contact' },
    h('b', { class: 'c-name' }, c.name ? String(c.name) : capFirst(roleOf(c))),
    c.phone ? h('span', { class: 'c-num' }, fmtPhone(c.phone)) : null,
    mail ? h('a', { class: 'c-mail', href: 'mailto:' + mail }, mail) : null,
    h('p', { class: 'consent' }, who + ' says ' + nm + (c.consent === 'they_agreed_to_be_contacted' ? ' agreed to be contacted.' : ' got in touch first.')));
}
const CALL_VERB = { listen: 'listen', watch: 'watch', view: 'look', play: 'play', compare: 'compare', answer: 'answer' };
function quickRank(t) {
  const k = kindOf(t);
  if (k === 'choice') return 1;
  if (k === 'approve') return t.step.editable ? 3 : 2;
  if (k === 'words') return 3;
  if (k === 'link') return 4;
  if (k === 'command') return 5;
  if (k === 'call' || k === 'dial') return 4;
  return 6;
}
// Two choices take the arrows: ← the first, → the second, unless they read as a yes and a no in the other order. Then yes
// keeps → and Y, and no keeps ← and N, as on every other card ("Yes / No" must never put "No" on Y).
const YES_RE = /^(yes|yeah|yep|sure|ok|okay|of course|do it|go ahead|approve|accept|agree|confirm|i can|i will|i'll)\b/i;
const NO_RE = /^(no|nope|not|don'?t|skip|decline|deny|cancel|can'?t|cannot|won'?t|i can'?t|i won'?t)\b/i;
function twoChoices(choices) {
  const [a, b] = choices;
  return b !== undefined && YES_RE.test(String(a).trim()) && NO_RE.test(String(b).trim()) ? [b, a] : [a, b];
}
function yesNo(t) {
  const s = t.step || {}, k = kindOf(t);
  if (k === 'call') return t.offer.state === 'offered'
    ? { no: { label: 'Decline', body: { action: 'call_not_now', local: true } }, yes: { label: 'Take this call', call: true } }
    : { no: null, yes: { label: 'Open the call again', call: true } };
  if (k === 'choice') {
    const [no, yes] = s.choices.length > 2 ? s.choices : twoChoices(s.choices);
    return { no: { label: no, body: { action: 'answer', choice: no } }, yes: yes !== undefined ? { label: yes, body: { action: 'answer', choice: yes } } : null };
  }
  if (k === 'approve') return { no: { label: refs(t, s.deny_label || 'Deny', true), body: { action: 'deny' } },
    yes: { label: refs(t, s.approve_label || 'Approve', true), body: { action: 'approve' } } };
  if (k === 'dial') return { no: { label: 'Not now', body: { action: 'not_now' } }, yes: { label: 'Called', body: { action: 'answer' } } };
  if (k === 'words' || k === 'link' || k === 'command') return { no: { label: 'Not now', body: { action: 'not_now' } },
    yes: { label: 'Done', body: { action: 'done' } } };
  return { no: { label: 'Not now', body: { action: 'not_now' } }, yes: null };
}

/* ---------- icons: line drawings for the service's six icon words; a monogram or emoji otherwise ---------- */
const ICONS = {
  home: ['M4 11.5 12 4.5l8 7', 'M6.5 10v9.5h11V10', 'M10 19.5V14h4v5.5'],
  chef: ['M7.5 14c-3.5 0-3.7-5.3 0-5.2.2-3.6 4.8-4.6 6-1.6 2.3-2.6 6.6-.7 5.2 3 2.8.9 1.9 4.2-1.2 3.8', 'M7.5 13.5v6h9v-6', 'M7.5 16.5h9'],
  car: ['M4.5 15.5 6.4 9.6c.2-.6.7-1 1.3-1h8.6c.6 0 1.1.4 1.3 1l1.9 5.9', 'M3.5 15.5h17v3.5h-17z', 'M6.5 19v1.5M17.5 19v1.5', 'M7.5 17.2h.01M16.5 17.2h.01'],
  business: ['M4 8.5h16v11H4z', 'M9 8.5V6h6v2.5', 'M4 13h16'],
  lab: ['M10 4v6.2L5 19.5h14L14 10.2V4', 'M8.8 4h6.4', 'M7.3 15.3h9.4'],
  other: ['M12 5a7 7 0 1 0 0 14 7 7 0 1 0 0-14z', 'M12 11.2a.8.8 0 1 0 0 1.6.8.8 0 1 0 0-1.6z'],
};
function svgIcon(name) {
  const NS = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.6'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name]) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
}
// An AI's own picture, which the server copied into its own storage (icon_url, section 26.8): fetched from the server with the
// credential, shown from memory. Any other address is never loaded.
const iconImgs = new Map();
function iconPicture(url) {
  if (!url || typeof url !== 'string' || url.indexOf(API + '/') !== 0) return null;
  const e = iconImgs.get(url);
  if (e) return e.src || null;
  iconImgs.set(url, { loading: true });
  apiBlob(url.slice(API.length)).then((b) => {
    if (!/^image\//.test(b.type || '')) throw { status: 415 };
    iconImgs.set(url, { src: URL.createObjectURL(b) }); S.cardSig = ''; render(); if (S.view === 'ais') renderAIs();
  }).catch(() => iconImgs.set(url, { failed: true }));
  return null;
}
function iconFor(icon, name, big, iconUrl) {
  const cls = 'ic' + (big ? ' big' : '');
  const pic = iconPicture(iconUrl);
  if (pic) return h('span', { class: cls + ' pic', 'aria-hidden': 'true' }, h('img', { src: pic, alt: '' }));
  if (icon && ICONS[icon]) return h('span', { class: cls, 'aria-hidden': 'true' }, svgIcon(icon));
  if (icon && !/^https?:/i.test(icon) && [...icon].length <= 3) return h('span', { class: cls + ' emoji', 'aria-hidden': 'true' }, icon);
  const letter = (String(name || '?').trim().match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
  return h('span', { class: cls, 'aria-hidden': 'true' }, letter);
}
const taskIcon = (t, big) => iconFor(t.connection && t.connection.icon, whoName(t), big, t.connection && t.connection.icon_url);

/* ---------- order: Fair, By AI, Quickest, Oldest, Newest ---------- */
function fair(list) {
  // Urgent first; inside each urgency the AIs take turns, the AI waiting longest first; oldest first within each AI.
  const out = [];
  for (const tier of [0, 1, 2]) {
    const groups = new Map();
    list.filter((t) => urg(t) === tier).sort((a, b) => tms(a) - tms(b)).forEach((t) => {
      const k = whoKey(t); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t);
    });
    const queues = [...groups.values()];
    for (let i = 0, more = true; more; i++) { more = false; for (const q of queues) if (q[i]) { out.push(q[i]); more = true; } }
  }
  return out;
}
function byAI(list) {
  const groups = new Map();
  list.slice().sort((a, b) => urg(a) - urg(b) || tms(a) - tms(b)).forEach((t) => {
    const k = whoKey(t); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t);
  });
  return [...groups.values()]; // already in order of each AI's most urgent, then oldest, ask
}
function callItems() {
  return S.offers.filter((o) => o && o.seat_id && (o.state === 'offered' || o.state === 'taken')).map((o) => {
    const id = 'call:' + o.seat_id;
    if (!S.seen[id]) S.seen[id] = new Date().toISOString();
    const nm = String((o.asker && o.asker.name) || 'An AI');
    const cut = nm.indexOf(' (');
    return { task_id: id, isCall: true, offer: o, title: o.ask || 'A call', urgency: 'today', created_at: S.seen[id],
      from: cut > 0 ? nm.slice(0, cut) : nm, basis: cut > 0 ? nm.slice(cut + 2).replace(/\)$/, '') : '', notes: [], step: {} };
  });
}
function visibleOpen() {
  const now = Date.now();
  return S.open.concat(callItems()).filter((t) => (!S.pending.has(t.task_id) || S.pending.get(t.task_id).body.action === 'note') && !S.closed.has(t.task_id)
    && !(t.expires_at && ms(t.expires_at) && ms(t.expires_at) <= now && !S.pending.has(t.task_id)));
}
function markClosed(id) { S.closed.set(id, Date.now()); }
function ordered() {
  let list = visibleOpen();
  if (S.filter) list = list.filter((t) => whoKey(t) === S.filter);
  const later = list.filter(isLater).sort((a, b) => (S.later[a.task_id] || 0) - (S.later[b.task_id] || 0));
  const rest = list.filter((t) => !isLater(t));
  let groups;
  switch (S.sort) {
    case 'ai': groups = byAI(rest).map((g) => ({ head: whoName(g[0]), items: g })); break;
    case 'quick': groups = [{ items: rest.slice().sort((a, b) => quickRank(a) - quickRank(b) || urg(a) - urg(b) || tms(a) - tms(b)) }]; break;
    case 'oldest': groups = [{ items: rest.slice().sort((a, b) => tms(a) - tms(b)) }]; break;
    case 'newest': groups = [{ items: rest.slice().sort((a, b) => tms(b) - tms(a)) }]; break;
    default: groups = [{ items: fair(rest) }];
  }
  if (later.length) groups.push({ head: 'Later', later: true, items: later });
  return groups;
}
const flatOrder = () => ordered().flatMap((g) => g.items);

/* ---------- sign-in ---------- */
function parseLink(s) {
  const m = String(s || '').trim().match(/(?:^|\/m\/|^\s*)(mt_[A-Za-z0-9_-]{8,200})/);
  return m ? m[1] : null;
}
function endedWords() {
  if (/^ps_/.test(S.cred || '')) return 'Your passkey sign-in has ended. Sign in again.';
  if (/^ds_/.test(S.cred || '')) return 'This computer was signed out (from your phone, or after 30 days unused). Scan a new code to sign in again.';
  return 'This page link stopped working (you may have left the panel, or the link was changed). Paste your current link.';
}
function scrubAddress() {
  // A credential never lives in the address bar. If one arrived there, remove it without using it.
  if (/mt_[A-Za-z0-9_-]{6,}/.test(location.href)) history.replaceState(null, '', location.pathname);
}
async function trySignIn(cred, remember) {
  S.cred = cred; S.people = null; S.peopleErr = null; S.isOwner = null; S.ownPage = null;
  if (SEND_ON || PASS_ON) S.peopleEarly = loadPeople(); // in parallel with the asks: the top bar is whole sooner
  const data = await api('GET', '/v1/member/tasks');
  S.remember = !!remember;
  const keep = remember ? 'local' : 'session', drop = remember ? 'session' : 'local';
  sset(keep, 'desk.cred', cred); sdel(drop, 'desk.cred');
  if (S.member) { sset(keep, 'desk.member', S.member); sdel(drop, 'desk.member'); } else { sdel('local', 'desk.member'); sdel('session', 'desk.member'); }
  return data;
}
function showSignIn(msg) {
  $('#booting').hidden = true; $('#desk').hidden = true; $('#signin').hidden = false;
  $('#signin-pick').hidden = true;
  const err = $('#signin-error');
  if (msg) { err.textContent = msg; err.hidden = false; } else { err.hidden = true; }
  setTimeout(() => { if ($('#qr-box').hidden) $('#signin-link').focus(); }, 0);
  if (QR_ON && !QRS.poll) qrNew();
}
function signOut(msg) {
  inflight.abort(); inflight = new AbortController();
  for (const p of S.pending.values()) clearTimeout(p.timer);
  for (const m of S.media.values()) if (m.url) URL.revokeObjectURL(m.url);
  for (const e of iconImgs.values()) if (e.src) URL.revokeObjectURL(e.src); iconImgs.clear();
  clearTimeout(S.pollTimer);
  if (/^ps_/.test(S.cred || '')) fetch(API + '/v1/account/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + S.cred }, credentials: 'omit', keepalive: true }).catch(() => {});
  if (/^ds_/.test(S.cred || '')) fetch(API + '/v1/desk/sign_out', { method: 'POST', headers: { 'Authorization': 'Bearer ' + S.cred }, credentials: 'omit', keepalive: true }).catch(() => {});
  sdel('local', 'desk.cred'); sdel('session', 'desk.cred'); sdel('local', 'desk.member'); sdel('session', 'desk.member');
  sdel('local', 'desk.member_label'); sdel('session', 'desk.member_label'); sdel('local', 'desk.owner'); sdel('session', 'desk.owner');
  sdel('local', 'desk.mems'); sdel('session', 'desk.mems'); S.mems = []; applyPagesSwitch();
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('desk.later.') || k.startsWith('desk.seen.') || k.startsWith('desk.sentseen.')) localStorage.removeItem(k); } catch (e) { /* blocked */ }
  if (S.pendingSend) { clearTimeout(S.pendingSend.timer); S.pendingSend = null; }
  Object.assign(S, { cred: null, member: null, memberLabel: null, memberId: null, account: undefined, passkeyMsg: null, historyDeep: null, historyNote: null, leaving: null, isOwner: null, ownPage: null, peopleEarly: null, noticeAckAt: 0, lookAgain: false, firstLook: false, firstSlow: false, peopleP: null, onPending: undefined, onBusy: false, onChangedAt: 0,
    people: null, sent: null, ssel: null, sentSeen: new Set(), compose: null, ring: null, notice: null, answersToRead: [], limits: null, invite: null, open: [], history: [], conns: null, blocks: null, mutes: null, offers: [], settings: null, sel: null, hsel: null,
    filter: null, later: {}, seen2: new Set(), blockedCalls: new Set(), lastOk: 0, lastErr: null, shownOnce: null, cardSig: '' });
  S.pending.clear(); S.sentLocal.clear(); S.drafts.clear(); S.failed.clear(); S.media.clear(); S.closed.clear();
  $('#undo').hidden = true; $('#signin-link').value = ''; document.title = 'Desk · person.tools'; setFavicon(0, false);
  for (const el of $$('.send-only')) el.hidden = true; document.documentElement.classList.remove('send-on'); // the next person may own no panel
  showSignIn(msg);
}
$('#signin-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const input = $('#signin-link'), btn = ev.submitter || $('#signin-form button');
  const cred = parseLink(input.value);
  if (!cred) { showSignIn('That isn\'t a person.tools page link. It looks like run.person.tools/m/ followed by a long code.'); return; }
  btn.disabled = true; btn.textContent = 'Opening…';
  try {
    const data = await trySignIn(cred, $('#signin-remember').checked);
    input.value = '';
    start(data);
  } catch (e) {
    S.cred = null;
    showSignIn(e.status === 404 || e.status === 401 || e.status === 403
      ? 'That link doesn\'t open a page any more. It may be from a panel you left. Paste the link from your newest invitation.'
      : e.message);
  } finally { btn.disabled = false; btn.textContent = 'Open my Desk'; }
});

/* ---------- passkey sign-in: the account's session acts for one of its memberships ---------- */
const b64u = {
  enc(buf) { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec(str) { let s = String(str).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; },
};
async function plain(method, path, body, session) {
  const headers = { 'Content-Type': 'application/json' }; if (session) headers.Authorization = 'Bearer ' + session;
  let r; try { r = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }); }
  catch (e) { throw { status: 0, message: 'The Desk could not reach person.tools.' }; }
  let d = null; try { d = await r.json(); } catch (e) { d = null; }
  if (!r.ok) throw { status: r.status, message: (d && d.message) || ('person.tools answered ' + r.status + '.') };
  return d || {};
}
function membershipsOf(acct) {
  // GET /v1/account lists memberships, each with member_id; take them wherever the list sits.
  const out = [];
  (function walk(o) { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) { o.forEach(walk); return; }
    if (typeof o.member_id === 'string' && /^mb_/.test(o.member_id)) { out.push(o); return; } Object.values(o).forEach(walk); })(acct);
  const seen = new Set(); return out.filter((m) => !seen.has(m.member_id) && seen.add(m.member_id));
}
function memberLabel(m) {
  // GET /v1/account: memberships[] of {member_id, panel, asked_by, name_on_panel, on, joined_at}
  const p = m.panel && typeof m.panel === 'object' ? m.panel.name : m.panel;
  const who = m.asked_by || m.asker || '';
  return [p || '', who ? 'asked by ' + who : ''].filter(Boolean).join(' · ') || m.member_id;
}
function memberLabels(mems) {
  // One person's pages may share a panel and a name (P22): then when each joined tells them apart, never the name alone.
  const base = mems.map(memberLabel);
  return mems.map((m, i) => {
    if (base.filter((b) => b === base[i]).length < 2) return base[i];
    const j = ms(m.joined_at);
    return base[i] + (j ? ' · joined ' + fmtDay.format(j) + ', ' + fmtClock.format(j) : ' · ' + m.member_id.slice(-4));
  });
}
async function countOpen(session, memberId) {
  const r = await fetch(API + '/v1/member/tasks?history=0', { headers: { 'Authorization': 'Bearer ' + session, 'X-Person-Member': memberId },
    cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!r.ok) throw { status: r.status };
  const d = await r.json(); return Array.isArray(d && d.open) ? d.open.length : 0;
}
async function passkeySignIn(btn) {
  const remember = $('#signin-remember').checked, status = $('#passkey-status'), cancel = $('#passkey-cancel');
  const say = (t, bad) => { status.textContent = t; status.classList.toggle('error', !!bad); };
  if (!window.PublicKeyCredential) { say('This browser cannot use passkeys. Use your page link above.', true); return; }
  btn.disabled = true; cancel.hidden = false; $('#signin-pick').hidden = true;
  say('Your browser is asking for your passkey. Look for its window (Touch ID, your phone, or a security key).');
  const ctl = new AbortController(); S.passkeyAbort = ctl;
  const limit = setTimeout(() => ctl.abort(), 60000);
  try {
    const o = await plain('POST', '/v1/account/login/options', {});
    const pk = Object.assign({}, o.publicKey, { timeout: 60000 }); pk.challenge = b64u.dec(pk.challenge);
    if (Array.isArray(pk.allowCredentials)) pk.allowCredentials = pk.allowCredentials.map((c) => Object.assign({}, c, { id: b64u.dec(c.id) }));
    const c = await navigator.credentials.get({ publicKey: pk, signal: ctl.signal });
    say('Checking your passkey…');
    const out = await plain('POST', '/v1/account/login', { challenge_id: o.challenge_id, credential: { id: c.id, rawId: b64u.enc(c.rawId), type: c.type,
      response: { clientDataJSON: b64u.enc(c.response.clientDataJSON), authenticatorData: b64u.enc(c.response.authenticatorData),
        signature: b64u.enc(c.response.signature), userHandle: c.response.userHandle ? b64u.enc(c.response.userHandle) : null } } });
    const session = out.session;
    if (!session) throw { message: 'person.tools did not give a session.' };
    const mems = membershipsOf(await plain('GET', '/v1/account', undefined, session));
    if (!mems.length) { say('Your passkey works, but no page is linked to it yet. Sign in once with your page link above.', true); return; }
    const labels = memberLabels(mems);
    const go = async (m) => {
      S.member = m.member_id; S.memberLabel = labels[mems.indexOf(m)];
      S.mems = mems.map((x, i) => ({ id: x.member_id, label: labels[i] })); // for Menu, Switch page
      sset(remember ? 'local' : 'session', 'desk.mems', JSON.stringify(S.mems)); sdel(remember ? 'session' : 'local', 'desk.mems'); sset(remember ? 'local' : 'session', 'desk.member_label', S.memberLabel);
      try { say('Opening your Desk…'); start(await trySignIn(session, remember)); }
      catch (e) { S.cred = null; S.member = null; say('Not signed in: ' + e.message, true); }
    };
    if (mems.length === 1) { await go(mems[0]); return; }
    // Several pages: the person picks one; never chosen by name on their behalf.
    const pick = $('#signin-pick');
    fill(pick, h('p', { class: 'label', id: 'pick-h' }, 'Your passkey opens more than one page. Which one?'),
      ...mems.map((m, i) => h('button', { class: 'btn pick-page', type: 'button', onclick: () => { pick.hidden = true; go(m); } },
        h('span', null, labels[i]), h('span', { class: 'pick-n', 'data-mb': m.member_id }, 'counting open asks…'))));
    pick.setAttribute('role', 'group'); pick.setAttribute('aria-labelledby', 'pick-h'); pick.hidden = false; say('');
    const first = pick.querySelector('button'); if (first) first.focus({ preventScroll: true });
    pick.scrollIntoView({ block: 'nearest' }); // every page in view, not only the first
    for (const m of mems) countOpen(session, m.member_id).then((n) => {
      const el = pick.querySelector('.pick-n[data-mb="' + m.member_id + '"]');
      if (el) el.textContent = n ? n + (n === 1 ? ' ask open' : ' asks open') : 'nothing open';
    }).catch(() => { const el = pick.querySelector('.pick-n[data-mb="' + m.member_id + '"]'); if (el) el.textContent = ''; });
  } catch (e) {
    const n = e && e.name;
    say(n === 'AbortError' || n === 'NotAllowedError'
      ? 'No passkey was used. If you have not added one yet, sign in with your page link above; then, in Settings, choose "Add a passkey" for next time.'
      : e && e.status ? 'Not signed in: ' + e.message
      : 'This browser could not use a passkey here' + (e && e.message ? ' (it said: ' + e.message + ')' : '') + '. Use your page link above.', true);
  } finally { clearTimeout(limit); S.passkeyAbort = null; btn.disabled = false; cancel.hidden = true; }
}
/* Adding a passkey from the Desk: paste the link once, then never again. The passkey lives in the person's own device or
   password manager; person.tools keeps only its public half. */
async function addPasskey(btn) {
  btn.disabled = true; S.passkeyMsg = { text: 'Asking your device…' }; renderSettings();
  try {
    const o = await plain('POST', '/v1/account/passkey/options', {}, S.cred);
    const pk = Object.assign({}, o.publicKey);
    pk.challenge = b64u.dec(pk.challenge);
    pk.user = Object.assign({}, pk.user, { id: b64u.dec(pk.user.id) });
    if (Array.isArray(pk.excludeCredentials)) pk.excludeCredentials = pk.excludeCredentials.map((c) => Object.assign({}, c, { id: b64u.dec(c.id) }));
    const c = await navigator.credentials.create({ publicKey: pk });
    await plain('POST', '/v1/account/passkey', { challenge_id: o.challenge_id, credential: { id: c.id, rawId: b64u.enc(c.rawId), type: c.type,
      response: { clientDataJSON: b64u.enc(c.response.clientDataJSON), attestationObject: b64u.enc(c.response.attestationObject),
        transports: c.response.getTransports ? c.response.getTransports() : [] } } }, S.cred);
    S.passkeyMsg = { text: 'Your passkey is added. Next time, choose "Sign in with a passkey": no link needed.', done: true };
  } catch (e) {
    S.passkeyMsg = { bad: true, text: e && e.name === 'NotAllowedError' ? 'No passkey was made.' : e && e.name === 'InvalidStateError' ? 'This device already holds a passkey for your account.' : 'Not added: ' + ((e && e.message) || e) };
  }
  renderSettings();
}
function passkeyRow() {
  // Offered without asking the account first: a person with no account yet gets a 404 there, and the browser logs it.
  // If the account already holds a passkey, the service says so when the Desk asks to add one, and that line is shown.
  if (!PASSKEY_ON || !window.PublicKeyCredential) return null;
  const viaPasskey = /^ps_/.test(S.cred || '');
  const body = [];
  if (S.passkeyMsg) body.push(h('p', { class: (S.passkeyMsg.bad ? 'error' : 'saved') + ' block', role: 'status' }, S.passkeyMsg.text));
  if (!(S.passkeyMsg && S.passkeyMsg.done)) body.push(h('button', { class: 'btn', type: 'button', onclick: (ev) => addPasskey(ev.currentTarget) }, viaPasskey ? 'Add a passkey on this computer' : 'Add a passkey'),
    h('p', { class: 'help' }, 'Then you sign in here with Touch ID, Windows Hello or your phone nearby, without the link. The passkey stays on your devices or in your password manager; person.tools keeps only its public half.'));
  return h('div', { class: 'set' }, h('div', { class: 'k' }, 'Passkey', h('p', { class: 'help' }, 'Sign in without the link.')), h('div', null, body));
}

/* ---------- the sign-in's order: the QR first when it works, then a passkey, then the page link ---------- */
const HAS_PASSKEY = PASSKEY_ON && !!window.PublicKeyCredential;
function layoutSignIn(qrShown) {
  // The page link leads (the QR above it once it works); a passkey is a plain way below, for accounts that have one.
  $('#qr-box').hidden = !qrShown; $('#qr-or').hidden = !qrShown;
  $('#passkey-way').hidden = !HAS_PASSKEY;
  $('#signin-form button[type=submit]').classList.toggle('btn-you', !qrShown);
  // When the code appears it leads: an empty link field that took the focus while the code loaded gives it up
  const f = $('#signin-link'); if (qrShown && document.activeElement === f && !f.value) f.blur();
}
if (HAS_PASSKEY) {
  $('#signin-passkey').addEventListener('click', (ev) => passkeySignIn(ev.currentTarget));
  $('#passkey-cancel').addEventListener('click', () => { if (S.passkeyAbort) S.passkeyAbort.abort(); });
}
layoutSignIn(false);

const QRS = { poll: null, until: 0, timer: null, tick: null, shown: false, fails: 0 };
function drawQR(text) {
  const q = window.qrcode(0, 'M'); q.addData(String(text)); q.make();
  const n = q.getModuleCount(), m = 4, size = n + 2 * m, NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size); svg.setAttribute('shape-rendering', 'crispEdges'); svg.setAttribute('aria-hidden', 'true');
  const bg = document.createElementNS(NS, 'rect'); bg.setAttribute('width', size); bg.setAttribute('height', size); bg.setAttribute('fill', '#ffffff'); svg.append(bg);
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += 'M' + (c + m) + ' ' + (r + m) + 'h1v1h-1z';
  const path = document.createElementNS(NS, 'path'); path.setAttribute('d', d); path.setAttribute('fill', '#1d1d1b'); svg.append(path);
  fill($('#qr-code'), svg);
}
const qrText = (r) => r.qr || r.url || r.code; // SERVICE names what the phone scans; the Desk draws exactly that
// TRUST (3:50 PM CT): the Desk shows a two-digit number; the phone offers three and the person picks the one on this screen.
const qrNumber = (r) => { const v = r.number ?? r.match ?? r.pick ?? r.digits ?? r.check; return v === undefined || v === null ? null : String(v); };
function qrStop() { clearTimeout(QRS.timer); clearInterval(QRS.tick); QRS.poll = null; }
function qrTick() {
  const left = Math.max(0, Math.ceil((QRS.until - Date.now()) / 1000));
  $('#qr-timer').textContent = left ? 'The code and the number change in ' + left + ' s.' : 'Making a new code…';
}
async function qrNew() {
  if (!QR_ON || $('#signin').hidden) return;
  clearTimeout(QRS.timer);
  try {
    const r = await plain('POST', '/v1/desk/sign_in', {});
    if (!r.poll || !qrText(r)) throw { message: 'no code' };
    QRS.poll = r.poll; QRS.until = Date.now() + (Number(r.expires_in) || 60) * 1000; QRS.fails = 0;
    drawQR(qrText(r)); $('#qr-status').textContent = '';
    const num = qrNumber(r);
    $('#qr-digits').textContent = num || ''; $('#qr-number').hidden = !num; $('#qr-pick-step').hidden = !num;
    if (!QRS.shown) { QRS.shown = true; layoutSignIn(true); }
    clearInterval(QRS.tick); qrTick(); QRS.tick = setInterval(qrTick, 1000);
    QRS.timer = setTimeout(qrPoll, 1500);
  } catch (e) {
    QRS.fails++;
    if (!QRS.shown) { layoutSignIn(false); if (QRS.fails < 3) QRS.timer = setTimeout(qrNew, 15000); return; } // show only what works
    $('#qr-status').textContent = 'A new code could not be made just now; trying again.';
    QRS.timer = setTimeout(qrNew, 10000);
  }
}
async function qrPoll() {
  if ($('#signin').hidden || !QRS.poll) return;
  if (Date.now() >= QRS.until) { qrNew(); return; }
  if (document.hidden) { QRS.timer = setTimeout(qrPoll, 3000); return; }
  let r;
  try { r = await fetch(API + '/v1/desk/sign_in/' + enc(QRS.poll), { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }); }
  catch (e) { QRS.timer = setTimeout(qrPoll, 4000); return; }
  if (r.status === 202) { QRS.timer = setTimeout(qrPoll, 2000); return; }
  if (r.status === 429) { QRS.timer = setTimeout(qrPoll, 6000); return; }
  if (r.ok) {
    let d = {}; try { d = await r.json(); } catch (e) { d = {}; }
    if (d.session) {
      qrStop(); $('#qr-status').textContent = 'Confirmed on your phone. Opening your Desk…';
      S.member = null; S.memberLabel = null;
      try { start(await trySignIn(d.session, $('#signin-remember').checked)); }
      catch (e) { S.cred = null; showSignIn(e.message); }
      return;
    }
    QRS.timer = setTimeout(qrPoll, 2000); return;
  }
  // the code ended: used, run out, or stopped because a wrong number was picked on a phone. A fresh one, and say so.
  qrNew().then(() => { if (QRS.poll) $('#qr-status').textContent = 'The last code was stopped or ran out; this is a new one. Pick the number shown here.'; });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && QR_ON && !$('#signin').hidden && Date.now() >= QRS.until) qrNew(); });

/* ---------- loading and looking again ---------- */
function absorb(data) {
  noteOwnPage(data && data.own_page);
  // A withdrawn ask may stay in 'open' for a day (ASKS-4): never counted, alerted or answered here (CARD-17), so it leaves the
  // list; one settled in the service's own app leaves without a word, any other says who took it back and why
  const listed = Array.isArray(data && data.open) ? data.open : [];
  const open = listed.filter((t) => !t.state || t.state === 'open');
  const taken = new Map(listed.filter((t) => t.state === 'withdrawn').map((t) => [t.task_id, t]));
  const prevSel = S.sel;
  S.open = open;
  S.history = Array.isArray(data && data.history) ? data.history : [];
  // router_18: accept once before a person's asks show; a look that left before the OK must not bring it back
  S.notice = (data && data.notice && !(S.noticeAckAt && Date.now() - S.noticeAckAt < 60000)) ? data.notice : null;
  S.answersToRead = Array.isArray(data && data.answers_to_read) ? data.answers_to_read : [];
  for (const id of S.sentLocal.keys()) if (S.history.some((t) => t.task_id === id)) S.sentLocal.delete(id);
  for (const [id, at] of S.closed) if (Date.now() - at > 60000) S.closed.delete(id);
  // Later and drafts only for asks still open
  const ids = new Set(open.map((t) => t.task_id).concat(callItems().map((t) => t.task_id)));
  let changed = false;
  for (const id of Object.keys(S.later)) if (!ids.has(id) && !S.pending.has(id)) { delete S.later[id]; changed = true; }
  if (changed) saveLater();
  if (prevSel && !ids.has(prevSel) && !S.pending.has(prevSel) && !S.failed.has(prevSel) && !S.closed.has(prevSel)) {
    const order = lastOrder; const i = order.indexOf(prevSel);
    const w = taken.get(prevSel);
    S.gone = w ? (settledElsewhere(w) ? null : whoName(w) + ' took this ask back' + (w.withdraw_why ? ': ' + String(w.withdraw_why) : '') + '.')
      : 'That ask left your list: its AI withdrew it, or you answered it on another device.';
    S.sel = null;
    const next = flatOrder();
    if (next.length) S.sel = (order.slice(i + 1).find((id) => next.some((t) => t.task_id === id))) || next[0].task_id;
  }
  S.lastOk = Date.now(); S.lastErr = null; S.firstLook = false;
}
let lastOrder = [];
async function refresh(quiet) {
  if (!S.cred || S.loading) return;
  S.loading = true;
  try {
    if (SEND_ON && S.isOwner !== false) loadSent(); // beside the asks, not after them; a person who owns no panel has sent nothing
    const lookedAt = Date.now();
    const [data, offers] = await Promise.all([api('GET', '/v1/member/tasks'), api('GET', '/v1/member/offers').catch(() => null)]);
    if (offers && Array.isArray(offers.offers)) S.offers = offers.offers.filter((o) => !S.blockedCalls.has(o.call_id)); // a call whose caller was blocked here stays gone
    if (offers) noteRing(offers, lookedAt);
    absorb(data);
    for (const c of callItems()) if (!S.seats.has(c.offer.seat_id)) loadSeat(c); // the ring card is whole before it is opened
    if ((SEND_ON || PASS_ON) && S.isOwner === null) loadPeople(); // not known yet (the first look failed): look again
    S.pollDelay = POLL_MS;
    if (!S.memberId && !S.settings) loadSettings();
  } catch (e) {
    if (e.status === 401 || e.status === 403 || e.status === 404) { S.loading = false; signOut(endedWords()); return; }
    S.lastErr = e.message; S.pollDelay = Math.min(S.pollDelay * 2, 120000);
  } finally { S.loading = false; }
  render();
  schedule();
  if (S.lookAgain) { S.lookAgain = false; setTimeout(() => refresh(true), 0); } // something changed while this look was out
  if (S.view === 'ais' && !quiet) loadConns();
}
function schedule() {
  clearTimeout(S.pollTimer);
  if (!S.cred || document.hidden) return;
  S.pollTimer = setTimeout(() => refresh(true), S.pollDelay);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(true); else clearTimeout(S.pollTimer); });
async function loadSettings() {
  try {
    const s = await api('GET', '/v1/member/settings');
    S.settings = s; noteOwnPage(s && s.own_page); if (s && s.member_id && s.member_id !== S.memberId) { S.memberId = s.member_id; loadLater(); loadSeen(); loadSentSeen(); S.cardSig = ''; render(); }
    if (S.view === 'settings') renderSettings();
  } catch (e) { /* the Desk works without it */ }
}
async function loadBlocks() {
  if (S.blocksLoading) return; S.blocksLoading = true;
  try { const b = await api('GET', '/v1/member/blocks'); S.blocks = Array.isArray(b && b.blocks) ? b.blocks : []; }
  catch (e) { S.blocks = []; } // an operator without blocks answers 404: no list
  S.blocksLoading = false;
  if (S.view === 'ais') renderAIs();
}
async function unblock(b) {
  try { await api('DELETE', '/v1/member/blocks/' + enc(b.block_id)); S.aiMsg = { text: b.name + ' can reach you again.' }; }
  catch (e) { S.aiMsg = { bad: true, text: e.message }; }
  loadBlocks();
}
// Muted people (8.1.1 P25): their asks still show and never ring; Unmute undoes it
async function loadMutes() {
  if (S.mutesLoading) return; S.mutesLoading = true;
  try { const m = await api('GET', '/v1/member/mutes'); S.mutes = Array.isArray(m && m.mutes) ? m.mutes : []; }
  catch (e) { S.mutes = []; } // an operator without asks between people answers 404: no list
  S.mutesLoading = false;
  if (S.view === 'ais') renderAIs();
}
async function unmute(m) {
  try { await api('DELETE', '/v1/member/mutes/' + enc(m.mute_id)); S.aiMsg = { text: (m.name || 'They') + ' is unmuted: their asks can ring you again.' }; }
  catch (e) { S.aiMsg = { bad: true, text: e.message }; }
  loadMutes();
}
async function loadConns() {
  try { const c = await api('GET', '/v1/member/connections'); S.conns = Array.isArray(c && c.connections) ? c.connections : []; S.connLimit = c && c.limit; }
  catch (e) { S.connsErr = e.message; if (S.conns === null) S.conns = []; }
  if (S.view === 'ais') renderAIs();
  if (!visibleOpen().length && S.view === 'asks') renderCard();
}

/* ---------- answering: nothing leaves this computer for five seconds ---------- */
function labelFor(t, body) {
  if (body.action === 'pass') return 'Pass on to ' + (nameOfMember(body.to) || 'one of your people') + (body.note ? ', with your line' : '');
  if (body.action === 'call_not_now') return 'Decline this call';
  if (body.action === 'note') return 'Note: ' + body.note;
  if (body.action === 'answer' && t.step && t.step.type === 'call') return 'Called';
  // the undo bar is not the open card: a choice that is a contact reads as their role (CARD-12)
  if (body.action === 'answer') return body.choice != null ? refs(t, body.choice, false) + (body.text ? ': “' + body.text + '”' : '') : '“' + (body.text || '') + '”';
  if (body.action === 'done') return 'Done';
  if (body.action === 'not_now') return 'Not now';
  if (body.action === 'approve') return refs(t, t.step.approve_label || 'Approve', false) + (body.text ? ' (your edited words)' : '');
  if (body.action === 'deny') return refs(t, t.step.deny_label || 'Deny', false);
  return body.action;
}
function answer(t, body) {
  if (!t || S.pending.has(t.task_id)) return;
  const d = draft(t.task_id);
  body = Object.assign({}, body);
  if (body.action !== 'note' && !body.local && d.note.trim()) body.note = d.note.trim();
  if (body.action === 'approve' && t.step.editable && d.approve !== null && d.approve !== t.step.text) {
    if (!d.approve.trim()) { flashCard('The words you approve can\'t be empty. Put back the AI\'s words, or write your own.'); return; }
    body.text = d.approve;
  }
  S.failed.delete(t.task_id); S.gone = null;
  if (body.action === 'note') d.note = '';
  const order = flatOrder().map((x) => x.task_id);
  const p = { task: t, body, label: labelFor(t, body), until: Date.now() + UNDO_MS };
  p.timer = setTimeout(() => flush(t.task_id), UNDO_MS);
  S.pending.set(t.task_id, p);
  if (body.action !== 'note') {
    // The press shows where the eye is: the chosen button turns gold with a line under it; then the next ask comes up.
    const i = order.indexOf(t.task_id);
    const rest = order.filter((id) => id !== t.task_id && !S.pending.has(id));
    const next = order.slice(i + 1).find((id) => rest.includes(id)) || rest[rest.length - 1] || null;
    clearTimeout(S.advanceTimer);
    S.advanceTimer = setTimeout(() => { if (S.sel === t.task_id && S.pending.has(t.task_id)) { S.sel = next; render(); } }, 550);
  }
  render();
  showUndo();
  sr((body.action === 'note' ? 'Your note goes to ' : 'Your answer goes to ') + whoName(t) + ' in 5 seconds. Press Z to undo.');
}
async function flush(id, keepalive) {
  const p = S.pending.get(id); if (!p) return;
  clearTimeout(p.timer); S.pending.delete(id);
  const t = p.task;
  if (p.body.local) {
    // Not now on a call: the seat's own route declines it (free, no mark, not offered again). The seat token is the
    // only key it needs, so the member credential is not sent.
    try {
      const r = await fetch(API + '/v1/seats/' + enc(t.offer.seat_token) + '/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'decline' }), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: !!keepalive });
      if (!r.ok && r.status !== 404 && r.status !== 409 && r.status !== 410) { let m = ''; try { m = (await r.json()).message; } catch (e) { /* none */ } throw { message: m || ('person.tools answered ' + r.status + '.') }; }
      S.offers = S.offers.filter((o) => 'call:' + o.seat_id !== id);
      showSent(p, 'Declined. Nothing is held against you, and this call will not be offered again.');
    } catch (e) {
      showSent(p, 'Not declined: ' + (e.message || 'the call could not be reached') + ' It lapses on its own ' + (t.offer && t.offer.held_until ? 'at ' + fmtClock.format(ms(t.offer.held_until)) : 'soon') + '.', true);
    }
    render(); return;
  }
  try {
    const res = p.body.action === 'pass'
      ? await api('POST', '/v1/member/tasks/' + enc(id) + '/pass', { to: p.body.to, ...(p.body.note ? { note: p.body.note } : {}) }, { keepalive })
      : await api('POST', '/v1/member/tasks/' + enc(id), p.body, { keepalive });
    if (p.body.action === 'pass' && res && res.passed_to) p.passedTo = res.passed_to;
    if (p.body.action === 'note') {
      const live = S.open.find((x) => x.task_id === id);
      if (live) live.notes = Array.isArray(res && res.notes) ? res.notes : (live.notes || []).concat([{ at: new Date().toISOString(), note: p.body.note, by: 'person' }]);
      draft(id).note = '';
    } else {
      S.open = S.open.filter((x) => x.task_id !== id); markClosed(id);
      const reply = Object.assign({ at: new Date().toISOString(), choice: null, text: null, note: null }, p.body,
        p.body.action === 'approve' ? { approved_text: p.body.text || t.step.text } : {});
      S.sentLocal.set(id, Object.assign({}, forgetDetails(t), { state: p.body.action === 'pass' ? 'passed' : (res && res.state) || 'answered', reply,
        passed_to: p.body.action === 'pass' ? (p.passedTo || { member_id: p.body.to, name: nameOfMember(p.body.to) }) : undefined }));
      if (p.body.action === 'pass' && SEND_ON) setTimeout(loadSent, 1500);
      S.drafts.delete(id);
      if (S.later[id]) { delete S.later[id]; saveLater(); }
    }
    showSent(p);
  } catch (e) {
    if (p.body.local) return;
    if (e.status === 409) {
      S.open = S.open.filter((x) => x.task_id !== id); S.drafts.delete(id); markClosed(id);
      showSent(p, 'Already answered on another device. Nothing changed.');
    } else if (e.status === 404 || e.status === 410) {
      S.open = S.open.filter((x) => x.task_id !== id); markClosed(id);
      showSent(p, 'Not sent: this ask is gone (its AI withdrew it, or was revoked).', true);
    } else {
      S.failed.set(id, { message: e.message, body: p.body });
      if (p.body.action === 'note' && !draft(id).note) draft(id).note = p.body.note;
      if (!S.sel || S.sel === id || !S.open.some((x) => x.task_id === S.sel)) S.sel = id;
      showSent(p, 'Not sent: ' + e.message + ' Your answer is still on the card.', true);
    }
  }
  render();
  setTimeout(() => refresh(true), 1200);
}
function undo() {
  clearTimeout(S.advanceTimer);
  if (S.pendingSend) return undoSend();
  const last = [...S.pending.values()].sort((a, b) => b.until - a.until)[0];
  if (!last) return false;
  clearTimeout(last.timer); S.pending.delete(last.task.task_id);
  if (last.body.action === 'note') draft(last.task.task_id).note = last.body.note;
  else if (last.body.note) draft(last.task.task_id).note = last.body.note;
  if (last.body.action === 'answer' && last.body.text) draft(last.task.task_id).text = last.body.text;
  S.sel = last.task.task_id; if (S.view !== 'asks') setView('asks');
  render(); showUndo();
  sr('Undone. Nothing was sent to ' + whoName(last.task) + '.');
  return true;
}
window.addEventListener('pagehide', () => { for (const id of [...S.pending.keys()]) flush(id, true); });

let undoTick = null, sentTimer = null;
function showUndo() {
  const box = $('#undo');
  clearInterval(undoTick); clearTimeout(sentTimer);
  const ps = [...S.pending.values()].sort((a, b) => b.until - a.until);
  if (!ps.length) { box.hidden = true; return; }
  const p = ps[0];
  box.className = 'undo'; fill(box);
  const secs = h('span', { class: 'u-secs' });
  const bar = h('div', { class: 'u-bar' });
  box.append(h('div', { class: 'u-row' },
    h('span', { class: 'u-what' }, p.body.action === 'note' ? 'Note to ' : 'To ', h('b', null, whoName(p.task)), ': ', p.label,
      ps.length > 1 ? '  ·  ' + (ps.length - 1) + ' more waiting' : ''),
    secs,
    h('button', { class: 'btn', type: 'button', onclick: () => undo() }, 'Undo', kbd('Z'))), bar);
  box.hidden = false;
  const tick = () => {
    const left = Math.max(0, p.until - Date.now());
    secs.textContent = 'sends in ' + Math.ceil(left / 1000) + ' s';
    bar.style.transform = 'scaleX(' + (left / UNDO_MS).toFixed(3) + ')';
    if (left <= 0) clearInterval(undoTick);
  };
  tick(); undoTick = setInterval(tick, 100);
}
function showSent(p, msg, bad) {
  if (S.pending.size) { showUndo(); if (!bad) return; }
  const box = $('#undo');
  clearInterval(undoTick); clearTimeout(sentTimer);
  box.className = 'undo ' + (bad ? 'failed' : 'sent'); fill(box);
  box.append(h('div', { class: 'u-row' }, h('span', { class: 'u-what' }, msg || [p.body.action === 'note' ? 'Note sent to ' : 'Sent to ', h('b', null, whoName(p.task)), ': ', p.label])));
  box.hidden = false;
  sr(typeof msg === 'string' ? msg : 'Sent to ' + whoName(p.task) + '.');
  sentTimer = setTimeout(() => { if (!S.pending.size) box.hidden = true; }, bad ? 6000 : 1800);
}

function takeCall(t) {
  const u = safeUrl(t.offer.seat_url);
  if (!u) { flashCard('This call has no page to open. Take it on your phone.'); return; }
  // With noopener the browser returns null whether or not the tab opened, so the card also keeps a plain link to it
  window.open(u.href, '_blank', 'noopener,noreferrer');
  (S.callOpened || (S.callOpened = {}))[t.task_id] = Date.now();
  S.cardSig = ''; if (S.view === 'asks') renderCard();
  sr('The call opens in a new tab. If no tab opened, the card has a link to it.');
}
async function loadSeat(t) {
  const o = t.offer, id = o.seat_id;
  if (S.seats.has(id)) return;
  S.seats.set(id, { loading: true });
  try { S.seats.set(id, await api('GET', '/v1/seats/' + enc(o.seat_token))); }
  catch (e) { S.seats.set(id, { error: e.message }); }
  S.cardSig = ''; if (S.view === 'asks') renderCard();
}

function blockAsker(t) {
  const name = whoName(t);
  const own = !t.isCall && t.connection && t.connection.yours && t.connection.id;
  confirmBox('Block ' + name + '?', own
    ? name + ' is your own AI. Blocking it stops its asks: it hears only "not available". You can unblock it in Your AIs.'
    : name + ' can no longer reach you: it is only told you are not available. You can unblock it in Your AIs.', 'Block ' + name, async () => {
    try {
      if (own) await api('PATCH', '/v1/member/connections/' + enc(t.connection.id), { blocked: true });
      else await api('POST', '/v1/member/blocks', t.isCall ? { call_id: t.offer.call_id } : { task_id: t.task_id });
      if (t.isCall) { S.blockedCalls.add(t.offer.call_id); S.offers = S.offers.filter((o) => o.call_id !== t.offer.call_id); } // the service may still list it
      showSent({ task: t, body: { action: 'block' }, label: '' }, name + ' is blocked.');
      S.blocks = null; S.conns = null;
    } catch (e) { showSent({ task: t, body: {}, label: '' }, 'Not blocked: ' + e.message, true); }
    refresh(true); loadConns();
  });
}

/* ---------- Later: kept on this computer only; the AI is not told ---------- */
function toggleLater(t) {
  if (!t) return;
  const order = flatOrder().map((x) => x.task_id);
  if (isLater(t)) { delete S.later[t.task_id]; sr('Back in the list.'); }
  else {
    S.later[t.task_id] = Date.now();
    const i = order.indexOf(t.task_id);
    const nxt = order.slice(i + 1).find((id) => !S.later[id]) || order.find((id) => !S.later[id] && id !== t.task_id);
    S.sel = nxt || t.task_id;
    sr('Moved to Later, at the foot of the list. Only this computer knows.');
  }
  saveLater(); render();
}

/* ---------- rendering: the list ---------- */
function selectedTask() { return S.open.find((t) => t.task_id === S.sel) || callItems().find((t) => t.task_id === S.sel) || null; }
function render() {
  if (!S.cred) return;
  const n = visibleOpen().length;
  const c = $('#count-asks'); c.textContent = n; c.classList.toggle('zero', n === 0);
  document.title = (n ? '(' + n + ') ' : '') + 'Desk · person.tools';
  setFavicon(n, visibleOpen().some((t) => urg(t) === 0 && !isLater(t)));
  renderChecked();
  if (S.view === 'asks') { renderChips(); renderList(); renderCard(); }
  renderBanner();
  if (S.view === 'history') { renderHistory(); }
  scheduleLapse();
}
// An ask that closes within the hour shows its time left, kept current, and leaves the list the moment it lapses (CARD-16)
function scheduleLapse() {
  clearTimeout(S.lapseT); const now = Date.now();
  const soon = S.open.map((t) => ms(t.expires_at)).filter((x) => x && x > now && x - now <= 3600e3);
  if (soon.length) S.lapseT = setTimeout(() => { S.cardSig = ''; render(); }, Math.max(250, Math.min(Math.min(...soon) - now + 50, 30000)));
}
/* The tab's icon carries the count, filled in ink when something is urgent: a signal that makes no sound. */
let lastIcon = '';
function setFavicon(n, urgent) {
  const key = n + ':' + urgent; if (key === lastIcon) return; lastIcon = key;
  const ink = '#1d1d1b', paper = '#faf8f3', label = n > 99 ? '99' : String(n);
  const size = label.length > 1 ? 15 : 19;
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect x='2.5' y='2.5' width='27' height='27' fill='" + (urgent ? ink : paper) +
    "' stroke='" + ink + "' stroke-width='3'/>" + (n ? "<text x='16' y='" + (label.length > 1 ? 21.5 : 23) + "' font-family='Arial,Helvetica,sans-serif' font-weight='700' font-size='" + size +
    "' text-anchor='middle' fill='" + (urgent ? paper : ink) + "'>" + label + '</text>' : '') + '</svg>';
  const link = document.getElementById('favicon'); if (link) link.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
}
function renderChecked() {
  const el = $('#checked');
  if (S.lastErr) { el.textContent = 'Not reached · trying again'; el.title = S.lastErr; el.classList.add('bad'); }
  else if (S.lastOk) { fill(el, h('span', { class: 'checked-every' }, 'Looks every 15 s · '), 'last ' + fmtClock.format(S.lastOk)); el.title = 'The list updates by itself while this tab is open.'; el.classList.remove('bad'); }
}
function renderBanner() {
  const b = $('#banner');
  const now = visibleOpen().filter((t) => urg(t) === 0 && !isLater(t) && !t.isCall);
  if (!now.length || S.view !== 'asks') { b.hidden = true; return; }
  const first = fair(now)[0];
  fill(b, h('span', { class: 'label' }, 'Now'),
    h('span', null, now.length === 1 ? (first.isCall ? ['A call for you: ', String(first.offer.minutes || '?'), ' minutes', first.offer.pay && first.offer.pay.unpaid_test ? ', unpaid test' : '', '. ', whoName(first)] : [whoName(first), ': ', refs(first, first.title, false)])
      : [String(now.length), ' need you now. First: ', whoName(first), ': ', refs(first, first.title, false)]),
    ...(S.sel === first.task_id ? [] : [h('button', { class: 'btn', type: 'button', onclick: () => { S.sel = first.task_id; render(); focusCard(); } }, 'Show')]));
  b.hidden = false;
}
function renderChips() {
  const wrap = $('#chips');
  const list = visibleOpen();
  const groups = new Map();
  list.forEach((t) => { const k = whoKey(t); if (!groups.has(k)) groups.set(k, { t, n: 0 }); groups.get(k).n++; });
  if (S.filter && !groups.has(S.filter)) S.filter = null;
  const chip = (key, label, n, t) => h('button', { class: 'chip' + (S.filter === key ? ' on' : ''), type: 'button', 'aria-pressed': S.filter === key ? 'true' : 'false',
    onclick: () => { S.filter = (S.filter === key ? null : key); const f = flatOrder(); if (f.length && !f.some((x) => x.task_id === S.sel)) S.sel = f[0].task_id; render(); } },
  chipMark(t, S.filter === key) || (t ? (t.connection && ICONS[t.connection.icon] ? svgIcon(t.connection.icon) : null) : null), label, h('b', null, String(n)));
  // the chips group asks by who is asking, one of the places a brand's mark may stand (CARD-3); checked on the chip's own ground
  function chipMark(t, on) { const b = t && brandOf(t); const m = b ? brandMark(b, 'needs_you', on ? token('--ink', '#1d1d1b', '#faf8f3') : null) : null; return m ? h('span', { class: 'b-slot' }, m) : null; }
  const kids = [chip(null, 'All', list.length, null)];
  [...groups.entries()].sort((a, b) => b[1].n - a[1].n || whoName(a[1].t).localeCompare(whoName(b[1].t)))
    .forEach(([k, g]) => kids.push(chip(k, whoLabel(g.t), g.n, g.t)));
  fill(wrap, ...(list.length ? kids : []));
  wrap.hidden = !list.length;
  $('#view-asks .list-head').hidden = !list.length;
  $('#sort').value = S.sort;
}
function rowFor(t, opts = {}) {
  const k = kindOf(t);
  const notes = Array.isArray(t.notes) ? t.notes : [];
  const last = notes[notes.length - 1];
  const p = S.pending.get(t.task_id);
  const flags = [];
  if (opts.history) { /* none */ }
  else if (t.isCall) flags.push(h('span', { class: 'flag today' }, t.offer.state === 'offered' ? 'Call' : 'Taken'),
    h('span', { class: 'flag today' }, (t.offer.minutes || '?') + ' min' + (t.offer.pay && t.offer.pay.unpaid_test ? ' · unpaid' : '')));
  else if (isLater(t)) flags.push(h('span', { class: 'flag later' }, 'Later'));
  else if (t.urgency === 'now') flags.push(h('span', { class: 'flag now' }, 'Now'));
  else if (t.urgency === 'today') flags.push(h('span', { class: 'flag today' }, 'Today'));
  if (!opts.history && last && last.by === 'asker') flags.push(h('span', { class: 'flag replied' }, 'Replied'));
  else if (!opts.history && (last && last.by === 'person' || (p && p.body.action === 'note'))) flags.push(h('span', { class: 'flag noted' }, 'Note sent'));
  if (!opts.history && S.failed.has(t.task_id)) flags.push(h('span', { class: 'flag now' }, 'Not sent'));
  const left = !opts.history && !t.isCall && leftWords(t.expires_at);
  if (left) flags.push(h('span', { class: 'flag closing', title: 'Closes at ' + when(t.expires_at) }, left.replace(' left', '').replace(' minutes', ' min').replace(' minute', ' min')));
  const sub = opts.history
    ? [h('span', { class: 'from' }, whoName(t)), h('span', { class: 'kind' }, '· ' + historyAnswer(t))]
    : [...flags, h('span', { class: 'from' + (t.sender ? ' person' : '') }, whoLabel(t)), h('span', { class: 'kind' }, '· ' + KIND_WORD[k])];
  const selected = opts.history ? S.hsel === t.task_id : S.sel === t.task_id;
  const fresh = !opts.history && isNew(t);
  return h('li', { class: 'item' + (selected ? ' sel' : '') + (fresh ? ' new' : ''), role: 'option', id: (opts.history ? 'h-' : 'o-') + t.task_id,
    'aria-selected': selected ? 'true' : 'false', dataset: { id: t.task_id },
    onclick: () => { if (opts.history) { S.hsel = t.task_id; renderHistory(); } else { S.sel = t.task_id; render(); } openReading(); } },
  t.isCall ? iconFor(null, t.from) : taskIcon(t), h('span', { class: 't' }, refs(t, t.title || (t.step && t.step.text), false) || 'An ask'),
  h('span', { class: 'age', title: when(opts.history && t.reply ? t.reply.at : t.created_at) }, fresh ? h('span', { class: 'dot', 'aria-label': 'new', title: 'New since you last looked on this computer' }) : null, age(opts.history && t.reply ? t.reply.at : t.created_at)),
  h('span', { class: 'sub' }, sub));
}
function renderList() {
  const ol = $('#list');
  const groups = ordered();
  const flat = groups.flatMap((g) => g.items);
  lastOrder = flat.map((t) => t.task_id);
  if (S.sel && !lastOrder.includes(S.sel) && !S.pending.has(S.sel) && !S.failed.has(S.sel)) S.sel = null;
  if (!S.sel && flat.length) S.sel = flat[0].task_id;
  const kids = SEND_ON ? sendNewsRows() : [];
  for (const g of groups) {
    if (g.head) kids.push(h('li', { class: 'group-h' + (g.later ? ' later-h' : ''), role: 'presentation' },
      g.later ? null : taskIcon(g.items[0]), g.later ? 'Later · kept on this computer' : g.head, h('span', { class: 'n' }, String(g.items.length))));
    for (const t of g.items) kids.push(rowFor(t));
  }
  if (!flat.length) kids.push(h('li', { class: 'list-empty', role: 'presentation' }, S.firstLook ? (S.lastErr ? 'Not reached yet; trying again.' : 'Loading your asks…')
    : S.filter ? 'Nothing from this AI.' : 'No open asks.'));
  if (SEND_ON && sendNewsRows().length && flat.length) kids.splice(sendNewsRows().length, 0, h('li', { class: 'group-h people-h', role: 'presentation' }, 'Asks for you'));
  fill(ol, ...kids);
  ol.setAttribute('aria-activedescendant', S.sel ? 'o-' + S.sel : '');
  const selEl = S.sel && document.getElementById('o-' + S.sel);
  if (selEl) selEl.scrollIntoView({ block: 'nearest' });
}

/* ---------- rendering: the card ---------- */
function cardSignature(t) {
  if (!t) return 'empty:' + (S.firstLook ? 'L' + (S.lastErr ? 'E' : '') + (S.firstSlow ? 'S' : '') : '') + (S.conns ? S.conns.length : '-') + ':' + S.lastOk + ':' + S.history.length + ':' + JSON.stringify(S.notice || null);
  const p = S.pending.get(t.task_id);
  if (t.isCall) { const st = S.seats.get(t.offer.seat_id); return JSON.stringify([t.task_id, t.offer.state, t.offer.held_until, t.offer.card || null, st ? (st.loading ? 'l' : st.error || 'ok') : '', !!S.pending.get(t.task_id)]); }
  const m = S.media.get(t.task_id);
  return JSON.stringify([JSON.stringify(S.notice || null), t.task_id, t.notes, t.step, t.card, t.title, t.unlocks, t.urgency, !!(p), p && p.body.note, S.failed.get(t.task_id), isLater(t), S.gone, m ? (m.url || m.error || 'loading') : '', leftWords(t.expires_at)]);
}
let seenTimer = null;
function renderCard(force) {
  const pane = $('#card');
  const t = selectedTask();
  clearTimeout(seenTimer);
  if (t && isNew(t) && !document.hidden) seenTimer = setTimeout(() => { markSeen(t.task_id); renderList(); renderChips(); }, 1200);
  const sig = cardSignature(t);
  if (!force && sig === S.cardSig && pane.firstChild) return;
  // keep focus and caret across a redraw
  const ae = document.activeElement;
  const keep = ae && pane.contains(ae) && ae.dataset && ae.dataset.field ? { f: ae.dataset.field, s: ae.selectionStart, e: ae.selectionEnd } : null;
  S.cardSig = sig;
  fill(pane, ...[noticeCard(), t ? cardFor(t) : emptyCard()].filter(Boolean));
  pane.scrollTop = keep ? pane.scrollTop : 0;
  if (keep) { const f = pane.querySelector('[data-field="' + keep.f + '"]'); if (f) { f.focus(); try { f.setSelectionRange(keep.s, keep.e); } catch (e) { /* not a text field */ } } }
}
function flashCard(msg) {
  const pane = $('#card'); let n = pane.querySelector('.flash');
  if (!n) { n = h('p', { class: 'error flash', role: 'alert' }); const a = pane.querySelector('.answers'); (a ? a.parentNode : pane).insertBefore(n, a ? a.nextSibling : null); }
  n.textContent = msg;
}
function whoBlock(t, extra) {
  const yours = t.connection && t.connection.yours;
  if (t.sender && !t.passed_on_by) return h('div', { class: 'who' }, iconFor(null, t.sender.name || whoName(t), true),
    h('div', null, h('div', { class: 'name person' }, t.sender.name || whoName(t)), h('div', { class: 'basis' }, t.sender.behind || 'The person who invited you.')),   // the API's own words (OWNER_router_34 item 2)
    h('div', { class: 'meta' }, extra || h('span', { class: 'label' }, t.urgency === 'now' ? 'Now' : t.urgency === 'today' ? 'Today' : 'Whenever'), h('span', { class: 'when' }, 'Asked ' + when(t.created_at))));
  const pb = t.passed_by || t.passed_on_by; const pbName = pb && (typeof pb === 'string' ? pb : (pb.name || pb.alias));
  if (pbName) return h('div', { class: 'who' }, taskIcon(t, true),
    h('div', null, h('div', { class: 'name' }, whoName(t)), h('div', { class: 'basis' }, 'Passed on to you by ' + pbName + (t.pass_note ? ': “' + t.pass_note + '”' : ''))),
    h('div', { class: 'meta' }, extra || h('span', { class: 'label' }, t.urgency === 'now' ? 'Now' : t.urgency === 'today' ? 'Today' : 'Whenever'), h('span', { class: 'when' }, 'Asked ' + when(t.created_at))));
  return h('div', { class: 'who' }, taskIcon(t, true),
    h('div', null, h('div', { class: 'name' }, whoName(t)),
      h('div', { class: 'basis' }, yours ? 'Your AI · you connected it' : 'Named by the asker; not checked by person.tools')),
    h('div', { class: 'meta' }, extra || h('span', { class: 'label' }, t.urgency === 'now' ? 'Now' : t.urgency === 'today' ? 'Today' : 'Whenever'),
      h('span', { class: 'when' }, 'Asked ' + when(t.created_at)),
      !extra && leftWords(t.expires_at) ? h('span', { class: 'when closing' }, 'Closes at ' + fmtClock.format(ms(t.expires_at)) + ' · ' + leftWords(t.expires_at)) : null));
}
const cardBlocks = (t) => (t.card && Array.isArray(t.card.blocks) ? t.card.blocks : []);
// A card's choices or input block places the answers (27.5); a card without one has them after its last block
const answerSlot = (t) => cardBlocks(t).findIndex((b) => b && typeof b === 'object' && (b.choices !== undefined || (b.input && typeof b.input === 'object')));
// A headline block is the card's first line (27.5): it heads the card, and the title stays the list's line
const headOf = (t, open) => { const b = cardBlocks(t)[0]; return b && typeof b.headline === 'string' && b.headline ? refs(t, b.headline, open) : null; };
function blocksFor(t, from, to, open) {
  const blocks = cardBlocks(t).slice(from || 0, to === undefined || to < 0 ? undefined : to);
  const out = [], r = (x) => refs(t, x, !!open);
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    if (typeof b.headline === 'string') out.push(h('p', { class: 'b-headline' }, r(b.headline)));
    else if (typeof b.text === 'string') out.push(h('p', { class: 'b-text' }, linked(r(b.text))));
    else if (Array.isArray(b.facts)) out.push(h('dl', { class: 'b-facts' }, b.facts.filter((f) => f && f.label !== undefined).map((f) => [h('dt', null, String(f.label)), h('dd', null, r(String(f.value ?? '')))])));
    else if (b.price !== undefined) out.push(h('p', { class: 'b-price' }, typeof b.price === 'object' ? [b.price.amount, ' ', b.price.currency || '', b.price.label ? ' · ' + b.price.label : ''] : String(b.price)));
    else if (b.when_where !== undefined) out.push(h('p', { class: 'b-when' }, typeof b.when_where === 'object' ? [r(b.when_where.when || ''), b.when_where.when && b.when_where.where ? ' · ' : '', r(b.when_where.where || '')] : r(String(b.when_where))));
    else if (b.quote && typeof b.quote === 'object') out.push(h('blockquote', { class: 'b-quote' }, h('p', null, '\u201c' + r(String(b.quote.text || '')) + '\u201d'), b.quote.by ? h('p', { class: 'b-by' }, r(String(b.quote.by))) : null));
    else if (typeof b.contact === 'string') out.push(contactBlock(t, b.contact, !!open));
    // media, choices and input blocks are drawn by the Desk from the ask itself; any other block is ignored (8.1)
  }
  return out.length ? h('div', { class: 'blocks' }, out) : null;
}

/* ---------- branded asks (section 27: CARD-1 to CARD-10) ----------
   The brand dresses the card; every control stays the Desk's own (CARD-1). The mark is drawn by the Desk in one slot at the
   card's top edge (CARD-3); the dressing goes only on the brand's own ground for this mode (CARD-4); every brand colour is
   checked on the ground it is drawn on, words 4.5:1 and a glyph 3:1, and the Desk's own ink stands in where one fails (CARD-5). */
const HEXC = /^#[0-9a-f]{6}$/i;
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function darkNow() { const th = document.documentElement.getAttribute('data-theme'); return th ? th === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; }
function token(name, light, dark) { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return HEXC.test(v) ? v.toLowerCase() : (darkNow() ? dark : light); }
function brandOf(t) { const b = t && t.brand; return b && typeof b === 'object' && typeof b.name === 'string' && b.name ? b : null; }
function brandLook(b) {
  const g = b.grounds && typeof b.grounds === 'object' ? b.grounds[darkNow() ? 'dark' : 'light'] : null;
  if (!HEXC.test(g || '')) return null;                                               // no ground for this mode: the Desk's own card
  // the Desk's own words and controls must read on it: its ink, its quiet words and its asker colour
  if ([token('--ink', '#1d1d1b', '#faf8f3'), token('--muted', '#5d5a53', '#a9a59c'), token('--asker', '#006d94', '#2bb3f0')].some((v) => contrast(v, g) < 4.5)) return null;
  const c = b.colours && typeof b.colours === 'object' && !Array.isArray(b.colours) ? b.colours : {};
  const words = (v) => HEXC.test(v || '') && contrast(v, g) >= 4.5 ? v : null;
  return { ground: g, ink: words(c.ink), inkSoft: words(c.ink_soft), rule: HEXC.test(c.rule || '') ? c.rule : null, round: b.corners === 'round' };
}
const markPics = new Map();
function markPicture(url) {   // a mark's picture, served by the server with no credential; any other address is never loaded
  if (!url || typeof url !== 'string' || url.indexOf(API + '/') !== 0) return null;
  const e = markPics.get(url); if (e) return e.src || null;
  markPics.set(url, { loading: true });
  fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }).then((r) => r.ok ? r.blob() : Promise.reject(r.status))
    .then((bl) => { if (!/^image\/(png|jpeg|webp)$/.test(bl.type || '')) throw 415; markPics.set(url, { src: URL.createObjectURL(bl) }); S.cardSig = ''; render(); if (S.view === 'ais') renderAIs(); })
    .catch(() => markPics.set(url, { failed: true }));
  return null;
}
function brandMark(b, state, ground) {
  const st = b.mark && b.mark.states && typeof b.mark.states === 'object' ? b.mark.states : {};
  const m = st[state] || st.idle || st.needs_you;
  if (!m || typeof m !== 'object') return null;
  if (m.media || m.url) { const src = markPicture(m.url); return src ? h('img', { class: 'b-mark', src, alt: '' }) : null; }
  if (!['disc', 'ring', 'square', 'frame'].includes(m.glyph)) return null;
  const g = ground || token('--paper', '#faf8f3', '#141413');
  const colour = HEXC.test(m.colour || '') && contrast(m.colour, g) >= 3 ? m.colour : 'currentColor';   // the Desk's ink, same shape
  const NS = 'http://www.w3.org/2000/svg', sw = 3;   // a 20-unit mark; an outline is 15% of it
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 20 20'); svg.setAttribute('class', 'b-mark'); svg.setAttribute('aria-hidden', 'true');
  const round = m.glyph === 'disc' || m.glyph === 'ring', outline = m.glyph === 'ring' || m.glyph === 'frame';
  const el = document.createElementNS(NS, round ? 'circle' : 'rect');
  if (round) { el.setAttribute('cx', '10'); el.setAttribute('cy', '10'); el.setAttribute('r', String(outline ? 10 - sw / 2 : 10)); }
  else { const o = outline ? sw / 2 : 0; el.setAttribute('x', String(o)); el.setAttribute('y', String(o)); el.setAttribute('width', String(20 - 2 * o)); el.setAttribute('height', String(20 - 2 * o)); }
  if (outline) { el.setAttribute('fill', 'none'); el.setAttribute('stroke', colour); el.setAttribute('stroke-width', String(sw)); } else el.setAttribute('fill', colour);
  svg.appendChild(el); return svg;
}
const openFrom = (c) => S.open.filter((t) => !t.isCall && t.connection && t.connection.id === (c.id || c.connection_id)).length;
function aiMark(c) {   // a connection whose asks wear a brand shows the mark's idle state in place of its icon
  const b = c.brand && typeof c.brand === 'object' && c.brand.name ? c.brand : null;
  const m = b ? brandMark(b, 'idle', null) : null;
  return m ? h('span', { class: 'ic b-slot' }, m) : iconFor(c.icon, c.name, false, c.icon_url);
}
function aiBrandWords(c) {
  const b = c.brand && typeof c.brand === 'object' && c.brand.name ? c.brand : null;
  if (!b) return null;
  return h('span', { class: 'b-ai' }, b.domain ? h('span', { class: 'b-domain' }, String(b.domain)) : null,
    b.test === true || b.verified === false ? h('span', { class: 'flag test-brand' }, 'Test brand, not verified') : null,
    !openFrom(c) && typeof b.quiet_line === 'string' && b.quiet_line ? h('span', { class: 'b-quiet' }, b.quiet_line) : null);
}
function brandLine(t, look) {   // the mark, the brand's name and its domain (CARD-3, CARD-6); a test brand says so (CARD-7)
  const b = brandOf(t); if (!b) return null;
  const mark = brandMark(b, !t.state || t.state === 'open' ? 'needs_you' : 'answered', look && look.ground);
  return h('div', { class: 'brand-line' }, mark ? h('span', { class: 'b-slot' }, mark) : null, h('b', { class: 'b-name' }, b.name),
    b.domain ? h('span', { class: 'b-domain' }, String(b.domain)) : null,
    b.test === true || b.verified === false ? h('span', { class: 'flag test-brand' }, 'Test brand, not verified') : null);
}
function dress(card, look) {   // CSSOM, not a style attribute: the page's policy allows no inline style
  if (!look) return card;
  card.classList.add('branded'); if (look.round) card.classList.add('round');
  card.style.setProperty('--b-ground', look.ground);
  if (look.ink) card.style.setProperty('--b-ink', look.ink);
  if (look.inkSoft) card.style.setProperty('--b-ink-soft', look.inkSoft);
  if (look.rule) card.style.setProperty('--b-rule', look.rule);
  return card;
}
// Done is on every ask the server takes it for // (CARD-9). Section 26 offers it on a question's line, a link and a command; on a choice and an approval only a server that
// lists branded_asks takes it (ASKS-12), and an ask that wears a brand comes from one.
const doneOk = (t) => { const k = kindOf(t); return k === 'words' || k === 'link' || k === 'command' || k === 'dial' || ((k === 'choice' || k === 'approve') && (S.features.has('branded_asks') || !!brandOf(t))); };
// A choice that takes a line (CARD-10): choosing it opens the line, labelled by the asker, and sends the choice with the words
const lineFor = (t, c) => { const lf = t.step && t.step.line_for; return lf && typeof lf === 'object' && typeof lf[c] === 'string' ? lf[c] : null; };
function choose(t, c) {
  if (!lineFor(t, c)) return answer(t, { action: 'answer', choice: c });
  const d = draft(t.task_id); d.lineFor = c; S.cardSig = ''; renderCard(true);
  setTimeout(() => { const f = $('#f-line'); if (f) f.focus(); }, 0);
}
function mediaFor(t) {
  if (!t.media) return null;
  const m = t.media, kind = /^video\//.test(m.content_type || '') ? 'clip' : /^image\//.test(m.content_type || '') ? 'photo' : null;
  const cap = h('figcaption', null, (kind === 'clip' ? 'Clip' : 'Photo') + ' from ' + whoName(t),
    m.deleted_at ? h('span', null, '· deleted ' + fmtDay.format(ms(m.deleted_at)) + ' on your schedule') : null);
  if (!kind) return h('figure', { class: 'media' }, h('div', { class: 'loading' }, 'A file came with this ask. The Desk shows photos and clips only.'), cap);
  const got = S.media.get(t.task_id);
  let body;
  if (!got || got.loading) { body = h('div', { class: 'loading' }, 'Loading the ' + kind + '…'); if (!got) loadMedia(t); }
  else if (got.error) body = h('div', { class: 'loading' }, got.error);
  else if (kind === 'clip') body = h('video', { src: got.url, controls: true, muted: true, playsinline: true, preload: 'metadata' });
  else body = h('img', { src: got.url, alt: 'Photo sent with this ask by ' + whoName(t) });
  return h('figure', { class: 'media' }, body, cap);
}
async function loadMedia(t) {
  const id = t.task_id;
  if (S.media.has(id)) return;
  S.media.set(id, { loading: true });
  try { const b = await apiBlob('/v1/member/tasks/' + enc(id) + '/media'); S.media.set(id, { url: URL.createObjectURL(b) }); }
  catch (e) { S.media.set(id, { error: e.status === 404 || e.status === 410 ? 'This ' + (t.media.kind || 'picture') + ' was deleted on your schedule.' : 'The picture could not be loaded.' }); }
  S.cardSig = ''; if (S.view === 'asks') renderCard(); else if (S.view === 'history') renderHistory();
}
function ansBtn(label, key, onclick, cls) {
  return h('button', { class: 'btn' + (cls ? ' ' + cls : ''), type: 'button', onclick }, label, key ? kbd(key) : null);
}
function textField(id, field, value, attrs, oninput, onkeydown) {
  const ta = h('textarea', Object.assign({ id, rows: 2, spellcheck: 'true', dataset: { field } }, attrs || {}));
  ta.value = value || '';
  ta.addEventListener('input', () => { oninput(ta.value); autoGrow(ta); });
  if (onkeydown) ta.addEventListener('keydown', onkeydown);
  requestAnimationFrame(() => autoGrow(ta));
  return ta;
}
function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(Math.max(ta.scrollHeight + 3, 36), 320) + 'px'; }
/* Words with web addresses in them: each https address becomes a link that opens in a new tab; the rest stays text. */
function linked(text) {
  const out = []; const str = String(text == null ? '' : text);
  const re = /https?:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?]/g; let last = 0, m;
  while ((m = re.exec(str))) {
    const u = safeUrl(m[0]);
    if (!u) continue;
    if (m.index > last) out.push(str.slice(last, m.index));
    out.push(h('a', { href: u.href, target: '_blank', rel: 'noopener noreferrer' }, m[0]));
    last = m.index + m[0].length;
  }
  if (last < str.length) out.push(str.slice(last));
  return out;
}
function safeUrl(u) { try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x : null; } catch (e) { return null; } }
function copyText(text, btn) {
  const done = () => { if (btn) { const old = btn.firstChild.textContent; btn.firstChild.textContent = 'Copied'; setTimeout(() => { btn.firstChild.textContent = old; }, 1400); } sr('Copied.'); };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => sr('Copy was blocked; select the line and copy it.'));
  else sr('Select the line and copy it.');
}
function callCard(t) {
  const o = t.offer;
  if (!S.seats.has(o.seat_id)) loadSeat(t);
  const seat = S.seats.get(o.seat_id);
  const sd = seat && !seat.loading && !seat.error ? seat : null;
  const kind = (sd && sd.experience && sd.experience.kind) || o.kind || 'call';
  const verb = CALL_VERB[kind] || kind;
  const unpaid = (o.pay && o.pay.unpaid_test) || (sd && sd.pay && sd.pay.unpaid_test);
  const kids = [h('button', { class: 'linkish back', type: 'button', onclick: () => closeReading() }, '← The list'),
    h('div', { class: 'who' }, iconFor(null, t.from, true),
      h('div', null, h('div', { class: 'name' }, t.from), h('div', { class: 'basis' }, t.basis || 'Answers for this call')),
      h('div', { class: 'meta' }, h('span', { class: 'label' }, o.state === 'offered' ? 'Held for you' : 'Taken'),
        h('span', { class: 'when' }, o.held_until && o.state === 'offered' ? 'until ' + fmtClockZ.format(ms(o.held_until)) : ''))),
    h('div', { class: 'ai-says' }, h('span', { class: 'label' }, 'An AI is asking'), h('span', { class: 'label' }, '· A call: ' + kind),
      unpaid ? h('span', { class: 'flag now' }, 'Unpaid test') : null),
    h('h2', { class: 'card-title', id: 'card-title' }, o.ask || 'A call')];
  const callBlocks = blocksFor({ card: o.card || (sd && sd.card) || null });
  if (callBlocks) kids.push(callBlocks);
  const facts = [['Your time', 'about ' + (o.minutes || (sd && sd.minutes) || '?') + ' minutes'],
    ['Pay', unpaid ? 'Unpaid test: nobody is paid' : (o.pay && o.pay.per_person_usd ? '$' + o.pay.per_person_usd : 'Shown on the call')]];
  if (sd) {
    facts.push(['Content', sd.content_rating || 'not given']);
    if (sd.download_bytes) facts.push(['Download', (sd.download_bytes / 1e6).toFixed(1) + ' MB']);
    if (sd.kept && sd.kept.note) facts.push(['Kept', sd.kept.note]);
  }
  kids.push(h('div', { class: 'blocks' }, h('dl', { class: 'b-facts' }, facts.map(([a, b]) => [h('dt', null, a), h('dd', null, b)]))));
  if (sd && Array.isArray(sd.recorded) && sd.recorded.length) kids.push(h('div', { class: 'unlocks' }, h('span', { class: 'label' }, 'What is recorded'),
    h('p', null, sd.recorded.join('; ') + '. Not your voice, camera or location unless the call says so.')));
  else if (seat && seat.loading) kids.push(h('p', { class: 'help' }, 'Reading what this call records…'));
  else if (seat && seat.error) kids.push(h('p', { class: 'error' }, 'The call\'s details could not be read: ' + seat.error));
  const yn = yesNo(t), ans = [];
  if (yn.no) ans.push(ansBtn('Decline', '←', () => answer(t, yn.no.body)));
  const unchecked = /not checked/i.test(t.basis || '');
  ans.push(ansBtn(o.state === 'offered' ? 'Take this call and ' + verb : 'Open the call again', '→', () => takeCall(t), unchecked ? '' : 'btn-you'));
  if (unchecked) kids.push(h('p', { class: 'note-state' }, 'person.tools has not checked who "' + t.from + '" is: the name is the asker\'s own. Take the call only if you know them.'));
  kids.push(h('div', { class: 'answers', role: 'group', 'aria-label': 'This call' }, ans));
  const opened = S.callOpened && S.callOpened[t.task_id], href = opened && safeUrl(o.seat_url);
  if (href) kids.push(h('p', { class: 'help call-opened' }, 'Opened in a new tab at ' + fmtClock.format(opened) + '. No new tab? ',
    h('a', { href: href.href, target: '_blank', rel: 'noopener noreferrer' }, 'Open the call page'), '.'));
  kids.push(h('p', { class: 'footnote' }, 'The call opens in a new tab on run.person.tools. Nothing starts until you press play there, and Stop is on every screen. ',
    o.state === 'offered' ? 'Decline is free and leaves no mark; this call is then not offered to you again. If you do nothing, the hold simply ends.' : ''));
  kids.push(h('div', { class: 'legend', 'aria-hidden': 'true' }, h('span', null, kbd('J'), kbd('K'), 'move'),
    yn.no ? h('span', null, kbd('←'), kbd('N'), 'Decline') : null, h('span', null, kbd('→'), kbd('Y'), o.state === 'offered' ? 'Take this call' : 'Open it again'),
    h('span', null, kbd('Z'), 'undo'), h('span', null, kbd('?'), 'every key')));
  kids.push(h('p', { class: 'card-foot' }, h('button', { class: 'linkish', type: 'button', onclick: () => blockAsker(t) }, 'Block ' + t.from + '…')));
  return h('article', { class: 'card', 'aria-labelledby': 'card-title' }, kids);
}
function passBtn(t) {
  return canPass() && !t.isCall && !contactsOf(t).length ? h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => openPass(t), title: 'Hand this ask to one of your people' }, 'Pass on', kbd('P')) : null;
}
function laterBtn(t) {
  return h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => toggleLater(t), title: 'Only this computer knows; the AI is not told' },
    isLater(t) ? 'Back from Later' : 'Later', kbd('U'));
}
function cardFor(t) {
  if (t.isCall) return callCard(t);
  const k = kindOf(t), s = t.step || {}, d = draft(t.task_id), yn = yesNo(t);
  const p = S.pending.get(t.task_id), failed = S.failed.get(t.task_id);
  const kids = [];
  kids.push(h('button', { class: 'linkish back', type: 'button', onclick: () => closeReading() }, '← The list'));
  const brand = brandOf(t), look = brand ? brandLook(brand) : null;
  if (brand) kids.push(brandLine(t, look));
  kids.push(whoBlock(t));
  kids.push(h('div', { class: 'ai-says' + (t.sender && !t.passed_on_by ? ' mine' : '') }, h('span', { class: 'label' }, t.sender && !t.passed_on_by ? 'A person is asking' : 'An AI is asking'),
    h('span', { class: 'label' }, '· ' + KIND_WORD[k]), isLater(t) ? h('span', { class: 'flag later' }, 'Later') : null));
  const head = headOf(t, true), slot = answerSlot(t), slotIn = slot >= 0 ? cardBlocks(t)[slot].input : null, rf = (x) => refs(t, x, true);
  kids.push(h('h2', { class: 'card-title', id: 'card-title' }, head || rf(t.title) || 'An ask'));
  if (S.gone) { kids.push(h('p', { class: 'help' }, S.gone)); S.gone = null; }
  if (failed) kids.push(h('div', { class: 'notsent', role: 'alert' }, h('span', { class: 'label' }, 'Not sent'), h('p', null, failed.message),
    ansBtn('Send it again', null, () => answer(t, failed.body))));
  const blocks = blocksFor(t, head ? 1 : 0, slot, true); if (blocks) kids.push(blocks);
  const media = mediaFor(t); if (media) kids.push(media);

  // The ask's own words, then what the answer lets it do; where the card places a question's answers, the question stands
  // right before them (27.5, CARD-8)
  if (k === 'approve' && s.editable) {
    const cur = d.approve === null ? rf(s.text || '') : d.approve;
    const edited = d.approve !== null && d.approve !== s.text;
    const badge = h('span', { class: 'edited', hidden: !edited }, 'Edited');
    const reset = h('button', { class: 'linkish end', type: 'button', hidden: !edited, onclick: () => { d.approve = null; S.cardSig = ''; renderCard(true); } }, 'Put back the AI\'s words');
    kids.push(h('div', { class: 'field' },
      h('div', { class: 'row-l' }, h('label', { class: 'label', for: 'f-approve' }, 'The words you approve (you can edit them)'), badge, reset),
      h('p', { class: 'help' }, 'While you type here, keys only type. Esc leaves the box; then ← or → answers.'),
      textField('f-approve', 'approve', cur, { 'aria-describedby': 'card-title' }, (v) => {
        d.approve = v; const e = v !== s.text; badge.hidden = !e; reset.hidden = !e; })));
  } else if (k === 'command') {
    const line = s.command || '';
    const copyBtn = h('button', { class: 'btn', type: 'button', onclick: (ev) => copyText(line, ev.currentTarget) }, 'Copy', kbd('C'));
    if (s.text) kids.push(h('div', { class: 'ask-words' }, h('p', null, linked(s.text))));
    kids.push(h('div', { class: 'cmd' }, h('div', { class: 'cmd-top' }, h('span', { class: 'label only' }, 'Only you can run this'), copyBtn),
      h('pre', { id: 'cmd-line' }, line)));
    kids.push(h('p', { class: 'cmd-where' }, s.where ? ['Where: ', h('b', null, s.where)] : null,
      s.where ? '. ' : '', t.shell_only ? t.shell_only : 'Copy the line and run it yourself; person.tools cannot run it for you.'));
  } else if (s.text && !(slot >= 0 && (k === 'choice' || k === 'words'))) {
    kids.push(h('div', { class: 'ask-words' + (t.sender ? ' mine' : '') }, h('p', null, linked(rf(s.text)))));
  }
  // a call to make: the contact, unless the card already draws them (CARD-11)
  if (k === 'dial' && !cardBlocks(t).some((b) => b && b.contact === s.contact)) kids.push(contactBlock(t, s.contact, true));
  if (k === 'link' && s.sign_in_page) kids.push(h('p', { class: 'note-state' }, 'This link opens a sign-in page' + (s.domain ? ' on ' + s.domain : '') + '. Sign in only where you meant to; nobody at person.tools will ever ask for your password.'));
  if (k === 'link') {
    const u = safeUrl(s.url);
    kids.push(h('div', { class: 'linkbox' }, h('span', { class: 'host' }, u ? u.host : 'Not a web address'),
      h('span', { class: 'url', title: s.url || '' }, s.url || ''),
      u ? h('a', { class: 'btn', href: u.href, target: '_blank', rel: 'noopener noreferrer', id: 'open-link' }, 'Open link', kbd('O')) : null));
  }
  if (t.unlocks) kids.push(h('div', { class: 'unlocks' }, h('span', { class: 'label' }, 'After your answer, in its words'), h('p', { class: 'its-words' }, '“', linked(refs(t, t.unlocks, true)), '”')));
  if (leftWords(t.expires_at)) kids.push(h('p', { class: 'note-state' }, 'If you do not answer by ' + fmtClock.format(ms(t.expires_at)) + ', the ask closes and ' + whoName(t) + ' is told you did not answer. Nothing is chosen for you.'));

  if (s.text && slot >= 0 && (k === 'choice' || k === 'words')) kids.push(h('div', { class: 'ask-words' + (t.sender ? ' mine' : '') }, h('p', null, linked(rf(s.text)))));

  // Answers: the kinds of 8.1, with the ask's own words on its two answers
  const ans = [];
  const chosen = p && p.body.action !== 'note' ? p.body : null;
  const isChosen = (b) => chosen && chosen.action === b.action && (chosen.choice ?? null) === (b.choice ?? null);
  if (k === 'choice') {
    const many = s.choices.length > 2;
    (many ? s.choices : twoChoices(s.choices).filter((c) => c !== undefined)).forEach((c, i) => {
      const body = { action: 'answer', choice: c };
      const key = many ? String(i + 1) : (i === 0 ? '←' : i === 1 ? '→' : String(i + 1));
      ans.push(ansBtn(rf(c) + (lineFor(t, c) ? '…' : ''), key, () => choose(t, c), isChosen(body) || d.lineFor === c ? 'chosen' : ''));
    });
    ans.push(h('span', { class: 'spacer' }));
    ans.push(ansBtn('Not now', 'X', () => answer(t, { action: 'not_now' })));
    if (doneOk(t)) ans.push(ansBtn('Done', 'D', () => answer(t, { action: 'done' })));
    ans.push(laterBtn(t)); ans.push(passBtn(t));
    kids.push(h('div', { class: 'answers choices', role: 'group', 'aria-label': 'Your answer' }, ans));
    if (d.lineFor && lineFor(t, d.lineFor)) {
      const c = d.lineFor, kb = s.keyboard;
      const sendLine = () => { const v = (d.lineText || '').trim(); if (!v) { flashCard('Write the line first.'); return; } answer(t, { action: 'answer', choice: c, text: v }); };
      const input = h('input', { id: 'f-line', type: kb === 'email' ? 'email' : kb === 'phone' ? 'tel' : 'text', inputmode: kb === 'number' ? 'decimal' : kb === 'phone' ? 'tel' : kb === 'email' ? 'email' : null,
        autocomplete: 'off', maxlength: '4000', dataset: { field: 'line' }, 'aria-describedby': 'card-title' });
      input.value = d.lineText || '';
      input.addEventListener('input', () => { d.lineText = input.value; });
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); sendLine(); } });
      kids.push(h('div', { class: 'field line-for' }, h('label', { class: 'label', for: 'f-line' }, refs(t, lineFor(t, c), true)), input,
        h('div', { class: 'answers' }, ansBtn('Send ' + rf(c), '↵', sendLine, 'btn-you'),
          h('button', { class: 'linkish', type: 'button', onclick: () => { d.lineFor = null; S.cardSig = ''; renderCard(true); } }, 'Choose again'))));
    }
  } else if (k === 'words') {
    const send = () => { const v = (d.text || '').trim(); if (!v) { flashCard('Write a line first, or choose Done or Not now.'); return; } answer(t, { action: 'answer', text: v }); };
    kids.push(h('div', { class: 'field' },
      h('div', { class: 'row-l' }, h('label', { class: 'label', for: 'f-text' }, slotIn && typeof slotIn.label === 'string' && slotIn.label ? slotIn.label : 'Your answer'), h('p', { class: 'help' }, 'Enter sends · Shift+Enter for a new line · while you type, other keys only type')),
      textField('f-text', 'text', d.text, { placeholder: slotIn && typeof slotIn.placeholder === 'string' && slotIn.placeholder ? slotIn.placeholder : 'Write a line', 'aria-describedby': 'card-title', inputmode: { number: 'decimal', phone: 'tel', email: 'email' }[s.keyboard] || null }, (v) => { d.text = v; },
        (ev) => { if (ev.key === 'Enter' && !ev.shiftKey && !ev.metaKey && !ev.ctrlKey && !ev.isComposing) { ev.preventDefault(); send(); } })));
    ans.push(ansBtn('Send', '↵', send, 'btn-you'));
    ans.push(h('span', { class: 'spacer' }));
    ans.push(ansBtn(yn.no.label, '←', () => answer(t, yn.no.body), isChosen(yn.no.body) ? 'chosen' : ''));
    ans.push(ansBtn(yn.yes.label, '→', () => answer(t, yn.yes.body), isChosen(yn.yes.body) ? 'chosen' : ''));
    ans.push(laterBtn(t)); ans.push(passBtn(t));
    kids.push(h('div', { class: 'answers', role: 'group', 'aria-label': 'Your answer' }, ans));
  } else if (k === 'dial') {
    // the Desk's own Call control dials on this computer's phone app; Called says the person made the call
    const c = contactOf(t, s.contact), first = c.name ? String(c.name).split(/\s+/)[0] : capFirst(roleOf(c));
    if (E164.test(c.phone || '')) ans.push(h('a', { class: 'btn btn-you', href: 'tel:' + c.phone, id: 'dial-link' }, 'Call ' + first + ', ' + fmtPhone(c.phone), kbd('O')));
    ans.push(ansBtn('Called', '→', () => answer(t, { action: 'answer' }), isChosen({ action: 'answer' }) ? 'chosen' : ''));
    ans.push(h('span', { class: 'spacer' }));
    ans.push(ansBtn('Not now', 'X', () => answer(t, { action: 'not_now' })));
    ans.push(ansBtn('Done', 'D', () => answer(t, { action: 'done' })));
    ans.push(laterBtn(t));
    kids.push(h('div', { class: 'answers', role: 'group', 'aria-label': 'Your answer' }, ans));
    kids.push(h('p', { class: 'footnote' }, 'Call opens your phone app with the number; nothing is dialled for you. Called tells ' + whoName(t) + ' you made the call. Done clears the ask without saying.'));
  } else if (k === 'approve' || k === 'link' || k === 'command') {
    ans.push(ansBtn(yn.no.label, '←', () => answer(t, yn.no.body), isChosen(yn.no.body) ? 'chosen' : ''));
    ans.push(ansBtn(yn.yes.label, '→', () => answer(t, yn.yes.body), isChosen(yn.yes.body) ? 'chosen' : ''));
    ans.push(h('span', { class: 'spacer' }));
    if (k === 'approve') ans.push(ansBtn('Not now', 'X', () => answer(t, { action: 'not_now' })));
    if (k === 'approve' && doneOk(t)) ans.push(ansBtn('Done', 'D', () => answer(t, { action: 'done' })));
    ans.push(laterBtn(t)); ans.push(passBtn(t));
    kids.push(h('div', { class: 'answers', role: 'group', 'aria-label': 'Your answer' }, ans));
    if (k === 'approve') kids.push(h('p', { class: 'footnote' }, 'Approvals sent from the Desk carry no device signature, and ' + whoName(t) + ' can see that: if it needs a signed approval, it may refuse this one. Approve on your phone for a signed one.'));
  } else {
    ans.push(ansBtn('Not now', 'X', () => answer(t, { action: 'not_now' })));
    ans.push(laterBtn(t)); ans.push(passBtn(t));
    kids.push(h('p', { class: 'help' }, 'This kind of ask is new to the Desk. You can say Not now, send a note, or answer it on your phone.'));
    kids.push(h('div', { class: 'answers' }, ans));
  }

  if (slot >= 0) { const after = blocksFor(t, slot + 1); if (after) kids.push(after); }
  if (p && p.body.action !== 'note') kids.push(h('p', { class: 'sending-line', role: 'status' }, p.body.action === 'pass'
    ? 'Passing it on to ' + (nameOfMember(p.body.to) || 'them') + ' in 5 s. Z takes it back.'
    : 'Sending to ' + whoName(t) + ' in 5 s: ' + p.label + '. Z takes it back.'));
  // Notes: one may ride with any answer, or go alone and leave the ask open
  kids.push(notesBlock(t, d, p));
  kids.push(legendFor(t));
  kids.push(h('p', { class: 'card-foot' }, t.sender ? h('button', { class: 'linkish', type: 'button', onclick: (ev) => mutePerson(t.sender.name || whoName(t), ev.currentTarget, { task_id: t.task_id }) }, 'Mute ' + (t.sender.name || whoName(t)) + ': their asks never ring') : null,
    t.sender ? ' · ' : null, h('button', { class: 'linkish', type: 'button', onclick: () => blockAsker(t) }, 'Block ' + whoName(t) + '…')));
  return dress(h('article', { class: 'card', 'aria-labelledby': 'card-title' }, kids), look);
}
// Who wrote a note, as this person reads it: the asker (an AI, or a person who sent the ask), the person who passed the
// ask on to them (by: "passer"), or themselves. A private note is between the two people; the AI never sees it.
function noteWho(n, t) {
  if (n.by === 'asker') return { w: n.name || whoName(t), cls: ' asker' };
  if (n.by === 'passer') { const pb = t.passed_on_by; return { w: n.name || (typeof pb === 'string' ? pb : (pb && pb.name)) || 'Who passed it on', cls: '' }; }
  return { w: 'You', cls: '' };
}
function noteLine(n, t, tm) {
  const who = noteWho(n, t);
  return h('li', null, h('span', { class: 'by' + who.cls, title: who.w }, who.w),
    h('span', { class: 'tx' }, linked(n.note || ''), n.private && t.passed_on_by ? h('span', { class: 'priv' }, ' · ' + whoName(t) + ' does not see this') : null),
    h('span', { class: 'tm' }, tm));
}
function notesBlock(t, d, p) {
  const notes = (Array.isArray(t.notes) ? t.notes : []).slice();
  if (p && p.body.action === 'note') notes.push({ at: null, note: p.body.note, by: 'person', pending: true });
  const last = notes[notes.length - 1];
  const kids = [h('span', { class: 'label' }, 'Notes')];
  if (notes.length) kids.push(h('ol', { class: 'thread' }, notes.map((n) => noteLine(n, t, n.pending ? 'sending…' : (n.at ? fmtClock.format(ms(n.at)) : '')))));
  if (last && last.by === 'person') kids.push(h('p', { class: 'note-state' }, 'Note, not done: the ask stays open until you answer it.'));
  else if (last && last.by === 'asker') kids.push(h('p', { class: 'note-state' }, whoName(t) + ' answered your note. The ask is still open.'));
  const sendNote = () => { const v = (d.note || '').trim(); if (!v) { $('#f-note').focus(); sr('Write the note first.'); return; } answer(t, { action: 'note', note: v }); };
  const ta = textField('f-note', 'note', d.note, { placeholder: 'Add a note: it rides with your answer, or send it alone', rows: 1, 'aria-label': 'Note' },
    (v) => { d.note = v; rides.hidden = !v.trim(); });
  const rides = h('p', { class: 'footnote', hidden: !(d.note || '').trim() }, 'Your note rides with whichever answer you give, or send it alone and the ask stays open.');
  kids.push(h('div', { class: 'note-row' }, ta, ansBtn('Send note only', MOD + '↵', sendNote)));
  kids.push(rides);
  return h('section', { class: 'notes', 'aria-label': 'Notes' }, kids);
}
function legendFor(t) {
  const k = kindOf(t), yn = yesNo(t);
  const item = (keys, what) => h('span', null, keys.map(kbd), what);
  const items = [item(['J', 'K'], 'move')];
  if (k === 'choice' && t.step.choices.length > 2) items.push(item(['1', '–', String(t.step.choices.length)], 'choose'));
  if (yn.no) items.push(item(['←', 'N'], yn.no.label));
  if (yn.yes) items.push(item(['→', 'Y'], yn.yes.label));
  if (k === 'choice' || k === 'other' || k === 'approve') items.push(item(['X'], 'Not now (' + (t.sender ? whoName(t) : 'the AI') + ' is told)'));
  if ((k === 'choice' || k === 'approve' || k === 'dial') && doneOk(t)) items.push(item(['D'], 'Done'));
  if (k === 'dial') items.push(item(['O'], 'call'));
  if (k === 'link') items.push(item(['O'], 'open link'));
  if (k === 'command') items.push(item(['C'], 'copy'));
  items.push(item(['Enter'], k === 'words' ? 'write' : 'note'), item(['U'], isLater(t) ? 'back from Later' : 'Later (only here)'), item(['Z'], 'undo (5 s)'), item(['?'], 'every key'));
  return h('div', { class: 'legend', 'aria-hidden': 'true' }, items);
}
function emptyCard() {
  if (S.firstLook) return h('div', { class: 'empty' }, h('p', { class: 'help', role: 'status' }, S.lastErr ? 'person.tools has not answered yet; the Desk is trying again.'
    : 'Loading your asks…' + (S.firstSlow ? ' person.tools is slow to answer just now.' : '')));
  const conns = (S.conns || []).filter((c) => !c.revoked_at);
  if (S.conns === null) loadConns();
  const pendingN = S.pending.size;
  const kids = [h('h2', null, pendingN ? 'Sending your answers.' : 'Nothing is waiting for you.'),
    h('p', null, 'When one of your AIs asks you something, it appears here: first if it is urgent, with a line across the top. Nothing makes a sound.')];
  if (conns.length) {
    kids.push(h('ul', { class: 'ais' }, conns.map((c) => h('li', null, aiMark(c), h('b', null, c.name),
      h('span', { class: 'm' }, c.blocked ? 'blocked' : c.quiet ? 'quiet' : 'last asked ' + agoWords(c.last_used_at)), aiBrandWords(c)))));
  } else if (S.conns) {
    kids.push(h('p', null, 'No AI is connected to you yet. Connect one and you get a key and the words to give it. The key lets that AI ask you things and read your answers, and nothing else; you can revoke it with one click.'));
  }
  kids.push(h('div', { class: 'answers' }, ansBtn(conns.length ? 'Connect another AI' : 'Connect an AI', 'A', () => setView('ais', true), conns.length ? '' : 'btn-you'),
    ansBtn('History', 'H', () => setView('history'))));
  kids.push(h('p', { class: 'help' }, S.lastOk ? 'Last looked ' + fmtClock.format(S.lastOk) + '. The Desk looks again every 15 seconds while this tab is open, and the tab\'s icon shows how many asks are waiting.' : ''));
  const prim = (keys, what) => [h('dt', null, keys.map(kbd)), h('dd', null, what)];
  kids.push(h('div', { class: 'primer' }, h('span', { class: 'label' }, 'When asks arrive'),
    h('dl', null, prim(['J', 'K'], 'move down and up the list'), prim(['→', 'Y'], 'the card\'s yes: Done, approve, the second choice'),
      prim(['←', 'N'], 'its no: Not now, deny, the first choice'), prim(['Z'], 'undo, for five seconds'), prim(['?'], 'every key'))));
  return h('div', { class: 'empty' }, kids);
}

/* ---------- History: answered asks, searchable ---------- */
async function loadDeepHistory() {
  try { const d = await api('GET', '/v1/member/tasks?history=200'); S.historyDeep = Array.isArray(d && d.history) ? d.history : []; if (S.view === 'history') renderHistory(); }
  catch (e) {
    // the last 50 came with the list; say that older ones did not load, and never show "Loading" for ever
    if (e.code === 'signed_out') return;
    S.historyDeep = []; S.historyNote = 'Only your latest answers are here: older ones could not be read just now.';
    if (S.view === 'history') renderHistory();
  }
}
function historyItems() {
  const map = new Map();
  for (const t of (S.historyDeep || [])) map.set(t.task_id, t);
  for (const t of S.history) map.set(t.task_id, t);
  for (const [id, t] of S.sentLocal) if (!map.has(id)) map.set(id, t);
  return [...map.values()].sort((a, b) => ms(b.reply && b.reply.at) - ms(a.reply && a.reply.at) || tms(b) - tms(a));
}
function historyAnswer(t) {
  const r = t.reply || {}, s = t.step || {};
  if (t.state === 'passed' || r.action === 'pass' || t.passed_to) {
    const pt = t.passed_to, n = (pt && (typeof pt === 'string' ? nameOfMember(pt) : (pt.name || nameOfMember(pt.member_id)))) || 'one of your people';
    return 'Passed to ' + n;
  }
  if (r.action === 'answer' && s.type === 'call') return 'Called ' + (contactOf(t, s.contact) ? roleWords(t)[s.contact] : 'them');
  if (r.action === 'answer') return r.choice != null ? 'You picked ' + refs(t, r.choice, false) + (r.text ? ': ' + r.text : '') : r.text ? 'You wrote: ' + r.text : 'Answered';
  if (r.action === 'done') return 'Done';
  if (r.action === 'not_now') return 'Not now';
  if (r.action === 'approve') return refs(t, s.approve_label || 'Approve', false) + (r.approved_text && r.approved_text !== s.text ? ', with your words' : '');
  if (r.action === 'deny') return refs(t, s.deny_label || 'Deny', false);
  // an ask settled in the service's own app says so; one it withdrew says who did (27.2, ASKS-4)
  if (t.state === 'withdrawn') return settledElsewhere(t) ? 'Answered in ' + ((brandOf(t) && brandOf(t).name) || whoName(t)) : 'Withdrawn by ' + whoName(t);
  if (t.state === 'lapsed') return 'Closed without an answer';
  return t.state || 'Answered';
}
function searchText(t) {
  const r = t.reply || {}, s = t.step || {};
  return [refs(t, t.title, false), refs(t, s.text, false), s.command, s.url, (s.choices || []).map((c) => refs(t, c, false)).join(' '), whoName(t), refs(t, t.unlocks, false), r.choice, r.text, r.note, r.approved_text,
    (t.notes || []).map((n) => n.note).join(' '), historyAnswer(t), passerName(t), cardWords(t)].filter(Boolean).join(' \n ').toLowerCase();
}
function cardWords(t) { // the words of an ask's card blocks, for search: headline, text, facts, when and where, price
  const bl = t.card && Array.isArray(t.card.blocks) ? t.card.blocks : [];
  const out = [];
  (function walk(v) { if (typeof v === 'string') { if (!/^(m_|https?:)/.test(v)) out.push(v); } else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); })(bl);
  return out.join(' ');
}
function renderHistory() {
  const q = ($('#search').value || '').trim().toLowerCase();
  const all = historyItems();
  const items = q ? all.filter((t) => q.split(/\s+/).every((w) => searchText(t).includes(w))) : all;
  if (!S.hsel || !items.some((t) => t.task_id === S.hsel)) S.hsel = items.length ? items[0].task_id : null;
  const ol = $('#hlist');
  fill(ol, ...(items.length ? items.map((t) => rowFor(t, { history: true }))
    : [h('li', { class: 'list-empty', role: 'presentation' }, q ? 'Nothing answered matches “' + q + '”.' : S.historyDeep ? 'Nothing answered yet.' : 'Loading…')]),
    S.historyNote ? h('li', { class: 'list-empty', role: 'presentation' }, S.historyNote) : null);
  ol.setAttribute('aria-activedescendant', S.hsel ? 'h-' + S.hsel : '');
  const selEl = S.hsel && document.getElementById('h-' + S.hsel); if (selEl) selEl.scrollIntoView({ block: 'nearest' });
  const t = items.find((x) => x.task_id === S.hsel);
  const pane = $('#hcard');
  if (!t) { fill(pane, h('div', { class: 'empty' }, h('h2', null, q ? 'No match.' : S.historyDeep ? 'Nothing answered yet.' : 'Loading what you answered…'),
    h('p', null, 'Each ask you answer is kept here with your answer and its notes, newest first.'))); return; }
  const r = t.reply || {}, s = t.step || {};
  const kids = [h('button', { class: 'linkish back', type: 'button', onclick: () => closeReading() }, '← The list'),
    brandLine(t, null),   // the mark in its answered state, the name and the domain; History draws no dressing
    whoBlock(t, h('span', { class: 'label' }, 'Answered')),
    h('div', { class: 'ai-says' }, h('span', { class: 'label' }, 'An AI asked'), h('span', { class: 'label' }, '· ' + KIND_WORD[kindOf(t)])),
    h('h2', { class: 'card-title' }, refs(t, t.title, false) || 'An ask')];
  const blocks = blocksFor(t, 0, undefined, false); if (blocks) kids.push(blocks);
  const media = mediaFor(t); if (media) kids.push(media);
  if (kindOf(t) === 'command') kids.push(h('div', { class: 'cmd' }, h('pre', null, s.command || '')));
  else if (s.text) kids.push(h('div', { class: 'ask-words' }, h('p', null, linked(refs(t, s.text, false)))));
  if (kindOf(t) === 'link' && s.url) kids.push(h('p', { class: 'cmd-where' }, s.url));
  if (t.unlocks) kids.push(h('div', { class: 'unlocks' }, h('span', { class: 'label' }, 'After your answer, in its words'), h('p', { class: 'its-words' }, '“', refs(t, t.unlocks, false), '”')));
  kids.push(h('div', { class: 'sent-as' }, h('span', { class: 'label' }, 'Your answer · ' + when(r.at)), h('p', null, historyAnswer(t)),
    r.action === 'approve' && r.approved_text && r.approved_text !== s.text ? h('p', null, '“' + r.approved_text + '”') : null,
    (r.action === 'approve' || r.action === 'deny') && r.device_approved === false ? h('p', { class: 'help' }, 'Sent without a device signature: the AI sees it carries no device mark.') : null,
    (r.action === 'approve' || r.action === 'deny') && r.device_approved === true ? h('p', { class: 'help' }, 'Signed by your device.') : null,
    r.note ? h('p', null, 'Your note: ' + r.note) : null));
  if (Array.isArray(t.notes) && t.notes.length) kids.push(h('section', { class: 'notes' }, h('span', { class: 'label' }, 'Notes'),
    h('ol', { class: 'thread' }, t.notes.map((n) => noteLine(n, t, n.at ? fmtClock.format(ms(n.at)) : '')))));
  fill(pane, h('article', { class: 'card' }, kids));
}
$('#search').addEventListener('input', () => renderHistory());
$('#search').addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); if (ev.target.value) { ev.target.value = ''; renderHistory(); } else $('#hlist').focus(); } if (ev.key === 'ArrowDown' || ev.key === 'Enter') { ev.preventDefault(); $('#hlist').focus(); } });

/* ---------- Your AIs ---------- */
async function patchConn(c, body, btn) {
  if (btn) btn.disabled = true;
  try { const r = await api('PATCH', '/v1/member/connections/' + enc(c.id), body); Object.assign(c, body, r && typeof r === 'object' ? r : {}); sr(c.name + ': ' + (body.quiet !== undefined ? (body.quiet ? 'quiet' : 'not quiet') : (body.blocked ? 'blocked' : 'unblocked')) + '.'); }
  catch (e) { S.aiMsg = { bad: true, text: c.name + ': ' + e.message }; }
  renderAIs(); loadConns();
}
function revokeConn(c) {
  confirmBox('Revoke ' + c.name + '?', 'Its key and link stop at once' + (c.asks_waiting ? ', and its ' + c.asks_waiting + ' open ' + (c.asks_waiting === 1 ? 'ask is' : 'asks are') + ' withdrawn' : '') + '. To let it ask again you would connect it anew.', 'Revoke ' + c.name, async () => {
    try { await api('DELETE', '/v1/member/connections/' + enc(c.id)); S.aiMsg = { text: c.name + ' is revoked. Its key no longer works.' }; }
    catch (e) { S.aiMsg = { bad: true, text: c.name + ': ' + e.message }; }
    await loadConns(); refresh(true);
  });
}
function renderAIs() {
  const root = $('#view-ais');
  const live = (S.conns || []).filter((c) => !c.revoked_at), gone = (S.conns || []).filter((c) => c.revoked_at);
  const kids = [h('h2', { class: 'page-h' }, 'Your AIs'),
    h('p', { class: 'page-lede' }, 'Each AI you connect gets its own key. The key does one thing: it lets that AI ask you, and read your answers. Quiet: its asks still arrive here but never ring a phone. Block: it hears only "not available". Revoke: its key stops at once and its open asks are withdrawn.')];
  if (S.aiMsg) { // stays 8 s, whatever redraws the page meanwhile
    if (!S.aiMsg.until) S.aiMsg.until = Date.now() + 8000;
    if (Date.now() < S.aiMsg.until) kids.push(h('p', { class: S.aiMsg.bad ? 'error' : 'saved', role: 'status' }, S.aiMsg.text)); else S.aiMsg = null;
  }
  if (S.shownOnce) kids.push(shownOnceBox(S.shownOnce));
  if (S.conns === null) kids.push(h('p', { class: 'help' }, S.connsErr || 'Loading…'));
  else if (!live.length) kids.push(h('p', null, 'No AI is connected yet.'));
  else kids.push(h('table', { class: 'ai-table' },
    h('thead', null, h('tr', null, h('th', { class: 'label' }, 'AI'), h('th', { class: 'label' }, 'Waiting'), h('th', { class: 'label' }, 'Last asked'),
      h('th', { class: 'label' }, 'Connected'), h('th', { class: 'label' }, h('span', { class: 'sr' }, 'Actions')))),
    h('tbody', null, live.map((c) => h('tr', null,
      h('td', { class: 'name' }, aiMark(c), c.name, c.quiet ? h('span', { class: 'state' }, 'Quiet') : null, c.blocked ? h('span', { class: 'state blocked' }, 'Blocked') : null, aiBrandWords(c)),
      h('td', { class: 'n' }, String(c.asks_waiting ?? '')),
      h('td', { class: 'when', title: c.last_used_at ? when(c.last_used_at) : '' }, agoWords(c.last_used_at)),
      h('td', { class: 'when' }, c.made_at ? fmtDay.format(ms(c.made_at)) : ''),
      h('td', { class: 'acts' },
        h('button', { class: 'btn btn-quiet' + (c.quiet ? ' toggled' : ''), type: 'button', 'aria-pressed': c.quiet ? 'true' : 'false', onclick: (ev) => patchConn(c, { quiet: !c.quiet }, ev.currentTarget) }, c.quiet ? 'Quiet' : 'Quiet'),
        h('button', { class: 'btn btn-quiet' + (c.blocked ? ' toggled' : ''), type: 'button', 'aria-pressed': c.blocked ? 'true' : 'false', onclick: (ev) => patchConn(c, { blocked: !c.blocked }, ev.currentTarget) }, 'Block'),
        h('button', { class: 'btn btn-stop', type: 'button', onclick: () => revokeConn(c) }, 'Revoke')))))));
  kids.push(h('h3', { class: 'sec-h' }, 'Connect an AI'));
  kids.push(connectForm());
  if (S.blocks === undefined || S.blocks === null) loadBlocks();
  else if (S.blocks.length) kids.push(h('h3', { class: 'sec-h' }, 'Blocked callers'),
    h('p', { class: 'help' }, 'Askers you blocked from a call or an ask. Each is told only that you are not available.'),
    h('table', { class: 'ai-table' }, h('tbody', null, S.blocks.map((b) => h('tr', null,
      h('td', { class: 'name' }, iconFor(null, b.name), b.name), h('td', { class: 'when' }, b.since ? 'since ' + fmtDay.format(ms(b.since)) : ''),
      h('td', { class: 'acts' }, h('button', { class: 'btn btn-quiet', type: 'button', onclick: (ev) => { ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Unblocking…'; unblock(b); } }, 'Unblock')))))));
  if (SEND_ON) {
    if (S.mutes === undefined || S.mutes === null) loadMutes();
    else if (S.mutes.length) kids.push(h('h3', { class: 'sec-h' }, 'Muted people'),
      h('p', { class: 'help' }, 'People whose asks never ring you. Their asks still show here.'),
      h('table', { class: 'ai-table' }, h('tbody', null, S.mutes.map((m) => h('tr', null,
        h('td', { class: 'name' }, iconFor(null, m.name || 'Someone', true), m.name || 'Someone'), h('td', { class: 'when' }, m.since ? 'since ' + fmtDay.format(ms(m.since)) : ''),
        h('td', { class: 'acts' }, h('button', { class: 'btn btn-quiet', type: 'button', onclick: (ev) => { ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Unmuting…'; unmute(m); } }, 'Unmute')))))));
  }
  if (gone.length) kids.push(h('details', null, h('summary', { class: 'sec-h' }, 'Revoked (' + gone.length + ')'),
    h('table', { class: 'ai-table' }, h('tbody', null, gone.map((c) => h('tr', { class: 'revoked' },
      h('td', { class: 'name' }, iconFor(c.icon, c.name), c.name), h('td', { class: 'when' }, 'revoked ' + fmtDay.format(ms(c.revoked_at)))))))));
  fill(root, h('div', { class: 'page-in' }, kids));
}
function connectForm() {
  const name = h('input', { type: 'text', id: 'c-name', minlength: '2', maxlength: '40', placeholder: 'Home camera, My assistant…', autocomplete: 'off', required: true });
  const emoji = h('input', { type: 'text', class: 'emoji-in', maxlength: '4', 'aria-label': 'Or one emoji', placeholder: '🙂' });
  const opts = ['home', 'chef', 'car', 'business', 'lab', 'other'].map((k, i) => h('label', null,
    h('input', { type: 'radio', name: 'c-icon', value: k, checked: i === 5 }), iconFor(k, k), k === 'business' ? 'Work' : k[0].toUpperCase() + k.slice(1)));
  const msg = h('p', { class: 'error', role: 'alert', hidden: true });
  const btn = h('button', { class: 'btn btn-you', type: 'submit' }, 'Connect');
  const form = h('form', { class: 'form', autocomplete: 'off' },
    h('label', null, h('span', { class: 'label' }, 'Its name, as you will see it'), name),
    h('fieldset', { class: 'icons' }, h('legend', { class: 'label' }, 'Its icon'), opts, h('label', { class: 'emoji-l' }, 'or', emoji)),
    msg, h('div', null, btn), h('p', { class: 'help' }, 'You get a key and a link, shown once, and the words to give your AI. Copy them before you leave this page.'));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault(); msg.hidden = true;
    const n = name.value.trim(); if (!n) { msg.textContent = 'Give it a name you will recognise.'; msg.hidden = false; name.focus(); return; }
    const icon = emoji.value.trim() || (form.querySelector('input[name="c-icon"]:checked') || {}).value || 'other';
    btn.disabled = true; btn.textContent = 'Connecting…';
    try {
      const r = await api('POST', '/v1/member/connections', { name: n, icon });
      S.shownOnce = r; await loadConns(); renderAIs();
      const box = $('.shown-once'); if (box) box.scrollIntoView({ block: 'start' });
    } catch (e) { msg.textContent = e.message; msg.hidden = false; btn.disabled = false; btn.textContent = 'Connect'; }
  });
  return form;
}
function shownOnceBox(r) {
  const how = r.how || {};
  const ex = Array.isArray(how.step_examples) ? how.step_examples : [];
  const prompt = ['You can ask me things through person.tools when you need my decision or an answer only I can give.',
    '', how.key_use || '', '', 'Your key: ' + (r.key || ''), r.link ? 'Your link: ' + r.link : '', how.link_use || '',
    ex.length ? '\nSteps you can send, for example:\n' + ex.map((e) => JSON.stringify(e)).join('\n') : '',
    '\nUrgency: ' + ((r.urgencies || ['now', 'today', 'whenever']).join(', ')) + '. Never put a password, a code or a key in an ask.'].filter((x) => x !== '').join('\n');
  const row = (label, value) => value ? h('div', { class: 'secret' }, h('span', { class: 'label' }, label), h('code', null, value),
    h('button', { class: 'btn', type: 'button', onclick: (ev) => copyText(value, ev.currentTarget) }, 'Copy')) : null;
  return h('section', { class: 'shown-once', role: 'region', 'aria-label': 'New connection, shown once' },
    h('h3', null, r.name + ' is connected. Copy these now: they are shown once.'),
    h('p', { class: 'help' }, 'Give them to ' + r.name + ' only. The Desk does not keep them; when you close this box they are gone from this screen.'),
    row('Key', r.key), row('Link', r.link), row('Webhook secret', r.webhook_secret),
    h('div', { class: 'prompt-box' }, h('div', { class: 'row-l' }, h('span', { class: 'label' }, 'Words to give your AI, key included'),
      h('button', { class: 'btn btn-quiet', type: 'button', onclick: (ev) => copyText(prompt, ev.currentTarget) }, 'Copy the words')), h('pre', null, prompt)),
    h('p', null, h('button', { class: 'btn', type: 'button', onclick: () => { S.shownOnce = null; renderAIs(); } }, 'I have copied them; close')));
}

/* ---------- Settings ---------- */
async function patchSettings(body, note) {
  try {
    let r;
    try { r = await api('PATCH', '/v1/member/settings', body); }
    catch (e) { // a server that reads longer_hold out but takes it in under its older name, longer_to_answer
      if (e.status === 400 && e.code === 'unknown_field' && 'longer_hold' in body) r = await api('PATCH', '/v1/member/settings', { longer_to_answer: body.longer_hold });
      else throw e;
    }
    S.settings = r; S.setMsg = { text: note || 'Saved.' };
  }
  catch (e) { S.setMsg = { bad: true, text: e.message }; }
  renderSettings();
}
function hourName(hh) { const d = new Date(2026, 0, 1, hh, 0); return fmtClock.format(d); }
function renderSettings() {
  const root = $('#view-settings');
  const st = S.settings || {}, set = st.settings || {}, q = st.quiet || {};
  const seg = (items, cur, onpick, label) => h('div', { class: 'seg', role: 'group', 'aria-label': label },
    items.map(([v, l]) => h('button', { type: 'button', 'aria-pressed': cur === v ? 'true' : 'false', onclick: () => onpick(v) }, l)));
  const hours = (cur, onch, label) => { const s = h('select', { 'aria-label': label, onchange: (ev) => onch(Number(ev.target.value)) },
    Array.from({ length: 24 }, (_, i) => h('option', { value: String(i), selected: i === cur }, hourName(i)))); return s; };
  const days = [1, 3, 7, 14, 30];
  const kids = [h('h2', { class: 'page-h' }, 'Settings'),
    h('p', { class: 'page-lede' }, 'These are private: no AI sees them, and they never decide who is asked first.')];
  if (S.setMsg) { kids.push(h('p', { class: S.setMsg.bad ? 'error' : 'saved', role: 'status' }, S.setMsg.text)); S.setMsg = null; }
  if (!S.settings) kids.push(h('p', { class: 'help' }, 'Loading…'));
  else {
    kids.push(h('div', { class: 'set' }, h('div', { class: 'k' }, 'Sounds', h('p', { class: 'help' }, 'The Desk never makes a sound. This is for every app of yours on person.tools.')),
      h('div', null, seg([[false, 'Off'], [true, 'On']], !!set.sounds, (v) => patchSettings({ sounds: v }, v ? 'Sounds on: your phone may make a sound for an urgent ask.' : 'Sounds off: nothing of ours makes a sound for you.'), 'Sounds'))));
    // OWNER_router_25: the ask's first line in this person's own alerts, off unless they turn it on; shown once the service has it
    const aw = typeof set.alert_words === 'boolean' ? set.alert_words : typeof st.alert_words === 'boolean' ? st.alert_words : null;
    // the same words as the person's page, since the setting is theirs on every app
    if (aw !== null) kids.push(h('div', { class: 'set' }, h('div', { class: 'k' }, 'Show the ask in my alerts', h('p', { class: 'help' },
      'Off: an alert says only who is asking. On: it may also show the ask\u2019s first line, up to 80 characters, never the whole ask. Your phone\u2019s own preview setting still decides what shows on a locked screen.')),
      h('div', null, seg([[false, 'Off'], [true, 'On']], aw, (v) => patchSettings({ alert_words: v }, v ? 'Alerts may show the first line of an ask.' : 'Alerts will say only who is asking.'), 'Show the ask in my alerts'))));
    if (typeof set.longer_hold === 'boolean') kids.push(h('div', { class: 'set' }, h('div', { class: 'k' }, 'Give me more time to take a call', h('p', { class: 'help' },
      'A call held for you for less than 3 minutes is held for 3 instead. Useful with a screen reader, or whenever you like. No asker sees this.')),
      h('div', null, seg([[false, 'Off'], [true, 'On']], set.longer_hold, (v) => patchSettings({ longer_hold: v }, v ? 'Calls will wait 3 minutes for you.' : 'Calls wait the usual time.'), 'Give me more time to take a call'))));
    kids.push(h('div', { class: 'set' }, h('div', { class: 'k' }, 'Quiet hours', h('p', { class: 'help' }, 'No call rings you in these hours.' + (q.tz ? ' Zone: ' + q.tz + '.' : ''))),
      h('div', null, 'From ', hours(q.start, (v) => patchSettings({ quiet_start: v }, 'Quiet hours saved.'), 'Quiet from'), ' to ', hours(q.end, (v) => patchSettings({ quiet_end: v }, 'Quiet hours saved.'), 'Quiet until'))));
    kids.push(h('div', { class: 'set' }, h('div', { class: 'k' }, 'Photos and clips', h('p', { class: 'help' }, 'What your AIs send is yours. It is deleted after this many days.')),
      h('div', null, h('select', { 'aria-label': 'Days to keep photos and clips', onchange: (ev) => patchSettings({ material_days: Number(ev.target.value) }, 'Saved.') },
        (days.includes(set.material_days) ? days : days.concat([set.material_days]).sort((a, b) => a - b)).filter((x) => x).map((dd) => h('option', { value: String(dd), selected: dd === set.material_days }, dd + (dd === 1 ? ' day' : ' days')))))));
  }
  kids.push(onRow());
  kids.push(limitsRow());
  const theme = pref('theme', 'system');
  kids.push(h('div', { class: 'set' }, h('div', { class: 'k' }, 'Look', h('p', { class: 'help' }, 'On this computer only.')),
    h('div', null, seg([['system', 'Like this computer'], ['light', 'Light'], ['dark', 'Dark']], theme, (v) => { setPref('theme', v); applyTheme(); renderSettings(); }, 'Look'))));
  const pr = passkeyRow(); if (pr) kids.push(pr);
  const how = /^ps_/.test(S.cred || '') ? 'Signed in with your passkey' + (S.memberLabel ? ', for ' + S.memberLabel : '') + '. '
    : /^ds_/.test(S.cred || '') ? 'Signed in with your phone; it can sign this computer out too (Menu, Computers signed in). ' : 'Signed in with your page link. ';
  kids.push(h('div', { class: 'set' }, h('div', { class: 'k' }, 'This computer', h('p', { class: 'help' }, how + (S.remember ? 'Remembered here until you sign out.' : 'Kept for this tab only; closing it signs you out.'))),
    h('div', null, h('button', { class: 'btn btn-stop', type: 'button', onclick: () => askSignOut() }, 'Sign out'),
      h('p', { class: 'help' }, 'Signing out removes the link and everything the Desk kept on this computer.'))));
  const where = S.memberLabel || 'this page';
  kids.push(h('div', { class: 'set' }, h('div', { class: 'k' }, 'Leave', h('p', { class: 'help' }, 'Ends your membership of ' + where + ' for good and deletes what it holds of yours. You are asked to type a word first.')),
    h('div', null, h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => openLeave() }, 'Leave ' + where + '…'))));
  fill(root, h('div', { class: 'page-in' }, kids));
}
function applyTheme() { const v = pref('theme', 'system'); if (v === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); themeChanged(); }
// a branded card's dressing and its colour checks belong to one mode (CARD-4, CARD-5): draw again when the mode changes
function themeChanged() { if (!S.cred) return; S.cardSig = ''; render(); if (S.view === 'ais') renderAIs(); }
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeChanged);

/* ---------- A person as asker: My people, Send, Sent (OWNER_web_3; spec section 2 and 8.1; SERVICE's router_18) ----------
   Switched on by <meta name="desk-send"> once the routes are live. */
const SEND_ON = (document.querySelector('meta[name="desk-send"]') || {}).content === 'on';
// Send shows only to a person who owns a panel of people: GET /v1/member/people names them ("name") or lists someone.
// Everyone else (a person who joined someone's panel) never sees a Send that could reach nobody.
const canSend = () => SEND_ON && S.isOwner === true;
const canPass = () => PASS_ON && S.isOwner === true;
function saveOwner() {
  // Remembered beside the credential so Send, Sent and Pass on are drawn on the first frame, not seconds later
  if (S.isOwner === null || !S.cred) return;
  const keep = S.remember ? 'local' : 'session', drop = S.remember ? 'session' : 'local';
  sset(keep, 'desk.owner', S.isOwner ? '1' : '0'); sdel(drop, 'desk.owner');
}
// A page made for oneself (own_page, SERVICE 4:08 PM CT 16 Nov) has nobody to send to: nobody can join it, so no Send there
function noteOwnPage(v) {
  if (typeof v !== 'boolean' || v === S.ownPage) return;
  const was = S.ownPage; S.ownPage = v;
  if (v && S.isOwner !== false) { S.isOwner = false; applySendSwitch(); saveOwner(); S.cardSig = ''; if (!$('#desk').hidden) render(); }
  else if (!v && was === true && (SEND_ON || PASS_ON)) loadPeople(true);   // only a page that stopped being one's own looks again
}
function cachedOwner() { const v = sget('session', 'desk.owner') || sget('local', 'desk.owner'); return v === '1' ? true : v === '0' ? false : null; }
function applySendSwitch() {
  const on = canSend();
  document.documentElement.classList.toggle('send-on', on);
  for (const el of $$('.send-only')) el.hidden = !on;
}
const personId = (p) => p.member_id || p.id || null;
const personBase = (p) => p.name || p.alias || p.display_name || p.name_on_panel || 'Someone';
function personName(p) {
  // Two people with the same name are told apart by when they joined
  const base = personBase(p), same = (S.people || []).filter((x) => personBase(x) === base);
  return same.length > 1 && p.joined_at ? base + ' · joined ' + fmtDay.format(ms(p.joined_at)) + ' ' + fmtClock.format(ms(p.joined_at)) : base;
}
function personJoined(p) {
  if (typeof p.joined === 'boolean') return p.joined;
  if (typeof p.state === 'string') return /^joined|^member|^active/i.test(p.state);
  return !!(p.joined_at || (p.member_id && !p.join_url));
}
function loadPeople(force) {
  // One look at a time: a press of S, P or My people while one is on its way waits for it instead of asking again.
  // After making a link, force a fresh look.
  if (!force && S.peopleP) return S.peopleP;
  const p = loadPeopleNow(); S.peopleP = p;
  p.finally(() => { if (S.peopleP === p) S.peopleP = null; });
  return p;
}
async function loadPeopleNow() {
  if (!SEND_ON && !PASS_ON) return;
  try {
    // GET /v1/member/people answers {people: [joined], waiting: [links not used yet], note}
    const r = await api('GET', '/v1/member/people');
    if (Array.isArray(r)) S.people = r;
    else S.people = (r.people || r.members || []).map((p) => Object.assign({ joined: p.joined === undefined ? true : p.joined }, p))
      .concat((r.waiting || []).map((w) => Object.assign({}, w, { joined: false })));
    S.peopleNote = (r && r.note) || null; S.peopleErr = null;
    const owner = (!!(r && !Array.isArray(r) && r.name) || S.people.length > 0) && S.ownPage !== true;
    if (owner !== S.isOwner) { S.isOwner = owner; applySendSwitch(); S.cardSig = ''; if (!$('#desk').hidden) render(); }
    if (!$('#desk').hidden) saveOwner();
    if (r && typeof r.name === 'string' && r.name) S.myName = r.name; // the sender's name as person.tools checked it on the account
  }
  catch (e) { if (e.code === 'signed_out') return; S.peopleErr = e.message; if (!S.people) S.people = []; }
  if (S.view === 'people') renderPeople();
  if (!$('#compose').hidden && S.compose) renderCompose();
}
function nameOfMember(id) { const p = (S.people || []).find((x) => personId(x) === id); return p ? personName(p) : null; }
function threadName(t) {
  const to = t.to && typeof t.to === 'object' ? t.to : null;
  return t.to_name || (to && (to.name || to.alias || to.display_name)) || nameOfMember((to && to.member_id) || t.to || t.member_id) || 'Someone';
}
function normalizeSent(r) {
  // GET /v1/member/sent: each ask with its threads. Read either form: sends with threads, or one task per person.
  // GET /v1/member/sent answers {sent: [...], passed: [...]}: what was sent, and what was passed on (its answer comes back here)
  const items = Array.isArray(r) ? r : ((r && (r.sent || r.asks || r.items)) || []).concat(((r && r.passed) || []).map((x) => Object.assign({ _passed: true }, x)));
  const sends = [];
  if (items.some((x) => Array.isArray(x.threads))) {
    for (const x of items) sends.push({ key: x.send_id || x.id || (x.threads[0] && x.threads[0].task_id), title: x.title, step: x.step || {}, card: x.card,
      created_at: x.created_at, expires_at: x.expires_at, urgency: x.urgency,
      threads: x.threads.map((t) => Object.assign({ step: x.step || {}, title: x.title }, t)) });
  } else {
    const by = new Map();
    for (const t of items) {
      const k = t.send_id || t.batch_id || [t.title, JSON.stringify(t.step || {}), String(t.created_at || '').slice(0, 16)].join('|');
      if (!by.has(k)) by.set(k, { key: k, title: t.title, step: t.step || {}, card: t.card, created_at: t.created_at, expires_at: t.expires_at, urgency: t.urgency,
        passed: !!t._passed, from: t._passed ? (t.from && typeof t.from === 'object' ? t.from.name : t.from) : null, at: t.passed_at || t.created_at, threads: [] });
      by.get(k).threads.push(t);
    }
    sends.push(...by.values());
  }
  return sends.sort((a, b) => ms(b.at || b.created_at) - ms(a.at || a.created_at));
}
// The key changes when an answer or a note arrives. Since 8:01 PM CT the service's "new" holds until the sender marks the
// thread read (POST /v1/member/sent/read), on any device, so the Desk follows it; what this computer has shown stays read
// here, and a thread with no "new" (one passed on) is news until shown.
const threadNewsKey = (t) => t.task_id + ':' + (t.reply ? (t.answered_at || t.reply.at || 'r') : (t.state || '')) + ':' + ((t.notes || []).length);
function threadHasNews(t) {
  if (S.sentSeen.has(threadNewsKey(t))) return false;
  if (typeof t.new === 'boolean') return t.new;
  const notes = t.notes || [], last = notes[notes.length - 1];
  return !!t.reply || !!(last && last.by !== 'asker');
}
const readPosted = new Set();
function markSentRead(threads) {
  // tell the service these answers were read, so the phone and the page stop showing them as new too
  const ids = threads.filter((t) => t.new === true && !t._passed && !readPosted.has(t.task_id + ':' + threadNewsKey(t))).map((t) => t.task_id);
  if (!ids.length) return;
  for (const t of threads) if (ids.includes(t.task_id)) readPosted.add(t.task_id + ':' + threadNewsKey(t));
  api('POST', '/v1/member/sent/read', { task_ids: ids }).then(() => { for (const t of threads) if (ids.includes(t.task_id)) t.new = false; renderSentCount(); }).catch(() => {});
}
const threadOpen = (t) => !t.reply && (!t.state || t.state === 'open' || t.state === 'waiting');
function sentSeenKey() { return 'desk.sentseen.' + (S.memberId || 'x'); }
function loadSentSeen() { try { const v = sget('local', sentSeenKey()); S.sentSeenFresh = v == null; S.sentSeen = new Set(JSON.parse(v || '[]')); } catch (e) { S.sentSeen = new Set(); } }
function markThreadSeen(t) { if (!t) return; S.sentSeen.add(threadNewsKey(t)); sset('local', sentSeenKey(), JSON.stringify([...S.sentSeen].slice(-3000))); }
async function loadSent() {
  if (!SEND_ON) return;
  try {
    S.sent = normalizeSent(await api('GET', '/v1/member/sent')); S.sentErr = null;
    if (S.sentSeenFresh) {
      // First look on this computer: older answers are not news; only what the service still calls new is
      S.sentSeenFresh = false;
      for (const x of S.sent) for (const t of x.threads) if (t.new !== true) S.sentSeen.add(threadNewsKey(t));
      sset('local', sentSeenKey(), JSON.stringify([...S.sentSeen].slice(-3000)));
    }
  }
  catch (e) { if (e.code === 'signed_out') return; S.sentErr = e.message; if (!S.sent) S.sent = []; }
  renderSentCount();
  if (S.view === 'sent') renderSent();
  if (S.view === 'asks') renderList();
}
function sentNews() {
  const out = [];
  for (const s of S.sent || []) for (const t of s.threads) if (threadHasNews(t)) out.push({ send: s, thread: t });
  return out;
}
function renderSentCount() {
  const c = $('#count-sent'); if (!c) return;
  const n = sentNews().length; c.textContent = n; c.classList.toggle('zero', n === 0);
}
function replyWords(t) {
  const r = t.reply || {};
  if (!t.reply) { const st = t.state || 'open'; return st === 'lapsed' ? 'It closed unanswered.' : st === 'not_now' ? 'Not now' : 'Not answered yet'; }
  // From the sender's side: what they answered, in plain words
  const sp = t.step || {};
  if (r.action === 'answer') return r.choice != null ? 'Picked: ' + r.choice : r.text ? 'Wrote: ' + r.text : 'Answered';
  if (r.action === 'done') return 'Done';
  if (r.action === 'not_now') return 'Not now';
  if (r.action === 'approve') return (sp.approve_label || 'Approved') + (r.approved_text && r.approved_text !== sp.text ? ', with their own words: “' + r.approved_text + '”' : '');
  if (r.action === 'deny') return sp.deny_label || 'Denied';
  return 'Answered';
}

/* My people */
function renderPeople() {
  const root = $('#view-people');
  const list = S.people || [];
  const joined = list.filter(personJoined), waiting = list.filter((p) => !personJoined(p));
  const kids = [h('h2', { class: 'page-h' }, 'My people'),
    h('p', { class: 'page-lede' }, 'The people who joined from a link you sent. Your asks reach them as "From" your name, which their app takes from your account, never from what you type. Each can mute you, block you or leave at any time.')];
  if (S.people === null) { kids.push(h('p', { class: 'help' }, 'Loading…')); loadPeople(); }
  else if (S.peopleErr && !list.length) kids.push(h('p', { class: 'error' }, 'Your people could not be read: ' + S.peopleErr));
  else if (!list.length) kids.push(h('p', null, S.peopleNote || 'Nobody yet. When someone joins from a link you sent, they appear here.'));
  if (joined.length) kids.push(h('h3', { class: 'sec-h' }, 'Joined (' + joined.length + ')'),
    h('table', { class: 'ai-table' }, h('tbody', null, joined.map((p) => h('tr', null,
      h('td', { class: 'name' }, iconFor(null, personBase(p)), personBase(p)),
      h('td', { class: 'when' }, p.joined_at ? 'joined ' + fmtDay.format(ms(p.joined_at)) + (personName(p) !== personBase(p) ? ' ' + fmtClock.format(ms(p.joined_at)) : '') : 'joined'),
      h('td', { class: 'acts' }, h('button', { class: 'btn btn-quiet', type: 'button', 'aria-label': 'Send to ' + personName(p), onclick: () => openCompose([personId(p)]) }, 'Send')))))));
  if (waiting.length) kids.push(h('h3', { class: 'sec-h' }, 'Not joined yet (' + waiting.length + ')'),
    h('p', { class: 'help' }, 'Their link has not been used yet. If you sent it, they move up here once they join. ' + (S.peopleNote || 'A link is shown only once: make a fresh one to send again (the old one stops).')),
    h('table', { class: 'ai-table' }, h('tbody', null, waiting.map((p) => {
      // "resend" is the route that makes a fresh link ({method, path, body}); a plain address is copied as it is
      const url = [p.resend, p.join_url, p.link].find((x) => typeof x === 'string' && /^https:\/\//.test(x));
      const label = (p.resend && p.resend.body && p.resend.body.label) || personBase(p);
      return h('tr', null,
        h('td', { class: 'name' }, iconFor(null, personName(p)), personName(p)),
        h('td', { class: 'when' }, p.sent_at || p.made_at ? 'link made ' + fmtDay.format(ms(p.sent_at || p.made_at)) + ' ' + fmtClock.format(ms(p.sent_at || p.made_at)) : ''),
        h('td', { class: 'acts' }, url
          ? h('button', { class: 'btn btn-quiet', type: 'button', onclick: (ev) => copyText(url, ev.currentTarget) }, 'Copy their link')
          : h('button', { class: 'btn btn-quiet', type: 'button', 'aria-label': 'Make a fresh link for ' + personName(p), onclick: () => {
            // the old link may already be in their messages: say it stops before it does (OWNER_router_23 kept the links already sent)
            confirmBox('Make a fresh link for ' + personName(p) + '?', 'The link made ' + (p.sent_at ? fmtDay.format(ms(p.sent_at)) + ' ' + fmtClock.format(ms(p.sent_at)) : 'before') +
              ' stops working. If you already sent it to ' + personName(p) + ', send them the new one instead.', 'Make a fresh link', async () => {
              try { S.invite = { label: '', made: await api('POST', '/v1/member/people/links', { label }), msg: null }; loadPeople(true); }
              catch (e) { S.invite = { label: '', made: null, msg: e.message }; }
              renderPeople(); setTimeout(() => { const c = $('#view-people .invite'); if (c) c.scrollIntoView({ block: 'nearest' }); }, 0);
            }); } }, 'Make a fresh link')));
    }))));
  kids.push(inviteBox());
  fill(root, h('div', { class: 'page-in' }, kids));
}
/* Invite someone: POST /v1/member/people/links {label} -> {label, join_url, for_them, note}; a link works once */
function inviteBox() {
  const inv = S.invite || (S.invite = { label: '', made: null, msg: null });
  const name = h('input', { type: 'text', id: 'inv-name', maxlength: '40', placeholder: 'Their name, as you call them', value: inv.label, autocomplete: 'off', oninput: (ev) => { inv.label = ev.target.value; } });
  const kids = [h('h3', { class: 'sec-h' }, 'Invite someone'),
    h('p', { class: 'help' }, 'You get a link that works once. Send it yourself, by text or email; when they join, they appear above.'),
    h('form', { class: 'row-l invite-row', onsubmit: async (ev) => {
      ev.preventDefault(); const v = inv.label.trim(); if (v.length < 2) { inv.msg = 'Write their name first.'; renderPeople(); return; }
      const make = async () => {
        try { inv.made = await api('POST', '/v1/member/people/links', { label: v }); inv.msg = null; inv.label = ''; loadPeople(true); }
        catch (e) { inv.msg = e.message; }
        renderPeople();
      };
      // a link for a name that already has an unused one stops that one: it may already be in their messages
      const clash = (S.people || []).filter((p) => !personJoined(p)).find((p) => personBase(p).trim().toLowerCase() === v.toLowerCase());
      if (clash) { confirmBox('A new link for ' + personBase(clash) + '?', personBase(clash) + ' already has a link that has not been used. A new one stops it: if you already sent it, send them the new one instead.', 'Make a new link', make); return; }
      await make();
    } }, name, h('button', { class: 'btn', type: 'submit' }, 'Make their link'))];
  if (inv.msg) kids.push(h('p', { class: 'error' }, inv.msg));
  if (inv.made && inv.made.join_url) {
    const m = inv.made;
    kids.push(h('div', { class: 'shown-once' }, h('h3', null, 'A link for ' + (m.label || 'them')),
      h('div', { class: 'secret' }, h('span', { class: 'label' }, 'Their link'), h('code', null, m.join_url), h('button', { class: 'btn', type: 'button', onclick: (ev) => copyText(m.join_url, ev.currentTarget) }, 'Copy')),
      m.for_them ? h('div', { class: 'prompt-box' }, h('div', { class: 'row-l' }, h('span', { class: 'label' }, 'A message you can send with it'), h('button', { class: 'btn btn-quiet', type: 'button', onclick: (ev) => copyText(m.for_them, ev.currentTarget) }, 'Copy the message')), h('pre', null, m.for_them)) : null,
      m.note ? h('p', { class: 'help' }, m.note) : null,
      h('p', null, h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => { inv.made = null; renderPeople(); } }, 'Done'))));
  }
  return h('section', { class: 'invite' }, kids);
}

/* Send: compose, preview, a five-second undo, then the POST */
const SEND_KINDS = [['choice', 'Pick one'], ['words', 'Answer in words'], ['link', 'Open a link'], ['approve', 'Approve or deny'], ['command', 'Run a command']];
const DUE = [['', 'No deadline'], ['900', 'in 15 minutes'], ['3600', 'in 1 hour'], ['14400', 'in 4 hours'], ['86400', 'in 1 day'], ['604800', 'in 1 week']];
function openCompose(to) {
  S.compose = S.compose && !to ? S.compose : { to: new Set(to || []), kind: 'choice', title: '', text: '', choices: ['', ''], url: '', command: '', where: '',
    approve_label: '', deny_label: '', editable: false, urgency: 'today', due: '', msg: null };
  if (to) S.compose.to = new Set(to);
  if (S.people === null) loadPeople();
  renderCompose(); openOverlay('#compose');
  setTimeout(() => { const f = $('#c-title'); if (f) f.focus(); }, 0);
}
function composeStep(c) {
  if (c.kind === 'choice') return { type: 'question', text: c.text.trim(), choices: c.choices.map((x) => x.trim()).filter(Boolean) };
  if (c.kind === 'words') return { type: 'question', text: c.text.trim() };
  if (c.kind === 'link') return { type: 'link', url: c.url.trim(), text: c.text.trim() };
  if (c.kind === 'approve') { const s = { type: 'approve', text: c.text.trim() }; if (c.approve_label.trim()) s.approve_label = c.approve_label.trim(); if (c.deny_label.trim()) s.deny_label = c.deny_label.trim(); if (c.editable) s.editable = true; return s; }
  return { type: 'command', command: c.command.trim(), where: c.where.trim() };
}
function composeProblem(c) {
  if (!c.to.size) return 'Pick at least one person.';
  const t = c.title.trim(); if (t.length < 3 || t.length > 120) return 'The title is 3 to 120 characters.';
  const s = composeStep(c);
  if (c.kind === 'choice' && (!s.text || s.choices.length < 2 || s.choices.length > 4)) return 'Write the question and two to four choices.';
  if ((c.kind === 'words' || c.kind === 'approve') && !s.text) return c.kind === 'words' ? 'Write the question.' : 'Write exactly what they approve.';
  if (c.kind === 'link' && !safeUrl(s.url)) return 'The link must be a web address (https://…).';
  if (c.kind === 'command' && !s.command) return 'Write the command.';
  return null;
}
function previewFor(c) {
  // The card as the receiver will see it: drawn by their own app, with your name from your account
  const s = composeStep(c), kids = [h('div', { class: 'pv-from' }, h('span', { class: 'label' }, 'They see'), ' From ', h('b', null, S.myName || 'your name'),
    h('span', { class: 'help' }, ' · ' + ({ now: 'Now', today: 'Today', whenever: 'Whenever' })[c.urgency] + (c.due ? ' · closes ' + DUE.find((d) => d[0] === c.due)[1] : '')))];
  kids.push(h('p', { class: 'pv-title' }, c.title.trim() || 'Your title'));
  if (s.text) kids.push(h('p', { class: 'pv-text' }, s.text));
  if (c.kind === 'choice') kids.push(h('div', { class: 'pv-ans' }, (s.choices.length ? s.choices : ['Choice 1', 'Choice 2']).map((x) => h('span', { class: 'pv-btn' }, x)), h('span', { class: 'pv-btn quiet' }, 'Not now')));
  if (c.kind === 'words') kids.push(h('div', { class: 'pv-ans' }, h('span', { class: 'pv-field' }, 'Their answer'), h('span', { class: 'pv-btn quiet' }, 'Not now')));
  if (c.kind === 'link') kids.push(h('p', { class: 'pv-text mono' }, safeUrl(s.url) ? safeUrl(s.url).host : 'the link'), h('div', { class: 'pv-ans' }, h('span', { class: 'pv-btn' }, 'Done'), h('span', { class: 'pv-btn quiet' }, 'Not now')));
  if (c.kind === 'approve') kids.push(h('div', { class: 'pv-ans' }, h('span', { class: 'pv-btn' }, s.deny_label || 'Deny'), h('span', { class: 'pv-btn' }, s.approve_label || 'Approve'), h('span', { class: 'pv-btn quiet' }, 'Not now')));
  if (c.kind === 'command') kids.push(h('pre', { class: 'pv-cmd' }, s.command || 'the command'), h('div', { class: 'pv-ans' }, h('span', { class: 'pv-btn' }, 'Done'), h('span', { class: 'pv-btn quiet' }, 'Not now')));
  return h('div', { class: 'preview', 'aria-label': 'Preview' }, kids);
}
function renderCompose() {
  const c = S.compose; if (!c) return;
  const body = $('#compose-body');
  const keep = document.activeElement && body.contains(document.activeElement) && document.activeElement.id ? { id: document.activeElement.id, s: document.activeElement.selectionStart, e: document.activeElement.selectionEnd } : null;
  const joined = (S.people || []).filter(personJoined);
  const upd = (k) => (ev) => { c[k] = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value; c.msg = null; fill($('#c-preview'), previewFor(c)); };
  const input = (id, k, ph, max) => h('input', { type: 'text', id, value: c[k], placeholder: ph, maxlength: max || 300, oninput: upd(k), autocomplete: 'off' });
  const area = (id, k, ph) => { const t = h('textarea', { id, rows: 3, placeholder: ph, maxlength: 4000, oninput: upd(k) }); t.value = c[k]; return t; };
  const kids = [];
  kids.push(h('div', { class: 'c-row' }, h('span', { class: 'label' }, 'To'),
    S.people === null ? h('span', { class: 'help' }, 'Loading your people…')
      : !joined.length ? h('span', { class: 'help' }, 'Nobody has joined yet: someone you sent a link to appears here once they join. My people shows who has not joined, and makes links.')
        : h('div', { class: 'c-to', role: 'group', 'aria-label': 'To' }, joined.map((p) => {
          const id = personId(p), on = c.to.has(id);
          return h('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false',
            onclick: () => { if (c.to.has(id)) c.to.delete(id); else c.to.add(id); c.msg = null; renderCompose(); } }, personName(p));
        }), joined.length > 1 ? h('button', { type: 'button', class: 'linkish', onclick: () => { c.to = new Set(joined.map(personId)); renderCompose(); } }, 'everyone') : null)));
  kids.push(h('div', { class: 'c-row' }, h('span', { class: 'label' }, 'Kind'), h('div', { class: 'seg', role: 'group', 'aria-label': 'Kind of ask' },
    SEND_KINDS.map(([k, l]) => h('button', { type: 'button', 'aria-pressed': c.kind === k ? 'true' : 'false', onclick: () => { c.kind = k; c.msg = null; renderCompose(); } }, l)))));
  kids.push(h('label', { class: 'c-field' }, h('span', { class: 'label' }, 'Title'), input('c-title', 'title', 'A few words they see in their list', 120)));
  if (c.kind === 'choice' || c.kind === 'words') kids.push(h('label', { class: 'c-field' }, h('span', { class: 'label' }, 'Question'), area('c-text', 'text', c.kind === 'choice' ? 'What should they choose between?' : 'What do you want to know?')));
  if (c.kind === 'choice') kids.push(h('div', { class: 'c-field' }, h('span', { class: 'label' }, 'Choices (2 to 4)'), h('div', { class: 'c-choices' },
    c.choices.map((v, i) => h('span', { class: 'c-choice' }, h('input', { type: 'text', id: 'c-choice-' + i, value: v, maxlength: 80, placeholder: 'Choice ' + (i + 1),
      oninput: (ev) => { c.choices[i] = ev.target.value; c.msg = null; fill($('#c-preview'), previewFor(c)); } }),
      c.choices.length > 2 ? h('button', { type: 'button', class: 'linkish', 'aria-label': 'Remove choice ' + (i + 1), onclick: () => { c.choices.splice(i, 1); renderCompose(); } }, 'remove') : null)),
    c.choices.length < 4 ? h('button', { type: 'button', class: 'linkish', onclick: () => { c.choices.push(''); renderCompose(); setTimeout(() => { const f = $('#c-choice-' + (c.choices.length - 1)); if (f) f.focus(); }, 0); } }, '+ a choice') : null)));
  if (c.kind === 'link') kids.push(h('label', { class: 'c-field' }, h('span', { class: 'label' }, 'Link'), input('c-url', 'url', 'https://…', 2000)),
    h('label', { class: 'c-field' }, h('span', { class: 'label' }, 'What to do there'), area('c-text', 'text', 'Read it and say Done')));
  if (c.kind === 'approve') kids.push(h('label', { class: 'c-field' }, h('span', { class: 'label' }, 'Exactly what they approve'), area('c-text', 'text', 'The words they say yes or no to')),
    h('div', { class: 'c-two' }, h('label', { class: 'c-field' }, h('span', { class: 'label' }, 'Yes says'), input('c-al', 'approve_label', 'Approve', 40)),
      h('label', { class: 'c-field' }, h('span', { class: 'label' }, 'No says'), input('c-dl', 'deny_label', 'Deny', 40))),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: c.editable, onchange: upd('editable') }), 'They may edit the words before approving'));
  if (c.kind === 'command') kids.push(h('label', { class: 'c-field' }, h('span', { class: 'label' }, 'The exact command'), input('c-cmd', 'command', 'the line they copy', 2000)),
    h('label', { class: 'c-field' }, h('span', { class: 'label' }, 'Where to run it'), input('c-where', 'where', 'Terminal on their laptop', 200)));
  kids.push(h('div', { class: 'c-two' },
    h('div', { class: 'c-field' }, h('span', { class: 'label' }, 'How soon'), h('div', { class: 'seg', role: 'group', 'aria-label': 'How soon' },
      [['now', 'Now'], ['today', 'Today'], ['whenever', 'Whenever']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': c.urgency === k ? 'true' : 'false', onclick: () => { c.urgency = k; renderCompose(); } }, l)))),
    h('label', { class: 'c-field' }, h('span', { class: 'label' }, 'Closes'), h('select', { id: 'c-due', onchange: upd('due') }, DUE.map(([v, l]) => h('option', { value: v, selected: c.due === v }, l))))));
  kids.push(h('div', { id: 'c-preview' }, previewFor(c)));
  if (c.msg) kids.push(h('p', { class: c.msg.bad ? 'error' : 'saved block', role: 'alert' }, c.msg.text));
  kids.push(h('div', { class: 'row' }, h('span', { class: 'help row-note' }, 'After Send you have 5 seconds to take it back (Z). Notes go back and forth until they answer.'),
    h('button', { class: 'btn', type: 'button', 'data-close': '', onclick: () => closeOverlays() }, 'Close', kbd('Esc')),
    h('button', { class: 'btn btn-you', type: 'button', id: 'c-send', onclick: () => sendCompose() }, 'Send', kbd(MOD + '↵'))));
  fill(body, ...kids);
  if (keep) { const f = document.getElementById(keep.id); if (f) { f.focus(); try { f.setSelectionRange(keep.s, keep.e); } catch (e) { /* not text */ } } }
}
function sendCompose() {
  const c = S.compose, problem = composeProblem(c);
  if (problem) { c.msg = { bad: true, text: problem }; renderCompose(); return; }
  const body = { to: [...c.to], title: c.title.trim(), step: composeStep(c), urgency: c.urgency, idempotency_key: 'desk-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) };
  if (c.due) body.expires_in = Number(c.due);
  const names = [...c.to].map((id) => nameOfMember(id) || 'someone');
  closeOverlays();
  const p = { body, names, draft: c, until: Date.now() + UNDO_MS };
  p.timer = setTimeout(() => flushSend(p), UNDO_MS);
  S.pendingSend = p; S.compose = null;
  showSendUndo(p);
}
async function flushSend(p) {
  if (S.pendingSend !== p) return;
  clearTimeout(p.timer); S.pendingSend = null;
  const box = $('#undo'); clearInterval(undoTick);
  try {
    const r = await api('POST', '/v1/member/people/asks', p.body);
    const sentTo = (r && r.sent) || [], notSent = (r && r.not_sent) || [];
    const waits = sentTo.filter((x) => x.waits_until).map((x) => (x.name || nameOfMember(x.to || x.member_id) || 'someone') + ' (after ' + fmtClock.format(ms(x.waits_until)) + ')');
    const no = notSent.map((x) => (x.name || nameOfMember(x.to || x.member_id) || 'someone') + (x.why || x.reason ? ': ' + (x.why || x.reason) : ''));
    showSent({ task: {}, body: {}, label: '' }, (no.length ? 'Not sent to ' + no.join('; ') + '. ' : '') + 'Sent to ' + p.names.filter((n) => !no.some((x) => x.startsWith(n))).join(', ') + (waits.length ? '; it reaches ' + waits.join(', ') + ' after their quiet hours' : '') + '. Answers come back under Sent.', !!no.length);
    loadSent();
  } catch (e) {
    S.compose = p.draft; S.compose.msg = { bad: true, text: 'Not sent: ' + e.message };
    renderCompose(); openOverlay('#compose'); box.hidden = true;
  }
}
function showSendUndo(p) {
  const box = $('#undo'); clearInterval(undoTick); clearTimeout(sentTimer);
  box.className = 'undo'; fill(box);
  const secs = h('span', { class: 'u-secs' }), bar = h('div', { class: 'u-bar' });
  box.append(h('div', { class: 'u-row' }, h('span', { class: 'u-what' }, 'To ', h('b', null, p.names.join(', ')), ': ', p.body.title), secs,
    h('button', { class: 'btn', type: 'button', onclick: () => undoSend() }, 'Undo', kbd('Z'))), bar);
  box.hidden = false;
  const tick = () => { const left = Math.max(0, p.until - Date.now()); secs.textContent = 'sends in ' + Math.ceil(left / 1000) + ' s'; bar.style.transform = 'scaleX(' + (left / UNDO_MS).toFixed(3) + ')'; if (left <= 0) clearInterval(undoTick); };
  tick(); undoTick = setInterval(tick, 100);
  sr('Sending to ' + p.names.join(', ') + ' in 5 seconds. Press Z to undo.');
}
function undoSend() {
  const p = S.pendingSend; if (!p) return false;
  clearTimeout(p.timer); S.pendingSend = null; clearInterval(undoTick); $('#undo').hidden = true;
  S.compose = p.draft; renderCompose(); openOverlay('#compose'); sr('Not sent. Your ask is back in the editor.');
  return true;
}
window.addEventListener('pagehide', () => { if (S.pendingSend) { const p = S.pendingSend; S.pendingSend = null; api('POST', '/v1/member/people/asks', p.body, { keepalive: true }).catch(() => {}); } });

/* Sent: each ask with a thread per person */
function renderSent() {
  const ol = $('#slist'), sends = S.sent || [];
  if (!S.ssel && sends.length) S.ssel = sends[0].key;
  if (S.ssel && !sends.some((x) => x.key === S.ssel)) S.ssel = sends.length ? sends[0].key : null;
  fill(ol, ...(sends.length ? sends.map((s) => {
    const sel = s.key === S.ssel, answered = s.threads.filter((t) => t.reply).length, news = !sel && s.threads.some(threadHasNews); // the open one is being read
    return h('li', { class: 'item' + (sel ? ' sel' : '') + (news ? ' new' : ''), role: 'option', 'aria-selected': sel ? 'true' : 'false', id: 's-' + s.key, dataset: { id: s.key },
      onclick: () => { S.ssel = s.key; renderSent(); openReading(); } },
      iconFor(null, s.threads.length === 1 ? threadName(s.threads[0]) : String(s.threads.length)),
      h('span', { class: 't' }, s.title || 'An ask'),
      h('span', { class: 'age' }, news ? h('span', { class: 'dot', title: 'An answer or note you have not read' }) : null, age(s.at || s.created_at)),
      h('span', { class: 'sub' }, h('span', { class: 'kind' }, (s.passed ? 'Passed on to ' : 'To ') + (s.threads.length === 1 ? threadName(s.threads[0]) : s.threads.length + ' people')
        + (s.passed && s.from ? ' · from ' + s.from : '') + ' · ' + (s.threads.length === 1 ? (answered ? 'answered' : threadOpen(s.threads[0]) ? 'waiting' : 'closed') : answered + ' of ' + s.threads.length + ' answered'))));
  }) : [h('li', { class: 'list-empty', role: 'presentation' }, S.sent === null ? 'Loading…' : 'Nothing sent yet. Press S to send your first ask.')]));
  const s = sends.find((x) => x.key === S.ssel), pane = $('#scard');
  if (!s) { fill(pane, h('div', { class: 'empty' }, h('h2', null, 'Ask your people'), h('p', null, 'Send a question, a choice, a link, something to approve, or a command to the people who joined from your link. Their answers come back here, one thread each.'),
    h('div', { class: 'answers' }, ansBtn('Send an ask', 'S', () => openCompose(), 'btn-you')))); return; }
  const kids = [h('button', { class: 'linkish back', type: 'button', onclick: () => closeReading() }, '← The list'),
    h('div', { class: 'ai-says mine' }, h('span', { class: 'label' }, s.passed ? 'You passed on' : 'You asked'), h('span', { class: 'label' }, '· ' + (KIND_WORD[kindOf({ step: s.step })] || 'An ask')), h('span', { class: 'help' }, (s.passed && s.from ? ' · from ' + s.from : '') + ' · ' + when(s.at || s.created_at))),
    h('h2', { class: 'card-title' }, s.title || 'An ask')];
  if (s.step && (s.step.text || s.step.command)) kids.push(h('div', { class: 'ask-words mine' }, h('p', null, s.step.command || s.step.text)));
  if (s.expires_at && ms(s.expires_at) > Date.now()) kids.push(h('p', { class: 'help' }, 'Closes ' + when(s.expires_at)));
  for (const t of s.threads) {
    const notes = t.notes || [];
    const d = draft('sent:' + t.task_id);
    const ta = h('textarea', { rows: 1, placeholder: 'A note to ' + threadName(t) + ' (notes stop once they answer)', 'aria-label': 'Note to ' + threadName(t), maxlength: 2000, dataset: { field: 'sent-' + t.task_id } });
    ta.value = d.note || ''; ta.addEventListener('input', () => { d.note = ta.value; });
    const msg = h('p', { class: 'error', id: 'sent-err-' + t.task_id, role: 'alert', hidden: !d.err }, d.err || '');
    if (d.err) { ta.setAttribute('aria-invalid', 'true'); ta.setAttribute('aria-describedby', msg.id); }
    const send = async (btn) => {
      const v = (d.note || '').trim(); if (!v) { ta.focus(); return; }
      btn.disabled = true; d.err = null;
      try { const r = await api('POST', '/v1/member/sent/' + enc(t.task_id) + '/notes', { note: v }); d.note = ''; if (r && Array.isArray(r.notes)) t.notes = r.notes; else t.notes = notes.concat([{ at: new Date().toISOString(), note: v, by: 'asker' }]); renderSent(); }
      catch (e) {
        // 409: answered or closed meanwhile; the note stays in the field to reuse in a new ask
        if (e.status !== 409) { d.err = 'Not sent: ' + e.message; renderSent(); return; }
        d.err = threadName(t) + ' answered or the ask closed, so your note was not sent: “' + v + '”. To ask more, send a new ask.';
        await loadSent(); // now the Desk knows which: say it exactly
        const now = (S.sent || []).flatMap((x) => x.threads).find((x) => x.task_id === t.task_id);
        if (now) { d.err = (now.reply ? threadName(now) + ' answered first (' + replyWords(now) + ')' : 'The ask closed') + ', so your note was not sent: “' + v + '”. To ask more, send a new ask.'; renderSent(); }
      }
    };
    ta.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); ev.stopPropagation(); send(ta.nextSibling); } });
    kids.push(h('section', { class: 'thread-box' + (threadHasNews(t) ? ' news' : '') },
      h('div', { class: 'tb-head' }, iconFor(null, threadName(t)), h('b', null, threadName(t)), h('span', { class: 'state' + (t.reply ? '' : ' waiting') }, t.reply ? 'Answered' : (t.state === 'lapsed' ? 'Closed' : 'Waiting')),
        t.reply && t.reply.at ? h('span', { class: 'help' }, when(t.reply.at)) : null),
      h('p', { class: 'tb-answer' }, replyWords(t)),
      t.reply && t.reply.note ? h('p', { class: 'tb-note' }, 'Their note: ', t.reply.note) : null,
      notes.length ? h('ol', { class: 'thread' }, notes.map((n) => h('li', null, h('span', { class: 'by', title: n.by === 'asker' ? 'You' : threadName(t) }, n.by === 'asker' ? 'You' : threadName(t)), h('span', { class: 'tx' }, linked(n.note || '')), h('span', { class: 'tm' }, n.at ? fmtClock.format(ms(n.at)) : '')))) : null,
      notes.length && notes[notes.length - 1].by !== 'asker' && !t.reply ? h('p', { class: 'note-state' }, threadName(t) + ' wrote a note; the ask is still open.') : null,
      threadOpen(t)
        ? h('div', { class: 'note-row' }, ta, h('button', { class: 'btn', type: 'button', onclick: (ev) => send(ev.currentTarget) }, 'Send note', kbd(MOD + '↵')))
        : h('div', { class: 'row-l closed-row' }, h('span', { class: 'help' }, (t.reply ? 'Answered' : 'Closed') + ', so notes stop here. To ask more, send a new ask.'),
          personId(t.to || {}) ? h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => openCompose([personId(t.to)]) }, 'New ask to ' + threadName(t)) : null),
      threadOpen(t) || d.err ? msg : null));
    markThreadSeen(t);
  }
  markSentRead(s.threads);
  fill(pane, h('article', { class: 'card' }, kids));
  renderSentCount();
}
function lastNoteWords(t) { const n = (t.notes || []).filter((x) => x.by !== 'asker').pop(); return n && n.note ? '“' + n.note + '”' : 'a note'; }
function sendNewsRows() {
  // On the Asks list: each new answer or note from your people is a line to read, not an ask to answer
  const news = sentNews(); if (!SEND_ON || !news.length) return [];
  return [h('li', { class: 'group-h people-h', role: 'presentation' }, 'Answers to what you sent', h('span', { class: 'n' }, String(news.length)), h('span', { class: 'gh-help' }, 'to read; each leaves once opened'))]
    .concat(news.slice(0, 6).map(({ send, thread }) => h('li', { class: 'item reply-line new', role: 'presentation', onclick: () => { S.ssel = send.key; setView('sent'); } },
      iconFor(null, threadName(thread)), h('span', { class: 't' }, threadName(thread) + ': ' + (thread.reply ? replyWords(thread) : lastNoteWords(thread))),
      h('span', { class: 'age' }, h('span', { class: 'dot' }), age((thread.reply && thread.reply.at) || send.created_at)),
      h('span', { class: 'sub' }, h('span', { class: 'kind' }, 'to “' + (send.title || 'your ask') + '”')))));
}
/* Pass on (OWNER_web_3 item 5): any ask on the deck goes to one of the person's own people.
   POST /v1/member/tasks/{task_id}/pass {"to", "note"}; the answer answers the original ask and comes back into the passer's thread. */
const PASS_ON = (document.querySelector('meta[name="desk-pass"]') || {}).content === 'on';
function openPass(t) {
  if (!canPass() || !t || t.isCall) return;
  S.passing = { task: t, to: null, note: '' };
  if (S.people === null) loadPeople().then(renderPass);
  renderPass(); openOverlay('#passon');
}
function renderPass() {
  const ps = S.passing; if (!ps) return;
  const joined = (S.people || []).filter(personJoined), t = ps.task;
  const note = h('textarea', { id: 'pass-note', rows: 2, maxlength: 2000, placeholder: 'A line for them (optional)', 'aria-label': 'A line for them' });
  note.value = ps.note; note.addEventListener('input', () => { ps.note = note.value; });
  const kids = [h('p', { class: 'help' }, '“' + (t.title || 'This ask') + '” from ' + whoName(t) + ' leaves your list. The person you pick sees the whole ask, as you see it here: its words, facts and pictures. Their answer goes to ' + whoName(t) + ' as your answer (' + whoName(t) + ' is never told who they are) and comes back to you under Sent. For 5 seconds after you pass it, Z takes it back.'),
    S.people === null ? h('p', { class: 'help' }, 'Loading your people…')
      : !joined.length ? h('p', null, 'Nobody has joined from your link yet, so there is nobody to pass it to.')
        : h('div', { class: 'c-to', role: 'radiogroup', 'aria-label': 'Pass to' }, joined.map((p) => h('button', { type: 'button', class: 'chip' + (ps.to === personId(p) ? ' on' : ''), role: 'radio',
          'aria-checked': ps.to === personId(p) ? 'true' : 'false', onclick: () => { ps.to = personId(p); renderPass(); } }, personName(p)))),
    h('div', { class: 'c-field' }, note),
    ps.msg ? h('p', { class: 'error', role: 'alert' }, ps.msg) : null,
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => closeOverlays() }, 'Close', kbd('Esc')),
      h('button', { class: 'btn btn-you', type: 'button', onclick: () => doPass() }, 'Pass on', kbd(MOD + '↵')))];
  fill($('#passon-body'), ...kids);
}
function doPass() {
  const ps = S.passing; if (!ps) return;
  if (!ps.to) { ps.msg = 'Pick who to pass it to.'; renderPass(); return; }
  closeOverlays();
  const body = { action: 'pass', to: ps.to }; if (ps.note.trim()) body.note = ps.note.trim();
  S.passing = null;
  answer(ps.task, body);
}
if (PASS_ON) $('#passon').addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); ev.stopPropagation(); doPass(); } }, true);

if (SEND_ON) {
  applySendSwitch();
  $('#send-open').addEventListener('click', () => openCompose());
  $('#compose').addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); ev.stopPropagation(); sendCompose(); } }, true);
}

/* A daily cap on asks from any one person (router_18: GET|POST /v1/member/limits {asks_per_person_per_day}) */
async function loadLimits() { try { S.limits = await api('GET', '/v1/member/limits'); } catch (e) { S.limits = { error: true }; } if (S.view === 'settings') renderSettings(); }
function limitsRow() {
  if (S.limits === null || S.limits === undefined) { loadLimits(); return null; }
  if (S.limits.error || S.limits.asks_per_person_per_day === undefined) return null;
  const cur = S.limits.asks_per_person_per_day, opts = [1, 3, 5, 10, 20, 50];
  return h('div', { class: 'set' }, h('div', { class: 'k' }, 'Asks from people', h('p', { class: 'help' }, 'How many asks any one person may send you in a day. ' + (S.limits.note || 'Your own AIs are not counted.'))),
    h('div', null, h('select', { 'aria-label': 'Asks a person may send you a day', onchange: async (ev) => {
      try { S.limits = await api('POST', '/v1/member/limits', { asks_per_person_per_day: Number(ev.target.value) }); S.setMsg = { text: 'Saved.' }; } catch (e) { S.setMsg = { bad: true, text: e.message }; }
      renderSettings(); } },
      (opts.includes(cur) ? opts : opts.concat([cur]).sort((a, b) => a - b)).map((v) => h('option', { value: String(v), selected: v === cur }, v + (v === 1 ? ' a day' : ' a day'))))));
}

/* The one-time notice (router_18): before any ask from a person shows, the receiver reads who can send them asks. */
function noticeCard() {
  const n = S.notice; if (!n) return null;
  return h('section', { class: 'notice-card', 'aria-labelledby': 'notice-h' }, h('p', { class: 'label', id: 'notice-h' }, 'Before any ask from a person'),
    h('p', { class: 'notice-text' }, n.text || ((n.from || 'Someone') + ' can send you asks here; you can mute or leave at any time.')),   // the API's words (OWNER_router_36 item 2)
    h('div', { class: 'answers' },
      h('button', { class: 'btn btn-you', type: 'button', onclick: async (ev) => { const b = ev.currentTarget; b.disabled = true; b.textContent = 'One moment…';
        try { await api('POST', '/v1/member/people/notice', {}); S.notice = null; S.noticeAckAt = Date.now(); S.cardSig = ''; render(); if (S.loading) S.lookAgain = true; else refresh(true); } catch (e) { b.disabled = false; b.textContent = 'Not saved: ' + e.message; } } }, 'OK, show me their asks'),
      h('button', { class: 'btn', type: 'button', onclick: (ev) => mutePerson(n.from || 'them', ev.currentTarget) }, 'Mute ' + (n.from || 'them')),
      h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => openLeave(n.from || null) }, 'Leave…')),
    h('p', { class: 'help' }, 'Muted, their asks never ring and still show here. Leave ends your membership here and deletes what it holds of yours.'));
}

/* ---------- Leave (8.1 and P16; router_18 item 8d: Mute and Leave on the notice's own screen) ----------
   POST /v1/member/leave {"confirm": true} deletes the person's answers, records, receipts and feedback on this page and stops
   its link for good. The Desk offers the receipts first and asks for the word "leave" typed, since nothing takes it back. */
function openLeave(from) {
  S.leaving = { from: from || null, typed: '', msg: null, saved: '', busy: false, where: S.memberLabel || 'this page' };
  renderLeave(); openOverlay('#leave');
  setTimeout(() => { const f = $('#leave-typed'); if (f) f.focus(); }, 0);
}
function renderLeave() {
  const L = S.leaving; if (!L) return;
  $('#leave-h').textContent = 'Leave ' + L.where + '?';
  const ok = () => L.typed.trim().toLowerCase() === 'leave';
  const go = h('button', { class: 'btn btn-stop', type: 'button', id: 'leave-go', disabled: !ok() || L.busy, onclick: () => doLeave() }, L.busy ? 'Leaving…' : 'Leave');
  const field = h('input', { type: 'text', id: 'leave-typed', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'leave-what', value: L.typed });
  field.addEventListener('input', () => { L.typed = field.value; go.disabled = !ok() || L.busy; });
  field.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ok()) { ev.preventDefault(); doLeave(); } });
  fill($('#leave-body'),
    h('p', { id: 'leave-what' }, 'You stop being a member here' + (L.from ? ', and ' + L.from + ' can no longer send you asks' : '') +
      '. At once and for good: your answers, records, receipts and feedback here are deleted, and this page\'s link stops working on every device. Your person.tools account and any other pages you joined stay. To stop only this computer, sign out instead.'),
    h('div', { class: 'row-l leave-save' }, h('button', { class: 'btn', type: 'button', onclick: (ev) => saveReceipts(ev.currentTarget) }, 'Save my receipts first'),
      h('span', { class: 'help', role: 'status' }, L.saved)),
    h('label', { class: 'label', for: 'leave-typed' }, 'Type leave to confirm'), field,
    L.msg ? h('p', { class: 'error', role: 'alert' }, L.msg) : null,
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', 'data-close': '', onclick: () => closeOverlays() }, 'Keep it', kbd('Esc')), go));
}
const localDay = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
async function saveReceipts(btn) {
  const L = S.leaving; btn.disabled = true;
  try {
    const r = await api('GET', '/v1/member/receipts');
    const url = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }));
    const a = h('a', { href: url, download: 'person-tools-receipts-' + localDay() + '.json', hidden: true });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    if (L) L.saved = 'Saved to your downloads.';
  } catch (e) { if (L) L.saved = 'Not saved: ' + e.message; }
  if (S.leaving) renderLeave();
}
async function doLeave() {
  const L = S.leaving; if (!L || L.busy || L.typed.trim().toLowerCase() !== 'leave') return;
  L.busy = true; L.msg = null; renderLeave();
  try {
    await api('POST', '/v1/member/leave', { confirm: true });
    S.leaving = null; closeOverlays();
    signOut('You left ' + L.where + '. Its link no longer works, and this computer forgot it.');
  } catch (e) {
    if (e.code === 'signed_out') return;
    L.busy = false; L.msg = 'You have not left: ' + e.message; renderLeave();
  }
}
async function mutePerson(name, btn, body) {
  try { await api('POST', '/v1/member/mutes', body || { panel_owner: true }); showSent({ task: {}, body: {}, label: '' }, 'Muted ' + name + ': their asks will never ring. They still show here.'); if (btn) btn.textContent = 'Muted'; }
  catch (e) { showSent({ task: {}, body: {}, label: '' }, 'Not muted: ' + e.message, true); }
}

/* ---------- On: when calls can ring this person (POST /v1/member/on) ----------
   The service keeps a person On for at most 12 hours (the promise: On ends by itself), so there is no "On with no end". */
function noteRing(o, sentAt) {
  if (sentAt && (S.onBusy || (S.onChangedAt && S.onChangedAt > sentAt))) return; // older than the person's last On/Off
  S.ring = { on: o.on, on_until: o.on_until, quiet_now: !!o.quiet_now, quiet: o.quiet || (S.ring && S.ring.quiet) || null }; renderOn(); }
const isOn = () => S.ring && S.ring.on && S.ring.on !== 'off' && (!S.ring.on_until || ms(S.ring.on_until) > Date.now());
function onWords() {
  if (S.onPending !== undefined) return S.onPending ? 'Calls: turning On…' : 'Calls: turning Off…';
  if (!S.ring) return 'Calls: …';
  if (!isOn()) return 'Calls: Off';
  return 'Calls: On' + (S.ring.on_until ? ' until ' + fmtClock.format(ms(S.ring.on_until)) : '');
}
function renderOn() {
  const b = $('#on-btn'); if (!b) return;
  b.textContent = onWords(); b.classList.toggle('is-on', !!isOn());
  b.title = S.ring && S.ring.quiet_now ? 'Quiet hours now: calls wait until they end.' : isOn() ? 'Calls from your panels can ring you.' : 'No call rings you. Your AIs’ asks still arrive.';
  if (S.view === 'settings') { const r = $('#on-row'); if (r) r.replaceWith(onRow()); }
}
function hoursUntil(hh) { // the next time today or tomorrow at hh:00, in hours from now
  const d = new Date(); const t = new Date(d); t.setHours(hh, 0, 0, 0); if (t <= d) t.setDate(t.getDate() + 1);
  return (t - d) / 3600000;
}
async function setOn(hours) {
  // The press shows at once. Changes go one after another, so the person's last press is the one the service keeps
  // (two at once could land in either order on a slow service).
  S.onPending = hours; renderOnMenu(false); renderOn();
  if (S.onBusy) return; // the change on its way sends the latest press when it lands
  S.onBusy = true; let err = null;
  while (S.onPending !== undefined) {
    const hrs = S.onPending;
    const body = hrs ? { on: true, hours: Math.min(12, Math.max(0.25, hrs)), until: new Date(Date.now() + Math.min(12, hrs) * 3600000).toISOString() } : { on: false };
    try { const r = await api('POST', '/v1/member/on', body); err = null; S.ring = Object.assign({}, S.ring || {}, { on: r.on, on_until: r.on_until, quiet_now: !!r.quiet_now }); }
    catch (e) { err = e; if (e.code === 'signed_out') { S.onPending = undefined; break; } }
    if (S.onPending === hrs) S.onPending = undefined; // nothing newer was pressed meanwhile
  }
  S.onBusy = false; S.onChangedAt = Date.now(); renderOn();
  if (err) { sr('Not changed: ' + err.message); flashOn('Not changed: ' + err.message); }
  else sr(isOn() ? 'You are On until ' + fmtClock.format(ms(S.ring.on_until)) + '.' : 'You are Off. No call rings you.');
}
function flashOn(t) { const b = $('#on-btn'); if (b) { b.textContent = t; setTimeout(renderOn, 2500); } }
function onChoices() {
  const out = [['Off', 0], ['On for 1 hour', 1], ['On for 2 hours', 2]];
  for (const hh of [17, 18, 19, 20, 21, 22, 23]) { const hrs = hoursUntil(hh); if (hrs > 2.2 && hrs <= 12) out.push(['On until ' + fmtClock.format(new Date(Date.now() + hrs * 3600000)), hrs]); }
  out.push(['On for 12 hours (the longest)', 12]);
  return out;
}
function renderOnMenu(open) {
  const m = $('#on-menu'), b = $('#on-btn');
  if (open === undefined) open = m.hidden;
  m.hidden = !open; b.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (!open) return;
  const q = S.ring && S.ring.quiet;
  fill(m, h('p', { class: 'menu-note' }, isOn() ? 'You are On until ' + fmtClock.format(ms(S.ring.on_until)) + '.' : 'You are Off: no call rings you. Your AIs’ asks still arrive.'),
    ...onChoices().map(([label, hrs]) => h('button', { role: 'menuitem', type: 'button', onclick: () => setOn(hrs) }, label)),
    h('p', { class: 'menu-note' }, 'On ends by itself, at most after 12 hours.' + (q ? ' Quiet hours ' + hourName(q.start) + ' to ' + hourName(q.end) + ': no call rings then.' : '')));
  const first = m.querySelector('[role=menuitem]'); if (first) first.focus();
}
function onRow() {
  return h('div', { class: 'set', id: 'on-row' }, h('div', { class: 'k' }, 'Calls can ring me', h('p', { class: 'help' }, 'Calls from panels you joined. On ends by itself, at most after 12 hours. Your AIs’ asks arrive either way.')),
    h('div', null, h('p', { class: 'on-state' }, S.onPending !== undefined ? (S.onPending ? 'Turning On…' : 'Turning Off…') : isOn() ? 'On until ' + fmtClock.format(ms(S.ring.on_until)) + (S.ring.quiet_now ? ' (quiet hours now: calls wait)' : '') : S.ring ? 'Off' : '…'),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Calls can ring me' }, [['Off', 0], ['1 hour', 1], ['2 hours', 2], ['12 hours', 12]].map(([l, hrs]) =>
        h('button', { type: 'button', 'aria-pressed': (hrs === 0 ? !isOn() : false) ? 'true' : 'false', onclick: () => setOn(hrs) }, l)))));
}
$('#on-btn').addEventListener('click', (ev) => { ev.stopPropagation(); renderOnMenu(); });
document.addEventListener('click', (ev) => { if (!$('#on-menu').hidden && !ev.target.closest('.on-wrap')) renderOnMenu(false); });
$('#on-menu').addEventListener('keydown', (ev) => {
  const items = $$('#on-menu [role=menuitem]'), i = items.indexOf(document.activeElement);
  if (ev.key === 'ArrowDown' || ev.key === 'j') { ev.preventDefault(); ev.stopPropagation(); items[(i + 1) % items.length].focus(); }
  else if (ev.key === 'ArrowUp' || ev.key === 'k') { ev.preventDefault(); ev.stopPropagation(); items[(i - 1 + items.length) % items.length].focus(); }
  else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); renderOnMenu(false); $('#on-btn').focus(); }
  else if (ev.key === 'Tab') renderOnMenu(false);
});

/* ---------- views, overlays ---------- */
function setView(v, focusForm) {
  S.view = v;
  for (const b of $$('.view')) { const on = b.dataset.view === v; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  $('#view-asks').hidden = v !== 'asks'; $('#view-history').hidden = v !== 'history';
  $('#view-ais').hidden = v !== 'ais'; $('#view-settings').hidden = v !== 'settings';
  $('#view-sent').hidden = v !== 'sent'; $('#view-people').hidden = v !== 'people';
  if (v === 'sent') { renderSent(); loadSent(); setTimeout(() => $('#slist').focus(), 0); }
  if (v === 'people') { renderPeople(); loadPeople(); }
  S.cardSig = '';
  if (v === 'ais') { S.blocks = null; S.mutes = null; renderAIs(); loadConns(); if (focusForm) setTimeout(() => { const n = $('#c-name'); if (n) n.focus(); }, 50); }
  if (v === 'settings') { renderSettings(); loadSettings(); }
  if (v === 'history') { renderHistory(); setTimeout(() => $('#hlist').focus(), 0); loadDeepHistory(); }
  if (v === 'asks') setTimeout(() => $('#list').focus(), 0);
  render();
}
for (const b of $$('.view')) b.addEventListener('click', () => setView(b.dataset.view));
$('#sort').addEventListener('change', (ev) => { S.sort = ev.target.value; setPref('sort', S.sort); render(); });
$('#refresh').addEventListener('click', () => refresh());
/* The menu: the same place and the same things as the phone's (OWNER_web_2). */
function menuOpen(open) {
  const m = $('#menu'), b = $('#menu-open');
  if (open === undefined) open = m.hidden;
  m.hidden = !open; b.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) { const first = m.querySelector('[role=menuitem]'); if (first) first.focus(); }
}
$('#menu-open').addEventListener('click', (ev) => { ev.stopPropagation(); menuOpen(); });
document.addEventListener('click', (ev) => { if (!$('#menu').hidden && !ev.target.closest('.menu-wrap')) menuOpen(false); });
$('#menu').addEventListener('keydown', (ev) => {
  const items = $$('#menu [role=menuitem]'), i = items.indexOf(document.activeElement);
  if (ev.key === 'ArrowDown' || ev.key === 'j') { ev.preventDefault(); ev.stopPropagation(); items[(i + 1) % items.length].focus(); }
  else if (ev.key === 'ArrowUp' || ev.key === 'k') { ev.preventDefault(); ev.stopPropagation(); items[(i - 1 + items.length) % items.length].focus(); }
  else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); menuOpen(false); $('#menu-open').focus(); }
  else if (ev.key === 'Tab') { menuOpen(false); }
});
for (const it of $$('#menu [role=menuitem]')) it.addEventListener('click', () => {
  menuOpen(false);
  const go = it.dataset.go;
  if (go === 'ais' || go === 'history' || go === 'settings' || go === 'people') setView(go);
  else if (go === 'keys') openOverlay('#keys');
  else if (go === 'computers') showComputers();
  else if (go === 'pages') showPages();
  else if (go === 'feedback') { $('#feedback-msg').textContent = ''; openOverlay('#feedback'); setTimeout(() => $('#feedback-text').focus(), 0); }
  else if (go === 'signout') askSignOut();
});
/* Switch page: a passkey that opens several pages shows one at a time. Switching sends what waits in its five seconds
   first, then opens the Desk again on the other page, so nothing of one page is shown or sent as the other. */
function applyPagesSwitch() { const on = /^ps_/.test(S.cred || '') && (S.mems || []).length > 1; for (const el of $$('.pages-only')) el.hidden = !on; }
function showPages() {
  const list = $('#pages-list');
  fill(list, ...(S.mems || []).map((m) => h('button', { class: 'btn pick-page', type: 'button', disabled: m.id === S.member ? true : undefined,
    onclick: () => switchPage(m) }, h('span', null, m.label + (m.id === S.member ? ' · this one' : '')), h('span', { class: 'pick-n', 'data-mb': m.id }, 'counting open asks…'))));
  openOverlay('#pages');
  const first = list.querySelector('button:not([disabled])'); if (first) first.focus({ preventScroll: true });
  for (const m of S.mems || []) countOpen(S.cred, m.id).then((n) => { const el = list.querySelector('.pick-n[data-mb="' + m.id + '"]'); if (el) el.textContent = n ? n + (n === 1 ? ' ask open' : ' asks open') : 'nothing open'; })
    .catch(() => { const el = list.querySelector('.pick-n[data-mb="' + m.id + '"]'); if (el) el.textContent = ''; });
}
async function switchPage(m) {
  for (const b of $$('#pages-list button')) b.disabled = true;
  sr('Opening ' + m.label + '…');
  await Promise.all([...S.pending.keys()].map((id) => flush(id))); // sent as the page they were made on
  if (S.pendingSend) await flushSend(S.pendingSend);
  const keep = S.remember ? 'local' : 'session';
  sset(keep, 'desk.member', m.id); sset(keep, 'desk.member_label', m.label); sdel('local', 'desk.owner'); sdel('session', 'desk.owner');
  location.reload();
}
/* Computers signed in: read-only here; the phone approves, lists for others and signs computers out. */
async function showComputers() {
  const body = $('#computers-list'); fill(body, h('p', { class: 'help' }, 'Loading…')); openOverlay('#computers');
  try {
    const r = await api('GET', '/v1/member/desk/sessions');
    const list = Array.isArray(r && r.sessions) ? r.sessions : Array.isArray(r) ? r : [];
    if (!list.length) { fill(body, h('p', null, 'No computer is signed in with your phone.')); return; }
    fill(body, h('ul', { class: 'computers' }, list.map((c) => h('li', null,
      h('b', null, [c.browser, c.where || c.city].filter(Boolean).join(' · ') || 'A computer'), c.current || c.this ? h('span', { class: 'state' }, 'This one') : null,
      h('span', { class: 'help' }, (c.signed_in_at || c.made_at ? 'signed in ' + when(c.signed_in_at || c.made_at) : '') + (c.last_used_at ? ' · last used ' + agoWords(c.last_used_at) : ''))))));
  } catch (e) {
    fill(body, h('p', { class: 'help' }, e.status === 404 ? 'This list arrives with signing in by your phone.' : 'The list could not be read: ' + e.message));
  }
}
$('#feedback-send').addEventListener('click', async () => {
  const ta = $('#feedback-text'), msg = $('#feedback-msg'), v = ta.value.trim();
  if (!v) { msg.textContent = 'Write what should change first.'; ta.focus(); return; }
  $('#feedback-send').disabled = true;
  try { await api('POST', '/v1/member/feedback', { text: v.slice(0, 2000) }); ta.value = ''; msg.textContent = 'Sent. Thank you.'; }
  catch (e) { msg.textContent = 'Not sent: ' + e.message; }
  $('#feedback-send').disabled = false;
});
function askSignOut() {
  if (S.pending.size) confirmBox('Send your answers first?', 'An answer is still waiting out its five seconds. Signing out sends it now.', 'Send and sign out', () => { for (const id of [...S.pending.keys()]) flush(id, true); signOut(); });
  else signOut();
}
let lastFocus = null;
function openOverlay(sel) { lastFocus = document.activeElement; const o = $(sel); o.hidden = false; const f = o.querySelector('[data-close]'); if (f) f.focus(); }
function closeOverlays() { let any = false; for (const o of $$('.overlay')) if (!o.hidden) { o.hidden = true; any = true; } if (any && lastFocus) lastFocus.focus(); return any; }
for (const b of $$('[data-close]')) b.addEventListener('click', () => closeOverlays());
for (const o of $$('.overlay')) o.addEventListener('click', (ev) => { if (ev.target === o) closeOverlays(); });
// The key list is a light panel: the page behind it stays usable, and a click anywhere else closes it.
document.addEventListener('mousedown', (ev) => { const k = $('#keys'); if (!k.hidden && !ev.target.closest('#keys .sheet') && !ev.target.closest('#menu-open') && !ev.target.closest('.menu')) { k.hidden = true; } }, true);
function confirmBox(title, text, yes, onyes) {
  $('#confirm-h').textContent = title; $('#confirm-p').textContent = text;
  const y = $('#confirm-yes'); y.textContent = yes;
  y.onclick = () => { closeOverlays(); onyes(); };
  openOverlay('#confirm');
}
function buildKeymap() {
  const rows = [
    [['J', '↓'], 'Next ask'], [['K', '↑'], 'Previous ask'],
    [['→', 'Y'], 'The card\'s yes: Done, approve, or the second choice; on a call, take it'], [['←', 'N'], 'The card\'s no: Not now, deny, or the first choice; on a call, decline it'],
    [['1', '2', '3', '4'], 'Pick a choice by its number'], [['X'], 'Not now, on any card (the AI is told)'], [['U'], 'Later: to the foot of the list, on this computer only (the AI is not told)'],
    [['Enter'], 'Write: the answer, the words you approve, or a note. In the answer box, Enter sends'],
    [[MOD, 'Enter'], 'Send the note alone; the ask stays open'], [['O'], 'Open the link in a new tab'], [['C'], 'Copy the command'],
    [['Z'], 'Undo the last answer (five seconds)'], [['Esc'], 'Leave a box, close this, or go back to the list'],
    [['M'], 'The menu'], [['I'], 'Asks'], [['H'], 'History'],
    ...(SEND_ON ? [[['S'], 'Send an ask to your people'], [['T'], 'Sent: their answers, a thread each']] : []),
    ...(canPass() ? [[['P'], 'Pass the ask on to one of your people']] : []), [['/'], 'Search history'], [['A'], 'Your AIs'], [[','], 'Settings'], [['R'], 'Look for new asks now'], [['?'], 'These keys'],
  ];
  fill($('#keymap'), ...rows.flatMap(([ks, what]) => [h('dt', null, ks.map(kbd)), h('dd', null, what)]));
}
function focusCard() { const p = $('#card'); p.focus({ preventScroll: true }); }
function openReading() { $('#view-asks').classList.add('reading'); $('#view-history').classList.add('reading'); }
function closeReading() { $('#view-asks').classList.remove('reading'); $('#view-history').classList.remove('reading'); (S.view === 'history' ? $('#hlist') : $('#list')).focus(); }

/* ---------- the keyboard ---------- */
function move(delta) {
  if (S.view === 'sent') {
    const items = $$('#slist .item'); if (!items.length) return;
    const i = items.findIndex((x) => x.dataset.id === S.ssel);
    S.ssel = items[Math.max(0, Math.min(items.length - 1, (i < 0 ? 0 : i + delta)))].dataset.id; renderSent(); return;
  }
  if (S.view !== 'asks' && S.view !== 'history') return;
  if (S.view === 'history') {
    const items = $$('#hlist .item'); if (!items.length) return;
    const i = items.findIndex((x) => x.dataset.id === S.hsel);
    const n = items[Math.max(0, Math.min(items.length - 1, (i < 0 ? 0 : i + delta)))];
    S.hsel = n.dataset.id; renderHistory(); return;
  }
  const order = flatOrder().map((t) => t.task_id); if (!order.length) return;
  const i = order.indexOf(S.sel);
  S.sel = order[Math.max(0, Math.min(order.length - 1, (i < 0 ? 0 : i + delta)))]; S.gone = null;
  render();
}
function firstField() { return $('#card [data-field="text"]') || $('#card [data-field="approve"]') || $('#card [data-field="note"]'); }
document.addEventListener('keydown', (ev) => {
  if (!S.cred) return;
  const tgt = ev.target, inField = tgt && (tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.tagName === 'INPUT');
  const pressable = tgt && (tgt.tagName === 'BUTTON' || tgt.tagName === 'A' || tgt.tagName === 'SUMMARY');
  const anyOverlay = $$('.overlay').some((o) => !o.hidden);
  if (ev.key === 'Escape') {
    if (closeOverlays()) { ev.preventDefault(); return; }
    if (inField) { ev.preventDefault(); tgt.blur(); (S.view === 'asks' ? $('#card') : document.body).focus({ preventScroll: true }); return; }
    if ($('#view-asks').classList.contains('reading') || $('#view-history').classList.contains('reading')) { closeReading(); return; }
    if (S.view !== 'asks') { setView('asks'); return; }
    return;
  }
  if (anyOverlay) {
    if (ev.key === 'Tab') { // keep focus inside the open dialog
      const o = $$('.overlay').find((x) => !x.hidden);
      const f = $$('button, [href], input, select, textarea', o).filter((x) => !x.disabled && x.offsetParent !== null);
      if (f.length) { const i = f.indexOf(document.activeElement); const n = ev.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === f.length - 1 ? 0 : i + 1); ev.preventDefault(); f[n].focus(); }
    }
    return;
  }
  const mod = ev.metaKey || ev.ctrlKey;
  const t = S.view === 'asks' ? selectedTask() : null;
  if (mod && ev.key === 'Enter' && t) { ev.preventDefault(); const d = draft(t.task_id); if ((d.note || '').trim()) answer(t, { action: 'note', note: d.note.trim() }); else { const n = $('#f-note'); if (n) n.focus(); } return; }
  if (mod && (ev.key === 'z' || ev.key === 'Z') && !inField) { if (undo()) ev.preventDefault(); return; }
  if (inField || mod || ev.altKey) return;
  if (pressable && (ev.key === 'Enter' || ev.key === ' ')) return;
  const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
  // A held key repeats: moving may repeat, answering never does (one press, one answer).
  if (ev.repeat && !['j', 'k', 'ArrowDown', 'ArrowUp'].includes(k)) { ev.preventDefault(); return; }
  const yn = t ? yesNo(t) : null;
  const act = (fn) => { ev.preventDefault(); fn(); };
  switch (k) {
    case 'j': case 'ArrowDown': return act(() => move(1));
    case 'k': case 'ArrowUp': return act(() => move(-1));
    case 'ArrowRight': case 'y': if (t && yn && yn.yes) return act(() => (yn.yes.call ? takeCall(t) : yn.yes.body.choice !== undefined ? choose(t, yn.yes.body.choice) : answer(t, yn.yes.body))); return;
    case 'ArrowLeft': case 'n': if (t && yn && yn.no) return act(() => (yn.no.body.choice !== undefined ? choose(t, yn.no.body.choice) : answer(t, yn.no.body))); return;
    case 'x': if (t) return act(() => answer(t, t.isCall ? { action: 'call_not_now', local: true } : { action: 'not_now' })); return;
    case 'd': if (t && !t.isCall && doneOk(t)) return act(() => answer(t, { action: 'done' })); return;
    case 'u': if (t && !t.isCall) return act(() => toggleLater(t)); return;
    case 'z': return act(() => undo());
    case 'Enter': if (t && t.isCall) return act(() => takeCall(t)); if (t && S.view === 'asks') { const f = firstField(); if (f) { ev.preventDefault(); openReading(); f.focus(); } } return;
    case 'o': { const a = $('#open-link') || $('#dial-link'); if (a && S.view === 'asks') { ev.preventDefault(); a.click(); } return; }
    case 'c': { const p = $('#cmd-line'); if (p && t) { ev.preventDefault(); copyText(t.step.command || '', $('.cmd-top .btn')); } return; }
    case 'r': return act(() => refresh());
    case 'm': return act(() => menuOpen(true));
    case 's': if (canSend()) return act(() => openCompose()); return;
    case 't': if (canSend()) return act(() => setView('sent')); return;
    case 'p': if (canPass() && t && !t.isCall && !contactsOf(t).length) return act(() => openPass(t)); return;
    case 'i': return act(() => setView('asks'));
    case 'h': return act(() => setView('history'));
    case '/': return act(() => { setView('history'); setTimeout(() => $('#search').focus(), 0); });
    case 'a': return act(() => setView('ais'));
    case ',': return act(() => setView('settings'));
    case '?': return act(() => openOverlay('#keys'));
    default:
      if (/^[1-9]$/.test(k) && t && kindOf(t) === 'choice') { const c = t.step.choices[Number(k) - 1]; if (c !== undefined) act(() => choose(t, c)); }
  }
});

/* ---------- the server's optional parts, from its discovery document (section 5) ---------- */
async function loadFeatures() {
  try {
    const r = await fetch(API + '/.well-known/x-hc-draft', { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    const d = r.ok ? await r.json() : null;
    S.features = new Set(Array.isArray(d && d.features) ? d.features : []); S.cardSig = ''; render();
  } catch (e) { /* none known: the Desk offers only what every server takes */ }
}
/* ---------- start ---------- */
function start(data) {
  qrStop();
  $('#booting').hidden = true; $('#signin').hidden = true; $('#desk').hidden = false;
  S.view = 'asks';
  if (data) absorb(data);
  loadSettings(); loadConns(); setTimeout(loadDeepHistory, 1500); loadFeatures();
  if (SEND_ON) setTimeout(() => { if (S.cred && S.limits == null) loadLimits(); }, 2500); // Settings opens whole
  if (SEND_ON || PASS_ON) { if (!S.peopleEarly) loadPeople(); S.peopleEarly = null; saveOwner(); }
  applyPagesSwitch();
  if (SEND_ON) loadSent();
  const offersAt = Date.now();
  api('GET', '/v1/member/offers').then((o) => { if (o) noteRing(o, offersAt); if (o && Array.isArray(o.offers)) { S.offers = o.offers.filter((x) => !S.blockedCalls.has(x.call_id)); for (const c of callItems()) loadSeat(c); render(); } }).catch(() => {});
  render(); schedule();
  $('#list').focus();
}
applyTheme(); buildKeymap(); scrubAddress();
window.addEventListener('hashchange', scrubAddress);
(async () => {
  const cred = sget('session', 'desk.cred') || sget('local', 'desk.cred');
  if (!cred) { showSignIn(); return; }
  const slow = setTimeout(() => { $('#booting').textContent = 'Opening your Desk… person.tools is slow to answer just now.'; }, 3000);
  S.cred = cred; S.remember = !!sget('local', 'desk.cred');
  S.member = sget('session', 'desk.member') || sget('local', 'desk.member') || null;
  S.memberLabel = sget('session', 'desk.member_label') || sget('local', 'desk.member_label') || null;
  S.isOwner = cachedOwner(); applySendSwitch();
  try { S.mems = JSON.parse(sget('session', 'desk.mems') || sget('local', 'desk.mems') || '[]'); } catch (e) { S.mems = []; }
  applyPagesSwitch();
  if (SEND_ON || PASS_ON) S.peopleEarly = loadPeople();
  clearTimeout(slow);
  S.firstLook = true; start(null); refresh(true); // drawn now; the asks fill in when person.tools answers (refresh signs out a dead link)
  setTimeout(() => { if (S.firstLook && S.cred) { S.firstSlow = true; S.cardSig = ''; render(); } }, 3000);
})();
})();
