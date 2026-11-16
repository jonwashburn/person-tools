/* the person\'s side: a member's own page, /m/<member_token>. The calls offered now; whether you can be called (On, Off,
   On for a while); your receipts, with what your answers changed; save them; leave. */
(function () {
  "use strict";
  var token = decodeURIComponent((location.pathname.split("/")[2] || "").trim());
  var main = document.getElementById("main"), live = document.getElementById("live");
  var state = { offers: [], on: null, on_until: null, receipts: null, loaded: false, failures: 0, lastCount: -1, busy: false };
  // replaceChildren(null) prints "null": drop empty arguments first
  function fill(el) { var a = []; for (var i = 1; i < arguments.length; i++) if (arguments[i] != null && arguments[i] !== false) a.push(arguments[i]);
    if (el.replaceChildren) el.replaceChildren.apply(el, a);
    else { while (el.firstChild) el.removeChild(el.firstChild); a.forEach(function (x) { el.appendChild(typeof x === "object" ? x : document.createTextNode(String(x))); }); }
    return el; }
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) { var v = attrs[k]; if (v == null || v === false) continue;
      if (k === "class") el.className = v; else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? "" : v); }
    for (var i = 2; i < arguments.length; i++) { var c = arguments[i]; if (c == null || c === false) continue;
      (function put(x) { if (x == null || x === false) return; if (Array.isArray(x)) return x.forEach(put); el.appendChild(typeof x === "object" ? x : document.createTextNode(String(x))); })(c); }
    return el;
  }
  function fmt(t) { t = Math.max(0, Math.round(t)); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); }
  function clock(ms) { return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function unpaid(p) { return !p || (typeof p === "string" ? /unpaid/i.test(p) : (p.unpaid_test || Number(p.per_person_usd || 0) === 0)); }
  function link(o) {
    var t = o.seat_token || (o.seat_url ? String(o.seat_url).split("/c/")[1] : "");
    return t ? "/c/" + encodeURIComponent(decodeURIComponent(t)) : null;
  }
  function api(method, path, body) {
    var init = { method: method, headers: { Accept: "application/json" } };
    if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
    return fetch("/x/members/" + encodeURIComponent(token) + "/" + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, d: d }; });
    }, function () { return { ok: false, status: 0, d: {} }; });
  }
  var VERB = { listen: "Listen", watch: "Watch", view: "Look", play: "Play", compare: "Compare", answer: "Answer" };
  var DID = { listen: "Listened", watch: "Watched", view: "Looked", play: "Played", compare: "Compared", answer: "Answered" };

  // the asker's line: the newer receipts carry it as outcomes (spec 15.1), the older reply as what_changed
  function changedOf(x) {
    if (x.what_changed) return x.what_changed;
    var oc = x.receipt && x.receipt.outcomes; if (!oc || !oc.length) return null;
    var o = oc[oc.length - 1]; return typeof o === "string" ? o : (o.text || o.what_changed || null);
  }
  function download(name, type, text) {
    var a = h("a", { href: URL.createObjectURL(new Blob([text], { type: type })), download: name }); document.body.appendChild(a); a.click(); a.remove();
  }
  function saveAll() {   // as data, for machines and for checking
    var rs = state.receipts || [];
    download("my-receipts.json", "application/json", JSON.stringify({ saved_at: new Date().toISOString(), receipts: rs.map(function (x) { return { receipt: x.receipt, jws: x.jws || null, signature: x.signature || null, key_id: x.key_id || null, what_changed: changedOf(x), ask: x.ask || null }; }) }, null, 2));
  }
  // as a page a person can read: one self-contained file, no scripts, kept on their phone
  function saveReadable() {
    var rs = (state.receipts || []).slice().reverse();
    var esc = function (t) { return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
    var rows = rs.map(function (x) {
      var r = x.receipt || {}, t = Date.parse(r.ended_at || r.issued_at || "");
      var line = changedOf(x);
      return "<li><p class=d>" + esc(isFinite(t) ? new Date(t).toLocaleString() : "") + " &middot; " + esc((VERB[r.kind] || "A call")) + " &middot; your time " + esc(fmt((Number(r.minutes) || 0) * 60)) + "</p>" +
        (x.ask ? "<p class=a>&ldquo;" + esc(x.ask) + "&rdquo;</p>" : "") +
        "<p>For " + esc(r.asker || r.answered_for || "an asker") + ". " + esc((r.unpaid_test || r.unpaid) ? "Unpaid test." : "Paid to you: $" + Number(r.paid_usd || 0).toFixed(2) + ".") + ((r.seat_status && r.seat_status !== "answered") ? " You stopped." : "") + "</p>" +
        (line ? "<p class=c><b>What the answers changed:</b> &ldquo;" + esc(line) + "&rdquo;</p>" : "") + "<p class=id>Receipt " + esc(r.receipt_id || "") + "</p></li>";
    }).join("");
    var signed = rs.map(function (x) { return "<li><code>" + esc(x.jws || x.signature || "") + "</code></li>"; }).join("");
    var page = "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>My calls and receipts</title>" +
      "<style>body{font:17px/1.45 -apple-system,Helvetica,Arial,sans-serif;margin:24px;max-width:640px;color:#1d1d1b;background:#faf8f3}h1{font-size:28px;margin:0 0 6px}ol{padding:0;list-style:none}li{border-top:1px solid #8a8a8a;padding:10px 0}p{margin:4px 0}.d,.id{font:12px/1.4 ui-monospace,Menlo,monospace;color:#3c3a36;letter-spacing:.04em}.a{border-left:4px solid #009fe3;padding-left:8px}.c{border-left:4px solid #009fe3;padding-left:8px}code{word-break:break-all;font-size:11px}</style>" +
      "<h1>My calls and receipts</h1><p>Saved " + esc(new Date().toLocaleString()) + ". " + rs.length + " call" + (rs.length === 1 ? "" : "s") + ". Nothing in this file says who you are.</p><ol>" + rows + "</ol>" +
      "<h2 style='font-size:18px'>The signed copies</h2><p>Each receipt below is signed by the service. Anyone can check one with the service's verify operation; a change of one character makes the check fail.</p><ol>" + signed + "</ol>";
    download("my-receipts.html", "text/html", page);
  }

  // ------------------------------------------------------------------ sections
  function statusLine() {
    var on = state.on, until = Date.parse(state.on_until || ""), q = state.quiet;
    if (on == null) return null;
    var isOn = on === "on" || (on === "on_until" && isFinite(until) && until > Date.now());
    var a = !isOn ? (on === "off" && state.missed >= 2 ? "You are Off after two unanswered calls" : "You are Off") : on === "on" ? "You are On, with no end set" : "You are On until " + clock(until);
    var b = q && q.start != null && q.end != null ? (q.start === q.end ? "no quiet hours" : "quiet " + hourName(q.start) + " to " + hourName(q.end)) : "";
    return h("p", { class: "note status-line" }, a + (b ? " \u00B7 " + b : "") + ". ", h("a", { href: "#on-h" }, "Change"), " \u00B7 ", h("a", { href: "#lv-h" }, "Leave"));
  }
  function whenWords(iso) {
    var t = Date.parse(iso || ""); if (!isFinite(t)) return "";
    var d = new Date(t), now = new Date(), tm = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    var at = d.toLocaleTimeString([], { hour: "numeric", minute: d.getMinutes() ? "2-digit" : undefined });
    if (d.toDateString() === now.toDateString()) return "at " + at;
    if (d.toDateString() === tm.toDateString()) return "tomorrow at " + at;
    return d.toLocaleDateString([], { weekday: "long" }) + " at " + at;
  }
  function offersSection() {
    var list = state.offers.map(function (o) {
      var href = link(o), held = Date.parse(o.held_until || o.offer_expires_at || "");
      return h("li", { class: "offer" }, h("a", { class: "offer-link", href: href || "#" },
        h("span", { class: "label" }, (VERB[o.kind] || "A call").toUpperCase() + (o.asker && o.asker.name ? " · FOR " + String(o.asker.name).toUpperCase() : "")),
        o.ask ? h("span", { class: "offer-ask" }, "“" + o.ask + "”") : null,
        h("span", { class: "offer-facts" }, h("b", null, (o.minutes || "?") + " min"),
          unpaid(o.pay) ? h("span", { class: "unpaid" }, "UNPAID TEST") : h("b", null, "$" + Number(o.pay.per_person_usd).toFixed(2))),
        h("span", { class: "held", "data-until": isFinite(held) ? String(held) : "" }),
        h("span", { class: "offer-go" }, "Open the call →")),
        o.asker && o.asker.name ? h("button", { type: "button", class: "quiet", onclick: function () { blockAsker({ call_id: o.call_id }, o.asker.name); } }, "Block " + o.asker.name) : null);
    });
    return h("section", { class: "screen", "aria-labelledby": "calls-h" },
      statusLine(),
      notReachedBlock(),
      h("h1", { class: "ask", id: "calls-h" }, state.offers.length ? (state.offers.length === 1 ? "One call is waiting for you." : state.offers.length + " calls are waiting for you.") : state.waiting > 0 ? "No call can ring you right now." : "No call yet."),
      state.offers.length ? h("p", { class: "note" }, "Each is a short task on this page: you look or listen, then type an answer; nobody will talk to you. If a hold runs out, the call goes to someone else; two in a row switch you Off, so nobody keeps ringing you.") : null,
      !state.offers.length && state.waiting > 0 && state.nextRing ? h("p", { class: "block" }, h("b", null, (state.waiting === 1 ? "One call is" : state.waiting + " calls are") + " waiting for your quiet hours to end. "),
        "Nobody rings you before then; the first can ring you " + whenWords(state.nextRing) + ", if you are On. You do not have to do anything.") : null,
      !state.offers.length && state.waiting > 0 && !state.nextRing && state.on === "off" ? h("p", { class: "block" }, h("b", null, (state.waiting === 1 ? "One call on your panel is" : state.waiting + " calls on your panel are") + " waiting. "),
        "You are Off, so nobody rings you. If you want to be rung, switch On below; if not, there is nothing to do.") : null,
      state.offers.length ? h("ul", { class: "offers" }, list) : (state.waiting > 0 ? null : nextSteps()),
      state.offers.length || state.waiting > 0 ? h("p", { class: "note" }, "An AI asks every call. Before you take one you see who is responsible for it, how long it takes, what it pays and what is recorded.") : null);
  }
  // the wait, said plainly: what happens next and what (nothing) the person has to do (chief's round-5 order 1)
  function isOnNow() { var u = Date.parse(state.on_until || ""); return state.on === "on" || (state.on === "on_until" && isFinite(u) && u > Date.now()); }
  function reachLine(rs) {
    return rs === "on" ? null
      : rs === "ready" ? h("div", { class: "reach" }, h("p", null, h("b", null, "This phone is not set to show calls yet, "), "so you would see a call only while this page is open."),
          h("button", { class: "go", type: "button", onclick: letItRing }, "Let this phone show calls"))
      : rs === "ios-add" ? h("p", { class: "reach" }, h("b", null, "To be told about a call on an iPhone, "), "put this page on your Home Screen (Share, then Add to Home Screen), open it from there and allow calls. Until then you see a call only while this page is open.")
      : rs === "blocked" ? h("p", { class: "reach" }, h("b", null, "Notifications are blocked for this page, "), "so you see a call only while this page is open. ", h("a", { href: "#ring-h" }, "How to allow them"), ".")
      : h("p", { class: "reach" }, h("b", null, "This browser cannot show a call when the page is closed, "), "so keep this page open to see one.");
  }
  function ringState() { return (typeof ring === "object" && ring && ring.state) || "unknown"; }
  // a call came and lapsed without reaching this phone: say so, say it counted for nothing, and show how to let calls reach it
  function notReachedBlock() {
    var n = state.notReached || 0; if (!n) return null;
    var rs = ringState();
    return h("div", { class: "block next missed-reach" }, h("p", { class: "label" }, "CALLS THAT DID NOT REACH YOU"),
      h("p", null, h("b", null, (n === 1 ? "A call came" : n + " calls came") + " while this phone could not be reached. "),
        (n === 1 ? "It counts" : "They count") + " for nothing: not against you, and not toward switching you Off." + (rs === "on" ? " This phone can be reached now, so the next one rings it." : "")),
      reachLine(rs));
  }
  function nextSteps() {
    if (state.on != null && !isOnNow()) return h("div", { class: "block next" }, h("p", { class: "label" }, "WHAT HAPPENS NEXT"),
      h("p", null, "Nothing, while you are Off: nobody can ring you. When you want calls, switch On below. Until then there is nothing to do."));
    var rs = ringState(), rings = rs === "on";
    // first, whether this phone can be reached at all: a call is held for about a minute, so a closed page without notifications misses it (a cold read, 14 Nov);
    // when the not-reached notice above already shows the fix, it is not repeated here
    var reach = state.notReached ? null : reachLine(rs);
    return h("div", { class: "block next" }, h("p", { class: "label" }, "WHAT HAPPENS NEXT"), reach,
      h("ol", { class: "next-steps" },
        h("li", null, h("b", null, "Nothing, until an AI asks this panel a question. "), rings ? "You do not have to do anything, or keep this page open." : "There is no set time; it may be soon or not today."),
        h("li", null, rings ? [h("b", null, "Then this phone rings: "), "a notification with the minutes and the pay, never the question. Tap it to open the call."]
          : [h("b", null, "Then the call shows here, "), "while this page is open (it looks again every 20 seconds)."]),
        h("li", null, h("b", null, "You see who asks, how long it takes, what it pays and what the page notes while you do it, "), "then take it or say Not now. Not now is always fine.")),
      h("p", null, "A call is held for you for 15 minutes. If two in a row reach you (your phone rang or your page showed them) and go unanswered, you are switched Off, so nobody keeps ringing you; switch On again any time."));
  }

  function onSection() {
    var on = state.on, until = Date.parse(state.on_until || "");
    var isOn = on === "on" || (on === "on_until" && isFinite(until) && until > Date.now());
    var words = on == null ? "Not known yet." : !isOn ? "Off. Nobody can ring you until you switch On." : on === "on" ? "On, with no end set. Choose how long, or switch Off." : "On until " + clock(until) + ". Then it switches off by itself.";
    if (on === "off" && state.missed >= 2) words = "Off: two calls rang and went unanswered, so we switched you Off. Nobody rings you until you switch On again; nothing counts against you.";
    function set(v, hours) {
      if (state.busy) return; state.busy = true;
      api("POST", "on", v === "off" ? { on: false } : v === "always" ? { on: "always" } : { on: true, hours: hours }).then(function (r) {
        state.busy = false;
        if (r.ok) { state.on = r.d.on; state.on_until = r.d.on_until; state.missed = 0; live.textContent = r.d.on === "off" ? "You are off." : "You are on."; }
        else live.textContent = "Not changed: " + ((r.d && r.d.message) || "the call service did not answer.");
        render();
      });
    }
    var cur = !isOn ? "off" : on === "on" ? "always" : "timed";
    var hoursLeft = isFinite(until) ? (until - Date.now()) / 3600000 : 0;
    function b(label, v, hours, pressed) { return h("button", { type: "button", "aria-pressed": pressed ? "true" : "false", onclick: function () { set(v, hours); } }, label); }
    var q = state.quiet, inQuiet = false, qText = null;
    if (q && q.start != null && q.end != null && q.start === q.end) { qText = "No quiet hours set: you can be rung at any hour while you are On."; }
    else if (q && q.start != null && q.end != null) {
      var hr = nowHourIn(q.tz);
      inQuiet = q.start > q.end ? (hr >= q.start || hr < q.end) : (hr >= q.start && hr < q.end);
      qText = "Quiet hours: " + hourName(q.start) + " to " + hourName(q.end) + (q.tz ? " (" + q.tz + ")" : "") + ".";
    }
    return h("section", { class: "screen", "aria-labelledby": "on-h" },
      h("p", { class: "label" }, "CAN YOU BE CALLED?"),
      h("h2", { class: "sub", id: "on-h" }, words),
      isOn && inQuiet ? h("p", { class: "block" }, h("b", null, "You are in your quiet hours until " + hourName(q.end) + (q.end <= nowHourIn(q.tz) ? " tomorrow" : "") + ". "), "Nobody rings you now, even though you are On." +
        (on === "on_until" && isFinite(until) && (until - Date.now()) <= msToHourIn(q.tz, q.end) ? " Your On ends at " + clock(until) + ", before your quiet hours do, so nobody will ring you this time." : "")) : null,
      (function () {   // the ring cap: the most anyone is rung in an hour
        var rc = state.ringCap; if (!isOn || inQuiet || !rc || rc.applies === false || !(Number(rc.used) >= Number(rc.limit))) return null;   // applies=false: a team-test bot, never capped
        var t = Date.parse(rc.resets_at || "");
        return h("p", { class: "block" }, h("b", null, "You have been rung " + rc.used + " times this hour" + (Number(rc.used) === Number(rc.limit) ? ", the most we ring anyone. " : "; the most we ring anyone is " + rc.limit + ". ")), isFinite(t) ? "The next ring can come after " + clock(t) + "." : "The next ring can come within the hour.");
      })(),
      h("div", { class: "seg", role: "group", "aria-label": "Can you be called" },
        b("Off", "off", 0, cur === "off"), b("On 2 hours", "timed", 2, cur === "timed" && hoursLeft <= 2.05), b("On 4 hours", "timed", 4, cur === "timed" && hoursLeft > 2.05 && hoursLeft <= 4.05), b("On 12 hours", "timed", 12, cur === "timed" && hoursLeft > 4.05)),
      h("p", { class: "note" }, "Off stops every call at once. Even when you are on, nobody rings you in your quiet hours, and two missed rings switch you off and tell you."),
      quietEditor(qText));
  }
  // ms from now until the next time the clock in tz reads hour:00 (quiet hours end on the hour)
  function msToHourIn(tz, hour) {
    var p; try { p = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23", timeZone: tz || undefined }).formatToParts(new Date()); } catch (e) { p = []; }
    var g = function (t) { var x = p.filter(function (y) { return y.type === t; })[0]; return x ? Number(x.value) : 0; };
    var d = (hour * 3600 - (g("hour") * 3600 + g("minute") * 60 + g("second")) + 86400) % 86400;
    return (d || 86400) * 1000;
  }
  function nowHourIn(tz) { try { return Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz || undefined }).format(new Date())); } catch (e) { return new Date().getHours(); } }
  function hourName(n) { return new Date(2026, 0, 1, n, 0).toLocaleTimeString([], { hour: "numeric" }); }
  var editingQuiet = false;
  function quietEditor(qText) {
    var q = state.quiet || { start: 21, end: 8 };
    if (!editingQuiet) return h("div", { class: "qrow" }, h("p", { class: "note" }, qText || "Quiet hours: 9 PM to 8 AM unless you changed them."), h("button", { class: "quiet small", type: "button", onclick: function () { editingQuiet = true; render(); } }, "Change quiet hours"));
    function sel(v, name) { var x = h("select", { class: "hsel", "aria-label": name }); for (var i = 0; i < 24; i++) { var o = h("option", { value: String(i) }, hourName(i)); if (i === v) o.selected = true; x.appendChild(o); } return x; }
    var a = sel(q.start, "Quiet hours start"), b = sel(q.end, "Quiet hours end");
    var tz = "America/Chicago"; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch (e) {}
    return h("div", { class: "block" }, h("p", { class: "label" }, "YOUR QUIET HOURS"), h("p", { class: "quiet-row" }, "No calls from ", a, " to ", b, " your time."),
      h("div", { class: "row" }, h("button", { class: "quiet", type: "button", onclick: function () {
        api("POST", "settings", { quiet_start: Number(a.value), quiet_end: Number(b.value), tz: tz }).then(function (r) {
          editingQuiet = false;
          if (r.ok) { state.quiet = { start: Number(a.value), end: Number(b.value), tz: tz }; live.textContent = "Quiet hours saved."; }
          else live.textContent = r.status === 404 ? "Changing quiet hours here is not switched on yet; nothing changed." : "Not saved.";
          render();
        });
      } }, "Save"), h("button", { class: "quiet", type: "button", onclick: function () { editingQuiet = false; render(); } }, "Cancel")));
  }
  // tell us what to change in this test (chief's ruling 14 Nov 4:25 AM CT; policy/DATA.md row 'Tester feedback':
  // the text, the member id and the time only; 90 days or until the person leaves)
  function feedbackSection() {
    if (state.fbEl) return state.fbEl;   // keep what the person is typing across redraws
    var ta = h("textarea", { id: "fb-text", rows: "4", maxlength: "2000", "aria-describedby": "fb-note" });
    var out = h("p", { class: "note", role: "status" });
    var send = h("button", { class: "quiet", type: "button", onclick: function () {
      var t = ta.value.trim(); if (!t) { out.textContent = "Write something first."; ta.focus(); return; }
      send.disabled = true; out.textContent = "Sending\u2026";
      api("POST", "feedback", { text: t }).then(function (r) {
        send.disabled = false;
        if (r.ok && r.d && r.d.stored === false) { out.textContent = r.d.note || "Nothing was kept."; return; }
        if (r.ok) { out.textContent = "Thank you. It reached us."; ta.value = ""; return; }
        out.textContent = r.status === 404 ? "Sending is not switched on yet. Nothing was sent; please try again later." : "Not sent: " + ((r.d && r.d.message) || "the call service did not answer.") + " Nothing was kept.";
      });
    } }, "Send to person.tools");
    state.fbEl = h("section", { class: "screen", "aria-labelledby": "fb-h" },
      h("p", { class: "label" }, "THIS TEST"),
      h("h2", { class: "sub", id: "fb-h" }, h("label", { for: "fb-text" }, "Tell us what to change")),
      h("p", { class: "note", id: "fb-note" }, "What confused you, what you liked, what you would change. It goes to the service only, with the time and a number that stands for you on this panel, never your name. Kept 90 days, or until you leave. Please leave out anything that says who you are."),
      ta, send, out);
    state.fbEl.addEventListener("focusout", function () { setTimeout(function () { if (state.redrawLater && !state.fbEl.contains(document.activeElement)) { state.redrawLater = false; render(); } }, 0); });
    return state.fbEl;
  }
  state.alertWords = null;   // OWNER_router_25: read once; the offers poll does not carry it
  fetch("/xp/members/" + encodeURIComponent(token) + "/settings", { headers: { Accept: "application/json" } }).then(function (r) { return r.ok ? r.json() : null; }, function () { return null; })
    .then(function (d) { if (d && d.settings && typeof d.settings.alert_words === "boolean") { state.alertWords = d.settings.alert_words; if (state.loaded) render(); } });
  function privateSection() {
    var st = state.settings || {};
    function flip(key, readKey) {
      readKey = readKey || key;
      var v = !st[readKey];
      api("POST", "settings", (function () { var o = {}; o[key] = v; return o; })()).then(function (r) {
        if (r.ok) { st[readKey] = v; state.settings = st; live.textContent = "Saved."; }
        else live.textContent = r.status === 404 ? "This setting is not switched on yet; nothing changed." : "Not saved.";
        render();
      });
    }
    return h("section", { class: "screen", "aria-labelledby": "pv-h" },
      h("p", { class: "label", id: "pv-h" }, "PRIVATE SETTINGS"),
      // OWNER_router_25: the ask's first line in my own alerts, off unless the person turns it on
      state.alertWords === null ? null : h("button", { type: "button", class: "toggle", "aria-pressed": state.alertWords ? "true" : "false", onclick: function () {
        var v = !state.alertWords; api("POST", "settings", { alert_words: v }).then(function (r) {
          if (r.ok) { state.alertWords = v; live.textContent = "Saved."; } else live.textContent = "Not saved."; render(); }); } }, "Show the ask in my alerts" + (state.alertWords ? " (on)" : " (off)")),
      state.alertWords === null ? null : h("p", { class: "note" }, "Off: an alert says only who is asking. On: it may also show the ask's first line, up to 80 characters, never the whole ask. Your phone's own preview setting still decides what shows on a locked screen. Only you see this."),
      state.ownPage ? null : h("button", { type: "button", class: "toggle", "aria-pressed": st.longer_hold ? "true" : "false", onclick: function () { flip("longer_to_answer", "longer_hold"); } }, "Give me more time to take a call" + (st.longer_hold ? " (on)" : " (off)")),
      state.ownPage ? null : h("p", { class: "note" }, "Calls on your panel are held for you for 15 minutes. With this On, any call held for less is held for 3 minutes instead. Useful with a screen reader, or whenever you like. No asker ever sees this, and it never changes what you are paid or how often you are rung."));
  }

  // ------------------------------------------------------------------ the ring (P2): web push to this phone
  var ring = { state: "unknown", note: "" };
  function b64u(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; var r = atob(s), o = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) o[i] = r.charCodeAt(i); return o; }
  function ringCheck() {
    var ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    var standalone = navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) ring.state = ios && !standalone ? "ios-add" : "unsupported";
    else if (Notification.permission === "denied") ring.state = "blocked";
    else if (ios && !standalone) ring.state = "ios-add";
    else ring.state = "ready";
    if (ring.state === "ready" && Notification.permission === "granted") {
      navigator.serviceWorker.getRegistration("/").then(function (reg) { return reg && reg.pushManager.getSubscription(); }).then(function (sub) {
        if (sub) { ring.state = "on"; if (state.loaded) render(); }
      }, function () {});
    }
  }
  function letItRing() {
    ring.note = "Asking your phone…"; render();
    Notification.requestPermission().then(function (perm) {
      if (perm !== "granted") { ring.state = perm === "denied" ? "blocked" : "ready"; ring.note = perm === "denied" ? "" : "Not allowed. Nothing changed."; return render(); }
      return navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(function () { return navigator.serviceWorker.ready; }).then(function (reg) {
        if (reg.active) reg.active.postMessage({ type: "member", token: token });
        return fetch("/push-key").then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); }).then(function (k) {
          if (!k.ok || !k.d.key) throw new Error("no key");
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(k.d.key) });
        }).then(function (sub) {
          return api("POST", "push", { subscription: sub.toJSON() }).then(function (r) {
            if (r.ok) { ring.state = "on"; ring.note = ""; live.textContent = "This phone will ring."; }
            else { ring.state = "waiting"; ring.note = r.status === 404 ? "This phone is ready, but the call service cannot ring phones yet. Your calls still appear on this page." : "Not saved: " + ((r.d && r.d.message) || "the call service did not answer."); }
            render();
          });
        });
      });
    }).catch(function (e) { ring.state = "ready"; ring.note = "That did not work on this phone (" + (e && e.message ? e.message : "unknown") + "). Your calls still appear on this page."; render(); });
  }
  function testRing() {
    navigator.serviceWorker.ready.then(function (reg) {
      return reg.showNotification("An unpaid test call: 2 minutes", { body: "This is how a call looks on this phone. This one was only a test.", tag: "pt-test", icon: "/icons/icon-192.png", data: { url: "/m/" + token } });
    }).catch(function () {});
  }
  // the iPhone app (the owner, 11:13 PM CT 14 Nov): one tap moves a person who joined on the web into the app, signed in
  // OWNER_all_10 B: the person's own AIs. TRUST's words (cleared 12:56 PM CT 15 Nov), word for word, where a person connects one.
  var ais = { list: null, made: null, msg: "", busy: false };
  var ICON = { home: "\u{1F3E0}", chef: "\u{1F373}", car: "\u{1F697}", business: "\u{1F4BC}", lab: "\u{1F9EA}", other: "\u{1F916}" };
  function aiCall(method, path, body) {
    return fetch("/x/members/" + encodeURIComponent(token) + "/connections" + (path || ""), { method: method, headers: { "Content-Type": "application/json", Accept: "application/json" }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d || {} }; }, function () { return { ok: r.ok, d: {} }; }); }, function () { return { ok: false, d: { message: "No connection. Try again." } }; });
  }
  function loadAis() { aiCall("GET").then(function (r) { if (r.ok) { ais.list = r.d.connections || []; render(); } }); }
  function aisSection() {
    if (ais.list === null) return null;
    var name = h("input", { type: "text", maxlength: "40", "aria-label": "Its name", placeholder: "Its name, e.g. Home camera" });
    var pick = h("select", { "aria-label": "Its icon" }, Object.keys(ICON).map(function (k) { return h("option", { value: k }, ICON[k] + " " + k); }));
    var kids = [h("p", { class: "label", id: "ais-h" }, "YOUR AIs"),
      state.ownPage && !(ais.list || []).length ? h("p", { class: "sub" }, "Connect your first AI: give it a name, then give it the key you get. What to give it, for each kind of AI: ", h("a", { href: "https://person.tools/connect" }, "person.tools/connect"), ".") : null,
      h("p", { class: "note" }, "What your AIs send you is yours. Nobody at person.tools looks at it. Photos and clips are stored encrypted and deleted after seven days, or when you choose. Nothing you get here is ever shown to a reviewer.")];
    if (ais.made) kids.push(h("div", { class: "block", role: "status" },
      h("p", { class: "sub" }, "Give this to " + ais.made.name + ". It is shown once."),
      h("p", { class: "note" }, "The link (or the key with POST /v1/tasks) only asks you. Answers can go back to its address, signed with the secret."),
      h("pre", { class: "task-cmd" }, "link: " + ais.made.link + "\nkey: " + ais.made.key + "\nwebhook secret: " + ais.made.webhook_secret),
      h("button", { type: "button", class: "quiet", onclick: function () { ais.made = null; render(); } }, "I have kept it")));
    (ais.list || []).forEach(function (c) {
      kids.push(h("div", { class: "block" },
        h("p", { class: "sub" }, (ICON[c.icon] || c.icon || "") + " " + c.name + (c.quiet ? " (quiet)" : "")),
        h("p", { class: "note" }, c.last_used_at ? "Last asked " + new Date(c.last_used_at).toLocaleString() : "Has not asked yet"),
        h("button", { type: "button", class: "quiet", onclick: function () { aiCall("POST", "/" + c.connection_id + "/quiet", { quiet: !c.quiet }).then(loadAis); } }, c.quiet ? "Let it ring again" : "Quiet it"),
        h("button", { type: "button", class: "quiet", onclick: function () { if (window.confirm("Remove " + c.name + "? Its key and link stop at once, and what it was asking goes off your list.")) aiCall("DELETE", "/" + c.connection_id).then(loadAis); } }, "Remove")));
    });
    kids.push(h("p", { class: "label" }, "CONNECT AN AI"), name, pick,
      h("button", { type: "button", class: "go", onclick: function () {
        if (ais.busy || !name.value.trim()) { ais.msg = "Give it a name first."; render(); return; }
        ais.busy = true; ais.msg = "";
        aiCall("POST", "", { name: name.value.trim(), icon: pick.value }).then(function (r) { ais.busy = false;
          if (r.ok) { ais.made = r.d; loadAis(); } else { ais.msg = "Not connected: " + ((r.d && r.d.message) || "try again."); render(); } });
      } }, "Connect"));
    if (ais.msg) kids.push(h("p", { class: "note", role: "status" }, ais.msg));
    return h("section", { class: "screen", "aria-labelledby": "ais-h" }, kids);
  }
  // OWNER_router_10 A: a passkey for person.tools (one credential for the app, this page and the admin console)
  var acct = { msg: "" };
  function accountSection() {
    if (!window.PublicKeyCredential) return null;
    var API = "/x";   // this page's own address (its security policy allows no other)
    var enc = function (buf) { var s = "", u = new Uint8Array(buf); for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
    var dec = function (s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; };
    var post = function (path, body) { return fetch(API + path.replace(/^\/v1\//, "/"), { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d || {} }; }); }); };
    return h("section", { class: "screen", "aria-labelledby": "acct-h" }, h("p", { class: "label", id: "acct-h" }, "YOUR PASSKEY"),
      h("p", { class: "note" }, "A passkey signs you in to person.tools on your devices, with Face ID or your device's own check. No email, no password."),
      h("button", { type: "button", class: "quiet", onclick: function () {
        acct.msg = "Asking your device\u2026"; render();
        post("/v1/account/passkey/options").then(function (r) {
          if (!r.ok) throw new Error(r.d.message || "no options");
          var pk = r.d.publicKey; pk.challenge = dec(pk.challenge); pk.user.id = dec(pk.user.id); (pk.excludeCredentials || []).forEach(function (c) { c.id = dec(c.id); });
          return navigator.credentials.create({ publicKey: pk }).then(function (c) {
            return post("/v1/account/passkey", { challenge_id: r.d.challenge_id, credential: { id: c.id, rawId: enc(c.rawId), type: c.type,
              response: { clientDataJSON: enc(c.response.clientDataJSON), attestationObject: enc(c.response.attestationObject), transports: c.response.getTransports ? c.response.getTransports() : [] } } });
          });
        }).then(function (r) { acct.msg = r.ok ? "Your passkey is added. Sign in with it anywhere you hold it." : "Not added: " + (r.d.message || "try again."); render(); },
          function (e) { acct.msg = "Not added: " + (e && e.message ? e.message : e); render(); });
      } }, "Add a passkey"), acct.msg ? h("p", { class: "note", role: "status" }, acct.msg) : null);
  }
  // OWNER_router_4 item 1: one tap blocks an asker, behind a confirm; the list names each by its display name and can undo it
  var blocks = { list: null, msg: "" };
  function loadBlocks() { fetch("/x/members/" + encodeURIComponent(token) + "/blocks", { headers: { Accept: "application/json" } }).then(function (r) { return r.ok ? r.json() : null; }, function () { return null; })
    .then(function (d) { if (d) { blocks.list = d.blocks || []; render(); } }); }
  function blockAsker(body, name) {
    if (!window.confirm("Block " + name + "? It can never reach you again, and it is only told you are not available.")) return;
    fetch("/x/members/" + encodeURIComponent(token) + "/blocks", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d || {} }; }); }).then(function (r) { blocks.msg = r.ok ? name + " is blocked." : "Not blocked: " + (r.d.message || "try again."); tasks.sig = ""; loadTasks(); loadBlocks(); });
  }
  function blocksSection() {
    if (!blocks.list || !blocks.list.length) return blocks.msg ? h("p", { class: "note", role: "status" }, blocks.msg) : null;
    return h("section", { class: "screen", "aria-labelledby": "blocks-h" }, h("p", { class: "label", id: "blocks-h" }, "BLOCKED"), blocks.msg ? h("p", { class: "note", role: "status" }, blocks.msg) : null,
      h("ul", { class: "list" }, blocks.list.map(function (b) { return h("li", null, b.name + " ", h("button", { type: "button", class: "quiet", onclick: function () {
        fetch("/x/members/" + encodeURIComponent(token) + "/blocks/" + b.block_id, { method: "DELETE" }).then(function () { blocks.msg = b.name + " can reach you again."; loadBlocks(); }); } }, "Unblock")); })));
  }
  function appSection() {
    if (!/iPhone|iPad|iPod/.test(navigator.userAgent)) return null;
    return h("section", { class: "screen", "aria-labelledby": "app-h" }, h("p", { class: "label", id: "app-h" }, "THE IPHONE APP"),
      h("p", null, "If the person.tools app is on this iPhone, this opens your page there, already signed in. In the app a call rings even when the phone is locked."),
      h("a", { class: "go linkbtn", href: "persontools://m/" + encodeURIComponent(token) }, "Open in the app"));
  }
  function ownQuiet() {   // a page of your own: quiet hours live under the phone's notifications (REACH 3:38)
    var q = state.quiet, t = null;
    if (q && q.start != null && q.end != null && q.start === q.end) t = "No quiet hours set: an alert can come at any hour.";
    else if (q && q.start != null && q.end != null) t = "Quiet hours: " + hourName(q.start) + " to " + hourName(q.end) + (q.tz ? " (" + q.tz + ")" : "") + ".";
    return [quietEditor(t), h("p", { class: "note" }, "No alert in your quiet hours. Asks still arrive; they wait on this page.")];
  }
  function ringSection() {
    var body;
    if (state.ownPage && ring.state === "on") body = [h("p", { class: "sub" }, "This phone shows an alert when one of your AIs asks you now."), h("p", { class: "note" }, "Never in your quiet hours, and never from an AI you set to Quiet.")];
    else if (state.ownPage && ["ios-add", "blocked", "unsupported"].indexOf(ring.state) < 0) body = [h("p", { class: "sub" }, "Show an alert when one of your AIs asks you now?"), h("button", { class: "go", type: "button", onclick: letItRing }, "Let this phone show alerts"), h("p", { class: "note" }, "Your phone asks you first. Without it, your asks still appear on this page.")];
    else if (ring.state === "on") body = [h("p", { class: "sub" }, "This phone rings when a call comes."), h("p", { class: "note" }, "Only while you are On, and never in your quiet hours. The notification shows the minutes and the pay, never the asker's words."), h("button", { class: "quiet", type: "button", onclick: testRing }, "Show a test ring")];
    else if (ring.state === "ios-add") body = [h("p", { class: "sub" }, "First, put this page on your Home Screen."), h("p", null, "An iPhone lets a page ring only from its Home Screen icon: tap Share, then “Add to Home Screen”, open the new icon, and come back to this switch.")];
    else if (ring.state === "blocked") body = [h("p", { class: "sub" }, "Notifications are blocked for this page."), h("p", null, "To allow them: on an iPhone, Settings, then Notifications, then this page's icon; on Android, tap the lock beside the address, then Notifications. Your calls appear on this page either way.")];
    else if (ring.state === "unsupported") body = [h("p", { class: "sub" }, "This browser cannot ring."), h("p", null, "Your calls still appear on this page. Keep it open, or look in now and then.")];
    else body = [h("p", { class: "sub" }, "Show a notification when a call comes?"), h("button", { class: "go", type: "button", onclick: letItRing }, "Let this phone show calls"), h("p", { class: "note" }, "A notification, not a phone call. Your phone asks you first. Without it, your calls still appear on this page.")];
    if (state.ownPage) body = [].concat(body).map(function (x) { if (x && x.nodeType) { var w = document.createTreeWalker(x, NodeFilter.SHOW_TEXT), n; while ((n = w.nextNode())) n.nodeValue = n.nodeValue.replace(/Your calls/g, "Your asks").replace(/your calls/g, "your asks"); } return x; });   // a page of your own has asks, not calls
    return h("section", { class: "screen", "aria-labelledby": "ring-h" }, h("p", { class: "label", id: "ring-h" }, "NOTIFICATIONS ON THIS PHONE"), body, ring.note ? h("p", { class: "note", role: "status" }, ring.note) : null, state.ownPage ? ownQuiet() : null);
  }

  // a line the person has not seen before is marked NEW once (kept on this phone only)
  var seenKey = "pt_seen_changed_" + token.slice(0, 12), seenSet = null;
  function isNew(id) {
    if (!seenSet) { try { seenSet = JSON.parse(localStorage.getItem(seenKey) || "[]"); } catch (e) { seenSet = []; } }
    return seenSet.indexOf(id) < 0;
  }
  var drawnChanged = {};   // receipt ids whose 'what changed' line has been on screen
  function markSeen() {
    isNew("");   // loads seenSet
    var ids = seenSet.concat(Object.keys(drawnChanged).filter(function (id) { return seenSet.indexOf(id) < 0; }));
    try { localStorage.setItem(seenKey, JSON.stringify(ids)); } catch (e) {}
  }
  window.addEventListener("pagehide", markSeen);
  // the moment nobody expects: an asker said what an answer changed. It leads the page until it has been seen.
  function changedBanner() {
    var fresh = (state.receipts || []).filter(function (x) { return changedOf(x) && x.receipt && isNew(x.receipt.receipt_id); });
    if (!fresh.length) return null;
    var x = fresh[fresh.length - 1], r = x.receipt;
    drawnChanged[r.receipt_id] = 1;
    return h("section", { class: "screen changed-top", "aria-labelledby": "ch-h" },
      h("p", { class: "label", id: "ch-h" }, "WHAT THE ANSWERS CHANGED"),
      h("p", { class: "ask" }, "\u201C" + changedOf(x) + "\u201D"),
      h("p", { class: "who" }, h("span", { class: "ai" }, "The AI that asked"), ", for " + (r.asker || r.answered_for || "the asker") + ", sent this to " + (Number(x.what_changed_people) > 1 ? "the " + Number(x.what_changed_people) + " people who answered, you among them" : Number(x.what_changed_people) === 1 ? "you, the one person who answered" : "everyone who answered, you among them") + (x.what_changed_at ? ", on " + new Date(x.what_changed_at).toLocaleDateString([], { weekday: "long" }) + " at " + new Date(x.what_changed_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "") + "."),
      fresh.length > 1 ? h("p", { class: "note" }, (fresh.length - 1) + " more under your receipts" + (state.allReceipts ? "." : " (Show all).")) : null,
      h("a", { class: "go linkbtn", href: "/r/" + encodeURIComponent(r.receipt_id) , onclick: function () { try { sessionStorage.setItem("pt_receipt_" + r.receipt_id, JSON.stringify(x)); } catch (e) {} } }, "See it on your receipt"));
  }
  function receiptsSection() {
    var rs = state.receipts;
    var body;
    if (rs == null) body = h("p", { class: "note" }, "Loading your receipts…");
    else if (!rs.length) body = h("p", { class: "note" }, "Each call you finish leaves a signed receipt here.");
    else body = h("ul", { class: "rlist" }, rs.slice().reverse().slice(0, state.allReceipts ? rs.length : 5).map(function (x) {
      var r = x.receipt || {}, t = Date.parse(r.ended_at || r.issued_at || "");
      var who = r.asker || r.answered_for || "an asker", unpaidR = r.unpaid_test || r.unpaid || Number(r.paid_usd || 0) === 0;
      var stopped = (r.seat_status && r.seat_status !== "answered") || (r.outcome && r.outcome !== "answered");
      var changedLine = changedOf(x);
      return h("li", null, h("a", { class: "rrow", href: "/r/" + encodeURIComponent(r.receipt_id || "") , onclick: function () { try { sessionStorage.setItem("pt_receipt_" + r.receipt_id, JSON.stringify(x)); } catch (e) {} } },
        h("span", { class: "label" }, (isFinite(t) ? new Date(t).toLocaleDateString([], { day: "numeric", month: "short" }) + " \u00B7 " : "") + (VERB[r.kind] || "A call").toUpperCase() + (stopped ? " \u00B7 STOPPED" : "") + " \u00B7 YOUR TIME " + fmt((Number(r.minutes) || 0) * 60) +
          (x.heard && Number(x.heard.media_seconds) > 0 && isFinite(Number(x.heard.played_seconds)) ? " \u00B7 PLAYED " + fmt(x.heard.played_seconds) + " OF " + fmt(x.heard.media_seconds) : "")),
        (x.ask || r.ask) ? h("span", { class: "rask" }, "\u201C" + (x.ask || r.ask) + "\u201D") : null,
        h("span", { class: "rasker" }, "For " + who + (unpaidR ? " \u00B7 unpaid test" : " \u00B7 $" + Number(r.paid_usd || 0).toFixed(2) + " to you")),
        changedLine && (drawnChanged[r.receipt_id] = 1) ? h("span", { class: "rchanged" }, isNew(r.receipt_id) ? h("span", { class: "new" }, "NEW") : null, h("b", null, "What the answers changed: "), "\u201C" + changedLine + "\u201D") : h("span", { class: "note" }, "The asker has not said what the answers changed yet.")));
    }));
    return h("section", { class: "screen", "aria-labelledby": "rc-h" },
      h("p", { class: "label" }, "YOUR RECEIPTS"),
      h("h2", { class: "sub", id: "rc-h" }, rs && rs.length ? rs.length + " receipt" + (rs.length === 1 ? "" : "s") + ", yours to keep (each signed, so it cannot be changed)." : "No receipts yet."),
      body,
      rs && rs.length > 5 && !state.allReceipts ? h("button", { class: "textlink plain show-all", type: "button", onclick: function () { state.allReceipts = true; render(); } }, "Show all " + rs.length + " receipts (the newest five are above)") : null,
      rs && rs.length ? h("button", { class: "quiet", type: "button", onclick: saveReadable }, "Save all your receipts") : null,
      rs && rs.length ? h("button", { class: "textlink plain", type: "button", onclick: saveAll }, "or as a data file, for checking by a program") : null);
  }

  // what the person agreed to when they joined (trust's tester notice, word for word), and who to ask
  var notice = null;
  fetch("/tester_notice.json").then(function (r) { return r.json(); }).then(function (n) { notice = n; if (state.loaded) render(); }, function () {});
  function agreedSection() {
    if (!notice) return null;
    var reach = (notice.sections || []).filter(function (x) { return /reach/i.test(x.label); })[0];
    return h("section", { class: "screen", "aria-labelledby": "ag-h" },
      h("p", { class: "label", id: "ag-h" }, "QUESTIONS, AND WHAT YOU AGREED TO"),
      reach ? h("p", null, reach.text) : null,
      h("details", { class: "tech" }, h("summary", null, state.ownPage ? "The notice for a page of your own" : "The notice you accepted when you joined"),
        h("p", { class: "lede" }, notice.lede),
        h("dl", { class: "notice" }, (notice.sections || []).map(function (x) { return [h("dt", null, x.label), h("dd", null, x.text)]; })),
        h("p", { class: "note" }, notice.footnote)));
  }
  function leaveSection() {
    var box = h("div", { class: "leave" });
    function step1() {
      fill(box, h("button", { class: "quiet", type: "button", onclick: step2 }, "Leave and delete everything"));
    }
    function step2() {
      fill(box, 
        state.receipts && state.receipts.length
          ? h("p", null, h("b", null, "Save your receipts first? "), "After you leave, they cannot be shown to you again.")
          : h("p", null, h("b", null, "Save your receipts first? "), "You have none yet, so there is nothing to save."),
        state.receipts && state.receipts.length ? h("button", { class: "quiet", type: "button", onclick: saveReadable }, "Save my receipts") : null,
        h("button", { class: "choice upset", type: "button", onclick: doLeave }, h("b", null, "Delete everything now"), h("span", null, "Your membership, answers, records and recordings. One tap; it cannot be undone.")),
        h("button", { class: "quiet", type: "button", onclick: step1 }, "Keep my place"));
    }
    function doLeave() {
      api("POST", "leave", { confirm: true }).then(function (r) {
        if (r.ok) {
          state.left = true; try { if (localStorage.getItem("pt_own_page") === token) localStorage.removeItem("pt_own_page"); } catch (e) {}   // REACH 3:38: a left page is never offered again
          var dd = (r.d && r.d.deleted) || {};
          var WORDS = { answers_to_asks: ["answer to your AIs", "answers to your AIs"], answers: ["answer", "answers"], records: ["record", "records"], receipts: ["receipt", "receipts"], notes: ["note", "notes"], own_material: ["photo or clip", "photos and clips"], mutes: ["mute", "mutes"], device_keys: ["device key", "device keys"], desk_sessions: ["Desk sign-in", "Desk sign-ins"] };   // REACH 4:31: words, never a field name
          var counts = typeof dd === "object" && !Array.isArray(dd) ? Object.keys(dd).map(function (k) { var w = WORDS[k] || [k.replace(/_/g, " "), k.replace(/_/g, " ")]; return dd[k] + " " + (Number(dd[k]) === 1 ? w[0] : w[1]); }).join(", ") : [].concat(dd).join(", ");
          fill(main, h("section", { class: "screen" }, h("p", { class: "big" }, "Gone."),
            h("p", { class: "lede" }, "You have left, and what this service held about you is deleted. Nobody can ring you through this link again."),
            counts ? h("p", { class: "note" }, h("strong", null, "Deleted: "), counts + ".") : null,
            r.d && r.d.kept ? h("p", { class: "note" }, h("strong", null, "Kept: "), r.d.kept) : null));
          clearInterval(timer);
        } else box.appendChild(h("p", { class: "verdict bad", role: "alert" }, r.status === 404 ? "Leaving from this page is not switched on yet. Nothing was deleted." : "Not done: " + ((r.d && r.d.message) || "the call service did not answer.")));
      });
    }
    step1();
    return h("section", { class: "screen", "aria-labelledby": "lv-h" }, h("p", { class: "label", id: "lv-h" }, "LEAVE"), box);
  }

  // TASKS (OWNER_all_7: one place where the operator's programs give the operator tasks): what our programs ask this person
  // to do, in one list, most urgent first, grouped by the program that asks; done ones leave for a history he can search
  var tasks = { open: [], history: [], sig: "", q: "", note: {}, msg: {}, answer: {}, press: {}, people: [], ownerName: null, sent: null, send: { to: {}, title: "", text: "", choices: "", urgency: "today" }, passTo: {} };
  setTimeout(function () { try { loadBlocks(); } catch (e) {} }, 0);
  setTimeout(function () { try { loadAis(); } catch (e) {} }, 0);   // the person's own AIs, once
  function loadTasks() {
    fetch("/x/members/" + encodeURIComponent(token) + "/tasks", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; }, function () { return null; })
      .then(function (d) { if (!d) return; if (d.own_page && !state.ownPage) { state.ownPage = true; var bl = document.getElementById("bar-label"); if (bl) bl.textContent = "YOUR PAGE"; var sk = document.querySelector("a.skip"); if (sk) sk.textContent = "Skip to your asks"; tasks.sig = ""; fetch("/tester_notice_self.json").then(function (r) { return r.json(); }).then(function (n) { notice = n; render(); }, function () {}); }   // REACH 3:35: a page of your own (TRUST 3:08: its own notice)
        var sig = JSON.stringify([d.open, d.history, d.notice, d.answers_to_read, d.passed_on]); if (sig === tasks.sig) return; tasks.sig = sig; tasks.open = d.open || []; tasks.history = d.history || [];
        tasks.personNotice = d.notice || null; tasks.answers = d.answers_to_read || []; tasks.passed = d.passed_on || []; render(); });
  }
  // OWNER_router_20: a press shows at once, right under the button.
  // The list never redraws while focus is inside it (so typing is never lost), and a pressed button holds the focus, so the answer to a
  // press is written in place: the card's buttons wait, the words appear under the one pressed, a note joins the thread at once.
  function pressStatus(btn, text, kind) {
    if (!btn || !btn.parentNode) return null;
    var li = btn.closest ? btn.closest("[data-task]") : null;
    var s = li ? li.querySelector(".press-status") : null;
    if (!s) s = h("p", { class: "note press-status", role: "status" });
    if (btn.nextSibling !== s) btn.parentNode.insertBefore(s, btn.nextSibling);
    s.textContent = text; s.setAttribute("data-kind", kind || "");
    var id = li && li.getAttribute("data-task");
    if (id) tasks.press[id] = { label: btn.textContent, text: text, kind: kind || "", until: kind === "ok" ? Date.now() + 6000 : kind === "busy" ? 0 : Date.now() + 60000 };
    return s;
  }
  // a redraw draws the last press's words under the same button (and keeps the buttons waiting while it is sending)
  function pressAgain(t, li) {
    var ps = tasks.press[t.task_id]; if (!ps) return li;
    if (ps.until && ps.until < Date.now()) { delete tasks.press[t.task_id]; return li; }
    var bs = li.querySelectorAll("button"), bb = null; for (var i = 0; i < bs.length; i++) if (bs[i].textContent === ps.label) bb = bs[i];
    if (!bb || !bb.parentNode) return li;
    bb.parentNode.insertBefore(h("p", { class: "note press-status", role: "status", "data-kind": ps.kind }, ps.text), bb.nextSibling);
    if (ps.kind === "busy") { var as = li.querySelectorAll("button.answer"); for (var j = 0; j < as.length; j++) as[j].disabled = true; }
    return li;
  }
  function cardBusy(btn, busy) {
    var li = btn && btn.closest ? btn.closest("[data-task]") : null; if (!li) return;
    var bs = li.querySelectorAll("button.answer"); for (var i = 0; i < bs.length; i++) bs[i].disabled = !!busy;
  }
  function noteLine(n) { return h("p", { class: "note" }, (n.by === "person" ? "You" : n.name || "It") + (n.private ? " (only to you)" : "") + ", " + clock(new Date(n.at).getTime()) + ": " + n.note); }
  // OWNER_router_18: a person sends asks to their own people, passes an ask on, reads what came back (through /xp, its own relay)
  function xp(method, rest, body) {
    return fetch("/xp/members/" + encodeURIComponent(token) + "/" + rest, { method: method, headers: body ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; }, function () { return { ok: r.ok, status: r.status, d: {} }; }); }, function () { return { ok: false, status: 0, d: {} }; });
  }
  function loadPeople() { xp("GET", "people").then(function (r) { if (!r.ok) return; tasks.people = r.d.people || []; tasks.ownerName = r.d.name || null; if (tasks.people.length) loadSent(); else render(); }); }
  function loadSent() { xp("GET", "sent").then(function (r) { if (r.ok) { tasks.sent = r.d; render(); } }); }
  setTimeout(function () { try { loadPeople(); } catch (e) {} }, 0);
  function noticeBox() {
    var n = tasks.personNotice; if (!n) return null;
    return pressAgain({ task_id: "notice" }, h("div", { class: "block", "data-task": "notice" }, h("p", { class: "label" }, "BEFORE ANY ASK FROM A PERSON"), h("p", { class: "lede" }, n.text),
      h("button", { type: "button", class: "go answer", onclick: function (e) { var b = e.currentTarget; pressStatus(b, "One moment\u2026", "busy");
        xp("POST", "people/notice").then(function (r) { if (!r.ok) return pressStatus(b, "Not saved: " + ((r.d && r.d.message) || "try again."), "bad"); tasks.personNotice = null; if (b.blur) b.blur(); tasks.sig = ""; loadTasks(); }); } }, "OK, show me their asks"),
      h("button", { type: "button", class: "quiet answer", onclick: function (e) { var b = e.currentTarget;
        xp("POST", "mutes", { panel_owner: true }).then(function (r) { pressStatus(b, r.ok ? "Muted: their asks will never ring. They still show here." : "Not muted: " + ((r.d && r.d.message) || "try again."), r.ok ? "ok" : "bad"); }); } }, "Mute " + n.from),
      h("a", { href: "#lv-h", class: "quiet" }, "Leave this panel")));
  }
  function passBox(t) {
    if (!tasks.people.length || t.state !== "open") return null;
    var sel = h("select", { "aria-label": "Pass it on to" }, h("option", { value: "" }, "Pass it on to\u2026"), tasks.people.map(function (p) { return h("option", { value: p.member_id }, p.name); }));
    if (tasks.passTo[t.task_id]) sel.value = tasks.passTo[t.task_id];
    sel.addEventListener("change", function () { tasks.passTo[t.task_id] = sel.value; });
    return [sel, h("button", { type: "button", class: "quiet answer", onclick: function (e) { var b = e.currentTarget, to = sel.value; if (!to) return pressStatus(b, "Pick who first.", "bad");
      var who = sel.options[sel.selectedIndex].textContent, body = { to: to }, n = (tasks.note[t.task_id] || "").trim(); if (n) body.note = n;
      cardBusy(b, true); pressStatus(b, "Passing it to " + who + "\u2026", "busy");
      xp("POST", "tasks/" + encodeURIComponent(t.task_id) + "/pass", body).then(function (r) {
        if (!r.ok) { cardBusy(b, false); return pressStatus(b, "Not passed: " + ((r.d && r.d.message) || "try again."), "bad"); }
        delete tasks.note[t.task_id]; pressStatus(b, "Passed to " + who + ". It leaves your list; you see their answer under What you sent.", "ok");
        setTimeout(function () { if (b.blur) b.blur(); tasks.sig = ""; loadTasks(); loadSent(); }, 1500); }); } }, "Pass it on")];
  }
  function sendBox() {
    if (!tasks.people.length) return null;
    var st = tasks.send;
    var boxes = tasks.people.map(function (p) { var c = h("input", { type: "checkbox", value: p.member_id }); c.checked = !!st.to[p.member_id]; c.addEventListener("change", function () { st.to[p.member_id] = c.checked; });
      return h("label", { class: "check" }, c, " " + p.name); });
    var ti = h("input", { type: "text", maxlength: "120", "aria-label": "Title", placeholder: "Title (what it is about)", value: st.title }); ti.addEventListener("input", function () { st.title = ti.value; });
    var tx = h("textarea", { rows: "2", "aria-label": "Your question", class: "task-text", placeholder: "Your question" }, st.text); tx.addEventListener("input", function () { st.text = tx.value; });
    var ch = h("input", { type: "text", maxlength: "300", "aria-label": "Choices, with commas (optional)", placeholder: "Choices, with commas (optional): Pizza, Tacos", value: st.choices }); ch.addEventListener("input", function () { st.choices = ch.value; });
    var ur = h("select", { "aria-label": "How soon" }, [["today", "Today"], ["now", "Now (it rings once)"], ["whenever", "Whenever"]].map(function (u) { return h("option", { value: u[0] }, u[1]); })); ur.value = st.urgency; ur.addEventListener("change", function () { st.urgency = ur.value; });
    return pressAgain({ task_id: "send" }, h("div", { class: "block", "data-task": "send" }, h("p", { class: "label" }, "SEND TO YOUR PEOPLE"), h("p", { class: "note" }, "It reaches them as from " + (tasks.ownerName || "you") + ": your account's name, never typed here."),
      h("div", null, boxes), ti, tx, ch, ur,
      h("button", { type: "button", class: "go answer", onclick: function (e) { var b = e.currentTarget, to = Object.keys(st.to).filter(function (k) { return st.to[k]; });
        if (!to.length) return pressStatus(b, "Pick who it is for.", "bad");
        if (st.title.trim().length < 3 || st.text.trim().length < 3) return pressStatus(b, "Write a title and a question first.", "bad");
        var choices = st.choices.split(",").map(function (c) { return c.trim(); }).filter(Boolean);
        var step = { type: "question", text: st.text.trim() }; if (choices.length) step.choices = choices;
        pressStatus(b, "Sending\u2026", "busy"); b.disabled = true;
        xp("POST", "people/asks", { to: to, title: st.title.trim(), step: step, urgency: st.urgency }).then(function (r) { b.disabled = false;
          if (!r.ok) return pressStatus(b, "Not sent: " + ((r.d && r.d.message) || "try again."), "bad");
          var s = (r.d.sent || []), waits = s.filter(function (x) { return x.waits_until; }), no = r.d.not_sent || [];
          pressStatus(b, "Sent to " + s.map(function (x) { return x.name; }).join(", ") + "." + (waits.length ? " " + waits.map(function (x) { return x.name; }).join(", ") + ": it waits until their tomorrow (their daily limit)." : "") + (no.length ? " Not available: " + no.map(function (x) { return x.name; }).join(", ") + "." : ""), "ok");
          tasks.send = { to: {}, title: "", text: "", choices: "", urgency: st.urgency }; if (b.blur) b.blur(); loadSent(); }); } }, "Send the ask")));
  }
  function sentBox() {
    var s = tasks.sent; if (!s || (!(s.sent || []).length && !(s.passed || []).length)) return null;
    function item(x, passed) {
      var r = x.reply || {}, ans = r.choice || r.text || (x.state === "done" ? "Done" : x.state === "not_now" ? "Not now" : x.state === "approve" ? "Approved" : null);
      var inp = h("input", { type: "text", maxlength: "500", "aria-label": "A note to " + x.to.name, placeholder: "A note to " + x.to.name });
      return pressAgain({ task_id: "s-" + x.task_id }, h("li", { class: "task block", "data-task": "s-" + x.task_id }, h("p", { class: "label" }, (passed ? "PASSED TO " : "TO ") + String(x.to.name || "").toUpperCase() + " \u00b7 " + String(x.state).toUpperCase()),
        h("p", { class: "sub" }, x.title), passed ? h("p", { class: "note" }, "From " + x.from + ".") : null,
        ans ? h("p", null, "Answer: " + ans + (r.note ? " (" + r.note + ")" : "")) : h("p", { class: "note" }, x.waits_until ? "Waits until " + new Date(x.waits_until).toLocaleString() + " (their daily limit)." : "No answer yet."),
        h("div", { class: "task-thread" }, (x.notes || []).map(function (n) { return h("p", { class: "note" }, (n.by === "person" ? x.to.name : "You") + ", " + clock(new Date(n.at).getTime()) + ": " + n.note); })),
        x.state === "open" ? [inp, h("button", { type: "button", class: "quiet answer", onclick: function (e) { var b = e.currentTarget, v = inp.value.trim(); if (!v) return pressStatus(b, "Write the note first.", "bad");
          pressStatus(b, "Sending your note\u2026", "busy"); xp("POST", "sent/" + encodeURIComponent(x.task_id) + "/notes", { note: v }).then(function (r) {
            if (!r.ok) return pressStatus(b, "Not sent: " + ((r.d && r.d.message) || "try again."), "bad"); inp.value = ""; pressStatus(b, "Sent to " + x.to.name + ".", "ok"); setTimeout(loadSent, 1200); }); } }, "Send a note")] : null));
    }
    return h("details", { open: true }, h("summary", null, "What you sent (" + ((s.sent || []).length + (s.passed || []).length) + ")"),
      h("ul", { class: "tasks" }, (s.sent || []).slice(0, 30).map(function (x) { return item(x, false); }), (s.passed || []).slice(0, 30).map(function (x) { return item(x, true); })));
  }
  function replyTask(t, body, btn) {
    var who = (t.connection && t.connection.name) || t.from || "the asker", isNote = body.action === "note";
    function failed(why) { if (btn) { cardBusy(btn, false); pressStatus(btn, why, "bad"); } else { tasks.msg[t.task_id] = why; render(); } }
    if (btn) { cardBusy(btn, true); pressStatus(btn, isNote ? "Sending your note\u2026" : "Sending\u2026", "busy"); }
    else { tasks.msg[t.task_id] = "Sending..."; render(); }
    fetch("/x/members/" + encodeURIComponent(token) + "/tasks/" + encodeURIComponent(t.task_id), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }, function () { return { ok: r.ok, d: {} }; }); })
      .then(function (r) {
        if (r.ok && r.d && r.d.reply && r.d.reply.masked) tasks.notice = r.d.reply.masked;   // OWNER_router_2: a pasted key never rests with us
        if (!r.ok) return failed("Not sent: " + ((r.d && r.d.message) || "try again."));   // the typed words stay where they are
        if (!isNote) tasks.flash = { text: (body.action === "not_now" ? "Not now, sent to " : body.action === "deny" ? "Denied, sent to " : "Sent to ") + who + ": \u201C" + t.title + "\u201D. It is in Done below.", until: Date.now() + 8000 };
        tasks.msg[t.task_id] = "";
        if (isNote) {   // it stays open: the field clears and the note joins the thread now, not at the next reload
          delete tasks.note[t.task_id];
          t.notes = (t.notes || []).concat([{ by: "person", at: new Date().toISOString(), note: body.note }]);
          var li = btn && btn.closest ? btn.closest("li.task") : null;
          if (li) { var inp = li.querySelector("input.task-note"); if (inp) inp.value = ""; var th = li.querySelector(".task-thread"); if (th) th.appendChild(noteLine(t.notes[t.notes.length - 1])); }
          if (btn) { cardBusy(btn, false); pressStatus(btn, "Sent to " + who + ". It stays open; you\u2019ll see their reply here.", "ok");
            setTimeout(function () { var p = tasks.press[t.task_id]; if (p && p.kind === "ok" && p.until <= Date.now() + 50) { delete tasks.press[t.task_id];
              var all = document.querySelectorAll('li.task[data-task="' + t.task_id + '"] .press-status'); for (var k = 0; k < all.length; k++) all[k].parentNode.removeChild(all[k]); } }, 6100); }
          tasks.sig = ""; loadTasks();
        } else {   // answered: say so at the button, then the card moves to Done
          delete tasks.note[t.task_id]; delete tasks.answer[t.task_id];
          if (btn) pressStatus(btn, (body.action === "not_now" ? "Not now, sent to " : body.action === "deny" ? "Denied, sent to " : "Sent to ") + who + ". It moves to Done.", "ok");
          setTimeout(function () { var a = document.activeElement, li2 = btn && btn.closest ? btn.closest("li.task") : null; if (li2 && a && li2.contains(a) && a.blur) a.blur(); tasks.sig = ""; loadTasks(); }, btn ? 1500 : 0);
        } },
        function () { failed("Not sent: no connection. Try again."); });
  }
  function withNote(t, body) { var n = (tasks.note[t.task_id] || "").trim(); if (n) body.note = n; return body; }
  var URG = { now: "NOW", today: "TODAY", whenever: "WHENEVER" };
  // the media check (TRUST's policy/MEDIA_REVIEW.md): one screen; the piece plays here, from our own storage, at most 60 seconds
  var REVIEW_REASONS = ["Sexual content or nudity.", "A child, or anyone who may be under 18.", "Violence, gore, or cruelty to people or animals.", "Hate, or harassment of anyone.",
    "Someone's private information (a name with a face, an address, a phone number, a plate, a screen of messages).", "A scam or a pretence: it poses as a bank, a company, a government, a real person, or person.tools.",
    "Selling, or sending people elsewhere: buy, pay, download, sign up, visit, call, scan a code.", "Medical, legal or money advice, or political campaigning.",
    "Flashing or strobing light, or a sudden very loud or harsh sound.", "Someone's voice or image recorded or made without their agreement (a private call, a cloned voice, a face swap).",
    "It is not what the ask says it is, it changes partway, or it will not play.", "Anything else you would not want to ring on a stranger's phone (one line)."];
  function reviewCard(t) {
    var s = t.step || {}, watch = s.kind === "watch";
    var len = s.seconds ? Math.round(s.seconds) + " seconds" : "length not known";
    var src = "/x/members/" + encodeURIComponent(token) + "/tasks/" + encodeURIComponent(t.task_id) + "/media";
    var player = h(watch ? "video" : "audio", { controls: true, preload: "none", src: src, class: "review-player", playsinline: true });
    player.addEventListener("timeupdate", function () { if (player.currentTime >= 60) { player.pause(); } });
    player.volume = 0.3;
    var sel = h("select", { "aria-label": "The reason" }, h("option", { value: "" }, "Pick the reason"), REVIEW_REASONS.map(function (r, i) { return h("option", { value: String(i + 1) }, (i + 1) + ". " + r); }));
    var other = h("input", { type: "text", maxlength: "200", "aria-label": "One line", placeholder: "One line (only for reason 12)" });
    var msg = tasks.msg[t.task_id] ? h("p", { class: "note", role: "status" }, tasks.msg[t.task_id]) : null;
    return pressAgain(t, h("li", { class: "task block", "data-task": t.task_id },
      h("p", { class: "label" }, "TODAY · FROM PERSON.TOOLS CHECK"),
      h("p", { class: "sub" }, watch ? "Check this before anyone sees it" : "Check this before anyone hears it"),
      h("p", null, "From: " + (s.asker || "an asker") + " · " + (watch ? "watch" : "listen") + " · " + len + " (at most 60 seconds is checked) · for " + (s.people || "its") + " people who joined that asker's panel. Their ask: \u201C" + (s.ask || "") + "\u201D."),
      h("p", { class: "note" }, "Nobody at person.tools has heard or seen this yet. Play it at low volume first. You can stop at any moment; nothing counts against you, and Not now leaves it on your list."),
      player,
      h("p", { class: "label" }, "REFUSE IF ANY OF THESE IS IN IT"), sel, other,
      h("button", { type: "button", class: "quiet answer", onclick: function (e) { var b = e.currentTarget;
        if (!sel.value) { pressStatus(b, "Pick the reason first.", "bad"); return; }
        var body = { action: "refuse", reason: Number(sel.value) }; if (sel.value === String(REVIEW_REASONS.length)) body.text = other.value.trim();
        replyTask(t, body, b); } }, "Refuse"),
      h("p", { class: "note" }, "Pass if none of these is in it, it is what the ask says, and you would be at ease with it playing on a stranger's phone under \u201Cfrom " + (s.asker || "the asker") + "\u201D."),
      h("button", { type: "button", class: "go answer", onclick: function (e) { replyTask(t, { action: "pass" }, e.currentTarget); } }, "Pass"),
      h("button", { type: "button", class: "quiet answer", onclick: function (e) { pressStatus(e.currentTarget, "It stays on your list.", "ok"); } }, "Not now"),
      msg));
  }
  function taskCard(t) {
    if (t.state === "withdrawn") return h("li", { class: "task block task-withdrawn" },   // OWNER_router_3: struck through for a day, no buttons
      h("p", { class: "label" }, "WITHDRAWN · FROM " + String(t.from || "").toUpperCase()), h("p", { class: "sub" }, h("s", null, t.title)), h("p", { class: "note" }, "Withdrawn: " + (t.withdraw_why || "")));
    if (t.step && t.step.type === "review") return reviewCard(t);
    var s = t.step || {}, kids = [];
    kids.push(h("p", { class: "label" }, (URG[t.urgency] || "") + " · FROM " + String(t.from || "").toUpperCase()));
    kids.push(h("p", { class: "sub" }, t.title));
    if (t.sender) kids.push(h("p", { class: "note" }, "From " + t.sender.name + ": " + t.sender.behind));
    if (t.passed_on_by) kids.push(h("p", { class: "note" }, "Passed on to you by " + t.passed_on_by + "."));
    if (s.type === "command") {
      var copied = h("span", { class: "note", role: "status" });
      if (s.where) kids.push(h("p", { class: "note" }, "Where: " + s.where));
      kids.push(h("pre", { class: "task-cmd" }, s.command));
      kids.push(h("button", { type: "button", class: "quiet", onclick: function () {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s.command).then(function () { copied.textContent = "Copied."; }, function () { copied.textContent = "Select the line and copy it."; });
        else copied.textContent = "Select the line and copy it."; } }, "Copy the line"), copied);
      kids.push(h("p", { class: "note" }, t.shell_only || "Only you can run this."));
    } else if (s.type === "link") {
      if (s.text) kids.push(h("p", null, s.text));
      kids.push(h("a", { class: "linkbtn", href: s.url, target: "_blank", rel: "noopener noreferrer" }, "Open the link"));
      if (s.domain) kids.push(h("p", { class: "note" }, "It goes to " + s.domain + (s.sign_in_page ? ". It is a sign-in page: sign in only if you know this site." : ".")));
    } else if (s.type === "approve") {   // OWNER_all_10 C: approve or deny; an editable text may be changed first (the CEO 12:57)
      var ed = s.editable ? h("textarea", { rows: "6", "aria-label": "The text you approve", class: "task-text" }, s.text) : null;
      kids.push(ed || h("p", null, s.text));
      kids.push(h("button", { type: "button", class: "go answer", onclick: function (e) { var b = { action: "approve" }; if (ed && ed.value.trim() && ed.value !== s.text) b.text = ed.value; replyTask(t, withNote(t, b), e.currentTarget); } }, s.approve_label || "Approve"));
      kids.push(h("button", { type: "button", class: "quiet answer", onclick: function (e) { replyTask(t, withNote(t, { action: "deny" }), e.currentTarget); } }, s.deny_label || "Deny"));
    } else if (s.type === "question") {
      kids.push(h("p", null, s.text));
      if (s.choices) s.choices.forEach(function (c) { kids.push(h("button", { type: "button", class: "go answer", onclick: function (e) { replyTask(t, withNote(t, { action: "answer", choice: c }), e.currentTarget); } }, c)); });
      else { var ta = h("textarea", { rows: "2", "aria-label": "Your answer", class: "task-text" }, tasks.answer[t.task_id] || ""); ta.addEventListener("input", function () { tasks.answer[t.task_id] = ta.value; });
        kids.push(ta, h("button", { type: "button", class: "go answer", onclick: function (e) { if (ta.value.trim()) replyTask(t, withNote(t, { action: "answer", text: ta.value.trim() }), e.currentTarget); else pressStatus(e.currentTarget, "Write your answer first.", "bad"); } }, "Send the answer")); }
    }
    if (t.media) {   // the person's own photo or clip from their AI: shown only here, deleted on their schedule
      var msrc = "/x/members/" + encodeURIComponent(token) + "/tasks/" + encodeURIComponent(t.task_id) + "/media";
      kids.push(t.media.kind === "clip" ? h("video", { controls: true, preload: "none", src: msrc, class: "review-player", playsinline: true }) : h("img", { src: msrc, alt: "What " + (t.from || "your AI") + " sent with this", class: "task-photo", loading: "lazy" }));
      kids.push(h("p", { class: "note" }, "Only you see this. It is deleted " + (t.media.deleted_at ? "on " + new Date(t.media.deleted_at).toLocaleDateString() : "on your schedule") + "."));
    }
    if (t.unlocks) kids.push(h("p", { class: "note" }, "It unlocks: " + t.unlocks));
    var nt = h("input", { type: "text", maxlength: "500", "aria-label": "A note (optional)", placeholder: "A note (optional)", class: "task-note", value: tasks.note[t.task_id] || "" });
    nt.addEventListener("input", function () { tasks.note[t.task_id] = nt.value; });
    kids.push(nt);
    if (s.type !== "question" && s.type !== "approve") kids.push(h("button", { type: "button", class: "go answer", onclick: function (e) { replyTask(t, withNote(t, { action: "done" }), e.currentTarget); } }, "Done"));
    kids.push(h("button", { type: "button", class: "quiet answer", onclick: function (e) { replyTask(t, withNote(t, { action: "not_now" }), e.currentTarget); } }, "Not now"));
    kids.push(passBox(t));
    kids.push(h("button", { type: "button", class: "quiet", onclick: function () { blockAsker({ task_id: t.task_id }, (t.connection && t.connection.name) || t.from || "this asker"); } }, "Block this asker"));
    kids.push(h("button", { type: "button", class: "quiet answer", onclick: function (e) { var b = e.currentTarget, n = (tasks.note[t.task_id] || nt.value || "").trim(); if (!n) { pressStatus(b, "Write the note first.", "bad"); return; } replyTask(t, { action: "note", note: n }, b); } }, "Send the note only"));   // it stays open
    kids.push(h("div", { class: "task-thread" }, (t.notes || []).map(noteLine)));
    if (tasks.msg[t.task_id]) kids.push(h("p", { class: "note", role: "status" }, tasks.msg[t.task_id]));
    return pressAgain(t, h("li", { class: "task block", "data-task": t.task_id }, kids));
  }
  function tasksSection() {
    if (!tasks.open.length && !tasks.history.length && !tasks.personNotice && !tasks.people.length && !(tasks.answers || []).length && !(tasks.passed || []).length)
      return state.ownPage ? h("section", { class: "screen", "aria-labelledby": "tasks-h" }, h("p", { class: "label", id: "tasks-h" }, "ASKS FOR YOU"), h("p", { class: "sub" }, "Nothing is waiting."), h("p", { class: "note" }, "When one of your AIs asks you something, it shows here.")) : null;
    var waiting = tasks.open.filter(function (t) { return t.state !== "withdrawn"; }).length;
    var groups = [];
    tasks.open.forEach(function (t) { var g = groups.filter(function (x) { return x.from === t.from; })[0]; if (g) g.items.push(t); else groups.push({ from: t.from, items: [t] }); });
    var hist = h("ul", { class: "task-history" });
    var q = h("input", { type: "search", placeholder: "Search what you have done", "aria-label": "Search your done tasks", value: tasks.q });
    function fillHist() {
      var w = tasks.q.trim().toLowerCase();
      var rows = tasks.history.filter(function (t) { return !w || (t.title + " " + JSON.stringify(t.step) + " " + (t.from || "") + " " + JSON.stringify(t.reply || {})).toLowerCase().indexOf(w) >= 0; }).slice(0, 60);
      fill.apply(null, [hist].concat(rows.length ? rows.map(function (t) {
        var r = t.reply || {};
        return h("li", null, h("span", { class: "label" }, (t.state === "done" ? "DONE" : t.state === "answered" ? "ANSWERED" : "NOT NOW") + " · " + String(t.from || "").toUpperCase()), " ", t.title,
          r.choice || r.text ? ": " + (r.choice || r.text) : "", r.note ? " (" + r.note + ")" : "");
      }) : [h("li", { class: "note" }, w ? "Nothing matches." : "Nothing done yet.")]));
    }
    fillHist();
    q.addEventListener("input", function () { tasks.q = q.value; fillHist(); });
    var el = h("section", { class: "screen", "aria-labelledby": "tasks-h" },
      h("p", { class: "label", id: "tasks-h" }, state.ownPage ? "ASKS FOR YOU" : "TASKS FOR YOU"),
      tasks.notice ? h("p", { class: "note", role: "status" }, tasks.notice) : null,
      tasks.flash && tasks.flash.until > Date.now() ? h("p", { class: "note press-status", role: "status", "data-kind": "ok" }, tasks.flash.text) : null,
      noticeBox(),
      (tasks.answers || []).map(function (a) { return h("p", { class: "note" }, a.from + " answered \u201C" + a.title + "\u201D: " + ((a.reply && (a.reply.choice || a.reply.text)) || a.state) + ". ",
        h("button", { type: "button", class: "quiet", onclick: function () { xp("POST", "sent/read", { task_ids: [a.task_id] }).then(function () { tasks.sig = ""; loadTasks(); }); } }, "Got it")); }),
      waiting ? h("p", { class: "lede" }, waiting === 1 ? "One " + (state.ownPage ? "ask" : "task") + " is waiting for you." : waiting + (state.ownPage ? " asks" : " tasks") + " are waiting for you.") : h("p", { class: "note" }, state.ownPage ? "No ask is waiting." : "No task is waiting."),
      groups.map(function (g) { return [h("p", { class: "label" }, "FROM " + String(g.from || "").toUpperCase()), h("ul", { class: "tasks" }, g.items.map(taskCard))]; }),
      tasks.history.length ? h("details", null, h("summary", null, "Done (" + tasks.history.length + ")"), q, hist) : null,
      (tasks.passed || []).length ? h("details", null, h("summary", null, "Passed on (" + tasks.passed.length + ")"), h("ul", { class: "task-history" }, tasks.passed.map(function (p) {
        return h("li", null, h("span", { class: "label" }, "PASSED TO " + String(p.passed_to).toUpperCase()), " ", p.title, p.reply ? ": " + (p.reply.choice || p.reply.text || p.state) : " (no answer yet)"); }))) : null,
      state.ownPage ? null : sendBox(), state.ownPage ? null : sentBox());
    el.addEventListener("focusout", function () { setTimeout(function () { if (state.redrawLater && !el.contains(document.activeElement)) { state.redrawLater = false; render(); } }, 0); });
    state.taskEl = el;
    return el;
  }
  function render() {
    if (state.left) return;   // after leaving, 'Gone.' stays
    if (state.taskEl && state.taskEl.contains(document.activeElement)) { state.redrawLater = true; return; }   // never under a person typing
    // never redraw under a person who is typing feedback (a redraw moves the box and closes a phone's keyboard)
    if (state.fbEl && state.fbEl.contains(document.activeElement)) { state.redrawLater = true; return; }
    // a waiting call comes first (it is held for only a minute or so); then what the answers changed
    // while a call waits, no earlier call's 'what changed' line above it: it could steer the answer (cold read 5)
    // REACH 3:35 PM CT 16 Nov: a page of your own leads with asks and your AIs; nothing of calls can happen there, so none of it is drawn
    var sections = state.ownPage ? [tasksSection(), aisSection(), ringSection(), blocksSection(), accountSection(), appSection(), (state.receipts && state.receipts.length) ? receiptsSection() : null, privateSection(), feedbackSection(), agreedSection(), leaveSection()].filter(Boolean)
      : (state.offers.length ? [offersSection(), tasksSection()] : [tasksSection(), changedBanner(), offersSection()]).concat([onSection(), ringSection(), aisSection(), blocksSection(), accountSection(), appSection(), receiptsSection(), privateSection(), feedbackSection(), agreedSection(), leaveSection()]).filter(Boolean);
    fill.apply(null, [main].concat(sections));
    if (state.offers.length !== state.lastCount) { live.textContent = state.offers.length ? state.offers.length + " call" + (state.offers.length === 1 ? "" : "s") + " waiting." : "No calls right now."; state.lastCount = state.offers.length; }
    tick();
  }
  function tick() {
    var els = main.querySelectorAll(".held[data-until]");
    for (var i = 0; i < els.length; i++) { var u = Number(els[i].getAttribute("data-until")); if (!u) { els[i].textContent = ""; continue; }
      var left = (u - Date.now()) / 1000; els[i].textContent = left > 20 ? "Your place is held for about " + (left > 90 ? Math.round(left / 60) + " minutes" : "a minute") : left > 0 ? "Your place is held: " + fmt(left) + " left" : "The hold has ended; it may still be open."; }
  }
  var lastSig = "";
  function load() {
    fetch("/o/" + encodeURIComponent(token), { headers: { Accept: "application/json" } }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; });
    }).then(function (r) {
      if (!r.ok) {
        if (r.status === 410 && r.d && r.d.code === "panel_gone") { clearInterval(timer); return fill(main, h("section", { class: "screen" }, h("p", { class: "big" }, "This panel is gone."), h("p", { class: "lede" }, r.d.message || ""))); }
        if (r.status === 404 || r.status === 401) { clearInterval(timer); return fill(main, h("section", { class: "screen" }, h("p", { class: "big" }, "Not found."), h("p", { class: "lede" }, "This member link does not match anyone. Open the link you were given again."))); }
        throw new Error(r.d && r.d.message);
      }
      state.failures = 0; state.offers = (r.d && r.d.offers) || []; state.on = r.d.on != null ? r.d.on : state.on; state.on_until = r.d.on_until || null;
      state.quiet = r.d.quiet || (r.d.quiet_start != null ? { start: r.d.quiet_start, end: r.d.quiet_end, tz: r.d.tz } : state.quiet || null);
      state.settings = r.d.settings || state.settings || {};
      state.missed = Number(r.d.missed_rings) || 0;
      state.notReached = Number(r.d.calls_not_reached) || 0;   // calls in the last day that lapsed without reaching this phone: they count for nothing (chief, 2:38)
      state.waiting = Number(r.d.calls_waiting) || 0; state.nextRing = r.d.next_ring_at || null;   // calls held for the person's quiet hours (router)   // two unanswered rings switch a person Off (P2); the service resets it on any On/Off
      state.ringCap = r.d.ring_cap || r.d.rings || null;   // {used, limit, resets_at} from the service, when it sends it
      // the hour and whether On has run out are in the signature too, so the status and quiet lines never go stale
      var sig = JSON.stringify([state.offers.map(function (o) { return o.seat_token || o.seat_url; }), state.on, state.on_until, state.quiet, state.settings,
        Date.parse(state.on_until || "") > Date.now(), nowHourIn(state.quiet && state.quiet.tz), state.missed, state.waiting, state.nextRing]);
      if (!state.loaded || sig !== lastSig) { lastSig = sig; state.loaded = true; render(); }
    }).catch(function () {
      state.failures++;
      if (!state.loaded) fill(main, h("section", { class: "screen" }, h("p", { class: "label" }, "NOT REACHED"), h("p", { class: "lede" }, "The call service did not answer. This page tries again every 20 seconds.")));
    });
  }
  function loadReceipts() {
    api("GET", "receipts").then(function (r) {
      if (state.left || (!r.ok && state.receipts)) return;   // a failed read keeps what is shown
      var next = r.ok ? (r.d.receipts || []) : [], sig = JSON.stringify(next.map(function (x) { return [x.receipt && x.receipt.receipt_id, changedOf(x)]; }));
      if (sig === state.rcSig && state.receipts) return;
      state.rcSig = sig; state.receipts = next; if (state.loaded) render();
    });
  }
  if (!token) { fill(main, h("section", { class: "screen" }, h("p", { class: "big" }, "No member here."), h("p", { class: "lede" }, "This link is missing its member part."))); return; }
  (function () { var l = document.createElement("link"); l.rel = "manifest"; l.href = "/mf/" + encodeURIComponent(token) + ".webmanifest"; document.head.appendChild(l); })();
  try { sessionStorage.setItem("pt_member", token); } catch (e) {}
  ringCheck();
  load(); loadReceipts(); loadTasks();
  var timer = setInterval(function () { if (document.visibilityState === "visible") { load(); loadTasks(); } }, 20000);
  setInterval(tick, 1000);
  setInterval(function () { if (document.visibilityState === "visible") loadReceipts(); }, 60000);
})();
