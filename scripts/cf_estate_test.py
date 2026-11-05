#!/usr/bin/env python3
"""CF-ESTATE-1 offline suite for scripts/cf_estate.py (NEXT-QNFO.INFRA.WORK, PAGE, DNS, D1, R2).

No network, no token, no live state: every classifier is driven with small fixtures, the repository scan runs on a temporary tree, the
transport is replaced by a fake. The real docs/DOMAINS.md is parsed once, because the doc is what the DNS check reads and a row that stops
parsing must fail a pull request, not the next live run.
Run: python3 scripts/cf_estate_test.py   -> prints "N passed, 0 failed"
"""
import contextlib
import importlib.util
import io
import json
import os
import pathlib
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
spec = importlib.util.spec_from_file_location("cf_estate", HERE / "cf_estate.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

passed = failed = 0


def ok(cond, msg, extra=None):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print("FAIL", msg, json.dumps(extra, default=str)[:500] if extra is not None else "")


def write(path, text=""):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


# ------------------------------------------------------------------------------------------------------------ wrangler and repo scan
W = '''name = "alpha"
main = "worker.js"
# name = "commented"
workers_dev = true
[triggers]
crons = ["30 * * * *", "0 6 * * *"]
[[r2_buckets]]
binding = "A"
bucket_name = "bucket-a"
# bucket_name = "bucket-commented"
[[routes]]
pattern = "alpha.example.org/*"
zone_name = "example.org"
'''
w = m.parse_wrangler(W)
ok(w["name"] == "alpha", "wrangler name is the top-level one, comments ignored", w)
ok(w["crons"] == 2 and w["routes"] == 1 and w["buckets"] == ["bucket-a"] and w["workers_dev"] is True, "crons, routes, buckets, workers_dev", w)
ok(m.parse_wrangler("")["name"] is None and m.parse_wrangler("")["crons"] == 0, "empty toml parses")

with tempfile.TemporaryDirectory() as tmp:
    write(os.path.join(tmp, "alpha", "wrangler.toml"), W)
    write(os.path.join(tmp, "alpha", "worker.js"), "export default {}")
    write(os.path.join(tmp, "old", "wrangler.toml"), 'name = "old-name"\n[[r2_buckets]]\nbucket_name = "bucket-old"\n')
    write(os.path.join(tmp, "old", "worker.js"), "x")
    write(os.path.join(tmp, "old", "RETIRED"), "retired")
    write(os.path.join(tmp, "docsonly", "README.md"), "x")
    write(os.path.join(tmp, ".hidden", "wrangler.toml"), 'name = "h"')
    write(os.path.join(tmp, "scripts", "uses.py"), 'BUCKET = "bucket-a"\nPAGES = "https://zeta.pages.dev/x"')
    write(os.path.join(tmp, ".github", "workflows", "d.yml"), "run: wrangler pages deploy out --project-name=zeta\n")
    write(os.path.join(tmp, ".github", "workflows", "c.yml"), "# mentions beta only in a comment\n")
    repo = m.scan_repo(tmp)
    ok(sorted(repo) == ["alpha", "old"], "scan_repo sees dirs with worker.js or wrangler.toml, not hidden or doc-only", sorted(repo))
    ok(repo["old"]["marker"] == "RETIRED" and repo["alpha"]["marker"] is None and repo["alpha"]["name"] == "alpha", "marker and name", repo)
    ok(m.scan_text_refs(tmp, ["bucket-a", "bucket-b"]) == {"bucket-a": ["scripts/uses.py"], "bucket-b": []}, "text refs find a script's bucket", m.scan_text_refs(tmp, ["bucket-a", "bucket-b"]))
    ok(m.scan_pages_refs(tmp, ["zeta", "beta"]) == {"zeta": ["scripts/uses.py"], "beta": []}, "pages refs need the .pages.dev host", m.scan_pages_refs(tmp, ["zeta", "beta"]))
    ok("zeta" in m.workflows_text(tmp) and "beta" not in m.workflows_text(tmp), "only Pages-deploying workflows count")

# ----------------------------------------------------------------------------------------------------------------------- domains doc
DOC = '''# t
## Inventory
| Host | Plane | Worker | Right place? |
|---|---|---|---|
| `me.q08.org` | personal | personal-api | yes |
| `qnfo.org`, `www.qnfo.org`, `legal.`, `papers.` (custom domain) | research | gw | yes |
| `ipatent.qnfo.org`, `qnfo.org/ipatent*` | research | ip | yes |
| `analytics.`, `lifecycle.` `.qnfo.org` | fleet | lc | yes |
| `personal.qnfo.org` | personal | pa | no, research domain |
| `ask.qwav.tech` | quantum | s | kept; do not detach |
| `bad.qnfo.org` | personal | x | yes |

Workers reached only by `x.workers.dev` serve machines.
'''
rows = m.parse_domains_md(DOC)
hosts = {h for r in rows for h in r["hosts"]}
ok(len(rows) == 7, "seven rows, the prose after the table is not a row", len(rows))
ok({"legal.qnfo.org", "papers.qnfo.org", "analytics.qnfo.org", "lifecycle.qnfo.org", "qnfo.org", "ipatent.qnfo.org"} <= hosts, "labels take the zone of their cell or the trailing .zone token", sorted(hosts))
ok(next(r for r in rows if r["hosts"] == ["personal.qnfo.org"])["right"] == "no" and next(r for r in rows if r["hosts"] == ["ask.qwav.tech"])["right"] == "yes", "right is no only for a no row")
bad = m.check_planes(rows)
ok([b["host"] for b in bad] == ["bad.qnfo.org"], "a personal host outside q08.org is a violation; a row marked no is not", bad)
ok(m.check_planes([{"hosts": ["x.q08.org"], "plane": "research", "right": "yes"}])[0]["why"].startswith("q08.org host"), "a q08.org host must be personal")
ok(m.check_planes([{"hosts": ["a.qwav.org"], "plane": "research", "right": "yes"}]) != [] and m.check_planes([{"hosts": ["a.qnfo.org"], "plane": "quantum", "right": "yes"}]) != [], "qwav and quantum agree")
ok(m.zone_of("a.b.qnfo.org") == "qnfo.org" and m.zone_of("x.co.uk", ["co.uk"]) == "co.uk", "zone_of")

real = m.parse_domains_md(m.read_doc(str(ROOT)))
real_hosts = {h for r in real for h in r["hosts"]}
ok(len(real) >= 25 and {"me.q08.org", "legal.qnfo.org", "qnfo-calibration-audit.qnfo.org", "ask.qwav.org", "mind.q08.org", "hub.qnfo.org"} <= real_hosts, "the real docs/DOMAINS.md parses with its labelled and suffixed rows", len(real))
ok(m.check_planes(real) == [], "the real docs/DOMAINS.md has no plane violation (DOMAIN-PLANE-1)", m.check_planes(real))

# ------------------------------------------------------------------------------------------------------------------------- workers
repo = {"alpha": {"name": "alpha", "has_worker": True, "marker": None, "crons": 1, "routes": 0, "buckets": []},
        "gone": {"name": "gone", "has_worker": True, "marker": "FOLDED", "crons": 0, "routes": 0, "buckets": []},
        "notyet": {"name": "notyet", "has_worker": True, "marker": None, "crons": 0, "routes": 0, "buckets": []}}
rep = m.classify_workers(["alpha", "gone", "stub", "orphan"], repo,
                         {"alpha": ["worker", "live"], "orphan": ["worker", "live"], "stub": ["worker", "retired"], "ghost": ["worker", "live"]},
                         {"stub": [410, "TOMBSTONE_410 selfstate"], "orphan": [200, "UNMANAGED_OK"]}, {"alpha": 10, "orphan": 5}, {"alpha": ["a.example.org"]}, cap=2)
cls = {r["script"]: r["class"] for r in rep["rows"]}
ok(cls == {"alpha": "managed", "gone": "retired-present", "stub": "tombstone", "orphan": "unmanaged"}, "four classes", cls)
ok(rep["scripts"] == 4 and rep["fleet_workers"] == 3 and rep["over_cap"] == 1 and rep["tombstones"] == ["stub"], "tombstones leave the fleet count", rep)
ok(rep["registry_disagreement_raw"] == ["ghost", "gone", "stub"], "raw disagreement counts the stub", rep["registry_disagreement_raw"])
ok(rep["registry_disagreement_tombstone_aware"] == ["ghost", "gone"], "tombstone-aware disagreement drops only the stub", rep["registry_disagreement_tombstone_aware"])
ok(rep["undeployed"] == ["notyet"] and rep["unmanaged"] == ["orphan"] and rep["retired_present"] == ["gone"], "undeployed, unmanaged, retired-present", rep)
ok(rep["lowest_traffic_managed"][0]["script"] == "alpha" and rep["lowest_traffic_managed"][0]["no_custom_host"] is False, "managed ranked by traffic with its hosts", rep["lowest_traffic_managed"])
live_dir = m.classify_workers(["alpha"], repo, {}, {"alpha": [410, "TOMBSTONE"]}, {})
ok(live_dir["classes"]["tombstone"] == 0 and live_dir["classes"]["managed"] == 1, "a script with live source is never a tombstone, whatever its audit row says", live_dir["classes"])

# --------------------------------------------------------------------------------------------------------------------------- pages
NOW = 1793836800.0  # 2026-11-05T00:00:00Z
doc = {"deep.example.org", "hub.example.org", "ask.example.org"}
routes = {"ask.example.org": ["svc"]}
proj = [
    {"name": "p-keep", "domains": ["p-keep.pages.dev", "deep.example.org"], "latest_deploy": "2026-08-01T00:00:00Z"},
    {"name": "p-doc", "domains": ["p-doc.pages.dev", "new.example.org"], "latest_deploy": "2026-10-30T00:00:00Z"},
    {"name": "p-shadow", "domains": ["p-shadow.pages.dev", "ask.example.org"], "latest_deploy": "2026-08-01T00:00:00Z"},
    {"name": "p-shadow-wf", "domains": ["ask.example.org"], "latest_deploy": "2026-08-01T00:00:00Z"},
    {"name": "p-ref", "domains": ["p-ref.pages.dev"], "latest_deploy": "2026-08-01T00:00:00Z"},
    {"name": "p-new", "domains": ["p-new.pages.dev"], "latest_deploy": "2026-11-04T00:00:00Z"},
    {"name": "p-wf", "domains": ["p-wf.pages.dev"], "latest_deploy": "2026-08-01T00:00:00Z"},
    {"name": "p-old", "domains": ["p-old.pages.dev"], "latest_deploy": "2026-09-01T00:00:00Z"},
]
got = {r["project"]: r["verdict"] for r in m.classify_pages(proj, doc, routes, "wrangler pages deploy --project-name=p-wf --x p-shadow-wf", {"p-ref": ["radar/worker.js"]}, NOW)}
ok(got == {"p-keep": "keep", "p-doc": "document", "p-shadow": "review", "p-shadow-wf": "keep", "p-ref": "review", "p-new": "active", "p-wf": "active", "p-old": "retire-candidate"}, "pages verdicts", got)
ok(m.days_since("2026-11-04T00:00:00Z", NOW) == 1.0 and m.days_since(None) is None and m.days_since("junk") is None, "days_since")
ok(m.host_matches("*.example.org", "a.example.org") and not m.host_matches("*.example.org", "example.org") and m.host_matches("A.example.org/*", "a.example.org"), "host_matches")
ok(m.route_host_index({"z": {"routes": ["a.example.org/*->s1", "example.org/x*->s2"]}}) == {"a.example.org": ["s1"], "example.org": ["s2"]}, "route index")

# ----------------------------------------------------------------------------------------------------------------------------- dns
doc_rows = [{"hosts": ["a.example.org", "b.example.org", "c.example.org", "d.example.org", "gone.example.net"], "plane": "research", "right": "yes"}]
est = {
    "zones": {
        "example.org": {"name_servers": ["N1.ns.example", "n2.ns.example"], "routes": ["a.example.org/*->svc", "x.example.org/*->svc", "ask.example.org/*->svc"],
                         "dns": [{"name": "b.example.org", "type": "CNAME", "content": "ghost-worker.q08.workers.dev", "proxied": True},
                                 {"name": "c.example.org", "type": "CNAME", "content": "p1.pages.dev", "proxied": False},
                                 {"name": "e.example.org", "type": "CNAME", "content": "nopages.pages.dev", "proxied": True}],
                         "redirect_hosts": ["d.example.org", "elsewhere.example.com"]},
        "example.com": {"name_servers": ["n1.ns.example"], "routes": [], "dns": [], "redirect_hosts": []},
    },
    "custom_domains": [{"hostname": "cd.example.org", "service": "svc"}],
    "scripts": ["svc"],
    "pages": [{"name": "p1", "domains": ["p1.pages.dev", "ask.example.org"]}],
    "delegation": {"example.org": ["n1.ns.example", "n2.ns.example"], "example.com": [], "other.com": None},
}
d = m.evaluate_dns(doc_rows, est)
ok([x["host"] for x in d["missing"]] == ["gone.example.net"], "missing: a documented host of a zone not in the account (a host with a DNS record only is not missing: a redirect rule written on the URL names no host)", d["missing"])
ok({x["host"] for x in d["undocumented"]} == {"x.example.org", "ask.example.org", "cd.example.org", "elsewhere.example.com"}, "undocumented hosts that are served (route, custom domain, Pages domain, redirect)", d["undocumented"])
ok(d["shadowed_pages"] == [{"host": "ask.example.org", "pages": "p1", "route": "svc"}], "pages domain shadowed by a route", d["shadowed_pages"])
ok({x["record"] for x in d["dangling_target"]} == {"b.example.org", "e.example.org"}, "dangling CNAME targets (no script, no Pages project)", d["dangling_target"])
ok([x["record"] for x in d["unproxied_web"]] == ["c.example.org"], "unproxied record to pages.dev", d["unproxied_web"])
ok(d["delegation_lost"] == [{"zone": "example.com", "expected": ["n1.ns.example"], "public": []}], "delegation lost only where the public answer differs; a failed lookup is not a finding", d["delegation_lost"])
ok(d["stray_redirect"] == [{"zone": "example.org", "host": "elsewhere.example.com", "belongs_to": "example.com"}], "a redirect rule naming a host of another account zone is stray", d["stray_redirect"])
est2 = json.loads(json.dumps(est))
est2["zones"]["example.com"]["redirect_hosts"] = ["q.example.org"]
ok({"zone": "example.com", "host": "q.example.org", "belongs_to": "example.org"} in m.evaluate_dns(doc_rows, est2)["stray_redirect"], "the same rule in the other direction")
ok(d["hard"] == len(d["missing"]) + len(d["dangling_target"]) + len(d["unproxied_web"]) + len(d["plane_violation"]) and d["counts"]["missing"] == len(d["missing"]), "hard is the sum of the hard classes", d["hard"])
ok(m.host_regex_list('(http.host eq "A.x.org" and http.request.uri.path eq "/") or (http.host in {"b.x.org" "c.x.org"})') == ["a.x.org", "b.x.org", "c.x.org"], "redirect expression hosts")

class Resp:
    def __init__(self, body):
        self.body = body

    def read(self):
        return self.body.encode()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


ok(m.doh_nameservers("a.org", lambda req, timeout=0: Resp('{"Status":0,"Answer":[{"type":2,"data":"B.ns.x."},{"type":2,"data":"a.ns.x."},{"type":1,"data":"1.2.3.4"}]}')) == ["a.ns.x", "b.ns.x"], "DoH NS answer parsed and sorted")
ok(m.doh_nameservers("a.org", lambda req, timeout=0: Resp('{"Status":3}')) == [], "NXDOMAIN is an empty answer")
ok(m.doh_nameservers("a.org", lambda req, timeout=0: (_ for _ in ()).throw(OSError("down"))) is None, "a failed lookup is None, not delegation lost")

# ------------------------------------------------------------------------------------------------------------------------------ d1
cases = {
    "INSERT OR REPLACE INTO cron_fault_seen (a) SELECT a FROM v_x": ("INSERT", "cron_fault_seen"),
    "  insert into main.\"t1\" values (1)": ("INSERT", "t1"),
    "UPDATE fleet_runs SET status = 'failed' WHERE status = 'from x'": ("UPDATE", "fleet_runs"),
    "DELETE FROM old_rows WHERE id < 5": ("DELETE", "old_rows"),
    "SELECT a FROM v_view v JOIN t2 ON t2.id = v.id": ("SELECT", "v_view"),
    "WITH c AS (SELECT 1) SELECT * FROM real_tbl": ("WITH", "real_tbl"),
    "/* hint */ SELECT x -- FROM nope\n FROM yes_tbl": ("SELECT", "yes_tbl"),
    "CREATE INDEX IF NOT EXISTS idx_a ON big_table (a)": ("CREATE", "big_table"),
    "PRAGMA table_info(x)": ("PRAGMA", None),
    "REPLACE INTO kv (k) VALUES (1)": ("REPLACE", "kv"),
}
for sql, want in cases.items():
    ok(m.sql_primary_table(sql) == want, "primary table of %r" % sql[:40], m.sql_primary_table(sql))
groups = [
    {"count": 100, "queryDurationMs": 5000, "rowsRead": 20000000, "rowsWritten": 10, "query": "INSERT OR REPLACE INTO hot (a) SELECT a FROM v_src"},
    {"count": 10, "queryDurationMs": 100, "rowsRead": 1000, "rowsWritten": 0, "query": "SELECT * FROM hot WHERE id = ?"},
    {"count": 5, "queryDurationMs": 50, "rowsRead": 500, "rowsWritten": 5, "query": "UPDATE cold SET a = 1"},
    {"count": 1, "queryDurationMs": 1, "rowsRead": 0, "rowsWritten": 0, "query": "PRAGMA foreign_keys"},
]
agg = m.aggregate_d1(groups)
ok(agg["totals"]["rows_read"] == sum(g["rowsRead"] for g in groups) and agg["totals"]["calls"] == 116, "totals add up", agg["totals"])
ok(sum(t["rows_read"] for t in agg["tables"]) == agg["totals"]["rows_read"], "each statement is attributed to one table, so the table sums equal the total")
ok(agg["tables"][0]["table"] == "hot" and agg["tables"][0]["calls"] == 110 and agg["tables"][0]["rows_written"] == 10, "tables ranked by rows read", agg["tables"][0])
ok(len(agg["scan_suspects"]) == 1 and agg["scan_suspects"][0]["rows_read_per_call"] == 200000, "scan suspect needs 100000 rows per call", agg["scan_suspects"])
ok(next(t for t in agg["tables"] if t["table"] == "(none)")["kind"] == "table", "a statement with no table is kept under (none)")
ok(m.aggregate_d1([{"count": 1, "rowsRead": 1, "query": "SELECT * FROM v_a"}])["tables"][0]["kind"] == "view", "v_ names are views")
base = m.aggregate_d1([{"count": 100, "queryDurationMs": 8000, "rowsRead": 40000000, "rowsWritten": 10, "query": "INSERT OR REPLACE INTO hot (a) SELECT a FROM v_src"}])
delta = {x["table"]: x for x in m.compare_d1(agg, base)}
ok(delta["hot"]["change_pct"] == -50.0 and delta["hot"]["was"] == 40000000 and delta["cold"]["was"] is None and delta["cold"]["change_pct"] is None, "delta against a baseline report", delta)
rep = m.run_d1({"db": "d", "hours": 6, "groups": groups, "databases": [{"name": "a", "size_mb": 1}, {"name": "b", "size_mb": 9}]}, str(ROOT), {"d1": base})
ok(rep["databases"][0]["name"] == "b" and rep["delta"][0]["table"] == "hot", "run_d1 sorts databases by size and accepts a RESULT_JSON baseline", rep["databases"])

# ------------------------------------------------------------------------------------------------------------------------------ r2
buckets = [{"name": "pub", "payload_bytes": 2e9, "objects": 5, "managed_enabled": True, "custom_domains": []},
           {"name": "assets", "payload_bytes": 1, "objects": 1, "managed_enabled": True, "custom_domains": []},
           {"name": "bound", "payload_bytes": 5e9, "objects": 9, "managed_enabled": False, "custom_domains": []},
           {"name": "idle", "payload_bytes": 3e9, "objects": 9, "managed_enabled": False, "custom_domains": []},
           {"name": "busy", "payload_bytes": 4e9, "objects": 9, "managed_enabled": False, "custom_domains": ["files.example.org"]}]
rows = {r["bucket"]: r for r in m.classify_r2(buckets, {"bound": ["w1"], "pub": ["w2"]}, {"bound": 0, "idle": 3, "busy": 5000, "pub": 10}, {"idle": ["scripts/x.py"]}, {"assets": "calendar feeds"})}
ok(rows["pub"]["flags"] == ["public-unexpected", "idle"], "public with no allowlist entry is a finding", rows["pub"])
ok(rows["assets"]["flags"][0] == "public-expected" and rows["assets"]["public_note"] == "calendar feeds", "allowlisted public bucket carries its reason")
ok(rows["bound"]["state"] == "bound" and rows["idle"]["state"] == "idle-unbound" and rows["busy"]["state"] == "unbound", "bound, idle-unbound, unbound", {k: v["state"] for k, v in rows.items()})
ok(rows["busy"]["flags"] == ["public-unexpected", "unbound"], "a custom domain makes a bucket public", rows["busy"])
ok(rows["idle"]["referenced_in"] == ["scripts/x.py"], "script references are kept for the reader")
unk = m.classify_r2(buckets[:1], {}, None)
ok(unk[0]["requests_30d"] is None and "idle" not in unk[0]["flags"] and unk[0]["state"] == "unbound", "unknown request counts never call a bucket idle", unk)
ok([r["bucket"] for r in m.classify_r2(buckets, {}, None)][:2] == ["bound", "busy"], "largest first")

# ------------------------------------------------------------------------------------------------------------ transport and CLI
calls = []


def fake_api(method, path, token, body=None, timeout=60):
    calls.append((method, path))
    if path.endswith("/r2/buckets") or "/r2/buckets?" in path:
        return 200, {"success": True, "result": {"buckets": [{"name": "b1", "creation_date": "2026-01-01T00:00:00Z"}]}, "result_info": {"total_pages": 1}}
    if path.endswith("/usage"):
        return 200, {"success": True, "result": {"payloadSize": "2000000000", "objectCount": "7"}}
    if path.endswith("/domains/managed"):
        return 200, {"success": True, "result": {"enabled": True}}
    if path.endswith("/domains/custom"):
        return 200, {"success": True, "result": {"domains": []}}
    return 404, {}


real_api, real_gql = m.api, m.graphql
m.api = fake_api
m.graphql = lambda q, v, t: {"_error": "graphql HTTP 200 [\"Rate limiter budget depleted\"]"}
data = m.fetch_r2("acct", "tok", str(ROOT))
ok(data["buckets"][0]["payload_bytes"] == 2000000000 and data["buckets"][0]["managed_enabled"] is True and data["ops"] is None, "fetch_r2 reads usage and public access; a depleted GraphQL budget leaves ops unknown", data)
ok(any("r2OperationsAdaptiveGroups" in e for e in data["errors"]), "the degraded read is reported", data["errors"])
ok(all(c[0] == "GET" for c in calls), "fetch_r2 only reads", calls)
ok(any(c[1].endswith("/r2/buckets?per_page=1000") for c in calls) and not any("/r2/buckets" in c[1] and "page=" in c[1].replace("per_page=", "") for c in calls), "the R2 list is one cursor page: no page number is sent", calls)
m.api = lambda *a, **k: (500, {"errors": [{"message": "boom"}]})
errs = []
ok(m.api_list("/accounts/a/workers/scripts", "t", "scripts", errs) == [] and errs and "HTTP 500" in errs[0], "api_list reports a failed page and stops", errs)
m.api, m.graphql = real_api, real_gql

with tempfile.TemporaryDirectory() as tmp:
    inp = os.path.join(tmp, "in.json")
    out = os.path.join(tmp, "dump.json")
    write(os.path.join(tmp, "docs", "DOMAINS.md"), DOC.replace("`bad.qnfo.org`", "`ok.q08.org`"))
    write(inp, json.dumps({"buckets": buckets, "ops": {"idle": 1}, "errors": []}))

    def run(argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = m.main(argv)
        return rc, buf.getvalue()

    rc, text = run(["r2-inventory", "--input", inp, "--root", tmp, "--dump", out])
    line = [l for l in text.splitlines() if l.startswith("RESULT_JSON=")][0]
    res = json.loads(line[len("RESULT_JSON="):])
    ok(rc == 0 and res["action"] == "r2-inventory" and res["r2"]["buckets"] == 5 and "idle" in res["r2"]["idle_unbound"], "main replays a capture and prints one RESULT_JSON line", res.get("r2", {}).get("idle_unbound"))
    ok(os.path.isfile(out) is True, "--dump writes the data it used")
    rc, text = run(["doc-check", "--root", tmp])
    ok(rc == 0 and "RESULT_JSON=" in text, "doc-check passes on a doc without a violation")
    write(os.path.join(tmp, "docs", "DOMAINS.md"), DOC)
    rc, text = run(["doc-check", "--root", tmp])
    ok(rc == 1 and "bad.qnfo.org" in text, "doc-check exits 1 on a plane violation", text)
    dn = os.path.join(tmp, "dns.json")
    write(dn, json.dumps(est))
    rc, _ = run(["dns-drift", "--input", dn, "--root", tmp])
    ok(rc == 0, "dns-drift reports and exits 0 by default")
    rc, _ = run(["dns-drift", "--input", dn, "--root", tmp, "--strict"])
    ok(rc == 1, "dns-drift --strict exits 1 on a hard finding")
    pg = os.path.join(tmp, "pages.json")
    write(pg, json.dumps({"projects": proj, "zones": {"z": {"routes": ["ask.example.org/*->svc"]}}, "errors": []}))
    rc, text = run(["pages-inventory", "--input", pg, "--root", tmp])
    ok(rc == 0 and "p-old" in text and "retire-candidate" in text, "pages-inventory prints the verdict table", text[:200])
    wk = os.path.join(tmp, "w.json")
    write(wk, json.dumps({"live": ["a", "stub"], "registry": {"a": ["worker", "live"], "stub": ["worker", "retired"]}, "audit": {"stub": [410, "TOMBSTONE"]}, "usage": {"a": 1}, "hosts": {}, "errors": []}))
    rc, text = run(["worker-inventory", "--input", wk, "--root", tmp])
    ok(rc == 0 and "1 tombstone(s) ['stub']" in text, "worker-inventory reports the tombstone", text[:300])
    dq = os.path.join(tmp, "d.json")
    write(dq, json.dumps({"db": "x", "hours": 6, "groups": groups, "databases": [], "errors": ["d1QueriesAdaptiveGroups sum_queryDurationMs_DESC: rate limited"]}))
    rc, text = run(["d1-query-report", "--input", dq, "--root", tmp])
    ok(rc == 0 and "Degraded reads" in text, "a rate-limited GraphQL read is reported but is not a failure", rc)
    write(dq, json.dumps({"db": "x", "hours": 6, "groups": [], "databases": [], "errors": ["zones: HTTP 500"]}))
    rc, _ = run(["d1-query-report", "--input", dq, "--root", tmp])
    ok(rc == 3, "any other fetch error exits 3", rc)
    saved = {k: os.environ.pop(k, None) for k in ("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID")}
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        ok(m.main(["r2-inventory", "--live"]) == 2, "--live without a token exits 2")
        ok(m.main(["r2-inventory"]) == 2, "no source exits 2")
    for k, v in saved.items():
        if v is not None:
            os.environ[k] = v

print("%d passed, %d failed" % (passed, failed))
sys.exit(1 if failed else 0)
