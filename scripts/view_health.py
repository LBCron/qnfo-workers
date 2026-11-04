#!/usr/bin/env python3
"""VIEW-HEALTH-1 (2026-11-04, pillar autonomy; owner: "what are you missing", blind-spot audit BLINDSPOT-1).
PR 7023 merged a view (v_outcome_northstar) that errors on read because of a missing column, and nothing noticed.
Every view of qnfo-audit is compiled with EXPLAIN (it plans the statement, so a missing column or table fails, and reads
no rows, so it costs nothing). The remediation consumer runs this hourly after the migration sweep: it files one deduped
BLINDSPOT-1 issue listing the broken views and closes it, with evidence, once they all compile. Never raises."""
import json
import time

PREFIX = "BLINDSPOT-1: views that error on read"
METRIC = "broken_views"


def broken_views(d1):
    d1("EXPLAIN SELECT 1")  # when EXPLAIN itself is refused, raise: nothing is filed and nothing is closed
    rows = d1("SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name")
    bad = {}
    for r in rows:
        name = r.get("name")
        if not name or '"' in name:
            continue
        try:
            d1('EXPLAIN SELECT * FROM "%s"' % name)
        except Exception as e:  # noqa: BLE001 - the error text is the finding
            bad[name] = str(e)[:160]
    return len(rows), bad


def run(d1, verifier="view-health"):
    out = {}
    try:
        total, bad = broken_views(d1)
        now_ms = int(time.time() * 1000)
        n = len(bad)
        d1("UPDATE metric_registry SET last_value = ?1, last_refreshed = ?2, state = 'MEASURED' WHERE metric = ?3",
           [str(n), time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), METRIC])
        open_rows = d1("SELECT id FROM agent_issues WHERE status = 'open' AND title LIKE ?1", [PREFIX + "%"])
        out.update({"views": total, "broken": n})
        if n == 0:
            if total >= 50:  # too few views means the listing failed; close nothing
                for r in open_rows:
                    d1("UPDATE issue_triage SET close_evidence = ?1 WHERE issue_id = ?2",
                       ["VIEW-HEALTH-1 %s: all %d views compile (%s)" % (time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), total, verifier), r["id"]])
                    d1("UPDATE agent_issues SET status = 'closed', close_channel = 'auto-recovery', updated_at = ?1 WHERE id = ?2", [now_ms, r["id"]])
                out["closed"] = len(open_rows)
            return out
        listing = "; ".join("%s: %s" % (k, v) for k, v in list(bad.items())[:8])
        title = "%s (%d)" % (PREFIX, n)
        desc = ("scripts/view_health.py (VIEW-HEALTH-1) plans every qnfo-audit view with EXPLAIN. These fail: %s. "
                "Fix each view with a later migration (a migration already merged is not edited). Closes itself when every view compiles." % listing)
        if open_rows:
            d1("UPDATE agent_issues SET title = ?1, description = ?2, updated_at = ?3 WHERE id = ?4", [title, desc, now_ms, open_rows[0]["id"]])
            out["updated"] = open_rows[0]["id"]
        else:
            d1("INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) "
               "SELECT ?1, ?2, 'view-health', 'structure', 'high', 'open', ?3, ?3 WHERE NOT EXISTS "
               "(SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE ?4)", [title, desc, now_ms, PREFIX + "%"])
            out["filed"] = True
    except Exception as e:  # noqa: BLE001
        out["error"] = str(e)[:200]
    return out


def selftest():
    import sqlite3
    con = sqlite3.connect(":memory:")
    con.executescript("""CREATE TABLE t (a); CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title, description, source, category, priority, status, close_channel, created_at, updated_at);
    CREATE TABLE issue_triage (issue_id, close_evidence); CREATE TABLE metric_registry (metric, last_value, last_refreshed, state);
    INSERT INTO metric_registry VALUES ('broken_views', NULL, NULL, NULL);
    CREATE VIEW v_ok AS SELECT a FROM t; CREATE VIEW v_bad AS SELECT a FROM t;""")
    for i in range(60):
        con.execute("CREATE VIEW v_f%d AS SELECT a FROM t" % i)

    def d1(sql, params=None):
        cur = con.execute(sql.replace("?1", ":p1").replace("?2", ":p2").replace("?3", ":p3").replace("?4", ":p4"),
                          {"p%d" % (i + 1): v for i, v in enumerate(params or [])})
        con.commit()
        cols = [c[0] for c in cur.description or []]
        return [dict(zip(cols, r)) for r in cur.fetchall()]

    # break v_bad: drop the column it reads by redefining the table
    con.executescript("DROP VIEW v_bad; CREATE VIEW v_bad AS SELECT missing_col FROM t;")
    r = run(d1)
    assert r.get("broken") == 1 and r.get("filed"), r
    r = run(d1)
    assert r.get("updated"), r
    assert d1("SELECT COUNT(*) c FROM agent_issues")[0]["c"] == 1
    con.executescript("DROP VIEW v_bad; CREATE VIEW v_bad AS SELECT a FROM t;")
    con.execute("INSERT INTO issue_triage VALUES (1, NULL)")
    r = run(d1)
    assert r.get("closed") == 1, r
    assert d1("SELECT status FROM agent_issues")[0]["status"] == "closed"
    print("view_health selftest ok")


if __name__ == "__main__":
    selftest()
