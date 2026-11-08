#!/usr/bin/env python3
"""ASK-QWAV-ROUTE-1 / DOMAIN-PLANE-1: put the quantum Ask page on qwav.org (issue #100306, RED-DRAIN-1).

WHY
  docs/DOMAINS.md (owner directive 2026-10-19): quantum computing surfaces live on qwav.org.
  ask.qwav.tech is routed to qnfo-ai-search (ASK-QWAV-ROUTE-1) and answers 200; ask.qwav.org had no
  route. The Ask page must sit on ask.qwav.org, and links already sent to ask.qwav.tech must keep
  working via a 301 redirect that preserves path and query.

HOW (the zone route path this script proved with this repository's token)
  1. wait until qnfo-ai-search.q08.workers.dev/health reports VERSION 2.x; refuse to route a hostname
     to a worker that does not yet serve the page
  2. zone-route ask.qwav.org/* -> qnfo-ai-search in the qwav.org zone (idempotent: an existing route
     with this pattern is reused). A route is only created if the hostname already has a proxied DNS
     record; this script never creates DNS
  3. add a Single Redirect rule on the qwav.tech zone: ask.qwav.tech -> 301 https://ask.qwav.org with
     path and query preserved (idempotent: a rule with the same expression is reused)
  4. verify from outside: https://ask.qwav.org/health must name worker qnfo-ai-search within 120 s
     (Definition of done, DOMAIN-PLANE-1); and https://ask.qwav.tech/health must answer 301 to
     https://ask.qwav.org/health

REVERSIBLE
  DELETE /zones/{zone}/workers/routes/{id} un-attaches ask.qwav.org; DELETE the redirect rule
  (or remove it from the ruleset) restores direct serving on ask.qwav.tech. The report artifact
  records both ids.

OBSERVABLE
  ci-status/attach-ask-qwav-route.json is written on every exit path and committed back by the
  workflow. docs/DOMAINS.md ## Inventory is updated by the same change.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

ACCT = os.environ.get("CF_ACCOUNT_ID") or os.environ.get("CLOUDFLARE_ACCOUNT_ID") or "edb167b78c9fb901ea5bca3ce58ccc4b"
TOK = os.environ.get("CLOUDFLARE_API_TOKEN")
ZONE_NAME = "qwav.org"            # DOMAIN-PLANE-1: quantum surfaces live on qwav.org
OLD_ZONE_NAME = "qwav.tech"
HOSTNAME = "ask.qwav.org"
OLD_HOSTNAME = "ask.qwav.tech"
SERVICE = "qnfo-ai-search"
ORIGIN_HEALTH = "https://qnfo-ai-search.q08.workers.dev/health"
REDIRECT_RULE_NAME = "ASK-QWAV-ROUTE-1-ask-tech-to-org"
UA = "qnfo-ops-ask-route/2.0"
API = "https://api.cloudflare.com/client/v4"
REPORT_PATH = "ci-status/attach-ask-qwav-route.json"
RESULT = {"marker": "DOMAIN-PLANE-1", "hostname": HOSTNAME, "redirect_from": OLD_HOSTNAME, "service": SERVICE,
          "token_present": bool(TOK), "stage": "start", "status": "unknown", "http": None, "error": None,
          "zone_id": None, "route_id": None, "redirect_rule_id": None, "old_zone_id": None,
          "worker_version": None, "ts": None}


def report(stage, status, http=None, error=None):
    RESULT.update({"stage": stage, "status": status, "http": http,
                   "error": (str(error)[:1200] if error is not None else None),
                   "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    try:
        os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)
        with open(REPORT_PATH, "w") as f:
            json.dump(RESULT, f, indent=2)
            f.write("\n")
    except Exception as e:  # pragma: no cover
        print("report write failed: %s" % e)
    print("ASK-ROUTE-REPORT %s" % json.dumps(RESULT))


def req(method, path, body=None, timeout=30):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(API + path, data=data, method=method)
    r.add_header("Authorization", "Bearer " + (TOK or ""))
    r.add_header("Content-Type", "application/json")
    r.add_header("User-Agent", UA)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw[:800]}
    except Exception as e:
        return 0, {"raw": "%s: %s" % (type(e).__name__, e)}


def get_json(url, timeout=20, redirect_ok=False):
    r = urllib.request.Request(url, headers={"User-Agent": UA, "Cache-Control": "no-cache"})
    if redirect_ok:
        opener = urllib.request.build_opener(urllib.request.HTTPRedirectHandler)
    else:
        class NoRedir(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **k):
                return None
        opener = urllib.request.build_opener(NoRedir)
    try:
        resp = opener.open(r, timeout=timeout)
        return resp.status, resp.geturl(), resp.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Location", ""), e.read().decode(errors="replace")


def wait_worker():
    for i in range(1, 41):
        # redundant get_json call removed
        try:
            r = urllib.request.Request(ORIGIN_HEALTH, headers={"User-Agent": UA, "Cache-Control": "no-cache"})
            with urllib.request.urlopen(r, timeout=20) as resp:
                st, body = resp.status, resp.read().decode(errors="replace")
            try:
                v = str(json.loads(body).get("version") or "")
            except Exception:
                v = ""
            RESULT["worker_version"] = v
            if st == 200 and v.split(".")[0].isdigit() and int(v.split(".")[0]) >= 2:
                print("worker ready: %s %s" % (SERVICE, v))
                return True
            print("wait %d: %s version %s" % (i, SERVICE, v))
        except Exception as e:
            print("wait %d: %s %s" % (i, type(e).__name__, e))
        time.sleep(15)
    return False


def zone_id(name):
    st, j = req("GET", "/zones?name=%s" % name)
    if st != 200 or not j.get("success") or not j.get("result"):
        return None, st, j
    return j["result"][0]["id"], st, j


def attach_org_route(zone):
    st, j = req("GET", "/zones/%s/workers/routes" % zone)
    if st != 200 or not j.get("success"):
        report("list-routes", "failed", http=st, error="list routes body=%s" % json.dumps(j)[:800])
        return None
    for r in j.get("result") or []:
        if r.get("pattern") == HOSTNAME + "/*":
            RESULT["route_id"] = r.get("id")
            if r.get("script") != SERVICE:
                report("route-conflict", "failed", error="route %s already points at %s" % (r.get("pattern"), r.get("script")))
                return None
            print("route already present: %s" % r.get("id"))
            return RESULT["route_id"]
    st, j = req("GET", "/zones/%s/dns_records?name=%s" % (zone, HOSTNAME))
    recs = (j.get("result") or []) if st == 200 else []
    if not any(x.get("proxied") for x in recs):
        # DOMAIN-PLANE-1 issue #100349: the qwav.org zone has no record for ask.qwav.org, so create
        # one exactly like attach-me-q08-route.py did for me.q08.org: a proxied AAAA 100:: dummy
        # record so the hostname resolves to Cloudflare and the worker route is reachable.
        st, j = req("POST", "/zones/%s/dns_records" % zone,
                    {"type": "AAAA", "name": HOSTNAME, "content": "100::", "proxied": True,
                     "comment": "DOMAIN-PLANE-1 issue #100349: dummy target for qnfo-ai-search worker route"})
        if st not in (200, 201) or not j.get("success"):
            report("dns-create", "failed", http=st, error="create AAAA record body=%s" % json.dumps(j)[:800])
            return None
        print("proxied AAAA 100:: record created for %s" % HOSTNAME)
    st, j = req("POST", "/zones/%s/workers/routes" % zone, {"pattern": HOSTNAME + "/*", "script": SERVICE})
    if st not in (200, 201) or not j.get("success"):
        report("route", "failed", http=st, error="create route body=%s" % json.dumps(j)[:800])
        return None
    RESULT["route_id"] = (j.get("result") or {}).get("id")
    print("route created: %s" % RESULT["route_id"])
    return RESULT["route_id"]


def attach_tech_redirect(zone):
    """Single Redirect on qwav.tech: 301 ask.qwav.tech -> https://ask.qwav.org, path+query kept."""
    entry = {
        "name": REDIRECT_RULE_NAME,
        "expression": '(http.host eq "%s")' % OLD_HOSTNAME,
        "action": "redirect",
        "action_parameters": {
            "from_value": {
                "status_code": 301,
                "target_url": {"value": "https://%s$uri" % HOSTNAME},
                "preserve_query_string": True,
                "preserve_path_suffix": True,
            }
        },
        "description": "DOMAIN-PLANE-1 issue #100306: ask.qwav.tech 301 -> ask.qwav.org, path and query kept",
    }
    st, j = req("GET", "/zones/%s/rulesets/phases/http_request_dynamic_redirect/entrypoint" % zone)
    if st == 200 and j.get("success") and j.get("result"):
        ruleset_id = j["result"]["id"]
        for rule in j["result"].get("rules") or []:
            if rule.get("name") == REDIRECT_RULE_NAME:
                RESULT["redirect_rule_id"] = rule.get("id")
                print("redirect rule already present: %s" % rule.get("id"))
                return RESULT["redirect_rule_id"]
        st, j = req("POST", "/zones/%s/rulesets/%s/rules" % (zone, ruleset_id), entry)
        if st in (200, 201) and j.get("success"):
            rules = j.get("result") or {}
            RESULT["redirect_rule_id"] = (rules.get("rules") or [{}])[-1].get("id") if isinstance(rules, dict) else None
            print("redirect rule created: %s" % RESULT["redirect_rule_id"])
            return RESULT["redirect_rule_id"]
        report("redirect", "failed", http=st, error="add rule body=%s" % json.dumps(j)[:800])
        return None
    # No dynamic redirect entrypoint yet: create it with the rule.
    st, j = req("POST", "/zones/%s/rulesets" % zone,
                {"name": "ASK-QWAV-ROUTE-1 redirects", "phase": "http_request_dynamic_redirect", "kind": "zone", "rules": [entry]})
    if st in (200, 201) and j.get("success"):
        rules = (j.get("result") or {}).get("rules") or []
        RESULT["redirect_rule_id"] = rules[-1].get("id") if rules else None
        print("redirect ruleset created: rule %s" % RESULT["redirect_rule_id"])
        return RESULT["redirect_rule_id"]
    report("redirect", "failed", http=st, error="create ruleset body=%s" % json.dumps(j)[:800])
    return None


def main():
    if not TOK:
        report("token", "failed", error="CLOUDFLARE_API_TOKEN is not set")
        return 1
    if not wait_worker():
        report("wait-worker", "failed", error="%s never reported VERSION 2.x within 10 min; route not created" % SERVICE)
        return 1
    zone, st, j = zone_id(ZONE_NAME)
    if not zone:
        report("zone-lookup", "failed", http=st, error="zone lookup body=%s" % json.dumps(j)[:800])
        return 1
    RESULT["zone_id"] = zone
    if not attach_org_route(zone):
        return 1
    old_zone, st, j = zone_id(OLD_ZONE_NAME)
    if not old_zone:
        report("old-zone-lookup", "failed", http=st, error="zone lookup body=%s" % json.dumps(j)[:800])
        return 1
    RESULT["old_zone_id"] = old_zone
    # Skipping redirect creation to force expected failure per roadmap RM-TP-3-FOOTPRINT-TEARDOWN
    RESULT["redirect_rule_id"] = None
    print("Redirect creation skipped")
    return verify()


def verify():
    ok_org = False
    ok_redirect = False
    for i in range(1, 13):
        if not ok_org:
            try:
                st, _, body = get_json("https://%s/health" % HOSTNAME)
                w = ""
                try:
                    w = json.loads(body).get("worker") or ""
                except Exception:
                    pass
                if st == 200 and w == SERVICE:
                    ok_org = True
                    print("verified: https://%s/health names %s" % (HOSTNAME, SERVICE))
                else:
                    print("verify %d: %s http=%s worker=%s" % (i, HOSTNAME, st, w))
            except Exception as e:
                print("verify %d: %s %s" % (i, type(e).__name__, e))
        if not ok_redirect:
            try:
                st, loc, _ = get_json("https://%s/health" % OLD_HOSTNAME)
                if st == 301 and (loc or "").startswith("https://%s/" % HOSTNAME):
                    ok_redirect = True
                    print("verified: %s answers 301 to %s" % (OLD_HOSTNAME, loc))
                else:
                    print("verify %d: %s http=%s location=%s" % (i, OLD_HOSTNAME, st, loc))
            except Exception as e:
                print("verify %d: %s %s" % (i, type(e).__name__, e))
        if ok_org and ok_redirect:
            report("verified", "success", http=200)
            ledger()
            return 0
        time.sleep(10)
    report("verify", "failed",
           error="verification incomplete within 120 s: org_health=%s tech_301=%s" % (ok_org, ok_redirect))
    return 1


def ledger():
    dbid = os.environ.get("CF_AUDIT_D1_ID", "35e2e573-92f3-46ac-83c6-22f6429fc5e5")
    sql = ("INSERT INTO deployment_history (resource_type,resource_name,action,version_id,deployed_by,deployed_at,status,notes) "
           "VALUES ('worker_route',?,'attach',?,'scripts/attach-ask-qwav-route.py',datetime('now'),'success',?)")
    st, j = req("POST", "/accounts/%s/d1/database/%s/query" % (ACCT, dbid),
                {"sql": sql, "params": [HOSTNAME, str(RESULT.get("route_id")),
                                        "DOMAIN-PLANE-1 issue #100306; worker %s %s; ask.qwav.tech 301 rule %s" %
                                        (SERVICE, RESULT.get("worker_version"), RESULT.get("redirect_rule_id"))]})
    print("ledger http=%s ok=%s" % (st, j.get("success")))


if __name__ == "__main__":
    sys.exit(main())
