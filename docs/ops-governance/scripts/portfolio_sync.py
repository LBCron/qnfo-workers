"""portfolio_sync.py — Regenerate PORTFOLIO-STATUS.md from Cloudflare canonical sources.

QNFO.GOV.001 — Public Transparency Dashboard. Replaces the legacy G:\\ My Drive
portfolio_status.py (local-only, non-public). This script reads CANONICAL state:

  * D1 living-paper (papers table)          -> paper counts, status dist, recent activity
  * KG graph-api.qnfo.org                   -> node/edge stats, program/project/task counts
  * GitHub API (QNFO org)                   -> public repo count
  * WBS.TAXONOMY.md (QNFO/qnfo-ops)         -> program registry table
  * Zenodo public API                       -> community/search record counts

Writes a markdown file (default PORTFOLIO-STATUS.md in CWD) ready to commit to
QNFO/.github. Run:  python portfolio_sync.py [out_path]

Idempotent, read-only on canonical stores. Tokens: gh CLI authenticated;
Cloudflare token at C:\\Users\\LENOVO\\tokens\\cloudflare (optional — D1 is
read via the same file; KG reads via public endpoint).
"""
import json, os, re, subprocess, sys, urllib.request, urllib.error
from datetime import datetime, timezone

CF_TOKEN_PATH = r"C:\Users\LENOVO\tokens\cloudflare"
D1_ACCT = "edb167b78c9fb901ea5bca3ce58ccc4b"
D1_DB = "70a58cb3-b2cd-498d-877f-ecca86859a22"  # living-paper
GRAPH_API = "https://graph-api.qnfo.org/query"
WBS_RAW = "https://raw.githubusercontent.com/QNFO/qnfo-ops/main/WBS/WBS.TAXONOMY.md"


def http_raw(url, method="GET", body=None, headers=None, timeout=60):
    req = urllib.request.Request(url, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers=headers or {"User-Agent": "portfolio-sync"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:500]
    except Exception as e:
        return None, str(e)


def http_json(url, method="GET", body=None, headers=None, timeout=60):
    code, txt = http_raw(url, method=method, body=body, headers=headers, timeout=timeout)
    if code == 200:
        try:
            return code, json.loads(txt)
        except Exception:
            return code, None
    return code, None


def d1(sql):
    token = None
    if os.path.exists(CF_TOKEN_PATH):
        with open(CF_TOKEN_PATH) as f:
            token = f.read().strip()
    code, data = http_json(
        "https://api.cloudflare.com/client/v4/accounts/%s/d1/database/%s/query" % (D1_ACCT, D1_DB),
        method="POST", body={"sql": sql},
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"} if token else {})
    if code == 200 and data and data.get("result"):
        return data["result"][0]["results"]
    return None


def gh_json(args):
    r = subprocess.run(["gh", "api"] + args, capture_output=True, text=True)
    if r.returncode != 0:
        return None
    try:
        return json.loads(r.stdout)
    except Exception:
        return r.stdout


def kg_stats():
    """Query KG via graph-api public read endpoint.

    Response shape (verified 2026-08-14):
    {"success": true, "meta": {...}, "results": [{"label": "Paper", "c": 1621}, ...]}
    """
    code, data = http_json(GRAPH_API, method="POST", body={"query": "SELECT label, COUNT(*) AS c FROM nodes GROUP BY label"})
    if code != 200 or not data:
        return {}
    rows = data.get("results") or []
    labels = {r.get("label"): r.get("c") for r in rows}
    edges = None
    ecode, edata = http_json(GRAPH_API, method="POST",
                             body={"query": "SELECT COUNT(*) AS c FROM edges"})
    if ecode == 200 and edata and edata.get("results"):
        edges = edata["results"][0].get("c")
    return {
        "totalNodes": sum(labels.values()),
        "totalEdges": edges,
        "nodeLabels": [{"label": k, "count": v} for k, v in labels.items()],
    }


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else "PORTFOLIO-STATUS.md"
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    # --- D1 living-paper ---
    total = d1("SELECT COUNT(*) AS c FROM papers") or []
    total_n = total[0]["c"] if total else None
    status_dist = d1("SELECT status, COUNT(*) AS c FROM papers GROUP BY status ORDER BY c DESC") or []
    recent = d1("SELECT slug, title, updated_at FROM papers ORDER BY updated_at DESC LIMIT 12") or []

    # --- KG ---
    kg = kg_stats() or {}
    kg_total_nodes = kg.get("totalNodes")
    kg_total_edges = kg.get("totalEdges")
    kg_labels = {x["label"]: x["count"] for x in kg.get("nodeLabels", [])} if kg.get("nodeLabels") else {}
    kg_programs = kg_labels.get("Program", "?")
    kg_projects = kg_labels.get("Project", "?")
    kg_tasks = kg_labels.get("Task", "?")
    kg_papers = kg_labels.get("Paper", "?")

    # --- GitHub org ---
    gh = gh_json(["orgs/QNFO", "--jq", "{public_repos: .public_repos, name: .name}"]) or {}

    # --- WBS taxonomy (program registry) ---
    wbs_md = ""
    code, txt = http_raw(WBS_RAW)
    if code == 200:
        wbs_md = txt
    prog_rows = re.findall(r"### Program: (QNFO\.\w+|QWAV\.\w+) — ([^\n]+)", wbs_md)
    prog_codes = re.findall(r"\|\s*`(QNFO\.\w+|QWAV\.\w+)`\s*\|\s*program\s*\|([^|]+)\|", wbs_md)
    wbs_last_updated = re.search(r"\*\*Last Updated:\*\*\s*([0-9-]+)", wbs_md)

    # --- Zenodo ---
    _, zen_comm = http_json("https://zenodo.org/api/records/?communities=qwav&size=1")
    _, zen_search = http_json("https://zenodo.org/api/records/?q=QNFO&size=1")
    zen_comm_n = zen_comm["hits"]["total"] if zen_comm else None
    zen_search_n = zen_search["hits"]["total"] if zen_search else None

    # --- Build markdown ---
    lines = []
    lines.append("# QNFO / QWAV — Portfolio Status (Public Transparency Ledger)")
    lines.append("")
    lines.append("> **Generated:** %s  " % now)
    lines.append("> **Source of truth:** Cloudflare canonical (D1 living-paper, Knowledge Graph, R2). "
                 "This file is the public mirror — GitHub is the activity ledger; Cloudflare remains canonical.")
    lines.append("> **Board:** [QNFO Public Program Board](https://github.com/orgs/QNFO/projects/7) · "
                 "[Org profile](https://github.com/QNFO) · [Board view](https://github.com/orgs/QNFO/projects/7/views/1)")
    lines.append("")
    lines.append("## 1. Portfolio at a Glance")
    lines.append("")
    lines.append("| Metric | Value | Source |")
    lines.append("|:-------|------:|:-------|")
    lines.append("| Papers in D1 living-paper | %s | D1 |" % total_n)
    for row in status_dist:
        lines.append("| &nbsp;&nbsp;— %s | %s | D1 |" % (row["status"], row["c"]))
    lines.append("| KG nodes | %s | KG |" % kg_total_nodes)
    lines.append("| KG edges | %s | KG |" % kg_total_edges)
    lines.append("| KG programs | %s | KG |" % kg_programs)
    lines.append("| KG projects | %s | KG |" % kg_projects)
    lines.append("| KG tasks | %s | KG |" % kg_tasks)
    lines.append("| KG papers | %s | KG |" % kg_papers)
    lines.append("| Public repos (QNFO org) | %s | GitHub |" % gh.get("public_repos"))
    lines.append("| Zenodo — qwav community | %s | Zenodo API |" % zen_comm_n)
    lines.append("| Zenodo — QNFO search | %s | Zenodo API |" % zen_search_n)
    lines.append("| WBS registry last updated | %s | qnfo-ops WBS.TAXONOMY.md |" % (wbs_last_updated.group(1) if wbs_last_updated else "?"))
    lines.append("")
    lines.append("## 2. Program Registry (from WBS.TAXONOMY.md §3)")
    lines.append("")
    lines.append("| WBS | Program | GitHub | Status |")
    lines.append("|:----|:--------|:-------|:-------|")
    for code, name in prog_rows:
        lines.append("| `%s` | %s | [QNFO org](https://github.com/QNFO) | active |" % (code, name))
    lines.append("")
    lines.append("## 3. Recent Activity (D1 living-paper, last 12 updates)")
    lines.append("")
    lines.append("| Slug | Title | Updated |")
    lines.append("|:-----|:------|:--------|")
    for row in recent:
        title = (row.get("title") or "").replace("|", "\\|")[:80]
        lines.append("| `%s` | %s | %s |" % (row.get("slug"), title, (row.get("updated_at") or "")[:10]))
    lines.append("")
    lines.append("## 4. Funding & Grant Posture")
    lines.append("")
    lines.append("- QNFO is the primary research initiative of **Empowering Change**, a U.S.-registered 501(c)(3) non-profit.")
    lines.append("- Currently **self-funded**. Grant applications and funding requests, when filed, are recorded on the "
                 "[Public Program Board](https://github.com/orgs/QNFO/projects/7) — no entry is fabricated; "
                 "an entry appears only after a real submission exists.")
    lines.append("- Canonical infrastructure: Cloudflare (D1, R2, Workers, Pages, AI Gateway). "
                 "GitHub is the public mirror/ledger.")
    lines.append("")
    lines.append("## 5. Regeneration")
    lines.append("")
    lines.append("Regenerated weekly by scheduled task **QNFO Portfolio Public Sync (Weekly)** via "
                 "`QNFO/qnfo-ops/scripts/portfolio_sync.py`. Manual: `python portfolio_sync.py PORTFOLIO-STATUS.md`, "
                 "then commit to QNFO/.github via branch → PR → merge.")
    lines.append("")
    lines.append("---")
    lines.append("*Everything open. Everything accountable. Everything for the collective benefit of all.*")

    md = "\n".join(lines) + "\n"
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(md)
    print("WROTE %s (%d chars)" % (out_path, len(md)))
    print("D1 total=%s, KG nodes=%s, repos=%s, zenodo comm=%s/%s" % (
        total_n, kg_total_nodes, gh.get("public_repos"), zen_comm_n, zen_search_n))


if __name__ == "__main__":
    main()
