#!/usr/bin/env python3
"""BP26-PAPER-PIDS-1 collector (2026-10-28, charter pillar research; agent_issues 1000338; breach issue 1000672).

paper_version_immutability: 1 - (published paper versions whose body changed in place) / (published papers), from the living-paper
paper_change_ledger. A violation is a live (backfilled = 0) ledger row of the last 30 days where the paper was published, distributed or
external_preprint before the change, version_before = version_after, and body_fp_before differs from body_fp_after: the body changed and
the version did not, so a citation to that version now points at different text. Counted per distinct (slug, version).
PROXY, NOT THE METRIC'S FULL DEFINITION: the metric text says stored content hash versus the served body; no per-version content hash is
stored or served yet (that is the BP26-PAPER-PIDS-1 build: immutable version URLs, hashes, PID route), so this measures the write path
(a body edit without a version bump) and cannot see a body altered outside the ledger. Unknown when the ledger or papers table is
unreadable, never 1.0 by default. Evidence rows carry slug and version, no text.

BP26-PAPERVER-COUNT-1 (2026-11-05): the violating versions were read with `ORDER BY slug LIMIT 500` and counted in Python, so the count could
never exceed 500: on 2026-11-04 the metric read 0.3132 = 1 - 500/728 while the ledger held 675 distinct in-place versions (true value 0.0728).
The count is now a COUNT(*) over the same predicate (no row limit); only the 40 evidence rows are limited. The note also names the writers
(first two segments of the ledger actor, so a loop is told apart from its worker), the in-place edits of the last 24 hours (the inflow: the
number that must fall to 0 for the 30-day window to start clearing) and the first day the window can clear if no further edit lands.

Offline suite: python3 scripts/bp26_paperver.py --selftest
"""
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bp26_producers import Collector, Result  # noqa: E402

DB = "living-paper"
PUB = "('published', 'distributed', 'external_preprint')"
# One predicate for every query below, so the count, the writers and the evidence can never disagree.
WHERE = (
    "backfilled = 0 AND kind = 'update' AND status_before IN "
    + PUB
    + " AND version_before IS NOT NULL AND version_before = version_after "
    "AND body_fp_before IS NOT NULL AND body_fp_after IS NOT NULL AND body_fp_before <> body_fp_after "
    "AND ts >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')"
)
LAST = "SELECT MAX(ts) AS last_ts FROM paper_change_ledger WHERE " + WHERE
VERSIONS = "SELECT COUNT(*) AS n FROM (SELECT DISTINCT slug, version_before FROM paper_change_ledger WHERE " + WHERE + ")"
EVIDENCE = "SELECT DISTINCT slug, version_before AS version FROM paper_change_ledger WHERE " + WHERE + " ORDER BY slug LIMIT 40"
# The writer is the first two ':'-separated segments of the ledger actor ('qnfo-research-exec:paper-format:<slug>:<stamp>' -> 'qnfo-research-exec:paper-format').
WRITER = (
    "CASE WHEN instr(substr(actor, instr(actor, ':') + 1), ':') > 0 "
    "THEN substr(actor, 1, instr(actor, ':') + instr(substr(actor, instr(actor, ':') + 1), ':') - 1) ELSE actor END"
)
WRITERS = (
    "SELECT "
    + WRITER
    + " AS writer, COUNT(DISTINCT slug) AS papers, MAX(ts) AS last_ts FROM paper_change_ledger WHERE "
    + WHERE
    + " GROUP BY 1 ORDER BY papers DESC LIMIT 8"
)
INFLOW = (
    "SELECT COUNT(DISTINCT slug) AS n FROM paper_change_ledger WHERE "
    + WHERE
    + " AND ts >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')"
)
# Total number of published *versions* (distinct slug+version) rather than just papers.
TOTAL = (
    "SELECT COUNT(*) AS n FROM (SELECT DISTINCT slug, version_before FROM paper_change_ledger "
    "WHERE status_before IN "
    + PUB
    + " AND version_before IS NOT NULL)"
)


def _day_plus_30(ts):
    """'2026-11-04T23:31:27.116Z' -> '2026-12-04' (the day the 30-day window holds no edit of that moment)."""
    import datetime

    try:
        d = datetime.datetime.strptime(str(ts)[:19], "%Y-%m-%dT%H:%M:%S")
    except ValueError:
        return "unknown"
    return (d + datetime.timedelta(days=30)).strftime("%Y-%m-%d")


def collect_immutability(ctx):
    try:
        total = int((ctx.d1_db(DB, TOTAL) or [{}])[0].get("n") or 0)
        cnt = (ctx.d1_db(DB, LAST) or [{}])[0]
        viol_n = int((ctx.d1_db(DB, VERSIONS) or [{}])[0].get("n") or 0)
        ev_rows = ctx.d1_db(DB, EVIDENCE)
        writers = ctx.d1_db(DB, WRITERS)
        inflow = int((ctx.d1_db(DB, INFLOW) or [{}])[0].get("n") or 0)
    except Exception as e:  # noqa: BLE001
        return [Result("paper_version_immutability", None, "living-paper ledger unreadable: " + str(e)[:100], [])]
    if not total:
        return [Result("paper_version_immutability", None, "no published paper versions counted", [])]
    # The number of violating versions cannot exceed total, but we keep the original safeguard.
    v = min(viol_n, total)
    ev = [("%s@%s" % (r["slug"], r["version"]), 0, "body changed in place under the same version") for r in ev_rows]
    for w in writers:
        ev.append(
            ("writer:%s" % w.get("writer"), 0, "%s paper(s) edited in place in 30 days, last at %s" % (w.get("papers"), w.get("last_ts")))
        )
    last_ts = cnt.get("last_ts")
    clear = ("; with no further in-place edit the 30-day window holds none from %s" % _day_plus_30(last_ts)) if last_ts else ""
    note = (
        "%d published version(s) had their body changed without a version bump in 30 days, of %d published version(s) (ledger write-path proxy: "
        "no per-version content hash is stored yet, so a body altered outside the ledger is not seen); %d paper(s) edited in place in the last 24 h%s; writers: %s"
        % (
            viol_n,
            total,
            inflow,
            clear,
            ", ".join("%s %s" % (w.get("writer"), w.get("papers")) for w in writers) or "none",
        )
    )
    return [Result("paper_version_immutability", round(1 - v / total, 4), note, ev)]


COLLECTORS = [Collector("paper_version_immutability", collect_immutability, ["paper_version_immutability"], 55)]


def selftest():
    c = sqlite3.connect(":memory:")
    c.execute("CREATE TABLE papers (slug TEXT, status TEXT)")
    c.execute(
        "CREATE TABLE paper_change_ledger (seq INTEGER PRIMARY KEY, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), slug TEXT, kind TEXT, backfilled INTEGER DEFAULT 0, "
        "status_before TEXT, version_before TEXT, version_after TEXT, body_fp_before TEXT, body_fp_after TEXT, actor TEXT DEFAULT 'unattributed')"
    )
    c.executemany("INSERT INTO papers VALUES (?,?)", [("a", "published"), ("b", "published"), ("c", "distributed"), ("d", "published"), ("e", "draft")])
    c.executemany(
        "INSERT INTO paper_change_ledger (slug, kind, backfilled, status_before, version_before, version_after, body_fp_before, body_fp_after, actor) VALUES (?,?,?,?,?,?,?,?,?)",
        [
            ("a", "update", 0, "published", "1.0", "1.0", "x", "y", "qnfo-research-exec:paper-format:a:mvz8"),  # in-place edit: violation
            ("a", "update", 0, "published", "1.0", "1.0", "y", "z", "qnfo-research-exec:paper-format:a:mvz9"),  # same version again: still one
            ("b", "update", 0, "published", "1.0", "1.1", "x", "y", "qnfo-research-exec:version-queue:b:1"),  # version bumped: fine
            ("c", "update", 1, "distributed", "1.0", "1.0", "x", "y", "backfill:paper_body_backups"),  # backfilled: ignored
            ("d", "update", 0, "draft", "0.1", "0.1", "x", "y", "unattributed"),  # not yet published: fine
        ],
    )

    def d1_db(name, sql, params=None):
        cur = c.execute(sql, params or [])
        cols = [d[0] for d in cur.description] if cur.description else []
        return [dict(zip(cols, x)) for x in cur.fetchall()]

    class Ctx:
        pass

    ctx = Ctx()
    ctx.d1_db = d1_db
    fails = []

    def ok(cond, m):
        if not cond:
            fails.append(m)
            print("FAIL " + m)

    out = collect_immutability(ctx)[0]
    ok(
        out.value == 0.75
        and out.rows[0][0] == "a@1.0"
        and len([r for r in out.rows if not r[0].startswith("writer:")]) == 1,
        "one distinct violated version of 4 published papers: %r" % (out,),
    )
    ok(
        "writer:qnfo-research-exec:paper-format" in [r[0] for r in out.rows]
        and "1 paper(s) edited in place in the last 24 h" in out.note,
        "the writer loop and the 24 h inflow are named: %s" % out.note,
    )
    ok("holds none from " in out.note and "unknown" not in out.note, "the first clear day is derived from the last edit: %s" % out.note)
    ok(_day_plus_30("2026-11-04T23:31:27.116Z") == "2026-12-04", "30 days after the last edit")
    # BP26-PAPERVER-COUNT-1: more violating versions than the old LIMIT 500 must be counted in full
    many = [("p%04d" % i, "published") for i in range(700)]
    c.executemany("INSERT INTO papers VALUES (?,?)", many)
    c.executemany(
        "INSERT INTO paper_change_ledger (slug, kind, backfilled, status_before, version_before, version_after, body_fp_before, body_fp_after, actor) VALUES (?,?,?,?,?,?,?,?,?)",
        [(s, "update", 0, "published", "1.0.0", "1.0.0", "x", "y", "session:revised-standard-backfill") for s, _ in many[:650]],
    )
    big = collect_immutability(ctx)[0]
    ok(
        "651 published version(s)" in big.note
        and abs(big.value - round(1 - 651 / 704.0, 4)) < 1e-9,
        "650 + 1 violations are all counted, not capped at 500: %r %s" % (big.value, big.note),
    )
    ok(len([r for r in big.rows if not r[0].startswith("writer:")]) == 40, "only the evidence rows are limited")
    c.execute("DELETE FROM papers")
    ok(collect_immutability(ctx)[0].value is None, "no published papers: unknown")
    c.execute("DROP TABLE paper_change_ledger")
    ok(collect_immutability(ctx)[0].value is None, "missing ledger: unknown")
    print("bp26_paperver selftest %s" % ("ok" if not fails else "FAILED %d" % len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else 0)
