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
const MOD = IS_MAC ? '⌘' : 'Ctrl';

/* ---------- small helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
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
async function api(method, path, body, opts = {}) {
  const headers = authHeaders();
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let r;
  try {
    r = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: !!opts.keepalive });
  } catch (e) {
    throw { status: 0, code: 'unreached', message: 'The Desk could not reach person.tools. Check this computer\'s connection.' };
  }
  let data = null;
  try { data = await r.json(); } catch (e) { data = null; }
  if (!r.ok) throw { status: r.status, code: data && data.code, message: (data && data.message) || ('person.tools answered ' + r.status + '.'), data };
  return data;
}
async function apiBlob(path) {
  const r = await fetch(API + path, { headers: authHeaders(), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!r.ok) throw { status: r.status };
  return r.blob();
}

/* ---------- state ---------- */
const S = {
  cred: null, remember: false, memberId: null,
  open: [], history: [], conns: null, settings: null,
  sel: null, hsel: null, view: 'asks',
  sort: pref('sort', 'fair'), filter: null,
  pending: new Map(),      // task_id -> {task, body, label, until, timer}
  sentLocal: new Map(),    // task_id -> task with reply, answered here this session
  drafts: new Map(),       // task_id -> {text, note, approve}
  failed: new Map(),       // task_id -> {message}
  gone: null,              // a line about an ask that left the list while selected
  later: {},               // task_id -> when marked Later (kept on this computer)
  media: new Map(),        // task_id -> {url, type} | {error}
  lastOk: 0, lastErr: null, pollTimer: null, pollDelay: POLL_MS, loading: false,
  shownOnce: null,         // a new connection's key and link, shown once, never stored
  offers: [], seats: new Map(), seen: {}, // calls offered to the person; their ring cards; when each was first seen
  cardSig: '',
};
const URG = { now: 0, today: 1, whenever: 2 };
const urg = (t) => (t.urgency in URG ? URG[t.urgency] : 1);
const tms = (t) => ms(t.created_at);
const whoKey = (t) => (t.connection && t.connection.id) || ('from:' + (t.from || ''));
const whoName = (t) => t.from || (t.connection && t.connection.name) || 'An AI';
function draft(id) { if (!S.drafts.has(id)) S.drafts.set(id, { text: '', note: '', approve: null }); return S.drafts.get(id); }
const isLater = (t) => Object.prototype.hasOwnProperty.call(S.later, t.task_id);
function laterKey() { return 'desk.later.' + (S.memberId || 'x'); }
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
  return 'other';
}
const KIND_WORD = { choice: 'Pick one', words: 'Answer in words', approve: 'Approve or deny', link: 'Open a link', command: 'Run a command', call: 'A call', other: 'An ask' };
const CALL_VERB = { listen: 'listen', watch: 'watch', view: 'look', play: 'play', compare: 'compare', answer: 'answer' };
function quickRank(t) {
  const k = kindOf(t);
  if (k === 'choice') return 1;
  if (k === 'approve') return t.step.editable ? 3 : 2;
  if (k === 'words') return 3;
  if (k === 'link') return 4;
  if (k === 'command') return 5;
  if (k === 'call') return 4;
  return 6;
}
function yesNo(t) {
  const s = t.step || {}, k = kindOf(t);
  if (k === 'call') return t.offer.state === 'offered'
    ? { no: { label: 'Decline', body: { action: 'call_not_now', local: true } }, yes: { label: 'Take this call', call: true } }
    : { no: null, yes: { label: 'Open the call again', call: true } };
  if (k === 'choice') return { no: { label: s.choices[0], body: { action: 'answer', choice: s.choices[0] } },
    yes: s.choices[1] !== undefined ? { label: s.choices[1], body: { action: 'answer', choice: s.choices[1] } } : null };
  if (k === 'approve') return { no: { label: s.deny_label || 'Deny', body: { action: 'deny' } },
    yes: { label: s.approve_label || 'Approve', body: { action: 'approve' } } };
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
function iconFor(icon, name, big) {
  const cls = 'ic' + (big ? ' big' : '');
  if (icon && ICONS[icon]) return h('span', { class: cls, 'aria-hidden': 'true' }, svgIcon(icon));
  if (icon && !/^https?:/i.test(icon) && [...icon].length <= 3) return h('span', { class: cls + ' emoji', 'aria-hidden': 'true' }, icon);
  const letter = (String(name || '?').trim().match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
  return h('span', { class: cls, 'aria-hidden': 'true' }, letter);
}
const taskIcon = (t, big) => iconFor(t.connection && t.connection.icon, whoName(t), big);

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
  return S.open.concat(callItems()).filter((t) => !S.pending.has(t.task_id) || S.pending.get(t.task_id).body.action === 'note');
}
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
function scrubAddress() {
  // A credential never lives in the address bar. If one arrived there, remove it without using it.
  if (/mt_[A-Za-z0-9_-]{6,}/.test(location.href)) history.replaceState(null, '', location.pathname);
}
async function trySignIn(cred, remember) {
  S.cred = cred;
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
  setTimeout(() => { const pk = $('#signin-passkey'); (pk && !pk.hidden ? pk : $('#signin-link')).focus(); }, 0);
}
function signOut(msg) {
  for (const p of S.pending.values()) clearTimeout(p.timer);
  for (const m of S.media.values()) if (m.url) URL.revokeObjectURL(m.url);
  clearTimeout(S.pollTimer);
  if (/^ps_/.test(S.cred || '')) fetch(API + '/v1/account/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + S.cred }, credentials: 'omit', keepalive: true }).catch(() => {});
  sdel('local', 'desk.cred'); sdel('session', 'desk.cred'); sdel('local', 'desk.member'); sdel('session', 'desk.member');
  sdel('local', 'desk.member_label'); sdel('session', 'desk.member_label');
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('desk.later.')) localStorage.removeItem(k); } catch (e) { /* blocked */ }
  Object.assign(S, { cred: null, member: null, memberLabel: null, memberId: null, account: undefined, passkeyMsg: null, open: [], history: [], conns: null, blocks: null, offers: [], settings: null, sel: null, hsel: null,
    filter: null, later: {}, lastOk: 0, lastErr: null, shownOnce: null, cardSig: '' });
  S.pending.clear(); S.sentLocal.clear(); S.drafts.clear(); S.failed.clear(); S.media.clear();
  $('#undo').hidden = true; $('#signin-link').value = ''; document.title = 'Desk · person.tools'; setFavicon(0, false);
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
async function passkeySignIn(btn) {
  const remember = $('#signin-remember').checked;
  if (!window.PublicKeyCredential) { showSignIn('This browser cannot use passkeys. Paste your page link instead.'); return; }
  btn.disabled = true; const old = btn.textContent; btn.textContent = 'Waiting for your passkey…';
  try {
    const o = await plain('POST', '/v1/account/login/options', {});
    const pk = Object.assign({}, o.publicKey); pk.challenge = b64u.dec(pk.challenge);
    if (Array.isArray(pk.allowCredentials)) pk.allowCredentials = pk.allowCredentials.map((c) => Object.assign({}, c, { id: b64u.dec(c.id) }));
    const c = await navigator.credentials.get({ publicKey: pk });
    const out = await plain('POST', '/v1/account/login', { challenge_id: o.challenge_id, credential: { id: c.id, rawId: b64u.enc(c.rawId), type: c.type,
      response: { clientDataJSON: b64u.enc(c.response.clientDataJSON), authenticatorData: b64u.enc(c.response.authenticatorData),
        signature: b64u.enc(c.response.signature), userHandle: c.response.userHandle ? b64u.enc(c.response.userHandle) : null } } });
    const session = out.session;
    if (!session) throw { message: 'person.tools did not give a session.' };
    const mems = membershipsOf(await plain('GET', '/v1/account', undefined, session));
    if (!mems.length) { showSignIn('Your passkey works, but no page is linked to it yet. Sign in once with your page link, then add a passkey from your page.'); return; }
    const go = async (m) => {
      S.member = m.member_id; S.memberLabel = memberLabel(m); sset(remember ? 'local' : 'session', 'desk.member_label', S.memberLabel);
      try { start(await trySignIn(session, remember)); }
      catch (e) { S.cred = null; S.member = null; showSignIn(e.message); }
    };
    if (mems.length === 1) { await go(mems[0]); return; }
    // Several pages: the person picks one; never chosen by name on their behalf.
    const pick = $('#signin-pick');
    pick.replaceChildren(h('p', { class: 'label', id: 'pick-h' }, 'Your passkey opens more than one page. Which one?'),
      ...mems.map((m) => h('button', { class: 'btn', type: 'button', onclick: () => { pick.hidden = true; go(m); } }, memberLabel(m))));
    pick.setAttribute('role', 'group'); pick.setAttribute('aria-labelledby', 'pick-h'); pick.hidden = false;
    const first = pick.querySelector('button'); if (first) first.focus();
  } catch (e) {
    showSignIn(e && e.name === 'NotAllowedError' ? 'No passkey was used. Try again, or paste your page link.' : 'Not signed in: ' + ((e && e.message) || e));
  } finally { btn.disabled = false; btn.textContent = old; }
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

if (PASSKEY_ON && window.PublicKeyCredential) {
  // With a passkey there is no link to find: it leads, and the page link is the other way in.
  const b = $('#signin-passkey'), o = $('#signin-or'), form = $('#signin-form');
  b.hidden = false; o.hidden = false; b.classList.add('btn-you');
  form.querySelector('button[type=submit]').classList.remove('btn-you');
  form.parentNode.insertBefore(b, form); form.parentNode.insertBefore($('#signin-pick'), form); form.parentNode.insertBefore(o, form);
  b.addEventListener('click', () => passkeySignIn(b));
}

/* ---------- loading and looking again ---------- */
function absorb(data) {
  const open = Array.isArray(data && data.open) ? data.open : [];
  const prevSel = S.sel;
  S.open = open;
  S.history = Array.isArray(data && data.history) ? data.history : [];
  for (const id of S.sentLocal.keys()) if (S.history.some((t) => t.task_id === id)) S.sentLocal.delete(id);
  // Later and drafts only for asks still open
  const ids = new Set(open.map((t) => t.task_id).concat(callItems().map((t) => t.task_id)));
  let changed = false;
  for (const id of Object.keys(S.later)) if (!ids.has(id) && !S.pending.has(id)) { delete S.later[id]; changed = true; }
  if (changed) saveLater();
  if (prevSel && !ids.has(prevSel) && !S.pending.has(prevSel) && !S.failed.has(prevSel)) {
    const order = lastOrder; const i = order.indexOf(prevSel);
    S.gone = 'That ask left your list: its AI withdrew it, or you answered it on another device.';
    S.sel = null;
    const next = flatOrder();
    if (next.length) S.sel = (order.slice(i + 1).find((id) => next.some((t) => t.task_id === id))) || next[0].task_id;
  }
  S.lastOk = Date.now(); S.lastErr = null;
}
let lastOrder = [];
async function refresh(quiet) {
  if (!S.cred || S.loading) return;
  S.loading = true;
  try {
    const [data, offers] = await Promise.all([api('GET', '/v1/member/tasks'), api('GET', '/v1/member/offers').catch(() => null)]);
    if (offers && Array.isArray(offers.offers)) S.offers = offers.offers;
    absorb(data);
    for (const c of callItems()) if (!S.seats.has(c.offer.seat_id)) loadSeat(c); // the ring card is whole before it is opened
    S.pollDelay = POLL_MS;
    if (!S.memberId && !S.settings) loadSettings();
  } catch (e) {
    if (e.status === 401 || e.status === 403 || e.status === 404) { S.loading = false; signOut('This page link stopped working (you may have left the panel, or the link was changed). Paste your current link.'); return; }
    S.lastErr = e.message; S.pollDelay = Math.min(S.pollDelay * 2, 120000);
  } finally { S.loading = false; }
  render();
  schedule();
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
    S.settings = s; if (s && s.member_id && s.member_id !== S.memberId) { S.memberId = s.member_id; loadLater(); render(); }
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
async function loadConns() {
  try { const c = await api('GET', '/v1/member/connections'); S.conns = Array.isArray(c && c.connections) ? c.connections : []; S.connLimit = c && c.limit; }
  catch (e) { S.connsErr = e.message; if (S.conns === null) S.conns = []; }
  if (S.view === 'ais') renderAIs();
  if (!visibleOpen().length && S.view === 'asks') renderCard();
}

/* ---------- answering: nothing leaves this computer for five seconds ---------- */
function labelFor(t, body) {
  if (body.action === 'call_not_now') return 'Decline this call';
  if (body.action === 'note') return 'Note: ' + body.note;
  if (body.action === 'answer') return body.choice != null ? body.choice : '“' + (body.text || '') + '”';
  if (body.action === 'done') return 'Done';
  if (body.action === 'not_now') return 'Not now';
  if (body.action === 'approve') return (t.step.approve_label || 'Approve') + (body.text ? ' (your edited words)' : '');
  if (body.action === 'deny') return t.step.deny_label || 'Deny';
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
    const i = order.indexOf(t.task_id);
    const rest = order.filter((id) => id !== t.task_id && !S.pending.has(id));
    S.sel = order.slice(i + 1).find((id) => rest.includes(id)) || rest[rest.length - 1] || null;
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
    const res = await api('POST', '/v1/member/tasks/' + enc(id), p.body, { keepalive });
    if (p.body.action === 'note') {
      const live = S.open.find((x) => x.task_id === id);
      if (live) live.notes = Array.isArray(res && res.notes) ? res.notes : (live.notes || []).concat([{ at: new Date().toISOString(), note: p.body.note, by: 'person' }]);
      draft(id).note = '';
    } else {
      S.open = S.open.filter((x) => x.task_id !== id);
      const reply = Object.assign({ at: new Date().toISOString(), choice: null, text: null, note: null }, p.body,
        p.body.action === 'approve' ? { approved_text: p.body.text || t.step.text } : {});
      S.sentLocal.set(id, Object.assign({}, t, { state: (res && res.state) || 'answered', reply }));
      S.drafts.delete(id);
      if (S.later[id]) { delete S.later[id]; saveLater(); }
    }
    showSent(p);
  } catch (e) {
    if (p.body.local) return;
    if (e.status === 409) {
      S.open = S.open.filter((x) => x.task_id !== id); S.drafts.delete(id);
      showSent(p, 'Already answered on another device. Nothing changed.');
    } else if (e.status === 404 || e.status === 410) {
      S.open = S.open.filter((x) => x.task_id !== id);
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
  box.className = 'undo'; box.replaceChildren();
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
  box.className = 'undo ' + (bad ? 'failed' : 'sent'); box.replaceChildren();
  box.append(h('div', { class: 'u-row' }, h('span', { class: 'u-what' }, msg || [p.body.action === 'note' ? 'Note sent to ' : 'Sent to ', h('b', null, whoName(p.task)), ': ', p.label])));
  box.hidden = false;
  sr(typeof msg === 'string' ? msg : 'Sent to ' + whoName(p.task) + '.');
  sentTimer = setTimeout(() => { if (!S.pending.size) box.hidden = true; }, bad ? 6000 : 1800);
}

function takeCall(t) {
  const u = safeUrl(t.offer.seat_url);
  if (!u) { flashCard('This call has no page to open. Take it on your phone.'); return; }
  const w = window.open(u.href, '_blank', 'noopener,noreferrer');
  sr(w === null ? 'The call opened in a new tab.' : 'The call opened in a new tab.');
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
      if (t.isCall) S.offers = S.offers.filter((o) => o.call_id !== t.offer.call_id); // the service may still list it
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
  else if (S.lastOk) { el.textContent = 'Checked ' + fmtClock.format(S.lastOk); el.title = 'Looks again every 15 seconds while this tab is open.'; el.classList.remove('bad'); }
}
function renderBanner() {
  const b = $('#banner');
  const now = visibleOpen().filter((t) => urg(t) === 0 && !isLater(t) && !t.isCall);
  if (!now.length || S.view !== 'asks') { b.hidden = true; return; }
  const first = fair(now)[0];
  b.replaceChildren(h('span', { class: 'label' }, 'Now'),
    h('span', null, now.length === 1 ? (first.isCall ? ['A call for you: ', String(first.offer.minutes || '?'), ' minutes', first.offer.pay && first.offer.pay.unpaid_test ? ', unpaid test' : '', '. ', whoName(first)] : [whoName(first), ': ', first.title])
      : [String(now.length), ' need you now. First: ', whoName(first), ': ', first.title]),
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
  t ? (t.connection && ICONS[t.connection.icon] ? svgIcon(t.connection.icon) : null) : null, label, h('b', null, String(n)));
  const kids = [chip(null, 'All', list.length, null)];
  [...groups.entries()].sort((a, b) => b[1].n - a[1].n || whoName(a[1].t).localeCompare(whoName(b[1].t)))
    .forEach(([k, g]) => kids.push(chip(k, whoName(g.t), g.n, g.t)));
  wrap.replaceChildren(...(list.length ? kids : []));
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
  const sub = opts.history
    ? [h('span', { class: 'from' }, whoName(t)), h('span', { class: 'kind' }, '· ' + historyAnswer(t))]
    : [...flags, h('span', { class: 'from' }, whoName(t)), h('span', { class: 'kind' }, '· ' + KIND_WORD[k])];
  const selected = opts.history ? S.hsel === t.task_id : S.sel === t.task_id;
  return h('li', { class: 'item' + (selected ? ' sel' : ''), role: 'option', id: (opts.history ? 'h-' : 'o-') + t.task_id,
    'aria-selected': selected ? 'true' : 'false', dataset: { id: t.task_id },
    onclick: () => { if (opts.history) { S.hsel = t.task_id; renderHistory(); } else { S.sel = t.task_id; render(); } openReading(); } },
  t.isCall ? iconFor(null, t.from) : taskIcon(t), h('span', { class: 't' }, t.title || (t.step && t.step.text) || 'An ask'),
  h('span', { class: 'age', title: when(opts.history && t.reply ? t.reply.at : t.created_at) }, age(opts.history && t.reply ? t.reply.at : t.created_at)),
  h('span', { class: 'sub' }, sub));
}
function renderList() {
  const ol = $('#list');
  const groups = ordered();
  const flat = groups.flatMap((g) => g.items);
  lastOrder = flat.map((t) => t.task_id);
  if (S.sel && !lastOrder.includes(S.sel) && !S.pending.has(S.sel) && !S.failed.has(S.sel)) S.sel = null;
  if (!S.sel && flat.length) S.sel = flat[0].task_id;
  const kids = [];
  for (const g of groups) {
    if (g.head) kids.push(h('li', { class: 'group-h' + (g.later ? ' later-h' : ''), role: 'presentation' },
      g.later ? null : taskIcon(g.items[0]), g.later ? 'Later · kept on this computer' : g.head, h('span', { class: 'n' }, String(g.items.length))));
    for (const t of g.items) kids.push(rowFor(t));
  }
  if (!flat.length) kids.push(h('li', { class: 'list-empty', role: 'presentation' }, S.filter ? 'Nothing from this AI.' : 'No open asks.'));
  ol.replaceChildren(...kids);
  ol.setAttribute('aria-activedescendant', S.sel ? 'o-' + S.sel : '');
  const selEl = S.sel && document.getElementById('o-' + S.sel);
  if (selEl) selEl.scrollIntoView({ block: 'nearest' });
}

/* ---------- rendering: the card ---------- */
function cardSignature(t) {
  if (!t) return 'empty:' + (S.conns ? S.conns.length : '-') + ':' + S.lastOk + ':' + S.history.length;
  const p = S.pending.get(t.task_id);
  if (t.isCall) { const st = S.seats.get(t.offer.seat_id); return JSON.stringify([t.task_id, t.offer.state, t.offer.held_until, st ? (st.loading ? 'l' : st.error || 'ok') : '', !!S.pending.get(t.task_id)]); }
  const m = S.media.get(t.task_id);
  return JSON.stringify([t.task_id, t.notes, t.step, t.card, t.title, t.unlocks, t.urgency, !!(p), p && p.body.note, S.failed.get(t.task_id), isLater(t), S.gone, m ? (m.url || m.error || 'loading') : '']);
}
function renderCard(force) {
  const pane = $('#card');
  const t = selectedTask();
  const sig = cardSignature(t);
  if (!force && sig === S.cardSig && pane.firstChild) return;
  // keep focus and caret across a redraw
  const ae = document.activeElement;
  const keep = ae && pane.contains(ae) && ae.dataset && ae.dataset.field ? { f: ae.dataset.field, s: ae.selectionStart, e: ae.selectionEnd } : null;
  S.cardSig = sig;
  pane.replaceChildren(t ? cardFor(t) : emptyCard());
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
  return h('div', { class: 'who' }, taskIcon(t, true),
    h('div', null, h('div', { class: 'name' }, whoName(t)),
      h('div', { class: 'basis' }, yours ? 'Your AI · you connected it' : 'Named by the asker; not checked by person.tools')),
    h('div', { class: 'meta' }, extra || h('span', { class: 'label' }, t.urgency === 'now' ? 'Now' : t.urgency === 'today' ? 'Today' : 'Whenever'),
      h('span', { class: 'when' }, 'Asked ' + when(t.created_at))));
}
function blocksFor(t) {
  const blocks = t.card && Array.isArray(t.card.blocks) ? t.card.blocks : [];
  const out = [];
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    if (typeof b.headline === 'string') out.push(h('p', { class: 'b-headline' }, b.headline));
    else if (typeof b.text === 'string') out.push(h('p', { class: 'b-text' }, linked(b.text)));
    else if (Array.isArray(b.facts)) out.push(h('dl', { class: 'b-facts' }, b.facts.filter((f) => f && f.label !== undefined).map((f) => [h('dt', null, String(f.label)), h('dd', null, String(f.value ?? ''))])));
    else if (b.price !== undefined) out.push(h('p', { class: 'b-price' }, typeof b.price === 'object' ? [b.price.amount, ' ', b.price.currency || '', b.price.label ? ' · ' + b.price.label : ''] : String(b.price)));
    else if (b.when_where !== undefined) out.push(h('p', { class: 'b-when' }, typeof b.when_where === 'object' ? [b.when_where.when || '', b.when_where.when && b.when_where.where ? ' · ' : '', b.when_where.where || ''] : String(b.when_where)));
    // media, choices and input blocks are drawn by the Desk from the ask itself; any other block is ignored (8.1)
  }
  return out.length ? h('div', { class: 'blocks' }, out) : null;
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
  const facts = [['Time', (o.minutes || (sd && sd.minutes) || '?') + ' minutes'],
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
  ans.push(ansBtn(o.state === 'offered' ? 'Take this call and ' + verb : 'Open the call again', '→', () => takeCall(t), 'btn-you'));
  kids.push(h('div', { class: 'answers', role: 'group', 'aria-label': 'This call' }, ans));
  kids.push(h('p', { class: 'footnote' }, 'The call opens in a new tab on run.person.tools. Nothing starts until you press play there, and Stop is on every screen. ',
    o.state === 'offered' ? 'Decline is free and leaves no mark; this call is then not offered to you again. If you do nothing, the hold simply ends.' : ''));
  kids.push(h('div', { class: 'legend', 'aria-hidden': 'true' }, h('span', null, kbd('J'), kbd('K'), 'move'),
    yn.no ? h('span', null, kbd('←'), kbd('N'), 'Decline') : null, h('span', null, kbd('→'), kbd('Y'), o.state === 'offered' ? 'Take this call' : 'Open it again'),
    h('span', null, kbd('Z'), 'undo'), h('span', null, kbd('?'), 'every key')));
  kids.push(h('p', { class: 'card-foot' }, h('button', { class: 'linkish', type: 'button', onclick: () => blockAsker(t) }, 'Block ' + t.from + '…')));
  return h('article', { class: 'card', 'aria-labelledby': 'card-title' }, kids);
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
  kids.push(whoBlock(t));
  kids.push(h('div', { class: 'ai-says' }, h('span', { class: 'label' }, 'An AI is asking'),
    h('span', { class: 'label' }, '· ' + KIND_WORD[k]), isLater(t) ? h('span', { class: 'flag later' }, 'Later') : null));
  kids.push(h('h2', { class: 'card-title', id: 'card-title' }, t.title || 'An ask'));
  if (S.gone) { kids.push(h('p', { class: 'help' }, S.gone)); S.gone = null; }
  if (failed) kids.push(h('div', { class: 'notsent', role: 'alert' }, h('span', { class: 'label' }, 'Not sent'), h('p', null, failed.message),
    ansBtn('Send it again', null, () => answer(t, failed.body))));
  const blocks = blocksFor(t); if (blocks) kids.push(blocks);
  const media = mediaFor(t); if (media) kids.push(media);

  // The ask's own words, then what the answer lets it do
  if (k === 'approve' && s.editable) {
    const cur = d.approve === null ? (s.text || '') : d.approve;
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
  } else if (s.text) {
    kids.push(h('div', { class: 'ask-words' }, h('p', null, linked(s.text))));
  }
  if (k === 'link') {
    const u = safeUrl(s.url);
    kids.push(h('div', { class: 'linkbox' }, h('span', { class: 'host' }, u ? u.host : 'Not a web address'),
      h('span', { class: 'url', title: s.url || '' }, s.url || ''),
      u ? h('a', { class: 'btn', href: u.href, target: '_blank', rel: 'noopener noreferrer', id: 'open-link' }, 'Open link', kbd('O')) : null));
  }
  if (t.unlocks) kids.push(h('div', { class: 'unlocks' }, h('span', { class: 'label' }, 'After your answer, in its words'), h('p', { class: 'its-words' }, '“', linked(t.unlocks), '”')));

  // Answers: the kinds of 8.1, with the ask's own words on its two answers
  const ans = [];
  const chosen = p && p.body.action !== 'note' ? p.body : null;
  const isChosen = (b) => chosen && chosen.action === b.action && (chosen.choice ?? null) === (b.choice ?? null);
  if (k === 'choice') {
    const many = s.choices.length > 2;
    s.choices.forEach((c, i) => {
      const body = { action: 'answer', choice: c };
      const key = many ? String(i + 1) : (i === 0 ? '←' : i === 1 ? '→' : String(i + 1));
      ans.push(ansBtn(c, key, () => answer(t, body), isChosen(body) ? 'chosen' : ''));
    });
    ans.push(h('span', { class: 'spacer' }));
    ans.push(ansBtn('Not now', 'X', () => answer(t, { action: 'not_now' })));
    ans.push(laterBtn(t));
    kids.push(h('div', { class: 'answers choices', role: 'group', 'aria-label': 'Your answer' }, ans));
  } else if (k === 'words') {
    const send = () => { const v = (d.text || '').trim(); if (!v) { flashCard('Write a line first, or choose Done or Not now.'); return; } answer(t, { action: 'answer', text: v }); };
    kids.push(h('div', { class: 'field' },
      h('div', { class: 'row-l' }, h('label', { class: 'label', for: 'f-text' }, 'Your answer'), h('p', { class: 'help' }, 'Enter sends · Shift+Enter for a new line · while you type, other keys only type')),
      textField('f-text', 'text', d.text, { placeholder: 'Write a line', 'aria-describedby': 'card-title' }, (v) => { d.text = v; },
        (ev) => { if (ev.key === 'Enter' && !ev.shiftKey && !ev.metaKey && !ev.ctrlKey && !ev.isComposing) { ev.preventDefault(); send(); } })));
    ans.push(ansBtn('Send', '↵', send, 'btn-you'));
    ans.push(h('span', { class: 'spacer' }));
    ans.push(ansBtn(yn.no.label, '←', () => answer(t, yn.no.body), isChosen(yn.no.body) ? 'chosen' : ''));
    ans.push(ansBtn(yn.yes.label, '→', () => answer(t, yn.yes.body), isChosen(yn.yes.body) ? 'chosen' : ''));
    ans.push(laterBtn(t));
    kids.push(h('div', { class: 'answers', role: 'group', 'aria-label': 'Your answer' }, ans));
  } else if (k === 'approve' || k === 'link' || k === 'command') {
    ans.push(ansBtn(yn.no.label, '←', () => answer(t, yn.no.body), isChosen(yn.no.body) ? 'chosen' : ''));
    ans.push(ansBtn(yn.yes.label, '→', () => answer(t, yn.yes.body), isChosen(yn.yes.body) ? 'chosen' : ''));
    ans.push(h('span', { class: 'spacer' }));
    if (k === 'approve') ans.push(ansBtn('Not now', 'X', () => answer(t, { action: 'not_now' })));
    ans.push(laterBtn(t));
    kids.push(h('div', { class: 'answers', role: 'group', 'aria-label': 'Your answer' }, ans));
    if (k === 'approve') kids.push(h('p', { class: 'footnote' }, 'Approvals sent from the Desk carry no device signature, and ' + whoName(t) + ' can see that.'));
  } else {
    ans.push(ansBtn('Not now', 'X', () => answer(t, { action: 'not_now' })));
    ans.push(laterBtn(t));
    kids.push(h('p', { class: 'help' }, 'This kind of ask is new to the Desk. You can say Not now, send a note, or answer it on your phone.'));
    kids.push(h('div', { class: 'answers' }, ans));
  }

  // Notes: one may ride with any answer, or go alone and leave the ask open
  kids.push(notesBlock(t, d, p));
  kids.push(legendFor(t));
  kids.push(h('p', { class: 'card-foot' }, h('button', { class: 'linkish', type: 'button', onclick: () => blockAsker(t) }, 'Block ' + whoName(t) + '…')));
  return h('article', { class: 'card', 'aria-labelledby': 'card-title' }, kids);
}
function notesBlock(t, d, p) {
  const notes = (Array.isArray(t.notes) ? t.notes : []).slice();
  if (p && p.body.action === 'note') notes.push({ at: null, note: p.body.note, by: 'person', pending: true });
  const last = notes[notes.length - 1];
  const kids = [h('span', { class: 'label' }, 'Notes')];
  if (notes.length) kids.push(h('ol', { class: 'thread' }, notes.map((n) => h('li', null,
    h('span', { class: 'by' + (n.by === 'asker' ? ' asker' : '') }, n.by === 'asker' ? whoName(t) : 'You'),
    h('span', { class: 'tx' }, linked(n.note || '')),
    h('span', { class: 'tm' }, n.pending ? 'sending…' : (n.at ? fmtClock.format(ms(n.at)) : ''))))));
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
  if (k === 'choice' || k === 'other' || k === 'approve') items.push(item(['X'], 'Not now (the AI is told)'));
  if (k === 'link') items.push(item(['O'], 'open link'));
  if (k === 'command') items.push(item(['C'], 'copy'));
  items.push(item(['Enter'], k === 'words' ? 'write' : 'note'), item(['U'], isLater(t) ? 'back from Later' : 'Later (only here)'), item(['Z'], 'undo'), item(['?'], 'every key'));
  return h('div', { class: 'legend', 'aria-hidden': 'true' }, items);
}
function emptyCard() {
  const conns = (S.conns || []).filter((c) => !c.revoked_at);
  if (S.conns === null) loadConns();
  const pendingN = S.pending.size;
  const kids = [h('h2', null, pendingN ? 'Sending your answers.' : 'Nothing is waiting for you.'),
    h('p', null, 'When one of your AIs asks you something, it appears here: first if it is urgent, with a line across the top. Nothing makes a sound.')];
  if (conns.length) {
    kids.push(h('ul', { class: 'ais' }, conns.map((c) => h('li', null, iconFor(c.icon, c.name), h('b', null, c.name),
      h('span', { class: 'm' }, c.blocked ? 'blocked' : c.quiet ? 'quiet' : 'last asked ' + agoWords(c.last_used_at))))));
  } else if (S.conns) {
    kids.push(h('p', null, 'No AI is connected to you yet. Connect one and you get a key and the words to give it. The key lets that AI ask you things and read your answers, and nothing else; you can revoke it with one click.'));
  }
  kids.push(h('div', { class: 'answers' }, ansBtn(conns.length ? 'Connect another AI' : 'Connect an AI', 'A', () => setView('ais', true), conns.length ? '' : 'btn-you'),
    S.history.length || S.sentLocal.size ? ansBtn('History', 'H', () => setView('history')) : null));
  kids.push(h('p', { class: 'help' }, S.lastOk ? 'Last looked ' + fmtClock.format(S.lastOk) + '. The Desk looks again every 15 seconds while this tab is open, and the tab\'s icon shows how many asks are waiting.' : ''));
  const prim = (keys, what) => [h('dt', null, keys.map(kbd)), h('dd', null, what)];
  kids.push(h('div', { class: 'primer' }, h('span', { class: 'label' }, 'When asks arrive'),
    h('dl', null, prim(['J', 'K'], 'move down and up the list'), prim(['→', 'Y'], 'the card\'s yes: Done, approve, the second choice'),
      prim(['←', 'N'], 'its no: Not now, deny, the first choice'), prim(['Z'], 'undo, for five seconds'), prim(['?'], 'every key'))));
  return h('div', { class: 'empty' }, kids);
}

/* ---------- History: answered asks, searchable ---------- */
function historyItems() {
  const map = new Map();
  for (const t of S.history) map.set(t.task_id, t);
  for (const [id, t] of S.sentLocal) if (!map.has(id)) map.set(id, t);
  return [...map.values()].sort((a, b) => ms(b.reply && b.reply.at) - ms(a.reply && a.reply.at) || tms(b) - tms(a));
}
function historyAnswer(t) {
  const r = t.reply || {}, s = t.step || {};
  if (r.action === 'answer') return r.choice != null ? 'You picked ' + r.choice : r.text ? 'You wrote: ' + r.text : 'Answered';
  if (r.action === 'done') return 'Done';
  if (r.action === 'not_now') return 'Not now';
  if (r.action === 'approve') return (s.approve_label || 'Approve') + (r.approved_text && r.approved_text !== s.text ? ', with your words' : '');
  if (r.action === 'deny') return s.deny_label || 'Deny';
  return t.state || 'Answered';
}
function searchText(t) {
  const r = t.reply || {}, s = t.step || {};
  return [t.title, s.text, s.command, s.url, (s.choices || []).join(' '), whoName(t), t.unlocks, r.choice, r.text, r.note, r.approved_text,
    (t.notes || []).map((n) => n.note).join(' '), historyAnswer(t)].filter(Boolean).join(' \n ').toLowerCase();
}
function renderHistory() {
  const q = ($('#search').value || '').trim().toLowerCase();
  const all = historyItems();
  const items = q ? all.filter((t) => q.split(/\s+/).every((w) => searchText(t).includes(w))) : all;
  if (!S.hsel || !items.some((t) => t.task_id === S.hsel)) S.hsel = items.length ? items[0].task_id : null;
  const ol = $('#hlist');
  ol.replaceChildren(...(items.length ? items.map((t) => rowFor(t, { history: true }))
    : [h('li', { class: 'list-empty', role: 'presentation' }, q ? 'Nothing answered matches “' + q + '”.' : 'Nothing answered yet.')]));
  ol.setAttribute('aria-activedescendant', S.hsel ? 'h-' + S.hsel : '');
  const selEl = S.hsel && document.getElementById('h-' + S.hsel); if (selEl) selEl.scrollIntoView({ block: 'nearest' });
  const t = items.find((x) => x.task_id === S.hsel);
  const pane = $('#hcard');
  if (!t) { pane.replaceChildren(h('div', { class: 'empty' }, h('h2', null, q ? 'No match.' : 'Nothing answered yet.'),
    h('p', null, 'Each ask you answer is kept here with your answer and its notes, newest first.'))); return; }
  const r = t.reply || {}, s = t.step || {};
  const kids = [h('button', { class: 'linkish back', type: 'button', onclick: () => closeReading() }, '← The list'),
    whoBlock(t, h('span', { class: 'label' }, 'Answered')),
    h('div', { class: 'ai-says' }, h('span', { class: 'label' }, 'An AI asked'), h('span', { class: 'label' }, '· ' + KIND_WORD[kindOf(t)])),
    h('h2', { class: 'card-title' }, t.title || 'An ask')];
  const blocks = blocksFor(t); if (blocks) kids.push(blocks);
  const media = mediaFor(t); if (media) kids.push(media);
  if (kindOf(t) === 'command') kids.push(h('div', { class: 'cmd' }, h('pre', null, s.command || '')));
  else if (s.text) kids.push(h('div', { class: 'ask-words' }, h('p', null, linked(s.text))));
  if (kindOf(t) === 'link' && s.url) kids.push(h('p', { class: 'cmd-where' }, s.url));
  if (t.unlocks) kids.push(h('div', { class: 'unlocks' }, h('span', { class: 'label' }, 'After your answer, in its words'), h('p', { class: 'its-words' }, '“', t.unlocks, '”')));
  kids.push(h('div', { class: 'sent-as' }, h('span', { class: 'label' }, 'Your answer · ' + when(r.at)), h('p', null, historyAnswer(t)),
    r.action === 'approve' && r.approved_text && r.approved_text !== s.text ? h('p', null, '“' + r.approved_text + '”') : null,
    (r.action === 'approve' || r.action === 'deny') && r.device_approved === false ? h('p', { class: 'help' }, 'Sent without a device signature: the AI sees it carries no device mark.') : null,
    (r.action === 'approve' || r.action === 'deny') && r.device_approved === true ? h('p', { class: 'help' }, 'Signed by your device.') : null,
    r.note ? h('p', null, 'Your note: ' + r.note) : null));
  if (Array.isArray(t.notes) && t.notes.length) kids.push(h('section', { class: 'notes' }, h('span', { class: 'label' }, 'Notes'),
    h('ol', { class: 'thread' }, t.notes.map((n) => h('li', null, h('span', { class: 'by' + (n.by === 'asker' ? ' asker' : '') }, n.by === 'asker' ? whoName(t) : 'You'),
      h('span', { class: 'tx' }, n.note || ''), h('span', { class: 'tm' }, n.at ? fmtClock.format(ms(n.at)) : ''))))));
  pane.replaceChildren(h('article', { class: 'card' }, kids));
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
  if (S.aiMsg) { kids.push(h('p', { class: S.aiMsg.bad ? 'error' : 'saved', role: 'status' }, S.aiMsg.text)); S.aiMsg = null; }
  if (S.shownOnce) kids.push(shownOnceBox(S.shownOnce));
  if (S.conns === null) kids.push(h('p', { class: 'help' }, S.connsErr || 'Loading…'));
  else if (!live.length) kids.push(h('p', null, 'No AI is connected yet.'));
  else kids.push(h('table', { class: 'ai-table' },
    h('thead', null, h('tr', null, h('th', { class: 'label' }, 'AI'), h('th', { class: 'label' }, 'Waiting'), h('th', { class: 'label' }, 'Last asked'),
      h('th', { class: 'label' }, 'Connected'), h('th', { class: 'label' }, h('span', { class: 'sr' }, 'Actions')))),
    h('tbody', null, live.map((c) => h('tr', null,
      h('td', { class: 'name' }, iconFor(c.icon, c.name), c.name, c.quiet ? h('span', { class: 'state' }, 'Quiet') : null, c.blocked ? h('span', { class: 'state blocked' }, 'Blocked') : null),
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
      h('td', { class: 'acts' }, h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => unblock(b) }, 'Unblock')))))));
  if (gone.length) kids.push(h('details', null, h('summary', { class: 'sec-h' }, 'Revoked (' + gone.length + ')'),
    h('table', { class: 'ai-table' }, h('tbody', null, gone.map((c) => h('tr', { class: 'revoked' },
      h('td', { class: 'name' }, iconFor(c.icon, c.name), c.name), h('td', { class: 'when' }, 'revoked ' + fmtDay.format(ms(c.revoked_at)))))))));
  root.replaceChildren(h('div', { class: 'page-in' }, kids));
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
    h('fieldset', { class: 'icons' }, h('legend', { class: 'label' }, 'Its icon'), opts, h('label', null, 'or', emoji)),
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
  try { const r = await api('PATCH', '/v1/member/settings', body); S.settings = r; S.setMsg = { text: note || 'Saved.' }; }
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
    kids.push(h('div', { class: 'set' }, h('div', { class: 'k' }, 'Quiet hours', h('p', { class: 'help' }, 'No call rings you in these hours.' + (q.tz ? ' Zone: ' + q.tz + '.' : ''))),
      h('div', null, 'From ', hours(q.start, (v) => patchSettings({ quiet_start: v }, 'Quiet hours saved.'), 'Quiet from'), ' to ', hours(q.end, (v) => patchSettings({ quiet_end: v }, 'Quiet hours saved.'), 'Quiet until'))));
    kids.push(h('div', { class: 'set' }, h('div', { class: 'k' }, 'Photos and clips', h('p', { class: 'help' }, 'What your AIs send is yours. It is deleted after this many days.')),
      h('div', null, h('select', { 'aria-label': 'Days to keep photos and clips', onchange: (ev) => patchSettings({ material_days: Number(ev.target.value) }, 'Saved.') },
        (days.includes(set.material_days) ? days : days.concat([set.material_days]).sort((a, b) => a - b)).filter((x) => x).map((dd) => h('option', { value: String(dd), selected: dd === set.material_days }, dd + (dd === 1 ? ' day' : ' days')))))));
  }
  const theme = pref('theme', 'system');
  kids.push(h('div', { class: 'set' }, h('div', { class: 'k' }, 'Look', h('p', { class: 'help' }, 'On this computer only.')),
    h('div', null, seg([['system', 'Like this computer'], ['light', 'Light'], ['dark', 'Dark']], theme, (v) => { setPref('theme', v); applyTheme(); renderSettings(); }, 'Look'))));
  const pr = passkeyRow(); if (pr) kids.push(pr);
  const how = /^ps_/.test(S.cred || '') ? 'Signed in with your passkey' + (S.memberLabel ? ', for ' + S.memberLabel : '') + '. ' : 'Signed in with your page link. ';
  kids.push(h('div', { class: 'set' }, h('div', { class: 'k' }, 'This computer', h('p', { class: 'help' }, how + (S.remember ? 'Remembered here until you sign out.' : 'Kept for this tab only; closing it signs you out.'))),
    h('div', null, h('button', { class: 'btn btn-stop', type: 'button', onclick: () => askSignOut() }, 'Sign out'),
      h('p', { class: 'help' }, 'Signing out removes the link and everything the Desk kept on this computer.'))));
  root.replaceChildren(h('div', { class: 'page-in' }, kids));
}
function applyTheme() { const v = pref('theme', 'system'); if (v === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }

/* ---------- views, overlays ---------- */
function setView(v, focusForm) {
  S.view = v;
  for (const b of $$('.view')) { const on = b.dataset.view === v; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  $('#view-asks').hidden = v !== 'asks'; $('#view-history').hidden = v !== 'history';
  $('#view-ais').hidden = v !== 'ais'; $('#view-settings').hidden = v !== 'settings';
  S.cardSig = '';
  if (v === 'ais') { S.blocks = null; renderAIs(); loadConns(); if (focusForm) setTimeout(() => { const n = $('#c-name'); if (n) n.focus(); }, 50); }
  if (v === 'settings') { renderSettings(); loadSettings(); }
  if (v === 'history') { renderHistory(); setTimeout(() => $('#hlist').focus(), 0); }
  if (v === 'asks') setTimeout(() => $('#list').focus(), 0);
  render();
}
for (const b of $$('.view')) b.addEventListener('click', () => setView(b.dataset.view));
$('#sort').addEventListener('change', (ev) => { S.sort = ev.target.value; setPref('sort', S.sort); render(); });
$('#refresh').addEventListener('click', () => refresh());
$('#signout').addEventListener('click', () => askSignOut());
$('#keys-open').addEventListener('click', () => openOverlay('#keys'));
function askSignOut() {
  if (S.pending.size) confirmBox('Send your answers first?', 'An answer is still waiting out its five seconds. Signing out sends it now.', 'Send and sign out', () => { for (const id of [...S.pending.keys()]) flush(id, true); signOut(); });
  else signOut();
}
let lastFocus = null;
function openOverlay(sel) { lastFocus = document.activeElement; const o = $(sel); o.hidden = false; const f = o.querySelector('[data-close]'); if (f) f.focus(); }
function closeOverlays() { let any = false; for (const o of $$('.overlay')) if (!o.hidden) { o.hidden = true; any = true; } if (any && lastFocus) lastFocus.focus(); return any; }
for (const b of $$('[data-close]')) b.addEventListener('click', () => closeOverlays());
for (const o of $$('.overlay')) o.addEventListener('click', (ev) => { if (ev.target === o) closeOverlays(); });
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
    [['I'], 'Asks'], [['H'], 'History'], [['/'], 'Search history'], [['A'], 'Your AIs'], [[','], 'Settings'], [['R'], 'Look for new asks now'], [['?'], 'These keys'],
  ];
  $('#keymap').replaceChildren(...rows.flatMap(([ks, what]) => [h('dt', null, ks.map(kbd)), h('dd', null, what)]));
}
function focusCard() { const p = $('#card'); p.focus({ preventScroll: true }); }
function openReading() { $('#view-asks').classList.add('reading'); $('#view-history').classList.add('reading'); }
function closeReading() { $('#view-asks').classList.remove('reading'); $('#view-history').classList.remove('reading'); (S.view === 'history' ? $('#hlist') : $('#list')).focus(); }

/* ---------- the keyboard ---------- */
function move(delta) {
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
    case 'ArrowRight': case 'y': if (t && yn && yn.yes) return act(() => (yn.yes.call ? takeCall(t) : answer(t, yn.yes.body))); return;
    case 'ArrowLeft': case 'n': if (t && yn && yn.no) return act(() => answer(t, yn.no.body)); return;
    case 'x': if (t) return act(() => answer(t, t.isCall ? { action: 'call_not_now', local: true } : { action: 'not_now' })); return;
    case 'u': if (t && !t.isCall) return act(() => toggleLater(t)); return;
    case 'z': return act(() => undo());
    case 'Enter': if (t && t.isCall) return act(() => takeCall(t)); if (t && S.view === 'asks') { const f = firstField(); if (f) { ev.preventDefault(); openReading(); f.focus(); } } return;
    case 'o': { const a = $('#open-link'); if (a && S.view === 'asks') { ev.preventDefault(); a.click(); } return; }
    case 'c': { const p = $('#cmd-line'); if (p && t) { ev.preventDefault(); copyText(t.step.command || '', $('.cmd-top .btn')); } return; }
    case 'r': return act(() => refresh());
    case 'i': return act(() => setView('asks'));
    case 'h': return act(() => setView('history'));
    case '/': return act(() => { setView('history'); setTimeout(() => $('#search').focus(), 0); });
    case 'a': return act(() => setView('ais'));
    case ',': return act(() => setView('settings'));
    case '?': return act(() => openOverlay('#keys'));
    default:
      if (/^[1-9]$/.test(k) && t && kindOf(t) === 'choice') { const c = t.step.choices[Number(k) - 1]; if (c !== undefined) act(() => answer(t, { action: 'answer', choice: c })); }
  }
});

/* ---------- start ---------- */
function start(data) {
  $('#booting').hidden = true; $('#signin').hidden = true; $('#desk').hidden = false;
  S.view = 'asks';
  if (data) absorb(data);
  loadSettings(); loadConns();
  api('GET', '/v1/member/offers').then((o) => { if (o && Array.isArray(o.offers)) { S.offers = o.offers; for (const c of callItems()) loadSeat(c); render(); } }).catch(() => {});
  render(); schedule();
  $('#list').focus();
}
applyTheme(); buildKeymap(); scrubAddress();
window.addEventListener('hashchange', scrubAddress);
(async () => {
  const cred = sget('session', 'desk.cred') || sget('local', 'desk.cred');
  if (!cred) { showSignIn(); return; }
  S.cred = cred; S.remember = !!sget('local', 'desk.cred');
  S.member = sget('session', 'desk.member') || sget('local', 'desk.member') || null;
  S.memberLabel = sget('session', 'desk.member_label') || sget('local', 'desk.member_label') || null;
  try { const data = await api('GET', '/v1/member/tasks'); start(data); }
  catch (e) {
    if (e.status === 401 || e.status === 403 || e.status === 404) signOut('This page link stopped working. Paste your current link.');
    else { start(null); S.lastErr = e.message; render(); }
  }
})();
})();
