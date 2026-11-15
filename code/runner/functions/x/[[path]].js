import { forwardTo, json, fromOwnPage } from "../../lib/seat.js";
import { NOTICE_ID } from "../../lib/notice_id.js";

// /x/<api path> : the few call-service operations a person's own pages use, forwarded so the phone talks only to this
// address. Anything not on this list is refused.
const ALLOW = [
  ["POST", /^receipts\/verify$/],
  ["GET", /^members\/mt_[a-z0-9]{4,80}\/(offers|receipts|tasks)$/],
  ["POST", /^members\/mt_[a-z0-9]{4,80}\/tasks\/tk_[a-z0-9]{4,80}$/],   // OWNER_all_7: the person answers a task
  ["GET", /^members\/mt_[a-z0-9]{4,80}\/tasks\/tk_[a-z0-9]{4,80}\/media$/],   // OWNER_all_8: the piece a person checks, played in this page only
  ["POST", /^members\/mt_[a-z0-9]{4,80}\/(on|leave|delete|settings|push|feedback)$/],
  // OWNER_all_10 B and C: the person's own AIs, from this page (connect, list, quiet, revoke, a new signing secret, the AI's picture)
  ["GET", /^members\/mt_[a-z0-9]{4,80}\/connections$/],
  ["GET", /^members\/mt_[a-z0-9]{4,80}\/blocks$/],   // OWNER_router_4 item 1
  ["POST", /^members\/mt_[a-z0-9]{4,80}\/blocks$/],
  ["DELETE", /^members\/mt_[a-z0-9]{4,80}\/blocks\/bk_[a-z0-9]{4,80}$/],
  ["POST", /^members\/mt_[a-z0-9]{4,80}\/connections$/],
  ["DELETE", /^members\/mt_[a-z0-9]{4,80}\/connections\/cn_[a-z0-9]{4,80}$/],
  ["POST", /^members\/mt_[a-z0-9]{4,80}\/connections\/cn_[a-z0-9]{4,80}\/(quiet|block|secret)$/],
  ["GET", /^members\/mt_[a-z0-9]{4,80}\/connections\/cn_[a-z0-9]{4,80}\/icon$/],
  // OWNER_router_10: passkey accounts and the admin console, through this page's own address (the credential in the header)
  ["POST", /^account\/(start|passkey\/options|passkey|login\/options|login|logout|memberships)$/],
  ["GET", /^account$/],
  ["GET", /^admin\/[a-z0-9_\/]{2,120}$/],
  ["POST", /^admin\/[a-z0-9_\/]{2,120}$/],
  ["DELETE", /^admin\/[a-z0-9_\/]{2,120}$/],
  ["GET", /^join\/jc_[a-z0-9]{4,80}$/],
  ["POST", /^join\/jc_[a-z0-9]{4,80}$/],
  ["POST", /^arrivals\/ar_[A-Za-z0-9_\-.]{8,600}$/],   // a person an outside panel sent (the /p/ page)
];
// A stand-in join code and member, so the join road can be seen on live before any real panel exists (no data kept).
async function standin(context, p, m) {
  const STANDIN_NAME = "team-test (a stand-in panel for checking the page)";
  if (/^join\/jc_standin[a-z0-9]*$/.test(p)) {
    if (m === "GET") return json({ panel: { name: STANDIN_NAME, members: 3, anonymous: false }, notice_id: NOTICE_ID, standin: true });
    if (m === "POST") {
      let b = {}; try { b = await context.request.json(); } catch (e) {}
      if (b.adult !== true || b.notice_accepted !== true) return json({ code: "adult_required", message: "Only adults may join. Confirm you are 18 or older.", fixable: true }, 400);
      const t = "standin-member" + crypto.randomUUID().replace(/-/g, "").slice(0, 10);
      return json({ member_token: t, page: "/m/" + t, panel: STANDIN_NAME, on: "off", note: "A stand-in: nothing about you was kept.", standin: true }, 201);
    }
  }
  const mm = /^members\/(standin-[a-z0-9-]+)\/(offers|receipts|on|settings|leave|push|feedback)$/.exec(p);
  if (mm) {
    let b = {}; if (m === "POST") { try { b = await context.request.json(); } catch (e) {} }
    if (mm[2] === "receipts") return json({ receipts: [], standin: true });
    if (mm[2] === "feedback") return json({ stored: false, note: "A stand-in member: nothing you wrote was kept.", standin: true });
    if (mm[2] === "on") { const h = b.on ? Math.min(12, Number(b.hours) || 2) : 0; return json({ on: h ? "on_until" : "off", on_until: h ? new Date(Date.now() + h * 3600e3).toISOString() : null, standin: true }); }
    if (mm[2] === "settings") return json({ quiet: { start: b.quiet_start ?? 21, end: b.quiet_end ?? 8, tz: b.tz || "America/Chicago" }, settings: { longer_hold: !!(b.longer_to_answer || b.screen_reader) }, standin: true });
    if (mm[2] === "leave") return json({ left: true, deleted: { answers: 0, records: 0, receipts: 0 }, kept: "Nothing: this was a stand-in.", standin: true });
    if (mm[2] === "push") return json({ stored: false, note: "A stand-in member cannot be rung.", standin: true });
  }
  return null;
}

export async function onRequest(context) {
  const p = [].concat(context.params.path || []).join("/");
  const m = context.request.method;
  if (/standin/.test(p)) { if (!fromOwnPage(context.request)) return json({ code: "not_from_this_page", message: "Only this site's own pages can do that.", fixable: false }, 403); const r = await standin(context, p, m); if (r) return r; }
  if (!fromOwnPage(context.request)) return json({ code: "not_from_this_page", message: "Only this site's own pages can do that.", fixable: false }, 403);
  if (!ALLOW.some(([meth, re]) => meth === m && re.test(p))) return json({ code: "not_allowed", message: "Not an operation this page uses.", fixable: false }, 404);
  return forwardTo(context, "/v1/" + p, "");
}
