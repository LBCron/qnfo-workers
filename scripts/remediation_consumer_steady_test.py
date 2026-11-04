#!/usr/bin/env python3
"""FM-5 offline test (2026-10-28, pillar cost, agent_issues 1000721): steady passing contracts back off to 2 hours.

Run: python3 scripts/remediation_consumer_steady_test.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("CLOUDFLARE_ACCOUNT_ID", "acct")
os.environ.setdefault("CLOUDFLARE_API_TOKEN", "tok")
os.environ.setdefault("CF_API_TOKEN", "tok")

import remediation_consumer as rc  # noqa: E402

fails = 0


def check(cond, msg, extra=None):
    global fails
    if cond:
        print("ok   " + msg)
    else:
        fails += 1
        print("FAIL " + msg + ("" if extra is None else " -- " + repr(extra)))


def with_rows(rows):
    rc.d1 = lambda sql, params=None: rows


same = [{"pass": 1, "observed": "0"}] * rc.STEADY_RUN
with_rows(same)
check(rc.steady_state_cadence("issue-1", "pass", 1) == rc.STEADY_CADENCE_H, "six identical passes back off")
check(rc.steady_state_cadence("issue-1", "pass", 1, "runner-https") == 1, "runtime checks retain their hourly cadence")
check(rc.steady_state_cadence("fm-some-detector", "pass", 1) == 1,
      "FM-CADENCE-1: a failure-mode detector never backs off (v_failure_mode_status calls it unprobed after 60 minutes)")
check(rc.steady_state_cadence("belief-some-probe", "pass", 1) == 1, "FM-CADENCE-1: a belief probe never backs off")
check(rc.standing_detector("fm-x") and rc.standing_detector("belief-x") and not rc.standing_detector("issue-1")
      and not rc.standing_detector("goal-x") and not rc.standing_detector(None),
      "FM-CADENCE-1: only the fm- and belief- prefixes are standing detectors")
check(rc.next_due_offset(1) == "+22 minutes", "FM-CADENCE-1: an un-backed-off hourly detector is due again in 22 minutes, inside the 60-minute window",
      rc.next_due_offset(1))
check(rc.steady_state_cadence("issue-1", "fail", 1) == 1, "a failing verdict keeps its cadence")
check(rc.steady_state_cadence("issue-1", "deferred", 1) == 1, "a deferred verdict keeps its cadence")
with_rows(same[:-1])
check(rc.steady_state_cadence("issue-1", "pass", 1) == 1, "fewer than the run length keeps the cadence")
with_rows(same[:-1] + [{"pass": 1, "observed": "1"}])
check(rc.steady_state_cadence("issue-1", "pass", 1) == 1, "a changed observed value keeps the cadence")
with_rows(same[:-1] + [{"pass": 0, "observed": "0"}])
check(rc.steady_state_cadence("issue-1", "pass", 1) == 1, "a failure inside the run keeps the cadence")
with_rows(same)
check(rc.steady_state_cadence("issue-1", "pass", 3) == 3, "a contract already slower than the ceiling is not sped up")
check(rc.STEADY_CADENCE_H * 60 <= 120, "the back-off never exceeds 120 minutes (SLA-120M-1)")
check(rc.next_due_offset(rc.STEADY_CADENCE_H) == "+52 minutes", "the backed-off contract is due again in 52 minutes", rc.next_due_offset(rc.STEADY_CADENCE_H))
check(rc.next_due_offset(rc.STEADY_CADENCE_H, steady_state=True) == "+105 minutes",
      "stable checks use the full two-hour ceiling instead of running every hourly consumer tick",
      rc.next_due_offset(rc.STEADY_CADENCE_H, steady_state=True))
check(rc.RT_HOLD_CADENCE_H == 1, "held runtime checks are reverified hourly")


def scheduled_row(contract, runtime=False):
    writes = []
    original_d1, original_https = rc.d1, rc.consume_https

    def fake_d1(sql, params=None):
        if "SELECT pass, observed" in sql:
            return same
        if sql.startswith("SELECT 'ok'"):
            return [{"expected": "ok", "observed": "ok"}]
        if sql.startswith("UPDATE remediation_contracts SET attempts"):
            writes.append(params)
        return []

    def fake_https(c, rec, out, trusted):
        rec.update({"expected": "ok", "observed": "ok", "verdict": "pass"})
        out["pass"] += 1
        return "holding", rc.RT_HOLD_CADENCE_H

    try:
        rc.d1 = fake_d1
        if runtime:
            rc.consume_https = fake_https
        rc.consume_one(contract, {"d1-query", "runner-https"})
    finally:
        rc.d1, rc.consume_https = original_d1, original_https
    return writes[0] if writes else []


non_runtime = scheduled_row({
    "class": "issue-2", "verify_transport": "d1-query", "verify_probe": "SELECT 'ok' AS expected, 'ok' AS observed",
    "expected_cadence_h": 1})
check(len(non_runtime) > 1 and non_runtime[1] == "+105 minutes",
      "consumer schedules stable non-runtime checks at the full back-off interval", non_runtime)
runtime = scheduled_row({
    "class": "issue-3", "verify_transport": "runner-https", "expected_cadence_h": 1}, runtime=True)
check(len(runtime) > 2 and runtime[1] == "+22 minutes" and runtime[2] == "holding",
      "consumer keeps passing runtime probes hourly", runtime)

print("all passed" if not fails else "%d failed" % fails)
sys.exit(1 if fails else 0)
