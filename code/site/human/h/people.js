/* the person\'s side: the people's page. Loads the real call page on a rehearsal seat (the runner's stand-in) into the phone. */
(function () {
  "use strict";
  var HOSTS = JSON.parse(document.getElementById("hc-hosts").textContent);
  var host = location.hostname;
  var run = HOSTS.primary.site.indexOf(host) >= 0 ? "https://" + HOSTS.primary.run : "https://" + HOSTS.fallback.run;
  if (host === "127.0.0.1" || host === "localhost") { var q = new URLSearchParams(location.search); if (q.get("run")) run = q.get("run").replace(/\/$/, ""); }
  document.getElementById("seat").src = run + "/c/standin-people" + Math.random().toString(36).slice(2, 10);

  // TO BE CALLED LATER (P5): a form only when the service says the list is open, with the service's own words about what
  // is kept; until then the page says there is no list (nobody is invited to give an address that would not be kept)
  var api = HOSTS.primary.site.indexOf(host) >= 0 ? "https://" + HOSTS.primary.api : "https://" + HOSTS.fallback.api;
  var box = document.getElementById("later-form");
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) { var v = attrs[k]; if (v == null || v === false) continue; if (k === "class") el.className = v; else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? "" : v); }
    for (var i = 2; i < arguments.length; i++) { var c = arguments[i]; if (c == null || c === false) continue; el.appendChild(typeof c === "object" ? c : document.createTextNode(String(c))); }
    return el;
  }
  function post(path, body) {
    return fetch(api + path, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, d: d || {} }; }); }, function () { return { ok: false, status: 0, d: {} }; });
  }
  var ctl = window.AbortController ? new AbortController() : null; if (ctl) setTimeout(function () { ctl.abort(); }, 6000);   // never left hanging
  if (box) fetch(api + "/v1/waitlist", { headers: { Accept: "application/json" }, signal: ctl ? ctl.signal : undefined }).then(function (r) { return r.ok ? r.json() : null; }, function () { return null; }).then(function (d) {
    if (!d || d.open !== true) return;
    var heading = document.getElementById("later-h"); if (heading) heading.textContent = "Ask to be called when real calls open.";
    var input = h("input", { type: "email", id: "later-addr", autocomplete: "email", required: true, maxlength: "200" });
    var out = h("p", { class: "note", role: "status" });
    var send = h("button", { class: "go", type: "button", onclick: function () {
      var a = input.value.trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a)) { out.textContent = "That does not look like an email address."; input.focus(); return; }
      send.disabled = true; post("/v1/waitlist", { address: a }).then(function (r) { send.disabled = false;
        out.textContent = r.ok && r.d.stored ? (r.d.message || "Kept. Nothing else will be sent to this address until real calls open.") : "Not kept: " + (r.d.message || "the service did not answer.") + " Nothing was stored."; });
    } }, "Ask to be called later");
    var remove = h("button", { class: "quiet", type: "button", onclick: function () {
      var a = input.value.trim(); if (!a) { out.textContent = "Write the address to remove first."; input.focus(); return; }
      post("/v1/waitlist/remove", { address: a }).then(function (r) { out.textContent = r.ok ? (r.d.message || "Removed, if it was on the list.") : "Not removed: " + (r.d.message || "the service did not answer."); });
    } }, "Remove my address");
    box.appendChild(h("div", { class: "later" }, h("label", { for: "later-addr", class: "label" }, "YOUR EMAIL ADDRESS"), input, send,
      d.kept ? h("p", { class: "note" }, d.kept) : null, remove, out));
  });
})();
