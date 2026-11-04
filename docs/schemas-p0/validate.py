#!/usr/bin/env python3
"""QNFO codeparse validator - deterministic JSON Schema validation for code-parsable artifacts.

PRECONDITION: python3 + jsonschema>=4; schemas/ directory sibling of this script.
POSTCONDITION: prints PASS/FAIL per file; exit 0 iff every file passes.
INVARIANT: no network, no randomness; same input -> same output (D2).
"""
import json
import os
import sys
import argparse
import jsonschema
from jsonschema import Draft7Validator

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMAS = os.path.join(HERE, "schemas")


def load_schema(name):
    with open(os.path.join(SCHEMAS, name + ".json"), "r", encoding="utf-8") as f:
        return json.load(f)


ENVELOPE = load_schema("envelope")


def validate_file(path):
    with open(path, "r", encoding="utf-8") as f:
        art = json.load(f)
    try:
        jsonschema.validate(art, ENVELOPE, cls=Draft7Validator)
    except jsonschema.ValidationError as e:
        return False, "envelope: " + str(e.message)[:200]
    kind = art.get("kind", "")
    kpath = os.path.join(SCHEMAS, kind + ".json")
    if os.path.exists(kpath):
        ks = load_schema(kind)
        try:
            jsonschema.validate(art.get("payload", {}), ks, cls=Draft7Validator)
        except jsonschema.ValidationError as e:
            return False, "payload[" + kind + "]: " + str(e.message)[:200]
        return True, "envelope ok + payload[" + kind + "] ok"
    return True, "envelope ok (no kind schema; envelope-only)"


def main():
    ap = argparse.ArgumentParser(description="QNFO codeparse validator")
    ap.add_argument("files", nargs="*")
    ap.add_argument("--dir", default=None, help="validate every *.json in this repo-relative dir")
    ap.add_argument("--gate-manifest", action="store_true", help="also validate gates/bootstrap-manifest.json")
    args = ap.parse_args()
    files = list(args.files)
    if args.gate_manifest:
        files.append(os.path.join(HERE, "gates", "bootstrap-manifest.json"))
    if args.dir:
        d = os.path.join(HERE, args.dir)
        for fn in sorted(os.listdir(d)):
            if fn.endswith(".json"):
                files.append(os.path.join(d, fn))
    if not files:
        ap.print_help()
        return 2
    fail = 0
    for f in files:
        if not os.path.exists(f):
            print("MISSING " + f)
            fail += 1
            continue
        ok, msg = validate_file(f)
        print(("PASS " if ok else "FAIL ") + os.path.relpath(f, HERE) + " :: " + msg)
        if not ok:
            fail += 1
    print("RESULT: " + ("PASS" if fail == 0 else "FAIL " + str(fail)))
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
