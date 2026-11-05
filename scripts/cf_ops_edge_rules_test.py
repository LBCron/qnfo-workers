#!/usr/bin/env python3
"""EDGE-RULES-1 / SECRETS-INVENTORY-1 / OBS-SAMPLING-1 offline suite for scripts/cf_ops_actions.py (RM-WAF-RATE-LIMIT-1, RM-SECRETS-STORE-1,
RM-TAIL-WORKERS-1).

Drives edge_rules(), secrets_inventory() and obs_sampling() against a fake Cloudflare API (recorded calls) and a fake prober. Proves: dry mode
writes nothing; live mode backs up each phase before its PUT, keeps a rule it did not write (first), appends the marked rules, and probes the
hosts that must keep answering; a second run writes nothing; a host that turns 429 restores the backup; revert removes only the marked rules;
a zone or mode outside the allowlist is refused; every rule is Free-plan shaped (one rate-limiting rule per zone, 10 s period, block) and
carries the marker; the inventory reports names, ages and store bindings and never an id or a comment; obs-sampling raises only the sampling
rate, sends the traces block back unchanged, and refuses a worker outside OBS_SAMPLING_TARGETS.
Run: python3 scripts/cf_ops_edge_rules_test.py   -> prints "N passed, 0 failed"
"""
import importlib.util
import json
import os
import pathlib
import sys
import tempfile

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


class Fake:
    def __init__(self, before=None, statuses=None):
        self.before = before or {}
        self.statuses = statuses or {}
        self.calls = []
        self.emitted = []
        self.put_status = 200
        self.put_refused_phases = set()

    def call(self, method, path, token, body=None, timeout=60):
        self.calls.append((method, path, body))
        if "/rulesets/phases/" in path:
            phase = path.split("/phases/")[1].split("/")[0]
            if method == "GET":
                if phase not in self.before:
                    return 404, {"errors": [{"code": 10000, "message": "no entrypoint"}]}
                return 200, {"result": {"rules": self.before[phase]}}
            if method == "PUT":
                if self.put_status != 200 or phase in self.put_refused_phases:
                    return self.put_status, {"success": False, "errors": [{"code": 20217, "message": "refused"}]}
                self.before[phase] = body["rules"]
                return 200, {"success": True, "result": {"rules": body["rules"]}}
        return 500, {"errors": [{"message": "unexpected " + method + " " + path}]}

    def fetch(self, url):
        return self.statuses.get(url, 200)


def run(fake, zones="", mode="live"):
    m.call = fake.call
    m.emit = lambda obj: fake.emitted.append(obj)
    m.zaraz_zones = lambda token, only="": [("z-qnfo", "qnfo.org"), ("z-q08", "q08.org"), ("z-qt", "qwav.tech")]
    return m.edge_rules(zones, mode, "tok", fetch=fake.fetch, sleep=lambda s: None)


FOREIGN = {"ref": "theirs", "action": "block", "expression": '(http.host eq "evil.example")', "description": "someone else's rule", "enabled": True}

# 1. every rule is Free-plan shaped and marked
for zone, plan in m.EDGE_ZONES.items():
    rl = plan.get(m.EDGE_RL) or []
    ok(len(rl) == 1, zone + ": exactly one rate-limiting rule (the Free plan allows one)", len(rl))
    for r in rl:
        rr = r["ratelimit"]
        ok(r["action"] == "block" and rr["period"] == 10 and rr["mitigation_timeout"] == 10 and rr["characteristics"] == ["cf.colo.id", "ip.src"] and 2 <= rr["requests_per_period"] <= 100,
           zone + ": block, 10 s period and timeout, address + data centre", rr)
    fw = plan.get(m.EDGE_FW) or []
    ok(len(fw) <= 5, zone + ": at most five custom rules (Free)", len(fw))
    for r in rl + fw:
        e = r["expression"]
        ok(m.EDGE_MARK in r["description"], zone + ": rule carries the marker", r["description"])
        ok(e.count("(") == e.count(")") and e.count("{") == e.count("}") and e.count('"') % 2 == 0, zone + ": expression is balanced", e)
        ok(" matches " not in e and "http.request.body" not in e and "cf.bot_management" not in e and "cf.threat_score" not in e,
           zone + ": expression uses only Free-plan fields and operators", e)
ok('not starts_with(http.request.uri.path, "/cdn-cgi/")' in m.EDGE_QNFO_RL, "the RUM beacon path is never counted")
ok("headers" not in m.EDGE_QNFO_RL and "ops.qnfo.org" not in m.EDGE_QNFO_RL and "ai.qnfo.org" not in m.EDGE_QNFO_RL, "no header field (not entitled on Free) and no keyed host (ops, ai) in the rate-limit expression")
ok("/.well-known" not in m.EDGE_QNFO_FW and "/api" not in m.EDGE_QNFO_FW, "the scanner rule names no route a fleet host serves")

# 2. dry mode: backup read, nothing written
f = Fake(before={m.EDGE_FW: [FOREIGN]})
rc = run(f, "qnfo.org", "dry")
ok(rc == 0 and not [c for c in f.calls if c[0] != "GET"], "dry writes nothing", f.calls)
ok(f.emitted[-1]["dry"] is True and f.emitted[-1]["changed"] is True, "dry reports a change is needed", f.emitted[-1])
rc = run(Fake(), "qnfo.org", "")
ok(rc == 0, "an empty mode is dry")

# 3. live: backup before PUT, the foreign rule stays first, ours appended with the rate limit block, hosts probed
f = Fake(before={m.EDGE_FW: [FOREIGN]})
rc = run(f, "qnfo.org", "live")
ok(rc == 0, "live returns 0", rc)
stages = [e.get("stage") for e in f.emitted]
ok(stages.index("backup") < stages.index("put"), "a backup is emitted before the first write", stages)
puts = {c[1].split("/phases/")[1].split("/")[0]: c[2]["rules"] for c in f.calls if c[0] == "PUT"}
ok(set(puts) == {m.EDGE_RL, m.EDGE_FW}, "both phases written", list(puts))
ok(puts[m.EDGE_FW][0] == FOREIGN and len(puts[m.EDGE_FW]) == 2 and m.EDGE_MARK in puts[m.EDGE_FW][1]["description"], "the foreign custom rule stays first and ours follows", puts[m.EDGE_FW])
ok(puts[m.EDGE_RL][0]["ratelimit"]["requests_per_period"] == 20 and "id" not in puts[m.EDGE_RL][0], "the rate-limiting rule is written without read-only fields", puts[m.EDGE_RL])
ver = [e for e in f.emitted if e.get("stage") == "verify"]
ok(ver and len(ver[0]["ok_hosts"]) == 5 and ver[0]["blocked_paths"][0]["url"].endswith("/.env"), "the hosts that must answer and the blocked path are probed", ver)

# 4. second run on the written state writes nothing
before_state = json.loads(json.dumps(f.before))
f2 = Fake(before=before_state)
rc = run(f2, "qnfo.org", "live")
ok(rc == 0 and not [c for c in f2.calls if c[0] == "PUT"], "a second live run writes nothing", f2.calls)

# 5. a host that turns 429 restores the backup of every written phase
f3 = Fake(before={m.EDGE_FW: [FOREIGN]}, statuses={"https://ideas.qnfo.org/": 429})
rc = run(f3, "qnfo.org", "live")
ok(rc == 1, "a 429 on a must-answer host fails the run", rc)
ok(f3.before[m.EDGE_FW] == [FOREIGN] and f3.before[m.EDGE_RL] == [], "both phases are back to their backups", f3.before)
ok(any(e.get("stage") == "restored" for e in f3.emitted), "the restore is reported")
f3b = Fake(statuses={"https://qnfo.org/": 403})
ok(run(f3b, "qnfo.org", "live") == 1 and f3b.before[m.EDGE_RL] == [], "a 403 also restores")

# 6. a refused PUT stops the zone, writes nothing else, returns 1
f4 = Fake()
f4.put_status = 403
rc = run(f4, "q08.org", "live")
ok(rc == 1 and len([c for c in f4.calls if c[0] == "PUT"]) == 1, "a refused PUT returns 1 after one attempt", f4.calls)
ok(f4.emitted[-1].get("http") == 403 and f4.emitted[-1].get("errors"), "the refusal text is in the report", f4.emitted[-1])

# 6b. a refused rate-limit PUT does not stop the custom-rule phase, and the run still fails
f4b = Fake()
f4b.put_refused_phases = {m.EDGE_RL}
rc = run(f4b, "qnfo.org", "live")
ok(rc == 1 and f4b.before.get(m.EDGE_FW) and m.EDGE_MARK in f4b.before[m.EDGE_FW][0]["description"] and m.EDGE_RL not in f4b.before, "the custom rule is written although the rate-limit PUT was refused, and the run returns 1", f4b.before)
ok(not any(e.get("stage") == "restored" for e in f4b.emitted), "a refused PUT of one phase restores nothing that was written")

# 7. revert removes only the marked rules
f5 = Fake(before={m.EDGE_FW: [FOREIGN]})
run(f5, "qnfo.org", "live")
rc = run(f5, "qnfo.org", "revert")
ok(rc == 0 and f5.before[m.EDGE_FW] == [FOREIGN] and f5.before[m.EDGE_RL] == [], "revert leaves the foreign rule and removes ours", f5.before)

# 8. allowlist
ok(run(Fake(), "example.com", "live") == 2, "a zone outside EDGE_ZONES is refused")
ok(run(Fake(), "qnfo.org", "yolo") == 2, "a mode outside dry|live|revert is refused")

# 9. secrets inventory: names, ages, store bindings; never an id or a comment
NOW = 1793836800  # 2026-11-05T00:00:00Z


class Inv:
    def __init__(self):
        self.emitted = []

    def call(self, method, path, token, body=None, timeout=60):
        if path.endswith("/workers/scripts"):
            return 200, {"result": [{"id": "alpha"}, {"id": "beta"}, {"id": "gamma"}, {"id": "delta"}]}
        if path.endswith("/secrets") and "/workers/scripts/" in path:
            w = path.split("/scripts/")[1].split("/")[0]
            names = {"alpha": ["ROUTER_AUTH_KEY", "CF_TOKEN"], "beta": ["ROUTER_AUTH_KEY"], "gamma": ["ROUTER_AUTH_KEY"], "delta": []}[w]
            return 200, {"result": [{"name": n, "type": "secret_text"} for n in names]}
        if path.endswith("/bindings"):
            w = path.split("/scripts/")[1].split("/")[0]
            return 200, {"result": [{"type": "secrets_store_secret", "name": "CF_TOKEN_STORE"}] if w == "alpha" else [{"type": "d1", "name": "AUDIT"}]}
        if "/versions" in path:
            w = path.split("/scripts/")[1].split("/")[0]
            created = {"alpha": "2026-07-04T22:43:05.441Z", "beta": "2026-11-01T10:00:00.000Z", "gamma": "2026-11-02T10:00:00.000Z"}[w]
            return 200, {"result": {"items": [{"annotations": {"workers/triggered_by": "upload"}, "metadata": {"created_on": "2026-11-04T00:00:00Z"}},
                                              {"annotations": {"workers/triggered_by": "secret"}, "metadata": {"created_on": created}}]}}
        if path.endswith("/secrets_store/stores"):
            return 200, {"result": [{"id": "STORE-ID-1", "name": "default_secrets_store"}]}
        if "/secrets_store/stores/" in path:
            return 200, {"result": [{"id": "SECRET-ID-1", "name": "CF_TOKEN", "scopes": ["workers"], "status": "active", "modified": "2026-07-04T23:15:48Z", "comment": "FULL-ACCESS token from a file"},
                                    {"id": "SECRET-ID-2", "name": "OTHER", "scopes": ["workers"], "status": "active", "modified": "2026-10-30T23:15:48Z", "comment": ""}]}
        return 500, {}


TMP = tempfile.mkdtemp()
for d, body in (("alpha", 'name = "alpha"\n[[secrets_store_secrets]]\nbinding = "CF_TOKEN_STORE"\nstore_id = "x"\nsecret_name = "CF_TOKEN"\n'),
                ("beta", 'name = "beta"\n[[secrets_store_secrets]]\nbinding = "NEVER_ARRIVED"\nstore_id = "x"\nsecret_name = "OTHER"\n\n[[d1_databases]]\nbinding = "AUDIT"\n'),
                ("gone", 'name = "gone"\n[[secrets_store_secrets]]\nbinding = "RETIRED_ONE"\nstore_id = "x"\nsecret_name = "OTHER"\n')):
    os.makedirs(os.path.join(TMP, d))
    open(os.path.join(TMP, d, "wrangler.toml"), "w", encoding="utf-8").write(body)
open(os.path.join(TMP, "gone", "RETIRED"), "w").write("x")
ok(m.declared_store_bindings(TMP) == [("alpha", "CF_TOKEN_STORE", "CF_TOKEN"), ("beta", "NEVER_ARRIVED", "OTHER")], "declared store bindings are read from wrangler.toml, a RETIRED directory is skipped", m.declared_store_bindings(TMP))

inv = Inv()
m.call = inv.call
m.emit = lambda obj: inv.emitted.append(obj)
rc = m.secrets_inventory("acct", "tok", now=NOW, root=TMP)
out = inv.emitted[-1]
blob = json.dumps(out)
ok(rc == 0 and out["workers"] == 4 and out["workers_with_secrets"] == 3 and out["secret_bindings_total"] == 4 and out["distinct_names"] == 2, "counts workers, workers with secrets, bindings and distinct names", out)
ok(out["shared_names_3plus_workers"] == {"ROUTER_AUTH_KEY": ["alpha", "beta", "gamma"]}, "a name on three workers is flagged as a rotation fan-out", out["shared_names_3plus_workers"])
ok(out["workers_stale"] == ["alpha"] and [w for w in out["per_worker"] if w["worker"] == "alpha"][0]["secret_age_days"] == 123, "only the worker whose newest secret change is over 90 days old is stale", out["per_worker"])
ok(out["store_bindings_live"] == ["CF_TOKEN_STORE"] and out["names_in_worker_and_store"] == ["CF_TOKEN"], "store bindings and names present in both places are listed", out)
ok(out["declared_store_bindings"] == 2 and out["declared_not_live"] == ["beta:NEVER_ARRIVED->OTHER"], "a declared store binding the live worker lacks is reported", out["declared_not_live"])
ok(out["store_entries_over_stale_days"] == ["CF_TOKEN"], "a store entry older than 90 days is listed", out["store_entries_over_stale_days"])
ok("STORE-ID-1" not in blob and "SECRET-ID-1" not in blob and "FULL-ACCESS" not in blob and "comment" not in blob, "no store or secret id and no comment reaches the public log")

# 10. obs-sampling
LIVE_OBS = {"enabled": True, "head_sampling_rate": 0.1, "redact_query_string": False,
            "logs": {"enabled": True, "head_sampling_rate": 0.1, "persist": True, "invocation_logs": True},
            "traces": {"enabled": False, "persist": True, "head_sampling_rate": 0.1}}


class Obs:
    def __init__(self, obs):
        self.obs = json.loads(json.dumps(obs))
        self.calls = []
        self.emitted = []

    def call(self, method, path, token, body=None, timeout=60):
        self.calls.append((method, path, body))
        if method == "GET":
            return 200, {"result": {"observability": self.obs}}
        if method == "PATCH":
            self.obs = body["observability"]
            return 200, {"success": True}
        return 500, {}


o = Obs(LIVE_OBS)
m.call = o.call
m.emit = lambda obj: o.emitted.append(obj)
rc = m.obs_sampling("q08-mind", "acct", "tok")
patch = [c for c in o.calls if c[0] == "PATCH"]
ok(rc == 0 and len(patch) == 1 and patch[0][1].endswith("/workers/scripts/q08-mind/script-settings"), "q08-mind: one PATCH to script-settings", o.calls)
sent = patch[0][2]["observability"]
ok(sent["logs"]["head_sampling_rate"] == 1 and sent["head_sampling_rate"] == 1 and sent["traces"] == LIVE_OBS["traces"] and sent["logs"]["persist"] is True, "only the sampling rate changes; traces are sent back unchanged", sent)
o2 = Obs(o.obs)
m.call = o2.call
m.emit = lambda obj: o2.emitted.append(obj)
ok(m.obs_sampling("q08-mind", "acct", "tok") == 0 and not [c for c in o2.calls if c[0] == "PATCH"], "already at 1: nothing is written")
o3 = Obs(LIVE_OBS)
m.call = o3.call
m.emit = lambda obj: o3.emitted.append(obj)
ok(m.obs_sampling("qnfo-ops", "acct", "tok") == 2 and not o3.calls, "a worker outside OBS_SAMPLING_TARGETS is refused before any call")

print("%d passed, %d failed" % (passed, failed))
sys.exit(1 if failed else 0)
