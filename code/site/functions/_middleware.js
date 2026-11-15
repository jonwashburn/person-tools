// Fills %%API%%, %%SITE%%, %%SPEC%%, %%RUN%% in text responses with the hosts that belong to the request's host
// (chief/DECISIONS.md D1: no host is typed anywhere). person.tools / www.person.tools -> api.person.tools etc.;
// askpeople-site.pages.dev (and any preview alias of it) -> askpeople-api.pages.dev etc.
const TEXT = /^(text\/|application\/(json|xml|javascript))/;
function hosts(h) {
  h = h.toLowerCase();
  if (h.includes('askpeople-site')) {
    return { SITE: h, API: 'askpeople-api.pages.dev', SPEC: 'askpeople-spec.pages.dev', RUN: 'askpeople-run.pages.dev' };
  }
  const base = h.replace(/^www\./, '');
  return { SITE: base, API: 'api.' + base, SPEC: 'spec.' + base, RUN: 'run.' + base };
}
// Every response, static or a function's: no framing by other sites, HTTPS only, no type sniffing (trust S1, S3, 14 Nov 12:37 PM CT)
const SECURITY = { 'Content-Security-Policy': "frame-ancestors 'none'", 'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin' };
function secure(res) { const out = new Response(res.body, res); for (const [k, v] of Object.entries(SECURITY)) out.headers.set(k, v); return out; }
export async function onRequest(ctx) {
  const res = await ctx.next();
  const ct = res.headers.get('content-type') || '';
  if (!TEXT.test(ct) || res.status === 304) return secure(res);
  const H = hosts(new URL(ctx.request.url).host);
  const body = (await res.text()).replace(/%%(API|SITE|SPEC|RUN)%%/g, (_, k) => H[k]);
  const out = new Response(body, res);
  out.headers.delete('content-length');
  out.headers.delete('etag');
  if (!/no-store/.test(res.headers.get('cache-control') || '')) out.headers.set('cache-control', 'public, max-age=60');   // a key answer stays no-store
  for (const [k, v] of Object.entries(SECURITY)) out.headers.set(k, v);
  return out;
}
