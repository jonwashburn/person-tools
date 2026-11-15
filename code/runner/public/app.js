/* the person\'s side: the call page. A person's phone opens /c/<seat_token>.
   Rules this file keeps (runner/DESIGN.md): the phone talks only to this address; nothing an asker wrote is ever put into
   the page as HTML; the asker gets a summary of what happened, never a key-by-key trace. */
(function () {
  "use strict";

  var T0 = performance.now();
  function now() { return Math.round(performance.now() - T0); }
  var token = (function () { var raw = (location.pathname.split("/")[2] || "").trim(); try { return decodeURIComponent(raw); } catch (e) { return raw; } })();
  // older iPhone Safari (before 14) has no replaceChildren: the page uses it everywhere
  if (!Element.prototype.replaceChildren) Element.prototype.replaceChildren = function () {
    while (this.firstChild) this.removeChild(this.firstChild);
    for (var i = 0; i < arguments.length; i++) { var k = arguments[i]; this.appendChild(typeof k === "object" ? k : document.createTextNode(String(k))); }
  };
  var S = "/s/" + encodeURIComponent(token);
  var main = document.getElementById("main");
  var barLabel = document.getElementById("bar-label");
  var stopBtn = document.getElementById("stop-btn");
  var reportBtn = document.getElementById("report-btn");   // top right on the ring card, where Stop or report sits once the call is taken
  var live = document.getElementById("live");
  var seat = null, taken = false, finished = false;

  // ------------------------------------------------------------------ tiny DOM helper (text only; never innerHTML)
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { add(el, k); }); return; }
    el.appendChild(typeof kid === "string" || typeof kid === "number" ? document.createTextNode(String(kid)) : kid);
  }
  // The front page embeds this page to ring its visitor; it hears which screen is showing, and on the last screen the
  // record the visitor's own phone sent. Posted only to the site's own origins (canon), never anywhere else.
  function notifyParent(msg) {
    if (window.parent === window) return;
    msg.source = "pt-runner";
    (window.PT_SITE_ORIGINS || []).forEach(function (o) { try { window.parent.postMessage(msg, o); } catch (e) {} });
  }
  function show(screen, label) {
    if (reportBtn) reportBtn.hidden = true;
    main.textContent = "";
    main.appendChild(screen);
    if (label) barLabel.textContent = label;
    var SCR = { "A CALL FOR YOU": "ring", "LISTENING": "listening", "WATCHING": "listening", "LOOKING": "listening", "COMPARING": "listening", "PLAYING": "listening", "YOUR TURN": "answer", "DONE": "arrived", "STOPPED": "stopped", "DECLINED": "declined" };
    if (SCR[label]) notifyParent({ type: "screen", screen: SCR[label] });
    window.scrollTo(0, 0);
    var first = screen.querySelector("h1, .ask, .big");
    if (first) { first.setAttribute("tabindex", "-1"); first.focus({ preventScroll: true }); }
    setTimeout(checkMore, 0);
  }
  // A screen whose words run on under the docked buttons says so: a fade and "More below", gone once the page is at its end
  // (a card once cut a sentence in half under the dock with no sign that there was more: design pass, 14 Nov).
  var moreBtn = null, selfDemo = false;
  function checkMore() {
    var dock = main.querySelector(".dock");
    if (!dock) return;
    if (!moreBtn) moreBtn = h("button", { class: "more-cue", type: "button", onclick: function () {
      var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollBy({ top: Math.round(window.innerHeight * 0.6), behavior: calm ? "auto" : "smooth" }); } }, "More below \u2193");
    if (moreBtn.parentNode !== dock) dock.insertBefore(moreBtn, dock.firstChild);
    var more = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight) > 16;
    moreBtn.hidden = !more; dock.classList.toggle("more", more);
  }
  window.addEventListener("scroll", checkMore, { passive: true });
  window.addEventListener("resize", checkMore);
  if (window.ResizeObserver) new ResizeObserver(function () { checkMore(); }).observe(main);
  function say(text) { live.textContent = ""; setTimeout(function () { live.textContent = text; }, 30); }

  // ------------------------------------------------------------------ talking to the call service (same address only)
  function api(path, method, body) {
    var init = { method: method || "GET", headers: {} };
    if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
    return fetch(S + path, init).then(function (r) {
      return r.text().then(function (t) {
        var data = null;
        try { data = t ? JSON.parse(t) : null; } catch (e) { data = { message: t }; }
        return { ok: r.ok, status: r.status, data: data || {} };
      });
    }, function () { return { ok: false, status: 0, data: { code: "offline", message: "No connection." } }; });
  }

  // ------------------------------------------------------------------ the record: what happened, reported a few times a minute
  var tel = {
    seq: 0, batch: 0, queue: [], timer: null,
    intervals: [], lastPos: null, lastWall: null, realtime: 0,
    pauses: 0, replays: 0, seeksForward: 0, hiddenMs: 0, hiddenSince: null, playing: false, media: 0,
    lastSample: 0, seekFrom: null, inputs: {}, stalledMs: 0, stallSince: null, mutedMs: 0, extra: {}
  };
  var takeT = null;
  function ev(type, extra) {
    var t = now();
    if (type === "take") takeT = t;
    // both names on every event: SEAT_CONTRACT (t = ms since the page opened, pos) and D9 (t_ms = ms since take, pos_s)
    var e = { seq: ++tel.seq, t: t, t_ms: takeT == null ? 0 : t - takeT, type: type };
    if (extra) for (var k in extra) e[k] = extra[k];
    if (e.pos != null) e.pos_s = e.pos;
    tel.queue.push(e);
  }
  function addInterval(a, b) {
    if (!(b > a)) return;
    var out = [], placed = false;
    tel.intervals.forEach(function (iv) {
      if (iv[1] < a - 0.05 || iv[0] > b + 0.05) out.push(iv);
      else { a = Math.min(a, iv[0]); b = Math.max(b, iv[1]); }
    });
    out.push([a, b]);
    out.sort(function (x, y) { return x[0] - y[0]; });
    tel.intervals = out;
  }
  function played() { return tel.intervals.reduce(function (s, iv) { return s + iv[1] - iv[0]; }, 0); }
  function summary() { var base = summaryBase(); for (var k in tel.extra) base[k] = typeof tel.extra[k] === "function" ? tel.extra[k]() : tel.extra[k]; return base; }
  function summaryBase() {
    var hid = tel.hiddenMs + (tel.hiddenSince != null ? performance.now() - tel.hiddenSince : 0);
    var m = tel.media || 0, p = played();
    return {
      played_seconds: round1(p), coverage: m ? Math.min(1, round3(p / m)) : 0, realtime_seconds: round1(tel.realtime),
      pauses: tel.pauses, replays: tel.replays, seeks_forward: tel.seeksForward, hidden_seconds: round1(hid / 1000),
      media_seconds: round1(m),
      stalled_seconds: round1((tel.stalledMs + (tel.stallSince != null ? performance.now() - tel.stallSince : 0)) / 1000),
      muted_seconds: round1(tel.mutedMs / 1000)
    };
  }
  function round1(x) { return Math.round(x * 10) / 10; }
  function round3(x) { return Math.round(x * 1000) / 1000; }
  var lastFlush = 0;
  function pulse() {
    if (!taken) return;
    if (tel.playing && audio) ev("tick", { pos: curPos() });
    if (tel.playing || now() - lastFlush >= 15000) flush(false);
  }
  function startPulse() { if (!tel.timer) tel.timer = setInterval(pulse, 5000); }
  function flush(beacon) {
    if (!taken || !tel.queue.length) return;
    lastFlush = now();
    var body = JSON.stringify({ batch: ++tel.batch, page_ms: now(), events: tel.queue.splice(0), summary: summary() });
    if (beacon && navigator.sendBeacon) {
      try { if (navigator.sendBeacon(S + "/events", new Blob([body], { type: "text/plain;charset=UTF-8" }))) return; } catch (e) {}
    }
    var pr = fetch(S + "/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true })
      .then(function (r) { if (r.status >= 500) throw new Error("lost"); })
      .catch(function () { try { tel.queue = JSON.parse(body).events.concat(tel.queue); } catch (e) {} });
    inflight.push(pr); pr.then(function () { inflight = inflight.filter(function (x) { return x !== pr; }); });
    return pr;
  }
  var inflight = [];
  // the last batch must land before the seat closes, or the router drops it (and with it, say, the end of a hidden span)
  function flushNow() { flush(false); return Promise.all(inflight.slice()).then(function () {}, function () {}); }
  document.addEventListener("visibilitychange", function () {
    var hidden = document.visibilityState === "hidden";
    if (hidden) { if (tel.hiddenSince == null) tel.hiddenSince = performance.now(); }
    else if (tel.hiddenSince != null) { tel.hiddenMs += performance.now() - tel.hiddenSince; tel.hiddenSince = null; }
    ev(hidden ? "hidden" : "visible", { pos: curPos() });
    if (hidden) flush(false);   // a normal keepalive post: the same path as every batch (a beacon only when the page closes)
  });
  window.addEventListener("pagehide", function () { ev("pagehide", { pos: curPos() }); flush(true); });
  window.addEventListener("blur", function () { if (taken) ev("blur", { pos: curPos() }); });
  window.addEventListener("focus", function () { if (taken) ev("focus", { pos: curPos() }); });

  var audio = null;
  var unlockAudio = null, startOnTake = false, arrivedFresh = false;   // arrivedFresh: a seat an outside panel's person was given on arrival   // listen: the Take tap itself starts the sound (two taps: the ring, then Take)
  function curPos() { return audio ? round1(audio.currentTime || 0) : null; }

  // ------------------------------------------------------------------ words
  function money(s) { var n = Number(s); return isFinite(n) ? "$" + n.toFixed(2) : String(s); }
  function isUnpaid(p) {
    if (!p) return true;
    if (typeof p === "string") return /unpaid/i.test(p);
    return !!p.unpaid_test || Number(p.per_person_usd || 0) === 0;
  }
  function humanKey(k) { var s = String(k).replace(/[_-]+/g, " ").trim(); return s.charAt(0).toUpperCase() + s.slice(1); }
  function fmt(t) { t = Math.max(0, Math.round(t || 0)); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); }
  var KIND = {
    listen: { verb: "LISTEN", noun: "of sound", unit: "s", bar: "LISTENING" },
    watch: { verb: "WATCH", noun: "of video", unit: "s", bar: "WATCHING" },
    view: { verb: "LOOK", noun: "a picture", unit: "", bar: "LOOKING" },
    play: { verb: "PLAY", noun: "a game", unit: "min", bar: "PLAYING" },
    compare: { verb: "COMPARE", noun: "pieces", unit: "", bar: "COMPARING" },
    answer: { verb: "ANSWER", noun: "questions", unit: "", bar: "ANSWERING" }
  };
  function defaultRecorded(kind) {
    var out = [];
    if (kind === "listen" || kind === "watch") out.push("How the " + (kind === "listen" ? "sound" : "video") + " played: where you paused, skipped or replayed.");
    if (kind === "view" || kind === "compare") out.push("How long each piece was on your screen.");
    out.push("Whether this page was in front or hidden while it ran.");
    out.push("Your answers, and whether each was typed or pasted (so the asker knows the words are yours).");
    return out;
  }
  var RATING = {
    general: "General: nothing violent, sexual, medical or meant to upset.",
    mild: "Mild: may include strong opinions or mild language."
  };

  // ------------------------------------------------------------------ 1. the ring card
  function ringCard() {
    var x = seat.experience || {}, kind = x.kind || "answer", K = KIND[kind] || KIND.answer;
    var unpaid = isUnpaid(seat.pay);
    var askerName = (seat.asker && (seat.asker.name || seat.asker.display_name)) || "not stated";
    selfDemo = /^you\b/i.test(askerName);   // the visitor's own call from the front page: no queue, nobody else behind it
    var recorded = Array.isArray(seat.recorded) && seat.recorded.length ? seat.recorded : defaultRecorded(kind);
    var members = seat.panel && Number(seat.panel.members);

    // D26: the hourly rate, how long records are kept, the download size, training use (shown when the seat says them)
    var details = [];
    var nQ = Object.keys(seat.fields || {}).length;   // how many questions follow, so the card and the page that rang say the same
    var thenAnswer = nQ > 1 ? "answer " + (["", "one", "two", "three", "four", "five"][nQ] || nQ) + " short questions." : "type your answer.";
    var mins = Number(seat.minutes) || 0, per = seat.pay && typeof seat.pay === "object" ? Number(seat.pay.per_person_usd) : 0;
    var hourly = seat.pay && seat.pay.per_hour_usd ? Number(seat.pay.per_hour_usd) : (mins > 0 ? (per * 60) / mins : 0);
    if (!unpaid && per > 0 && mins > 0) details.push(["Pay.", money(per) + " for about " + mins + " minute" + (mins === 1 ? "" : "s") + ": " + money(hourly) + " an hour."]);
    if (seat.may_train_on_answers === true) details.push(["AI training.", "The asker may train AI on your written answers. Your voice, never."]);
    else if (seat.may_train_on_answers === false) details.push(["AI training.", "No. Your answers are not used to train AI."]);
    if (kind === "listen") details.push(["Sound.", "It plays when you tap Take this call and listen: turn your volume up or use headphones. If you cannot hear it, say Not now; nothing counts against you."]);
    if (kind === "watch") details.push(["Sound and picture.", "You will need to see and hear it. It starts silent and blurred; you choose when to see and hear it. If you cannot, say Not now; nothing counts against you."]);
    if (kind === "view") details.push(typeof (itemsOf(x)[0] || {}).text === "string" && !(itemsOf(x)[0] || {}).media_id
      ? ["A short text.", "You will read it on this page. If you cannot, say Not now; nothing counts against you."]
      : ["Picture.", "You will need to see it: it comes with no description in words. If you cannot see it, say Not now; nothing counts against you."]);
    if (kind === "compare") details.push(["Pieces side by side.", itemsOf(x).every(function (it) { return typeof it.text === "string" && !it.media_id; })
      ? "Short texts to read and compare. If you cannot, say Not now; nothing counts against you."
      : "You will need to see or hear each piece; they come with no description in words. If you cannot, say Not now; nothing counts against you."]);
    if (kind === "play") details.push(["A game on this page.", "You will need to see the screen and tap or type. It runs in a closed box on this page, with its ways out to the internet blocked as far as your browser allows. If you cannot play it, say Not now; nothing counts against you."]);
    // what the person needs to have ready (sound, a screen) comes first, where it shows above the buttons (a cold read, 14 Nov)
    var needIx = details.findIndex(function (d) { return /^(Sound|Picture|A short text|Pieces side by side|A game on this page)/.test(d[0]); });
    if (needIx > 0) details.unshift(details.splice(needIx, 1)[0]);
    if (members && members < 5) details.push(["Not anonymous.", "This panel has " + members + " member" + (members === 1 ? "" : "s") + ", so whoever runs it can tell whose answer is whose."]);
    // what is recorded, in one line above the fold (every cold reader looked for it in the first ten seconds); the full list is below
    var recWhat = { listen: "how it played (pauses, replays), whether this page was in front", watch: "how it played (pauses, replays, sound on or off), whether this page was in front",
      view: "how long it was shown, whether this page was in front", compare: "the time on each piece, whether this page was in front",
      play: "how long you played and how many taps and keys (never which)", answer: "how long you took" }[kind] || "what happened on this page";
    details.push(["Recorded.", recWhat.charAt(0).toUpperCase() + recWhat.slice(1) + ", and your answers. Never anything that says who you are."]);
    var bytes = Number(seat.download_bytes || x.bytes || (seat.media && seat.media.bytes) || 0);
    if (bytes > 0) details.push(["Download.", (bytes >= 1e6 ? (bytes / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1e3)) + " KB") +
      (kind === "listen" || kind === "watch" ? "; it starts playing before it has all arrived." : " before it shows.")]);
    // how long things are kept: the seat's numbers (router: kept {answers_days, record_days, recordings_days, note})
    function keptLine() {
      var raw = seat.kept, k = raw && typeof raw === "object" ? raw : null;
      var words = function (v) { return v && typeof v === "object" ? (v.text || v.note || null) : (typeof v === "string" ? v : null); };
      function fromDays(d) {
        var parts = [];
        var what = { listen: "how it played, pauses, replays, time away from this page", watch: "how it played, pauses, replays, time away from this page",
          view: "how long it was shown, time away from this page", compare: "the time on each piece, time away from this page",
          play: "how long you played and how many taps and keys", answer: "how long you took, and whether each answer was typed or pasted" }[kind] || "what happened on this page";
        if (d.record_days) parts.push("The detailed record of this call (" + what + ") for " + d.record_days + " days");
        if (d.answers_days) { var mo = Math.ceil(Number(d.answers_days) / 30.4); parts.push("your answers and a short summary of that record up to " + (mo >= 2 ? mo + " months" : d.answers_days + " days")); }
        if (seat.voice && d.recordings_days) parts.push("a spoken answer's recording " + d.recordings_days + " days");
        var t = parts.join("; ");
        return t.charAt(0).toUpperCase() + t.slice(1) + ". Sooner if you leave and delete everything.";
      }
      // 1. the seat's numbers; 2. the seat's own words; 3. a bare number of days with the published schedule
      // (legal/PRIVACY.md: the detailed record 30 days, answers up to 13 months). Older seats meant the detailed record
      // by kept_days (30), newer ones the answers (395).
      if (k && (k.record_days || k.answers_days)) return fromDays(k);
      var kt = words(seat.records_kept) || words(seat.retention) || words(raw);
      if (kt) return kt.charAt(0).toUpperCase() + kt.slice(1) + (/[.!]$/.test(kt) ? "" : ".");
      var kd = Number(seat.kept_days) || (typeof raw === "number" ? raw : 0);
      if (kd > 0) return fromDays({ record_days: kd <= 60 ? kd : 30, answers_days: kd > 60 ? kd : 395, recordings_days: 90 });
      return null;
    }
    var kept = keptLine();
    if (kept) details.push(["Kept.", kept]);
    var held = h("p", { class: "held", id: "held" });
    var take = h("button", { class: "go", type: "button", onclick: doTake }, takeLabel());
    var matFact;
    if (kind === "listen" || kind === "watch") {   // the piece's length: seconds when short, minutes:seconds when long, a dash when not given
      var secs = Math.round(Number(x.seconds) || 0);
      matFact = h("div", { class: "fact" }, secs <= 0 ? h("span", { class: "num" }, "\u2013")
        : secs < 90 ? h("span", { class: "num" }, String(secs), h("small", null, "s"))
        : h("span", { class: "num" }, fmt(secs)), h("span", { class: "label" }, secs > 0 ? K.verb : K.verb + " (LENGTH NOT GIVEN)"));
    }
    else {
      var nItems = Number(x.count) || itemsOf(x).length || 1;
      var allText = itemsOf(x).length > 0 && itemsOf(x).every(function (it) { return typeof it.text === "string" && !it.media_id; });
      if (kind === "answer") nItems = Object.keys(seat.fields || {}).length || nItems;
      var factLabel = { answer: nItems === 1 ? "QUESTION" : "QUESTIONS", view: allText ? (nItems === 1 ? "TEXT TO READ" : "TEXTS TO READ") : nItems === 1 ? "PICTURE TO LOOK AT" : "PICTURES TO LOOK AT", compare: "PIECES TO COMPARE", play: nItems === 1 ? "GAME TO PLAY" : "GAMES TO PLAY" }[kind] || K.verb;
      matFact = h("div", { class: "fact" }, h("span", { class: "num" }, String(nItems)), h("span", { class: "label" }, factLabel));
    }

    var card = h("section", { class: "screen", "aria-labelledby": "the-ask" },
      h("p", { class: "label" }, "THE ASK"),
      h("h1", { class: "ask", id: "the-ask" }, "“" + (seat.ask || "No question was given.") + "”"),
      h("p", { class: "note how-it-works" }, ({ listen: "A short task on this page: you listen, then " + thenAnswer, watch: "A short task on this page: you watch, then " + thenAnswer,
        view: "A short task on this page: you look, then " + thenAnswer, compare: "A short task on this page: you compare the pieces, then " + thenAnswer,
        play: "A short task on this page: you play, then " + thenAnswer,
        answer: typeof (itemsOf(x)[0] || {}).text === "string" ? "A short text to read and a few questions on this page: you type your answers." : "A few questions on this page: you type your answers." }[kind] || "A short task on this page: you look or listen, then type your answer.") + " Nobody will talk to you."),
      /^you\b/i.test(askerName)   // the visitor's own demo call: say it plainly (a cold read could not parse "for you, trying it on ..., who is responsible")
        ? h("p", { class: "who" }, h("span", { class: "ai" }, "An AI is asking"), ". ", h("strong", null, "You"), " started this call yourself, as a test, on the " + (window.PT_NETWORK || "front") + " page.")
        : h("p", { class: "who" }, h("span", { class: "ai" }, "An AI is asking"), ", for ", h("strong", null, askerName), ", who is responsible for this call."),
      h("div", { class: "facts", role: "group", "aria-label": "The call in numbers" },
        h("div", { class: "fact" }, h("span", { class: "num" }, String(seat.minutes || "?"), h("small", null, "min")), h("span", { class: "label" }, "ABOUT")),
        h("div", { class: "fact" }, unpaid ? h("span", { class: "unpaid" }, "UNPAID TEST") : h("span", { class: "num" }, money(seat.pay.per_person_usd)), h("span", { class: "label" }, unpaid ? "NOTHING IS PAID" : "PAID TO YOU")),
        matFact),
      details.length ? h("ul", { class: "details" }, details.map(function (d) { return h("li", null, h("b", null, d[0] + " "), d[1]); })) : null,
      h("div", { class: "block" },
        h("p", { class: "label" }, "WHAT IS RECORDED IF YOU TAKE IT"),
        h("ul", null, recorded.map(function (r) { return h("li", null, String(r)); })),
        h("p", { class: "note" }, h("strong", null, "Never sent to the asker: "), "anything that says who you are. The page never records which keys you press or where on the screen you tap: it notes the player's own events (play, pause, skip), whether the page is in front, and how each answer was entered.")),
      h("p", { class: "note" }, h("strong", null, "Content. "), RATING[seat.content_rating] || ("Rated: " + (seat.content_rating || "not stated") + ".")),
      h("p", { class: "note" }, "Saying no or stopping partway leaves no mark against you. If two calls in a row run out without an answer, you are switched Off so nobody keeps ringing you; switch On again any time. ", h("button", { class: "textlink", type: "button", onclick: reportFromCard }, "Report this call")),
      h("div", { class: "dock" }, take, h("div", { class: "dock-row" }, held, h("button", { class: "textlink plain", type: "button", onclick: doDecline }, "Not now")))
    );
    show(card, "A CALL FOR YOU");
    if (reportBtn) { reportBtn.hidden = false; reportBtn.onclick = reportFromCard; }
    say("A call for you. " + (seat.ask || ""));
    countdown(held, take);
  }

  function countdown(el, takeBtn) {
    if (arrivedFresh) { el.textContent = "Your place is kept for you."; return; }
    var end = Date.parse(seat.offer_expires_at || "");
    if (!isFinite(end)) { el.textContent = ""; return; }
    function tick() {
      if (taken || !document.body.contains(el)) return;
      var left = Math.round((end - Date.now()) / 1000);
      if (left > 0) { el.textContent = (selfDemo ? "The call stays open for you: " : "Your place is held: ") + (left > 20 ? "about " + (left > 90 ? Math.round(left / 60) + " min" : "a minute") : fmt(left) + " left"); setTimeout(tick, 1000); }   /* the words name what is held (chief, 10:17) */
      else { el.textContent = "The hold has ended. You can still try; if the call is full, nothing is lost."; takeBtn.textContent = "Try to take it"; }
    }
    tick();
  }

  // P11 'You can report any call, and it stops' - also before taking it (the tester notice names this button)
  function reportFromCard() {
    var d2 = h("dialog", { "aria-labelledby": "rep-title" });
    d2.appendChild(h("div", { class: "sheet" },
      h("h2", { id: "rep-title" }, "Report this call?"),
      h("p", null, "Use this if the ask looks wrong, unsafe, or not what a call here should be. You do not have to take it."),
      h("button", { class: "choice upset", type: "button", onclick: function (ev2) {
        if (finished || taking) return; ev2.currentTarget.disabled = true; finished = true;
        api("/stop", "POST", { reason: "upset", send_partial: false }).then(function (r) {
          if (d2.close) d2.close(); d2.remove(); finished = true;
          notifyParent({ type: "stopped", record: { reason: "report" } });
          show(h("section", { class: "screen" }, h("h1", { class: "big" }, r.ok ? "Reported." : "Declined."),
            h("p", { class: "lede" }, r.ok ? "Thank you. The call is paused for everyone until the operator reviews it. Nothing counts against you." : "You said no to this call. Reporting before taking it did not go through just now; the call has been declined, and nothing counts against you."),
            h("p", { class: "note" }, "You can close this page.")), "REPORTED");
          if (!r.ok) api("/stop", "POST", { reason: "decline", send_partial: false });
        });
      } }, h("b", null, "Report it"), h("span", null, "It is paused for everyone until the operator reviews it.")),
      h("button", { class: "quiet", type: "button", onclick: function () { if (d2.close) d2.close(); d2.remove(); } }, "Back")));
    document.body.appendChild(d2);
    if (d2.showModal) d2.showModal(); else { d2.setAttribute("open", ""); d2.className += " fallback-sheet"; }
  }
  function doDecline() {
    if (taking || finished) return;
    api("/stop", "POST", { reason: "decline", send_partial: false });
    finished = true;
    show(h("section", { class: "screen" },
      h("h1", { class: "big" }, "No problem."),
      h("p", { class: "lede" }, "You said no to this call. Nothing counts against you."),
      h("p", { class: "note" }, "You can close this page.")), "DECLINED");
    notifyParent({ type: "declined", record: { reason: "decline" } });
  }

  var taking = false;
  function takeLabel() { return ((seat.experience || {}).kind || "") === "listen" ? "Take this call and listen" : "Take this call"; }
  function doTake(e) {
    if (taking || finished) return;
    taking = true;
    var btn = e.currentTarget; btn.disabled = true; btn.textContent = "Taking it…";
    if (reportBtn) reportBtn.hidden = true;
    if (((seat.experience || {}).kind || "") === "listen") {
      try { unlockAudio = new Audio("/silence.wav"); var pr = unlockAudio.play(); if (pr && pr.catch) pr.catch(function () {}); startOnTake = true; } catch (x) { unlockAudio = null; }
    }
    api("/take", "POST", {}).then(function (r) {
      taking = false;
      if (finished) return;
      if (r.status === 409) return gone("Someone else took the last place.", "This call already has every answer it needed. Nothing is lost, and nothing counts against you.");
      if (r.status === 410) return gone("This offer has ended.", "The call no longer needs an answer. Nothing counts against you.");
      if (!r.ok) { if (reportBtn) reportBtn.hidden = false; startOnTake = false; if (unlockAudio) { unlockAudio.pause(); unlockAudio = null; } btn.disabled = false; btn.textContent = takeLabel(); return problem(r, "The call could not be taken."); }
      // 5: time away before taking is not time away from the call
      tel.queue = []; tel.hiddenMs = 0; tel.hiddenSince = document.visibilityState === "hidden" ? performance.now() : null;
      if (r.data && r.data.experience) seat = Object.assign(seat, r.data);
      taken = true;
      stopBtn.hidden = false;
      ev("take", {});
      startPulse();
      experience();
    });
  }

  function gone(title, text) {
    finished = true;
    show(h("section", { class: "screen" }, h("h1", { class: "big" }, title), h("p", { class: "lede" }, text), h("p", { class: "note" }, "You can close this page.")), "NO LONGER NEEDED");
  }
  function problem(r, title) {
    var msg = (r.data && r.data.message) || "Something went wrong on our side.";
    var box = h("div", { class: "block err", role: "alert" }, h("p", { class: "label" }, title.toUpperCase()), h("p", null, msg));
    var cur = main.querySelector(".screen");
    var old = cur && cur.querySelector(".err");
    if (old) old.remove();
    if (cur) cur.insertBefore(box, cur.firstChild); else show(h("section", { class: "screen" }, box));
  }

  // ------------------------------------------------------------------ 2. the experience
  function experience() {
    var kind = (seat.experience && seat.experience.kind) || "answer";
    if (kind === "listen") return listen();
    if (kind === "watch") return watch();
    if (kind === "view") return view();
    if (kind === "compare") return compare();
    if (kind === "play") return play();
    return answerScreen();
  }

  var PLAY = "M8 5v14l11-7z", PAUSE = "M6 5h4v14H6zm8 0h4v14h-4z";
  function icon(d) { var s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true");
    var p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", d); s.appendChild(p); return s; }

  function listen() { return playable("listen"); }
  function watch() { return playable("watch"); }
  function playable(kind) {
    var isV = kind === "watch";
    var x = seat.experience;
    tel.media = Number(x.seconds) || 0;
    var canvas = h("canvas", { class: isV ? "wave strip" : "wave", "aria-hidden": "true" });
    // watch: the video starts blurred and silent; one tap shows it; sound and grey are one tap away (P1)
    var vid = null, vidWrap = null;
    if (isV) {
      vid = h("video", { class: "vid blurred", playsinline: true, "webkit-playsinline": true, preload: "auto", "aria-label": "The video the asker sent" });
      vid.muted = true; vid.defaultMuted = true;
      var cover = h("button", { class: "reveal", type: "button" }, h("b", null, "Tap to show the video"), h("span", null, "It starts blurred and silent, so you choose when to see and hear it."));
      var soundBtn = h("button", { type: "button", "aria-pressed": "false" }, "Sound on");
      var greyBtn = h("button", { type: "button", "aria-pressed": "false" }, "Grey");
      var blurBtn = h("button", { type: "button" }, "Blur again");
      cover.addEventListener("click", function () { vid.classList.remove("blurred"); cover.hidden = true; ev("reveal", { pos: curPos() }); say("The video is showing."); });
      blurBtn.addEventListener("click", function () { vid.classList.add("blurred"); cover.hidden = false; ev("blur_again", { pos: curPos() }); });
      soundBtn.addEventListener("click", function () { vid.muted = !vid.muted; soundBtn.setAttribute("aria-pressed", vid.muted ? "false" : "true"); soundBtn.textContent = vid.muted ? "Sound on" : "Sound off"; });
      greyBtn.addEventListener("click", function () { var g = vid.classList.toggle("grey"); greyBtn.setAttribute("aria-pressed", g ? "true" : "false"); });
      vidWrap = h("div", { class: "vidwrap" }, h("div", { class: "picwrap" }, vid, cover), h("div", { class: "tools" }, soundBtn, greyBtn, blurBtn));
    }
    var pp = h("button", { class: "pp", type: "button", "aria-label": "Play", disabled: true }, icon(PLAY));
    var clockL = h("span", null, "0:00"), clockR = h("span", null, fmt(tel.media));
    var status = h("p", { class: "note", "aria-live": "polite" }, isV ? "Loading the video…" : "Loading the sound…");
    var rv = {};
    var lab = {};
    function cell(key, label) { rv[key] = h("b", null, "0"); lab[key] = h("span", null, " " + label); return h("span", { class: "rv" }, rv[key], lab[key]); }
    var record = h("div", { class: "record", "aria-label": "What the asker will see about how you listened" },
      h("p", { class: "label" }, isV ? "WHAT THE ASKER SEES ABOUT YOUR WATCHING" : "WHAT THE ASKER SEES ABOUT YOUR LISTENING"),
      cell("heard", isV ? "played" : "heard"), cell("pauses", "pauses"), cell("replays", "replays"), cell("hidden", "away from this page"),
      isV ? cell("muted", "silent") : null);
    var next = h("button", { class: "go you", type: "button", onclick: function () { if (audio) audio.pause(); answerScreen(); } }, "Answer");
    var scr = h("section", { class: "screen" },
      h("p", { class: "label" }, x.title ? String(x.title).toUpperCase() : isV ? "WATCH" : "LISTEN"),
      h("h1", { class: "lede" }, "“" + (seat.ask || "") + "”"),
      vidWrap,
      h("div", { class: "player" }, canvas, h("div", { class: "clock" }, clockL, clockR), pp, status),
      h("p", { class: "note" }, (isV ? "Watch as you like" : "Listen as you like") + ": pause, replay, or tap the " + (isV ? "strip" : "wave") + " to skip ahead. These counts never reject or rate you" + (isUnpaid(seat.pay) ? "" : " and never change what you are paid") + "; they tell the asker how the piece was heard, and nothing more."),
      record, next);
    show(scr, isV ? "WATCHING" : "LISTENING");

    audio = isV ? vid : (unlockAudio || new Audio());
    unlockAudio = null;
    if (!isV && /silence\.wav$/.test(audio.src || "")) audio.pause();
    audio.preload = "auto";
    var peaks = null;

    function draw() {
      var dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, hgt = canvas.clientHeight;
      if (!w) return;
      if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr); }
      var c = canvas.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, hgt);
      var cs = getComputedStyle(document.documentElement);
      var ink = cs.getPropertyValue("--ink").trim(), hair = cs.getPropertyValue("--hair").trim(), you = cs.getPropertyValue("--you").trim();
      var n = Math.max(24, Math.floor(w / 4)), bw = w / n, mid = hgt / 2, m = tel.media || 1;
      for (var i = 0; i < n; i++) {
        var t0 = (i / n) * m, t1 = ((i + 1) / n) * m;
        var amp = peaks ? peaks[Math.min(peaks.length - 1, Math.floor((i / n) * peaks.length))] : 0.18;
        var covered = tel.intervals.some(function (iv) { return iv[0] <= t0 + 0.01 && iv[1] >= t1 - 0.01; });
        var bh = Math.max(2, amp * (hgt - 8));
        c.fillStyle = covered ? ink : hair; c.globalAlpha = covered ? 1 : 0.5;
        c.fillRect(i * bw + 0.5, mid - bh / 2, Math.max(1, bw - 1.5), bh);
      }
      c.globalAlpha = 1;
      var px = ((audio.currentTime || 0) / m) * w;
      c.fillStyle = you; c.fillRect(Math.min(w - 3, px), 0, 3, hgt);
    }
    function refresh() {
      clockL.textContent = fmt(audio.currentTime);
      var s = summary();
      rv.heard.textContent = fmt(s.played_seconds) + " of " + fmt(tel.media);
      rv.pauses.textContent = String(s.pauses); lab.pauses.textContent = s.pauses === 1 ? " pause" : " pauses";
      rv.replays.textContent = String(s.replays); lab.replays.textContent = s.replays === 1 ? " replay" : " replays";
      rv.hidden.textContent = fmt(s.hidden_seconds);
      if (rv.muted) rv.muted.textContent = fmt(s.muted_seconds || 0);
      draw();
    }
    function loop() { if (!audio) return; if (tel.playing) { track(); refresh(); requestAnimationFrame(loop); } }
    function track() {
      var cur = audio.currentTime, w = performance.now();
      if (tel.lastPos != null && !audio.seeking) {
        var d = cur - tel.lastPos, dw = (w - tel.lastWall) / 1000;
        if (d >= 0 && d <= dw * 1.1 + 0.5) { addInterval(tel.lastPos, cur); if (dw < 2) { tel.realtime += Math.min(d, dw * 1.1); if (audio.muted) tel.mutedMs += Math.min(d, dw) * 1000; } }
      }
      tel.lastPos = cur; tel.lastWall = w;
    }

    tel.mutedSaid = false;   // a new player: say again if it starts silent
    audio.addEventListener("play", function () {
      if (tel.atEnd) { tel.replays++; tel.atEnd = false; tel.autoRewind = true; }
      if (!tel.mutedSaid && audio.muted) { tel.mutedSaid = true; ev("mute", { pos: curPos() }); }
      tel.playing = true; tel.lastPos = audio.currentTime; tel.lastWall = performance.now();
      pp.replaceChildren(icon(PAUSE)); pp.setAttribute("aria-label", "Pause"); status.textContent = "Playing."; ev("play", { pos: curPos() }); requestAnimationFrame(loop);
    });
    audio.addEventListener("pause", function () {
      track(); stallClose(); tel.playing = false;
      if (!audio.ended) { tel.pauses++; ev("pause", { pos: curPos() }); status.textContent = "Paused at " + fmt(audio.currentTime) + "."; }
      pp.replaceChildren(icon(PLAY)); pp.setAttribute("aria-label", "Play"); refresh();
    });
    audio.addEventListener("ended", function () {
      track(); stallClose(); tel.playing = false; tel.atEnd = true; ev("ended", { pos: curPos() }); refresh(); flush(false);
      pp.replaceChildren(icon(PLAY)); pp.setAttribute("aria-label", "Play again");
      status.textContent = "That was all of it. Answer when you are ready, or play it again.";
      say("The sound has ended. You can answer now.");
    });
    audio.addEventListener("seeking", function () { if (tel.seekFrom == null) tel.seekFrom = tel.lastPos != null ? tel.lastPos : 0; });
    audio.addEventListener("seeked", function () {
      var from = tel.seekFrom || 0, to = audio.currentTime; tel.seekFrom = null;
      if (tel.autoRewind && to < 0.3) { tel.autoRewind = false; }   // the rewind a replay after the end makes: counted at play
      else { tel.atEnd = false; tel.autoRewind = false; if (to < from - 1) tel.replays++; else if (to > from + 1) tel.seeksForward++; }
      ev("seek", { from: round1(from), to: round1(to) }); tel.lastPos = to; tel.lastWall = performance.now(); refresh();
    });
    audio.addEventListener("volumechange", function () { ev(audio.muted || audio.volume === 0 ? "mute" : "unmute", { pos: curPos() }); });
    // Buffering is its own count (stalled_seconds): it never counts as listening time and never as inattention.
    function stallOpen() { if (tel.stallSince == null && tel.playing) tel.stallSince = performance.now(); }
    function stallClose() { if (tel.stallSince != null) { tel.stalledMs += performance.now() - tel.stallSince; tel.stallSince = null; ev("unstalled", { pos: curPos(), stalled_seconds: summary().stalled_seconds }); } }
    audio.addEventListener("waiting", function () { stallOpen(); ev("waiting", { pos: curPos() }); if (tel.playing) status.textContent = (isV ? "Loading the video" : "Loading the sound") + "\u2026 it plays as soon as it can. Waiting never counts against you."; });
    audio.addEventListener("stalled", function () { if (audio.readyState < 3) stallOpen(); ev("stalled", { pos: curPos() }); });
    audio.addEventListener("playing", function () { stallClose(); ev("playing", { pos: curPos() }); status.textContent = "Playing."; });   // the service ends a stall on play/playing
    var lastT = -1;
    audio.addEventListener("timeupdate", function () {
      if (tel.stallSince != null && audio.currentTime > lastT + 0.05 && lastT >= 0) stallClose();   // playing again: the stall is over
      lastT = audio.currentTime;
      if (tel.playing && document.visibilityState === "hidden") track();   // the screen is off: animation frames stop, sound does not
    });
    audio.addEventListener("error", function () {
      track(); stallClose(); tel.playing = false; ev("media_error", { pos: curPos(), code: audio.error ? audio.error.code : 0 });
      status.textContent = "The " + (isV ? "video" : "sound") + " would not play on this phone. You can still answer, or stop: nothing counts against you.";
      pp.replaceChildren(icon(PLAY)); pp.setAttribute("aria-label", "Play");
    });
    audio.addEventListener("loadedmetadata", function () {
      if (isFinite(audio.duration) && audio.duration > 0) { tel.media = audio.duration; clockR.textContent = fmt(tel.media); }
    });

    pp.addEventListener("click", function () { if (audio.paused) audio.play().catch(function (err) { if (err && err.name === "NotAllowedError") status.textContent = "Your phone blocked the sound. Tap play again."; }); else audio.pause(); });
    canvas.addEventListener("click", function (e) {
      var r = canvas.getBoundingClientRect(); if (!tel.media) return;
      audio.currentTime = Math.max(0, Math.min(tel.media - 0.05, ((e.clientX - r.left) / r.width) * tel.media));
    });
    document.addEventListener("keydown", function (e) {
      if (!audio || finished || !document.body.contains(pp) || /^(TEXTAREA|BUTTON|INPUT|SELECT)$/.test(e.target.tagName)) return;
      if (e.code === "Space") { e.preventDefault(); pp.click(); }
    });
    window.addEventListener("resize", draw);

    // Fetch the whole piece once from our own address: progress on a slow phone, and the real waveform drawn from it.
    var mediaPath = S + "/media";
    // Play from a stream at once (a slow phone starts within seconds; any buffering is counted apart as stalled time and
    // never held against anyone). Draw the real waveform from the whole file only when it is small and the connection is
    // not marked slow, so a slow phone never downloads the piece twice.
    audio.src = mediaPath;
    pp.disabled = false;
    status.textContent = "Tap play when you are ready.";
    if (!isV && startOnTake) {
      startOnTake = false;
      if (document.visibilityState === "visible") {   // never start the sound on a page the person has left
        pp.replaceChildren(icon(PAUSE)); pp.setAttribute("aria-label", "Pause"); status.textContent = "Starting the sound\u2026";
        var go = audio.play();
        if (go && go.catch) go.catch(function (err) {
          if (err && err.name === "NotAllowedError") { pp.replaceChildren(icon(PLAY)); pp.setAttribute("aria-label", "Play"); status.textContent = "Tap play to start the sound."; }
          // AbortError: the person paused while it loaded (the pause handler says so); other errors: the media error handler
        });
      }
    }
    var conn = navigator.connection || {};
    var slow = conn.saveData || /(^|-)2g|3g/.test(conn.effectiveType || "");
    var small = Number(x.bytes || 0) > 0 ? Number(x.bytes) <= 3e6 : true;
    if (!isV && small && !slow) {
      // only once playback has what it needs, so the drawing never competes with the sound on a thin connection
      var once = false;
      audio.addEventListener("canplaythrough", function () {
        if (once) return; once = true;
        loadMedia(mediaPath, function () {}).then(function (res) { return decodePeaks(res.buf); }).then(function (p) { peaks = p; draw(); }, function () { draw(); });
      });
    }
    audio.addEventListener("progress", function () {
      if (!audio.paused || !audio.buffered || !audio.buffered.length || !tel.media) return;
      var b = audio.buffered.end(audio.buffered.length - 1);
      if (b < tel.media - 0.5 && audio.currentTime === 0) status.textContent = "Tap play when you are ready. (" + Math.round((b / tel.media) * 100) + "% loaded; it can start now.)";
    });
    draw();
  }

  function loadMedia(path, onPct) {
    onPct = onPct || function () {};
    return fetch(path).then(function (r) {
      if (!r.ok) throw new Error("media " + r.status);
      var type = r.headers.get("Content-Type") || "audio/wav", total = Number(r.headers.get("Content-Length")) || 0;
      if (!r.body || !r.body.getReader) return r.arrayBuffer().then(function (b) { return { buf: b, blob: new Blob([b], { type: type }) }; });
      var reader = r.body.getReader(), parts = [], got = 0, lastPct = -1;
      function pump() {
        return reader.read().then(function (d) {
          if (d.done) {
            var all = new Uint8Array(got), o = 0; parts.forEach(function (p) { all.set(p, o); o += p.length; });
            return { buf: all.buffer, blob: new Blob([all], { type: type }) };
          }
          parts.push(d.value); got += d.value.length;
          if (total) { var pct = Math.min(99, Math.floor((got / total) * 100)); if (pct !== lastPct) { lastPct = pct; onPct(pct); } }
          return pump();
        });
      }
      return pump();
    });
  }
  function decodePeaks(buf) {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return Promise.reject();
    var ac = new AC();
    return new Promise(function (res, rej) { ac.decodeAudioData(buf.slice(0), res, rej); }).then(function (ab) {
      var ch = ab.getChannelData(0), n = 400, step = Math.floor(ch.length / n) || 1, out = [], max = 0;
      for (var i = 0; i < n; i++) { var s = 0; for (var j = i * step; j < (i + 1) * step && j < ch.length; j += 4) s = Math.max(s, Math.abs(ch[j])); out.push(s); max = Math.max(max, s); }
      if (ac.close) ac.close();
      return out.map(function (v) { return max ? 0.12 + 0.88 * (v / max) : 0.18; });
    });
  }

  // ------------------------------------------------------------------ 2b. view, compare, play
  function itemsOf(x) {
    if (Array.isArray(x.items) && x.items.length) return x.items.map(function (it) { return typeof it === "string" ? { media_id: it } : it; });
    if (Array.isArray(x.texts) && x.texts.length) return x.texts.map(function (t) { return typeof t === "string" ? { text: t } : t; });
    var ids = x.media_ids && x.media_ids.length ? x.media_ids : x.media_id ? [x.media_id] : [];
    if (!ids.length && typeof x.text === "string") return [{ text: x.text }];
    return ids.map(function (id) { return { media_id: id }; });
  }
  function mediaUrl(id, many) { return S + "/media" + (many && id ? "/" + encodeURIComponent(id) : ""); }
  function typeOf(ct, it) {
    var k = (it && (it.kind || "")) || "", c = String(ct || (it && it.content_type) || "");
    if (k === "image" || /^image\//.test(c)) return "image";
    if (k === "video" || /^video\//.test(c)) return "video";
    if (k === "audio" || /^audio\//.test(c)) return "audio";
    if (k === "html" || /html/.test(c)) return "html";
    return "image";
  }
  // a timer that counts only while the page is visible and a condition holds
  function stopCmpClocks() { (tel.cmpClocks || []).forEach(function (c) { c.stop(); }); tel.cmpClocks = []; }
  function visibleClock(cond, onChange) {
    var ms = 0, last = performance.now(), was = false;
    function tick() {
      var n = performance.now(), now = document.visibilityState === "visible" && !!cond();
      if (now) ms += Math.min(n - last, 1000); last = n;
      if (onChange && now !== was) { was = now; onChange(now); }   // compare: each piece says when it comes into view and leaves it
    }
    var t = setInterval(tick, 250);
    document.addEventListener("visibilitychange", tick);   // hiding the page ends a span at once, before timers stop
    return { seconds: function () { return round1(ms / 1000); }, stop: function () { clearInterval(t); document.removeEventListener("visibilitychange", tick); if (onChange && was) { was = false; onChange(false); } } };
  }
  function recordBox(title, cells) {
    var rv = {};
    var box = h("div", { class: "record", "aria-label": title }, h("p", { class: "label" }, title),
      cells.map(function (c) { rv[c[0]] = h("b", null, c[2] || "0"); return h("span", { class: "rv" }, rv[c[0]], " " + c[1]); }));
    return { el: box, set: function (k, v) { if (rv[k]) rv[k].textContent = v; } };
  }
  function pictureCard(url, alt, onReveal) {
    var img = h("img", { class: "pic blurred", alt: alt, decoding: "async" });
    var cover = h("button", { class: "reveal", type: "button" }, h("b", null, "Tap to show the picture"), h("span", null, "Pictures start blurred, so you choose when to see them."));
    var greyBtn = h("button", { type: "button", "aria-pressed": "false" }, "Grey");
    var blurBtn = h("button", { type: "button" }, "Blur again");
    var card = { revealed: false, img: img };
    cover.addEventListener("click", function () { img.classList.remove("blurred"); cover.hidden = true; card.revealed = true; if (onReveal) onReveal(); });
    blurBtn.addEventListener("click", function () { img.classList.add("blurred"); cover.hidden = false; card.revealed = false; ev("blur_again", {}); });
    greyBtn.addEventListener("click", function () { var g = img.classList.toggle("grey"); greyBtn.setAttribute("aria-pressed", g ? "true" : "false"); });
    card.el = h("div", { class: "pictool" }, h("div", { class: "picwrap" }, img, cover), h("div", { class: "tools" }, greyBtn, blurBtn));
    loadMedia(url, function () {}).then(function (res) { img.src = URL.createObjectURL(res.blob); }, function () { img.src = url; });
    return card;
  }

  function view() {
    var x = seat.experience, it = itemsOf(x)[0] || {};
    var maxFrac = 0;
    // a text to read (content {text}) is shown at once: reading it is the task; a picture starts blurred
    var isText = typeof it.text === "string" && !it.media_id;
    var card = isText ? (function () { var q = h("blockquote", { class: "cmp-text" }, it.text); return { revealed: true, img: q, el: q }; })()
      : pictureCard(mediaUrl(it.media_id, false), "The picture the asker sent", function () { ev("reveal", {}); say("The picture is showing."); measure(); });
    if (isText && !tel.textRevealSaid) { tel.textRevealSaid = true; ev("reveal", { text: true }); }
    var shownBase = tel.extra.shown_seconds ? tel.extra.shown_seconds() : 0;
    var shown = visibleClock(function () { return card.revealed && document.body.contains(card.el); });
    function measure() {
      if (!card.revealed) return;
      var r = card.img.getBoundingClientRect(); if (!r.height) return;
      var f = Math.max(0, Math.min(1, (window.innerHeight - r.top) / r.height));
      if (f > maxFrac) { var step = Math.floor(f * 10) > Math.floor(maxFrac * 10); maxFrac = round3(f); if (step || f >= 0.999) ev("scroll", { pos: round3(f) }); }
    }
    window.addEventListener("scroll", measure, { passive: true });
    if (tel.seenBase) maxFrac = tel.seenBase;
    tel.extra.shown_seconds = function () { return round1(shownBase + shown.seconds()); };
    tel.extra.seen_fraction = function () { tel.seenBase = maxFrac; return maxFrac; };
    var rec = recordBox("WHAT THE ASKER SEES ABOUT YOUR LOOKING", [["shown", "shown", "0:00"], ["seen", "of it seen", "0%"], ["hidden", "away from this page", "0:00"]]);
    var tick = setInterval(function () { if (!document.body.contains(rec.el)) return clearInterval(tick); measure(); var s = summary(); rec.set("shown", fmt(s.shown_seconds)); rec.set("seen", Math.round(maxFrac * 100) + "%"); rec.set("hidden", fmt(s.hidden_seconds)); }, 500);
    show(h("section", { class: "screen" },
      h("p", { class: "label" }, x.title ? String(x.title).toUpperCase() : "LOOK"),
      h("h1", { class: "lede" }, "“" + (seat.ask || "") + "”"),
      card.el, rec.el,
      h("button", { class: "go you", type: "button", onclick: function () { answerScreen(); } }, "Answer"),
      h("p", { class: "note" }, "Look as long as you like. The asker sees how long the " + (isText ? "text" : "picture") + " was shown and how much of it scrolled into view, not your taps.")), "LOOKING");
  }

  function compare() {
    var x = seat.experience, items = itemsOf(x);
    // the order is set here, at random, and reported (P1): nobody but this page chooses which comes first
    if (!tel.cmpOrder) {
      var order = items.map(function (_, i) { return i; });
      for (var i = order.length - 1; i > 0; i--) { var r = new Uint32Array(1); crypto.getRandomValues(r); var j = r[0] % (i + 1); var t = order[i]; order[i] = order[j]; order[j] = t; }
      tel.cmpOrder = order; tel.cmpBase = {};
    }
    var LET = "ABCDEF";
    // each piece carries its place in the asker's list (content_index): text pieces have no media id
    var shownItems = tel.cmpOrder.map(function (oi, pos) { return { label: LET[pos], index: oi, media_id: items[oi].media_id || null, key: items[oi].media_id || "text:" + oi, it: items[oi], intervals: [], clock: null, el: null, media: null }; });
    // carry each piece's time from an earlier visit to this screen
    if (tel.cmpItemsFn) { tel.cmpItemsFn().forEach(function (x) { tel.cmpBase[x.key] = x.seconds; }); }
    tel.extra.presented_order = shownItems.map(function (s) { return s.media_id; });
    tel.extra.presented_order_index = shownItems.map(function (s) { return s.index; });
    tel.extra.items = tel.cmpItemsFn = function () { return shownItems.map(function (s) { return { label: s.label, media_id: s.media_id, content_index: s.index, key: s.key, seconds: round1((tel.cmpBase[s.key] || 0) + (s.clock ? s.clock.seconds() : 0)) }; }); };
    if (!tel.cmpOrderSaid) { tel.cmpOrderSaid = true; ev("order", { order: tel.extra.presented_order, order_index: tel.extra.presented_order_index }); }
    var active = null;
    var grid = h("div", { class: "cmp" });
    shownItems.forEach(function (sItem) {
      var head = h("p", { class: "cmp-label" }, sItem.label);
      var slot = h("div", { class: "cmp-slot" }, h("p", { class: "note" }, "Loading " + sItem.label + "…"));
      sItem.el = h("div", { class: "cmp-item" }, head, slot);
      grid.appendChild(sItem.el);
      if (typeof sItem.it.text === "string" && !sItem.media_id) {
        var tx = h("blockquote", { class: "cmp-text" }, sItem.it.text);
        slot.replaceChildren(tx);
        sItem.clock = visibleClock(function () { var r = tx.getBoundingClientRect(); return r.height > 0 && r.bottom > 0 && r.top < window.innerHeight; },
          function (inView) { ev(inView ? "in_view" : "out_of_view", { item: sItem.label, content_index: sItem.index, media_id: null }); });
        (tel.cmpClocks = tel.cmpClocks || []).push(sItem.clock);
        return;
      }
      var url = mediaUrl(sItem.media_id, true);
      var known = sItem.it.kind || sItem.it.content_type;
      (known ? Promise.resolve(sItem.it.content_type || "") : fetch(url, { method: "GET", headers: { Range: "bytes=0-0" } }).then(function (r) { return r.headers.get("Content-Type"); }, function () { return ""; })).then(function (ct) {
        var kind = typeOf(ct, sItem.it);
        if (kind === "image") {
          var card = pictureCard(url, "Piece " + sItem.label, function () { ev("reveal", { item: sItem.label, content_index: sItem.index, media_id: sItem.media_id }); });
          sItem.clock = visibleClock(function () { if (!card.revealed) return false; var r = card.img.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; },
            function (inView) { ev(inView ? "in_view" : "out_of_view", { item: sItem.label, content_index: sItem.index, media_id: sItem.media_id }); });
          (tel.cmpClocks = tel.cmpClocks || []).push(sItem.clock);
          slot.replaceChildren(card.el);
        } else {
          var m = kind === "video" ? h("video", { class: "vid blurred", playsinline: true, preload: "metadata" }) : new Audio();
          if (kind === "video") { m.muted = true; slot.replaceChildren(h("div", { class: "picwrap" }, m)); }
          else slot.replaceChildren();
          var btn = h("button", { class: "quiet", type: "button" }, "Play " + sItem.label);
          slot.appendChild(btn);
          m.src = url;
          m._ptPause = function () { btn.textContent = "Play " + sItem.label; ev("pause", { item: sItem.label, content_index: sItem.index, media_id: sItem.media_id, pos: round1(m.currentTime) }); };
          sItem.clock = visibleClock(function () { return !m.paused; });
          (tel.cmpClocks = tel.cmpClocks || []).push(sItem.clock);
          btn.addEventListener("click", function () {
            if (m.paused) { if (active && active !== m && !active.paused) { active.pause(); if (active._ptPause) active._ptPause(); } active = m; audio = m; if (kind === "video") m.classList.remove("blurred"); m.play().catch(function () {}); btn.textContent = "Pause " + sItem.label; ev("play", { item: sItem.label, content_index: sItem.index, media_id: sItem.media_id, pos: round1(m.currentTime) }); }
            else { m.pause(); btn.textContent = "Play " + sItem.label; ev("pause", { item: sItem.label, content_index: sItem.index, media_id: sItem.media_id, pos: round1(m.currentTime) }); }
          });
          m.addEventListener("ended", function () { btn.textContent = "Play " + sItem.label + " again"; ev("ended", { item: sItem.label, content_index: sItem.index, media_id: sItem.media_id, pos: round1(m.currentTime) }); });
          m.addEventListener("timeupdate", function () { if (!m.paused && now() - (sItem.lastTick || 0) > 5000) { sItem.lastTick = now(); ev("tick", { item: sItem.label, content_index: sItem.index, media_id: sItem.media_id, pos: round1(m.currentTime) }); } });
        }
      });
    });
    var rec = recordBox("WHAT THE ASKER SEES", shownItems.map(function (s) { return [s.label, "on " + s.label, "0:00"]; }));
    var tick = setInterval(function () { if (!document.body.contains(rec.el)) return clearInterval(tick); shownItems.forEach(function (s) { rec.set(s.label, fmt(s.clock ? s.clock.seconds() : 0)); }); }, 500);
    show(h("section", { class: "screen" },
      h("p", { class: "label" }, "COMPARE " + shownItems.length),
      h("h1", { class: "lede" }, "“" + (seat.ask || "") + "”"),
      h("p", { class: "note" }, h("strong", null, "The order is random. "), "This page chose which comes first; the asker is told which piece was " + LET.slice(0, shownItems.length).split("").join(", ") + "."),
      grid, rec.el,
      h("button", { class: "go you", type: "button", onclick: function () { if (active) active.pause(); stopCmpClocks(); answerScreen(); } }, "Answer")), "COMPARING");
  }

  function play() {
    var x = seat.experience, it = itemsOf(x)[0] || {};
    // the build loads from its own sealed link (/mx/...), never from an address that carries this seat's token
    var frame = h("iframe", { class: "game", title: "The build the asker sent", sandbox: "allow-scripts", referrerpolicy: "no-referrer", allow: "" });
    fetch(S + "/media_link" + (it.media_id && itemsOf(x).length > 1 ? "?m=" + encodeURIComponent(it.media_id) : ""))
      .then(function (r) { return r.json(); }).then(function (d) { if (d.url) frame.src = d.url + "#ptn=" + nonce; else throw new Error(d.message); })
      .catch(function () { wrap.replaceChildren(h("p", { class: "note", style: "padding:14px" }, "The game did not load. Stop the call (you are not marked down), or try again in a minute.")); });
    var wrap = h("div", { class: "gamewrap" }, frame);
    // our guard script inside the build counts only trusted taps and keys (the build's own code cannot fake them, nor read
    // the nonce: the guard takes it from the address and removes it before the build runs) and reports the count here
    var nonce = Array.from(crypto.getRandomValues(new Uint8Array(12))).map(function (b) { return (b % 36).toString(36); }).join("");
    var gameInputs = tel.gameInputs || 0;
    tel.extra.game_inputs = function () { return gameInputs; };
    window.addEventListener("message", function (e) {
      var d = e.data || {};
      if (e.source !== frame.contentWindow || d.source !== "pt-guard" || d.n !== nonce || typeof d.inputs !== "number") return;
      var add = Math.max(0, Math.min(500, d.inputs) - gameInputs);
      if (add) { gameInputs += add; tel.gameInputs = gameInputs; ev("game_input", { count: add, total: gameInputs }); }
    });
    var playBase = tel.extra.play_seconds ? tel.extra.play_seconds() : 0, gameBase = tel.extra.in_game_seconds ? tel.extra.in_game_seconds() : 0;
    var inGame = visibleClock(function () { return document.body.contains(frame) && document.activeElement === frame; });
    var onScreen = visibleClock(function () { return document.body.contains(frame); });
    tel.extra.play_seconds = function () { return round1(playBase + onScreen.seconds()); };
    tel.extra.in_game_seconds = function () { return round1(gameBase + inGame.seconds()); };
    window.addEventListener("blur", function () { setTimeout(function () { if (document.activeElement === frame) ev("into_game", {}); }, 0); });
    var full = h("button", { class: "quiet", type: "button", onclick: function () { var el = wrap; (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el); } }, "Full screen");
    var rec = recordBox("WHAT THE ASKER SEES ABOUT YOUR PLAYING", [["screen", "on this screen", "0:00"], ["game", "inside the game", "0:00"], ["taps", "taps and keys", "0"], ["hidden", "away from this page", "0:00"]]);
    var tick = setInterval(function () { if (!document.body.contains(rec.el)) return clearInterval(tick); var s = summary(); rec.set("screen", fmt(s.play_seconds)); rec.set("game", fmt(s.in_game_seconds)); rec.set("taps", String(s.game_inputs || 0)); rec.set("hidden", fmt(s.hidden_seconds)); }, 500);
    show(h("section", { class: "screen" },
      h("p", { class: "label" }, x.title ? String(x.title).toUpperCase() : "PLAY"),
      h("h1", { class: "lede" }, "“" + (seat.ask || "") + "”"),
      wrap, full, rec.el,
      h("button", { class: "go you", type: "button", onclick: function () { answerScreen(); } }, "Done: answer"),
      h("p", { class: "note" }, "The game runs in a closed box: it cannot reach this page or your answers, and its ways out to the internet are blocked as far as your browser allows. The asker gets how long you played and how many taps and keys you made, never what they were.")), "PLAYING");
  }

  // ------------------------------------------------------------------ the spoken answer (voice rules, TEAM.md s7)
  // The microphone opens only after the release is signed on this screen, for this call. Never the browser's own speech
  // recognition. The recording goes to our own storage and nowhere else; the asker gets its length now, its words when a
  // transcriber is named ("transcript pending" until then), and the recording itself only if the person says yes.
  var voice = { blob: null, seconds: 0, mime: "", url: null, uploaded: null, share: false, signed: false, note: "" };
  function pickMime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return "";
    var c = ["audio/webm;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/aac", "audio/ogg;codecs=opus", "audio/webm"];
    for (var i = 0; i < c.length; i++) if (MediaRecorder.isTypeSupported(c[i])) return c[i];
    return "";
  }
  function fill(el) { el.replaceChildren.apply(el, [].slice.call(arguments, 1).filter(function (x) { return x != null && x !== false; })); }
  function voiceBlock(onChange) {
    var max = Math.max(5, Math.min(300, Number((seat.voice && seat.voice.max_seconds) || 90)));
    var box = h("div", { class: "voice block" });
    var release = null;
    function draw() {
      if (voice.blob) return drawTake();
      fill(box, h("p", { class: "label" }, "OR SAY IT"),
        h("p", null, "You can speak your answer instead of typing it (up to " + fmt(max) + ")."),
        h("button", { class: "quiet", type: "button", onclick: showRelease }, "Answer by voice"),
        voice.note ? h("p", { class: "note", role: "status" }, voice.note) : null);
    }
    function showRelease() {
      if (voice.signed) return openMic();
      (release ? Promise.resolve(release) : fetch("/recording_release.json").then(function (r) { return r.json(); })).then(function (rel) {
        release = rel;
        fill(box, h("p", { class: "label" }, "BEFORE YOU SPEAK"),
          h("p", { class: "sub" }, rel.title), h("p", null, rel.lede),
          h("ol", { class: "release" }, rel.items.map(function (it) { return h("li", null, h("b", null, it.label + ". "), it.text); })),
          h("button", { class: "go you", type: "button", onclick: function () { sign(rel); } }, rel.accept),
          h("button", { class: "quiet", type: "button", onclick: function () { voice.note = "Fine: type your answer above."; draw(); } }, rel.decline));
        box.querySelector(".sub").setAttribute("tabindex", "-1"); box.querySelector(".sub").focus();
      }, function () { voice.note = "The release did not load, so the microphone stays off. Type your answer above."; draw(); });
    }
    function sign(rel) {
      voice.signed = true; ev("voice_release", { release_id: rel.id });
      api("/voice_release", "POST", { release_id: rel.id, accepted: true });
      openMic();
    }
    var stream = null, rec = null, chunks = [], t0 = 0, timer = null, meterRaf = 0, ac = null;
    if (voice.close) voice.close();   // a recorder from an earlier visit to this screen
    voice.recording = false;
    voice.close = function () {   // every way off this screen ends the recording and lets go of the microphone
      clearInterval(timer); voice.recording = false;
      if (rec && rec.state === "recording") { rec.onstop = null; try { rec.stop(); } catch (e) {} }
      stopStream();
    };
    function openMic() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !pickMime()) {
        voice.note = "This browser cannot record here. Nothing was recorded. Type your answer above."; return draw();
      }
      fill(box, h("p", { class: "label" }, "THE MICROPHONE"), h("p", null, "Your phone asks first. Nothing is recorded until you tap Record."));
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (s) { stream = s; drawRecorder(); }, function (e) {
        ev("mic_refused", { reason: e && e.name });
        voice.note = e && e.name === "NotFoundError" ? "This phone has no microphone the page can use. Nothing was recorded. Type your answer above."
          : "The microphone is off for this page, so nothing was recorded. Type your answer above, or allow the microphone in your browser's settings and try again.";
        draw();
      });
    }
    function stopStream() { if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; } if (ac && ac.close) ac.close(); ac = null; cancelAnimationFrame(meterRaf); }
    function drawRecorder() {
      var clock = h("span", { class: "vclock" }, "0:00 / " + fmt(max));
      var meter = h("span", { class: "vmeter" }, h("i"));
      var btn = h("button", { class: "vrec", type: "button" }, h("span", { class: "dot" }), " Record");
      var cancel = h("button", { class: "quiet", type: "button", onclick: function () { stopStream(); voice.note = ""; draw(); } }, "Don’t record");
      fill(box, h("p", { class: "label" }, "SAY YOUR ANSWER"), h("div", { class: "vrow" }, btn, clock), meter, cancel,
        h("p", { class: "note" }, "Recording starts when you tap Record and ends when you tap Stop recording, or at " + fmt(max) + "."));
      try {
        var AC = window.AudioContext || window.webkitAudioContext; ac = new AC();
        var src = ac.createMediaStreamSource(stream), an = ac.createAnalyser(); an.fftSize = 512; src.connect(an);
        var buf = new Uint8Array(an.fftSize);
        (function lvl() { an.getByteTimeDomainData(buf); var m = 0; for (var i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i] - 128)); meter.firstChild.style.width = Math.min(100, m * 1.6) + "%"; meterRaf = requestAnimationFrame(lvl); })();
      } catch (e) {}
      btn.addEventListener("click", function () {
        if (rec && rec.state === "recording") return finish("stopped");
        chunks = []; var mime = pickMime();
        try { rec = new MediaRecorder(stream, { mimeType: mime }); } catch (e) { rec = new MediaRecorder(stream); }
        voice.mime = rec.mimeType || mime;
        rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = function () {
          voice.recording = false;
          voice.blob = new Blob(chunks, { type: voice.mime.split(";")[0] || "audio/webm" });
          voice.seconds = round1((performance.now() - t0) / 1000);
          voice.url = URL.createObjectURL(voice.blob); voice.uploaded = null;
          stopStream(); ev("voice_recorded", { seconds: voice.seconds, bytes: voice.blob.size, format: voice.mime.split(";")[0] });
          onChange(); draw();
        };
        rec.start(1000); t0 = performance.now(); voice.recording = true; ev("voice_start", {}); onChange();
        btn.replaceChildren(h("span", { class: "dot on" }), " Stop recording"); btn.classList.add("on"); cancel.hidden = true;
        timer = setInterval(function () { var sec = (performance.now() - t0) / 1000; clock.textContent = fmt(sec) + " / " + fmt(max); if (sec >= max) finish("max"); }, 250);
        stream.getTracks().forEach(function (t) { t.addEventListener("ended", function () { finish("interrupted"); }); });
      });
    }
    function finish(why) {
      clearInterval(timer);
      if (rec && rec.state === "recording") { rec.stop(); }
      if (why === "interrupted" || why === "hidden") voice.note = "Recording stopped when " + (why === "hidden" ? "the page was hidden" : "the phone took the microphone") + ". What you said up to then is kept; record again if you like.";
      else if (why === "max") voice.note = "That is the most this call takes: " + fmt(max) + ".";
      else voice.note = "";
    }
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden" && rec && rec.state === "recording") finish("hidden"); });
    function drawTake() {
      var player = h("audio", { controls: true, src: voice.url, preload: "metadata" });
      var share = h("button", { type: "button", class: "toggle", "aria-pressed": voice.share ? "true" : "false", onclick: function () { voice.share = !voice.share; voice.uploaded = null; onChange(); draw(); } },
        voice.share ? "Yes: the asker may hear the recording" : "No: the asker gets only the words");
      fill(box, h("p", { class: "label" }, "YOUR SPOKEN ANSWER · " + fmt(voice.seconds)), player,
        h("div", { class: "row" }, h("button", { class: "quiet", type: "button", onclick: function () { voice.blob = null; voice.uploaded = null; voice.note = ""; onChange(); openMic(); } }, "Record again"),
          h("button", { class: "quiet", type: "button", onclick: function () { voice.blob = null; voice.uploaded = null; voice.note = "Deleted from this phone. Nothing was sent."; ev("voice_deleted", {}); onChange(); draw(); } }, "Delete it")),
        h("p", { class: "flabel" }, "May the asker hear the recording itself?"), share,
        h("p", { class: "note" }, "Either way it is kept in our storage only, and deleted 90 days after the call closes, or sooner if you ask."),
        voice.note ? h("p", { class: "note", role: "status" }, voice.note) : null);
    }
    draw();
    return box;
  }
  function uploadVoice() {
    if (!voice.blob || voice.uploaded) return Promise.resolve(true);
    return fetch(S + "/recording", { method: "POST", headers: { "Content-Type": voice.blob.type || "audio/webm", "X-Voice-Seconds": String(voice.seconds), "X-Share-Recording": voice.share ? "yes" : "no" }, body: voice.blob })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.message || ("status " + r.status)); voice.uploaded = d; ev("voice_uploaded", { seconds: voice.seconds }); return true; }); });
  }

  // ------------------------------------------------------------------ 3. the answer
  var answers = {}, inputs = {};
  function answerScreen() {
    var fields = seat.fields || {}, keys = Object.keys(fields);
    if (!keys.length) { fields = { answer: { type: "text" } }; keys = ["answer"]; }
    var gets = h("div", { class: "gets", "aria-live": "polite" });
    var send = h("button", { class: "go you", type: "button", disabled: true, onclick: doSend }, "Send my answer");
    var form = keys.map(function (k) {
      var f = fields[k] || {}, id = "f-" + k.replace(/[^a-z0-9_-]/gi, "");
      var label = f.label || f.question || humanKey(k);
      inputs[k] = inputs[k] || { typed: 0, pasted: 0, how: null, lastEv: 0 };
      if (f.type === "boolean") {
        var yes = h("button", { type: "button", "aria-pressed": answers[k] === true ? "true" : "false" }, "Yes");
        var no = h("button", { type: "button", "aria-pressed": answers[k] === false ? "true" : "false" }, "No");
        function pick(v) { answers[k] = v; inputs[k].how = "tapped"; yes.setAttribute("aria-pressed", v ? "true" : "false"); no.setAttribute("aria-pressed", v ? "false" : "true"); ev("input", { field: k, chars: 0 }); update(); }
        yes.addEventListener("click", function () { pick(true); }); no.addEventListener("click", function () { pick(false); });
        return h("div", { class: "field", role: "group", "aria-labelledby": id }, h("span", { class: "flabel", id: id }, label), h("div", { class: "yn" }, yes, no));
      }
      if (f.type === "choice" || f.type === "scale") {
        var opts = f.type === "choice" ? [].concat(f.choices || f.options || [])
          : (function () { var lo = Number(f.min != null ? f.min : 1), hi = Number(f.max != null ? f.max : 5), o = []; for (var q = lo; q <= hi && o.length < 11; q++) o.push(q); return o; })();
        var multi = f.type === "choice" && !!f.multiple;
        var isOn = function (o) { return multi ? (Array.isArray(answers[k]) && answers[k].indexOf(o) >= 0) : answers[k] === o; };
        var btns = opts.map(function (o) {
          return h("button", { type: "button", "aria-pressed": isOn(o) ? "true" : "false", onclick: function () {
            if (multi) { var cur = Array.isArray(answers[k]) ? answers[k].slice() : []; var i = cur.indexOf(o); if (i >= 0) cur.splice(i, 1); else cur.push(o); answers[k] = cur.length ? cur : undefined; }
            else answers[k] = o;
            inputs[k].how = "tapped";
            btns.forEach(function (b, j) { var v = opts[j]; b.setAttribute("aria-pressed", (multi ? (Array.isArray(answers[k]) && answers[k].indexOf(v) >= 0) : answers[k] === v) ? "true" : "false"); });
            ev("input", { field: k, chars: 0 }); update();
          } }, String(o));
        });
        var ends = f.type === "scale" && (f.min_label || f.max_label) ? h("div", { class: "scale-ends" }, h("span", null, f.min_label || ""), h("span", null, f.max_label || "")) : null;
        return h("div", { class: "field", role: "group", "aria-labelledby": id }, h("span", { class: "flabel", id: id }, label),
          multi ? h("p", { class: "how" }, "Choose any that apply.") : null,
          h("div", { class: f.type === "scale" ? "scale" : "choices" }, btns), ends);
      }
      if (f.type === "number") {
        var num = h("input", { id: id, type: "number", inputmode: "decimal", class: "numin", min: f.min != null ? String(f.min) : null, max: f.max != null ? String(f.max) : null });
        if (typeof answers[k] === "number") num.value = String(answers[k]);
        num.addEventListener("input", function () { var v = num.value === "" ? undefined : Number(num.value); answers[k] = isFinite(v) ? v : undefined; inputs[k].how = "typed"; update(); });
        return h("div", { class: "field" }, h("label", { for: id }, label), num);
      }
      var how = h("p", { class: "how", id: id + "-how" });
      var ta = h("textarea", { id: id, name: k, rows: "5", "aria-describedby": id + "-hint " + id + "-how", autocomplete: "off", spellcheck: "true" });
      if (typeof answers[k] === "string") ta.value = answers[k];
      ta.addEventListener("paste", function (e) {
        var t = (e.clipboardData && e.clipboardData.getData("text")) || "";
        inputs[k].pasted += t.length; ev("paste", { field: k, chars: t.length });
      });
      ta.addEventListener("input", function (e) {
        var it = e.inputType || "";
        if (it.indexOf("insert") === 0 && it !== "insertFromPaste" && it !== "insertFromDrop") inputs[k].typed += (e.data || "").length || 1;
        if (it === "insertFromDrop") inputs[k].pasted += (e.data || "").length;
        answers[k] = ta.value;
        var I = inputs[k];
        I.how = I.pasted && I.typed ? "mixed" : I.pasted ? "pasted" : "typed";
        how.textContent = I.pasted ? "Pasted text is marked as pasted for the asker." : "";
        how.className = "how" + (I.pasted ? " pasted" : "");
        if (now() - I.lastEv > 10000) { I.lastEv = now(); ev("input", { field: k, chars: ta.value.length }); }
        update();
      });
      return h("div", { class: "field" }, h("label", { for: id }, label), h("p", { class: "how", id: id + "-hint" }, "In your own words."), ta, how);
    });
    function update() {
      var any = (keys.some(function (k) { return answers[k] !== undefined && answers[k] !== ""; }) || !!voice.blob) && !voice.recording;
      send.disabled = !any;
      gets.replaceChildren(h("p", { class: "label" }, "WHAT THE ASKER RECEIVES"), describeGets(keys, fields));
    }
    var x = seat.experience || {};
    var sm = summary(), short = (x.kind === "listen" || x.kind === "watch") && sm.media_seconds > 0 && sm.played_seconds < 0.9 * sm.media_seconds;
    var scr = h("section", { class: "screen" },
      h("p", { class: "label" }, "YOUR ANSWER"),
      short ? h("p", { class: "note" }, "You heard " + fmt(sm.played_seconds) + " of " + fmt(sm.media_seconds) + ". You can answer now, or go back and finish it first. Either way your answer is sent and paid the same; the asker sees how much you heard.") : null,
      h("h1", { class: "lede" }, "“" + (seat.ask || "") + "”"),
      (x.kind === "answer" || !x.kind) && typeof (itemsOf(x)[0] || {}).text === "string" ? h("blockquote", { class: "cmp-text" }, itemsOf(x)[0].text) : null,
      x.kind && x.kind !== "answer" ? h("button", { class: "quiet", type: "button", onclick: function () { again(); } }, ({ listen: "Listen again", watch: "Watch again", view: "Look again", compare: "Back to the pieces", play: "Play again" })[x.kind] || "Back") : null,
      form, seat.voice ? voiceBlock(function () { update(); }) : null, gets, send,
      h("p", { class: "note" }, "Answer in your own words. Pasting is allowed; the asker is told it was pasted."));
    show(scr, "YOUR TURN");
    update();
  }
  function again() { if (voice.close) voice.close(); var saved = audio; audio = null; if (saved) saved.pause(); experience(); }

  function describeGets(keys, fields) {
    var dl = h("dl");
    keys.forEach(function (k) {
      var v = answers[k], I = inputs[k] || {};
      var text;
      if (v === undefined || v === "") text = "no answer";
      else if (typeof v === "boolean") text = v ? "Yes" : "No";
      else if (Array.isArray(v)) text = v.join(", ");
      else if (typeof v === "number") text = String(v);
      else if (I.how === "tapped") text = String(v);
      else { var t2 = v.trim(); text = "\u201C" + (t2.length > 160 ? t2.slice(0, 157) + "\u2026" : t2) + "\u201D (" + (I.how || "typed") + ")"; }
      dl.appendChild(h("dt", null, humanKey(k))); dl.appendChild(h("dd", null, text));
    });
    var kk = (seat.experience || {}).kind;
    if (kk === "view" || kk === "compare" || kk === "play") {
      var sv = summary();
      dl.appendChild(h("dt", null, kk === "play" ? "Playing" : "Looking"));
      dl.appendChild(h("dd", null, kk === "play" ? "on the game screen " + fmt(sv.play_seconds || 0) + "; inside the game " + fmt(sv.in_game_seconds || 0) + "; away from the page " + fmt(sv.hidden_seconds)
        : kk === "view" ? "shown " + fmt(sv.shown_seconds || 0) + "; " + Math.round((sv.seen_fraction || 0) * 100) + "% of the " + ((itemsOf(seat.experience || {})[0] || {}).text != null && !(itemsOf(seat.experience || {})[0] || {}).media_id ? "text" : "picture") + " seen; hidden " + fmt(sv.hidden_seconds)
        : (sv.items || []).map(function (it) { return it.label + " " + fmt(it.seconds); }).join(", ") + " (in an order set at random)"));
    }
    if (kk === "listen" || kk === "watch") {
      var s = summary();
      dl.appendChild(h("dt", null, kk === "watch" ? "Watching" : "Listening"));
      dl.appendChild(h("dd", null, (kk === "watch" ? "played " : "heard ") + fmt(s.played_seconds) + " of " + fmt(s.media_seconds) + "; " + s.pauses + " pause" + (s.pauses === 1 ? "" : "s") + "; " + s.replays + " replay" + (s.replays === 1 ? "" : "s") + "; away from the page " + fmt(s.hidden_seconds)));
    }
    if (voice.blob) {
      dl.appendChild(h("dt", null, "Spoken"));
      dl.appendChild(h("dd", null, fmt(voice.seconds) + " spoken answer. Now: its length (the words follow when they are written; until then \u201Ctranscript pending\u201D). The recording itself: " + (voice.share ? "yes, you allowed it." : "no.")));
    }
    var pm = seat.panel && Number(seat.panel.members);
    dl.appendChild(h("dt", null, "Not sent"));
    dl.appendChild(h("dd", null, "your name, or anything that says who you are, to the asker. The page notes only whether each answer was typed or pasted and how long it is, never which keys you pressed or where you tapped." +
      (pm && pm < 5 ? " But this panel has " + pm + " member" + (pm === 1 ? "" : "s") + ", so whoever runs the panel can tell this answer is yours." : "")));
    return dl;
  }
  function payload() {
    var ai = {};
    Object.keys(answers).forEach(function (k) {
      var I = inputs[k] || {};
      ai[k] = typeof answers[k] !== "string" || I.how === "tapped" ? { how: I.how || "tapped" } : { how: I.how || "typed", typed_chars: I.typed || 0, pasted_chars: I.pasted || 0 };
    });
    var a = {}; Object.keys(answers).forEach(function (k) { if (answers[k] !== "" && answers[k] !== undefined) a[k] = answers[k]; });
    var out = { answers: a, answer_input: ai };
    if (voice.blob) { out.voice_seconds = voice.seconds; out.voice = { seconds: voice.seconds, format: (voice.mime || "").split(";")[0], recording_id: voice.uploaded && voice.uploaded.recording_id || null, share_recording: !!voice.share, transcript: "pending" }; out.answer_input.voice = { how: "spoken", voice_seconds: voice.seconds }; }
    if (tel.extra.presented_order) out.presented_order = tel.extra.presented_order;  // compare: the order this page chose, A first
    out.summary = summary();
    return out;
  }

  function doSend(e) {
    if (finished || stopping) return;
    var btn = e.currentTarget; btn.disabled = true; btn.textContent = "Sending…";
    stopBtn.hidden = true; closeStop();
    ev("send", {});
    flushNow().then(uploadVoice).then(function () { return api("/response", "POST", payload()); }, function (e) {
      btn.disabled = false; btn.textContent = "Send my answer"; stopBtn.hidden = false;
      var cur = main.querySelector(".screen");
      var box = h("div", { class: "block err", role: "alert" }, h("p", { class: "label" }, "YOUR RECORDING DID NOT UPLOAD"),
        h("p", null, "It is still on this phone; nothing was sent. (" + (e && e.message ? e.message : "no connection") + ")"),
        h("button", { class: "quiet", type: "button", onclick: function () { box.remove(); btn.click(); } }, "Try again"),
        h("button", { class: "quiet", type: "button", onclick: function () {
          voice.blob = null; voice.uploaded = null; box.remove();
          var typed = Object.keys(answers).some(function (k) { return answers[k] !== undefined && answers[k] !== ""; });
          if (typed) btn.click(); else { voice.note = "The recording was not sent, and nothing else was. Type your answer, then send."; answerScreen(); }
        } }, "Send without the recording"));
      if (cur) cur.insertBefore(box, cur.firstChild); window.scrollTo(0, 0);
      return null;
    }).then(function (r) {
      if (r === null) return;
      if (!r.ok) { btn.disabled = false; btn.textContent = "Send my answer"; stopBtn.hidden = false; return problem(r, r.status ? "Not sent yet" : "No connection: not sent yet"); }
      arrived(r.data || {});
    });
  }

  // ------------------------------------------------------------------ 4. the end
  function stampNow() {
    try { return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" }); }
    catch (e) { return new Date().toLocaleTimeString(); }
  }
  // the time the person gave, from taking the seat to now, by this phone's clock (the service keeps its own count)
  function yourTime() { var sec = takeT == null ? 0 : (now() - takeT) / 1000; return fmt(sec) + (sec >= 60 ? " (" + Math.round(sec / 60) + " min)" : ""); }
  function payLine(d) {
    if (d.unpaid_test || isUnpaid(seat.pay)) return "Unpaid test: nothing is paid for this call.";
    return money(d.paid_usd != null ? d.paid_usd : seat.pay.per_person_usd) + " to you for this call.";
  }
  // a person an outside panel sent goes back there to be paid: only to that panel's own addresses (never an open redirect)
  // a seat an outside panel's person was given (the arrival page marks it in this tab)
  function fromPool() { try { return sessionStorage.getItem("pt_pool_seat") === decodeURIComponent((location.pathname.split("/c/")[1] || "").split("/")[0]); } catch (e) { return false; } }
  function returnButton(url) {
    if (typeof url !== "string" || !/^https:\/\/([a-z0-9-]+\.)*prolific\.(com|co)\//i.test(url)) return null;
    return h("a", { class: "go linkbtn", href: url, rel: "noopener noreferrer" }, "Back to Prolific to be paid");
  }
  function arrived(d) {
    finished = true; taken = false; clearInterval(tel.timer); stopBtn.hidden = true; closeStop(); if (voice.close) voice.close();
    // P8, the moment nobody expects: while this screen is open, watch for the asker's line about what the answers changed
    var changedBox = h("div", { class: "block", "aria-live": "polite" },
      h("p", { class: "label" }, "WHAT THE ANSWERS CHANGED"),
      h("p", null, "When the asker tells us what it did with the answers, that line appears here and on your page."));
    var tries = 0;
    (function watchForLine() {
      if (tries++ > 30 || !document.body.contains(changedBox) && tries > 1) return;
      if (document.visibilityState !== "visible") return setTimeout(watchForLine, 6000);
      api("/receipt", "GET").then(function (r) {
        var rm = r.ok && r.data && r.data.receipt && Number(r.data.receipt.minutes);
        if (rm > 0) timeCell.textContent = fmt(rm * 60) + ", as on your receipt";   // one clock on both screens
        var oc = r.ok && r.data && r.data.outcomes;
        if (oc && oc.length) {
          var o = oc[oc.length - 1], line = typeof o === "string" ? o : o.text;
          var at = o && o.at ? new Date(o.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
          var n = o && Number(o.people || o.answered || 0);
          try { sessionStorage.setItem("pt_receipt_" + (r.data.receipt_id || d.receipt_id), JSON.stringify(r.data)); } catch (e) {}
          changedBox.replaceChildren(h("p", { class: "label" }, "WHAT THE ANSWERS CHANGED"), h("p", { class: "ask" }, "\u201C" + line + "\u201D"),
            h("p", { class: "note" }, "Written by the AI that asked and sent" + (at ? " at " + at : "") + ", after your answer arrived, to " +
              (n > 1 ? "the " + n + " people who answered, you among them." : n === 1 ? "you, the one person who answered." : "everyone who answered, you among them.")));
          changedBox.classList.add("changed-now");
          say("The asker says what the answers changed: " + line);
          notifyParent({ type: "changed", line: line });
          return;
        }
        setTimeout(watchForLine, 6000);
      });
    })();
    var timeCell = h("span", null, yourTime() + ", by this phone");
    var rows = [["Arrived", stampNow()], ["Your time", timeCell], ["Pay", payLine(d)]];
    var ids = [["Call", seat.call_id || "-"], ["Receipt", d.receipt_id || "being made"]];
    // a copy of their own words, saved on this phone only (receipts carry no answer words, by design)
    function keepCopy() {
      var a = payload().answers, lines = ["The ask: " + (seat.ask || ""), "Answered: " + new Date().toString(), ""];
      Object.keys(a).forEach(function (k) { var f = (seat.fields || {})[k] || {}; lines.push((f.label || humanKey(k)) + ": " + (Array.isArray(a[k]) ? a[k].join(", ") : String(a[k]))); });
      if (voice.blob) lines.push("Spoken answer: " + fmt(voice.seconds));
      var blob = new Blob([lines.join("\n") + "\n"], { type: "text/plain" });
      var el = h("a", { href: URL.createObjectURL(blob), download: "my-answer.txt" }); document.body.appendChild(el); el.click(); el.remove();
    }
    show(h("section", { class: "screen" },
      h("h1", { class: "big ok" }, "Arrived."),
      h("p", { class: "lede" }, "Your answer reached the asker. Thank you for your time."),
      returnButton(d.return_to),
      h("div", { class: "receipt", role: "group", "aria-label": "Your receipt" }, rows.map(function (r) { return [h("span", null, r[0]), typeof r[1] === "object" ? r[1] : h("span", null, r[1])]; })),
      changedBox,
      (function () {   // what they sent, in their own words, on this phone only: the last thing they see is their own answer
        var a = payload().answers, rows2 = [];
        Object.keys(a).forEach(function (k) {
          var f = (seat.fields || {})[k] || {}, v = a[k];
          var shown = typeof v === "boolean" ? (v ? "Yes" : "No") : Array.isArray(v) ? v.join(", ") : String(v);
          if (shown !== "") rows2.push(h("div", { class: "sent-row" }, h("p", { class: "label" }, (f.label || humanKey(k)).toUpperCase()), h("p", { class: typeof v === "string" && v.length > 3 ? "sent-words" : null }, typeof v === "string" && v.length > 3 ? "\u201C" + v + "\u201D" : shown)));
        });
        if (voice.blob) rows2.push(h("p", { class: "note" }, "And a spoken answer, " + fmt(voice.seconds) + " long."));
        return rows2.length ? h("div", { class: "block sent" }, h("p", { class: "label" }, "WHAT YOU SENT"), rows2, h("p", { class: "note" }, d.standin ? "Shown on this phone only. Nobody received it: this was a rehearsal." :
          "Shown on this phone only. The asker has it, without anything that says who you are." + ((seat.panel && Number(seat.panel.members) < 5) ? " This panel has " + Number(seat.panel.members) + " member" + (Number(seat.panel.members) === 1 ? "" : "s") + ", so whoever runs the panel can tell it is yours." : ""))) : null;
      })(),
      h("button", { class: "quiet", type: "button", onclick: keepCopy }, "Keep a copy of what you said"),
      d.receipt_id && /^rc_/.test(d.receipt_id) ? h("a", { class: "quiet linkbtn", href: "/r/" + encodeURIComponent(d.receipt_id), onclick: function (e) {
        // the person's own receipt comes by this seat (no key); handed to the receipt page on this phone only
        var a = e.currentTarget; e.preventDefault();
        api("/receipt", "GET").then(function (r) { if (r.ok && r.data) { try { sessionStorage.setItem("pt_receipt_" + d.receipt_id, JSON.stringify(r.data)); } catch (x) {} } location.href = a.href; });
      } }, "Open your receipt") : null,
      h("details", { class: "tech" }, h("summary", null, "Reference numbers, if you ever ask about this call"), h("div", { class: "receipt" }, ids.map(function (r) { return [h("span", null, r[0]), h("span", null, r[1])]; }))),
      d.standin ? h("p", { class: "note" }, /^standin-(front|people)/.test(token) ? "This was a rehearsal on this page. No asker received your answer." : "This was a stand-in call used to build the page. No asker received it.") : null,
      h("p", { class: "note" }, "You can close this page.")), "DONE");
    say("Your answer arrived. Thank you.");
    var pl = payload(); notifyParent({ type: "arrived", record: { answers: pl.answers, answer_input: pl.answer_input, summary: summary(), receipt_id: d.receipt_id || null } });
  }

  // ------------------------------------------------------------------ stopping, from any screen
  var dlg = null;
  stopBtn.addEventListener("click", openStop);
  function hasWritten() { return Object.keys(answers).some(function (k) { return answers[k] !== undefined && answers[k] !== ""; }); }
  function openStop() {
    if (!taken || finished || dlg || stopping) return;
    if (audio && !audio.paused) audio.pause();
    dlg = h("dialog", { "aria-labelledby": "stop-title" });
    function choose(reason) {
      if (hasWritten()) return askPartial(reason);
      doStop(reason, false);
    }
    dlg.appendChild(h("div", { class: "sheet" },
      h("h2", { id: "stop-title" }, "Stop or report this call?"),
      h("button", { class: "choice", type: "button", onclick: function () { choose("stop"); } }, h("b", null, "Stop"), h("span", null, isUnpaid(seat.pay) ? "Nothing counts against you." : "You are paid for the time so far. Nothing counts against you.")),
      h("button", { class: "choice upset", type: "button", onclick: function () { choose("upset"); } }, h("b", null, "Stop: this upset me"), h("span", null, "Report this call: " + (isUnpaid(seat.pay) ? "" : "you are paid in full, and ") + "it is paused for everyone until the operator reviews it.")),
      h("button", { class: "quiet", type: "button", onclick: closeStop }, "Keep going")));
    document.body.appendChild(dlg);
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); closeStop(); });
    if (dlg.showModal) dlg.showModal(); else { dlg.setAttribute("open", ""); dlg.className += " fallback-sheet"; }
  }
  function closeStop() { if (dlg) { if (dlg.close) dlg.close(); dlg.remove(); dlg = null; } }
  function askPartial(reason) {
    var sheet = dlg.querySelector(".sheet");
    sheet.replaceChildren(
      h("h2", { id: "stop-title" }, "Send what you wrote?"),
      h("p", null, "You started an answer. The asker gets it only if you say so."),
      h("button", { class: "choice", type: "button", onclick: function () { doStop(reason, true); } }, h("b", null, "Send what I wrote"), h("span", null, "It is marked as a partial answer.")),
      h("button", { class: "choice", type: "button", onclick: function () { doStop(reason, false); } }, h("b", null, "Don’t send it"), h("span", null, "The asker gets nothing from you.")));
    sheet.querySelector("button").focus();
  }
  var stopping = false;
  function doStop(reason, sendPartial) {
    if (finished || stopping) return;
    stopping = true;
    if (dlg) [].forEach.call(dlg.querySelectorAll("button"), function (b) { b.disabled = true; });
    if (voice.close) voice.close();
    ev("stop", { reason: reason });
    var body = { reason: reason, send_partial: !!sendPartial };
    if (sendPartial) { var p = payload(); body.answers = p.answers; body.answer_input = p.answer_input; }
    if (audio) audio.pause();
    stopCmpClocks();
    flushNow().then(function () { return api("/stop", "POST", body); }).then(function (r) {
      stopping = false;
      if (!r.ok && r.status !== 409 && r.status !== 410) {   // not stopped yet: say so, and offer to try again
        var sheet = dlg && dlg.querySelector(".sheet");
        if (sheet) {
          sheet.replaceChildren(h("h2", { id: "stop-title" }, "Not stopped yet"),
            h("p", null, "The call service did not answer. Nothing is lost; try again in a moment."),
            h("button", { class: "choice", type: "button", onclick: function () { doStop(reason, sendPartial); } }, h("b", null, "Try again"), h("span", null, "Send the stop again.")),
            h("button", { class: "quiet", type: "button", onclick: closeStop }, "Back to the call"));
        }
        return;
      }
      closeStop();
      finished = true; taken = false; clearInterval(tel.timer); stopBtn.hidden = true;
      var d = r.data || {};
      var unpaid = d.unpaid_test || isUnpaid(seat.pay);
      show(h("section", { class: "screen" },
        h("h1", { class: "big" }, "Stopped."),
        h("p", { class: "lede" }, reason === "upset" ? "Thank you for telling us. The call is reported and paused for everyone until the operator reviews it." : "Nothing counts against you."),
        h("div", { class: "receipt", role: "group", "aria-label": "What happens now" },
          h("span", null, "Your time"), h("span", null, yourTime()),
          h("span", null, "Pay"), h("span", null, unpaid ? "Unpaid test: nothing is paid." : money(d.paid_usd || "0") + (reason === "upset" ? ", in full" : ", for your time")),
          h("span", null, "Your answer"), h("span", null, sendPartial ? "sent, marked partial" : "not sent")),
        returnButton(d.return_to),
        h("p", { class: "note" }, d.return_to ? "Go back to the panel's site so your time is counted there."
          : fromPool() ? "Go back to the panel's site and return the study there: you stopped before answering, so there is no completion code. Nothing is marked against you."
          : "You can close this page.")), "STOPPED");
      say("Stopped.");
      notifyParent({ type: "stopped", record: { reason: reason, send_partial: !!sendPartial, summary: summary() } });
    });
  }

  // ------------------------------------------------------------------ start
  if (!token) { show(h("section", { class: "screen" }, h("p", { class: "big" }, "No call here."), h("p", { class: "lede" }, "This link is missing its call. Open the link you were sent again.")), "NO CALL"); return; }
  api("", "GET").then(function (r) {
    if (r.status === 410) return gone("This offer has ended.", "The call no longer needs an answer. Nothing counts against you.");
    if (r.status === 409) return gone("This call is full.", "Every answer it needed has arrived. Nothing counts against you.");
    if (!r.ok) {
      return show(h("section", { class: "screen" }, h("p", { class: "big" }, r.status === 404 ? "No call here." : "Not loaded."),
        h("p", { class: "lede" }, r.status === 404 ? "This link does not match a call: it may have been mistyped, or the call was withdrawn. Nothing counts against you." : ((r.data && r.data.message) || "The call service did not answer.")),
        r.status === 404 ? null : h("button", { class: "go", type: "button", onclick: function () { location.reload(); } }, "Try again")), "A CALL FOR YOU");
    }
    seat = r.data;
    // a person an outside panel just sent (#arrived, from /p/) has a seat taken for them: they still see the card first (P1)
    var justArrived = location.hash === "#arrived"; arrivedFresh = justArrived;
    if (justArrived) { try { history.replaceState(null, "", location.pathname); } catch (e) {} }
    if (seat.status === "taken" && !justArrived) { taken = true; stopBtn.hidden = false; takeT = now(); ev("resume", {}); startPulse(); return experience(); }
    if (seat.status === "declined") return gone("You said no to this call.", "Nothing counts against you.");
    if (seat.status === "missed") return gone("This offer has ended.", "It was held for you for a while and then went to someone else. Nothing counts against you.");
    if (seat.status === "closed" || seat.status === "withdrawn") return gone("This call has closed.", "It no longer needs answers. Nothing counts against you.");
    if (seat.status === "held" || seat.status === "paused") return gone("This call is paused.", "Someone reported it, and nobody is being asked until the operator reviews it. Nothing counts against you.");
    if (seat.status === "answered") return gone("Already answered.", "Your answer to this call has arrived. Thank you.");
    if (seat.status === "stopped") return gone("This call was stopped.", "Nothing counts against you.");
    if (seat.status === "expired") return gone("This offer has ended.", "The call no longer needs an answer. Nothing counts against you.");
    if (seat.status === "full") return gone("This call is full.", "Every answer it needed has arrived. Nothing counts against you.");
    ringCard();
  });
})();
