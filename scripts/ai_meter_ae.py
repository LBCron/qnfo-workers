#!/usr/bin/env python3
"""AI-METER-AE-2 (2026-11-05, pillar cost, roadmap RM-ANALYTICS-ENGINE-METERS-1, agent_issues 1001927, program QNFO.INFRA).

WHY   qnfo-ai books every model call it routes into qnfo-audit.ai_spend_ledger, and skips that write while D1 is overloaded (d1AttrWriteSkip), which is
      exactly when spend runs hot. AI-METER-AE-1 adds a second, D1-free record: one Workers Analytics Engine data point per call in dataset qnfo_ai_calls
      (binding AI_METER in qnfo-ai). This script is the read side, the same pattern as qnfo-infra REACH-AE-1: it reads the dataset back through the Analytics
      Engine SQL API and writes a per-day rollup to qnfo-audit.ai_meter_ae_daily, so the question "who called which model, how often, at what price" is a
      D1 query that costs no D1 write on the hot path, and v_ai_meter_ae_vs_ledger shows how many calls the ledger missed.
POINT  index1 = caller; blob1 provider, blob2 model, blob3 caller, blob4 outcome (ok, downgraded, refused); double1 calls, double2 in_tok, double3 out_tok,
      double4 usd, double5 cached_tok. Sums are weighted by _sample_interval, so a sampled dataset still adds up.
RUNS  A step of the `heavy` job of remediation-consumer.yml (every 3 hours; rewrites the last LOOKBACK_DAYS days, so it is idempotent). Never fails the job: a
      dataset that does not exist yet (qnfo-ai not deployed with the binding), a token the Analytics Engine API refuses, or a missing table is logged and ends 0.
USAGE python3 scripts/ai_meter_ae.py [--selftest] [--dry-run]
"""
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import remediation_consumer as RC  # noqa: E402

DATASET = "qnfo_ai_calls"
LOOKBACK_DAYS = int(os.environ.get("AI_METER_AE_LOOKBACK_DAYS", "3"))
ROW_LIMIT = 3000
# 12 bound parameters a row, under the 100 D1 allows a statement.
CHUNK = 8
DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def ae_sql(days):
    """The Analytics Engine query: a per-day rollup of the last `days` days, sample-weighted."""
    n = int(days)
    return ("SELECT formatDateTime(timestamp, '%%Y-%%m-%%d') AS day, blob1 AS provider, blob3 AS caller, blob2 AS model, blob4 AS outcome, "
            "SUM(_sample_interval * double1) AS calls, SUM(_sample_interval * double2) AS in_tok, SUM(_sample_interval * double3) AS out_tok, "
            "SUM(_sample_interval * double5) AS cached_tok, SUM(_sample_interval * double4) AS usd, COUNT() AS points "
            "FROM %s WHERE timestamp > NOW() - INTERVAL '%d' DAY GROUP BY day, provider, caller, model, outcome ORDER BY day DESC LIMIT %d FORMAT JSON"
            % (DATASET, n, ROW_LIMIT))


def ae_query(sql):
    """POST the SQL to the Analytics Engine SQL API. Returns the list of row dicts, or raises RuntimeError with the refusal text."""
    url = "%s/accounts/%s/analytics_engine/sql" % (RC.CF_API, RC.ACCOUNT)
    req = urllib.request.Request(url, data=sql.encode("utf-8"), method="POST")
    req.add_header("Authorization", "Bearer " + RC.TOKEN)
    req.add_header("Content-Type", "text/plain")
    req.add_header("User-Agent", "qnfo-ai-meter-ae/1")
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            body = json.loads(r.read().decode("utf-8", "replace") or "{}")
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode("utf-8", "replace")[:300]
        except Exception:  # noqa: BLE001 - the status still carries the failure
            detail = ""
        raise RuntimeError("HTTP %s from analytics_engine/sql: %s" % (e.code, detail or e.reason)) from None
    return body.get("data") or []


def clean(row):
    """One AE row -> the tuple of ai_meter_ae_daily columns, or None when the row is unusable."""
    day = str(row.get("day") or "")
    if not DAY_RE.match(day):
        return None
    def num(k):
        try:
            return float(row.get(k) or 0)
        except (TypeError, ValueError):
            return 0.0
    return (day, str(row.get("provider") or "")[:40], str(row.get("caller") or "")[:80], str(row.get("model") or "")[:120],
            str(row.get("outcome") or "ok")[:20], int(round(num("calls"))), int(round(num("in_tok"))), int(round(num("out_tok"))),
            int(round(num("cached_tok"))), round(num("usd"), 6), int(num("points")))


UPSERT_HEAD = ("INSERT INTO ai_meter_ae_daily (day, provider, caller, model, outcome, calls, in_tok, out_tok, cached_tok, usd, points, updated_at) VALUES ")
UPSERT_TAIL = (" ON CONFLICT(day, provider, caller, model, outcome) DO UPDATE SET calls = excluded.calls, in_tok = excluded.in_tok, out_tok = excluded.out_tok, "
               "cached_tok = excluded.cached_tok, usd = excluded.usd, points = excluded.points, updated_at = excluded.updated_at")


def upsert_statements(rows, now_iso):
    out = []
    for i in range(0, len(rows), CHUNK):
        part = rows[i:i + CHUNK]
        marks = ",".join("(" + ",".join("?%d" % (k * 12 + j) for j in range(1, 13)) + ")" for k in range(len(part)))
        params = []
        for r in part:
            params.extend(list(r) + [now_iso])
        out.append((UPSERT_HEAD + marks + UPSERT_TAIL, params))
    return out


def run(dry=False, query=None, d1=None, now=None):
    now_iso = (now or dt.datetime.now(dt.timezone.utc)).strftime("%Y-%m-%d %H:%M:%S")
    res = {"read": 0, "written": 0, "skipped": None}
    try:
        data = (query or ae_query)(ae_sql(LOOKBACK_DAYS))
    except Exception as e:  # noqa: BLE001 - an unknown dataset or a refused token never fails the job
        res["skipped"] = "read: %s" % str(e)[:240]
        return res
    rows = [r for r in (clean(x) for x in data) if r]
    res["read"] = len(rows)
    if dry or not rows:
        return res
    try:
        for sql, params in upsert_statements(rows, now_iso):
            (d1 or RC.d1)(sql, params)
            res["written"] += len(params) // 12
    except Exception as e:  # noqa: BLE001 - a missing table (the migration has not applied yet) is logged, not fatal
        res["skipped"] = "write: %s" % str(e)[:240]
    return res


def selftest():
    sql = ae_sql(3)
    assert "FROM qnfo_ai_calls" in sql and "_sample_interval" in sql and "INTERVAL '3' DAY" in sql and sql.endswith("FORMAT JSON"), sql
    assert "%%" not in sql and "'%Y-%m-%d'" in sql, sql
    good = {"day": "2026-11-05", "provider": "workers-ai", "caller": "qnfo-ops", "model": "@cf/zai-org/glm-5.3-flash", "outcome": "ok",
            "calls": 12.0, "in_tok": "3000", "out_tok": 250.4, "cached_tok": 0, "usd": 0.0123456789, "points": "4"}
    c = clean(good)
    assert c == ("2026-11-05", "workers-ai", "qnfo-ops", "@cf/zai-org/glm-5.3-flash", "ok", 12, 3000, 250, 0, 0.012346, 4), c
    assert clean({"day": "garbage"}) is None and clean({}) is None
    rows = [c] * 17
    st = upsert_statements(rows, "2026-11-05 04:00:00")
    assert len(st) == 3 and [len(p) // 12 for _, p in st] == [8, 8, 1], [len(p) for _, p in st]
    assert all(len(p) < 100 for _, p in st) and "?96" in st[0][0] and "?97" not in st[0][0]
    seen = []
    res = run(query=lambda s: [good, {"day": "x"}], d1=lambda s, p=None: seen.append((s, p)) or [])
    assert res == {"read": 1, "written": 1, "skipped": None} and len(seen) == 1, res
    dry = run(dry=True, query=lambda s: [good], d1=lambda *a: (_ for _ in ()).throw(AssertionError("dry run wrote")))
    assert dry["read"] == 1 and dry["written"] == 0, dry

    def refused(s):
        raise RuntimeError("HTTP 422 from analytics_engine/sql: unable to find type of column")
    r2 = run(query=refused)
    assert r2["read"] == 0 and r2["skipped"].startswith("read: HTTP 422"), r2  # a dataset that does not exist yet is not a failure

    def nodb(s, p=None):
        raise RuntimeError("d1 error: no such table: ai_meter_ae_daily")
    r3 = run(query=lambda s: [good], d1=nodb)
    assert r3["written"] == 0 and r3["skipped"].startswith("write:"), r3
    print("ai_meter_ae selftest ok")


def main(argv):
    if "--selftest" in argv:
        selftest()
        return 0
    if not (RC.TOKEN and RC.ACCOUNT):
        RC.log("ai_meter_ae: no Cloudflare credentials in this environment; nothing read")
        return 0
    RC.log("ai_meter_ae: %s" % run(dry="--dry-run" in argv))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
