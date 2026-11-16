import { forwardTo, json, fromOwnPage } from "../../lib/seat.js";

// /xp/<api path> (OWNER_router_18): a person's own people, from their own page: list them, send them asks, read what came back, pass an
// ask on, mute, the one-time notice, the daily limit. Forwarded like /x, so the page talks only to this address; a relay of its own, so
// the call relay is never changed for it. Anything not on this list is refused.
const ALLOW = [
  ["GET", /^members\/mt_[a-z0-9]{4,80}\/(people|sent|mutes|limits|settings)$/],
  ["GET", /^members\/mt_[a-z0-9]{4,80}\/tasks\/tk_[a-z0-9]{4,80}\/alert$/],   // OWNER_router_25: the first line, only when the person turned it on
  ["POST", /^members\/mt_[a-z0-9]{4,80}\/(people\/asks|people\/links|people\/notice|mutes|limits)$/],
  ["DELETE", /^members\/mt_[a-z0-9]{4,80}\/mutes\/mu_[a-z0-9]{4,80}$/],
  ["POST", /^members\/mt_[a-z0-9]{4,80}\/sent\/tk_[a-z0-9]{4,80}\/notes$/],
  ["POST", /^members\/mt_[a-z0-9]{4,80}\/sent\/read$/],
  ["POST", /^members\/mt_[a-z0-9]{4,80}\/tasks\/tk_[a-z0-9]{4,80}\/pass$/],
];
export async function onRequest(context) {
  const p = [].concat(context.params.path || []).join("/");
  const m = context.request.method;
  if (!fromOwnPage(context.request)) return json({ code: "not_from_this_page", message: "Only this site's own pages can do that.", fixable: false }, 403);
  if (!ALLOW.some(([meth, re]) => meth === m && re.test(p))) return json({ code: "not_allowed", message: "Not an operation this page uses.", fixable: false }, 404);
  return forwardTo(context, "/v1/" + p, "");
}
