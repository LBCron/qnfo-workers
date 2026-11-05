#!/usr/bin/env python3
"""cf_estate.py -- CF-ESTATE-1 (charter pillar: core; roadmap rows NEXT-QNFO.INFRA.WORK/PAGE/DNS/D1/R2, 2026-11-04).

WHY   The five QNFO.INFRA projects (workers, Pages, DNS, D1, R2) had no machine view of their own estate. What existed measured pieces
      (deploy-drift-guard.py: repo version against /health; qnfo-infra collectState: names and counts) and nothing answered the questions
      an owner asks first: how many workers do we really run, which Pages projects are dead, which hosts does the account serve that the
      domain doc does not name, which statements read the most rows, which buckets are public or idle. Measured on 2026-11-04 with this
      module's logic: 39 account scripts of which 1 is a tombstone (worker_count reads 39 and worker_count_disagreement 1 for that stub);
      7 Pages projects, 2 with no custom domain and no deploy for over 30 days and 1 whose only domain is shadowed by a worker route;
      11 hosts served and absent from docs/DOMAINS.md; the statement `INSERT OR REPLACE INTO cron_fault_seen` read 102M rows in 6 hours;
      19 buckets (the system map lists 12), 7 unbound with 50 or fewer requests in 30 days, one public through r2.dev with no reference.
WHAT   Five read-only actions, one per project, plus `doc-check`. Each fetches with the repository token (GitHub Actions) or replays a
      captured fetch (`--input FILE`, the shape `--dump FILE` writes), runs a pure classifier, prints a markdown summary and one line
      `RESULT_JSON=<json>`. Nothing here writes to Cloudflare, D1 or the repository: a verdict (retire, detach, disable) is a finding that a
      guarded action or a person executes after a dependency check.
        worker-inventory  account scripts against repo directories, RETIRED/FOLDED markers, service_registry and worker_live_audit;
                          tombstone-aware counts (what worker_count and worker_count_disagreement would read), cap gap, lowest-traffic workers.
        pages-inventory   each Pages project: domains, last deploy age, documented or not, shadowed by a worker route; verdict
                          keep | active | document | retire-candidate.
        dns-drift         docs/DOMAINS.md host table against zone routes, worker custom domains, Pages domains, redirect rules and DNS
                          records: missing, undocumented, shadowed, dangling CNAME target, unproxied web record, delegation lost.
        d1-query-report   Cloudflare d1QueriesAdaptiveGroups for one database: rows read, rows written and query time per table and per
                          statement, scan suspects, database sizes, delta against a baseline report (`--baseline FILE`).
        r2-inventory      each bucket: size, objects, public access, worker bindings in the repo, requests in 30 days; idle-unbound and
                          public-unexpected findings.
        doc-check         offline: docs/DOMAINS.md parses and its plane rules hold (personal on q08.org only, quantum on qwav.*).
USAGE python3 scripts/cf_estate.py <action> [--live] [--input FILE] [--dump FILE] [--baseline FILE] [--hours N] [--db NAME] [--root DIR]
      --live needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (the workflow cf-estate.yml sets both); without --live or --input the
      action reads nothing from Cloudflare and exits 2.
EXIT  0 report written (dns-drift with --strict: 1 on a hard finding: missing, dangling, unproxied, plane); doc-check: 1 on a plane violation;
      2 bad arguments or no token;
      3 a fetch failed (the error is in the output; a rate-limited GraphQL read degrades to null fields and is not a failure).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
API = "https://api.cloudflare.com/client/v4"
AUDIT_DB = "35e2e573-92f3-46ac-83c6-22f6429fc5e5"  # qnfo-audit (public database; the private ones are never read here)
MARKERS = ("RETIRED", "FOLDED")
WORKER_CAP = 30  # metric_registry worker_count trigger (gt 30)
PAGES_IDLE_DAYS = 30
R2_IDLE_OPS_30D = 100
SCAN_ROWS_PER_CALL = 100000
# Buckets that are public on purpose, with the reason; any other bucket with r2.dev or a custom domain enabled is a finding.
R2_PUBLIC_EXPECTED = {"qnfo-assets": "calendar .ics bearer URLs (R2_PUBLIC in qnfo-lifecycle and personal-companion)"}
# Planes of docs/DOMAINS.md (DOMAIN-PLANE-1): the host table is the source of truth the checks read.
PLANE_PERSONAL_ZONES = ("q08.org",)


# --------------------------------------------------------------------------------------------------------------------- transport

def api(method: str, path: str, token: str, body: dict | None = None, timeout: int = 60) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method,
                                 headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}
    except Exception as e:  # DNS failure, timeout: reported as status 0, never raised
        return 0, {"errors": [{"message": str(e)[:200]}]}


def api_result(path: str, token: str, what: str, errors: list) -> list | dict | None:
    st, j = api("GET", path, token)
    if st != 200 or j.get("success") is False:
        errors.append("%s: HTTP %s %s" % (what, st, json.dumps(j.get("errors") or "")[:160]))
        return None
    return j.get("result")


def api_list(path: str, token: str, what: str, errors: list, per_page: int = 100, max_pages: int = 20, paged: bool = True) -> list:
    """GET every page of a list endpoint. R2 lists by cursor and takes no page number: paged=False reads the one page of per_page items."""
    out, page = [], 1
    sep = "&" if "?" in path else "?"
    while page <= max_pages:
        st, j = api("GET", "%s%sper_page=%d%s" % (path, sep, per_page, "&page=%d" % page if paged else ""), token)
        if st != 200 or j.get("success") is False:
            errors.append("%s: HTTP %s %s" % (what, st, json.dumps(j.get("errors") or "")[:160]))
            break
        res = j.get("result")
        if isinstance(res, dict):  # R2 style: {"buckets": [...]}
            res = next((v for v in res.values() if isinstance(v, list)), [])
        out += res or []
        info = j.get("result_info") or {}
        if not res or page >= int(info.get("total_pages") or 1):
            break
        page += 1
    return out


def graphql(query: str, variables: dict, token: str) -> dict:
    st, j = api("POST", "/graphql", token, {"query": query, "variables": variables}, timeout=90)
    if not 200 <= (st or 0) < 300 or j.get("errors") or not j.get("data"):
        return {"_error": "graphql HTTP %s %s" % (st, json.dumps(j.get("errors") or "")[:200])}
    return j["data"]


def d1_rows(acct: str, token: str, db_id: str, sql: str, errors: list) -> list:
    st, j = api("POST", "/accounts/%s/d1/database/%s/query" % (acct, db_id), token, {"sql": sql, "params": []})
    if not 200 <= st < 300 or j.get("success") is False:
        errors.append("d1 %s: HTTP %s %s" % (sql[:48], st, json.dumps(j.get("errors") or "")[:160]))
        return []
    res = j.get("result") or []
    return (res[0].get("results") if res else []) or []


def iso_window(hours: float, now: float | None = None) -> tuple[str, str]:
    end = now if now is not None else time.time()
    f = "%Y-%m-%dT%H:%M:%SZ"
    return time.strftime(f, time.gmtime(end - hours * 3600)), time.strftime(f, time.gmtime(end))


# ------------------------------------------------------------------------------------------------------------------ repository scan

def parse_wrangler(text: str) -> dict:
    """The few facts the reports need from a wrangler.toml: worker name, cron count, route count, custom domain, R2 buckets, workers_dev."""
    body = "\n".join(l for l in (text or "").splitlines() if not l.strip().startswith("#"))
    top = re.split(r"^\[", body, maxsplit=1, flags=re.M)[0]
    m = re.search(r'^\s*name\s*=\s*"([^"]+)"', top, re.M)
    crons = sum(len(re.findall(r'"[^"]+"', cm.group(1))) for cm in re.finditer(r"^\s*crons\s*=\s*\[(.*?)\]", body, re.M | re.S))
    wd = re.search(r"^\s*workers_dev\s*=\s*(true|false)", top, re.M)
    return {
        "name": m.group(1) if m else None,
        "crons": crons,
        "routes": len(re.findall(r'(?:^|[\s{,])(?:pattern|route)\s*=\s*"', body, re.M)),
        "custom_domain": bool(re.search(r"custom_domain\s*=\s*true", body)),
        "buckets": sorted(set(re.findall(r'^\s*bucket_name\s*=\s*"([^"]+)"', body, re.M))),
        "workers_dev": None if not wd else wd.group(1) == "true",
    }


def scan_repo(root: str = ROOT) -> dict:
    """{dir: {name, has_worker, marker, crons, routes, custom_domain, buckets, workers_dev}} for every top-level directory with a wrangler.toml or worker.js."""
    out = {}
    for d in sorted(os.listdir(root)):
        p = os.path.join(root, d)
        if d.startswith(".") or not os.path.isdir(p):
            continue
        has_worker = os.path.isfile(os.path.join(p, "worker.js"))
        wt = os.path.join(p, "wrangler.toml")
        if not has_worker and not os.path.isfile(wt):
            continue
        info = parse_wrangler(open(wt, encoding="utf-8", errors="replace").read()) if os.path.isfile(wt) else parse_wrangler("")
        info["has_worker"] = has_worker
        info["marker"] = next((m for m in MARKERS if os.path.isfile(os.path.join(p, m))), None)
        info["name"] = info["name"] or d
        out[d] = info
    return out


def scan_text_refs(root: str, names: list, exclude: tuple = ("cf_estate.py", "cf_estate_test.py")) -> dict:
    """{name: [relative file]} for each name that appears in scripts/ or .github/workflows/ (a bucket a script or a workflow uses without a binding)."""
    found = {n: [] for n in names}
    for sub in ("scripts", os.path.join(".github", "workflows")):
        base = os.path.join(root, sub)
        if not os.path.isdir(base):
            continue
        for f in sorted(os.listdir(base)):
            if f in exclude or not f.endswith((".py", ".mjs", ".sh", ".yml", ".js")):
                continue
            try:
                text = open(os.path.join(base, f), encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            for n in names:
                if re.search(r"(?<![\w-])" + re.escape(n) + r"(?![\w-])", text) and len(found[n]) < 6:
                    found[n].append(sub.replace("\\", "/") + "/" + f)
    return found


# ------------------------------------------------------------------------------------------------------------------ docs/DOMAINS.md

def parse_domains_md(text: str) -> list:
    """Rows of the `## Inventory` host table: [{hosts, plane, worker, right}]. A token `legal.` is a label of the zone named in the same cell
    (`qnfo.org`) or by a trailing `.qnfo.org` token; `qnfo.org/ipatent*` is the host `qnfo.org`; annotations such as (custom domain) are dropped."""
    rows = []
    in_table = False
    for line in (text or "").splitlines():
        if line.startswith("| Host"):
            in_table = True
            continue
        if not in_table:
            continue
        if not line.startswith("|"):
            if rows:
                break
            continue
        if re.match(r"^\|\s*-", line):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 4:
            continue
        toks = re.findall(r"`([^`]+)`", cells[0])
        zone_hint = next((t.lstrip(".") for t in toks if t.startswith(".")), None)
        fq = [t.split("/")[0] for t in toks if not t.startswith(".") and not t.endswith(".")]
        zone = zone_hint or (".".join(fq[0].split(".")[-2:]) if fq else None)
        hosts = []
        for t in toks:
            if t.startswith("."):
                continue
            if t.endswith("."):
                if zone:
                    hosts.append(t + zone)
                continue
            hosts.append(t.split("/")[0])
        right = cells[3].lower()
        rows.append({"hosts": sorted(set(h.lower() for h in hosts)), "plane": cells[1].strip().lower(), "worker": cells[2],
                     "right": "no" if right.startswith("no") else "yes"})
    return rows


def zone_of(host: str, zones: list | None = None) -> str:
    labels = host.split(".")
    if zones:
        for i in range(len(labels) - 1):
            cand = ".".join(labels[i:])
            if cand in zones:
                return cand
    return ".".join(labels[-2:])


def check_planes(rows: list) -> list:
    """DOMAIN-PLANE-1 on the doc itself. A row the doc marks `no` (a known wrong place) is not a violation, it is the record of one."""
    bad = []
    for r in rows:
        if r["right"] == "no":
            continue
        for h in r["hosts"]:
            z = zone_of(h)
            if r["plane"] == "personal" and z not in PLANE_PERSONAL_ZONES:
                bad.append({"host": h, "why": "personal plane host outside q08.org"})
            elif z in PLANE_PERSONAL_ZONES and r["plane"] != "personal":
                bad.append({"host": h, "why": "q08.org host on plane %s" % r["plane"]})
            elif r["plane"] == "quantum" and not z.startswith("qwav."):
                bad.append({"host": h, "why": "quantum plane host outside qwav.*"})
            elif z.startswith("qwav.") and r["plane"] not in ("quantum",):
                bad.append({"host": h, "why": "qwav.* host on plane %s" % r["plane"]})
    return bad


# ------------------------------------------------------------------------------------------------------------------------ WORK

def classify_workers(live: list, repo: dict, registry: dict, audit: dict, usage: dict, hosts: dict | None = None, cap: int = WORKER_CAP) -> dict:
    """Reconcile account scripts with the repository, the registry and the live audit.
    live: script names; repo: scan_repo(); registry: {service: [kind, state]}; audit: {worker: [http, note]}; usage: {script: requests_7d};
    hosts: {script: [host]} from the live zone routes and worker custom domains.
    A tombstone is a script the account keeps on purpose and answers 410 (the Workers Builds stub qnfo-workers): it is not a fleet worker."""
    by_name = {}
    for d, i in repo.items():
        by_name.setdefault(i["name"], dict(i, dir=d))
        by_name.setdefault(d, dict(i, dir=d))
    rows, tomb = [], set()
    for s in sorted(live):
        i = by_name.get(s)
        http, note = (audit.get(s) or [None, ""])[:2]
        is_tomb = (http == 410 or "TOMBSTONE" in str(note or "").upper()) and not (i and i["has_worker"] and not i["marker"])
        if is_tomb:
            cls = "tombstone"
        elif i and i["marker"]:
            cls = "retired-present"
        elif i and i["has_worker"]:
            cls = "managed"
        else:
            cls = "unmanaged"
        if cls == "tombstone":
            tomb.add(s)
        rows.append({"script": s, "class": cls, "dir": (i or {}).get("dir"), "marker": (i or {}).get("marker"), "crons": (i or {}).get("crons"),
                     "routes": (i or {}).get("routes"), "hosts": sorted(set((hosts or {}).get(s) or [])), "requests_7d": usage.get(s),
                     "registry": "/".join(registry.get(s) or []) or None})
    live_set = set(live)
    reg_live = {k for k, v in registry.items() if (v[0] if v else "worker") == "worker" and (v[1] if len(v) > 1 else "live") == "live"}
    raw = sorted(live_set ^ reg_live)
    aware = sorted((live_set - tomb) ^ (reg_live - tomb))
    undeployed = sorted(i["name"] for i in repo.values() if i["has_worker"] and not i["marker"] and i["name"] not in live_set)
    fleet = len(live_set - tomb)
    managed = [r for r in rows if r["class"] == "managed"]
    low = sorted([r for r in managed if r["requests_7d"] is not None], key=lambda r: r["requests_7d"])[:8]
    return {
        "scripts": len(live_set), "tombstones": sorted(tomb), "fleet_workers": fleet, "cap": cap, "over_cap": fleet - cap,
        "classes": {c: sum(1 for r in rows if r["class"] == c) for c in ("managed", "unmanaged", "tombstone", "retired-present")},
        "unmanaged": [r["script"] for r in rows if r["class"] == "unmanaged"],
        "retired_present": [r["script"] for r in rows if r["class"] == "retired-present"],
        "undeployed": undeployed,
        "registry_disagreement_raw": raw, "registry_disagreement_tombstone_aware": aware,
        "lowest_traffic_managed": [{"script": r["script"], "requests_7d": r["requests_7d"], "crons": r["crons"], "hosts": r["hosts"],
                                    "no_custom_host": not r["hosts"]} for r in low],
        "rows": rows,
    }


def fetch_workers(acct: str, token: str, root: str) -> dict:
    errors: list = []
    live = [s.get("id") for s in api_list("/accounts/%s/workers/scripts" % acct, token, "workers/scripts", errors) if s.get("id")]
    q = lambda sql: d1_rows(acct, token, AUDIT_DB, sql, errors)  # noqa: E731
    registry = {r["service"]: [r.get("kind"), r.get("state")] for r in q("SELECT service, kind, state FROM service_registry")}
    audit = {r["worker"]: [r.get("http"), r.get("note")] for r in q("SELECT worker, http, note FROM worker_live_audit")}
    usage = {r["script"]: r.get("requests_7d") for r in q(
        "SELECT script, requests_7d FROM worker_usage_daily WHERE day = (SELECT MAX(day) FROM worker_usage_daily)")}
    hosts: dict = {}
    for z in fetch_zones(token, errors, dns=False).values():
        for r in z["routes"]:
            pat, _, script = r.partition("->")
            hosts.setdefault(script, []).append(pat.split("/")[0])
    for c in api_result("/accounts/%s/workers/domains" % acct, token, "workers/domains", errors) or []:
        hosts.setdefault(c.get("service"), []).append(c.get("hostname"))
    return {"live": live, "registry": registry, "audit": audit, "usage": usage, "hosts": hosts, "errors": errors}


def run_workers(data: dict, root: str) -> dict:
    return classify_workers(data.get("live") or [], scan_repo(root), data.get("registry") or {}, data.get("audit") or {}, data.get("usage") or {}, data.get("hosts") or {})


# ------------------------------------------------------------------------------------------------------------------------ PAGES

def days_since(iso: str | None, now: float | None = None) -> float | None:
    if not iso:
        return None
    try:
        t = dt.datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None
    return round(((now if now is not None else time.time()) - t) / 86400, 1)


def host_matches(pattern: str, host: str) -> bool:
    pattern, host = pattern.lower().split("/")[0], host.lower()
    if pattern.startswith("*."):
        return host.endswith(pattern[1:]) and host != pattern[2:]
    return pattern == host


def route_host_index(zones: dict) -> dict:
    """{host: [script]} for every non-wildcard worker route pattern of every zone."""
    out: dict = {}
    for z in zones.values():
        for r in z.get("routes") or []:
            pat, _, script = str(r).partition("->")
            out.setdefault(pat.split("/")[0].lower(), []).append(script or "-")
    return out


def classify_pages(projects: list, documented: set, route_hosts: dict, workflow_text: str = "", refs: dict | None = None, now: float | None = None) -> list:
    """Verdict per Pages project, first match wins:
    document         a custom domain that docs/DOMAINS.md does not name;
    keep             a documented custom domain that no worker route shadows, or a shadowed one a workflow in this repository deploys;
    review           every custom domain is also answered by a worker route (the route wins; it may or may not fetch this deployment: compare
                     the two bodies before detaching), or an idle project that code in this repository names (`<name>.pages.dev`);
    active           no custom domain, deployed within PAGES_IDLE_DAYS or deployed by a workflow;
    retire-candidate no custom domain, no deploy for PAGES_IDLE_DAYS, no workflow, no reference in code. A candidate is a finding, never an action."""
    rows = []
    for p in projects:
        custom = [d for d in p.get("domains") or [] if not d.endswith(".pages.dev")]
        shadowed = [d for d in custom if d.lower() in route_hosts]
        undoc = [d for d in custom if d.lower() not in documented]
        age = days_since(p.get("latest_deploy") or p.get("created_on"), now)
        wf = bool(p["name"] and re.search(r"(?<![\w-])" + re.escape(p["name"]) + r"(?![\w-])", workflow_text or ""))
        used_by = (refs or {}).get(p["name"]) or []
        if undoc:
            verdict, why = "document", "custom domains not in docs/DOMAINS.md: %s" % ", ".join(undoc)
        elif custom and len(shadowed) < len(custom):
            verdict, why = "keep", "documented custom domains: %s" % ", ".join(d for d in custom if d not in shadowed)
        elif custom and wf:
            verdict, why = "keep", "a workflow deploys it; %s also answered by a worker route" % ", ".join(shadowed)
        elif custom:
            verdict, why = "review", "every custom domain (%s) is also answered by a worker route; compare the bodies before detaching" % ", ".join(shadowed)
        elif used_by:
            verdict, why = "review", "no custom domain, but code names %s.pages.dev: %s" % (p["name"], ", ".join(used_by))
        elif wf or (age is not None and age <= PAGES_IDLE_DAYS):
            verdict, why = "active", "no custom domain; %s" % ("a workflow names it" if wf else "deployed %s days ago" % age)
        else:
            verdict, why = "retire-candidate", "no custom domain, last deploy %s days ago, no workflow names it, no code references it" % age
        rows.append({"project": p["name"], "verdict": verdict, "why": why, "domains": p.get("domains") or [], "shadowed": shadowed,
                     "undocumented": undoc, "last_deploy_days": age, "git_source": bool(p.get("source")), "workflow": wf, "referenced_by": used_by})
    return rows


def scan_pages_refs(root: str, names: list) -> dict:
    """{project: [relative file]} for code that names `<project>.pages.dev`: live worker sources, scripts and workflows."""
    found = {n: [] for n in names}
    targets = []
    for d in sorted(os.listdir(root)):
        p = os.path.join(root, d)
        if d.startswith(".") or not os.path.isdir(p):
            continue
        if d in ("scripts", ".github"):
            continue
        if os.path.isfile(os.path.join(p, "worker.js")) and not any(os.path.isfile(os.path.join(p, m)) for m in MARKERS):
            targets.append(d + "/worker.js")
    for sub in ("scripts", os.path.join(".github", "workflows")):
        base = os.path.join(root, sub)
        if os.path.isdir(base):
            targets += [(sub.replace("\\", "/") + "/" + f) for f in sorted(os.listdir(base)) if f.endswith((".py", ".mjs", ".sh", ".yml", ".js")) and f not in ("cf_estate.py", "cf_estate_test.py")]
    for rel in targets:
        try:
            text = open(os.path.join(root, rel), encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        for n in names:
            if re.search(re.escape(n) + r"\.pages\.dev", text) and len(found[n]) < 6:
                found[n].append(rel)
    return found


def fetch_pages(acct: str, token: str, root: str) -> dict:
    errors: list = []
    res = api_list("/accounts/%s/pages/projects" % acct, token, "pages/projects", errors)
    projects = [{"name": p.get("name"), "domains": p.get("domains") or [], "created_on": p.get("created_on"),
                 "latest_deploy": (p.get("latest_deployment") or {}).get("created_on"), "source": bool(p.get("source"))} for p in res]
    zones = fetch_zones(token, errors, dns=False)
    return {"projects": projects, "zones": zones, "errors": errors}


PAGES_DEPLOY = re.compile(r"pages deploy|pages-action|/pages/projects|wrangler pages|pages_project", re.I)


def workflows_text(root: str) -> str:
    """The text of the workflows that deploy to Pages (a workflow that only mentions a project in a comment does not deploy it)."""
    base = os.path.join(root, ".github", "workflows")
    if not os.path.isdir(base):
        return ""
    texts = (open(os.path.join(base, f), encoding="utf-8", errors="replace").read() for f in sorted(os.listdir(base)) if f.endswith(".yml"))
    return "\n".join(t for t in texts if PAGES_DEPLOY.search(t))


def run_pages(data: dict, root: str) -> dict:
    docs = parse_domains_md(read_doc(root))
    documented = {h for r in docs for h in r["hosts"]}
    names = [p["name"] for p in data.get("projects") or []]
    rows = classify_pages(data.get("projects") or [], documented, route_host_index(data.get("zones") or {}), workflows_text(root), scan_pages_refs(root, names))
    return {"projects": len(rows), "verdicts": {v: sum(1 for r in rows if r["verdict"] == v) for v in ("keep", "active", "document", "review", "retire-candidate")},
            "rows": rows}


# -------------------------------------------------------------------------------------------------------------------------- DNS

def host_regex_list(expression: str) -> list:
    hosts = re.findall(r'http\.host\s+eq\s+"([^"]+)"', expression or "")
    for grp in re.findall(r"http\.host\s+in\s+\{([^}]*)\}", expression or ""):
        hosts += re.findall(r'"([^"]+)"', grp)
    return [h.lower() for h in hosts]


def fetch_zones(token: str, errors: list, dns: bool = True) -> dict:
    zones = {}
    for z in api_list("/zones", token, "zones", errors, per_page=50):
        o = {"id": z.get("id"), "status": z.get("status"), "paused": z.get("paused"), "name_servers": z.get("name_servers") or [], "routes": [], "dns": [], "redirect_hosts": []}
        st, j = api("GET", "/zones/%s/workers/routes" % z["id"], token)
        if st == 200:
            o["routes"] = ["%s->%s" % (r.get("pattern"), r.get("script") or "-") for r in j.get("result") or []]
        else:
            errors.append("routes %s: HTTP %s" % (z.get("name"), st))
        if dns:
            for r in api_list("/zones/%s/dns_records" % z["id"], token, "dns " + str(z.get("name")), errors, per_page=100):
                if r.get("type") in ("A", "AAAA", "CNAME"):
                    o["dns"].append({"name": r.get("name"), "type": r.get("type"), "content": r.get("content"), "proxied": bool(r.get("proxied"))})
            st, j = api("GET", "/zones/%s/rulesets/phases/http_request_dynamic_redirect/entrypoint" % z["id"], token)
            if st == 200:
                for rule in (j.get("result") or {}).get("rules") or []:
                    o["redirect_hosts"] += host_regex_list(rule.get("expression") or "")
        zones[z["name"]] = o
    return zones


def doh_nameservers(zone: str, opener=urllib.request.urlopen) -> list | None:
    """Public NS answer for a zone apex from Cloudflare DNS over HTTPS; [] on NXDOMAIN, None when the lookup itself failed."""
    req = urllib.request.Request("https://cloudflare-dns.com/dns-query?name=%s&type=NS" % urllib.parse.quote(zone), headers={"accept": "application/dns-json"})
    try:
        with opener(req, timeout=15) as r:
            j = json.loads(r.read().decode())
    except Exception:
        return None
    return sorted(a["data"].rstrip(".").lower() for a in j.get("Answer") or [] if a.get("type") == 2)


def evaluate_dns(doc_rows: list, estate: dict) -> dict:
    zones = estate.get("zones") or {}
    scripts = set(estate.get("scripts") or [])
    pages = {p["name"]: p for p in estate.get("pages") or []}
    served: dict = {}

    def add(host, src):
        served.setdefault(host.lower(), set()).add(src)

    for zname, z in zones.items():
        for r in z.get("routes") or []:
            pat, _, script = str(r).partition("->")
            add(pat.split("/")[0], "route:" + (script or "-"))
        for h in z.get("redirect_hosts") or []:
            add(h, "redirect")
        for rec in z.get("dns") or []:
            add(rec["name"], "dns")
    for c in estate.get("custom_domains") or []:
        add(c["hostname"], "custom-domain:" + str(c.get("service")))
    for p in pages.values():
        for d in p.get("domains") or []:
            if not d.endswith(".pages.dev"):
                add(d, "pages:" + p["name"])

    def real(srcs):  # something answers: a route, a custom domain, a Pages domain or a redirect rule
        return {s for s in srcs if s != "dns"}

    doc_hosts = {h for r in doc_rows for h in r["hosts"]}
    out = {"missing": [], "undocumented": [], "shadowed_pages": [], "dangling_target": [], "unproxied_web": [], "delegation_lost": [], "plane_violation": check_planes(doc_rows)}
    for h in sorted(doc_hosts):
        z = zone_of(h, zones)
        srcs = served.get(h, set())
        wild = any(host_matches(p, h) for p in served if p.startswith("*."))
        if z in zones and not real(srcs) and not wild and "dns" not in srcs:
            out["missing"].append({"host": h, "zone": z})
        elif z not in zones and not srcs:
            out["missing"].append({"host": h, "zone": z, "why": "zone not in the account"})
    for h, srcs in sorted(served.items()):
        if h.startswith("*") or h.endswith((".workers.dev", ".pages.dev")):
            continue
        if h not in doc_hosts and real(srcs):
            out["undocumented"].append({"host": h, "served_by": sorted(real(srcs))})
        pg = [s for s in srcs if s.startswith("pages:")]
        rt = [s for s in srcs if s.startswith("route:")]
        if pg and rt:  # the route wins; whether it fetches the deployment is for a body comparison to say (pages-inventory verdict review)
            out["shadowed_pages"].append({"host": h, "pages": pg[0][6:], "route": rt[0][6:]})
    for zname, z in zones.items():
        for rec in z.get("dns") or []:
            tgt = str(rec.get("content") or "").lower()
            m = re.match(r"^([\w-]+)\.q08\.workers\.dev$", tgt)
            pm = re.match(r"^([\w-]+)\.pages\.dev$", tgt)
            if rec.get("type") == "CNAME" and scripts and m and m.group(1) not in scripts:
                out["dangling_target"].append({"record": rec["name"], "target": tgt, "why": "no such worker script in the account"})
            if rec.get("type") == "CNAME" and pages and pm and pm.group(1) not in pages:
                out["dangling_target"].append({"record": rec["name"], "target": tgt, "why": "no such Pages project"})
            if not rec.get("proxied") and tgt.endswith((".workers.dev", ".pages.dev")):
                out["unproxied_web"].append({"record": rec["name"], "target": tgt})
    for zname, seen in (estate.get("delegation") or {}).items():
        ns = sorted(n.lower() for n in (zones.get(zname) or {}).get("name_servers") or [])
        if seen is not None and ns and sorted(seen) != ns:
            out["delegation_lost"].append({"zone": zname, "expected": ns, "public": seen})
    out["stray_redirect"] = []  # a redirect rule that names a host of another zone can never match: the rule belongs to that zone
    for zname, z in zones.items():
        for h in z.get("redirect_hosts") or []:
            hz = zone_of(h, zones)
            if hz in zones and hz != zname:
                out["stray_redirect"].append({"zone": zname, "host": h, "belongs_to": hz})
    out["hard"] =sum(len(out[k]) for k in ("missing", "dangling_target", "unproxied_web", "plane_violation"))
    out["counts"] = {k: len(v) for k, v in out.items() if isinstance(v, list)}
    out["hosts_documented"], out["hosts_served"] = len(doc_hosts), len([h for h, s in served.items() if real(s)])
    return out


def fetch_dns(acct: str, token: str, root: str) -> dict:
    errors: list = []
    zones = fetch_zones(token, errors, dns=True)
    custom = [{"hostname": c.get("hostname"), "service": c.get("service")} for c in api_result("/accounts/%s/workers/domains" % acct, token, "workers/domains", errors) or []]
    scripts = [s.get("id") for s in api_list("/accounts/%s/workers/scripts" % acct, token, "workers/scripts", errors) if s.get("id")]
    res = api_list("/accounts/%s/pages/projects" % acct, token, "pages/projects", errors)
    pages = [{"name": p.get("name"), "domains": p.get("domains") or []} for p in res]
    delegation = {z: doh_nameservers(z) for z in zones}
    return {"zones": zones, "custom_domains": custom, "scripts": scripts, "pages": pages, "delegation": delegation, "errors": errors}


def run_dns(data: dict, root: str) -> dict:
    return evaluate_dns(parse_domains_md(read_doc(root)), data)


# ---------------------------------------------------------------------------------------------------------------------------- D1

def strip_sql(sql: str) -> str:
    s = re.sub(r"/\*.*?\*/", " ", sql or "", flags=re.S)
    s = re.sub(r"--[^\n]*", " ", s)
    s = re.sub(r"'(?:[^']|'')*'", "''", s)
    return re.sub(r"\s+", " ", s).strip()


def _ident(raw: str) -> str:
    name = raw.strip('`"[]').split(".")[-1].strip('`"[]')
    return name.lower()


def sql_primary_table(sql: str) -> tuple[str, str | None]:
    """(verb, table) of the statement's own target: the INTO table of an INSERT, the UPDATE or DELETE table, else the first FROM table.
    A statement is attributed to one table only, so the per-table sums add up to the total."""
    s = strip_sql(sql)
    verb = (s.split(" ", 1)[0] or "").upper()
    pats = {
        "INSERT": r"\bINSERT(?:\s+OR\s+\w+)?\s+INTO\s+([\w.`\"\[\]]+)",
        "REPLACE": r"\bREPLACE\s+INTO\s+([\w.`\"\[\]]+)",
        "UPDATE": r"\bUPDATE(?:\s+OR\s+\w+)?\s+([\w.`\"\[\]]+)",
        "DELETE": r"\bDELETE\s+FROM\s+([\w.`\"\[\]]+)",
        "CREATE": r"\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[\w.`\"\[\]]+\s+ON\s+([\w.`\"\[\]]+)",
    }
    m = re.search(pats[verb], s, re.I) if verb in pats else None
    if not m:
        m = re.search(r"\bFROM\s+([\w.`\"\[\]]+)", s, re.I)
    return verb, (_ident(m.group(1)) if m else None)


def aggregate_d1(groups: list, top: int = 25) -> dict:
    tables: dict = {}
    stmts = []
    tot = {"calls": 0, "rows_read": 0, "rows_written": 0, "ms": 0.0}
    for g in groups:
        calls, rr, rw, ms = int(g.get("count") or 0), int(g.get("rowsRead") or 0), int(g.get("rowsWritten") or 0), float(g.get("queryDurationMs") or 0)
        verb, table = sql_primary_table(g.get("query") or "")
        key = table or "(none)"
        t = tables.setdefault(key, {"table": key, "kind": "view" if re.match(r"^vw?_", key) else "table", "statements": 0, "calls": 0,
                                    "rows_read": 0, "rows_written": 0, "ms": 0.0, "writes": 0})
        t["statements"] += 1
        t["calls"] += calls
        t["rows_read"] += rr
        t["rows_written"] += rw
        t["ms"] = round(t["ms"] + ms, 1)
        t["writes"] += calls if verb in ("INSERT", "REPLACE", "UPDATE", "DELETE") else 0
        for k, v in (("calls", calls), ("rows_read", rr), ("rows_written", rw), ("ms", ms)):
            tot[k] += v
        stmts.append({"verb": verb, "table": key, "calls": calls, "rows_read": rr, "rows_written": rw, "ms": round(ms, 1),
                      "rows_read_per_call": round(rr / calls) if calls else 0, "query": strip_sql(g.get("query") or "")[:160]})
    tot["ms"] = round(tot["ms"], 1)
    ranked = sorted(tables.values(), key=lambda t: -t["rows_read"])
    return {"totals": tot, "groups": len(groups), "tables": ranked[:top],
            "statements": sorted(stmts, key=lambda s: -s["rows_read"])[:top],
            "scan_suspects": [s for s in sorted(stmts, key=lambda s: -s["rows_read"]) if s["rows_read_per_call"] >= SCAN_ROWS_PER_CALL][:10]}


def compare_d1(cur: dict, base: dict) -> list:
    """Per-table change against an earlier report: the verification step of any D1 change (re-run the same window, compare)."""
    before = {t["table"]: t for t in (base or {}).get("tables") or []}
    out = []
    for t in cur.get("tables") or []:
        b = before.get(t["table"])
        out.append({"table": t["table"], "rows_read": t["rows_read"], "was": b["rows_read"] if b else None,
                    "change_pct": round(100.0 * (t["rows_read"] - b["rows_read"]) / b["rows_read"], 1) if b and b["rows_read"] else None,
                    "ms": t["ms"], "ms_was": b["ms"] if b else None})
    return out


D1_QUERY = ("query($acct:String!,$since:Time!,$until:Time!,$db:String!){viewer{accounts(filter:{accountTag:$acct}){"
            "d1QueriesAdaptiveGroups(limit:%d,filter:{datetime_geq:$since,datetime_leq:$until,databaseId:$db},orderBy:[%s]){"
            "count sum{queryDurationMs rowsRead rowsWritten} dimensions{query}}}}}")


def fetch_d1(acct: str, token: str, root: str, db: str, hours: float) -> dict:
    errors: list = []
    dbs = api_list("/accounts/%s/d1/database" % acct, token, "d1/database", errors)
    target = next((d for d in dbs if d.get("name") == db or d.get("uuid") == db), None)
    groups: dict = {}
    if target:
        since, until = iso_window(hours)
        for order in ("sum_rowsRead_DESC", "sum_queryDurationMs_DESC"):
            data = graphql(D1_QUERY % (500, order), {"acct": acct, "since": since, "until": until, "db": target["uuid"]}, token)
            if "_error" in data:
                errors.append("d1QueriesAdaptiveGroups %s: %s" % (order, data["_error"]))
                continue
            for g in (((data.get("viewer") or {}).get("accounts") or [{}])[0].get("d1QueriesAdaptiveGroups")) or []:
                groups[g["dimensions"]["query"]] = {"count": g["count"], "queryDurationMs": g["sum"]["queryDurationMs"], "rowsRead": g["sum"]["rowsRead"],
                                                    "rowsWritten": g["sum"]["rowsWritten"], "query": g["dimensions"]["query"]}
    else:
        errors.append("database %r not found in the account" % db)
    return {"db": db, "hours": hours, "databases": [{"name": d.get("name"), "size_mb": round((d.get("file_size") or 0) / 1e6, 1), "tables": d.get("num_tables")} for d in dbs],
            "groups": list(groups.values()), "errors": errors}


def run_d1(data: dict, root: str, baseline: dict | None = None) -> dict:
    rep = aggregate_d1(data.get("groups") or [])
    rep.update({"db": data.get("db"), "hours": data.get("hours"), "databases": sorted(data.get("databases") or [], key=lambda d: -(d.get("size_mb") or 0))})
    if baseline:
        rep["delta"] = compare_d1(rep, baseline.get("d1") if "d1" in baseline else baseline)
    return rep


# ---------------------------------------------------------------------------------------------------------------------------- R2

def classify_r2(buckets: list, bound: dict, ops: dict | None, refs: dict | None = None, public_expected: dict | None = None) -> list:
    public_expected = R2_PUBLIC_EXPECTED if public_expected is None else public_expected
    rows = []
    for b in sorted(buckets, key=lambda x: -(x.get("payload_bytes") or 0)):
        n = b["name"]
        workers = sorted(bound.get(n) or [])
        total = None if ops is None else int(ops.get(n, 0))
        public = bool(b.get("managed_enabled") or b.get("custom_domains"))
        flags = []
        if public:
            flags.append("public-expected" if n in public_expected else "public-unexpected")
        if not workers:
            flags.append("unbound")
        if total is not None and total < R2_IDLE_OPS_30D:
            flags.append("idle")
        state = "idle-unbound" if {"unbound", "idle"} <= set(flags) else "unbound" if "unbound" in flags else "bound"
        rows.append({"bucket": n, "state": state, "flags": flags, "size_gb": round((b.get("payload_bytes") or 0) / 1e9, 3), "objects": b.get("objects"),
                     "bound_by": workers, "requests_30d": total, "referenced_in": (refs or {}).get(n) or [], "created": b.get("created"),
                     "public_note": public_expected.get(n) if public else None})
    return rows


def fetch_r2(acct: str, token: str, root: str) -> dict:
    errors: list = []
    out = []
    for b in api_list("/accounts/%s/r2/buckets" % acct, token, "r2/buckets", errors, per_page=1000, paged=False):
        n = b.get("name")
        u = api_result("/accounts/%s/r2/buckets/%s/usage" % (acct, n), token, "r2 usage " + str(n), errors) or {}
        mg = api_result("/accounts/%s/r2/buckets/%s/domains/managed" % (acct, n), token, "r2 managed " + str(n), errors) or {}
        cu = api_result("/accounts/%s/r2/buckets/%s/domains/custom" % (acct, n), token, "r2 custom " + str(n), errors) or {}
        out.append({"name": n, "created": (b.get("creation_date") or "")[:10], "payload_bytes": int(u.get("payloadSize") or 0), "objects": int(u.get("objectCount") or 0),
                    "managed_enabled": bool(mg.get("enabled")), "custom_domains": [d.get("domain") for d in (cu.get("domains") or [])]})
    since, until = iso_window(30 * 24)
    q = ("query($acct:String!,$since:Time!,$until:Time!){viewer{accounts(filter:{accountTag:$acct}){r2OperationsAdaptiveGroups(limit:10000,"
         "filter:{datetime_geq:$since,datetime_leq:$until}){sum{requests} dimensions{bucketName}}}}}")
    data = graphql(q, {"acct": acct, "since": since, "until": until}, token)
    ops = None
    if "_error" in data:
        errors.append("r2OperationsAdaptiveGroups: " + data["_error"])
    else:
        ops = {}
        for g in (((data.get("viewer") or {}).get("accounts") or [{}])[0].get("r2OperationsAdaptiveGroups")) or []:
            ops[g["dimensions"]["bucketName"]] = ops.get(g["dimensions"]["bucketName"], 0) + int(g["sum"]["requests"] or 0)
    return {"buckets": out, "ops": ops, "errors": errors}


def run_r2(data: dict, root: str) -> dict:
    bound: dict = {}
    for d, i in scan_repo(root).items():
        if i["has_worker"] and not i["marker"]:
            for b in i["buckets"]:
                bound.setdefault(b, []).append(i["name"])
    buckets = data.get("buckets") or []
    rows = classify_r2(buckets, bound, data.get("ops"), scan_text_refs(root, [b["name"] for b in buckets]))
    unbound = [r for r in rows if "unbound" in r["flags"]]
    return {"buckets": len(rows), "total_gb": round(sum(r["size_gb"] for r in rows), 2), "public_unexpected": [r["bucket"] for r in rows if "public-unexpected" in r["flags"]],
            "idle_unbound": [r["bucket"] for r in rows if r["state"] == "idle-unbound"], "unbound": len(unbound),
            "ops_known": data.get("ops") is not None, "rows": rows}


# -------------------------------------------------------------------------------------------------------------------------- output

def read_doc(root: str) -> str:
    return open(os.path.join(root, "docs", "DOMAINS.md"), encoding="utf-8").read()


def md_table(headers: list, rows: list) -> str:
    out = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    for r in rows:
        out.append("| " + " | ".join(str(c).replace("|", "/") for c in r) + " |")
    return "\n".join(out)


def render(action: str, rep: dict, errors: list) -> str:
    L = ["## cf-estate %s" % action]
    if action == "worker-inventory":
        L.append("%d account scripts, %d tombstone(s) %s, %d fleet workers against a cap of %d (over by %d). Classes: %s." % (
            rep["scripts"], len(rep["tombstones"]), rep["tombstones"], rep["fleet_workers"], rep["cap"], rep["over_cap"], rep["classes"]))
        L.append("Registry disagreement: raw %s; tombstone-aware %s. Unmanaged (no source here): %s. Retired but still live: %s. In repo, not live: %s." % (
            rep["registry_disagreement_raw"], rep["registry_disagreement_tombstone_aware"], rep["unmanaged"], rep["retired_present"], rep["undeployed"]))
        L.append(md_table(["lowest traffic (7d)", "requests", "crons", "route or custom-domain hosts"],
                          [(r["script"], r["requests_7d"], r["crons"], ",".join(r["hosts"]) or "none (workers.dev, cron or service binding only)") for r in rep["lowest_traffic_managed"]]))
    elif action == "pages-inventory":
        L.append("%d projects: %s." % (rep["projects"], rep["verdicts"]))
        L.append(md_table(["project", "verdict", "days since deploy", "domains", "why"], [(r["project"], r["verdict"], r["last_deploy_days"], len(r["domains"]), r["why"]) for r in rep["rows"]]))
    elif action == "dns-drift":
        L.append("%d documented hosts, %d served. Counts: %s. Hard findings: %d." % (rep["hosts_documented"], rep["hosts_served"], rep["counts"], rep["hard"]))
        for k in ("missing", "dangling_target", "unproxied_web", "plane_violation", "delegation_lost", "stray_redirect", "shadowed_pages", "undocumented"):
            if rep[k]:
                L.append("**%s**: %s" % (k, json.dumps(rep[k])[:1500]))
    elif action == "d1-query-report":
        t = rep["totals"]
        L.append("%s, last %sh: %d statement groups, %d calls, %s rows read, %s rows written, %.0f s query time." % (
            rep.get("db"), rep.get("hours"), rep["groups"], t["calls"], format(t["rows_read"], ","), format(t["rows_written"], ","), t["ms"] / 1000))
        L.append(md_table(["table", "calls", "rows read", "rows written", "query s"], [(x["table"], x["calls"], format(x["rows_read"], ","), format(x["rows_written"], ","), round(x["ms"] / 1000, 1)) for x in rep["tables"][:12]]))
        L.append(md_table(["scan suspect (rows per call >= %d)" % SCAN_ROWS_PER_CALL, "calls", "rows per call"], [(s["query"][:90], s["calls"], format(s["rows_read_per_call"], ",")) for s in rep["scan_suspects"]]))
    elif action == "r2-inventory":
        L.append("%d buckets, %s GB; %d unbound; public unexpected: %s; idle and unbound: %s; request counts known: %s." % (
            rep["buckets"], rep["total_gb"], rep["unbound"], rep["public_unexpected"], rep["idle_unbound"], rep["ops_known"]))
        L.append(md_table(["bucket", "state", "GB", "objects", "requests 30d", "bound by", "flags"], [(r["bucket"], r["state"], r["size_gb"], r["objects"], r["requests_30d"], ",".join(r["bound_by"]), ",".join(r["flags"])) for r in rep["rows"]]))
    elif action == "doc-check":
        L.append("%d host rows parsed, %d plane violation(s)." % (rep["rows"], len(rep["plane_violation"])))
    if errors:
        L.append("Degraded reads: " + "; ".join(errors[:6]))
    return "\n\n".join(L)


# ----------------------------------------------------------------------------------------------------------------------------- main

ACTIONS = ("worker-inventory", "pages-inventory", "dns-drift", "d1-query-report", "r2-inventory", "doc-check")


def main(argv: list | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("action", choices=ACTIONS)
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--strict", action="store_true", help="dns-drift exits 1 on a hard finding (default: report only, exit 0)")
    ap.add_argument("--input")
    ap.add_argument("--dump")
    ap.add_argument("--baseline")
    ap.add_argument("--hours", type=float, default=6.0)
    ap.add_argument("--db", default="qnfo-audit")
    ap.add_argument("--root", default=ROOT)
    a = ap.parse_args(argv)
    if a.action == "doc-check":
        rows = parse_domains_md(read_doc(a.root))
        rep = {"rows": len(rows), "hosts": sum(len(r["hosts"]) for r in rows), "plane_violation": check_planes(rows)}
        print(render(a.action, rep, []))
        print("RESULT_JSON=" + json.dumps({"action": a.action, **rep}, sort_keys=True))
        return 1 if rep["plane_violation"] or not rows else 0
    errors: list = []
    if a.input:
        data = json.load(open(a.input, encoding="utf-8"))
    elif a.live:
        token, acct = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip(), os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
        if not token or not acct:
            print("::error::CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required for --live")
            return 2
        fetch = {"worker-inventory": lambda: fetch_workers(acct, token, a.root), "pages-inventory": lambda: fetch_pages(acct, token, a.root),
                 "dns-drift": lambda: fetch_dns(acct, token, a.root), "d1-query-report": lambda: fetch_d1(acct, token, a.root, a.db, a.hours),
                 "r2-inventory": lambda: fetch_r2(acct, token, a.root)}[a.action]
        data = fetch()
    else:
        print("::error::give --live or --input FILE")
        return 2
    errors = list(data.get("errors") or [])
    if a.dump:
        json.dump(data, open(a.dump, "w", encoding="utf-8"))
    baseline = json.load(open(a.baseline, encoding="utf-8")) if a.baseline else None
    rep = {"worker-inventory": run_workers, "pages-inventory": run_pages, "dns-drift": run_dns,
           "d1-query-report": lambda d, r: run_d1(d, r, baseline), "r2-inventory": run_r2}[a.action](data, a.root)
    md = render(a.action, rep, errors)
    print(md)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(md + "\n")
    key = {"worker-inventory": "workers", "pages-inventory": "pages", "dns-drift": "dns", "d1-query-report": "d1", "r2-inventory": "r2"}[a.action]
    slim = {k: v for k, v in rep.items() if k != "rows"} if a.action in ("worker-inventory",) else rep
    print("RESULT_JSON=" + json.dumps({"action": a.action, "errors": errors, key: slim}, sort_keys=True, default=str)[:60000])
    if errors and not any(e.startswith(("d1QueriesAdaptiveGroups", "r2OperationsAdaptiveGroups")) for e in errors):
        return 3
    return 1 if a.strict and a.action == "dns-drift" and rep["hard"] else 0


if __name__ == "__main__":
    sys.exit(main())
