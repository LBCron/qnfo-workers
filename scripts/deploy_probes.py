#!/usr/bin/env python3
"""DEPLOY-PROBES-1 (2026-11-04, pillar autonomy; owner: "make every deploy prove itself").

WHAT   A worker declares what must still work after its deploy in `<worker>/probes.json`, next to its worker.js:
           {"mode": "revert",                      // optional: "revert" (default) | "observe" (file the issue, never revert)
            "health": "https://x.q08.workers.dev/health",   // optional: the VERSION poll, for a worker outside the control plane
            "http": [{"url": "https://x.q08.workers.dev/y", "status": 200, "contains": ["marker"], "absent": ["Internal Error"]}],
            "d1":   [{"binding": "DB", "explain": ["SELECT col FROM v_view LIMIT 1", "INSERT INTO t (a, b) VALUES (1, 2)"]}]}
       canonical-deploy.yml runs them from the runner after the deploy (scripts/canary_revert.py imports this module), and a probe that
       passed before the deploy and fails after it is a regression: the push is reverted by the existing REVERT path and a closed-loop issue
       carries the failing probe. A probe that already failed before the deploy (and was already declared) is a pre-existing failure: it is
       filed, never reverted. `scripts/deploy_probes.py --check-pr` is the PR-time half: it validates every declaration and requires one for
       a changed worker that is not on scripts/probes-allowlist.txt (shrink-only), or `probes: none (<reason>)` in the PR body.
WHY    2026-11-04: a dashboard rewrite broke three liveness contracts for pages that worked (the probes looked for old-page text) and the
       canary, which proved only that the new VERSION reached /health, passed; `no such table: issue_assignments` and a 24 minute dead
       fleet_tick (a view read a missing column through a trigger) were found by their victims, not by the deploy. SQLite compiles every
       trigger body and view when a statement is PREPARED, so `EXPLAIN QUERY PLAN <statement>` on the live D1 surfaces exactly those errors
       and never executes the statement (a SELECT, WITH, INSERT, UPDATE or DELETE; the runner refuses a second statement). Verified on D1
       2026-11-04: `EXPLAIN QUERY PLAN INSERT` returned "no such column: zz: SQLITE_ERROR" for a trigger body that read a missing column,
       and on qnfo-audit `EXPLAIN QUERY PLAN INSERT INTO cloud_ops_events ...` returned "triggers nested too deep", the same error the real
       zero-row INSERT gave while the OR IGNORE form passed: the first probe run found a live outage (plain INSERTs into cloud_ops_events
       failing since migration 1176, 18:57Z; agent_issues CLOUD-OPS-EVENTS-INSERT-DEPTH-1) that no test or canary had seen.
DESIGN * Reuses the runner transport of the CONTROL-PLANE-FUNCTIONAL-CANARY-1 step (urllib GET from the GitHub runner, outside the account,
         because a Worker's request to its own account's hosts is the issue-1190 artifact) and its revert; no new system.
       * A D1 error counts as a failure only when it is a compile-class error (no such table / column / function / view, syntax error,
         "nested too deep", ambiguous column ...). "D1 DB is overloaded", timeouts and HTTP 429/5xx are INCONCLUSIVE, never a revert:
         qnfo-audit refused a work claim for that reason while this was being written.
       * A probe whose request failed at the runner (status 0) is inconclusive too: a dead runner network must not revert a good deploy.
       * Private databases (qnfo-identity, qnfo-outreach, personal-life) are refused: the run log is public (PROBE-SYSTEMWIDE-1).
       * URLs are limited to the fleet's own hosts and carry no query secret; the runner only ever sends GET.
USAGE  python3 scripts/deploy_probes.py --selftest
       python3 scripts/deploy_probes.py --validate [dir ...]          # every <dir>/probes.json (default: all) against its wrangler.toml
       python3 scripts/deploy_probes.py --check-pr --changed FILE --body FILE [--root DIR]
       python3 scripts/deploy_probes.py --live <worker> [--d1] [--tries N]   # run one worker's probes against production now
       python3 scripts/deploy_probes.py --baseline --targets /tmp/targets.txt --out /tmp/probe_baseline.json   # before the deploy
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

# Hosts the declarations may name: the fleet's own (DOMAIN-PLANE-1: q08.org personal, qnfo.org research and fleet, qwav.org quantum) and
# the workers.dev account subdomain. A probe is a GET from the runner, so an arbitrary host would make the deploy path a request proxy.
HOST_SUFFIXES = (".q08.workers.dev", ".qnfo.org", ".q08.org", ".qwav.org", ".qwav.tech")
HOST_EXACT = ("qnfo.org", "q08.org", "qwav.org", "qwav.tech")
PRIVATE_DATABASES = ("qnfo-identity", "qnfo-outreach", "personal-life")
MAX_HTTP, MAX_D1_SQL, MAX_MARKERS = 8, 6, 6
DECL_KEYS = {"_note", "mode", "health", "http", "d1"}
HTTP_KEYS = {"_note", "url", "status", "contains", "absent"}
D1_KEYS = {"_note", "binding", "explain"}
# Control characters (a newline in a URL or a marker would become a line of an issue read by the agents, and http.client refuses them with an
# exception that used to abort the whole canary) are refused everywhere in a declaration.
CONTROL = re.compile(r"[\x00-\x1f\x7f]")
URL_BAD = re.compile(r"[\x00-\x20\x7f]|[^\x00-\x7f]")
SECRET_QUERY = re.compile(r"(?i)(token|key|secret|password|auth|sig|code)=")
# D1 errors that mean "the statement does not compile" (the schema or a trigger/view body is broken). Anything else is inconclusive.
COMPILE_ERROR = re.compile(r"(?i)no such (table|column|function|view|index|trigger|collation sequence|module)|has no column named|syntax error|"
                           r"nested too deep|ambiguous column|misuse of aggregate|wrong number of arguments|not authorized|unrecognized token|"
                           r"incomplete input|table \S+ has \d+ columns|cannot (?:join|use)|too many (?:levels|terms)")
# A gateway or overload answer says nothing about the deployed code (D1 overload makes workers answer 503 and 429); a worker that threw answers 500/1101.
TRANSIENT_HTTP = (429, 502, 503, 504, 522, 523, 524, 530)
TRANSIENT = re.compile(r"(?i)overload|timed? ?out|HTTP (?:0|408|425|429|500|502|503|504)\b|network connection lost|internal error|"
                       r"temporarily|try again|too many resources|connection (?:reset|refused)|ECONN|unavailable")


def emit(msg):
    print(msg, flush=True)


# ---------------------------------------------------------------------------------------------------------------- declarations
def clean(s, limit=200):
    """Declaration- or response-derived text as one safe line: whitespace and control characters collapsed (it ends up in issue text read by agents)."""
    return re.sub(r"[\x00-\x1f\x7f\s]+", " ", str(s or "")).strip()[:limit]


_PRIVATE_IDS = {}


def private_db_ids(root=None):
    """database_ids of every private database (by name) declared in any wrangler.toml of the repository: a binding may not point at one under another name."""
    root = root or ROOT
    if root not in _PRIVATE_IDS:
        ids = set()
        try:
            for d in os.listdir(root):
                wr = read_file(os.path.join(root, d, "wrangler.toml"))
                if wr:
                    for name, i in d1_bindings(wr).values():
                        if name in PRIVATE_DATABASES:
                            ids.add(i)
        except OSError:
            pass
        _PRIVATE_IDS[root] = ids
    return _PRIVATE_IDS[root]


def host_ok(host):
    h = (host or "").lower().rstrip(".")
    return h in HOST_EXACT or h.endswith(HOST_SUFFIXES)


def as_list(v):
    if v is None:
        return []
    return list(v) if isinstance(v, (list, tuple)) else [v]


def d1_bindings(wrangler_text):
    """{binding: (database_name, database_id)} from the [[d1_databases]] blocks of a wrangler.toml (regex: no tomllib on 3.10)."""
    out = {}
    for block in re.split(r"(?m)^\s*\[\[d1_databases\]\]\s*$", str(wrangler_text or ""))[1:]:
        block = re.split(r"(?m)^\s*\[", block, maxsplit=1)[0]
        b = re.search(r'(?m)^\s*binding\s*=\s*"([^"]+)"', block)
        n = re.search(r'(?m)^\s*database_name\s*=\s*"([^"]+)"', block)
        i = re.search(r'(?m)^\s*database_id\s*=\s*"([^"]+)"', block)
        if b and i:
            out[b.group(1)] = (n.group(1) if n else "", i.group(1))
    return out


def validate(decl, bindings=None):
    """The list of problems with a parsed declaration (empty = valid). `bindings` (d1_bindings) is optional: without it a d1 binding is not resolved."""
    errs = []
    if not isinstance(decl, dict):
        return ["the declaration must be a JSON object"]
    for k in decl:
        if k not in DECL_KEYS:
            errs.append("unknown key " + json.dumps(k))
    if decl.get("mode", "revert") not in ("revert", "observe"):
        errs.append('mode must be "revert" or "observe"')
    health = decl.get("health")
    if health is not None:
        u = urlparse(str(health))
        if URL_BAD.search(str(health)) or u.scheme != "https" or not host_ok(u.hostname) or SECRET_QUERY.search(u.query or ""):
            errs.append("health must be an https URL on a fleet host without a secret query")
    http = decl.get("http", [])
    d1 = decl.get("d1", [])
    if not isinstance(http, list) or not isinstance(d1, list):
        return errs + ['"http" and "d1" must be lists']
    if len(http) > MAX_HTTP:
        errs.append("at most %d http probes" % MAX_HTTP)
    for n, p in enumerate(http):
        tag = "http[%d]" % n
        if not isinstance(p, dict):
            errs.append(tag + " must be an object")
            continue
        for k in p:
            if k not in HTTP_KEYS:
                errs.append(tag + " unknown key " + json.dumps(k))
        raw_url = str(p.get("url", ""))
        u = urlparse(raw_url)
        if URL_BAD.search(raw_url):
            errs.append(tag + " url holds a space, control or non-ASCII character")
        elif u.scheme != "https" or not u.hostname:
            errs.append(tag + " url must be an https URL")
        elif not host_ok(u.hostname):
            errs.append(tag + " host " + u.hostname + " is not a fleet host (" + ", ".join(HOST_EXACT) + " and their subdomains, *.q08.workers.dev)")
        elif SECRET_QUERY.search(u.query or ""):
            errs.append(tag + " url carries a secret-looking query parameter; probes send no credential")
        st = p.get("status", 200)
        if not (isinstance(st, int) and not isinstance(st, bool) and 100 <= st <= 599):
            errs.append(tag + " status must be an HTTP status integer")
        for k in ("contains", "absent"):
            ms = as_list(p.get(k))
            if len(ms) > MAX_MARKERS or any(not isinstance(m, str) or not m.strip() or CONTROL.search(m) for m in ms):
                errs.append("%s %s must be at most %d non-empty single-line strings" % (tag, k, MAX_MARKERS))
        if not as_list(p.get("contains")) and not as_list(p.get("absent")) and st == 200:
            errs.append(tag + " needs a contains marker (a bare 200 proves only that something answers; the 2026-11-04 liveness miss was a page that answered)")
    nsql = 0
    for n, p in enumerate(d1):
        tag = "d1[%d]" % n
        if not isinstance(p, dict):
            errs.append(tag + " must be an object")
            continue
        for k in p:
            if k not in D1_KEYS:
                errs.append(tag + " unknown key " + json.dumps(k))
        b = p.get("binding")
        if not isinstance(b, str) or not b:
            errs.append(tag + " needs a binding name")
        elif bindings is not None:
            if b not in bindings:
                errs.append(tag + " binding " + b + " is not a [[d1_databases]] binding of the worker's wrangler.toml")
            elif bindings[b][0] in PRIVATE_DATABASES or bindings[b][1] in private_db_ids() or not bindings[b][0]:
                errs.append(tag + " binding " + b + " is a private or unnamed database: its errors would reach the public run log")
        explain = p.get("explain", [])
        if not isinstance(explain, list) or not explain:
            errs.append(tag + " needs an explain list of SELECT, WITH, INSERT, UPDATE or DELETE statements (compiled with EXPLAIN QUERY PLAN, never executed)")
            continue
        for s_ in explain:
            nsql += 1
            if not isinstance(s_, str) or not s_.strip():
                errs.append(tag + " explain entries must be non-empty strings")
                continue
            body = s_.strip().rstrip(";").strip()
            if ";" in body or CONTROL.search(body):
                errs.append(tag + " one single-line statement per entry (no ';', no control characters): " + clean(s_, 60))
            if not re.match(r"(?is)^(SELECT|WITH|INSERT|UPDATE|DELETE)\b", body):
                errs.append(tag + " explain takes a SELECT, WITH, INSERT, UPDATE or DELETE statement (the runner adds EXPLAIN QUERY PLAN): " + clean(s_, 60))
    if nsql > MAX_D1_SQL:
        errs.append("at most %d d1 statements per worker" % MAX_D1_SQL)
    if not http and not d1 and not decl.get("health"):
        errs.append("the declaration has no probe (add http, d1 or health)")
    return errs


def load_declaration(text, wrangler_text=None):
    """(declaration or None, errors) from the text of a probes.json."""
    try:
        decl = json.loads(text)
    except ValueError as e:
        return None, ["not valid JSON: " + str(e)[:120]]
    errs = validate(decl, d1_bindings(wrangler_text) if wrangler_text is not None else None)
    return (decl if not errs else None), errs


def probe_list(decl):
    """Flat list of (key, kind, spec) for every probe of a declaration. key is stable across edits that do not change the probe."""
    out = []
    for p in (decl or {}).get("http") or []:
        spec = {"url": p.get("url"), "status": p.get("status", 200), "contains": as_list(p.get("contains")), "absent": as_list(p.get("absent"))}
        out.append((probe_key("http", spec), "http", spec))
    for p in (decl or {}).get("d1") or []:
        for s in p.get("explain") or []:
            spec = {"binding": p.get("binding"), "sql": str(s).strip().rstrip(";").strip()}
            out.append((probe_key("d1", spec), "d1", spec))
    return out


def probe_key(kind, spec):
    return hashlib.sha1((kind + ":" + json.dumps(spec, sort_keys=True)).encode("utf-8")).hexdigest()[:12]


def label(kind, spec):
    if kind == "http":
        return clean("GET " + str(spec["url"]), 120)
    return clean("EXPLAIN " + str(spec["binding"]) + ": " + str(spec["sql"]), 120)


# -------------------------------------------------------------------------------------------------------------------- running
class FleetRedirects(urllib.request.HTTPRedirectHandler):
    """A redirect is followed only to an https URL on a fleet host: a declaration may not be turned into a request proxy by a route that redirects away."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        u = urlparse(newurl)
        if u.scheme != "https" or not host_ok(u.hostname):
            raise urllib.error.HTTPError(newurl, 599, "redirect leaves the fleet hosts", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


OPENER = urllib.request.build_opener(FleetRedirects)


def cache_bust(url):
    """A query parameter that gives the edge a fresh key: a cached good page must not mask a broken deploy, nor a cached old page fail a legitimate change."""
    sep = "&" if "?" in url else "?"
    return url + sep + "_dp=" + str(int(time.time()))


def fetch_text(url, timeout=25):
    """(status, body text) of one GET; (0, error text) when the request itself fails for any reason (a malformed URL, a truncated body and a
    refused connection included: an exception here used to abort the whole canary). Status 599 = the route redirected off the fleet hosts."""
    try:
        req = urllib.request.Request(cache_bust(url), headers={"User-Agent": "qnfo-deploy-probe/1.0 (+canonical-deploy)", "Cache-Control": "no-cache"})
        with OPENER.open(req, timeout=timeout) as r:
            return r.status, r.read(2_000_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        try:
            body = e.read(200_000).decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            body = ""
        return e.code, body
    except Exception as e:  # noqa: BLE001
        return 0, clean(type(e).__name__ + " " + str(e), 160)


def compact(s):
    return re.sub(r"\s+", "", str(s or ""))


def judge_http(status, body, spec):
    """One answer against its probe -> None when it passes, else the reason. A status 0 reason starts with 'HTTP 0' (inconclusive)."""
    want = spec.get("status", 200)
    if status != want:
        return "HTTP " + str(status) + (" (wanted " + str(want) + ")" if status else (": " + str(body)[:80]))
    text, c = str(body or ""), compact(body)
    for m in as_list(spec.get("contains")):
        if m not in text and compact(m) not in c:
            return "marker " + m[:80] + " absent"
    low = text.lower()
    for m in as_list(spec.get("absent")):
        if m.lower() in low or compact(m).lower() in c.lower():
            return "forbidden text " + m[:80] + " present"
    return None


def d1_explain(acct, token, db_id, sql):
    """(ok, message) of `EXPLAIN QUERY PLAN <sql>` on a D1 database. EXPLAIN never executes the statement, so no row is read or written."""
    import cf_ops_actions as C
    try:
        st, j = C.call("POST", "/accounts/%s/d1/database/%s/query" % (acct, db_id), token, {"sql": "EXPLAIN QUERY PLAN " + sql, "params": []}, timeout=60)
    except Exception as e:  # noqa: BLE001
        return False, "request failed: " + clean(str(e), 120)
    if st == 200 and (j or {}).get("success", False):
        return True, ""
    errs = (j or {}).get("errors") or []
    msg = "; ".join(str((e or {}).get("message", e)) for e in errs)[:300] or json.dumps(j)[:200]
    return False, "D1 HTTP " + str(st) + ": " + clean(msg, 300)


def judge_d1(ok, message):
    """-> 'ok' | 'fail' | 'inconclusive'. A compile-class error is a failure (tested first: `no such column: timeout_ms` is a missing column, not a timeout);
    an overload, a timeout or an unknown error is inconclusive."""
    if ok:
        return "ok"
    if COMPILE_ERROR.search(message or ""):
        return "fail"
    return "inconclusive"


def http_state(st, body, spec, reason):
    """ok | fail | inconclusive for one HTTP answer. A request that failed at the runner (status 0), a gateway or overload status, and a body that says the
    platform was overloaded say nothing about the deployed code; a worker that threw answers 500 or a Cloudflare 1101 page."""
    if reason is None:
        return "ok"
    want = spec.get("status", 200)
    if st == 0 or (st in TRANSIENT_HTTP and want not in TRANSIENT_HTTP):
        return "inconclusive"
    if st != want and TRANSIENT.search(str(body or "")[:2000]) and not re.search(r"(?i)error code: ?1101|worker threw|exception", str(body or "")[:2000]):
        return "inconclusive"
    return "fail"


def run_probe(kind, spec, ctx, tries=1, wait_sec=15, sleep=time.sleep, deadline=None):
    """One probe with up to `tries` attempts -> {"state": ok|fail|inconclusive, "reason": str, "tries": n}.
    ctx: {"fetch": f(url)->(status, body), "d1": f(binding, sql)->(ok, message)}. Anything that raises is inconclusive, never an abort; a probe started
    after `deadline` (time.monotonic) is inconclusive with the reason 'probe budget exhausted'."""
    last = ("inconclusive", "")
    n = 0
    for attempt in range(max(1, tries)):
        if deadline is not None and time.monotonic() > deadline:
            return {"state": "inconclusive", "reason": "probe budget exhausted", "tries": n}
        n = attempt + 1
        try:
            if kind == "http":
                st, body = ctx["fetch"](spec["url"])
                reason = judge_http(st, body, spec)
                state = http_state(st, body, spec, reason)
            else:
                ok, msg = ctx["d1"](spec["binding"], spec["sql"])
                state = judge_d1(ok, msg)
                reason = None if state == "ok" else msg
        except Exception as e:  # noqa: BLE001
            state, reason = "inconclusive", clean("probe raised " + type(e).__name__ + " " + str(e), 160)
        last = (state, clean(reason, 300))
        if state == "ok":
            break
        if attempt + 1 < max(1, tries):
            sleep(wait_sec)
    return {"state": last[0], "reason": last[1], "tries": n}


def evaluate(decl, ctx, tries=4, wait_sec=15, sleep=time.sleep, d1_tries=2, d1_wait=5, budget_sec=None):
    """Every probe of a declaration. -> {"state": ok|failed|inconclusive|none, "probes": [{key, kind, label, state, reason, tries, spec}]}.
    failed = at least one probe failed; inconclusive = none failed but some could not be judged. budget_sec bounds the whole declaration."""
    results = []
    deadline = (time.monotonic() + budget_sec) if budget_sec else None
    for key, kind, spec in probe_list(decl):
        r = run_probe(kind, spec, ctx, tries if kind == "http" else d1_tries, wait_sec if kind == "http" else d1_wait, sleep, deadline)
        results.append({"key": key, "kind": kind, "label": label(kind, spec), "spec": spec, **r})
    if not results:
        return {"state": "none", "probes": []}
    states = [r["state"] for r in results]
    return {"state": "failed" if "fail" in states else ("inconclusive" if "inconclusive" in states else "ok"), "probes": results}


def classify(result, baseline, base_keys):
    """Split the failed probes of one worker into (regressions, pre_existing, new_bad).
    baseline: {key: state} measured before the deploy (None = not measured); base_keys: the keys the parent commit already declared (None = unknown).
    pre_existing: declared before AND already failing before the deploy. new_bad: a probe this very change declares that already failed in the baseline
    because the page answered without its marker (a typo in the marker, not a broken deploy): filed, never reverted. A new probe whose route did not
    exist (HTTP 404 in the baseline), one that passed before, and every failure without a baseline are regressions: the change's own responsibility."""
    reg, pre, newbad = [], [], []
    for p in result.get("probes") or []:
        if p["state"] != "fail":
            continue
        b = (baseline or {}).get(p["key"]) if baseline is not None else None
        was_failing = isinstance(b, str) and b.startswith("fail")
        declared = base_keys is not None and p["key"] in base_keys
        if was_failing and declared:
            pre.append(p)
        elif was_failing and b == "fail-marker" and base_keys is not None and not declared:
            newbad.append(p)
        else:
            reg.append(p)
    return reg, pre, newbad


def baseline_state(decl, ctx, budget_sec=90):
    """Two attempts per probe, before the deploy -> {key: ok | inconclusive | fail | fail-marker} (fail-marker: the page answered but a marker was absent)."""
    out = {}
    deadline = time.monotonic() + budget_sec
    for key, kind, spec in probe_list(decl):
        r = run_probe(kind, spec, ctx, 2, 5, deadline=deadline)
        st = r["state"]
        if st == "fail" and kind == "http" and (r["reason"].startswith("marker ") or r["reason"].startswith("forbidden text")):
            st = "fail-marker"
        out[key] = st
    return out


def summary(result, limit=3):
    bad = [p for p in result.get("probes") or [] if p["state"] != "ok"]
    return "; ".join("%s: %s" % (p["label"], clean(p["reason"], 140) or p["state"]) for p in bad[:limit]) or "every probe passed"


def runtime_probe_line(p):
    """The `runtime-probe:` line of an issue (PROBE-BIRTH-RUNTIME-1) for a failed http probe: D1 makes it the issue's runner-https contract,
    so the hourly remediation tick closes the issue when the route answers its marker again. None for a d1 probe."""
    if p.get("kind") != "http":
        return None
    spec = p["spec"]
    contains = as_list(spec.get("contains"))
    obj = {"url": spec["url"], "status": spec.get("status", 200)}
    if contains:
        obj["contains"] = contains[0]
    elif as_list(spec.get("absent")):
        obj["absent"] = as_list(spec["absent"])[0]
    else:
        return None
    return "runtime-probe: " + json.dumps(obj)


# ----------------------------------------------------------------------------------------------------- repository declarations
def read_file(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return None


def worker_dirs(root=ROOT):
    out = []
    for d in sorted(os.listdir(root)):
        p = os.path.join(root, d)
        if os.path.isfile(os.path.join(p, "worker.js")) and os.path.isfile(os.path.join(p, "wrangler.toml")):
            out.append(d)
    return out


def retired(root, d):
    return os.path.exists(os.path.join(root, d, "RETIRED")) or os.path.exists(os.path.join(root, d, "FOLDED"))


def read_allowlist(root=ROOT):
    text = read_file(os.path.join(root, "scripts", "probes-allowlist.txt")) or ""
    return {ln.split("#")[0].strip() for ln in text.splitlines() if ln.split("#")[0].strip()}


def validate_repo(root=ROOT, only=None):
    """Every <worker>/probes.json against its wrangler.toml -> [(dir, problem)]. `only` limits the directories."""
    bad = []
    for d in (only if only else worker_dirs(root)):
        text = read_file(os.path.join(root, d, "probes.json"))
        if text is None:
            continue
        _, errs = load_declaration(text, read_file(os.path.join(root, d, "wrangler.toml")) or "")
        bad.extend((d, e) for e in errs)
    return bad


WAIVER = re.compile(r"(?im)^\s*probes:\s*none\s*\(([^)\n]{12,})\)")


def check_pr(changed, body, root=ROOT, base_allow=None):
    """The PR-time rule -> (errors, notices). changed: repository paths the pull request touches; body: its description.
    * every changed or declared probes.json must validate against its wrangler.toml;
    * a changed <worker>/worker.js needs <worker>/probes.json, unless the worker is on scripts/probes-allowlist.txt (shrink-only: a notice
      asks for a declaration) or the body carries `probes: none (<reason of 12+ characters>)`;
    * a worker with a probes.json must not stay on the allowlist (delete the line);
    * the allowlist only shrinks: base_allow (the base commit's list, when known) must contain every line of this one."""
    errs, notes = [], []
    allow = read_allowlist(root)
    if base_allow is not None:
        for d in sorted(allow - set(base_allow)):
            errs.append("scripts/probes-allowlist.txt gains %s: the list only shrinks, declare %s/probes.json instead" % (d, d))
    waived = bool(WAIVER.search(body or ""))
    dirs = sorted({c.split("/")[0] for c in changed if "/" in c})
    for d, e in validate_repo(root, [x for x in dirs if os.path.isdir(os.path.join(root, x))]):
        errs.append("%s/probes.json: %s" % (d, e))
    if any(c.startswith("scripts/probes-allowlist.txt") for c in changed):
        for d in sorted(allow):
            if os.path.isfile(os.path.join(root, d, "probes.json")):
                errs.append("scripts/probes-allowlist.txt lists %s, which has a probes.json: delete the line (shrink-only)" % d)
            elif not os.path.isdir(os.path.join(root, d)) or retired(root, d):
                errs.append("scripts/probes-allowlist.txt lists %s, which is not a live worker directory: delete the line" % d)
    for c in changed:
        m = re.match(r"^([^/]+)/worker\.js$", c)
        if not m:
            continue
        d = m.group(1)
        if not os.path.isfile(os.path.join(root, d, "wrangler.toml")) or retired(root, d) or os.path.isfile(os.path.join(root, d, "probes.json")):
            continue
        if d in allow:
            notes.append("%s changes without a probes.json (on the allowlist): declare what must keep working, then delete its line from scripts/probes-allowlist.txt" % d)
        elif waived:
            notes.append("%s: probes waived in the PR body" % d)
        else:
            errs.append("%s/worker.js changes but %s/probes.json does not exist and %s is not on scripts/probes-allowlist.txt: declare the routes or SQL this "
                        "deploy must keep working (see scripts/deploy_probes.py), or put `probes: none (<reason>)` in the PR description" % (d, d, d))
    return errs, notes


# ------------------------------------------------------------------------------------------------------------------ live context
def live_ctx(bindings, acct, token):
    """The real fetch and D1 functions for a worker whose d1 bindings are `bindings`."""
    def d1(binding, sql):
        if binding not in bindings:
            return False, "binding " + str(binding) + " not in wrangler.toml"
        if not (acct and token):
            return False, "HTTP 0: no Cloudflare credential on this runner"
        return d1_explain(acct, token, bindings[binding][1], sql)
    return {"fetch": fetch_text, "d1": d1}


# ------------------------------------------------------------------------------------------------------------------------- CLI
def selftest():
    checks = []

    def ok(cond, name, detail=None):
        checks.append((bool(cond), name))
        emit(("PASS " if cond else "FAIL ") + name + ("" if cond or detail is None else " -- " + str(detail)[:300]))

    good = {"mode": "revert", "http": [{"url": "https://qnfo-ops.q08.workers.dev/registry", "contains": ['"ok":true']}],
            "d1": [{"binding": "DB", "explain": ["SELECT a FROM v_x LIMIT 1", "INSERT INTO fleet_tick (source) VALUES ('x')", "UPDATE t SET a = a WHERE b = 1", "DELETE FROM t WHERE 0"]}]}
    wr = '[[d1_databases]]\nbinding = "DB"\ndatabase_name = "qnfo-audit"\ndatabase_id = "35e2e573-92f3-46ac-83c6-22f6429fc5e5"\n\n[[d1_databases]]\nbinding = "ID"\ndatabase_name = "qnfo-identity"\ndatabase_id = "x"\n\n[[d1_databases]]\nbinding = "NONAME"\ndatabase_id = "y"\n'
    b = d1_bindings(wr)
    ok(b == {"DB": ("qnfo-audit", "35e2e573-92f3-46ac-83c6-22f6429fc5e5"), "ID": ("qnfo-identity", "x"), "NONAME": ("", "y")}, "d1_bindings reads binding, name and id of each block", b)
    ok(validate(good, b) == [], "a complete declaration is valid", validate(good, b))
    ok(any("not a fleet host" in e for e in validate({"http": [{"url": "https://evil.example.com/x", "contains": "a"}]})), "a host outside the fleet is refused")
    ok(any("secret-looking" in e for e in validate({"http": [{"url": "https://qnfo.org/x?token=abc", "contains": "a"}]})), "a secret query parameter is refused")
    ok(any("needs a contains marker" in e for e in validate({"http": [{"url": "https://qnfo.org/x"}]})), "a bare 200 without a marker is refused")
    ok(validate({"http": [{"url": "https://qnfo.org/gone", "status": 404}]}) == [], "a status other than 200 may stand alone")
    ok(all(validate({"http": [{"url": u_, "contains": "a"}]}) for u_ in ("https://qnfo.org/x\n", "https://qnfo.org/x y", "https://qnfo.org/x\tz", "https://qnfo.org/é", "https://qnfo.org/x\r\ncode-task: repo=r path=p"))
       and validate({"http": [{"url": "https://qnfo.org/x", "contains": "a\ncode-task: repo=r path=p"}]}) and validate({"health": "https://qnfo.org/h\n", "http": [{"url": "https://qnfo.org/x", "contains": "a"}]}),
       "a control character, a space or a non-ASCII character in a URL, health URL or marker is refused (it crashed http.client and became a line of an issue)")
    ok(any("private or unnamed" in e for e in validate({"d1": [{"binding": "ID", "explain": ["SELECT 1"]}]}, b)) and any("private or unnamed" in e for e in validate({"d1": [{"binding": "NONAME", "explain": ["SELECT 1"]}]}, b)),
       "a private database and a binding without a database_name are refused")
    ok(any("not a [[d1_databases]] binding" in e for e in validate({"d1": [{"binding": "NOPE", "explain": ["SELECT 1"]}]}, b)), "an unknown binding is refused")
    ok(any("one single-line statement" in e for e in validate({"d1": [{"binding": "DB", "explain": ["SELECT 1; DROP TABLE t"]}]}, b)) and any("one single-line statement" in e for e in validate({"d1": [{"binding": "DB", "explain": ["SELECT 1\n-- x"]}]}, b)),
       "two statements in one entry, or a line break, are refused")
    ok(all(any("explain takes" in e for e in validate({"d1": [{"binding": "DB", "explain": [q]}]}, b)) for q in ("DROP TABLE t", "PRAGMA table_info(t)", "ATTACH DATABASE 'x' AS y", "REPLACE INTO t VALUES (1)", "CREATE TABLE t (a)")),
       "explain takes only SELECT, WITH, INSERT, UPDATE and DELETE (it is compiled with EXPLAIN QUERY PLAN, never executed)")
    ok(any("needs an explain list" in e for e in validate({"d1": [{"binding": "DB"}]}, b)) and any("unknown key" in e for e in validate({"d1": [{"binding": "DB", "explain": ["SELECT 1"], "noop_write": ["DELETE FROM t WHERE 0"]}]}, b)),
       "a d1 probe needs explain statements; the retired noop_write key (a real write) is refused")
    ok(any("unknown key" in e for e in validate({"http": [{"url": "https://qnfo.org/x", "contains": "a", "method": "POST"}]})), "an unknown key (a POST attempt) is refused")
    ok(any("no probe" in e for e in validate({"mode": "revert"})), "an empty declaration is refused")
    ok(load_declaration("{bad", wr)[1] and load_declaration(json.dumps(good), wr)[0] == good, "load_declaration returns the object or the errors")
    ok(clean("a\nb\t\x00c   d") == "a b c d" and clean("x" * 500, 20) == "x" * 20, "clean collapses whitespace and control characters")

    ok(judge_http(200, '{"ok": true}', {"status": 200, "contains": ['"ok":true']}) is None, "judge_http: markers match whitespace-insensitively")
    ok(judge_http(200, "x", {"status": 200, "contains": ["MARK"]}) == "marker MARK absent" and judge_http(503, "", {"status": 200}) == "HTTP 503 (wanted 200)", "judge_http: a missing marker and a wrong status say why")
    ok(judge_http(200, "Internal Error 1101", {"status": 200, "contains": [], "absent": ["internal error"]}).startswith("forbidden text"), "judge_http: absent text is case-insensitive")
    ok(judge_http(404, "", {"status": 404}) is None, "judge_http: a wanted 404 passes")
    ok(cache_bust("https://qnfo.org/a").startswith("https://qnfo.org/a?_dp=") and cache_bust("https://qnfo.org/a?x=1").startswith("https://qnfo.org/a?x=1&_dp="), "cache_bust gives the edge a fresh key, with or without a query")
    ok(fetch_text("https://probe.invalid/x\n")[0] == 0 and fetch_text("http://127.0.0.1:1/")[0] == 0, "fetch_text turns any exception (a malformed URL, a refused connection) into status 0 instead of aborting the canary")

    class _Rq:
        full_url = "https://qnfo.org/a"
    h = FleetRedirects()
    try:
        h.redirect_request(_Rq(), None, 302, "Found", {}, "https://evil.example.com/x")
        refused = False
    except urllib.error.HTTPError as e:
        refused = e.code == 599
    userinfo_host = urlparse("https://qnfo.org@evil.example.com/").hostname
    ok(refused and userinfo_host == "evil.example.com" and not host_ok(userinfo_host) and not host_ok("evil-qnfo.org") and not host_ok("qnfo.org.evil.com") and host_ok("fleet.qnfo.org") and host_ok("a.q08.workers.dev"),
       "a redirect off the fleet hosts is refused, and host_ok judges the real hostname (userinfo, look-alike suffixes)", userinfo_host)
    ok(judge_d1(True, "") == "ok" and judge_d1(False, "D1 HTTP 400: no such column: zz: SQLITE_ERROR") == "fail" and judge_d1(False, "D1 HTTP 400: no such table: issue_assignments: SQLITE_ERROR") == "fail"
       and judge_d1(False, "D1 HTTP 400: triggers nested too deep: SQLITE_ERROR") == "fail" and judge_d1(False, "D1 HTTP 400: no such column: timeout_ms: SQLITE_ERROR") == "fail",
       "judge_d1: a compile-class error is a failure, even when the missing column is called timeout_ms")
    ok(judge_d1(False, "D1 HTTP 429: D1 DB is overloaded. Too many resources consumed within a 10 second window") == "inconclusive"
       and judge_d1(False, "D1 HTTP 500: Network connection lost") == "inconclusive" and judge_d1(False, "weird unknown thing") == "inconclusive", "judge_d1: an overload, a lost connection or an unknown error is inconclusive, never a revert")

    seq = {"https://qnfo.org/a": [(503, ""), (200, "MARK")], "https://qnfo.org/b": [(200, "nope")], "https://qnfo.org/c": [(0, "dns")]}
    cnt = {}

    def fake_fetch(url):
        i = cnt.get(url, 0)
        cnt[url] = i + 1
        a = seq[url]
        return a[min(i, len(a) - 1)]
    d1_calls = []

    def fake_d1(binding, sql):
        d1_calls.append((binding, sql))
        if "v_broken" in sql:
            return False, "D1 HTTP 400: no such column: zz: SQLITE_ERROR"
        if "slow" in sql:
            return False, "D1 HTTP 429: D1 DB is overloaded"
        return True, ""
    ctx = {"fetch": fake_fetch, "d1": fake_d1}
    slept = []
    dec_a = {"http": [{"url": "https://qnfo.org/a", "contains": "MARK"}]}
    ra = evaluate(dec_a, ctx, tries=3, wait_sec=15, sleep=slept.append)
    ok(ra["state"] == "ok" and ra["probes"][0]["tries"] == 2 and slept == [15], "evaluate: a route that recovers inside the tries passes, waiting only between attempts", ra)
    rb = evaluate({"http": [{"url": "https://qnfo.org/b", "contains": "MARK"}]}, ctx, tries=3, wait_sec=15, sleep=lambda s: None)
    ok(rb["state"] == "failed" and rb["probes"][0]["tries"] == 3 and "marker MARK absent" in rb["probes"][0]["reason"], "evaluate: a route that never shows its marker fails with its reason", rb)
    seq["https://qnfo.org/d"] = [(503, "overloaded")]
    seq["https://qnfo.org/d2"] = [(500, "D1 DB is overloaded. Too many resources consumed")]
    rt = evaluate({"http": [{"url": "https://qnfo.org/d", "contains": "MARK"}, {"url": "https://qnfo.org/d2", "contains": "MARK"}]}, ctx, tries=2, wait_sec=1, sleep=lambda s: None)
    ok(rt["state"] == "inconclusive" and [p["state"] for p in rt["probes"]] == ["inconclusive", "inconclusive"], "evaluate: a 503 or 429, or a body that says D1 was overloaded, says nothing about the code and never reverts", rt)
    seq["https://qnfo.org/e"] = [(500, "Worker threw exception: error code: 1101")]
    rf = evaluate({"http": [{"url": "https://qnfo.org/e", "contains": "MARK"}]}, ctx, tries=2, wait_sec=1, sleep=lambda s: None)
    ok(rf["state"] == "failed", "evaluate: a 500 from a worker that threw is a failed probe", rf)
    rc = evaluate({"http": [{"url": "https://qnfo.org/c", "contains": "MARK"}]}, ctx, tries=2, wait_sec=1, sleep=lambda s: None)
    ok(rc["state"] == "inconclusive" and rc["probes"][0]["state"] == "inconclusive", "evaluate: a request that failed at the runner (status 0) is inconclusive, not a failure", rc)
    rd = evaluate({"d1": [{"binding": "DB", "explain": ["SELECT 1 FROM v_ok", "SELECT 1 FROM v_broken", "SELECT 1 FROM slow", "INSERT INTO t (a) VALUES (1)"]}]}, ctx, sleep=lambda s: None)
    ok(rd["state"] == "failed" and [p["state"] for p in rd["probes"]] == ["ok", "fail", "inconclusive", "ok"], "evaluate: d1 probes are judged one by one (ok, fail, inconclusive, ok)", rd)
    ok(("DB", "INSERT INTO t (a) VALUES (1)") in d1_calls and all(len(c) == 2 for c in d1_calls) and rd["probes"][0]["label"].startswith("EXPLAIN DB:"), "evaluate: every d1 probe is one compile-only statement per binding", d1_calls)

    def raising(url):
        raise RuntimeError("boom\nsecond line")
    rr = evaluate({"http": [{"url": "https://qnfo.org/z", "contains": "MARK"}]}, {"fetch": raising, "d1": fake_d1}, tries=1, sleep=lambda s: None)
    ok(rr["state"] == "inconclusive" and "\n" not in rr["probes"][0]["reason"], "evaluate: a probe that raises is inconclusive with a one-line reason, never an abort", rr)
    rbud = evaluate({"http": [{"url": "https://qnfo.org/a", "contains": "MARK"}, {"url": "https://qnfo.org/b", "contains": "MARK"}]}, ctx, tries=1, sleep=lambda s: None, budget_sec=-1)
    ok(rbud["state"] == "inconclusive" and all(p["reason"] == "probe budget exhausted" for p in rbud["probes"]), "evaluate: a spent time budget makes the remaining probes inconclusive, not failed", rbud)
    ok(evaluate({}, ctx)["state"] == "none", "evaluate: no probe is none")
    # classification: pre-existing vs regression vs a typo in a new marker
    kb = rb["probes"][0]["key"]
    reg, pre, nb = classify(rb, {kb: "fail"}, {kb})
    ok(not reg and len(pre) == 1 and not nb, "classify: declared before and failing before the deploy is pre-existing")
    reg, pre, nb = classify(rb, {kb: "ok"}, {kb})
    ok(len(reg) == 1 and not pre and not nb, "classify: passed before, fails after is a regression")
    reg, pre, nb = classify(rb, {kb: "fail"}, set())
    ok(len(reg) == 1 and not pre and not nb, "classify: a new probe that failed before for a reason other than a missing marker is the change's own (the route did not exist yet)")
    reg, pre, nb = classify(rb, {kb: "fail-marker"}, set())
    ok(not reg and not pre and len(nb) == 1, "classify: a new probe whose page already answered without the marker is a mistyped marker: filed, not reverted")
    reg, pre, nb = classify(rb, {kb: "fail-marker"}, None)
    ok(len(reg) == 1, "classify: without the base declarations a failure stays a regression")
    reg, pre, nb = classify(rb, None, None)
    ok(len(reg) == 1 and not pre and not nb, "classify: without a baseline every failure is a regression")
    ok(probe_key("http", {"a": 1}) == probe_key("http", {"a": 1}) and probe_key("http", {"a": 1}) != probe_key("d1", {"a": 1}), "probe keys are stable and kind-scoped")
    line = runtime_probe_line(rb["probes"][0])
    ok(line == 'runtime-probe: {"url": "https://qnfo.org/b", "status": 200, "contains": "MARK"}' and runtime_probe_line(rd["probes"][1]) is None, "runtime_probe_line: an http probe becomes a runner-https contract line, a d1 probe none", line)
    base = baseline_state({"http": [{"url": "https://qnfo.org/b", "contains": "MARK"}], "d1": [{"binding": "DB", "explain": ["SELECT 1 FROM v_broken"]}]}, ctx)
    ok(sorted(base.values()) == ["fail", "fail-marker"], "baseline_state: two attempts per probe, a missing marker is fail-marker", base)

    # PR rule on a throwaway tree
    import tempfile
    with tempfile.TemporaryDirectory() as t:
        def put(rel, text):
            p = os.path.join(t, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as fh:
                fh.write(text)
        for d in ("w-new", "w-old", "w-done", "w-gone"):
            put(d + "/worker.js", "var VERSION = \"1\";")
            put(d + "/wrangler.toml", 'name = "' + d + '"\n')
        put("w-gone/RETIRED", "retired")
        put("w-done/probes.json", json.dumps({"http": [{"url": "https://qnfo.org/x", "contains": "a"}]}))
        put("scripts/probes-allowlist.txt", "w-old  # no routes\n")
        e, n = check_pr(["w-new/worker.js"], "", t)
        ok(len(e) == 1 and "w-new/probes.json does not exist" in e[0], "check_pr: a changed worker with no declaration and not allowlisted fails", e)
        e, n = check_pr(["w-new/worker.js"], "x\nprobes: none (static page, nothing to keep alive)\n", t)
        ok(not e and "waived" in n[0], "check_pr: a reasoned `probes: none (...)` waives it", (e, n))
        e, n = check_pr(["w-new/worker.js"], "probes: none (short)", t)
        ok(len(e) == 1, "check_pr: a waiver without a real reason does not count")
        e, n = check_pr(["w-old/worker.js"], "", t)
        ok(not e and "allowlist" in n[0], "check_pr: an allowlisted worker passes with a notice", (e, n))
        e, n = check_pr(["w-done/worker.js", "w-gone/worker.js"], "", t)
        ok(not e and not n, "check_pr: a declared worker and a retired one are quiet", (e, n))
        put("w-done/probes.json", json.dumps({"http": [{"url": "https://evil.example.com/x", "contains": "a"}]}))
        e, n = check_pr(["w-done/probes.json"], "", t)
        ok(len(e) == 1 and "not a fleet host" in e[0], "check_pr: an invalid declaration fails even without a worker.js change", e)
        put("scripts/probes-allowlist.txt", "w-done\nw-gone\nw-missing\n")
        e, n = check_pr(["scripts/probes-allowlist.txt"], "", t)
        ok(len([x for x in e if "delete the line" in x]) == 3, "check_pr: stale allowlist lines (a declared, a retired and a missing worker) are refused", e)
        put("scripts/probes-allowlist.txt", "w-old\nw-new\n")
        e, n = check_pr(["scripts/probes-allowlist.txt"], "", t, base_allow={"w-old"})
        ok(len(e) == 1 and "gains w-new" in e[0], "check_pr: the allowlist only shrinks against the base commit's list (a probe-less live worker cannot be added to it)", e)
    # the repository's own declarations
    bad = validate_repo()
    ok(not bad, "every probes.json in the repository validates against its wrangler.toml", bad[:3])
    fails = [n for c, n in checks if not c]
    emit("deploy-probes selftest: " + ("ok, " + str(len(checks)) + " checks" if not fails else str(len(fails)) + " FAILED"))
    return 0 if not fails else 1


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--validate", nargs="*", metavar="DIR", help="validate probes.json files (default all workers)")
    ap.add_argument("--check-pr", action="store_true")
    ap.add_argument("--changed", help="file with the pull request's changed paths, one per line")
    ap.add_argument("--body", help="file with the pull request description")
    ap.add_argument("--root", default=ROOT)
    ap.add_argument("--base-ref", default="", help="--check-pr: the base commit whose scripts/probes-allowlist.txt the list may only shrink from")
    ap.add_argument("--live", metavar="WORKER", help="run one worker's declared probes against production now")
    ap.add_argument("--d1", action="store_true", help="--live: include the d1 probes (needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID)")
    ap.add_argument("--tries", type=int, default=2)
    ap.add_argument("--baseline", action="store_true")
    ap.add_argument("--targets")
    ap.add_argument("--out")
    ap.add_argument("--pushed", default="HEAD", help="--baseline: the commit whose declarations are read (default HEAD)")
    a = ap.parse_args(argv)
    if a.selftest:
        return selftest()
    if a.validate is not None:
        bad = validate_repo(a.root, a.validate or None)
        for d, e in bad:
            emit("::error file=%s/probes.json::%s" % (d, e))
        emit("deploy-probes validate: " + ("ok" if not bad else str(len(bad)) + " problem(s)"))
        return 1 if bad else 0
    if a.check_pr:
        changed = [ln.strip() for ln in (read_file(a.changed) or "").splitlines() if ln.strip()] if a.changed else []
        base_allow = None
        if a.base_ref:
            import subprocess
            r = subprocess.run(["git", "show", a.base_ref + ":scripts/probes-allowlist.txt"], capture_output=True, text=True, cwd=a.root)
            if r.returncode == 0:
                base_allow = {ln.split("#")[0].strip() for ln in r.stdout.splitlines() if ln.split("#")[0].strip()}
        errs, notes = check_pr(changed, read_file(a.body) or "" if a.body else "", a.root, base_allow)
        for n in notes:
            emit("::notice::DEPLOY-PROBES-1 " + n)
        for e in errs:
            emit("::error::DEPLOY-PROBES-1 " + e)
        emit("deploy-probes check-pr: " + ("ok" if not errs else str(len(errs)) + " problem(s)"))
        return 1 if errs else 0
    if a.live:
        d = a.live.strip("/")
        decl, errs = load_declaration(read_file(os.path.join(a.root, d, "probes.json")) or "", read_file(os.path.join(a.root, d, "wrangler.toml")) or "")
        if errs:
            emit("invalid: " + "; ".join(errs))
            return 2
        binds = d1_bindings(read_file(os.path.join(a.root, d, "wrangler.toml")) or "")
        sub = dict(decl)
        if not a.d1:
            sub["d1"] = []
        res = evaluate(sub, live_ctx(binds, os.environ.get("CLOUDFLARE_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN")), tries=a.tries)
        for p in res["probes"]:
            emit("%-12s %s (%s)" % (p["state"], p["label"], p["reason"][:160] or "ok"))
        emit(d + ": " + res["state"])
        return 0 if res["state"] in ("ok", "none") else 1
    if a.baseline:
        if not a.targets or not a.out:
            ap.error("--baseline needs --targets and --out")
        import subprocess
        out = {}
        try:
            for ln in (read_file(a.targets) or "").splitlines():
                parts = ln.split()
                if len(parts) < 2 or parts[0].startswith("#"):
                    continue
                w, path = parts[0], parts[1]
                d = path.split("/")[0]
                try:
                    text = subprocess.run(["git", "show", a.pushed + ":" + d + "/probes.json"], capture_output=True, text=True, check=True).stdout
                    wr = subprocess.run(["git", "show", a.pushed + ":" + d + "/wrangler.toml"], capture_output=True, text=True, check=True).stdout
                    decl, errs = load_declaration(text, wr)
                    if not decl:
                        emit("baseline: " + w + " declaration invalid, skipped: " + "; ".join(errs)[:200])
                        continue
                    st = baseline_state(decl, live_ctx(d1_bindings(wr), os.environ.get("CLOUDFLARE_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN")))
                    if decl.get("health"):
                        # The version live before this deploy: when it already equals the pushed VERSION the baseline was taken after the deploy
                        # (a later push installed main's tip first) and cannot tell a regression from a failure that was already there.
                        code, body = fetch_text(decl["health"])
                        try:
                            st["__live_version__"] = str(json.loads(body).get("version") or "") if code == 200 else ""
                        except (ValueError, AttributeError):
                            st["__live_version__"] = ""
                    out[w] = st
                    emit("baseline: %s %s" % (w, json.dumps(st)))
                except Exception as e:  # noqa: BLE001  one worker's trouble never costs the others their baseline
                    emit("::warning::baseline: " + w + " skipped: " + clean(type(e).__name__ + " " + str(e), 160))
        finally:
            with open(a.out, "w", encoding="utf-8") as fh:
                json.dump(out, fh)
        return 0
    ap.error("choose --selftest, --validate, --check-pr, --live or --baseline")


if __name__ == "__main__":
    sys.exit(main())
