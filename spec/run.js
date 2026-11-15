// The first page runs its own example: the same four steps, live, against the simulated pool of the reference server.
// No key is needed (a server MAY serve keyless calls on the simulated pool, s6 AUTH-5); if the server wants one, a free test
// key is made first (s18.1). Nothing here can reach a real person: the pool is "simulated".
(function () {
  const box = document.getElementById("live-run");
  if (!box) return;
  const qs = new URLSearchParams(location.search);
  function apiBase() {
    if (qs.get("api")) return qs.get("api").replace(/\/$/, "");
    const h = location.host;
    if (h.includes("askpeople-spec")) return "https://" + h.replace("askpeople-spec", "askpeople-api");
    if (h.startsWith("spec.")) return "https://api." + h.slice(5);
    return "https://askpeople-api.pages.dev";
  }
  const API = apiBase();
  const btn = box.querySelector("button");
  const out = box.querySelector(".live-out");
  const status = box.querySelector(".live-status");
  let key = null;

  function step(title, req, res, ms) {
    const s = document.createElement("section");
    s.className = "live-step";
    const h = document.createElement("p");
    h.className = "label";
    h.textContent = title + (ms != null ? " · " + ms + " ms" : "");
    s.appendChild(h);
    if (req) { const p = document.createElement("pre"); p.className = "req"; p.textContent = req; s.appendChild(p); }
    const r = document.createElement("pre");
    r.textContent = typeof res === "string" ? res : JSON.stringify(res, null, 2);
    s.appendChild(r);
    out.appendChild(s);
    s.scrollIntoView({ block: "nearest" });
  }
  async function call(method, path, body) {
    let r = await call1(method, path, body);
    if (r.status === 401 && !key) {
      const k = await call1("POST", "/v1/keys", { class: "test" });
      step("A free test key (POST /v1/keys), because the server asked for one", 'POST /v1/keys {"class":"test"}',
           Object.assign({}, k.body, { key: k.body.key ? k.body.key.slice(0, 9) + "…" : undefined }), k.ms);
      key = k.body.key || null;
      if (key) r = await call1(method, path, body);
    }
    return r;
  }
  async function call1(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    if (key) headers["Authorization"] = "Bearer " + key;
    const t = performance.now();
    const r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let j; try { j = await r.json(); } catch (e) { j = { note: "not JSON", status: r.status }; }
    return { status: r.status, body: j, ms: Math.round(performance.now() - t) };
  }
  const CALL = {
    ask: "Listen once. Then tell me what you felt, in your own words.",
    kind: "listen", content: "m_sample_melody30", people: 3,
    answer_fields: { felt: "text", would_play_again: "boolean" }
  };
  btn.addEventListener("click", async () => {
    btn.disabled = true; out.textContent = ""; key = null; status.textContent = "Running against " + API + " …";
    try {
      const q = await call("POST", "/v1/quotes", CALL);
      step("1. The price (POST /v1/quotes) · HTTP " + q.status, "POST /v1/quotes " + JSON.stringify(CALL), q.body, q.ms);
      if (q.status >= 400) throw new Error("the quote failed");
      const body = Object.assign({}, CALL, { max_total_usd: "0.00", idempotency_key: "spec-page-" + Math.random().toString(36).slice(2, 12) });
      const c = await call("POST", "/v1/calls", body);
      step("2. The call opens (POST /v1/calls) · HTTP " + c.status, "POST /v1/calls { …the same…, \"max_total_usd\": \"0.00\", \"idempotency_key\": \"" + body.idempotency_key + "\" }", c.body, c.ms);
      if (!c.body.call_id) throw new Error("no call_id came back");
      let done = false, n = 0, last = null;
      while (!done && n < 10) {
        n++;
        const r = await call("GET", "/v1/calls/" + encodeURIComponent(c.body.call_id) + "/responses?wait_seconds=20");
        last = r;
        done = !!r.body.complete || r.status >= 400;
        status.textContent = "Fetch " + n + ": " + (r.body.status || r.status) + (done ? "" : ", looking again in " + (r.body.next_check_after_seconds || 3) + " s");
        if (!done) await new Promise(res => setTimeout(res, 1000 * Math.min(r.body.next_check_after_seconds || 3, 10)));
      }
      step("3. The answers (GET /v1/calls/{id}/responses) · HTTP " + last.status, "GET /v1/calls/" + c.body.call_id + "/responses?wait_seconds=20", last.body, last.ms);
      status.textContent = done ? "Done. Every answer above came from simulated people, and says so." : "Still running; the call keeps going on the server.";
    } catch (e) {
      status.textContent = "It did not complete: " + e.message + ". The reference server at " + API + " may not be running this part yet.";
    } finally { btn.disabled = false; }
  });
})();
