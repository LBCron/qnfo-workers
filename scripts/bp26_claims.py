#!/usr/bin/env python3
"""BP26 collector for claim_coverage (2026-10-28, charter pillar research; RM-CLAIMS-LEDGER-1, agent_issues 1000664).

claim_coverage: verified atomic claims / all atomic claims in artifacts published in the last 7 days (claims ledger; target 1.0).

The ledger is qnfo-audit.paper_claims (migrations/2026-10-28-cluster-e-b-doers.sql): one row per factual claim of a published paper, with the
source it rests on and a verification_state (unverified, verified, refuted, unsupported). The writer is qnfo-research-exec (claimAudit, a
code-task on agent_issues 1000664); until it has written rows this collector reports the metric as unknown (None, never 0), because a ratio
over an empty ledger is not a measurement. paper_claim_audits (CLAIM-INTEGRITY-1) records fabricated-empirical audits only and is not read here.

Offline suite: python3 scripts/bp26_claims.py --selftest
"""
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bp26_producers import Collector, Result  # noqa: E402

SQL = ("SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN verification_state = 'verified' THEN 1 ELSE 0 END), 0) AS v "
       "FROM paper_claims WHERE claim_kind = 'atomic' AND published_at >= datetime('now', '-7 days')")
BY_STATE = ("SELECT verification_state AS s, COUNT(*) AS n FROM paper_claims WHERE claim_kind = 'atomic' "
            "AND published_at >= datetime('now', '-7 days') GROUP BY verification_state ORDER BY verification_state")


def collect(ctx):
    try:
        row = (ctx.d1(SQL) or [{}])[0]
        n, v = int(row.get("n") or 0), int(row.get("v") or 0)
        states = ctx.d1(BY_STATE)
    except Exception as e:  # noqa: BLE001
        return [Result("claim_coverage", None, "unknown: claims ledger unreadable: " + str(e)[:100], [])]
    if n == 0:
        return [Result("claim_coverage", None, "unknown: paper_claims holds no atomic claim of a paper published in the last 7 days", [])]
    rows = [("state:%s" % s["s"], 1 if s["s"] == "verified" else 0, "%d claim(s)" % int(s["n"])) for s in states]
    return [Result("claim_coverage", round(v / n, 4), "%d of %d atomic claims of papers published in 7 days are verified (paper_claims ledger)" % (v, n), rows)]


COLLECTORS = [Collector("claims_ledger", collect, ["claim_coverage"], 55)]


def selftest():
    c = sqlite3.connect(":memory:")
    c.execute("CREATE TABLE paper_claims (id INTEGER PRIMARY KEY, slug TEXT, claim_kind TEXT, claim_text TEXT, source_ref TEXT, verification_state TEXT, published_at TEXT)")

    def d1(sql, params=None):
        cur = c.execute(sql, params or [])
        cols = [d[0] for d in cur.description] if cur.description else []
        return [dict(zip(cols, x)) for x in cur.fetchall()]

    class Ctx:
        pass
    ctx = Ctx()
    ctx.d1 = d1
    fails = []

    def ok(cond, m):
        if not cond:
            fails.append(m)
            print("FAIL " + m)
    c.executemany("INSERT INTO paper_claims (slug, claim_kind, claim_text, source_ref, verification_state, published_at) VALUES (?,?,?,?,?,datetime('now', ?))", [
        ("a", "reference", "r1", "doi:1", "verified", "-1 days"), ("a", "reference", "r2", "doi:2", "verified", "-2 days")])
    ok(collect(ctx)[0].value is None, "reference rows alone are not an atomic-claims measurement")
    c.executemany("INSERT INTO paper_claims (slug, claim_kind, claim_text, source_ref, verification_state, published_at) VALUES (?,?,?,?,?,datetime('now', ?))", [
        ("a", "atomic", "c1", "claim:1", "verified", "-1 days"), ("a", "atomic", "c2", "claim:2", "unverified", "-2 days"),
        ("old", "atomic", "c3", "claim:3", "refuted", "-30 days")])
    out = collect(ctx)[0]
    ok(out.value == 0.5, "1 verified of 2 recent atomic claims = 0.5, references and old claims ignored: %r" % (out,))
    ok(len(out.rows) == 2, "one evidence row per atomic claim state")
    bad = Ctx()
    bad.d1 = lambda sql, params=None: (_ for _ in ()).throw(RuntimeError("no such table: paper_claims"))
    ok(collect(bad)[0].value is None, "unreadable ledger is unknown")
    ok(COLLECTORS[0].metrics == ["claim_coverage"], "collector declares its metric")
    print("bp26_claims selftest %s" % ("ok" if not fails else "FAILED"))
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else 0)
