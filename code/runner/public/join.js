/* the person\'s side: join a panel by its link, in under a minute. The tester notice verbatim (legal/tester_notice.json, trust),
   one statement that you are an adult, your quiet hours; nothing else is asked. You start Off. */
(function () {
  "use strict";
  var code = decodeURIComponent((location.pathname.split("/")[2] || "").trim());
  var main = document.getElementById("main"), live = document.getElementById("live");
  // replaceChildren(null) prints "null": drop empty arguments first
  function fill(el) { var a = []; for (var i = 1; i < arguments.length; i++) if (arguments[i] != null && arguments[i] !== false) a.push(arguments[i]);
    if (el.replaceChildren) el.replaceChildren.apply(el, a);
    else { while (el.firstChild) el.removeChild(el.firstChild); a.forEach(function (x) { el.appendChild(typeof x === "object" ? x : document.createTextNode(String(x))); }); }
    return el; }
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) { var v = attrs[k]; if (v == null || v === false) continue;
      if (k === "class") el.className = v; else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v); else if (k === "selected") el.selected = !!v; else el.setAttribute(k, v === true ? "" : v); }
    for (var i = 2; i < arguments.length; i++) { var c = arguments[i]; if (c == null || c === false) continue;
      (function put(x) { if (x == null || x === false) return; if (Array.isArray(x)) return x.forEach(put); el.appendChild(typeof x === "object" ? x : document.createTextNode(String(x))); })(c); }
    return el;
  }
  var tz = "America/Chicago";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch (e) {}
  function hourName(n) { var d = new Date(2026, 0, 1, n, 0); return d.toLocaleTimeString([], { hour: "numeric" }); }
  function hourSelect(id, val) {
    var s = h("select", { id: id, class: "hsel", "aria-label": id === "q-start" ? "Quiet hours start" : "Quiet hours end" });
    for (var i = 0; i < 24; i++) s.appendChild(h("option", { value: String(i), selected: i === val }, hourName(i)));
    return s;
  }
  function post(path, body) {
    return fetch("/x/" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); }, function () { return { ok: false, status: 0, d: {} }; });
  }

  function render(notice, panel) {
    var qs = hourSelect("q-start", 21), qe = hourSelect("q-end", 8);
    var err = h("div", { role: "alert" });
    var accept = h("button", { class: "go you", type: "button", onclick: doJoin }, notice.accept);
    var members = panel && Number(panel.members);
    function doJoin() {
      accept.disabled = true; accept.textContent = "Joining…";
      post("join/" + encodeURIComponent(code), { adult: true, us_resident: true, notice_accepted: true, notice_id: notice.id, tz: tz,
        quiet_start: Number(qs.value), quiet_end: Number(qe.value) }).then(function (r) {
        if (!r.ok) { accept.disabled = false; accept.textContent = notice.accept;
          fill(err, h("div", { class: "block err" }, h("p", { class: "label" }, "NOT JOINED"), h("p", null, (r.d && r.d.message) || "The call service did not answer. Try again in a minute."))); return; }
        joined(r.d, { start: Number(qs.value), end: Number(qe.value) });
      });
    }
    fill(main, h("section", { class: "screen" },
      h("p", { class: "label" }, panel && panel.name ? "INVITED TO THE PANEL " + String(panel.name).toUpperCase() : "YOU ARE INVITED"),
      h("h1", { class: "ask" }, notice.title),
      h("p", { class: "note how-it-works" }, h("strong", null, "What a call is: "), "a short task on a web page, a minute or two. You listen or look, then type your answer. Nobody phones you; your phone shows a notification if you allow it."),
      h("p", { class: "lede" }, notice.lede),
      typeof members === "number" && members < 5 ? h("p", { class: "block" }, h("strong", null, "Not anonymous. "),
        members === 0 ? "You would be the first person on this panel, and it has fewer than five, so whoever runs it can tell whose answer is whose."
          : "This panel has " + members + " member" + (members === 1 ? "" : "s") + ", so whoever runs it can tell whose answer is whose.") : null,
      h("dl", { class: "notice" }, notice.sections.map(function (s) { return [h("dt", null, s.label), h("dd", null, s.text)]; })),
      h("div", { class: "block" }, h("p", { class: "label" }, "YOUR QUIET HOURS"),
        h("p", { class: "quiet-row" }, "No calls from ", qs, " to ", qe, " your time."),
        h("p", { class: "note" }, "Your time zone, from this phone: " + tz + ". It is used only for your quiet hours. You can change these later.")),
      h("p", { class: "note" }, notice.footnote),
      err,
      h("div", { class: "join-actions" }, accept, h("button", { class: "quiet", type: "button", onclick: function () {
        fill(main, h("section", { class: "screen" }, h("h1", { class: "big" }, "No problem."), h("p", { class: "lede" }, "You have not joined. Nothing about you was kept."))); } }, notice.decline))));
    var t = main.querySelector(".ask"); if (t) { t.setAttribute("tabindex", "-1"); t.focus({ preventScroll: true }); }
  }

  // the ring, set up right here (an iPhone first needs the page on its Home Screen; Android and desktop do not)
  function ringBlock(mt) {
    var box = h("div", { class: "block" }, h("p", { class: "label" }, "NOTIFICATIONS ON THIS PHONE"));
    var ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    var standalone = navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
    var ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    var note = h("p", { class: "note", role: "status" });
    if (ios && !standalone) {
      box.appendChild(h("p", null, "On an iPhone: tap Open my page, then Share, then \u201CAdd to Home Screen\u201D. Open the new icon and tap \u201CLet this phone show calls\u201D there."));
      return box;
    }
    if (!ok) { box.appendChild(h("p", null, "This browser cannot ring. Your page lists every call offered to you; keep it open or look in now and then.")); return box; }
    var btn = h("button", { class: "go", type: "button" }, "Let this phone show calls");
    btn.addEventListener("click", function () {
      btn.disabled = true; note.textContent = "Asking your phone\u2026";
      Notification.requestPermission().then(function (perm) {
        if (perm !== "granted") { btn.disabled = false; note.textContent = perm === "denied" ? "Notifications are blocked for this page; your page still lists every call." : "Not allowed. Nothing changed."; return; }
        return navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(function () { return navigator.serviceWorker.ready; }).then(function (reg) {
          if (reg.active) reg.active.postMessage({ type: "member", token: mt });
          return fetch("/push-key").then(function (r) { return r.json(); }).then(function (k) {
            var raw = k.key.replace(/-/g, "+").replace(/_/g, "/"); while (raw.length % 4) raw += "=";
            var bin = atob(raw), key = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) key[i] = bin.charCodeAt(i);
            return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
          }).then(function (sub) {
            return fetch("/x/members/" + encodeURIComponent(mt) + "/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON() }) });
          }).then(function (r) { note.textContent = r.ok ? "Done: this phone rings when a call comes, while you are On and outside your quiet hours." : "Saved on this phone, but the service did not take it; your page still lists every call."; });
        });
      }).catch(function (e) { btn.disabled = false; note.textContent = "That did not work on this phone (" + (e && e.name ? e.name : "error") + "). Your page still lists every call."; });
    });
    box.appendChild(btn); box.appendChild(note);
    box.appendChild(h("p", { class: "note" }, "The notification says only how many minutes the call takes and its pay, or that it is an unpaid test. Never the asker's words."));
    return box;
  }
  // ms from now until the next time the clock in tz reads hour:00 (quiet hours end on the hour)
  function msToHourIn(tz, hour) {
    var p; try { p = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23", timeZone: tz || undefined }).formatToParts(new Date()); } catch (e) { p = []; }
    var g = function (t) { var x = p.filter(function (y) { return y.type === t; })[0]; return x ? Number(x.value) : 0; };
    var d = (hour * 3600 - (g("hour") * 3600 + g("minute") * 60 + g("second")) + 86400) % 86400;
    return (d || 86400) * 1000;
  }
  function joined(d, quiet) {
    // when On starts inside the quiet hours just chosen, say so: nobody rings until they end (and maybe not this time)
    function quietNote(untilMs) {
      if (!quiet || quiet.start === quiet.end) return "";
      var hr = Number(new Date().toLocaleString("en-US", { timeZone: tz, hour: "numeric", hour12: false })) % 24;
      var inQ = quiet.start > quiet.end ? (hr >= quiet.start || hr < quiet.end) : (hr >= quiet.start && hr < quiet.end);
      if (!inQ) return "";
      var endName = new Date(2026, 0, 1, quiet.end, 0).toLocaleTimeString([], { hour: "numeric" });
      var before = isFinite(untilMs) && (untilMs - Date.now()) <= msToHourIn(tz, quiet.end);
      return " It is your quiet hours until " + endName + (quiet.end <= hr ? " tomorrow" : "") + ", so nobody rings you before then" + (before ? "; your On ends first, so nobody will ring you this time." : ".");
    }
    var page = d.page || ("/m/" + d.member_token);
    var path = page.replace(/^https?:\/\/[^/]+/, "");
    var onWords = h("p", { class: "lede" }, "You start Off: nobody can ring you until you switch On.");
    var OFF_NOTE = "On means you are free to be rung. The next step lets this phone show a call when one comes.";
    var ON_NOTE = "What happens next: nothing, until an AI asks this panel a question; there is no set time. A call waits for you about a minute, so let this phone show calls just below; otherwise you see a call only while your page is open.";
    var nextNote = h("p", { class: "note" }, OFF_NOTE);
    var seg = h("div", { class: "seg", role: "group", "aria-label": "Can you be called" });
    function drawSeg(isOn) {
      seg.textContent = "";
      if (isOn) seg.appendChild(h("button", { type: "button", onclick: function () { setOn(0); } }, "Turn off now"));
      else { seg.appendChild(h("button", { type: "button", onclick: function () { setOn(2); } }, "On 2 hours")); seg.appendChild(h("button", { type: "button", "aria-pressed": "true", onclick: function () { setOn(0); } }, "Stay Off")); }
    }
    drawSeg(false);
    function setOn(hours) {
      fetch("/x/members/" + encodeURIComponent(d.member_token) + "/on", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(hours ? { on: true, hours: hours } : { on: false }) })
        .then(function (r) { if (!r.ok) throw new Error("not changed"); return r.json(); }).then(function (x) {
          var until = Date.parse(x.on_until || "");
          drawSeg(x.on !== "off");   // the buttons follow the switch: On shows 'Turn off now'
          nextNote.textContent = x.on === "off" ? OFF_NOTE : ON_NOTE;   // after On, say plainly what happens next (chief's round-5 order 1)
          onWords.textContent = x.on === "off" ? "Off: nobody can ring you." : "On until " + (isFinite(until) ? new Date(until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "later") + ". Then it switches off by itself." + quietNote(until);
          live.textContent = onWords.textContent;
        }, function () { onWords.textContent = "Not changed: the call service did not answer."; });
    }
    fill(main, h("section", { class: "screen" },
      h("h1", { class: "big ok" }, "You're in."),
      h("p", { class: "lede" }, "You joined " + (d.panel ? "the panel " + d.panel : "the panel") + "."),
      onWords,
      seg,
      nextNote,
      ringBlock(d.member_token),
      h("div", { class: "block" }, h("p", { class: "label" }, "KEEP YOUR PAGE'S LINK"),
        h("p", null, "Your page has its own link, not the one you were sent: the calls offered to you, your receipts, the On switch, and how to leave. Anyone with your page's link can act as you, so keep it to yourself."),
        h("p", { class: "note" }, "Bookmark it or add it to your Home Screen. We cannot look it up for you, because we do not know who you are; if you lose it, ask the person who invited you for a new invitation."),
        h("a", { class: "go linkbtn", href: path }, "Open my page"),
        /iPhone|iPad|iPod/.test(navigator.userAgent) ? h("a", { class: "linkbtn", href: "persontools://m/" + encodeURIComponent(d.member_token) }, "Open in the iPhone app") : null,
        (function () {   // keep the link: copy it to paste into notes or a password manager (nothing is sent anywhere)
          var said = h("span", { class: "note", role: "status" });
          var b = h("button", { class: "quiet", type: "button", onclick: function () {
            var url = location.origin + path;
            (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { said.textContent = " Copied. Paste it somewhere only you can see."; },
              function () { said.textContent = " Copy it from the address bar: " + url; });
          } }, "Copy my link");
          return h("p", null, b, said);
        })()),
      d.standin && d.note ? h("p", { class: "note" }, d.note) : null));   // the service's own note repeats this page; shown only on a stand-in
    try { history.replaceState(null, "", path); } catch (e) {}
    var bl = document.getElementById("bar-label"); if (bl) bl.textContent = "YOU'RE IN";
    window.scrollTo(0, 0);
    var h1 = main.querySelector("h1"); if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus({ preventScroll: true }); }
  }

  if (!/^jc_[a-z0-9]+$/.test(code)) { fill(main, h("section", { class: "screen" }, h("p", { class: "big" }, "Not a join link."), h("p", { class: "lede" }, "Open the link you were sent again."))); return; }
  // a principal's own panel (policy/OWN_PANELS.md) has its own notice, naming the asker as the asker named itself
  function fillPrincipal(o, name) {
    if (typeof o === "string") return o.split("{principal}").join(name);
    if (Array.isArray(o)) return o.map(function (x) { return fillPrincipal(x, name); });
    if (o && typeof o === "object") { var r = {}; for (var k in o) r[k] = fillPrincipal(o[k], name); return r; }
    return o;
  }
  fetch("/x/join/" + encodeURIComponent(code)).then(function (r) { return r.ok ? r.json() : r.text().then(function () { return null; }); }, function () { return null; }).then(function (j) {
    var own = !!(j && j.own && j.principal_name);
    return fetch(own ? "/tester_notice_own.json" : "/tester_notice.json").then(function (r) { return r.json(); }).then(function (n) { return [own ? fillPrincipal(n, j.principal_name) : n, j]; });
  }).then(function (x) { var j = x[1]; render(x[0], j && j.panel ? j.panel : j); }, function () {
    fill(main, h("section", { class: "screen" }, h("p", { class: "big" }, "Not loaded."), h("p", { class: "lede" }, "Try again in a minute.")));
  });
})();
