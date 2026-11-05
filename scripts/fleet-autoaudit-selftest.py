#!/usr/bin/env python3
"""fleet-autoaudit-selftest.py - DRIFT-CONFIRM-1 acceptance gate. Offline: the guard and git are faked.

Proves run_guard() (a) does NOT re-run when the first pass is clean, (b) re-runs ONCE against a refreshed checkout when it
sees drift and reports the CONFIRMED result (a race that vanished is not reported), (c) still reports a drift that survives
the refresh, (d) keeps the first result when the checkout cannot be refreshed (no silent success, no crash), and
(e) preserves the guard return code and persists state; D1-TRANSIENT-RETRY-1 (#687): a transient D1 reply is retried before it
counts as a write failure, a SQL error is not. Exit 0 = all passed.
"""
import importlib.util, os, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("fa", os.path.join(HERE, "fleet-autoaudit.py"))
fa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fa)
fa.STATE = os.path.join(tempfile.mkdtemp(), "state.json")

fails = []
def check(label, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + label + ((" -- %r" % (extra,)) if extra != "" else ""))
    if not cond:
        fails.append(label)

def scenario(passes, refresh_result):
    calls = {"guard": 0, "refresh": 0}
    seq = list(passes)
    def fake_guard():
        calls["guard"] += 1
        return dict(seq.pop(0), _guard_rc=0)
    def fake_refresh():
        calls["refresh"] += 1
        return refresh_result
    fa._run_guard_once, fa._refresh_repo = fake_guard, fake_refresh
    return fa.run_guard(), calls

CLEAN = {"drift": [], "content_drift": [], "sync_workers": [{"worker": "a", "version": "1"}]}
DRIFT = {"drift": [{"worker": "qnfo-cloud-ops", "repo": "1.15.5", "live": "1.15.6"}], "content_drift": [], "sync_workers": []}

d, c = scenario([CLEAN], True)
check("clean first pass: guard runs once, no refresh attempted", c == {"guard": 1, "refresh": 0}, c)

d, c = scenario([DRIFT, CLEAN], True)
check("drift that vanishes on a fresh checkout is NOT reported", not d["drift"] and c == {"guard": 2, "refresh": 1}, (d.get("drift"), c))
check("the confirm step records what the first pass saw", d.get("_drift_confirm", {}).get("first_pass") == ["qnfo-cloud-ops"] and d["_drift_confirm"]["second_pass"] == [], d.get("_drift_confirm"))

d, c = scenario([DRIFT, DRIFT], True)
check("drift that SURVIVES the refresh is still reported", [i["worker"] for i in d["drift"]] == ["qnfo-cloud-ops"] and c["guard"] == 2, c)

d, c = scenario([DRIFT], False)
check("checkout could not be refreshed: first result stands, no second pass", [i["worker"] for i in d["drift"]] == ["qnfo-cloud-ops"] and c == {"guard": 1, "refresh": 1}, c)

CD = {"drift": [], "content_drift": [{"worker": "w", "repo_sha": "x"}], "sync_workers": []}
d, c = scenario([CD, CLEAN], True)
check("content drift is confirmed the same way", not d["content_drift"] and c["guard"] == 2, c)

d, c = scenario([DRIFT, CLEAN], True)
check("guard return code is preserved and state is persisted", d.get("_guard_rc") == 0 and os.path.getsize(fa.STATE) > 0)

# ---------------------------------------------------------------- DEPLOY-SETTLE-1
class FakeTime:
    """Virtual clock: sleep() advances time, so the budget logic is exercised instantly and deterministically."""
    def __init__(self): self.t = 1_000_000.0
    def time(self): return self.t
    def sleep(self, x): self.t += x

def settle_case(ahead, probes, age_s):
    """probes: {worker: [version, ...]} consumed one per probe (last value repeats)."""
    clock, calls = FakeTime(), {"probe": 0}
    seq = {w: list(v) for w, v in probes.items()}
    def fake_probe(w):
        calls["probe"] += 1
        v = seq[w]
        return v.pop(0) if len(v) > 1 else v[0]
    real = (fa.time, fa.probe_version, fa._commit_age_s)
    fa.time, fa.probe_version, fa._commit_age_s = clock, fake_probe, (lambda d: age_s)
    try:
        data = {"drift": [{"worker": a["worker"], "repo": a["repo"], "live": a["live"]} for a in ahead],
                "ahead": [dict(a, dir=a["worker"], artifact=a["worker"] + "/worker.js") for a in ahead], "sync_workers": []}
        out = fa._settle_inflight(data)
    finally:
        fa.time, fa.probe_version, fa._commit_age_s = real
    return out, calls, clock.t - 1_000_000.0

ERR = {"worker": "errata-hub", "repo": "1.1.4", "live": "1.1.3"}
RAD = {"worker": "radar-hub", "repo": "1.0.9", "live": "1.0.8"}

out, calls, waited = settle_case([ERR], {"errata-hub": ["1.1.3", "1.1.3", "1.1.4"]}, 60)
check("deploy landing inside the window -> SYNC, removed from drift AND ahead (so --apply cannot redeploy it)",
      not out["drift"] and not out["ahead"] and out["sync_workers"] == [{"worker": "errata-hub", "version": "1.1.4"}] and calls["probe"] == 3, (out, calls))
check("it only waited as long as needed", waited == 30, waited)

out, calls, waited = settle_case([ERR], {"errata-hub": ["1.1.3"]}, 60)
check("deploy that never lands stays DRIFT and ahead", [i["worker"] for i in out["drift"]] == ["errata-hub"] and len(out["ahead"]) == 1 and not out["sync_workers"], out)
check("the wait is bounded by the budget", waited <= fa.SETTLE_BUDGET_S and calls["probe"] <= 8, (waited, calls))

out, calls, waited = settle_case([ERR], {"errata-hub": ["1.1.3"]}, 5000)
check("an old commit cannot be mid-deploy: no probing, no waiting", calls["probe"] == 0 and waited == 0 and len(out["drift"]) == 1, (calls, waited))

out, calls, waited = settle_case([ERR], {"errata-hub": ["1.1.3"]}, None)
check("unknown commit age: no waiting (never guess)", calls["probe"] == 0 and waited == 0, (calls, waited))

out, calls, waited = settle_case([ERR, RAD], {"errata-hub": ["1.1.3", "1.1.4"], "radar-hub": ["1.0.8"]}, 60)
check("mixed: the one that landed is SYNC, the one that did not stays DRIFT",
      [i["worker"] for i in out["drift"]] == ["radar-hub"] and [i["worker"] for i in out["ahead"]] == ["radar-hub"] and [i["worker"] for i in out["sync_workers"]] == ["errata-hub"], out)

# a drift row that is NOT repo-ahead (live ahead of repo) is never touched or waited on
calls2 = {"probe": 0}
real = fa.probe_version
fa.probe_version = lambda w: calls2.__setitem__("probe", calls2["probe"] + 1) or "x"
try:
    live_ahead = fa._settle_inflight({"drift": [{"worker": "w", "repo": "1.0", "live": "2.0"}], "ahead": [], "sync_workers": []})
finally:
    fa.probe_version = real
check("drift that is not repo-ahead is never waited on", calls2["probe"] == 0 and len(live_ahead["drift"]) == 1, calls2)

# end to end: run_guard settles after the confirm step and persists the settled result
real_guard, real_ref, real_settle_deps = fa._run_guard_once, fa._refresh_repo, (fa.time, fa.probe_version, fa._commit_age_s)
fa._run_guard_once = lambda: dict({"drift": [{"worker": "errata-hub", "repo": "1.1.4", "live": "1.1.3"}], "content_drift": [],
    "ahead": [{"worker": "errata-hub", "dir": "errata-hub", "repo": "1.1.4", "live": "1.1.3", "artifact": "errata-hub/worker.js"}], "sync_workers": []}, _guard_rc=0)
fa._refresh_repo = lambda: False
fa.time, fa.probe_version, fa._commit_age_s = FakeTime(), (lambda w: "1.1.4"), (lambda d: 30)
try:
    d = fa.run_guard()
finally:
    fa._run_guard_once, fa._refresh_repo = real_guard, real_ref
    fa.time, fa.probe_version, fa._commit_age_s = real_settle_deps
check("run_guard end to end: in-flight deploy reported SYNC, state persisted without drift",
      not d["drift"] and not d["ahead"] and d.get("_deploy_settle", {}).get("settled") == ["errata-hub"], d.get("_deploy_settle"))


# _commit_age_s against REAL git: full clone answers per-path, a shallow clone must answer None (never a misleading HEAD age)
import subprocess as _sp
_tmp = tempfile.mkdtemp()
_o = os.path.join(_tmp, "o"); os.makedirs(_o)
def _g(cwd, *a): return _sp.run(["git", *a], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()
_g(_o, "init", "-q", "-b", "main"); _g(_o, "config", "user.email", "a@b"); _g(_o, "config", "user.name", "t")
os.makedirs(os.path.join(_o, "old")); os.makedirs(os.path.join(_o, "new"))
open(os.path.join(_o, "old", "f"), "w").write("1"); _g(_o, "add", "."); _sp.run(["git", "commit", "-qm", "old", "--date", "2020-01-01T00:00:00"], cwd=_o, env=dict(os.environ, GIT_COMMITTER_DATE="2020-01-01T00:00:00"), check=True)
open(os.path.join(_o, "new", "f"), "w").write("2"); _g(_o, "add", "."); _g(_o, "commit", "-qm", "new")
_full = os.path.join(_tmp, "full"); _sh = os.path.join(_tmp, "shallow")
_sp.run(["git", "clone", "-q", _o, _full], check=True); _sp.run(["git", "clone", "-q", "--depth", "1", "file://" + _o, _sh], check=True)
_real_root = fa.ROOT
try:
    fa.ROOT = _full
    a_old, a_new = fa._commit_age_s("old"), fa._commit_age_s("new")
    check("full clone: per-directory age (old dir is old, new dir is fresh)", a_old is not None and a_new is not None and a_old > 86400 * 365 and a_new < 120, (a_old, a_new))
    fa.ROOT = _sh
    check("shallow clone: age is UNKNOWN (None) for every directory, never HEAD's age", fa._commit_age_s("old") is None and fa._commit_age_s("new") is None, (fa._commit_age_s("old"), fa._commit_age_s("new")))
finally:
    fa.ROOT = _real_root

# DRIFT-CONFIRM-DIRTY-1: the refresh still fast-forwards when this run's audit artifact is modified in the working tree and
# main carries a newer copy of the same file; this run's copy is kept (the artifact step writes it from this run's data).
_r = os.path.join(_tmp, "remote"); _sp.run(["git", "clone", "-q", "--bare", _o, _r], check=True)
_c = os.path.join(_tmp, "ci"); _sp.run(["git", "clone", "-q", _r, _c], check=True)
_p = os.path.join(_tmp, "pusher"); _sp.run(["git", "clone", "-q", _r, _p], check=True)
for _d in (_c, _p):
    _g(_d, "config", "user.email", "a@b"); _g(_d, "config", "user.name", "t")
os.makedirs(os.path.join(_p, "audits")); open(os.path.join(_p, "audits", "a.json"), "w").write("v1")
_g(_p, "add", "."); _g(_p, "commit", "-qm", "artifact v1"); _g(_p, "push", "-q", "origin", "HEAD:main")
_g(_c, "pull", "-q", "--ff-only", "origin", "main")
open(os.path.join(_p, "audits", "a.json"), "w").write("v2-other-run"); open(os.path.join(_p, "new", "f"), "w").write("worker 0.4.99")
_g(_p, "add", "."); _g(_p, "commit", "-qm", "newer artifact and a worker bump"); _g(_p, "push", "-q", "origin", "HEAD:main")
open(os.path.join(_c, "audits", "a.json"), "w").write("this-run")
# a fresh module: the scenario tests above replace fa._refresh_repo with a stub and never put the real one back
_fa2 = importlib.util.module_from_spec(spec); spec.loader.exec_module(_fa2)
_fa2.ROOT = _c
moved = _fa2._refresh_repo()
check("refresh fast-forwards past a newer audit artifact on main while this run's artifact is modified",
      moved and open(os.path.join(_c, "new", "f")).read() == "worker 0.4.99", moved)
check("this run's artifact is kept after the refresh", open(os.path.join(_c, "audits", "a.json")).read() == "this-run")
check("a refresh with nothing new returns False and keeps the artifact",
      _fa2._refresh_repo() is False and open(os.path.join(_c, "audits", "a.json")).read() == "this-run")


# ---------------------------------------------------------------- RATELIMIT-RETRY-1
import io, json as _json, urllib.error as _ue, urllib.request as _ur
class _H(dict):
    def get(self, k, d=None): return super().get(k, d)
def _wait(code, headers=None, body=b"", attempt=0):
    return fa._rate_limit_wait(code, _H(headers or {}), body, attempt)

RL = b'{"message":"API rate limit exceeded for installation. If you reach out to GitHub Support..."}'
check("the exact message from run 36836230221 is retried, with backoff", _wait(403, {}, RL, 0) == 15 and _wait(403, {}, RL, 1) == 30 and _wait(403, {}, RL, 2) == 60, [_wait(403, {}, RL, i) for i in range(3)])
check("backoff is capped", _wait(403, {}, RL, 9) == fa.GH_RETRY_CAP_S, _wait(403, {}, RL, 9))
check("Retry-After is honoured", _wait(403, {"Retry-After": "20"}, RL, 0) == 20)
check("Retry-After is capped too", _wait(429, {"Retry-After": "9999"}, b"", 0) == fa.GH_RETRY_CAP_S)
import time as _t
check("x-ratelimit-reset is honoured when the quota is 0", 40 <= _wait(403, {"x-ratelimit-remaining": "0", "x-ratelimit-reset": str(int(_t.time()) + 45)}, b"forbidden", 0) <= 50)
check("429 is always a rate limit", _wait(429, {}, b"", 0) == 15)
check("secondary rate limit text is retried", _wait(403, {}, b'{"message":"You have exceeded a secondary rate limit."}', 0) == 15)
check("a 403 that is NOT a rate limit fails immediately (no retry)", _wait(403, {}, b'{"message":"Resource not accessible by integration"}', 0) is None)
check("404 / 422 / 500 are never retried as rate limits", all(_wait(c, {}, RL, 0) is None for c in (404, 422, 500)))

def run_gh(responses):
    """responses: list of ('ok', obj) | ('err', code, headers, body). Returns (result, attempts, slept)."""
    os.environ["GITHUB_TOKEN"], os.environ["GITHUB_REPOSITORY"] = "t", "o/r"
    seq, calls, slept = list(responses), {"n": 0}, []
    def fake_urlopen(req, timeout=30):
        calls["n"] += 1
        r = seq.pop(0)
        if r[0] == "ok":
            return io.BytesIO(_json.dumps(r[1]).encode())
        raise _ue.HTTPError(req.full_url, r[1], "x", _H(r[2]), io.BytesIO(r[3]))
    class _T:
        time = staticmethod(_t.time)
        @staticmethod
        def sleep(x): slept.append(x)
    real = (_ur.urlopen, fa.time)
    _ur.urlopen, fa.time = fake_urlopen, _T
    try:
        res = fa.gh_api("PATCH", "/issues/52", {"body": "x"})
    finally:
        _ur.urlopen, fa.time = real
    return res, calls["n"], slept

res, n, slept = run_gh([("err", 403, {}, RL), ("err", 403, {}, RL), ("ok", {"number": 52})])
check("rate-limited twice then recovers: the call succeeds, with backoff sleeps", res == {"number": 52} and n == 3 and slept == [15, 30], (res, n, slept))
res, n, slept = run_gh([("err", 403, {}, RL)] * 5)
check("never recovers: gives up with a clear, honest error after bounded attempts", "_error" in res and "rate-limited; gave up" in res["_error"] and n <= fa.GH_RETRY_MAX and sum(slept) <= fa.GH_RETRY_BUDGET_S, (res, n, slept))
res, n, slept = run_gh([("err", 403, {}, b'{"message":"Resource not accessible by integration"}')])
check("a non-rate-limit 403 is NOT retried (one attempt, no sleep)", "_error" in res and n == 1 and slept == [], (n, slept))
res, n, slept = run_gh([("ok", [1, 2])])
check("a normal success makes exactly one call", res == [1, 2] and n == 1 and slept == [], (n, slept))

# RATELIMIT-FAILFAST-1: a quota that GitHub says resets after the retry budget is not slept on (was: 240 s, then fail)
_far = {"x-ratelimit-remaining": "0", "x-ratelimit-reset": str(int(_t.time()) + 2400)}
res, n, slept = run_gh([("err", 403, _far, RL)] * 5)
check("quota resets beyond the budget: one attempt, no sleep, an honest error naming the reset", "_error" in res and n == 1 and slept == [] and "quota resets in" in res["_error"] and "not waiting" in res["_error"], (res, n, slept))
res, n, slept = run_gh([("err", 403, {"Retry-After": "9999"}, RL)] * 5)
check("a Retry-After beyond the budget is not slept on either", "_error" in res and n == 1 and slept == [], (n, slept))
_near = {"x-ratelimit-remaining": "0", "x-ratelimit-reset": str(int(_t.time()) + 20)}
res, n, slept = run_gh([("err", 403, _near, RL), ("ok", {"number": 52})])
check("a reset inside the budget is still waited out and the call recovers", res == {"number": 52} and n == 2 and len(slept) == 1 and 15 <= slept[0] <= 30, (res, n, slept))
res, n, slept = run_gh([("err", 403, {"x-ratelimit-remaining": "12", "x-ratelimit-reset": _far["x-ratelimit-reset"]}, b'{"message":"Resource not accessible by integration"}')])
check("a non-rate-limit 403 (quota left) still fails as itself, with no quota message", "_error" in res and n == 1 and slept == [] and "quota resets" not in res["_error"] and "rate-limited" not in res["_error"], res)

# APPLY-NO-REPUBLISH-1: in one fleet-autodeploy job only the --audit step refreshes the tracking issue
check("--audit publishes the report", fa.should_publish("--audit") is True)
check("--apply does not publish it again", fa.should_publish("--apply") is False)

def run_main(argv):
    calls = {"publish": 0, "apply": 0, "failure_events": 0}
    saved = {k: getattr(fa, k) for k in ("run_guard", "classify", "write_audit_rows", "purge_stale", "publish_issue", "apply_ahead", "_record_publish_failure", "ROOT")}
    saved_argv = sys.argv
    fa.run_guard = lambda: {"scope": "subset", "ahead": [], "_guard_rc": 0}
    fa.classify = lambda d: {"w": {"note": "SYNC"}}
    fa.write_audit_rows = lambda rows: (1, [], "2026-10-02 09:00:00")
    fa.purge_stale = lambda now: (0, None)
    def _pub(body, has_findings=True):
        calls["publish"] += 1
        return "updated", 52, "HTTP 403: rate limit"
    def _apply(d):
        calls["apply"] += 1
        return []
    def _rec(*a):
        calls["failure_events"] += 1
    fa.publish_issue, fa.apply_ahead, fa._record_publish_failure = _pub, _apply, _rec
    fa.ROOT = tempfile.mkdtemp()
    sys.argv = ["fleet-autoaudit.py", argv]
    rc = None
    try:
        fa.main()
    except SystemExit as e:
        rc = e.code
    finally:
        for k, v in saved.items():
            setattr(fa, k, v)
        sys.argv = saved_argv
    return rc, calls

rc, calls = run_main("--audit")
check("main --audit: publishes once and records the failed publish as an event", calls == {"publish": 1, "apply": 0, "failure_events": 1} and rc == 0, (rc, calls))
rc, calls = run_main("--apply")
check("main --apply: deploys, makes no GitHub issue call and writes no publish-failed row", calls == {"publish": 0, "apply": 1, "failure_events": 0} and rc == 0, (rc, calls))


# ---------------------------------------------------------------- AUDIT-CRASH-FIX-1 (2026-10-26, agent_issues 100448)
# run_main() above replaces classify() and hands main() a guard dict with no `cf_script_list`, so it could not see that main()
# iterated that key: in the real guard output it is a BOOLEAN, and `for entry in True` raised TypeError in every fleet-autodeploy run
# from 2026-10-25T20:21Z (PRs 4201, 4221 and 4226 merged it; 27 failed runs; worker_live_audit frozen at 21:03Z for 9 hours). These
# cases use the guard's real output (scripts/deploy-drift-guard-output.fixture.json, the `guard` object of
# audits/fleet-autoaudit-2026-10-25.json) and fake only the network edges.
import json as _json
REAL_GUARD = _json.load(open(os.path.join(HERE, "deploy-drift-guard-output.fixture.json")))
check("the fixture is the real shape: cf_script_list is a boolean", REAL_GUARD.get("cf_script_list") is True)

try:
    real_rows = fa.classify(REAL_GUARD)
    check("classify() accepts the guard's real output (33 sync + 13 not-a-worker + 75 not-deployed = 121 rows)", len(real_rows) == 121, len(real_rows))
except Exception as e:
    check("classify() accepts the guard's real output", False, repr(e))

def run_main_real(argv, guard_out):
    """main() with the REAL classify(); only the guard, D1, GitHub and the deployer are faked."""
    calls = {"rows": None, "apply": 0}
    saved = {k: getattr(fa, k) for k in ("run_guard", "write_audit_rows", "purge_stale", "publish_issue", "apply_ahead", "_record_publish_failure", "ROOT")}
    saved_argv = sys.argv
    fa.run_guard = lambda: dict(guard_out)
    def _wr(rows):
        calls["rows"] = rows
        return len(rows), [], "2026-10-26 06:00:00"
    fa.write_audit_rows = _wr
    fa.purge_stale = lambda now: (0, None)
    fa.publish_issue = lambda body, has_findings=True: ("updated", 52, None)
    fa._record_publish_failure = lambda *a: None
    def _apply(d):
        calls["apply"] += 1
        return []
    fa.apply_ahead = _apply
    fa.ROOT = tempfile.mkdtemp()
    sys.argv = ["fleet-autoaudit.py", argv]
    rc, err = None, None
    try:
        fa.main()
    except SystemExit as e:
        rc = e.code
    except Exception as e:
        err = repr(e)
    finally:
        for k, v in saved.items():
            setattr(fa, k, v)
        sys.argv = saved_argv
    return rc, err, calls

rc, err, calls = run_main_real("--audit", REAL_GUARD)
check("main --audit on the guard's real output finishes and writes every row", err is None and rc == 0 and calls["rows"] is not None and len(calls["rows"]) == 121, (rc, err))
rc, err, calls = run_main_real("--apply", REAL_GUARD)
check("main --apply on the guard's real output finishes and reaches the deployer", err is None and rc == 0 and calls["apply"] == 1, (rc, err, calls["apply"]))

# a class the guard emits as a flag, a null, a count or text must degrade to "no entries", whatever the class
BAD_SHAPES = [True, False, None, 7, "x", {"a": 1}]
crashed = []
for key in ("sync_workers", "drift", "content_drift", "no_repo_version", "no_live_version", "no_health_route", "live_err",
            "not_deployed_workers", "not_a_worker", "cron_only", "retired_present", "unmanaged_workers", "ahead", "cf_script_list"):
    for bad in BAD_SHAPES:
        try:
            fa.classify(dict(REAL_GUARD, **{key: bad}))
            fa.actionable(dict(REAL_GUARD, **{key: bad}), {}, [], None)
        except Exception as e:
            crashed.append((key, bad, repr(e)))
check("no list-valued guard key can crash classify()/actionable(), whatever shape it arrives in", not crashed, crashed[:3])

# UNMANAGED-PROBE-1: one reader, three outcomes
um = fa.classify({"unmanaged_workers": [
    {"worker": "voice-stt", "http": 200, "version": None},
    {"worker": "gone", "http": 404, "version": None},
    {"worker": "broken", "http": 0, "version": None},
    {"worker": "versioned", "http": 200, "version": "2.1.0"},
    "legacy-string"]})
check("an unmanaged worker answering 200 is UNMANAGED_OK (expected, in the universe)", um["voice-stt"]["note"] == "UNMANAGED_OK" and um["voice-stt"]["http"] == 200 and um["voice-stt"]["match"] == 0, um.get("voice-stt"))
check("an unmanaged worker answering 404 is UNMANAGED_NO_HEALTH, other answers UNMANAGED_ERR", um["gone"]["note"] == "UNMANAGED_NO_HEALTH" and um["broken"]["note"] == "UNMANAGED_ERR", (um["gone"], um["broken"]))
check("the unmanaged row carries the live version the guard read; a legacy bare string is accepted", um["versioned"]["live"] == "2.1.0" and um["legacy-string"]["note"] == "UNMANAGED_OK", (um["versioned"], um["legacy-string"]))
act = fa.actionable({}, um, [], None)
check("only the unmanaged workers that do not answer 200 are findings", len(act) == 2 and any("`gone`" in a for a in act) and any("`broken`" in a for a in act) and not any("voice-stt" in a for a in act), act)


# a publish that fails after retries leaves a fleet-visible event, and a broken D1 can never break the audit
seen = []
real_d1 = fa.d1
fa.d1 = lambda sql, params: seen.append((sql, params)) or {"success": True}
try:
    fa._record_publish_failure("updated", 52, "HTTP 403: rate limit", "2026-10-01 08:26:46")
finally:
    fa.d1 = real_d1
ok_ev = len(seen) == 1 and "cloud_ops_events" in seen[0][0] and seen[0][1][2] == "autoaudit.publish-failed" and seen[0][1][5] == "fleet-autoaudit" and seen[0][1][6] == "error" and len(seen[0][1]) == 7
check("publish failure writes one cloud_ops_events row (7 columns, kind autoaudit.publish-failed)", ok_ev, seen and seen[0][1])
check("the event says D1 is current and the report is stale", "stale" in seen[0][1][3] and "2026-10-01 08:26:46" in seen[0][1][3], seen[0][1][3])
def boom(sql, params): raise RuntimeError("d1 down")
fa.d1 = boom
try:
    fa._record_publish_failure("updated", 52, "x", "t"); survived = True
except Exception:
    survived = False
finally:
    fa.d1 = real_d1
check("a failing D1 write never breaks the audit", survived)

# ---------------------------------------------------------------- D1-TRANSIENT-RETRY-1 (#687)
def run_d1(responses):
    """responses: list of ('ok', obj) | ('err', code, body) | ('exc',). Returns (result, attempts, slept)."""
    os.environ.setdefault("CF_ACCOUNT_ID", "acct"); os.environ.setdefault("CLOUDFLARE_API_TOKEN", "tok")
    seq, calls, slept = list(responses), {"n": 0}, []
    def fake_urlopen(req, timeout=30):
        calls["n"] += 1
        r = seq.pop(0)
        if r[0] == "ok":
            return io.BytesIO(_json.dumps(r[1]).encode())
        if r[0] == "exc":
            raise _ue.URLError("timed out")
        raise _ue.HTTPError(req.full_url, r[1], "x", _H({}), io.BytesIO(r[2]))
    class _T:
        time = staticmethod(_t.time)
        @staticmethod
        def sleep(x): slept.append(x)
    real = (_ur.urlopen, fa.time)
    _ur.urlopen, fa.time = fake_urlopen, _T
    try:
        res = real_d1("INSERT INTO worker_live_audit VALUES (?1)", ["radar-hub"])
    finally:
        _ur.urlopen, fa.time = real
    return res, calls["n"], slept

OKR = {"success": True, "result": [{"success": True, "meta": {"changes": 1}}]}
R687 = b'{"messages":[],"result":null,"success":false,"errors":[{"code":7500,"message":"internal error; reference = e1"}]}'
res, n, slept = run_d1([("err", 500, R687), ("ok", OKR)])
check("the #687 reply (HTTP 500, code 7500 internal error) is retried and the write succeeds", fa.d1_ok(res) and n == 2 and slept == [2], (res, n, slept))
res, n, slept = run_d1([("exc",), ("err", 503, b"busy"), ("ok", OKR)])
check("a transport failure and a 503 are retried with backoff", fa.d1_ok(res) and n == 3 and slept == [2, 5], (res, n, slept))
res, n, slept = run_d1([("err", 400, b'{"success":false,"errors":[{"code":7500,"message":"no such column: x: SQLITE_ERROR"}]}')])
check("a SQL error (HTTP 400, code 7500, SQLITE_ERROR) is not retried", not fa.d1_ok(res) and n == 1 and slept == [] and "HTTP 400" in fa.d1_err(res), (res, n, slept))
res, n, slept = run_d1([("err", 500, R687)] * 3)
check("three transient failures count as one write failure that says so", not fa.d1_ok(res) and n == 3 and "after 3 attempts" in fa.d1_err(res), (res, n, slept))

# ---------------------------------------------------------------- AUTOAUDIT-ACTIONABLE-1
G = {"sync_workers": [{"worker": "a", "version": "1"}], "not_a_worker": [{"worker": "docs", "dir": "docs"}],
     "not_deployed_workers": [{"worker": "old", "dir": "old", "marker": "RETIRED"}, {"worker": "gone", "dir": "gone", "marker": None}],
     "cron_only": [{"worker": "c", "dir": "c"}], "ahead": []}
rows = fa.classify(G)
check("the D1 note of a retired absence stays NOT_DEPLOYED (consumers key on it)", rows["old"]["note"] == "NOT_DEPLOYED" and rows["old"].get("retired") == "RETIRED", rows["old"])
act = fa.actionable(G, rows, [], None)
check("only the unmarked absence is actionable", len(act) == 1 and "`gone`" in act[0], act)
G2 = dict(G, not_deployed_workers=[{"worker": "old", "dir": "old", "marker": "FOLDED"}])
check("expected states only: no actionable finding", fa.actionable(G2, fa.classify(G2), [], None) == [])
check("a D1 write failure, a failed purge and a repo-ahead worker are findings",
      len(fa.actionable(dict(G2, ahead=[{"worker": "a", "repo": "2", "live": "1"}]), fa.classify(G2), [("a", "e")], "boom")) == 3)
check("legacy bare-string not_deployed entries stay actionable", fa.actionable({"not_deployed_workers": ["x"]}, fa.classify({"not_deployed_workers": ["x"]}), [], None) != [])
body = fa.summary_md(G2, fa.classify(G2), 4, [], "2026-10-11 08:00:00")
check("the report counts retired absences apart and says the issue closes", "NOT_DEPLOYED (FOLDED/RETIRED, expected)" in body and "Actionable findings: 0" in body, body[-600:])

calls = []
def fake_gh(method, path, payload=None):
    calls.append((method, path, payload))
    if method == "GET":
        return [{"number": 52, "title": fa.ISSUE_TAG + ": scheduled fleet self-audit", "state": "open"}]
    return {}
fa.gh_api = fake_gh
check("no findings: #52 is closed as completed", fa.publish_issue("b", False)[:2] == ("closed", 52) and calls[-1][2] == {"body": "b", "state": "closed", "state_reason": "completed"}, calls[-1])
check("a finding reopens the same issue", fa.publish_issue("b", True)[:2] == ("updated", 52) and calls[-1][2] == {"body": "b", "state": "open"}, calls[-1])
check("the lookup includes closed issues so the issue is reused, not duplicated", "state=all" in calls[0][1] and "labels=fleet-autoaudit" in calls[0][1], calls[0])
calls.clear(); fa.gh_api = lambda m, p, b=None: (calls.append((m, p, b)) or ([] if m == "GET" else {"number": 99}))
check("no issue and no findings: nothing is created", fa.publish_issue("b", False)[0] == "none-needed" and len(calls) == 1, calls)

calls.clear(); fa.gh_api = lambda m, p, b=None: (calls.append((m, p, b)) or ({"_error": "HTTP 403: rate limit"} if m == "GET" else {"number": 907}))
r = fa.publish_issue("b", True)
check("a failed lookup creates no duplicate issue and reports the error", r[0] == "lookup-failed" and "403" in r[2] and len(calls) == 1, (r, calls))

# TOMBSTONE-AUDIT-ROW-1: the purge of a full audit keeps a TOMBSTONE row that the state pass refreshed in the last 3 hours (the Workers Builds stub,
# which no run of this script advances) and purges everything else it did not advance, a stale tombstone included.
import sqlite3
_db = sqlite3.connect(":memory:")
_db.execute("CREATE TABLE worker_live_audit (worker TEXT PRIMARY KEY, http INTEGER, live_version TEXT, registry_before TEXT, match INTEGER, note TEXT, probed_at TEXT)")
_now = _db.execute("SELECT datetime('now')").fetchone()[0]
for _w, _note, _age in (("advanced", "SYNC", None), ("older-sync", "SYNC", "-40 minutes"), ("orphan", "NOT_DEPLOYED", "-10 minutes"),
                        ("stub-fresh", "TOMBSTONE_410 selfstate-probe http up=retired", "-30 minutes"),
                        ("stub-stale", "TOMBSTONE_410 selfstate-probe http up=retired", "-5 hours"), ("no-note", None, "-1 minutes")):
    _db.execute("INSERT INTO worker_live_audit (worker, note, probed_at) VALUES (?, ?, CASE WHEN ? IS NULL THEN ? ELSE datetime('now', ?) END)", (_w, _note, _age, _now, _age))
_db.execute(fa.PURGE, (_now,))
_left = sorted(r[0] for r in _db.execute("SELECT worker FROM worker_live_audit"))
check("the purge keeps the row this run advanced and a tombstone row refreshed within 3 hours", _left == ["advanced", "stub-fresh"], _left)
check("and purges an older row, an orphan, a stale tombstone and a row without a note", "older-sync" not in _left and "orphan" not in _left and "stub-stale" not in _left and "no-note" not in _left, _left)
check("the purge keeps one placeholder and no LIKE pattern above 50 bytes", fa.PURGE.count("?") == 1 and "LIKE 'TOMBSTONE%'" in fa.PURGE, fa.PURGE)

# FLEET-AUTOAUDIT-APPLY-REUSE-1 (agent_issues 100366): the --apply pass of a job whose audit, minutes old, listed no repo-ahead worker makes no second sweep;
# anything that could make a deploy possible (a worker ahead, a narrow or old or missing state) still probes.
import json as _json, time as _time
_st = os.path.join(tempfile.mkdtemp(), "state.json")
def _write(d, age_s=0):
    with open(_st, "w", encoding="utf-8") as fh:
        _json.dump(d, fh)
    if age_s:
        os.utime(_st, (_time.time() - age_s, _time.time() - age_s))
_full = {"scope": "all", "_guard_rc": 0, "drift": [], "content_drift": [], "ahead": [], "sync_workers": [{"worker": "a", "version": "1"}]}
_write(_full)
check("apply reuse: a full audit of this job with nothing ahead is reused", fa.fresh_state_without_ahead(_st) is not None)
_write(dict(_full, drift=[{"worker": "w", "repo": "1.0.0", "live": "1.0.1"}]))
check("apply reuse: drift with no repo-ahead worker still means nothing to deploy", fa.fresh_state_without_ahead(_st) is not None)
_write(dict(_full, ahead=[{"worker": "w", "repo": "1.0.1", "live": "1.0.0", "artifact": "w/worker.js"}]))
check("apply reuse: a repo-ahead worker means a fresh probe before any deploy", fa.fresh_state_without_ahead(_st) is None)
_write(dict(_full, scope="narrative"))
check("apply reuse: a narrow audit is not reused", fa.fresh_state_without_ahead(_st) is None)
_write({k: v for k, v in _full.items() if k != "_guard_rc"})
check("apply reuse: a state the guard did not write is not reused", fa.fresh_state_without_ahead(_st) is None)
_write(dict(_full, ahead=True))
check("apply reuse: a flag where a list belongs reads as nothing ahead (AUDIT-CRASH-FIX-1 shape)", fa.fresh_state_without_ahead(_st) is not None)
_write(_full, age_s=fa.APPLY_REUSE_MAX_S + 60)
check("apply reuse: a state older than the window is not reused", fa.fresh_state_without_ahead(_st) is None)
_write(_full, age_s=fa.APPLY_REUSE_MAX_S - 60)
check("apply reuse: a state inside the window is reused", fa.fresh_state_without_ahead(_st) is not None)
check("apply reuse: a missing state file is not reused", fa.fresh_state_without_ahead(_st + ".absent") is None)
with open(_st, "w", encoding="utf-8") as fh:
    fh.write("{not json")
check("apply reuse: an unreadable state file is not reused", fa.fresh_state_without_ahead(_st) is None)

def _run_main(argv, env_off=False):
    """main() with a faked guard: returns (exit code, guard sweeps made)."""
    sweeps = {"n": 0}
    def fake_guard():
        sweeps["n"] += 1
        return dict(_full, _guard_rc=0)
    saved = (fa.run_guard, fa.classify, fa.write_audit_rows, fa.purge_stale, fa.summary_md, fa.apply_ahead, fa.publish_issue, sys.argv, fa.ROOT, fa.STATE)
    fa.run_guard, fa.classify = fake_guard, (lambda d: [])
    fa.write_audit_rows, fa.purge_stale = (lambda rows: (0, [], "2026-11-05 00:00:00")), (lambda now: (0, None))
    fa.summary_md, fa.apply_ahead = (lambda *a, **k: "body"), (lambda d=None: [])
    fa.publish_issue = lambda body, has: ("none-needed", 0, None)
    fa.ROOT, fa.STATE, sys.argv = tempfile.mkdtemp(), _st, ["fleet-autoaudit.py"] + argv
    if env_off:
        os.environ["FLEET_AUTOAUDIT_APPLY_REUSE"] = "off"
    try:
        try:
            fa.main()
            code = None
        except SystemExit as e:
            code = e.code
    finally:
        os.environ.pop("FLEET_AUTOAUDIT_APPLY_REUSE", None)
        (fa.run_guard, fa.classify, fa.write_audit_rows, fa.purge_stale, fa.summary_md, fa.apply_ahead, fa.publish_issue, sys.argv, fa.ROOT, fa.STATE) = saved
    return code, sweeps["n"]
_write(_full)
_r = _run_main(["--apply"])
check("main --apply after a clean audit makes no sweep and exits 0", _r == (0, 0), _r)
_write(_full)
check("main --audit always sweeps", _run_main(["--audit"])[1] == 1)
_write(_full)
check("main --apply with FLEET_AUTOAUDIT_APPLY_REUSE=off sweeps as before", _run_main(["--apply"], env_off=True)[1] == 1)
_write(dict(_full, ahead=[{"worker": "w", "repo": "1.0.1", "live": "1.0.0", "artifact": "w/worker.js"}]))
check("main --apply with a worker ahead sweeps again before it deploys", _run_main(["--apply"])[1] == 1)

print("\n%d failure(s)" % len(fails))
sys.exit(1 if fails else 0)
