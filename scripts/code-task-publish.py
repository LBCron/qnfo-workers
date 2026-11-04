#!/usr/bin/env python3
"""code-task-publish.py -- CODE-TASK-PUBLISH-1: PULL-BASED PR publishing for the qnfo-code-orchestrator loop.

WHY
  The orchestrator worker (and any session) holds no GitHub PR-write credential and a session cannot mint one,
  so a human sat on the critical path between "verified patch" and "PR". The GitHub Actions GITHUB_TOKEN already has
  contents: write + pull-requests: write for this repo. So the worker PARKS the verified patch in D1
  (code_tasks.status = 'ready_to_publish', patch in ctx.patch) and this script PULLS it from a workflow run.

WHAT IT DOES (per ready task of THIS repo)
  claim (ready_to_publish -> publishing, compare-and-set) -> re-check path policy -> reuse an existing PR for the
  branch if one exists (idempotent) -> else `git apply --check` + apply on a fresh branch off origin/main -> commit ->
  push -> open PR -> record status='published' + pr_url.  Any failure records status='publish_failed' with last_error.
  Then (PR-OUTCOME-RECONCILE-1) it reads the state of each published / branch_pushed / pr_open task's PR and records
  status='merged' or 'closed' once a person has merged or closed it.

PR OPENED BY THE FLEET (CODE-TASK-MERGE-RUNNER-1, CODE_TASK_PR_OPENER=qnfo-fleet-control)
  A PR opened with the Actions GITHUB_TOKEN starts no pull_request workflow, so its required checks never run, and this
  workflow holds no other GitHub credential. With CODE_TASK_PR_OPENER=qnfo-fleet-control (set in code-task-publish.yml)
  the script pushes the branch and stops at status='branch_pushed' with the compare URL; qnfo-fleet-control opens the PR
  with the fleet's own token within the hour (CI then starts by itself) and merges it when the checks and its gates pass.
  An existing PR for the branch is still adopted. Without the variable the script opens the PR itself, as before.
  It NEVER merges, never force-pushes, never touches main, never deletes rows, and uses no credential other than the
  environment's (CF_ACCOUNT_ID / CLOUDFLARE_API_TOKEN for D1, GH_TOKEN for gh). No secret value is read or printed.

EXIT  0 = nothing failed (including "no tasks").  1 = at least one task ended publish_failed (loud, never silent).
      2 = configuration/transport error (could not read the queue).
USAGE python3 scripts/code-task-publish.py [--repo-dir .] [--base main] | --selftest
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import secrets
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from code_delivery import implementation_path, numstat_has_code_changes

AUDIT_DB = os.environ.get("AUDIT_D1_ID", "35e2e573-92f3-46ac-83c6-22f6429fc5e5")
REPO_NAME = "qnfo-workers"
REPO_NAME_FULL = "QNFO/qnfo-workers"
# PATCH-CAP-VERSION-LINE-1 (2026-10-19, agent_issues 100169, 100172, 100173, 100175): the cap was 200_000 chars. A bump of
# `var VERSION` in qnfo-fleet-dashboard/worker.js replaces ONE 202,642-char line (the release notes ride on it as a comment) and
# the same line in the deployed-current mirror, so even a 4-line edit is a ~816,000-char patch (removed plus added, twice): 5 of 5
# code tasks on that file ended "publish: patch larger than 200000 chars" on 2026-10-19 (qnfo-fleet-control's VERSION line is
# 199,469 chars, the same arithmetic). 1_000_000 passes those patches; a whole-file fallback for a 1.2 MB worker (2.4 MB) and any
# runaway patch stay refused, and ctx plus patch still fit one D1 row (limit 2 MB).
# PATCH-CAP-1500K-1 (2026-10-19, agent_issues 100227): 1_000_000 was 22,726 chars short for qnfo-fleet-control. COST-GUARD-BLIND-2 (issue 100185,
# ct_qlk9bm3gwuo7cb) is a real edit plus the same two ~203,400-char VERSION lines (worker and mirror, removed and added): a 1,022,726-char patch, a
# ctx of 1,051,332 chars, three publish_failed attempts and a LOOP-BREAKER-1 issue. The release notes on those lines grow with every release (each
# bump adds about 4 x 5,000 chars), so the cap carries headroom of about 20 releases instead of a margin of 2 percent. 1_500_000 still refuses a
# whole-file fallback with its mirror for any worker over 375 KB (4 x the file size) and keeps ctx plus patch under one D1 row (2 MB). Pruning the
# release notes off the VERSION line would remove the pressure at its source; that is a separate change.
MAX_PATCH = 1_500_000
STALE_PUBLISHING_MIN = 30
D1_TIMEOUT_S = 45
D1_READ_ATTEMPTS = 3
# Mirror of the worker's DENY_PATH: the loop must never publish edits to workflows, wrangler config, deploy targets, env files.
DENY_PATH = re.compile(r"^(\.github/|\.git/)|(^|/)(wrangler\.toml|deploy-targets\.txt|\.env[^/]*)$", re.I)
BRANCH_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$")
CODE_TASK_PATH_RE = re.compile(r"^[ \t]*code-task:[ \t]*repo=([A-Za-z0-9._-]{1,100})[ \t]+path=(\S{1,300})[ \t]*$", re.M)


def repo_slug(repo) -> str:
    """REPO-SLUG-PUBLISH-1 (2026-10-19): a code_tasks row written straight into D1 may carry the owner-qualified
    "QNFO/qnfo-workers" (6 RED-DRAIN-1 rows, ct_im99928..ct_im99979, sat in ready_to_publish from 2026-10-18 14:49Z while
    every run logged "skip: repo QNFO/qnfo-workers is not qnfo-workers" and held their file claims). The orchestrator
    strips one leading owner segment since 0.18.13 (repoSlug); the publisher now does the same."""
    r = str(repo or "").strip()
    owner, sep, rest = r.partition("/")
    return rest if sep and owner.lower() == "qnfo" and rest and "/" not in rest else r


def explicit_task_path(task):
    """Return one safe, explicit code-task path when the task goal declares it."""
    matches = CODE_TASK_PATH_RE.findall(str(task.get("goal") or ""))
    if len(matches) != 1:
        return None
    repo, path = matches[0]
    if (repo_slug(repo) != REPO_NAME or not path or path.startswith("/") or ".." in path
            or "\\" in path or DENY_PATH.search(path)):
        return None
    return path


def now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def ago(minutes: int) -> str:
    t = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=minutes)
    return t.strftime("%Y-%m-%dT%H:%M:%S.000Z")


# ------------------------------------------------------------------ stores
class MissingTable(RuntimeError):
    """D1 said 'no such table'. For code_tasks that means the orchestrator has not run yet (it creates the table lazily),
    i.e. there is nothing to publish; every other D1 failure stays a hard error."""


D1_429_BACKOFF_S = (5, 10, 20, 30, 45)


def _urlopen_429(req, timeout):
    """D1-429-RETRY-1: 'D1 DB is overloaded ... 10 second window' (HTTP 429) rejects the statement, so retrying is safe even
    for the claim compare-and-set; run 41853819173 died on it with 'code-task-publish could not run'."""
    for wait in D1_429_BACKOFF_S + (None,):
        try:
            return urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.HTTPError as e:
            if e.code != 429 or wait is None:
                raise
            print(f"[publish] D1 429 overloaded; retrying in {wait}s", flush=True)
            time.sleep(wait)


class D1Store:
    """Cloudflare D1 over the REST API, same secrets the fleet workflows use (CF_ACCOUNT_ID, CLOUDFLARE_API_TOKEN)."""

    def _q(self, sql, params):
        acct, token = os.environ.get("CF_ACCOUNT_ID", ""), os.environ.get("CLOUDFLARE_API_TOKEN", "")
        if not acct or not token:
            raise RuntimeError("CF_ACCOUNT_ID / CLOUDFLARE_API_TOKEN not set")
        url = f"https://api.cloudflare.com/client/v4/accounts/{acct}/d1/database/{AUDIT_DB}/query"
        req = urllib.request.Request(url, data=json.dumps({"sql": sql, "params": params}).encode(), method="POST",
                                     headers={"Authorization": "Bearer " + token, "Content-Type": "application/json",
                                              "User-Agent": "qnfo-code-task-publish/1"})
        # D1-READ-RETRY-1 (#337): the REST read occasionally stalls (TimeoutError: The read operation timed out) and the
        # next run succeeds, so a SELECT is retried with backoff. Writes are not: a timed-out UPDATE may have landed,
        # and the claim is a compare-and-set whose retry would misread "already claimed" as "lost the race".
        attempts = D1_READ_ATTEMPTS if sql.lstrip().upper().startswith("SELECT") else 1
        try:
            for i in range(attempts):
                try:
                    with _urlopen_429(req, D1_TIMEOUT_S) as r:
                        d = json.load(r)
                    break
                except (TimeoutError, urllib.error.URLError) as e:
                    if isinstance(e, urllib.error.HTTPError) or i + 1 >= attempts:
                        raise
                    print(f"[publish] D1 read attempt {i + 1}/{attempts} failed ({type(e).__name__}); retrying", flush=True)
                    time.sleep(2 ** i)
        except urllib.error.HTTPError as e:
            msg = ""
            try:  # Cloudflare error bodies carry {"errors":[{"message":...}]}; no secrets in them
                msg = "; ".join(str(x.get("message", "")) for x in (json.load(e).get("errors") or []))[:200]
            except Exception:
                pass
            if e.code == 400 and "no such table" in msg.lower():
                raise MissingTable(f"D1 HTTP 400: {msg}") from None
            raise RuntimeError(f"D1 HTTP {e.code}" + (f": {msg}" if msg else "")) from None
        if not d.get("success", d.get("ok", False)):
            raise RuntimeError("D1 query rejected")
        return d["result"][0]

    def rows(self, sql, params=()):
        return self._q(sql, list(params)).get("results") or []

    def changes(self, sql, params=()):
        return int((self._q(sql, list(params)).get("meta") or {}).get("changes") or 0)


class SqliteStore:
    """Offline stand-in with the same two methods (selftest only)."""

    def __init__(self, db):
        self.db = db
        db.row_factory = sqlite3.Row

    def rows(self, sql, params=()):
        rows = [dict(r) for r in self.db.execute(sql, list(params)).fetchall()]
        self.db.commit()
        return rows

    def changes(self, sql, params=()):
        c = self.db.execute(sql, list(params))
        self.db.commit()
        return c.rowcount


class SqliteD1Store(SqliteStore):
    """Offline stand-in that counts like D1 (selftest and tests only). D1 reports meta.changes from the connection's total
    changes, so a row an AFTER INSERT trigger writes is counted; SqliteStore's cursor.rowcount leaves it out and cannot show
    the false 'successor row was not written' alarm (REPROPOSE-TRIGGER-COUNT-1)."""

    def changes(self, sql, params=()):
        before = self.db.total_changes
        self.db.execute(sql, list(params))
        self.db.commit()
        return self.db.total_changes - before


def list_ready(store):
    try:
        return store.rows(
            "SELECT * FROM code_tasks WHERE status='ready_to_publish' OR (status='publishing' AND updated_at < ?) ORDER BY created_at ASC LIMIT 20",
            [ago(STALE_PUBLISHING_MIN)])
    except MissingTable as e:
        # CODE-TASK-PUBLISH-NOTABLE-1 (watchdog issue 248): the table does not exist until qnfo-code-orchestrator first
        # runs, so every main push turned this workflow red with a bare 'D1 HTTP 400'. No table = nothing to publish.
        print("code_tasks does not exist yet (%s): nothing to publish" % e)
        return []


def claim(store, task):
    """Compare-and-set: only one publisher run wins a task. A stale 'publishing' row (crashed run) is re-claimable."""
    # D1 meta.changes includes trigger writes (e.g. owner_queue_live_metric_ct_upd). RETURNING identifies only the
    # row this CAS won, unlike a later status read that could mistake another run's claim for our own.
    return bool(store.rows(
        "UPDATE code_tasks SET status='publishing', updated_at=? WHERE id=? AND (status='ready_to_publish' OR (status='publishing' AND updated_at < ?)) RETURNING id",
        [now(), task["id"], ago(STALE_PUBLISHING_MIN)]))


def finish(store, tid, status, pr_url=None, err=None):
    store.changes("UPDATE code_tasks SET status=?, pr_url=COALESCE(?, pr_url), last_error=?, updated_at=? WHERE id=?",
                  [status, pr_url, (err or None) and ("publish: " + err)[:500], now(), tid])


# ------------------------------------------------------------------ git / PR
class GhPR:
    """Opens PRs with the gh CLI authenticated by GH_TOKEN (the workflow's GITHUB_TOKEN). Never merges."""

    def existing(self, branch):
        r = subprocess.run(["gh", "pr", "list", "--head", branch, "--state", "all", "--json", "url", "--limit", "1"],
                           capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError("gh pr list failed: " + r.stderr.strip()[:200])
        j = json.loads(r.stdout or "[]")
        return j[0]["url"] if j else None

    def create(self, branch, base, title, body):
        r = subprocess.run(["gh", "pr", "create", "--head", branch, "--base", base, "--title", title, "--body", body],
                           capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError("gh pr create failed: " + r.stderr.strip()[:200])
        return r.stdout.strip().splitlines()[-1]

    def state(self, url):
        """OPEN, MERGED or CLOSED for a PR URL (read-only)."""
        r = subprocess.run(["gh", "pr", "view", url, "--json", "state", "--jq", ".state"], capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError("gh pr view failed: " + r.stderr.strip()[:200])
        return r.stdout.strip().upper()


def git(repo_dir, *args, check=True):
    r = subprocess.run(["git", "-c", "user.name=qnfo-code-task-publish", "-c", "user.email=fleet-bot@qnfo.org", *args],
                       cwd=repo_dir, capture_output=True, text=True)
    if check and r.returncode != 0:
        raise RuntimeError(("git " + args[0] + " failed: " + (r.stderr or r.stdout).strip())[:300])
    return r


def compare_url(base, branch):
    return "https://github.com/" + REPO_NAME_FULL + "/compare/" + base + "..." + branch + "?expand=1"


# PUBLISH-JS-CHECK-1 (2026-10-02): the orchestrator's in-Worker JS verifier passed a patch that does not parse (code task
# ct_4c0lf1nu36lp6g: unescaped double quotes inside a string at personal-companion/worker.js:934), and the PR reached CI,
# where deploy-gate rejected it (run 36981662012, ci-watchdog #445). This runner has a real JavaScript parser, so every
# .js/.mjs file the patch touches is parsed here after `git apply`, before anything is pushed. A file that does not parse
# goes back to the orchestrator's propose step with the parser's message as feedback (SELF-REPAIR-1 counts the attempt),
# never to a PR. The check is syntax only: imports are not resolved and nothing is executed.
#
# PUBLISH-PY-CHECK-1 (2026-10-07, SCOPE-SCRIPTS-1, issue 2101): the same gate for a patched .py file, so that a scripts/*.py code
# task that does not parse goes back to propose instead of to a pull request once the merge runner takes that path. This runner
# is Python, so compile() is the parser; the file is read, never imported or executed.
def py_syntax_error(repo_dir, f):
    """The parse error of one .py file, or None."""
    src = os.path.join(repo_dir, f)
    if not os.path.isfile(src):
        return None
    try:
        with open(src, "rb") as fh:
            compile(fh.read(), f, "exec")
    except SyntaxError as e:
        return (f + ": SyntaxError: " + str(e.msg) + " (" + f + ":" + str(e.lineno or 0) + ")")[:400]
    except ValueError as e:  # a null byte in the source
        return (f + ": " + str(e))[:400]
    return None


def js_syntax_errors(repo_dir, files):
    """First parse error among the patched .js/.mjs/.py files, or None (a .js file is also None when node is not installed)."""
    for f in files:
        if f.endswith(".py"):
            bad = py_syntax_error(repo_dir, f)
            if bad:
                return bad
            continue
        if not (f.endswith(".js") or f.endswith(".mjs")):
            continue
        src = os.path.join(repo_dir, f)
        if not os.path.isfile(src):
            continue
        tmp = os.path.join(tempfile.mkdtemp(prefix="ctp-js-"), "check.mjs")  # .mjs: parse as an ES module on any Node version
        shutil.copyfile(src, tmp)
        try:
            r = subprocess.run(["node", "--check", tmp], capture_output=True, text=True, timeout=60)
        except FileNotFoundError:
            return None
        if r.returncode != 0:
            lines = [ln for ln in (r.stderr or "").splitlines() if ln.strip()]
            where = next((ln.strip().replace(tmp, f) for ln in lines if tmp in ln), f)
            what = next((ln.strip() for ln in lines if "Error" in ln), lines[-1].strip() if lines else "parse failed")
            return (f + ": " + what + " (" + where + ")")[:400]
    return None


# PUBLISH-SUITE-CHECK-1 (2026-10-11, owner directive "Remediate root causes automatically for future deploy 100% success
# target"). In the 30 days to 2026-10-11, 15 code-loop tasks ended at CI with "required check(s) failed: gate" (the worker's
# *.test.mjs suites, SUITE-RUNNER-1) and each one died there: the orchestrator's verifier parses a proposal but runs no suite, and
# the merge runner can only refuse. Every one of those suites passes on main today, so the proposals broke them. This runner
# holds the whole repository, so after the patch applies it runs the suites of the touched worker directory (the same
# scripts/run-suites.mjs selection deploy-gate uses). A suite that fails here and passes on the unpatched base is the change's
# fault: the task goes back to propose with the failing lines (SELF-REPAIR-1 counts the attempt), never to a pull request. A suite
# already red on the base is not blamed on the change (the base is re-run for exactly those suites) and the publish proceeds.
# Shared paths (scripts, .github, migrations) would select every suite and are left to CI. Node 22+ is required (node:sqlite).
SUITE_TIMEOUT_S = 180
SUITE_FEEDBACK_LINES = 12
SUITE_LINE_RE = re.compile(r"^(FAIL\b|not ok \d|AssertionError|TypeError|ReferenceError|SyntaxError|RangeError|Error\b.*:)")


def node_major():
    try:
        r = subprocess.run(["node", "--version"], capture_output=True, text=True, timeout=20)
        return int((r.stdout or "v0").strip().lstrip("v").split(".")[0])
    except (FileNotFoundError, ValueError, subprocess.TimeoutExpired):
        return 0


def run_suites(repo_dir, dirs, only=None):
    """{suite: (ok, tail)} for the suites run-suites.mjs selects for dirs (or exactly `only`)."""
    sel = []
    for d in dirs:
        p = os.path.join(repo_dir, d)
        if os.path.isdir(p):
            sel += sorted(d + "/" + f for f in os.listdir(p) if f.endswith(".test.mjs"))
    if only is not None:
        sel = [x for x in sel if x in only]
    def one(suite):
        try:
            r = subprocess.run(["node", "--no-warnings", suite], cwd=repo_dir, capture_output=True, text=True, timeout=SUITE_TIMEOUT_S)
            return suite, (r.returncode == 0, (r.stdout or "") + (r.stderr or ""))
        except subprocess.TimeoutExpired:
            return suite, (False, "timed out after %d s" % SUITE_TIMEOUT_S)
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        return dict(pool.map(one, sel))


def suite_feedback(results):
    """The failing suites with their FAIL and error lines, for the model."""
    parts = []
    for suite, (ok, text) in sorted(results.items()):
        if ok:
            continue
        lines, seen = [], set()
        for ln in text.splitlines():
            t = ln.strip()
            if SUITE_LINE_RE.match(t) and t not in seen:
                seen.add(t)
                lines.append(t[:200])
            if len(lines) >= SUITE_FEEDBACK_LINES:
                break
        parts.append("FAIL " + suite + (": " + " | ".join(lines) if lines else ": " + " | ".join(text.strip().splitlines()[-3:])[:300]))
    return " ; ".join(parts)[:900]


def suite_check(repo_dir, files, base, log=print):
    """None when the touched worker's suites pass (or were red on the base already); else the feedback for the model.
    PUBLISH-SELFTEST-QUIET-1: `log` carries the ::notice:: and ::warning:: annotations; the offline selftest passes its own sink,
    so a fixture suite that is red on purpose never reaches the Actions annotations of every run (the "w/red.test.mjs" notice
    that sat on each green run read like a finding)."""
    # Shared paths select every suite in CI and are left to it; a worker directory changed beside one (MULTI-FILE-CODE-TASKS-1:
    # a worker and its migration) still has its own suites run here.
    dirs = sorted({f.split("/")[0] for f in files if "/" in f} - {"scripts", ".github", "migrations"})
    if not dirs:
        return None
    has_suites = any(
        os.path.isdir(os.path.join(repo_dir, d)) and
        any(name.endswith(".test.mjs") for name in os.listdir(os.path.join(repo_dir, d)))
        for d in dirs
    )
    if not has_suites:
        return None
    if node_major() < 22:
        return "SUITES: node 22+ is required to run the changed worker's test suites before publishing"
    after = run_suites(repo_dir, dirs)
    bad = {k: v for k, v in after.items() if not v[0]}
    if not bad:
        return None
    stash = git(repo_dir, "stash", "push", "--include-untracked", "-q", check=False)
    try:
        before = run_suites(repo_dir, dirs, only=set(bad))
    finally:
        if stash.returncode == 0:
            git(repo_dir, "stash", "pop", "-q", check=False)
    new = {k: v for k, v in bad.items() if before.get(k, (False, ""))[0]}
    if not new:
        log("::notice::PUBLISH-SUITE-CHECK-1: failing suites are red on " + base + " too, not blamed on the change: " + ",".join(sorted(bad)))
        return None
    return suite_feedback(new)


# PUBLISH-STANDARDS-CHECK-1 (2026-10-13, failure mode code-task-dies-at-ci). ct_j25aciskebfq1f (qnfo-fleet-dashboard, GA4-READ-1)
# passed the parse, migration and suite checks here and died at CI on "WORKERS-STANDARDS-GUARD-1: 1 violation(s) added by this
# change: ... [swallowed-catch]": the publisher ran every check deploy-gate runs except the standards guard. It now runs
# scripts/workers_standards_guard.py against the base on the patched tree, and a violation the change added sends the task back
# to propose with the guard's lines, never to a pull request. The guard reports only lines this change added, so a violation
# already on the base is never blamed on it. A missing guard (an old checkout) skips the check and leaves it to CI.
STANDARDS_FEEDBACK_LINES = 6


def standards_check(repo_dir, files, base):
    """None when the standards guard finds no violation added by the patched worker files; else the feedback for the model."""
    if not any(re.fullmatch(r"[^/]+/(worker\.js|wrangler\.(toml|jsonc))", f) for f in files):
        return None
    guard = os.path.join(repo_dir, "scripts", "workers_standards_guard.py")
    if not os.path.isfile(guard):
        return None
    try:
        r = subprocess.run([sys.executable, guard, "origin/" + base], cwd=repo_dir, capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        return None
    out = (r.stdout or "") + (r.stderr or "")
    if "violation(s) added by this change" not in out:
        return None
    lines = [ln.strip() for ln in out.splitlines() if re.match(r"^\s+\S+:\d+ \[", ln)]
    return ("STANDARDS " + " ; ".join(lines[:STANDARDS_FEEDBACK_LINES]))[:900]


# PUBLISH-DEPLOY-GATE-1: run the existing gate for each changed worker before its branch is pushed.
GATE_TIMEOUT_S = 180
GATE_FEEDBACK_LINES = 6


def gate_check(repo_dir, files, base, log=print):
    """Run the deploy gate for changed worker dirs; return actionable feedback on failure."""
    root = os.path.abspath(repo_dir)
    dirs = sorted({
        f.split("/", 1)[0]
        for f in files
        if "/" in f and os.path.isfile(os.path.join(root, f.split("/", 1)[0], "wrangler.toml"))
    })
    if not dirs:
        return None
    gate = os.path.join(root, "scripts", "deploy_gate.py")
    if not os.path.isfile(gate):
        return "GATE: scripts/deploy_gate.py is missing; cannot verify changed workers before publishing"
    if not shutil.which("npx"):
        return "GATE: npx is required to run scripts/deploy_gate.py before publishing changed workers"

    gate_env = os.environ.copy()
    for key in ("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CF_ACCOUNT_ID", "GH_TOKEN", "GITHUB_TOKEN"):
        gate_env.pop(key, None)
    failures = []
    for directory in dirs:
        worker_dir = os.path.join(root, directory)
        try:
            result = subprocess.run(
                [sys.executable, gate, "--check", worker_dir],
                cwd=root,
                capture_output=True,
                text=True,
                timeout=GATE_TIMEOUT_S,
                env=gate_env,
            )
        except subprocess.TimeoutExpired:
            failures.append("GATE %s: deploy gate timed out after %d s" % (directory, GATE_TIMEOUT_S))
            continue
        if result.returncode == 0:
            continue
        output = (result.stdout or "") + "\n" + (result.stderr or "")
        lines = [line.strip() for line in output.splitlines() if line.strip()]
        relevant = [line for line in lines if re.search(r"\b(FAIL|ERROR|error|failed|Error)\b", line)]
        failures.append("GATE %s: %s" % (
            directory,
            " | ".join((relevant or lines[-GATE_FEEDBACK_LINES:])[:GATE_FEEDBACK_LINES]) or
            "deploy gate exited %d" % result.returncode,
        ))
    return " ; ".join(failures)[:900] if failures else None


# MULTI-FILE-CODE-TASKS-1 (2026-10-12, agent_issues 2074): a task may carry companion files beside its own path. The
# orchestrator lists the ones its patch changes in ctx.paths; the rule it applied is repeated here, so a row written by
# anything else cannot widen what a code-loop branch touches: a companion is a migrations/<name>.sql or a file in the task
# path's own top directory, never a worker source, a mirror or a DENY_PATH file, and at most MAX_EXTRAS of them.
MAX_EXTRAS = 3
MIGRATION_RE = re.compile(r"^migrations/[A-Za-z0-9._-]+\.sql$")
WORKER_SRC_RE = re.compile(r"(^|/)(deployed-current\.)?worker\.js$")


def companion_paths(path, ctx):
    """(set of allowed companion paths, error)."""
    raw = ctx.get("paths")
    if raw is None:
        return set(), None
    if not isinstance(raw, list) or len(raw) > MAX_EXTRAS or not all(isinstance(x, str) and x for x in raw):
        return None, "ctx.paths is not a list of at most %d paths" % MAX_EXTRAS
    top = path.split("/")[0] if "/" in path else ""
    for x in raw:
        if x.startswith("/") or ".." in x or "\\" in x or DENY_PATH.search(x) or WORKER_SRC_RE.search(x) or x == path:
            return None, "companion path refused by policy: " + x[:100]
        if not (MIGRATION_RE.match(x) or (top and x.startswith(top + "/"))):
            return None, "companion path is outside " + (top or "the task's directory") + "/ and migrations/: " + x[:100]
    return set(raw), None


def migration_errors(repo_dir, files):
    """The header check the CI gate runs (scripts/apply_migrations.py --check) for the migrations a patch adds or changes."""
    migs = sorted(f for f in files if MIGRATION_RE.match(f))
    tool = os.path.join(repo_dir, "scripts", "apply_migrations.py")
    if not migs or not os.path.isfile(tool):
        return None
    try:
        r = subprocess.run([sys.executable, tool, "--check", *migs], cwd=repo_dir, capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        return None
    if r.returncode == 0:
        return None
    lines = [ln.strip() for ln in ((r.stdout or "") + (r.stderr or "")).splitlines() if ln.strip()]
    return ("MIGRATION " + ", ".join(migs) + ": " + " | ".join(lines[-4:]))[:600]


def rebase_companions(repo_dir, ctx, allowed, base):
    """Re-apply the companions' own edits (ctx.x[].edits) to the checked-out base. Returns (files written, error)."""
    out = set()
    for x in ctx.get("x") or []:
        xp, edits = (x or {}).get("path"), (x or {}).get("edits")
        if xp not in allowed or not edits:
            continue
        fp = os.path.join(repo_dir, xp)
        if x.get("new"):
            if os.path.exists(fp):
                return None, xp + " was to be created and exists on " + base + " now"
            body = (edits[0] or {}).get("replace") if len(edits) == 1 else None
            if not isinstance(body, str) or not body.strip():
                return None, xp + ": the new file has no content parked"
            os.makedirs(os.path.dirname(fp) or repo_dir, exist_ok=True)
            with open(fp, "w", encoding="utf-8", newline="") as fh:
                fh.write(body if body.endswith("\n") else body + "\n")
            out.add(xp)
            continue
        if not os.path.isfile(fp):
            return None, xp + " is not a file on " + base
        cur = _read_text(fp)
        text, err = apply_edits(cur, edits)
        if err:
            return None, xp + ": " + err
        if text != cur:
            with open(fp, "w", encoding="utf-8", newline="") as fh:
                fh.write(text)
            out.add(xp)
    return out, None


def requeue_for_syntax(store, tid, err):
    """Send a task whose patch does not parse back to the orchestrator's propose step with the parser's message."""
    lang = "the migration does not pass the CI header check (scripts/apply_migrations.py --check): " if err.startswith("MIGRATION ") else \
        "the worker's suites fail after applying the edits and pass on main without them (PUBLISH-SUITE-CHECK-1); keep the change and fix what these tests assert: " if err.startswith("FAIL ") else \
        "the Workers standards guard refuses lines the edits added (PUBLISH-STANDARDS-CHECK-1); keep the change and fix each one (a swallowed catch logs with console.error(JSON.stringify({...})), never an empty body): " if err.startswith("STANDARDS ") else \
        "Python does not parse after applying the edits (compile, PUBLISH-PY-CHECK-1): " if "SyntaxError" in err and ".py:" in err else \
        "JavaScript does not parse after applying the edits (node --check, PUBLISH-JS-CHECK-1): "
    msg = (lang + err)[:1200]
    return store.changes(
        "UPDATE code_tasks SET status='queued', step='propose', attempts=attempts+1, lease_until=NULL, last_error=?, "
        "ctx=json_set(COALESCE(ctx, '{}'), '$.lastError', ?), updated_at=? WHERE id=?",
        [msg, msg, now(), tid])


# REBASE-BEFORE-PUBLISH-1 (2026-10-06, transformation lever T1.3, pillar autonomy). The orchestrator parks the patch it built
# against the file it read (ctx.base) together with the SEARCH/REPLACE edits it applied (ctx.edits) and the mirror it saw
# identical (ctx.mirror). main moves between the proposal and this run (every canonical deploy rewrites the VERSION line the
# patch also touches), so `git apply --check` refused three publishes in the 14 days to 2026-10-06 ("patch does not apply":
# ct_826d5o9zjt6eix radar-hub, ct_hsbeng8unl6djw calendar-api, ct_6dpoljohrddtgn qnfo-email) and qnfo-fleet-control re-proposed
# each one with a model call (at most twice). A patch that no longer applies is now rebuilt without a model: the same edits are
# re-applied to the file at the current base (each SEARCH text exactly once in the whole file, the orchestrator's applyEdits
# rule over the whole file instead of its window), a js/mjs VERSION line is bumped from the current base as the orchestrator's
# bumpVersion does, and the mirror carries the same text when it still equals the source on main. No edits, a SEARCH that is
# gone or ambiguous, a mirror that drifted, or a rebuild that changes nothing still end publish_failed with the reason.
VERSION_DECL = re.compile(r'^((?:var|const|let) VERSION\s*=\s*")(\d+)\.(\d+)\.(\d+)([^"\n]*)(";?)', re.M)
MAX_EDITS = 8  # = the orchestrator's MAX_EDITS


def bump_version(cur: str, text: str) -> str:
    """The orchestrator's bumpVersion: patch number + 1 with the -codeagent tag, when the declaration is unchanged and unique.
    A rebuild always takes this patch bump, also for a task whose goal named a VERSION (GOAL-VERSION-1, ctx.version_want):
    the merge runner judges a rebuilt branch by re-applying the edits with the same bump (REBASE-INTEGRITY-1, cmRebaseText),
    so any other VERSION here would read as "other content was pushed"."""
    a, b = VERSION_DECL.search(cur), VERSION_DECL.search(text)
    if not a or not b or a.group(0) != b.group(0) or text.count(a.group(0)) != 1:
        return text
    return text.replace(a.group(0), a.group(1) + a.group(2) + "." + a.group(3) + "." + str(int(a.group(4)) + 1) + "-codeagent" + a.group(6))


def apply_edits(cur: str, edits):
    """The orchestrator's applyEdits over the whole file: (text, None) or (None, reason)."""
    if not isinstance(edits, list) or not edits:
        return None, "no SEARCH/REPLACE edits parked in ctx.edits"
    if len(edits) > MAX_EDITS:
        return None, f"too many edits ({len(edits)} > {MAX_EDITS})"
    spans = []
    for i, e in enumerate(edits, 1):
        srch, repl = (e or {}).get("search"), (e or {}).get("replace")
        if not isinstance(srch, str) or not srch or not isinstance(repl, str):
            return None, f"edit {i}: malformed (search/replace must be non-empty strings)"
        n = cur.count(srch)
        if n != 1:
            return None, f"edit {i}: SEARCH text occurs {n} times in the current file (it must occur exactly once)"
        at = cur.index(srch)
        spans.append((at, at + len(srch), repl))
    spans.sort()
    for i in range(1, len(spans)):
        if spans[i][0] < spans[i - 1][1]:
            return None, "edits overlap"
    out = cur
    for at, end, repl in reversed(spans):
        out = out[:at] + repl + out[end:]
    return out, None


def _read_text(fp):
    with open(fp, encoding="utf-8", newline="") as fh:
        return fh.read()


def rebase_edits(repo_dir, path, ctx, base):
    """Rebuild the task's change from ctx.edits on the checked-out base. Returns (files, note, error): files is the set of
    paths written (the source and, when ctx.mirror names one that equals the source on the base, its mirror)."""
    fp = os.path.join(repo_dir, path)
    if not os.path.isfile(fp):
        return None, None, path + " is not a file on " + base
    cur = _read_text(fp)
    text, err = apply_edits(cur, ctx.get("edits"))
    if err:
        return None, None, err
    if path.endswith((".js", ".mjs")):
        text = bump_version(cur, text)
    if text == cur:
        return None, None, "re-applying the edits changes nothing on " + base + " (the change may already be on main)"
    files = {path}
    mirror = ctx.get("mirror")
    if isinstance(mirror, str) and mirror:
        if mirror.startswith("/") or ".." in mirror or DENY_PATH.search(mirror) or not os.path.isfile(os.path.join(repo_dir, mirror)):
            return None, None, "mirror " + mirror[:80] + " is not a file on " + base
        if _read_text(os.path.join(repo_dir, mirror)) != cur:
            return None, None, "mirror " + mirror[:80] + " no longer equals the source on " + base + " (mirror-guard would fail)"
        files.add(mirror)
    for f in sorted(files):
        with open(os.path.join(repo_dir, f), "w", encoding="utf-8", newline="") as fh:
            fh.write(text)
    head = git(repo_dir, "rev-parse", "--short", "origin/" + base, check=False).stdout.strip() or base
    edits = ctx.get("edits") or []
    note = ("REBASE-BEFORE-PUBLISH-1: the parked patch did not apply to " + base + "@" + head + "; " + str(len(edits)) +
            " edit" + ("" if len(edits) == 1 else "s") + " re-applied to the current file" + (", mirror rewritten" if mirror in files else "") + " (no model call)")
    return files, note, None


def mirror_section(patch, path, mirror):
    """The source's section of the patch rewritten for its mirror: the same hunks, the three header lines under the mirror's
    path. Other files' sections (a multi-file task's companions) are left out. None when the source has no section."""
    out, take = [], False
    for ln in patch.splitlines():
        if ln.startswith("diff --git "):
            take = ln == "diff --git a/" + path + " b/" + path
            if take:
                ln = "diff --git a/" + mirror + " b/" + mirror
        elif take and ln == "--- a/" + path:
            ln = "--- a/" + mirror
        elif take and ln == "+++ b/" + path:
            ln = "+++ b/" + mirror
        if take:
            out.append(ln)
    return "\n".join(out) + "\n" if out else None


def note_carry(store, tid, carried):
    return store.changes("UPDATE code_tasks SET ctx=json_set(COALESCE(ctx, '{}'), '$.patch', ?, '$.mirror', ?, '$.mirror_carried', ?), updated_at=? WHERE id=?",
                         [carried["patch"], carried["mirror"], "MIRROR-CARRY-1: the parked patch changed the source only; its mirror equalled the source on the base and carries the same hunks", now(), tid])


def note_rebase(store, tid, note):
    return store.changes("UPDATE code_tasks SET ctx=json_set(COALESCE(ctx, '{}'), '$.rebased', ?), updated_at=? WHERE id=?", [note[:300], now(), tid])


def publish_one(task, repo_dir, base, pr, delegate=False):
    """Returns (status, pr_url, error, note). Raises nothing: every failure is a returned publish_failed.
    delegate=True: push the branch and stop at branch_pushed; qnfo-fleet-control opens the PR with the fleet token."""
    try:
        try:
            ctx = json.loads(task.get("ctx") or "{}")
        except ValueError:
            return "publish_failed", None, "ctx is not valid JSON", None
        patch, path = ctx.get("patch"), str(task.get("path") or "")
        branch = task.get("branch") or ("codeagent-" + str(task["id"])[3:15])
        if not isinstance(patch, str) or not patch.strip():
            # PUBLISH-NOPATCH-ATTRIBUTION-1: the ctx keys, step and model name the producer path that parked a patch-less row
            # (LEASE-FENCE-1 closed the known one); the leading text is unchanged for the fm-code-task-lease-lost-write detector.
            ctx_keys = ",".join(sorted(str(k) for k in ctx)[:12]) if isinstance(ctx, dict) else type(ctx).__name__
            return "publish_failed", None, ("task has no patch in ctx.patch (ctx keys: %s; step=%s; model=%s)"
                                            % (ctx_keys or "none", str(task.get("step") or "none")[:20], str(task.get("model") or "none")[:40])), None
        if len(patch) > MAX_PATCH:
            return "publish_failed", None, f"patch larger than {MAX_PATCH} chars", None
        if not path or path.startswith("/") or ".." in path or DENY_PATH.search(path):
            return "publish_failed", None, "path refused by policy: " + path[:100], None
        if not BRANCH_RE.match(branch) or branch in ("main", "master") or ".." in branch:
            return "publish_failed", None, "branch refused: " + branch[:100], None
        if repo_slug(task.get("repo")) != REPO_NAME:
            return "publish_failed", None, "task repo is not " + REPO_NAME, None
        target_path = explicit_task_path(task)
        if target_path and target_path != path:
            task["_repath"] = target_path
            return "superseded", None, ("task path " + path + " differs from its explicit code-task path " + target_path
                                        + "; re-read and rebuild at the declared path (CODE-TASK-PATH-DIRECTIVE-1)"), None
        # The patch may only touch the task's declared path.
        files = set(re.findall(r"^\+\+\+ b/(.+)$", patch, re.M)) | set(re.findall(r"^--- a/(.+)$", patch, re.M))
        # PATCH-MODE-1: a worker source may carry its deployed-current mirror in the same patch (mirror-guard), nothing else.
        mirror = path[: -len("worker.js")] + "deployed-current.worker.js" if path.endswith("/worker.js") or path == "worker.js" else None
        extra, x_err = companion_paths(path, ctx)
        if x_err:
            return "publish_failed", None, x_err, None
        allowed = {path} | ({mirror} if mirror else set()) | extra
        if path not in files or not files <= allowed:
            return "publish_failed", None, "patch touches files other than the task path: " + ",".join(sorted(files))[:150], None
        if not any(implementation_path(f) for f in files):
            return "publish_failed", None, "CODE-CHANGE-REQUIRED-1: documentation-only patch; implement the issue's remedy before publishing", None

        have = pr.existing(branch)  # idempotency: a crashed earlier run may already have opened the PR
        if have:
            return "published", have, None, None

        git(repo_dir, "checkout", "-q", "--detach", "origin/" + base)
        git(repo_dir, "reset", "-q", "--hard")
        git(repo_dir, "clean", "-qfd")
        git(repo_dir, "checkout", "-q", "-B", branch)
        pf = os.path.join(tempfile.mkdtemp(prefix="ctp-"), "task.patch")
        with open(pf, "w", encoding="utf-8", newline="") as fh:
            fh.write(patch)
        chk = git(repo_dir, "apply", "--check", pf, check=False)
        note = None
        if chk.returncode != 0:
            why = "patch does not apply to " + base + ": " + (chk.stderr or "").strip()[:250]
            files, note, rb_err = rebase_edits(repo_dir, path, ctx, base)
            if not rb_err and extra:
                more, rb_err = rebase_companions(repo_dir, ctx, extra, base)
                if not rb_err:
                    files = set(files) | more
            if rb_err:
                git(repo_dir, "reset", "-q", "--hard")
                git(repo_dir, "clean", "-qfd")
                # STALE-PUBLISH-REPROPOSE-1 (2026-10-12, agent_issues 2380): an edit whose SEARCH text is gone from main means main
                # moved under the task (hot monolith files; 9 publish_failed rows in 7 days). That is not a failure of the change
                # but of its base: the task ends superseded and publish_all enqueues the same goal on current main.
                if STALE_SEARCH_RE.search(rb_err):
                    return "superseded", None, "STALE-PUBLISH-REPROPOSE-1: " + why + "; rebase: " + rb_err + "; re-proposed on current main", None
                return "publish_failed", None, why + "; rebase: " + rb_err, None
        else:
            git(repo_dir, "apply", pf)
            # MIRROR-CARRY-1 (2026-10-12): a worker.js patch parked without its deployed-current mirror (the orchestrator read the
            # mirror while it lagged the source on main, or the task was filed by hand) reached CI and failed mirror-guard.
            # When the mirror on the base is byte-identical to the source on the base, the patched source is copied over it and
            # the parked patch gains the mirror's section (the source's own hunks under the mirror's path, which is how the
            # orchestrator writes it), so the merge runner's integrity check finds the pull request's files in the patch. A
            # mirror that differs on the base is left alone (that drift is not this change's).
            if mirror and mirror not in files and os.path.isfile(os.path.join(repo_dir, mirror)):
                src_base = git(repo_dir, "show", "origin/" + base + ":" + path, check=False)
                mir_base = git(repo_dir, "show", "origin/" + base + ":" + mirror, check=False)
                section = mirror_section(patch, path, mirror)
                if section and src_base.returncode == 0 and mir_base.returncode == 0 and src_base.stdout == mir_base.stdout:
                    shutil.copyfile(os.path.join(repo_dir, path), os.path.join(repo_dir, mirror))
                    files = set(files) | {mirror}
                    task["_carried"] = {"patch": patch + ("" if patch.endswith("\n") else "\n") + section, "mirror": mirror}
        # VERIFY-DEFER-PUBLISHER-1: a JavaScript task the orchestrator could not verify is parsed here or not pushed at all.
        if ctx.get("verify_deferred") and any(f.endswith((".js", ".mjs")) for f in files) and not shutil.which("node"):
            git(repo_dir, "reset", "-q", "--hard")
            return "publish_failed", None, "the orchestrator deferred this task's JavaScript verify to the publisher, and node is not installed here", None
        bad = js_syntax_errors(repo_dir, sorted(files)) or migration_errors(repo_dir, sorted(files)) or suite_check(repo_dir, sorted(files), base) \
            or standards_check(repo_dir, sorted(files), base) or gate_check(repo_dir, sorted(files), base)
        if bad:
            git(repo_dir, "reset", "-q", "--hard")
            git(repo_dir, "clean", "-qfd")
            git(repo_dir, "checkout", "-q", "--detach", "origin/" + base)
            return "syntax_retry", None, bad, None
        git(repo_dir, "add", "--", *sorted(files))
        delta = git(repo_dir, "diff", "--cached", "--numstat").stdout
        if not numstat_has_code_changes(delta):
            return "publish_failed", None, "CODE-CHANGE-REQUIRED-1: staged diff has no code changes; no PR will be opened", None
        git(repo_dir, "commit", "-q", "-m", "code-task " + task["id"] + ": " + str(task.get("goal") or "")[:60])
        git(repo_dir, "push", "origin", "refs/heads/" + branch + ":refs/heads/" + branch)
        if delegate:
            return "branch_pushed", compare_url(base, branch), None, note
        body = ("Opened by code-task-publish from verified code-task `" + task["id"] + "`.\n\nGoal: " + str(task.get("goal") or "")[:500] +
                "\n\nThe patch passed the orchestrator's deterministic verifier. Review and merge it on GitHub (or close it); this workflow never merges."
                "\n\n## Definition of done (CODE-CHANGE-REQUIRED-1)\n\nImplement the issue's remedy in code, an applied migration or executable configuration in this PR; link the issue, identify the implementation paths, run regression checks and verify the outcome after canonical deployment. No empty, documentation-only or investigation-only PR satisfies this contract.")
        try:
            url = pr.create(branch, base, "code-task: " + str(task.get("goal") or "")[:70], body)
        except RuntimeError as e:
            # Repo setting "Allow GitHub Actions to create pull requests" may be off. The branch is already
            # pushed, so record it as branch_pushed with the compare URL instead of failing the task; the
            # owner (from the compare URL) or the next run with a PR-capable token opens the PR from that branch.
            if "not permitted to create or approve pull requests" in str(e) or "createPullRequest" in str(e):
                return "branch_pushed", compare_url(base, branch), None, note
            raise
        return "published", url, None, note
    except Exception as e:  # noqa: BLE001 - a failure must become a recorded status, not a crash
        return "publish_failed", None, str(e)[:300], None


# A hand-filed task (ct_im*, ct_revnoop*) parks a verified patch and no ctx.edits. When main moves under it the rebase has nothing to
# re-apply ("no SEARCH/REPLACE edits parked"), which is the same stale base as a gone SEARCH: ct_im100458 (2026-10-22) and
# ct_revnoop20261024a (2026-10-24) ended publish_failed with the whole goal intact (agent_issues 2380 reopened on them).
STALE_SEARCH_RE = re.compile(r"edit \d+: SEARCH text occurs 0 times|no SEARCH/REPLACE edits parked in ctx\.edits")
REPROPOSE_NOTE = "[reproposed from {old}: main moved under the task before publish (STALE-PUBLISH-REPROPOSE-1); rebuild the same change on current main]"
REPATH_NOTE = "[re-targeted from {old}: explicit code-task path {path} differed from task.path; read and rebuild at the declared path (CODE-TASK-PATH-DIRECTIVE-1)]"


def _new_task_id():
    alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
    return "ct_" + "".join(secrets.choice(alphabet) for _ in range(14))


def _row_exists(store, tid):
    try:
        return bool(store.rows("SELECT 1 AS present FROM code_tasks WHERE id=?", [tid]))
    except Exception:  # noqa: BLE001 - an unreadable row is reported by the caller as not written; the caller logs it
        return False


def repropose(store, task, log=print, path=None):
    """Create one queued successor with a fresh read.

    Same-path stale patches retain their anchor and companions. A retargeted task
    uses only its explicit goal path because the old path-specific context is stale.
    The goal keeps its "[issue #N]" head, so INTAKE_MAX_TASKS counts the successor.
    """
    try:
        ctx = json.loads(task.get("ctx") or "{}")
    except ValueError:
        ctx = {}
    old_path = str(task.get("path") or "")
    target_path = str(path or old_path)
    retargeted = target_path != old_path
    goal = str(task.get("goal") or "").rstrip()
    note = REPATH_NOTE.format(old=task["id"], path=target_path) if retargeted else REPROPOSE_NOTE.format(old=task["id"])
    if note not in goal:
        goal = (goal[:5600] + "\n" + note) if len(goal) > 5600 else goal + "\n" + note
    c0 = {"reproposed_from": task["id"]}
    if retargeted:
        c0["path_directive"] = True
    else:
        if isinstance(ctx.get("anchor"), str) and ctx.get("anchor"):
            c0["anchor"] = ctx["anchor"]
        if isinstance(ctx.get("extras"), list) and ctx.get("extras"):
            c0["extras"] = ctx["extras"]
    nid = _new_task_id()
    try:
        n = store.changes("INSERT INTO code_tasks (id, repo, path, goal, status, step, attempts, ctx, created_at, updated_at) VALUES (?,?,?,?, 'queued','read',0,?,?,?)",
                          [nid, task.get("repo"), target_path, goal, json.dumps(c0), now(), now()])
    except Exception as e:  # noqa: BLE001 - the superseded row already says why; a missing successor is logged, never silent
        log(f"::error::repropose {task['id']}: could not enqueue the successor: {e}")
        return None
    if n < 1 and not _row_exists(store, nid):
        # D1's meta.changes counts rows an AFTER INSERT trigger writes too (queue_pulls_code_task_ai for a goal headed "[issue #N]",
        # code_tasks_repo_slug_ai), so a clean insert reports 2; ct_n6u8tqjg0xalz4 raised a false "successor row was not written"
        # while ct_6stuyid3pw7mfz existed (run 39124945342). An INSERT without OR IGNORE writes one row or raises, so only a
        # count below one is doubtful, and the row itself settles it.
        log(f"::error::repropose {task['id']}: the successor row was not written")
        return None
    store.changes("UPDATE code_tasks SET ctx=json_set(COALESCE(ctx, '{}'), '$.reproposed_as', ?), updated_at=? WHERE id=?", [nid, now(), task["id"]])
    return nid


# PUBLISH-LANE-SERIAL-1 (2026-10-26, owner directive "why aren't fleet PRs being merged immediately"): on 2026-10-26 six code tasks queued against
# the one 1.1 MB qnfo-research-exec/worker.js were published at the same moment. They serialize per worker by design (the merge runner merges one
# change per worker at a time and every merge bumps the same VERSION line and mirror), so each merge made the others conflict, the tail waited for
# conflict repair and a gate, aged past the 120-minute close and was re-proposed as -r2 and -r3: 27 of 58 fleet pull requests in 48 hours closed
# unmerged. A lane is a worker's worker.js (its mirror counts as the same lane) or, for any other file, that file. While a task of the lane has
# an open branch or pull request, the next one stays ready_to_publish and publishes against the main that already holds its predecessor, so it
# applies without a conflict. Tasks of different lanes still publish together. A failed in-flight read publishes ungated: the loop never stops
# on this gate, and a predecessor that is closed (the runner closes a stale one at 120 minutes) frees the lane.
LANE_INFLIGHT = ("branch_pushed", "published", "pr_open")
LANE_WORKER_FILE = re.compile(r"^([^/]+)/(?:deployed-current\.)?worker\.js$")


def lane_key(path) -> str:
    m = LANE_WORKER_FILE.match(str(path or ""))
    return m.group(1) if m else str(path or "")


def lanes_in_flight(store, log=print) -> dict:
    """{lane: id of the oldest task that has an open branch or pull request in it}; {} when D1 cannot be read."""
    try:
        rows = store.rows("SELECT id, path FROM code_tasks WHERE status IN ('branch_pushed','published','pr_open') ORDER BY created_at ASC")
    except Exception as e:  # noqa: BLE001 - fail open: a read error must not stop the code loop
        log(f"::warning::PUBLISH-LANE-SERIAL-1: the in-flight read failed ({e}); publishing without the lane gate")
        return {}
    busy = {}
    for r in rows:
        busy.setdefault(lane_key(r.get("path")), r["id"])
    return busy


def publish_all(store, repo_dir, base, pr, log=print, delegate=False):
    ready = list_ready(store)
    if not ready:
        log("no ready_to_publish tasks")
        return {"published": 0, "failed": 0, "skipped": 0}
    out = {"published": 0, "failed": 0, "skipped": 0}
    busy = lanes_in_flight(store, log)
    for t in ready:
        if t.get("repo") != REPO_NAME and repo_slug(t.get("repo")) == REPO_NAME:
            # REPO-SLUG-PUBLISH-1: repair the row to the bare slug (qnfo-fleet-control's opener and merge runner compare
            # t.repo with "qnfo-workers" too), compare-and-set on the status the run just read.
            try:
                store.changes("UPDATE code_tasks SET repo=? WHERE id=? AND repo=? AND status='ready_to_publish'", [REPO_NAME, t["id"], t.get("repo")])
                log(f"repo-slug {t['id']}: {t.get('repo')} -> {REPO_NAME}")
            except Exception as e:  # noqa: BLE001 - the publish below still runs on the normalized slug; logged, never silent
                log(f"::warning::repo-slug {t['id']}: could not repair the row: {e}")
            t = dict(t, repo=REPO_NAME)
        if t.get("repo") != REPO_NAME:
            log(f"skip {t['id']}: repo {t.get('repo')} is not {REPO_NAME}")
            out["skipped"] += 1
            continue
        lane = lane_key(t.get("path"))
        if busy.get(lane) not in (None, t["id"]):
            log(f"hold {t['id']}: {lane} already has an open change ({busy[lane]}); it publishes against the main that holds it (PUBLISH-LANE-SERIAL-1)")
            out["held"] = out.get("held", 0) + 1
            continue
        if not claim(store, t):
            log(f"skip {t['id']}: claimed by another run")
            out["skipped"] += 1
            continue
        st, url, err, note = publish_one(t, repo_dir, base, pr, delegate)
        if st in ("published", "branch_pushed"):
            busy.setdefault(lane, t["id"])
        if st == "syntax_retry":
            requeue_for_syntax(store, t["id"], err)
            out["retried"] = out.get("retried", 0) + 1
            log(f"::warning::syntax_retry {t['id']}: {err} (sent back to the orchestrator, no branch pushed)")
            continue
        finish(store, t["id"], st, url, err)
        if st == "superseded":
            nid = repropose(store, t, log, path=t.get("_repath"))
            out["reproposed"] = out.get("reproposed", 0) + (1 if nid else 0)
            if not nid:
                out["failed"] += 1
            log(f"::notice::superseded {t['id']}: {err} -> {nid or 'no successor'}")
            continue
        if t.get("_carried") and st in ("published", "branch_pushed"):
            note_carry(store, t["id"], t["_carried"])
            out["mirror_carried"] = out.get("mirror_carried", 0) + 1
            log(f"::notice::MIRROR-CARRY-1 {t['id']}: the mirror carries the source's change and the parked patch names it")
        if note:
            note_rebase(store, t["id"], note)
            out["rebased"] = out.get("rebased", 0) + 1
            log(f"::notice::rebased {t['id']}: {note}")
        if st == "branch_pushed" and delegate:
            out["published"] += 1
            log(f"branch_pushed {t['id']} -> {url} (qnfo-fleet-control opens the PR with the fleet token)")
        elif st == "branch_pushed":
            out["published"] += 1
            log(f"::warning::branch_pushed {t['id']} -> {url} (PR creation refused by repo setting)")
        elif st == "published":
            out["published"] += 1
            log(f"published {t['id']} -> {url}")
        else:
            out["failed"] += 1
            log(f"::error::publish_failed {t['id']}: {err}")
    return out


# PR-OUTCOME-RECONCILE-1 (2026-10-01): a published task kept status 'published' after its PR merged or closed (#297 merged
# at 10:40Z and #368 at 21:04Z, both still 'published' hours later), so the fleet's watchmaker index counted merged PRs as
# "waiting on a person". Each run reads the PR state of every published / branch_pushed task and records the outcome:
# status 'merged' or 'closed' (with the PR URL). The orchestrator's own 'pr_open' rows are covered the same way. An open PR,
# a branch with no PR yet, or a failed lookup leaves the row as is. Read-only on GitHub; it never merges or closes anything.
PULL_URL = re.compile(r"^https://github\.com/[^/]+/[^/]+/pull/\d+$")


def reconcile_outcomes(store, pr, log=print):
    out = {"merged": 0, "closed": 0, "open": 0, "errors": 0}
    try:
        rows = store.rows("SELECT id, branch, pr_url, status FROM code_tasks WHERE status IN ('published','branch_pushed','pr_open') ORDER BY updated_at ASC LIMIT 50")
    except MissingTable:
        return out
    for t in rows:
        url = t.get("pr_url") or ""
        try:
            if not PULL_URL.match(url):
                found = pr.existing(t["branch"]) if t.get("branch") else None
                if not found or not PULL_URL.match(found):
                    out["open"] += 1
                    continue
                url = found
            st = pr.state(url)
        except RuntimeError as e:
            out["errors"] += 1
            log(f"::warning::reconcile {t['id']}: {e}")
            continue
        if st in ("MERGED", "CLOSED"):
            new = "merged" if st == "MERGED" else "closed"
            store.changes("UPDATE code_tasks SET status=?, pr_url=?, updated_at=? WHERE id=? AND status IN ('published','branch_pushed','pr_open')",
                          [new, url, now(), t["id"]])
            out[new] += 1
            log(f"{t['id']}: PR {url} {new}")
        else:
            out["open"] += 1
    return out


# ------------------------------------------------------------------ selftest
class FakePR:
    def __init__(self, refuse=False):
        self.by_branch, self.created, self.refuse = {}, [], refuse
        self.bodies = []

    def existing(self, branch):
        return self.by_branch.get(branch)

    def create(self, branch, base, title, body):
        if self.refuse:
            raise RuntimeError("gh pr create failed: GitHub Actions is not permitted to create or approve pull requests")
        url = f"https://github.com/QNFO/{REPO_NAME}/pull/{len(self.created) + 1}"
        self.by_branch[branch] = url
        self.created.append(branch)
        self.bodies.append(body)
        return url

    def state(self, url):
        st = getattr(self, "states", {}).get(url)
        if st is None:
            raise RuntimeError("gh pr view failed: not found")
        return st


DDL = ("CREATE TABLE code_tasks (id TEXT PRIMARY KEY, repo TEXT NOT NULL, path TEXT NOT NULL, goal TEXT NOT NULL, "
       "status TEXT NOT NULL DEFAULT 'queued', step TEXT NOT NULL DEFAULT 'read', attempts INTEGER NOT NULL DEFAULT 0, model TEXT, "
       "ctx TEXT, branch TEXT, pr_url TEXT, last_error TEXT, lease_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)")


def _sh(cwd, *a):
    subprocess.run(a, cwd=cwd, check=True, capture_output=True, text=True)


def selftest():
    from unittest import mock

    fails = []

    def check(name, cond, extra=""):
        print(("PASS " if cond else "FAIL ") + name + (("  -- " + str(extra)) if not cond and extra else ""))
        if not cond:
            fails.append(name)

    def fixture():
        root = tempfile.mkdtemp(prefix="ctp-selftest-")
        remote, work = os.path.join(root, "remote.git"), os.path.join(root, "work")
        _sh(root, "git", "init", "-q", "--bare", "-b", "main", remote)
        _sh(root, "git", "clone", "-q", remote, work)
        _sh(work, "git", "checkout", "-q", "-b", "main")
        os.makedirs(os.path.join(work, "scripts"))
        with open(os.path.join(work, "scripts/x.py"), "w") as fh:
            fh.write("def f():\n    return 1\n")
        _sh(work, "git", "add", "-A")
        _sh(work, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init")
        _sh(work, "git", "push", "-q", "origin", "main")
        db = sqlite3.connect(":memory:")
        db.execute(DDL)
        return remote, work, SqliteStore(db)

    good = ("diff --git a/scripts/x.py b/scripts/x.py\n--- a/scripts/x.py\n+++ b/scripts/x.py\n@@ -1,2 +1,2 @@\n-def f():\n-    return 1\n+def f():\n+    return 2\n")
    stale = good.replace("return 1", "return 99")  # base the file no longer has -> must not apply

    def add(store, tid, patch, repo=REPO_NAME, path="scripts/x.py", status="ready_to_publish", branch=None, free_lane=True):
        # PUBLISH-LANE-SERIAL-1: the scenarios below share one store and one path; an earlier scenario's published task would hold the lane
        # for the next one, so a scenario that is not about the gate merges its predecessors first.
        if free_lane and status == "ready_to_publish":
            store.changes("UPDATE code_tasks SET status='merged' WHERE status IN ('published','branch_pushed','pr_open') AND path=?", [path])
        store.changes("INSERT INTO code_tasks (id,repo,path,goal,status,step,ctx,branch,created_at,updated_at) VALUES (?,?,?,?,?,'done',?,?,?,?)",
                      [tid, repo, path, "return 2", status, json.dumps({"patch": patch}), branch or ("codeagent-" + tid[3:15]), now(), now()])

    def row(store, tid):
        return store.rows("SELECT * FROM code_tasks WHERE id=?", [tid])[0]

    quiet = lambda *_: None  # noqa: E731

    # 1. no tasks
    remote, work, store = fixture()
    _sh(work, "git", "fetch", "-q", "origin", "main")
    pr = FakePR()
    r = publish_all(store, work, "main", pr, quiet)
    check("no tasks: no-op, nothing created", r == {"published": 0, "failed": 0, "skipped": 0} and not pr.created, r)
    add(store, "ct_notready0001", good, status="needs_human")
    add(store, "ct_alreadydone1", good, status="published")
    r = publish_all(store, work, "main", pr, quiet)
    check("non-ready statuses are never touched", r["published"] == 0 and not pr.created and row(store, "ct_notready0001")["status"] == "needs_human")

    # 2. patch applies -> branch pushed, PR opened, recorded
    remote, work, store = fixture()
    _sh(work, "git", "fetch", "-q", "origin", "main")
    pr = FakePR()
    add(store, "ct_applyok00001", good)
    r = publish_all(store, work, "main", pr, quiet)
    t = row(store, "ct_applyok00001")
    check("patch applies: status published with pr_url", r["published"] == 1 and t["status"] == "published" and (t["pr_url"] or "").endswith("/pull/1"), t)
    shown = subprocess.run(["git", "--git-dir", remote, "show", "codeagent-applyok00001:scripts/x.py"], capture_output=True, text=True)
    check("patch applies: branch on the remote carries the change", shown.stdout == "def f():\n    return 2\n", shown.stderr)
    main_show = subprocess.run(["git", "--git-dir", remote, "show", "main:scripts/x.py"], capture_output=True, text=True)
    check("main is untouched (never merged)", main_show.stdout == "def f():\n    return 1\n")
    check("published PR DoD requires a code change", len(pr.bodies) == 1 and "Definition of done (CODE-CHANGE-REQUIRED-1)" in pr.bodies[0])

    for tid, patch, path in [
        ("ct_nocode00001", good.replace("+    return 2", "+    return 1"), "scripts/x.py"),
        ("ct_docsonly001", "diff --git a/docs/report.md b/docs/report.md\n--- /dev/null\n+++ b/docs/report.md\n@@ -0,0 +1 @@\n+Investigation only\n", "docs/report.md"),
        ("ct_reportjson1", "diff --git a/report.json b/report.json\n--- /dev/null\n+++ b/report.json\n@@ -0,0 +1 @@\n+{}\n", "report.json"),
    ]:
        remote, work, store = fixture()
        _sh(work, "git", "fetch", "-q", "origin", "main")
        pr = FakePR()
        add(store, tid, patch, path=path)
        result = publish_all(store, work, "main", pr, quiet)
        failed_task = row(store, tid)
        check("no-code publication refused: " + tid,
              result["failed"] == 1 and failed_task["status"] == "publish_failed"
              and "CODE-CHANGE-REQUIRED-1" in failed_task["last_error"] and not pr.created, failed_task)
        pushed = subprocess.run(["git", "--git-dir", remote, "branch", "--list", failed_task["branch"]], capture_output=True, text=True)
        check("no-code task pushes no branch: " + tid, pushed.stdout.strip() == "")

    # 3. patch fails to apply and parks no edits to rebuild from -> superseded with the reason and one re-proposed successor (STALE-PUBLISH-REPROPOSE-1,
    #    agent_issues 2380: ct_im100458 and ct_revnoop20261024a ended publish_failed here with their goals intact), no PR, no push
    remote, work, store = fixture()
    _sh(work, "git", "fetch", "-q", "origin", "main")
    pr = FakePR()
    add(store, "ct_applybad0001", stale)
    r = publish_all(store, work, "main", pr, quiet)
    t = row(store, "ct_applybad0001")
    nid = json.loads(t["ctx"] or "{}").get("reproposed_as")
    succ = row(store, nid) if nid else None
    check("patch fails with no parked edits: superseded with the reason and a queued successor, never silent",
          r["failed"] == 0 and r.get("reproposed") == 1 and t["status"] == "superseded" and "does not apply" in (t["last_error"] or "")
          and "no SEARCH/REPLACE edits parked" in (t["last_error"] or "") and succ is not None and succ["status"] == "queued"
          and "reproposed from ct_applybad0001" in succ["goal"], (dict(t), dict(succ) if succ else nid))
    br = subprocess.run(["git", "--git-dir", remote, "branch", "--list", "codeagent-applybad0001"], capture_output=True, text=True)
    check("patch fails: no PR and nothing pushed", not pr.created and br.stdout.strip() == "")
    add(store, "ct_policybad001", good, path=".github/workflows/x.yml")
    add(store, "ct_nopatch00001", "")
    add(store, "ct_wrongfile001", good.replace("scripts/x.py", "scripts/y.py"))
    publish_all(store, work, "main", pr, quiet)
    check("policy / empty / wrong-file patches are publish_failed with reasons",
          all(row(store, i)["status"] == "publish_failed" and row(store, i)["last_error"] for i in ("ct_policybad001", "ct_nopatch00001", "ct_wrongfile001")))

    # 3b. PUBLISH-JS-CHECK-1: a .js patch that does not parse is sent back to the orchestrator, never pushed; one that parses publishes
    if shutil.which("node"):
        remote, work, store = fixture()
        os.makedirs(os.path.join(work, "w"))
        with open(os.path.join(work, "w/worker.js"), "w") as fh:
            fh.write('export default { fetch() { return new Response("a"); } };\n')
        _sh(work, "git", "add", "-A")
        _sh(work, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "js")
        _sh(work, "git", "push", "-q", "origin", "main")
        _sh(work, "git", "fetch", "-q", "origin", "main")
        pr = FakePR()
        jsp = lambda new: ("diff --git a/w/worker.js b/w/worker.js\n--- a/w/worker.js\n+++ b/w/worker.js\n@@ -1 +1 @@\n"  # noqa: E731
                           "-export default { fetch() { return new Response(\"a\"); } };\n+" + new + "\n")
        add(store, "ct_jsbad0000001", jsp('export default { fetch() { return new Response("<script src="https://x.example/a.js">"); } };'), path="w/worker.js")
        add(store, "ct_jsgood000001", jsp('export default { fetch() { return new Response("b"); } };'), path="w/worker.js", branch="codeagent-jsgood000001")
        r = publish_all(store, work, "main", pr, quiet)
        tb, tg = row(store, "ct_jsbad0000001"), row(store, "ct_jsgood000001")
        cb = json.loads(tb["ctx"] or "{}")
        check("js parse fails: sent back to propose with the parser's message, attempts counted",
              tb["status"] == "queued" and tb["step"] == "propose" and tb["attempts"] == 1 and "node --check" in (tb["last_error"] or "")
              and "w/worker.js" in (cb.get("lastError") or "") and r.get("retried") == 1, dict(tb))
        brb = subprocess.run(["git", "--git-dir", remote, "branch", "--list", "codeagent-jsbad0000001"], capture_output=True, text=True)
        check("js parse fails: nothing pushed, no PR", brb.stdout.strip() == "" and "codeagent-jsbad0000001" not in pr.created)
        check("js that parses (an ES module) still publishes", tg["status"] == "published" and r["published"] == 1, dict(tg))
    else:
        print("SKIP PUBLISH-JS-CHECK-1 selftest: node not installed")

    # 3b2. PUBLISH-PY-CHECK-1: a .py patch that does not parse is sent back to propose with the parser's message, never pushed
    remote, work, store = fixture()
    _sh(work, "git", "fetch", "-q", "origin", "main")
    pr = FakePR()
    add(store, "ct_pybad0000001", good.replace("+    return 2", "+    return (2"))
    r = publish_all(store, work, "main", pr, quiet)
    tb = row(store, "ct_pybad0000001")
    cb = json.loads(tb["ctx"] or "{}")
    check("py parse fails: sent back to propose with the parser's message and line, attempts counted",
          tb["status"] == "queued" and tb["step"] == "propose" and tb["attempts"] == 1 and "PUBLISH-PY-CHECK-1" in (tb["last_error"] or "")
          and "scripts/x.py:2" in (tb["last_error"] or "") and "SyntaxError" in (cb.get("lastError") or "") and r.get("retried") == 1, dict(tb))
    brb = subprocess.run(["git", "--git-dir", remote, "branch", "--list", "codeagent-pybad0000001"], capture_output=True, text=True)
    check("py parse fails: nothing pushed, no PR", brb.stdout.strip() == "" and "codeagent-pybad0000001" not in pr.created)
    check("py helper: a file that parses is None, a missing file is None",
          py_syntax_error(work, "scripts/x.py") is None and py_syntax_error(work, "scripts/none.py") is None)

    # 3c. REBASE-BEFORE-PUBLISH-1: a patch main has moved under is rebuilt from ctx.edits on the current base, no model call
    remote, work, store = fixture()
    _sh(work, "git", "fetch", "-q", "origin", "main")
    pr = FakePR()

    def add_edits(tid, patch, edits, path="scripts/x.py", mirror=None, age_min=0):
        store.changes("INSERT INTO code_tasks (id,repo,path,goal,status,step,ctx,branch,created_at,updated_at) VALUES (?,?,?,?,?,'done',?,?,?,?)",
                      [tid, REPO_NAME, path, "return 2", "ready_to_publish", json.dumps({"patch": patch, "edits": edits, "mirror": mirror}), "codeagent-" + tid[3:15], ago(age_min), now()])

    # PUBLISH-LANE-SERIAL-1: three tasks on one file in one run. The two that never open a branch (superseded, publish_failed) are older and go
    # first, so each is still exercised; the one that publishes takes the lane last.
    add_edits("ct_rebasegone01", stale, [{"search": "    return 7", "replace": "    return 2"}], age_min=3)
    add_edits("ct_rebasesame01", stale, [{"search": "    return 1", "replace": "    return 1"}], age_min=2)
    add_edits("ct_rebaseok0001", stale, [{"search": "    return 1", "replace": "    return 2"}], age_min=1)
    r = publish_all(store, work, "main", pr, quiet)
    t = row(store, "ct_rebaseok0001")
    check("stale patch with edits: rebuilt on main and published, the rebase recorded on the task",
          t["status"] == "published" and r.get("rebased") == 1 and str(json.loads(t["ctx"]).get("rebased", "")).startswith("REBASE-BEFORE-PUBLISH-1") and t["last_error"] is None, dict(t))
    shown = subprocess.run(["git", "--git-dir", remote, "show", "codeagent-rebaseok0001:scripts/x.py"], capture_output=True, text=True)
    check("rebased branch carries the re-applied edit", shown.stdout == "def f():\n    return 2\n", shown.stderr)
    tg, ts = row(store, "ct_rebasegone01"), row(store, "ct_rebasesame01")
    check("edit whose SEARCH is gone: superseded with both reasons, nothing pushed (STALE-PUBLISH-REPROPOSE-1)",
          tg["status"] == "superseded" and "does not apply" in tg["last_error"] and "rebase: edit 1: SEARCH text occurs 0 times" in tg["last_error"], dict(tg))
    succ_id = json.loads(tg["ctx"] or "{}").get("reproposed_as")
    succ = row(store, succ_id) if succ_id else None
    check("stale base: one successor task queued on the same path with the goal, the note and the provenance",
          succ is not None and succ["status"] == "queued" and succ["step"] == "read" and succ["path"] == tg["path"]
          and succ["goal"].startswith("return 2") and "reproposed from ct_rebasegone01" in succ["goal"]
          and json.loads(succ["ctx"]).get("reproposed_from") == "ct_rebasegone01" and r.get("reproposed") == 1, dict(succ) if succ else succ_id)
    check("edits that change nothing: publish_failed, never an empty branch", ts["status"] == "publish_failed" and "changes nothing" in ts["last_error"], dict(ts))
    brg = subprocess.run(["git", "--git-dir", remote, "branch", "--list", "codeagent-rebasegone01", "codeagent-rebasesame01"], capture_output=True, text=True)
    check("failed and superseded rebases push no branch", brg.stdout.strip() == "" and r["failed"] == 1)
    store.changes("UPDATE code_tasks SET status='merged' WHERE id='ct_rebaseok0001'")  # its pull request merged: the lane is free
    add_edits("ct_rebaseanch01", stale, [{"search": "    return 7", "replace": "    return 2"}])
    store.changes("UPDATE code_tasks SET ctx=json_set(ctx, '$.anchor', ?) WHERE id=?", ["def f():", "ct_rebaseanch01"])
    r2 = publish_all(store, work, "main", pr, quiet)
    ta = row(store, "ct_rebaseanch01")
    sa = row(store, json.loads(ta["ctx"]).get("reproposed_as"))
    check("stale base: the anchor is carried to the successor", sa is not None and json.loads(sa["ctx"]).get("anchor") == "def f():" and r2.get("reproposed") == 1, dict(sa) if sa else None)
    # 3c2. REPROPOSE-TRIGGER-COUNT-1: D1 counts trigger writes, so a clean "[issue #N]" successor insert reports 2 changes
    remote, work, base_store = fixture()
    store = SqliteD1Store(base_store.db)
    store.db.execute("CREATE TABLE queue_pulls (puller TEXT, issue_id INTEGER, via TEXT, ref TEXT, UNIQUE (via, ref))")
    store.db.execute("CREATE TRIGGER queue_pulls_code_task_ai AFTER INSERT ON code_tasks WHEN instr(COALESCE(NEW.goal, ''), '[issue #') = 1 "
                     "BEGIN INSERT OR IGNORE INTO queue_pulls (puller, issue_id, via, ref) VALUES ('qnfo-code-orchestrator', CAST(substr(NEW.goal, 9) AS INTEGER), 'code_task', NEW.id); END")
    _sh(work, "git", "fetch", "-q", "origin", "main")
    pr = FakePR()
    store.changes("INSERT INTO code_tasks (id,repo,path,goal,status,step,ctx,branch,created_at,updated_at) VALUES (?,?,?,?,?,'done',?,?,?,?)",
                  ["ct_issuehead001", REPO_NAME, "scripts/x.py", "[issue #2727] return 2", "ready_to_publish",
                   json.dumps({"patch": stale, "edits": [{"search": "    return 7", "replace": "    return 2"}]}), "codeagent-issuehead001", now(), now()])
    logs = []
    r = publish_all(store, work, "main", pr, logs.append)
    told = row(store, "ct_issuehead001")
    nid = json.loads(told["ctx"] or "{}").get("reproposed_as")
    check("issue-headed successor: reproposed and linked, no false 'not written' alarm (D1 counts the queue_pulls trigger row)",
          told["status"] == "superseded" and nid and row(store, nid)["status"] == "queued" and r.get("reproposed") == 1 and r["failed"] == 0
          and not [m for m in logs if "::error::" in m], (dict(told), logs))
    check("issue-headed successor: the trigger wrote its queue_pulls row for the successor",
          store.rows("SELECT COUNT(*) AS c FROM queue_pulls WHERE ref=?", [nid])[0]["c"] == 1)
    check("rebase helpers: apply_edits refuses an ambiguous SEARCH and overlapping edits",
          apply_edits("a b a", [{"search": "a", "replace": "c"}])[1].startswith("edit 1: SEARCH text occurs 2 times")
          and apply_edits("abc", [{"search": "ab", "replace": "x"}, {"search": "bc", "replace": "y"}])[1] == "edits overlap"
          and apply_edits("abc", [{"search": "b", "replace": "B"}])[0] == "aBc")
    check("rebase helpers: bump_version bumps the patch number from the current base with the -codeagent tag",
          bump_version('var VERSION = "1.2.3-main"; // x\nq', 'var VERSION = "1.2.3-main"; // x\nz') == 'var VERSION = "1.2.4-codeagent"; // x\nz'
          and bump_version('var VERSION = "1.2.3";\n', 'var VERSION = "9.9.9";\n') == 'var VERSION = "9.9.9";\n')
    if shutil.which("node"):
        remote, work, store = fixture()
        os.makedirs(os.path.join(work, "w"))
        src = 'var VERSION = "1.2.3-main"; // live\nexport default { fetch() { return new Response("a"); } };\n'
        for f in ("w/worker.js", "w/deployed-current.worker.js"):
            with open(os.path.join(work, f), "w") as fh:
                fh.write(src)
        _sh(work, "git", "add", "-A")
        _sh(work, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "js")
        _sh(work, "git", "push", "-q", "origin", "main")
        _sh(work, "git", "fetch", "-q", "origin", "main")
        pr = FakePR()
        stale_js = "".join("diff --git a/%s b/%s\n--- a/%s\n+++ b/%s\n@@ -1 +1 @@\n-var VERSION = \"1.2.2-old\"; // live\n+var VERSION = \"1.2.3-codeagent\"; // live\n" % (f, f, f, f)
                           for f in ("w/worker.js", "w/deployed-current.worker.js"))
        add_edits("ct_rebasejs0001", stale_js, [{"search": 'new Response("a")', "replace": 'new Response("b")'}], path="w/worker.js", mirror="w/deployed-current.worker.js")
        r = publish_all(store, work, "main", pr, quiet)
        tj = row(store, "ct_rebasejs0001")
        want = 'var VERSION = "1.2.4-codeagent"; // live\nexport default { fetch() { return new Response("b"); } };\n'
        got = [subprocess.run(["git", "--git-dir", remote, "show", "codeagent-rebasejs0001:" + f], capture_output=True, text=True).stdout for f in ("w/worker.js", "w/deployed-current.worker.js")]
        check("js rebase: VERSION bumped from the current main, the edit applied, the mirror identical, parsed and published",
              tj["status"] == "published" and got[0] == want and got[1] == want and "mirror rewritten" in json.loads(tj["ctx"]).get("rebased", ""), (dict(tj), got))
        _sh(work, "git", "checkout", "-q", "--detach", "origin/main")
        with open(os.path.join(work, "w/deployed-current.worker.js"), "w") as fh:
            fh.write(src.replace("1.2.3", "1.2.2"))
        _sh(work, "git", "add", "-A")
        _sh(work, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "mirror drift")
        _sh(work, "git", "push", "-q", "origin", "HEAD:main")
        _sh(work, "git", "fetch", "-q", "origin", "main")
        store.changes("UPDATE code_tasks SET status='merged' WHERE id='ct_rebasejs0001'")  # PUBLISH-LANE-SERIAL-1: its pull request merged, the lane is free
        add_edits("ct_rebasemir001", stale_js, [{"search": 'new Response("a")', "replace": 'new Response("c")'}], path="w/worker.js", mirror="w/deployed-current.worker.js")
        publish_all(store, work, "main", pr, quiet)
        tm = row(store, "ct_rebasemir001")
        check("js rebase: a mirror that drifted from the source on main is refused with the reason", tm["status"] == "publish_failed" and "no longer equals the source" in tm["last_error"], dict(tm))
    else:
        print("SKIP REBASE-BEFORE-PUBLISH-1 js selftest: node not installed")

    # 4. idempotency: a second run does nothing; a crashed run's existing PR is adopted, not duplicated
    remote, work, store = fixture()
    _sh(work, "git", "fetch", "-q", "origin", "main")
    pr = FakePR()
    add(store, "ct_idem00000001", good)
    publish_all(store, work, "main", pr, quiet)
    publish_all(store, work, "main", pr, quiet)
    check("second run: exactly one PR", len(pr.created) == 1 and row(store, "ct_idem00000001")["status"] == "published")
    add(store, "ct_crashed00001", good, branch="codeagent-crashed00001")
    pr.by_branch["codeagent-crashed00001"] = "https://github.com/QNFO/qnfo-workers/pull/42"
    r = publish_all(store, work, "main", pr, quiet)
    t = row(store, "ct_crashed00001")
    check("existing PR for the branch is adopted (no duplicate PR/push)", t["status"] == "published" and t["pr_url"].endswith("/pull/42") and len(pr.created) == 1, t)
    add(store, "ct_inflight0001", good, status="publishing")
    r = publish_all(store, work, "main", pr, quiet)
    check("a fresh 'publishing' claim by another run is left alone", row(store, "ct_inflight0001")["status"] == "publishing" and r["published"] == 0)
    add(store, "ct_otherrepo001", good, repo="qnfo-site")
    publish_all(store, work, "main", pr, quiet)
    check("tasks for other repos are skipped, not failed", row(store, "ct_otherrepo001")["status"] == "ready_to_publish")
    add(store, "ct_ownerslug001", good, repo="QNFO/qnfo-workers")
    add(store, "ct_ownerother01", good, repo="QNFO/qnfo-site")
    publish_all(store, work, "main", pr, quiet)
    t = row(store, "ct_ownerslug001")
    check("REPO-SLUG-PUBLISH-1: an owner-qualified QNFO/qnfo-workers row is published and its repo repaired to the bare slug",
          t["status"] == "published" and t["repo"] == REPO_NAME, dict(t))
    check("REPO-SLUG-PUBLISH-1: an owner-qualified other repo is still skipped, untouched",
          row(store, "ct_ownerother01")["status"] == "ready_to_publish" and row(store, "ct_ownerother01")["repo"] == "QNFO/qnfo-site")
    check("repo_slug strips exactly one QNFO owner segment", repo_slug("QNFO/qnfo-workers") == REPO_NAME and repo_slug("qnfo/qnfo-workers") == REPO_NAME
          and repo_slug("other/qnfo-workers") == "other/qnfo-workers" and repo_slug("QNFO/a/b") == "QNFO/a/b" and repo_slug(None) == "")
    check("a lost claim race is detected", claim(store, row(store, "ct_idem00000001")) is False)

    # 5. PR creation refused by the repo setting -> branch stays pushed, recorded as branch_pushed with a compare URL, not a failure
    remote, work, store = fixture()
    _sh(work, "git", "fetch", "-q", "origin", "main")
    pr = FakePR(refuse=True)
    add(store, "ct_nopr00000001", good)
    r = publish_all(store, work, "main", pr, quiet)
    t = row(store, "ct_nopr00000001")
    check("PR creation refused: branch_pushed with compare URL, not publish_failed",
          t["status"] == "branch_pushed" and "/compare/main...codeagent-nopr00000001" in (t["pr_url"] or "") and r["failed"] == 0, t)
    shown = subprocess.run(["git", "--git-dir", remote, "show", "codeagent-nopr00000001:scripts/x.py"], capture_output=True, text=True)
    check("PR creation refused: the branch still carries the change", shown.stdout == "def f():\n    return 2\n", shown.stderr)

    # 6. CODE-TASK-PUBLISH-NOTABLE-1: a missing code_tasks table is an empty queue; any other D1 error is still a hard failure
    class NoTable:
        def rows(self, sql, params=()):
            raise MissingTable("D1 HTTP 400: no such table: code_tasks at offset 14: SQLITE_ERROR")
        changes = rows

    class BrokenD1:
        def rows(self, sql, params=()):
            raise RuntimeError("D1 HTTP 500")
        changes = rows

    check("no code_tasks table: list_ready returns [] (nothing to publish)", list_ready(NoTable()) == [])
    remote, work, _ = fixture()
    r = publish_all(NoTable(), work, "main", FakePR(), quiet)
    check("no code_tasks table: publish_all is a clean no-op", r["published"] == 0 and r["failed"] == 0, r)
    try:
        list_ready(BrokenD1())
        check("a real D1 failure still raises", False)
    except RuntimeError as e:
        check("a real D1 failure still raises", "500" in str(e) and not isinstance(e, MissingTable), e)

    # 7. PR-OUTCOME-RECONCILE-1: merged / closed PRs are recorded; open, unknown and PR-less rows are left alone
    remote, work, store = fixture()
    pr = FakePR()
    pr.states = {"https://github.com/QNFO/qnfo-workers/pull/297": "MERGED", "https://github.com/QNFO/qnfo-workers/pull/300": "CLOSED",
                 "https://github.com/QNFO/qnfo-workers/pull/301": "OPEN", "https://github.com/QNFO/qnfo-workers/pull/302": "MERGED"}
    pr.by_branch = {"codeagent-bp": "https://github.com/QNFO/qnfo-workers/pull/302"}
    add(store, "ct_merged000001", good, status="published")
    add(store, "ct_closed000001", good, status="published")
    add(store, "ct_open00000001", good, status="published")
    add(store, "ct_gone00000001", good, status="published")
    add(store, "ct_bp0000000001", good, status="branch_pushed", branch="codeagent-bp")
    add(store, "ct_bpnopr000001", good, status="branch_pushed", branch="codeagent-none")
    add(store, "ct_needshuman01", good, status="needs_human")
    add(store, "ct_propen000001", good, status="pr_open")
    for tid, url in (("ct_merged000001", 297), ("ct_closed000001", 300), ("ct_open00000001", 301), ("ct_gone00000001", 999), ("ct_propen000001", 302)):
        store.changes("UPDATE code_tasks SET pr_url=? WHERE id=?", [f"https://github.com/QNFO/qnfo-workers/pull/{url}", tid])
    store.changes("UPDATE code_tasks SET pr_url=? WHERE id IN ('ct_bp0000000001','ct_bpnopr000001')", ["https://github.com/QNFO/qnfo-workers/compare/main...x?expand=1"])
    r = reconcile_outcomes(store, pr, quiet)
    check("a merged PR is recorded as merged", row(store, "ct_merged000001")["status"] == "merged")
    check("a closed PR is recorded as closed", row(store, "ct_closed000001")["status"] == "closed")
    check("an open PR is left published", row(store, "ct_open00000001")["status"] == "published")
    check("a failed lookup is left published and counted", row(store, "ct_gone00000001")["status"] == "published" and r["errors"] == 1, r)
    t = row(store, "ct_bp0000000001")
    check("a branch_pushed task whose PR was opened later is reconciled with that PR's URL", t["status"] == "merged" and t["pr_url"].endswith("/pull/302"), t)
    check("a branch with no PR stays branch_pushed", row(store, "ct_bpnopr000001")["status"] == "branch_pushed")
    check("the orchestrator's pr_open row is reconciled too", row(store, "ct_propen000001")["status"] == "merged")
    check("other statuses are never touched", row(store, "ct_needshuman01")["status"] == "needs_human")
    check("reconcile counts", r == {"merged": 3, "closed": 1, "open": 2, "errors": 1}, r)
    r2 = reconcile_outcomes(store, pr, quiet)
    check("reconcile is idempotent", r2["merged"] == 0 and r2["closed"] == 0, r2)

    # 7b. PUBLISH-SUITE-CHECK-1: a suite the change breaks sends feedback; one already red on the base does not
    if node_major() >= 22:
        sroot = tempfile.mkdtemp(prefix="ctp-suite-")
        _sh(sroot, "git", "init", "-q", "-b", "main")
        os.makedirs(os.path.join(sroot, "w"))
        with open(os.path.join(sroot, "w/worker.js"), "w") as fh:
            fh.write("export const v = 1;\n")
        with open(os.path.join(sroot, "w/v.test.mjs"), "w") as fh:
            fh.write("import { v } from './worker.js';\nif (v !== 1) { console.log('FAIL v is one :: ' + v); process.exit(1); }\n")
        with open(os.path.join(sroot, "w/red.test.mjs"), "w") as fh:
            fh.write("console.log('FAIL always red'); process.exit(1);\n")
        _sh(sroot, "git", "add", "-A")
        _sh(sroot, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init")
        with open(os.path.join(sroot, "w/worker.js"), "w") as fh:
            fh.write("export const v = 2;\n")
        fb = suite_check(sroot, ["w/worker.js"], "main")
        check("suite check: a suite the change breaks comes back as feedback naming it",
              fb is not None and fb.startswith("FAIL w/v.test.mjs") and "v is one" in fb and "red.test" not in fb, fb)
        check("suite check: the working tree is restored after the base run", open(os.path.join(sroot, "w/worker.js")).read() == "export const v = 2;\n")
        with open(os.path.join(sroot, "w/worker.js"), "w") as fh:
            fh.write("export const v = 1; // comment\n")
        notes = []  # PUBLISH-SELFTEST-QUIET-1: the fixture's red suite is reported to a sink, never to the Actions annotations
        check("suite check: only a suite already red on the base fails -> not blamed (None)", suite_check(sroot, ["w/worker.js"], "main", log=notes.append) is None)
        check("suite check: the red-on-base notice goes to the log sink the caller passed",
              len(notes) == 1 and notes[0].startswith("::notice::PUBLISH-SUITE-CHECK-1") and "w/red.test.mjs" in notes[0], notes)
        with mock.patch(__name__ + ".node_major", return_value=0):
            missing_node = suite_check(sroot, ["w/worker.js"], "main", log=quiet)
        check("suite check: missing Node returns feedback instead of skipping changed worker suites",
              missing_node is not None and missing_node.startswith("SUITES:") and "node 22+" in missing_node, missing_node)
        check("suite check: shared paths are left to CI", suite_check(sroot, ["scripts/x.py"], "main") is None)
    else:
        print("SKIP suite check selftest: node 22+ not installed")

    # 7b2. PUBLISH-STANDARDS-CHECK-1: a swallowed catch the edit adds comes back as feedback; an untouched worker passes
    groot = tempfile.mkdtemp(prefix="ctp-std-")
    _sh(groot, "git", "init", "-q", "-b", "main")
    os.makedirs(os.path.join(groot, "w"))
    os.makedirs(os.path.join(groot, "scripts"))
    here = os.path.dirname(os.path.abspath(__file__))
    for f in ("workers_standards_guard.py", "workers-standards-allowlist.txt"):
        if os.path.isfile(os.path.join(here, f)):
            shutil.copyfile(os.path.join(here, f), os.path.join(groot, "scripts", f))
    with open(os.path.join(groot, "w/worker.js"), "w") as fh:
        fh.write("export default { async fetch() { return new Response('ok'); } };\n")
    _sh(groot, "git", "add", "-A")
    _sh(groot, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init")
    _sh(groot, "git", "update-ref", "refs/remotes/origin/main", "HEAD")
    check("standards check: an unchanged worker passes", standards_check(groot, ["w/worker.js"], "main") is None)
    with open(os.path.join(groot, "w/worker.js"), "w") as fh:
        fh.write("export default { async fetch() { try { await fetch('https://x'); } catch (e) {} return new Response('ok'); } };\n")
    fb = standards_check(groot, ["w/worker.js"], "main")
    check("standards check: a swallowed catch the edit adds is fed back with the guard's line", fb is not None and fb.startswith("STANDARDS ") and "swallowed-catch" in fb, fb)
    check("standards check: a task with no worker or wrangler file is left to CI", standards_check(groot, ["scripts/x.py"], "main") is None)

    # 7b3. PUBLISH-DEPLOY-GATE-1: every changed worker is gated before publication; failure is returned to the proposal loop
    gate_root = tempfile.mkdtemp(prefix="ctp-gate-")
    os.makedirs(os.path.join(gate_root, "scripts"))
    for directory in ("bad", "w"):
        os.makedirs(os.path.join(gate_root, directory))
        with open(os.path.join(gate_root, directory, "wrangler.toml"), "w") as fh:
            fh.write("fail\n" if directory == "bad" else "pass\n")
    fake_gate = os.path.join(gate_root, "scripts", "deploy_gate.py")
    with open(fake_gate, "w") as fh:
        fh.write(
            "import os, sys\n"
            "worker = sys.argv[-1]\n"
            "with open(os.path.join(os.path.dirname(__file__), 'called.txt'), 'a') as calls:\n"
            "    calls.write(os.path.basename(worker) + '\\n')\n"
            "for key in ('CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CF_ACCOUNT_ID', 'GH_TOKEN', 'GITHUB_TOKEN'):\n"
            "    if os.environ.get(key):\n"
            "        print('FAIL unnecessary credential available: ' + key)\n"
            "        sys.exit(4)\n"
            "if open(os.path.join(worker, 'wrangler.toml')).read().startswith('fail'):\n"
            "    print('FAIL synthetic worker gate failure')\n"
            "    sys.exit(3)\n"
            "print('CHECK OK')\n"
        )
    changed_workers = ["bad/worker.js", "w/worker.js", "scripts/x.py", "docs/readme.md"]
    with mock.patch.dict(os.environ, {
        "CLOUDFLARE_API_TOKEN": "fixture",
        "CLOUDFLARE_ACCOUNT_ID": "fixture",
        "CF_ACCOUNT_ID": "fixture",
        "GH_TOKEN": "fixture",
        "GITHUB_TOKEN": "fixture",
    }), mock.patch("shutil.which", return_value="/usr/bin/npx"):
        fb = gate_check(gate_root, changed_workers, "main", log=quiet)
    calls_path = os.path.join(gate_root, "scripts", "called.txt")
    calls = open(calls_path).read().splitlines()
    check("deploy gate: each changed worker is checked without publisher credentials and failures return feedback",
          fb == "GATE bad: FAIL synthetic worker gate failure" and calls == ["bad", "w"], (fb, calls))
    with open(os.path.join(gate_root, "bad", "wrangler.toml"), "w") as fh:
        fh.write("pass\n")
    os.remove(calls_path)
    with mock.patch("shutil.which", return_value="/usr/bin/npx"):
        passed = gate_check(gate_root, changed_workers, "main", log=quiet)
    calls = open(calls_path).read().splitlines()
    check("deploy gate: clean changed workers pass and non-worker paths are ignored",
          passed is None and calls == ["bad", "w"] and gate_check(gate_root, ["scripts/x.py"], "main") is None, (passed, calls))
    with mock.patch("shutil.which", return_value=None):
        missing_npx = gate_check(gate_root, ["w/worker.js"], "main", log=quiet)
    check("deploy gate: missing npx returns feedback instead of skipping the check",
          missing_npx is not None and missing_npx.startswith("GATE:") and "npx is required" in missing_npx, missing_npx)
    os.rename(fake_gate, fake_gate + ".missing")
    try:
        missing_gate = gate_check(gate_root, ["w/worker.js"], "main", log=quiet)
    finally:
        os.rename(fake_gate + ".missing", fake_gate)
    check("deploy gate: missing deploy_gate.py returns feedback instead of skipping the check",
          missing_gate is not None and missing_gate.startswith("GATE:") and "deploy_gate.py is missing" in missing_gate, missing_gate)
    with mock.patch("shutil.which", return_value="/usr/bin/npx"), \
         mock.patch("subprocess.run", side_effect=subprocess.TimeoutExpired("deploy gate", GATE_TIMEOUT_S)):
        timed_out = gate_check(gate_root, ["w/worker.js"], "main", log=quiet)
    check("deploy gate: timeout returns failure feedback instead of skipping",
          timed_out is not None and timed_out.startswith("GATE w: deploy gate timed out"), timed_out)

    # 7c. a rebuild takes the patch bump even when the goal named a VERSION (the merge runner rebuilds with the same rule)
    check("bump_version takes no wanted version: the rebuild is the patch bump the merge runner expects",
          bump_version('var VERSION = "1.12.4-x";\nq', 'var VERSION = "1.12.4-x";\nz') == 'var VERSION = "1.12.5-codeagent";\nz')

    # 7d. MIRROR-CARRY-1, MULTI-FILE-CODE-TASKS-1 and VERIFY-DEFER-PUBLISHER-1
    if shutil.which("node"):
        def js_fixture():
            remote, work, store = fixture()
            os.makedirs(os.path.join(work, "w"))
            os.makedirs(os.path.join(work, "migrations"))
            src = 'var VERSION = "1.2.3-main"; // live\nexport const v = 1;\nexport default { fetch() { return new Response("a"); } };\n'
            for f in ("w/worker.js", "w/deployed-current.worker.js"):
                with open(os.path.join(work, f), "w") as fh:
                    fh.write(src)
            with open(os.path.join(work, "w/v.test.mjs"), "w") as fh:
                fh.write("import { v } from './worker.js';\nif (v !== 1) { console.log('FAIL v is one :: ' + v); process.exit(1); }\n")
            with open(os.path.join(work, "migrations/.keep"), "w") as fh:
                fh.write("")
            _sh(work, "git", "add", "-A")
            _sh(work, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "js")
            _sh(work, "git", "push", "-q", "origin", "main")
            _sh(work, "git", "fetch", "-q", "origin", "main")
            return remote, work, store

        def show(remote, ref):
            return subprocess.run(["git", "--git-dir", remote, "show", ref], capture_output=True, text=True).stdout

        src_patch = ("diff --git a/w/worker.js b/w/worker.js\n--- a/w/worker.js\n+++ b/w/worker.js\n@@ -1,3 +1,3 @@\n-var VERSION = \"1.2.3-main\"; // live\n-export const v = 1;\n"
                     "+var VERSION = \"1.2.4-codeagent\"; // live\n+export const v = 2;\n export default { fetch() { return new Response(\"a\"); } };\n")
        test_patch = ("diff --git a/w/v.test.mjs b/w/v.test.mjs\n--- a/w/v.test.mjs\n+++ b/w/v.test.mjs\n@@ -1,2 +1,2 @@\n import { v } from './worker.js';\n"
                      "-if (v !== 1) { console.log('FAIL v is one :: ' + v); process.exit(1); }\n+if (v !== 2) { console.log('FAIL v is two :: ' + v); process.exit(1); }\n")
        mig_body = "-- APPLY-BY: ci\n-- DB: qnfo-audit\n-- Rollback: SELECT 1;\nSELECT 1;\n"
        mig_patch = ("diff --git a/migrations/2026-10-12-v.sql b/migrations/2026-10-12-v.sql\nnew file mode 100644\n--- /dev/null\n+++ b/migrations/2026-10-12-v.sql\n@@ -0,0 +1,4 @@\n"
                     + "".join("+" + ln + "\n" for ln in mig_body.splitlines()))

        def add_ctx(store, tid, ctx, path="w/worker.js", age_min=0):
            store.changes("INSERT INTO code_tasks (id,repo,path,goal,status,step,ctx,branch,created_at,updated_at) VALUES (?,?,?,?,?,'done',?,?,?,?)",
                          [tid, REPO_NAME, path, "v is two", "ready_to_publish", json.dumps(ctx), "codeagent-" + tid[3:15], ago(age_min), now()])

        # a source-only patch: the mirror that equalled the source on main is carried; the suite the change breaks sends it back
        remote, work, store = js_fixture()
        pr = FakePR()
        add_ctx(store, "ct_mirrorcarry1", {"patch": src_patch.replace("export const v = 2;", "export const v = 1; // same")})
        r = publish_all(store, work, "main", pr, quiet)
        t = row(store, "ct_mirrorcarry1")
        check("mirror carry: a patch without its mirror publishes with the mirror identical to the source",
              t["status"] == "published" and show(remote, "codeagent-mirrorcarry1:w/worker.js") == show(remote, "codeagent-mirrorcarry1:w/deployed-current.worker.js")
              and "1.2.4-codeagent" in show(remote, "codeagent-mirrorcarry1:w/deployed-current.worker.js") and r.get("mirror_carried") == 1, dict(t))
        cxm = json.loads(t["ctx"])
        pm = os.path.join(tempfile.mkdtemp(prefix="ctp-carry-"), "carried.patch")
        with open(pm, "w", encoding="utf-8", newline="") as fh:
            fh.write(cxm["patch"])
        _sh(work, "git", "checkout", "-q", "--detach", "origin/main")
        chk = subprocess.run(["git", "apply", "--check", pm], cwd=work, capture_output=True, text=True)
        check("mirror carry: the parked patch now names both files, applies to main, and the task is not marked rebased",
              chk.returncode == 0 and cxm.get("mirror") == "w/deployed-current.worker.js" and "rebased" not in cxm and "MIRROR-CARRY-1" in cxm.get("mirror_carried", "")
              and sorted(set(re.findall(r"^\+\+\+ b/(.+)$", cxm["patch"], re.M))) == ["w/deployed-current.worker.js", "w/worker.js"], (chk.stderr, list(cxm)))

        # multi-file: the worker, its test and a new migration land on one branch; the suite passes because the test moved with the code
        remote, work, store = js_fixture()
        pr = FakePR()
        # PUBLISH-LANE-SERIAL-1: both tasks are in lane w; the one sent back by the suite check opens no branch, so it goes first (older)
        add_ctx(store, "ct_multibreak01", {"patch": src_patch, "paths": []}, age_min=2)
        add_ctx(store, "ct_multifile001", {"patch": src_patch + test_patch + mig_patch, "paths": ["w/v.test.mjs", "migrations/2026-10-12-v.sql"]}, age_min=1)
        r = publish_all(store, work, "main", pr, quiet)
        t, tb = row(store, "ct_multifile001"), row(store, "ct_multibreak01")
        check("multi-file: one branch carries the worker, its mirror, the test and the new migration",
              t["status"] == "published" and "v = 2" in show(remote, "codeagent-multifile001:w/worker.js") and "v is two" in show(remote, "codeagent-multifile001:w/v.test.mjs")
              and show(remote, "codeagent-multifile001:migrations/2026-10-12-v.sql") == mig_body
              and show(remote, "codeagent-multifile001:w/worker.js") == show(remote, "codeagent-multifile001:w/deployed-current.worker.js"), dict(t))
        cxf = json.loads(t["ctx"])
        check("multi-file: the carried mirror section is the worker's alone (4 files in the parked patch, each once)",
              sorted(re.findall(r"^diff --git a/(\S+) ", cxf["patch"], re.M)) == ["migrations/2026-10-12-v.sql", "w/deployed-current.worker.js", "w/v.test.mjs", "w/worker.js"], re.findall(r"^diff --git a/(\S+) ", cxf["patch"], re.M))
        check("multi-file: the same code change without its test is sent back by the suite check",
              tb["status"] == "queued" and "FAIL w/v.test.mjs" in (tb["last_error"] or ""), dict(tb))
        for tid, paths, patch in (("ct_multibad0001", ["w/worker.js"], src_patch), ("ct_multibad0002", ["w/deployed-current.worker.js"], src_patch),
                                  ("ct_multibad0003", ["scripts/x.py"], src_patch + good), ("ct_multibad0004", [".github/workflows/x.yml"], src_patch),
                                  ("ct_multibad0005", ["w/a.mjs", "w/b.mjs", "w/c.mjs", "w/d.mjs"], src_patch), ("ct_multibad0006", "w/v.test.mjs", src_patch),
                                  ("ct_multibad0007", ["w/v.test.mjs"], src_patch + good)):
            add_ctx(store, tid, {"patch": patch, "paths": paths})
        store.changes("UPDATE code_tasks SET status='merged' WHERE id='ct_multifile001'")  # its pull request merged: the lane is free for the refusals
        publish_all(store, work, "main", pr, quiet)
        bad_rows = [row(store, "ct_multibad000%d" % i) for i in range(1, 8)]
        check("multi-file: a worker source, a mirror, another directory, a denied path, too many, a non-list, and a file outside ctx.paths are all refused",
              all(b["status"] == "publish_failed" and b["last_error"] for b in bad_rows), [dict(b)["last_error"] for b in bad_rows])

        # a stale multi-file patch is rebuilt from the edits of every file
        remote, work, store = js_fixture()
        pr = FakePR()
        stale_src = src_patch.replace("1.2.3-main", "1.2.2-old").replace("1.2.4-codeagent", "1.2.3-codeagent")
        add_ctx(store, "ct_multirebase1", {"patch": stale_src + test_patch + mig_patch, "paths": ["w/v.test.mjs", "migrations/2026-10-12-v.sql"],
                                           "edits": [{"search": "export const v = 1;", "replace": "export const v = 2;"}], "mirror": "w/deployed-current.worker.js",
                                           "x": [{"path": "w/v.test.mjs", "edits": [{"search": "if (v !== 1) { console.log('FAIL v is one :: ' + v); process.exit(1); }", "replace": "if (v !== 2) { console.log('FAIL v is two :: ' + v); process.exit(1); }"}]},
                                                 {"path": "migrations/2026-10-12-v.sql", "new": True, "edits": [{"search": "", "replace": mig_body.rstrip("\n")}]}]})
        r = publish_all(store, work, "main", pr, quiet)
        t = row(store, "ct_multirebase1")
        check("multi-file rebase: every file is rebuilt on the current base (VERSION from main, test edit, new migration)",
              t["status"] == "published" and '"1.2.4-codeagent"' in show(remote, "codeagent-multirebase1:w/worker.js") and "v is two" in show(remote, "codeagent-multirebase1:w/v.test.mjs")
              and show(remote, "codeagent-multirebase1:migrations/2026-10-12-v.sql") == mig_body, dict(t))

        # the CI header check for a migration runs here when the repository has the tool; a failure goes back to propose
        remote, work, store = js_fixture()
        with open(os.path.join(work, "scripts/apply_migrations.py"), "w") as fh:
            fh.write("import sys\nprint('FAIL ' + sys.argv[-1] + ': no -- Rollback: header')\nsys.exit(1)\n")
        _sh(work, "git", "add", "-A")
        _sh(work, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "tool")
        _sh(work, "git", "push", "-q", "origin", "HEAD:main")
        _sh(work, "git", "fetch", "-q", "origin", "main")
        pr = FakePR()
        add_ctx(store, "ct_multimig0001", {"patch": src_patch + test_patch + mig_patch, "paths": ["w/v.test.mjs", "migrations/2026-10-12-v.sql"]})
        r = publish_all(store, work, "main", pr, quiet)
        t = row(store, "ct_multimig0001")
        check("multi-file: a migration the CI header check refuses is sent back with the check's words, nothing pushed",
              t["status"] == "queued" and t["step"] == "propose" and "apply_migrations.py --check" in (t["last_error"] or "") and "Rollback" in (t["last_error"] or "")
              and show(remote, "codeagent-multimig0001:w/worker.js") == "", dict(t))
        check("multi-file: the failed attempt leaves no untracked file behind", not os.path.exists(os.path.join(work, "migrations/2026-10-12-v.sql")))

        # VERIFY-DEFER-PUBLISHER-1: a deferred JavaScript verify is never pushed from a runner without node
        remote, work, store = js_fixture()
        pr = FakePR()
        add_ctx(store, "ct_deferred0001", {"patch": src_patch + test_patch, "paths": ["w/v.test.mjs"], "verify_deferred": "JavaScript verification is off"})
        real_which = shutil.which
        shutil.which = lambda name, *a, **k: None if name == "node" else real_which(name, *a, **k)
        try:
            st, url, err, _ = publish_one(row(store, "ct_deferred0001"), work, "main", pr)
        finally:
            shutil.which = real_which
        check("deferred verify: without node the task is not pushed and says why", st == "publish_failed" and "node is not installed" in (err or "") and show(remote, "codeagent-deferred0001:w/worker.js") == "", (st, err))
        r = publish_all(store, work, "main", pr, quiet)
        check("deferred verify: with node it is parsed, its suites run, and it publishes", row(store, "ct_deferred0001")["status"] == "published", dict(row(store, "ct_deferred0001")))
    else:
        print("SKIP mirror-carry / multi-file selftest: node not installed")

    # 8. CODE-TASK-MERGE-RUNNER-1: with the fleet as PR opener the branch is pushed and no PR is created here
    remote, work, store = fixture()
    _sh(work, "git", "fetch", "-q", "origin", "main")
    pr = FakePR()
    add(store, "ct_delegate0001", good)
    r = publish_all(store, work, "main", pr, quiet, delegate=True)
    t = row(store, "ct_delegate0001")
    check("delegated: branch_pushed with the compare URL, no PR created by the workflow token",
          t["status"] == "branch_pushed" and "/compare/main...codeagent-delegate0001" in (t["pr_url"] or "") and not pr.created and r["failed"] == 0 and t["last_error"] is None, t)
    shown = subprocess.run(["git", "--git-dir", remote, "show", "codeagent-delegate0001:scripts/x.py"], capture_output=True, text=True)
    check("delegated: the pushed branch carries the verified change", shown.stdout == "def f():\n    return 2\n", shown.stderr)
    add(store, "ct_delegate0002", good, branch="codeagent-delegate0002")
    pr.by_branch["codeagent-delegate0002"] = "https://github.com/QNFO/qnfo-workers/pull/77"
    publish_all(store, work, "main", pr, quiet, delegate=True)
    check("delegated: an existing PR for the branch is still adopted", row(store, "ct_delegate0002")["status"] == "published" and row(store, "ct_delegate0002")["pr_url"].endswith("/pull/77"))

    # ---- PUBLISH-LANE-SERIAL-1: one open change per lane; the next task publishes once the first has merged or closed
    check("lane_key: a worker's source and its mirror are one lane, any other file is its own",
          lane_key("qnfo-research-exec/worker.js") == lane_key("qnfo-research-exec/deployed-current.worker.js") == "qnfo-research-exec"
          and lane_key("scripts/x.py") == "scripts/x.py" and lane_key("qnfo-fleet-control/code-merge.test.mjs") == "qnfo-fleet-control/code-merge.test.mjs"
          and lane_key("a/b/worker.js") == "a/b/worker.js" and lane_key(None) == "")
    remote, work, store = fixture()
    _sh(work, "git", "fetch", "-q", "origin", "main")
    pr = FakePR()
    add(store, "ct_laneold00001", good, branch="codeagent-laneold00001", free_lane=False)
    store.changes("UPDATE code_tasks SET created_at=? WHERE id=?", [ago(2), "ct_laneold00001"])
    add(store, "ct_lanenew00001", good, branch="codeagent-lanenew00001", free_lane=False)
    store.changes("UPDATE code_tasks SET created_at=? WHERE id=?", [ago(1), "ct_lanenew00001"])
    r = publish_all(store, work, "main", pr, quiet)
    check("one lane, two ready tasks: the older publishes, the younger is held with nothing claimed or pushed",
          row(store, "ct_laneold00001")["status"] == "published" and row(store, "ct_lanenew00001")["status"] == "ready_to_publish"
          and r.get("held") == 1 and r["published"] == 1 and pr.created == ["codeagent-laneold00001"], (r, pr.created))
    r = publish_all(store, work, "main", pr, quiet)
    check("the next run holds it again while the first is still open", row(store, "ct_lanenew00001")["status"] == "ready_to_publish" and r.get("held") == 1 and r["published"] == 0, r)
    store.changes("UPDATE code_tasks SET status='merged' WHERE id='ct_laneold00001'")
    _sh(work, "git", "fetch", "-q", "origin", "main")
    r = publish_all(store, work, "main", pr, quiet)
    check("once the first has merged, the held task publishes", row(store, "ct_lanenew00001")["status"] == "published" and not r.get("held") and r["published"] == 1, r)

    remote, work, store = fixture()
    _sh(work, "git", "fetch", "-q", "origin", "main")
    pr = FakePR()
    add(store, "ct_laneclosed01", good, status="closed", branch="codeagent-laneclosed01", free_lane=False)
    add(store, "ct_lanefree0001", good, branch="codeagent-lanefree0001", free_lane=False)
    r = publish_all(store, work, "main", pr, quiet)
    check("a closed or failed predecessor does not hold the lane", row(store, "ct_lanefree0001")["status"] == "published" and not r.get("held"), r)

    remote, work, store = fixture()
    _sh(work, "git", "fetch", "-q", "origin", "main")
    pr = FakePR()
    add(store, "ct_laneopen0001", good, status="pr_open", branch="codeagent-laneopen0001", free_lane=False)
    add(store, "ct_lanewait0001", good, branch="codeagent-lanewait0001", free_lane=False)
    store.changes("UPDATE code_tasks SET path='scripts/other.py' WHERE id='ct_lanewait0001'")
    # a different lane is not held (the patch is for scripts/x.py, so it is refused by the path check, which proves the task was attempted)
    r = publish_all(store, work, "main", pr, quiet)
    check("a task in a different lane is attempted while another lane is open", not r.get("held") and row(store, "ct_lanewait0001")["status"] != "ready_to_publish", r)

    remote, work, base_store = fixture()
    _sh(work, "git", "fetch", "-q", "origin", "main")
    pr = FakePR()

    class UnreadableLanes:
        """The store, except that the in-flight read fails."""
        def __init__(self, inner):
            self.inner = inner
        def rows(self, sql, params=()):
            if "status IN ('branch_pushed','published','pr_open')" in sql and "created_at ASC" in sql and "SELECT id, path" in sql:
                raise RuntimeError("D1 HTTP 503")
            return self.inner.rows(sql, params)
        def changes(self, sql, params=()):
            return self.inner.changes(sql, params)
    add(base_store, "ct_laneread0001", good, status="published", branch="codeagent-laneread0001", free_lane=False)
    add(base_store, "ct_laneread0002", good, branch="codeagent-laneread0002", free_lane=False)
    logs = []
    r = publish_all(UnreadableLanes(base_store), work, "main", pr, logs.append)
    check("an unreadable in-flight list publishes ungated and says so, never stopping the loop",
          row(base_store, "ct_laneread0002")["status"] == "published" and not r.get("held") and any("PUBLISH-LANE-SERIAL-1" in x for x in logs), (r, logs))

    print(f"\nselftest: {len(fails)} failure(s)")
    return 1 if fails else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo-dir", default=".")
    ap.add_argument("--base", default="main")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    store = D1Store()
    delegate = os.environ.get("CODE_TASK_PR_OPENER", "").strip() == "qnfo-fleet-control"
    try:
        git(a.repo_dir, "fetch", "-q", "origin", a.base)
        # PUBLISH-LANE-SERIAL-1: outcomes first, so a pull request that merged or closed since the last run has freed its lane
        outcomes = reconcile_outcomes(store, GhPR())
        out = publish_all(store, a.repo_dir, a.base, GhPR(), delegate=delegate)
        out["outcomes"] = outcomes
    except RuntimeError as e:
        print("::error::code-task-publish could not run: " + str(e))
        return 2
    print(json.dumps(out))
    return 1 if out["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
