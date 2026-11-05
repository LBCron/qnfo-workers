#!/usr/bin/env python3
"""pr_fast_guards.py -- PR-FAST-GUARDS-1 (charter pillar: autonomy; PR velocity and a green main).

WHY   The checks that turned main red after a merge were all cheap and deterministic, and none of them could fail a pull request:
      deploy-gate is advisory on a pull request (MERGE-STREAMLINE-1) and its push-to-main run is cancelled by the next merge
      (35 of 37 sampled runs on 2026-11-04, PUSH-COALESCE-1). Named in CLAUDE.md after each broke main more than once
      (RED-MAIN-RECURRENCE-1): narrative-prompt-guard (about 10 s), the metric-cause rule (2 s), the code-anchor-once rule (28 s), and the
      load of every worker entry (3 s; a relative import or a top-level throw is a deploy failure the syntax check accepts).
WHAT   Runs the guards that apply to the files the pull request changes, in parallel, each through scripts/regression_gate.py: a guard
      fails the pull request only for a failure line the base tree does not have, so a defect already on main never holds an
      unrelated pull request (REGRESSION-GATE-1). pr-checks.yml runs this as the strict `fast-guards` job; the merge lane reads every
      non-slow check, so a failure blocks the merge before it happens instead of turning main red after.
APPLIES  narrative-prompt-guard   a worker.js, a mirror, or the guard itself      worker-load-gate   a worker.js, a mirror, _shared or the gate
         metric-cause             migrations/                                      code-anchor-once   migrations/ or a worker.js (it reads the anchored files)
         kaizen-gates             a worker.js, a wrangler.toml, the prompt-store scripts, or an enforcer file (scripts/kaizen_gates.py; RM-KAIZEN-GATE-CANDIDATES-1)
         d1-like-limit            any .sql, .js, .mjs or .py file (diff-only: a LIKE or GLOB pattern literal over 50 bytes that the change adds; D1 refuses it)
         dependency-allowlist     a package.json, a lock file, a workflow or scripts/dependency-allowlist.txt (BP26-AGENT-CHANGE-GATES-1)
         suite-regressions        the suites the change selects (scripts/run-suites.mjs); any change outside docs, ci-status and audits.
                                  The post-merge full-set run of deploy-gate was red in the 6 of 6 failed push runs sampled on 2026-11-04 (9 failing suites each).
USAGE  python3 scripts/pr_fast_guards.py [--base REF] [--all] [--with-suites] [--jobs N] [--list]
EXIT   0 every applicable guard passed or failed only as the base already does; 1 when any guard is blocked.
"""
import os
import re
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import regression_gate  # noqa: E402

WORKER = re.compile(r"^[^/]+/(worker\.js|deployed-current\.worker\.js)$")


def any_match(files, *patterns):
    return any(re.search(p, f) for f in files for p in patterns)


def suites_cmd(files):
    """The suites the change selects (scripts/run-suites.mjs): the same changed-directory list deploy-gate builds, "." marking a root file."""
    dirs = sorted({f.split("/")[0] for f in files if "/" in f})
    dirs += sorted({"." for f in files if "/" not in f and not re.search(r"(\.md|\.cff)$|^LICENSE$|^codemeta\.json$", f)})
    fd, path = tempfile.mkstemp(prefix="changed-suites-", suffix=".txt")
    with os.fdopen(fd, "w") as fh:
        fh.write("\n".join(dirs) + "\n")
    return ["node", "scripts/run-suites.mjs", "--changed-file", path, "--jobs", "4", "--timeout", "180"]


# (name, applies(files), command or command(files), failure-line pattern for scripts/regression_gate.py or None for its default)
# suite-regressions compares per-suite result lines only ("FAIL <ms> <suite>"): a suite that is red on the base too, and the count lines of the runner, never block.
GUARDS = [
    ("narrative-prompt-guard", lambda f: any_match(f, WORKER.pattern, r"^scripts/narrative-prompt-guard\.py$"),
     ["python3", "scripts/narrative-prompt-guard.py"], None),
    ("worker-load-gate", lambda f: any_match(f, WORKER.pattern, r"^_shared/", r"^scripts/worker-load-gate\.mjs$"),
     ["node", "scripts/worker-load-gate.mjs"], None),
    ("metric-cause", lambda f: any_match(f, r"^migrations/"),
     ["node", "migrations/metric-family-cluster-b.test.mjs"], None),
    ("code-anchor-once", lambda f: any_match(f, r"^migrations/", WORKER.pattern),
     ["node", "migrations/code-anchor-once.test.mjs"], None),
    # D1-LIKE-LIMIT-GUARD-1 (PAPER-LEARN-1 learning 5677, agent_issues 1000871): D1 refuses a LIKE or GLOB pattern over 50 bytes, so a probe or query that adds one errors on every run. The same defect was fixed one file
    # at a time on 2026-10-13 and again in PRs 7277, 7281, 7282 and 7283 on 2026-11-04. Diff-only like workers-standards-guard: it judges only what the change ADDS (about 1 s), so existing patterns never block a change.
    ("d1-like-limit", lambda f: any_match(f, r"\.(sql|js|mjs|py)$"),
     ["python3", "scripts/d1_like_limit_guard.py"], r"violation\(s\) added|^\S+:\d+ \[[a-z0-9-]+\]|failing closed|cannot read the diff"),
    # WORKERS-STANDARDS-GUARD-1 on the pull request (DEFAULT-APPROVE-1, agent_issues 1000657, owner card 200; owner directive 2026-10-19: reversible decisions take the recommended
    # option): the diff-only Workers anti-pattern guard (about 15 s) is the ONE deploy-gate step that blocks a pull request. It judges only what the change ADDS, so existing debt never
    # blocks an unrelated pull request, and the base tree (which adds nothing) passes it. The rest of deploy-gate stays advisory (MERGE-STREAMLINE-1). GUARD_BASE (set in main) is its base.
    ("workers-standards-guard", lambda f: any_match(f, r"^[^/]+/worker\.js$", r"^[^/]+/wrangler\.(toml|jsonc)$", r"^scripts/[^/]+\.py$", r"^scripts/workers-standards-allowlist\.txt$"),
     ["python3", "scripts/workers_standards_guard.py"], r"violation\(s\) added|^\S+:\d+ \[[a-z0-9-]+\]|failing closed|cannot read the diff"),
    ("kaizen-gates", lambda f: any_match(f, WORKER.pattern, r"(^|/)wrangler\.toml$", r"^docs/ops-governance/scripts/", r"^qnfo-fleet-dashboard/probes\.json$",
                                         r"^\.github/workflows/(canonical-deploy|fleet-autodeploy)\.yml$",
                                         r"^scripts/(kaizen_gates|pr_fast_guards|cost_ledger|fleet-autoaudit|deploy-drift-guard|mirror-guard)\.py$",
                                         r"^scripts/ux-journeys/apps/fleet\.journeys\.mjs$"),
     ["python3", "scripts/kaizen_gates.py"], None),
    # DEPENDENCY-ALLOWLIST-1 (BP26-AGENT-CHANGE-GATES-1, roadmap row 1414, OWASP ASI04): a dependency, an install script or an unpinned install in a workflow is declared in
    # scripts/dependency-allowlist.txt, with a reason, in the same change. Regression-only: a violation the base tree already has never holds an unrelated pull request.
    ("dependency-allowlist", lambda f: any_match(f, r"(^|/)package(-lock)?\.json$", r"^\.github/workflows/[^/]+\.ya?ml$", r"^scripts/dependency[-_]allowlist\.(py|txt)$"),
     ["python3", "scripts/dependency_allowlist.py"], r"^VIOLATION "),
    ("suite-regressions", lambda f: any(not f_.startswith(("docs/", "ci-status/", "audits/")) for f_ in f),
     suites_cmd, r"^FAIL\s+<t>\s+\S+$|expired|malformed"),
]


def changed_files(base):
    p = subprocess.run(["git", "diff", "--name-only", base, "HEAD"], cwd=ROOT, capture_output=True, text=True)
    return p.stdout.split() if p.returncode == 0 else None


def run_guard(name, cmd, base, pattern=None):
    cmd = [sys.executable if c == "python3" else c for c in cmd]
    gate = [sys.executable, os.path.join(HERE, "regression_gate.py"), "--name", name]
    if base:
        gate += ["--base", base]
    if pattern:
        gate += ["--pattern", pattern]
    p = subprocess.run(gate + ["--"] + cmd, cwd=ROOT, capture_output=True, text=True, errors="replace")
    return name, p.returncode, (p.stdout or "") + (p.stderr or "")


def main(argv):
    base = next((argv[i + 1] for i, a in enumerate(argv[:-1]) if a == "--base"), None) or regression_gate.default_base(ROOT)
    jobs = int(next((argv[i + 1] for i, a in enumerate(argv[:-1]) if a == "--jobs"), "4"))
    files = changed_files(base) if base else None
    if base:
        os.environ["GUARD_BASE"] = base  # the diff-only guards (workers-standards-guard) compare with the same base the regression gate uses
    if files is None and "--all" not in argv:
        print("::error title=fast-guards::cannot compute the changed files against %r; running every guard" % base)
    run_all = "--all" in argv or files is None
    # suite-regressions takes minutes (the owner caps a PR check at about a minute, PR-CHECK-CAP-5-1), so it runs only with --with-suites (a session before a large change, or a future queue run)
    chosen = [(n, c, pat) for n, when, c, pat in GUARDS if (n != "suite-regressions" or "--with-suites" in argv) and (run_all or when(files))]
    if "--list" in argv:
        for n, _, _ in chosen:
            print(n)
        return 0
    if not chosen:
        print("PR-FAST-GUARDS: no applicable guard for %d changed file(s)" % len(files or []))
        return 0
    print("PR-FAST-GUARDS: base %s; running %s" % (base, ", ".join(n for n, _, _ in chosen)))
    chosen = [(n, c(files or []) if callable(c) else c, pat) for n, c, pat in chosen]
    # the cheap guards run side by side; the suites (4 workers of their own, timeouts of 180 s) run alone after them, so a loaded runner cannot time one out and look like a regression
    light = [g for g in chosen if g[0] != "suite-regressions"]
    heavy = [g for g in chosen if g[0] == "suite-regressions"]
    with ThreadPoolExecutor(max_workers=max(1, jobs)) as ex:
        results = list(ex.map(lambda g: run_guard(g[0], g[1], base, g[2]), light))
    results += [run_guard(g[0], g[1], base, g[2]) for g in heavy]
    blocked = []
    for name, rc, out in results:
        print("::group::%s (exit %d)" % (name, rc))
        print(out.rstrip())
        print("::endgroup::")
        if rc != 0:
            blocked.append(name)
    print("PR-FAST-GUARDS: %d guard(s), %d blocked%s" % (len(results), len(blocked), (": " + ", ".join(blocked)) if blocked else ""))
    return 1 if blocked else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
