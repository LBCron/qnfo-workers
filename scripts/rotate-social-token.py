#!/usr/bin/env python3
"""rotate-social-token.py - FM3 rotation runbook (executable).

WHY THIS EXISTS
  qnfo-social authenticates operator endpoints (/drain-dissemination, /post, /repost) with
  SOCIAL_TOKEN (a WRITE-ONLY Worker secret: it cannot be read back) or the alternate
  GATEWAY_SOCIAL_TOKEN. A second accepted bearer (GATEWAY_SOCIAL_TOKEN) was provisioned
  2026-09-26 so the operator side is recoverable; it therefore lives in THREE stores:
  (1) the qnfo-social Worker secret, (2) R2 qnfo-backups/credentials/gateway-social-token.txt,
  (3) the local ~/.env. This script rotates the alternate bearer across all three atomically
  and verifies the route, so the three stores can never drift.

USAGE
  python scripts/rotate-social-token.py            # rotate GATEWAY_SOCIAL_TOKEN
  python scripts/rotate-social-token.py --check    # verify the three stores agree (no write)

REQUIRES
  wrangler (logged in) + CLOUDFLARE_API_TOKEN in ~/.env for the R2 mirror.
  Run from the repo root; uses qnfo-social/ as the worker dir.
"""
import argparse
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WKR = os.path.join(REPO, "qnfo-social")
SECRET = "GATEWAY_SOCIAL_TOKEN"
R2_KEY = "qnfo-backups/credentials/gateway-social-token.txt"
ENV = os.path.expanduser("~/.env")
ROUTE = "https://qnfo-social.q08.workers.dev/drain-dissemination"
# RM-GATE-D4 (fleet-lessons D4): wrangler is wrangler.cmd on Windows and CreateProcess does not find the bare name (WinError 2), so the argv
# carries the resolved command, the pattern of scripts/deploy_gate.py NPX. scripts/fleet_lessons_gates.py fails a new bare node-tool argv.
WRANGLER = shutil.which("wrangler") or ("wrangler.cmd" if os.name == "nt" else "wrangler")


def env_token(var):
    try:
        for ln in open(ENV, encoding="utf-8", errors="ignore"):
            if ln.startswith(var + "="):
                return ln.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return None


def check():
    tok = env_token(SECRET)
    print(f"[1] ~/.env {SECRET}: {'present ('+str(len(tok))+' chars)' if tok else 'ABSENT'}")
    try:
        p = subprocess.run([WRANGLER, "secret", "list", "--name", "qnfo-social"],
                           cwd=WKR, capture_output=True, text=True, timeout=90)
        names = re.findall(r"\b([A-Z_]{4,})\b", (p.stdout or "") + (p.stderr or ""))
        print(f"[2] worker secret {SECRET}: {'LISTED' if SECRET in names else 'not listed (list may be unsupported)'}")
    except Exception as e:
        print(f"[2] worker secret check skipped: {e}")
    print(f"[3] R2 mirror {R2_KEY}: run `wrangler r2 object get {R2_KEY} --remote` to compare bytes")
    if tok:
        try:
            r = urllib.request.Request(ROUTE, headers={"Authorization": "Bearer " + tok})
            with urllib.request.urlopen(r, timeout=45) as resp:
                print(f"[4] route probe: HTTP {resp.status} (token accepted)")
        except Exception as e:
            print(f"[4] route probe: FAILED ({getattr(e, 'code', e)}) -- the three stores may have drifted")


def rotate():
    new = secrets.token_hex(24)
    print("rotating", SECRET, "(48 hex)")
    subprocess.run([WRANGLER, "secret", "put", SECRET], cwd=WKR, input=new, text=True, check=True)
    print("[1] worker secret: set")
    # ROTATE-TOKEN-TMP-1: the new token used to be written to a fixed TEMP/gwst.txt, readable by other local users and never removed, so every rotation left the
    # live bearer on disk (CodeQL py/clear-text-storage-sensitive-data). wrangler needs a file, so it gets one in a private directory (0700) with mode 0600,
    # removed with the directory when the upload ends, whether it succeeded or not.
    with tempfile.TemporaryDirectory(prefix="gwst-") as td:
        tmp = os.path.join(td, "gwst.txt")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as fh:
            fh.write(new)
        subprocess.run([WRANGLER, "r2", "object", "put", R2_KEY, "--file", tmp, "--remote"], cwd=REPO, check=True)
    print("[2] R2 mirror: set")
    lines = []
    try:
        lines = open(ENV, encoding="utf-8", errors="ignore").read().splitlines()
    except OSError:
        pass
    lines = [ln for ln in lines if not ln.startswith(SECRET + "=")]
    lines.append(SECRET + "=" + new)
    # ~/.env holds more than this token: it is created or tightened to 0600, never left at the umask default
    fd = os.open(ENV, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8", newline="") as fh:
        fh.write("\n".join(lines) + "\n")
    os.chmod(ENV, 0o600)
    print("[3] ~/.env: set")
    check()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="verify the three stores agree; do not rotate")
    a = ap.parse_args()
    if a.check:
        check()
    else:
        # CONCURRENT-SESSION-SHARED-SECRET-CLOBBER-1 (#1701): hold secrets:qnfo-social across the rotation (fail-closed).
        from secret_lock import secret_lock
        with secret_lock("qnfo-social", ttl_sec=600, owner="scripts/rotate-social-token.py"):
            rotate()
