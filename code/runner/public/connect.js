/* OWNER_router_31 (the standard's 27.9): a service asks to connect to this person's own page. The person sees the service's proved name
   and domain, may rename it and choose how urgent its asks may be, and connects it or not. Only the page this phone remembers can connect
   (ticked "Remember my page on this phone"); nothing is connected without the person's tap. */
(function () {
  "use strict";
  var main = document.getElementById("main"), live = document.getElementById("live");
  function h(tag, attrs) {
    var el = document.createElement(tag), kids = Array.prototype.slice.call(arguments, 2);
    for (var k in attrs || {}) { var v = attrs[k]; if (v == null || v === false) continue; if (k === "onclick") el.addEventListener("click", v); else el.setAttribute(k, v === true ? "" : v); }
    (function add(list) { list.forEach(function (c) { if (c == null || c === false) return; if (Array.isArray(c)) add(c); else el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); }); })(kids);
    return el;
  }
  var q = new URLSearchParams(location.search), brand = q.get("brand") || "", state = q.get("state") || "", ret = q.get("return") || "";
  var tok = null; try { tok = localStorage.getItem("pt_own_page"); } catch (e) {}
  function back(params) { var u = new URL(ret); Object.keys(params).forEach(function (k) { u.searchParams.set(k, params[k]); }); location.href = u.toString(); }
  function screen() { main.replaceChildren(h.apply(null, ["section", { class: "screen" }].concat(Array.prototype.slice.call(arguments)))); }
  fetch("/x/connect/brand", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ brand: brand, return: ret }) })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d || {} }; }); })
    .then(function (r) {
      if (!r.ok) { screen(h("p", { class: "label" }, "NOT CONNECTED"), h("p", { class: "lede" }, "This connection link is not valid, so nothing was connected."), h("p", { class: "note" }, r.d.message || "")); return; }
      var b = r.d.brand || {}, name = b.name || "This service";
      var no = h("button", { type: "button", class: "quiet", onclick: function () { back({ error: "declined", state: state }); } }, "Not now");
      if (!tok || !/^mt_[a-z0-9]{4,80}$/.test(tok)) {
        screen(h("p", { class: "label" }, "CONNECT " + name.toUpperCase()), h("p", { class: "lede" }, name + " (" + (b.domain || "") + (b.verified === false ? ", a test brand, not verified" : ", proved") + ") asks to connect to your person.tools page."),
          h("p", null, "This phone does not remember your page yet. Open your page on this phone, tick “Remember my page on this phone” where you made it, or make one at run.person.tools/start, then open this link again."), no);
        return;
      }
      var nm = h("input", { type: "text", maxlength: "40", value: name, "aria-label": "Its name on your page" });
      var urg = ["now", "today", "whenever"].map(function (u) { var c = h("input", { type: "checkbox", id: "u-" + u }); c.checked = true; return { u: u, c: c }; });
      var msg = h("p", { class: "note", role: "status" });
      var go = h("button", { type: "button", class: "go", onclick: function () {
        var allowed = urg.filter(function (x) { return x.c.checked; }).map(function (x) { return x.u; });
        if (!allowed.length) { msg.textContent = "Choose at least one."; return; }
        go.disabled = true; msg.textContent = "Connecting…";
        fetch("/x/members/" + encodeURIComponent(tok) + "/connect", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ brand: brand, state: state, return: ret, name: nm.value.trim() || name, urgencies: allowed }) })
          .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d || {} }; }); })
          .then(function (r) {
            if (r.ok && r.d.redirect) { msg.textContent = "Connected. Taking you back to " + name + "…"; location.href = r.d.redirect; return; }
            go.disabled = false; msg.textContent = "Not connected: " + ((r.d && r.d.message) || "try again.");
          }, function () { go.disabled = false; msg.textContent = "Not connected: no connection. Try again."; });
      } }, "Connect " + name);
      screen(h("p", { class: "label" }, "CONNECT " + name.toUpperCase()),
        h("p", { class: "lede" }, name + " asks to connect to your person.tools page, so it can ask you things under its own name."),
        h("p", null, h("b", null, name), ", " + (b.domain || "") + (b.verified === false ? ": Test brand, not verified. It reaches test members only." : ": the domain is proved.") + " person.tools always shows you who is asking."),
        h("p", null, h("label", null, "Its name on your page ", nm)),
        h("p", { class: "label" }, "HOW URGENT ITS ASKS MAY BE"),
        urg.map(function (x) { return h("p", { class: "check" }, x.c, " ", h("label", { for: "u-" + x.u }, x.u === "now" ? "Now (it may ring once)" : x.u === "today" ? "Today" : "Whenever")); }),
        go, no, msg,
        h("p", { class: "note" }, "You can rename it, quiet it or revoke it on your page at any time. " + name + " learns nothing about you but this connection."));
    }, function () { screen(h("p", { class: "label" }, "NOT CONNECTED"), h("p", { class: "lede" }, "The service did not answer. Try the link again in a minute.")); });
})();
