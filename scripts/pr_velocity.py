#!/usr/bin/env python3
"""pr_velocity.py -- PR-VELOCITY-1 measurement (charter pillar: autonomy). Re-measures docs/PR-VELOCITY-2026-11.md in one command.

Over the last N merged pull requests (default 100) it prints:
  * open -> merge and last-push -> merge, median and p90 (minutes). The last push is the committer date of the pull request head, read from git;
  * the share that needed a CONFLICTED merge commit: every merge commit on the pull request branch is replayed with `git merge-tree`, and only one that
    conflicts counts (an update-branch merge that merged clean is not a conflict), and the share whose conflict hunks were only the VERSION and release-note block;
  * with --runs: the Actions runs created in the same window by event and conclusion (4 REST calls per event).
REST budget: 2 list calls (+4 per event with --runs); the heads and the merge replays are git. Needs gh auth and a checkout whose `origin` is QNFO/qnfo-workers.
USAGE  python3 scripts/pr_velocity.py [--n 100] [--runs] [--json]
"""
import json
import re
import statistics
import subprocess
import sys
from datetime import datetime

NOTE = re.compile(r"^\s*(/\*|//)?\s*\d+\.\d+\.\d+[ \w.,-]*[A-Z][A-Z0-9-]*-\d")


def sh(*cmd):
    p = subprocess.run(list(cmd), capture_output=True, text=True, errors="replace")
    return p.returncode, p.stdout


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def pct(vals, q):
    v = sorted(vals)
    return v[min(len(v) - 1, int(round(q * (len(v) - 1))))] if v else 0.0


def merged_prs(n):
    out = []
    for page in (1, 2, 3):
        rc, txt = sh("gh", "api", "repos/QNFO/qnfo-workers/pulls?state=closed&per_page=100&sort=updated&direction=desc&page=%d" % page)
        if rc != 0:
            raise SystemExit("gh api failed (rate limit?)")
        out += [p for p in json.loads(txt) if p.get("merged_at")]
        if len(out) >= n:
            break
    return sorted(out, key=lambda p: p["merged_at"], reverse=True)[:n]


def conflict_info(num):
    """(had a conflicted merge, every hunk of it was the VERSION / release-note block)."""
    _, log = sh("git", "log", "--merges", "--format=%H %P", "origin/main..refs/velpr/%d" % num)
    conflicted, only_version = False, True
    for line in log.splitlines():
        parts = line.split()
        if len(parts) < 3:
            continue
        rc, out = sh("git", "merge-tree", "--write-tree", "--name-only", parts[1], parts[2])
        if rc == 0:
            continue
        conflicted = True
        lines = out.splitlines()
        for f in dict.fromkeys(x for x in lines[1:] if x and "\t" not in x and not x.startswith(("Auto", "CONFLICT"))):
            _, body = sh("git", "show", "%s:%s" % (lines[0], f))
            for m in re.finditer(r"<<<<<<< [^\n]*\n(.*?)>>>>>>> [^\n]*\n", body, re.S):
                h = m.group(1)
                if not ("VERSION" in h or any(NOTE.match(x) for x in h.splitlines())):
                    only_version = False
    return conflicted, conflicted and only_version


def main(argv):
    n = int(argv[argv.index("--n") + 1]) if "--n" in argv else 100
    prs = merged_prs(n)
    sh("git", "fetch", "--no-tags", "--quiet", "origin", "main")
    sh("git", "fetch", "--no-tags", "--quiet", "origin", *["+refs/pull/%d/head:refs/velpr/%d" % (p["number"], p["number"]) for p in prs])
    open_merge, push_merge, conflicted, version_only = [], [], 0, 0
    for p in prs:
        merged = ts(p["merged_at"])
        open_merge.append((merged - ts(p["created_at"])).total_seconds() / 60)
        rc, tip = sh("git", "log", "-1", "--format=%cI", "refs/velpr/%d" % p["number"])
        if rc == 0 and tip.strip():
            push_merge.append((merged - datetime.fromisoformat(tip.strip())).total_seconds() / 60)
        c, v = conflict_info(p["number"])
        conflicted += c
        version_only += v
    res = {"n": len(prs), "window": [prs[-1]["merged_at"], prs[0]["merged_at"]],
           "open_to_merge_min": {"median": round(statistics.median(open_merge), 1), "p90": round(pct(open_merge, .9), 1)},
           "last_push_to_merge_min": {"median": round(statistics.median(push_merge), 1), "p90": round(pct(push_merge, .9), 1)},
           "conflicted_merge_prs": conflicted, "conflict_only_version_block_prs": version_only}
    if "--runs" in argv:
        lo, hi = prs[-1]["created_at"], prs[0]["merged_at"]
        runs = {}
        for ev in ("pull_request", "push", "workflow_run"):
            row = {}
            for st in ("", "cancelled", "success", "failure"):
                q = "created=%s..%s&per_page=1&event=%s" % (lo, hi, ev) + ("&status=" + st if st else "")
                rc, txt = sh("gh", "api", "repos/QNFO/qnfo-workers/actions/runs?" + q, "--jq", ".total_count")
                row[st or "total"] = int(txt.strip() or 0) if rc == 0 else None
            runs[ev] = row
        res["runs"] = runs
    if "--json" in argv:
        print(json.dumps(res, indent=1))
    else:
        print("last %d merged pull requests, %s .. %s" % (res["n"], *res["window"]))
        print("open -> merge:       median %(median)s min, p90 %(p90)s min" % res["open_to_merge_min"])
        print("last push -> merge:  median %(median)s min, p90 %(p90)s min" % res["last_push_to_merge_min"])
        print("needed a conflicted merge: %d of %d; of those, only the VERSION / release-note block: %d" % (conflicted, res["n"], version_only))
        for ev, row in res.get("runs", {}).items():
            print("runs %-13s %s" % (ev, row))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
