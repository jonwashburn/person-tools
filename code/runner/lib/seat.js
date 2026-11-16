import { SITE_ORIGINS, NETWORK } from "./hosts.js";

// The runner's server side: forwards a phone's seat requests to the router, and a stand-in for tokens "standin-*".
// The phone only ever talks to this address. Nothing here stores a person's data.

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; " +
    "font-src 'self'; connect-src 'self'; frame-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; " +
    "base-uri 'none'; form-action 'self'; frame-ancestors 'self' " + SITE_ORIGINS.join(" "),
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Permissions-Policy": "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)",
  "X-Robots-Tag": "noindex, nofollow",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Strict-Transport-Security": "max-age=31536000",
};

export function withSecurity(resp, extra = {}) {
  const h = new Headers(resp.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) h.set(k, v);
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

// A state-changing request is accepted only from this runner's own pages. A sandboxed frame (an asker's build) has an
// opaque origin: its requests arrive cross-site with Origin "null" and are refused, so asker code can never answer, stop
// or report for the person (trust's finding, 14 Nov 12:55 AM CT).
export function fromOwnPage(request) {
  const m = request.method;
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return true;
  const site = request.headers.get("Sec-Fetch-Site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("Origin");
  return !!origin && origin === new URL(request.url).origin;
}

// Media links: /mx/<sealed> where sealed = AES-GCM(seat token, media id, expiry) under MEDIA_SECRET. A build served there
// can read only its own sealed link, which opens nothing but that same material.
async function mediaKey(env) {
  const raw = Uint8Array.from(atob((env.MEDIA_SECRET || "").replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (env.MEDIA_SECRET || "").length % 4) % 4)), (c) => c.charCodeAt(0));
  if (raw.length < 16) throw new Error("no media secret");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
const b64u = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4)), (c) => c.charCodeAt(0));
export async function sealMedia(env, seatToken, mediaId) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new TextEncoder().encode(JSON.stringify({ t: seatToken, m: mediaId || null, e: Date.now() + 6 * 3600 * 1000 }));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await mediaKey(env), body));
  const out = new Uint8Array(iv.length + ct.length); out.set(iv); out.set(ct, iv.length);
  return b64u(out);
}
export async function openMedia(env, sealed) {
  const all = unb64u(sealed);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, await mediaKey(env), all.slice(12));
  const d = JSON.parse(new TextDecoder().decode(pt));
  if (!d.t || d.e < Date.now()) throw new Error("expired");
  return d;
}

export function json(obj, status = 200) {
  return withSecurity(new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  }));
}

// The router's address, from this request's own host (chief D1): first label "run" -> "api"; "askpeople-run" -> "askpeople-api".
// The API_BASE setting is only a fallback for a host neither rule covers (local runs).
export function apiBase(request, env) {
  const u = new URL(request.url), host = u.hostname;
  const labels = host.split(".");
  if (labels[0] === "run" && labels.length > 2) return "https://" + ["api"].concat(labels.slice(1)).join(".");
  if (host.includes("askpeople-run")) {
    const parts = host.split(".");
    const i = parts.findIndex((l) => l.includes("askpeople-run"));
    return "https://" + parts.slice(i).join(".").replace("askpeople-run", "askpeople-api");
  }
  if (env && env.API_BASE) return env.API_BASE.replace(/\/$/, "");
  return "https://askpeople-api.pages.dev";
}

// Serve a byte range ourselves when the upstream answered a Range request with the whole body (iPhone needs 206).
async function sliceIfNeeded(request, upstream) {
  const range = request.headers.get("Range");
  if (!range || upstream.status !== 200) return upstream;
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m) return upstream;
  const buf = new Uint8Array(await upstream.arrayBuffer());
  const size = buf.length;
  let start, end;
  if (m[1] === "") { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  const h = new Headers();
  h.set("Content-Type", upstream.headers.get("Content-Type") || "application/octet-stream");
  h.set("Content-Range", `bytes ${start}-${end}/${size}`);
  h.set("Accept-Ranges", "bytes");
  h.set("Content-Length", String(end - start + 1));
  h.set("Cache-Control", "private, max-age=600");
  return new Response(buf.slice(start, end + 1), { status: 206, headers: h });
}

// A build (HTML) from an asker runs in a closed box: no network, no same-origin access, no forms that go anywhere, and no
// password or card field is ever drawn (P1). The iframe is sandboxed too; this holds even if the file is opened directly.
const HTML_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; " +
  "img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; frame-src 'none'; child-src 'none'; " +
  "worker-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'";   // no webrtc 'block': Chrome logs it as an unknown directive on every game; the sandbox and the guard cover WebRTC
// Runs before any of the build's own code (trust's read, 1:11 AM): no WebRTC (which CSP does not cover and which would
// reveal the person's address), no sockets, workers or beacons, no nested frames, and no password, card or one-time-code
// field even when the build makes one later.
const GAME_GUARD = `<script>(function(){var w=window;["RTCPeerConnection","webkitRTCPeerConnection","mozRTCPeerConnection","RTCDataChannel",
"RTCSessionDescription","RTCIceCandidate","RTCRtpSender","RTCRtpReceiver","WebSocket","WebSocketStream","EventSource","WebTransport","Worker",
"SharedWorker","XMLHttpRequest","fetch","open"].forEach(function(n){try{Object.defineProperty(w,n,{value:undefined,writable:false,configurable:false})}catch(e){}});
try{Object.defineProperty(Navigator.prototype,"sendBeacon",{value:function(){return false},writable:false,configurable:false})}catch(e){}
try{Object.defineProperty(Navigator.prototype,"serviceWorker",{get:function(){return undefined},configurable:false})}catch(e){}
try{var ce=Document.prototype.createElement,cens=Document.prototype.createElementNS,NO=/^(iframe|frame|frameset|object|embed|portal|fencedframe)$/i;
Object.defineProperty(Document.prototype,"createElement",{value:function(t){return NO.test(String(t))?ce.call(this,"span"):ce.apply(this,arguments)},writable:false,configurable:false});
Object.defineProperty(Document.prototype,"createElementNS",{value:function(ns,t){return NO.test(String(t).split(":").pop())?ce.call(this,"span"):cens.apply(this,arguments)},writable:false,configurable:false});
["HTMLIFrameElement","HTMLFrameElement","HTMLObjectElement","HTMLEmbedElement"].forEach(function(c){var P=w[c]&&w[c].prototype;if(!P)return;["contentWindow","contentDocument"].forEach(function(k){try{Object.defineProperty(P,k,{get:function(){return null},configurable:false})}catch(e){}});try{Object.defineProperty(P,"getSVGDocument",{value:function(){return null},configurable:false})}catch(e){}});}catch(e){}
try{var FR="iframe,frame,frameset,object,embed,portal,fencedframe",ihd=Object.getOwnPropertyDescriptor(Element.prototype,"innerHTML");
var deep=function(r){if(!r||!r.querySelectorAll)return;r.querySelectorAll(FR).forEach(function(x){x.remove()});r.querySelectorAll("template").forEach(function(t){deep(t.content)})};
var strip=function(n){if(!n||typeof n!=="object"||!n.nodeType)return n;if(n.nodeType===1&&NO.test(n.localName||""))return document.createTextNode("");deep(n);if(n.localName==="template")deep(n.content);return n};
var clean=function(v){var t=ce.call(document,"template");ihd.set.call(t,String(v));deep(t.content);return ihd.get.call(t)};
var lock=function(o,k,d){try{Object.defineProperty(o,k,d)}catch(e){}};
var setter=function(P,k){var d=P&&Object.getOwnPropertyDescriptor(P,k);if(!d||!d.set)return;lock(P,k,{get:d.get,set:function(v){return d.set.call(this,clean(v))},enumerable:d.enumerable,configurable:false})};
setter(Element.prototype,"innerHTML");setter(Element.prototype,"outerHTML");setter(w.ShadowRoot&&ShadowRoot.prototype,"innerHTML");
var strArg=function(P,k,i){var f=P&&P[k];if(typeof f!=="function")return;lock(P,k,{value:function(){var a=Array.prototype.slice.call(arguments);if(a.length>i)a[i]=clean(a[i]);return f.apply(this,a)},writable:false,configurable:false})};
strArg(Element.prototype,"insertAdjacentHTML",1);strArg(Element.prototype,"setHTMLUnsafe",0);strArg(Element.prototype,"setHTML",0);strArg(w.ShadowRoot&&ShadowRoot.prototype,"setHTMLUnsafe",0);strArg(w.ShadowRoot&&ShadowRoot.prototype,"setHTML",0);
strArg(Range.prototype,"createContextualFragment",0);if(typeof Document.parseHTMLUnsafe==="function")strArg(Document,"parseHTMLUnsafe",0);
["write","writeln"].forEach(function(k){var f=Document.prototype[k];if(typeof f==="function")lock(Document.prototype,k,{value:function(){return f.apply(this,Array.prototype.map.call(arguments,clean))},writable:false,configurable:false})});
var ex=Document.prototype.execCommand;if(typeof ex==="function")lock(Document.prototype,"execCommand",{value:function(c,u,v){if(/^inserthtml/i.test(String(c)))v=clean(v);return ex.call(this,c,u,v)},writable:false,configurable:false});
var dp=w.DOMParser&&DOMParser.prototype.parseFromString;if(dp)lock(DOMParser.prototype,"parseFromString",{value:function(t,ty){var d=dp.call(this,/html/i.test(String(ty))&&!/xml/i.test(String(ty))?clean(t):t,ty);deep(d);return d},writable:false,configurable:false});
var node=function(P,k,idx){var f=P&&P[k];if(typeof f!=="function")return;lock(P,k,{value:function(){var a=Array.prototype.slice.call(arguments);if(idx<0)a=a.map(strip);else a[idx]=strip(a[idx]);return f.apply(this,a)},writable:false,configurable:false})};
node(Node.prototype,"appendChild",0);node(Node.prototype,"insertBefore",0);node(Node.prototype,"replaceChild",0);
[Element.prototype,DocumentFragment.prototype,Document.prototype].forEach(function(P){["append","prepend","replaceChildren"].forEach(function(k){node(P,k,-1)});node(P,"moveBefore",0)});
[Element.prototype,CharacterData.prototype,DocumentType.prototype].forEach(function(P){["before","after","replaceWith"].forEach(function(k){node(P,k,-1)})});
node(Element.prototype,"insertAdjacentElement",1);node(Range.prototype,"insertNode",0);node(Range.prototype,"surroundContents",0);
node(Document.prototype,"importNode",0);node(Document.prototype,"adoptNode",0)}catch(e){}
function bad(el){if(!el||!el.tagName)return false;var tg=el.tagName;if(tg==="IFRAME"||tg==="FRAME"||tg==="OBJECT"||tg==="EMBED"||tg==="PORTAL"||tg==="FENCEDFRAME")return true;
if(tg!=="INPUT")return false;var t=(el.type||"").toLowerCase(),a=(el.autocomplete||"").toLowerCase(),n=((el.name||"")+" "+(el.id||"")+" "+(el.placeholder||"")).toLowerCase();
return t==="password"||a.indexOf("cc-")===0||a.indexOf("password")>=0||a.indexOf("one-time")>=0||/card|cvv|cvc|iban|passw|otp|one-time|pin\\b/.test(n)}
function sweep(root){if(bad(root)){root.remove();return}if(root.querySelectorAll)root.querySelectorAll("input,iframe,frame,object,embed,portal").forEach(function(x){if(bad(x))x.remove()})}
new MutationObserver(function(ms){ms.forEach(function(m){if(m.type==="attributes"){if(bad(m.target))m.target.remove()}else m.addedNodes.forEach(function(x){if(x.nodeType===1)sweep(x)})})})
.observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:["type","autocomplete","name","id","placeholder"]});
var pm=w.parent&&w.parent.postMessage?w.parent.postMessage.bind(w.parent):null,nonce=null,m=/[#&]ptn=([A-Za-z0-9]{8,64})/.exec(location.hash||"");
if(m){nonce=m[1];try{history.replaceState(null,"",location.pathname+location.search)}catch(e){}}
var inputs=0,sent=0;function count(e){if(e.isTrusted)inputs++}
w.addEventListener("pointerdown",count,true);w.addEventListener("keydown",count,true);
if(pm&&nonce)setInterval(function(){if(inputs!==sent){sent=inputs;pm({source:"pt-guard",n:nonce,inputs:inputs},"*")}},1500);})();</script>`;
export async function hardenHtml(resp) {
  const ct = resp.headers.get("Content-Type") || "";
  if (!/html|xml|svg/i.test(ct)) return resp;
  // a build with no literal <head> or <body> still gets the guard first
  let text = await resp.text();
  // the guard runs before any of the build's own code: right after a leading doctype, otherwise at the very start
  const dt = /^\uFEFF?\s*<!doctype[^>]*>/i.exec(text);
  text = dt ? text.slice(0, dt[0].length) + GAME_GUARD + text.slice(dt[0].length) : GAME_GUARD + text;
  resp = new Response(text, { status: resp.status, headers: resp.headers });
  const h = new Headers(resp.headers);
  h.set("Content-Security-Policy", HTML_CSP);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "no-referrer");
  h.delete("Content-Length");
  const out = new HTMLRewriter()
    .on("input", { element(e) {
      const t = (e.getAttribute("type") || "").toLowerCase(), ac = (e.getAttribute("autocomplete") || "").toLowerCase(), nm = ((e.getAttribute("name") || "") + " " + (e.getAttribute("id") || "")).toLowerCase();
      if (t === "password" || ac.startsWith("cc-") || ac.includes("password") || /card|cvv|cvc|iban|passw|otp|one-time/.test(nm)) e.remove();
    } })
    .on("form", { element(e) { e.removeAttribute("action"); e.setAttribute("onsubmit", "return false"); } })
    .on("base, meta[http-equiv], iframe, frame, object, embed, portal", { element(e) { e.remove(); } })

    .transform(new Response(resp.body, { status: resp.status, headers: h }));
  return out;
}

function passHeaders(up) {
  const h = new Headers();
  for (const k of ["Content-Type", "Content-Range", "Accept-Ranges", "Content-Length", "Cache-Control", "Retry-After"]) {
    const v = up.headers.get(k);
    if (v) h.set(k, v);
  }
  if (!h.get("Cache-Control")) h.set("Cache-Control", "no-store");
  return h;
}

// /s/<token>/<rest...>  ->  <api>/v1/seats/<token>/<rest...>
const SEAT_OPS = [["GET", /^$/], ["HEAD", /^$/], ["POST", /^(take|events|response|stop|voice_release|recording)$/],
  ["GET", /^media(\/m_[A-Za-z0-9_]{2,60})?$/], ["HEAD", /^media(\/m_[A-Za-z0-9_]{2,60})?$/], ["GET", /^media_link$/], ["GET", /^receipt$/]];
export async function forward(context, token, rest) {
  const { request, env } = context;
  rest = rest || "";
  if (!SEAT_OPS.some(([m, re]) => m === request.method && re.test(rest))) return json({ code: "not_allowed", message: "Not an operation this page uses.", fixable: false }, 404);
  if (!fromOwnPage(request)) return json({ code: "not_from_this_page", message: "Only the call page itself can do that.", fixable: false }, 403);
  if (rest === "media_link" && request.method === "GET") {
    const m = new URL(request.url).searchParams.get("m");
    if (m && !/^m_[A-Za-z0-9_]{2,60}$/.test(m)) return json({ code: "bad_media", message: "No such material.", fixable: false }, 400);
    try { return json({ url: "/mx/" + (await sealMedia(env, token, m)) }); }
    catch (e) { return json({ code: "media_links_off", message: "Material links are not set up.", fixable: false }, 503); }
  }
  if (token.startsWith("standin-")) return standin(context, token, rest);
  return forwardTo(context, "/v1/seats/" + encodeURIComponent(token) + (rest ? "/" + rest : ""), rest);
}

// /o/<member_token>  ->  <api>/v1/members/<member_token>/offers   (chief D8: the member's own page)
export async function forwardOffers(context, memberToken) {
  if (memberToken.startsWith("standin-")) return standinOffers(context, memberToken);
  return forwardTo(context, "/v1/members/" + encodeURIComponent(memberToken) + "/offers", "");
}

// Material leaves this address only as a picture, a sound or a video (sandboxed, nothing to run), or as a build through its
// own sealed link (hardened above). Anything else is refused.
async function mediaOut(context, resp) {
  if (resp.status >= 400) return withSecurity(resp);
  const ct = (resp.headers.get("Content-Type") || "").toLowerCase();
  if (/html/.test(ct)) {
    if (!context.viaSealed) return json({ code: "use_media_link", message: "This material opens only through its own link.", fixable: false }, 403);
    return hardenHtml(resp);
  }
  if (!/^(image\/(png|jpeg|gif|webp|avif)|audio\/|video\/)/.test(ct)) return json({ code: "material_type_refused", message: "This kind of material is not shown to people.", fixable: false }, 415);
  return withSecurity(resp, { "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'self'", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" });
}

// OWNER_router_28 item 3: the visitor's address, signed for the API with the secret both projects hold
export async function visitorHeader(env, request) {
  const ip = request.headers.get("CF-Connecting-IP"), sec = env.RELAY_FORWARD_SECRET;
  if (!ip || !sec || !/^[0-9a-fA-F:.]{2,45}$/.test(ip)) return null;
  const ts = String(Math.floor(Date.now() / 1000)), te = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", te.encode(sec), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, te.encode(ip + "~" + ts))); let b = ""; for (const x of s) b += String.fromCharCode(x);
  return ip + "~" + ts + "~" + btoa(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function forwardTo(context, path, rest) {
  const { request, env } = context;
  const url = new URL(request.url);
  const target = apiBase(request, env) + path;   // query strings are not forwarded (trust's read, item 3)
  const h = new Headers();
  const ct = request.headers.get("Content-Type");
  if (ct) h.set("Content-Type", ct.startsWith("text/plain") ? "application/json" : ct); // beacons arrive as text/plain
  const range = request.headers.get("Range");
  if (range) h.set("Range", range);
  h.set("X-Runner-Forwarded", "1");
  try { const v = await visitorHeader(env, request); if (v) h.set("X-HC-Visitor", v); } catch (e) {}   // OWNER_router_28 item 3
  // OWNER_router_10: the account and admin routes take a session or member credential in the Authorization header (never an address);
  // only those paths carry it through
  const au = request.headers.get("Authorization");
  if (au && /^\/v1\/(account|admin)(\/|$)/.test(path) && /^Bearer (ps_|mt_)[a-z0-9]{4,80}$/.test(au)) h.set("Authorization", au);
  const tc = request.headers.get("x-hc-team-check");   // OWNER_router_5: our own tools' joins through a page; the router checks it
  if (tc) h.set("x-hc-team-check", tc.slice(0, 200));
  const ua = request.headers.get("User-Agent");
  if (ua) h.set("X-HC-Client", ua.slice(0, 200)); // the device family helps the router say what could not be observed
  const init = { method: request.method, headers: h };
  if (!["GET", "HEAD"].includes(request.method)) init.body = await request.arrayBuffer();
  let up;
  try {
    up = await fetch(target, init);
  } catch (e) {
    return json({ code: "router_unreachable", message: "The call service did not answer. Your place is kept; try again in a minute.", fixable: false }, 502);
  }
  const upType = up.headers.get("Content-Type") || "";
  if (up.status >= 500 && !upType.includes("json")) {
    return json({ code: "router_unavailable", message: "The call service is not answering right now. Your place is kept; try again in a minute.", fixable: false, upstream_status: up.status }, 502);
  }
  if (up.status === 404 && !upType.includes("json") && !(rest && rest.startsWith("media"))) {
    return json({ code: "seat_not_found", message: "This link does not match a call.", fixable: false }, 404);
  }
  let resp = new Response(up.body, { status: up.status, headers: passHeaders(up) });
  if (rest && rest.startsWith("media")) {
    resp = await sliceIfNeeded(request, resp);
    return mediaOut(context, resp);
  }
  return withSecurity(resp);
}

// ---------------------------------------------------------------- the stand-in (no router, no database)

function standinOffers(context, memberToken) {
  const exp = new Date(Date.now() + 60_000).toISOString();
  // a stand-in member whose token contains 'missed' shows what a person sees after two unanswered rings switched them Off
  // a stand-in member whose token contains 'quiet' is On for two hours inside quiet hours 9 PM to 8 AM (what PERSON_READY line 8 asks to see)
  if (/quiet/.test(memberToken)) return json({ member: { panel: "team-test", label: "stand-in member" }, on: "on_until", on_until: new Date(Date.now() + 2 * 3600e3).toISOString(), missed_rings: 0,
    quiet: { start: 21, end: 8, tz: "America/Chicago" }, settings: { longer_hold: false }, offers: [], standin: true });
  if (/missed/.test(memberToken)) return json({ member: { panel: "team-test", label: "stand-in member" }, on: "off", on_until: null, missed_rings: 2,
    quiet: { start: 21, end: 8, tz: "America/Chicago" }, settings: { longer_hold: false }, offers: [], standin: true });
  return json({ member: { panel: "team-test", label: "stand-in member" }, on: "off", on_until: null, missed_rings: 0, quiet: { start: 21, end: 8, tz: "America/Chicago" }, settings: { longer_hold: false }, offers: [
    { seat_token: "standin-" + memberToken.slice(8, 16) + "a", seat_url: "/c/standin-" + memberToken.slice(8, 16) + "a",
      ask: "Listen once. Then tell me what you felt, in your own words.", kind: "listen", minutes: 2,
      pay: { per_person_usd: "0.00", unpaid_test: true }, held_until: exp, asker: { name: "The " + NETWORK + " team (stand-in)" } },
  ], standin: true });
}

const STANDIN_FILES = { m_sample_melody30: "melody_30s.wav", m_sample_page_a: "page_a.png", m_sample_page_b: "page_b.png",
  m_sample_clip8: "clip_8s.mp4", m_sample_game_dots: "game_dots.html", m_sample_game_hostile: "game_hostile.html" };
function standinKind(token) {
  // the team's hostile build (checks/hostile_build.py): tries every known way to a fresh window and WebRTC; never a real person's call
  if (/^standin-playhostile/.test(token)) return { ask: "A check, not a game: the team's hostile build tries to reach the network from inside a play build.",
    experience: { kind: "play", media_id: "m_sample_game_hostile", media_ids: ["m_sample_game_hostile"], items: [{ media_id: "m_sample_game_hostile", kind: "html", content_type: "text/html" }], title: "Hostile build (check)" },
    fields: { note: { type: "text", label: "Anything to note?", optional: true } } };
  if (/^standin-comparetext/.test(token)) return { ask: "Which headline makes you want to read on? Then say why, in your own words.",
    experience: { kind: "compare", items: [{ text: "Plan a week of dinners in five minutes" }, { text: "Dinner, decided: a week of meals in five minutes" }] },
    fields: { pick: { type: "choice", choices: ["A", "B"], label: "Which one makes you want to read on?" }, why: { type: "text", label: "Why?" } } };
  const k = (/^standin-(view|watch|compare|play|voice)/.exec(token) || [])[1] || "listen";
  if (k === "voice") return { ask: "Listen once. Then say, in your own words, what you felt.", voice: { max_seconds: 60 },
    experience: { kind: "listen", media_id: "m_sample_melody30", seconds: 30, bytes: 1323044, title: "A thirty-second melody" },
    fields: { felt: { type: "text", label: "What did you feel? (or say it below)", optional: true } } };
  if (k === "view") return { ask: "Look at this page for ten seconds. Then tell me what it sells and how clear it is.",
    experience: { kind: "view", media_id: "m_sample_page_b", media_ids: ["m_sample_page_b"], items: [{ media_id: "m_sample_page_b", kind: "image", content_type: "image/png", bytes: 47828 }], title: "A page for a tide clock" },
    fields: { what_it_sells: { type: "text", label: "What does it sell?" }, clear: { type: "scale", min: 1, max: 5, min_label: "Not clear", max_label: "Very clear", label: "How clear was it in ten seconds?" } } };
  if (k === "compare") return { ask: "Which of these two pages tells you faster what it sells? Then say why, in your own words.",
    experience: { kind: "compare", media_ids: ["m_sample_page_a", "m_sample_page_b"], items: [{ media_id: "m_sample_page_a", kind: "image", content_type: "image/png" }, { media_id: "m_sample_page_b", kind: "image", content_type: "image/png" }] },
    fields: { clearer: { type: "choice", choices: ["A", "B"], label: "Which one is clearer?" }, why: { type: "text", label: "Why?" } } };
  if (k === "watch") return { ask: "Watch this eight-second clip. Then tell me what the ending made you feel.",
    experience: { kind: "watch", media_id: "m_sample_clip8", media_ids: ["m_sample_clip8"], seconds: 8, bytes: 80633, title: "A lamp that dims with the sunset" },
    fields: { felt: { type: "text", label: "What did the ending make you feel?" } } };
  if (k === "play") return { ask: "Play this tapping game for thirty seconds. Then tell me how fun it was and where you wanted to stop.",
    experience: { kind: "play", media_id: "m_sample_game_dots", media_ids: ["m_sample_game_dots"], items: [{ media_id: "m_sample_game_dots", kind: "html", content_type: "text/html" }], title: "Dots" },
    fields: { fun: { type: "scale", min: 1, max: 5, min_label: "Dull", max_label: "Great fun", label: "How fun was it?" }, stop: { type: "text", label: "Where did you want to stop, and why?" } } };
  return { ask: "Listen once. Then tell me what you felt, in your own words.",
    experience: { kind: "listen", media_id: "m_sample_melody30", seconds: 30, bytes: 1323044, title: "A thirty-second melody" },
    fields: { felt: { type: "text", label: "What did you feel?" }, would_play_again: { type: "boolean", label: "Would you play it again?" } } };
}

function standinSeat(token, status = "offered") {
  const now = Date.now();
  return {
    seat_id: "s_" + token.slice(8, 20), call_id: "c_standin", status,
    offer_expires_at: new Date(now + 60_000).toISOString(),
    asker: { name: /^standin-(front|people)/.test(token) ? NETWORK + ", as a rehearsal on this page" : "The " + NETWORK + " team (a stand-in call for building the page)" },
    asker_is_ai: true,
    minutes: 2,
    pay: { per_person_usd: "0.00", unpaid_test: true },
    content_rating: "general",
    recorded: null,
    ...standinKind(token),
    panel: { name: "team-test", members: 3 },
    simulated_person: false,
    standin: true,
  };
}

async function standin(context, token, rest) {
  const { request, env } = context;
  const m = request.method;
  if (token === "standin-expired") return json({ code: "offer_expired", message: "This offer has ended.", fixable: false }, 410);
  if (!rest && (m === "GET" || m === "HEAD")) return json(standinSeat(token));
  if (rest === "take" && m === "POST") {
    if (token === "standin-full") return json({ code: "call_full", message: "Everyone this call needed has answered.", fixable: false }, 409);
    return json(standinSeat(token, "taken"));
  }
  if (rest === "events" && m === "POST") { await request.arrayBuffer(); return json({ ok: true }); }
  if (rest === "receipt" && m === "GET") return json({ receipt_id: "r_standin", receipt: { kind: "listen", unpaid: true, answered_for: NETWORK + " (stand-in)" }, outcomes: [], standin: true });
  if (rest === "voice_release" && m === "POST") { await request.arrayBuffer(); return json({ ok: true, stored: false, standin: true }); }
  if (rest === "recording" && m === "POST") {
    // the stand-in reads the recording and drops it: nothing is kept anywhere
    const b = await request.arrayBuffer();
    if (token.startsWith("standin-voice-fail")) return json({ code: "upload_failed", message: "The stand-in refused this upload on purpose.", fixable: false }, 503);
    return json({ recording_id: "rec_standin_" + crypto.randomUUID().slice(0, 8), bytes: b.byteLength, content_type: request.headers.get("Content-Type"), kept: "nothing (stand-in)", standin: true });
  }
  if (rest === "response" && m === "POST") {
    await request.arrayBuffer();
    return json({ receipt_id: "r_standin_" + crypto.randomUUID().slice(0, 8), paid_usd: "0.00", unpaid_test: true, standin: true });
  }
  if (rest === "stop" && m === "POST") {
    let body = {};
    try { body = await request.json(); } catch (e) {}
    return json({ paid_usd: "0.00", unpaid_test: true, reason: body.reason || "stop", standin: true });
  }
  if (rest && rest.startsWith("media") && (m === "GET" || m === "HEAD")) {
    const kind = standinKind(token);
    const id = rest.split("/")[1] || kind.experience.media_id || (kind.experience.media_ids || [])[0];
    const file = STANDIN_FILES[id];
    if (!file) return json({ code: "unknown_media", message: "No such material on this call.", fixable: false }, 404);
    const a = await env.ASSETS.fetch(new Request(new URL("/samples/" + file, request.url)));
    const type = { wav: "audio/wav", png: "image/png", mp4: "video/mp4", html: "text/html; charset=utf-8" }[file.split(".").pop()];
    const whole = new Response(a.body, { status: 200, headers: { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=600" } });
    const sliced = await sliceIfNeeded(request, whole);
    return mediaOut(context, sliced);
  }
  return json({ code: "not_found", message: "No such seat operation.", fixable: false }, 404);
}
