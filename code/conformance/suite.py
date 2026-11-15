#!/usr/bin/env python3
"""Conformance suite for the call-server standard, version 0.1 (draft).

Written from the standard's text (spec/src/*.md) and nothing else. Run it against any call server:

    code/conformance/run <base_url> [--key test_...] [--only ID,...] [--profile fair-call] [--json out.json] [--no-mcp]

Every check prints `PASS|FAIL|SKIP <check id> <requirement ids> <one line>`. Exit status 0 only when nothing FAILs.
A pass may claim exactly what section 25 of the text allows, and nothing more.
"""
import argparse
import asyncio
import base64
import json
import math
import os
import random
import re
import string
import sys
import time
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation

import httpx

SUITE_VERSION = "0.1.0-draft.1"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SPEC_SRC = os.path.join(ROOT, "spec", "src")

# ---------------------------------------------------------------------------------------------------------------
# Registries (section 24)
KINDS = ["listen", "watch", "view", "play", "compare", "answer"]
FIELD_TYPES = ["text", "boolean", "number", "choice", "scale"]
INPUTS = ["typed", "pasted", "mixed", "spoken", "tapped"]
CALL_STATES = ["held", "open", "enough", "complete", "expired", "cancelled", "refused"]
TERMINAL = {"complete", "expired", "cancelled", "refused"}
SEAT_STATES = ["offered", "taken", "answered", "stopped", "declined", "missed", "withdrawn"]
LEVELS = ["said", "attended", "voiced"]
UNOBSERVED = ["audible", "eyes_on_screen", "unassisted_answer", "same_person"]
QUOTE_LINES = ["to_people", "pool_fee", "router_fee", "rail_fee", "reserve", "tax"]
CATEGORIES = ["credentials", "accounts", "paid_engagement", "impersonation", "third_party_contact", "personal_data",
              "off_platform", "sexual", "minors", "ban_evasion", "deception", "physical_world", "outside_material",
              "sensitive_data", "unpaid_screener", "voice_misuse", "call_terms", "violent", "medical", "grief"]
FEATURES = ["keyless", "url_content", "media_upload", "outcome", "voice", "panels"]
LIMIT_DEFAULTS = {"max_people": 50, "max_deadline_minutes": 10080, "max_wait_seconds": 20, "stop_minimum_usd": "0.00"}
ERROR_CODES = {
    "invalid_json": (400, True), "missing_field": (400, True), "invalid_field": (400, True),
    "unknown_field": (400, True), "unauthorized": (401, True), "forbidden_for_key_class": (403, True),
    "not_found": (404, False), "idempotency_key_reused": (409, True), "over_max_total_usd": (400, True),
    "over_key_cap": (402, False), "insufficient_balance": (402, False), "below_pay_floor": (400, True),
    "unknown_pool": (400, True), "unknown_selector": (400, True), "selector_unsupported": (400, True),
    "privacy_floor": (400, True), "content_unavailable": (400, True), "unsupported_feature": (400, True),
    "refused_screening": (422, None), "call_finished": (409, False), "version_unsupported": (400, True),
    "rate_limited": (429, False), "internal": (500, False), "content_too_large": (413, True),
    "outcome_not_allowed": (409, False),
}
# Observed fields per kind (section 10)
OBS_COMMON = ["seat_seconds", "device"]
OBS_KIND = {
    "listen": ["media_seconds", "played_seconds", "realtime_seconds", "stalled_seconds", "visible_fraction", "pauses",
               "replays", "seeks_forward", "completed"],
    "watch": ["media_seconds", "played_seconds", "realtime_seconds", "stalled_seconds", "visible_fraction", "pauses",
              "replays", "seeks_forward", "completed", "muted_fraction"],
    "view": ["revealed", "visible_seconds", "scrolled_fraction"],
    "play": ["session_seconds", "input_count", "ended"],
    "compare": ["order", "items"],
    "answer": [],
}
OFFER_KEYS = ["answered_for", "asker_is_ai", "ask", "kind", "minutes", "pay_per_person_usd", "pay_per_hour_usd", "unpaid",
              "content_rating", "recorded", "kept_days", "download_bytes", "may_train_on_answers", "panel_size"]
RECEIPT_FIELDS = ["receipt_id", "iss", "rev", "issued_at", "call_ref", "answered_for", "kind", "seat_status",
                  "evidence", "minutes", "paid_usd", "unpaid", "fees", "simulated", "test_money", "outcomes"]
MONEY_RE = re.compile(r"^\d+\.\d{2}$")
TIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# Requirement ids no black-box check can test, with the reason (traceability).
UNTESTED = {
    "CONV-3": "a rule for clients, not servers",
    "CONV-4": "how text is shown to a person happens in the runner, which an agent cannot see",
    "VER-3": "needs twelve months and a successor version",
    "AUTH-3": "whether a real person was offered a seat is not visible to an agent; every test-key response is checked "
              "to be simulated instead (C01, X10)",
    "MONEY-3": "the basis of an estimate is the server's own knowledge",
    "EVID-1": "what the runner claimed is not visible to an agent; EVID-2 recomputation covers the outcome",
    "RCPT-2": "the person's view of their receipts is not reachable with an agent's key",
    "PEOPLE-1": "whether a person stated they are adult is not visible; the minors refusal is checked in S01",
    "PEOPLE-2": "simulated people are generated per call, so the same person cannot be met twice from outside",
    "PEOPLE-4": "needs a panel, which a test key cannot make",
    "PEOPLE-6": "the privacy floor applies to pools of strangers, which a test key cannot reach",
    "SCREEN-4": "a held real call needs a live key; its simulated mirror (would_be_held) is checked in S01",
    "HTTP-3": "provoking a rate limit needs load, which the team rules forbid",
    "CALL-5": "copying before a seat is offered, and the person's device never fetching the address, happen out of sight; "
              "and a server need not fetch at all for a test key on the simulated pool",
    "FAIR-9": "quiet hours need people who can all be off; the simulated pool always has someone on (as MONEY-11)",
    "MONEY-11": "earliest_ring_at needs a pool whose people can all be off; the simulated pool always has someone on",
    "MONEY-12": "panel_size and members_on_now are carried only on panel pools, which a test key cannot reach",
    "SEC-1": "where material is copied and what a person's page can reach is runner-side",
    "SEC-2": "fetching is done only for live keys; a test key on the simulated pool need not fetch",
    "SEC-3": "seat links never reach the agent; X06 checks that no response carries one",
    "PRIV-2": "needs a real spoken answer and the person's yes",
    "FAIR-1": "0.1 defines no operation by which an asker rejects an answer; the absence is read from the text, not tested",
}


# ---------------------------------------------------------------------------------------------------------------
def canon_names():
    try:
        with open(os.path.join(ROOT, "canon", "names.json")) as f:
            return json.load(f)
    except Exception:
        return {}


def spec_ids():
    ids = set()
    if os.path.isdir(SPEC_SRC):
        for fn in sorted(os.listdir(SPEC_SRC)):
            if fn.endswith(".md"):
                with open(os.path.join(SPEC_SRC, fn)) as f:
                    t = f.read()
                    ids.update(re.findall(r"\[([A-Z]+-\d+)\]", t))
                    ids.update(re.findall(r"^\| \*\*(FAIR-\d+)\*\* \|", t, re.M))

    def k(s):
        a, b = s.rsplit("-", 1)
        return (a, int(b))
    return sorted(ids, key=k)


def D(x):
    try:
        return Decimal(str(x))
    except (InvalidOperation, TypeError):
        return None


def cents(x):
    return x.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def b64u_dec(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def b64u_enc(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def now_ct():
    os.environ.setdefault("TZ", "America/Chicago")
    try:
        time.tzset()
    except Exception:
        pass
    return time.strftime("%Y-%m-%d %H:%M %Z")


# ---------------------------------------------------------------------------------------------------------------
class Fail(Exception):
    pass


class Skip(Exception):
    pass


def expect(cond, msg):
    if not cond:
        raise Fail(msg)


class Resp:
    def __init__(self, status, headers, body, text, elapsed, url):
        self.status, self.headers, self.body, self.text, self.elapsed, self.url = status, headers, body, text, elapsed, url

    @property
    def code(self):
        return self.body.get("code") if isinstance(self.body, dict) else None

    def __repr__(self):
        t = json.dumps(self.body)[:300] if self.body is not None else (self.text or "")[:200]
        return f"HTTP {self.status} {t}"


DEFAULT = object()


EXTRA_HEADERS = {}  # filled from --key-file HEADER= lines; never printed


class Api:
    def __init__(self, base, prefix, min_interval=1.0):
        self.base = base.rstrip("/")
        self.prefix = prefix
        self.api_base = None
        self.key = None
        self.min_interval = min_interval
        self.last = 0.0
        self.log = []
        self.extra = {}  # headers the tester adds to every request (--key-file lines HEADER=Name: value)
        self.http = httpx.Client(timeout=httpx.Timeout(45.0, connect=15.0), follow_redirects=False,
                                 headers={"User-Agent": f"call-server-conformance/{SUITE_VERSION}"})

    def url(self, path):
        if not isinstance(path, str):
            raise Fail(f"an address from discovery is not a string: {json.dumps(path)[:120]}")
        if path.startswith("http://") or path.startswith("https://"):
            return path
        if path.startswith("/.well-known/"):
            return self.base + path
        ab = (self.api_base or (self.base + "/v1")).rstrip("/")
        # The text lists paths as /v1/... "relative to api_base", and its example api_base ends in /v1.
        if path.startswith("/v1/") and ab.endswith("/v1"):
            return ab[:-3] + path
        return ab + path

    def req(self, method, path, body=None, params=None, key=DEFAULT, headers=None, raw=None, timeout=None):
        wait = self.min_interval - (time.monotonic() - self.last)
        if wait > 0:
            time.sleep(wait)
        h = {"Accept": "application/json"}
        h.update(self.extra)
        k = self.key if key is DEFAULT else key
        if k:
            h["Authorization"] = f"Bearer {k}"
        if headers:
            h.update(headers)
        kw = {}
        if raw is not None:
            kw["content"] = raw
            h["Content-Type"] = "application/json"
        elif body is not None:
            kw["content"] = json.dumps(body)
            h["Content-Type"] = "application/json"
        u = self.url(path)
        t0 = time.monotonic()
        try:
            r = self.http.request(method, u, params=params, headers=h, timeout=timeout or httpx.USE_CLIENT_DEFAULT, **kw)
        except httpx.HTTPError as e:
            self.last = time.monotonic()
            raise Fail(f"{method} {path}: transport error {type(e).__name__}: {e}")
        el = time.monotonic() - t0
        self.last = time.monotonic()
        try:
            b = r.json()
        except Exception:
            b = None
        rec = {"method": method, "path": path, "status": r.status_code, "ctype": r.headers.get("content-type", ""),
               "version": r.headers.get(f"{self.prefix}-version"), "body": b, "elapsed": el, "api": not path.startswith("http")}
        self.log.append(rec)
        return Resp(r.status_code, r.headers, b, r.text if b is None else None, el, u)


# ---------------------------------------------------------------------------------------------------------------
CHECKS = []


class Check:
    def __init__(self, cid, reqs, group, fn):
        self.cid, self.reqs, self.group, self.fn = cid, reqs, group, fn


def check(cid, reqs, group="core"):
    def deco(fn):
        CHECKS.append(Check(cid, reqs, group, fn))
        return fn
    return deco


class Ctx:
    def __init__(self, api, args):
        self.api = api
        self.args = args
        self.names = canon_names()
        self.prefix = api.prefix
        self.tool = self.names.get("tool") or "ask_people"
        self.run = "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(8))
        self.disc = None
        self.jwks = None
        self.key2 = None
        self.cache = {}
        self.calls = {}           # call_id -> {"kind", "body", "statuses": [...], "money": [...]}
        self.resp_by_id = {}      # response_id -> (call_id, kind, response); a detail=full copy replaces a compact one
        self.call_errors = []     # error bodies answered to POST /v1/calls
        self.started = time.monotonic()
        self.budget = args.budget
        self.notes = []

    @property
    def responses(self):
        return list(self.resp_by_id.values())

    def add_resp(self, cid, kind, x):
        if not isinstance(x, dict) or not x.get("response_id"):
            return
        old = self.resp_by_id.get(x["response_id"])
        if old is None or ("record" in x and "record" not in old[2]):
            self.resp_by_id[x["response_id"]] = (cid, kind, x)

    def idem(self, tag):
        return f"conf-{self.run}-{tag}"

    def time_left(self):
        return self.budget - (time.monotonic() - self.started)

    def limits(self):
        lim = dict(LIMIT_DEFAULTS)
        lim.update((self.disc or {}).get("limits") or {})
        return lim

    def features(self):
        f = (self.disc or {}).get("features") or []
        return set(f) if isinstance(f, list) else set()

    def need(self, feature):
        if feature not in self.features():
            raise Skip(f"the server does not list the feature {feature} (D05 checks how it answers instead)")

    # -- bodies -----------------------------------------------------------------------------------------------
    def sample(self):
        if "sample" not in self.cache:
            mid, secs = "m_sample_melody30", 30
            r = self.api.req("GET", "/v1/media/samples")
            items = None
            if r.status == 200 and r.body is not None:
                items = r.body if isinstance(r.body, list) else (r.body.get("samples") or r.body.get("media") or r.body.get("items")
                                                                 if isinstance(r.body, dict) else None)
            if isinstance(items, list):
                self.cache["samples_list"] = items
                for it in items:
                    if isinstance(it, dict) and it.get("kind") in ("listen", "audio") and it.get("media_id"):
                        mid = it["media_id"]
                        secs = it.get("seconds") or it.get("media_seconds") or secs
                        break
            self.cache["sample"] = (mid, secs, r.status)
        return self.cache["sample"]

    def listen(self, people=3, **kw):
        mid, _, _ = self.sample()
        b = {"ask": "Listen once. Then tell me what you felt, in your own words.", "kind": "listen", "content": mid,
             "people": people}
        b.update(kw)
        return b

    def as_call(self, body, tag, max_total="0.00"):
        c = dict(body)
        c["max_total_usd"] = max_total
        c["idempotency_key"] = self.idem(tag)
        return c

    # -- traffic helpers ----------------------------------------------------------------------------------------
    def note_call(self, cid, kind, body, minutes=None):
        self.calls.setdefault(cid, {"kind": kind, "body": body, "statuses": [], "money": [], "summaries": [],
                                    "minutes": minutes})

    def observe(self, cid, b):
        if not isinstance(b, dict) or cid not in self.calls:
            return
        c = self.calls[cid]
        if b.get("status"):
            c["statuses"].append(b["status"])
        if isinstance(b.get("money"), dict):
            c["money"].append((b.get("status"), b.get("complete"), b["money"]))
        if isinstance(b.get("summary"), dict):
            c["summaries"].append(b["summary"])
        if isinstance(b.get("call"), dict) and b["call"].get("minutes") is not None:
            c["minutes"] = b["call"]["minutes"]

    def open_call(self, body, expect_ok=True):
        r = self.api.req("POST", "/v1/calls", body)
        if r.status >= 400 and isinstance(r.body, dict):
            self.call_errors.append(r.body)
        if expect_ok:
            expect(r.status == 201, f"POST /v1/calls answered {r!r}, expected 201")
            cid = r.body.get("call_id")
            expect(isinstance(cid, str) and ID_RE.match(cid), f"call_id {cid!r} is not an identifier")
            self.note_call(cid, body.get("kind"), body)
            self.observe(cid, r.body)
        return r

    def results(self, cid, wait=0, after=None, detail=None):
        p = {"wait_seconds": wait}
        if after is not None:
            p["after"] = after
        if detail:
            p["detail"] = detail
        r = self.api.req("GET", f"/v1/calls/{cid}/responses", params=p, timeout=wait + 30)
        if r.status == 200 and isinstance(r.body, dict):
            self.observe(cid, r.body)
            kind = self.calls.get(cid, {}).get("kind")
            for x in r.body.get("responses") or []:
                self.add_resp(cid, kind, x)
        return r

    def wait_for(self, cid, limit=60, done=None, detail="full"):
        """Poll results until complete (or done(body)) or the limit. Honours next_check_after_seconds up to 15 s."""
        end = time.monotonic() + limit
        last = None
        while True:
            left = end - time.monotonic()
            r = self.results(cid, wait=int(max(0, min(20, left))), detail=detail)
            expect(r.status == 200, f"results for {cid}: {r!r}")
            last = r.body
            if last.get("complete") or (done and done(last)):
                return last
            if time.monotonic() >= end or self.time_left() < 20:
                return last
            nca = last.get("next_check_after_seconds") or 1
            time.sleep(max(0, min(nca, 15, end - time.monotonic())))

    def cancel(self, cid):
        r = self.api.req("POST", f"/v1/calls/{cid}/cancel", {})
        if r.status == 200:
            self.observe(cid, r.body)
        return r

    def receipt(self, rid):
        key = ("receipt", rid)
        if key not in self.cache:
            self.cache[key] = self.api.req("GET", f"/v1/receipts/{rid}")
        return self.cache[key]


# ---------------------------------------------------------------------------------------------------------------
# Evidence rules, version 1 (section 14)
def attended_rule(kind, obs):
    """True/False by the rule, or None when a needed field is missing."""
    f = lambda k: obs.get(k) if isinstance(obs, dict) else None
    if kind in ("listen", "watch"):
        ms, ps, rs, vf = f("media_seconds"), f("played_seconds"), f("realtime_seconds"), f("visible_fraction")
        if None in (ms, ps, rs, vf):
            return None
        return ps >= 0.9 * ms - 1e-9 and rs >= 0.9 * ps - 1e-9 and vf >= 0.9 - 1e-9
    if kind == "view":
        rv, vs = f("revealed"), f("visible_seconds")
        if rv is None or vs is None:
            return None
        return rv is True and vs >= 5 - 1e-9
    if kind == "play":
        ss, ic = f("session_seconds"), f("input_count")
        if ss is None or ic is None:
            return None
        return ss >= 30 - 1e-9 and ic >= 5
    if kind == "compare":
        items = f("items")
        if not isinstance(items, list) or not items:
            return None
        res = []
        for it in items:
            if not isinstance(it, dict):
                return None
            ik = it.get("kind")
            io = it.get("observed") if isinstance(it.get("observed"), dict) else it
            v = attended_rule(ik, io)
            if v is None:
                return None
            res.append(v)
        return all(res)
    if kind == "answer":
        return False
    return None


def expected_level(kind, obs, voice):
    spoken = isinstance(voice, dict) and (voice.get("seconds") or 0) >= 3
    if kind == "answer":
        return "voiced" if spoken else "said"
    att = attended_rule(kind, obs)
    if att is None:
        return None
    if att and spoken:
        return "voiced"
    return "attended" if att else "said"


def stop_pay(pay, seat_seconds, minutes, stop_min):
    pay, stop_min = D(pay), D(stop_min) or Decimal("0.00")
    if pay is None or seat_seconds is None or not minutes:
        return None
    if pay == 0:
        return Decimal("0.00")
    frac = min(Decimal(1), D(seat_seconds) / (Decimal(60) * D(minutes)))
    return max(min(stop_min, pay), cents(pay * frac))  # s12.3: max(min(stop_minimum_usd, pay), pay x fraction)


def check_error(r, code, status=None, fixable=DEFAULT, field=None, field_pred=None):
    """Common shape of an error (section 8)."""
    b = r.body
    expect(isinstance(b, dict), f"error body is not JSON: HTTP {r.status} {(r.text or '')[:120]!r}")
    expect(b.get("code") == code, f"expected code {code}, got HTTP {r.status} {json.dumps(b)[:240]}")
    st, fx = ERROR_CODES.get(code, (None, None))
    want_status = status or st
    if want_status:
        expect(r.status == want_status, f"{code} came with HTTP {r.status}, the registry says {want_status}")
    expect(r.status >= 400, f"error with HTTP {r.status}")
    expect(isinstance(b.get("message"), str) and b["message"].strip(), f"{code}: no message")
    expect(isinstance(b.get("fixable"), bool), f"{code}: fixable is not a boolean")
    want_fx = fx if fixable is DEFAULT else fixable
    if want_fx is not None:
        expect(b["fixable"] == want_fx, f"{code}: fixable is {b['fixable']}, expected {want_fx}")
    if b["fixable"]:
        expect(isinstance(b.get("field"), str) and b["field"], f"{code}: fixable error names no field [ERR-2]")
        expect("example" in b, f"{code}: fixable error gives no example (null when the fix is to remove the field) [ERR-2]")
    if field is not None:
        expect(b.get("field") == field, f"{code}: field is {b.get('field')!r}, expected {field!r}")
    if field_pred is not None:
        expect(field_pred(b.get("field") or ""), f"{code}: field {b.get('field')!r} does not name the problem")
    if "status" in b:
        expect(b["status"] == r.status, f"{code}: body status {b['status']} != HTTP {r.status}")
    return b


def walk(o, path=""):
    if isinstance(o, dict):
        for k, v in o.items():
            yield path + "." + k if path else k, k, v
            yield from walk(v, path + "." + k if path else k)
    elif isinstance(o, list):
        for i, v in enumerate(o):
            yield from walk(v, f"{path}[{i}]")


def strip_volatile(o):
    vol = {"quote_id", "expires_at", "created_at", "received_at", "issued_at"}
    if isinstance(o, dict):
        return {k: strip_volatile(v) for k, v in o.items() if k not in vol}
    if isinstance(o, list):
        return [strip_volatile(v) for v in o]
    return o


def diff(a, b, path=""):
    if type(a) != type(b):
        return [f"{path or '.'}: {json.dumps(a)[:60]} vs {json.dumps(b)[:60]}"]
    if isinstance(a, dict):
        out = []
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                out.append(f"{path}.{k}: present on one side only")
            else:
                out += diff(a[k], b[k], f"{path}.{k}")
        return out
    if isinstance(a, list):
        if len(a) != len(b):
            return [f"{path}: lengths {len(a)} vs {len(b)}"]
        out = []
        for i, (x, y) in enumerate(zip(a, b)):
            out += diff(x, y, f"{path}[{i}]")
        return out
    return [] if a == b else [f"{path}: {json.dumps(a)[:60]} vs {json.dumps(b)[:60]}"]


# ===============================================================================================================
# Discovery, versions, keys
# ===============================================================================================================
@check("D01", ["DISC-1", "DISC-2", "PEOPLE-3", "SIM-1", "MCP-1"])
def d01(ctx):
    d = ctx.disc
    p = []
    if ctx.cache.get("disc_fallback"):
        p.append(ctx.cache["disc_fallback"] + " (HINT: serve the same JSON at the path without .json; the other checks "
                 "ran against the .json document)")
    if d.get("protocol") != ctx.prefix:
        p.append(f"protocol is {d.get('protocol')!r}, expected {ctx.prefix!r}")
    vs = d.get("versions")
    if not (isinstance(vs, list) and any(isinstance(v, dict) and v.get("version") == "0.1" for v in vs)):
        p.append(f"versions {json.dumps(vs)[:80]} is not a list of {{version, status}} listing 0.1")
    for k in ("api_base", "mcp", "jwks_uri", "screening_policy"):
        if not (isinstance(d.get(k), str) and (d[k].startswith("https://") or re.match(r"^http://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(/|$)", d[k]))):
            p.append(f"{k} is not an absolute https address (http only on a loopback host, s5): {json.dumps(d.get(k))[:60]}")
    ks = d.get("kinds")
    if not (isinstance(ks, list) and all(k in KINDS for k in ks)):
        p.append(f"kinds {ks!r} not a subset of the registry")
    elif not {"listen", "view", "answer"} <= set(ks):
        p.append(f"kinds {ks!r} lack the core {sorted({'listen', 'view', 'answer'} - set(ks))} [DISC-2]")
    pools = d.get("pools")
    if not (isinstance(pools, list) and "simulated" in pools):
        p.append(f"pools {pools!r} lacks simulated")
    feats = d.get("features", [])
    if not (isinstance(feats, list) and all(f in FEATURES for f in feats)):
        p.append(f"features {json.dumps(feats)[:100]} is not a list drawn from {FEATURES}")
    mv = d.get("mcp_protocol_versions")
    if not (isinstance(mv, list) and set(mv) & {"2026-07-28", "2025-11-25", "2025-06-18"}):
        p.append(f"mcp_protocol_versions {json.dumps(mv)[:100]} lists none of 2026-07-28, 2025-11-25, 2025-06-18 [MCP-1]")
    if not (isinstance(d.get("profiles", []), list) and all(isinstance(x, str) for x in d.get("profiles", []))):
        p.append(f"profiles {json.dumps(d.get('profiles'))[:100]} is not a list of profile identifiers")
    if "test_keys" in d and not isinstance(d["test_keys"], str):
        p.append("test_keys is not an address")
    lim = d.get("limits")
    if lim is not None and not isinstance(lim, dict):
        p.append("limits is not an object")
    expect(not p, "; ".join(p))
    return (f"protocol {d['protocol']}, kinds {','.join(ks)}, pools {','.join(pools)}, features {feats}, "
            f"profiles {d.get('profiles')}")


@check("D05", ["DISC-5", "AUTH-1"])
def d05(ctx):
    feats = ctx.features()
    out = []
    if "keyless" not in feats:
        r = ctx.api.req("POST", "/v1/quotes", ctx.listen(), key=None)
        expect(r.code in ("unauthorized", "unsupported_feature"),
               f"keyless is not listed, yet a keyless quote answered {r!r}")
        check_error(r, r.code)
        out.append(f"keyless->{r.code}")
    if "url_content" not in feats:
        r = ctx.api.req("POST", "/v1/quotes", ctx.listen(content="https://example.com/conformance/track.mp3"))
        check_error(r, "unsupported_feature", field_pred=lambda f: "content" in f)
        out.append("url_content->unsupported_feature")
    if "voice" not in feats:
        r = ctx.api.req("POST", "/v1/quotes", ctx.listen(voice={"max_seconds": 30}))
        check_error(r, "unsupported_feature", field_pred=lambda f: "voice" in f)
        out.append("voice->unsupported_feature")
    if "media_upload" not in feats:
        r = ctx.api.req("POST", "/v1/media", raw="{}")
        expect(r.code in ("unsupported_feature", "forbidden_for_key_class"), f"media_upload not listed; POST /v1/media answered {r!r}")
        out.append(f"media_upload->{r.code}")
    if "panels" not in feats:
        r = ctx.api.req("POST", "/v1/panels", {"name": "conformance"})
        expect(r.code in ("unsupported_feature", "forbidden_for_key_class"), f"panels not listed; POST /v1/panels answered {r!r}")
        out.append(f"panels->{r.code}")
    if "outcome" not in feats:
        m = main_call(ctx)
        r = ctx.api.req("POST", f"/v1/calls/{m['call_id']}/outcome", {"text": "Thank you."})
        expect(r.code == "unsupported_feature", f"outcome not listed; POST outcome answered {r!r}")
        check_error(r, "unsupported_feature")
        out.append("outcome->unsupported_feature")
    if not out:
        raise Skip("every optional feature is listed; each is checked by its own checks")
    return "; ".join(out)


@check("D02", ["VER-1", "VER-2"])
def d02(ctx):
    h = f"{ctx.prefix}-version"
    r = ctx.api.req("POST", "/v1/quotes", ctx.listen(), headers={h: "0.1"})
    expect(r.status == 200, f"quote with {h}: 0.1 refused: {r!r}")
    expect(r.headers.get(h), f"response lacks the {h} header [VER-2]")
    r2 = ctx.api.req("POST", "/v1/quotes", ctx.listen(), headers={h: "9.9"})
    b = check_error(r2, "version_unsupported")
    expect(isinstance(b.get("versions"), list) and b["versions"], "version_unsupported carries no versions list")
    expect(str(b.get("field", "")).lower() == h, f"version_unsupported field is {b.get('field')!r}, the text gives the header {h}")
    served = [v.get("version") if isinstance(v, dict) else v for v in b["versions"]]
    expect(b.get("example") in served, f"version_unsupported example {b.get('example')!r} is not a served version {served}")
    return f"answered {r.headers.get(h)}; 9.9 -> version_unsupported {b.get('versions')}"


@check("D03", ["DISC-4"])
def d03(ctx):
    expect(ctx.disc and isinstance(ctx.disc.get("jwks_uri"), str), "discovery has no jwks_uri")
    r = ctx.api.req("GET", ctx.disc["jwks_uri"], key=None)
    expect(r.status == 200 and isinstance(r.body, dict), f"jwks: {r!r}")
    keys = r.body.get("keys")
    expect(isinstance(keys, list) and keys, "jwks has no keys")
    ed = [k for k in keys if k.get("kty") == "OKP" and k.get("crv") == "Ed25519" and k.get("x") and k.get("kid")]
    expect(ed, "jwks has no OKP Ed25519 key with kid and x")
    ctx.jwks = r.body
    return f"{len(ed)} Ed25519 key(s)"


@check("D04", ["SCREEN-5"])
def d04(ctx):
    expect(ctx.disc and isinstance(ctx.disc.get("screening_policy"), str), "discovery has no screening_policy address")
    u = ctx.disc["screening_policy"]
    expect(u.startswith("https://") or bool(re.match(r"^http://(localhost|127\.0\.0\.1|\[::1\])", u)), f"screening_policy {u!r} is not https")
    r = ctx.api.req("GET", u, key=None)
    expect(r.status == 200, f"screening_policy answered HTTP {r.status}")
    return u


@check("A01", ["AUTH-1", "ERR-1", "ERR-2", "HTTP-2"])
def a01(ctx):
    def auth_err(r):
        e = check_error(r, "unauthorized", 401, field="Authorization")
        expect(str(e.get("example", "")).startswith("Bearer test_"), f"unauthorized example {e.get('example')!r}, the text gives 'Bearer test_...'")
    auth_err(ctx.api.req("POST", "/v1/quotes", ctx.listen(), key="test_not_a_real_key_" + ctx.run))
    b = ctx.as_call(ctx.listen(pool="panel:p_conformance"), "nokey-panel")
    r2 = ctx.api.req("POST", "/v1/calls", b, key=None)
    if isinstance(r2.body, dict):
        ctx.call_errors.append(r2.body)
    auth_err(r2)
    r3 = ctx.api.req("GET", "/v1/media/samples", key=None)
    expect(r3.status == 200, f"GET /v1/media/samples without a key: {r3!r} (AUTH-1 lists it as keyless)")
    return "unknown key -> 401 unauthorized, field Authorization, example 'Bearer test_...'; keyless call to a panel -> 401; samples open"


@check("A04", ["AUTH-5", "HTTP-1"])
def a04(ctx):
    ctx.need("keyless")
    r = ctx.api.req("POST", "/v1/quotes", ctx.listen(), key=None)
    expect(r.status == 200 and r.body.get("simulated") is True, f"keyless quote: {r!r}")
    paid = ctx.as_call(ctx.listen(people=1, pay_per_person_usd="1.00", minutes=2), "nokey-paid", max_total="5.00")
    rp = ctx.api.req("POST", "/v1/calls", paid, key=None)
    e = check_error(rp, "forbidden_for_key_class", 403, field="pay_per_person_usd")
    expect(e.get("example") == "0.00", f"keyless paid call: example {e.get('example')!r}, the text gives '0.00'")
    body = ctx.as_call(ctx.listen(people=2, answer_fields={"felt": "text"}), "nokey")
    o = ctx.api.req("POST", "/v1/calls", body, key=None)
    expect(o.status == 201, f"keyless simulated call: {o!r}")
    cid = o.body.get("call_id")
    expect(isinstance(cid, str) and ID_RE.match(cid), f"call_id {cid!r}")
    rnd = cid.split("_")[-1]
    expect(len(rnd) >= 20, f"keyless call_id has {len(rnd)} characters after its prefix; 120 random bits need at least 20")
    ctx.note_call(cid, "listen", body)
    ctx.observe(cid, o.body)
    mo = o.body.get("money") or {}
    expect(D(mo.get("held_usd") or "0") == 0, f"a keyless call held {mo.get('held_usd')}")
    f = None
    end = time.monotonic() + 40
    while time.monotonic() < end:
        rr = ctx.api.req("GET", f"/v1/calls/{cid}/responses", params={"wait_seconds": 15, "detail": "full"}, key=None, timeout=45)
        expect(rr.status == 200, f"reading a keyless call by its id alone: {rr!r}")
        ctx.observe(cid, rr.body)
        for x in rr.body.get("responses") or []:
            ctx.add_resp(cid, "listen", x)
        f = rr.body
        if f.get("complete"):
            break
        time.sleep(min(f.get("next_check_after_seconds") or 1, 10))
    expect(f and f.get("complete") is True, f"keyless simulated call not complete: {f and f.get('status')}")
    rs = f.get("responses") or []
    refs = [x.get("person_ref") for x in rs]
    expect(len(set(refs)) == len(refs) == 2, f"keyless person_refs {refs} are not fresh for every response")
    for x in rs:
        j = x.get("receipt_jws")
        expect(isinstance(j, str), "a keyless detail=full response has no receipt_jws")
        _, pay = verify_jws(ctx, j)
        expect(pay.get("answered_for") == "an unnamed test caller", f"keyless receipt answered_for {pay.get('answered_for')!r}")
    c = ctx.api.req("POST", f"/v1/calls/{cid}/cancel", {}, key=None)
    expect(c.status == 200, f"cancel of a keyless call by its id: {c!r}")
    m = main_call(ctx)
    k = ctx.api.req("GET", f"/v1/calls/{m['call_id']}", key=None)
    check_error(k, "not_found", 404)
    return f"keyless quote and unpaid call served, paid keyless call -> forbidden_for_key_class; fresh refs; {cid} read by its id; a keyed call read keylessly -> not_found"


@check("A02", ["SIM-6", "AUTH-2", "CONV-1"])
def a02(ctx):
    info = ctx.cache.get("key_info")
    if info is None:
        raise Skip("key given on the command line; test_keys not exercised")
    expect(isinstance(info, dict), f"POST /v1/keys body: {info!r}")
    expect(str(info.get("key", "")).startswith("test_"), "test key does not begin test_")
    expect(info.get("class") == "test", f"class is {info.get('class')!r}")
    expect(isinstance(info.get("balance_usd"), str) and MONEY_RE.match(info["balance_usd"]), "balance_usd is not a money string")
    expect(info.get("test_money") is True, "test_money is not true")
    return f"test key issued, balance {info['balance_usd']} (test money)"


@check("A03", ["AUTH-4"])
def a03(ctx):
    ctx.need("panels")
    # the CEO, 15 Nov 2026 (OWNER_all_6): a test key may make a panel of its own people; what it still may not do is call a
    # panel it did not make. That request is the AUTH-4 case here.
    r = ctx.api.req("POST", "/v1/quotes", ctx.listen(pool="panel:team-test", pay_per_person_usd="0.00"))
    check_error(r, "forbidden_for_key_class", 403)
    return "test key on a panel it did not make -> 403 forbidden_for_key_class"


# ===============================================================================================================
# Validation and quotes
# ===============================================================================================================
@check("Q01", ["CALL-2", "MONEY-1", "MONEY-2", "MONEY-4", "CONV-1"])
def q01(ctx):
    mid, secs, _ = ctx.sample()
    r = ctx.api.req("POST", "/v1/quotes", ctx.listen())
    expect(r.status == 200 and isinstance(r.body, dict), f"minimal quote: {r!r}")
    q = r.body
    lines = q.get("lines")
    expect(isinstance(lines, list) and lines, "quote has no lines")
    tot = Decimal(0)
    for ln in lines:
        expect(ln.get("kind") in QUOTE_LINES, f"line kind {ln.get('kind')!r} not in the registry")
        expect(isinstance(ln.get("amount_usd"), str) and MONEY_RE.match(ln["amount_usd"]), f"line amount {ln.get('amount_usd')!r}")
        tot += D(ln["amount_usd"])
    expect(isinstance(q.get("total_usd"), str) and D(q["total_usd"]) == tot, f"total_usd {q.get('total_usd')} != sum of lines {tot}")
    expect("test_money" in q, "quote lacks test_money")
    expect(q.get("simulated") is True, "quote on the simulated pool does not say simulated: true")
    du = q.get("defaults_used")
    expect(isinstance(du, dict), "quote has no defaults_used [CALL-2]")
    want = {"pool": "simulated", "enough": 3, "deadline_minutes": 120, "pay_per_person_usd": "0.00",
            "may_train_on_answers": False}
    for k, v in want.items():
        expect(k in du, f"defaults_used lacks {k}")
        expect(du[k] == v, f"defaults_used.{k} is {du[k]!r}, the text gives {v!r}")
    expect("answer_fields" in du, "defaults_used lacks answer_fields")
    expect("minutes" in du, "defaults_used lacks minutes")
    exp_min = math.ceil(secs / 60) + 1
    if du["minutes"] != exp_min:
        raise Fail(f"defaults_used.minutes is {du['minutes']}, the text gives ceil({secs}/60)+1 = {exp_min}")
    if q.get("expires_at") is not None:
        expect(TIME_RE.match(str(q["expires_at"])), f"expires_at {q['expires_at']!r} is not RFC 3339 UTC")
    return f"total {q['total_usd']}, defaults {sorted(du)}"


@check("Q02", ["CONV-2", "ERR-2"])
def q02(ctx):
    b = ctx.listen()
    b["peeple"] = 3
    r = ctx.api.req("POST", "/v1/quotes", b)
    e = check_error(r, "unknown_field", field_pred=lambda f: "peeple" in f)
    expect(e.get("example") is None, f"unknown_field example is {e.get('example')!r}; the text gives null (remove it)")
    expect(e.get("did_you_mean") == "people", f"did_you_mean is {e.get('did_you_mean')!r}, expected 'people'")
    b2 = ctx.listen()
    b2["ext"] = {"example.org": {"anything": 1}}
    r2 = ctx.api.req("POST", "/v1/quotes", b2)
    expect(r2.status == 200, f"a field under ext was refused: {r2!r}")
    return "unknown field -> unknown_field, example null, did_you_mean people; ext accepted"


@check("Q03", ["CALL-1", "ERR-2"])
def q03(ctx):
    b = ctx.listen()
    del b["people"]
    check_error(ctx.api.req("POST", "/v1/quotes", b), "missing_field", field_pred=lambda f: f.endswith("people"))
    b = ctx.listen()
    b["kind"] = "smell"
    e = check_error(ctx.api.req("POST", "/v1/quotes", b), "invalid_field", field_pred=lambda f: f.endswith("kind"))
    expect(e.get("example") in KINDS, f"example for kind is {e.get('example')!r}, not a kind")
    b = ctx.listen(people=0)
    check_error(ctx.api.req("POST", "/v1/quotes", b), "invalid_field", field_pred=lambda f: f.endswith("people"))
    lim = ctx.limits()
    mx = lim.get("max_people")
    if mx:
        b = ctx.listen(people=int(mx) + 1)
        check_error(ctx.api.req("POST", "/v1/quotes", b), "invalid_field", field_pred=lambda f: f.endswith("people"))
    return "missing people, kind 'smell', people 0" + (f", people {mx}+1" if mx else "") + " each fixable with field and example"


@check("Q04", ["ERR-1", "HTTP-2"])
def q04(ctx):
    r = ctx.api.req("POST", "/v1/quotes", raw="this is not json")
    check_error(r, "invalid_json", 400)
    r2 = ctx.api.req("POST", "/v1/quotes", raw="[1,2,3]")
    check_error(r2, "invalid_json", 400)
    return "non-JSON and non-object bodies -> invalid_json"


@check("Q05", ["CALL-3", "CONV-1"])
def q05(ctx):
    r = ctx.api.req("POST", "/v1/quotes", ctx.listen(pay_per_person_usd=2, minutes=2))
    expect(r.status == 200, f"pay as a JSON number refused: {r!r}")
    q = r.body
    tp = [ln for ln in q.get("lines", []) if ln.get("kind") == "to_people"]
    expect(tp and tp[0]["amount_usd"] == "6.00", f"to_people for 3 x 2 is {tp[0]['amount_usd'] if tp else None!r}, expected '6.00'")
    if "pay_per_person_usd" in q:
        expect(q["pay_per_person_usd"] == "2.00", f"pay_per_person_usd came back as {q['pay_per_person_usd']!r}")
    r2 = ctx.api.req("POST", "/v1/quotes", ctx.listen(pay_per_person_usd=2.005, minutes=2))
    check_error(r2, "invalid_field", field_pred=lambda f: "pay_per_person_usd" in f)
    return "2 (number) accepted and returned as '2.00'; 2.005 refused"


@check("Q06", ["DISC-2", "DISC-5"])
def q06(ctx):
    ks = set((ctx.disc or {}).get("kinds", []))
    samples = ctx.cache.get("samples_list") or []
    by_kind = {}
    for it in samples:
        if isinstance(it, dict) and it.get("media_id"):
            by_kind.setdefault(it.get("kind"), it["media_id"])
    content = {"listen": ctx.sample()[0], "view": {"text": "A page headline: Ship faster with fewer meetings."},
               "compare": [{"text": "Version A: Get started"}, {"text": "Version B: Try it free"}], "answer": None,
               "watch": by_kind.get("watch"), "play": by_kind.get("play")}
    url = {"watch": "https://example.com/conformance/clip.mp4", "play": "https://example.com/conformance/game/"}
    seen = []
    for k in KINDS:
        b = {"ask": "Look at this and tell me what you think.", "kind": k, "people": 2}
        c = content[k]
        if c is None and k in url:
            if "url_content" not in ctx.features():
                if k in ks:
                    seen.append(f"{k}:no sample, no url_content (not probed)")
                    continue
                c = url[k]
            else:
                c = url[k]
        if c is not None:
            b["content"] = c
        r = ctx.api.req("POST", "/v1/quotes", b)
        if k in ks:
            expect(r.status == 200, f"kind {k} is listed in discovery but its quote failed: {r!r}")
            seen.append(f"{k}:ok")
        else:
            expect(r.status >= 400 and r.code in ("invalid_field", "unsupported_feature"),
                   f"kind {k} is not listed in discovery but answered {r!r} [DISC-2]")
            seen.append(f"{k}:refused")
    return " ".join(seen)


@check("Q10", ["ERR-2", "HTTP-4", "HTTP-2"])
def q10(ctx):
    r = ctx.api.req("POST", "/v1/quotes", ctx.listen(pool="nowhere_" + ctx.run))
    e = check_error(r, "unknown_pool", field_pred=lambda f: f.endswith("pool"))
    expect(isinstance(e.get("pools"), list) and e["pools"], "unknown_pool carries no pools list")
    expect(e.get("example") in e["pools"], f"unknown_pool example {e.get('example')!r} is not one of its pools")
    r2 = ctx.api.req("POST", "/v1/quotes", ctx.listen(content="m_conformance_missing_" + ctx.run))
    e2 = check_error(r2, "content_unavailable", field_pred=lambda f: "content" in f)
    for path, meth in ((f"/v1/nothing_here_{ctx.run}", "GET"), ("/v1/quotes", "DELETE")):
        r3 = ctx.api.req(meth, path)
        b3 = check_error(r3, "not_found", 404)
        expect("json" in r3.headers.get("content-type", ""), f"{meth} {path} not answered as JSON [HTTP-4]")
    return f"unknown pool -> pools {e['pools']}; unknown media id -> content_unavailable (example {e2.get('example')!r}); unknown route and method -> 404 JSON"


@check("Q11", ["CALL-1"])
def q11(ctx):
    b = ctx.listen(pool="panel:p_conformance_" + ctx.run)
    del b["people"]
    r = ctx.api.req("POST", "/v1/quotes", b)
    check_error(r, "missing_field", field_pred=lambda f: f.endswith("people"))
    b = ctx.listen()
    del b["people"]
    b["peeple"] = 3
    check_error(ctx.api.req("POST", "/v1/quotes", b), "unknown_field", field_pred=lambda f: "peeple" in f)
    b = ctx.listen(people=0)
    b["kind"] = "smell"
    check_error(ctx.api.req("POST", "/v1/quotes", b), "invalid_field", field_pred=lambda f: f.endswith("kind"))
    b = ctx.listen(pool="nowhere_" + ctx.run, require={"shoe_size": ["10"]})
    check_error(ctx.api.req("POST", "/v1/quotes", b), "unknown_pool", field_pred=lambda f: f.endswith("pool"))
    return "missing people before a panel pool; unknown field before missing; kind before people; pool before require"


@check("Q12", ["HTTP-5"])
def q12(ctx):
    ctx.sample()
    items = ctx.cache.get("samples_list")
    expect(isinstance(items, list), "GET /v1/media/samples did not return a samples list")
    have = {it.get("kind") for it in items if isinstance(it, dict) and it.get("media_id")}
    need = {k for k in ("listen", "watch", "play") if k in (ctx.disc or {}).get("kinds", [])}
    expect(need <= have, f"samples cover {sorted(have)}; the server lists {sorted(need)} and needs a sample of each")
    return f"samples for {sorted(have)}"


@check("Q07", ["PEOPLE-5", "PEOPLE-7"])
def q07(ctx):
    r = ctx.api.req("POST", "/v1/quotes", ctx.listen(require={"shoe_size": ["10"]}))
    check_error(r, "unknown_selector", field_pred=lambda f: "require" in f or "shoe_size" in f)
    r2 = ctx.api.req("POST", "/v1/quotes", ctx.listen(require={"religion": ["any"]}))
    expect(r2.status >= 400, f"a selector on religion was accepted [PEOPLE-7]: {r2!r}")
    r3 = ctx.api.req("POST", "/v1/quotes", ctx.listen(require={"example.org/plays_instrument": [True]}))
    expect(r3.status == 200 or r3.code in ("unknown_selector", "selector_unsupported"),
           f"a namespaced selector got {r3!r}")
    if r3.status != 200:
        check_error(r3, r3.code)
    r4 = ctx.api.req("POST", "/v1/quotes", ctx.listen(require={"country": ["US"]}))
    expect(r4.status == 200 or r4.code == "selector_unsupported", f"core selector country on simulated: {r4!r}")
    return f"unknown -> unknown_selector; religion refused ({r2.code}); namespaced -> {r3.code or 200}; country -> {r4.code or 200}"


@check("Q08", ["CALL-4", "SIM-5"])
def q08(ctx):
    b = ctx.listen(people=1, script=[{"accept": True}] * 22)
    check_error(ctx.api.req("POST", "/v1/quotes", b), "invalid_field", field_pred=lambda f: "script" in f)
    b = ctx.listen(people=1, script=[{"accept": True, "shoe": 1}])
    check_error(ctx.api.req("POST", "/v1/quotes", b), "unknown_field", field_pred=lambda f: "script" in f)  # s18, CONV-2
    b = ctx.listen(people=1, pace="sideways")
    check_error(ctx.api.req("POST", "/v1/quotes", b), "invalid_field", field_pred=lambda f: "pace" in f)
    pools = [p for p in (ctx.disc or {}).get("pools", []) if p not in ("simulated", "panel")]
    if pools:
        b = ctx.listen(people=1, pool=pools[0], script=[{"accept": True}])
        r = ctx.api.req("POST", "/v1/quotes", b)
        if r.code == "invalid_field":
            check_error(r, "invalid_field", field_pred=lambda f: "script" in f)
        else:
            ctx.notes.append(f"Q08: script on pool {pools[0]} answered {r.code}; cannot isolate CALL-4")
    return "script longer than people + 20 and bad pace -> invalid_field; unknown script field -> unknown_field"


@check("Q09", ["MONEY-10"])
def q09(ctx):
    floor = D((ctx.disc or {}).get("pay_floor_usd_per_hour"))
    if not floor:
        raise Skip("discovery publishes no pay_floor_usd_per_hour")
    low = cents(floor * Decimal(60) / Decimal(60)) - Decimal("0.01")
    if low <= 0:
        raise Skip("floor too low to test")
    r = ctx.api.req("POST", "/v1/quotes", ctx.listen(people=1, minutes=60, pay_per_person_usd=str(low)))
    expect(r.status != 200, f"a paid simulated call at {low} for 60 minutes was quoted below the floor {floor}/h [MONEY-10]")
    e = check_error(r, "below_pay_floor", field_pred=lambda f: "pay_per_person_usd" in f)
    ex = D(e.get("example"))
    expect(ex is not None and ex >= floor, f"example {e.get('example')!r} does not meet the floor {floor} for 60 minutes")
    return f"{low} for 60 minutes -> below_pay_floor, example {e.get('example')}"


@check("Q13", ["CALL-7", "MONEY-13", "MONEY-14"])
def q13(ctx):
    b = ctx.listen(people=2)
    b.pop("content")
    r = ctx.api.req("POST", "/v1/quotes", b)
    expect(r.status == 200 and isinstance(r.body, dict), f"a quote without content was not priced: {r!r} [CALL-7]")
    du = r.body.get("defaults_used") or {}
    expect("content" in du, f"a quote without content does not list content in defaults_used: {sorted(du)} [CALL-7]")
    paid = ctx.listen(people=2, pay_per_person_usd="1.00", minutes=2)
    q = paid_quote(ctx, paid)
    fyu = q.get("for_your_user")
    if not (isinstance(fyu, str) and fyu.strip()):
        ctx.notes.append("Q13: the quote carries no for_your_user (MONEY-13 is a SHOULD)")
    else:
        expect(len(fyu) <= 600, f"for_your_user is {len(fyu)} characters; the schema allows 600")
    o = ctx.open_call(ctx.as_call(paid, "fresh-quote", max_total=q["total_usd"]), expect_ok=False)
    expect(o.status == 201, f"a call with max_total_usd equal to its fresh quote's total {q['total_usd']} was refused: "
                            f"{o.code or o.status} [MONEY-14]")
    ctx.cancel(o.body["call_id"])
    return (f"quote without content priced, defaults_used.content {du.get('content')!r}; a call at its quote's total "
            f"{q['total_usd']} opened; for_your_user {'present' if fyu else 'absent'}")


# ===============================================================================================================
# Calls, idempotency, money on opening
# ===============================================================================================================
TALLY_FIELDS = {
    "felt": {"type": "text", "label": "What did you feel?"},
    "again": "boolean",
    "stars": {"type": "scale", "min": 1, "max": 5},
    "pick": {"type": "choice", "choices": ["a", "b", "c"]},
    "many": {"type": "choice", "choices": ["x", "y", "z"], "multiple": True},
    "secs": {"type": "number", "min": 0, "max": 30, "optional": True},
}


def main_call(ctx):
    """One instant simulated call with every field type, used by several checks."""
    if "main" not in ctx.cache:
        body = ctx.as_call(ctx.listen(people=5, answer_fields=TALLY_FIELDS), "main")
        r = ctx.open_call(body)
        cid = r.body["call_id"]
        t0 = time.monotonic()
        fin = ctx.wait_for(cid, limit=45)
        ctx.cache["main"] = {"body": body, "open": r, "call_id": cid, "final": fin, "secs": time.monotonic() - t0}
    return ctx.cache["main"]


@check("C01", ["CALL-2", "CALL-6", "SIM-1", "SIM-3", "AUTH-2"])
def c01(ctx):
    m = main_call(ctx)
    o = m["open"].body
    for k in ("call_id", "status", "deadline", "simulated", "test_money"):
        expect(k in o, f"opened call lacks {k}")
    expect(o["status"] in CALL_STATES, f"status {o['status']!r} not in the registry")
    expect(TIME_RE.match(str(o["deadline"])), f"deadline {o['deadline']!r} is not RFC 3339 UTC")
    expect(o["simulated"] is True and o["test_money"] is True, "a test-key simulated call does not say simulated and test_money")
    if o["status"] not in TERMINAL:
        n = o.get("next_check_after_seconds")
        expect(isinstance(n, int) and 1 <= n <= 300, f"next_check_after_seconds {n!r}")
    du = o.get("defaults_used")
    expect(isinstance(du, dict) and "enough" in du, f"opened call's defaults_used {du!r} lacks enough [CALL-2]")
    expect(isinstance(o.get("next_step"), str) and o["next_step"].strip(), "the opened call has no next_step")
    echoed = (o.get("call") or {}).get("answer_fields")
    expect(isinstance(echoed, dict), "opened call does not echo the call with answer_fields [CALL-6]")
    expect(isinstance(echoed.get("again"), dict) and echoed["again"].get("type") == "boolean",
           f"short form 'again': 'boolean' not echoed as an object: {echoed.get('again')!r} [CALL-6]")
    return f"{m['call_id']} opened {o['status']}"


@check("C02", ["IDEM-2"])
def c02(ctx):
    m = main_call(ctx)
    r = ctx.api.req("POST", "/v1/calls", m["body"])
    expect(r.status == m["open"].status, f"replay status {r.status}, first was {m['open'].status}")
    expect(isinstance(r.body, dict) and r.body.get("call_id") == m["call_id"], f"replay opened another call: {r!r}")
    shuffled = dict(reversed(list(m["body"].items())))
    r2 = ctx.api.req("POST", "/v1/calls", shuffled)
    expect(r2.status == m["open"].status and r2.body.get("call_id") == m["call_id"],
           f"same body with keys in another order was not treated as the same: {r2!r}")
    return f"replays returned {m['call_id']} (C08 checks the balance did not move)"


@check("C03", ["IDEM-3", "ERR-3"])
def c03(ctx):
    m = main_call(ctx)
    b = dict(m["body"])
    b["people"] = 4
    r = ctx.api.req("POST", "/v1/calls", b)
    ctx.call_errors.append(r.body if isinstance(r.body, dict) else {})
    check_error(r, "idempotency_key_reused", 409, field="idempotency_key")
    return "same key, different body -> 409 idempotency_key_reused"


@check("C04", ["CALL-1"])
def c04(ctx):
    b = ctx.as_call(ctx.listen(), "nomax")
    del b["max_total_usd"]
    r = ctx.open_call(b, expect_ok=False)
    check_error(r, "missing_field", field="max_total_usd")
    return "missing max_total_usd -> missing_field"


@check("C07", ["IDEM-1", "IDEM-2"])
def c07(ctx):
    b = ctx.listen(people=2, ask=f"Listen once. Then tell me what you felt. ({ctx.run})")
    b["max_total_usd"] = "0.00"
    r1 = ctx.open_call(dict(b))
    r2 = ctx.api.req("POST", "/v1/calls", dict(b))
    expect(r2.status == r1.status and isinstance(r2.body, dict) and r2.body.get("call_id") == r1.body["call_id"],
           f"the same body without idempotency_key, seconds later, opened another call: {r2!r} [IDEM-1]")
    du = r1.body.get("defaults_used") or {}
    said = [k for k, v in du.items() if "idempot" in k or "retry" in json.dumps(v).lower() or "10 minutes" in json.dumps(v)]
    expect(said, f"defaults_used {sorted(du)} does not say that a repeat within 10 minutes is a retry [IDEM-1]")
    out = f"keyed: same call {r1.body['call_id']}"
    if "keyless" in ctx.features():
        kb = dict(b)
        kb["ask"] = kb["ask"] + " (keyless)"
        k1 = ctx.api.req("POST", "/v1/calls", kb, key=None)
        k2 = ctx.api.req("POST", "/v1/calls", kb, key=None)
        expect(k1.status == 201 and k2.status == 201 and k1.body.get("call_id") == k2.body.get("call_id"),
               f"the same keyless body twice from one address gave {k1!r} and {k2!r} [IDEM-1]")
        ctx.note_call(k1.body["call_id"], "listen", kb)
        out += f"; keyless: same call {k1.body['call_id']}"
    return out


def balance(ctx):
    r = ctx.api.req("GET", "/v1/balance")
    expect(r.status == 200 and isinstance(r.body, dict), f"GET /v1/balance: {r!r}")
    return r.body


@check("B01", ["CONV-1", "MONEY-4"])
def b01(ctx):
    b = balance(ctx)
    for k in ("balance_usd", "held_usd", "spent_today_usd"):
        expect(isinstance(b.get(k), str) and MONEY_RE.match(b[k]), f"balance {k} is {b.get(k)!r}")
    expect(isinstance(b.get("caps"), dict) and "per_call_usd" in b["caps"] and "per_day_usd" in b["caps"], f"caps {b.get('caps')!r}")
    expect(b.get("test_money") is True, "a test key's balance does not say test_money: true")
    return f"balance {b['balance_usd']}, held {b['held_usd']} (test money)"


@check("C08", ["IDEM-2", "MONEY-5", "STATE-2", "STATE-5"])
def c08(ctx):
    body = ctx.listen(people=1, pay_per_person_usd="1.00", minutes=2, deadline_minutes=10,
                      script=[{"delay_seconds": 20}])
    q = paid_quote(ctx, body)
    b0 = balance(ctx)
    call = ctx.as_call(body, "hold", max_total=q["total_usd"])
    r1 = ctx.open_call(call)
    b1 = balance(ctx)
    dh = D(b1["held_usd"]) - D(b0["held_usd"])
    expect(dh == D(q["total_usd"]), f"opening held {dh}, the quote's total is {q['total_usd']} (another user of this key would also move it) [MONEY-5]")
    r2 = ctx.api.req("POST", "/v1/calls", call)
    expect(r2.status == r1.status and r2.body.get("call_id") == r1.body["call_id"], f"replay: {r2!r}")
    b2 = balance(ctx)
    expect(b2["held_usd"] == b1["held_usd"] and b2["balance_usd"] == b1["balance_usd"],
           f"the replay moved money: held {b1['held_usd']} -> {b2['held_usd']}, balance {b1['balance_usd']} -> {b2['balance_usd']} [IDEM-2]")
    cid = r1.body["call_id"]
    s = (ctx.results(cid).body or {}).get("summary") or {}
    expect(s.get("taken", 0) >= 1, f"the scripted person did not take the seat at once: summary {s}")
    c = ctx.cancel(cid)
    expect(c.status == 200 and c.body.get("status") == "cancelled", f"cancel: {c!r}")
    mid = ctx.results(cid).body
    expect(mid.get("status") == "cancelled" and mid.get("complete") is False,
           f"with a seat still taken the cancelled call reads status {mid.get('status')}, complete {mid.get('complete')} [STATE-2]")
    expect(isinstance(mid.get("next_check_after_seconds"), int), "no next_check_after_seconds while the taken seat finishes")
    f = ctx.wait_for(cid, limit=40)
    rs = f.get("responses") or []
    mo = f.get("money") or {}
    expect(f.get("complete") is True, "the taken seat never ended")
    expect(D(mo.get("spent_usd")) >= Decimal("1.00"), f"a seat taken when the call was cancelled was not paid: spent {mo.get('spent_usd')} [STATE-5]")
    expect(rs and all(D(x.get("paid_usd")) >= Decimal("1.00") for x in rs), f"the taken seat's response paid {[x.get('paid_usd') for x in rs]} [STATE-5]")
    return f"open held {dh} = total; replay moved nothing; after cancel the call read cancelled/complete:false until the seat ended, then paid in full"


def paid_quote(ctx, body):
    r = ctx.api.req("POST", "/v1/quotes", body)
    expect(r.status == 200, f"quote for a paid simulated call: {r!r}")
    return r.body


@check("C09", ["IDEM-2", "IDEM-3"])
def c09(ctx):
    base = ctx.listen(people=1, pay_per_person_usd="1.00", minutes=2, answer_fields={"felt": "text"})
    q = paid_quote(ctx, base)
    key = ctx.idem("idem-after-error")
    bad = dict(base, max_total_usd="0.01", idempotency_key=key)
    r1 = ctx.open_call(bad, expect_ok=False)
    expect(r1.code == "over_max_total_usd", f"setup: expected over_max_total_usd, got {r1!r}")
    good = dict(base, max_total_usd=q["total_usd"], idempotency_key=key)
    r2 = ctx.open_call(good, expect_ok=False)
    expect(r2.status == 201, f"after an error the same key with a corrected body was not tried afresh: {r2!r} (only success binds)")
    cid = r2.body["call_id"]
    ctx.note_call(cid, "listen", good)
    num = dict(good, pay_per_person_usd=1, max_total_usd=float(q["total_usd"]))
    r3 = ctx.api.req("POST", "/v1/calls", num)
    expect(r3.status == 201 and r3.body.get("call_id") == cid,
           f"the same body with money as numbers (1 vs '1.00') was not treated as the same: {r3!r}")
    ctx.wait_for(cid, limit=20)
    if "outcome" in ctx.features():
        ro = ctx.api.req("POST", f"/v1/calls/{cid}/outcome", {"text": "Thank you; we used your answer.", "idempotency_key": key})
        expect(ro.status == 200, f"the same idempotency_key on another operation was refused: {ro!r} (keys are per operation)")
    return "an error does not bind a key; '1.00' equals 1; keys are scoped per operation"


@check("C10", ["MONEY-5", "SIM-6"])
def c10(ctx):
    tk = ctx.cache.get("test_keys_url")
    if not tk:
        raise Skip("the server issues no test keys, so caps cannot be set")
    r = ctx.api.req("POST", tk, {"class": "test", "caps": {"per_call_usd": "1.00", "per_day_usd": "2.00"}}, key=None)
    expect(r.status in (200, 201) and isinstance(r.body, dict) and r.body.get("key"), f"a test key with caps: HTTP {r.status}")
    caps = r.body.get("caps") or {}
    expect(caps.get("per_call_usd") == "1.00", f"caps not echoed: {caps}")
    capped = r.body["key"]
    body = ctx.listen(people=2, pay_per_person_usd="1.00", minutes=2)
    call = ctx.as_call(body, "capped", max_total="10.00")
    rr = ctx.api.req("POST", "/v1/calls", call, key=capped)
    if isinstance(rr.body, dict):
        ctx.call_errors.append(rr.body)
    e = check_error(rr, "over_key_cap", 402)
    expect(isinstance(e.get("quote"), dict) and isinstance(e.get("approve_url"), str), "over_key_cap lacks quote or approve_url")
    return f"a 1.00 per-call cap refused a {e['quote'].get('total_usd')} call with over_key_cap and an approve_url"


@check("C05", ["MONEY-5", "ERR-2"])
def c05(ctx):
    b = ctx.listen(people=3, pay_per_person_usd="2.00", minutes=2)
    q = paid_quote(ctx, b)
    r = ctx.open_call(ctx.as_call(b, "overmax", max_total="0.01"), expect_ok=False)
    e = check_error(r, "over_max_total_usd", field="max_total_usd")
    expect(D(e.get("example")) == D(q["total_usd"]), f"example {e.get('example')!r} is not the total {q['total_usd']}")
    return f"total {q['total_usd']} over 0.01 -> over_max_total_usd, example {e.get('example')}"


@check("C06", ["ERR-3"])
def c06(ctx):
    errs = [e for e in ctx.call_errors if isinstance(e, dict) and e.get("code")]
    if not errs:
        raise Skip("no error from POST /v1/calls was seen")
    bad = [e.get("code") for e in errs if e.get("charged_usd") != "0.00" or e.get("anyone_asked") is not False]
    expect(not bad, f"errors to POST /v1/calls without charged_usd '0.00' and anyone_asked false: {bad}")
    return f"{len(errs)} errors, each charged_usd 0.00 and anyone_asked false"


# ===============================================================================================================
# Results, the simulated pool, evidence
# ===============================================================================================================
@check("R01", ["STATE-2", "RES-2", "SIM-1"])
def r01(ctx):
    m = main_call(ctx)
    f = m["final"]
    expect(f.get("complete") is True, f"instant simulated call not complete after {m['secs']:.0f} s: status {f.get('status')}")
    expect(f.get("status") == "complete", f"status {f.get('status')!r}, expected complete")
    expect(f.get("next_check_after_seconds") is None, "next_check_after_seconds not null on a complete call")
    s = f.get("summary") or {}
    expect(s.get("answered") == 5, f"summary.answered {s.get('answered')}, expected 5")
    expect(isinstance(f.get("next_step"), str) and f["next_step"].strip(), "results carry no next_step")
    mo = f.get("money") or {}
    expect(D(mo.get("spent_usd", "x")) is not None and D(mo["spent_usd"]) + D(mo["returned_usd"]) == D(mo["held_usd"]),
           f"money at terminal does not balance: {mo}")
    if m["secs"] > 15:
        ctx.notes.append(f"R01: instant pace took {m['secs']:.0f} s to complete (text: within 10 s)")
    return f"complete in {m['secs']:.1f} s"


@check("R02", ["SIM-2", "RES-4", "RES-5"])
def r02(ctx):
    f = main_call(ctx)["final"]
    expect((f.get("summary") or {}).get("simulated") is True, "summary.simulated is not true")
    rs = f.get("responses") or []
    expect(rs, "no responses")
    for x in rs:
        expect(x.get("simulated") is True, f"response {x.get('response_id')} simulated is {x.get('simulated')!r}")
        t = (x.get("answers") or {}).get("felt")
        expect(isinstance(t, str) and t.startswith("[simulated] "), f"text answer {t!r} does not begin '[simulated] '")
    return f"{len(rs)} responses, all simulated:true, text prefixed"


def recount(rs, fields):
    out = {}
    ans = [x for x in rs if x.get("status") == "answered"]
    for name, spec in fields.items():
        t = spec if isinstance(spec, str) else spec["type"]
        vals = [(x.get("answers") or {}).get(name) for x in ans]
        vals = [v for v in vals if v is not None and v != ""]
        if t == "boolean":
            out[name] = {"true": sum(1 for v in vals if v is True), "false": sum(1 for v in vals if v is False)}
        elif t == "choice":
            c = {ch: 0 for ch in spec["choices"]}
            for v in vals:
                for ch in (v if isinstance(v, list) else [v]):
                    c[ch] = c.get(ch, 0) + 1
            out[name] = c
        elif t in ("number", "scale"):
            if vals:
                s = sorted(vals)
                n = len(s)
                med = s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2
                out[name] = {"n": n, "min": s[0], "median": med, "max": s[-1], "_lo": s[(n - 1) // 2], "_hi": s[n // 2]}
            else:
                out[name] = {"n": 0}
        else:
            out[name] = {"n": len(vals)}
    return out


@check("R03", ["RES-3"])
def r03(ctx):
    f = main_call(ctx)["final"]
    tally = (f.get("summary") or {}).get("tally")
    expect(isinstance(tally, dict), "summary has no tally")
    want = recount(f.get("responses") or [], TALLY_FIELDS)
    probs = []
    for name, w in want.items():
        g = tally.get(name)
        if g is None:
            if w.get("n") != 0:
                probs.append(f"{name}: missing")
            continue
        if "n" in w and "min" in w:
            for k in ("n", "min", "max"):
                if g.get(k) != w[k]:
                    probs.append(f"{name}.{k} {g.get(k)} vs {w[k]}")
            if g.get("median") not in (w["median"], w["_lo"], w["_hi"]):
                probs.append(f"{name}.median {g.get('median')} vs {w['median']}")
        elif "n" in w:
            if g.get("n") != w["n"]:
                probs.append(f"{name}.n {g.get('n')} vs {w['n']}")
            extra = set(g) - {"n"}
            if name == "felt" and extra:
                probs.append(f"text tally carries more than n: {sorted(extra)} [RES-3]")
        else:
            for k, v in w.items():
                if g.get(k, 0) != v:
                    probs.append(f"{name}.{k} {g.get(k, 0)} vs {v}")
    expect(not probs, "tally differs from a recount of the responses: " + "; ".join(probs[:6]))
    return "tally equals a recount for text, boolean, scale, choice, multiple choice, number"


COMPACT_KEYS = ["response_id", "simulated", "person_ref", "kind", "status", "partial", "evidence", "level_reason",
                "answers", "answer_input", "minutes", "paid_usd", "receipt_id", "received_at"]


def response_shape_problems(kind, x):
    p = []
    for k in COMPACT_KEYS:
        if k not in x:
            p.append(f"lacks {k}")
    if x.get("kind") is not None and kind and x.get("kind") != kind:
        p.append(f"kind {x.get('kind')!r} but the call is {kind!r}")
    if x.get("status") not in ("answered", "stopped"):
        p.append(f"status {x.get('status')!r}")
    if x.get("evidence") not in LEVELS:
        p.append(f"evidence {x.get('evidence')!r}")
    if not (isinstance(x.get("level_reason"), str) and x["level_reason"].strip()):
        p.append("no level_reason")
    ai = x.get("answer_input") or {}
    for fld, v in (x.get("answers") or {}).items():
        if v is not None and ai.get(fld) not in INPUTS:
            p.append(f"answer_input.{fld} is {ai.get(fld)!r}")
    pu = x.get("paid_usd")
    if not (isinstance(pu, str) and MONEY_RE.match(pu)):
        p.append(f"paid_usd {pu!r}")
    if x.get("status") in ("answered", "stopped") and not x.get("receipt_id"):
        p.append("no receipt_id [RCPT-1]")
    if x.get("received_at") is not None and not TIME_RE.match(str(x["received_at"])):
        p.append(f"received_at {x['received_at']!r}")
    if "record" not in x:
        return p
    rec = x.get("record") or {}
    obs = rec.get("observed") or {}
    for k in OBS_COMMON + OBS_KIND.get(kind, []):
        if k not in obs:
            p.append(f"observed lacks {k} [KIND-1]")
    if obs.get("device") is not None and obs.get("device") not in ("phone", "tablet", "desktop", "unknown"):
        p.append(f"device {obs.get('device')!r}")
    if not isinstance(rec.get("rule"), str):
        p.append("record.rule missing")
    un = rec.get("unobserved") or []
    need = {"unassisted_answer", "same_person"}
    kinds = [kind]
    if kind == "compare":
        kinds = [it.get("kind") for it in (obs.get("items") or []) if isinstance(it, dict)]
        if not all(isinstance(it, dict) and it.get("kind") for it in (obs.get("items") or [])):
            p.append("compare items are not objects with kind")
        for it in obs.get("items") or []:
            if isinstance(it, dict):
                for k in OBS_KIND.get(it.get("kind"), []):
                    if k not in it:
                        p.append(f"compare item ({it.get('kind')}) lacks {k} [KIND-1]")
    for k in kinds:
        if k in ("listen", "watch"):
            need.add("audible")
        if k in ("watch", "view", "play"):
            need.add("eyes_on_screen")
    if not need <= set(un):
        p.append(f"unobserved {un} lacks {sorted(need - set(un))} [KIND-6]")
    if any(u not in UNOBSERVED for u in un):
        p.append(f"unobserved has values outside the registry: {un}")
    ss = obs.get("seat_seconds")
    if isinstance(ss, (int, float)) and isinstance(x.get("minutes"), (int, float)):
        if abs(round(ss / 60, 1) - x["minutes"]) > 0.051:
            p.append(f"minutes {x['minutes']} is not seat_seconds {ss} / 60 to one place")
    return p


@check("R04", ["KIND-1", "KIND-6", "RES-5"])
def r04(ctx):
    m = main_call(ctx)
    c = ctx.api.req("GET", f"/v1/calls/{m['call_id']}/responses")
    expect(c.status == 200, f"compact results: {c!r}")
    rs = c.body.get("responses") or []
    expect(rs, "no responses in the default (compact) results")
    extra = sorted({k for x in rs for k in x if k in ("record", "offer", "claims")})
    expect(not extra, f"the default results carry {extra}; the text keeps them for detail=full")
    probs = []
    for x in rs:
        for pr in response_shape_problems("listen", x):
            probs.append(f"compact {x.get('response_id')}: {pr}")
    nfull = 0
    for cid, kind, x in ctx.responses:
        if "record" in x:
            nfull += 1
            for pr in response_shape_problems(kind, x):
                probs.append(f"{x.get('response_id')}: {pr}")
    expect(nfull, "no detail=full response seen")
    expect(not probs, "; ".join(probs[:6]))
    return f"{len(rs)} compact and {nfull} full responses well formed"


@check("R05", ["EVID-2", "EVID-3", "SIM-4", "SIM-5", "MONEY-8"])
def r05(ctx):
    script = [
        {"delay_seconds": 1, "answers": {"felt": "s1"}},
        {"delay_seconds": 2, "play_fraction": 0.5, "answers": {"felt": "s2"}},
        {"delay_seconds": 3, "realtime": False, "answers": {"felt": "s3"}},
        {"delay_seconds": 4, "visible_fraction": 0.5, "answers": {"felt": "s4"}},
    ]
    want = {"s1": "attended", "s2": "said", "s3": "said", "s4": "said"}
    body = ctx.listen(people=4, pay_per_person_usd="1.00", minutes=2, deadline_minutes=10, script=script,
                      answer_fields={"felt": "text"})
    q = paid_quote(ctx, body)
    runs = []
    for i in (1, 2):
        r = ctx.open_call(ctx.as_call(body, f"evid{i}", max_total=q["total_usd"]))
        runs.append(ctx.wait_for(r.body["call_id"], limit=40))
        ctx.cache.setdefault("evid_call", r.body["call_id"])
    by = []
    for f in runs:
        expect(f.get("complete"), f"scripted call not complete: {f.get('status')}")
        m = {}
        for x in f.get("responses") or []:
            t = (x.get("answers") or {}).get("felt", "")
            m[t.replace("[simulated] ", "", 1)] = x
        by.append(m)
    got = {k: by[0].get(k, {}).get("evidence") for k in want}
    expect(got == want, f"levels {got}, the rules give {want}")
    for k in want:
        x = by[0][k]
        top = D(x.get("top_up_usd") or "0.00")
        expect(D(x.get("paid_usd")) - top == Decimal("1.00"), f"{k} at {x.get('evidence')} paid {x.get('paid_usd')} (top-up {top}) [EVID-3]")
        if x.get("evidence") == "said":
            lr = x.get("level_reason")
            expect(isinstance(lr, str) and lr.strip(), f"{k}: no level_reason on a said response")
    d = []
    for k in want:
        a, b = by[0].get(k), by[1].get(k)
        if not a or not b:
            d.append(f"{k} missing in a run")
            continue
        for fld in ("status", "evidence", "paid_usd"):
            if a.get(fld) != b.get(fld):
                d.append(f"{k}.{fld}")
        dd = diff((a.get("record") or {}).get("observed"), (b.get("record") or {}).get("observed"), f"{k}.observed")
        d += dd
    expect(not d, "same call and script gave different results [SIM-5]: " + "; ".join(d[:5]))
    return "full -> attended; half played, double speed, half visible -> said; all paid 1.00; two runs identical"


@check("R13", ["SIM-7", "SIM-5"])
def r13(ctx):
    fields = {"felt": "text", "again": "boolean", "pick": {"type": "choice", "choices": ["a", "b", "c"]},
              "stars": {"type": "scale", "min": 1, "max": 4}, "n": {"type": "number", "min": 2, "max": 9},
              "note": {"type": "text", "optional": True}}
    body = ctx.listen(people=3, answer_fields=fields, script=[{"delay_seconds": 1}] * 3)
    r = ctx.open_call(ctx.as_call(body, "defaults"))
    f = ctx.wait_for(r.body["call_id"], limit=30)
    rs = f.get("responses") or []
    expect(len(rs) == 3, f"{len(rs)} responses")
    probs = []
    for n, x in enumerate(rs, start=1):
        a = x.get("answers") or {}
        if a.get("again") is not (n % 2 == 1):
            probs.append(f"seat {n}: again {a.get('again')!r}")
        if a.get("pick") != ["a", "b", "c"][(n - 1) % 3]:
            probs.append(f"seat {n}: pick {a.get('pick')!r}")
        if a.get("stars") != 2:
            probs.append(f"seat {n}: stars {a.get('stars')!r} (middle of 1..4 rounded down is 2)")
        if a.get("n") != 2:
            probs.append(f"seat {n}: n {a.get('n')!r} (min is 2)")
        for t in ("felt", "note"):
            if not (isinstance(a.get(t), str) and a[t].startswith("[simulated] ")):
                probs.append(f"seat {n}: {t} {a.get(t)!r}")
        o = (x.get("record") or {}).get("observed") or {}
        for k, v in (("pauses", 0), ("replays", 0), ("seeks_forward", 0), ("stalled_seconds", 0), ("device", "phone"),
                     ("completed", True)):
            if o.get(k) != v:
                probs.append(f"seat {n}: observed.{k} {o.get(k)!r}, default {v!r}")
    expect(not probs, "; ".join(probs[:6]))
    return "generated answers and observed defaults follow SIM-7 for seats 1 to 3"


@check("R06", ["EVID-2", "KIND-3"])
def r06(ctx):
    body = {"ask": "Look at this headline. Is it clear?", "kind": "view",
            "content": {"text": "Ship faster with fewer meetings."}, "people": 2,
            "script": [{"delay_seconds": 1}, {"delay_seconds": 2, "revealed": False, "visible_seconds": 3}]}
    r = ctx.open_call(ctx.as_call(body, "view"))
    f = ctx.wait_for(r.body["call_id"], limit=40)
    rs = f.get("responses") or []
    expect(len(rs) == 2, f"{len(rs)} responses")
    got = sorted(((x.get("record") or {}).get("observed", {}).get("visible_seconds"), x.get("evidence"),
                  (x.get("record") or {}).get("observed", {}).get("revealed")) for x in rs)
    expect(got == [(3, "said", True), (20, "attended", True)],
           f"(visible_seconds, level, revealed) {got}; text is always revealed, 20 s default -> attended, 3 s -> said")
    return "text view: 20 s -> attended, 3 s -> said, revealed true for text"


@check("R07", ["EVID-2"])
def r07(ctx):
    body = {"ask": "In one sentence, what would make you trust a new app with your calendar?", "kind": "answer",
            "people": 2}
    r = ctx.open_call(ctx.as_call(body, "answer"))
    f = ctx.wait_for(r.body["call_id"], limit=40)
    rs = f.get("responses") or []
    expect(rs, "no responses")
    bad = [x.get("evidence") for x in rs if x.get("evidence") not in ("said", "voiced")]
    expect(not bad, f"answer kind returned {bad}; the rule says never attended")
    return "answer kind -> said"


@check("R08", ["KIND-2"])
def r08(ctx):
    if "compare" not in (ctx.disc or {}).get("kinds", KINDS):
        raise Skip("compare not offered")
    body = {"ask": "Which of these two headlines is clearer?", "kind": "compare",
            "content": [{"text": "Version A: Get started"}, {"text": "Version B: Try it free"}], "people": 4,
            "answer_fields": {"preferred": {"type": "choice", "choices": ["A", "B"]}},
            "script": [{"delay_seconds": 1, "order": [1, 0]}]}
    r = ctx.open_call(ctx.as_call(body, "compare"))
    f = ctx.wait_for(r.body["call_id"], limit=40)
    rs = f.get("responses") or []
    expect(rs, "no responses")
    orders = []
    for x in rs:
        obs = (x.get("record") or {}).get("observed") or {}
        o = obs.get("order")
        expect(isinstance(o, list) and sorted(o) == [0, 1], f"order {o!r} is not a permutation of the items")
        items = obs.get("items")
        expect(isinstance(items, list) and len(items) == 2, f"items {items!r}")
        orders.append(tuple(o))
    expect((1, 0) in orders, f"the scripted order [1, 0] was not reported: {orders} [SIM-5]")
    return f"orders {orders}"


@check("R09", ["RES-1", "RES-2", "IDEM-4", "STATE-2"])
def r09(ctx):
    body = ctx.listen(people=2, pace="human", deadline_minutes=30)
    r = ctx.open_call(ctx.as_call(body, "human"))
    cid = r.body["call_id"]
    t0 = time.monotonic()
    rr = ctx.results(cid, wait=5)
    el = time.monotonic() - t0
    expect(rr.status == 200, f"results: {rr!r}")
    expect(el <= 5 + 5 + 2, f"results with wait_seconds=5 took {el:.1f} s [RES-1]")
    b = rr.body
    if not b.get("complete"):
        n = b.get("next_check_after_seconds")
        expect(isinstance(n, int) and 1 <= n <= 300, f"next_check_after_seconds {n!r} on an incomplete call")
    else:
        ctx.notes.append("R09: a human-pace call was complete within 5 s")
    c1 = ctx.cancel(cid)
    expect(c1.status == 200 and c1.body.get("status") in ("cancelled", "complete", "expired"), f"cancel: {c1!r}")
    c2 = ctx.cancel(cid)
    expect(c2.status == 200 and c2.body.get("status") == c1.body.get("status"), f"second cancel: {c2!r} [IDEM-4]")
    f = ctx.results(cid).body
    expect(f.get("status") == c1.body.get("status"), f"results status {f.get('status')} after cancel")
    if f.get("complete") is True:
        expect(f.get("next_check_after_seconds") is None, "complete with a next_check_after_seconds")
    else:
        taken = (f.get("summary") or {}).get("taken", 0)
        expect(taken >= 1, f"cancelled, nobody in a seat, yet complete is false [STATE-2]")
        expect(isinstance(f.get("next_check_after_seconds"), int), "no next_check_after_seconds while seats finish")
    return f"wait 5 answered in {el:.1f} s; cancel twice -> {c1.body.get('status')}; complete {f.get('complete')} with {(f.get('summary') or {}).get('taken', 0)} taken"


@check("R10", ["RES-8", "MONEY-9", "RCPT-1"])
def r10(ctx):
    m = main_call(ctx)
    r = ctx.results(m["call_id"], detail="full")
    expect(r.status == 200, f"detail=full: {r!r}")
    rs = r.body.get("responses") or []
    expect(rs, "no responses")
    for x in rs:
        o = x.get("offer")
        expect(isinstance(o, dict), f"response {x.get('response_id')} has no offer [RES-8]")
        miss = [k for k in OFFER_KEYS if k not in o]
        expect(not miss, f"offer lacks keys {miss} (a key the server cannot state is null) [RES-8]")
        expect(o.get("unpaid") is True and o.get("pay_per_person_usd") in ("0.00", None),
               f"offer on an unpaid call: unpaid {o.get('unpaid')!r}, pay {o.get('pay_per_person_usd')!r} [MONEY-9]")
        expect(o.get("asker_is_ai") is True, "offer.asker_is_ai is not true")
        expect(isinstance(x.get("receipt_jws"), str), "detail=full carries no receipt_jws")
        _, pay = verify_jws(ctx, x["receipt_jws"])
        expect(pay.get("receipt_id") == x.get("receipt_id"), "receipt_jws is another seat's receipt")
    return f"offer carries all {len(OFFER_KEYS)} keys; unpaid shown; receipt_jws verifies"


@check("R11", ["RES-1", "RES-2"])
def r11(ctx):
    m = main_call(ctx)
    f = m["final"]
    cur = f.get("cursor")
    expect(cur is not None, "results carry no cursor")
    r = ctx.results(m["call_id"], after=cur)
    expect(r.status == 200, f"after=cursor: {r!r}")
    expect(not r.body.get("responses"), f"after the last cursor {len(r.body.get('responses') or [])} responses came back again")
    t0 = time.monotonic()
    r2 = ctx.results(m["call_id"], wait=999)
    expect(r2.status == 200, f"wait_seconds=999 was refused: {r2!r} (it is clamped to the maximum)")
    mx = ctx.limits().get("max_wait_seconds", 20)
    expect(time.monotonic() - t0 <= mx + 5 + 2, "wait_seconds=999 on a complete call took longer than the maximum")
    return "after=<cursor> returns nothing already seen; wait_seconds=999 is clamped"


@check("R12", ["RES-6", "EVID-2", "PRIV-2"])
def r12(ctx):
    ctx.need("voice")
    body = ctx.listen(people=1, voice={"max_seconds": 30}, answer_fields={"felt": "text"},
                      script=[{"delay_seconds": 1, "voice_seconds": 6, "share_recording": False}])
    r = ctx.open_call(ctx.as_call(body, "voice"), expect_ok=False)
    if r.status != 201:
        if r.code == "unsupported_feature":
            check_error(r, "unsupported_feature", field_pred=lambda f: "voice" in f)
            raise Skip("the server takes no spoken answers (unsupported_feature, fixable)")
        raise Fail(f"a call with voice: {r!r}")
    cid = r.body["call_id"]
    ctx.note_call(cid, "listen", body)
    f = ctx.wait_for(cid, limit=30)
    rs = f.get("responses") or []
    expect(rs, "no response")
    v = rs[0].get("voice")
    expect(isinstance(v, dict), f"voice is {v!r} after a scripted 6-second spoken answer")
    expect(v.get("recording_url") is None, "recording_url is set without the person's yes [RES-6]")
    expect(v.get("transcript_status") in ("ready", "pending", "none"), f"transcript_status {v.get('transcript_status')!r}")
    if v.get("transcript_status") != "ready":
        expect(not v.get("transcript"), "a transcript reached the agent while not ready [RES-6]")
    expect(((rs[0].get("record") or {}).get("observed") or {}).get("voice_seconds") == 6, "observed.voice_seconds is not 6")
    expect(rs[0].get("evidence") == "voiced", f"full play plus 6 s spoken answer gave {rs[0].get('evidence')}, the rule gives voiced")
    return f"voice {v.get('seconds')} s, recording_url null, level voiced"


# ===============================================================================================================
# Pay by the table (section 12.3), money settling
# ===============================================================================================================
def pay_call(ctx):
    if "pay" not in ctx.cache:
        script = [
            {"accept": False, "delay_seconds": 1},
            {"accept": "miss", "delay_seconds": 1},
            {"stop_at_fraction": 0.4, "delay_seconds": 2, "answers": {"felt": "stop-plain"}},
            {"stop_at_fraction": 0.25, "stop_reason": "upset", "delay_seconds": 3, "answers": {"felt": "stop-upset"}},
        ]
        body = ctx.listen(people=4, pay_per_person_usd="2.00", minutes=2, deadline_minutes=30, script=script,
                          answer_fields={"felt": "text"})
        q = paid_quote(ctx, body)
        r = ctx.open_call(ctx.as_call(body, "pay", max_total=q["total_usd"]))
        cid = r.body["call_id"]

        def scripted_done(b):
            s = b.get("summary") or {}
            return (s.get("declined", 0) >= 1 and s.get("missed", 0) >= 1 and s.get("stopped", 0) >= 2)
        f = ctx.wait_for(cid, limit=45, done=scripted_done)
        if not f.get("complete"):
            # Give the default seats a moment, then cancel so the call settles.
            f = ctx.wait_for(cid, limit=10)
            if not f.get("complete"):
                ctx.cancel(cid)
                f = ctx.results(cid).body
        full = ctx.results(cid, detail="full").body
        ctx.cache["pay"] = {"quote": q, "call_id": cid, "final": f, "full": full, "open": r.body}
    return ctx.cache["pay"]


@check("M01", ["MONEY-8", "STATE-2", "SIM-5"])
def m01(ctx):
    p = pay_call(ctx)
    f = p["final"]
    s = f.get("summary") or {}
    expect(s.get("declined", 0) >= 1, f"summary.declined {s.get('declined')} after a scripted decline")
    nst = sum(1 for x in f.get("responses") or [] if x.get("status") == "stopped")
    expect(nst == s.get("stopped"), f"{nst} stopped responses returned, summary.stopped {s.get('stopped')} (every stopped seat is returned)")
    expect(s.get("missed", 0) >= 1, f"summary.missed {s.get('missed')} after a scripted miss")
    rs = {((x.get("answers") or {}).get("felt") or "").replace("[simulated] ", "", 1): x for x in f.get("responses") or []}
    plain, upset = rs.get("stop-plain"), rs.get("stop-upset")
    expect(plain and upset, f"the two scripted stops were not returned (keys {sorted(rs)[:8]})")
    stop_min = (ctx.limits() or {}).get("stop_minimum_usd") or "0.00"
    for x, why in ((plain, "stopped"), (upset, "upset")):
        expect(x.get("status") == "stopped", f"scripted stop has status {x.get('status')!r}")
        expect(x.get("partial") is True, "a stopped response is not marked partial")
        expect(x.get("stop_reason") == why, f"stop_reason {x.get('stop_reason')!r}, scripted {why!r}")
    ss = ((plain.get("record") or {}).get("observed") or {}).get("seat_seconds")
    want = stop_pay("2.00", ss, 2, stop_min)
    expect(want is not None and D(plain.get("paid_usd")) >= want,
           f"stop at seat_seconds {ss} paid {plain.get('paid_usd')}, the formula gives {want} [MONEY-8]")
    if D(plain.get("paid_usd")) > want:
        ctx.notes.append(f"M01: a stop paid {plain.get('paid_usd')}, above the formula's {want} (allowed: at least)")
    expect(ss is not None and abs(ss - 48) <= 0.5, f"stop_at_fraction 0.4 of 2 minutes gave seat_seconds {ss}; the script default is 48")
    expect(upset.get("paid_usd") == "2.00", f"upset stop paid {upset.get('paid_usd')}, the table says 2.00")
    ans = [x for x in f.get("responses") or [] if x.get("status") == "answered"]
    expect(all(D(x.get("paid_usd")) - D(x.get("top_up_usd") or "0") == Decimal("2.00") for x in ans),
           f"answered seats paid {[x.get('paid_usd') for x in ans]}")
    expect(f.get("complete") is True, f"call not terminal after cancel: {f.get('status')}")
    return f"stop at {ss} s paid {plain.get('paid_usd')}; upset paid 2.00; {len(ans)} answered at 2.00; status {f.get('status')}"


@check("M02", ["MONEY-5", "MONEY-6", "MONEY-7", "STATE-2"])
def m02(ctx):
    p = pay_call(ctx)
    f = p["final"]
    mo = f.get("money") or {}
    expect(D(mo.get("held_usd")) == D(p["quote"]["total_usd"]), f"held {mo.get('held_usd')} != quote total {p['quote']['total_usd']}")
    expect(D(mo["spent_usd"]) + D(mo["returned_usd"]) == D(mo["held_usd"]), f"terminal money does not balance: {mo}")
    total = Decimal(0)
    n = 0
    for x in f.get("responses") or []:
        rid = x.get("receipt_id")
        if not rid:
            continue
        rr = ctx.receipt(rid)
        if rr.status != 200:
            raise Fail(f"receipt {rid}: {rr!r}")
        rc = rr.body.get("receipt") or {}
        total += D(rc.get("paid_usd", "0")) + sum((D(fe.get("amount_usd", "0")) for fe in rc.get("fees") or []), Decimal(0))
        n += 1
    gap = D(mo["spent_usd"]) - total
    if gap != 0:
        extra = [D(v) for k, v in mo.items() if k.endswith("_usd") and k not in ("held_usd", "spent_usd", "returned_usd") and D(v) is not None]
        extra += [D(ln.get("amount_usd")) for ln in mo.get("lines") or [] if isinstance(ln, dict) and D(ln.get("amount_usd")) is not None]
        expect(gap in extra, f"spent {mo['spent_usd']} != receipts' pay and fee shares ({total}) and no true-up line of {gap} "
                             f"is shown in money {sorted(mo)} [MONEY-6, MONEY-7]")
    return f"held {mo['held_usd']} = spent {mo['spent_usd']} + returned {mo['returned_usd']}; spent = receipts' pay + fees"


@check("M03", ["MONEY-9"])
def m03(ctx):
    f = main_call(ctx)["final"]
    expect(f.get("responses"), "no responses on the unpaid call")
    bad = [x.get("paid_usd") for x in f.get("responses") or [] if x.get("paid_usd") != "0.00"]
    expect(not bad, f"unpaid call paid {bad}")
    return "every seat on an unpaid call paid 0.00"


@check("M04", ["STATE-3", "STATE-2"])
def m04(ctx):
    e = ctx.cache.get("expiry")
    if not e:
        raise Skip("the expiry call was not opened")
    left = 65 - (time.monotonic() - e["t0"])
    if left > 0:
        if left > ctx.time_left() - 5:
            raise Skip("not enough time left to see the deadline pass")
        time.sleep(left)
    r = ctx.api.req("GET", f"/v1/calls/{e['call_id']}")
    expect(r.status == 200, f"GET call: {r!r}")
    ctx.observe(e["call_id"], r.body)
    expect(r.body.get("status") == "expired", f"a call 65 s past a 1-minute deadline reads {r.body.get('status')!r} [STATE-3]")
    f = ctx.results(e["call_id"]).body
    s = f.get("summary") or {}
    if s.get("taken", 0) > 0:
        # STATE-2: people in a seat may finish, so complete stays false until they do
        expect(f.get("complete") is False, f"expired with {s.get('taken')} seat(s) still taken, yet complete is true [STATE-2]")
        return "past its deadline the call reads expired; seats still taken, so not yet complete (STATE-2)"
    expect(f.get("complete") is True, "expired call with no seat taken is not complete")
    mo = f.get("money") or {}
    expect(D(mo["spent_usd"]) + D(mo["returned_usd"]) == D(mo["held_usd"]), f"expired call money {mo}")
    return "past its deadline the call reads expired, complete, settled"


# ===============================================================================================================
# Receipts and the outcome line
# ===============================================================================================================
def verify_jws(ctx, jws):
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    parts = jws.split(".")
    expect(len(parts) == 3, "JWS is not compact (three parts)")
    hdr = json.loads(b64u_dec(parts[0]))
    pay = json.loads(b64u_dec(parts[1]))
    expect(hdr.get("alg") == "EdDSA", f"alg {hdr.get('alg')!r}")
    kid = hdr.get("kid")
    expect(kid, "no kid in the JWS header")
    if ctx.jwks is None:
        d03(ctx)
    keys = list(ctx.jwks.get("keys") or []) + [k for k in (ctx.jwks.get("revoked") or []) if isinstance(k, dict)]
    jwk = next((k for k in keys if k.get("kid") == kid), None)
    expect(jwk is not None, f"kid {kid} not in the JWKS [DISC-4]")
    pk = Ed25519PublicKey.from_public_bytes(b64u_dec(jwk["x"]))
    try:
        pk.verify(b64u_dec(parts[2]), f"{parts[0]}.{parts[1]}".encode())
    except Exception:
        raise Fail("signature does not verify against the JWKS key")
    return hdr, pay


@check("K01", ["RCPT-1", "DISC-4"])
def k01(ctx):
    f = main_call(ctx)["final"]
    x = (f.get("responses") or [None])[0]
    expect(x and x.get("receipt_id"), "no receipt_id on an answered response")
    r = ctx.receipt(x["receipt_id"])
    expect(r.status == 200 and isinstance(r.body, dict), f"GET receipt: {r!r}")
    expect(isinstance(r.body.get("jws"), str), "receipt has no jws")
    hdr, pay = verify_jws(ctx, r.body["jws"])
    expect(pay == r.body.get("receipt"), "the JWS payload differs from the receipt object served beside it")
    missing = [k for k in RECEIPT_FIELDS if k not in pay]
    expect(not missing, f"receipt payload lacks {missing}")
    expect(pay["receipt_id"] == x["receipt_id"], "receipt_id differs")
    expect(pay["seat_status"] == x.get("status") and pay["paid_usd"] == x.get("paid_usd"),
           f"receipt seat_status/paid {pay['seat_status']}/{pay['paid_usd']} vs response {x.get('status')}/{x.get('paid_usd')}")
    expect(pay["simulated"] is True and pay["test_money"] is True and pay["unpaid"] is True,
           "receipt of a simulated unpaid test call does not say simulated, test_money and unpaid")
    expect(MONEY_RE.match(str(pay["paid_usd"])), "receipt paid_usd not a money string")
    ctx.cache["receipt_main"] = r.body
    return f"kid {hdr['kid']}, signature verifies, {len(pay)} fields"


@check("K02", ["RCPT-3", "RCPT-4"])
def k02(ctx):
    rb = ctx.cache.get("receipt_main")
    if not rb:
        k01(ctx)
        rb = ctx.cache["receipt_main"]
    r = ctx.api.req("POST", "/v1/receipts/verify", {"jws": rb["jws"]}, key=None)
    expect(r.status == 200 and isinstance(r.body, dict), f"verify: {r!r}")
    expect(r.body.get("valid") is True and r.body.get("revoked") is False and r.body.get("kid"), f"verify answered {r.body}")
    expect(r.body.get("on_record") is True, f"a receipt the server issued has on_record {r.body.get('on_record')!r} [RCPT-4]")
    expect(r.body.get("receipt") == rb["receipt"], "verify returned another receipt")
    h, p, sg = rb["jws"].split(".")
    pay = json.loads(b64u_dec(p))
    pay["paid_usd"] = "999.00"
    forged = f"{h}.{b64u_enc(json.dumps(pay).encode())}.{sg}"
    r2 = ctx.api.req("POST", "/v1/receipts/verify", {"jws": forged}, key=None)
    expect(r2.status == 200 and r2.body.get("valid") is False, f"a tampered receipt was not reported invalid: {r2!r}")
    expect(r2.body.get("on_record") is False, f"a tampered receipt has on_record {r2.body.get('on_record')!r}")
    expect(isinstance(r2.body.get("receipt"), dict) and r2.body["receipt"].get("paid_usd") == "999.00" and r2.body.get("kid"),
           "a JWS whose signature fails does not come back with its decoded payload and kid")
    for bad in ({"jws": "not-a-jws"}, {}):
        r3 = ctx.api.req("POST", "/v1/receipts/verify", bad, key=None)
        expect(r3.status == 200 and isinstance(r3.body, dict), f"verify {bad}: {r3!r} (always 200 with a JSON body)")
        want = {"valid": False, "receipt": None, "kid": None, "revoked": False, "on_record": False}
        got = {k: r3.body.get(k, "absent") for k in want}
        expect(got == want, f"verify {bad} answered {got}, the text gives {want}")
    return "genuine -> valid, on record; tampered -> invalid, decoded, not on record; malformed and missing -> 200 valid:false"


@check("K03", ["RCPT-1"])
def k03(ctx):
    f = pay_call(ctx)["final"]
    st = [x for x in f.get("responses") or [] if x.get("status") == "stopped"]
    expect(st, "no stopped response")
    for x in st:
        expect(x.get("receipt_id"), "a stopped seat has no receipt")
        rr = ctx.receipt(x["receipt_id"])
        expect(rr.status == 200, f"receipt of a stopped seat: {rr!r}")
        _, pay = verify_jws(ctx, rr.body["jws"])
        expect(pay.get("seat_status") == "stopped" and pay.get("paid_usd") == x.get("paid_usd"),
               f"stopped receipt says {pay.get('seat_status')} {pay.get('paid_usd')}")
        expect(pay.get("unpaid") is False and pay.get("fees") is not None, "paid receipt says unpaid or has no fees")
    return f"{len(st)} stopped seats each have a verifying receipt"


@check("O01", ["OUT-2", "OUT-3", "IDEM-1", "IDEM-2"])
def o01(ctx):
    ctx.need("outcome")
    m = main_call(ctx)
    cid = m["call_id"]
    text = "Two of five drifted at the bridge, so the bridge is now eight bars shorter."
    r = ctx.api.req("POST", f"/v1/calls/{cid}/outcome", {"text": text})
    expect(r.status == 200, f"outcome without idempotency_key: {r!r}")
    expect(r.body.get("status") in ("delivered", "held") and isinstance(r.body.get("people"), int), f"outcome answered {r.body}")
    r2 = ctx.api.req("POST", f"/v1/calls/{cid}/outcome", {"text": text})
    expect(r2.status == 200 and r2.body == r.body, f"the same line again within seconds differs: {r2!r} [IDEM-1, IDEM-2]")
    ctx.cache["out_n"] = 1
    cg = ctx.api.req("GET", f"/v1/calls/{cid}")
    outs = cg.body.get("outcomes") if isinstance(cg.body, dict) else None
    expect(isinstance(outs, list) and len(outs) == 1 and outs[0].get("text") == text and outs[0].get("status") == r.body["status"],
           f"the call's outcomes {json.dumps(outs)[:160]} do not list the line once with its status [OUT-3]")
    if r.body["status"] != "delivered":
        raise Skip("the line was held; receipt revision not checkable")
    x = (m["final"].get("responses") or [None])[0]
    ctx.cache.pop(("receipt", x["receipt_id"]), None)
    rr = ctx.receipt(x["receipt_id"])
    expect(rr.status == 200, f"receipt after outcome: {rr!r}")
    _, pay = verify_jws(ctx, rr.body["jws"])
    outs_r = pay.get("outcomes")
    expect(pay.get("rev") == 2 and isinstance(outs_r, list) and text in [o if isinstance(o, str) else (o or {}).get("text") for o in outs_r],
           f"after the outcome the receipt has rev {pay.get('rev')} outcomes {json.dumps(outs_r)[:120]}")
    old = ctx.cache.get("receipt_main")
    if old:
        v = ctx.api.req("POST", "/v1/receipts/verify", {"jws": old["jws"]}, key=None)
        expect(v.status == 200 and v.body.get("valid") is True, "the rev 1 receipt no longer verifies [OUT-2]")
    return f"delivered to {r.body['people']}; repeat was a retry; call lists it; receipt rev 2 with it in outcomes; rev 1 verifies"


@check("O02", ["OUT-3"])
def o02(ctx):
    ctx.need("outcome")
    m = main_call(ctx)
    cid = m["call_id"]
    n = ctx.cache.get("out_n", 0)
    for i in range(n + 1, 4):
        r = ctx.api.req("POST", f"/v1/calls/{cid}/outcome",
                        {"text": f"Follow-up {i}: thank you; the change is live.", "idempotency_key": ctx.idem(f"out{i}")})
        expect(r.status == 200, f"outcome line {i}: {r!r}")
    ctx.cache["out_n"] = 3
    r4 = ctx.api.req("POST", f"/v1/calls/{cid}/outcome", {"text": "A fourth line.", "idempotency_key": ctx.idem("out4")})
    check_error(r4, "outcome_not_allowed", 409)
    return "three lines accepted, the fourth -> outcome_not_allowed"


@check("O03", ["OUT-1"])
def o03(ctx):
    ctx.need("outcome")
    cid = ctx.cache.get("evid_call")
    if not cid:
        r = ctx.open_call(ctx.as_call(ctx.listen(people=1), "out-screen"))
        cid = r.body["call_id"]
        ctx.wait_for(cid, limit=30)
    r = ctx.api.req("POST", f"/v1/calls/{cid}/outcome",
                    {"text": "[TEST: asks the person for a one-time login code] Type the six-digit code you just received by text.",  # the SCREEN-7 fixture's words, verbatim
                     "idempotency_key": ctx.idem("out-bad")})
    if r.status == 200:
        expect(r.body.get("status") == "held", f"a barred outcome line was delivered: {r.body} [OUT-1]")
        return "barred line held"
    e = check_error(r, "refused_screening", 422)
    return f"barred line refused ({e.get('category')})"


# ===============================================================================================================
# not found, other principals
# ===============================================================================================================
@check("N01", ["HTTP-1", "HTTP-2"])
def n01(ctx):
    r = ctx.api.req("GET", f"/v1/calls/call_{ctx.run}nonexistent")
    a = check_error(r, "not_found", 404)
    r2 = ctx.api.req("GET", f"/v1/calls/call_{ctx.run}nonexistent/responses")
    check_error(r2, "not_found", 404)
    if not ctx.key2:
        raise Skip("no second test key: the other-principal half needs test_keys or --key2")
    m = main_call(ctx)
    for path, meth, body in ((f"/v1/calls/{m['call_id']}", "GET", None),
                             (f"/v1/calls/{m['call_id']}/responses", "GET", None),
                             (f"/v1/calls/{m['call_id']}/cancel", "POST", {}),
                             (f"/v1/calls/{m['call_id']}/outcome", "POST", {"text": "x", "idempotency_key": ctx.idem("o-other")})):
        rr = ctx.api.req(meth, path, body, key=ctx.key2)
        b = check_error(rr, "not_found", 404)
        expect(set(b) == set(a), f"{meth} {path} by another principal is shaped differently from a missing call: {sorted(b)} vs {sorted(a)}")
    return "random id and another principal's call -> identical 404 not_found"


# ===============================================================================================================
# Screening
# ===============================================================================================================
FIXTURES_PATH = os.path.join(ROOT, "spec", "screening_fixtures.json")
# Fallback when the published fixtures are absent (spec/screening_fixtures.json, SCREEN-7, wins when present).
FORBIDDEN = [
    {"category": "credentials", "kind": "answer",
     "ask": "[TEST: asks the person for a one-time login code] Type the six-digit code you just received by text."},
    {"category": "personal_data", "kind": "answer",
     "ask": "[TEST: asks the person for their home address and phone number] Write your home address and phone number."},
    {"category": "minors", "kind": "answer",
     "ask": "[TEST: aimed at children] This call is for children under 13: tell us your school and age."},
]
BENIGN = [
    {"kind": "view", "content": {"text": "Sign in to your account. [Email] [Password] [Sign in]"},
     "ask": "Is this login page clear? Look at it for ten seconds and say what you would tap first."},
    {"kind": "answer", "ask": "Without naming anyone, how do you usually decide whether to trust a new app?"},
]
FIXTURES_SOURCE = "built-in fallback"
try:
    with open(FIXTURES_PATH) as _f:
        _fx = json.load(_f)
    if _fx.get("forbidden") and _fx.get("allowed"):
        FORBIDDEN = [dict(c) for c in _fx["forbidden"]]
        BENIGN = [dict(c) for c in _fx["allowed"]]
        FIXTURES_SOURCE = f"spec/screening_fixtures.json ({len(FORBIDDEN)} forbidden, {len(BENIGN)} allowed)"
except Exception:
    pass


def fixture_body(c, people=1):
    b = {"ask": c["ask"], "kind": c.get("kind", "answer"), "people": people}
    if c.get("content") is not None:
        b["content"] = c["content"]
    return b


@check("S01", ["SCREEN-1", "SCREEN-2", "SCREEN-3", "SCREEN-6", "SCREEN-7", "PEOPLE-1", "ERR-3"])
def s01(ctx):
    out, mism = [], []
    ks = set((ctx.disc or {}).get("kinds", KINDS))
    for i, c in enumerate(FORBIDDEN):
        cat = c.get("category", f"case{i}")
        if c.get("kind", "answer") not in ks:
            out.append(f"{cat}:kind-not-offered")
            continue
        b = ctx.as_call(fixture_body(c), f"bad-{i}")
        r = ctx.open_call(b, expect_ok=False)
        if r.status == 201:
            cid = r.body.get("call_id")
            ctx.note_call(cid, b["kind"], b)
            if cat in ("minors", "sexual", "violent", "medical", "grief"):
                ctx.cancel(cid)
                raise Fail(f"[{cat}] fixture opened (would be held); SCREEN-7 says refuse, not hold")
            qb = dict(b)
            qb.pop("max_total_usd", None)
            qb.pop("idempotency_key", None)
            qr = ctx.api.req("POST", "/v1/quotes", qb)
            expect(qr.status == 200 and qr.body.get("would_be_held") is True and qr.body.get("held_reason"),
                   f"[{cat}] the quote of a would-be-held call does not say would_be_held with held_reason: {qr!r} [SCREEN-6]")
            s = (r.body.get("summary") or {})
            if not s.get("would_be_held") and r.body.get("status") != "held":
                s = (ctx.results(cid).body or {}).get("summary") or {}
            ctx.cancel(cid)
            expect(s.get("would_be_held") is True, f"[{cat}] forbidden fixture opened on the simulated pool, neither refused nor would_be_held [SCREEN-7]")
            expect(s.get("held_reason") or r.body.get("held_reason"), f"[{cat}] would_be_held without held_reason")
            out.append(f"{cat}:held")
            continue
        e = check_error(r, "refused_screening", 422)
        expect(e.get("category") in CATEGORIES, f"[{cat}] category {e.get('category')!r} not in the registry")
        expect(e.get("rule") and isinstance(e.get("rule_text"), str), f"[{cat}] refusal lacks rule or rule_text")
        if cat == "minors":
            expect(e.get("category") == "minors", f"a call aimed at children refused under {e.get('category')!r} [PEOPLE-1]")
        elif e.get("category") != cat:
            mism.append(f"{cat}->{e.get('category')}")
        if not e.get("fixable"):
            expect(re.search(r"\b(stop|tell)\b", e.get("message", ""), re.I), f"[{cat}] unfixable refusal does not tell the agent to stop and tell its user")
        out.append(f"{cat}:refused")
    if mism:
        ctx.notes.append("S01: refused under another category than the fixture's: " + ", ".join(mism))
    return f"{FIXTURES_SOURCE}: " + " ".join(out)


@check("S02", ["SCREEN-2", "SCREEN-7"])
def s02(ctx):
    out = []
    held = 0
    ks = set((ctx.disc or {}).get("kinds", KINDS))
    for i, c in enumerate(BENIGN):
        if c.get("kind", "answer") not in ks:
            continue
        b = ctx.as_call(fixture_body(c), f"ok-{i}")
        r = ctx.open_call(b, expect_ok=False)
        expect(r.status == 201, f"allowed fixture {i + 1} was refused: {r.code} {json.dumps(r.body)[:160]} [SCREEN-7]")
        cid = r.body["call_id"]
        ctx.note_call(cid, b["kind"], b)
        s = r.body.get("summary") or {}
        if s.get("would_be_held") or r.body.get("status") == "held":
            held += 1
        ctx.cancel(cid)
        out.append(str(i + 1))
    if held:
        ctx.notes.append(f"S02: {held} allowed fixture call(s) would be held (not refused)")
    return f"allowed fixtures {','.join(out)} opened; {held} would be held"


# ===============================================================================================================
# MCP
# ===============================================================================================================
def mcp_run(ctx, coro_fn):
    import httpx2
    from mcp import Client
    from mcp.client.streamable_http import streamable_http_client

    async def go():
        hc = httpx2.AsyncClient(headers={"Authorization": f"Bearer {ctx.api.key}", **ctx.api.extra},
                                timeout=httpx2.Timeout(30.0, read=90.0))
        async with hc:
            async with Client(streamable_http_client(ctx.disc["mcp"], http_client=hc)) as c:
                return await coro_fn(c)
    return asyncio.run(asyncio.wait_for(go(), timeout=120))


def tool_json(res):
    d = res.model_dump(by_alias=True, mode="json", exclude_none=False)
    return d


@check("P01", ["MCP-1", "MCP-5", "MCP-6"], group="mcp")
def p01(ctx):
    t = ctx.tool
    want = {t, f"{t}_quote", f"{t}_results", f"{t}_cancel"}
    if "outcome" in ctx.features():
        want.add(f"{t}_send_outcome")
    if "panels" in ctx.features():
        want.add(f"{t}_panel")

    async def body(c):
        lt = await c.list_tools()
        return c.protocol_version, [x.model_dump(by_alias=True, mode="json") for x in lt.tools]
    pv, tools = mcp_run(ctx, body)
    ctx.cache["mcp_tools"] = tools
    names = {x["name"] for x in tools}
    expect(want <= names, f"tools {sorted(names)} lack {sorted(want - names)}")
    probs = []
    by = {x["name"]: x for x in tools}
    for n in want:
        x = by[n]
        if not x.get("outputSchema"):
            probs.append(f"{n}: no outputSchema")
        a = x.get("annotations") or {}
        if n in (f"{t}_quote", f"{t}_results") and a.get("readOnlyHint") is not True:
            probs.append(f"{n}: readOnlyHint {a.get('readOnlyHint')}")
        # MCP-5 as amended by D32: the annotations describe the worst case
        if n == t:
            want_a = {"readOnlyHint": False, "destructiveHint": True, "idempotentHint": False, "openWorldHint": True}
        elif n == f"{t}_cancel":
            want_a = {"readOnlyHint": False, "destructiveHint": True, "idempotentHint": True}
        elif n == f"{t}_send_outcome":
            want_a = {"readOnlyHint": False, "destructiveHint": True, "idempotentHint": False, "openWorldHint": True}
        elif n == f"{t}_panel":
            want_a = {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": False, "openWorldHint": True}
        elif n in (f"{t}_quote", f"{t}_results"):
            want_a = {"readOnlyHint": True, "idempotentHint": True}
        else:
            want_a = {}
        wrong = {k: a.get(k) for k, v in want_a.items() if a.get(k) is not v}
        if wrong:
            probs.append(f"{n}: annotations {wrong}, the text gives {want_a}")
        desc = (x.get("description") or "").lower()
        if n in (t, f"{t}_quote"):
            if not re.search(r"\bnot\b", desc):
                probs.append(f"{n}: description never says when not to use it [MCP-6]")
            if not re.search(r"cost|\$|usd|free|pay", desc):
                probs.append(f"{n}: description says nothing of cost [MCP-6]")
            if not re.search(r"minute|hour|second|time", desc):
                probs.append(f"{n}: description says nothing of time [MCP-6]")
        if re.search(r"\b(best|powerful|amazing|revolutionary|world-class|seamless|you must always|always use)\b", desc):
            probs.append(f"{n}: description praises or instructs [MCP-6]")
    expect(not probs, "; ".join(probs[:6]))
    listed = (ctx.disc or {}).get("mcp_protocol_versions") or []
    expect(pv in ("2026-07-28", "2025-11-25", "2025-06-18"), f"the client negotiated {pv}; MCP-1 needs 2026-07-28, 2025-11-25 or 2025-06-18")
    expect(pv in listed, f"negotiated {pv}, which discovery's mcp_protocol_versions {listed} does not list [MCP-1]")
    return f"protocol {pv}; {len(want)} tools with outputSchema and annotations"


@check("P02", ["MCP-2", "MCP-3", "MCP-4"], group="mcp")
def p02(ctx):
    t = ctx.tool
    qbody = ctx.listen(people=2)
    http_q = ctx.api.req("POST", "/v1/quotes", qbody).body
    bad = ctx.listen()
    del bad["people"]
    cbody = ctx.as_call(ctx.listen(people=2), "mcp-call")

    async def body(c):
        out = {}
        out["quote"] = tool_json(await c.call_tool(f"{t}_quote", qbody))
        out["bad"] = tool_json(await c.call_tool(f"{t}_quote", bad))
        out["call"] = tool_json(await c.call_tool(t, cbody))
        return out
    o = mcp_run(ctx, body)
    q = o["quote"]
    expect(not q.get("isError"), f"quote via MCP is an error: {json.dumps(q)[:200]}")
    d = diff(strip_volatile(q.get("structuredContent")), strip_volatile(http_q))
    expect(not d, "MCP quote differs from HTTP quote: " + "; ".join(d[:5]) + " [MCP-2]")
    texts = [x for x in q.get("content") or [] if x.get("type") == "text"]
    expect(texts, "quote result has no text block [MCP-3]")
    b = o["bad"]
    expect(b.get("isError") is True, "an invalid call via MCP is not isError [MCP-4]")
    sc = b.get("structuredContent") or {}
    expect(sc.get("code") == "missing_field" and sc.get("fixable") is True and sc.get("field"), f"MCP error content {sc} [MCP-4]")
    c = o["call"]
    expect(not c.get("isError"), f"{t} via MCP is an error: {json.dumps(c)[:200]}")
    cid = (c.get("structuredContent") or {}).get("call_id")
    expect(cid, "MCP call result has no call_id")
    ctx.note_call(cid, "listen", cbody)
    tx = [x.get("text", "") for x in c.get("content") or [] if x.get("type") == "text"]
    expect(tx and tx[0].lstrip().startswith("SIMULATED"), f"simulated call's text block begins {tx[0][:40] if tx else None!r} [MCP-3]")
    fin = ctx.wait_for(cid, limit=30)

    async def body2(c2):
        return tool_json(await c2.call_tool(f"{t}_results", {"call_id": cid}))
    rr = mcp_run(ctx, body2)
    http_r = ctx.results(cid).body
    d2 = diff(strip_volatile(rr.get("structuredContent")), strip_volatile(http_r))
    expect(not d2, "MCP results differ from HTTP results: " + "; ".join(d2[:5]) + " [MCP-2]")
    return "quote, error and results identical to HTTP; SIMULATED text first; error is isError with fixable"


# ===============================================================================================================
# Aggregates over every body seen
# ===============================================================================================================
@check("X01", ["CONV-1", "MONEY-4"], group="final")
def x01(ctx):
    bad = []
    no_tm = 0
    for rec in ctx.api.log:
        if not rec["api"] or not isinstance(rec["body"], (dict, list)):
            continue
        has_money = False
        for path, k, v in walk(rec["body"]):
            if not (k.endswith("_usd") or k.endswith("_usd_per_hour")):
                continue
            if k.endswith("_usd"):
                has_money = True
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                bad.append(f"{rec['path']} {path}={v!r} (a number)")
            elif isinstance(v, str) and not MONEY_RE.match(v):
                bad.append(f"{rec['path']} {path}={v!r}")
        # MONEY-4 covers bodies about a call's or a key's money, not discovery's published rates
        if (has_money and rec["status"] < 400 and isinstance(rec["body"], dict) and "/receipts/" not in rec["path"]
                and "/.well-known/" not in rec["path"] and not rec["path"].endswith("/v1/media/samples")):
            if not any(k == "test_money" for _, k, _ in walk(rec["body"])):
                no_tm += 1
    expect(not bad, f"money not as a two-place string: {bad[:5]}")
    expect(no_tm == 0, f"{no_tm} successful bodies carry money without test_money [MONEY-4]")
    return f"{len(ctx.api.log)} bodies: money strings throughout"


@check("X02", ["VER-2"], group="final")
def x02(ctx):
    miss = [f"{r['method']} {r['path']}" for r in ctx.api.log if r["api"] and not r["version"]]
    expect(not miss, f"{len(miss)} responses lack the version header, e.g. {miss[:3]}")
    return "every API response carries the version header"


@check("X03", ["HTTP-2"], group="final")
def x03(ctx):
    bad = [f"{r['method']} {r['path']} {r['status']} {r['ctype']}" for r in ctx.api.log
           if r["api"] and r["path"].startswith("/v1/") and (r["body"] is None or "json" not in r["ctype"].lower())]
    expect(not bad, f"non-JSON answers on API routes: {bad[:4]}")
    return "every /v1 answer was JSON"


@check("X04", ["EVID-2", "SIM-4", "EVID-4"], group="final")
def x04(ctx):
    bad = []
    n = 0
    for cid, kind, x in ctx.responses:
        if "record" not in x:
            continue
        rec = x.get("record") or {}
        lv = expected_level(kind, rec.get("observed") or {}, x.get("voice"))
        if lv is None:
            bad.append(f"{x.get('response_id')}: observed lacks a field the rule needs")
            continue
        n += 1
        for kk, vv in (rec.get("observed") or {}).items():
            if isinstance(vv, float) and kk.endswith("_seconds") and round(vv, 1) != vv:
                bad.append(f"{x.get('response_id')}: observed.{kk} {vv} has more than 0.1 s precision (s14)")
            if isinstance(vv, float) and kk.endswith("_fraction") and round(vv, 2) != vv:
                bad.append(f"{x.get('response_id')}: observed.{kk} {vv} has more than 0.01 precision (s14)")
        if lv != x.get("evidence"):
            bad.append(f"{x.get('response_id')} ({kind}): returned {x.get('evidence')}, rule gives {lv}")
        lr = str(x.get("level_reason") or rec.get("level_reason") or "")
        if re.search(r"\b(proof|proves|proven|unassisted|without help|genuine)\b", lr, re.I):
            bad.append(f"{x.get('response_id')}: level_reason claims more than the level shows [EVID-4]: {lr!r}")
    expect(n, "no detail=full response was seen, so no level could be recomputed")
    expect(not bad, "; ".join(bad[:6]))
    return f"{n} responses: every level recomputes from record.observed"


@check("X05", ["MONEY-6", "STATE-1", "STATE-4"], group="final")
def x05(ctx):
    allowed = {"held": {"open", "refused", "cancelled", "expired"},
               "open": {"enough", "complete", "expired", "cancelled", "held"},
               "enough": {"complete", "expired", "cancelled", "held"}}
    bad = []
    for cid, c in ctx.calls.items():
        for st, done, mo in c["money"]:
            h, s, r = D(mo.get("held_usd")), D(mo.get("spent_usd")), D(mo.get("returned_usd"))
            if None in (h, s, r):
                bad.append(f"{cid}: money fields missing {mo}")
                continue
            if s + r > h:
                bad.append(f"{cid}: spent+returned {s + r} > held {h}")
            if st in TERMINAL and done is True and s + r != h:
                bad.append(f"{cid}: terminal {st}, complete, with spent+returned {s + r} != held {h}")
        sts = c["statuses"]
        for a, b in zip(sts, sts[1:]):
            if a != b and b not in allowed.get(a, set()):
                bad.append(f"{cid}: {a} -> {b} [STATE-1]")
        people = (c["body"] or {}).get("people")
        for s in c["summaries"]:
            if people and (s.get("answered", 0) + s.get("taken", 0)) > people:
                bad.append(f"{cid}: answered+taken {s.get('answered', 0) + s.get('taken', 0)} > people {people} [STATE-4]")
    nmoney = sum(len(c["money"]) for c in ctx.calls.values())
    expect(nmoney, "no call or results body carried a money object, so the money invariant could not be read [MONEY-6]")
    expect(not bad, "; ".join(bad[:6]))
    return f"{len(ctx.calls)} calls, {nmoney} money reads: money invariant and state arrows hold at every read"


@check("X06", ["RES-7", "KIND-4", "PRIV-1", "KIND-5", "SEC-3"], group="final")
def x06(ctx):
    if not ctx.responses:
        raise Skip("no responses were seen")
    bad = []
    banned = re.compile(r"^(name|first_name|last_name|email|phone|contact|address|account|account_id|ip|ip_address|"
                        r"keystrokes|keys|pointer|pointer_path|trace|events|raw_trace|recording_url_raw)$")
    for cid, kind, x in ctx.responses:
        for path, k, v in walk(x):
            if banned.match(k):
                bad.append(f"{x.get('response_id')}: field {path}")
            if isinstance(v, str) and re.search(r"https?://[^ ]*/c/[A-Za-z0-9_.-]{10,}", v):
                bad.append(f"{x.get('response_id')}: a seat link in {path} [SEC-3]")
        v = x.get("voice")
        if isinstance(v, dict) and v.get("recording_url"):
            bad.append(f"{x.get('response_id')}: recording_url set on a simulated response")
    expect(not bad, "; ".join(bad[:6]))
    return f"{len(ctx.responses)} responses carry no identity, trace or seat link"


@check("X07", ["SIM-2", "AUTH-3"], group="final")
def x07(ctx):
    if not ctx.responses:
        raise Skip("no responses were seen")
    bad = [x.get("response_id") for _, _, x in ctx.responses if x.get("simulated") is not True]
    expect(not bad, f"responses to a test key not marked simulated: {bad[:5]}")
    return f"all {len(ctx.responses)} responses to the test key are simulated"


@check("X09", ["PEOPLE-8"], group="final")
def x09(ctx):
    by_call = {}
    for cid, _, x in ctx.responses:
        if x.get("person_ref"):
            by_call.setdefault(cid, []).append(x["person_ref"])
    if not by_call:
        raise Skip("no responses with person_ref were seen")
    bad = [f"{cid}: {r}" for cid, refs in by_call.items() for r in set(refs) if refs.count(r) > 1]
    expect(not bad, f"one person answered a call twice: {bad[:3]}")
    return f"in each of {len(by_call)} calls every response came from a different person"


@check("X08", ["DISC-3"], group="final")
def x08(ctx):
    declared = [p for p in (ctx.disc or {}).get("profiles", []) if isinstance(p, str) and p.endswith("/fair-call/0.1")]
    if not declared:
        raise Skip("no profile declared")
    if "fair-call" not in ctx.args.profile:
        raise Skip("the server declares fair-call; run with --profile fair-call to check it")
    return "declared; the F checks below decide it"


# ===============================================================================================================
# The fair-call profile (section 23), run with --profile fair-call
# ===============================================================================================================
@check("F01", ["FAIR-2", "FAIR-5"], group="fair-call")
def f01(ctx):
    script = [{"stop_at_fraction": 0.05, "delay_seconds": 1, "answers": {"felt": "early"}},
              {"stop_at_fraction": 0.1, "stop_reason": "upset", "delay_seconds": 2, "answers": {"felt": "upset"}}]
    body = ctx.listen(people=2, pay_per_person_usd="2.00", minutes=2, deadline_minutes=10, script=script,
                      answer_fields={"felt": "text"})
    q = paid_quote(ctx, body)
    r = ctx.open_call(ctx.as_call(body, "fair-stop", max_total=q["total_usd"]))
    cid = r.body["call_id"]
    f = ctx.wait_for(cid, limit=30, done=lambda b: (b.get("summary") or {}).get("stopped", 0) >= 2)
    if not f.get("complete"):
        ctx.cancel(cid)
    f = ctx.results(cid, detail="full").body  # record (seat_seconds) comes only with detail=full (s13.1)
    rs = {((x.get("answers") or {}).get("felt") or "").replace("[simulated] ", "", 1): x for x in f.get("responses") or []}
    e, u = rs.get("early"), rs.get("upset")
    expect(e and u, f"scripted stops missing: {sorted(rs)}")
    ss = ((e.get("record") or {}).get("observed") or {}).get("seat_seconds")
    want = stop_pay("2.00", ss, 2, (ctx.limits() or {}).get("stop_minimum_usd") or "0.00")
    expect(D(e.get("paid_usd")) == want and D(e.get("paid_usd")) > 0, f"stop at {ss} s paid {e.get('paid_usd')}, formula {want} [FAIR-2]")
    expect(u.get("paid_usd") == "2.00", f"upset stop paid {u.get('paid_usd')} [FAIR-5]")
    return f"stop at {ss} s paid {e.get('paid_usd')}; upset paid in full"


@check("F02", ["FAIR-6", "FAIR-3", "FAIR-8"], group="fair-call")
def f02(ctx):
    p = pay_call(ctx)
    rs = p["full"].get("responses") or []
    expect(rs, "no responses under detail=full")
    probs, nulls = [], set()
    must = {"answered_for": lambda v: isinstance(v, str) and v.strip(), "asker_is_ai": lambda v: v is True,
            "minutes": lambda v: v == 2, "pay_per_person_usd": lambda v: v == "2.00",
            "pay_per_hour_usd": lambda v: v == "60.00", "unpaid": lambda v: v is False,
            "content_rating": lambda v: v == "general", "recorded": lambda v: isinstance(v, list) and v,
            "may_train_on_answers": lambda v: v is False}
    for x in rs:
        o = x.get("offer")
        if not isinstance(o, dict):
            probs.append(f"{x.get('response_id')}: no offer")
            continue
        for k, ok in must.items():
            if not ok(o.get(k)):
                probs.append(f"offer.{k} = {o.get(k)!r}")
        for k in ("kept_days", "download_bytes", "panel_size"):
            if o.get(k) is None:
                nulls.add(k)
    expect(not probs, "; ".join(sorted(set(probs))[:8]) + " [FAIR-6]")
    if nulls - {"panel_size"}:
        ctx.notes.append(f"F02: offer leaves {sorted(nulls - {'panel_size'})} null on the simulated pool")
    return f"{len(rs)} offers state who answers, AI, minutes, 2.00 = 60.00 an hour, rating, what is recorded, training"


@check("F03", ["FAIR-7"], group="fair-call")
def f03(ctx):
    p = pay_call(ctx)
    qlines = {ln.get("kind"): D(ln.get("amount_usd")) for ln in p["quote"].get("lines", []) if isinstance(ln, dict)}
    sums = {}
    n = 0
    for x in p["final"].get("responses") or []:
        rr = ctx.receipt(x["receipt_id"])
        fees = (rr.body.get("receipt") or {}).get("fees")
        expect(isinstance(fees, list), f"receipt {x['receipt_id']} has no fees list [FAIR-7]")
        for fe in fees:
            expect(fe.get("kind") in QUOTE_LINES and fe.get("kind") != "to_people", f"fee kind {fe.get('kind')!r}")
            expect(D(fe.get("amount_usd")) is not None, f"fee amount {fe.get('amount_usd')!r}")
            sums[fe["kind"]] = sums.get(fe["kind"], Decimal(0)) + D(fe["amount_usd"])
        n += 1
    over = {k: (v, qlines.get(k)) for k, v in sums.items() if qlines.get(k) is None or v > qlines[k]}
    expect(not over, f"fee shares exceed the quote's lines: {over}")
    return f"{n} receipts show their fee shares: {({k: str(v) for k, v in sums.items()})}"


@check("F04", ["FAIR-4", "RES-9", "MONEY-8"], group="fair-call")
def f04(ctx):
    floor = D((ctx.disc or {}).get("pay_floor_usd_per_hour"))
    if not floor:
        raise Skip("discovery publishes no pay_floor_usd_per_hour")
    pay = cents(floor * 2 / 60)
    if pay * 30 < floor:
        pay += Decimal("0.01")
    script = [{"delay_seconds": 2 * i + 1, "seat_seconds": 240} for i in range(3)]
    body = ctx.listen(people=3, pay_per_person_usd=str(pay), minutes=2, deadline_minutes=10, script=script)
    q = paid_quote(ctx, body)
    r = ctx.open_call(ctx.as_call(body, "fair-median", max_total=q["total_usd"]))
    cid = r.body["call_id"]
    first, redelivered, cursor = {}, {}, None
    end = time.monotonic() + 40
    fin = None
    while time.monotonic() < end:
        rr = ctx.results(cid, wait=10, after=cursor, detail="full")
        expect(rr.status == 200, f"results: {rr!r}")
        b = rr.body
        for x in b.get("responses") or []:
            rid = x.get("response_id")
            if rid in first:
                redelivered[rid] = x
            else:
                first[rid] = x
        cursor = b.get("cursor", cursor)
        if b.get("complete"):
            fin = b
            break
        time.sleep(min(b.get("next_check_after_seconds") or 1, 5))
    expect(fin is not None, "the call did not complete")
    want = max(pay, cents(floor * 4 / 60))
    final = {rid: redelivered.get(rid, x) for rid, x in first.items()}
    got = {rid: (x.get("paid_usd"), x.get("top_up_usd")) for rid, x in final.items()}
    probs = [f"{rid}: paid {p} top_up {t}" for rid, (p, t) in got.items()
             if D(p) != want or D(t or "0") != want - pay]
    expect(not probs, f"median seat 240 s on a 2-minute call at {pay}: the floor for the median gives {want}; " + "; ".join(probs[:3]) + " [FAIR-4]")
    changed = [rid for rid, x in first.items() if D(x.get("paid_usd")) != want]
    missing = [rid for rid in changed if rid not in redelivered]
    expect(not missing, f"responses whose pay changed after delivery were not delivered again after the cursor: {missing} [RES-9]")
    for rid, x in final.items():
        _, pay_r = verify_jws(ctx, x.get("receipt_jws") or ctx.receipt(x["receipt_id"]).body["jws"])
        expect(D(pay_r.get("top_up_usd") or "0") == want - pay, f"receipt of {rid} shows top_up_usd {pay_r.get('top_up_usd')!r}")
    tail = f"{len(changed)} re-delivered after the cursor" if changed else "top-up present at first delivery (RES-9 not exercised)"
    return f"paid {pay} for 2 minutes, median 4 minutes -> each paid {want} with top_up_usd {want - pay}; {tail}"


# ===============================================================================================================
def setup(ctx, args):
    path = f"/.well-known/{ctx.prefix}"
    r = ctx.api.req("GET", path, key=None)
    if r.status == 200 and isinstance(r.body, dict):
        ctx.disc = r.body
    else:
        r2 = ctx.api.req("GET", path + ".json", key=None)
        if r2.status == 200 and isinstance(r2.body, dict):
            ctx.disc = r2.body
            ctx.cache["disc_fallback"] = f"discovery answered HTTP {r.status} at {path} and was found only at {path}.json"
        else:
            print(f"FAIL D01 DISC-1 no discovery document at {path} (HTTP {r.status}) nor {path}.json (HTTP {r2.status})")
            return False
    if not isinstance(ctx.disc.get("api_base"), str):
        print("FAIL D01 DISC-1 the discovery document has no api_base; nothing else can run")
        return False
    ctx.api.api_base = ctx.disc["api_base"]
    tk = ctx.disc.get("test_keys")
    if isinstance(tk, dict):
        ctx.notes.append("discovery's test_keys is an object, not the address s5 shows; used its url")
        tk = tk.get("url") or tk.get("href")
    ctx.cache["test_keys_url"] = tk
    if args.key:
        ctx.api.key = args.key
    else:
        if not tk:
            print("This server offers no test keys in discovery. Run again with --key test_... or --key-file")
            return False
        r = ctx.api.req("POST", tk, {"class": "test"}, key=None)
        if r.status not in (200, 201) or not isinstance(r.body, dict) or not r.body.get("key"):
            print(f"Could not make a test key at {tk}: HTTP {r.status}")
            return False
        ctx.api.key = r.body["key"]
        ctx.cache["key_info"] = r.body
    if args.key2:
        ctx.key2 = args.key2
    elif tk:
        r2 = ctx.api.req("POST", tk, {"class": "test"}, key=None)
        if r2.status in (200, 201) and isinstance(r2.body, dict) and r2.body.get("key"):
            ctx.key2 = r2.body["key"]
            ctx.cache.setdefault("key_info", r2.body)
    # Open the expiry call now: it is read at the end, after its one-minute deadline has passed.
    if not args.only or "M04" in args.only:
        try:
            # SIM-7: a miss resolves at once and the defaults then answer, so to see a deadline pass the scripted
            # people must accept and take longer than the deadline.
            body = ctx.as_call(ctx.listen(people=2, deadline_minutes=1,
                                          script=[{"accept": True, "delay_seconds": 600},
                                                  {"accept": True, "delay_seconds": 600}]), "expiry")
            r = ctx.open_call(body)
            ctx.cache["expiry"] = {"call_id": r.body["call_id"], "t0": time.monotonic()}
        except Fail as e:
            ctx.notes.append(f"expiry call not opened: {e}")
    return True


def trace_table():
    ids = spec_ids()
    cover = {}
    for c in CHECKS:
        for r in c.reqs:
            cover.setdefault(r, []).append(c.cid)
    rows = []
    for i in ids:
        if i in cover:
            rows.append((i, ", ".join(cover[i]), ""))
        else:
            rows.append((i, "", UNTESTED.get(i, "NO CHECK AND NO REASON")))
    unknown = sorted(set(cover) - set(ids))
    return rows, unknown


def print_trace():
    rows, unknown = trace_table()
    tested = sum(1 for r in rows if r[1])
    print(f"{len(rows)} requirement ids in spec/src (with the FAIR rules of section 23); {tested} tested; {len(rows) - tested} untested")
    for i, c, why in rows:
        if not c:
            print(f"  UNTESTED {i}: {why}")
    if unknown:
        print(f"  checks cite ids not in the text: {unknown}")
    missing = [i for i, c, why in rows if not c and why == "NO CHECK AND NO REASON"]
    return 1 if missing else 0


def write_trace(path):
    rows, unknown = trace_table()
    tested = sum(1 for r in rows if r[1])
    with open(path, "w") as f:
        f.write("# Traceability: every requirement in the text, and the check that tests it\n\n")
        f.write(f"Generated by `suite.py --write-trace` from spec/src/*.md (the pattern `[ID-n]`, plus the FAIR rules "
                f"of section 23's table), suite {SUITE_VERSION}, {now_ct()}. {len(rows)} requirements; {tested} tested by at "
                f"least one check; {len(rows) - tested} untested, each with its reason.\n\n")
        f.write("| Requirement | Checks | Why untested |\n|---|---|---|\n")
        for i, c, why in rows:
            f.write(f"| {i} | {c} | {why} |\n")
        if unknown:
            f.write(f"\nChecks cite ids not found in the text: {', '.join(unknown)}\n")
        f.write("\nCheck groups: core (run always), mcp (skipped with --no-mcp), final (aggregates over every body the run "
                "saw), fair-call (run with --profile fair-call).\n")


def main():
    ap = argparse.ArgumentParser(description="Conformance suite for the call-server standard 0.1 (draft)")
    ap.add_argument("base_url", nargs="?", help="the API host, e.g. https://api.example.com")
    ap.add_argument("--key", help="a test key; without it one is made through discovery's test_keys")
    ap.add_argument("--key2", help="a second test key of another principal (for not_found checks)")
    ap.add_argument("--key-file", help="read the test key from a file holding TEST_KEY=... (never printed)")
    ap.add_argument("--only", help="comma-separated check ids")
    ap.add_argument("--profile", action="append", default=[], help="run a profile's checks: fair-call")
    ap.add_argument("--json", help="write a JSON report here")
    ap.add_argument("--no-mcp", action="store_true", help="skip the tool-binding checks")
    ap.add_argument("--trace", action="store_true", help="print untested requirement ids and exit")
    ap.add_argument("--write-trace", metavar="PATH", help="write traceability.md and exit")
    ap.add_argument("--list", action="store_true", help="list checks and exit")
    ap.add_argument("--budget", type=float, default=450.0, help="seconds the run may take (default 450)")
    ap.add_argument("--interval", type=float, default=1.0, help="least seconds between requests (default 1.0)")
    args = ap.parse_args()
    args.only = set(x.strip() for x in args.only.split(",")) if args.only else None
    EXTRA_HEADERS.clear()
    if args.key_file:
        with open(os.path.expanduser(args.key_file)) as f:
            for line in f:
                line = line.strip()
                if line.startswith("TEST_KEY=") and not args.key:
                    args.key = line.split("=", 1)[1].strip().strip('"').strip("'")
                elif line.startswith("HEADER=") and ":" in line:
                    name, val = line.split("=", 1)[1].split(":", 1)
                    EXTRA_HEADERS[name.strip()] = val.strip()
        if not args.key:
            ap.error("no TEST_KEY= line in the key file")

    if args.trace:
        sys.exit(print_trace())
    if args.write_trace:
        write_trace(args.write_trace)
        print(f"wrote {args.write_trace}")
        sys.exit(0)
    if args.list:
        for c in CHECKS:
            print(f"{c.cid:4} {c.group:9} {' '.join(c.reqs)}")
        sys.exit(0)
    if not args.base_url:
        ap.error("base_url is required")

    names = canon_names()
    prefix = names.get("wire_prefix") or "x-hc-draft"
    api = Api(args.base_url, prefix, args.interval)
    api.extra = dict(EXTRA_HEADERS)
    ctx = Ctx(api, args)
    print(f"conformance suite {SUITE_VERSION} against {args.base_url} (wire prefix {prefix}), {now_ct()}")
    results = []
    if not setup(ctx, args):
        sys.exit(2)
    groups = {"core", "final"} | ({"mcp"} if not args.no_mcp else set()) | set(args.profile)
    declared = [p for p in ctx.disc.get("profiles", []) if isinstance(p, str) and p.endswith("/fair-call/0.1")]
    if declared and "fair-call" not in args.profile:
        print("NOTE server declares the fair-call profile; run with --profile fair-call to check it [DISC-3]")
    ordered = [c for c in CHECKS if c.group != "final"] + [c for c in CHECKS if c.group == "final"]
    for c in ordered:
        if c.group not in groups or (args.only and c.cid not in args.only):
            continue
        reqs = ",".join(c.reqs)
        if ctx.time_left() < 10 and c.group != "final":
            st, line = "SKIP", "the run's time budget is spent"
        else:
            try:
                line = c.fn(ctx) or ""
                st = "PASS"
            except Fail as e:
                st, line = "FAIL", str(e)
            except Skip as e:
                st, line = "SKIP", str(e)
            except Exception as e:  # a crash in a check is a failure of the server or of the suite: say which
                st, line = "FAIL", f"check raised {type(e).__name__}: {str(e)[:300]}"
        line = line.replace("\n", " ")
        print(f"{st} {c.cid} {reqs} {line}", flush=True)
        results.append({"check": c.cid, "status": st, "reqs": c.reqs, "line": line})
    n = {s: sum(1 for r in results if r["status"] == s) for s in ("PASS", "FAIL", "SKIP")}
    secs = time.monotonic() - ctx.started
    print(f"{n['PASS']} passed, {n['FAIL']} failed, {n['SKIP']} skipped; {len(api.log)} requests in {secs:.0f} s")
    for note in ctx.notes:
        print(f"NOTE {note}")
    if n["FAIL"] == 0:
        prof = [p for p in args.profile]
        print(f"May claim: passes suite {SUITE_VERSION} against the standard 0.1 core" +
              (f", and the profile {', '.join(prof)}" if prof else "") + ("" if not n["SKIP"] else f" ({n['SKIP']} checks skipped)"))
    if args.json:
        with open(args.json, "w") as f:
            json.dump({"suite": SUITE_VERSION, "target": args.base_url, "when": now_ct(), "counts": n,
                       "results": results, "notes": ctx.notes, "requests": len(api.log), "seconds": round(secs)}, f, indent=1)
    sys.exit(0 if n["FAIL"] == 0 else 1)


if __name__ == "__main__":
    main()
