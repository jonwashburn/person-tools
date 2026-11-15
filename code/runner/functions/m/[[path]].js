import { withSecurity } from "../../lib/seat.js";

// /m/<member_token> : a member's own page ("Calls for you").
export async function onRequest(context) {
  const { request, env } = context;
  const shell = await env.ASSETS.fetch(new Request(new URL("/member.html", request.url)));
  return withSecurity(new Response(shell.body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }));
}
