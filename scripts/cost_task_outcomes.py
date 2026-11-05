#!/usr/bin/env python3
"""COST-TASK-OUTCOMES-1 (2026-11-05, pillar cost, roadmap RM-COST-PER-TASK-ALL-PATHS-1, program QNFO.INFRA).

WHY   v_cost_per_task_class gives USD per successful task for the code loop, research, qnfo-agents and the two routers. Every other counted
      worker landed in an 'all-calls' row with ok_tasks NULL, because its outcome table is in another database (q08-signal) or does not
      exist (gateway ask answers, personal-api replies). A cost with no outcome beside it cannot say whether the money bought anything: on
      2026-11-03 and 2026-11-04 q08-signal-engine spent about 107k neurons a day (USD 1.18) and published no piece at all.
WHAT  Writes qnfo-audit.task_outcomes_daily, one row per (day, path, task_class), for the last LOOKBACK_DAYS days plus today:
        q08-signal-engine / piece-published     published_pieces per day, read from the q08-signal database through the Cloudflare API
                                                (only the per-day count leaves it, never a title or a body); a day with no piece is written as 0;
        <worker> / successful-model-call        calls minus errors per worker and day from ai_call_counters (same database): the honest unit
                                                for a path whose outcome is not stored anywhere, shown as ok_kind 'unit-call' by the view.
      v_cost_per_task_all_paths (migrations/2026-11-05-w2f-a-task-outcomes.sql) joins them to v_cost_per_task_class so no path shows a NULL.
      The personal-life database is deliberately NOT read (PERSONAL-QNFO-SEPARATION-1): personal-api is measured by its successful calls only.
RUNS  A step of the `heavy` job of remediation-consumer.yml (every 3 hours; rewrites the same rows, so it is idempotent). Never fails the job:
      a missing table (the migration has not applied yet) or an unreachable plane is logged and the run ends 0.
USAGE python3 scripts/cost_task_outcomes.py [--selftest] [--dry-run]
"""
import datetime as dt
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import remediation_consumer as RC  # noqa: E402

LOOKBACK_DAYS = int(os.environ.get("COST_OUTCOME_LOOKBACK_DAYS", "14"))
Q08_TRANSPORT = "d1-query@q08-signal"
Q08_PATH = "q08-signal-engine"
Q08_CLASS = "piece-published"
UNIT_CLASS = "successful-model-call"
Q08_SOURCE = "q08-signal.published_pieces rows per day (published_at), read through the Cloudflare D1 API"
UNIT_SOURCE = "ai_call_counters calls minus errors per worker and day (no outcome table exists for this path: the unit is one successful model call)"
# Rows per multi-row upsert: 6 bound parameters each, under the 100 D1 allows a statement.
CHUNK = 12
# purposes whose rows are telemetry about another row, not a model call of their own
SKIP_PURPOSES = ("spend-price-fallback", "ledger-rollup", "governor")
DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def window(today, n):
    """The n days before `today` and `today` itself, newest first, as ISO dates."""
    return [(today - dt.timedelta(days=i)).isoformat() for i in range(n + 1)]


def q08_rows(days, count_by_day, now_iso):
    """One piece-published row per day in the window; a day the database does not list is a real 0."""
    return [(d, Q08_PATH, Q08_CLASS, int(count_by_day.get(d, 0)), Q08_SOURCE, now_iso) for d in days]


def read_q08(days, plane=None):
    """{day: pieces} from q08-signal. Only per-day counts are selected."""
    since = days[-1]
    if not DAY_RE.match(since):
        raise ValueError("bad day %r" % since)
    sql = "SELECT substr(published_at, 1, 10) AS day, COUNT(*) AS n FROM published_pieces WHERE published_at >= '%s' GROUP BY 1" % since
    rows = (plane or RC.d1_plane)(Q08_TRANSPORT, sql)
    return {str(r.get("day")): int(r.get("n") or 0) for r in rows if DAY_RE.match(str(r.get("day") or ""))}


UPSERT_HEAD = "INSERT INTO task_outcomes_daily (day, path, task_class, ok_tasks, source, updated_at) VALUES "
UPSERT_TAIL = " ON CONFLICT(day, path, task_class) DO UPDATE SET ok_tasks = excluded.ok_tasks, source = excluded.source, updated_at = excluded.updated_at"


def upsert_statements(rows):
    """(sql, params) chunks for rows of (day, path, task_class, ok_tasks, source, updated_at)."""
    out = []
    for i in range(0, len(rows), CHUNK):
        part = rows[i:i + CHUNK]
        marks = ",".join("(?%d,?%d,?%d,?%d,?%d,?%d)" % tuple(range(k * 6 + 1, k * 6 + 7)) for k in range(len(part)))
        out.append((UPSERT_HEAD + marks + UPSERT_TAIL, [v for row in part for v in row]))
    return out


def unit_sql():
    skip = ",".join("'%s'" % p for p in SKIP_PURPOSES)
    return ("INSERT INTO task_outcomes_daily (day, path, task_class, ok_tasks, source, updated_at) "
            "SELECT day, worker, '" + UNIT_CLASS + "', SUM(MAX(calls - errors, 0)), ?2, ?3 FROM ai_call_counters "
            "WHERE day >= ?1 AND purpose NOT IN (" + skip + ") AND worker <> '" + Q08_PATH + "' GROUP BY day, worker HAVING SUM(MAX(calls - errors, 0)) > 0 "
            "ON CONFLICT(day, path, task_class) DO UPDATE SET ok_tasks = excluded.ok_tasks, source = excluded.source, updated_at = excluded.updated_at")


def run(today=None, dry=False, d1=None, plane=None, now=None):
    today = today or dt.datetime.now(dt.timezone.utc).date()
    now_iso = (now or dt.datetime.now(dt.timezone.utc)).strftime("%Y-%m-%d %H:%M:%S")
    days = window(today, LOOKBACK_DAYS)
    d1 = d1 or RC.d1
    result = {"days": len(days), "q08_days": 0, "q08_pieces": 0, "unit_written": False, "skipped": []}
    try:
        counts = read_q08(days, plane)
        rows = q08_rows(days, counts, now_iso)
        result["q08_days"] = len(rows)
        result["q08_pieces"] = sum(r[3] for r in rows)
        if not dry:
            for sql, params in upsert_statements(rows):
                d1(sql, params)
    except Exception as e:  # noqa: BLE001 - an unreachable plane or a missing table never fails the job
        result["skipped"].append("q08: %s" % str(e)[:200])
    try:
        if not dry:
            d1(unit_sql(), [days[-1], UNIT_SOURCE, now_iso])
            result["unit_written"] = True
    except Exception as e:  # noqa: BLE001
        result["skipped"].append("unit: %s" % str(e)[:200])
    return result


def selftest():
    today = dt.date(2026, 11, 5)
    days = window(today, 3)
    assert days == ["2026-11-05", "2026-11-04", "2026-11-03", "2026-11-02"], days
    rows = q08_rows(days, {"2026-11-02": 2, "2026-11-05": 1}, "2026-11-05 04:00:00")
    assert [r[3] for r in rows] == [1, 0, 0, 2], rows  # a day with no piece is a real zero, never missing
    assert all(r[1] == Q08_PATH and r[2] == Q08_CLASS for r in rows)
    st = upsert_statements(rows * 4)  # 16 rows -> 12 + 4
    assert len(st) == 2 and st[0][0].count("(?") == 12 and len(st[0][1]) == 72 and len(st[1][1]) == 24, [len(s[1]) for s in st]
    assert all(len(p) < 100 for _, p in st)
    seen = []
    plane = lambda t, sql: [{"day": "2026-11-02", "n": 2}, {"day": "garbage", "n": 9}]  # noqa: E731
    got = read_q08(days, plane)
    assert got == {"2026-11-02": 2}, got
    res = run(today=today, d1=lambda sql, params=None: seen.append((sql, params)) or [], plane=plane, now=dt.datetime(2026, 11, 5, 4, 0, tzinfo=dt.timezone.utc))
    assert res["q08_days"] == 15 and res["q08_pieces"] == 2 and res["unit_written"] and not res["skipped"], res
    assert any("FROM ai_call_counters" in s for s, _ in seen) and any("published_pieces" not in s and "task_outcomes_daily" in s for s, _ in seen)
    assert "'ledger-rollup'" in unit_sql() and "worker <> 'q08-signal-engine'" in unit_sql()
    dry = run(today=today, dry=True, d1=lambda *a: (_ for _ in ()).throw(AssertionError("dry run wrote")), plane=plane)
    assert dry["q08_pieces"] == 2 and not dry["unit_written"], dry

    def boom(t, sql):
        raise RuntimeError("plane q08: plane-not-found")
    res2 = run(today=today, d1=lambda sql, params=None: [], plane=boom)
    assert res2["skipped"] and res2["unit_written"], res2  # an unreachable plane leaves the in-database rows running
    print("cost_task_outcomes selftest ok")


def main(argv):
    if "--selftest" in argv:
        selftest()
        return 0
    if not (RC.TOKEN and RC.ACCOUNT):
        RC.log("cost_task_outcomes: no Cloudflare credentials in this environment; nothing written")
        return 0
    res = run(dry="--dry-run" in argv)
    RC.log("cost_task_outcomes: %s" % res)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
