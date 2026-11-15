import { withSecurity } from "../../lib/seat.js";

// /c/<seat_token> : the call page. One static shell; the token is read by the page from its own address.
export async function onRequest(context) {
  const { request, env } = context;
  const shell = await env.ASSETS.fetch(new Request(new URL("/call.html", request.url)));
  return withSecurity(new Response(shell.body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }));
}
