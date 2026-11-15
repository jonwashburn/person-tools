import { json } from "../lib/seat.js";

// /push-key : the public half of the key our pushes are signed with (VAPID). Public by design; the private half is a
// secret of the call service only.
export async function onRequest(context) {
  const k = context.env.VAPID_PUBLIC_KEY;
  if (!k) return json({ code: "push_not_ready", message: "Ringing a phone is not switched on yet.", fixable: false }, 404);
  return json({ key: k });
}
