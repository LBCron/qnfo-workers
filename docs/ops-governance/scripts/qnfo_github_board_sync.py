#!/usr/bin/env python3
"""
QNFO GitHub Public Board Sync — canonical Cloudflare -> GitHub mirror.

CANONICAL SOURCES (read):
  1. D1 portfolio-state.program_registry (programs/projects, status, phase, repos)
  2. QNFO Knowledge Graph (graph-api.qnfo.org) — Program/Project/Task nodes
TARGET:
  GitHub Projects v2 board #7 "QNFO Public Program Board" (public) in the QNFO org.

IDEMPOTENT: skips items already on the board (keyed by WBS code extracted from
title or canonical name). Safe to re-run weekly. NEVER deletes board items;
drift is reported, not force-reconciled.

Fields on board:
  - "Program Status" (single-select): Active / Milestone Due / Maintaining / Completed / Proposed
  - "Level" (single-select): Program / Project / Task / Other
  - "WBS Program" (single-select): program codes

Usage: python qnfo_github_board_sync.py [--dry-run]
Env: CLOUDFLARE_API_TOKEN (fallback: C:\\Users\\LENOVO\\tokens\\cloudflare)
     GH_TOKEN via `gh auth token`.
"""
import json
import os
import subprocess
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone

ACCT = "edb167b78c9fb901ea5bca3ce58ccc4b"
DB = "d80fdf2a-0a60-45a3-968b-2907ce806dcd"  # portfolio-state
BOARD_NUMBER = 7
ORG = "QNFO"
DRY = "--dry-run" in sys.argv

PROGRAM_OPTIONS = ["SR", "ADL", "PBO", "QD", "UF", "CON", "CMP", "JPC", "ODR", "SLB",
                   "CGS", "RES", "UMP", "INM", "CFE", "PLT", "DEM", "GOV", "KEPLER", "ACRP"]
LEVEL_OPTIONS = ["Program", "Project", "Task", "Other"]

# Heuristic program mapping for KG projects lacking a WBS code (documented, deterministic).
KG_PROJECT_PROGRAM = {
    "29-schisms-deepdive": "SLB", "cfpe-forecast": "CFE", "counterfactual-physics": "UMP",
    "adelic-langlands-physics": "ADL", "alpha-pi-helix": "UMP", "biophoton-ultrametric-consilience": "PBO",
    "cancellation-rule-research": "SLB", "cfpe-methodology": "CFE", "cfpe-paradigm-forecast": "CFE",
    "cfpe-stages-3-5": "CFE", "consilience-physics-numtheory": "CON", "finite-precision-oc-convergence": "PBO",
    "harmonic-paradigm": "UMP", "harmonische-paradigma": "UMP", "hidden-radix-pqc": "SR",
    "huang-2025-audit": "UMP", "joules-per-compute-benchmark": "JPC", "legal-deploy": "GOV",
    "measurable-vs-imaginable": "RES", "memory-infra": "PLT", "numerata": "INM",
    "phase-0-adversarial-testing": "RES", "qnfo": "GOV", "qnfo-100yr-forecast": "CFE",
    "qnfo-photon-audit": "PBO", "qnfo-unified-plan": "UMP", "r2-gateway": "PLT",
    "s10-observer-research": "SLB", "shor-phase3": "UMP", "tate-adelic-template": "ADL",
    "workspace-debris": "GOV", "zbw-deep-dive": "ADL", "zbw-fw-null-test": "ADL", "zbw-p5-capstone": "ADL",
    "continuum-trilogy": "UMP", "qwav-decade": "PLT", "ultrametric-consilience-atlas": "UMP",
    "qnfo-unified": "UMP", "the-informational-universe": "INM", "kepler-program": "KEPLER",
    "silent-radix-convergent-synthesis": "SR", "radix-uw-bt-synthesis": "UMP", "infomatics": "INM",
}
KG_ACTIVE_STATUS = {"ACTIVE", "active", "in_progress", "RECOVERY", "phase4-deep-complete"}


def cloudflare_token():
    env = os.environ.get("CLOUDFLARE_API_TOKEN")
    if env:
        return env
    p = r"C:\Users\LENOVO\tokens\cloudflare"
    if os.path.exists(p):
        with open(p) as f:
            return f.read().strip()
    raise RuntimeError("No Cloudflare token (env or tokens/cloudflare)")


def d1_rows(sql):
    tok = cloudflare_token()
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{ACCT}/d1/database/{DB}/query",
        data=json.dumps({"sql": sql}).encode(),
        headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json", "User-Agent": "qnfo-board-sync"})
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read().decode())
    if not d.get("success"):
        raise RuntimeError("D1 query failed: %s" % json.dumps(d.get("errors"))[:300])
    return d["result"][0]["results"]


def kg_query(sql):
    req = urllib.request.Request("https://graph-api.qnfo.org/query",
                                 data=json.dumps({"query": sql}).encode(),
                                 headers={"Content-Type": "application/json", "User-Agent": "qnfo-board-sync"})
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read().decode())
    return d.get("results", [])


def gql(query, retries=2):
    for attempt in range(retries + 1):
        r = subprocess.run(["gh", "api", "graphql", "-f", "query=" + query],
                           capture_output=True, text=True)
        if r.returncode == 0:
            d = json.loads(r.stdout)
            if "errors" not in d:
                return d["data"]
            err = json.dumps(d["errors"])[:200]
            if "rate limit" in err.lower() and attempt < retries:
                import time
                time.sleep(10 * (attempt + 1))
                continue
            raise RuntimeError("GraphQL errors: " + err)
        else:
            raise RuntimeError("gh graphql failed: " + r.stderr[:200])
    raise RuntimeError("gh graphql failed after retries")


def decode_props(props):
    while isinstance(props, str):
        try:
            props = json.loads(props)
        except Exception:
            return {}
    return props or {}


def wbs_key(title):
    """Extract WBS-ish key from an existing board item title for dedupe."""
    t = title.upper()
    for code in ["QNFO.UMP", "QNFO.SLB", "QNFO.INM", "QNFO.CFE", "QNFO.RES", "QWAV.PLT",
                 "QWAV.DEM", "QNFO.SR", "QNFO.ADL", "QNFO.PBO", "QNFO.QD", "QNFO.UF",
                 "QNFO.CON", "QNFO.CMP", "QNFO.JPC", "QNFO.ODR", "QNFO.CGS", "QNFO.GOV"]:
        if code in t:
            return code
    if "KEPLER" in t:
        return "KEPLER"
    if "ACRP" in t:
        return "ACRP"
    if "GRANTS" in t and "FUNDING" in t:
        return "GRANTS"
    return None


def main():
    # ---- 1. Canonical: D1 registry ----
    reg = d1_rows("SELECT wbs_code, level, parent_wbs, name, slug, github_repo, zenodo_doi, kg_node_id, phase, status "
                  "FROM program_registry WHERE level IN ('program','project') ORDER BY wbs_order, wbs_code")
    d1_programs = [r for r in reg if r["level"] == "program"]
    d1_projects = [r for r in reg if r["level"] == "project"]
    print("[canonical] D1 programs=%d projects=%d" % (len(d1_programs), len(d1_projects)))

    # ---- 2. Canonical: KG nodes ----
    rows = kg_query("SELECT id, name, label, properties FROM nodes WHERE label IN ('Program','Project','Task')")
    kg_programs = [r for r in rows if r["label"] == "Program"]
    kg_projects = [r for r in rows if r["label"] == "Project"]
    kg_tasks = [r for r in rows if r["label"] == "Task"]
    print("[canonical] KG programs=%d projects=%d tasks=%d" % (len(kg_programs), len(kg_projects), len(kg_tasks)))

    d1_names = {r["name"].lower() for r in d1_projects}
    d1_slugs = {r["slug"] for r in d1_projects if r["slug"]}
    d1_kg_ids = {r["kg_node_id"] for r in d1_projects if r["kg_node_id"]}

    # ---- 3. Desired items ----
    items = []  # (title, body, level, wbs_program, status)

    # Programs: D1 first, then KG-only (KEPLER, ACRP)
    d1_wbs = set()
    for r in d1_programs:
        code = r["wbs_code"].split(".")[-1]
        d1_wbs.add(code)
        body = "Program. Repo: %s. D1: %s (status=%s). Synced from Cloudflare canonical (portfolio-state)." % (
            r["github_repo"] or "—", r["wbs_code"], r["status"])
        items.append(("%s — %s" % (r["wbs_code"], r["name"]), body, "Program", code, "Active"))
    for r in kg_programs:
        props = decode_props(r.get("properties"))
        code = props.get("wbs_code", "").split(".")[-1]
        name = r["name"]
        if code and code in d1_wbs:
            continue
        if code in ("PLT", "DEM") or r["id"] == "qwav":
            continue  # covered by D1 QWAV.PLT/QWAV.DEM
        key = "KEPLER" if "KEPLER" in name.upper() else ("ACRP" if "ACRP" in name.upper() else None)
        if not key:
            continue
        items.append(("%s — %s" % (key, name), "Program (KG node: %s). Synced from Cloudflare canonical (KG)." % r["id"],
                      "Program", key, "Active"))

    # Projects: D1 projects
    for r in d1_projects:
        code = r["wbs_code"]
        prog = code.split(".")[-2] if "." in code else "RES"
        status = "Completed" if r["status"] in ("complete", "published") else "Active"
        body = "Project %s. Repo: %s. DOI: %s. Phase: %s. Synced from Cloudflare canonical (portfolio-state)." % (
            code, r["github_repo"] or "—", r["zenodo_doi"] or "—", r["phase"] or "—")
        items.append(("%s — %s" % (code, r["name"]), body, "Project", prog, status))

    # Projects: KG active, not already covered by D1
    for r in kg_projects:
        props = decode_props(r.get("properties"))
        name = (r["name"] or "").strip()
        low = name.lower()
        st = (props.get("status") or "").upper()
        is_active = st in KG_ACTIVE_STATUS
        has_prefix = r["id"].startswith("proj-") or r["id"].startswith("project:")
        if not has_prefix and not is_active:
            continue  # legacy plain-id DRAFT/ARCHIVED/paper nodes
        if st in ("ARCHIVED", "DRAFT"):
            continue
        if low in d1_names or props.get("slug") in d1_slugs or r["id"] in d1_kg_ids:
            continue  # covered by D1 project
        if low in ("resume", "solo"):
            continue  # personal / non-QNFO
        slug = props.get("slug") or low.replace(" ", "-")
        prog = KG_PROJECT_PROGRAM.get(low, KG_PROJECT_PROGRAM.get(slug, ""))
        status = "Completed" if st in ("PUBLISHED", "published", "complete") else "Active"
        body = "Project (KG node: %s, status=%s). Synced from Cloudflare canonical (KG)." % (r["id"], st or "—")
        items.append((name, body, "Project", prog or "RES", status))

    # Tasks: KG Task nodes (KEPLER master plan)
    for r in kg_tasks:
        props = decode_props(r.get("properties"))
        st = (props.get("status") or "").upper()
        status = "Completed" if st == "COMPLETED" else None
        body = "Task (KG node: %s). Synced from Cloudflare canonical (KG KEPLER master plan)." % r["id"]
        items.append((r["name"], body, "Task", "KEPLER", status))

    print("[plan] desired items: %d" % len(items))

    # ---- 4. GitHub board state ----
    d = gql('query { organization(login: "%s") { projectsV2(first: 20) { nodes { number id public } } } }' % ORG)
    board = next((n for n in d["organization"]["projectsV2"]["nodes"] if n["number"] == BOARD_NUMBER), None)
    if not board:
        raise RuntimeError("Board #%d not found" % BOARD_NUMBER)
    pid = board["id"]

    d = gql('query { node(id: "%s") { ... on ProjectV2 { fields(first: 30) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } } } } } }' % pid)
    fields = d["node"]["fields"]["nodes"]
    existing = {}
    cursor = None
    while True:
        after = ', after: "%s"' % cursor if cursor else ""
        d = gql('query { node(id: "%s") { ... on ProjectV2 { items(first: 100%s) { nodes { id content { ... on DraftIssue { id title } } } pageInfo { hasNextPage endCursor } } } } }' % (pid, after))
        page = d["node"]["items"]
        for it in page["nodes"]:
            if it.get("content"):
                existing[it["content"]["title"]] = it
        if not page["pageInfo"]["hasNextPage"]:
            break
        cursor = page["pageInfo"]["endCursor"]
        if not cursor:
            raise RuntimeError("Board items pagination stalled: hasNextPage without endCursor")
    print("[board] existing items: %d" % len(existing))

    def find_field(name):
        return next((f for f in fields if f.get("name") == name), None)

    def option_map(field):
        return {o["name"]: o["id"] for o in field.get("options", [])} if field else {}

    if DRY:
        covered = {wbs_key(t) for t in existing}
        for title, _, level, prog, status in items:
            print("  [dry] %-12s %-7s %s%s" % (level, prog or "-", title[:70], "  (covered)" if prog and prog in covered else ""))
        print("DRY RUN — no writes")
        return

    # ---- 5. Fields (create if missing) ----
    level_field = find_field("Level")
    if not level_field:
        d = gql('mutation { createProjectV2Field(input: {projectId: "%s", dataType: SINGLE_SELECT, name: "Level", singleSelectOptions: [%s]}) { projectV2Field { ... on ProjectV2SingleSelectField { id name options { id name } } } } }'
                % (pid, ",".join('{name: "%s", description: "%s", color: GRAY}' % (o, o + " items on the public ledger") for o in LEVEL_OPTIONS)))
        level_field = d["createProjectV2Field"]["projectV2Field"]
        print("[fields] created Level")
    wbs_field = find_field("WBS Program")
    if not wbs_field:
        d = gql('mutation { createProjectV2Field(input: {projectId: "%s", dataType: SINGLE_SELECT, name: "WBS Program", singleSelectOptions: [%s]}) { projectV2Field { ... on ProjectV2SingleSelectField { id name options { id name } } } } }'
                % (pid, ",".join('{name: "%s", description: "WBS program code %s", color: BLUE}' % (o, o) for o in PROGRAM_OPTIONS)))
        wbs_field = d["createProjectV2Field"]["projectV2Field"]
        print("[fields] created WBS Program")
    status_field = find_field("Program Status")
    lvl_map = option_map(level_field)
    wbs_map = option_map(wbs_field)
    st_map = option_map(status_field)

    # ---- 6. Upsert items ----
    existing_keys = {wbs_key(t) for t in existing}
    existing_titles = set(existing)
    added = skipped = 0
    for title, body, level, prog, status in items:
        if title in existing_titles:
            skipped += 1
            continue
        key = prog if level == "Program" else None
        if key and key in existing_keys:
            skipped += 1
            continue
        d = gql('mutation { addProjectV2DraftIssue(input: {projectId: "%s", title: %s, body: %s}) { projectItem { id } } }'
                % (pid, json.dumps(title), json.dumps(body)))
        item_id = d["addProjectV2DraftIssue"]["projectItem"]["id"]
        if level in lvl_map:
            gql('mutation { updateProjectV2ItemFieldValue(input: {projectId: "%s", itemId: "%s", fieldId: "%s", value: {singleSelectOptionId: "%s"}}) { projectV2Item { id } } }'
                % (pid, item_id, level_field["id"], lvl_map[level]))
        if prog and prog in wbs_map:
            gql('mutation { updateProjectV2ItemFieldValue(input: {projectId: "%s", itemId: "%s", fieldId: "%s", value: {singleSelectOptionId: "%s"}}) { projectV2Item { id } } }'
                % (pid, item_id, wbs_field["id"], wbs_map[prog]))
        if status and status in st_map:
            gql('mutation { updateProjectV2ItemFieldValue(input: {projectId: "%s", itemId: "%s", fieldId: "%s", value: {singleSelectOptionId: "%s"}}) { projectV2Item { id } } }'
                % (pid, item_id, status_field["id"], st_map[status]))
        added += 1
        if added % 10 == 0:
            print("  added %d ..." % added)

    print("[sync] added=%d skipped=%d (existing=%d)" % (added, skipped, len(existing)))

    # ---- 7. Verify (Anti-Phantom) ----
    d = gql('query { node(id: "%s") { ... on ProjectV2 { items(first: 100) { totalCount } } } }' % pid)
    print("[verify] board total items: %d" % d["node"]["items"]["totalCount"])
    print("[done] %s" % datetime.now(timezone.utc).isoformat())


if __name__ == "__main__":
    main()
