#!/usr/bin/env python
"""local-config-selfheal.py  (LOCAL-CONFIG-SELFHEAL-1, 2026-09-30)

Idempotent self-heal for the DeepChat client config stores. Runs inside the
30-minute QNFO-ModelKey-Guard cycle (invoked from model_guard.cmd), so any drift
that the guards only *detect* is *corrected* automatically -- no human action.

Targets (all re-asserted only when they differ; atomic write; never raises):
  1) Roaming app-settings.json
     - default_system_prompt == canonical .deepchat/system-prompt-v2.7.md
     - agentCommandShell.preference == "git-bash"   (scheduler-guard)
     - enableSkills == False                          (NO-LOCAL-SKILLS-1)
     - providers[] contains a QNFO-OPS entry with ops caps (ops-settings-guard)
  2) Roaming mcp-settings.json                       (MCP-FILE-EMPTY)
     - mcpEnabled == True
     - the 6 canonical servers enabled + autoApprove sets restored
  3) agent.db model_status                           (MODEL-STATUS-CONVERGE-1)
     - exactly ONE enabled id per QNFO endpoint (ops / qnfo / personal)
"""
import json, os, sqlite3, sys, tempfile, datetime

HOME = os.path.expanduser("~")
APP = os.path.join(os.environ.get("APPDATA", os.path.join(HOME, "AppData", "Roaming")), "DeepChat")
DB = os.path.join(APP, "app_db", "agent.db")
JS = os.path.join(APP, "app-settings.json")
MCP = os.path.join(APP, "mcp-settings.json")
CANON = os.path.join(HOME, ".deepchat", "system-prompt-v2.7.md")

OPS_MODEL = {"id": "ops", "maxOutput": 393216, "contextWindow": 1048576,
             "maxTokens": 393216, "contextLength": 1048576}

# canonical MCP servers: name -> autoApprove list (MCP-AUTOAPPROVE-PARITY-1)
# MCP-EXPLICIT-APPROVALS-1 (2026-09-30): explicit auto-approve allow-list, never ["all"]
# (user intent 2026-09-30: "explicit tool approvals instead of all"); `remember_fact` is a
# WRITE and MUST require approval (qnfo-memory-mcp has no auth) -> removed from the allow-list.
MCP_CANON = {
    "deepchat-inmemory/auto-prompting-server": ["list_all_prompt_template_names",
                                                "get_prompt_template_parameters",
                                                "fill_prompt_template"],
    "deepchat-inmemory/conversation-search-server": ["search_conversations", "search_messages",
                                                    "get_conversation_history",
                                                    "get_conversation_stats"],
    "cloudflare": ["search", "docs", "workers_list", "workers_get_worker",
                   "workers_get_worker_code", "kv_namespaces_list", "kv_namespace_get",
                   "d1_databases_list", "d1_database_get", "r2_buckets_list", "r2_bucket_get",
                   "hyperdrive_configs_list", "hyperdrive_config_get",
                   "cloudflare-docs_search_cloudflare_documentation"],
    "cloudflare-docs": ["search_cloudflare_documentation", "migrate_pages_to_workers_guide"],
    "qnfo-memory-mcp": ["search_papers", "search_papers_enriched", "resolve_paper_id",
                        "search_memories", "recall_facts", "query_graph",
                        "get_paper_context"],
    "qnfo-tools-mcp": ["web_search", "web_fetch", "papers_search", "history_recall",
                       "personal_search"],
}

STATUS_WHITELIST = {"QNFO-OPS": "ops", "QNFO-ROUTER": "qnfo", "PERSONAL-TWIN": "personal"}

changed = []


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def jload(p):
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


def atomic_json(p, d):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(p), prefix=".selfheal-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(d, f, indent=2, ensure_ascii=False)
    os.replace(tmp, p)


def heal_app_settings():
    if not os.path.exists(JS):
        return
    canon = open(CANON, "rb").read().decode("utf-8")
    d = jload(JS)
    dirty = False
    if (d.get("default_system_prompt") or "") != canon:
        d["default_system_prompt"] = canon
        changed.append("dsp"); dirty = True
    acs = d.get("agentCommandShell") or {}
    if acs.get("preference") != "git-bash":
        acs["preference"] = "git-bash"
        d["agentCommandShell"] = acs
        changed.append("shell"); dirty = True
    if d.get("enableSkills") is not False:
        d["enableSkills"] = False
        changed.append("enableSkills"); dirty = True
    provs = d.get("providers")
    if isinstance(provs, list):
        have = [p for p in provs if (p.get("id") or "") == "QNFO-OPS"]
        if not have:
            provs.append({"id": "QNFO-OPS", "name": "QNFO Ops", "apiType": "openai",
                          "baseUrl": "https://ops.qnfo.org/v1", "enabled": True,
                          "models": [dict(OPS_MODEL)]})
            changed.append("ops-provider"); dirty = True
        else:
            pr = have[0]
            ms = pr.get("models") or []
            hit = [m for m in ms if isinstance(m, dict) and (m.get("id") or m.get("modelId")) == "ops"]
            if not hit:
                ms.append(dict(OPS_MODEL)); pr["models"] = ms
                changed.append("ops-model"); dirty = True
    elif provs is None:
        d["providers"] = []
    if dirty:
        atomic_json(JS, d)


def heal_app_db():
    """agent.db app_settings defaultModel/preferredModel must be QNFO-OPS/ops -- the app
    reverts these to the last-used provider (seen: deepseek). MODELKEY-CONVERGE-1."""
    if not os.path.exists(DB):
        return
    want = json.dumps({"providerId": "QNFO-OPS", "modelId": "ops"})
    try:
        con = sqlite3.connect(DB, timeout=10)
        cur = con.cursor()
        for k in ("defaultModel", "preferredModel"):
            row = cur.execute("SELECT value_json FROM app_settings WHERE key=?", (k,)).fetchone()
            if row is None or row[0] != want:
                cur.execute("UPDATE app_settings SET value_json=?, updated_at=? WHERE key=?",
                            (want, now(), k))
                changed.append("db:" + k)
        con.commit()
        con.close()
    except Exception as e:
        print(json.dumps({"ts": now(), "appdb_error": str(e)[:120]}))


def heal_mcp():
    if not os.path.exists(MCP):
        return
    d = jload(MCP)
    dirty = False
    if d.get("mcpEnabled") is not True:
        d["mcpEnabled"] = True
        changed.append("mcpEnabled"); dirty = True
    srv = d.get("mcpServers") or {}
    for name, aa in MCP_CANON.items():
        s = srv.get(name)
        if not isinstance(s, dict):
            srv[name] = {"enabled": True, "autoApprove": list(aa)}
            changed.append("mcp+" + name); dirty = True
            continue
        if s.get("enabled") is not True:
            s["enabled"] = True
            changed.append("mcp-en+" + name); dirty = True
        if not s.get("autoApprove"):
            s["autoApprove"] = list(aa)
            changed.append("mcp-aa+" + name); dirty = True
    if dirty:
        d["mcpServers"] = srv
        atomic_json(MCP, d)


def heal_model_status():
    if not os.path.exists(DB):
        return
    try:
        con = sqlite3.connect(DB, timeout=10)
        cur = con.cursor()
        for prov, keep in STATUS_WHITELIST.items():
            for (sk, mid, en) in cur.execute(
                    "SELECT status_key, model_id, enabled FROM model_status WHERE provider_id=?", (prov,)).fetchall():
                want = 1 if mid == keep else 0
                if int(en or 0) != want:
                    cur.execute("UPDATE model_status SET enabled=?, updated_at=? WHERE status_key=?",
                                (want, now(), sk))
                    changed.append("mstatus:%s/%s=%d" % (prov, mid, want))
        con.commit()
        con.close()
    except Exception as e:
        print(json.dumps({"ts": now(), "mstatus_error": str(e)[:120]}))


RESIDUE_DIRS = [
    os.path.join(HOME, ".deepchat", "scripts"),
    os.path.join(HOME, ".deepchat", "skills", "prompt-stores"),
]


def purge_residue():
    """NO-RESIDUE-1: keep the graveyards gone -- __pycache__ + stray *.bak-* under
    the guard dirs. Bounded to those two dirs; never touches backups/."""
    import glob, shutil
    for base in RESIDUE_DIRS:
        for cache in glob.glob(os.path.join(base, "**", "__pycache__"), recursive=True):
            shutil.rmtree(cache, ignore_errors=True)
            changed.append("rm-cache:" + os.path.relpath(cache, HOME))
        for bak in glob.glob(os.path.join(base, "*.bak-*")):
            try:
                os.remove(bak)
                changed.append("rm-bak:" + os.path.basename(bak))
            except OSError:
                pass


def main():
    for fn in (heal_app_settings, heal_app_db, heal_mcp, heal_model_status, purge_residue):
        try:
            fn()
        except Exception as e:
            print(json.dumps({"ts": now(), "error": fn.__name__ + ": " + str(e)[:140]}))
    print(json.dumps({"ts": now(), "selfheal": "changed" if changed else "clean", "changed": changed}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
