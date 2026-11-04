#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
mcp-auth-guard.py v1.1 — MCP transport + credential guard for the Cloudflare MCP servers.

WHY: remote Cloudflare MCP servers connect via `mcp-remote`. OAuth token caches under
~/.mcp-auth get wiped or expire (canonical: cloudflare-graphql "Couldn't connect"
2026-08-20; cloudflare-observability/radar removed 2026-08-17 for "no cached OAuth
tokens"). Root fix: the Cloudflare servers carry a long-lived API token through
`--header "Authorization: Bearer <token>"` — no OAuth dependency.

WHAT v1.1 CHANGES (2026-10-25, MCP-AUTH-GUARD-LIVE-TARGETS-1):
  1. TARGETS ARE DISCOVERED, not hardcoded. v1.0 named six servers
     (cloudflare-bindings/builds/ai-gateway/graphql/auditlogs); five of them no longer
     exist in either store, so the guard reported PASS while checking one live server.
     It now discovers every server whose args point at mcp.cloudflare.com/mcp.
  2. ENABLED-WITHOUT-TRANSPORT IS A FAILURE (MISSING_TRANSPORT). The file store carries
     only `enabled` + `autoApprove` for the wrapped servers; the transport lives in
     agent.db. A server enabled in the file with no executable transport in the DB used
     to be a silent skip; it is now reported.
  3. --check-only EXITS 1 on any FAIL/ERR (FAIL-CLOSED-ANCHOR-1). v1.0 always exited 0,
     so nothing could gate on it. Default (heal) mode still exits 0.
  4. DOC-CODE-PARITY-1: v1.0 claimed "Wired into the cf_audit_hook SessionStart event".
     That hook does not exist in the live app-settings.json (hooks.hooks == []). The
     guard actually runs from qnfo_daily_maintenance.cmd [1b] and by hand.
  5. STRAY DB: a 0-byte %APPDATA%/DeepChat/agent.db is detected and removed; the real
     store is app_db/agent.db, and a decoy at the parent path makes a wrong-path reader
     see an empty MCP table.

Stores:
  1. %APPDATA%/DeepChat/mcp-settings.json -> mcpServers.<name>.args
  2. %APPDATA%/DeepChat/app_db/agent.db    -> mcp_servers.config_json

Token source: %USERPROFILE%/tokens/cloudflare  (cfat_...)

Stdlib only. Fast (<1s). Heal mode always exits 0 (never disrupts the app);
--check-only exits 1 when the config is not conformant.
Usage: python mcp-auth-guard.py [--check-only]
"""
import json
import os
import sqlite3
import sys
import time
from urllib.parse import urlparse

APP = os.path.join(os.environ.get("APPDATA", ""), "DeepChat")
TOKEN_FILE = os.path.join(os.environ.get("USERPROFILE", ""), "tokens", "cloudflare")
MCP_SETTINGS = os.path.join(APP, "mcp-settings.json")
AGENT_DB = os.path.join(APP, "app_db", "agent.db")
STRAY_DB = os.path.join(APP, "agent.db")
CF_HOST = "mcp.cloudflare.com"  # exact host; docs.mcp.cloudflare.com is public and must NOT match


def get_token():
    try:
        with open(TOKEN_FILE, "r", encoding="utf-8") as f:
            tok = f.read().strip()
        return tok if tok.startswith("cfat_") else None
    except OSError:
        return None


def header_args(url, token):
    return ["-y", "mcp-remote", "--header", "Authorization: Bearer " + token, url]


def is_cf_url(u):
    """Exact-host match. A suffix match also catches docs.mcp.cloudflare.com (public, no
    auth) and would push a Bearer header into a server that must not receive one
    (MCP-AUTH-GUARD-EXACT-HOST-1, 2026-10-25)."""
    if not isinstance(u, str):
        return False
    try:
        return urlparse(u).hostname == CF_HOST
    except Exception:
        return False


def is_cf_args(args):
    return isinstance(args, list) and any(is_cf_url(u) for u in args)


def discover_targets(servers_json, db_rows):
    """Every server that actually points at a Cloudflare MCP endpoint, from either store."""
    names = set()
    for name, s in (servers_json or {}).items():
        if is_cf_args(s.get("args")):
            names.add(name)
    for name, cfg in (db_rows or []):
        if is_cf_args((cfg or {}).get("args")):
            names.add(name)
    return sorted(names)


def check_args(args, token):
    return (
        isinstance(args, list)
        and len(args) >= 5
        and "--header" in args
        and any(token in u for u in args if isinstance(u, str))
        and any(is_cf_url(u) for u in args)
    )


def load_json_settings():
    if not os.path.exists(MCP_SETTINGS):
        return None
    with open(MCP_SETTINGS, "r", encoding="utf-8") as f:
        return json.load(f)


def guard_json_settings(token, targets, check_only=False):
    """Store 1: %APPDATA%/DeepChat/mcp-settings.json"""
    data = load_json_settings()
    if data is None:
        return "skip(missing)"
    servers = data.get("mcpServers", {})
    repaired = []
    for name in targets:
        s = servers.get(name)
        if not s:
            continue
        args = s.get("args") or []
        url = next((u for u in args if is_cf_url(u)), None)
        if url and not check_args(args, token):
            if check_only:
                return "FAIL(" + name + ")"
            s["args"] = header_args(url, token)
            repaired.append(name)
    if repaired:
        bak = MCP_SETTINGS + ".bak-mcp-guard-" + time.strftime("%Y%m%d-%H%M%S")
        try:
            os.replace(MCP_SETTINGS, bak)
        except OSError:
            pass
        with open(MCP_SETTINGS, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent="\t")
        return "REPAIRED:" + ",".join(repaired)
    return "PASS"


def guard_agent_db(token, targets, check_only=False):
    """Store 2: %APPDATA%/DeepChat/app_db/agent.db -> mcp_servers.config_json"""
    if not os.path.exists(AGENT_DB):
        return "skip(missing)"
    repaired = []
    try:
        con = sqlite3.connect(AGENT_DB, timeout=5)
        con.execute("PRAGMA busy_timeout=5000")
        rows = list(con.execute("SELECT name, config_json FROM mcp_servers"))
        for name, val in rows:
            if name not in targets:
                continue
            cfg = json.loads(val)
            args = cfg.get("args") or []
            url = next((u for u in args if is_cf_url(u)), None)
            if url and not check_args(args, token):
                if check_only:
                    con.close()
                    return "FAIL(" + name + ")"
                cfg["args"] = header_args(url, token)
                cfg["configGeneration"] = cfg.get("configGeneration", 1) + 1
                con.execute(
                    "UPDATE mcp_servers SET config_json=?, updated_at=? WHERE name=?",
                    (json.dumps(cfg, ensure_ascii=False), int(time.time() * 1000), name),
                )
                repaired.append(name)
        con.commit()
        con.close()
    except Exception as e:  # never raise out of the hook
        return "ERR:" + str(e)[:80]
    return "REPAIRED:" + ",".join(repaired) if repaired else "PASS"


def guard_transport_complete(check_only=False):
    """An ENABLED server must have an executable transport in the DB.

    The file carries only enabled/autoApprove for wrapped servers; the transport (args or
    baseUrl) lives in mcp_servers.config_json. Enabled-without-transport is unconnectable.
    """
    data = load_json_settings()
    if data is None or not os.path.exists(AGENT_DB):
        return "skip(missing)"
    enabled = [n for n, s in (data.get("mcpServers") or {}).items() if s.get("enabled")]
    try:
        con = sqlite3.connect("file:" + AGENT_DB.replace("\\", "/") + "?mode=ro", uri=True)
        rows = {n: json.loads(c) for n, c in con.execute("SELECT name, config_json FROM mcp_servers")}
        con.close()
    except Exception as e:
        return "ERR:" + str(e)[:80]
    missing = []
    for n in enabled:
        cfg = rows.get(n) or {}
        if cfg.get("type") == "inmemory":
            continue
        if not (cfg.get("baseUrl") or cfg.get("args")):
            missing.append(n)
    if missing:
        return ("MISSING_TRANSPORT:" + ",".join(missing)) if not check_only else "FAIL(transport:" + ",".join(missing) + ")"
    return "PASS"


def guard_stray_db(check_only=False):
    """A 0-byte <APP>/agent.db is a decoy: the live store is app_db/agent.db."""
    if not os.path.exists(STRAY_DB):
        return "PASS"
    try:
        if os.path.getsize(STRAY_DB) > 0:
            return "SKIP(nonempty %d B)" % os.path.getsize(STRAY_DB)
        if check_only:
            return "FAIL(stray-db)"
        dst = os.path.join(APP, "backups", "stray-agent.db-%d" % int(time.time()))
        os.replace(STRAY_DB, dst)
        return "REMOVED(stray-db)"
    except OSError as e:
        return "ERR:" + str(e)[:80]


def main():
    check_only = "--check-only" in sys.argv
    token = get_token()
    if not token:
        print("[mcp-auth-guard] FAIL token-missing (%s)" % TOKEN_FILE)
        sys.exit(1 if check_only else 0)
    data = load_json_settings() or {}
    servers = data.get("mcpServers") or {}
    db_rows = []
    if os.path.exists(AGENT_DB):
        try:
            con = sqlite3.connect("file:" + AGENT_DB.replace("\\", "/") + "?mode=ro", uri=True)
            db_rows = [(n, json.loads(c)) for n, c in con.execute("SELECT name, config_json FROM mcp_servers")]
            con.close()
        except Exception:
            db_rows = []
    targets = discover_targets(servers, db_rows)
    out = {}
    out["targets"] = len(targets)
    out["json"] = guard_json_settings(token, targets, check_only)
    out["db"] = guard_agent_db(token, targets, check_only)
    out["transport"] = guard_transport_complete(check_only)
    out["stray"] = guard_stray_db(check_only)
    bad = [k for k, v in out.items() if isinstance(v, str) and (v.startswith("FAIL") or v.startswith("ERR") or v.startswith("MISSING_TRANSPORT"))]
    print("[mcp-auth-guard] " + " ".join("%s=%s" % (k, v) for k, v in out.items()) + " token=ok")
    sys.exit(1 if (check_only and bad) else 0)


if __name__ == "__main__":
    main()
