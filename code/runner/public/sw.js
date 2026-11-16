/* the person\'s side: the ring. The service pushes with no words in it; this worker asks our own page what is on offer and shows
   only "A call for you: N minutes, $X" or "An unpaid test call: N minutes", or for an urgent ask "An ask is waiting" and who it is from.
   An asker's words never reach a lock screen. */
var STORE = "pt-member";
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener("message", function (e) {
  var d = e.data || {};
  if (d.type === "member" && /^mt_[a-z0-9]+$/.test(d.token || "")) e.waitUntil(caches.open(STORE).then(function (c) { return c.put("/__member", new Response(d.token)); }));
});
function memberToken() { return caches.open(STORE).then(function (c) { return c.match("/__member"); }).then(function (r) { return r ? r.text() : null; }); }
function unpaid(p) { return !p || (typeof p === "string" ? /unpaid/i.test(p) || Number(p) === 0 : (p.unpaid_test || Number(p.per_person_usd || 0) === 0)); }
self.addEventListener("push", function (e) {
  e.waitUntil(memberToken().then(function (t) {
    var title = "A call for you", body = "Open to see who is asking, how long it takes and what it pays.", url = t ? "/m/" + t : "/", tag = "pt-call", silent = false;
    var work = !t ? Promise.resolve() : fetch("/o/" + t, { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (d) {
      silent = d.silent === true;   // OWNER_router_6: the person chose no sounds
      var o = (d.offers || []).filter(function (x) { return (x.state || "offered") === "offered"; })[0];
      if (!o && d.on === "off" && Number(d.missed_rings) >= 2) {   // P2: two unanswered rings switched the person Off; say so once
        title = "You are switched Off"; body = "Two calls went unanswered, so no more will ring until you switch On. Nothing counts against you.";
        url = "/m/" + t; tag = "pt-off-missed"; return;
      }
      if (!o) {
        // no call waiting: an urgent ask rings too (a person's, an AI's, one passed on): say an ask is waiting, never its words
        return fetch("/x/members/" + t + "/tasks?history=0", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (td) {
          var a = (td.open || []).filter(function (x) { return x.state === "open" && x.urgency === "now"; })[0];
          if (!a) return null;
          title = "An ask is waiting"; body = "From " + (a.passed_on_by ? a.from + ", passed on by " + a.passed_on_by : a.from || "one of your asks") + ". Open your page to read it.";
          url = "/m/" + t; tag = "pt-ask-" + a.task_id;
          // OWNER_router_25: the ask's first line, only if the person turned on "Show the ask in my alerts" (never in the push itself)
          return fetch("/xp/members/" + t + "/tasks/" + a.task_id + "/alert", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }, function () { return null; })
            .then(function (al) { if (al && al.line) { title = body.replace(/\. Open your page to read it\.$/, ""); body = al.line; } return true; });
        }, function () { return null; }).then(function (asked) {
          if (asked) return;
        // no call and no urgent ask: perhaps an asker has said what an answer changed (P8). Tell the person, without its words.
        return fetch("/x/members/" + t + "/receipts", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (rd) {
          return caches.open(STORE).then(function (c) { return c.match("/__seen").then(function (m) { return m ? m.json() : []; }).then(function (seen) {
            var fresh = (rd.receipts || []).filter(function (x) { return x.what_changed && x.receipt && seen.indexOf(x.receipt.receipt_id) < 0; });
            if (!fresh.length) { title = "A call came and went"; body = "Someone else took it, or it ended. Nothing counts against you."; return; }
            var rc = fresh[fresh.length - 1].receipt;
            title = "What the answers changed"; body = "The asker said what it did with the answers, yours included. Tap to read it.";
            url = "/m/" + t; tag = "pt-changed-" + rc.receipt_id;   // the person's page leads with the line, marked NEW (a receipt opens only from that page)
            return c.put("/__seen", new Response(JSON.stringify(seen.concat(fresh.map(function (x) { return x.receipt.receipt_id; })))));
          }); });
        });
        });
      }
      var mins = o.minutes || "?";
      var amount = typeof o.pay === "string" ? o.pay : o.pay && o.pay.per_person_usd;
      title = unpaid(o.pay) ? "An unpaid test call: " + mins + " minutes" : "A call for you: " + mins + " minutes, $" + Number(amount).toFixed(2);
      body = "Tap to see what is asked, and by whom.";
      var st = o.seat_token || (o.seat_url ? String(o.seat_url).split("/c/")[1] : "");
      if (st) url = "/c/" + st;
      tag = "pt-" + (o.seat_id || String(st).slice(0, 24));
    }).catch(function () {});
    return work.then(function () {
      return self.registration.showNotification(title, { body: body, tag: tag, renotify: true, silent: silent, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { url: url } });
    });
  }));
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (all) {
    for (var i = 0; i < all.length; i++) { if ("focus" in all[i]) { all[i].navigate(url); return all[i].focus(); } }
    return self.clients.openWindow(url);
  }));
});
