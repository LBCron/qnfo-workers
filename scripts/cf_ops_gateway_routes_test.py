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

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
