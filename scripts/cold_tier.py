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

Runs from scripts/continuity_snapshot.py main() (the remediation-consumer workflow), never raises, prints one JSON line per run.
Self-test: python scripts/cold_tier.py --selftest
"""
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
            nxt = time.strftime("%Y-%m-%d", time.gmtime(time.mktime(time.strptime(day, "%Y-%m-%d")) - time.timezone + 86400))
            ok = t["ok"]
            num_avg = 'ROUND(AVG("%s"), 1)' % t["num"] if t["num"] else "NULL"
            num_max = 'MAX("%s")' % t["num"] if t["num"] else "NULL"
            d1('INSERT OR REPLACE INTO cold_rollup_daily (src_table, day, dim1, dim2, n, n_ok, n_fail, v1, v2) '
               'SELECT ?1, ?2, COALESCE("%s", ""), COALESCE("%s", ""), COUNT(*), COALESCE(SUM("%s" = 1), 0), COALESCE(SUM("%s" = 0), 0), %s, %s '
               'FROM "%s" WHERE "%s" >= ?2 AND "%s" < ?3 GROUP BY 3, 4' % (d1_dims[0], d1_dims[1], ok, ok, num_avg, num_max, tab, ts, ts),
               [tab, day, nxt])
            d1("INSERT OR IGNORE INTO cold_rollup_daily (src_table, day, dim1, dim2, n, n_ok, n_fail) "
               "SELECT ?1, ?2, '', '', 0, 0, 0 WHERE NOT EXISTS (SELECT 1 FROM cold_rollup_daily WHERE src_table = ?1 AND day = ?2)", [tab, day])
            out.append(day)
        day = time.strftime("%Y-%m-%d", time.gmtime(time.mktime(time.strptime(day, "%Y-%m-%d")) - time.timezone + 86400))
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


def _chunk_rows(d1, t, now=None):
    """The next chunk of rows to archive, oldest id first, as dicts. Mode delete: rows older than keep_days that have a newer row of the same key;
    mode copy: rows older than keep_days after the last archived id."""
    tab, ts = t["table"], t["ts"]
    cutoff = _iso(-t["keep_days"], now)
    if t["mode"] == "delete":
        edge = _edge_id(d1, tab, ts, cutoff)
        if edge is None:
            return []
        k1, k2 = t["latest"]
        return d1('SELECT p.* FROM "%s" p WHERE p.id <= ?1 AND p."%s" < ?2 AND EXISTS (SELECT 1 FROM "%s" q WHERE q."%s" = p."%s" AND q."%s" = p."%s" AND q."%s" > p."%s") '
                  'AND substr(p."%s", 1, 10) IN (SELECT day FROM cold_rollup_daily WHERE src_table = ?3) '
                  'ORDER BY p.id LIMIT %d' % (tab, ts, tab, k1, k1, k2, k2, ts, ts, ts, t["chunk"]), [edge, cutoff, tab])
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
