#!/usr/bin/env python3
"""TT-DRILL-RECUR-1 (2026-11-05, charter pillar autonomy; roadmap row 1704, RM-D1-RESTORE-DRILL-1): runs the D1 Time Travel restore drill when it is due.

The drill itself is scripts/cf_ops_actions.py d1_restore_drill (create a scratch database, write 3 rows, take a bookmark, write 2 more, restore to the bookmark,
expect exactly 3 rows, delete the scratch database, prove that qnfo-audit hands out a bookmark, write one row to qnfo-audit.d1_restore_drills). It ran once by hand on
2026-10-28 (pass) and nothing ran it again, so d1_restore_drill_age_days was a clock counting toward its 90-day trigger. This step makes the drill recur from the
remediation consumer's heavy job (every 3 hours, CF credentials already present): it runs the drill only when the newest passing row is older than MAX_AGE_DAYS (30),
and not again within RETRY_HOURS (6) of an attempt that did not pass, so a failing drill neither piles up scratch databases nor hammers the API. Never fails the job.

Offline suite: python3 scripts/d1_timetravel_drill_due.py --selftest
Usage:         python3 scripts/d1_timetravel_drill_due.py            (needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID)
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

MAX_AGE_DAYS = 30
RETRY_HOURS = 6
LAST = ("SELECT (SELECT CAST(julianday('now') - julianday(MAX(ts)) AS REAL) FROM d1_restore_drills WHERE outcome = 'pass') AS pass_age_days, "
        "(SELECT CAST((julianday('now') - julianday(MAX(ts))) * 24 AS REAL) FROM d1_restore_drills) AS last_attempt_hours")


def decide(row, max_age_days=MAX_AGE_DAYS, retry_hours=RETRY_HOURS):
    """(run, reason) from the ledger row: pass_age_days and last_attempt_hours (either may be None for an empty ledger)."""
    age = row.get("pass_age_days")
    since = row.get("last_attempt_hours")
    if age is not None and float(age) < max_age_days:
        return False, "not due: the newest passing drill is %.1f days old (limit %d)" % (float(age), max_age_days)
    if since is not None and float(since) < retry_hours:
        return False, "held: the last attempt was %.1f hours ago (retry after %d)" % (float(since), retry_hours)
    return True, "due: " + ("no passing drill on record" if age is None else "the newest passing drill is %.1f days old (limit %d)" % (float(age), max_age_days))


def main(argv, C=None, env=None):
    env = os.environ if env is None else env
    if C is None:
        import cf_ops_actions as C  # noqa: N812
    acct, token = env.get("CLOUDFLARE_ACCOUNT_ID") or env.get("CF_ACCOUNT_ID"), env.get("CLOUDFLARE_API_TOKEN")
    if not acct or not token:
        print("d1-timetravel-drill: no Cloudflare credential on this runner; nothing run")
        return 0
    ok, rows = C.d1x(acct, token, C.AUDIT_DB, LAST)
    if not ok:
        print("d1-timetravel-drill: ledger unreadable (%s); nothing run" % (rows[0] if rows else "?"))
        return 0
    run, reason = decide(rows[0] if rows else {})
    print("d1-timetravel-drill: " + reason)
    if not run:
        return 0
    rc = C.d1_restore_drill(acct, token)
    print("d1-timetravel-drill: drill finished with exit %d (the outcome is the newest d1_restore_drills row)" % rc)
    return 0


def selftest():
    fails = []

    def ok(cond, msg):
        if not cond:
            fails.append(msg)
            print("FAIL " + msg)
    ok(decide({"pass_age_days": None, "last_attempt_hours": None})[0], "an empty ledger is due")
    ok(not decide({"pass_age_days": 7.2, "last_attempt_hours": 7.2 * 24})[0], "a pass 7 days ago is not due")
    ok(decide({"pass_age_days": 31, "last_attempt_hours": 31 * 24})[0], "a pass 31 days ago is due")
    ok(decide({"pass_age_days": 29.9, "last_attempt_hours": 5})[0] is False, "a pass 29.9 days ago is not due")
    held = decide({"pass_age_days": 40, "last_attempt_hours": 2})
    ok(held[0] is False and held[1].startswith("held"), "an attempt 2 hours ago holds a due drill")
    ok(decide({"pass_age_days": 40, "last_attempt_hours": 7})[0], "an attempt 7 hours ago no longer holds it")
    ok(decide({"pass_age_days": None, "last_attempt_hours": 1})[0] is False, "a failed first attempt holds the retry too")

    class Fake:
        AUDIT_DB = "audit"

        def __init__(self, rows, ok_read=True):
            self.rows, self.ok_read, self.ran = rows, ok_read, 0

        def d1x(self, acct, token, db, sql, params=None):
            assert db == "audit" and "d1_restore_drills" in sql
            return (True, self.rows) if self.ok_read else (False, ["boom"])

        def d1_restore_drill(self, acct, token):
            self.ran += 1
            return 0
    good = {"CLOUDFLARE_ACCOUNT_ID": "a", "CLOUDFLARE_API_TOKEN": "t"}
    f = Fake([{"pass_age_days": 3.0, "last_attempt_hours": 3 * 24}])
    ok(main([], f, good) == 0 and f.ran == 0, "a fresh pass runs nothing")
    f = Fake([{"pass_age_days": 45.0, "last_attempt_hours": 45 * 24}])
    ok(main([], f, good) == 0 and f.ran == 1, "a stale pass runs the drill once")
    f = Fake([{"pass_age_days": None, "last_attempt_hours": None}])
    ok(main([], f, good) == 0 and f.ran == 1, "an empty ledger runs the drill")
    f = Fake([], ok_read=False)
    ok(main([], f, good) == 0 and f.ran == 0, "an unreadable ledger runs nothing and never fails")
    f = Fake([{"pass_age_days": 99, "last_attempt_hours": 99}])
    ok(main([], f, {}) == 0 and f.ran == 0, "no credential runs nothing")
    print("d1_timetravel_drill_due selftest %s" % ("ok" if not fails else "FAILED"))
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else main(sys.argv[1:]))
