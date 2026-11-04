#!/usr/bin/env python3
"""Offline tests for MIGRATION-RUNNER-1 (scripts/apply_migrations.py, transformation lever T5.3).

A fake Cloudflare D1 (an in-memory sqlite3 database behind cf_ops_actions.call) stands in for qnfo-audit. Proves: a file
without "-- APPLY-BY: ci" is skipped (the 75 hand-applied files never run again); an opted-in file needs a known DB and a
Rollback line; DELETE/DROP needs a BACKUP table that exists and is non-empty, checked before anything runs; statements are
split by SQLite's tokenizer (a semicolon inside a string literal is not a boundary); an applied file is recorded in
migration_runs and skipped on the next run with the same sha256, and runs again when its content changes; a failing
statement records an error row, files one deduped MIGRATION-APPLY-FAILED-1 issue and returns 1; --check refuses a bad
header without touching D1; every migration already in migrations/ is skipped by --check.
Run: python3 scripts/apply_migrations_test.py   (prints "N passed, 0 failed")
"""
import glob
import io
import json
import re
import os
import sqlite3
import sys
import contextlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import apply_migrations as M  # noqa: E402
import cf_ops_actions as C  # noqa: E402

passed = failed = 0


def ok(cond, label, extra=None):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print("FAIL " + label + ("" if extra is None else " :: " + str(extra)[:400]))


db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER)")
db.execute("CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT)")
calls = []
paths = []


def fake_call(method, path, token, body=None, timeout=60):
    calls.append(body["sql"][:60])
    paths.append((path, body["sql"][:60]))
    sql = body["sql"]
    params = body.get("params") or []
    q = __import__("re").sub(r"\?(\d+)", lambda m: ":p" + m.group(1), sql)
    try:
        cur = db.execute(q, {"p" + str(i + 1): v for i, v in enumerate(params)}) if params else db.execute(sql)
        rows = [dict(zip([d[0] for d in cur.description], r)) for r in cur.fetchall()] if cur.description else []
        db.commit()
        return 200, {"success": True, "result": [{"results": rows, "meta": {"changes": max(cur.rowcount, 0)}}]}
    except sqlite3.Error as e:
        return 400, {"success": False, "errors": [{"message": str(e)}]}


C.call = fake_call
out = []
emit = out.append

GOOD = """-- MIGRATION-RUNNER-1 test
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM ops_config WHERE key IN ('a', 'b;c');
INSERT OR REPLACE INTO ops_config (key, value) VALUES ('a', 'x; y');
INSERT OR REPLACE INTO ops_config (key, value) VALUES ('b;c', 'it''s; fine');
"""

# 1. Opt-in: no header means skip, and nothing reaches D1.
ok(M.apply_file("migrations/old.sql", "CREATE TABLE t (x);\n", "a", "t", "c1", emit) == 0 and "skipped" in out[-1] and not calls, "a file without APPLY-BY: ci is skipped and D1 is not called")

# 2. Splitting respects string literals.
st = M.statements(GOOD)
ok(len(st) == 2 and "'x; y'" in st[0] and "'it''s; fine'" in st[1], "semicolons inside string literals are not statement boundaries", st)

# 3. Apply, record, skip on re-run, re-run on change.
rc = M.apply_file("migrations/good.sql", GOOD, "a", "t", "c1", emit)
ok(rc == 0 and json.loads(out[-1]).get("ok") and json.loads(out[-1])["statements"] == 2, "an opted-in file applies its statements", out[-1])
ok(db.execute("SELECT value FROM ops_config WHERE key = 'b;c'").fetchone()[0] == "it's; fine", "the statements really ran")
ok(db.execute("SELECT status, statements, commit_sha FROM migration_runs WHERE file = 'migrations/good.sql'").fetchone() == ("ok", 2, "c1"), "the run is recorded in migration_runs")
n_before = len(calls)
rc = M.apply_file("migrations/good.sql", GOOD, "a", "t", "c2", emit)
ok(rc == 0 and json.loads(out[-1]).get("already_applied") and db.execute("SELECT COUNT(*) FROM migration_runs").fetchone()[0] == 1, "the same sha256 is not applied twice", out[-1])
rc = M.apply_file("migrations/good.sql", GOOD + "INSERT OR REPLACE INTO ops_config (key, value) VALUES ('d', '1');\n", "a", "t", "c3", emit)
ok(rc == 0 and db.execute("SELECT COUNT(*) FROM migration_runs WHERE file = 'migrations/good.sql' AND status = 'ok'").fetchone()[0] == 2, "changed content (a new sha256) runs again")

# 4. Header refusals, before any D1 call.
n0 = len(calls)
bad_db = GOOD.replace("-- DB: qnfo-audit", "-- DB: no-such-db")
ok(M.apply_file("migrations/x.sql", bad_db, "a", "t", "c", emit) == 1 and "DB header" in out[-1] and len(calls) == n0, "an unknown DB is refused without touching D1", out[-1])
no_rb = GOOD.replace("-- Rollback: DELETE FROM ops_config WHERE key IN ('a', 'b;c');\n", "")
ok(M.apply_file("migrations/x.sql", no_rb, "a", "t", "c", emit) == 1 and "Rollback" in out[-1] and len(calls) == n0, "a file without a Rollback line is refused", out[-1])
destr = GOOD + "DELETE FROM ops_config WHERE key = 'a';\n"
ok(M.apply_file("migrations/x.sql", destr, "a", "t", "c", emit) == 1 and "BACKUP" in out[-1] and len(calls) == n0, "a DELETE without a BACKUP header is refused", out[-1])
incomplete = GOOD + "INSERT INTO ops_config (key, value) VALUES ('z', 'no end')\n"
ok(M.apply_file("migrations/x.sql", incomplete, "a", "t", "c", emit) == 1 and "incomplete" in out[-1], "a file ending in an incomplete statement is refused", out[-1])

# 5. BACKUP must exist and hold rows before a destructive file runs.
with_bk = destr.replace("-- DB: qnfo-audit", "-- DB: qnfo-audit\n-- BACKUP: ops_config_bak_test")
rc = M.apply_file("migrations/destr.sql", with_bk, "a", "t", "c4", emit)
ok(rc == 1 and "does not exist" in out[-1] and db.execute("SELECT COUNT(*) FROM ops_config WHERE key = 'a'").fetchone()[0] == 1, "a missing backup table stops the file before any statement", out[-1])
db.execute("CREATE TABLE ops_config_bak_test AS SELECT * FROM ops_config WHERE 0")
db.commit()
rc = M.apply_file("migrations/destr.sql", with_bk, "a", "t", "c4", emit)
ok(rc == 1 and "is empty" in out[-1], "an empty backup table stops the file", out[-1])
db.execute("INSERT INTO ops_config_bak_test SELECT * FROM ops_config")
db.commit()
rc = M.apply_file("migrations/destr.sql", with_bk, "a", "t", "c4", emit)
ok(rc == 0 and db.execute("SELECT COUNT(*) FROM ops_config WHERE key = 'a'").fetchone()[0] == 0, "with a non-empty backup the destructive file runs", out[-1])

# 5b. A file that creates its own backup ahead of the delete: checked right before the DELETE, not before anything.
own_bk = """-- own backup
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_test_own
-- Rollback: INSERT OR IGNORE INTO ops_config SELECT * FROM bak_test_own;
INSERT OR REPLACE INTO ops_config (key, value) VALUES ('own1', 'x');
CREATE TABLE IF NOT EXISTS bak_test_own AS SELECT * FROM ops_config;
DELETE FROM ops_config WHERE key = 'own1';
"""
okp, probs, inf = M.plan("migrations/own.sql", own_bk)
ok(okp and not probs and inf["creates_backup"] is True, "a CREATE TABLE <backup> AS SELECT ahead of the delete is recognised", (probs, inf))
rc = M.apply_file("migrations/own.sql", own_bk, "a", "t", "c4b", emit)
ok(rc == 0 and db.execute("SELECT COUNT(*) FROM bak_test_own WHERE key = 'own1'").fetchone()[0] == 1 and db.execute("SELECT COUNT(*) FROM ops_config WHERE key = 'own1'").fetchone()[0] == 0, "the backup is written first, then the delete runs", out[-1])
late_bk = own_bk.replace("bak_test_own", "bak_test_late").replace("CREATE TABLE IF NOT EXISTS bak_test_late AS SELECT * FROM ops_config;\nDELETE FROM ops_config WHERE key = 'own1';", "DELETE FROM ops_config WHERE key = 'own1';\nCREATE TABLE IF NOT EXISTS bak_test_late AS SELECT * FROM ops_config;")
okp, probs, inf = M.plan("migrations/late.sql", late_bk)
ok(inf["creates_backup"] is False, "a backup created after the delete does not count", inf)
db.execute("INSERT OR REPLACE INTO ops_config (key, value) VALUES ('own1', 'x')")
db.commit()
rc = M.apply_file("migrations/late.sql", late_bk, "a", "t", "c4c", emit)
ok(rc == 1 and "does not exist" in out[-1] and db.execute("SELECT COUNT(*) FROM ops_config WHERE key = 'own1'").fetchone()[0] == 1, "so the file is stopped before any statement and nothing is deleted", out[-1])
empty_bk = own_bk.replace("bak_test_own", "bak_test_empty").replace("AS SELECT * FROM ops_config;", "AS SELECT * FROM ops_config WHERE 0;")
rc = M.apply_file("migrations/empty.sql", empty_bk, "a", "t", "c4d", emit)
ok(rc == 1 and "is empty" in out[-1] and "before statement 3" in out[-1] and db.execute("SELECT COUNT(*) FROM ops_config WHERE key = 'own1'").fetchone()[0] == 1, "an empty self-made backup stops the file right before the delete", out[-1])

# 6. A failing statement is recorded once and filed once.
failing = GOOD.replace("INSERT OR REPLACE INTO ops_config (key, value) VALUES ('b;c', 'it''s; fine');", "INSERT INTO no_such_table VALUES (1);")
rc = M.apply_file("migrations/fail.sql", failing, "a", "t", "c5", emit)
ok(rc == 1 and json.loads(out[-1])["applied_before_failure"] == 1, "a failing statement returns 1 and says how many ran before it", out[-1])
ok(db.execute("SELECT status, statements FROM migration_runs WHERE file = 'migrations/fail.sql'").fetchone() == ("error", 1), "the failure is recorded in migration_runs")
M.apply_file("migrations/fail.sql", failing, "a", "t", "c6", emit)
ok(db.execute("SELECT COUNT(*) FROM agent_issues WHERE title = 'MIGRATION-APPLY-FAILED-1: fail.sql' AND status = 'open'").fetchone()[0] == 1, "one open MIGRATION-APPLY-FAILED-1 issue, not one per run")

# 6b. MIGRATION-CONCURRENT-APPLY-1: a statement that fails because another runner is applying the same file is not a failure.
real_sleep, real_wait, real_poll = M._sleep, M.CONCURRENT_WAIT_S, M.CONCURRENT_POLL_S
M.CONCURRENT_WAIT_S, M.CONCURRENT_POLL_S = 3, 0
CONC = """-- concurrent
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP TABLE IF EXISTS conc_t
CREATE TABLE conc_t (x);
CREATE TABLE conc_u (y);
"""
db.execute("CREATE TABLE conc_t (x)")  # the other runner got there first with statement 1 ...
conc_sha = __import__("hashlib").sha256(CONC.encode()).hexdigest()
polls = {"n": 0}


def other_runner_finishes(s):
    polls["n"] += 1
    if polls["n"] == 2:  # ... and records its ok row while this runner waits
        db.execute("INSERT INTO migration_runs (file, sha256, commit_sha, db, status, statements, applied_by) VALUES ('migrations/conc.sql', ?, 'cX', 'qnfo-audit', 'ok', '2', 'ci:apply-migrations')", (conc_sha,))
        db.commit()
M._sleep = other_runner_finishes
errs0 = db.execute("SELECT COUNT(*) FROM migration_runs WHERE status = 'error'").fetchone()[0]
rc = M.apply_file("migrations/conc.sql", CONC, "a", "t", "cY", emit)
last = json.loads(out[-1])
ok(rc == 0 and last.get("already_applied") and last.get("concurrent"), "a statement that meets an object the other runner created, while that runner records the same content ok, is a success", out[-1])
ok(db.execute("SELECT COUNT(*) FROM migration_runs WHERE status = 'error'").fetchone()[0] == errs0, "no error row is recorded for the concurrent loser")
ok(db.execute("SELECT COUNT(*) FROM agent_issues WHERE title = 'MIGRATION-APPLY-FAILED-1: conc.sql'").fetchone()[0] == 0, "no MIGRATION-APPLY-FAILED-1 issue is filed for it")
ok(polls["n"] == 2, "it polled the ledger until the other runner's ok row appeared, and no longer", polls)

# the same error with no other runner finishing is a real failure, recorded exactly as before (after the bounded wait)
db.execute("CREATE TABLE conc2_t (x)")
CONC2 = CONC.replace("conc_t", "conc2_t").replace("conc_u", "conc2_u").replace("-- concurrent", "-- concurrent two")
M._sleep = lambda s: None  # nobody else is applying this file: the wait runs out
M.CONCURRENT_WAIT_S = 0.05
rc = M.apply_file("migrations/conc2.sql", CONC2, "a", "t", "cZ", emit)
ok(rc == 1 and json.loads(out[-1]).get("applied_before_failure") == 0, "an already-exists failure with no other runner is still recorded as a failure", out[-1])
ok(db.execute("SELECT status FROM migration_runs WHERE file = 'migrations/conc2.sql'").fetchone() == ("error",), "its error row is recorded")
ok(db.execute("SELECT COUNT(*) FROM agent_issues WHERE title = 'MIGRATION-APPLY-FAILED-1: conc2.sql' AND status = 'open'").fetchone()[0] == 1, "and its MIGRATION-APPLY-FAILED-1 issue is filed")

# an error of another class is not waited for at all
M.CONCURRENT_WAIT_S = 3
polls3 = {"n": 0}
M._sleep = lambda s: polls3.__setitem__("n", polls3["n"] + 1)
OTHER = CONC.replace("CREATE TABLE conc_t (x);", "INSERT INTO no_such_table_2 VALUES (1);").replace("conc_t", "conc3_t").replace("conc_u", "conc3_u").replace("-- concurrent", "-- concurrent three")
rc = M.apply_file("migrations/conc3.sql", OTHER, "a", "t", "cW", emit)
ok(rc == 1 and polls3["n"] == 0, "a failure that is not an already-exists error is recorded at once, without a wait", polls3)
M._sleep, M.CONCURRENT_WAIT_S, M.CONCURRENT_POLL_S = real_sleep, real_wait, real_poll

# 7. --check never calls D1 and skips every existing migration (they were applied by hand).
n1 = len(calls)
# 5c. D1 caps a LIKE/GLOB pattern at 50 bytes (MIGRATION-APPLY-FAILED-1, issue 2046): --check rejects longer ones.
long_like = """-- long like
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: none needed
UPDATE ops_config SET value = 'y' WHERE key = 'a' AND value NOT LIKE '%code-task: repo=qnfo-workers path=idea-hub/worker.js%';
"""
okp, probs, inf = M.plan("migrations/long.sql", long_like)
ok(okp and any("LIKE/GLOB pattern of 54 bytes" in p for p in probs), "a 54-byte LIKE pattern is a --check problem", probs)
short_like = long_like.replace("'%code-task: repo=qnfo-workers path=idea-hub/worker.js%'", "'%TRIGGER-CODE-TASK-LINES-1%'")
okp, probs, inf = M.plan("migrations/short.sql", short_like)
ok(okp and not probs, "a short LIKE pattern and instr() pass", probs)
# 5d. METRIC-CADENCE-CHECK-1 (issue 2063): the D1 triggers metric_registry_cadence_canonical_* abort a refresh_cadence that
# is not a canonical token; --check runs the triggers' own expression on every literal cadence a file writes.
for c, rej in [("hourly", False), ("Daily", False), ("2h", False), ("30m", False), ("*/15", False), ("*/3h", False), ("", False),
               ("hourly (D1 triggers metric_orphan_issues_au/ai)", True), ("every hour", True), ("0 * * * *", True), ("fortnightly", True)]:
    ok(M.cadence_rejected(c) is rej, "cadence %r is %s like the D1 trigger" % (c, "refused" if rej else "accepted"))
for sql, want in [
        ("INSERT INTO metric_registry (metric, refresh_cadence) VALUES ('a', 'hourly'), ('b', 'every (2) hours'), ('c', 'it''s 2h');", ["hourly", "every (2) hours", "it's 2h"]),
        ("INSERT OR IGNORE INTO metric_registry (metric, formula, refresh_cadence) SELECT 'm', 'f(x, y)', 'daily (x)' WHERE NOT EXISTS (SELECT 1 FROM t);", ["daily (x)"]),
        ("INSERT INTO metric_registry (metric, refresh_cadence) SELECT 'm', 'weekly' FROM t;", ["weekly"]),
        ("UPDATE metric_registry SET last_value = '1', refresh_cadence = '0 * * * *' WHERE metric = 'x';", ["0 * * * *"]),
        ("INSERT INTO metric_registry (metric, refresh_cadence) VALUES ('a', lower('HOURLY'));", []),
        ("INSERT INTO other (metric, refresh_cadence) VALUES ('a', 'bad one');", []),
        ("INSERT INTO metric_registry (metric, last_value) VALUES ('a', 'x y');", [])]:
    ok(M.metric_cadences(M.body(sql)) == want, "the cadences a statement writes are found: " + sql[:60], M.metric_cadences(M.body(sql)))
bad_cad = """-- cadence
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM metric_registry WHERE metric = 'm';
INSERT OR IGNORE INTO metric_registry (metric, layer, kind, refresh_cadence, state) VALUES
 ('m', 'operational', 'guard', 'hourly (D1 triggers metric_orphan_issues_au/ai on the open_agent_issues refresh)', 'MEASURED');
"""
okp, probs, inf = M.plan("migrations/cad.sql", bad_cad)
ok(okp and any("METRIC-CADENCE-CANONICAL-1" in p for p in probs), "the 2063 cadence is a --check problem", probs)
okp, probs, inf = M.plan("migrations/cad.sql", bad_cad.replace("'hourly (D1 triggers metric_orphan_issues_au/ai on the open_agent_issues refresh)'", "'hourly'"))
ok(okp and not probs, "the canonical 'hourly' passes", probs)
# D1-TRIGGER-DEPTH-1: upstream reachability, the canary drops a trigger D1 would refuse, ADD COLUMN re-runs are idempotent.
rows = [{"sql": "CREATE TRIGGER a AFTER INSERT ON cron_log BEGIN INSERT INTO tick (s) VALUES (1); END"},
        {"sql": "CREATE TRIGGER b AFTER INSERT ON tick BEGIN UPDATE issues SET x = 1; END"},
        {"sql": "CREATE TRIGGER c AFTER UPDATE ON other BEGIN DELETE FROM unrelated; END"}]
ok(M.trigger_upstream(rows, "issues") == {"issues", "tick", "cron_log"}, "upstream of issues is tick and cron_log, not other", M.trigger_upstream(rows, "issues"))
db.execute("CREATE TABLE heartbeat (w TEXT)")
db.execute("CREATE TABLE ticks (s TEXT)")
db.commit()
real_call = C.call
def deep_call(method, path, token, body=None, timeout=60):
    if " WHERE 0" in body["sql"] and '"heartbeat"' in body["sql"] and db.execute("SELECT 1 FROM sqlite_master WHERE name = 'hb_feed'").fetchone():
        return 400, {"success": False, "errors": [{"code": 7500, "message": "triggers nested too deep: SQLITE_ERROR"}]}
    return real_call(method, path, token, body, timeout)
C.call = deep_call
deep = """-- depth test
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP TRIGGER IF EXISTS hb_feed
CREATE TRIGGER IF NOT EXISTS hb_feed AFTER INSERT ON heartbeat BEGIN INSERT INTO ticks (s) VALUES (NEW.w); END;
INSERT OR REPLACE INTO ops_config (key, value) VALUES ('after_deep', '1');
"""
rc = M.apply_file("migrations/deep.sql", deep, "a", "t", "c7", emit)
ok(rc == 1 and "D1-TRIGGER-DEPTH-1" in out[-1] and not db.execute("SELECT 1 FROM sqlite_master WHERE name = 'hb_feed'").fetchone()
   and not db.execute("SELECT 1 FROM ops_config WHERE key = 'after_deep'").fetchone(), "a trigger that makes a write too deep is dropped at once and the file stops", out[-1])
# MIGRATION-STALE-SHA-1: a content that failed is not replayed once a newer content of the file applied ok (a late run on an older commit).
STALE_BAD = """-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM ops_config WHERE key = 'stale'
INSERT INTO no_such_table_stale (x) VALUES (1);
"""
STALE_GOOD = STALE_BAD.replace("INSERT INTO no_such_table_stale (x) VALUES (1);", "INSERT OR REPLACE INTO ops_config (key, value) VALUES ('stale', 'fixed');")
ok(M.apply_file("migrations/stale.sql", STALE_BAD, "a", "t", "old", emit) == 1, "the first content of the file fails")
ok(M.apply_file("migrations/stale.sql", STALE_GOOD, "a", "t", "new", emit) == 0, "its repair applies ok")
n_err = db.execute("SELECT COUNT(*) FROM migration_runs WHERE file = 'migrations/stale.sql' AND status = 'error'").fetchone()[0]
n_iss = db.execute("SELECT COUNT(*) FROM agent_issues WHERE title LIKE '%stale.sql%' AND status = 'open'").fetchone()[0]
rc = M.apply_file("migrations/stale.sql", STALE_BAD, "a", "t", "old", emit)
ok(rc == 0 and '"superseded": true' in out[-1] and "MIGRATION-STALE-SHA-1" in out[-1], "a late run on the older commit skips the failed content as superseded", out[-1])
ok(db.execute("SELECT COUNT(*) FROM migration_runs WHERE file = 'migrations/stale.sql' AND status = 'error'").fetchone()[0] == n_err, "the replay writes no error row")
ok(db.execute("SELECT COUNT(*) FROM agent_issues WHERE title LIKE '%stale.sql%' AND status = 'open'").fetchone()[0] == n_iss, "the replay files or reopens no issue")
NEVER_FAILED = STALE_GOOD.replace("'fixed'", "'third'")
ok(M.apply_file("migrations/stale.sql", NEVER_FAILED, "a", "t", "newer", emit) == 0 and '"ok": true' in out[-1], "a content that never failed still runs", out[-1])

# D1-TRIGGER-DEPTH-RETRY-1: the same content is not re-run (each re-run re-creates the trigger and fails writes until the canary drops it).
n_retry = len(calls)
rc = M.apply_file("migrations/deep.sql", deep, "a", "t", "c7b", emit)
created_again = [q for q in calls[n_retry:] if q.lstrip().upper().startswith("CREATE TRIGGER")]
ok(rc == 1 and "D1-TRIGGER-DEPTH-RETRY-1" in out[-1] and not created_again, "a file the depth canary refused is not re-run with the same content", (out[-1], calls[n_retry:]))
ok(db.execute("SELECT COUNT(*) FROM migration_runs WHERE file = 'migrations/deep.sql' AND status = 'error'").fetchone()[0] == 1,
   "and the refused retry adds no second error row")
rc = M.apply_file("migrations/deep.sql", deep.replace("-- depth test", "-- depth test, changed"), "a", "t", "c7c", emit)
ok(rc == 1 and "D1-TRIGGER-DEPTH-1" in out[-1] and "RETRY" not in out[-1], "a changed file (new sha256) runs again", out[-1])
C.call = real_call
shallow = deep.replace("migrations/deep", "x")
rc = M.apply_file("migrations/shallow.sql", shallow, "a", "t", "c8", emit)
ok(rc == 0 and db.execute("SELECT 1 FROM sqlite_master WHERE name = 'hb_feed'").fetchone(), "a trigger within the limit stays", out[-1])

# D1-TRIGGER-DEPTH-PROBE-STAR-1 (2026-10-18, migration_runs 292): the canary must never ask with
# `INSERT INTO t SELECT * FROM t WHERE 0`. On a table whose own triggers write back to it, D1 refuses that form at
# COMPILE time whatever the trigger under test contains (measured on qnfo-audit.agent_issues with the ORIGINAL trigger in
# place), so the canary would report a depth fault that does not exist - and the caller then drops a working trigger,
# which is how production lost agent_issues_autotriage2_ins. The explicit-column form asks the same question.
n_star = len(calls)
ok(M.depth_canary("a", "t", "db", "ticks") is None, "a shallow table passes the canary")
star_probes = [q for q in calls[n_star:] if q.lstrip().upper().startswith("INSERT") and "SELECT *" in q]
ok(not star_probes, "the canary probes the insert with an explicit column list, never a star select", star_probes)
insert_probes = [q for q in calls[n_star:] if q.lstrip().upper().startswith("INSERT")]
ok(any('"ticks"' in q and '"s"' in q for q in insert_probes),
   "and it still compiles a zero-row insert through the table", insert_probes)

# D1-TRIGGER-DEPTH-RESTORE-1: when the canary does refuse, the definition the file replaced comes back, so the table is
# not left without the trigger the migration was only trying to adjust.
db.execute("CREATE TABLE hb2 (w TEXT)")
db.commit()
db.execute("CREATE TRIGGER hb_prior AFTER INSERT ON hb2 BEGIN INSERT INTO ticks (s) VALUES (NEW.w); END")
db.commit()


def deep2_call(method, path, token, body=None, timeout=60):
    if " WHERE 0" in body["sql"] and '"hb2"' in body["sql"]:
        return 400, {"success": False, "errors": [{"code": 7500, "message": "triggers nested too deep: SQLITE_ERROR"}]}
    return real_call(method, path, token, body, timeout)


C.call = deep2_call
replace_prior = """-- replace a standing trigger
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: ops_config
-- Rollback: DROP TRIGGER IF EXISTS hb_prior
DROP TRIGGER IF EXISTS hb_prior;
CREATE TRIGGER hb_prior AFTER INSERT ON hb2 BEGIN INSERT INTO ticks (s) VALUES ('x'); END;
"""
rc = M.apply_file("migrations/prior.sql", replace_prior, "a", "t", "c9", emit)
row = db.execute("SELECT sql FROM sqlite_master WHERE name = 'hb_prior'").fetchone()
ok(rc == 1 and "D1-TRIGGER-DEPTH-1" in out[-1] and row is not None and "NEW.w" in row[0] and "restored" in out[-1],
   "a refused replacement puts the standing trigger back", (out[-1], row))
C.call = real_call

# TRIGGER-DEPTH-INSERT-ADVISORY-1: a refused INSERT probe does not veto the file on its own. On qnfo-audit.agent_issues
# every `INSERT ... SELECT` zero-row probe is refused whatever the trigger contains (measured 13:14Z), while UPDATE and
# DELETE compile, so an INSERT-only refusal is a property of the statement shape, not of the trigger - and acting on it
# deleted a working trigger twice. UPDATE/DELETE still decide.
db.execute("CREATE TABLE hb3 (w TEXT)")
db.commit()


def ins_only_call(method, path, token, body=None, timeout=60):
    s = body["sql"]
    if s.lstrip().upper().startswith("INSERT") and '"hb3"' in s and " WHERE 0" in s:
        return 400, {"success": False, "errors": [{"code": 7500, "message": "triggers nested too deep: SQLITE_ERROR"}]}
    return real_call(method, path, token, body, timeout)


C.call = ins_only_call
ins_file = """-- insert-only refusal
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP TRIGGER IF EXISTS hb_ins
CREATE TRIGGER hb_ins AFTER INSERT ON hb3 BEGIN INSERT INTO ticks (s) VALUES (NEW.w); END;
"""
rc = M.apply_file("migrations/ins.sql", ins_file, "a", "t", "c10", emit)
ok(rc == 0 and '"advisory"' in out[-1] and db.execute("SELECT 1 FROM sqlite_master WHERE name = 'hb_ins'").fetchone() is not None,
   "a refused INSERT probe is an advisory, not a veto: the file applies and the trigger stays", out[-1])
ok(db.execute("SELECT status FROM migration_runs WHERE file = 'migrations/ins.sql'").fetchone() == ("ok",),
   "and the run is recorded ok", db.execute("SELECT status FROM migration_runs WHERE file = 'migrations/ins.sql'").fetchone())
C.call = real_call

# TRIGGER-COMPILE-CANARY-1 (2026-11-04): a trigger whose body reads a column that does not exist fails every insert into its table at prepare time (the
# fleet_tick outage 16:43-16:58Z: outcome_northstar_tick read ask_feedback.created_at). The canary's zero-row INSERT probe sees it; it now refuses the trigger.
db.execute("CREATE TABLE tk (src TEXT)")
db.execute("CREATE TABLE ask_fb (event_id TEXT, ts TEXT)")
db.commit()
cc_bad = """-- compile canary
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP TRIGGER IF EXISTS tk_bad; DROP VIEW IF EXISTS v_bad_cc
CREATE VIEW IF NOT EXISTS v_bad_cc AS SELECT count(*) AS value FROM ask_fb WHERE created_at >= datetime('now', '-7 day');
CREATE TRIGGER IF NOT EXISTS tk_bad AFTER INSERT ON tk WHEN strftime('%M', 'now') < '10' BEGIN INSERT INTO ticks (s) SELECT value FROM v_bad_cc; END;
INSERT OR REPLACE INTO ops_config (key, value) VALUES ('after_cc', '1');
"""
rc = M.apply_file("migrations/cc_bad.sql", cc_bad, "a", "t", "cc1", emit)
ok(rc == 1 and "TRIGGER-COMPILE-1" in out[-1] and "no such column" in out[-1] and not db.execute("SELECT 1 FROM sqlite_master WHERE name = 'tk_bad'").fetchone()
   and not db.execute("SELECT 1 FROM ops_config WHERE key = 'after_cc'").fetchone(),
   "a trigger whose body no longer compiles is dropped at once and the file stops", out[-1])
try:
    db.execute("INSERT INTO tk (src) VALUES ('after the refusal')")
    insert_ok = True
except Exception as e:  # noqa: BLE001
    insert_ok = False
ok(insert_ok, "and inserts into its table work again")
n_cc = len(calls)
rc = M.apply_file("migrations/cc_bad.sql", cc_bad, "a", "t", "cc1b", emit)
created_cc = [q for q in calls[n_cc:] if q.lstrip().upper().startswith("CREATE TRIGGER")]
ok(rc == 1 and "D1-TRIGGER-DEPTH-RETRY-1" in out[-1] and not created_cc, "the same content is not re-run after a compile refusal", (out[-1], created_cc))

# A fault that was already there (a broken trigger written by someone else) is not blamed on the new trigger: it is reported and the file applies.
db.execute("CREATE TABLE tk2 (src TEXT)")
db.execute("CREATE TRIGGER tk2_old AFTER INSERT ON tk2 BEGIN INSERT INTO ticks (s) SELECT missing_col FROM tk2; END")
db.commit()
cc_pre = """-- pre-existing compile fault
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP TRIGGER IF EXISTS tk2_new
CREATE TRIGGER tk2_new AFTER INSERT ON tk2 BEGIN INSERT INTO ticks (s) VALUES ('new'); END;
"""
rc = M.apply_file("migrations/cc_pre.sql", cc_pre, "a", "t", "cc2", emit)
ok(rc == 0 and "pre-existing compile error" in out[-1] and db.execute("SELECT 1 FROM sqlite_master WHERE name = 'tk2_new'").fetchone() is not None,
   "a compile fault that predates the trigger is an advisory, and the trigger stays", out[-1])

# TRIGGER-COMPILE-CANARY-1, second route: no trigger is created, a VIEW that an existing fleet_tick trigger reads is replaced with one that does not compile.
db.execute("CREATE TABLE IF NOT EXISTS fleet_tick (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT)")
db.execute("CREATE VIEW v_late AS SELECT s AS v FROM ticks")
db.execute("CREATE TRIGGER ft_user AFTER INSERT ON fleet_tick BEGIN INSERT INTO ticks (s) SELECT v FROM v_late; END")
db.commit()
cc_view = """-- view breaks the tick
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: ops_config
-- Rollback: DROP VIEW IF EXISTS v_late
DROP VIEW IF EXISTS v_late;
CREATE VIEW v_late AS SELECT missing_col AS v FROM ticks;
INSERT OR REPLACE INTO ops_config (key, value) VALUES ('after_cc_view', '1');
"""
rc = M.apply_file("migrations/cc_view.sql", cc_view, "a", "t", "cc3", emit)
view_sql = db.execute("SELECT sql FROM sqlite_master WHERE name = 'v_late'").fetchone()
try:
    db.execute("INSERT INTO fleet_tick (source) VALUES ('after the view refusal')")
    tick_ok = True
except Exception as e:  # noqa: BLE001
    tick_ok = False
ok(rc == 1 and "TRIGGER-COMPILE-1" in out[-1] and "fleet_tick" in out[-1] and "v_late" in out[-1] and view_sql is not None and "s AS v" in view_sql[0] and tick_ok,
   "a file that breaks the tick insert through a view is failed and the view is put back", (out[-1], view_sql, tick_ok))
addcol = """-- add column twice
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: none needed
ALTER TABLE ticks ADD COLUMN extra TEXT;
INSERT OR REPLACE INTO ops_config (key, value) VALUES ('addcol', '1');
"""
M.apply_file("migrations/addcol.sql", addcol, "a", "t", "c9", emit)
rc = M.apply_file("migrations/addcol.sql", addcol + "-- changed\n", "a", "t", "c10", emit)
ok(rc == 0, "a re-run meets the column it already added and carries on", out[-1])
n1 = len(calls)
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    rc = M.main(["--check", "--history"] + sorted(glob.glob(os.path.join(HERE, "..", "migrations", "*.sql"))))
lines = [json.loads(l) for l in buf.getvalue().splitlines() if l.strip()]
ok(rc == 0 and len(calls) == n1 and lines and all("skipped" in l or l.get("ok") for l in lines), "--check passes the repository's migrations without touching D1", [l for l in lines if not ("skipped" in l or l.get("ok"))][:3])

# BACKUP-CREATES-1 (#856): a backup the file creates itself counts even when no statement is destructive.
mk_hdr = "-- APPLY-BY: ci\n-- DB: qnfo-audit\n-- BACKUP: bak_x\n-- Rollback: DELETE FROM t;\n"
_, _, info_a = M.plan("migrations/a.sql", mk_hdr + "CREATE TABLE IF NOT EXISTS bak_x AS SELECT 1 AS a;\nUPDATE t SET a = 1;\n")
_, _, info_b = M.plan("migrations/b.sql", mk_hdr + "UPDATE t SET a = 1;\n")
ok(info_a["creates_backup"] is True and info_b["creates_backup"] is False, "backup created by the file is recognised without a destructive statement", (info_a, info_b))

# CHECK-ENUM-LINT-1 (2026-10-12, migration_runs 119/120): a literal a register's CHECK constraint refuses fails --check offline.
en_hdr = "-- APPLY-BY: ci\n-- DB: qnfo-audit\n-- Rollback: DELETE FROM control_registry WHERE control = 'x';\n"
bad_sql = en_hdr + ("INSERT OR REPLACE INTO control_registry (control, location, kind, guards_against, critical_path, disposition, disposition_state, evidence) VALUES\n"
                    " ('x', 'here', 'guard', 'a, b', 0, 'keep', 'applied', 'e'),\n ('y', 'there (loop)', 'audit', 'c', 0, 'keep', 'applied', 'e');\n")
_, probs_bad, _ = M.plan("migrations/bad.sql", bad_sql)
ok(any("control_registry.kind 'audit'" in p for p in probs_bad) and len([p for p in probs_bad if "CHECK-ENUM-LINT-1" in p]) == 1, "an INSERT with kind 'audit' is refused by --check and the good row passes", probs_bad)
good_sql = en_hdr + "INSERT OR REPLACE INTO control_registry (control, location, kind, disposition, disposition_state, evidence) VALUES ('x', 'h, (k)', 'gate', 'remove', 'planned', 'it''s fine');\n"
_, probs_good, _ = M.plan("migrations/good.sql", good_sql)
ok(not [p for p in probs_good if "CHECK-ENUM-LINT-1" in p], "allowed literals (with commas, parentheses and quotes in other columns) pass", probs_good)
_, probs_sel, _ = M.plan("migrations/sel.sql", en_hdr + "INSERT INTO control_registry (control, kind, disposition, disposition_state, evidence) SELECT 'z', 'bogus', 'keep', 'applied', 'e' WHERE 1;\n")
ok(not [p for p in probs_sel if "CHECK-ENUM-LINT-1" in p], "an INSERT ... SELECT is not parsed as VALUES (no false claim)", probs_sel)
ok(M.enum_violations("INSERT INTO other_table (kind) VALUES ('audit')") == [], "tables without a known constraint are not judged")

# CONTROL-PROBE-AT-BIRTH-1 (2026-10-26, agent_issues 1000483): a control registered with an alternate_path carries its probe, or says why not.
cp_cols = "(control, location, kind, disposition, disposition_state, alternate_path, evidence)"
cp_row = "('%s', 'here', 'gate', 'keep', 'applied', 'the lever it names', '%s')"
cp_ins = "INSERT OR IGNORE INTO control_registry " + cp_cols + " VALUES\n "
cp_probe = ("INSERT OR IGNORE INTO control_alternate_probes (control, probe_sql, window_note, enabled)\nSELECT c.control, 'SELECT ''ok'' AS expected, "
            "CASE WHEN 1 THEN ''x'' ELSE ''ok'' END AS observed', '60 minutes', 1 FROM control_registry c WHERE c.control = '%s';\n")


def cp_problems(text, birth=True):
    return [p for p in M.plan("migrations/cp.sql", text, birth=birth)[1] if "CONTROL-PROBE-AT-BIRTH-1" in p]


cp_one = en_hdr + cp_ins + cp_row % ("ctl-a", "e") + ";\n"
ok(cp_problems(cp_one + cp_probe % "ctl-a") == [], "a control insert with its probe row passes")
cp_no = cp_problems(cp_one)
ok(len(cp_no) == 1 and "ctl-a" in cp_no[0], "a control insert with an alternate_path and no probe is refused, naming the control", cp_no)
ok(all(w in cp_no[0] for w in ("control, probe_sql, window_note, enabled", "SELECT ''ok'' AS expected", "AS observed", "read-only", "2026-10-26-control-alternate-probes4.sql",
                               "ALTERNATE-NOT-EXERCISABLE", "CONTROL-PROBE: none")),
   "and the message names the probe columns, its shape, the example file and both ways out", cp_no)
ok(cp_problems(en_hdr + cp_ins + cp_row % ("ctl-a", "no drill is possible: ALTERNATE-NOT-EXERCISABLE") + ";\n") == [], "the reason text ALTERNATE-NOT-EXERCISABLE in the control's evidence passes")
ok(cp_problems(en_hdr + "-- CONTROL-PROBE: none (the alternate is a person)\n" + cp_ins + cp_row % ("ctl-a", "e") + ";\n") == [], "the header line CONTROL-PROBE: none (<reason>) passes")
cp_bare = cp_problems(en_hdr + "-- CONTROL-PROBE: none\n" + cp_ins + cp_row % ("ctl-a", "e") + ";\n")
ok(len(cp_bare) == 1 and "CONTROL-PROBE header must read" in cp_bare[0], "the header opt-out without a reason in parentheses is refused", cp_bare)
ok(cp_problems(en_hdr + "UPDATE control_registry SET evidence = 'edited', alternate_path = 'moved' WHERE control = 'ctl-a';\n") == [], "an edit of an existing control row passes")
ok(cp_problems(en_hdr + "INSERT INTO control_registry (control, location, kind, disposition, disposition_state, evidence) VALUES ('ctl-b', 'h', 'gate', 'keep', 'applied', 'e');\n") == [],
   "a control inserted with no alternate_path (the view reads no-alternate) needs no probe")
ok(cp_problems(en_hdr + cp_ins + cp_row % ("ctl-a", "e") + ";\n" + cp_probe % "ctl-other") != [], "a probe row for another control does not cover this one")
cp_multi = (en_hdr + cp_ins + ",\n ".join(cp_row % ("ctl-%d" % n, "ALTERNATE-NOT-EXERCISABLE" if n == 0 else "e") for n in range(9)) + ";\n"
            + "".join(cp_probe % ("ctl-%d" % n) for n in (1, 2)))
cp_m = cp_problems(cp_multi)
ok(len(cp_m) == 1 and "ctl-3" in cp_m[0] and "and 1 more" in cp_m[0] and "ctl-0" not in cp_m[0] and "ctl-1," not in cp_m[0],
   "a multi-row insert judges each row: the marker covers its own row, the probes theirs, five names are listed and the rest counted", cp_m)
cp_select = en_hdr + ("INSERT INTO control_registry (control, location, kind, disposition, disposition_state, alternate_path, evidence) "
                      "SELECT 'ctl-s', 'h', 'gate', 'keep', 'applied', 'alt', 'e' WHERE 1;\n")
ok(cp_problems(cp_select) != [] and cp_problems(cp_select + cp_probe % "ctl-s") == [], "an INSERT ... SELECT of a control is judged too (any probe row in the file covers it)")
ok(cp_problems(cp_one, birth=False) == [] and [p for p in M.plan("migrations/cp.sql", cp_one)[1] if "CONTROL-PROBE-AT-BIRTH-1" in p] == [] and cp_problems(cp_one) != [],
   "plan() asks only when birth=True, so apply_file and the tests that plan() a merged file never refuse it for a missing probe")
cp_cli = io.StringIO()
cp_tmp = os.path.join(HERE, "_cp_gate_tmp.sql")
open(cp_tmp, "w", encoding="utf-8", newline="\n").write(cp_one)
try:
    with contextlib.redirect_stdout(cp_cli):
        rc_check = M.main(["--check", cp_tmp])
    with contextlib.redirect_stdout(io.StringIO()):
        rc_hist = M.main(["--check", "--history", cp_tmp])
finally:
    os.remove(cp_tmp)
ok(rc_check == 1 and "CONTROL-PROBE-AT-BIRTH-1" in cp_cli.getvalue() and rc_hist == 0, "--check refuses the file and --check --history lets it through", (rc_check, rc_hist, cp_cli.getvalue()[:120]))
for good_file in ("2026-10-20-apply-migrations-lint.sql", "2026-10-26-control-alternate-probes4.sql", "2026-10-26-control-probe-at-birth.sql"):
    gp = os.path.join(HERE, "..", "migrations", good_file)
    ok(os.path.exists(gp) and cp_problems(open(gp, encoding="utf-8").read()) == [], "the sibling migration " + good_file + " that ships its probes passes")

# APPEND-ONLY-LINT-1 (2026-10-13): decision_log and issue_lifecycle refuse UPDATE, DELETE and REPLACE at apply time.
for stmt in ("UPDATE decision_log SET outcome = 'x' WHERE id = 1;", "DELETE FROM issue_lifecycle WHERE id = 1;",
             "INSERT OR REPLACE INTO decision_log (id, actor) VALUES (1, 'a');", "UPDATE OR IGNORE \"decision_log\" SET actor = 'b';"):
    _, pr, _ = M.plan("migrations/ao.sql", en_hdr + stmt + "\n")
    ok(any("APPEND-ONLY-LINT-1" in p for p in pr), "a write to an append-only table is refused: " + stmt[:40], pr)
_, pr, _ = M.plan("migrations/ao-ok.sql", en_hdr + "INSERT INTO decision_log (actor) VALUES ('a');\nUPDATE decision_log_view_cache SET x = 1;\n")
ok(not [p for p in pr if "APPEND-ONLY-LINT-1" in p], "an INSERT into decision_log and a table that only shares the prefix pass", pr)

# BACKUP-CREATES-2 (2026-10-13, migration_runs 134): CREATE TABLE <backup> (...) + INSERT INTO <backup> SELECT is a self-made backup.
pair = ("-- APPLY-BY: ci\n-- DB: qnfo-audit\n-- BACKUP: bak_pair\n-- Rollback: restore from bak_pair\n"
        "CREATE TABLE IF NOT EXISTS bak_pair (name TEXT, sql TEXT);\nINSERT INTO bak_pair (name, sql) SELECT name, sql FROM sqlite_master WHERE type = 'trigger';\n"
        "DROP TRIGGER IF EXISTS t1;\n")
_, pr, inf = M.plan("migrations/pair.sql", pair)
ok(not pr and inf.get("creates_backup"), "a CREATE + INSERT ... SELECT backup ahead of the DROP counts as self-made", (pr, inf))
_, pr, inf = M.plan("migrations/pair-late.sql", pair.replace("DROP TRIGGER IF EXISTS t1;\n", "").replace("CREATE TABLE IF NOT EXISTS bak_pair", "DROP TRIGGER IF EXISTS t1;\nCREATE TABLE IF NOT EXISTS bak_pair"))
ok(not inf.get("creates_backup"), "a backup made after the DROP does not count", inf)
_, pr, inf = M.plan("migrations/pair-empty.sql", pair.replace("INSERT INTO bak_pair (name, sql) SELECT name, sql FROM sqlite_master WHERE type = 'trigger';\n", ""))
ok(not inf.get("creates_backup"), "an empty CREATE TABLE without the INSERT ... SELECT does not count", inf)
ok(any("BACKUP-SELF-EMPTY-1" in p for p in pr), "--check refuses a BACKUP the file only creates empty (it fails on main otherwise)", pr)
# BACKUP-SELF-EMPTY-1 (2026-10-14, migration_runs 244): a new ledger named as its own BACKUP, with nothing deleted, is refused at --check.
_, pr, inf = M.plan("migrations/self-empty.sql", "-- APPLY-BY: ci\n-- DB: qnfo-audit\n-- BACKUP: new_ledger\n-- Rollback: DROP TABLE IF EXISTS new_ledger\n"
                    "CREATE TABLE IF NOT EXISTS new_ledger (id INTEGER PRIMARY KEY, ts TEXT);\n")
ok(any("BACKUP-SELF-EMPTY-1" in p for p in pr), "a file naming the table it creates as BACKUP is refused", pr)
_, pr, inf = M.plan("migrations/no-backup.sql", "-- APPLY-BY: ci\n-- DB: qnfo-audit\n-- Rollback: DROP TABLE IF EXISTS new_ledger\n"
                    "CREATE TABLE IF NOT EXISTS new_ledger (id INTEGER PRIMARY KEY, ts TEXT);\n")
ok(not pr, "the same file without the BACKUP line passes (it deletes nothing)", pr)

# STEP-SCHEMA-LINT-1 (2026-10-18, fleet_runs 10278): a fleet_tasks workflow step without "type" passed --check and then
# aborted its run with "unsupported step type: undefined". The shape below is the one that reached production.
def steps_task(doc, extra_header=""):
    return (en_hdr + extra_header + "INSERT OR REPLACE INTO fleet_tasks (id, type, definition) VALUES "
            "('t', 'workflow', '" + doc.replace("'", "''") + "');\n")


_, pr, _ = M.plan("migrations/steps-nokind.sql", steps_task('{"steps":[{"name":"a","db":"AUDIT","sql":"SELECT 1"}]}'))
ok(any("STEP-SCHEMA-LINT-1" in p and "undefined" in p for p in pr), "a step without type is refused, naming the runtime error", pr)
_, pr, _ = M.plan("migrations/steps-emptykind.sql", steps_task('{"steps":[{"type":"","db":"AUDIT","sql":"SELECT 1"}]}'))
ok(any("STEP-SCHEMA-LINT-1" in p for p in pr), "an empty type is refused", pr)
_, pr, _ = M.plan("migrations/steps-ok.sql", steps_task('{"steps":[{"type":"sql","name":"a","db":"AUDIT","sql":"SELECT 1"}]}'))
ok(not [p for p in pr if "STEP-SCHEMA-LINT-1" in p], "a well-formed sql step passes", pr)
_, pr, _ = M.plan("migrations/steps-noname.sql", steps_task('{"steps":[{"type":"sql","db":"AUDIT","sql":"SELECT 1"}]}'))
ok(not [p for p in pr if "STEP-SCHEMA-LINT-1" in p], "a step without name passes (151 of 184 live steps carry none)", pr)
_, pr, _ = M.plan("migrations/steps-nodb.sql", steps_task('{"steps":[{"type":"sql","name":"a","sql":"SELECT 1"}]}'))
ok(any('has no "db"' in p for p in pr), "a sql step without db is refused", pr)
_, pr, _ = M.plan("migrations/steps-nosql.sql", steps_task('{"steps":[{"type":"sql","name":"a","db":"AUDIT"}]}'))
ok(any('has no "sql"' in p for p in pr), "a sql step without sql is refused", pr)
_, pr, _ = M.plan("migrations/steps-http-ok.sql", steps_task('{"steps":[{"type":"http","url":"https://fleet.qnfo.org/api/decision?refresh=1","method":"GET"}]}'))
ok(not [p for p in pr if "STEP-SCHEMA-LINT-1" in p], "the live http step shape passes", pr)
_, pr, _ = M.plan("migrations/steps-http-nourl.sql", steps_task('{"steps":[{"type":"http","name":"h","method":"GET"}]}'))
ok(any('has no "url"' in p for p in pr), "an http step without url is refused", pr)
_, pr, _ = M.plan("migrations/steps-probe.sql", steps_task('{"steps":[{"type":"probe","url":"x"}]}'))
ok(any("not a type the runner executes" in p for p in pr), "an unknown type is refused", pr)
_, pr, _ = M.plan("migrations/steps-probe-hdr.sql",
                  steps_task('{"steps":[{"type":"probe","url":"x"}]}', extra_header="-- STEP-TYPES: sql,http,probe\n"))
ok(not [p for p in pr if "STEP-SCHEMA-LINT-1" in p], "a '-- STEP-TYPES:' header line admits a type the runner gained", pr)
_, pr, _ = M.plan("migrations/steps-quotes.sql",
                  steps_task('{"steps":[{"type":"sql","name":"a","db":"AUDIT","sql":"UPDATE t SET s=\'open\' WHERE 1"}]}'))
ok(not [p for p in pr if "STEP-SCHEMA-LINT-1" in p], "quotes doubled inside the step's sql do not break the literal scan", pr)
ok(M.step_violations("INSERT INTO t (x) VALUES ('plain text, no steps here')") == [], "a literal that is not a steps array makes no claim")

# MIGRATION-HEADER-GUARD-1 (2026-10-19): a migration without an APPLY-BY declaration but with executable SQL was skipped in silence
# (2026-10-18-subscribers-utm-attribution.sql: its ALTERs never ran). --check now refuses it; a declared or SQL-free file passes.
import tempfile  # noqa: E402


def check_file(name, text, allow=None):
    """Run --check on one file in a temp migrations folder; returns (rc, parsed output lines)."""
    d = tempfile.mkdtemp()
    p = os.path.join(d, name)
    open(p, "w", encoding="utf-8").write(text)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = M.main(["--check", p])
    return rc, [json.loads(l) for l in buf.getvalue().splitlines() if l.strip()]


ddl = "-- add a column\nALTER TABLE subscribers ADD COLUMN utm_source TEXT;\n"
rc, ls = check_file("2099-01-01-new-headerless.sql", ddl)
ok(rc == 1 and ls and "MIGRATION-HEADER-GUARD-1" in json.dumps(ls[0].get("refused")), "a new headerless file with ALTER is refused by --check", ls)
for kw in ("CREATE TABLE IF NOT EXISTS t (a TEXT);", "INSERT INTO t (a) VALUES (1);", "UPDATE t SET a = 1;", "DELETE FROM t;",
           "DROP TABLE t;", "REPLACE INTO t (a) VALUES (1);", "/* note */ CREATE VIEW v AS SELECT 1;"):
    rc, ls = check_file("2099-01-01-kw.sql", "-- note\n" + kw + "\n")
    ok(rc == 1, "headerless " + kw.split("(")[0][:30] + " is refused", ls)
rc, ls = check_file("2099-01-01-sel.sql", "-- only reads\nSELECT 1;\n")
ok(rc == 0 and "skipped" in ls[0], "a headerless file with only a SELECT needs no header", ls)
rc, ls = check_file("2099-01-01-notes.sql", "-- ALTER TABLE t ADD COLUMN x TEXT;\n-- written down, not run\n")
ok(rc == 0, "ALTER inside a comment is not executable SQL", ls)
rc, ls = check_file("2099-01-01-manual.sql", "-- APPLY-BY: manual (applied by hand on the dashboard D1)\n" + ddl)
ok(rc == 0 and "declared" in ls[0], "APPLY-BY: manual (<reason>) is accepted and reported", ls)
rc, ls = check_file("2099-01-01-none.sql", "-- APPLY-BY: none (superseded by 2099-01-02)\n" + ddl)
ok(rc == 0 and "declared" in ls[0], "APPLY-BY: none (<reason>) is accepted", ls)
rc, ls = check_file("2099-01-01-noreason.sql", "-- APPLY-BY: manual\n" + ddl)
ok(rc == 1 and "APPLY-BY: manual" in json.dumps(ls[0].get("refused")), "APPLY-BY: manual without a reason is refused", ls)
rc, ls = check_file("2099-01-01-emptyreason.sql", "-- APPLY-BY: none ( )\n" + ddl)
ok(rc == 1, "APPLY-BY: none with an empty reason is refused", ls)
rc, ls = check_file("2099-01-01-hand.sql", "-- APPLY-BY: hand\n" + ddl)
ok(rc == 1, "an unknown APPLY-BY value with SQL is refused", ls)
rc, ls = check_file("2099-01-01-late.sql", ddl + "-- APPLY-BY: ci\n-- DB: qnfo-audit\n-- Rollback: x\n")
ok(rc == 1, "an APPLY-BY line after the first statement is not a header", ls)
rc, ls = check_file("2099-01-01-ci.sql", "-- APPLY-BY: ci\n-- DB: qnfo-audit\n-- Rollback: ALTER TABLE subscribers DROP COLUMN utm_source;\n" + ddl)
ok(rc == 0 and ls[0].get("ok") is True, "an APPLY-BY: ci file is checked exactly as before", ls)
rc, ls = check_file("2099-01-01-ci-bad.sql", "-- APPLY-BY: ci\n-- DB: qnfo-audit\n" + ddl)
ok(rc == 1 and "Rollback" in json.dumps(ls[0].get("refused")), "an APPLY-BY: ci file without Rollback is still refused", ls)
# Review repair: a CTE write and a block comment followed by a trailing comment were classified 'no-sql' and passed silently.
for name, sql in (("cte-insert", "WITH x AS (SELECT 1 a) INSERT INTO t SELECT a FROM x;"),
                  ("cte-values", "WITH v(a) AS (VALUES (1)) INSERT OR IGNORE INTO t (a) SELECT a FROM v;"),
                  ("cte-update", "WITH x AS (SELECT 1 a) UPDATE t SET a = 2 WHERE a IN (SELECT a FROM x);"),
                  ("cte-delete", "with x as (select 1 a) delete from t where a in (select a from x);"),
                  ("block-then-trailing", "/* c */ -- note\nALTER TABLE t ADD COLUMN a TEXT;"),
                  ("trailing-comment", "CREATE TABLE t (a TEXT); -- done\n"),
                  ("no-semicolon", "ALTER TABLE t ADD COLUMN a TEXT")):
    rc, ls = check_file("2099-01-01-" + name + ".sql", "-- note\n" + sql + "\n")
    ok(rc == 1 and "MIGRATION-HEADER-GUARD-1" in json.dumps(ls[0].get("refused")), "headerless " + name + " is refused", ls)
for name, sql in (("cte-select", "WITH x AS (SELECT replace('a', 'b', 'c') a) SELECT a FROM x;"),
                  ("literal", "SELECT 'INSERT INTO t' AS s; -- DELETE FROM t"),
                  ("block-only", "/* ALTER TABLE t ADD COLUMN a; */"),
                  ("open-block", "SELECT 1;\n/* never closed ALTER TABLE t ADD COLUMN a;")):
    rc, ls = check_file("2099-01-01-" + name + ".sql", "-- note\n" + sql + "\n")
    ok(rc == 0 and "skipped" in ls[0], "headerless " + name + " makes no write and needs no header", ls)
ok(M.headerless_verdict("migrations/x.sql", ddl, allow={"x.sql"})[0] == "grandfathered", "a listed file is grandfathered")
ok(M.headerless_verdict("migrations/y.sql", ddl, allow={"x.sql"})[0] == "refused", "a name that is not listed is refused")

# The allowlist is shrink-only: every listed file exists, is still headerless and still carries executable SQL; a file that gained a
# header (or lost its SQL) must leave the list, so the list cannot hide a file the runner now applies.
names, expires = M.load_allowlist()
mig_dir = os.path.join(HERE, "..", "migrations")
ok(len(names) == 0 and expires is not None, "the allowlist is empty (MIGRATION-HEADERLESS-AUDIT-1, 2026-10-20: every grandfathered file declares APPLY-BY) and still parses its EXPIRES date", (len(names), expires))
stale = []
for n in sorted(names):
    fp = os.path.join(mig_dir, n)
    if not os.path.exists(fp):
        stale.append(n + " (missing)")
        continue
    t = open(fp, encoding="utf-8").read()
    if M.plan(fp, t)[0] or M.header_value(M.header(t), "APPLY-BY") or not M.has_executable(t):
        stale.append(n + " (has a header or no executable SQL; remove it from the list)")
ok(not stale, "the allowlist holds no file that has gained a header, lost its SQL or been removed", stale[:5])
unlisted = []
for fp in sorted(glob.glob(os.path.join(mig_dir, "*.sql"))):
    t = open(fp, encoding="utf-8").read()
    if not M.plan(fp, t)[0] and M.headerless_verdict(fp, t)[0] == "refused":
        unlisted.append(os.path.basename(fp))
ok(not unlisted, "every headerless migration with SQL in the repository is on the allowlist or declared", unlisted[:5])
exp = os.path.join(tempfile.mkdtemp(), "al.txt")
open(exp, "w").write("# comment\n# EXPIRES: 2020-01-01\nmigrations/a.sql\nb.sql\n")
ok(M.load_allowlist(exp) == ({"a.sql", "b.sql"}, "2020-01-01"), "load_allowlist reads names (path or bare) and the EXPIRES date", M.load_allowlist(exp))

# MIGRATION-NO-CLOBBER-1 (issue 3009): an edited, already-merged file may not rewrite a live definition row without a REAPPLY-OK line.
HDR = "-- APPLY-BY: ci\n-- DB: qnfo-audit\n-- Rollback: DELETE FROM fleet_tasks WHERE id='t';\n"
BASE_TXT = HDR + "INSERT OR REPLACE INTO fleet_tasks (id, definition) VALUES ('t', '{\"steps\":[1,2,3]}');\n"
ok(M.clobber_problems(BASE_TXT, None) == [], "a new file is never refused by the clobber guard")
ok(M.clobber_problems(BASE_TXT, BASE_TXT) == [], "an unchanged file is not refused")
edited = BASE_TXT + "-- a comment added later\n"
r = M.clobber_problems(edited, BASE_TXT)
ok(len(r) == 1 and "fleet_tasks" in r[0] and "MIGRATION-NO-CLOBBER-1" in r[0], "an edited file that rewrites a fleet_tasks row is refused", r)
ok(M.clobber_problems("-- REAPPLY-OK: the definition is intentionally re-asserted\n" + edited, BASE_TXT) == [], "a REAPPLY-OK line allows the re-run")
ok(M.clobber_problems("-- REAPPLY-OK:\n" + edited, BASE_TXT) != [], "a REAPPLY-OK line without a reason does not count")
safe = BASE_TXT.replace("INSERT OR REPLACE INTO fleet_tasks (id, definition) VALUES ('t', '{\"steps\":[1,2,3]}');", "INSERT OR IGNORE INTO fleet_tasks (id, definition) VALUES ('t', '{}');") + "-- edited\n"
ok(M.clobber_problems(safe, BASE_TXT) == [], "an edit whose statements no longer rewrite a live row passes")
for stmt in ("UPDATE fleet_crons SET cron_expr='*/10 * * * *' WHERE name='x';", "UPDATE ops_config SET value='1' WHERE key='k';", "REPLACE INTO ops_config (key, value) VALUES ('k','v');"):
    r2 = M.clobber_problems(HDR + stmt + "\n-- edit\n", HDR + stmt + "\n")
    ok(len(r2) == 1, "an edited file with '" + stmt[:28] + "' is refused", r2)
ok(M.clobber_problems(HDR.replace("APPLY-BY: ci", "APPLY-BY: none (hand applied)") + "UPDATE fleet_tasks SET enabled=1;\n-- e\n", HDR.replace("APPLY-BY: ci", "APPLY-BY: none (hand applied)") + "UPDATE fleet_tasks SET enabled=1;\n") == [], "a file that never opted in to CI is not the runner's to re-apply, so it is not refused")
ok(M.clobber_problems(HDR + "UPDATE agent_issues SET status='open' WHERE id=1;\n-- edit\n", HDR + "UPDATE agent_issues SET status='open' WHERE id=1;\n") == [], "other tables are not covered by this guard")
# RESTORE-APPLIED-CONTENT-1: reverting an edit puts back a content the runner already applied (its sha256 has an ok row), so the file is skipped, not re-run
ok(M.clobber_problems(BASE_TXT, edited, [BASE_TXT]) == [], "restoring a content the file already had is not refused")
r3 = M.clobber_problems(BASE_TXT + "-- never merged\n", edited, [BASE_TXT])
ok(len(r3) == 1 and "MIGRATION-NO-CLOBBER-1" in r3[0], "a content that was never in the history is still refused", r3)
ok(len(M.clobber_problems(edited + "-- again\n", BASE_TXT, [])) == 1, "an edit with no history match is still refused")
# the history helper against a real repository: v1 merged, v2 edited it, v3 restores v1
import subprocess
_repo = tempfile.mkdtemp()
def _git(*a):
    return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false"] + list(a), cwd=_repo, capture_output=True, text=True, check=True)
_git("init", "-q", "-b", "main")
os.makedirs(os.path.join(_repo, "migrations"))
for _txt in (BASE_TXT, edited):
    open(os.path.join(_repo, "migrations", "x.sql"), "w", encoding="utf-8").write(_txt)
    _git("add", "migrations/x.sql")
    _git("commit", "-q", "-m", "v")
_cwd = os.getcwd()
os.chdir(_repo)
try:
    _hist = M.history_texts_of("migrations/x.sql", "HEAD")
    _base = M.base_text_of("migrations/x.sql", "HEAD")
    ok(_hist == [edited, BASE_TXT], "history_texts_of lists every earlier content, newest first", [len(h) for h in _hist])
    ok(M.clobber_problems(BASE_TXT, _base, _hist) == [], "restoring v1 over the edited v2 passes against real git history")
    ok(len(M.clobber_problems(BASE_TXT + "-- new\n", _base, _hist)) == 1, "a genuinely new edit still fails against real git history")
    ok(M.history_texts_of("migrations/none.sql", "HEAD") == [], "a path with no history yields no texts")
finally:
    os.chdir(_cwd)
# the repository's own edited files pass: the lifecycle migration carries its REAPPLY-OK line and no longer rewrites the row
lf = open(os.path.join(mig_dir, "2026-10-18-portfolio-lifecycle.sql"), encoding="utf-8").read()
ok(M.REAPPLY_OK.search(lf) and "INSERT OR REPLACE INTO fleet_tasks" not in lf and "INSERT OR IGNORE INTO fleet_tasks" in lf, "the portfolio-lifecycle migration no longer rewrites its fleet_tasks row on a re-run")
ok("PORTFOLIO-IMPLEMENT-1" not in lf.split("-- APPLY-BY: ci", 1)[1].split("INSERT INTO fleet_crons", 1)[1], "the portfolio-lifecycle migration no longer files PORTFOLIO-IMPLEMENT-1 issues on a re-run")

# BACKUP-SCHEMA-ONLY-1 (2026-10-20, migration_runs 352/355/361): an empty backup stops a file only when it destroys rows. 2026-10-19-repo-slug-any-depth.sql
# made its backup with CREATE TABLE ... AS SELECT ... WHERE <nothing matched any more> and then dropped a trigger; the runner refused the file three times.
db.execute("CREATE TABLE so_t (x)")
db.execute("CREATE INDEX so_idx ON so_t (x)")
db.execute("CREATE VIEW so_v AS SELECT x FROM so_t")
db.execute("CREATE TRIGGER IF NOT EXISTS so_trg AFTER INSERT ON so_t BEGIN SELECT 1; END")
db.execute("CREATE TABLE bak_so_empty (key TEXT, value TEXT)")  # exists, holds no row
db.commit()


def so_file(tag, backup, *stmts, make_backup=False):
    head = "-- schema only " + tag + "\n-- APPLY-BY: ci\n-- DB: qnfo-audit\n-- BACKUP: " + backup + "\n-- Rollback: recreate the object from the BACKUP row or its definition\n"
    mk = "CREATE TABLE IF NOT EXISTS " + backup + " AS SELECT * FROM ops_config WHERE 0;\n" if make_backup else ""
    return head + mk + "".join(s + ";\n" for s in stmts)


def exists(kind, name):
    return db.execute("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?", (kind, name)).fetchone() is not None


f_so = so_file("a", "bak_so_self", "DROP TRIGGER IF EXISTS so_trg", make_backup=True)
_, pr, inf = M.plan("migrations/so-a.sql", f_so)
ok(not pr and inf["destructive"] == 1 and inf.get("row_destructive") == 0 and inf["creates_backup"] is True, "plan counts a DROP TRIGGER as destructive but not as row-destroying", (pr, inf))
rc = M.apply_file("migrations/so-a.sql", f_so, "a", "t", "so1", emit)
ok(rc == 0 and json.loads(out[-1]).get("ok") and not exists("trigger", "so_trg"), "an empty self-made backup plus DROP TRIGGER applies (the 2026-10-19 repo-slug shape)", out[-1])
db.execute("CREATE TRIGGER IF NOT EXISTS so_trg AFTER INSERT ON so_t BEGIN SELECT 1; END")
db.commit()
rc = M.apply_file("migrations/so-b.sql", so_file("b", "bak_so_empty", "DROP TRIGGER IF EXISTS so_trg"), "a", "t", "so2", emit)
ok(rc == 0 and not exists("trigger", "so_trg"), "an existing but empty backup table is accepted for DROP TRIGGER only", out[-1])
rc = M.apply_file("migrations/so-c.sql", so_file("c", "bak_so_empty", "DROP INDEX IF EXISTS so_idx", "DROP VIEW IF EXISTS so_v"), "a", "t", "so3", emit)
ok(rc == 0 and not exists("index", "so_idx") and not exists("view", "so_v"), "DROP INDEX and DROP VIEW delete no row either", out[-1])
db.execute("CREATE TRIGGER IF NOT EXISTS so_trg AFTER INSERT ON so_t BEGIN SELECT 1; END")
db.commit()
rc = M.apply_file("migrations/so-d.sql", so_file("d", "bak_so_missing", "DROP TRIGGER IF EXISTS so_trg"), "a", "t", "so4", emit)
ok(rc == 1 and "does not exist" in out[-1] and exists("trigger", "so_trg"), "a backup table that does not exist still stops the file before any statement", out[-1])
db.execute("CREATE TABLE so_rows (x)")
db.execute("INSERT INTO so_rows VALUES (1)")
db.commit()
rc = M.apply_file("migrations/so-e.sql", so_file("e", "bak_so_empty", "DROP TABLE so_rows"), "a", "t", "so5", emit)
ok(rc == 1 and "is empty" in out[-1] and db.execute("SELECT COUNT(*) FROM so_rows").fetchone()[0] == 1, "DROP TABLE keeps the strict rule: an empty backup stops it", out[-1])
rc = M.apply_file("migrations/so-f.sql", so_file("f", "bak_so_empty", "DROP TRIGGER IF EXISTS so_trg", "DELETE FROM so_rows"), "a", "t", "so6", emit)
ok(rc == 1 and "is empty" in out[-1] and exists("trigger", "so_trg") and db.execute("SELECT COUNT(*) FROM so_rows").fetchone()[0] == 1, "a file that drops a trigger AND deletes rows keeps the strict rule, checked before the first destructive statement", out[-1])
rc = M.apply_file("migrations/so-g.sql", so_file("g", "bak_so_self2", "DELETE FROM so_rows", make_backup=True), "a", "t", "so7", emit)
ok(rc == 1 and "is empty" in out[-1] and "before statement 2" in out[-1], "DELETE FROM keeps the strict rule for an empty self-made backup", out[-1])

# APPLY-MIGRATIONS-LINT-1 (2026-10-20, migration_runs 288): plan() never parsed the SQL, so unquoted text in a VALUES list passed --check and failed on main.
PL_HDR = "-- APPLY-BY: ci\n-- DB: qnfo-audit\n-- Rollback: DELETE FROM fleet_tasks WHERE id = 'portfolio-lifecycle';\n"
PL_BAD = ("INSERT OR REPLACE INTO fleet_tasks (id, name, type, definition, timeout_ms, retries, version, enabled, updated_at)\n"
          "VALUES ('portfolio-lifecycle', PORTFOLIO-LIFECYCLE-1: maintain, implement, deploy and upgrade the portfolio/programs/projects, 'workflow', "
          "{\"steps\":[]}, 120000, 1, 1, 1, datetime('now'));\n")
PL_GOOD = ("INSERT OR IGNORE INTO fleet_tasks (id, name, type, definition, timeout_ms, retries, version, enabled, updated_at)\n"
           "VALUES ('portfolio-lifecycle', 'PORTFOLIO-LIFECYCLE-1: maintain, implement, deploy and upgrade the portfolio/programs/projects', 'workflow', "
           "'{\"steps\":[]}', 120000, 1, 1, 1, datetime('now'));\n")


def lint(sql, header=PL_HDR):
    okp, pr, inf = M.plan("migrations/pl.sql", header + sql)
    return okp, [p for p in pr if "APPLY-MIGRATIONS-LINT-1" in p or "PARSE-LINT" in p], inf


_, lp, _ = lint("INSERT OR IGNORE INTO ops_config (key, value) VALUES ('a', '1');\n" + PL_BAD)
ok(len(lp) == 1 and "statement 2 " in lp[0] and 'unrecognized token: ":"' in lp[0], "plan refuses the unquoted-text statement, names statement 2 and SQLite's own message", lp)
_, lp, inf = lint("INSERT OR IGNORE INTO ops_config (key, value) VALUES ('a', '1');\n" + PL_GOOD)
ok(not lp and inf.get("parse_lint") == "ok", "the quoted version of the same statement passes and --check reports the lint ran", (lp, inf))
n_calls = len(calls)
rc = M.apply_file("migrations/pl-bad.sql", PL_HDR + PL_BAD, "a", "t", "pl1", emit)
ok(rc == 1 and "APPLY-MIGRATIONS-LINT-1" in out[-1] and len(calls) == n_calls, "apply_file refuses it before any D1 call", out[-1])
rc, ls = check_file("2099-01-01-pl-bad.sql", PL_HDR + PL_BAD)
ok(rc == 1 and ls and "APPLY-MIGRATIONS-LINT-1" in json.dumps(ls[0].get("refused")), "--check exits 1 on it", ls)
rc, ls = check_file("2099-01-01-pl-good.sql", PL_HDR + PL_GOOD)
ok(rc == 0 and ls and ls[0].get("ok") is True and ls[0].get("parse_lint") == "ok", "--check exits 0 on the corrected statement", ls)
for sql, label in [("INSERT INTO t (a b) VALUES (1);", "a missing comma"), ("SELEC 1;", "a misspelt keyword"), ("UPDATE t SET a = = 1;", "a doubled operator"),
                   ("INSERT INTO t (a) VALUES (1,;", "a dangling comma"), ("CREATE TABLE t (a TEXT,, b);", "an empty column definition"),
                   ("INSERT INTO t (a) VALUES (1) WHERE 1;", "a WHERE on VALUES"),
                   # A trigger's table is looked up before its body is read, so on an empty database the body would never be parsed:
                   ("CREATE TRIGGER trg AFTER INSERT ON t BEGIN INSERT INTO u (a) VALUES (NEW.a); SELEC 2; END;", "a syntax error inside a trigger body"),
                   ("CREATE TRIGGER trg AFTER UPDATE OF repo ON t WHEN NEW.repo LIKE 'q/%' BEGIN UPDATE t SET repo = = 1; END;", "a syntax error in an UPDATE OF trigger"),
                   ("CREATE TRIGGER trg INSTEAD OF INSERT ON v BEGIN INSERT INTO u (a) VALUES (NEW.a,); END;", "a syntax error in an INSTEAD OF trigger body")]:
    ok(len(lint(sql)[1]) == 1, "a parse error is refused: " + label, lint(sql)[1])
# Only the parser's own verdict counts. Everything below is valid SQL whose names this empty in-memory database cannot know, or syntax D1 accepts
# that a bundled SQLite could still read; none may be refused.
for sql, label in [("INSERT INTO nosuch (a) VALUES (1);", "no such table"), ("UPDATE ops_config SET nosuch = 1 WHERE key = 'a';", "no such column"),
                   ("SELECT frobnicate(1);", "no such function"), ("INSERT INTO nosuch2 (a) SELECT a FROM nosuch3 WHERE a > 1;", "INSERT ... SELECT on unknown tables"),
                   ("INSERT INTO t (a) VALUES (1) ON CONFLICT(a) DO UPDATE SET a = excluded.a;", "UPSERT"),
                   ("INSERT INTO t (a) VALUES (1) RETURNING a;", "RETURNING"), ("SELECT '{\"a\":1}' ->> '$.a';", "the ->> JSON operator"),
                   ("SELECT a, row_number() OVER (PARTITION BY b ORDER BY c) FROM t;", "a window function"),
                   ("WITH x AS (SELECT 1 a) INSERT OR IGNORE INTO t (a) SELECT a FROM x;", "a CTE write"),
                   ("CREATE TRIGGER trg AFTER INSERT ON t BEGIN INSERT INTO u (a) VALUES (NEW.a); UPDATE u SET a = 1 WHERE a = NEW.a; END;", "a trigger with two body statements"),
                   ("CREATE TRIGGER IF NOT EXISTS trg AFTER UPDATE OF repo ON t WHEN lower(COALESCE(NEW.repo, '')) LIKE 'q/%' BEGIN UPDATE t SET repo = NEW.nosuch WHERE id = NEW.id; END;", "an UPDATE OF trigger with a WHEN clause and a column that does not exist"),
                   ("CREATE TRIGGER trg INSTEAD OF INSERT ON v BEGIN INSERT INTO u (a) VALUES (NEW.a); END;", "an INSTEAD OF trigger on a view"),
                   ("CREATE TRIGGER trg BEFORE DELETE ON \"t\" BEGIN SELECT RAISE(ABORT, 'append-only'); END;", "a RAISE(ABORT) trigger on a quoted table name"),
                   ("ALTER TABLE t ADD COLUMN extra TEXT;", "ADD COLUMN"), ("ALTER TABLE t DROP COLUMN extra;", "DROP COLUMN"),
                   ("CREATE VIEW v AS SELECT * FROM t RIGHT JOIN u ON t.a = u.a;", "a RIGHT JOIN"),
                   ("CREATE TABLE t2 (a INTEGER, b TEXT GENERATED ALWAYS AS (a * 2)) STRICT;", "a generated column in a STRICT table"),
                   ("INSERT INTO t (a) VALUES ('it''s: fine, (really); -- not a comment');", "quotes, colons, parentheses and semicolons inside a literal"),
                   ("SELECT 1; -- trailing comment", "a trailing comment"), ("SELECT 1; /* block */", "a trailing block comment"),
                   ("EXPLAIN SELECT 1;", "a statement that already starts with EXPLAIN"), ("PRAGMA foreign_keys = off;", "a PRAGMA"),
                   ("SELECT ?1;", "a bound parameter"), ("SELECT :name;", "a named parameter"),
                   ("SELECT 1; SELECT 2;", "two statements on one line"), ("SELECT \"abc\";", "a double-quoted identifier")]:
    ok(lint(sql)[1] == [], "not a parse error, so not refused: " + label, lint(sql)[1])
# A statement is numbered as the runner numbers it (migration_runs says "statement N").
_, lp, _ = lint("SELECT 1;\nSELECT 2;\nSELECT 3 FROM;\nSELECT 4;\n")
ok(len(lp) == 1 and lp[0].startswith("statement 3 "), "the refused statement carries its position in the file", lp)
# A file that needs syntax newer than the runner's SQLite says so in one header line; a malformed switch is a problem of its own.
_, lp, inf = lint(PL_BAD, PL_HDR + "-- PARSE-LINT: off (uses syntax newer than the runner's bundled SQLite)\n")
ok(lp == [] and str(inf.get("parse_lint")).startswith("off: "), "a '-- PARSE-LINT: off (<reason>)' header line skips the lint and --check says so", (lp, inf))
for bad_switch in ("off", "off ()", "on", "off reason"):
    _, lp, _ = lint(PL_GOOD, PL_HDR + "-- PARSE-LINT: " + bad_switch + "\n")
    ok(len(lp) == 1 and "PARSE-LINT header must read" in lp[0], "a PARSE-LINT switch without a reason is a problem: '" + bad_switch + "'", lp)
# An older SQLite than the floor makes no claim at all (its parser may not know syntax D1 accepts).
real_ver = sqlite3.sqlite_version_info, sqlite3.sqlite_version
sqlite3.sqlite_version_info, sqlite3.sqlite_version = (3, 31, 1), "3.31.1"
try:
    _, lp, inf = lint(PL_BAD)
finally:
    sqlite3.sqlite_version_info, sqlite3.sqlite_version = real_ver
ok(lp == [] and str(inf.get("parse_lint")).startswith("skipped: sqlite 3.31.1"), "below PARSE_LINT_MIN_SQLITE the lint is skipped and says why", (lp, inf))
# The lint prepares with EXPLAIN in a throwaway database: it must not run, create or write anything.
_, lp, _ = lint("CREATE TABLE lint_must_not_exist (x);\nINSERT INTO ops_config (key, value) VALUES ('lint_must_not_write', '1');\n")
ok(lp == [] and not exists("table", "lint_must_not_exist") and not db.execute("SELECT 1 FROM ops_config WHERE key = 'lint_must_not_write'").fetchone(), "the lint executes nothing against the fixture database")
# Every opted-in migration on the branch parses; the lint really ran on them (the runner's SQLite meets the floor in CI). A file that carries
# "-- PARSE-LINT: off (<reason>)" is the declared release valve: it is counted as switched off, not as a file the lint missed, so using the valve
# in a pull request does not turn this gate red.
def lint_sweep(items):
    """(swept, linted, switched_off, stmts_checked, bad) over (path, text) pairs of the opted-in migrations."""
    swept = linted = switched_off = stmts_checked = 0
    bad = []
    for fp, text in items:
        okp, pr_, inf_ = M.plan(fp, text)
        if not okp:
            continue
        swept += 1
        note = str(inf_.get("parse_lint"))
        if note.startswith("off: "):
            switched_off += 1
        elif note == "ok" and not any("PARSE-LINT" in p for p in pr_):
            linted += 1
            stmts_checked += inf_["statements"]
        bad += [os.path.basename(fp) + ": " + p[:160] for p in pr_ if "APPLY-MIGRATIONS-LINT-1" in p or "PARSE-LINT" in p]
    return swept, linted, switched_off, stmts_checked, bad


swept, linted, switched_off, stmts_checked, sweep_bad = lint_sweep(
    (fp, open(fp, encoding="utf-8").read()) for fp in sorted(glob.glob(os.path.join(HERE, "..", "migrations", "*.sql"))))
ok(swept > 0 and not sweep_bad, "no opted-in migration in the repository has a statement SQLite cannot parse", sweep_bad[:3])
floor = getattr(M, "PARSE_LINT_MIN_SQLITE", None)
ok(floor is not None and (sqlite3.sqlite_version_info < floor or (linted + switched_off == swept and stmts_checked >= linted)),
   "and the lint ran on every one of them that did not switch it off", (swept, linted, switched_off, stmts_checked))
# The release valve in the tree must not break the sweep: a file with a valid off header is neither refused nor counted as a file the lint missed,
# while a file with a bad statement and no header, or with a malformed switch, is still caught.
lint_runs = floor is not None and sqlite3.sqlite_version_info >= floor
sw = lint_sweep([("migrations/a.sql", PL_HDR + PL_GOOD),
                 ("migrations/b.sql", PL_HDR + "-- PARSE-LINT: off (uses syntax newer than the runner's bundled SQLite)\n" + PL_BAD)])
ok(sw[0] == 2 and sw[2] == 1 and sw[4] == [] and (not lint_runs or (sw[1] == 1 and sw[0] == sw[1] + sw[2] and sw[3] >= sw[1])),
   "a file with a valid '-- PARSE-LINT: off (<reason>)' line is counted as switched off: not refused, not an unlinted file, the 'ran on every one' condition holds", sw)
sw = lint_sweep([("migrations/c.sql", PL_HDR + PL_BAD), ("migrations/d.sql", PL_HDR + "-- PARSE-LINT: off\n" + PL_GOOD)])
ok(sw[0] == 2 and sw[2] == 0 and (not lint_runs or (sw[1] == 1 and len(sw[4]) == 2)),
   "the valve is no hole: a bad statement with no header is reported (the lint ran on it) and a malformed switch is reported, counted as neither linted nor switched off", sw)

# APPLY-MIGRATIONS-LINT-1 (C): the failure is recorded even when D1 refuses the one-statement INSERT ... SELECT form on agent_issues
# (migration_runs 291/293/296 left a red run and no issue). Fallback: look for an open duplicate, then INSERT ... VALUES.
RF = ("-- record failure fixture TAG\n-- APPLY-BY: ci\n-- DB: qnfo-audit\n-- Rollback: none needed\n"
      "INSERT INTO no_such_table_rf (x) VALUES (1);\n")
NESTED = {"success": False, "errors": [{"code": 7500, "message": "triggers nested too deep: SQLITE_ERROR"}]}


def select_form_refused(method, path, token, body=None, timeout=60):
    s = body["sql"].lstrip().upper()
    if s.startswith("INSERT INTO AGENT_ISSUES") and " SELECT " in s:
        return 400, NESTED
    return fake_call(method, path, token, body, timeout)


def no_issue_inserts(method, path, token, body=None, timeout=60):
    if body["sql"].lstrip().upper().startswith("INSERT INTO AGENT_ISSUES"):
        return 400, NESTED
    return fake_call(method, path, token, body, timeout)


def no_error_ledger_rows(method, path, token, body=None, timeout=60):
    s = body["sql"]
    if s.lstrip().upper().startswith("INSERT INTO MIGRATION_RUNS") and "'error'" in s:
        return 400, {"success": False, "errors": [{"message": "D1_ERROR: database is busy"}]}
    return fake_call(method, path, token, body, timeout)


failing_stdout = []


def run_failing(tag, caller):
    """Returns (rc, what apply_file wrote to STDERR). What it wrote to stdout is kept in failing_stdout: the annotation belongs on stderr."""
    saved = C.call
    C.call = caller
    buf, err_buf = io.StringIO(), io.StringIO()
    try:
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(err_buf):
            rc_ = M.apply_file("migrations/rf-" + tag + ".sql", RF.replace("TAG", tag), "a", "t", "rf" + tag, emit)
    finally:
        C.call = saved
    failing_stdout.append(buf.getvalue())
    return rc_, err_buf.getvalue()


def open_issues(tag):
    return db.execute("SELECT COUNT(*) FROM agent_issues WHERE title = ? AND status = 'open'", ("MIGRATION-APPLY-FAILED-1: rf-" + tag + ".sql",)).fetchone()[0]


rc, printed = run_failing("a", select_form_refused)
ok(rc == 1 and open_issues("a") == 1 and "::error" not in printed, "when the INSERT ... SELECT form is refused the issue is filed with INSERT ... VALUES (and nothing is annotated)", (rc, out[-1], printed))
ok(db.execute("SELECT priority, source, category FROM agent_issues WHERE title = 'MIGRATION-APPLY-FAILED-1: rf-a.sql'").fetchone() == ("high", "ci:apply-migrations", "migration"),
   "the fallback row carries the same priority, source and category as the primary form")
rc, printed = run_failing("a", select_form_refused)
ok(open_issues("a") == 1, "a second failure of the same file finds the open issue and files no duplicate")
rc, printed = run_failing("a2", fake_call)
ok(rc == 1 and open_issues("a2") == 1 and "::error" not in printed, "the primary INSERT ... SELECT form is unchanged when D1 accepts it", (rc, printed))
rc, printed = run_failing("b", no_issue_inserts)
ok(rc == 1 and open_issues("b") == 0 and "::error file=migrations/rf-b.sql::MIGRATION-APPLY-FAILED-1 could not be recorded" in printed,
   "when no form can be written the run still returns 1 and a ::error annotation names the file (on stderr)", (rc, printed))
ok(failing_stdout[-1] == "", "the annotation is not written to stdout (the consumer's stdout is one JSON document)", failing_stdout[-1])
ok(any('"ledger_error"' in o and "issue not filed" in o for o in out) and db.execute("SELECT status FROM migration_runs WHERE file = 'migrations/rf-b.sql'").fetchone() == ("error",),
   "the ledger row is still written and the lost issue is reported as ledger_error")
rc, printed = run_failing("c", no_error_ledger_rows)
ok(rc == 1 and open_issues("c") == 1 and "::error file=migrations/rf-c.sql::" in printed and "migration_runs row not written" in printed,
   "a refused ledger row no longer keeps the issue from being filed, and is annotated", (rc, printed))
ok(db.execute("SELECT COUNT(*) FROM migration_runs WHERE file = 'migrations/rf-c.sql'").fetchone()[0] == 0, "(the fixture really refused the ledger row)")
real_d1 = M.d1
steps = []


def unique_clash(acct_, token_, db_id_, sql_, params_=None):
    steps.append(sql_[:30])
    if len(steps) == 1:
        raise RuntimeError("D1 HTTP 400: triggers nested too deep")
    if len(steps) == 2:
        raise RuntimeError("D1 HTTP 500: duplicate check unavailable")
    raise RuntimeError("D1 HTTP 400: UNIQUE constraint failed: index 'idx_agent_issues_open_title_ci'")


how = None
M.d1 = unique_clash
try:
    if hasattr(M, "file_failure_issue"):
        how = M.file_failure_issue("a", "t", "db", "MIGRATION-APPLY-FAILED-1: x.sql", "d")
finally:
    M.d1 = real_d1
ok(how == "exists" and len(steps) == 3, "an unreadable duplicate check falls through to the insert, and the unique index on open titles counts as 'exists'", (how, steps))
buf, err_buf = io.StringIO(), io.StringIO()
if hasattr(M, "annotate_error"):
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(err_buf):
        M.annotate_error("migrations/a,b.sql", "line one\nline 100% two")
ok(err_buf.getvalue().strip() == "::error file=migrations/a%2Cb.sql::line one%0Aline 100%25 two", "the annotation escapes line breaks, percent signs and property separators", err_buf.getvalue())
ok(buf.getvalue() == "", "annotate_error leaves stdout empty (the runner reads workflow commands from stderr too)", buf.getvalue())
# The consumer path (remediation_consumer.migrations_sweep -> apply_file(..., emit=log), log writing to stderr): a failure that neither the ledger nor the
# queue can record reaches the annotation, and stdout must still be empty so that json.loads of the consumer's own JSON document is not poisoned.
def stderr_emit(msg):
    print(msg, file=sys.stderr)


def raise_nested(*_a, **_k):
    raise RuntimeError("D1 HTTP 400: triggers nested too deep")


real_d1_ann = M.d1
buf, err_buf = io.StringIO(), io.StringIO()
M.d1 = raise_nested
try:
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(err_buf):
        rc = M.record_failure("migrations/x-consumer.sql", "a" * 64, "c" * 40, {"db": "qnfo-audit"}, "a", "t", "db", "boom", stderr_emit)
        print(json.dumps({"consumer": "document"}))
finally:
    M.d1 = real_d1_ann
ok(rc == 1 and buf.getvalue() == json.dumps({"consumer": "document"}) + "\n" and json.loads(buf.getvalue()) == {"consumer": "document"},
   "record_failure with a stderr emit leaves stdout empty, so the consumer's JSON document still parses", buf.getvalue())
ok("::error file=migrations/x-consumer.sql::MIGRATION-APPLY-FAILED-1 could not be recorded" in err_buf.getvalue(),
   "...and the annotation still reaches stderr, where the runner reads it", err_buf.getvalue())

# The registry migration that records this change (DOCTRINE-1): it applies to the live table shapes (DDL read from qnfo-audit.sqlite_master on
# 2026-10-20, CHECK constraints included), replaying it is a no-op, decision_log stays append-only, and every code-probe marker it registers
# really occurs in scripts/apply_migrations.py (a detector that cannot pass would file its own issue). The control rows come with a tested-alternate
# probe each (CONTROL-ALT-PROBES-1): a control with an alternate, no stamp and no probe reads 'no-probe', and the live hourly detector
# fm-control-alternate-undrilled (SELECT controls_untested_without_probe FROM v_control_alternate_untested, expected 0) turns red on it. The fixture
# therefore carries the live control_alternate_probes table and the live text of the three views that read it (v_control_alternate_status,
# v_control_alternate_untested, v_path_coverage_gaps; read from qnfo-audit.sqlite_master on 2026-10-20), so that defect is visible here.
REG = os.path.join(HERE, "..", "migrations", "2026-10-20-apply-migrations-lint.sql")
reg_text = open(REG, encoding="utf-8").read()
okp, pr, inf = M.plan(REG, reg_text)
ok(okp and not pr and inf.get("parse_lint") == "ok" and inf["destructive"] == 0, "the registry migration passes plan() and the parse lint", (pr, inf))
REG_DDL = """
CREATE TABLE control_registry (control TEXT PRIMARY KEY, location TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('hold', 'filter', 'pause', 'kill-switch', 'gate', 'cap', 'guard', 'lease')),
  guards_against TEXT, critical_path INTEGER NOT NULL DEFAULT 0, disposition TEXT NOT NULL CHECK (disposition IN ('remove', 'demote', 'replace', 'keep')),
  disposition_state TEXT NOT NULL DEFAULT 'planned' CHECK (disposition_state IN ('planned', 'applied')), alternate_path TEXT, alternate_tested_at TEXT, evidence TEXT NOT NULL,
  issue_id INTEGER, reviewed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
CREATE TABLE control_alternate_probes (control TEXT PRIMARY KEY, probe_sql TEXT NOT NULL, window_note TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, last_run_at TEXT,
  last_pass INTEGER, last_pass_at TEXT, last_observed TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
CREATE TABLE process_contracts (process TEXT PRIMARY KEY, owner TEXT NOT NULL, sla_min INTEGER NOT NULL, definition_of_done TEXT NOT NULL, paths_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')), cadence_min INTEGER);
CREATE VIEW v_control_alternate_status AS
SELECT c.control AS control, c.critical_path AS critical_path, c.disposition AS disposition, c.disposition_state AS disposition_state,
  c.alternate_path AS alternate_path, c.alternate_tested_at AS alternate_tested_at,
  p.enabled AS probe_enabled, p.last_run_at AS last_run_at, p.last_pass AS last_pass, p.last_pass_at AS last_pass_at, p.last_observed AS last_observed,
  p.window_note AS window_note,
  CASE
    WHEN c.alternate_path IS NULL OR trim(c.alternate_path) = '' THEN 'no-alternate'
    WHEN c.disposition = 'remove' AND c.disposition_state = 'applied' THEN 'removed'
    WHEN p.control IS NULL AND c.evidence LIKE '%ALTERNATE-NOT-EXERCISABLE%' THEN 'not-exercisable'
    WHEN p.control IS NULL THEN 'no-probe'
    WHEN p.enabled <> 1 THEN 'probe-disabled'
    WHEN p.last_run_at IS NULL THEN 'probe-never-run'
    WHEN p.last_pass IS NOT 1 THEN 'probe-failing'
    WHEN p.last_pass_at IS NULL OR p.last_pass_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-480 minutes') THEN 'probe-stale'
    ELSE 'drilled'
  END AS drill_state
FROM control_registry c LEFT JOIN control_alternate_probes p ON p.control = c.control;
CREATE VIEW v_control_alternate_untested AS
SELECT
  (SELECT COUNT(*) FROM control_registry WHERE critical_path = 1 AND NOT (disposition = 'remove' AND disposition_state = 'applied') AND alternate_tested_at IS NULL) AS critical_untested_by_register,
  (SELECT COUNT(*) FROM v_control_alternate_status WHERE critical_path = 1 AND drill_state NOT IN ('no-alternate', 'removed', 'not-exercisable', 'drilled')) AS critical_untested_by_probe,
  (SELECT COUNT(*) FROM v_control_alternate_status WHERE critical_path = 1 AND drill_state IN ('probe-disabled', 'probe-never-run', 'probe-failing', 'probe-stale')) AS critical_probe_not_drilled,
  (SELECT COUNT(*) FROM v_control_alternate_status WHERE critical_path = 1 AND drill_state = 'no-probe') AS critical_without_probe,
  (SELECT COUNT(*) FROM v_control_alternate_status WHERE drill_state = 'no-probe' AND alternate_tested_at IS NULL) AS controls_untested_without_probe,
  (SELECT COUNT(*) FROM v_control_alternate_status WHERE drill_state = 'no-probe' AND alternate_tested_at IS NOT NULL) AS controls_hand_stamped_without_probe,
  (SELECT COUNT(*) FROM v_control_alternate_status WHERE drill_state = 'probe-failing') AS probes_failing,
  (SELECT COUNT(*) FROM control_alternate_probes WHERE enabled = 1) AS probes_enabled,
  (SELECT COUNT(*) FROM control_alternate_probes) AS probes_total;
CREATE VIEW v_path_coverage_gaps AS
SELECT
  'control_registry' AS source,
  control AS process,
  kind AS path_kind,
  CASE
    WHEN alternate_path IS NULL OR trim(alternate_path) = '' THEN 'no-alternate'
    WHEN alternate_tested_at IS NULL AND evidence LIKE '%ALTERNATE-NOT-EXERCISABLE%' AND NOT EXISTS (SELECT 1 FROM control_alternate_probes p WHERE p.control = control_registry.control) THEN 'alternate-not-exercisable'
    WHEN alternate_tested_at IS NULL THEN 'alternate-untested'
    ELSE 'ok'
  END AS path_state,
  alternate_path AS alternate,
  alternate_tested_at
FROM control_registry
UNION ALL
SELECT
  'process_contracts' AS source,
  process,
  'contract-paths' AS path_kind,
  CASE
    WHEN json_valid(paths_json) = 0 THEN 'paths-not-json'
    WHEN json_array_length(paths_json) < 2 THEN 'single-path'
    WHEN json_array_length(paths_json) = 2 THEN 'two-paths-no-spare'
    ELSE 'ok'
  END AS path_state,
  NULL AS alternate,
  NULL AS alternate_tested_at
FROM process_contracts;
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT NOT NULL, root_cause TEXT NOT NULL, remediation TEXT NOT NULL, detector TEXT NOT NULL, probe_class TEXT,
  first_seen TEXT NOT NULL, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL, action TEXT NOT NULL, verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL,
  max_attempts INTEGER NOT NULL DEFAULT 3, escalate_to TEXT NOT NULL, expected_cadence_h INTEGER, status TEXT DEFAULT 'active', ts TEXT DEFAULT (datetime('now')), last_attempt_at TEXT,
  last_verdict TEXT, module TEXT, budget_ms INTEGER DEFAULT 45000, next_due_at TEXT, max_items INTEGER DEFAULT 5, requires_container INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0, deferred_since TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL,
  evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT, 'decision_log is append-only'); END;
CREATE TRIGGER decision_log_no_delete BEFORE DELETE ON decision_log BEGIN SELECT RAISE(ABORT, 'decision_log is append-only'); END;
"""
REG_CONTROLS = ("migration-parse-lint", "migration-backup-nonempty")


def reg_fixture():
    con = sqlite3.connect(":memory:")
    con.executescript(REG_DDL)
    return con


def reg_apply(con, text, skip=None):
    """Runs the file's statements as the runner does (statements(), body()); skip is a predicate on a statement's SQL."""
    for st in M.statements(text):
        sql = M.body(st)
        if not (skip and skip(sql)):
            con.execute(sql)


def alt_state(con):
    """The numbers the live views give: the detector's count, how many controls read no-probe, each control's drill state, and the path-coverage rows that read untested."""
    return {"untested_without_probe": con.execute("SELECT controls_untested_without_probe FROM v_control_alternate_untested").fetchone()[0],
            "no_probe": con.execute("SELECT COUNT(*) FROM v_control_alternate_status WHERE drill_state = 'no-probe'").fetchone()[0],
            "drill": dict(con.execute("SELECT control, drill_state FROM v_control_alternate_status ORDER BY control").fetchall()),
            "stamped": con.execute("SELECT COUNT(*) FROM control_registry WHERE alternate_tested_at IS NOT NULL").fetchone()[0],
            "path_untested": con.execute("SELECT COUNT(*) FROM v_path_coverage_gaps WHERE path_state = 'alternate-untested'").fetchone()[0]}


reg = reg_fixture()
before = alt_state(reg)
ok(before["untested_without_probe"] == 0 and before["no_probe"] == 0, "before the migration the live detector's count (controls_untested_without_probe) reads 0 on the fixture", before)
reg_err = None
after = replayed = None
try:
    reg_apply(reg, reg_text)
    after = alt_state(reg)
    reg_apply(reg, reg_text)  # the replay
    replayed = alt_state(reg)
except sqlite3.Error as e:
    reg_err = str(e)
ok(reg_err is None, "the registry migration runs on the live table shapes, twice, without error", reg_err)
want_drill = {c: "probe-never-run" for c in REG_CONTROLS}
ok(after is not None and after["untested_without_probe"] == 0 and after["no_probe"] == 0 and after["drill"] == want_drill,
   "after the migration controls_untested_without_probe stays 0: both new controls read probe-never-run, not no-probe (the hourly fm-control-alternate-undrilled contract stays green)", after)
ok(replayed == after, "and after a replay the views read the same", (after, replayed))
ok(after is not None and after["stamped"] == 0, "the file never hand-stamps alternate_tested_at (only a passing chaos drill does)", after)
counts = [reg.execute("SELECT COUNT(*) FROM " + t).fetchone()[0] for t in ("control_registry", "control_alternate_probes", "failure_modes", "remediation_contracts", "decision_log")]
ok(counts == [2, 2, 3, 3, 1], "and a replay adds nothing (2 controls, 2 control probes, 3 failure modes, 3 detector contracts, 1 decision)", counts)
ok(after is not None and after["path_untested"] == 2, "path coverage reads the two new controls as alternate-untested until the first drill stamps them, as the sibling migration's two controls do (the probe is what makes them drillable)", after)
# The defect this guards against: the same file without its control_alternate_probes rows leaves both controls at no-probe, and the live detector reads 2.
bare = reg_fixture()
reg_apply(bare, reg_text, skip=lambda sql: sql.lstrip().upper().startswith("INSERT OR IGNORE INTO CONTROL_ALTERNATE_PROBES"))
bare_state = alt_state(bare)
ok(bare_state["untested_without_probe"] == 2 and bare_state["no_probe"] == 2, "without its two probe rows the same file leaves controls_untested_without_probe at 2 (so the assertion above can fail)", bare_state)
# Each probe is what the chaos drill and the consumer accept (one literal read-only SELECT with expected and observed), passes while its detector is in place and says what is wrong when it is not.
import remediation_consumer as RC  # noqa: E402
probe_of = dict(reg.execute("SELECT control, probe_sql FROM control_alternate_probes").fetchall())
ok(set(probe_of) == set(REG_CONTROLS), "one control_alternate_probes row per new control", sorted(probe_of))
ok(all(RC.is_literal_select(q)[0] for q in probe_of.values()) and all(len(M.statements(q)) == 1 for q in probe_of.values()),
   "each probe is a single literal read-only SELECT by the consumer's own write-keyword guard", {c: RC.is_literal_select(q) for c, q in probe_of.items()})
ok(all(r[0] == 1 for r in reg.execute("SELECT enabled FROM control_alternate_probes").fetchall()) and
   all("minutes" in w and not re.search(r"\b\d+ ?(hours?|days?|h)\b", w) for (w,) in reg.execute("SELECT window_note FROM control_alternate_probes").fetchall()),
   "the probes are enabled and their windows are stated in minutes")
want_detector = {"migration-parse-lint": ("fm-migration-sql-parse-error", "APPLY-MIGRATIONS-LINT-1"),
                 "migration-backup-nonempty": ("fm-migration-backup-empty-schema-only", "BACKUP-SCHEMA-ONLY-1")}


def run_probe(con, control):
    if control not in probe_of:
        return None  # the migration under test carries no probe for it
    row = con.execute(probe_of[control]).fetchall()
    return row[0] if row else None


for control, (cls, marker) in want_detector.items():
    r = run_probe(reg, control)
    ok(r is not None and r[0] == "ok" and r[1] == "ok", "probe " + control + " passes while its detector contract is present, active, code-read and reads " + marker, r)
    for label, mutate in [("is missing", "DELETE FROM remediation_contracts WHERE class = '" + cls + "'"),
                          ("is not active", "UPDATE remediation_contracts SET status = 'paused' WHERE class = '" + cls + "'"),
                          ("is not code-read", "UPDATE remediation_contracts SET verify_transport = 'd1-query' WHERE class = '" + cls + "'"),
                          ("no longer reads the marker", "UPDATE remediation_contracts SET verify_probe = '{\"paths\": [\"scripts/apply_migrations.py\"], \"contains\": \"gone\"}' WHERE class = '" + cls + "'")]:
        broken = reg_fixture()
        reg_apply(broken, reg_text)
        broken.execute(mutate)
        r = run_probe(broken, control)
        ok(r is not None and r[0] == "ok" and r[1] != "ok" and cls in r[1], "probe " + control + " fails with the reason when the detector " + label, r)
    r = run_probe(reg_fixture(), control)
    ok(r is not None and r[1] != "ok", "probe " + control + " fails on an empty world (no probe passes by absence)", r)
# The one-line Rollback header takes the file back out, probes included (an orphan probe would be run by the drill for a control that is gone), and the decision row stays.
rb_lines = [l for l in reg_text.splitlines() if l.startswith("-- Rollback: ")]
ok(len(rb_lines) == 1 and "control_alternate_probes" in rb_lines[0], "one Rollback line, and it removes the two control probes", rb_lines)
rb = reg_fixture()
reg_apply(rb, reg_text)
rb.executescript(rb_lines[0][len("-- Rollback: "):].split("decision_log is append-only")[0])
rb_counts = [rb.execute("SELECT COUNT(*) FROM " + t).fetchone()[0] for t in ("control_registry", "control_alternate_probes", "failure_modes", "remediation_contracts", "decision_log")]
ok(rb_counts == [0, 0, 0, 0, 1] and alt_state(rb)["untested_without_probe"] == 0, "the Rollback line removes the controls, their probes, the failure modes and the detector contracts and keeps the append-only decision row", rb_counts)
reg_apply(rb, reg_text)
ok(alt_state(rb)["untested_without_probe"] == 0 and rb.execute("SELECT COUNT(*) FROM control_alternate_probes").fetchone()[0] == 2, "and the file applies again after its rollback")
ok(reg.execute("SELECT COUNT(*) FROM failure_modes f JOIN remediation_contracts r ON r.class = f.probe_class WHERE r.class = 'fm-' || f.fm_key").fetchone()[0] == 3, "each failure mode has its fm-<key> detector contract")
script_text = open(os.path.join(HERE, "apply_migrations.py"), encoding="utf-8").read()
markers = [json.loads(r[0])["contains"] for r in reg.execute("SELECT verify_probe FROM remediation_contracts")]
ok(len(markers) == 3 and all(m in script_text for m in markers), "every code-probe marker the migration registers occurs in scripts/apply_migrations.py", markers)
ok("BACKUP-SCHEMA-ONLY-1" in script_text and "APPLY-MIGRATIONS-LINT-1" in script_text, "the markers named in the issue's closing code-probe are in the script")

# MIGRATION-LIVING-PAPER-1: a living-paper file runs its statements on living-paper and keeps the ledger in qnfo-audit.
LIVING = GOOD.replace("-- DB: qnfo-audit", "-- DB: living-paper").replace("'x; y'", "'living'")
del paths[:]
rc = M.apply_file("migrations/living.sql", LIVING, "a", "t", "c9", emit)
lid, aid = M.DATABASES["living-paper"], M.DATABASES["qnfo-audit"]
stmt_paths = [pp for pp, sq in paths if sq.startswith("INSERT OR REPLACE INTO ops_config")]
ledger_paths = [pp for pp, sq in paths if "migration_runs" in sq]
ok(rc == 0 and stmt_paths and all(lid in pp for pp in stmt_paths), "a living-paper file runs its statements on living-paper", stmt_paths)
ok(ledger_paths and all(aid in pp for pp in ledger_paths), "and records migration_runs in qnfo-audit", ledger_paths)

# CLOSE-CHANNEL-REQUIRED-1 (agent_issues 100419): MIGRATION-APPLY-RESOLVE-1 closed the MIGRATION-APPLY-FAILED-1 issue with no close_channel
# (1000212 closed NULL). Run it against the live close trigger (issue_close_evidence_required) on its own database, so the tables the shared
# fixture above lacks (issue_triage, close_channel) do not change what the earlier cases saw.
shared_db = db
db = sqlite3.connect(":memory:")
db.executescript("""
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER, close_channel TEXT);
CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, close_evidence TEXT);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
CREATE TRIGGER issue_close_evidence_required BEFORE UPDATE OF status ON agent_issues
WHEN NEW.status IN ('closed','resolved','wontfix') AND OLD.status NOT IN ('closed','resolved','wontfix')
BEGIN
  SELECT RAISE(ABORT,'close-without-evidence')
    WHERE NOT EXISTS (SELECT 1 FROM issue_triage t WHERE t.issue_id = NEW.id AND t.close_evidence IS NOT NULL AND TRIM(t.close_evidence) <> '');
END;
""")
RES_BAD = GOOD.replace("INSERT OR REPLACE INTO ops_config (key, value) VALUES ('b;c', 'it''s; fine');", "INSERT INTO no_such_table VALUES (1);")
RES_FIXED = GOOD.replace("'x; y'", "'resolved-run'")
rc = M.apply_file("migrations/resolve-chan.sql", RES_BAD, "a", "t", "r1", emit)
fail_id = db.execute("SELECT id FROM agent_issues WHERE title = 'MIGRATION-APPLY-FAILED-1: resolve-chan.sql' AND status = 'open'").fetchone()
ok(rc == 1 and fail_id is not None, "a failing file files its MIGRATION-APPLY-FAILED-1 issue (fixture for the resolve close)", out[-1])
db.execute("INSERT INTO issue_triage (issue_id) VALUES (?)", (fail_id[0],))  # the AUTOTRIAGE row every live issue has
db.execute("INSERT INTO agent_issues (title, status) VALUES ('MIGRATION-APPLY-FAILED-1: other.sql', 'open')")
db.commit()
rc = M.apply_file("migrations/resolve-chan.sql", RES_FIXED, "a", "t", "r2", emit)
row = db.execute("SELECT status, close_channel, description FROM agent_issues WHERE id = ?", (fail_id[0],)).fetchone()
ok(rc == 0 and row[0] == "closed", "a later ok run closes the MIGRATION-APPLY-FAILED-1 issue of the file", (rc, row))
ok(row[1] == "auto:migration-apply-resolve", "the resolve close writes close_channel 'auto:migration-apply-resolve' (1000212 closed with NULL)", row[1])
ok("MIGRATION-APPLY-RESOLVE-1: migration_runs ok for migrations/resolve-chan.sql" in row[2], "the close still appends its evidence to the description", row[2])
ok(db.execute("SELECT status, close_channel FROM agent_issues WHERE title = 'MIGRATION-APPLY-FAILED-1: other.sql'").fetchone() == ("open", None), "another file's open issue is neither closed nor stamped")
ok(M.RESOLVE_CLOSE_CHANNEL in M.RESOLVE_CLOSE_SQL and "close_channel" in M.RESOLVE_CLOSE_SQL.split("WHERE")[0], "the resolve statement names its channel in the SET list")
db.execute("UPDATE agent_issues SET close_channel = 'kept' WHERE id = ?", (fail_id[0],))
db.commit()
M.resolve_failure("migrations/resolve-chan.sql", "f" * 64, "a", "t", M.DATABASES["qnfo-audit"], 1)
ok(db.execute("SELECT close_channel FROM agent_issues WHERE id = ?", (fail_id[0],)).fetchone()[0] == "kept", "a second resolve never rewrites an already closed issue's channel")
db = shared_db

# PROBE-SEMICOLON-LINT-1 (issue 1000507): a d1-query verify_probe holding a semicolon is refused; code-read JSON and clean probes pass.
def _psemi(sql, birth=True):
    hdr = "-- APPLY-BY: ci\n-- DB: qnfo-audit\n-- Rollback: SELECT 1\n"
    return [p for p in M.plan("migrations/x.sql", hdr + sql, birth=birth)[1] if "PROBE-SEMICOLON-LINT-1" in p]
_u = "UPDATE remediation_contracts SET verify_probe = 'SELECT 1 WHERE instr(x, ''a; b'') > 0' WHERE class = 'issue-1';"
ok(len(_psemi(_u)) == 1, "an UPDATE of a d1-query probe holding a semicolon is refused", _psemi(_u))
ok(not _psemi(_u, birth=False), "a file already on main (--history) is not refused for it")
_i = "INSERT INTO remediation_contracts (class, verify_probe, verify_transport) VALUES ('c1', 'SELECT ''a;b''', 'd1-query'), ('c2', 'SELECT 1', 'd1-query');"
ok(len(_psemi(_i)) == 1, "an INSERT row with a semicolon probe is refused, a clean row beside it is not", _psemi(_i))
ok(not _psemi("UPDATE remediation_contracts SET verify_probe = 'SELECT 1', verify_transport = 'd1-query' WHERE class = 'issue-1';"), "a probe without a semicolon passes")
_cr = "UPDATE remediation_contracts SET verify_probe = '{\"contains\": \"x; y\"}', verify_transport = 'code-read' WHERE class = 'issue-1';"
ok(not _psemi(_cr), "a code-read JSON probe is exempt")
ok(not _psemi("UPDATE agent_issues SET description = 'a; b' WHERE id = 1;"), "other tables are not judged")

# LOOP-BREAKER-1 (1000811): both failed files must recover through the runner, including a partial apply and an older commit's replay.
shared_db = db
db = sqlite3.connect(":memory:")
db.executescript("""
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER, close_channel TEXT);
CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, close_evidence TEXT);
CREATE TABLE human_actions (id INTEGER PRIMARY KEY, title TEXT, status TEXT, created_at TEXT, source TEXT, slug TEXT);
CREATE TABLE blocker_redteam (target TEXT, ts TEXT, verdict TEXT, text_sig TEXT);
CREATE TABLE failure_modes (
  fm_key TEXT PRIMARY KEY, failure_mode TEXT NOT NULL, root_cause TEXT NOT NULL,
  remediation TEXT NOT NULL, detector TEXT NOT NULL, probe_class TEXT, first_seen TEXT NOT NULL,
  issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT
);
CREATE TABLE decision_log (
  id INTEGER PRIMARY KEY, actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL,
  evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL,
  capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT
);
CREATE TABLE products (
  slug TEXT PRIMARY KEY, name TEXT NOT NULL, surface TEXT NOT NULL, owner_worker TEXT,
  repo TEXT NOT NULL DEFAULT 'QNFO/qnfo-workers', path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO products (slug, name, surface) VALUES ('catalog-entry', 'Existing product', 'https://example.org');
CREATE VIEW v_blocker_claims AS
  SELECT 'issue:' || id AS target, title AS text, created_at AS created_ms FROM agent_issues WHERE status = 'open';
""")
try:
    for filename, break_sql, expected_error in [
        ("2026-10-29-blocker-claims-confirmed-sticks.sql",
         lambda text: text.replace(
             "  'no signed confirmed-with-evidence red-team verdict whose text signature still matches is listed by v_blocker_claims',\n", ""),
         "10 values for 11 columns"),
        ("2026-10-29-plus-1-products.sql",
         lambda text: text.replace("product_plus_registry", "products"),
         "table products has no column named key"),
    ]:
        path = "migrations/" + filename
        with open(os.path.join(HERE, "..", path), encoding="utf-8") as fh:
            fixed = fh.read()
        broken = break_sql(fixed)
        ok(broken != fixed, filename + ": the fixture recreates the recorded SQL defect")
        rc = M.apply_file(path, broken, "a", "t", "before-repair", emit)
        failure = db.execute("SELECT status, error FROM migration_runs WHERE file = ? ORDER BY id DESC LIMIT 1", (path,)).fetchone()
        ok(rc == 1 and failure[0] == "error" and expected_error in failure[1],
           filename + ": the runner records the original failure", (rc, failure))
        db.execute("INSERT INTO issue_triage (issue_id) SELECT id FROM agent_issues WHERE title = ?",
                   ("MIGRATION-APPLY-FAILED-1: " + filename,))
        db.commit()
        rc = M.apply_file(path, fixed, "a", "t", "repair", emit)
        ok(rc == 0 and json.loads(out[-1]).get("ok"), filename + ": the repaired SQL completes after a partial apply", out[-1])
        ok(db.execute("SELECT COUNT(*) FROM migration_runs WHERE file = ? AND status = 'ok'", (path,)).fetchone()[0] == 1,
           filename + ": recovery records one ok run")
        issue = db.execute("SELECT a.status, t.close_evidence FROM agent_issues a JOIN issue_triage t ON t.issue_id = a.id WHERE a.title = ?",
                           ("MIGRATION-APPLY-FAILED-1: " + filename,)).fetchone()
        ok(issue[0] == "closed" and "migration_runs ok for " + path in issue[1],
           filename + ": recovery closes the failure with ledger evidence", issue)
        before = db.total_changes
        rc = M.apply_file(path, fixed, "a", "t", "repair-replay", emit)
        ok(rc == 0 and json.loads(out[-1]).get("already_applied") and db.total_changes == before,
           filename + ": the same content is skipped without writes", out[-1])
        rc = M.apply_file(path, broken, "a", "t", "older-commit", emit)
        ok(rc == 0 and json.loads(out[-1]).get("superseded") and db.total_changes == before,
           filename + ": an older failed content cannot restart the loop after recovery", out[-1])

    ok(db.execute("SELECT detector FROM failure_modes WHERE fm_key = 'blocker-verdict-confirmed-expires-daily'").fetchone()[0],
       "the blocker failure-mode INSERT supplies its required detector")
    ok(db.execute("SELECT COUNT(*) FROM decision_log").fetchone()[0] == 1,
       "the blocker repair records exactly one decision across replays")
    ok(db.execute("SELECT COUNT(*) FROM bak_20261029_v_blocker_claims").fetchone()[0] == 1,
       "the blocker backup survives the partial apply and recovery")
    ok(db.execute("SELECT slug, name, surface FROM products").fetchall() == [
        ("catalog-entry", "Existing product", "https://example.org")],
       "product registry recovery leaves the existing catalog untouched")
    ok(db.execute("SELECT COUNT(*) FROM product_plus_registry").fetchone()[0] == 7
       and db.execute("SELECT COUNT(*) FROM v_product_plus_debt").fetchone()[0] == 7,
       "product registry recovery seeds all seven products and their debt view")
finally:
    db.close()
    db = shared_db

# NOOP-UPDATE-1: a guarded UPDATE that changed 0 rows is reported (JSON, ::warning, cloud_ops_events), never failed; NOOP-OK silences it; d1(meta=) returns D1's meta.
db.execute("CREATE TABLE IF NOT EXISTS cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT)")
db.execute("INSERT OR REPLACE INTO ops_config (key, value) VALUES ('noop_probe', 'old text here')")
db.commit()
NOOP_HEAD = """-- NOOP-UPDATE-1 test
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE ops_config SET value = 'old text here' WHERE key = 'noop_probe';
"""


def noop_run(name, sql_body, commit):
    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        rc = M.apply_file("migrations/" + name + ".sql", NOOP_HEAD + sql_body, "a", "t", commit, emit)
    return rc, json.loads(out[-1]), err.getvalue()


m0 = {}
M.d1("a", "t", "db", "UPDATE ops_config SET value = value WHERE key = 'noop_probe'", meta=m0)
ok(m0.get("changes") == 1, "d1(meta=) hands back D1's meta.changes", m0)
rc, j, err = noop_run("noop-hit", "UPDATE ops_config SET value = replace(value, 'old', 'new') WHERE key = 'noop_probe';\n", "n1")
ok(rc == 0 and j.get("ok") and "noop_updates" not in j and not db.execute("SELECT COUNT(*) FROM cloud_ops_events").fetchone()[0],
   "an UPDATE that changed a row reports nothing", (j, err))
rc, j, err = noop_run("noop-replace-miss", "UPDATE ops_config SET value = replace(value, 'old', 'newer') WHERE key = 'noop_probe';\n", "n2")
ok(rc == 0 and j.get("ok") and len(j.get("noop_updates") or []) == 1 and "UPDATE ops_config found no row holding the text its replace() looks for" in j["noop_updates"][0]
   and j["statements"] == 1, "an unguarded replace() whose text no row holds (meta.changes says 1) applies ok, is reported in the JSON and does not fail the run", j)
ok("::warning file=migrations/noop-replace-miss.sql::NOOP-UPDATE-1" in err and "replace() on live text" in err, "...and raises a workflow warning annotation on stderr", err)
ev = db.execute("SELECT kind, status, job, meta FROM cloud_ops_events WHERE kind = 'migration-noop-replace'").fetchall()
ok(len(ev) == 1 and ev[0][1] == "warn" and ev[0][2] == "apply-migrations" and json.loads(ev[0][3])["table"] == "ops_config", "...and writes one warn event of the replace class", ev)
rc, j, err = noop_run("noop-plain-miss", "UPDATE ops_config SET value = 'x' WHERE key = 'no_such_key';\n".replace("\\n", "\n"), "n3")
ok(rc == 0 and len(j.get("noop_updates") or []) == 1 and db.execute("SELECT COUNT(*) FROM cloud_ops_events WHERE kind = 'migration-noop-update'").fetchone()[0] == 1,
   "a plain guarded UPDATE that matched nothing is the other kind, migration-noop-update", (j, err))
rc, j, err = noop_run("noop-ok", "-- NOOP-OK: replay of a guard that is already satisfied\nUPDATE ops_config SET value = 'x' WHERE key = 'no_such_key';\n".replace("\\n", "\n"), "n4")
ok(rc == 0 and j.get("ok") and "noop_updates" not in j and "::warning" not in err, "a file with a NOOP-OK line expects the empty update and is not reported", (j, err))
rc, j, err = noop_run("noop-insert-only", "INSERT OR REPLACE INTO ops_config (key, value) VALUES ('noop_probe2', 'v');\n".replace("\\n", "\n"), "n5")
ok(rc == 0 and "noop_updates" not in j, "an INSERT is never reported", j)
n_events = db.execute("SELECT COUNT(*) FROM cloud_ops_events").fetchone()[0]
rc, j, err = noop_run("noop-replace-miss", "UPDATE ops_config SET value = replace(value, 'old', 'newer') WHERE key = 'noop_probe';\n", "n6")
ok(rc == 0 and j.get("already_applied") and db.execute("SELECT COUNT(*) FROM cloud_ops_events").fetchone()[0] == n_events, "the same content is not applied or reported twice", (j, n_events))
rc, j, err = noop_run("noop-guarded", "UPDATE ops_config SET value = replace(value, 'old', 'x') WHERE key = 'noop_probe' AND instr(value, 'old') > 0;\n", "n8")
ok(rc == 0 and len(j.get("noop_updates") or []) == 1 and j["statements"] == 1, "a text-guarded replace() that matched nothing (the ISSUE-PROBE-CAP case) is reported once", j)
rc, j, err = noop_run("noop-chain-hit", "UPDATE ops_config SET value = replace(replace(value, 'zzz', 'y'), 'new', 'NEW') WHERE key = 'noop_probe';\n", "n9")
ok(rc == 0 and "noop_updates" not in j and db.execute("SELECT value FROM ops_config WHERE key = 'noop_probe'").fetchone()[0] == "NEW text here",
   "a replace() chain where one text is present changes the row and reports nothing", j)
rc, j, err = noop_run("noop-subquery-where", "UPDATE ops_config SET value = (SELECT 'q' FROM ops_config WHERE key = 'noop_probe') WHERE key = 'noop_probe';\n", "n10")
ok(rc == 0 and "noop_updates" not in j, "a WHERE inside a subquery is not mistaken for the statement's own", j)
ok(M.top_where("UPDATE t SET c = 'a WHERE b', d = (SELECT 1 FROM u WHERE x = 1) WHERE k = 2") == len("UPDATE t SET c = 'a WHERE b', d = (SELECT 1 FROM u WHERE x = 1) WHERE")
   and M.top_where("UPDATE t SET c = 1") == -1 and M.top_where("UPDATE t SET somewhere = 1 WHERE k = 2") == len("UPDATE t SET somewhere = 1 WHERE"),
   "top_where finds the statement's own WHERE, not one in a string, a subquery or an identifier")
ok(M.replace_text_probe("UPDATE t SET c = replace(c, 'it''s', 'x') WHERE k = 2") == "SELECT EXISTS (SELECT 1 FROM \"t\" WHERE (k = 2) AND (instr(c, 'it''s') > 0)) AS n"
   and M.replace_text_probe("UPDATE t SET c = 'x' WHERE k = 2") is None and M.replace_text_probe("UPDATE t SET c = replace(c, 'a', 'b')") is None,
   "the replace() text probe keeps the WHERE and the quoted literal, and is None for other shapes", M.replace_text_probe("UPDATE t SET c = replace(c, 'it''s', 'x') WHERE k = 2"))
# NOOP-UPDATE-1 hardening (independent review, 2026-11-04): the probe is one attempt, an EXISTS, comment-safe, and only for statements whose every SET is a replace().
ok(M.replace_text_probe("UPDATE t SET c = replace(c, 'a', 'b'), n = 'x' WHERE k = 2") is None, "a statement that also sets another column is not probed (it changes something whatever replace() finds)")
ok(M.replace_text_probe("UPDATE t SET c = replace(c, 'a', 'b') WHERE k = 2 -- only this row") == "SELECT EXISTS (SELECT 1 FROM \"t\" WHERE (k = 2) AND (instr(c, 'a') > 0)) AS n",
   "a trailing line comment is dropped so it cannot swallow the appended condition", M.replace_text_probe("UPDATE t SET c = replace(c, 'a', 'b') WHERE k = 2 -- only this row"))
ok(M.replace_text_probe("UPDATE t SET c = replace(c, 'a', 'b'), d = replace(d, 'x', 'y') WHERE k = 2") == "SELECT EXISTS (SELECT 1 FROM \"t\" WHERE (k = 2) AND (instr(c, 'a') > 0 OR instr(d, 'x') > 0)) AS n",
   "two replace() assignments are probed together")
ok(M.drop_comments("SELECT '-- not a comment' /* gone */ , 1 -- gone") == "SELECT '-- not a comment'   , 1 ", "drop_comments keeps literals and removes both comment forms", M.drop_comments("SELECT '-- not a comment' /* gone */ , 1 -- gone"))
rc, j, err = noop_run("noop-where-replace", "UPDATE ops_config SET value = 'x' WHERE replace(key, 'k', 'z') = 'nope-here';" + chr(10), "n11")
ok(rc == 0 and len(j.get("noop_updates") or []) == 1
   and [r[0] for r in db.execute("SELECT kind FROM cloud_ops_events WHERE meta LIKE '%noop-where-replace%'").fetchall()] == ["migration-noop-update"],
   "a replace() only in the WHERE that matched nothing is the plain kind, not the replace class", (j, err))
# one attempt for the probe: a 429 on the probe is not retried, and the migration still applies
probe_calls = []
real_call = C.call


def overloaded_probe(method, path, token, body=None, timeout=60):
    if "SELECT EXISTS" in body["sql"]:
        probe_calls.append(1)
        return 429, {"success": False, "errors": [{"message": "D1 DB is overloaded"}]}
    return real_call(method, path, token, body, timeout)


real_backoff = M.D1_OVERLOAD_BACKOFF_S
M.D1_OVERLOAD_BACKOFF_S = (0, 0, 0)
C.call = overloaded_probe
try:
    db.execute("INSERT OR REPLACE INTO ops_config (key, value) VALUES ('probe429', 'abc')")
    db.commit()
    rc, j, err = noop_run("noop-probe-429", "UPDATE ops_config SET value = replace(value, 'zzz', 'y') WHERE key = 'probe429';" + chr(10), "n12")
finally:
    C.call = real_call
    M.D1_OVERLOAD_BACKOFF_S = real_backoff
ok(rc == 0 and j.get("ok") and len(probe_calls) == 1 and "noop_updates" not in j, "an overloaded probe is tried once (no backoff ladder) and never blocks or fails the migration", (probe_calls, j))
db.execute("DROP TABLE cloud_ops_events")
db.commit()
rc, j, err = noop_run("noop-no-events-table", "UPDATE ops_config SET value = 'x' WHERE key = 'still_no_such_key';\n".replace("\\n", "\n"), "n7")
ok(rc == 0 and j.get("ok") and len(j.get("noop_updates") or []) == 1 and "noop report" in err and db.execute("SELECT status FROM migration_runs WHERE file = 'migrations/noop-no-events-table.sql'").fetchone()[0] == "ok",
   "an unwritable event row never fails the migration", (rc, j, err))

# INSERT-BASELINE-CANARY-1 (live outage 2026-11-04 18:57-19:22Z): an insert probe that passed before the file and is refused after it vetoes the file; one refused before is chronic
# and stays an advisory; a restored prior definition that refuses inserts again at its new position is dropped again.
db.execute("CREATE TABLE evt (id TEXT, k TEXT)")
db.execute("CREATE TABLE iss (t TEXT)")
db.commit()
ib_state = {"recreated": False, "chronic": False}
ib_real_call = C.call
NESTED_DEEP = (400, {"success": False, "errors": [{"code": 7500, "message": "triggers nested too deep: SQLITE_ERROR"}]})


def ib_call(method, path, token, body=None, timeout=60):
    sql = body["sql"]
    if sql.lstrip().upper().startswith("CREATE TRIGGER") and "evt_filer" in sql:
        ib_state["recreated"] = True
    if sql.lstrip().startswith('INSERT INTO "evt" (') and " WHERE 0" in sql:
        if ib_state["chronic"] or (ib_state["recreated"] and db.execute("SELECT 1 FROM sqlite_master WHERE name = 'evt_filer'").fetchone()):
            return NESTED_DEEP
    return ib_real_call(method, path, token, body, timeout)


IB_HEAD = """-- INSERT-BASELINE-CANARY-1 test
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP TRIGGER IF EXISTS evt_filer
"""
IB_TRIGGER = "CREATE TRIGGER evt_filer AFTER INSERT ON evt BEGIN INSERT INTO iss (t) VALUES (NEW.k); END;\n"
C.call = ib_call
try:
    # (a) regression: the insert compiled before the file, is refused after it -> the trigger is dropped at once and the file stops
    rc = M.apply_file("migrations/ib-regress.sql", IB_HEAD + IB_TRIGGER + "INSERT OR REPLACE INTO ops_config (key, value) VALUES ('after_ib', '1');\n", "a", "t", "ib1", emit)
    ok(rc == 1 and "D1-TRIGGER-DEPTH-1" in out[-1] and "INSERT-BASELINE-CANARY-1" in out[-1] and not db.execute("SELECT 1 FROM sqlite_master WHERE name = 'evt_filer'").fetchone()
       and not db.execute("SELECT 1 FROM ops_config WHERE key = 'after_ib'").fetchone(), "an insert refusal that was not there before the file refuses it and drops the trigger", out[-1])
    # (b) chronic: the insert probe is refused before the file too (agent_issues): advisory only, the trigger stays
    ib_state.update({"recreated": False, "chronic": True})
    rc = M.apply_file("migrations/ib-chronic.sql", IB_HEAD + "-- chronic\n" + IB_TRIGGER, "a", "t", "ib2", emit)
    ok(rc == 0 and json.loads(out[-1]).get("ok") and db.execute("SELECT 1 FROM sqlite_master WHERE name = 'evt_filer'").fetchone() and json.loads(out[-1]).get("advisory"),
       "an insert probe refused before the file stays an advisory (agent_issues) and the trigger stays", out[-1])
    # (c) replace: DROP + CREATE of an existing trigger; the restored prior text refuses again at its new position -> dropped again, inserts work
    db.execute("DROP TRIGGER evt_filer")
    ib_state.update({"recreated": False, "chronic": False})
    db.execute(IB_TRIGGER.rstrip().rstrip(";"))
    db.commit()
    ib_state["recreated"] = False
    db.execute("CREATE TABLE ib_bak (x)")
    db.commit()
    rc = M.apply_file("migrations/ib-replace.sql", IB_HEAD + "-- BACKUP: ib_bak\nDROP TRIGGER IF EXISTS evt_filer;\n" + IB_TRIGGER.replace("VALUES (NEW.k)", "VALUES (NEW.k || 'v2')"), "a", "t", "ib3", emit)
    ok(rc == 1 and "dropped again" in out[-1] and not db.execute("SELECT 1 FROM sqlite_master WHERE name = 'evt_filer'").fetchone(),
       "a restored definition that refuses inserts again at its new position is dropped again", out[-1])
    # (d) no trigger statement, no baseline probes
    n_probe = len([q for q in calls[-400:] if 'INSERT INTO "evt" (' in q])
    rc = M.apply_file("migrations/ib-plain.sql", IB_HEAD + "INSERT OR REPLACE INTO ops_config (key, value) VALUES ('ib_plain', '1');\n", "a", "t", "ib4", emit)
    ok(rc == 0 and len([q for q in calls[-400:] if 'INSERT INTO "evt" (' in q]) == n_probe, "a file without a trigger statement takes no insert baseline")
finally:
    C.call = ib_real_call

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
