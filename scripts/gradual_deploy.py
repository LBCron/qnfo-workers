#!/usr/bin/env python3
"""BP26-GRADUAL-DEPLOYS-1 (2026-10-28, charter pillar autonomy; agent_issues 1000352, GitHub 4428; program QNFO.INFRA).

WHAT  A health-gated staged rollout of one worker's code through the Workers Versions API, with automatic rollback:
        1. upload a new Version of <worker>/worker.js (POST .../versions; bindings, secrets and settings are kept from the live script);
        2. smoke-test that Version before it takes traffic: GET /health with the `Cloudflare-Workers-Version-Overrides` header must answer 200
           and report the new VERSION;
        3. deploy 10 percent, soak, compare the new Version's error rate (and wall-time p99 when the analytics expose it) with the old one, then 50
           percent, soak, compare, then 100 percent;
        4. on a regression or a failed smoke test deploy the previous Version at 100 percent (the rollback) and exit 1.
      Every step is a deployment on the script, so scripts/bp26_cfapi.py counts it: metric deploys_via_gradual (strategy percentage with two versions),
      change_failure_rate and mttr_rollback_min_p95 are read from the same deployment history.
WHY   The control-plane canary (scripts/canary_revert.py) proves the new VERSION arrived, after 100 percent of traffic has it. A staged rollout limits a
      bad version to a tenth of requests first. A code rollback does not undo data: migrations stay expand-then-contract and writes idempotent.
LIMITS  Code-only deploys. A change that needs a Durable Object migration, a new binding or a cron change goes through the canonical /content path or wrangler;
      this script refuses a worker whose code is not an ES module and a rollout already in progress (two versions live). It never creates a worker.
USAGE python3 scripts/gradual_deploy.py --worker <name> [--path <name>/worker.js] [--soak-sec 120] [--stages 10,50,100] [--dry-run]
      python3 scripts/gradual_deploy.py --selftest
Reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. Exit 0 rolled out, 1 rolled back or refused, 2 usage.
"""
import argparse
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid

API = "https://api.cloudflare.com/client/v4"
KEEP = ["secret_text", "secret_key", "plain_text", "json", "kv_namespace", "d1", "r2_bucket", "service", "durable_object_namespace", "ai", "analytics_engine",
        "queue", "vectorize", "version_metadata", "send_email", "hyperdrive", "browser", "workflow", "pipelines", "assets", "images", "secrets_store_secret"]
MIN_REQUESTS = 20          # fewer requests than this on the new version in a stage: the error rate is not a verdict
MAX_ERR_ABS = 0.02         # a new version above 2 percent errors
ERR_FACTOR = 2.0           # or above twice the old version's rate plus 1 point
P99_FACTOR = 1.5           # or a wall-time p99 above 1.5x the old version's (when both are known)


def http(method, path, token, body=None, files=None, timeout=120):
    headers = {"Authorization": "Bearer " + token}
    data = None
    if files is not None:
        b = "----gd" + uuid.uuid4().hex
        parts = []
        for name, (fname, ctype, content) in files.items():
            head = 'Content-Disposition: form-data; name="%s"; filename="%s"\r\nContent-Type: %s\r\n\r\n' % (name, fname, ctype)
            parts.append(("--" + b + "\r\n" + head).encode() + content + b"\r\n")
        data = b"".join(parts) + ("--" + b + "--\r\n").encode()
        headers["Content-Type"] = "multipart/form-data; boundary=" + b
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:  # noqa: BLE001
            return e.code, {}


def fetch_health(url, headers=None, timeout=15):
    h = {"User-Agent": "qnfo-gradual-deploy/1"}
    h.update(headers or {})
    req = urllib.request.Request(url, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception as e:  # noqa: BLE001
        return 0, str(e)[:100]


def file_version(text):
    m = re.search(r"var\s+VERSION\s*=\s*[\"']([^\"']+)[\"']", text)
    return m.group(1) if m else None


PREVIEW_SMOKE_ATTEMPTS = 6
PREVIEW_SMOKE_RETRY_SEC = 2


def regression(new, old):
    """(bad, why). new/old are {'requests','errors','p99'}; a stage with too little traffic on the new version is not a verdict."""
    if new["requests"] < MIN_REQUESTS:
        return False, "only %d requests on the new version (need %d): no verdict from analytics" % (new["requests"], MIN_REQUESTS)
    nr = new["errors"] / float(new["requests"])
    orate = (old["errors"] / float(old["requests"])) if old["requests"] else 0.0
    if nr > max(MAX_ERR_ABS, ERR_FACTOR * orate + 0.01):
        return True, "error rate %.3f on the new version against %.3f on the old" % (nr, orate)
    if new.get("p99") and old.get("p99") and new["p99"] > P99_FACTOR * old["p99"]:
        return True, "wall-time p99 %.0f against %.0f on the old version" % (new["p99"], old["p99"])
    return False, "error rate %.3f (old %.3f), %d requests" % (nr, orate, new["requests"])


def version_stats(api, acct, worker, since_iso, until_iso):
    """{version_id: {'requests','errors','p99'}} from the account GraphQL analytics; None when the dataset cannot be read."""
    q = ('query { viewer { accounts(filter: {accountTag: "%s"}) { workersInvocationsAdaptive(limit: 100, filter: {scriptName: "%s", datetime_geq: "%s", datetime_leq: "%s"}) '
         '{ dimensions { scriptVersion } sum { requests errors } quantiles { wallTimeP99 } } } } }' % (acct, worker, since_iso, until_iso))
    st, j = api("POST", "/graphql", {"query": q})
    if not 200 <= (st or 0) < 300 or j.get("errors"):
        return None
    try:
        rows = j["data"]["viewer"]["accounts"][0]["workersInvocationsAdaptive"]
    except (KeyError, IndexError, TypeError):
        return None
    out = {}
    for r in rows:
        v = (r.get("dimensions") or {}).get("scriptVersion")
        if not v:
            continue
        o = out.setdefault(v, {"requests": 0, "errors": 0, "p99": None})
        o["requests"] += int((r.get("sum") or {}).get("requests") or 0)
        o["errors"] += int((r.get("sum") or {}).get("errors") or 0)
        p = (r.get("quantiles") or {}).get("wallTimeP99")
        if p:
            o["p99"] = max(o["p99"] or 0, float(p))
    return out


def deploy(api, acct, worker, versions, message):
    body = {"strategy": "percentage", "versions": [{"version_id": v, "percentage": p} for v, p in versions], "annotations": {"workers/message": message[:100]}}
    return api("POST", "/accounts/%s/workers/scripts/%s/deployments" % (acct, worker), body)


def run(worker, acct, token, path=None, stages=(10, 50, 100), soak=120, dry=False, api=None, sleep=time.sleep, fetch=fetch_health, now=time.time, emit=print):
    api = api or (lambda m, p, b=None, files=None: http(m, p, token, b, files))
    acctp = "/accounts/%s/workers/scripts/%s" % (acct, worker)
    path = path or "%s/worker.js" % worker
    res = {"worker": worker, "stages": [], "outcome": "refused"}

    def out(**kw):
        res.update(kw)
        emit("RESULT_JSON=" + json.dumps(res, sort_keys=True))
        return 0 if res["outcome"] in ("rolled-out", "dry-run") else 1
    try:
        code = open(path, encoding="utf-8").read()
    except OSError as e:
        return out(why="cannot read %s: %s" % (path, e))
    want = file_version(code)
    if "export default" not in code:
        return out(why="worker.js is not an ES module (no export default): the Versions upload here is modules-only")
    st, j = api("GET", acctp + "/deployments")
    deps = ((j.get("result") or {}).get("deployments") or []) if st == 200 else []
    if not deps:
        return out(why="no deployment readable for %s (HTTP %s): the script must exist, this never creates one" % (worker, st))
    cur = deps[0].get("versions") or []
    if len(cur) != 1:
        return out(why="a rollout is already in progress (%d versions live): finish or roll it back first" % len(cur))
    prev = cur[0]["version_id"]
    st, j = api("GET", acctp + "/settings")
    settings = (j.get("result") or {}) if st == 200 else {}
    meta = {"main_module": "worker.js", "keep_bindings": KEEP, "annotations": {"workers/message": "gradual-deploy %s" % (want or "?"), "workers/tag": (want or "")[:50]}}
    for k in ("compatibility_date", "compatibility_flags"):
        if settings.get(k):
            meta[k] = settings[k]
    if dry:
        return out(outcome="dry-run", why="would upload %s (VERSION %s) over %s and stage %s" % (path, want, prev[:8], list(stages)), previous=prev)
    # GRADUAL-ALREADY-LIVE-1: a push that re-deploys a VERSION the worker already serves has nothing to stage; the preview smoke test cannot tell the
    # identical version apart and rolled it back, turning canonical-deploy red on every later push (runs 40749619610..40749988325, qnfo-model-eval 1.8.3).
    lst, lbody = fetch("https://%s.q08.workers.dev/health" % worker)
    if want and lst == 200 and want in lbody and len(cur) == 1:
        res["smoke"] = {"status": lst, "version_seen": True}
        return out(outcome="rolled-out", version=want, previous=prev, why="VERSION %s is already live: nothing to stage" % want)
    st, j = api("POST", acctp + "/versions", None, {"metadata": ("metadata", "application/json", json.dumps(meta).encode()),
                                                     "worker.js": ("worker.js", "application/javascript+module", code.encode("utf-8"))})
    new = (j.get("result") or {}).get("id") if 200 <= (st or 0) < 300 else None
    if not new:
        return out(why="version upload refused (HTTP %s): %s" % (st, str(j.get("errors"))[:300]))
    res.update(previous=prev, new=new, version=want)

    def rollback(why):
        st2, _ = deploy(api, acct, worker, [(prev, 100)], "auto-rollback: " + why)
        return out(outcome="rolled-back", why=why, rolled_back=200 <= (st2 or 0) < 300)
    preview_url = "https://%s.q08.workers.dev/health" % worker
    preview_headers = {"Cloudflare-Workers-Version-Overrides": '%s="%s"' % (worker, new)}
    for attempt in range(1, PREVIEW_SMOKE_ATTEMPTS + 1):
        if attempt > 1:
            sleep(PREVIEW_SMOKE_RETRY_SEC)
        sst, body = fetch(preview_url, preview_headers)
        seen = bool(want and want in body)
        res["smoke"] = {"status": sst, "version_seen": seen, "attempts": attempt}
        if sst == 200 and (not want or seen):
            break
    if not (sst == 200 and (not want or seen)):
        return out(outcome="rolled-back", rolled_back=False,
                   why="preview smoke test failed (HTTP %s, version %s %s): the version never took traffic" % (sst, want, "seen" if seen else "not seen"))

    def iso(t):
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))
    for pct in stages:
        vs = [(new, 100)] if pct >= 100 else [(new, pct), (prev, 100 - pct)]
        t0 = now()
        st, j = deploy(api, acct, worker, vs, "gradual %d%% %s" % (pct, want or ""))
        if not 200 <= (st or 0) < 300:
            return rollback("deployment at %d%% refused (HTTP %s): %s" % (pct, st, str(j.get("errors"))[:200]))
        if pct >= 100:
            res["stages"].append({"pct": pct, "verdict": "complete"})
            break
        sleep(soak)
        stats = version_stats(api, acct, worker, iso(t0), iso(now() + 60))
        hst, _ = fetch("https://%s.q08.workers.dev/health" % worker)
        if stats is None:
            verdict, bad = "analytics unreadable: gated on /health alone (HTTP %s)" % hst, hst != 200
        else:
            empty = {"requests": 0, "errors": 0, "p99": None}
            bad, verdict = regression(stats.get(new, empty), stats.get(prev, empty))
            if hst != 200:
                bad, verdict = True, "/health answered HTTP %s at %d%%" % (hst, pct)
        res["stages"].append({"pct": pct, "verdict": verdict, "bad": bad})
        if bad:
            return rollback("%s at %d%%" % (verdict, pct))
    return out(outcome="rolled-out", why="100 percent on %s" % new)


def selftest():
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)
    ok(regression({"requests": 5, "errors": 5, "p99": None}, {"requests": 100, "errors": 0, "p99": None})[0] is False, "too little traffic is no verdict")
    ok(regression({"requests": 100, "errors": 10, "p99": None}, {"requests": 1000, "errors": 5, "p99": None})[0], "10 percent errors is a regression")
    ok(not regression({"requests": 100, "errors": 1, "p99": None}, {"requests": 1000, "errors": 5, "p99": None})[0], "1 percent errors passes")
    ok(regression({"requests": 100, "errors": 0, "p99": 400}, {"requests": 1000, "errors": 0, "p99": 100})[0], "p99 4x is a regression")
    ok(file_version('var VERSION = "1.2.3-x";') == "1.2.3-x", "version parse")

    def mk(bad_stats=False, health_bad=False, upload_ok=True, live=1, preview_misses=0):
        calls = []
        preview_calls = 0

        def api(m, p, b=None, files=None):
            calls.append((m, p, b))
            if p.endswith("/deployments") and m == "GET":
                return 200, {"result": {"deployments": [{"versions": [{"version_id": "old", "percentage": 100}] * live}]}}
            if p.endswith("/settings"):
                return 200, {"result": {"compatibility_date": "2026-10-01", "compatibility_flags": []}}
            if p.endswith("/versions"):
                return (200, {"result": {"id": "newv"}}) if upload_ok else (400, {"errors": ["nope"]})
            if p.endswith("/deployments") and m == "POST":
                return 200, {"success": True}
            if p == "/graphql":
                n = {"requests": 200, "errors": 40 if bad_stats else 0}
                rows = [{"dimensions": {"scriptVersion": "newv"}, "sum": n, "quantiles": {}},
                        {"dimensions": {"scriptVersion": "old"}, "sum": {"requests": 800, "errors": 0}, "quantiles": {}}]
                return 200, {"data": {"viewer": {"accounts": [{"workersInvocationsAdaptive": rows}]}}}
            return 404, {}

        pre = []

        def fetch(url, headers=None):
            nonlocal preview_calls
            if headers:
                preview_calls += 1
                if preview_calls <= preview_misses:
                    return 200, '{"version":"9.9.8"}'
                return 200, '{"version":"9.9.9"}'
            if not pre:  # GRADUAL-ALREADY-LIVE-1: the live script still serves the previous version before the upload
                pre.append(1)
                return 200, '{"version":"9.9.8"}'
            return (500, "") if health_bad else (200, '{"version":"9.9.9"}')
        return calls, api, fetch
    d = tempfile.mkdtemp()
    f = os.path.join(d, "worker.js")
    with open(f, "w") as fh:
        fh.write('var VERSION = "9.9.9";\nexport default {};\n')
    cases = [("good", {}, 0, "rolled-out"), ("preview propagation", {"preview_misses": 2}, 0, "rolled-out"),
             ("bad stats", {"bad_stats": True}, 1, "rolled-back"), ("health", {"health_bad": True}, 1, "rolled-back"),
             ("upload refused", {"upload_ok": False}, 1, "refused"), ("rollout in progress", {"live": 2}, 1, "refused")]
    for name, kw, want_rc, want_out in cases:
        calls, api, fetch = mk(**kw)
        res = {}
        rc = run("w", "a", "t", path=f, api=api, sleep=lambda s: None, fetch=fetch, emit=lambda s, r=res: r.update(json.loads(s.split("=", 1)[1])))
        ok(rc == want_rc and res.get("outcome") == want_out, "%s: rc %s outcome %s" % (name, rc, res.get("outcome")))
        posts = [c for c in calls if c[0] == "POST" and c[1].endswith("/deployments")]
        if name == "good":
            ok([[v["percentage"] for v in c[2]["versions"]] for c in posts] == [[10, 90], [50, 50], [100]], "stages 10/50/100: %r" % [c[2]["versions"] for c in posts])
        if name == "bad stats":
            ok(posts[-1][2]["versions"] == [{"version_id": "old", "percentage": 100}], "rollback deploys the old version at 100")
        if name == "health":
            ok(len(posts) >= 1 and posts[-1][2]["versions"][0]["version_id"] == "old", "a failed health check rolls back")
        if name == "preview propagation":
            ok(res.get("smoke", {}).get("attempts") == 3, "a stale preview version retries until the uploaded version is served")
        if name in ("upload refused", "rollout in progress"):
            ok(not posts, "%s: nothing deployed" % name)
    calls, api, _ = mk()
    res = {}
    preview_calls = []
    def unavailable_preview(url, headers=None):
        if headers:
            preview_calls.append(1)
        return 500, ""
    rc = run("w", "a", "t", path=f, api=api, sleep=lambda s: None, fetch=unavailable_preview, emit=lambda s: res.update(json.loads(s.split("=", 1)[1])))
    ok(rc == 1 and not [c for c in calls if c[0] == "POST" and c[1].endswith("/deployments")] and res.get("rolled_back") is False, "smoke failure: no deployment at all")
    ok(len(preview_calls) == PREVIEW_SMOKE_ATTEMPTS, "a persistently unavailable preview stops after the bounded retry window")
    print("gradual_deploy selftest: %s" % ("FAILED: " + "; ".join(fails) if fails else "ok"))
    return 1 if fails else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worker")
    ap.add_argument("--path")
    ap.add_argument("--soak-sec", type=int, default=120)
    ap.add_argument("--stages", default="10,50,100")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not a.worker:
        print("--worker is required")
        return 2
    token, acct = os.environ.get("CLOUDFLARE_API_TOKEN", ""), os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
    if not token or not acct:
        print("::error::CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required")
        return 2
    stages = tuple(int(x) for x in a.stages.split(",") if x.strip())
    if not stages or stages[-1] != 100 or any(not 0 < s <= 100 for s in stages):
        print("--stages must be increasing percentages ending in 100")
        return 2
    return run(a.worker, acct, token, a.path, stages, a.soak_sec, a.dry_run)


if __name__ == "__main__":
    sys.exit(main())
