#!/usr/bin/env python3
"""PUSH-GATE-1: run a worker's suites, the narrative guard and the mirror check; exit 1 on any failure.
Usage: python3 scripts/pre_push_check.py <worker> [--skip-guard]"""
import glob, os, subprocess, sys

def run(cmd, cwd):
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    return p.returncode, (p.stdout + p.stderr)

def main(argv):
    if not argv:
        print("usage: pre_push_check.py <worker> [--skip-guard]"); return 2
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    w = argv[0]; d = os.path.join(root, w)
    if not os.path.isdir(d):
        print("FAIL no such worker directory: " + w); return 2
    failed = []
    for t in sorted(glob.glob(os.path.join(d, "*.test.mjs"))):
        rc, out = run(["node", "--no-warnings", t], d)
        bad = [l for l in out.splitlines() if l.startswith("FAIL")]
        if rc != 0 or bad:
            failed.append(os.path.basename(t))
            print("FAIL " + os.path.basename(t) + " (exit " + str(rc) + ")")
            for l in bad[:5]: print("  " + l)
    a, b = os.path.join(d, "worker.js"), os.path.join(d, "deployed-current.worker.js")
    if os.path.exists(a) and os.path.exists(b) and open(a, "rb").read() != open(b, "rb").read():
        failed.append("mirror"); print("FAIL deployed-current.worker.js differs from worker.js")
    if "--skip-guard" not in argv:
        rc, out = run(["python3", os.path.join(root, "scripts", "narrative-prompt-guard.py")], root)
        if rc != 0:
            failed.append("narrative-prompt-guard"); print("FAIL narrative-prompt-guard\n" + out[-400:])
    print("pre_push_check: " + ("FAILED " + ", ".join(failed) if failed else "ok"))
    return 1 if failed else 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
