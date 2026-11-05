#!/usr/bin/env python3
"""Offline tests for the read-only gateway-routes action (AUTOROUTER-EVAL-1).
Run: python3 scripts/cf_ops_gateway_routes_test.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cf_ops_actions as C  # noqa: E402

passed = failed = 0


def ok(cond, label, extra=None):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print("FAIL " + label + ("" if extra is None else " :: " + str(extra)[:300]))


emitted = []
C.emit = emitted.append
seen = []
resp = {}


def fake_call(method, path, token, body=None, timeout=60):
    seen.append((method, path))
    if resp.get("seq"):
        return resp["seq"].pop(0)
    return resp["v"]


C.call = fake_call

resp["v"] = (200, {"success": True, "result": [
    {"id": "r1", "name": "Auto Router"}, {"id": "r2", "name": "cheap-first", "type": "dynamic"},
    {"id": "r3", "name": "x", "type": "auto"}]})
rc = C.gateway_routes("acct", "tok", "default")
o = emitted[-1]
ok(rc == 0 and o["ok"] and o["count"] == 3, "lists three routes", o)
ok(o["auto_router_count"] == 2 and [r["auto_router"] for r in o["routes"]] == [True, False, True], "flags auto routers", o)
ok(seen[-1] == ("GET", "/accounts/acct/ai-gateway/gateways/default/routes"), "read-only GET on the gateway routes path", seen)

resp["v"] = (200, {"success": True, "result": {"routes": [{"id": "a", "name": "n"}]}})
rc = C.gateway_routes("acct", "tok", "gw one")
ok(rc == 0 and emitted[-1]["count"] == 1 and seen[-1][1].endswith("/gateways/gw%20one/routes"), "dict result and quoted gateway id", seen[-1])

resp["v"] = (403, {"success": False, "errors": [{"code": 10000, "message": "Authentication error"}]})
rc = C.gateway_routes("acct", "tok")
o = emitted[-1]
ok(rc == 1 and not o["ok"] and o["http"] == 403 and "Authentication error" in o["error"], "refusal reports status and error text", o)

resp["v"] = (404, {})
rc = C.gateway_routes("acct", "tok")
ok(rc == 1 and emitted[-1]["http"] == 404 and emitted[-1]["error"], "empty error body still reports", emitted[-1])

# the live shape (read 2026-11-05 from the account: routes premium, standard and value on gateway default, no Auto Router): the list is in data.routes, not in result
LIVE = {"success": True, "data": {"routes": [
    {"id": "2d2ec79a", "name": "premium", "gateway_id": "default", "modified_at": "2026-10-31 16:02:03",
     "version": {"version_id": "477a77cc", "active": True}, "deployment": {"deployment_id": "2c5fc436", "version_id": "477a77cc"}},
    {"id": "6d8e4025", "name": "standard", "gateway_id": "default", "modified_at": "2026-10-31 16:02:02",
     "version": {"version_id": "a5a1282a", "active": True}, "deployment": {"deployment_id": "0cb4c95b", "version_id": "a5a1282a"}},
    {"id": "f88ab0b1", "name": "value", "gateway_id": "default", "modified_at": "2026-10-31 16:02:01",
     "version": {"version_id": "511122f2", "active": False}, "deployment": {}}],
    "page": 1, "per_page": 20, "order_by": "created_at", "order_by_direction": "desc"}}
resp.pop("seq", None)
resp["v"] = (200, LIVE)
rc = C.gateway_routes("acct", "tok", "default")
o = emitted[-1]
ok(rc == 0 and o["ok"] and o["count"] == 3 and o["auto_router_count"] == 0, "live shape: three dynamic routes, no Auto Router (a silent empty list would read as 'none configured')", o)
ok([r["name"] for r in o["routes"]] == ["premium", "standard", "value"] and o["routes"][0]["active_version"] == "477a77cc" and o["routes"][0]["deployed"] is True, "live shape: names, active version and deployment flag", o["routes"])
ok(o["routes"][2]["active_version"] is None and o["routes"][2]["deployed"] is False, "an inactive undeployed route says so", o["routes"][2])
ok(len(seen) >= 1 and seen[-1][1] == "/accounts/acct/ai-gateway/gateways/default/routes", "a short page is one read", seen[-3:])

# paging: a full page asks for the next one, a short page stops
page1 = {"success": True, "data": {"routes": [{"id": "a", "name": "one"}, {"id": "b", "name": "two"}], "page": 1, "per_page": 2}}
page2 = {"success": True, "data": {"routes": [{"id": "c", "name": "auto-router"}], "page": 2, "per_page": 2}}
before = len(seen)
resp["seq"] = [(200, page1), (200, page2)]
rc = C.gateway_routes("acct", "tok", "default")
o = emitted[-1]
ok(rc == 0 and o["count"] == 3 and o["auto_router_count"] == 1, "two pages are listed together", o)
ok([p for _m, p in seen[before:]] == ["/accounts/acct/ai-gateway/gateways/default/routes", "/accounts/acct/ai-gateway/gateways/default/routes?page=2"], "page 2 is requested with ?page=2", seen[before:])
resp.pop("seq", None)

# an empty data.routes is a measured zero, an HTTP refusal on a later page is reported with its page
resp["v"] = (200, {"success": True, "data": {"routes": [], "page": 1, "per_page": 20}})
rc = C.gateway_routes("acct", "tok", "qnfo-ai")
ok(rc == 0 and emitted[-1]["ok"] and emitted[-1]["count"] == 0 and emitted[-1]["routes"] == [], "empty data.routes is a measured zero", emitted[-1])
resp["seq"] = [(200, page1), (403, {"success": False, "errors": [{"message": "forbidden"}]})]
rc = C.gateway_routes("acct", "tok", "default")
ok(rc == 1 and emitted[-1]["page"] == 2 and emitted[-1]["http"] == 403, "a refusal on page 2 names the page", emitted[-1])
resp.pop("seq", None)

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
