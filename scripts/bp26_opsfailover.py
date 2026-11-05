#!/usr/bin/env python3
"""OPS-FAILOVER-1 collector (2026-11-05, charter pillars autonomy and security; roadmap row RM-S1-REDUNDANCY-1 "failover host for the single ops gateway").

One metric, measured from the real thing and never written by hand (scripts/bp26_producers.py contract):

  ops_gateway_hosts_ok   of the two hostnames that serve the qnfo-ops worker (the custom domain https://ops.qnfo.org and the workers.dev host
                         https://qnfo-ops.q08.workers.dev, `workers_dev = true`), the share that answers BOTH GET /health (HTTP 200, status ok, worker qnfo-ops, a
                         version) and GET /v1/models (HTTP 200, the model id `ops`). Both routes are static: they read no D1, so they are the part of the gateway that must
                         keep answering while qnfo-audit is overloaded. 1 = both hostnames serve the gateway, 0.5 = one does, 0 = neither does. A failing request is retried
                         once before the host counts as down. The two hostnames serving different versions is a rollout in progress or a stuck deploy: it is recorded in
                         the note and the evidence rows and does not lower the value.

WHY HERE  A Worker cannot fetch its own account's workers.dev hosts (Cloudflare error 1042), so the fleet cannot test this alternate host from inside; the GitHub runner of the
          remediation-consumer job can. The alternate host matters exactly when the first one is cut off at the zone: a WAF rule or an Access application on ops.qnfo.org
          (RM-WAF-RATE-LIMIT-1 and the Access rollout in docs/CF-ACCESS-ROLLOUT-1277.md both put one there) or a DNS or custom-domain fault. It does not protect against a broken
          worker; a broken deploy is the canary revert and the second deploy path (scripts/direct_content_deploy.py).

LIMITS    It proves that the alternate hostname serves the gateway, not that any client switches to it: ANTHROPIC_BASE_URL and the sessions name ops.qnfo.org. When both
          hostnames fail while a control worker answers, the value is 0; when the control worker fails too, the runner has no route to the account and the value is unknown
          (None, nothing written).

Usage:
  python3 scripts/bp26_opsfailover.py --selftest       offline suite (fake responses, no network, no secrets)
  python3 scripts/bp26_producers.py --dry --only ops_failover     live run through the framework, writes nothing
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bp26_producers import Collector, Resp, Result  # noqa: E402

HOSTS = (("primary", "https://ops.qnfo.org"), ("alternate", "https://qnfo-ops.q08.workers.dev"))
CONTROL = "https://qnfo-memory-mcp.q08.workers.dev/health"
TIMEOUT_S = 15


def _health_ok(resp):
    """(ok, version) for a /health answer of the gateway."""
    if getattr(resp, "status", 0) != 200:
        return False, None
    try:
        d = json.loads(resp.text)
    except (TypeError, ValueError):
        return False, None
    if not isinstance(d, dict) or d.get("worker") != "qnfo-ops" or d.get("status") != "ok" or not d.get("version"):
        return False, None
    return True, str(d.get("version"))


def _models_ok(resp):
    return getattr(resp, "status", 0) == 200 and '"ops"' in (getattr(resp, "text", "") or "")


def _get_with_retry(ctx, url):
    r = ctx.http(url, timeout=TIMEOUT_S)
    if getattr(r, "status", 0) != 200:
        r = ctx.http(url, timeout=TIMEOUT_S)
    return r


def check_host(ctx, base):
    """(ok, version, detail) for one hostname of the gateway."""
    h = _get_with_retry(ctx, base + "/health")
    h_ok, ver = _health_ok(h)
    m = _get_with_retry(ctx, base + "/v1/models")
    m_ok = _models_ok(m)
    detail = "/health %s%s in %s ms; /v1/models %s%s" % (h.status or "no answer", " ok" if h_ok else "", h.ms, m.status or "no answer", " ok" if m_ok else "")
    if not h.status and h.error:
        detail += " (%s)" % h.error
    return h_ok and m_ok, ver, detail


def collect_ops_failover(ctx):
    results = []
    for label, base in HOSTS:
        ok, ver, detail = check_host(ctx, base)
        results.append((label, base, ok, ver, detail))
    n_ok = sum(1 for r in results if r[2])
    rows = [("%s %s" % (r[0], r[1].replace("https://", "")), 1 if r[2] else 0, r[4]) for r in results]
    vers = sorted({r[3] for r in results if r[2] and r[3]})
    if len(vers) > 1:
        rows.append(("version-skew", None, "the hostnames serve different versions: %s (a rollout in progress or a stuck deploy)" % ", ".join(vers)))
    if n_ok == 0:
        ctl = ctx.http(CONTROL, timeout=TIMEOUT_S)
        if getattr(ctl, "status", 0) != 200:
            return [Result("ops_gateway_hosts_ok", None, "neither gateway hostname answered and the control worker did not either: the runner has no route to the account, unknown, nothing written", rows)]
        rows.append(("control qnfo-memory-mcp", 1, "/health 200: the account is reachable, so both gateway hostnames are down"))
    value = n_ok / float(len(HOSTS))
    note = "%d of %d gateway hostnames serve qnfo-ops (%s)" % (n_ok, len(HOSTS), ", ".join("%s %s" % (r[0], r[3] or "down") for r in results))
    return [Result("ops_gateway_hosts_ok", value, note, rows)]


COLLECTORS = [
    Collector("ops_failover", collect_ops_failover, ["ops_gateway_hosts_ok"], 50),
]


# ---------------------------------------------------------------- selftest
def selftest():
    from bp26_producers import Ctx
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)
            print("FAIL " + m)

    def R(status, text="", ms=7, error=None):
        return Resp(status, {}, [], text, "", ms, [], error)

    def health(ver="2.63.0"):
        return json.dumps({"status": "ok", "worker": "qnfo-ops", "version": ver, "models": ["ops"]})
    models = json.dumps({"object": "list", "data": [{"id": "ops", "object": "model"}]})

    def fake(table, default=None, log=None):
        def http(url, **kw):
            if log is not None:
                log.append(url)
            v = table.get(url, default)
            return v if v is not None else R(0, "", 0, "timeout")
        return http

    pri, alt = "https://ops.qnfo.org", "https://qnfo-ops.q08.workers.dev"
    both = {pri + "/health": R(200, health()), pri + "/v1/models": R(200, models), alt + "/health": R(200, health()), alt + "/v1/models": R(200, models)}
    out = collect_ops_failover(Ctx(http=fake(both)))[0]
    ok(out.metric == "ops_gateway_hosts_ok" and out.value == 1.0 and len(out.rows) == 2 and all(r[1] == 1 for r in out.rows), "both hostnames serve the gateway -> 1.0: %r" % (out,))
    ok("2.63.0" in out.note, "the note names the version")

    # alternate down
    t = dict(both)
    t[alt + "/health"] = R(522)
    t[alt + "/v1/models"] = R(522)
    log = []
    out = collect_ops_failover(Ctx(http=fake(t, log=log)))[0]
    ok(out.value == 0.5 and [r[1] for r in out.rows] == [1, 0], "alternate down -> 0.5 and the row names it: %r" % (out,))
    ok(log.count(alt + "/health") == 2, "a failing request is retried once before the host counts as down: %r" % (log,))

    # a flaky first answer that recovers on the retry still counts
    calls = {"n": 0}

    def flaky(url, **kw):
        if url == alt + "/health":
            calls["n"] += 1
            return R(503) if calls["n"] == 1 else R(200, health())
        return both.get(url) or R(0, "", 0, "timeout")
    out = collect_ops_failover(Ctx(http=flaky))[0]
    ok(out.value == 1.0, "one 503 followed by a 200 on the retry counts as up: %r" % (out,))

    # wrong body is not the gateway
    t = dict(both)
    t[pri + "/health"] = R(200, json.dumps({"status": "ok", "worker": "someone-else", "version": "1"}))
    out = collect_ops_failover(Ctx(http=fake(t)))[0]
    ok(out.value == 0.5, "a 200 from a different worker does not count: %r" % (out,))
    t = dict(both)
    t[pri + "/v1/models"] = R(200, "<html>captive portal</html>")
    out = collect_ops_failover(Ctx(http=fake(t)))[0]
    ok(out.value == 0.5, "a models route without the id ops does not count: %r" % (out,))
    t = dict(both)
    t[pri + "/health"] = R(200, "not json")
    ok(collect_ops_failover(Ctx(http=fake(t)))[0].value == 0.5, "a health body that is not JSON does not count")

    # version skew is recorded and does not lower the value
    t = dict(both)
    t[alt + "/health"] = R(200, health("2.62.20"))
    out = collect_ops_failover(Ctx(http=fake(t)))[0]
    ok(out.value == 1.0 and any(r[0] == "version-skew" and "2.62.20" in r[2] and "2.63.0" in r[2] for r in out.rows), "different versions are named in a row and the value stays 1.0: %r" % (out,))

    # both down: 0 only when the control worker proves the account is reachable
    ctl = {CONTROL: R(200, "{}")}
    down = {pri + "/health": R(530), pri + "/v1/models": R(530), alt + "/health": R(530), alt + "/v1/models": R(530)}
    out = collect_ops_failover(Ctx(http=fake(dict(down, **ctl))))[0]
    ok(out.value == 0.0 and any(r[0].startswith("control") for r in out.rows), "both down and the control answers -> 0: %r" % (out,))
    out = collect_ops_failover(Ctx(http=fake(down)))[0]
    ok(out.value is None and "no route to the account" in out.note, "both down and the control down -> unknown, never zero: %r" % (out,))
    out = collect_ops_failover(Ctx(http=fake({})))[0]
    ok(out.value is None, "nothing answers at all -> unknown")

    # only GET, no credential
    seen = []

    def spy(url, **kw):
        seen.append((url, kw))
        return both.get(url) or R(0, "", 0, "timeout")
    collect_ops_failover(Ctx(http=spy))
    ok(all(not kw.get("method") and not kw.get("data") and not kw.get("headers") for _u, kw in seen), "plain GETs with no body and no header (no credential)")
    ok(sorted({u.split("/", 3)[3] for u, _kw in seen}) == ["health", "v1/models"], "only /health and /v1/models are read")

    ok(len(COLLECTORS) == 1 and COLLECTORS[0].metrics == ["ops_gateway_hosts_ok"] and COLLECTORS[0].every_min <= 60, "one collector, one metric, hourly cadence")
    print("bp26_opsfailover selftest %s" % ("ok" if not fails else "FAILED %d" % len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    print("bp26_opsfailover is a collector module: python3 scripts/bp26_producers.py --dry --only ops_failover")
