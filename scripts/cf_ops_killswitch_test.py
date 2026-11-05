#!/usr/bin/env python3
"""Offline tests for kill-switch-drill in cf_ops_actions.py (BP26-LEASES-KILLSWITCH-1; BP26-KILLSWITCH-READERS-1 adds the event-observed readers).
Run: python3 scripts/cf_ops_killswitch_test.py"""
import contextlib
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cf_ops_actions as C

passed = failed = 0


def ok(c, label):
    global passed, failed
    if c:
        passed += 1
    else:
        failed += 1
        print("FAIL", label)


EVENT_READERS = [r for r in C.KS_READERS if r in C.KS_EVENT_READERS]


def world(honours_switch=True, observes=None, live_lock=False, restore_fails=False, quiet=True, alive=None, reobserves=None, observe_after=None):
    """observes / alive / reobserves: reader -> bool (default: every reader behaves). observe_after: reader -> number of polls before its event shows."""
    observes = {r: True for r in EVENT_READERS} | (observes or {})
    alive = {r: True for r in EVENT_READERS} | (alive or {})
    reobserves = reobserves or {}
    observe_after = observe_after or {}
    guard_observes = observes.get("qnfo-deploy-guard", True)
    st = {"flag": "off", "ledger": None, "writes": [], "polls": {}, "queries": []}

    def db(sql, params=None):
        st["queries"].append(sql)
        if "FROM deploy_locks" in sql:
            return True, [{"n": 1 if live_lock else 0}]
        if "SELECT value FROM ops_config" in sql:
            return True, [{"value": st["flag"]}]
        if "INSERT INTO ops_config" in sql:
            val = "on" if "'on'" in sql else (params or ["off"])[0]
            if val != "on" and restore_fails:
                return False, ["boom"]
            st["flag"] = val
            st["writes"].append(val)
            return True, []
        if "FROM cloud_ops_events" in sql and "kind = 'kill-switch.observed'" in sql and "job = 'qnfo-deploy-guard'" in sql:
            return True, [{"n": 1 if guard_observes else 0}]
        if "FROM cloud_ops_events" in sql and "kind = 'kill-switch.observed'" in sql and "ts >=" in sql:
            job = params[0]
            st["polls"][job] = st["polls"].get(job, 0) + 1
            return True, [{"n": 1 if observes.get(job) and st["polls"][job] > observe_after.get(job, 0) else 0}]
        if "FROM cloud_ops_events" in sql and "kind = 'kill-switch.observed'" in sql and "ts >" in sql:
            return True, [{"n": 1 if reobserves.get(params[0]) else 0}]
        if "FROM cloud_ops_events" in sql and "kind LIKE" in sql:
            return True, [{"n": 0 if quiet else 3}]
        if "FROM fleet_heartbeat" in sql:
            return True, [{"n": 1 if alive.get("qnfo-code-orchestrator") else 0}]
        if "FROM cron_fire_log" in sql:
            return True, [{"n": 1 if alive.get("qnfo-github-steward") else 0}]
        if "INSERT INTO kill_switch_tests" in sql:
            st["ledger"] = params
            return True, []
        return True, []

    def guard(path, body=None, timeout=30):
        on = st["flag"] == "on" and honours_switch
        if path.endswith("/release"):
            return 200, {"released": True}
        if on:
            return 503, {"acquired": False, "reason": "kill-switch"}
        return 200, {"acquired": True, "token": "tkn"}
    return st, db, guard


def run(**kw):
    st, db, guard = world(**kw)
    buf = io.StringIO()
    sleeps = []
    with contextlib.redirect_stdout(buf):
        rc = C.kill_switch_drill("a", "t", guard=guard, db=db, sleep=lambda s: sleeps.append(s))
    st["sleeps"] = sleeps
    return rc, st, buf.getvalue()


N = len(C.KS_READERS)
ok(N == 3 and set(EVENT_READERS) == {"qnfo-code-orchestrator", "qnfo-github-steward"} and set(C.KS_PENDING).isdisjoint(C.KS_READERS), "readers: deploy-guard plus two event-observed readers, none also pending: %r" % (C.KS_READERS,))
ok(all(C.KS_EVENT_READERS[r]["wait_s"] <= 420 for r in C.KS_EVENT_READERS), "no event reader waits longer than 7 minutes (the switch stays on under 10 minutes)")

rc, st, out = run()
ok(rc == 0 and st["ledger"][3] == "pass" and st["ledger"][1] == N and st["ledger"][2] == N, "good path: pass row with %d of %d stopped and resumed: %r" % (N, N, st["ledger"]))
ok(st["flag"] == "off" and st["writes"] == ["on", "off"], "the switch ends off: %r" % st["writes"])
ok(st["ledger"][4].count('"qnfo-github-steward"') >= 2 and "readers_pending" in st["ledger"][4], "the evidence names the readers and the pending list")

# the switch stays on for less than max_on_sec in the worst case: 35 s + the longest poll
worst = 35 + max(v["wait_s"] for v in C.KS_EVENT_READERS.values())
ok(worst <= 600, "worst-case time on is %d s, inside 600" % worst)

# a slow 5-minute reader: its event shows after 12 polls (120 s); the drill waits for it and passes
rc, st, out = run(observe_after={"qnfo-github-steward": 12})
ok(rc == 0 and st["ledger"][3] == "pass" and sum(1 for s in st["sleeps"] if s == 10) >= 12, "a reader whose event arrives after 120 s is waited for: %r" % (st["ledger"],))

rc, st, out = run(honours_switch=False)
ok(rc == 1 and st["ledger"][3] == "fail" and st["flag"] == "off", "a reader that ignores the switch fails the drill and the switch is still restored")
rc, st, out = run(observes={"qnfo-deploy-guard": False})
ok(rc == 1 and st["ledger"][3] == "fail", "no observed event from the guard fails the drill")
rc, st, out = run(observes={"qnfo-github-steward": False})
ok(rc == 1 and st["ledger"][3] == "fail" and st["ledger"][2] == N - 1 and st["ledger"][1] == N - 1, "no observed event from the steward fails the drill and leaves it unresumed: %r" % (st["ledger"],))
ok(sum(1 for s in st["sleeps"] if s == 10) >= 42, "and the drill waited the whole 420 s for it before giving up")
rc, st, out = run(observes={"qnfo-code-orchestrator": False})
ok(rc == 1 and st["ledger"][3] == "fail", "no observed event from the code loop fails the drill")
rc, st, out = run(quiet=False)
ok(rc == 1 and st["ledger"][3] == "fail" and st["ledger"][1] == N - 1, "a code loop that keeps writing work events while the switch is on is not stopped: %r" % (st["ledger"],))
rc, st, out = run(alive={"qnfo-code-orchestrator": False})
ok(rc == 1 and st["ledger"][3] == "fail" and st["ledger"][1] == N and st["ledger"][2] == N - 1, "a code loop that does not run again after the switch goes off is not resumed: %r" % (st["ledger"],))
rc, st, out = run(reobserves={"qnfo-github-steward": True})
ok(rc == 1 and st["ledger"][3] == "fail" and st["ledger"][2] == N - 1, "a reader that still reports the switch after it went off is not resumed: %r" % (st["ledger"],))
rc, st, out = run(live_lock=True)
ok(rc == 1 and st["ledger"] is None and not st["writes"], "a live deploy lock refuses the drill before touching the flag")
rc, st, out = run(restore_fails=True)
ok(rc == 1 and st["ledger"][3] == "fail", "a failed restore write is a fail")

# the alive queries compare to the right unit: the steward's cron_fire_log is in epoch ms, the code loop's heartbeat in ISO text
seen = {}
st, db, guard = world()
orig = db
def spy(sql, params=None):
    if "FROM cron_fire_log" in sql:
        seen["ms"] = params[0]
    if "FROM fleet_heartbeat" in sql:
        seen["iso"] = params[0]
    return orig(sql, params)
with contextlib.redirect_stdout(io.StringIO()):
    C.kill_switch_drill("a", "t", guard=guard, db=spy, sleep=lambda s: None)
ok(isinstance(seen.get("ms"), int) and seen["ms"] > 1_700_000_000_000 and isinstance(seen.get("iso"), str) and seen["iso"].endswith("Z"), "alive arguments: epoch ms for cron_fire_log, ISO text for fleet_heartbeat: %r" % (seen,))
print("%d passed, %d failed" % (passed, failed))
sys.exit(1 if failed else 0)
