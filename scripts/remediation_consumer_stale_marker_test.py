#!/usr/bin/env python3
"""STALE-MARKER-HINT-1 offline test (2026-11-04, pillar autonomy; agent_issues 7040).

A standing liveness contract whose observation is missing-marker answered with the expected status and lacks only the marker text: on a page
that was redesigned that is a stale marker, not an outage (rt-page-qwav-home and rt-page-fleet-queue, 2026-11-04). The RUNTIME-PROBE-FAIL-1 text
for it must tell the doer to fetch the URL and repoint the marker by migration; every other observation keeps the old text, and the status
check is never to be relaxed.

Run: python3 scripts/remediation_consumer_stale_marker_test.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
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


probe = '{"url": "https://qwav.org/", "status": 200, "contains": "QWAV Research Papers", "max_ms": 10000}'
miss = rc.probe_fail_description("rt-page-qwav-home", 3, "missing-marker", probe)
check("STALE-MARKER-HINT-1" in miss and "repoint the marker" in miss and "Never relax the status check" in miss,
      "missing-marker text tells the doer to fetch the page and repoint the marker", miss[-200:])
check("2026-11-04-17-page-liveness-markers.sql" in miss, "the text names the migration pattern to copy")
check("rt-page-qwav-home" in miss and "failed 3 times in a row" in miss and "latest observation missing-marker" in miss and probe[:40] in miss,
      "the text keeps the class, the count, the observation and the probe")
for obs in ("status=503", "error:URLError", "slow=12000ms", "present-marker", "no-version"):
    t = rc.probe_fail_description("rt-live-x", 3, obs, probe)
    check("STALE-MARKER-HINT-1" not in t and "latest observation " + obs in t, "observation %s keeps the old text without the hint" % obs)

# the filing path uses the helper and files exactly that text
filed = []


def fake_d1(sql, params=None):
    if sql.startswith("INSERT INTO agent_issues"):
        filed.append(params)
        return [{"id": 99}]
    if "FROM v_remediation_evidence_all" in sql:
        return [{"n": 3, "t": None}]
    return []


orig = rc.d1
rc.d1 = fake_d1
try:
    out = {}
    res = rc.https_after_verdict({"class": "rt-page-qwav-home", "module": rc.LIVENESS_MODULE, "expected_cadence_h": 1, "max_attempts": 3, "verify_probe": probe}, 0, "missing-marker", out)
finally:
    rc.d1 = orig
check(res == ("active", 1) and out.get("filed") == [99], "a third straight failure files one issue and keeps the contract active", (res, out))
check(len(filed) == 1 and filed[0][0] == "RUNTIME-PROBE-FAIL-1: rt-page-qwav-home" and "STALE-MARKER-HINT-1" in filed[0][1],
      "the filed issue carries the hint", filed[:1])

print("stale-marker: %d failed" % fails)
sys.exit(1 if fails else 0)
