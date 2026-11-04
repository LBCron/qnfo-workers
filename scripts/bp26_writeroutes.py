#!/usr/bin/env python3
"""WRITE-ROUTES-1 collector (2026-11-04, charter pillar security; roadmap row RM-TP-8-TRUST-BOUNDARY, docs/TRANSFORMATION-PROGRAM.md T8 lever 1).

One metric, measured from the real thing and never written by hand (scripts/bp26_producers.py contract):

  unauth_write_routes_open   write routes of scripts/write-routes.json (section `probe`) that answered a 2xx to a POST with an EMPTY body and NO credential,
                             sent from the GitHub runner (the remediation-consumer job), outside the Cloudflare account. The target is 0: T8's exit is "every
                             write route answers 401 or 403 unauthenticated". Evidence rows (bp26_probe_results) carry one line per route: refused (401 or 403),
                             absent (404, 405 or 410: the manifest drifted), unproven (400, 415, 422 or a redirect: the handler read the body or redirected before it
                             refused, so the gate is not shown), unknown (5xx, timeout, 429) or OPEN.

WHY IT IS SAFE TO RUN  A probe that finds an open route also runs it, so a route is listed under `probe` only when an open answer is harmless: an empty body does
                       nothing, or the route runs the same idempotent job its own cron runs every 15 to 20 minutes. A route that sends mail, publishes, spends money,
                       takes a lock or writes configuration is listed under `register` and is never POSTed; `never_probe_suffixes` is enforced twice, by this
                       collector at run time and by the selftest on the manifest. No credential, cookie or secret is ever sent, and the runner makes at most one
                       request per route per hour.

LIMITS  A refusal proves the gate exists for an anonymous caller; it does not prove the gate is correct for a caller holding a wrong token, and a 400 before the
        auth check shows nothing either way (those rows are `unproven` and listed in the note). The `register` section is the owner of every route the probe may not
        POST: its entries marked open-gap are filed as agent_issues with a doer; the others are by design (sessions hold no credential) or proven by reading code.
        A worker that is down answers 5xx or times out: unknown, never counted as refused, and more than a third unknown with nothing open makes the value None.

Usage:
  python3 scripts/bp26_writeroutes.py --selftest       offline suite (fake responses, no network, no secrets)
  python3 scripts/bp26_producers.py --dry --only write_routes     live run through the framework, writes nothing
"""
import concurrent.futures
import json
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bp26_producers import Collector, Resp, Result  # noqa: E402

MANIFEST = "scripts/write-routes.json"
REFUSED = (401, 403)
ABSENT = (404, 405, 410)
UNPROVEN = (400, 415, 422)
DISPOSITIONS = ("open-by-design", "open-gap", "unverified", "refused-once", "refused-by-code")
UNKNOWN_SHARE_MAX = 1.0 / 3.0
PROBE_TIMEOUT_S = 15
PARALLEL = 5


def load_manifest(ctx):
    """The parsed manifest, or None when it is missing or unreadable (unknown, never zero)."""
    try:
        m = json.loads(ctx.read(MANIFEST))
    except (OSError, ValueError):
        return None
    return m if isinstance(m, dict) else None


def classify(resp):
    """(label, ok) for one unauthenticated empty-body POST answer. ok is 1 refused or absent, 0 open, None unproven or unknown."""
    st = getattr(resp, "status", 0) or 0
    err = getattr(resp, "error", None)
    if getattr(resp, "hops", None):
        return "unproven", None  # the framework followed a redirect: the final answer (often a 200 login page) says nothing about the route
    if st in REFUSED:
        return "refused", 1
    if st in ABSENT:
        return "absent", 1
    if 200 <= st < 300:
        return "OPEN", 0
    if st in UNPROVEN or (300 <= st < 400) or err == "redirect-loop":
        return "unproven", None
    return "unknown", None


def never_probed(url, suffixes):
    path = urllib.parse.urlparse(url).path
    return any(path.endswith(s) for s in suffixes)


def probe_one(ctx, entry, suffixes):
    """(subject, label, ok, detail) for one manifest entry. Sends one POST, empty body, no credential."""
    url = str(entry.get("url") or "")
    path = urllib.parse.urlparse(url).path or "/"
    subject = "%s POST %s" % (entry.get("worker", "?"), path)
    if not url.startswith("https://") or never_probed(url, suffixes):
        return subject, "skipped", None, "not probed: not https or on the never-probe list"
    resp = ctx.http(url, method="POST", data=b"", headers={"Content-Type": "application/json"}, timeout=PROBE_TIMEOUT_S, follow=0)
    label, ok = classify(resp)
    detail = "HTTP %s %s" % (resp.status, label) if resp.status else "no answer (%s)" % (resp.error or "unknown")
    return subject, label, ok, detail


def collect_write_routes(ctx):
    m = load_manifest(ctx)
    if not m or not isinstance(m.get("probe"), list) or not m["probe"]:
        return [Result("unauth_write_routes_open", None, "scripts/write-routes.json is missing or has no probe list: unknown, nothing written")]
    suffixes = tuple(str(s) for s in (m.get("never_probe_suffixes") or ()))
    entries = [e for e in m["probe"] if isinstance(e, dict)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=PARALLEL) as pool:
        out = list(pool.map(lambda e: probe_one(ctx, e, suffixes), entries))
    probed = [o for o in out if o[1] != "skipped"]
    n_open = sum(1 for o in probed if o[1] == "OPEN")
    n_unknown = sum(1 for o in probed if o[1] == "unknown")
    counts = {}
    for o in probed:
        counts[o[1]] = counts.get(o[1], 0) + 1
    reg = m.get("register") or []
    gaps = sum(1 for r in reg if isinstance(r, dict) and r.get("disposition") == "open-gap")
    rows = [(s, ok, d) for s, _l, ok, d in out]
    rows += [("register:%s %s" % (r.get("worker"), r.get("route")), None, "%s: %s" % (r.get("disposition"), str(r.get("why", ""))[:200])) for r in reg if isinstance(r, dict) and r.get("disposition") == "open-gap"]
    summary = "%d routes probed (%s); %d register entries marked open-gap that the probe may not POST" % (len(probed), ", ".join("%d %s" % (v, k) for k, v in sorted(counts.items())), gaps)
    if not probed or (n_open == 0 and n_unknown > UNKNOWN_SHARE_MAX * len(probed)):
        return [Result("unauth_write_routes_open", None, "too many routes unknown to call the surface closed: " + summary, rows)]
    return [Result("unauth_write_routes_open", n_open, summary, rows)]


COLLECTORS = [
    Collector("write_routes", collect_write_routes, ["unauth_write_routes_open"], 50),
]


# ---------------------------------------------------------------- selftest
def selftest():
    import tempfile
    from bp26_producers import Ctx
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)
            print("FAIL " + m)

    def R(status, error=None):
        return Resp(status, {}, [], "", "", 5, [], error)

    # classification
    for st, want in ((401, ("refused", 1)), (403, ("refused", 1)), (404, ("absent", 1)), (405, ("absent", 1)), (410, ("absent", 1)), (200, ("OPEN", 0)), (202, ("OPEN", 0)),
                     (204, ("OPEN", 0)), (400, ("unproven", None)), (422, ("unproven", None)), (302, ("unproven", None)), (429, ("unknown", None)), (500, ("unknown", None)),
                     (503, ("unknown", None)), (0, ("unknown", None))):
        ok(classify(R(st)) == want, "classify %s -> %r got %r" % (st, want, classify(R(st))))
    ok(classify(R(0, "redirect-loop")) == ("unproven", None), "a redirect the probe does not follow is unproven")
    ok(classify(Resp(200, {}, [], "<html>login</html>", "https://x/login", 5, [(302, "https://x/api")], None)) == ("unproven", None),
       "a 200 reached through a redirect (a login page) is unproven, never OPEN")
    ok(classify(R(0, "timeout")) == ("unknown", None), "a timeout is unknown, never refused")

    # the real manifest: shape, safety, no duplicates
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ctx0 = Ctx(root=root)
    m = load_manifest(ctx0)
    ok(m is not None and isinstance(m.get("probe"), list) and len(m["probe"]) >= 10, "the manifest loads with at least ten probe routes")
    m = m or {"probe": [], "register": [], "never_probe_suffixes": []}
    sfx = tuple(m.get("never_probe_suffixes") or ())
    ok(len(sfx) >= 10, "the never-probe list is present")
    urls = [e.get("url") for e in m["probe"]]
    ok(len(urls) == len(set(urls)), "no route is listed twice")
    for e in m["probe"]:
        u = urllib.parse.urlparse(str(e.get("url")))
        ok(u.scheme == "https" and u.hostname and (u.hostname.endswith("qnfo.org") or u.hostname.endswith("q08.workers.dev")), "probe host is a fleet host over https: %s" % e.get("url"))
        ok(not never_probed(str(e.get("url")), sfx), "a probe route never ends in a never-probe suffix: %s" % e.get("url"))
        ok(bool(e.get("worker")) and len(str(e.get("why", ""))) > 20, "probe entry names its worker and why an open answer is harmless: %s" % e.get("url"))
    for suffix in ("/work-lock/acquire", "/secret-lock/acquire", "/lock/acquire", "/ledger", "/thresholds", "/run/digest", "/digest/send", "/api/cmd/code", "/subscribe"):
        ok(suffix in sfx, "never-probe list names " + suffix)
    for r in m.get("register") or []:
        ok(r.get("disposition") in DISPOSITIONS and r.get("worker") and r.get("route") and len(str(r.get("why", ""))) > 20, "register entry is complete: %r" % (r.get("route"),))
    for r in m.get("register") or []:
        if r.get("disposition") == "open-gap":
            ok("issue" in str(r.get("why", "")), "an open-gap entry points at its filed issue: %s" % r.get("route"))

    # the collector against fake answers: nothing open
    seen = []

    def fake(table, default=401):
        def http(url, **kw):
            seen.append((url, kw))
            st = table.get(url, default)
            return R(st) if isinstance(st, int) else st
        return http
    out = collect_write_routes(Ctx(root=root, http=fake({})))[0]
    ok(out.metric == "unauth_write_routes_open" and out.value == 0, "every route refused -> 0 open: %r" % (out,))
    ok(len(seen) == len(m["probe"]), "one request per probe route, none for the register")
    ok(all(kw.get("method") == "POST" and kw.get("data") == b"" for _u, kw in seen), "every probe is a POST with an empty body")
    sent_headers = [str(k).lower() for _u, kw in seen for k in (kw.get("headers") or {})]
    ok(all(h in ("content-type",) for h in sent_headers), "no credential header is ever sent: %r" % sorted(set(sent_headers)))
    ok(not any(never_probed(u, sfx) for u, _kw in seen), "no request went to a never-probe route")
    ok(all(kw.get("follow") == 0 for _u, kw in seen), "the probe asks for no redirect following (the framework follows at most one hop and classify() treats it as unproven)")

    # one open route is counted and named
    target = m["probe"][0]["url"]
    out = collect_write_routes(Ctx(root=root, http=fake({target: 200})))[0]
    ok(out.value == 1, "one 200 -> one open route: %r" % (out,))
    ok(any(r_[1] == 0 and "OPEN" in r_[2] for r_ in out.rows), "the evidence row names the open route")
    out = collect_write_routes(Ctx(root=root, http=fake({m["probe"][0]["url"]: 202, m["probe"][1]["url"]: 200, m["probe"][2]["url"]: 400})))[0]
    ok(out.value == 2, "202 and 200 are open, 400 is only unproven: %r" % (out,))
    ok("1 unproven" in out.note, "the note counts the unproven routes")

    # unknown never reads as closed
    out = collect_write_routes(Ctx(root=root, http=fake({}, default=503)))[0]
    ok(out.value is None, "every route down -> unknown, nothing written: %r" % (out,))
    out = collect_write_routes(Ctx(root=root, http=fake({}, default=R(0, "timeout"))))[0]
    ok(out.value is None, "every route timing out -> unknown")
    half = {e["url"]: 503 for e in m["probe"][: len(m["probe"]) // 2]}
    out = collect_write_routes(Ctx(root=root, http=fake(half, default=401)))[0]
    ok(out.value is None, "half the routes unknown and none open -> unknown")
    half[m["probe"][-1]["url"]] = 200
    out = collect_write_routes(Ctx(root=root, http=fake(half, default=401)))[0]
    ok(out.value == 1, "an open route is reported even when many answers are unknown: %r" % (out,))

    # a broken or missing manifest is unknown, never zero
    td = tempfile.mkdtemp()
    out = collect_write_routes(Ctx(root=td, http=fake({})))[0]
    ok(out.value is None and "missing" in out.note, "no manifest -> unknown")
    os.makedirs(os.path.join(td, "scripts"))
    with open(os.path.join(td, "scripts", "write-routes.json"), "w") as f:
        f.write("{not json")
    out = collect_write_routes(Ctx(root=td, http=fake({})))[0]
    ok(out.value is None, "unparseable manifest -> unknown")

    # a never-probe suffix listed by mistake is skipped at run time, not sent
    with open(os.path.join(td, "scripts", "write-routes.json"), "w") as f:
        json.dump({"probe": [{"worker": "w", "url": "https://qnfo-deploy-guard.q08.workers.dev/lock/acquire", "why": "listed by mistake for the test"},
                             {"worker": "w", "url": "https://ops.qnfo.org/mcp", "why": "a normal route for the test"}],
                   "never_probe_suffixes": ["/lock/acquire"]}, f)
    seen[:] = []
    out = collect_write_routes(Ctx(root=td, http=fake({})))[0]
    ok(len(seen) == 1 and seen[0][0].endswith("/mcp") and out.value == 0, "a route on the never-probe list is not sent: %r" % (seen,))

    ok(len(COLLECTORS) == 1 and COLLECTORS[0].metrics == ["unauth_write_routes_open"] and COLLECTORS[0].every_min <= 60, "one collector, one metric, hourly cadence like its BP26 siblings")
    print("bp26_writeroutes selftest %s" % ("ok" if not fails else "FAILED %d" % len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    print("bp26_writeroutes is a collector module: python3 scripts/bp26_producers.py --dry --only write_routes")
