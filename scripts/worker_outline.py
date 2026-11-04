#!/usr/bin/env python3
"""worker_outline.py -- WORKER-OUTLINE-1: read one function of a huge worker.js instead of the whole file.

WHY   qnfo-fleet-control/worker.js is 1.3 MB, qnfo-ops 0.8 MB, qnfo-fleet-dashboard 1.4 MB, qnfo-research-exec 1.6 MB. A session that
      opens one of them whole spends 200k-400k tokens before it edits a line, and a Grep hit on a long line prints thousands of
      characters. This tool lists the top-level functions with line number and size, and prints one function (long lines cut).

USAGE
  python scripts/worker_outline.py qnfo-ops                      # outline: line, chars, name (all top-level functions)
  python scripts/worker_outline.py qnfo-ops --grep tick          # only names containing 'tick' (case-insensitive)
  python scripts/worker_outline.py qnfo-ops --show remediationContractsTick            # print that function, lines cut at 240 chars
  python scripts/worker_outline.py qnfo-ops --show remediationContractsTick --full      # no cutting
  python scripts/worker_outline.py qnfo-ops --find "INSERT INTO fleet_tick"             # line numbers of a text, each cut at 160 chars
Then edit with the Edit tool on the exact text; the outline gives the line to Read with offset/limit.
"""
import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DECL = re.compile(r"^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(")
CUT = 240


def load(path):
    with open(path, encoding="utf-8", errors="replace", newline="") as f:
        return f.read().replace("\r\n", "\n").split("\n")


def resolve(arg):
    if os.path.isfile(arg):
        return arg
    for cand in (os.path.join(ROOT, arg, "worker.js"), os.path.join(ROOT, arg)):
        if os.path.isfile(cand):
            return cand
    raise SystemExit("no such worker or file: " + arg)


def outline(lines):
    """[(name, first_line, last_line)] 1-based; a function ends at the line before the next top-level declaration or its closing brace."""
    starts = [(i, DECL.match(l).group(1)) for i, l in enumerate(lines) if DECL.match(l)]
    out = []
    for k, (i, name) in enumerate(starts):
        limit = starts[k + 1][0] if k + 1 < len(starts) else len(lines)
        end = i
        for j in range(i, limit):
            if lines[j] == "}":
                end = j
                break
        else:
            end = limit - 1
        out.append((name, i + 1, end + 1))
    return out


def cut(text, n):
    return text if len(text) <= n else text[:n] + " ...[+%d chars]" % (len(text) - n)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("worker")
    ap.add_argument("--grep")
    ap.add_argument("--show")
    ap.add_argument("--find")
    ap.add_argument("--full", action="store_true")
    a = ap.parse_args(argv)
    lines = load(resolve(a.worker))
    if a.find:
        hits = [(i + 1, l) for i, l in enumerate(lines) if a.find in l]
        for n, l in hits[:60]:
            print("%d: %s" % (n, cut(l.strip(), 160)))
        print("%d hit(s)%s" % (len(hits), "; first 60 shown" if len(hits) > 60 else ""))
        return 0 if hits else 1
    fns = outline(lines)
    if a.show:
        m = [f for f in fns if f[0] == a.show]
        if not m:
            near = [f[0] for f in fns if a.show.lower() in f[0].lower()][:10]
            print("no function named %s%s" % (a.show, "; similar: " + ", ".join(near) if near else ""))
            return 1
        for name, s, e in m:
            print("// %s lines %d-%d" % (name, s, e))
            for n in range(s, e + 1):
                t = lines[n - 1]
                print("%d\t%s" % (n, t if a.full else cut(t, CUT)))
        return 0
    for name, s, e in fns:
        if a.grep and a.grep.lower() not in name.lower():
            continue
        size = sum(len(x) + 1 for x in lines[s - 1:e])
        print("%7d %8d  %s" % (s, size, name))
    return 0


if __name__ == "__main__":
    sys.exit(main())
