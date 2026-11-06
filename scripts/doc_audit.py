#!/usr/bin/env python3
"""DOC-IS-CODE-1: list docs/*.md that no code, test, migration or workflow references.
A doc counts as operationalized when its path/stem or one of its rule ids (UPPER-CASE-WORDS-N)
appears in a non-doc source file. Output: JSON lines, orphans first. Exit 1 with --strict when orphans exist."""
import re, subprocess, sys, json, os
root = subprocess.check_output(["git","rev-parse","--show-toplevel"], text=True).strip()
files = subprocess.check_output(["git","ls-files"], cwd=root, text=True).split("\n")
docs = [f for f in files if f.startswith("docs/") and f.endswith(".md")]
SRC = re.compile(r"\.(js|mjs|py|sql|ya?ml|toml|json|sh)$")
src = [f for f in files if SRC.search(f) and not f.endswith("agent-catalog.json")]
blob = {}
for f in src:
    try:
        if os.path.getsize(os.path.join(root, f)) < 3_000_000: blob[f] = open(os.path.join(root, f), errors="ignore").read()
    except OSError: pass
allsrc = "\n".join(blob.values())
ID = re.compile(r"\b[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)*-\d+\b")
out = []
for d in docs:
    text = open(os.path.join(root, d), errors="ignore").read()
    stem = os.path.basename(d)
    ids = sorted(set(ID.findall(text)))
    hit_path = stem in allsrc or d in allsrc
    hit_ids = [i for i in ids if i in allsrc]
    out.append({"doc": d, "rule_ids": len(ids), "ids_in_code": len(hit_ids), "path_in_code": hit_path,
                "orphan": not hit_path and not hit_ids})
out.sort(key=lambda r: (not r["orphan"], -r["rule_ids"]))
for r in out: print(json.dumps(r))
orph = [r for r in out if r["orphan"]]
print(json.dumps({"summary": {"docs": len(out), "orphans": len(orph)}}), file=sys.stderr)
sys.exit(1 if orph and "--strict" in sys.argv else 0)
