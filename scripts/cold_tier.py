#!/usr/bin/env python3
"""COLD-TIER-1 (2026-11-04, pillar cost; owner question: "D1 is slow and has way too many rows", docs/D1-TIERING-2026-11.md).

WHAT  Moves old rows of the biggest append-only telemetry tables of qnfo-audit out of D1 without losing the answer to "how reliable has X
      been": for each tier in TIERS
        1. ROLLUP  one row per (day, dim1, dim2) in cold_rollup_daily (count, passes, failures, two numbers) for every complete day still in
           the table, written BEFORE any row of that day is archived or deleted (INSERT OR REPLACE, so a re-run is harmless);
        2. ARCHIVE the rows older than keep_days are written as gzipped JSON lines to R2 qnfo-backups cold/qnfo-audit/<table>/<yyyymm>/
           <table>-<idmin>-<idmax>.jsonl.gz, read back, and checked (sha256 of the bytes, line count equal to the row count); only then is a
           cold_archive_ledger row written (verified = 1);
        3. PRUNE   (mode "delete" only) the archived ids are deleted from D1 in statements of at most 400 ids, after the ledger row exists,
           and the rows are counted again; a mismatch is recorded on the ledger row. A table in mode "copy" is archived but pruned by its
           existing retention trigger (remediation_verifications: retention_prune_tick_v2 at 8 days; the copy runs 2 days ahead of it).
      A row is never deleted unless the object that holds it was read back and matched. Mode "delete" keeps the newest row of every
      (keep_latest) key, as the retention triggers do, because readers ask for "the latest probe of X".
      ops_config cold_tier = off stops everything. COLD_BUDGET_SEC (default 150) and CHUNKS_PER_TIER bound a run; the next run continues.

WHY   Measured 2026-11-04: qnfo-audit holds 1.55 M rows in 639 tables, 1.45 GB with 645 indexes. fleet_probe_log (213 k rows, 61 MB, 21 days kept
      for a table every reader asks for the last day of) and remediation_verifications (363 k rows, 56 MB, 13 indexes) are the two largest append-only
      tables; bp26_probe_results (62 k rows) has no retention at all. Restore: read the object named in cold_archive_ledger.r2_key, gunzip, INSERT OR
      IGNORE the lines back (columns are the table's own).

COLD-TIER-2 (2026-11-05, agent_issues 1001971, roadmap RM-D1-RETENTION-1): cron_fire_log (keep 3 days), fleet_runs (7) and analytics_action_log (30) join TIERS.
      A tier may name its own ok and fail expressions (ok_sql, fail_sql), the column that orders "newer" for the keep-latest check (newer: an indexed
      column, so the check seeks instead of scanning the key's whole history), a keep-latest key of any length (the newest row of every (cron_name,
      outcome), (task_id, status) or (trigger_id, status) stays, so "latest ok" and "latest failure" readers still find their row) and space_ts for a
      table whose timestamps read YYYY-MM-DD HH:MM:SS (the cutoff is written the same way, so the keep window is exact). cloud_ops_events is NOT here: its
      id is TEXT, its rowid is not time order (heartbeat rows are upserted), and v_trust_ledger / v_process_last_run read it without a 14 day window
      (agent_issues COLD-TIER-3). Restore is the same as for every tier: gunzip the object, INSERT OR IGNORE the lines.

Runs from scripts/continuity_snapshot.py main() (the remediation-consumer workflow), never raises, prints one JSON line per run.
Self-test: python scripts/cold_tier.py --selftest
"""
import calendar
import gzip
import hashlib
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BUCKET = "qnfo-backups"
COLD_BUDGET_SEC = float(os.environ.get("COLD_BUDGET_SEC") or 150)
CHUNKS_PER_TIER = int(os.environ.get("COLD_CHUNKS_PER_TIER") or 6)
DELETE_BATCH = 400          # D1 rows in one DELETE statement (RETENTION-PRUNE-SPREAD-1: a bigger statement stalls every other query)
DELETE_PAUSE_SEC = 1.0

# table, ts column, keep_days (rows older are archived), mode, keep-latest key, rollup dims, ok column, number columns for v1 (avg) and v2 (max),
# roll_days (how many days back a complete day is still whole in D1), chunk (rows in one object)
TIERS = [
    {"table": "fleet_probe_log", "ts": "ts", "keep_days": 3, "mode": "delete", "latest": ("name", "transport"), "dims": ("name", "transport"),
     "ok": "ok", "num": "ms", "roll_days": 20, "chunk": 800},
    {"table": "bp26_probe_results", "ts": "run_at", "keep_days": 7, "mode": "delete", "latest": ("metric", "subject"), "dims": ("metric", "subject"),
     "ok": "ok", "num": None, "roll_days": 60, "chunk": 800},
    {"table": "remediation_verifications", "ts": "verified_at", "keep_days": 6, "mode": "copy", "latest": None, "dims": ("class", "transport"),
     "ok": "pass", "num": None, "roll_days": 7, "chunk": 2000},
    # COLD-TIER-2. Readers (fleet-graph impact, 2026-11-05): v_cron_activity (7 days), v_cron_faults_worker (2 days; errors since the last ok), cronGridDue (last ok and
    # errors since it, per cron_name) for cron_fire_log; v_cron_faults_task (last 5,000 ids, 24 h), v_cron_activity for fleet_runs; v_persona_recovered_close (newest
    # row per trigger and status) for analytics_action_log. The keep-latest key therefore carries the status column the reader filters on.
    {"table": "cron_fire_log", "ts": "fired_at", "keep_days": 3, "mode": "delete", "latest": ("cron_name", "outcome"), "dims": ("cron_name", "outcome"),
     "ok": None, "ok_sql": "outcome IN ('ok', 'idle')", "fail_sql": "outcome = 'error'", "num": None, "newer": "fired_epoch_ms", "roll_days": 16, "chunk": 800},
    {"table": "fleet_runs", "ts": "started_at", "keep_days": 7, "mode": "delete", "latest": ("task_id", "status"), "dims": ("task_id", "status"),
     "ok": None, "ok_sql": "status = 'ok'", "fail_sql": "status = 'failed'", "num": "cost_neurons", "newer": "id", "roll_days": 16, "chunk": 800},
    {"table": "analytics_action_log", "ts": "fired_at", "keep_days": 30, "mode": "delete", "latest": ("trigger_id", "status"), "dims": ("trigger_id", "status"),
     "ok": None, "ok_sql": "status = 'recovered'", "fail_sql": "status = 'fired'", "num": "metric_value", "newer": "id", "space_ts": True, "roll_days": 70, "chunk": 800},
]
IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


# ---- R2 ------------------------------------------------------------------------------------------------------------------------------
class R2:
    """put/get on qnfo-backups through the Cloudflare API with the repository token (the same path continuity_snapshot.py uses)."""
    def __init__(self, rc):
        self.rc = rc

    def _url(self, key):
        return "%s/accounts/%s/r2/buckets/%s/objects/%s" % (self.rc.CF_API, self.rc.ACCOUNT, BUCKET, urllib.parse.quote(key, safe="/"))

    def put(self, key, data):
        req = urllib.request.Request(self._url(key), data=data, method="PUT",
                                     headers={"Authorization": "Bearer " + self.rc.TOKEN, "Content-Type": "application/gzip"})
        with urllib.request.urlopen(req, timeout=120) as r:
            return 200 <= r.status < 300

    def get(self, key):
        req = urllib.request.Request(self._url(key), method="GET", headers={"Authorization": "Bearer " + self.rc.TOKEN})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            raise


def gz_bytes(rows):
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as g:
        for r in rows:
            g.write((json.dumps(r, separators=(",", ":"), sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8"))
    return buf.getvalue()


def _day(offset_days, now=None):
    return time.strftime("%Y-%m-%d", time.gmtime((now or time.time()) + offset_days * 86400))


def _next_day(day):
    """The calendar day after a YYYY-MM-DD string, in UTC. (mktime minus time.timezone read a local midnight that daylight saving shifted by an hour, so on a machine
    whose zone has DST the rollup loop stayed on the same day for ever; the runners are UTC, a developer machine is not.)"""
    return time.strftime("%Y-%m-%d", time.gmtime(calendar.timegm(time.strptime(day, "%Y-%m-%d")) + 86400))


def _iso(offset_days, now=None):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime((now or time.time()) + offset_days * 86400))


# ---- steps ---------------------------------------------------------------------------------------------------------------------------
def rollup(d1, t, now=None, max_days=40):
    """Rolls up complete days (before today) that are still whole in D1 and not yet in cold_rollup_daily. Returns the days written."""
    tab, ts = t["table"], t["ts"]
    d1_dims = t["dims"]
    first = _day(-t["roll_days"], now)
    today = _day(0, now)
    have = {r["day"] for r in d1("SELECT DISTINCT day FROM cold_rollup_daily WHERE src_table = ?1 AND day >= ?2", [tab, first])}
    bounds = d1('SELECT substr(MIN("%s"), 1, 10) AS lo FROM "%s" WHERE "%s" >= ?1' % (ts, tab, ts), [first])
    lo = (bounds[0]["lo"] if bounds else None) or today
    out, day = [], max(lo, first)
    while day < today and len(out) < max_days:
        if day not in have:
            nxt = _next_day(day)
            ok = t["ok"]
            ok_sql = t.get("ok_sql") or ('"%s" = 1' % ok if ok else "0")
            fail_sql = t.get("fail_sql") or ('"%s" = 0' % ok if ok else "0")
            num_avg = 'ROUND(AVG("%s"), 1)' % t["num"] if t["num"] else "NULL"
            num_max = 'MAX("%s")' % t["num"] if t["num"] else "NULL"
            d1('INSERT OR REPLACE INTO cold_rollup_daily (src_table, day, dim1, dim2, n, n_ok, n_fail, v1, v2) '
               'SELECT ?1, ?2, COALESCE("%s", ""), COALESCE("%s", ""), COUNT(*), COALESCE(SUM(%s), 0), COALESCE(SUM(%s), 0), %s, %s '
               'FROM "%s" WHERE "%s" >= ?2 AND "%s" < ?3 GROUP BY 3, 4' % (d1_dims[0], d1_dims[1], ok_sql, fail_sql, num_avg, num_max, tab, ts, ts),
               [tab, day, nxt])
            d1("INSERT OR IGNORE INTO cold_rollup_daily (src_table, day, dim1, dim2, n, n_ok, n_fail) "
               "SELECT ?1, ?2, '', '', 0, 0, 0 WHERE NOT EXISTS (SELECT 1 FROM cold_rollup_daily WHERE src_table = ?1 AND day = ?2)", [tab, day])
            out.append(day)
        day = _next_day(day)
    return out


def _edge_id(d1, tab, ts, cutoff):
    """The largest id whose ts is below cutoff, found by about 20 primary-key probes (ids follow time in an append-only log), or None.
    A ts scan would read every old row on each run; a table with no index on ts (bp26_probe_results) would read the whole table."""
    r = d1('SELECT MIN(id) AS lo, MAX(id) AS hi FROM "%s"' % tab)
    if not r or r[0]["lo"] is None:
        return None
    lo, hi, best = int(r[0]["lo"]), int(r[0]["hi"]), None
    while lo <= hi:
        mid = (lo + hi) // 2
        row = d1('SELECT id, "%s" AS t FROM "%s" WHERE id >= ?1 ORDER BY id LIMIT 1' % (ts, tab), [mid])
        if not row:
            hi = mid - 1
            continue
        if str(row[0]["t"] or "") < cutoff:
            best = int(row[0]["id"])
            lo = best + 1
        else:
            hi = mid - 1
    return best


def _cutoff(t, now=None):
    """keep_days ago, written the way the table writes its timestamps (a table with space_ts reads YYYY-MM-DD HH:MM:SS, the rest ISO with a T and a Z)."""
    c = _iso(-t["keep_days"], now)
    return c.replace("T", " ").rstrip("Z") if t.get("space_ts") else c


def chunk_sql(t):
    """Delete-mode candidates: rows older than the cutoff whose day is rolled up and that have a NEWER row with the same keep-latest key. "Newer" is read on
    t["newer"] when the table has an index that makes the check a seek (cron_fire_log: cron_name + fired_epoch_ms; fleet_runs and analytics_action_log: the key + id),
    else on the timestamp column."""
    tab, ts = t["table"], t["ts"]
    same = " AND ".join('q."%s" = p."%s"' % (k, k) for k in t["latest"])
    newer = t.get("newer") or ts
    return ('SELECT p.* FROM "%s" p WHERE p.id <= ?1 AND p."%s" < ?2 AND EXISTS (SELECT 1 FROM "%s" q WHERE %s AND q."%s" > p."%s") '
            'AND substr(p."%s", 1, 10) IN (SELECT day FROM cold_rollup_daily WHERE src_table = ?3) '
            'ORDER BY p.id LIMIT %d' % (tab, ts, tab, same, newer, newer, ts, t["chunk"]))


def _chunk_rows(d1, t, now=None):
    """The next chunk of rows to archive, oldest id first, as dicts. Mode delete: rows older than keep_days that have a newer row of the same key;
    mode copy: rows older than keep_days after the last archived id."""
    tab, ts = t["table"], t["ts"]
    cutoff = _cutoff(t, now)
    if t["mode"] == "delete":
        edge = _edge_id(d1, tab, ts, cutoff)
        if edge is None:
            return []
        return d1(chunk_sql(t), [edge, cutoff, tab])
    last = d1("SELECT COALESCE(MAX(id_max), 0) AS m FROM cold_archive_ledger WHERE src_table = ?1 AND verified = 1", [tab])[0]["m"]
    return d1('SELECT * FROM "%s" WHERE id > ?1 AND "%s" < ?2 ORDER BY id LIMIT %d' % (tab, ts, t["chunk"]), [last, cutoff])


def archive_chunk(d1, r2, t, rows, now=None, sleep=time.sleep):
    """Write, read back, verify, ledger, then (delete mode) prune. Returns a small dict; never deletes before the verify passes."""
    tab = t["table"]
    ids = [int(r["id"]) for r in rows]
    lo, hi = min(ids), max(ids)
    data = gz_bytes(rows)
    sha = hashlib.sha256(data).hexdigest()
    key = "cold/qnfo-audit/%s/%s/%s-%d-%d.jsonl.gz" % (tab, time.strftime("%Y%m", time.gmtime(now or time.time())), tab, lo, hi)
    if not r2.put(key, data):
        return {"error": "r2-put-refused", "key": key}
    back = r2.get(key)
    if back is None or hashlib.sha256(back).hexdigest() != sha:
        return {"error": "verify-sha-mismatch", "key": key}
    lines = gzip.decompress(back).decode("utf-8").splitlines()
    if len(lines) != len(rows) or sorted(json.loads(x)["id"] for x in lines) != sorted(ids):
        return {"error": "verify-rows-mismatch", "key": key}
    d1("INSERT INTO cold_archive_ledger (src_table, id_min, id_max, rows, bytes, sha256, r2_key, mode, verified) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1)",
       [tab, lo, hi, len(rows), len(data), sha, key, t["mode"]])
    out = {"key": key, "rows": len(rows), "bytes": len(data)}
    if t["mode"] != "delete":
        return out
    for i in range(0, len(ids), DELETE_BATCH):
        part = ids[i:i + DELETE_BATCH]
        d1('DELETE FROM "%s" WHERE id IN (%s)' % (tab, ",".join(str(x) for x in part)))
        sleep(DELETE_PAUSE_SEC)
    left = int(d1('SELECT COUNT(*) AS n FROM "%s" WHERE id IN (%s)' % (tab, ",".join(str(x) for x in ids[:900])))[0]["n"] or 0)
    d1("UPDATE cold_archive_ledger SET deleted_rows = ?1, deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE r2_key = ?2", [len(ids) - left, key])
    out["deleted"] = len(ids) - left
    return out


def run(d1, r2=None, now=None, sleep=time.sleep, tiers=None, deadline=None):
    out = {"tiers": {}}
    try:
        cfg = d1("SELECT value FROM ops_config WHERE key = 'cold_tier'")
        if cfg and str(cfg[0]["value"]).strip().lower() == "off":
            out["status"] = "off"
            print(json.dumps({"cold-tier": out}))
            return out
        if r2 is None:
            import remediation_consumer as RC
            r2 = R2(RC)
        stop = deadline or (time.time() + COLD_BUDGET_SEC)
        for t in (tiers or TIERS):
            res = out["tiers"].setdefault(t["table"], {"rolled": [], "chunks": 0, "rows": 0, "deleted": 0})
            if not IDENT.match(t["table"]):
                res["error"] = "odd-name"
                continue
            try:
                res["rolled"] = rollup(d1, t, now)
                for _ in range(CHUNKS_PER_TIER):
                    if time.time() > stop:
                        res["stopped"] = "budget"
                        break
                    rows = _chunk_rows(d1, t, now)
                    if not rows:
                        break
                    got = archive_chunk(d1, r2, t, rows, now, sleep)
                    if got.get("error"):
                        res["error"] = got["error"]
                        break
                    res["chunks"] += 1
                    res["rows"] += got["rows"]
                    res["deleted"] += got.get("deleted", 0)
                    if t["mode"] == "copy" and got["rows"] < t["chunk"]:
                        break
            except Exception as e:  # noqa: BLE001
                res["error"] = str(e)[:160]
        if any(v["rows"] or v["rolled"] for v in out["tiers"].values()):
            try:
                d1("INSERT INTO cloud_ops_events (id, ts, kind, status, text, job) VALUES (?1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'cold-tier', 'ok', ?2, 'continuity-snapshot')",
                   ["cold-tier-%d" % int(time.time()), ("COLD-TIER-1: " + json.dumps(out["tiers"]))[:400]])
            except Exception as e:  # noqa: BLE001
                out["event_error"] = str(e)[:120]
    except Exception as e:  # noqa: BLE001
        out["error"] = str(e)[:160]
    print(json.dumps({"cold-tier": out}))
    return out


# ---- self-test -----------------------------------------------------------------------------------------------------------------------
def selftest_tier2(c, d1, st, now, pauses):
    """COLD-TIER-2: the three tiers with their own ok expressions, keep-latest keys, newer columns and timestamp format, on tables shaped like the live ones."""
    c.executescript("""
CREATE TABLE cron_fire_log (id INTEGER PRIMARY KEY AUTOINCREMENT, cron_name TEXT, task_id TEXT, cron_expr TEXT, fired_at TEXT, fired_epoch_ms INTEGER, outcome TEXT, source TEXT, note TEXT);
CREATE INDEX idx_cron_fire_log_name_ms ON cron_fire_log (cron_name, fired_epoch_ms);
CREATE TABLE fleet_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, cron_name TEXT, status TEXT, started_at TEXT, finished_at TEXT, result TEXT, error TEXT, cost_neurons REAL);
CREATE INDEX idx_fleet_runs_task_status ON fleet_runs (task_id, status, id);
CREATE TABLE analytics_action_log (id INTEGER PRIMARY KEY AUTOINCREMENT, trigger_id INTEGER, fired_at TEXT, metric_value REAL, action TEXT, queue_target TEXT, status TEXT, notes TEXT);
CREATE INDEX idx_aal_trigger_id ON analytics_action_log (trigger_id, id);
""")
    T = {x["table"]: x for x in TIERS}
    assert all(n in T for n in ("cron_fire_log", "fleet_runs", "analytics_action_log")), "the three COLD-TIER-2 tiers are in TIERS"
    HOUR = 3600

    def at(age_h):
        return now - age_h * HOUR

    # cron_fire_log: A runs hourly for 6 days (one error 134 h ago); B stopped 4 days ago (hourly ok for 2 days, one error 90 h ago)
    rows = [(h, "A", "error" if h == 134 else "ok") for h in range(144, -1, -1)] + [(h, "B", "ok") for h in range(144, 95, -1)] + [(90, "B", "error")]
    for h, name, out in sorted(rows, key=lambda r: -r[0]):
        c.execute("INSERT INTO cron_fire_log (cron_name, fired_at, fired_epoch_ms, outcome, source) VALUES (?, ?, ?, ?, ?)",
                  [name, _iso(0, at(h))[:-1] + ".123Z", int(at(h) * 1000), out, "worker:" + name])
    # fleet_runs: task X every 12 h for 10 days, one failed run 192 h ago; task Y only recent
    runs = [(h, "X", "failed" if h == 192 else "ok") for h in range(240, -1, -12)] + [(h, "Y", "ok") for h in (30, 20, 10, 1)]
    for h, task, status in sorted(runs, key=lambda r: -r[0]):
        c.execute("INSERT INTO fleet_runs (task_id, cron_name, status, started_at, cost_neurons) VALUES (?, ?, ?, ?, ?)",
                  [task, task, status, _iso(0, at(h))[:-1] + ".500Z", float(h % 5)])
    # analytics_action_log (timestamps with a space): trigger 1 'fired' once a day from 40 days to 6 days ago, trigger 2 'fired' once, 35 days ago
    acts = [(d * 24 + 1, 1, "fired") for d in range(40, 5, -1)] + [(35 * 24 + 2, 2, "fired"), (5 * 24, 1, "recovering"), (24, 1, "recovered")]
    for h, trig, status in sorted(acts, key=lambda r: -r[0]):
        c.execute("INSERT INTO analytics_action_log (trigger_id, fired_at, metric_value, action, status) VALUES (?, ?, 1.5, 'a', ?)",
                  [trig, _iso(0, at(h)).replace("T", " ").rstrip("Z"), status])
    c.commit()
    tiers = [dict(T["cron_fire_log"], chunk=100), dict(T["fleet_runs"], chunk=100), dict(T["analytics_action_log"], chunk=100)]
    before = {t["table"]: d1('SELECT COUNT(*) n FROM "%s"' % t["table"])[0]["n"] for t in tiers}
    # the correlated keep-latest check must be an index seek on every new tier, never a scan of the key's whole history
    for t in tiers:
        plan = " | ".join(r["detail"] for r in d1("EXPLAIN QUERY PLAN " + chunk_sql(t), [10 ** 9, "9", t["table"]]))
        assert re.search(r"SEARCH q USING (COVERING )?INDEX idx_", plan), (t["table"], plan)
    for _ in range(12):
        r = run(d1, st, now, pauses.append, tiers)
        assert all("error" not in v for v in r["tiers"].values()), r
    for t in tiers:
        tab = t["table"]
        cut = _cutoff(t, now)
        led = d1("SELECT SUM(rows) r, SUM(deleted_rows) d, MIN(verified) v, COUNT(*) n FROM cold_archive_ledger WHERE src_table = ?", [tab])[0]
        left = d1('SELECT COUNT(*) n FROM "%s"' % tab)[0]["n"]
        assert led["n"] >= 1 and led["v"] == 1 and led["r"] == led["d"] == before[tab] - left, (tab, led, before[tab], left)
        old = d1('SELECT COUNT(*) n FROM "%s" WHERE "%s" < ?' % (tab, t["ts"]), [cut])[0]["n"]
        want = {"cron_fire_log": 3, "fleet_runs": 1, "analytics_action_log": 1}[tab]
        assert old == want, (tab, "rows older than the cutoff that stay are exactly the newest of their key", old, want)
        seen = []
        for k, v in st.o.items():
            if "/%s/" % tab in k:
                seen += [json.loads(x)["id"] for x in gzip.decompress(v).decode().splitlines()]
        assert len(seen) == len(set(seen)) == led["r"], (tab, len(seen), led["r"])
        ro = d1("SELECT SUM(n) n, SUM(n_ok) o, SUM(n_fail) f, MAX(day) hi FROM cold_rollup_daily WHERE src_table = ?", [tab])[0]
        assert ro["n"] >= led["r"] and ro["hi"] < _day(0, now), (tab, ro)
    # the readers' "latest ok" and "latest failure" rows are still there
    b = {x["outcome"]: x["h"] for x in d1("SELECT outcome, MIN(CAST((? - fired_epoch_ms) / 3600000 AS INTEGER)) h FROM cron_fire_log WHERE cron_name = 'B' GROUP BY outcome", [int(now * 1000)])}
    assert b == {"ok": 96, "error": 90}, b
    assert d1("SELECT COUNT(*) n FROM cron_fire_log WHERE cron_name = 'A' AND outcome = 'error'")[0]["n"] == 1
    assert d1("SELECT COUNT(*) n FROM fleet_runs WHERE task_id = 'X' AND status = 'failed'")[0]["n"] == 1
    assert d1("SELECT COUNT(*) n FROM analytics_action_log WHERE trigger_id = 2")[0]["n"] == 1
    # rollup expressions: ok_sql and fail_sql counted by the tier's own meaning, not by an ok column
    rc = d1("SELECT SUM(n_ok) o, SUM(n_fail) f FROM cold_rollup_daily WHERE src_table = 'cron_fire_log' AND dim1 = 'A'")[0]
    assert rc["f"] == 1 and rc["o"] >= 100, rc
    rf = d1("SELECT SUM(n_ok) o, SUM(n_fail) f, MAX(v2) m FROM cold_rollup_daily WHERE src_table = 'fleet_runs' AND dim1 = 'X'")[0]
    assert rf["f"] == 1 and rf["o"] >= 10 and rf["m"] is not None, rf
    ra = d1("SELECT SUM(n) n FROM cold_rollup_daily WHERE src_table = 'analytics_action_log' AND dim1 = '2'")[0]
    assert ra["n"] == 1, ra
    # a timestamp written with a space is compared as written: the cutoff of that tier has no T and no Z
    assert " " in _cutoff(T["analytics_action_log"], now) and "T" not in _cutoff(T["analytics_action_log"], now) and "T" in _cutoff(T["cron_fire_log"], now)


def selftest():
    import sqlite3
    c = sqlite3.connect(":memory:")
    c.executescript("""
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, status TEXT, text TEXT, job TEXT);
CREATE TABLE cold_archive_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, src_table TEXT NOT NULL, id_min INTEGER, id_max INTEGER, rows INTEGER, bytes INTEGER, sha256 TEXT, r2_key TEXT,
  mode TEXT, verified INTEGER DEFAULT 0, deleted_rows INTEGER DEFAULT 0, deleted_at TEXT, archived_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
CREATE TABLE cold_rollup_daily (src_table TEXT, day TEXT, dim1 TEXT, dim2 TEXT, n INTEGER, n_ok INTEGER, n_fail INTEGER, v1 REAL, v2 REAL,
  rolled_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), PRIMARY KEY (src_table, day, dim1, dim2));
CREATE TABLE fleet_probe_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, source TEXT, name TEXT, url TEXT, transport TEXT, ok INTEGER, status INTEGER, ms INTEGER, body TEXT);
CREATE INDEX idx_fpl_ts ON fleet_probe_log(ts);
CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, class TEXT, transport TEXT, pass INTEGER, verified_at TEXT);
""")

    def d1(sql, params=None):
        cur = c.execute(sql, params or [])
        cols = [x[0] for x in cur.description] if cur.description else []
        return [dict(zip(cols, r)) for r in cur.fetchall()]

    class Store:
        def __init__(self):
            self.o, self.corrupt = {}, False

        def put(self, key, data):
            self.o[key] = data
            return True

        def get(self, key):
            v = self.o.get(key)
            return (v[:-3] + b"xyz") if (v and self.corrupt) else v

    now = time.time()
    iso = lambda d, h=0: _iso(-d, now - h * 3600)  # noqa: E731
    for i in range(1200):      # 1,200 old rows over 5 days, oldest first (3 probes, p0 also has a recent row, p1 and p2 do not: their newest old row must stay)
        c.execute("INSERT INTO fleet_probe_log (ts, name, transport, ok, ms) VALUES (?, ?, 'http', ?, ?)", [_iso(0, now - 8 * 86400 + i * 300), "p%d" % (i % 3), 1 if i % 4 else 0, 10 + i % 7])
    c.execute("INSERT INTO fleet_probe_log (ts, name, transport, ok, ms) VALUES (?, 'p0', 'http', 1, 5)", [iso(0, 1)])
    for i in range(300):
        c.execute("INSERT INTO remediation_verifications (class, transport, pass, verified_at) VALUES ('c', 'd1', ?, ?)", [i % 2, _iso(0, now - 8 * 86400 + i * 60)])
    for i in range(50):
        c.execute("INSERT INTO remediation_verifications (class, transport, pass, verified_at) VALUES ('c', 'd1', 1, ?)", [iso(1, i % 5)])
    c.commit()
    tiers = [dict(TIERS[0], chunk=300), dict(TIERS[2], chunk=100)]
    live0 = d1("SELECT COUNT(*) n FROM fleet_probe_log")[0]["n"]
    keep_latest = {r["name"]: r["id"] for r in d1("SELECT name, MAX(id) id FROM fleet_probe_log GROUP BY name")}
    st = Store()
    pauses = []
    r = run(d1, st, now, pauses.append, tiers)
    f = r["tiers"]["fleet_probe_log"]
    assert "error" not in f and f["chunks"] >= 1 and f["rolled"], f
    # run to completion
    for _ in range(10):
        r = run(d1, st, now, pauses.append, tiers)
    live1 = d1("SELECT COUNT(*) n FROM fleet_probe_log")[0]["n"]
    led = d1("SELECT SUM(rows) r, SUM(deleted_rows) d, MIN(verified) v FROM cold_archive_ledger WHERE src_table = 'fleet_probe_log'")[0]
    assert led["r"] == led["d"] == live0 - live1 and led["v"] == 1, (led, live0, live1)
    assert live1 >= 1 and all(d1("SELECT COUNT(*) n FROM fleet_probe_log WHERE name = ?", [n])[0]["n"] >= 1 for n in ("p0", "p1", "p2")), "the newest row of every key stays"
    assert d1("SELECT COUNT(*) n FROM fleet_probe_log WHERE id IN (%s)" % ",".join(str(i) for i in keep_latest.values()))[0]["n"] == 3
    assert d1("SELECT COUNT(*) n FROM fleet_probe_log WHERE ts < ?", [iso(3)])[0]["n"] <= 2 and max(pauses) == DELETE_PAUSE_SEC
    # every archived row is in an object, once
    seen = []
    for k, v in st.o.items():
        if "/fleet_probe_log/" in k:
            seen += [json.loads(x)["id"] for x in gzip.decompress(v).decode().splitlines()]
    assert len(seen) == len(set(seen)) == live0 - live1, (len(seen), live0 - live1)
    # rollup: complete days only, counts add up to the rows that existed when the day was rolled
    ro = d1("SELECT SUM(n) n, SUM(n_ok) o, SUM(n_fail) f, MIN(day) lo, MAX(day) hi FROM cold_rollup_daily WHERE src_table = 'fleet_probe_log'")[0]
    assert ro["n"] == ro["o"] + ro["f"] and ro["hi"] < _day(0, now) and ro["n"] >= live0 - live1, ro
    # copy mode: archived, never deleted, resumed from the ledger
    rv = d1("SELECT SUM(rows) r, MAX(id_max) m FROM cold_archive_ledger WHERE src_table = 'remediation_verifications'")[0]
    assert rv["r"] == 300 and d1("SELECT COUNT(*) n FROM remediation_verifications")[0]["n"] == 350, rv
    assert d1("SELECT SUM(deleted_rows) d FROM cold_archive_ledger WHERE src_table = 'remediation_verifications'")[0]["d"] == 0
    # a failed read-back deletes nothing and writes no ledger row
    c.execute("DELETE FROM fleet_probe_log")
    for i in range(400):
        c.execute("INSERT INTO fleet_probe_log (ts, name, transport, ok, ms) VALUES (?, 'q', 'http', 1, 1)", [_iso(0, now - 6 * 86400 + i * 300)])
    c.execute("INSERT INTO fleet_probe_log (ts, name, transport, ok, ms) VALUES (?, 'q', 'http', 1, 1)", [iso(0, 1)])
    c.commit()
    n_led, n_rows = d1("SELECT COUNT(*) n FROM cold_archive_ledger")[0]["n"], d1("SELECT COUNT(*) n FROM fleet_probe_log")[0]["n"]
    st.corrupt = True
    bad = run(d1, st, now, pauses.append, [dict(TIERS[0], chunk=300)])
    assert bad["tiers"]["fleet_probe_log"]["error"] == "verify-sha-mismatch", bad
    assert d1("SELECT COUNT(*) n FROM cold_archive_ledger")[0]["n"] == n_led and d1("SELECT COUNT(*) n FROM fleet_probe_log")[0]["n"] == n_rows
    st.corrupt = False
    selftest_tier2(c, d1, st, now, pauses)
    # kill switch
    d1("INSERT INTO ops_config VALUES ('cold_tier', 'off')")
    assert run(d1, st, now, pauses.append, tiers)["status"] == "off" and d1("SELECT COUNT(*) n FROM fleet_probe_log")[0]["n"] == n_rows
    print("cold_tier selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import remediation_consumer as RC  # noqa: E402
        run(RC.d1)
