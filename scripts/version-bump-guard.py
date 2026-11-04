#!/usr/bin/env python3
"""version-bump-guard.py - VERSION-BUMP-GUARD-1 (2026-09-29, issue 1371).

WHY THIS EXISTS
  Three independent mechanisms decide whether a worker fix reaches live:
    * scripts/fleet-autoaudit.py --apply  -> redeploys only workers STRICTLY AHEAD by
      NUMERIC version comparison;
    * .github/workflows/deploy-drift.yml  -> compares VERSION strings;
    * scripts/mirror-guard.py             -> compares source vs its deployed mirror.
  A worker fix committed WITHOUT bumping the `var VERSION = "..."` constant is invisible to
  ALL THREE. Repo and live report the SAME version, so nothing is "ahead", nothing is
  "drifted", and the fix never reaches live - while every check stays green. That is a silent
  never-deploys class, and it is not hypothetical:

    LIVE INSTANCE OF THE CLASS (verified 2026-09-29)
      qnfo-backlog-exec HEALTH-PROBE-BUDGET-1 (#1368) - repo qnfo-backlog-exec/worker.js is
      33,159 bytes, the live script is 33,161 bytes, and BOTH report
      VERSION 2.0.0-full-register-inventory. Version comparison sees parity; the auto-deployer
      sees "not strictly ahead"; so the committed fix is structurally undeployable.

    SECOND LIVE INSTANCE (verified 2026-09-29)
      worker_live_audit (the fleet self-audit table) still records qnfo-ops as
      2.37.14-callglm-reasoning while live is 2.37.20-selfheal-analyzer-live - a six-version
      lag - because the audit writer had no scheduled writer and the ledger/audit comparisons
      built on it returned false verdicts.

WHAT IT DOES
  For every worker entry bundle that CHANGED between two refs, extract the VERSION constant on
  both sides. If the bundle bytes changed but VERSION did not, exit 1 and name the worker.

  Formatting-only changes are reported too, deliberately, except for adding or removing one
  optional final LF: it cannot change the deployed JavaScript and is not a worker fix.

  VERSION-AHEAD-1 (2026-10-02, WORK-CLAIM-1): when both sides carry a numeric core
  ("<v?>1.18.5-suffix"), the new core must be STRICTLY AHEAD of the base's. A changed string is
  not enough: on 2026-10-02 five PRs claimed qnfo-fleet-dashboard 1.17.2, 1.17.3, 1.17.8 and
  1.18.x twice each, and a collision resolved by keeping "1.17.2-b" over main's "1.17.2-a"
  passes a string-change check while qnfo-fleet-control/version-compare.mjs rule 5 ranks equal
  cores with different suffixes UNORDERABLE (the drift redeployer never acts on them) and the
  deployment_history monotonic trigger refuses a lower version. On a pull request the base is
  the merge-base with the base branch tip, so this compares against what main holds NOW: a PR
  that kept a number another PR already merged goes red. Versions without a numeric core are
  not ordered (the string-change rule still applies). Measured over the 343 bundle bumps on
  main from 2026-09-30 12:00 to 2026-10-02: 339 strictly ahead, 0 behind, 4 equal-core
  (qnfo-fleet-control 0.4.39-selfstate-obs1..4, which the comparator could never order).

  VERSION-RE-ANCHOR-1 (2026-10-20, PR-GUARD-FIXES-1, agent_issues 100295): the constant is READ from a declaration that starts
  a line. The first revision searched the whole text for `var VERSION = "..."` and took the first hit anywhere, so a comment that
  quotes the form (qnfo-model-eval/worker.js line 50, "requires the literal `var VERSION = "..."` form") became the VERSION: both
  sides read the placeholder "...", the guard said "unchanged VERSION after a byte change" about two real bumps (1.2.0 -> 1.3.0 and
  1.3.0 -> 1.4.0; push runs 39126065745 and 39126418865, PR runs 39125992400 and 39126349048), and qnfo-ops wrote version_id '...'
  into three deployment_history rows. VERSION_RE now starts at the beginning of a line (re.M), allows indentation, then the
  declaration, so a comment line (starting with a double slash, a star or a slash-star) never matches;
  scripts/version-bump-guard.test.mjs replays the case and checks that every worker bundle and mirror on main reads the same
  VERSION as before.

USAGE
  python3 scripts/version-bump-guard.py <base_ref> <head_ref>
  python3 scripts/version-bump-guard.py                 # falls back to HEAD~1..HEAD

EXIT
  0  nothing to check, or every changed bundle bumped VERSION
  1  at least one changed bundle kept its VERSION   (the defect)
  3  cannot evaluate (bad ref, git unavailable, unreadable blob) - fail-closed, never green

ADVERSARIAL
  This guard proves only that a VERSION STRING changed alongside the bytes. It cannot prove the
  change is correct, that the version was bumped in the right direction, or that the worker
  deploys. A worker can be bumped and still never reach live; that is deploy-drift.yml's job.
"""
import os
import re
import subprocess
import sys

VERSION_RE = re.compile(r'^[ \t]*var\s+VERSION\s*=\s*"([^"\n]*)"', re.M)
# VERSION-LINE-NOTES-1: what follows the closing quote of the first VERSION declaration (a long trailing comment is a release note on the line every release rewrites)
VERSION_TAIL_RE = re.compile(r'^[ \t]*var\s+VERSION\s*=\s*"[^"\n]*"([^\n]*)$', re.M)
NOTE_ON_LINE_CHARS = 80
ENTRY_RE = re.compile(r'^(?P<dir>[^/]+)/worker\.js$')
# Files that are copies/mirrors, not deploy sources.
SKIP_SUFFIXES = ("deployed-current.worker.js",)


def git(*args):
    """Run git, return (ok, stdout). Never raises."""
    try:
        p = subprocess.run(
            ["git"] + list(args),
            capture_output=True,
            text=True,
            timeout=120,
        )
    except Exception as exc:  # noqa: BLE001 - any failure is fail-closed
        return False, "git invocation failed: %s" % exc
    if p.returncode != 0:
        return False, (p.stderr or "").strip()
    return True, p.stdout


def rev_exists(ref):
    ok, _ = git("rev-parse", "--verify", "--quiet", ref + "^{commit}")
    return ok


def blob(ref, path):
    ok, out = git("show", "%s:%s" % (ref, path))
    return (ok, out)


def version_of(text):
    m = VERSION_RE.search(text)
    return m.group(1) if m else None


CORE_RE = re.compile(r'^(\d+(?:\.\d+)*)(.*)$')


def numeric_core(v):
    """'<v?><dotted numeric core><suffix>' -> list of ints, or None (parse rules of version-compare.mjs)."""
    if v is None:
        return None
    m = CORE_RE.match(re.sub(r'^[vV]', '', v.strip()))
    return [int(x) for x in m.group(1).split('.')] if m else None


def core_order(old, new):
    """-1 when new's numeric core is ahead, 0 equal, 1 behind; None when either side has no numeric core."""
    a, b = numeric_core(old), numeric_core(new)
    if a is None or b is None:
        return None
    n = max(len(a), len(b))
    a, b = a + [0] * (n - len(a)), b + [0] * (n - len(b))
    return 0 if a == b else (-1 if a < b else 1)


def main(argv):
    base = argv[1] if len(argv) > 1 else None
    head = argv[2] if len(argv) > 2 else None

    if base in (None, "", "0000000000000000000000000000000000000000"):
        base = "HEAD~1"
    if not head:
        head = "HEAD"

    for ref in (base, head):
        if not rev_exists(ref):
            print("FAIL-CLOSED: cannot resolve ref %r (shallow clone? fetch-depth: 0 required)" % ref)
            return 3

    ok, out = git("diff", "--name-only", base, head)
    if not ok:
        print("FAIL-CLOSED: git diff %s %s failed: %s" % (base, head, out))
        return 3

    candidates = []
    for line in out.splitlines():
        path = line.strip()
        if not path or path.endswith(SKIP_SUFFIXES):
            continue
        if ENTRY_RE.match(path):
            candidates.append(path)

    if not candidates:
        print("no worker entry bundles changed between %s and %s - nothing to check" % (base, head))
        return 0

    violations = []
    bumped = []
    notes_on_line = []
    checked = 0

    for path in sorted(candidates):
        ok_old, old = blob(base, path)
        if not ok_old:
            # Added in this range: no previous VERSION to compare against.
            old = ""
        ok_new, new = blob(head, path)
        if not ok_new:
            print("FAIL-CLOSED: cannot read %s at %s: %s" % (path, head, new))
            return 3

        if old == new or old.removesuffix("\n") == new.removesuffix("\n"):
            continue  # identical bytes or an optional final LF change - not a worker code change

        checked += 1
        v_old, v_new = version_of(old), version_of(new)

        if v_new is None:
            violations.append((path, v_old, "NO VERSION CONSTANT in the new bundle"))
            continue
        if v_old == v_new:
            violations.append((path, v_old, "unchanged VERSION after a byte change"))
            continue
        order = core_order(v_old, v_new) if ok_old else None
        if order == 0:
            violations.append((path, v_old, "VERSION-AHEAD-1: %s keeps the base's numeric core (equal cores with "
                               "different suffixes are unorderable; this is a version collision). Take a number above "
                               "the highest one main and the open PRs claim (CLAUDE.md, Work claims)" % v_new))
            continue
        if order == 1:
            violations.append((path, v_old, "VERSION-AHEAD-1: %s is behind the base's %s (the version regresses)" % (v_new, v_old)))
            continue
        bumped.append((path, v_old, v_new))
        t_old, t_new = VERSION_TAIL_RE.search(old), VERSION_TAIL_RE.search(new)
        t_old, t_new = (t_old.group(1).strip() if t_old else ""), (t_new.group(1).strip() if t_new else "")
        if len(t_new) > NOTE_ON_LINE_CHARS and t_new != t_old:
            notes_on_line.append((path, len(t_new)))

    for path, v_old, v_new in bumped:
        print("OK    %s  %s -> %s" % (path, v_old, v_new))

    # VERSION-LINE-NOTES-1 (RELEASE-FRAGMENT-1, 2026-11-04): 34 of the 44 worker bumps in the last 100 merged pull requests wrote the release note onto the VERSION line, so
    # every pull request that bumps that worker rewrites the same long line (qnfo-fleet-control: 32 KB) and two of them always conflict, in the source and again in the mirror.
    # Advisory by default; VERSION_LINE_NOTES=fail makes it a violation once the habit has moved. `python scripts/worker_release.py bump <worker> --note ...` does the bump with
    # a bare VERSION line and the note in <worker>/releases/<version>.md.
    for path, n in notes_on_line:
        print("::warning title=version-line-notes::%s: a %d-character release note on the VERSION line is what makes concurrent bumps of this worker conflict. "
              "Write the note to %s/releases/<version>.md (python scripts/worker_release.py bump %s --note ...) and keep the line bare." % (path, n, path.split("/")[0], path.split("/")[0]))
        if os.environ.get("VERSION_LINE_NOTES", "").strip().lower() == "fail":
            violations.append((path, None, "VERSION-LINE-NOTES-1: a %d-character release note was written on the VERSION line (VERSION_LINE_NOTES=fail)" % n))

    if not violations:
        print("PASS: %d changed worker bundle(s) checked, all bumped VERSION" % checked)
        return 0

    print("")
    print("VERSION-BUMP-GUARD-1 VIOLATION (%d of %d changed bundle(s)):" % (len(violations), checked))
    for path, v_old, why in violations:
        print("  %s  [VERSION=%s]  %s" % (path, v_old, why))
    print("")
    print("Why this blocks: fleet-autoaudit.py --apply only redeploys a worker that is STRICTLY")
    print("AHEAD by numeric version comparison, and deploy-drift.yml compares VERSION strings. A")
    print("bundle that changes without a VERSION bump is therefore invisible to every drift check")
    print("and is never auto-deployed - the fix stays on main forever (see issue 1371).")
    print("")
    print("FIX: bump `var VERSION = \"...\"` in the changed bundle(s) in this same commit, to a numeric")
    print("core strictly above the base's and above every open PR's claim for that worker (CLAUDE.md, Work claims).")
    print("If the change is genuinely cosmetic, bump anyway - the deployer cannot tell the")
    print("difference, and neither can a future reader of the ledger.")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
