import { withSecurity } from "../../lib/seat.js";

// /j/<join_code> : join a panel in under a minute (the tester notice, the adult statement, quiet hours; you start Off).
export async function onRequest(context) {
  const { request, env } = context;
  const shell = await env.ASSETS.fetch(new Request(new URL("/join.html", request.url)));
  return withSecurity(new Response(shell.body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }));
}
