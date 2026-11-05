#!/usr/bin/env python3
"""d1_like_limit_guard.py -- D1-LIKE-LIMIT-GUARD-1 (charter pillar: autonomy). Diff-only: a change may not ADD a LIKE or GLOB pattern literal over 50 bytes.

WHY   D1 refuses a LIKE or GLOB pattern longer than 50 bytes ("LIKE or GLOB pattern too complex"). A SQL probe or a worker query with such a pattern
      never runs: the statement errors on every call, which a contract reads as an inconclusive probe and a worker as a failed tick. The same defect was
      fixed one file at a time, each time after it had broken something: migrations/2026-10-13-08-probe-like-limit.sql, then on 2026-11-04 cron-watch
      v_cron_fault_due (PR 7277), the blind-spot audit (PR 7281) and the closing probe of issue 1001342 (PR 7282), plus the case-insensitive match
      PR 7283 had to restore. PAPER-LEARN-1 (agent_issues 1000871, learning 5677) names the failure mode: undercorrection, correcting one occurrence of a
      defect without sweeping for the others. This guard is the sweep that stays: no new occurrence can merge.
WHAT  Reads the lines a change adds to .sql, .js, .mjs and .py files (not tests, not deployed-current mirrors) and fails for a LIKE or GLOB literal
      whose pattern is over 50 bytes, in plain SQL ('...'), inside a SQL string literal (''...''), or in JS/Python source. A comment line, a
      pattern bound as a parameter (LIKE ?1) and a line that carries `like-limit-ok: <reason>` pass. Use instr(column, 'text') > 0 for a long needle.
      A change that only removes or leaves a long pattern passes: existing occurrences are not this guard's business (regression gate semantics).
USAGE python3 scripts/d1_like_limit_guard.py [BASE]     BASE defaults to $GUARD_BASE, then origin/main.   python3 scripts/d1_like_limit_guard.py --selftest
EXIT  0 clean, 1 a violation, 2 usage/IO error (fail closed)."""
import os
import re
import subprocess
import sys

LIMIT = 50
EXT = (".sql", ".js", ".mjs", ".py")
SKIP = re.compile(r"(\.test\.mjs$|(^|/)deployed-current\.worker\.js$|(^|/)fixtures?/|\.fixture\.)")
# A pattern inside a SQL string literal is written ''...'' (quotes doubled); in plain SQL, JS and Python source it is '...'.
DOUBLED = re.compile(r"(?i)\b(?:NOT\s+)?(?:LIKE|GLOB)\s+''((?:(?!'').)*?)''(?!')")
SINGLE = re.compile(r"(?i)\b(?:NOT\s+)?(?:LIKE|GLOB)\s+'((?:[^']|'')*)'")


def patterns(line):
    """Every LIKE or GLOB pattern literal on one line, as the text D1 would receive."""
    out = []
    for m in DOUBLED.finditer(line):
        out.append(m.group(1).replace("''''", "'"))
    for m in SINGLE.finditer(line):
        p = m.group(1)
        # the single-quote form also matches the first quote of a doubled literal (LIKE ''x''): that match is an empty pattern, skipped
        if p == "" and line[m.end():m.end() + 1] != "'":
            continue
        out.append(p.replace("''", "'"))
    return out


def violations_in_line(line):
    s = line.strip()
    if not s or s.startswith(("--", "//", "#", "*", "/*")) or "like-limit-ok" in line:
        return []
    return [p for p in patterns(line) if len(p.encode("utf-8")) > LIMIT]


def scan_diff(diff_text):
    """Violations among the added lines of a unified diff: [(path, line number, bytes, pattern)]."""
    found, path, lineno = [], None, 0
    for raw in diff_text.splitlines():
        if raw.startswith("+++ "):
            path = raw[4:].strip()
            path = path[2:] if path.startswith("b/") else path
            if path == "/dev/null":
                path = None
            continue
        m = re.match(r"^@@ -\d+(?:,\d+)? \+(\d+)", raw)
        if m:
            lineno = int(m.group(1)) - 1
            continue
        if raw.startswith("+") and not raw.startswith("+++"):
            lineno += 1
            if path and path.endswith(EXT) and not SKIP.search(path):
                for p in violations_in_line(raw[1:]):
                    found.append((path, lineno, len(p.encode("utf-8")), p))
        elif not raw.startswith("-"):
            lineno += 1
    return found


def report(found):
    for path, lineno, n, p in found:
        print("%s:%d [d1-like-over-50-bytes] %d bytes: '%s%s' -- D1 refuses a LIKE or GLOB pattern over %d bytes (the statement errors on every run); "
              "use instr(column, 'text') > 0 for a long needle, or a shorter prefix, or mark the line like-limit-ok: <reason>"
              % (path, lineno, n, p[:40], "..." if len(p) > 40 else "", LIMIT))
    print("D1-LIKE-LIMIT-GUARD-1: %d violation(s) added" % len(found))


def selftest():
    def v(line):
        return violations_in_line(line)
    long51 = "%" + "a" * 49 + "%"
    ok50 = "%" + "a" * 48 + "%"
    assert len(long51.encode()) == 51 and len(ok50.encode()) == 50
    assert v("SELECT 1 FROM t WHERE x LIKE '" + long51 + "'") == [long51], "plain SQL, 51 bytes"
    assert v("SELECT 1 FROM t WHERE x LIKE '" + ok50 + "'") == [], "exactly 50 bytes is allowed"
    assert v("UPDATE c SET verify_probe = 'SELECT 1 FROM t WHERE x LIKE ''" + long51 + "'' AND y = 1'") == [long51], "inside a SQL string literal (doubled quotes)"
    assert v("UPDATE c SET verify_probe = 'SELECT 1 FROM t WHERE x LIKE ''" + ok50 + "'' AND y = 1'") == [], "50 bytes inside a string literal"
    assert v("const q = \"SELECT 1 FROM t WHERE x NOT LIKE '" + long51 + "' LIMIT 1\";") == [long51], "JS source, NOT LIKE"
    assert v("WHERE path GLOB '" + long51 + "'") == [long51], "GLOB"
    assert v("WHERE x LIKE ?1") == [] and v("WHERE x LIKE '%' || ?1 || '%'") == [], "a bound or concatenated pattern is not a literal"
    assert v("-- WHERE x LIKE '" + long51 + "'") == [] and v("// WHERE x LIKE '" + long51 + "'") == [] and v("# x LIKE '" + long51 + "'") == [], "comments"
    assert v("WHERE x LIKE '" + long51 + "' -- like-limit-ok: the table is a scratch copy") == [], "the marker"
    assert v("WHERE x LIKE '" + ("é" * 26) + "'") != [] and v("WHERE x LIKE '" + ("é" * 25) + "'") == [], "bytes, not characters (26 two-byte letters = 52 bytes)"
    assert v("WHERE a LIKE 'ok%' AND b LIKE '" + long51 + "'") == [long51], "the second pattern on a line"
    assert v("WHERE x LIKE 'it''s " + "a" * 40 + "'") == [] and len(v("WHERE x LIKE 'it''s " + "a" * 50 + "'")) == 1, "an escaped quote counts as one byte"
    # the shapes that broke on 2026-11-04 (PRs 7277, 7281, 7282)
    blindspot = "BLINDSPOT-1: % failure modes have a detector " + "that never ran"  # built at run time: scripts/like-limit-source.test.mjs scans this file's source for static long literals
    assert v("SELECT 'BLINDSPOT-1: ' || n || ' failure modes' WHERE m LIKE '" + blindspot + "'") != [], "BLINDSPOT-1 shape"
    diff = "\n".join([
        "diff --git a/migrations/x.sql b/migrations/x.sql", "--- a/migrations/x.sql", "+++ b/migrations/x.sql", "@@ -1,2 +1,4 @@",
        " context line", "+UPDATE t SET a = 1 WHERE b LIKE '" + long51 + "';", "-WHERE old LIKE '" + long51 + "'", "+-- comment LIKE '" + long51 + "'",
        "diff --git a/qnfo-x/worker.js b/qnfo-x/worker.js", "--- a/qnfo-x/worker.js", "+++ b/qnfo-x/worker.js", "@@ -10,0 +11,2 @@",
        "+const ok = db.prepare(\"SELECT 1 WHERE t LIKE 'short%'\");", "+const bad = db.prepare(\"SELECT 1 WHERE t LIKE '" + long51 + "'\");",
        "diff --git a/qnfo-x/worker.test.mjs b/qnfo-x/worker.test.mjs", "--- a/qnfo-x/worker.test.mjs", "+++ b/qnfo-x/worker.test.mjs", "@@ -1,0 +1,1 @@",
        "+x LIKE '" + long51 + "'",
        "diff --git a/qnfo-x/deployed-current.worker.js b/qnfo-x/deployed-current.worker.js", "--- a/qnfo-x/deployed-current.worker.js",
        "+++ b/qnfo-x/deployed-current.worker.js", "@@ -1,0 +1,1 @@", "+x LIKE '" + long51 + "'",
    ])
    got = scan_diff(diff)
    assert [(p, n) for p, n, _, _ in got] == [("migrations/x.sql", 2), ("qnfo-x/worker.js", 12)], got
    assert scan_diff("") == []
    print("d1_like_limit_guard selftest ok")


def main(argv):
    if "--selftest" in argv:
        selftest()
        return 0
    args = [a for a in argv if not a.startswith("--")]
    base = args[0] if args else os.environ.get("GUARD_BASE", "origin/main")
    p = subprocess.run(["git", "diff", "-U0", "--no-color", base, "HEAD"], capture_output=True, text=True, errors="replace")
    if p.returncode != 0:
        print("D1-LIKE-LIMIT-GUARD-1: failing closed, cannot read the diff against %r: %s" % (base, (p.stderr or "").strip()[:200]))
        return 2
    found = scan_diff(p.stdout)
    report(found)
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
