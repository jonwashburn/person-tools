import { forward, json } from "../../lib/seat.js";

// /s/<token>[/<op>...] : the phone's only way to the call service.
export async function onRequest(context) {
  const parts = [].concat(context.params.path || []);
  const token = parts[0] || "";
  if (!/^[A-Za-z0-9._~-]{6,600}$/.test(token)) return json({ code: "bad_link", message: "This link is not complete.", fixable: false }, 400);
  return forward(context, token, parts.slice(1).join("/"));
}
