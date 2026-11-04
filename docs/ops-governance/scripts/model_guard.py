#!/usr/bin/env python3
"""model_guard.py v3.2 (2026-11-01) - OPS-SETTINGS-IMMUTABLE-1 permanent drift guard (2026-09-09).
HARDEN-AND-MANDATE (user directive 2026-09-09, applied systemwide): the canonical ops-exec
settings below are IMMUTABLE - no agent, session, or process may change them:
  model key        : QNFO-OPS / ops (the endpoint's single advertised model id) in ALL four DeepChat keys (DB + JSON)
  context window   : 1048576 (1M)   [DeepSeek source-truth ceiling]
  max output       : 393216 (384K)  [live probe valid range [1,393216]; 384000 accepted,
                                     500000 -> 400 invalid_request_error; MAX-OUT-393K-1]
  timeout (client) : 3600000 (1h)   [DeepChat model_configs]
  tool-loop        : 300s soft      [worker OPS_LOOP_DEADLINE_MS = cpu ceiling]
  workflow step    : 15 min         [Cloudflare Workflows max]
Covers DeepChat (agent.db model_configs + app_settings + app-settings.json), ChatBox
(xyz.chatboxapp.app/config.json qnfo-ops provider), and ANY future ops-endpoint client
(auto-discovered under %APPDATA% that references qnfo-ops.q08.workers.dev - SANNABOT is not
present as of 2026-09-09; when it appears, this guard adopts it automatically).

Canonical: QNFO/qnfo-ops/scripts/model_guard.py (mirror C:/Users/LENOVO/.deepchat/scripts).
Trigger: Windows Task Scheduler 'QNFO-ModelKey-Guard' every 30 min.
Client-prompt guards: CHATBOX-PROMPT-GUARD-1 (settings.defaultPrompt) + CLAUDE-PROMPT-GUARD-1
(~/.claude/CLAUDE.md) restore each client's system prompt from its canonical; SHARED-DOCTRINE-PARITY-1
asserts 5 cross-client doctrine concepts across the DeepChat/ChatBox/Claude canonicals.
F2: existing Claude Code user settings on Cloudflare's default gateway are pinned
to Sonnet; Opus aliases must not be restored without explicit owner approval.
Recurrence-ZERO-1 guard for MODEL-KEY-FILE-DRIFT-1 + model-parameter drift.
Exit codes: 0=clean/fixed 1=check-error 2=failed-to-fix. Idempotent; silent when clean.
"""
import json, os, sqlite3, sys, tempfile, datetime, time
from urllib.parse import urlsplit

APP_DIR = os.path.expandvars(r"%APPDATA%\DeepChat")
DB = os.path.join(APP_DIR, "app_db", "agent.db")
JS = os.path.join(APP_DIR, "app-settings.json")
CHATBOX = os.path.expandvars(r"%APPDATA%\xyz.chatboxapp.app\config.json")
ROAM = os.path.expandvars(r"%APPDATA%")

DESIRED_KEY = {"providerId": "QNFO-OPS", "modelId": "ops"}  # 2026-09-26: AI-GATEWAY is NOT a registered DeepChat provider -> "Provider AI-GATEWAY not found"; canonical server-side endpoint is QNFO-OPS/ops (ONE-MODEL-PER-ENDPOINT-1). Supersedes the 2026-09-19 AI-GATEWAY picker directive.

# SESSION-DESIRED-KEY: the per-SESSION executor is QNFO-OPS/ops (DEFAULT-KEY-OPS-1, 2026-09-27).
# The retired `ops-frontier` id remains a VALID ALIAS (IMMUTABLE-SPEC-VS-ALIAS-1: ctx 400000 /
# maxOut 128000 are intentional and are NOT raised), but it is no longer what sessions or the
# default key are pinned to -- both are `ops`.
# the fleet's SERVER-SIDE agent loop and the 'deepchat' agent-config value. DESIRED_KEY above is the
# app_settings PICKER default only; every session must run on a server-side executor (SERVER-SIDE-EXEC-100-1).
SESSION_KEY = {"providerId": "QNFO-OPS", "modelId": "ops"}
# parameter canon: DeepChat config_json keys (model_configs) + JSON contextWindow/maxOutput
CANON_PARAM = {
    "ops-exec": {"maxTokens": 393216, "contextLength": 1048576, "timeout": 3600000,
                 "contextWindow": 1048576, "maxOutput": 393216},
    "deepseek-v4-flash": {"maxTokens": 393216, "contextLength": 1048576, "timeout": 3600000,
                          "contextWindow": 1048576, "maxOutput": 393216},
    "ops": {"maxTokens": 393216, "contextLength": 1048576, "timeout": 600000,
             "contextWindow": 1048576, "maxOutput": 393216},
    "ops-frontier": {"maxTokens": 128000, "contextLength": 400000, "timeout": 600000,
                     "contextWindow": 400000, "maxOutput": 128000},
    "ops-frontier-mini": {"maxTokens": 128000, "contextLength": 400000, "timeout": 600000,
                          "contextWindow": 400000, "maxOutput": 128000},
    "ops-frontier-reason": {"maxTokens": 100000, "contextLength": 200000, "timeout": 600000,
                            "contextWindow": 200000, "maxOutput": 100000},
}

# CHATBOX-OPS-MAXOUT-1 (2026-09-30): CLIENT-side cap for the ChatBox Ops provider ONLY.
# User intent 2026-09-30: Ops max output "lowered from 393,216 to 65,536 to stop runaway
# replies". The ENDPOINT canon stays 393216 (DeepChat JSON provider + worker + ops-settings-
# guard); this override applies to the ChatBox provider store (settings.providers) via the
# generic-client aligner below. Mirrored to the canonical ChatBox provider JSON.
CHATBOX_PARAM_OVERRIDE = {"ops": {"maxOutput": 65536}}


def _want_param(mid):
    w = dict(CANON_PARAM.get(mid) or {})
    w.update(CHATBOX_PARAM_OVERRIDE.get(mid, {}))
    return w or None


OPS_HOST_MARK = "qnfo-ops.q08.workers.dev"
OPS_HOST_MARK_NEW = "ops.qnfo.org"  # new bot-protection-bypass domain (2026-09-15)

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def ms():
    return int(time.time() * 1000)

def jload(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def atomic_json(path, data):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path) or ".", prefix=".mguard-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)

def atomic_json_if_unchanged(path, data, expected):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path) or ".", prefix=".mguard-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        with open(path, "rb") as f:
            if f.read() != expected:
                return False
        os.replace(tmp, path)
        return True
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)

def norm_key(v):
    return v if isinstance(v, dict) else None

# ---------------- DeepChat DB ----------------
def dc_db_drift(c):
    drift = []
    for k in ("defaultModel", "preferredModel"):
        row = c.execute("SELECT value_json FROM app_settings WHERE key=?", (k,)).fetchone()
        if row is None:
            drift.append(k + ":missing"); continue
        try:
            v = json.loads(row[0])
        except Exception:
            drift.append(k + ":unparseable"); continue
        if v != DESIRED_KEY:
            drift.append(k + ":" + json.dumps(v))
    # model_configs params for QNFO-OPS models
    rows = c.execute("SELECT cache_key, config_json FROM model_configs WHERE provider_id='QNFO-OPS'").fetchall()
    for ck, cj in rows:
        mid = ck.split("-_-")[-1] if "-_-" in ck else ""
        want = CANON_PARAM.get(mid)
        if not want:
            continue
        try:
            obj = json.loads(cj)
        except Exception:
            drift.append(ck + ":unparseable"); continue
        cfg = obj.get("config") if isinstance(obj, dict) else None
        if not isinstance(cfg, dict):
            drift.append(ck + ":no-config"); continue
        for field, val in (("maxTokens", want["maxTokens"]), ("contextLength", want["contextLength"]), ("timeout", want["timeout"])):
            if cfg.get(field) != val:
                drift.append(ck + ":" + field + "=" + str(cfg.get(field)))
    return drift

def dc_db_fix(c):
    for k in ("defaultModel", "preferredModel"):
        c.execute("UPDATE app_settings SET value_json=?, updated_at=? WHERE key=?",
                  (json.dumps(DESIRED_KEY), now(), k))
    rows = c.execute("SELECT cache_key, config_json FROM model_configs WHERE provider_id='QNFO-OPS'").fetchall()
    for ck, cj in rows:
        mid = ck.split("-_-")[-1] if "-_-" in ck else ""
        want = CANON_PARAM.get(mid)
        if not want:
            continue
        try:
            obj = json.loads(cj)
        except Exception:
            continue
        if not isinstance(obj, dict) or not isinstance(obj.get("config"), dict):
            continue
        cfg = obj["config"]
        dirty = False
        for field, val in (("maxTokens", want["maxTokens"]), ("contextLength", want["contextLength"]), ("timeout", want["timeout"])):
            if cfg.get(field) != val:
                cfg[field] = val; dirty = True
        if dirty:
            c.execute("UPDATE model_configs SET config_json=?, updated_at=? WHERE cache_key=?",
                      (json.dumps(obj, ensure_ascii=False), ms(), ck))

# NON-TOOL-MODELS-1: pin functionCall=False for the server-side loop models (DeepChat agent flag).
def dc_functioncall_drift(c):
    drift = []
    rows = c.execute("SELECT cache_key, config_json FROM model_configs WHERE provider_id='QNFO-OPS'").fetchall()
    for ck, cj in rows:
        mid = ck.split("-_-")[-1] if "-_-" in ck else ""
        if mid not in NON_TOOL_MODELS:
            continue
        try:
            obj = json.loads(cj)
        except Exception:
            drift.append(ck + ":unparseable"); continue
        cfg = obj.get("config") if isinstance(obj, dict) else None
        if not isinstance(cfg, dict):
            drift.append(ck + ":no-config"); continue
        if cfg.get("functionCall") is not False:
            drift.append(ck + ":functionCall=" + str(cfg.get("functionCall")))
    return drift

def dc_functioncall_fix(c):
    rows = c.execute("SELECT cache_key, config_json FROM model_configs WHERE provider_id='QNFO-OPS'").fetchall()
    for ck, cj in rows:
        mid = ck.split("-_-")[-1] if "-_-" in ck else ""
        if mid not in NON_TOOL_MODELS:
            continue
        try:
            obj = json.loads(cj)
        except Exception:
            continue
        if not isinstance(obj, dict) or not isinstance(obj.get("config"), dict):
            continue
        if obj["config"].get("functionCall") is not False:
            obj["config"]["functionCall"] = False
            c.execute("UPDATE model_configs SET config_json=?, updated_at=? WHERE cache_key=?",
                      (json.dumps(obj, ensure_ascii=False), ms(), ck))

def dc_js_functioncall_drift(d):
    drift = []
    for pr in d.get("providers") or []:
        if (pr.get("id") or pr.get("providerId") or "") != "QNFO-OPS":
            continue
        for m in pr.get("models") or []:
            if (m.get("modelId") or m.get("id")) in NON_TOOL_MODELS and isinstance(m.get("capabilities"), list):
                if "tool_use" in m["capabilities"]:
                    drift.append("json:QNFO-OPS/" + str(m.get("modelId")) + ":capabilities has tool_use")
    return drift

def dc_js_functioncall_fix(d):
    for pr in d.get("providers") or []:
        if (pr.get("id") or pr.get("providerId") or "") != "QNFO-OPS":
            continue
        for m in pr.get("models") or []:
            if (m.get("modelId") or m.get("id")) in NON_TOOL_MODELS and isinstance(m.get("capabilities"), list):
                if "tool_use" in m["capabilities"]:
                    m["capabilities"] = [x for x in m["capabilities"] if x != "tool_use"]

# ---------------- DeepChat JSON ----------------
def dc_js_drift(d):
    drift = []
    for k in ("defaultModel", "preferredModel"):
        if d.get(k) != DESIRED_KEY:
            drift.append(k + ":" + json.dumps(d.get(k)))
    # AI-GATEWAY-STALE-ENTRY-1 (2026-09-28): the superseded AI-GATEWAY provider must not linger
    # in the JSON snapshot (absent from the runtime provider registry, 0/77 - DEFAULT-KEY-OPS-1).
    if any((p.get("id") or "") == "AI-GATEWAY" for p in (d.get("providers") or [])):
        drift.append("providers:AI-GATEWAY:stale-entry")
    if "AI-GATEWAY" in (d.get("configuredProviders") or []):
        drift.append("configuredProviders:AI-GATEWAY:stale-entry")
    if "AI-GATEWAY" in (d.get("providerOrder") or []):
        drift.append("providerOrder:AI-GATEWAY:stale-entry")
    for pr in d.get("providers") or []:
        if (pr.get("id") or pr.get("providerId") or "") != "QNFO-OPS":
            continue
        for m in pr.get("models") or []:
            want = CANON_PARAM.get(m.get("id") or m.get("modelId"))
            if not want:
                continue
            for field, val in (("contextWindow", want["contextWindow"]), ("maxOutput", want["maxOutput"])):
                if m.get(field) != val:
                    drift.append("json:QNFO-OPS/" + str(m.get("id")) + ":" + field + "=" + str(m.get(field)))
    return drift

def dc_js_fix(d):
    for k in ("defaultModel", "preferredModel"):
        d[k] = DESIRED_KEY
    if "providers" in d:
        d["providers"] = [p for p in (d.get("providers") or []) if (p.get("id") or "") != "AI-GATEWAY"]
    if "configuredProviders" in d:
        d["configuredProviders"] = [x for x in (d.get("configuredProviders") or []) if x != "AI-GATEWAY"]
    if "providerOrder" in d:
        d["providerOrder"] = [x for x in (d.get("providerOrder") or []) if x != "AI-GATEWAY"]
    for pr in d.get("providers") or []:
        if (pr.get("id") or pr.get("providerId") or "") != "QNFO-OPS":
            continue
        for m in pr.get("models") or []:
            want = CANON_PARAM.get(m.get("id") or m.get("modelId"))
            if not want:
                continue
            m["contextWindow"] = want["contextWindow"]
            m["maxOutput"] = want["maxOutput"]

# ---------------- generic client (ChatBox / auto-discovered incl future SANNABOT) ----------------
def client_store(providers):
    """Return (provider_dict, drift_list) for the ops-endpoint provider inside a providers map."""
    for pid, pv in providers.items():
        host = str(pv.get("apiHost") or "")
        if OPS_HOST_MARK in host or OPS_HOST_MARK_NEW in host:
            drift = []
            for m in pv.get("models") or []:
                want = _want_param(m.get("modelId"))
                if not want:
                    continue
                for field, val in (("contextWindow", want["contextWindow"]), ("maxOutput", want["maxOutput"])):
                    if m.get(field) != val:
                        drift.append(pid + "/" + str(m.get("modelId")) + ":" + field + "=" + str(m.get(field)))
            return pv, drift
    return None, None

def client_fix(pv):
    for m in pv.get("models") or []:
        want = _want_param(m.get("modelId"))
        if not want:
            continue
        m["contextWindow"] = want["contextWindow"]
        m["maxOutput"] = want["maxOutput"]

def auto_candidate_paths():
    """ChatBox plus any top-level %APPDATA% app dir config/settings that looks client-like."""
    paths = [CHATBOX]
    try:
        for name in sorted(os.listdir(ROAM)):
            if not name or name.startswith(".") or name == "DeepChat":
                continue
            for fname in ("config.json", "settings.json"):
                p = os.path.join(ROAM, name, fname)
                if os.path.isfile(p) and os.path.getsize(p) < 5 * 1024 * 1024:
                    try:
                        txt = open(p, "r", encoding="utf-8", errors="ignore").read()
                        if OPS_HOST_MARK in txt or OPS_HOST_MARK_NEW in txt:
                            paths.append(p)
                    except Exception:
                        pass
    except Exception:
        pass
    seen = []
    for p in paths:
        if p not in seen:
            seen.append(p)
    return seen

# SESSION-PIN-SWEEP-1 (2026-09-18, canonical case: ops-exec toolCalls:0 recurrence):
# DeepChat freezes provider_id/model_id PER-SESSION in deepchat_sessions at session-creation
# time from whatever the 'deepchat' agent config was THEN. Fixing app_settings.defaultModel or
# agents.config_json only affects NEW sessions - it does NOT retroactively repair already-open
# sessions, which keep their frozen pin forever. This is the root mechanism behind repeated
# "ops-exec still fails" reports even after the global default was corrected: the user's actual
# open chat tabs never got the fix. NON_AGENTIC_MODELS = models proven (via AGENTIC-CANARY-1 on
# qnfo-chat-canary) to NOT emit client tool_calls under QNFO-OPS; any session pinned to one of
# these is silently broken for DeepChat's native agent loop and must be repaired. Only
# QNFO-OPS/{NON_AGENTIC_MODELS} rows are touched - deliberate user picks of other providers
# (anthropic/deepseek/etc.) are left alone; this fixes a proven-broken combination, not a
# preference.
NON_AGENTIC_MODELS = {"ops-exec", "ops-frontier", "ops-frontier-mini", "ops-frontier-reason"}

# SESSION-PIN-SWEEP-2 (2026-09-19, canonical case: 195/214 sessions pinned to the DIRECT
# deepseek provider -> DeepChat runs its own CLIENT tool loop -> local exec/run_code fail
# ("Session not running") -> run ends provider_error). ROOT-CAUSE-1: the 'deepchat' agent's
# config_json.model carried {"providerId":"deepseek"}, pinning EVERY new session to the direct
# DeepSeek API and bypassing the server-side executor (SERVER-SIDE-EXEC-100-1). SESSION-PIN-
# SWEEP-1 left these alone as "deliberate user picks" - wrong: they are the residue of the
# agent default, i.e. a proven-broken combination, not a preference. BROKEN_PROVIDERS is the
# allowlist of providers with no server-side executor path.
BROKEN_PROVIDERS = {"deepseek", "anthropic"}  # 2026-09-19 user directive: direct deepseek AND anthropic pins have NO server-side executor -> DeepChat runs its own CLIENT tool loop (SERVER-SIDE-EXEC-100-1 violation) -> rewrite to SESSION_KEY (QNFO-OPS/ops) and KEEP them there (durability; supersedes the earlier "direct deepseek allowed as fallback" sentinel). Canonical case: ptR3pIaDrDOJDVcwSmDlb reverted to deepseek-v4-flash after a one-off manual UPDATE that had no re-probe.

# NON-TOOL-MODELS-1 (2026-09-19, user directive "apply C for true server-side tool execution"):
# ops-exec/ops-frontier/-mini/-reason are retired ALIASES (still accepted, still 400000/128000);
# the canonical default + session id is `ops` (DEFAULT-KEY-OPS-1). These run a PURE SERVER-SIDE agent loop and emit NO client
# tool_calls. DeepChat must treat them as non-tool (model_configs config.functionCall=False) so its
# client agent layer does NOT enable tool-mode and wait for tool_calls that never arrive (which
# surfaced as "Request failed"). With functionCall=False DeepChat sends a plain chat request, the
# worker runs its full server-side tool loop (gpt-5.5), and returns the final answer text.
NON_TOOL_MODELS = {"ops-exec", "ops-frontier", "ops-frontier-mini", "ops-frontier-reason"}

def dc_sessions_drift(c):
    try:
        cols = [r[1] for r in c.execute("PRAGMA table_info(deepchat_sessions)")]
    except Exception:
        return []
    if "provider_id" not in cols or "model_id" not in cols:
        return []
    qmarks = ",".join("?" * len(NON_AGENTIC_MODELS))
    bp = ",".join("?" * len(BROKEN_PROVIDERS))
    rows = c.execute(
        "SELECT id, provider_id, model_id FROM deepchat_sessions "
        "WHERE (provider_id='QNFO-OPS' AND model_id IN (%s)) OR provider_id IN (%s)" % (qmarks, bp),
        tuple(NON_AGENTIC_MODELS) + tuple(BROKEN_PROVIDERS),
    ).fetchall()
    return [{"id": r[0], "provider_id": r[1], "model_id": r[2]} for r in rows]

def dc_sessions_fix(c):
    qmarks = ",".join("?" * len(NON_AGENTIC_MODELS))
    bp = ",".join("?" * len(BROKEN_PROVIDERS))
    c.execute(
        "UPDATE deepchat_sessions SET provider_id=?, model_id=? "
        "WHERE (provider_id='QNFO-OPS' AND model_id IN (%s)) OR provider_id IN (%s)" % (qmarks, bp),
        (SESSION_KEY["providerId"], SESSION_KEY["modelId"]) + tuple(NON_AGENTIC_MODELS) + tuple(BROKEN_PROVIDERS),
    )

# SESSION-PIN-CENSUS-1 (2026-09-19, canonical case: session ptR3pIaDrDOJDVcwSmDlb reverted to
# deepseek/deepseek-v4-flash after a one-off manual UPDATE; guard then reported
# deepchat_sessions.state="clean" because BROKEN_PROVIDERS is the no-op sentinel {"__disabled__"}).
# The sweep above deliberately repairs ONLY proven-broken combinations (direct-deepseek is an
# allowed gateway fallback per the 2026-09-19 directive), so a session on any other provider is
# left intact BY POLICY. That is fine - but the guard must NOT then report an unqualified "clean".
# This read-only census makes the residual pins VISIBLE in every run so "clean" can never hide
# them (DETECTION-NOT-REMEDIATION-1 / FILING-NOT-FIXING-1: a detector that hides what it chose not
# to repair is a false negative). It repairs nothing and never changes rc.
def dc_sessions_census(c):
    try:
        rows = c.execute(
            "SELECT provider_id, model_id, COUNT(*) FROM deepchat_sessions GROUP BY 1,2"
        ).fetchall()
    except Exception:
        return {}
    by_pin = {"%s/%s" % (p, m): n for p, m, n in rows}
    desired = "%s/%s" % (SESSION_KEY["providerId"], SESSION_KEY["modelId"])
    # Residual = sessions NOT on the desired key AND NOT on the QNFO-OPS server-side-executor
    # provider. Sessions on BROKEN_PROVIDERS (deepseek/anthropic) are REWRITTEN to SESSION_KEY by
    # dc_sessions_fix above -- the census therefore surfaces any OTHER non-QNFO-OPS pin that policy
    # leaves intact (DOC/CODE-PARITY fix 2026-09-28: the prior wording claimed deepseek was
    # 'surfaced, never silently rewritten', contradicting dc_sessions_fix which does rewrite it).
    residual = {
        k: v for k, v in by_pin.items()
        if k != desired and not k.startswith("QNFO-OPS/")
    }
    return {
        "total": sum(by_pin.values()),
        "by_pin": by_pin,
        "not_desired_key": {k: v for k, v in by_pin.items() if k != desired},
        "residual_off_server_side": residual,
    }

# AGENT-MODEL-SWEEP-1 (2026-09-19): the 6th/7th model-key locations. agents.config_json holds
# model / assistantModel / defaultModelPreset, which DeepChat copies into deepchat_sessions AT
# SESSION CREATION. Sweeping app_settings.defaultModel alone is necessary but NOT sufficient: a
# deepseek ref here re-pins every new session and silently re-creates SESSION-PIN-SWEEP-2.
AGENT_MODEL_KEYS = ("model", "assistantModel", "defaultModelPreset", "visionModel")
# AGENT-ALIAS-CANON-1 (2026-09-28): agent configs must pin the endpoint's SINGLE advertised ids
# (ONE-MODEL-PER-ENDPOINT-1). Retired relay aliases (auto / personal-twin-chat / kimi-k2.6) are
# accepted server-side (UNIVERSAL-OPENAI-MODEL-COMPAT-1) but must not be the pinned ids in agent
# configs. Canonical case: research/automation pinned QNFO-ROUTER/auto, personal pinned
# PERSONAL-TWIN/personal-twin-chat, deepchat+ops visionModel pinned QNFO-ROUTER/kimi-k2.6.
AGENT_ALIAS_MAP = {
    ("QNFO-ROUTER", "auto"): ("QNFO-ROUTER", "qnfo"),
    ("QNFO-ROUTER", "kimi-k2.6"): ("QNFO-ROUTER", "qnfo"),
    ("PERSONAL-TWIN", "personal-twin-chat"): ("PERSONAL-TWIN", "personal"),
}

def dc_agents_drift(c):
    bad = []
    try:
        rows = c.execute("SELECT id, config_json FROM agents").fetchall()
    except Exception:
        return []
    for aid, cfg in rows:
        if not cfg:
            continue
        try:
            o = json.loads(cfg)
        except Exception:
            continue
        for k in AGENT_MODEL_KEYS:
            v = o.get(k)
            if isinstance(v, dict):
                if v.get("providerId") in BROKEN_PROVIDERS or (v.get("providerId"), v.get("modelId")) in AGENT_ALIAS_MAP:
                    bad.append({"agent": aid, "key": k, "value": v})
    return bad

def dc_agents_fix(c):
    for aid, cfg in c.execute("SELECT id, config_json FROM agents").fetchall():
        if not cfg:
            continue
        try:
            o = json.loads(cfg)
        except Exception:
            continue
        changed = False
        for k in AGENT_MODEL_KEYS:
            v = o.get(k)
            if not isinstance(v, dict):
                continue
            if v.get("providerId") in BROKEN_PROVIDERS:
                o[k] = {"providerId": "QNFO-OPS", "modelId": "ops"}
                changed = True
            elif (v.get("providerId"), v.get("modelId")) in AGENT_ALIAS_MAP:
                o[k] = {"providerId": AGENT_ALIAS_MAP[(v.get("providerId"), v.get("modelId"))][0],
                        "modelId": AGENT_ALIAS_MAP[(v.get("providerId"), v.get("modelId"))][1]}
                changed = True
        if changed:
            c.execute("UPDATE agents SET config_json=?, updated_at=? WHERE id=?",
                      (json.dumps(o, ensure_ascii=False), now(), aid))


# PICKER-SINGLE-MODEL-GUARD-1 (2026-09-28): DeepChat's model PICKER reads provider_models
# (source='provider', re-synced from the worker's /v1/models endpoint). The endpoint advertises
# EXACTLY ONE model id (`ops` - ONE-MODEL-PER-ENDPOINT-1); the retired ops-frontier* ids remain
# VALID ALIASES server-side (IMMUTABLE-SPEC-VS-ALIAS-1) but must NOT be re-advertised in the
# picker. The previous sweep re-added them every run (GUARD-ENFORCES-RETIRED-ARCH-1 anti-pattern),
# fighting the single-model endpoint. This guard now ENFORCES the single-model picker: any
# QNFO-OPS provider_models row that is not `ops` is deleted, as are orphan AI-GATEWAY rows
# (AI-GATEWAY is absent from the providers table, 0/77 - DEFAULT-KEY-OPS-1).
ORPHAN_PROVIDERS = ("AI-GATEWAY",)

def dc_provider_models_drift(c):
    try:
        cols = [r[1] for r in c.execute("PRAGMA table_info(provider_models)")]
    except Exception:
        return []
    if "model_id" not in cols:
        return []
    extra = [r[0] for r in c.execute("SELECT model_id FROM provider_models WHERE provider_id='QNFO-OPS' AND model_id!='ops'").fetchall()]
    for pid in ORPHAN_PROVIDERS:
        n = c.execute("SELECT COUNT(*) FROM providers WHERE id=?", (pid,)).fetchone()[0]
        if n == 0:
            for m in c.execute("SELECT model_id FROM provider_models WHERE provider_id=?", (pid,)).fetchall():
                extra.append(pid + "/" + m[0])
    return extra

def dc_provider_models_fix(c):
    c.execute("DELETE FROM provider_models WHERE provider_id='QNFO-OPS' AND model_id!='ops'")
    for pid in ORPHAN_PROVIDERS:
        n = c.execute("SELECT COUNT(*) FROM providers WHERE id=?", (pid,)).fetchone()[0]
        if n == 0:
            c.execute("DELETE FROM provider_models WHERE provider_id=?", (pid,))

# MODEL-STATUS-CONVERGE-1 (2026-09-28): model_status is a SECOND model registry (the enable/disable
# surface) independent of provider_models. After ONE-MODEL-PER-ENDPOINT-1 it retained enabled=1 rows
# for RETIRED ids (QNFO-ROUTER 17, QNFO-OPS 7, PERSONAL-TWIN 4) -- a surface no guard owned (only
# restore-deepchat-providers.py referenced it). Converge: for each QNFO endpoint enable ONLY its
# single advertised id; DISABLE the retired residue (rows kept, non-destructive).
MODEL_STATUS_CANON = {"QNFO-OPS": "ops", "QNFO-ROUTER": "qnfo", "PERSONAL-TWIN": "personal"}

def dc_model_status_drift(c):
    extra = []
    try:
        cols = [r[1] for r in c.execute("PRAGMA table_info(model_status)")]
    except Exception:
        return []
    if "enabled" not in cols:
        return []
    for pid, keep in MODEL_STATUS_CANON.items():
        for mid, en in c.execute("SELECT model_id, enabled FROM model_status WHERE provider_id=?", (pid,)).fetchall():
            if mid != keep and en == 1:
                extra.append("%s/%s=enabled" % (pid, mid))
    return extra

def dc_model_status_fix(c):
    for pid, keep in MODEL_STATUS_CANON.items():
        c.execute("UPDATE model_status SET enabled=0, updated_at=? WHERE provider_id=? AND model_id!=? AND enabled=1",
                  (ms(), pid, keep))

# CHATBOX-PROVIDERS-GUARD-1 (2026-09-26, canonical case CHATBOX-PROVIDER-WIPE-1): an ad-hoc
# settings write set settings.customProviders=[] -> all 3 Cloudflare providers + their API keys
# vanished from the ChatBox UI, while model_guard still reported CLEAN (it only checked the ops
# provider's model params). This guard re-pins the 3 canonical providers AND their API keys into
# BOTH settings.customProviders and settings.providers, restoring from chatbox-providers-canonical.json.
CHATBOX_CANON_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chatbox-providers-canonical.json")

def _cb_canon():
    try:
        c = jload(CHATBOX_CANON_PATH)
        return c if isinstance(c, list) else []
    except Exception:
        return []

def _modelsig(models):
    # CHATBOX-CAPABILITIES-PARITY-1 (2026-09-28): compare modelId + capabilities so the guard
    # owns capability parity vs the canonical file (live had vision on ops/qnfo, none on personal).
    return [(m.get("modelId"), tuple(sorted(m.get("capabilities") or []))) for m in (models or [])]

def chatbox_providers_drift(d):
    canon = _cb_canon()
    if not canon:
        return []
    s = d.get("settings") if isinstance(d, dict) else None
    if not isinstance(s, dict):
        return ["settings:missing"]
    cps = s.get("customProviders")
    provs = s.get("providers") if isinstance(s.get("providers"), dict) else {}
    if not isinstance(cps, list):
        return ["customProviders:missing"]
    by_id = {c.get("id"): c for c in cps if isinstance(c, dict)}
    drift = []
    for w in canon:
        pid = w["id"]
        wds = w.get("defaultSettings", {})
        wsig = _modelsig(wds.get("models"))
        pv = provs.get(pid)
        if not isinstance(pv, dict) or not pv.get("apiKey"):
            drift.append(pid + ":providers:apiKey")
        elif _modelsig(pv.get("models")) != wsig:
            drift.append(pid + ":providers:models/caps")
        cur = by_id.get(pid)
        if cur is None:
            drift.append("customProviders:missing:" + pid); continue
        cds = cur.get("defaultSettings") or {}
        if not cds.get("apiKey"): drift.append(pid + ":custom:apiKey")
        if cds.get("apiHost") != wds.get("apiHost"): drift.append(pid + ":custom:apiHost")
        if _modelsig(cds.get("models")) != wsig:
            drift.append(pid + ":custom:models/caps")
    return drift

def chatbox_providers_fix(d):
    canon = _cb_canon()
    if not canon:
        return
    s = d.setdefault("settings", {})
    cps = s.get("customProviders")
    if not isinstance(cps, list):
        cps = []; s["customProviders"] = cps
    by_id = {c.get("id"): c for c in cps if isinstance(c, dict)}
    provs = s.get("providers")
    if not isinstance(provs, dict):
        provs = {}; s["providers"] = provs
    for w in canon:
        pid = w["id"]; wds = w.get("defaultSettings", {})
        wmodels = wds.get("models", [])
        cur = by_id.get(pid)
        if cur is None:
            cur = json.loads(json.dumps(w)); cps.append(cur); by_id[pid] = cur
        cds = cur.setdefault("defaultSettings", {})
        if not cds.get("apiKey"): cds["apiKey"] = wds.get("apiKey")
        cds["apiHost"] = wds.get("apiHost"); cds["apiPath"] = wds.get("apiPath")
        if _modelsig(cds.get("models")) != _modelsig(wmodels):
            cds["models"] = json.loads(json.dumps(wmodels))
        pv = provs.get(pid)
        if not isinstance(pv, dict):
            pv = {}; provs[pid] = pv
        if not pv.get("apiKey"): pv["apiKey"] = wds.get("apiKey")
        if not pv.get("apiHost"): pv["apiHost"] = wds.get("apiHost")
        if not pv.get("apiPath"): pv["apiPath"] = wds.get("apiPath")
        if _modelsig(pv.get("models")) != _modelsig(wmodels):
            pv["models"] = json.loads(json.dumps(wmodels))


# CHATBOX-BUILTIN-HIDE-GUARD-1 (2026-09-28): the chatbox-ai builtin re-adds its models on app
# launch ("hard-coded, re-adds on launch" - the 2026-09-04 hide was clobbered by the v1.23.3
# update; live count 54). All client model calls must route through Cloudflare Quniverse
# endpoints; this guard empties the builtin's models every run so the hide survives app updates.
def chatbox_builtin_drift(d):
    s = d.get("settings") if isinstance(d, dict) else None
    if not isinstance(s, dict):
        return []
    m = ((s.get("providers") or {}).get("chatbox-ai") or {}).get("models")
    return ["chatbox-ai:models=" + str(len(m))] if m else []

def chatbox_builtin_fix(d):
    s = d.setdefault("settings", {})
    pv = s.setdefault("providers", {})
    cai = pv.setdefault("chatbox-ai", {})
    if cai.get("models"):
        cai["models"] = []


# CHATBOX-PROMPT-GUARD-1 (2026-09-28): ChatBox's system prompt (settings.defaultPrompt) is a
# client-store instruction surface that NO guard owned -- the 2026-09-28 audit found it STALE
# (workers.dev hosts, the retired `ops-exec` model id, "~54 workers") and a ChatBox settings-save
# could re-clobber it. Restore the canonical prompt when it is empty or has re-staled.
CHATBOX_PROMPT_CANON_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chatbox-system-prompt-canonical.txt")
CHATBOX_PROMPT_STALE = ("workers.dev", "ops-exec", "personal-twin-chat", "~54 workers", "~37 workers")

def _cb_prompt_canon():
    try:
        return open(CHATBOX_PROMPT_CANON_PATH, encoding="utf-8").read()
    except Exception:
        return ""

def chatbox_prompt_drift(d):
    s = d.get("settings") if isinstance(d, dict) else None
    if not isinstance(s, dict):
        return ["settings:missing"]
    dp = s.get("defaultPrompt") or ""
    if not dp.strip():
        return ["defaultPrompt:empty"]
    hits = [m for m in CHATBOX_PROMPT_STALE if m in dp]
    return ["defaultPrompt:stale:" + ",".join(hits)] if hits else []

def chatbox_prompt_fix(d):
    canon = _cb_prompt_canon()
    if not canon:
        return
    d.setdefault("settings", {})["defaultPrompt"] = canon


# CLAUDE-PROMPT-GUARD-1 (2026-10-01): Claude Code's user memory (~/.claude/CLAUDE.md) is a
# front-end instruction surface with NO guard. Coordinate it with ChatBox: same 14-rule doctrine,
# server-side-exec-only emphasis. Restore from canonical on empty/stale/divergence.
CLAUDE_MD_PATH = os.path.join(os.path.expanduser("~"), ".claude", "CLAUDE.md")
CLAUDE_PROMPT_CANON_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "claude-system-prompt-canonical.txt")
CLAUDE_PROMPT_STALE = ("workers.dev", "ops-exec", "personal-twin-chat", "~54 workers", "~37 workers", "chatbox-ai")
CLAUDE_SETTINGS_PATH = os.path.join(
    os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude"),
    "settings.json",
)
CLAUDE_GATEWAY_MODEL = "claude-sonnet-5.5"


def claude_default_gateway(d):
    if not isinstance(d, dict) or not isinstance(d.get("env", {}), dict):
        raise ValueError("invalid settings structure")
    env = d.get("env", {})
    base_url = env.get("ANTHROPIC_BASE_URL", "")
    if not isinstance(base_url, str):
        raise ValueError("invalid gateway URL")
    url = urlsplit(base_url)
    parts = url.path.rstrip("/").split("/")
    return (url.scheme == "https" and url.hostname == "gateway.ai.cloudflare.com"
            and len(parts) == 5 and parts[1] == "v1" and bool(parts[2])
            and parts[3] == "default" and parts[4] in ("anthropic", "compat"))


def claude_model_policy(d):
    env = d.get("env") or {}
    want = {
        "model": CLAUDE_GATEWAY_MODEL,
        "availableModels": [CLAUDE_GATEWAY_MODEL],
    }
    env_want = {
        "ANTHROPIC_MODEL": CLAUDE_GATEWAY_MODEL,
        "ANTHROPIC_DEFAULT_OPUS_MODEL": CLAUDE_GATEWAY_MODEL,
        "ANTHROPIC_DEFAULT_SONNET_MODEL": CLAUDE_GATEWAY_MODEL,
    }
    for key in ("CLAUDE_CODE_SUBAGENT_MODEL", "ANTHROPIC_SMALL_FAST_MODEL",
                "ANTHROPIC_DEFAULT_HAIKU_MODEL"):
        if "opus" in str(env.get(key) or "").lower():
            env_want[key] = CLAUDE_GATEWAY_MODEL
    return want, env_want


def claude_model_drift(d):
    want, env_want = claude_model_policy(d)
    env = d.get("env") or {}
    return ([key for key, value in want.items() if d.get(key) != value]
            + ["env." + key for key, value in env_want.items() if env.get(key) != value])


def claude_model_guard():
    if not os.path.exists(CLAUDE_SETTINGS_PATH):
        return {"model_state": "settings-missing"}
    d = jload(CLAUDE_SETTINGS_PATH)
    if not claude_default_gateway(d):
        return {"model_state": "not-default-gateway"}
    drift = claude_model_drift(d)
    if drift:
        for _ in range(3):
            with open(CLAUDE_SETTINGS_PATH, "rb") as f:
                snapshot = f.read()
            latest = json.loads(snapshot.decode("utf-8"))
            if not claude_default_gateway(latest):
                return {"model_state": "not-default-gateway"}
            latest_drift = claude_model_drift(latest)
            if not latest_drift:
                break
            want, env_want = claude_model_policy(latest)
            latest.update(want)
            latest.setdefault("env", {}).update(env_want)
            if atomic_json_if_unchanged(CLAUDE_SETTINGS_PATH, latest, snapshot):
                break
    live = jload(CLAUDE_SETTINGS_PATH)
    readback = claude_model_drift(live)
    if not claude_default_gateway(live):
        readback.append("env.ANTHROPIC_BASE_URL")
    return {
        "client": "claude-code",
        "gateway": "default",
        "model": CLAUDE_GATEWAY_MODEL,
        "model_drift_before": drift,
        "model_readback": readback,
        "model_state": "verify-failed" if readback else ("fixed" if drift else "clean"),
    }

def _claude_prompt_canon():
    try:
        return open(CLAUDE_PROMPT_CANON_PATH, encoding="utf-8").read()
    except Exception:
        return ""

def claude_prompt_drift():
    canon = _claude_prompt_canon()
    if not canon:
        return ["canonical:missing"]
    if not os.path.exists(CLAUDE_MD_PATH):
        return ["CLAUDE.md:missing"]
    try:
        live = open(CLAUDE_MD_PATH, encoding="utf-8").read()
    except Exception:
        return ["CLAUDE.md:unreadable"]
    if not live.strip():
        return ["CLAUDE.md:empty"]
    hits = [m for m in CLAUDE_PROMPT_STALE if m in live]
    if hits:
        return ["CLAUDE.md:stale:" + ",".join(hits)]
    if live.rstrip("\n") != canon.rstrip("\n"):
        return ["CLAUDE.md:diverged"]
    return []

def claude_prompt_fix():
    canon = _claude_prompt_canon()
    if not canon:
        return
    d = os.path.dirname(CLAUDE_MD_PATH)
    if d and not os.path.isdir(d):
        os.makedirs(d, exist_ok=True)
    with open(CLAUDE_MD_PATH, "w", encoding="utf-8") as f:
        f.write(canon)


# SHARED-DOCTRINE-PARITY-1 (2026-10-01): the three front-end client prompts (DeepChat, ChatBox,
# Claude) MUST carry the same shared doctrine. DeepChat phrases it as gate-names, ChatBox/Claude as
# rule-titles, so each concept maps to a set of accepted markers; a prompt passes a concept if ANY
# accepted phrasing is present. Coordinates the three surfaces so a doctrine change in one prompt is
# flagged until mirrored to the others.
SHARED_DOCTRINE_CONCEPTS = {
    "server-side-execution": ("SERVER-SIDE-EXEC-100-1", "SERVER-SIDE EXECUTION ONLY"),
    "english-only": ("ENGLISH-ONLY", "ENGLISH ONLY"),
    "adversarial-reasoning": ("ADVERSARIAL-REASONING-1", "NO SYCOPHANCY"),
    "verification": ("COMPUTATIONAL-VERIFICATION-1", "VERIFY-IN-CODE-1", "EVIDENCE OVER ASSERTION"),
    "execute-over-chat": ("EXECUTION OVER CHAT", "ANSWER DIRECTLY"),
}

def shared_doctrine_parity():
    canon_sources = {
        "deepchat": os.path.join(os.path.expanduser("~"), ".deepchat", "system-prompt-v2.7.md"),
        "chatbox": CHATBOX_PROMPT_CANON_PATH,
        "claude": CLAUDE_PROMPT_CANON_PATH,
    }
    out = {}
    for name, p in canon_sources.items():
        try:
            txt = open(p, encoding="utf-8").read()
        except Exception as e:
            out[name] = "missing:" + str(e)
            continue
        missing = [c for c, marks in SHARED_DOCTRINE_CONCEPTS.items()
                   if not any(m in txt for m in marks)]
        out[name] = ("ok" if not missing else "missing:" + ",".join(missing))
    return out


def main():
    out = {"ts": now(), "desired_key": DESIRED_KEY, "canon_params": CANON_PARAM, "stores": {}}
    rc = 0
    # DeepChat DB
    if os.path.exists(DB):
        c = sqlite3.connect(DB, timeout=10)
        try:
            b = dc_db_drift(c)
            out["stores"]["deepchat_db"] = {"drift_before": b}
            if b:
                dc_db_fix(c); c.commit()
                out["stores"]["deepchat_db"]["fixed"] = True
            rb = dc_db_drift(c)
            out["stores"]["deepchat_db"]["readback"] = rb
            if rb:
                out["stores"]["deepchat_db"]["state"] = "verify-failed"; rc = 2
            else:
                out["stores"]["deepchat_db"]["state"] = "fixed" if b else "clean"
        except Exception as e:
            out["stores"]["deepchat_db"] = {"state": "error", "error": str(e)}; rc = 1
        finally:
            c.close()
    # NON-TOOL-MODELS-1: functionCall=False pin for server-side-loop models.
    if os.path.exists(DB):
        c = sqlite3.connect(DB, timeout=10)
        try:
            fb = dc_functioncall_drift(c)
            out["stores"]["deepchat_functioncall"] = {"drift_before": fb}
            if fb:
                dc_functioncall_fix(c); c.commit()
                out["stores"]["deepchat_functioncall"]["fixed"] = True
            frb = dc_functioncall_drift(c)
            out["stores"]["deepchat_functioncall"]["readback"] = frb
            if frb:
                out["stores"]["deepchat_functioncall"]["state"] = "verify-failed"; rc = 2
            else:
                out["stores"]["deepchat_functioncall"]["state"] = "fixed" if fb else "clean"
        except Exception as e:
            out["stores"]["deepchat_functioncall"] = {"state": "error", "error": str(e)}; rc = 1
        finally:
            c.close()
    # SESSION-PIN-SWEEP-1: per-session frozen model pins (deepchat_sessions), separate
    # connection/commit from the app_settings pass above so a failure here never blocks it.
    if os.path.exists(DB):
        c = sqlite3.connect(DB, timeout=10)
        try:
            sb = dc_sessions_drift(c)
            out["stores"]["deepchat_sessions"] = {"drift_before": sb}
            if sb:
                dc_sessions_fix(c); c.commit()
                out["stores"]["deepchat_sessions"]["fixed"] = True
            srb = dc_sessions_drift(c)
            out["stores"]["deepchat_sessions"]["readback"] = srb
            if srb:
                out["stores"]["deepchat_sessions"]["state"] = "verify-failed"; rc = 2
            else:
                out["stores"]["deepchat_sessions"]["state"] = "fixed" if sb else "clean"
            # SESSION-PIN-CENSUS-1: read-only visibility of residual (by-policy) pins.
            out["stores"]["deepchat_sessions"]["census"] = dc_sessions_census(c)
        except Exception as e:
            out["stores"]["deepchat_sessions"] = {"state": "error", "error": str(e)}; rc = 1
        finally:
            c.close()
    # AGENT-MODEL-SWEEP-1: agents.config_json model keys (the source of new-session pins).
    if os.path.exists(DB):
        c = sqlite3.connect(DB, timeout=10)
        try:
            ab = dc_agents_drift(c)
            out["stores"]["deepchat_agents"] = {"drift_before": ab}
            if ab:
                dc_agents_fix(c); c.commit()
                out["stores"]["deepchat_agents"]["fixed"] = True
            arb = dc_agents_drift(c)
            out["stores"]["deepchat_agents"]["readback"] = arb
            if arb:
                out["stores"]["deepchat_agents"]["state"] = "verify-failed"; rc = 2
            else:
                out["stores"]["deepchat_agents"]["state"] = "fixed" if ab else "clean"
        except Exception as e:
            out["stores"]["deepchat_agents"] = {"state": "error", "error": str(e)}; rc = 1
        finally:
            c.close()
        # PICKER-SINGLE-MODEL-GUARD-1: enforce the single-model picker (delete retired/orphan rows).
    if os.path.exists(DB):
        c = sqlite3.connect(DB, timeout=10)
        try:
            pb = dc_provider_models_drift(c)
            out["stores"]["deepchat_provider_models"] = {"drift_before": pb}
            if pb:
                dc_provider_models_fix(c); c.commit()
                out["stores"]["deepchat_provider_models"]["fixed"] = True
            prb = dc_provider_models_drift(c)
            out["stores"]["deepchat_provider_models"]["readback"] = prb
            if prb:
                out["stores"]["deepchat_provider_models"]["state"] = "verify-failed"; rc = 2
            else:
                out["stores"]["deepchat_provider_models"]["state"] = "fixed" if pb else "clean"
        except Exception as e:
            out["stores"]["deepchat_provider_models"] = {"state": "error", "error": str(e)}; rc = 1
        finally:
            c.close()
        # MODEL-STATUS-CONVERGE-1: retire stale enabled rows in the second model registry.
    if os.path.exists(DB):
        c = sqlite3.connect(DB, timeout=10)
        try:
            mb = dc_model_status_drift(c)
            out["stores"]["deepchat_model_status"] = {"drift_before": mb}
            if mb:
                dc_model_status_fix(c); c.commit()
                out["stores"]["deepchat_model_status"]["fixed"] = True
            mrb = dc_model_status_drift(c)
            out["stores"]["deepchat_model_status"]["readback"] = mrb
            if mrb:
                out["stores"]["deepchat_model_status"]["state"] = "verify-failed"; rc = 2
            else:
                out["stores"]["deepchat_model_status"]["state"] = "fixed" if mb else "clean"
        except Exception as e:
            out["stores"]["deepchat_model_status"] = {"state": "error", "error": str(e)}; rc = 1
        finally:
            c.close()
# DeepChat JSON
    if os.path.exists(JS):
        try:
            d = jload(JS)
            b = dc_js_drift(d)
            out["stores"]["deepchat_json"] = {"drift_before": b}
            if b:
                dc_js_fix(d)
                atomic_json(JS, d)
                out["stores"]["deepchat_json"]["fixed"] = True
            rb = dc_js_drift(jload(JS))
            out["stores"]["deepchat_json"]["readback"] = rb
            out["stores"]["deepchat_json"]["state"] = "verify-failed" if rb else ("fixed" if b else "clean")
            if rb: rc = 2
        except Exception as e:
            out["stores"]["deepchat_json"] = {"state": "error", "error": str(e)}; rc = 1
    # NON-TOOL-MODELS-1: app-settings.json capability mirror (drop tool_use).
    if os.path.exists(JS):
        try:
            d = jload(JS)
            fb = dc_js_functioncall_drift(d)
            out["stores"]["deepchat_json_functioncall"] = {"drift_before": fb}
            if fb:
                dc_js_functioncall_fix(d)
                atomic_json(JS, d)
                out["stores"]["deepchat_json_functioncall"]["fixed"] = True
            frb = dc_js_functioncall_drift(jload(JS))
            out["stores"]["deepchat_json_functioncall"]["readback"] = frb
            out["stores"]["deepchat_json_functioncall"]["state"] = "verify-failed" if frb else ("fixed" if fb else "clean")
            if frb: rc = 2
        except Exception as e:
            out["stores"]["deepchat_json_functioncall"] = {"state": "error", "error": str(e)}; rc = 1
    # generic client stores (ChatBox + auto-discovered, incl future SANNABOT)
    discovered = []
    for p in auto_candidate_paths():
        try:
            d = jload(p)
        except Exception as e:
            out["stores"][p] = {"state": "unparseable", "error": str(e)}
            continue
        providers = None
        if isinstance(d, dict):
            if isinstance(d.get("providers"), dict):
                providers = d["providers"]
            elif isinstance(d.get("settings"), dict) and isinstance(d["settings"].get("providers"), dict):
                providers = d["settings"]["providers"]
        if not providers:
            continue
        pv, drift = client_store(providers)
        if pv is None:
            continue
        discovered.append(p)
        rec = {"drift_before": drift}
        if drift:
            client_fix(pv)
            atomic_json(p, d)
            rec["fixed"] = True
        # read-back
        try:
            d2 = jload(p)
            providers2 = None
            if isinstance(d2, dict):
                if isinstance(d2.get("providers"), dict):
                    providers2 = d2["providers"]
                elif isinstance(d2.get("settings"), dict) and isinstance(d2["settings"].get("providers"), dict):
                    providers2 = d2["settings"]["providers"]
            _, rb = client_store(providers2 or {})
            rec["readback"] = rb
            rec["state"] = "verify-failed" if rb else ("fixed" if drift else "clean")
            if rb: rc = 2
        except Exception as e:
            rec["readback_error"] = str(e); rc = 1
        out["stores"][p] = rec
    # CHATBOX-PROVIDERS-GUARD-1: re-pin the 3 Cloudflare providers + their API keys (root-cause repair).
    if os.path.exists(CHATBOX) and _cb_canon():
        try:
            d = jload(CHATBOX)
            cb_before = chatbox_providers_drift(d)
            rec = out["stores"].setdefault(CHATBOX, {})
            rec["providers_drift_before"] = cb_before
            if cb_before:
                chatbox_providers_fix(d)
                atomic_json(CHATBOX, d)
                rec["providers_fixed"] = True
            cb_rb = chatbox_providers_drift(jload(CHATBOX))
            rec["providers_readback"] = cb_rb
            if cb_rb:
                rec["providers_state"] = "verify-failed"; rc = 2
            else:
                rec["providers_state"] = "fixed" if cb_before else "clean"
        except Exception as e:
            out["stores"].setdefault(CHATBOX, {})["providers_error"] = str(e); rc = 1
    # CHATBOX-BUILTIN-HIDE-GUARD-1: empty the chatbox-ai builtin models (hide from picker).
    if os.path.exists(CHATBOX):
        try:
            d = jload(CHATBOX)
            bb = chatbox_builtin_drift(d)
            rec = out["stores"].setdefault(CHATBOX, {})
            rec["builtin_drift_before"] = bb
            if bb:
                chatbox_builtin_fix(d)
                atomic_json(CHATBOX, d)
                rec["builtin_fixed"] = True
            brb = chatbox_builtin_drift(jload(CHATBOX))
            rec["builtin_readback"] = brb
            if brb:
                rec["builtin_state"] = "verify-failed"; rc = 2
            else:
                rec["builtin_state"] = "fixed" if bb else "clean"
        except Exception as e:
            out["stores"].setdefault(CHATBOX, {})["builtin_error"] = str(e); rc = 1
    # CHATBOX-PROMPT-GUARD-1: restore the canonical ChatBox system prompt on drift (empty/stale).
    if os.path.exists(CHATBOX) and _cb_prompt_canon():
        try:
            d = jload(CHATBOX)
            pb = chatbox_prompt_drift(d)
            rec = out["stores"].setdefault(CHATBOX, {})
            rec["prompt_drift_before"] = pb
            if pb:
                chatbox_prompt_fix(d)
                atomic_json(CHATBOX, d)
                rec["prompt_fixed"] = True
            prb = chatbox_prompt_drift(jload(CHATBOX))
            rec["prompt_readback"] = prb
            if prb:
                rec["prompt_state"] = "verify-failed"; rc = 2
            else:
                rec["prompt_state"] = "fixed" if pb else "clean"
        except Exception as e:
            out["stores"].setdefault(CHATBOX, {})["prompt_error"] = str(e); rc = 1
    # CLAUDE-PROMPT-GUARD-1: restore the canonical Claude Code memory (~/.claude/CLAUDE.md) on
    # empty/stale/divergence, keeping the Claude front-end coordinated with ChatBox/DeepChat.
    if _claude_prompt_canon():
        try:
            cd = claude_prompt_drift()
            rec = out["stores"].setdefault("claude", {})
            rec["prompt_drift_before"] = cd
            if cd:
                claude_prompt_fix()
                rec["prompt_fixed"] = True
            crb = claude_prompt_drift()
            rec["prompt_readback"] = crb
            if crb:
                rec["prompt_state"] = "verify-failed"; rc = 2
            else:
                rec["prompt_state"] = "fixed" if cd else "clean"
        except Exception as e:
            out["stores"].setdefault("claude", {})["prompt_error"] = str(e); rc = 1
    try:
        model_result = claude_model_guard()
        out["stores"].setdefault("claude", {}).update(model_result)
        if model_result["model_state"] == "verify-failed":
            rc = max(rc, 2)
    except Exception:
        # Settings may contain credentials; never include their contents in diagnostics.
        out["stores"].setdefault("claude", {})["model_error"] = "settings-check-failed"
        rc = max(rc, 1)
    # SHARED-DOCTRINE-PARITY-1: report shared-doctrine marker coverage across the three canonicals.
    parity = shared_doctrine_parity()
    out["shared_doctrine_parity"] = parity
    if any(v != "ok" for v in parity.values()):
        rc = max(rc, 2)
    out["ops_client_stores"] = discovered
    out["state"] = "clean" if rc == 0 else ("error" if rc == 1 else "verify-failed")
    print(json.dumps(out))
    return rc

if __name__ == "__main__":
    sys.exit(main())
