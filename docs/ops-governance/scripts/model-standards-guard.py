#!/usr/bin/env python3
"""MODEL-STANDARDS-GUARD-1: catalog floors 32K output / 128K ctx.
PRECONDITION: qnfo-workers clone with qnfo-ai/worker.js (path arg overrides).
POSTCONDITION: exit 0 iff every non-exempt MODELS entry has maxOut >= 32768
and ctx >= 128000, and DEFAULT_MAX_OUT >= 32768. Exemptions = platform-native caps
(registry: docs/MODEL-STANDARDS-GATE.md section 4)."""
import re, sys

EXEMPT = {
    "qwq-32b": (24000, 16384), "qwen3-30b": (32768, 16384),
    "qwen2.5-coder-32b": (32768, 16384), "deepseek-r1-qwen-32b": (80000, 32768),
    "llama-3.2-11b-vision": (128000, 4096), "bge-base-en-v1.5": (None, None),
}
FLOOR_OUT, FLOOR_CTX = 32768, 128000
DEFAULT_PATH = "C:/Users/LENOVO/Dev/qnfo-workers/qnfo-ai/worker.js"
# Internal worker model constants (COMPLETENESS check): id -> exempt bool.
# Non-exempt ids must appear in the worker's MAX_OUT table with cap >= 32768.
INTERNAL_MODELS = {
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast": True,   # fleet-advisor ADVISOR_MODEL; WA ctx 24000 (catalog 2026-09-08)
    "@cf/openai/gpt-oss-120b": False,                   # fleet-advisor REVIEW_MODEL / personal-api reason path
    "@cf/deepseek-ai/deepseek-v4-flash-0731": False,    # paper-reviser + qnfo-social compose
    "@cf/zai-org/glm-5.3-flash": False,                 # qnfo-kaizen
}
PERSONAL_PATH = "C:/Users/LENOVO/Dev/qnfo-workers/personal-api/worker.js"

def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PATH
    src = open(path, encoding="utf-8", errors="replace").read()
    dmo = re.search(r"var DEFAULT_MAX_OUT = (\d+)", src)
    if not dmo:
        print("FAIL: DEFAULT_MAX_OUT not found"); return 1
    default = int(dmo.group(1))
    problems, seen = [], 0
    for m in re.finditer(r'"([A-Za-z0-9.\-]+)":\s*\{\s*([^}]*)\}', src):
        name, body = m.group(1), m.group(2)
        if "tier:" not in body and "family:" not in body:
            continue
        mo = re.search(r"maxOut:\s*(\d+)", body)
        cx = re.search(r"ctx:\s*(\d+)", body)
        if not mo or not cx:
            continue
        seen += 1
        out, ctx = int(mo.group(1)), int(cx.group(1))
        if name in EXEMPT:
            continue  # platform-native cap, registered with evidence
        if out < FLOOR_OUT or ctx < FLOOR_CTX:
            problems.append(name + ": maxOut=" + str(out) + " ctx=" + str(ctx))
    if default < FLOOR_OUT:
        problems.append("DEFAULT_MAX_OUT=" + str(default))
    maxOutTbl = {}
    for m in re.finditer(r'"(@cf/[^"]+)":\s*(\d+)', src):
        maxOutTbl[m.group(1)] = int(m.group(2))
    for mid, exempt in INTERNAL_MODELS.items():
        if exempt:
            continue
        cap = maxOutTbl.get(mid)
        if cap is None:
            problems.append("internal " + mid + " missing from MAX_OUT table")
        elif cap < FLOOR_OUT:
            problems.append("internal " + mid + " MAX_OUT=" + str(cap))
    try:
        psrc = open(PERSONAL_PATH, encoding="utf-8", errors="replace").read()
        for capname in ("MAX_OUT_CAP", "REASON_OUT_CAP"):
            cm = re.search(r"var " + capname + r" = (\d+(?:\.\d+)?(?:e\d+)?)", psrc)
            if not cm:
                problems.append("personal-api " + capname + " not found")
            elif float(cm.group(1)) < FLOOR_OUT:
                problems.append("personal-api " + capname + "=" + cm.group(1))
    except OSError:
        problems.append("personal-api worker.js not readable")
    if problems:
        print("FAIL:", "; ".join(problems)); return 1
    print("PASS: %d catalog models checked, %d exempted, %d internal checked, personal-api ok, DEFAULT_MAX_OUT=%d" % (seen, len(EXEMPT), len(INTERNAL_MODELS), default))
    return 0

if __name__ == "__main__":
    sys.exit(main())
