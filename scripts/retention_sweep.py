#!/usr/bin/env python3
"""BP26-RETENTION-SWEEP-1 (2026-11-05, charter pillar security; roadmap_implementation row 1400, agent_issues 1000344, catalogue item 4.3 TTL sweeps).

The sweep half of the retention registry. `retention_policy` (qnfo-audit) holds 19 proposed periods and counts what is past each one (records_past_retention, 1004 on
2026-11-05); until now nothing acted on the count, because deleting or blanking mail-derived personal data is irreversible and identity-bound: the owner card
`bp26-retention-enforce` (human_actions 189) asks for the answer. This module is the rest of the row, built and shipped dormant. It changes nothing until BOTH are true:

    ops_config.retention_enforce = 'on'     (the owner's answer 'enforce', applied by the fleet)
    retention_policy.enforcement = 'enforce' (per policy; an 'adjust' answer changes retention_days first)

Until then every run is a DRY RUN: it counts, per policy, the rows the sweep would blank or delete (the policy's own condition, identical to retention_policy.past_sql, with
one extra guard for subscribers) and writes that number into retention_policy.note only when the text changed, so the card can quote exact numbers. It never writes to
a table in dry mode. A run that cannot decide (unreadable switch, unreadable registry) is a dry run.

Safety rules, each pinned by the selftest:
  * Every identifier in a statement comes from SWEEPS below (compiled in), never from a D1 value. A registry row whose db or table differs from its compiled spec, or whose
    key is not in SWEEPS, is refused and noted.
  * retention_days comes from the row (so 'adjust <policy_key> <days>' works) but must be an integer from MIN_DAYS to 3650; anything else is refused.
  * Batches of BATCH rows chosen by rowid, at most MAX_BATCHES per policy and BUDGET_S seconds per run; a statement error stops that policy only.
  * Blank = NULL on the listed columns of rows past the period that still hold data. Delete = whole row, only for the row-scoped policies. Rows the never-email-twice record
    needs are never deleted: contact_ledger rows with suppress = 1 or reply_count > 0 (the table's own guard would abort the statement), and subscribers that
    unsubscribed without an email_suppression row.
  * No copy of the removed content is made: a backup of the data would keep what the policy removes. The record is the count (before, after) and a cloud_ops_events row
    kind 'retention-sweep'. There is no revert of a deleted or blanked value; the only rollback is stopping: ops_config.retention_enforce = 'off'.
  * Weekly R2 exports (scripts/continuity_snapshot.py) copy whole tables. While the switch is on they blank the columns in EXPORT_BLANK, so a copy in R2 does not outlive
    the policy; the exports already written (export/<database>/<yyyymmdd>/) are not rewritten here: deleting backups is its own decision (docs/RETENTION.md section 4).

Usage:
  python3 scripts/retention_sweep.py --selftest      offline suite (sqlite stand-ins for the databases)
  python3 scripts/retention_sweep.py --dry           live READ-ONLY run: prints what each policy would do, writes nothing
"""
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SWITCH_KEY = "retention_enforce"
MIN_DAYS = 7
MAX_DAYS = 3650
BATCH = 100
MAX_BATCHES = 10
BUDGET_S = 150
DEFAULT_DB = "qnfo-audit"
# The only databases a sweep may write. qnfo-identity, qnfo-outreach and the personal plane are never listed.
ALLOWED_DBS = ("qnfo-audit", "ipatent-db", "q08-signal", "living-paper")


def _old(col):
    """The retention period test; {days} is filled with a validated integer."""
    return "substr(%s,1,10) < date('now','-{days} days')" % col


# policy_key -> (database, table, action, columns to blank, WHERE clause with {days}). The WHERE clause is the policy's registered past_sql condition.
SWEEPS = {
    "emails_bodies_30d": (DEFAULT_DB, "emails", "blank", ("body_text", "body_html", "headers_json"),
                          _old("received_at") + " AND (COALESCE(body_text,'') <> '' OR COALESCE(body_html,'') <> '')"),
    "email_raw_archive_30d": (DEFAULT_DB, "email_raw_archive", "blank", ("raw_text",), _old("created_at") + " AND COALESCE(raw_text,'') <> ''"),
    "email_reply_queue_drafts_90d": (DEFAULT_DB, "email_reply_queue", "blank", ("draft_text", "draft_proposed"),
                                     _old("created_at") + " AND (COALESCE(draft_text,'') <> '' OR COALESCE(draft_proposed,'') <> '')"),
    "email_loop_quarantine_30d": (DEFAULT_DB, "email_loop_quarantine", "blank", ("body_text",),
                                  _old("COALESCE(quarantined_at, received_at)") + " AND COALESCE(body_text,'') <> ''"),
    "email_commands_180d": (DEFAULT_DB, "email_commands", "blank", ("command_text", "result"), _old("created_at") + " AND COALESCE(command_text,'') <> ''"),
    "email_parse_failures_90d": (DEFAULT_DB, "email_parse_failures", "blank", ("content_hint",), _old("created_at") + " AND COALESCE(content_hint,'') <> ''"),
    "mcp_log_90d": (DEFAULT_DB, "mcp_log", "blank", ("args", "result"), _old("ts") + " AND (COALESCE(args,'') <> '' OR COALESCE(result,'') <> '')"),
    "handoffs_email_180d": (DEFAULT_DB, "handoffs", "blank", ("summary", "pending_work", "next_action"),
                            "session_id LIKE 'email-%' AND " + _old("timestamp") + " AND COALESCE(summary,'') <> ''"),
    "ipatent_submission_ip_90d": ("ipatent-db", "submissions", "blank", ("ip_address", "user_agent"),
                                  _old("created_at") + " AND (COALESCE(ip_address,'') <> '' OR COALESCE(user_agent,'') <> '')"),
    "subscribers_pending_30d": (DEFAULT_DB, "subscribers", "delete", (), "status = 'pending' AND " + _old("created_at")),
    "subscribers_unsubscribed_30d": (DEFAULT_DB, "subscribers", "delete", (),
                                     "status = 'unsubscribed' AND " + _old("COALESCE(updated_at, created_at)")
                                     + " AND EXISTS (SELECT 1 FROM email_suppression s WHERE lower(s.email) = lower(subscribers.email))"),
    "contact_ledger_1095d": (DEFAULT_DB, "contact_ledger", "delete", (),
                             "COALESCE(suppress,0) = 0 AND COALESCE(reply_count,0) = 0 AND substr(COALESCE(last_contact, first_contact, ''),1,10) <> '' AND "
                             + _old("COALESCE(last_contact, first_contact)")),
    "email_calendar_delivery_90d": (DEFAULT_DB, "email_calendar_delivery", "delete", (), "status IN ('sent','skipped','superseded') AND " + _old("due_at")),
    "emails_metadata_365d": (DEFAULT_DB, "emails", "delete", (), _old("received_at")),
    "ipatent_sessions_90d": ("ipatent-db", "sessions", "delete", (), _old("first_seen")),
    "ipatent_analytics_90d": ("ipatent-db", "analytics", "delete", (), _old("created_at")),
    "ipatent_submissions_730d": ("ipatent-db", "submissions", "delete", (), _old("created_at")),
    "q08_subscribers_pending_30d": ("q08-signal", "subscribers", "delete", (), "status = 'pending' AND " + _old("created_at")),
    "living_paper_email_logs_30d": ("living-paper", "email_logs", "delete", (), _old("ts")),
}
# Blank policies run before delete policies, so a row is never deleted with its content still in a sibling pass of the same run.
ORDER = sorted(SWEEPS, key=lambda k: (SWEEPS[k][2] != "blank", k))

# Columns a weekly R2 export blanks while the switch is on: the tables that hold mail-derived content only. mcp_log and handoffs are mixed-use and are not listed (their
# content is blanked in D1 by the sweep and the next export copies the blanked rows); whole-row delete policies are not blanked in an export, which keeps the rows a restore needs.
EXPORT_BLANK = {
    (DEFAULT_DB, "emails"): ("body_text", "body_html", "headers_json"),
    (DEFAULT_DB, "email_raw_archive"): ("raw_text",),
    (DEFAULT_DB, "email_loop_quarantine"): ("body_text",),
    (DEFAULT_DB, "email_reply_queue"): ("draft_text", "draft_proposed"),
    (DEFAULT_DB, "email_commands"): ("command_text", "result"),
    (DEFAULT_DB, "email_parse_failures"): ("content_hint",),
    ("ipatent-db", "submissions"): ("ip_address", "user_agent"),
}
IDENT = re.compile(r"^[a-z_][a-z0-9_]*$")


def export_blank(database, table, on):
    """Columns the export of (database, table) sets to NULL: none unless the switch is on."""
    return EXPORT_BLANK.get((database, table), ()) if on else ()


def blank_page(page, cols):
    """Sets cols to None in every exported row of a page (rows are dicts); returns the page."""
    if cols:
        for r in page:
            for c in cols:
                if c in r:
                    r[c] = None
    return page


def switch_on(d1):
    """True only when ops_config.retention_enforce reads 'on'. Unreadable or absent is off."""
    try:
        rows = d1("SELECT value FROM ops_config WHERE key = '%s'" % SWITCH_KEY)
        return bool(rows) and str(rows[0].get("value")).strip().lower() == "on"
    except Exception:  # noqa: BLE001
        return False


def _where(spec, days):
    return spec[4].replace("{days}", str(int(days)))


def _count_sql(spec, days):
    return 'SELECT COUNT(*) AS n FROM "%s" WHERE %s' % (spec[1], _where(spec, days))


def _batch_sql(spec, days):
    pick = 'SELECT rowid FROM "%s" WHERE %s LIMIT %d' % (spec[1], _where(spec, days), BATCH)
    if spec[2] == "blank":
        sets = ", ".join('"%s" = NULL' % c for c in spec[3])
        return 'UPDATE "%s" SET %s WHERE rowid IN (%s)' % (spec[1], sets, pick)
    return 'DELETE FROM "%s" WHERE rowid IN (%s)' % (spec[1], pick)


def _num(rows):
    return int((rows or [{"n": 0}])[0].get("n") or 0)


def run(d1=None, plane=None, only=None, dry_only=False, budget_s=BUDGET_S, write_notes=True):
    """One pass over the registry. d1(sql) -> rows for qnfo-audit; plane(transport, sql) -> rows for another database. Never raises; returns the summary dict."""
    out = {"retention-sweep": "ok", "mode": "dry", "policies": {}}
    try:
        if d1 is None or plane is None:
            sys.path.insert(0, HERE)
            import remediation_consumer as RC  # noqa: E402
            d1 = d1 or (lambda sql: RC.d1(sql))
            plane = plane or RC.d1_plane
        t_end = time.time() + budget_s
        on = switch_on(d1) and not dry_only
        out["mode"] = "enforce" if on else "dry"
        pols = d1("SELECT policy_key, db, table_name, retention_days, enforcement, note FROM retention_policy ORDER BY policy_key")

        def run_sql(db, sql):
            if db not in ALLOWED_DBS:
                raise RuntimeError("database %s is not on the retention allowlist" % db)
            return d1(sql) if db == DEFAULT_DB else plane("d1-query@" + db, sql)
        by_key = {p["policy_key"]: p for p in pols}
        changed_total = 0
        for key in ORDER + sorted(k for k in by_key if k not in SWEEPS):
            if only and key != only:
                continue
            row = by_key.get(key)
            if row is None:
                continue
            res = out["policies"][key] = {}
            spec = SWEEPS.get(key)
            if spec is None:
                res["refused"] = "no sweep is defined for this policy key"
                continue
            if row.get("db") != spec[0] or row.get("table_name") != spec[1] or not all(IDENT.match(x) for x in (spec[1],) + tuple(spec[3])):
                res["refused"] = "registry row (%s.%s) differs from the compiled spec (%s.%s)" % (row.get("db"), row.get("table_name"), spec[0], spec[1])
                continue
            try:
                days = int(row.get("retention_days"))
            except (TypeError, ValueError):
                days = -1
            if days < MIN_DAYS or days > MAX_DAYS:
                res["refused"] = "retention_days %r is outside %d..%d" % (row.get("retention_days"), MIN_DAYS, MAX_DAYS)
                continue
            try:
                before = _num(run_sql(spec[0], _count_sql(spec, days)))
            except Exception as e:  # noqa: BLE001
                res["error"] = "count: " + str(e)[:120]
                continue
            res["past_period"] = before
            if not (on and str(row.get("enforcement")) == "enforce"):
                res["did"] = "would %s %d" % (spec[2], before)
            elif before == 0:
                res["did"] = "nothing past the period"
            else:
                n = 0
                try:
                    while n < MAX_BATCHES and time.time() < t_end and _num(run_sql(spec[0], _count_sql(spec, days))) > 0:
                        run_sql(spec[0], _batch_sql(spec, days))
                        n += 1
                except Exception as e:  # noqa: BLE001
                    res["error"] = "batch: " + str(e)[:120]
                try:
                    after = _num(run_sql(spec[0], _count_sql(spec, days)))
                except Exception as e:  # noqa: BLE001
                    after = before
                    res["error"] = (res.get("error", "") + " recount: " + str(e)[:80]).strip()
                res["changed"] = max(0, before - after)
                res["left"] = after
                res["did"] = "%s %d, %d left" % ("blanked" if spec[2] == "blank" else "deleted", res["changed"], after)
                changed_total += res["changed"]
            note = ("retention sweep (%s): %s" % ("enforce" if on else "dry run", res["did"]))[:200]
            if write_notes and note != (row.get("note") or ""):
                try:
                    d1("UPDATE retention_policy SET note = '%s' WHERE policy_key = '%s'" % (note.replace("'", "''"), key))
                except Exception as e:  # noqa: BLE001
                    res["note_error"] = str(e)[:80]
        if on and changed_total:
            summary = "RETENTION-SWEEP-1: %d row(s) blanked or deleted; %s" % (changed_total, json.dumps({k: v.get("did") for k, v in out["policies"].items() if v.get("changed")}))
            try:
                d1("INSERT INTO cloud_ops_events (id, ts, kind, status, text, job) VALUES ('retention-sweep-%d', strftime('%%Y-%%m-%%dT%%H:%%M:%%SZ', 'now'), 'retention-sweep', 'ok', '%s', 'continuity-snapshot')"
                   % (int(time.time()), summary[:400].replace("'", "''")))
            except Exception as e:  # noqa: BLE001
                out["event_error"] = str(e)[:80]
        out["changed"] = changed_total
    except Exception as e:  # noqa: BLE001
        out["retention-sweep"] = "failed"
        out["error"] = str(e)[:160]
    return out


# ---------------------------------------------------------------- selftest
def selftest():
    import sqlite3
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)
            print("FAIL " + m)

    def mk():
        dbs = {n: sqlite3.connect(":memory:") for n in ALLOWED_DBS}
        a = dbs["qnfo-audit"]
        a.executescript("""
        CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, status TEXT, text TEXT, job TEXT);
        CREATE TABLE retention_policy (policy_key TEXT PRIMARY KEY, db TEXT, table_name TEXT, retention_days INTEGER, enforcement TEXT DEFAULT 'report', note TEXT);
        CREATE TABLE emails (id INTEGER PRIMARY KEY, sender TEXT, subject TEXT, body_text TEXT, body_html TEXT, headers_json TEXT, received_at TEXT);
        CREATE TABLE email_suppression (email TEXT, reason TEXT);
        CREATE TABLE subscribers (email TEXT, status TEXT, created_at TEXT, updated_at TEXT);
        CREATE TABLE contact_ledger (email TEXT, suppress INTEGER, reply_count INTEGER, first_contact TEXT, last_contact TEXT);
        CREATE TRIGGER contact_ledger_no_erase_guard BEFORE DELETE ON contact_ledger FOR EACH ROW WHEN OLD.suppress = 1 OR COALESCE(OLD.reply_count,0) > 0
          BEGIN SELECT RAISE(ABORT, 'CONTACT-LEDGER-IMMUTABLE-1'); END;
        """)
        d = lambda n: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - n * 86400))  # noqa: E731
        for i in range(250):   # 250 old bodies: more than one batch
            a.execute("INSERT INTO emails (sender, subject, body_text, body_html, headers_json, received_at) VALUES ('s', 'sub', 'body', '<p>b</p>', '{}', ?)", [d(45)])
        a.execute("INSERT INTO emails (sender, subject, body_text, body_html, headers_json, received_at) VALUES ('s', 'recent', 'keep', '<p>k</p>', '{\"a\":1}', ?)", [d(2)])
        a.execute("INSERT INTO emails (sender, subject, body_text, body_html, headers_json, received_at) VALUES ('s', 'old empty', '', NULL, '{}', ?)", [d(45)])
        a.executemany("INSERT INTO subscribers VALUES (?, ?, ?, ?)", [("p1", "pending", d(40), None), ("p2", "pending", d(3), None), ("u1", "unsubscribed", d(40), d(40)),
                                                                        ("u2", "unsubscribed", d(40), d(40))])
        a.execute("INSERT INTO email_suppression VALUES ('U1', 'optout')")
        a.executemany("INSERT INTO contact_ledger VALUES (?, ?, ?, ?, ?)", [("c1", 0, 0, d(1200), d(1200)), ("c2", 1, 0, d(1200), d(1200)), ("c3", 0, 2, d(1200), d(1200))])
        rp = [("emails_bodies_30d", DEFAULT_DB, "emails", 30), ("subscribers_pending_30d", DEFAULT_DB, "subscribers", 30), ("subscribers_unsubscribed_30d", DEFAULT_DB, "subscribers", 30),
              ("contact_ledger_1095d", DEFAULT_DB, "contact_ledger", 1095), ("emails_metadata_365d", DEFAULT_DB, "emails", 365)]
        a.executemany("INSERT INTO retention_policy (policy_key, db, table_name, retention_days) VALUES (?, ?, ?, ?)", rp)
        ip = dbs["ipatent-db"]
        ip.executescript("CREATE TABLE sessions (ip_address TEXT, first_seen TEXT);")
        ip.executemany("INSERT INTO sessions VALUES (?, ?)", [("1.2.3.4", d(120)), ("5.6.7.8", d(1))])
        a.execute("INSERT INTO retention_policy (policy_key, db, table_name, retention_days) VALUES ('ipatent_sessions_90d', 'ipatent-db', 'sessions', 90)")
        return dbs

    def io(dbs, log=None):
        def run_(db, sql):
            c = dbs[db]
            cur = c.execute(sql)
            cols = [x[0] for x in cur.description] if cur.description else []
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]
            c.commit()
            if log is not None and not sql.lstrip().upper().startswith("SELECT"):
                log.append((db, sql[:60]))
            return rows
        return (lambda sql: run_("qnfo-audit", sql)), (lambda transport, sql: run_(transport.split("@", 1)[1], sql))

    def scalar(dbs, db, sql):
        return dbs[db].execute(sql).fetchone()[0]

    def enforce_all(dbs):
        dbs["qnfo-audit"].execute("UPDATE retention_policy SET enforcement = 'enforce'")
        dbs["qnfo-audit"].execute("INSERT OR REPLACE INTO ops_config VALUES ('retention_enforce', 'on')")

    # 1. switch absent: dry run, counts only, nothing but the note column written
    dbs, log = mk(), []
    d1, plane = io(dbs, log)
    r = run(d1, plane)
    ok(r["mode"] == "dry" and r["policies"]["emails_bodies_30d"]["past_period"] == 250, "dry run counts the 250 old bodies (the empty old row and the recent one are not past-period data): %r" % (r["policies"].get("emails_bodies_30d"),))
    ok(scalar(dbs, "qnfo-audit", "SELECT COUNT(*) FROM emails WHERE body_text IS NOT NULL AND body_text <> ''") == 251, "dry run blanks nothing")
    ok(all(s.startswith("UPDATE retention_policy SET note") for _db, s in log), "dry run writes only the note column: %r" % (log[:3],))
    first_writes = len(log)
    run(d1, plane)
    ok(len(log) == first_writes, "an unchanged second dry run writes nothing at all (the note is written only when its text changes)")
    ok("would blank 250" in (dbs["qnfo-audit"].execute("SELECT note FROM retention_policy WHERE policy_key = 'emails_bodies_30d'").fetchone()[0] or ""), "the note carries the exact would-blank number")

    # 2. switch on but the policies still say report: no change
    dbs["qnfo-audit"].execute("INSERT OR REPLACE INTO ops_config VALUES ('retention_enforce', 'on')")
    d1, plane = io(dbs, log)
    r = run(d1, plane)
    ok(r["mode"] == "enforce" and scalar(dbs, "qnfo-audit", "SELECT COUNT(*) FROM emails WHERE body_text <> ''") == 251, "switch on with policy enforcement = report changes nothing")
    # 2b. dry_only wins over the switch
    enforce_all(dbs)
    n_log = len(log)
    r = run(d1, plane, dry_only=True, write_notes=False)
    ok(r["mode"] == "dry" and scalar(dbs, "qnfo-audit", "SELECT COUNT(*) FROM emails WHERE body_text <> ''") == 251 and len(log) == n_log,
       "--dry never writes (not even a note), with the switch on and the policy enforcing")
    # an unreadable switch is off
    ok(switch_on(lambda sql: (_ for _ in ()).throw(RuntimeError("D1 down"))) is False, "an unreadable switch is off")

    # 3. enforce: blank, batches, untouched rows
    dbs = mk()
    enforce_all(dbs)
    d1, plane = io(dbs)
    r = run(d1, plane)
    p = r["policies"]
    ok(scalar(dbs, "qnfo-audit", "SELECT COUNT(*) FROM emails WHERE received_at < date('now','-40 days') AND (body_text IS NOT NULL OR body_html IS NOT NULL OR headers_json IS NOT NULL) AND subject = 'sub'") == 0,
       "the 250 old bodies, html and headers are NULL after three batches of 100")
    ok(scalar(dbs, "qnfo-audit", "SELECT body_text || headers_json FROM emails WHERE subject = 'recent'") == 'keep{"a":1}', "a recent message keeps its body and headers")
    ok(scalar(dbs, "qnfo-audit", "SELECT COUNT(*) FROM emails") == 252, "blanking deletes no row (metadata stays)")
    ok(p["emails_bodies_30d"].get("changed") == 250 and p["emails_bodies_30d"].get("left") == 0, "the summary says 250 changed, 0 left: %r" % (p["emails_bodies_30d"],))
    ok(scalar(dbs, "qnfo-audit", "SELECT COUNT(*) FROM cloud_ops_events WHERE kind = 'retention-sweep'") == 1, "one cloud_ops_events row records the run")
    # 4. delete policies and their guards
    ok(sorted(r_[0] for r_ in dbs["qnfo-audit"].execute("SELECT email FROM subscribers")) == ["p2", "u2"], "pending subscriber past 30 days deleted, recent kept, unsubscribed WITH a suppression row deleted, WITHOUT one kept")
    ok(sorted(r_[0] for r_ in dbs["qnfo-audit"].execute("SELECT email FROM contact_ledger")) == ["c2", "c3"], "contact_ledger: only the unsuppressed, never-replied row is deleted (no abort from the table guard)")
    ok(scalar(dbs, "ipatent-db", "SELECT COUNT(*) FROM sessions") == 1 and "error" not in p["ipatent_sessions_90d"], "another database: the old session row is deleted through the plane call")
    ok(scalar(dbs, "qnfo-audit", "SELECT COUNT(*) FROM emails") == 252, "emails_metadata_365d keeps every row younger than 365 days")
    # 5. refusals
    dbs = mk()
    enforce_all(dbs)
    dbs["qnfo-audit"].execute("UPDATE retention_policy SET retention_days = 1 WHERE policy_key = 'emails_bodies_30d'")
    dbs["qnfo-audit"].execute("UPDATE retention_policy SET table_name = 'emails' WHERE policy_key = 'contact_ledger_1095d'")
    dbs["qnfo-audit"].execute("INSERT INTO retention_policy (policy_key, db, table_name, retention_days, enforcement) VALUES ('evil', 'qnfo-audit', 'agent_issues', 30, 'enforce')")
    dbs["qnfo-audit"].execute("INSERT INTO retention_policy (policy_key, db, table_name, retention_days, enforcement) VALUES ('bad_days', 'qnfo-audit', 'emails', 'x', 'enforce')")
    d1, plane = io(dbs)
    r = run(d1, plane)
    p = r["policies"]
    ok("outside" in p["emails_bodies_30d"].get("refused", "") and scalar(dbs, "qnfo-audit", "SELECT COUNT(*) FROM emails WHERE body_text <> ''") == 251, "a period of 1 day is refused (floor %d) and nothing is blanked" % MIN_DAYS)
    ok("differs" in p["contact_ledger_1095d"].get("refused", "") and scalar(dbs, "qnfo-audit", "SELECT COUNT(*) FROM contact_ledger") == 3, "a registry row that names another table than its compiled spec is refused")
    ok("no sweep" in p["evil"].get("refused", "") and "outside" not in p["evil"].get("refused", ""), "a policy key with no compiled spec is refused, its table is never named in a statement")
    # 6. an error in one policy does not stop the others and never raises
    dbs = mk()
    enforce_all(dbs)
    d1_ok, plane_ok = io(dbs)

    def plane_bad(transport, sql):
        raise RuntimeError("HTTP 500 from the plane")
    r = run(d1_ok, plane_bad)
    ok(r["retention-sweep"] == "ok" and "error" in r["policies"]["ipatent_sessions_90d"] and r["policies"]["emails_bodies_30d"].get("changed") == 250, "a failing plane call is recorded on its own policy; the qnfo-audit policies still run")
    ok(run(lambda sql: (_ for _ in ()).throw(RuntimeError("boom")), plane_bad)["retention-sweep"] == "failed", "an unreadable registry fails the run, does not raise")
    # 7. the compiled specs
    ok(len(SWEEPS) == 19 and len(ORDER) == 19, "19 compiled specs, one per registered policy")
    ok(all(IDENT.match(s[1]) and all(IDENT.match(c) for c in s[3]) and s[0] in ALLOWED_DBS for s in SWEEPS.values()), "every compiled identifier is a plain name on an allowed database")
    ok(all((s[2] == "blank") == bool(s[3]) for s in SWEEPS.values()) and all(s[2] in ("blank", "delete") for s in SWEEPS.values()), "blank specs name columns, delete specs name none")
    ok(all("{days}" in s[4] for s in SWEEPS.values()), "every WHERE clause takes the period from the row")
    ok(ORDER.index("emails_bodies_30d") < ORDER.index("emails_metadata_365d"), "blank policies run before delete policies")
    ok(all(IDENT.match(t) and all(IDENT.match(c) for c in cols) and d in ALLOWED_DBS for (d, t), cols in EXPORT_BLANK.items()), "export map names plain identifiers on allowed databases")
    ok(all(any(s[0] == d and s[1] == t and s[2] == "blank" and set(s[3]) >= set(cols) for s in SWEEPS.values()) or (d, t) == (DEFAULT_DB, "emails") for (d, t), cols in EXPORT_BLANK.items()),
       "every column an export blanks is a column a blank policy sweeps")
    # 8. export blanking
    page = [{"_rowid": 1, "body_text": "x", "subject": "s", "headers_json": "{}"}]
    ok(blank_page([dict(page[0])], export_blank(DEFAULT_DB, "emails", False))[0]["body_text"] == "x", "switch off: an export is byte-for-byte unchanged")
    got = blank_page([dict(page[0])], export_blank(DEFAULT_DB, "emails", True))[0]
    ok(got["body_text"] is None and got["headers_json"] is None and got["subject"] == "s" and got["_rowid"] == 1, "switch on: body and headers are NULL, the metadata and the rowid stay")
    ok(export_blank(DEFAULT_DB, "agent_issues", True) == () and export_blank(DEFAULT_DB, "mcp_log", True) == () and export_blank(DEFAULT_DB, "subscribers", True) == (), "tables a restore needs whole are never blanked in an export")
    print("retention_sweep selftest %s" % ("ok" if not fails else "FAILED %d" % len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    if "--dry" in sys.argv:
        print(json.dumps(run(dry_only=True, write_notes=False), indent=1, sort_keys=True))
        sys.exit(0)
    print(__doc__)
