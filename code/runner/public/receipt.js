/* the person\'s side: a receipt in plain words. Designed around one line: what the asker says your answer changed. */
(function () {
  "use strict";
  var id = decodeURIComponent((location.pathname.split("/")[2] || "").trim());
  var main = document.getElementById("main"), live = document.getElementById("live");
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
  function money(s) { var n = Number(s); return isFinite(n) ? "$" + n.toFixed(2) : String(s); }
  function fmt(t) { t = Math.max(0, Math.round(t)); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); }
  var DID = { listen: "listened to a piece", watch: "watched a video", view: "looked at a page", play: "played a build", compare: "compared versions", answer: "answered questions" };
  var NET = window.PT_NETWORK || "the service";
  // what the record shows, in plain words, with the played numbers the service keeps beside the receipt (heard)
  function evidenceNote(ev, heard, numbersShown) {
    heard = heard || {};
    var p = Number(heard.played_seconds), m = Number(heard.media_seconds), s = Number(heard.seat_seconds);
    var nums = isFinite(p) && isFinite(m) && m > 0 ? fmt(p) + " of " + fmt(m) + " played" : (isFinite(s) && s > 0 ? fmt(s) + " on your screen" : "");
    if (numbersShown) nums = "";   // the figure just above already shows them
    if (ev === "attended") return "The whole piece played, with this page open" + (nums ? " (" + nums + ")" : "") + ".";
    if (ev === "said") return "Your answer counts in full. The record does not show the whole piece playing with this page open" + (nums ? " (" + nums + ")" : "") + "; the asker sees that too.";
    if (ev === "voiced") return "A spoken answer" + (nums ? " (" + nums + ")" : "") + ".";
    return nums ? nums.charAt(0).toUpperCase() + nums.slice(1) + "." : "";
  }

  function post(path, body) {
    return fetch("/x/" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); }, function () { return { ok: false, d: {} }; });
  }

  function b64d(x) { x = x.replace(/-/g, "+").replace(/_/g, "/"); while (x.length % 4) x += "="; return decodeURIComponent(escape(atob(x))); }
  function b64e(x) { return btoa(unescape(encodeURIComponent(x))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function render(d) {
    var r = d.receipt || {}, oc = d.outcomes && d.outcomes.length ? d.outcomes[d.outcomes.length - 1] : null;
    var changed = d.what_changed || (oc ? (typeof oc === "string" ? oc : oc.text || oc.what_changed || null) : null);
    if (!d.receipt && d.jws) { try { r = JSON.parse(b64d(d.jws.split(".")[1])); } catch (e) {} }
    var keyId = d.key_id || r.key_id || r.kid || (function () { try { return JSON.parse(b64d(d.jws.split(".")[0])).kid; } catch (e) { return "the published key"; } })();
    var signedText = d.receipt_text || JSON.stringify(r);
    var when = Date.parse(r.ended_at || r.issued_at || "");
    var day = isFinite(when) ? new Date(when).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }) : "";
    var at = isFinite(when) ? new Date(when).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : "";
    var unpaid = r.unpaid_test || r.unpaid || Number(r.paid_usd || 0) === 0;
    var stopped = (r.seat_status && r.seat_status !== "answered") || (r.outcome && r.outcome !== "answered");
    var askerName = r.asker || r.answered_for || "an asker";
    var secs = Math.round((Number(r.minutes) || 0) * 60);

    // who wrote the line comes first, so nobody takes the asker's words for their own (a cold read, 14 Nov)
    var lastOc = d.outcomes && d.outcomes.length ? d.outcomes[d.outcomes.length - 1] : null;
    var nPeople = Number((lastOc && (lastOc.people || lastOc.answered)) || d.what_changed_people || 0);
    var ocAt = (lastOc && lastOc.at) || d.what_changed_at;
    var changedBlock = changed
      ? h("div", { class: "changed" },
          h("p", { class: "label" }, nPeople === 1 ? "WHAT YOUR ANSWER CHANGED" : "WHAT THE ANSWERS CHANGED"),
          h("p", { class: "note" }, "The AI that asked wrote this" +
            (ocAt ? (new Date(ocAt).toDateString() === new Date(Date.parse(r.ended_at || r.issued_at || "") || 0).toDateString() ? "" : " on " + new Date(ocAt).toLocaleDateString([], { weekday: "long" })) +
              " at " + new Date(ocAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "") + " and sent it to " +
            (nPeople > 1 ? "the " + nPeople + " people who answered, you among them" : nPeople === 1 ? "you, the one person who answered" : "everyone who answered, you among them") + ":"),
          h("p", { class: "ask" }, "“" + changed + "”"))
      : h("div", { class: "changed waiting" },
          h("p", { class: "label" }, "WHAT THE ANSWERS CHANGED"),
          h("p", { class: "lede" }, "The asker has not said yet."),
          h("p", { class: "note" }, "When it tells us what it did with the answers, its one line appears here, at the top of this receipt."));

    var checkOut = h("p", { class: "verdict", role: "status" });
    var tamperOut = h("p", { class: "verdict", role: "status" });
    function check(text, out, label) {
      out.textContent = "Checking\u2026"; out.className = "verdict";
      return post("receipts/verify", d.jws ? { jws: text } : { receipt_text: text, signature: d.signature, key_id: d.key_id }).then(function (v) {
        var ok = v.ok && (v.d.valid === true || v.d.ok === true || v.d.verified === true);
        out.className = "verdict " + (ok ? "good" : "bad");
        out.textContent = ok ? label.good : label.bad;
        live.textContent = out.textContent;
      });
    }
    var save = function () {
      var blob = new Blob([JSON.stringify(d.jws ? { receipt: r, jws: d.jws, verify: d.verify || "POST /v1/receipts/verify {jws}", what_changed: changed || null } : { receipt_text: d.receipt_text, signature: d.signature, key_id: d.key_id, verify: d.verify, what_changed: changed || null }, null, 2)], { type: "application/json" });
      var a = h("a", { href: URL.createObjectURL(blob), download: (r.receipt_id || "receipt") + ".json" }); document.body.appendChild(a); a.click(); a.remove();
    };
    // P6: what the asker paid and each fee (the standard's receipts list fees; older ones carry router_fee_usd)
    var fees = Array.isArray(r.fees) ? r.fees : (r.router_fee_usd != null ? [{ kind: "router_fee", amount_usd: r.router_fee_usd }] : []);
    var FEE = { router_fee: "Service fee", pool_fee: "Pool fee", rail_fee: "Card fee", tax: "Tax" };
    var total = (Number(r.paid_usd) || 0) + fees.reduce(function (a, f) { return a + (Number(f.amount_usd || f.usd) || 0); }, 0);
    var rows = [["To you", unpaid ? "nothing (unpaid test)" : money(r.paid_usd)]]
      .concat(fees.length ? fees.map(function (f) { return [FEE[f.kind] || String(f.kind || "fee").replace(/_/g, " "), money(f.amount_usd || f.usd || "0")]; }) : [["Fees", "none"]])
      .concat([["The asker paid", money(total)]]);
    fill(main, h("section", { class: "screen" },
      h("h1", { class: "sentence" }, (day ? "On " + day + ", you " : "You ") + (DID[r.kind] || "took a call") + (stopped ? ", and stopped" : " and answered") + ", for " + askerName + "."),
      h("p", { class: "who" }, h("span", { class: "ai" }, "An AI asked."), " " + (at ? "Finished at " + at + "." : "")),
      changedBlock,
      (d.ask || r.ask) ? h("p", { class: "lede" }, h("span", { class: "label" }, "THE ASK "), "\u201C" + (d.ask || r.ask) + "\u201D") : null,
      h("div", { class: "facts" },
        h("div", { class: "fact" }, h("span", { class: "num" }, fmt(secs)), h("span", { class: "label" }, "YOUR TIME ON THE CALL")),
        h("div", { class: "fact" }, unpaid ? h("span", { class: "unpaid" }, "UNPAID TEST") : h("span", { class: "num" }, money(r.paid_usd)), h("span", { class: "label" }, unpaid ? "NOTHING PAID" : "PAID TO YOU")),
        (function () {   // the played numbers when the service keeps them beside the receipt; else the record's one word
        var hd = d.heard || {}, p = Number(hd.played_seconds), m = Number(hd.media_seconds), ss = Number(hd.seat_seconds);
        if (isFinite(p) && m > 0) return h("div", { class: "fact" }, h("span", { class: "num small played" }, fmt(p), h("span", { class: "of" }, " of " + fmt(m))), h("span", { class: "label" }, "PLAYED"));
        if (ss > 0) return h("div", { class: "fact" }, h("span", { class: "num small" }, fmt(ss)), h("span", { class: "label" }, "ON YOUR SCREEN"));
        return h("div", { class: "fact" }, h("span", { class: "num small" }, ({ attended: "played through", said: "answer only", voiced: "spoken" })[r.evidence] || r.evidence || "\u2014"), h("span", { class: "label" }, "WHAT THE RECORD SHOWS"));
      })()),
      (function () { var t = (r.evidence || d.heard) ? evidenceNote(r.evidence, d.heard, true) : ""; return t ? h("p", { class: "note" }, t) : null; })(),
      // money: on an unpaid test with no fees, one plain line; the lines themselves folded beneath (P6: each line still there)
      (unpaid && r.test_money && !fees.some(function (f) { return Number(f.amount_usd || f.usd) > 0; }))
        ? h("div", { class: "block" }, h("p", { class: "label" }, "MONEY"),
            h("p", null, "Nothing was paid to you, and the asker was charged nothing: this was an unpaid test."),
            h("details", { class: "tech money" }, h("summary", null, "The money, line by line"),
              h("table", { class: "lines" }, rows.map(function (x, i) { return h("tr", { class: i === rows.length - 1 ? "total" : null }, h("td", null, x[0]), h("td", null, x[1])); })),
              h("p", { class: "note" }, "Fees are paid by the asker on top of your pay; nothing is ever taken from what you are paid.")))
        : h("div", { class: "block" }, h("p", { class: "label" }, "WHAT THE ASKER PAID"),
        h("table", { class: "lines" }, rows.map(function (x, i) { return h("tr", { class: i === rows.length - 1 ? "total" : null }, h("td", null, x[0]), h("td", null, x[1])); })),
        h("p", { class: "note" }, "Fees are paid by the asker on top of your pay; nothing is ever taken from what you are paid."),
        r.test_money ? h("p", { class: "note" }, "Nothing was charged to anyone: this was a test.") : null),
      h("div", { class: "block" }, h("p", { class: "label" }, "WHO CAN SEE THIS RECEIPT"),
        h("p", null, "It carries no name and not the words of your answer. You and the asker can see it. If you ever show it to anyone else, they can check that " + NET + " issued it and that nothing in it was changed."),
        h("details", { class: "tech" }, h("summary", null, "Check it yourself (technical)"),
        h("button", { class: "quiet", type: "button", onclick: function () { check(d.jws || d.receipt_text, checkOut, { good: "Valid. Signed with key " + keyId + "; not one character has changed.", bad: "Not valid: the signature does not match." }); } }, "Check the signature"),
        checkOut,
        h("button", { class: "quiet", type: "button", onclick: function () {
          var forged = signedText.replace(/"paid_usd":"([0-9.]+)"/, function (m0, v) { return '"paid_usd":"' + (Number(v) + 9).toFixed(2) + '"'; });
          if (d.jws) { var parts = d.jws.split("."); var pl = JSON.parse(b64d(parts[1])); pl.paid_usd = (Number(pl.paid_usd || 0) + 9).toFixed(2); forged = parts[0] + "." + b64e(JSON.stringify(pl)) + "." + parts[2]; }
          check(forged, tamperOut, { good: "Unexpected: a changed text passed. Tell us.", bad: "Not valid. With $9.00 added to the pay, the same signature fails, as it should." });
        } }, "See a changed copy fail"),
        tamperOut,
        h("details", null, h("summary", null, "The signed receipt"), h("pre", { class: "signed" }, d.jws || d.receipt_text || ""), d.jws ? h("p", { class: "note" }, "A JSON Web Signature (Ed25519). Its middle part is the receipt above; the key is published by the service.") : h("p", { class: "note mono-s" }, "signature " + d.signature), h("p", { class: "note mono-s" }, "key " + keyId)))),
      h("p", { class: "note" }, "Your record of this call: what was asked, your time and what you were paid." + (r.receipt_id ? " Receipt number " + r.receipt_id + "." : "")),
      h("button", { class: "quiet", type: "button", onclick: save }, "Download this receipt"),
      h("p", { class: "note" }, "A small file to keep on this device.")));
    var first = main.querySelector(".changed .ask, .sentence"); if (first) { first.setAttribute("tabindex", "-1"); first.focus({ preventScroll: true }); }
  }

  if (!/^rc_[a-z0-9]+$/.test(id)) { fill(main, h("section", { class: "screen" }, h("p", { class: "big" }, "No receipt here."), h("p", { class: "lede" }, "This link is missing its receipt."))); return; }
  // the member token comes only from this tab's hand-over, never from the address: a link with ?m= could plant someone
  // else's page here, and through it their membership into this phone's ring (trust's final read, W12)
  var mt = null;
  try { mt = sessionStorage.getItem("pt_member"); } catch (e) {}
  function viaMember() {
    if (!mt || !/^mt_[a-z0-9]+$/.test(mt)) return Promise.resolve(null);
    return fetch("/x/members/" + encodeURIComponent(mt) + "/receipts").then(function (r) { return r.ok ? r.json() : r.text().then(function () { return null; }); }).then(function (d) {
      var hit = d && (d.receipts || []).filter(function (x) { return x.receipt && x.receipt.receipt_id === id; })[0];
      return hit || null;
    }, function () { return null; });
  }
  // a way back to the person's own page of calls, when this tab came from it
  if (mt && /^mt_[a-z0-9]+$/.test(mt)) { var bar = document.querySelector("header.bar");
    if (bar) bar.appendChild(h("a", { class: "textlink back", href: "/m/" + encodeURIComponent(mt) }, "\u2190 Your calls")); }
  function viaHandOver() { try { var v = sessionStorage.getItem("pt_receipt_" + id); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  viaMember().then(function (d) {
    if (d) return render(d);
    d = viaHandOver(); if (d) return render(d);
    fill(main, h("section", { class: "screen" }, h("h1", { class: "big" }, "Open it from your page."),
      h("p", { class: "lede" }, "A receipt opens from your own page of calls (the link you joined with) or from the end of the call. There, tap the receipt.")));
  }).catch(function () { fill(main, h("section", { class: "screen" }, h("p", { class: "big" }, "Not loaded."), h("p", { class: "lede" }, "The call service did not answer. Try again in a minute."))); });
})();
