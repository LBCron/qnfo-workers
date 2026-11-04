#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""adversarial-guard.py - permanent guard enforcing ADVERSARIAL-REASONING-1 across agent surfaces.

Read-only. Exit 0 = all core surfaces carry the adversarial-reasoning block; 1 = violations.
Canonical: QNFO/qnfo-ops/scripts/adversarial-guard.py (mirror at .deepchat/scripts).
"""
import os, sys, json, glob, re

SKILLS_ROOT = r"C:/Users/LENOVO/Documents/GitHub/qnfo-skills"
TEMPLATES = os.path.join(SKILLS_ROOT, "prompt-stores", "customPrompts.json")
SYSPROMPT = r"C:/Users/LENOVO/.deepchat/system-prompt-v2.7.md"
WORKERS_ROOT = r"C:/Users/LENOVO/Documents/GitHub/qnfo-workers"
SKILL_MARKER = "## Adversarial reasoning (ADVERSARIAL-REASONING-1)"
TEMPLATE_MARKER = "- ADVERSARIAL:"
SYS_MARKER = "ADVERSARIAL-REASONING-1"
CORE_WORKERS = ["qnfo-ai", "qnfo-ops", "personal-api", "agent-orchestrator",
                "qnfo-ipatent", "qnfo-intent-orchestrator"]

violations = []
def check(ok, label):
    print(("PASS " if ok else "FAIL ") + label)
    if not ok:
        violations.append(label)

skill_md = glob.glob(os.path.join(SKILLS_ROOT, "*", "SKILL.md"))
missing = [p for p in skill_md if SKILL_MARKER not in open(p, encoding="utf-8").read()]
check(not missing, f"skills: {len(skill_md)} SKILL.md, {len(missing)} missing ADVERSARIAL section"
      + ("" if not missing else " -> " + ", ".join(os.path.basename(os.path.dirname(p)) for p in missing[:8])))

tpl = json.load(open(TEMPLATES, encoding="utf-8"))
tmiss = [e.get("name") for e in tpl if TEMPLATE_MARKER not in (e.get("content") or "")]
check(not tmiss, f"templates: {len(tpl)} entries, {len(tmiss)} missing ADVERSARIAL line"
      + ("" if not tmiss else " -> " + ", ".join(tmiss)))

DOD_MARKER = "- DOD-AUDIT:"
dodmiss = [e.get("name") for e in tpl if DOD_MARKER not in (e.get("content") or "")]
check(not dodmiss, f"templates: {len(tpl)} entries, {len(dodmiss)} missing DOD-AUDIT (Definition-of-Done audit) line"
      + ("" if not dodmiss else " -> " + ", ".join(dodmiss)))

# NO-LOCAL-SKILLS-1 (2026-09-28): the client loads NO skills (enableSkills:false); no CMD
# template may mandate a skill (skill_list/skill_view). Codifies the deprecation.
SKILL_MANDATE = ("skill_list", "skill_view")
smiss = [e.get("name") for e in tpl
         if any(m in ((e.get("content") or "") + "\n" + (e.get("template") or "")) for m in SKILL_MANDATE)]
check(not smiss, f"templates: {len(tpl)} entries, {len(smiss)} mandate a local skill (NO-LOCAL-SKILLS-1)"
      + ("" if not smiss else " -> " + ", ".join(smiss)))

PLAN_MARKER = "update_plan"
planmiss = [e.get("name") for e in tpl if PLAN_MARKER not in (e.get("content") or "")]
check(not planmiss, f"templates: {len(tpl)} entries, {len(planmiss)} missing update_plan requirement"
      + ("" if not planmiss else " -> " + ", ".join(planmiss)))

DEPLOY_MARKER = "SERVER-SIDE-DEPLOY-1"
dep_entries = [e for e in tpl if (e.get("name") or "") == "CMD DEPLOY"]
DEPLOY_OK = bool(dep_entries) and all(DEPLOY_MARKER in (e.get("content") or "") and "/ops/deploy" in (e.get("content") or "") for e in dep_entries)
check(DEPLOY_OK, "templates: CMD DEPLOY carries SERVER-SIDE-DEPLOY-1 (server-side deploy route) + /ops/deploy")
check(SYS_MARKER in open(SYSPROMPT, encoding="utf-8").read(), "system prompt carries ADVERSARIAL-REASONING-1")

def worker_artifact(w):
    """Resolve the file that actually carries a worker prompt.

    Prefer <w>/worker.js. Some workers keep only a REDACTION PLACEHOLDER there and ship
    the real bundle as <w>/deployed-current.worker.js. Canonical: personal-api/worker.js
    is 33 bytes containing <REDACTED - commit via ops agent>, while the live 175503-byte
    bundle is personal-api/deployed-current.worker.js (VERSION 4.1.9-toolmode) and DOES
    carry ADVERSARIAL-REASONING-1. Reading the placeholder produced a FALSE violation on
    2026-09-24, which forced prompt-store-verify.py to exit 1 and blocked a closeout.
    Falling back to the deployed artifact tests the code that is actually running.
    """
    p = os.path.join(WORKERS_ROOT, w, "worker.js")
    try:
        sz = os.path.getsize(p)
        with open(p, "rb") as f:
            head = f.read(300)
        if sz >= 512 and b"REDACTED" not in head:
            return p
    except OSError:
        return p
    alt = os.path.join(WORKERS_ROOT, w, "deployed-current.worker.js")
    return alt if os.path.isfile(alt) else p


for w in CORE_WORKERS:
    p = worker_artifact(w)
    ok = os.path.exists(p) and SYS_MARKER in open(p, encoding="utf-8").read()
    check(ok, f"worker {w} carries ADVERSARIAL-REASONING-1")

if "--workers" in sys.argv:
    print("\n== full worker sweep ==")
    workers = sorted(os.path.basename(os.path.dirname(p))
                     for p in glob.glob(os.path.join(WORKERS_ROOT, "*", "worker.js")))
    for w in workers:
        p = worker_artifact(w)
        s = open(p, encoding="utf-8").read()
        has_surface = (bool(re.search(r'role\s*:\s*["\x27]system', s)) or 'SYSTEM_PROMPT' in s
                       or 'DEFAULT_SYSTEM_PROMPT' in s or 'OPS_SYSTEM_PROMPT' in s or 'systemPrompt' in s)
        if not has_surface:
            continue
        status = "PASS" if SYS_MARKER in s else "GAP "
        print(f"  {status} {w}")

print()
if violations:
    print(f"RESULT: {len(violations)} violation(s)")
    sys.exit(1)
print("RESULT: all core adversarial-reasoning surfaces pass")
sys.exit(0)
