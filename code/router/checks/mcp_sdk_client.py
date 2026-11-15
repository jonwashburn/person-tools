#!/usr/bin/env python3
"""A real MCP client against the live server: the official MCP Python SDK (mcp 2.x), holding only our address and,
for the keyed runs, a fresh free test key from POST /v1/keys. It lists the tools, opens the canon's first call with
ask_people, and reads ask_people_results until the call is complete; the SDK itself checks every structured result
against the tool's outputSchema. Simulated people only. The key is never printed.

usage: mcp_sdk_client.py [API]      (default https://askpeople-api.pages.dev)    exit 1 on any FAIL
Needs the mcp (2.x) and httpx packages.
"""
import asyncio, json, os, sys, time, uuid
import httpx
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from mcp.shared._httpx_utils import create_mcp_http_client

API = (sys.argv[1] if len(sys.argv) > 1 else "https://askpeople-api.pages.dev").rstrip("/")
FAILS = []
# OWNER_router_5: our own check says so (the team's check header, from the caller's environment; never printed), so its key and
# its keyless calls count as ours, never as an outsider's
TEAM = {"x-hc-team-check": os.environ["HC_TEAM_CHECK"]} if os.environ.get("HC_TEAM_CHECK") else {}

def line(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else "  :: " + str(detail)[:300]), flush=True)
    if not ok: FAILS.append(name)
    return ok

def structured(r):
    if getattr(r, "structured_content", None) is not None: return r.structured_content
    if getattr(r, "structuredContent", None) is not None: return r.structuredContent
    for c in (r.content or []):
        t = getattr(c, "text", None)
        if t:
            try: return json.loads(t)
            except Exception: pass
    return {}

async def road(label, mode, key):
    headers = {**TEAM, **({"Authorization": "Bearer " + key} if key else {})}
    transport = streamable_http_client(API + "/mcp", http_client=create_mcp_http_client(headers=headers))
    t0 = time.time()
    async with Client(transport, mode=mode, raise_exceptions=True) as client:
        tools = await client.list_tools()
        names = sorted(t.name for t in tools.tools)
        if not line(f"{label}: the SDK connects and lists the tools ({len(names)})", "ask_people" in names and "ask_people_results" in names, names): return
        first = {"ask": "Listen once. Then tell me what you felt, in your own words.", "kind": "listen", "content": "m_sample_melody30",
                 "people": 3, "max_total_usd": "0.00", "pool": "simulated",
                 # a fresh key per run: without one, the same body from the same address within 10 minutes is a retry and
                 # rightly returns the earlier call (the baseline runs this every deploy)
                 "idempotency_key": "sdk-" + uuid.uuid4().hex[:12]}
        r = await client.call_tool("ask_people", first)
        sc = structured(r)
        err = getattr(r, "is_error", None)
        if err is None: err = getattr(r, "isError", False)
        if not line(f"{label}: ask_people opens a call on the first try", not err and bool(sc.get("call_id")) and sc.get("repeated") is not True, sc): return
        call_id = sc.get("call_id")
        line(f"{label}: the call says it is simulated", sc.get("simulated") is True, sc)
        res = {}
        while time.time() - t0 < 120:
            rr = await client.call_tool("ask_people_results", {"call_id": call_id})
            res = structured(rr)
            if getattr(rr, "is_error", False) or getattr(rr, "isError", False): line(f"{label}: ask_people_results answers", False, res); return
            if res.get("status") in ("complete", "closed") or res.get("complete") is True: break
            await asyncio.sleep(min(5, max(1, (res.get("next_check_after_seconds") or 2))))
        resp = res.get("responses") or []
        line(f"{label}: results complete with three simulated answers", (res.get("status") in ("complete", "closed") or res.get("complete") is True) and len(resp) == 3, {k: res.get(k) for k in ("status", "complete", "summary")})
        txt = " ".join(c.text for c in (rr.content or []) if getattr(c, "text", None))
        line(f"{label}: the text an agent reads says the answers are simulated", "SIMULATED" in txt.upper(), txt[:200])
        print(f"NOTE {label}: protocol {getattr(client.session, 'protocol_version', '?')}, {round(time.time() - t0, 1)} s, call {call_id}", flush=True)

def fresh_key():
    r = httpx.post(API + "/v1/keys", json={}, headers=TEAM, timeout=30)
    key = r.json().get("key") if r.status_code == 201 else None
    line("a free test key from POST /v1/keys", bool(key), r.status_code)
    return key

async def main():
    # each road its own key, so each opens its own call (the same body from one principal within 10 minutes is a retry)
    for label, mode, k in (("SDK auto, test key", "auto", fresh_key()), ("SDK legacy handshake, test key", "legacy", fresh_key()), ("SDK auto, no key", "auto", None)):
        for attempt in (1, 2):   # a transport error (not a wrong answer) is tried once more, and said
            try: await road(label, mode, k); break
            except Exception as e:
                inner = e
                while getattr(inner, "exceptions", None): inner = inner.exceptions[0]   # unwrap an ExceptionGroup to its cause
                why = f"{type(inner).__name__}: {str(inner)[:200]}"
                if attempt == 1: print(f"NOTE {label}: retried once after {why}", flush=True); await asyncio.sleep(5)
                else: line(f"{label}: no exception", False, why)

asyncio.run(main())
sys.exit(1 if FAILS else 0)
