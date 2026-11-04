#!/usr/bin/env python3
"""UX-JOURNEYS-1 filer: turns a phone-journey report (scripts/ux-journeys/run.mjs) into qnfo-audit agent_issues and closes them on recovery.

One open issue per broken or harder journey ("UX-JOURNEY-1: <app> / <journey>") and one per app's screen findings
("UX-SCREENS-1: <app> (<mode>)"). A later run in which the journey passes (or the app has no screen finding) closes the open issue
through issue_triage with the run as evidence (close_channel auto:ux-journeys). Dedupe is against OPEN issues of the same title
(CLAUDE.md); a closed one is reopened by the issue_refile_reopen trigger when it recurs. Counts and step names only, no personal data.

Usage: python3 scripts/ux-journeys/file_issues.py <report.json> [--dry]
Needs CLOUDFLARE_ACCOUNT_ID (or CF_ACCOUNT_ID) and CLOUDFLARE_API_TOKEN; without them it prints what it would file and exits 0.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
DB_ID = os.environ.get("QNFO_AUDIT_DB_ID", "35e2e573-92f3-46ac-83c6-22f6429fc5e5")
OPEN = "status NOT IN ('closed','resolved','wontfix')"
NOW = "CAST(strftime('%s','now') AS INTEGER) * 1000"
CHANNEL = "auto:ux-journeys"


def journey_title(app, jid):
    return "UX-JOURNEY-1: %s / %s" % (app, jid)


def screens_title(app, mode):
    return "UX-SCREENS-1: %s (%s)" % (app, mode)


def plan(report):
    """[(action, title, description, priority)] with action 'file' or 'close'. Pure, so the selftest can check it."""
    mode, sha, at = report.get("mode"), (report.get("sha") or "")[:12], report.get("at")
    run_ref = "run %s at %s%s" % (os.environ.get("GITHUB_RUN_ID", "local"), at, (" on " + sha) if sha else "")
    out = []
    for a in report.get("apps", []):
        app = a["app"]
        for j in a.get("journeys", []):
            g = j.get("grade") or {}
            t = journey_title(app, j["id"])
            if g.get("status") in ("broken", "harder"):
                desc = ("UX-JOURNEY-1 (pillar personal/reach). A person on a phone tried: %s (%s mode, %s).\nResult: %s. %s\nSteps taken: %s\n"
                        "Taps %s, typed fields %s (budget in scripts/ux-journeys/budgets.json).\nReproduce: node scripts/ux-journeys/run.mjs --mode %s --app %s --shots /tmp/shots\n"
                        "Closes itself when the journey passes again (file_issues.py)." % (
                            j.get("title"), mode, a.get("base"), g["status"], "; ".join(g.get("reasons") or []), ", ".join(j.get("steps") or []) or "none",
                            j.get("taps"), j.get("typing"), mode, app))
                out.append(("file", t, desc, "high" if g["status"] == "broken" else "medium"))
            elif g.get("status") == "ok":
                out.append(("close", t, "UX-JOURNEY-1: journey passed on a phone in %s mode (%s taps, %s typed; %s)" % (mode, j.get("taps"), j.get("typing"), run_ref), None))
        st = screens_title(app, mode)
        f = a.get("screenFindings") or []
        if f:
            out.append(("file", st, "UX-SCREENS-1 (pillar personal/reach). On a phone (412px, also 360px) %s has %d finding(s) that make it harder to use:\n- %s\n"
                        "Checks: sideways scroll, tap targets under 24px (WCAG 2.2 SC 2.5.8), empty floating bars, axe-core serious/critical, console errors, 404/5xx.\n"
                        "Reproduce: node scripts/ux-journeys/run.mjs --mode %s --app %s --shots /tmp/shots\nCloses itself when a run finds none." % (
                            app, len(f), "\n- ".join(f[:25]), mode, app), "medium"))
        elif a.get("journeys"):
            out.append(("close", st, "UX-SCREENS-1: no screen findings in %s mode (%s)" % (mode, run_ref), None))
    return out


def apply(actions, dry):
    acct = os.environ.get("CLOUDFLARE_ACCOUNT_ID") or os.environ.get("CF_ACCOUNT_ID")
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if dry or not (acct and token):
        for act, title, desc, prio in actions:
            print("%s %s%s" % ("WOULD-" + act.upper(), title, (" [" + prio + "]") if prio else ""))
        return 0
    from apply_migrations import d1  # noqa: E402  the fleet's one D1 HTTP helper
    failed = 0
    for act, title, desc, prio in actions:
        try:
            rows = d1(acct, token, DB_ID, "SELECT id FROM agent_issues WHERE title = ?1 AND " + OPEN + " LIMIT 1", [title]) or []
            if act == "file":
                if rows:
                    d1(acct, token, DB_ID, "UPDATE agent_issues SET description = ?2, updated_at = " + NOW + " WHERE id = ?1", [int(rows[0]["id"]), desc])
                    print("refreshed " + title)
                else:
                    d1(acct, token, DB_ID, "INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) "
                       "VALUES (?1, ?2, 'ci:ux-journeys', 'ux', ?3, 'open', " + NOW + ", " + NOW + ")", [title, desc, prio])
                    print("filed " + title)
            elif rows:
                iid = int(rows[0]["id"])
                d1(acct, token, DB_ID, "INSERT INTO issue_triage (issue_id, rc, owner, sla_due_at, close_evidence) SELECT ?1, 'UX-JOURNEYS-1', 'ux-journeys', datetime('now'), ?2 "
                   "WHERE NOT EXISTS (SELECT 1 FROM issue_triage WHERE issue_id = ?1)", [iid, desc])
                d1(acct, token, DB_ID, "UPDATE issue_triage SET close_evidence = ?2 WHERE issue_id = ?1", [iid, desc])
                d1(acct, token, DB_ID, "UPDATE agent_issues SET status = 'closed', close_channel = '" + CHANNEL + "', updated_at = " + NOW + " WHERE id = ?1 AND status = 'open'", [iid])
                print("closed " + title)
        except Exception as e:  # noqa: BLE001  one refused write must not hide the rest; reported and counted
            failed += 1
            print("FAILED %s %s: %s" % (act, title, str(e)[:240]), file=sys.stderr)
    return 1 if failed else 0


def selftest():
    rep = {"mode": "local", "at": "t", "apps": [{"app": "companion", "base": "h", "screenFindings": ["today: x"], "journeys": [
        {"id": "a", "title": "A", "taps": 3, "typing": 0, "steps": ["tap X"], "grade": {"status": "broken", "reasons": ["did not finish"]}},
        {"id": "b", "title": "B", "taps": 1, "typing": 0, "grade": {"status": "ok", "reasons": []}},
        {"id": "c", "title": "C", "taps": 9, "typing": 0, "grade": {"status": "harder", "reasons": ["needs 9 taps"]}},
        {"id": "d", "title": "D", "taps": 1, "typing": 0, "grade": {"status": "new", "reasons": []}}]},
        {"app": "public", "base": "h", "screenFindings": [], "journeys": [{"id": "q", "title": "Q", "taps": 1, "typing": 0, "grade": {"status": "ok", "reasons": []}}]}]}
    p = plan(rep)
    got = [(a, t, pr) for a, t, _, pr in p]
    want = [("file", "UX-JOURNEY-1: companion / a", "high"), ("close", "UX-JOURNEY-1: companion / b", None), ("file", "UX-JOURNEY-1: companion / c", "medium"),
            ("file", "UX-SCREENS-1: companion (local)", "medium"), ("close", "UX-JOURNEY-1: public / q", None), ("close", "UX-SCREENS-1: public (local)", None)]
    assert got == want, got
    assert "did not finish" in p[0][2] and "tap X" in p[0][2]
    print("selftest ok (%d actions)" % len(p))
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    with open(sys.argv[1]) as fh:
        sys.exit(apply(plan(json.load(fh)), "--dry" in sys.argv))
