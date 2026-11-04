#!/usr/bin/env python3
"""CONTINUITY-SNAPSHOT-1 (2026-10-09, pillar core; doctrine revision 4 section 14 continuity and resurrection, section 12 SPOF
'qnfo-audit D1').

WHAT  Proves the fleet's state can be rebuilt from durable stores alone, from the GitHub runner, without blocking D1 (a full
      D1 export locks the database while it runs, so it is not used):
        1. D1 Time Travel: reads a restore bookmark for qnfo-audit (Cloudflare's point-in-time restore, 30 days).
        2. Logical snapshot of the state tables, paged by rowid, gzipped JSON lines:
             - every table to R2 qnfo-backups continuity/qnfo-audit/<ts>/<table>.jsonl.gz (private);
             - the public-safe subset (the registers and the issue ledger the open dashboard already serves, without
               personal-category issues, owner cards, ops_config or claims) to $SNAPSHOT_DIR, which the workflow uploads as
               an Actions artifact: a second provider, because the repository is public (doctrine section 7).
        3. continuity_snapshots ledger row: per-table live rows and snapshot rows, integrity = worst snapshot/live ratio,
           sha256, Time Travel bookmark; spof_registry 'qnfo-audit D1' gets its alternate and alternate_tested_at.
        4. metric asset_freshness_90d from living-paper (published papers updated in 90 days / published).
      Runs only when the newest ok snapshot is older than 20 hours (--force overrides). Never fails the job.

D1-EXPORT-BEYOND-TIME-TRAVEL-1 (issue 2371, 2026-10-13, pillar core; doctrine section 14): Time Travel keeps 30 days and the
      daily snapshot covers 22 tables of one database, capped at PAGE x MAX_PAGES rows. Weekly, each database in
      EXPORT_DATABASES is exported in full: every table listed from sqlite_master, paged by rowid (LIMIT/OFFSET for a WITHOUT
      ROWID table) with no row cap, into gzipped JSON lines under R2 qnfo-backups export/<database>/<yyyymmdd>/<table>.jsonl.gz
      (a table above PART_ROWS rows continues in <table>.part<n>.jsonl.gz). Paging by rowid, not the D1 export API, because a
      running export blocks other requests to the database. A database is skipped while its newest export row is younger
      than 6 days. The step stops at EXPORT_BUDGET_SEC and resumes on the next run from the progress file
      export/<database>/_progress.json, so no single run has to fit a 355 MB database. One continuity_snapshots row per
      database (r2_prefix qnfo-backups/export/<database>/...) records live rows, exported rows and integrity (worst
      exported/live ratio). qnfo-identity and qnfo-outreach are never read (private; the run log is public), and no row
      content is printed.
"""
import gzip
import calendar
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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import remediation_consumer as RC  # noqa: E402

BUCKET = "qnfo-backups"
PAGE = 500
MAX_PAGES = 60
STATE_TABLES = ["agent_issues", "issue_triage", "issue_lifecycle", "agent_issues_tombstone", "remediation_contracts",
                "decision_log", "decision_outcomes", "belief_registry", "spof_registry", "control_registry", "failure_modes",
                "capability_ledger", "blocker_redteam", "metric_registry", "analytics_metric_triggers", "queue_sla",
                "migration_runs", "human_actions", "ops_config", "fleet_budget", "work_claims", "research_queue"]
PRIVATE_TABLES = {"human_actions", "ops_config", "work_claims", "fleet_budget", "research_queue"}

EXPORT_DATABASES = ["qnfo-audit", "q08-signal", "living-paper", "personal-life", "portfolio-state", "qnfo-graph", "ipatent-db",
                    "qnfo-cms"]
EXPORT_REFUSED = ("qnfo-identity", "qnfo-outreach")
EXPORT_PAGE = 500
PART_ROWS = 20000
EXPORT_MAX_AGE_DAYS = 6
EXPORT_BUDGET_SEC = float(os.environ.get("EXPORT_BUDGET_SEC") or 270)
_STARTED = time.time()


RETRY_DELAYS = (2, 4, 8, 16, 32)
EXPORT_RETRY_MAX = 3
EXPORT_REOPEN_DAYS = 3


def retrying(fn, sleep=None):
    """BACKUP-RETRY-1 (2026-11-04): D1 answers a burst with HTTP 429 (and Cloudflare with 5xx). Every qnfo-audit export since
    2026-10-20 ended ok=0 on a 429 for one table (code_tasks), and 4 of 6 daily snapshots on 2026-11-04 did the same: the first
    error was recorded and never retried. A transient answer is retried with exponential backoff; anything else raises at once."""
    def wrapped(*a, **k):
        for i in range(len(RETRY_DELAYS) + 1):
            try:
                return fn(*a, **k)
            except Exception as e:  # noqa: BLE001
                m = str(e)
                transient = "HTTP 429" in m or "HTTP 5" in m or "timed out" in m.lower() or "overloaded" in m.lower()
                if not transient or i == len(RETRY_DELAYS):
                    raise
                (sleep or time.sleep)(RETRY_DELAYS[i])
    return wrapped


def cf(method, path, body=None, ctype=None, timeout=60):
    req = urllib.request.Request(RC.CF_API + path, data=body, method=method,
                                 headers=dict({"Authorization": "Bearer " + RC.TOKEN}, **({"Content-Type": ctype} if ctype else {})))
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        return r.status, (json.loads(raw.decode("utf-8", "replace")) if raw[:1] in (b"{", b"[") else {})


def bookmark(call=cf):
    try:
        st, j = call("GET", "/accounts/%s/d1/database/%s/time_travel/bookmark" % (RC.ACCOUNT, RC.resolve_db_id()))
        return ((j or {}).get("result") or {}).get("bookmark")
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"continuity": "time-travel-failed", "error": str(e)[:160]}))
        return None


def r2_put(key, data, call=cf):
    st, _ = call("PUT", "/accounts/%s/r2/buckets/%s/objects/%s" % (RC.ACCOUNT, BUCKET, urllib.parse.quote(key, safe="/")), data, "application/gzip", 120)
    return 200 <= st < 300


def dump_table(d1, table):
    live = int((d1('SELECT COUNT(*) AS n FROM "%s"' % table) or [{"n": 0}])[0]["n"])
    rows, last = [], -1
    for _ in range(MAX_PAGES):
        page = d1('SELECT rowid AS _rowid, * FROM "%s" WHERE rowid > ?1 ORDER BY rowid LIMIT %d' % (table, PAGE), [last])
        if not page:
            break
        rows.extend(page)
        last = page[-1]["_rowid"]
        if len(page) < PAGE:
            break
    return live, rows


def public_rows(table, rows):
    if table in PRIVATE_TABLES:
        return None
    if table in ("agent_issues", "agent_issues_tombstone"):
        return [r for r in rows if str(r.get("category") or "").lower() != "personal"]
    if table in ("issue_triage", "issue_lifecycle", "remediation_contracts"):
        return rows  # ids, states and probes; personal issues' text is not in these tables
    return rows


def gz_lines(rows):
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as g:
        for r in rows:
            g.write((json.dumps(r, ensure_ascii=False, sort_keys=True, default=str) + "\n").encode("utf-8"))
    return buf.getvalue()


def freshness(d1, plane):
    try:
        r = plane("d1-query@living-paper", "SELECT COUNT(*) AS n, SUM(CASE WHEN datetime(updated_at) > datetime('now', '-90 days') THEN 1 ELSE 0 END) AS f FROM papers WHERE status = 'published'")
        n, f = int(r[0].get("n") or 0), int(r[0].get("f") or 0)
        val = round(f / n, 3) if n else 0
        d1("UPDATE metric_registry SET last_value = ?1, last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), state = 'MEASURED' WHERE metric = 'asset_freshness_90d'", [str(val)])
        return {"published": n, "fresh_90d": f, "share": val}
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)[:160]}


def daily(argv, d1, plane, call=cf, out_dir=None):
    out_dir = out_dir or os.environ.get("SNAPSHOT_DIR") or ""
    fresh = freshness(d1, plane)
    try:
        recent = d1("SELECT id FROM continuity_snapshots WHERE ok = 1 AND r2_prefix LIKE ?1 AND ts > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-20 hours') LIMIT 1", [BUCKET + "/continuity/%"])
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"continuity": "ledger-missing", "error": str(e)[:160]}))
        return 0
    if recent and "--force" not in argv:
        print(json.dumps({"continuity": "fresh", "freshness": fresh}))
        return 0
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    prefix = "continuity/qnfo-audit/%s/" % stamp
    bm = bookmark(call)
    tables, total, size, digest, worst, errors = {}, 0, 0, hashlib.sha256(), 1.0, []
    for t in STATE_TABLES:
        try:
            live, rows = dump_table(d1, t)
        except Exception as e:  # noqa: BLE001
            msg = str(e)
            if "no such table" in msg:
                continue
            errors.append("%s: %s" % (t, msg[:120]))
            worst = 0.0
            continue
        data = gz_lines(rows)
        ok_put = r2_put(prefix + t + ".jsonl.gz", data, call)
        if not ok_put:
            errors.append("%s: r2 put refused" % t)
        pub = public_rows(t, rows)
        if out_dir and pub is not None:
            os.makedirs(out_dir, exist_ok=True)
            with open(os.path.join(out_dir, t + ".jsonl.gz"), "wb") as fh:
                fh.write(gz_lines(pub))
        ratio = (len(rows) / live) if live else 1.0
        worst = min(worst, ratio)
        tables[t] = {"live": live, "snapshot": len(rows), "bytes": len(data), "public": pub is not None}
        total += len(rows)
        size += len(data)
        digest.update(data)
    try:
        names = ",".join("'%s'" % t for t in STATE_TABLES)
        r2_put(prefix + "_schema.jsonl.gz", gz_lines(d1("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND "
                                                         "(name IN (%s) OR tbl_name IN (%s)) ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name" % (names, names))), call)
    except Exception as e:  # noqa: BLE001 - the data is already stored; the drill falls back to the live schema
        errors.append("schema: %s" % str(e)[:80])
    ok = 1 if (not errors and bm) else 0
    note = "; ".join(errors)[:400] or ("ok" if bm else "no time-travel bookmark")
    try:
        d1("INSERT INTO continuity_snapshots (tables_json, rows_total, bytes, sha256, r2_prefix, artifact, time_travel_bookmark, integrity, ok, note) "
           "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
           [json.dumps(tables)[:20000], total, size, digest.hexdigest(), BUCKET + "/" + prefix,
            ("actions artifact continuity-snapshot run %s" % os.environ.get("GITHUB_RUN_ID", "local")) if out_dir else None,
            bm, round(worst, 4), ok, note])
        if ok:
            d1("UPDATE spof_registry SET alternate_path = ?1, alternate_tested_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE component = 'qnfo-audit D1'",
               ["D1 Time Travel restore bookmark (30 days) plus a daily logical snapshot of the state tables to R2 qnfo-backups "
                "continuity/ and the public-safe subset to a GitHub Actions artifact (scripts/continuity_snapshot.py)"])
        d1("INSERT INTO cloud_ops_events (id, ts, kind, status, text, job) VALUES (?1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'continuity-snapshot', ?2, ?3, 'continuity-snapshot')",
           ["continuity-" + stamp, "ok" if ok else "warn", "CONTINUITY-SNAPSHOT-1 %d rows, %d bytes, integrity %.4f, bookmark %s; %s" % (total, size, worst, "yes" if bm else "no", note)])
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"continuity": "ledger-write-failed", "error": str(e)[:200]}))
    print(json.dumps({"continuity": "ok" if ok else "partial", "rows": total, "bytes": size, "integrity": round(worst, 4),
                      "bookmark": bool(bm), "errors": errors[:5], "freshness": fresh}))
    return 0


def r2_put_obj(key, data, ctype, call=cf):
    st, _ = call("PUT", "/accounts/%s/r2/buckets/%s/objects/%s" % (RC.ACCOUNT, BUCKET, urllib.parse.quote(key, safe="/")), data, ctype, 120)
    return 200 <= st < 300


def r2_get_json(key, call=cf):
    """The JSON object at key, or None when it does not exist. Any other failure raises."""
    try:
        st, j = call("GET", "/accounts/%s/r2/buckets/%s/objects/%s" % (RC.ACCOUNT, BUCKET, urllib.parse.quote(key, safe="/")))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    if st == 404 or not isinstance(j, dict):
        return None
    return j


def export_query(d1, plane, database):
    """A literal-SQL reader for one database: the default D1 for qnfo-audit, the plane API for the others."""
    if database in EXPORT_REFUSED:
        raise RuntimeError("export of %s refused (private)" % database)
    if database == RC.DB_NAME:
        return lambda sql: d1(sql)
    return lambda sql: plane("d1-query@" + database, sql)


def list_tables(q):
    rows = q("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")
    return [r["name"] for r in rows if r.get("name")]


SCHEMA_SQL = ("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' "
              "AND name NOT LIKE '_cf_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name")


def export_table(q, table, st, put, deadline):
    """Pages one table from st['last'] on; writes a part to R2 every PART_ROWS rows. Returns True when the table is done.
    st holds live, exported, parts, last, mode, bytes and shas, and is advanced only after a part is stored."""
    qt = '"%s"' % table.replace('"', '""')
    if "live" not in st:
        st["live"] = int((q("SELECT COUNT(*) AS n FROM %s" % qt) or [{"n": 0}])[0]["n"] or 0)
    st.setdefault("exported", 0)
    st.setdefault("parts", 0)
    st.setdefault("last", -1 if st.get("mode", "rowid") == "rowid" else 0)
    st.setdefault("mode", "rowid")
    st.setdefault("bytes", 0)
    st.setdefault("shas", [])
    buf, cursor, done = [], st["last"], False
    while True:
        if st["mode"] == "rowid":
            try:
                page = q("SELECT rowid AS _rowid, * FROM %s WHERE rowid > %d ORDER BY rowid LIMIT %d" % (qt, int(cursor), EXPORT_PAGE))
            except Exception as e:  # noqa: BLE001
                if "rowid" not in str(e).lower() or st["exported"] or buf:
                    raise
                st["mode"], st["last"], cursor = "offset", 0, 0  # WITHOUT ROWID table: page by offset
                continue
        else:
            page = q("SELECT * FROM %s LIMIT %d OFFSET %d" % (qt, EXPORT_PAGE, int(cursor)))
        buf.extend(page)
        if page:
            cursor = page[-1]["_rowid"] if st["mode"] == "rowid" else cursor + len(page)
        done = len(page) < EXPORT_PAGE
        if buf and (done or len(buf) >= PART_ROWS or time.time() >= deadline):
            data = gz_lines(buf)
            key = "%s.jsonl.gz" % table if st["parts"] == 0 else "%s.part%d.jsonl.gz" % (table, st["parts"])
            if not put(key, data):
                raise RuntimeError("r2 put refused for %s" % key)
            st["parts"] += 1
            st["exported"] += len(buf)
            st["bytes"] += len(data)
            st["shas"].append(hashlib.sha256(data).hexdigest())
            st["last"] = cursor
            buf = []
        elif not buf and done and st["parts"] == 0:
            data = gz_lines([])  # an empty table still gets its (empty) file
            if not put("%s.jsonl.gz" % table, data):
                raise RuntimeError("r2 put refused for %s.jsonl.gz" % table)
            st["parts"] = 1
            st["bytes"] += len(data)
            st["shas"].append(hashlib.sha256(data).hexdigest())
        if done:
            st["done"] = True
            return True
        if time.time() >= deadline:
            return False


def export_database(d1, plane, database, call, deadline):
    """Exports one database, resuming from its progress file. Returns 'skipped', 'paused' or 'done'."""
    recent = d1("SELECT id FROM continuity_snapshots WHERE ok = 1 AND r2_prefix LIKE ?1 AND ts > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?2) LIMIT 1",
                [BUCKET + "/export/" + database + "/%", "-%d days" % EXPORT_MAX_AGE_DAYS])
    if recent:
        return "skipped"
    q = export_query(d1, plane, database)
    pkey = "export/%s/_progress.json" % database
    prog = r2_get_json(pkey, call)
    if prog and prog.get("complete") and prog.get("errors") and prog.get("stamp") and int(prog.get("retries") or 0) < EXPORT_RETRY_MAX:
        # BACKUP-REOPEN-1: a finished run with failed tables (ok=0) is reopened for those tables only, while it is young enough
        # that the rest of the export is still a consistent copy; before this a partial export stood until the next week.
        try:
            age = (time.time() - calendar.timegm(time.strptime(prog["stamp"], "%Y%m%d"))) / 86400.0
        except ValueError:
            age = 99
        if age <= EXPORT_REOPEN_DAYS:
            for t in list(prog["errors"]):
                prog["tables"][t] = {}
            prog["errors"], prog["complete"], prog["retries"] = {}, False, int(prog.get("retries") or 0) + 1
    if not prog or prog.get("complete") or not prog.get("stamp"):
        prog = {"database": database, "stamp": time.strftime("%Y%m%d", time.gmtime()), "tables": {}, "errors": {}}
    prefix = "export/%s/%s/" % (database, prog["stamp"])
    if "order" not in prog:
        prog["order"] = list_tables(q)

    def put(name, data):
        return r2_put_obj(prefix + name, data, "application/gzip", call)

    if not prog.get("schema_saved"):
        # RESTORE-SCHEMA-1: rows alone cannot rebuild a database; the DDL goes beside them so a restore needs nothing else.
        if not put("_schema.jsonl.gz", gz_lines(q(SCHEMA_SQL))):
            raise RuntimeError("r2 put refused for _schema.jsonl.gz")
        prog["schema_saved"] = True

    def save():
        if not r2_put_obj(pkey, json.dumps(prog, sort_keys=True).encode("utf-8"), "application/json", call):
            raise RuntimeError("r2 put refused for %s" % pkey)

    since_save = 0
    for t in prog["order"]:
        st = prog["tables"].setdefault(t, {})
        if st.get("done") or t in prog["errors"]:
            continue
        if time.time() >= deadline:
            save()
            return "paused"
        try:
            finished = export_table(q, t, st, put, deadline)
        except Exception as e:  # noqa: BLE001
            prog["errors"][t] = str(e)[:160]
            print(json.dumps({"d1-export": database, "table": t, "error": str(e)[:160]}))
            save()
            continue
        since_save += 1
        if not finished:
            save()
            return "paused"
        if since_save >= 20:
            save()
            since_save = 0
    tables, live, exported, size, worst, digest = {}, 0, 0, 0, 1.0, hashlib.sha256()
    for t in prog["order"]:
        st = prog["tables"].get(t) or {}
        if t in prog["errors"]:
            worst = 0.0
            tables[t] = [st.get("live"), st.get("exported", 0), "error"]
            continue
        lv, ex = int(st.get("live") or 0), int(st.get("exported") or 0)
        worst = min(worst, min(1.0, ex / lv) if lv else 1.0)
        tables[t] = [lv, ex]
        live, exported, size = live + lv, exported + ex, size + int(st.get("bytes") or 0)
        for h in st.get("shas") or []:
            digest.update(h.encode("ascii"))
    errs = ["%s: %s" % (k, v) for k, v in sorted(prog["errors"].items())]
    ok = 0 if errs else 1
    note = ("D1-EXPORT-BEYOND-TIME-TRAVEL-1 %s: %d tables, live %d, exported %d; " % (database, len(tables), live, exported)
            + ("; ".join(errs) or "ok"))[:400]
    d1("INSERT INTO continuity_snapshots (tables_json, rows_total, bytes, sha256, r2_prefix, artifact, time_travel_bookmark, integrity, ok, note) "
       "VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?6, ?7, ?8)",
       [json.dumps({"database": database, "live_rows": live, "exported_rows": exported, "tables": tables}, separators=(",", ":"))[:200000],
        exported, size, digest.hexdigest(), BUCKET + "/" + prefix, round(worst, 4), ok, note])
    d1("INSERT INTO cloud_ops_events (id, ts, kind, status, text, job) VALUES (?1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'd1-export', ?2, ?3, 'continuity-snapshot')",
       ["d1-export-%s-%s" % (database, prog["stamp"]), "ok" if ok else "warn", note])
    prog["complete"] = True
    save()
    print(json.dumps({"d1-export": database, "status": "done", "live": live, "exported": exported, "integrity": round(worst, 4), "errors": len(errs)}))
    return "done"


def export_step(d1, plane, call=cf, deadline=None):
    """Weekly full export of EXPORT_DATABASES. Never raises."""
    deadline = deadline if deadline is not None else _STARTED + EXPORT_BUDGET_SEC
    out = {}
    for db in EXPORT_DATABASES:
        if db in EXPORT_REFUSED:
            continue
        try:
            out[db] = export_database(d1, plane, db, call, deadline)
        except Exception as e:  # noqa: BLE001
            out[db] = "failed: %s" % str(e)[:160]
        if out[db] == "paused":
            break
    print(json.dumps({"d1-export": out}))
    return out


# BAK-TABLE-SWEEP-1 (2026-11-04, pillar core): every migration that deletes or drops leaves a bak_<yyyymmdd>_<name> copy behind, and nothing ever removed one:
# 300 of the 941 tables of qnfo-audit on 2026-11-04 (all created 10-24 to 11-04, 258 of them holding 10 rows or fewer). The weekly export above already writes
# each table to R2 with a per-table progress record (done, live, exported, sha). A bak_ table whose name date is at least ops_config bak_table_keep_days old
# (default 7; 'off' stops the sweep), that the latest export holds completely (done, no error, exported rows >= the rows now), that no view or trigger
# mentions, is dropped and written to dropped_bak_tables_ledger with its R2 key and sha. At most BAK_SWEEP_PER_RUN a run. A table without a date in its name, or one
# the export does not hold, is never dropped. Never raises.
BAK_SWEEP_PER_RUN = 40
BAK_KEEP_DAYS_DEFAULT = 7
BAK_PROGRESS_KEY = "export/qnfo-audit/_progress.json"


def bak_name_date(name):
    m = re.search(r"(20\d{2})(\d{2})(\d{2})", name)
    if not m:
        return None
    try:
        return calendar.timegm((int(m.group(1)), int(m.group(2)), int(m.group(3)), 0, 0, 0)) / 86400.0
    except (ValueError, OverflowError):
        return None


def bak_sweep(d1, call=cf, now=None):
    out = {"dropped": 0, "skipped": {}}
    try:
        cfg = d1("SELECT value FROM ops_config WHERE key = 'bak_table_keep_days'")
        raw = str((cfg[0]["value"] if cfg else BAK_KEEP_DAYS_DEFAULT)).strip().lower()
        if raw == "off":
            out["status"] = "off"
            return out
        keep = int(raw) if raw.isdigit() else BAK_KEEP_DAYS_DEFAULT
        prog = r2_get_json(BAK_PROGRESS_KEY, call)
        if not prog or not isinstance(prog.get("tables"), dict):
            out["status"] = "no-export-progress"
            return out
        d1("SELECT 1 FROM dropped_bak_tables_ledger LIMIT 1")   # raises when the ledger table is missing: nothing is dropped without a record
        tabs, errs, stamp = prog["tables"], prog.get("errors") or {}, str(prog.get("stamp") or "")
        names = [r["name"] for r in d1("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'bak\\_%' ESCAPE '\\' ORDER BY name")]
        refs = " ".join(str(r.get("sql") or "") for r in d1("SELECT sql FROM sqlite_master WHERE type IN ('view', 'trigger') AND sql LIKE '%bak\\_%' ESCAPE '\\'"))
        today = (now if now is not None else time.time()) / 86400.0

        def skip(why):
            out["skipped"][why] = out["skipped"].get(why, 0) + 1

        for n in names:
            if out["dropped"] >= BAK_SWEEP_PER_RUN:
                skip("per-run-cap")
                continue
            if not re.fullmatch(r"bak_[A-Za-z0-9_]+", n):
                skip("odd-name")
                continue
            day = bak_name_date(n)
            if day is None:
                skip("undated")
                continue
            if today - day < keep:
                skip("young")
                continue
            st = tabs.get(n)
            if not isinstance(st, dict) or not st.get("done") or n in errs:
                skip("not-exported")
                continue
            if n in refs:
                skip("referenced")
                continue
            live_now = int((d1('SELECT COUNT(*) AS n FROM "%s"' % n) or [{"n": 0}])[0]["n"] or 0)
            if live_now > int(st.get("exported") or 0):
                skip("grew-since-export")
                continue
            sha = ",".join(st.get("shas") or [])[:200]
            d1("INSERT INTO dropped_bak_tables_ledger (name, rows, bytes, r2_key, sha) VALUES (?1, ?2, ?3, ?4, ?5)",
               [n, live_now, int(st.get("bytes") or 0), "%s/export/qnfo-audit/%s/%s.jsonl.gz" % (BUCKET, stamp, n), sha])
            d1('DROP TABLE IF EXISTS "%s"' % n)
            out["dropped"] += 1
        if out["dropped"]:
            d1("INSERT INTO cloud_ops_events (id, ts, kind, status, text, job) VALUES (?1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'bak-table-sweep', 'ok', ?2, 'continuity-snapshot')",
               ["bak-sweep-%d" % int(time.time()), "BAK-TABLE-SWEEP-1: dropped %d expired bak_ table(s) held by the R2 export %s; skipped %s" % (out["dropped"], stamp, json.dumps(out["skipped"]))[:400]])
    except Exception as e:  # noqa: BLE001
        out["error"] = str(e)[:160]
    print(json.dumps({"bak-table-sweep": out}))
    return out


# BLOB-TRIM-1 (2026-11-04, pillar core): chatbox_conversations.messages_json holds the last 100 messages of the thread on every row, so a thread of n turns stores
# about n squared / 2 messages: 144 MB (2,930 + 560 rows, 82 + 61 MB) of the table's 165 MB, and nothing reads it (qnfo-ai writes it at the log record and the history
# browse reads prompt and response only; each row's prompt and response are the turn). A listed blob column is set to NULL on rows the latest R2 export holds
# (rowid at most the export's last exported rowid, table done, mode rowid), 150 rows a run (about 6 MB of writes), so the export object keeps the original and a row added after the export
# is never touched. ops_config blob_trim = off stops it. Never raises.
BLOB_TRIMS = [("chatbox_conversations", "messages_json", 150)]


def blob_trim(d1, call=cf):
    out = {"nulled": 0, "skipped": {}}
    try:
        cfg = d1("SELECT value FROM ops_config WHERE key = 'blob_trim'")
        if cfg and str(cfg[0]["value"]).strip().lower() == "off":
            out["status"] = "off"
            return out
        prog = r2_get_json(BAK_PROGRESS_KEY, call)
        if not prog or not isinstance(prog.get("tables"), dict):
            out["status"] = "no-export-progress"
            return out
        for table, col, per in BLOB_TRIMS:
            st = prog["tables"].get(table)
            if not isinstance(st, dict) or not st.get("done") or table in (prog.get("errors") or {}) or st.get("mode") != "rowid" or not isinstance(st.get("last"), int):
                out["skipped"][table] = "not-exported"
                continue
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", table) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", col):
                out["skipped"][table] = "odd-name"
                continue
            cnt = 'SELECT COUNT(*) AS n FROM "%s" WHERE "%s" IS NOT NULL AND rowid <= ?1' % (table, col)
            before = int((d1(cnt, [st["last"]]) or [{"n": 0}])[0]["n"] or 0)
            if not before:
                out["skipped"][table] = "nothing-to-trim"
                continue
            d1('UPDATE "%s" SET "%s" = NULL WHERE rowid IN (SELECT rowid FROM "%s" WHERE "%s" IS NOT NULL AND rowid <= ?1 LIMIT %d)' % (table, col, table, col, int(per)), [st["last"]])
            after = int((d1(cnt, [st["last"]]) or [{"n": 0}])[0]["n"] or 0)
            out["nulled"] += max(0, before - after)
            out["left_" + table] = after
        if out["nulled"]:
            d1("INSERT INTO cloud_ops_events (id, ts, kind, status, text, job) VALUES (?1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'blob-trim', 'ok', ?2, 'continuity-snapshot')",
               ["blob-trim-%d" % int(time.time()), "BLOB-TRIM-1: set %d blob value(s) to NULL on rows the R2 export %s holds; %s" % (out["nulled"], prog.get("stamp"), json.dumps(out))[:400]])
    except Exception as e:  # noqa: BLE001
        out["error"] = str(e)[:160]
    print(json.dumps({"blob-trim": out}))
    return out


def main(argv=None, d1=None, plane=None, call=cf, out_dir=None, deadline=None):
    argv = argv if argv is not None else sys.argv[1:]
    d1, plane = retrying(d1 or RC.d1), retrying(plane or RC.d1_plane)
    daily(argv, d1, plane, call, out_dir)
    if "--no-export" not in argv:
        export_step(d1, plane, call, deadline)
        bak_sweep(d1, call)
        blob_trim(d1, call)
    return 0


def selftest():
    import sqlite3
    import tempfile
    c = sqlite3.connect(":memory:")
    c.executescript("""
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, category TEXT);
CREATE TABLE human_actions (id INTEGER PRIMARY KEY, why TEXT);
CREATE TABLE continuity_snapshots (id INTEGER PRIMARY KEY, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), tables_json TEXT, rows_total INTEGER, bytes INTEGER, sha256 TEXT, r2_prefix TEXT, artifact TEXT, time_travel_bookmark TEXT, integrity REAL, ok INTEGER, note TEXT);
CREATE TABLE spof_registry (component TEXT, alternate_path TEXT, alternate_tested_at TEXT);
CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, status TEXT, text TEXT, job TEXT);
CREATE TABLE metric_registry (metric TEXT, last_value TEXT, last_refreshed TEXT, state TEXT);
INSERT INTO spof_registry VALUES ('qnfo-audit D1', NULL, NULL);
INSERT INTO metric_registry VALUES ('asset_freshness_90d', NULL, NULL, NULL);
INSERT INTO human_actions VALUES (1, 'owner card');
""")
    for i in range(1, 1203):
        c.execute("INSERT INTO agent_issues VALUES (?, ?, ?)", [i, "t%d" % i, "personal" if i % 100 == 0 else "ops"])

    def d1(sql, params=None):
        cur = c.execute(sql, params or [])
        cols = [d[0] for d in cur.description] if cur.description else []
        return [dict(zip(cols, x)) for x in cur.fetchall()]

    puts = []

    def call(method, path, body=None, ctype=None, timeout=60):
        if "time_travel" in path:
            return 200, {"result": {"bookmark": "00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683"}}
        puts.append(path)
        return 200, {}

    RC.resolve_db_id = lambda: "db"
    d = tempfile.mkdtemp()
    assert main(["--force", "--no-export"], d1, lambda t, s: [{"n": 10, "f": 9}], call, d) == 0
    snap = d1("SELECT * FROM continuity_snapshots")[0]
    tj = json.loads(snap["tables_json"])
    assert snap["ok"] == 1 and snap["integrity"] == 1.0 and tj["agent_issues"]["snapshot"] == 1202, snap
    assert any(p.endswith("/agent_issues.jsonl.gz") for p in puts) and any(p.endswith("/human_actions.jsonl.gz") for p in puts)
    assert "human_actions.jsonl.gz" not in os.listdir(d) and "agent_issues.jsonl.gz" in os.listdir(d), os.listdir(d)  # owner cards never reach the public artifact
    with gzip.open(os.path.join(d, "agent_issues.jsonl.gz"), "rt") as fh:
        assert sum(1 for _ in fh) == 1202 - 12  # personal-category issues excluded
    assert d1("SELECT alternate_tested_at FROM spof_registry")[0]["alternate_tested_at"]
    assert d1("SELECT last_value FROM metric_registry")[0]["last_value"] == "0.9"
    assert main(["--no-export"], d1, lambda t, s: [{"n": 0, "f": 0}], call, d) == 0 and len(d1("SELECT id FROM continuity_snapshots")) == 1  # fresh: skipped
    export_selftest(c, d1)
    bak_selftest()
    blob_selftest()
    print("continuity_snapshot selftest ok")


def blob_selftest():
    import sqlite3
    saved = list(BLOB_TRIMS)
    BLOB_TRIMS[:] = [("chatbox_conversations", "messages_json", 50)]
    c = sqlite3.connect(":memory:")
    c.executescript("""
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, status TEXT, text TEXT, job TEXT);
CREATE TABLE chatbox_conversations (id TEXT PRIMARY KEY, thread_id TEXT, messages_json TEXT, prompt TEXT, response TEXT);
""")
    for i in range(1, 121):
        c.execute("INSERT INTO chatbox_conversations VALUES (?, 't', ?, 'p', 'r')", ["id%d" % i, "[big %d]" % i])

    def d1(sql, params=None):
        cur = c.execute(sql, params or [])
        cols = [x[0] for x in cur.description] if cur.description else []
        return [dict(zip(cols, r)) for r in cur.fetchall()]

    prog = {"stamp": "20261103", "errors": {}, "tables": {"chatbox_conversations": {"done": True, "mode": "rowid", "last": 100, "exported": 100, "live": 100}}}
    call = lambda method, path, body=None, ctype=None, timeout=60: (200, prog)  # noqa: E731
    left = lambda: d1("SELECT COUNT(*) AS n FROM chatbox_conversations WHERE messages_json IS NOT NULL")[0]["n"]  # noqa: E731
    r = blob_trim(d1, call)
    assert r["nulled"] == 50 and left() == 70, (r, left())          # 50 a run, only rows the export holds
    assert d1("SELECT prompt, response FROM chatbox_conversations WHERE id = 'id1'") == [{"prompt": "p", "response": "r"}]   # the turn itself is untouched
    assert blob_trim(d1, call)["nulled"] == 50 and left() == 20      # rows 101..120 were added after the export: never touched
    r3 = blob_trim(d1, call)
    assert r3["nulled"] == 0 and r3["skipped"] == {"chatbox_conversations": "nothing-to-trim"} and left() == 20, r3
    assert d1("SELECT COUNT(*) AS n FROM chatbox_conversations WHERE messages_json IS NULL AND CAST(substr(id, 3) AS INTEGER) > 100")[0]["n"] == 0
    assert d1("SELECT COUNT(*) AS n FROM cloud_ops_events WHERE kind = 'blob-trim'")[0]["n"] == 2
    d1("INSERT INTO ops_config VALUES ('blob_trim', 'off')")
    prog["tables"]["chatbox_conversations"]["last"] = 120
    assert blob_trim(d1, call)["status"] == "off" and left() == 20
    d1("DELETE FROM ops_config")
    prog["tables"]["chatbox_conversations"]["done"] = False          # an export that has not finished the table: nothing is nulled
    assert blob_trim(d1, call)["skipped"] == {"chatbox_conversations": "not-exported"} and left() == 20
    prog["tables"]["chatbox_conversations"]["done"] = True
    prog["errors"] = {"chatbox_conversations": "429"}
    assert blob_trim(d1, call)["skipped"] == {"chatbox_conversations": "not-exported"} and left() == 20
    prog["errors"] = {}
    prog["tables"]["chatbox_conversations"]["mode"] = "offset"      # a WITHOUT ROWID style export has no rowid cursor: skipped
    assert blob_trim(d1, call)["skipped"] == {"chatbox_conversations": "not-exported"} and left() == 20
    prog["tables"]["chatbox_conversations"]["mode"] = "rowid"
    assert blob_trim(d1, call)["nulled"] == 20 and left() == 0       # the export now holds all 120: the rest goes
    assert blob_trim(d1, lambda *a, **k: (404, {})).get("status") == "no-export-progress"
    BLOB_TRIMS[:] = saved


def bak_selftest():
    import sqlite3
    c = sqlite3.connect(":memory:")
    c.executescript("""
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, status TEXT, text TEXT, job TEXT);
CREATE TABLE dropped_bak_tables_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, rows INTEGER, bytes INTEGER, r2_key TEXT, sha TEXT, dropped_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
CREATE TABLE bak_20261001_old (a); INSERT INTO bak_20261001_old VALUES (1), (2), (3);
CREATE TABLE bak_20261001_empty (a);
CREATE TABLE bak_20261002_notexported (a); INSERT INTO bak_20261002_notexported VALUES (1);
CREATE TABLE bak_20261003_err (a); INSERT INTO bak_20261003_err VALUES (1);
CREATE TABLE bak_20261004_grew (a); INSERT INTO bak_20261004_grew VALUES (1), (2), (3);
CREATE TABLE bak_20261005_ref (a); INSERT INTO bak_20261005_ref VALUES (1);
CREATE VIEW v_uses_bak AS SELECT a FROM bak_20261005_ref;
CREATE TABLE bak_undated_x (a); INSERT INTO bak_undated_x VALUES (1);
CREATE TABLE bak_20261030_young (a); INSERT INTO bak_20261030_young VALUES (1);
""")

    def d1(sql, params=None):
        cur = c.execute(sql, params or [])
        cols = [x[0] for x in cur.description] if cur.description else []
        return [dict(zip(cols, r)) for r in cur.fetchall()]

    done = {"done": True, "exported": 3, "live": 3, "bytes": 99, "shas": ["abc123"]}
    prog = {"stamp": "20261103", "errors": {"bak_20261003_err": "429"}, "tables": {
        "bak_20261001_old": dict(done), "bak_20261001_empty": {"done": True, "exported": 0, "live": 0, "bytes": 0, "shas": []},
        "bak_20261003_err": dict(done), "bak_20261004_grew": dict(done, exported=1, live=1), "bak_20261005_ref": dict(done),
        "bak_undated_x": dict(done), "bak_20261030_young": dict(done)}}
    calls = []

    def call(method, path, body=None, ctype=None, timeout=60):
        calls.append(path)
        return 200, prog

    now = calendar.timegm((2026, 11, 4, 12, 0, 0))
    r = bak_sweep(d1, call, now)
    left = {x["name"] for x in d1("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'bak\\_%' ESCAPE '\\'")}
    assert r["dropped"] == 2 and left == {"bak_20261002_notexported", "bak_20261003_err", "bak_20261004_grew", "bak_20261005_ref", "bak_undated_x", "bak_20261030_young"}, (r, left)
    assert r["skipped"] == {"not-exported": 2, "grew-since-export": 1, "referenced": 1, "undated": 1, "young": 1}, r
    led = {x["name"]: x for x in d1("SELECT * FROM dropped_bak_tables_ledger")}
    assert set(led) == {"bak_20261001_old", "bak_20261001_empty"} and led["bak_20261001_old"]["rows"] == 3 and led["bak_20261001_old"]["sha"] == "abc123", led
    assert led["bak_20261001_old"]["r2_key"] == "qnfo-backups/export/qnfo-audit/20261103/bak_20261001_old.jsonl.gz", led
    assert d1("SELECT COUNT(*) AS n FROM cloud_ops_events WHERE kind = 'bak-table-sweep'")[0]["n"] == 1
    assert bak_sweep(d1, call, now)["dropped"] == 0                      # idempotent
    d1("INSERT INTO ops_config VALUES ('bak_table_keep_days', 'off')")
    d1("CREATE TABLE bak_20260901_x (a)")
    prog["tables"]["bak_20260901_x"] = dict(done, exported=0, live=0)
    assert bak_sweep(d1, call, now) == {"dropped": 0, "skipped": {}, "status": "off"}
    d1("UPDATE ops_config SET value = '30' WHERE key = 'bak_table_keep_days'")
    assert bak_sweep(d1, call, now)["dropped"] == 1                      # 30 days: 09-01 goes, 10-xx stays
    d1("DELETE FROM ops_config")
    for i in range(45):
        d1("CREATE TABLE bak_202610%02d_t%d (a)" % (i % 20 + 1, i))
        prog["tables"]["bak_202610%02d_t%d" % (i % 20 + 1, i)] = dict(done, exported=0, live=0)
    assert bak_sweep(d1, call, now)["dropped"] == BAK_SWEEP_PER_RUN       # the per-run cap
    prog["tables"].clear()
    assert bak_sweep(d1, call, now)["dropped"] == 0                      # nothing exported: nothing dropped
    c.execute("DROP TABLE dropped_bak_tables_ledger")
    d1("CREATE TABLE bak_20260801_y (a)")
    prog["tables"]["bak_20260801_y"] = dict(done, exported=0, live=0)
    r2 = bak_sweep(d1, call, now)
    assert r2["dropped"] == 0 and "error" in r2 and d1("SELECT name FROM sqlite_master WHERE name = 'bak_20260801_y'"), r2   # no ledger: no drop
    call2 = lambda method, path, body=None, ctype=None, timeout=60: (404, {})  # noqa: E731
    assert bak_sweep(d1, call2, now).get("status") == "no-export-progress"


def export_selftest(c, d1):
    """D1-EXPORT-BEYOND-TIME-TRAVEL-1, offline: qnfo-audit plus a second database through the plane, a table above
    30,000 rows (the daily snapshot's cap), a WITHOUT ROWID table, resume after the budget runs out, the weekly skip, and
    the refused private databases."""
    import sqlite3
    global EXPORT_DATABASES
    saved = EXPORT_DATABASES
    second = sqlite3.connect(":memory:")
    second.executescript("""
CREATE TABLE papers (id INTEGER PRIMARY KEY, title TEXT);
CREATE TABLE tags (k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID;
CREATE TABLE empty_one (id INTEGER PRIMARY KEY);
INSERT INTO tags VALUES ('a', '1'), ('b', '2'), ('c', '3');
""")
    second.executemany("INSERT INTO papers VALUES (?, ?)", [(i, "p%d" % i) for i in range(1, 30502)])
    planes = {"d1-query@living-paper": second}
    asked = []

    def plane(transport, sql):
        asked.append(transport)
        if transport not in planes:
            raise RuntimeError("plane %s: plane-not-found" % transport)
        cur = planes[transport].execute(sql)
        cols = [x[0] for x in cur.description] if cur.description else []
        return [dict(zip(cols, x)) for x in cur.fetchall()]

    store = {}

    def call(method, path, body=None, ctype=None, timeout=60):
        key = urllib.parse.unquote(path.split("/objects/", 1)[1]) if "/objects/" in path else path
        if method == "PUT":
            store[key] = body
            return 200, {}
        if key not in store:
            raise urllib.error.HTTPError(path, 404, "not found", None, None)
        return 200, json.loads(store[key].decode("utf-8"))

    def lines(key):
        return [json.loads(x) for x in gzip.decompress(store[key]).decode("utf-8").splitlines()]

    try:
        EXPORT_DATABASES = ["qnfo-audit", "living-paper", "qnfo-identity", "qnfo-outreach"]
        before = len(d1("SELECT id FROM continuity_snapshots"))
        # 1. an expired budget: nothing exported, a progress file for qnfo-audit, no ledger row.
        out = export_step(d1, plane, call, deadline=time.time() - 1)
        assert out == {"qnfo-audit": "paused"}, out
        assert len(d1("SELECT id FROM continuity_snapshots")) == before
        # 2. a budget that lasts: both databases finish, resuming qnfo-audit from its progress file.
        out = export_step(d1, plane, call, deadline=time.time() + 600)
        assert out == {"qnfo-audit": "done", "living-paper": "done"}, out
        assert not any("qnfo-identity" in a or "qnfo-outreach" in a for a in asked), asked
        rows = d1("SELECT * FROM continuity_snapshots WHERE r2_prefix LIKE 'qnfo-backups/export/%' ORDER BY id")
        assert len(rows) == 2 and all(r["ok"] == 1 and r["integrity"] == 1.0 for r in rows), rows
        lp = json.loads(rows[1]["tables_json"])
        assert lp["database"] == "living-paper" and lp["live_rows"] == lp["exported_rows"] == 30501 + 3, lp
        assert lp["tables"]["papers"] == [30501, 30501] and lp["tables"]["tags"] == [3, 3], lp
        stamp = time.strftime("%Y%m%d", time.gmtime())
        pre = "export/living-paper/%s/" % stamp
        assert rows[1]["r2_prefix"] == "qnfo-backups/" + pre, rows[1]
        got = lines(pre + "papers.jsonl.gz") + lines(pre + "papers.part1.jsonl.gz")
        assert len(got) == 30501 and got[-1]["id"] == 30501 and pre + "papers.part2.jsonl.gz" not in store  # no row cap
        assert sorted(r["k"] for r in lines(pre + "tags.jsonl.gz")) == ["a", "b", "c"]
        assert lines(pre + "empty_one.jsonl.gz") == []
        audit = json.loads(rows[0]["tables_json"])
        assert audit["tables"]["agent_issues"] == [1202, 1202] and "continuity_snapshots" in audit["tables"], audit
        assert len(lines("export/qnfo-audit/%s/agent_issues.jsonl.gz" % stamp)) == 1202  # private store: personal rows kept
        # 3. the weekly skip: both databases have an export row younger than 6 days.
        assert export_step(d1, plane, call, deadline=time.time() + 600) == {"qnfo-audit": "skipped", "living-paper": "skipped"}
        # 4. a database that cannot be reached is recorded as failed and does not stop the others.
        EXPORT_DATABASES = ["q08-signal"]
        assert export_step(d1, plane, call, deadline=time.time() + 600)["q08-signal"].startswith("failed")
        # 5. a table cut by the budget resumes from its last rowid without loss or duplicates.
        parts = {}
        st = {}
        q = export_query(d1, plane, "living-paper")
        assert export_table(q, "papers", st, lambda k, b: parts.__setitem__(k, b) or True, time.time() - 1) is False
        assert st["exported"] == EXPORT_PAGE and st["parts"] == 1 and not st.get("done"), st
        assert export_table(q, "papers", st, lambda k, b: parts.__setitem__(k, b) or True, time.time() + 600) is True
        ids = [json.loads(x)["id"] for k in sorted(parts) for x in gzip.decompress(parts[k]).decode("utf-8").splitlines()]
        assert sorted(ids) == list(range(1, 30502)) and st["exported"] == 30501, (len(ids), st["exported"])
        # 6. export rows never satisfy the daily snapshot's 20-hour freshness check.
        c.execute("DELETE FROM continuity_snapshots WHERE r2_prefix LIKE 'qnfo-backups/continuity/%'")
        assert not d1("SELECT id FROM continuity_snapshots WHERE ok = 1 AND r2_prefix LIKE ?1", [BUCKET + "/continuity/%"])
        # 7. BACKUP-RETRY-1 / BACKUP-REOPEN-1: a 429 is retried; a finished run with a failed table is reopened for that table only.
        calls = {"n": 0}

        def flaky(sql, params=None):
            calls["n"] += 1
            if calls["n"] < 3:
                raise RuntimeError("HTTP 429 from https://api.cloudflare.com/x: overloaded")
            return [{"ok": 1}]
        naps = []
        assert retrying(flaky, sleep=naps.append)("x") == [{"ok": 1}] and naps == [2, 4], naps
        try:
            retrying(lambda: (_ for _ in ()).throw(RuntimeError("d1 error: no such table")), sleep=naps.append)()
            raise AssertionError("a non-transient error must raise at once")
        except RuntimeError:
            assert naps == [2, 4]
        stamp2 = time.strftime("%Y%m%d", time.gmtime())
        pk = "export/living-paper/_progress.json"
        c.execute("DELETE FROM continuity_snapshots WHERE r2_prefix LIKE 'qnfo-backups/export/living-paper/%'")
        prog = json.loads(store[pk].decode("utf-8"))
        prog["errors"], prog["complete"] = {"tags": "HTTP 429 from x"}, True
        prog["tables"]["tags"] = {"done": True, "exported": 0, "live": 3}
        store[pk] = json.dumps(prog).encode("utf-8")
        EXPORT_DATABASES = ["living-paper"]
        assert export_step(d1, plane, call, deadline=time.time() + 600) == {"living-paper": "done"}
        again = d1("SELECT ok, integrity FROM continuity_snapshots WHERE r2_prefix LIKE 'qnfo-backups/export/living-paper/%'")
        assert again == [{"ok": 1, "integrity": 1.0}], again
        assert json.loads(store[pk].decode("utf-8"))["retries"] == 1 and "export/living-paper/%s/_schema.jsonl.gz" % stamp2 in store
        assert any(r["name"] == "papers" for r in lines("export/living-paper/%s/_schema.jsonl.gz" % stamp2))
        try:
            export_query(d1, plane, "qnfo-identity")
            raise AssertionError("qnfo-identity must be refused")
        except RuntimeError:
            pass
    finally:
        EXPORT_DATABASES = saved


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
        sys.exit(0)
    sys.exit(main())
