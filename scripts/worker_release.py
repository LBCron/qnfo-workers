#!/usr/bin/env python3
"""worker_release.py -- RELEASE-FRAGMENT-1 (charter pillar: autonomy; PR velocity).

WHY   Every pull request that changes a big worker edits the same few lines of <worker>/worker.js: the `var VERSION` line, which has carried the whole
      release note of the latest release (qnfo-fleet-control: 32 KB on one line), and the notes under it, and the same lines again in the byte-identical
      mirror deployed-current.worker.js. Measured 2026-11-04 on the last 100 merged pull requests: 18 needed a conflicted merge, 10 of those conflicted
      ONLY in the VERSION and notes block (52 of 110 conflict hunks, each one twice because of the mirror), and the version claim of an unmerged pull request
      cost one REST read per open pull request (CLAUDE.md, "Before you bump a worker's VERSION").
WHAT   `bump` makes the release in one command and keeps the part that two pull requests fight over small:
        * the new VERSION is the next one above main AND every open pull request (read with git, one REST call for the list);
        * the VERSION line is written bare; a trailing comment already on it moves, byte for byte, to its own line below (VERSION-LINE-SPLIT-1 layout);
        * the release note goes to <worker>/releases/<version>.md, a new file nobody else edits, not into worker.js;
        * the mirror is copied from the source when scripts/mirror-guard.py says it is safe (import-free, not a captured upload);
        * node --check runs on the result.
      `claims` prints the versions main and the open pull requests hold and the next free one (the loop in CLAUDE.md without its N REST reads).
      version-bump-guard and mirror-guard are unchanged: the bump still changes the VERSION in worker.js and the mirror still equals the source.
USAGE  python3 scripts/worker_release.py claims <worker> [--prs-file FILE]
       python3 scripts/worker_release.py bump <worker> --note TEXT [--name ID] [--patch|--minor|--major|--to X.Y.Z] [--suffix S] [--no-split] [--dry-run] [--prs-file FILE]
EXIT   0 done (or dry run); 1 nothing to do or a check failed; 2 bad arguments.
"""
import datetime
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get("WORKER_RELEASE_ROOT") or os.path.dirname(HERE)
# the same reading version-bump-guard.py uses (VERSION-RE-ANCHOR-1): a declaration that starts a line, the first one in the file
DECL = re.compile(r'^([ \t]*var\s+VERSION\s*=\s*)"([^"\n]*)"([^\n]*)$', re.M)
CORE = re.compile(r'^[vV]?(\d+(?:\.\d+)*)(.*)$')
PURE_COMMENT = re.compile(r'^(;?)[ \t]*((?:/\*(?:(?!\*/).)*\*/|//[^\n]*)(?:[ \t]*(?:/\*(?:(?!\*/).)*\*/|//[^\n]*))*)[ \t]*$')


def git(*args, cwd=ROOT):
    p = subprocess.run(["git"] + list(args), cwd=cwd, capture_output=True, text=True, errors="replace")
    return p.returncode, (p.stdout or "").rstrip("\n")


def core_of(version):
    m = CORE.match((version or "").strip())
    return ([int(x) for x in m.group(1).split(".")], m.group(2)) if m else (None, "")


def version_in(text):
    m = DECL.search(text or "")
    return m.group(2) if m else None


def mirror_guard():
    spec = importlib.util.spec_from_file_location("mirror_guard", os.path.join(HERE, "mirror-guard.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def open_pr_numbers(prs_file=None):
    if prs_file:
        text = open(prs_file, encoding="utf-8").read()
    else:
        p = subprocess.run(["gh", "api", "repos/QNFO/qnfo-workers/pulls?state=open&per_page=100", "--paginate", "--jq", ".[].number"],
                           capture_output=True, text=True)
        if p.returncode != 0:
            print("warning: cannot list the open pull requests (%s); claims cover main only" % (p.stderr or "").strip()[:160], file=sys.stderr)
            return []
        text = p.stdout
    nums = []
    for tok in re.findall(r'"number"\s*:\s*(\d+)|^\s*(\d+)\s*$', text, re.M):
        nums.append(int(tok[0] or tok[1]))
    return sorted(set(nums))


def claims(worker, prs_file=None, base="origin/main"):
    """{'main': version, '<pr>': version, ...} for <worker>/worker.js, from git alone."""
    path = "%s/worker.js" % worker
    out = {}
    rc, text = git("show", "%s:%s" % (base, path))
    out["main"] = version_in(text) if rc == 0 else None
    nums = open_pr_numbers(prs_file)
    if nums:
        git("fetch", "--no-tags", "--quiet", "origin", *["+refs/pull/%d/head:refs/rel/%d" % (n, n) for n in nums])
    for n in nums:
        rc, line = git("grep", "-h", "-m1", "-E", r'^[ \t]*var[ \t]+VERSION[ \t]*=', "refs/rel/%d" % n, "--", path)
        if rc == 0 and line:
            v = version_in(line)
            if v and v != out["main"]:
                out["pr%d" % n] = v
    return out


def next_version(held, level="patch", to=None, suffix=None):
    cores = [c for c in (core_of(v)[0] for v in held if v) if c]
    top = max(cores) if cores else [0, 0, 0]
    if to:
        return to
    top = top + [0] * (3 - len(top)) if len(top) < 3 else top
    if level == "major":
        new = [top[0] + 1, 0, 0]
    elif level == "minor":
        new = [top[0], top[1] + 1, 0]
    else:
        new = top[:-1] + [top[-1] + 1]
    return ".".join(str(x) for x in new) + (suffix or "")


def split_declaration(text, new_version):
    """The text with the first VERSION declaration set to new_version and a pure trailing comment moved to the next line. Returns (text, moved_chars)."""
    m = DECL.search(text)
    if not m:
        raise ValueError("no `var VERSION = \"...\"` declaration that starts a line")
    eol = "\r\n" if "\r\n" in text[: m.end() + 2] else "\n"
    tail = m.group(3).rstrip("\r")
    pure = PURE_COMMENT.match(tail)
    if pure and pure.group(2):
        new_line = '%s"%s";%s%s%s' % (m.group(1), new_version, eol, pure.group(2), "\r" if eol == "\r\n" else "")
        return text[: m.start()] + new_line + text[m.end():], len(pure.group(2))
    return text[: m.start()] + '%s"%s"%s' % (m.group(1), new_version, m.group(3)) + text[m.end():], 0


def sync_mirror(worker):
    src, mirror = os.path.join(ROOT, worker, "worker.js"), os.path.join(ROOT, worker, "deployed-current.worker.js")
    if not os.path.isfile(mirror):
        return "no mirror file; mirror-sync creates it after the merge"
    mg = mirror_guard()
    if mg.is_captured(mirror) or not mg.is_import_free(src):
        return "mirror NOT copied (captured upload or a source with imports): build it the way mirror-guard.py describes"
    shutil.copyfile(src, mirror)
    return "mirror copied from worker.js"


def cmd_claims(args):
    worker = args[0]
    held = claims(worker, next((args[i + 1] for i, a in enumerate(args[:-1]) if a == "--prs-file"), None))
    for k, v in held.items():
        print("%-8s %s" % (k, v))
    print("next patch: %s   next minor: %s" % (next_version(held.values(), "patch"), next_version(held.values(), "minor")))
    return 0


def cmd_bump(args):
    worker = args[0]
    opt = lambda k, d=None: next((args[i + 1] for i, a in enumerate(args[:-1]) if a == k), d)  # noqa: E731
    note = opt("--note")
    if not note:
        print("bump needs --note TEXT: what changed and why (it becomes %s/releases/<version>.md)" % worker, file=sys.stderr)
        return 2
    level = "major" if "--major" in args else "minor" if "--minor" in args else "patch"
    path = os.path.join(ROOT, worker, "worker.js")
    if not os.path.isfile(path):
        print("no %s" % path, file=sys.stderr)
        return 2
    with open(path, encoding="utf-8", newline="") as fh:
        text = fh.read()
    current = version_in(text)
    if current is None:
        print("%s/worker.js has no `var VERSION = \"...\"` declaration that starts a line" % worker, file=sys.stderr)
        return 1
    held = claims(worker, opt("--prs-file"))
    held["file"] = current
    suffix = opt("--suffix", core_of(current)[1])
    new = next_version(held.values(), level, opt("--to"), suffix)
    if "--no-split" in args:
        new_text, moved = DECL.sub(lambda m: '%s"%s"%s' % (m.group(1), new, m.group(3)), text, count=1), 0
    else:
        new_text, moved = split_declaration(text, new)
    report = ["%s: %s -> %s (held: %s)" % (worker, current, new, ", ".join("%s %s" % kv for kv in held.items()))]
    if moved:
        report.append("moved a %d-char trailing comment of the VERSION line to its own line" % moved)
    frag = os.path.join(ROOT, worker, "releases", "%s.md" % new)
    if os.path.exists(frag):
        print("release fragment %s already exists; pick another version" % os.path.relpath(frag, ROOT), file=sys.stderr)
        return 1
    body = "# %s %s (%s)\n\n%s%s\n" % (worker, new, datetime.date.today().isoformat(), ("%s: " % opt("--name")) if opt("--name") else "", note.strip())
    if "--dry-run" in args:
        print("\n".join(report))
        print("would write %s" % os.path.relpath(frag, ROOT))
        return 0
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(new_text)
    os.makedirs(os.path.dirname(frag), exist_ok=True)
    with open(frag, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(body)
    report.append("wrote %s" % os.path.relpath(frag, ROOT))
    report.append(sync_mirror(worker))
    if shutil.which("node"):
        chk = subprocess.run(["node", "--check", path], capture_output=True, text=True)
        report.append("node --check ok" if chk.returncode == 0 else "node --check FAILED: " + (chk.stderr or "")[:300])
        if chk.returncode != 0:
            print("\n".join(report))
            return 1
    # CATALOG-ON-BUMP-1: the release note is a new tracked Markdown file, so docs/INDEX.md and docs/agent-catalog.json go stale with it and main's docs suite
    # went red after each such merge (#7219, #7246, 2026-11-04); the bump regenerates them in the same change.
    gen = os.path.join(ROOT, "scripts", "build-agent-catalog.mjs")
    if shutil.which("node") and os.path.exists(gen):
        r = subprocess.run(["node", gen], cwd=ROOT, capture_output=True, text=True)
        report.append("documentation catalog regenerated" if r.returncode == 0 else "documentation catalog NOT regenerated: run node scripts/build-agent-catalog.mjs (%s)" % (r.stderr or r.stdout)[:200])
    print("\n".join(report))
    return 0


def main(argv):
    if len(argv) < 2 or argv[0] not in ("claims", "bump"):
        print(__doc__)
        return 2
    return (cmd_claims if argv[0] == "claims" else cmd_bump)(argv[1:])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
