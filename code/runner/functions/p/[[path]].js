import { withSecurity } from "../../lib/seat.js";

// /p/<ar_token>?pid=...&study=...&session=... : where an outside panel (Prolific) sends a person. One static shell; the page
// reads its own address, registers the arrival through /x (server to server), clears the panel's ids from the address bar
// and goes to the person's seat.
export async function onRequest(context) {
  const { request, env } = context;
  const shell = await env.ASSETS.fetch(new Request(new URL("/arrive.html", request.url)));
  return withSecurity(new Response(shell.body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }));
}
