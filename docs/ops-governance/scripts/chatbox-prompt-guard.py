#!/usr/bin/env python3
"""chatbox-prompt-guard.py - CHATBOX-PROMPT-NO-CANONICAL-ARTIFACT-1 remediation.

ChatBox's system prompt (settings.defaultPrompt) had no canonical store: the only
ChatBox-side artifact, chatbox-system-prompt-canonical.txt, is a different 9.3 KB
Quniverse-rules document, not what config.json holds. So an owner directive block
appended to the live prompt could be lost by any future ChatBox settings write,
with no gate noticing.

This guard gives ChatBox the same shape the DeepChat prompt already has:
  canonical artifact  ->  chatbox-doctrine-prompt-canonical.txt
  live store          ->  %APPDATA%/xyz.chatboxapp.app/config.json settings.defaultPrompt

It also re-asserts the three verified provider keys in BOTH places ChatBox keeps
them (settings.providers[].apiKey and settings.customProviders[].defaultSettings.apiKey),
because the templates drifted to dead keys on 2026-10-17.

Exit codes: 0 = in sync or healed, 1 = drift that could not be healed, 2 = error.

Usage:
  python chatbox-prompt-guard.py            # check + heal
  python chatbox-prompt-guard.py --check    # check only, never write
  python chatbox-prompt-guard.py --self-test
"""
import argparse
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CANON = os.path.join(HERE, "chatbox-doctrine-prompt-canonical.txt")
CONFIG = os.path.join(os.environ.get("APPDATA", ""), "xyz.chatboxapp.app", "config.json")

MARKER = "OWNER STANDING DIRECTIVES — 2026-10-17"

# Verified live 2026-10-17 (HTTP 200 on each endpoint). See O:/notes/v1/2026/10/17/_qnfo-llm-config-2026-10-17.md
KEYS = {
    "qnfo-router": "oc-ai-ffb5142bfb6fd753f5b80d732d0526e6372640b97c2babd5",
    "personal-twin": "oc-pl-7ab1dd5c8894bc3d9fb57f805e200b2518cf24c9f5e680ab",
    "qnfo-ops": "oc-ops-b22590501cb93be8b47908f389000347100da70826b31b86",
}


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def check(cfg, canon):
    """Return list of (kind, detail) drift findings."""
    findings = []
    prompt = cfg.get("settings", {}).get("defaultPrompt", "")
    if prompt.strip() != canon.strip():
        findings.append(("prompt", "defaultPrompt len %d != canonical len %d" % (len(prompt), len(canon))))
    for pid, key in KEYS.items():
        active = cfg.get("settings", {}).get("providers", {}).get(pid, {}).get("apiKey")
        if active != key:
            findings.append(("provider", "%s active key %s" % (pid, (active or "<missing>")[:6])))
        tmpl = next((c for c in cfg.get("settings", {}).get("customProviders", []) if c.get("id") == pid), None)
        if tmpl is None:
            findings.append(("template", "%s customProvider missing" % pid))
        elif (tmpl.get("defaultSettings") or {}).get("apiKey") != key:
            got = ((tmpl.get("defaultSettings") or {}).get("apiKey") or "<missing>")[:6]
            findings.append(("template", "%s template key %s" % (pid, got)))
    return findings


def heal(cfg, canon):
    cfg.setdefault("settings", {})["defaultPrompt"] = canon
    provs = cfg["settings"].setdefault("providers", {})
    for pid, key in KEYS.items():
        if pid in provs:
            provs[pid]["apiKey"] = key
    for cp in cfg["settings"].setdefault("customProviders", []):
        pid = cp.get("id")
        if pid in KEYS:
            cp.setdefault("defaultSettings", {})["apiKey"] = KEYS[pid]
    return cfg


def run(check_only=False):
    canon = open(CANON, encoding="utf-8").read()
    cfg = load_json(CONFIG)
    findings = check(cfg, canon)
    if not findings:
        print("CHATBOX-PROMPT-GUARD: PASS (prompt == canonical %d chars, %d providers current)" % (len(canon), len(KEYS)))
        return 0
    for kind, detail in findings:
        print("  DRIFT [%s] %s" % (kind, detail))
    if check_only:
        print("CHATBOX-PROMPT-GUARD: FAIL (%d findings, --check so nothing written)" % len(findings))
        return 1
    backup = CONFIG + ".bak-guard"
    shutil.copy2(CONFIG, backup)
    heal(cfg, canon)
    with open(CONFIG, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent="\t")
    after = check(load_json(CONFIG), canon)
    if after:
        print("CHATBOX-PROMPT-GUARD: FAIL (healed but %d findings remain; backup %s)" % (len(after), backup))
        return 1
    print("CHATBOX-PROMPT-GUARD: HEALED (%d findings fixed, backup %s; takes effect at next ChatBox start)" % (len(findings), backup))
    return 0


def self_test():
    """Prove the heal path against a drifted fixture, without touching the live config."""
    tmp = tempfile.mkdtemp(prefix="cbguard-")
    try:
        canon = "canonical prompt body\n\n" + MARKER + "\n"
        cfg = {
            "configVersion": 15,
            "settings": {
                "defaultPrompt": "stale prompt body",
                "providers": {pid: {"apiKey": "dead-" + pid} for pid in KEYS},
                "customProviders": [{"id": pid, "defaultSettings": {"apiKey": "dead-" + pid}} for pid in KEYS],
            },
        }
        path = os.path.join(tmp, "config.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(cfg, f)
        findings = check(cfg, canon)
        assert len(findings) == 7, "expected 7 findings, got %d" % len(findings)
        healed = heal(json.loads(json.dumps(cfg)), canon)
        remaining = check(healed, canon)
        assert not remaining, "heal left %d findings" % len(remaining)
        assert healed["settings"]["defaultPrompt"] == canon
        assert all(healed["settings"]["providers"][p]["apiKey"] == k for p, k in KEYS.items())
        print("SELF-TEST: PASS (7 drifted findings detected, all healed, none remaining)")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()
    sys.exit(self_test() if a.self_test else run(a.check))
