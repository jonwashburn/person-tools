/* The admin console (owner/OWNER_router_10 B): a person signs in with their passkey (person.tools), then sees what they own (owner
   scope) and, if the owner named them, the operator's views. Every action goes to /v1/admin/... and is logged by the service. */
(function () {
  "use strict";
  var API = "/x";   // this page's own address: the runner forwards account and admin calls with the credential in the header
  var main = document.getElementById("main");
  var S = null; try { S = sessionStorage.getItem("pt_session"); } catch (e) {}
  function h(tag, attrs) {
    var el = document.createElement(tag), kids = Array.prototype.slice.call(arguments, 2);
    for (var k in attrs || {}) { var v = attrs[k]; if (v == null || v === false) continue; if (k === "onclick") el.addEventListener("click", v); else if (k === "text") el.textContent = v; else el.setAttribute(k, v === true ? "" : v); }
    (function add(list) { list.forEach(function (c) { if (c == null || c === false) return; if (Array.isArray(c)) add(c); else el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); }); })(kids);
    return el;
  }
  function call(method, path, body) {
    var init = { method: method, headers: { Accept: "application/json" } };
    if (S) init.headers.Authorization = "Bearer " + S;
    if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
    return fetch(API + path.replace(/^\/v1\//, "/"), init).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d || {} }; }, function () { return { ok: r.ok, status: r.status, d: {} }; }); },
      function () { return { ok: false, status: 0, d: { message: "The service did not answer." } }; });
  }
  var b64u = { enc: function (buf) { var s = "", u = new Uint8Array(buf); for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); },
    dec: function (s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; } };
  function show() { main.replaceChildren.apply(main, Array.prototype.slice.call(arguments).filter(Boolean)); }
  function say(t) { return h("p", { class: "note", role: "status" }, t); }

  function signIn(msg) {
    show(h("section", { class: "screen" }, h("p", { class: "label" }, "SIGN IN"), h("p", { class: "lede" }, "Sign in with your passkey: Face ID, Touch ID, Windows Hello, a phone nearby, or a security key."),
      h("button", { type: "button", class: "go", onclick: doSignIn }, "Sign in with a passkey"), msg ? say(msg) : null,
      h("p", { class: "note" }, "No passkey yet? Add one from your page on this site (the link you got when you joined), or in the person.tools app.")));
  }
  function doSignIn() {
    if (!window.PublicKeyCredential) { signIn("This browser cannot use passkeys."); return; }
    call("POST", "/v1/account/login/options").then(function (r) {
      if (!r.ok) throw new Error(r.d.message || "no options");
      var pk = r.d.publicKey; pk.challenge = b64u.dec(pk.challenge);
      return navigator.credentials.get({ publicKey: pk }).then(function (c) {
        return call("POST", "/v1/account/login", { challenge_id: r.d.challenge_id, credential: { id: c.id, rawId: b64u.enc(c.rawId), type: c.type,
          response: { clientDataJSON: b64u.enc(c.response.clientDataJSON), authenticatorData: b64u.enc(c.response.authenticatorData), signature: b64u.enc(c.response.signature), userHandle: c.response.userHandle ? b64u.enc(c.response.userHandle) : null } } });
      });
    }).then(function (r) {
      if (!r.ok) throw new Error(r.d.message || "not signed in");
      S = r.d.session; try { sessionStorage.setItem("pt_session", S); } catch (e) {} home();
    }).catch(function (e) { signIn("Not signed in: " + (e && e.message ? e.message : e)); });
  }
  function signOut() { call("POST", "/v1/account/logout").then(function () { S = null; try { sessionStorage.removeItem("pt_session"); } catch (e) {} signIn("Signed out."); }); }

  function home() {
    call("GET", "/v1/admin/me").then(function (r) {
      if (r.status === 401) { S = null; signIn(); return; }
      var sc = r.d.scopes || {}, sections = [h("section", { class: "screen" }, h("p", { class: "label" }, "YOU"),
        h("p", null, sc.operator ? "You hold operator scope." : (sc.owner_of || []).length ? "You manage " + sc.owner_of.length + " of your own." : "The owner has not given you an admin scope yet."),
        h("button", { type: "button", class: "quiet", onclick: signOut }, "Sign out"))];
      show.apply(null, sections);
      call("GET", "/v1/admin/principals").then(function (p) { if (p.ok) (p.d.principals || []).forEach(function (x) { main.appendChild(principalSection(x)); }); if (sc.operator) main.appendChild(operatorSection()); });
    });
  }
  function principalSection(p) {
    var box = h("section", { class: "screen" }, h("p", { class: "label" }, "YOURS: " + String(p.name).toUpperCase()), say("Loading…"));
    call("GET", "/v1/admin/principals/" + p.principal_id).then(function (r) {
      var kids = [h("p", { class: "label" }, "YOURS: " + String(p.name).toUpperCase())];
      (r.d.panels || []).forEach(function (pn) { kids.push(panelBlock(pn)); });
      kids.push(h("details", null, h("summary", null, "Your AIs"), aisBlock(p.principal_id)));
      kids.push(h("details", null, h("summary", null, "Your asks and their answers"), asksBlock(p.principal_id)));
      box.replaceChildren.apply(box, kids);
    });
    return box;
  }
  function panelBlock(pn) {
    var people = h("ul", { class: "list" }), links = h("ul", { class: "list" }), out = h("div");
    function load() {
      call("GET", "/v1/admin/panels/" + pn.panel_id + "/people").then(function (r) { people.replaceChildren.apply(people, (r.d.people || []).map(function (m) {
        return h("li", null, (m.name || "unnamed") + (m.on ? " · on" : " · off") + (m.a_person ? "" : " · a test member") + (m.in_the_app ? " · app" : ""),
          " ", h("button", { type: "button", class: "quiet", onclick: function () { var n = prompt("Name for tasks (letters, spaces, hyphens):", m.name || ""); if (n !== null) call("POST", "/v1/admin/members/" + m.member_id + "/name", { name: n.trim() || null }).then(load); } }, "Name"),
          " ", h("button", { type: "button", class: "quiet", onclick: function () { var w = prompt("Remove from this panel. One line they will read:"); if (w) call("POST", "/v1/admin/members/" + m.member_id + "/remove", { why: w }).then(load); } }, "Remove")); })); });
      call("GET", "/v1/admin/panels/" + pn.panel_id + "/links").then(function (r) { links.replaceChildren.apply(links, (r.d.links || []).filter(function (l) { return !l.revoked_at; }).map(function (l) {
        return h("li", null, (l.for ? "for " + l.for : "anyone") + " · " + l.joins + (l.max_joins ? " of " + l.max_joins : "") + " joined",
          " ", h("button", { type: "button", class: "quiet", onclick: function () { if (confirm("Revoke this link?")) call("DELETE", "/v1/admin/panels/" + pn.panel_id + "/links/" + l.link_id).then(load); } }, "Revoke")); })); });
    }
    load();
    var who = h("input", { type: "text", maxlength: "40", placeholder: "Who the link is for (optional)", "aria-label": "Who the link is for" });
    return h("div", { class: "block" }, h("p", { class: "sub" }, pn.name + " · " + pn.people + " people, " + pn.on_now + " on now"), people,
      h("p", { class: "label" }, "JOIN LINKS"), links, who,
      h("button", { type: "button", class: "go", onclick: function () { var b = who.value.trim() ? { label: who.value.trim().toLowerCase() } : {};
        call("POST", "/v1/admin/panels/" + pn.panel_id + "/links", b).then(function (r) { out.replaceChildren(r.ok ? h("pre", { class: "task-cmd" }, r.d.join_url || JSON.stringify(r.d)) : say("Not made: " + (r.d.message || r.status))); load(); }); } }, "Make a join link"), out);
  }
  function aisBlock(pr) {
    var ul = h("ul", { class: "list" });
    function load() { call("GET", "/v1/admin/principals/" + pr + "/connections").then(function (r) { ul.replaceChildren.apply(ul, (r.d.connections || []).map(function (c) {
      return h("li", null, c.name + (c.quiet ? " (quiet)" : "") + (c.last_used_at ? " · last asked " + new Date(c.last_used_at).toLocaleString() : ""),
        " ", h("button", { type: "button", class: "quiet", onclick: function () { call("POST", "/v1/admin/connections/" + c.connection_id + "/quiet", { quiet: !c.quiet }).then(load); } }, c.quiet ? "Let it ring" : "Quiet"),
        " ", h("button", { type: "button", class: "quiet", onclick: function () { if (confirm("Revoke " + c.name + "? Its key stops at once.")) call("DELETE", "/v1/admin/connections/" + c.connection_id).then(load); } }, "Revoke")); })); }); }
    load(); return ul;
  }
  function asksBlock(pr) {
    var ul = h("ul", { class: "list" });
    call("GET", "/v1/admin/principals/" + pr + "/asks").then(function (r) { ul.replaceChildren.apply(ul, (r.d.asks || []).slice(0, 50).map(function (t) {
      return h("li", null, t.title + " · " + t.state + (t.from ? " · from " + t.from : "") + (t.reply ? " · " + (t.reply.approved_text ? "approved" : t.reply.choice || t.reply.action) : "") + (t.notes ? " · " + t.notes + " note" + (t.notes === 1 ? "" : "s") : "")); })); });
    return ul;
  }
  function operatorSection() {
    var box = h("section", { class: "screen" }, h("p", { class: "label" }, "OPERATOR"));
    var held = h("ul", { class: "list" }), keys = h("ul", { class: "list" }), proof = h("pre", { class: "task-cmd" });
    function load() {
      call("GET", "/v1/admin/held").then(function (r) { held.replaceChildren.apply(held, (r.d.held || []).map(function (c) {
        return h("li", null, c.call_id + " · " + (c.rule || "held") + (c.ours ? " · ours" : ""),
          " ", h("button", { type: "button", class: "quiet", onclick: function () { if (confirm("Release " + c.call_id + "?")) call("POST", "/v1/admin/calls/" + c.call_id + "/release", {}).then(load); } }, "Release"),
          " ", h("button", { type: "button", class: "quiet", onclick: function () { var w = prompt("Refuse. One line the asker reads:"); if (w) call("POST", "/v1/admin/calls/" + c.call_id + "/refuse", { why: w }).then(load); } }, "Refuse")); })); });
      call("GET", "/v1/admin/keys").then(function (r) { keys.replaceChildren.apply(keys, (r.d.keys || []).slice(0, 60).map(function (k) {
        return h("li", null, (k.label || k.key_id) + " · " + k.principal + (k.suspended_at ? " · suspended" : ""),
          k.suspended_at ? null : h("button", { type: "button", class: "quiet", onclick: function () { if (confirm("Suspend " + (k.label || k.key_id) + "?")) call("POST", "/v1/admin/keys/" + k.key_id + "/suspend", {}).then(load); } }, "Suspend")); })); });
      call("GET", "/v1/admin/proof").then(function (r) { var p = r.d.proof || {}; proof.textContent = JSON.stringify({ real_calls_answered: p.real_calls_answered, outside_principals_with_a_call: p.outside_principals_with_a_call, real_tasks_answered: p.real_tasks_answered, audit: (r.d.audit || {}).numbers }, null, 1); });
    }
    load();
    box.append(h("p", { class: "label" }, "HELD CALLS"), held, h("p", { class: "label" }, "KEYS"), keys, h("p", { class: "label" }, "PROOF AND ITS AUDIT"), proof);
    return box;
  }
  if (S) home(); else signIn();
})();
