// Runs the person's service worker (public/sw.js) on one push with a stand-in /o/ and /x/ reply, and prints the
// notification it shows as JSON. usage: node ring_words_harness.js <sw.js> <case.json>
// case.json: { "member": "mt_x" | null, "offers": {...} | null, "receipts": {...} | null }
const fs = require("fs");
const [swPath, casePath] = process.argv.slice(2);
const c = JSON.parse(fs.readFileSync(casePath, "utf8"));
const listeners = {};
let shown = null;
const store = new Map();
if (c.member) store.set("/__member", c.member);
const resp = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
global.self = {
  addEventListener: (t, f) => { listeners[t] = f; },
  skipWaiting: () => {}, clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => {} },
  registration: { showNotification: async (title, opts) => { shown = { title, body: (opts && opts.body) || "", url: opts && opts.data && opts.data.url || "" }; } },
};
global.caches = { open: async () => ({ match: async (k) => (store.has(k) ? resp(store.get(k)) : undefined), put: async (k, v) => { store.set(k, await v.text()); } }) };
global.Response = function (b) { this.b = b; this.text = async () => String(b); this.json = async () => JSON.parse(String(b)); };
global.fetch = async (u) => {
  if (String(u).startsWith("/o/")) return c.offers ? resp(c.offers) : { ok: false, status: 404, json: async () => ({}) };
  if (String(u).includes("/receipts")) return c.receipts ? resp(c.receipts) : { ok: false, status: 404, json: async () => ({}) };
  return { ok: false, status: 404, json: async () => ({}) };
};
eval(fs.readFileSync(swPath, "utf8"));
const waits = [];
listeners.push({ waitUntil: (p) => waits.push(p), data: null });
Promise.all(waits).then(() => { process.stdout.write(JSON.stringify(shown) + "\n"); }, (e) => { process.stdout.write(JSON.stringify({ error: String(e) }) + "\n"); });
