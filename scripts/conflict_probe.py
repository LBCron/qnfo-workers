#!/usr/bin/env python3
"""conflict_probe.py -- CONFLICT-PROBE-GIT-1 (charter pillar: autonomy; REST budget).

WHY   conflict-repair.yml probes on every push to main whether any open pull request needs a repair. It read GET pulls/N for every open
      pull request (the mergeable state, which GitHub computes lazily and answers `null` for the first minute after a push, so the probe
      slept 15 s and read them all again, up to 3 passes) and GET pulls/N/files for every clean one: 2 to 3 x (1 + N) REST calls per
      push, 40 to 75 with 20 open pull requests, on a push rate of about 12 an hour. That is the repository's own token bucket
      (1000 an hour, shared by every workflow's GITHUB_TOKEN, including the merge lane's reads and pr-checks' `changes` job).
WHAT   One REST call (the list of open pull requests, for the numbers, heads and titles); everything else is git, which spends no REST budget:
      `git fetch` of each head (refs/pull/N/head), `git merge-tree --write-tree <base> <head>` for the conflict (exit 1 = conflicting), and
      `git diff --name-only <base>...<head>` for a clean pull request that still changes a worker.js (the doer normalises its VERSION,
      the same rule the REST probe had). The answer is exact where the REST one was `null` for a minute.
USAGE python3 scripts/conflict_probe.py [--base origin/main] [--repo OWNER/NAME] [--github-output FILE] [--prs-file SAVED_LISTING.json]
      Needs gh (GH_TOKEN) for the one list call and a checkout with full history. Prints one JSON line and, with --github-output (or
      $GITHUB_OUTPUT), `dirty=<certain>` and `unknown=<n>` (the workflow adds them). A pull request the probe cannot judge (fetch failed, no merge base) counts as dirty: the doer decides.
"""
import json
import os
import re
import subprocess
import sys

HOLD = re.compile(r"(^|[\s\[(])(wip|do[\s-]*not[\s-]*merge|hold)([\s:\])]|$)", re.I)
WORKER = re.compile(r"^[^/]+/worker\.js$")


def git(*args):
    p = subprocess.run(["git"] + list(args), capture_output=True, text=True, errors="replace")
    return p.returncode, (p.stdout or "").strip()


def parse_pages(text):
    """`gh api --paginate` prints one JSON array per page back to back."""
    text, out, dec, i = text.strip(), [], json.JSONDecoder(), 0
    while i < len(text):
        arr, j = dec.raw_decode(text, i)
        out += arr
        i = j
        while i < len(text) and text[i].isspace():
            i += 1
    return out


def open_prs(repo, prs_file=None):
    if prs_file:  # a saved listing (tests, offline replay)
        with open(prs_file, encoding="utf-8") as fh:
            return parse_pages(fh.read())
    p = subprocess.run(["gh", "api", "repos/%s/pulls?state=open&per_page=100" % repo, "--paginate"], capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError("gh api pulls failed: " + (p.stderr or "")[:300])
    return parse_pages(p.stdout)


def eligible(pr):
    return not (pr.get("head", {}).get("ref") or "").startswith("repair/") and not HOLD.search(pr.get("title") or "")


def judge(base, numbers):
    """number -> 'conflict' | 'worker' | 'clean' | 'unknown', from git alone."""
    out = {}
    if not numbers:
        return out
    specs = ["+refs/pull/%d/head:refs/probe/%d" % (n, n) for n in numbers]
    rc, msg = git("fetch", "--no-tags", "--quiet", "origin", *specs)
    if rc != 0:
        # one missing ref fails the whole batch before anything is fetched; take the heads one at a time
        for spec in specs:
            git("fetch", "--no-tags", "--quiet", "origin", spec)
    for n in numbers:
        head = "refs/probe/%d" % n
        if git("rev-parse", "--verify", "--quiet", head)[0] != 0:
            out[n] = "unknown"
            continue
        rc_m, _ = git("merge-tree", "--write-tree", base, head)
        if rc_m == 1:
            out[n] = "conflict"
        elif rc_m != 0:
            out[n] = "unknown"
        else:
            rc_d, files = git("diff", "--name-only", "%s...%s" % (base, head))
            if rc_d != 0:
                out[n] = "unknown"
            else:
                out[n] = "worker" if any(WORKER.match(f) for f in files.splitlines()) else "clean"
    return out


def main(argv):
    arg = lambda k, d=None: next((argv[i + 1] for i, a in enumerate(argv[:-1]) if a == k), d)  # noqa: E731
    base = arg("--base", "origin/main")
    repo = arg("--repo", os.environ.get("GITHUB_REPOSITORY") or "QNFO/qnfo-workers")
    gh_out = arg("--github-output", os.environ.get("GITHUB_OUTPUT"))
    prs = [p for p in open_prs(repo, arg("--prs-file")) if eligible(p)]
    verdicts = judge(base, [p["number"] for p in prs])
    dirty = sum(1 for v in verdicts.values() if v in ("conflict", "worker", "unknown"))
    result = {"open_eligible": len(prs), "dirty": dirty, "conflict": sorted(n for n, v in verdicts.items() if v == "conflict"),
              "worker": sorted(n for n, v in verdicts.items() if v == "worker"), "unknown": sorted(n for n, v in verdicts.items() if v == "unknown"),
              "rest_calls": 1}
    print(json.dumps(result))
    if gh_out:
        with open(gh_out, "a") as fh:
            # dirty counts what is certain; the workflow adds the unknown count itself (`dirty=$((dirty+unknown))`, fm-conflict-probe-skips-unknown)
            fh.write("dirty=%d\nunknown=%d\n" % (dirty - len(result["unknown"]), len(result["unknown"])))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
