// OWNER_router_31 (the standard's 27.9, ASKS-25): run.person.tools/connect?brand=&state=&return=. The brand and the return are checked by
// the API before anything is drawn: a return off the brand's proved domain (or an unproved brand) is answered 400 here, with no redirect
// anywhere; otherwise the page itself (connect-page.html) is served and the person decides.
import { apiBase } from "../lib/seat.js";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export async function onRequestGet(context) {
  const { request, env } = context; const u = new URL(request.url);
  const brand = u.searchParams.get("brand") || "", ret = u.searchParams.get("return") || "";
  let ok = false, msg = "This connection link is not complete.";
  try {
    const r = await fetch(apiBase(request, env) + "/v1/connect/brand", { method: "POST", headers: { "Content-Type": "application/json", "X-Runner-Forwarded": "1" }, body: JSON.stringify({ brand, return: ret }) });
    const d = await r.json().catch(() => ({})); ok = r.ok; if (!ok) msg = (d && d.message) || msg;
  } catch (e) { msg = "The service did not answer. Try the link again in a minute."; }
  if (!ok) return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Not a valid connection link</title><link rel="stylesheet" href="/app.css"></head><body><main id="main"><section class="screen"><p class="label">NOT CONNECTED</p><p class="lede">This connection link is not valid, so nothing was connected and you are not sent anywhere.</p><p class="note">' + esc(msg) + '</p></section></main></body></html>',
    { status: 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  return env.ASSETS.fetch(new URL("/connect-page" + u.search, u.origin));
}
