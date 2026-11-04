#!/usr/bin/env python3
"""regression_gate.py -- REGRESSION-GATE-1 (charter pillar: autonomy; PR velocity).

WHY   A pull request's checks run on the merge commit of the PR and main. Any guard that scans the whole repository therefore
      goes red on EVERY open pull request the moment main carries a defect, and each of them waits for a push. Measured
      2026-11-04: seven unrelated pull requests (7055, 7056, 7059, 7062, 7063, 7064, 7075; docs, migrations and workflow edits) went
      red at 17:09Z-17:14Z on the repository-wide workflow lint inside version-bump-guard, a transient state of main, and sat 92-107
      minutes (docs/PR-VELOCITY-2026-11.md). The defect was main's, the pull requests had changed nothing it checks.
WHAT  Runs a guard command on the pull request. When it fails, it runs the same command on the base tree and compares the failure
      lines: a failure the base already has is reported as a warning and does not block; a failure line the base does not have
      (a new invalid file, a new violation, a changed count) blocks as before. A failure with no recognisable failure line
      blocks (fail closed). Main itself stays strict: push runs use the plain command, and ci-watchdog files a red main.
USAGE python3 scripts/regression_gate.py [--name NAME] [--base REF] [--pattern REGEX] -- <command> [args...]
      --base      tree to compare with. Default: the first parent when HEAD is a merge commit (a pull_request checkout), else origin/main.
      --pattern   a line is a failure line when it matches (default: BROKEN|FAIL|ERROR|INVALID|VIOLATION|Traceback|not ok).
      REGRESSION_GATE=strict in the environment disables the relaxation (always the plain exit code); it is the revert.
EXIT  0 passed, or failed only the way the base already fails; otherwise the command's own non-zero exit code.
Every run prints one `REGRESSION-GATE <verdict> <json>` line so the verdicts can be counted from the logs.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

DEFAULT_PATTERN = r"BROKEN|FAIL|ERROR|INVALID|VIOLATION|Traceback|not ok"
ANSI = re.compile(r"\x1b\[[0-9;]*m")
STAMP = re.compile(r"^\d{4}-\d\d-\d\dT[\d:.]+Z\s+")
DURATION = re.compile(r"\b\d+(?:\.\d+)?\s*(?:ms|s|sec|seconds)\b")


def run(cmd, cwd):
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, errors="replace")
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def git(*args, cwd=None):
    p = subprocess.run(["git"] + list(args), cwd=cwd, capture_output=True, text=True, errors="replace")
    return p.returncode, (p.stdout or "").strip()


def signatures(text, pattern):
    """Normalised failure lines of a command's output."""
    out = set()
    for line in text.splitlines():
        # whitespace collapses too: a runner that pads a timing to a column ("FAIL    219 ms", "FAIL   1423 ms") prints a different width on every run
        line = re.sub(r"\s+", " ", DURATION.sub("<t>", STAMP.sub("", ANSI.sub("", line)))).strip()
        if line and pattern.search(line):
            out.add(line)
    return out


def default_base(cwd):
    rc, _ = git("rev-parse", "--verify", "--quiet", "HEAD^2", cwd=cwd)
    if rc == 0:
        rc, p1 = git("rev-parse", "HEAD^1", cwd=cwd)
        if rc == 0:
            return p1
    rc, sha = git("rev-parse", "--verify", "--quiet", "origin/main", cwd=cwd)
    return sha if rc == 0 else None


def verdict(name, status, **extra):
    print("REGRESSION-GATE %s %s" % (status, json.dumps(dict(name=name, **extra), sort_keys=True)))


def main(argv):
    if "--" not in argv:
        print("usage: regression_gate.py [--name N] [--base REF] [--pattern RE] -- command [args...]", file=sys.stderr)
        return 2
    i = argv.index("--")
    opts, cmd = argv[:i], argv[i + 1:]
    if not cmd:
        print("regression_gate.py: no command after --", file=sys.stderr)
        return 2
    name = next((opts[k + 1] for k, a in enumerate(opts[:-1]) if a == "--name"), os.path.basename(cmd[-1]) or cmd[0])
    base = next((opts[k + 1] for k, a in enumerate(opts[:-1]) if a == "--base"), None)
    pattern = re.compile(next((opts[k + 1] for k, a in enumerate(opts[:-1]) if a == "--pattern"), DEFAULT_PATTERN))
    cwd = os.getcwd()

    rc, out = run(cmd, cwd)
    out = out.replace(cwd, "<root>")
    sys.stdout.write(out)
    if rc == 0:
        verdict(name, "pass")
        return 0
    if os.environ.get("REGRESSION_GATE", "").strip().lower() == "strict":
        verdict(name, "block", reason="strict", rc=rc)
        return rc

    head_sigs = signatures(out, pattern)
    if not head_sigs:
        print("::error title=%s::failed with no recognisable failure line; blocking (fail closed)" % name)
        verdict(name, "block", reason="no-signature", rc=rc)
        return rc
    base = base or default_base(cwd)
    if not base:
        print("::error title=%s::cannot resolve the base tree to compare with; blocking (fail closed)" % name)
        verdict(name, "block", reason="no-base", rc=rc)
        return rc

    tmp = tempfile.mkdtemp(prefix="regression-gate-")
    wt = os.path.join(tmp, "base")
    try:
        rc_wt, msg = git("worktree", "add", "--detach", wt, base, cwd=cwd)
        if rc_wt != 0:
            print("::error title=%s::cannot check out the base %s (%s); blocking (fail closed)" % (name, base, msg[:200]))
            verdict(name, "block", reason="no-worktree", rc=rc)
            return rc
        base_rc, base_out = run(cmd, wt)
        base_out = base_out.replace(wt, "<root>")
    finally:
        git("worktree", "remove", "--force", wt, cwd=cwd)
        shutil.rmtree(tmp, ignore_errors=True)

    base_sigs = signatures(base_out, pattern) if base_rc != 0 else set()
    new = sorted(head_sigs - base_sigs)
    if base_rc != 0 and not new:
        print("::warning title=%s::fails on the base tree the same way (%d failure line(s)); main's defect, not this pull request's. Not blocking." % (name, len(head_sigs)))
        for s in sorted(head_sigs)[:10]:
            print("  pre-existing: " + s[:300])
        verdict(name, "pre-existing", rc=rc, base_rc=base_rc, lines=len(head_sigs))
        return 0
    print("::error title=%s::this pull request introduces %d failure line(s) the base does not have" % (name, len(new)))
    for s in new[:20]:
        print("  new: " + s[:300])
    verdict(name, "block", reason="new-failure", rc=rc, base_rc=base_rc, new=len(new))
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
