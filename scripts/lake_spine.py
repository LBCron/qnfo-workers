#!/usr/bin/env python3
"""lake_spine.py - RM-BS-DATA-SPINE-1 (roadmap row 3258, blue-sky bet B2), slice 1: a telemetry table that
leaves D1 for an Iceberg lake, and the means to read it back by SQL.

WHY
  docs/BLUE-SKY-ROADMAP-2026-11.md B2 asks for append-only telemetry in a lake and D1 for control state only, and
  docs/D1-SPLIT-DESIGN-2026-11.md planned a second D1 database as the destination. B2 W1 says the lake is the
  alternative "chosen by a measured pilot". This is the pilot for fleet_probe_log: single writer, no trigger,
  about 12,000 rows a day, each insert writes 4 rows (table plus 2 indexes plus rowid), and the cold tier then
  deletes about 90,000 rows a day (measured 2026-11-05, d1QueriesAdaptiveGroups, 24 h).

HOW (same machinery as scripts/r2_inventory_catalog.py, proven live since 2026-10-18)
    D1 fleet_probe_log --tail--> telemetry_fleet_probe_log_stream --SQL--> telemetry_fleet_probe_log_sink
        (R2 Data Catalog, bucket qnfo-audit, namespace telemetry, table fleet_probe_log, parquet)
  The tail is qnfo-infra's hourly lakeTailTick (worker) with this script as the second path: both move the same
  cursor (D1 table lake_spine_state), so a runner can drain a backlog or take over when the worker's token lacks
  a scope. Reading back: Basin SQL (`--query`), the same engine the worker's drift check uses.

THE HONEST LIMITS
  * This slice COPIES. D1 stays authoritative and the writer still writes D1; nothing is cut over and D1 write
    volume does not fall yet. The cutover (the writer sends to the stream, D1 keeps a few days) is slice 2.
  * Append-only and at-least-once: a crash between the stream's accept and the cursor write re-sends one batch.
    Read the lake with count(DISTINCT id); the drift check reports duplicates separately from missing rows.
  * Pipelines and Basin SQL are in beta; prices are those stated in the changelog (SQL USD 2.50 per TB scanned,
    billing not yet enabled), re-read at adoption.

USAGE
  python3 scripts/lake_spine.py --ensure-infrastructure          # stream + sink + pipeline when missing (idempotent)
  python3 scripts/lake_spine.py --check                          # what exists, from the API
  python3 scripts/lake_spine.py --query "SELECT count(*) FROM telemetry.fleet_probe_log"
  python3 scripts/lake_spine.py --tail --from-id 380000 --to-id 380500 --no-state     # explicit range, no cursor
  python3 scripts/lake_spine.py --tail --limit 5000              # from the lake_spine_state cursor

ENVIRONMENT
  CLOUDFLARE_API_TOKEN  Bearer token: Pipelines write, Pipelines send, R2 Data Catalog, Basin SQL read, D1 read/write
  CLOUDFLARE_ACCOUNT_ID optional (default is the Quniverse account)
EXIT  0 done; 1 a call was refused (the refusal text is printed verbatim); 2 missing configuration
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

API = "https://api.cloudflare.com/client/v4"
SQL_API = "https://api.sql.cloudflarestorage.com/api/v1/accounts/%s/basin-sql/query/%s"
USER_AGENT = "qnfo-lake-spine/1.0 (+https://qnfo.org)"
ACCOUNT = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "edb167b78c9fb901ea5bca3ce58ccc4b")
AUDIT_DB = "35e2e573-92f3-46ac-83c6-22f6429fc5e5"
CATALOG_BUCKET = "qnfo-audit"
CATALOG_NAMESPACE = "telemetry"
BATCH = 500

# table -> D1 source columns and Iceberg types. LAKE_FIELDS must stay equal to the list in qnfo-infra/worker.js
# (LAKE_TABLES.fleet_probe_log.fields); qnfo-infra/lake-spine.test.mjs compares them.
TABLES = {
    "fleet_probe_log": {
        "stream": "telemetry_fleet_probe_log_stream",
        "sink": "telemetry_fleet_probe_log_sink",
        "pipeline": "telemetry_fleet_probe_log",
        "fields": [
            ("id", "int64", True),
            ("ts", "string", False),
            ("source", "string", False),
            ("name", "string", False),
            ("url", "string", False),
            ("transport", "string", False),
            ("ok", "int64", False),
            ("status", "int64", False),
            ("ms", "int64", False),
            ("body", "string", False),
            ("exported_at", "string", False),
        ],
    },
}


def fields_of(table):
    return [{"name": n, "type": t, "required": r} for (n, t, r) in TABLES[table]["fields"]]


def pipeline_sql(table):
    t = TABLES[table]
    cols = ", ".join(n for (n, _t, _r) in t["fields"])
    return "insert into %s select %s from %s" % (t["sink"], cols, t["stream"])


def api(method, path, token, body=None):
    req = urllib.request.Request(API + path, data=(json.dumps(body).encode() if body is not None else None),
                                 method=method, headers={"Authorization": "Bearer " + token,
                                                         "Content-Type": "application/json",
                                                         "User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read() or b"{}"
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {"raw": raw[:300].decode("utf-8", "replace")}


def refusal(what, st, j):
    """Exact refusal text, the evidence blocker_redteam needs (never paraphrased)."""
    sys.stderr.write("REFUSED %s: HTTP %s %s\n" % (what, st, json.dumps(j)[:600]))
    return 1


def ensure_infrastructure(table, token):
    t = TABLES[table]
    out = []
    st, j = api("GET", "/accounts/%s/pipelines/v1/streams" % ACCOUNT, token)
    if st != 200:
        raise RuntimeError("list streams: %s %s" % (st, json.dumps(j)[:300]))
    stream = next((s for s in (j.get("result") or []) if s.get("name") == t["stream"]), None)
    if not stream:
        st, j = api("POST", "/accounts/%s/pipelines/v1/streams" % ACCOUNT, token, {
            "name": t["stream"], "format": {"type": "json", "unstructured": False},
            "schema": {"fields": fields_of(table)}, "http": {"enabled": True, "authentication": True}})
        if st not in (200, 201):
            raise RuntimeError("create stream: %s %s" % (st, json.dumps(j)[:400]))
        stream = j["result"]
        out.append({"created": t["stream"], "id": stream["id"], "endpoint": stream.get("endpoint")})
    else:
        out.append({"exists": t["stream"], "id": stream["id"], "endpoint": stream.get("endpoint")})
    st, j = api("GET", "/accounts/%s/pipelines/v1/sinks" % ACCOUNT, token)
    if st != 200:
        raise RuntimeError("list sinks: %s %s" % (st, json.dumps(j)[:300]))
    sink = next((s for s in (j.get("result") or []) if s.get("name") == t["sink"]), None)
    if not sink:
        st, j = api("POST", "/accounts/%s/pipelines/v1/sinks" % ACCOUNT, token, {
            "name": t["sink"], "type": "r2_data_catalog",
            "config": {"account_id": ACCOUNT, "bucket": CATALOG_BUCKET, "namespace": CATALOG_NAMESPACE,
                       "table_name": table, "token": token, "rolling_policy": {"interval_seconds": 60}},
            "format": {"type": "parquet"}, "schema": {"fields": fields_of(table)}})
        if st not in (200, 201):
            raise RuntimeError("create sink: %s %s" % (st, json.dumps(j)[:400]))
        out.append({"created": t["sink"], "id": j["result"]["id"]})
    else:
        out.append({"exists": t["sink"], "id": sink["id"]})
    st, j = api("GET", "/accounts/%s/pipelines/v1/pipelines" % ACCOUNT, token)
    if st != 200:
        raise RuntimeError("list pipelines: %s %s" % (st, json.dumps(j)[:300]))
    pipe = next((p for p in (j.get("result") or []) if p.get("name") == t["pipeline"]), None)
    if not pipe:
        st, j = api("POST", "/accounts/%s/pipelines/v1/pipelines" % ACCOUNT, token,
                    {"name": t["pipeline"], "sql": pipeline_sql(table)})
        if st not in (200, 201):
            raise RuntimeError("create pipeline: %s %s" % (st, json.dumps(j)[:400]))
        out.append({"created": t["pipeline"], "id": j["result"]["id"]})
    else:
        out.append({"exists": t["pipeline"], "id": pipe["id"], "status": pipe.get("status")})
    return out


def check(table, token):
    t = TABLES[table]
    rep = {"table": table, "stream": None, "sink": None, "pipeline": None, "iceberg_tables": None}
    st, j = api("GET", "/accounts/%s/pipelines/v1/streams" % ACCOUNT, token)
    if st == 200:
        rep["stream"] = next((s for s in (j.get("result") or []) if s.get("name") == t["stream"]), None)
        if rep["stream"]:
            rep["stream"] = {k: rep["stream"].get(k) for k in ("id", "name", "endpoint", "worker_binding", "http")}
    st, j = api("GET", "/accounts/%s/pipelines/v1/sinks" % ACCOUNT, token)
    if st == 200:
        s = next((x for x in (j.get("result") or []) if x.get("name") == t["sink"]), None)
        rep["sink"] = s and {"id": s.get("id"), "type": s.get("type"),
                             "table": (s.get("config") or {}).get("table_name"),
                             "namespace": (s.get("config") or {}).get("namespace")}
    st, j = api("GET", "/accounts/%s/pipelines/v1/pipelines" % ACCOUNT, token)
    if st == 200:
        rep["pipeline"] = next(({"id": p.get("id"), "status": p.get("status"), "sql": p.get("sql")}
                                for p in (j.get("result") or []) if p.get("name") == t["pipeline"]), None)
    st, j = api("GET", "/accounts/%s/r2-catalog/%s/namespaces/%s/tables" % (ACCOUNT, CATALOG_BUCKET, CATALOG_NAMESPACE), token)
    rep["iceberg_tables"] = (j.get("result") or j) if st == 200 else {"http": st, "body": json.dumps(j)[:200]}
    return rep


def sql_query(sql, token):
    req = urllib.request.Request(SQL_API % (ACCOUNT, CATALOG_BUCKET), data=json.dumps({"query": sql}).encode(),
                                 method="POST", headers={"Authorization": "Bearer " + token,
                                                         "Content-Type": "application/json", "User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read() or b"{}"
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {"raw": raw[:300].decode("utf-8", "replace")}


def d1(sql, params, token):
    st, j = api("POST", "/accounts/%s/d1/database/%s/query" % (ACCOUNT, AUDIT_DB), token, {"sql": sql, "params": params or []})
    if not (200 <= st < 300) or not j.get("success"):
        raise RuntimeError("d1 query: %s %s" % (st, json.dumps(j)[:300]))
    return (j.get("result") or [{}])[0].get("results") or []


def send(rows, url, token):
    if not rows:
        return 0
    req = urllib.request.Request(url, data=json.dumps(rows).encode(), method="POST", headers={
        "Authorization": "Bearer " + token, "Content-Type": "application/json", "User-Agent": USER_AGENT})
    # The user-agent is required, not cosmetic: the ingest edge answers the default Python agent with 403 `error code: 1010`.
    with urllib.request.urlopen(req, timeout=60) as r:
        j = json.loads(r.read() or b"{}")
    got = (j.get("result") or {}).get("committed")
    if got is not None and int(got) != len(rows):
        raise RuntimeError("stream committed %s of %s rows: %s" % (got, len(rows), json.dumps(j)[:200]))
    return len(rows)


def tail(table, token, limit, from_id, to_id, no_state, now_iso):
    cols = [n for (n, _t, _r) in TABLES[table]["fields"] if n != "exported_at"]
    sti, jj = api("GET", "/accounts/%s/pipelines/v1/streams" % ACCOUNT, token)
    stream = next((s for s in (jj.get("result") or []) if s.get("name") == TABLES[table]["stream"]), None) if sti == 200 else None
    if not stream or not stream.get("endpoint"):
        raise RuntimeError("stream %s not found: run --ensure-infrastructure" % TABLES[table]["stream"])
    cursor = from_id
    if cursor is None and not no_state:
        rows = d1("SELECT cursor_id FROM lake_spine_state WHERE tbl = ?1", [table], token)
        cursor = int(rows[0]["cursor_id"]) if rows else None
    if cursor is None:
        raise RuntimeError("no cursor: pass --from-id or run the lakeTailTick once (it seeds the cursor)")
    sent = 0
    while sent < limit:
        take = min(BATCH, limit - sent)
        if to_id is not None:
            rows = d1("SELECT %s FROM %s WHERE id > ?1 AND id <= ?2 ORDER BY id LIMIT ?3" % (", ".join(cols), table), [cursor, to_id, take], token)
        else:
            rows = d1("SELECT %s FROM %s WHERE id > ?1 ORDER BY id LIMIT ?2" % (", ".join(cols), table), [cursor, take], token)
        if not rows:
            break
        for r in rows:
            r["exported_at"] = now_iso
        send(rows, stream["endpoint"], token)
        cursor = int(rows[-1]["id"])
        sent += len(rows)
        if not no_state:
            d1("UPDATE lake_spine_state SET cursor_id = ?2, rows_sent = rows_sent + ?3, last_run_at = ?4, last_error = NULL WHERE tbl = ?1",
               [table, cursor, len(rows), now_iso], token)
    return {"table": table, "sent": sent, "cursor": cursor}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--table", default="fleet_probe_log", choices=sorted(TABLES))
    ap.add_argument("--ensure-infrastructure", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--query")
    ap.add_argument("--tail", action="store_true")
    ap.add_argument("--limit", type=int, default=5000)
    ap.add_argument("--from-id", type=int)
    ap.add_argument("--to-id", type=int)
    ap.add_argument("--no-state", action="store_true")
    a = ap.parse_args(argv)
    token = os.environ.get("CLOUDFLARE_API_TOKEN") or ""
    if not token:
        sys.stderr.write("CLOUDFLARE_API_TOKEN is not set\n")
        return 2
    try:
        if a.ensure_infrastructure:
            print(json.dumps(ensure_infrastructure(a.table, token), indent=2))
        elif a.check:
            print(json.dumps(check(a.table, token), indent=2, sort_keys=True))
        elif a.query:
            st, j = sql_query(a.query, token)
            print(json.dumps({"http": st, "body": j}, indent=2))
            return 0 if st == 200 else refusal("basin-sql", st, j)
        elif a.tail:
            import datetime as dt
            now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            print(json.dumps(tail(a.table, token, a.limit, a.from_id, a.to_id, a.no_state, now)))
        else:
            ap.print_help()
            return 2
    except urllib.error.HTTPError as e:
        return refusal("http", e.code, {"body": (e.read() or b"")[:300].decode("utf-8", "replace")})
    except RuntimeError as e:
        sys.stderr.write("REFUSED %s\n" % e)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
