#!/usr/bin/env python3
"""BP26 provenance_marking_coverage collector (charter pillar research; agent_issues 1000335 BP26-PROVENANCE-MARKING-1; roadmap row 1391).

provenance_marking_coverage: generated assets published since 2026-08-02 with a valid C2PA manifest or a signed sidecar that verifies / all such assets.

HISTORY. The first version of this file (2026-10-28) returned UNKNOWN because no ledger existed. qnfo-gateway 3.45.0+ (PROVENANCE-SIDECAR-1) now files one
qnfo-audit.asset_provenance row for every sidecar it signs (asset_id "paper:<slug>@<version>", kind "paper-text", verified_ok = the signer's own check,
probe_ok = an independent probe, NULL until one runs). The ledger alone is not a denominator: it holds only what was signed, so an empty ledger would read as
"no assets" instead of "no asset marked". This version counts the denominator from the places the assets are published:
  papers          living-paper.papers, status published / distributed / external_preprint, first published (or created) on or after 2026-08-02
  q08 pieces      q08-signal.published_pieces published on or after 2026-08-02 (the piece sidecar /p/<slug>/provenance.json is unsigned until a signing key
                  exists, so a q08 piece counts as marked only through a verified ledger row of kind "q08-piece")
and the numerator from the ledger: distinct assets of that class with verified_ok = 1 and probe_ok not 0.
NOT IN THE DENOMINATOR (stated, not hidden): reading.q08.org pieces (personal plane, never read by this runner), social images, PDFs. Their share is open work
(docs/BP26-SECURITY-CLUSTER.md: a C2PA manifest embedded in a PDF or image needs an X.509 certificate from a CA on the C2PA Trust List, an identity-bound step).
ROOT BLOCKER, read from the live site every run: the signing key. Without the worker secret PROVENANCE_SIGNING_KEY the gateway answers 503 on the key document
and signs nothing, so the value is a measured 0 until the owner step (human_actions bp26-provenance-signing-key) is done. A measured 0 is the truth; unknown
is kept for an unreadable source, never for a missing ledger.

Offline suite: python3 scripts/bp26_provenance_marking_coverage.py --selftest
"""
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bp26_producers import Collector, Result  # noqa: E402

SINCE = "2026-08-02"
KEY_URL = "https://papers.qnfo.org/.well-known/provenance-key.json"
PAPERS_DB, Q08_DB = "living-paper", "q08-signal"
PAPERS_SQL = ("SELECT COUNT(*) AS n FROM papers WHERE status IN ('published', 'distributed', 'external_preprint') "
              "AND COALESCE(first_published_at, created_at) >= ?1")
Q08_SQL = "SELECT COUNT(*) AS n FROM published_pieces WHERE published_at >= ?1"
# one asset = one slug / piece, however many versions were signed
LEDGER_SQL = ("SELECT kind, COUNT(DISTINCT CASE WHEN instr(asset_id, '@') > 0 THEN substr(asset_id, 1, instr(asset_id, '@') - 1) ELSE asset_id END) AS n "
              "FROM asset_provenance WHERE published_at >= ?1 AND verified_ok = 1 AND COALESCE(probe_ok, 1) <> 0 GROUP BY kind")
CLASSES = (("papers", "paper-text"), ("q08 pieces", "q08-piece"))


def _count(rows):
    return int((rows or [{}])[0].get("n") or 0)


def collect_coverage(ctx):
    try:
        papers = _count(ctx.d1_db(PAPERS_DB, PAPERS_SQL, [SINCE]))
        pieces = _count(ctx.d1_db(Q08_DB, Q08_SQL, [SINCE]))
    except Exception as e:  # noqa: BLE001
        return [Result("provenance_marking_coverage", None, "published-asset counts unreadable (%s): a ratio over part of the assets is not written" % str(e)[:120], [])]
    try:
        marked = {str(r.get("kind")): int(r.get("n") or 0) for r in ctx.d1(LEDGER_SQL, [SINCE])}
    except Exception as e:  # noqa: BLE001
        return [Result("provenance_marking_coverage", None, "asset_provenance unreadable (%s): kept unknown" % str(e)[:120], [])]
    totals = {"papers": papers, "q08 pieces": pieces}
    rows, covered, total = [], 0, 0
    for label, kind in CLASSES:
        n, m = totals[label], min(marked.get(kind, 0), totals[label])
        covered += m
        total += n
        rows.append((label, 1 if n and m == n else 0, "%d of %d published since %s have a signed sidecar that verifies (ledger kind %s)" % (m, n, SINCE, kind)))
    key_note = "signing key not checked"
    try:
        r = ctx.http(KEY_URL)
        up = bool(r and r.status == 200 and not r.error)
        key_note = "signing key document %s (HTTP %s)" % ("served" if up else "NOT served: the worker secret PROVENANCE_SIGNING_KEY is absent, nothing can be signed", getattr(r, "status", None))
        rows.append(("signing key", 1 if up else 0, key_note))
    except Exception as e:  # noqa: BLE001
        rows.append(("signing key", None, "key document unreadable: " + str(e)[:80]))
    if total == 0:
        return [Result("provenance_marking_coverage", None, "no published asset counted since %s: 0 of 0 is not a ratio" % SINCE, rows)]
    note = ("%d of %d generated assets published since %s carry a signed sidecar that verifies (papers %d of %d, q08 pieces %d of %d); %s; "
            "not counted: reading.q08.org pieces (personal plane), social images and PDFs (a C2PA manifest embedded in a file needs a CA-issued certificate, docs/BP26-SECURITY-CLUSTER.md)"
            % (covered, total, SINCE, min(marked.get("paper-text", 0), papers), papers, min(marked.get("q08-piece", 0), pieces), pieces, key_note))
    return [Result("provenance_marking_coverage", round(covered / float(total), 4), note, rows)]


COLLECTORS = [Collector("provenance_marking", collect_coverage, ["provenance_marking_coverage"], 55)]


def selftest():
    led = sqlite3.connect(":memory:")
    led.execute("CREATE TABLE asset_provenance (asset_id TEXT PRIMARY KEY, kind TEXT, published_at TEXT, verified_ok INTEGER, probe_ok INTEGER)")
    state = {"papers": 10, "pieces": 4, "boom": False}

    def rows_of(db, sql, params=None):
        cur = db.execute(sql, params or [])
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, x)) for x in cur.fetchall()]

    class Resp:
        def __init__(self, status):
            self.status, self.error = status, None

    class Ctx:
        key_status = 503

        def d1(self, sql, params=None):
            return rows_of(led, sql, params)

        def d1_db(self, name, sql, params=None):
            if state["boom"]:
                raise RuntimeError("unreadable")
            n = state["papers"] if name == PAPERS_DB else state["pieces"]
            return [{"n": n}]

        def http(self, url):
            return Resp(self.key_status)
    ctx = Ctx()
    fails = []

    def ok(cond, m):
        if not cond:
            fails.append(m)
            print("FAIL " + m)
    out = collect_coverage(ctx)[0]
    ok(out.value == 0.0 and "NOT served" in out.note, "empty ledger and no key: a measured 0 that names the key, not unknown: %r" % (out,))
    ok(any(r[0] == "signing key" and r[1] == 0 for r in out.rows), "the key row is a failing evidence row")
    # three versions of one paper count once; an unverified row and a failed independent probe count never
    led.executemany("INSERT INTO asset_provenance VALUES (?,?,?,?,?)", [
        ("paper:a@1.0", "paper-text", "2026-09-01", 1, None), ("paper:a@1.1", "paper-text", "2026-09-01", 1, 1), ("paper:a@2.0", "paper-text", "2026-09-01", 1, None),
        ("paper:b@1.0", "paper-text", "2026-09-02", 0, None), ("paper:c@1.0", "paper-text", "2026-09-03", 1, 0),
        ("paper:d@1.0", "paper-text", "2026-07-01", 1, None), ("q08:x", "q08-piece", "2026-10-01", 1, None)])
    ctx.key_status = 200
    out = collect_coverage(ctx)[0]
    ok(out.value == round(2 / 14.0, 4), "one paper with three versions + one piece = 2 of 14, others excluded: %r" % (out.value,))
    ok("served" in out.note and "NOT served" not in out.note, "key served is stated: %r" % out.note[:200])
    state["papers"], state["pieces"] = 0, 0
    ok(collect_coverage(ctx)[0].value is None, "0 of 0 is unknown, not 1.0")
    state["papers"], state["pieces"] = 1, 1
    out = collect_coverage(ctx)[0]
    ok(out.value == 1.0, "marked counts are capped at the denominator: %r" % (out.value,))
    state["boom"] = True
    ok(collect_coverage(ctx)[0].value is None, "an unreadable denominator is unknown, not zero")
    print("bp26_provenance_marking_coverage selftest %s" % ("ok" if not fails else "FAILED %d" % len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else 0)
