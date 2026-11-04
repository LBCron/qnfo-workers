#!/usr/bin/env python3
"""deploy_guard.py - client for qnfo-deploy-guard (distributed deploy lock + concurrent-mutation detector).

WHY: multiple DeepChat sessions share one Cloudflare API token, so deploys race last-write-wins.
This wrapper makes every deploy fail-closed unless it holds the lock, and records it in the ledger.

Usage:
  python deploy_guard.py acquire <worker> [ttl_sec] [expected_version]
  python deploy_guard.py release <worker> <token>
  python deploy_guard.py with-lock <worker> <from_ver> <to_ver> -- <command> [args...]
  python deploy_guard.py scan | report | locks

Owner id defaults to deepchat/<hostname>-<pid>; session id via DEPLOY_GUARD_SESSION env (optional).
with-lock sends expected_version=<from_ver> so the guard rejects a deploy that assumes a stale current version.
Exit codes: 0 ok | 2 lock held by another owner (fail-closed) | 3 transport/other error
"""
import json, os, socket, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get("DEPLOY_GUARD_URL", "https://qnfo-deploy-guard.q08.workers.dev")
OWNER = os.environ.get("DEPLOY_GUARD_OWNER") or ("deepchat/" + socket.gethostname() + "-" + str(os.getpid()))
SESSION = os.environ.get("DEPLOY_GUARD_SESSION") or None


def call(method, path, body=None, timeout=30):
    url = BASE.rstrip("/") + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json", "User-Agent": "qnfo-deploy-guard-client/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {"error": "http_" + str(e.code)}
    except Exception as e:
        return 0, {"error": str(e)}


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 3
    cmd = argv[1]

    if cmd == "acquire":
        if len(argv) < 3:
            print("usage: acquire <worker> [ttl_sec] [expected_version]"); return 3
        w = argv[2]; ttl = int(argv[3]) if len(argv) > 3 else 900
        ev = argv[4] if len(argv) > 4 else None
        st, j = call("POST", "/lock/acquire", {"worker": w, "owner": OWNER, "actor": OWNER, "session_id": SESSION, "ttl_sec": ttl, "expected_version": ev})
        print(json.dumps(j))
        if st == 200:
            print("LOCK_TOKEN=" + str(j.get("token", "")))
            return 0
        return 2 if st == 409 else 3

    if cmd == "release":
        if len(argv) < 4:
            print("usage: release <worker> <token>"); return 3
        st, j = call("POST", "/lock/release", {"worker": argv[2], "token": argv[3]})
        print(json.dumps(j)); return 0 if st == 200 or j.get("released") else 3

    if cmd == "with-lock":
        if "--" not in argv or len(argv) < 5:
            print("usage: with-lock <worker> <from_ver> <to_ver> -- <command> [args...]"); return 3
        sep = argv.index("--")
        w = argv[2]; frm = argv[3]; to = argv[4]
        runcmd = argv[sep + 1:]
        st, j = call("POST", "/lock/acquire", {"worker": w, "owner": OWNER, "actor": OWNER, "session_id": SESSION, "ttl_sec": 1800, "expected_version": frm})
        if st != 200 or not j.get("acquired"):
            print("DEPLOY-GUARD: REFUSED (fail-closed). " + json.dumps(j)); return 2
        token = j.get("token")
        try:
            rc = subprocess.call(runcmd)
        finally:
            call("POST", "/ledger", {"worker": w, "actor": OWNER, "session_id": SESSION, "from": frm, "to": to,
                                     "ok": rc == 0 if 'rc' in dir() else False,
                                     "note": "with-lock: " + " ".join(runcmd)[:300]})
            call("POST", "/lock/release", {"worker": w, "token": token})
        return 0 if rc == 0 else 3

    if cmd == "scan":
        st, j = call("GET", "/scan", timeout=90); print(json.dumps(j, indent=1)); return 0
    if cmd == "report":
        st, j = call("GET", "/report"); print(json.dumps(j, indent=1)); return 0
    if cmd == "locks":
        st, j = call("GET", "/locks"); print(json.dumps(j, indent=1)); return 0

    print(__doc__); return 3


if __name__ == "__main__":
    sys.exit(main(sys.argv))
