// Universal links for the person's iPhone app (the owner, 11:13 PM CT 14 Nov 2026): a /j/, /m/ or /c/ link opens the app when
// it is installed, and this site's page when it is not. Served at /.well-known/apple-app-site-association (Pages does not
// route a folder whose name starts with a dot, so the first segment is a parameter and anything but ".well-known" passes on).
// The app id is <Apple team id>.tools.person.app; the team id (public: every app's file shows it) is APPLE_TEAM_ID on this
// project, set by the owner 11:58 PM CT 14 Nov. Without it, 404, and links open the pages as they always have.
export async function onRequestGet({ params, env, next }) {
  if (params.wk !== '.well-known') return next();
  const team = String((env && env.APPLE_TEAM_ID) || '').trim();
  if (!/^[A-Z0-9]{10}$/.test(team)) return new Response('Not set yet.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  const body = { applinks: { details: [{ appIDs: [team + '.tools.person.app'], components: [{ '/': '/j/*' }, { '/': '/m/*' }, { '/': '/c/*' }] }] } };
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });
}
