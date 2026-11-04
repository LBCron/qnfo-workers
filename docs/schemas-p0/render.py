#!/usr/bin/env python3
"""QNFO codeparse renderer - deterministic markdown from manifests (mode_B, D4 round-trip).

PRECONDITION: manifests are envelope artifacts; runbook + gate-manifest kinds supported.
POSTCONDITION: writes <name>.md next to each input; --parity verifies every step id renders back.
INVARIANT: pure function of input; same manifest -> same markdown.
"""
import json
import sys
import argparse


def render_runbook(payload):
    out = ["# " + payload.get("title", "Runbook"), ""]
    for s in payload.get("steps", []):
        out.append("## " + s["id"] + " " + s.get("what", ""))
        if s.get("why"):
            out.append("- WHY: " + s["why"])
        if s.get("scope"):
            out.append("- SCOPE: " + s["scope"])
        if s.get("connector"):
            out.append("- CONNECTOR: " + s["connector"])
        for sub in s.get("substeps", []):
            out.append("  - " + sub["id"] + " " + sub.get("what", ""))
        out.append("")
    out.append(payload.get("prose", ""))
    out.append("")
    return "\n".join(out)


def render_gate_manifest(payload):
    out = ["# Gate manifest", ""]
    for g in payload.get("gates", []):
        out.append("- [" + g.get("status", "active").upper() + "] " + g["id"] + " v" + str(g.get("version", "1.0")) + ": " + g.get("description", ""))
    out.append("")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description="QNFO codeparse renderer (mode_B)")
    ap.add_argument("files", nargs="*")
    ap.add_argument("--parity", action="store_true", help="verify every step id appears in the render")
    args = ap.parse_args()
    bad = 0
    for f in args.files:
        with open(f, "r", encoding="utf-8") as fh:
            d = json.load(fh)
        kind = d.get("kind")
        payload = d.get("payload", {})
        if kind == "runbook":
            md = render_runbook(payload)
        elif kind == "gate-manifest":
            md = render_gate_manifest(payload)
        else:
            print("SKIP " + f + " (kind=" + str(kind) + ")"); continue
        ok = True
        if args.parity and kind == "runbook":
            ids = [s["id"] for s in payload.get("steps", [])]
            if len(ids) != md.count("\n## "):
                ok = False
                print("PARITY FAIL " + f + ": step count mismatch (" + str(len(ids)) + " vs " + str(md.count("\n## ")) + ")")
            for i in ids:
                if ("## " + i + " ") not in md:
                    ok = False
                    print("PARITY FAIL " + f + ": step " + i + " missing from render")
        outpath = f.rsplit(".", 1)[0] + ".md"
        with open(outpath, "w", encoding="utf-8") as fh:
            fh.write(md)
        print(("RENDER " if ok else "RENDER-FAIL ") + f + " -> " + outpath)
        if not ok:
            bad += 1
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
