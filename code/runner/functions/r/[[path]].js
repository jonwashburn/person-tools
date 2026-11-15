import { withSecurity } from "../../lib/seat.js";

// /r/<receipt_id> : a receipt in plain words, with what the answer changed, and a check anyone can run.
export async function onRequest(context) {
  const { request, env } = context;
  const shell = await env.ASSETS.fetch(new Request(new URL("/receipt.html", request.url)));
  return withSecurity(new Response(shell.body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }));
}
