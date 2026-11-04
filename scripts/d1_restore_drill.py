#!/usr/bin/env python3
"""RESTORE-DRILL-1 (2026-11-04, charter pillar: core; doctrine section 14 continuity, section 12 SPOF 'qnfo-audit D1').

WHAT  A backup that was never restored is a belief. Weekly, this step restores real exports from R2 qnfo-backups into a
      scratch D1 database and compares what came back with what the ledger says was exported:
        - each small database's newest ok export (portfolio-state, qnfo-cms, ipatent-db): schema from its _schema.jsonl.gz
          (live schema when the export predates RESTORE-SCHEMA-1, recorded as schema_source=live), then every table's rows;
        - qnfo-audit's newest ok daily snapshot (the 22 state tables), up to DRILL_ROW_CAP rows per table;
        - the Time Travel bookmark for one day ago is requested, proving the 30-day history answers.
      Per table the restored count must equal min(exported rows, DRILL_ROW_CAP) and the last restored row must equal the last
      source row. The scratch database (name prefix drill-restore-) is always deleted afterwards. One row per target goes to
      d1_export_restore_drills; a passing qnfo-audit target stamps spof_registry 'qnfo-audit D1'.
      qnfo-identity and qnfo-outreach are never read (private; the run log is public) and no row content is printed.
"""
import calendar
import gzip
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import remediation_consumer as RC  # noqa: E402
import continuity_snapshot as CS  # noqa: E402

DRILL_EXPORTS = ["portfolio-state", "qnfo-cms", "ipatent-db"]
AUDIT_STATE = "qnfo-audit-state"
DRILL_ROW_CAP = int(os.environ.get("DRILL_ROW_CAP") or 500)
DRILL_MAX_AGE_DAYS = 6
# Six hours, two heavy-job windows: the five attempt rows on file (2026-11-04 19:06-19:43Z) were written by code with a 270 s budget and a step killed at 8 minutes, so the
# first attempt with the repaired budget should not wait a day; a drill that keeps failing still costs at most four attempts a day.
DRILL_RETRY_HOURS = int(os.environ.get("DRILL_RETRY_HOURS") or 6)
SCRATCH_PREFIX = "drill-restore-"
BUDGET_SEC = float(os.environ.get("DRILL_BUDGET_SEC") or 840)
_STARTED = time.time()


def r2_get_bytes(key):
    """Raw bytes of an R2 object, or None when it does not exist."""
    url = RC.CF_API + "/accounts/%s/r2/buckets/%s/objects/%s" % (RC.ACCOUNT, CS.BUCKET, urllib.parse.quote(key, safe="/"))
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + RC.TOKEN})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def api(method, path, body=None):
    st, j = CS.cf(method, path, json.dumps(body).encode("utf-8") if body is not None else None, "application/json" if body is not None else None, 90)
    return j


def read_rows(r2get, prefix, table, cap):
    """Rows of one exported table from its part files, at most cap. Returns (rows, parts_found)."""
    rows, parts, i = [], 0, 0
    while len(rows) < cap:
        name = "%s.jsonl.gz" % table if i == 0 else "%s.part%d.jsonl.gz" % (table, i)
        blob = r2get(prefix + name)
        if blob is None:
            break
        parts += 1
        for line in gzip.decompress(blob).decode("utf-8").splitlines():
            if line:
                rows.append(json.loads(line))
                if len(rows) >= cap:
                    break
        i += 1
    return rows, parts


def restorable_tables(schema):
    """(table ddl list, index ddl list): plain tables only; virtual tables and their shadow tables are rebuilt by the
    application, and triggers are left out so a restore does not fire them."""
    virtual = [r["name"] for r in schema if r.get("type") == "table" and str(r.get("sql") or "").upper().startswith("CREATE VIRTUAL")]
    tables = [r for r in schema if r.get("type") == "table" and not str(r.get("sql") or "").upper().startswith("CREATE VIRTUAL")
              and not any(r["name"].startswith(v + "_") for v in virtual)]
    return tables, [r for r in schema if r.get("type") == "index"]


def restore_target(target, prefix, tables_meta, schema, scratch_q, r2get, cap=DRILL_ROW_CAP, deadline=None):
    """Restores into the scratch database behind scratch_q(sql, params). Returns (tables_ok, tables_total, rows, problems)."""
    tabs, idxs = restorable_tables(schema)
    ok, total, rows_back, problems = 0, 0, 0, []
    for t in tabs:
        name = t["name"]
        if name not in tables_meta:
            continue
        if deadline and time.time() >= deadline:
            problems.append("budget: stopped before %s" % name)
            break
        total += 1
        meta = tables_meta[name]
        want = int(meta[1] if isinstance(meta, list) else meta.get("snapshot", 0))
        want = min(want, cap)
        try:
            scratch_q(t["sql"], [])
            src, parts = read_rows(r2get, prefix, name, cap)
            if len(src) != want:
                problems.append("%s: R2 holds %d rows, ledger says %d" % (name, len(src), want))
                continue
            if src:
                cols = [c for c in src[0].keys() if c != "_rowid"]
                step = max(1, 90 // max(1, len(cols)))
                qc = ",".join('"%s"' % c.replace('"', '""') for c in cols)
                one = "(" + ",".join("?" * len(cols)) + ")"
                for i in range(0, len(src), step):
                    chunk = src[i:i + step]
                    scratch_q('INSERT INTO "%s" (%s) VALUES %s' % (name.replace('"', '""'), qc, ",".join([one] * len(chunk))),
                              [v for r in chunk for v in (r.get(c) for c in cols)])
            back = int((scratch_q('SELECT COUNT(*) AS n FROM "%s"' % name.replace('"', '""'), []) or [{"n": 0}])[0]["n"])
            if back != want:
                problems.append("%s: restored %d of %d" % (name, back, want))
                continue
            if src:
                qn = name.replace('"', '""')
                try:
                    last = scratch_q('SELECT * FROM "%s" ORDER BY rowid DESC LIMIT 1' % qn, [])
                except Exception:  # noqa: BLE001 - WITHOUT ROWID table: rows come back in primary-key order
                    last = scratch_q('SELECT * FROM "%s" LIMIT 1 OFFSET %d' % (qn, want - 1), [])
                cols = [c for c in src[-1].keys() if c != "_rowid"]
                if last and {c: last[0].get(c) for c in cols} != {c: src[-1].get(c) for c in cols} and len(src) == want:
                    problems.append("%s: last row differs" % name)
                    continue
            ok += 1
            rows_back += back
        except Exception as e:  # noqa: BLE001
            problems.append("%s: %s" % (name, str(e)[:100]))
    for ix in idxs:
        try:
            if ix.get("tbl_name") in tables_meta:
                scratch_q(ix["sql"], [])
        except Exception:  # noqa: BLE001 - indexes are an optimisation; the data is what is proved
            pass
    return ok, total, rows_back, problems


def load_schema(r2get, prefix, live_q, names):
    blob = r2get(prefix + "_schema.jsonl.gz")
    if blob is not None:
        return [json.loads(x) for x in gzip.decompress(blob).decode("utf-8").splitlines() if x], "export"
    inlist = ",".join("'%s'" % n.replace("'", "") for n in names)
    return live_q("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND (name IN (%s) OR tbl_name IN (%s)) "
                  "ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name" % (inlist, inlist)), "live"


def latest_export(d1, database):
    if database == AUDIT_STATE:
        pat = CS.BUCKET + "/continuity/qnfo-audit/%"
    else:
        pat = CS.BUCKET + "/export/" + database + "/%"
    rows = d1("SELECT r2_prefix, tables_json, ts FROM continuity_snapshots WHERE ok = 1 AND r2_prefix LIKE ?1 ORDER BY id DESC LIMIT 1", [pat])
    return rows[0] if rows else None


def drill_target(d1, plane, database, make_scratch, r2get, now=time.time, deadline=None):
    t0 = now()
    led = latest_export(d1, database)
    rec = {"target": database, "scratch_db": None, "tables_total": 0, "tables_ok": 0, "rows_restored": 0, "schema_source": None,
           "ok": 0, "seconds": 0, "note": "", "source_prefix": None}
    if not led:
        rec["note"] = "no ok export to restore"
        return rec
    prefix = led["r2_prefix"][len(CS.BUCKET) + 1:]
    rec["source_prefix"] = led["r2_prefix"]
    meta = json.loads(led["tables_json"])
    tables_meta = meta["tables"] if database != AUDIT_STATE else meta
    live_q = (lambda sql: d1(sql)) if database == AUDIT_STATE else (lambda sql: plane("d1-query@" + database, sql))
    schema, src = load_schema(r2get, prefix, live_q, list(tables_meta.keys()))
    rec["schema_source"] = src
    name, scratch_q, cleanup = make_scratch(database)
    rec["scratch_db"] = name
    try:
        ok, total, rows, problems = restore_target(database, prefix, tables_meta, schema, scratch_q, r2get, DRILL_ROW_CAP, deadline)
        rec.update(tables_ok=ok, tables_total=total, rows_restored=rows)
        rec["ok"] = 1 if (total and ok == total and not problems) else 0
        rec["note"] = ("ok" if rec["ok"] else "; ".join(problems)[:380] or "no tables restored")
    finally:
        cleanup()
    rec["seconds"] = int(now() - t0)
    return rec


def real_scratch():
    def make(database):
        name = "%s%s-%s" % (SCRATCH_PREFIX, database, time.strftime("%Y%m%d%H%M%S", time.gmtime()))
        j = api("POST", "/accounts/%s/d1/database" % RC.ACCOUNT, {"name": name})
        uuid = (j.get("result") or {}).get("uuid")
        if not uuid:
            raise RuntimeError("scratch database not created: %s" % json.dumps(j.get("errors"))[:160])

        def q(sql, params):
            r = api("POST", "/accounts/%s/d1/database/%s/query" % (RC.ACCOUNT, uuid), {"sql": sql, "params": params})
            res = r.get("result") or []
            return (res[0].get("results") or []) if res else []

        def cleanup():
            if name.startswith(SCRATCH_PREFIX):
                try:
                    CS.cf("DELETE", "/accounts/%s/d1/database/%s" % (RC.ACCOUNT, uuid))
                except Exception as e:  # noqa: BLE001
                    print(json.dumps({"restore-drill": "scratch-delete-failed", "db": name, "error": str(e)[:120]}))
        return name, q, cleanup
    return make


def time_travel_day_ago(call=CS.cf):
    """The bookmark for one day ago, proving point-in-time history answers (not a restore of the live database)."""
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 86400))
    try:
        st, j = call("GET", "/accounts/%s/d1/database/%s/time_travel/bookmark?timestamp=%s" % (RC.ACCOUNT, RC.resolve_db_id(), urllib.parse.quote(ts)))
        return bool(((j or {}).get("result") or {}).get("bookmark"))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"restore-drill": "time-travel-history-failed", "error": str(e)[:160]}))
        return False


def record(d1, rec):
    d1("INSERT INTO d1_export_restore_drills (target, source_prefix, scratch_db, tables_total, tables_ok, rows_restored, schema_source, ok, seconds, note) "
       "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
       [rec["target"], rec["source_prefix"], rec["scratch_db"], rec["tables_total"], rec["tables_ok"], rec["rows_restored"],
        rec["schema_source"], rec["ok"], rec["seconds"], rec["note"][:400]])
    d1("INSERT INTO cloud_ops_events (id, ts, kind, status, text, job) VALUES (?1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'd1-restore-drill', ?2, ?3, 'restore-drill')",
       ["restore-drill-%s-%s" % (rec["target"], time.strftime("%Y%m%d%H%M%S", time.gmtime())), "ok" if rec["ok"] else "warn",
        ("RESTORE-DRILL-1 %s: %d/%d tables, %d rows, schema %s; %s" % (rec["target"], rec["tables_ok"], rec["tables_total"], rec["rows_restored"], rec["schema_source"], rec["note"]))[:400]])


SCRATCH_MAX_AGE_S = 7200


def sweep_scratch(call=None, now=time.time, max_age_s=SCRATCH_MAX_AGE_S):
    """CONSUMER-SPEED-3 (2026-11-04): deletes scratch databases a killed drill left behind. The drill deletes its own scratch database in a finally block, but a step
    timeout or a cancelled job ends the process before it runs: three drill-restore-* databases were in the account on 2026-11-04 (20:09, 20:57, 21:37Z). Only a database
    whose name starts with SCRATCH_PREFIX (the name the drill gives its own, checked again here after the API's substring filter) and that is older than max_age_s, so a drill
    in progress is never touched. Never raises; returns the counts."""
    call = call or CS.cf
    out = {"deleted": 0, "kept": 0, "errors": 0}
    try:
        st, j = call("GET", "/accounts/%s/d1/database?name=%s&per_page=100" % (RC.ACCOUNT, urllib.parse.quote(SCRATCH_PREFIX)))
        for db in (j or {}).get("result") or []:
            name, uuid = str(db.get("name") or ""), db.get("uuid")
            if not name.startswith(SCRATCH_PREFIX) or not uuid:
                continue
            try:
                created = calendar.timegm(time.strptime(str(db.get("created_at") or "")[:19], "%Y-%m-%dT%H:%M:%S"))
            except ValueError:
                out["kept"] += 1  # a creation time that cannot be read is not evidence that the database is old
                continue
            if now() - created < max_age_s:
                out["kept"] += 1
                continue
            try:
                call("DELETE", "/accounts/%s/d1/database/%s" % (RC.ACCOUNT, uuid))
                out["deleted"] += 1
            except Exception as e:  # noqa: BLE001
                out["errors"] += 1
                print(json.dumps({"restore-drill": "scratch-sweep-delete-failed", "db": name, "error": str(e)[:120]}))
    except Exception as e:  # noqa: BLE001
        out["error"] = str(e)[:160]
    print(json.dumps({"restore-drill": {"scratch-sweep": out}}))
    return out


def main(argv=None, d1=None, plane=None, make_scratch=None, r2get=None, history=None, targets=None):
    argv = argv if argv is not None else sys.argv[1:]
    d1, plane = CS.retrying(d1 or RC.d1), CS.retrying(plane or RC.d1_plane)
    r2get = r2get or r2_get_bytes
    if make_scratch is None:  # the live step; the offline suite injects its own scratch databases and never reaches the account
        sweep_scratch()
    if "--force" not in argv:
        fresh = d1("SELECT id FROM d1_export_restore_drills WHERE ok = 1 AND ts > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?1) LIMIT 1", ["-%d days" % DRILL_MAX_AGE_DAYS])
        if fresh:
            print(json.dumps({"restore-drill": "fresh"}))
            return 0
        # CONSUMER-SPEED-1 (2026-11-04): a drill that did not pass leaves no ok row, so the 6-day gate above never opened and every consumer run
        # spent 5 to 8 minutes on a drill that failed the same way (5 attempt rows in 2 hours, 3 scratch databases left behind when the step
        # timeout killed it). An attempt of any outcome now holds the next one for DRILL_RETRY_HOURS; the failed rows stay as evidence.
        tried = d1("SELECT id FROM d1_export_restore_drills WHERE ts > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?1) LIMIT 1", ["-%d hours" % DRILL_RETRY_HOURS])
        if tried:
            print(json.dumps({"restore-drill": "attempted-recently", "retry_hours": DRILL_RETRY_HOURS}))
            return 0
    make_scratch = make_scratch or real_scratch()
    hist = history() if history else time_travel_day_ago()
    out, deadline = {}, _STARTED + BUDGET_SEC
    for tgt in (targets or [AUDIT_STATE] + DRILL_EXPORTS):
        if tgt in CS.EXPORT_REFUSED:
            continue
        try:
            rec = drill_target(d1, plane, tgt, make_scratch, r2get, deadline=deadline)
        except Exception as e:  # noqa: BLE001
            rec = {"target": tgt, "source_prefix": None, "scratch_db": None, "tables_total": 0, "tables_ok": 0, "rows_restored": 0,
                   "schema_source": None, "ok": 0, "seconds": 0, "note": "failed: %s" % str(e)[:300]}
        if tgt == AUDIT_STATE and rec["ok"] and not hist:
            rec["ok"], rec["note"] = 0, "restore ok but Time Travel history for one day ago did not answer"
        record(d1, rec)
        out[tgt] = "ok" if rec["ok"] else "fail"
        if tgt == AUDIT_STATE and rec["ok"]:
            d1("UPDATE spof_registry SET alternate_path = ?1, alternate_tested_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE component = 'qnfo-audit D1'",
               ["D1 Time Travel bookmark (30 days, one-day-ago bookmark checked) plus a daily logical snapshot and a weekly full export to R2 qnfo-backups; "
                "RESTORE-DRILL-1 rebuilds them into a scratch D1 weekly and compares counts (scripts/d1_restore_drill.py, table d1_export_restore_drills)"])
    print(json.dumps({"restore-drill": out, "time_travel_history": bool(hist)}))
    return 0


def selftest():
    import sqlite3
    audit = sqlite3.connect(":memory:")
    audit.executescript("""
CREATE TABLE continuity_snapshots (id INTEGER PRIMARY KEY, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), tables_json TEXT, rows_total INTEGER, bytes INTEGER, sha256 TEXT, r2_prefix TEXT, artifact TEXT, time_travel_bookmark TEXT, integrity REAL, ok INTEGER, note TEXT);
CREATE TABLE d1_export_restore_drills (id INTEGER PRIMARY KEY, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), target TEXT, source_prefix TEXT, scratch_db TEXT, tables_total INTEGER, tables_ok INTEGER, rows_restored INTEGER, schema_source TEXT, ok INTEGER, seconds INTEGER, note TEXT);
CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, status TEXT, text TEXT, job TEXT);
CREATE TABLE spof_registry (component TEXT, alternate_path TEXT, alternate_tested_at TEXT);
INSERT INTO spof_registry VALUES ('qnfo-audit D1', NULL, NULL);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY, actor TEXT, note TEXT);
CREATE INDEX decision_log_actor ON decision_log (actor);
CREATE TABLE tag_kv (k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID;
""")
    audit.executemany("INSERT INTO decision_log VALUES (?,?,?)", [(i, "a%d" % (i % 7), "n%d" % i) for i in range(1, 2501)])
    audit.executemany("INSERT INTO tag_kv VALUES (?,?)", [("a", "1"), ("b", None)])
    other = sqlite3.connect(":memory:")
    other.executescript("CREATE TABLE decisions (id INTEGER PRIMARY KEY, t TEXT, n REAL); INSERT INTO decisions VALUES (1,'x',1.5),(2,NULL,2);")
    dbs = {"qnfo-audit": audit, "portfolio-state": other}

    def run(db, sql, params=None):
        cur = db.execute(sql, params or [])
        cols = [d[0] for d in cur.description] if cur.description else []
        return [dict(zip(cols, x)) for x in cur.fetchall()]
    d1 = lambda sql, params=None: run(audit, sql, params)  # noqa: E731
    plane = lambda transport, sql: run(dbs[transport.split("@", 1)[1]], sql)  # noqa: E731
    store = {}

    def put(key, rows):
        store[key] = CS.gz_lines(rows)

    # exports as continuity_snapshot writes them
    put("continuity/qnfo-audit/20261104T000000Z/decision_log.jsonl.gz", [dict(r, _rowid=r["id"]) for r in run(audit, "SELECT * FROM decision_log")[:2500]])
    put("continuity/qnfo-audit/20261104T000000Z/tag_kv.jsonl.gz", run(audit, "SELECT * FROM tag_kv"))
    put("export/portfolio-state/20261104/decisions.jsonl.gz", [dict(r, _rowid=r["id"]) for r in run(other, "SELECT * FROM decisions")])
    put("export/portfolio-state/20261104/_schema.jsonl.gz", run(other, SCHEMA))
    audit.execute("INSERT INTO continuity_snapshots (tables_json, rows_total, bytes, sha256, r2_prefix, integrity, ok) VALUES (?,?,?,?,?,?,?)",
                  [json.dumps({"decision_log": {"live": 2500, "snapshot": 2500}, "tag_kv": {"live": 2, "snapshot": 2}}), 2502, 1, "x",
                   "qnfo-backups/continuity/qnfo-audit/20261104T000000Z/", 1.0, 1])
    audit.execute("INSERT INTO continuity_snapshots (tables_json, rows_total, bytes, sha256, r2_prefix, integrity, ok) VALUES (?,?,?,?,?,?,?)",
                  [json.dumps({"database": "portfolio-state", "tables": {"decisions": [2, 2]}}), 2, 1, "x", "qnfo-backups/export/portfolio-state/20261104/", 1.0, 1])
    scratches, deleted = [], []

    def make_scratch(database):
        db = sqlite3.connect(":memory:")
        name = SCRATCH_PREFIX + database
        scratches.append((name, db))
        return name, (lambda sql, params: run(db, sql, params)), (lambda: deleted.append(name))
    r2get = lambda key: store.get(key)  # noqa: E731
    assert main(["--force"], d1, plane, make_scratch, r2get, history=lambda: True, targets=[AUDIT_STATE, "portfolio-state", "qnfo-identity"]) == 0
    rows = run(audit, "SELECT target, ok, tables_ok, tables_total, rows_restored, schema_source, note FROM d1_export_restore_drills ORDER BY id")
    assert [r["target"] for r in rows] == [AUDIT_STATE, "portfolio-state"], rows  # private databases never drilled
    a, p = rows
    assert a["ok"] == 1 and a["tables_ok"] == 2 and a["rows_restored"] == DRILL_ROW_CAP + 2 and a["schema_source"] == "live", a  # capped sample; live schema before RESTORE-SCHEMA-1
    assert p["ok"] == 1 and p["rows_restored"] == 2 and p["schema_source"] == "export", p
    assert sorted(deleted) == sorted(n for n, _ in scratches) and len(deleted) == 2  # scratch always deleted
    assert run(audit, "SELECT alternate_tested_at FROM spof_registry")[0]["alternate_tested_at"]
    # a skipped restore is caught: drop one R2 object and the drill fails with the table named
    del store["export/portfolio-state/20261104/decisions.jsonl.gz"]
    rec = drill_target(d1, plane, "portfolio-state", make_scratch, r2get)
    assert rec["ok"] == 0 and "decisions" in rec["note"], rec
    # fresh: no second run inside the window
    assert main([], d1, plane, make_scratch, r2get, history=lambda: True, targets=[]) == 0
    # a failed Time Travel history check fails the audit target even when rows came back
    audit.execute("DELETE FROM d1_export_restore_drills")
    main(["--force"], d1, plane, make_scratch, r2get, history=lambda: False, targets=[AUDIT_STATE])
    assert run(audit, "SELECT ok FROM d1_export_restore_drills")[0]["ok"] == 0
    # CONSUMER-SPEED-1: that failed attempt holds the next one for DRILL_RETRY_HOURS (no 6-day ok row exists to hold it), and releases it 7 hours later
    n_before = len(scratches)
    assert main([], d1, plane, make_scratch, r2get, history=lambda: True, targets=[AUDIT_STATE]) == 0
    assert len(scratches) == n_before and len(run(audit, "SELECT id FROM d1_export_restore_drills")) == 1, "a failed drill 0 hours ago must not start another"
    audit.execute("UPDATE d1_export_restore_drills SET ts = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-7 hours')")
    assert main([], d1, plane, make_scratch, r2get, history=lambda: True, targets=[AUDIT_STATE]) == 0
    assert len(scratches) == n_before + 1 and len(run(audit, "SELECT id FROM d1_export_restore_drills")) == 2, "a failed drill 7 hours ago is retried"
    # CONSUMER-SPEED-3: leaked scratch databases are deleted when old enough, and nothing else is
    t_now = calendar.timegm(time.strptime("2026-11-04T22:00:00", "%Y-%m-%dT%H:%M:%S"))
    listing = {"result": [
        {"name": "drill-restore-qnfo-audit-state-20261104190902", "uuid": "u-old", "created_at": "2026-11-04T19:09:02.609Z"},
        {"name": "drill-restore-qnfo-audit-state-20261104215900", "uuid": "u-young", "created_at": "2026-11-04T21:59:00.000Z"},
        {"name": "my-drill-restore-lookalike", "uuid": "u-substring", "created_at": "2026-10-01T00:00:00.000Z"},
        {"name": "qnfo-audit", "uuid": "u-real", "created_at": "2026-05-28T05:26:46.326Z"},
        {"name": "drill-restore-bad-date", "uuid": "u-baddate", "created_at": "not a date"}]}
    seen = []

    def fake_call(method, path, body=None, ctype=None, timeout=60):
        seen.append((method, path))
        return 200, listing if method == "GET" else {}
    r = sweep_scratch(fake_call, now=lambda: t_now)
    assert r == {"deleted": 1, "kept": 2, "errors": 0}, r
    assert [p for m, p in seen if m == "DELETE"] == ["/accounts/%s/d1/database/u-old" % RC.ACCOUNT], seen  # not the young one, the lookalike, the real database or the unreadable date

    def failing_call(method, path, body=None, ctype=None, timeout=60):
        if method == "DELETE":
            raise RuntimeError("HTTP 500")
        return 200, listing
    assert sweep_scratch(failing_call, now=lambda: t_now) == {"deleted": 0, "kept": 2, "errors": 1}
    assert "error" in sweep_scratch(lambda *a, **k: (_ for _ in ()).throw(RuntimeError("HTTP 429")), now=lambda: t_now)  # a refused listing never raises
    print("d1_restore_drill selftest ok")


SCHEMA = "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name"

if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
        sys.exit(0)
    sys.exit(main())
