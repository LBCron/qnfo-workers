"""update_templates.py — v3.93 cycle: append new gates to cmd-skills-update + cmd-red-team
in BOTH repo canonical files (customPrompts.json + customPrompts-canonical.json), content==template.
"""
import json

REPO = r"C:\Users\LENOVO\Documents\GitHub\qnfo-skills\prompt-stores"
SKILLS_ADD = ("\n\n2026-08-29 additions (system-prompt v3.93 / kaizen v2.113): "
              "D1-WRITE-ASCII-1 (D1 TEXT via curl JSON from Git Bash MUST be ASCII-only; escape "
              "backslashes D:\\\\; non-ASCII bytes corrupt the stored field); "
              "EXEC-AUTOBG-SESSION-ERROR-1 (exec 'Session not running' = reporting glitch; one retry, "
              "then process-log readback); GIT-REBASE-AFTER-COMMIT-1 (commit BEFORE pull --rebase); "
              "FRAMEWORK-DOGFOOD-1 (framework records carry claim-sheet fields on their own locked "
              "claims); REDTEAM-CHILD-CROSS-CHECK-1 (parent re-verifies every HIGH/CRITICAL).")
REDTEAM_ADD = ("\n\n2026-08-29 additions: FRAMEWORK-DOGFOOD-1 (framework/governance records under "
               "audit must show their own locked claims carry claim-sheet fields - self-gate "
               "application) + REDTEAM-CHILD-CROSS-CHECK-1 (converging slot findings = strong signal; "
               "parent re-verifies HIGH/CRITICAL against primary evidence; cross-slot duplicates "
               "consolidate severity).")

for name in ("customPrompts.json", "customPrompts-canonical.json"):
    p = REPO + "\\" + name
    d = json.load(open(p, encoding="utf-8"))
    hits = 0
    for e in d:
        if e.get("id") == "cmd-skills-update":
            e["content"] = (e.get("content") or "") + SKILLS_ADD
            if "template" in e:
                e["template"] = e["content"]
            hits += 1
        elif e.get("id") == "cmd-red-team":
            e["content"] = (e.get("content") or "") + REDTEAM_ADD
            if "template" in e:
                e["template"] = e["content"]
            hits += 1
    with open(p, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    print("wrote", name, "entries", len(d), "updated", hits)
