#!/usr/bin/env python3
"""VIEW-HEALTH-1 (2026-11-04, pillar autonomy; owner: "what are you missing", blind-spot audit BLINDSPOT-1).
PR 7023 merged a view (v_outcome_northstar) that errors on read because of a missing column, and nothing noticed.
Every view of qnfo-audit is compiled with EXPLAIN (it plans the statement, so a missing column or table fails, and reads
no rows, so it costs nothing). The remediation consumer runs this hourly after the migration sweep: it files one deduped
BLINDSPOT-1 issue listing the broken views and closes it, with evidence, once they all compile. Never raises."""
import json
import re
import time

PREFIX = "BLINDSPOT-1: views that error on read"
METRIC = "broken_views"
# VIEW-HEALTH-429-1 (2026-11-04, agent_issues 1001788): an hourly pass of about 300 EXPLAINs through the Cloudflare API drew HTTP 429 for five views and filed them as "views that error
# on read" although each compiles. A view is broken only when the database refuses to plan it (a missing column or table: a 400 with SQLITE_ERROR). A refusal of the request itself
# (429, 5xx, "D1 DB is overloaded", a timeout) says nothing about the view: it is retried with a backoff, then counted as unchecked, never as broken, and an unchecked view blocks the close.
TRANSIENT = re.compile(r"HTTP (?:429|5\d\d)\b|overloaded|too many (?:requests|resources)|rate.?limit|timed? ?out|temporar|try again|connection (?:reset|aborted)", re.I)
RETRIES = 3
SLEEP = time.sleep


def is_transient(message):
    return bool(TRANSIENT.search(str(message)))


def explain(d1, name):
    """EXPLAIN one view. Returns (ok, error_text, transient). Retries a refused request; the database's own refusal returns at once."""
    last = ""
    for attempt in range(RETRIES):
        try:
            d1('EXPLAIN SELECT * FROM "%s"' % name)
            return True, "", False
        except Exception as e:  # noqa: BLE001 - the error text is the finding
            last = str(e)
            if not is_transient(last):
                return False, last, False
            if attempt + 1 < RETRIES:
                SLEEP(2 ** attempt)
    return False, last, True


def broken_views(d1):
    d1("EXPLAIN SELECT 1")  # when EXPLAIN itself is refused, raise: nothing is filed and nothing is closed
    rows = d1("SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name")
    bad, unchecked = {}, {}
    for r in rows:
        name = r.get("name")
        if not name or '"' in name:
            continue
        ok, err, transient = explain(d1, name)
        if ok:
            continue
        (unchecked if transient else bad)[name] = err[:160]
    return len(rows), bad, unchecked


def run(d1, verifier="view-health"):
    out = {}
    try:
        total, bad, unchecked = broken_views(d1)
        now_ms = int(time.time() * 1000)
        n = len(bad)
        d1("UPDATE metric_registry SET last_value = ?1, last_refreshed = ?2, state = 'MEASURED' WHERE metric = ?3",
           [str(n), time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), METRIC])
        open_rows = d1("SELECT id FROM agent_issues WHERE status = 'open' AND title LIKE ?1", [PREFIX + "%"])
        out.update({"views": total, "broken": n, "unchecked": len(unchecked)})
        if n == 0:
            if unchecked:  # a view whose plan was never read is not one that compiles: leave the issue as it is until a pass reads them all
                return out
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

    # VIEW-HEALTH-429-1: a refused request is not a broken view
    global SLEEP
    SLEEP = lambda s: None  # noqa: E731 - no real backoff in the selftest
    assert is_transient("HTTP 429 from https://api.cloudflare.com/client/v4/accounts/x/d1/database/y/query: {\"messages\"")
    assert is_transient("D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window") and is_transient("HTTP 503 from https://api.cloudflare.com/x")
    assert not is_transient("HTTP 400 from https://api.cloudflare.com/x: no such column: missing_col: SQLITE_ERROR")
    calls = {}

    def flaky(plan):
        """d1 that raises per view: plan maps a view name to the number of refusals before it answers (None = always)."""
        def f(sql, params=None):
            if sql.startswith('EXPLAIN SELECT * FROM "'):
                name = sql.split('"')[1]
                if name in plan:
                    calls[name] = calls.get(name, 0) + 1
                    if plan[name] is None or calls[name] <= plan[name]:
                        raise RuntimeError("HTTP 429 from https://api.cloudflare.com/client/v4/accounts/a/d1/database/b/query: {\"messages\"")
            return d1(sql, params)
        return f

    total, bad, unchecked = broken_views(flaky({"v_f1": 2}))
    assert not bad and not unchecked and calls["v_f1"] == 3, (bad, unchecked, calls)   # two refusals, answered on the third try: compiles
    calls.clear()
    total, bad, unchecked = broken_views(flaky({"v_f2": None}))
    assert not bad and list(unchecked) == ["v_f2"] and calls["v_f2"] == RETRIES, (bad, unchecked, calls)  # never answered: unchecked, not broken
    # a view created broken here (a cached EXPLAIN of an older definition is not re-planned by sqlite3, so v_bad is not reused)
    con.executescript("CREATE VIEW v_broken AS SELECT missing_col FROM t;")
    total, bad, unchecked = broken_views(flaky({"v_f2": None}))
    assert list(bad) == ["v_broken"] and list(unchecked) == ["v_f2"], (bad, unchecked)  # the database's own refusal is broken, and is not retried
    con.executescript("DROP VIEW v_broken;")
    # the issue filed for views that were only unchecked is not closed by a pass that still cannot read one, and a pass that reads them all closes it
    con.execute("INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) VALUES ('BLINDSPOT-1: views that error on read (5)', 'x', 'view-health', 'structure', 'high', 'open', 1, 1)")
    con.execute("INSERT INTO issue_triage VALUES (2, NULL)")
    calls.clear()
    r = run(flaky({"v_f3": None}))
    assert r.get("broken") == 0 and r.get("unchecked") == 1 and "closed" not in r and "filed" not in r, r
    assert d1("SELECT status FROM agent_issues WHERE id = 2")[0]["status"] == "open"
    r = run(d1)
    assert r.get("closed") == 1 and r.get("unchecked") == 0, r
    assert d1("SELECT status FROM agent_issues WHERE id = 2")[0]["status"] == "closed"
    print("view_health selftest ok")


if __name__ == "__main__":
    selftest()
