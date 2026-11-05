#!/usr/bin/env python3
"""PROBE-TRANSIENT-1 offline test (2026-11-05, pillar autonomy; metric contracts_unexecutable_open).

On 2026-11-04 the runner wrote last_verdict = 'probe-error' (a refusal verdict the close triggers read, counted by contracts_unexecutable_open) every time the platform
refused a read: 184 events on 171 contracts were "HTTP 429 from api.cloudflare.com". A refused read says nothing about the probe. Runs the real consume_one against a fake
d1 that raises the platform errors and proves: a 429 / overload leaves a real pass or fail verdict alone, takes no attempt and files no error event; the streak marker
'transient:d1:<n>' counts consecutive refusals and the fifth becomes a real probe-error with its event; a real SQL error (HTTP 400) and an HTTP 500 are still probe-errors.

Run: python3 scripts/remediation_consumer_transient_test.py
"""
import os
import sqlite3
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


db = sqlite3.connect(":memory:")
db.row_factory = sqlite3.Row
db.execute("CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, status TEXT, attempts INTEGER, last_attempt_at TEXT, last_verdict TEXT, next_due_at TEXT)")
db.execute("CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, job TEXT, status TEXT)")
state = {"err": None}


def fake_d1(sql, params=None):
    s = " ".join(sql.split())
    if s.startswith("SELECT 'a'"):
        raise RuntimeError(state["err"])
    cur = db.execute(s.replace("?", "?"), params or [])
    db.commit()
    return [dict(r) for r in cur.fetchall()] if s.upper().startswith("SELECT") else []


rc.d1 = fake_d1


def run(err, last_verdict, status="active", attempts=3):
    state["err"] = err
    db.execute("DELETE FROM remediation_contracts")
    db.execute("DELETE FROM cloud_ops_events")
    db.execute("INSERT INTO remediation_contracts VALUES ('issue-9', ?, ?, NULL, ?, '2026-01-01 00:00:00')", [status, attempts, last_verdict])
    c = {"class": "issue-9", "issue_id": 9, "verify_probe": "SELECT 'a' AS expected, 'a' AS observed", "verify_transport": "d1-query", "expected_cadence_h": 1,
         "last_verdict": last_verdict, "attempts": attempts, "max_attempts": 3, "module": None, "budget_ms": None, "max_items": None}
    rec, local = rc.consume_one(c, {"d1-query"})
    row = dict(db.execute("SELECT * FROM remediation_contracts WHERE class = 'issue-9'").fetchone())
    events = db.execute("SELECT COUNT(*) FROM cloud_ops_events WHERE kind = 'remediation.probe-error'").fetchone()[0]
    return rec, row, events


R429 = "HTTP 429 from https://api.cloudflare.com/client/v4/accounts/x/d1/database/y/query: rate limited"
ROVER = "d1 error: [{\"code\": 7500, \"message\": \"D1 DB is overloaded. Too many resources consumed within a 10 second window\"}]"

check(rc.transient_error(R429) and rc.transient_error(ROVER) and rc.transient_error("HTTP 503 from x") and rc.transient_error("Network connection lost"), "429, overload, 503 and a lost connection are transient")
check(not rc.transient_error("HTTP 400 from x: no such column: foo") and not rc.transient_error("HTTP 500 from x: boom") and not rc.transient_error(""), "a SQL error, a plain 500 and an empty message are not")
check(rc.transient_streak("transient:d1:3") == 3 and rc.transient_streak("pass") == 0 and rc.transient_streak(None) == 0, "the streak reads from the marker")

rec, row, ev = run(R429, None)
check(rec["verdict"] == "transient:d1:1" and row["last_verdict"] == "transient:d1:1", "the first 429 on an unjudged contract takes the streak marker", (rec["verdict"], row))
check(row["attempts"] == 3 and ev == 0, "no attempt is taken and no error event is filed", (row["attempts"], ev))
check(row["next_due_at"] != "2026-01-01 00:00:00" and row["next_due_at"] is not None, "it is re-armed to retry soon", row["next_due_at"])

rec, row, ev = run(ROVER, "pass")
check(row["last_verdict"] == "pass" and rec["verdict"].startswith("transient:"), "a real pass is never overwritten by the marker", row["last_verdict"])
rec, row, ev = run(R429, "fail")
check(row["last_verdict"] == "fail", "a real fail stays too", row["last_verdict"])
rec, row, ev = run(R429, "probe-error")
check(row["last_verdict"] == "transient:d1:1", "a standing probe-error is replaced by the marker (the refusal was the platform, not the probe)", row["last_verdict"])

rec, row, ev = run(R429, "transient:d1:3")
check(row["last_verdict"] == "transient:d1:4" and ev == 0, "the streak counts up", row)
rec, row, ev = run(R429, "transient:d1:4")
check(rec["verdict"] == "probe-error" and row["last_verdict"] == "probe-error" and ev == 1 and row["attempts"] == 4, "the fifth refusal in a row is a real probe-error with its event and an attempt", (rec["verdict"], row, ev))

rec, row, ev = run("HTTP 400 from https://api.cloudflare.com/x: no such column: foo", None)
check(rec["verdict"] == "probe-error" and ev == 1, "a real SQL error is still a probe-error", (rec["verdict"], ev))
rec, row, ev = run("HTTP 500 from https://api.cloudflare.com/x: boom", None)
check(rec["verdict"] == "probe-error" and ev == 1, "a plain HTTP 500 is still a probe-error", (rec["verdict"], ev))

rc.d1 = None
print("all passed" if not fails else "%d failed" % fails)
sys.exit(1 if fails else 0)
