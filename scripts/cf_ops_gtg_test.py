#!/usr/bin/env python3
"""GTG-TAG-1 offline suite for scripts/cf_ops_actions.py gtg_tag() (BP26-NO-TRACKING-2: the qwav.tech zone's Google Tag Gateway injects the Google tag and its _ga cookies).

Drives gtg_tag() against a fake Cloudflare API. Proves: a zone outside GTG_ZONES is refused and nothing is called; read prints the config and writes nothing; off sends setUpTag false
with enabled, endpoint, hideOriginalIp and measurementId unchanged and reads the result back; a second off writes nothing; on restores setUpTag true; a refused PUT or a read-back
that does not show the change reports ok false; the config is never modified in any other field.
Run: python3 scripts/cf_ops_gtg_test.py   -> prints "N passed, 0 failed"
"""
import importlib.util
import io
import json
import pathlib
import contextlib

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("cf_ops_actions", HERE / "cf_ops_actions.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

passed = failed = 0


def ok(cond, msg, extra=None):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print("FAIL", msg, json.dumps(extra, default=str)[:500] if extra is not None else "")


CFG = {"enabled": True, "endpoint": "/dmzj", "hideOriginalIp": True, "measurementId": "G-TESTID0001", "setUpTag": True}


class Api:
    def __init__(self, cfg, put_status=200, apply_put=True):
        self.cfg, self.calls, self.put_status, self.apply_put = dict(cfg), [], put_status, apply_put

    def call(self, method, path, token, body=None, timeout=60):
        self.calls.append((method, path, body))
        if method == "GET":
            return 200, {"success": True, "result": dict(self.cfg)}
        if method == "PUT":
            if self.put_status == 200 and self.apply_put:
                self.cfg = dict(body)
            return self.put_status, {"success": self.put_status == 200, "errors": [] if self.put_status == 200 else [{"code": 9109, "message": "refused"}]}
        return 500, {}


def run(api, zone, mode):
    m.call = api.call
    m.zaraz_zones = lambda token, only="": [("zid1", zone)] if zone == "qwav.tech" else []
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = m.gtg_tag(zone, mode, "tok")
    line = [x for x in buf.getvalue().splitlines() if x.startswith("RESULT_JSON=")]
    return rc, (json.loads(line[-1][len("RESULT_JSON="):]) if line else {})


a = Api(CFG)
rc, out = run(a, "q08.org", "off")
ok(rc == 2 and not a.calls and out.get("ok") is False, "a zone outside the allowlist is refused before any API call", out)

a = Api(CFG)
rc, out = run(a, "qwav.tech", "read")
ok(rc == 0 and out.get("config") == CFG and [c[0] for c in a.calls] == ["GET"], "read prints the config and writes nothing", (rc, out, a.calls))

a = Api(CFG)
rc, out = run(a, "qwav.tech", "off")
puts = [c for c in a.calls if c[0] == "PUT"]
ok(rc == 0 and out.get("ok") is True and len(puts) == 1, "off writes once and verifies", (rc, out))
ok(puts and puts[0][2] == {"enabled": True, "endpoint": "/dmzj", "hideOriginalIp": True, "measurementId": "G-TESTID0001", "setUpTag": False}, "off changes only setUpTag", puts)
ok(a.calls[-1][0] == "GET" and out.get("after", {}).get("setUpTag") is False and out.get("before", {}).get("setUpTag") is True, "the result is read back and the previous config is printed for the revert", out)

rc, out = run(a, "qwav.tech", "off")
ok(rc == 0 and "already off" in out.get("note", "") and len([c for c in a.calls if c[0] == "PUT"]) == 1, "a second off writes nothing", out)

rc, out = run(a, "qwav.tech", "on")
ok(rc == 0 and out.get("ok") is True and a.cfg["setUpTag"] is True and a.cfg["endpoint"] == "/dmzj", "on restores setUpTag", (rc, out))

a = Api(CFG, put_status=403)
rc, out = run(a, "qwav.tech", "off")
ok(rc == 1 and out.get("ok") is False and out.get("stage") == "put" and a.cfg["setUpTag"] is True, "a refused PUT reports the refusal and leaves the config", out)

a = Api(CFG, apply_put=False)
rc, out = run(a, "qwav.tech", "off")
ok(rc == 1 and out.get("ok") is False, "a PUT the read-back does not show is not reported as done", out)

print("%d passed, %d failed" % (passed, failed))
raise SystemExit(1 if failed else 0)
