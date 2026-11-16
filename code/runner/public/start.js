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
    // REACH 3:35 PM CT 16 Nov: lead with connecting your AI, and keep the page three ways (never remembered silently: WEB 3:07)
    var remember = h("input", { type: "checkbox", id: "c-remember" });
    remember.addEventListener("change", function () { try { if (remember.checked) localStorage.setItem(KEY, tok); else localStorage.removeItem(KEY); } catch (e) {} msg.textContent = remember.checked ? "This phone will remember your page." : "This phone will not remember your page."; });
    var copy = h("button", { type: "button", class: "quiet small", onclick: function () {
      var url = location.origin + page;
      (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { msg.textContent = "Your page's link is copied."; }, function () { msg.textContent = "Copy this link: " + url; });
    } }, "Copy my page's link");
    var bl = document.getElementById("bar-label"); if (bl) bl.textContent = "YOUR PAGE";
    main.replaceChildren(h("section", { class: "screen" }, h("p", { class: "label" }, "YOUR PAGE"),
      h("p", { class: "sub" }, "Your page is made."),
      h("p", { class: "lede" }, "Next, connect your first AI. Keep this page: without a passkey, its link is the only way back."),
      h("button", { type: "button", class: "go", onclick: function () { location.href = page; } }, "Open my page and connect an AI"),
      h("p", { class: "label" }, "KEEP YOUR PAGE"),
      h("p", null, h("b", null, "Add it to your Home Screen. "), "On an iPhone: Share, then Add to Home Screen. On Android: the menu, then Add to Home screen. The icon keeps your page, and alerts need it."),
      h("p", { class: "check" }, remember, " ", h("label", { for: "c-remember" }, "Remember my page on this phone")),
      h("p", { class: "note" }, "Off until you tick it. Leave it off on a computer others use."),
      copy, h("p", { class: "note" }, "Anyone with this link can open your page. Keep it to yourself."),
      h("p", { class: "label" }, "SIGN IN ANYWHERE"),
      h("p", null, "A passkey signs you in with Face ID on your devices, without the link."), add, msg));
  }
  // a page this phone was told to remember (REACH 3:35): offered above the form; forgotten once, and said, when it no longer opens
  var KEY = "pt_own_page", kept = null; try { kept = localStorage.getItem(KEY); } catch (e) {}
  var keptBox = h("div", null);
  if (kept && /^mt_[a-z0-9]{4,80}$/.test(kept)) fetch("/x/members/" + encodeURIComponent(kept) + "/tasks", { headers: { Accept: "application/json" } }).then(function (r) {
    if (r.ok) keptBox.replaceChildren(h("div", { class: "block" }, h("p", { class: "sub" }, "You have a page on this phone."), h("button", { type: "button", class: "go", onclick: function () { location.href = "/m/" + encodeURIComponent(kept); } }, "Open my page")));
    else if ([401, 404, 410].indexOf(r.status) >= 0) { try { localStorage.removeItem(KEY); } catch (e) {} keptBox.replaceChildren(h("p", { class: "note", role: "status" }, "The page this phone remembered no longer opens.")); }
  }, function () {});
  fetch("/tester_notice_self.json").then(function (r) { return r.json(); }).then(function (notice) {   // TRUST 3:08 PM CT 16 Nov: a page of your own has its own notice
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
      h("p", { class: "lede" }, "One place where your own AIs ask you things, and you answer with a tap. Nobody else can reach you here."), keptBox,
      h("p", { class: "label" }, "THE NOTICE, WORD FOR WORD"),
      h("dl", { class: "notice" }, (notice.sections || []).map(function (s) { return [h("dt", null, s.label), h("dd", null, s.text)]; })),
      h("p", null, h("label", { for: "c-adult" }, adult, " I am 18 or older.")),
      h("p", null, h("label", { for: "c-us" }, us, " I live in the United States.")),
      h("p", null, h("label", { for: "c-notice" }, ok, " I have read the notice and accept it.")),
      go, msg,
      h("p", { class: "note" }, "Your page's link is how you sign in until you add a passkey on it. Then: Connect an AI.")));
  }, function () { main.replaceChildren(h("p", { class: "note" }, "The notice did not load. Try again in a minute.")); });
})();
