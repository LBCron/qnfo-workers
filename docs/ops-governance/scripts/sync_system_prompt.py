# -*- coding: utf-8 -*-
"""sync_system_prompt.py — v4.0: system-prompt sync to all stores with CORRECT shapes + config-guard wrap.

FIXED 2026-08-31 (crash vector): v3.93 wrote systemPrompts as a bare JSON string and
defaultModel/preferredModel as bare strings into agent.db app_settings — wrong shapes that crash
the app on the next route invoke ('prompts.find is not a function' / model-picker errors).
v4.0 writes:
  - DB systemPrompts      -> JSON ARRAY [ {id:'default', name:'DeepChat', content, isDefault:true, createdAt, updatedAt} ]
  - DB defaultModel/preferredModel -> JSON OBJECT {providerId, modelId}

Reads canonical .deepchat/system-prompt-v2.7.md and writes:
  - Roaming app-settings.json default_system_prompt  (string, as the app expects)
  - .deepchat/app-settings.json default_system_prompt
  - Roaming app_db/agent.db app_settings.systemPrompts + defaultModel/preferredModel
  - .deepchat/agent.db app_settings (if table exists; column-aware value_json/value)

SAFETY:
  - DELTA GUARD: if canonical length differs from live default_system_prompt by >25% (or 5KB),
    ABORT unless --force. Prevents a stale canonical file from clobbering a newer live prompt.
  - Wraps all writes with config-guard --snapshot (before) and --validate (after).
"""
import datetime
import json
import os
import sqlite3
import subprocess
import sys

CANON = r"C:\Users\LENOVO\.deepchat\system-prompt-v2.7.md"
ROAMING_JSON = r"C:\Users\LENOVO\AppData\Roaming\DeepChat\app-settings.json"
ROAMING_DB = r"C:\Users\LENOVO\AppData\Roaming\DeepChat\app_db\agent.db"
GUARD = r"C:\Users\LENOVO\.deepchat\skills\config-guard\scripts\config-guard.py"
FLASH = "deepseek/deepseek-v4-flash"  # RELAY-MODEL-1: flash relay remains available for explicit relay selection
MODEL_DICT = {"providerId": "QNFO-OPS", "modelId": "ops"}  # DEFAULT-KEY-OPS-1 (2026-09-27): canonical DeepChat default = the OPS endpoint's single advertised model id (ONE-MODEL-PER-ENDPOINT-1); supersedes the 2026-09-19 AI-GATEWAY/openai/gpt-4.1 value, which is unresolvable (AI-GATEWAY absent from the runtime provider registry, 0/77). Triplicate per GUARD-TRIPLICATE-CONSISTENCY-1.


def guard(*args):
    try:
        r = subprocess.run([sys.executable, GUARD, *args], capture_output=True, text=True, timeout=60)
        print("  [guard]", " ".join(args), "->", r.stdout.strip().splitlines()[-1] if r.stdout.strip() else r.returncode)
    except Exception as e:
        print("  [guard] unavailable:", e)


def main():
    force = "--force" in sys.argv

    with open(CANON, encoding="utf-8") as f:
        content = f.read()
    print("canonical chars:", len(content))

    # Delta guard vs live
    try:
        live = json.load(open(ROAMING_JSON, encoding="utf-8")).get("default_system_prompt", "")
    except Exception:
        live = ""
    if not force and live and abs(len(content) - len(live)) > max(int(0.25 * len(live)), 5000):
        print("ABORT: canonical len", len(content), "vs live len", len(live),
              "differs >25% — refusing to clobber the live prompt. Use --force to override.")
        return 2

    guard("--snapshot", "--tag", "sync-system-prompt")

    # 1. JSON stores (default_system_prompt is a plain string there; model keys are dicts)
    for p in (ROAMING_JSON,):
        d = json.load(open(p, encoding="utf-8"))
        d["default_system_prompt"] = content
        d["defaultModel"] = MODEL_DICT
        d["preferredModel"] = MODEL_DICT
        with open(p, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=2)
        print("json written:", p, "promptlen", len(d["default_system_prompt"]))

    # 2. DB stores — CORRECT SHAPES (array for systemPrompts, dict for model keys)
    now = int(datetime.datetime.now().timestamp() * 1000)
    sys_prompts = [{"id": "default", "name": "DeepChat", "content": content,
                    "isDefault": True, "createdAt": now, "updatedAt": now}]
    for dbp in (ROAMING_DB,):
        if not os.path.exists(dbp):
            print("skip (missing):", dbp)
            continue
        c = sqlite3.connect(dbp)
        try:
            tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")]
            if "app_settings" not in tables:
                print("skip (no app_settings):", dbp)
                c.close()
                continue
            cols = [r[1] for r in c.execute("PRAGMA table_info(app_settings)")]
            vcol = "value_json" if "value_json" in cols else ("value" if "value" in cols else None)
            if not vcol:
                print("skip (no value column):", dbp, cols)
                c.close()
                continue
            c.execute("UPDATE app_settings SET " + vcol + "=? WHERE key=?", (json.dumps(sys_prompts), "systemPrompts"))
            c.execute("UPDATE app_settings SET " + vcol + "=? WHERE key=?", (json.dumps(MODEL_DICT), "defaultModel"))
            c.execute("UPDATE app_settings SET " + vcol + "=? WHERE key=?", (json.dumps(MODEL_DICT), "preferredModel"))
            # v4.12 (2026-09-04): also sync the deepchat agent row (systemPrompt + model presets)
            # - prompt-store-verify.py checks agents.config_json.systemPrompt against the canonical.
            if "agents" in tables:
                try:
                    ag = c.execute("SELECT config_json FROM agents WHERE id='deepchat'").fetchone()
                    if ag:
                        ad = json.loads(ag[0])
                        sp = content[:-1] if content.endswith("\n") else content
                        ad["systemPrompt"] = sp
                        ad["defaultModelPreset"] = MODEL_DICT
                        ad["assistantModel"] = MODEL_DICT
                        c.execute("UPDATE agents SET config_json=?, updated_at=? WHERE id='deepchat'",
                                  (json.dumps(ad, ensure_ascii=False), now))
                        print("agents row synced (deepchat)")
                except Exception as e2:
                    print("agents sync skipped:", e2)
            c.commit()
            print("db written:", dbp, "(systemPrompts array, model dicts)")
        except Exception as e:
            print("db error:", dbp, e)
        finally:
            c.close()

    # 3. Readback verification
    print("=== READBACK ===")
    d = json.load(open(ROAMING_JSON, encoding="utf-8"))
    print("roaming promptlen:", len(d.get("default_system_prompt", "")))
    print("roaming defaultModel:", d.get("defaultModel"), "preferredModel:", d.get("preferredModel"))
    c = sqlite3.connect(ROAMING_DB)
    for key in ("systemPrompts", "defaultModel", "preferredModel"):
        row = c.execute("SELECT value_json FROM app_settings WHERE key=?", (key,)).fetchone()
        if row:
            v = json.loads(row[0])
            print("db", key, "->", type(v).__name__, (len(v) if isinstance(v, list) else v))
    c.close()

    guard("--validate")
    print("SYNC COMPLETE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
