import { openMedia, forward, json } from "../../lib/seat.js";

// /mx/<sealed> : material by its own sealed link (no seat token in the address). GET only; it opens that material and
// nothing else, so a build that reads its own address learns nothing it can use.
export async function onRequest(context) {
  const { request } = context;
  if (request.method !== "GET" && request.method !== "HEAD") return json({ code: "read_only", message: "Material links are read-only.", fixable: false }, 405);
  const sealed = [].concat(context.params.path || [])[0] || "";
  let d;
  try { d = await openMedia(context.env, sealed); } catch (e) { return json({ code: "link_expired", message: "This material link has expired. Open the call again.", fixable: false }, 410); }
  return forward(Object.assign({}, context, { viaSealed: true }), d.t, "media" + (d.m ? "/" + d.m : ""));
}
