#!/usr/bin/env python3
"""CI-ACTION-IDENTITY-1 offline suite for scripts/ci_watchdog.py and scripts/ci_watchdog_resolve.py (no network).

Proves, for the workflows that run a different action per manual dispatch (cf-ops-actions, owner-client-keys,
fleet-autodeploy; ci-watchdog #1033):
  * a dispatched run whose run-name names the action is keyed per action; push and plain runs keep the workflow name
  * only a later green run of the SAME action supersedes or closes a failed one
  * the action's own RESULT_JSON line becomes the finding's fix line, not "inspect the job log"
  * the three workflows declare a run-name that names the action
Run: python3 scripts/ci_watchdog_action_test.py   -> "N passed, 0 failed"
"""
import importlib.util, os, pathlib, sys
HERE = pathlib.Path(__file__).resolve().parent
def load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
os.environ.setdefault("DRY_RUN", "1")
W = load("ciw", "ci_watchdog.py"); R = load("ciwr", "ci_watchdog_resolve.py")
passed = failed = 0
def ok(c, m):
    global passed, failed
    if c: passed += 1
    else: failed += 1; print("FAIL " + m)

def run(i, title, concl, t, event="workflow_dispatch", name="cf-ops-actions", wf=7):
    return {"id": i, "name": name, "display_title": title, "conclusion": concl, "created_at": t, "event": event, "head_branch": "main", "workflow_id": wf}

fail = run(1, "cf-ops-actions gen-activitypub-key qnfo-gateway", "failure", "2026-10-12T13:53:25Z")
ok(W.action_key(fail) == "cf-ops-actions gen-activitypub-key qnfo-gateway", "a dispatched run is keyed by its action title")
ok(W.action_key(run(2, "cf-ops-actions", "failure", "t")) is None, "a run titled with the bare workflow name keeps the workflow subject")
ok(W.action_key(run(3, "fleet-autodeploy mode", "failure", "t", event="push", name="fleet-autodeploy")) is None, "a push run is never per-action")
ok(W.action_key(run(4, "cf-ops-actions  report   ", "failure", "t")) == "cf-ops-actions report", "whitespace is normalised (an empty target)")

other_green = run(5, "cf-ops-actions report", "success", "2026-10-12T14:00:00Z")
same_green = run(6, "cf-ops-actions gen-activitypub-key qnfo-gateway", "success", "2026-10-12T14:30:00Z")
ok(W.superseded_by_green(fail, [other_green, fail]) is None, "a green run of another action does not supersede the failure")
ok((W.superseded_by_green(fail, [same_green, other_green, fail]) or {}).get("id") == 6, "a green re-run of the same action supersedes it")
plain_fail = run(7, "WORKERS-BP fix (#1022)", "failure", "2026-10-12T12:02:05Z", event="push", name="apply-migrations", wf=9)
plain_green = run(8, "another commit", "success", "2026-10-12T14:06:22Z", event="push", name="apply-migrations", wf=9)
ok((W.superseded_by_green(plain_fail, [plain_green, plain_fail]) or {}).get("id") == 8, "plain workflows keep the any-later-green rule")

log = ("2026-10-12T13:53:20Z some line\n2026-10-12T13:53:21Z RESULT_JSON=" +
       '{"action": "gen-activitypub-key", "next_step": "deploy qnfo-gateway with the actor routes", "ok": false, "put_http": [201, 201], "rotated": false, "verified_present": ["AP_PRIVATE_KEY", "AP_PUBLIC_KEY"], "worker": "qnfo-gateway"}\n')
res = W.result_json(log)
ok(res and res["action"] == "gen-activitypub-key" and res["ok"] is False, "the RESULT_JSON line is read from a timestamped job log")
h = W.result_hint(res)
ok("deploy qnfo-gateway with the actor routes" in h and "[201, 201]" in h and "same run title" in h, "the finding names the next step and the HTTP codes the action saw: " + h)
ok(W.result_json("no result here\n") is None and W.result_json("RESULT_JSON={not json}\n") is None, "no or broken RESULT_JSON is ignored")
ok(W.classify(log, "cf-ops-actions")[0] == "unknown", "the result line does not change the text classes (the loop adds action-result)")

wfs = [{"id": 7, "name": "cf-ops-actions", "path": ".github/workflows/cf-ops-actions.yml", "state": "active"},
       {"id": 9, "name": "apply-migrations", "path": ".github/workflows/apply-migrations.yml", "state": "active"}]
ok(R.split_action("cf-ops-actions gen-activitypub-key qnfo-gateway", wfs) == ("cf-ops-actions", "cf-ops-actions gen-activitypub-key qnfo-gateway"), "the resolver splits a per-action subject")
ok(R.split_action("apply-migrations", wfs) == ("apply-migrations", None), "a plain subject stays plain")
ok(R.split_action("not-a-workflow with spaces", wfs) == ("not-a-workflow with spaces", None), "an unknown head is not split")
calls = []
def fake_gh(path, method="GET", body=None):
    calls.append(path)
    if "/workflows/7/runs" in path: return 200, {"workflow_runs": [other_green]}
    return 404, None
R.gh = fake_gh
ok(R.latest_green("cf-ops-actions gen-activitypub-key qnfo-gateway", "2026-10-12T13:53:25Z", wfs) is None, "the resolver keeps the finding open when only another action went green")
def fake_gh2(path, method="GET", body=None):
    if "/workflows/7/runs" in path: return 200, {"workflow_runs": [other_green, same_green]}
    return 404, None
R.gh = fake_gh2
ok((R.latest_green("cf-ops-actions gen-activitypub-key qnfo-gateway", "2026-10-12T13:53:25Z", wfs) or {}).get("id") == 6, "and closes it on the same action's green run")
same_red_later = run(51, "cf-ops-actions gen-activitypub-key qnfo-gateway", "failure", "2026-10-12T15:00:00Z")
def fake_gh2b(path, method="GET", body=None):
    if "/workflows/7/runs" in path: return 200, {"workflow_runs": [same_red_later, other_green, same_green]}
    return 404, None
R.gh = fake_gh2b
ok(R.latest_green("cf-ops-actions gen-activitypub-key qnfo-gateway", "2026-10-12T13:53:25Z", wfs) is None, "a later red run of the same action keeps it open even though an earlier re-run went green")

# RESOLVE-REF-1: the green run that clears a finding must be on the failing run's own ref (ci-watchdog #5281: a PR branch's green closed a finding about a red main)
import contextlib, io
FAIL_T = "2026-10-30T05:00:00Z"
wfs2 = wfs + [{"id": 12, "name": "deploy-gate", "path": ".github/workflows/deploy-gate.yml", "state": "active"}]
def rrun(i, concl, t, event="push", branch="main", name="deploy-gate", wf=12):
    return {"id": i, "name": name, "display_title": "a commit", "conclusion": concl, "created_at": t, "event": event, "head_branch": branch, "workflow_id": wf, "html_url": "https://example.test/" + str(i), "head_sha": "0123456789abcdef"}
seen = []
def runs_gh(runs):
    def f(path, method="GET", body=None):
        seen.append(path)
        if "/workflows/12/runs" in path or path.startswith("/repos/" + R.REPO + "/actions/runs?"): return 200, {"workflow_runs": runs}
        return 404, None
    return f
pr_green = rrun(10, "success", "2026-10-30T05:12:00Z", event="pull_request", branch="codeagent-im1000861")
main_green = rrun(11, "success", "2026-10-30T09:07:00Z")
R.gh = runs_gh([main_green, pr_green])
ok((R.latest_green("deploy-gate", FAIL_T, wfs2) or {}).get("id") == 11, "main's own green push run clears a failure of main")
ok("branch=main" in seen[-1] and "exclude_pull_requests=true" in seen[-1] and "per_page=100" in seen[-1] and "/workflows/12/runs?" in seen[-1], "the query asks for main, pull requests excluded, 100 runs, in one call: " + seen[-1])
R.gh = runs_gh([pr_green])
ok(R.latest_green("deploy-gate", FAIL_T, wfs2) is None, "a green pull-request run on another branch does not clear a failure of main")
R.gh = runs_gh([rrun(12, "success", "2026-10-30T06:00:00Z", event="pull_request", branch="main")])
ok(R.latest_green("deploy-gate", FAIL_T, wfs2) is None, "a pull-request run is not evidence even when its head branch is called main (a fork)")
R.gh = runs_gh([rrun(13, "success", "2026-10-30T06:00:00Z", event="push", branch="release/1")])
ok(R.latest_green("deploy-gate", FAIL_T, wfs2) is None, "a green push on another branch does not clear a failure of main")
R.gh = runs_gh([rrun(22, "success", "2026-10-30T08:00:00Z"), rrun(21, "failure", "2026-10-30T07:00:00Z")])
ok((R.latest_green("deploy-gate", FAIL_T, wfs2) or {}).get("id") == 22, "green after a later red: the newest verdict is green")
R.gh = runs_gh([rrun(21, "failure", "2026-10-30T07:00:00Z"), rrun(20, "success", "2026-10-30T06:00:00Z")])
ok(R.latest_green("deploy-gate", FAIL_T, wfs2) is None, "red after the green: main is red again, so the finding stays open")
for bad in ("timed_out", "startup_failure"):
    R.gh = runs_gh([rrun(23, bad, "2026-10-30T07:00:00Z"), rrun(20, "success", "2026-10-30T06:00:00Z")])
    ok(R.latest_green("deploy-gate", FAIL_T, wfs2) is None, bad + " counts as red")
R.gh = runs_gh([rrun(30, "cancelled", "2026-10-30T09:00:00Z"), rrun(31, "skipped", "2026-10-30T08:30:00Z"), rrun(32, None, "2026-10-30T08:10:00Z"),
                rrun(33, "action_required", "2026-10-30T08:00:00Z"), rrun(34, "neutral", "2026-10-30T07:30:00Z"), rrun(35, "success", "2026-10-30T07:00:00Z")])
ok((R.latest_green("deploy-gate", FAIL_T, wfs2) or {}).get("id") == 35, "cancelled, skipped, unfinished, action_required and neutral runs are no verdict")
R.gh = runs_gh([rrun(30, "cancelled", "2026-10-30T09:00:00Z"), rrun(32, None, "2026-10-30T08:10:00Z")])
ok(R.latest_green("deploy-gate", FAIL_T, wfs2) is None, "and without any decided run there is nothing to close on")
R.gh = runs_gh([rrun(40, "success", FAIL_T), rrun(41, "success", "2026-10-30T04:00:00Z")])
ok(R.latest_green("deploy-gate", FAIL_T, wfs2) is None, "a green run that is not strictly newer than the failure is no evidence")
R.gh = runs_gh([rrun(42, "success", "2026-10-30T06:00:00Z")])
ok((R.latest_green("deploy-gate", None, wfs2) or {}).get("id") == 42 and (R.latest_green("deploy-gate", "", wfs2) or {}).get("id") == 42, "no failure time: the newest decided run decides (main() never calls it that way, FAIL-CLOSED-NO-BASELINE-1)")
# a finding about a pull-request run (filed before MAIN-ONLY-FINDINGS-1) is cleared by a later green run of the same branch only
pr_fix = rrun(50, "success", "2026-10-30T06:00:00Z", event="pull_request", branch="feature/x")
R.gh = runs_gh([pr_fix, rrun(51, "success", "2026-10-30T07:00:00Z", event="pull_request", branch="feature/y")])
ok((R.latest_green("deploy-gate", FAIL_T, wfs2, "feature/x", True) or {}).get("id") == 50, "a failing pull-request run is cleared by a green run of its own branch")
ok("branch=feature%2Fx" in seen[-1] and "exclude_pull_requests" not in seen[-1], "the branch is url-encoded and pull-request runs are not excluded for it: " + seen[-1])
R.gh = runs_gh([rrun(51, "success", "2026-10-30T07:00:00Z", event="pull_request", branch="feature/y"), rrun(52, "success", "2026-10-30T07:30:00Z", event="push", branch="main")])
ok(R.latest_green("deploy-gate", FAIL_T, wfs2, "feature/x", True) is None, "and not by another branch or by main")
# a subject that names no listed workflow falls back to the repository run list, with the same filters
R.gh = runs_gh([rrun(60, "success", "2026-10-30T06:00:00Z", name="orphan-wf", wf=99), rrun(61, "success", "2026-10-30T06:10:00Z", event="pull_request", branch="x", name="orphan-wf", wf=99)])
ok((R.latest_green("orphan-wf", FAIL_T, wfs2) or {}).get("id") == 60 and seen[-1].startswith("/repos/" + R.REPO + "/actions/runs?branch=main&exclude_pull_requests=true"), "an unlisted workflow name: the run list is read with the same branch and pull-request filters: " + seen[-1])

def resolve_pass(failing, runs, issue_title="[ci-watchdog] suite-red: deploy-gate"):
    """One main() pass over a single open finding whose body cites `failing`; returns (stdout, closed-by-write calls)."""
    writes = []
    def f(path, method="GET", body=None):
        if method != "GET": writes.append((method, path)); return 200, {}
        if path == "/rate_limit": return 200, {"resources": {"core": {"remaining": 4000, "limit": 5000, "reset": 0}}}
        if path.startswith("/repos/" + R.REPO + "/issues?state=open"): return 200, [{"number": 5281, "title": issue_title, "body": "evidence\nrun=%d\n" % failing["id"]}]
        if path.startswith("/repos/" + R.REPO + "/actions/workflows?per_page=100"): return 200, {"workflows": wfs2}
        if path == "/repos/%s/actions/runs/%d" % (R.REPO, failing["id"]): return 200, failing
        if path == "/repos/%s/actions/workflows/12" % R.REPO: return 200, dict(wfs2[-1])
        if "/workflows/12/runs" in path: return 200, {"workflow_runs": runs}
        return 404, None
    R.gh = f; R.DRY = True
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        R.main()
    return buf.getvalue(), writes
red_main = rrun(700, "failure", FAIL_T)
out, _ = resolve_pass(red_main, [pr_green])
ok("closed=0 kept=1" in out and "NO green run" in out and "branch=main" in out, "main(): a green PR run does not close the finding about a red main: " + out.strip().splitlines()[-1])
out, _ = resolve_pass(red_main, [main_green, pr_green])
ok("closed=1 kept=0" in out and "WOULD CLOSE (green 11 " in out, "main(): main's own green push run closes it: " + out.strip().splitlines()[-1])
out, _ = resolve_pass(red_main, [rrun(21, "failure", "2026-10-30T10:00:00Z"), main_green])
ok("closed=0 kept=1" in out, "main(): a red main run newer than the green keeps it open")
red_pr = rrun(701, "failure", FAIL_T, event="pull_request", branch="feature/x")
out, _ = resolve_pass(red_pr, [pr_fix])
ok("closed=1 kept=0" in out and "WOULD CLOSE (green 50 " in out, "main(): a finding about a pull-request run is closed by its own branch's green run (the query carries the failing run's branch and event)")
out, _ = resolve_pass(red_pr, [main_green])
ok("closed=0 kept=1" in out, "main(): and not by a green main run")

root = HERE.parent / ".github" / "workflows"
for f, needle in [("cf-ops-actions.yml", "run-name: cf-ops-actions ${{ inputs.action }}"), ("owner-client-keys.yml", "run-name: owner-client-keys ${{ inputs.mode }}"),
                  ("fleet-autodeploy.yml", "format('fleet-autodeploy {0}', inputs.mode)")]:
    ok(needle in (root / f).read_text(), f + " names the action in its run title")
# CI-WATCHDOG-LEDGER-1: the watchdog made 270 POSTs a day to ops.qnfo.org/v1/desires, a route qnfo-ops does not have (404, answer discarded).
import urllib.request
calls = []
_real = urllib.request.urlopen
urllib.request.urlopen = lambda *a, **k: calls.append(a) or (_ for _ in ()).throw(AssertionError("network call"))
os.environ["OPS_ROUTER_AUTH_KEY"] = "test-key-not-real"
W.DRY = False
res = W.post_ledger({"x": 1})
urllib.request.urlopen = _real
ok(not calls and res.startswith("skipped (no ledger ingress"), "post_ledger makes no network call and says where the summary lives")
ok("Request(\"https://ops.qnfo.org/v1/desires\"" not in (HERE / "ci_watchdog.py").read_text(), "ci_watchdog.py no longer builds a request for the dead /v1/desires route")
print("%d passed, %d failed" % (passed, failed)); sys.exit(1 if failed else 0)
