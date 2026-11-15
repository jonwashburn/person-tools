import { forwardOffers, json } from "../../lib/seat.js";

// /o/<member_token> : the member's open offers, forwarded to the call service.
export async function onRequest(context) {
  if (context.request.method !== "GET") return json({ code: "read_only", message: "Offers are read-only here.", fixable: false }, 405);
  const t = [].concat(context.params.path || [])[0] || "";
  if (!/^[A-Za-z0-9._~-]{6,600}$/.test(t)) return json({ code: "bad_link", message: "This link is not complete.", fixable: false }, 400);
  return forwardOffers(context, t);
}
