# -*- coding: utf-8 -*-
"""
report-card-autonomy.py - L3 pilot: kill-switch-gated auto-regenerate + auto-commit + auto-push.

PRECONDITION: qnfo-audit.pipeline_flags has key 'report_card_autonomy' in {'off','on'}.
  'off' (DEFAULT, fail-safe) = regenerate the card only; NO git commit/push.
  'on'                       = regenerate + git add + commit + push (extended autonomy).
ROLLBACK: the auto-commit is one deterministic commit; undo with: git revert <sha>.
INVARIANT: the flag is read from the registry (D1) every run, so the kill-switch can be
flipped remotely (cloud or host) without editing this script.
"""
import os, sys, json, subprocess, urllib.request, datetime

ACCOUNT = "edb167b78c9fb901ea5bca3ce58ccc4b"
DB = "35e2e573-92f3-46ac-83c6-22f6429fc5e5"
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)


def load_token():
    tok = os.environ.get("CLOUDFLARE_API_TOKEN") or os.environ.get("CF_API_TOKEN")
    if tok:
        return tok
    envf = os.path.expanduser("~/.env")
    if os.path.exists(envf):
        for line in open(envf, encoding="utf-8"):
            line = line.strip()
            if line.startswith("CLOUDFLARE_API_TOKEN="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def read_flag():
    tok = load_token()
    if not tok:
        return None  # fail-safe: no token -> treat as OFF (generate-only)
    url = "https://api.cloudflare.com/client/v4/accounts/" + ACCOUNT + "/d1/database/" + DB + "/query"
    body = json.dumps({"sql": "SELECT value FROM pipeline_flags WHERE key = 'report_card_autonomy'", "params": []}).encode()
    req = urllib.request.Request(url, data=body, headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        d = json.loads(resp.read().decode())
    rows = ((d.get("result") or [{}])[0].get("results")) or []
    return rows[0]["value"] if rows else None


def git(cmd):
    return subprocess.run(["git", "-C", REPO] + cmd, capture_output=True, text=True)


def main():
    flag = read_flag()
    print("kill-switch flag:", flag)
    gen = subprocess.run([sys.executable, os.path.join(HERE, "fleet-report-card.py")], capture_output=True, text=True)
    first = gen.stdout.strip().splitlines()[0] if gen.stdout.strip() else "(generator silent)"
    print("generator:", first)
    if flag != "on":
        print("KILL-SWITCH OFF: regenerated, NOT committed/pushed. Flip pipeline_flags.report_card_autonomy='on' to enable auto-commit.")
        return 0
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    msg = "report-card: auto-regenerated SAI at " + now + " (L3 pilot, kill-switch on)"
    a = git(["add", "docs/FLEET-REPORT-CARD.md", "docs/fleet-report-card-history.json"])
    c = git(["commit", "-m", msg])
    if c.returncode != 0 and "nothing to commit" not in (c.stdout + c.stderr):
        print("COMMIT FAILED:", (c.stderr or c.stdout).strip())
        return 1
    if "nothing to commit" in (c.stdout + c.stderr):
        print("AUTO-COMMIT: no change to commit (idempotent) - nothing pushed.")
        return 0
    p = git(["push", "origin", "main"])
    tail = (p.stdout + p.stderr).strip().splitlines()
    print("push:", tail[-1] if tail else "(empty)")
    print("AUTO-COMMITTED:", msg)
    return 0 if p.returncode == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
