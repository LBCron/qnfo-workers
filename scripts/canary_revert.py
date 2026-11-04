#!/usr/bin/env python3
"""CONTROL-PLANE-CANARY-1 (2026-10-06, pillar autonomy; CONTROL-PLANE-SELF-MERGE-1, owner directive 2026-10-06).

WHAT   After canonical-deploy.yml (or deploy-code-orchestrator.yml for the container worker the canonical path skips,
       CONTROL-PLANE-CANARY-2) has deployed the workers changed by a push to main, this script polls the /health route
       of every CONTROL-PLANE worker in that set until it reports the VERSION the push carries. A worker whose version does
       not arrive inside the window is treated as a bad deploy: the push is reverted on main (git revert of the pushed
       commit, with each failed worker's VERSION bumped above the bad one so version-bump-guard and the deploy ledger stay
       monotonic, and its mirror kept identical), the revert is pushed, its deploy is dispatched (REVERT-REDEPLOY-1: a push
       made with GITHUB_TOKEN starts no workflow run, so canonical-deploy.yml is run by `gh workflow run` for the failed
       workers, and deploy-qnfo-ops.yml, the break-glass path that needs no /ops/deploy, when qnfo-ops is one of them), and
       one agent_issues row CONTROL-PLANE-REVERTED-1 records what was seen. A revert is never reverted (one level), so a
       broken /health route cannot ping-pong main; the dispatched redeploy runs the canary with --no-revert, which files
       CONTROL-PLANE-CANARY-FAILED-1 when the revert does not arrive either. A merge commit (the lane's merge method) is
       reverted with -m 1; any git failure becomes an error outcome and the issue is still filed.
       The canary proves that the pushed VERSION arrived, not that the worker works: a change that keeps /health up but
       breaks a cron step or the merge lane is for LOOP-WATCH-1 and the metric triggers, the next line of defence.
       CANARY-AHEAD-1 (2026-10-26, agent_issues 1000171): the deploy installs main's tip, so two pushes close together leave /health
       answering the LATER push's VERSION while this canary still waits for the earlier one (push 7a9d293 wanted 3.31.2, a commit
       15 s later deployed 3.31.3, and the canary reverted the 3.31.2 fix after 25 polls of a healthy worker). A live VERSION whose
       numeric X.Y.Z core is strictly above the pushed one therefore means a later push deployed, which version-bump-guard
       (VERSION-AHEAD-1) makes the only way a core above the pushed one can be live: it is logged and not a failure, and that later
       push's own canary (VERSION and functional step) owns the verdict. An equal core with another suffix, a lower core and an
       unreadable version still fail exactly as before. Each run that meets an ahead worker writes one cloud_ops_events row of kind
       canary-ahead (record_ahead), so a revert that was not made is a durable record and not only a log line.
WHY    CONTROL-PLANE-MANUAL-1 (2026-10-02, human_actions 21) kept qnfo-fleet-control from merging any pull request that
       changes a control-plane worker, because nothing could undo a bad control-plane deploy: the fleet's own revert lives
       in qnfo-fleet-control, which is one of the workers at risk. This canary runs on the GitHub runner with the
       repository token, independent of every worker, so the merge lane may merge control-plane session PRs on its own.
       CONTROL-PLANE-FUNCTIONAL-CANARY-1 (2026-10-12, agent_issues 2176) adds the functional step: a worker whose VERSION
       arrived is then asked for one read-only route that only a working worker can answer (FUNCTIONAL below: a D1-backed
       ledger, the public site page, the model list and spend ledger), with no secret and no model call. A route that
       misses its status or marker on every one of --functional-tries attempts is a bad deploy and is reverted exactly as a
       VERSION that never arrived; one cloud_ops_events row (kind canary-functional) records each run. CANARY_FUNCTIONAL=
       observe files the finding without reverting, off skips the step. The step proves a read path, not every route:
       inference on qnfo-ai needs the router key, which the canary does not hold, so LOOP-WATCH-1 stays the next line.
       DEPLOY-PROBES-1 (2026-11-04) generalises the functional step: every worker in the push that declares `<worker>/probes.json` (scripts/
       deploy_probes.py) gets its HTTP routes and D1 `EXPLAIN QUERY PLAN` statements checked after the deploy, not only the seven control-plane
       workers, and the seven now declare theirs in the same file instead of in this script. A probe that passed before the deploy (the
       baseline step of canonical-deploy.yml) and fails after it is a regression and reverts the push exactly like a missing VERSION; a probe
       that already failed before, a probe of a worker created by this push, an inconclusive answer (D1 overloaded, the runner offline) and a
       worker a later push has since changed are filed or logged and never reverted. A revert redeploys every worker it changed, not only the
       failed one.
USAGE  python3 scripts/canary_revert.py --targets /tmp/targets.txt --pushed <sha> [--canary-min 8] [--poll-sec 20] [--dry-run]
       python3 scripts/canary_revert.py --selftest
       --targets is the canonical-deploy target file ("<worker> <path> [create]" per line). Reads CLOUDFLARE_API_TOKEN and
       CLOUDFLARE_ACCOUNT_ID to file the issue (skipped, with a warning, when absent). Exit 0 always; a revert prints a
       ::warning:: so the run stays readable and ci-watchdog does not file a second issue for it.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import deploy_probes as DP  # noqa: E402  DEPLOY-PROBES-1: declarations, probe evaluation, classification

# Control-plane workers with a versioned /health route (read 2026-10-06: every one answered 200 with {"version": ...}).
# Mirrors CP_CANARY_WORKERS in qnfo-fleet-control (bhControlPlaneDecide); fold-guard parity is the test's job.
CANARY_WORKERS = ["qnfo-fleet-control", "qnfo-ops", "qnfo-deploy-guard", "qnfo-gateway", "qnfo-ai", "qnfo-observability", "qnfo-code-orchestrator"]
HEALTH_URL = "https://{worker}.q08.workers.dev/health"
# CANARY-VERSION-REGEX-1 (2026-10-19): a worker whose first line is `var VERSION="..";;` (qnfo-gateway, qnfo-email, qnfo-calendar-intake)
# has no spaces around '=' and a doubled ';'. The strict pattern missed it, so qnfo-gateway had no canary and no revert protection.
# Whitespace around '=' is optional; the value stays a quoted literal, and a `var VERSION = OTHER_CONST;` line (no quote) still
# does not count. Same parse as version-bump-guard.py and canonical_deploy.py (the test pins that).
VERSION_RE = re.compile(r'^var\s+VERSION\s*=\s*"([^"\n]*)"', re.M)
VERSION_LINE_RE = re.compile(r'^(var\s+VERSION\s*=\s*")[^"\n]*(")', re.M)
DB_ID = "35e2e573-92f3-46ac-83c6-22f6429fc5e5"

# CONTROL-PLANE-FUNCTIONAL-CANARY-1 (2026-10-12) kept a table here of the read-only routes that prove each control-plane worker works beyond
# /health. DEPLOY-PROBES-1 moved those checks into `<worker>/probes.json` next to each worker (scripts/deploy_probes.py), so a worker outside
# the control plane declares its own the same way. HEALTH_URLS holds the VERSION-poll URL of a worker that declares `health`; a control-plane
# worker uses HEALTH_URL.
HEALTH_URLS = {}


def emit(msg):
    print(msg, flush=True)


def parse_targets(text):
    """'<worker> <path> [create]' per line -> [(worker, path)]; blank and comment lines ignored."""
    out = []
    for line in str(text or "").splitlines():
        parts = line.split()
        if len(parts) < 2 or parts[0].startswith("#"):
            continue
        out.append((parts[0], parts[1]))
    return out


def read_version(text):
    m = VERSION_RE.search(str(text or ""))
    return m.group(1) if m else None


VERSION_CORE_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)")
# CANARY-AHEAD-1: the states in which a worker needs no further polling and is not a failed deploy. "ahead" = a later push's
# VERSION is live; that push's own canary owns the verdict, so neither the revert nor the functional step is this run's.
CANARY_SATISFIED = ("ok", "ahead")


def version_core(version):
    """'3.31.2-seo-index-8' -> (3, 31, 2); None when the text has no numeric X.Y.Z core."""
    m = VERSION_CORE_RE.match(str(version or "").strip())
    return tuple(int(x) for x in m.groups()) if m else None


def judge(health, want):
    """One /health answer against the wanted VERSION -> (state, seen).
    state: ok | ahead | wrong-version | no-version. CANARY-AHEAD-1: "ahead" when the live numeric core is strictly above the
    wanted one (a later push deployed); an equal core with another suffix, a lower core or an unreadable version is wrong-version."""
    if not isinstance(health, dict):
        return "no-version", None
    seen = health.get("version") or health.get("VERSION") or health.get("v")
    if not seen:
        return "no-version", None
    if str(seen) == str(want):
        return "ok", str(seen)
    live, pushed = version_core(seen), version_core(want)
    if live and pushed and live > pushed:
        return "ahead", str(seen)
    return "wrong-version", str(seen)


def is_revert_commit(message):
    lines = str(message or "").strip().lower().splitlines()
    first = lines[0] if lines else ""
    return first.startswith("revert") or "control-plane-canary-1" in first


def bump_for_revert(base_content, bad_version, tag):
    """The base (pre-push) worker text with its VERSION set above the bad one: numeric core of the bad version, patch + 1, plus tag.
    Returns (new_version, new_content) or None when either text has no single VERSION line."""
    lines = VERSION_LINE_RE.findall(str(base_content or ""))
    if len(lines) != 1:
        return None
    m = re.match(r"^(\d+)\.(\d+)\.(\d+)", str(bad_version or ""))
    if not m:
        return None
    new_version = "%s.%s.%d%s" % (m.group(1), m.group(2), int(m.group(3)) + 1, tag)
    # Only the value is replaced: the base line's own spacing and trailing ';' or ';;' stay as they were.
    new_content = VERSION_LINE_RE.sub(lambda mm: mm.group(1) + new_version + mm.group(2), str(base_content), count=1)
    return new_version, new_content


def fetch_health(worker, timeout=10):
    req = urllib.request.Request(HEALTH_URLS.get(worker) or HEALTH_URL.format(worker=worker), headers={"User-Agent": "qnfo-canary/1.0 (+canonical-deploy)"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except (urllib.error.URLError, ValueError, OSError):
        return None


def poll(wanted, minutes, poll_sec, fetch=fetch_health, clock=time.monotonic, sleep=time.sleep):
    """wanted: {worker: version}. Polls every worker until all report their version or the window ends.
    Returns {worker: {"want", "state", "seen", "polls"}}."""
    out = {w: {"want": v, "state": "pending", "seen": None, "polls": 0} for w, v in wanted.items()}
    deadline = clock() + max(1, minutes) * 60
    while True:
        pending = [w for w in out if out[w]["state"] not in CANARY_SATISFIED]
        for w in pending:
            st, seen = judge(fetch(w), out[w]["want"])
            out[w]["polls"] += 1
            out[w]["seen"] = seen
            out[w]["state"] = st
        if all(out[w]["state"] in CANARY_SATISFIED for w in out) or clock() >= deadline:
            break
        sleep(poll_sec)
    for w in out:
        if out[w]["state"] not in CANARY_SATISFIED:
            out[w]["state"] = "failed:" + out[w]["state"]
    return out


def git_show(ref, path):
    """The text of `path` at `ref`, or None when it does not exist there."""
    r = subprocess.run(["git", "show", ref + ":" + path], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def load_declarations(targets, ref, reader=None):
    """DEPLOY-PROBES-1: {worker: {"decl": dict|None, "dir", "bindings", "errors"}} for every target worker that has a probes.json at `ref`."""
    reader = reader or git_show
    out = {}
    for w, p in targets:
        d = p.split("/")[0]
        text = reader(ref, d + "/probes.json")
        if text is None:
            continue
        wr = reader(ref, d + "/wrangler.toml") or ""
        decl, errs = DP.load_declaration(text, wr)
        out[w] = {"decl": decl, "dir": d, "bindings": DP.d1_bindings(wr), "errors": errs}
    return out


def declared_keys(ref, d, reader=None):
    """The probe keys the declaration of directory `d` already carried at `ref` (None when unknown: no such file or not parseable)."""
    reader = reader or git_show
    text = reader(ref, d + "/probes.json")
    if text is None:
        return set() if reader(ref, d + "/worker.js") is not None else None
    try:
        return {k for k, _, _ in DP.probe_list(json.loads(text))}
    except (ValueError, AttributeError):
        return None


def functional(workers, decls, baseline=None, base_keys=None, tries=4, wait_sec=15, ctx_for=None, sleep=time.sleep, budget_sec=None):
    """workers: the ones whose VERSION arrived (or that are not VERSION-polled). decls: load_declarations(). Every probe of a worker is run
    with up to `tries` attempts inside `budget_sec`. Returns {worker: {"state": ok|failed|inconclusive|none, "detail", "tries", "regressions": [probe],
    "pre_existing": [probe], "new_bad": [probe], "result": evaluate()}}; failed = at least one regression, pre-existing failure or mistyped new
    probe, "none" = no probe declared. An exception in one worker's probes makes that worker inconclusive and nothing else."""
    out = {}
    for w in workers:
        x = decls.get(w)
        if not x or not x.get("decl") or not DP.probe_list(x["decl"]):
            out[w] = {"state": "none", "detail": "no probes declared", "tries": 0, "regressions": [], "pre_existing": [], "new_bad": [], "result": None}
            continue
        try:
            res = DP.evaluate(x["decl"], ctx_for(x) if ctx_for else DP.live_ctx(x["bindings"], None, None), tries=tries, wait_sec=wait_sec, sleep=sleep, budget_sec=budget_sec)
            reg, pre, nb = DP.classify(res, (baseline or {}).get(w) if baseline is not None else None, (base_keys or {}).get(w) if base_keys is not None else None)
        except Exception as e:  # noqa: BLE001
            out[w] = {"state": "inconclusive", "detail": "probe run raised " + DP.clean(type(e).__name__ + " " + str(e), 160), "tries": 0, "regressions": [], "pre_existing": [], "new_bad": [], "result": None}
            continue
        state = "failed" if (reg or pre or nb) else res["state"]
        out[w] = {"state": state, "detail": DP.summary(res), "tries": max([p["tries"] for p in res["probes"]] or [0]), "regressions": reg, "pre_existing": pre, "new_bad": nb, "result": res}
    return out


def record_functional(acct, token, pushed, fn, mode):
    """One cloud_ops_events row per canary run that had a functional step (the closing probe of agent_issues 2176 reads it)."""
    checked = {w: r for w, r in fn.items() if r["state"] != "none"}
    if not checked or not (acct and token):
        return None
    try:
        from apply_migrations import d1
        bad = sorted(w for w, r in checked.items() if r["state"] == "failed")
        text = ("DEPLOY-PROBES-1 push %s (%s): " % (str(pushed)[:7], mode)) + "; ".join(
            "%s %s after %d tr%s%s" % (w, r["state"], r["tries"], "y" if r["tries"] == 1 else "ies", "" if r["state"] == "ok" else " (" + r["detail"][:160] + ")") for w, r in sorted(checked.items()))
        d1(acct, token, DB_ID, "INSERT OR REPLACE INTO cloud_ops_events (id, ts, kind, status, text, job, meta) VALUES (?1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'canary-functional', ?2, ?3, 'canonical-deploy', ?4)",
           ["canary-functional-" + str(pushed)[:12] + "-" + "-".join(sorted(checked))[:80], "fail" if bad else "ok", text[:900],
            json.dumps({"pushed": str(pushed), "workers": sorted(checked), "failed": bad, "mode": mode,
                        "probes": {w: [(p["key"], p["state"]) for p in (r["result"] or {}).get("probes", [])] for w, r in sorted(checked.items())}})[:3000]])
        return "fail" if bad else "ok"
    except Exception as e:  # noqa: BLE001
        emit("::warning::canary: functional result not recorded: " + str(e)[:200])
        return None


def record_ahead(acct, token, pushed, results):
    """CANARY-AHEAD-1: one cloud_ops_events row (kind canary-ahead) per canary run that met a worker answering with a VERSION ahead of
    the pushed one, so a revert the canary no longer makes is a durable record and not only a log line. Best effort, like
    record_functional: returns "ok", or None when there is nothing to record, no credential, or the write failed."""
    ahead = {w: r for w, r in results.items() if r["state"] == "ahead"}
    if not ahead or not (acct and token):
        return None
    try:
        from apply_migrations import d1
        text = ("CANARY-AHEAD-1 push %s: " % str(pushed)[:7]) + "; ".join(
            "%s wanted %s, live %s is ahead after %d poll%s" % (w, r["want"], r["seen"], r["polls"], "" if r["polls"] == 1 else "s") for w, r in sorted(ahead.items()))
        d1(acct, token, DB_ID, "INSERT OR REPLACE INTO cloud_ops_events (id, ts, kind, status, text, job, meta) VALUES (?1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'canary-ahead', 'ok', ?2, 'canonical-deploy', ?3)",
           ["canary-ahead-" + str(pushed)[:12] + "-" + "-".join(sorted(ahead))[:80], text[:900],
            json.dumps({"pushed": str(pushed), "workers": sorted(ahead), "want": {w: r["want"] for w, r in ahead.items()}, "seen": {w: r["seen"] for w, r in ahead.items()}})])
        return "ok"
    except Exception as e:  # noqa: BLE001
        emit("::warning::canary: ahead result not recorded: " + str(e)[:200])
        return None


def git(args, check=True):
    return subprocess.run(["git"] + list(args), check=check, capture_output=True, text=True).stdout


def revert_flags(parents_line):
    """'<sha> <parent> [<parent>]' from `git rev-list --parents -n1` -> the extra git-revert flags: a merge commit (two
    parents, every session PR the lane merges with the merge method) needs -m 1 to revert against main's side."""
    parts = str(parents_line or "").split()
    return ["-m", "1"] if len(parts) >= 3 else []


# CONTROL-PLANE-CANARY-2: workers the canonical path skips (container workers, CANONICAL-SKIP-CONTAINERS-1) deploy through a
# wrangler workflow of their own, which also runs this canary; the revert of such a worker is redeployed by that workflow.
REDEPLOY_WORKFLOW = {"qnfo-code-orchestrator": "deploy-code-orchestrator.yml"}


def redeploy_commands(workers, repo):
    """The gh dispatches that redeploy a revert: canonical-deploy.yml with `workers=` for every worker the canonical path
    deploys, each REDEPLOY_WORKFLOW workflow once for the workers it owns, and the break-glass deploy-qnfo-ops.yml when
    qnfo-ops failed (raw_put.py deploys qnfo-ops from main without /ops/deploy when /health is down, and skips itself when
    the canonical route is healthy)."""
    canonical = [w for w in workers if w not in REDEPLOY_WORKFLOW]
    own = []
    for w in workers:
        wf = REDEPLOY_WORKFLOW.get(w)
        if wf and wf not in own:
            own.append(wf)
    runs = []
    if canonical:
        runs.append(["gh", "workflow", "run", "canonical-deploy.yml", "--repo", repo, "--ref", "main", "-f", "workers=" + " ".join(canonical)])
    for wf in own:
        runs.append(["gh", "workflow", "run", wf, "--repo", repo, "--ref", "main"])
    if "qnfo-ops" in workers:
        runs.append(["gh", "workflow", "run", "deploy-qnfo-ops.yml", "--repo", repo, "--ref", "main"])
    return runs


def dispatch_redeploy(workers):
    """REVERT-REDEPLOY-1: a push made with GITHUB_TOKEN starts no workflow run (GitHub suppresses them; see
    apply-binding-install-gate-1.yml), so the revert commit would sit on main undeployed. Dispatch the deploy workflows that
    own the failed workers (redeploy_commands; a dispatched run queues behind this one, cancel-in-progress is false).
    Returns {"redeploy": [...], "redeploy_error": ...}."""
    repo = os.environ.get("GITHUB_REPOSITORY") or "QNFO/qnfo-workers"
    runs = redeploy_commands(workers, repo)
    out, errors = [], []
    for cmd in runs:
        try:
            subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=60)
            out.append(cmd[3])
        except (subprocess.CalledProcessError, OSError, subprocess.TimeoutExpired) as e:
            err = getattr(e, "stderr", None) or getattr(e, "stdout", None) or str(e)
            errors.append(cmd[3] + ": " + str(err).strip()[:200])
    res = {"redeploy": out}
    if errors:
        res["redeploy_error"] = "; ".join(errors)
    return res


def existing_revert(subjects, pushed):
    """The subject of a revert of `pushed` already on main (a push that changed both a canonical control-plane worker and the
    container worker runs two canaries; the second must not revert the same commit again), else None."""
    tag = "revert: " + str(pushed or "")[:7]
    for s in subjects or []:
        if str(s or "").strip().lower().startswith(tag.lower()):
            return str(s).strip()
    return None


def revert_line(bumped, reason):
    """One line of the revert commit body for (worker, bad_version, new_version); reason is the functional failure, if that is why."""
    if reason:
        return "%s: pushed VERSION %s answered on /health but failed its functional step (%s); reverted to the previous content as %s." % (bumped[0], bumped[1], str(reason)[:200], bumped[2])
    return "%s: pushed VERSION %s never answered on /health within the canary window; reverted to the previous content as %s." % tuple(bumped)


# A repository ruleset (require-build, 2026-11-04 15:47Z) refuses a direct push to main from the Actions token (GH013): the first live drill of DEPLOY-PROBES-1 detected a
# bad deploy and could not push its own revert, so the bad worker stayed live until a person made the revert by hand. The revert then travels as a pull request that the
# lane merges like any other (the push to main that merge makes deploys the reverted code); a direct push is still tried first, so a repository without the rule is unchanged.
RULE_REFUSAL = re.compile(r"GH013|Repository rule violations|protected branch|Required status check", re.I)


def create_pr(branch, title, body):
    """-> (ok, pull request url or the error). Created with the fleet user credential when QNFO_GH_PAT is set, because a pull request opened with GITHUB_TOKEN starts
    none of the workflows the lane waits for."""
    env = dict(os.environ)
    has_pat = bool(os.environ.get("QNFO_GH_PAT"))
    if has_pat:
        env["GH_TOKEN"] = os.environ["QNFO_GH_PAT"]
    repo = os.environ.get("GITHUB_REPOSITORY") or "QNFO/qnfo-workers"
    no_pat = "" if has_pat else " (opened with GITHUB_TOKEN because QNFO_GH_PAT is not set: no workflow runs on it, so the lane cannot merge it, merge it by hand)"  # found by the gate's own review of #7215
    try:
        r = subprocess.run(["gh", "pr", "create", "--repo", repo, "--base", "main", "--head", branch, "--title", title, "--body", body],
                           env=env, capture_output=True, text=True, timeout=90)
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, type(e).__name__ + " " + str(e)[:160]
    out = (r.stdout or "").strip().splitlines()
    if r.returncode == 0 and out:
        return True, out[-1] + no_pat
    err = (r.stderr or r.stdout or "").strip()
    m = re.search(r"https://github\.com/\S+/pull/\d+", err)
    if m and "already exists" in err:
        return True, m.group(0) + no_pat
    return False, err[:200]


def revert_via_pr(sha, title, body, bumped, refusal):
    """The revert commit (HEAD of the canary-revert checkout) pushed as a branch and opened as a pull request. -> outcome dict."""
    branch = "canary-revert-" + str(sha)[:12]
    try:
        git(["push", "-f", "origin", "HEAD:refs/heads/" + branch])
    except subprocess.CalledProcessError as e:
        return {"error": "revert branch push failed: " + str((e.stderr or e.stdout or str(e)))[:200], "sha": sha}
    ok, url = create_pr(branch, title, body + "\n\nOpened by scripts/canary_revert.py because a direct push to main was refused (" + refusal.splitlines()[0][:120] + "). The lane merges it when its checks are green; the push to main that merge makes deploys the reverted code.")
    if not ok:
        return {"error": "revert pull request not opened: " + url, "sha": sha, "branch": branch}
    return {"pr": url, "branch": branch, "sha": sha, "bumped": bumped, "title": title, "via": "pull request (direct push refused)"}


def revert_push(pushed, failed, dry, why=None, bystanders=None):
    """failed: [(worker, dir, bad_version)]. Reverts the pushed commit on the current checkout, re-bumps each failed worker's
    VERSION above the bad one, mirrors it, commits, pushes to main and dispatches the redeploy. Returns a dict with sha or
    refused/error; a git failure (a conflict, a lost remote) is an error, never an exception, so the issue is still filed.
    bystanders: {worker: dir} of the other workers in the push; those whose files the revert changed are redeployed too (DEPLOY-PROBES-1:
    a revert of a multi-worker pull request used to leave the unfailed workers live on code that main no longer carries)."""
    try:
        return _revert_push(pushed, failed, dry, why, bystanders)
    except (subprocess.CalledProcessError, OSError) as e:
        git(["revert", "--abort"], check=False)
        err = getattr(e, "stderr", None) or getattr(e, "stdout", None) or str(e)
        return {"error": "git failed: " + str(err).strip()[:300]}


def _revert_push(pushed, failed, dry, why=None, bystanders=None):
    message = git(["log", "-1", "--format=%B", pushed])
    if is_revert_commit(message):
        return {"refused": "the pushed commit is itself a revert; one level only"}
    flags = revert_flags(git(["rev-list", "--parents", "-n1", pushed]))
    if dry:
        return {"dry": True, "would_revert": pushed, "merge_commit": bool(flags), "workers": [w for w, _, _ in failed]}
    git(["fetch", "origin", "main"])
    done = existing_revert(git(["log", "-n", "60", "--format=%s", "origin/main"]).splitlines(), pushed)
    if done:
        return {"refused": "main already carries a revert of " + str(pushed)[:7] + " (" + done[:120] + "); the other canary reverted it", "already_reverted": True}
    git(["checkout", "-q", "-B", "canary-revert", "origin/main"])
    git(["revert", "--no-commit"] + flags + [pushed])
    touched = {x.split("/")[0] for x in git(["diff", "--cached", "--name-only"]).splitlines() if "/" in x}
    also = sorted(w for w, d in (bystanders or {}).items() if d in touched and w not in [f[0] for f in failed])
    bumped = []
    for worker, d, bad in failed:
        path = os.path.join(d, "worker.js")
        with open(path, encoding="utf-8") as fh:
            base = fh.read()
        res = bump_for_revert(base, bad, "-revert-" + str(pushed)[:7])
        if not res:
            git(["revert", "--abort"], check=False)
            return {"error": "cannot bump the VERSION line of " + path}
        new_version, content = res
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(content)
        mirror = os.path.join(d, "deployed-current.worker.js")
        if os.path.exists(mirror):
            with open(mirror, "w", encoding="utf-8") as fh:
                fh.write(content)
            git(["add", mirror])
        git(["add", path])
        bumped.append((worker, bad, new_version))
    title = "revert: " + str(pushed)[:7] + " did not reach /health on " + ", ".join(w for w, _, _ in failed) + " (CONTROL-PLANE-CANARY-1)"
    if why:
        title = "revert: " + str(pushed)[:7] + " failed the functional canary on " + ", ".join(w for w, _, _ in failed) + " (CONTROL-PLANE-CANARY-1)"
    body = "\n".join(revert_line(b, (why or {}).get(b[0])) for b in bumped)
    git(["commit", "-q", "-m", title + "\n\n" + body + "\n\nAutomatic revert by canonical-deploy.yml (scripts/canary_revert.py). The failed pull request stays as it is; its author fixes it in a new pull request."])
    sha = git(["rev-parse", "HEAD"]).strip()
    last = None
    for attempt in range(3):
        try:
            git(["push", "origin", "HEAD:main"])
            res = {"sha": sha, "bumped": bumped, "title": title}
            res.update(dispatch_redeploy([w for w, _, _ in failed] + also))
            return res
        except subprocess.CalledProcessError as e:
            last = (e.stderr or e.stdout or str(e))[:300]
            if RULE_REFUSAL.search(last):
                break  # a repository rule refuses a direct push however often it is retried
            time.sleep(2 * (attempt + 1))
            git(["fetch", "origin", "main"], check=False)
            git(["rebase", "origin/main"], check=False)
    if last and RULE_REFUSAL.search(last):
        return revert_via_pr(sha, title, body, bumped, last)
    return {"error": "push to main failed: " + str(last), "sha": sha}


def probe_lines(results, failed):
    """Description lines for the failing probes of the failed workers: the first failing http probe as a `runtime-probe:` line (D1 turns it into
    the issue's runner-https contract, so the hourly remediation tick closes the issue when the route answers its marker again), then every
    failing probe with its reason. results[w]["probes"] is the list of failed probes the functional step kept."""
    lines, rt = [], None
    for w in failed:
        for p in results[w].get("probes") or []:
            lines.append("failing probe on %s: %s -> %s" % (w, DP.clean(p["label"], 160), DP.clean(p["reason"], 200)))
            rt = rt or DP.runtime_probe_line(p)
    return ("\n" + "\n".join(lines[:6]) if lines else "") + (("\n" + rt) if rt else "")


def issue_text(pushed, results, outcome):
    """(title, description) of the issue row: CONTROL-PLANE-REVERTED-1 (DEPLOY-PROBE-REVERTED-1 when no control-plane worker failed) when the
    revert is on main and its deploy is dispatched; CONTROL-PLANE-CANARY-FAILED-1 (DEPLOY-PROBE-FAILED-1) when nothing was reverted or the revert
    sits on main undeployed."""
    failed = [w for w in results if results[w]["state"] not in CANARY_SATISFIED]
    cp = any(w in CANARY_WORKERS for w in failed)
    pre = "CONTROL-PLANE" if cp else "DEPLOY-PROBE"
    only_probe = bool(failed) and all(results[w].get("functional") for w in failed)
    if outcome.get("pr") and not outcome.get("error"):
        title = pre + "-REVERTED-1: push " + str(pushed)[:7] + " revert opened as a pull request, " + ", ".join(failed) + (" failed its post-deploy probes" if only_probe else " never reached the pushed VERSION")
        step = "the revert is pull request " + str(outcome.get("pr")) + " (a direct push to main is refused by a repository rule); the lane merges it when its checks are green and the push it makes deploys the reverted code. Check that it merged."
    elif "sha" in outcome and not outcome.get("error") and not outcome.get("redeploy_error"):
        title = pre + "-REVERTED-1: push " + str(pushed)[:7] + " reverted, " + ", ".join(failed) + (" failed its post-deploy probes" if only_probe else " never reached the pushed VERSION")
        step = "the revert commit is " + str(outcome.get("sha")) + " and its deploy is dispatched (" + ", ".join(outcome.get("redeploy") or []) + ")."
    elif "sha" in outcome and not outcome.get("error"):
        title = pre + "-CANARY-FAILED-1: push " + str(pushed)[:7] + " reverted on main as " + str(outcome.get("sha"))[:7] + " but the redeploy of " + ", ".join(failed) + " was not dispatched"
        step = ("first dispatch the deploy of the revert commit " + str(outcome.get("sha")) + " (gh workflow run canonical-deploy.yml -f workers=\""
                + " ".join(failed) + "\"; a push made with GITHUB_TOKEN starts no run): " + str(outcome.get("redeploy_error"))[:200] + ".")
    else:
        title = pre + "-CANARY-FAILED-1: push " + str(pushed)[:7] + (" failed its post-deploy probes on " if only_probe else " did not reach /health on ") + ", ".join(failed) + " and could not be reverted"
        step = "nothing was reverted (" + str(outcome.get("refused") or outcome.get("error") or "no outcome")[:200] + "), so the live worker is the one to repair first."
    seen = "; ".join((("%s wanted %s, saw %s after %d polls" % (w, results[w]["want"], results[w]["seen"], results[w]["polls"])) if results[w].get("polls") else w)
                     + ((", " if results[w].get("polls") else " ") + "failed its post-deploy probes: " + str(results[w].get("functional"))[:240] if results[w].get("functional") else "") for w in failed)
    repro = ("reproduce the failing probe (curl the route; for a D1 probe run EXPLAIN QUERY PLAN <statement> on the database), the worker suites and node --check"
             if only_probe else "reproduce the /health failure locally (node --check, the worker suites, a wrangler dev health call)")
    desc = ("Charter pillar: autonomy. canonical-deploy.yml canary (scripts/canary_revert.py, CONTROL-PLANE-CANARY-1, DEPLOY-PROBES-1) on push "
            + str(pushed) + ": " + seen + ". Outcome: " + json.dumps(outcome)[:400]
            + ". The push came from a pull request the merge lane accepted; its author fixes the "
            "change in a new pull request, with the declared probes (<worker>/probes.json) passing. "
            "session-task: read the canonical-deploy run for this push, " + repro + ", open a corrected pull request; " + step
            + probe_lines(results, failed))
    return title, desc


def observed_issue_text(pushed, worker, probes, kind):
    """(title, description) of the issue for a probe failure that reverted nothing. kind: 'pre-existing' (it failed before this push too and was already
    declared), 'new-probe' (a probe this push declares whose page already answered without its marker: a mistyped marker), 'observed' (observe mode, a worker
    this push created, a failure of an earlier push, a baseline taken after the deploy, a verify-only run). The title carries no sha, so the open-title dedupe holds."""
    p = probes[0]
    title = "DEPLOY-PROBE-FAILED-1: %s probe failing (%s): %s" % (worker, kind, DP.clean(p["label"], 90))
    why = {"pre-existing": "not new (it failed before the deploy and was already declared)",
           "new-probe": "probably a mistyped marker: the probe this change declares already failed before the deploy because the page answered without it",
           }.get(kind, "in a worker whose declaration says observe, that this push created, that an earlier push broke, or whose baseline was taken after the deploy")
    desc = ("Charter pillar: autonomy. canonical-deploy.yml ran %s/probes.json after push %s and %d probe(s) failed; nothing was reverted because the failure is %s. "
            % (worker, DP.clean(pushed, 40), len(probes), why))
    desc += ("session-task: fix the route or statement, or correct the probe if the page legitimately changed (a probe must look for text the page still shows; "
             "the 2026-11-04 dashboard rewrite broke three contracts that looked for the old page), open a pull request, and the probe passing closes this issue.")
    for q in probes[:6]:
        desc += "\nfailing probe: %s -> %s" % (DP.clean(q["label"], 160), DP.clean(q["reason"], 200))
    rt = next((x for x in (DP.runtime_probe_line(q) for q in probes) if x), None)
    if rt:
        desc += "\n" + rt
    return title, desc


def file_probe_issue(acct, token, pushed, worker, probes, kind):
    """One DEPLOY-PROBE-FAILED-1 row (deduped against an open row of the same title) for a failure that reverted nothing."""
    try:
        from apply_migrations import d1
    except Exception as e:  # pragma: no cover
        emit("::warning::cannot import the D1 helper: " + str(e)[:120])
        return None
    title, desc = observed_issue_text(pushed, worker, probes, kind)
    now_ms = int(time.time() * 1000)
    try:
        d1(acct, token, DB_ID, "INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) "
                               "SELECT ?1, ?2, 'ci:canonical-deploy', 'reliability', 'high', 'open', ?3, ?3 "
                               "WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title = ?1 AND status = 'open')", [title, desc, now_ms])
        return title
    except Exception as e:
        emit("::warning::probe issue not filed: " + str(e)[:200])
        return None


def file_issue(acct, token, pushed, results, outcome):
    """One CONTROL-PLANE-REVERTED-1 (or CONTROL-PLANE-CANARY-FAILED-1 when the revert itself failed) row in qnfo-audit."""
    try:
        from apply_migrations import d1
    except Exception as e:  # pragma: no cover
        emit("::warning::cannot import the D1 helper: " + str(e)[:120])
        return None
    title, desc = issue_text(pushed, results, outcome)
    now_ms = int(time.time() * 1000)
    try:
        d1(acct, token, DB_ID, "INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) "
                               "SELECT ?1, ?2, 'ci:canonical-deploy', 'reliability', 'high', 'open', ?3, ?3 "
                               "WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title = ?1 AND status = 'open')", [title, desc, now_ms])
        return title
    except Exception as e:
        emit("::warning::issue not filed: " + str(e)[:200])
        return None


def selftest():
    checks = []

    def ok(cond, name, detail=None):
        checks.append((bool(cond), name))
        emit(("PASS " if cond else "FAIL ") + name + ("" if cond or detail is None else " -- " + str(detail)[:300]))

    ok(parse_targets("qnfo-ops qnfo-ops/worker.js\n# c\nqnfo-ai qnfo-ai/worker.js create\n\nbad\n") == [("qnfo-ops", "qnfo-ops/worker.js"), ("qnfo-ai", "qnfo-ai/worker.js")], "targets: worker and path per line, comments and bad lines skipped")
    ok(read_version('x\nvar VERSION = "0.7.0-a"; /* c */\n') == "0.7.0-a" and read_version("nothing") is None, "read_version reads the single VERSION line")
    ok(judge({"version": "1.2.3-x"}, "1.2.3-x") == ("ok", "1.2.3-x") and judge({"version": "1.2.2"}, "1.2.3-x")[0] == "wrong-version" and judge({"ok": True}, "1")[0] == "no-version" and judge(None, "1")[0] == "no-version", "judge: ok, wrong-version, no-version")
    # CANARY-AHEAD-1 (agent_issues 1000171): push 7a9d293 wanted 3.31.2-seo-index-8, a commit 15 s later deployed 3.31.3-seo-index-9, and the
    # canary reverted a healthy worker after 25 polls. A strictly higher numeric core is a later push; equal, lower and unreadable still fail.
    ok(judge({"version": "3.31.3-seo-index-9"}, "3.31.2-seo-index-8") == ("ahead", "3.31.3-seo-index-9") and judge({"version": "4.0.0"}, "3.99.99-x")[0] == "ahead" and judge({"version": "3.31.10"}, "3.31.9")[0] == "ahead", "judge: a live VERSION with a strictly higher numeric core is ahead (numeric, not textual, comparison)")
    ok(judge({"version": "3.31.2-seo-index-9"}, "3.31.2-seo-index-8")[0] == "wrong-version" and judge({"version": "3.31.2"}, "3.31.3-seo-index-9")[0] == "wrong-version" and judge({"version": "3.9.0"}, "3.31.0")[0] == "wrong-version" and judge({"version": "garbage"}, "3.31.2")[0] == "wrong-version" and judge({"version": "3.31.3"}, "weird")[0] == "wrong-version", "judge: an equal core with another suffix, a lower core, an unreadable live or wanted VERSION stay wrong-version")
    ok(version_core("3.31.2-seo-index-8") == (3, 31, 2) and version_core("10.0.1") == (10, 0, 1) and version_core("x3.1.1") is None and version_core(None) is None, "version_core reads the numeric X.Y.Z core only")
    t_a = {"v": 0.0}
    res_a = poll({"qnfo-gateway": "3.31.2-seo-index-8", "qnfo-ops": "2.0.0"}, 1, 20, fetch=lambda w: {"version": "3.31.3-seo-index-9"} if w == "qnfo-gateway" else {"version": "1.9.9"}, clock=lambda: t_a["v"], sleep=lambda s_: t_a.__setitem__("v", t_a["v"] + s_))
    ok(res_a["qnfo-gateway"]["state"] == "ahead" and res_a["qnfo-gateway"]["polls"] == 1 and res_a["qnfo-ops"]["state"] == "failed:wrong-version" and res_a["qnfo-ops"]["polls"] >= 3, "poll: a worker that is ahead stops being polled and is not failed, a lower one still fails at the window", res_a)
    t_b = {"v": 0.0}
    res_b = poll({"qnfo-gateway": "3.31.2-seo-index-8"}, 1, 20, fetch=lambda w: {"version": "3.31.3-seo-index-9"}, clock=lambda: t_b["v"], sleep=lambda s_: t_b.__setitem__("v", t_b["v"] + s_))
    ok(res_b["qnfo-gateway"]["state"] == "ahead" and t_b["v"] == 0.0, "poll: an all-ahead set ends at the first poll, without waiting out the window", res_b)
    ok(record_ahead(None, None, "c0ffee1", res_a) is None and record_ahead("a", "t", "c0ffee1", {"qnfo-ops": {"want": "1", "state": "ok", "seen": "1", "polls": 1}}) is None and record_ahead("a", "t", "c0ffee1", {}) is None, "record_ahead writes nothing without credentials or without an ahead worker")
    t_ai, d_ai = issue_text("c0ffee1234567", {"qnfo-ops": {"want": "2.0.0", "state": "failed:wrong-version", "seen": "1.9.9", "polls": 3}, "qnfo-gateway": {"want": "3.31.2", "state": "ahead", "seen": "3.31.3", "polls": 1}}, {"sha": "abc1234def", "redeploy": ["canonical-deploy.yml"]})
    ok("qnfo-gateway" not in t_ai and "qnfo-gateway" not in d_ai and "qnfo-ops" in t_ai, "issue_text: a worker that is ahead is never named as failed", t_ai)
    ok(is_revert_commit("Revert \"x\"") and is_revert_commit("revert: abc (CONTROL-PLANE-CANARY-1)") and not is_revert_commit("feat: x"), "a revert commit is recognised, one level only")
    ok(read_version('var VERSION="3.26.1-gw";; /* c */\n') == "3.26.1-gw" and read_version("var VERSION  =  'x';") is None and read_version("  var VERSION = \"x\";") is None, "read_version: no spaces and ';;' accepted (CANARY-VERSION-REGEX-1), single quotes and indented lines are not")
    g = bump_for_revert('var VERSION="3.26.1-gw";; /* c */\nb', "3.26.2-bad", "-revert-abc1234")
    ok(g and g[0] == "3.26.3-revert-abc1234" and g[1] == 'var VERSION="3.26.3-revert-abc1234";; /* c */\nb', "bump_for_revert keeps a no-space ';;' line as written")
    r = bump_for_revert('a\nvar VERSION = "0.6.1-base"; /* old */\nb', "0.7.0-bad", "-revert-abc1234")
    ok(r and r[0] == "0.7.1-revert-abc1234" and 'var VERSION = "0.7.1-revert-abc1234";' in r[1] and r[1].endswith("\nb"), "bump_for_revert: base content, VERSION above the bad one, tag kept")
    ok(bump_for_revert('var VERSION = "1";\nvar VERSION = "2";', "1.0.0", "-r") is None and bump_for_revert('var VERSION = "1.0.0";', "nope", "-r") is None, "bump_for_revert refuses two VERSION lines or a bad version")
    answers = {"qnfo-ops": [{"version": "old"}, {"version": "new"}], "qnfo-ai": [None, None, None]}
    calls = {"qnfo-ops": 0, "qnfo-ai": 0}

    def fake_fetch(w):
        i = calls[w]
        calls[w] += 1
        a = answers[w]
        return a[min(i, len(a) - 1)]
    t = {"v": 0.0}
    res = poll({"qnfo-ops": "new", "qnfo-ai": "new"}, 1, 20, fetch=fake_fetch, clock=lambda: t["v"], sleep=lambda s: t.__setitem__("v", t["v"] + s))
    ok(res["qnfo-ops"]["state"] == "ok" and res["qnfo-ops"]["polls"] == 2 and res["qnfo-ai"]["state"] == "failed:no-version" and res["qnfo-ai"]["polls"] >= 3, "poll: a worker that arrives stops being polled, a silent one fails at the window")
    ok(set(CANARY_WORKERS) == {"qnfo-fleet-control", "qnfo-ops", "qnfo-deploy-guard", "qnfo-gateway", "qnfo-ai", "qnfo-observability", "qnfo-code-orchestrator"}, "the canary worker set is the control plane with a /health route")
    ok(revert_flags("c0ffee aaa111 bbb222\n") == ["-m", "1"] and revert_flags("c0ffee aaa111\n") == [] and revert_flags("") == [], "revert_flags: a merge commit reverts with -m 1, a squash or plain commit without")
    rc = redeploy_commands(["qnfo-code-orchestrator"], "o/r")
    ok(len(rc) == 1 and rc[0][3] == "deploy-code-orchestrator.yml" and "-f" not in rc[0], "redeploy_commands: the container worker is redeployed by its own workflow, never by canonical-deploy.yml", rc)
    rc = redeploy_commands(["qnfo-ops", "qnfo-ai"], "o/r")
    ok(len(rc) == 2 and rc[0][3] == "canonical-deploy.yml" and rc[0][-1] == "workers=qnfo-ops qnfo-ai" and rc[1][3] == "deploy-qnfo-ops.yml", "redeploy_commands: canonical workers in one dispatch, plus the break-glass qnfo-ops deploy", rc)
    ok(existing_revert(["ci(status): x", "revert: c0ffee1 did not reach /health on qnfo-ops (CONTROL-PLANE-CANARY-1)", "feat: y"], "c0ffee1234567") is not None and existing_revert(["revert: abc1234 x"], "c0ffee1234567") is None and existing_revert([], "c0ffee1") is None, "existing_revert: a revert of the pushed sha already on main is recognised, another sha's is not")
    rc = redeploy_commands(["qnfo-fleet-control", "qnfo-code-orchestrator"], "o/r")
    ok(len(rc) == 2 and rc[0][-1] == "workers=qnfo-fleet-control" and rc[1][3] == "deploy-code-orchestrator.yml", "redeploy_commands: a mixed set dispatches both paths once", rc)
    bogus = revert_push("0" * 40, [("qnfo-ops", "qnfo-ops", "0.0.1")], False)
    ok(isinstance(bogus, dict) and "error" in bogus and "git failed" in bogus["error"], "revert_push turns a git failure into an error outcome instead of raising", bogus)
    fake = {"qnfo-ops": {"want": "2.0.0", "state": "failed:wrong-version", "seen": "1.9.9", "polls": 3}, "qnfo-ai": {"want": "5.0.0", "state": "ok", "seen": "5.0.0", "polls": 1}}
    t1, d1_ = issue_text("c0ffee1234567", fake, {"sha": "abc1234def", "redeploy": ["canonical-deploy.yml", "deploy-qnfo-ops.yml"]})
    t2, d2 = issue_text("c0ffee1234567", fake, {"sha": "abc1234def", "redeploy": [], "redeploy_error": "canonical-deploy.yml: HTTP 403"})
    t3, d3 = issue_text("c0ffee1234567", fake, {"refused": "the pushed commit is itself a revert; one level only"})
    ok(t1.startswith("CONTROL-PLANE-REVERTED-1: push c0ffee1 reverted, qnfo-ops never") and "qnfo-ai" not in t1 and "deploy-qnfo-ops.yml" in d1_ and "session-task:" in d1_, "issue_text: a reverted and redeployed push files CONTROL-PLANE-REVERTED-1 naming only the failed worker", t1)
    ok(t2.startswith("CONTROL-PLANE-CANARY-FAILED-1: push c0ffee1 reverted on main as abc1234 but the redeploy of qnfo-ops was not dispatched") and "gh workflow run canonical-deploy.yml" in d2 and "HTTP 403" in d2, "issue_text: a revert that was pushed but not redeployed is a canary failure with the dispatch as its first step", t2)
    ok(t3.startswith("CONTROL-PLANE-CANARY-FAILED-1: push c0ffee1 did not reach /health on qnfo-ops and could not be reverted") and "one level only" in d3, "issue_text: a refused or failed revert is a canary failure that names the reason", t3)
    # CONTROL-PLANE-FUNCTIONAL-CANARY-1 -> DEPLOY-PROBES-1: the control-plane checks live in <worker>/probes.json
    def tree_reader(ref, path):  # the working tree (the declarations under test), whatever the ref
        try:
            with open(os.path.join(os.path.dirname(HERE), path), encoding="utf-8") as fh:
                return fh.read()
        except OSError:
            return None
    cp_decls = load_declarations([(w, w + "/worker.js") for w in CANARY_WORKERS], "HEAD", tree_reader)
    ok(all(cp_decls.get(w, {}).get("decl") and cp_decls[w]["decl"].get("http") for w in CANARY_WORKERS), "every canary worker declares probes.json with an http probe", {w: cp_decls.get(w, {}).get("errors") for w in CANARY_WORKERS})
    seq = {"https://qnfo.org/a": [(503, ""), (200, "MARK")], "https://qnfo.org/b": [(200, "nope")] * 9}
    seen_n = {}

    def fake_text(url):
        i = seen_n.get(url, 0)
        seen_n[url] = i + 1
        a_ = seq[url]
        return a_[min(i, len(a_) - 1)]
    slept = []
    dec = {"wa": {"decl": {"http": [{"url": "https://qnfo.org/a", "contains": "MARK"}]}, "bindings": {}},
           "wb": {"decl": {"http": [{"url": "https://qnfo.org/a", "contains": "MARK"}, {"url": "https://qnfo.org/b", "contains": "MARK"}]}, "bindings": {}}}
    fr = functional(["wa", "wb", "wc"], dec, tries=3, wait_sec=15, ctx_for=lambda x: {"fetch": fake_text, "d1": lambda b_, s_: (True, "")}, sleep=slept.append)
    ok(fr["wa"]["state"] == "ok" and fr["wa"]["tries"] == 2 and fr["wb"]["state"] == "failed" and fr["wb"]["tries"] == 3 and "marker MARK absent" in fr["wb"]["detail"] and len(fr["wb"]["regressions"]) == 1 and fr["wc"]["state"] == "none",
       "functional: a route that recovers passes, one that never shows its marker is a regression with its reason, a worker with no probe is none", fr)
    ok(len(slept) == 3 and all(x == 15 for x in slept), "functional: waits between attempts, not after the last one", slept)
    key_b = fr["wb"]["regressions"][0]["key"]
    fr2 = functional(["wb"], dec, baseline={"wb": {key_b: "fail"}}, base_keys={"wb": {key_b}}, tries=1, ctx_for=lambda x: {"fetch": fake_text, "d1": lambda b_, s_: (True, "")}, sleep=lambda s_: None)
    ok(fr2["wb"]["state"] == "failed" and not fr2["wb"]["regressions"] and len(fr2["wb"]["pre_existing"]) == 1, "functional: a probe that was declared and already failing before the deploy is pre-existing, not a regression", fr2)
    fake_fn = {"qnfo-ops": {"want": "2.0.0", "state": "failed:functional", "seen": "2.0.0", "polls": 1, "functional": "GET https://qnfo-ops.q08.workers.dev/registry: HTTP 500"}}
    t4, d4 = issue_text("c0ffee1234567", fake_fn, {"sha": "abc1234def", "redeploy": ["canonical-deploy.yml"]})
    ok(t4.startswith("CONTROL-PLANE-REVERTED-1: push c0ffee1 reverted, qnfo-ops failed its post-deploy probes") and "failed its post-deploy probes: GET https://qnfo-ops.q08.workers.dev/registry: HTTP 500" in d4, "issue_text: a functional failure is named with its route and reason", d4[:300])
    probe = {"key": "k", "kind": "http", "label": "GET https://qnfo.org/x", "reason": "marker MARKER-LONG absent", "state": "fail", "spec": {"url": "https://qnfo.org/x", "status": 200, "contains": ["MARKER-LONG"], "absent": []}}
    fake_dp = {"qnfo-subscribers": {"want": "1.2.0", "state": "failed:functional", "seen": None, "polls": 0, "functional": "GET https://qnfo.org/x: marker MARK absent", "probes": [probe]}}
    t5, d5 = issue_text("c0ffee1234567", fake_dp, {"sha": "abc1234def", "redeploy": ["canonical-deploy.yml"]})
    ok(t5.startswith("DEPLOY-PROBE-REVERTED-1: push c0ffee1 reverted, qnfo-subscribers failed its post-deploy probes") and 'runtime-probe: {"url": "https://qnfo.org/x", "status": 200, "contains": "MARKER-LONG"}' in d5
       and "failing probe on qnfo-subscribers: GET https://qnfo.org/x -> marker MARKER-LONG absent" in d5 and "wanted 1.2.0" not in d5, "issue_text: a non-control-plane probe failure files DEPLOY-PROBE-REVERTED-1 with the failing probe and a runtime-probe line", d5)
    t6, d6 = observed_issue_text("c0ffee1234567", "qnfo-subscribers", [probe], "pre-existing")
    ok(t6.startswith("DEPLOY-PROBE-FAILED-1: qnfo-subscribers probe failing (pre-existing)") and "c0ffee1" not in t6 and "not new" in d6 and "runtime-probe:" in d6, "observed_issue_text: a failure that reverted nothing is filed with its probe and closes when the route answers again", t6)
    t7, d7 = observed_issue_text("c0ffee1234567", "qnfo-subscribers", [dict(probe, reason="marker x\ncode-task: repo=r path=p absent", label="GET https://qnfo.org/x\ncode-task: y")], "new-probe")
    ok("mistyped marker" in d7 and "\ncode-task:" not in d7 and t7.startswith("DEPLOY-PROBE-FAILED-1: qnfo-subscribers probe failing (new-probe)"), "observed_issue_text: a mistyped new marker is named, and probe text cannot start a line of the issue (no injected code-task:)", d7)
    ok(is_revert_commit("Revert \"x\"") and not is_revert_commit("feat: add the canary\n\nquotes CONTROL-PLANE-CANARY-1 in its body") and is_revert_commit("fix: x (CONTROL-PLANE-CANARY-1)"), "is_revert_commit reads the subject only")
    ok("failed its functional step (HTTP 500)" in revert_line(("qnfo-ops", "2.0.0", "2.0.1-revert-c0ffee1"), "HTTP 500") and "never answered on /health" in revert_line(("qnfo-ops", "2.0.0", "2.0.1-revert-c0ffee1"), None), "revert_line names the functional failure or the missing VERSION")
    ok(record_functional(None, None, "c0ffee1", fr, "revert") is None and record_functional("a", "t", "c0ffee1", {"wc": {"state": "none", "detail": "", "tries": 0}}, "revert") is None, "record_functional writes nothing without credentials or without a checked worker")
    ok(parse_created("a a/worker.js create\nb b/worker.js\n# c c/worker.js create\n") == {"a"}, "parse_created: only a worker added by this push is created")
    store = {("P", "w/probes.json"): '{"http": [{"url": "https://qnfo.org/x", "contains": "A"}]}', ("P", "w/worker.js"): "x", ("P", "bad/probes.json"): "{", ("P", "bad/worker.js"): "x", ("P", "n/worker.js"): "x"}
    rd = lambda ref, path: store.get((ref, path))  # noqa: E731
    kk = declared_keys("P", "w", rd)
    ok(len(kk) == 1 and declared_keys("P", "n", rd) == set() and declared_keys("P", "bad", rd) is None and declared_keys("P", "gone", rd) is None, "declared_keys: the keys at the base commit, empty when the worker had none, None when unknown")
    store[("P", "w/wrangler.toml")] = 'name = "w"\n'
    ld = load_declarations([("w", "w/worker.js"), ("n", "n/worker.js")], "P", rd)
    ok(list(ld) == ["w"] and ld["w"]["decl"] and ld["w"]["dir"] == "w", "load_declarations: only workers with a probes.json, parsed and validated", ld)
    fails = [n for c, n in checks if not c]
    emit("canary-revert selftest: " + ("ok, " + str(len(checks)) + " checks" if not fails else str(len(fails)) + " FAILED"))
    return 0 if not fails else 1


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--targets", help="canonical-deploy target file")
    ap.add_argument("--pushed", help="the pushed commit sha")
    ap.add_argument("--canary-min", type=int, default=8)
    ap.add_argument("--poll-sec", type=int, default=20)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-revert", action="store_true", help="verify only: file the issue on a miss, never revert (the dispatched redeploy of a revert runs this way)")
    ap.add_argument("--functional", choices=["revert", "observe", "off"], default=None, help="what a failed functional step does (default revert; $CANARY_FUNCTIONAL overrides)")
    ap.add_argument("--functional-tries", type=int, default=4)
    ap.add_argument("--functional-wait", type=int, default=15)
    ap.add_argument("--probe-budget-sec", type=int, default=300, help="DEPLOY-PROBES-1: one worker's declared probes stop retrying after this many seconds (the rest are inconclusive)")
    ap.add_argument("--baseline-file", help="DEPLOY-PROBES-1: {worker: {probe key: state}} measured by `deploy_probes.py --baseline` before the deploy")
    ap.add_argument("--base", help="DEPLOY-PROBES-1: the commit whose probes.json files count as already declared (default <pushed>^)")
    ap.add_argument("--functional-only", action="store_true", help="run the declared probes of every control-plane worker now and print the result (no VERSION poll, no revert, no ledger)")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args(argv)
    if a.selftest:
        return selftest()
    if a.functional_only:
        decls = load_declarations([(w, w + "/worker.js") for w in CANARY_WORKERS], "HEAD")
        acct, token = os.environ.get("CLOUDFLARE_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN")
        fn = functional(sorted(CANARY_WORKERS), decls, tries=a.functional_tries, wait_sec=a.functional_wait, ctx_for=lambda x: DP.live_ctx(x["bindings"], acct, token))
        for w in sorted(fn):
            emit("functional " + w + " " + fn[w]["state"] + " (" + fn[w]["detail"][:300] + ", " + str(fn[w]["tries"]) + " tries)")
        return 0 if all(r["state"] in ("ok", "inconclusive") for r in fn.values()) else 1
    if not a.targets or not a.pushed:
        ap.error("--targets and --pushed are required")
    try:
        return run(a)
    except Exception as e:  # exit 0 always: the canary never fails the deploy run, it files what it saw
        emit("::warning::canary: unexpected failure " + type(e).__name__ + ": " + str(e)[:300])
        return 0


def parse_created(text):
    """Workers the push created ('<worker> <path> create'): a revert would delete files of a worker that stays deployed, so they are observed only."""
    return {ln.split()[0] for ln in str(text or "").splitlines() if len(ln.split()) >= 3 and ln.split()[2] == "create" and not ln.startswith("#")}


def changed_files(pushed):
    """Paths the pushed commit changed against its first parent ([] when git cannot say)."""
    return [ln.strip() for ln in git(["diff", "--name-only", pushed + "^", pushed], check=False).splitlines() if "/" in ln or ln.strip()]


def later_commits(pushed, d):
    """Short shas on origin/main after `pushed` that touch directory `d` (CANARY-AHEAD-1 for workers without a VERSION poll)."""
    git(["fetch", "origin", "main"], check=False)
    return git(["log", "--format=%h", pushed + "..origin/main", "--", d + "/worker.js", d + "/wrangler.toml", d + "/probes.json"], check=False).split()


def run(a):
    with open(a.targets, encoding="utf-8") as fh:
        raw = fh.read()
    targets = parse_targets(raw)
    created = parse_created(raw)
    decls = load_declarations(targets, a.pushed)
    for w, x in decls.items():
        if x["errors"]:
            emit("::warning::canary: " + x["dir"] + "/probes.json is not valid and is ignored (" + "; ".join(x["errors"])[:240] + ")")
    mode = (os.environ.get("CANARY_FUNCTIONAL") or a.functional or "revert").lower()
    probed = [w for w, _ in targets if decls.get(w, {}).get("decl") and DP.probe_list(decls[w]["decl"]) and mode != "off"]
    watch = [w for w, _ in targets if w in CANARY_WORKERS or (decls.get(w, {}).get("decl") or {}).get("health")]
    for w in watch:
        h = (decls.get(w, {}).get("decl") or {}).get("health")
        if h and w not in CANARY_WORKERS:
            HEALTH_URLS[w] = h
    if not watch and not probed:
        emit("canary: no control-plane worker and no probes.json in this push (" + ", ".join(w for w, _ in targets) + "): nothing to watch")
        return 0
    wanted, dirs = {}, {}
    for w, p in targets:
        if w not in watch and w not in probed:
            continue
        text = git(["show", a.pushed + ":" + p], check=False)
        v = read_version(text)
        if not v:
            emit("::warning::canary: " + p + " at " + a.pushed[:7] + " has no VERSION line; " + w + " is not watched")
            continue
        wanted[w] = v
        dirs[w] = p.split("/")[0]
    watch = [w for w in watch if w in wanted]
    probed = [w for w in probed if w in wanted]
    if not wanted:
        return 0
    results = {}
    if watch:
        emit("canary: watching " + json.dumps({w: wanted[w] for w in watch}) + " for up to " + str(a.canary_min) + " min")
        results = poll({w: wanted[w] for w in watch}, a.canary_min, a.poll_sec)
    for w in probed:
        if w not in results:
            results[w] = {"want": wanted[w], "state": "ok", "seen": None, "polls": 0}  # DEPLOY-PROBES-1: no VERSION poll declared, the probes are its check
    for w in results:
        emit("canary: " + w + " " + results[w]["state"] + " (wanted " + str(results[w]["want"]) + ", saw " + str(results[w]["seen"]) + ", " + str(results[w]["polls"]) + " polls)")
        if results[w]["state"] == "ahead":
            emit("canary: CANARY-AHEAD-1: " + w + " live VERSION " + str(results[w]["seen"]) + " is ahead of the pushed " + str(results[w]["want"])
                 + ", a later push deployed; that push's canary owns the verdict, nothing is reverted for this one")
    acct, token = os.environ.get("CLOUDFLARE_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN")
    if not a.dry_run and any(r["state"] == "ahead" for r in results.values()):
        emit("canary: ahead ledger " + str(record_ahead(acct, token, a.pushed, results)))
    why, observed = {}, {}
    if mode != "off" and probed:
        baseline = None
        bfile = getattr(a, "baseline_file", None)
        if bfile and os.path.exists(bfile):
            try:
                with open(bfile, encoding="utf-8") as fh:
                    baseline = json.load(fh)
            except (OSError, ValueError):
                baseline = None
        base_ref = getattr(a, "base", None) or (a.pushed + "^")
        base_keys = {w: declared_keys(base_ref, dirs[w]) for w in probed}
        emit("canary: probes for " + ", ".join(probed) + " (baseline " + ("read" if baseline is not None else "absent: every failure counts as a regression") + ")")
        pushed_files = [] if a.dry_run else changed_files(a.pushed)
        pushed_dirs = {f.split("/")[0] for f in pushed_files if "/" in f}
        migrations_changed = any(f.startswith("migrations/") for f in pushed_files)
        fn = functional([w for w in probed if results[w]["state"] == "ok"], decls, baseline, base_keys, tries=a.functional_tries, wait_sec=a.functional_wait,
                        ctx_for=lambda x: DP.live_ctx(x["bindings"], acct, token), budget_sec=getattr(a, "probe_budget_sec", 300))
        for w in sorted(fn):
            r = fn[w]
            emit("canary: functional " + w + " " + r["state"] + " (" + r["detail"][:300] + ", " + str(r["tries"]) + " tries)")
            if r["state"] == "inconclusive":
                emit("::warning::canary: " + w + " probes were inconclusive (D1 overloaded, the host unreachable from the runner, or the probe run raised): nothing reverted")
            if r["pre_existing"]:
                observed.setdefault(w, []).append(("pre-existing", r["pre_existing"]))
            if r.get("new_bad"):
                observed.setdefault(w, []).append(("new-probe", r["new_bad"]))
            regs = list(r["regressions"])
            if regs and migrations_changed:
                # a probe on schema this very push creates races the migration runner (apply-migrations.yml starts at the same commit)
                fresh = [q for q in regs if q["kind"] == "d1" and q["key"] not in (base_keys.get(w) or set())]
                if fresh:
                    emit("::warning::canary: " + w + " has new D1 probes and this push changes migrations/: a compile failure may only be the migration not applied yet, nothing reverted for them")
                    observed.setdefault(w, []).append(("observed", fresh))
                    regs = [q for q in regs if q not in fresh]
            if regs:
                wmode = (decls[w]["decl"] or {}).get("mode", "revert")
                results[w]["functional"] = "; ".join("%s: %s" % (DP.clean(q["label"], 120), DP.clean(q["reason"], 140)) for q in regs[:3])
                results[w]["probes"] = regs
                bw = (baseline or {}).get(w) or {}
                polluted = baseline is not None and bool(bw.get("__live_version__")) and bw.get("__live_version__") == wanted.get(w)
                hold = None
                if mode != "revert" or wmode != "revert":
                    hold = "observe mode"
                elif a.no_revert:
                    hold = "verify-only run"
                elif w in created:
                    hold = "worker created by this push"
                elif polluted:
                    hold = "the baseline was taken after the deploy (the live VERSION was already the pushed one): a regression cannot be told from a failure that was already there"
                elif not a.dry_run and dirs[w] not in pushed_dirs:
                    hold = "this push did not touch " + dirs[w] + " (the failure belongs to an earlier push that was cancelled or deployed with it)"
                else:
                    later = later_commits(a.pushed, dirs[w]) if not a.dry_run else []
                    if later:
                        hold = ", ".join(later[:4]) + " changed it after this push; that push's canary owns the verdict"
                if hold:
                    observed.setdefault(w, []).append(("observed", regs))
                    emit("::warning::canary: " + w + " failed its probes, nothing reverted (" + hold + "): " + r["detail"][:300])
                else:
                    results[w]["state"] = "failed:functional"
                    why[w] = results[w]["functional"]
        if not a.dry_run:
            emit("canary: functional ledger " + str(record_functional(acct, token, a.pushed, fn, mode)))
    if not a.dry_run and acct and token:
        for w, entries in sorted(observed.items()):
            for kind, probes in entries:
                if results[w]["state"] != "failed:functional":
                    emit("canary: probe issue " + str(file_probe_issue(acct, token, a.pushed, w, probes, kind)))
    failed = [(w, dirs[w], wanted[w]) for w in results if results[w]["state"] not in CANARY_SATISFIED]
    if not failed:
        ahead = sorted(w for w in results if results[w]["state"] == "ahead")
        emit("canary: every watched worker reports its pushed VERSION" + (" or a later push's" if ahead else "")
             + ("" if mode == "off" or len(ahead) == len(results) else " and passes its probes")
             + ((" (" + ", ".join(ahead) + " ahead of this push, checked by that push's canary: CANARY-AHEAD-1)") if ahead else ""))
        return 0
    if a.no_revert:
        outcome = {"refused": "verify-only run (workflow_dispatch): the canary files what it saw and reverts nothing"}
    else:
        outcome = revert_push(a.pushed, failed, a.dry_run, why, {w: p.split("/")[0] for w, p in targets if w not in [f[0] for f in failed]})
    emit("::warning::canary: " + ", ".join(w for w, _, _ in failed) + " did not arrive or failed the functional step; revert outcome " + json.dumps(outcome)[:300])
    if a.dry_run:
        return 0
    if outcome.get("already_reverted"):
        emit("canary: the other canary of this push already reverted it and filed the issue; nothing more to do")
        return 0
    if acct and token:
        emit("canary: issue " + str(file_issue(acct, token, a.pushed, results, outcome)))
    else:
        emit("::warning::canary: CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN absent, the revert is recorded only in this log and the revert commit")
    return 0


if __name__ == "__main__":
    sys.exit(main())
