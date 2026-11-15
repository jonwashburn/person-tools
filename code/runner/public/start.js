/* A stranger's own person.tools page (operations 2:22 PM CT; the CEO 2:21: a person makes a connection without us). One screen: the
   tester notice word for word, three confirmations, then the page is made: only the person's own AIs ever reach them there. */
(function () {
  "use strict";
  var main = document.getElementById("main");
  function h(tag, attrs) {
    var el = document.createElement(tag), kids = Array.prototype.slice.call(arguments, 2);
    for (var k in attrs || {}) { var v = attrs[k]; if (v == null || v === false) continue; if (k === "onclick") el.addEventListener("click", v); else el.setAttribute(k, v === true ? "" : v); }
    (function add(list) { list.forEach(function (c) { if (c == null || c === false) return; if (Array.isArray(c)) add(c); else el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); }); })(kids);
    return el;
  }
  // the passkey for the new account: a second tap (browsers make a passkey only right after a tap), then the page
  function passkeyStep(tok) {
    var page = "/m/" + encodeURIComponent(tok), msg = h("p", { class: "note", role: "status" });
    var enc = function (buf) { var s = "", u = new Uint8Array(buf); for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
    var dec = function (s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; };
    var post = function (path, body) { return fetch("/x" + path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify(body || {}) }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d || {} }; }); }); };
    var add = h("button", { type: "button", class: "go", onclick: function () {
      if (!window.PublicKeyCredential) { location.href = page; return; }
      add.disabled = true; msg.textContent = "Asking your device\u2026";
      post("/account/passkey/options").then(function (r) {
        if (!r.ok) throw new Error(r.d.message || "no options");
        var pk = r.d.publicKey; pk.challenge = dec(pk.challenge); pk.user.id = dec(pk.user.id); (pk.excludeCredentials || []).forEach(function (c) { c.id = dec(c.id); });
        return navigator.credentials.create({ publicKey: pk }).then(function (c) {
          return post("/account/passkey", { challenge_id: r.d.challenge_id, credential: { id: c.id, rawId: enc(c.rawId), type: c.type,
            response: { clientDataJSON: enc(c.response.clientDataJSON), attestationObject: enc(c.response.attestationObject), transports: c.response.getTransports ? c.response.getTransports() : [] } } });
        });
      }).then(function (r) { if (r.ok) location.href = page; else { add.disabled = false; msg.textContent = "Not added: " + (r.d.message || "try again") + ". Your page is made either way."; } },
        function (e) { add.disabled = false; msg.textContent = "Not added: " + (e && e.message ? e.message : e) + ". Your page is made either way."; });
    } }, "Add a passkey (Face ID)");
    main.replaceChildren(h("section", { class: "screen" }, h("p", { class: "label" }, "YOUR PAGE IS MADE"),
      h("p", { class: "lede" }, "Add a passkey, so you can sign in with Face ID on your devices. Then connect your AI."), add,
      h("a", { class: "linkbtn", href: page }, "Not now: go to my page"), msg,
      h("p", { class: "note" }, "Keep your page's link until you add a passkey: it is how you come back.")));
  }
  fetch("/tester_notice.json").then(function (r) { return r.json(); }).then(function (notice) {
    var adult = h("input", { type: "checkbox", id: "c-adult" }), us = h("input", { type: "checkbox", id: "c-us" }), ok = h("input", { type: "checkbox", id: "c-notice" });
    var msg = h("p", { class: "note", role: "status" });
    var go = h("button", { type: "button", class: "go", onclick: function () {
      if (!adult.checked || !us.checked || !ok.checked) { msg.textContent = "Tick all three first."; return; }
      go.disabled = true; msg.textContent = "Making your page…";
      var tz = "America/Chicago"; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch (e) {}
      fetch("/x/account/start", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ adult: true, us_resident: true, notice_accepted: true, notice_id: notice.id, tz: tz }) })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d || {} }; }); })
        .then(function (r) {
          if (!r.ok || !r.d.member_token) { go.disabled = false; msg.textContent = "Not made: " + ((r.d && r.d.message) || "try again."); return; }
          passkeyStep(r.d.member_token);
        }, function () { go.disabled = false; msg.textContent = "Not made: no connection. Try again."; });
    } }, "Make my page");
    main.replaceChildren(h("section", { class: "screen" },
      h("p", { class: "label" }, "YOUR OWN PERSON.TOOLS PAGE"),
      h("p", { class: "lede" }, "One place where your own AIs ask you things, and you answer with a tap. Nobody else can reach you here."),
      h("p", { class: "label" }, "THE NOTICE, WORD FOR WORD"),
      h("dl", { class: "notice" }, (notice.sections || []).map(function (s) { return [h("dt", null, s.label), h("dd", null, s.text)]; })),
      h("p", null, h("label", { for: "c-adult" }, adult, " I am 18 or older.")),
      h("p", null, h("label", { for: "c-us" }, us, " I live in the United States.")),
      h("p", null, h("label", { for: "c-notice" }, ok, " I have read the notice and accept it.")),
      go, msg,
      h("p", { class: "note" }, "Your page's link is how you sign in until you add a passkey on it. Then: Connect an AI.")));
  }, function () { main.replaceChildren(h("p", { class: "note" }, "The notice did not load. Try again in a minute.")); });
})();
