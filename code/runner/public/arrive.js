/* /p/<ar_token>?pid=...&study=...&session=... : a person an outside panel (Prolific) sent. Register the arrival through our
   own address (/x, server to server), take the panel's ids out of the address bar at once, and go to the person's seat.
   The ids are sent to the call service only; this page keeps nothing. */
(function () {
  "use strict";
  var main = document.getElementById("main"), live = document.getElementById("live");
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) { var v = attrs[k]; if (v == null || v === false) continue;
      if (k === "class") el.className = v; else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? "" : v); }
    for (var i = 2; i < arguments.length; i++) { var c = arguments[i]; if (c == null || c === false) continue; el.appendChild(typeof c === "object" ? c : document.createTextNode(String(c))); }
    return el;
  }
  function screen(label, big, lede, extra) {
    main.textContent = "";
    main.appendChild(h("section", { class: "screen" }, h("p", { class: "label" }, label), h("p", { class: "big" }, big), h("p", { class: "lede" }, lede), extra || null));
    live.textContent = big + " " + lede;
  }
  var token = decodeURIComponent((location.pathname.split("/p/")[1] || "").split("/")[0]);
  var q = new URLSearchParams(location.search);
  var body = { pid: q.get("PROLIFIC_PID") || q.get("pid") || "", study: q.get("STUDY_ID") || q.get("study") || "", session: q.get("SESSION_ID") || q.get("session") || "" };
  try { history.replaceState(null, "", "/p/" + encodeURIComponent(token)); } catch (e) {}   // the panel's ids leave the address bar
  if (!/^ar_[A-Za-z0-9_.-]{8,600}$/.test(token)) { screen("YOUR TASK", "Not a task link.", "Open the study again from the panel's site."); return; }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(body.pid)) { screen("YOUR TASK", "Your panel id is missing.", "Open the study again from the panel's site, so it can tell us who you are there. Nothing is marked against you."); return; }
  var tries = 0;
  function go() {
    tries++;
    fetch("/x/arrivals/" + encodeURIComponent(token), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, d: d || {} }; }); },
            function () { return { ok: false, status: 0, d: {} }; })
      .then(function (r) {
        var st = r.d.seat_token || (r.d.seat_url ? String(r.d.seat_url).split("/c/")[1] : "");
        if (r.ok && st) {
          try { sessionStorage.setItem("pt_pool_seat", st); } catch (e) {}   // this tab's seat came from an outside panel: its last screens send the person back there
          location.replace("/c/" + encodeURIComponent(st) + (r.d.again ? "" : "#arrived")); return;
        }   // a fresh seat: the card first
        if (r.status === 409 || r.status === 410 || r.status === 404) {
          var head = r.d.code === "already_arrived" ? "This place is already taken." : r.status === 409 ? "This study is full." : r.status === 410 ? "This study has closed." : "This link does not match a study.";
          var msg = String(r.d.message || "Please return the study on the panel's site.");
          if (msg.indexOf(head) === 0) msg = msg.slice(head.length).trim();   // the service's message often opens with the same sentence as the heading
          msg = msg.charAt(0).toUpperCase() + msg.slice(1);
          screen("YOUR TASK", head, msg + (/marked against you/.test(msg) ? "" : " Nothing is marked against you."));
          return;
        }
        screen("YOUR TASK", "Not reached.", "The call service did not answer" + (r.d.message ? ": " + r.d.message : ".") + " Try again in a moment.",
          h("button", { class: "go", type: "button", onclick: go }, "Try again"));
      });
  }
  go();
})();
