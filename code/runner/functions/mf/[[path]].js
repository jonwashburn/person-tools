// /mf/<member_token>.webmanifest : a manifest whose start page is this member's own page, so the icon added to a phone's
// home screen opens their calls (an iPhone needs that step before it will let a page ring).
export async function onRequest(context) {
  const raw = [].concat(context.params.path || [])[0] || "";
  const t = raw.replace(/\.webmanifest$/, "");
  if (!/^mt_[a-z0-9]{4,80}$/.test(t)) return new Response("not found", { status: 404 });
  const m = {
    name: "person.tools: your calls", short_name: "Calls", start_url: "/m/" + t, scope: "/", display: "standalone",
    background_color: "#faf8f3", theme_color: "#1d1d1b",
    icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
            { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }],
  };
  return new Response(JSON.stringify(m), { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
