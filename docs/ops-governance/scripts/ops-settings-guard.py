#!/usr/bin/env python3
"""ops-settings-guard.py - OPS-SETTINGS-IMMUTABLE-1 permanent drift guard (2026-09-09).
User directive (2026-09-09): HARDEN AND MANDATE TO ALL AGENTS/PROCESSES - DO NOT CHANGE
THESE SETTINGS; enforce systemwide across the fleet (DeepChat / ChatBox / SannaBot).

CANONICAL (immutable) ops-exec settings - qnfo-ops v2.9.1+:
  worker.js : DEFAULT_MAX_OUT = 393216 | OPS_ANSWER_CAP default = 393216 (handleChat + workflow)
              relay maxOut clamp = 393216 | MODEL_CTX = 1048576 | OPS_LOOP_DEADLINE_MS = 300000
              Workflow step.do timeout = "15 minutes"
  wrangler.toml : [limits] cpu_ms = 300000
  DeepChat (DB agent.db + Roaming app-settings.json) : defaultModel AND preferredModel =
              QNFO-OPS/ops-frontier; QNFO-OPS models ops-exec + deepseek-v4-flash ctx=1048576
              maxOutput/maxTokens=393216 timeout=3600000
  ChatBox (Roaming/xyz.chatboxapp.app/config.json providers.qnfo-ops) : ops-exec +
              deepseek-v4-flash ctx=1048576 maxOutput=393216
  SannaBot : Android Google-Play OpenAI-compatible client - NO local store on this machine
              (documented absence); enforcement = /v1/models advertisement (ctx/maxOut fields)
              + qnfo-ai/QUICKSTART.md + qnfo-ops/CHATBOX-SETUP.md (must keep canonical values).

Behavior: idempotent self-healing aligner (same as model_guard.py). Default (no --check)
aligns any drift and read-backs. --check only reports (no writes) and exits 1 on drift.
Exit codes: 0 = fully clean/aligned | 1 = ANY drift remains after the align pass (incl. non-alignable worker/doc drift) or drift in --check | 2 = check error.
Canonical source: QNFO/qnfo-ops/scripts/ops-settings-guard.py (mirror: .deepchat/scripts).
"""
import json, os, re, sqlite3, sys, tempfile, datetime

CTX, MAXOUT, TIMEOUT = 1048576, 393216, 3600000
# Per-model CLIENT-side canonical params (2026-09-18 coverage fix - OPS-SETTINGS-GUARD-DEFAULT-MODEL-GAP-1):
# ops is the DEFAULT (DEFAULT-KEY-OPS-1) and carries its OWN limits (1048576/393216/600000); ops-frontier is a retired ALIAS at its own intentional 400000/128000/600000 (IMMUTABLE-SPEC-VS-ALIAS-1), not the default.
MODEL_PARAMS = {
    "ops":               {"ctx": 1048576, "maxOut": 393216, "timeout": 600000},
    "ops-exec":          {"ctx": 1048576, "maxOut": 393216, "timeout": 3600000},
    "deepseek-v4-flash": {"ctx": 1048576, "maxOut": 393216, "timeout": 3600000},
    "ops-frontier":      {"ctx": 400000,  "maxOut": 128000, "timeout": 600000},
}
# CHATBOX-OPS-MAXOUT-1 (2026-09-30): the ChatBox CLIENT caps the Ops model max output at 65536
# (user intent 2026-09-30: lowered 393216 -> 65536 to stop runaway replies). The ENDPOINT
# canon stays 393216 (DeepChat + worker.js + MODEL_PARAMS). DeepChat JSON uses MODEL_PARAMS.
CHATBOX_MAXOUT_OVERRIDE = {"ops": 65536}
# Presence-required per the canonical docstring; other known models are validated only if listed.
# `ops` is the canonical default + the endpoint's single advertised id (DEFAULT-KEY-OPS-1).
# ops-frontier* entries below are retired ALIASES kept at the intentional 400000/128000 spec
# (IMMUTABLE-SPEC-VS-ALIAS-1) -- they are not the default and must not be raised to `ops` caps.
REQUIRED_MODELS = ("ops",)
DESIRED_KEYS = {"providerId": "QNFO-OPS", "modelId": "ops"}  # DEFAULT-KEY-OPS-1 (2026-09-27): canonical DeepChat default = the OPS endpoint's single advertised model id (ONE-MODEL-PER-ENDPOINT-1); supersedes the 2026-09-19 AI-GATEWAY/openai/gpt-4.1 value, which is unresolvable (AI-GATEWAY absent from the runtime provider registry, 0/77). Triplicate per GUARD-TRIPLICATE-CONSISTENCY-1.
CHECK_ONLY = "--check" in sys.argv[1:]

HOME = os.path.expanduser("~")
WORKER = os.path.join(HOME, "Dev", "qnfo-workers", "qnfo-ops", "worker.js")
WRANGLER = os.path.join(HOME, "Dev", "qnfo-workers", "qnfo-ops", "wrangler.toml")
DC_APP = os.path.join(os.environ.get("APPDATA", ""), "DeepChat")
DC_DB = os.path.join(DC_APP, "app_db", "agent.db")
DC_JSON = os.path.join(DC_APP, "app-settings.json")
CB_JSON = os.path.join(os.environ.get("APPDATA", ""), "xyz.chatboxapp.app", "config.json")
DOC_CHECK = [
    os.path.join(HOME, "Dev", "qnfo-workers", "qnfo-ai", "QUICKSTART.md"),
    os.path.join(HOME, "Dev", "qnfo-workers", "qnfo-ops", "CHATBOX-SETUP.md"),
]
WORKER_REQS = [
    ("DEFAULT_MAX_OUT", r"var DEFAULT_MAX_OUT = (\d+)", MAXOUT),
    ("OPS_ANSWER_CAP default", r'"OPS_ANSWER_CAP", (\d+)', MAXOUT),
    ("relay maxOut clamp", r"clamp\(maxTokens, (393216)\)", MAXOUT),
    ("MODEL_CTX", r"var MODEL_CTX = (\d+)", CTX),
    ("OPS_LOOP_DEADLINE_MS", r"OPS_LOOP_DEADLINE_MS\", ([0-9.]+(?:e\+?\d+)?)", 300000),
]

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def problems():
    p = []
    try:
        src = open(WORKER, encoding="utf-8", errors="replace").read()
    except OSError as e:
        return ["worker.js unreadable: " + str(e)]
    for label, pat, want in WORKER_REQS:
        m = re.search(pat, src)
        if not m:
            p.append("worker " + label + ": missing")
        elif int(float(m.group(1))) != want:
            p.append("worker " + label + "=" + m.group(1) + " (want " + str(want) + ")")
    if 'timeout: "15 minutes"' not in src:
        p.append('worker Workflow step.do timeout missing "15 minutes"')
    vm = re.search(r"(?:var|const|let)\s+VERSION\s*=\s*[\"'](\d+)\.(\d+)\.(\d+)", src)
    if not vm:
        p.append("worker VERSION: unparseable")
    elif (int(vm.group(1)), int(vm.group(2)), int(vm.group(3))) < (2, 9, 0):
        p.append("worker VERSION " + ".".join(vm.group(1, 2, 3)) + " < 2.9.0 (guard expects >= 2.9.1)")
    try:
        t = open(WRANGLER, encoding="utf-8").read()
        m = re.search(r"cpu_ms = (\d+)", t)
        if not m or int(m.group(1)) != 300000:
            p.append("wrangler cpu_ms=" + (m.group(1) if m else "missing") + " (want 300000)")
    except OSError as e:
        p.append("wrangler.toml unreadable: " + str(e))
    return p

def model_id(m):
    return m.get("modelId") or m.get("id") or m.get("model")

def find_models(models):
    by = {}
    for m in models or []:
        if isinstance(m, dict):
            mid = model_id(m)
            if mid:
                by[mid] = m
    return by

def dc_db_drift(c):
    p = []
    for k in ("defaultModel", "preferredModel"):
        row = c.execute("SELECT value_json FROM app_settings WHERE key=?", (k,)).fetchone()
        try:
            v = json.loads(row[0]) if row else None
        except Exception:
            p.append("dc-db " + k + ": unparseable"); continue
        if v != DESIRED_KEYS:
            p.append("dc-db " + k + ": " + json.dumps(v))
    for mid, mp in MODEL_PARAMS.items():
        row = c.execute("SELECT config_json FROM model_configs WHERE provider_id=? AND model_id=?",
                        ("QNFO-OPS", mid)).fetchone()
        if not row:
            if mid in REQUIRED_MODELS:
                p.append("dc-db model_config QNFO-OPS/" + mid + ": missing")
            continue
        try:
            conf = json.loads(row[0]).get("config", {})
        except Exception:
            p.append("dc-db model_config QNFO-OPS/" + mid + ": unparseable"); continue
        if int(conf.get("maxTokens") or 0) != mp["maxOut"]:
            p.append("dc-db QNFO-OPS/" + mid + " maxTokens=" + str(conf.get("maxTokens")))
        if int(conf.get("contextLength") or 0) != mp["ctx"]:
            p.append("dc-db QNFO-OPS/" + mid + " ctx=" + str(conf.get("contextLength")))
        if int(conf.get("timeout") or 0) < mp["timeout"]:
            p.append("dc-db QNFO-OPS/" + mid + " timeout=" + str(conf.get("timeout")))
    return p

def dc_json_drift(d):
    p = []
    for k in ("defaultModel", "preferredModel"):
        if d.get(k) != DESIRED_KEYS:
            p.append("dc-json " + k + ": " + json.dumps(d.get(k)))
    found = {}
    for pr in d.get("providers", []):
        if (pr.get("id") or "") == "QNFO-OPS":
            found = find_models(pr.get("models"))
    for mid, mp in MODEL_PARAMS.items():
        m = found.get(mid)
        if not m:
            if mid in REQUIRED_MODELS:
                p.append("dc-json QNFO-OPS/" + mid + ": missing")
            continue
        if int(m.get("maxOutput") or m.get("maxTokens") or 0) != mp["maxOut"]:
            p.append("dc-json QNFO-OPS/" + mid + " maxOutput=" + str(m.get("maxOutput") or m.get("maxTokens")))
        if int(m.get("contextWindow") or m.get("contextLength") or 0) != mp["ctx"]:
            p.append("dc-json QNFO-OPS/" + mid + " ctx=" + str(m.get("contextWindow") or m.get("contextLength")))
    return p

def chatbox_drift(d):
    p = []
    ops = (d.get("settings", {}).get("providers", {}) or {}).get("qnfo-ops", {})
    if not ops:
        return ["chatbox qnfo-ops provider: missing"]
    found = find_models(ops.get("models"))
    for mid, mp in MODEL_PARAMS.items():
        m = found.get(mid)
        if not m:
            if mid in REQUIRED_MODELS:
                p.append("chatbox qnfo-ops/" + mid + ": missing")
            continue
        cb_max = CHATBOX_MAXOUT_OVERRIDE.get(mid, mp["maxOut"])
        if int(m.get("maxOutput") or 0) != cb_max:
            p.append("chatbox qnfo-ops/" + mid + " maxOutput=" + str(m.get("maxOutput")))
        if int(m.get("contextWindow") or 0) != mp["ctx"]:
            p.append("chatbox qnfo-ops/" + mid + " ctx=" + str(m.get("contextWindow")))
    return p

def docs_drift():
    p = []
    for path in DOC_CHECK:
        try:
            s = open(path, encoding="utf-8", errors="replace").read()
        except OSError:
            p.append("doc missing: " + path); continue
        if "393216" not in s or "1048576" not in s:
            p.append("doc " + os.path.basename(path) + ": does not carry canonical ctx 1048576 / maxOut 393216")
    return p

def align_dc_db(c, drift):
    for k in ("defaultModel", "preferredModel"):
        c.execute("UPDATE app_settings SET value_json=?, updated_at=? WHERE key=?",
                  (json.dumps(DESIRED_KEYS), now(), k))
    for mid, mp in MODEL_PARAMS.items():
        row = c.execute("SELECT config_json FROM model_configs WHERE provider_id=? AND model_id=?",
                        ("QNFO-OPS", mid)).fetchone()
        if not row:
            continue
        obj = json.loads(row[0])
        conf = obj.get("config", {})
        conf["maxTokens"] = mp["maxOut"]
        conf["contextLength"] = mp["ctx"]
        conf["timeout"] = mp["timeout"]
        obj["config"] = conf
        c.execute("UPDATE model_configs SET config_json=?, updated_at=? WHERE provider_id=? AND model_id=?",
                  (json.dumps(obj), now(), "QNFO-OPS", mid))

def align_dc_json(d):
    d["defaultModel"] = dict(DESIRED_KEYS)
    d["preferredModel"] = dict(DESIRED_KEYS)
    _provs = d.get("providers")
    if isinstance(_provs, list) and not any((p.get("id") or "") == "QNFO-OPS" for p in _provs):
        _provs.append({
            "id": "QNFO-OPS", "name": "QNFO Ops", "apiType": "openai",
            "baseUrl": "https://ops.qnfo.org/v1", "enabled": True,
            "models": [{"id": "ops", "maxOutput": MODEL_PARAMS["ops"]["maxOut"],
                        "contextWindow": MODEL_PARAMS["ops"]["ctx"]}],
        })
    for pr in d.get("providers", []):
        if (pr.get("id") or "") == "QNFO-OPS":
            for m in pr.get("models", []):
                if model_id(m) in MODEL_PARAMS:
                    m["maxOutput"] = MODEL_PARAMS[model_id(m)]["maxOut"]
                    m["contextWindow"] = MODEL_PARAMS[model_id(m)]["ctx"]

def align_chatbox(d):
    ops = (d.get("settings", {}).get("providers", {}) or {}).get("qnfo-ops", {})
    for m in ops.get("models", []):
        if model_id(m) in MODEL_PARAMS:
            mid = model_id(m)
            m["maxOutput"] = CHATBOX_MAXOUT_OVERRIDE.get(mid, MODEL_PARAMS[mid]["maxOut"])
            m["contextWindow"] = MODEL_PARAMS[mid]["ctx"]

def atomic_write(path, obj):
    d = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".ops-guard.", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)

def main():
    res = {"ts": now(), "canonical": {"ctx": CTX, "maxOutput": MAXOUT, "default": DESIRED_KEYS}}
    probs = problems()
    dbc = sqlite3.connect(DC_DB, timeout=10)
    try:
        probs += dc_db_drift(dbc)
    except Exception as e:
        dbc.close(); res["error"] = "dc-db: " + str(e); print(json.dumps(res)); return 2
    try:
        djson = json.load(open(DC_JSON, encoding="utf-8"))
    except Exception as e:
        dbc.close(); res["error"] = "dc-json: " + str(e); print(json.dumps(res)); return 2
    probs += dc_json_drift(djson)
    try:
        cb = json.load(open(CB_JSON, encoding="utf-8"))
    except Exception as e:
        dbc.close(); res["error"] = "chatbox: " + str(e); print(json.dumps(res)); return 2
    probs += chatbox_drift(cb)
    probs += docs_drift()
    res["drift"] = probs
    if not probs:
        dbc.close()
        res["state"] = "clean"
        print(json.dumps(res)); return 0
    if CHECK_ONLY:
        dbc.close()
        res["state"] = "drift"
        print(json.dumps(res)); return 1
    try:
        align_dc_db(dbc, probs); dbc.commit()
    except Exception as e:
        dbc.close(); res["state"] = "db-fix-failed"; res["error"] = str(e); print(json.dumps(res)); return 1
    align_dc_json(djson)
    try:
        atomic_write(DC_JSON, djson)
    except Exception as e:
        dbc.close(); res["state"] = "dc-json-fix-failed"; res["error"] = str(e); print(json.dumps(res)); return 1
    align_chatbox(cb)
    try:
        atomic_write(CB_JSON, cb)
    except Exception as e:
        dbc.close(); res["state"] = "chatbox-fix-failed"; res["error"] = str(e); print(json.dumps(res)); return 1
    rb = []
    rb += problems()
    rb += dc_db_drift(dbc)
    d2 = json.load(open(DC_JSON, encoding="utf-8")); rb += dc_json_drift(d2)
    cb2 = json.load(open(CB_JSON, encoding="utf-8")); rb += chatbox_drift(cb2)
    rb += docs_drift()
    dbc.close()
    res["readback_drift"] = rb
    if rb:
        res["state"] = "drift-remaining"; res["unresolved"] = rb
        print(json.dumps(res)); return 1
    res["state"] = "aligned"
    print(json.dumps(res)); return 0

if __name__ == "__main__":
    sys.exit(main())
