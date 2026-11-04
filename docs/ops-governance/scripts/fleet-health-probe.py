#!/usr/bin/env python3
# fleet-health-probe.py - external /health prober for the QNFO fleet (device-bound).
# WHY device-bound: Workers in the account CANNOT fetch sibling *.q08.workers.dev URLs
# (same-account 404, SVC-BINDING-1). Truthful liveness must be probed from outside the account.
# Feeds qnfo-fleet-deploy POST /health-report which files fleet_improvements signals.
import json, sys, urllib.request, concurrent.futures, os

BASE = "https://qnfo-fleet-deploy.q08.workers.dev"
TOKEN_PATH = os.path.expanduser("~/tokens/fleet-deploy-admin-token.txt")
CF_API_TOKEN_PATH = os.path.expanduser("~/tokens/cloudflare")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

def probe(name):
    url = "https://{}.q08.workers.dev/health".format(name)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=12) as r:
            return {"worker": name, "status": r.status}
    except urllib.error.HTTPError as e:
        return {"worker": name, "status": e.code}
    except Exception as e:
        return {"worker": name, "status": 0}

def main():
    token = ""
    try:
        with open(TOKEN_PATH) as f:
            token = f.read().strip()
    except Exception:
        pass
    if not token:
        print("ERROR: no token at", TOKEN_PATH)
        sys.exit(2)
    # worker list from the CF API (account API token) or a static list fallback
    names = []
    cf_token = ""
    try:
        with open(CF_API_TOKEN_PATH) as f:
            cf_token = f.read().strip()
    except Exception:
        pass
    try:
        req = urllib.request.Request(
            "https://api.cloudflare.com/client/v4/accounts/edb167b78c9fb901ea5bca3ce58ccc4b/workers/scripts?per_page=100",
            headers={"Authorization": "Bearer " + cf_token})
        with urllib.request.urlopen(req, timeout=20) as r:
            names = [x["id"] for x in json.load(r)["result"]]
    except Exception as e:
        print("WARN: worker list fetch failed:", e)
    if not names:
        print("ERROR: no workers listed")
        sys.exit(3)
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
        results = list(ex.map(probe, names))
    healthy = [r for r in results if r["status"] == 200]
    rest = [r for r in results if r["status"] != 200]
    print("probed=%d healthy=%d other=%d" % (len(results), len(healthy), len(rest)))
    for r in rest:
        print("  %s -> %s" % (r["worker"], r["status"]))
    body = json.dumps({"probes": rest}).encode("utf-8")
    req = urllib.request.Request(BASE + "/health-report", data=body, method="POST",
                                 headers={"Authorization": "Bearer " + token,
                                          "Content-Type": "application/json",
                                          "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        resp = json.load(r)
    print("POST /health-report ->", json.dumps(resp)[:400])
    return 0

if __name__ == "__main__":
    sys.exit(main())
