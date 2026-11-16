/* person.tools front page: the visitor becomes the person an AI calls, on a real call through the live service, and then
   sees exactly what the agent received about them and what it cost. Nothing here is mocked: when the call service does not
   answer, the page says so and uses the runner's labelled stand-in, and shows only what really left the visitor's phone. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var HOSTS = JSON.parse($("hc-hosts").textContent);
  var CALL = JSON.parse($("hc-call").textContent);
  var host = location.hostname, api, run;
  if (HOSTS.primary.site.indexOf(host) >= 0) { api = "https://" + HOSTS.primary.api; run = "https://" + HOSTS.primary.run; }
  else { api = "https://" + HOSTS.fallback.api; run = "https://" + HOSTS.fallback.run; }
  if (host === "127.0.0.1" || host === "localhost") {
    var q = new URLSearchParams(location.search);
    if (q.get("api")) api = q.get("api").replace(/\/$/, "");
    if (q.get("run")) run = q.get("run").replace(/\/$/, "");
  }
  $("mcp-addr").textContent = api + "/mcp";

  // ---------------------------------------------------------------- small helpers (text only, never innerHTML with data)
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) { var v = attrs[k]; if (v == null || v === false) continue;
      if (k === "class") el.className = v; else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? "" : v); }
    for (var i = 2; i < arguments.length; i++) { var c = arguments[i]; if (c == null || c === false) continue;
      (Array.isArray(c) ? c : [c]).forEach(function (x) { if (x != null && x !== false) el.appendChild(typeof x === "object" ? x : document.createTextNode(String(x))); }); }
    return el;
  }
  function clockNow() { return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" }); }
  function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)); }
  function money(s) { var n = Number(s); return isFinite(n) ? "$" + n.toFixed(2) : String(s); }

  // JSON shown as text, with the visitor's own words marked gold and the AI-side labels marked cyan
  function jsonBlock(obj, mine) {
    var pre = h("pre", { class: "json", tabindex: "0" });
    var text = JSON.stringify(obj, null, 2);
    var re = /("(?:[^"\\]|\\.)*")(\s*:)?|(\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?)/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) pre.appendChild(document.createTextNode(text.slice(last, m.index)));
      if (m[2]) { pre.appendChild(h("span", { class: "k" }, m[1])); pre.appendChild(document.createTextNode(m[2])); }
      else if (m[1]) {
        var raw; try { raw = JSON.parse(m[1]); } catch (e) { raw = m[1]; }
        var isMine = mine && mine.some(function (w) { return w && raw === w; });
        pre.appendChild(h("span", { class: isMine ? "you" : null }, m[1]));
      } else pre.appendChild(h("span", { class: /true|false/.test(m[3]) ? "ai" : null }, m[3]));
      last = re.lastIndex;
    }
    pre.appendChild(document.createTextNode(text.slice(last)));
    return pre;
  }
  // the request an agent sends: folded on a phone (one line), open on a wide screen
  function requestBlock(obj, label) {
    var d = h("details", { class: "req" }, h("summary", null, label || "Show the request"), jsonBlock(obj));
    if (window.matchMedia("(min-width: 901px)").matches) d.open = true;
    return d;
  }
  function apiCall(method, path, body, key) {
    var init = { method: method, headers: { "Content-Type": "application/json", Accept: "application/json" } };
    if (key) init.headers.Authorization = "Bearer " + key;
    if (body !== undefined) init.body = JSON.stringify(body);
    return fetch(api + path, init).then(function (r) {
      return r.text().then(function (t) { var d = null; try { d = JSON.parse(t); } catch (e) { d = { message: t.slice(0, 200) }; } return { ok: r.ok, status: r.status, data: d || {} }; });
    }, function () { return { ok: false, status: 0, data: { code: "unreachable", message: "The call service did not answer." } }; });
  }

  // ---------------------------------------------------------------- the lock screen clock (the visitor's own time)
  function tickLock() {
    var d = new Date();
    $("lock-time").textContent = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/i, "");
    $("lock-date").textContent = d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  }
  tickLock(); setInterval(tickLock, 15000);

  // ---------------------------------------------------------------- steps on the agent's side
  var steps = $("steps");
  function step(id, label, state) {
    var el = $(id);
    if (!el) { el = h("li", { class: "step", id: id }); steps.appendChild(el); }
    el.className = "step " + (state || "live");
    el.replaceChildren(h("p", { class: "label" }, label));
    return el;
  }
  function add(el) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) el.appendChild(arguments[i]); return el; }

  var reaches = [];
  var key = null, callId = null, standin = false, seatUrl = null, mine = [], finished = false, record = null;
  var phoneCol = document.querySelector(".phone-col");
  if (window.matchMedia("(max-width: 900px)").matches) phoneCol.classList.add("idle");

  $("ring-btn").addEventListener("click", start);
  // the agent's log: folded on a phone until the call is over (a non-technical reader lost the call under it); always open on a laptop
  var agentLog = $("agent-log");
  if (agentLog && window.matchMedia("(max-width: 900px)").matches) agentLog.open = false;
  function openLog() { if (agentLog) agentLog.open = true; }
  // copy the MCP address (the agent's one line on the first screen)
  Array.prototype.forEach.call(document.querySelectorAll("button.copy"), function (b) {
    b.addEventListener("click", function () {
      var v = b.getAttribute("data-copy") || "";
      var done = function (ok) { b.textContent = ok ? "Copied" : "Select it and copy"; setTimeout(function () { b.textContent = "Copy"; }, 2400); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(function () { done(true); }, function () { done(false); });
      else done(false);
    });
  });

  // ---------------------------------------------------------------- for the human who sets the budget: a real call over a cap
  $("cap-btn").addEventListener("click", function () {
    var b = $("cap-btn"), out = $("cap-out"); b.disabled = true; b.textContent = "Asking for a call over the cap\u2026";
    var body = { ask: CALL.ask, kind: "listen", content: CALL.content, people: 3, pool: "simulated", pay_per_person_usd: "2.00", max_total_usd: "10.00" };
    var caps = null;
    apiCall("POST", "/v1/keys", { class: "test", caps: { per_call_usd: "1.00", per_day_usd: "5.00" } }).then(function (r) {
      var k = r.data && r.data.key; if (!r.ok || !k) throw new Error((r.data && r.data.message) || "no key");
      caps = r.data.caps || (r.data.principal && r.data.principal.caps) || null;   // the key's caps, as the service holds them
      return apiCall("POST", "/v1/calls", body, k);
    }).then(function (r) {
      b.textContent = "Show it again"; b.disabled = false;
      var d = r.data || {};
      if (r.status !== 402 && d.code !== "over_key_cap") { out.replaceChildren(h("p", { class: "note" }, "Unexpected: the service answered " + r.status + " (" + (d.code || "no code") + ").")); return; }
      var q = d.quote || {};
      out.replaceChildren(
        h("p", { class: "say" }, "This page made a test key the way you would for your agent, with two caps: " +
          (caps && caps.per_call_usd ? money(caps.per_call_usd) : "$1.00") + " for any one call and " + (caps && caps.per_day_usd ? money(caps.per_day_usd) : "$5.00") +
          " in a day. Then, as the agent, it asked for three paid people at $2.00 each."),
        h("dl", { class: "reading" },
          h("dt", null, "price"), h("dd", null, money(q.total_usd || "0") + " in all: " + (q.lines || []).map(function (l) { return (LINE_NAMES[l.kind] || String(l.kind).replace(/_/g, " ")) + " " + money(l.amount_usd); }).join(" \u00B7 ")),
          h("dt", null, "opened"), h("dd", null, "nothing: no one was rung and nothing was held"),
          h("dt", null, "the agent got"), h("dd", null, (d.code || "") + ": \u201C" + (d.message || "") + "\u201D"),
          h("dt", null, "you get"), h("dd", null, "a link the agent can pass to you (",
            d.approve_url ? h("a", { href: d.approve_url.replace(/^https?:\/\/[^/]+/, "") }, "open it") : "approve_url",
            "). During the preview it opens a general page, not this call: approving a call above a cap is not open yet, so nothing over your cap can open.")),
        requestBlock(d, "Show the agent's whole answer"));
    }).catch(function (e) { b.disabled = false; b.textContent = "Show me a call over my cap"; out.replaceChildren(h("p", { class: "note" }, "The live service did not answer (" + (e && e.message ? e.message : "error") + ").")); });
  });

  function start() {
    var btn = $("ring-btn"); btn.removeEventListener("click", start); btn.disabled = true; btn.textContent = "Calling you…";
    // made inside the tap, so the browser lets the phone ring with a sound
    try { ringCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ringCtx = null; }
    phoneCol.classList.remove("idle");
    var hint = $("step-hint"); if (hint) hint.remove();
    getKey().then(function () {
      // The key says what it can reach. Until it lists "self", the live service cannot ring a visitor: rehearse, and say so,
      // rather than send a request we know will be refused.
      if (reaches.indexOf("self") < 0) throw "no-self";
      return quote();
    }).then(open).then(ring, function (why) { useStandin(why); });
  }

  // ------------------------------------------------------------- it rings: a soft two-note chime and a buzz, up to three times
  var ringCtx = null, rings = 0, ringTimer = null, answered = false;
  function chime() {
    if (!ringCtx) return;
    try {
      if (ringCtx.state === "suspended") ringCtx.resume();
      var t = ringCtx.currentTime + 0.03;
      [[880, 0], [660, 0.2]].forEach(function (n) {
        var o = ringCtx.createOscillator(), g = ringCtx.createGain();
        o.type = "sine"; o.frequency.value = n[0];
        g.gain.setValueAtTime(0.0001, t + n[1]); g.gain.exponentialRampToValueAtTime(0.09, t + n[1] + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + n[1] + 0.32);
        o.connect(g); g.connect(ringCtx.destination); o.start(t + n[1]); o.stop(t + n[1] + 0.36);
      });
    } catch (e) {}
  }
  function ringOnce() {
    if (answered) return;
    rings++;
    chime();
    var ph = $("phone"); ph.classList.remove("buzz"); void ph.offsetWidth; ph.classList.add("buzz");
    if (rings < 3) ringTimer = setTimeout(ringOnce, 4000);
  }
  function stopRinging() { answered = true; clearTimeout(ringTimer); $("phone").classList.remove("buzz"); $("notif").classList.remove("ringing"); }

  var demoLimited = false;   // the demo mint allows a few keys an hour from one network
  function getKey() {
    // the demo key comes from this site's own server (POST /demo-key, chief's ruling 14 Nov 4:25 AM CT): only such a key
    // reaches pool self, so the page can ring its visitor. If it fails, a plain test key (simulated people) and a rehearsal.
    try { key = sessionStorage.getItem("pt_demo_key"); } catch (e) {}
    var el = step("step-key", "0 \u00B7 A TEST KEY, MADE FOR THIS PAGE");
    if (key) { try { reaches = JSON.parse(sessionStorage.getItem("pt_demo_reaches") || "[]"); } catch (e) {}
      add(el, h("p", { class: "say" }, "Using the test key this page made for you earlier.")); el.className = "step done"; return Promise.resolve(key); }
    add(el, h("p", { class: "say" }, "This page asks its own server for a test key made for this demonstration. An agent gets its own with POST /v1/keys {\"class\": \"test\"}: no account, no money."));
    function done(r, how) {
      var k = r.data && (r.data.key || r.data.api_key || (r.data.keys && r.data.keys[0]));
      if (!r.ok || !k) return false;
      key = typeof k === "string" ? k : k.key; try { sessionStorage.setItem("pt_demo_key", key); } catch (e) {}
      el.className = "step done";
      var reach = [].concat(r.data.pools || r.data.reaches || []); reaches = reach;
      try { sessionStorage.setItem("pt_demo_reaches", JSON.stringify(reach)); } catch (e) {}
      add(el, h("p", { class: "say" }, "A test key (" + key.slice(0, 9) + "\u2026, " + how + ") holding " + money((r.data.balance_usd || (r.data.principal && r.data.principal.balance_usd) || "100.00")) + " of test money (not real money: nothing is charged). It can reach " + (reach.length ? reach.map(function (r) { return ({ simulated: "simulated people", self: "you" })[r] || r; }).join(" and ") : "simulated people") + "."));
      return true;
    }
    var own = fetch("/demo-key", { method: "POST", headers: { Accept: "application/json" }, cache: "no-store" }).then(function (r) {
      if (r.status === 429) demoLimited = true;
      return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d || {} }; });
    }, function () { return { ok: false, status: 0, data: {} }; });
    return own.then(function (r) {
      if (done(r, "made by this page's server for the demonstration")) return key;
      return apiCall("POST", "/v1/keys", { class: "test" }).then(function (r2) {
        if (done(r2, "an ordinary test key")) return key;
        el.className = "step bad"; add(el, h("p", { class: "note" }, "Not made: " + (r2.data.message || ("status " + r2.status)))); throw "key";
      });
    });
  }
  function callBody(withOpen) {
    var b = JSON.parse(JSON.stringify(CALL));
    if (withOpen) { b.max_total_usd = "0.00"; }   // router's fixed demo body, word for word (trust's limit 1); no key needed (D28)
    return b;
  }
  function quote() {
    var el = step("step-quote", "1 · IT ASKS THE PRICE FIRST: " + CALL._tool + "_quote");
    var body = callBody(false); delete body._tool;
    add(el, h("p", { class: "say" }, "Nothing is spent by asking."), requestBlock(body, "Show what it sends"));
    return apiCall("POST", "/v1/quotes", body, key).then(function (r) {
      if (!r.ok) { el.className = "step bad"; add(el, h("p", { class: "note" }, "Refused: " + (r.data.message || r.status))); throw "quote"; }
      el.className = "step done";
      var lines = r.data.lines || [];
      var tbl = h("table", { class: "lines" }, lines.map(function (l) { var name = String(LINE_NAMES[l.kind || l.line] || l.label || l.kind || l.line || l.name || "line").replace(/_/g, " "); return h("tr", null, h("td", null, name.charAt(0).toUpperCase() + name.slice(1)), h("td", null, money(l.amount_usd || l.usd || "0"))); }),
        h("tr", { class: "total" }, h("td", null, "Total"), h("td", null, money(r.data.total_usd || "0"))));
      var allZero = lines.every(function (l) { return Number(l.amount_usd || l.usd || 0) === 0; });
      add(el, h("p", { class: "say" }, "The price, line by line" + (r.data.test_money ? ", in test money:" : ":")), tbl,
        allZero ? h("p", { class: "note" }, "Every line is $0.00: you are an unpaid test, so nobody is paid and no fee is due. Step 5 shows the same call with paid people.") : null);
      return r.data;
    });
  }
  function findSeat(d) {
    if (d.self_seat_url) return d.self_seat_url;
    var found = null;
    (function walk(o) { if (found || !o) return; if (typeof o === "string") { if (/\/c\/[A-Za-z0-9._~-]+/.test(o)) found = o; return; }
      if (typeof o === "object") for (var k in o) walk(o[k]); })(d);
    return found;
  }
  function open() {
    var el = step("step-open", "2 · IT OPENS THE CALL: " + CALL._tool);
    var body = callBody(true); delete body._tool;
    add(el, requestBlock(body, "Show what it sends"));
    return apiCall("POST", "/v1/calls", body, key).then(function (r) {
      seatUrl = r.ok ? findSeat(r.data) : null;
      if (!r.ok || !seatUrl) {
        el.className = "step bad";
        add(el, h("p", { class: "note" }, r.ok ? "The call opened, but the service did not hand this page a seat for you yet." : "Not opened: " + (r.data.message || ("status " + r.status)) + (r.data.code ? " (" + r.data.code + ")" : "")));
        throw "open";
      }
      callId = r.data.call_id;
      el.className = "step done";
      add(el, h("p", { class: "say" }, "Call " + callId + " is open on the live service, with the test key this page made. One person is rung: you."));
      return r.data;
    });
  }

  function ring(d) {
    var minutes = (d && d.quote && d.quote.minutes) || CALL.minutes || 2;
    $("notif-text").textContent = "An unpaid test call: " + minutes + " minute" + (minutes === 1 ? "" : "s");
    showNotif();
    if (!standin) waitForAnswer();
  }
  function showNotif() {
    $("lock-empty").hidden = true; if ($("lock-hint")) $("lock-hint").hidden = true; $("notif").hidden = false; $("notif").classList.add("ringing");
    ringOnce();
    // the button now points at the phone: one press takes you to the notification (or the open call)
    var btn = $("ring-btn"); btn.disabled = false; btn.textContent = standin ? "Rehearsal: answer on the phone" : "Ringing: answer on the phone";
    btn.onclick = function () { phoneCol.scrollIntoView({ behavior: "smooth", block: "nearest" }); ($("lock").hidden ? $("seat") : $("notif")).focus({ preventScroll: true }); };
    var u = seatUrl.indexOf("http") === 0 ? seatUrl : run + seatUrl;
    var fr = $("seat"); fr.src = u;
    $("notif").addEventListener("click", function () { stopRinging(); $("phone").classList.add("open"); $("phone-note").textContent = "Read the card: who is asking, how long it takes, what it pays and what is noted. Then take the call, or say Not now."; $("lock").hidden = true; fr.hidden = false; fr.focus(); }, { once: true });
    if (window.matchMedia("(max-width: 900px)").matches) phoneCol.scrollIntoView({ behavior: "smooth", block: "start" });
    $("phone-note").textContent = "It is ringing. Tap the notification to open the call.";
  }

  function useStandin(why) {
    standin = true;
    // Never fall back silently on a public page (chief, 00:37 CT): say it beside the button and under the phone.
    var rn = $("ring-note");
    rn.replaceChildren(h("b", null, "The live service did not take this call, so this is a rehearsal on this page. "), "You see the same screens a person sees; no agent receives your answer, and nothing you do leaves this page except to it.");
    rn.className = "note rehearsal";
    $("ring-btn").textContent = "Rehearsal: answer on the phone";
    var el = step("step-standin", demoLimited ? "A REHEARSAL THIS TIME" : "THE LIVE SERVICE CANNOT RING YOU YET", "bad");
    add(el, h("p", { class: "say" }, demoLimited ? "This page has made many demonstration calls from your network in the last hour, and the service allows only so many, so this one is a rehearsal: the same screens a person sees, and no agent receives your answer. Try again in an hour to be rung for real. When you send it, this page shows exactly what left your phone." : why === "no-self" ? "Your test key reaches simulated people only; ringing a visitor on this page is not switched on yet. So this is a rehearsal: the same screens a person sees, and no agent receives your answer. When you send it, this page shows exactly what left your phone." : "The live service refused the call, so this is a rehearsal: the same screens a person sees, and no agent receives your answer. When you send it, this page shows exactly what left your phone."));
    seatUrl = run + "/c/standin-front" + Math.random().toString(36).slice(2, 10);
    $("notif-text").textContent = "Rehearsal: an unpaid test call, 2 minutes";
    showNotif();
    $("phone-note").textContent = "A rehearsal of the page a person opens when rung. Tap the notification.";
    step("step-wait", "3 · WAITING FOR THE PERSON");
    add($("step-wait"), h("p", { class: "say" }, "That's you. Take the call on the phone."));
  }

  // ---------------------------------------------------------------- the agent waits, as an agent does
  var cursor = null;
  function waitForAnswer() {
    var el = step("step-wait", "3 · IT WAITS FOR ANSWERS: " + CALL._tool + "_results");
    var line = h("p", { class: "note" }, "");
    add(el, h("p", { class: "say" }, "Waiting for the person. That's you: take the call on the phone."), line);
    (function poll() {
      if (finished) return;
      var path = "/v1/calls/" + encodeURIComponent(callId) + "/responses?detail=full&wait_seconds=25" + (cursor ? "&after=" + encodeURIComponent(cursor) : "");
      line.textContent = "Asked at " + clockNow() + ". Each check waits up to 25 seconds for a new answer, then the agent asks again; the call itself stays open until its deadline.";
      apiCall("GET", path, undefined, key).then(function (r) {
        if (!r.ok) { line.textContent = "The service said " + (r.data.message || r.status) + "; asking again in 10 seconds."; return setTimeout(poll, 10000); }
        var d = r.data; cursor = d.cursor || cursor;
        var got = (d.records && d.records.length) || (d.people && d.people.length) || (d.responses && d.responses.length) || Number(d.answered) > 0;
        if (got) { finished = true; el.className = "step done"; return showResult(d); }
        if (d.complete) { finished = true; el.className = "step done"; return showResult(d); }
        var next = Math.max(2, Math.min(30, Number(d.next_check_after_seconds) || 5));
        line.textContent = "No answer yet at " + clockNow() + ". The service said: look again in " + next + " s.";
        setTimeout(poll, next * 1000);
      });
    })();
  }

  var LINE_NAMES = { to_people: "To the people", pool_fee: "Pool fee", router_fee: "Router fee", rail_fee: "Card fee", reserve: "Reserve (returned if unused)", tax: "Tax" };
  var UNOBSERVED = { audible: "whether the sound was audible to you", unassisted_answer: "whether you formed the answer without help", same_person: "whether one person was there throughout",
    output_device: "headphones or speaker", attention: "whether you were paying attention" };
  function observedWords(o) {
    if (!o || typeof o !== "object") return String(o || "");
    var w = [];
    if (o.media_seconds != null) w.push("played " + Math.round(o.played_seconds || 0) + " of " + Math.round(o.media_seconds) + " seconds" + (o.realtime_seconds != null ? " (" + o.realtime_seconds + " s by the service's own clock)" : ""));
    if (o.visible_fraction != null) w.push("page in front " + Math.round(o.visible_fraction * 100) + "% of the time");
    if (o.pauses != null) w.push(o.pauses + " pause" + (o.pauses === 1 ? "" : "s") + ", " + (o.replays || 0) + " replay" + (o.replays === 1 ? "" : "s"));
    if (o.stalled_seconds) w.push(o.stalled_seconds + " s waiting for the network (never held against you)");
    if (o.seat_seconds != null) w.push(o.seat_seconds + " s from taking the call to answering");
    return w.join("; ") + ".";
  }
  var EVIDENCE = {"said": "An answer, without a record that shows the person took in the material. Still paid.", "attended": "The record shows the material played in front of the person by the rule for its kind.", "voiced": "Attended, and the person also gave a spoken answer of at least 3 seconds in the same seat (recorded only with that person's yes; not offered during the preview)."};
  var PRICE = {"example": {"case": "Three people, two minutes, the $1.00 floor", "lines_usd": {"people": "3.00", "reserve_held": "0.75", "router_fee_held": "0.30"}, "held_at_open_usd": "4.05", "if_all_finish_on_time_usd": {"people": "3.00", "router_fee": "0.30", "total": "3.30", "returned": "0.75"}, "public": true}, "status": "Published price, not yet charged. During the preview every amount is test money.", "pool_pct": 20, "floor": "18"};
  // step 6: the agent tells the person what their answer changed (the send-outcome tool). The page acts as the agent here, so
  // its line says exactly what it did: it read the answer. The phone shows the line within seconds (P8).
  function outcomeStep(resp) {
    if (!callId || $("step-outcome")) return;
    var a = resp && resp.answers || {}, again = a.would_play_again;
    var text = again === true ? "This page read your answer: you would play it again. A real agent sends a line like this after it changes its work."
      : again === false ? "This page read your answer: you would not play it again. A real agent sends a line like this after it changes its work."
      : "This page read your answer. A real agent sends a line like this after it changes its work.";
    var el = step("step-outcome", "6 \u00B7 IT TELLS YOU WHAT YOUR ANSWER CHANGED: " + CALL._tool + "_send_outcome");
    add(el, requestBlock({ call_id: callId, text: text }, "Show what it sends"));
    apiCall("POST", "/v1/calls/" + encodeURIComponent(callId) + "/outcome", { text: text }, key).then(function (r) {
      if (!r.ok) { el.className = "step bad"; add(el, h("p", { class: "note" }, "Not sent: " + (r.data.message || r.status))); return; }
      el.className = "step done";
      add(el, h("p", { class: "say" }, r.data.status === "delivered" ? "Delivered to the " + (r.data.people === 1 ? "person" : r.data.people + " people") + " who answered. The line appears on the phone within seconds, and on the signed receipt." : "Held for a person to read before anyone sees it."),
        r.data.status === "delivered" ? h("button", { class: "go you", type: "button", onclick: function () { phoneCol.scrollIntoView({ behavior: "smooth", block: "start" }); } }, "See it on your phone") : null);
    });
  }
  function costStep() {
    var ex = PRICE.example; if (!ex || $("step-cost")) return;
    var el = step("step-cost", "5 \u00B7 WHAT A PAID CALL COSTS: AN EXAMPLE FROM THE PRICE LIST", "done");
    var f = ex.if_all_finish_on_time_usd || {}, l = ex.lines_usd || {};
    var rows = [["To the people", money(f.people)], ["Pool fee", f.pool_fee ? money(f.pool_fee) : "none (the agent's own people; " + PRICE.pool_pct + "% only on our own pool, not open yet)"],
      ["Router fee", money(f.router_fee)], ["Tax", "not charged"]];
    add(el, h("p", { class: "say" }, "You were an unpaid test, so your call cost nothing. Here is the price list's own example for paid people (" + ex.case.charAt(0).toLowerCase() + ex.case.slice(1) + "), not your call:"),
      h("table", { class: "lines" }, rows.map(function (r) { return h("tr", null, h("td", null, r[0]), h("td", null, r[1])); }),
        h("tr", { class: "total" }, h("td", null, "The agent pays, if everyone finishes on time"), h("td", null, money(f.total)))),
      h("p", { class: "note" }, "Held when the call opens: " + money(ex.held_at_open_usd) + ". That includes a reserve of " + money(l.reserve_held) +
        ", because people are paid at least $" + PRICE.floor + " an hour on the median time they actually take: if they take longer than the quote, they are topped up from the reserve after the call closes, and someone who stops is paid for their time. What is not used (" + money(f.returned) +
        " when everyone finishes on time) comes back. The most a call can ever cost is what it holds, which is never above its max_total_usd. " + PRICE.status));
  }
  function showResult(d) {
    var el = step("step-result", "4 · WHAT THE AGENT GOT BACK ABOUT YOU", "done");
    var resp = (d.records || d.responses || [])[0] || (d.people || [])[0] || {};
    if (!resp.evidence && resp.level) resp.evidence = resp.level;
    var words = []; var a = resp.answers || {};
    Object.keys(a).forEach(function (k) { if (typeof a[k] === "string") words.push(a[k]); });
    mine = words;
    add(el, h("p", { class: "say" }, "In plain words, this is what the agent now knows about you:"));
    var dl = h("dl", { class: "reading" });
    function row(k, v) { dl.appendChild(h("dt", null, k)); dl.appendChild(h("dd", null, v)); }
    var ans = resp.answers || {};
    Object.keys(ans).forEach(function (k) { var v = ans[k]; row(k.replace(/_/g, " "), typeof v === "boolean" ? (v ? "yes" : "no") : Array.isArray(v) ? v.join(", ") : "\u201C" + String(v) + "\u201D"); });
    if (resp.evidence) row("evidence", resp.evidence === "attended" ? "attended: the whole piece played with the page in front, by the rule for listening calls. It is not proof of attention; see what cannot be observed." : resp.evidence + ": " + (EVIDENCE[resp.evidence] || ""));
    if (resp.simulated === false || d.simulated === false) row("simulated", "no: the person was you, on this page. During the preview, every call to strangers goes to simulated people, marked simulated.");
    var rec = resp.record || {};
    if (rec.observed) row("observed", observedWords(rec.observed));
    if (rec.unobserved) row("not observable", [].concat(rec.unobserved).map(function (u) { return UNOBSERVED[u] || String(u).replace(/_/g, " "); }).join("; ") + ".");
    if (resp.level_reason) row("why", resp.level_reason + ".");
    row("not in it", "anything that says who you are: no name, no address on the internet, and no record of which keys you pressed or where you tapped.");
    var sp = d.spend || d.money;
    if (sp) row("cost", money(sp.spent_usd || "0") + " spent, " + money(sp.returned_usd || "0") + " returned" + (sp.test_money ? " (test money)" : ""));
    add(el, dl);
    var whole = h("details", { class: "req" }, h("summary", null, "Show the whole result, as the agent received it (your words marked)"), jsonBlock(d, words));
    if (window.matchMedia("(min-width: 901px)").matches) whole.open = true;
    add(el, whole);
    costStep();
    outcomeStep(resp);
    openLog();
    setTimeout(function () { el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 300);
    var btn = $("ring-btn"); btn.disabled = false; btn.textContent = "Call me again"; btn.onclick = function () { location.reload(); };
    if (!resp.answers && d.complete) add(el, h("p", { class: "note" }, "The call closed without an answer from you: the agent gets that, and nothing else."));
  }

  // ---------------------------------------------------------------- what the person's page reports to this page
  window.addEventListener("message", function (e) {
    if (e.origin !== run || !e.data || e.data.source !== "pt-runner") return;
    var t = e.data.type;
    if (t === "screen" && !$("lock").hidden) return;   // the call page loads behind the notification: caption it once it is on screen
    if (t === "screen") $("phone-note").textContent = ({ ring: "Read the card: who is asking, how long it takes, what it pays and what is noted. Then take the call, or say Not now.",
      listening: "Listening. The record of what you heard is written in front of you.", answer: "Your turn. The box shows what the asker receives.",
      arrived: "Arrived.", stopped: "Stopped. Nothing counts against you.", declined: "You said no. Nothing counts against you." })[e.data.screen] || "";
    if (t === "changed") $("phone-note").textContent = "What your answer changed, on the person's own screen, seconds after the agent sent it.";
    if (t === "arrived" || t === "stopped" || t === "declined") {
      record = e.data.record || null;
      if (standin) {
        var el = step("step-wait", "3 · WHAT LEFT YOUR PHONE", "done");
        add(el, h("p", { class: "say" }, t === "arrived" ? "This is everything your phone sent with your answer. With the live service, the agent's result is built from it, and nothing about who you are is added." : "You " + (t === "declined" ? "said no" : "stopped") + ". This is what your phone sent."),
          jsonBlock(record || { reason: t }, record && record.answers ? Object.keys(record.answers).map(function (k) { return record.answers[k]; }) : []));
      }
      if (standin) costStep();
      openLog();
      setTimeout(function () { ($("step-result") || $("step-wait") || $("agent")).scrollIntoView({ behavior: "smooth", block: "start" }); }, 1400);
    }
  });
  // the first real call's outcome: the canon's line, shown once /v1/proof has the outcome (REACH 10:34 and 11:01 AM CT 15 Nov)
  (function firstCallOutcome() {
    var el = document.getElementById("fc-outcome"); if (!el) return;
    apiCall("GET", "/v1/proof").then(function (r) {
      var p = el.parentNode, want = p.getAttribute("data-call") || "";
      var ours = (r.ok && r.data && r.data.ours) || [], c = ours.filter(function (x) { return x && (x.outcome_sent || x.outcome_line) && (!want || !x.call_id || x.call_id === want); })[0];
      if (!c || !el.textContent) return; p.hidden = false;   // the canon's words (third person), never the raw line written to the person
    });
  })();
  // ---------------------------------------------------------------- OWNER_market_5: one question, one tap, no sound
  // (market/DEMO_ONE_TAP.md). The page, as an AI, asks the visitor which first line it should show; the visitor's tap changes the
  // line at once, and the panel shows what the AI received: the answer, the evidence and the receipt, as the API returns them.
  var ASK_ME = true;   // on since 1:12 PM CT (the API carries the 'pick-line' demo; until then the listen leads, as before
  (function askMe() {
    var btn = $("ask-btn"), box = $("ask-inline"), got = $("ask-received"); if (!btn || !box || !got) return;
    if (!ASK_ME) { var a = $("ask"), d = $("other-asks"); if (a) a.hidden = true; if (d) { d.open = true; var sm = d.querySelector("summary"); if (sm) sm.hidden = true; } return; }
    var LINES = { A: "When an AI needs a person, it calls one.", B: "An AI asks a person one question, and the answer changes what happens." };
    var PICK = { ask: "Which first line should this page show you?", kind: "answer", people: 1, pool: "self", max_total_usd: "0.00",
      answer_fields: { line: { type: "choice", label: "Which first line should this page show you?", choices: ["A", "B"] } } };
    var h1 = $("h1"), first = h1 ? h1.innerHTML : "";
    if (h1 && h1.textContent.trim()) LINES.A = h1.textContent.replace(/\s+/g, " ").trim();   // A is this page's own first line, as written (REACH 12:34 PM CT 16 Nov)
    function showLine(c) {
      if (!h1 || !LINES[c]) return;
      if (c === "A") h1.innerHTML = first; else h1.replaceChildren(h("span", { class: "ln" }, LINES[c]));
      var n = $("ask-line-note"); if (!n) { n = h("p", { class: "note", id: "ask-line-note" }); h1.parentNode.insertBefore(n, h1.nextSibling); }
      n.textContent = "This page now opens with the line you chose.";
    }
    try { var kept = sessionStorage.getItem("pt_line"); if (kept && LINES[kept]) showLine(kept); } catch (e) {}
    function fail(why) { btn.disabled = false; btn.querySelector(".b1").textContent = "Ask me again"; box.hidden = false; box.replaceChildren(h("p", { class: "note" }, why)); }
    function demoKey() {
      var k = null; try { k = sessionStorage.getItem("pt_demo_key"); } catch (e) {}
      if (k) return Promise.resolve(k);
      return fetch("/demo-key", { method: "POST", headers: { Accept: "application/json" }, cache: "no-store" }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d || {} }; }); })
        .then(function (r) { var kk = r.ok && r.d && (r.d.key || r.d.api_key); if (!kk) throw new Error(r.d && r.d.message || "no key");
          try { sessionStorage.setItem("pt_demo_key", kk); sessionStorage.setItem("pt_demo_reaches", JSON.stringify([].concat(r.d.pools || r.d.reaches || []))); } catch (e) {} return kk; });
    }
    btn.addEventListener("click", function () {
      btn.disabled = true; btn.querySelector(".b1").textContent = "Asking…"; got.hidden = true;
      var k, call, tok, shownAt;
      demoKey().then(function (kk) { k = kk;
        return apiCall("POST", "/v1/calls", Object.assign({ idempotency_key: "pick-" + Math.random().toString(36).slice(2, 12) }, PICK), k);
      }).then(function (r) {
        if (!r.ok || !r.data.self_seat_url) throw new Error((r.data && r.data.message) || ("status " + r.status));
        call = r.data.call_id; tok = String(r.data.self_seat_url).split("/c/")[1];
        return apiCall("POST", "/v1/seats/" + encodeURIComponent(tok) + "/take", {});
      }).then(function (r) {
        if (!r.ok) throw new Error((r.data && r.data.message) || ("status " + r.status));
        shownAt = performance.now();
        apiCall("POST", "/v1/seats/" + encodeURIComponent(tok) + "/events", { batch: 1, events: [{ seq: 1, t: 0, type: "visible" }] });
        btn.hidden = true; box.hidden = false;
        var choose = function (c) { return h("button", { type: "button", class: "go pick", "data-line": c, onclick: function () { answer(c); } }, LINES[c]); };
        box.replaceChildren(h("p", { class: "label" }, "AN AI IS ASKING, FOR PERSON.TOOLS"), h("p", { class: "sub", id: "ask-q" }, PICK.ask), choose("A"), choose("B"));
        var b0 = box.querySelector("button"); if (b0) b0.focus();
      }).catch(function (e) { fail("The ask did not open: " + (e && e.message ? e.message : e) + ". Nothing was kept."); });
      function answer(c) {
        Array.prototype.forEach.call(box.querySelectorAll("button"), function (b) { b.disabled = true; });
        var ms = Math.round(performance.now() - shownAt), hidden = document.visibilityState === "hidden";
        showLine(c); try { sessionStorage.setItem("pt_line", c); } catch (e) {}
        apiCall("POST", "/v1/seats/" + encodeURIComponent(tok) + "/response", { answers: { line: c }, answer_input: { line: { how: "tapped" } },
          summary: { hidden_seconds: hidden ? ms / 1000 : 0, seat_seconds: Math.round(ms / 100) / 10 } }).then(function (r) {
          if (!r.ok) throw new Error((r.data && r.data.message) || ("status " + r.status));
          return apiCall("GET", "/v1/calls/" + encodeURIComponent(call) + "/responses?detail=full", undefined, k);
        }).then(function (r) {
          var x = ((r.data && r.data.responses) || [])[0] || {}, o = x.observed || {};
          var secs = o.seat_seconds != null ? o.seat_seconds : Math.round(ms / 100) / 10;
          var front = o.visible_fraction == null || o.visible_fraction >= 0.99;
          box.hidden = true; got.hidden = false;
          got.replaceChildren(h("p", { class: "label" }, "WHAT THE AI RECEIVED"),
            h("pre", { class: "mono" }, JSON.stringify(x.answers || { line: c })),
            h("p", null, "Evidence: tapped " + secs + " s after the question appeared" + (front ? "; this page was in front" : "") + (x.evidence ? " (" + x.evidence + ")" : "") + "."),
            x.receipt_id ? h("p", null, "Receipt: ", h("a", { href: api + "/v1/seats/" + encodeURIComponent(tok) + "/receipt", target: "_blank", rel: "noopener" }, x.receipt_id)) : null,
            h("p", { class: "note" }, "No sound, no material: one question, and your answer changed this page."));
          btn.hidden = false; btn.disabled = false; btn.querySelector(".b1").textContent = "Ask me again";
        }).catch(function (e) { fail("Your answer did not arrive: " + (e && e.message ? e.message : e) + "."); });
      }
    });
  })();
})();
