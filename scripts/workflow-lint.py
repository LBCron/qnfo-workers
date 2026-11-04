#!/usr/bin/env python3
"""workflow-lint.py -- WORKFLOW-YAML-LINT-1 + ARTIFACT-STAGING-1 + FAILURE-ARTIFACT-LOSS-1.

WHY THIS EXISTS
  .github/workflows/deploy-qnfo-ops.yml was pushed on 2026-09-29 at 12:35:49Z with
  an unquoted colon inside a step NAME:

      - name: Verify live VERSION equals the artifact VERSION (retry: CF /content is eventually consistent)

  `(retry: ` is a colon followed by a space inside a plain YAML scalar. Both PyYAML
  and GitHub's own parser reject it -- "mapping values are not allowed here", line 105
  column 69. GitHub therefore created every subsequent deploy-qnfo-ops run with ZERO
  jobs and conclusion=failure, so the canonical deploy path for qnfo-ops was dead while
  the live worker silently stayed behind main.

  Nothing caught it. The run produced no job, so there was no job log, so the watchdog
  had no evidence to classify and could only file it as `unknown`. A workflow that
  cannot produce a job is not a workflow, and that is checkable statically.

RULES ENFORCED (fail closed; exit 1 on any violation)
  R1 WORKFLOW-YAML-LINT-1  every .github/workflows/*.yml MUST parse as YAML and MUST
                           declare a non-empty `jobs:` mapping. An unparseable workflow
                           is a silent outage, not a warning.
  R2 ARTIFACT-STAGING-1    any workflow that WRITES a ci-status/ status artifact MUST
                           have a commit-back step that STAGES it. ci-status/*.json is
                           the only outcome channel reachable without the GitHub Actions
                           API (that API is unreachable/rate-limited from the Cloudflare
                           egress IP), so an unstaged artifact is a lost audit trail.
                           Matching is continuation-aware: `git add a \\ b \\ c` is
                           joined before matching. The first version of the external
                           scan that produced this rule did NOT join continuations and
                           raised a false positive against two workflows -- hence the
                           explicit helper below.
  R3 FAILURE-ARTIFACT-LOSS-1
                           if every step that stages the artifact also early-exits when
                           job.status != success, then a FAILED run's artifact is
                           discarded -- precisely the run whose outcome most needs
                           reading (issue 1381). Fix by splitting commit-back: persist
                           the artifact unconditionally, keep the source commit-back
                           green-only so the repo never runs ahead of live.
  R4 GHA-HARDENING-1       top-level `permissions:`, timeout-minutes on every job, and
                           no action on a Node 20 major (see NODE24_MIN_MAJOR).

Exit: 0 every workflow valid and artifact-safe
      1 at least one violation (fail closed)
      2 PyYAML unavailable (cannot lint; do not report green)
"""
from __future__ import annotations

import os
import re
import sys

try:
    import yaml
except ImportError:  # pragma: no cover
    print("workflow-lint: PyYAML missing; pip install pyyaml", file=sys.stderr)
    sys.exit(2)

ROOT = os.environ.get("WF_ROOT", ".github/workflows")

# `git add` that stages a ci-status path, or that stages everything (-A / --all / . / -u).
STAGES_CI_RE = re.compile(
    r"git add\b[^\n]*(?:ci-status|--all|\s-A(?:\s|$)|\s\.(?:\s|$)|-u(?:\s|$))"
)
WRITES_CI_RE = re.compile(r"ci-status/")
# Green-only guard: compares job.status to success and bails out.
GREEN_ONLY_RE = re.compile(r"job\.status[^\n]*!=[^\n]*success")
EXIT_RE = re.compile(r"\bexit\s+0\b")


def join_continuations(text: str) -> str:
    """Collapse backslash line-continuations so a multi-line `git add a \\ b \\ c`
    is a single logical line. Without this, path matching is wrong (see R2)."""
    return re.sub(r"\\[ \t]*\n[ \t]*", " ", text)


# BRANCH-FILTER-1 (warn-only): a workflow whose `push` trigger is not restricted to `main` but
# whose steps deploy to production or push to main runs those steps for a push to ANY branch
# that touches its trigger paths. Measured 2026-09-30: 36 of 95 push-triggered workflows, and
# run 36728140486 deployed qnfo-ops from a PR branch that had merely been updated from main.
# Not blocking yet: each affected workflow lists its own file in its trigger paths, so editing
# it re-fires it on main; fixing all 36 in one merge would launch ~35 applier runs at once.
DEPLOYS_RE = re.compile(
    r"raw_put\.py|wrangler(?:@\d+)? deploy|canonical_deploy\.py|git push origin HEAD:main"
    r"|api\.cloudflare\.com/client/v4/accounts/\S*/workers/scripts/\S*(?:content|schedules)"
)


# UNVALIDATED-BUNDLE-COMMIT-1 (warn-only): a workflow that commits worker source to main but never
# runs a syntax / import validity check first. Commits pushed by a workflow with the default
# GITHUB_TOKEN do not trigger other workflows (GitHub's documented behaviour), so the push-time
# guards (version-bump-guard, cf-import-guard) never see them: the workflow itself must validate
# before it commits. Measured 2026-09-30: fix-pilot-container-class.yml committed a bundle that
# Cloudflare rejects (error 10021) and nothing in CI saw it; 8 of 29 such workflows had no check.
COMMITS_SRC_RE = re.compile(
    r"git add[^\n]*(?:worker\.js|deployed-current\.worker\.js|qnfo-[a-z-]+/)|git add -A(?![^\n]*ci-status)"
)
PUSHES_MAIN_RE = re.compile(r"git push[^\n]*(?:HEAD:main|origin main)")
# WORKFLOW-HEADER-1 (2026-10-17): `.github/workflows/model-floor-guard.yml` was committed to main
# with two shell/paths artifact lines above `name:`. PyYAML ACCEPTS that: `C:\Users\...yml:` parses as a
# mapping key named `C`, and the duplicate key is silently overwritten (YAML does not forbid duplicates).
# GitHub's parser rejects duplicate keys, so it registered no workflow at all: every push to the file's
# triggers produced a run with ZERO jobs named after the file path, `gh workflow list` did not show it, and
# the MODEL-FLOOR-1 scan was dark for every run in that window. Same class as the reason this linter
# exists, one level lower: the file must also *look like* a workflow, not merely parse as YAML.
WORKFLOW_TOP_KEYS = {
    "name", "run-name", "on", "true", "permissions", "env", "defaults", "concurrency", "jobs",
}
TOP_KEY_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_-]*):")


def header_violations(raw: str) -> list[str]:
    """Duplicate or unknown top-level keys, and unindented lines that are not `key:` at all."""
    out: list[str] = []
    seen: dict[str, int] = {}
    for n, line in enumerate(raw.splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#") or line.strip() in ("---", "..."):
            continue
        if line[0] in " \t":  # inside a block: not a top-level key
            continue
        m = TOP_KEY_RE.match(line)
        if not m:
            out.append(
                f"line {n} is not a top-level `key:` line: {line.strip()[:80]!r} -- GitHub rejects the "
                "whole file, registers no workflow and creates runs with zero jobs"
            )
            continue
        k = m.group(1)
        if k in seen:
            out.append(
                f"duplicate top-level key `{k}` (line {n}, first at line {seen[k]}) -- PyYAML silently keeps "
                "the last, GitHub rejects the file: registers no workflow and creates runs with zero jobs"
            )
        else:
            seen[k] = n
        if k not in WORKFLOW_TOP_KEYS:
            out.append(f"unknown top-level key `{k}` at line {n} (allowed: {', '.join(sorted(WORKFLOW_TOP_KEYS))})")
    return out


VALIDATES_RE = re.compile(
    r"node --check|node -c|esbuild|wrangler[^\n]*--dry-run|cf-import-guard|d1guard-battery"
)


# PUSH-RACE-NO-RETRY-1 (warn-only): a step that pushes to main with no rebase and no retry loop. main takes a
# commit every few minutes from the fleet's own bots, so a bare `git push origin HEAD:main` loses the race
# (non-fast-forward) and the work computed in that step is silently lost. Measured 2026-09-30: findings #59,
# #61 and #123 were exactly this, each an applier whose patch never landed.
PUSH_TO_MAIN_RE = re.compile(r"git push[^\n]*(?:HEAD:main|origin main)")
# Protected = a rebase in the step, or a SHELL loop (`for|while|until ... do ... done`) that contains the push.
# The bare words for/while also appear in Python heredocs (`for k in ...`), which masked an unprotected
# push in restore-container-config-now on the first version of this rule.
PUSH_RETRY_RE = re.compile(r"rebase|(?s:\b(?:for|while|until)\b[^\n]*\n?[^\n]*\bdo\b.*?git push.*?\bdone\b)")


def unprotected_main_pushers(files: list[str]) -> list[str]:
    """Workflows with a step that pushes to main and has neither a rebase nor a retry loop in that step."""
    out: list[str] = []
    for p in files:
        try:
            with open(p, encoding="utf-8") as fh:
                doc = yaml.safe_load(fh)
            for j in (doc.get("jobs") or {}).values():
                for s in (j.get("steps") or []):
                    run = join_continuations(s.get("run") or "")
                    if PUSH_TO_MAIN_RE.search(run) and not PUSH_RETRY_RE.search(run):
                        out.append(os.path.basename(p))
                        raise StopIteration
        except StopIteration:
            continue
        except Exception:  # warn-only pass: never let it break the lint
            continue
    return out


def unvalidated_bundle_committers(files: list[str]) -> list[str]:
    out: list[str] = []
    for p in files:
        try:
            with open(p, encoding="utf-8") as fh:
                doc = yaml.safe_load(fh)
            runs = " ".join(
                (s.get("run") or "")
                for j in (doc.get("jobs") or {}).values()
                for s in (j.get("steps") or [])
            )
            runs = join_continuations(runs)
            if COMMITS_SRC_RE.search(runs) and PUSHES_MAIN_RE.search(runs) and not VALIDATES_RE.search(runs):
                out.append(os.path.basename(p))
        except Exception:  # warn-only pass: never let it break the lint
            continue
    return out


def cross_ref_cancellers(files: list[str]) -> list[str]:
    """CONCURRENCY-CROSS-REF-1 (warn-only): a workflow that runs for a push or PR on any branch,
    has a constant concurrency group (no `${{ ... }}` in it) and cancel-in-progress: true. A run
    on one ref then cancels the in-flight run on every other ref. Measured 2026-09-30:
    version-bump-guard run 36732557644 was cancelled 4 s after it started by an unrelated ref,
    leaving the `guard` check `cancelled` on a commit nothing had rejected."""
    out: list[str] = []
    for p in files:
        try:
            with open(p, encoding="utf-8") as fh:
                doc = yaml.safe_load(fh)
            c = doc.get("concurrency") if isinstance(doc, dict) else None
            if not isinstance(c, dict) or c.get("cancel-in-progress") is not True:
                continue
            if "${{" in str(c.get("group", "")):
                continue
            on = doc.get(True, doc.get("on"))
            if isinstance(on, str):
                on = {on: None}
            elif isinstance(on, list):
                on = {k: None for k in on}
            if not isinstance(on, dict):
                continue
            push = on.get("push")
            branches = push.get("branches") if isinstance(push, dict) else None
            main_only_push = "push" not in on or bool(branches and set(branches) <= {"main"})
            if "pull_request" in on or not main_only_push:
                out.append(os.path.basename(p))
        except Exception:  # warn-only pass: never let it break the lint
            continue
    return out


def unfiltered_deployers(files: list[str]) -> list[str]:
    """Workflows with a push trigger not restricted to main whose run steps deploy or push to main."""
    out: list[str] = []
    for p in files:
        try:
            with open(p, encoding="utf-8") as fh:
                doc = yaml.safe_load(fh)
            on = doc.get(True, doc.get("on")) if isinstance(doc, dict) else None
            if isinstance(on, str):
                on = {on: None}
            elif isinstance(on, list):
                on = {k: None for k in on}
            if not isinstance(on, dict) or "push" not in on:
                continue
            branches = (on["push"] or {}).get("branches")
            if branches and set(branches) <= {"main"}:
                continue
            # A step (or job) guarded by `if: ... refs/heads/main ...` only runs on main, so it is not the
            # hazard this rule is about (dup-worker-name-gate's commit-back is such a step).
            def _main_only(node) -> bool:
                return "refs/heads/main" in str((node or {}).get("if") or "")

            runs = " ".join(
                (s.get("run") or "")
                for j in (doc.get("jobs") or {}).values()
                if not _main_only(j)
                for s in (j.get("steps") or [])
                if not _main_only(s)
            )
            if DEPLOYS_RE.search(join_continuations(runs)):
                out.append(os.path.basename(p))
        except Exception:  # warn-only pass: never let it break the lint
            continue
    return out


# GHA-HARDENING-1 (R4, blocking; GHA-AUDIT-1 2026-10-13). Three properties every workflow keeps:
#   * no action pinned to a Node 20 major: GitHub deprecated Node 20 on runners (changelog 2025-09-19) and force-runs those
#     actions on Node 24 with a warning on every job; the lowest Node 24 major of each action the fleet uses is below;
#   * every job declares timeout-minutes (the default is 360 minutes, so one hung step holds a runner slot for six hours
#     while the fleet's own bots push to main every few minutes);
#   * the workflow declares a top-level `permissions:` block (without it the token gets the repository default).
NODE24_MIN_MAJOR = {
    "actions/checkout": 5,
    "actions/setup-python": 6,
    "actions/setup-node": 5,
    "actions/upload-artifact": 6,
    "actions/download-artifact": 6,
    "actions/cache": 5,
    "peter-evans/create-pull-request": 8,
    "cloudflare/wrangler-action": 4,
}
#   * ACTIONS-PIN-1 (2026-10-13): every action is pinned to a full commit SHA with a "# vN" comment naming its major
#     (`actions/checkout@<40 hex> # v6`). A tag can be moved to new code; a SHA cannot. .github/dependabot.yml moves the
#     SHA and the comment together, and the Node 20 check above reads the major from the comment. Local actions
#     (`./path`) and docker:// references are exempt.
USES_LINE_RE = re.compile(r"^\s*-?\s*uses:\s*['\"]?([^\s'\"#]+)['\"]?[ \t]*(?:#[ \t]*v(\d+)\b)?", re.M)
SHA_RE = re.compile(r"^[0-9a-f]{40}$")


def _action_repo(ref: str) -> str:
    """owner/repo of an action reference (github/codeql-action/init -> github/codeql-action)."""
    return "/".join(ref.split("/")[:2])


def hardening_violations(doc: dict, text: str = "") -> list[str]:
    out: list[str] = []
    if "permissions" not in doc:
        out.append("no top-level `permissions:` block (declare the least the token needs, e.g. contents: read)")
    # Each `uses:` line in file order, with the major its comment names (None without one). Steps are matched to lines one
    # occurrence at a time, so the same SHA written once with and once without a comment is judged per line.
    lines = [(m.group(1), int(m.group(2)) if m.group(2) else None) for m in USES_LINE_RE.finditer(text)]
    for name, job in (doc.get("jobs") or {}).items():
        if not isinstance(job, dict):
            continue
        if "uses" not in job and "timeout-minutes" not in job:
            out.append(f"job `{name}` has no timeout-minutes (default 360)")
        for step in job.get("steps") or []:
            uses = str((step or {}).get("uses") or "") if isinstance(step, dict) else ""
            if not uses or uses.startswith("./") or uses.startswith("docker://"):
                continue
            ref, _, at = uses.partition("@")
            idx = next((i for i, (u, _) in enumerate(lines) if u == uses), None)
            major = lines.pop(idx)[1] if idx is not None else None
            if not SHA_RE.match(at) or major is None:
                out.append(f"job `{name}` uses {uses} unpinned (ACTIONS-PIN-1: pin a 40-hex commit SHA with a `# vN` comment)")
                continue
            repo = _action_repo(ref)
            if repo in NODE24_MIN_MAJOR and major < NODE24_MIN_MAJOR[repo]:
                out.append(f"job `{name}` uses {repo} v{major} (Node 20; use v{NODE24_MIN_MAJOR[repo]} or later)")
    return out


def run_blocks(doc: dict) -> list[str]:
    out: list[str] = []
    jobs = doc.get("jobs")
    if not isinstance(jobs, dict):
        return out
    for job in jobs.values():
        if not isinstance(job, dict):
            continue
        steps = job.get("steps")
        if not isinstance(steps, list):
            continue
        for step in steps:
            if isinstance(step, dict) and isinstance(step.get("run"), str):
                out.append(join_continuations(step["run"]))
    return out


def main() -> int:
    if not os.path.isdir(ROOT):
        print(f"workflow-lint: no {ROOT} directory; nothing to lint")
        return 0

    files = sorted(
        os.path.join(ROOT, f) for f in os.listdir(ROOT) if f.endswith((".yml", ".yaml"))
    )
    bad: list[str] = []

    for p in files:
        try:
            with open(p, encoding="utf-8") as fh:
                doc = yaml.safe_load(fh)
        except yaml.YAMLError as e:
            mark = getattr(e, "problem_mark", None)
            loc = f"line {mark.line + 1} column {mark.column + 1}" if mark else "unknown location"
            prob = getattr(e, "problem", None) or str(e).splitlines()[0]
            bad.append(f"{p}: YAML PARSE ERROR at {loc}: {prob}")
            print(f"BROKEN {p}: {prob} ({loc})")
            continue

        if not isinstance(doc, dict):
            bad.append(f"{p}: top level is not a mapping")
            print(f"BROKEN {p}: top level is not a mapping")
            continue

        with open(p, encoding="utf-8") as fh:
            header = fh.read()
        hbad = header_violations(header)
        if hbad:
            for h in hbad:
                bad.append(f"{p}: WORKFLOW-HEADER-1 -- {h}")
            print(f"BROKEN {p}: WORKFLOW-HEADER-1 ({len(hbad)} finding(s))")
            continue

        jobs = doc.get("jobs")
        if not isinstance(jobs, dict) or not jobs:
            bad.append(
                f"{p}: no `jobs:` mapping -- GitHub would create a run with ZERO jobs "
                "and conclusion=failure"
            )
            print(f"BROKEN {p}: no jobs")
            continue

        blocks = run_blocks(doc)
        writes_ci = any(WRITES_CI_RE.search(b) for b in blocks)
        staging = [b for b in blocks if STAGES_CI_RE.search(b)]

        notes: list[str] = []

        if writes_ci and not staging:
            bad.append(
                f"{p}: ARTIFACT-STAGING-1 -- writes a ci-status/ status artifact but no "
                "step stages it (add `git add ci-status/<name>.json` to commit-back)"
            )
            print(f"BROKEN {p}: writes ci-status but never stages it")
            continue

        if writes_ci and staging:
            guarded = [b for b in staging if GREEN_ONLY_RE.search(b) and EXIT_RE.search(b)]
            if len(guarded) == len(staging):
                bad.append(
                    f"{p}: FAILURE-ARTIFACT-LOSS-1 -- every step that stages ci-status also "
                    "early-exits when job.status != success, so a FAILED run's artifact is "
                    "never persisted (split commit-back: artifact always, source green-only)"
                )
                print(f"BROKEN {p}: failure-run artifact would be discarded")
                continue
            notes.append("ci-status staged")

        with open(p, encoding="utf-8") as fh:
            raw = fh.read()
        hard = hardening_violations(doc, raw)
        if hard:
            for h in hard:
                bad.append(f"{p}: GHA-HARDENING-1 -- {h}")
            print(f"BROKEN {p}: GHA-HARDENING-1 ({len(hard)} finding(s))")
            continue

        print(f"OK     {p} jobs={sorted(jobs)}" + (f" [{'; '.join(notes)}]" if notes else ""))

    print()
    risky = unfiltered_deployers(files)
    if risky:
        print(f"WARN BRANCH-FILTER-1: {len(risky)} workflow(s) deploy or push to main but their push trigger "
              "is not restricted to `main` (a push to any branch touching their paths runs them):")
        for name in risky:
            print(f"  WARN {name}")
        print()
    unval = unvalidated_bundle_committers(files)
    if unval:
        print(f"WARN UNVALIDATED-BUNDLE-COMMIT-1: {len(unval)} workflow(s) commit worker source to main without a "
              "syntax/import check (pushes made with the default GITHUB_TOKEN do not trigger the guard workflows, "
              "so validate before committing):")
        for name in unval:
            print(f"  WARN {name}")
        print()
    xref = cross_ref_cancellers(files)
    if xref:
        print(f"WARN CONCURRENCY-CROSS-REF-1: {len(xref)} workflow(s) run for any ref with a constant concurrency "
              "group and cancel-in-progress: true (a run on one ref cancels the in-flight run on every other ref; "
              "put ${{ github.ref }} in the group):")
        for name in xref:
            print(f"  WARN {name}")
        print()
    nopush = unprotected_main_pushers(files)
    if nopush:
        print(f"WARN PUSH-RACE-NO-RETRY-1: {len(nopush)} workflow(s) push to main in a step with no rebase and no retry "
              "loop (main moves every few minutes; a bare push loses the race and the work is lost):")
        for name in nopush:
            print(f"  WARN {name}")
        print()
    # TWO-PR-WORKFLOWS-1 (2026-11-04, owner directive: a pull request starts at most two workflows): pr-checks and pr-lane are the only files
    # that may trigger on pull_request or pull_request_target. A new guard is a `workflow_call` job in pr-checks.
    allowed_pr = {"pr-checks.yml", "pr-lane.yml"}
    for p in files:
        try:
            with open(p, encoding="utf-8") as fh:
                d = yaml.safe_load(fh)
        except yaml.YAMLError:
            continue
        on = (d.get(True, d.get("on")) if isinstance(d, dict) else None)
        evs = on if isinstance(on, (dict, list)) else [on]
        if os.path.basename(p) not in allowed_pr and any(e in ("pull_request", "pull_request_target") for e in evs):
            bad.append(f"{p}: TWO-PR-WORKFLOWS-1 -- triggers on a pull request; call it from pr-checks.yml with workflow_call instead")
    # PR-CHECK-CAP-5-1 (2026-11-04, owner directive: a pull request shows at most five checks, never 23): every job of pr-checks.yml and pr-lane.yml is one entry on the
    # pull request, a skipped one included, and every job of a reusable workflow it calls is one more. Cloudflare's "Workers Builds" is the fifth entry, so the two files hold at
    # most four jobs between them and none calls a reusable workflow. A new guard is a step in `versions`, `scans` or `suites`, never a job.
    pr_jobs = 0
    for p in files:
        if os.path.basename(p) not in allowed_pr:
            continue
        try:
            with open(p, encoding="utf-8") as fh:
                d = yaml.safe_load(fh)
        except yaml.YAMLError:
            continue
        jobs = (d.get("jobs") or {}) if isinstance(d, dict) else {}
        pr_jobs += len(jobs)
        for jn, jv in jobs.items():
            if isinstance(jv, dict) and "uses" in jv:
                bad.append(f"{p}: PR-CHECK-CAP-5-1 -- job `{jn}` calls a reusable workflow, which adds one pull request check per called job (and per skipped one); inline its steps")
    if pr_jobs > 4:
        bad.append(f"pr-checks.yml and pr-lane.yml: PR-CHECK-CAP-5-1 -- {pr_jobs} jobs; a pull request may show at most 5 checks (Workers Builds plus 4 jobs)")
    if bad:
        print(f"=== WORKFLOW-LINT FAILED: {len(bad)} invalid workflow file(s) ===")
        for b in bad:
            print("  " + b)
        return 1

    print(f"=== WORKFLOW-LINT PASSED: {len(files)} workflow file(s) valid ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
