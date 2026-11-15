// POST /demo-key: a key for the front page's own demo call (pool "self": it rings the visitor's own browser with one of a
// few fixed asks). Router mints it server side at POST /internal/keys/demo (router 14 Nov 2026, 4:41 AM CT; the chief's
// 04:25 ruling: pool "self" only for keys the front page mints). The DEMO_MINT_TOKEN secret stays here and never reaches
// the browser. The answer is never cached. The visitor's address goes along so router can limit per visitor.
function apiHost(h) {
  h = h.toLowerCase();
  if (h.includes('askpeople-site')) return 'askpeople-api.pages.dev';
  return 'api.' + h.replace(/^www\./, '');
}
const NOSTORE = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const answer = (status, obj, extra) => new Response(JSON.stringify(obj), { status, headers: { ...NOSTORE, ...(extra || {}) } });

export async function onRequest(ctx) {
  if (ctx.request.method !== 'POST') return answer(405, { code: 'method_not_allowed', message: 'POST only.', fixable: false }, { allow: 'POST' });
  // Only this site's own pages may ask (trust S5, 14 Nov 2:44 PM CT): a browser sent here by another site says so in
  // Sec-Fetch-Site or Origin, and is refused; a request with neither (a script, curl) cannot be forged by another site.
  const sfs = ctx.request.headers.get('sec-fetch-site'); const origin = ctx.request.headers.get('origin');
  const host = new URL(ctx.request.url).host;
  let foreign = !!(sfs && sfs !== 'same-origin');
  if (!foreign && origin) { try { foreign = new URL(origin).host !== host; } catch (e) { foreign = true; } }
  if (foreign) return answer(403, { code: 'forbidden', message: "Demo keys are made only for this site's own pages.", fixable: false });
  const tok = ctx.env.DEMO_MINT_TOKEN;
  if (!tok) return answer(503, { code: 'not_open', message: 'The demo call is not open right now. A free test key (POST /v1/keys on the API) still makes simulated calls.', fixable: false });
  const visitor = ctx.request.headers.get('cf-connecting-ip') || '';
  const team = ctx.request.headers.get('x-hc-team-check');   // the team's own checks (router 5:53 AM CT): passed on unchanged; router decides
  let r;
  try {
    r = await fetch('https://' + apiHost(new URL(ctx.request.url).host) + '/internal/keys/demo', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json', 'user-agent': 'askpeople-site/demo-key', 'x-forwarded-for': visitor, 'x-hc-visitor-ip': visitor, ...(team ? { 'x-hc-team-check': team } : {}) },   // x-hc-visitor-ip: a custom header Cloudflare leaves as sent
      body: '{}',
    });
  } catch (e) {
    return answer(502, { code: 'upstream_unavailable', message: 'The API did not answer; try again in a minute.', fixable: false });
  }
  const body = await r.text();
  return new Response(body, { status: r.status, headers: NOSTORE });
}
